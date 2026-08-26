/**
 * The multi-agent orchestrator: plans a case, then runs the plan, with a
 * feedback loop back into the deterministic engine when document
 * intelligence changes the facts on file.
 *
 * This replaces what used to be a fixed chain of `if` blocks with two things
 * a hardcoded pipeline cannot do:
 *
 * 1. Planning. `runPlanner` (see `./agents/planner.ts`) reads this case's
 *    actual shape — verdict, confidence, open blockers, missing documents,
 *    unresolved checks, whether it has even been screened — and returns an
 *    `AgentPlan`: one task per available agent, each with a `depth`
 *    ('skip'/'light'/'standard'/'deep'), an `order`, a per-case `focus`, and
 *    a rationale. Tasks are executed in ascending `order`; tasks that share
 *    an `order` run concurrently. `deliberateOmissions` — what the planner
 *    chose not to do, and why — travels with the plan into `CaseIntelligence`
 *    so the UI can show it, not just log it. The planner can never block this
 *    file: if its own model call fails, it returns a static fallback plan
 *    (the old fixed pipeline, at standard depth) with the failure recorded
 *    on its own `AgentRun`, and execution proceeds exactly as if that were
 *    the plan all along.
 *
 * 2. The feedback loop. Document intelligence can extract a fact — a khata
 *    number, an area, a K-RERA number — that contradicts what is already on
 *    the case. When that happens (and only then — see the guard below),
 *    this file re-runs `runScreen` (the real deterministic engine, not a
 *    reimplementation of it) with the newly-merged documents, and every
 *    downstream agent this run reasons over the FRESH result rather than the
 *    stale one. A step reports when the re-screen actually changed something
 *    material (verdict, confidence band, or gap count) — that is the moment
 *    the loop earned its cost. The re-screen runs at most once per
 *    orchestration, and only when document intelligence actually produced a
 *    new field, so this cannot loop.
 *
 * Everything the previous version got right is kept: per-phase try/catch so
 * one agent failing never sinks the run, a concurrency cap on document
 * intelligence, aggregate usage via `sumUsage`, live `onStep`/`onRun`
 * streaming, and an immediate, honest explanatory return when no credentials
 * are configured at all.
 *
 * A note on the return shape: the documented contract is
 * `{ runs, intelligence, usage }`. This file adds fields rather than
 * renaming any of them (see `apps/api/src/routes/agents.ts`, which
 * destructures/consumes this result and must not break): `evidence`,
 * `proposedActions` and `drafts` already existed for the same reason
 * (`CaseIntelligence` has no field for them); `plan`, `verification` and
 * `explorations` are new because `CaseIntelligence` now does have fields for
 * them; `documents` and `screenResult` are new because the feedback loop's
 * whole point — a corrected fact moving the verdict — only reaches the
 * persisted case if the caller writes them onto `case.documents`/
 * `case.result`. See the doc comments on `RunOrchestrationResult` below.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentInsight,
  AgentKind,
  AgentPlan,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentUsage,
  CaseDocument,
  CaseIntelligence,
  DocumentPathway,
  EvidenceItem,
  ExplorationSession,
  PlannedTask,
  PropertyCase,
  RecommendedAction,
  ReferenceData,
  ResearchFinding,
  ScreenResult,
  TaskDepth,
  VerificationSummary,
} from '@realytica/shared';
import { runScreen } from '@realytica/shared';
import { agentCapability, describeError, modelFor, summariseCost, sumUsage, tierFor } from './client';
import { runPlanner } from './agents/planner';
import { runDocumentIntelligence } from './agents/document-intelligence';
import { runProofPathways } from './agents/proof-pathways';
import { runMarketResearch } from './agents/market-research';
import { runDiligencePlanner, type DiligenceDraft } from './agents/diligence-planner';
import { runCritic } from './agents/critic';
import { runExplorer } from './agents/explorer';

export interface RunOrchestrationParams {
  caseData: PropertyCase;
  refData: ReferenceData;
  /** ISO timestamp used to date every produced evidence/step — not wall-clock, so runs are reproducible. */
  now?: string;
  /** Restrict the plan to a subset of agents. Anything outside the orchestrable roster is ignored. Defaults to all of them, further narrowed by `agentCapability().enabledAgents` (and, for critic/explorer, by capability rules this file applies itself — see `resolvePlanningRoster`). */
  agents?: AgentKind[];
  onStep?: (step: AgentStep) => void;
  onRun?: (run: AgentRun) => void;
  /**
   * Resolves a document to its stored bytes, for document intelligence to
   * read. Defaults to `async () => null`, in which case each document's run
   * completes with a clear "no file available" failure rather than being
   * skipped silently — the caller (which owns upload storage, via a
   * `StorageAdapter`) is expected to supply this in real use.
   */
  resolveDocumentBytes?: (document: CaseDocument) => Promise<Buffer | null>;
}

