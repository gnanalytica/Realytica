/**
 * Field sets on a project: what each holds, what stands, what shows, what
 * needs a person, and the only ways a value gets in.
 *
 * Four rules run through all of it.
 *
 * - **A value somebody proposed acts on nothing.** A model's value, a
 *   parser's, another paper's: each waits on its field until a lead or signer
 *   of the function's department accepts it. Until then no formula reads it,
 *   no rule fires on it, no status is drawn from it and nothing is told of it
 *   (`fieldStands`, the same question `stands` asks of a paper's values).
 * - **A model writes no words.** It names a field by its address, gives a
 *   value of the field's kind, and says where it read it: a paper's page and
 *   words, or a public source and its date. Prose fields are a person's.
 * - **Complexity is more fields, not more screen.** A field shows when its
 *   situation is in play or its condition holds; an expert field stays folded
 *   until asked for or until it holds a value. A field that is not showing is
 *   never counted as missing.
 * - **Nothing is thrown away.** Turning a situation off keeps what its fields
 *   hold, shown as not in play. A record taken off the list is kept. A value
 *   under a key no longer declared is kept as it is.
 */

import { APPROVAL_KINDS } from './approvals';
import { checkInsights, computedValue, dayNumber, evaluateFormula, evaluateStatus, ownRows, rowMeets, fieldIsDerived, fieldOptions, fieldStands, fieldState, fieldTone, formatFieldValue, isBlank, standingField, validateFieldValue, type FormulaOutside } from './check-fields';
import { DEPARTMENT_KEYS, workstreamDefinition, type DepartmentKey } from './departments';
import { surveyNumbersIn } from './document-intake';
import type { DocumentFact } from './document-parse';
import { allChecks } from './engagements';
import { acceptedOneAtATime, proofOf, settled, standingFacts } from './fact-review';
import { addressKey, fieldCatalog, fieldSetsOf, optionSetById, refSet, sharedSetsOf, situationsOf, type FieldCatalog } from './field-registry';
import { projectFigure } from './field-figures';
import { RULE_ROWS } from './field-sets';
import { SHARED_FN } from './field-sets/shared-records';
import { ruleCitation, ruleRow } from './rule-tables';
import { recordAuditEvent } from './operations';
import { decisionRefused } from './review';
import type { MayDecide } from './team';
import type {
  CheckFieldDef,
  CheckFieldValue,
  CheckInsight,
  CheckInsightRule,
  DdProject,
  FieldAddress,
  FieldOrigin,
  FieldRecord,
  FieldSet,
  FieldState,
  MatchList,
  RefTarget,
  RuleCitation,
  RuleRow,
  ShowWhen,
  Situation,
  SituationState,
  StoredFieldSheet,
  Tone,
} from './types';
import { NA_REASONS, type NaReason } from './types';

const now = (): string => new Date().toISOString();
const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Who may change a department's records, as the caller answers it. Absent, nobody is asking. */
export type MayEdit = (department: DepartmentKey) => boolean;

export interface FieldWriteOptions {
  mayDecide?: MayDecide;
  mayEdit?: MayEdit;
}

export class FieldRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldRefused';
  }
}

/* ==================================================================== */
/* Where values are kept                                                 */
/* ==================================================================== */

/** The department a function's fields belong to. */
export function departmentOfFunction(fn: string): DepartmentKey | undefined {
  return workstreamDefinition(fn)?.department;
}

/** The check that holds a check set's values on this project: the one last written of those with the definition. */
function checkHolding(project: DdProject, definitionId: string) {
  const held = allChecks(project).filter((check) => check.definitionId === definitionId);
  return held.sort((a, b) => Number(Boolean(Object.keys(b.fields ?? {}).length)) - Number(Boolean(Object.keys(a.fields ?? {}).length)) || b.updatedAt.localeCompare(a.updatedAt))[0];
}

function sheetOf(project: DdProject, setId: string): StoredFieldSheet | undefined {
  return project.fieldSheets?.[setId];
}

function sheetFor(project: DdProject, setId: string): StoredFieldSheet {
  project.fieldSheets ??= {};
  project.fieldSheets[setId] ??= { values: {} };
  return project.fieldSheets[setId]!;
}

/** The records of a set that repeats that are still on its list. */
export function fieldRecords(project: DdProject, setId: string): FieldRecord[] {
  return (sheetOf(project, setId)?.records ?? []).filter((record) => !record.removed);
}

/** Everything one holder stores, whatever its standing. */
function stored(project: DdProject, catalog: FieldCatalog, setId: string, recordId?: string): Record<string, CheckFieldValue> {
  if (catalog.checks.has(setId)) return checkHolding(project, setId)?.fields ?? {};
  const sheet = sheetOf(project, setId);
  if (recordId) return sheet?.records?.find((record) => record.id === recordId)?.values ?? {};
  return sheet?.values ?? {};
}

/** The holder to write into, made if it is not there. A check's is the check itself. */
function holderFor(project: DdProject, catalog: FieldCatalog, address: Pick<FieldAddress, 'set' | 'record'>): Record<string, CheckFieldValue> {
  if (catalog.checks.has(address.set)) {
    const check = checkHolding(project, address.set);
    if (!check) throw new FieldRefused('That check is not on this project.');
    check.fields ??= {};
    return check.fields;
  }
  const sheet = sheetFor(project, address.set);
  if (!address.record) return sheet.values;
  const record = sheet.records?.find((held) => held.id === address.record && !held.removed);
  if (!record) throw new FieldRefused('That record is not on this project.');
  return record.values;
}

/* ==================================================================== */
/* Situations                                                            */
/* ==================================================================== */

export function situationState(project: DdProject, at: string): SituationState | undefined {
  return project.situations?.[at];
}

/** Whether a situation is in play. A proposed one is not until a person accepts it. */
export function situationOn(project: DdProject, at: string): boolean {
  return situationState(project, at)?.state === 'on';
}

/** The key a situation named on a function's sheet is kept under: the function's own where it declares one, else the project's. */
function situationAt(catalog: FieldCatalog, fn: string, key: string): string {
  return catalog.situations.has(`${fn}:${key}`) ? `${fn}:${key}` : key;
}

/* ==================================================================== */
/* Resolving                                                             */
/* ==================================================================== */

export interface FieldResolution {
  /** A field's value as it may be acted on: what stands where it is entered, or what it is worked out to. */
  read(address: FieldAddress): CheckFieldValue | undefined;
  /** Every acting value of one holder. */
  holder(setId: string, recordId?: string): Record<string, CheckFieldValue>;
  /** The acting values of each record of a set that repeats. A record with nothing standing is not one yet. */
  records(setId: string): Array<Record<string, CheckFieldValue>> | undefined;
  /** Whether a condition holds, asked from one holder. */
  showing(when: ShowWhen | undefined, from: { fn: string; set: string; record?: string }): boolean;
}

/**
 * Every field of a project, each worked out after all it reads.
 *
 * A field a person fills is its stored value where that stands. A mirror is
 * its owner's value. A computed field is its formula over resolved values,
 * its own set's or another function's. A status is the first of its cases
 * whose rule fires. Each is worked out once, when first asked for, so the
 * order is the order of dependence whatever order the catalog lists them in.
 * A ring cannot be resolved; the catalog's own test refuses one, and here a
 * field met again while it is being worked out reads as nothing.
 */
