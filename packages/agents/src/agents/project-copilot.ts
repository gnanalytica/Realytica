/**
 * Project copilot — tool-using agent over one DdProject.
 *
 * Thinks with live registers, then helps: answers, proposes the next DD /
 * evidence / finding / action / decision, and can run orchestrate/screen as
 * cards. Register writes stay propose-and-review unless the person already
 * issued a deterministic command (handled by applyProjectChat, not here).
 */

import type { AgentStep, ChatChoice, ChatPlace, ChatProposal, CockpitPathExtra, CopilotTurn, DdProject, ProjectChatTurn, ScopeKey, SittingRef, TurnSpend, ChatWebPull } from '@realytica/shared';
import { MEM_ANSWER_RULES, chatPlaceLine, memNoteOfReply, sittingChatHistory, talkSittingFromText, verifyAttribution } from '@realytica/shared';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { agentCapability, describeError } from '../client';
import { basicChatModel } from '../config';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmClientTool, LlmContentBlock, LlmMessage } from '../providers';
import { createProjectTools, type ProjectAgentCollectors } from '../tools/project-tools';
import { randomUUID } from 'node:crypto';
import { priceTokens } from '../telemetry/pricing';

const MAX_TOOL_ITERATIONS = 8;
/** The free first rung looks things up and answers, or hands over; it does not get the senior model's room. */
const BASIC_TOOL_ITERATIONS = 6;

