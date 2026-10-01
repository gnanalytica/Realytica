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
  /**
   * Where each word was on its page, for the pages that had words. Kept so a
   * quote can be found on the page again; never stored itself.
   */
  layout?: PageLayout[];
}

/** One word as read, and where it sits: fractions of the page's width and height from its top left. */
export interface LayoutWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageLayout {
  /** 1-based. */
  page: number;
  /** In reading order — the order the page's text was built in. */
  words: LayoutWord[];
}

export interface ReadOptions {
  /** Pages of text layer to read. */
  maxPages?: number;
  /** Pages to OCR — the expensive part, so it is capped separately. */
  maxOcrPages?: number;
  /** Progress, for the chat's live steps. */
  onProgress?: (label: string) => void;
  /** Each page as it is started, for anything drawing the reading as it goes. */
  onPage?: (page: number, of: number) => void;
  /**
   * Epoch ms after which no further page is sent to OCR. The pages already
   * read stand and the reading says it was cut, so a turn that is running
   * out of time still returns what it has instead of losing all of it.
   */
  deadline?: number;
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

type TextItem = { str?: string; transform?: number[]; width?: number; height?: number };

/**
 * The words of a text layer, where they sit on the page.
 *
 * pdf.js places a whole run of text, not each word, so a word's span is its
 * share of the run's width by characters. That is an estimate in a
 * proportional font, and close enough to put a mark over the right words.
 * Taken in the same order `pageText` reads the runs, so the words line up
 * with the text a quote was cut from.
 */
function textLayerWords(
  pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'),
  items: TextItem[],
  viewport: { width: number; height: number; transform: number[] },
): LayoutWord[] {
  const words: LayoutWord[] = [];
  for (const item of items) {
    const str = item.str;
    if (typeof str !== 'string' || !str.trim() || !item.transform) continue;
    // After the viewport transform, [4] and [5] are the start of the baseline
    // in page pixels, measured from the top.
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.abs(item.height ?? 0) || Math.hypot(t[2]!, t[3]!) || 10;
    const width = item.width ?? 0;
    if (width <= 0) continue;
    const top = t[5]! - height;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    for (const m of str.matchAll(/\S+/g)) {
      const at = m.index ?? 0;
      // A heading's ascent can reach past the top of the page; the box stops at the edge.
      const y = clamp(top / viewport.height);
      words.push({
        text: m[0],
        x: clamp((t[4]! + (at / str.length) * width) / viewport.width),
        y,
        w: ((m[0].length / str.length) * width) / viewport.width,
        // A little below the baseline, so a mark covers descenders too.
        h: clamp((t[5]! + height * 0.25) / viewport.height) - y,
      });
    }
  }
  return words;
}

/** The words OCR found, from its block tree, as fractions of the image they were read from. */
function ocrWords(blocks: import('tesseract.js').Block[] | null | undefined, size: { width: number; height: number }): LayoutWord[] {
  const words: LayoutWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim();
          if (!text) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          words.push({ text, x: x0 / size.width, y: y0 / size.height, w: (x1 - x0) / size.width, h: (y1 - y0) / size.height });
        }
      }
    }
  }
  return words;
}

/**
 * A PNG's or JPEG's pixel size from its header, without decoding it. Enough
 * to put OCR's word boxes on a photographed page; other formats go without.
 */
function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1]!;
      const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      // Start-of-frame markers carry the size; DHT, JPG and DAC share the range and do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
      }
      i += 2 + length;
    }
  }
  return null;
}

/** How long one page image may take to arrive from the PDF parser before the page is skipped. */
const IMAGE_WAIT_MS = 30_000;

type PageImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };

/**
 * The largest image painted on a page, as pixels.
 *
 * A scanned PDF page is one image drawn full-bleed. Rather than render the
 * page — which needs a native canvas on a server — the image is taken
 * straight from pdf.js, already decoded.
 *
 * Two ways a scan is painted. Most are an image. Many scanners, though, write
 * a black-and-white page as an image MASK: a 1-bit stencil the page's fill
 * colour is painted through, with no colour space of its own. pdf.js paints
 * those with a different operator and carries the pixels in the operator
 * itself, and reading only images meant every such page — utility NOCs, an
 * environmental clearance — came back as "nothing legible". Once pdf.js has
 * applied the mask's decode array, a set bit is where the page shows through,
 * which is the 1-bit image convention exactly, so a mask is read as one.
 */
