/**
 * Recording a check from chat.
 *
 * Until now the only way to close a check was the tick/cross on the scope
 * pane, so "mark the khata check compliant" opened the check and read its
 * current state back — which looks exactly like having done it. Chat is an
 * input method; refusing to carry a person's own instruction through it was
 * never a safety property, it was a missing command.
 *
 * The authorship law still decides who may conclude, and nothing here bends
 * it: a PERSON saying "mark it compliant" is the person recording a result,
 * so it executes; a MODEL concluding that a check looks compliant is a
 * proposal a person accepts. That is the same split the rest of the cockpit
 * runs on, and it is why this module exposes both an executor and a card.
 *
 * "Started" is deliberately not a result. A check is `pending` until somebody
 * concludes something about it, and the scope moves to `in_progress` on its
 * own the moment any check leaves pending — so there is no state to set, and
 * inventing a ninth `CheckResult` would mean teaching completeness scoring,
 * the scope-status derivation and every report about a state that means "a
 * person is looking at this". What that person usually means is that it is
 * theirs, so the answer offered is an owner, plus the results they might
 * actually have meant.
 */

import { CHECK_RESULT_LABEL } from './catalogs';
import type { ChatChoice, CheckResult, DdProject } from './types';

/* ==================================================================== */
/* The result vocabulary                                                 */
/* ==================================================================== */

/**
 * How people say each result out loud.
 *
 * Ordered, and the order is load-bearing: "not compliant" and "partially
 * compliant" both contain "compliant", so the qualified readings have to be
 * tested first or every one of them records a pass.
 */
