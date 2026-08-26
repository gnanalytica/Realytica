/**
 * What each node produced, in the one line a user reads without opening it.
 *
 * A run graph that only showed which boxes lit up would answer "did it run"
 * and nothing else. The question a person actually brings to this canvas is
 * "was it worth running" — did the extraction find fields, did the research
 * contradict the engine, did the critic flag anything, did the re-screen move
 * the verdict. So every node carries its own yield, counted.
 *
 * ## Where the counts come from, and why not from the runs
 *
 * Wherever the case holds the artefact itself, the count is taken from the
 * artefact. `intelligence.pathways`, `.research`, `.insights` and
 * `.verification` are REPLACED on every orchestration (see
 * `applyOrchestrationResult` in `apps/api/src/routes/agents.ts`), so they
 * describe the run being graphed and not an older one — counting them is exact
 * and stays exact if a summary string is ever reworded.
 *
 * Three things have no home on `CaseIntelligence` and are read off the run's
 * own `summary`, which the agent code composes deterministically: the document
 * intelligence classification, the diligence planner's proposed-action count,
 * and its draft count. `proposedActions` and `drafts` travel on
 * `RunOrchestrationResult` and are never persisted, so the summary is the only
 * surviving record. Each parse degrades to "no output" rather than to a wrong
 * number if the sentence changes.
 *
 * ## What is deliberately not claimed
 *
 * The kind a document held *before* document intelligence ran is recorded
 * nowhere — the merge overwrites it and no step names it. So a node reports
 * the classification the run made and whether it was adopted, rather than
 * asserting a reclassification it cannot see. The same rule governs the
 * pre-run screen node: the change list in the orchestrator's step log names
 * the verdict, band and gap count that moved, and nothing else, so the prior
 * indicative range is not shown rather than shown stale.
 */

import type {
  AgentRun,
  CaseDocument,
  CaseIntelligence,
  ExplorationSession,
  IndicativeValue,
  PropertyCase,
  RunGraphOutput,
  ScreenResult,
} from '@valytica/shared';
import type { FeedbackLoopReading, RunPlacement } from './lanes';

/* ==================================================================== */
/* Formatting                                                            */
/* ==================================================================== */

/**
 * Thousands grouping without `Intl`.
 *
 * `Intl.NumberFormat` output varies with the ICU build a runtime was compiled
 * against, and this module's whole contract is that the same case produces a
 * byte-identical graph. A hand-rolled grouping is one line and cannot drift.
 */
