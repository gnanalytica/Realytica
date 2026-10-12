/**
 * An empty form or template, filled from the record.
 *
 * Somebody sends a form with blanks in it: a bank's property particulars, an
 * authority's application, a consultant's data sheet. It is a Word file or a
 * workbook, and it has to go back as the same file with the blanks filled.
 * A questionnaire (`questionnaire.ts`) is a list of questions answered in
 * sentences; this is a file with places in it, each to hold one value.
 *
 * Three things are kept apart here.
 *
 * What a blank asks for is told by its label, through the same table a
 * questionnaire's questions are read with (`ASKED_FOR`), and from the
 * project's own entries. Where a model is set up it may also say what a blank
 * asks for, by naming one of those same values. It is never asked for a value
 * and none it gave would be kept: there is no place here to put one.
 *
 * What is offered for a blank is a value that stands on the file
 * (`standingFacts`), with the paper and page it was read from and whether a
 * named person accepted it, or an entry of the project's own record. A blank
 * nothing answers is offered nothing, and is listed as having no source.
 *
 * What is written into the file is only what a person accepted or typed.
 * An offer nobody has decided is not written, however sure it looks.
 */

import type { DepartmentKey } from './departments';
import type { DocumentFact } from './document-parse';
import { STANDARD_FACT_KEYS } from './document-parse';
import { factReview, standingFacts } from './fact-review';
import { ASKED_FOR } from './questionnaire';
import type { DdProject, EvidenceRecord } from './types';

export type TemplateFormat = 'docx' | 'xlsx';

/** How a blank was told from the rest of the file. */
export type TemplateFieldPattern =
  /** `[Project name]`, `{{owner}}`, `[______]`. */
  | 'bracket'
  /** A run of underscores or dots after a label: `Survey number: ______`. */
  | 'blank'
  /** A line that is a label and a colon and nothing after it. */
  | 'label'
  /** An empty cell of a Word table beside or under a cell that names it. */
  | 'table_cell'
  /** A Word content control still showing its prompt. */
  | 'content_control'
  /** A Word mail-merge field. */
  | 'merge_field'
  /** An empty cell of a sheet to the right of a cell that names it. */
  | 'cell_right'
  /** An empty cell of a sheet under a cell that names it. */
  | 'cell_below'
  /** An empty cell of a sheet that the workbook itself names. */
  | 'named_range';

export const TEMPLATE_PATTERN_LABEL: Record<TemplateFieldPattern, string> = {
  bracket: 'Bracketed blank',
  blank: 'Blank after a label',
  label: 'Label with nothing after it',
  table_cell: 'Empty table cell',
  content_control: 'Content control',
  merge_field: 'Merge field',
  cell_right: 'Empty cell beside a label',
  cell_below: 'Empty cell under a label',
  named_range: 'Named cell',
};

/**
 * Where a blank is in the file, exactly, so the value goes back into that
 * place and no other. A Word file's places count the text pieces, paragraphs
 * and content controls of its main part in the order they are written; a
 * workbook's are a sheet and a cell. They are places in the file as it was
 * sent, which is kept unchanged: a filled copy is always made from it.
 */
export type TemplatePlace =
  /** Characters `o0` of text piece `t0` up to `o1` of piece `t1` are replaced. */
  | { in: 'docx'; kind: 'text'; t0: number; o0: number; t1: number; o1: number }
  /** The value is written into paragraph `p`, which holds no words. */
  | { in: 'docx'; kind: 'paragraph'; p: number }
  /** The value takes the place of content control `sdt`'s prompt. */
  | { in: 'docx'; kind: 'control'; sdt: number }
  | { in: 'xlsx'; sheet: string; cell: string };

/** A blank as it was found in a file. */
export interface DetectedField {
  label: string;
  pattern: TemplateFieldPattern;
  place: TemplatePlace;
  /** Where a person would look for it: "Paragraph 4", "Table 1, row 3", "Particulars!B7". */
  where: string;
  /** The line it stands in, where it stands in one. */
  context?: string;
}

