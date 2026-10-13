/**
 * A sheet kept by period: the sheet is the open period, and each period
 * issued is kept beside it with every field frozen.
 *
 * Construction's month at a glance, the lender position, the week's stock:
 * each is one sheet of live figures. Read in November it says November, and
 * October's is gone unless somebody issued October. Issuing writes down every
 * field in play, the worked-out ones among them, as it read and as it
 * printed, with the footnote it carried. From then on October reads as it
 * was issued, whatever the project does next.
 *
 * - **The sheet goes on.** After an issue the sheet is the next period's: the
 *   keys the set carries keep what they hold, said to be carried, and the
 *   rest open blank. What they held is in their history.
 * - **An issue is never edited.** A revision is opened beside it, holds a copy
 *   of what was typed, is worked out as at the period's last day, and takes
 *   the issue's place once it is issued in its turn.
 * - **The Cost Report is read as periods too.** It stays its own module; a
 *   read-only adapter gives its months as instances, so the due list and the
 *   charts see it as they see any set kept by period.
 */

import { asAtMoment, projectAsAt } from './as-at';
import { fieldIsDerived, fieldNumber, fieldState, formatFieldValue, isBlank, standingField, type FormulaOutside } from './check-fields';
import { costReportTotals, costReportsOf, type CostReportPeriod } from './cost-report';
import { stand } from './field-history';
import { compareHolders, periodDue, periodDueSaid, periodsNumbered, periodsOf, periodsStanding, type PeriodComparison, type PeriodDue, type PeriodInstance } from './field-periods';
import { optionSetById, type FieldCatalog } from './field-registry';
import { departmentOfFunction, FieldRefused, readSheet, resolveFields, type FieldWriteOptions, type SheetReading } from './field-sheets';
import { fieldCatalogFor } from './firm-fields';
import { recordAuditEvent } from './operations';
import { dayAfter, periodOfDay, periodOfKey, periodShift, periodsBetween, type CalendarEvery, type PeriodSpan } from './period-keys';
import { indiaToday } from './quarters';
import { fieldPrinted } from './report-fields';
import { OWED_ROLE_LABEL } from './types';
import type { CheckFieldValue, DdProject, FieldAddress, FieldPeriod, FieldSet, FrozenField, Periodic, StoredFieldSheet } from './types';

/* ==================================================================== */
/* Freezing                                                              */
/* ==================================================================== */

/**
 * Every field in play on a reading, as it is kept at issue: its value, how
 * it printed, the footnote it carried and the paper that footnote cites. A
 * worked-out field is frozen as any other: it is never worked out again.
 */
export function freezeReading(project: DdProject, reading: SheetReading): Record<string, FrozenField> {
  const out: Record<string, FrozenField> = {};
  for (const view of reading.fields) {
    if (view.shown === 'hidden') continue;
    const printed = fieldPrinted(project, view);
    const derived = fieldIsDerived(view.def);
    const value = isBlank(view.held) || (!derived && !standingField(view.held)) ? null : view.held!.value;
    out[view.def.key] = {
      value,
      said: printed.value,
      ...(printed.notes.length ? { footnote: printed.notes.join(' ') } : {}),
      ...(view.source?.evidenceId ? { evidenceId: view.source.evidenceId } : {}),
      ...(derived ? { derived: true as const } : {}),
      ...(view.tone ? { tone: view.tone } : {}),
    };
  }
  return out;
}

/** A holder's stored values as an issue keeps them: a copy with nothing shared, and without the history each value carries on the sheet. */
function copyValues(values: Record<string, CheckFieldValue>): Record<string, CheckFieldValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const { history: _history, ...copy } = JSON.parse(JSON.stringify(value)) as CheckFieldValue;
      return [key, copy];
    }),
  );
}

/** How many of a holder's stored values wait for a person: offered, in dispute, or with another offered beside them. */
export function valuesWaiting(values: Record<string, CheckFieldValue>): number {
  return Object.values(values).filter((value) => fieldState(value) === 'proposed' || fieldState(value) === 'disputed' || (value.other?.length ?? 0) > 0).length;
}

/* ==================================================================== */
/* A sheet's periods                                                     */
/* ==================================================================== */

