/**
 * The OpenAI-compatible provider: one implementation for OpenRouter, LiteLLM,
 * Together, Groq, vLLM and Ollama.
 *
 * They are one provider because they are one wire format — `POST
 * {baseUrl}/chat/completions`, the same message array, the same
 * `tools: [{ type: 'function', ... }]`, the same `usage.prompt_tokens`. They
 * differ in base URL, credentials and which models they front, all of which
 * are configuration rather than code.
 *
 * --- What this provider genuinely cannot do, and what that costs ----------
 *
 * This is the file where the port earns its keep, because almost everything
 * Realytica leans on beyond plain text is missing here:
 *
 *   documentCitations  no. There is no server-verified quotation in this
 *                      format. The provider therefore returns citations that
 *                      are `verified: false` — or, in practice, none at all —
 *                      and NEVER a page number. `citations_unavailable` is
 *                      recorded, document intelligence sees it, and every
 *                      field it extracts drops in confidence and loses its
 *                      `sourcePage`. That is the single most consequential
 *                      degradation in this codebase and it is deliberately
 *                      loud.
 *   pdfInput           no. A PDF is extracted to text in-process and sent as
 *                      text (see `extractPdfText`), which loses layout and
 *                      page structure and cannot read a scan at all. When no
 *                      text comes out, the call FAILS rather than quietly
 *                      sending an empty document — a model asked to extract
 *                      fields from nothing will invent them.
 *   promptCaching      no explicit breakpoints. `cached_tokens`, where the
 *                      endpoint reports it, is folded into the usage so the
 *                      cost estimate stays honest — but see the note on
 *                      `promptCaching` below for why that does not flip the
 *                      declared capability to true.
 *   adaptiveThinking   no. Effort is dropped.
 *   serverWebSearch    no. The two agents that need it refuse to run rather
 *                      than search-free-guess their way to a market finding.
 *   refusalFallback    no. A decline ends the run.
 *   toolLoop           no — so this file runs the loop itself, below.
 *   strictTools        no by default. Some gateways honour `strict`, most
 *                      silently ignore it, and a capability that is true only
 *                      when the vendor happens to comply is worse than one
 *                      that is honestly false. Opt in with
 *                      REALYTICA_OPENAI_STRICT_TOOLS=1 for an endpoint known
 *                      to enforce it.
 *
 * None of these are defects to be hidden. Each is recorded as a
 * `CapabilityGap` on the result, travels onto the `AgentRun`, and is rendered
 * to a human through `describeGap`.
 */

import { inflateSync } from 'node:zlib';
import type { CapabilityGap, ProviderDescriptor } from '@realytica/shared';
import { warnOnce } from '../client';
/*
 * Priced through the cross-provider table, NOT through `client.ts`'s
 * `estimateUsage`.
 *
 * That function resolves against Anthropic's rate card and falls back to the
 * most expensive Anthropic model for an id it does not recognise — a
 * deliberate, bounded ceiling *within one vendor's price list*. Carried across
 * the provider boundary it stops being conservative and becomes wrong by two
 * orders of magnitude: measured, a llama route priced at $1.25 for tokens
 * worth about $0.13.
 *
 * And it does not merely overstate, it inverts the answer. The whole point of
 * routing a tier to a cheaper vendor is that it is cheaper; a cost view that
 * reports the cheap route as the expensive one would argue against the change
 * that just saved the money — and `savedUsd` on the case summary would come
 * out negative.
 *
 * The cross-provider table prices what it knows and reports the rest as
 * unpriced rather than guessing, which is the honest answer for a model whose
 * rates this deployment has not been told.
 */
import { pricedUsage } from '../telemetry/pricing';
import { ProviderCallError, mergeGaps } from './types';
import type {
  LlmClientTool,
  LlmContentBlock,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmStopReason,
  LlmToolRequest,
} from './types';
import { readEnv } from '../env';

/* ==================================================================== */
/* Configuration                                                         */
/* ==================================================================== */

