/**
 * The blanks of a Word file, and the same file with values written into them.
 *
 * A .docx is a zip of XML, and the form is in one part of it,
 * `word/document.xml`. That part is read as it is written, tag by tag, and
 * never parsed into a tree and written out again: a value goes back by
 * changing the few characters that are the blank, and everything else in the
 * part, and every other part of the file, goes back byte for byte. That is
 * what keeps the form's fonts, tables, numbering, images and headers as they
 * were sent. No library is used: none the repo depends on edits a Word file
 * in place.
 *
 * Six kinds of blank are told, with no model:
 *
 * - a bracket with words or a gap in it: `[Project name]`, `{{owner}}`, `[____]`;
 * - a run of underscores or dots, named by the words before it;
 * - a line that is a label and a colon with nothing after it;
 * - an empty table cell beside a cell that names it, or under one;
 * - a content control still showing its prompt;
 * - a mail-merge field still showing its own name.
 *
 * Each is kept with its exact place (`TemplatePlace`): which text pieces of
 * the part and which characters of them, which paragraph, or which content
 * control, counted in the order the part writes them. The writer reads the
 * part the same way, so a place found here is the place written there.
 *
 * Only the main part is read. A blank in a header, a footer or a footnote
 * is not found, and goes back as it came.
 */

import { TEMPLATE_LIMITS, type DetectedField, type TemplatePlace } from '@realytica/shared';
import { NotAZip, ZipTooLarge, packed, readZip, unpack, writeZip, type ZipEntry } from './zip';

/**
 * How much of a Word file is opened: its XML parts, as they are once
 * unpacked. A form of thirty pages is a few hundred kilobytes; this stops a
 * file that unpacks to gigabytes, as `workbookMayBeOpened` stops a workbook.
 */
const DOCX_AT_MOST_BYTES = 8 * 1024 * 1024;

/** Blanks found before the reader stops looking: the caller keeps fewer, and says how many there were. */
const FOUND_AT_MOST = TEMPLATE_LIMITS.fields * 5;

const MAIN_PART = 'word/document.xml';

const tooLarge = () => new ZipTooLarge('That Word file is too large to open as a template: its text holds more than 8 MB. Save the form as a file of its own and send that.');

/**
 * Refuses a Word file whose parts unpack to more than may be opened, told by
 * unpacking them here under the limit and not by the sizes the file gives.
 * Returns the file's entries and its main part, unpacked.
 */
export function docxOpened(file: Buffer): { entries: ZipEntry[]; main: ZipEntry; xml: string } {
  let entries: ZipEntry[];
  try {
    entries = readZip(file);
  } catch (err) {
    if (err instanceof ZipTooLarge) throw tooLarge();
    throw new NotAZip('That does not look like a Word document.');
  }
  let room = DOCX_AT_MOST_BYTES;
  let xml: string | undefined;
  let main: ZipEntry | undefined;
  for (const entry of entries) {
    if (!/^word\/.*\.xml$/i.test(entry.name)) continue;
    let bytes: Buffer;
    try {
      bytes = unpack(entry, room);
    } catch {
      throw tooLarge();
    }
    room -= bytes.length;
    if (entry.name === MAIN_PART) {
      main = entry;
      xml = bytes.toString('utf8');
    }
  }
  if (!main || xml === undefined) throw new NotAZip('That does not look like a Word document.');
  return { entries, main, xml };
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Words as XML text: the three characters XML reserves, and nothing XML cannot hold. */
function escapeXml(text: string): string {
  return text
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ==================================================================== */
/* Reading the part                                                      */
/* ==================================================================== */

/** One `<w:t>` of the part: where it sits, and its words. */
interface TextPiece {
  start: number;
  end: number;
  text: string;
}

/** A piece of a paragraph's line: a text piece, or a tab or a break (`t` is -1). */
interface Seg {
  t: number;
  text: string;
  /** Inside a content control, a field or an old-Word fallback: no blank is told across it. */
  locked: boolean;
}

interface Para {
  index: number;
  openStart: number;
  openEnd: number;
  closeStart: number;
  selfClosing: boolean;
  segs: Seg[];
  /** Inside a content control or a fallback: nothing is looked for in it. */
  skip: boolean;
  inCell: boolean;
  heading: boolean;
  table: number;
}

interface Control {
  start: number;
  alias: string;
  tag: string;
  showing?: { start: number; end: number };
  skip: boolean;
  hasChild: boolean;
  inPr: boolean;
  inContent: boolean;
  ts: number[];
  paras: number[];
  text: string;
  contentOpenEnd: number;
  contentCloseStart: number;
  contentSelf?: { start: number; end: number };
  /** The words of the line before it, for a control that sits in one. */
  before: string;
  paragraph: number;
}

interface Cell {
  firstP: number;
  text: string;
  span: number;
  merged: boolean;
  locked: boolean;
}

interface Table {
  n: number;
  rows: Cell[][];
  cell?: Cell;
  skip: boolean;
}

interface Field {
  instr: string;
  phase: 'instr' | 'result';
  ts: number[];
  simple: boolean;
}

interface Scan {
  ts: TextPiece[];
  paras: Para[];
  controls: Control[];
  found: DetectedField[];
}

const TAG =
  /<(\/?)(w:tbl|w:tr|w:tc|w:p|w:sdt|w:sdtPr|w:sdtContent|w:t|w:tab|w:br|w:cr|w:fldSimple|w:fldChar|w:instrText|w:alias|w:tag|w:showingPlcHdr|w:gridSpan|w:vMerge|w:dropDownList|w:picture|w14:checkbox|w:docPartObj|w:docPartList|mc:Fallback|w:pStyle)(?=[\s/>])([^>]*?)(\/?)>/g;

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeXml(m[1]!) : undefined;
};

const LETTERS = /\p{L}{2}/u;

/** A name written without spaces, as a person would read it: `Survey_Number`, `ProjectName`. */
const worded = (name: string): string =>
  name
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

/** The words before a blank as its label: without the list mark before them or the colon after. */
function labelFrom(before: string): string {
  let label = before
    .replace(/\s+/g, ' ')
    .replace(/[\s:=\-–—.([{]+$/u, '')
    .replace(/^[\s,;.)\]}\-–—:]+/u, '')
    .replace(/^(?:\(?\d{1,3}[.)]|[a-zA-Z][.)]|[•*])\s+/, '')
    .trim();
  if (label.length > 80) label = `…${label.slice(label.length - 79).replace(/^\S*\s/, '')}`;
  return label;
}