function snapshotSet(project: DdProject, setId: string, catalog: FieldCatalog): FieldSet & { periodic: Periodic & { every: CalendarEvery } } {
  const set = catalog.sets.get(setId);
  if (!set?.periodic || set.records || catalog.checks.has(setId) || typeof set.periodic.every === 'object') throw new FieldRefused('That sheet is not kept by period.');
  return set as FieldSet & { periodic: Periodic & { every: CalendarEvery } };
}

const sheetOf = (project: DdProject, setId: string): StoredFieldSheet | undefined => project.fieldSheets?.[setId];

/** The period that most lately ended on a day. */
function lastEnded(project: DdProject, every: CalendarEvery, at: Date): PeriodSpan {
  return periodShift(periodOfDay(every, indiaToday(at), periodsNumbered(project))!, -1);
}

/** Every issue and open revision a sheet keeps, as instances, the latest period first and within one the latest made first. */
export function sheetPeriods(project: DdProject, set: FieldSet, at: Date = new Date()): PeriodInstance[] {
  const periodic = set.periodic;
  if (!periodic || set.records) return [];
  const held = sheetOf(project, set.id)?.periods ?? [];
  const today = indiaToday(at);
  // Of two issues of one period, the later is the one that stands.
  const standing = new Map<string, FieldPeriod>();
  for (const period of held) if (period.status === 'issued') standing.set(period.key, period);
  return held
    .map((period, index) => {
      const span = periodOfKey(period.key) ?? { key: period.key, from: period.from, to: period.to, label: period.key, short: period.key };
      const due = periodDue(project, periodic, span, at);
      const fields = Object.values(period.frozen ?? {});
      const filled = fields.filter((field) => field.value !== null && field.value !== '').length;
      const instance: PeriodInstance & { index: number } = {
        set: set.id,
        id: period.key,
        period: span,
        status: period.status,
        ...(period.issuedAt ? { issued: { by: period.issuedBy ?? '', at: period.issuedAt, ...(period.issuedName ? { name: period.issuedName } : {}) } } : {}),
        ...(period.revises ? { revises: period.revises } : {}),
        ...(period.status === 'issued' && standing.get(period.key) !== period ? { superseded: true as const } : {}),
        ...(due ? { due } : {}),
        late: Boolean(due) && (period.issuedAt ? indiaToday(new Date(period.issuedAt)) > due! : today > due!),
        filled,
        total: fields.length,
        index,
      };
      return instance;
    })
    .sort((a, b) => b.period.from.localeCompare(a.period.from) || b.index - a.index)
    .map(({ index: _index, ...instance }) => instance);
}

/** What a sheet kept by period asks for: once a first period has been issued, the latest period that has ended and is not. */
export function sheetPeriodDue(project: DdProject, set: FieldSet, at: Date, kept: readonly PeriodInstance[], live?: Pick<SheetReading, 'filled' | 'total'>): PeriodDue | undefined {
  const periodic = set.periodic;
  if (!periodic || set.records || typeof periodic.every === 'object') return undefined;
  const issued = kept.filter((instance) => instance.status === 'issued');
  if (!issued.length) return undefined;
  const ended = lastEnded(project, periodic.every, at);
  if (issued.some((instance) => instance.period.key === ended.key) || ended.from < issued[issued.length - 1]!.period.from) return undefined;
  const due = periodDue(project, periodic, ended, at);
  const late = Boolean(due) && indiaToday(at) > due!;
  return { fn: set.fn, set: set.id, title: set.title, period: ended, state: 'open', filled: live?.filled ?? 0, total: live?.total ?? 0, ...(due ? { due } : {}), late, said: periodDueSaid(ended, 'open', live?.filled ?? 0, live?.total ?? 0, due, late) };
}

/** The periods between the first a sheet issued and the last that has ended that were never issued, the latest first, without the one that is still due. */
export function sheetPeriodsNotKept(project: DdProject, set: FieldSet, at: Date, kept: readonly PeriodInstance[]): PeriodSpan[] {
  const periodic = set.periodic;
  const issued = kept.filter((instance) => instance.status === 'issued');
  if (!periodic || typeof periodic.every === 'object' || !issued.length) return [];
  const have = new Set(issued.map((instance) => instance.period.key));
  const ended = lastEnded(project, periodic.every, at);
  return periodsBetween(issued[issued.length - 1]!.period, periodShift(ended, -1))
    .filter((span) => !have.has(span.key))
    .reverse();
}