function grouped(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function money(amount: number, currency: string): string {
  return `${currency} ${grouped(amount)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeRange(value: IndicativeValue): string {
  return (
    `${money(value.low, value.currency)}–${money(value.high, value.currency)} ` +
    `(mid ${money(value.mid, value.currency)}, spread ±${Math.round(value.spreadPct)}%)`
  );
}

/* ==================================================================== */
/* Linking runs to what they touched                                     */
/* ==================================================================== */

/**
 * Which document a document intelligence run read.
 *
 * The run carries no document id field, but it carries the evidence it
 * produced, and `document-intelligence.ts` mints those ids as
 * `ev-doc-<documentId>-<n>`. Matching by prefix against the case's own
 * documents is exact and survives document ids that themselves contain
 * hyphens, which a regex over the evidence id would not.
 *
 * A run that extracted nothing produced no evidence, so the fallback is the
 * file name quoted in its first step (`Classifying and extracting "…"`). A run
 * that failed before that step — no credentials, unsupported type — is left
 * unresolved, and its node is labelled by its agent rather than by a document
 * it never opened.
 */
export function documentIdForRun(run: AgentRun, documents: readonly CaseDocument[]): string | undefined {
  for (const document of documents) {
    const prefix = `ev-doc-${document.id}-`;
    if (run.producedEvidenceIds.some(id => id.startsWith(prefix))) return document.id;
  }
  const fileName = fileNameFromSteps(run);
  if (fileName === undefined) return undefined;
  return documents.find(d => d.fileName === fileName)?.id;
}

/** The file name quoted in the run's own step log, when one is there. */
export function fileNameFromSteps(run: AgentRun): string | undefined {
  for (const step of run.steps) {
    const match = /"([^"]+)"/.exec(step.label);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Pairs explorer runs with the sessions they produced.
 *
 * `ExplorationSession` carries no run id, and its `startedAt` is the injected
 * `now` rather than the run's clock, so the two cannot be joined on a field.
 * What is reliable is the append order: `applyOrchestrationResult` and the
 * /explore route both push sessions onto the end of
 * `intelligence.explorations` in the order their runs produced them, and the
 * orchestrator schedules the explorer at most once per run. Taking the last N
 * sessions for the N explorer runs on this graph therefore pairs correctly,
 * and pairs nothing at all when the counts disagree rather than pairing a run
 * with someone else's session.
 */
export function pairExplorations(
  explorerRuns: readonly AgentRun[],
  sessions: readonly ExplorationSession[],
): Map<string, ExplorationSession> {
  const paired = new Map<string, ExplorationSession>();
  if (explorerRuns.length === 0 || sessions.length < explorerRuns.length) return paired;
  const tail = sessions.slice(sessions.length - explorerRuns.length);
  explorerRuns.forEach((run, i) => paired.set(run.id, tail[i]));
  return paired;
}

/* ==================================================================== */
/* Outcome                                                               */
/* ==================================================================== */

/**
 * A refusal is a failure with a different meaning, and the frozen
 * `AgentRunStatus` has no state for it.
 *
 * Every agent in this package records a safety decline as `status: 'failed'`
 * with an error saying the model declined — the same status a missing
 * credential or a schema mismatch gets. On the canvas those are not the same
 * event: a refusal is the model choosing not to answer, which a user resolves
 * by changing the input, and a failure is the machinery breaking, which they
 * resolve by fixing the machinery. So the distinction is recovered from the
 * error text and the step log and stated on the node's `detail`.
 *
 * The false positive to know about: an error whose text happens to contain
 * "refused" — a refused TCP connection, say — reads as a refusal here. That is
 * the cheaper mistake, because the full error text is on the node beside it.
 */
export function wasRefused(run: AgentRun): boolean {
  if (run.status !== 'failed') return false;
  const error = (run.error ?? '').toLowerCase();
  if (error.includes('declined') || error.includes('refus')) return true;
  return run.steps.some(s => s.kind === 'error' && s.label.toLowerCase().includes('refus'));
}

/** The clause that opens a node's `detail`, naming what kind of ending this was. */
export function describeOutcome(run: AgentRun): string | undefined {
  switch (run.status) {
    case 'succeeded':
      return undefined;
    case 'failed':
      return wasRefused(run) ? 'Refused by the model —' : 'Failed —';
    case 'cancelled':
      // `cancelled` is how this package spells "deliberately not attempted"
      // (see the comment on the unsupported-file-type branch in
      // `document-intelligence.ts`), which is not the same as breaking.
      return 'Not attempted —';
    case 'queued':
      return 'Queued —';
    case 'running':
      return 'Still running —';
  }
}

/* ==================================================================== */
/* Per-agent yield                                                       */
/* ==================================================================== */

export interface OutputContext {
  caseData: PropertyCase;
  intelligence?: CaseIntelligence;
  feedback: FeedbackLoopReading;
  /** Explorer run id to the session it produced. See `pairExplorations`. */
  explorationByRunId: Map<string, ExplorationSession>;
}

function documentIntelligenceOutputs(placement: RunPlacement, ctx: OutputContext): RunGraphOutput[] {
  const run = placement.run;
  if (!run) return [];
  const document = ctx.caseData.documents.find(d => d.id === placement.documentId);
  const where = document ? `"${document.fileName}"` : 'this document';
  const outputs: RunGraphOutput[] = [];

  // `Classified as <kind> (<n>% confidence); extracted <n> field(s)` — composed
  // in `document-intelligence.ts` and the only record of what THIS run read,
  // as opposed to what the document holds after every run that touched it.
  const parsed = /^Classified as ([a-z_]+) \((\d+)% confidence\); extracted (\d+) field\(s\)/.exec(run.summary ?? '');
  const fieldCount = parsed ? Number(parsed[3]) : undefined;

  if (fieldCount !== undefined) {
    outputs.push({
      key: 'fields',
      label: 'Fields extracted',
      count: fieldCount,
      summary:
        fieldCount === 0
          ? `No fields could be read from ${where}.`
          : `${plural(fieldCount, 'field')} read from ${where} and merged onto the document.`,
    });
  }

  if (parsed) {
    const kind = parsed[1];
    const confidence = Number(parsed[2]);
    // Three states, and only three are knowable. The kind the document held
    // before this run is not recorded anywhere, so "reclassified" is reported
    // as what became of this run's call rather than as a change it cannot see.
    const adoption = !document
      ? 'the document could not be resolved, so adoption is unknown'
      : document.kindConfirmedByUser && document.kind !== kind
        ? `not adopted — a human confirmed "${document.kind}" and that stands`
        : document.kind === kind
          ? 'adopted onto the document'
          : `not applied — the document still holds "${document.kind}"`;
    outputs.push({
      key: 'classification',
      label: 'Classification',
      summary: `Read as "${kind}" at ${confidence}% confidence; ${adoption}.`,
    });
  }

  if (run.producedEvidenceIds.length > 0) {
    outputs.push({
      key: 'evidence',
      label: 'Evidence added',
      count: run.producedEvidenceIds.length,
      summary: `${plural(run.producedEvidenceIds.length, 'item')} added to the case's evidence ledger.`,
    });
  }

  return outputs;
}

