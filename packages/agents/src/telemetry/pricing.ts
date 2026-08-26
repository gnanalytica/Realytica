/**
 * Pricing across providers.
 *
 * Before the provider port there was one vendor, one price list and one
 * question: what did this case cost. `client.ts` answers that for Anthropic
 * model ids and is still the authority for them. The moment a route can read
 * `openai_compatible:meta-llama/llama-3.3-70b-instruct`, that table stops
 * being complete — and an incomplete pricing table does not fail loudly, it
 * quietly reports a number.
 *
 * That is the failure this module is built against. The three questions this
 * telemetry layer exists to answer — what did this case cost, which route is
 * actually faster, which calls ran degraded — are all comparative. A route
 * priced at $0 wins the cost comparison outright, and a route priced at a
 * frontier vendor's rates loses it outright. Either way the answer is not
 * merely imprecise, it is *inverted*, and nothing on screen says so.
 *
 * So this module has exactly one rule: never invent a rate. A rate is either
 * published (Anthropic, via `client.ts`), declared by the operator
 * (`REALYTICA_PRICING`), or absent — and absent is a state that travels all the
 * way to the panel rather than collapsing into a zero.
 *
 * ## Where the numbers come from
 *
 * Anthropic rates are *not* restated here. `client.ts` owns them and this
 * module prices Anthropic tokens by calling its exported `priceTokensUsd`, so
 * a rate change lands in one file and cannot drift into a second. What is
 * mirrored below is the *key set* — which model ids `client.ts` actually has a
 * published rate for — because that is not exported and the confidence label
 * depends on it. See `ANTHROPIC_PRICED_MODELS` for why that mirror is safe in
 * the one direction it can be wrong.
 */

import type { AgentUsage, ProviderId } from '@realytica/shared';
import { priceTokensUsd, warnOnce } from '../client';
import { formatRoute, parseRoute } from '../routing';

/* ==================================================================== */
/* Shapes                                                                */
/* ==================================================================== */

/**
 * Token counts without the money.
 *
 * Derived from `AgentUsage` rather than declared independently: the token
 * fields are the provider's facts and the cost is our estimate over them, and
 * tying the two together means a change to the frozen contract shows up here
 * as a type error instead of a silent mismatch.
 */
export type TokenCounts = Omit<AgentUsage, 'estimatedCostUsd'>;

/** USD per million tokens. `cacheRead` is optional — see `DEFAULT_CACHE_READ_DISCOUNT`. */
export interface RateCard {
  input: number;
  output: number;
  /** Rate for cached input tokens. Defaults to a tenth of `input` when unstated. */
  cacheRead?: number;
}

/**
 * How much to trust a cost figure.
 *
 * Three states rather than a boolean because the middle one is real and is
 * already this codebase's policy: `client.ts` prices an unrecognised Anthropic
 * id at Opus rates deliberately, on the grounds that an over-estimate a user
 * can act on beats an under-estimate they cannot see. That reasoning holds
 * *within* one vendor's price list, where the fallback is at most a few times
 * too high. It does not hold across vendors — a 70B open-weights model billed
 * at frontier rates is out by two orders of magnitude — which is why the third
 * state exists instead of extending the fallback across the provider boundary.
 */
export type PriceConfidence =
  /** A rate is on file for this exact route: published, or declared by the operator. */
  | 'exact'
  /** No rate for this id, priced at the most expensive rate its own vendor charges. A ceiling, not an estimate. */
  | 'upper_bound'
  /** No rate, and no honest way to guess one. The cost is not zero — it is unknown. */
  | 'unavailable';

/** Where a rate came from. Recorded so a surprising cost is traceable to a source. */
export type PriceSource =
  | 'anthropic_published'
  | 'anthropic_ceiling'
  | 'operator_override'
  | 'operator_wildcard'
  | 'none';

export interface PriceResolution {
  /**
   * USD for the supplied tokens.
   *
   * **Zero when `confidence` is `unavailable`** — and that zero means "not
   * counted", never "free". Every consumer in this package pairs it with the
   * confidence and with `PricingCoverage`; a consumer that reads this field
   * alone will understate, which is why nothing in the aggregates does.
   */
  costUsd: number;
  confidence: PriceConfidence;
  source: PriceSource;
  /** `provider:model`, the key this was resolved for. */
  route: string;
  /** The rate used, when there was one. Absent for `unavailable`. */
  rate?: RateCard;
}

/* ==================================================================== */
/* Anthropic: keys mirrored, numbers never                               */
/* ==================================================================== */

