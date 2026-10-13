/**
 * Reading a cost table as a cost consultant lays it out.
 *
 * A consultant's monthly cost report is one table: a row for each package
 * under a heading for its section, a sub-total under each section, a
 * contingency and the consultant's own fee, a total, GST and a grand total.
 * Its columns are named in the consultant's words ("Packages", "Awarded
 * value", "Awarded to", "Anticipated final cost", "Amount certified", "Cost
 * per sq ft"), a cell with nothing in it is written "-", and the heading row
 * is not always there.
 *
 * This reads such a table, from a paste or a sheet (`readCostSheet`) and from
 * the words of a page of the report itself (`readCostPage`), into the
 * ledger's own columns. It says what it made of every line: the rows it
 * takes, the lines it read as a heading, a sub-total, a total, GST or a grand
 * total (never a package), and whether the rows it takes add up, to the
 * rupee, to the total the table states. Nothing here writes anything: the
 * result is a preview a person confirms, or rows offered for a person to
 * accept.
 *
 * It states only what the table states. A figure it cannot place in a column
 * is left out and the line is said to be unplaced, never guessed into one.
 */

/** The columns of the ledger that hold an amount. */
export type CostMoneyColumn = 'budget' | 'awarded' | 'certified' | 'paid' | 'anticipated' | 'variations';
export type CostColumn = CostMoneyColumn | 'code' | 'name' | 'description' | 'awardedTo' | 'perArea';

export const COST_MONEY_COLUMNS: readonly CostMoneyColumn[] = ['budget', 'awarded', 'certified', 'paid', 'anticipated', 'variations'];

/**
 * The ledger's own columns, by key, as a reader that is not these rules is
 * handed them: it may answer in these keys and no others.
 */
export const COST_LEDGER_COLUMNS: ReadonlyArray<{ key: Exclude<CostColumn, 'code' | 'description' | 'perArea'>; label: string; holds: 'words' | 'rupees' }> = [
  { key: 'name', label: 'Package', holds: 'words' },
  { key: 'budget', label: 'Budget', holds: 'rupees' },
  { key: 'awarded', label: 'Awarded or PO value', holds: 'rupees' },
  { key: 'awardedTo', label: 'Awarded to', holds: 'words' },
  { key: 'certified', label: 'Certified to date', holds: 'rupees' },
  { key: 'paid', label: 'Paid to date', holds: 'rupees' },
  { key: 'anticipated', label: 'Anticipated final cost', holds: 'rupees' },
  { key: 'variations', label: 'Variations', holds: 'rupees' },
];

export const COST_COLUMN_LABEL: Record<CostColumn, string> = {
  code: 'Number',
  name: 'Package',
  description: 'Description',
  budget: 'Budget',
  awarded: 'Awarded or PO value',
  awardedTo: 'Awarded to',
  certified: 'Certified to date',
  paid: 'Paid to date',
  anticipated: 'Anticipated final cost',
  variations: 'Variations',
  perArea: 'Cost per unit area',
};

/** What a package row is, where it is not a work package: money set aside, or the consultant's own fee. */
export type CostRowKind = 'contingency' | 'fee';

/** What a line of the table is, where it is no package. */
export type CostLineKind = 'heading' | 'sub_total' | 'total' | 'gst' | 'grand_total';

export const COST_LINE_SAID: Record<CostLineKind, string> = {
  heading: 'a heading: it states no figure',
  sub_total: 'a sub-total of the rows above it',
  total: 'the table’s total',
  gst: 'GST on the total',
  grand_total: 'the grand total, with GST',
};

export type CostFigures = Partial<Record<CostMoneyColumn, number>>;

/** One package row as the table states it. */
export interface CostTableRow extends CostFigures {
  /** 1-based line of the table it was read from. */
  line: number;
  /** The line as the table writes it. */
  quote: string;
  code?: string;
  name: string;
  awardedTo?: string;
  kind?: CostRowKind;
  /** The table's own cost per unit area for the row, where it states one. Read, never kept: the ledger works its own out. */
  perArea?: number;
  /** Its figures could not be put in their columns, so none is given: the line is there to be typed from. */
  unplaced?: true;
  /** What on the line could not be read as it should, each in a sentence. */
  problems?: string[];
}

/** A line that is no package, with what it is and what it states. */
export interface CostTableLine {
  line: number;
  quote: string;
  as: CostLineKind;
  label: string;
  figures: CostFigures;
  /** On a GST line: the rate it names, in percent. */
  ratePct?: number;
}

/** One column held to the total the table states for it. */
export interface CostTableCheck {
  column: CostMoneyColumn;
  /** The rows taken, added up. */
  taken: number;
  /** The table's own total for the column, before GST. */
  stated: number;
  /** `taken` less `stated`: nought where the rows add up. */
  difference: number;
}