function proofPathwayOutputs(ctx: OutputContext): RunGraphOutput[] {
  const pathways = ctx.intelligence?.pathways ?? [];
  if (pathways.length === 0) return [];
  const routes = pathways.flatMap(p => p.routes);
  const withoutRoute = pathways.filter(p => p.routes.length === 0).length;
  const blocked = routes.filter(r => r.feasibility === 'blocked').length;
  const straightforward = routes.filter(r => r.feasibility === 'straightforward').length;

  return [
    {
      key: 'pathways',
      label: 'Proof pathways',
      count: pathways.length,
      summary:
        `${plural(pathways.length, 'gap')} given a route to closure` +
        (withoutRoute > 0 ? `; ${withoutRoute} left with no known route at all` : '') +
        '.',
    },
    {
      key: 'routes',
      label: 'Proof routes',
      count: routes.length,
      summary: `${plural(routes.length, 'route')} costed and sequenced — ${straightforward} straightforward, ${blocked} blocked.`,
    },
  ];
}

function marketResearchOutputs(ctx: OutputContext): RunGraphOutput[] {
  const findings = ctx.intelligence?.research ?? [];
  if (findings.length === 0) return [];
  const contradicting = findings.filter(f => f.contradictsEngine).length;
  const uncorroborated = findings.filter(f => f.corroboration === 'uncorroborated').length;

  return [
    {
      key: 'findings',
      label: 'Research findings',
      count: findings.length,
      summary:
        `${plural(findings.length, 'finding')}, ${uncorroborated} uncorroborated. ` +
        (contradicting > 0
          ? `${plural(contradicting, 'finding')} contradict what the deterministic engine holds — the engine's number stands until a human resolves it.`
          : 'None contradict the deterministic engine.'),
    },
  ];
}

/** `<n> insight(s), <n> new action(s), <n> draft message(s) for review` — composed in `diligence-planner.ts`. */
const DILIGENCE_SUMMARY = /^(\d+) insight\(s\), (\d+) new action\(s\), (\d+) draft message\(s\)/;

function diligencePlannerOutputs(run: AgentRun, ctx: OutputContext): RunGraphOutput[] {
  const insights = ctx.intelligence?.insights ?? [];
  const parsed = DILIGENCE_SUMMARY.exec(run.summary ?? '');
  const outputs: RunGraphOutput[] = [];

  if (insights.length > 0) {
    const high = insights.filter(i => i.importance === 'high').length;
    const inferred = insights.filter(i => i.inferred).length;
    outputs.push({
      key: 'insights',
      label: 'Insights',
      count: insights.length,
      summary: `${plural(insights.length, 'insight')} — ${high} high importance, ${inferred} resting on model reasoning rather than a documented fact.`,
    });
  }

  if (parsed) {
    const actions = Number(parsed[2]);
    const drafts = Number(parsed[3]);
    outputs.push({
      key: 'actions',
      label: 'Proposed actions',
      count: actions,
      summary:
        actions === 0
          ? 'No new actions beyond the ones the engine already recommends.'
          : `${plural(actions, 'action')} proposed on top of the engine's own, not yet adopted onto the case.`,
    });
    if (drafts > 0) {
      outputs.push({
        key: 'drafts',
        label: 'Outreach drafts',
        count: drafts,
        summary: `${plural(drafts, 'message')} drafted for a human to review — Valytica never sends these.`,
      });
    }
  }

  return outputs;
}

function criticOutputs(ctx: OutputContext): RunGraphOutput[] {
  const verification = ctx.intelligence?.verification;
  if (!verification) return [];
  return [
    {
      key: 'grounding',
      label: 'Grounding score',
      count: verification.groundingScore,
      summary: `${verification.groundingScore}/100 of the claims checked came back supported.`,
    },
    {
      key: 'flagged',
      label: 'Flagged claims',
      count: verification.flaggedIds.length,
      summary:
        verification.flaggedIds.length === 0
          ? `${plural(verification.checkedCount, 'claim')} checked, none unsupported or contradicted.`
          : `${plural(verification.flaggedIds.length, 'claim')} of ${verification.checkedCount} flagged as unsupported or contradicted — the UI must mark these.`,
    },
  ];
}

