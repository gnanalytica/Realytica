/**
 * Diligence planner — synthesises the screen, the proof pathways and any
 * market research into ranked insights, additional recommended actions, and
 * draft outreach messages for a human to review and send.
 *
 * No tools, no web access: this agent only reasons over what the other
 * phases already produced (plus the screen itself), so a single structured
 * call is enough. Two things this file is careful about because the type
 * system does not enforce them on its own:
 *
 * - Every insight's `evidenceIds` is validated against the case's real
 *   evidence ledger; an id that does not resolve is dropped, and an insight
 *   left with no real evidence behind it is forced to `inferred: true` — an
 *   unlabelled inference is exactly the liability the grounding rules warn
 *   against.
 * - Proposed actions are deduped against the deterministic engine's own
 *   `result.actions` by title *similarity* (word overlap), not exact string
 *   equality, so a reworded restatement of an existing action does not slip
 *   through as "new".
 *
 * Drafts are exactly that — drafted text for a human to copy, edit and send
 * themselves. This file never sends anything, and says so in every draft.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentInsight,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  CapabilityGap,
  DocumentPathway,
  EvidenceItem,
  PropertyCase,
  ReferenceData,
  RecommendedAction,
  ResearchFinding,
  RetrievalSelection,
} from '@valytica/shared';
import { buildTitleGraph } from '@valytica/shared';
import { agentCapability, describeError } from '../client';
import { GROUNDING_RULES } from '../context';
import { retrieveCaseContext } from '../retrieval';
import { describeGap } from '../routing';
import { capabilityBlocksRoute, missingCredentialsReason, resolveRoute, textOf } from '../providers';

export interface DiligenceDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** Id of the RecommendedAction (existing or newly proposed) this draft serves. Empty string when it stands alone. */
  relatedActionId: string;
}

export interface RunDiligencePlannerParams {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  pathways: DocumentPathway[];
  findings: ResearchFinding[];
  /** ISO timestamp used to date produced evidence — not wall-clock, so runs are reproducible. */
  now?: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunDiligencePlannerResult {
  run: AgentRun;
  insights: AgentInsight[];
  actions: RecommendedAction[];
  drafts: DiligenceDraft[];
  evidence: EvidenceItem[];
}

const DRAFT_DISCLAIMER =
  '\n\n— Drafted by Valytica’s diligence planner for your review. Nothing is sent automatically; read it, edit it, and send it yourself if you agree with it.';

const SYSTEM_PROMPT = `
${GROUNDING_RULES}

You are the diligence planner. You are given one case's full screen result, the proof pathways already generated for its gaps, and any market research findings. Synthesise all three into what a working analyst would actually do next — do not restate the screen, add to it.

Insights:
- Each insight is a short, specific observation that connects two or more of: the screen (drivers, risks, compliance, anchors), the proof pathways, and the research findings. A ranked list of generic restatements is not useful; a list that says what the pieces mean *together* is.
- Set "inferred": true whenever the insight rests on your own reasoning rather than a fact already on the case's evidence ledger. Cite real evidence ids in "evidenceIds" only when you actually have them — never invent one.

Additional actions:
- Propose only actions the deterministic engine's own action list (given to you in the screen) does NOT already cover. Read that list carefully before proposing anything — a reworded version of an existing action is still a duplicate.
- A good additional action usually comes directly from a proof pathway (obtaining a specific missing document or resolving a specific unresolved check) or from a research finding that contradicts the engine's data.
- When an action is the kind of thing that starts with sending a message — a document request to the seller, an instruction to the buyer's advocate to proceed or hold, a query to BBMP or the sub-registrar — include a "draft" for it: a ready-to-send message a human can review and send themselves. Not every action needs one.

You must respond with nothing but a single fenced JSON code block, matching exactly this shape, and nothing before or after it:
\`\`\`json
{
  "insights": [
    { "title": string, "body": string, "category": "valuation"|"risk"|"compliance"|"market"|"process", "importance": "high"|"medium"|"low", "evidenceIds": string[], "inferred": boolean }
  ],
  "actions": [
    {
      "title": string, "description": string,
      "priority": "now"|"before_offer"|"before_completion",
      "owner": "buyer"|"lawyer"|"valuer"|"lender"|"seller"|"surveyor",
      "effort": "low"|"medium"|"high",
      "unblocks": string[], "relatedRiskIds": string[],
      "draft": { "to": string, "subject": string, "body": string } | null
    }
  ]
}
\`\`\`
Omit "draft" (send null) for actions that are not a message to send. If there is genuinely nothing to add beyond the engine's own actions, return an empty "actions" array — do not pad it with restatements.
`.trim();

const InsightSchema = z.object({
  title: z.string(),
  body: z.string(),
  category: z.enum(['valuation', 'risk', 'compliance', 'market', 'process']),
  importance: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()).default([]),
  inferred: z.boolean(),
});

const ActionSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['now', 'before_offer', 'before_completion']),
  owner: z.enum(['buyer', 'lawyer', 'valuer', 'lender', 'seller', 'surveyor']),
  effort: z.enum(['low', 'medium', 'high']),
  unblocks: z.array(z.string()).default([]),
  relatedRiskIds: z.array(z.string()).default([]),
  draft: z.object({ to: z.string(), subject: z.string(), body: z.string() }).nullable().optional(),
});

const OutputSchema = z.object({
  insights: z.array(InsightSchema).default([]),
  actions: z.array(ActionSchema).default([]),
});

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}

function normalizeWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
}

/** Jaccard word overlap — a rough but effective stand-in for "same intent" without an extra model call. */
function titleSimilarity(a: string, b: string): number {
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection += 1;
  const union = wa.size + wb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_TITLE_THRESHOLD = 0.45;

const IMPORTANCE_CONFIDENCE: Record<AgentInsight['importance'], number> = { high: 0.8, medium: 0.6, low: 0.4 };

export async function runDiligencePlanner(params: RunDiligencePlannerParams): Promise<RunDiligencePlannerResult> {
  const { caseId, caseData, refData, pathways, findings } = params;
  const now = params.now ?? new Date().toISOString();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    params.onStep?.(full);
  };

  // Resolved once, at the top, so the model recorded on the run is the model
  // the request was built with and the model the usage was priced against.
  const { route, provider, descriptor } = resolveRoute('diligence_planner');
  const tier = route.tier;
  const model = route.model;

  /** What this run asked the provider for and did not get. */
  let capabilityGaps: CapabilityGap[] = [];

  const finish = (status: AgentRunStatus, error: string | undefined, usage?: AgentRun['usage']): RunDiligencePlannerResult => {
    const run: AgentRun = {
      id: runId,
      caseId,
      agent: 'diligence_planner',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      steps,
      retrieval: retrievalSelection,
      error,
      usage,
      producedEvidenceIds: [],
    };
    return { run, insights: [], actions: [], drafts: [], evidence: [] };
  };

  emit({ kind: 'plan', label: `Planning next steps from ${pathways.length} pathway(s) and ${findings.length} research finding(s)` });

  // `agentCapability()` answers two questions at once: is the agent layer
  // switched on, and does this deployment hold Anthropic credentials. Only the
  // first applies to every route — see `capabilityBlocksRoute`. Blocking an
  // OpenAI-compatible route for want of an ANTHROPIC_API_KEY would make the
  // port unusable on exactly the deployments it exists for.
  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability)) {
    const reason = `The diligence planner is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason);
  }

  if (!descriptor.configured) {
    const reason = missingCredentialsReason(route, 'the diligence planner is unavailable.');
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason);
  }

  if (!caseData.result) {
    const reason = 'This case has not been screened yet — there is nothing for the diligence planner to synthesise.';
    emit({ kind: 'error', label: 'No screen result', detail: reason });
    return finish('cancelled', reason);
  }

  /** Set once retrieval runs; recorded on the run so the context is auditable. */
  let retrievalSelection: RetrievalSelection | undefined;

  const existingActions = caseData.result.actions;
  const validEvidenceIds = new Set(caseData.result.evidence.map(e => e.id));
  const validRiskIds = new Set(caseData.result.risks.map(r => r.id));

  // Focused on what this agent is for: the open risks and gaps it must turn
  // into actions. It does not need the comparable-by-comparable market
  // detail, and on a large case that detail is most of the prompt.
  const retrieved = retrieveCaseContext({
    caseData,
    refData,
    agent: 'diligence_planner',
    graph: buildTitleGraph(caseData, now),
    focus: [
      ...caseData.result.risks.filter(r => r.status === 'open').map(r => r.title),
      ...caseData.result.completeness.missingCritical,
    ],
  });
  retrievalSelection = retrieved.selection;
  const caseContext = retrieved.text;
  const pathwaysSummary = JSON.stringify(
    pathways.map(p => ({
      id: p.id,
      targetKind: p.targetKind,
      targetLabel: p.targetLabel,
      whyItMatters: p.whyItMatters,
      routeCount: p.routes.length,
      bestRoute: p.routes.find(r => r.id === p.recommendedRouteId)?.title ?? p.routes[0]?.title,
      unlocks: p.unlocks,
      wouldResolve: p.wouldResolve,
    })),
    null,
    1,
  );
  const findingsSummary = JSON.stringify(
    findings.map(f => ({
      id: f.id,
      claim: f.claim,
      relevance: f.relevance,
      confidence: f.confidence,
      corroboration: f.corroboration,
      contradictsEngine: f.contradictsEngine,
      sourceTitle: f.sourceTitle,
    })),
    null,
    1,
  );

  const userMessage = [
    `Case screen (includes the engine's own action list — do not duplicate it):\n${caseContext}`,
    `Proof pathways (${pathways.length}):\n${pathwaysSummary}`,
    `Market research findings (${findings.length}):\n${findingsSummary}`,
  ].join('\n\n');

  emit({ kind: 'message', label: 'Synthesising insights and additional actions' });

  let result;
  try {
    result = await provider.complete({
      agent: 'diligence_planner',
      model,
      maxTokens: 16000,
      system: [{ text: SYSTEM_PROMPT, cacheBreakpoint: true }],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    return finish('failed', reason);
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) {
    emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
  }

  const usage = result.usage;

  if (result.stopReason === 'refusal') {
    const reason = 'Claude declined to produce a diligence plan (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, usage);
  }

  const parsed = OutputSchema.safeParse(extractJson(textOf(result)));

  if (!parsed.success) {
    const reason = `The model did not return a valid diligence plan: ${parsed.error.message}`;
    emit({ kind: 'error', label: 'Invalid plan output', detail: reason });
    return finish('failed', reason, usage);
  }

  const insights: AgentInsight[] = [];
  const evidence: EvidenceItem[] = [];
  for (const raw of parsed.data.insights) {
    const evidenceIds = raw.evidenceIds.filter(id => validEvidenceIds.has(id));
    const inferred = raw.inferred || evidenceIds.length === 0;
    const insightId = `insight-${randomUUID()}`;
    insights.push({ id: insightId, title: raw.title, body: raw.body, category: raw.category, importance: raw.importance, evidenceIds, inferred });
    evidence.push({
      id: `ev-${insightId}`,
      statement: `${raw.title}: ${raw.body}`.slice(0, 500),
      sourceType: 'model_inference',
      sourceRef: insightId,
      sourceLabel: 'Diligence planner insight',
      confidence: inferred ? Math.min(0.6, IMPORTANCE_CONFIDENCE[raw.importance]) : IMPORTANCE_CONFIDENCE[raw.importance],
      capturedAt: now,
    });
  }

  const actions: RecommendedAction[] = [];
  const drafts: DiligenceDraft[] = [];
  let duplicatesDropped = 0;
  for (const raw of parsed.data.actions) {
    const isDuplicate = existingActions.some(a => titleSimilarity(a.title, raw.title) >= DUPLICATE_TITLE_THRESHOLD);
    if (isDuplicate) {
      duplicatesDropped += 1;
      continue;
    }
    const actionId = `diligence-${randomUUID()}`;
    actions.push({
      id: actionId,
      title: raw.title,
      description: raw.description,
      priority: raw.priority,
      owner: raw.owner,
      effort: raw.effort,
      unblocks: raw.unblocks,
      relatedRiskIds: raw.relatedRiskIds.filter(id => validRiskIds.has(id)),
      done: false,
    });
    if (raw.draft) {
      drafts.push({
        id: `draft-${randomUUID()}`,
        to: raw.draft.to,
        subject: raw.draft.subject,
        body: raw.draft.body + DRAFT_DISCLAIMER,
        relatedActionId: actionId,
      });
    }
  }

  emit({
    kind: 'message',
    label: `${insights.length} insight(s), ${actions.length} new action(s)${duplicatesDropped > 0 ? ` (${duplicatesDropped} duplicate-of-engine dropped)` : ''}, ${drafts.length} draft(s)`,
  });

  const run: AgentRun = {
    id: runId,
    retrieval: retrievalSelection,
    caseId,
    agent: 'diligence_planner',
    status: 'succeeded',
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    tier,
    provider: route.provider,
    capabilityGaps,
    steps,
    summary:
      `${insights.length} insight(s), ${actions.length} new action(s), ${drafts.length} draft message(s) for review — Valytica does not send these automatically.` +
      (capabilityGaps.length > 0 ? ` Route ${route.provider} degraded: ${capabilityGaps.join(', ')}.` : ''),
    usage,
    producedEvidenceIds: evidence.map(e => e.id),
  };
  return { run, insights, actions, drafts, evidence };
}