export function resolveFields(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalog(), rules: readonly RuleRow[] = RULE_ROWS): FieldResolution {
  const memo = new Map<string, CheckFieldValue | undefined>();
  const open = new Set<string>();
  // What each holder stores, found once: a check's holder is a walk of every check on the project.
  const kept = new Map<string, Record<string, CheckFieldValue>>();
  const storedOf = (setId: string, recordId?: string) => {
    const key = `${setId}::${recordId ?? ''}`;
    let held = kept.get(key);
    if (!held) kept.set(key, (held = stored(project, catalog, setId, recordId)));
    return held;
  };
  const today = at.toISOString().slice(0, 10);

  const outside = (set: FieldSet, recordId: string | undefined, cites: RuleCitation[]): FormulaOutside => ({
    // A field of the same set that repeats, asked from one of its records, is that record's.
    read: (address) => {
      const value = read(address.set === set.id && !address.record && recordId ? { ...address, record: recordId } : address);
      cites.push(...(value?.cites ?? []));
      return value;
    },
    records: (setId) => records(setId),
    // The row for this project's place, in force on the day asked. What was read is kept, so the value can say where its figure is written.
    rate: (table, on, conditions) => {
      const row = ruleRow(rules, table, { state: project.jurisdiction, city: project.city }, on ?? today, conditions);
      if (row) cites.push(ruleCitation(row));
      return row?.value ?? null;
    },
    figure: (key, of) => projectFigure(project, key, at, of),
    record: recordId,
    today: at,
  });

  const field = (set: FieldSet, recordId: string | undefined, def: CheckFieldDef): CheckFieldValue | undefined => {
    const key = `${set.id}::${recordId ?? ''}::${def.key}`;
    if (memo.has(key)) return memo.get(key);
    if (open.has(key)) return undefined;
    open.add(key);
    let value: CheckFieldValue | undefined;
    const own = (name: string) => {
      const other = set.fields.find((f) => f.key === name);
      return other ? field(set, recordId, other) : undefined;
    };
    if (def.sameAs) {
      const owner = read(def.sameAs);
      value = owner && !isBlank(owner) ? { ...owner, origin: { kind: 'field', address: def.sameAs } } : undefined;
    } else if (def.kind === 'computed') {
      const cites: RuleCitation[] = [];
      const values = new Proxy({} as Record<string, CheckFieldValue>, {
        get: (_, name) => {
          const read = typeof name === 'string' ? own(name) : undefined;
          cites.push(...(read?.cites ?? []));
          return read;
        },
      });
      value = computedValue(def, def.formula ? evaluateFormula(def.formula, values, outside(set, recordId, cites)) : null);
      if (cites.length) value.cites = uniqueCites(cites);
    } else if (def.kind === 'status') {
      // The rule engine reads plain values: what the holder stores that stands, and the fields the cases name, resolved.
      const values: Record<string, CheckFieldValue> = {};
      const cites: RuleCitation[] = [];
      for (const [name, held] of Object.entries(storedOf(set.id, recordId))) if (fieldStands(held) && !isBlank(held)) values[name] = held;
      for (const name of (def.cases ?? []).flatMap((option) => option.when.fields)) {
        const resolved = own(name);
        cites.push(...(resolved?.cites ?? []));
        if (resolved && !isBlank(resolved)) values[name] = resolved;
        else delete values[name];
      }
      value = { value: evaluateStatus(def, set.fields, values, at)?.label ?? null, at: '', by: 'computed', ...(cites.length ? { cites: uniqueCites(cites) } : {}) };
    } else {
      value = standingField(storedOf(set.id, recordId)[def.key]);
      // Nothing recorded and nothing waiting: a usual value stands in, said to be assumed, until a real one arrives.
      const held = storedOf(set.id, recordId)[def.key];
      if (isBlank(value) && !held?.state && isBlank(held) && def.defaults?.length) {
        const usual = def.defaults.find((rule) => showing(rule.when, { fn: set.fn, set: set.id, record: recordId }));
        if (usual) value = { value: usual.value, at: '', by: 'default', state: 'assumed', origin: { kind: 'default', from: usual.from, ...(usual.cite ? { cite: usual.cite } : {}) } };
      }
    }
    open.delete(key);
    memo.set(key, value);
    return value;
  };

  const read = (address: FieldAddress): CheckFieldValue | undefined => {
    const set = catalog.sets.get(address.set);
    const def = set?.fields.find((f) => f.key === address.field);
    if (!set || !def) return undefined;
    // A set that repeats has no one value for a field: name the record.
    if (set.records && !address.record) return undefined;
    return field(set, address.record, def);
  };

  const holder = (setId: string, recordId?: string): Record<string, CheckFieldValue> => {
    const set = catalog.sets.get(setId);
    const out: Record<string, CheckFieldValue> = {};
    if (!set) return out;
    for (const def of set.fields) {
      const value = field(set, recordId, def);
      if (value) out[def.key] = value;
    }
    return out;
  };

  const records = (setId: string) => {
    if (!catalog.sets.get(setId)?.records) return undefined;
    return fieldRecords(project, setId)
      .filter((record) => Object.values(record.values).some((value) => fieldStands(value) && !isBlank(value)))
      .map((record) => holder(setId, record.id));
  };

  // The values of the holder asked from, each read only when a join names it.
  const ownValues = (from: { fn: string; set: string; record?: string }): Record<string, CheckFieldValue> =>
    new Proxy({} as Record<string, CheckFieldValue>, { get: (_, name) => (typeof name === 'string' ? read({ fn: from.fn, set: from.set, field: name, ...(from.record ? { record: from.record } : {}) }) : undefined) });

  const showing = (when: ShowWhen | undefined, from: { fn: string; set: string; record?: string }): boolean => {
    if (!when) return true;
    if ('situation' in when) {
      const at = situationAt(catalog, from.fn, when.situation);
      const derive = catalog.situations.get(at)?.derive;
      // A situation that follows from what is recorded is never asked: it is in play exactly when its condition holds.
      return derive ? showing(derive, { fn: from.fn, set: from.set }) : situationOn(project, at);
    }
    if ('all' in when) return when.all.every((part) => showing(part, from));
    if ('records' in when) {
      // A join to the record asked from: its id, or what one of its own fields holds.
      const where = when.where ? ownRows(when.where, ownValues(from), from.record) : undefined;
      const rows = where === null ? [] : (records(when.records) ?? []).filter((row) => !where || rowMeets(row, where));
      return when.is === 'none' ? rows.length === 0 : rows.length >= (when.is === 'at_least' ? (when.n ?? 1) : 1);
    }
    if ('any' in when) return when.any.some((part) => showing(part, from));
    const address = when.field.set === from.set && !when.field.record && from.record ? { ...when.field, record: from.record } : when.field;
    const value = read(address);
    const raw = isBlank(value) ? null : value!.value;
    switch (when.is) {
      case 'set':
        return raw !== null;
      case 'true':
        return raw === true;
      case 'false':
        return raw === false;
      case 'equals':
        return raw !== null && String(raw) === String(when.value);
      case 'in':
        return raw !== null && Array.isArray(when.value) && when.value.map(String).includes(String(raw));
      case 'gt':
        return typeof raw === 'number' && raw > Number(when.value);
      case 'lt':
        return typeof raw === 'number' && raw < Number(when.value);
      default:
        return false;
    }
  };

  return { read, holder, records, showing };
}

function uniqueCites(cites: RuleCitation[]): RuleCitation[] {
  return cites.filter((cite, index) => cites.findIndex((other) => other.key === cite.key && other.from === cite.from && other.value === cite.value) === index);
}

/* ==================================================================== */
/* Matching two lists                                                    */
/* ==================================================================== */

export interface MatchItem {
  id: string;
  label: string;
}

export interface MatchReading {
  left: { label: string; items: MatchItem[]; leftover: MatchItem[] };
  right: { label: string; items: MatchItem[]; leftover: MatchItem[] };
  pairs: Array<{ left: string; right: string; leftLabel: string; rightLabel: string }>;
}

function matchList(project: DdProject, catalog: FieldCatalog, resolution: FieldResolution, list: MatchList): MatchItem[] {
  if ('target' in list) return refChoices(project, list.target, catalog);
  if ('records' in list) {
    const def = catalog.sets.get(list.records)?.fields.find((field) => field.key === list.field);
    return fieldRecords(project, list.records).flatMap((record) => {
      const value = resolution.holder(list.records, record.id)[list.field];
      return def && !isBlank(value) ? [{ id: record.id, label: formatFieldValue(def, value, (id) => optionSetById(id, catalog)) }] : [];
    });
  }
  const rows = resolution.read(list.table)?.value;
  const seen = new Set<string>();
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const cell = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[list.column] : undefined;
    const label = cell === null || cell === undefined ? '' : String(cell).trim();
    if (!label || seen.has(label)) return [];
    seen.add(label);
    return [{ id: label, label }];
  });
}

/**
 * A match table read: the two lists, the pairs its rows make, and what of
 * each list no row pairs. A leftover is a thing with no counterpart (a
 * survey number with no owner, a demand with no milestone), and it needs a
 * person as much as an empty must-field does.
 */
export function readMatch(project: DdProject, def: CheckFieldDef, value: CheckFieldValue | undefined, resolution: FieldResolution, catalog: FieldCatalog = fieldCatalog()): MatchReading | undefined {
  if (def.display !== 'match' || !def.match) return undefined;
  const left = matchList(project, catalog, resolution, def.match.left.of);
  const right = matchList(project, catalog, resolution, def.match.right.of);
  const rows = (Array.isArray(value?.value) ? value!.value : []).filter((row): row is Record<string, string | number | boolean | null> => typeof row === 'object' && row !== null);
  const label = (items: MatchItem[], id: string) => items.find((item) => item.id === id)?.label ?? id;
  const pairs = rows.flatMap((row) => {
    const l = row[def.match!.left.column];
    const r = row[def.match!.right.column];
    return l && r ? [{ left: String(l), right: String(r), leftLabel: label(left, String(l)), rightLabel: label(right, String(r)) }] : [];
  });
  return {
    left: { label: def.match.left.label, items: left, leftover: left.filter((item) => !pairs.some((pair) => pair.left === item.id)) },
    right: { label: def.match.right.label, items: right, leftover: right.filter((item) => !pairs.some((pair) => pair.right === item.id)) },
    pairs,
  };
}

