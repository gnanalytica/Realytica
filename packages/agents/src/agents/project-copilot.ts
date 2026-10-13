/**
 * Project copilot: a tool-using agent over one DdProject, which answers by
 * picking and writes no sentence.
 *
 * It reads the live registers and field sheets with tools. Then it answers
 * with one call (`answer_with_fields`): the addresses of the fields that
 * answer the question, the ids of records, the marks of memory lines and of
 * passages a search of the papers found. Code looks each up and makes the
 * card (`chatAnswerCard`), and the words round the card are a template's.
 * Whatever text the model writes beside its tool calls is thrown away: it
 * is not shown, stored or sent on.
 *
 * It can still propose (a card that waits for a person), offer a choice
 * where a name is unclear, and open a page. Register writes stay
 * propose-and-review unless the person already issued a deterministic
 * command (handled by applyProjectChat, not here).
 */

import type { AgentStep, ChatAnswerCard, ChatAnswerPicks, ChatChoice, ChatPlace, ChatProposal, CockpitPathExtra, CopilotTurn, DdProject, MemContext, ProjectChatTurn, ScopeKey, SittingRef, TurnSpend, ChatWebPull } from '@realytica/shared';
import { CHAT_OUTCOMES, MEM_MARK_KINDS, chatAnswerCard, chatAnswerSaid, chatAnswerText, chatPicksFrom, chatPlaceLine, memMarkSaid, sittingChatHistory, talkSittingFromText, verifyAttribution } from '@realytica/shared';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { agentCapability, describeError } from '../client';
import { basicChatModel } from '../config';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute } from '../providers';
import type { LlmClientTool, LlmMessage } from '../providers';
import { createProjectTools, type ProjectAgentCollectors } from '../tools/project-tools';
import { randomUUID } from 'node:crypto';
import { priceTokens } from '../telemetry/pricing';

const MAX_TOOL_ITERATIONS = 8;
/** The free first rung looks things up and answers, or hands over; it does not get the senior model's room. */
const BASIC_TOOL_ITERATIONS = 6;

/**
 * The language of an answer: the language of the question, for the words a
 * template says round the card (`CHAT_TEMPLATES`), where the template
 * exists in it. What the record holds is never translated: a figure, a name
 * or a document number that comes back changed is a different fact.
 */
export const ANSWER_LANGUAGE_RULE =
  'The person may ask in Hindi, Kannada, Tamil, Telugu or any other language. Read the question in its own language. You write no answer in any language: you pick fields, records and marks, and the reply is printed from the record as the record holds it.';

export const ANSWER_TOOL = 'answer_with_fields';

/**
 * The rule for a function's fields, in one paragraph.
 *
 * A model's part in the field system is narrow, and this is all of it: it
 * finds a value, says where it read it, and names the field. It writes no
 * sentence that is kept. The tools refuse what breaks this
 * (`proposeFieldValues`), and the rule is said here so the model does not try.
 */
export const FIELD_RULE =
  'Fields. Every function keeps fixed, typed fields, and you fill them by address, never by describing them. Call get_fields for a function (fn, as legal.title) or one field set before anything else: it lists each field with its address, kind, unit, choices and state, and those addresses are the only ones accepted. Then call propose_field_values. You read a value off a paper on this project and give the page and the paper\'s exact words as its origin; or you look it up in a named public source and give the source\'s name and the date you read it. You map each value to a field key from that list, in the field\'s kind and unit, choosing only from its listed choices. You write no prose into any field: not a note, not a remark, not a summary, and never a value for a field that is worked out, mirrored or a person\'s words. A value with no source is refused, and so is a guess. What you offer waits on its field as proposed until a person accepts it: it is offered, never recorded. A field marked owedBy is another party\'s to give and one marked notDueBefore is not expected yet: do not ask the person for either.';

/** Why a first model hands a question on. A fixed list: the reason is shown beside the answer, and no model words it. */
export const HAND_OVER_REASONS = ['needs_judgement', 'compares_papers', 'legal_standing', 'estimates_money', 'asks_for_a_draft', 'not_sure'] as const;
export type HandOverReason = (typeof HAND_OVER_REASONS)[number];
export const HAND_OVER_LABEL: Record<HandOverReason, string> = {
  needs_judgement: 'it needed judgement',
  compares_papers: 'it compares papers',
  legal_standing: 'it is about title or legal standing',
  estimates_money: 'it estimates money',
  asks_for_a_draft: 'it asked for a draft',
  not_sure: 'the first model was not sure',
};

