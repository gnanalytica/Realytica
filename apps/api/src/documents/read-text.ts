/// <reference path="./pdfjs-worker.d.ts" />
/**
 * Getting the words out of a document, on this server, with no model.
 *
 * Two routes to the same result — the text of each page, in order:
 *
 *   1. The text layer. Most PDFs a registry or the BBMP portal issues have
 *      one, compressed and font-encoded; pdf.js decodes it properly, page by
 *      page, keeping line breaks so a schedule reads as a schedule.
 *   2. OCR. A scanned PDF has no text layer, and a phone photo of a deed is
 *      nothing but pixels. For those, the page image goes through Tesseract
 *      (compiled to WebAssembly, so there is no system binary to install and
 *      it runs the same on a laptop and on a serverless function). The
 *      language data ships inside the app rather than being fetched from a
 *      CDN at runtime, so reading works offline and never depends on a third
 *      party being up.
 *
 * English first; Karnataka land records are frequently in Kannada, so a page
 * whose English reading comes back weak is read again with Kannada as well.
 *
 * Bounded on purpose: a 400-page bundle is read to a limit and says it was
 * cut, rather than tying a request up for minutes.
 */

import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface DocumentText {
  /** The text of each page, in order. An unreadable page is an empty string. */
  pages: string[];
  /** How the words were obtained. `none` means nothing readable was found. */
  method: 'text' | 'ocr' | 'mixed' | 'none';
  /** 1-based pages that were read by OCR. */
  ocrPages: number[];
  /** Mean OCR confidence 0..100, over the OCR'd pages. */
  ocrConfidence?: number;
  /** Pages in the file, which may exceed `pages.length` when it was cut. */
  totalPages: number;
  truncated: boolean;
  /** Why nothing could be read, in plain words — set only when method is `none`. */
  failure?: string;
}

export interface ReadOptions {
  /** Pages of text layer to read. */
  maxPages?: number;
  /** Pages to OCR — the expensive part, so it is capped separately. */
  maxOcrPages?: number;
  /** Progress, for the chat's live steps. */
  onProgress?: (label: string) => void;
}

const IMAGE_TYPES = /^image\/(?:jpe?g|png|gif|bmp|tiff?|webp|x-portable)/i;
const IMAGE_EXT = /\.(?:jpe?g|png|gif|bmp|tiff?|webp|pnm|ppm|pgm)$/i;
/** A page with fewer characters than this has no usable text layer. */
const MIN_TEXT_CHARS = 40;

/* -------------------------------------------------------------------- */
/* pdf.js                                                                */
/* -------------------------------------------------------------------- */

const require = createRequire(import.meta.url);

/** Where this module sits — the source file in dev, the bundle on a deployment. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** pdf.js's standard fonts, if they can be found; text extraction works without them. */
function standardFontDataUrl(): string | undefined {
  try {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    return pathToFileURL(path.join(root, 'standard_fonts') + path.sep).href;
  } catch {
    return undefined;
  }
}

let workerReady: Promise<void> | null = null;

/**
 * pdf.js's worker, loaded into this thread.
 *
 * pdf.js normally fetches its worker from a file path. In a bundled
 * deployment there is no such path — every package is inlined into one file —
 * so the worker module is imported here and handed to pdf.js as
 * `globalThis.pdfjsWorker`, which it uses in place of spawning one. The same
 * code then runs unchanged in development and in the bundle.
 */
function ensurePdfWorker(): Promise<void> {
  workerReady ??= (async () => {
    const holder = globalThis as unknown as { pdfjsWorker?: unknown };
    if (!holder.pdfjsWorker) holder.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  })();
  return workerReady;
}

async function loadPdf(bytes: Uint8Array) {
  await ensurePdfWorker();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = standardFontDataUrl();
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    // Decode images in JavaScript. There is no OffscreenCanvas on a server,
    // and asking for one is how a scanned page comes back as nothing.
    isOffscreenCanvasSupported: false,
    useSystemFonts: true,
    ...(fonts ? { standardFontDataUrl: fonts } : {}),
    verbosity: 0,
  }).promise;
  return { pdfjs, doc };
}

/**
 * One page's text layer, with its lines.
 *
 * pdf.js returns runs of text with an end-of-line flag and a position; joining
 * them with spaces flattens a deed's schedule into one sentence and loses the
 * boundaries table entirely. Lines are rebuilt from the flag and from a jump
 * in the baseline.
 */