/* ==================================================================== */
/* Reading a sheet                                                       */
/* ==================================================================== */

/** How a field is on the page: there, folded until asked for, or not showing. */
export type FieldShown = 'shown' | 'folded' | 'hidden';

export interface FieldSource {
  kind: FieldOrigin['kind'];
  /** The paper's title, the public source's name, or the field it is read from. */
  label: string;
  evidenceId?: string;
  page?: number;
  quote?: string;
  url?: string;
  asOf?: string;
  /** What stands behind a model's reading, as `proofSaid` words it. */
  reader?: 'parser' | 'model';
  address?: FieldAddress;
}

export interface FieldView {
  def: CheckFieldDef;
  address: FieldAddress;
  shown: FieldShown;
  /** Holds a value while not showing: kept, and listed as not in play. */
  notInPlay: boolean;
  state: FieldState;
  /** What is stored, whatever its standing. A derived field's is its resolved value. */
  held?: CheckFieldValue;
  /** As a person reads it. */
  text: string;
  tone?: Tone;
  source?: FieldSource;
  /** Values waiting beside the one held, each as a person reads it. */
  waiting: Array<{ index: number; text: string; source?: FieldSource; proposedBy?: string }>;
  /** Whether "accept all" may take it, or a person has to name it (`acceptedOneAtATime`). */
  oneAtATime: boolean;
  /** Counted as still to fill: showing, asked for, and holding nothing. */
  missing: boolean;
  /** A must-field in play: what "recorded" is counted over. Never an expert field, an optional one or one that is worked out. */
  expected: boolean;
  /** A match table's two lists, its pairs and what is left over. */
  match?: MatchReading;
  /** The rule rows a worked-out value was read from, each with whether a person has verified it. */
  cites?: RuleCitation[];
}

export interface SectionView {
  key: string;
  label: string;
  shown: FieldShown;
  /** Marked not applicable, with the reason. */
  na?: { reason: NaReason | string; note?: string; by: string; at: string };
  fields: FieldView[];
}

export interface SheetReading {
  set: FieldSet;
  recordId?: string;
  /** A record's title: its title field as read, or what it is one of. */
  title: string;
  /** A record's summary fields that hold something. */
  chips: string[];
  sections: SectionView[];
  fields: FieldView[];
  insights: CheckInsight[];
  filled: number;
  total: number;
}

function sourceOf(project: DdProject, catalog: FieldCatalog, value: CheckFieldValue | undefined, origin: FieldOrigin | undefined): FieldSource | undefined {
  if (origin?.kind === 'paper') {
    const row = project.evidence.find((e) => e.id === origin.evidenceId);
    return { kind: 'paper', label: row?.title ?? 'A paper not on this copy', evidenceId: origin.evidenceId, page: origin.page, quote: origin.quote, reader: origin.reader };
  }
  if (origin?.kind === 'external') return { kind: 'external', label: origin.source, url: origin.url, asOf: origin.asOf, quote: origin.quote };
  if (origin?.kind === 'field') {
    const set = catalog.sets.get(origin.address.set);
    return { kind: 'field', label: set?.title ?? origin.address.set, address: origin.address };
  }
  if (origin?.kind === 'person') return { kind: 'person', label: value?.acceptedBy ?? value?.by ?? '' };
  if (origin?.kind === 'default') return { kind: 'default', label: origin.cite ?? '' };
  // A value saved before origins were kept: its paper, where it cites one.
  if (value?.sourceEvidenceId) {
    const row = project.evidence.find((e) => e.id === value.sourceEvidenceId);
    return { kind: 'paper', label: row?.title ?? 'Cited document', evidenceId: value.sourceEvidenceId, page: value.page, quote: value.quote };
  }
  return undefined;
}

/** A value as the fact-review rules see one, so the one rule about what is accepted one at a time is asked, not copied. */
function asFact(def: CheckFieldDef, value: CheckFieldValue): DocumentFact {
  const origin = value.origin;
  return {
    key: def.factKey ?? def.key,
    label: def.label,
    value: value.value as DocumentFact['value'],
    display: String(value.value),
    page: origin?.kind === 'paper' ? origin.page : 0,
    quote: origin?.kind === 'paper' ? origin.quote : '',
    source: origin?.kind === 'paper' ? origin.reader : value.proposedBy === 'model' ? 'model' : 'parser',
    ...(origin?.kind === 'paper' && origin.proof ? { proof: origin.proof } : {}),
  };
}

/** The fields a rule reads from other sets, as the rule engine takes them: a definition and a value under the key the rule names. */
function ruleAbroad(rule: CheckInsightRule, resolution: FieldResolution, catalog: FieldCatalog): { defs: CheckFieldDef[]; values: Record<string, CheckFieldValue> } {
  const defs: CheckFieldDef[] = [];
  const values: Record<string, CheckFieldValue> = {};
  for (const [key, address] of Object.entries(rule.at ?? {})) {
    const def = catalog.sets.get(address.set)?.fields.find((field) => field.key === address.field);
    const value = resolution.read(address);
    if (def) defs.push({ ...def, key });
    if (value && !isBlank(value)) values[key] = value;
  }
  return { defs, values };
}

/** One holder as a page draws it: every field with its standing, whether it shows, and where its value came from. */
export function readSheet(project: DdProject, setId: string, recordId?: string, resolution?: FieldResolution, catalog: FieldCatalog = fieldCatalog(), at: Date = new Date()): SheetReading | undefined {
  const set = catalog.sets.get(setId);
  if (!set) return undefined;
  const resolved = resolution ?? resolveFields(project, at, catalog);
  const held = stored(project, catalog, setId, recordId);
  const acting = resolved.holder(setId, recordId);
  const from = { fn: set.fn, set: set.id, record: recordId };
  const lists = (id: string) => optionSetById(id, catalog);
  // A link reads as the name of what it links to, looked up once for each register this sheet links to.
  const linked = new Map<string, Array<{ id: string; label: string }>>();
  const said = (def: CheckFieldDef, value: CheckFieldValue | undefined): string => {
    if (def.kind !== 'ref' || isBlank(value)) return formatFieldValue(def, value, lists);
    const key = JSON.stringify(def.target);
    if (!linked.has(key)) linked.set(key, refChoices(project, def.target, catalog));
    return linked.get(key)!.find((choice) => choice.id === value!.value)?.label ?? String(value!.value);
  };
  const na = sheetOf(project, setId)?.na ?? {};
  const sectionDefs = [...(set.sections ?? [])];
  if (set.fields.some((def) => !def.section)) sectionDefs.unshift({ key: '', label: '' });

  const fields: FieldView[] = set.fields.map((def) => {
    const section = sectionDefs.find((s) => s.key === (def.section ?? ''));
    const derived = fieldIsDerived(def);
    // A usual value standing in is what the field shows while it stores nothing.
    const assumed = !derived && acting[def.key]?.state === 'assumed' ? acting[def.key] : undefined;
    const own = derived ? acting[def.key] : (assumed ?? held[def.key]);
    const state: FieldState = derived ? (isBlank(own) ? 'empty' : 'accepted') : fieldState(own);
    const holds = !isBlank(own) || state === 'not_applicable' || Boolean(own?.other?.length);
    const inPlay = resolved.showing(def.showWhen, from) && resolved.showing(section?.showWhen, from) && !def.retired;
    const expert = (def.tier ?? section?.tier) === 'expert';
    // An expert field shows once it holds a value a person or a paper gave it. One that is worked out always holds one, and stays folded: it is the working behind a standing.
    const shown: FieldShown = !inPlay ? 'hidden' : expert && (!holds || derived) ? 'folded' : 'shown';
    const sectionNa = Boolean(na[def.section ?? '']);
    const address: FieldAddress = { fn: set.fn, set: set.id, field: def.key, ...(recordId ? { record: recordId } : {}) };
    const must = def.requiredWhen ? resolved.showing(def.requiredWhen, from) : def.required !== false;
    // Asked for only where it is in play, not folded away as expert, and holds nothing: not even a usual value.
    const expected = shown === 'shown' && !derived && !sectionNa && must && !expert;
    const missing = expected && state === 'empty' && !own?.other?.length;
    return {
      def,
      address,
      shown,
      // Kept and not in play is said of what somebody recorded, never of a figure that is only worked out.
      notInPlay: !inPlay && holds && !derived,
      state,
      held: own,
      text: said(def, own),
      tone: fieldTone(def, own, lists),
      source: sourceOf(project, catalog, own, own?.origin),
      waiting: (own?.other ?? []).map((other, index) => ({
        index,
        text: formatFieldValue(def, { value: other.value, at: '', by: '', entered: other.entered }, lists),
        source: sourceOf(project, catalog, undefined, other.origin),
        proposedBy: other.proposedBy,
      })),
      oneAtATime: state === 'proposed' && own ? acceptedOneAtATime(asFact(def, own)) : false,
      missing,
      expected,
      ...(shown !== 'hidden' && def.display === 'match' ? { match: readMatch(project, def, acting[def.key], resolved, catalog) } : {}),
      ...(own?.cites?.length ? { cites: own.cites } : {}),
    };
  });

  const sections: SectionView[] = sectionDefs.map((section) => {
    const inside = fields.filter((view) => (view.def.section ?? '') === section.key);
    const shown: FieldShown = inside.some((view) => view.shown === 'shown') ? 'shown' : inside.some((view) => view.shown === 'folded') ? 'folded' : 'hidden';
    return { key: section.key, label: section.label, shown, ...(na[section.key] ? { na: na[section.key] } : {}), fields: inside };
  });

  // Rules read what stands, and only of fields that are in play: a rule about a field that is not showing has nothing to say.
  const playing = new Set(fields.filter((view) => view.shown !== 'hidden' && !na[view.def.section ?? '']).map((view) => view.def.key));
  const rules = set.rules.filter((rule) => resolved.showing(rule.when, from) && rule.fields.every((key) => playing.has(key) || rule.at?.[key]));
  const insights = rules.flatMap((rule) => {
    const abroad = ruleAbroad(rule, resolved, catalog);
    return checkInsights([...set.fields, ...abroad.defs], { ...acting, ...abroad.values }, [rule], at);
  });

  const answerable = fields.filter((view) => view.expected);
  const titleDef = set.records ? set.fields.find((def) => def.key === set.records!.titleField) : undefined;
  const titleHeld = titleDef ? (acting[titleDef.key] ?? held[titleDef.key]) : undefined;
  return {
    set,
    ...(recordId ? { recordId } : {}),
    title: set.records ? (titleDef && !isBlank(titleHeld) ? said(titleDef, titleHeld) : `New ${set.records.of}`) : set.title,
    chips: (set.records?.summaryFields ?? []).flatMap((key) => {
      const def = set.fields.find((f) => f.key === key);
      return def && !isBlank(acting[key]) ? [`${def.label} ${said(def, acting[key])}`] : [];
    }),
    sections,
    fields,
    insights,
    // Recorded: a value that stands, a usual one among them, or the field marked not applicable.
    filled: answerable.filter((view) => (fieldStands(view.held) && !isBlank(view.held)) || view.state === 'not_applicable').length,
    total: answerable.length,
  };
}