const SYSTEM = `You are Realytica's project copilot. You sit in the project cockpit: chat on the left, live registers, field sheets and papers on the right.

You never write an answer. You look things up with tools, and you answer by PICKING: the fields, records, memory lines and passages that answer the question. The reply the person reads is printed by the system from what you pick, with each value, where it stands and its source, as the record holds them. Any sentence you write is thrown away unread. So do not explain, summarise, advise or greet: pick.

How a turn goes:
1. Read before you pick. get_project and get_sitting for where the file stands; get_fields for a function's field sheets (each field comes with its address); get_check_fields for a check's fields; search_registers for findings, risks, actions, decisions and papers by id; search_papers for what a paper says that no field holds (each passage comes with a mark, p1, p2 and on). A question may come with memory lines, each under a mark (m1, m2 and on).
2. End every turn with exactly one call to ${ANSWER_TOOL}:
   - fields: the addresses (set, field, and record where the set repeats) of the fields that answer the question, copied from get_fields or get_check_fields.
   - records: the ids of the findings, risks, actions, decisions, milestones, checks or papers that answer it.
   - facts: the marks of the memory lines that answer it.
   - passages: the marks of the passages that answer it.
   - outcome: answered when what you picked answers the question; partly when it answers part; not_on_record when nothing on the record or in the papers does.
   - look_at: when the answer is not on the record, the fields that would hold it (their addresses, though empty) and the ids of the papers that would state it. This is how you say what would unblock the question. Never guess the missing value.
   - mark: optional. Leave a mark for the project's memory only when this turn showed something worth keeping that no memory line says: what it is about (a field's address, or a record's id) and one kind: open_question, contradiction or follow_up. null otherwise.
3. Pick only what you read in this turn or were given. An address, id or mark that is not on the record is dropped. Pick the few that answer, not everything you read.

Hard rules:
- Never state, estimate or work out a value. If the fields do not hold it, the outcome is not_on_record and look_at says where it would be.
- The question comes with the page the person is on. "What is missing" and "which findings are critical" are about that page unless they name the project or the file. Read that page's fields first.
- Model conclusions are propose-and-review. To suggest a value for a field, call propose_field_values with its source: a paper's page and exact words, or a public source and the date read. To suggest a finding, risk, action, decision or check result, call propose_update. What you propose waits on the page for a person. Nothing you propose is on the project.
- Person commands are not yours to invent. Do not close an action, change an owner or start a DD because it would be tidy.
- Never guess which record they meant. If their words could be more than one check, scope, DD, finding, risk or action, or match none exactly, call ask_to_choose with their phrase.
- When you name a DD, scope, check, department, function or stage, call navigate_pane so the page opens beside the answer. Looking at a stage never moves the project to it.
- For a question about the law itself (IBBI, NBC, PTCL, the Registration Act), call lookup_reference. For gated portals (Kaveri, Bhoomi, e-Khata), call get_portal_route. You fetch nothing from them.
- ${FIELD_RULE}
- ${ANSWER_LANGUAGE_RULE}`;

const address = {
  type: 'object',
  additionalProperties: false,
  required: ['set', 'field'],
  properties: { set: { type: 'string' }, field: { type: 'string' }, record: { type: 'string' } },
} as const;

/** The one way a model answers: keys, and nowhere to put a sentence. */
export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'fields', 'records', 'facts', 'passages'],
  properties: {
    outcome: { type: 'string', enum: [...CHAT_OUTCOMES] },
    fields: { type: 'array', items: address, description: 'Addresses of the fields that answer, from get_fields or get_check_fields.' },
    records: { type: 'array', items: { type: 'string' }, description: 'Ids of records that answer: a finding, risk, action, decision, milestone, check or paper.' },
    facts: { type: 'array', items: { type: 'string' }, description: 'Marks of memory lines that answer: m1, m2.' },
    passages: { type: 'array', items: { type: 'string' }, description: 'Marks of passages search_papers returned: p1, p2.' },
    look_at: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fields: { type: 'array', items: address, description: 'Fields that would hold the answer and are empty.' },
        papers: { type: 'array', items: { type: 'string' }, description: 'Ids of papers that would state it.' },
      },
    },
    mark: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { type: 'string', enum: [...MEM_MARK_KINDS] }, field: address, record: { type: 'string' } },
    },
  },
} as const;

