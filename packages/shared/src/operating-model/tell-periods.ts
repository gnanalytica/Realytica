/**
 * Telling people a period is due.
 *
 * A set kept by period asks for one thing: its latest period that has ended
 * and is not issued (`periodsDue`). The page says so to whoever opens it.
 * This says so to the people whose it is to issue, without anybody opening
 * the page and without a report day being set: once for a period, for each
 * person, as a notice like any other (`tell.ts`), which the existing
 * messages then carry.
 *
 * Who is told: whoever issues the set (a lead or signer of the function's
 * department, or its signer alone where the set says so; where an outside
 * party signs the paper, the lead or signer who records it), and whoever
 * opened the period that is due. Only the firm's own people: somebody
 * working from a grant issues nothing, and is told of no period.
 *
 * Safe to run twice: a notice is held by its set, its period and the person
 * it is for, so a second run writes nothing. A period issued late, then
 * revised, is not told of again.
 */

import { departmentOfFunction } from './field-sheets';
import { periodOpenedBy, periodsDue, type PeriodDue } from './field-periods';
import { fieldCatalogFor } from './firm-fields';
import { COST_REPORT_PERIODIC, COST_REPORT_PERIODS } from './sheet-periods';
import { roleCanDecide } from './departments';
import { departmentRole } from './team';
import type { TellNotice, TellPerson, TellState } from './tell';
import type { DdProject } from './types';

const fold = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** The notice a period that is due is held by, for one person. */
const noticeId = (due: PeriodDue, to: string): string => `period_due:${due.set}:${due.period.key}:${to}`;

/** Who is told a period is due, by address: its issuers and whoever opened it, among the firm's own people. */
export function periodDuePeople(project: DdProject, due: PeriodDue, people: readonly TellPerson[]): string[] {
  const department = departmentOfFunction(due.fn);
  const issuer = due.set === COST_REPORT_PERIODS ? COST_REPORT_PERIODIC.issuer : (fieldCatalogFor(project).sets.get(due.set)?.periodic?.issuer ?? 'lead');
  // Named on the set: whoever opened the period that is due.
  const opened = fold(periodOpenedBy(project, due));
  const out = new Set<string>();
  for (const person of people) {
    // Somebody working from a grant issues nothing.
    if (person.copy || person.workspaceRole === 'collaborator') continue;
    const email = fold(person.email);
    const role = department ? departmentRole(project, { email: person.email, ...(person.workspaceRole ? { workspaceRole: person.workspaceRole } : {}) }, department) : undefined;
    if ((issuer === 'signer' ? role === 'signer' : roleCanDecide(role)) || (opened && opened === email)) out.add(email);
  }
  return [...out];
}

/**
 * Write a notice for each period that is due and each person whose it is,
 * where none is held yet. Returns the notices written now.
 */
export function gatherPeriodsDue(project: DdProject, people: readonly TellPerson[], now = new Date()): TellNotice[] {
  const dues = periodsDue(project, now);
  if (!dues.length) return [];
  const state: TellState = project.tell ?? {};
  const held = state.notices ?? [];
  const have = new Set(held.map((notice) => notice.id));
  const quiet = new Set((state.quiet ?? []).map(fold));
  const written: TellNotice[] = [];
  for (const due of dues) {
    const department = departmentOfFunction(due.fn);
    for (const to of periodDuePeople(project, due, people)) {
      const id = noticeId(due, to);
      if (have.has(id)) continue;
      have.add(id);
      const notice: TellNotice = {
        id,
        to,
        at: now.toISOString(),
        kind: 'period_due',
        by: 'Realytica',
        why: [{ because: 'decides', ...(department ? { department } : {}) }],
        workstream: due.fn,
        setId: due.set,
        period: due.period.key,
        // One line for the set, put together by code: "Cash by month, September: 4 of 9 fields, was due 7 Oct 2026".
        now: `${due.title}, ${due.said}`,
        ...(quiet.has(to) ? { batchedAt: now.toISOString(), quieted: true as const } : {}),
      };
      held.push(notice);
      written.push(notice);
    }
  }
  if (written.length) project.tell = { ...state, notices: held };
  return written;
}