/** Whether a named person accepted what is offered, or nobody has yet. */
export type TemplateStanding = { state: 'approved'; by: string; at?: string } | { state: 'waiting' };

/** What a value was taken from: a paper and a page, or an entry of the project's record. */
export interface TemplateSource {
  kind: 'paper' | 'record';
  /** The paper's name, or the entry's: "Sale deed", "Project record: name". */
  title: string;
  evidenceId?: string;
  page?: number;
  /** The paper's own words. */
  quote?: string;
  standing: TemplateStanding;
}

/** A value offered for a blank. Nothing here is written until a person accepts it. */
export interface TemplateOffer {
  /** Which value of the record it is: `survey_numbers`, `project_name`. */
  key: string;
  value: string;
  source: TemplateSource;
}

export interface TemplateField extends DetectedField {
  id: string;
  /** Its place in the file's own order. */
  order: number;
  /**
   * What a model read the blank as asking for, where the rules could not
   * tell: one of the record's own values, by its key. Not a value.
   */
  asks?: { key: string; by: 'model' };
  /** What a person decided. Absent until somebody has. */
  decision?: 'accepted' | 'typed' | 'blank';
  /** What is written into the file: only beside `accepted` or `typed`. */
  value?: string;
  /** What an accepted value was taken from, as it stood when it was accepted. */
  source?: TemplateSource;
  decidedBy?: string;
  decidedAt?: string;
}

