/**
 * A set kept by period: opened from the last, compared with it, due, issued
 * by a named person, and corrected by a revision kept beside it.
 *
 * A set says it is kept by period with `periodic` (docs/fields.md, Periods).
 * There are two forms and one declaration.
 *
 * - **Records.** On a set that repeats, each record is one period's
 *   instance: the month a cash record is for, the quarter a certificate
 *   covers, the drawdown a report was made for. Its `by` field names the
 *   period. Storage is what it was; a record gains only who issued it.
 * - **Snapshots.** On a sheet held once, the sheet is the open period, and
 *   each period issued is kept beside it with every field frozen.
 *
 * Six rules run through both.
 *
 * - **Nothing carried is asked twice.** A new period opens with the keys the
 *   set says to carry already filled, said to be carried from the last.
 * - **An issued period is never edited.** A correction is a revision opened
 *   beside it. Until the revision is issued the issued one stands.
 * - **Nothing is back-filled silently.** A period nobody kept is said to be
 *   not kept. Opening it late is a person's act, and it is dated when made.
 * - **A comparison is arithmetic.** Each figure with what it was and is, the
 *   dated rows that explain the movement, and what they leave: unexplained,
 *   settled by a pick from a list the set declares, never by a sentence.
 * - **A set is expected once somebody has kept it.** Until a first instance
 *   exists nothing is due, so a project that does not use a set is not asked
 *   for it every month.
 * - **Every line is a template.** "October: 4 of 9 fields, due 7 Nov 2026"
 *   is put together here from the record.
 */

import { asAtMoment, isPastDay, projectAsAt } from './as-at';
import { dayNumber, evaluateFormula, fieldNumber, fieldOptions, fieldState, formatFieldValue, isBlank, standingField, type FormulaOutside } from './check-fields';
import { departmentOfFunction, FieldRefused, addFieldRecord, readSheet, refChoices, resolveFields, type FieldResolution, type FieldWriteOptions, type SheetReading } from './field-sheets';
import { DEPARTMENT_KEYS } from './departments';
import { optionSetById, type FieldCatalog } from './field-registry';
import { fieldCatalogFor, ruleRowsFor } from './firm-fields';
import { SHARED_FN } from './field-sets/shared-records';
import { recordAuditEvent } from './operations';
import { COST_REPORT_PERIODS, costReportDue, costReportPeriods, freezeReading, frozenAsNowSaid, sheetFirstPeriod, sheetPeriodDue, sheetPeriodToIssue, sheetPeriods, sheetPeriodsNotKept } from './sheet-periods';
import { dayAfter, isCalendarDay, monthsAfter, periodKind, periodOfDay, periodOfKey, periodShift, periodsBetween, periodsNumbered, yearWritten, type CalendarEvery, type PeriodSpan } from './period-keys';
import { indiaToday } from './quarters';
import { stationRoundDue } from './photo-stations';
import { ruleRow } from './rule-tables';
import { personSaid } from './team';
import { daySaid } from './said';
import { OWED_ROLE_LABEL } from './types';
import type { CheckFieldDef, CheckFieldValue, DdProject, FieldRecord, FieldSet, OptionDef, PeriodAttribute, Periodic } from './types';

const now = (): string => new Date().toISOString();

/* ==================================================================== */
/* A set's periods                                                       */
/* ==================================================================== */

/** One period of a set as it is kept: a record of a set that repeats, or (see `sheet-periods.ts`) one issue of a sheet. */
export interface PeriodInstance {
  set: string;
  /** The period's key, then whatever tells this instance from another in the same period: `FY2026-Q2|accountant_withdrawal`. */
  id: string;
  period: PeriodSpan;
  /** What tells it from another instance in its period, as it is said: "Accountant: withdrawal". */
  perSaid?: string;
  status: 'open' | 'issued';
  /** The record that is the instance. */
  record?: string;
  issued?: { by: string; at: string; name?: string };
  /** The instance this one corrects. */
  revises?: string;
  /** A later revision of it has been issued: it is kept as it was sent, and no longer the one that stands. */
  superseded?: true;
  /** The day it is due, where the set's rule gives one. */
  due?: string;
  /** Issued after it was due, or open past the day it is due. */
  late: boolean;
  /** Must-fields recorded, of the must-fields in play. */
  filled: number;
  total: number;
  /** The fields filled from the last period when it was opened, and the period they came from, in short. */
  carried?: { from: string; keys: string[] };
}

const recordsOf = (project: DdProject, setId: string): FieldRecord[] => (project.fieldSheets?.[setId]?.records ?? []).filter((record) => !record.removed);

/** What a field of a record states, where it stands. */
const stated = (record: FieldRecord, key: string): CheckFieldValue['value'] | undefined => {
  const value = standingField(record.values[key]);
  return isBlank(value) ? undefined : value!.value;
};

/** The period a record of a periodic set is for, read off its `by` field. Undefined until that field holds something that names one. */
export function periodOfRecord(project: DdProject, set: FieldSet, record: FieldRecord, catalog: FieldCatalog = fieldCatalogFor(project)): PeriodSpan | undefined {
  const periodic = set.periodic;
  if (!periodic?.by) return undefined;
  const named = stated(record, periodic.by);
  if (typeof named !== 'string' || !named) return undefined;
  if (typeof periodic.every === 'object') return eventSpan(project, periodic.every, named, catalog);
  const numbered = periodsNumbered(project);
  if (isCalendarDay(named.slice(0, 10))) return periodOfDay(periodic.every, named.slice(0, 10), numbered);
  return periodic.every === 'year' ? yearWritten(named, numbered) : undefined;
}

