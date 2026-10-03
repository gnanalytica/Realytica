/**
 * Records in, answers out.
 *
 * `LlmCallRecord[]` is the only input any of this takes, and the three
 * questions it exists to answer are the three that became unanswerable the
 * moment an agent could run on a provider nobody chose by hand:
 *
 *   - what did this case cost, across vendors, in one number;
 *   - which route is actually faster, on a statistic one slow call cannot move;
 *   - which calls ran degraded, as a rate rather than an anecdote.
 *
 * ## Costs are recomputed here, not read off the records
 *
 * A record stores the token counts (facts, from the provider) and a cost (our
 * estimate over them, made with whatever pricing table was loaded at the
 * time). Those age differently. Token counts are true forever; an estimate
 * made before an operator declared a rate for an open-weights model is not.
 *
 * So every total below is recomputed from the token counts through the current
 * pricing table. The consequence is deliberate and worth stating plainly:
 * declaring a missing rate today corrects every historical view, and a
 * summary's `totalCostUsd` can differ from the naive sum of
 * `record.usage.estimatedCostUsd` across the same records. The record keeps
 * what was believed at call time and remains the audit trail; the summary is a
 * view, and views are derived.
 *
 * The alternative — trusting the stored number — has one failure mode and it
 * is the one this whole layer is built against: a call recorded before its
 * rate existed carries `0`, and that `0` would sum into a total that says
 * nothing about it.
 */

import type {
  AgentUsage,
  LlmCallRecord,
  ProviderId,
  ProviderPerformance,
  TelemetrySummary,
} from '@realytica/shared';
import { sumUsage } from '../client';
import { formatRoute } from '../routing';
import {
  createCoverageAccumulator,
  priceTokens,
  type PriceConfidence,
  type PricingCoverage,
  type TokenCounts,
} from './pricing';
import { systemClock, type Clock } from './types';

/* ==================================================================== */
/* Views over the frozen shapes                                          */
/* ==================================================================== */

/**
 * A `ProviderPerformance` row that also says how much its cost can be trusted.
 *
 * Strict supersets of the frozen types, so a consumer typed against
 * `ProviderPerformance` or `TelemetrySummary` binds to these unchanged and a
 * panel that wants to render "unpriced" reads one extra field.
 */
export interface ProviderPerformanceRow extends ProviderPerformance {
  /**
   * Constant across the row: a row is one `(provider, model)` pair, and
   * pricing resolves on exactly that pair.
   */
  costConfidence: PriceConfidence;
}

export interface TelemetrySummaryView extends TelemetrySummary {
  byProvider: ProviderPerformanceRow[];
  /** What the total does and does not account for. Never omit this when showing `totalCostUsd`. */
  pricing: PricingCoverage;
}

export interface SummaryOptions {
  /** How many records `recentCalls` carries. A view, not the log. */
  recentLimit?: number;
  /** Used only to stamp the window when there are no records at all. */
  clock?: Clock;
}

const DEFAULT_RECENT_LIMIT = 50;

/* ==================================================================== */
/* Percentiles                                                          */
/* ==================================================================== */

/**
 * Nearest-rank percentile, inclusive.
 *
 * `p95` is the smallest observed duration that at least 95% of calls are less
 * than or equal to: index `ceil(p/100 x n) - 1` on the ascending sort. Median
 * is the same function at p50, which on an even-sized sample returns the lower
 * of the two middle values.
 *
 * The method is stated because the common ones disagree and the disagreement
 * is largest exactly where this layer lives. `numpy.percentile` and Excel's
 * `PERCENTILE.INC` interpolate linearly between neighbours; R offers nine
 * definitions. On a route with eleven calls — an ordinary afternoon here — the
 * interpolating methods return a duration no call actually took, and the
 * nearest-rank one returns a real measurement. For an operator asking "how
 * slow does this route get", a number some call really did take is the more
 * defensible answer, and it is reproducible by hand from the sorted list.
 *
 * The consequence to know: below twenty samples, nearest-rank p95 *is* the
 * maximum. That is honest rather than misleading — with eleven data points
 * there is no ninety-fifth percentile to speak of, and every other method is
 * dominated by that same single slowest call while looking as though it is
 * not.
 */
export function percentileNearestRank(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index];
}

/* ==================================================================== */
/* Small shared pieces                                                  */
/* ==================================================================== */

function tokensOf(record: LlmCallRecord): TokenCounts {
  const u = record.usage;
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cacheReadTokens: u?.cacheReadTokens ?? 0,
    cacheWriteTokens: u?.cacheWriteTokens ?? 0,
  };
}

function timeOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t;
}

/**
 * Newest first, by start time.
 *
 * Ties break on id so the order is total: two calls started in the same
 * millisecond — routine, since agents fan out — must not reorder between two
 * renders of the same data.
 */