export interface FillTemplate {
  id: string;
  title: string;
  /** The department whose work it is. Engineering's when absent, as a questionnaire is. */
  department?: DepartmentKey;
  fileName: string;
  format: TemplateFormat;
  /** Where the file is kept, as it was sent. */
  fileKey: string;
  /** What of the file was not taken in, and why. */
  leftOut?: string;
  fields: TemplateField[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/**
 * How much one template may hold. A sheet with a label in every row of ten
 * thousand would otherwise be ten thousand blanks to review; a real form
 * has a few dozen.
 */
export const TEMPLATE_LIMITS = {
  /** Blanks kept from one file; the rest are left out and counted. */
  fields: 200,
  /** Characters of a blank's label. */
  labelChars: 160,
  /** Characters of the line a blank stands in. */
  contextChars: 240,
  /** Characters of a value written into a blank. */
  valueChars: 2000,
  /** Templates kept on one project. */
  perProject: 40,
  /** Bytes of the file as it is sent. */
  fileBytes: 4 * 1024 * 1024,
  /** Blanks one request may decide. */
  decisions: 200,
  /** Blanks a model is asked about at once. */
  modelFields: 60,
} as const;

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function audit(project: DdProject, actor: string, action: string, entityId: string, newValue?: string): void {
  const at = nowIso();
  project.audit.push({ id: newId('aud'), at, actor, action, entityType: 'template', entityId, newValue });
  project.updatedAt = at;
}

/** The department a template belongs to. */
export function templateDepartment(template: Pick<FillTemplate, 'department'>): DepartmentKey {
  return template.department ?? 'construction';
}

/* ==================================================================== */
/* What a blank asks for                                                 */
/* ==================================================================== */

const sqm = (n: number | undefined): string | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-IN')} sqm` : undefined);

/** The project's own entries a blank may ask for, told by its label, and where each is read from. */
const RECORD_ENTRIES: ReadonlyArray<{ key: string; label: string; asks: RegExp; value: (project: DdProject) => string | undefined }> = [
  { key: 'project_name', label: 'Project name', asks: /\b(?:project name|name of (?:the )?project|project title|title of (?:the )?project)\b/i, value: (p) => p.name },
  { key: 'project_reference', label: 'Project reference', asks: /\b(?:project|file|job)\s*(?:ref(?:erence)?\.?|no\.?|number|code)(?![a-z])/i, value: (p) => p.reference },
  { key: 'site_address', label: 'Site address', asks: /\b(?:site|property|project|postal) address\b|\b(?:address|location) of (?:the )?(?:site|property|project|land|plot)\b|^\s*(?:address|location)\s*$/i, value: (p) => p.siteAddress ?? p.location },
  { key: 'city', label: 'City', asks: /\b(?:city|town)\b/i, value: (p) => p.city },
  { key: 'developer', label: 'Developer', asks: /\b(?:developer|promoter|builder)\b/i, value: (p) => p.developer },
  { key: 'record_owner', label: 'Owner', asks: /\b(?:owner|owned by|in whose name|title holder)\b/i, value: (p) => p.owner },
  { key: 'land_area', label: 'Land area', asks: /\b(?:extent|site area|plot area|land area|area of the (?:land|site|plot|property))\b/i, value: (p) => sqm(p.landAreaSqm) },
  { key: 'built_up_area', label: 'Built-up area', asks: /\bbuilt[-\s]?up area\b/i, value: (p) => sqm(p.builtUpAreaSqm) },
  { key: 'saleable_area', label: 'Saleable area', asks: /\bsale?able area\b/i, value: (p) => sqm(p.saleableAreaSqm) },
  { key: 'parcel', label: 'Survey or parcel number', asks: /\bsurvey\s*(?:no|nos|number|numbers)\b|\bsy\.?\s*nos?\b|\bparcel\b/i, value: (p) => p.parcelId },
  { key: 'jurisdiction', label: 'Jurisdiction', asks: /\b(?:jurisdiction|local authority|planning authority)\b/i, value: (p) => p.jurisdiction },
];

const PAPER_KEYS: readonly string[] = [...new Set(ASKED_FOR.flatMap((topic) => topic.keys))];

const titled = (key: string): string => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Every value of the record a blank may be read as asking for: the values
 * papers state that a questionnaire is answered from, and the project's own
 * entries. A model that says what a blank asks for picks from this list and
 * from nowhere else (`templateAsksHeld`).
 */
export const TEMPLATE_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  ...PAPER_KEYS.map((key) => ({ key, label: STANDARD_FACT_KEYS[key]?.label ?? titled(key) })),
  ...RECORD_ENTRIES.map((entry) => ({ key: entry.key, label: entry.label })),
];

/**
 * What a blank asks for, told by its label: the keys of the values that
 * would fill it, the papers' before the project's own entries. A merge field
 * or a named cell is often named with no spaces (`Survey_Number`,
 * `ProjectName`), so the label is read with its words apart.
 */
export function templateAsks(label: string): string[] {
  const words = label
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return [];
  const papers = ASKED_FOR.filter((topic) => topic.asks.test(words)).flatMap((topic) => topic.keys);
  const entries = RECORD_ENTRIES.filter((entry) => entry.asks.test(words)).map((entry) => entry.key);
  return [...new Set([...papers, ...entries])];
}

/**
 * What a model said some blanks ask for, held to what it may say: a blank
 * that was asked about, and a key from the list it was given. Anything else
 * it answered is dropped, a value among it.
 */
export function templateAsksHeld(said: readonly unknown[] | null | undefined, asked: number): Array<{ n: number; key: string }> {
  const known = new Set(TEMPLATE_KEYS.map((k) => k.key));
  const out: Array<{ n: number; key: string }> = [];
  for (const row of said ?? []) {
    if (!row || typeof row !== 'object') continue;
    const { n, key } = row as { n?: unknown; key?: unknown };
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > asked) continue;
    if (typeof key !== 'string' || !known.has(key)) continue;
    if (!out.some((kept) => kept.n === n)) out.push({ n, key });
  }
  return out;
}

/* ==================================================================== */
/* What the record offers                                                */
/* ==================================================================== */

function standingOf(fact: DocumentFact): TemplateStanding {
  // A value the rules read surely stands with no person's name on it, and one on file before decisions were kept has none either.
  return factReview(fact) === 'accepted' && fact.decidedBy ? { state: 'approved', by: fact.decidedBy, ...(fact.decidedAt ? { at: fact.decidedAt } : {}) } : { state: 'waiting' };
}

/**
 * Every value the record offers for a blank, the first the one proposed.
 *
 * From papers, only what stands (`standingFacts`), newest paper first, as a
 * questionnaire's answers are drawn (`suggestFromFile`). Then the project's
 * own entries. A value stated twice is offered once, from the first place
 * that states it. Empty for a blank nothing answers.
 */