function explorerOutputs(run: AgentRun, ctx: OutputContext): RunGraphOutput[] {
  const session = ctx.explorationByRunId.get(run.id);
  if (!session) return [];
  const deadEnds = session.leads.filter(l => l.outcome === 'dead_end').length;
  const answered = session.leads.filter(l => l.outcome === 'answered').length;

  const outputs: RunGraphOutput[] = [
    {
      key: 'leads',
      label: 'Leads',
      count: session.leads.length,
      summary: `${plural(session.leads.length, 'lead')} followed over ${plural(session.iterations, 'iteration')} — ${answered} answered, ${deadEnds} dead ${deadEnds === 1 ? 'end' : 'ends'}; stopped because ${session.stoppedBecause.replace(/_/g, ' ')}.`,
    },
  ];

  // Named even when empty would be noise, but named when non-empty is the
  // whole honesty argument for this agent: a source list that omits what could
  // not be reached says the diligence was more complete than it was.
  if (session.unreachable.length > 0) {
    outputs.push({
      key: 'unreachable',
      label: 'Unreachable sources',
      count: session.unreachable.length,
      summary: `${plural(session.unreachable.length, 'source')} could not be reached, so ${session.unreachable.length === 1 ? 'it was' : 'they were'} not checked: ${session.unreachable.map(u => u.source).join(', ')}.`,
    });
  }
  if (session.openQuestions.length > 0) {
    outputs.push({
      key: 'open_questions',
      label: 'Open questions',
      count: session.openQuestions.length,
      summary: `${plural(session.openQuestions.length, 'question')} the agent says it still cannot answer.`,
    });
  }
  return outputs;
}

function plannerOutputs(run: AgentRun, ctx: OutputContext): RunGraphOutput[] {
  const plan = ctx.intelligence?.plan;
  if (!plan) return [];
  const toRun = plan.tasks.filter(t => t.depth !== 'skip');
  const outputs: RunGraphOutput[] = [
    {
      key: 'tasks',
      label: 'Scheduled',
      count: toRun.length,
      summary:
        toRun.length === 0
          ? 'Nothing to run — every available agent was skipped.'
          : `${toRun.length} of ${plan.tasks.length} agent(s) to run: ${toRun.map(t => `${t.agent} (${t.depth})`).join(', ')}.`,
    },
  ];
  if (plan.deliberateOmissions.length > 0) {
    outputs.push({
      key: 'omissions',
      label: 'Deliberate omissions',
      count: plan.deliberateOmissions.length,
      summary: plan.deliberateOmissions.join(' | '),
    });
  }
  outputs.push({
    key: 'estimate',
    label: 'Estimated cost',
    summary: `Planner estimated $${plan.estimatedCostUsd} for this run.`,
  });
  // The planner's own run failing does not stop the orchestration — it falls
  // back to the fixed pipeline — so the node has to say which of the two plans
  // is on screen, or a user reads a fixed pipeline as a considered decision.
  if (run.status === 'failed') {
    outputs.push({
      key: 'fallback',
      label: 'Static fallback',
      summary: 'The live planning call failed, so this is the fixed pipeline at standard depth, not a case-specific plan.',
    });
  }
  return outputs;
}

/** Everything a run produced, or nothing at all when it did not finish. */
export function outputsForRun(placement: RunPlacement, ctx: OutputContext): RunGraphOutput[] {
  const run = placement.run;
  if (!run) return [];

  // A run that failed, refused or was never attempted produced nothing. The
  // case-level artefacts it would otherwise be credited with came from an
  // earlier run or from another agent, and attributing them here would make a
  // failure look productive.
  if (run.status !== 'succeeded') return [];

  switch (run.agent) {
    case 'planner':
      return plannerOutputs(run, ctx);
    case 'document_intelligence':
      return documentIntelligenceOutputs(placement, ctx);
    case 'proof_pathways':
      return proofPathwayOutputs(ctx);
    case 'market_research':
      return marketResearchOutputs(ctx);
    case 'diligence_planner':
      return diligencePlannerOutputs(run, ctx);
    case 'critic':
      return criticOutputs(ctx);
    case 'explorer':
      return explorerOutputs(run, ctx);
    default:
      return [];
  }
}

/* ==================================================================== */
/* The deterministic nodes                                               */
/* ==================================================================== */

