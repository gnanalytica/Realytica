/**
 * What to do when the person's message does not resolve to exactly one thing.
 *
 * The cockpit used to have two outcomes: the text named something exactly, or
 * it fell through to "guide me" — which answered a different question, on a
 * different check, in a confident voice. Both failure shapes were silent. Ask
 * to "mark the boundary check as in progress" and you got a briefing on
 * Approval conditions in another DD; ask to set a check to a state the model
 * has no command for and you got the check opened and its current state read
 * back, which looks exactly like success.
 *
 * The rule this module exists to hold, for every subject and every verb:
 *
 *   1. Work out what is CLOSEST.
 *   2. If one reading is clearly right, act on it.
 *   3. If several are close, or the best is only a guess, SAY SO and let the
 *      person pick.
 *   4. If there is nothing to rank, ask a question that narrows it, using
 *      what is already on the file for the options.
 *
 * Never guess on a command. A wrong guess on a question wastes a turn; a
 * wrong guess on a command writes to a register, and the register is the
 * product.
 *
 * The choices this returns are real. Every one of them is a message the chat
 * already handles, so picking one does the thing — offering a choice that
 * does nothing is the same lie in a friendlier voice.
 */

import { CHECK_RESULT_LABEL, SCOPE_LABEL } from './catalogs';
import { rankTalkSittings, sittingCheckOf, type TalkCandidate, type TalkSitting } from './sitting';
import type { ChatChoice, DdProject } from './types';

/* ==================================================================== */
/* Reading the sentence                                                  */
/* ==================================================================== */

/**
 * Verbs that write. A sentence carrying one is a command, and a command is
 * held to the stricter standard: resolve it exactly or ask.
 */
const COMMAND_VERB =
  /\b(set|mark|start|begin|record|close|complete|finish|resolve|assign|update|change|add|create|request|tick|cross|approve|reject|skip|make)\b/i;

/** Verbs that only read. A near-miss here is worth offering, never fatal. */
const LOOKUP_VERB = /\b(show|open|find|fetch|get|see|view|read|tell|what|which|where|how|why|status|details?)\b/i;

export function looksLikeCommand(text: string): boolean {
  return COMMAND_VERB.test(text) && !/^\s*(what|which|where|how|why|who)\b/i.test(text.trim());
}

export function looksLikeLookup(text: string): boolean {
  return LOOKUP_VERB.test(text);
}

/* ==================================================================== */
/* Resolving the subject                                                 */
/* ==================================================================== */

export type SubjectResolution =
  /** One reading is clearly right — act on it. */
  | { kind: 'confident'; sitting: TalkSitting }
  /** Several readings are close, or the best is a guess. Offer them. */
  | { kind: 'ambiguous'; candidates: TalkCandidate[] }
  /** The text names something, but nothing on this file resembles it. */
  | { kind: 'unknown' }
  /** The text names no subject at all. */
  | { kind: 'absent' };

/**
 * How far ahead the winner must be to be taken as the answer.
 *
 * Two confident candidates a hair apart are two things the person might have
 * meant, and picking the higher one silently is the behaviour this module
 * replaces.
 */
const DECISIVE_MARGIN = 6;

export function resolveSubject(
  project: DdProject,
  text: string,
  options: { strict?: boolean } = {},
): SubjectResolution {
  const ranked = rankTalkSittings(project, text, 5);
  if (!ranked.length) {
    // Nothing resembled anything. Distinguish "they named something we do not
    // have" from "they named nothing", because only the first is worth
    // apologising for.
    return hasNameLikeSubject(text) ? { kind: 'unknown' } : { kind: 'absent' };
  }

  const confident = ranked.filter((row) => row.confident);
  const strict = options.strict ?? looksLikeCommand(text);

  if (confident.length) {
    const [best, second] = confident;
    const clear = !second || best!.score - second.score >= DECISIVE_MARGIN;
    if (clear) return { kind: 'confident', sitting: best!.sitting };
    return { kind: 'ambiguous', candidates: confident.slice(0, 4) };
  }

  // Only loose candidates. On a lookup, the best guess is worth offering
  // alongside the alternatives; on a command it must be confirmed first.
  const shortlist = ranked.slice(0, strict ? 4 : 3);
  return { kind: 'ambiguous', candidates: shortlist };
}

const SUBJECT_NOUN = /\b(checks?|scopes?|dd|assessments?|findings?|risks?|actions?|decisions?|evidence|documents?|files?|assets?|reports?)\b/i;

/**
 * Words that carry no name — verbs, articles, and the register nouns
 * themselves. What is left over is the qualifier: the bit that says WHICH one.
 */