export interface CostTableRead {
  /** The columns found, in the table's order. */
  columns: CostColumn[];
  /** `found`: a row of the table names its columns. `assumed`: none does, and they were taken in the usual order. */
  header: 'found' | 'assumed';
  rows: CostTableRow[];
  /** The lines read as something other than a package, in order. */
  lines: CostTableLine[];
  /** Each column the table states a total for, held to it. Empty where the table states none. */
  checks: CostTableCheck[];
  /** Whether every column adds up to the stated total, to the rupee. Null where the table states no total. */
  addsUp: boolean | null;
  /** What the table states under its rows. */
  stated: { total?: CostFigures; gst?: CostFigures & { ratePct?: number }; grandTotal?: CostFigures };
}

function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

const added = (amounts: readonly number[]): number => amounts.reduce((paise, amount) => paise + inPaise(amount), 0) / 100;

const UNIT: Record<string, number> = { cr: 1e7, crore: 1e7, crores: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5 };

/**
 * An amount as a table writes it: `4,38,75,000`, `₹ 4.2 Cr`, `(12,000)`.
 * Undefined where the cell holds no amount at all (blank, "-", "nil"), and
 * null where it holds something that is not one.
 */
export function costAmount(raw: string | undefined): number | undefined | null {
  const text = (raw ?? '').replace(/[ \s]+/g, ' ').trim();
  if (!text || /^(?:[-–—]+|nil|n\/?a|na|tbc|tba)$/i.test(text)) return undefined;
  const negative = /^\(.*\)$/.test(text) || /^[-–—]/.test(text);
  const bare = text.replace(/^[(\-–—]+|\)$/g, '').replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\/-$/, '').trim();
  const said = /^(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([a-z]+)?\.?$/i.exec(bare);
  if (!said) return null;
  const unit = said[2] ? UNIT[said[2].toLowerCase()] : 1;
  if (unit === undefined) return null;
  const amount = Number(said[1]!.replace(/,/g, '')) * unit;
  if (!Number.isFinite(amount)) return null;
  return (negative ? -1 : 1) * (inPaise(amount) / 100);
}

/* ==================================================================== */
/* What a heading names                                                  */
/* ==================================================================== */

const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The column a heading cell names, or none. */
export function costColumnOf(heading: string): CostColumn | undefined {
  const said = plain(heading);
  if (!said) return undefined;
  if (/persq|persft|psf$|perunitarea|costpers/.test(said)) return 'perArea';
  if (/anticipat|forecast|finalcost|^eac$/.test(said)) return 'anticipated';
  if (/certif|workdone/.test(said)) return 'certified';
  if (/^awardedto|contractor|vendor|agency|awardee/.test(said)) return 'awardedTo';
  if (/award|^po$|poissued|povalue|commit|contractvalue|ordervalue|^orders$/.test(said)) return 'awarded';
  if (/paid|payment/.test(said)) return 'paid';
  if (/variation/.test(said)) return 'variations';
  if (/budget|approved|sanction/.test(said)) return 'budget';
  if (/^(?:sl|slno|sno|srno|no|code|ref|refno|itemno|item)$/.test(said)) return 'code';
  if (/^(?:packages?|workpackages?|name|particulars|trade|head|costhead|scope)/.test(said)) return 'name';
  if (/descri/.test(said)) return 'description';
  return undefined;
}

const isMoney = (column: CostColumn | undefined): column is CostMoneyColumn => COST_MONEY_COLUMNS.includes(column as CostMoneyColumn);

/* ==================================================================== */
/* What a line is                                                        */
/* ==================================================================== */

/** What a line's own words say it is, where they say it is no package. */
function lineKind(label: string): Exclude<CostLineKind, 'heading'> | undefined {
  const said = label.replace(/\s+/g, ' ').trim();
  if (/^sub[\s-]*totals?\b/i.test(said)) return 'sub_total';
  if (/^grand\s+total\b/i.test(said) || /^total\b.*\b(?:incl|with|including)\b.*\b(?:gst|tax)/i.test(said)) return 'grand_total';
  if (/^(?:add\s*:?\s*)?(?:gst|g\.s\.t\.?|igst|cgst|sgst)\b/i.test(said) || /^(?:taxes?|gst)\s*(?:@|at)\b/i.test(said)) return 'gst';
  if (/^(?:net\s+|gross\s+|overall\s+|project\s+)?totals?\b/i.test(said)) return 'total';
  return undefined;
}

