/**
 * Turning a paper's words into the files a reader is handed.
 *
 * One layout, six files:
 *
 *   text    a PDF with a text layer and no picture of the page
 *   clean   an office flatbed scan: square on the glass, sharp, lightly grained
 *   ruled   the clean scan of a page ruled into columns: three rules run the
 *           height of the page beside the writing, as on a register extract
 *           or a printed form. The page is upright. A reader that judges
 *           which way a page lies by its strokes takes it for one fed sideways
 *   poor    a crooked photocopy of a photocopy: a few degrees of skew, blur,
 *           grey text on grey paper, heavy grain, hard JPEG compression, and
 *           a rubber stamp over part of the text
 *   turned  the clean scan with every page fed sideways (90 degrees
 *           clockwise). The pixels are turned; the PDF does not say so
 *   long    the clean scan of the paper at length: its first page, eight
 *           pages of conditions, then its last page
 *
 * A scan is an image-only PDF, one JPEG a page and no text operator in it, so
 * the only way to read it is to look at it. Everything is the same on every
 * run: the grain comes from a seeded generator, so a score that moves is the
 * reader moving and not the renderer having a different day.
 *
 * A poor scan is poor, not illegible. A page nobody can read measures nothing.
 *
 * Fonts are named by file and nothing else is allowed to draw. That matters
 * twice. A font the eval may not redistribute never ends up in a fixture; and
 * a letter no font here has is drawn as an empty box, which an eval then
 * scores the reader for failing to read. So Kannada is rendered only when a
 * font is found that provably draws it (see `drawsLetters`), and a paper may
 * use no character outside the two scripts (see `CHARACTERS`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { conditionsPage, LONG_SCAN_PAGES_BETWEEN, type Paper, type Script } from './papers';

export type Rendering = 'text' | 'clean' | 'ruled' | 'poor' | 'turned' | 'long';
export const RENDERINGS: Rendering[] = ['text', 'clean', 'ruled', 'poor', 'turned', 'long'];

/** Every character a paper may use: printable ASCII and the Kannada block. */
export const CHARACTERS = /^[\x20-\x7E\u0C80-\u0CFF]*$/;

/* -------------------------------------------------------------------- */
/* The drawing library                                                   */
/* -------------------------------------------------------------------- */

/** The few parts of a 2D canvas this file draws with. */
interface Pen {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  filter: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, from: number, to: number): void;
  stroke(): void;
  drawImage(image: Sheet, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}

interface Sheet {
  getContext(kind: '2d'): Pen;
  toBuffer(format: 'image/jpeg', quality: number): Buffer;
}

interface Canvas {
  createCanvas(width: number, height: number): Sheet;
  GlobalFonts: { register(font: Buffer, name: string): unknown };
  PDFDocument: new () => { beginPage(width: number, height: number): Pen; endPage(): void; close(): Buffer };
}

/** pdf.js as the reader has it installed: the Latin font and the canvas both come from there. */
function findPdfjs(): string {
  try {
    return path.dirname(createRequire(path.resolve('apps/api/package.json')).resolve('pdfjs-dist/package.json'));
  } catch {
    throw new Error('pdfjs-dist was not found under apps/api. Run this from the repository root, after `pnpm install`.');
  }
}

const pdfjsRoot = findPdfjs();

/**
 * Nothing in this repository depends on a canvas by name. pdf.js lists
 * `@napi-rs/canvas` as an optional dependency and pnpm installs it beside
 * pdf.js, so it is borrowed from there rather than added.
 */
function loadCanvas(): Canvas {
  try {
    return createRequire(path.join(pdfjsRoot, 'package.json'))('@napi-rs/canvas') as Canvas;
  } catch {
    throw new Error('The drawing library is not installed. It is @napi-rs/canvas, an optional dependency of pdfjs-dist: run `pnpm install` without --no-optional.');
  }
}

const canvas = loadCanvas();

/* -------------------------------------------------------------------- */
/* Fonts                                                                 */
/* -------------------------------------------------------------------- */

const LATIN = 'ReadingEvalLatin';
const LATIN_BOLD = 'ReadingEvalLatinBold';
const KANNADA = 'ReadingEvalKannada';
const KANNADA_BOLD = 'ReadingEvalKannadaBold';

