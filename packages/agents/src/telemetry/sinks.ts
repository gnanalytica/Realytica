/**
 * Where records live, and the filter that reads them back.
 *
 * Two sinks, because there are two genuinely different requirements and one
 * implementation cannot serve both honestly:
 *
 *   - `MemoryTelemetrySink` — a bounded ring buffer for the running process.
 *     Free to write, wrong to rely on: it holds the last N calls and forgets
 *     everything before them, including on restart.
 *   - `PersistedTelemetrySink` — writes through an injected port on every
 *     record and does not resolve until that write is durable. Slower by
 *     construction, and the only one whose data survives the instance.
 *
 * Both satisfy the same interface, so a deployment moves between them by
 * changing one construction site. Neither ever rejects: a lost record is an
 * acceptable outcome, and a failed diligence run is not.
 */

import type { LlmCallRecord } from '@valytica/shared';
import { warnOnce } from '../client';
import {
  systemClock,
  type Clock,
  type OneOrMany,
  type TelemetryPersistence,
  type TelemetryQuery,
  type TelemetryRetention,
  type TelemetrySink,
} from './types';

/* ==================================================================== */
/* Query                                                                */
/* ==================================================================== */

/**
 * A filter value matches when it is absent (no constraint), equal, or a member
 * of the supplied list.
 *
 * An empty list counts as *no constraint* rather than "match nothing". A panel
 * whose user has just cleared the last chip out of a multi-select should show
 * everything again, not an empty table it looks broken.
 */
function matches<T>(filter: OneOrMany<T> | undefined, value: T | undefined): boolean {
  if (filter === undefined) return true;
  if (Array.isArray(filter)) {
    const list = filter as readonly T[];
    if (list.length === 0) return true;
    return value !== undefined && list.includes(value);
  }
  return value === (filter as T);
}

function timeOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t;
}

/** Does one record satisfy a filter? Exported because the shape is worth reusing. */
export function matchesQuery(record: LlmCallRecord, query: TelemetryQuery = {}): boolean {
  const started = timeOf(record.startedAt, 0);
  // `since` inclusive, `until` exclusive, so consecutive windows tile without
  // counting a call on the boundary twice.
  if (query.since !== undefined && started < timeOf(query.since, Number.NEGATIVE_INFINITY)) return false;
  if (query.until !== undefined && started >= timeOf(query.until, Number.POSITIVE_INFINITY)) return false;
  if (!matches(query.caseId, record.caseId)) return false;
  if (!matches(query.agent, record.agent)) return false;
  if (!matches(query.provider, record.provider)) return false;
  if (!matches(query.model, record.model)) return false;
  if (!matches(query.outcome, record.outcome)) return false;
  if (query.degradedOnly && (record.capabilityGaps?.length ?? 0) === 0) return false;
  return true;
}

/**
 * Filter, order newest first, then cap.
 *
 * The cap is applied last on purpose: `limit` means "the newest N of what
 * matched", and applying it before the sort would return an arbitrary N.
 */
