/**
 * The Anthropic provider: a pass-through, not a re-implementation.
 *
 * This file's acceptance bar is that it changes nothing. Every request it
 * builds is byte-for-byte what the agents sent before the port existed —
 * adaptive thinking, the `server-side-fallback-2026-07-01` beta, `fallbacks:
 * 'default'`, `cache_control` breakpoints, `citations: { enabled: true }` on
 * document blocks, server web search and fetch, and the base64 PDF block. It
 * gets there the honest way: by calling `baseRequestFor(agent)` — the same
 * function the pre-migration call sites called — rather than restating its
 * contents and hoping the two stay in step.
 *
 * That is why the request builder is exported. `buildCompleteParams` /
 * `buildToolRunnerParams` are pure functions of the normalised request, so a
 * harness can construct the params both ways — hand-written pre-migration
 * literal versus port output — and deep-compare them. A no-regression claim
 * that cannot be executed is a hope, not a proof.
 *
 * Every capability is true here. Anthropic is the reference implementation:
 * the port exists so that *other* providers have to say what they cannot do,
 * not so this one has to prove what it can.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ProviderDescriptor } from '@realytica/shared';
import { agentCapability, baseRequestFor, estimateUsage, getClient } from '../client';
import { ProviderCallError } from './types';
import type {
  LlmCitation,
  LlmClientTool,
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmStopReason,
  LlmSystemBlock,
  LlmTool,
  LlmToolChoice,
  LlmToolRequest,
} from './types';

/* ==================================================================== */
/* Capability declaration                                                */
/* ==================================================================== */

/**
 * Everything, and that is the point.
 *
 * Written out rather than derived from a `true` default so that adding a
 * capability to `ProviderCapabilities` is a compile error here — a new feature
 * silently defaulting to "supported" on the reference provider would make the
 * whole degradation story unreliable in the one place it has to be right.
 */
const ANTHROPIC_CAPABILITIES = {
  documentCitations: true,
  promptCaching: true,
  adaptiveThinking: true,
  serverWebSearch: true,
  refusalFallback: true,
  pdfInput: true,
  toolLoop: true,
  strictTools: true,
} as const;

/* ==================================================================== */
/* Request construction — the byte-identity surface                      */
/* ==================================================================== */

function toSystem(blocks: LlmSystemBlock[]) {
  return blocks.map(block =>
    block.cacheBreakpoint
      ? { type: 'text' as const, text: block.text, cache_control: { type: 'ephemeral' as const } }
      : { type: 'text' as const, text: block.text },
  );
}

function toMessage(message: LlmMessage): Anthropic.Beta.BetaMessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = message.content.map(part => {
    if (part.type === 'text') {
      return part.cacheBreakpoint
        ? { type: 'text' as const, text: part.text, cache_control: { type: 'ephemeral' as const } }
        : { type: 'text' as const, text: part.text };
    }
    if (part.type === 'image') {
      return {
        type: 'image' as const,
        // The media type is validated by the caller before it reaches here —
        // document intelligence checks it against SUPPORTED_IMAGE_MEDIA_TYPES.
        source: {
          type: 'base64' as const,
          media_type: part.image.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: part.image.base64,
        },
      };
    }
    const doc = part.document;
    const block: Anthropic.Beta.BetaContentBlockParam = {
      type: 'document',
      source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 },
      ...(doc.wantCitations ? { citations: { enabled: true } } : {}),
      ...(doc.title !== undefined ? { title: doc.title } : {}),
    };
    return block;
  });
  return { role: message.role, content };
}

/**
 * A tool as Anthropic wants it.
 *
 * `client` and `server` tools pass their `native` definition straight through:
 * a `BetaRunnableTool` carries the SDK's own `run`/`parse` pair, and rebuilding
 * it from the portable fields would hand the tool runner an object it cannot
 * execute. Only a `schema` tool — output shape, never run — is constructed
 * here, and only from fields the caller already supplied.
 */
function toTool(tool: LlmTool): unknown {
  if (tool.kind === 'server') return tool.native;
  if (tool.kind === 'client') {
    if (tool.native !== undefined) return tool.native;
    return { name: tool.name, description: tool.description, input_schema: tool.parameters };
  }
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.strict ? { strict: true } : {}),
    input_schema: tool.parameters,
  };
}

