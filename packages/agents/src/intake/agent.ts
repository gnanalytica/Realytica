import { randomUUID } from 'node:crypto';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  CaseDocument,
  IntakeField,
  IntakeReadout,
  IntakeTurn,
  PromptUsage,
  ReferenceData,
  CapabilityGap,
} from '@valytica/shared';
import { agentCapability, describeError } from '../client';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { capabilityBlocksRoute, missingCredentialsReason, providerFor, resolveRoute } from '../providers';
import { clientToolFromRunnable } from '../providers/anthropic';
import type { LlmClientTool, LlmMessage } from '../providers/types';
import { applyCapture } from './fields';
import { readDraft } from './readout';
import { createIntakeTools, type CaseLookup, type IntakeToolBuffer } from './tools';
import { answerCurrentGap, describeState, fallbackReply } from './script';

const MAX_TOOL_ITERATIONS = 4;

export interface RunIntakeTurnParams {
  sessionId: string;
  message: string;
  fields: IntakeField[];
  documents: CaseDocument[];
  history: IntakeTurn[];
  refData: ReferenceData;
  caseId?: string;
  /**
   * Lets this conversation see the cases that already exist.
   *
   * Supplied by the home chat and omitted elsewhere, which is what makes the
   * same agent serve both: with it, one conversation both starts a case and
   * finds an old one; without it, it is intake only and the tool is not even
   * offered.
   */
  lookupCases?: CaseLookup;
  now?: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunIntakeTurnResult {
  /** The assistant's reply, ready to append to the session. */
  turn: IntakeTurn;
  /** The field list after this turn's captures were folded in. */
  fields: IntakeField[];
  /** The readout against those fields, so the caller never recomputes it differently. */
  readout: IntakeReadout;
  /** Absent when the turn came from the deterministic fallback — no model ran. */
  run?: AgentRun;
  /** Captures the schema refused, surfaced so a persistently wrong parser is visible. */
  rejected: { path: string; reason: string }[];
}

/**
 * One turn of the intake conversation.
 *
 * The division of labour is the whole design. Everything that decides what
 * happens to the case — which particular is wanted next, which documents bear
 * on this property, whether the draft can be screened — is computed by
 * `readDraft` before the model is called and handed to it as state. The model
 * reads the user's prose into typed captures and writes the reply.
 *
 * That is what makes the no-credentials path a real feature rather than an
 * error page: with no key configured, `fallbackReply` asks the same next
 * question in fixed words, and the conversation still builds a case. The
 * difference is that it cannot parse free text, so it leans on the UI's
 * option buttons and direct answers. Worse, and working.
 */
/**
 * Can this deployment actually read free text for the intake?
 *
 * Exactly the two checks `runIntakeTurn` makes before calling a provider, so
 * the opener and the first turn cannot disagree. Asking
 * `agentCapability().available` instead — which was the first version — reads
 * the *Anthropic* credential probe, so a deployment routing the intake at an
 * OpenAI-compatible endpoint opened by announcing it had no model and then
 * parsed the user's next sentence perfectly.
 */
export function intakeModelAvailable(): boolean {
  const { route, descriptor } = resolveRoute('intake_concierge');
  return !capabilityBlocksRoute(route, agentCapability()) && descriptor.configured;
}

export async function runIntakeTurn(params: RunIntakeTurnParams): Promise<RunIntakeTurnResult> {
  const now = params.now ?? new Date().toISOString();
  const { refData, message } = params;
  const steps: AgentStep[] = [];
  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    params.onStep?.(full);
  };

  const priorReadout = readDraft(
    { fields: params.fields, documents: params.documents, caseId: params.caseId },
    refData,
    now,
  );

  /**
   * Deterministic turn — no model involved, and the result says so by carrying
   * no run.
   *
   * Before falling back to the script, the message is read as a direct answer
   * to the question the conversation just asked. Without that step the input
   * box silently discarded everything typed into it whenever no model was
   * configured, which made the guided mode unusable for every free-text
   * particular — locality, area, price — while looking like it worked.
   */
  const degrade = (make: (r: IntakeReadout) => string): RunIntakeTurnResult => {
    const answer = answerCurrentGap(message, priorReadout.nextQuestion, refData);
    const { fields, captured } = answer
      ? applyCapture(params.fields, [answer], now)
      : { fields: params.fields, captured: [] as IntakeField[] };
    const readout = readDraft({ fields, documents: params.documents, caseId: params.caseId }, refData, now);
    return {
      turn: {
        id: randomUUID(),
        role: 'assistant',
        text: make(readout),
        at: now,
        captured: captured.length > 0 ? captured : undefined,
      },
      fields,
      readout,
      rejected: [],
    };
  };

