/**
 * Project copilot — tool-using agent over one DdProject.
 *
 * Thinks with live registers, then helps: answers, proposes the next DD /
 * evidence / finding / action / decision, and can run orchestrate/screen as
 * cards. Register writes stay propose-and-review unless the person already
 * issued a deterministic command (handled by applyProjectChat, not here).
 */

import type { AgentStep, ChatChoice, ChatProposal, CopilotTurn, DdProject, ProjectChatTurn, ScopeKey, SittingRef } from '@realytica/shared';
import { sittingChatHistory, talkSittingFromText } from '@realytica/shared';
import { agentCapability, describeError } from '../client';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmClientTool, LlmMessage } from '../providers';
import { createProjectTools, type ProjectAgentCollectors } from '../tools/project-tools';
import { randomUUID } from 'node:crypto';

const MAX_TOOL_ITERATIONS = 8;

const SYSTEM = `You are Realytica's project due-diligence copilot. You sit in the project cockpit: chat on the left, live registers and DD on the right.

You actually think. Read the project with tools before answering. Search registers before proposing a duplicate. Then help: explain what the registers show, recommend the next assessment or scope, request missing evidence, draft findings/risks/actions/decisions as cards, or run a capability the person asked for.

Hard rules:
1. Evidence before assertion. If the registers do not support a claim, say so. Do not invent documents, areas, values, statutes, or sign-off.
2. Model conclusions are propose-and-review. Call propose_update or run_capability(screen|valuation) — never claim a finding/risk/action is already on the project.
3. Person commands are not yours to invent. Do not close an action, change owner, or start a DD because you think it would be tidy. Propose a card. If they already said "set owner to X" that path is handled outside this agent.
3a. Never guess which record they meant. If the words they used could be more than one check, scope, DD, finding, risk or action — or match none exactly — call ask_to_choose with their phrase and let them pick. Say plainly that you have changed nothing. This matters most when they asked you to CHANGE something: a wrong guess on a question wastes a turn, a wrong guess on a command writes to a register. Do not answer a different question confidently because it was the nearest one you could answer.
3b. Some things chat cannot do, and recording a check result is one — the person ticks or crosses it on the right, because closing a check is a judgement with their name on it. When they ask for something you have no tool for, say so in one line and offer the nearest thing you CAN do (open it there, request its evidence, draft a finding). Never let "I opened it" stand in for "I did it".
4. Indicative valuation is not a certified IBBI certificate. Say so whenever value is discussed.
5. When you name a DD, scope, or check, call navigate_pane with those ids so the right-hand field opens. When you cite evidence, include the evidence id.
6. Keep the spoken answer under ~280 words. Cards carry the payload. Cite register titles in prose (Fire NOC, Approval conditions) — not truncated ids. You may put an id in parentheses after the title.
7. If you cannot help from the registers, say what evidence would unblock you.
8. Name one next move. Follow the Next line from get_project / get_sitting. Pack completeness (title, survey, sanction, fire NOC) is the health figure — do not list the evidence library.
9. Call get_sitting when the person is on a check. Call review_findings only when they ask to criticise unevidenced findings — never record a check.
10. Connections on this file: get_subgraph and trace_conclusion. Those hits are this project's registers, not the law. For IBBI, NBC, PTCL, Registration Act and similar, call lookup_reference — cite title and asOf, never file the URL as evidence.
11. Gated portals (Kaveri, Bhoomi, e-Khata, BBMP tax, Fire NOC): call get_portal_route or read get_sitting.portal. Tell the person to download after login/OTP and attach the file on this check. Never claim you fetched the extract.
12. Master plan / zoning overlay: call compare_planning. The locality pack and a geocoded pin are not the RMP sheet. Do not claim a geometric intersection with the master plan. OSM, BBMP GIS WMS lakes/parks, and OpenCity GBA wards / BBMP lakes are CONTEXT. BMRDA maps are the sitting for Harohalli. Do not overlay DPPlans, GISMaps.in, or withdrawn RMP-2031 PDFs as the plan in force. Propose obtaining the sheet or zoning certificate; never file those URLs as this project's extract.`;

export interface RunProjectCopilotParams {
  project: DdProject;
  question: string;
  actor?: string;
  viewContext?: string;
  history?: CopilotTurn[];
  memory?: string;
  sitting?: SittingRef;
  graphRag?: import('../tools/project-tools').ProjectGraphRagPort;
  lookupShelf?: (query: string, extra?: { scopeKey?: ScopeKey; checkTitle?: string }) => Promise<string>;
  onStep?: (step: AgentStep) => void;
}