/** The period one press issues: the latest that has ended, where the sheet holds anything and that period is not issued. */
export function sheetPeriodToIssue(project: DdProject, set: FieldSet, at: Date, kept: readonly PeriodInstance[]): PeriodSpan | undefined {
  const periodic = set.periodic;
  if (!periodic || set.records || typeof periodic.every === 'object') return undefined;
  const ended = lastEnded(project, periodic.every, at);
  if (kept.some((instance) => instance.period.key === ended.key && instance.status === 'issued')) return undefined;
  return Object.values(sheetOf(project, set.id)?.values ?? {}).some((value) => !isBlank(value)) ? ended : undefined;
}

function assertIssuer(set: FieldSet, issuer: { actor: string; name?: string }, options: FieldWriteOptions): string | undefined {
  const who = set.periodic!.issuer;
  const department = departmentOfFunction(set.fn);
  const role = department ? options.roleIn?.(department) : undefined;
  const decides = !options.mayDecide || Boolean(department && options.mayDecide(department));
  if (who === 'signer' ? options.roleIn && role !== 'signer' : !decides) throw new FieldRefused(who === 'signer' ? `${set.title} is issued by the department’s signer.` : `${set.title} is issued by a lead or a signer of the department.`);
  const name = issuer.name?.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (who !== 'lead' && who !== 'signer' && !name) throw new FieldRefused(`Give the name ${OWED_ROLE_LABEL[who].toLowerCase()} signed it under.`);
  return name || undefined;
}

/** The project read as at a period's last day, with one sheet holding what a given issue or revision of that period holds. */
function projectWithPeriod(project: DdProject, setId: string, period: FieldPeriod): DdProject {
  const view = projectAsAt(project, period.to);
  const sheet = view.fieldSheets?.[setId] ?? { values: {} };
  const { asIssued: _covering, ...plain } = sheet;
  return {
    ...view,
    fieldSheets: {
      ...view.fieldSheets,
      [setId]: { ...plain, values: period.values, ...(period.status === 'issued' ? { asIssued: { key: period.key, ...(period.frozen ? { frozen: period.frozen } : {}), ...(period.issuedAt ? { issuedAt: period.issuedAt } : {}), ...(period.issuedBy ? { issuedBy: period.issuedBy } : {}), ...(period.issuedName ? { issuedName: period.issuedName } : {}) } } : {}) },
    },
  };
}

/**
 * One period of a sheet as it reads: an issue as it was frozen, or a
 * revision still open, worked out as at the period's last day from what the
 * revision holds. `issuedAt` picks one issue among several of a period;
 * without it the latest entry for the period is read.
 */
export function readSheetPeriod(project: DdProject, setId: string, key: string, catalog: FieldCatalog = fieldCatalogFor(project), issuedAt?: string): { period: FieldPeriod; reading: SheetReading; editable: boolean } | undefined {
  const of = (sheetOf(project, setId)?.periods ?? []).filter((period) => period.key === key);
  const period = issuedAt ? of.find((held) => held.issuedAt === issuedAt) : of.at(-1);
  if (!period) return undefined;
  const reading = readSheet(projectWithPeriod(project, setId, period), setId, undefined, undefined, catalog, asAtMoment(period.to));
  return reading ? { period, reading, editable: period.status === 'open' } : undefined;
}

/**
 * Issues a period of a sheet under a person's name.
 *
 * With no period named it is the latest that has ended. Where a revision of
 * that period is open, it is the revision that is issued, worked out as at
 * the period's last day. Otherwise the sheet as it reads now is written down
 * as the period: what was typed, and every field in play as it reads and
 * prints. The sheet then goes on as the next period's, keeping the keys the
 * set carries and opening the rest blank. Refused while a value waits for a
 * person, and for a period already issued: that one is revised.
 */