/* ==================================================================== */
/* A function's page: what needs a person first                          */
/* ==================================================================== */

export type FieldExceptionKind = 'proposed' | 'situation' | 'disputed' | 'missing' | 'unmatched' | 'rule';

/** One thing on a function's sheets that needs a person. */
export interface FieldException {
  kind: FieldExceptionKind;
  /** The sheet it is on, and the record where the sheet repeats. */
  sheet: string;
  record?: string;
  address?: FieldAddress;
  /** The field's label, or the situation's. */
  label: string;
  /** The value offered, or what the rule says. */
  text: string;
  source?: FieldSource;
  tone?: Tone;
  /** For a waiting value beside the one held: which. */
  pick?: number;
  /** For a situation: the key it is kept under. */
  situation?: string;
  oneAtATime?: boolean;
}

export interface SituationView {
  at: string;
  situation: Situation;
  state: 'on' | 'off' | 'proposed';
  suggestedBy?: FieldSource;
  /** Fields that hold a value and are not showing because this is off. */
  keptValues: number;
}

export interface FunctionFields {
  fn: string;
  sheets: Array<{ set: FieldSet; reading?: SheetReading; records?: SheetReading[] }>;
  /** The shared records its sheets link to, listed beside its own: parties, parcels, units. They are the project's, and ask nothing of this function. */
  shared: Array<{ set: FieldSet; records: SheetReading[] }>;
  situations: SituationView[];
  /** In the order a person takes them: to accept, disputed, still empty, rules failing. */
  exceptions: FieldException[];
  counts: Record<FieldExceptionKind, number> & { total: number };
  /** Usual values standing in. Never among what needs a person: one quiet line. */
  assumed: number;
  /** Must-fields in play that hold a value, of all must-fields in play. */
  recorded: number;
  expected: number;
}

const SEVERITY_TONE: Record<string, Tone> = { critical: 'critical', high: 'critical', medium: 'warning', low: 'neutral' };
const ORDER: FieldExceptionKind[] = ['proposed', 'situation', 'disputed', 'missing', 'unmatched', 'rule'];

function namesSituation(when: ShowWhen | undefined, key: string): boolean {
  if (!when) return false;
  if ('situation' in when) return when.situation === key;
  if ('all' in when) return when.all.some((part) => namesSituation(part, key));
  if ('any' in when) return when.any.some((part) => namesSituation(part, key));
  return false;
}

/** Everything a function's sheets hold, with what needs a person in front. */
export function readFunctionFields(project: DdProject, fn: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalog()): FunctionFields {
  const resolution = resolveFields(project, at, catalog);
  const sheets = fieldSetsOf(fn, catalog).map((set) =>
    set.records
      ? { set, records: fieldRecords(project, set.id).flatMap((record) => readSheet(project, set.id, record.id, resolution, catalog, at) ?? []) }
      : { set, reading: readSheet(project, set.id, undefined, resolution, catalog, at) },
  );
  const readings = sheets.flatMap((sheet) => (sheet.reading ? [sheet.reading] : (sheet.records ?? [])));

  const situations: SituationView[] = situationsOf(fn, catalog).map(({ at: key, situation }) => {
    const stored = situationState(project, key);
    const state = situation.derive ? ({ state: resolution.showing(situation.derive, { fn, set: '' }) ? 'on' : 'off', by: 'derived', at: '' } as SituationState) : stored;
    const kept = readings.flatMap((reading) => reading.fields).filter((view) => view.notInPlay && (namesSituation(view.def.showWhen, situation.key) || namesSituation(reading(view)?.showWhen, situation.key))).length;
    return {
      at: key,
      situation,
      state: state?.state ?? 'off',
      ...(state?.suggestedBy ? { suggestedBy: sourceOf(project, catalog, undefined, { kind: 'paper', evidenceId: state.suggestedBy.evidenceId, page: state.suggestedBy.page ?? 0, quote: state.suggestedBy.quote ?? '', reader: 'parser' }) } : {}),
      keptValues: kept,
    };
  });
  function reading(view: FieldView) {
    return catalog.sets.get(view.address.set)?.sections?.find((section) => section.key === view.def.section);
  }

  const exceptions: FieldException[] = [];
  for (const situation of situations) {
    if (situation.state === 'proposed') exceptions.push({ kind: 'situation', sheet: '', label: situation.situation.label, text: situation.situation.hint ?? '', source: situation.suggestedBy, situation: situation.at });
  }
  for (const read of readings) {
    const where = { sheet: read.set.records ? `${read.set.title} · ${read.title}` : read.set.title, ...(read.recordId ? { record: read.recordId } : {}) };
    for (const view of read.fields) {
      // What is not in play asks nothing of anybody, whatever it holds.
      if (view.shown === 'hidden') continue;
      if (view.state === 'proposed') exceptions.push({ kind: 'proposed', ...where, address: view.address, label: view.def.label, text: view.text, source: view.source, oneAtATime: view.oneAtATime });
      else if (view.state === 'disputed') exceptions.push({ kind: 'disputed', ...where, address: view.address, label: view.def.label, text: [view.text, ...view.waiting.map((w) => w.text)].join(' / '), source: view.source, tone: 'critical' });
      if (view.state !== 'disputed') {
        for (const waiting of view.waiting) exceptions.push({ kind: 'proposed', ...where, address: view.address, label: view.def.label, text: waiting.text, source: waiting.source, pick: waiting.index, oneAtATime: true });
      }
      if (view.missing) exceptions.push({ kind: 'missing', ...where, address: view.address, label: view.def.label, text: view.def.from ?? '' });
      // What a match leaves over on either side: a thing with no counterpart.
      for (const side of view.match ? [view.match.left, view.match.right] : []) {
        for (const item of side.leftover) exceptions.push({ kind: 'unmatched', ...where, address: view.address, label: view.def.label, text: `${side.label}: ${item.label}`, tone: 'warning' });
      }
      // A day that has run out, or is about to.
      const runsOut = view.def.expires && fieldStands(view.held) ? dayNumber(view.held?.value) : null;
      if (runsOut !== null && runsOut !== undefined) {
        const left = runsOut - Math.floor(at.getTime() / 86_400_000);
        if (left < 0) exceptions.push({ kind: 'rule', ...where, address: view.address, label: view.def.label, text: `Ran out on ${view.text}`, tone: 'critical' });
        else if (left <= view.def.expires!.leadDays) exceptions.push({ kind: 'rule', ...where, address: view.address, label: view.def.label, text: `Runs out on ${view.text}`, tone: 'warning' });
      }
      // A standing that is not good is a rule failing, said in the label its case declares.
      // Where one of the sheet's own rules says the same thing in a sentence, with the figures, that sentence is the line.
      const firing = view.def.kind === 'status' ? view.def.cases?.find((option) => option.label === view.held?.value)?.when : undefined;
      const saidByRule = firing && read.set.rules.some((rule) => rule.kind === firing.kind && rule.fields.join() === firing.fields.join());
      if (view.def.kind === 'status' && !saidByRule && (view.tone === 'critical' || view.tone === 'warning')) exceptions.push({ kind: 'rule', ...where, address: view.address, label: view.def.label, text: view.text, tone: view.tone });
    }
    for (const insight of read.insights) exceptions.push({ kind: 'rule', ...where, label: read.set.title, text: insight.text, tone: SEVERITY_TONE[insight.severity] ?? 'neutral' });
  }
  exceptions.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const counts = { proposed: 0, situation: 0, disputed: 0, missing: 0, unmatched: 0, rule: 0, total: 0 };
  for (const exception of exceptions) {
    counts[exception.kind] += 1;
    counts.total += 1;
  }
  const shared = fn === SHARED_FN ? [] : sharedSetsOf(fn, catalog).map((set) => ({ set, records: fieldRecords(project, set.id).flatMap((record) => readSheet(project, set.id, record.id, resolution, catalog, at) ?? []) }));
  const views = readings.flatMap((read) => read.fields);
  return {
    fn,
    sheets,
    shared,
    situations,
    exceptions,
    counts,
    assumed: views.filter((view) => view.state === 'assumed' && view.shown !== 'hidden').length,
    recorded: readings.reduce((sum, read) => sum + read.filled, 0),
    expected: readings.reduce((sum, read) => sum + read.total, 0),
  };
}