const NOT_A_NAME = new Set([
  'open', 'show', 'view', 'take', 'go', 'to', 'the', 'a', 'an', 'this', 'that',
  'me', 'my', 'our', 'us', 'please', 'and', 'for', 'from', 'with', 'on', 'in',
  'switch', 'see', 'get', 'find', 'fetch', 'read', 'tell', 'about',
  'check', 'checks', 'scope', 'scopes', 'assessment', 'assessments',
  'finding', 'findings', 'risk', 'risks', 'action', 'actions', 'decision',
  'decisions', 'evidence', 'document', 'documents', 'file', 'files', 'asset',
  'assets', 'report', 'reports', 'register', 'registers', 'pane', 'canvas',
]);

/**
 * Does the text point at a PARTICULAR thing, as opposed to a whole register?
 *
 * "open evidence" names a pane and opening it is the right answer. "open the
 * zzzz check" names one record we do not have, and opening the DD pane to read
 * out an unrelated next step is not an answer to it. The difference is whether
 * anything is left once the verbs and the register nouns are removed.
 */
function hasNameLikeSubject(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (/["“][^"”]+["”]/.test(t)) return true;
  if (!SUBJECT_NOUN.test(t)) return false;
  const qualifier = t
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !NOT_A_NAME.has(w));
  return qualifier.length > 0;
}

/* ==================================================================== */
/* Turning candidates into something to pick                             */
/* ==================================================================== */

const KIND_WORD: Record<TalkSitting['kind'], string> = {
  check: 'check',
  scope: 'scope',
  dd: 'assessment',
  evidence: 'evidence',
  finding: 'finding',
  risk: 'risk',
  action: 'action',
  asset: 'asset',
};

function choiceId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

/**
 * One line of context per candidate, so the pick is informed.
 *
 * A list of four near-identical check titles is not a choice — the state each
 * one is in is what tells them which they meant.
 */
function candidateDetail(project: DdProject, sitting: TalkSitting): string | undefined {
  if (sitting.kind === 'check') {
    const hit = sittingCheckOf(project, sitting.extra);
    if (!hit) return undefined;
    return `${hit.assessment.name} · ${SCOPE_LABEL[hit.scope.scopeKey]} · ${CHECK_RESULT_LABEL[hit.check.result]}`;
  }
  if (sitting.kind === 'scope') {
    for (const a of project.assessments) {
      const s = a.scopes.find((row) => row.id === sitting.extra.scopeId);
      if (s) {
        const pending = s.checks.filter((c) => c.result === 'pending').length;
        return `${a.name} · ${pending} check(s) pending`;
      }
    }
    return undefined;
  }
  if (sitting.kind === 'dd') {
    const a = project.assessments.find((row) => row.id === sitting.extra.ddId);
    return a ? `${a.scopes.length} scope(s) · ${a.status}` : undefined;
  }
  if (sitting.kind === 'evidence') {
    const e = project.evidence.find((row) => row.id === sitting.extra.evidenceId);
    return e ? `Evidence · ${e.status}` : undefined;
  }
  if (sitting.kind === 'finding') {
    const f = project.findings.find((row) => row.id === sitting.extra.findingId);
    return f ? `Finding · ${f.severity} · ${f.status}` : undefined;
  }
  if (sitting.kind === 'risk') {
    const r = project.risks.find((row) => row.id === sitting.extra.riskId);
    return r ? `Risk · ${r.status}` : undefined;
  }
  if (sitting.kind === 'action') {
    const a = project.actions.find((row) => row.id === sitting.extra.actionId);
    return a ? `Action · ${a.status}` : undefined;
  }
  return undefined;
}

/**
 * The message to send when a candidate is picked.
 *
 * Quoted, because a quoted phrase is the one form `titleScore` treats as
 * decisive — so picking a suggestion always resolves to the thing that was
 * suggested, and never re-enters this module.
 */
function sendForCandidate(sitting: TalkSitting): string {
  const title = sitting.label.includes(' · ')
    ? sitting.label.slice(sitting.label.lastIndexOf(' · ') + 3)
    : sitting.label;
  return `Open "${title}"`;
}

export function candidateChoices(
  project: DdProject,
  candidates: TalkCandidate[],
  options: {
    /**
     * Rewrite the message a pick sends. Without this every option says
     * "Open …", which quietly drops the instruction: somebody who typed
     * "mark it non-compliant" and picked the check they meant would get the
     * check opened and nothing recorded — the original failure, one turn later.
     */
    send?: (sitting: TalkSitting) => string;
  } = {},
): ChatChoice[] {
  return candidates.map((row, i) => ({
    id: choiceId('cand', i),
    label: row.sitting.label,
    detail: candidateDetail(project, row.sitting),
    send: options.send ? options.send(row.sitting) : sendForCandidate(row.sitting),
    kind: KIND_WORD[row.sitting.kind],
    sitting: {
      ddId: row.sitting.extra.ddId,
      scopeId: row.sitting.extra.scopeId,
      checkId: row.sitting.extra.checkId,
    },
  }));
}

/** The bare title of a sitting, without its scope prefix. */
export function sittingTitle(sitting: TalkSitting): string {
  return sitting.label.includes(' · ')
    ? sitting.label.slice(sitting.label.lastIndexOf(' · ') + 3)
    : sitting.label;
}

/* ==================================================================== */
/* When the verb is not one we can carry out                             */
/* ==================================================================== */

/**
 * What can actually be done to this subject, from here, today.
 *
 * Derived from the subject's kind rather than from the words in the message,
 * so it stays true as commands are added and cannot drift into advertising
 * something chat does not do.
 */
export function actionChoicesFor(project: DdProject, sitting: TalkSitting): ChatChoice[] {
  const out: ChatChoice[] = [];
  const push = (label: string, detail: string, send: string) => {
    out.push({ id: choiceId('act', out.length), label, detail, send });
  };
  const title = sitting.label.includes(' · ')
    ? sitting.label.slice(sitting.label.lastIndexOf(' · ') + 3)
    : sitting.label;

  if (sitting.kind === 'check' || sitting.kind === 'scope' || sitting.kind === 'dd') {
    push(
      'Record it as compliant',
      'Closes the check as satisfied. No finding is raised.',
      `Mark "${title}" as compliant`,
    );
    push(
      'Record it as non-compliant',
      'Closes the check and raises a high-severity finding against this scope.',
      `Mark "${title}" as non-compliant`,
    );
    push('Open it', 'Opens the check on the right, with the full result list. Nothing is written.', `Open "${title}"`);
    const hit = sittingCheckOf(project, sitting.extra);
    if (hit?.check.expectedEvidence.length) {
      push(
        'Request the evidence it needs',
        `Queues a request card for ${hit.check.expectedEvidence.slice(0, 2).join(', ')}.`,
        `Request evidence for "${title}"`,
      );
    }
    return out;
  }
  if (sitting.kind === 'finding') {
    push('Close it', 'Marks the finding closed on the register.', `Close finding "${title}"`);
    push('Show it', 'Opens the finding, nothing written.', `Open "${title}"`);
    return out;
  }
  if (sitting.kind === 'risk') {
    push('Mark it mitigated', 'Moves the risk to mitigated.', `Mitigate risk "${title}"`);
    push('Accept it', 'Moves the risk to accepted.', `Accept risk "${title}"`);
    push('Show it', 'Opens the risk, nothing written.', `Open "${title}"`);
    return out;
  }
  if (sitting.kind === 'action') {
    push('Close it', 'Marks the action closed.', `Close action "${title}"`);
    push('Show it', 'Opens the action, nothing written.', `Open "${title}"`);
    return out;
  }
  push('Show it', 'Opens it on the right, nothing written.', `Open "${title}"`);
  return out;
}

/* ==================================================================== */
/* When there is nothing to rank: ask                                    */
/* ==================================================================== */

/**
 * A narrowing question, with options taken from the file.
 *
 * Asked when a command names no subject we recognise. Rather than a bare
 * "which check?", the options are the checks the person is most likely to
 * mean — the one they are sitting on, then the ones still pending on the DDs
 * that are actually running. A question you can answer by clicking is a
 * question; a question you have to go and look something up for is a wall.
 */
export function narrowingChoices(
  project: DdProject,
  options: { sitting?: { ddId?: string; scopeId?: string; checkId?: string }; limit?: number } = {},
): ChatChoice[] {
  const limit = options.limit ?? 5;
  const out: ChatChoice[] = [];
  const seen = new Set<string>();

  const add = (label: string, detail: string, title: string) => {
    if (out.length >= limit || seen.has(title)) return;
    seen.add(title);
    out.push({ id: choiceId('near', out.length), label, detail, send: `Open "${title}"`, kind: 'check' });
  };

  const current = sittingCheckOf(project, options.sitting);
  if (current) {
    add(
      current.check.title,
      `Where you are now · ${SCOPE_LABEL[current.scope.scopeKey]} · ${CHECK_RESULT_LABEL[current.check.result]}`,
      current.check.title,
    );
  }

  for (const assessment of project.assessments) {
    if (assessment.status === 'archived' || assessment.status === 'completed') continue;
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (check.result !== 'pending') continue;
        add(
          check.title,
          `${assessment.name} · ${SCOPE_LABEL[scope.scopeKey]} · not started`,
          check.title,
        );
      }
    }
  }
  return out;
}