export function issueSheetPeriod(
  project: DdProject,
  setId: string,
  issuer: { actor: string; name?: string },
  options: FieldWriteOptions = {},
  input: { period?: string; at?: Date } = {},
  catalog: FieldCatalog = fieldCatalogFor(project),
): FieldPeriod {
  const set = snapshotSet(project, setId, catalog);
  const at = input.at ?? new Date();
  const name = assertIssuer(set, issuer, options);
  const span = input.period ? periodOfKey(input.period) : lastEnded(project, set.periodic.every, at);
  if (!span || periodOfDay(set.periodic.every, span.from, periodsNumbered(project))?.key !== span.key) throw new FieldRefused(`${set.title} is kept by the ${set.periodic.every}.`);
  if (span.from > indiaToday(at)) throw new FieldRefused('That period has not begun.');
  project.fieldSheets ??= {};
  const sheet = (project.fieldSheets[setId] ??= { values: {} });
  const stamp = at.toISOString();
  const held = sheet.periods ?? [];
  const revision = held.find((period) => period.key === span.key && period.status === 'open');
  if (revision) {
    const waiting = valuesWaiting(revision.values);
    if (waiting) throw new FieldRefused(`${waiting} ${waiting === 1 ? 'value waits' : 'values wait'} on it for a person. Accept or set ${waiting === 1 ? 'it' : 'them'} aside first.`);
    const reading = readSheet(projectWithPeriod(project, setId, revision), setId, undefined, undefined, catalog, asAtMoment(span.to));
    revision.frozen = reading ? freezeReading(project, reading) : {};
    revision.status = 'issued';
    revision.issuedAt = stamp;
    revision.issuedBy = issuer.actor;
    if (name) revision.issuedName = name;
    project.updatedAt = stamp;
    recordAuditEvent(project, { actor: issuer.actor, action: 'issue_period', entityType: 'field_set', entityId: `${setId}::${span.key}`, oldValue: revision.revises, newValue: `${set.title}, ${span.label}, revised`, at: stamp });
    return revision;
  }
  if (held.some((period) => period.key === span.key && period.status === 'issued')) throw new FieldRefused('This period is already issued. A correction is a revision kept beside it.');
  const waiting = valuesWaiting(sheet.values);
  if (waiting) throw new FieldRefused(`${waiting} ${waiting === 1 ? 'value waits' : 'values wait'} on it for a person. Accept or set ${waiting === 1 ? 'it' : 'them'} aside first.`);
  const reading = readSheet(project, setId, undefined, undefined, catalog, at);
  if (!reading || !reading.fields.some((view) => !isBlank(view.held))) throw new FieldRefused(`${set.title} holds nothing to issue yet.`);
  const period: FieldPeriod = {
    key: span.key,
    from: span.from,
    to: span.to,
    status: 'issued',
    values: copyValues(sheet.values),
    frozen: freezeReading(project, reading),
    openedAt: sheet.open?.openedAt ?? stamp,
    openedBy: sheet.open?.openedBy ?? issuer.actor,
    issuedAt: stamp,
    issuedBy: issuer.actor,
    ...(name ? { issuedName: name } : {}),
    ...(sheet.open?.reasons ? { reasons: { ...sheet.open.reasons } } : {}),
  };
  sheet.periods = [...held, period];
  // The sheet goes on as the next period's: what the set carries stays, said to be carried, and the rest opens blank.
  const carry = new Set(set.periodic.carry ?? []);
  const carried: string[] = [];
  for (const def of set.fields) {
    if (fieldIsDerived(def) || !(def.key in sheet.values)) continue;
    if (carry.has(def.key)) {
      if (!isBlank(standingField(sheet.values[def.key]))) carried.push(def.key);
    } else stand(sheet.values, def.key, null, { at: stamp, by: issuer.actor });
  }
  sheet.open = { key: periodShift(span, 1).key, openedAt: stamp, openedBy: issuer.actor, ...(carried.length ? { carried: { from: span.key, keys: carried } } : {}) };
  project.updatedAt = stamp;
  project.historyFrom ??= stamp;
  recordAuditEvent(project, { actor: issuer.actor, action: 'issue_period', entityType: 'field_set', entityId: `${setId}::${span.key}`, newValue: `${set.title}, ${span.label}`, at: stamp });
  return period;
}

/**
 * Opens a revision of an issued period of a sheet beside it: a copy of what
 * the issue held of typed values, to be corrected (`setFieldValues` with the
 * period named) and issued in its turn. The issue stays as it was, and is
 * what a reading as at that period goes on showing until then. A lead's or a
 * signer's act; where a revision is open already it is handed back.
 */