export interface RunOrchestrationResult {
  runs: AgentRun[];
  intelligence: Partial<CaseIntelligence>;
  usage: AgentUsage;
  /** Evidence every phase produced, keyed by the ids in each run's `producedEvidenceIds`. See the file header. */
  evidence: EvidenceItem[];
  /** Additional actions the diligence planner proposed, already deduped against the engine's own `result.actions`. Not yet adopted onto the case. */
  proposedActions: RecommendedAction[];
  /** Outreach message drafts for a human to review and send — never sent by this package. */
  drafts: DiligenceDraft[];
  /** The plan this run executed, even when it is the static fallback (see `runPlanner`). Absent only on the immediate no-credentials return, where no planning happened at all. */
  plan?: AgentPlan;
  /** The critic's adversarial pass over this run's combined generative output, present only when the plan included the critic and it produced a result. */
  verification?: VerificationSummary;
  /**
   * New open-ended exploration session(s) produced this run — 0 or 1 in
   * practice, since the plan schedules the explorer at most once. This is a
   * discrete past run, like `runs`, not a current-state summary like
   * `pathways`/`research`/`insights` — the caller should APPEND it onto the
   * case's existing `intelligence.explorations`, not replace them.
   */
  explorations: ExplorationSession[];
  /**
   * The case's documents as they stand after this run, including any newly
   * merged extraction fields, reclassified `kind`, and `ocrStatus` from
   * document intelligence. Identical to the input when document intelligence
   * did not run, was skipped by the plan, or produced nothing new.
   * `CaseIntelligence` has no field for this — it is a case field, not agent
   * output — so, like `evidence`/`proposedActions`/`drafts`, it travels here
   * for the caller to apply onto `case.documents`.
   */
  documents: CaseDocument[];
  /**
   * A freshly-computed `ScreenResult`, present only when the feedback loop's
   * re-screen actually ran (document intelligence produced a new field this
   * run). The caller should write this onto `case.result` — without that,
   * the loop's entire point (a corrected khata number, area, or K-RERA
   * number moving the verdict) never reaches the persisted case.
   */
  screenResult?: ScreenResult;
}

/** Every agent a plan may schedule. Mirrors `PLANNABLE_AGENTS` in `./agents/planner.ts`. */
const ORCHESTRABLE_AGENTS: AgentKind[] = ['document_intelligence', 'proof_pathways', 'market_research', 'diligence_planner', 'critic', 'explorer'];

/** Agents whose data dependencies this file schedules by the plan's `order` (document intelligence and critic are handled as their own guaranteed-first/guaranteed-last phases — see the run loop). */
const SCHEDULABLE_AGENTS: AgentKind[] = ['proof_pathways', 'market_research', 'diligence_planner', 'explorer'];

const DOCUMENT_INTELLIGENCE_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

/** A document with no extraction yet, or one whose OCR never finished — the two states document intelligence can actually improve. Exported so a harness can reproduce the "which documents need processing" decision without a live model call. */
export function isUnprocessed(document: CaseDocument): boolean {
  return document.ocrStatus !== 'complete' || document.extracted.length === 0;
}