/* ==================================================================== */
/* The answer                                                            */
/* ==================================================================== */

export interface ClarifyOutcome {
  text: string;
  choices: ChatChoice[];
  /** For the turn's toolCalls, so the transcript records that we asked. */
  summary: string;
}

/**
 * Build the "did you mean" turn.
 *
 * The wording states plainly that nothing was done. That sentence is the
 * whole point of this module: the old behaviour's failure was not that it
 * picked wrong, it was that it never said it had picked at all.
 */
export function clarifySubject(
  project: DdProject,
  text: string,
  resolution: SubjectResolution,
  options: {
    sitting?: { ddId?: string; scopeId?: string; checkId?: string };
    /**
     * The sentence definitely pointed at one specific thing, even if its verb
     * only reads — "open the zzzz check". Without this, an unknown subject on
     * a lookup falls through to opening a whole register, which answers a
     * question about the pane instead of the thing they named.
     */
    insist?: boolean;
    /** Rewrite what each option sends, so an instruction survives the pick. */
    send?: (sitting: TalkSitting) => string;
  } = {},
): ClarifyOutcome | null {
  const commanded = looksLikeCommand(text) || options.insist === true;
  if (resolution.kind === 'ambiguous') {
    const choices = candidateChoices(project, resolution.candidates, { send: options.send });
    if (!choices.length) return null;
    const only = choices.length === 1;
    return {
      /*
       * Ask the question, not for permission to ask it.
       *
       * "That could be 2 things on this file, and I have not assumed one. Pick
       * one and I will open it:" spent two clauses explaining its own
       * restraint to somebody who can see two buttons underneath. What matters
       * is that nothing was changed — which is worth one word, and only when
       * the sentence was an instruction.
       */
      text: only
        ? `Did you mean “${choices[0]!.label}”?${commanded ? ' Nothing changed yet.' : ''}`
        : `${choices.length} could match${commanded ? ' — nothing changed yet' : ''}. Which one?`,
      choices,
      summary: only ? 'One near match — asked' : `${choices.length} near matches — asked`,
    };
  }
  if (resolution.kind === 'unknown' && commanded) {
    const choices = narrowingChoices(project, options);
    return {
      text: [
        'Nothing on this file matches that name, so I have not changed anything.',
        choices.length ? 'Did you mean one of these?' : 'Name it the way it appears on the register, or say “guide me”.',
      ].join('\n'),
      choices,
      summary: 'No match — asked',
    };
  }
  return null;
}