/** A cell's or a line's words, where they read as a name for something: a few words with letters in them. */
function asLabel(text: string | undefined): string | undefined {
  const label = (text ?? '').replace(/\s+/g, ' ').replace(/\s*[:*]+\s*$/, '').trim();
  return label && label.length <= 120 && LETTERS.test(label) ? label : undefined;
}

function scan(xml: string): Scan {
  const ts: TextPiece[] = [];
  const paras: Para[] = [];
  const controls: Control[] = [];
  const found: Array<DetectedField & { at: number }> = [];
  const paraStack: Para[] = [];
  const controlStack: Control[] = [];
  const tables: Table[] = [];
  const fields: Field[] = [];
  let fallback = 0;
  let tableCount = 0;
  /** The line before the one being read, for a blank that stands alone under its label. */
  let lastText = '';

  const add = (field: DetectedField, at: number): void => {
    if (found.length < FOUND_AT_MOST) found.push({ ...field, at });
  };
  const whereOf = (para: Para | undefined): string => (para ? (para.table ? `Table ${para.table}` : `Paragraph ${para.index + 1}`) : 'Document');
  const lineOf = (para: Para): string => para.segs.map((seg) => seg.text).join('');

  /** The text pieces a stretch of a paragraph's line is written in, or null where it cannot be written back. */
  const placeOf = (para: Para, a: number, b: number): TemplatePlace | null => {
    let pos = 0;
    let t0 = -1;
    let o0 = 0;
    let t1 = -1;
    let o1 = 0;
    let pieces = 0;
    for (const seg of para.segs) {
      const s = pos;
      const e = pos + seg.text.length;
      pos = e;
      if (e <= a || s >= b) continue;
      if (seg.t < 0 || seg.locked) return null;
      if (t0 < 0) {
        t0 = seg.t;
        o0 = a - s;
      }
      t1 = seg.t;
      o1 = Math.min(b, e) - s;
      pieces += 1;
    }
    // Pieces of another paragraph can sit between two of this one's (a text box): then the stretch is not one run of pieces.
    if (t0 < 0 || t1 - t0 !== pieces - 1) return null;
    return { in: 'docx', kind: 'text', t0, o0, t1, o1 };
  };

  const finishPara = (para: Para): void => {
    if (para.skip) return;
    const line = lineOf(para);
    if (!line.trim()) return;
    const context = line.replace(/\s+/g, ' ').trim();
    const blanks: Array<{ a: number; b: number; label?: string; pattern: 'bracket' | 'blank' }> = [];
    for (const m of line.matchAll(/\[([^[\]\t]{0,80})\]|\{\{([^{}\t]{1,80})\}\}|<<([^<>\t]{1,80})>>/g)) {
      const inner = m[1] ?? m[2] ?? m[3] ?? '';
      const gap = /^[_.\s…]*$/.test(inner);
      // "[ ]" is a tick box and "[1]" a footnote: neither is a blank to fill.
      if (gap ? inner.length < 3 : !LETTERS.test(inner)) continue;
      blanks.push({ a: m.index, b: m.index + m[0].length, pattern: 'bracket', ...(gap ? {} : { label: inner.replace(/\s+/g, ' ').trim().replace(/^(?:insert|enter|type|fill in)\s+/i, '') }) });
    }
    for (const m of line.matchAll(/_{3,}|\.{5,}|…{2,}/g)) {
      const a = m.index;
      const b = a + m[0].length;
      if (!blanks.some((taken) => a < taken.b && b > taken.a)) blanks.push({ a, b, pattern: 'blank' });
    }
    blanks.sort((x, y) => x.a - y.a);
    blanks.forEach((blank, n) => {
      const place = placeOf(para, blank.a, blank.b);
      if (!place) return;
      const before = labelFrom(line.slice(n ? blanks[n - 1]!.b : 0, blank.a));
      const after = labelFrom(line.slice(blank.b, blanks[n + 1]?.a ?? line.length).replace(/^\s*\(([^)]*)\)\s*$/, '$1'));
      const above = lastText.length <= 80 ? labelFrom(lastText) : '';
      add({ label: blank.label || before || after || above || 'Blank', pattern: blank.pattern, place, where: whereOf(para), context }, para.openStart + blank.a);
    });
    if (!blanks.length && !para.inCell && !para.heading) {
      // "Name of the owner:" and nothing after it. The value goes at the end of the line's last words.
      const m = /^(.{2,80}?)\s*:\s*$/.exec(line.replace(/\t/g, ' '));
      const last = [...para.segs].reverse().find((seg) => seg.text.trim());
      if (m && LETTERS.test(m[1]!) && last && last.t >= 0 && !last.locked) {
        add({ label: labelFrom(m[1]!), pattern: 'label', place: { in: 'docx', kind: 'text', t0: last.t, o0: last.text.length, t1: last.t, o1: last.text.length }, where: whereOf(para), context }, para.openStart);
      }
    }
    lastText = context;
  };

  const finishControl = (control: Control): void => {
    if (control.skip || control.hasChild || fallback) return;
    // One somebody has already written in is not a blank.
    if (!control.showing && control.text.trim()) return;
    if (!control.ts.length && !control.paras.length && control.contentOpenEnd < 0 && !control.contentSelf) return;
    const prompt = control.text.replace(/\s+/g, ' ').trim();
    const label = control.alias.trim() || worded(control.tag) || labelFrom(control.before) || (prompt && !/^(?:click|tap|choose|enter|type)\b/i.test(prompt) ? prompt : '') || 'Content control';
    add({ label, pattern: 'content_control', place: { in: 'docx', kind: 'control', sdt: controls.indexOf(control) }, where: control.paragraph >= 0 ? whereOf(paras[control.paragraph]) : whereOf(paras[control.paras[0] ?? -1]) }, control.start);
  };

  const finishField = (field: Field, para: Para | undefined): void => {
    const m = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i.exec(field.instr);
    if (!m || !field.ts.length || fallback || controlStack.length) return;
    const first = field.ts[0]!;
    const last = field.ts[field.ts.length - 1]!;
    // A field nobody has merged shows its own name in guillemets. One that shows anything else has been filled.
    const shown = field.ts.map((t) => ts[t]!.text).join('').trim();
    if (shown && !/^«.*»$/.test(shown) && shown !== (m[1] ?? m[2])) return;
    add({ label: worded(m[1] ?? m[2] ?? '') || 'Merge field', pattern: 'merge_field', place: { in: 'docx', kind: 'text', t0: first, o0: 0, t1: last, o1: ts[last]!.text.length }, where: whereOf(para), ...(para ? { context: lineOf(para).replace(/\s+/g, ' ').trim() } : {}) }, ts[first]!.start);
  };

  const finishTable = (table: Table): void => {
    if (table.skip) return;
    const empty = (cell: Cell): boolean => !cell.text.trim() && !cell.locked && !cell.merged && cell.firstP >= 0 && !paras[cell.firstP]!.skip;
    /** The cell of a row that starts at a column, counting the columns a wide cell takes. */
    const cellAt = (row: Cell[] | undefined, column: number): Cell | undefined => {
      let at = 0;
      for (const cell of row ?? []) {
        if (at === column) return cell;
        at += cell.span;
      }
      return undefined;
    };
    table.rows.forEach((row, r) => {
      const empties = row.filter(empty).length;
      let column = 0;
      row.forEach((cell, c) => {
        const at = column;
        column += cell.span;
        if (!empty(cell)) return;
        let named = c - 1;
        while (named >= 0 && !asLabel(row[named]!.text)) named -= 1;
        const rowLabel = named >= 0 ? asLabel(row[named]!.text) : undefined;
        const beside = named === c - 1;
        // The cell above names it; in a grid with a name at the start of each row, the head of the column does.
        const colLabel = r > 0 ? (asLabel(cellAt(table.rows[r - 1], at)?.text) ?? (rowLabel ? asLabel(cellAt(table.rows[0], at)?.text) : undefined)) : undefined;
        const label = rowLabel && colLabel && (!beside || empties >= 2) ? `${rowLabel}: ${colLabel}` : rowLabel && beside ? rowLabel : !rowLabel ? colLabel : undefined;
        if (!label) return;
        add({ label, pattern: 'table_cell', place: { in: 'docx', kind: 'paragraph', p: cell.firstP }, where: `Table ${table.n}, row ${r + 1}` }, paras[cell.firstP]!.openStart);
      });
    });
  };

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml))) {
    const closing = m[1] === '/';
    const name = m[2]!;
    const attrs = m[3] ?? '';
    const self = m[4] === '/';
    const para = paraStack[paraStack.length - 1];
    const control = controlStack[controlStack.length - 1];
    const table = tables[tables.length - 1];

    if (name === 'w:t' && !closing) {
      let piece: TextPiece;
      if (self) piece = { start: m.index, end: TAG.lastIndex, text: '' };
      else {
        const close = xml.indexOf('</w:t>', TAG.lastIndex);
        if (close < 0) break;
        piece = { start: m.index, end: close + 6, text: unescapeXml(xml.slice(TAG.lastIndex, close)) };
        TAG.lastIndex = piece.end;
      }
      const t = ts.push(piece) - 1;
      para?.segs.push({ t, text: piece.text, locked: controlStack.length > 0 || fields.length > 0 || fallback > 0 });
      for (const open of tables) if (open.cell) open.cell.text += piece.text;
      if (control?.inContent) {
        control.ts.push(t);
        control.text += piece.text;
      }
      const field = [...fields].reverse().find((f) => f.phase === 'result');
      field?.ts.push(t);
    } else if (name === 'w:instrText' && !closing && !self) {
      const close = xml.indexOf('</w:instrText>', TAG.lastIndex);
      if (close < 0) break;
      const field = fields[fields.length - 1];
      if (field && field.phase === 'instr') field.instr += unescapeXml(xml.slice(TAG.lastIndex, close));
      TAG.lastIndex = close + 14;
    } else if ((name === 'w:tab' || name === 'w:br' || name === 'w:cr') && !closing) {
      // A tab stop set in a paragraph's properties carries attributes; a tab in the line carries none.
      if (name !== 'w:tab' || !attrs.trim()) para?.segs.push({ t: -1, text: name === 'w:tab' ? '\t' : ' ', locked: false });
    } else if (name === 'w:p') {
      if (closing) {
        const done = paraStack.pop();
        if (done) {
          done.closeStart = m.index;
          finishPara(done);
        }
      } else {
        const made: Para = {
          index: paras.length,
          openStart: m.index,
          openEnd: TAG.lastIndex,
          closeStart: -1,
          selfClosing: self,
          segs: [],
          skip: fallback > 0 || controlStack.some((open) => open.inContent),
          inCell: Boolean(table?.cell),
          heading: false,
          table: table?.n ?? 0,
        };
        paras.push(made);
        if (table?.cell && table.cell.firstP < 0) table.cell.firstP = made.index;
        if (control?.inContent) control.paras.push(made.index);
        if (!self) paraStack.push(made);
      }
    } else if (name === 'w:pStyle') {
      if (para && /^(?:Heading|Title)/i.test(attr(attrs, 'w:val') ?? '')) para.heading = true;
    } else if (name === 'w:fldSimple') {
      if (closing) {
        const field = fields[fields.length - 1];
        if (field?.simple) finishField(fields.pop()!, para);
      } else if (!self) fields.push({ instr: attr(attrs, 'w:instr') ?? '', phase: 'result', ts: [], simple: true });
    } else if (name === 'w:fldChar' && !closing) {
      const kind = attr(attrs, 'w:fldCharType');
      const field = fields[fields.length - 1];
      if (kind === 'begin') fields.push({ instr: '', phase: 'instr', ts: [], simple: false });
      else if (kind === 'separate' && field && !field.simple) field.phase = 'result';
      else if (kind === 'end' && field && !field.simple) finishField(fields.pop()!, para);
    } else if (name === 'w:sdt') {
      if (closing) {
        const done = controlStack.pop();
        if (done) finishControl(done);
      } else if (!self) {
        if (control) control.hasChild = true;
        for (const open of tables) if (open.cell) open.cell.locked = true;
        const made: Control = { start: m.index, alias: '', tag: '', skip: false, hasChild: false, inPr: false, inContent: false, ts: [], paras: [], text: '', contentOpenEnd: -1, contentCloseStart: -1, before: para ? para.segs.map((seg) => seg.text).join('') : '', paragraph: para?.index ?? -1 };
        controls.push(made);
        controlStack.push(made);
      }
    } else if (name === 'w:sdtPr') {
      if (control && !self) control.inPr = !closing;
    } else if (name === 'w:sdtContent') {
      if (!control) continue;
      if (closing) {
        control.contentCloseStart = m.index;
        control.inContent = false;
      } else if (self) control.contentSelf = { start: m.index, end: TAG.lastIndex };
      else {
        control.contentOpenEnd = TAG.lastIndex;
        control.inContent = true;
      }
    } else if (control?.inPr && !closing) {
      if (name === 'w:alias') control.alias = attr(attrs, 'w:val') ?? '';
      else if (name === 'w:tag') control.tag = attr(attrs, 'w:val') ?? '';
      else if (name === 'w:showingPlcHdr') {
        if (!/w:val="(?:0|false)"/.test(attrs)) control.showing = { start: m.index, end: TAG.lastIndex };
      } else if (name === 'w:dropDownList' || name === 'w:picture' || name === 'w14:checkbox' || name === 'w:docPartObj' || name === 'w:docPartList') control.skip = true;
    } else if (name === 'w:tbl') {
      if (closing) {
        const done = tables.pop();
        if (done) finishTable(done);
      } else if (!self) {
        // A cell that holds a table is not an empty cell.
        if (table?.cell) table.cell.locked = true;
        tableCount += 1;
        tables.push({ n: tableCount, rows: [], skip: fallback > 0 });
      }
    } else if (name === 'w:tr') {
      if (table && !closing && !self) table.rows.push([]);
    } else if (name === 'w:tc') {
      if (!table) continue;
      if (closing) table.cell = undefined;
      else if (!self) {
        table.cell = { firstP: -1, text: '', span: 1, merged: false, locked: false };
        table.rows[table.rows.length - 1]?.push(table.cell);
      }
    } else if (name === 'w:gridSpan') {
      if (table?.cell) table.cell.span = Math.max(1, Math.min(63, Number(attr(attrs, 'w:val')) || 1));
    } else if (name === 'w:vMerge') {
      // The lower cells of one merged down a column are not cells of their own.
      if (table?.cell && attr(attrs, 'w:val') !== 'restart') table.cell.merged = true;
    } else if (name === 'mc:Fallback') {
      if (!self) fallback = Math.max(0, fallback + (closing ? -1 : 1));
    }
  }
  found.sort((x, y) => x.at - y.at);
  return { ts, paras, controls, found: found.map(({ at: _at, ...field }) => field) };
}

