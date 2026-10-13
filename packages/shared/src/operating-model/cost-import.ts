/**
 * How a cost table reaches the Cost Report: by a paste a person confirms, or
 * as rows a paper offers and a person accepts.
 *
 * Both go through the one reader (`cost-table.ts`), and neither writes a
 * figure by itself.
 *
 * - **A paste or a sheet** is previewed first (`previewCostReportImport`):
 *   the rows it would take, the lines it read as headings, sub-totals, the
 *   total, GST and the grand total, and whether the rows add up to the
 *   table's own total, to the rupee. `importCostReportRows` writes only what
 *   was previewed, once a person confirms.
 * - **A cost report filed as a paper** has its tables read page by page, from
 *   the words this server got from each page (a text layer, or OCR of a
 *   picture), and each row is offered (`offerCostRowsFromPages`) with its
 *   page and the line as the page writes it. A row counts for nothing until a
 *   lead or signer of Finance accepts it, one at a time or all of a page, and
 *   they may correct a cell first. Where a model read a page instead, it
 *   answers in the ledger's column keys with each figure as the page writes
 *   it (`offerCostRowsFromModel`); a row any figure of which is not among the
 *   words this server read on that page is offered as unverified, and "all of
 *   a page" never takes it.
 */

import type { DdProject } from './types';
import { moneySaid } from './cost';
import { pagesSaid } from './said';
import { addCostReportPackage, assertCostReportDraft, costReportOf, updateCostReportRow, type CostReportPackageRow, type CostReportPeriod } from './cost-report';
import { COST_LEDGER_COLUMNS, COST_MONEY_COLUMNS, costAmount, costRowDoubts, costRowKind, costSections, costTableTie, readCostPage, readCostText, readCostWords, type CostFigures, type CostMoneyColumn, type CostPageWord, type CostRowKind, type CostTableCheck, type CostTableLine, type CostTableRead, type CostTableRow, type CostTie } from './cost-table';
import { recordAuditEvent } from './operations';

export interface CostReportImportRow {
  code?: string;
  name: string;
  budget?: number;
  poIssued?: number;
  amountPaid?: number;
  anticipatedCost?: number;
  certified?: number;
  awardedTo?: string;
  variations?: number;
  kind?: CostRowKind;
}

/** A row of a cost table as the ledger keeps it: awarded is what was ordered, paid what was paid, certified a figure of its own. */
export function costImportRow(row: CostTableRow): CostReportImportRow {
  return {
    name: row.name,
    ...(row.code ? { code: row.code } : {}),
    ...(row.budget !== undefined ? { budget: row.budget } : {}),
    ...(row.awarded !== undefined ? { poIssued: row.awarded } : {}),
    ...(row.paid !== undefined ? { amountPaid: row.paid } : {}),
    ...(row.anticipated !== undefined ? { anticipatedCost: row.anticipated } : {}),
    ...(row.certified !== undefined ? { certified: row.certified } : {}),
    ...(row.awardedTo ? { awardedTo: row.awardedTo } : {}),
    ...(row.variations !== undefined ? { variations: row.variations } : {}),
    ...(row.kind ? { kind: row.kind } : {}),
  };
}

/**
 * The package rows of a cost table in tabular text (CSV, TSV, a pasted
 * sheet), as a consultant lays it out. Throws, in a sentence, where there is
 * no table to read.
 */
export function parseCostReportTable(text: string): CostReportImportRow[] {
  const read = readCostText(text);
  if (!read.rows.length) throw new Error('No package rows were found in that table.');
  return read.rows.map(costImportRow);
}

/** What importing a table would do, said before anything is written. */
export interface CostImportPreview {
  /** The table as it was read: the rows to take, the lines that are no package and why, and the add-up check. */
  read: CostTableRead;
  /** The rows as the ledger would keep them, in the table's order, each with whether it is new to this report. */
  rows: Array<CostReportImportRow & { line: number; quote: string; on: 'add' | 'update'; unplaced?: true; problems?: string[] }>;
  adds: number;
  updates: number;
  /** Lines that read as rows and are not believed to be rows of the ledger, each with why: never taken. */
  notTaken: Array<{ line: number; quote: string; why: string }>;
  /** The ledger's totals as they stand and as they would stand once the rows are written. */
  totals: CostTotalsMoved;
}

/** A ledger's totals before and after rows are written onto it. */
export interface CostTotalsMoved {
  before: { rows: number; budget: number; poIssued: number; amountPaid: number; anticipatedCost: number; certified: number };
  after: { rows: number; budget: number; poIssued: number; amountPaid: number; anticipatedCost: number; certified: number };
}