export function applyQuery(records: readonly LlmCallRecord[], query: TelemetryQuery = {}): LlmCallRecord[] {
  const matched = records.filter(r => matchesQuery(r, query));
  matched.sort(
    (a, b) => timeOf(b.startedAt, 0) - timeOf(a.startedAt, 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  if (query.limit !== undefined && query.limit >= 0 && matched.length > query.limit) {
    return matched.slice(0, query.limit);
  }
  return matched;
}

/**
 * A defensive copy.
 *
 * The nested `usage` and `capabilityGaps` are copied too: handing back the
 * stored objects would let a caller's innocent `record.usage.estimatedCostUsd = 0`
 * rewrite the store's own history, and a telemetry store that can be edited by
 * the thing it is observing is not evidence of anything.
 */
function clone(record: LlmCallRecord): LlmCallRecord {
  return { ...record, usage: { ...record.usage }, capabilityGaps: [...(record.capabilityGaps ?? [])] };
}

/* ==================================================================== */
/* In-memory ring buffer                                                */
/* ==================================================================== */

/**
 * Records held for the lifetime of the process, bounded.
 *
 * Default 500 — a few hundred kilobytes, and several hours of a busy instance.
 */
export const DEFAULT_MEMORY_CAPACITY = 500;

/**
 * A fixed-size ring buffer.
 *
 * **What happens when it wraps**: the oldest record is overwritten and is gone.
 * Not flushed anywhere, not summarised first — gone, and counted in `dropped`
 * so a panel can say "last 500 of 3,180 calls" rather than implying the buffer
 * is the whole history.
 *
 * Dropping the oldest rather than refusing the newest is the only defensible
 * direction. This buffer's readers are asking about now — is the new route
 * slower, did that run degrade — and a store that filled up an hour ago and
 * has been rejecting writes since would answer that question with silence
 * while looking healthy. The cost is that it cannot answer anything about the
 * distant past, which is what the persisted sink is for.
 *
 * The allocation is made once at construction, so a long-running server's
 * memory footprint from telemetry is decided at startup and never grows.
 */
export class MemoryTelemetrySink implements TelemetrySink {
  readonly kind = 'memory' as const;
  readonly capacity: number;

  private readonly buffer: (LlmCallRecord | undefined)[];
  /** Index of the next slot to write. */
  private next = 0;
  private filled = 0;
  private droppedCount = 0;

  constructor(capacity: number = DEFAULT_MEMORY_CAPACITY) {
    // A zero or negative capacity would make every write a silent drop, which
    // looks exactly like a broken sink. One record is the smallest honest ring.
    this.capacity = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : DEFAULT_MEMORY_CAPACITY;
    this.buffer = new Array<LlmCallRecord | undefined>(this.capacity);
  }

  /** Records overwritten since construction. The count a panel needs to be honest about the window. */
  get dropped(): number {
    return this.droppedCount;
  }

  get size(): number {
    return this.filled;
  }

  async record(record: LlmCallRecord): Promise<void> {
    if (this.filled === this.capacity) this.droppedCount++;
    this.buffer[this.next] = clone(record);
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  async recordMany(records: readonly LlmCallRecord[]): Promise<void> {
    for (const record of records) await this.record(record);
  }

  /** Everything held, newest first. */
  snapshot(): LlmCallRecord[] {
    const out: LlmCallRecord[] = [];
    for (let i = 0; i < this.filled; i++) {
      // Walk backwards from the most recently written slot, wrapping.
      const index = (this.next - 1 - i + this.capacity * 2) % this.capacity;
      const record = this.buffer[index];
      if (record) out.push(clone(record));
    }
    return out;
  }

  async query(query: TelemetryQuery = {}): Promise<LlmCallRecord[]> {
    return applyQuery(this.snapshot(), query);
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.next = 0;
    this.filled = 0;
    this.droppedCount = 0;
  }
}

/* ==================================================================== */
/* Retention                                                            */
/* ==================================================================== */

const MS_PER_DAY = 86_400_000;

/**
 * What the persisted sink keeps.
 *
 * Telemetry is the highest-volume data this app produces and it shares one
 * JSON document with the case store — a document rewritten in full by every
 * unrelated case mutation. Unbounded, it would come to dominate that write.
 *
 * **The rule: the newest 500 records, and nothing older than 14 days.**
 *
 * 500 is set from the write it has to fit inside rather than from a guess
 * about volume: a record serialises to roughly 300-400 bytes, so the cap holds
 * telemetry's contribution to the store document to about 150-200 KB — visible
 * in a diff, irrelevant next to a case's own documents, and the same order as
 * the memory set already living there.
 *
 * 14 days is the useful life of the questions this store answers. "Is the new
 * route slower than the old one", "what did last week's cases cost", "did that
 * provider have a bad afternoon" are all asked within a fortnight of the
 * event; nothing asks them about last quarter.
 *
 * **The consequence, stated plainly**: retention is global and newest-first, so
 * a busy week can age out an older case's telemetry completely, and the
 * per-case cost view built from *these records* will then show that case as
 * having no calls. That is acceptable for one specific reason, and only that
 * reason: this is not the billing ledger. Each case keeps its own
 * `AgentRun.usage` forever, and `summariseCost` in `client.ts` answers "what
 * did this case cost" from that, untouched by anything here. This store is the
 * cross-provider observability window, and a window is allowed to be finite.
 *
 * A deployment that wants a longer one raises `maxRecords`, and should move
 * telemetry to its own blob before doing so by much — the same note
 * `StoreData.memory` already carries.
 */
export const DEFAULT_RETENTION: TelemetryRetention = {
  maxRecords: 500,
  maxAgeMs: 14 * MS_PER_DAY,
};

/**
 * Apply retention to a set of records.
 *
 * Returns newest-first, which is also the order the sink keeps internally and
 * the order every reader wants — so no view has to re-sort what it was given.
 *
 * A record whose `startedAt` cannot be parsed is treated as having happened
 * now: it survives the age rule and is bounded by the count rule instead.
 * Dropping it for being unreadable would let one malformed writer silently
 * delete its own evidence.
 */
export function applyRetention(
  records: readonly LlmCallRecord[],
  retention: TelemetryRetention,
  nowMs: number,
): LlmCallRecord[] {
  const cutoff = retention.maxAgeMs === undefined ? Number.NEGATIVE_INFINITY : nowMs - retention.maxAgeMs;
  const kept = records.filter(r => timeOf(r.startedAt, nowMs) >= cutoff);
  kept.sort((a, b) => timeOf(b.startedAt, nowMs) - timeOf(a.startedAt, nowMs) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const max = Number.isFinite(retention.maxRecords) && retention.maxRecords >= 0 ? Math.floor(retention.maxRecords) : DEFAULT_RETENTION.maxRecords;
  return kept.length > max ? kept.slice(0, max) : kept;
}

/* ==================================================================== */
/* Persisted sink                                                       */
/* ==================================================================== */

export interface PersistedTelemetrySinkOptions {
  /** Overrides the default retention rule, field by field. */
  retention?: Partial<TelemetryRetention>;
  /** Injected so the age rule is testable without waiting a fortnight. */
  clock?: Clock;
}

/**
 * A sink that writes through an injected port on every record.
 *
 * ## Durability
 *
 * No debouncing, no timers, no background flush — `record` resolves only once
 * the port's `save` has. Valytica runs on serverless, where the process can be
 * frozen the instant a response is sent, so a scheduled write there is a write
 * that never happens. This is the same rule `store.save()` and
 * `PersistedMemoryStore` already follow, for the same reason.
 *
 * ## Serialisation
 *
 * Concurrent writes are chained through a single queue, exactly as
 * `apps/api/src/storage/filesystem.ts` chains its temp-file-then-rename. Two
 * agents finishing at the same moment would otherwise both read the set, both
 * append, and the slower save would land last and erase the faster one's
 * record. The payload is snapshotted at *queue* time, not at run time, so each
 * caller's write carries the state its own record produced.
 *
 * `.then(run, run)` rather than `.then(run)` so one failed write does not wedge
 * every subsequent one behind a rejected promise.
 *
 * ## Cost
 *
 * Each record rewrites the whole retained set. That is bounded by the
 * retention rule and no worse than what the case store already does per
 * mutation, but it is why `recordMany` exists: an orchestration that made
 * eleven calls should make one durable write, not eleven.
 */
export class PersistedTelemetrySink implements TelemetrySink {
  readonly kind = 'persisted' as const;

  private readonly retention: TelemetryRetention;
  private readonly clock: Clock;
  /** Newest first, always — retention leaves it that way and readers expect it. */
  private records: LlmCallRecord[] = [];
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private evicted = 0;

  constructor(
    private readonly persistence: TelemetryPersistence,
    options: PersistedTelemetrySinkOptions = {},
  ) {
    this.retention = { ...DEFAULT_RETENTION, ...options.retention };
    this.clock = options.clock ?? systemClock;
  }

  /** Records dropped by the retention rule since this instance loaded. */
  get droppedByRetention(): number {
    return this.evicted;
  }

  /**
   * Load once, lazily.
   *
   * Lazy rather than in the constructor so wiring this up cannot make boot
   * order matter: the first record or query pays for the load, and an
   * unreadable store degrades to an empty one rather than taking the app down.
   */
  ready(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        let loaded: LlmCallRecord[] = [];
        try {
          loaded = (await this.persistence.load()) ?? [];
        } catch (err) {
          warnOnce(
            'telemetry-load-failed',
            `Could not load persisted telemetry, starting from empty: ${(err as Error).message}. Diligence output is unaffected.`,
          );
          loaded = [];
        }
        // Sorted and trimmed on the way in: a store written by an older build,
        // or merged from two instances, arrives in no particular order, and
        // every reader below assumes newest-first.
        this.records = applyRetention(loaded.filter(isUsable).map(clone), this.retention, this.now());
      })();
    }
    return this.loadPromise;
  }

  async record(record: LlmCallRecord): Promise<void> {
    await this.recordMany([record]);
  }

  async recordMany(records: readonly LlmCallRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
      await this.ready();
      const usable = records.filter(isUsable).map(clone);
      const before = this.records.length + usable.length;
      this.records = applyRetention([...usable, ...this.records], this.retention, this.now());
      this.evicted += Math.max(0, before - this.records.length);
      await this.persist();
    } catch (err) {
      // Telemetry never fails the run that produced it. The record is lost and
      // the warning says so; the case screening carries on.
      warnOnce(
        'telemetry-write-failed',
        `Could not persist telemetry: ${(err as Error).message}. Records are being dropped; diligence output is unaffected.`,
      );
    }
  }

  async query(query: TelemetryQuery = {}): Promise<LlmCallRecord[]> {
    try {
      await this.ready();
    } catch {
      return [];
    }
    return applyQuery(this.records, query);
  }

  /** Everything retained, newest first. */
  async snapshot(): Promise<LlmCallRecord[]> {
    await this.ready();
    return this.records.map(clone);
  }

  async clear(): Promise<void> {
    await this.ready();
    this.records = [];
    this.evicted = 0;
    await this.persist();
  }

  private now(): number {
    try {
      const t = this.clock.now();
      if (typeof t === 'number' && Number.isFinite(t)) return t;
    } catch {
      /* falls through */
    }
    return Date.now();
  }

  private persist(): Promise<void> {
    const payload = this.records.map(clone);
    const run = (): Promise<void> => this.persistence.save(payload);
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/**
 * The minimum a record needs to be worth keeping.
 *
 * Anything missing an id, a route or a start time cannot be queried, priced or
 * ordered — it would occupy a retention slot and answer no question. Checked on
 * the way in and on the way out of the port, because the store is shared with
 * other writers and other versions.
 */
function isUsable(record: LlmCallRecord | undefined | null): record is LlmCallRecord {
  return (
    !!record &&
    typeof record.id === 'string' &&
    typeof record.provider === 'string' &&
    typeof record.model === 'string' &&
    typeof record.startedAt === 'string'
  );
}

/* ==================================================================== */
/* Doing nothing, deliberately                                          */
/* ==================================================================== */

/**
 * A sink that discards everything.
 *
 * For a deployment with telemetry switched off, and for any call site that
 * would otherwise need a `sink ? sink.record(r) : undefined` branch. Having one
 * of these is how the branch stays out of the adapters.
 */
export class NoopTelemetrySink implements TelemetrySink {
  readonly kind = 'noop' as const;
  async record(): Promise<void> {
    /* deliberately nothing */
  }
  async recordMany(): Promise<void> {
    /* deliberately nothing */
  }
  async query(): Promise<LlmCallRecord[]> {
    return [];
  }
}

/* ==================================================================== */
/* Test port                                                            */
/* ==================================================================== */

export interface InMemoryTelemetryPersistence extends TelemetryPersistence {
  /** What the port currently holds — the durable side, not the sink's view. */
  readonly stored: LlmCallRecord[];
  /** Completed saves. Lets a test assert that a write actually happened. */
  readonly saveCount: number;
}

/**
 * A `TelemetryPersistence` backed by an array.
 *
 * Shipped rather than reinvented per test, and it copies on both sides: a port
 * that handed back the very objects the sink holds would make a reload test
 * pass even if nothing was ever serialised.
 */
export function createInMemoryTelemetryPersistence(seed: LlmCallRecord[] = []): InMemoryTelemetryPersistence {
  let records: LlmCallRecord[] = seed.map(clone);
  let saves = 0;
  return {
    async load() {
      return records.map(clone);
    },
    async save(next) {
      records = next.map(clone);
      saves++;
    },
    get stored() {
      return records.map(clone);
    },
    get saveCount() {
      return saves;
    },
  };
}
