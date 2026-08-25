/**
 * The multi-agent plan: sequences document intelligence, proof pathways,
 * market research and the diligence planner into one run over a case.
 *
 * Sequencing rationale:
 * - Document intelligence runs once per unprocessed document, and those runs
 *   are independent of each other, so they run concurrently (capped — see
 *   `DOCUMENT_INTELLIGENCE_CONCURRENCY`) rather than one at a time.
 * - Proof pathways runs next, once, over the case as a whole.
 * - Market research runs after that, gated on `agentCapability().webSearchEnabled`
 *   (each agent module also self-gates, so this is belt-and-suspenders).
 * - The diligence planner runs last, because it is the one phase that
 *   consumes the other three's output (pathways + research findings).
 *
 * Partial failure must not sink the run: every phase is wrapped so that one
 * agent throwing or failing leaves its own run `failed` and the rest still
 * proceed — the orchestrator always returns whatever succeeded, never throws
 * itself, and degrades to a single explanatory run when no credentials are
 * configured at all.
 *
 * A note on the return shape: the documented contract is
 * `{ runs, intelligence, usage }`. `CaseIntelligence` itself has no field for
 * fresh evidence, proposed (not-yet-adopted) actions, or outreach drafts —
 * those live on individual phase results, not on the conversation/pathways/
 * research/insights shape `CaseIntelligence` defines. Rather than drop them,
 * this file returns them as additional top-level fields (`evidence`,
 * `proposedActions`, `drafts`) on top of the three documented ones. Any
 * caller destructuring just `{ runs, intelligence, usage }` is unaffected;
 * a caller that wants to persist the new evidence/actions/drafts can do so
 * explicitly rather than have this file silently decide where they go.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentInsight,
  AgentKind,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentUsage,
  CaseDocument,
  CaseIntelligence,
  DocumentPathway,
  EvidenceItem,
  PropertyCase,
  RecommendedAction,
  ReferenceData,
  ResearchFinding,
} from '@valytica/shared';
import { AGENT_MODEL, agentCapability, describeError, sumUsage } from './client';
import { runDocumentIntelligence } from './agents/document-intelligence';
import { runProofPathways } from './agents/proof-pathways';
import { runMarketResearch } from './agents/market-research';
import { runDiligencePlanner, type DiligenceDraft } from './agents/diligence-planner';

export interface RunOrchestrationParams {
  caseData: PropertyCase;
  refData: ReferenceData;
  /** ISO timestamp used to date every produced evidence/step — not wall-clock, so runs are reproducible. */
  now?: string;
  /** Restrict the plan to a subset of phases. Anything outside the four orchestrable agents is ignored. Defaults to all four, further narrowed by `agentCapability().enabledAgents`. */
  agents?: AgentKind[];
  onStep?: (step: AgentStep) => void;
  onRun?: (run: AgentRun) => void;
  /**
   * Resolves a document to its file on disk, for document intelligence to
   * read. Defaults to `() => null`, in which case each document's run
   * completes with a clear "no file available" failure rather than being
   * skipped silently — the caller (which owns upload storage) is expected to
   * supply this in real use.
   */
  resolveDocumentPath?: (document: CaseDocument) => string | null;
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
}

const ORCHESTRABLE_AGENTS: AgentKind[] = ['document_intelligence', 'proof_pathways', 'market_research', 'diligence_planner'];
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

