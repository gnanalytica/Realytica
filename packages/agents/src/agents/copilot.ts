/**
 * Analyst copilot — grounded Q&A over one case.
 *
 * A tool-using agent that answers a free-text question about a single case by
 * actually looking things up (via `createCaseTools`) rather than answering
 * from the summary alone. Two rules make this trustworthy rather than merely
 * plausible:
 *
 * 1. It must cite. Every substantive claim carries an inline `[ev:<id>]`
 *    marker naming the evidence it rests on; every id is validated against
 *    the case's real evidence ledger before the turn is returned, and any id
 *    that does not resolve is dropped from both the visible text and
 *    `citedEvidenceIds` — never shipped as a dangling citation.
 * 2. It must be able to refuse. "The documents on file do not answer this" is
 *    treated in the system prompt as a correct, valuable answer — not a
 *    fallback for when the model is stuck — and is reported back via
 *    `refusedForLackOfEvidence` so the UI can render it distinctly from a
 *    normal answer.
 *
 * `history` (prior turns) is replayed into the message list so the
 * conversation stays coherent, but the case context itself is re-rendered
 * fresh on every call — a copilot answering from a screen that has since
 * changed would be worse than useless.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  CapabilityGap,
  CopilotTurn,
  MemoryRecall,
  PropertyCase,
  ReferenceData,
  RetrievalSelection,
} from '@valytica/shared';
import { buildTitleGraph } from '@valytica/shared';
import { agentCapability, describeError } from '../client';
import { GROUNDING_RULES } from '../context';
import { retrieveCaseContext } from '../retrieval';
import { renderMemoryForPrompt } from '../memory';
import { createCaseTools } from '../tools/case-tools';
import { describeGap } from '../routing';
import { capabilityBlocksRoute, clientToolFromRunnable, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmClientTool, LlmMessage } from '../providers';

export interface RunCopilotParams {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  question: string;
  /** Prior turns of this conversation, oldest first. Does not include `question` itself. */
  history?: CopilotTurn[];
  /** ISO timestamp used to date the produced turn/evidence — not wall-clock, so runs are reproducible. */
  now?: string;
  /**
   * What earlier cases know that bears on this one.
   *
   * Passed in rather than looked up, because persistence belongs to the app,
   * not to this package — the agents package must stay runnable with no store
   * at all. Absent means "no memory configured", which is different from "no
   * history found"; the latter arrives as a recall with zero facts and
   * populated `consultedSubjects`, and is worth telling the model about.
   */
  memory?: MemoryRecall;
  onStep?: (step: AgentStep) => void;
}

export interface RunCopilotResult {
  run: AgentRun;
  turn: CopilotTurn;
}

const MAX_TOOL_ITERATIONS = 8;

const COPILOT_SYSTEM_PROMPT = `
${GROUNDING_RULES}

You are the analyst copilot: a grounded question-answering agent for ONE specific property case. Tools let you look up the case's evidence ledger, comparables, compliance checks, risks, value anchors, document fields and locality reference row. Use them to find the real answer — call list_evidence early so you know which evidence ids actually exist; never answer from the case summary alone when a tool can confirm it.

Citation format — follow this exactly:
- Immediately after any sentence or clause that rests on a specific piece of evidence, cite it inline as [ev:<evidenceId>], using only ids you obtained from a tool call. Never invent an id, and never cite an id you have not actually seen returned by list_evidence or get_evidence_by_id.
- A claim with no evidence behind it must not be presented as settled fact — either look it up first, label it explicitly as inference, or refuse.

Refusing is a correct, good outcome — not a failure:
- When the case's evidence does not answer the question, say so plainly (e.g. "The documents on file do not answer this — none of the extracted fields or evidence cover it.") instead of guessing or extrapolating past what the evidence supports. That is exactly what "Uncertainty Must Be Visible" asks for, and it is far more useful to the user than a confident-sounding guess.

Always end your entire response with exactly one final line, alone on that line with nothing after it:
REFUSED_FOR_LACK_OF_EVIDENCE: true
or
REFUSED_FOR_LACK_OF_EVIDENCE: false
Set it to true only when you are declining to give a substantive answer because the case's evidence does not support one.
`.trim();

const REFUSAL_LINE_RE = /\n?REFUSED_FOR_LACK_OF_EVIDENCE:\s*(true|false)\s*$/i;
const CITATION_RE = /\[ev:([^\]\s]+)\]/g;