/** A name as it is matched: without case, runs of spaces or accents, so "Façade" typed and "Facade" read off a picture are one package. */
const folded = (name: string): string => name.normalize('NFD').replace(/\p{M}+/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
const sameName = (a: string, b: string): boolean => folded(a) === folded(b);

/** The row of a report that a table's row is: the one of its name. */
function matchOf(report: CostReportPeriod, row: Pick<CostReportImportRow, 'name'>): CostReportPackageRow | undefined {
  return report.rows.find((held) => sameName(held.name, row.name));
}

/**
 * What a table would do to a draft Cost Report, with nothing done: the rows
 * it would add or update, the lines it read as headings and totals, and
 * whether the rows add up to the table's own total.
 */
export function previewCostReportImport(project: Pick<DdProject, 'costReports'>, reportId: string, text: string): CostImportPreview {
  const report = costReportOf(project, reportId);
  assertCostReportDraft(report);
  const read = readCostText(text);
  const rows = read.rows.filter((row) => !row.doubts?.length).map((row) => ({
    ...costImportRow(row),
    line: row.line,
    quote: row.quote,
    on: matchOf(report, row) ? ('update' as const) : ('add' as const),
    ...(row.unplaced ? { unplaced: row.unplaced } : {}),
    ...(row.problems ? { problems: row.problems } : {}),
  }));
  return {
    read,
    rows,
    adds: rows.filter((row) => row.on === 'add').length,
    updates: rows.filter((row) => row.on === 'update').length,
    notTaken: read.rows.filter((row) => row.doubts?.length).map((row) => ({ line: row.line, quote: row.quote, why: row.doubts!.join(' ') })),
    totals: costTotalsWith(report, rows),
  };
}

/** A report's ledger totals as they stand, and as they would stand with rows written onto it: a row of a name it holds replaces that row's figures, any other is added. */
export function costTotalsWith(report: Pick<CostReportPeriod, 'rows'>, rows: ReadonlyArray<CostReportImportRow>): CostTotalsMoved {
  const sum = (held: ReadonlyArray<{ budget: number; poIssued: number; amountPaid: number; anticipatedCost: number; certified?: number }>): CostTotalsMoved['before'] => ({
    rows: held.length,
    budget: held.reduce((n, row) => n + row.budget, 0),
    poIssued: held.reduce((n, row) => n + row.poIssued, 0),
    amountPaid: held.reduce((n, row) => n + row.amountPaid, 0),
    anticipatedCost: held.reduce((n, row) => n + row.anticipatedCost, 0),
    certified: held.reduce((n, row) => n + (row.certified ?? 0), 0),
  });
  const after = report.rows.map((row) => ({ name: row.name, budget: row.budget, poIssued: row.poIssued, amountPaid: row.amountPaid, anticipatedCost: row.anticipatedCost, certified: row.certified }));
  for (const row of rows) {
    const held = after.find((other) => sameName(other.name, row.name));
    if (held) {
      if (row.budget !== undefined) held.budget = row.budget;
      if (row.poIssued !== undefined) held.poIssued = row.poIssued;
      if (row.amountPaid !== undefined) held.amountPaid = row.amountPaid;
      if (row.anticipatedCost !== undefined) held.anticipatedCost = row.anticipatedCost;
      if (row.certified !== undefined) held.certified = row.certified;
    } else after.push({ name: row.name, budget: row.budget ?? 0, poIssued: row.poIssued ?? 0, amountPaid: row.amountPaid ?? 0, anticipatedCost: row.anticipatedCost ?? row.budget ?? 0, certified: row.certified });
  }
  return { before: sum(report.rows), after: sum(after) };
}

/** How far the rows are from the table's own total, in a sentence, or nothing where they add up or the table states none. */
export function costCheckSaid(read: Pick<CostTableRead, 'addsUp' | 'checks'> & { tie?: CostTie }, currency?: DdProject['currency']): string {
  // Held by its own totals to within what rounding each row to the rupee comes to: nothing is wrong, and the tie says by how much.
  if (read.tie ? read.tie.holds !== false : read.addsUp !== false) return '';
  if (!read.checks.some((check) => check.difference !== 0)) return read.tie?.said ?? '';
  const label = (column: CostMoneyColumn): string => COST_LEDGER_COLUMNS.find((held) => held.key === column)?.label ?? column;
  // To the rupee, so in full: two totals a rupee apart read the same in lakh and crore.
  const full = (amount: number): string => (currency && currency !== 'INR' ? moneySaid(amount, currency) : `${amount < 0 ? '−' : ''}₹${Math.abs(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
  return read.checks
    .filter((check) => check.difference !== 0)
    .map((check) => `${label(check.column)}: the rows come to ${full(check.taken)} and the table’s total is ${full(check.stated)}, ${full(Math.abs(check.difference))} ${check.difference > 0 ? 'over' : 'under'}.`)
    .join(' ');
}

/** Apply imported ledger rows onto a draft Cost Report: a row of a name the report holds is updated, any other is added. */
export function importCostReportRows(
  project: DdProject,
  reportId: string,
  rows: ReadonlyArray<CostReportImportRow>,
  actor: string,
  /** What the table's own total said of the rows, where it states one: kept on the trail with the import. */
  check?: Pick<CostTableRead, 'addsUp' | 'checks'> & { tie?: CostTie },
): { added: number; updated: number } {
  const report = costReportOf(project, reportId);
  assertCostReportDraft(report);
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const more = {
      ...(row.certified !== undefined ? { certified: row.certified } : {}),
      ...(row.awardedTo !== undefined ? { awardedTo: row.awardedTo } : {}),
      ...(row.variations !== undefined ? { variations: row.variations } : {}),
      ...(row.kind !== undefined ? { kind: row.kind } : {}),
    };
    const match = matchOf(report, row);
    if (match) {
      updateCostReportRow(
        project,
        reportId,
        match.id,
        {
          ...(row.code !== undefined ? { code: row.code } : {}),
          name: row.name,
          ...(row.budget !== undefined ? { budget: row.budget } : {}),
          ...(row.poIssued !== undefined ? { poIssued: row.poIssued } : {}),
          ...(row.amountPaid !== undefined ? { amountPaid: row.amountPaid } : {}),
          ...(row.anticipatedCost !== undefined ? { anticipatedCost: row.anticipatedCost } : {}),
          ...more,
        },
        actor,
      );
      updated += 1;
    } else {
      addCostReportPackage(
        project,
        reportId,
        {
          name: row.name,
          ...(row.code ? { code: row.code } : {}),
          budget: row.budget ?? 0,
          poIssued: row.poIssued ?? 0,
          amountPaid: row.amountPaid ?? 0,
          anticipatedCost: row.anticipatedCost ?? row.budget ?? 0,
          ...more,
        },
        actor,
      );
      added += 1;
    }
  }
  const off = check ? costCheckSaid(check, project.currency) : '';
  recordAuditEvent(project, {
    actor,
    action: 'import_cost_report_rows',
    entityType: 'cost_report',
    entityId: reportId,
    newValue: `${added} added, ${updated} updated${off ? `. Imported though the rows do not add up to the table’s total. ${off}` : ''}`,
  });
  return { added, updated };
}

/* ==================================================================== */
/* Rows a paper offers                                                   */
/* ==================================================================== */

/** One row of a cost report filed as a paper, offered to the Cost Report. It counts for nothing until a person accepts it. */
export interface CostRowOffer {
  id: string;
  /** 1-based page of the paper. */
  page: number;
  /** The line of that page's table. */
  line: number;
  /** The line as the page writes it. */
  quote: string;
  /** Whose reading it is: the paper's text layer, OCR of a page that is a picture, or a model. */
  reader: 'text' | 'ocr' | 'model';
  /** For a model's row: every figure was found among the words this server read on that page, or not. */
  proof?: 'page_text' | 'unverified';
  cells: CostReportImportRow;
  /** Its figures could not be put in their columns: a person types them from the page. */
  unplaced?: true;
  problems?: string[];
  status: 'offered' | 'accepted' | 'set_aside';
  decidedBy?: string;
  decidedAt?: string;
  /** Where it went when accepted. */
  reportId?: string;
  rowId?: string;
  /** A cell was corrected before it was accepted. */
  edited?: true;
}

/** One page of a paper that holds a cost table, with what its own totals say of the rows read. */
export interface CostPaperPage {
  page: number;
  reader: CostRowOffer['reader'];
  /** The lines of the page that are no package: headings, sub-totals, the total, GST, the grand total. */
  lines: CostTableLine[];
  checks: CostTableCheck[];
  addsUp: boolean | null;
  stated: CostTableRead['stated'];
  /** Whether the page's rows are held by its own sub-totals and total, and how: what "all of a page" waits on. Absent on a page read before this was kept. */
  tie?: CostTie;
}

/** Why a page that holds a table offered no row. */
export type CostPageDeclinedWhy = 'not_tied' | 'poorly_read' | 'repeats' | 'breakdown';

/** A page of a paper a table was read from whose rows are not offered, with why in a line. */
export interface CostPageDeclined {
  page: number;
  why: CostPageDeclinedWhy;
  /** The page it repeats or breaks down. */
  of?: number;
  said: string;
}

/** A cost report on the register, as its tables were read. */
export interface CostPaper {
  evidenceId: string;
  readAt: string;
  pagesInFile: number;
  /** The pages a cost table was read from. */
  pages: CostPaperPage[];
  /** Pages no table was read from that are pictures, or that nobody got words from: where a table may be that only eyes or a model can read. */
  pictures: number[];
  offers: CostRowOffer[];
  /** Pages a table was read from whose rows are not offered: a picture not read reliably, a page that repeats one already offered, a breakdown of a total already offered. */
  declined?: CostPageDeclined[];
  /** A model was asked to read the tables: when, how many rows it gave that were kept, and why not where it gave none. */
  model?: { at: string; rows: number; failure?: string };
}

/** The share of a page's rows that have to sit cleanly in their columns for its rows to be offered, where the page states no total to hold them to: a clear majority. */
export const COST_ROWS_READ_SHARE = 0.75;
/** The fewest rows such a page has to hold. */
const COST_ROWS_READ_FEWEST = 3;

export function costPapersOf(project: Pick<DdProject, 'costPapers'>): CostPaper[] {
  return project.costPapers ?? [];
}

function newId(): string {
  return `cro_${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function paperFor(project: DdProject, evidenceId: string, pagesInFile: number): CostPaper {
  if (!project.evidence.some((row) => row.id === evidenceId)) throw new Error('That paper is not on this project.');
  project.costPapers ??= [];
  let paper = project.costPapers.find((held) => held.evidenceId === evidenceId);
  if (!paper) {
    paper = { evidenceId, readAt: new Date().toISOString(), pagesInFile, pages: [], pictures: [], offers: [] };
    project.costPapers.push(paper);
  }
  return paper;
}

/** What one reader's offers become when the paper is read again: a row a person decided stays decided, and the rest are as now read. */
function laidOver(paper: CostPaper, reader: ReadonlyArray<CostRowOffer['reader']>, fresh: CostRowOffer[]): void {
  const decided = paper.offers.filter((offer) => offer.status !== 'offered');
  const others = paper.offers.filter((offer) => offer.status === 'offered' && !reader.includes(offer.reader));
  const same = (a: CostRowOffer, b: CostRowOffer): boolean => a.page === b.page && sameName(a.cells.name, b.cells.name);
  paper.offers = [...decided, ...others, ...fresh.filter((offer) => ![...decided, ...others].some((held) => same(held, offer)))].sort((a, b) => a.page - b.page || a.line - b.line);
}

/**
 * The cost table of one page: read from where its words sit where that is
 * known, and line by line otherwise. A table set in cells (a heading over
 * two lines, a name wrapped under its row) reads rightly only by position;
 * a page whose positions give no table, or a worse one, is read by its lines.
 * The reading whose rows add up to the page's own total is the one taken.
 */
function costTableOfPage(page: CostPageRead, carried?: CostFigures): CostTableRead | null {
  const placed = (read: CostTableRead): number => read.rows.filter((row) => !row.unplaced && !row.problems?.length && !row.doubts?.length).length;
  /** Held by its totals, with every row it reads set cleanly in its columns: a reading that holds only because a row it could not read was left out of a sum does not hold. */
  const holds = (read: CostTableRead): boolean | null => {
    const tie = (carried ? costTableTie(read, carried) : read.tie).holds;
    return tie === true && placed(read) < read.rows.filter((row) => !row.doubts?.length).length ? false : tie;
  };
  /** The better of two readings: the one its own totals hold; then the one that adds up to the rupee; then the one with more rows set in their columns. The first stands where they are level. */
  const better = (a: CostTableRead | null, b: CostTableRead | null): CostTableRead | null => {
    if (!a || !b) return a ?? b;
    if (holds(a) !== holds(b)) return holds(a) ? a : holds(b) ? b : placed(a) >= placed(b) ? a : b;
    if (a.addsUp !== b.addsUp) return a.addsUp ? a : b.addsUp ? b : placed(a) >= placed(b) ? a : b;
    return placed(a) >= placed(b) ? a : b;
  };
  // By place before by line, and the page's own reading before the other OCR made of its picture.
  let best: CostTableRead | null = null;
  for (const reading of [page, ...(page.alternates ?? [])]) {
    best = better(best, reading.words?.length ? readCostWords(reading.words) : null);
    best = better(best, readCostPage(reading.text));
  }
  return best;
}

/** One page of a paper as some reader here read it, for the cost table's reader. */
export interface CostPageRead {
  page: number;
  text: string;
  reader: 'text' | 'ocr' | 'model';
  unsure?: boolean;
  picture?: boolean;
  /** Where each word sits, where that is known. */
  words?: readonly CostPageWord[];
  /** Other readings of the same page: OCR of its picture made another way. Each is tried, and the one the page's totals hold is kept. */
  alternates?: ReadonlyArray<{ text: string; words?: readonly CostPageWord[] }>;
}

/** What a page's table closed on: its last total before GST, for the page after it to carry. */
function closedOn(table: CostTableRead): CostFigures | undefined {
  return table.lines.filter((line) => line.as === 'total').at(-1)?.figures ?? table.stated.total;
}

const pictureSaid = (page: number, why: string): string => `Page ${page}: its table is a picture the reader here could not read reliably (${why}). Paste the table below, with the page open beside it.`;

/**
 * Offers the rows of a cost report's tables, read from the words this server
 * got from each page. Nothing is written to any Cost Report.
 *
 * A row is offered only where it is believable as a row of the ledger: a
 * short name with no figure in it, each figure in a column of its own, and
 * not a sub-total, a total, GST or a heading. And the rows of a page that is
 * a picture are offered only where the page as a whole holds: its rows add
 * up to the sub-totals and the total the page itself states (carrying the
 * total of the page before, where the table runs on), or, where it states
 * none, a clear majority of its lines read as rows set in their columns. A
 * page that does not hold is not offered at all, and is said to be a picture
 * that could not be read reliably (`declined`).
 *
 * A page that states again the rows of one already offered offers nothing
 * new, and neither does one whose total is a total already offered under
 * other names: taking both would count the money twice.
 *
 * `pages` are the pages some reader here got words from. A page with no cost
 * table on it offers nothing; one that is a picture and gave no table is
 * noted (`pictures`), with every page nobody read, as where a table may still
 * be. Reading the same paper again keeps what a person decided.
 */
export function offerCostRowsFromPages(
  project: DdProject,
  evidenceId: string,
  pages: ReadonlyArray<CostPageRead>,
  pagesInFile: number,
): CostPaper {
  const paper = paperFor(project, evidenceId, pagesInFile);
  const fresh: CostRowOffer[] = [];
  const read: CostPaperPage[] = [];
  const declined: CostPageDeclined[] = [];
  /** What each page offered so far held, for the pages after it. */
  const offered: Array<{ page: number; rows: CostTableRow[]; table: CostTableRead }> = [];
  let carried: { page: number; figures: CostFigures } | undefined;
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    if (page.reader === 'model') continue;
    const before = carried && carried.page === page.page - 1 ? carried.figures : undefined;
    const table = costTableOfPage(page, before);
    if (!table) continue;
    const believed = table.rows.filter((row) => !row.doubts?.length);
    const clean = believed.filter((row) => !row.unplaced && !row.problems?.length);
    const tie = before ? costTableTie(table, before) : table.tie;
    const closes = closedOn(table);
    carried = tie.holds && closes ? { page: page.page, figures: closes } : undefined;
    if (page.reader === 'ocr') {
      // A picture's rows are offered only where the page holds; never row by row on the reader's say-so.
      if (clean.length < believed.length) {
        // A line that reads as a row and has a figure that could not be read: the page was not read whole, and is not offered in part.
        declined.push({ page: page.page, why: 'poorly_read', said: pictureSaid(page.page, `${believed.length - clean.length} of its ${believed.length} rows ${believed.length - clean.length === 1 ? 'has' : 'have'} a figure that could not be read`) });
        carried = undefined;
        continue;
      }
      if (tie.holds === false) {
        declined.push({ page: page.page, why: 'not_tied', said: pictureSaid(page.page, tie.said.replace(/\.$/, '')) });
        continue;
      }
      if (tie.holds === null && (clean.length < COST_ROWS_READ_FEWEST || clean.length < table.rows.length * COST_ROWS_READ_SHARE)) {
        declined.push({ page: page.page, why: 'poorly_read', said: pictureSaid(page.page, `${clean.length} of its ${table.rows.length} lines of figures could be set in their columns, and it states no total to hold them to`) });
        continue;
      }
    }
    // On a picture only what was set cleanly in its columns; on a page of type a line whose figures could not be placed is still shown, to be typed from.
    const rows = page.reader === 'ocr' ? clean : believed;
    if (!rows.length) continue;
    const same = offered.find((held) => rows.every((row) => held.rows.some((other) => sameName(other.name, row.name) && COST_MONEY_COLUMNS.every((column) => row[column] === undefined || other[column] === undefined || row[column] === other[column]) && COST_MONEY_COLUMNS.every((column) => row[column] === undefined || other[column] !== undefined))));
    if (same) {
      declined.push({ page: page.page, why: 'repeats', of: same.page, said: `Page ${page.page} states again the rows of page ${same.page}, with the same figures: nothing new is offered from it.` });
      continue;
    }
    // A page that carries a table on from the page before is the rest of that table, never a breakdown of it.
    const total = tie.by === 'total' ? closedOn(table) : undefined;
    const sameTotal = (line: CostTableLine): boolean => {
      const both = COST_MONEY_COLUMNS.filter((column) => total?.[column] !== undefined && line.figures[column] !== undefined);
      return both.length > 0 && both.every((column) => total![column] === line.figures[column]);
    };
    const whole = total ? offered.find((held) => !rows.some((row) => held.rows.some((other) => sameName(other.name, row.name))) && held.table.lines.some((line) => (line.as === 'total' || line.as === 'sub_total') && sameTotal(line))) : undefined;
    if (whole) {
      declined.push({ page: page.page, why: 'breakdown', of: whole.page, said: `Page ${page.page} breaks down a total that page ${whole.page} already states, under other names: its rows are not offered, so nothing is counted twice. Type from it if the ledger is kept at that level.` });
      continue;
    }
    offered.push({ page: page.page, rows, table });
    read.push({ page: page.page, reader: page.reader, lines: table.lines, checks: table.checks, addsUp: table.addsUp, stated: table.stated, tie });
    for (const row of rows) {
      fresh.push({
        id: newId(),
        page: page.page,
        line: row.line,
        quote: row.quote,
        reader: page.reader,
        cells: costImportRow(row),
        ...(row.unplaced ? { unplaced: row.unplaced } : {}),
        ...(row.problems ? { problems: row.problems } : {}),
        status: 'offered',
      });
    }
  }
  const withTable = new Set([...read.map((page) => page.page), ...declined.filter((page) => page.why === 'repeats' || page.why === 'breakdown').map((page) => page.page)]);
  const poor = new Set(declined.filter((page) => page.why === 'not_tied' || page.why === 'poorly_read').map((page) => page.page));
  paper.readAt = new Date().toISOString();
  paper.pagesInFile = pagesInFile;
  paper.pages = read;
  paper.declined = declined;
  // Where a table may be that nobody here read: a page nobody got words from, a picture OCR was unsure of, a page of type with a picture it could not read.
  const maybe = (n: number): boolean => {
    const page = pages.find((held) => held.page === n && held.reader !== 'model');
    return !page || Boolean(page.picture) || poor.has(n) || (page.reader === 'ocr' && Boolean(page.unsure));
  };
  paper.pictures = Array.from({ length: pagesInFile }, (_, i) => i + 1).filter((n) => !withTable.has(n) && maybe(n));
  laidOver(paper, ['text', 'ocr'], fresh);
  return paper;
}

/** Whether a figure, as a reader wrote it, is among the words of a page: the same digits, grouped as the page groups them or not. */
export function figureOnPage(written: string, pageText: string | undefined): boolean {
  const digits = written.replace(/[^\d.]/g, '').replace(/\.0+$/, '');
  if (!digits || !pageText) return false;
  const tokens = pageText.split(/[^\d,.]+/).map((token) => token.replace(/,/g, '').replace(/\.$/, '').replace(/\.0+$/, ''));
  return tokens.includes(digits);
}

const MODEL_ROWS_MOST = 200;
const WORDS_MOST = 200;

/**
 * Offers the rows a model read off a cost report's pages.
 *
 * What it sent is not trusted. A row is kept only where it names a page of
 * the paper and a package, and each figure is kept only under one of the
 * ledger's own keys and only where what was written reads as an amount: the
 * amount is worked out here, from the figure as written, never taken as a
 * number the model gave. A row all of whose figures are among the words this
 * server read on its page is `page_text`; any other is `unverified`, is said
 * to be, and is never taken with "all of a page". `pageTexts[0]` is page 1.
 */
export function offerCostRowsFromModel(
  project: DdProject,
  evidenceId: string,
  sent: unknown,
  pageTexts: ReadonlyArray<string | undefined>,
  pagesInFile: number,
  said: { failure?: string } = {},
): CostPaper {
  const paper = paperFor(project, evidenceId, pagesInFile);
  const fresh: CostRowOffer[] = [];
  const rows = Array.isArray(sent) ? sent.slice(0, MODEL_ROWS_MOST) : [];
  const words = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, WORDS_MOST) : '');
  rows.forEach((given, index) => {
    if (!given || typeof given !== 'object') return;
    const row = given as Record<string, unknown>;
    const page = typeof row.page === 'number' ? Math.floor(row.page) : Number.NaN;
    const name = words(row.name);
    if (!(page >= 1 && page <= pagesInFile) || !name) return;
    const figures: Partial<Record<CostMoneyColumn, number>> = {};
    const written: string[] = [];
    for (const column of COST_MONEY_COLUMNS) {
      const text = words(row[column]);
      const amount = costAmount(text);
      if (typeof amount !== 'number') continue;
      figures[column] = amount;
      written.push(text);
    }
    if (!written.length) return;
    const awardedTo = words(row.awardedTo);
    const table: CostTableRow = { line: index + 1, quote: [name, ...written].join(' '), name, ...figures, ...(awardedTo ? { awardedTo } : {}) };
    const onPage = written.every((figure) => figureOnPage(figure, pageTexts[page - 1]));
    fresh.push({ id: newId(), page, line: index + 1, quote: table.quote, reader: 'model', proof: onPage ? 'page_text' : 'unverified', cells: costImportRow({ ...table, ...(costRowKind(name) ? { kind: costRowKind(name) } : {}) }), status: 'offered' });
  });
  laidOver(paper, ['model'], fresh);
  paper.model = { at: new Date().toISOString(), rows: fresh.length, ...(said.failure ? { failure: said.failure.slice(0, WORDS_MOST) } : {}) };
  return paper;
}

function offerOf(project: DdProject, evidenceId: string, offerId: string): { paper: CostPaper; offer: CostRowOffer } {
  const paper = costPapersOf(project).find((held) => held.evidenceId === evidenceId);
  const offer = paper?.offers.find((held) => held.id === offerId);
  if (!paper || !offer) throw new Error('No offered row by that id.');
  return { paper, offer };
}

/** The cells a person may correct on an offered row before accepting it. */
export type CostOfferCorrection = Partial<Pick<CostReportImportRow, 'name' | 'budget' | 'poIssued' | 'amountPaid' | 'anticipatedCost' | 'certified' | 'awardedTo' | 'variations'>> & { kind?: CostRowKind | null };

const FIGURES = ['budget', 'poIssued', 'amountPaid', 'anticipatedCost', 'certified', 'variations'] as const;

/**
 * Accept one offered row onto a draft Cost Report, as it was read or with
 * cells corrected first. The row of that name on the report is updated, else
 * one is added, and it says which paper and page it came from. A row with no
 * figure at all (one whose figures could not be placed) is accepted only once
 * a person has typed one.
 */
export function acceptCostOffer(project: DdProject, evidenceId: string, offerId: string, reportId: string, actor: string, corrected: CostOfferCorrection = {}): CostReportPackageRow {
  const { offer } = offerOf(project, evidenceId, offerId);
  if (offer.status === 'accepted') throw new Error('That row has been accepted already.');
  const report = costReportOf(project, reportId);
  assertCostReportDraft(report);
  const { kind: correctedKind, ...cellsCorrected } = corrected;
  const cells: CostReportImportRow = { ...offer.cells, ...Object.fromEntries(Object.entries(cellsCorrected).filter(([, value]) => value !== undefined)) };
  if (correctedKind === null) delete cells.kind;
  else if (correctedKind) cells.kind = correctedKind;
  cells.name = (cells.name ?? '').replace(/\s+/g, ' ').trim();
  if (!cells.name) throw new Error('A row needs the name of its package.');
  if (!FIGURES.some((key) => cells[key] !== undefined)) throw new Error('None of this row’s figures could be put in a column. Type them from the page, then accept.');
  const edited = Object.entries(corrected).some(([key, value]) => value !== undefined && value !== (offer.cells as unknown as Record<string, unknown>)[key]);
  const from = { evidenceId, page: offer.page, quote: offer.quote.slice(0, 300) };
  const more = {
    ...(cells.certified !== undefined ? { certified: cells.certified } : {}),
    ...(cells.awardedTo !== undefined ? { awardedTo: cells.awardedTo } : {}),
    ...(cells.variations !== undefined ? { variations: cells.variations } : {}),
    ...(cells.kind !== undefined ? { kind: cells.kind } : {}),
    from,
  };
  const match = matchOf(report, cells);
  const row = match
    ? updateCostReportRow(
        project,
        reportId,
        match.id,
        {
          name: cells.name,
          ...(cells.budget !== undefined ? { budget: cells.budget } : {}),
          ...(cells.poIssued !== undefined ? { poIssued: cells.poIssued } : {}),
          ...(cells.amountPaid !== undefined ? { amountPaid: cells.amountPaid } : {}),
          ...(cells.anticipatedCost !== undefined ? { anticipatedCost: cells.anticipatedCost } : {}),
          ...more,
        },
        actor,
      )
    : addCostReportPackage(
        project,
        reportId,
        {
          name: cells.name,
          ...(cells.code ? { code: cells.code } : {}),
          budget: cells.budget ?? 0,
          poIssued: cells.poIssued ?? 0,
          amountPaid: cells.amountPaid ?? 0,
          anticipatedCost: cells.anticipatedCost ?? cells.budget ?? 0,
          ...more,
        },
        actor,
      );
  offer.status = 'accepted';
  offer.decidedBy = actor;
  offer.decidedAt = new Date().toISOString();
  offer.reportId = reportId;
  offer.rowId = row.id;
  if (edited) offer.edited = true;
  recordAuditEvent(project, { actor, action: 'accept_cost_row', entityType: 'cost_report', entityId: reportId, newValue: `${row.name}, from page ${offer.page} of a paper${edited ? ', corrected' : ''}` });
  return row;
}

/**
 * Accept every row still offered from one page of a paper. Never one whose
 * figures could not be placed, one with a figure that could not be read, or
 * one a model read that was not found on the page: those are a person's to
 * look at one by one, and are counted as left.
 */
export function acceptCostOffersOnPage(project: DdProject, evidenceId: string, page: number, reportId: string, actor: string): { accepted: number; left: number } {
  const paper = costPapersOf(project).find((held) => held.evidenceId === evidenceId);
  if (!paper) throw new Error('No cost report by that id has rows offered.');
  assertCostReportDraft(costReportOf(project, reportId));
  const held = paper.pages.find((other) => other.page === page);
  const waiting = paper.offers.filter((offer) => offer.page === page && offer.status === 'offered');
  // "All of a page" is for a page whose rows its own totals hold. Rows a model read are held to the page's words one by one, as before.
  if (waiting.some((offer) => offer.reader !== 'model') && costPageHolds(held) !== true) {
    throw new Error(held?.tie?.holds === false || held?.addsUp === false ? 'The rows of this page do not add up to the total it states. Look at each and accept them one at a time.' : 'This page states no total to hold its rows to. Look at each and accept them one at a time.');
  }
  let accepted = 0;
  for (const offer of waiting) {
    if (offer.unplaced || offer.problems?.length || offer.proof === 'unverified') continue;
    acceptCostOffer(project, evidenceId, offer.id, reportId, actor);
    accepted += 1;
  }
  return { accepted, left: waiting.length - accepted };
}

/** Whether a page's rows are held by its own totals: what "all of a page" waits on. A page read before the tie was kept goes by its total alone. */
export function costPageHolds(page: Pick<CostPaperPage, 'tie' | 'addsUp'> | undefined): boolean | null {
  if (!page) return null;
  return page.tie ? page.tie.holds : page.addsUp;
}

/**
 * What accepting every row still offered from a page would write, with
 * nothing written: the rows, and the ledger's totals as they stand and as
 * they would stand. Empty rows where "all of a page" is not to be had.
 */
export function previewCostOffersOnPage(project: Pick<DdProject, 'costPapers' | 'costReports'>, evidenceId: string, page: number, reportId: string): { rows: CostReportImportRow[]; left: number; holds: boolean | null; tie?: CostTie; totals: CostTotalsMoved } {
  const paper = costPapersOf(project).find((held) => held.evidenceId === evidenceId);
  if (!paper) throw new Error('No cost report by that id has rows offered.');
  const report = costReportOf(project, reportId);
  const held = paper.pages.find((other) => other.page === page);
  const waiting = paper.offers.filter((offer) => offer.page === page && offer.status === 'offered');
  const holds = costPageHolds(held);
  const taken = holds === true || waiting.every((offer) => offer.reader === 'model') ? waiting.filter((offer) => !offer.unplaced && !offer.problems?.length && offer.proof !== 'unverified') : [];
  const rows = taken.map((offer) => offer.cells);
  return { rows, left: waiting.length - taken.length, holds, ...(held?.tie ? { tie: held.tie } : {}), totals: costTotalsWith(report, rows) };
}

/** Set an offered row aside: it is kept, said to be set aside, and offered by no later reading of the paper. */
export function setAsideCostOffer(project: DdProject, evidenceId: string, offerId: string, actor: string): CostRowOffer {
  const { offer } = offerOf(project, evidenceId, offerId);
  if (offer.status === 'accepted') throw new Error('That row has been accepted already.');
  offer.status = 'set_aside';
  offer.decidedBy = actor;
  offer.decidedAt = new Date().toISOString();
  return offer;
}

/**
 * What to tell a person of a cost report whose tables gave no row, in one
 * line, or nothing where rows are offered or the paper holds no page that
 * could be a table. `modelSetUp` is whether a model reader is configured.
 */
export function costPaperSaid(paper: CostPaper, modelSetUp: boolean): string {
  if (paper.offers.length || !paper.pictures.length) return '';
  if (paper.model?.failure) return 'The tables in this report are pictures. A model was asked to read them and gave nothing that could be kept: paste the table below, with the PDF open beside it.';
  const tried = (paper.declined ?? []).some((page) => page.why === 'not_tied' || page.why === 'poorly_read');
  if (tried) return 'The tables in this report are pictures, and the reader here could not read them reliably: no row is offered. Paste the table below, with the PDF open beside it.';
  return modelSetUp
    ? 'The tables in this report are pictures, and no row could be read from them. Paste the table below, with the PDF open beside it.'
    : 'The tables in this report are pictures, which only a model reader could read and none is set up here. Paste the table below, with the PDF open beside it.';
}

/**
 * What became of each page of a cost report that holds a table, a line to a
 * kind of outcome: the pages whose rows are offered and held by their totals,
 * the pages offered with no total to hold them, the pages that repeat or
 * break down another, and the pages that are pictures not read reliably.
 */
export function costPaperPagesSaid(paper: CostPaper): string[] {
  const said: string[] = [];
  const offeredOn = (page: number): number => paper.offers.filter((offer) => offer.page === page).length;
  const held = paper.pages.filter((page) => offeredOn(page.page) && costPageHolds(page) === true);
  const loose = paper.pages.filter((page) => offeredOn(page.page) && costPageHolds(page) !== true);
  const rows = (pages: readonly CostPaperPage[]): number => pages.reduce((n, page) => n + offeredOn(page.page), 0);
  const cap = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  if (held.length) said.push(`${cap(pagesSaid(held.map((page) => page.page)))}: ${rows(held)} ${rows(held) === 1 ? 'row' : 'rows'}, held to the ${held.length === 1 ? 'page’s' : 'pages’'} own totals.`);
  if (loose.length) said.push(`${cap(pagesSaid(loose.map((page) => page.page)))}: ${rows(loose)} ${rows(loose) === 1 ? 'row' : 'rows'}, which ${loose.some((page) => costPageHolds(page) === false) ? 'do not add up to the total stated' : 'no total on the page holds'}: to be looked at one by one.`);
  const declined = paper.declined ?? [];
  const pictures = declined.filter((page) => page.why === 'not_tied' || page.why === 'poorly_read');
  if (pictures.length) said.push(`${cap(pagesSaid(pictures.map((page) => page.page)))}: ${pictures.length === 1 ? 'its table is a picture' : 'their tables are pictures'} the reader here could not read reliably. Nothing is offered from ${pictures.length === 1 ? 'it' : 'them'}: paste the table, with the page open beside it.`);
  for (const page of declined.filter((other) => other.why === 'repeats' || other.why === 'breakdown')) said.push(page.said);
  const unread = paper.pictures.filter((page) => !pictures.some((held) => held.page === page));
  if (said.length && unread.length) said.push(`No package table was read from ${pagesSaid(unread)}. A variation log and basic prices are not read from a paper: they are typed under the ledger.`);
  return said;
}