const SYSTEM = `You are Realytica's project due-diligence copilot. You sit in the project cockpit: chat on the left, live registers and DD on the right.

You actually think. Read the project with tools before answering. Search registers before proposing a duplicate. Then help: explain what the registers show, recommend the next assessment or scope, request missing evidence, draft findings/risks/actions/decisions as cards, or run a capability the person asked for.

Hard rules:
1. Evidence before assertion. If the registers do not support a claim, say so. Do not invent documents, areas, values, statutes, or sign-off.
2. Model conclusions are propose-and-review. Call propose_update or run_capability(screen|valuation) — never claim a finding/risk/action is already on the project.
2a. What you propose waits on the canvas, in the register it would change, for the person to accept or set aside there. Say where it is waiting ("waiting under Findings"). Never say "approve below", "approve the card" or "say approve all": the chat holds no buttons.
3. Person commands are not yours to invent. Do not close an action, change owner, or start a DD because you think it would be tidy. Propose a card. If they already said "set owner to X" that path is handled outside this agent.
3a. Never guess which record they meant. If the words they used could be more than one check, scope, DD, finding, risk or action — or match none exactly — call ask_to_choose with their phrase and let them pick. Say plainly that you have changed nothing. This matters most when they asked you to CHANGE something: a wrong guess on a question wastes a turn, a wrong guess on a command writes to a register. Do not answer a different question confidently because it was the nearest one you could answer.
3b. You may PROPOSE a check result with propose_update kind=record_check, never record one. A person saying "mark it compliant" is handled outside this agent and executes as their own instruction; you concluding the same thing is a card they accept. Your comments field must say what in the evidence supports the result — a recorded result raises a finding for every material outcome, and a finding with no reason behind it is what the critic exists to catch.
3c. When they ask for something you have no tool for, say so in one line and offer the nearest thing you CAN do. Never let "I opened it" stand in for "I did it".
3d. The report is half alive. Call get_report before touching it. A section marked live reads the registers — its words are not yours to write, and propose_update will refuse them. To change what a live section says, either propose a source change on that block, or propose a paragraph beside it. To rewrite prose somebody wrote, propose blockId+text and say what you changed. A person saying "add a note: ..." or "detach the findings section" is handled outside this agent and executes as their own instruction.
4. Indicative valuation is not a certified IBBI certificate. Say so whenever value is discussed.
5. When you name a DD, scope, or check, call navigate_pane with those ids so the right-hand field opens. When you cite evidence, include the evidence id.
5a. The question comes with the page the person is on: a department, one of its functions (Title, Approvals, Progress), or a place the whole project shares, and the stage it is being looked at in. "What is missing", "summarise" and "which findings are critical" are about that page unless they name the project or the file; open your answer by saying which you answered ("On Title: ..."). Asked to open a page or look at a stage, call navigate_pane with department, function and stage. Looking at a stage never moves the project to it: moving the project is a change_stage proposal, and only when they ask for the move.
5b. For what a paper says that no register holds (a clause, a right of way, who witnessed a deed), call search_papers and quote the passage as the paper's own words, with the cite it returns.
6. BE SHORT AND ASK ONE THING. Three sentences is a normal answer; the payload goes on cards, not into prose. Ask exactly ONE question per turn — the single most decisive unknown — and never stack two. If you need four facts, ask for the first and say what you will ask next. Every turn ends with one named next action, not a list of options. A turn with more than one question is trimmed before the person sees it, so the ones you stack are the ones you lose. Cite register titles in prose (Fire NOC, Approval conditions) — not truncated ids. You may put an id in parentheses after the title.
7. If you cannot help from the registers, say what evidence would unblock you.
8. Name one next move. Follow the Next line from get_project / get_sitting. Pack completeness (title, survey, sanction, fire NOC) is the health figure — do not list the evidence library.
8a. Interviewing is how you gather. When a check has blank fields, call get_check_fields and ask for ONE of them by its label and unit — "what extent does the title recite, in sqm?" — not for everything at once. When you have the values, propose record_check_fields with the exact keys. Never guess a value to fill a gap, and never state a divergence: the engine computes those from the values and hands them to you as insights.
8b. "How bad is it", "what will it cost", "write the technical summary" — call get_standards_view. It hands you the RICS condition-rating spread, the remedial cost banded by when the money falls, and any finding escalated for immediate action. Do not add up the actions yourself, and never quote the total without the shortfall beside it: a band with nothing priced is not a cheap band, and the caveat field says how many are unpriced. The rating is derived from severity — you may read it, you may not set one.
8c. Before saying anything about condition, what was seen on site, or a master plan, call get_site_record. Never write that something was inspected without reading that visit's limitations — "no defect found" and "the roof was not looked at" are different sentences and only one of them is honest. A photograph's geotag is what the camera claimed; a sheet placement is derived from points a person clicked. Say which when either is load-bearing.
9. Call get_sitting when the person is on a check. Call review_findings only when they ask to criticise unevidenced findings — never record a check.
10. Connections on this file: get_subgraph and trace_conclusion. Those hits are this project's registers, not the law. For IBBI, NBC, PTCL, Registration Act and similar, call lookup_reference — cite title and asOf, never file the URL as evidence.
11. Gated portals (Kaveri, Bhoomi, e-Khata, BBMP tax, Fire NOC): call get_portal_route or read get_sitting.portal. Tell the person to download after login/OTP and attach the file on this check. Never claim you fetched the extract.
12. Master plan / zoning overlay: call compare_planning. The locality pack and a geocoded pin are not the RMP sheet. Do not claim a geometric intersection with the master plan. OSM, BBMP GIS WMS lakes/parks, and OpenCity GBA wards / BBMP lakes are CONTEXT. BMRDA maps are the sitting for Harohalli. Do not overlay DPPlans, GISMaps.in, or withdrawn RMP-2031 PDFs as the plan in force. Propose obtaining the sheet or zoning certificate; never file those URLs as this project's extract.
13. ${MEM_ANSWER_RULES}`;

export interface RunProjectCopilotParams {
  project: DdProject;
  question: string;
  actor?: string;
  viewContext?: string;
  /** The page the person asked from, and the stage it is looked at in. Said to the model in words, and given to the tools that open a page. */
  place?: ChatPlace;
  history?: CopilotTurn[];
  memory?: string;
  sitting?: SittingRef;
  graphRag?: import('../tools/project-tools').ProjectGraphRagPort;
  lookupShelf?: (query: string, extra?: { scopeKey?: ScopeKey; checkTitle?: string }) => Promise<string>;
  /** Locality research. The API owns the capability gates; this only asks. */
  searchWeb?: (question: string) => Promise<ChatWebPull>;
  onStep?: (step: AgentStep) => void;
  /** Run on this model rather than the copilot's own — the first rung of the ladder. */
  model?: string;
  /** Give the model a way to hand the question to the senior model instead of answering it. */
  canHandOver?: boolean;
}