/**
 * Wraps an SDK runnable tool — what `betaTool()` and `betaMemoryTool()` return
 * — as a port `client` tool.
 *
 * `native` keeps the original object, so Anthropic's own tool runner receives
 * the `run`/`parse` pair it needs and executes the loop server-side exactly as
 * it did before the port. `execute` reaches the *same* closure through that
 * pair, so a provider with `toolLoop: false` can drive it from an in-app loop.
 * The two are one implementation reached two ways, not a copy and an original
 * that can drift.
 *
 * The `unknown` detour is unavoidable rather than lazy. `BetaRunnableTool` is
 * a union of a dozen tool shapes, each with its own `run` argument type, so
 * the union's `run` is callable only with `never` and its `name` and
 * `input_schema` exist on some members and not others. Reading them
 * defensively at runtime is the honest way through — and every tool this
 * codebase passes is a `betaTool()` or `betaMemoryTool()`, both of which
 * carry what is needed.
 */
export function clientToolFromRunnable(tool: unknown): LlmClientTool {
  const runnable = tool as {
    name?: string;
    type?: string;
    description?: string;
    input_schema?: Record<string, unknown>;
    run: (args: unknown, context?: unknown) => unknown;
    parse?: (content: unknown) => unknown;
  };
  return {
    kind: 'client',
    name: runnable.name ?? runnable.type ?? 'unnamed_tool',
    description: runnable.description ?? '',
    parameters: runnable.input_schema ?? { type: 'object', properties: {} },
    execute: async (input: unknown) => {
      const parsed = runnable.parse ? runnable.parse(input) : input;
      const out = await runnable.run(parsed);
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
    native: tool,
  };
}

function toToolChoice(choice: LlmToolChoice) {
  return choice.type === 'auto' ? { type: 'auto' as const } : { type: 'tool' as const, name: choice.name };
}

/**
 * The shared body of both request shapes.
 *
 * `baseRequestFor(agent)` supplies model, thinking, betas and fallbacks; the
 * model is then overridden with the route's, which is the same string in every
 * deployment that has not set a `provider:model` route (the two resolve from
 * the same environment variables and the same defaults). Overriding rather
 * than trusting the base keeps the route the single authority over what is
 * actually sent.
 */
function buildBaseParams(req: LlmRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...baseRequestFor(req.agent),
    model: req.model,
    max_tokens: req.maxTokens,
  };
  if (req.effort) params.output_config = { effort: req.effort };
  params.system = toSystem(req.system);
  params.messages = req.messages.map(toMessage);
  const tools = req.tools?.map(toTool);
  if (tools && tools.length > 0) params.tools = tools;
  if (req.toolChoice) params.tool_choice = toToolChoice(req.toolChoice);
  return params;
}

/** Params for a single `messages.stream(...)` call. Exported so the no-regression harness can diff them. */
export function buildCompleteParams(req: LlmRequest): Record<string, unknown> {
  return buildBaseParams(req);
}

/** Params for a `messages.toolRunner(...)` call. Exported for the same reason. */
export function buildToolRunnerParams(req: LlmToolRequest): Record<string, unknown> {
  const params = buildBaseParams(req);
  if (req.maxIterations !== undefined) params.max_iterations = req.maxIterations;
  return params;
}

/* ==================================================================== */
/* Response normalisation                                                */
/* ==================================================================== */

/**
 * Citations, as facts about the file rather than claims about it.
 *
 * Every citation Anthropic returns was produced by the API matching the
 * model's visible text against the document it was given, so all of them are
 * `verified: true`. Only `page_location` carries a page; a `char_location` on
 * a plain-text source is just as verified but has no page to report, and
 * inventing one from a character offset would be exactly the fabrication this
 * type exists to prevent.
 */