/** An event as a period: one day long, keyed by the event's record and called what that record is called. */
function eventSpan(project: DdProject, every: { event: string; on?: string }, recordId: string, catalog: FieldCatalog): PeriodSpan | undefined {
  const events = catalog.sets.get(every.event);
  const event = recordsOf(project, every.event).find((held) => held.id === recordId);
  if (!events?.records || !event) return undefined;
  const on = every.on ? stated(event, every.on) : undefined;
  const day = typeof on === 'string' && isCalendarDay(on.slice(0, 10)) ? on.slice(0, 10) : indiaToday(new Date(event.createdAt));
  const titleDef = events.fields.find((def) => def.key === events.records!.titleField);
  const title = titleDef ? standingField(event.values[titleDef.key]) : undefined;
  const label = titleDef && !isBlank(title) ? `${cap(events.records.of)} ${formatFieldValue(titleDef, title, (id) => optionSetById(id, catalog))}` : cap(events.records.of);
  return { key: `evt:${recordId}`, from: day, to: day, label, short: label };
}

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The day a period is due: so many days after it ends, or what a rule row says, in days or months. Undefined where the row is not on file. */
export function periodDue(project: DdProject, periodic: Periodic, span: PeriodSpan, at: Date = new Date()): string | undefined {
  if ('days' in periodic.due) return dayAfter(span.to, periodic.due.days);
  // What a rule may turn on about the period itself: whether it is the last month, or the last quarter, of the financial year.
  const yearEnd = span.to.slice(5, 7) === '03' ? 'year_end' : 'ordinary';
  // The row in force when the period ended; where the table only begins later, the row in force today.
  const place = { state: project.jurisdiction, city: project.city };
  const rows = ruleRowsFor(project);
  const row = ruleRow(rows, periodic.due.rate, place, span.to, { month: yearEnd, quarter: yearEnd }) ?? ruleRow(rows, periodic.due.rate, place, indiaToday(at), { month: yearEnd, quarter: yearEnd });
  if (!row) return undefined;
  return /month/i.test(row.unit ?? '') && !/day of/i.test(row.unit ?? '') ? monthsAfter(span.to, row.value) : dayAfter(span.to, row.value);
}

/** How the fields that tell instances apart in one period read on a record: the key part and the words. */
function perOf(project: DdProject, set: FieldSet, record: FieldRecord, catalog: FieldCatalog): { key: string; said?: string } {
  const keys = set.periodic?.per ?? [];
  if (!keys.length) return { key: '' };
  const parts = keys.map((key) => stated(record, key));
  const words = keys.flatMap((key) => {
    const def = set.fields.find((field) => field.key === key);
    const value = standingField(record.values[key]);
    if (!def || isBlank(value)) return [];
    // A link is said by what it links to: the building's name, the party's.
    if (def.kind === 'ref') return refChoices(project, def.target, catalog).flatMap((choice) => (choice.id === value!.value ? [choice.label] : []));
    return [formatFieldValue(def, value, (id) => optionSetById(id, catalog))];
  });
  return { key: `|${parts.map((part) => (part === undefined ? '' : String(part))).join('|')}`, ...(words.length ? { said: words.join(', ') } : {}) };
}

/**
 * Every period a set keeps on a project, the latest first: open ones, issued
 * ones, and issued ones a later revision has taken the place of. A record
 * whose `by` field names no period yet is not one. `readings` gives how full
 * each record is where the caller has read them already.
 */
export function periodsOf(project: DdProject, setId: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project), readings?: (recordId: string) => Pick<SheetReading, 'filled' | 'total'> | undefined): PeriodInstance[] {
  // The Cost Report keeps its own months, and a sheet held once its own issues: each is read as instances all the same.
  if (setId === COST_REPORT_PERIODS) return costReportPeriods(project, at);
  const set = catalog.sets.get(setId);
  if (!set?.periodic) return [];
  if (!set.records) return sheetPeriods(project, set, at);
  const today = indiaToday(at);
  const all = recordsOf(project, setId);
  const replaced = new Set(all.filter((record) => record.revises && record.issued).map((record) => record.revises!));
  let resolution: FieldResolution | undefined;
  const out: Array<PeriodInstance & { made: string }> = [];
  for (const record of all) {
    const period = periodOfRecord(project, set, record, catalog);
    if (!period) continue;
    const per = perOf(project, set, record, catalog);
    const due = periodDue(project, set.periodic, period, at);
    const read = readings?.(record.id) ?? readSheet(project, setId, record.id, (resolution ??= resolveFields(project, at, catalog)), catalog, at);
    const carried = record.carried ? { from: periodOfKey(record.carried.from)?.short ?? record.carried.from, keys: record.carried.keys } : undefined;
    out.push({
      set: setId,
      id: `${period.key}${per.key}`,
      period,
      ...(per.said ? { perSaid: per.said } : {}),
      status: record.issued ? 'issued' : 'open',
      record: record.id,
      ...(record.issued ? { issued: record.issued } : {}),
      ...(record.revises ? { revises: record.revises } : {}),
      ...(replaced.has(record.id) ? { superseded: true as const } : {}),
      ...(due ? { due } : {}),
      late: Boolean(due) && (record.issued ? indiaToday(new Date(record.issued.at)) > due! : today > due!),
      filled: read?.filled ?? 0,
      total: read?.total ?? 0,
      ...(carried?.keys.length ? { carried } : {}),
      made: record.createdAt,
    });
  }
  // The latest period first; within one, what stands before what a revision replaced, and the later made before the earlier.
  return out
    .sort((a, b) => b.period.from.localeCompare(a.period.from) || Number(Boolean(a.superseded)) - Number(Boolean(b.superseded)) || Number(Boolean(b.revises)) - Number(Boolean(a.revises)) || b.made.localeCompare(a.made))
    .map(({ made: _made, ...instance }) => instance);
}

/** The instances that stand for each period: an issued one a revision has replaced is left out, and so is a revision still open beside the issue it corrects. */
export function periodsStanding(instances: readonly PeriodInstance[]): PeriodInstance[] {
  return instances.filter((instance) => !instance.superseded && !(instance.revises && instance.status === 'open'));
}

