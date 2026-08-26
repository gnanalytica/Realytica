/**
 * Planning agent.
 *
 * Everything else in this package used to run in a fixed chain, at fixed
 * depth, on every case — a clean, fully-documented apartment and an
 * eight-gaps, three-blocker B-khata site got the identical sequence. This
 * file is what looks at a case's actual shape first and decides what it
 * needs: which agents run at all, how much depth each gets, and — just as
 * important — what is deliberately skipped and why.
 *
 * The plan is advisory input to the orchestrator, never a hard requirement:
 * `runOrchestration` still degrades every individual agent call independently,
 * and this file's own contract is that it NEVER blocks the rest of the run.
 * If the model call fails for any reason, `runPlanner` still returns a
 * usable `AgentPlan` — the static fallback below, which reproduces the old
 * fixed pipeline at standard depth — with the failure recorded on the
 * returned `AgentRun` rather than thrown.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentKind,
  AgentPlan,
  AgentRun,
  AgentStep,
  CapabilityGap,
  CaseDocument,
  PlannedTask,
  PromptUsage,
  PropertyCase,
  ReferenceData,
  TaskDepth,
} from '@valytica/shared';
import { describeError } from '../client';
import { PROMPT_KEYS, resolvePrompt, type ResolvedPrompt } from '../prompts';
import { describeGap } from '../routing';
import { missingCredentialsDetail, resolveRoute, toolUseOf } from '../providers';

const TOOL_NAME = 'emit_agent_plan';

const TASK_DEPTHS: TaskDepth[] = ['skip', 'light', 'standard', 'deep'];

/**
 * Every agent the planner may schedule. `orchestrator` and `planner` are not
 * plannable (the orchestrator runs the plan, it is not part of it, and the
 * planner cannot plan itself); `analyst_copilot` is an interactive, on-demand
 * agent invoked from the case chat, never from an orchestration run.
 */
const PLANNABLE_AGENTS: AgentKind[] = ['document_intelligence', 'proof_pathways', 'market_research', 'diligence_planner', 'critic', 'explorer'];

/** Rough indicative per-agent cost at current Opus 5 rates — given to the model so `estimatedCostUsd` reflects something real rather than a guess, and so it has a concrete basis for weighing a "deep" pass against what it costs. */
const COST_GUIDE: Partial<Record<AgentKind, string>> = {
  document_intelligence: 'document_intelligence: ~$0.01-0.05 per unprocessed document (one call each) — scales with document count, not case complexity.',
  proof_pathways: 'proof_pathways: ~$0.05-0.20 total for the case (one call covering every open gap) — scales with the number of open gaps, near-zero when there are none.',
  market_research: 'market_research: ~$0.03-0.10 (web search calls add up) — wasted entirely when there is nothing to compare against (no asking price, no locality reference data).',
  diligence_planner: "diligence_planner: ~$0.02-0.08 — reasons over proof_pathways'/market_research's own output only, so it is cheap unless that output is extensive, and has nothing to synthesise when both were skipped.",
  critic: "critic: ~$0.02-0.08 — one adversarial pass over what the other agents produced this run; scales with how much there is to check, and is wasted when nothing upstream made a checkable claim.",
  explorer: 'explorer: ~$0.05-0.30+ — open-ended, can iterate many times with no fixed stopping point. By far the most expensive agent when it runs "deep"; reserve it for a genuinely open question a fixed pipeline could not already answer.',
};