/* ==================================================================== */
/* Dead ends on the register commands                                    */
/* ==================================================================== */

export type RecordKind = 'finding' | 'risk' | 'action';

const RECORD_WORD: Record<RecordKind, string> = {
  finding: 'finding',
  risk: 'risk',
  action: 'action',
};

/**
 * "Close the litigation finding" when no finding is called that.
 *
 * The three register commands each ended at a dead end — "No matching open
 * finding. Quote the title." — which is accurate, unhelpful, and makes the
 * person go and read a register to find the words this sentence wanted. The
 * rows are right here, so rank them and offer them: closest by shared words
 * first, then whatever is open.
 */
export function clarifyRecordCommand(
  project: DdProject,
  text: string,
  kind: RecordKind,
  rows: Array<{ id: string; title: string; status: string }>,
  verb: string,
): ClarifyOutcome {
  const word = RECORD_WORD[kind];
  const scored = rows
    .map((row) => ({ row, score: looseTitleScore(row.title, text) }))
    .sort((a, b) => b.score - a.score);
  const near = scored.filter((x) => x.score > 0).slice(0, 4);
  const shortlist = (near.length ? near : scored.slice(0, 5)).map((x) => x.row);

  const choices: ChatChoice[] = shortlist.map((row, i) => ({
    id: `rec_${i}`,
    label: row.title,
    detail: `${word} · ${row.status}`,
    send: `${verb} ${word} "${row.title}"`,
    kind: word,
  }));

  if (!choices.length) {
    return {
      text: `There is no open ${word} on this file to ${verb.toLowerCase()}.`,
      choices: [],
      summary: `No open ${word}`,
    };
  }
  return {
    text: [
      near.length
        ? `No ${word} is called that, so nothing has changed. Closest on the register:`
        : `No ${word} matches that name, so nothing has changed. These are open:`,
      'Pick one and I will apply it.',
    ].join('\n'),
    choices,
    summary: `${choices.length} ${word}(s) offered`,
  };
}

/** Shared-word score against a record title. Same shallow stemming as above. */
function looseTitleScore(title: string, text: string): number {
  const t = new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((x) => x.length >= 4)
      .map((x) => (x.endsWith('s') && !x.endsWith('ss') ? x.slice(0, -1) : x)),
  );
  const q = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length >= 4)
    .map((x) => (x.endsWith('s') && !x.endsWith('ss') ? x.slice(0, -1) : x));
  return q.filter((x) => t.has(x)).length;
}