  const route = resolveRoute('intake_concierge');
  const capability = agentCapability();
  if (capabilityBlocksRoute(route.route, capability)) {
    return degrade(r => fallbackReply(r, message, 'no_agent_layer'));
  }
  if (!route.descriptor.configured) {
    void missingCredentialsReason(route.route, 'the intake concierge is unavailable.');
    return degrade(r => fallbackReply(r, message, 'no_credentials'));
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let capabilityGaps: CapabilityGap[] = [];
  let promptUsages: PromptUsage[] = [];

  const buffer: IntakeToolBuffer = { captures: [], localityLookups: [], matchedCaseIds: [] };
  const tools: LlmClientTool[] = createIntakeTools(refData, buffer, params.lookupCases).map(clientToolFromRunnable);

  const messages: LlmMessage[] = [];
  // The last few turns only. An intake conversation is short and the state
  // block below is authoritative about the draft, so replaying the whole
  // history would re-bill tokens to restate what STATE already says.
  for (const turn of params.history.slice(-8)) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({
    role: 'user',
    content: [describeState(priorReadout, params.fields), '', `They said: ${message}`].join('\n'),
  });

  emit({ kind: 'plan', label: `Reading: "${message.length > 70 ? `${message.slice(0, 70)}…` : message}"` });

  const systemPrompt = await resolvePrompt(PROMPT_KEYS.intakeConciergeSystem);
  promptUsages = systemPrompt.usages;

  const provider = providerFor(route.route.provider);
  let result;
  try {
    result = await provider.runTools({
      agent: 'intake_concierge',
      model: route.route.model,
      maxTokens: 1500,
      // The prompt is byte-identical on every turn of every conversation, so
      // the breakpoint here is worth more than anywhere else in the app.
      system: [{ text: systemPrompt.content, cacheBreakpoint: true }],
      tools,
      messages,
      maxIterations: MAX_TOOL_ITERATIONS,
      onMessage: msg => {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            emit({ kind: 'tool_call', label: block.name === 'resolve_locality' ? 'Checking the locality' : 'Recording particulars', toolName: block.name });
          }
        }
      },
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    // A failed turn still moves the conversation: the deterministic script
    // asks the same next question. The user is told the parser is down rather
    // than being left at a dead end.
    return degrade(
      r => `${fallbackReply(r, message, 'model_failed')}\n\n(I could not read that message automatically — ${reason})`,
    );
  }

  capabilityGaps = result.capabilityGaps;

  // Folded in here, after the model is done, so the schema wall and the
  // provenance precedence rules apply to every capture regardless of how many
  // tool calls produced them.
  const { fields, captured, rejected } = applyCapture(params.fields, buffer.captures, now);
  if (rejected.length > 0) {
    emit({
      kind: 'error',
      label: `${rejected.length} capture(s) refused by the field schema`,
      detail: rejected.map(r => `${r.path}: ${r.reason}`).join('; '),
    });
  }
  if (captured.length > 0) {
    emit({ kind: 'message', label: `Captured ${captured.map(c => c.label).join(', ')}` });
  }

  const text = result.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const readout = readDraft({ fields, documents: params.documents, caseId: params.caseId }, refData, now);

  // Not 'degraded' — that is not an `AgentRunStatus`, and inventing one here
  // would have been a cast that compiled. Degradation lives on
  // `capabilityGaps`, which is where every consumer already reads it from:
  // the run graph derives its degraded badge from the gaps, not the status.
  const status: AgentRunStatus = 'succeeded';
  const run: AgentRun = {
    id: runId,
    caseId: params.caseId ?? params.sessionId,
    agent: 'intake_concierge',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    model: route.route.model,
    tier: route.route.tier,
    provider: route.route.provider,
    capabilityGaps,
    prompts: promptUsages,
    steps,
    summary: text.slice(0, 240),
    usage: result.usage,
    producedEvidenceIds: [],
  };

  return {
    turn: {
      id: randomUUID(),
      role: 'assistant',
      // An empty reply is possible when the model spends its turn on tool
      // calls. The script covers it rather than showing a blank bubble.
      text: text || fallbackReply(readout, message, 'empty_reply'),
      at: now,
      captured: captured.length > 0 ? captured : undefined,
      requested: readout.documents.filter(d => d.critical && !d.received).slice(0, 2).map(d => d.kind),
      matchedCaseIds: buffer.matchedCaseIds.length > 0 ? buffer.matchedCaseIds : undefined,
      runId,
    },
    fields,
    readout,
    run,
    rejected,
  };
}