/** The instruction the copilot runs under, for a test to read. */
export const PROJECT_COPILOT_INSTRUCTION = SYSTEM;

export interface RunProjectCopilotParams {
  project: DdProject;
  question: string;
  actor?: string;
  viewContext?: string;
  /** The page the person asked from, and the stage it is looked at in. Said to the model in words, and given to the tools that open a page. */
  place?: ChatPlace;
  history?: CopilotTurn[];
  memory?: string;
  /** The memory lines the question came with, by their marks: what an answer's picked marks are looked up in. */
  remembered?: Pick<MemContext, 'lines'>;
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
  /** The reply as text: code's rendering of `card` and a template's line. Never a model's words. */
  text: string;
  /** The answer as a card of fields. Absent only where no model was reached. */
  card?: ChatAnswerCard;
  proposals: ChatProposal[];
  /** Options offered instead of guessing which record was meant. */
  choices: ChatChoice[];
  navigations: Array<{ target: string } & CockpitPathExtra>;
  toolCalls: { name: string; summary: string }[];
  citedEvidenceIds: string[];
  citedNodeIds: string[];
  /**
   * What the answer marked for the project's memory, as memory keeps it: one
   * line made by code from the mark's kind and the name of what it is about,
   * and the id it is filed under. The model gave a kind and an address or an
   * id, never the line.
   */
  note?: { note: string; about?: string };
  /** What the call cost, when one was made. Absent on every failure path. */
  spend?: TurnSpend;
  /** Why the model handed the question over, when it did — the answer is then not its own. */
  handedOver?: string;
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
  const answered: { picks?: ChatAnswerPicks } = {};
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
              'Hand this question to the senior analyst instead of answering it. Call it FIRST, before any other tool, when the question needs judgement rather than a lookup: why or should questions, comparing or reconciling documents, anything about title or legal standing, estimating money, a draft, or anything you are not sure you can answer exactly from the registers. Do not call it for a lookup the tools answer: who owns it, what a document says, what is open.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['reason'],
              properties: { reason: { type: 'string', enum: [...HAND_OVER_REASONS] } },
            } as const,
            run: async ({ reason }) => {
              handOver.reason = HAND_OVER_LABEL[HAND_OVER_REASONS.find((known) => known === reason) ?? 'needs_judgement'];
              return 'Handed over. Stop now.';
            },
          }),
        ]
      : []),
    betaTool({
      name: ANSWER_TOOL,
      description: 'Answer the question by picking what answers it: field addresses, record ids, the marks of memory lines and of passages. The reply is printed from the record. Call it once, last.',
      inputSchema: ANSWER_SCHEMA,
      run: async (input) => {
        answered.picks = chatPicksFrom(input);
        return 'Recorded. Stop now.';
      },
    }),
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
        // Only the tool calls are read. A message's words are not kept in any variable here: they are not the answer.
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            emit({ kind: 'tool_call', label: `Looking up ${block.name.replace(/_/g, ' ')}`, toolName: block.name });
          }
        }
      },
    });
    // The answer is what was picked, looked up on the record. A model that picked nothing answered nothing, whatever it wrote.
    const picks = answered.picks ?? chatPicksFrom(undefined);
    const card = chatAnswerCard(project, picks, { remembered: params.remembered, passages: bag.passages });
    card.said = chatAnswerSaid(card, { question, proposals: bag.proposals.length, choices: bag.choices.length, navigations: bag.navigations.length });
    const text = chatAnswerText(card);
    const note = memMarkSaid(project, picks.mark);
    // What the answer cites: the records and papers its rows are, and those named in the text code printed.
    const cites = citeIds([text, ...card.rows.flatMap((row) => [row.recordId ?? '', row.source?.evidenceId ?? ''])].join(' '), project);
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
      card,
      proposals: bag.proposals,
      choices: bag.choices,
      navigations: bag.navigations,
      toolCalls: bag.toolCalls.length ? bag.toolCalls : [{ name: 'project_copilot', summary: 'Thought with project tools' }],
      citedEvidenceIds: cites.citedEvidenceIds,
      citedNodeIds: cites.citedNodeIds,
      ...(note ? { note } : {}),
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
      // Nothing picked that is on the record, nothing to look at, nothing proposed or offered: the first model had no answer.
      const nothing = !first.card?.rows.length && !first.card?.look.length && !first.proposals.length && !first.choices.length;
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
