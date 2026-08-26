/**
 * Guardrails a prompt version is checked against.
 *
 * ## Why this file exists at all
 *
 * The shared preamble is not house style. It is the text that says never
 * invent a document, a transaction, a statute, a case number, a date or a
 * figure — and an invented survey number reads exactly like a real one, gets
 * copied into a diligence note, and gets quoted at a counter. It is the single
 * failure this product cannot ship, and there is a whole evaluation gate
 * (`../eval/`) built around catching it.
 *
 * So the registry does not validate a version into acceptance or rejection. An
 * operator may genuinely need to rewrite a preamble, and a tool that refuses
 * every edit gets worked around rather than used. What it does instead is
 * check every declared guardrail, attach the result to the version, and mark
 * every run that used a version which dropped one. Editing is allowed; editing
 * invisibly is not.
 *
 * ## How the checking works, and what it cannot do
 *
 * A check that only matches the exact shipped sentence is theatre: the first
 * operator to rewrite "NEVER invent a document" as "Do not fabricate a record"
 * would be told they had deleted the rule, they would learn the warning is
 * noise, and the one time it fires for real nobody would look. So each
 * invariant is a **phrase family with a proximity requirement**: a set of
 * requirements, each satisfied by any one of a family of near-synonyms, and
 * all of them have to land inside one window of text rather than being
 * scattered across unrelated paragraphs.
 *
 * ### The measured false-negative rate, and why it is the optimistic figure
 *
 * A false negative here means the rule is genuinely present and the check says
 * it is not — a false alarm on a version that is actually fine.
 *
 * Measured against a corpus of 31 hand-written faithful rewrites of the four
 * rules (10 for never-invent, 8 for engine-owns-numbers, 7 for
 * label-inferences, 6 for statutory-verification), plus 9 gutted preambles
 * with one rule deleted:
 *
 *     false negatives  3/31  (10%)
 *     false positives  0/9   (0%)
 *
 * **Treat 10% as optimistic.** The corpus scored 16% before two vocabulary
 * entries were added in direct response to the misses it found ("no
 * hallucinated …" as a prohibition, "from memory"/"plausibility" as
 * fabrication), so the checker has been fitted to its own test set to that
 * extent; 16% is the fairer estimate for wording nobody has seen. And the
 * corpus was written by the same person who wrote the vocabulary, which biases
 * it further in the same direction. On a genuinely independent set, one miss
 * in four or five would not be surprising.
 *
 * What gets missed is predictable: a paraphrase built entirely outside these
 * word families. "Everything you state must already exist in the case file" is
 * the never-invent rule stated perfectly, expressed as a closed-world
 * requirement with no prohibition and no word for fabrication anywhere in it,
 * and it is missed. That specific gap is not closed on purpose — a
 * closed-world family would also match principle 1 of the preamble ("every
 * claim you make must trace to something in the case"), which survives the
 * deletion of the hard rule, so adding it would turn a reliable false negative
 * into an unreliable false positive on exactly the edit this exists to catch.
 *
 * ### False positives, which are the ones that hurt
 *
 * A false positive means the rule is gone and the check says it is there.
 * Zero on the corpus, but the corpus cannot cover the two ways to get one:
 *
 * - **Incidental vocabulary.** A preamble that has deleted the hard rule but
 *   happens to say "never invent a cheerful procedure for a document you
 *   cannot obtain" satisfies the never-invent family from a sentence that was
 *   about something else entirely.
 * - **Negation blindness.** This is keyword proximity, not parsing, so
 *   "you may invent a plausible figure where none is on file" matches the same
 *   family as its opposite. Nothing short of a model-graded check would catch
 *   that, and a model-graded gate on the very text that constrains models is a
 *   circularity worth refusing.
 *
 * The consequence to hold on to: a satisfied invariant is weak evidence that
 * the rule survived, and an unsatisfied one is a strong prompt to go and read
 * the diff. It is a smoke alarm, not a proof. The thing that actually stops a
 * fabricated survey number reaching a user is the evaluation gate in
 * `../eval/`, which reads outputs rather than prompts.
 *
 * ## Determinism
 *
 * Every function here is pure: same content in, same checks out, no clock, no
 * randomness, no environment. `PromptVersion.invariants` is recomputed from
 * the current build on every load rather than trusted from persistence, so
 * adding a guardrail here retro-flags versions that were written before it
 * existed.
 */

import type { PromptInvariantCheck } from '@valytica/shared';