export interface OpenAiCompatibleConfig {
  /** No trailing slash; `/chat/completions` is appended. */
  baseUrl: string;
  /** Empty for an endpoint that needs none — see the note in `readConfig`. */
  apiKey: string;
  /** Extra headers, e.g. OpenRouter's `HTTP-Referer`/`X-Title`. */
  headers: Record<string, string>;
  timeoutMs: number;
  /** Retries *after* the first attempt, on 429 and 5xx only. */
  maxRetries: number;
  retryBaseMs: number;
  /** Whether this endpoint is trusted to enforce `strict` on tool schemas. */
  strictTools: boolean;
  /** Models the deployment has declared, purely for the observability view. */
  models?: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;

/** Ceiling on an honoured `Retry-After`; beyond this, waiting costs more than failing does. */
const MAX_RETRY_AFTER_MS = 30_000;

/** The in-app tool loop's ceiling when a caller names none. An unbounded loop is an unbounded bill. */
export const DEFAULT_MAX_TOOL_ITERATIONS = 8;

function readHeaders(): Record<string, string> {
  const raw = readEnv('OPENAI_HEADERS');
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch (e) {
    // Ignored rather than thrown, exactly as routing.ts treats a malformed
    // route: a typo in a deployment variable must not take the agent layer
    // down, and the warning names what was dropped so it is findable.
    warnOnce(
      'openai:headers',
      `Ignoring REALYTICA_OPENAI_HEADERS — expected a JSON object of string headers (${e instanceof Error ? e.message : String(e)}).`,
    );
    return {};
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    warnOnce(`openai:${name}`, `Ignoring ${name}="${raw}" — expected a non-negative integer. Using ${fallback}.`);
    return fallback;
  }
  return n;
}

/**
 * The endpoint this deployment points at, or null when none is configured.
 *
 * The API key is optional on purpose. Two of the six endpoints this provider
 * exists to serve — vLLM and Ollama — routinely run unauthenticated on a
 * private network, and requiring a key would lock them out for the sake of a
 * check the endpoint itself already performs. The base URL is what makes the
 * provider configured; `Authorization` is sent only when there is something to
 * send.
 */
export function readConfig(): OpenAiCompatibleConfig | null {
  const baseUrl = readEnv('OPENAI_BASE_URL')?.trim();
  if (!baseUrl) return null;
  const models = readEnv('OPENAI_MODELS')?.split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: readEnv('OPENAI_API_KEY')?.trim() ?? '',
    headers: readHeaders(),
    timeoutMs: readPositiveInt('REALYTICA_OPENAI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: readPositiveInt('REALYTICA_OPENAI_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    retryBaseMs: readPositiveInt('REALYTICA_OPENAI_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS),
    strictTools: readEnv('OPENAI_STRICT_TOOLS') === '1',
    ...(models && models.length > 0 ? { models } : {}),
  };
}

/* ==================================================================== */
/* PDF degradation: text out of a file this endpoint cannot read         */
/* ==================================================================== */

/**
 * Pulls whatever text a PDF's content streams actually contain.
 *
 * This is a degradation path, not a PDF library, and it is written to be
 * honest about that. It inflates each `stream ... endstream` body (falling
 * back to the raw bytes when it is not compressed) and reads the strings that
 * the text-showing operators — `Tj`, `TJ`, `'`, `"` — take as arguments,
 * inside `BT`/`ET` text objects. What it therefore cannot do:
 *
 *   - a scanned page has no text operators at all, so it returns nothing, and
 *     the caller is required to fail the call rather than send an empty
 *     document (see `documentText`);
 *   - a font with a custom encoding produces mojibake rather than words;
 *   - column layout, tables and reading order are lost, because a content
 *     stream is drawing instructions, not a document.
 *
 * All three are exactly why `pdf_input_unavailable` says "layout and page
 * structure are lost and a scanned document may not be readable at all". No
 * page number is derivable from any of this, which is the other half of why
 * `citations_unavailable` always accompanies it.
 */
export function extractPdfText(bytes: Buffer): string {
  const pieces: string[] = [];
  for (const stream of contentStreams(bytes)) {
    const text = textFromContentStream(stream);
    if (text.trim().length > 0) pieces.push(text);
  }
  return pieces.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Every `stream ... endstream` body, inflated where it inflates. */
function contentStreams(bytes: Buffer): string[] {
  // PDF structural keywords are ASCII regardless of what the streams contain,
  // so latin1 is a lossless byte-to-char mapping for locating them — the same
  // reasoning pdf.ts uses for its page-count scan.
  const latin1 = bytes.toString('latin1');
  const out: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = latin1.indexOf('stream', cursor);
    if (start === -1) break;
    let dataStart = start + 'stream'.length;
    if (latin1[dataStart] === '\r') dataStart += 1;
    if (latin1[dataStart] === '\n') dataStart += 1;
    const end = latin1.indexOf('endstream', dataStart);
    if (end === -1) break;
    cursor = end + 'endstream'.length;

    const raw = bytes.subarray(dataStart, end);
    let decoded: string;
    try {
      decoded = inflateSync(raw).toString('latin1');
    } catch {
      decoded = raw.toString('latin1');
    }
    // Only content streams matter here; an embedded font or image inflates
    // fine and would otherwise contribute binary noise.
    if (decoded.includes('BT') || decoded.includes('Tj') || decoded.includes('TJ')) out.push(decoded);
  }
  return out;
}

/** Reads a PDF literal string `( ... )`, honouring nesting and backslash escapes. */
function readLiteralString(source: string, openIndex: number): { text: string; next: number } {
  let depth = 1;
  let i = openIndex + 1;
  let out = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      const escaped = source[i + 1] ?? '';
      i += 2;
      switch (escaped) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': case 'f': out += ' '; break;
        case '(': out += '('; break;
        case ')': out += ')'; break;
        case '\\': out += '\\'; break;
        case '\n': break; // line continuation
        default:
          if (escaped >= '0' && escaped <= '7') {
            let octal = escaped;
            while (octal.length < 3 && source[i] >= '0' && source[i] <= '7') {
              octal += source[i];
              i += 1;
            }
            out += String.fromCharCode(Number.parseInt(octal, 8));
          } else {
            out += escaped;
          }
      }
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { text: out, next: i + 1 };
    }
    out += ch;
    i += 1;
  }
  return { text: out, next: i };
}

