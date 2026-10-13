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
import { checkInsights, computedValue, dayNumber, dayOfNumber, evaluateFormula, evaluateStatus, formulaOverNothing, ownRows, rowMeets, tableRows, fieldIsDerived, fieldNumber, fieldOptions, fieldStands, fieldState, fieldTone, formatFieldValue, isBlank, standingField, validateFieldValue, type FormulaOutside } from './check-fields';
import { checkFieldsAsRead, checkOfferCards, checkOfferStanding, decideCheckWaiting, type CheckOffer } from './check-waiting';
import { DEPARTMENT_KEYS, SUB_STAGES, workstreamDefinition, type DepartmentKey, type DepartmentRole } from './departments';
import { surveyNumbersIn } from './document-intake';
import { paperCarries, type DocumentFact, type FactProof } from './document-parse';
import { allChecks } from './engagements';
import { acceptedOneAtATime, proofOf, proposedFacts, settled, standingFacts } from './fact-review';
import { LIVE, PROJECT_FIGURES, projectFigure } from './field-figures';
import { asAtMoment, isPastDay, projectAsAt } from './as-at';
import { AS_NOW_NO_HISTORY, fieldHistorySaid, figureReadsAsAt, indiaDayEnd, stand, type FieldHistorySaid } from './field-history';
import { periodsOf, periodsStanding, setPeriods, type SetPeriods } from './field-periods';
import { SITE_FN, stationRoundDue } from './photo-stations';
import { addressKey, depthSheet, fieldCatalog, fieldReads, fieldSetsOf, matchSides, optionSetById, refSet, sharedSetsOf, situationsOf, type FieldCatalog } from './field-registry';
import { fieldCatalogFor, ruleRowsFor } from './firm-fields';
import { RULE_ROWS } from './field-sets';
import { SHARED_FN } from './field-sets/shared-records';
import { periodOfKey } from './period-keys';
import { indiaToday } from './quarters';
import { ruleCitation, ruleRow } from './rule-tables';
import { parseMeasure, type Entered } from './units';
import { recordAuditEvent } from './operations';
import { decisionRefused, mayDecidePaper, reviewFacts } from './review';
import { personSaid, type MayDecide } from './team';
import { documentWorkstream } from './vault';
import type {
  ChatProposal,
  CheckFieldDef,
  CheckFieldValue,
  CheckInsight,
  CheckInstance,
  CheckInsightRule,
  DdProject,
  DepthSheet,
  FieldAddress,
  LifecycleStage,
  OwedRole,
  FieldOrigin,
  FieldRecord,
  FieldSet,
  FieldState,
  FrozenField,
  MatchList,
  RefTarget,
  RowWhere,
  RuleCitation,
  RuleRow,
  ShowWhen,
  Situation,
  SituationState,
  StoredFieldSheet,
  Tone,
} from './types';
import { NA_REASONS, OWED_ROLE_LABEL, type NaReason } from './types';

const now = (): string => new Date().toISOString();
const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Who may change a department's records, as the caller answers it. Absent, nobody is asking. */
export type MayEdit = (department: DepartmentKey) => boolean;

