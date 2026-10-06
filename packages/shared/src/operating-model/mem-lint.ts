/**
 * What looks wrong in a project's memory.
 *
 * A reading of memory against itself and against the record, that lists
 * what a person should look at. Seven things:
 *
 * - two approved facts that say different things of the same thing;
 * - a value that waits and differs from the approved one for the same thing;
 * - an approved fact memory still holds that the record no longer gives;
 * - memory behind the record: facts that differ, events not yet told;
 * - a fact or a note about a record the project no longer holds;
 * - an approved value on the project or a check with no paper behind it;
 * - a value that has waited too long for somebody to decide it.
 *
 * Two facts are of the same thing when they have the same key and share
 * what they are about or what states them. A value recorded on a check from
 * a paper has the paper's key and names the paper as its source, so it is
 * held against that paper's own value, and a value waiting on a card is held
 * against the field it would fill.
 *
 * Lint proposes and never fixes. It changes nothing in memory and nothing
 * on the record: a finding is a line for a person, with the ids it is about.
 * Pure, so the same memory and the same record give the same list.
 */

import { memoryDelta, memPointer, type MemWatermark } from './mem-delta';
import { memFactRev, memoryFacts, type MemFact } from './mem-facts';
import { projectRecordIds } from './project-view';
import { revenueReads } from './revenue-map';
import type { DdProject } from './types';

/** The kinds of finding, the gravest first: the order a list is given in. */
export const MEM_LINT_KINDS = ['approved_disagree', 'proposal_contradicts', 'dropped_by_record', 'behind_record', 'about_nothing', 'no_source', 'waiting_too_long'] as const;

export type MemLintKind = (typeof MEM_LINT_KINDS)[number];

export interface MemLintFinding {
  kind: MemLintKind;
  /** What looks wrong, in one sentence made here from the facts' own labels, values and dates. */
  says: string;
  /** The facts it is about, by their ids in memory. */
  factIds: string[];
  /** The record they are about, where the finding is about one. */
  aboutId?: string;
}

/** How long a value may wait for a decision before it is listed. */
export const MEM_WAITS_TOO_LONG_DAYS = 14;

/** How many findings one reading lists, at most. */
export const MEM_LINT_AT_MOST = 200;

/** Whether two values say the same: numbers within the one part in a thousand a change of unit rounds off, words whatever their case. */
function sameValue(a: MemFact['value'], b: MemFact['value']): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.001;
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/** Whether two facts under one key are of the same thing: they share what they are about, or what states them. */
function sameThing(a: MemFact, b: MemFact): boolean {
  return a.aboutId === b.aboutId || a.source === b.source || a.aboutId === b.source || a.source === b.aboutId;
}

const shown = (fact: MemFact): string => fact.display ?? `${String(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`;

/** The project's own fields a paper is expected to stand behind. Its name, its stage and its budget are the firm's own word. */
const PAPER_EXPECTED = new Set(['land_area', 'built_up_area', 'saleable_area', 'parcel', 'site_address', 'project_owner', 'developer', 'tenure']);

/** What memory holds, as lint reads it. */
export interface MemHeld {
  /** Every fact memory holds for the project, the assistant's notes among them. */
  held: readonly MemFact[];
  /** Where memory says it stands. Absent when it has never been told. */
  stands?: MemWatermark;
}

/**
 * What looks wrong, the gravest kind first. `now` is the day the waiting is
 * counted to.
 */
