/**
 * A tracked list, read as it is sent.
 *
 * A consultant's "information required" is a spreadsheet they keep for the
 * life of a job and send again each time it moves: a title, a legend, a row
 * that names the columns, and then section rows between the item rows. Every
 * item has a number, the round it was asked in, what came back in a few
 * words, and a status. A second sheet counts it up.
 *
 * This reads that workbook, a CSV of it or the same rows pasted, into lines
 * a project can hold (`loadTrackedList` in `checklist.ts`). It reads what is
 * written and nothing more: a status it does not know is pending, a date it
 * cannot read is no date, and the count sheet is left alone because the
 * count is worked out from the lines (`checklistSummary`).
 *
 * Which desk a line belongs to is its package's: a small table of words to
 * functions, which a firm may answer differently as it loads the list.
 */

import { CHECKLIST_LIMITS, csvCells, listDay, type ChecklistDraft, type ChecklistHeading, type ChecklistListStatus } from './checklist';
import { workstreamDefinition, type DepartmentKey } from './departments';

type Column = 'ref' | 'oldRef' | 'package' | 'title' | 'availability' | 'round' | 'remark' | 'status' | 'owedBy' | 'targetDate' | 'note';

/**
 * The words a column is known by, tried in this order so that the narrow
 * names are taken before the wide ones: "Orig. Sl.No" is the older number
 * and not the number, and "Client Response / Remarks" is the remark and not
 * the status.
 */
const COLUMNS: Array<[Column, RegExp]> = [
  ['oldRef', /^(?:orig(?:inal)?|old|earlier|previous) (?:ref|sl|s|sr|serial|item)(?: ?(?:no|number))?$/],
  ['ref', /^(?:ref(?:erence)?|item)(?: ?(?:no|number))?$|^(?:sl|s|sr|serial) ?(?:no|number)$|^no$/],
  ['package', /^(?:work )?(?:package|discipline|trade)$/],
  ['availability', /^availab/],
  ['round', /^request ref|^(?:asked|requested|raised) (?:in|on|via|by)$|^round$|^rfi ref/],
  ['status', /^(?:current |present )?status$/],
  ['owedBy', /^responsib|^action by$|^owed by$|^to be provided by$/],
  ['targetDate', /^target(?: date)?$|^due(?: date| by)?$|^required by$|^date required$/],
  ['note', /^next action|comments?$/],
  ['remark', /response|^remarks?$/],
  ['title', /information required|^description|^(?:item|document)s?(?: name| description| required)?$|^particulars$|^requirements?$/],
];

const cellName = (cell: string): string =>
  cell
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The columns a row names, when it is the row that heads a tracked list: the paper, and a status or a number with a round. */
function trackedColumns(row: readonly string[]): Partial<Record<Column, number>> | undefined {
  const found: Partial<Record<Column, number>> = {};
  row.forEach((cell, n) => {
    const name = cellName(cell);
    if (!name) return;
    const hit = COLUMNS.find(([key, says]) => found[key] === undefined && says.test(name));
    if (hit) found[hit[0]] = n;
  });
  if (found.title === undefined) return undefined;
  return found.status !== undefined || (found.ref !== undefined && (found.round !== undefined || found.availability !== undefined)) ? found : undefined;
}

/** A status cell as one of the four a tracked list keeps. "PQR to assume" names who assumes. */
export function listStatus(cell: string): { status: ChecklistListStatus; assumer?: string } {
  const text = cell.replace(/\s+/g, ' ').trim();
  const assume = /^(.*?)\s*(?:to|will|shall)\s+assume\b/i.exec(text) ?? /^(?:to be\s+)?assum(?:ed|ption)(?:\s+by\s+(.*))?$/i.exec(text);
  if (assume) {
    const who = (assume[1] ?? '').replace(/[-–—:]+$/, '').trim();
    return { status: 'assumed', ...(who ? { assumer: who.slice(0, CHECKLIST_LIMITS.label) } : {}) };
  }
  if (/\bpartial|\bpartly|\bpart received/i.test(text)) return { status: 'partial' };
  if (/\breceived\b|\bin hand\b|\bcomplete[d]?\b|\bclosed\b/i.test(text) && !/\bnot\b|\bpending\b|\bawait/i.test(text)) return { status: 'received' };
  return { status: 'pending' };
}

/** A number as a list writes one: "2", "2.1.4", "A.1", "B.1.10". */
const NUMBER = /^[A-Za-z]?\d{0,3}(?:\.[A-Za-z0-9]{1,3}){0,5}$/;
const isNumber = (text: string): boolean => Boolean(text) && NUMBER.test(text.replace(/[.)]+$/, '')) && /[\d]|^[A-Za-z]$/.test(text);
const numberOf = (text: string): string => text.trim().replace(/[.)]+$/, '');
const depthOf = (ref: string): number => ref.split('.').filter(Boolean).length;

