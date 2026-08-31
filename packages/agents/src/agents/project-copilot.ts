/**
 * Project copilot — tool-using agent over one DdProject.
 *
 * Thinks with live registers, then helps: answers, proposes the next DD /
 * evidence / finding / action / decision, and can run orchestrate/screen as
 * cards. Register writes stay propose-and-review unless the person already
 * issued a deterministic command (handled by applyProjectChat, not here).
 */

import type { ChatProposal, CopilotTurn, DdProject } from '@realytica/shared';
import { agentCapability, describeError } from '../client';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmClientTool, LlmMessage } from '../providers';
import { createProjectTools, type ProjectAgentCollectors } from '../tools/project-tools';

const MAX_TOOL_ITERATIONS = 8;

const SYSTEM = `You are Realytica's project due-diligence copilot. You sit in the project cockpit: chat on the left, live registers and DD on the right.

You actually think. Read the project with tools before answering. Search registers before proposing a duplicate. Then help: explain what the registers show, recommend the next assessment or scope, request missing evidence, draft findings/risks/actions/decisions as cards, or run a capability the person asked for.

Hard rules:
1. Evidence before assertion. If the registers do not support a claim, say so. Do not invent documents, areas, values, statutes, or sign-off.
2. Model conclusions are propose-and-review. Call propose_update or run_capability(screen|valuation) — never claim a finding/risk/action is already on the project.
3. Person commands are not yours to invent. Do not close an action, change owner, or start a DD because you think it would be tidy. Propose a card. If they already said "set owner to X" that path is handled outside this agent.
4. Indicative valuation is not a certified IBBI certificate. Say so whenever value is discussed.
5. Open the pane that matches what you proposed (navigate_pane) so the right-hand view stays in sync.
6. Keep the spoken answer under ~280 words. Cards carry the payload. Cite register ids in prose (finding id, evidence id) when you rest on them.
7. If you cannot help from the registers, say what evidence would unblock you.`;

export interface RunProjectCopilotParams {
  project: DdProject;
  question: string;
  actor?: string;
  viewContext?: string;
  history?: CopilotTurn[];
}

export interface RunProjectCopilotResult {
  text: string;
  proposals: ChatProposal[];
  navigations: { target: string }[];
  toolCalls: { name: string; summary: string }[];
  citedEvidenceIds: string[];
  citedNodeIds: string[];
}

function citeIds(text: string, project: DdProject): { citedEvidenceIds: string[]; citedNodeIds: string[] } {
  const evidence = new Set(project.evidence.map((e) => e.id));
  const nodes = new Set<string>([
    project.id,
    ...project.assets.map((a) => a.id),
    ...project.assessments.map((a) => a.id),
    ...project.assessments.flatMap((a) => a.scopes.map((s) => s.id)),
    ...project.findings.map((f) => f.id),
    ...project.risks.map((r) => r.id),
    ...project.actions.map((a) => a.id),
    ...project.decisions.map((d) => d.id),
  ]);
  const citedEvidenceIds: string[] = [];
  const citedNodeIds: string[] = [];
  const token = /\b(ev|fnd|rsk|act|dec|dd|ast|scp|prj|rpt)_[a-z0-9-]+/gi;
  for (const match of text.matchAll(token)) {
    const id = match[0];
    if (evidence.has(id) && !citedEvidenceIds.includes(id)) citedEvidenceIds.push(id);
    else if (nodes.has(id) && !citedNodeIds.includes(id)) citedNodeIds.push(id);
  }
  return { citedEvidenceIds, citedNodeIds };
}

export async function runProjectCopilot(params: RunProjectCopilotParams): Promise<RunProjectCopilotResult> {
  const { project, question, viewContext, history = [] } = params;
  const actor = params.actor ?? 'operator';
  const empty: RunProjectCopilotResult = {
    text: '',
    proposals: [],
    navigations: [],
    toolCalls: [],
    citedEvidenceIds: [],
    citedNodeIds: [],
  };

  const { route, provider, descriptor } = resolveRoute('analyst_copilot');
  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability)) {
    return { ...empty, text: `The project copilot is unavailable (${capability.reason}). Commands still work without a model.` };
  }
  if (!descriptor.configured) {
    return { ...empty, text: missingCredentialsReason(route, 'the project copilot is unavailable.') };
  }

  const bag: ProjectAgentCollectors = { proposals: [], navigations: [], toolCalls: [] };
  const tools: LlmClientTool[] = createProjectTools(project, actor, bag).map(clientToolFromRunnable);

  const messages: LlmMessage[] = [];
  for (const turn of history.slice(-8)) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Project ${project.reference} — ${project.name}. Use get_project; do not assume stale chat is current.`,
        cacheBreakpoint: true,
      },
      {
        type: 'text',
        text: [
          `Question: ${question}`,
          viewContext ? `(The person is looking at: ${viewContext}.)` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  try {
    const result = await provider.runTools({
      agent: 'analyst_copilot',
      caseId: project.id,
      model: route.model,
      maxTokens: 4000,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
    });
    const text = textOf(result).trim() || 'I looked at the project. Approve any cards on this turn to write them.';
    const cites = citeIds(text, project);
    return {
      text,
      proposals: bag.proposals,
      navigations: bag.navigations,
      toolCalls: bag.toolCalls.length ? bag.toolCalls : [{ name: 'project_copilot', summary: 'Thought with project tools' }],
      citedEvidenceIds: cites.citedEvidenceIds,
      citedNodeIds: cites.citedNodeIds,
    };
  } catch (e) {
    return { ...empty, text: `The project copilot hit an error: ${describeError(e)}` };
  }
}
