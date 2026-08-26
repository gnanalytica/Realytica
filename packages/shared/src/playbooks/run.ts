/**
 * Playbook runner.
 *
 * Turns the three Karnataka procedures into `PlaybookRun`s for a case. Pure,
 * deterministic and clock-free in exactly the way `engine.ts` is: `now`
 * arrives as an ISO string, nothing calls `Date.now()` or `Math.random()`, and
 * two invocations on the same inputs produce structurally identical output.
 *
 * THE GATE IS ENFORCED HERE, AND ONLY HERE.
 * -----------------------------------------
 * A step's `evaluate` function is called only after its prerequisites have
 * been checked and found `clear`. If any prerequisite is anything else —
 * `attention`, `blocked`, `not_started`, `not_applicable` — the runner emits
 * `blocked`, names the prerequisite keys in `blockedBy`, quotes the
 * prerequisite's own finding so the user can see what is actually holding the
 * procedure up, and moves on without ever invoking the evaluator. The step
 * therefore cannot produce a guess, because it does not run.
 *
 * That strictness is deliberate even where it looks blunt. A prerequisite that
 * is `not_applicable` still blocks, because the gates in these playbooks are
 * only ever placed where the prerequisite being *satisfied* is what gives the
 * dependent step its meaning; a step that should proceed regardless of a
 * not-applicable predecessor is not gated on it in the first place. Where that
 * design choice was finely balanced — the area-basis step, the layout-sanction
 * step — the playbook modules say so at the point of declaration.
 *
 * Blocked steps are not failures and are not scored as such. `progressPct`
 * counts only the steps that could actually be evaluated.
 */

import type {
  CaseDocument,
  ComplianceCheck,
  ComplianceVerdict,
  DocumentKind,
  ExtractedField,
  PlaybookRun,
  PlaybookStepResult,
  PlaybookStepState,
  PropertyCase,
  ScreenResult,
} from '../types';
import { KARNATAKA_TITLE_CHAIN_PLAYBOOK } from './karnataka-title-chain';
import { KARNATAKA_LAND_USE_PLAYBOOK } from './karnataka-land-use';
import { KARNATAKA_KHATA_AREA_PLAYBOOK } from './karnataka-khata-area';
import type { Playbook, PlaybookContext, PlaybookStep, StepOutcome, StepSeverity } from './types';
import { isoYear } from './types';

/**
 * Declaration order is the order the runs come back in, and it is the order a
 * practitioner works in: establish title, then establish that the use of the
 * land is lawful, then reconcile the register and the areas. The third
 * procedure is last because its output is only worth reading once the first
 * two have said what the property actually is.
 */
export const KARNATAKA_PLAYBOOKS: Playbook[] = [
  KARNATAKA_TITLE_CHAIN_PLAYBOOK,
  KARNATAKA_LAND_USE_PLAYBOOK,
  KARNATAKA_KHATA_AREA_PLAYBOOK,
];

/* ==================================================================== */
/* Context                                                              */
/* ==================================================================== */

function buildContext(propertyCase: PropertyCase, result: ScreenResult | undefined, now: string): PlaybookContext {
  const documents = propertyCase.documents;
  const evidence = result?.evidence ?? [];
  const checks = result?.stateCompliance?.checks ?? [];

  const doc = (kind: DocumentKind): CaseDocument | undefined => documents.find(d => d.kind === kind);

  const field = (kind: DocumentKind, key: string): ExtractedField | undefined => doc(kind)?.extracted.find(f => f.key === key);

  return {
    propertyCase,
    identity: propertyCase.identity,
    karnataka: propertyCase.identity.karnataka,
    documents,
    result,
    now,
    nowYear: isoYear(now) ?? 0,

    doc,
    hasDoc: (kind: DocumentKind): boolean => doc(kind) !== undefined,
    field,
    fieldValue: (kind: DocumentKind, key: string): string | undefined => field(kind, key)?.value,

    evidenceForDoc: (kind: DocumentKind): string[] => {
      const d = doc(kind);
      if (!d) return [];
      return evidence.filter(e => e.sourceRef === d.id).map(e => e.id);
    },

    evidenceForField: (kind: DocumentKind, key: string): string[] => {
      const d = doc(kind);
      const f = field(kind, key);
      if (!d || !f) return [];
      // `runScreen` mints one evidence item per extracted field, stating it as
      // `"<label>: <value> (from <fileName>)."` — match on that shape rather
      // than on position, which would break the moment extraction order moves.
      return evidence.filter(e => e.sourceRef === d.id && e.statement.startsWith(`${f.label}:`)).map(e => e.id);
    },

    evidenceForRef: (ref: string): string[] => evidence.filter(e => e.sourceRef === ref).map(e => e.id),

    check: (key: string): ComplianceCheck | undefined => checks.find(c => c.key === key),
  };
}

