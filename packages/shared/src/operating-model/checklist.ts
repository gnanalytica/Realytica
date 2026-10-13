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
import type { DdProject, EvidenceRecord, ProjectRequest } from './types';

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
  received?: { at: string; by: string; evidenceId?: string };
  /** Documents a person said are not this paper: never offered for it again. */
  dismissed?: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** One line as a list wrote it, before it is on a project. */
export interface ChecklistDraft {
  title: string;
  stage?: string;
  package?: string;
  owedBy?: string;
  note?: string;
}

export interface ChecklistPatch {
  title?: string;
  stage?: string | null;
  package?: string | null;
  owedBy?: string | null;
  note?: string | null;
}

export const CHECKLIST_LIMITS = { items: 1000, title: 300, label: 120, note: 600 } as const;

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
function lineKey(line: Pick<ChecklistDraft, 'title' | 'stage' | 'package'>): string {
  return `${fold(line.title)}|${fold(line.stage)}|${fold(line.package)}`;
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
function csvCells(line: string): string[] {
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

/**
 * Put lines on the project. A line already there (the same paper, stage and
 * package) is left as it is, so the same list loaded twice is one list.
 */
export function addChecklistItems(project: DdProject, department: DepartmentKey, drafts: readonly ChecklistDraft[], actor: string): { added: ChecklistItem[]; skipped: number } {
  const items = itemsOf(project);
  const held = new Set(items.filter((i) => i.department === department).map(lineKey));
  const at = nowIso();
  const added: ChecklistItem[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    const title = clean(draft.title, CHECKLIST_LIMITS.title);
    if (!title) continue;
    const line = { title, stage: clean(draft.stage, CHECKLIST_LIMITS.label), package: clean(draft.package, CHECKLIST_LIMITS.label) };
    const key = lineKey(line);
    if (held.has(key)) {
      skipped += 1;
      continue;
    }
    held.add(key);
    added.push({
      id: newId('chk'),
      department,
      ...line,
      owedBy: clean(draft.owedBy, CHECKLIST_LIMITS.label),
      note: clean(draft.note, CHECKLIST_LIMITS.note),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
    });
  }
  // Counted before any line is put on the list: a list that does not fit leaves the project as it was.
  if (items.length + added.length > CHECKLIST_LIMITS.items) throw new Error(`The list holds ${CHECKLIST_LIMITS.items} lines at most.`);
  items.push(...added);
  if (added.length) audit(project, actor, 'checklist_added', added[0]!.id, added.length === 1 ? added[0]!.title : `${added.length} lines`);
  return { added, skipped };
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
        const best = offered.get(id);
        if (!best || match.score > best.score) offered.set(id, { row, score: match.score });
      }
    }
  }
  return { sure, offered };
}

function fileOf(row: EvidenceRecord | undefined): Pick<ChecklistLine, 'evidenceId' | 'fileName'> {
  return row ? { evidenceId: row.id, fileName: row.attachments[0]?.fileName ?? row.fileName ?? row.title } : {};
}

/**
 * The checklist as it is worked: by stage, then by package, each with how
 * many are in hand, and who owes what is missing.
 *
 * `department` narrows it to one desk's list.
 */
export function checklistSheet(project: DdProject, opts: { department?: DepartmentKey; now?: string } = {}): ChecklistSheet {
  const today = (opts.now ?? nowIso()).slice(0, 10);
  const items = (project.checklist ?? []).filter((i) => !opts.department || i.department === opts.department);
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
    const request = asked.get(item.id);
    if (!request) return { item, status: 'pending', suggestion };
    return { item, status: 'requested', suggestion, askedOf: request.recipient, dueAt: request.dueAt, overdue: request.dueAt ? request.dueAt.slice(0, 10) < today : undefined, requestId: request.id };
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
    if (line.status !== 'pending') continue;
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
    pending: lines.filter((l) => l.status === 'pending').length,
    overdue: lines.filter((l) => l.overdue).length,
    toConfirm: lines.filter((l) => l.suggestion).length,
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
  const missing = sheet.stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines)).filter((line) => line.status !== 'received');
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
    if (!mine.length || mine.some((l) => l.status !== 'received')) continue;
    const documents = [...new Set(mine.map((l) => l.evidenceId).filter(Boolean))];
    request.status = 'answered';
    if (documents.length === 1) request.answeredByEvidenceId = documents[0];
    request.answeredAt = now;
    request.updatedAt = now;
    closed.push(request);
  }
  return closed;
}
