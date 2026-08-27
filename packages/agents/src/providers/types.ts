/**
 * The provider port: one normalised request and result shape that any LLM
 * vendor can be driven through, without reducing them all to what they share.
 *
 * --- Why this is not a lowest-common-denominator abstraction ---------------
 *
 * The obvious way to write this file is to intersect the vendors: keep system,
 * messages, tools and max tokens, drop everything else, and every provider
 * becomes interchangeable. That would cost Realytica the feature its grounding
 * actually rests on. Anthropic's server-verified document citations
 * (`citations: { enabled: true }` on a `document` block, answered with a
 * `page_location`) are what separate "the khata number is on page 3, and the
 * API located that text on page 3" from a model asserting a page it may have
 * invented. Flatten that away and every extracted field silently becomes a
 * self-report — the exact failure this product exists to avoid.
 *
 * So the port keeps the rich shape and declares what each provider can serve.
 * A request says what it wants; a provider that cannot serve part of it
 * degrades **explicitly** and records a `CapabilityGap` on the result. The gap
 * travels onto `AgentRun.capabilityGaps` and into the telemetry record, where
 * `describeGap` (routing.ts) turns it into the consequence in this product's
 * own terms. Losing a feature is allowed. Losing it silently is not.
 *
 * --- Two methods, because there are only two call shapes ------------------
 *
 * Every model call in this codebase is one of exactly two things:
 *
 *   client.beta.messages.stream(params) -> await stream.finalMessage()
 *   client.beta.messages.toolRunner(params) -> async-iterated to completion
 *
 * `complete` and `runTools` are those two, and nothing else. Keeping the port
 * that narrow is deliberate: a wider surface would be speculative, and a
 * narrower one would force the tool-using agents to hand-roll a loop that
 * Anthropic already runs server-side better than we can.
 */

import type { AgentKind, AgentUsage, CapabilityGap, ProviderDescriptor, ProviderId } from '@realytica/shared';

/* ==================================================================== */
/* Request                                                               */
/* ==================================================================== */

/**
 * One block of system prompt, with an optional prompt-cache breakpoint.
 *
 * Modelled as a list rather than a single string because the explorer sends
 * two blocks with a breakpoint on each: the static role text, then the
 * per-run objective. Collapsing them would move the cache boundary and quietly
 * re-bill the whole prefix on every iteration.
 *
 * `cacheBreakpoint` is a request, not a guarantee. On a provider without
 * `promptCaching` it is dropped and `prompt_caching_unavailable` is recorded —
 * the answer is unchanged, the bill is not.
 */
export interface LlmSystemBlock {
  text: string;
  cacheBreakpoint?: boolean;
}

/** A PDF handed to the model, and whether the caller wants it cited. */
export interface LlmDocument {
  /** Base64 of the raw file bytes, newlines already stripped. */
  base64: string;
  mediaType: 'application/pdf';
  /** Shown to the model as the document's name; also what a citation is attributed to. */
  title?: string;
  /**
   * Ask the provider to verify quotations against this document and return the
   * page each came from.
   *
   * A provider without `documentCitations` must not answer this with a page
   * number of any kind — see `LlmCitation.verified`.
   */
  wantCitations: boolean;
}

export interface LlmImage {
  base64: string;
  /** e.g. `image/jpeg`. Citations are a document-only feature; an image never carries one. */
  mediaType: string;
}

/**
 * One part of a message's content.
 *
 * Documents live here, inside a message, rather than in a top-level
 * `documents` array, because their *position* is load-bearing: document
 * intelligence puts the PDF ahead of its instruction text so the model reads
 * the source before the ask. A flat array would lose that ordering.
 *
 * `cacheBreakpoint` on a text part means the same thing it means on a system
 * block — cache everything up to and including this part — and it exists here
 * because the largest stable payload in this codebase is not the system
 * prompt, it is the case corpus, and the corpus travels in a user message.
 * Like the system-block flag it is a request: a provider without
 * `promptCaching` drops it and records `prompt_caching_unavailable`.
 */
export type LlmContentPart =
  | { type: 'text'; text: string; cacheBreakpoint?: boolean }
  | { type: 'document'; document: LlmDocument }
  | { type: 'image'; image: LlmImage };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentPart[];
}