export function templateOffers(project: DdProject, field: Pick<TemplateField, 'label' | 'asks'>): TemplateOffer[] {
  const told = templateAsks(field.label);
  const keys = told.length ? told : field.asks ? [field.asks.key] : [];
  if (!keys.length) return [];
  const papers = [...project.evidence].filter((e) => e.status !== 'superseded' && e.status !== 'rejected').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const onFile: Array<{ fact: DocumentFact; paper: EvidenceRecord }> = papers.flatMap((paper) => standingFacts(paper).map((fact) => ({ fact, paper })));
  const offers: TemplateOffer[] = [];
  const add = (offer: TemplateOffer): void => {
    if (offer.value && !offers.some((kept) => kept.value.toLowerCase() === offer.value.toLowerCase())) offers.push(offer);
  };
  for (const key of keys) {
    for (const { fact, paper } of onFile.filter((row) => row.fact.key === key)) {
      add({
        key,
        value: cut(String(fact.display ?? fact.value).trim(), TEMPLATE_LIMITS.valueChars),
        source: { kind: 'paper', title: paper.documentType ?? paper.title, evidenceId: paper.id, page: fact.page, ...(fact.quote ? { quote: cut(fact.quote, 400) } : {}), standing: standingOf(fact) },
      });
    }
    const entry = RECORD_ENTRIES.find((e) => e.key === key);
    const value = entry?.value(project)?.trim();
    // An entry of the project's own record carries nobody's name: it is offered as waiting.
    if (entry && value) add({ key, value: cut(value, TEMPLATE_LIMITS.valueChars), source: { kind: 'record', title: `Project record: ${entry.label.toLowerCase()}`, standing: { state: 'waiting' } } });
  }
  return offers;
}

/** Where a value came from, in a line: "Sale deed, p. 2", "Project record: name". */
export function templateSourceSaid(source: TemplateSource): string {
  return `${source.title}${source.page ? `, p. ${source.page}` : ''}`;
}

/** How a source stands, in a few words. */
export function templateStandingSaid(standing: TemplateStanding): string {
  return standing.state === 'approved' ? `Approved by ${standing.by}${standing.at ? ` on ${standing.at.slice(0, 10)}` : ''}` : 'Waiting: no named person has approved it';
}

/* ==================================================================== */
/* Taking a file in                                                      */
/* ==================================================================== */

export interface NewTemplateInput {
  title: string;
  department?: DepartmentKey;
  fileName: string;
  format: TemplateFormat;
  fileKey: string;
  detected: readonly DetectedField[];
  /** What the reader of the file already left out. */
  leftOut?: string;
}

/**
 * A template made from the blanks found in a file, cut to what one may hold.
 * What was left out is said on it, and on the project's trail. A file with
 * no blank in it is not a template.
 */
export function newTemplate(project: DdProject, input: NewTemplateInput, actor: string): FillTemplate {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new Error('Give the template a name.');
  if (!input.detected.length) throw new Error('No blanks were found in that file. A blank is a bracket, a run of underscores, an empty cell beside a label, a content control or a merge field.');
  const max = TEMPLATE_LIMITS.fields;
  const kept = input.detected.slice(0, max);
  const cutSaid = input.detected.length > kept.length ? `Only the first ${max} of its ${input.detected.length.toLocaleString('en-IN')} blanks were taken in: one template holds no more.` : '';
  const leftOut = [input.leftOut, cutSaid].filter(Boolean).join(' ');
  const at = nowIso();
  const template: FillTemplate = {
    id: newId('tpl'),
    title,
    ...(input.department && input.department !== 'construction' ? { department: input.department } : {}),
    fileName: input.fileName,
    format: input.format,
    fileKey: input.fileKey,
    ...(leftOut ? { leftOut } : {}),
    fields: kept.map((field, order) => ({
      id: newId('f'),
      order,
      label: cut(field.label.replace(/\s+/g, ' ').trim() || 'Blank', TEMPLATE_LIMITS.labelChars),
      pattern: field.pattern,
      place: field.place,
      where: cut(field.where, 80),
      ...(field.context?.trim() ? { context: cut(field.context.replace(/\s+/g, ' ').trim(), TEMPLATE_LIMITS.contextChars) } : {}),
    })),
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };
  audit(project, actor, 'template_added', template.id, `${title} · ${template.fields.length} blank(s)${leftOut ? ` · ${leftOut}` : ''}`);
  return template;
}