/** The period a set is in on a day, with what is kept of it. Undefined for a set kept by event, which has no period until an event has. */
export function currentPeriod(project: DdProject, setId: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): { span: PeriodSpan; instances: PeriodInstance[] } | undefined {
  const every = catalog.sets.get(setId)?.periodic?.every;
  if (!every || typeof every === 'object') return undefined;
  const span = periodOfDay(every, indiaToday(at), periodsNumbered(project))!;
  return { span, instances: periodsOf(project, setId, at, catalog).filter((instance) => instance.period.key === span.key) };
}

/** The period before the one a set is in on a day, with what is kept of it. */
export function lastPeriod(project: DdProject, setId: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): { span: PeriodSpan; instances: PeriodInstance[] } | undefined {
  const current = currentPeriod(project, setId, at, catalog);
  if (!current) return undefined;
  const span = periodShift(current.span, -1);
  return { span, instances: periodsOf(project, setId, at, catalog).filter((instance) => instance.period.key === span.key) };
}

/** The periods between the first a set kept and the last that has ended that nobody kept, the latest first. Never filled in by anything but a person. */
export function periodsNotKept(project: DdProject, setId: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project), kept: readonly PeriodInstance[] = periodsOf(project, setId, at, catalog)): PeriodSpan[] {
  const every = catalog.sets.get(setId)?.periodic?.every;
  if (!every || typeof every === 'object' || !kept.length) return [];
  const have = new Set(kept.map((instance) => instance.period.key));
  const first = kept[kept.length - 1]!.period;
  const ended = periodShift(periodOfDay(every, indiaToday(at), periodsNumbered(project))!, -1);
  return periodsBetween(first, ended)
    .filter((span) => !have.has(span.key))
    .reverse();
}

/* ==================================================================== */
/* What is due                                                           */
/* ==================================================================== */

/** The one line a set kept by period asks of its function: the latest period that has ended and is not issued. */
export interface PeriodDue {
  fn: string;
  set: string;
  title: string;
  period: PeriodSpan;
  /** The record to open, where the period has been opened. */
  record?: string;
  state: 'open' | 'not_started';
  filled: number;
  total: number;
  due?: string;
  /** Past the day it is due. */
  late: boolean;
  /** "October: 4 of 9 fields, due 7 Nov 2026". */
  said: string;
}

/** How a period that is not issued is said: how full it is, and when it is or was due. */
export function periodDueSaid(period: PeriodSpan, state: PeriodDue['state'], filled: number, total: number, due: string | undefined, late: boolean): string {
  const full = state === 'not_started' ? 'not started' : `${filled} of ${total} ${total === 1 ? 'field' : 'fields'}`;
  return `${period.short}: ${full}${due ? `, ${late ? 'was due' : 'due'} ${daySaid(due)}` : ''}`;
}

/**
 * What a periodic set asks for on a day: nothing until somebody has kept a
 * first instance, then the latest period that has ended and has no issued
 * instance. One line for a set, whatever else it is behind on: older periods
 * nobody kept are said on the sheet (`periodsNotKept`), not asked for here.
 * A set kept by event asks for the earliest event that has no instance.
 */
export function periodDueOf(project: DdProject, set: FieldSet, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project), kept: readonly PeriodInstance[] = periodsOf(project, set.id, at, catalog)): PeriodDue | undefined {
  const periodic = set.periodic;
  if (!periodic || !set.records || !kept.length) return undefined;
  const today = indiaToday(at);
  const line = (period: PeriodSpan, open: PeriodInstance | undefined): PeriodDue => {
    const due = periodDue(project, periodic, period, at);
    const late = Boolean(due) && today > due!;
    const state = open ? 'open' : 'not_started';
    return { fn: set.fn, set: set.id, title: set.title, period, ...(open?.record ? { record: open.record } : {}), state, filled: open?.filled ?? 0, total: open?.total ?? 0, ...(due ? { due } : {}), late, said: periodDueSaid(period, state, open?.filled ?? 0, open?.total ?? 0, due, late) };
  };
  if (typeof periodic.every === 'object') {
    // Each event the set answers to, in the order they happened: the first with nothing issued for it.
    const events = recordsOf(project, periodic.every.event)
      .map((event) => eventSpan(project, periodic.every as { event: string; on?: string }, event.id, catalog))
      .filter((span): span is PeriodSpan => Boolean(span))
      .sort((a, b) => a.from.localeCompare(b.from));
    for (const span of events) {
      const of = kept.filter((instance) => instance.period.key === span.key);
      if (of.some((instance) => instance.status === 'issued')) continue;
      return line(span, of.find((instance) => instance.status === 'open'));
    }
    return undefined;
  }
  const ended = periodShift(periodOfDay(periodic.every, today, periodsNumbered(project))!, -1);
  // Before the first period the set kept, nothing was expected of it.
  if (ended.from < kept[kept.length - 1]!.period.from) return undefined;
  const of = kept.filter((instance) => instance.period.key === ended.key);
  // Every instance of the period issued: nothing is due. One still open is the line; with none opened, the period is not started.
  const open = of.filter((instance) => instance.status === 'open' && !instance.revises);
  if (of.length && !open.length) return undefined;
  return line(ended, open[0]);
}

/** Every periodic set's due line across a project, for whoever is told on the report day. */
export function periodsDue(project: DdProject, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): PeriodDue[] {
  const out: PeriodDue[] = [];
  for (const set of catalog.sets.values()) {
    if (!set.periodic || catalog.checks.has(set.id)) continue;
    if (set.records) {
      if (!recordsOf(project, set.id).length) continue;
      const due = periodDueOf(project, set, at, catalog);
      if (due) out.push(due);
    } else if (sheetFirstPeriod(project, set)) {
      const due = sheetPeriodDue(project, set, at, sheetPeriods(project, set, at), readSheet(project, set.id, undefined, undefined, catalog, at));
      if (due) out.push(due);
    }
  }
  const cost = costReportDue(project, at);
  if (cost) out.push(cost);
  // The photograph round is kept by period too, a station at a time: what it waits on is one line with the rest.
  const round = stationRoundDue(project, at);
  if (round) out.push(round);
  return out;
}