export function reviseSheetPeriod(project: DdProject, setId: string, key: string, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): FieldPeriod {
  const set = snapshotSet(project, setId, catalog);
  const department = departmentOfFunction(set.fn);
  if (options.mayDecide && !(department && options.mayDecide(department))) throw new FieldRefused(`A revision of ${set.title} is opened by a lead or a signer of the department.`);
  const sheet = sheetOf(project, setId);
  const of = (sheet?.periods ?? []).filter((period) => period.key === key);
  const open = of.find((period) => period.status === 'open');
  if (open) return open;
  const issued = of.filter((period) => period.status === 'issued').at(-1);
  if (!sheet || !issued) throw new FieldRefused('Only an issued period is revised.');
  const at = new Date().toISOString();
  const revision: FieldPeriod = { key: issued.key, from: issued.from, to: issued.to, status: 'open', values: copyValues(issued.values), openedAt: at, openedBy: actor, revises: issued.issuedAt!, ...(issued.reasons ? { reasons: { ...issued.reasons } } : {}) };
  sheet.periods = [...(sheet.periods ?? []), revision];
  project.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'revise_period', entityType: 'field_set', entityId: `${setId}::${key}`, oldValue: issued.issuedAt, newValue: set.title, at });
  return revision;
}

/** The values of a period that stands, as a comparison takes them: each frozen field as a value. */
function frozenValues(period: FieldPeriod): Record<string, CheckFieldValue> {
  return Object.fromEntries(Object.entries(period.frozen ?? {}).flatMap(([key, field]) => (field.value === null || field.value === '' ? [] : [[key, { value: field.value, at: period.issuedAt ?? '', by: period.issuedBy ?? '' } as CheckFieldValue]])));
}

/**
 * A sheet's period beside the one before it. With no period named, the sheet
 * as it reads now beside the last period issued; with one, that issue beside
 * the one issued before it.
 */
export function compareSheetPeriods(project: DdProject, setId: string, key?: string, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): PeriodComparison | undefined {
  const set = snapshotSet(project, setId, catalog);
  const sheet = sheetOf(project, setId);
  const all = sheetPeriods(project, set, at);
  const standing = periodsStanding(all).filter((instance) => instance.status === 'issued');
  const stored = (instance: PeriodInstance | undefined) => (instance ? (sheet?.periods ?? []).find((period) => period.key === instance.period.key && period.issuedAt === instance.issued?.at) : undefined);
  const resolution = resolveFields(project, at, catalog);
  const outside: FormulaOutside = { read: (address) => resolution.read(address), records: (id) => resolution.records(id), today: at };
  if (key) {
    const current = standing.find((instance) => instance.period.key === key);
    const held = stored(current);
    if (!current || !held) return undefined;
    const previous = standing.find((instance) => instance.period.from < current.period.from);
    return compareHolders(set, { current, previous, now: frozenValues(held), was: stored(previous) ? frozenValues(stored(previous)!) : {}, picked: held.reasons, outside }, catalog);
  }
  const previous = standing[0];
  const span = sheet?.open?.key ? periodOfKey(sheet.open.key) : undefined;
  const period = span ?? periodOfDay(set.periodic.every, indiaToday(at), periodsNumbered(project))!;
  const current: PeriodInstance = { set: setId, id: period.key, period, status: 'open', late: false, filled: 0, total: 0 };
  return compareHolders(set, { current, previous, now: resolution.holder(setId), was: stored(previous) ? frozenValues(stored(previous)!) : {}, picked: sheet?.open?.reasons, outside }, catalog);
}

/** Picks why a figure of the open sheet moved beyond what its rows explain, from the set's list, or with `null` takes the pick back. */
export function setSheetPeriodReason(project: DdProject, setId: string, field: string, reason: string | null, actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): void {
  const set = snapshotSet(project, setId, catalog);
  const department = departmentOfFunction(set.fn);
  if (options.mayEdit && !(department && options.mayEdit(department))) throw new FieldRefused('Your role on this project reads this department and does not change it.');
  const sheet = sheetOf(project, setId);
  if (!sheet) throw new FieldRefused('Nothing of that figure is unexplained.');
  const next = { ...(sheet.open?.reasons ?? {}) };
  if (reason === null) delete next[field];
  else {
    const list = set.periodic.reasons ? optionSetById(set.periodic.reasons, catalog) : undefined;
    if (!list?.options.some((option) => option.key === reason && !option.retired)) throw new FieldRefused('Pick one of the reasons on the list.');
    if (!compareSheetPeriods(project, setId, undefined, new Date(), catalog)?.fields.find((held) => held.key === field)?.unexplained) throw new FieldRefused('Nothing of that figure is unexplained.');
    next[field] = reason;
  }
  const at = new Date().toISOString();
  const open = sheet.open ?? { key: periodOfDay(set.periodic.every, indiaToday(new Date()), periodsNumbered(project))!.key, openedAt: at, openedBy: actor };
  const { reasons: _was, ...rest } = open;
  sheet.open = { ...rest, ...(Object.keys(next).length ? { reasons: next } : {}) };
  recordAuditEvent(project, { actor, action: 'set_period_reason', entityType: 'field_set', entityId: setId, newValue: reason ? `${field}: ${reason}` : field, at });
}

