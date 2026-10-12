/**
 * The blanks of a workbook, and the same workbook with values written into
 * them.
 *
 * Read and written with `exceljs`, which the questionnaire's own files
 * already use: a value is set on its cell and the workbook written again,
 * and the cell keeps its number format, font, fill, border and width. The
 * same limit on how much is opened holds as for any workbook
 * (`workbookMayBeOpened`).
 *
 * Three kinds of blank are told, with no model:
 *
 * - an empty cell to the right of a cell that names it ("Survey number" in
 *   B4, nothing in C4). The naming cell is the first words of its row, or
 *   ends in a colon: the second column of a table of words is not a label.
 * - an empty cell under a cell that names it, in a row of column heads: a
 *   row of two names or more with nothing written over them.
 * - an empty cell the workbook itself names (a defined name on one cell).
 *
 * Each is kept as its sheet and its cell.
 */

import { TEMPLATE_LIMITS, type DetectedField, type TemplatePlace } from '@realytica/shared';
import { workbookMayBeOpened } from './questionnaire-file';

const FOUND_AT_MOST = TEMPLATE_LIMITS.fields * 5;

/** How far across and down a sheet is looked at for blanks. A form is a page or two. */
const ROWS_AT_MOST = 2000;
const COLUMNS_AT_MOST = 60;

const LETTERS = /\p{L}{2}/u;