/** Who opened the period a set is behind on: whoever made its record, or started the sheet on it. Named on the set, and told with its issuers. */
export function periodOpenedBy(project: DdProject, due: Pick<PeriodDue, 'set' | 'record'>): string | undefined {
  const sheet = project.fieldSheets?.[due.set];
  return due.record ? sheet?.records?.find((record) => record.id === due.record)?.by : sheet?.open?.openedBy;
}

/**
 * How an issued record says which of its figures are the day of issue's and
 * not its period-end's ("2 figures as now, no history before 13 Oct 2026:
 * …"). Undefined where every figure was read as at the period's last day.
 */
export function periodAsNowSaid(project: DdProject, set: FieldSet, recordId: string | undefined): string | undefined {
  const record = recordId ? recordsOf(project, set.id).find((held) => held.id === recordId) : undefined;
  return record?.issued ? frozenAsNowSaid(set, record.frozen) : undefined;
}

/* ==================================================================== */
/* Opening, issuing, revising                                            */
/* ==================================================================== */

function periodicSet(project: DdProject, setId: string, catalog: FieldCatalog): FieldSet & { periodic: Periodic; records: NonNullable<FieldSet['records']> } {
  const set = catalog.sets.get(setId);
  if (!set?.periodic || !set.records || !set.periodic.by) throw new FieldRefused('That set is not kept by period.');
  return set as FieldSet & { periodic: Periodic; records: NonNullable<FieldSet['records']> };
}

function mayDecideIn(fn: string, options: FieldWriteOptions): boolean {
  if (!options.mayDecide) return true;
  const department = departmentOfFunction(fn);
  return fn === SHARED_FN ? DEPARTMENT_KEYS.some((key) => options.mayDecide!(key)) : Boolean(department && options.mayDecide(department));
}

/** A value as a person would have typed it: what stands on a record, copied to a new one under the name of whoever opened it. */
const carriedValue = (value: CheckFieldValue): unknown => (value.entered?.text ? value.entered.text : value.value);

/** The most rows a first period opens: a project with more buildings than this adds the rest by hand. */
const FIRST_INSTANCES_MOST = 24;

/**
 * What tells apart the rows a first period opens, where the set keeps
 * several instances a period: each option of the kind the set declares, or
 * each building the project keeps, by the first of the set's `per` fields
 * that names such a list. Empty where the set keeps one instance a period,
 * tells its instances apart by something else (the party who states a
 * figure), or the list is empty (no building recorded yet).
 */
function firstInstances(project: DdProject, set: FieldSet & { periodic: Periodic }, catalog: FieldCatalog): Array<Record<string, string>> {
  for (const key of set.periodic.per ?? []) {
    const def = set.fields.find((field) => field.key === key);
    if (!def) continue;
    const of = def.kind === 'enum' ? fieldOptions(def, (id) => optionSetById(id, catalog)).filter((option) => !option.retired).map((option) => option.key) : def.kind === 'ref' && def.target === 'building' ? refChoices(project, def.target, catalog).map((choice) => choice.id) : [];
    if (of.length) return of.slice(0, FIRST_INSTANCES_MOST).map((value) => ({ [key]: value }));
  }
  return [];
}

/** What a period's `by` field holds for a span: its first day, the year as written, or the event's record. */
function byValue(set: FieldSet, span: PeriodSpan): string {
  const def = set.fields.find((field) => field.key === set.periodic!.by);
  if (span.key.startsWith('evt:')) return span.key.slice(4);
  if (def?.kind === 'date') return periodKind(span.key) === 'quarter' || periodKind(span.key) === 'year' ? span.to : span.from;
  return span.label.replace(/^FY /, '');
}

/**
 * Opens a period of a set that repeats.
 *
 * With no period named it is the one today falls in. Where the period is
 * open already, what is open is handed back and nothing is made. Otherwise
 * one record is made for each instance the last period kept (each kind of
 * certificate, each building), with the fields that tell them apart and the
 * keys the set carries already filled; where there is no last period, one
 * blank record. Opening a period that has gone by is allowed, and the record
 * says when it was made: nothing is dated back.
 */