/** The shape of one document intelligence run's outcome that the merge below actually needs — deliberately narrower than `DocumentIntelligenceResult` so a test can construct one without importing that module. */
export interface DocumentIntelligenceOutcome {
  document: CaseDocument;
  kind: CaseDocument['kind'];
  kindConfidence: number;
  fields: CaseDocument['extracted'];
  notes: string;
}

/**
 * Merges one document intelligence outcome into its document. Pure and
 * exported so the feedback loop's merge-then-rescreen step can be exercised
 * with a fabricated outcome (no live model call) — see the header note in
 * `runOrchestration`'s Phase A about the classification-confirmed-by-user
 * guard.
 */
export function mergeDocumentIntelligenceOutcome(outcome: DocumentIntelligenceOutcome): CaseDocument {
  const original = outcome.document;
  return {
    ...original,
    kind: original.kindConfirmedByUser ? original.kind : outcome.kind,
    classificationConfidence: original.kindConfirmedByUser ? original.classificationConfidence : outcome.kindConfidence,
    ocrStatus: 'complete',
    extracted: outcome.fields.length > 0 ? outcome.fields : original.extracted,
    notes: outcome.notes || original.notes,
  };
}

/**
 * Groups planned tasks by ascending `order` — tasks sharing an order value
 * run concurrently, later groups wait for earlier ones. Pure and exported so
 * the scheduling behaviour (grouping, ordering) can be verified directly
 * against a hand-built `AgentPlan` without any agent actually running.
 */
export function groupTasksByOrder(tasks: PlannedTask[]): PlannedTask[][] {
  const groups = new Map<number, PlannedTask[]>();
  for (const t of tasks) {
    const group = groups.get(t.order) ?? [];
    group.push(t);
    groups.set(t.order, group);
  }
  return [...groups.keys()].sort((a, b) => a - b).map(k => groups.get(k) ?? []);
}

/**
 * Which scheduled agents genuinely consume another's output.
 *
 * `runDiligencePlanner` is handed `pathways` and `findings` — the closure
 * variables the two agents above assign when they finish. Read at call time,
 * which for a concurrently-scheduled task is before either has assigned
 * anything.
 */
const SCHEDULED_DEPENDENCIES: Partial<Record<AgentKind, AgentKind[]>> = {
  diligence_planner: ['proof_pathways', 'market_research'],
};

export interface PlanOrderCorrection {
  agent: AgentKind;
  from: number;
  to: number;
  after: AgentKind[];
}

/**
 * Enforce data dependencies that were, until now, only asked for.
 *
 * The planner's tool schema tells the model "diligence_planner must come after
 * both" — and that is a request, not a constraint. Nothing checked it. A plan
 * putting proof pathways and the diligence planner in the same `order` group
 * runs them through one `Promise.all`, so the planner receives the empty
 * arrays those variables still hold, reasons over no pathways and no research,
 * and produces insights anyway. Nothing fails, nothing is logged, and the
 * output looks exactly like a normal run.
 *
 * That is the worst shape a bug can take here, so the ordering is now derived
 * rather than trusted: a dependent task is pushed strictly past everything it
 * reads. Corrections are returned rather than applied silently, because a
 * planner that keeps producing invalid orders is a prompt problem worth
 * seeing, and a run whose schedule was rewritten should say so.
 *
 * Pure and exported so the rule can be verified without running an agent.
 */