/** A contingency or a fee, by the row's own name; undefined for a work package. */
export function costRowKind(name: string): CostRowKind | undefined {
  if (/contingenc/i.test(name)) return 'contingency';
  if (/\bfees?\b|\bconsultan(?:cy|t|ts)\b|\bprofessional\s+charges\b|\bpmc\b/i.test(name)) return 'fee';
  return undefined;
}

interface Line {
  line: number;
  quote: string;
  /** One cell for each entry of the layout. */
  cells: string[];
  unplaced?: true;
}

/** The lines of a table, each cell under a known column, read into rows and what is not a row. */
function readLines(layout: ReadonlyArray<CostColumn | undefined>, lines: readonly Line[], header: 'found' | 'assumed'): CostTableRead {
  const at = (column: CostColumn): number => layout.indexOf(column);
  const columns = layout.filter((column): column is CostColumn => column !== undefined);
  const rows: CostTableRow[] = [];
  const others: CostTableLine[] = [];
  for (const { line, quote, cells, unplaced } of lines) {
    const cell = (column: CostColumn): string => (at(column) >= 0 ? (cells[at(column)] ?? '').replace(/\s+/g, ' ').trim() : '');
    const code = cell('code');
    // A line's words: its package, else its description, else whatever it writes that is not a figure.
    const name = cell('name') || cell('description');
    const label = name || code || cells.map((text) => text.trim()).find((text) => text && costAmount(text) === null) || '';
    if (!label && cells.every((text) => costAmount(text) === undefined)) continue;
    const figures: CostFigures = {};
    const problems: string[] = [];
    let awardedTo = /^(?:[-–—]+)?$/.test(cell('awardedTo')) ? '' : cell('awardedTo');
    for (const column of COST_MONEY_COLUMNS) {
      if (at(column) < 0) continue;
      const amount = costAmount(cell(column));
      if (amount === undefined) continue;
      if (amount === null) {
        // Under "Awarded value / Awarded to" a name is who it was awarded to.
        if (column === 'awarded' && !awardedTo && at('awardedTo') < 0) awardedTo = cell(column);
        else problems.push(`“${cell(column)}” under ${COST_COLUMN_LABEL[column]} is not an amount.`);
        continue;
      }
      figures[column] = amount;
    }
    const perArea = at('perArea') >= 0 ? costAmount(cell('perArea')) : undefined;
    const said = lineKind([code, name].filter(Boolean).join(' ')) ?? lineKind(label);
    if (said) {
      const rate = said === 'gst' ? /(\d{1,2}(?:\.\d+)?)\s*%/.exec(quote) : null;
      others.push({ line, quote, as: said, label, figures, ...(rate ? { ratePct: Number(rate[1]) } : {}) });
      continue;
    }
    if (!Object.keys(figures).length && !unplaced && !problems.length) {
      if (label) others.push({ line, quote, as: 'heading', label, figures: {} });
      continue;
    }
    if (!name) {
      others.push({ line, quote, as: 'heading', label: label || quote, figures });
      continue;
    }
    const kind = costRowKind(name);
    rows.push({
      line,
      quote,
      ...(code && code !== name ? { code } : {}),
      name,
      ...(awardedTo ? { awardedTo } : {}),
      ...figures,
      ...(kind ? { kind } : {}),
      ...(typeof perArea === 'number' ? { perArea } : {}),
      ...(unplaced ? { unplaced } : {}),
      ...(problems.length ? { problems } : {}),
    });
  }

  const last = (as: CostLineKind): CostTableLine | undefined => others.filter((other) => other.as === as).at(-1);
  const total = last('total');
  const gst = last('gst');
  const grand = last('grand_total');
  /** The table's own total before GST for a column: stated outright, or the grand total less the GST it states. */
  const statedFor = (column: CostMoneyColumn): number | undefined => {
    if (total?.figures[column] !== undefined) return total.figures[column];
    const whole = grand?.figures[column];
    if (whole === undefined) return undefined;
    if (!gst) return whole;
    return gst.figures[column] !== undefined ? added([whole, -gst.figures[column]!]) : undefined;
  };
  const checks: CostTableCheck[] = [];
  for (const column of COST_MONEY_COLUMNS) {
    const stated = statedFor(column);
    if (stated === undefined || !rows.some((row) => row[column] !== undefined)) continue;
    const taken = added(rows.map((row) => row[column] ?? 0));
    checks.push({ column, taken, stated, difference: added([taken, -stated]) });
  }
  return {
    columns,
    header,
    rows,
    lines: others,
    checks,
    addsUp: checks.length ? checks.every((check) => check.difference === 0) : null,
    stated: {
      ...(total ? { total: total.figures } : {}),
      ...(gst ? { gst: { ...gst.figures, ...(gst.ratePct !== undefined ? { ratePct: gst.ratePct } : {}) } } : {}),
      ...(grand ? { grandTotal: grand.figures } : {}),
    },
  };
}

