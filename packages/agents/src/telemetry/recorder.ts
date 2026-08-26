/**
 * Recording one model call.
 *
 * A provider adapter has one job at the moment it makes a call, and it is not
 * bookkeeping. So the surface here is three lines at the call site — begin,
 * optionally mark first token, end — and everything else (timing, pricing,
 * id minting, the sink write, the failure handling for all of the above) is
 * this module's problem.
 *
 * ## The rule that outranks every other consideration here
 *
 * **Telemetry must never fail a diligence run.** A user waiting on a screening
 * does not care that the observability store is full or that a rate could not
 * be resolved. Every entry point below therefore catches its own failures,
 * warns once, and returns something usable. `end` resolves rather than
 * rejects, always — the only thing a caller can lose is the record.
 *
 * ## Why `end` returns a promise
 *
 * Because durability is a decision the caller has to make and cannot make if
 * this were fire-and-forget. On serverless the instance can be frozen the
 * moment a response is sent, so an unawaited write is a write that never
 * happens — the same reasoning that removed the debounce from `store.save()`.
 * An adapter inside a request that is about to return should `await` it; a
 * background job that does not care can drop it. Neither is made the default,
 * because guessing wrong is silent in one direction and slow in the other.
 */

import type {
  AgentKind,
  CapabilityGap,
  LlmCallOutcome,
  LlmCallRecord,
  ModelTier,
  ProviderId,
} from '@realytica/shared';
import { warnOnce } from '../client';
import { formatRoute } from '../routing';
import { priceTokens, type TokenCounts } from './pricing';
import { systemClock, type Clock, type RecordedLlmCall, type TelemetrySink } from './types';

/* ==================================================================== */
/* Inputs                                                               */
/* ==================================================================== */

/** What is known before the call goes out. */
export interface CallStart {
  /** Absent for calls not made on behalf of a case — an evaluation run, a warm-up probe. */
  caseId?: string;
  agent: AgentKind;
  tier: ModelTier;
  provider: ProviderId;
  model: string;
  /** Overrides the minted id. For a caller that already has a request id worth correlating on. */
  id?: string;
}

/** What is known once it comes back. */
export interface CallFinish {
  outcome: LlmCallOutcome;
  /** Absent when the provider reported none — a connection failure has no usage. Counted as zero tokens, never as an unknown cost. */
  tokens?: TokenCounts;
  /** Capabilities this call asked for and did not get. */
  capabilityGaps?: readonly CapabilityGap[];
  /** Transport-level retries inside this one logical call. */
  retries?: number;
  /** Required in spirit for `failed`; a message the panel can show, not a stack. */
  error?: string;
}

export interface RecorderDeps {
  /** Injected so durations are testable. Defaults to the system clock. */
  clock?: Clock;
  /** Where finished records go. Omitted means "time it but store nothing" — valid, and what a disabled deployment does. */
  sink?: TelemetrySink;
  /** Overrides id minting. A test that wants stable ids supplies a counter. */
  newId?: (start: CallStart, startedAtMs: number) => string;
}

/* ==================================================================== */
/* Ids                                                                  */
/* ==================================================================== */

let sequence = 0;

/**
 * A deterministic id: start time, process, sequence.
 *
 * No randomness anywhere in this package, so `Math.random` is not an option
 * and neither is a UUID. The process discriminator is not decoration: on
 * serverless, records from many instances land in one store, several of them
 * genuinely do start a call in the same millisecond, and two records sharing
 * an id would be silently deduplicated into one on read — a call that
 * disappears from the cost total rather than an error anyone sees.
 */
function mintId(startedAtMs: number): string {
  sequence = (sequence + 1) % 0xffffff;
  const pid = typeof process !== 'undefined' && typeof process.pid === 'number' ? process.pid : 0;
  return `llm-${startedAtMs.toString(36)}-${pid.toString(36)}-${sequence.toString(36).padStart(4, '0')}`;
}

const ZERO_TOKENS: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

/* ==================================================================== */
/* The handle                                                           */
/* ==================================================================== */