/** What every function's sheets need of a person, for a tab's count and the Overview's line. Only functions that need something. */
export function fieldsNeeding(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalog()): Array<{ fn: string; counts: FunctionFields['counts'] }> {
  // A project that holds nothing for any set needs nothing: an untouched sheet is work not started, as an untouched check is.
  if (!project.fieldSheets && !project.situations) return [];
  return [...catalog.sheets.keys()]
    .filter((fn) => fieldSetsOf(fn, catalog).some((set) => project.fieldSheets?.[set.id]) || situationsOf(fn, catalog).some(({ at: key }) => project.situations?.[key]))
    .map((fn) => ({ fn, counts: readFunctionFields(project, fn, at, catalog).counts }))
    .filter((row) => row.counts.total > 0);
}

/* ==================================================================== */
/* What a ref field links to                                             */
/* ==================================================================== */

/** The things a `ref` field can link to on this project: each register as it stands, or the records of a set that repeats. */
export function refChoices(project: DdProject, target: RefTarget | undefined, catalog: FieldCatalog = fieldCatalog()): Array<{ id: string; label: string }> {
  if (!target) return [];
  // The records of the set it names, or of the shared record it is a target of.
  const setId = refSet(target);
  const records = setId && catalog.sets.get(setId)?.records ? fieldRecords(project, setId).map((record) => ({ id: record.id, label: readSheet(project, setId, record.id, undefined, catalog)?.title ?? record.id })) : [];
  if (typeof target === 'object') return records;
  // And what the project already keeps of the kind, linked to as it is and never entered a second time.
  const named = new Set(records.map((record) => record.label.toLowerCase()));
  const also = (rows: Array<{ id: string; label: string }>) => [...records, ...rows.filter((row) => !named.has(row.label.toLowerCase()))];
  switch (target) {
    case 'party':
      return also((project.stakeholders ?? []).map((s) => ({ id: s.id, label: s.organisation ? `${s.name}, ${s.organisation}` : s.name })));
    case 'parcel':
      return also(surveyNumbersIn(project.parcelId).map((number) => ({ id: number, label: number })));
    case 'approval':
      return also(APPROVAL_KINDS.map((kind) => ({ id: kind.key, label: kind.label })));
    case 'package':
      return (project.cost?.workPackages ?? []).map((p) => ({ id: p.id, label: p.code ? `${p.code} ${p.name}` : p.name }));
    case 'document':
      return project.evidence.map((e) => ({ id: e.id, label: e.title }));
    case 'milestone':
      return (project.milestones ?? []).map((m) => ({ id: m.id, label: m.name }));
    default:
      return records;
  }
}

/* ==================================================================== */
/* Writing                                                               */
/* ==================================================================== */

/** A shared record is the project's: whoever may do the thing in any department may do it there. */
function assertMayEdit(fn: string, options: FieldWriteOptions): void {
  if (!options.mayEdit) return;
  const department = departmentOfFunction(fn);
  const may = fn === SHARED_FN ? DEPARTMENT_KEYS.some((key) => options.mayEdit!(key)) : Boolean(department && options.mayEdit(department));
  if (!may) throw new FieldRefused('Your role on this project reads this department and does not change it.');
}

function assertMayDecide(fn: string, what: string, options: FieldWriteOptions): void {
  if (!options.mayDecide) return;
  const department = departmentOfFunction(fn);
  const may = fn === SHARED_FN ? DEPARTMENT_KEYS.some((key) => options.mayDecide!(key)) : Boolean(department && options.mayDecide(department));
  if (!may) throw decisionRefused(what, department, options.mayDecide);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A value checked against its field and against the project: a link has to name something that exists. */
function checked(project: DdProject, catalog: FieldCatalog, def: CheckFieldDef, raw: unknown, proposer: 'person' | 'model' | 'parser') {
  const parsed = validateFieldValue(def, raw, { proposer, optionSet: (id) => optionSetById(id, catalog), state: project.jurisdiction });
  if ('error' in parsed || parsed.value === null) return parsed;
  if (def.kind === 'ref' && !refChoices(project, def.target, catalog).some((choice) => choice.id === parsed.value)) {
    return { error: `${def.label} links to something that is not on this project.` };
  }
  if (def.kind === 'evidence' && Array.isArray(parsed.value)) {
    const missing = (parsed.value as string[]).filter((id) => !project.evidence.some((e) => e.id === id));
    if (missing.length) return { error: `${def.label} cites a paper that is not on this project.` };
  }
  return parsed;
}

export interface FieldWriteResult {
  rejected: Array<{ key: string; error: string }>;
  written: string[];
}

/**
 * What a person types into a sheet.
 *
 * All or nothing, as on a check: one value that will not go takes the whole
 * write with it. A typed value stands at once, under the name of whoever
 * typed it. Typed over a value that was accepted from a paper or a public
 * source, it does not replace it: the two are kept side by side as disputed,
 * and neither stands until a lead or signer keeps one.
 */
export function setFieldValues(
  project: DdProject,
  where: { set: string; record?: string },
  values: Record<string, unknown>,
  actor: string,
  options: FieldWriteOptions = {},
  catalog: FieldCatalog = fieldCatalog(),
): FieldWriteResult {
  const set = catalog.sets.get(where.set);
  if (!set || catalog.checks.has(where.set)) throw new FieldRefused('That is not a sheet. A check’s values are recorded on the check.');
  assertMayEdit(set.fn, options);
  const at = now();
  const rejected: FieldWriteResult['rejected'] = [];
  const next: Record<string, CheckFieldValue | null> = {};
  const holder = holderFor(project, catalog, where);
  for (const [key, raw] of Object.entries(values)) {
    const def = set.fields.find((field) => field.key === key);
    if (!def) {
      rejected.push({ key, error: `${set.title} has no field called "${key}".` });
      continue;
    }
    const parsed = checked(project, catalog, def, raw, 'person');
    if ('error' in parsed) {
      rejected.push({ key, error: parsed.error });
      continue;
    }
    const held = holder[key];
    if (parsed.value === null) {
      // Cleared. What waits beside it still waits.
      next[key] = held?.other?.length ? { value: null, at, by: actor, other: held.other } : null;
      continue;
    }
    const typed: CheckFieldValue = { value: parsed.value, at, by: actor, state: 'typed', origin: { kind: 'person' }, v: set.v, ...('entered' in parsed && parsed.entered ? { entered: parsed.entered } : {}) };
    const sourced = held && fieldState(held) === 'accepted' && (held.origin?.kind === 'paper' || held.origin?.kind === 'external' || Boolean(held.sourceEvidenceId));
    if (sourced && !same(held!.value, parsed.value)) {
      next[key] = { ...held!, state: 'disputed', other: [...(held!.other ?? []), { value: parsed.value, origin: { kind: 'person' }, proposedBy: actor, at, ...(typed.entered ? { entered: typed.entered } : {}) }] };
    } else if (held && fieldState(held) === 'proposed' && !same(held.value, parsed.value)) {
      // The proposal is not lost by typing: it waits beside what was typed.
      next[key] = { ...typed, other: [...(held.other ?? []), { value: held.value, origin: held.origin ?? { kind: 'person' }, proposedBy: held.proposedBy, at: held.at, ...(held.entered ? { entered: held.entered } : {}) }] };
    } else {
      next[key] = { ...typed, ...(held?.other?.length ? { other: held.other } : {}), ...(held?.declined ? { declined: held.declined } : {}) };
    }
  }
  if (rejected.length) return { rejected, written: [] };
  for (const [key, value] of Object.entries(next)) {
    if (value === null) delete holder[key];
    else holder[key] = value;
  }
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'set_field_values', entityType: 'field_set', entityId: where.record ? `${where.set}::${where.record}` : where.set, newValue: Object.keys(next).join(', '), at });
  return { rejected: [], written: Object.keys(next) };
}