/**
 * The model ids `client.ts` has a published rate for.
 *
 * This mirrors the *keys* of that module's private `RATES` and none of its
 * numbers. The numbers are reached through `priceTokensUsd`, so a repricing
 * happens in one place; this set only decides whether the resulting figure is
 * labelled `exact` or `upper_bound`.
 *
 * The mirror can go stale in exactly one direction, and it is the harmless
 * one. A model added to `RATES` but not added here is priced correctly — the
 * number comes from `RATES` either way — and merely labelled as a ceiling when
 * it is in fact exact: a true figure, under-claimed. The reverse (a rate this
 * set claims exists when it does not) cannot happen, because removing a model
 * from `RATES` makes `priceTokensUsd` warn by name on the very first call.
 *
 * Deriving this from `RATES` directly would be better and is not possible:
 * `RATES` is not exported, and this package may not edit `client.ts`.
 */
const ANTHROPIC_PRICED_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
]);

/**
 * What a cached input token costs, as a fraction of the input rate, when an
 * operator declares a rate without saying.
 *
 * Mirrors the assumption `priceTokensUsd` already makes for Anthropic, so a
 * cached read is not accounted for differently either side of the provider
 * boundary. Every major OpenAI-compatible gateway discounts cache reads by
 * roughly this much, but "roughly" is doing work in that sentence: an operator
 * who knows their gateway's real number states it as `cacheRead` and this
 * default never applies.
 */
export const DEFAULT_CACHE_READ_DISCOUNT = 0.1;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/* ==================================================================== */
/* Operator overrides                                                    */
/* ==================================================================== */

export const PRICING_ENV_VAR = 'REALYTICA_PRICING';

/**
 * Rates an operator declares for models this codebase cannot know.
 *
 * ```
 * REALYTICA_PRICING='{
 *   "openai_compatible:meta-llama/llama-3.3-70b-instruct": { "input": 0.6, "output": 0.6 },
 *   "openai_compatible:*": { "input": 0.9, "output": 0.9, "cacheRead": 0.09 }
 * }'
 * ```
 *
 * Keys use the same route syntax as `REALYTICA_MODEL_*` (`provider:model`, or a
 * bare model id meaning Anthropic), because an operator who has just written a
 * route into one variable should not have to learn a second spelling to price
 * it. Values are USD per million tokens.
 *
 * `provider:*` prices every model on that provider at one rate. That exists for
 * the deployment where it is actually true — a self-hosted vLLM or a fixed-rate
 * gateway — and it is checked only after an exact key, so one model can be
 * corrected without abandoning the blanket rate.
 *
 * An override outranks the built-in Anthropic table on purpose: a deployment on
 * negotiated or committed-use rates has a truer number than the public price
 * list, and being unable to say so would make its cost view permanently wrong
 * in a direction it cannot correct.
 *
 * Malformed input is dropped with a warning naming the offending key, never
 * thrown: a typo in a deployment variable must not take the agent layer down,
 * which is the same rule `tierFor` and `readRoute` already follow.
 */
function parseOverrides(raw: string): Map<string, RateCard> {
  const table = new Map<string, RateCard>();
  if (!raw.trim()) return table;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnOnce(
      `pricing-json:${raw}`,
      `Ignoring ${PRICING_ENV_VAR} — it is not valid JSON (${(err as Error).message}). ` +
        'Expected {"provider:model":{"input":<usd per million>,"output":<usd per million>}}.',
    );
    return table;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnOnce(
      `pricing-shape:${raw}`,
      `Ignoring ${PRICING_ENV_VAR} — expected a JSON object keyed by "provider:model", got ${
        Array.isArray(parsed) ? 'an array' : typeof parsed
      }.`,
    );
    return table;
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const route = parseRoute(key);
    if (!route) {
      warnOnce(
        `pricing-key:${key}`,
        `Ignoring ${PRICING_ENV_VAR} entry "${key}" — expected "model" or "provider:model" with provider one of anthropic/openai_compatible.`,
      );
      continue;
    }
    const card = readRateCard(value);
    if (!card) {
      warnOnce(
        `pricing-value:${key}`,
        `Ignoring ${PRICING_ENV_VAR} entry "${key}" — expected {"input":<number>,"output":<number>} in USD per million tokens, with an optional "cacheRead".`,
      );
      continue;
    }
    table.set(formatRoute(route.provider, route.model), card);
  }
  return table;
}

function readRateCard(value: unknown): RateCard | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const num = (n: unknown): number | null =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const input = num(v.input);
  const output = num(v.output);
  if (input === null || output === null) return null;
  // An explicitly supplied but unusable cacheRead is a mistake worth rejecting
  // the whole entry over: silently falling back to the default would price at
  // a rate the operator explicitly tried to replace.
  if (v.cacheRead === undefined) return { input, output };
  const cacheRead = num(v.cacheRead);
  if (cacheRead === null) return null;
  return { input, output, cacheRead };
}