/**
 * A tool the caller reads the arguments of but never executes: the model's
 * structured output, expressed as a forced tool call.
 *
 * Five of the eight agents use exactly this — the tool is a schema, the call
 * is the answer, and nothing is run. `strict` asks the provider to guarantee
 * the arguments validate; where it cannot, `strict_tools_unavailable` is
 * recorded and the caller's own zod `safeParse` is what stands between a
 * malformed response and the case file.
 */
export interface LlmSchemaTool {
  kind: 'schema';
  name: string;
  description: string;
  /** JSON Schema for the arguments. Object-typed. */
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/**
 * A tool this application executes, in a loop the provider may or may not run.
 *
 * `native` carries the provider's own definition of the same tool so a
 * provider that runs the loop itself (Anthropic's `toolRunner`) passes it
 * through untouched rather than having it rebuilt — the runner needs the
 * SDK's `run`/`parse` pair, not a re-derived copy. `execute` is the portable
 * form the in-app loop uses when `toolLoop` is false.
 */
export interface LlmClientTool {
  kind: 'client';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: unknown) => Promise<string>;
  native?: unknown;
}

/**
 * A tool the *provider* runs and returns results for inline — web search, web
 * fetch, provider-hosted memory.
 *
 * There is no portable form of this: an endpoint either hosts the tool or it
 * does not. So the tool carries the gap it costs when it is unavailable, and a
 * provider that cannot serve it drops it and records that gap rather than
 * pretending the call was equivalent.
 */
export interface LlmServerTool {
  kind: 'server';
  name: string;
  /** What is lost when this provider cannot host the tool. */
  gap: CapabilityGap;
  /** The provider-native tool definition, passed through verbatim. */
  native: unknown;
}

export type LlmTool = LlmSchemaTool | LlmClientTool | LlmServerTool;

export type LlmToolChoice = { type: 'auto' } | { type: 'tool'; name: string };

/**
 * A normalised call.
 *
 * Deliberately rich. Two things every request in this codebase asks for are
 * not fields here because they are unconditional — adaptive thinking and the
 * server-side refusal fallback come from `baseRequestFor(agent)` and every
 * agent takes them. A provider that cannot serve either records
 * `adaptive_thinking_unavailable` / `refusal_fallback_unavailable` on the
 * result; there is no way to ask for less, because nothing here wants less.
 */
export interface LlmRequest {
  /** Whose call this is. Selects the base request and names the run in telemetry. */
  agent: AgentKind;
  /**
   * The case this call is made on behalf of, where there is one.
   *
   * Carried purely so telemetry can attribute spend to a case. Absent for work
   * that is not case-scoped — an evaluation run, a capability probe, and the
   * intake conversation, which happens before a case exists. Without it the
   * telemetry view's per-case filter matches nothing, which is how it behaved
   * until this field existed.
   */
  caseId?: string;
  /** The model id, exactly as the endpoint expects it (an OpenRouter id keeps its `vendor/model` slash). */
  model: string;
  maxTokens: number;
  system: LlmSystemBlock[];
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  /** Reasoning effort, where the provider exposes one. Dropped, with a gap, where it does not. */
  effort?: 'low' | 'medium' | 'high';
}

/**
 * A call that may go round the tool loop.
 *
 * `maxIterations` bounds the loop whoever runs it — Anthropic's `toolRunner`
 * takes it directly; the in-app loop applies the same ceiling. An unbounded
 * tool loop is an unbounded bill, so it is required rather than optional in
 * spirit even though the type allows omission (the in-app loop falls back to
 * `DEFAULT_MAX_TOOL_ITERATIONS`).
 */
export interface LlmToolRequest extends LlmRequest {
  maxIterations?: number;
  /**
   * Called once per assistant turn inside the loop, before the loop continues.
   *
   * This is how the agents emit a step per tool call as it happens rather than
   * only at the end. `native` carries the provider's own message so an agent
   * that needs a provider-specific detail the port does not model — the
   * explorer reads `web_fetch_tool_result` bodies for reachability telemetry —
   * can still reach it, instead of the port pretending that detail does not
   * exist.
   */
  onMessage?: (message: LlmIntermediateMessage) => void;
}

export interface LlmIntermediateMessage {
  content: LlmContentBlock[];
  stopReason: LlmStopReason | null;
  native?: unknown;
}

/* ==================================================================== */
/* Result                                                                */
/* ==================================================================== */