export function openPeriod(
  project: DdProject,
  setId: string,
  actor: string,
  options: FieldWriteOptions = {},
  input: { period?: string; at?: Date } = {},
  catalog: FieldCatalog = fieldCatalogFor(project),
): { period: PeriodSpan; records: FieldRecord[]; made: number } {
  const set = periodicSet(project, setId, catalog);
  const at = input.at ?? new Date();
  const span = input.period
    ? input.period.startsWith('evt:') && typeof set.periodic.every === 'object'
      ? eventSpan(project, set.periodic.every, input.period.slice(4), catalog)
      : periodOfKey(input.period)
    : typeof set.periodic.every === 'object'
      ? undefined
      : periodOfDay(set.periodic.every, indiaToday(at), periodsNumbered(project));
  if (!span) throw new FieldRefused(typeof set.periodic.every === 'object' ? 'Say which one it is for.' : 'That is not a period.');
  if (typeof set.periodic.every !== 'object' && periodKind(span.key) !== set.periodic.every) throw new FieldRefused(`${set.title} is kept by the ${set.periodic.every}.`);
  const kept = periodsOf(project, setId, at, catalog);
  const here = kept.filter((instance) => instance.period.key === span.key);
  const all = recordsOf(project, setId);
  if (here.length) return { period: span, records: all.filter((record) => here.some((instance) => instance.record === record.id && instance.status === 'open')), made: 0 };
  // The last period kept before this one: what it holds is where this one starts.
  const before = periodsStanding(kept).filter((instance) => instance.period.from < span.from);
  const lastKey = before[0]?.period.key;
  const last = before.filter((instance) => instance.period.key === lastKey).map((instance) => all.find((record) => record.id === instance.record)!);
  const records: FieldRecord[] = [];
  const stamp = now();
  // A first period on a set that keeps several instances a period (a certificate of each kind, one for each building)
  // opens a row for each one the set declares or the project keeps, never one blank row that says no kind.
  const firstRows = last.length ? [] : firstInstances(project, set, catalog);
  for (const from of last.length ? last : firstRows.length ? firstRows : [undefined]) {
    const opening = from && !('id' in from) ? (from as Record<string, string>) : undefined;
    const before = from && 'id' in from ? (from as FieldRecord) : undefined;
    const keys = before ? [...(set.periodic.per ?? []), ...(set.periodic.carry ?? [])].filter((key) => key !== set.periodic.by && !isBlank(standingField(before.values[key]))) : [];
    const values: Record<string, unknown> = { [set.periodic.by!]: byValue(set, span), ...(opening ?? {}) };
    for (const key of keys) values[key] = carriedValue(before!.values[key]!);
    const out = addFieldRecord(project, setId, values, actor, options, catalog);
    if (!out.record) throw new FieldRefused(out.rejected.map((line) => line.error).join(' '));
    // A key stays marked as carried until somebody writes it (`setFieldValues`, `decideField`).
    if (before && keys.length) out.record.carried = { from: lastKey!, at: stamp, keys };
    records.push(out.record);
  }
  recordAuditEvent(project, { actor, action: 'open_period', entityType: 'field_set', entityId: `${setId}::${span.key}`, newValue: `${set.title}, ${span.label}` });
  return { period: span, records, made: records.length };
}

/** The project read as at a day, with one record of a set as it is held now: a period's own entries are the period's, whenever they were typed. */
function projectWithRecord(project: DdProject, setId: string, record: FieldRecord, day: string): DdProject {
  const view = projectAsAt(project, day);
  const sheet = view.fieldSheets?.[setId] ?? { values: {} };
  const { issued: _issued, frozen: _frozen, carried: _carried, ...open } = record;
  return { ...view, fieldSheets: { ...view.fieldSheets, [setId]: { ...sheet, records: [...(sheet.records ?? []).filter((held) => held.id !== record.id), open] } } };
}

function recordOf(project: DdProject, setId: string, recordId: string): FieldRecord {
  const record = recordsOf(project, setId).find((held) => held.id === recordId);
  if (!record) throw new FieldRefused('That record is not on this project.');
  return record;
}

/**
 * Issues one period's record under a person's name. From here it is never
 * edited.
 *
 * Who may: a lead or a signer of the function's department where the set
 * says `lead`; its signer alone where it says `signer`; and where the set
 * names an outside party (the architect, the lender's engineer), a lead or
 * signer records it as issued and gives the name it was signed under.
 * Refused while a value on it waits to be accepted or is in dispute: an
 * issued period holds nothing a person has not decided.
 */
export function issuePeriod(
  project: DdProject,
  setId: string,
  recordId: string,
  issuer: { actor: string; name?: string },
  options: FieldWriteOptions = {},
  catalog: FieldCatalog = fieldCatalogFor(project),
  at: Date = new Date(),
): FieldRecord {
  const set = periodicSet(project, setId, catalog);
  const record = recordOf(project, setId, recordId);
  const department = departmentOfFunction(set.fn);
  const role = department ? options.roleIn?.(department) : undefined;
  const who = set.periodic.issuer;
  if (who === 'signer' ? options.roleIn && role !== 'signer' : !mayDecideIn(set.fn, options)) {
    throw new FieldRefused(who === 'signer' ? `${set.title} is issued by the department’s signer.` : `${set.title} is issued by a lead or a signer of the department.`);
  }
  const name = issuer.name?.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (who !== 'lead' && who !== 'signer' && !name) throw new FieldRefused(`Give the name ${OWED_ROLE_LABEL[who].toLowerCase()} signed it under.`);
  if (record.issued) throw new FieldRefused('This period is already issued.');
  const period = periodOfRecord(project, set, record, catalog);
  if (!period) throw new FieldRefused(`Say which ${typeof set.periodic.every === 'object' ? set.records.of : set.periodic.every} it is for before issuing it.`);
  const undecided = Object.values(record.values).filter((value) => fieldState(value) === 'proposed' || fieldState(value) === 'disputed' || (value.other?.length ?? 0) > 0).length;
  if (undecided) throw new FieldRefused(`${undecided} ${undecided === 1 ? 'value waits' : 'values wait'} on it for a person. Accept or set ${undecided === 1 ? 'it' : 'them'} aside first.`);
  const stamp = at.toISOString();
  // Every field in play is written down as it reads and prints, the worked-out ones among them: an issued period is never
  // worked out again. A period that has ended is read as at its last day, whenever it is issued: the record's own entries
  // are the period's and are taken as typed, and what its worked-out fields read from the rest of the project is read as
  // the project stood when that day ended.
  const reading = isPastDay(period.to, at) ? readSheet(projectWithRecord(project, setId, record, period.to), setId, record.id, undefined, catalog, asAtMoment(period.to)) : readSheet(project, setId, record.id, undefined, catalog, at);
  if (reading) record.frozen = freezeReading(project, reading);
  record.issued = { by: issuer.actor, at: stamp, ...(name ? { name } : {}) };
  recordAuditEvent(project, { actor: issuer.actor, action: 'issue_period', entityType: 'field_set', entityId: `${setId}::${record.id}`, newValue: `${set.title}, ${period.label}`, at: stamp });
  return record;
}

/**
 * Opens a revision of an issued period beside it.
 *
 * The issued record stays as it was issued. The revision starts as a copy of
 * what it holds, is edited like any open period, and takes its place once it
 * is issued in its turn. Until then the issued one is the one that stands and
 * the one every figure reads. Where a revision is open already, it is handed
 * back and no second is made. A lead's or a signer's act.
 */
