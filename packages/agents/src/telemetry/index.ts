/**
 * Telemetry: cost, performance and observability across providers.
 *
 * The agent layer used to be one vendor, one price list and one latency
 * profile, and three questions were answerable by looking. They stopped being
 * answerable the moment an agent could be routed anywhere:
 *
 *   - **What did this case cost?** Not "how many tokens" — how many rupees, on
 *     a route whose rate this codebase may never have seen.
 *   - **Which route is actually faster?** On a statistic that one ninety-second
 *     outlier cannot move, per `(provider, model)`, because that is the unit a
 *     routing decision is made in.
 *   - **What ran degraded?** Which calls asked for citations, or caching, or
 *     adaptive thinking, and did not get them — as a rate, not an anecdote.
 *
 * All three are answered from one record type, `LlmCallRecord`, which a
 * provider adapter emits per call and everything here aggregates. Keeping it
 * one flat provider-neutral shape is what lets records from two vendors sit in
 * the same table and be compared without a translation step.
 *
 * ## The rules this layer is built on
 *
 * - **Never invent a rate.** A route with no published or declared price is
 *   reported as unpriced, loudly, and its tokens are excluded from the total
 *   with the exclusion stated. A silent `$0` would win every cost comparison
 *   outright, which makes the answer not imprecise but inverted. See
 *   `pricing.ts`.
 * - **Never fail a run.** Telemetry is a diagnostic. Every entry point here
 *   swallows its own failures, warns once, and returns something usable.
 * - **Never read a global clock.** Durations, percentiles and retention are
 *   the entire product of this layer, so time is injected everywhere.
 *
 * ## Wiring
 *
 * `PersistedTelemetrySink` takes an injected `TelemetryPersistence` port so
 * this package never depends on the API layer, exactly as the memory store
 * does. `apps/api` implements that port over its `StorageAdapter` — filesystem
 * locally, Vercel Blob in deployment. `MemoryTelemetrySink` covers tests and
 * any deployment that wants the last few hundred calls and nothing durable;
 * `NoopTelemetrySink` covers telemetry switched off.
 *
 * This module is not re-exported from the package root: `src/index.ts` belongs
 * to the API-wiring change and adding `export * from './telemetry'` there is
 * that change's to make.
 */

export type {
  CoverageAccumulator,
  PriceConfidence,
  PriceResolution,
  PriceSource,
  PricingCoverage,
  RateCard,
  TokenCounts,
} from './pricing';
export {
  DEFAULT_CACHE_READ_DISCOUNT,
  PRICING_ENV_VAR,
  createCoverageAccumulator,
  declaredPricingRoutes,
  describePriceConfidence,
  priceTokens,
  pricedUsage,
} from './pricing';

export type {
  Clock,
  ManualClock,
  OneOrMany,
  RecordedLlmCall,
  TelemetryPersistence,
  TelemetryQuery,
  TelemetryRetention,
  TelemetrySink,
} from './types';
export { createManualClock, systemClock } from './types';

export type { CallFinish, CallHandle, CallStart, Recorder, RecorderDeps } from './recorder';
export { beginCall, createRecorder, withCall } from './recorder';

export type {
  CaseCostOptions,
  CaseCostView,
  ProviderPerformanceRow,
  SummaryOptions,
  TelemetrySummaryView,
} from './aggregate';
export {
  percentileNearestRank,
  providerPerformance,
  sortNewestFirst,
  summariseCaseCost,
  summariseTelemetry,
} from './aggregate';

export type { InMemoryTelemetryPersistence, PersistedTelemetrySinkOptions } from './sinks';
export {
  DEFAULT_MEMORY_CAPACITY,
  DEFAULT_RETENTION,
  MemoryTelemetrySink,
  NoopTelemetrySink,
  PersistedTelemetrySink,
  applyQuery,
  applyRetention,
  createInMemoryTelemetryPersistence,
  matchesQuery,
} from './sinks';