export interface TrackedList {
  /** The list's own name: its title row, else its sheet's name. */
  list: string;
  drafts: ChecklistDraft[];
  /** The packages its lines name, in the order they first appear. */
  packages: string[];
  /** The rows written under the header, the lines made of them and the sections among them: so a count that does not add up is seen. */
  rows: number;
  sections: number;
  /** Rows that became neither a line nor a section, each with the row of the sheet it is on and why. */
  skipped: Array<{ row: number; text: string; reason: string }>;
}

/**
 * The rows of one sheet as a tracked list, or nothing where no row heads one.
 *
 * Rows above the header are the title and the legend: the first that holds
 * words names the list, and none is a line. Below it a row with only its
 * number and its name written is a section: it is kept as a heading over the
 * lines under it, with its number, and is never a paper. A row merged across
 * the sheet (every cell the same words) is a heading too. Anything else with
 * a name is a line. What became neither is said, with its row (`skipped`),
 * and the rows, lines and sections are counted so the sum can be checked.
 *
 * A line with no package written takes the package of the line above it in
 * the same section, as a merged cell means, and else its outermost section's
 * name.
 */
export function parseTrackedRows(table: readonly (readonly string[])[], sheetName?: string): TrackedList | undefined {
  // Each row with the row of the sheet it is on, where the sheet was read with its blank rows kept.
  const numbered_ = table.map((r, n) => ({ cells: r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()), at: n + 1 })).filter((r) => r.cells.some(Boolean));
  const rows = numbered_.map((r) => r.cells);
  const headAt = rows.slice(0, 20).findIndex((r) => trackedColumns(r));
  if (headAt < 0) return undefined;
  const skipped: TrackedList['skipped'] = [];
  let sections = 0;
  const columns = trackedColumns(rows[headAt]!)!;
  const titled = rows.slice(0, headAt).find((r) => r.some((c) => /\p{L}{3}/u.test(c)));
  const list = ((titled?.find((c) => /\p{L}{3}/u.test(c)) ?? sheetName ?? 'List').replace(/\s+/g, ' ').trim() || 'List').slice(0, CHECKLIST_LIMITS.label);
  const at = (row: readonly string[], key: Column): string => (columns[key] === undefined ? '' : (row[columns[key]!] ?? ''));
  const named = new Set([columns.ref, columns.oldRef, columns.title].filter((n): n is number => n !== undefined));

  const body = rows.slice(headAt + 1).map((row, n) => {
    const sheetRow = numbered_[headAt + 1 + n]!.at;
    const ref = isNumber(at(row, 'ref')) ? numberOf(at(row, 'ref')) : '';
    // What is written beside the number. One text and no more is a banner where it is merged across the sheet (the same
    // words in several cells) or sits outside the paper's own column.
    const beside = row.filter((cell, n) => cell && !(n === columns.ref && ref));
    const distinct = [...new Set(beside)];
    const banner = distinct.length === 1 && (beside.length > 1 || !at(row, 'title')) ? distinct[0]! : undefined;
    const others = row.filter((cell, n) => cell && !named.has(n) && cell !== at(row, 'title')).length;
    return { row, ref, title: at(row, 'title'), banner, others, sheetRow };
  });

  const drafts: ChecklistDraft[] = [];
  const packages: string[] = [];
  let stack: ChecklistHeading[] = [];
  let lastPackage: string | undefined;
  const head = (ref: string, title: string) => {
    const depth = ref ? depthOf(ref) : 1;
    stack = stack.filter((h) => (h.ref ? depthOf(h.ref) : 1) < depth);
    stack.push({ ...(ref ? { ref } : {}), title: title.slice(0, CHECKLIST_LIMITS.label) });
    if (depth === 1) lastPackage = undefined;
    sections += 1;
  };

  for (const line of body) {
    if (line.banner !== undefined) {
      // "2 TOWER – CIVIL & STRUCTURAL WORKS" in one cell: the number leads it.
      const lead = /^([A-Za-z]?\d{1,3}(?:\.[A-Za-z0-9]{1,3}){0,5})[.)]?\s+(.+)$/.exec(line.banner);
      if (line.ref) head(line.ref, line.banner);
      else if (lead) head(numberOf(lead[1]!), lead[2]!);
      else head('', line.banner);
      continue;
    }
    if (!line.title) {
      skipped.push({ row: line.sheetRow, text: line.row.filter(Boolean).join(' · ').slice(0, 120), reason: 'no description' });
      continue;
    }
    // A number and a name and nothing else is a section, never a paper: an item of a tracked list says at least how it stands.
    if (!line.others) {
      head(line.ref, line.title);
      continue;
    }
    const status = columns.status === undefined ? undefined : listStatus(at(line.row, 'status'));
    const pack = at(line.row, 'package') || lastPackage || stack[0]?.title;
    lastPackage = pack;
    if (pack && !packages.some((p) => p.toLowerCase() === pack.toLowerCase())) packages.push(pack);
    const oldRef = at(line.row, 'oldRef');
    drafts.push({
      title: line.title,
      list,
      order: drafts.length,
      ...(line.ref ? { ref: line.ref } : {}),
      ...(oldRef ? { oldRef: numberOf(oldRef) } : {}),
      ...(stack.length ? { headings: stack.map((h) => ({ ...h })) } : {}),
      ...(pack ? { package: pack } : {}),
      ...(at(line.row, 'availability') ? { availability: at(line.row, 'availability') } : {}),
      ...(at(line.row, 'round') ? { round: at(line.row, 'round') } : {}),
      ...(at(line.row, 'remark') ? { remark: at(line.row, 'remark') } : {}),
      ...(at(line.row, 'owedBy') ? { owedBy: at(line.row, 'owedBy') } : {}),
      ...(listDay(at(line.row, 'targetDate')) ? { targetDate: listDay(at(line.row, 'targetDate')) } : {}),
      ...(at(line.row, 'note') ? { note: at(line.row, 'note') } : {}),
      ...(status ? { status: status.status, ...(status.assumer ? { assumer: status.assumer } : {}) } : {}),
    });
  }
  return drafts.length ? { list, drafts, packages, rows: body.length, sections, skipped } : undefined;
}

