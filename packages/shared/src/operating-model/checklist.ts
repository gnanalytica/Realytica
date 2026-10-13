/**
 * The project's own checklist: the papers somebody outside asked for, as
 * they listed them.
 *
 * The requirement sheet is worked out from the checks on the file. This is
 * the other list a project runs on: a consultant's "information required",
 * by stage and by package, different on every project and at every stage.
 * So nothing here is fixed. A line is a title and whatever the list said
 * about it: the stage, the package, who owes it.
 *
 * A line is in hand when a person says so, or when a filed document carries
 * its name. A document that only looks like it is offered, and a person
 * confirms: a paper marked in hand that is not is the one mistake this list
 * exists to prevent.
 */

import type { DepartmentKey } from './departments';
import { matchFilesToEvidence, type MatchRow } from './file-match';
import { addRequest } from './project-requests';
import type { RequirementStatus } from './requirement-sheet';
import type { DdProject, EvidenceRecord, FieldAddress, ProjectRequest } from './types';

/* ==================================================================== */
/* The record                                                            */
/* ==================================================================== */

export interface ChecklistItem {
  id: string;
  /** The department whose desk holds the list, and whose roles may change it. */
  department: DepartmentKey;
  title: string;
  /** As the list names it: "Concept", "Tender". Not the project's own stage. */
  stage?: string;
  /** "Civil and structural", "MEP". */
  package?: string;
  /** The party or person who owes it, as the list names them. */
  owedBy?: string;
  note?: string;
  /** Set when a person marked it in hand, with the document where they named one. */
  received?: { at: string; by: string; evidenceId?: string; fromList?: true };
  /** Documents a person said are not this paper: never offered for it again. */
  dismissed?: string[];
  /** The list it is a line of, where it came from a tracked list: what a later copy of that list is matched against. */
  list?: string;
  /** The load that put it on the project: what "Undo" takes back, whole. */
  load?: string;
  /** The day a person says it was asked for, where no request went from here and the list names no round. */
  askedOn?: string;
  /** Its number as the list writes it: "2.1.4". */
  ref?: string;
  /** An older number the list keeps beside it: "B.1.10". */
  oldRef?: string;
  /** The sections it sits under, outermost first, each with its own number. */
  headings?: ChecklistHeading[];
  /** Its place in the list as written, so a line added by a later copy sits where the list puts it. */
  order?: number;
  /** The function it belongs to, where the list's package names one. */
  fn?: string;
  /** The round it was asked in, as the list names it: "E mail 02". A line with one has been asked for. */
  round?: string;
  /** What the list says was to hand when it was asked for: "Not available", "Partially available". */
  availability?: string;
  /** A few words on what came back, read from the list or written by a person. */
  remark?: { text: string; from: 'list' | 'person'; by: string; at: string };
  /** The day it is wanted by. */
  targetDate?: string;
  /** Some of it is in hand and the rest is still owed. `wanted` says what is still wanted. */
  partial?: { at: string; by: string; wanted?: string };
  /** It will not come: `assumer` proceeds on an assumption, standing in for the fields named. */
  assumed?: { at: string; by: string; assumer: string; fields?: ChecklistAssumedField[] };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** A section a line sits under: its number where the list gives one, and its name. */
export interface ChecklistHeading {
  ref?: string;
  title: string;
}

/** A field a line to be assumed stands in for, and the value it is assumed at. */
export interface ChecklistAssumedField {
  address: FieldAddress;
  value: string | number | boolean;
}

/** How a tracked list says a line stands, in its own status column. */
export type ChecklistListStatus = 'received' | 'partial' | 'assumed' | 'pending';

/** One line as a list wrote it, before it is on a project. */
export interface ChecklistDraft {
  title: string;
  stage?: string;
  package?: string;
  owedBy?: string;
  note?: string;
  list?: string;
  ref?: string;
  oldRef?: string;
  headings?: ChecklistHeading[];
  order?: number;
  fn?: string;
  round?: string;
  availability?: string;
  /** What came back, in the list's own few words. */
  remark?: string;
  targetDate?: string;
  /** How the list says it stands, where the list has a status column. */
  status?: ChecklistListStatus;
  /** Who is to assume, where the status says somebody will. */
  assumer?: string;
}

export interface ChecklistPatch {
  title?: string;
  stage?: string | null;
  package?: string | null;
  owedBy?: string | null;
  note?: string | null;
  /** The day it is wanted by, as `YYYY-MM-DD`. */
  targetDate?: string | null;
  /** The round it was asked in. */
  round?: string | null;
  /** A few words on what came back, in the person's own. */
  remark?: string | null;
}

export const CHECKLIST_LIMITS = { items: 1000, title: 300, label: 120, note: 600, remark: 200, ref: 24, headings: 4, assumedFields: 6 } as const;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clean(text: string | null | undefined, max: number): string | undefined {
  const out = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return out || undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A day as a list writes it, as `YYYY-MM-DD`: "2026-11-14", "14/11/2026",
 * "14-11-26", "14 Nov 2026", "Nov 14, 2026". The day comes before the month,
 * as it is written in India. Nothing where it is no day the calendar has.
 */
export function listDay(text: string | null | undefined): string | undefined {
  const raw = (text ?? '').trim();
  if (!raw) return undefined;
  const made = (y: number, m: number, d: number): string | undefined => {
    const year = y < 100 ? 2000 + y : y;
    const day = new Date(Date.UTC(year, m - 1, d));
    return year >= 1990 && year <= 2200 && day.getUTCFullYear() === year && day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day.toISOString().slice(0, 10) : undefined;
  };
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(raw);
  if (hit) return made(Number(hit[1]), Number(hit[2]), Number(hit[3]));
  hit = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(raw);
  if (hit) return made(Number(hit[3]), Number(hit[2]), Number(hit[1]));
  hit = /^(\d{1,2})(?:st|nd|rd|th)?[\s./-]+([A-Za-z]{3,9})\.?,?[\s./-]+(\d{2}|\d{4})$/.exec(raw);
  if (hit && MONTHS.includes(hit[2]!.slice(0, 3).toLowerCase())) return made(Number(hit[3]), MONTHS.indexOf(hit[2]!.slice(0, 3).toLowerCase()) + 1, Number(hit[1]));
  hit = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(raw);
  if (hit && MONTHS.includes(hit[1]!.slice(0, 3).toLowerCase())) return made(Number(hit[3]), MONTHS.indexOf(hit[1]!.slice(0, 3).toLowerCase()) + 1, Number(hit[2]));
  // A date cell of a workbook, as it is printed: "Sat Nov 14 2026 05:30:00 GMT+0530".
  hit = /^[A-Za-z]{3},? ([A-Za-z]{3}) (\d{1,2}) (\d{4}) \d{2}:\d{2}/.exec(raw);
  if (hit && MONTHS.includes(hit[1]!.toLowerCase())) return made(Number(hit[3]), MONTHS.indexOf(hit[1]!.toLowerCase()) + 1, Number(hit[2]));
  return undefined;
}

/** The sections above a line as they are kept: each bounded, four deep at most. */
function cleanHeadings(headings: readonly ChecklistHeading[] | undefined): ChecklistHeading[] | undefined {
  const out = (headings ?? [])
    .map((h) => ({ ref: clean(h.ref, CHECKLIST_LIMITS.ref), title: clean(h.title, CHECKLIST_LIMITS.label) }))
    .filter((h): h is { ref: string | undefined; title: string } => Boolean(h.title))
    .slice(-CHECKLIST_LIMITS.headings)
    .map((h) => ({ ...(h.ref ? { ref: h.ref } : {}), title: h.title }));
  return out.length ? out : undefined;
}

/**
 * A name as it is compared: case and punctuation say nothing. What follows
 * the last dot of a paper's name is part of the name: "Annexure A.1" and
 * "Annexure A.2" are two papers, as "Rev.A" and "Rev.B" are.
 */
function fold(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A file's name as it is compared: as any name, without the extension. An ending of digits alone, "Schedule 1.2", is no extension. */
function foldFile(name: string | undefined): string {
  return fold((name ?? '').trim().replace(/\.(?=[a-z0-9]{1,5}$)\d*[a-z][a-z0-9]*$/i, ''));
}

/** What makes two lines the same line: the paper, at the same stage, in the same package. */
function lineKey(line: Pick<ChecklistDraft, 'title' | 'stage' | 'package' | 'list' | 'ref' | 'headings'>): string {
  // A line of a tracked list is told apart by its number, and where it has none by the sections it sits under: two phases
  // may each ask for a paper of the same name, and they are two papers.
  return `${fold(line.title)}|${fold(line.stage)}|${fold(line.package)}${line.list ? `|${fold(line.list)}|${line.ref ? line.ref.toLowerCase() : sectionPath(line)}` : ''}`;
}

/** The sections a line sits under, as they are compared. */
function sectionPath(line: Pick<ChecklistDraft, 'headings'>): string {
  return (line.headings ?? []).map((heading) => fold(heading.title)).join('>');
}

function itemsOf(project: DdProject): ChecklistItem[] {
  if (!project.checklist) project.checklist = [];
  return project.checklist;
}

function findItem(project: DdProject, itemId: string): ChecklistItem {
  const found = (project.checklist ?? []).find((i) => i.id === itemId);
  if (!found) throw new Error('That line is not on the list.');
  return found;
}

function audit(project: DdProject, actor: string, action: string, entityId: string, newValue?: string, oldValue?: string): void {
  const at = nowIso();
  project.audit.push({ id: newId('aud'), at, actor, action, entityType: 'checklist', entityId, ...(oldValue ? { oldValue } : {}), ...(newValue ? { newValue } : {}) });
  project.updatedAt = at;
}

/* ==================================================================== */
/* Reading a list                                                        */
/* ==================================================================== */

/** A bullet, a tick box, or a number or letter a list puts before its lines. */
const MARK = /^\s*(?:[-–—•*▪◦·○●□☐☑✓✔]+|\[[ xX]?\]|\(?\d{1,3}(?:\.\d{1,3})+\)?|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/;
/** A cell that only numbers its row. */
const SERIAL = /^\(?(?:\d{1,4}(?:\.\d{1,3})*|[a-zA-Z])[.)]?$/;

function stripMark(text: string): string {
  let out = text.trim();
  for (let n = 0; n < 2 && MARK.test(out); n += 1) out = out.replace(MARK, '').trim();
  return out;
}

const STAGE_WORDS = new Set(['concept', 'conceptual', 'schematic', 'design', 'development', 'detailed', 'detail', 'tender', 'tendering', 'pre', 'post', 'construction', 'gfc', 'feasibility', 'planning', 'commissioning', 'handover', 'completion']);
const STAGE_FILLER = new Set(['stage', 'phase', 'the', 'at', 'for']);
const PACKAGE_WORDS = new Set([
  'civil',
  'structural',
  'structure',
  'architectural',
  'architecture',
  'interior',
  'interiors',
  'external',
  'development',
  'landscape',
  'landscaping',
  'mep',
  'electrical',
  'mechanical',
  'hvac',
  'plumbing',
  'phe',
  'firefighting',
  'fire',
  'fighting',
  'lift',
  'lifts',
  'elevator',
  'elevators',
  'facade',
  'elv',
  'bms',
]);
const PACKAGE_FILLER = new Set(['and', 'package', 'packages', 'work', 'works', 'services', 'the']);

function tokens(text: string): string[] {
  return fold(text).split(' ').filter(Boolean);
}

/** A line that is only a stage's name: "Concept", "Detailed design stage". "Design brief report" is a paper. */
function namesStage(text: string): boolean {
  const all = tokens(text);
  const words = all.filter((w) => !STAGE_FILLER.has(w) && !/^\d+$/.test(w));
  if (!words.length) return all.some((w) => w === 'stage' || w === 'phase');
  return words.every((w) => STAGE_WORDS.has(w)) && words.some((w) => w !== 'design' && w !== 'pre' && w !== 'post');
}

/** A line that is only a package's name: "Civil and structural", "MEP: electrical, HVAC". "Structural drawings" is a paper. */
function namesPackage(text: string): boolean {
  const words = tokens(text).filter((w) => !PACKAGE_FILLER.has(w));
  return words.length > 0 && words.every((w) => PACKAGE_WORDS.has(w));
}

const label = (text: string): string | undefined => clean(stripMark(text).replace(/\s*:\s*$/, ''), CHECKLIST_LIMITS.label);

/**
 * What a heading sets for the lines under it. A stage's name sets the stage
 * and starts its packages afresh; "Tender: MEP" sets both; anything else is
 * a package, because packages are the names that vary.
 */
function headingSets(text: string): { stage?: string; package?: string } {
  const whole = label(text);
  if (!whole) return {};
  if (namesStage(whole)) return { stage: whole, package: undefined };
  if (!namesPackage(whole)) {
    const parts = whole.split(/\s+[-–—|/]\s+|:\s+/);
    if (parts.length === 2 && namesStage(parts[0]!) && parts[1]!.trim()) return { stage: label(parts[0]!), package: label(parts[1]!) };
  }
  return { package: whole };
}

/** A heading by its own writing: a colon to close it, a stage's or a package's name, or capitals where the rest is not. */
function readsAsHeading(text: string, someLowercase: boolean): boolean {
  const bare = stripMark(text);
  if (/:\s*$/.test(bare)) return true;
  if (namesStage(bare) || namesPackage(bare)) return true;
  const parts = bare.split(/\s+[-–—|/]\s+|:\s+/);
  if (parts.length === 2 && namesStage(parts[0]!) && namesPackage(parts[1]!)) return true;
  // Four letters at least: BOQ and NOC are papers.
  return someLowercase && bare === bare.toUpperCase() && /\p{Lu}{4}/u.test(bare);
}

type Column = 'serial' | 'title' | 'stage' | 'package' | 'owedBy' | 'note';

const COLUMN_NAMES: Array<[Column, RegExp]> = [
  ['serial', /^(?:(?:s|sl|sr|serial)\.?\s*(?:no|number|#)\.?|no\.?|#)$/],
  ['stage', /^(?:design |project )?(?:stage|phase)$/],
  ['package', /^(?:work )?(?:package|discipline|trade|section|category)$/],
  ['owedBy', /^(?:owed by|by|by whom|from|required from|responsibility|responsible|action by|to be provided by|provided by|owner|consultant|party)$/],
  ['note', /^(?:notes?|remarks?|comments?)$/],
  ['title', /^(?:items?|documents?|document name|description|item description|particulars|information required|requirements?|deliverables?|title|name)$/],
];

/** The columns a row names, when it is the row that names them: a column for the paper, and one more it knows. */
function columnsOf(row: readonly string[]): Partial<Record<Column, number>> | undefined {
  const found: Partial<Record<Column, number>> = {};
  row.forEach((cell, n) => {
    const name = cell.toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hit = COLUMN_NAMES.find(([key, pattern]) => found[key] === undefined && pattern.test(name));
    if (hit) found[hit[0]] = n;
  });
  return found.title !== undefined && Object.keys(found).length >= 2 ? found : undefined;
}

/**
 * A table of cells as checklist lines.
 *
 * Forgiving, because every consultant lays the list out their own way. A row
 * that names the columns is used when there is one (item, stage, package,
 * owed by, note). Without one the first cell written is the paper and the
 * rest is a note. A row that reads as a heading sets the stage or the
 * package for the rows under it.
 *
 * A row with only the paper's cell written is the hard one: a heading, or a
 * paper whose other columns were left blank. Taking a paper for a heading
 * drops it from the list unseen, so that is the mistake avoided. Such a row
 * is a heading where the rows are numbered and it is not, or where nothing
 * else marks the sections and the table opens with one. A heading with
 * nothing under it was a paper after all.
 */
export function parseChecklistRows(table: readonly (readonly string[])[]): ChecklistDraft[] {
  const rows = table.map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return [];
  const headAt = rows.slice(0, 12).findIndex((r) => columnsOf(r));
  const columns = headAt >= 0 ? columnsOf(rows[headAt]!)! : undefined;
  const body = headAt >= 0 ? rows.slice(headAt + 1) : rows;

  /** One row as the paper's cell and the cells beside it. */
  const read = (row: readonly string[]): { title: string; others: number; numbered: boolean; draft: ChecklistDraft; only?: string } => {
    if (columns) {
      const at = (key: Column) => (columns[key] === undefined ? '' : (row[columns[key]!] ?? ''));
      const written = row.filter((c, n) => c && n !== columns.serial);
      const title = stripMark(at('title'));
      return {
        title,
        others: written.length - (at('title') ? 1 : 0),
        numbered: Boolean(at('serial')),
        draft: { title, stage: at('stage'), package: at('package'), owedBy: at('owedBy'), note: at('note') },
        only: !title && written.length === 1 ? written[0] : undefined,
      };
    }
    const cells = row.filter(Boolean);
    const numbered = cells.length > 1 && SERIAL.test(cells[0]!);
    const written = numbered ? cells.slice(1) : cells;
    const title = stripMark(written[0] ?? '');
    return { title, others: written.length - 1, numbered, draft: { title, note: written.slice(1).join(' · ') } };
  };

  const lines = body.map(read);
  const titled = lines.filter((l) => l.title);
  const someLowercase = titled.some((l) => l.title !== l.title.toUpperCase());
  const marked = (l: (typeof lines)[number]) => Boolean(l.only) || (!l.others && readsAsHeading(l.title, someLowercase));
  const alone = titled.filter((l) => !l.others && !marked(l));
  const numberedTable = titled.filter((l) => l.numbered).length * 2 >= titled.length;
  const sectioned = titled.some((l) => l.others > 0) && !lines.some(marked) && titled[0] === alone[0] && alone.length * 2 < titled.length;
  const mayHead = (l: (typeof lines)[number]) => (numberedTable ? !l.numbered : sectioned);

  const out: ChecklistDraft[] = [];
  let stage: string | undefined;
  let pack: string | undefined;
  /** A lone cell that may head the rows under it: decided by what comes next. */
  let waiting: string | undefined;
  const set = (text: string) => {
    const sets = headingSets(text);
    if ('stage' in sets) stage = sets.stage;
    pack = sets.package;
  };
  const add = (draft: ChecklistDraft) => {
    const title = clean(draft.title.replace(/\s*:\s*$/, ''), CHECKLIST_LIMITS.title);
    if (!title) return;
    out.push({
      title,
      stage: clean(draft.stage, CHECKLIST_LIMITS.label) ?? stage,
      package: clean(draft.package, CHECKLIST_LIMITS.label) ?? pack,
      owedBy: clean(draft.owedBy, CHECKLIST_LIMITS.label),
      note: clean(draft.note, CHECKLIST_LIMITS.note),
    });
  };
  const settle = (asHeading: boolean) => {
    if (waiting === undefined) return;
    if (asHeading) set(waiting);
    else add({ title: waiting });
    waiting = undefined;
  };

  for (const line of lines) {
    if (line.only) {
      settle(false);
      set(line.only);
      continue;
    }
    if (!line.title) continue;
    if (!line.others && readsAsHeading(line.title, someLowercase)) {
      settle(false);
      set(line.title);
      continue;
    }
    if (!line.others && mayHead(line)) {
      settle(false);
      waiting = line.title;
      continue;
    }
    settle(true);
    add(line.draft);
  }
  settle(false);
  return out;
}

/** One line of a CSV as its cells: a quoted cell keeps its commas. */
export function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * Pasted text, or a CSV or TSV file's.
 *
 * Tabs make it a table, as a paste from a spreadsheet is. Commas make it one
 * only when the first line names the columns, or the caller says it is a
 * CSV: a paper's own name may carry a comma. Otherwise each line is a paper.
 */
export function parseChecklist(text: string, opts: { csv?: boolean } = {}): ChecklistDraft[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  if (lines.some((l) => l.includes('\t'))) return parseChecklistRows(lines.map((l) => l.split('\t')));
  if (opts.csv || columnsOf(csvCells(lines[0]!).map((c) => c.trim()))) return parseChecklistRows(lines.map(csvCells));
  return parseChecklistRows(lines.map((l) => [l]));
}

/**
 * A workbook's sheets. Where a list is kept a sheet to a stage or a sheet to
 * a package, the sheet's own name heads the lines on it that say no more.
 */
export function parseChecklistSheets(sheets: ReadonlyArray<{ name: string; rows: readonly (readonly string[])[] }>): ChecklistDraft[] {
  const read = sheets.map((sheet) => ({ name: sheet.name, drafts: parseChecklistRows(sheet.rows) })).filter((sheet) => sheet.drafts.length);
  const named = read.length > 1;
  return read.flatMap((sheet) => {
    const sets = named && !/^sheet\s*\d*$/i.test(sheet.name.trim()) ? headingSets(sheet.name) : {};
    return sheet.drafts.map((d) => ({ ...d, stage: d.stage ?? sets.stage, package: d.package ?? sets.package }));
  });
}

/* ==================================================================== */
/* Changing it                                                           */
/* ==================================================================== */

/** What a tracked list says of a line beyond its name: where it sits, when it was asked for and what came back. Absent members are left out, so a plain line is stored as it always was. */
function listed(draft: ChecklistDraft): Partial<Pick<ChecklistItem, 'list' | 'ref' | 'oldRef' | 'headings' | 'order' | 'fn' | 'round' | 'availability' | 'targetDate'>> {
  const out: Partial<Pick<ChecklistItem, 'list' | 'ref' | 'oldRef' | 'headings' | 'order' | 'fn' | 'round' | 'availability' | 'targetDate'>> = {};
  const [list, ref, oldRef, fn, round, availability] = [clean(draft.list, CHECKLIST_LIMITS.label), clean(draft.ref, CHECKLIST_LIMITS.ref), clean(draft.oldRef, CHECKLIST_LIMITS.ref), clean(draft.fn, 80), clean(draft.round, CHECKLIST_LIMITS.label), clean(draft.availability, CHECKLIST_LIMITS.label)];
  const headings = cleanHeadings(draft.headings);
  const targetDate = listDay(draft.targetDate);
  if (list) out.list = list;
  if (ref) out.ref = ref;
  if (oldRef) out.oldRef = oldRef;
  if (headings) out.headings = headings;
  if (typeof draft.order === 'number' && Number.isFinite(draft.order)) out.order = draft.order;
  if (fn) out.fn = fn;
  if (round) out.round = round;
  if (availability) out.availability = availability;
  if (targetDate) out.targetDate = targetDate;
  return out;
}

/** How a list's own status column makes a new line stand, with the remark it carries. */
function standsAs(draft: ChecklistDraft, at: string, actor: string): Partial<Pick<ChecklistItem, 'received' | 'partial' | 'assumed' | 'remark'>> {
  const remark = clean(draft.remark, CHECKLIST_LIMITS.remark);
  return {
    ...(remark ? { remark: { text: remark, from: 'list' as const, by: actor, at } } : {}),
    ...(draft.status === 'received' ? { received: { at, by: actor, fromList: true as const } } : {}),
    ...(draft.status === 'partial' ? { partial: { at, by: actor } } : {}),
    ...(draft.status === 'assumed' ? { assumed: { at, by: actor, assumer: clean(draft.assumer, CHECKLIST_LIMITS.label) ?? LIST_ASSUMER } } : {}),
  };
}

/** Who assumes, where a list says a line is to be assumed and names nobody. */
export const LIST_ASSUMER = 'The consultant';

/**
 * Put lines on the project. A line already there (the same paper, stage and
 * package) is left as it is, so the same list loaded twice is one list.
 */
export function addChecklistItems(
  project: DdProject,
  department: DepartmentKey,
  drafts: readonly ChecklistDraft[],
  actor: string,
  opts: { load?: string } = {},
): { added: ChecklistItem[]; skipped: number; skippedTitles: string[] } {
  const items = itemsOf(project);
  const skippedTitles: string[] = [];
  const held = new Set(items.filter((i) => i.department === department).map(lineKey));
  const at = nowIso();
  const added: ChecklistItem[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    const title = clean(draft.title, CHECKLIST_LIMITS.title);
    if (!title) continue;
    const line = { title, stage: clean(draft.stage, CHECKLIST_LIMITS.label), package: clean(draft.package, CHECKLIST_LIMITS.label), ...listed(draft) };
    const key = lineKey(line);
    if (held.has(key)) {
      skipped += 1;
      skippedTitles.push(title);
      continue;
    }
    held.add(key);
    added.push({
      id: newId('chk'),
      department,
      ...line,
      ...(opts.load ? { load: opts.load } : {}),
      owedBy: clean(draft.owedBy, CHECKLIST_LIMITS.label),
      note: clean(draft.note, CHECKLIST_LIMITS.note),
      ...standsAs(draft, at, actor),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
    });
  }
  // Counted before any line is put on the list: a list that does not fit leaves the project as it was.
  if (items.length + added.length > CHECKLIST_LIMITS.items) throw new Error(`The list holds ${CHECKLIST_LIMITS.items} lines at most.`);
  items.push(...added);
  if (added.length) audit(project, actor, 'checklist_added', added[0]!.id, added.length === 1 ? added[0]!.title : `${added.length} lines`);
  return { added, skipped, skippedTitles };
}

export function addChecklistItem(project: DdProject, department: DepartmentKey, draft: ChecklistDraft, actor: string): ChecklistItem {
  if (!clean(draft.title, CHECKLIST_LIMITS.title)) throw new Error('Name the paper.');
  const { added } = addChecklistItems(project, department, [draft], actor);
  if (!added[0]) throw new Error('That is already on the list.');
  return added[0];
}

/** Rename a line, or move it to another stage, package or party. `null` clears. */
export function patchChecklistItem(project: DdProject, itemId: string, patch: ChecklistPatch, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  const before = item.title;
  const next = { ...item };
  if (patch.title !== undefined) {
    const title = clean(patch.title, CHECKLIST_LIMITS.title);
    if (!title) throw new Error('Name the paper.');
    next.title = title;
  }
  if (patch.stage !== undefined) next.stage = clean(patch.stage, CHECKLIST_LIMITS.label);
  if (patch.package !== undefined) next.package = clean(patch.package, CHECKLIST_LIMITS.label);
  if (patch.owedBy !== undefined) next.owedBy = clean(patch.owedBy, CHECKLIST_LIMITS.label);
  if (patch.note !== undefined) next.note = clean(patch.note, CHECKLIST_LIMITS.note);
  if (patch.round !== undefined) next.round = clean(patch.round, CHECKLIST_LIMITS.label);
  if (patch.targetDate !== undefined) {
    const day = patch.targetDate === null || !patch.targetDate.trim() ? undefined : listDay(patch.targetDate);
    if (patch.targetDate?.trim() && !day) throw new Error('Give the day it is wanted by as a date.');
    next.targetDate = day;
  }
  if (patch.remark !== undefined) {
    const text = clean(patch.remark, CHECKLIST_LIMITS.remark);
    next.remark = text ? (text === item.remark?.text ? item.remark : { text, from: 'person', by: actor, at: nowIso() }) : undefined;
  }
  const key = lineKey(next);
  if ((project.checklist ?? []).some((i) => i.id !== item.id && i.department === item.department && lineKey(i) === key)) {
    throw new Error('That is already on the list.');
  }
  Object.assign(item, next, { updatedAt: nowIso() });
  audit(project, actor, 'checklist_updated', item.id, item.title, before === item.title ? undefined : before);
  return item;
}

export function removeChecklistItem(project: DdProject, itemId: string, actor: string): void {
  const item = findItem(project, itemId);
  project.checklist = (project.checklist ?? []).filter((i) => i.id !== itemId);
  audit(project, actor, 'checklist_removed', item.id, undefined, item.title);
}

/**
 * A person says the paper is in hand, and which document it is where they
 * can name it. This is also how an offered match is confirmed.
 */
export function receiveChecklistItem(project: DdProject, itemId: string, input: { evidenceId?: string }, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  const row = input.evidenceId ? project.evidence.find((e) => e.id === input.evidenceId) : undefined;
  if (input.evidenceId && !row) throw new Error(`Evidence ${input.evidenceId} not found`);
  const at = nowIso();
  item.received = { at, by: actor, ...(row ? { evidenceId: row.id } : {}) };
  // In hand is all of it: a line no longer stands as partly in hand or as one that will not come.
  delete item.partial;
  delete item.assumed;
  if (row && item.dismissed) item.dismissed = item.dismissed.filter((id) => id !== row.id);
  item.updatedAt = at;
  audit(project, actor, 'checklist_received', item.id, row ? `${item.title} · ${row.title}` : item.title);
  return item;
}

/** Take back a person's "in hand". A document that carries the line's name still answers it. */
export function reopenChecklistItem(project: DdProject, itemId: string, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  delete item.received;
  item.updatedAt = nowIso();
  audit(project, actor, 'checklist_reopened', item.id, item.title);
  return item;
}

/** A person says a document is not this paper. It is not offered for the line again, and does not answer it by name. */
export function dismissChecklistMatch(project: DdProject, itemId: string, evidenceId: string, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  if (!project.evidence.some((e) => e.id === evidenceId)) throw new Error(`Evidence ${evidenceId} not found`);
  if (!item.dismissed?.includes(evidenceId)) item.dismissed = [...(item.dismissed ?? []), evidenceId];
  if (item.received?.evidenceId === evidenceId) delete item.received;
  item.updatedAt = nowIso();
  audit(project, actor, 'checklist_match_dismissed', item.id, item.title);
  return item;
}

/**
 * A person says some of it is in hand and the rest is still owed, with a
 * short line on what is still wanted. `null` takes that back.
 */
export function markChecklistPartial(project: DdProject, itemId: string, input: { wanted?: string | null } | null, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  const at = nowIso();
  if (!input) delete item.partial;
  else {
    const wanted = clean(input.wanted, CHECKLIST_LIMITS.remark);
    item.partial = { at, by: actor, ...(wanted ? { wanted } : {}) };
    delete item.received;
    delete item.assumed;
  }
  item.updatedAt = at;
  audit(project, actor, input ? 'checklist_partial' : 'checklist_partial_cleared', item.id, item.title);
  return item;
}

/**
 * A person says it will not come, and names who proceeds on an assumption.
 * `fields` are the fields the line stands in for, each with the value it is
 * assumed at: checked against its field by the caller (`assumeChecklistItem`
 * in `list-assumptions.ts`). `null` takes it back.
 */
export function markChecklistAssumed(project: DdProject, itemId: string, input: { assumer: string; fields?: readonly ChecklistAssumedField[] } | null, actor: string): ChecklistItem {
  const item = findItem(project, itemId);
  const at = nowIso();
  if (!input) delete item.assumed;
  else {
    const assumer = clean(input.assumer, CHECKLIST_LIMITS.label);
    if (!assumer) throw new Error('Name who is to assume.');
    if ((input.fields ?? []).length > CHECKLIST_LIMITS.assumedFields) throw new Error(`A line stands in for ${CHECKLIST_LIMITS.assumedFields} fields at most.`);
    const fields = (input.fields ?? []).map((f) => ({ address: { fn: f.address.fn, set: f.address.set, field: f.address.field, ...(f.address.record ? { record: f.address.record } : {}) }, value: f.value }));
    item.assumed = { at, by: actor, assumer, ...(fields.length ? { fields } : {}) };
    delete item.received;
    delete item.partial;
  }
  item.updatedAt = at;
  audit(project, actor, input ? 'checklist_assumed' : 'checklist_assumed_cleared', item.id, input ? `${item.title} · ${item.assumed!.assumer}` : item.title);
  return item;
}

/**
 * Name who owes several lines, and the day they are wanted by, in one act.
 * Only what is given is set: a party alone leaves each line's day as it was.
 */
export interface ChecklistSetInput {
  owedBy?: string | null;
  targetDate?: string | null;
  /** How every line picked is made to stand: in hand, partly in hand, to be assumed, or asked for on a day. */
  standing?: 'in_hand' | 'partial' | 'assumed' | 'asked';
  /** With `partial`: what is still wanted. */
  wanted?: string | null;
  /** With `assumed`: who is to assume. */
  assumer?: string;
  /** With `asked`: the day they were asked for. Today where none is given. */
  askedOn?: string | null;
}

/**
 * Set several lines together, in one act: who owes them, the day they are
 * wanted by, and how they stand. Only what is given is set: a party alone
 * leaves each line's day as it was. A line marked to be assumed here keeps
 * the fields it already stood in for.
 */
export function assignChecklistItems(project: DdProject, itemIds: readonly string[], input: ChecklistSetInput, actor: string): ChecklistItem[] {
  const owedBy = input.owedBy === undefined ? undefined : (clean(input.owedBy, CHECKLIST_LIMITS.label) ?? null);
  const targetDate = input.targetDate === undefined ? undefined : input.targetDate === null || !input.targetDate.trim() ? null : listDay(input.targetDate);
  if (input.targetDate?.trim() && !targetDate) throw new Error('Give the day they are wanted by as a date.');
  if (owedBy === undefined && targetDate === undefined && !input.standing) throw new Error('Name who owes them, the day they are wanted by, or how they stand.');
  const assumer = clean(input.assumer, CHECKLIST_LIMITS.label);
  if (input.standing === 'assumed' && !assumer) throw new Error('Name who is to assume.');
  const askedOn = input.askedOn?.trim() ? listDay(input.askedOn) : undefined;
  if (input.askedOn?.trim() && !askedOn) throw new Error('Give the day they were asked for as a date.');
  const wanted = clean(input.wanted, CHECKLIST_LIMITS.remark);
  const items = [...new Set(itemIds)].map((id) => findItem(project, id));
  if (!items.length) throw new Error('Pick the lines.');
  const at = nowIso();
  for (const item of items) {
    if (owedBy !== undefined) item.owedBy = owedBy ?? undefined;
    if (targetDate !== undefined) item.targetDate = targetDate ?? undefined;
    if (input.standing === 'in_hand') {
      if (!item.received) item.received = { at, by: actor };
      delete item.partial;
      delete item.assumed;
    } else if (input.standing === 'partial') {
      item.partial = { at, by: actor, ...(wanted ? { wanted } : {}) };
      delete item.received;
      delete item.assumed;
    } else if (input.standing === 'assumed') {
      item.assumed = { at, by: actor, assumer: assumer!, ...(item.assumed?.fields?.length ? { fields: item.assumed.fields } : {}) };
      delete item.received;
      delete item.partial;
    } else if (input.standing === 'asked') {
      item.askedOn = askedOn ?? at.slice(0, 10);
    }
    item.updatedAt = at;
  }
  audit(project, actor, 'checklist_assigned', items[0]!.id, [`${items.length} ${items.length === 1 ? 'line' : 'lines'}`, input.standing ?? '', owedBy ?? '', targetDate ?? ''].filter(Boolean).join(' · '));
  return items;
}

/**
 * Take a whole load back, or a whole list off: every line one load put on
 * the project (`load`), or every line of one tracked list (`list`). What a
 * later copy of a list changed on lines an earlier load made is not undone
 * by taking the later load back: those lines are the earlier load's.
 */
export function removeChecklistLoad(project: DdProject, which: { load?: string; list?: string }, actor: string): ChecklistItem[] {
  const list = clean(which.list, CHECKLIST_LIMITS.label);
  if (!which.load && !list) throw new Error('Say which load, or which list.');
  const gone = (project.checklist ?? []).filter((item) => (which.load ? item.load === which.load : fold(item.list) === fold(list)));
  if (!gone.length) throw new Error('No line of that is on the list.');
  const ids = new Set(gone.map((item) => item.id));
  project.checklist = (project.checklist ?? []).filter((item) => !ids.has(item.id));
  audit(project, actor, 'checklist_load_removed', gone[0]!.id, undefined, `${gone.length} ${gone.length === 1 ? 'line' : 'lines'}${list ? ` of ${list}` : ''}`);
  return gone;
}

/** The lists and loads a project's lines came from, each with how many lines it holds and the desks they are on. */
export function checklistLoads(project: Pick<DdProject, 'checklist'>): Array<{ list?: string; load?: string; lines: number; departments: DepartmentKey[] }> {
  const out = new Map<string, { list?: string; load?: string; lines: number; departments: DepartmentKey[] }>();
  for (const item of project.checklist ?? []) {
    if (!item.list && !item.load) continue;
    const key = item.list ? `list:${fold(item.list)}` : `load:${item.load}`;
    const held = out.get(key) ?? { ...(item.list ? { list: item.list } : { load: item.load }), lines: 0, departments: [] };
    out.set(key, held);
    held.lines += 1;
    if (!held.departments.includes(item.department)) held.departments.push(item.department);
  }
  return [...out.values()];
}

/* ==================================================================== */
/* A tracked list, loaded again                                          */
/* ==================================================================== */

/** What loading a tracked list did, or would do: each line named by its number and its paper. */
export interface ListLoadReport {
  list: string;
  added: string[];
  becameReceived: string[];
  becamePartial: string[];
  becameAssumed: string[];
  /** In hand on the last copy, pending on this one. */
  reopened: string[];
  /** On the project from an earlier copy and not on this one. Kept, and said. */
  gone: string[];
  /** Lines matched whose words or place changed, standing as they did. */
  updated: number;
  unchanged: number;
}

const named = (line: Pick<ChecklistDraft, 'ref' | 'title'>): string => (line.ref ? `${line.ref} ${line.title}` : line.title);

function listStatusOf(item: ChecklistItem): ChecklistListStatus {
  return item.received ? 'received' : item.assumed ? 'assumed' : item.partial ? 'partial' : 'pending';
}

/**
 * Load a tracked list: one with numbers and a status column, which is sent
 * again each time it moves.
 *
 * A line already on the project from an earlier copy of the same list is
 * UPDATED, never added twice. It is matched by its number, and by its paper's
 * name where the number moved. The list's status column makes a line stand:
 * received is in hand, partial is partly in hand, "to assume" is to be
 * assumed, and pending puts back a line the last copy called received. What a
 * person did here is not undone by the list: a line they marked in hand
 * stays in hand, and a party or a day they set is kept where the list gives
 * none.
 *
 * A line of an earlier copy that this copy leaves out is kept and said
 * (`gone`). `department` is the desk for a draft whose package names none.
 * With `dryRun` nothing is changed and the report says what would be.
 */
export function loadTrackedList(
  project: DdProject,
  department: DepartmentKey,
  drafts: ReadonlyArray<ChecklistDraft & { department?: DepartmentKey }>,
  actor: string,
  opts: { dryRun?: boolean; openOnly?: boolean; load?: string } = {},
): ListLoadReport {
  const list = clean(drafts.find((d) => d.list)?.list, CHECKLIST_LIMITS.label) ?? 'List';
  const report: ListLoadReport = { list, added: [], becameReceived: [], becamePartial: [], becameAssumed: [], reopened: [], gone: [], updated: 0, unchanged: 0 };
  const held = (project.checklist ?? []).filter((i) => fold(i.list) === fold(list));
  const matched = new Set<string>();
  const at = nowIso();
  const fresh: Array<ChecklistDraft & { department?: DepartmentKey }> = [];
  const refOf = (line: { ref?: string }) => clean(line.ref, CHECKLIST_LIMITS.ref)?.toLowerCase();
  // Which line of the last copy each line of this one is. First the lines whose number and name are both as they were; then
  // the ones whose number moved, by their name where one line has it; then the ones reworded under the number they had.
  const pairs = new Map<number, ChecklistItem>();
  const pair = (n: number, item: ChecklistItem | undefined) => {
    if (!item) return;
    pairs.set(n, item);
    matched.add(item.id);
  };
  const open = () => held.filter((i) => !matched.has(i.id));
  drafts.forEach((draft, n) => pair(n, open().find((i) => i.ref && refOf(i) === refOf(draft) && fold(i.title) === fold(draft.title))));
  // A list with no numbers: a line is its name within the sections it sits under, so the same name under two phases is two lines.
  drafts.forEach((draft, n) => {
    if (!pairs.has(n) && !refOf(draft)) pair(n, open().find((i) => !i.ref && fold(i.title) === fold(draft.title) && sectionPath(i) === sectionPath(draft)));
  });
  drafts.forEach((draft, n) => {
    if (pairs.has(n)) return;
    const same = open().filter((i) => fold(i.title) === fold(draft.title));
    const under = same.filter((i) => sectionPath(i) === sectionPath(draft));
    if (under.length === 1) pair(n, under[0]);
    else if (same.length === 1) pair(n, same[0]);
  });
  drafts.forEach((draft, n) => {
    if (!pairs.has(n) && refOf(draft)) pair(n, open().find((i) => refOf(i) === refOf(draft)));
  });

  for (const [n, draft] of drafts.entries()) {
    const title = clean(draft.title, CHECKLIST_LIMITS.title);
    if (!title) continue;
    const item = pairs.get(n);
    // A form's rows already answered are not papers owed: only a line still open is added from one.
    if (!item && opts.openOnly && draft.status === 'received') continue;
    if (!item) {
      fresh.push({ ...draft, list });
      report.added.push(named({ ref: draft.ref, title }));
      continue;
    }
    const was = listStatusOf(item);
    const now: ChecklistListStatus = draft.status ?? 'pending';
    const next: ChecklistItem = { ...item, title, ...listed({ ...draft, list }) };
    const pack = clean(draft.package, CHECKLIST_LIMITS.label);
    if (pack) next.package = pack;
    const owedBy = clean(draft.owedBy, CHECKLIST_LIMITS.label);
    if (owedBy) next.owedBy = owedBy;
    const note = clean(draft.note, CHECKLIST_LIMITS.note);
    if (note) next.note = note;
    const remark = clean(draft.remark, CHECKLIST_LIMITS.remark);
    // The list's own remark follows the list. A person's is theirs, and is kept until the list says something else.
    if (remark && remark !== item.remark?.text) next.remark = { text: remark, from: 'list', by: actor, at };
    else if (!remark && item.remark?.from === 'list') delete next.remark;
    // A line a person settled here is not moved by the list.
    const byHand = Boolean(item.received && !item.received.fromList);
    const moves = !byHand && now !== was;
    if (moves) {
      delete next.received;
      delete next.partial;
      delete next.assumed;
      if (now === 'received') next.received = { at, by: actor, fromList: true };
      if (now === 'partial') next.partial = { at, by: actor };
      if (now === 'assumed') next.assumed = { at, by: actor, assumer: clean(draft.assumer, CHECKLIST_LIMITS.label) ?? LIST_ASSUMER };
      const line = named({ ref: next.ref, title });
      if (now === 'received') report.becameReceived.push(line);
      else if (now === 'partial') report.becamePartial.push(line);
      else if (now === 'assumed') report.becameAssumed.push(line);
      else report.reopened.push(line);
    } else if (!byHand && now === 'assumed' && item.assumed) {
      const assumer = clean(draft.assumer, CHECKLIST_LIMITS.label);
      if (assumer && assumer !== item.assumed.assumer) next.assumed = { ...item.assumed, assumer };
    }
    if (draft.department && draft.department !== item.department) next.department = draft.department;
    const { updatedAt: _was, ...before } = item;
    const { updatedAt: _now, ...after } = next;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      report.unchanged += 1;
      continue;
    }
    if (!moves) report.updated += 1;
    if (!opts.dryRun) {
      for (const key of Object.keys(item) as Array<keyof ChecklistItem>) if (!(key in next)) delete item[key];
      Object.assign(item, next, { updatedAt: at });
    }
  }
  report.gone = held.filter((i) => !matched.has(i.id)).map((i) => named(i));
  if ((project.checklist ?? []).length + fresh.length > CHECKLIST_LIMITS.items) throw new Error(`The list holds ${CHECKLIST_LIMITS.items} lines at most.`);
  if (opts.dryRun) return report;
  const items = itemsOf(project);
  for (const draft of fresh) {
    items.push({
      id: newId('chk'),
      department: draft.department ?? department,
      title: clean(draft.title, CHECKLIST_LIMITS.title)!,
      stage: clean(draft.stage, CHECKLIST_LIMITS.label),
      package: clean(draft.package, CHECKLIST_LIMITS.label),
      ...listed(draft),
      ...(opts.load ? { load: opts.load } : {}),
      owedBy: clean(draft.owedBy, CHECKLIST_LIMITS.label),
      note: clean(draft.note, CHECKLIST_LIMITS.note),
      ...standsAs(draft, at, actor),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
    });
  }
  const moved = report.becameReceived.length + report.becamePartial.length + report.becameAssumed.length + report.reopened.length;
  if (fresh.length || moved || report.updated) {
    audit(project, actor, 'checklist_list_loaded', items.find((i) => fold(i.list) === fold(list))?.id ?? list, [list, fresh.length ? `${fresh.length} added` : '', moved ? `${moved} moved` : '', report.updated ? `${report.updated} updated` : ''].filter(Boolean).join(' · '));
  }
  return report;
}

/** A load's report in one line, for the notice that follows it. */
export function listLoadSaid(report: ListLoadReport): string {
  const part = (n: number, said: string) => (n ? `${n} ${said}` : '');
  const out = [
    part(report.added.length, 'added'),
    part(report.becameReceived.length, 'now received'),
    part(report.becamePartial.length, 'now partial'),
    part(report.becameAssumed.length, 'now to be assumed'),
    part(report.reopened.length, 'pending again'),
    part(report.updated, 'updated'),
    part(report.gone.length, 'no longer on the list'),
  ].filter(Boolean);
  return out.length ? out.join(' · ') : `Nothing changed: ${report.unchanged} ${report.unchanged === 1 ? 'line' : 'lines'} as they were`;
}

/** The list's name, as a citation says it. `papers-owed.ts` gives the screens the same words. */
const PAPERS_OWED_NAME = 'Papers owed';

/**
 * The values that stand in for fields because a paper will not come: every
 * field a line "to be assumed" names, by its address, with the value and the
 * line that is the reason. Read by the field resolver, which shows such a
 * value as assumed until a real one is typed or accepted.
 */
export function listAssumptions(project: Pick<DdProject, 'checklist'>): Map<string, { value: string | number | boolean; cite: string }> {
  const out = new Map<string, { value: string | number | boolean; cite: string }>();
  for (const item of project.checklist ?? []) {
    if (!item.assumed?.fields?.length || item.received) continue;
    for (const field of item.assumed.fields) {
      const key = `${field.address.set}::${field.address.record ?? ''}::${field.address.field}`;
      if (!out.has(key)) out.set(key, { value: field.value, cite: `${PAPERS_OWED_NAME}: ${named(item)}, ${item.assumed.assumer} to assume`.slice(0, 240) });
    }
  }
  return out;
}

/* ==================================================================== */
/* The sheet                                                             */
/* ==================================================================== */

export interface ChecklistLine {
  item: ChecklistItem;
  status: RequirementStatus;
  /** The document that answers it, by a person's word or by its name. */
  evidenceId?: string;
  fileName?: string;
  receivedAt?: string;
  /** A person marked it; otherwise a filed document carries its name. */
  byHand?: boolean;
  /** A filed document that may be this paper. Nothing is in hand until a person confirms it. */
  suggestion?: { evidenceId: string; title: string; score: number };
  /** Who was asked, and by when, when a request is out for it. */
  askedOf?: string;
  dueAt?: string;
  overdue?: boolean;
  requestId?: string;
  /**
   * Partly in hand, with the rest still owed: its `status` goes on saying whether the rest was asked for. Or to be
   * assumed: it will not come, nobody is chased for it, and it is counted neither as owed nor as in hand.
   */
  mark?: 'partial' | 'assumed';
}

export interface ChecklistPackageGroup {
  key: string;
  label: string;
  lines: ChecklistLine[];
  received: number;
  total: number;
}

export interface ChecklistStageGroup {
  key: string;
  label: string;
  packages: ChecklistPackageGroup[];
  received: number;
  total: number;
}

export interface ChecklistSheet {
  stages: ChecklistStageGroup[];
  total: number;
  received: number;
  requested: number;
  pending: number;
  overdue: number;
  /** Lines with a document offered and waiting on a person. */
  toConfirm: number;
  /** Lines partly in hand, and lines that will not come and are to be assumed. */
  partial: number;
  assumed: number;
  /** Whole percent in hand; 0 on an empty sheet. */
  percent: number;
  /** What is missing and not yet asked for, by who owes it. The lines no party is named for come last, under no name. */
  owing: Array<{ owedBy?: string; lines: ChecklistLine[] }>;
}

export const CHECKLIST_NO_STAGE = 'No stage';
export const CHECKLIST_NO_PACKAGE = 'No package';

const HELD: ReadonlySet<string> = new Set(['received', 'validated', 'used']);

/** A document on file: in hand, with its file, not replaced by a later one, and not an outside reply still waiting for a person. */
function filed(row: EvidenceRecord): boolean {
  return HELD.has(row.status) && row.attachments.length > 0 && !row.supersededById && !row.unconfirmedReply;
}

/** Every name a document goes by: its title, what it was read as, and its files' names. */
function namesOf(row: EvidenceRecord): string[] {
  return [row.title, row.documentType, row.fileName, ...row.attachments.map((a) => a.fileName)].filter((n): n is string => Boolean(n?.trim()));
}

/** Those names as they are compared. Only a file's name loses an extension: a title ending ".2" keeps it. */
function foldedNamesOf(row: EvidenceRecord): Set<string> {
  return new Set([fold(row.title), fold(row.documentType), foldFile(row.fileName), ...row.attachments.map((a) => foldFile(a.fileName))].filter(Boolean));
}

/**
 * Filed documents against the lines still open.
 *
 * `sure` is a document that carries a line's own name, and only one open
 * line has that name: it answers the line. `offered` is the register's own
 * filename matching (`file-match.ts`) run with the lines as the rows that
 * wait: good enough to show a person, never enough to mark a paper in hand.
 */
function matchDocuments(open: readonly ChecklistItem[], documents: readonly EvidenceRecord[]): { sure: Map<string, EvidenceRecord>; offered: Map<string, { row: EvidenceRecord; score: number }> } {
  const sure = new Map<string, EvidenceRecord>();
  const offered = new Map<string, { row: EvidenceRecord; score: number }>();
  if (!open.length || !documents.length) return { sure, offered };
  const sameName = new Map<string, number>();
  for (const item of open) sameName.set(fold(item.title), (sameName.get(fold(item.title)) ?? 0) + 1);
  const rows: MatchRow[] = open.map((item) => ({ id: item.id, title: item.title, status: 'expected' }));
  const byId = new Map(open.map((item) => [item.id, item]));

  for (const row of documents) {
    const names = namesOf(row);
    const folded = foldedNamesOf(row);
    for (const item of open) {
      if (sure.has(item.id) || item.dismissed?.includes(row.id)) continue;
      if (folded.has(fold(item.title)) && sameName.get(fold(item.title)) === 1) sure.set(item.id, row);
    }
    for (const match of matchFilesToEvidence(rows, names)) {
      const candidates = [match.evidenceId, match.ambiguousWith?.evidenceId].filter((id): id is string => Boolean(id));
      for (const id of candidates) {
        if (byId.get(id)?.dismissed?.includes(row.id)) continue;
        // A word any paper carries is no likeness: "client" in a line and in a file's name offers nothing.
        if (!sharesEnough(byId.get(id)!.title, names)) continue;
        const best = offered.get(id);
        if (!best || match.score > best.score) offered.set(id, { row, score: match.score });
      }
    }
  }
  return { sure, offered };
}

/** Words that say nothing of which paper a paper is. */
const GENERIC = new Set(['client', 'drawing', 'detail', 'report', 'list', 'work', 'information', 'document', 'copy', 'final', 'project', 'file', 'revision', 'rev', 'the', 'and', 'for', 'with', 'from', 'all', 'pdf', 'required', 'latest', 'data', 'sheet', 'schedule', 'plan', 'statement']);

const meaningful = (text: string): Set<string> =>
  new Set(
    fold(text)
      .split(' ')
      .map((word) => (word.length > 4 ? word.replace(/s$/, '') : word))
      .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !GENERIC.has(word)),
  );

/**
 * Whether a document may be offered for a line: its names share two words
 * that mean something with the line's, or the one such word the line has.
 */
function sharesEnough(title: string, names: readonly string[]): boolean {
  const wanted = meaningful(title);
  if (!wanted.size) return false;
  const need = Math.min(2, wanted.size);
  return names.some((name) => {
    const held = meaningful(foldFile(name));
    return [...wanted].filter((word) => held.has(word)).length >= need;
  });
}

function fileOf(row: EvidenceRecord | undefined): Pick<ChecklistLine, 'evidenceId' | 'fileName'> {
  return row ? { evidenceId: row.id, fileName: row.attachments[0]?.fileName ?? row.fileName ?? row.title } : {};
}

/**
 * Lines in the order their list writes them. A line of a tracked list sits at
 * its own place in that list, wherever a later copy added it; every other
 * line, and each list among the others, stays where it was put.
 */
function inListOrder(items: readonly ChecklistItem[]): ChecklistItem[] {
  const first = new Map<string, number>();
  items.forEach((item, n) => {
    if (item.list && item.order !== undefined && !first.has(fold(item.list))) first.set(fold(item.list), n);
  });
  const place = (item: ChecklistItem, n: number): [number, number] => (item.list && item.order !== undefined ? [first.get(fold(item.list))!, item.order] : [n, -1]);
  return items
    .map((item, n) => ({ item, at: place(item, n), n }))
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.n - b.n)
    .map((held) => held.item);
}

/**
 * The checklist as it is worked: by stage, then by package, each with how
 * many are in hand, and who owes what is missing.
 *
 * `department` narrows it to one desk's list.
 */
export function checklistSheet(project: DdProject, opts: { department?: DepartmentKey; now?: string } = {}): ChecklistSheet {
  const today = (opts.now ?? nowIso()).slice(0, 10);
  const items = inListOrder((project.checklist ?? []).filter((i) => !opts.department || i.department === opts.department));
  const linked = new Set(items.map((i) => i.received?.evidenceId).filter(Boolean));
  const { sure, offered } = matchDocuments(
    items.filter((i) => !i.received),
    project.evidence.filter((e) => filed(e) && !linked.has(e.id)),
  );
  const asked = new Map<string, ProjectRequest>();
  for (const request of project.requests ?? []) {
    if (request.status !== 'sent') continue;
    for (const id of request.checklistItemIds ?? []) asked.set(id, request);
  }

  const lines: ChecklistLine[] = items.map((item) => {
    if (item.received) {
      const row = item.received.evidenceId ? project.evidence.find((e) => e.id === item.received!.evidenceId) : undefined;
      return { item, status: 'received', byHand: true, receivedAt: item.received.at, ...fileOf(row) };
    }
    const named = sure.get(item.id);
    if (named) return { item, status: 'received', receivedAt: named.attachments[0]?.uploadedAt ?? named.updatedAt, ...fileOf(named) };
    const offer = offered.get(item.id);
    const suggestion = offer ? { evidenceId: offer.row.id, title: offer.row.title, score: offer.score } : undefined;
    // It will not come: nobody is chased for it, and no day is waited for.
    if (item.assumed) return { item, status: 'pending', mark: 'assumed', suggestion };
    const mark = item.partial ? { mark: 'partial' as const } : {};
    const request = asked.get(item.id);
    // The day it is wanted by: the request's where one is out, else the line's own. Past it, the line is overdue.
    const dueAt = request?.dueAt ?? item.targetDate;
    const due = dueAt ? { dueAt, overdue: dueAt.slice(0, 10) < today } : {};
    if (request) return { item, status: 'requested', suggestion, askedOf: request.recipient, dueAt: request.dueAt, overdue: undefined, ...due, requestId: request.id, ...mark };
    // A line a list says was asked for in a round, or a person says was asked for on a day, has been asked for, though no request went from here.
    if (item.round || item.askedOn) return { item, status: 'requested', suggestion, ...due, ...mark };
    return { item, status: 'pending', suggestion, ...(due.overdue ? due : item.targetDate ? { dueAt: item.targetDate } : {}), ...mark };
  });

  // In the order the list was written: a stage where it first appears, its packages likewise.
  const stages = new Map<string, { label: string; packages: Map<string, { label: string; lines: ChecklistLine[] }> }>();
  for (const line of lines) {
    const stageLabel = line.item.stage ?? CHECKLIST_NO_STAGE;
    const packLabel = line.item.package ?? CHECKLIST_NO_PACKAGE;
    const stage = stages.get(fold(stageLabel)) ?? { label: stageLabel, packages: new Map() };
    stages.set(fold(stageLabel), stage);
    const pack = stage.packages.get(fold(packLabel)) ?? { label: packLabel, lines: [] };
    stage.packages.set(fold(packLabel), pack);
    pack.lines.push(line);
  }
  const inHand = (list: readonly ChecklistLine[]) => list.filter((l) => l.status === 'received').length;

  const owing = new Map<string, { owedBy?: string; lines: ChecklistLine[] }>();
  for (const line of lines) {
    if (line.status !== 'pending' || line.mark === 'assumed') continue;
    const key = fold(line.item.owedBy);
    const group = owing.get(key) ?? { owedBy: line.item.owedBy, lines: [] };
    owing.set(key, group);
    group.lines.push(line);
  }

  const received = inHand(lines);
  return {
    stages: [...stages.entries()].map(([key, stage]) => {
      const packages = [...stage.packages.entries()].map(([packKey, pack]) => ({ key: packKey, label: pack.label, lines: pack.lines, received: inHand(pack.lines), total: pack.lines.length }));
      const all = packages.flatMap((p) => p.lines);
      return { key, label: stage.label, packages, received: inHand(all), total: all.length };
    }),
    total: lines.length,
    received,
    requested: lines.filter((l) => l.status === 'requested').length,
    pending: lines.filter((l) => l.status === 'pending' && l.mark !== 'assumed').length,
    overdue: lines.filter((l) => l.overdue).length,
    toConfirm: lines.filter((l) => l.suggestion).length,
    partial: lines.filter((l) => l.mark === 'partial').length,
    assumed: lines.filter((l) => l.mark === 'assumed').length,
    percent: lines.length ? Math.round((received / lines.length) * 100) : 0,
    owing: [...owing.values()].sort((a, b) => Number(!a.owedBy) - Number(!b.owedBy) || b.lines.length - a.lines.length),
  };
}

/** The papers a checklist still waits for, and who owes them. */
export interface ChecklistOwed {
  total: number;
  /** Lines not in hand, asked for or not. */
  owed: number;
  /**
   * Who owes them, the party that owes the most first: the party the list names for a line, else
   * whoever it was asked of. The lines with neither come last, under no name.
   */
  parties: Array<{ owedBy?: string; lines: ChecklistLine[] }>;
  /** The desk whose list holds the most of what is owed. */
  department?: DepartmentKey;
}

/** What is still owed on the checklist, across every desk's list or on one desk's. */
export function checklistOwed(project: DdProject, opts: { department?: DepartmentKey; now?: string } = {}): ChecklistOwed {
  const sheet = checklistSheet(project, opts);
  const missing = sheet.stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines)).filter((line) => line.status !== 'received' && line.mark !== 'assumed');
  const parties = new Map<string, { owedBy?: string; lines: ChecklistLine[] }>();
  const desks = new Map<DepartmentKey, number>();
  for (const line of missing) {
    const owedBy = line.item.owedBy ?? line.askedOf;
    const key = fold(owedBy);
    const party = parties.get(key) ?? { owedBy, lines: [] };
    parties.set(key, party);
    party.lines.push(line);
    desks.set(line.item.department, (desks.get(line.item.department) ?? 0) + 1);
  }
  const department = [...desks].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    total: sheet.total,
    owed: missing.length,
    parties: [...parties.values()].sort((a, b) => Number(!a.owedBy) - Number(!b.owedBy) || b.lines.length - a.lines.length),
    ...(department ? { department } : {}),
  };
}

/* ==================================================================== */
/* Asking for what is missing                                            */
/* ==================================================================== */

const where = (item: ChecklistItem): string => [item.stage, item.package].filter(Boolean).join(' · ');

/**
 * Ask for everything missing and not yet asked for: one tracked request to
 * each party, naming all it owes.
 *
 * Lines that name no party go to `recipient` when one is given, and are
 * left where they are, and counted, when it is not. `itemIds` narrows the
 * ask to some lines.
 */
export function raiseChecklistRequests(
  project: DdProject,
  input: { department?: DepartmentKey; itemIds?: readonly string[]; recipient?: string; dueAt?: string },
  actor: string,
): { requests: ProjectRequest[]; unassigned: number } {
  const sheet = checklistSheet(project, { department: input.department });
  const fallback = input.recipient?.trim();
  const requests: ProjectRequest[] = [];
  let unassigned = 0;
  for (const group of sheet.owing) {
    const lines = group.lines.filter((l) => !input.itemIds || input.itemIds.includes(l.item.id));
    if (!lines.length) continue;
    const recipient = group.owedBy ?? fallback;
    if (!recipient) {
      unassigned += lines.length;
      continue;
    }
    const request = addRequest(
      project,
      {
        title: lines.length === 1 ? lines[0]!.item.title : `${lines.length} documents`,
        detail: lines.map((l) => (where(l.item) ? `${l.item.title} (${where(l.item)})` : l.item.title)).join('\n'),
        recipient,
        dueAt: input.dueAt,
        send: true,
      },
      actor,
    );
    request.checklistItemIds = lines.map((l) => l.item.id);
    requests.push(request);
  }
  return { requests, unassigned };
}

/**
 * Close every sent request whose checklist lines are all in hand.
 *
 * Returns the ones it closed. A request for lines since taken off the list
 * is left for a person to close: nothing arrived to answer it.
 */
export function reconcileChecklistRequests(project: DdProject, now = nowIso()): ProjectRequest[] {
  const waiting = (project.requests ?? []).filter((r) => r.status === 'sent' && r.checklistItemIds?.length);
  if (!waiting.length) return [];
  const lines = new Map(checklistSheet(project, { now }).stages.flatMap((s) => s.packages.flatMap((p) => p.lines)).map((l) => [l.item.id, l]));
  const closed: ProjectRequest[] = [];
  for (const request of waiting) {
    const mine = request.checklistItemIds!.map((id) => lines.get(id)).filter((l): l is ChecklistLine => Boolean(l));
    // A line that will not come is settled as far as a request goes: nothing more is waited for.
    if (!mine.length || mine.some((l) => l.status !== 'received' && l.mark !== 'assumed') || mine.every((l) => l.mark === 'assumed')) continue;
    const documents = [...new Set(mine.map((l) => l.evidenceId).filter(Boolean))];
    request.status = 'answered';
    if (documents.length === 1) request.answeredByEvidenceId = documents[0];
    request.answeredAt = now;
    request.updatedAt = now;
    closed.push(request);
  }
  return closed;
}

/* ==================================================================== */
/* The summary a consultant keeps by hand                                */
/* ==================================================================== */

/** One package of a list, counted by how its lines stand. */
export interface ChecklistSummaryRow {
  key: string;
  package: string;
  /** The desks that hold its lines. */
  departments: DepartmentKey[];
  total: number;
  received: number;
  partial: number;
  assumed: number;
  /** Neither in hand, partly in hand nor to be assumed: asked for or not. */
  pending: number;
  /** Whole percent received; 0 where the package holds nothing. */
  percent: number;
}

export interface ChecklistSummary {
  rows: ChecklistSummaryRow[];
  total: ChecklistSummaryRow;
  /** The rounds the lines were asked in, in the order they first appear, each with how many lines it asked for. */
  rounds: Array<{ round: string; total: number }>;
  /** Whether any line came from a tracked list: one with numbers, rounds or a status column. */
  tracked: boolean;
}

/** Whether a line carries what only a tracked list gives it. */
export function checklistLineTracked(item: ChecklistItem): boolean {
  return Boolean(item.ref || item.round || item.partial || item.assumed || item.availability || item.targetDate);
}

/**
 * What a consultant counts by hand at the foot of the list: for each
 * package and in total, how many lines there are, how many are received,
 * partly in hand, to be assumed and pending, and the percent received.
 *
 * Worked out afresh from the lines each time, so it cannot disagree with
 * them. `round` narrows it to the lines asked for in one round.
 */
export function checklistSummary(project: DdProject, opts: { department?: DepartmentKey; round?: string; now?: string } = {}): ChecklistSummary {
  const all = checklistSheet(project, { department: opts.department, now: opts.now }).stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines));
  const lines = opts.round ? all.filter((line) => fold(line.item.round) === fold(opts.round)) : all;
  const blank = (key: string, pack: string): ChecklistSummaryRow => ({ key, package: pack, departments: [], total: 0, received: 0, partial: 0, assumed: 0, pending: 0, percent: 0 });
  const rows = new Map<string, ChecklistSummaryRow>();
  const total = blank('total', 'Total');
  for (const line of lines) {
    const pack = line.item.package ?? CHECKLIST_NO_PACKAGE;
    const row = rows.get(fold(pack)) ?? blank(fold(pack), pack);
    rows.set(fold(pack), row);
    for (const held of [row, total]) {
      held.total += 1;
      if (line.status === 'received') held.received += 1;
      else if (line.mark === 'assumed') held.assumed += 1;
      else if (line.mark === 'partial') held.partial += 1;
      else held.pending += 1;
      if (!held.departments.includes(line.item.department)) held.departments.push(line.item.department);
    }
  }
  for (const held of [...rows.values(), total]) held.percent = held.total ? Math.round((held.received / held.total) * 100) : 0;
  const rounds = new Map<string, { round: string; total: number }>();
  for (const line of all) {
    if (!line.item.round) continue;
    const held = rounds.get(fold(line.item.round)) ?? { round: line.item.round, total: 0 };
    rounds.set(fold(line.item.round), held);
    held.total += 1;
  }
  return { rows: [...rows.values()], total, rounds: [...rounds.values()], tracked: all.some((line) => checklistLineTracked(line.item)) };
}