function gapCountOf(result: ScreenResult): number {
  // The same arithmetic the orchestrator's own change report uses, so the
  // number on the node and the number in `gap count 4 -> 2` are the same
  // number.
  return result.completeness.missingCritical.length + (result.stateCompliance?.unresolved.length ?? 0);
}

/**
 * The deterministic screen as it stood when the planner read it.
 *
 * When the feedback loop did not fire, that is simply `case.result` and every
 * field is current. When it did, `case.result` has already been overwritten
 * with the re-screened one, and the only surviving record of the prior state
 * is the change list in the orchestrator's step log — which names the verdict,
 * the confidence band and the gap count, and nothing else. So those three are
 * reconstructed and the indicative range is omitted: a range carried over from
 * the re-screened result would be the post-loop number sitting on the pre-loop
 * node, directly under an edge claiming the loop changed things.
 */
export function outputsForScreen(ctx: OutputContext): RunGraphOutput[] {
  const result = ctx.caseData.result;
  if (!result) return [];
  const superseded = ctx.feedback.fired && !ctx.feedback.failed;

  if (!superseded) {
    return [
      {
        key: 'verdict',
        label: 'Verdict',
        summary: `${result.recommendation.verdict} — confidence ${result.confidence.band} (${result.confidence.score}/100).`,
      },
      {
        key: 'indicative_value',
        label: 'Indicative range',
        summary: describeRange(result.indicativeValue),
      },
      {
        key: 'gaps',
        label: 'Open gaps',
        count: gapCountOf(result),
        summary: `${plural(result.completeness.missingCritical.length, 'critical document')} missing, ${plural(result.stateCompliance?.unresolved.length ?? 0, 'compliance check')} unresolved.`,
      },
    ];
  }

  const verdict = ctx.feedback.priorVerdict ?? result.recommendation.verdict;
  const band = ctx.feedback.priorBand ?? result.confidence.band;
  const gaps = ctx.feedback.priorGapCount ?? gapCountOf(result);
  return [
    {
      key: 'verdict',
      label: 'Verdict (before the re-screen)',
      summary: `${verdict} — confidence ${band}. This is the screen the planner read.`,
    },
    {
      key: 'gaps',
      label: 'Open gaps (before the re-screen)',
      count: gaps,
      summary: `${plural(gaps, 'gap')} open when this run started.`,
    },
  ];
}

/**
 * The feedback loop's re-screen — and, above all, what it changed.
 *
 * The change line is the loop's entire justification. Re-running the
 * deterministic engine costs a second pass over every rule for the sake of one
 * corrected khata number, and the only way a user can judge whether that was
 * worth it is to see the delta stated. "Ran and nothing moved" is reported
 * just as plainly as a moved verdict: a loop that confirms the verdict has
 * also told you something, and hiding the null result would make the loop look
 * better than it is.
 */
export function outputsForRescreen(ctx: OutputContext): RunGraphOutput[] {
  const { feedback } = ctx;
  if (!feedback.fired) return [];

  if (feedback.failed) {
    return [
      {
        key: 'change',
        label: 'Outcome',
        summary: 'The re-screen threw, so the orchestration continued on the prior screen result — the corrected fields never reached the verdict.',
      },
    ];
  }

  const outputs: RunGraphOutput[] = [];
  if (feedback.changes.length > 0) {
    outputs.push({
      key: 'change',
      label: 'What changed',
      count: feedback.changes.length,
      summary: `${feedback.changes.join(', ')} — this is what the loop bought.`,
    });
  } else if (feedback.firstResult) {
    outputs.push({
      key: 'change',
      label: 'What changed',
      summary: "Produced this case's first screen result; there was no prior verdict to move.",
    });
  } else {
    outputs.push({
      key: 'change',
      label: 'What changed',
      summary: 'Nothing material — verdict, confidence band and gap count all held. The loop cost a pass and confirmed the answer.',
    });
  }

  const result = ctx.caseData.result;
  if (result) {
    outputs.push({
      key: 'verdict',
      label: 'Verdict',
      summary: `${result.recommendation.verdict} — confidence ${result.confidence.band} (${result.confidence.score}/100).`,
    });
    outputs.push({
      key: 'indicative_value',
      label: 'Indicative range',
      summary: describeRange(result.indicativeValue),
    });
    outputs.push({
      key: 'gaps',
      label: 'Open gaps',
      count: gapCountOf(result),
      summary: `${plural(result.completeness.missingCritical.length, 'critical document')} missing, ${plural(result.stateCompliance?.unresolved.length ?? 0, 'compliance check')} unresolved.`,
    });
  }
  return outputs;
}
