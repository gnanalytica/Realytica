/**
 * The project as it stood on a past day.
 *
 * `projectAsAt(project, day)` is a reading, never a copy that is saved: the
 * same project with every part that keeps its own past turned back to what
 * it was when that day ended in India. `resolveFields` over the reading then
 * gives every formula, standing and figure as at that day with no change to
 * the formula engine.
 *
 * What is turned back, and how:
 *
 * - **A field** is what stood then (`fieldAsAt`): the value it holds now
 *   where that had begun to stand, else the entry of its history.
 * - **A record** is there where it had been made by then and not yet taken
 *   off its list, and is issued only where it had been issued by then.
 * - **A sheet kept by period** reads the period issued for the day where one
 *   is: every field as it was frozen at issue. An issued period wins over
 *   anything worked out afresh.
 * - **A milestone** is at the percent last reported on or before the day.
 * - **The site log** is its entries up to the day.
 * - **Cost Reports** are those issued by then.
 *
 * What keeps no past is left as it is, and says so: a value the record's
 * history does not reach carries `asNow` with the day its history begins, and
 * so does whatever is worked out from it. Nothing is made up for a day the
 * record does not hold.
 */

import { fieldState, isBlank } from './check-fields';
import type { CostReportPeriod } from './cost-report';
import { fieldAsAt, indiaDayEnd } from './field-history';
import { progressReadings } from './milestone-schedule';
import type { Milestone } from './progress';
import type { CheckFieldValue, DdProject, FieldPeriod, FieldRecord, StoredFieldSheet } from './types';

/** The last moment of a day in India: what "as at 30 September" is read at. */
export function asAtMoment(day: string): Date {
  return new Date(indiaDayEnd(day) - 1);
}

/** Whether a day is one a reading can be made as at: a calendar day that has ended in India. */
export function isPastDay(day: string, now: Date = new Date()): boolean {
  const end = indiaDayEnd(day);
  return !Number.isNaN(end) && end <= now.getTime();
}

/** One holder's values as they stood when the day ended. */
function valuesAsAt(values: Record<string, CheckFieldValue>, day: string, wholeFrom: string | undefined): Record<string, CheckFieldValue> {
  const out: Record<string, CheckFieldValue> = {};
  for (const [key, value] of Object.entries(values)) {
    const then = fieldAsAt(value, day, wholeFrom);
    if (then.how === 'now') out[key] = value;
    else if (then.how === 'past' && then.value) out[key] = then.value;
    // The record does not reach the day: today's value, said to be as now. A value that only waits today stood for nothing then.
    else if (then.how === 'as_now' && then.value && !isBlank(then.value) && fieldState(then.value) !== 'not_applicable') out[key] = { ...then.value, asNow: then.since! };
    else if (then.how === 'as_now' && then.value) out[key] = then.value;
  }
  return out;
}

/** The issue of a sheet's period that covers a day: the last issued of the periods the day falls in. */
export function periodIssuedFor(sheet: Pick<StoredFieldSheet, 'periods'>, day: string): FieldPeriod | undefined {
  return (sheet.periods ?? [])
    .filter((period) => period.status === 'issued' && period.from <= day && period.to >= day)
    .sort((a, b) => (a.issuedAt ?? '').localeCompare(b.issuedAt ?? ''))
    .at(-1);
}

function sheetAsAt(sheet: StoredFieldSheet, day: string, end: number, wholeFrom: string | undefined): StoredFieldSheet {
  const issued = periodIssuedFor(sheet, day);
  const records = sheet.records?.flatMap((record): FieldRecord[] => {
    // Made after the day: it was not there. Taken off after it: it still was.
    if (Date.parse(record.createdAt) >= end) return [];
    if (record.removed && Date.parse(record.removed.at) < end) return [record];
    const { removed: _removed, issued: wasIssued, frozen, ...rest } = record;
    const issuedThen = wasIssued && Date.parse(wasIssued.at) < end;
    // An issued record reads as it was issued. Issued since, it was still open then: its fields are what stood.
    return [{ ...rest, values: issuedThen ? record.values : valuesAsAt(record.values, day, wholeFrom), ...(issuedThen ? { issued: wasIssued, ...(frozen ? { frozen } : {}) } : {}) }];
  });
  return {
    ...sheet,
    // An issued period that covers the day is what the sheet held: its stored values, and every field as frozen.
    values: issued ? issued.values : valuesAsAt(sheet.values, day, wholeFrom),
    ...(records ? { records } : {}),
    ...(issued ? { asIssued: { key: issued.key, ...(issued.frozen ? { frozen: issued.frozen } : {}), ...(issued.issuedAt ? { issuedAt: issued.issuedAt } : {}), ...(issued.issuedBy ? { issuedBy: issued.issuedBy } : {}), ...(issued.issuedName ? { issuedName: issued.issuedName } : {}) } } : {}),
  };
}

/** A milestone at the percent last reported on or before a day. One with nothing ever reported of it is left as it is. */
function milestoneAsAt(project: Pick<DdProject, 'siteLog'>, milestone: Milestone, day: string): Milestone {
  const readings = progressReadings(project, milestone);
  if (!readings.length) return milestone;
  const then = readings.filter((reading) => reading.on <= day);
  const percent = then.at(-1)?.percent ?? 0;
  const { completedOn, ...rest } = milestone;
  const done = percent >= 100 ? (then.find((reading) => reading.percent >= 100)?.on ?? completedOn) : undefined;
  return { ...rest, percent, readings: (milestone.readings ?? []).filter((reading) => reading.on <= day), ...(done ? { completedOn: done } : {}) };
}

/** The Cost Reports issued by a moment, each standing as it stood then: one a revision has replaced since was still the issued one. */
function costReportsAsAt(reports: readonly CostReportPeriod[], end: number): CostReportPeriod[] {
  const issuedBy = (report: CostReportPeriod): boolean => report.issuedAt !== undefined && Date.parse(report.issuedAt) < end;
  return reports.filter(issuedBy).map((report) => {
    const replaced = reports.some((other) => other.revises === report.id && issuedBy(other));
    const status = replaced ? ('superseded' as const) : ('issued' as const);
    return report.status === status ? report : { ...report, status };
  });
}

/**
 * The project as it stood when a day ended in India. A reading: it shares
 * what it does not turn back with the project, and is never saved.
 */
export function projectAsAt(project: DdProject, day: string): DdProject {
  const end = indiaDayEnd(day);
  if (Number.isNaN(end)) return project;
  const wholeFrom = project.historyFrom;
  const log = (project.siteLog ?? []).filter((entry) => entry.date <= day);
  return {
    ...project,
    asAt: day,
    ...(project.fieldSheets ? { fieldSheets: Object.fromEntries(Object.entries(project.fieldSheets).map(([id, sheet]) => [id, sheetAsAt(sheet, day, end, wholeFrom)])) } : {}),
    assessments: project.assessments.map((assessment) => ({
      ...assessment,
      scopes: assessment.scopes.map((scope) => ({ ...scope, checks: scope.checks.map((check) => (check.fields ? { ...check, fields: valuesAsAt(check.fields, day, wholeFrom) } : check)) })),
    })),
    // What waits on a card today waited on nothing then.
    chatProposals: [],
    ...(project.siteLog ? { siteLog: log } : {}),
    ...(project.milestones ? { milestones: project.milestones.map((milestone) => milestoneAsAt({ siteLog: log }, milestone, day)) } : {}),
    ...(project.costReports ? { costReports: costReportsAsAt(project.costReports, end) } : {}),
  };
}