/** Reads a PDF hex string `<4A4B>`. */
function readHexString(source: string, openIndex: number): { text: string; next: number } {
  const close = source.indexOf('>', openIndex + 1);
  if (close === -1) return { text: '', next: source.length };
  const hex = source.slice(openIndex + 1, close).replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return { text: out, next: close + 1 };
}

function textFromContentStream(content: string): string {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '%') {
      // A comment runs to end of line.
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl + 1;
      continue;
    }
    if (ch === '(') {
      const read = readLiteralString(content, i);
      out += read.text;
      i = read.next;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const read = readHexString(content, i);
      out += read.text;
      i = read.next;
      continue;
    }
    // Positioning and end-of-text operators become line breaks, which is the
    // closest a drawing instruction gets to a paragraph boundary.
    if ((ch === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D' || content[i + 1] === '*')) || (ch === 'E' && content[i + 1] === 'T')) {
      out += '\n';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out;
}

/* ==================================================================== */
/* Wire shapes                                                           */
/* ==================================================================== */

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface WireMessage {
  role?: string;
  content?: string | null;
  /** DeepSeek/vLLM convention for exposed reasoning. Not adaptive thinking; reported as such. */
  reasoning_content?: string | null;
  refusal?: string | null;
  tool_calls?: WireToolCall[];
}

interface WireChoice {
  message?: WireMessage;
  finish_reason?: string | null;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface WireResponse {
  choices?: WireChoice[];
  usage?: WireUsage;
  error?: { message?: string };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleOverrides {
  /** Injected so the harness can drive this provider without a network. */
  fetchImpl?: FetchLike;
  /** Injected so retry backoff does not make a test suite wait for real. */
  sleep?: (ms: number) => Promise<void>;
}

/* ==================================================================== */
/* Request mapping                                                       */
/* ==================================================================== */

interface MappedRequest {
  messages: Record<string, unknown>[];
  tools?: Record<string, unknown>[];
  toolChoice?: unknown;
  clientTools: Map<string, LlmClientTool>;
  gaps: CapabilityGap[];
}

/**
 * The text a PDF becomes on an endpoint that cannot read one.
 *
 * Failing loudly on an unreadable file is the important half. Sending an empty
 * or near-empty document and letting the model answer anyway is how a scanned
 * khata extract turns into a confidently invented khata number, and no
 * downstream confidence penalty can undo that — the field would look extracted
 * because it was returned by an extraction call.
 */
function documentText(base64: string, title: string | undefined): string {
  const bytes = Buffer.from(base64, 'base64');
  const text = extractPdfText(bytes);
  const label = title ?? 'the attached document';
  if (text.trim().length < 32) {
    throw new ProviderCallError(
      `This route cannot accept PDFs, and no readable text could be extracted from "${label}" ` +
        `(${(bytes.byteLength / 1024).toFixed(0)}KB) to send in its place — it is most likely a scan with no text layer. ` +
        'Route this agent to a provider with native PDF input, or run OCR before uploading.',
    );
  }
  return [
    `--- Text extracted from "${label}" ---`,
    'Note: this is a plain-text extraction of a PDF. Page boundaries, layout and tables are lost, and no page number can be cited for anything in it.',
    text,
    '--- End of extracted text ---',
  ].join('\n');
}

function mapRequest(req: LlmRequest, config: OpenAiCompatibleConfig): MappedRequest {
  const gaps: CapabilityGap[] = [];

  // Every request in this codebase asks for adaptive thinking and the
  // server-side refusal fallback (see `baseRequestFor`). Neither exists here,
  // so both are recorded on every call rather than only when a caller
  // remembers to ask twice.
  gaps.push('adaptive_thinking_unavailable', 'refusal_fallback_unavailable');

  const systemText = req.system.map(b => b.text).join('\n\n');
  // A breakpoint anywhere is the same gap — the caller asked to place one and
  // this endpoint cannot honour it. Counted once: the gap is a fact about the
  // provider, not a tally of how many breakpoints were dropped.
  const wantsCache =
    req.system.some(b => b.cacheBreakpoint) ||
    req.messages.some(
      m => typeof m.content !== 'string' && m.content.some(p => p.type === 'text' && p.cacheBreakpoint),
    );
  if (wantsCache) gaps.push('prompt_caching_unavailable');

  const messages: Record<string, unknown>[] = [];
  if (systemText.trim().length > 0) messages.push({ role: 'system', content: systemText });

  for (const message of req.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text });
      } else if (part.type === 'image') {
        // The OpenAI-compatible multimodal shape. An endpoint without vision
        // rejects it with a 400 whose body reaches the caller verbatim — a
        // visible failure, which is the correct outcome for "this route cannot
        // read your scan".
        //
        // No `citations_unavailable` here: citations are a document-only
        // feature on Anthropic too, so an image loses nothing on this route
        // that it would have had on the reference one. A gap that is recorded
        // where nothing was actually lost teaches a reader to ignore gaps.
        parts.push({ type: 'image_url', image_url: { url: `data:${part.image.mediaType};base64,${part.image.base64}` } });
      } else {
        gaps.push('pdf_input_unavailable');
        if (part.document.wantCitations) gaps.push('citations_unavailable');
        parts.push({ type: 'text', text: documentText(part.document.base64, part.document.title) });
      }
    }
    const allText = parts.every(p => p.type === 'text');
    messages.push({
      role: message.role,
      content: allText ? parts.map(p => String(p.text)).join('\n\n') : parts,
    });
  }

  const clientTools = new Map<string, LlmClientTool>();
  const tools: Record<string, unknown>[] = [];
  for (const tool of req.tools ?? []) {
    if (tool.kind === 'server') {
      gaps.push(tool.gap);
      continue;
    }
    if (tool.kind === 'client') clientTools.set(tool.name, tool);
    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(config.strictTools ? { strict: true } : {}),
      },
    });
  }
  if (tools.length > 0 && !config.strictTools) gaps.push('strict_tools_unavailable');

  let toolChoice: unknown;
  if (req.toolChoice && tools.length > 0) {
    toolChoice =
      req.toolChoice.type === 'tool' ? { type: 'function', function: { name: req.toolChoice.name } } : 'auto';
  }

  return { messages, tools: tools.length > 0 ? tools : undefined, toolChoice, clientTools, gaps: mergeGaps(gaps) };
}