/** Every blank of a Word file, in the order the file writes them. */
export function detectDocxFields(file: Buffer): DetectedField[] {
  return scan(docxOpened(file).xml).found;
}

/* ==================================================================== */
/* Writing values back                                                   */
/* ==================================================================== */

const NOT_THERE = 'A blank of this template is not in the file as it was sent. Upload the file again.';

/**
 * The same Word file with each value written into its blank.
 *
 * A value in a run of underscores, a bracket or a field takes the place of
 * those characters, in the text piece that held them, so it carries that
 * piece's own font and underline. A value in an empty table cell or an empty
 * content control is a new run in the paragraph that was there, with the
 * paragraph's own run formatting. A content control stops showing its
 * prompt. Nothing else in the part is touched, and every other part goes
 * back as it came.
 */
export function fillDocx(file: Buffer, values: ReadonlyArray<{ place: TemplatePlace; value: string }>): Buffer {
  const { entries, main, xml } = docxOpened(file);
  const { ts, paras, controls } = scan(xml);
  const splices: Array<{ start: number; end: number; text: string }> = [];
  const edits = new Map<number, Array<{ from: number; to: number; text: string }>>();
  const edit = (t: number, from: number, to: number, text: string): void => {
    const piece = ts[t];
    if (!piece || from < 0 || to < from || to > piece.text.length) throw new Error(NOT_THERE);
    edits.set(t, [...(edits.get(t) ?? []), { from, to, text }]);
  };
  const run = (para: Para, value: string): string => {
    const props = para.selfClosing ? null : /^\s*<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml.slice(para.openEnd, para.closeStart));
    const marks = props ? /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(props[1]!) : null;
    const rPr = marks ? `<w:rPr>${marks[1]!.replace(/<w:rStyle w:val="PlaceholderText"\s*\/>/g, '')}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
  };
  const runInto = (para: Para | undefined, value: string): void => {
    if (!para) throw new Error(NOT_THERE);
    if (para.selfClosing) splices.push({ start: para.openStart, end: para.openEnd, text: `${xml.slice(para.openStart, para.openEnd).replace(/\/>$/, '>')}${run(para, value)}</w:p>` });
    else splices.push({ start: para.closeStart, end: para.closeStart, text: run(para, value) });
  };

  for (const { place, value: raw } of values) {
    if (place.in !== 'docx') throw new Error(NOT_THERE);
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (place.kind === 'text') {
      const first = ts[place.t0];
      if (!first || !ts[place.t1] || place.t1 < place.t0) throw new Error(NOT_THERE);
      if (place.t0 === place.t1) {
        // Written after a label's own words, it is set off from them by a space.
        const added = place.o0 === place.o1 && place.o0 > 0 && !/\s$/.test(first.text.slice(0, place.o0));
        edit(place.t0, place.o0, place.o1, added ? ` ${value}` : value);
      } else {
        edit(place.t0, place.o0, first.text.length, value);
        for (let t = place.t0 + 1; t < place.t1; t += 1) edit(t, 0, ts[t]!.text.length, '');
        edit(place.t1, 0, place.o1, '');
      }
    } else if (place.kind === 'paragraph') {
      runInto(paras[place.p], value);
    } else {
      const control = controls[place.sdt];
      if (!control) throw new Error(NOT_THERE);
      if (control.showing) splices.push({ ...control.showing, text: '' });
      // The grey of a prompt is a style on its run: the value is not a prompt.
      if (control.contentOpenEnd >= 0 && control.contentCloseStart >= 0) {
        for (const m of xml.slice(control.contentOpenEnd, control.contentCloseStart).matchAll(/<w:rStyle w:val="PlaceholderText"\s*\/>/g)) {
          splices.push({ start: control.contentOpenEnd + m.index, end: control.contentOpenEnd + m.index + m[0].length, text: '' });
        }
      }
      if (control.ts.length) control.ts.forEach((t, n) => edit(t, 0, ts[t]!.text.length, n ? '' : value));
      else if (control.paras.length) runInto(paras[control.paras[0]!], value);
      else if (control.contentSelf) splices.push({ ...control.contentSelf, text: `<w:sdtContent><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:sdtContent>` });
      else if (control.contentCloseStart >= 0) splices.push({ start: control.contentCloseStart, end: control.contentCloseStart, text: `<w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>` });
      else throw new Error(NOT_THERE);
    }
  }

  for (const [t, changes] of edits) {
    const piece = ts[t]!;
    let text = piece.text;
    for (const change of [...changes].sort((x, y) => y.from - x.from)) text = `${text.slice(0, change.from)}${change.text}${text.slice(change.to)}`;
    splices.push({ start: piece.start, end: piece.end, text: `<w:t xml:space="preserve">${escapeXml(text)}</w:t>` });
  }
  splices.sort((x, y) => y.start - x.start || y.end - x.end);
  let out = xml;
  let before = Number.POSITIVE_INFINITY;
  for (const splice of splices) {
    // Two values for one place would write over each other.
    if (splice.end > before) throw new Error(NOT_THERE);
    out = `${out.slice(0, splice.start)}${splice.text}${out.slice(splice.end)}`;
    before = splice.start;
  }
  return writeZip(entries.map((entry) => (entry === main ? packed(entry.name, Buffer.from(out, 'utf8'), entry) : entry)));
}