function pageText(items: Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>): string {
  let out = '';
  let lastY: number | null = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += item.str;
    if (item.hasEOL) out += '\n';
    else if (item.str && !item.str.endsWith(' ')) out += ' ';
    if (y !== null) lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The largest image painted on a page, as pixels.
 *
 * A scanned PDF page is one image drawn full-bleed. Rather than render the
 * page — which needs a native canvas on a server — the image is taken
 * straight from pdf.js, already decoded.
 */
async function pageImage(pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'), page: import('pdfjs-dist/types/src/display/api').PDFPageProxy) {
  const ops = await page.getOperatorList();
  const names: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.paintImageXObject) {
      const name = ops.argsArray[i]?.[0];
      if (typeof name === 'string') names.push(name);
    }
  }
  let best: { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray } | null = null;
  for (const name of names) {
    const img = await new Promise<unknown>((resolve) => {
      try {
        // Page-level objects first; a shared image lives in commonObjs.
        if (page.objs.has(name)) page.objs.get(name, resolve);
        else page.commonObjs.get(name, resolve);
      } catch {
        resolve(null);
      }
    });
    const candidate = img as { width?: number; height?: number; kind?: number; data?: Uint8Array } | null;
    if (!candidate?.data || !candidate.width || !candidate.height) continue;
    if (!best || candidate.width * candidate.height > best.width * best.height) {
      best = { width: candidate.width, height: candidate.height, kind: candidate.kind ?? 2, data: candidate.data };
    }
  }
  return best;
}

/** Raw pixels as a PNM, which Tesseract's image loader reads natively. */
function toPnm(img: { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray }): Buffer {
  const { width: w, height: h, kind, data } = img;
  const rgb = Buffer.alloc(w * h * 3);
  if (kind === 3) {
    for (let i = 0, j = 0; i + 3 < data.length && j < rgb.length; i += 4, j += 3) {
      rgb[j] = data[i]!;
      rgb[j + 1] = data[i + 1]!;
      rgb[j + 2] = data[i + 2]!;
    }
  } else if (kind === 1) {
    // 1 bit per pixel, rows padded to whole bytes. pdf.js has already applied
    // the image's decode array, so a set bit is WHITE — the same convention
    // its own canvas painter uses. Inverting it hands OCR a negative.
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const j = (y * w + x) * 3;
        rgb[j] = v;
        rgb[j + 1] = v;
        rgb[j + 2] = v;
      }
    }
  } else {
    rgb.set(data.subarray(0, Math.min(data.length, rgb.length)));
  }
  return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), rgb]);
}

/* -------------------------------------------------------------------- */
/* Tesseract                                                             */
/* -------------------------------------------------------------------- */

type Worker = import('tesseract.js').Worker;

const workers = new Map<string, Promise<Worker>>();
let idleTimer: NodeJS.Timeout | null = null;
/** An OCR worker is a thread holding a language model; let it go when idle. */
const IDLE_MS = 90_000;

let langDirReady: string | null = null;

/**
 * One directory holding every bundled language.
 *
 * Tesseract takes a single `langPath`, and the data ships as one package per
 * language, so the files are copied side by side once — into the temp dir,
 * which is writable on a laptop and on a serverless function alike. Nothing
 * is fetched from the network.
 */