const RESULT_PHRASES: Array<{ result: CheckResult; test: RegExp }> = [
  { result: 'not_applicable', test: /\b(not applicable|non[- ]applicable|n\/?a)\b/i },
  { result: 'partially_compliant', test: /\b(partially|partial|part)[- ]?(compliant|comply|ok)?\b/i },
  {
    result: 'non_compliant',
    test: /\b(non[- ]?compliant|not compliant|fail(ed|s|ing)?|cross(ed)?|breach(ed|es)?|in breach|defective|no good)\b/i,
  },
  { result: 'requires_expert_review', test: /\b(expert review|requires? (an? )?(expert|specialist|lawyer|counsel|valuer)|needs? (an? )?(expert|specialist|lawyer|counsel))\b/i },
  { result: 'unable_to_verify', test: /\b(unable to verify|cannot verify|can'?t verify|could not verify|unverifiable|no way to verify)\b/i },
  { result: 'missing_evidence', test: /\b(missing evidence|no evidence|evidence (is )?missing|awaiting evidence|evidence not (on file|received))\b/i },
  { result: 'pending', test: /\b(pending|not started|reset|clear the result|un-?record)\b/i },
  { result: 'compliant', test: /\b(compliant|complies|pass(ed|es)?|tick(ed)?|satisf(ied|actory)|in order|all good|clear(ed)?|ok|okay)\b/i },
];

/** The result a sentence names, or null when it names none of them. */
export function parseCheckResult(text: string): CheckResult | null {
  for (const row of RESULT_PHRASES) {
    if (row.test.test(text)) return row.result;
  }
  return null;
}

/**
 * Does this sentence ask for a check to be recorded at all?
 *
 * Kept separate from `parseCheckResult` so "mark the khata check as started"
 * is recognised as a recording INSTRUCTION whose result word we could not
 * map — which is a question to ask, not a sentence to ignore.
 */
const RECORD_VERB = /\b(mark|set|record|tick|cross|close|complete|conclude|note)\b/i;

/** A quoted phrase names its subject outright — no noun needed. */
const QUOTED = /["“][^"”]{3,}["”]/;

export function looksLikeCheckRecord(text: string): boolean {
  // Either the sentence says "check", or it quotes the thing it means.
  // Requiring the noun meant that the messages this module itself builds —
  // `Mark "Physical boundaries…" as compliant` — did not match their own gate,
  // so picking an option opened the check instead of recording it.
  return RECORD_VERB.test(text) && (/\bcheck\b/i.test(text) || QUOTED.test(text));
}

/**
 * A recording instruction that leans on the check already open — "mark it
 * compliant", "cross this one", "record as missing evidence".
 *
 * Requires a recording verb AND a nameable result, so it cannot swallow
 * "close the drainage action" or "mark the risk accepted"; the caller adds
 * the requirement that a check is actually on screen for "it" to refer to.
 */
export function looksLikeCheckRecordOnSitting(text: string): boolean {
  return RECORD_VERB.test(text) && parseCheckResult(text) !== null;
}

/** "assign the khata check to Priya" / "… to me". */
export function parseCheckOwner(text: string, actor: string): string | null {
  const hit = text.match(/\bassign(?:ed)?\b[^.\n]*?\bto\s+([^.\n,]+)/i);
  if (!hit) return null;
  const who = (hit[1] ?? '').trim();
  if (!who) return null;
  if (/^(me|myself)$/i.test(who)) return actor;
  return who.replace(/\s+/g, ' ').slice(0, 80);
}

export function looksLikeCheckAssign(text: string): boolean {
  return /\bassign(?:ed)?\b/i.test(text) && (/\bcheck\b/i.test(text) || QUOTED.test(text));
}

/* ==================================================================== */
/* When the result word does not map                                     */
/* ==================================================================== */

/**
 * The results a person could have meant, as things to click.
 *
 * Offered when a recording instruction carries a word that is not a result —
 * "started", "in progress", "done" — rather than guessing which of eight
 * states they meant. `pending` is left off: it is the state the check is
 * already in, so offering it as a way to "start" a check would be a button
 * that does nothing.
 */
const OFFERED_RESULTS: CheckResult[] = [
  'compliant',
  'non_compliant',
  'partially_compliant',
  'missing_evidence',
  'unable_to_verify',
  'requires_expert_review',
  'not_applicable',
];

export function checkResultChoices(
  checkTitle: string,
  options: {
    assignTo?: string;
    /** The exact check, so a pick lands on it even if two DDs share a title. */
    sitting?: { ddId?: string; scopeId?: string; checkId?: string };
  } = {},
): ChatChoice[] {
  const rows: ChatChoice[] = [];
  const { sitting } = options;
  if (options.assignTo) {
    rows.push({
      id: 'chk_own',
      label: `Put it in my name (${options.assignTo})`,
      detail: 'Records who is working on it. The check stays not started until you conclude something.',
      send: `Assign "${checkTitle}" to me`,
      kind: 'owner',
      sitting,
    });
  }
  for (const result of OFFERED_RESULTS) {
    rows.push({
      id: `chk_${result}`,
      label: CHECK_RESULT_LABEL[result],
      detail: describeResult(result),
      send: `Mark "${checkTitle}" as ${CHECK_RESULT_LABEL[result].toLowerCase()}`,
      kind: 'result',
      sitting,
    });
  }
  return rows;
}

/** What recording each result will actually do, in one line. */
function describeResult(result: CheckResult): string {
  if (result === 'compliant') return 'Closes the check as satisfied. No finding is raised.';
  if (result === 'non_compliant') return 'Raises a high-severity finding against this scope.';
  if (result === 'partially_compliant') return 'Raises a medium-severity finding against this scope.';
  if (result === 'missing_evidence') return 'Records that the evidence is not on file, and raises a finding.';
  if (result === 'unable_to_verify') return 'Records that it could not be checked from what is held, and raises a finding.';
  if (result === 'requires_expert_review') return 'Refers it out, and raises a finding to track the referral.';
  if (result === 'not_applicable') return 'Closes the check as not applying to this project. No finding.';
  return 'Returns the check to not started.';
}

/* ==================================================================== */
/* Reading a result back off the person's pick                           */
/* ==================================================================== */

/**
 * The label→result map, so a message built from `CHECK_RESULT_LABEL` reads
 * back as the result it names. `parseCheckResult` would get most of these
 * right on phrasing alone; this makes the round-trip exact rather than lucky.
 */
export function resultFromLabel(text: string): CheckResult | null {
  const t = text.toLowerCase();
  for (const [result, label] of Object.entries(CHECK_RESULT_LABEL) as Array<[CheckResult, string]>) {
    if (t.includes(label.toLowerCase())) return result;
  }
  return null;
}

/* ==================================================================== */
/* What a recorded result did                                            */
/* ==================================================================== */

/**
 * The sentence said back after recording.
 *
 * States the finding when one was raised, because `recordCheckResult` creates
 * one for every material result and a person who is told only "recorded as
 * non-compliant" will not know a finding now sits on their register.
 */
export function describeRecorded(
  project: DdProject,
  check: { id: string; title: string; result: CheckResult; findingIds: string[] },
  before: string[],
): string {
  const fresh = check.findingIds.filter((id) => !before.includes(id));
  const lines = [`Recorded “${check.title}” as ${CHECK_RESULT_LABEL[check.result].toLowerCase()}.`];
  if (fresh.length) {
    const finding = project.findings.find((f) => f.id === fresh[0]);
    lines.push(
      finding
        ? `That raised a ${finding.severity} finding: “${finding.title}”. It is on the findings register now.`
        : 'That raised a finding on the register.',
    );
  }
  return lines.join('\n');
}