/** A document with no extraction yet, or one whose OCR never finished — the two states document intelligence can actually improve. */
function isUnprocessed(document: CaseDocument): boolean {
  return document.ocrStatus !== 'complete' || document.extracted.length === 0;
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
      model: AGENT_MODEL,
      steps: orchestratorSteps,
      error: reason,
      producedEvidenceIds: [],
    };
    params.onRun?.(run);
    return { runs: [run], intelligence: {}, usage: emptyUsage(), evidence: [], proposedActions: [], drafts: [] };
  }

  const requested = params.agents ?? ORCHESTRABLE_AGENTS;
  const effective = ORCHESTRABLE_AGENTS.filter(a => requested.includes(a) && capability.enabledAgents.includes(a));
  emit({ kind: 'plan', label: `Plan: ${effective.length > 0 ? effective.join(' -> ') : '(nothing to run)'}` });

  const resolveDocumentPath = params.resolveDocumentPath ?? (() => null);

  const allRuns: AgentRun[] = [];
  const allEvidence: EvidenceItem[] = [];
  const recordRun = (run: AgentRun): void => {
    allRuns.push(run);
    params.onRun?.(run);
  };

  /* -------------------------------------------------------------- */
  /* Phase A — document intelligence, one per unprocessed document,   */
  /* run concurrently with a small cap since each is independent.     */
  /* -------------------------------------------------------------- */
  if (effective.includes('document_intelligence')) {
    const unprocessed = caseData.documents.filter(isUnprocessed);
    if (unprocessed.length === 0) {
      emit({ kind: 'plan', label: 'Document intelligence: no unprocessed documents — skipped' });
    } else {
      emit({ kind: 'plan', label: `Document intelligence: ${unprocessed.length} document(s), concurrency ${DOCUMENT_INTELLIGENCE_CONCURRENCY}` });
      await mapWithConcurrency(unprocessed, DOCUMENT_INTELLIGENCE_CONCURRENCY, async document => {
        try {
          const result = await runDocumentIntelligence({
            caseId: caseData.id,
            document,
            filePath: resolveDocumentPath(document),
            identity: caseData.identity,
            now,
            onStep: params.onStep,
          });
          recordRun(result.run);
          allEvidence.push(...result.evidence);
        } catch (e) {
          const reason = describeError(e);
          const failedAt = new Date().toISOString();
          recordRun({
            id: randomUUID(),
            caseId: caseData.id,
            agent: 'document_intelligence',
            status: 'failed',
            startedAt: failedAt,
            finishedAt: failedAt,
            model: AGENT_MODEL,
            steps: [],
            error: `Unexpected error processing "${document.fileName}": ${reason}`,
            producedEvidenceIds: [],
          });
        }
      });
    }
  }

  /* -------------------------------------------------------------- */
  /* Phase B — proof pathways, once over the whole case.               */
  /* -------------------------------------------------------------- */
  let pathways: DocumentPathway[] = [];
  if (effective.includes('proof_pathways')) {
    try {
      const result = await runProofPathways({ caseId: caseData.id, caseData, refData, now, onStep: params.onStep });
      recordRun(result.run);
      pathways = result.pathways;
      allEvidence.push(...(result.evidence ?? []));
    } catch (e) {
      const reason = describeError(e);
      const failedAt = new Date().toISOString();
      recordRun({
        id: randomUUID(),
        caseId: caseData.id,
        agent: 'proof_pathways',
        status: 'failed',
        startedAt: failedAt,
        finishedAt: failedAt,
        model: AGENT_MODEL,
        steps: [],
        error: `Unexpected error generating proof pathways: ${reason}`,
        producedEvidenceIds: [],
      });
    }
  }

  /* -------------------------------------------------------------- */
  /* Phase C — market research, once, if enabled.                     */
  /* -------------------------------------------------------------- */
  let findings: ResearchFinding[] = [];
  if (effective.includes('market_research')) {
    try {
      const result = await runMarketResearch({ caseId: caseData.id, caseData, refData, now, onStep: params.onStep });
      recordRun(result.run);
      findings = result.findings;
      allEvidence.push(...result.evidence);
    } catch (e) {
      const reason = describeError(e);
      const failedAt = new Date().toISOString();
      recordRun({
        id: randomUUID(),
        caseId: caseData.id,
        agent: 'market_research',
        status: 'failed',
        startedAt: failedAt,
        finishedAt: failedAt,
        model: AGENT_MODEL,
        steps: [],
        error: `Unexpected error during market research: ${reason}`,
        producedEvidenceIds: [],
      });
    }
  }

  /* -------------------------------------------------------------- */
  /* Phase D — diligence planner, last: consumes B and C's output.    */
  /* -------------------------------------------------------------- */
  let insights: AgentInsight[] = [];
  let proposedActions: RecommendedAction[] = [];
  let drafts: DiligenceDraft[] = [];
  if (effective.includes('diligence_planner')) {
    try {
      const result = await runDiligencePlanner({ caseId: caseData.id, caseData, refData, pathways, findings, now, onStep: params.onStep });
      recordRun(result.run);
      insights = result.insights;
      proposedActions = result.actions;
      drafts = result.drafts;
      allEvidence.push(...result.evidence);
    } catch (e) {
      const reason = describeError(e);
      const failedAt = new Date().toISOString();
      recordRun({
        id: randomUUID(),
        caseId: caseData.id,
        agent: 'diligence_planner',
        status: 'failed',
        startedAt: failedAt,
        finishedAt: failedAt,
        model: AGENT_MODEL,
        steps: [],
        error: `Unexpected error during diligence planning: ${reason}`,
        producedEvidenceIds: [],
      });
    }
  }

  const usage = sumUsage(allRuns.map(r => r.usage));
  const overallStatus = rollupStatus(allRuns);
  emit({
    kind: 'message',
    label: `Orchestration ${overallStatus} — ${allRuns.filter(r => r.status === 'succeeded').length}/${allRuns.length} phase run(s) succeeded`,
  });

  const orchestratorRun: AgentRun = {
    id: orchestratorRunId,
    caseId: caseData.id,
    agent: 'orchestrator',
    status: overallStatus,
    startedAt: orchestratorStartedAt,
    finishedAt: new Date().toISOString(),
    model: AGENT_MODEL,
    steps: orchestratorSteps,
    summary: `${effective.join(', ') || 'no phases'} — ${allRuns.filter(r => r.status === 'succeeded').length}/${allRuns.length} succeeded, ${pathways.length} pathway(s), ${findings.length} research finding(s), ${insights.length} insight(s), ${proposedActions.length} proposed action(s).`,
    usage,
    producedEvidenceIds: [],
  };
  params.onRun?.(orchestratorRun);

  const runs = [orchestratorRun, ...allRuns];
  const intelligence: Partial<CaseIntelligence> = {
    runs,
    pathways,
    research: findings,
    insights,
    lastRunAt: new Date().toISOString(),
  };

  return { runs, intelligence, usage, evidence: allEvidence, proposedActions, drafts };
}