async function languageDirectory(): Promise<string> {
  if (langDirReady) return langDirReady;
  const { copyFile, mkdir, stat } = await import('node:fs/promises');
  const has = (p: string) => stat(p).then((s) => s.size > 0).catch(() => false);
  // A deployment ships the data beside the bundle (see the Vercel build);
  // an operator can point elsewhere. Either is used as it stands.
  for (const dir of [process.env.REALYTICA_OCR_LANG_DIR, path.join(HERE, 'ocr-lang')]) {
    if (dir && (await has(path.join(dir, 'eng.traineddata.gz')))) {
      langDirReady = dir;
      return dir;
    }
  }
  // Development: gather the per-language packages into one directory.
  const dir = path.join(os.tmpdir(), 'realytica-ocr', 'lang');
  await mkdir(dir, { recursive: true });
  for (const lang of ['eng', 'kan'] as const) {
    const to = path.join(dir, `${lang}.traineddata.gz`);
    if (await has(to)) continue;
    try {
      const from = path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`);
      await copyFile(from, to);
    } catch {
      if (lang === 'eng') throw new Error('OCR language data is not installed.');
    }
  }
  langDirReady = dir;
  return dir;
}

async function ocrWorker(langs: Array<'eng' | 'kan'>): Promise<Worker> {
  const key = langs.join('+');
  let pending = workers.get(key);
  if (!pending) {
    pending = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const langPath = await languageDirectory();
      return createWorker(langs, OEM.LSTM_ONLY, {
        langPath,
        cachePath: path.join(os.tmpdir(), 'realytica-ocr', 'cache'),
        gzip: true,
        logger: () => {},
        errorHandler: () => {},
      });
    })();
    workers.set(key, pending);
    pending.catch(() => workers.delete(key));
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void releaseOcr(), IDLE_MS);
  idleTimer.unref?.();
  return pending;
}

/** Terminate every OCR worker. Safe to call at any time. */
export async function releaseOcr(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map((p) => p.then((w) => w.terminate()).catch(() => undefined)));
}

/** Share of letters that are Latin — low means the page is in another script. */
function latinShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin / letters.length;
}

async function ocrImage(image: Buffer): Promise<{ text: string; confidence: number }> {
  const eng = await ocrWorker(['eng']);
  const first = await eng.recognize(image);
  const text = first.data.text ?? '';
  const confidence = first.data.confidence ?? 0;
  // Weak English on a page with real content is usually a Kannada page. Read
  // it again with both; keep whichever the engine is surer of.
  if ((confidence < 55 || latinShare(text) < 0.5) && text.replace(/\s/g, '').length > 20) {
    try {
      const both = await ocrWorker(['kan', 'eng']);
      const second = await both.recognize(image);
      if ((second.data.confidence ?? 0) > confidence) {
        return { text: second.data.text ?? '', confidence: second.data.confidence ?? 0 };
      }
    } catch {
      /* the English reading stands */
    }
  }
  return { text, confidence };
}

/* -------------------------------------------------------------------- */
/* Entry point                                                           */
/* -------------------------------------------------------------------- */

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * The text of a document, page by page.
 *
 * Never throws for a bad file — a document that cannot be read comes back
 * with `method: 'none'` and a plain `failure`, so an upload always reaches
 * the chat as a card rather than as an error.
 */
export async function readDocumentText(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
  options: ReadOptions = {},
): Promise<DocumentText> {
  const maxPages = options.maxPages ?? 40;
  const maxOcrPages = options.maxOcrPages ?? 8;
  const progress = options.onProgress ?? (() => {});
  const lower = (mimeType || '').toLowerCase();
  const name = fileName.toLowerCase();

  const empty = (failure: string): DocumentText => ({
    pages: [],
    method: 'none',
    ocrPages: [],
    totalPages: 0,
    truncated: false,
    failure,
  });

  if (!bytes.length) return empty('The file is empty.');

  // Plain text travels as itself.
  if (lower.startsWith('text/') || lower.includes('json') || /\.(?:txt|csv|md|json)$/.test(name)) {
    const text = decodeText(bytes).slice(0, 200_000);
    return text.trim()
      ? { pages: [text], method: 'text', ocrPages: [], totalPages: 1, truncated: false }
      : empty('The file has no text in it.');
  }

  // A photograph or a scan saved as an image: OCR is the only way in.
  if (IMAGE_TYPES.test(lower) || IMAGE_EXT.test(name)) {
    try {
      progress('Running OCR on the image');
      const { text, confidence } = await ocrImage(Buffer.from(bytes));
      if (text.replace(/\s/g, '').length < 12) {
        return { ...empty('No legible text was found in the image — it may be a photograph of the site rather than of a document.'), totalPages: 1 };
      }
      return { pages: [text], method: 'ocr', ocrPages: [1], ocrConfidence: Math.round(confidence), totalPages: 1, truncated: false };
    } catch {
      return empty('The image could not be read.');
    }
  }

  if (!(lower.includes('pdf') || name.endsWith('.pdf'))) {
    return empty('This file type cannot be read here — PDFs, images and text files only.');
  }

  let loaded: Awaited<ReturnType<typeof loadPdf>>;
  try {
    loaded = await loadPdf(bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return empty(/password/i.test(message) ? 'The PDF is password-protected, so it cannot be read.' : 'The PDF could not be opened — it may be damaged.');
  }
  const { pdfjs, doc } = loaded;
  const totalPages = doc.numPages;
  const last = Math.min(totalPages, maxPages);
  const pages: string[] = [];
  const ocrPages: number[] = [];
  const confidences: number[] = [];
  try {
    for (let n = 1; n <= last; n += 1) {
      const page = await doc.getPage(n);
      let text = '';
      try {
        const content = await page.getTextContent();
        text = pageText(content.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>);
      } catch {
        text = '';
      }
      if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS && ocrPages.length < maxOcrPages) {
        // No usable text layer: a scan. Read the page image instead.
        try {
          const image = await pageImage(pdfjs, page);
          if (image && image.width * image.height > 40_000) {
            progress(totalPages > 1 ? `Running OCR on page ${n} of ${totalPages}` : 'Running OCR on the scan');
            const read = await ocrImage(toPnm(image));
            if (read.text.replace(/\s/g, '').length > text.replace(/\s/g, '').length) {
              text = read.text.trim();
              ocrPages.push(n);
              confidences.push(read.confidence);
            }
          }
        } catch {
          /* the page stays as whatever its text layer held */
        }
      }
      pages.push(text);
      page.cleanup();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  const readable = pages.some((p) => p.replace(/\s/g, '').length >= 12);
  if (!readable) {
    return {
      pages,
      method: 'none',
      ocrPages,
      totalPages,
      truncated: totalPages > last,
      failure: 'No legible text was found — the scan may be too faint, or the pages may be drawings.',
    };
  }
  const method = ocrPages.length === 0 ? 'text' : ocrPages.length === pages.filter((p) => p.trim()).length ? 'ocr' : 'mixed';
  return {
    pages,
    method,
    ocrPages,
    ocrConfidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : undefined,
    totalPages,
    truncated: totalPages > last,
  };
}