/* ==================================================================== */
/* The Cost Report, read as periods                                      */
/* ==================================================================== */

/** The id the Cost Report's months are asked for by, where a set's periods are asked for. It is no field set. */
export const COST_REPORT_PERIODS = 'finance.budget.cost_report';
/** How the Cost Report is kept, as a set kept by period says it: by the month, closed a week after it ends, issued by a lead or signer of Finance. */
export const COST_REPORT_PERIODIC: Periodic = { every: 'month', due: { days: 7 }, issuer: 'lead' };
/** The figures of a Cost Report a series may be asked for. */
export const COST_REPORT_SERIES = ['budget', 'poIssued', 'amountPaid', 'anticipatedCost'] as const;

/** Every Cost Report as an instance of a period, the latest first: read only. The module that keeps them is `cost-report.ts`. */
export function costReportPeriods(project: Pick<DdProject, 'costReports'>, at: Date = new Date()): PeriodInstance[] {
  const today = indiaToday(at);
  return [...costReportsOf(project)]
    .sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt))
    .map((report) => {
      const month = periodOfDay('month', report.from)!;
      const whole = month.from === report.from && month.to === report.to;
      const period: PeriodSpan = whole ? month : { key: `${report.from}..${report.to}`, from: report.from, to: report.to, label: report.label, short: report.label };
      const due = dayAfter(report.to, (COST_REPORT_PERIODIC.due as { days: number }).days);
      return {
        set: COST_REPORT_PERIODS,
        id: period.key,
        period,
        status: report.status === 'draft' ? ('open' as const) : ('issued' as const),
        record: report.id,
        ...(report.issuedAt ? { issued: { by: report.issuedBy ?? '', at: report.issuedAt } } : {}),
        ...(report.revises ? { revises: report.revises } : {}),
        ...(report.status === 'superseded' ? { superseded: true as const } : {}),
        due,
        late: report.issuedAt ? indiaToday(new Date(report.issuedAt)) > due : today > due,
        filled: report.rows.length,
        total: report.rows.length,
      };
    });
}

/** What the Cost Report asks for on a day, as any set kept by period does: once a first month is kept, the latest month that has ended with no report issued. */
export function costReportDue(project: Pick<DdProject, 'costReports'>, at: Date = new Date()): PeriodDue | undefined {
  const kept = costReportPeriods(project, at);
  if (!kept.length) return undefined;
  const ended = periodShift(periodOfDay('month', indiaToday(at))!, -1);
  if (ended.from < kept[kept.length - 1]!.period.from) return undefined;
  const of = kept.filter((instance) => instance.period.from <= ended.to && instance.period.to >= ended.from);
  if (of.some((instance) => instance.status === 'issued')) return undefined;
  const open = of.find((instance) => instance.status === 'open');
  const due = dayAfter(ended.to, (COST_REPORT_PERIODIC.due as { days: number }).days);
  const late = indiaToday(at) > due;
  const packages = open?.total ?? 0;
  return {
    fn: 'finance.budget',
    set: COST_REPORT_PERIODS,
    title: 'Cost Report',
    period: ended,
    ...(open?.record ? { record: open.record } : {}),
    state: open ? 'open' : 'not_started',
    filled: packages,
    total: packages,
    due,
    late,
    said: `${ended.short}: ${open ? `a draft of ${packages} ${packages === 1 ? 'package' : 'packages'}, not issued` : 'not started'}, ${late ? 'was due' : 'due'} ${dueDay(due)}`,
  };
}