export interface RunProjectCopilotResult {
  text: string;
  proposals: ChatProposal[];
  /** Options offered instead of guessing which record was meant. */
  choices: ChatChoice[];
  navigations: Array<{ target: string } & CockpitPathExtra>;
  toolCalls: { name: string; summary: string }[];
  citedEvidenceIds: string[];
  citedNodeIds: string[];
  /**
   * What the answer asked to be kept in the project's memory: the sentence,
   * and the id it named as what the sentence is about. Taken off the answer's
   * last line, so `text` does not carry it. Nothing has checked the id.
   */
  note?: { note: string; about?: string };
  /** What the call cost, when one was made. Absent on every failure path. */
  spend?: TurnSpend;
  /** Why the model handed the question over, when it did — the answer is then not its own. */
  handedOver?: string;
}

/**
 * Tools that show or offer something and hand back nothing the answer needs.
 * Words written beside one of these are the answer, not a note on the way to it.
 */
const ANSWERING_TOOLS = new Set(['navigate_pane', 'ask_to_choose', 'propose_update', 'propose_drafts']);

/**
 * The answer a loop wrote: every word from its last lookup onwards.
 *
 * Reading only the last message lost answers. Measured on Claude Sonnet 5.5
 * through OpenRouter: the copilot wrote its answer beside `navigate_pane`
 * (which rule 5 asks for whenever it names a DD), then closed with "I've
 * opened the BSNL NOC finding on the right" — and that one line was all the
 * person saw.
 *
 * So the answer runs back from the end through every message that only
 * showed, offered or proposed something, and stops at the last one that
 * looked something up. That message's own words came before what the lookup
 * returned — "let me check" — so they are not part of it.
 */
export function answerOfLoop(messages: LlmContentBlock[][]): string {
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const blocks = messages[i]!;
    const looked = blocks.some((b) => b.type === 'tool_use' && !ANSWERING_TOOLS.has(b.name));
    if (looked) break;
    const words = blocks
      .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (words) parts.unshift(words);
  }
  return parts.join('\n\n');
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
  const looking = chatPlaceLine(project, params.place) ?? viewContext;
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
  const model = params.model ?? route.model;
  const handOver = { reason: '' };
  const tools: LlmClientTool[] = [
    ...createProjectTools(project, actor, bag, {
      sitting: params.sitting,
      place: params.place,
      graphRag: params.graphRag,
      lookupShelf: params.lookupShelf,
      searchWeb: params.searchWeb,
    }),
    ...(params.canHandOver
      ? [
          betaTool({
            name: 'hand_over',
            description:
              'Hand this question to the senior analyst instead of answering it. Call it FIRST, before any other tool, when the question needs judgement rather than a lookup: why or should questions, comparing or reconciling documents, anything about title or legal standing, estimating money, drafting a finding or report text, or anything you are not sure you can answer exactly from the registers. Do not call it for a lookup the tools answer — who owns it, what a document says, what is open.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['reason'],
              properties: { reason: { type: 'string', description: 'One short line: why this needs the senior analyst.' } },
            } as const,
            run: async ({ reason }) => {
              handOver.reason = String(reason ?? '').trim().slice(0, 160) || 'it needed judgement';
              return 'Handed over. Stop now and write nothing else.';
            },
          }),
        ]
      : []),
  ].map(clientToolFromRunnable);

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
          // The page by its name and stage where the request said them; the bare pane from a client that says only that.
          looking ? `(The person is looking at: ${looking}.)` : '',
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
    const written: LlmContentBlock[][] = [];
    const result = await provider.runTools({
      agent: 'analyst_copilot',
      caseId: project.id,
      model,
      maxTokens: 4000,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: params.canHandOver ? BASIC_TOOL_ITERATIONS : MAX_TOOL_ITERATIONS,
      onMessage: (message) => {
        written.push(message.content);
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            emit({ kind: 'tool_call', label: `Looking up ${block.name.replace(/_/g, ' ')}`, toolName: block.name });
          }
        }
      },
    });
    // The note the answer leaves for memory is its last line. It comes off before anything reads the answer: it is not said to the person.
    const said = memNoteOfReply(answerOfLoop(written) || textOf(result).trim());
    const text = said.text || 'I looked at the project. Anything I proposed is waiting on the right.';
    const cites = citeIds(text, project);
    /*
     * What the turn cost, carried out with the answer.
     *
     * Priced here rather than left to the telemetry sink because the sink
     * writes to an admin surface and this figure is for the person who just
     * spent the money. `confidence` travels with it: the pricing module prices
     * an unknown model at zero, and "$0.00" beside a call that cost real money
     * is worse than showing nothing at all.
     */
    const price = priceTokens(route.provider, model, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    });
    return {
      text,
      proposals: bag.proposals,
      choices: bag.choices,
      navigations: bag.navigations,
      toolCalls: bag.toolCalls.length ? bag.toolCalls : [{ name: 'project_copilot', summary: 'Thought with project tools' }],
      citedEvidenceIds: cites.citedEvidenceIds,
      citedNodeIds: cites.citedNodeIds,
      ...(said.note ? { note: { note: said.note, ...(said.about ? { about: said.about } : {}) } } : {}),
      spend: { usd: price.costUsd, exact: price.confidence === 'exact' },
      ...(handOver.reason ? { handedOver: handOver.reason } : {}),
    };
  } catch (e) {
    /*
     * Rethrown, never returned as the answer.
     *
     * This used to hand back "The project copilot hit an error: Error 404 from
     * <endpoint>…" as the turn's text. The route cannot tell that apart from a
     * real answer, so it stored it, showed it, and recorded the run as
     * answered — an endpoint URL and an upstream body in front of the person,
     * and no fallback. Thrown, it lands in the route's own catch, which marks
     * the turn unanswered in plain words and lets the registers answer.
     */
    throw e instanceof Error ? e : new Error(describeError(e));
  }
}


