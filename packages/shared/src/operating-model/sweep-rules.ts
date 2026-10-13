/**
 * The four things the daily review finds by rule.
 *
 * Each is the field system's own kind of rule, run across the record in
 * place of inside one sheet, and each says what it found in a template's
 * words (`sweepSaid` in `file-sweep.ts`). No model is asked.
 *
 * - `papers_disagree` is a **compare** over a field two papers both state:
 *   a field of the catalog that takes its value from a paper's reading
 *   (`fromTypes`, `factKey`, or a check's field under its own key), where two
 *   papers on the file give it differently and at least one of them stands.
 * - `date_impossible` is a **before** rule: a milestone planned to finish
 *   before it starts, a validity that ends before it begins, an approval
 *   valid until a day before it was issued, work logged on site before the
 *   commencement certificate was issued; and every `before` rule a field
 *   set of the catalog declares, in any department, where the two dates
 *   that stand break it and a paper states one of them.
 * - `approval_missing` is the **row rules** over the approvals register:
 *   a row whose paper is missing (`row_missing`) or whose date has passed
 *   (`row_expired`), for rows that work logged or under way depends on.
 * - `action_unowned` is a **require** rule: an open action whose owner is
 *   empty.
 *
 * What a rule finds rests on the same lines of the record the brief is made
 * of (`sweepDrafts`), under the same ids, so a matter a model raised before
 * this change and one a rule raises now are told to be the same matter by
 * what they are about.
 *
 * Pure. Nothing here changes a project.
 */

import { APPROVAL_STATUS_LABEL, approvalsRegister } from './approvals';
import { dayNumber, isBlank } from './check-fields';
import { addressKey, type FieldCatalog } from './field-registry';
import { departmentOfFunction, fieldRecords, readSheet, resolveFields } from './field-sheets';
import { SHARED_FN } from './field-sets/shared-records';
import { fieldCatalogFor } from './firm-fields';
import { SWEEP_FIRST_LOOK_DAYS, SWEEP_KIND_TABLE, sweepDesk, sweepDrafts, sweepRulesKept, sweepSourceOf, type SweepEntry, type SweepKind, type SweepNext, type SweepProposal } from './file-sweep';
import { memoryFacts, type MemFact } from './mem-facts';
import type { DdProject, FieldAddress, FindingSeverity } from './types';

type Line = Omit<SweepEntry, 'mark'>;

/** How far two figures may differ and still be the same reading: the field system's own default for `compare`. */
export const SWEEP_COMPARE_TOLERANCE_PCT = 1;

/** The approvals work on site depends on: nothing is built without them. */
const WORK_NEEDS: readonly string[] = ['plan_sanction', 'commencement'];

const NOBODY = /^(unassigned|tbc|tbd|none|n\/a|-)?$/i;

const daysApart = (from: string, to: string): number => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);

function found(project: DdProject, kind: SweepKind, lines: readonly Line[], members: Pick<SweepProposal, 'left' | 'right' | 'difference' | 'unit' | 'subjects'>, row?: { severity?: FindingSeverity; next?: SweepNext }): SweepProposal {
  const table = SWEEP_KIND_TABLE[kind];
  return {
    kind,
    by: 'rule',
    ...members,
    department: sweepDesk(project, kind),
    severity: row?.severity ?? table.severity,
    as: table.as,
    next: row?.next ?? table.next,
    sources: lines.map(sweepSourceOf),
  };
}

/* -------------------------------------------------------------------- */
/* compare: two papers, one field                                         */
/* -------------------------------------------------------------------- */

