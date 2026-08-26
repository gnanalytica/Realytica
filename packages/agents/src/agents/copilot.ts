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

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { AgentRun, AgentRunStatus, AgentStep, CopilotTurn, PropertyCase, ReferenceData } from '@valytica/shared';
import { agentCapability, baseRequestFor, describeError, estimateUsage, getClient, modelFor, tierFor } from '../client';
import { GROUNDING_RULES, renderCaseContext } from '../context';
import { createCaseTools } from '../tools/case-tools';

export interface RunCopilotParams {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  question: string;
  /** Prior turns of this conversation, oldest first. Does not include `question` itself. */
  history?: CopilotTurn[];
  /** ISO timestamp used to date the produced turn/evidence — not wall-clock, so runs are reproducible. */
  now?: string;
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
  const { caseId, caseData, refData, question, history = [] } = params;
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
  const tier = tierFor('analyst_copilot');
  const model = modelFor('analyst_copilot');

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
      steps,
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

  const capability = agentCapability();
  if (!capability.available) {
    const reason = `The analyst copilot is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason, reason);
  }

  const client = getClient();
  if (!client) {
    const reason = 'Anthropic credentials are not configured — the analyst copilot is unavailable.';
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason, reason);
  }

  const validEvidenceIds = new Set((caseData.result?.evidence ?? []).map(e => e.id));

  const tools = createCaseTools(caseData, refData);
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text });
  }
  const contextBlock = renderCaseContext(caseData, refData);
  messages.push({
    role: 'user',
    content: `Case context (fetched fresh for this turn — treat it as more current than anything said earlier in this conversation):\n${contextBlock}\n\nQuestion: ${question}`,
  });

  const requestParams = {
    ...baseRequestFor('analyst_copilot'),
    max_tokens: 8000,
    system: [{ type: 'text' as const, text: COPILOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
    tools,
    messages,
    max_iterations: MAX_TOOL_ITERATIONS,
  };

  emit({ kind: 'tool_call', label: 'Consulting the case ledger', detail: `${tools.length} read-only tool(s) available` });

  // The installed @anthropic-ai/sdk's shipped .d.ts predates Claude Opus 5's
  // adaptive-thinking API (`thinking: { type: "adaptive" }`, from client.ts's
  // baseRequestFor) and the toolRunner's parameter type isn't re-exported under
  // Anthropic.Beta — so this cast, and the `unknown` detour (never `any`),
  // unblocks the compiler against a stale/incomplete type surface without
  // changing anything about the request body actually sent.
  type ToolRunnerParams = Parameters<typeof client.beta.messages.toolRunner>[0];
  type NonStreamingToolRunnerParams = ToolRunnerParams & { stream?: false };

  let final: Anthropic.Beta.BetaMessage;
  try {
    const runner = client.beta.messages.toolRunner(requestParams);
    for await (const message of runner) {
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          emit({ kind: 'tool_call', label: `Looking up ${block.name.replace(/_/g, ' ')}`, toolName: block.name });
        }
      }
    }
    final = await runner.done();
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Anthropic request failed', detail: reason });
    return finish('failed', reason, `The analyst copilot hit an error and could not answer: ${reason}`);
  }

  const usage = estimateUsage(model, final.usage);

  if (final.stop_reason === 'refusal') {
    const reason = 'Claude declined to answer this question (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, 'The analyst copilot declined to answer this question.', { usage });
  }

  const textBlocks = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  if (textBlocks.length === 0) {
    const reason = `The model did not return a text answer (stop_reason=${final.stop_reason ?? 'unknown'}).`;
    emit({ kind: 'error', label: 'No answer returned', detail: reason });
    return finish('failed', reason, 'The analyst copilot did not produce an answer.', { usage });
  }

  const rawText = textBlocks.map(b => b.text).join('\n\n');
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
    steps,
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