/** A4, in points. */
const PAGE = { w: 595, h: 842 };
const MARGIN = { side: 64, top: 84, bottom: 72 };
const BODY = { font: `12px ${LATIN}, ${KANNADA}`, lead: 20 };
const HEADING = { font: `15px ${LATIN_BOLD}, ${KANNADA_BOLD}`, lead: 26 };

/**
 * Where Noto Sans Kannada is looked for. macOS ships it; on Debian and
 * Ubuntu it comes with `fonts-noto-core`. It is licensed under the SIL Open
 * Font License 1.1, which the file's own name table states. Nothing is
 * downloaded: with no font, the Kannada papers are left out and the run says so.
 */
const KANNADA_FONT_FILES = [
  process.env.READING_EVAL_KANNADA_FONT,
  '/System/Library/Fonts/NotoSansKannada.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf',
];

interface FontUsed {
  script: string;
  family: string;
  licence: string;
  file: string;
  sha256: string;
}

/**
 * One weight out of a font file.
 *
 * macOS ships Noto Sans Kannada as a collection of nine weights, and the
 * canvas registers only the first face of a collection, which is Thin: hair
 * strokes no paper is printed in. So the face wanted is lifted out as a font
 * of its own. A collection is its faces' tables side by side, each face with
 * its own directory, so this copies one directory and the tables it lists.
 */
function faceOf(file: string, weight: 400 | 700): Buffer | null {
  const bytes = readFileSync(file);
  if (bytes.toString('latin1', 0, 4) !== 'ttcf') {
    if (weight === 400) return bytes;
    const bold = file.replace(/-Regular(\.[a-z]+)$/i, '-Bold$1');
    return bold !== file && existsSync(bold) ? readFileSync(bold) : null;
  }
  const faces = bytes.readUInt32BE(8);
  for (let f = 0; f < faces; f += 1) {
    const at = bytes.readUInt32BE(12 + f * 4);
    const count = bytes.readUInt16BE(at + 4);
    const tables = Array.from({ length: count }, (_, t) => {
      const record = at + 12 + t * 16;
      return { record: bytes.subarray(record, record + 8), from: bytes.readUInt32BE(record + 8), length: bytes.readUInt32BE(record + 12) };
    });
    const os2 = tables.find((t) => t.record.toString('latin1', 0, 4) === 'OS/2');
    // The weight class is the third field of the OS/2 table.
    if (!os2 || bytes.readUInt16BE(os2.from + 4) !== weight) continue;
    const directory = Buffer.alloc(12 + count * 16);
    bytes.copy(directory, 0, at, at + 12);
    const bodies: Buffer[] = [];
    let offset = directory.length;
    tables.forEach((table, t) => {
      table.record.copy(directory, 12 + t * 16);
      directory.writeUInt32BE(offset, 12 + t * 16 + 8);
      directory.writeUInt32BE(table.length, 12 + t * 16 + 12);
      // Tables start on four-byte boundaries.
      const body = Buffer.alloc(Math.ceil(table.length / 4) * 4);
      bytes.copy(body, 0, table.from, table.from + table.length);
      bodies.push(body);
      offset += body.length;
    });
    return Buffer.concat([directory, ...bodies]);
  }
  return null;
}

function inked(letter: string, family: string): Uint8Array {
  const sheet = canvas.createCanvas(64, 64);
  const pen = sheet.getContext('2d');
  pen.fillStyle = '#ffffff';
  pen.fillRect(0, 0, 64, 64);
  pen.fillStyle = '#000000';
  pen.font = `44px ${family}`;
  pen.fillText(letter, 6, 48);
  const { data } = pen.getImageData(0, 0, 64, 64);
  return Uint8Array.from({ length: 64 * 64 }, (_, i) => (data[i * 4]! < 128 ? 1 : 0));
}

/**
 * Whether a font draws two letters, or only the box that stands for a
 * missing one.
 *
 * Counting ink does not tell them apart: the box is as dark as a letter. Two
 * different letters are two different shapes, though, and two missing ones
 * are the same box. Measured with this canvas: Kannada ತ and ಮ in Noto Sans
 * Kannada differ over 0.77 of their ink, Latin a and m in Liberation Sans
 * over 0.65, and any two letters a font lacks over 0.00, because the canvas
 * falls back to no other font. The bar sits between.
 */