export function enforceTaskDependencies(
  tasks: PlannedTask[],
): { tasks: PlannedTask[]; corrections: PlanOrderCorrection[] } {
  const scheduled = new Map(tasks.map(t => [t.agent, t]));
  const corrections: PlanOrderCorrection[] = [];
  // One pass in dependency order is enough for the single-level table above.
  // A deeper graph would need a topological sort; the assertion is that this
  // table stays shallow, and a second dependent added below a dependent should
  // come with that sort rather than a second pass bolted on here.
  const out = tasks.map(task => {
    const deps = (SCHEDULED_DEPENDENCIES[task.agent] ?? [])
      .map(a => scheduled.get(a))
      .filter((t): t is PlannedTask => t !== undefined && t.depth !== 'skip');
    if (deps.length === 0 || task.depth === 'skip') return task;
    const mustBeAfter = Math.max(...deps.map(d => d.order));
    if (task.order > mustBeAfter) return task;
    const to = mustBeAfter + 1;
    corrections.push({ agent: task.agent, from: task.order, to, after: deps.map(d => d.agent) });
    return { ...task, order: to };
  });
  return { tasks: out, corrections };
}

function rollupStatus(runs: AgentRun[]): AgentRunStatus {
  if (runs.length === 0) return 'cancelled';
  if (runs.some(r => r.status === 'succeeded')) return 'succeeded';
  if (runs.every(r => r.status === 'cancelled')) return 'cancelled';
  return 'failed';
}

function emptyUsage(): AgentUsage {
  return sumUsage([]);
}

function failedRun(caseId: string, agent: AgentKind, error: string): AgentRun {
  const at = new Date().toISOString();
  return { id: randomUUID(), caseId, agent, status: 'failed', startedAt: at, finishedAt: at, model: modelFor(agent), tier: tierFor(agent), steps: [], error, producedEvidenceIds: [] };
}

/**
 * The agent roster this run may plan for: the four original orchestrable
 * agents, gated exactly as before by `agentCapability().enabledAgents`
 * (which itself gates `market_research` on `webSearchEnabled`); plus
 * `critic`, which needs no capability beyond overall availability (already
 * true by the time this runs — see the early return below) since it makes
 * no outbound call of its own. `explorer` is deliberately NOT included by
 * default: see the comment inside. `client.ts`'s `ALL_AGENTS` now covers
 * every `AgentKind`, but `critic`, `explorer`, `planner` and `title_graph`
 * are classified there as orchestrator-scheduled and deliberately kept out
 * of `capability.enabledAgents` — advertising `explorer` would make a
 * default "run agents" press start unbounded outbound web exploration — so
 * they are still added here rather than read off that list.
 */
function resolvePlanningRoster(
  capability: ReturnType<typeof agentCapability>,
  requested: AgentKind[],
  explicitlyRequested: boolean,
): AgentKind[] {
  const capabilityEnabled: AgentKind[] = [
    ...capability.enabledAgents.filter(a => ORCHESTRABLE_AGENTS.includes(a)),
    'critic',
    // The explorer is the only agent that is both open-ended in cost and
    // outbound to the wider web, so it is never scheduled by a default run —
    // a user pressing "run agents" should not silently start an unbounded
    // web exploration. It joins the roster only when the caller names it, or
    // through the dedicated /explore endpoint. Web search being enabled is a
    // permission, not an instruction.
    ...(capability.webSearchEnabled && explicitlyRequested ? (['explorer'] as AgentKind[]) : []),
  ];
  return ORCHESTRABLE_AGENTS.filter(a => requested.includes(a) && capabilityEnabled.includes(a));
}

/** Same country+state resolution the deterministic engine uses, so the critic checks proof routes against the same jurisdiction corpus (or lack of one) proof-pathways was grounded in. */
function resolveStatePackId(caseData: PropertyCase, refData: ReferenceData): string | undefined {
  return refData.statePacks.find(
    p => p.country === caseData.identity.country && p.state.toLowerCase() === caseData.identity.state.toLowerCase(),
  )?.id;
}

/**
 * `runExplorer` takes concrete knobs (`maxIterations`/`maxCostUsd`), not a
 * `TaskDepth` — this is where the plan's depth is translated into them.
 * "standard" defers to the agent's own defaults (6 iterations / $0.75)
 * rather than restating them here, so a future change to those defaults
 * does not need a matching change in this file.
 */
function explorerBudgetForDepth(depth: TaskDepth): { maxIterations?: number; maxCostUsd?: number } {
  if (depth === 'light') return { maxIterations: 3, maxCostUsd: 0.3 };
  if (depth === 'deep') return { maxIterations: 10, maxCostUsd: 1.5 };
  return {};
}