export function memLint(project: DdProject, memory: MemHeld, now: string): MemLintFinding[] {
  const found: MemLintFinding[] = [];
  const add = (kind: MemLintKind, says: string, facts: readonly MemFact[], aboutId?: string): void => {
    found.push({ kind, says, factIds: facts.map((fact) => fact.id), ...(aboutId ? { aboutId } : {}) });
  };
  const told = memory.held.filter((fact) => fact.tag !== 'thought');
  const approved = told.filter((fact) => fact.tag === 'approved');
  const waiting = told.filter((fact) => fact.tag === 'proposed');

  // Two approved facts, and a waiting one against an approved one, of the same thing under the same key.
  const byKey = new Map<string, MemFact[]>();
  for (const fact of approved) byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact]);
  for (const [, facts] of byKey) {
    for (let i = 0; i < facts.length; i += 1) {
      for (let j = i + 1; j < facts.length; j += 1) {
        const [a, b] = [facts[i]!, facts[j]!];
        if (sameThing(a, b) && !sameValue(a.value, b.value)) add('approved_disagree', `Two approved values for ${a.label} differ: ${shown(a)} and ${shown(b)}.`, [a, b], a.aboutId);
      }
    }
  }
  for (const fact of waiting) {
    const against = (byKey.get(fact.key) ?? []).find((other) => sameThing(fact, other) && !sameValue(fact.value, other.value));
    if (against) add('proposal_contradicts', `A waiting value for ${fact.label} (${shown(fact)}) differs from the approved one (${shown(against)}).`, [fact, against], against.aboutId);
  }

  // Memory against the record as it stands.
  const given = memoryFacts(project).held;
  const record = new Map(given.map((fact) => [fact.id, fact]));
  for (const fact of approved) {
    if (record.get(fact.id)?.tag !== 'approved') add('dropped_by_record', `Memory holds ${fact.label} (${shown(fact)}) as approved, and the record no longer gives it.`, [fact], fact.aboutId);
  }
  const mine = new Map(told.map((fact) => [fact.id, memFactRev(fact)]));
  const differing = given.filter((fact) => mine.get(fact.id) !== memFactRev(fact)).length + told.filter((fact) => !record.has(fact.id)).length;
  const delta = memoryDelta(project, memory.stands ?? {});
  const untold = delta.standsDown ? 0 : delta.entries.length;
  if (delta.standsDown === 'behind') add('behind_record', 'Memory names an event this copy of the record does not hold.', []);
  else if (differing || untold) {
    const parts = [...(differing ? [`${differing} fact${differing === 1 ? '' : 's'} differ`] : []), ...(untold ? [`${untold} event${untold === 1 ? ' is' : 's are'} not told yet`] : [])];
    add('behind_record', `Memory is behind the record: ${parts.join(' and ')}.`, []);
  }

  // A fact or a note about something the project no longer holds.
  const onRecord = new Set([...projectRecordIds(project), ...revenueReads(project).map((read) => read.parcelRef)].flatMap((id) => memPointer(project.id, id) ?? []));
  for (const fact of memory.held) {
    if (!onRecord.has(fact.aboutId)) add('about_nothing', `${fact.tag === 'thought' ? 'A note' : fact.label} is about a record the project no longer holds.`, [fact], fact.aboutId);
  }

  // An approved value with nothing but itself behind it, where a paper is expected to be.
  const checks = new Set(project.assessments.flatMap((assessment) => assessment.scopes.flatMap((scope) => scope.checks.map((check) => check.id))));
  for (const fact of approved) {
    if (fact.source !== fact.aboutId) continue;
    const onProject = fact.aboutId === project.id && PAPER_EXPECTED.has(fact.key);
    const onCheck = checks.has(fact.aboutId) && fact.key !== 'check_result';
    if (onProject || onCheck) add('no_source', `${fact.label} (${shown(fact)}) is approved with no paper behind it.`, [fact], fact.aboutId);
  }

  // A value nobody has decided for too long.
  const today = Date.parse(now);
  for (const fact of waiting) {
    const days = Math.floor((today - Date.parse(fact.recordedAt)) / 86_400_000);
    if (days >= MEM_WAITS_TOO_LONG_DAYS) add('waiting_too_long', `${fact.label} (${shown(fact)}) has waited ${days} days for a decision.`, [fact], fact.aboutId);
  }

  return found.sort((a, b) => MEM_LINT_KINDS.indexOf(a.kind) - MEM_LINT_KINDS.indexOf(b.kind)).slice(0, MEM_LINT_AT_MOST);
}

const KIND_WORDS: Record<MemLintKind, [one: string, many: string]> = {
  approved_disagree: ['pair of approved values that differ', 'pairs of approved values that differ'],
  proposal_contradicts: ['waiting value that differs from an approved one', 'waiting values that differ from approved ones'],
  dropped_by_record: ['approved fact the record no longer gives', 'approved facts the record no longer gives'],
  behind_record: ['sign that memory is behind the record', 'signs that memory is behind the record'],
  about_nothing: ['fact about a record that is gone', 'facts about records that are gone'],
  no_source: ['approved value with no paper behind it', 'approved values with no paper behind them'],
  waiting_too_long: [`value waiting ${MEM_WAITS_TOO_LONG_DAYS} days or more`, `values waiting ${MEM_WAITS_TOO_LONG_DAYS} days or more`],
};

/** The findings in one line, for the chat: how many of each kind, and the first of them in words. */
export function memLintLine(findings: readonly MemLintFinding[]): string {
  if (!findings.length) return 'Nothing looks wrong in this project’s memory.';
  const counted = MEM_LINT_KINDS.flatMap((kind) => {
    const n = findings.filter((finding) => finding.kind === kind).length;
    return n ? [`${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`] : [];
  });
  return `In this project’s memory, ${findings.length === 1 ? 'one thing looks' : `${findings.length} things look`} wrong: ${counted.join(', ')}. The first: ${findings[0]!.says}`;
}

/** Whether a question asks what looks wrong in memory. */
export function memAsksForLint(question: string): boolean {
  const q = question.toLowerCase();
  if (!/\bmemory\b/.test(q)) return false;
  return /\b(looks?|seems?|is|anything|what(?:'s| is)?)\b[^.?!]*\b(wrong|off|stale|inconsistent)\b|\blint\b|\bcheck (?:the |this project(?:'s|’s) )?memory\b/.test(q);
}