/** The blanks a model may be asked about: those whose label the rules could not read. */
export function templateFieldsToAsk(template: FillTemplate): TemplateField[] {
  return template.fields.filter((field) => !field.asks && !templateAsks(field.label).length).slice(0, TEMPLATE_LIMITS.modelFields);
}

/** Keeps what a model said some blanks ask for (`templateAsksHeld`), each on the blank it was asked about. Returns how many. */
export function keepTemplateAsks(template: FillTemplate, asked: readonly TemplateField[], said: readonly unknown[] | null | undefined): number {
  let kept = 0;
  for (const { n, key } of templateAsksHeld(said, asked.length)) {
    const field = template.fields.find((f) => f.id === asked[n - 1]!.id);
    if (!field || field.decision) continue;
    field.asks = { key, by: 'model' };
    kept += 1;
  }
  if (kept) template.updatedAt = nowIso();
  return kept;
}

/* ==================================================================== */
/* A person's decisions                                                  */
/* ==================================================================== */

export type TemplateDecision =
  /** Take what the record offers, as it is offered now. `value` picks one of several offers; absent takes the first. */
  | { fieldId: string; decision: 'accept'; value?: string }
  /** Write these words instead. */
  | { fieldId: string; decision: 'type'; value: string }
  /** Leave it blank in the file. */
  | { fieldId: string; decision: 'blank' }
  /** Take the decision back. */
  | { fieldId: string; decision: 'reopen' };

/**
 * Decide some blanks. Each decision carries the name of who made it.
 *
 * Accepting takes the offer as the record makes it at that moment, with its
 * source, and keeps both: a filled file says what it was filled from even
 * after the record moves on. A blank nothing answers cannot be accepted, only
 * typed into or left. Returns how many were decided.
 */
export function decideTemplateFields(project: DdProject, template: FillTemplate, decisions: readonly TemplateDecision[], actor: string): number {
  const at = nowIso();
  let decided = 0;
  for (const asked of decisions.slice(0, TEMPLATE_LIMITS.decisions)) {
    const field = template.fields.find((f) => f.id === asked.fieldId);
    if (!field) throw new Error('No blank by that id on this template.');
    delete field.value;
    delete field.source;
    if (asked.decision === 'reopen') {
      delete field.decision;
      delete field.decidedBy;
      delete field.decidedAt;
      decided += 1;
      continue;
    }
    if (asked.decision === 'accept') {
      const offers = templateOffers(project, field);
      const offer = asked.value === undefined ? offers[0] : offers.find((o) => o.value === asked.value);
      if (!offer) throw new Error(`Nothing on the record answers “${field.label}”. Type a value, or leave it blank.`);
      field.decision = 'accepted';
      field.value = offer.value;
      field.source = offer.source;
    } else if (asked.decision === 'type') {
      const value = asked.value.replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_LIMITS.valueChars);
      if (!value) throw new Error('Type a value, or leave the blank as it is.');
      field.decision = 'typed';
      field.value = value;
    } else {
      field.decision = 'blank';
    }
    field.decidedBy = actor;
    field.decidedAt = at;
    decided += 1;
  }
  if (decided) {
    template.updatedAt = at;
    audit(project, actor, 'template_decided', template.id, `${decided} blank(s)`);
  }
  return decided;
}

/* ==================================================================== */
/* Reading it back                                                       */
/* ==================================================================== */

/**
 * How one blank stands: written with an accepted or a typed value, left
 * blank by a person, offered a value nobody has decided, or with nothing on
 * the record to offer.
 */
export type TemplateFieldStatus = 'accepted' | 'typed' | 'blank' | 'offered' | 'no_source';