async function opened(buffer: Buffer) {
  workbookMayBeOpened(buffer);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  // exceljs is typed for an older Buffer than this Node's; the bytes are the same.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

function columnName(n: number): string {
  let name = '';
  for (let at = n; at > 0; at = Math.floor((at - 1) / 26)) name = String.fromCharCode(65 + ((at - 1) % 26)) + name;
  return name;
}

function columnNumber(name: string): number {
  return [...name.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

const address = (row: number, column: number): string => `${columnName(column)}${row}`;

/** "B3", "$B$3", or a block "B3:D3" as its two corners. */
function corners(range: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/i.exec(range.trim());
  if (!m) return null;
  const r1 = Number(m[2]);
  const c1 = columnNumber(m[1]!);
  return { r1, c1, r2: m[4] ? Number(m[4]) : r1, c2: m[3] ? columnNumber(m[3]) : c1 };
}

const worded = (name: string): string =>
  name
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

/** Every blank of a workbook, sheet by sheet, row by row. */
export async function detectXlsxFields(buffer: Buffer): Promise<DetectedField[]> {
  const workbook = await opened(buffer);
  const found: Array<DetectedField & { sheetAt: number; row: number; column: number }> = [];
  const taken = new Set<string>();
  const add = (sheetAt: number, sheet: string, row: number, column: number, label: string, pattern: DetectedField['pattern']): void => {
    const at = `${sheetAt}:${row}:${column}`;
    if (taken.has(at) || found.length >= FOUND_AT_MOST) return;
    taken.add(at);
    const cell = address(row, column);
    found.push({ label, pattern, place: { in: 'xlsx', sheet, cell }, where: `${sheet}!${cell}`, sheetAt, row, column });
  };

  /** What each sheet holds: the words of each written cell, which cells are numbers or formulas, and which a merged cell covers. */
  const sheets = workbook.worksheets.map((sheet, sheetAt) => {
    const words = new Map<string, string>();
    const written = new Set<string>();
    const widths = new Map<string, { r2: number; c2: number }>();
    const key = (row: number, column: number) => `${row}:${column}`;
    for (const range of ((sheet.model as { merges?: string[] }).merges ?? []).slice(0, 5000)) {
      const block = corners(range);
      if (!block) continue;
      widths.set(key(block.r1, block.c1), { r2: block.r2, c2: block.c2 });
      for (let r = block.r1; r <= Math.min(block.r2, block.r1 + 200); r += 1) for (let c = block.c1; c <= Math.min(block.c2, block.c1 + COLUMNS_AT_MOST); c += 1) written.add(key(r, c));
    }
    sheet.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > ROWS_AT_MOST) return;
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > COLUMNS_AT_MOST) return;
        const text = String(cell.text ?? '').trim();
        const formula = Boolean((cell.value as { formula?: unknown; sharedFormula?: unknown } | null)?.formula ?? (cell.value as { sharedFormula?: unknown } | null)?.sharedFormula);
        if (!text && !formula) return;
        written.add(key(r, c));
        // The other cells of a merged one repeat its words; only its first cell holds them.
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const value = cell.value;
        const isWords = typeof value === 'string' || (typeof value === 'object' && value !== null && 'richText' in value);
        if (isWords && !formula && text.length <= 120 && LETTERS.test(text)) words.set(key(r, c), text);
      });
    });
    return { sheet, sheetAt, words, written, widths, key };
  });

  // What the workbook names comes first: a named cell is a blank whatever is beside it.
  const names = ((workbook.definedNames as unknown as { model?: Array<{ name: string; ranges: string[] }> }).model ?? []).slice(0, 2000);
  for (const { name, ranges } of names) {
    if (!name || /^_xlnm\b|^_/.test(name) || ranges.length !== 1) continue;
    const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(ranges[0]!);
    const block = m ? corners(m[3]!) : null;
    if (!m || !block) continue;
    const sheetName = (m[1] ?? m[2] ?? '').replace(/''/g, "'");
    const held = sheets.find((s) => s.sheet.name === sheetName);
    if (!held || block.r1 > ROWS_AT_MOST || block.c1 > COLUMNS_AT_MOST) continue;
    // One cell, or the one merged cell the name covers.
    const merged = held.widths.get(held.key(block.r1, block.c1));
    const one = (block.r1 === block.r2 && block.c1 === block.c2) || (merged && merged.r2 === block.r2 && merged.c2 === block.c2);
    if (!one) continue;
    // Written in or not, a cell the workbook names is a place for a value: its words name nothing beside it.
    held.words.delete(held.key(block.r1, block.c1));
    const master = held.sheet.getCell(block.r1, block.c1);
    if (String(master.text ?? '').trim() || (master.value as { formula?: unknown } | null)?.formula) continue;
    add(held.sheetAt, sheetName, block.r1, block.c1, worded(name), 'named_range');
  }

  for (const { sheet, sheetAt, words, written, widths, key } of sheets) {
    const cells = [...words.entries()].map(([at, text]) => {
      const [r, c] = at.split(':').map(Number) as [number, number];
      const wide = widths.get(at);
      return { r, c, r2: wide?.r2 ?? r, c2: wide?.c2 ?? c, text };
    });
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    const label = (text: string): string => text.replace(/\s*[:*]+\s*$/, '').trim();
    const named = new Set<string>();
    for (const cell of cells) {
      // A title is written across the sheet: words merged over three columns or more name no one cell.
      if (cell.c2 - cell.c >= 2) continue;
      const right = cell.c2 + 1;
      if (right > COLUMNS_AT_MOST || written.has(key(cell.r, right))) continue;
      // Words with no words before them, or words that end in a colon. "OPC 53" beside "Cement" is an entry, not a label.
      if (words.has(key(cell.r, cell.c - 1)) && !/:\s*$/.test(cell.text)) continue;
      named.add(key(cell.r, cell.c));
      add(sheetAt, sheet.name, cell.r, right, label(cell.text), 'cell_right');
    }
    for (const cell of cells) {
      if (cell.c2 - cell.c >= 2 || named.has(key(cell.r, cell.c))) continue;
      // A head of a column: one of two or more names in its row, with nothing written over it. The last row of a table of entries is no head.
      if (cells.filter((other) => other.r === cell.r).length < 2 || written.has(key(cell.r - 1, cell.c))) continue;
      const below = cell.r2 + 1;
      if (below > ROWS_AT_MOST || written.has(key(below, cell.c))) continue;
      add(sheetAt, sheet.name, below, cell.c, label(cell.text), 'cell_below');
    }
  }

  found.sort((a, b) => a.sheetAt - b.sheetAt || a.row - b.row || a.column - b.column);
  return found.map(({ sheetAt: _sheetAt, row: _row, column: _column, ...field }) => field);
}

/**
 * The same workbook with each value written into its cell, as words: a
 * value that begins with "=" is written as those characters and is never a
 * formula. The cell keeps the format it had.
 */
export async function fillXlsx(buffer: Buffer, values: ReadonlyArray<{ place: TemplatePlace; value: string }>): Promise<Buffer> {
  const workbook = await opened(buffer);
  for (const { place, value } of values) {
    const sheet = place.in === 'xlsx' ? workbook.getWorksheet(place.sheet) : undefined;
    if (place.in !== 'xlsx' || !sheet || !corners(place.cell)) throw new Error('A blank of this template is not in the file as it was sent. Upload the file again.');
    const text = value.replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '').trim();
    if (text) sheet.getCell(place.cell).value = text;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