function toCitations(block: Anthropic.Beta.BetaTextBlock): LlmCitation[] | undefined {
  if (!block.citations || block.citations.length === 0) return undefined;
  const out: LlmCitation[] = [];
  for (const citation of block.citations) {
    if (citation.type === 'page_location') {
      out.push({ quote: citation.cited_text, page: citation.start_page_number, verified: true });
    } else if ('cited_text' in citation) {
      out.push({ quote: citation.cited_text, verified: true });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * The blocks the port models, in the order the API returned them.
 *
 * Server-tool blocks (`server_tool_use`, `web_search_tool_result`,
 * `web_fetch_tool_result`) are deliberately not translated: they are rich,
 * tool-specific and Anthropic-only, and the two agents that read them need the
 * real thing. They reach those through `LlmResult.native` /
 * `LlmIntermediateMessage.native` instead of through a lossy re-description.
 */
export function toContentBlocks(content: Anthropic.Beta.BetaContentBlock[]): LlmContentBlock[] {
  const out: LlmContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      const citations = toCitations(block);
      out.push(citations ? { type: 'text', text: block.text, citations } : { type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      out.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    } else if (block.type === 'thinking') {
      out.push({ type: 'thinking', text: block.thinking });
    }
  }
  return out;
}

function toStopReason(reason: string | null | undefined): LlmStopReason | null {
  switch (reason) {
    case 'end_turn':
    case 'max_tokens':
    case 'stop_sequence':
    case 'tool_use':
    case 'pause_turn':
    case 'refusal':
    case 'model_context_window_exceeded':
      return reason;
    default:
      // `compaction`, or anything the API adds later. Reported as null, which
      // is what every agent already treats as "unknown" in its messages.
      return null;
  }
}

/* ==================================================================== */
/* The provider                                                          */
/* ==================================================================== */

/**
 * The SDK's shipped .d.ts predates Claude Opus 5's adaptive-thinking API
 * (`thinking: { type: 'adaptive' }`, from `baseRequestFor`) and the
 * `web_search_20260209` / `web_fetch_20260209` server tools this codebase
 * uses, so its parameter unions reject requests the live API accepts. These
 * two aliases are the only concession made to that: the request object handed
 * to the SDK is never altered, the detour is type-only, and it is `unknown`
 * rather than `any` so nothing downstream is silently widened.
 *
 * `toolRunner`'s `stream?: false` half is named explicitly because
 * `Parameters<>` resolves an overloaded method to its LAST signature, which is
 * the `BetaToolRunner<boolean>` one — and a `boolean`-generic runner yields
 * `BetaMessage | BetaMessageStream`, which has neither `.content` nor
 * `.stop_reason`.
 */
type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];
type ToolRunnerParams = Parameters<Anthropic['beta']['messages']['toolRunner']>[0] & { stream?: false };

class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;

  descriptor(): ProviderDescriptor {
    // `agentCapability()` is already the authority on whether this deployment
    // has usable Anthropic credentials — it resolves the API key, the auth
    // token, an `ant auth login` profile on disk and the global kill switch.
    // Re-deriving that here would give two answers to one question.
    const capability = agentCapability();
    return {
      id: 'anthropic',
      label: 'Anthropic',
      configured: capability.available,
      capabilities: { ...ANTHROPIC_CAPABILITIES },
    };
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const client = this.client();
    const params = buildCompleteParams(req);
    const startedAt = Date.now();
    let firstTokenAt: number | undefined;

    const stream = client.beta.messages.stream(params as unknown as StreamParams);
    stream.on('streamEvent', event => {
      if (firstTokenAt === undefined && event.type === 'content_block_delta') firstTokenAt = Date.now();
    });
    const message = await stream.finalMessage();

    return {
      provider: 'anthropic',
      model: req.model,
      content: toContentBlocks(message.content),
      stopReason: toStopReason(message.stop_reason),
      usage: estimateUsage(req.model, message.usage),
      capabilityGaps: [],
      durationMs: Date.now() - startedAt,
      timeToFirstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      retries: 0,
      native: message,
    };
  }

  async runTools(req: LlmToolRequest): Promise<LlmResult> {
    const client = this.client();
    const params = buildToolRunnerParams(req);
    const startedAt = Date.now();

    const runner = client.beta.messages.toolRunner(params as unknown as ToolRunnerParams);

    for await (const message of runner) {
      // A server-side tool (web search, web fetch) can end a turn with
      // `pause_turn` once the server's own iteration limit is hit. The runner
      // does not auto-resume it, and leaving it unhandled silently truncates
      // the research. Pushing the assistant message back is exactly what
      // market-research.ts and explorer.ts did at their call sites before the
      // port; doing it here means both keep the behaviour and neither has to
      // restate a protocol detail that belongs to the provider.
      if (message.stop_reason === 'pause_turn') {
        runner.pushMessages({ role: 'assistant', content: message.content });
      }
      req.onMessage?.({
        content: toContentBlocks(message.content),
        stopReason: toStopReason(message.stop_reason),
        native: message,
      });
    }
    const final = await runner.done();

    return {
      provider: 'anthropic',
      model: req.model,
      content: toContentBlocks(final.content),
      stopReason: toStopReason(final.stop_reason),
      usage: estimateUsage(req.model, final.usage),
      capabilityGaps: [],
      durationMs: Date.now() - startedAt,
      // The tool runner consumes its own streams; there is no single
      // first-token moment for the call as a whole, so this is honestly absent
      // rather than reported as the first token of an arbitrary iteration.
      timeToFirstTokenMs: undefined,
      retries: 0,
      native: final,
    };
  }

  private client(): Anthropic {
    const client = getClient();
    if (!client) {
      // Callers check `descriptor().configured` before calling, so reaching
      // here means the deployment changed under a run. Thrown rather than
      // returned so it lands in the same catch as any other transport failure.
      throw new ProviderCallError(
        'Anthropic credentials are not configured — check ANTHROPIC_API_KEY or run `ant auth login`.',
      );
    }
    return client;
  }
}

export const anthropicProvider: LlmProvider = new AnthropicProvider();
