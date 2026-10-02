/**
 * PDF loading for the document intelligence agent.
 *
 * No PDF-parsing dependency is added for this — the guards below only need a
 * page *count*, not full parsing, so a couple of small regexes over the raw
 * bytes are enough. This deliberately does not handle every PDF structure
 * (e.g. page objects buried inside compressed object streams in a PDF 1.5+
 * cross-reference stream will not match the `/Type /Page` scan); where that
 * happens we fall back to the `/Count` on the page-tree root, and finally to
 * "assume 1 page" rather than block a case on a file we can't introspect.
 * This is a guard against the API's request-size/page limits, not a claim of
 * exact pagination.
 *
 * The caller hands this module bytes already in memory (read from disk, a
 * blob store, or an upload buffer — this module doesn't know or care which)
 * rather than a filesystem path, so it works the same regardless of which
 * `StorageAdapter` backend produced them.
 */

/** Anthropic's documented request-body ceiling for a `document` content block. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

/**
 * Anthropic's page ceiling for 200k-context models. Claude Opus 5 runs a much
 * larger context window, but the agent is instructed to hold the line at 100
 * pages regardless — a conservative, explicit limit beats silently relying on
 * a larger cap that could change with the deployed model.
 */
export const MAX_PDF_PAGES = 100;

export interface LoadedPdf {
  /** Base64 of the raw file bytes, with newlines stripped as the API requires. */
  base64: string;
  /** Raw (pre-base64) file size in bytes. */
  sizeBytes: number;
  /** Best-effort page count — see file header comment for how this is derived. */
  pageCount: number;
  /**
   * Set when only some pages were sent: which pages of the original, 0-based,
   * in the order they appear in what was sent, and how many it has.
   */
  window?: { pages: number[]; of: number };
}

/** What a window may weigh, raw: base64 of it stays under the request ceiling with room for the prompt. */
const WINDOW_BYTES = 22 * 1024 * 1024;

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/**
 * The first pages of a long document and its last, as one smaller PDF.
 *
 * A merged title bundle runs to eight hundred scanned pages and an opinion on
 * title to a hundred and thirty; neither can be sent whole. What a reader
 * needs most sits at the two ends — the schedule, the parties and the
 * documents perused at the front, the conclusion and the signature at the
 * back — so the window takes the head and the tail, as many pages as fit the
 * size and page ceilings, and says which pages they were.
 */
export async function windowPdf(buffer: Buffer): Promise<LoadedPdf | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const total = source.getPageCount();
    for (const span of [80, 60, 40, 24, 12, 6, 2]) {
      const head = Math.min(span, total);
      const tail = Math.min(Math.round(span / 4), total - head);
      const pages = [...range(0, head), ...range(total - tail, total)];
      const out = await PDFDocument.create();
      for (const page of await out.copyPages(source, pages)) out.addPage(page);
      const bytes = Buffer.from(await out.save());
      if (bytes.byteLength <= WINDOW_BYTES && pages.length <= MAX_PDF_PAGES) {
        return { base64: bytes.toString('base64'), sizeBytes: bytes.byteLength, pageCount: pages.length, window: { pages, of: total } };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type PdfLoadFailureReason = 'empty' | 'too_large' | 'too_many_pages';

export type PdfLoadResult =
  | { ok: true; pdf: LoadedPdf }
  | { ok: false; reason: PdfLoadFailureReason; message: string };

/**
 * Base64-encodes a PDF already held in memory and applies the API's
 * size/page guards. Never throws — every failure mode comes back as
 * `{ ok: false }` so the caller can fail the agent run cleanly instead of
 * crashing it.
 */
export async function loadPdfForExtraction(buffer: Buffer): Promise<PdfLoadResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: 'empty', message: 'The PDF file is empty.' };
  }

  const pageCount = countPdfPages(buffer);
  // Too long or too heavy to send whole: send its two ends instead.
  if (pageCount > MAX_PDF_PAGES || (buffer.byteLength * 4) / 3 > MAX_PDF_BYTES) {
    const windowed = await windowPdf(buffer);
    if (windowed) return { ok: true, pdf: windowed };
  }
  if (pageCount > MAX_PDF_PAGES) {
    return {
      ok: false,
      reason: 'too_many_pages',
      message: `PDF has an estimated ${pageCount} pages, over the ${MAX_PDF_PAGES}-page limit for this model — not sent to the API.`,
    };
  }

  // Base64 inflates size by ~4/3; the 32MB ceiling is on the request body
  // (i.e. the encoded form), so that's what gets checked, not the raw file.
  const base64 = buffer.toString('base64').replace(/\r?\n/g, '');
  if (base64.length > MAX_PDF_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: `PDF is ${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB (${(base64.length / (1024 * 1024)).toFixed(1)}MB base64-encoded), over the 32MB request limit — not sent to the API.`,
    };
  }

  return { ok: true, pdf: { base64, sizeBytes: buffer.byteLength, pageCount } };
}

/**
 * Best-effort page count. PDF page objects are dictionaries carrying
 * `/Type /Page` (note the deliberate `(?!s)` so `/Type /Pages` — the page
 * *tree* node, not a leaf — never counts as a page). This catches the large
 * majority of real-world PDFs, generated or scanned, without needing a parser.
 */
export function countPdfPages(buffer: Buffer): number {
  // PDF structural keywords are ASCII regardless of content-stream encoding
  // (compressed streams, embedded fonts, etc.), so latin1 is a safe, lossless
  // byte-to-char mapping for this scan — no encoding-detection dependency.
  const text = buffer.toString('latin1');

  const pageObjectMatches = text.match(/\/Type\s*\/Page(?!s)\b/g);
  if (pageObjectMatches && pageObjectMatches.length > 0) {
    return pageObjectMatches.length;
  }

  // Fall back to /Count on the page-tree root, for PDFs whose leaf page
  // objects live inside an object stream (so the regex above sees nothing).
  const treeCount = findPageTreeCount(text);
  if (treeCount !== null) return treeCount;

  // Can't introspect it — assume a single page rather than block the case.
  return 1;
}

function findPageTreeCount(text: string): number | null {
  const rootIndex = text.search(/\/Type\s*\/Pages\b/);
  if (rootIndex === -1) return null;
  // Dictionary key order isn't guaranteed, so look in a window around the
  // match rather than requiring /Count to follow /Type directly.
  const windowStart = Math.max(0, rootIndex - 400);
  const windowEnd = Math.min(text.length, rootIndex + 400);
  const window = text.slice(windowStart, windowEnd);
  const match = window.match(/\/Count\s+(\d+)/);
  return match ? parseInt(match[1] ?? '', 10) : null;
}