async function pageImage(pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'), page: import('pdfjs-dist/types/src/display/api').PDFPageProxy) {
  const ops = await page.getOperatorList();
  const names: string[] = [];
  const masks: Array<{ data?: unknown; width?: number; height?: number }> = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.paintImageXObject) {
      const name = ops.argsArray[i]?.[0];
      if (typeof name === 'string') names.push(name);
    } else if (fn === pdfjs.OPS.paintImageMaskXObject) {
      const mask = ops.argsArray[i]?.[0] as { data?: unknown; width?: number; height?: number } | undefined;
      if (mask) masks.push(mask);
    }
  }
  let best: PageImage | null = null;
  const consider = (candidate: PageImage) => {
    if (!best || candidate.width * candidate.height > best.width * best.height) best = candidate;
  };
  for (const mask of masks) {
    // Carried inline, or — like an image — by name.
    const resolved = typeof mask.data === 'string' ? ((await awaitObject(page, mask.data)) as typeof mask | null) : mask;
    const data = resolved?.data;
    if ((data instanceof Uint8Array || data instanceof Uint8ClampedArray) && mask.width && mask.height) {
      consider({ width: mask.width, height: mask.height, kind: 1, data });
    }
  }
  for (const name of names) {
    const img = await awaitObject(page, name);
    const candidate = img as { width?: number; height?: number; kind?: number; data?: Uint8Array } | null;
    if (!candidate?.data || !candidate.width || !candidate.height) continue;
    consider({ width: candidate.width, height: candidate.height, kind: candidate.kind ?? 2, data: candidate.data });
  }
  return best as PageImage | null;
}

/**
 * One decoded object from pdf.js, or null if it never arrives.
 *
 * Where to wait is decided by the name, as pdf.js's own painter decides it:
 * a `g_` object is shared and lives in commonObjs, every other one belongs to
 * the page. This used to ask the page's store whether it HAD the image yet
 * and wait on the shared one otherwise — so an image still being decoded at
 * that instant was awaited in a store it would never reach, and the request
 * hung on that page for good. On a scanned EC, page 6 of 14 did exactly that.
 */