export const TEMPLATE_STATUS_LABEL: Record<TemplateFieldStatus, string> = {
  accepted: 'Accepted',
  typed: 'Typed',
  blank: 'Left blank',
  offered: 'Offered',
  no_source: 'No source',
};

export interface TemplateRow {
  field: TemplateField;
  status: TemplateFieldStatus;
  /** What the record offers now, for a blank nobody has decided. The first is the one proposed. */
  offers: TemplateOffer[];
}

/** Every blank of a template as it stands, in the file's order, with what the record offers for each one still open. */
export function templateRows(project: DdProject, template: FillTemplate): TemplateRow[] {
  return template.fields
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((field) => {
      if (field.decision) return { field, status: field.decision, offers: [] };
      const offers = templateOffers(project, field);
      return { field, status: offers.length ? 'offered' : 'no_source', offers };
    });
}

export interface TemplateSummary {
  total: number;
  /** Written into the file: accepted or typed. */
  written: number;
  accepted: number;
  typed: number;
  blank: number;
  offered: number;
  noSource: number;
}

export function templateSummary(rows: readonly TemplateRow[]): TemplateSummary {
  const count = (status: TemplateFieldStatus) => rows.filter((row) => row.status === status).length;
  const accepted = count('accepted');
  const typed = count('typed');
  return { total: rows.length, written: accepted + typed, accepted, typed, blank: count('blank'), offered: count('offered'), noSource: count('no_source') };
}

/** What is written into the file, and where: only what a person accepted or typed. */
export function templateValues(template: FillTemplate): Array<{ place: TemplatePlace; value: string }> {
  return template.fields.filter((f) => (f.decision === 'accepted' || f.decision === 'typed') && f.value).map((f) => ({ place: f.place, value: f.value! }));
}

/** A template as a person is shown it: its blanks as they stand, and the counts. */
export interface TemplateView extends Omit<FillTemplate, 'fields'> {
  rows: TemplateRow[];
  summary: TemplateSummary;
}

export function templateView(project: DdProject, template: FillTemplate): TemplateView {
  const { fields: _fields, ...rest } = template;
  const rows = templateRows(project, template);
  return { ...rest, rows, summary: templateSummary(rows) };
}

/** One line of the list of sources that goes out beside a filled file. */
export interface TemplateSourceLine {
  label: string;
  where: string;
  value: string;
  /** Where the value came from, and how that stands. A typed value says who typed it. */
  source: string;
  standing: string;
}

/**
 * The list of sources for a filled file: every value written, with the paper
 * and page or the entry it came from and who accepted it, and every blank
 * left empty, with why.
 */
export function templateSourceList(project: DdProject, template: FillTemplate): { written: TemplateSourceLine[]; empty: Array<{ label: string; where: string; why: string }> } {
  const written: TemplateSourceLine[] = [];
  const empty: Array<{ label: string; where: string; why: string }> = [];
  for (const { field, status } of templateRows(project, template)) {
    if (status === 'accepted' && field.value && field.source) {
      written.push({ label: field.label, where: field.where, value: field.value, source: templateSourceSaid(field.source), standing: `${templateStandingSaid(field.source.standing)}. Accepted for this file by ${field.decidedBy ?? 'somebody'}.` });
    } else if (status === 'typed' && field.value) {
      written.push({ label: field.label, where: field.where, value: field.value, source: 'Typed', standing: `Typed by ${field.decidedBy ?? 'somebody'}; no paper behind it.` });
    } else {
      empty.push({ label: field.label, where: field.where, why: status === 'blank' ? `Left blank by ${field.decidedBy ?? 'somebody'}` : status === 'offered' ? 'A value is offered and nobody has accepted it' : 'No source on the record' });
    }
  }
  return { written, empty };
}

/** Notes on the project's trail that a filled file was taken out, by whom, and with how many values. */
export function noteTemplateFilled(project: DdProject, template: FillTemplate, actor: string): void {
  audit(project, actor, 'template_filled', template.id, `${template.title} · ${templateValues(template).length} value(s) written`);
}

export function noteTemplateRemoved(project: DdProject, template: FillTemplate, actor: string): void {
  audit(project, actor, 'template_removed', template.id, template.title);
}