/** A value offered for a field, with where it was read. */
export interface FieldProposal {
  address: FieldAddress;
  value: unknown;
  origin: FieldOrigin;
}

export interface FieldProposalOutcome {
  address: FieldAddress;
  /** `waiting`: it is on the field for a person to accept. `held`: the field already holds this value. `declined`: a person has already set this value aside here. */
  outcome: 'waiting' | 'held' | 'declined' | 'refused';
  error?: string;
}

/**
 * Offers values to fields. Nothing offered stands: each waits on its field
 * until a person accepts it.
 *
 * Refused, each with its reason: an address that names no field; a field
 * that is worked out, mirrored, prose or no longer asked; a value with no
 * source (a paper's page and words, or a public source and its date); a
 * paper that is not on the project; a choice that is not on the list; a link
 * to something that does not exist.
 *
 * A value for a set that repeats names its record. With no record named, the
 * values offered together make one new record, which is nothing until one of
 * its values is accepted.
 */
export function proposeFieldValues(
  project: DdProject,
  proposals: readonly FieldProposal[],
  proposer: 'model' | 'parser',
  catalog: FieldCatalog = fieldCatalog(),
): FieldProposalOutcome[] {
  const at = now();
  const fresh = new Map<string, FieldRecord>();
  const out: FieldProposalOutcome[] = [];
  for (const proposal of proposals) {
    const refuse = (error: string) => out.push({ address: proposal.address, outcome: 'refused', error });
    const set = catalog.sets.get(proposal.address.set);
    const def = set?.fields.find((field) => field.key === proposal.address.field);
    if (!set || !def) {
      refuse(`No field at ${proposal.address.set}/${proposal.address.field}.`);
      continue;
    }
    if (def.retired) {
      refuse(`${def.label} is no longer asked.`);
      continue;
    }
    const origin = proposal.origin;
    if (!origin || (origin.kind !== 'paper' && origin.kind !== 'external')) {
      refuse(`${def.label} needs a source: a paper with its page and words, or a public source with its date.`);
      continue;
    }
    if (origin.kind === 'paper') {
      if (!origin.quote?.trim() || !(origin.page >= 1)) {
        refuse(`${def.label} needs the page and the paper’s own words.`);
        continue;
      }
      if (!project.evidence.some((e) => e.id === origin.evidenceId)) {
        refuse(`${def.label} cites a paper that is not on this project.`);
        continue;
      }
    } else if (!origin.source?.trim() || !/^\d{4}-\d{2}-\d{2}/.test(origin.asOf ?? '')) {
      refuse(`${def.label} needs the source’s name and the date it was read.`);
      continue;
    }
    const parsed = checked(project, catalog, def, proposal.value, proposer);
    if ('error' in parsed) {
      refuse(parsed.error);
      continue;
    }
    if (parsed.value === null) {
      refuse(`${def.label}: no value was given.`);
      continue;
    }
    let holder: Record<string, CheckFieldValue>;
    let address = proposal.address;
    try {
      if (set.records && !address.record) {
        let record = fresh.get(set.id);
        if (!record) {
          record = { id: newId('rec'), values: {}, createdAt: at, by: proposer };
          fresh.set(set.id, record);
          const sheet = sheetFor(project, set.id);
          sheet.records = [...(sheet.records ?? []), record];
        }
        address = { ...address, record: record.id };
        holder = record.values;
      } else holder = holderFor(project, catalog, address);
    } catch (error) {
      refuse(error instanceof Error ? error.message : 'That cannot be written.');
      continue;
    }
    const held = holder[def.key];
    const offered: CheckFieldValue = {
      value: parsed.value,
      at,
      by: proposer,
      state: 'proposed',
      origin: origin.kind === 'paper' ? { ...origin, quote: origin.quote.slice(0, 220) } : origin,
      proposedBy: proposer,
      v: set.v,
      ...('entered' in parsed && parsed.entered ? { entered: parsed.entered } : {}),
      ...(origin.kind === 'paper' ? { sourceEvidenceId: origin.evidenceId, page: origin.page, quote: origin.quote.slice(0, 220) } : {}),
    };
    if (held?.declined?.some((declined) => same(declined.value, parsed.value))) {
      out.push({ address, outcome: 'declined' });
      continue;
    }
    if (held && !isBlank(held) && same(held.value, parsed.value)) {
      out.push({ address, outcome: 'held' });
      continue;
    }
    const beside = { value: parsed.value, origin: offered.origin!, proposedBy: proposer, at, ...(offered.entered ? { entered: offered.entered } : {}) };
    if (!held || (isBlank(held) && fieldState(held) !== 'not_applicable') || fieldState(held) === 'proposed') {
      // One value waits on an empty field at a time: a newer reading takes the place of the one that waited.
      holder[def.key] = { ...offered, ...(held?.declined ? { declined: held.declined } : {}), ...(held?.other?.length ? { other: held.other } : {}) };
    } else if (held.other?.some((other) => same(other.value, parsed.value))) {
      out.push({ address, outcome: 'waiting' });
      continue;
    } else {
      // Beside a value that is held: it stays in force, and this waits for a person to keep one.
      holder[def.key] = { ...held, other: [...(held.other ?? []), beside] };
    }
    out.push({ address, outcome: 'waiting' });
  }
  if (out.some((row) => row.outcome === 'waiting')) {
    project.updatedAt = at;
    recordAuditEvent(project, { actor: proposer, action: 'propose_field_values', entityType: 'field_set', entityId: [...new Set(out.filter((r) => r.outcome === 'waiting').map((r) => r.address.set))].join(', '), newValue: `${out.filter((r) => r.outcome === 'waiting').length} offered`, at });
  }
  return out;
}

/** The most a person may write beside a reason. */
export const NA_NOTE_MOST = 120;

/** A reason for not applicable, as one of the five. Anything else is refused: no sentence is kept as a reason. */
function naReasonOf(reason: unknown): NaReason {
  if (!NA_REASONS.includes(reason as NaReason)) throw new FieldRefused('Pick why it does not apply.');
  return reason as NaReason;
}

export type FieldValueDecision = 'accept' | 'keep' | 'set_aside' | 'dispute' | 'not_applicable' | 'reopen';

/**
 * A person's decision on one field.
 *
 * - `accept`: the value that waits now stands. With `value`, it is the
 *   person's own figure that stands and the one offered is set aside. With
 *   `pick`, a value waiting beside the one held takes its place.
 * - `keep`: the value held stays, and what waited beside it is set aside. A
 *   dispute is settled this way, or by `accept` with `pick`.
 * - `set_aside`: the value that waits is not this field's. It is remembered,
 *   so the same reading is not offered again.
 * - `dispute`: the value held is in question, and acts on nothing until
 *   somebody settles it. With `value`, the other figure is kept beside it.
 * - `not_applicable`: the field does not apply here, with the reason.
 * - `reopen`: a field marked not applicable is asked again.
 *
 * Raising a dispute needs a role that edits. Every other decision makes a
 * value count or stop counting, and needs a lead or signer of the function's
 * department: the rule for a paper's values, asked of the field's function.
 */