function awaitObject(page: import('pdfjs-dist/types/src/display/api').PDFPageProxy, name: string): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const store = name.startsWith('g_') ? page.commonObjs : page.objs;
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS);
    try {
      store.get(name, (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * The first page's largest image, decoded exactly as OCR would receive it.
 * For tests that build scans from real pixels.
 */
export async function firstPageImage(bytes: Uint8Array) {
  const { pdfjs, doc } = await loadPdf(bytes);
  try {
    return await pageImage(pdfjs, await doc.getPage(1));
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/**
 * The longest side OCR is handed, in pixels. A 300 dpi A4 scan is 3,508 on
 * its long side and goes through untouched; a 400 or 600 dpi one is halved,
 * which costs Tesseract nothing it needs and saves most of its time.
 */
const MAX_OCR_EDGE = 3_600;

/**
 * Raw pixels as a PNM, which Tesseract's image loader reads natively.
 *
 * As small as the page allows. Every page used to be expanded to full-colour
 * RGB, three bytes a pixel, even a black-and-white scan: 26 MB for a 300 dpi
 * A4 page and 46 MB at 400 dpi, copied again into the OCR engine's memory —
 * enough, with the Kannada model loaded beside the English one, to stall a
 * serverless function on a single page. A 1-bit scan now travels as a 1-bit
 * bitmap (1 MB), anything else as greyscale, and an oversized page at half
 * size.
 */
function toPnm(img: { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray }): { pnm: Buffer; width: number; height: number } {
  const { width: w, height: h, kind, data } = img;
  const rowBytes = Math.ceil(w / 8);
  // 1 bit per pixel, rows padded to whole bytes. pdf.js has already applied
  // the image's decode array, so a set bit is WHITE — the same convention its
  // own canvas painter uses. Getting it backwards hands OCR a negative.
  const grey = (x: number, y: number): number => {
    if (kind === 1) return ((data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1) ? 255 : 0;
    const at = (y * w + x) * (kind === 3 ? 4 : 3);
    return Math.round(0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!);
  };
  const scale = Math.max(w, h) > MAX_OCR_EDGE ? 2 : 1;

  if (kind === 1 && scale === 1) {
    // PBM, where a set bit is BLACK: the same rows with every bit flipped.
    const bits = Buffer.alloc(rowBytes * h);
    for (let i = 0; i < bits.length; i += 1) bits[i] = ~(data[i] ?? 0xff) & 0xff;
    return { pnm: Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), bits]), width: w, height: h };
  }

  const ow = Math.floor(w / scale);
  const oh = Math.floor(h / scale);
  const out = Buffer.alloc(ow * oh);
  for (let y = 0; y < oh; y += 1) {
    for (let x = 0; x < ow; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) sum += grey(x * scale + dx, y * scale + dy);
      out[y * ow + x] = Math.round(sum / (scale * scale));
    }
  }
  return { pnm: Buffer.concat([Buffer.from(`P5\n${ow} ${oh}\n255\n`), out]), width: ow, height: oh };
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

/**
 * The longest one recognition may take. The worker's own errors are
 * swallowed (a failure there is not news to a reader), which also meant a
 * worker that died mid-page left the page waiting for good and the request
 * with it. Past this, the workers are let go, the next page starts on fresh
 * ones, and this one is skipped.
 */
const PAGE_OCR_TIMEOUT_MS = 75_000;

async function recognizeWithin(worker: Worker, image: Buffer): Promise<Awaited<ReturnType<Worker['recognize']>>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('OCR took too long on this page')), PAGE_OCR_TIMEOUT_MS);
  });
  try {
    // The block tree as well as the text: it is where each word's box is.
    return await Promise.race([worker.recognize(image, {}, { text: true, blocks: true }), timeout]);
  } catch (err) {
    await releaseOcr();
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Text, confidence and — given the image's size — where each word is. Without
 * a size the words have nowhere to be measured against, and are left out.
 */
async function ocrImage(
  image: Buffer,
  size?: { width: number; height: number } | null,
): Promise<{ text: string; confidence: number; words?: LayoutWord[] }> {
  const placed = (blocks: import('tesseract.js').Block[] | null | undefined) =>
    size && size.width > 0 && size.height > 0 ? ocrWords(blocks, size) : undefined;
  const eng = await ocrWorker(['eng']);
  const first = await recognizeWithin(eng, image);
  const text = first.data.text ?? '';
  const confidence = first.data.confidence ?? 0;
  // Weak English on a page with real content is usually a Kannada page. Read
  // it again with both; keep whichever the engine is surer of.
  if ((confidence < 55 || latinShare(text) < 0.5) && text.replace(/\s/g, '').length > 20) {
    try {
      const both = await ocrWorker(['kan', 'eng']);
      const second = await recognizeWithin(both, image);
      if ((second.data.confidence ?? 0) > confidence) {
        return { text: second.data.text ?? '', confidence: second.data.confidence ?? 0, words: placed(second.data.blocks) };
      }
    } catch {
      /* the English reading stands */
    }
  }
  return { text, confidence, words: placed(first.data.blocks) };
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
      options.onPage?.(1, 1);
      const { text, confidence, words } = await ocrImage(Buffer.from(bytes), imageSize(bytes));
      if (text.replace(/\s/g, '').length < 12) {
        return { ...empty('No legible text was found in the image — it may be a photograph of the site rather than of a document.'), totalPages: 1 };
      }
      return {
        pages: [text],
        method: 'ocr',
        ocrPages: [1],
        ocrConfidence: Math.round(confidence),
        totalPages: 1,
        truncated: false,
        ...(words?.length ? { layout: [{ page: 1, words }] } : {}),
      };
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
  const layout: PageLayout[] = [];
  let cut = false;
  try {
    for (let n = 1; n <= last; n += 1) {
      options.onPage?.(n, totalPages);
      const page = await doc.getPage(n);
      let text = '';
      let words: LayoutWord[] = [];
      try {
        const content = await page.getTextContent();
        text = pageText(content.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>);
        try {
          const viewport = page.getViewport({ scale: 1 });
          words = textLayerWords(pdfjs, content.items as TextItem[], viewport as unknown as { width: number; height: number; transform: number[] });
        } catch {
          words = [];
        }
      } catch {
        text = '';
      }
      const outOfTime = options.deadline !== undefined && Date.now() > options.deadline;
      if (outOfTime && text.replace(/\s/g, '').length < MIN_TEXT_CHARS) cut = true;
      if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS && ocrPages.length < maxOcrPages && !outOfTime) {
        // No usable text layer: a scan. Read the page image instead.
        try {
          const image = await pageImage(pdfjs, page);
          if (image && image.width * image.height > 40_000) {
            progress(totalPages > 1 ? `Running OCR on page ${n} of ${totalPages}` : 'Running OCR on the scan');
            const { pnm, width, height } = toPnm(image);
            const read = await ocrImage(pnm, { width, height });
            if (read.text.replace(/\s/g, '').length > text.replace(/\s/g, '').length) {
              text = read.text.trim();
              words = read.words ?? [];
              ocrPages.push(n);
              confidences.push(read.confidence);
            }
          }
        } catch {
          /* the page stays as whatever its text layer held */
        }
      }
      pages.push(text);
      if (words.length) layout.push({ page: n, words });
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
      truncated: totalPages > last || cut,
      failure: cut
        ? 'The reading ran out of time before this scan was reached. Ask to read the filed documents again.'
        : 'No legible text was found — the scan may be too faint, or the pages may be drawings.',
    };
  }
  const method = ocrPages.length === 0 ? 'text' : ocrPages.length === pages.filter((p) => p.trim()).length ? 'ocr' : 'mixed';
  return {
    pages,
    method,
    ocrPages,
    ocrConfidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : undefined,
    totalPages,
    truncated: totalPages > last || cut,
    ...(layout.length ? { layout } : {}),
  };
}