export async function runOrchestration(params: RunOrchestrationParams): Promise<RunOrchestrationResult> {
  const { caseData, refData } = params;
  const now = params.now ?? new Date().toISOString();
  const orchestratorRunId = randomUUID();
  const orchestratorStartedAt = new Date().toISOString();
  const orchestratorSteps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    orchestratorSteps.push(full);
    params.onStep?.(full);
  };

  const capability = agentCapability();
  if (!capability.available) {
    const reason = `Orchestration is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    const run: AgentRun = {
      id: orchestratorRunId,
      caseId: caseData.id,
      agent: 'orchestrator',
      status: 'failed',
      startedAt: orchestratorStartedAt,
      finishedAt: new Date().toISOString(),
      model: modelFor('orchestrator'),
      tier: tierFor('orchestrator'),
      steps: orchestratorSteps,
      error: reason,
      producedEvidenceIds: [],
    };
    params.onRun?.(run);
    return { runs: [run], intelligence: {}, usage: emptyUsage(), evidence: [], proposedActions: [], drafts: [], explorations: [], documents: caseData.documents };
  }

  // `params.agents` present means the caller chose a roster deliberately; its
  // absence is a default run, which must not pull in the explorer.
  const explicitlyRequested = params.agents !== undefined && params.agents.includes('explorer');
  const requested = params.agents ?? ORCHESTRABLE_AGENTS;
  const available = resolvePlanningRoster(capability, requested, explicitlyRequested);

  const allRuns: AgentRun[] = [];
  const allEvidence: EvidenceItem[] = [];
  const recordRun = (run: AgentRun): void => {
    allRuns.push(run);
    params.onRun?.(run);
  };

  /* -------------------------------------------------------------- */
  /* Plan.                                                             */
  /* -------------------------------------------------------------- */
  const plannerResult = await runPlanner({ caseId: caseData.id, caseData, refData, available, now, onStep: params.onStep });
  recordRun(plannerResult.run);
  const plan = plannerResult.plan;
  emit({
    kind: 'plan',
    label: `Plan: ${plan.tasks.filter(t => t.depth !== 'skip').map(t => `${t.agent}(${t.depth})`).join(', ') || '(nothing to run)'}`,
    detail: plan.caseAssessment,
  });
  if (plan.deliberateOmissions.length > 0) {
    emit({ kind: 'message', label: `${plan.deliberateOmissions.length} deliberate omission(s) in this plan.`, detail: plan.deliberateOmissions.join(' | ') });
  }

  const tasksByAgent = new Map<AgentKind, PlannedTask>(plan.tasks.map(t => [t.agent, t]));
  const runnableTask = (agent: AgentKind): PlannedTask | undefined => {
    const t = tasksByAgent.get(agent);
    return t && t.depth !== 'skip' ? t : undefined;
  };
  const emitSkip = (agent: AgentKind): void => {
    const t = tasksByAgent.get(agent);
    if (t && t.depth === 'skip') emit({ kind: 'plan', label: `${agent} skipped by plan.`, detail: t.rationale });
  };

  let pathways: DocumentPathway[] = [];
  let findings: ResearchFinding[] = [];
  let insights: AgentInsight[] = [];
  let proposedActions: RecommendedAction[] = [];
  let drafts: DiligenceDraft[] = [];
  let verification: VerificationSummary | undefined;
  const explorations: ExplorationSession[] = [];
  let freshScreenResult: ScreenResult | undefined;
  let finalDocuments: CaseDocument[] = caseData.documents;

  const resolveDocumentBytes = params.resolveDocumentBytes ?? (async () => null);

  /* -------------------------------------------------------------- */
  /* Phase A — document intelligence, one per unprocessed document,   */
  /* run concurrently with a small cap; then the feedback loop's       */
  /* re-screen, guarded to run at most once and only on real new fields. */
  /* -------------------------------------------------------------- */
  const diTask = runnableTask('document_intelligence');
  if (!diTask) {
    emitSkip('document_intelligence');
  } else {
    const unprocessed = caseData.documents.filter(isUnprocessed);
    if (unprocessed.length === 0) {
      emit({ kind: 'plan', label: 'Document intelligence: no unprocessed documents — nothing to do.' });
    } else {
      emit({
        kind: 'plan',
        label: `Document intelligence (${diTask.depth}): ${unprocessed.length} document(s), concurrency ${DOCUMENT_INTELLIGENCE_CONCURRENCY}.`,
        detail: diTask.rationale,
      });
      const diOutcomes = await mapWithConcurrency(unprocessed, DOCUMENT_INTELLIGENCE_CONCURRENCY, async document => {
        try {
          const result = await runDocumentIntelligence({
            caseId: caseData.id,
            document,
            fileBytes: await resolveDocumentBytes(document),
            identity: caseData.identity,
            now,
            onStep: params.onStep,
          });
          recordRun(result.run);
          allEvidence.push(...result.evidence);
          return result.run.status === 'succeeded' ? { document, kind: result.kind, kindConfidence: result.kindConfidence, fields: result.fields, notes: result.notes } : null;
        } catch (e) {
          recordRun(failedRun(caseData.id, 'document_intelligence', `Unexpected error processing "${document.fileName}": ${describeError(e)}`));
          return null;
        }
      });

      // Merge every successful extraction into its document. A document the
      // user has already confirmed the classification of keeps that
      // classification — document intelligence can still correct its
      // extracted fields, just not overrule a human's own call on kind.
      const documentsById = new Map(caseData.documents.map(d => [d.id, d]));
      let gainedNewFields = false;
      for (const outcome of diOutcomes) {
        if (!outcome) continue;
        if (outcome.fields.length > 0) gainedNewFields = true;
        documentsById.set(outcome.document.id, mergeDocumentIntelligenceOutcome(outcome));
      }
      finalDocuments = caseData.documents.map(d => documentsById.get(d.id) ?? d);

      if (!gainedNewFields) {
        emit({ kind: 'plan', label: 'Feedback loop: no new fields extracted — re-screen skipped.' });
      } else {
        emit({ kind: 'plan', label: 'Feedback loop: re-running the deterministic screen with newly extracted fields.' });
        try {
          const rescreened = runScreen({
            caseId: caseData.id,
            reference: caseData.reference,
            identity: caseData.identity,
            documents: finalDocuments,
            refData,
            now,
            previousResult: caseData.result,
            siteContext: caseData.siteContext,
            project: caseData.project,
          });
          freshScreenResult = rescreened;

          const prev = caseData.result;
          if (!prev) {
            emit({ kind: 'message', label: `Re-screen produced this case's first screen result: ${rescreened.recommendation.verdict}, confidence ${rescreened.confidence.band}.` });
          } else {
            const prevGapCount = prev.completeness.missingCritical.length + (prev.stateCompliance?.unresolved.length ?? 0);
            const newGapCount = rescreened.completeness.missingCritical.length + (rescreened.stateCompliance?.unresolved.length ?? 0);
            const changes: string[] = [];
            if (prev.recommendation.verdict !== rescreened.recommendation.verdict) changes.push(`verdict ${prev.recommendation.verdict} -> ${rescreened.recommendation.verdict}`);
            if (prev.confidence.band !== rescreened.confidence.band) changes.push(`confidence band ${prev.confidence.band} -> ${rescreened.confidence.band}`);
            if (prevGapCount !== newGapCount) changes.push(`gap count ${prevGapCount} -> ${newGapCount}`);
            emit(
              changes.length > 0
                ? { kind: 'message', label: `Re-screen changed something material: ${changes.join(', ')}.` }
                : { kind: 'message', label: 'Re-screen ran but nothing material changed (verdict, confidence band and gap count all held).' },
            );
          }
        } catch (e) {
          emit({ kind: 'error', label: 'Re-screen failed — continuing with the prior screen result.', detail: describeError(e) });
        }
      }
    }
  }

  // Downstream agents always see the merged documents (even absent a
  // re-screen, e.g. a reclassification with no new field), and the fresh
  // screen result exactly when the feedback loop produced one.
  const effectiveCaseData: PropertyCase = { ...caseData, documents: finalDocuments, result: freshScreenResult ?? caseData.result };

  /* -------------------------------------------------------------- */
  /* Phase B — proof pathways / market research / diligence planner /  */
  /* explorer, scheduled by the plan's `order`; same-order tasks run   */
  /* concurrently.                                                     */
  /* -------------------------------------------------------------- */
  for (const agent of SCHEDULABLE_AGENTS) emitSkip(agent);

  const rawSchedulable = SCHEDULABLE_AGENTS.map(a => runnableTask(a)).filter((t): t is PlannedTask => t !== undefined);
  const { tasks: schedulableTasks, corrections } = enforceTaskDependencies(rawSchedulable);
  for (const c of corrections) {
    emit({
      kind: 'plan',
      label: `Rescheduled ${c.agent} to order ${c.to}.`,
      detail: `The plan put it at order ${c.from}, not after ${c.after.join(' and ')}, whose output it reads — as scheduled it would have received nothing from ${c.after.length === 1 ? 'that agent' : 'those agents'} and reasoned over an empty set.`,
    });
  }
  const orderedGroups = groupTasksByOrder(schedulableTasks);

  const runScheduledTask = async (task: PlannedTask): Promise<void> => {
    switch (task.agent) {
      case 'proof_pathways': {
        emit({ kind: 'plan', label: `Running proof_pathways (${task.depth}).`, detail: task.rationale });
        try {
          const result = await runProofPathways({ caseId: caseData.id, caseData: effectiveCaseData, refData, now, onStep: params.onStep });
          recordRun(result.run);
          pathways = result.pathways;
          allEvidence.push(...(result.evidence ?? []));
        } catch (e) {
          recordRun(failedRun(caseData.id, 'proof_pathways', `Unexpected error generating proof pathways: ${describeError(e)}`));
        }
        return;
      }
      case 'market_research': {
        emit({ kind: 'plan', label: `Running market_research (${task.depth}).`, detail: task.rationale });
        try {
          const result = await runMarketResearch({ caseId: caseData.id, caseData: effectiveCaseData, refData, now, onStep: params.onStep });
          recordRun(result.run);
          findings = result.findings;
          allEvidence.push(...result.evidence);
        } catch (e) {
          recordRun(failedRun(caseData.id, 'market_research', `Unexpected error during market research: ${describeError(e)}`));
        }
        return;
      }
      case 'diligence_planner': {
        emit({ kind: 'plan', label: `Running diligence_planner (${task.depth}).`, detail: task.rationale });
        try {
          const result = await runDiligencePlanner({ caseId: caseData.id, caseData: effectiveCaseData, refData, pathways, findings, now, onStep: params.onStep });
          recordRun(result.run);
          insights = result.insights;
          proposedActions = result.actions;
          drafts = result.drafts;
          allEvidence.push(...result.evidence);
        } catch (e) {
          recordRun(failedRun(caseData.id, 'diligence_planner', `Unexpected error during diligence planning: ${describeError(e)}`));
        }
        return;
      }
      case 'explorer': {
        emit({ kind: 'plan', label: `Running explorer (${task.depth}).`, detail: task.rationale });
        try {
          const budget = explorerBudgetForDepth(task.depth);
          const result = await runExplorer({
            caseId: caseData.id,
            caseData: effectiveCaseData,
            refData,
            objective: task.focus.length > 0 ? task.focus.join('; ') : undefined,
            maxIterations: budget.maxIterations,
            maxCostUsd: budget.maxCostUsd,
            now,
            onStep: params.onStep,
          });
          recordRun(result.run);
          explorations.push(result.session);
        } catch (e) {
          recordRun(failedRun(caseData.id, 'explorer', `Unexpected error during exploration: ${describeError(e)}`));
        }
        return;
      }
      default:
        return;
    }
  };

  for (const group of orderedGroups) {
    if (group.length > 1) {
      emit({ kind: 'plan', label: `Order ${group[0].order}: running ${group.map(t => t.agent).join(', ')} concurrently.` });
    }
    await Promise.all(group.map(runScheduledTask));
  }

  /* -------------------------------------------------------------- */
  /* Phase C — critic, always last: it checks the COMBINED output of   */
  /* every generative agent that actually ran above, regardless of     */
  /* what order value the plan assigned it.                            */
  /* -------------------------------------------------------------- */
  const criticTask = runnableTask('critic');
  if (!criticTask) {
    emitSkip('critic');
  } else {
    emit({ kind: 'plan', label: `Running critic (${criticTask.depth}) over this run's combined generative output.`, detail: criticTask.rationale });
    // Every evidence id an insight could legitimately cite: the case's own
    // screen ledger plus whatever this run's other agents produced (proof
    // pathways, document intelligence, market research) — a superset is
    // safe here since the critic only ever checks membership.
    const evidenceIds = [...new Set([...(effectiveCaseData.result?.evidence.map(e => e.id) ?? []), ...allEvidence.map(e => e.id)])];
    try {
      const result = await runCritic({
        caseId: caseData.id,
        pathways,
        insights,
        research: findings,
        evidenceIds,
        statePackId: resolveStatePackId(effectiveCaseData, refData),
        now,
        onStep: params.onStep,
      });
      recordRun(result.run);
      verification = result.verification;
    } catch (e) {
      recordRun(failedRun(caseData.id, 'critic', `Unexpected error running the critic: ${describeError(e)}`));
    }
  }

  /* -------------------------------------------------------------- */
  /* Wrap up.                                                          */
  /* -------------------------------------------------------------- */
  const usage = sumUsage(allRuns.map(r => r.usage));
  const overallStatus = rollupStatus(allRuns);
  emit({
    kind: 'message',
    label: `Orchestration ${overallStatus} — ${allRuns.filter(r => r.status === 'succeeded').length}/${allRuns.length} phase run(s) succeeded`,
  });

  const ranAgents = plan.tasks.filter(t => t.depth !== 'skip').map(t => t.agent);
  const orchestratorRun: AgentRun = {
    id: orchestratorRunId,
    caseId: caseData.id,
    agent: 'orchestrator',
    status: overallStatus,
    startedAt: orchestratorStartedAt,
    finishedAt: new Date().toISOString(),
    model: modelFor('orchestrator'),
    tier: tierFor('orchestrator'),
    steps: orchestratorSteps,
    summary: `${ranAgents.join(', ') || 'no phases'} — ${allRuns.filter(r => r.status === 'succeeded').length}/${allRuns.length} succeeded, ${pathways.length} pathway(s), ${findings.length} research finding(s), ${insights.length} insight(s), ${proposedActions.length} proposed action(s)${verification ? `, grounding score ${verification.groundingScore}` : ''}.`,
    usage,
    producedEvidenceIds: [],
  };
  params.onRun?.(orchestratorRun);

  const runs = [orchestratorRun, ...allRuns];
  const intelligence: Partial<CaseIntelligence> = {
    runs,
    plan,
    verification,
    explorations,
    pathways,
    research: findings,
    insights,
    // Per-agent spend, with what the same tokens would have cost on the
    // judgment model. Attached here rather than computed in the UI so the
    // figure travels with the run that produced it and cannot drift from the
    // rates that priced it.
    cost: summariseCost(runs),
    lastRunAt: new Date().toISOString(),
  };

  return {
    runs,
    intelligence,
    usage,
    evidence: allEvidence,
    proposedActions,
    drafts,
    plan,
    verification,
    explorations,
    documents: finalDocuments,
    screenResult: freshScreenResult,
  };
}