export function revisePeriod(project: DdProject, setId: string, recordId: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): FieldRecord {
  const set = periodicSet(project, setId, catalog);
  const issued = recordOf(project, setId, recordId);
  if (!issued.issued) throw new FieldRefused('Only an issued period is revised. This one is still open.');
  if (!mayDecideIn(set.fn, options)) throw new FieldRefused(`A revision of ${set.title} is opened by a lead or a signer of the department.`);
  const all = recordsOf(project, setId);
  if (all.some((record) => record.revises === issued.id && record.issued)) throw new FieldRefused('A later revision of this period has been issued. Revise that one.');
  const open = all.find((record) => record.revises === issued.id && !record.issued);
  if (open) return open;
  const at = now();
  const values = Object.fromEntries(
    Object.entries(issued.values).map(([key, value]) => {
      const { history: _history, ...copy } = JSON.parse(JSON.stringify(value)) as CheckFieldValue;
      return [key, copy];
    }),
  );
  const record: FieldRecord = { id: `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, values, createdAt: at, by: actor, revises: issued.id, ...(issued.reasons ? { reasons: { ...issued.reasons } } : {}) };
  const sheet = project.fieldSheets![setId]!;
  sheet.records = [...(sheet.records ?? []), record];
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'revise_period', entityType: 'field_set', entityId: `${setId}::${record.id}`, oldValue: issued.id, newValue: set.title, at });
  return record;
}

/* ==================================================================== */
/* Comparing with the last period                                        */
/* ==================================================================== */

/** One field of a period beside the same field of the period before. */
export interface PeriodFieldMove {
  key: string;
  label: string;
  /** As each period prints it. "—" where it held nothing. */
  wasSaid: string;
  nowSaid: string;
  moved: boolean;
  /** Now less then, where both are figures. */
  by?: number;
  bySaid?: string;
  /** A running total: what moved is the period's own amount. */
  cumulative?: true;
  /** The dated rows that explain it, by what the set calls each kind, with how many rows and their sum. */
  causes?: Array<{ label: string; rows: number; amount: number; said: string }>;
  /** What the rows leave. Zero where they explain all of it. */
  unexplained?: number;
  unexplainedSaid?: string;
  /** What a person picked for it, by key and as it reads. */
  reason?: string;
  reasonSaid?: string;
  /** "Was ₹4.10 Cr in September; now ₹4.32 Cr". */
  said: string;
}

export interface PeriodComparison {
  set: string;
  current: PeriodInstance;
  previous?: PeriodInstance;
  fields: PeriodFieldMove[];
  /** How many fields moved. */
  moved: number;
  /** How many figures have a remainder nobody has picked a reason for. */
  unsettled: number;
  /** What a person may pick for an unexplained remainder. */
  reasons: OptionDef[];
  /** "3 of 9 figures moved since September". */
  said: string;
}

const COMPARED_KINDS = new Set(['money', 'number', 'percent', 'area', 'duration', 'computed', 'enum', 'status', 'boolean', 'date', 'text']);

/** A figure as its field prints it, signed where it is a movement. */
function figureSaid(def: CheckFieldDef, amount: number, signed = false): string {
  const said = formatFieldValue(def.kind === 'computed' || def.kind === 'status' ? { ...def, kind: 'number' } : def, { value: Math.abs(amount), at: '', by: '' });
  return signed ? `${amount < 0 ? '−' : '+'}${said}` : `${amount < 0 ? '−' : ''}${said}`;
}

/** The dated rows of one attribution that fall inside a period: how many, and what they come to. */
function attributed(attribute: PeriodAttribute, span: PeriodSpan, values: Record<string, CheckFieldValue>, outside: FormulaOutside): { rows: number; amount: number } {
  const between = { column: attribute.date, from: { op: 'const' as const, value: dayNumber(span.from)! }, to: { op: 'const' as const, value: dayNumber(span.to)! } };
  const where = { column: attribute.date, is: 'set' as const };
  const amount = evaluateFormula({ op: 'sum_if', over: attribute.rows, column: attribute.amount, where, between }, values, outside) ?? 0;
  const rows = evaluateFormula({ op: 'count_if', over: attribute.rows, where, between }, values, outside) ?? 0;
  return { rows, amount };
}

/**
 * One period of a set beside the one before it, field by field.
 *
 * `recordId` is the period looked at. The one before is the instance that
 * stands for the nearest earlier period, of the same kind where the set
 * keeps several in a period; or the one named. Every figure is given as it
 * was and as it is, with what it moved by. Where the set declares dated rows
 * for a figure, their sum inside the period is set against the movement (or
 * against the period's own amount), and what is left is unexplained until a
 * person picks why from the set's list.
 */
export function comparePeriods(project: DdProject, setId: string, recordId: string, against?: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): PeriodComparison {
  const set = periodicSet(project, setId, catalog);
  const all = periodsOf(project, setId, at, catalog);
  const current = all.find((instance) => instance.record === recordId);
  if (!current) throw new FieldRefused('That record is not a period of this set.');
  const perKey = current.id.slice(current.period.key.length);
  const previous = against
    ? all.find((instance) => instance.record === against)
    : periodsStanding(all).find((instance) => instance.period.from < current.period.from && instance.id.slice(instance.period.key.length) === perKey && instance.record !== current.revises);
  const resolution = resolveFields(project, at, catalog);
  const now = resolution.holder(setId, current.record);
  const was = previous?.record ? resolution.holder(setId, previous.record) : {};
  const outside: FormulaOutside = { read: (address) => resolution.read(address), records: (id) => resolution.records(id), record: current.record, today: at };
  return compareHolders(set, { current, previous, now, was, picked: recordOf(project, setId, recordId).reasons, outside }, catalog);
}

/**
 * The arithmetic of a comparison, whatever holds the two periods: the values
 * of each as they act, and the rows that explain a figure read through
 * `outside`.
 */
export function compareHolders(
  set: FieldSet,
  held: { current: PeriodInstance; previous?: PeriodInstance; now: Record<string, CheckFieldValue>; was: Record<string, CheckFieldValue>; picked?: Record<string, string>; outside: FormulaOutside },
  catalog: FieldCatalog,
): PeriodComparison {
  const periodic = set.periodic!;
  const { current, previous, now, was, outside } = held;
  const lists = (id: string) => optionSetById(id, catalog);
  const reasons = periodic.reasons ? (optionSetById(periodic.reasons, catalog)?.options ?? []).filter((option) => !option.retired) : [];
  const worded = (def: CheckFieldDef): boolean => def.yields === 'date' || def.kind === 'date' || def.kind === 'text' || def.kind === 'enum' || def.kind === 'status' || def.kind === 'boolean';
  const fields: PeriodFieldMove[] = [];
  for (const def of set.fields) {
    if (!COMPARED_KINDS.has(def.kind) || def.retired || def.key === periodic.by || (periodic.per ?? []).includes(def.key)) continue;
    const [a, b] = [was[def.key], now[def.key]];
    if (isBlank(a) && isBlank(b)) continue;
    const [wasSaid, nowSaid] = [formatFieldValue(def, a, lists), formatFieldValue(def, b, lists)];
    const [n0, n1] = worded(def) ? [null, null] : [fieldNumber(a), fieldNumber(b)];
    const by = n0 !== null && n1 !== null ? Math.round((n1 - n0) * 100) / 100 : undefined;
    const moved = previous ? wasSaid !== nowSaid : false;
    const cumulative = (periodic.cumulative ?? []).includes(def.key);
    const move: PeriodFieldMove = { key: def.key, label: def.label, wasSaid, nowSaid, moved, ...(by !== undefined ? { by, bySaid: figureSaid(def, by, true) } : {}), ...(cumulative ? { cumulative: true as const } : {}), said: '' };
    const explains = (periodic.attribute ?? []).filter((attribute) => attribute.field === def.key);
    if (explains.length && n1 !== null) {
      // The rows explain how far the figure moved, or the period's own amount where the set says so.
      const target = explains[0]!.of === 'amount' ? n1 : (by ?? n1);
      move.causes = explains.map((attribute) => {
        const sum = attributed(attribute, current.period, now, outside);
        return { label: attribute.label, rows: sum.rows, amount: sum.amount, said: `${attribute.label}: ${figureSaid(def, sum.amount)} in ${sum.rows} ${sum.rows === 1 ? 'row' : 'rows'}` };
      });
      const left = Math.round((target - move.causes.reduce((sum, cause) => sum + cause.amount, 0)) * 100) / 100;
      move.unexplained = left;
      if (left !== 0) {
        move.unexplainedSaid = `Unexplained: ${figureSaid(def, left)}`;
        const picked = held.picked?.[def.key];
        const option = picked ? reasons.find((kept) => kept.key === picked) : undefined;
        if (option) {
          move.reason = option.key;
          move.reasonSaid = option.label;
        }
      }
    }
    move.said = !previous
      ? nowSaid
      : !moved
        ? `Unchanged at ${nowSaid}`
        : cumulative && move.bySaid
          ? `${move.bySaid} in ${current.period.short}: ${wasSaid} to ${nowSaid}`
          : `Was ${wasSaid} in ${previous.period.short}; now ${nowSaid}`;
    fields.push(move);
  }
  const moved = fields.filter((field) => field.moved).length;
  const figures = fields.length;
  return {
    set: set.id,
    current,
    ...(previous ? { previous } : {}),
    fields,
    moved,
    unsettled: fields.filter((field) => field.unexplained && !field.reason).length,
    reasons,
    said: previous ? `${moved} of ${figures} ${figures === 1 ? 'field' : 'fields'} moved since ${previous.period.short}` : `Nothing earlier to compare ${current.period.short} with`,
  };
}

/**
 * Picks why a figure's movement is not explained by its rows, or with `null`
 * takes the pick back. The reason is one of the set's own list: no sentence
 * is kept. Only where the comparison leaves a remainder, and never on an
 * issued period.
 */
export function setPeriodReason(project: DdProject, setId: string, recordId: string, field: string, reason: string | null, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): void {
  const set = periodicSet(project, setId, catalog);
  const record = recordOf(project, setId, recordId);
  if (record.issued) throw new FieldRefused('This period is issued. A correction is a revision kept beside it.');
  const department = departmentOfFunction(set.fn);
  if (options.mayEdit && !(department && options.mayEdit(department))) throw new FieldRefused('Your role on this project reads this department and does not change it.');
  const next = { ...(record.reasons ?? {}) };
  if (reason === null) delete next[field];
  else {
    const list = set.periodic.reasons ? optionSetById(set.periodic.reasons, catalog) : undefined;
    if (!list || !fieldOptions({ key: field, label: field, kind: 'enum', optionSet: list.id }, (id) => optionSetById(id, catalog)).some((option) => option.key === reason && !option.retired)) throw new FieldRefused('Pick one of the reasons on the list.');
    const move = comparePeriods(project, setId, recordId, undefined, new Date(), catalog).fields.find((held) => held.key === field);
    if (!move?.unexplained) throw new FieldRefused('Nothing of that figure is unexplained.');
    next[field] = reason;
  }
  if (Object.keys(next).length) record.reasons = next;
  else delete record.reasons;
  recordAuditEvent(project, { actor, action: 'set_period_reason', entityType: 'field_set', entityId: `${setId}::${recordId}`, newValue: reason ? `${field}: ${reason}` : field });
}

/* ==================================================================== */
/* A periodic set as its page draws it                                   */
/* ==================================================================== */

/** What a function's page needs of one set kept by period: what is open, the one line that opens the past, and what is due. */
export interface SetPeriods {
  /** The period today falls in. Absent on a set kept by event. */
  current?: PeriodSpan;
  /** The period the page opens on: the latest with anything open, else the latest kept. */
  shown?: PeriodSpan;
  /** The records drawn on opening: the open instances of that period, and any revision open beside an issue. */
  open: PeriodInstance[];
  /** Every instance issued, the latest first, with those a later revision replaced. */
  past: PeriodInstance[];
  /** "September issued by A. Rao · 11 earlier". Absent where nothing is issued. */
  pastSaid?: string;
  /** Periods that went by with nothing kept. */
  notKept: PeriodSpan[];
  /** "2 periods not kept: July, August". */
  notKeptSaid?: string;
  due?: PeriodDue;
  /** The period one press opens: today's, where nothing is kept of it yet. */
  toOpen?: PeriodSpan;
  /** On a sheet held once: the period one press issues, the latest that has ended and is not issued. */
  toIssue?: PeriodSpan;
  /** On a sheet held once: what the sheet carried from the last period issued, and which. */
  carried?: { from: string; keys: string[] };
  /**
   * Nothing kept yet: the one quiet line the set shows in place of a period, and the periods one press starts it on.
   * Starting is what begins the due cycle; until then nothing is asked of the set.
   */
  first?: { said: string; start: PeriodSpan; earlier: PeriodSpan };
}

/** The line a set kept by period shows before its first period: "No period kept yet · Start with October 2026". */
function firstPeriodOf(start: PeriodSpan): NonNullable<SetPeriods['first']> {
  return { said: `No period kept yet · Start with ${start.label}`, start, earlier: periodShift(start, -1) };
}

/** How an issued instance is said in the one line that opens the past. */
export function periodIssuedSaid(project: DdProject, instance: PeriodInstance): string {
  const by = instance.issued ? (instance.issued.name ?? personSaid(project, instance.issued.by)) : '';
  return `${instance.period.short}${instance.perSaid ? `, ${instance.perSaid}` : ''} issued${by ? ` by ${by}` : ''}${instance.revises ? ', revised' : ''}`;
}

/** One periodic set as a page draws it. Undefined for a set that is not kept by period. */
export function setPeriods(
  project: DdProject,
  set: FieldSet,
  at: Date = new Date(),
  catalog: FieldCatalog = fieldCatalogFor(project),
  readings?: (recordId: string) => Pick<SheetReading, 'filled' | 'total'> | undefined,
  /** On a sheet held once: how full the sheet is as it reads now. */
  live?: Pick<SheetReading, 'filled' | 'total'>,
): SetPeriods | undefined {
  if (!set.periodic) return undefined;
  if (!set.records) {
    if (typeof set.periodic.every === 'object') return undefined;
    const all = sheetPeriods(project, set, at);
    const sheet = project.fieldSheets?.[set.id];
    const current = periodOfDay(set.periodic.every, indiaToday(at), periodsNumbered(project))!;
    const past = all.filter((instance) => instance.status === 'issued');
    const standing = past.filter((instance) => !instance.superseded);
    const notKept = sheetPeriodsNotKept(project, set, at, all);
    const due = sheetPeriodDue(project, set, at, all, live);
    const toIssue = sheetPeriodToIssue(project, set, at, all);
    const carried = sheet?.open?.carried;
    return {
      current,
      ...(sheetFirstPeriod(project, set) ? {} : { first: firstPeriodOf(current) }),
      shown: (sheet?.open?.key ? periodOfKey(sheet.open.key) : undefined) ?? current,
      open: all.filter((instance) => instance.status === 'open'),
      past,
      ...(standing.length ? { pastSaid: `${periodIssuedSaid(project, standing[0]!)}${past.length > 1 ? ` · ${past.length - 1} earlier` : ''}` } : {}),
      notKept,
      ...(notKept.length ? { notKeptSaid: `${notKept.length} ${notKept.length === 1 ? 'period' : 'periods'} not kept: ${notKept.slice(0, 6).map((span) => span.short).join(', ')}${notKept.length > 6 ? ` and ${notKept.length - 6} more` : ''}` } : {}),
      ...(due ? { due } : {}),
      ...(toIssue ? { toIssue } : {}),
      ...(carried?.keys.length ? { carried: { from: periodOfKey(carried.from)?.short ?? carried.from, keys: carried.keys } } : {}),
    };
  }
  const all = periodsOf(project, set.id, at, catalog, readings);
  const current = typeof set.periodic.every === 'object' ? undefined : periodOfDay(set.periodic.every, indiaToday(at), periodsNumbered(project));
  const opened = all.filter((instance) => instance.status === 'open');
  const past = all.filter((instance) => instance.status === 'issued');
  const shown = opened[0]?.period ?? all[0]?.period;
  const open = opened.filter((instance) => instance.period.key === shown?.key || instance.revises);
  const notKept = periodsNotKept(project, set.id, at, catalog, all);
  const due = periodDueOf(project, set, at, catalog, all);
  const standing = past.filter((instance) => !instance.superseded);
  return {
    ...(current ? { current } : {}),
    ...(shown ? { shown } : {}),
    open,
    past,
    ...(standing.length ? { pastSaid: `${periodIssuedSaid(project, standing[0]!)}${past.length > 1 ? ` · ${past.length - 1} earlier` : ''}` } : {}),
    notKept,
    ...(notKept.length ? { notKeptSaid: `${notKept.length} ${notKept.length === 1 ? 'period' : 'periods'} not kept: ${notKept.slice(0, 6).map((span) => span.short).join(', ')}${notKept.length > 6 ? ` and ${notKept.length - 6} more` : ''}` } : {}),
    ...(due ? { due } : {}),
    ...(current && !all.some((instance) => instance.period.key === current.key) ? { toOpen: current } : {}),
    ...(current && !all.length ? { first: firstPeriodOf(current) } : {}),
  };
}

export type { CalendarEvery, PeriodSpan };
