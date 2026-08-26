/**
 * Telemetry — contracts.
 *
 * One record type underpins every view in this layer. `LlmCallRecord` (frozen,
 * in `@valytica/shared`) is what a provider adapter emits per call; everything
 * else here is either the port that stores those records or the filter that
 * reads them back.
 *
 * Two properties are deliberate and load-bearing:
 *
 * - **Nothing in this layer may fail a diligence run.** Telemetry is a
 *   diagnostic. A sink that throws, a clock that misbehaves, a store that is
 *   full — none of those are reasons to lose a screening a user is waiting
 *   for. Every entry point here swallows its own failures and says so.
 * - **The clock is injected.** Durations and retention windows are the whole
 *   product of this layer, so a test that cannot control time cannot verify
 *   any of it. No pure function in this package reads a global clock.
 */

import type { AgentKind, LlmCallOutcome, LlmCallRecord, ProviderId } from '@valytica/shared';
import type { PriceConfidence } from './pricing';

/* ==================================================================== */
/* Time                                                                  */
/* ==================================================================== */

/**
 * Milliseconds since the epoch.
 *
 * An interface rather than a bare `() => number` so a caller reading a
 * parameter list can see what is being injected, and so a fake can carry extra
 * controls (see `createManualClock`) without changing any signature.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface ManualClock extends Clock {
  /** Move time forward. Negative values are allowed — a clock that steps backwards is a real thing to test. */
  advance(ms: number): void;
  set(ms: number): void;
}

/**
 * A clock a test drives by hand.
 *
 * Shipped rather than reinvented per test, because every duration, percentile
 * and retention assertion in this package depends on time being an input.
 */
export function createManualClock(startMs = 0): ManualClock {
  let t = startMs;
  return {
    now: () => t,
    advance: ms => {
      t += ms;
    },
    set: ms => {
      t = ms;
    },
  };
}

/* ==================================================================== */
/* Records                                                               */
/* ==================================================================== */

/**
 * An `LlmCallRecord` plus what this layer knows about the trustworthiness of
 * its cost.
 *
 * A strict superset of the frozen type, so it is assignable to `LlmCallRecord`
 * everywhere and nothing downstream has to know this type exists. The extra
 * field exists because `AgentUsage.estimatedCostUsd` is a plain `number` and
 * "unknown" has nowhere else to live — see the long note on `pricedUsage`.
 *
 * It is a convenience and an audit trail, never the source of truth: the
 * aggregates re-resolve pricing from `(provider, model)` rather than trusting
 * this field, so a record that has lost it in a round trip through an older
 * store still aggregates correctly.
 */
export interface RecordedLlmCall extends LlmCallRecord {
  costConfidence: PriceConfidence;
}

/* ==================================================================== */
/* Query                                                                 */
/* ==================================================================== */

/** A filter value: one, several, or unset meaning "any". */
export type OneOrMany<T> = T | readonly T[];

/**
 * What an observability panel asks for.
 *
 * Every field is optional and an absent field means "no constraint", so the
 * empty query is "everything, newest first" — the default a panel opens on.
 * Filters combine with AND; a field given several values matches any of them,
 * because "failures" means `refused` or `failed` and making a caller issue two
 * queries for that would be a worse interface.
 */
export interface TelemetryQuery {
  /** Inclusive lower bound on `startedAt`, ISO-8601. */
  since?: string;
  /** Exclusive upper bound on `startedAt`, ISO-8601. Exclusive so adjacent windows tile without double-counting. */
  until?: string;
  caseId?: OneOrMany<string>;
  agent?: OneOrMany<AgentKind>;
  provider?: OneOrMany<ProviderId>;
  model?: OneOrMany<string>;
  outcome?: OneOrMany<LlmCallOutcome>;
  /** Only calls that hit at least one capability gap — the "what ran degraded" view. */
  degradedOnly?: boolean;
  /** Cap on the number returned. Applied after ordering, so it always yields the newest N. */
  limit?: number;
}

/* ==================================================================== */
/* Sink                                                                  */
/* ==================================================================== */

/**
 * Where records go, and how they come back.
 *
 * Async on both sides even for the in-memory implementation, so a caller can
 * be moved from one sink to another without touching a line — including the
 * case that matters, an API handler that must `await` durability before it
 * returns a response.
 *
 * Neither method rejects. A sink that cannot store a record warns and drops
 * it; a sink that cannot read returns nothing. Losing telemetry is an
 * acceptable outcome, and failing a case screening because a write failed is
 * not.
 */
export interface TelemetrySink {
  /** Named in the boot log so it is obvious which backend is live. */
  readonly kind: 'memory' | 'persisted' | 'noop';
  /** Resolves once the record is as durable as this sink gets. */
  record(record: LlmCallRecord): Promise<void>;
  /** One durable write for a batch — a whole orchestration's calls in a single save. */
  recordMany(records: readonly LlmCallRecord[]): Promise<void>;
  /** Matching records, newest first. */
  query(query?: TelemetryQuery): Promise<LlmCallRecord[]>;
}

/**
 * The port a persisted sink writes through.
 *
 * Injected rather than imported so this package never depends on the API
 * layer, exactly as `MemoryPersistence` is: `apps/api` implements this over
 * its `StorageAdapter` — filesystem locally, Vercel Blob in deployment — and
 * hands it in. Nothing here knows whether it is talking to a disk, a blob
 * store or an array.
 */
export interface TelemetryPersistence {
  /** Everything currently stored. `[]` when nothing has been persisted yet. */
  load(): Promise<LlmCallRecord[]>;
  /** Replace the stored set. Must resolve only once the write is durable. */
  save(records: LlmCallRecord[]): Promise<void>;
}

/**
 * What a persisted sink is allowed to keep.
 *
 * Telemetry is the highest-volume thing this app produces — one record per
 * model call, several per agent, several agents per case — and it shares a
 * single JSON document with the case store. Unbounded, it would eventually
 * dominate that document, and the cost would be paid by every unrelated case
 * mutation, each of which rewrites the whole blob.
 */
export interface TelemetryRetention {
  /** Hard cap on stored records. The newest are kept. */
  maxRecords: number;
  /** Records older than this are dropped even when the cap is not reached. */
  maxAgeMs?: number;
}