export interface RunProjectCopilotResult {
  text: string;
  proposals: ChatProposal[];
  /** Options offered instead of guessing which record was meant. */
  choices: ChatChoice[];
    navigations: { target: string; ddId?: string; scopeId?: string; checkId?: string; node?: string; evidenceId?: string; findingId?: string }[];
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
    ...project.assessments.flatMap((a) => a.scopes.flatMap((s) => [s.id, ...s.checks.map((c) => c.id)])),
    ...project.findings.map((f) => f.id),
    ...project.risks.map((r) => r.id),
    ...project.actions.map((a) => a.id),
    ...project.decisions.map((d) => d.id),
  ]);
  const citedEvidenceIds: string[] = [];
  const citedNodeIds: string[] = [];
  const token = /\b(ev|fnd|rsk|act|dec|dd|ast|scp|prj|rpt|chk)_[a-z0-9-]+/gi;
  for (const match of text.matchAll(token)) {
    const id = match[0];
    if (evidence.has(id) && !citedEvidenceIds.includes(id)) citedEvidenceIds.push(id);
    else if (nodes.has(id) && !citedNodeIds.includes(id)) citedNodeIds.push(id);
  }
  const talk = talkSittingFromText(project, text);
  if (talk) {
    if (talk.extra.evidenceId && !citedEvidenceIds.includes(talk.extra.evidenceId)) citedEvidenceIds.push(talk.extra.evidenceId);
    for (const id of talk.highlightIds) {
      if (evidence.has(id) && !citedEvidenceIds.includes(id)) citedEvidenceIds.push(id);
      else if (nodes.has(id) && !citedNodeIds.includes(id)) citedNodeIds.push(id);
    }
  }
  return { citedEvidenceIds, citedNodeIds };
}

export async function runProjectCopilot(params: RunProjectCopilotParams): Promise<RunProjectCopilotResult> {
  const { project, question, viewContext } = params;
  const actor = params.actor ?? 'operator';
  const empty: RunProjectCopilotResult = {
    text: '',
    proposals: [],
    choices: [],
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

  const bag: ProjectAgentCollectors = { proposals: [], navigations: [], toolCalls: [], choices: [] };
  const tools: LlmClientTool[] = createProjectTools(project, actor, bag, {
    sitting: params.sitting,
    graphRag: params.graphRag,
    lookupShelf: params.lookupShelf,
  }).map(clientToolFromRunnable);

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    params.onStep?.({ id: randomUUID(), at: new Date().toISOString(), ...step });
  };

  const messages: LlmMessage[] = [];
  const history = sittingChatHistory((params.history ?? []) as ProjectChatTurn[]);
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Project ${project.reference} — ${project.name}. Use get_project and get_sitting; do not assume stale chat is current.`,
        cacheBreakpoint: true,
      },
      {
        type: 'text',
        text: [
          `Question: ${question}`,
          viewContext ? `(The person is looking at: ${viewContext}.)` : '',
          params.sitting?.checkId ? `(Sitting check id: ${params.sitting.checkId}.)` : '',
          params.memory ? params.memory : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  try {
    emit({ kind: 'plan', label: 'Reading the sitting' });
    const result = await provider.runTools({
      agent: 'analyst_copilot',
      caseId: project.id,
      model: route.model,
      maxTokens: 4000,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      onMessage: (message) => {
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            emit({ kind: 'tool_call', label: `Looking up ${block.name.replace(/_/g, ' ')}`, toolName: block.name });
          }
        }
      },
    });
    const text = textOf(result).trim() || 'I looked at the project. Approve any cards on this turn to write them.';
    const cites = citeIds(text, project);
    return {
      text,
      proposals: bag.proposals,
      choices: bag.choices,
      navigations: bag.navigations,
      toolCalls: bag.toolCalls.length ? bag.toolCalls : [{ name: 'project_copilot', summary: 'Thought with project tools' }],
      citedEvidenceIds: cites.citedEvidenceIds,
      citedNodeIds: cites.citedNodeIds,
    };
  } catch (e) {
    return { ...empty, text: `The project copilot hit an error: ${describeError(e)}` };
  }
}