/* ==================================================================== */
/* A paste or a sheet                                                    */
/* ==================================================================== */

/** The cells of pasted or exported rows: tab-separated as a spreadsheet copies them, else comma-separated with quoted cells. */
export function costSheetCells(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.trimEnd());
  const tabbed = lines.some((line) => line.includes('\t'));
  const split = (line: string): string[] => {
    if (tabbed) return line.split('\t').map((cell) => cell.trim());
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  return lines.map(split);
}

/** The usual order of a consultant's figures, for a table that names no columns: by how many columns of figures it has. */
const USUAL_ORDER: Record<number, CostColumn[]> = {
  1: ['budget'],
  2: ['budget', 'anticipated'],
  3: ['budget', 'awarded', 'anticipated'],
  4: ['budget', 'awarded', 'anticipated', 'certified'],
  5: ['budget', 'awarded', 'anticipated', 'certified', 'perArea'],
};

const SERIAL = /^(?:\d{1,3}(?:\.\d{1,2})?[.)]?|[A-Za-z][.)]?|[ivxIVX]{1,4}[.)]?)$/;

/**
 * A cost table from a paste or a sheet, as rows of cells.
 *
 * The row that names the columns is found wherever it is in the first rows.
 * Where no row names them, the columns are taken in the usual order of such a
 * table (`header: 'assumed'`), from the row that holds the most figures.
 * Throws, in a sentence, only where there is nothing to read as a table.
 */
export function readCostSheet(grid: readonly (readonly string[])[]): CostTableRead {
  const rows = grid.map((cells, index) => ({ line: index + 1, cells: cells.map((cell) => String(cell ?? '')) })).filter((row) => row.cells.some((cell) => cell.trim()));
  if (!rows.length) throw new Error('That has no rows.');
  const quoteOf = (cells: readonly string[]): string => cells.map((cell) => cell.trim()).filter(Boolean).join(' ');
  for (const [index, row] of rows.slice(0, 15).entries()) {
    const layout = row.cells.map(costColumnOf);
    // The first cell that names a column keeps it: "Budget" and "Approved budget (revised)" in one row are one column and a note.
    const seen = new Set<CostColumn>();
    const kept = layout.map((column) => (column && !seen.has(column) ? (seen.add(column), column) : undefined));
    const money = kept.filter(isMoney).length;
    if (money >= 2 || (money >= 1 && (seen.has('name') || seen.has('description')))) {
      if (!seen.has('name') && !seen.has('description')) throw new Error('The table needs a column for the package: Packages, Package, Description or Name.');
      const body = rows.slice(index + 1).filter((other) => other.cells.map(costColumnOf).filter(isMoney).length < 2);
      return readLines(kept, body.map((other) => ({ line: other.line, quote: quoteOf(other.cells), cells: other.cells })), 'found');
    }
  }
  // No row names the columns: the row with the most figures says where they are.
  const figuresIn = (cells: readonly string[]): number[] => cells.flatMap((cell, at) => (typeof costAmount(cell) === 'number' && !SERIAL.test(cell.trim()) ? [at] : []));
  const fullest = [...rows].sort((a, b) => figuresIn(b.cells).length - figuresIn(a.cells).length)[0]!;
  const figures = figuresIn(fullest.cells);
  if (!figures.length) throw new Error('No figures were found in that. A cost table has a column for the package and at least one of Budget, Awarded value, Certified, Paid or Anticipated final cost.');
  const order = USUAL_ORDER[Math.min(figures.length, 5)]!;
  const layout: Array<CostColumn | undefined> = fullest.cells.map(() => undefined);
  figures.slice(0, 5).forEach((at, n) => (layout[at] = order[n]));
  const words = fullest.cells.flatMap((cell, at) => (cell.trim() && !figures.includes(at) && costAmount(cell) === null ? [at] : []));
  const nameAt = words.find((at) => at < figures[0]!) ?? words[0];
  if (nameAt === undefined) throw new Error('The table needs a column for the package: Packages, Package, Description or Name.');
  layout[nameAt] = 'name';
  const serialAt = fullest.cells.findIndex((cell, at) => at < nameAt && SERIAL.test(cell.trim()));
  if (serialAt >= 0) layout[serialAt] = 'code';
  const between = words.find((at) => at > figures[0]! && at < figures[figures.length - 1]!);
  if (between !== undefined) layout[between] = 'awardedTo';
  return readLines(layout, rows.map((row) => ({ line: row.line, quote: quoteOf(row.cells), cells: row.cells })), 'assumed');
}