/* ==================================================================== */
/* The ladder                                                            */
/* ==================================================================== */

const FALLBACK_ANSWER = 'I looked at the project. Anything I proposed is waiting on the right.';

/** Questions that go straight to the senior model: writing that will be read as the firm's. */
function needsSeniorOutright(question: string): string | undefined {
  if (question.length > 600) return 'a long question';
  if (/\b(draft|rewrite|reword|write (?:a|an|the|up))\b/i.test(question)) return 'it asked for writing';
  return undefined;
}

function sumSpend(a?: TurnSpend, b?: TurnSpend): TurnSpend | undefined {
  if (!a) return b;
  if (!b) return a;
  return { usd: a.usd + b.usd, exact: a.exact && b.exact };
}

export interface ProjectChatAnswer extends RunProjectCopilotResult {
  /** The model whose answer this is. */
  answeredBy: string;
  /** Why the first rung handed over, when it did. */
  handedOverBecause?: string;
}

/**
 * The chat's ladder: a free model first, the senior model when it is needed.
 *
 * Most questions put to a file are lookups — who owns it, what the khata
 * says, what is still open — and the registers answer them; paying the
 * senior model to read them out is most of what chat cost. So when a basic
 * model is configured (\`REALYTICA_MODEL_BASIC\`) it goes first, with the same
 * tools, and a way out: it hands the question over when it needs judgement.
 * It is also handed over without being asked when it errors or is rate
 * limited, comes back with nothing, or states a figure the file does not
 * support. Without a basic model, the senior model answers as it always did.
 */
export async function runProjectChat(params: RunProjectCopilotParams): Promise<ProjectChatAnswer> {
  const senior = resolveRoute('analyst_copilot').route.model;
  const basic = basicChatModel();
  if (!basic || basic === senior) return { ...(await runProjectCopilot(params)), answeredBy: senior };

  let because = needsSeniorOutright(params.question);
  let firstSpend: TurnSpend | undefined;
  if (!because) {
    try {
      const first = await runProjectCopilot({ ...params, model: basic, canHandOver: true });
      firstSpend = first.spend;
      const nothing = !first.text.trim() || (first.text === FALLBACK_ANSWER && !first.proposals.length && !first.choices.length);
      because =
        first.handedOver
        ?? (nothing ? 'it had no answer' : undefined)
        ?? (verifyAttribution(params.project, first.text).unsupported.length ? 'it stated figures the file does not support' : undefined);
      if (!because) return { ...first, answeredBy: basic };
    } catch {
      because = 'the free model was unavailable';
    }
  }
  params.onStep?.({ id: randomUUID(), at: new Date().toISOString(), kind: 'plan', label: `Handing over to the senior model — ${because}` });
  const answer = await runProjectCopilot(params);
  return { ...answer, answeredBy: senior, handedOverBecause: because, spend: sumSpend(firstSpend, answer.spend) };
}