/* ==================================================================== */
/* Applicability gate for the whole set                                 */
/* ==================================================================== */

/**
 * These are Karnataka procedures — every authority, register and statute in
 * them is state-specific, and several are specific to Bengaluru. Running them
 * against an Amsterdam case and reporting twenty-one `not_applicable` steps
 * would be noise dressed as thoroughness, so a non-Karnataka case gets no runs
 * at all rather than a wall of negatives.
 *
 * Within Karnataka the opposite rule applies: an inapplicable *step* is
 * reported, not omitted, because there the reader needs to see the procedure
 * was considered in full.
 */
export function playbooksApplyTo(propertyCase: PropertyCase): boolean {
  const identity = propertyCase.identity;
  return identity.country === 'IN' && identity.state.trim().toLowerCase() === 'karnataka';
}

/* ==================================================================== */
/* Running one playbook                                                 */
/* ==================================================================== */

/** Steps in these states were actually evaluated and count toward progress. */
const EVALUABLE_STATES: PlaybookStepState[] = ['clear', 'attention', 'not_started'];

function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/s.exec(text.trim());
  const sentence = match ? match[1] : text.trim();
  return sentence.length > 260 ? `${sentence.slice(0, 257)}...` : sentence;
}

function blockedFinding(step: PlaybookStep, blockers: { key: string; label: string; state: PlaybookStepState; finding: string }[]): string {
  const named = blockers.map(b => `"${b.label}" (${b.key}, currently ${b.state})`).join(' and ');
  const quoted = blockers.map(b => `${b.label}: ${firstSentence(b.finding)}`).join(' ');
  return (
    `NOT EVALUATED — this step is gated on ${named}. ${quoted} ` +
    'No finding is asserted here, and none should be inferred: an answer produced at this point would rest on the ' +
    'unresolved position above rather than on anything in the file, which is the specific failure this procedure exists ' +
    'to avoid. This is a gate, not a defect — the step may well be satisfied once the prerequisite is resolved, and it ' +
    'will be evaluated as soon as it is.'
  );
}

function notApplicableStep(step: PlaybookStep, reason: string): PlaybookStepResult {
  return {
    key: step.key,
    label: step.label,
    question: step.question,
    state: 'not_applicable',
    finding: `NOT APPLICABLE to this property. ${reason}`,
    requires: step.requires,
    evidenceIds: [],
    needs: [],
    citation: step.citation,
  };
}