export function sortNewestFirst<T extends LlmCallRecord>(records: readonly T[]): T[] {
  return [...records].sort(
    (a, b) => timeOf(b.startedAt, 0) - timeOf(a.startedAt, 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/* ==================================================================== */
/* Provider performance                                                 */
/* ==================================================================== */

/**
 * One row per `(provider, model)`, which is the unit a routing decision is
 * actually made in — "is Anthropic faster" is not a question anyone can act
 * on, "is `gemini-flash` faster than
 * `anthropic:claude-haiku-4-5-20251001` at the extraction tier" is.
 *
 * Failures and refusals are counted, and their durations are kept in the
 * latency statistics rather than filtered out. A call that timed out after
 * ninety seconds is ninety seconds a user waited, and a provider whose
 * failures are slow is materially worse than one whose failures are fast —
 * excluding them would hide precisely the behaviour that matters during an
 * incident.
 *
 * Rows come back ordered by call count, then by cost, then by route. Call
 * count leads because it is the one quantity that is always known: sorting on
 * cost first would sink an unpriced route — the very one an operator needs to
 * see — to the bottom of the table.
 */
export function providerPerformance(records: readonly LlmCallRecord[]): ProviderPerformanceRow[] {
  interface Bucket {
    provider: ProviderId;
    model: string;
    durations: number[];
    calls: number;
    failures: number;
    refusals: number;
    degraded: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    usages: AgentUsage[];
    confidence: PriceConfidence;
  }

  const buckets = new Map<string, Bucket>();

  for (const record of records) {
    const key = formatRoute(record.provider, record.model);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        provider: record.provider,
        model: record.model,
        durations: [],
        calls: 0,
        failures: 0,
        refusals: 0,
        degraded: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        usages: [],
        confidence: 'exact',
      };
      buckets.set(key, bucket);
    }

    const tokens = tokensOf(record);
    const price = priceTokens(record.provider, record.model, tokens);

    bucket.calls++;
    bucket.durations.push(Math.max(0, record.durationMs ?? 0));
    if (record.outcome === 'failed') bucket.failures++;
    if (record.outcome === 'refused') bucket.refusals++;
    if ((record.capabilityGaps?.length ?? 0) > 0) bucket.degraded++;
    bucket.inputTokens += tokens.inputTokens;
    bucket.cacheReadTokens += tokens.cacheReadTokens;
    bucket.cacheWriteTokens += tokens.cacheWriteTokens ?? 0;
    bucket.usages.push({ ...tokens, estimatedCostUsd: price.costUsd });
    bucket.confidence = price.confidence;
  }

  const rows: ProviderPerformanceRow[] = [...buckets.values()].map(bucket => {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    // Denominator is input + cached input. The two are disjoint in every
    // provider's accounting this app has met — Anthropic reports
    // `cache_read_input_tokens` separately from `input_tokens`, and
    // `priceTokensUsd` bills them at different rates — so "all input tokens"
    // is their sum, not `inputTokens` alone. Getting this wrong inflates the
    // rate towards 1 on a well-cached prompt and makes the metric useless for
    // deciding whether caching is working.
    const allInput = bucket.inputTokens + bucket.cacheReadTokens;
    return {
      provider: bucket.provider,
      model: bucket.model,
      calls: bucket.calls,
      failures: bucket.failures,
      refusals: bucket.refusals,
      totalUsage: sumUsage(bucket.usages),
      medianDurationMs: percentileNearestRank(sorted, 50),
      p95DurationMs: percentileNearestRank(sorted, 95),
      cacheHitRate: allInput === 0 ? 0 : round4(bucket.cacheReadTokens / allInput),
      degradedCallRate: bucket.calls === 0 ? 0 : round4(bucket.degraded / bucket.calls),
      costConfidence: bucket.confidence,
    };
  });

  return rows.sort(
    (a, b) =>
      b.calls - a.calls ||
      b.totalUsage.estimatedCostUsd - a.totalUsage.estimatedCostUsd ||
      (formatRoute(a.provider, a.model) < formatRoute(b.provider, b.model) ? -1 : 1),
  );
}

/* ==================================================================== */
/* Summary                                                              */
/* ==================================================================== */

/**
 * Everything an observability panel opens on.
 *
 * The window is described by the records themselves — first call started, last
 * call finished — rather than by the query that produced them, so a summary
 * over "the last 200 records" states the period those 200 actually span
 * instead of implying a period nobody asked for. With no records at all there
 * is nothing to describe, and the window collapses to the current instant.
 */
export function summariseTelemetry(
  records: readonly LlmCallRecord[],
  options: SummaryOptions = {},
): TelemetrySummaryView {
  const clock = options.clock ?? systemClock;
  const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;

  const coverage = createCoverageAccumulator();
  let totalCostUsd = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    const tokens = tokensOf(record);
    const price = priceTokens(record.provider, record.model, tokens);
    coverage.add(price, tokens);
    totalCostUsd += price.costUsd;

    // A record whose `startedAt` will not parse is counted in every other
    // statistic but is kept out of the window: one malformed timestamp would
    // otherwise report the observability panel as covering "since 1970".
    const started = timeOf(record.startedAt, Number.NaN);
    if (!Number.isFinite(started)) continue;
    if (started < earliest) earliest = started;
    const ended = started + Math.max(0, record.durationMs ?? 0);
    if (ended > latest) latest = ended;
  }

  // With no records — or none carrying a usable start time — there is no
  // window to describe, and it collapses to the current instant rather than to
  // an epoch nobody worked in.
  const described = Number.isFinite(earliest) && Number.isFinite(latest);
  const nowMs = described ? 0 : clockNow(clock);
  const windowStartedAt = new Date(described ? earliest : nowMs).toISOString();
  const windowEndedAt = new Date(described ? latest : nowMs).toISOString();

  return {
    windowStartedAt,
    windowEndedAt,
    callCount: records.length,
    totalCostUsd: round4(totalCostUsd),
    byProvider: providerPerformance(records),
    recentCalls: sortNewestFirst(records).slice(0, Math.max(0, recentLimit)),
    pricing: coverage.result(),
  };
}

function clockNow(clock: Clock): number {
  try {
    const t = clock.now();
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  } catch {
    /* falls through */
  }
  return Date.now();
}