export interface CallHandle {
  readonly id: string;
  /** True once the call has been ended. Lets a wrapper tell a settled call from a leaked one. */
  readonly settled: boolean;
  /**
   * Mark the first streamed token. Only the first mark counts — a streaming
   * loop calling this per chunk is the expected mistake, and quietly taking
   * the first is better than a "time to last token" mislabelled as TTFT.
   */
  markFirstToken(): void;
  /** End the call. Resolves with the record once the sink has it; never rejects. */
  end(finish: CallFinish): Promise<RecordedLlmCall>;
  succeeded(tokens?: TokenCounts, extra?: Omit<CallFinish, 'outcome' | 'tokens'>): Promise<RecordedLlmCall>;
  refused(extra?: Omit<CallFinish, 'outcome'>): Promise<RecordedLlmCall>;
  failed(error: unknown, extra?: Omit<CallFinish, 'outcome' | 'error'>): Promise<RecordedLlmCall>;
}

/**
 * Start timing a call.
 *
 * Cheap and total: it mints an id, reads the clock once and returns. Nothing
 * here can throw, because the alternative is an adapter that fails to make a
 * model call because it failed to prepare to measure one.
 */
export function beginCall(start: CallStart, deps: RecorderDeps = {}): CallHandle {
  const clock = deps.clock ?? systemClock;
  const startedAtMs = safeNow(clock);
  const id = safeId(start, startedAtMs, deps.newId);
  const startedAt = new Date(startedAtMs).toISOString();

  let firstTokenAtMs: number | null = null;
  let settled: RecordedLlmCall | null = null;

  const handle: CallHandle = {
    id,
    get settled() {
      return settled !== null;
    },

    markFirstToken(): void {
      if (firstTokenAtMs !== null) return;
      firstTokenAtMs = safeNow(clock);
    },

    async end(finish: CallFinish): Promise<RecordedLlmCall> {
      // Ending twice is a real shape — an adapter with both an error path and
      // a `finally` — and double-recording would double the call's cost in
      // every total that reads the store. The first end wins and the second is
      // a no-op that says so.
      if (settled) {
        warnOnce(
          `telemetry-double-end:${start.agent}`,
          `A telemetry call for ${start.agent} was ended twice (${id}); the second end was ignored so the call is not double-counted.`,
        );
        return settled;
      }

      const record = buildRecord(start, id, startedAt, startedAtMs, firstTokenAtMs, finish, clock);
      settled = record;

      if (deps.sink) {
        try {
          await deps.sink.record(record);
        } catch (err) {
          // A sink is not supposed to reject; if one does, that is its bug and
          // this is still not a reason to fail the run that produced the call.
          warnOnce(
            'telemetry-sink-threw',
            `Telemetry sink rejected a write (${(err as Error).message}) — the record was dropped. Diligence output is unaffected.`,
          );
        }
      }
      return record;
    },

    succeeded(tokens, extra) {
      return handle.end({ outcome: 'succeeded', tokens, ...extra });
    },
    refused(extra) {
      return handle.end({ outcome: 'refused', ...extra });
    },
    failed(error, extra) {
      return handle.end({ outcome: 'failed', error: describeThrown(error), ...extra });
    },
  };

  return handle;
}

/**
 * Build the record.
 *
 * Separated from `end` so the pricing and clamping rules are readable in one
 * place, and so a caller reconstructing a record from a provider's own log can
 * reuse them.
 */
function buildRecord(
  start: CallStart,
  id: string,
  startedAt: string,
  startedAtMs: number,
  firstTokenAtMs: number | null,
  finish: CallFinish,
  clock: Clock,
): RecordedLlmCall {
  const endedAtMs = safeNow(clock);
  const tokens = normaliseTokens(finish.tokens);
  const price = safePrice(start.provider, start.model, tokens);

  const record: RecordedLlmCall = {
    id,
    agent: start.agent,
    tier: start.tier,
    provider: start.provider,
    model: start.model,
    startedAt,
    // Clamped at zero: a clock that steps backwards mid-call (an NTP
    // correction, a suspended laptop) would otherwise put a negative duration
    // into a median and make the whole route look instant.
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    usage: { ...tokens, estimatedCostUsd: price.costUsd },
    outcome: finish.outcome,
    capabilityGaps: finish.capabilityGaps ? [...finish.capabilityGaps] : [],
    retries: normaliseCount(finish.retries),
    costConfidence: price.confidence,
  };

  if (start.caseId) record.caseId = start.caseId;
  if (firstTokenAtMs !== null) record.timeToFirstTokenMs = Math.max(0, firstTokenAtMs - startedAtMs);
  if (finish.error) record.error = finish.error;
  return record;
}

/* ==================================================================== */
/* Wrapping a call                                                      */
/* ==================================================================== */