/** Keeps `evidenceIds` honest: only ids the screen actually minted, no duplicates. */
function cleanEvidenceIds(ids: string[] | undefined, known: Set<string>): string[] {
  if (!ids || ids.length === 0) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function resolveNeeds(step: PlaybookStep, outcome: StepOutcome): DocumentKind[] {
  if (outcome.needs) return outcome.needs;
  return outcome.state === 'clear' || outcome.state === 'not_applicable' ? [] : step.needs;
}

function runOne(playbook: Playbook, ctx: PlaybookContext): PlaybookRun {
  const knownEvidenceIds = new Set((ctx.result?.evidence ?? []).map(e => e.id));
  const applicability = playbook.applicability(ctx);

  if (!applicability.applicable) {
    const steps = playbook.steps.map(step => notApplicableStep(step, applicability.reason));
    return {
      playbookId: playbook.id,
      label: playbook.label,
      authorityContext: playbook.authorityContext,
      steps,
      // Nothing in this procedure is outstanding, because none of it arises.
      // Reporting 0% here would read as failure on a procedure that was
      // correctly not run.
      progressPct: 100,
      nextStepKey: undefined,
      // Matches how `engine.ts` treats a compliance check that does not apply:
      // `clear` with a finding that says why, never `unknown`, which would
      // imply something unresolved.
      verdict: 'clear',
    };
  }

  const results: PlaybookStepResult[] = [];
  const byKey = new Map<string, PlaybookStepResult>();
  const severities = new Map<string, StepSeverity>();

  for (const step of playbook.steps) {
    const blockers = step.requires
      .map(key => byKey.get(key))
      .filter((r): r is PlaybookStepResult => r !== undefined)
      .filter(r => r.state !== 'clear');

    // A prerequisite naming a step that does not exist is a definition bug,
    // not a runtime condition — treat it as blocking rather than silently
    // evaluating past it, so the mistake surfaces instead of hiding.
    const missingPrereqs = step.requires.filter(key => !byKey.has(key));

    if (blockers.length > 0 || missingPrereqs.length > 0) {
      const described = [
        ...blockers.map(b => ({ key: b.key, label: b.label, state: b.state, finding: b.finding })),
        ...missingPrereqs.map(key => ({
          key,
          label: key,
          state: 'not_started' as PlaybookStepState,
          finding: `Prerequisite step "${key}" is not defined earlier in this playbook, so it has not been evaluated.`,
        })),
      ];
      const result: PlaybookStepResult = {
        key: step.key,
        label: step.label,
        question: step.question,
        state: 'blocked',
        finding: blockedFinding(step, described),
        requires: step.requires,
        blockedBy: described.map(d => d.key),
        evidenceIds: [],
        needs: step.needs,
        citation: step.citation,
      };
      results.push(result);
      byKey.set(step.key, result);
      continue;
    }

    const outcome = step.evaluate(ctx);
    const result: PlaybookStepResult = {
      key: step.key,
      label: step.label,
      question: step.question,
      state: outcome.state,
      finding: outcome.finding.trim(),
      requires: step.requires,
      evidenceIds: cleanEvidenceIds(outcome.evidenceIds, knownEvidenceIds),
      needs: resolveNeeds(step, outcome),
      citation: step.citation,
    };
    results.push(result);
    byKey.set(step.key, result);
    if (outcome.state === 'attention') severities.set(step.key, outcome.severity ?? 'attention');
  }

  const evaluable = results.filter(r => EVALUABLE_STATES.includes(r.state));
  const clearCount = evaluable.filter(r => r.state === 'clear').length;
  const progressPct = evaluable.length > 0 ? Math.round((clearCount / evaluable.length) * 100) : 0;

  // Where the user should look first: the earliest step that is actionable.
  // A blocked step is never the answer to that question — the thing blocking
  // it is, and that is by construction an earlier step.
  const nextStepKey = results.find(r => r.state === 'not_started' || r.state === 'attention')?.key;

  return {
    playbookId: playbook.id,
    label: playbook.label,
    authorityContext: playbook.authorityContext,
    steps: results,
    progressPct,
    nextStepKey,
    verdict: verdictFor(results, severities),
  };
}

/**
 * Rolls the steps up to one `ComplianceVerdict`.
 *
 * `unknown` is reserved for the case that matters most and is easiest to get
 * wrong: a procedure that could not be started. A file with no mother deed
 * produces one `not_started` step and six `blocked` ones, and the honest
 * verdict on it is not "attention" — it is that nobody knows whether this
 * title is marketable, because the file does not let anyone begin.
 */
function verdictFor(steps: PlaybookStepResult[], severities: Map<string, StepSeverity>): ComplianceVerdict {
  const hasBlockerSeverity = steps.some(s => s.state === 'attention' && severities.get(s.key) === 'blocker');
  if (hasBlockerSeverity) return 'blocker';

  const anyAnswered = steps.some(s => s.state === 'clear' || s.state === 'attention');
  if (!anyAnswered) return 'unknown';

  const anyOutstanding = steps.some(s => s.state === 'attention' || s.state === 'not_started' || s.state === 'blocked');
  return anyOutstanding ? 'attention' : 'clear';
}

/* ==================================================================== */
/* Entry point                                                          */
/* ==================================================================== */

/**
 * Evaluates every Karnataka diligence playbook against a case.
 *
 * @param propertyCase the case, whose `documents` and `identity.karnataka` are
 *   the grounding for every finding produced.
 * @param result the screen, when one exists. Supplying it is what lets steps
 *   cite real `EvidenceItem` ids and read the planning position; omitting it
 *   costs evidence trails and one step's answer, and costs nothing else.
 * @param now ISO instant. The only clock this module has.
 *
 * Returns an empty array for a case outside Karnataka — see `playbooksApplyTo`.
 */
export function runPlaybooks(propertyCase: PropertyCase, result: ScreenResult | undefined, now: string): PlaybookRun[] {
  if (!playbooksApplyTo(propertyCase)) return [];
  const ctx = buildContext(propertyCase, result, now);
  return KARNATAKA_PLAYBOOKS.map(playbook => runOne(playbook, ctx));
}