export interface FieldWriteOptions {
  mayDecide?: MayDecide;
  mayEdit?: MayEdit;
  /** The caller's role in a department, where issuing a period asks for the signer and not only somebody who decides. */
  roleIn?: (department: DepartmentKey) => DepartmentRole | undefined;
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
export function checkHolding(project: DdProject, definitionId: string) {
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

/**
 * The records of a set that repeats that are still on its list. An issued
 * period that a later revision has taken the place of is kept as it was sent
 * and is no longer on the list: the revision is.
 */
export function fieldRecords(project: DdProject, setId: string): FieldRecord[] {
  const kept = (sheetOf(project, setId)?.records ?? []).filter((record) => !record.removed);
  if (!kept.some((record) => record.revises)) return kept;
  const replaced = new Set(kept.filter((record) => record.revises && record.issued).map((record) => record.revises));
  return kept.filter((record) => !replaced.has(record.id));
}

/** A revision still open beside the issued period it corrects: on the list to be worked on, and counted by nothing until it is issued. */
const openRevision = (record: FieldRecord): boolean => Boolean(record.revises) && !record.issued;

/** Takes a key off the list of what a record carried from the last period: somebody has written it since. */
function notCarried(project: DdProject, where: { set: string; record?: string; period?: string }, key: string): void {
  if (where.period) return;
  const sheet = sheetOf(project, where.set);
  const record = where.record ? sheet?.records?.find((held) => held.id === where.record) : undefined;
  if (record?.carried?.keys.includes(key)) record.carried = { ...record.carried, keys: record.carried.keys.filter((held) => held !== key) };
  // A sheet held once carries on its open period.
  const open = where.record ? undefined : sheet?.open;
  if (sheet && open?.carried?.keys.includes(key)) sheet.open = { ...open, carried: { ...open.carried, keys: open.carried.keys.filter((held) => held !== key) } };
}

/** Why an issued period takes no write. */
const ISSUED_SAID = 'This period is issued. A correction is a revision kept beside it.';

/** Everything one holder stores, whatever its standing. */
function stored(project: DdProject, catalog: FieldCatalog, setId: string, recordId?: string): Record<string, CheckFieldValue> {
  if (catalog.checks.has(setId)) {
    // A check's fields with what waits for them: a value on a card of the check's is read on its field, as proposed.
    const check = checkHolding(project, setId);
    return check ? checkFieldsAsRead(project, check) : {};
  }
  const sheet = sheetOf(project, setId);
  // A record taken off its list is kept and read by nothing: no formula, no link and no rule reaches it.
  if (recordId) return sheet?.records?.find((record) => record.id === recordId && !record.removed)?.values ?? {};
  return sheet?.values ?? {};
}

/** Whether a record is one yet: somebody has accepted or typed a value on it. One that only holds what was offered is nothing until then. */
function recordStands(record: Pick<FieldRecord, 'values'>): boolean {
  return Object.values(record.values).some((value) => fieldStands(value) && !isBlank(value));
}

/** The holder to write into, made if it is not there. A check's is the check itself. */
function holderFor(project: DdProject, catalog: FieldCatalog, address: Pick<FieldAddress, 'set' | 'record' | 'period'>): Record<string, CheckFieldValue> {
  if (catalog.checks.has(address.set)) {
    const check = checkHolding(project, address.set);
    if (!check) throw new FieldRefused('That check is not on this project.');
    check.fields ??= {};
    return check.fields;
  }
  const sheet = sheetFor(project, address.set);
  if (address.period && !address.record) {
    // A period of a sheet takes a write only while a revision of it is open: an issue is never edited.
    const revision = sheet.periods?.find((period) => period.key === address.period && period.status === 'open');
    if (!revision) throw new FieldRefused(ISSUED_SAID);
    return revision.values;
  }
  if (!address.record) return sheet.values;
  const record = sheet.records?.find((held) => held.id === address.record && !held.removed);
  if (!record) throw new FieldRefused('That record is not on this project.');
  if (record.issued) throw new FieldRefused(ISSUED_SAID);
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
export function resolveFields(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project), rules: readonly RuleRow[] = ruleRowsFor(project)): FieldResolution {
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
  const today = indiaToday(at);
  // One reading of the project: several figures of one module (the valuation, say) work it out once.
  const figures = new Map<string, unknown>();

  // What a worked-out value rests on that nobody entered: a usual value standing in, by its field's label.
  // On a reading as at a past day: whether anything a value was worked out from is today's, for want of a past. Kept by the
  // list of what the same value rests on, so each value being worked out has its own.
  const nowOf = new Map<string[], string>();
  const rests = (assumes: string[], value: CheckFieldValue | undefined, label: () => string) => {
    if (value?.state === 'assumed' && !isBlank(value)) assumes.push(label());
    assumes.push(...(value?.assumes ?? []));
    if (value?.asNow && !isBlank(value) && !nowOf.has(assumes)) nowOf.set(assumes, value.asNow);
  };
  // Every field of an issued period as it was frozen at issue: a record that is issued, or the sheet read as at a day an issue covers.
  const frozenHeld = new Map<string, Record<string, FrozenField> | undefined>();
  const frozenOf = (setId: string, recordId?: string): Record<string, FrozenField> | undefined => {
    const key = `${setId}::${recordId ?? ''}`;
    if (!frozenHeld.has(key)) {
      const sheet = catalog.checks.has(setId) ? undefined : sheetOf(project, setId);
      const record = recordId ? sheet?.records?.find((held) => held.id === recordId && !held.removed) : undefined;
      frozenHeld.set(key, recordId ? (record?.issued ? record.frozen : undefined) : sheet?.asIssued?.frozen);
    }
    return frozenHeld.get(key);
  };
  const labelAt = (address: FieldAddress) => catalog.sets.get(address.set)?.fields.find((f) => f.key === address.field)?.label ?? address.field;

  const outside = (set: FieldSet, recordId: string | undefined, cites: RuleCitation[], assumes: string[]): FormulaOutside => ({
    // A field of the same set that repeats, asked from one of its records, is that record's.
    read: (address) => {
      const value = read(address.set === set.id && !address.record && recordId ? { ...address, record: recordId } : address);
      cites.push(...(value?.cites ?? []));
      rests(assumes, value, () => labelAt(address));
      return value;
    },
    records: (setId) => {
      const rows = records(setId);
      // On a reading as at a past day: where a row's own values are today's, for want of a past, what is counted or summed over the rows is today's too.
      if (project.asAt && rows && !nowOf.has(assumes)) {
        const asNow = fieldRecords(project, setId).flatMap((record) => Object.values(record.values)).find((value) => value.asNow && !isBlank(value))?.asNow;
        if (asNow) nowOf.set(assumes, asNow);
      }
      return rows;
    },
    // The row for this project's place, in force on the day asked. What was read is kept, so the value can say where its figure is written.
    rate: (table, on, conditions) => {
      const row = ruleRow(rules, table, { state: project.jurisdiction, city: project.city }, on ?? today, conditions);
      if (row) cites.push(ruleCitation(row));
      return row?.value ?? null;
    },
    figure: (key, named, asAt) => {
      // A figure of the record that asks (a station's own shots) is given that record, where the formula names no link.
      const of = named ?? (PROJECT_FIGURES[key]?.own ? recordId : undefined);
      // A figure asked for as at one of the holder's own days is read from the project as it stood then, where the day has gone by.
      const past = asAt && asAt !== project.asAt && isPastDay(asAt, at) ? pastOn(asAt) : undefined;
      // A figure of a module that keeps no past is today's, on whatever day the project is read as at.
      if ((project.asAt || past) && !figureReadsAsAt(key) && !nowOf.has(assumes)) nowOf.set(assumes, AS_NOW_NO_HISTORY);
      return past ? projectFigure(past.view, key, asAtMoment(asAt!), of, past.figures) : projectFigure(project, key, at, of, figures);
    },
    moved: (key, since) => {
      const address: FieldAddress = { fn: set.fn, set: set.id, field: key, ...(recordId ? { record: recordId } : {}) };
      const now = fieldNumber(read(address));
      if (now === null) return null;
      const less = (was: number | null): number | null => (was === null ? null : Math.round((now - was) * 100) / 100);
      if (since === 'last_period') return less(lastPeriodFigure(set, recordId, key));
      // So many days ago: the same field, read from the project as it stood then. Where the record's history does not reach that day, nothing is said.
      const day = dayOfNumber(dayNumber(today)! - since.days);
      const whole = project.historyFrom ? Date.parse(project.historyFrom) : Number.NaN;
      if (Number.isNaN(whole) || indiaDayEnd(day) <= whole) return null;
      const then = pastOn(day).resolution.read(address);
      return then?.asNow ? null : less(fieldNumber(then));
    },
    record: recordId,
    today: at,
  });

  // The project as it stood on a past day, read once for each day a field asks about.
  const pasts = new Map<string, { view: DdProject; resolution: FieldResolution; figures: Map<string, unknown> }>();
  const pastOn = (day: string) => {
    let held = pasts.get(day);
    if (!held) {
      const view = projectAsAt(project, day);
      // The figures of that day are told which project is today's: what a link names is asked of the project as it stands.
      pasts.set(day, (held = { view, resolution: resolveFields(view, asAtMoment(day), catalog, rules), figures: new Map<string, unknown>([[LIVE, project]]) }));
    }
    return held;
  };
  /** What a figure read in the last period issued before this one: frozen on the sheet's last issue, or held by the record of the period before. */
  const lastPeriodFigure = (set: FieldSet, recordId: string | undefined, key: string): number | null => {
    if (!set.periodic || catalog.checks.has(set.id)) return null;
    const kept = periodsStanding(periodsOf(project, set.id, at, catalog)).filter((instance) => instance.status === 'issued');
    if (!recordId) {
      const last = kept[0];
      const issue = last ? sheetOf(project, set.id)?.periods?.find((period) => period.key === last.period.key && period.issuedAt === last.issued?.at) : undefined;
      const frozen = issue?.frozen?.[key]?.value;
      return typeof frozen === 'number' ? frozen : null;
    }
    const all = periodsStanding(periodsOf(project, set.id, at, catalog));
    const here = all.find((instance) => instance.record === recordId);
    if (!here) return null;
    const per = here.id.slice(here.period.key.length);
    const before = all.find((instance) => instance.period.from < here.period.from && instance.id.slice(instance.period.key.length) === per);
    return before?.record ? fieldNumber(read({ fn: set.fn, set: set.id, field: key, record: before.record })) : null;
  };

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
    const frozen = fieldIsDerived(def) ? frozenOf(set.id, recordId)?.[def.key] : undefined;
    if (frozen) {
      // An issued period is never worked out again: what it read at issue is what it reads.
      value = frozen.value === null || frozen.value === '' ? undefined : { value: frozen.value, at: '', by: 'computed', ...(def.sameAs ? { origin: { kind: 'field' as const, address: def.sameAs } } : {}) };
    } else if (def.sameAs) {
      const owner = read(def.sameAs);
      value = owner && !isBlank(owner) ? { ...owner, origin: { kind: 'field', address: def.sameAs } } : undefined;
    } else if (def.kind === 'computed') {
      const cites: RuleCitation[] = [];
      const assumes: string[] = [];
      const values = new Proxy({} as Record<string, CheckFieldValue>, {
        get: (_, name) => {
          const read = typeof name === 'string' ? own(name) : undefined;
          cites.push(...(read?.cites ?? []));
          if (typeof name === 'string') rests(assumes, read, () => set.fields.find((f) => f.key === name)?.label ?? name);
          return read;
        },
      });
      const around = outside(set, recordId, cites, assumes);
      value = computedValue(def, def.formula ? evaluateFormula(def.formula, values, around) : null);
      if (cites.length) value.cites = uniqueCites(cites);
      if (assumes.length && !isBlank(value)) value.assumes = [...new Set(assumes)];
      // A zero that is a sum over nothing entered is said to be one, so no rule fires on it.
      if (def.formula && !isBlank(value) && formulaOverNothing(def.formula, values, around)) value.overNothing = true;
      if (nowOf.has(assumes) && !isBlank(value)) value.asNow = nowOf.get(assumes)!;
    } else if (def.kind === 'status') {
      // The rule engine reads plain values: what the holder stores that stands, and the fields the cases name, resolved.
      const values: Record<string, CheckFieldValue> = {};
      const cites: RuleCitation[] = [];
      const assumes: string[] = [];
      for (const [name, held] of Object.entries(storedOf(set.id, recordId))) if (fieldStands(held) && !isBlank(held)) values[name] = held;
      for (const name of (def.cases ?? []).flatMap((option) => option.when.fields)) {
        const resolved = own(name);
        cites.push(...(resolved?.cites ?? []));
        rests(assumes, resolved, () => set.fields.find((f) => f.key === name)?.label ?? name);
        if (resolved && !isBlank(resolved)) values[name] = resolved;
        else delete values[name];
      }
      const standing = evaluateStatus(def, set.fields, values, at)?.label ?? null;
      value = { value: standing, at: '', by: 'computed', ...(cites.length ? { cites: uniqueCites(cites) } : {}), ...(assumes.length && standing !== null ? { assumes: [...new Set(assumes)] } : {}), ...(nowOf.has(assumes) && standing !== null ? { asNow: nowOf.get(assumes)! } : {}) };
    } else {
      const held = storedOf(set.id, recordId)[def.key];
      value = standingField(held);
      // Nothing stands: a usual value stands in, said to be assumed, until a real one is typed or accepted. A value somebody
      // offered changes nothing while it waits, so it does not switch the usual value off. A field marked not applicable has
      // none, and neither has one in dispute: its two values are a question nobody has settled.
      const state = fieldState(held);
      if (isBlank(value) && state !== 'not_applicable' && state !== 'disputed' && def.defaults?.length) {
        const usual = def.defaults.find((rule) => showing(rule.when, { fn: set.fn, set: set.id, record: recordId }));
        if (usual) value = { value: usual.value, at: '', by: 'default', state: 'assumed', origin: { kind: 'default', from: usual.from, ...(usual.cite ? { cite: usual.cite } : {}) } };
      }
    }
    open.delete(key);
    memo.set(key, value);
    // A field a person fills that is not in play feeds nothing: no formula, no standing, no situation and no count reads it, as
    // no rule does. What it holds is kept, and reads again the moment it is back in play. What is worked out is another matter:
    // a count kept out of sight until its set holds a record is still the working behind a standing, and it reads only what is
    // in play itself. Asked after the value is kept above, so a condition that reads the field itself sees what it holds.
    if (value !== undefined && !fieldIsDerived(def) && !inPlay(set, recordId, def)) {
      value = undefined;
      memo.set(key, value);
    }
    return value;
  };

  /** Whether a field is asked now: its own condition and its section's hold, and its section is not marked not applicable. */
  const inPlay = (set: FieldSet, recordId: string | undefined, def: CheckFieldDef): boolean => {
    const section = def.sheet ? undefined : (set.sections ?? []).find((held) => held.key === def.section);
    if (!def.showWhen && !section?.showWhen && !section) return true;
    const from = { fn: set.fn, set: set.id, record: recordId };
    if (!showing(def.showWhen, from) || !showing(section?.showWhen, from)) return false;
    return !(section && !catalog.checks.has(set.id) && sheetOf(project, set.id)?.na?.[section.key]);
  };

  const read = (address: FieldAddress): CheckFieldValue | undefined => {
    const set = catalog.sets.get(address.set);
    const def = set?.fields.find((f) => f.key === address.field);
    if (!set || !def) return undefined;
    // A set that repeats has no one value for a field: name the record. And one that is not on its list holds nothing to read.
    if (set.records && (!address.record || !listed(set.id, address.record))) return undefined;
    return field(set, address.record, def);
  };

  // The records on each set's list, found once: a record taken off it is read by nothing, not even for a usual value.
  const lists = new Map<string, Set<string>>();
  const listed = (setId: string, recordId: string): boolean => {
    let ids = lists.get(setId);
    if (!ids) lists.set(setId, (ids = new Set(fieldRecords(project, setId).map((record) => record.id))));
    return ids.has(recordId);
  };

  const holder = (setId: string, recordId?: string): Record<string, CheckFieldValue> => {
    const set = catalog.sets.get(setId);
    const out: Record<string, CheckFieldValue> = {};
    if (!set || (set.records && recordId && !catalog.checks.has(setId) && !listed(setId, recordId))) return out;
    for (const def of set.fields) {
      const value = field(set, recordId, def);
      if (value) out[def.key] = value;
    }
    return out;
  };

  const records = (setId: string) => {
    if (!catalog.sets.get(setId)?.records) return undefined;
    // A revision still open beside the period it corrects counts for nothing yet: the issued one is read until it is issued too.
    return fieldRecords(project, setId)
      .filter((record) => recordStands(record) && !openRevision(record))
      .map((record) => holder(setId, record.id));
  };

  // The values of the holder asked from, each read only when a join names it.
  const ownValues = (from: { fn: string; set: string; record?: string }): Record<string, CheckFieldValue> =>
    new Proxy({} as Record<string, CheckFieldValue>, { get: (_, name) => (typeof name === 'string' ? read({ fn: from.fn, set: from.set, field: name, ...(from.record ? { record: from.record } : {}) }) : undefined) });

  const showing = (when: ShowWhen | undefined, from: { fn: string; set: string; record?: string }): boolean => {
    if (!when) return true;
    if ('situation' in when) {
      const at = situationAt(catalog, from.fn, when.situation);
      const declared = catalog.situations.get(at);
      // A situation that follows from what is recorded is never asked: it is in play exactly when its condition holds.
      if (declared?.derive) return showing(declared.derive, { fn: from.fn, set: from.set });
      // One a person sets is also in play, unasked, while what implies it holds.
      return situationOn(project, at) || Boolean(declared?.impliedBy && showing(declared.impliedBy, { fn: from.fn, set: from.set }));
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

export interface MatchSideReading {
  column: string;
  label: string;
  items: MatchItem[];
  leftover: MatchItem[];
}

export interface MatchReading {
  left: MatchSideReading;
  right: MatchSideReading;
  pairs: Array<{ left: string; right: string; leftLabel: string; rightLabel: string }>;
  /** Every list paired, the left first: two, or more where the table pairs further lists to the left one. */
  sides: MatchSideReading[];
  /** Each row as it pairs the lists: one cell a side, empty where the row names nothing for it. `differs` where the columns that should agree do not. */
  rows: Array<{ cells: Array<{ id: string; label: string }>; differs: boolean; gone?: boolean }>;
}

function matchList(project: DdProject, catalog: FieldCatalog, resolution: FieldResolution, list: MatchList): MatchItem[] {
  if ('target' in list) return refChoices(project, list.target, catalog);
  if ('records' in list && 'table' in list) {
    // A column of a table kept inside each record: every name once, as it is written.
    const seen = new Set<string>();
    // Where the column is a link, each is called by the name of what it links to.
    const column = catalog.sets.get(list.records)?.fields.find((field) => field.key === list.table)?.columns?.find((held) => held.key === list.column);
    const named = column?.kind === 'ref' ? refChoices(project, column.target, catalog) : [];
    return fieldRecords(project, list.records)
      .filter(recordStands)
      .flatMap((record) => tableRows(resolution.holder(list.records, record.id)[list.table]) ?? [])
      .flatMap((row) => {
        const cell = row[list.column];
        const id = cell === null || cell === undefined ? '' : String(cell).trim();
        if (!id || seen.has(id)) return [];
        seen.add(id);
        return [{ id, label: named.find((choice) => choice.id === id)?.label ?? id }];
      });
  }
  if ('records' in list) {
    const def = catalog.sets.get(list.records)?.fields.find((field) => field.key === list.field);
    return fieldRecords(project, list.records).filter(recordStands).flatMap((record) => {
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
export function readMatch(project: DdProject, def: CheckFieldDef, value: CheckFieldValue | undefined, resolution: FieldResolution, catalog: FieldCatalog = fieldCatalogFor(project)): MatchReading | undefined {
  if (def.display !== 'match' || !def.match) return undefined;
  const lists = matchSides(def).map((side) => ({ side, items: matchList(project, catalog, resolution, side.of) }));
  const held = (Array.isArray(value?.value) ? value!.value : []).filter((row): row is Record<string, string | number | boolean | null> => typeof row === 'object' && row !== null);
  const cell = (index: number, row: Record<string, string | number | boolean | null>): { id: string; label: string; gone?: boolean } => {
    const raw = row[lists[index]!.side.column];
    const id = raw === null || raw === undefined ? '' : String(raw);
    const named = id ? lists[index]!.items.find((item) => item.id === id)?.label : '';
    const of = lists[index]!.side.of;
    const gone = id && named === undefined ? removedLabel(project, catalog, 'target' in of ? refSet(of.target) : 'records' in of ? of.records : undefined, id) : undefined;
    return { id, label: named ?? gone ?? id, ...(gone ? { gone: true } : {}) };
  };
  const agree = (def.match.agree ?? []).map((column) => lists.findIndex((list) => list.side.column === column)).filter((index) => index >= 0);
  const rows = held
    .map((row) => lists.map((_, index) => cell(index, row)))
    // A row pairs something only where it names the left item and at least one other.
    .filter((cells) => cells[0]!.id && cells.slice(1).some((other) => other.id))
    .map((cells) => {
      const said = agree.map((index) => cells[index]!.label.trim().toLowerCase()).filter(Boolean);
      return { cells: cells.map(({ id, label }) => ({ id, label })), differs: new Set(said).size > 1, ...(cells.some((one) => one.gone) ? { gone: true } : {}) };
    });
  const sides: MatchSideReading[] = lists.map(({ side, items }, index) => ({
    column: side.column,
    label: side.label,
    items,
    // Nothing of an optional side is left over: a parcel in no suit is in order.
    leftover: side.optional ? [] : items.filter((item) => !rows.some((row) => row.cells[index]!.id === item.id)),
  }));
  return {
    left: sides[0]!,
    right: sides[1]!,
    pairs: rows.flatMap((row) => (row.cells[1]!.id ? [{ left: row.cells[0]!.id, right: row.cells[1]!.id, leftLabel: row.cells[0]!.label, rightLabel: row.cells[1]!.label }] : [])),
    sides,
    rows,
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
  /** Whether a model's words were found on the page it named: `unverified` where they were not. */
  proof?: FactProof;
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
  /** A must-field in play, due, and the function's own to fill: what "recorded" is counted over. Never an expert field, an optional one, one that is worked out, one not yet due or one another party owes. */
  expected: boolean;
  /** Whether it is expected yet: its `dueFrom` step or day has come, or it names none. */
  due: boolean;
  /** Who owes its value, where that is not the function's own people. */
  owed?: FieldOwed;
  /** Empty, due, and owed by another party: waited on from them, and never listed as the reader's to fill. */
  awaited: boolean;
  /** A match table's two lists, its pairs and what is left over. */
  match?: MatchReading;
  /** The rule rows a worked-out value was read from, each with whether a person has verified it. */
  cites?: RuleCitation[];
  /** A worked-out value or a standing that rests on a rule row nobody has verified: drawn as "rule not checked". */
  ruleUnchecked?: boolean;
  /** The usual values a worked-out value or a standing rests on, by label: nobody entered them. */
  assumes?: string[];
  /** A mirror's own field: where its value is held, and where a decision on what waits beside it is sent. */
  heldAt?: FieldAddress;
  /** A link that names a record since taken off its list. */
  removedLink?: boolean;
  /** What it held before, as its popover says it: one templated line, and the figures for a sparkline where there are three. */
  past?: FieldHistorySaid;
  /** Filled from the last period when this one was opened, and not written since: the period it came from, in short ("September"). */
  carried?: string;
  /** On an issued period: the field as it was frozen at issue, with how it printed and its footnote. */
  frozen?: FrozenField;
  /** On a reading as at a past day: the record does not reach the day for this value. The day its history begins, or `AS_NOW_NO_HISTORY`. */
  asNow?: string;
  /**
   * On the open period of a set kept by period, for a field that is read afresh each period: what it read in the period
   * before, as that period printed it, and which period ("September"). Drawn beside the field as "last: …", so a person
   * sees what to compare. Never on a field the set carries, nor on one that is worked out.
   */
  last?: { said: string; from: string };
  /** A worked-out field with no answer because a field it reads holds nothing: those fields, by label. Drawn as "waiting for …", never as a blank. */
  waitingFor?: string[];
}

/** The party a field's value is waited on from. */
export interface FieldOwed {
  /** One key for each party, so everything one party owes is listed together. */
  key: string;
  /** As a person reads it: the party's name, the role, or what the link is called where nobody is named yet. */
  label: string;
  role?: OwedRole;
  /** The party's id, where the field names one through a link. */
  partyId?: string;
}

/** A depth sheet as its holder reads it: whether the holder needs it, how full it is, and what is wrong on it. */
export interface DepthReading {
  sheet: DepthSheet;
  /** Whether the holder needs it now: its condition holds. */
  shown: boolean;
  sections: SectionView[];
  fields: FieldView[];
  insights: CheckInsight[];
  filled: number;
  total: number;
  /** Rules firing on it at high or critical. */
  failing: number;
  /** Values waiting on it for a person. */
  waiting: number;
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
  /** The holder's own sections. A depth sheet's fields are in `depth`, not here. */
  sections: SectionView[];
  /** Every field of the holder, its depth sheets' among them. */
  fields: FieldView[];
  /** What the holder's own rules say. A depth sheet's are on it. */
  insights: CheckInsight[];
  /** Every rule that fired, with which rule of the set it was and the depth sheet it belongs to. */
  findings: Array<{ insight: CheckInsight; rule: number; sheet?: string; ruleUnchecked?: boolean; assumes?: string[]; cites?: RuleCitation[] }>;
  /** The hard cases this holder can open, each a small sheet of its own. */
  depth: DepthReading[];
  /** Values kept under a key nothing declares any more: shown as no longer asked, and never lost. */
  unasked: Array<{ key: string; text: string }>;
  filled: number;
  total: number;
  /** On a shared record read for one function (`sheetSeenFrom`): the other functions that keep facts of their own on it, with how many each holds. */
  elsewhere?: Array<{ fn: string; held: number }>;
  /** A record nobody has accepted or typed anything on: it holds only what was offered, asks nothing and counts for nothing until one value is accepted. */
  pending?: boolean;
}

/**
 * A shared record as one function sees it.
 *
 * A unit is one record, and Sales, Tax, the Architect and the site each add
 * their own facts to it. Read whole it is every department's fields at once.
 * A function's page shows the record's own fields and the ones that function
 * added; what the others keep on it is counted and named, and opened on
 * their pages. Nothing is hidden from a formula or a rule: this narrows what
 * is drawn, and `readSheet` still reads the whole record.
 */
export function sheetSeenFrom(reading: SheetReading, fn: string): SheetReading {
  const own = (view: FieldView) => !view.def.addedBy || view.def.addedBy === fn;
  if (reading.fields.every(own)) return reading;
  const kept = new Set(reading.fields.filter(own).map((view) => view.def.key));
  const findings = reading.findings.filter((found) => (reading.set.rules[found.rule]?.fields ?? []).some((key) => kept.has(key)));
  const answerable = reading.fields.filter((view) => own(view) && view.expected);
  const recorded = (view: FieldView) => (fieldStands(view.held) && !isBlank(view.held)) || view.state === 'not_applicable';
  const others = new Map<string, number>();
  for (const view of reading.fields) if (!own(view) && !fieldIsDerived(view.def) && !isBlank(view.held)) others.set(view.def.addedBy!, (others.get(view.def.addedBy!) ?? 0) + 1);
  return {
    ...reading,
    sections: reading.sections.map((section) => ({ ...section, fields: section.fields.filter(own) })).filter((section) => section.fields.length > 0),
    fields: reading.fields.filter(own),
    findings,
    insights: findings.filter((found) => !found.sheet).map((found) => found.insight),
    filled: answerable.filter(recorded).length,
    total: answerable.length,
    elsewhere: [...others].map(([other, held]) => ({ fn: other, held })),
  };
}

/** A value under a key nothing declares, as plainly as it can be said. */
function plainly(value: CheckFieldValue): string {
  const raw = value.entered?.text ?? value.value;
  if (Array.isArray(raw)) return `${raw.length} ${raw.length === 1 ? 'row' : 'rows'}`;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  return String(raw);
}

function sourceOf(project: DdProject, catalog: FieldCatalog, value: CheckFieldValue | undefined, origin: FieldOrigin | undefined): FieldSource | undefined {
  if (origin?.kind === 'paper') {
    const row = project.evidence.find((e) => e.id === origin.evidenceId);
    return { kind: 'paper', label: row?.title ?? 'A paper not on this copy', evidenceId: origin.evidenceId, page: origin.page, quote: origin.quote, reader: origin.reader, ...(origin.proof ? { proof: origin.proof } : {}) };
  }
  // A link is followed only where it is a plain https address: anything else a value was saved with is not handed to a screen.
  if (origin?.kind === 'external') return { kind: 'external', label: origin.source, ...(safeLink(origin.url) ? { url: origin.url } : {}), asOf: origin.asOf, quote: origin.quote };
  if (origin?.kind === 'field') {
    const set = catalog.sets.get(origin.address.set);
    return { kind: 'field', label: set?.title ?? origin.address.set, address: origin.address };
  }
  // Who typed it, as the project's team names them: a line never prints an address.
  if (origin?.kind === 'person') return { kind: 'person', label: personSaid(project, value?.acceptedBy ?? value?.by) };
  if (origin?.kind === 'default') return { kind: 'default', label: origin.cite ?? '' };
  // A value saved before origins were kept: its paper, where it cites one.
  if (value?.sourceEvidenceId) {
    const row = project.evidence.find((e) => e.id === value.sourceEvidenceId);
    return { kind: 'paper', label: row?.title ?? 'Cited document', evidenceId: value.sourceEvidenceId, page: value.page, quote: value.quote };
  }
  return undefined;
}

/** A public source's link as it may be kept and shown: https, no spaces, bounded. */
function safeLink(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(url);
}

/**
 * What a `ref` reads as where the record it names has been taken off its
 * list: the record's own title as it stood, said to be off the list. Undefined
 * where the id names no record of the set at all.
 */
function removedLabel(project: DdProject, catalog: FieldCatalog, setId: string | undefined, id: string): string | undefined {
  const set = setId ? catalog.sets.get(setId) : undefined;
  const record = set?.records ? sheetOf(project, set.id)?.records?.find((held) => held.id === id && held.removed) : undefined;
  if (!set?.records || !record) return undefined;
  const titleDef = set.fields.find((def) => def.key === set.records!.titleField);
  const title = titleDef ? standingField(record.values[titleDef.key]) : undefined;
  const named = titleDef && !isBlank(title) ? formatFieldValue(titleDef, title, (list) => optionSetById(list, catalog)) : `A ${set.records.of}`;
  return `${named} (taken off ${set.title})`;
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
    // A paper's value saved with no reader named is its proposer's: a model's, where a model offered it.
    source: origin?.kind === 'paper' && origin.reader ? origin.reader : value.proposedBy === 'model' ? 'model' : 'parser',
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
export function readSheet(project: DdProject, setId: string, recordId?: string, resolution?: FieldResolution, catalog: FieldCatalog = fieldCatalogFor(project), at: Date = new Date()): SheetReading | undefined {
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
    return linked.get(key)!.find((choice) => choice.id === value!.value)?.label ?? removedLabel(project, catalog, refSet(def.target), String(value!.value)) ?? String(value!.value);
  };
  // A person as the project's team names them, else as the record keeps them.
  const personNamed = (by: string): string => personSaid(project, by);
  const linkGone = (def: CheckFieldDef, value: CheckFieldValue | undefined): boolean => def.kind === 'ref' && !isBlank(value) && removedLabel(project, catalog, refSet(def.target), String(value!.value)) !== undefined;
  // A record nobody has accepted or typed anything on holds only what was offered: it asks nothing and counts for nothing.
  const pending = Boolean(recordId) && !catalog.checks.has(setId) && !Object.values(held).some((value) => fieldStands(value) && !isBlank(value));
  const na = sheetOf(project, setId)?.na ?? {};
  // What this record was opened with from the last period, said by the period it came from.
  // Said only of the project as it stands: a reading as at a past day, or of a period as it was issued, is not the open period.
  const carriedOn = !set.periodic || catalog.checks.has(setId) || project.asAt ? undefined : recordId ? sheetOf(project, setId)?.records?.find((record) => record.id === recordId)?.carried : sheetOf(project, setId)?.open?.carried;
  const carriedKeys = new Set(carriedOn?.keys ?? []);
  const carriedFrom = carriedOn ? (periodOfKey(carriedOn.from)?.short ?? 'the last one') : undefined;
  // An issued period: the record once issued, or the sheet read as at a day an issue covers.
  const heldRecord = recordId && !catalog.checks.has(setId) ? sheetOf(project, setId)?.records?.find((record) => record.id === recordId) : undefined;
  const frozenHere = recordId ? (heldRecord?.issued ? heldRecord.frozen : undefined) : catalog.checks.has(setId) ? undefined : sheetOf(project, setId)?.asIssued?.frozen;
  // The period before the open one, on a set kept by period: what each field read then, as that period printed it.
  const lastHeld = !set.periodic || catalog.checks.has(setId) || project.asAt || (recordId ? heldRecord?.issued : false) ? undefined : lastPeriodHeld(project, set, recordId, at, catalog, resolved, said);
  const freshKeys = new Set(set.periodic ? [...(set.periodic.carry ?? []), ...(set.periodic.per ?? []), ...(set.periodic.by ? [set.periodic.by] : [])] : []);
  /** The fields a worked-out field waits for: its own holder's fields that it reads and that hold nothing, followed down through other worked-out fields. */
  const waitsOn = (def: CheckFieldDef, seen: Set<string> = new Set()): string[] => {
    const out: string[] = [];
    for (const read of fieldReads(def, set)) {
      if (read.set !== set.id || read.record || read.column || seen.has(read.field)) continue;
      seen.add(read.field);
      const other = set.fields.find((field) => field.key === read.field);
      if (!other || other.retired || !isBlank(acting[other.key])) continue;
      if (!resolved.showing(other.showWhen, from)) continue;
      if (fieldIsDerived(other)) out.push(...waitsOn(other, seen));
      else if (fieldState(held[other.key]) !== 'not_applicable') out.push(other.label);
    }
    return out;
  };
  const sectionDefs = [...(set.sections ?? [])];
  if (set.fields.some((def) => !def.section && !def.sheet)) sectionDefs.unshift({ key: '', label: '' });
  // Whether a field is expected yet: its step of the project has come, or its day has.
  const step = SUB_STAGES.indexOf(project.currentStage);
  const today = indiaToday(at);
  const dueNow = (def: CheckFieldDef): boolean => {
    if (!def.dueFrom) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(def.dueFrom) ? def.dueFrom <= today : SUB_STAGES.indexOf(def.dueFrom as LifecycleStage) <= step;
  };
  // Who owes a field: a role, or the party the holder's own link names. With nobody named yet, it is said by what the link is called.
  const owedOf = (def: CheckFieldDef): FieldOwed | undefined => {
    if (!def.owedBy) return undefined;
    if (typeof def.owedBy === 'string') return { key: `role:${def.owedBy}`, label: OWED_ROLE_LABEL[def.owedBy], role: def.owedBy };
    const ref = def.owedBy.ref;
    const link = set.fields.find((field) => field.key === ref);
    const linked = link ? acting[link.key] : undefined;
    if (!link || isBlank(linked)) return { key: `ref:${set.id}:${ref}`, label: link?.label ?? ref };
    return { key: `party:${String(linked!.value)}`, label: said(link, linked), partyId: String(linked!.value) };
  };

  const fields: FieldView[] = set.fields.map((def) => {
    const depth = depthSheet(set, def.sheet);
    const section = def.sheet ? (depth?.sections ?? []).find((s) => s.key === def.section) : sectionDefs.find((s) => s.key === (def.section ?? ''));
    const derived = fieldIsDerived(def);
    // A usual value standing in is what the field shows while it stores nothing.
    const assumed = !derived && acting[def.key]?.state === 'assumed' ? acting[def.key] : undefined;
    const kept = held[def.key];
    // A value that waits is what the field shows, so a person can accept it; the usual value goes on standing in behind it.
    const own = derived ? acting[def.key] : fieldState(kept) === 'proposed' ? kept : assumed ? (kept?.other?.length ? { ...assumed, other: kept.other } : assumed) : kept;
    const state: FieldState = derived ? (isBlank(own) ? 'empty' : 'accepted') : fieldState(own);
    const holds = !isBlank(own) || state === 'not_applicable' || Boolean(own?.other?.length);
    const inPlay = resolved.showing(def.showWhen, from) && resolved.showing(section?.showWhen, from) && !def.retired;
    const expert = (def.tier ?? section?.tier) === 'expert';
    // An expert field shows once it holds a value a person or a paper gave it. One that is worked out always holds one, and stays folded: it is the working behind a standing.
    const shown: FieldShown = !inPlay ? 'hidden' : expert && (!holds || derived) ? 'folded' : 'shown';
    const sectionNa = !def.sheet && Boolean(na[def.section ?? '']);
    const address: FieldAddress = { fn: set.fn, set: set.id, field: def.key, ...(recordId ? { record: recordId } : {}) };
    const must = def.requiredWhen ? resolved.showing(def.requiredWhen, from) : def.required !== false;
    const due = dueNow(def);
    // Asked for only where it is in play, not folded away as expert, and holds nothing: not even a usual value.
    const asked = shown === 'shown' && !derived && !sectionNa && must && !expert && due && !pending;
    const owed = asked ? owedOf(def) : undefined;
    // What another party owes is theirs to give: it is waited on, and never counted against the reader.
    const expected = asked && !owed;
    const empty = state === 'empty' && !own?.other?.length;
    const missing = expected && empty;
    // What it held before, where it has held anything: a mirror says its owner's, and what is worked out has no past of its own.
    const past = (kept ?? own)?.history?.length ? fieldHistorySaid(def, def.sameAs ? own : (kept ?? own), lists, personNamed) : undefined;
    const lastSaid = lastHeld && !derived && !freshKeys.has(def.key) && def.kind !== 'table' && def.kind !== 'evidence' && def.kind !== 'longtext' ? lastHeld.said(def) : undefined;
    const waitingFor = shown !== 'hidden' && def.kind === 'computed' && isBlank(own) ? [...new Set(waitsOn(def))].slice(0, 3) : [];
    return {
      def,
      address,
      shown,
      // What is worked out is nobody's entry: out of play, it is not something recorded and set aside.
      notInPlay: !inPlay && holds && !derived,
      state,
      held: own,
      // An issued period prints as it printed at issue.
      text: frozenHere?.[def.key] && !isBlank(own) ? frozenHere[def.key]!.said : said(def, own),
      tone: fieldTone(def, own, lists),
      source: sourceOf(project, catalog, own, own?.origin),
      waiting: (own?.other ?? []).map((other, index) => ({
        index,
        text: formatFieldValue(def, { value: other.value, at: '', by: '', entered: other.entered }, lists),
        source: sourceOf(project, catalog, undefined, other.origin),
        proposedBy: other.proposedBy,
      })),
      // A model's words that were not found on the page it named are never swept up by "accept all".
      oneAtATime: state === 'proposed' && own ? acceptedOneAtATime(asFact(def, own)) || (own.origin?.kind === 'paper' && own.proposedBy === 'model' && own.origin.proof === 'unverified') : false,
      missing,
      expected,
      due,
      ...(owed ? { owed } : {}),
      awaited: Boolean(owed) && empty,
      ...(shown !== 'hidden' && def.display === 'match' ? { match: readMatch(project, def, acting[def.key], resolved, catalog) } : {}),
      ...(own?.cites?.length ? { cites: own.cites } : {}),
      ...(own?.cites?.some((cite) => !cite.verified) ? { ruleUnchecked: true } : {}),
      ...(derived && own?.assumes?.length ? { assumes: own.assumes } : {}),
      ...(def.sameAs ? { heldAt: { ...def.sameAs, fn: catalog.sets.get(def.sameAs.set)?.fn ?? def.sameAs.fn } } : {}),
      ...(shown !== 'hidden' && linkGone(def, own) ? { removedLink: true } : {}),
      ...(past ? { past } : {}),
      ...(carriedFrom && carriedKeys.has(def.key) && !isBlank(own) ? { carried: carriedFrom } : {}),
      ...(frozenHere?.[def.key] ? { frozen: frozenHere[def.key] } : {}),
      ...(own?.asNow && !isBlank(own) ? { asNow: own.asNow } : {}),
      ...(lastSaid ? { last: { said: lastSaid, from: lastHeld!.from } } : {}),
      ...(waitingFor.length ? { waitingFor } : {}),
    };
  });

  const sections: SectionView[] = sectionDefs.map((section) => {
    const inside = fields.filter((view) => !view.def.sheet && (view.def.section ?? '') === section.key);
    const shown: FieldShown = inside.some((view) => view.shown === 'shown') ? 'shown' : inside.some((view) => view.shown === 'folded') ? 'folded' : 'hidden';
    return { key: section.key, label: section.label, shown, ...(na[section.key] ? { na: na[section.key] } : {}), fields: inside };
  });

  // Rules read what stands, and only of fields that are in play: a rule about a field that is not showing has nothing to say.
  const playing = new Set(fields.filter((view) => view.shown !== 'hidden' && (view.def.sheet || !na[view.def.section ?? ''])).map((view) => view.def.key));
  const findings = set.rules.flatMap((rule, index) => {
    if (pending || !resolved.showing(rule.when, from) || !rule.fields.every((key) => playing.has(key) || rule.at?.[key])) return [];
    const abroad = ruleAbroad(rule, resolved, catalog);
    const read = { ...acting, ...abroad.values };
    // What the line rests on that nobody checked or entered: a rule row not verified, a usual value standing in.
    const cites = uniqueCites(rule.fields.flatMap((key) => read[key]?.cites ?? []));
    const unchecked = cites.some((cite) => !cite.verified);
    const assumes = [...new Set(rule.fields.flatMap((key) => [...(read[key]?.state === 'assumed' ? [(set.fields.find((f) => f.key === key) ?? abroad.defs.find((f) => f.key === key))?.label ?? key] : []), ...(read[key]?.assumes ?? [])]))];
    return checkInsights([...set.fields, ...abroad.defs], read, [rule], at).map((insight) => ({ insight, rule: index, ...(rule.sheet ? { sheet: rule.sheet } : {}), ...(unchecked ? { ruleUnchecked: true } : {}), ...(assumes.length ? { assumes } : {}), ...(cites.length ? { cites } : {}) }));
  });
  const insights = findings.filter((found) => !found.sheet).map((found) => found.insight);
  const recorded = (view: FieldView) => (fieldStands(view.held) && !isBlank(view.held)) || view.state === 'not_applicable';

  // Each hard case the holder can open: its fields are the holder's own, read above, gathered under the sheet they belong to.
  const depth: DepthReading[] = (set.sheets ?? []).map((sheet) => {
    const inside = fields.filter((view) => view.def.sheet === sheet.id);
    const parts = [...(sheet.sections ?? [])];
    if (inside.some((view) => !view.def.section)) parts.unshift({ key: '', label: '' });
    const told = findings.filter((found) => found.sheet === sheet.id).map((found) => found.insight);
    return {
      sheet,
      shown: resolved.showing(sheet.showWhen, from),
      sections: parts.map((part) => {
        const within = inside.filter((view) => (view.def.section ?? '') === part.key);
        const shown: FieldShown = within.some((view) => view.shown === 'shown') ? 'shown' : within.some((view) => view.shown === 'folded') ? 'folded' : 'hidden';
        return { key: part.key, label: part.label, shown, fields: within };
      }),
      fields: inside,
      insights: told,
      filled: inside.filter((view) => view.expected && recorded(view)).length,
      total: inside.filter((view) => view.expected).length,
      failing: told.filter((insight) => insight.severity === 'critical' || insight.severity === 'high').length,
      waiting: inside.filter((view) => view.shown !== 'hidden' && (view.state === 'proposed' || view.waiting.length > 0)).length,
    };
  });
  const declared = new Set(set.fields.map((def) => def.key));
  const unasked = Object.entries(held).flatMap(([key, value]) => (!declared.has(key) && !isBlank(value) ? [{ key, text: plainly(value) }] : []));

  const answerable = fields.filter((view) => view.expected);
  const titleDef = set.records ? set.fields.find((def) => def.key === set.records!.titleField) : undefined;
  // A record is called by what stands on it. A name somebody offered is not its name until a person accepts it.
  const titleHeld = titleDef ? acting[titleDef.key] : undefined;
  return {
    set,
    ...(recordId ? { recordId } : {}),
    ...(pending ? { pending } : {}),
    title: set.records ? (titleDef && !isBlank(titleHeld) ? said(titleDef, titleHeld) : `New ${set.records.of}`) : set.title,
    chips: (set.records?.summaryFields ?? []).flatMap((key) => {
      const def = set.fields.find((f) => f.key === key);
      return def && !isBlank(acting[key]) ? [`${def.label} ${said(def, acting[key])}`] : [];
    }),
    sections,
    fields,
    insights,
    findings,
    depth,
    unasked,
    // Recorded: a value that stands, a usual one among them, or the field marked not applicable.
    filled: answerable.filter(recorded).length,
    total: answerable.length,
  };
}

/**
 * The period before the open one of a set kept by period, as a field reads
 * it: for a sheet, the last period it issued, each field as frozen; for a
 * record, the instance that stands for the nearest earlier period, of the
 * same kind where the set keeps several a period. Undefined where there is
 * none.
 */
function lastPeriodHeld(
  project: DdProject,
  set: FieldSet,
  recordId: string | undefined,
  at: Date,
  catalog: FieldCatalog,
  resolved: FieldResolution,
  said: (def: CheckFieldDef, value: CheckFieldValue | undefined) => string,
): { from: string; said(def: CheckFieldDef): string | undefined } | undefined {
  const printed = (text: string | undefined): string | undefined => (text && text !== '—' && text !== 'waiting' ? text : undefined);
  if (!recordId) {
    const issued = [...(sheetOf(project, set.id)?.periods ?? [])].filter((period) => period.status === 'issued').sort((a, b) => a.from.localeCompare(b.from) || (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''));
    const last = issued.at(-1);
    if (!last) return undefined;
    return { from: periodOfKey(last.key)?.short ?? last.key, said: (def) => printed(last.frozen?.[def.key]?.said) };
  }
  // How full each is does not matter here, and reading it would read every record of the set once more.
  const all = periodsOf(project, set.id, at, catalog, () => ({ filled: 0, total: 0 }));
  const here = all.find((instance) => instance.record === recordId);
  if (!here) return undefined;
  const per = here.id.slice(here.period.key.length);
  const before = periodsStanding(all).find((instance) => instance.period.from < here.period.from && instance.id.slice(instance.period.key.length) === per && instance.record !== here.revises);
  if (!before?.record) return undefined;
  const record = sheetOf(project, set.id)?.records?.find((held) => held.id === before.record);
  const values = resolved.holder(set.id, before.record);
  return {
    from: before.period.short,
    said: (def) => printed(record?.issued && record.frozen?.[def.key] ? record.frozen[def.key]!.said : isBlank(values[def.key]) || !fieldStands(values[def.key]) ? undefined : said(def, values[def.key])),
  };
}

/* ==================================================================== */
/* A function's page: what needs a person first                          */
/* ==================================================================== */

export type FieldExceptionKind = 'proposed' | 'situation' | 'disputed' | 'missing' | 'unmatched' | 'rule' | 'due';

/**
 * The five lines a function opens on, in the order a person takes them.
 *
 * - `decide`: two sources disagree, or a paper suggests a situation. First,
 *   because a situation changes what every later line holds.
 * - `accept`: values offered and waiting, by the paper they came off.
 * - `failing`: a rule firing at high or critical, a day that has run out, a
 *   pairing whose names differ.
 * - `due_soon`: a day about to run out, a rule at medium. It can wait a day,
 *   and a person may put one off until a day they name.
 * - `missing`: a must-field the function's own people owe that holds
 *   nothing, and a thing with no counterpart.
 *
 * A set kept by period adds one line of its own, of kind `due`: the latest
 * period that has ended and is not issued. It is counted under Due soon until
 * the day it is due, and under Failing after it.
 */
export type NeedKind = 'decide' | 'accept' | 'failing' | 'due_soon' | 'missing';

export const NEED_KINDS: readonly NeedKind[] = ['decide', 'accept', 'failing', 'due_soon', 'missing'];

export const NEED_LABEL: Record<NeedKind, string> = {
  decide: 'Decide',
  accept: 'Accept',
  failing: 'Failing',
  due_soon: 'Due soon',
  missing: 'Missing',
};

/** The most a line under Needs you draws before "show all". */
export const NEED_LINES_SHOWN = 5;

/** One thing on a function's sheets that needs a person. */
export interface FieldException {
  kind: FieldExceptionKind;
  /** Which of the five lines it is counted under. */
  need: NeedKind;
  /** What it is, stably: the same line has the same key each time the page is read. What a snooze is kept under. */
  key: string;
  /** The depth sheet it is on, where it is on one. */
  depth?: string;
  /** Put off until this day by a person. Only on a line among `snoozed`. */
  snoozedUntil?: string;
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
  /** Rests on a rule row nobody has verified against the instrument: drawn as "rule not checked". */
  ruleUnchecked?: boolean;
  /** Rests on a usual value standing in, by the labels of the fields nobody entered. */
  assumes?: string[];
  /** For a value waiting beside a mirror: the mirror's own field, where the line is drawn. `address` is the field that holds the value, where it is accepted. */
  shownAt?: FieldAddress;
  /** The rule rows the line's figures were read from, each with whether a person has verified it. */
  cites?: RuleCitation[];
  /**
   * What the line is caused by, where that is on another function's sheets: a record that function keeps and this
   * one's rule reads (the bank guarantee waiting in Vendors behind a line on Orders). Open goes there.
   */
  target?: FieldAddress;
  /** For a record a paper offered and nobody has accepted a value of: where each of its values waits. The line is the record, and its address ends in `RECORD_AS_OFFERED`. */
  whole?: FieldAddress[];
}

export interface SituationView {
  at: string;
  situation: Situation;
  state: 'on' | 'off' | 'proposed';
  /** In play because of what is recorded, with nobody asked. Nobody takes it out while that holds. */
  implied?: boolean;
  suggestedBy?: FieldSource;
  /** Fields that hold a value and are not showing because this is off. */
  keptValues: number;
}

export interface FunctionFields {
  fn: string;
  sheets: Array<{ set: FieldSet; reading?: SheetReading; records?: SheetReading[]; /** On a set kept by period: what is open, the line that opens the past, and what is due. */ periods?: SetPeriods }>;
  /** The shared records its sheets link to, listed beside its own: parties, parcels, units. They are the project's, and ask nothing of this function. */
  shared: Array<{ set: FieldSet; records: SheetReading[] }>;
  situations: SituationView[];
  /** Everything that needs a person, in the order of the five lines. Nothing put off, nothing another party owes, no rule at low. */
  exceptions: FieldException[];
  counts: Record<FieldExceptionKind, number> & { total: number };
  /** The same, under the five lines the page opens on. */
  needs: Record<NeedKind, FieldException[]>;
  /** Lines under Due soon a person put off, each with the day it comes back. */
  snoozed: FieldException[];
  /** What other parties owe, by party: never the reader's to fill, and what the department's papers-owed list is fed. */
  waitingOn: OwedGroup[];
  /** Usual values standing in. Never among what needs a person: one quiet line. */
  assumed: number;
  /** Must-fields in play that hold a value, of all must-fields in play. */
  recorded: number;
  expected: number;
}

/** Everything one party owes a function's sheets. */
export interface OwedGroup {
  key: string;
  label: string;
  role?: OwedRole;
  partyId?: string;
  fields: Array<{ address: FieldAddress; label: string; sheet: string }>;
}

/** The sets of records a formula counts or sums over, each with the condition it puts on them, wherever in the formula they sit. */
function formulaRecordReads(node: unknown): Array<{ set: string; where?: RowWhere }> {
  if (!node || typeof node !== 'object') return [];
  const held = node as { op?: unknown; set?: unknown; over?: { records?: unknown }; where?: unknown };
  const here: Array<{ set: string; where?: RowWhere }> = [];
  if (held.op === 'records' && typeof held.set === 'string') here.push({ set: held.set, ...(held.where ? { where: held.where as RowWhere } : {}) });
  else if ((held.op === 'count_if' || held.op === 'sum_if' || held.op === 'span_days') && typeof held.over?.records === 'string') here.push({ set: held.over.records, ...(held.where ? { where: held.where as RowWhere } : {}) });
  return [...here, ...Object.values(node).flatMap((part) => (Array.isArray(part) ? part.flatMap(formulaRecordReads) : formulaRecordReads(part)))];
}

const SEVERITY_TONE: Record<string, Tone> = { critical: 'critical', high: 'critical', medium: 'warning', low: 'neutral' };
const ORDER: FieldExceptionKind[] = ['situation', 'disputed', 'proposed', 'rule', 'due', 'missing', 'unmatched'];

function namesSituation(when: ShowWhen | undefined, key: string): boolean {
  if (!when) return false;
  if ('situation' in when) return when.situation === key;
  if ('all' in when) return when.all.some((part) => namesSituation(part, key));
  if ('any' in when) return when.any.some((part) => namesSituation(part, key));
  return false;
}

/** Everything a function's sheets hold, with what needs a person in front. */
export function readFunctionFields(project: DdProject, fn: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): FunctionFields {
  const resolution = resolveFields(project, at, catalog);
  const sheets: FunctionFields['sheets'] = fieldSetsOf(fn, catalog).map((set) => {
    if (!set.records) {
      const reading = readSheet(project, set.id, undefined, resolution, catalog, at);
      // A sheet kept by period: the sheet is the open one, and what it has issued is one line beside it.
      const periods = set.periodic && !project.asAt ? setPeriods(project, set, at, catalog, undefined, reading) : undefined;
      return { set, reading, ...(periods ? { periods } : {}) };
    }
    const records = fieldRecords(project, set.id).flatMap((record) => readSheet(project, set.id, record.id, resolution, catalog, at) ?? []);
    const periods = set.periodic ? setPeriods(project, set, at, catalog, (id) => records.find((read) => read.recordId === id)) : undefined;
    return { set, records, ...(periods ? { periods } : {}) };
  });
  const readings = sheets.flatMap((sheet) => (sheet.reading ? [sheet.reading] : (sheet.records ?? [])));

  const situations: SituationView[] = situationsOf(fn, catalog).map(({ at: key, situation }) => {
    const stored = situationState(project, key);
    const implied = !situation.derive && Boolean(situation.impliedBy && resolution.showing(situation.impliedBy, { fn, set: '' }));
    const state = situation.derive ? ({ state: resolution.showing(situation.derive, { fn, set: '' }) ? 'on' : 'off', by: 'derived', at: '' } as SituationState) : stored;
    const kept = readings.flatMap((reading) => reading.fields).filter((view) => view.notInPlay && (namesSituation(view.def.showWhen, situation.key) || namesSituation(reading(view)?.showWhen, situation.key))).length;
    return {
      at: key,
      situation,
      state: implied ? 'on' : (state?.state ?? 'off'),
      ...(implied ? { implied } : {}),
      ...(state?.suggestedBy ? { suggestedBy: sourceOf(project, catalog, undefined, { kind: 'paper', evidenceId: state.suggestedBy.evidenceId, page: state.suggestedBy.page ?? 0, quote: state.suggestedBy.quote ?? '', reader: 'parser' }) } : {}),
      keptValues: kept,
    };
  });
  function reading(view: FieldView) {
    return catalog.sets.get(view.address.set)?.sections?.find((section) => section.key === view.def.section);
  }

  const all: FieldException[] = [];
  const owing = new Map<string, OwedGroup>();
  for (const situation of situations) {
    if (situation.state === 'proposed') all.push({ kind: 'situation', need: 'decide', key: `situation::${situation.at}`, sheet: '', label: situation.situation.label, text: situation.situation.hint ?? '', source: situation.suggestedBy, situation: situation.at });
  }
  const today = dayNumber(indiaToday(at))!;
  const lists = (id: string) => optionSetById(id, catalog);
  // Values offered where this function only reads them: listed once the function's own lines are, and only where no line of its own says the same.
  const beside: FieldException[] = [];
  /** What a line's rule reads on another function's sheets: the record there that is the cause, where one can be named. */
  const causeOf = (set: FieldSet, recordId: string | undefined, rule: Pick<CheckInsightRule, 'fields' | 'at'>): FieldAddress | undefined => {
    for (const name of rule.fields) {
      const abroad = rule.at?.[name];
      const def = abroad ? undefined : set.fields.find((field) => field.key === name);
      const far = abroad ?? def?.sameAs;
      if (far) {
        const farFn = catalog.sets.get(far.set)?.fn;
        if (farFn && farFn !== fn && farFn !== SHARED_FN) return { ...far, fn: farFn };
        continue;
      }
      for (const read of def?.formula ? formulaRecordReads(def.formula) : []) {
        const far = catalog.sets.get(read.set);
        if (!far?.records || far.fn === fn || far.fn === SHARED_FN) continue;
        const records = fieldRecords(project, far.id);
        // A record somebody offered there and nobody has accepted is the likeliest cause: it counts for nothing until it is.
        const waiting = records.filter((record) => !recordStands(record));
        const own = new Proxy({} as Record<string, CheckFieldValue>, { get: (_, key) => (typeof key === 'string' ? resolution.read({ fn: set.fn, set: set.id, field: key, ...(recordId ? { record: recordId } : {}) }) : undefined) });
        const asked = read.where ? ownRows(read.where, own, recordId) : undefined;
        const meeting = asked === null ? [] : records.filter(recordStands).filter((record) => !asked || rowMeets(resolution.holder(far.id, record.id), asked));
        const one = waiting.length === 1 ? waiting[0] : meeting.length === 1 ? meeting[0] : undefined;
        return { fn: far.fn, set: far.id, field: '', ...(one ? { record: one.id } : {}) };
      }
    }
    return undefined;
  };
  for (const read of readings) {
    const where = { sheet: read.set.records ? `${read.set.title} · ${read.title}` : read.set.title, ...(read.recordId ? { record: read.recordId } : {}) };
    for (const view of read.fields) {
      // What is not in play asks nothing of anybody, whatever it holds.
      if (view.shown === 'hidden') continue;
      const key = addressKey(view.address);
      const on = { ...where, address: view.address, label: view.def.label, ...(view.def.sheet ? { depth: view.def.sheet } : {}) };
      if (view.state === 'proposed') all.push({ kind: 'proposed', need: 'accept', key: `${key}::proposed`, ...on, text: view.text, source: view.source, oneAtATime: view.oneAtATime });
      else if (view.state === 'disputed') all.push({ kind: 'disputed', need: 'decide', key: `${key}::disputed`, ...on, text: [view.text, ...view.waiting.map((w) => w.text)].join(' / '), source: view.source, tone: 'critical' });
      // A value offered for a check's field this one only reads, with nothing held there yet: a check has no page of sheets of
      // its own, so the line is drawn here, where a person looks for it, and accepted on the check that holds it. A reading is
      // never offered as something to decide. A value offered to another function's sheet is listed on that function's page.
      if (view.heldAt && catalog.checks.has(view.heldAt.set)) {
        const holds = view.heldAt;
        const holderDef = catalog.sets.get(holds.set)?.fields.find((field) => field.key === holds.field);
        const offered = holderDef && !fieldIsDerived(holderDef) && (!catalog.sets.get(holds.set)?.records || holds.record) ? stored(project, catalog, holds.set, holds.record)[holds.field] : undefined;
        if (holderDef && offered && fieldState(offered) === 'proposed' && !isBlank(offered)) {
          const oneAtATime = acceptedOneAtATime(asFact(holderDef, offered)) || (offered.origin?.kind === 'paper' && offered.proposedBy === 'model' && offered.origin.proof === 'unverified');
          beside.push({ kind: 'proposed', need: 'accept', key: `${addressKey(holds)}::proposed`, ...on, address: holds, shownAt: view.address, text: formatFieldValue(holderDef, offered, lists), source: sourceOf(project, catalog, offered, offered.origin), oneAtATime });
        }
      }
      if (view.state !== 'disputed') {
        // A value waiting beside a mirror waits on the field the mirror reads: the line is drawn here and accepted there, in one tap.
        // One line for one value, however many mirrors of the field the page holds.
        const holds = view.heldAt ?? view.address;
        for (const waiting of view.waiting) {
          const line = `${addressKey(holds)}::proposed::${waiting.index}`;
          if (all.some((other) => other.key === line)) continue;
          all.push({ kind: 'proposed', need: 'accept', key: line, ...on, address: holds, ...(view.heldAt ? { shownAt: view.address } : {}), text: waiting.text, source: waiting.source, pick: waiting.index, oneAtATime: true });
        }
      }
      // A record that holds only what was offered asks for nothing more than a decision on what was offered.
      if (read.pending) continue;
      if (view.removedLink) all.push({ kind: 'rule', need: 'failing', key: `${key}::removed_link`, ...on, text: view.text, tone: 'critical' });
      if (view.missing) all.push({ kind: 'missing', need: 'missing', key: `${key}::missing`, ...on, text: view.def.from ?? '' });
      // What another party owes is listed under that party, and asks nothing of the reader.
      if (view.awaited && view.owed) {
        const group = owing.get(view.owed.key) ?? { key: view.owed.key, label: view.owed.label, ...(view.owed.role ? { role: view.owed.role } : {}), ...(view.owed.partyId ? { partyId: view.owed.partyId } : {}), fields: [] };
        group.fields.push({ address: view.address, label: view.def.label, sheet: where.sheet });
        owing.set(view.owed.key, group);
      }
      // What a match leaves over on any side: a thing with no counterpart. And a row whose names should agree and do not.
      for (const side of view.match?.sides ?? []) {
        for (const item of side.leftover) all.push({ kind: 'unmatched', need: 'missing', key: `${key}::unmatched::${side.column}::${item.id}`, ...on, text: `${side.label}: ${item.label}`, tone: 'warning' });
      }
      for (const row of view.match?.rows ?? []) {
        if (row.differs) all.push({ kind: 'rule', need: 'failing', key: `${key}::differs::${row.cells[0]!.id}`, ...on, text: row.cells.filter((cell) => cell.label).map((cell) => cell.label).join(' / '), tone: 'critical' });
        else if (row.gone) all.push({ kind: 'rule', need: 'failing', key: `${key}::removed_link::${row.cells[0]!.id}`, ...on, text: row.cells.filter((cell) => cell.label).map((cell) => cell.label).join(' / '), tone: 'critical' });
      }
      // A day that has run out, or is about to.
      const runsOut = view.def.expires && fieldStands(view.held) ? dayNumber(view.held?.value) : null;
      if (runsOut !== null && runsOut !== undefined) {
        const left = runsOut - today;
        if (left < 0) all.push({ kind: 'rule', need: 'failing', key: `${key}::runs_out`, ...on, text: `Ran out on ${view.text}`, tone: 'critical' });
        else if (left <= view.def.expires!.leadDays) all.push({ kind: 'rule', need: 'due_soon', key: `${key}::runs_out`, ...on, text: `Runs out on ${view.text}`, tone: 'warning' });
      }
      // A standing that is not good is a rule failing, said in the label its case declares.
      // Where one of the sheet's own rules says the same thing in a sentence, with the figures, that sentence is the line.
      const firing = view.def.kind === 'status' ? view.def.cases?.find((option) => option.label === view.held?.value)?.when : undefined;
      const saidByRule = firing && read.set.rules.some((rule) => rule.kind === firing.kind && rule.fields.join() === firing.fields.join());
      if (view.def.kind === 'status' && !saidByRule && (view.tone === 'critical' || view.tone === 'warning')) {
        const cause = firing ? causeOf(read.set, read.recordId, firing) : undefined;
        all.push({ kind: 'rule', need: view.tone === 'critical' ? 'failing' : 'due_soon', key: `${key}::status`, ...on, text: view.text, tone: view.tone, ...(view.ruleUnchecked ? { ruleUnchecked: true } : {}), ...(view.assumes?.length ? { assumes: view.assumes } : {}), ...(view.cites?.length ? { cites: view.cites } : {}), ...(cause ? { target: cause } : {}) });
      }
    }
    for (const found of read.findings) {
      // A rule at low is said on the sheet it is about, and is nobody's to act on.
      if (found.insight.severity === 'low') continue;
      const failing = found.insight.severity === 'critical' || found.insight.severity === 'high';
      const depth = depthSheet(read.set, found.sheet);
      const cause = causeOf(read.set, read.recordId, read.set.rules[found.rule]!);
      all.push({ kind: 'rule', need: failing ? 'failing' : 'due_soon', key: `${read.set.id}::${read.recordId ?? ''}::rule::${found.rule}`, ...where, label: depth?.title ?? read.set.title, ...(depth ? { depth: depth.id } : {}), text: found.insight.text, tone: SEVERITY_TONE[found.insight.severity] ?? 'neutral', ...(found.ruleUnchecked ? { ruleUnchecked: true } : {}), ...(found.assumes?.length ? { assumes: found.assumes } : {}), ...(found.cites?.length ? { cites: found.cites } : {}), ...(cause ? { target: cause } : {}) });
    }
  }
  // A shared record (a unit, a contract, a parcel, an account, a party) is the project's, and asks nothing of a function. A value
  // offered to one is still somebody's to accept: the function that adds that fact to the record, or, for a fact of the record
  // itself, the function the paper it came off is filed under. It is listed there, and accepted on the record.
  const sharedRead = fn === SHARED_FN ? [] : sharedSetsOf(fn, catalog).map((set) => ({ set, records: fieldRecords(project, set.id).flatMap((record) => readSheet(project, set.id, record.id, resolution, catalog, at) ?? []) }));
  const filedUnder = new Map<string, string | undefined>();
  const paperFn = (evidenceId: string | undefined): string | undefined => {
    if (!evidenceId) return undefined;
    if (!filedUnder.has(evidenceId)) {
      const row = project.evidence.find((held) => held.id === evidenceId);
      filedUnder.set(evidenceId, row ? documentWorkstream(project, row) : undefined);
    }
    return filedUnder.get(evidenceId);
  };
  for (const read of sharedRead.flatMap((held) => held.records)) {
    const where = { sheet: `${read.set.title} · ${read.title}`, record: read.recordId! };
    for (const view of read.fields) {
      if (view.shown === 'hidden' || view.state === 'disputed' || fieldIsDerived(view.def)) continue;
      const key = addressKey(view.address);
      const on = { ...where, address: view.address, label: view.def.label, ...(view.def.sheet ? { depth: view.def.sheet } : {}) };
      const mine = (source: FieldSource | undefined) => (view.def.addedBy ?? paperFn(source?.evidenceId)) === fn;
      if (view.state === 'proposed' && mine(view.source)) all.push({ kind: 'proposed', need: 'accept', key: `${key}::proposed`, ...on, text: view.text, source: view.source, oneAtATime: view.oneAtATime });
      for (const waiting of view.waiting) {
        if (mine(waiting.source)) all.push({ kind: 'proposed', need: 'accept', key: `${key}::proposed::${waiting.index}`, ...on, text: waiting.text, source: waiting.source, pick: waiting.index, oneAtATime: true });
      }
    }
  }
  for (const line of beside) if (!all.some((other) => other.key === line.key)) all.push(line);
  // A set kept by period asks for one thing: its latest period that has ended and is not issued.
  for (const { set, periods } of sheets) {
    const due = periods?.due;
    if (!due) continue;
    all.push({ kind: 'due', need: due.late ? 'failing' : 'due_soon', key: `${set.id}::::period::${due.period.key}`, sheet: set.title, ...(due.record ? { record: due.record } : {}), address: { fn: set.fn, set: set.id, field: '', ...(due.record ? { record: due.record } : {}) }, label: set.title, text: due.said, tone: due.late ? 'critical' : 'warning' });
  }
  // The photograph round is kept by period a station at a time: the stations not photographed this period are one such line.
  const round = fn === SITE_FN ? stationRoundDue(project, at) : undefined;
  if (round) {
    all.push({ kind: 'due', need: round.late ? 'failing' : 'due_soon', key: `${round.set}::::period::${round.period.key}`, sheet: round.title, address: { fn, set: round.set, field: '' }, label: round.title, text: round.said, tone: round.late ? 'critical' : 'warning' });
  }
  // A line under Due soon a person put off stays off the page until its day, or until it starts failing.
  const day = indiaToday(at);
  const snoozed: FieldException[] = [];
  const exceptions: FieldException[] = [];
  for (const exception of offeredRecordsAsOneLine(all, [...readings, ...sharedRead.flatMap((held) => held.records)])) {
    const until = exception.need === 'due_soon' ? project.fieldSnoozes?.[exception.key]?.until : undefined;
    if (until && until > day) snoozed.push({ ...exception, snoozedUntil: until });
    else exceptions.push(exception);
  }
  exceptions.sort((a, b) => NEED_KINDS.indexOf(a.need) - NEED_KINDS.indexOf(b.need) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const counts = { proposed: 0, situation: 0, disputed: 0, missing: 0, unmatched: 0, rule: 0, due: 0, total: 0 };
  const needs: Record<NeedKind, FieldException[]> = { decide: [], accept: [], failing: [], due_soon: [], missing: [] };
  for (const exception of exceptions) {
    counts[exception.kind] += 1;
    counts.total += 1;
    needs[exception.need].push(exception);
  }
  const shared = sharedRead.map((held) => ({ set: held.set, records: held.records.map((reading) => sheetSeenFrom(reading, fn)) }));
  const views = readings.flatMap((read) => read.fields);
  return {
    fn,
    sheets,
    shared,
    situations,
    exceptions,
    counts,
    needs,
    snoozed,
    waitingOn: [...owing.values()],
    assumed: views.filter((view) => view.state === 'assumed' && view.shown !== 'hidden').length,
    recorded: readings.reduce((sum, read) => sum + read.filled, 0),
    expected: readings.reduce((sum, read) => sum + read.total, 0),
  };
}

/**
 * In place of a field's key in an address: every value a paper offered on one
 * record that nobody has accepted a value of. Deciding at this address takes
 * the record as it was offered, or leaves it.
 */
export const RECORD_AS_OFFERED = 'record as offered';

/**
 * A record a paper offered, and nobody has accepted a value of, as one line.
 *
 * A sale deed read into a new purchase was six lines to accept, one a field,
 * for what is one thing: this purchase, as the deed states it. The line names
 * the kind of record, says each value with its label, and carries where each
 * one waits (`whole`). Accepting it accepts the values that need no naming
 * (`decideField` at `RECORD_AS_OFFERED`); one a person has to name, a model's
 * exact figure with only a second reading behind it, stays for them to name.
 * Once a value of the record stands it is a record like any other, and what
 * still waits on it is listed field by field.
 */
function offeredRecordsAsOneLine(all: FieldException[], readings: readonly SheetReading[]): FieldException[] {
  const offered = (read: SheetReading) => read.fields.every((view) => fieldIsDerived(view.def) || view.state === 'empty' || (view.state === 'proposed' && !view.waiting.length));
  const out: FieldException[] = [];
  const done = new Set<string>();
  for (const exception of all) {
    const at = exception.address;
    const read = exception.kind === 'proposed' && at?.record ? readings.find((reading) => reading.set.id === at.set && reading.recordId === at.record) : undefined;
    if (!at || !read?.set.records || !offered(read)) {
      out.push(exception);
      continue;
    }
    const key = `${at.set}::${at.record}`;
    if (done.has(key)) continue;
    done.add(key);
    const lines = all.filter((line) => line.kind === 'proposed' && line.address?.set === at.set && line.address.record === at.record);
    out.push({
      kind: 'proposed',
      need: 'accept',
      key: `${key}::offered`,
      sheet: read.set.title,
      record: at.record,
      address: { fn: at.fn, set: at.set, record: at.record, field: RECORD_AS_OFFERED },
      label: `New ${read.set.records.of}`,
      text: lines.map((line) => `${line.label} ${line.text}`).join(' · '),
      ...(lines[0]!.source ? { source: lines[0]!.source } : {}),
      oneAtATime: lines.some((line) => line.oneAtATime),
      whole: lines.map((line) => line.address!),
    });
  }
  return out;
}

/** Takes a record as a paper offered it, or leaves it: every value that waits on it and needs no naming is accepted, or every one set aside. */
function decideRecordAsOffered(project: DdProject, address: FieldAddress, decision: FieldValueDecision, actor: string, options: FieldWriteOptions, catalog: FieldCatalog): undefined {
  const set = catalog.sets.get(address.set);
  if (!set?.records || !address.record || !fieldRecords(project, set.id).some((record) => record.id === address.record)) throw new FieldRefused('That record is not on this project.');
  if (decision !== 'accept' && decision !== 'set_aside') throw new FieldRefused('A record a paper offered is accepted or set aside.');
  assertMayDecide(set.fn, `Deciding a ${set.records.of} a paper offered`, options);
  const waiting = (readSheet(project, set.id, address.record, undefined, catalog)?.fields ?? []).filter((view) => view.state === 'proposed' && !fieldIsDerived(view.def));
  if (!waiting.length) throw new FieldRefused('Nothing waits on this record.');
  for (const view of waiting) {
    if (decision === 'accept' && view.oneAtATime) continue;
    decideField(project, view.address, decision, actor, {}, options, catalog);
  }
  return undefined;
}

/** How a check's own fields show on its screen, and the situations they wait on. */
export interface CheckFieldsShown {
  /** Each field of the check by key: there, folded until asked for, or not showing. */
  shown: Record<string, FieldShown>;
  /** Fields that hold a value while not showing: kept, and listed as not asked for now. */
  notInPlay: string[];
  /** The situations the check's fields wait on, with whether each is in play. */
  situations: SituationView[];
  /** The function the check sits in: where a situation of it is set. */
  fn: string;
}

/**
 * A check's fields as its screen should draw them: a field whose situation is
 * not in play is not drawn, an expert one is folded, and one that holds a
 * value while not in play is kept in sight as recorded and not asked for.
 * A check with no condition on any field reads as it always did: every field
 * shown.
 */
export function checkFieldsShown(project: DdProject, check: Pick<CheckInstance, 'definitionId' | 'fields'>, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): CheckFieldsShown {
  const set = catalog.sets.get(check.definitionId);
  if (!set || !catalog.checks.has(set.id)) return { shown: {}, notInPlay: [], situations: [], fn: '' };
  const conditional = set.fields.some((def) => def.showWhen || def.tier === 'expert' || def.retired);
  if (!conditional) return { shown: Object.fromEntries(set.fields.map((def) => [def.key, 'shown' as FieldShown])), notInPlay: [], situations: [], fn: set.fn };
  const resolution = resolveFields(project, at, catalog);
  const from = { fn: set.fn, set: set.id };
  const shown: Record<string, FieldShown> = {};
  const notInPlay: string[] = [];
  for (const def of set.fields) {
    const own = check.fields?.[def.key];
    const holds = !isBlank(own) || fieldState(own) === 'not_applicable' || Boolean(own?.other?.length) || (fieldIsDerived(def) && !isBlank(resolution.read({ ...from, field: def.key })));
    const inPlay = resolution.showing(def.showWhen, from) && !def.retired;
    shown[def.key] = !inPlay ? 'hidden' : def.tier === 'expert' && !holds ? 'folded' : 'shown';
    if (!inPlay && holds && !fieldIsDerived(def)) notInPlay.push(def.key);
  }
  const named = (key: string) => set.fields.some((def) => namesSituation(def.showWhen, key));
  const situations = readFunctionFields(project, set.fn, at, catalog).situations.filter((view) => named(view.situation.key));
  return { shown, notInPlay, situations, fn: set.fn };
}

/**
 * What each function's sheets wait on from other parties, by function: what
 * the department's papers-owed list is fed. Only the sheets a project has
 * begun: an untouched sheet is work not started, and owes nobody a line.
 */
export function fieldsOwed(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): Array<{ fn: string; department: DepartmentKey; groups: OwedGroup[] }> {
  if (!project.fieldSheets) return [];
  const out: Array<{ fn: string; department: DepartmentKey; groups: OwedGroup[] }> = [];
  for (const [fn, sets] of catalog.sheets) {
    const department = departmentOfFunction(fn);
    // Only where one of the function's begun sheets has a field somebody else owes: most have none, and are not read.
    if (!department || !sets.some((set) => project.fieldSheets?.[set.id] && set.fields.some((def) => def.owedBy))) continue;
    const groups = readFunctionFields(project, fn, at, catalog).waitingOn.map((group) => ({ ...group, fields: group.fields.filter((field) => project.fieldSheets?.[field.address.set]) })).filter((group) => group.fields.length);
    if (groups.length) out.push({ fn, department, groups });
  }
  return out;
}

/** What every function's sheets need of a person, for a tab's count and the Overview's line. Only functions that need something. */
export function fieldsNeeding(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): Array<{ fn: string; counts: FunctionFields['counts'] }> {
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
export function refChoices(project: DdProject, target: RefTarget | undefined, catalog: FieldCatalog = fieldCatalogFor(project)): Array<{ id: string; label: string }> {
  if (!target) return [];
  // The records of the set it names, or of the shared record it is a target of.
  const setId = refSet(target);
  // A record nobody has accepted or typed anything on is not one yet: nothing links to it.
  const records = setId && catalog.sets.get(setId)?.records ? fieldRecords(project, setId).filter(recordStands).map((record) => ({ id: record.id, label: readSheet(project, setId, record.id, undefined, catalog)?.title ?? record.id })) : [];
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

/** Whether the caller may make a value count in a function. With nobody asking, nothing is refused. */
function mayDecideIn(fn: string, options: FieldWriteOptions): boolean {
  if (!options.mayDecide) return true;
  const department = departmentOfFunction(fn);
  return fn === SHARED_FN ? DEPARTMENT_KEYS.some((key) => options.mayDecide!(key)) : Boolean(department && options.mayDecide(department));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The most the trail keeps of one value as it prints, and of one line of them. */
const AUDIT_VALUE_MOST = 60;
const AUDIT_LINE_MOST = 240;

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
 * and neither stands until a lead or signer keeps one. Typing again while
 * they are disputed adds a third beside them and settles nothing, and typing
 * the value a field already holds leaves it as it is, source and all.
 *
 * Clearing is typing nothing. A value accepted from a paper is cleared only
 * by somebody who may decide, and is then kept among what was set aside. A
 * value in dispute is not cleared at all: one of the two is kept.
 */
export function setFieldValues(
  project: DdProject,
  where: { set: string; record?: string; period?: string },
  values: Record<string, unknown>,
  actor: string,
  options: FieldWriteOptions = {},
  catalog: FieldCatalog = fieldCatalogFor(project),
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
    const state = fieldState(held);
    const sourced = Boolean(held) && state === 'accepted' && (held!.origin?.kind === 'paper' || held!.origin?.kind === 'external' || Boolean(held!.sourceEvidenceId));
    if (parsed.value === null) {
      if (held && !isBlank(held) && state === 'disputed') {
        rejected.push({ key, error: `${def.label} is in dispute. A lead or signer keeps one of the values; it is not cleared.` });
        continue;
      }
      if (held && sourced && !isBlank(held)) {
        if (!mayDecideIn(set.fn, options)) {
          rejected.push({ key, error: `${def.label} was accepted from a source. A lead or signer clears it; type the other figure to dispute it.` });
          continue;
        }
        // Cleared by somebody who may decide: set aside, and remembered with what else was set aside here.
        next[key] = { value: null, at, by: actor, declined: [...(held.declined ?? []), { value: held.value, by: actor, at }], ...(held.other?.length ? { other: held.other } : {}) };
        continue;
      }
      // Cleared. What waits beside it still waits.
      next[key] = held?.other?.length ? { value: null, at, by: actor, other: held.other } : null;
      continue;
    }
    // The value the field already holds, typed again: nothing changes, and where it came from is kept.
    if (held && !isBlank(held) && (fieldStands(held) || state === 'disputed') && same(held.value, parsed.value)) {
      next[key] = held;
      continue;
    }
    const typed: CheckFieldValue = { value: parsed.value, at, by: actor, state: 'typed', origin: { kind: 'person' }, v: set.v, ...('entered' in parsed && parsed.entered ? { entered: parsed.entered } : {}) };
    const beside = { value: parsed.value, origin: { kind: 'person' as const }, proposedBy: actor, at, ...(typed.entered ? { entered: typed.entered } : {}) };
    if (held && !isBlank(held) && state === 'disputed') {
      // Still in dispute: another figure typed is one more beside the two, and settles nothing.
      next[key] = held.other?.some((other) => same(other.value, parsed.value)) ? held : { ...held, other: [...(held.other ?? []), beside] };
    } else if (sourced) {
      next[key] = { ...held!, state: 'disputed', other: [...(held!.other ?? []), beside] };
    } else if (held && fieldState(held) === 'proposed' && !same(held.value, parsed.value)) {
      // The proposal is not lost by typing: it waits beside what was typed.
      next[key] = { ...typed, other: [...(held.other ?? []), { value: held.value, origin: held.origin ?? { kind: 'person' }, proposedBy: held.proposedBy, at: held.at, ...(held.entered ? { entered: held.entered } : {}) }] };
    } else {
      next[key] = { ...typed, ...(held?.other?.length ? { other: held.other } : {}), ...(held?.declined ? { declined: held.declined } : {}) };
    }
  }
  if (rejected.length) return { rejected, written: [] };
  // The trail says what each field held and what it holds now, as the field prints them.
  const lists = (id: string) => optionSetById(id, catalog);
  const said = (values: (key: string) => CheckFieldValue | null | undefined) =>
    Object.keys(next)
      .map((key) => `${key}: ${isBlank(values(key) ?? undefined) ? 'nothing' : formatFieldValue(set.fields.find((field) => field.key === key)!, values(key)!, lists).slice(0, AUDIT_VALUE_MOST)}`)
      .join('; ')
      .slice(0, AUDIT_LINE_MOST);
  const before = said((key) => standingField(holder[key]));
  for (const [key, value] of Object.entries(next)) {
    // A value carried from the last period and written again is this period's own.
    if (value !== holder[key]) notCarried(project, where, key);
    stand(holder, key, value, { at, by: actor });
  }
  project.updatedAt = at;
  project.historyFrom ??= at;
  recordAuditEvent(project, { actor, action: 'set_field_values', entityType: 'field_set', entityId: where.record ? `${where.set}::${where.record}` : where.set, oldValue: before, newValue: said((key) => next[key]), at });
  return { rejected: [], written: Object.keys(next) };
}

/** A value offered for a field, with where it was read. */
export interface FieldProposal {
  address: FieldAddress;
  value: unknown;
  /** Where it was read, as the proposer gives it. Only its named members are read: see `offeredOrigin`. */
  origin: FieldOrigin;
  /**
   * A measure as its paper writes it ("1 acre 20 guntas"), where the value is given in the base unit. Kept as what was
   * entered only where it is a measure the field takes and comes to the value given: the field then shows the paper's own
   * units with the base unit beside them. The value itself is never taken from it.
   */
  written?: string;
}

/** What a paper wrote for a measure, as the field keeps what was entered: only where it is the same measure as the value offered. */
function writtenAs(def: CheckFieldDef, value: unknown, written: string | undefined, state: string | undefined): Entered | undefined {
  if (!written || typeof value !== 'number' || !def.dimension || def.dimension === 'money') return undefined;
  const read = parseMeasure(written, def.dimension, { ...(def.enterIn ? { enterIn: def.enterIn } : {}), ...(state ? { state } : {}) });
  if ('error' in read || Math.abs(read.value - value) > Math.max(1, Math.abs(value) * 0.001)) return undefined;
  return { ...read.entered, text: read.entered.text ?? written };
}

/** The most that is kept of a paper's words, of a public source's name, and of its link. */
export const ORIGIN_QUOTE_MOST = 220;
export const ORIGIN_SOURCE_MOST = 120;

/** Where a model's words for a value are on its paper: the page that holds them, or undefined where no page of the paper does. */
export type QuotePlaced = (evidenceId: string, page: number, quote: string) => number | undefined;

/**
 * The origin that is kept for a value somebody offered, built here from the
 * named members of what was sent and nothing else.
 *
 * - Who read it is the proposer, never what the proposal says of itself: a
 *   model's value is a model's. Only the parser's own offer says which of
 *   the two read a paper's value, and what stands behind it.
 * - A model's words are held to the page (`placed`): found there, the value
 *   is proven by the page's text; not found, or with no pages to look in, it
 *   is unverified and a person names it to accept it.
 * - Every string is cut to a bound, and a link is kept only as https.
 *
 * Undefined where what was sent is no source at all.
 */
function offeredOrigin(sent: unknown, proposer: 'model' | 'parser', placed: QuotePlaced | undefined): Extract<FieldOrigin, { kind: 'paper' | 'external' }> | undefined {
  if (!sent || typeof sent !== 'object') return undefined;
  const given = sent as Record<string, unknown>;
  const text = (value: unknown, most: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, most) : '');
  if (given.kind === 'paper') {
    const evidenceId = text(given.evidenceId, 200);
    const quote = text(given.quote, ORIGIN_QUOTE_MOST);
    const page = typeof given.page === 'number' ? Math.floor(given.page) : Number.NaN;
    if (!evidenceId || !quote || !(page >= 1)) return { kind: 'paper', evidenceId, page: 0, quote, reader: proposer };
    if (proposer === 'parser') {
      const proof = given.proof === 'page_text' || given.proof === 'second_reader' || given.proof === 'unverified' ? given.proof : undefined;
      return { kind: 'paper', evidenceId, page, quote, reader: given.reader === 'model' ? 'model' : 'parser', ...(proof ? { proof } : {}) };
    }
    const found = placed?.(evidenceId, page, quote);
    return { kind: 'paper', evidenceId, page: found ?? page, quote, reader: 'model', proof: found ? 'page_text' : 'unverified' };
  }
  if (given.kind === 'external') {
    const quote = text(given.quote, ORIGIN_QUOTE_MOST);
    return { kind: 'external', source: text(given.source, ORIGIN_SOURCE_MOST), asOf: text(given.asOf, 10), ...(safeLink(given.url) ? { url: given.url } : {}), ...(quote ? { quote } : {}) };
  }
  return undefined;
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
 *
 * A value for a check's field waits the one way a check's value waits: on a
 * card of that check's values, read on the field as proposed
 * (`check-waiting.ts`). One the field already holds, one already waiting for
 * it and one a person set aside there make no second card. `cards` says
 * where a new card goes: a chat turn collects its own; without it the card
 * joins the project's.
 */
export function proposeFieldValues(
  project: DdProject,
  proposals: readonly FieldProposal[],
  proposer: 'model' | 'parser',
  catalog: FieldCatalog = fieldCatalogFor(project),
  cards: { pending?: readonly ChatProposal[]; raise?: (card: ChatProposal) => void; placed?: QuotePlaced } = {},
): FieldProposalOutcome[] {
  const at = now();
  const fresh = new Map<string, FieldRecord>();
  const out: FieldProposalOutcome[] = [];
  const onChecks: CheckOffer[] = [];
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
    const origin = offeredOrigin(proposal.origin, proposer, cards.placed);
    if (!origin) {
      refuse(`${def.label} needs a source: a paper with its page and words, or a public source with its date.`);
      continue;
    }
    if (origin.kind === 'paper') {
      if (!origin.quote || !(origin.page >= 1)) {
        refuse(`${def.label} needs the page and the paper’s own words.`);
        continue;
      }
      if (!project.evidence.some((e) => e.id === origin.evidenceId)) {
        refuse(`${def.label} cites a paper that is not on this project.`);
        continue;
      }
    } else if (!origin.source || dayNumber(origin.asOf) === null || dayOfNumber(dayNumber(origin.asOf)!) !== origin.asOf) {
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
    const asWritten = writtenAs(def, parsed.value, proposal.written, project.jurisdiction);
    if (asWritten) (parsed as { entered?: Entered }).entered = asWritten;
    if (catalog.checks.has(set.id)) {
      const check = checkHolding(project, set.id);
      if (!check) {
        refuse('That check is not on this project.');
        continue;
      }
      if (origin.kind === 'external' && def.proof === 'required') {
        refuse(`${def.label} has to cite a paper on this project: give the paper, the page and its words.`);
        continue;
      }
      const offer: CheckOffer = { check, def, value: parsed.value, origin };
      const twice = onChecks.some((other) => other.check.id === check.id && other.def.key === def.key && same(other.value, offer.value));
      const standing = twice ? 'waiting' : checkOfferStanding(project, offer, cards.pending);
      if (!standing) onChecks.push(offer);
      out.push({ address: proposal.address, outcome: standing ?? 'waiting' });
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
      origin,
      proposedBy: proposer,
      v: set.v,
      ...('entered' in parsed && parsed.entered ? { entered: parsed.entered } : {}),
      ...(origin.kind === 'paper' ? { sourceEvidenceId: origin.evidenceId, page: origin.page, quote: origin.quote } : {}),
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
      stand(holder, def.key, { ...offered, ...(held?.declined ? { declined: held.declined } : {}), ...(held?.other?.length ? { other: held.other } : {}) }, { at, by: proposer });
    } else if (held.other?.some((other) => same(other.value, parsed.value))) {
      out.push({ address, outcome: 'waiting' });
      continue;
    } else {
      // Beside a value that is held: it stays in force, and this waits for a person to keep one.
      holder[def.key] = { ...held, other: [...(held.other ?? []), beside] };
    }
    out.push({ address, outcome: 'waiting' });
  }
  for (const card of checkOfferCards(onChecks, proposer)) {
    if (cards.raise) cards.raise(card);
    else project.chatProposals.push(card);
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
  catalog: FieldCatalog = fieldCatalogFor(project),
): CheckFieldValue | undefined {
  if (address.field === RECORD_AS_OFFERED) return decideRecordAsOffered(project, address, decision, actor, options, catalog);
  const set = catalog.sets.get(address.set);
  const def = set?.fields.find((field) => field.key === address.field);
  if (!set || !def) throw new FieldRefused(`No field at ${address.set}/${address.field}.`);
  if (fieldIsDerived(def)) throw new FieldRefused(`${def.label} is worked out, and nobody decides it.`);
  if (decision === 'dispute') assertMayEdit(set.fn, options);
  else assertMayDecide(set.fn, `Deciding ${def.label}`, options);
  // On a check, a value that waits is on a card of the check's: deciding the field decides it there, the one way it is decided.
  if (catalog.checks.has(address.set) && (decision === 'accept' || decision === 'keep' || decision === 'set_aside')) {
    const check = checkHolding(project, address.set);
    if (!check) throw new FieldRefused('That check is not on this project.');
    let settled = false;
    try {
      settled = decideCheckWaiting(project, check, def, decision, actor, input, { mayDecide: options.mayDecide });
    } catch (error) {
      // Why a card's value cannot be decided here (it still waits on its paper) is a refusal, said in its own words.
      if (error instanceof Error && error.constructor === Error) throw new FieldRefused(error.message);
      throw error;
    }
    if (settled) return check.fields?.[def.key];
  }
  const holder = holderFor(project, catalog, address);
  const held = holder[def.key];
  const state = fieldState(held);
  const at = now();
  const declined = (value: CheckFieldValue['value']) => [...(held?.declined ?? []), { value, by: actor, at }];
  const standsAs = (origin: FieldOrigin | undefined): FieldState => (origin?.kind === 'person' || !origin ? 'typed' : 'accepted');
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
      next = { ...held, state: state === 'disputed' || state === 'proposed' ? standsAs(held.origin ?? (held.sourceEvidenceId ? { kind: 'paper', evidenceId: held.sourceEvidenceId, page: held.page ?? 0, quote: held.quote ?? '', reader: 'parser' } : undefined)) : state, acceptedBy: actor, acceptedAt: at, declined: [...(held.declined ?? []), ...(held.other ?? []).map((o) => ({ value: o.value, by: actor, at }))] };
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
      // What the field held is kept as it was, with what waited beside it, and comes back when the field is asked again.
      // It is not set aside: marking a field not applicable is no judgement on the value a paper gave for it.
      const { declined: setAside, was: before, ...holding } = held ?? ({} as CheckFieldValue);
      const was = held && state !== 'not_applicable' && (!isBlank(held) || held.other?.length) ? holding : before;
      next = { value: null, at, by: actor, state: 'not_applicable', naReason: reason, ...(note ? { naNote: note } : {}), acceptedBy: actor, acceptedAt: at, ...(setAside?.length ? { declined: setAside } : {}), ...(state === 'not_applicable' && held?.other?.length ? { other: held.other } : {}), ...(was ? { was } : {}) };
      break;
    }
    case 'reopen': {
      if (state !== 'not_applicable') throw new FieldRefused('This field is not marked not applicable.');
      // As it was: the value it held, and everything offered for it before and since.
      const waiting = [...(held?.was?.other ?? []), ...(held?.other ?? [])];
      if (held?.was) next = { ...held.was, ...(waiting.length ? { other: waiting } : {}), ...(held.declined?.length ? { declined: held.declined } : {}) };
      else next = held?.declined?.length || waiting.length ? { value: null, at, by: actor, ...(waiting.length ? { other: waiting } : {}), ...(held?.declined?.length ? { declined: held.declined } : {}) } : undefined;
      break;
    }
  }
  const lists = (id: string) => optionSetById(id, catalog);
  const stood = standingField(held);
  const before = stood && !isBlank(stood) ? formatFieldValue(def, stood, lists).slice(0, AUDIT_LINE_MOST) : undefined;
  notCarried(project, address, def.key);
  stand(holder, def.key, next, { at, by: actor });
  project.updatedAt = at;
  project.historyFrom ??= at;
  if (decision === 'accept' && next?.state === 'accepted') acceptOnPaper(project, def, next, actor, options);
  recordAuditEvent(project, { actor, action: `field_${decision}`, entityType: 'field', entityId: addressKey(address), ...(before ? { oldValue: before } : {}), newValue: next && !isBlank(next) ? String(next.value).slice(0, 120) : decision, at });
  return next ? holder[def.key] : next;
}

/**
 * Accepted on a field as read off a paper, so the paper is accepted as
 * stating it: the same value is not asked about twice, and what tells only a
 * paper's accepted values (the Approvals card, an answer in the chat) follows
 * the field. Only acceptance travels this way, only for the value the paper
 * itself holds under the field's key, and only where the person may decide
 * the paper too: a lead of the field's department who does not lead the
 * paper's leaves the paper's own value waiting there.
 */
function acceptOnPaper(project: DdProject, def: CheckFieldDef, accepted: CheckFieldValue, actor: string, options: FieldWriteOptions): void {
  const origin = accepted.origin;
  if (origin?.kind !== 'paper') return;
  const row = project.evidence.find((held) => held.id === origin.evidenceId);
  const key = def.factKey ?? def.key;
  if (!row || !paperCarries(row.documentType, key)) return;
  const agrees = (read: DocumentFact['value']) =>
    typeof read === 'number' && typeof accepted.value === 'number' ? Math.abs(read - accepted.value) <= Math.max(1, Math.abs(read) * 0.001) : String(read) === String(accepted.value);
  if (!proposedFacts(row).some((fact) => fact.key === key && agrees(fact.value))) return;
  if (options.mayDecide && !mayDecidePaper(project, row, options.mayDecide)) return;
  reviewFacts(project, row.id, [key], 'accept', actor, undefined, options.mayDecide ? { mayDecide: options.mayDecide } : {});
}

/**
 * Accept every value one paper offered to a function's sheets, in one press.
 * It leaves the ones a person has to name (`acceptedOneAtATime`): a model's
 * yes or no, an exact figure with only a second model behind it, a value
 * waiting beside another. Returns what it accepted and what it left.
 */
export function acceptAllFromPaper(project: DdProject, fn: string, evidenceId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): { accepted: FieldAddress[]; left: FieldAddress[] } {
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

/* --- Putting a line off ------------------------------------------------ */

/** The furthest ahead a line may be put off. */
export const SNOOZE_DAYS_MOST = 90;

/**
 * Puts a line under Due soon off until a day, or brings it back with none.
 *
 * Only a line under Due soon: something that can wait a day. A decision, a
 * value to accept, a rule failing and a field still empty cannot be put off,
 * and a line that starts failing while it is put off comes back at once. The
 * day is a person's, and theirs is the name kept beside it: a lead or signer
 * of the function's department.
 */
export function snoozeNeed(project: DdProject, fn: string, key: string, until: string | null, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project), at: Date = new Date()): void {
  assertMayDecide(fn, 'Putting this off', options);
  const page = readFunctionFields(project, fn, at, catalog);
  if (![...page.needs.due_soon, ...page.snoozed].some((line) => line.key === key)) throw new FieldRefused('Only a line under Due soon can be put off.');
  const when = now();
  const next = { ...(project.fieldSnoozes ?? {}) };
  if (until === null) delete next[key];
  else {
    const today = indiaToday(at);
    const last = dayOfNumber(dayNumber(today)! + SNOOZE_DAYS_MOST);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || dayNumber(until) === null || dayOfNumber(dayNumber(until)!) !== until) throw new FieldRefused('Give the day it comes back, as a date.');
    if (until <= today) throw new FieldRefused('The day it comes back is after today.');
    if (until > last) throw new FieldRefused(`A line is put off for ${SNOOZE_DAYS_MOST} days at most.`);
    next[key] = { until, by: actor, at: when };
  }
  project.fieldSnoozes = next;
  project.updatedAt = when;
  recordAuditEvent(project, { actor, action: until === null ? 'field_need_back' : 'field_need_put_off', entityType: 'field', entityId: key, ...(until ? { newValue: until } : {}), at: when });
}

/* --- Records ---------------------------------------------------------- */

/** A new record of a set that repeats, with what a person typed for it. */
export function addFieldRecord(project: DdProject, setId: string, values: Record<string, unknown>, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): { record?: FieldRecord; rejected: FieldWriteResult['rejected'] } {
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
export function removeFieldRecord(project: DdProject, setId: string, recordId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): void {
  const set = catalog.sets.get(setId);
  const record = sheetOf(project, setId)?.records?.find((held) => held.id === recordId && !held.removed);
  if (!set?.records || !record) throw new FieldRefused('That record is not on this project.');
  if (record.issued) throw new FieldRefused(ISSUED_SAID);
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
export function setSituation(project: DdProject, fn: string, key: string, on: boolean, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): SituationState {
  const at = situationAt(catalog, fn, key);
  if (!catalog.situations.has(at)) throw new FieldRefused(`No situation called "${key}".`);
  const declared = catalog.situations.get(at)!;
  if (declared.derive) throw new FieldRefused('This follows from what is recorded. Nobody sets it.');
  // A situation the whole project shares is decided from a function that declares it or has fields waiting on it, by that
  // function's lead or signer. From anywhere else it is somebody else's to decide.
  if (!at.startsWith(`${fn}:`) && !situationsOf(fn, catalog).some((named) => named.at === at)) throw new FieldRefused(`${declared.label} is not one of this function’s to decide.`);
  assertMayDecide(fn, 'Setting a situation', options);
  if (!on && declared.impliedBy && resolveFields(project, new Date(), catalog).showing(declared.impliedBy, { fn, set: '' })) {
    throw new FieldRefused(`${declared.label} is in play because of what is recorded. It goes out of play when that does.`);
  }
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
export function proposeSituations(project: DdProject, proposer = 'parser', catalog: FieldCatalog = fieldCatalogFor(project)): string[] {
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
 * the paper first. With `waiting`, a value that waits on the paper is handed
 * on too, for a paper as it is read: it then waits once, on the field that
 * owns it, where a lead or signer of the function accepts it with its page
 * and words in front of them. Never one two readers differ on, which is a
 * choice made on the paper, nor one a person set aside there. On the sheet
 * every value waits, whichever way it came. The situations the paper suggests
 * are proposed with it. Reading the same paper twice offers nothing twice.
 *
 * A set that repeats takes the paper's values on one record: the record this
 * paper was read into before; else the one known by what the paper calls it
 * (its survey number, its document, certificate or contract number: the
 * set's title field where the paper states it, else the first name or link
 * it states); else a new one. So an RTC for one survey number is offered to
 * that parcel's land record, and a second copy of a certificate to the
 * record the first made. A link is offered only where the paper names one
 * thing the project already has.
 */
export function offerPaperToSheets(
  project: DdProject,
  evidenceId: string | undefined,
  facts: readonly DocumentFact[],
  catalog: FieldCatalog = fieldCatalogFor(project),
  options: { waiting?: boolean } = {},
): FieldProposalOutcome[] {
  const paper = evidenceId ? project.evidence.find((e) => e.id === evidenceId) : undefined;
  const kind = paper?.documentType?.toLowerCase();
  if (!paper || !kind || paper.unconfirmedReply) return [];
  const handedOn = (fact: DocumentFact) => (options.waiting ? fact.review !== 'rejected' && !fact.otherReading : settled(fact));
  const fromPaper = (origin: FieldOrigin | undefined) => origin?.kind === 'paper' && origin.evidenceId === paper.id;
  const proposals: FieldProposal[] = [];
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      const stated = set.fields.flatMap((def) => {
        if (!def.fromTypes?.some((type) => type.toLowerCase() === kind) || fieldIsDerived(def) || def.kind === 'longtext') return [];
        const fact = facts.find((f) => f.key === (def.factKey ?? def.key) && handedOn(f));
        const value = fact ? paperValueFor(project, catalog, def, fact) : undefined;
        return fact && value !== undefined ? [{ def, fact, value }] : [];
      });
      if (!stated.length) continue;
      const records = set.records ? fieldRecords(project, set.id) : [];
      const known = set.records ? (stated.find((s) => s.def.key === set.records!.titleField) ?? stated.find((s) => s.def.kind === 'text' || s.def.kind === 'ref')) : undefined;
      const record =
        records.find((held) => Object.values(held.values).some((value) => fromPaper(value.origin) || value.other?.some((other) => fromPaper(other.origin))))
        ?? (known ? records.find((held) => namesTheSame(held.values[known.def.key], known.value)) : undefined);
      for (const { def, fact, value } of stated) {
        // A set that repeats: this paper's value is already on one of its records, waiting or decided.
        const already = records.some((held) => {
          const on = held.values[def.key];
          return on && (fromPaper(on.origin) || on.other?.some((o) => fromPaper(o.origin)) || on.declined?.some((d) => String(d.value) === String(fact.value)));
        });
        if (already) continue;
        proposals.push({
          address: { fn: set.fn, set: set.id, field: def.key, ...(record ? { record: record.id } : {}) },
          value,
          ...(fact.written ? { written: fact.written } : {}),
          origin: { kind: 'paper', evidenceId: paper.id, page: fact.page, quote: fact.quote, reader: fact.source === 'model' ? 'model' : 'parser', ...(proofOf(fact) ? { proof: proofOf(fact) } : {}) },
        });
      }
    }
  }
  const outcomes = proposals.length ? proposeFieldValues(project, proposals, 'parser', catalog) : [];
  proposeSituations(project, 'parser', catalog);
  return outcomes;
}

/** Letters and digits, and the runs of digits kept apart: 73/4 is not 734. */
function spelt(value: unknown): string {
  const text = String(value ?? '').normalize('NFKC').toLowerCase();
  return `${text.replace(/[^\p{L}\p{M}\p{N}]+/gu, '')}|${(text.match(/\d+/g) ?? []).join('-')}`;
}

/** Whether a record is known by what a paper calls it: the value its field holds, standing or waiting, is that name. */
function namesTheSame(held: CheckFieldValue | undefined, stated: unknown): boolean {
  if (!held) return false;
  return [held.value, ...(held.other ?? []).map((other) => other.value)].some((value) => !isBlank({ value } as CheckFieldValue) && spelt(value) === spelt(stated));
}

/**
 * A paper's value as its field takes it. An area is filed in square metres,
 * whatever the field is entered in, and a length with the unit the paper
 * wrote. A link takes the one thing on the project the paper's words name (a
 * parcel by its survey number, a contract by its number, a party by name);
 * where they name none, or more than one, nothing is offered for it.
 */
function paperValueFor(project: DdProject, catalog: FieldCatalog, def: CheckFieldDef, fact: DocumentFact): unknown {
  if (def.kind === 'ref') {
    const said = spelt(fact.value);
    const setId = refSet(def.target);
    // What each thing is called: its title, the name before a comma in it, and for a record any name or number it holds.
    const names = (choice: { id: string; label: string }) => {
      const record = setId ? fieldRecords(project, setId).find((held) => held.id === choice.id) : undefined;
      const texts = record ? (catalog.sets.get(setId!)?.fields ?? []).filter((field) => field.kind === 'text').map((field) => standingField(record.values[field.key])?.value) : [];
      return [choice.label, choice.label.split(',')[0], ...texts].filter((name) => name !== undefined && name !== null && String(name).trim() !== '');
    };
    const named = refChoices(project, def.target, catalog).filter((choice) => names(choice).some((name) => spelt(name) === said));
    return named.length === 1 ? named[0]!.id : undefined;
  }
  if (typeof fact.value !== 'number') return fact.value;
  if (def.dimension === 'area') return `${fact.value} sqm`;
  if (def.dimension === 'length' && fact.unit && /^(?:m|ft)$/i.test(fact.unit)) return `${fact.value} ${fact.unit.toLowerCase()}`;
  return fact.value;
}

/** Marks a section of a sheet not applicable, with the reason, or asks it again with none. */
export function setSectionNotApplicable(project: DdProject, setId: string, section: string, reason: NaReason | null, actor: string, options: FieldWriteOptions & { note?: string } = {}, catalog: FieldCatalog = fieldCatalogFor(project)): void {
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
 * is not among them, and a field that is not in play is, as what it holds.
 * A record nobody has accepted or typed anything on is not among them at
 * all: not its usual values, and not a name somebody offered for it.
 */
export function standingFieldLines(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): FieldLine[] {
  if (!project.fieldSheets) return [];
  const resolution = resolveFields(project, at, catalog);
  const lines: FieldLine[] = [];
  const lists = (id: string) => optionSetById(id, catalog);
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      if (!project.fieldSheets[set.id]) continue;
      const holders = set.records ? fieldRecords(project, set.id).filter(recordStands).map((record) => record.id) : [undefined];
      for (const recordId of holders) {
        const acting = resolution.holder(set.id, recordId);
        const kept = stored(project, catalog, set.id, recordId);
        const titled = set.records ? readSheet(project, set.id, recordId, resolution, catalog, at)?.title : undefined;
        for (const def of set.fields) {
          // What is not in play feeds nothing, and is still a fact somebody recorded: it is told as what the field holds.
          const value = acting[def.key] ?? (fieldIsDerived(def) ? undefined : standingField(kept[def.key]));
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
    ...(def.sheet ? { depthSheet: def.sheet } : {}),
    ...(view.due ? {} : { notDueBefore: def.dueFrom }),
    ...(view.owed ? { owedBy: view.owed.label } : {}),
    state: view.state,
    value: view.text,
    showing: view.shown !== 'hidden',
    // What may be offered: not a field that is worked out or mirrored, and not prose.
    mayPropose: !derived && def.kind !== 'longtext' && !def.retired,
    ...(view.source ? { source: { kind: view.source.kind, label: view.source.label, page: view.source.page, asOf: view.source.asOf } } : {}),
  };
}