/** A cost table from pasted or exported text. See `readCostSheet`. */
export function readCostText(text: string): CostTableRead {
  if (!text.trim()) throw new Error('That has no rows.');
  const cells = costSheetCells(text);
  // Pasted from a PDF and not from a sheet, a table arrives as lines of words with no cells between them.
  const loose = cells.every((row) => row.length <= 1) || (!text.includes('\t') && /\d,\d{2},\d{3}(?!\d)/.test(text) && !text.includes('"'));
  if (loose) {
    const read = readCostPage(text);
    if (read) return read;
  }
  return readCostSheet(cells);
}

/* ==================================================================== */
/* A page of the report                                                  */
/* ==================================================================== */

/** The headings a page's words may name a column by, the surest first: each is looked for in what the others left. */
const PAGE_HEADINGS: Array<[CostColumn, RegExp]> = [
  ['perArea', /cost\s*(?:per|\/)\s*\S{1,4}\.?\s*f(?:ee|oo)?t\.?|(?:rate\s+)?per\s+sq\.?\s*f(?:ee|oo)?t\.?|\bpsf\b|per\s+sft/i],
  ['anticipated', /anticipated(?:\s+final)?(?:\s+cost)?|forecast(?:\s+final)?(?:\s+cost)?|final\s+cost|\bEAC\b/i],
  ['certified', /(?:amount\s+)?certified(?:\s+to\s+date)?|certified\s+amount|work\s+done(?:\s+to\s+date)?/i],
  ['awardedTo', /awarded\s+to|contractor|vendor|agency/i],
  ['awarded', /awarded(?:\s+value|\s+amount)?|award\s+value|PO\s+(?:issued|value)|committed|contract\s+value/i],
  ['paid', /(?:amount\s+)?paid(?:\s+to\s+date)?|payments?(?:\s+to\s+date)?/i],
  ['variations', /variations?/i],
  ['budget', /(?:approved\s+|sanctioned\s+|revised\s+)?budget/i],
];