/* ==================================================================== */
/* Response mapping                                                      */
/* ==================================================================== */

function toStopReason(finishReason: string | null | undefined, refused: boolean): LlmStopReason | null {
  if (refused) return 'refusal';
  switch (finishReason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'refusal';
    default: return null;
  }
}

interface ParsedResponse {
  content: LlmContentBlock[];
  stopReason: LlmStopReason | null;
  /** The raw tool calls, echoed verbatim into the next request — ids must match exactly. */
  rawToolCalls: WireToolCall[];
  /** The assistant text, echoed back alongside the tool calls in the loop. */
  assistantText: string | null;
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  gaps: CapabilityGap[];
}

function parseResponse(json: WireResponse): ParsedResponse {
  const choice = json.choices?.[0];
  if (!choice) {
    const detail = json.error?.message ? `: ${json.error.message}` : '';
    throw new ProviderCallError(`The endpoint returned no choices${detail}.`);
  }
  const message = choice.message ?? {};
  const gaps: CapabilityGap[] = [];
  const content: LlmContentBlock[] = [];

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    content.push({ type: 'thinking', text: message.reasoning_content });
  }
  if (typeof message.content === 'string' && message.content.length > 0) {
    // No citations, ever. This format has no way to attribute a span of text
    // to a location in a supplied document, so anything resembling one would
    // be the model's own claim — which is exactly what `verified: false` is
    // for, and why no page number is attached under any circumstances.
    content.push({ type: 'text', text: message.content });
  }

  const rawToolCalls = message.tool_calls ?? [];
  for (const call of rawToolCalls) {
    const name = call.function?.name ?? '';
    const rawArgs = call.function?.arguments ?? '';
    let input: unknown = {};
    let parseError: string | undefined;
    try {
      // Always JSON.parse, never string matching: `{"quote":"the deed says \"sold\""}`
      // and a nested object both survive a parser and neither survives a regex.
      input = rawArgs.trim().length > 0 ? JSON.parse(rawArgs) : {};
    } catch (e) {
      parseError = `Tool arguments for "${name}" were not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      gaps.push('strict_tools_unavailable');
    }
    content.push({
      type: 'tool_use',
      id: call.id ?? '',
      name,
      input,
      ...(parseError ? { parseError } : {}),
    });
  }

  const refused = typeof message.refusal === 'string' && message.refusal.length > 0;
  if (refused) content.push({ type: 'text', text: message.refusal as string });

  // OpenAI counts cached tokens *inside* `prompt_tokens`; Anthropic reports
  // them beside `input_tokens`. Subtracting keeps the two comparable in one
  // telemetry table, and keeps the cost estimate from billing a cached read at
  // the full input rate.
  const usage = json.usage ?? {};
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const promptTokens = usage.prompt_tokens ?? 0;

  return {
    content,
    stopReason: toStopReason(choice.finish_reason, refused),
    rawToolCalls,
    assistantText: typeof message.content === 'string' ? message.content : null,
    tokens: {
      inputTokens: Math.max(0, promptTokens - cacheReadTokens),
      outputTokens: usage.completion_tokens ?? 0,
      cacheReadTokens,
    },
    gaps,
  };
}

/* ==================================================================== */
/* The provider                                                          */
/* ==================================================================== */

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai_compatible' as const;

  constructor(private readonly overrides: OpenAiCompatibleOverrides = {}) {}

  descriptor(): ProviderDescriptor {
    const config = readConfig();
    return {
      id: 'openai_compatible',
      label: 'OpenAI-compatible endpoint',
      ...(config ? { baseUrl: config.baseUrl } : {}),
      configured: config !== null,
      capabilities: {
        documentCitations: false,
        /**
         * False even on an endpoint that reports `cached_tokens`.
         *
         * The two are different things. `cached_tokens` is an endpoint telling
         * you, after the fact, that its own automatic prefix cache happened to
         * hit. `promptCaching` in this port means the caller can *place* a
         * breakpoint and rely on it — which is what the explorer does when it
         * puts one on the role text and another on the objective. That request
         * is dropped here whatever the response later says, so declaring the
         * capability true would let a caller plan around a guarantee that does
         * not exist. The cached tokens are still read into the usage, so the
         * bill stays accurate; the capability stays honest.
         */
        promptCaching: false,
        adaptiveThinking: false,
        serverWebSearch: false,
        refusalFallback: false,
        pdfInput: false,
        toolLoop: false,
        strictTools: config?.strictTools ?? false,
      },
      ...(config?.models ? { models: config.models } : {}),
    };
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const config = this.config();
    const startedAt = Date.now();
    const mapped = mapRequest(req, config);
    const { json, retries } = await this.post(config, this.body(req, mapped));
    const parsed = parseResponse(json);

    return {
      provider: 'openai_compatible',
      model: req.model,
      content: parsed.content,
      stopReason: parsed.stopReason,
      usage: pricedUsage('openai_compatible', req.model, parsed.tokens),
      capabilityGaps: mergeGaps(mapped.gaps, parsed.gaps),
      durationMs: Date.now() - startedAt,
      // Not streamed. `/chat/completions` streaming is SSE and its
      // tool-call deltas differ across the six endpoints this provider
      // targets; a non-streamed call is the one shape all of them agree on.
      // Time-to-first-token is therefore honestly absent rather than
      // reported as the total duration.
      timeToFirstTokenMs: undefined,
      retries,
      native: json,
    };
  }

  /**
   * The tool loop, run here because the endpoint does not run one.
   *
   * This is the compensating implementation for `toolLoop: false`: request,
   * execute whatever tools were called, append the results, repeat. Two
   * bounds keep it from becoming the open-ended bill the explorer's own
   * budget exists to prevent — `maxIterations` from the caller, and the fact
   * that a turn with no tool calls ends it.
   *
   * Usage is accumulated across every iteration rather than taken from the
   * last one, because the caller is billed for all of them, and an agent that
   * looped six times must not report the cost of one.
   */
  async runTools(req: LlmToolRequest): Promise<LlmResult> {
    const config = this.config();
    const startedAt = Date.now();
    const mapped = mapRequest(req, config);
    const maxIterations = Math.max(1, req.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS);

    const messages = [...mapped.messages];
    const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const gaps: CapabilityGap[] = [...mapped.gaps];
    let retries = 0;
    let last: ParsedResponse | undefined;
    let lastJson: unknown;

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const attempt = await this.post(config, this.body(req, { ...mapped, messages }));
      retries += attempt.retries;
      lastJson = attempt.json;
      const parsed = parseResponse(attempt.json);
      last = parsed;
      tokens.inputTokens += parsed.tokens.inputTokens;
      tokens.outputTokens += parsed.tokens.outputTokens;
      tokens.cacheReadTokens += parsed.tokens.cacheReadTokens;
      gaps.push(...parsed.gaps);

      req.onMessage?.({ content: parsed.content, stopReason: parsed.stopReason, native: attempt.json });

      const runnable = parsed.rawToolCalls.filter(c => mapped.clientTools.has(c.function?.name ?? ''));
      if (runnable.length === 0) break;

      messages.push({
        role: 'assistant',
        content: parsed.assistantText,
        tool_calls: parsed.rawToolCalls,
      });
      for (const call of parsed.rawToolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id ?? '',
          content: await this.executeTool(mapped.clientTools, call, gaps),
        });
      }

      if (iteration === maxIterations) {
        warnOnce(
          `openai:tool-iterations:${req.agent}`,
          `The in-app tool loop for ${req.agent} hit its ${maxIterations}-iteration ceiling with tools still being requested — the last assistant turn is returned as final.`,
        );
      }
    }

    if (!last) throw new ProviderCallError('The tool loop produced no response at all.');

    return {
      provider: 'openai_compatible',
      model: req.model,
      content: last.content,
      stopReason: last.stopReason,
      usage: pricedUsage('openai_compatible', req.model, tokens),
      capabilityGaps: mergeGaps(gaps),
      durationMs: Date.now() - startedAt,
      timeToFirstTokenMs: undefined,
      retries,
      native: lastJson,
    };
  }

  /**
   * Runs one tool call and turns anything it throws into a result the model
   * can read.
   *
   * A thrown tool never ends the run: the model is told what went wrong and
   * gets to try again, which is what Anthropic's own runner does and what the
   * copilot's eight-iteration ceiling assumes.
   */
  private async executeTool(
    clientTools: Map<string, LlmClientTool>,
    call: WireToolCall,
    gaps: CapabilityGap[],
  ): Promise<string> {
    const name = call.function?.name ?? '';
    const tool = clientTools.get(name);
    if (!tool) return JSON.stringify({ error: `No tool named "${name}" is available on this run.` });

    let input: unknown;
    try {
      const raw = call.function?.arguments ?? '';
      input = raw.trim().length > 0 ? JSON.parse(raw) : {};
    } catch (e) {
      gaps.push('strict_tools_unavailable');
      return JSON.stringify({
        error: `Arguments for "${name}" were not valid JSON (${e instanceof Error ? e.message : String(e)}). Call the tool again with a single valid JSON object.`,
      });
    }

    try {
      return await tool.execute(input);
    } catch (e) {
      return JSON.stringify({ error: `Tool "${name}" failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private body(req: LlmRequest, mapped: Pick<MappedRequest, 'messages' | 'tools' | 'toolChoice'>): Record<string, unknown> {
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: mapped.messages,
      ...(mapped.tools ? { tools: mapped.tools } : {}),
      ...(mapped.toolChoice !== undefined ? { tool_choice: mapped.toolChoice } : {}),
      stream: false,
    };
  }

  /**
   * One POST, with a timeout and bounded retries.
   *
   * Retried: 429 and 5xx, which are the endpoint saying "not now" rather than
   * "not ever". Not retried: 4xx, which will fail identically the second
   * time, and a timeout, because retrying one triples a wait that was already
   * too long — the caller and the user are better served by a clear failure
   * than by three of them in sequence.
   */
  private async post(
    config: OpenAiCompatibleConfig,
    body: Record<string, unknown>,
  ): Promise<{ json: WireResponse; retries: number }> {
    const fetchImpl = this.overrides.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new ProviderCallError('No fetch implementation is available in this runtime.');
    const sleep = this.overrides.sleep ?? defaultSleep;
    const url = `${config.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...config.headers,
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    };

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) {
          throw new ProviderCallError(
            `The request to ${url} timed out after ${config.timeoutMs}ms. Raise REALYTICA_OPENAI_TIMEOUT_MS if this endpoint is legitimately slow.`,
            { retries: attempt },
          );
        }
        if (attempt < config.maxRetries) {
          await sleep(config.retryBaseMs * 2 ** attempt);
          continue;
        }
        throw new ProviderCallError(
          `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
          { retries: attempt },
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const text = await response.text();
        try {
          return { json: JSON.parse(text) as WireResponse, retries: attempt };
        } catch {
          throw new ProviderCallError(
            `${url} returned ${response.status} with a body that is not JSON: ${truncate(text)}`,
            { status: response.status, retries: attempt },
          );
        }
      }

      // The body is where an OpenAI-compatible gateway puts the actual reason
      // — an unknown model id, a missing credit balance, an unsupported
      // parameter. A status code alone sends an operator hunting.
      const errorBody = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < config.maxRetries) {
        await sleep(retryAfterMs(response) ?? config.retryBaseMs * 2 ** attempt);
        continue;
      }
      throw new ProviderCallError(
        `${url} returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}: ${truncate(errorBody)}`,
        { status: response.status, retries: attempt },
      );
    }
  }

  private config(): OpenAiCompatibleConfig {
    const config = readConfig();
    if (!config) {
      throw new ProviderCallError(
        'No OpenAI-compatible endpoint is configured — set REALYTICA_OPENAI_BASE_URL (and REALYTICA_OPENAI_API_KEY where the endpoint needs one).',
      );
    }
    return config;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function truncate(text: string, limit = 2000): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '(empty response body)';
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}… (${trimmed.length} bytes total)`;
}

/**
 * A provider instance, optionally with its transport injected.
 *
 * The overrides exist so the harness can prove retry, timeout and tool-loop
 * behaviour against a stub `fetch` without a network and without a test-only
 * back door in the shipped singleton.
 */
export function createOpenAiCompatibleProvider(overrides: OpenAiCompatibleOverrides = {}): LlmProvider {
  return new OpenAiCompatibleProvider(overrides);
}

export const openAiCompatibleProvider: LlmProvider = createOpenAiCompatibleProvider();