function drawsLetters(family: string, a: string, b: string): boolean {
  const one = inked(a, family);
  const two = inked(b, family);
  let either = 0;
  let differ = 0;
  for (let i = 0; i < one.length; i += 1) {
    if (one[i] || two[i]) either += 1;
    if (one[i] !== two[i]) differ += 1;
  }
  return either > 0 && differ / either > 0.3;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/**
 * Register the fonts the pages are drawn in. Returns the ones in use, and
 * why Kannada is not among them when it is not.
 */
export function loadFonts(): { fonts: FontUsed[]; kannada: boolean; kannadaMissing?: string } {
  const standard = path.join(pdfjsRoot, 'standard_fonts');
  const regular = readFileSync(path.join(standard, 'LiberationSans-Regular.ttf'));
  canvas.GlobalFonts.register(regular, LATIN);
  canvas.GlobalFonts.register(readFileSync(path.join(standard, 'LiberationSans-Bold.ttf')), LATIN_BOLD);
  if (!drawsLetters(LATIN, 'a', 'm')) throw new Error('Liberation Sans did not register, so no page can be drawn.');
  const fonts: FontUsed[] = [
    { script: 'Latin', family: 'Liberation Sans', licence: 'SIL Open Font License 1.1', file: 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', sha256: sha256(regular) },
  ];

  const file = KANNADA_FONT_FILES.find((candidate) => candidate && existsSync(candidate));
  if (!file) {
    return { fonts, kannada: false, kannadaMissing: 'Noto Sans Kannada was not found on this machine. Install it (Debian and Ubuntu: fonts-noto-core) or set READING_EVAL_KANNADA_FONT to its file.' };
  }
  const face = faceOf(file, 400);
  if (face) {
    canvas.GlobalFonts.register(face, KANNADA);
    canvas.GlobalFonts.register(faceOf(file, 700) ?? face, KANNADA_BOLD);
  }
  if (!face || !drawsLetters(KANNADA, 'ತ', 'ಮ') || !drawsLetters(KANNADA_BOLD, 'ತ', 'ಮ')) {
    return { fonts, kannada: false, kannadaMissing: `${file} does not draw Kannada letters here: two different letters came out as the same shape.` };
  }
  fonts.push({ script: 'Kannada', family: 'Noto Sans Kannada', licence: 'SIL Open Font License 1.1', file, sha256: sha256(face) });
  return { fonts, kannada: true };
}

/* -------------------------------------------------------------------- */
/* Layout                                                                */
/* -------------------------------------------------------------------- */

interface Line {
  text: string;
  x: number;
  /** The baseline, in points from the top of the page. */
  y: number;
  heading: boolean;
}

type Page = Line[];

const ruler = canvas.createCanvas(8, 8).getContext('2d');

/**
 * Lines onto pages, wrapped to the column by measuring them in the font they
 * will be drawn in. Nothing wraps by itself on a canvas: an unwrapped line
 * runs off the right edge and its end is simply not in the picture.
 */
function layout(lines: string[]): Page[] {
  const column = PAGE.w - 2 * MARGIN.side;
  const pages: Page[] = [[]];
  let y = MARGIN.top;
  const place = (text: string, heading: boolean) => {
    const style = heading ? HEADING : BODY;
    ruler.font = style.font;
    const width = ruler.measureText(text).width;
    if (width > column) throw new Error(`A line runs off the page: "${text}"`);
    if (y > PAGE.h - MARGIN.bottom) {
      pages.push([]);
      y = MARGIN.top;
    }
    pages[pages.length - 1]!.push({ text, x: heading ? (PAGE.w - width) / 2 : MARGIN.side, y, heading });
    y += style.lead;
  };
  for (const line of lines) {
    if (line.startsWith('# ')) {
      place(line.slice(2), true);
      continue;
    }
    ruler.font = BODY.font;
    let current = '';
    for (const word of line.split(' ')) {
      const longer = current ? `${current} ${word}` : word;
      if (current && ruler.measureText(longer).width > column) {
        place(current, false);
        current = word;
      } else {
        current = longer;
      }
    }
    place(current, false);
    y += 8;
  }
  return pages;
}

/** The pages of a paper: run together, or at length with the conditions between its two ends. */
function pagesOf(paper: Paper, script: Script, long: boolean): Page[] {
  const { front, back } = paper.text[script]!;
  if (!long) return layout([...front, ...back]);
  const between = Array.from({ length: LONG_SCAN_PAGES_BETWEEN }, (_, n) => {
    const page = layout(conditionsPage(script, n));
    if (page.length !== 1) throw new Error('A page of conditions no longer fits on one page.');
    return page[0]!;
  });
  return [...layout(front), ...between, ...layout(back)];
}

const wordsOn = (page: Page): string => page.map((line) => line.text).join('\n');

/**
 * The paper's own words, page by page and line by line as they are printed:
 * what a perfect reading of any of its files would return.
 */
export function typed(paper: Paper, script: Script, rendering?: Rendering): string[] {
  return pagesOf(paper, script, rendering === 'long').map(wordsOn);
}

/* -------------------------------------------------------------------- */
/* Drawing                                                               */
/* -------------------------------------------------------------------- */

const INK = '#161616';
const PAPER = '#fbfaf6';
/** What shows round a page that is not square on the glass. */
const SCANNER_LID = '#e6e2da';
const STAMP_INK = '#3a2c8c';

function drawPage(pen: Pen, page: Page): void {
  pen.fillStyle = INK;
  for (const line of page) {
    pen.font = (line.heading ? HEADING : BODY).font;
    pen.fillText(line.text, line.x, line.y);
  }
}

/** A rubber stamp, struck at an angle across the upper middle of the page, where the text is. */
function drawStamp(pen: Pen): void {
  pen.save();
  pen.translate(PAGE.w * 0.46, PAGE.h * 0.3);
  pen.rotate((-14 * Math.PI) / 180);
  pen.globalAlpha = 0.6;
  pen.strokeStyle = STAMP_INK;
  pen.fillStyle = STAMP_INK;
  for (const [radius, width] of [[66, 3], [58, 1.2]] as const) {
    pen.lineWidth = width;
    pen.beginPath();
    pen.arc(0, 0, radius, 0, Math.PI * 2);
    pen.stroke();
  }
  pen.font = `15px ${LATIN_BOLD}`;
  for (const [text, y] of [['CERTIFIED', -4], ['TRUE COPY', 18]] as const) pen.fillText(text, -pen.measureText(text).width / 2, y);
  pen.restore();
}

/**
 * Where a ruled page's three column rules stand, as shares of its width: two
 * down the left, closing a narrow column as a register's serial numbers have,
 * and one down the right. None crosses the writing. A rule through a word is
 * a different difficulty (OCR reads the stroke as a letter or a digit), and
 * this rendering is here for one thing: an upright page that looks, by its
 * strokes, as if it lay on its side.
 */
const RULES_AT = [0.035, 0.085, 0.95];
/** In points: a form's printed border. Measured here, rules this heavy outweigh a full page of writing two to one and more, in both scripts. */
const RULE_WIDTH = 2;

/** Column rules, the height of the page, in the ink the page is printed in. */
function drawRules(pen: Pen): void {
  pen.fillStyle = INK;
  for (const share of RULES_AT) pen.fillRect(PAGE.w * share, 0, RULE_WIDTH, PAGE.h);
}

/**
 * A text-layer PDF, written by the canvas's own PDF engine (Skia's, which
 * Chrome also prints through). Its text layer maps each glyph back to one
 * letter. A Latin glyph is one letter; a Kannada conjunct is a glyph with no
 * letter of its own, and comes out of the layer as a NUL.
 */
function textPdf(pages: Page[]): Uint8Array {
  const pdf = new canvas.PDFDocument();
  for (const page of pages) {
    drawPage(pdf.beginPage(PAGE.w, PAGE.h), page);
    pdf.endPage();
  }
  return new Uint8Array(pdf.close());
}

interface Scanner {
  /** Degrees off square. */
  skew: number;
  /** Blur radius, in pixels of the scan. */
  blur: number;
  /** The grey that ink and paper come out as, 0 to 255: close together is low contrast. */
  ink: number;
  paper: number;
  /** Standard deviation of the grain, in grey levels. */
  grain: number;
  jpegQuality: number;
  stamp: boolean;
}

/*
 * The poor scanner is set where reading is hurt and not ended. Grain is the
 * touchy part. At 10 grey levels most of an English page still comes back. At
 * 14, on any page of a dozen lines, OCR takes the grain itself for text,
 * returns a page of it and spends over a minute doing so: every short paper
 * then scores nothing, for one reason, and the number says little else. At 10
 * that happens on one page of the set, the two-line last page of the Kannada
 * sale deed, which is kept as the one page that shows it.
 */
const SCANNERS: Record<'clean' | 'poor', Scanner> = {
  clean: { skew: 0.4, blur: 0.4, ink: 10, paper: 250, grain: 4, jpegQuality: 82, stamp: false },
  poor: { skew: 2.6, blur: 1.3, ink: 85, paper: 205, grain: 10, jpegQuality: 38, stamp: true },
};

export const SCAN_DPI = 200;

/** Scanner grain that is the same on every run, so a page's bytes are too. */
function grainFrom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Four bytes summed are near enough a bell curve, of standard deviation 147.8.
    return ((state & 255) + ((state >>> 8) & 255) + ((state >>> 16) & 255) + (state >>> 24) - 510) / 147.8;
  };
}