/** A sheet that counts the list up. It is not read: the count is worked out from the lines. */
const COUNT_SHEET = /^(?:summary|dashboard|status summary|abstract|totals?)$/i;

/** A workbook as a tracked list: every sheet that is headed as one, in order, and never the sheet that counts it. */
export function parseTrackedSheets(sheets: ReadonlyArray<{ name: string; rows: readonly (readonly string[])[] }>): TrackedList | undefined {
  const read = sheets.filter((sheet) => !COUNT_SHEET.test(sheet.name.trim())).flatMap((sheet) => parseTrackedRows(sheet.rows, sheet.name) ?? []);
  if (!read.length) return undefined;
  const list = read[0]!.list;
  const drafts = read.flatMap((part) => part.drafts).map((draft, order) => ({ ...draft, list, order }));
  const packages = [...new Set(read.flatMap((part) => part.packages))];
  return { list, drafts, packages, rows: read.reduce((n, part) => n + part.rows, 0), sections: read.reduce((n, part) => n + part.sections, 0), skipped: read.flatMap((part) => part.skipped) };
}

/** Pasted rows, or a CSV or TSV file's, as a tracked list: tabs where there are any, else commas. */
export function parseTrackedText(text: string): TrackedList | undefined {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return undefined;
  const tabbed = lines.some((l) => l.includes('\t'));
  return parseTrackedRows(lines.map((l) => (tabbed ? l.split('\t') : csvCells(l))));
}

/* ==================================================================== */
/* Which desk a package belongs to                                       */
/* ==================================================================== */

/**
 * The function that owns a package of a consultant's list, by the words in
 * its name. The first that matches is taken, so the narrow names come
 * first. A firm answers differently for its own list as it loads it.
 */
export const PACKAGE_DESKS: ReadonlyArray<{ says: RegExp; fn: string; said: string }> = [
  { says: /\bmep\b|mechanical|electrical|plumbing|hvac|fire ?fighting|\bservices\b/i, fn: 'design.electrical', said: 'MEP' },
  { says: /external|landscap|site development|infrastructure/i, fn: 'design.landscape', said: 'External development' },
  { says: /architect|finish|interior|fa[cç]ade/i, fn: 'design.finishes', said: 'Architectural and finishes' },
  { says: /civil|structur/i, fn: 'design.structure', said: 'Civil and structural' },
  { says: /general|common|preliminar|budget|\bcost\b/i, fn: 'finance.budget', said: 'General' },
];

export interface PackageDesk {
  package: string;
  /** The function its lines go to, where one is known. */
  fn?: string;
  department?: DepartmentKey;
}

const packageKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Each package of a list with the function it goes to: the one the firm
 * names for it (`given`, by the package's name), else the table's. A package
 * neither knows goes to the desk the list was loaded on.
 */
export function packageDesks(packages: readonly string[], given: Readonly<Record<string, string>> = {}): PackageDesk[] {
  const named = new Map(Object.entries(given).map(([pack, fn]) => [packageKey(pack), fn]));
  return packages.map((pack) => {
    const fn = named.get(packageKey(pack)) ?? PACKAGE_DESKS.find((desk) => desk.says.test(pack))?.fn;
    const department = fn ? workstreamDefinition(fn)?.department : undefined;
    return { package: pack, ...(fn && department ? { fn, department } : {}) };
  });
}

/** A list's lines, each sent to the function and the desk its package belongs to. */
export function placeDrafts(drafts: readonly ChecklistDraft[], desks: readonly PackageDesk[]): Array<ChecklistDraft & { department?: DepartmentKey }> {
  const byPackage = new Map(desks.map((desk) => [packageKey(desk.package), desk]));
  return drafts.map((draft) => {
    const desk = draft.package ? byPackage.get(packageKey(draft.package)) : undefined;
    return desk?.fn && desk.department ? { ...draft, fn: desk.fn, department: desk.department } : { ...draft };
  });
}
