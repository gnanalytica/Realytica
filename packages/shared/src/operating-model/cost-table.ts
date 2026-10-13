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
export type CostLineKind = 'heading' | 'sub_total' | 'total' | 'gst' | 'grand_total' | 'title' | 'columns' | 'empty';

export const COST_LINE_SAID: Record<CostLineKind, string> = {
  heading: 'a heading: it states no figure',
  sub_total: 'a sub-total of the rows above it',
  total: 'a total of the rows above it, before GST',
  gst: 'GST on the total',
  grand_total: 'the total with GST',
  title: 'above the column headings: a title',
  columns: 'the column headings, written again',
  empty: 'dashes only: no words and no figure',
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
  /** Why the line is not believed to be a row of the ledger at all, each in a sentence: such a row is never offered. */
  doubts?: string[];
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

/** One sub-total or total of the table, held to the rows above it. */
export interface CostSectionCheck {
  line: number;
  label: string;
  as: 'sub_total' | 'total';
  /** How many rows it was held to. */
  rows: number;
  checks: CostTableCheck[];
  /** Every column within what rounding each row to the rupee can come to. */
  holds: boolean;
}

/**
 * Whether the rows are what the table says they are: held to its total, or
 * to each sub-total where the total takes in rows of another page.
 *
 * `holds` is null where the table states no total and no sub-total. It allows
 * half a rupee a row, which is the most that rounding every row to the rupee
 * can come to; `rounding` is the largest difference let through, in rupees,
 * and is absent where every sum is exact.
 */
export interface CostTie {
  holds: boolean | null;
  by?: 'total' | 'carried_total' | 'sub_totals';
  rounding?: number;
  /** In a sentence, for the page. */
  said: string;
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
  /** Each sub-total and total of the table, held to the rows above it, in order. */
  sections: CostSectionCheck[];
  /** Whether the rows are held by the table's own totals. */
  tie: CostTie;
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
  // A figure whose groups are parted by a space where a comma stood ("1,27,97 458", as a reader of pictures may give it, or "12 500" as some write it): its groups are closed up where they are groups, the last of three figures and the others of two or three.
  const grouped = /^\d{1,3}(?:[, ]\d{2,3})*[, ]\d{3}(?:\.\d+)?$/.test(bare) ? bare.replace(/ /g, ',') : bare;
  const said = /^(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([a-z]+)?\.?$/i.exec(grouped);
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

/** A heading of a schedule of rates: a rate, a quantity or a unit of measure. */
const RATES_HEADING = /\b(?:rates?|qty|quantity|quantities|uom|unit\s+of\s+measure)\b/i;

/** The column a heading cell names, or none. */
export function costColumnOf(heading: string): CostColumn | undefined {
  const said = plain(heading);
  if (!said) return undefined;
  if (/persq|persft|psf$|perunitarea|costpers/.test(said)) return 'perArea';
  // A rate, a quantity or a unit is a column of a schedule of rates, never of the ledger: "Budget rate" is no budget.
  if (RATES_HEADING.test(heading)) return undefined;
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

/**
 * What a line's own words say it is, where they say it is no package.
 *
 * A consultant letters the sections and writes the letter into the line: "P -
 * Sub Total", "S - Total - (P+Q+R)", "Sub Total - P", "U Total - (R+S+T)". So
 * the words are looked for after a letter or a number
 * and its dash, and a sub-total is one wherever in the line it is written.
 */
function lineKind(label: string): Exclude<CostLineKind, 'heading' | 'title' | 'columns' | 'empty'> | undefined {
  const whole = label.replace(/\s+/g, ' ').trim();
  // "A - ", "F- ", "12. ", "iv) " and a bare letter before the word: the section's mark, not the line's name.
  const said = whole.replace(/^(?:[A-Za-z]|\d{1,2}|[ivxIVX]{1,4})\s*[-–—.:)]\s*/, '').replace(/^[A-Za-z]\s+(?=(?:sub|grand|net|gross|overall|project)?[\s-]*totals?\b)/i, '');
  // Anywhere in the line, save where the line is a sum worked on a sub-total: "Add contingency 5% on Sub Total (D+E)" is a row.
  const sub = /\bsub[\s-]*totals?\b/i.exec(whole);
  const lead = sub ? whole.slice(0, sub.index) : '';
  if (sub && !/%/.test(lead) && !/\b(?:on|of|over|upon|above)\s+(?:the\s+)?$/i.test(lead)) return 'sub_total';
  if (/^grand\s+total\b/i.test(said) || /^total\b.*\b(?:incl|with|including)\b.*\b(?:gst|tax)/i.test(said)) return 'grand_total';
  if (/^(?:add\s*:?\s*)?(?:gst|g\.s\.t\.?|igst|cgst|sgst)\b/i.test(said) || /^(?:taxes?|gst)\s*(?:@|at)\b/i.test(said)) return 'gst';
  if (/^(?:net\s+|gross\s+|overall\s+|project\s+)?totals?\b/i.test(said)) return 'total';
  return undefined;
}

/** What an awarded-to cell says where it names nobody: the package is not awarded yet. */
const NOT_AWARDED = /^(?:[-–—]+|(?:yet\s+)?to\s+be\s+awarded|not\s+(?:yet\s+)?awarded|un[\s-]?awarded|awaited|pending|tbc|tba|nil|n\/?a|na)$/i;

/** Whether an awarded-to cell names a party, and not that there is none yet. */
export function awardedToNamed(cell: string | undefined): string {
  const said = (cell ?? '').replace(/\s+/g, ' ').trim();
  // A name with a rule's stroke or a bracket's scrap in it is a cell a reader of pictures misread: nobody is named rather than a wrong name.
  if (/[|\\{}[\]<>~^_=]/.test(said)) return '';
  return !said || NOT_AWARDED.test(said) ? '' : said;
}

const NAME_WORDS_MOST = 14;
const NAME_CHARS_MOST = 90;

/**
 * Why a line that reads as a row is not believed to be a row of the ledger:
 * its name is a line of the page with its figures in it, or is too long to
 * be a package's, or is no words at all. Empty where it is believable.
 */
export function costRowDoubts(row: Pick<CostTableRow, 'name'>): string[] {
  const name = row.name.replace(/\s+/g, ' ').trim();
  const doubts: string[] = [];
  if (!/\p{L}{2}/u.test(name)) doubts.push('Its name is not words.');
  if (name.split(' ').some((word) => /^[(₹]?(?:rs\.?)?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\)?$/i.test(word) || /^\d{5,}$/.test(word))) doubts.push('Its name has figures in it: the line was not set in its columns.');
  if (name.length > NAME_CHARS_MOST || name.split(' ').length > NAME_WORDS_MOST) doubts.push('Its name is too long to be a package’s.');
  return doubts;
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
  /** Known already to be no row: the column headings written again. */
  as?: 'columns';
}

/** The lines of a table, each cell under a known column, read into rows and what is not a row. */
function readLines(layout: ReadonlyArray<CostColumn | undefined>, lines: readonly Line[], header: 'found' | 'assumed', before: readonly CostTableLine[] = []): CostTableRead {
  const at = (column: CostColumn): number => layout.indexOf(column);
  const columns = layout.filter((column): column is CostColumn => column !== undefined);
  let rows: CostTableRow[] = [];
  const others: CostTableLine[] = [...before];
  for (const { line, quote, cells, unplaced, as } of lines) {
    if (as) {
      others.push({ line, quote, as, label: quote, figures: {} });
      continue;
    }
    const cell = (column: CostColumn): string => (at(column) >= 0 ? (cells[at(column)] ?? '').replace(/\s+/g, ' ').trim() : '');
    const code = cell('code');
    // A line's words: its package, else its description, else whatever it writes that is not a figure.
    const name = cell('name') || cell('description');
    const label = name || code || cells.map((text) => text.trim()).find((text) => text && costAmount(text) === null) || '';
    if (!label && cells.every((text) => costAmount(text) === undefined)) {
      // A line of dashes is said, so every line of the table is accounted for; a blank one is nothing.
      if (cells.some((text) => text.trim())) others.push({ line, quote, as: 'empty', label: quote, figures: {} });
      continue;
    }
    const figures: CostFigures = {};
    const problems: string[] = [];
    let awardedTo = awardedToNamed(cell('awardedTo'));
    for (const column of COST_MONEY_COLUMNS) {
      if (at(column) < 0) continue;
      const amount = costAmount(cell(column));
      if (amount === undefined) continue;
      if (amount === null) {
        // Under "Awarded value / Awarded to" a name is who it was awarded to, and "Yet to be awarded" is nobody.
        if (column === 'awarded' && at('awardedTo') < 0) {
          if (!awardedTo) awardedTo = awardedToNamed(cell(column));
        } else problems.push(`“${cell(column)}” under ${COST_COLUMN_LABEL[column]} is not an amount.`);
        continue;
      }
      figures[column] = amount;
    }
    const perArea = at('perArea') >= 0 ? costAmount(cell('perArea')) : undefined;
    const said = lineKind([code, name].filter(Boolean).join(' ')) ?? lineKind(label);
    if (said) {
      const rate = said === 'gst' ? /(\d{1,2}(?:\.\d+)?)\s*%/.exec(quote) : null;
      // Said with the section's letter where the line leads with one: "P - Sub Total", not "- Sub Total".
      others.push({ line, quote, as: said, label: code && name && code !== name ? `${code} ${name}` : label, figures, ...(rate ? { ratePct: Number(rate[1]) } : {}) });
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
    const doubts = costRowDoubts({ name });
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
      ...(doubts.length ? { doubts } : {}),
    });
  }

  /*
   * Which total is which. A table that states GST states a total above it,
   * before GST, and one below it, with GST, whatever either is called: a
   * consultant writes "Grand Total" over the GST line and "Project outlay"
   * under it. So above the GST line every total is one before GST,
   * and under it a line whose figures are the total and the GST added
   * together is the total with GST, though its words name no total.
   */
  const gstLine = others.filter((other) => other.as === 'gst').at(-1);
  if (gstLine) {
    for (const other of others) {
      if (other.as === 'grand_total' && other.line < gstLine.line) other.as = 'total';
      if (other.as === 'total' && other.line > gstLine.line) other.as = 'grand_total';
    }
    const pre = others.filter((other) => other.as === 'total' && other.line < gstLine.line).at(-1);
    if (pre) {
      const withTax = (row: CostTableRow): boolean => {
        const both = COST_MONEY_COLUMNS.filter((column) => row[column] !== undefined && pre.figures[column] !== undefined && gstLine.figures[column] !== undefined);
        return both.length > 0 && both.every((column) => Math.abs(added([row[column]!, -pre.figures[column]!, -gstLine.figures[column]!])) <= 1);
      };
      for (const row of rows.filter((held) => held.line > gstLine.line && withTax(held))) {
        const figures: CostFigures = {};
        for (const column of COST_MONEY_COLUMNS) if (row[column] !== undefined) figures[column] = row[column]!;
        others.push({ line: row.line, quote: row.quote, as: 'grand_total', label: row.name, figures });
      }
      rows = rows.filter((held) => !(held.line > gstLine.line && withTax(held)));
    }
  }
  others.sort((a, b) => a.line - b.line);

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
  const believed = rows.filter((row) => !row.doubts?.length);
  const checks: CostTableCheck[] = [];
  for (const column of COST_MONEY_COLUMNS) {
    const stated = statedFor(column);
    if (stated === undefined || !believed.some((row) => row[column] !== undefined)) continue;
    const taken = added(believed.map((row) => row[column] ?? 0));
    checks.push({ column, taken, stated, difference: added([taken, -stated]) });
  }
  const read: Omit<CostTableRead, 'sections' | 'tie'> = {
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
  const sections = costSections(read);
  return { ...read, sections, tie: costTableTie({ ...read, sections }) };
}

/** The most that rounding each of `rows` figures to the rupee can put a sum out by, in rupees. */
const roundingFor = (rows: number): number => Math.ceil(rows / 2);

/**
 * Each sub-total and total of a table held to the rows above it: a sub-total
 * to the rows since the line before it that closed a section, a total to
 * every row above it, and a sub-total with no row of its own since the last
 * ("Sub Total - A + B") to every row above it as a total is. Rows that are
 * not believed (`doubts`) are left out of every sum.
 */
export function costSections(read: Pick<CostTableRead, 'rows' | 'lines'>): CostSectionCheck[] {
  const believed = read.rows.filter((row) => !row.doubts?.length);
  const sections: CostSectionCheck[] = [];
  let from = 0;
  for (const line of read.lines) {
    if (line.as !== 'sub_total' && line.as !== 'total') continue;
    const since = believed.filter((row) => row.line > from && row.line < line.line);
    const above = believed.filter((row) => row.line < line.line);
    const held = line.as === 'sub_total' && since.length ? since : above;
    from = line.line;
    const checks: CostTableCheck[] = [];
    for (const column of COST_MONEY_COLUMNS) {
      const stated = line.figures[column];
      // Every figure the line states is held to, whether or not a row above states one in that column: a sub-total of a column whose rows were all lost is not let through for want of rows.
      if (stated === undefined || (stated === 0 && !held.some((row) => row[column] !== undefined))) continue;
      const taken = added(held.map((row) => row[column] ?? 0));
      checks.push({ column, taken, stated, difference: added([taken, -stated]) });
    }
    if (!checks.length || !held.length) continue;
    sections.push({ line: line.line, label: line.label, as: line.as, rows: held.length, checks, holds: checks.every((check) => Math.abs(check.difference) <= roundingFor(held.length)) });
  }
  return sections;
}

/**
 * Whether a table's rows are held by its own totals.
 *
 * They are where every sub-total holds its section and the last total before
 * GST holds every row. A page that carries a table on from the page before
 * states a total its own rows do not come to: `carried` is the total the
 * page before closed on, and the page's total is held to that and its own
 * rows together. With nothing carried, such a page is still held where every
 * one of its rows sits in a section whose sub-total holds, and its total is
 * no less than its rows in any column.
 */
export function costTableTie(read: Pick<CostTableRead, 'rows' | 'lines' | 'checks' | 'sections'>, carried?: CostFigures): CostTie {
  const believed = read.rows.filter((row) => !row.doubts?.length);
  const subs = read.sections.filter((section) => section.as === 'sub_total');
  const totals = read.sections.filter((section) => section.as === 'total');
  const final = totals.at(-1);
  const worst = (sections: readonly CostSectionCheck[]): number => Math.max(0, ...sections.flatMap((section) => section.checks.map((check) => Math.abs(check.difference))));
  const off = (checks: readonly CostTableCheck[]): string =>
    checks
      .filter((check) => check.difference !== 0)
      .map((check) => `${COST_COLUMN_LABEL[check.column]} ${Math.abs(check.difference).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${check.difference > 0 ? 'over' : 'under'}`)
      .join(', ');
  if (!believed.length) return { holds: null, said: 'No row was read.' };
  const failing = subs.find((section) => !section.holds);
  if (failing) return { holds: false, said: `The rows above “${failing.label}” do not add up to it: ${off(failing.checks)}.` };
  const exact = (sections: readonly CostSectionCheck[]): { rounding?: number } => (worst(sections) > 0 ? { rounding: worst(sections) } : {});
  const roundingSaid = (rounding: number | undefined): string => (rounding ? `, to within ₹${rounding.toLocaleString('en-IN')} of rounding` : '');
  if (final) {
    const earlier = totals.slice(0, -1).find((section) => !section.holds);
    if (earlier) return { holds: false, said: `The rows above “${earlier.label}” do not add up to it: ${off(earlier.checks)}.` };
    if (final.holds) {
      const { rounding } = exact([...subs, ...totals]);
      return { holds: true, by: 'total', ...(rounding ? { rounding } : {}), said: `The rows add up to “${final.label}”${roundingSaid(rounding)}.` };
    }
    if (carried) {
      const with_ = final.checks.map((check) => ({ ...check, taken: added([check.taken, carried[check.column] ?? 0]), difference: added([check.taken, carried[check.column] ?? 0, -check.stated]) }));
      if (with_.every((check) => carried[check.column] !== undefined && Math.abs(check.difference) <= roundingFor(final.rows + 1))) {
        const rounding = Math.max(worst(subs), ...with_.map((check) => Math.abs(check.difference)));
        return { holds: true, by: 'carried_total', ...(rounding ? { rounding } : {}), said: `With the total carried from the page before, the rows add up to “${final.label}”${roundingSaid(rounding)}.` };
      }
    }
    const lastSub = subs.at(-1);
    const covered = lastSub !== undefined && believed.every((row) => row.line < lastSub.line);
    if (covered && final.checks.every((check) => check.stated >= check.taken)) {
      const { rounding } = exact(subs);
      return { holds: true, by: 'sub_totals', ...(rounding ? { rounding } : {}), said: `Each section adds up to its sub-total${roundingSaid(rounding)}; “${final.label}” takes in rows that are not on this page.` };
    }
    return { holds: false, said: `The rows do not add up to “${final.label}”: ${off(final.checks)}.` };
  }
  if (subs.length) {
    const lastSub = subs.at(-1)!;
    if (believed.every((row) => row.line < lastSub.line)) {
      const { rounding } = exact(subs);
      return { holds: true, by: 'sub_totals', ...(rounding ? { rounding } : {}), said: `Each section adds up to its sub-total${roundingSaid(rounding)}.` };
    }
    return { holds: false, said: 'Some rows sit under no sub-total, and the table states no total to hold them to.' };
  }
  // No total line of its own: the grand total less the GST it states, as `checks` works it out.
  if (read.checks.length) {
    const holds = read.checks.every((check) => Math.abs(check.difference) <= roundingFor(believed.length));
    const rounding = Math.max(0, ...read.checks.map((check) => Math.abs(check.difference)));
    return holds
      ? { holds, by: 'total', ...(rounding ? { rounding } : {}), said: `The rows add up to the table’s total${roundingSaid(rounding)}.` }
      : { holds, said: `The rows do not add up to the table’s total: ${off(read.checks)}.` };
  }
  return { holds: null, said: 'The table states no total to hold its rows to.' };
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

/** A cell that is an amount as a table writes one: grouped by commas, or of four digits or more. A serial number or a year in a heading is not. */
const statesFigure = (cell: string): boolean => typeof costAmount(cell) === 'number' && (/\d,\d/.test(cell) || cell.replace(/\D/g, '').length >= 4) && !/[a-z]{3}/i.test(cell);

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
    // A row that states a figure is a row of the table, never its headings.
    if (row.cells.some(statesFigure)) continue;
    if (money >= 2 || (money >= 1 && (seen.has('name') || seen.has('description')))) {
      if (!seen.has('name') && !seen.has('description')) throw new Error('The table needs a column for the package: Packages, Package, Description or Name.');
      // The headings written again over a later page are no row. A row that states a figure is never that, whatever its words: "Unawarded" and "Yet to be awarded" are what a row says, not what a column is called.
      const again = (cells: readonly string[]): boolean => cells.map(costColumnOf).filter(isMoney).length >= 2 && !cells.some(statesFigure);
      const above: CostTableLine[] = rows.slice(0, index).map((other) => ({ line: other.line, quote: quoteOf(other.cells), as: 'title' as const, label: quoteOf(other.cells), figures: {} }));
      return readLines(kept, rows.slice(index + 1).map((other) => ({ line: other.line, quote: quoteOf(other.cells), cells: other.cells, ...(again(other.cells) ? { as: 'columns' as const } : {}) })), 'found', above);
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
    const read = readCostPage(text, { listAbove: true });
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
  // A schedule of rates names a budget rate and an amount; it is not the package table.
  if (RATES_HEADING.test(line.replace(PAGE_HEADINGS[0]![1], ' '))) return [];
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
export function readCostPage(text: string, opts: { listAbove?: boolean } = {}): CostTableRead | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[| ]+/g, ' ').replace(/\s+/g, ' ').trim());
  // The row that names the most columns: a title above the table ("Budget against anticipated final cost") names two and is not it.
  const headAt = lines.reduce((best, line, at) => (pageHeading(line).length > (best < 0 ? 0 : pageHeading(lines[best]!).length) ? at : best), -1);
  if (headAt < 0) return null;
  // A schedule of rates sets its headings over two lines: "Anticipated … Certified … Balance" above "Rate, Qty, Amount". It is not the package table.
  if (lines.slice(Math.max(0, headAt - 2), headAt + 4).some((line) => RATES_HEADING.test(line.replace(PAGE_HEADINGS[0]![1], ' ')))) return null;
  const named = pageHeading(lines[headAt]!);
  const layout: CostColumn[] = ['code', 'name', ...named];
  const out: Line[] = [];
  for (let n = headAt + 1; n < lines.length; n += 1) {
    const quote = lines[n]!;
    if (!quote) continue;
    if (pageHeading(quote).length) {
      out.push({ line: n + 1, quote, cells: layout.map(() => ''), as: 'columns' });
      continue;
    }
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
  const above: CostTableLine[] = opts.listAbove ? lines.slice(0, headAt).flatMap((quote, at) => (quote ? [{ line: at + 1, quote, as: 'title' as const, label: quote, figures: {} }] : [])) : [];
  const read = readLines(layout, out, 'found', above);
  // A page that names columns and has no line under them holds no table: a contents page, a covering letter.
  return read.rows.length || read.lines.some((line) => line.as === 'sub_total' || line.as === 'total' || line.as === 'gst' || line.as === 'grand_total') ? read : null;
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
  /** A band figures are written in: two lines of the body or more state one there. */
  const figureBand = bands.map((_, band) => lines.slice(firstAt, lastAt + 1).filter((line) => line.runs.some((run) => bandOf(run) === band && moneyLike(run.text))).length >= 2);
  const wordColumn = (text: string): boolean => ['awardedTo', 'name', 'description', 'code'].includes(costColumnOf(text) ?? '');
  const headingOf = (picked: number[]): string[] => {
    const cells = bands.map(() => [] as string[]);
    for (const at of [...picked].sort((a, b) => a - b)) {
      for (const run of above[at]!.runs) {
        const band = bandOf(run);
        // A column with nothing written in it on this page has no band of its own, and its heading falls on its neighbour's: "Awarded To" over a column of budgets names no figure.
        if (figureBand[band] && wordColumn(run.text) && over(run).length === 0) continue;
        cells[band]!.push(run.text);
      }
    }
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
  /*
   * A cell merged down several rows (one contractor against four packages)
   * is written once, across the rows it spans: its lines sit between the
   * rows and would be shared out among them, half a name to a row. Lines of
   * words that follow one another closer than a row's pitch, in a column
   * that is neither the package's nor a figure's, and that lie against more
   * than one row, are such a cell. It cannot be said which rows it covers,
   * so it is given to none: who a row was awarded to is then typed.
   */
  const rowLines = body.filter(starts).sort((a, b) => a.cy - b.cy);
  /** How far apart the rows are set: the middle of the gaps between one row and the next. */
  const pitch = median(rowLines.slice(1).map((line, at) => line.cy - rowLines[at]!.cy).filter((gap) => gap > 0)) || height * 2.2;
  const nearestRow = (cy: number): VisualLine | undefined => {
    let nearest: VisualLine | undefined;
    for (const other of rowLines) if (Math.abs(other.cy - cy) <= pitch && (!nearest || Math.abs(other.cy - cy) < Math.abs(nearest.cy - cy))) nearest = other;
    return nearest;
  };
  const spanning = new Set<Run>();
  bands.forEach((_, band) => {
    if (band === nameAt || band === codeAt || stated.has(band)) return;
    // Every line of words in this column, down the page. Lines of one cell follow one another closer than rows do.
    const inBand = body.flatMap((line) => line.runs.filter((run) => bandOf(run) === band && !moneyLike(run.text) && !DASH.test(run.text))).sort((a, b) => a.cy - b.cy);
    let chain: Run[] = [];
    const close = (): void => {
      const against = new Set(chain.map((run) => nearestRow(run.cy)).filter((row) => row !== undefined));
      if (chain.length >= 2 && against.size >= 2) for (const run of chain) spanning.add(run);
      chain = [];
    };
    for (const run of inBand) {
      const gap = chain.length ? run.cy - chain.at(-1)!.cy : 0;
      // On the same line as the last (two runs of one line), or the next line of the same cell; a row's pitch away, it is the next row's own cell.
      if (chain.length && gap > pitch * 0.8) close();
      chain.push(run);
    }
    close();
  });
  for (const line of body) line.runs = line.runs.filter((run) => !spanning.has(run));
  for (const line of body) {
    if (groupOf.has(line) || !line.runs.length) continue;
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
      // A cell's words in reading order: its lines down the cell, and along each. Words of one line whose boxes differ in height (a "y" hangs, an "f" does not) are still one line.
      bands.forEach((_, band) => {
        const runs = sorted.flatMap((line) => line.runs.filter((run) => bandOf(run) === band)).sort((a, b) => a.cy - b.cy);
        const worded = (run: Run): boolean => /[\p{L}\p{N}]{2}/u.test(run.text);
        const texts: Run[][] = [];
        for (const run of runs.filter(worded)) {
          const last = texts.at(-1);
          if (last && run.cy - last[0]!.cy <= height * 0.6) last.push(run);
          else texts.push([run]);
        }
        // A dash or an ampersand sits higher or lower than the words either side of it: it goes with the line it is nearest.
        for (const run of runs.filter((held) => !worded(held))) {
          const mid = (text: Run[]): number => text.reduce((sum, held) => sum + held.cy, 0) / text.length;
          const nearest = [...texts].sort((a, b) => Math.abs(mid(a) - run.cy) - Math.abs(mid(b) - run.cy))[0];
          if (nearest) nearest.push(run);
          else texts.push([run]);
        }
        for (const text of texts) for (const run of text.sort((a, b) => a.x0 - b.x0)) cells[band]!.push(run.text);
      });
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
    return read.header === 'found' && (read.rows.length || read.lines.some((line) => line.as === 'sub_total' || line.as === 'total' || line.as === 'gst' || line.as === 'grand_total')) ? read : null;
  } catch {
    return null;
  }
}