/** One page as a scanner would hand it over: a greyscale JPEG. */
function scanPage(page: Page, scanner: Scanner, turned: boolean, seed: string, ruled = false): Buffer {
  const scale = SCAN_DPI / 72;
  const w = Math.round(PAGE.w * scale);
  const h = Math.round(PAGE.h * scale);

  const sheet = canvas.createCanvas(w, h);
  const pen = sheet.getContext('2d');
  pen.fillStyle = PAPER;
  pen.fillRect(0, 0, w, h);
  pen.scale(scale, scale);
  drawPage(pen, page);
  if (ruled) drawRules(pen);
  if (scanner.stamp) drawStamp(pen);

  // On the glass: not quite square, and not quite in focus.
  const glass = canvas.createCanvas(w, h);
  const lens = glass.getContext('2d');
  lens.fillStyle = SCANNER_LID;
  lens.fillRect(0, 0, w, h);
  lens.save();
  lens.filter = `blur(${scanner.blur}px)`;
  lens.translate(w / 2, h / 2);
  lens.rotate((scanner.skew * Math.PI) / 180);
  lens.drawImage(sheet, -w / 2, -h / 2);
  // Back to the picture's own corner before any pixel is written: this canvas
  // moves written pixels by the transform in force, and left as it was it laid
  // a second, shifted copy of the page over the first.
  lens.restore();

  // What the sensor makes of it: grey, with less contrast than the page has, and grain.
  const image = lens.getImageData(0, 0, w, h);
  const grain = grainFrom(seed);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = (0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!) / 255;
    const level = scanner.ink + grey * (scanner.paper - scanner.ink) + grain() * scanner.grain;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = level;
  }
  lens.putImageData(image, 0, 0);
  if (!turned) return glass.toBuffer('image/jpeg', scanner.jpegQuality);

  // Fed sideways: the top of the page is at the right of the picture.
  const sideways = canvas.createCanvas(h, w);
  const turn = sideways.getContext('2d');
  turn.translate(h, 0);
  turn.rotate(Math.PI / 2);
  turn.drawImage(glass, 0, 0);
  return sideways.toBuffer('image/jpeg', scanner.jpegQuality);
}

/** An image-only PDF: each page one picture, edge to edge, and nothing else. */
async function scanPdf(pictures: Buffer[], turned: boolean): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const [w, h] = turned ? [PAGE.h, PAGE.w] : [PAGE.w, PAGE.h];
  for (const picture of pictures) {
    const image = await pdf.embedJpg(picture);
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return pdf.save();
}

/** The file for one paper in one script and one rendering. */
export async function render(paper: Paper, script: Script, rendering: Rendering): Promise<Uint8Array> {
  const pages = pagesOf(paper, script, rendering === 'long');
  if (rendering === 'text') return textPdf(pages);
  const scanner = SCANNERS[rendering === 'poor' ? 'poor' : 'clean'];
  const turned = rendering === 'turned';
  const pictures = pages.map((page, n) => scanPage(page, scanner, turned, `${paper.id}/${script}/${rendering}/${n}`, rendering === 'ruled'));
  return scanPdf(pictures, turned);
}