/** The catalog's fields a paper's reading fills, by the key the reading is filed under. Only fields a sheet holds once: a set that repeats keeps each paper's value on a record of its own. */
function fieldsByFactKey(catalog: FieldCatalog): Map<string, FieldAddress> {
  const out = new Map<string, FieldAddress>();
  // Checks and sheets alike: a check's fields are in the catalog under the check's id.
  for (const set of catalog.sets.values()) {
    if (set.records || set.extends) continue;
    const check = catalog.checks.has(set.id);
    for (const def of set.fields) {
      if (def.kind === 'computed' || def.kind === 'status' || def.kind === 'longtext' || def.kind === 'table' || def.kind === 'evidence' || def.sameAs || def.retired) continue;
      // Over the whole catalog a bare key is not enough: thousands of fields share short keys. A check's field is a paper's reading by
      // its key; a sheet's field is one only where it names its papers or the key a reading is filed under.
      if (!check && !def.fromTypes?.length && !def.factKey) continue;
      const key = def.factKey ?? def.key;
      // A field that names its papers before one that only shares a key with a reading.
      if (!out.has(key) || def.fromTypes?.length) out.set(key, { fn: set.fn, set: set.id, field: def.key });
    }
  }
  return out;
}

function sameReading(a: MemFact, b: MemFact): { same: boolean; divergencePct?: number } {
  if (typeof a.value === 'number' && typeof b.value === 'number') {
    if ((a.unit ?? '') !== (b.unit ?? '')) return { same: false };
    const base = Math.max(Math.abs(a.value), Math.abs(b.value));
    const pct = base === 0 ? 0 : (Math.abs(a.value - b.value) / base) * 100;
    return { same: pct <= SWEEP_COMPARE_TOLERANCE_PCT, divergencePct: Math.round(pct * 10) / 10 };
  }
  const flat = (value: MemFact['value']): string => String(value).normalize('NFKC').toLowerCase().replace(/[\s.,;:/\\-]+/g, '');
  return { same: flat(a.value) === flat(b.value) };
}

