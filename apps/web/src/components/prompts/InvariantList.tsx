import { useEffect, useState } from 'react';
import { Check, CircleHelp, ShieldAlert, XCircle } from 'lucide-react';
import type { PromptDescriptor, PromptInvariantCheck, PromptVersion } from '@realytica/shared';
import { Button, Checkbox, Field, Input, Modal, cn } from '../ui/kit';

/**
 * Guardrails: what a prompt version must keep saying, and whether it still does.
 *
 * The uncomfortable pair this module exists for: prompts are editable, and one
 * of them — the shared preamble — is the text that says *never invent a
 * document, a transaction, a statute, a case number, a date, or a figure*. An
 * invented survey number is the single failure this product cannot ship. So a
 * prompt editor that lets someone quietly delete that line, with the app then
 * reporting business as usual, would remove the guarantee the whole evidence
 * ledger rests on.
 *
 * The contract's answer is not validation-into-rejection — an operator may
 * genuinely need to rewrite a preamble — but *visibility*: every guardrail is
 * checked, the result travels with the version (`PromptVersion.invariants`),
 * and any run made under a version that dropped one is marked
 * (`PromptUsage.invariantsBroken`). Editing is allowed; editing invisibly is
 * not. Everything in this directory is built to make the second half of that
 * sentence true in the interface.
 *
 * Three rules govern the checker below.
 *
 * 1. **It runs on every keystroke.** A check that only fires on save tells
 *    someone what they have already done. The point is to show the guarantee
 *    going out while the line is being deleted.
 * 2. **An unassessed guardrail is never rendered as a kept one.** A declared
 *    invariant this build has no rule for is reported as *not checked here* —
 *    the same discipline the model-operations page applies to capability gaps.
 *    Claiming a guarantee nobody verified is worse than admitting the gap.
 * 3. **When it must commit a boolean, it fails closed.** Persisting a version
 *    means writing `satisfied: true | false` per guardrail. An unassessed
 *    guardrail is written as unmet, because a version wrongly marked is an
 *    inconvenience and a version wrongly cleared is the failure this whole
 *    mechanism exists to prevent. Where a server computes the checks, its
 *    answer is authoritative and replaces this one.
 */

/* ------------------------------------------------------------------ */
/* Version lookup — one shared answer to "which version is in force"   */
/* ------------------------------------------------------------------ */

/**
 * The version currently in force, or `undefined` when `activeVersionId`
 * resolves to nothing.
 *
 * Callers must handle the `undefined`: a descriptor pointing at a version that
 * is not in its own list is a broken registry, and rendering that as "all
 * good" would hide exactly the sort of drift this page is for.
 */
export function activeVersion(prompt: PromptDescriptor): PromptVersion | undefined {
  return prompt.versions.find((v) => v.id === prompt.activeVersionId);
}

/** The shipped text. Version 1 is always the built-in, but it is matched on the flag, not the number. */
export function builtInVersion(prompt: PromptDescriptor): PromptVersion | undefined {
  return prompt.versions.find((v) => v.builtIn) ?? prompt.versions.find((v) => v.version === 1);
}

/** Newest first — the order a person reads a history in. */
export function versionsNewestFirst(prompt: PromptDescriptor): PromptVersion[] {
  return [...prompt.versions].sort((a, b) => b.version - a.version);
}

/** Guardrails a stored version records as unmet. Empty is the normal case. */
export function brokenChecks(version: PromptVersion | undefined): PromptInvariantCheck[] {
  return version ? version.invariants.filter((i) => !i.satisfied) : [];
}

/** Does the version in force still keep every guardrail declared for this prompt? */
export function activeVersionIsCompromised(prompt: PromptDescriptor): boolean {
  const active = activeVersion(prompt);
  if (!active) return true; // unresolvable active version — not a state to render as fine
  return brokenChecks(active).length > 0;
}

/* ------------------------------------------------------------------ */
/* Declared guardrails                                                 */
/* ------------------------------------------------------------------ */