const dueDay = (day: string): string => formatFieldValue({ key: 'due', label: 'Due', kind: 'date' }, { value: day, at: '', by: '' });

/* ==================================================================== */
/* A figure over periods                                                 */
/* ==================================================================== */

/** One period's reading of a figure. */
export interface PeriodPoint {
  period: PeriodSpan;
  value: number | null;
  /** As the field prints it. */
  said: string;
  /** Issued, or the period still open. */
  status: 'issued' | 'open';
}

const reportFigure = (report: CostReportPeriod, field: string): number | null => {
  const totals = costReportTotals(report) as unknown as Record<string, number>;
  return typeof totals[field] === 'number' ? totals[field]! : null;
};

/**
 * One field's figure period by period, oldest first: a sheet's issues and
 * then the sheet as it reads now, a records set's instances, or a figure of
 * the Cost Report's months. Only what stands is read: an issue a revision
 * replaced is left out. `last` keeps the latest so many.
 */
export function periodSeries(project: DdProject, address: Pick<FieldAddress, 'set' | 'field'>, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project), last?: number): PeriodPoint[] {
  const cut = (points: PeriodPoint[]): PeriodPoint[] => (last && points.length > last ? points.slice(-last) : points);
  if (address.set === COST_REPORT_PERIODS) {
    const money = (amount: number | null): string => (amount === null ? '—' : formatFieldValue({ key: address.field, label: address.field, kind: 'money', currency: 'INR' }, { value: amount, at: '', by: '' }));
    return cut(
      periodsStanding(costReportPeriods(project, at))
        .filter((instance) => instance.status === 'issued')
        .reverse()
        .map((instance) => {
          const value = reportFigure(costReportsOf(project).find((report) => report.id === instance.record)!, address.field);
          return { period: instance.period, value, said: money(value), status: 'issued' as const };
        }),
    );
  }
  const set = catalog.sets.get(address.set);
  const def = set?.fields.find((field) => field.key === address.field);
  if (!set?.periodic || !def) return [];
  const lists = (id: string) => optionSetById(id, catalog);
  const point = (period: PeriodSpan, value: CheckFieldValue | undefined, status: PeriodPoint['status']): PeriodPoint => ({ period, value: fieldNumber(value), said: formatFieldValue(def, value, lists), status });
  if (set.records) {
    const resolution = resolveFields(project, at, catalog);
    const byPeriod = new Map<string, PeriodPoint>();
    for (const instance of periodsStanding(periodsOf(project, set.id, at, catalog)).reverse()) {
      const value = resolution.holder(set.id, instance.record)[def.key];
      const held = byPeriod.get(instance.period.key);
      const n = fieldNumber(value);
      // Several instances in one period (a certificate for each building) come to one point: their sum.
      if (held && held.value !== null && n !== null) byPeriod.set(instance.period.key, point(instance.period, { value: held.value + n, at: '', by: '' }, instance.status === 'issued' && held.status === 'issued' ? 'issued' : 'open'));
      else if (!held) byPeriod.set(instance.period.key, point(instance.period, value, instance.status));
    }
    return cut([...byPeriod.values()]);
  }
  const sheet = sheetOf(project, set.id);
  const issued = periodsStanding(sheetPeriods(project, set, at))
    .filter((instance) => instance.status === 'issued')
    .reverse()
    .flatMap((instance) => {
      const held = (sheet?.periods ?? []).find((period) => period.key === instance.period.key && period.issuedAt === instance.issued?.at);
      const frozen = held?.frozen?.[def.key];
      return held ? [{ period: instance.period, value: frozen && typeof frozen.value === 'number' ? frozen.value : null, said: frozen?.said ?? '—', status: 'issued' as const }] : [];
    });
  // The sheet as it reads now is the open period: the one after the last issued, or today's where none is.
  const open = sheet?.open?.key ? periodOfKey(sheet.open.key) : undefined;
  const now = typeof set.periodic.every === 'object' ? undefined : (open ?? periodOfDay(set.periodic.every, indiaToday(at), periodsNumbered(project)));
  const live = resolveFields(project, at, catalog).read({ fn: set.fn, set: set.id, field: def.key });
  return cut([...issued, ...(now && !isBlank(live) && !issued.some((held) => held.period.key === now.key) ? [point(now, live, 'open')] : [])]);
}