export function decideField(
  project: DdProject,
  address: FieldAddress,
  decision: FieldValueDecision,
  actor: string,
  input: { value?: unknown; pick?: number; reason?: string; note?: string } = {},
  options: FieldWriteOptions = {},
  catalog: FieldCatalog = fieldCatalog(),
): CheckFieldValue | undefined {
  const set = catalog.sets.get(address.set);
  const def = set?.fields.find((field) => field.key === address.field);
  if (!set || !def) throw new FieldRefused(`No field at ${address.set}/${address.field}.`);
  if (fieldIsDerived(def)) throw new FieldRefused(`${def.label} is worked out, and nobody decides it.`);
  if (decision === 'dispute') assertMayEdit(set.fn, options);
  else assertMayDecide(set.fn, `Deciding ${def.label}`, options);
  const holder = holderFor(project, catalog, address);
  const held = holder[def.key];
  const state = fieldState(held);
  const at = now();
  const declined = (value: CheckFieldValue['value']) => [...(held?.declined ?? []), { value, by: actor, at }];
  const stand = (origin: FieldOrigin | undefined): FieldState => (origin?.kind === 'person' || !origin ? 'typed' : 'accepted');
  const edit = () => {
    const parsed = checked(project, catalog, def, input.value, 'person');
    if ('error' in parsed) throw new FieldRefused(parsed.error);
    if (parsed.value === null) throw new FieldRefused(`${def.label}: no value was given.`);
    return parsed;
  };

  let next: CheckFieldValue | undefined;
  switch (decision) {
    case 'accept': {
      if (input.pick !== undefined) {
        const other = held?.other?.[input.pick];
        if (!held || !other) throw new FieldRefused('No such value waits on this field.');
        const rest = held.other!.filter((_, index) => index !== input.pick);
        next = {
          value: other.value,
          at,
          by: other.proposedBy ?? actor,
          state: other.origin.kind === 'person' ? 'typed' : 'accepted',
          origin: other.origin,
          acceptedBy: actor,
          acceptedAt: at,
          v: set.v,
          ...(other.entered ? { entered: other.entered } : {}),
          ...(other.origin.kind === 'paper' ? { sourceEvidenceId: other.origin.evidenceId, page: other.origin.page, quote: other.origin.quote } : {}),
          ...(other.proposedBy ? { proposedBy: other.proposedBy } : {}),
          // What it replaced, and whatever else waited, is set aside: a person has chosen.
          declined: [...(isBlank(held) ? (held.declined ?? []) : declined(held.value)), ...rest.map((r) => ({ value: r.value, by: actor, at }))],
        };
        break;
      }
      if (!held || state !== 'proposed') throw new FieldRefused('Nothing waits on this field.');
      if (input.value !== undefined && input.value !== null && input.value !== '') {
        const parsed = edit();
        if (!same(parsed.value, held.value)) {
          next = { value: parsed.value, at, by: actor, state: 'typed', origin: { kind: 'person' }, acceptedBy: actor, acceptedAt: at, v: set.v, ...('entered' in parsed && parsed.entered ? { entered: parsed.entered } : {}), declined: declined(held.value) };
          break;
        }
      }
      next = { ...held, state: 'accepted', acceptedBy: actor, acceptedAt: at };
      break;
    }
    case 'keep': {
      if (!held || isBlank(held)) throw new FieldRefused('This field holds nothing to keep.');
      next = { ...held, state: state === 'disputed' || state === 'proposed' ? stand(held.origin ?? (held.sourceEvidenceId ? { kind: 'paper', evidenceId: held.sourceEvidenceId, page: held.page ?? 0, quote: held.quote ?? '', reader: 'parser' } : undefined)) : state, acceptedBy: actor, acceptedAt: at, declined: [...(held.declined ?? []), ...(held.other ?? []).map((o) => ({ value: o.value, by: actor, at }))] };
      delete next.other;
      break;
    }
    case 'set_aside': {
      if (!held || state !== 'proposed') throw new FieldRefused('Nothing waits on this field.');
      next = held.other?.length ? { value: null, at, by: actor, other: held.other, declined: declined(held.value) } : { value: null, at, by: actor, declined: declined(held.value) };
      break;
    }
    case 'dispute': {
      if (!held || isBlank(held)) throw new FieldRefused('This field holds nothing to dispute.');
      const other = input.value !== undefined && input.value !== null && input.value !== '' ? edit() : undefined;
      next = { ...held, state: 'disputed', ...(other ? { other: [...(held.other ?? []), { value: other.value, origin: { kind: 'person' as const }, proposedBy: actor, at, ...('entered' in other && other.entered ? { entered: other.entered } : {}) }] } : {}) };
      break;
    }
    case 'not_applicable': {
      const reason = naReasonOf(input.reason);
      const note = (input.note ?? '').trim();
      if (note.length > NA_NOTE_MOST) throw new FieldRefused(`The note takes ${NA_NOTE_MOST} characters at most.`);
      next = { value: null, at, by: actor, state: 'not_applicable', naReason: reason, ...(note ? { naNote: note } : {}), acceptedBy: actor, acceptedAt: at, ...(held && !isBlank(held) ? { declined: declined(held.value) } : held?.declined ? { declined: held.declined } : {}) };
      break;
    }
    case 'reopen': {
      if (state !== 'not_applicable') throw new FieldRefused('This field is not marked not applicable.');
      next = held?.declined?.length ? { value: null, at, by: actor, declined: held.declined } : undefined;
      break;
    }
  }
  if (next) holder[def.key] = next;
  else delete holder[def.key];
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: `field_${decision}`, entityType: 'field', entityId: addressKey(address), newValue: next && !isBlank(next) ? String(next.value).slice(0, 120) : decision, at });
  return next;
}

/**
 * Accept every value one paper offered to a function's sheets, in one press.
 * It leaves the ones a person has to name (`acceptedOneAtATime`): a model's
 * yes or no, an exact figure with only a second model behind it, a value
 * waiting beside another. Returns what it accepted and what it left.
 */
export function acceptAllFromPaper(project: DdProject, fn: string, evidenceId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalog()): { accepted: FieldAddress[]; left: FieldAddress[] } {
  assertMayDecide(fn, 'Accepting these values', options);
  const accepted: FieldAddress[] = [];
  const left: FieldAddress[] = [];
  for (const exception of readFunctionFields(project, fn, new Date(), catalog).exceptions) {
    if (exception.kind !== 'proposed' || !exception.address || exception.source?.evidenceId !== evidenceId) continue;
    if (exception.oneAtATime || exception.pick !== undefined) left.push(exception.address);
    else {
      decideField(project, exception.address, 'accept', actor, {}, options, catalog);
      accepted.push(exception.address);
    }
  }
  return { accepted, left };
}

/* --- Records ---------------------------------------------------------- */

/** A new record of a set that repeats, with what a person typed for it. */
export function addFieldRecord(project: DdProject, setId: string, values: Record<string, unknown>, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalog()): { record?: FieldRecord; rejected: FieldWriteResult['rejected'] } {
  const set = catalog.sets.get(setId);
  if (!set?.records || catalog.checks.has(setId)) throw new FieldRefused('That is not a set that repeats.');
  assertMayEdit(set.fn, options);
  const at = now();
  const record: FieldRecord = { id: newId('rec'), values: {}, createdAt: at, by: actor };
  const sheet = sheetFor(project, setId);
  sheet.records = [...(sheet.records ?? []), record];
  const { rejected } = Object.keys(values).length ? setFieldValues(project, { set: setId, record: record.id }, values, actor, options, catalog) : { rejected: [] };
  if (rejected.length) {
    sheet.records = sheet.records.filter((held) => held.id !== record.id);
    return { rejected };
  }
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'add_field_record', entityType: 'field_set', entityId: `${setId}::${record.id}`, newValue: set.records.of, at });
  return { record, rejected: [] };
}

/** Takes a record off its list. It is kept, with who took it off and when. */
export function removeFieldRecord(project: DdProject, setId: string, recordId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalog()): void {
  const set = catalog.sets.get(setId);
  const record = sheetOf(project, setId)?.records?.find((held) => held.id === recordId && !held.removed);
  if (!set?.records || !record) throw new FieldRefused('That record is not on this project.');
  assertMayDecide(set.fn, `Taking a record off ${set.title}`, options);
  const at = now();
  record.removed = { by: actor, at };
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'remove_field_record', entityType: 'field_set', entityId: `${setId}::${recordId}`, at });
}

/* --- Situations ------------------------------------------------------- */

/**
 * Puts a situation in play or takes it out. Taking it out deletes nothing:
 * the fields it brought keep what they hold, shown as not in play, and come
 * back as they were when it is put in play again.
 */
export function setSituation(project: DdProject, fn: string, key: string, on: boolean, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalog()): SituationState {
  const at = situationAt(catalog, fn, key);
  if (!catalog.situations.has(at)) throw new FieldRefused(`No situation called "${key}".`);
  if (catalog.situations.get(at)!.derive) throw new FieldRefused('This follows from what is recorded. Nobody sets it.');
  assertMayDecide(fn, 'Setting a situation', options);
  const when = now();
  const held = project.situations?.[at];
  const next: SituationState = { state: on ? 'on' : 'off', by: actor, at: when, ...(held?.suggestedBy ? { suggestedBy: held.suggestedBy } : {}) };
  project.situations = { ...(project.situations ?? {}), [at]: next };
  project.updatedAt = when;
  recordAuditEvent(project, { actor, action: on ? 'situation_on' : 'situation_off', entityType: 'situation', entityId: at, at: when });
  return next;
}