/* ==================================================================== */
/* Declaration                                                           */
/* ==================================================================== */

/**
 * One guardrail, declared.
 *
 * `rationale` is written for the person reading a flag on a run at the moment
 * a finding looks wrong, so it names the consequence in product terms rather
 * than restating prompt-engineering advice.
 */
export interface PromptInvariantSpec {
  id: string;
  label: string;
  rationale: string;
  /** Pure predicate over the version's raw content. */
  test(content: string): boolean;
}

/**
 * One requirement inside a phrase-family invariant.
 *
 * `any` lists interchangeable ways of saying the same thing. A trailing `*` on
 * a term's last word makes it a prefix match, which is how one entry covers
 * verify/verified/verification without a stemmer — a stemmer would be a
 * dependency and a source of surprise, and the vocabulary here is small enough
 * to enumerate.
 *
 * `min` is the number of *distinct* alternatives that must appear. It exists
 * for the never-invent rule, where the point is the breadth of the list: a
 * preamble that forbids inventing a date but says nothing about documents,
 * statutes or figures has not kept the rule, it has kept a fragment of it.
 */
interface PhraseRequirement {
  name: string;
  any: string[];
  min?: number;
}

interface PhraseFamilyRule {
  requirements: PhraseRequirement[];
  /**
   * How far apart, in normalised tokens, the matches may be and still count as
   * one rule.
   *
   * Without this, "never" in the header and "invent" three paragraphs down in
   * an unrelated sentence would satisfy the never-invent check on a preamble
   * that had deleted it. The windows are generous — a rule may legitimately be
   * spread over two or three sentences — but they are bounded.
   */
  windowTokens: number;
}

/* ==================================================================== */
/* Matching                                                              */
/* ==================================================================== */

/**
 * Content reduced to a bare token stream.
 *
 * Case, punctuation, list markers, bold markers and line wrapping all vary
 * freely between an operator's rewrite and the shipped text without changing
 * whether the rule is present, so none of them may affect the answer. Soft
 * hyphens and zero-width spaces are stripped first: `PROOF_PATHWAYS_ROLE`
 * ships with a soft hyphen inside "respons­ibly", and a token stream that
 * kept it would split a word in half and silently fail to match it.
 */