/**
 * Parsed overrides for the current value of the environment variable.
 *
 * Keyed by the raw string rather than parsed once at module load, for the same
 * reason `modelForTier` reads `process.env` on every call: a process that sets
 * configuration late — a script, a test harness, a serverless handler that
 * resolves config before invoking — must see what it set. Re-parsing only when
 * the string actually changes keeps that free in the normal case.
 */
let overrideCache: { raw: string; table: Map<string, RateCard> } | null = null;

function overrideTable(): Map<string, RateCard> {
  const raw = process.env[PRICING_ENV_VAR] ?? '';
  if (overrideCache && overrideCache.raw === raw) return overrideCache.table;
  const table = parseOverrides(raw);
  overrideCache = { raw, table };
  return table;
}

/** Every route an operator has declared a rate for. For the observability panel. */
export function declaredPricingRoutes(): string[] {
  return [...overrideTable().keys()].sort();
}

/* ==================================================================== */
/* Resolution                                                            */
/* ==================================================================== */

/**
 * Prices token counts for one (provider, model), in resolution order:
 *
 *   1. an exact `REALYTICA_PRICING` entry for the route;
 *   2. a `provider:*` wildcard entry;
 *   3. Anthropic's published rates, via `client.ts`;
 *   4. nothing — the cost is unknown and says so.
 *
 * Step 3 inherits `client.ts`'s own fallback for an id it does not recognise:
 * it warns by name and prices at the most expensive Anthropic rate. This
 * module keeps that behaviour rather than overriding it — within one vendor a
 * ceiling is bounded and actionable — but labels the result `upper_bound` so a
 * reader is never shown a ceiling dressed as an estimate.
 *
 * Step 4 warns once naming the route, and returns `costUsd: 0` carrying
 * `confidence: 'unavailable'`. Zero is the only number that can be put in a
 * field typed `number`; what stops it from becoming a lie is that every
 * aggregate in this package reports the unpriced calls and their tokens
 * alongside the total. See `PricingCoverage`.
 */
export function priceTokens(provider: ProviderId, model: string, tokens: TokenCounts): PriceResolution {
  const route = formatRoute(provider, model);
  const overrides = overrideTable();

  const exact = overrides.get(route);
  if (exact) return applyRate(route, exact, tokens, 'exact', 'operator_override');

  const wildcard = overrides.get(formatRoute(provider, '*'));
  if (wildcard) return applyRate(route, wildcard, tokens, 'exact', 'operator_wildcard');

  if (provider === 'anthropic') {
    const known = ANTHROPIC_PRICED_MODELS.has(model);
    // `priceTokensUsd` owns the numbers, and warns by name itself when the id
    // is one it does not recognise — so there is no second warning here.
    const costUsd = priceTokensUsd(model, tokens);
    return {
      costUsd,
      confidence: known ? 'exact' : 'upper_bound',
      source: known ? 'anthropic_published' : 'anthropic_ceiling',
      route,
    };
  }

  warnOnce(
    `pricing:${route}`,
    `No rate on file for "${route}" — its calls are counted as UNPRICED, not as $0, so every cost total that includes them is a lower bound. ` +
      `Declare it: ${PRICING_ENV_VAR}='{"${route}":{"input":<usd per million>,"output":<usd per million>}}'.`,
  );
  return { costUsd: 0, confidence: 'unavailable', source: 'none', route };
}

function applyRate(
  route: string,
  rate: RateCard,
  tokens: TokenCounts,
  confidence: PriceConfidence,
  source: PriceSource,
): PriceResolution {
  const cacheReadRate = rate.cacheRead ?? rate.input * DEFAULT_CACHE_READ_DISCOUNT;
  const usd =
    (tokens.inputTokens / 1_000_000) * rate.input +
    (tokens.cacheReadTokens / 1_000_000) * cacheReadRate +
    (tokens.outputTokens / 1_000_000) * rate.output;
  return { costUsd: round4(usd), confidence, source, route, rate };
}

/**
 * Token counts plus their price, in the shape the frozen contract wants.
 *
 * `estimatedCostUsd` is a plain `number` in `AgentUsage` and that type is
 * frozen, so "unknown" cannot live inside it. The three alternatives were all
 * worse:
 *
 *   - `NaN` is honest at the point of production and poisonous everywhere
 *     else — one unpriced call turns every sum, mean and comparison it touches
 *     into `NaN`, and `JSON.stringify` writes it out as `null`, so the honesty
 *     does not even survive the round trip to the panel.
 *   - A negative sentinel (`-1`) is a number that sums, and the moment it does
 *     the total is not merely unknown but wrong in a direction nobody expects.
 *   - Pricing an unknown model at some vendor's rate is the inversion this
 *     module exists to prevent.
 *
 * So the number stays `0` and the uncertainty travels beside it — per call in
 * `RecordedLlmCall.costConfidence`, per view in `PricingCoverage`. The
 * invariant that makes that safe: nothing in this package reports a cost total
 * without also reporting how much of it could not be priced.
 */