const readingSaid = (fact: MemFact, paper: string | undefined): string => `${fact.label} ${fact.display ?? `${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`}${paper ? ` (${paper})` : ''}`;

function papersDisagree(project: DdProject, lines: readonly Line[], facts: readonly MemFact[], catalog: FieldCatalog): SweepProposal[] {
  const fields = fieldsByFactKey(catalog);
  const byRef = new Map(lines.map((line) => [line.ref, line]));
  const stated = new Map<string, MemFact[]>();
  for (const fact of facts) {
    // Only what a paper states, and what the brief has a line for.
    if ((fact.tag !== 'approved' && fact.tag !== 'proposed') || !fields.has(fact.key) || !byRef.get(fact.id)?.paper) continue;
    stated.set(fact.key, [...(stated.get(fact.key) ?? []), fact]);
  }
  const out: SweepProposal[] = [];
  for (const [key, readings] of stated) {
    // Set against the value that stands: two readings nobody has accepted are a matter for the paper each waits on.
    const standing = readings.filter((fact) => fact.tag === 'approved');
    for (const first of standing) {
      for (const other of readings) {
        if (other === first || other.source === first.source) continue;
        // Each pair once: two that stand are met from both sides.
        if (other.tag === 'approved' && other.id < first.id) continue;
        const read = sameReading(first, other);
        if (read.same) continue;
        const [a, b] = [byRef.get(first.id)!, byRef.get(other.id)!];
        out.push(
          found(project, 'papers_disagree', [a, b], {
            subjects: [fields.get(key)!],
            left: readingSaid(first, a.paper?.title),
            right: `${other.display ?? String(other.value)}${b.paper ? ` (${b.paper.title}${other.tag === 'proposed' ? ', waiting on a person' : ''})` : ''}`,
            ...(read.divergencePct !== undefined ? { difference: read.divergencePct, unit: '%' } : {}),
          }),
        );
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------- */
/* before: a date that cannot be right given another                      */
/* -------------------------------------------------------------------- */

function datesImpossible(project: DdProject, lines: readonly Line[], facts: readonly MemFact[], now: Date): SweepProposal[] {
  const byRef = new Map(lines.map((line) => [line.ref, line]));
  const out: SweepProposal[] = [];
  const after = (line: Line | undefined, left: string, from: string, right: string, to: string, more: readonly Line[] = []): void => {
    if (!line || from.slice(0, 10) <= to.slice(0, 10)) return;
    out.push(found(project, 'date_impossible', [line, ...more], { left: `${left} (${from.slice(0, 10)})`, right: `${right} (${to.slice(0, 10)})`, difference: daysApart(to, from), unit: 'days' }));
  };

  for (const m of project.milestones ?? []) {
    if (m.plannedStart && m.plannedFinish) after(byRef.get(m.id), `${m.name}: planned start`, m.plannedStart, 'its planned finish', m.plannedFinish);
  }
  for (const fact of facts) {
    if ((fact.tag !== 'approved' && fact.tag !== 'proposed') || !fact.validFrom || !fact.validTo) continue;
    after(byRef.get(fact.id), `${fact.label}: holds from`, fact.validFrom, 'the day it holds to', fact.validTo);
  }
  const register = approvalsRegister(project, now);
  for (const held of register) {
    const paper = held.held[0];
    if (paper?.issuedOn && paper.validUntil) after(byRef.get(`approval:${held.kind.key}`), `${held.kind.label}: issued`, paper.issuedOn, 'the day it is valid until', paper.validUntil);
  }
  // Work logged before the certificate that lets it begin was issued.
  const commencement = register.find((held) => held.kind.key === 'commencement');
  const issued = commencement?.held[0]?.issuedOn;
  const first = [...(project.siteLog ?? [])].sort((a, b) => a.date.localeCompare(b.date))[0];
  const approval = byRef.get('approval:commencement');
  if (commencement && issued && first && approval && first.date.slice(0, 10) < issued) {
    const log = byRef.get(first.id);
    if (log) out.push(found(project, 'date_impossible', [approval, log], { left: `${commencement.kind.label}: issued (${issued})`, right: `the first work logged on site (${first.date.slice(0, 10)})`, difference: daysApart(first.date, issued), unit: 'days' }));
  }
  return out;
}

/**
 * The same rule over every field set the catalog registers: wherever a set
 * declares that one date is not after another (`before`) and the two dates
 * that stand break it. A function's own page already says so to whoever
 * opens it; the review says it to the department, across the record, where
 * a paper on the file states at least one of the two dates.
 */
function fieldDatesImpossible(project: DdProject, lines: readonly Line[], now: Date, catalog: FieldCatalog): SweepProposal[] {
  const dated = [...catalog.sets.values()].filter((set) => !catalog.checks.has(set.id) && set.rules.some((rule) => rule.kind === 'before'));
  if (!dated.length || !Object.keys(project.fieldSheets ?? {}).length) return [];
  const byRef = new Map(lines.map((line) => [line.ref, line]));
  const resolution = resolveFields(project, now, catalog);
  const out: SweepProposal[] = [];
  for (const set of dated) {
    const holders: Array<string | undefined> = set.records ? fieldRecords(project, set.id).map((record) => record.id) : project.fieldSheets?.[set.id] ? [undefined] : [];
    for (const record of holders) {
      const reading = readSheet(project, set.id, record, resolution, catalog, now);
      for (const held of reading?.findings ?? []) {
        const rule = set.rules[held.rule];
        if (rule?.kind !== 'before' || rule.fields.length < 2) continue;
        const sides = rule.fields.slice(0, 2).map((key) => {
          const address: FieldAddress = rule.at?.[key] ?? { fn: set.fn, set: set.id, field: key, ...(record ? { record } : {}) };
          const value = resolution.read(address);
          const def = catalog.sets.get(address.set)?.fields.find((field) => field.key === address.field);
          return { address, def, day: isBlank(value) ? null : String(value!.value).slice(0, 10), line: byRef.get(`${project.id}::fact::field::${addressKey(address)}`) };
        });
        const [first, second] = sides;
        if (!first?.def || !second?.def || !first.day || !second.day || dayNumber(first.day) === null || dayNumber(second.day) === null) continue;
        const cited = sides.flatMap((side) => (side.line ? [side.line] : []));
        if (!cited.length) continue;
        const where = reading!.set.records ? `${set.title}, ${reading!.title}` : set.title;
        out.push({
          ...found(project, 'date_impossible', cited, { subjects: [first.address, second.address], left: `${where}: ${first.def.label} (${first.day})`, right: `${second.def.label} (${second.day})`, difference: daysApart(second.day, first.day), unit: 'days' }, { severity: held.insight.severity }),
          // The department is the function's own, not the review's usual desk for a date.
          ...(set.fn !== SHARED_FN && departmentOfFunction(set.fn) ? { department: departmentOfFunction(set.fn)! } : {}),
        });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------- */
/* row_missing, row_expired: the approvals work depends on                */
/* -------------------------------------------------------------------- */

function approvalsMissing(project: DdProject, lines: readonly Line[], now: Date): SweepProposal[] {
  const byRef = new Map(lines.map((line) => [line.ref, line]));
  const logged = [...(project.siteLog ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const under = (project.milestones ?? []).find((m) => m.percent > 0 && !m.completedOn);
  // The gate: only where work is logged or a milestone is under way. An approval merely due is the register's own alert.
  const work = (logged && byRef.get(logged.id)) ?? (under && byRef.get(under.id));
  if (!work) return [];
  return approvalsRegister(project, now)
    .filter((held) => WORK_NEEDS.includes(held.kind.key) && (held.status === 'missing' || held.status === 'expired' || held.status === 'not_yet_due'))
    .flatMap((held) => {
      const line = byRef.get(`approval:${held.kind.key}`);
      if (!line) return [];
      const lapsed = held.status === 'expired';
      return [found(project, 'approval_missing', [line, work], { left: held.kind.label, right: lapsed ? APPROVAL_STATUS_LABEL.expired.toLowerCase() : 'not on file' }, { next: lapsed ? 'renew_approval' : 'request_paper', severity: 'high' })];
    });
}

/* -------------------------------------------------------------------- */
/* require: an action's owner                                             */
/* -------------------------------------------------------------------- */

function actionsUnowned(project: DdProject, lines: readonly Line[], now: Date): SweepProposal[] {
  const byRef = new Map(lines.map((line) => [line.ref, line]));
  const today = now.toISOString().slice(0, 10);
  return project.actions
    .filter((action) => action.status !== 'closed' && NOBODY.test(action.owner?.trim() ?? ''))
    .flatMap((action) => {
      const line = byRef.get(action.id);
      if (!line?.subject) return [];
      const overdue = Boolean(action.dueDate && action.dueDate.slice(0, 10) < today);
      return [found(project, 'action_unowned', [line], { left: line.subject, right: overdue ? 'nobody is named for it and it is overdue' : 'nobody is named for it' }, overdue ? { severity: 'medium' } : undefined)];
    });
}

/**
 * Everything the four rules find on a project today, the gravest first and
 * no more than a review may raise (`SWEEP_RULES_AT_MOST`). What is already
 * open, accepted or dismissed is left to `sweepRaise` to tell.
 */
export function sweepRuleFindings(project: DdProject, now: Date, catalog: FieldCatalog = fieldCatalogFor(project)): SweepProposal[] {
  const facts = memoryFacts(project).held;
  const since = new Date(now.getTime() - SWEEP_FIRST_LOOK_DAYS * 86_400_000).toISOString();
  const lines = Object.values(sweepDrafts(project, now, since, facts)).flat();
  return sweepRulesKept([...papersDisagree(project, lines, facts, catalog), ...datesImpossible(project, lines, facts, now), ...fieldDatesImpossible(project, lines, now, catalog), ...approvalsMissing(project, lines, now), ...actionsUnowned(project, lines, now)]);
}
