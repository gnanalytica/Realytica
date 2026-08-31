/**
 * Project orchestrator agent — a planner pass over DdProject after the rule
 * orchestrator has already proposed drafts from registers.
 *
 * It does not start DDs or write findings. It reads the live project, then
 * queues extra propose-and-review cards (missing DD types, evidence requests,
 * actions) and a tighter summary. Source on the OrchestratorRun becomes
 * `model` when this pass actually ran.
 */

import type { ChatProposal, DdProject, OrchestratorRun } from '@realytica/shared';
import { agentCapability, describeError } from '../client';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmClientTool, LlmMessage } from '../providers';
import { createProjectTools, type ProjectAgentCollectors } from '../tools/project-tools';

const SYSTEM = `You are Realytica's project DD orchestrator. A rule pass already proposed drafts from live registers. Your job is to think about what that pass missed.

Use get_project and search_registers. Then:
- propose_update for start_dd templates that should be running at this stage and are not
- propose_update for request_evidence / add_action on material gaps and overdue work
- propose_update for add_finding or add_risk only when the registers already support it
- navigate_pane to drafts or the register you want the person to review
- Do NOT call run_capability(orchestrate) — that already ran and would duplicate drafts
- Do NOT claim anything is written. Cards are proposals.

Return a short spoken plan (under 180 words): what you recommend, in order, and what a person must still approve. Indicative value is not a certified IBBI certificate.`;

export interface RunProjectOrchestratorAgentResult {
  summary: string;
  proposals: ChatProposal[];
  navigations: { target: string }[];
  toolCalls: { name: string; summary: string }[];
  usedModel: boolean;
  error?: string;
}

export async function runProjectOrchestratorAgent(
  project: DdProject,
  actor = 'operator',
  prior?: OrchestratorRun,
): Promise<RunProjectOrchestratorAgentResult> {
  const { route, provider, descriptor } = resolveRoute('planner');
  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability) || !descriptor.configured) {
    return {
      summary: prior?.summary ?? missingCredentialsReason(route, 'the orchestrator planner is unavailable.'),
      proposals: [],
      navigations: [],
      toolCalls: [],
      usedModel: false,
    };
  }

  const bag: ProjectAgentCollectors = { proposals: [], navigations: [], toolCalls: [] };
  const tools: LlmClientTool[] = createProjectTools(project, actor, bag).map(clientToolFromRunnable);
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Project ${project.reference} — ${project.name}. Stage ${project.currentStage}. Rule orchestrator already ran.`,
          cacheBreakpoint: true,
        },
        {
          type: 'text',
          text: [
            prior
              ? `Rule summary: ${prior.summary}. Drafts: ${prior.draftIds.length}. Recommended DD types not running: ${prior.recommendedDdTypes.join(', ') || 'none'}. Gaps: ${prior.evidenceGapCount}. Open findings: ${prior.openFindingCount}.`
              : 'No prior rule run summary.',
            'Plan the next diligence moves. Propose cards for anything the rule pass missed. Do not re-run orchestrate.',
          ].join('\n'),
        },
      ],
    },
  ];

  try {
    const result = await provider.runTools({
      agent: 'planner',
      caseId: project.id,
      model: route.model,
      maxTokens: 2500,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: 6,
    });
    const summary = textOf(result).trim() || prior?.summary || 'Orchestrator planner finished. Review the cards and drafts.';
    if (!bag.navigations.some((n) => n.target === 'drafts' || n.target === 'orchestrate')) {
      bag.navigations.push({ target: 'orchestrate' });
    }
    return {
      summary,
      proposals: bag.proposals,
      navigations: bag.navigations,
      toolCalls: bag.toolCalls.length ? bag.toolCalls : [{ name: 'project_orchestrator', summary: 'Planned from registers' }],
      usedModel: true,
    };
  } catch (e) {
    return {
      summary: prior?.summary ?? describeError(e),
      proposals: [],
      navigations: [],
      toolCalls: [],
      usedModel: false,
      error: describeError(e),
    };
  }
}