/**
 * Proposes the situations the file suggests: a kind of paper on file, or a
 * field holding a value. Each waits for a person; none brings a field into
 * play until accepted. One a person has already answered is not proposed
 * again. Returns the keys newly proposed.
 */
export function proposeSituations(project: DdProject, proposer = 'parser', catalog: FieldCatalog = fieldCatalog()): string[] {
  const proposed: string[] = [];
  let resolution: FieldResolution | undefined;
  for (const [at, situation] of catalog.situations) {
    if (project.situations?.[at] || !situation.proposeFrom || situation.derive) continue;
    const types = situation.proposeFrom.documentTypes?.map((type) => type.toLowerCase()) ?? [];
    const paper = project.evidence.find((e) => !e.unconfirmedReply && e.attachments?.length && e.documentType && types.includes(e.documentType.toLowerCase()));
    let suggestedBy: SituationState['suggestedBy'];
    if (paper) {
      // The page a standing value of the paper is on, where it has one: what it says is not what suggests the situation, its kind is.
      const read = standingFacts(paper)[0];
      suggestedBy = { evidenceId: paper.id, ...(read ? { page: read.page, quote: read.quote.slice(0, 220) } : {}) };
    }
    else if (situation.proposeFrom.field) {
      resolution ??= resolveFields(project, new Date(), catalog);
      const value = resolution.read(situation.proposeFrom.field);
      if (isBlank(value) || value!.value === false) continue;
      if (value!.sourceEvidenceId) suggestedBy = { evidenceId: value!.sourceEvidenceId, page: value!.page, quote: value!.quote };
    } else continue;
    const when = now();
    project.situations = { ...(project.situations ?? {}), [at]: { state: 'proposed', by: proposer, at: when, ...(suggestedBy ? { suggestedBy } : {}) } };
    proposed.push(at);
  }
  return proposed;
}

/**
 * Offers a paper's values to every field set that says it reads that kind of
 * paper: a field whose `fromTypes` names the paper's kind takes the value the
 * reading filed under the field's key (or its `factKey`).
 *
 * Only values that stand on the paper are handed on (`settled`): a model's
 * reading nobody has accepted there, and one two readers differ on, wait on
 * the paper first. On the sheet every one of them waits again, for a lead or
 * signer of the function. The situations the paper suggests are proposed with
 * it. Reading the same paper twice offers nothing twice.
 */
export function offerPaperToSheets(project: DdProject, evidenceId: string | undefined, facts: readonly DocumentFact[], catalog: FieldCatalog = fieldCatalog()): FieldProposalOutcome[] {
  const paper = evidenceId ? project.evidence.find((e) => e.id === evidenceId) : undefined;
  const kind = paper?.documentType?.toLowerCase();
  if (!paper || !kind || paper.unconfirmedReply) return [];
  const proposals: FieldProposal[] = [];
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      for (const def of set.fields) {
        if (!def.fromTypes?.some((type) => type.toLowerCase() === kind) || fieldIsDerived(def) || def.kind === 'longtext') continue;
        const fact = facts.find((f) => f.key === (def.factKey ?? def.key) && settled(f));
        if (!fact) continue;
        // A set that repeats: this paper's value is already on one of its records, waiting or decided.
        const already = set.records && fieldRecords(project, set.id).some((record) => {
          const held = record.values[def.key];
          const from = (origin: FieldOrigin | undefined) => origin?.kind === 'paper' && origin.evidenceId === paper.id;
          return held && (from(held.origin) || held.other?.some((o) => from(o.origin)) || held.declined?.some((d) => String(d.value) === String(fact.value)));
        });
        if (already) continue;
        proposals.push({
          address: { fn: set.fn, set: set.id, field: def.key },
          // An area is filed in square metres, whatever the field is entered in.
          value: def.dimension === 'area' && typeof fact.value === 'number' ? `${fact.value} sqm` : fact.value,
          origin: { kind: 'paper', evidenceId: paper.id, page: fact.page, quote: fact.quote, reader: fact.source === 'model' ? 'model' : 'parser', ...(proofOf(fact) ? { proof: proofOf(fact) } : {}) },
        });
      }
    }
  }
  const outcomes = proposals.length ? proposeFieldValues(project, proposals, 'parser', catalog) : [];
  proposeSituations(project, 'parser', catalog);
  return outcomes;
}

/** Marks a section of a sheet not applicable, with the reason, or asks it again with none. */
export function setSectionNotApplicable(project: DdProject, setId: string, section: string, reason: NaReason | null, actor: string, options: FieldWriteOptions & { note?: string } = {}, catalog: FieldCatalog = fieldCatalog()): void {
  const set = catalog.sets.get(setId);
  if (!set || catalog.checks.has(setId) || !(set.sections ?? []).some((s) => s.key === section)) throw new FieldRefused('No such section.');
  assertMayDecide(set.fn, 'Marking a section not applicable', options);
  const sheet = sheetFor(project, setId);
  const at = now();
  const note = (options.note ?? '').trim();
  if (note.length > NA_NOTE_MOST) throw new FieldRefused(`The note takes ${NA_NOTE_MOST} characters at most.`);
  const next = { ...(sheet.na ?? {}) };
  if (reason === null) delete next[section];
  else next[section] = { reason: naReasonOf(reason), ...(note ? { note } : {}), by: actor, at };
  sheet.na = next;
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: reason === null ? 'section_reopened' : 'section_not_applicable', entityType: 'field_set', entityId: `${setId}::${section}`, at });
}

/* ==================================================================== */
/* For the tools, the graph and memory                                   */
/* ==================================================================== */

export interface FieldLine {
  address: FieldAddress;
  def: CheckFieldDef;
  /** The set's title, and the record's where the set repeats. */
  where: string;
  value: CheckFieldValue;
  text: string;
  /** The field this one mirrors, where it does. */
  sameAs?: FieldAddress;
}

/**
 * Every value a project's sheets hold that stands, one line for each, with
 * its address. What the graph and memory read: a proposed or disputed value
 * is not among them, and a field that is not in play is.
 */
export function standingFieldLines(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalog()): FieldLine[] {
  if (!project.fieldSheets) return [];
  const resolution = resolveFields(project, at, catalog);
  const lines: FieldLine[] = [];
  const lists = (id: string) => optionSetById(id, catalog);
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      if (!project.fieldSheets[set.id]) continue;
      const holders = set.records ? fieldRecords(project, set.id).map((record) => record.id) : [undefined];
      for (const recordId of holders) {
        const acting = resolution.holder(set.id, recordId);
        const titled = set.records ? readSheet(project, set.id, recordId, resolution, catalog, at)?.title : undefined;
        for (const def of set.fields) {
          const value = acting[def.key];
          if (isBlank(value)) continue;
          lines.push({
            address: { fn: set.fn, set: set.id, field: def.key, ...(recordId ? { record: recordId } : {}) },
            def,
            where: titled ? `${set.title} · ${titled}` : set.title,
            value: value!,
            text: formatFieldValue(def, value, lists),
            ...(def.sameAs ? { sameAs: def.sameAs } : {}),
          });
        }
      }
    }
  }
  return lines;
}

/** A field as a tool describes it to a model: what it is, what it takes, and where it stands. Labels and keys only. */
export function describeField(view: FieldView, catalog: FieldCatalog = fieldCatalog()) {
  const def = view.def;
  const derived = fieldIsDerived(def);
  return {
    address: view.address,
    label: def.label,
    kind: def.kind,
    ...(def.unit ? { unit: def.unit } : {}),
    ...(def.dimension ? { dimension: def.dimension, enterIn: def.enterIn } : {}),
    ...(def.kind === 'enum' || def.kind === 'multi_enum' ? { options: fieldOptions(def, (id) => optionSetById(id, catalog)).filter((o) => !o.retired).map((o) => o.key) } : {}),
    ...(def.fromTypes?.length ? { readFrom: def.fromTypes } : def.from ? { readFrom: [def.from] } : {}),
    required: def.required !== false,
    state: view.state,
    value: view.text,
    showing: view.shown !== 'hidden',
    // What may be offered: not a field that is worked out or mirrored, and not prose.
    mayPropose: !derived && def.kind !== 'longtext' && !def.retired,
    ...(view.source ? { source: { kind: view.source.kind, label: view.source.label, page: view.source.page, asOf: view.source.asOf } } : {}),
  };
}