/**
 * The guardrails declared for a prompt, independent of any one version.
 *
 * The contract hangs checks off each version rather than off the descriptor,
 * so the canonical list is taken from the built-in — the one version that is
 * always present and always shipped with its full set — and any id introduced
 * by a later version is appended rather than dropped. Taking it from the
 * *active* version instead would let a custom version quietly shrink the list
 * of things being checked, which is the same failure by another route.
 */
export function declaredInvariants(prompt: PromptDescriptor): PromptInvariantCheck[] {
  const seen = new Map<string, PromptInvariantCheck>();
  const builtIn = builtInVersion(prompt);
  for (const check of builtIn?.invariants ?? []) seen.set(check.id, check);
  for (const version of prompt.versions) {
    for (const check of version.invariants) if (!seen.has(check.id)) seen.set(check.id, check);
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* Variables                                                           */
/* ------------------------------------------------------------------ */

/**
 * Matches a declared placeholder in either brace style, so the checker does
 * not fail a template purely over a house convention it was not told about.
 */
function variableToken(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\{\\{?\\s*${escaped}\\s*\\}?\\}`);
}

/**
 * Declared placeholders the draft no longer contains.
 *
 * Treated as an error rather than a warning wherever it is surfaced. A version
 * that drops a placeholder renders a blank where a case fact belongs, and the
 * resulting failure looks like a model problem — someone spends a day on the
 * wrong question. This is the cheapest possible place to catch it.
 */
export function missingVariables(prompt: PromptDescriptor, content: string): string[] {
  return prompt.variables.filter((name) => !variableToken(name).test(content));
}

/* ------------------------------------------------------------------ */
/* The rule table                                                      */
/* ------------------------------------------------------------------ */

/**
 * What a guardrail id means in text.
 *
 * `PromptInvariantCheck` carries an id, a label, a rationale and a result —
 * deliberately not a predicate, because the authority on whether a version
 * passes is whatever computed the stored check. This table is the client-side
 * mirror needed for live feedback: coarse, textual, and honest about being
 * partial. An id absent from it is reported as unassessed, never as kept.
 */
interface InvariantRule {
  /** Every pattern must be present. */
  all?: RegExp[];
  /** At least one pattern must be present. */
  any?: RegExp[];
  /** Plain description of what was looked for, so a failure is actionable rather than mystifying. */
  looksFor: string;
}

/** Ids whose result comes from the declared placeholder list rather than from prose matching. */
const VARIABLE_INVARIANT_IDS = new Set(['variables_present', 'variables_intact', 'placeholders_present']);

/**
 * Per-placeholder guardrails are named `variable.<name>` by the registry —
 * one check per declared placeholder rather than one aggregate — so they are
 * matched by prefix rather than by an exhaustive list.
 */
const VARIABLE_ID_PREFIX = 'variable.';

export const INVARIANT_RULES: Record<string, InvariantRule> = {
  no_fabrication: {
    all: [/\bnever\s+invent\b/i],
    looksFor: 'an explicit "NEVER invent …" prohibition',
  },
  engine_owns_numbers: {
    any: [/never\s+restate\s+a\s+computed\s+valuation/i, /deterministic engine owns/i, /engine owns the numbers/i],
    looksFor: 'a statement that the deterministic engine owns the computed numbers',
  },
  cite_evidence: {
    all: [/\bcite\b/i, /evidence/i],
    looksFor: 'an instruction to cite the evidence a claim rests on',
  },
  label_inference: {
    all: [/inference/i, /label/i],
    looksFor: 'an instruction to label reasoning that goes beyond the evidence as inference',
  },
  verify_statute: {
    all: [/circular|statutory|statute/i, /verif/i],
    looksFor: 'a requirement that statutory figures be verified against the current circular',
  },
  uncertainty_visible: {
    any: [/uncertainty must be visible/i, /what you do not know/i, /do not answer this/i],
    looksFor: 'permission to say plainly what is not known',
  },
  refusal_allowed: {
    any: [/do not answer this/i, /correct and valuable answer/i, /refus/i],
    looksFor: 'a statement that "the documents do not answer this" is an acceptable answer',
  },
  page_reference_honesty: {
    all: [/never invent a page/i],
    looksFor: 'a prohibition on inventing a page number or reference',
  },
  no_invented_source: {
    any: [/never invent a source/i, /fabricated citation/i],
    looksFor: 'a prohibition on inventing a source URL or citation',
  },
  corpus_only: {
    all: [/corpus/i, /do not invent|only grounding|nothing else/i],
    looksFor: 'a restriction to the supplied jurisdiction corpus',
  },
  scepticism_default: {
    all: [/scepticism|sceptic/i],
    looksFor: 'scepticism named as the default posture',
  },
  unsupported_is_valid: {
    all: [/unsupported/i],
    looksFor: '"unsupported" offered as a legitimate verdict',
  },
  /*
   * The registry spells the grounding guardrails `grounding.label_inferences`
   * and `grounding.statutory_verification`; the bare forms below are what an
   * older or hand-written registry uses. Both are kept because the lookup
   * falls back to the un-namespaced id, and a guardrail this table cannot name
   * is reported as unassessed rather than as kept — silently mis-keying one
   * would be the failure mode that matters.
   */
  label_inferences: {
    all: [/inference/i, /label/i],
    looksFor: 'an instruction to label reasoning that goes beyond the evidence as inference',
  },
  statutory_verification: {
    all: [/circular|statutory|statute/i, /verif/i],
    looksFor: 'a requirement that statutory figures be verified against the current circular',
  },
  proposals_only: {
    all: [/propos/i, /never write|does not write|only propose|cannot write/i],
    looksFor: 'a statement that the agent proposes edges and never writes to the graph',
  },
};

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * `unassessed` is a first-class outcome, not a synonym for `kept`. It means a
 * guardrail was declared and this build has no way to check it here.
 */
export type InvariantState = 'kept' | 'dropped' | 'unassessed';

export interface InvariantEvaluation {
  id: string;
  label: string;
  rationale: string;
  state: InvariantState;
  /** What the checker looked for — shown when a guardrail is dropped, so the fix is obvious. */
  looksFor?: string;
  /** For placeholder guardrails: which declared variables are absent. */
  missing?: string[];
}

/**
 * Look a guardrail up by its exact id, then by the id with its namespace
 * stripped. Registries name these `grounding.no_fabrication`; a plainer one
 * may say `no_fabrication`. Anything still unmatched is unassessed.
 */
function ruleFor(id: string): InvariantRule | undefined {
  return INVARIANT_RULES[id] ?? INVARIANT_RULES[id.replace(/^[a-z_]+\./, '')];
}

/** Live check of a draft against every guardrail declared for its prompt. */
export function evaluateInvariants(prompt: PromptDescriptor, content: string): InvariantEvaluation[] {
  const missing = missingVariables(prompt, content);
  return declaredInvariants(prompt).map((declared) => {
    if (declared.id.startsWith(VARIABLE_ID_PREFIX)) {
      const name = declared.id.slice(VARIABLE_ID_PREFIX.length);
      const present = variableToken(name).test(content);
      return {
        id: declared.id,
        label: declared.label,
        rationale: declared.rationale,
        state: present ? 'kept' : 'dropped',
        looksFor: `the placeholder {{${name}}}`,
        missing: present ? [] : [name],
      };
    }
    if (VARIABLE_INVARIANT_IDS.has(declared.id)) {
      return {
        id: declared.id,
        label: declared.label,
        rationale: declared.rationale,
        state: missing.length === 0 ? 'kept' : 'dropped',
        looksFor: `every declared placeholder: ${prompt.variables.join(', ') || 'none declared'}`,
        missing,
      };
    }
    const rule = ruleFor(declared.id);
    if (!rule) {
      return { id: declared.id, label: declared.label, rationale: declared.rationale, state: 'unassessed' };
    }
    const allOk = (rule.all ?? []).every((re) => re.test(content));
    const anyOk = rule.any ? rule.any.some((re) => re.test(content)) : true;
    return {
      id: declared.id,
      label: declared.label,
      rationale: declared.rationale,
      state: allOk && anyOk ? 'kept' : 'dropped',
      looksFor: rule.looksFor,
    };
  });
}

/**
 * Freeze a live evaluation into the booleans a version stores.
 *
 * Fails closed on `unassessed` — see rule 3 in the file header. A server that
 * computes its own checks overrides this entirely; the descriptor it returns
 * is what the page renders, never the prediction made here.
 */
export function toChecks(evaluations: InvariantEvaluation[]): PromptInvariantCheck[] {
  return evaluations.map((e) => ({
    id: e.id,
    label: e.label,
    rationale: e.rationale,
    satisfied: e.state === 'kept',
  }));
}

export function droppedEvaluations(evaluations: InvariantEvaluation[]): InvariantEvaluation[] {
  return evaluations.filter((e) => e.state === 'dropped');
}

export function unassessedEvaluations(evaluations: InvariantEvaluation[]): InvariantEvaluation[] {
  return evaluations.filter((e) => e.state === 'unassessed');
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

const STATE_WORD: Record<InvariantState, string> = {
  kept: 'Kept',
  dropped: 'Dropped',
  unassessed: 'Not checked here',
};

const STATE_ICON: Record<InvariantState, typeof Check> = {
  kept: Check,
  dropped: XCircle,
  unassessed: CircleHelp,
};

/**
 * One row per declared guardrail.
 *
 * State is carried by an icon, a word and a colour together — never colour
 * alone — because this is the readout someone scans while deciding whether a
 * prompt is safe to ship, and a red dot they cannot see is a guarantee they
 * cannot check. The rationale is always shown rather than tucked into a
 * tooltip: it is written in product terms precisely so that a person who is
 * not a prompt engineer can tell what deleting the line costs.
 */
export function InvariantList({
  evaluations,
  className,
  dense,
}: {
  evaluations: InvariantEvaluation[];
  className?: string;
  dense?: boolean;
}) {
  if (evaluations.length === 0) {
    return (
      <p className={cn('text-xs text-ink-muted', className)}>
        No guardrails are declared for this prompt, so nothing here is checked automatically.
      </p>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {evaluations.map((e) => {
        const Icon = STATE_ICON[e.state];
        return (
          <li
            key={e.id}
            data-testid={`invariant-${e.id}`}
            data-state={e.state}
            className={cn(
              'rounded-lg p-2.5 ring-1 ring-inset',
              e.state === 'dropped' && 'bg-critical/10 ring-critical/40',
              e.state === 'kept' && 'bg-sunken ring-[var(--ring)]',
              e.state === 'unassessed' && 'bg-warning/10 ring-warning/40',
            )}
          >
            <div className="flex items-start gap-2">
              <Icon
                size={14}
                className={cn(
                  'mt-0.5 shrink-0',
                  e.state === 'dropped' && 'text-critical',
                  e.state === 'kept' && 'text-[var(--status-good-text)]',
                  e.state === 'unassessed' && 'text-ink-secondary',
                )}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-medium text-ink">{e.label}</span>
                  <span
                    className={cn(
                      'text-mini font-semibold uppercase tracking-[0.06em]',
                      e.state === 'dropped' && 'text-critical',
                      e.state === 'kept' && 'text-[var(--status-good-text)]',
                      e.state === 'unassessed' && 'text-ink-secondary',
                    )}
                  >
                    {STATE_WORD[e.state]}
                  </span>
                  <span className="font-mono text-micro text-ink-muted">{e.id}</span>
                </div>
                {!dense || e.state !== 'kept' ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{e.rationale}</p>
                ) : null}
                {e.state === 'dropped' && e.missing && e.missing.length > 0 ? (
                  <p className="mt-1 text-mini leading-relaxed text-critical">
                    Missing placeholder{e.missing.length > 1 ? 's' : ''}:{' '}
                    {e.missing.map((m) => (
                      <span key={m} className="font-mono">
                        {`{{${m}}} `}
                      </span>
                    ))}
                  </p>
                ) : null}
                {e.state === 'dropped' && e.looksFor && !e.missing ? (
                  <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
                    This version no longer contains {e.looksFor}.
                  </p>
                ) : null}
                {e.state === 'unassessed' ? (
                  <p className="mt-1 text-mini leading-relaxed text-ink-secondary">
                    This build has no rule for this guardrail, so the editor cannot tell you whether the draft keeps
                    it. It is not being reported as kept. Saving records it as unmet unless the server checks it.
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}


/* ------------------------------------------------------------------ */
/* Consequence, and the waiver that has to be typed out               */
/* ------------------------------------------------------------------ */

/**
 * What running on an unguarded version actually costs, in product terms.
 *
 * Stated in one place and repeated everywhere it applies — the page banner,
 * the prompt header, the version row, and the dialog that lets someone do it
 * anyway — because a consequence a user can scroll past is a consequence they
 * will scroll past. The second sentence is the one that matters operationally:
 * the results are still identifiable afterwards, which is precisely why they
 * must not be filed alongside guaranteed ones.
 */
export const UNGUARDED_CONSEQUENCE =
  'Findings produced under this version are not covered by the anti-fabrication guarantee. Every run records the ' +
  'guardrails that were unmet, so those findings can be identified later — but until they are checked against the ' +
  'source they must not be treated as equivalent to findings produced under a version that kept them.';

/** The exact words someone must type to give up specific guardrails. Naming the ids makes it impossible to do absent-mindedly. */
export function guardrailWaiverPhrase(ids: string[]): string {
  return `drop ${ids.join(' ')}`;
}

/**
 * The deliberate confirmation.
 *
 * Two gestures, both specific. Every guardrail being given up must be
 * acknowledged individually — with its rationale next to the tick, so the
 * acknowledgement is of a consequence rather than of a checkbox — and the
 * exact phrase naming those guardrails by id must be typed out. A generic
 * "are you sure" would be answered reflexively; typing
 * `drop no_fabrication` cannot be.
 *
 * This dialog guards two different acts that have the same effect: saving a
 * version that drops a guardrail, and switching the active version to one that
 * already does. Both put unguarded text into production, so both cost the same
 * keystrokes.
 */
export function GuardrailWaiver({
  open,
  onClose,
  onConfirm,
  title,
  lead,
  dropped,
  actionLabel,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  lead: string;
  dropped: Pick<PromptInvariantCheck, 'id' | 'label' | 'rationale'>[];
  actionLabel: string;
  busy?: boolean;
}) {
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState('');

  // The identity of *which* guardrails are being waived, not the array, which
  // is rebuilt on every render and would reset the consent under the reader's
  // hands mid-sentence.
  const droppedKey = dropped.map((d) => d.id).join('|');

  // Reopening must not inherit a previous session's consent.
  useEffect(() => {
    if (open) {
      setAcked({});
      setTyped('');
    }
  }, [open, droppedKey]);

  const phrase = guardrailWaiverPhrase(dropped.map((d) => d.id));
  const allAcked = dropped.every((d) => acked[d.id]);
  const phraseOk = typed.trim() === phrase;
  const ready = allAcked && phraseOk && !busy;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="md"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={!ready}
            loading={busy}
            data-testid="waiver-confirm"
            icon={<ShieldAlert size={14} />}
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-ink">{lead}</p>

        <div className="rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
          <p className="text-xs font-semibold text-critical">What this gives up</p>
          <ul className="mt-2 flex flex-col gap-2">
            {dropped.map((d) => (
              <li key={d.id}>
                <Checkbox
                  checked={Boolean(acked[d.id])}
                  onChange={(next) => setAcked((prev) => ({ ...prev, [d.id]: next }))}
                  label={
                    <span>
                      <span className="font-medium text-ink">{d.label}</span>{' '}
                      <span className="font-mono text-micro text-ink-muted">{d.id}</span>
                      <span className="mt-0.5 block text-mini leading-relaxed text-ink-secondary">{d.rationale}</span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs leading-relaxed text-ink-secondary">{UNGUARDED_CONSEQUENCE}</p>

        <Field
          label={
            <span>
              Type <span className="font-mono text-ink">{phrase}</span> to confirm
            </span>
          }
          htmlFor="guardrail-waiver-phrase"
          error={typed.length > 0 && !phraseOk ? 'That is not the phrase. It names the guardrails being given up.' : null}
        >
          <Input
            id="guardrail-waiver-phrase"
            data-testid="waiver-phrase"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={phrase}
            className="font-mono"
          />
        </Field>
      </div>
    </Modal>
  );
}

export default InvariantList;