/** The columns a line of a page names, in the order it names them: empty for a line that is no heading row. */
function pageHeading(line: string): CostColumn[] {
  let left = line;
  const found: Array<{ column: CostColumn; at: number }> = [];
  for (const [column, pattern] of PAGE_HEADINGS) {
    const said = pattern.exec(left);
    if (!said) continue;
    found.push({ column, at: said.index });
    // Blanked in place, so what follows keeps its position.
    left = `${left.slice(0, said.index)}${' '.repeat(said[0].length)}${left.slice(said.index + said[0].length)}`;
  }
  // A sentence that mentions a budget is no heading row: a heading row is headings and little else.
  const rest = left.replace(/\b(?:sl\.?|no\.?|s\.?no\.?|packages?|description|particulars|item|of|work|rs\.?|inr|in|₹)\b/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (found.filter((heading) => isMoney(heading.column)).length < 2 || rest.split(' ').filter(Boolean).length > 4) return [];
  return found.sort((a, b) => a.at - b.at).map((heading) => heading.column);
}

const FIGURE = /^[(]?(?:₹|Rs\.?)?\d[\d,]*(?:\.\d+)?[)]?$/i;
const DASH = /^[-–—]+$/;

/** When a totals line states fewer figures than the table has columns, the columns such a line states, the surest first. */
const TOTALS_STATE: CostColumn[] = ['budget', 'anticipated', 'perArea', 'awarded', 'certified', 'paid', 'variations'];

/**
 * A cost table from the words of one page of a report, a line of the page to a
 * line of the table: a text layer's words or OCR's. Null where no line of the
 * page names two columns of figures, which is a page with no cost table.
 *
 * A page has no cells, only words in order, so a line's figures are put in
 * columns from its right-hand end: the last figure is the last column's. A
 * package's line whose figures do not fill the columns is given as unplaced,
 * with no figure, for a person to type from. A totals line that states fewer
 * figures states the budget and the anticipated cost first.
 */
export function readCostPage(text: string): CostTableRead | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[| ]+/g, ' ').replace(/\s+/g, ' ').trim());
  // The row that names the most columns: a title above the table ("Budget against anticipated final cost") names two and is not it.
  const headAt = lines.reduce((best, line, at) => (pageHeading(line).length > (best < 0 ? 0 : pageHeading(lines[best]!).length) ? at : best), -1);
  if (headAt < 0) return null;
  const named = pageHeading(lines[headAt]!);
  const layout: CostColumn[] = ['code', 'name', ...named];
  const out: Line[] = [];
  for (let n = headAt + 1; n < lines.length; n += 1) {
    const quote = lines[n]!;
    if (!quote || pageHeading(quote).length) continue;
    const tokens = quote.split(' ');
    const figureAt = (token: string | undefined): boolean => token !== undefined && (FIGURE.test(token) || DASH.test(token));
    /** The line's words before its first figure, and that figure's place. */
    const firstFigure = tokens.findIndex((token, at) => at > 0 && figureAt(token) && (DASH.test(token) || /,|\d{4}/.test(token) || tokens.slice(at).every(figureAt)));
    const lead = (firstFigure < 0 ? tokens : tokens.slice(0, firstFigure)).join(' ');
    const cells: string[] = layout.map(() => '');
    const put = (column: CostColumn, value: string): void => {
      cells[layout.indexOf(column)] = value;
    };
    const head = (words: string[]): void => {
      const serial = words.length > 1 && /^(?:\d{1,3}[.)"'°]?|[A-Z][.)]?)$/.test(words[0]!) ? words[0]! : '';
      put('code', serial.replace(/["'°]$/, ''));
      put('name', (serial ? words.slice(1) : words).join(' '));
    };
    if (firstFigure < 0) {
      head(tokens);
      out.push({ line: n + 1, quote, cells });
      continue;
    }
    // From the right: the last word of the line is the last column's.
    let at = tokens.length - 1;
    let fits = true;
    for (let c = named.length - 1; c >= 0 && fits; c -= 1) {
      const column = named[c]!;
      if (column === 'awardedTo') {
        const words: string[] = [];
        if (DASH.test(tokens[at] ?? '')) at -= 1;
        else while (at >= 1 && !figureAt(tokens[at])) words.unshift(tokens[at--]!);
        put(column, words.join(' '));
      } else if (at >= 1 && figureAt(tokens[at])) put(column, tokens[at--]!);
      else fits = false;
    }
    if (fits && at >= 0 && !tokens.slice(0, at + 1).every((token) => FIGURE.test(token) && /,/.test(token))) {
      head(tokens.slice(0, at + 1));
      out.push({ line: n + 1, quote, cells });
      continue;
    }
    // It does not fill the columns. A totals line states its figures for the columns such a line states; a package's is left to a person.
    const stated = tokens.slice(firstFigure).filter((token) => FIGURE.test(token));
    const short = layout.map(() => '');
    short[layout.indexOf('name')] = lead;
    if (lineKind(lead) && stated.length && stated.length === tokens.length - firstFigure) {
      const wanted = TOTALS_STATE.filter((column) => named.includes(column)).slice(0, stated.length);
      named.filter((column) => wanted.includes(column)).forEach((column, i) => (short[layout.indexOf(column)] = stated[i]!));
      out.push({ line: n + 1, quote, cells: short });
      continue;
    }
    const words = lead.split(' ');
    const serial = words.length > 1 && /^(?:\d{1,3}[.)"'°]?|[A-Z][.)]?)$/.test(words[0]!) ? words[0]! : '';
    short[layout.indexOf('code')] = serial.replace(/["'°]$/, '');
    short[layout.indexOf('name')] = (serial ? words.slice(1) : words).join(' ');
    out.push({ line: n + 1, quote, cells: short, unplaced: true });
  }
  const read = readLines(layout, out, 'found');
  // A page that names columns and has no line under them holds no table: a contents page, a covering letter.
  return read.rows.length || read.lines.some((line) => line.as !== 'heading') ? read : null;
}

/* ==================================================================== */
/* A page of the report, from where its words sit                        */
/* ==================================================================== */

/** One word of a page and where it sits: fractions of the page's width and height from its top left. */
export interface CostPageWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Run {
  text: string;
  x0: number;
  x1: number;
  /** The middle of its height. */
  cy: number;
}

interface VisualLine {
  cy: number;
  runs: Run[];
}

const MONEY_LIKE = /^[(]?(?:₹|Rs\.?)?\d[\d,]*(?:\.\d+)?[)]?$/i;
const moneyLike = (text: string): boolean => MONEY_LIKE.test(text) && (/,/.test(text) || text.replace(/\D/g, '').length >= 4);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

/**
 * The cells of a cost table, from the words of a page and where each sits.
 *
 * A consultant's table is set in cells: a heading wraps over two or three
 * lines, a long package name wraps under its row, and a figure sits at the
 * middle of its cell. Read line by line, such a table gives a heading in
 * pieces and a row whose name and figures are on different lines. Read by
 * position it does not: the columns are the bands of the page that the lines
 * of figures leave white between them, a heading is whatever is written over
 * a band above the first figures, and a line with no figure and no number of
 * its own belongs to the row it sits against.
 *
 * Null where the page has no three lines of figures, or its words name no
 * columns: the page is then read line by line as before.
 */
export function costCellsFromWords(words: readonly CostPageWord[]): string[][] | null {
  const held = words.filter((word) => word.text.trim() && word.w > 0 && word.h > 0);
  if (held.length < 12) return null;
  const height = median(held.map((word) => word.h));
  if (!height) return null;

  // Lines as the eye sees them: words whose middles are at one height.
  const lines: VisualLine[] = [];
  for (const word of [...held].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x)) {
    const cy = word.y + word.h / 2;
    const last = lines.at(-1);
    const run = (): Run => ({ text: word.text, x0: word.x, x1: word.x + word.w, cy });
    if (!last || cy - last.cy > height * 0.35) {
      lines.push({ cy, runs: [run()] });
      continue;
    }
    last.runs.push(run());
  }
  // Words a space apart are one run: a cell's words. A wider gap is the white between two cells.
  for (const line of lines) {
    const sorted = [...line.runs].sort((a, b) => a.x0 - b.x0);
    const merged: Run[] = [];
    for (const run of sorted) {
      const before = merged.at(-1);
      const char = before ? Math.max((before.x1 - before.x0) / Math.max(1, before.text.length), (run.x1 - run.x0) / Math.max(1, run.text.length)) : 0;
      if (before && run.x0 - before.x1 < char * 1.5) {
        before.text = `${before.text} ${run.text}`;
        before.x1 = Math.max(before.x1, run.x1);
      } else merged.push({ ...run });
    }
    line.runs = merged;
  }

  const figured = (line: VisualLine): number => line.runs.filter((run) => moneyLike(run.text)).length;
  const firstAt = lines.findIndex((line) => figured(line) >= 2);
  const lastAt = lines.reduce((last, line, at) => (figured(line) >= 2 ? at : last), -1);
  if (firstAt < 0 || lines.slice(firstAt, lastAt + 1).filter((line) => figured(line) >= 2).length < 3) return null;

  // The columns: what the lines that state figures leave white between them.
  const spans = lines
    .slice(firstAt, lastAt + 1)
    .filter((line) => line.runs.some((run) => moneyLike(run.text)))
    .flatMap((line) => line.runs.map((run) => [run.x0, run.x1] as [number, number]))
    .sort((a, b) => a[0] - b[0]);
  const bands: Array<[number, number]> = [];
  for (const [x0, x1] of spans) {
    const last = bands.at(-1);
    if (last && x0 <= last[1]) last[1] = Math.max(last[1], x1);
    else bands.push([x0, x1]);
  }
  if (bands.length < 3) return null;
  /** The bands a run lies over. */
  const over = (run: Run): number[] => bands.flatMap(([x0, x1], at) => (Math.min(run.x1, x1) - Math.max(run.x0, x0) > 0 ? [at] : []));
  /** The one band a run belongs to: the one it lies over most, else the nearest. */
  const bandOf = (run: Run): number => {
    let best = 0;
    let most = -Infinity;
    bands.forEach(([x0, x1], at) => {
      const shared = Math.min(run.x1, x1) - Math.max(run.x0, x0);
      if (shared > most) [most, best] = [shared, at];
    });
    return best;
  };
  const straddles = (line: VisualLine): boolean => line.runs.some((run) => over(run).length > 1);
  const worded = (line: VisualLine): boolean => !straddles(line) && !line.runs.some((run) => moneyLike(run.text));

  // The heading: the line above the figures that names the most columns, with the lines its cells wrap onto.
  const above = lines.slice(Math.max(0, firstAt - 12), firstAt);
  const offset = firstAt - above.length;
  const names = (line: VisualLine): number => (straddles(line) ? 0 : line.runs.filter((run) => costColumnOf(run.text) !== undefined).length);
  const mainIn = above.reduce((best, line, at) => (names(line) > (best < 0 ? 1 : names(above[best]!)) ? at : best), -1);
  if (mainIn < 0) return null;
  const near = (a: VisualLine, b: VisualLine): boolean => Math.abs(a.cy - b.cy) <= height * 1.8;
  const upTo: number[] = [];
  for (let at = mainIn - 1; at >= 0 && upTo.length < 3 && worded(above[at]!) && near(above[at]!, above[at + 1]!); at -= 1) upTo.push(at);
  const downTo: number[] = [];
  for (let at = mainIn + 1; at < above.length && downTo.length < 3 && worded(above[at]!) && near(above[at]!, above[at - 1]!); at += 1) downTo.push(at);
  const headingOf = (picked: number[]): string[] => {
    const cells = bands.map(() => [] as string[]);
    for (const at of [...picked].sort((a, b) => a - b)) for (const run of above[at]!.runs) cells[bandOf(run)]!.push(run.text);
    return cells.map((parts) => parts.join(' '));
  };
  const namedBy = (cells: string[]): number => new Set(cells.map(costColumnOf).filter((column) => column !== undefined)).size;
  let heading = headingOf([mainIn]);
  let headTo = mainIn;
  for (let up = 0; up <= upTo.length; up += 1) {
    for (let down = 0; down <= downTo.length; down += 1) {
      const cells = headingOf([...upTo.slice(0, up), mainIn, ...downTo.slice(0, down)]);
      // More columns named wins; the same number named by fewer lines stands.
      if (namedBy(cells) > namedBy(heading)) [heading, headTo] = [cells, mainIn + down];
    }
  }
  const layout = heading.map(costColumnOf);
  if (layout.filter(isMoney).length < 2) return null;
  // A band of words left of the figures that no heading names is the package's, where none is named.
  if (!layout.includes('name') && !layout.includes('description')) {
    const firstMoney = layout.findIndex(isMoney);
    const widest = bands.map(([x0, x1], at) => ({ at, width: x1 - x0 })).filter(({ at }) => at < firstMoney && layout[at] === undefined).sort((a, b) => b.width - a.width)[0];
    if (!widest) return null;
    heading[widest.at] = 'Packages';
    layout[widest.at] = 'name';
  }
  const codeAt = layout.indexOf('code');
  const nameAt = layout.indexOf('name') >= 0 ? layout.indexOf('name') : layout.indexOf('description');
  const stated = new Set(layout.flatMap((column, at) => (isMoney(column) || column === 'perArea' ? [at] : [])));

  // The rows: a line that states a figure, a dash under a figure's heading or a number of its own starts one; any other line is a cell's wrapped words and goes with the line it sits against.
  const body = lines.slice(offset + headTo + 1).filter((line, at, all) => {
    const index = offset + headTo + 1 + at;
    if (index <= lastAt) return true;
    // Under the last figures: only the rest of a wrapped cell.
    return worded(line) && near(line, all[at - 1] ?? line) && index - lastAt <= 2;
  });
  const starts = (line: VisualLine): boolean => line.runs.some((run) => (stated.has(bandOf(run)) && (FIGURE.test(run.text) || DASH.test(run.text))) || (codeAt >= 0 && bandOf(run) === codeAt));
  const groups: VisualLine[][] = [];
  const groupOf = new Map<VisualLine, VisualLine[]>();
  for (const line of body) if (starts(line)) { const group = [line]; groups.push(group); groupOf.set(line, group); }
  const reach = height * 1.45;
  for (const line of body) {
    if (groupOf.has(line)) continue;
    // The nearest line already in a row, above or below, within a line's pitch.
    let nearest: VisualLine | undefined;
    for (const other of body) {
      if (!groupOf.has(other) || other === line) continue;
      if (Math.abs(other.cy - line.cy) <= reach && (!nearest || Math.abs(other.cy - line.cy) < Math.abs(nearest.cy - line.cy))) nearest = other;
    }
    // A line in capitals beside a row that already names its package is a heading over a section set close to the rows, not the rest of a wrapped name.
    const capitals = line.runs.every((run) => run.text === run.text.toUpperCase() && /[A-Z]{3}/.test(run.text));
    const named = nearest ? groupOf.get(nearest)!.some((held) => starts(held) && held.runs.some((run) => bandOf(run) === nameAt)) : false;
    if (nearest && !(capitals && named)) {
      const group = groupOf.get(nearest)!;
      group.push(line);
      groupOf.set(line, group);
    } else {
      // A line of its own between the rows: a heading over a section.
      const group = [line];
      groups.push(group);
      groupOf.set(line, group);
    }
  }
  const rows = groups
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.cy - b.cy);
      const cells = bands.map(() => [] as string[]);
      for (const line of sorted) for (const run of [...line.runs].sort((a, b) => a.x0 - b.x0)) cells[bandOf(run)]!.push(run.text);
      return { cy: Math.min(...group.filter(starts).map((line) => line.cy), ...(group.some(starts) ? [] : [sorted[0]!.cy])), cells: cells.map((parts) => parts.join(' ')) };
    })
    .sort((a, b) => a.cy - b.cy);
  return [heading, ...rows.map((row) => row.cells)];
}

/**
 * A cost table from one page's words and where they sit. Null where the
 * page's words cannot be set in columns, which leaves the page to be read
 * line by line.
 */
export function readCostWords(words: readonly CostPageWord[]): CostTableRead | null {
  const cells = costCellsFromWords(words);
  if (!cells) return null;
  try {
    const read = readCostSheet(cells);
    return read.header === 'found' && (read.rows.length || read.lines.some((line) => line.as !== 'heading')) ? read : null;
  } catch {
    return null;
  }
}