/** Strips the trailing refusal marker, validates inline citations against the real ledger, and reports what happened. */
function processAnswer(rawText: string, validIds: ReadonlySet<string>): {
  text: string;
  citedEvidenceIds: string[];
  refusedForLackOfEvidence: boolean;
} {
  let text = rawText;
  let refused = false;
  const refusalMatch = text.match(REFUSAL_LINE_RE);
  if (refusalMatch) {
    refused = refusalMatch[1].toLowerCase() === 'true';
    text = text.slice(0, refusalMatch.index).trimEnd();
  }

  const cited: string[] = [];
  let droppedCount = 0;
  const cleaned = text.replace(CITATION_RE, (match, id: string) => {
    if (validIds.has(id)) {
      if (!cited.includes(id)) cited.push(id);
      return match;
    }
    droppedCount += 1;
    return '';
  });

  const note =
    droppedCount > 0
      ? `\n\n(Note: ${droppedCount} citation${droppedCount === 1 ? '' : 's'} referenced an evidence id not found on this case's ledger and ${droppedCount === 1 ? 'was' : 'were'} removed.)`
      : '';

  return { text: (cleaned + note).trim(), citedEvidenceIds: cited, refusedForLackOfEvidence: refused };
}

export async function runCopilot(params: RunCopilotParams): Promise<RunCopilotResult> {
  const { caseId, caseData, refData, question, memory, history = [] } = params;
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
  const { route, provider, descriptor } = resolveRoute('analyst_copilot');
  const tier = route.tier;
  const model = route.model;

  /** What this run asked the provider for and did not get. */
  let capabilityGaps: CapabilityGap[] = [];

  /** Set once retrieval runs; recorded on the run so the context is auditable. */
  let retrievalSelection: RetrievalSelection | undefined;

  const finish = (
    status: AgentRunStatus,
    error: string | undefined,
    turnText: string,
    opts: { refusedForLackOfEvidence?: boolean; citedEvidenceIds?: string[]; usage?: AgentRun['usage'] } = {},
  ): RunCopilotResult => {
    const run: AgentRun = {
      id: runId,
      caseId,
      agent: 'analyst_copilot',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      steps,
      retrieval: retrievalSelection,
      summary: status === 'succeeded' ? turnText.slice(0, 240) : undefined,
      error,
      usage: opts.usage,
      producedEvidenceIds: [],
    };
    const turn: CopilotTurn = {
      id: randomUUID(),
      role: 'assistant',
      text: turnText,
      at: now,
      citedEvidenceIds: opts.citedEvidenceIds ?? [],
      refusedForLackOfEvidence: opts.refusedForLackOfEvidence ?? false,
    };
    return { run, turn };
  };

  emit({ kind: 'plan', label: `Answering: "${question.length > 80 ? `${question.slice(0, 80)}…` : question}"` });

  // The credential half of `agentCapability()` only speaks for an Anthropic
  // route; the kill switch speaks for all of them. See `capabilityBlocksRoute`.
  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability)) {
    const reason = `The analyst copilot is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason, reason);
  }

  if (!descriptor.configured) {
    const reason = missingCredentialsReason(route, 'the analyst copilot is unavailable.');
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason, reason);
  }

  const validEvidenceIds = new Set((caseData.result?.evidence ?? []).map(e => e.id));

  /**
   * The case tools, described to the port twice over.
   *
   * Each one keeps its SDK-native definition (`native`) so Anthropic's own
   * tool runner gets the `run`/`parse` pair it needs and executes the loop
   * server-side exactly as before. `execute` is the same tool expressed
   * portably, for a provider with `toolLoop: false` where this app has to run
   * the loop itself. Neither is a re-implementation of the other: they are the
   * same closure reached two ways.
   */
  const tools: LlmClientTool[] = createCaseTools(caseData, refData).map(clientToolFromRunnable);

  const messages: LlmMessage[] = [];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text });
  }
  /*
   * Retrieved against the question, not dumped.
   *
   * The copilot is the best-placed agent for this: it is the only one handed
   * an explicit statement of what the user wants to know, so the question
   * itself is the focus. A question about the khata pulls the khata extract,
   * the register evidence and the parcel's graph neighbourhood; it does not
   * need every comparable transaction in the locality.
   *
   * The selection travels onto the run, so a thin answer can be traced to a
   * thin context instead of being read as a confident one.
   */
  // Rebuilt rather than read off the result: `ScreenResult` carries the graph's
  // findings (`TitleGraphSummary`), not its nodes and edges, and adjacency is
  // what makes retrieval structural rather than a string match. Rebuilding is
  // deterministic and measured at 0.08 ms per case, which against a model call
  // is free.
  const graph = buildTitleGraph(caseData, now);
  const retrieved = retrieveCaseContext({
    caseData,
    refData,
    agent: 'analyst_copilot',
    graph,
    focus: [question, ...history.slice(-2).map(t => t.text)],
  });
  retrievalSelection = retrieved.selection;
  emit({
    kind: 'message',
    label: `Context retrieved — ${retrieved.selection.included.length} section(s), ${retrieved.selection.approxTokens} tokens`,
    detail: retrieved.selection.omitted.length > 0
      ? `${retrieved.selection.omitted.length} section(s) left out for budget; the model is told which kinds.`
      : 'Whole case fitted within budget.',
  });
  // Never externalSafe here — the copilot is internal by construction, it
  // answers the user about their own case and makes no outbound call. The flag
  // is passed explicitly rather than defaulted so the boundary is visible at
  // the call site rather than assumed from context.
  const memoryBlock = memory ? renderMemoryForPrompt(memory, { externalSafe: false }) : '';
  if (memoryBlock) {
    emit({
      kind: 'message',
      label: `Cross-case memory: ${memory?.facts.length ?? 0} item(s) from ${memory?.consultedSubjects.length ?? 0} subject(s) consulted`,
      detail: 'Context only — memory is never citable as evidence for this case.',
    });
  }

  messages.push({
    role: 'user',
    content: [
      'Case context (fetched fresh for this turn — treat it as more current than anything said earlier in this conversation):',
      retrieved.text,
      ...(memoryBlock ? ['', memoryBlock] : []),
      '',
      `Question: ${question}`,
    ].join('\n'),
  });

  emit({ kind: 'tool_call', label: 'Consulting the case ledger', detail: `${tools.length} read-only tool(s) available` });

  let result;
  try {
    result = await provider.runTools({
      agent: 'analyst_copilot',
      model,
      maxTokens: 8000,
      system: [{ text: COPILOT_SYSTEM_PROMPT, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      // Emitted per turn as the loop runs, not reconstructed at the end, so
      // the step log stays a live account of what the copilot looked up. The
      // normalised blocks are enough here — a case tool is a client tool on
      // every provider, so nothing provider-specific is needed.
      onMessage: message => {
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            emit({ kind: 'tool_call', label: `Looking up ${block.name.replace(/_/g, ' ')}`, toolName: block.name });
          }
        }
      },
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    return finish('failed', reason, `The analyst copilot hit an error and could not answer: ${reason}`);
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) {
    emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
  }

  const usage = result.usage;

  if (result.stopReason === 'refusal') {
    const reason = 'Claude declined to answer this question (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, 'The analyst copilot declined to answer this question.', { usage });
  }

  const rawText = textOf(result);
  if (result.content.every(b => b.type !== 'text')) {
    const reason = `The model did not return a text answer (stop_reason=${result.stopReason ?? 'unknown'}).`;
    emit({ kind: 'error', label: 'No answer returned', detail: reason });
    return finish('failed', reason, 'The analyst copilot did not produce an answer.', { usage });
  }

  const { text, citedEvidenceIds, refusedForLackOfEvidence } = processAnswer(rawText, validEvidenceIds);

  emit({
    kind: 'message',
    label: refusedForLackOfEvidence ? 'Declined for lack of evidence' : `Answered with ${citedEvidenceIds.length} citation(s)`,
  });

  const run: AgentRun = {
    id: runId,
    caseId,
    agent: 'analyst_copilot',
    status: 'succeeded',
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    tier,
    provider: route.provider,
    capabilityGaps,
    steps,
    retrieval: retrievalSelection,
    summary: text.slice(0, 240),
    usage,
    producedEvidenceIds: [],
  };
  const turn: CopilotTurn = {
    id: randomUUID(),
    role: 'assistant',
    text,
    at: now,
    citedEvidenceIds,
    refusedForLackOfEvidence,
    toolCalls: steps
      .filter(s => s.kind === 'tool_call' && s.toolName)
      .map(s => ({ name: s.toolName as string, summary: s.label })),
  };
  return { run, turn };
}