/**
 * A quotation the model attributed to a supplied document.
 *
 * `verified` is the whole point of this type, and it is never a formality:
 *
 *   - `true` means the *provider* located this text in the document it was
 *     given. `page`, where present, is a fact about the file.
 *   - `false` means the model said so. `page` MUST then be absent — there is
 *     no such thing as an unverified page number in this codebase, because a
 *     plausible wrong page is worse than no page: it invites a reader to check
 *     the wrong place, find nothing, and distrust the field rather than the
 *     citation.
 *
 * A provider without `documentCitations` may only ever emit `verified: false`
 * citations, or none at all, and must record `citations_unavailable`.
 */
export interface LlmCitation {
  quote: string;
  page?: number;
  verified: boolean;
}

export type LlmContentBlock =
  | { type: 'text'; text: string; citations?: LlmCitation[] }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      /**
       * Set when the provider returned tool arguments that were not valid JSON
       * and `input` is therefore an empty object rather than the model's
       * intent. Only reachable on a provider without `strictTools`.
       */
      parseError?: string;
    }
  | { type: 'thinking'; text: string };

/**
 * Kept as Anthropic's vocabulary rather than a new invented one.
 *
 * Every agent already branches on `'refusal'`, `'pause_turn'` and
 * `'model_context_window_exceeded'`, and those names appear verbatim in
 * messages users read. Renaming them would have changed eight files' worth of
 * user-visible strings for no gain; the OpenAI-compatible provider maps its
 * `finish_reason` into this set instead.
 */
export type LlmStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded';

export interface LlmResult {
  provider: ProviderId;
  model: string;
  content: LlmContentBlock[];
  /** Null when the provider reported none, matching the API's own nullability. */
  stopReason: LlmStopReason | null;
  usage: AgentUsage;
  /** Everything this call asked for and did not get. Empty on a full-capability route. */
  capabilityGaps: CapabilityGap[];
  /** Wall clock, including retries and every tool-loop iteration. What a user waited. */
  durationMs: number;
  /** Time to the first streamed token. Absent when the call did not stream. */
  timeToFirstTokenMs?: number;
  /** Transport-level retries across the whole call. A high count is a provider health signal. */
  retries: number;
  /** The provider's own final message, for detail the port does not model. */
  native?: unknown;
}

/* ==================================================================== */
/* The port                                                              */
/* ==================================================================== */

export interface LlmProvider {
  readonly id: ProviderId;
  /**
   * What this provider can do *right now*, read live rather than snapshotted:
   * credentials and base URL come from the environment, and a process that
   * configures them late must not be told it has no provider.
   */
  descriptor(): ProviderDescriptor;
  /** One turn: maps to `messages.stream(...)` + `finalMessage()`. */
  complete(req: LlmRequest): Promise<LlmResult>;
  /** A tool conversation run to completion: maps to `messages.toolRunner(...)`. */
  runTools(req: LlmToolRequest): Promise<LlmResult>;
}

/* ==================================================================== */
/* Errors                                                                */
/* ==================================================================== */

/**
 * A transport-level failure, carrying enough to diagnose it without a log dive.
 *
 * `describeError` (client.ts) narrows Anthropic's own error classes; anything
 * else falls through to `.message`, so the message is written to be the whole
 * story — including the response body, which is where an OpenAI-compatible
 * gateway puts the actual reason a request was rejected.
 */
export class ProviderCallError extends Error {
  readonly status?: number;
  readonly retries: number;

  constructor(message: string, opts: { status?: number; retries?: number } = {}) {
    super(message);
    this.name = 'ProviderCallError';
    this.status = opts.status;
    this.retries = opts.retries ?? 0;
  }
}

/* ==================================================================== */
/* Small shared helpers                                                  */
/* ==================================================================== */

/** Deduplicates gaps while keeping first-seen order — the order they were hit in. */
export function mergeGaps(...lists: (CapabilityGap[] | undefined)[]): CapabilityGap[] {
  const seen = new Set<CapabilityGap>();
  const out: CapabilityGap[] = [];
  for (const list of lists) {
    for (const gap of list ?? []) {
      if (seen.has(gap)) continue;
      seen.add(gap);
      out.push(gap);
    }
  }
  return out;
}

/** The text of a result, joined the way every agent already joins text blocks. */
export function textOf(result: { content: LlmContentBlock[] }): string {
  return result.content
    .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n\n');
}

/** The first `tool_use` block with this name, which is how every structured-output agent reads its answer. */
export function toolUseOf(
  result: { content: LlmContentBlock[] },
  name: string,
): Extract<LlmContentBlock, { type: 'tool_use' }> | undefined {
  return result.content.find(
    (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === name,
  );
}