/**
 * Run a call inside a handle, so a throw cannot lose the record.
 *
 * The invariant this buys: every call that starts is recorded exactly once,
 * whatever path it leaves by. `run` is expected to settle the handle itself
 * (it is the only thing that knows the token counts); if it returns without
 * doing so, the call is still recorded — with zero tokens and a warning naming
 * the route, so it counts towards the latency profile and contributes nothing
 * to cost. Dropping it instead would quietly shrink the denominator of every
 * rate in this layer.
 *
 * The error is rethrown unchanged. This wrapper observes, it does not handle.
 */
export async function withCall<T>(
  start: CallStart,
  deps: RecorderDeps,
  run: (call: CallHandle) => Promise<T>,
): Promise<T> {
  const call = beginCall(start, deps);
  try {
    const result = await run(call);
    if (!call.settled) {
      warnOnce(
        `telemetry-unsettled:${formatRoute(start.provider, start.model)}`,
        `A call on ${formatRoute(start.provider, start.model)} finished without reporting usage — it is recorded with zero tokens, so it counts in the latency profile but not in cost.`,
      );
      await call.succeeded(ZERO_TOKENS);
    }
    return result;
  } catch (err) {
    if (!call.settled) await call.failed(err);
    throw err;
  }
}

/**
 * A recorder with its dependencies already bound.
 *
 * What an adapter constructed once at startup actually wants: the sink and the
 * clock are deployment facts, not per-call ones, and threading them through
 * every call site is how one of them ends up wired differently from the rest.
 */
export interface Recorder {
  begin(start: CallStart): CallHandle;
  run<T>(start: CallStart, fn: (call: CallHandle) => Promise<T>): Promise<T>;
}

export function createRecorder(deps: RecorderDeps = {}): Recorder {
  return {
    begin: start => beginCall(start, deps),
    run: (start, fn) => withCall(start, deps, fn),
  };
}

/* ==================================================================== */
/* Defensive helpers                                                    */
/* ==================================================================== */

/**
 * Read the clock, or fall back to the system one.
 *
 * An injected clock is caller-supplied code, and a telemetry layer that
 * inherits a bug from it — a throw, a `NaN`, a string — would break the run it
 * is meant to be observing. So the result is checked rather than trusted.
 */
function safeNow(clock: Clock): number {
  try {
    const t = clock.now();
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  } catch {
    /* falls through to the system clock */
  }
  warnOnce('telemetry-bad-clock', 'Injected telemetry clock returned no usable time — falling back to Date.now(). Durations from this process are unreliable.');
  return Date.now();
}

function safeId(start: CallStart, startedAtMs: number, newId: RecorderDeps['newId']): string {
  if (start.id) return start.id;
  if (newId) {
    try {
      const id = newId(start, startedAtMs);
      if (typeof id === 'string' && id.length > 0) return id;
    } catch {
      /* falls through to the built-in */
    }
    warnOnce('telemetry-bad-id', 'Injected telemetry id factory returned nothing usable — falling back to the built-in id.');
  }
  return mintId(startedAtMs);
}

/**
 * Pricing is configuration-driven and therefore fallible in ways this call
 * site cannot fix. An unpriceable call is still a call worth recording, so a
 * failure here degrades to "unknown cost" rather than losing the record.
 */
function safePrice(provider: ProviderId, model: string, tokens: TokenCounts) {
  try {
    return priceTokens(provider, model, tokens);
  } catch (err) {
    warnOnce(
      `telemetry-price-threw:${formatRoute(provider, model)}`,
      `Pricing ${formatRoute(provider, model)} threw (${(err as Error).message}) — the call is recorded with an unknown cost rather than dropped.`,
    );
    return { costUsd: 0, confidence: 'unavailable' as const, source: 'none' as const, route: formatRoute(provider, model) };
  }
}

/**
 * Token counts from a provider are wire data: a field can be missing, null, a
 * string, or negative. Anything unusable becomes zero, because a `NaN` here
 * propagates into every sum in the layer and a negative token count would
 * silently reduce a bill.
 */
function normaliseTokens(tokens: TokenCounts | undefined): TokenCounts {
  if (!tokens) return { ...ZERO_TOKENS };
  return {
    inputTokens: normaliseCount(tokens.inputTokens),
    outputTokens: normaliseCount(tokens.outputTokens),
    cacheReadTokens: normaliseCount(tokens.cacheReadTokens),
  };
}

function normaliseCount(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** A thrown thing, narrowed to something a panel can show. */
function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