function tokenise(content: string): string[] {
  const cleaned = content
    .replace(/[­​‌‍﻿]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return cleaned.length === 0 ? [] : cleaned.split(' ');
}

/** Token indices at which `term` starts. A trailing `*` makes the last word a prefix match. */
function matchPositions(tokens: string[], term: string): number[] {
  const prefix = term.endsWith('*');
  const words = tokenise(prefix ? term.slice(0, -1) : term);
  if (words.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i + words.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < words.length; j++) {
      const expected = words[j];
      const actual = tokens[i + j];
      const last = j === words.length - 1;
      if (last && prefix ? !actual.startsWith(expected) : actual !== expected) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * Does one window of `windowTokens` contain enough to satisfy every requirement?
 *
 * Brute force over candidate window starts rather than a sliding-window
 * cleverness. The inputs are a handful of requirements over a prompt of a few
 * thousand tokens, this runs once per version rather than per request, and a
 * subtle bug in a guardrail checker is worth far more than the microseconds an
 * optimised version would save.
 */
function satisfiesWithinWindow(tokens: string[], rule: PhraseFamilyRule): boolean {
  // Per requirement, per alternative: where it matched. An alternative that
  // never matches anywhere is dropped now so the window scan stays cheap.
  const hits = rule.requirements.map(req => ({
    min: req.min ?? 1,
    alternatives: req.any
      .map(term => matchPositions(tokens, term))
      .filter(positions => positions.length > 0),
  }));

  // Cheap global rejection first: if a requirement cannot be met over the
  // whole text, no window can meet it either.
  for (const hit of hits) {
    if (hit.alternatives.length < hit.min) return false;
  }

  const starts = new Set<number>([0]);
  for (const hit of hits) {
    for (const positions of hit.alternatives) {
      for (const p of positions) starts.add(Math.max(0, p - rule.windowTokens + 1));
    }
  }

  for (const start of [...starts].sort((a, b) => a - b)) {
    const end = start + rule.windowTokens;
    const all = hits.every(
      hit => hit.alternatives.filter(ps => ps.some(p => p >= start && p < end)).length >= hit.min,
    );
    if (all) return true;
  }
  return false;
}

function phraseFamilyInvariant(
  id: string,
  label: string,
  rationale: string,
  rule: PhraseFamilyRule,
): PromptInvariantSpec {
  return {
    id,
    label,
    rationale,
    test: content => satisfiesWithinWindow(tokenise(content), rule),
  };
}

/* ==================================================================== */
/* The grounding guardrails                                              */
/* ==================================================================== */

/**
 * The four rules the evidence ledger rests on.
 *
 * Declared against `shared.grounding` alone rather than against every agent
 * prompt, because every agent prompt *composes* grounding through the
 * `{{grounding}}` placeholder exactly as the shipped code composes
 * `GROUNDING_RULES`. An agent version that deletes that placeholder does not
 * quietly lose the rules unnoticed — it fails its own `variable.grounding`
 * check, which is the guard that keeps the preamble attached.
 */
export const GROUNDING_INVARIANTS: readonly PromptInvariantSpec[] = [
  phraseFamilyInvariant(
    'grounding.no_fabrication',
    'Never invent a document, transaction, statute, case number, date or figure',
    'An invented survey number reads exactly like a real one. It gets copied into a diligence note, ' +
      'shown to a buyer, and quoted at a sub-registrar counter, where it is discovered by someone who ' +
      'has already paid. Nothing downstream can tell a fabricated citation from a real one, so this ' +
      'sentence is the only thing standing between the model and the ledger.',
    {
      windowTokens: 60,
      requirements: [
        {
          name: 'prohibition',
          any: [
            'never',
            'do not',
            'don t',
            'must not',
            'must never',
            'may not',
            'cannot',
            'at no point',
            'under no circumstances',
            'refrain from',
            'forbidden',
            'prohibited',
            // The "No invented X" construction carries the prohibition in a
            // bare "no", which is far too common a word to list on its own.
            // Listed as fixed pairs instead, which costs nothing in precision.
            'no invented',
            'no fabricated',
            'no hallucinated',
            'no made up',
            'no guessed',
          ],
        },
        {
          name: 'fabrication',
          any: [
            'invent*',
            'fabricat*',
            'make up',
            'makes up',
            'making up',
            'made up',
            'concoct*',
            'hallucinat*',
            'guess*',
            'conjure*',
            'imagin*',
            'from memory',
            'plausibilit*',
            'thin air',
          ],
        },
        {
          name: 'protected nouns',
          min: 3,
          any: [
            'document*',
            'transaction*',
            'statut*',
            'case number*',
            'date*',
            'figure*',
            'number*',
            'citation*',
            'source*',
            'record*',
            'amount*',
            'deed*',
            'survey number*',
            'reference*',
          ],
        },
      ],
    },
  ),
  phraseFamilyInvariant(
    'grounding.engine_owns_numbers',
    'The deterministic engine owns the numbers',
    'The valuation a user acts on is computed, reproducible and explainable. A model that restates ' +
      'it as its own derivation can drift the figure by a lakh and nothing will contradict it, because ' +
      'the narrative and the number would no longer come from the same place. Drop this and the ' +
      'arithmetic authority quietly moves from the engine to whatever the model felt like saying.',
    {
      windowTokens: 60,
      requirements: [
        { name: 'the engine', any: ['engine*', 'deterministic*', 'calculator', 'screening engine'] },
        {
          name: 'ownership',
          any: [
            'own*',
            'authorit*',
            'comput*',
            'derive*',
            'derived',
            'produce*',
            'source of truth',
            'restate*',
            'recompute*',
            'override*',
            'arithmetic',
          ],
        },
        {
          name: 'the numbers',
          any: ['number*', 'figure*', 'valuation*', 'value*', 'estimate*', 'arithmetic', 'price*'],
        },
      ],
    },
  ),
  phraseFamilyInvariant(
    'grounding.label_inferences',
    'Reasoning beyond the evidence must be labelled as inference',
    'A labelled inference is useful and a user weighs it accordingly. An unlabelled one enters the ' +
      'case as though a document said it, and by the time anyone asks which document, the reasoning ' +
      'that produced it is gone. This is the line between an analyst’s judgement and a fact on file.',
    {
      windowTokens: 60,
      requirements: [
        {
          name: 'inference',
          any: [
            'infer*',
            'extrapolat*',
            'assumption*',
            'assume*',
            'assumed',
            'speculat*',
            'beyond the evidence',
            'your own reasoning',
            'judgement',
            'judgment',
          ],
        },
        {
          name: 'labelling',
          any: [
            'label*',
            'mark*',
            'flag*',
            'declare*',
            'explicit*',
            'identif*',
            'make clear',
            'say so',
            'state it',
            'signpost*',
            'call it',
            'distinguish*',
          ],
        },
      ],
    },
  ),
  phraseFamilyInvariant(
    'grounding.statutory_verification',
    'Statutory rules must be presented as needing verification against the current circular',
    'Guidance values, stamp duty bands and buffer distances change by circular and court order, ' +
      'sometimes between one quarter and the next. A rate stated as settled fact is the kind of thing ' +
      'a buyer budgets against and a lender declines on. Stating it as needing verification costs the ' +
      'reader one sentence; not stating it costs them the difference.',
    {
      windowTokens: 90,
      requirements: [
        {
          name: 'statutory subject',
          any: [
            'statut*',
            'guidance value*',
            'stamp duty',
            'circular*',
            'buffer distance*',
            'regulat*',
            'legal*',
            'court order*',
            'notification*',
            'tariff*',
          ],
        },
        {
          name: 'verification',
          any: [
            'verif*',
            'check*',
            'confirm*',
            'validat*',
            'current*',
            'latest',
            'up to date',
            'as at',
            're read',
            'reconfirm*',
          ],
        },
      ],
    },
  ),
];

/* ==================================================================== */
/* The universal variable guardrail                                      */
/* ==================================================================== */

/**
 * One check per declared template variable.
 *
 * A version that drops `{{parcelId}}` renders a sentence with a hole where a
 * case fact belongs, and a prompt with a hole in it fails in a way that looks
 * like a model problem: the answer is vague, nobody can see why, and three
 * people spend an afternoon on the wrong layer. A version that drops
 * `{{grounding}}` is worse — it silently detaches the anti-fabrication rules
 * from that one agent while every other agent still carries them, so the
 * failure appears in exactly one place and looks like bad luck.
 *
 * Emitted per variable rather than as a single rolled-up check so the flag on
 * the run names which one went missing.
 */
export function variableInvariant(name: string): PromptInvariantSpec {
  const placeholder = `{{${name}}}`;
  return {
    id: `variable.${name}`,
    label: `Template variable ${placeholder} is present`,
    rationale:
      name === 'grounding'
        ? 'This placeholder is where the shared anti-fabrication preamble is composed in. A version ' +
          'without it runs this one agent with no grounding rules at all, while every other agent still ' +
          'has them — so the resulting fabrication looks like an isolated bad answer rather than a ' +
          'configuration change somebody made.'
        : `Without ${placeholder} the case fact it carries never reaches the model, and the prompt ` +
          'renders as a sentence with a hole in it. The answer comes back thin or generic, and it reads ' +
          'like a model problem rather than a prompt that was edited.',
    test: content => content.includes(placeholder),
  };
}

/* ==================================================================== */
/* Running the checks                                                    */
/* ==================================================================== */

/**
 * Which guardrails apply to one prompt.
 *
 * The grounding rules attach to the one descriptor that carries their text.
 * Everything else gets the variable checks alone, because everything else
 * composes grounding rather than restating it — see `GROUNDING_INVARIANTS`.
 */
export function invariantsFor(key: string, variables: readonly string[]): PromptInvariantSpec[] {
  const specs: PromptInvariantSpec[] = [];
  if (key === SHARED_GROUNDING_KEY) specs.push(...GROUNDING_INVARIANTS);
  for (const name of variables) specs.push(variableInvariant(name));
  return specs;
}

/**
 * The key of the one prompt the grounding guardrails are declared against.
 *
 * Declared here rather than imported from `./registry` so this module stays a
 * leaf: the registry declares prompts *and their checks*, so the dependency
 * has to run that way round.
 */
export const SHARED_GROUNDING_KEY = 'shared.grounding';

/** Run a set of guardrails over a version's content. Pure; order is the declaration order. */
export function checkInvariants(
  content: string,
  specs: readonly PromptInvariantSpec[],
): PromptInvariantCheck[] {
  return specs.map(spec => ({
    id: spec.id,
    label: spec.label,
    rationale: spec.rationale,
    satisfied: spec.test(content),
  }));
}

/** The guardrails a version failed, by id. Empty is the normal case. */
export function brokenInvariantIds(checks: readonly PromptInvariantCheck[]): string[] {
  return checks.filter(c => !c.satisfied).map(c => c.id);
}