export function pricedUsage(provider: ProviderId, model: string, tokens: TokenCounts): AgentUsage {
  return { ...tokens, estimatedCostUsd: priceTokens(provider, model, tokens).costUsd };
}

/** A sentence for the panel. Written for the person deciding whether to trust the number. */
export function describePriceConfidence(confidence: PriceConfidence): string {
  switch (confidence) {
    case 'exact':
      return 'Priced from a rate on file for this exact provider and model.';
    case 'upper_bound':
      return 'No published rate for this model id, so it is priced at the most expensive rate its own vendor charges. The figure is a ceiling, not an estimate.';
    case 'unavailable':
      return 'No rate on file for this provider and model, so these tokens are not counted at all. The total is a lower bound — declare a rate in REALYTICA_PRICING to include them.';
  }
}

/* ==================================================================== */
/* Coverage                                                              */
/* ==================================================================== */

/**
 * How much of a cost figure is actually known.
 *
 * This is the half of the answer that a bare `totalCostUsd` cannot carry, and
 * the reason a $0 in this system is never mistakable for "free". It rides
 * alongside every summary this package produces, and it names the routes —
 * because "$4.10 across 212 calls" and "$4.10 across 212 calls, 60 of them on
 * an unpriced route" are different claims, and only the second one is true.
 */
export interface PricingCoverage {
  /** The worst confidence in the set: `unavailable` if anything was unpriced, else `upper_bound` if anything was a ceiling. */
  confidence: PriceConfidence;
  pricedCalls: number;
  /** Calls priced at their vendor's ceiling rather than a published rate for the id. */
  upperBoundCalls: number;
  /** Calls contributing nothing to the total because no rate exists for them. */
  unpricedCalls: number;
  /** Routes in `upperBoundCalls`, sorted. */
  upperBoundRoutes: string[];
  /** Routes in `unpricedCalls`, sorted. Exactly what to put in `REALYTICA_PRICING`. */
  unpricedRoutes: string[];
  /** Tokens the total does not account for. Given so an operator can price them by hand. */
  unpricedTokens: TokenCounts;
  /** One line for a panel, true in every state including "everything is priced". */
  note: string;
}

export interface CoverageAccumulator {
  add(resolution: PriceResolution, tokens: TokenCounts): void;
  result(): PricingCoverage;
}

/**
 * Accumulates coverage while an aggregate is being built.
 *
 * A separate pass over the records would have to re-resolve every rate and
 * could therefore disagree with the totals it describes — which is precisely
 * the class of bug this whole module is about. Folding it into the same walk
 * makes disagreement impossible.
 */
export function createCoverageAccumulator(): CoverageAccumulator {
  let priced = 0;
  let ceiling = 0;
  let unpriced = 0;
  const ceilingRoutes = new Set<string>();
  const missingRoutes = new Set<string>();
  const unpricedTokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  return {
    add(resolution, tokens) {
      if (resolution.confidence === 'unavailable') {
        unpriced++;
        missingRoutes.add(resolution.route);
        unpricedTokens.inputTokens += tokens.inputTokens;
        unpricedTokens.outputTokens += tokens.outputTokens;
        unpricedTokens.cacheReadTokens += tokens.cacheReadTokens;
        return;
      }
      priced++;
      if (resolution.confidence === 'upper_bound') {
        ceiling++;
        ceilingRoutes.add(resolution.route);
      }
    },
    result(): PricingCoverage {
      const confidence: PriceConfidence =
        unpriced > 0 ? 'unavailable' : ceiling > 0 ? 'upper_bound' : 'exact';
      const unpricedRoutes = [...missingRoutes].sort();
      const upperBoundRoutes = [...ceilingRoutes].sort();
      const parts: string[] = [];
      if (unpriced > 0) {
        parts.push(
          `${unpriced} call${unpriced === 1 ? '' : 's'} on ${unpricedRoutes.join(', ')} could not be priced and are excluded — this total is a lower bound`,
        );
      }
      if (ceiling > 0) {
        parts.push(
          `${ceiling} call${ceiling === 1 ? '' : 's'} on ${upperBoundRoutes.join(', ')} are priced at their vendor's ceiling rate`,
        );
      }
      return {
        confidence,
        pricedCalls: priced,
        upperBoundCalls: ceiling,
        unpricedCalls: unpriced,
        upperBoundRoutes,
        unpricedRoutes,
        unpricedTokens,
        note: parts.length === 0 ? 'Every call priced from a rate on file.' : `${parts.join('; ')}.`,
      };
    },
  };
}