export interface RunPlannerInput {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  /** Agents this deployment and this request actually permit — the roster the plan must cover, one task each, no more. */
  available: AgentKind[];
  /** ISO timestamp used to date the plan — not wall-clock, so runs are reproducible. */
  now: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunPlannerResult {
  run: AgentRun;
  plan: AgentPlan;
}

/* ------------------------------------------------------------------ */
/* Case-shape digest — what the planner actually reasons over           */
/* ------------------------------------------------------------------ */

function isUnprocessedDocument(document: CaseDocument): boolean {
  return document.ocrStatus !== 'complete' || document.extracted.length === 0;
}

/**
 * A compact, decision-oriented digest of the case — not the full case
 * context `renderCaseContext` builds for a generative agent. The planner
 * does not narrate the property; it only needs enough shape to decide what
 * to run and at what depth, so this stays small and skips document
 * contents, evidence statements and comparables entirely.
 */
function buildCaseShape(caseData: PropertyCase, refData: ReferenceData): Record<string, unknown> {
  const { identity } = caseData;
  const result = caseData.result;
  const documents = caseData.documents;
  const unprocessedCount = documents.filter(isUnprocessedDocument).length;

  const openRisks = result?.risks.filter(r => r.status === 'open') ?? [];
  const openRisksBySeverity = { critical: 0, serious: 0, warning: 0, info: 0 };
  for (const r of openRisks) openRisksBySeverity[r.severity] += 1;

  const stateCompliance = result?.stateCompliance;
  const blockerCheckCount = stateCompliance?.checks.filter(c => c.verdict === 'blocker').length ?? 0;
  const attentionCheckCount = stateCompliance?.checks.filter(c => c.verdict === 'attention').length ?? 0;
  const unresolvedCheckCount = stateCompliance?.unresolved.length ?? 0;

  const intelligence = caseData.intelligence;
  const hasStatePack = refData.statePacks.some(p => p.country === identity.country && p.state.toLowerCase() === identity.state.toLowerCase());
  const hasLocalityReference = refData.localities.some(
    l => l.country === identity.country && l.city.toLowerCase() === identity.city.toLowerCase(),
  );

  return {
    caseStatus: caseData.status,
    hasBeenScreened: Boolean(result),
    verdict: result?.recommendation.verdict,
    confidenceScore: result?.confidence.score,
    confidenceBand: result?.confidence.band,
    confidenceBiggestLever: result?.confidence.biggestLever,
    completenessScore: result?.completeness.score,
    missingCriticalCount: result?.completeness.missingCritical.length ?? 0,
    missingCritical: result?.completeness.missingCritical ?? [],
    openRiskCount: openRisks.length,
    openRisksBySeverity,
    hasStateCompliance: Boolean(stateCompliance),
    stateComplianceScore: stateCompliance?.score,
    blockerCheckCount,
    attentionCheckCount,
    unresolvedCheckCount,
    documentCount: documents.length,
    unprocessedDocumentCount: unprocessedCount,
    hasAskingPrice: identity.askingPrice !== undefined,
    propertyType: identity.propertyType,
    country: identity.country,
    state: identity.state,
    hasStatePackCoverage: hasStatePack,
    hasLocalityReferenceData: hasLocalityReference,
    priorRunCount: intelligence?.runs.length ?? 0,
    priorPathwayCount: intelligence?.pathways.length ?? 0,
    priorResearchFindingCount: intelligence?.research.length ?? 0,
    priorInsightCount: intelligence?.insights.length ?? 0,
    priorGroundingScore: intelligence?.verification?.groundingScore,
  };
}

/* ------------------------------------------------------------------ */
/* Model output contract                                               */
/* ------------------------------------------------------------------ */

interface ValidatedTask {
  agent: AgentKind;
  depth: TaskDepth;
  rationale: string;
  order: number;
  focus: string[];
}

interface ValidatedPlan {
  caseAssessment: string;
  tasks: ValidatedTask[];
  deliberateOmissions: string[];
  estimatedCostUsd: number;
}

function buildValidationSchema(available: AgentKind[]): z.ZodType<ValidatedPlan> {
  const agentEnum = available as [AgentKind, ...AgentKind[]];
  const TaskSchema = z.object({
    agent: z.enum(agentEnum),
    depth: z.enum(TASK_DEPTHS as [TaskDepth, ...TaskDepth[]]),
    rationale: z.string().min(1),
    order: z.number(),
    focus: z.array(z.string()),
  });
  return z.object({
    caseAssessment: z.string().min(1),
    tasks: z.array(TaskSchema),
    deliberateOmissions: z.array(z.string()),
    estimatedCostUsd: z.number().min(0),
  });
}

function buildTaskJsonSchema(available: AgentKind[]) {
  return {
    type: 'object' as const,
    properties: {
      agent: { type: 'string', enum: available, description: 'Which agent this task is for.' },
      depth: {
        type: 'string',
        enum: TASK_DEPTHS,
        description: '"skip" = do not run this agent at all for this case. "light"/"standard"/"deep" all run it, at increasing effort.',
      },
      rationale: { type: 'string', description: 'Why THIS depth is right for THIS case, referencing its actual shape. A bare "skip" or "deep" with no case-specific reason is not acceptable.' },
      order: {
        type: 'integer',
        description:
          'Lower runs earlier; equal values may run concurrently. document_intelligence must be lowest (its extraction can change the screen before anything else reasons over it). proof_pathways and market_research may share an order value. diligence_planner must come after both. critic always runs after every other included agent regardless of the order you give it, since it checks their combined output.',
      },
      focus: { type: 'array', items: { type: 'string' }, description: 'Specific things this run should concentrate on for this case, e.g. a named blocker or gap. Empty array if there is nothing case-specific beyond the agent\'s normal job.' },
    },
    required: ['agent', 'depth', 'rationale', 'order', 'focus'],
    additionalProperties: false,
  };
}

function buildOutputJsonSchema(available: AgentKind[]) {
  return {
    type: 'object' as const,
    properties: {
      caseAssessment: {
        type: 'string',
        description: "Your honest read of what THIS case actually needs, in 2-4 sentences — grounded in the case shape you were given (verdict, gaps, blockers, document state), never generic boilerplate.",
      },
      tasks: {
        type: 'array',
        items: buildTaskJsonSchema(available),
        description: `Exactly one task per agent in this list, no more, no fewer: ${available.join(', ')}.`,
      },
      deliberateOmissions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Named, plain-language statements of what you chose not to do and why — shown to the user, not just logged. At minimum, restate every "skip" here in user-facing language. If you judged every included agent to genuinely warrant standard depth or deeper, say that explicitly rather than leaving this empty without comment.',
      },
      estimatedCostUsd: { type: 'number', description: 'Your honest rough total cost estimate in USD for this plan, using the per-agent cost guide in the system prompt.' },
    },
    required: ['caseAssessment', 'tasks', 'deliberateOmissions', 'estimatedCostUsd'],
    additionalProperties: false,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

/**
 * The system prompt for this agent, from the registry.
 *
 * The role text lives in `../prompts/registry.ts` under the key
 * `planner.system`; version 1 is byte-identical to the `GROUNDING_RULES` plus
 * `PLANNER_ROLE` string this function used to join inline, with the shared
 * preamble composed in through `{{grounding}}` exactly as before.
 *
 * The one thing that stays here is the cost guide. It is generated from
 * `COST_GUIDE` so it cannot drift from the rates this build actually knows —
 * a prompt editor that let somebody hand-type "explorer: ~$0.02" would make
 * `estimatedCostUsd` confidently wrong, and a plan is chosen on that number.
 */
function buildSystemText(): Promise<ResolvedPrompt> {
  const costGuide = PLANNABLE_AGENTS.map(a => COST_GUIDE[a])
    .filter((line): line is string => Boolean(line))
    .map(line => `- ${line}`)
    .join('\n');
  return resolvePrompt(PROMPT_KEYS.plannerSystem, { costGuide });
}

function buildUserText(caseData: PropertyCase, refData: ReferenceData, available: AgentKind[], now: string): string {
  return [
    `As of ${now}. Agents available for this run — produce exactly one task per entry: ${available.join(', ')}.`,
    '',
    'CASE SHAPE (JSON) — everything you have to decide from:',
    JSON.stringify(buildCaseShape(caseData, refData), null, 1),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Static fallback — the safety net when the planner call itself fails  */
/* ------------------------------------------------------------------ */

/**
 * Deliberately NOT case-adaptive: this reproduces the old fixed pipeline
 * (document intelligence -> proof pathways -> market research -> diligence
 * planner -> critic, all at standard depth) restricted to whichever agents
 * `available` actually names. It exists purely as a safety net for when the
 * live planning call fails, not as a second decision-making path — a clean
 * case and a heavily-blocked case get the identical fallback plan, on
 * purpose, because there is no model call here to tell them apart.
 */
function staticFallbackPlan(available: AgentKind[], now: string, assessment: string): AgentPlan {
  const availableSet = new Set(available);
  const tasks: PlannedTask[] = [];
  let order = 1;
  const FIXED_ORDER: AgentKind[] = ['document_intelligence', 'proof_pathways', 'market_research', 'diligence_planner', 'critic'];
  for (const agent of FIXED_ORDER) {
    if (!availableSet.has(agent)) continue;
    tasks.push({
      agent,
      depth: 'standard',
      rationale: 'Static fallback plan (the live planning call did not produce a plan) — running the standard fixed pipeline at standard depth rather than skip anything or guess at case-specific depth.',
      order: order++,
      focus: [],
    });
  }

  const deliberateOmissions: string[] = [];
  if (availableSet.has('explorer')) {
    deliberateOmissions.push(
      'Explorer skipped under the static fallback plan: open-ended exploration needs a model-authored objective, which a non-adaptive fallback cannot responsibly produce.',
    );
  }

  const estimatedCostUsd =
    Math.round(
      tasks.reduce((sum, t) => {
        // Same order-of-magnitude midpoints as the cost guide given to the live planner.
        const midpoints: Partial<Record<AgentKind, number>> = {
          document_intelligence: 0.03,
          proof_pathways: 0.1,
          market_research: 0.06,
          diligence_planner: 0.04,
          critic: 0.04,
        };
        return sum + (midpoints[t.agent] ?? 0);
      }, 0) * 10000,
    ) / 10000;

  return {
    id: randomUUID(),
    createdAt: now,
    caseAssessment: assessment,
    tasks,
    deliberateOmissions,
    estimatedCostUsd,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runPlanner(input: RunPlannerInput): Promise<RunPlannerResult> {
  const { caseId, caseData, refData, available, now } = input;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    input.onStep?.(full);
  };

  // Resolved once, at the top, so the model recorded on the run is the model
  // the request was built with and the model the usage was priced against.
  const { route, provider, descriptor } = resolveRoute('planner');
  const tier = route.tier;
  const model = route.model;

  /** What this run asked the provider for and did not get. */
  let capabilityGaps: CapabilityGap[] = [];

  /**
   * Which prompt versions this run used. Empty on the fallback paths that
   * never got as far as a model call — including the credential check, which
   * is why the static fallback plan honestly reports no prompt at all.
   */
  let promptUsages: PromptUsage[] = [];

  const succeed = (plan: AgentPlan, summary: string, usage?: AgentRun['usage']): RunPlannerResult => ({
    run: {
      id: runId,
      caseId,
      agent: 'planner',
      status: 'succeeded',
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      summary,
      usage,
      producedEvidenceIds: [],
    },
    plan,
  });

  const fallback = (reason: string, usage?: AgentRun['usage']): RunPlannerResult => {
    emit({ kind: 'error', label: 'Planner call failed — using the static fallback plan.', detail: reason });
    const plan = staticFallbackPlan(available, now, `Planning failed (${reason}) — running the standard fixed pipeline at standard depth as a safe default.`);
    return {
      run: {
        id: runId,
        caseId,
        agent: 'planner',
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        model,
        tier,
        provider: route.provider,
        capabilityGaps,
        prompts: promptUsages,
        steps,
        error: reason,
        usage,
        producedEvidenceIds: [],
      },
      plan,
    };
  };

  if (available.length === 0) {
    emit({ kind: 'plan', label: 'No agents available to plan for this run.' });
    return succeed(
      { id: randomUUID(), createdAt: now, caseAssessment: 'No agents are available for this run (deployment configuration or the requested subset excludes all of them), so there is nothing to plan.', tasks: [], deliberateOmissions: [], estimatedCostUsd: 0 },
      'No agents available — empty plan.',
    );
  }

  emit({ kind: 'plan', label: `Assessing case shape to plan across ${available.length} agent(s): ${available.join(', ')}.` });

  if (!descriptor.configured) {
    return fallback(missingCredentialsDetail(route));
  }

  // Resolved per run rather than at module load, because the active version
  // can change under a running process. Deterministic for a given version, so
  // the cache breakpoint below still lands on a byte-stable prefix.
  const systemPrompt = await buildSystemText();
  promptUsages = systemPrompt.usages;
  const userText = buildUserText(caseData, refData, available, now);

  emit({ kind: 'tool_call', label: `Requesting a plan from ${model} (${tier} tier).`, toolName: TOOL_NAME });

  let result;
  try {
    result = await provider.complete({
      agent: 'planner',
      caseId,
      model,
      maxTokens: 6000,
      effort: 'medium',
      system: [{ text: systemPrompt.content, cacheBreakpoint: true }],
      messages: [{ role: 'user', content: userText }],
      tools: [
        {
          kind: 'schema',
          name: TOOL_NAME,
          description: 'Emit the plan for this case: one task per available agent, with depth, rationale, order and focus, plus the case assessment, deliberate omissions and an estimated cost.',
          strict: true,
          parameters: buildOutputJsonSchema(available),
        },
      ],
      toolChoice: { type: 'tool', name: TOOL_NAME },
    });
  } catch (e) {
    return fallback(describeError(e));
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) {
    emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
  }

  emit({ kind: 'tool_result', label: `Received response (stop_reason: ${result.stopReason ?? 'unknown'}).`, toolName: TOOL_NAME });

  const usage = result.usage;

  if (result.stopReason === 'refusal') {
    return fallback('The model declined to plan this case (safety refusal) and no fallback produced a usable response.', usage);
  }

  const toolUse = toolUseOf(result, TOOL_NAME);
  if (!toolUse) {
    return fallback(`The model did not return the expected tool call (stop_reason=${result.stopReason ?? 'unknown'}).`, usage);
  }

  const parsed = buildValidationSchema(available).safeParse(toolUse.input);
  if (!parsed.success) {
    return fallback(`Model output did not match the expected schema: ${parsed.error.message}`, usage);
  }

  // Defensive completeness: every available agent must end up with exactly
  // one task. Duplicate tasks for the same agent keep the first and drop the
  // rest; any available agent the model left out entirely is filled in as an
  // explicit, recorded "skip" rather than silently vanishing from the plan.
  const byAgent = new Map<AgentKind, ValidatedTask>();
  const duplicateAgents: AgentKind[] = [];
  for (const t of parsed.data.tasks) {
    if (byAgent.has(t.agent)) {
      duplicateAgents.push(t.agent);
      continue;
    }
    byAgent.set(t.agent, t);
  }
  if (duplicateAgents.length > 0) {
    emit({ kind: 'message', label: `Ignored ${duplicateAgents.length} duplicate task(s) for the same agent.`, detail: duplicateAgents.join(', ') });
  }

  const missingAgents = available.filter(a => !byAgent.has(a));
  const tasks: PlannedTask[] = available.map(agent => {
    const t = byAgent.get(agent);
    if (t) return { agent: t.agent, depth: t.depth, rationale: t.rationale, order: t.order, focus: t.focus };
    return {
      agent,
      depth: 'skip',
      rationale: "The planner's response did not cover this agent — treated as skipped rather than run unreasoned.",
      order: Number.MAX_SAFE_INTEGER,
      focus: [],
    };
  });
  if (missingAgents.length > 0) {
    emit({ kind: 'message', label: `Planner left ${missingAgents.length} available agent(s) unaddressed — defaulted to skip.`, detail: missingAgents.join(', ') });
  }

  const plan: AgentPlan = {
    id: randomUUID(),
    createdAt: now,
    caseAssessment: parsed.data.caseAssessment,
    tasks,
    deliberateOmissions: parsed.data.deliberateOmissions,
    estimatedCostUsd: Math.round(Math.max(0, parsed.data.estimatedCostUsd) * 10000) / 10000,
  };

  const runCount = tasks.filter(t => t.depth !== 'skip').length;
  emit({ kind: 'message', label: `Plan built: ${runCount}/${tasks.length} agent(s) to run, ${plan.deliberateOmissions.length} deliberate omission(s), est. $${plan.estimatedCostUsd}.` });

  return succeed(plan, `Planned ${runCount}/${tasks.length} agent(s) to run; ${plan.deliberateOmissions.length} deliberate omission(s).`, usage);
}
