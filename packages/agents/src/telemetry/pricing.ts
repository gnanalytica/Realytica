/**
 * Pricing across providers.
 *
 * Before the provider port there was one vendor, one price list and one
 * question: what did this case cost. `client.ts` answers that for Anthropic
 * model ids and is still the authority for them. The moment a route can read
 * a proxy's own model name, that table stops
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
import { warnOnce } from '../warn';
import { baseUrl } from '../config';

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
  /**
   * Rate for tokens written to the cache. Defaults to `CACHE_WRITE_MULTIPLIER`
   * times `input`, which is the published premium on every endpoint that
   * charges for a write at all. An endpoint that writes for free states
   * `cacheWrite: 0` rather than being assumed to.
   */
  cacheWrite?: number;
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
  /** The model name this was resolved for. */
  route: string;
  /** The rate used, when there was one. Absent for `unavailable`. */
  rate?: RateCard;
}

/* ==================================================================== */
/* Anthropic: keys mirrored, numbers never                               */
/* ==================================================================== */

/**
 * Published Anthropic rates, USD per million tokens.
 *
 * This lives with the rest of the pricing rather than beside the client,
 * because the question "what does this model cost" has exactly one answer and
 * had two implementations: the client priced every unknown id at the Anthropic
 * ceiling while this module reported it as unpriced, so the cost breakdown and
 * the telemetry disagreed about the same call. They now share `rateFor`.
 */
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

/** The most expensive rate we know, used as the deliberate ceiling for an unpriced Anthropic model. */
const FALLBACK_RATE_MODEL = 'claude-opus-5';

/**
 * The rate to bill a model at, and how much to trust it.
 *
 * The ceiling is only honest when we know the model is Anthropic's — pointed
 * straight at Anthropic, an id missing from `RATES` is a NEW Anthropic model
 * and Opus rates bound it. Behind a proxy the same id could be Gemini Flash,
 * where Opus rates over-report by a factor of fifty; that is not a ceiling, it
 * is a number nobody should act on. So there it is unpriced, and the warning
 * names `REALYTICA_PRICING`, which is the fix an operator can actually apply —
 * telling them to edit our source is no help for a model we have never heard of.
 */
function rateFor(model: string): { rate: RateCard; confidence: PriceConfidence; source: PriceSource } | null {
  const overrides = overrideTable();
  const exact = overrides.get(model);
  if (exact) return { rate: exact, confidence: 'exact', source: 'operator_override' };
  const wildcard = overrides.get('*');
  if (wildcard) return { rate: wildcard, confidence: 'exact', source: 'operator_wildcard' };

  const published = RATES[model];
  if (published) return { rate: published, confidence: 'exact', source: 'anthropic_published' };

  if (!baseUrl()) {
    warnOnce(
      `rate:${model}`,
      `No published rate on file for model "${model}" — pricing it at ${FALLBACK_RATE_MODEL} rates, so the cost shown is an upper bound, not an estimate.`,
    );
    return { rate: RATES[FALLBACK_RATE_MODEL], confidence: 'upper_bound', source: 'anthropic_ceiling' };
  }

  warnOnce(
    `rate:${model}`,
    `No rate on file for "${model}" — its calls are counted as UNPRICED, not as $0, so every cost total that includes them is a lower bound. ` +
      `Declare it: ${PRICING_ENV_VAR}='{"${model}":{"input":<usd per million>,"output":<usd per million>}}'.`,
  );
  return null;
}

/**
 * Prices a set of token counts against a specific model.
 *
 * Returns 0 for a model with no rate. That is a floor, not a claim — every
 * aggregate reports unpriced calls and their tokens alongside the total, and
 * `priceTokens` below carries the `unavailable` confidence that says so.
 */
export function priceTokensUsd(
  model: string,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens?: number },
): number {
  const resolved = rateFor(model);
  return resolved ? applyRateUsd(resolved.rate, tokens) : 0;
}

/** The arithmetic, shared so a repricing cannot land in one path and not the other. */
function applyRateUsd(
  rate: RateCard,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens?: number },
): number {
  const cacheRead = rate.cacheRead ?? rate.input * DEFAULT_CACHE_READ_DISCOUNT;
  return round4(
    (tokens.inputTokens / 1_000_000) * rate.input
    + (tokens.cacheReadTokens / 1_000_000) * cacheRead
    + ((tokens.cacheWriteTokens ?? 0) / 1_000_000) * rate.input * CACHE_WRITE_MULTIPLIER
    + (tokens.outputTokens / 1_000_000) * rate.output,
  );
}

/**
 * What a cached input token costs, as a fraction of the input rate, when an
 * operator declares a rate without saying.
 *
 * Mirrors the assumption `priceTokensUsd` already makes for Anthropic, so a
 * cached read is not accounted for differently either side of the provider
 * boundary. Every major gateway discounts cache reads by
 * roughly this much, but "roughly" is doing work in that sentence: an operator
 * who knows their gateway's real number states it as `cacheRead` and this
 * default never applies.
 */
export const DEFAULT_CACHE_READ_DISCOUNT = 0.1;

/**
 * What a cache WRITE costs, as a multiple of the input rate.
 *
 * A write is more expensive than an ordinary input token, not less — the
 * saving is entirely in the reads that follow it. Assuming otherwise would
 * make a route that writes a cache and never reads it look like a saving when
 * it is a 25% surcharge.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;

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
 *   "gemini-flash": { "input": 0.075, "output": 0.3 },
 *   "*": { "input": 0.9, "output": 0.9, "cacheRead": 0.09 }
 * }'
 * ```
 *
 * Keys are model names, spelled exactly as `REALYTICA_MODEL_*` spells them —
 * an operator who has just named a model in one variable should not have to
 * learn a second spelling to price it. Values are USD per million tokens.
 *
 * `*` prices every model at one rate. That exists for the deployment where it
 * is actually true — a self-hosted vLLM, or a fixed-rate gateway — and it is
 * checked only after an exact key, so one model can be corrected without
 * abandoning the blanket rate.
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
        'Expected {"<model>":{"input":<usd per million>,"output":<usd per million>}}.',
    );
    return table;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnOnce(
      `pricing-shape:${raw}`,
      `Ignoring ${PRICING_ENV_VAR} — expected a JSON object keyed by model name, got ${
        Array.isArray(parsed) ? 'an array' : typeof parsed
      }.`,
    );
    return table;
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const model = key.trim();
    if (!model) {
      warnOnce(`pricing-key:${key}`, `Ignoring an empty ${PRICING_ENV_VAR} key — expected a model name.`);
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
    table.set(model, card);
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
 * Prices token counts for one model, in resolution order:
 *
 *   1. an exact `REALYTICA_PRICING` entry for the model;
 *   2. the `*` wildcard entry;
 *   3. Anthropic's published rates, via `client.ts`;
 *   4. nothing — the cost is unknown and says so.
 *
 * Step 3 depends on whether a proxy is configured, and that distinction is
 * load-bearing. Pointed straight at Anthropic, every model IS an Anthropic
 * model, so an id not in the table is a NEW Anthropic model and the most
 * expensive Anthropic rate is a bounded, actionable ceiling — labelled
 * `upper_bound` so nobody is shown a ceiling dressed as an estimate. Behind a
 * proxy the same id could be anything, and pricing a Gemini Flash call at
 * Opus rates is not a ceiling, it is a fiction fifty times the truth. So there
 * it falls to step 4.
 *
 * Step 4 warns once naming the model, and returns `costUsd: 0` carrying
 * `confidence: 'unavailable'`. Zero is the only number that can be put in a
 * field typed `number`; what stops it from becoming a lie is that every
 * aggregate in this package reports the unpriced calls and their tokens
 * alongside the total. See `PricingCoverage`.
 */
export function priceTokens(_provider: ProviderId, model: string, tokens: TokenCounts): PriceResolution {
  const resolved = rateFor(model);
  if (!resolved) return { costUsd: 0, confidence: 'unavailable', source: 'none', route: model };
  return {
    costUsd: applyRateUsd(resolved.rate, tokens),
    confidence: resolved.confidence,
    source: resolved.source,
    route: model,
  };
}

function applyRate(
  route: string,
  rate: RateCard,
  tokens: TokenCounts,
  confidence: PriceConfidence,
  source: PriceSource,
): PriceResolution {
  const cacheReadRate = rate.cacheRead ?? rate.input * DEFAULT_CACHE_READ_DISCOUNT;
  const cacheWriteRate = rate.cacheWrite ?? rate.input * CACHE_WRITE_MULTIPLIER;
  const usd =
    (tokens.inputTokens / 1_000_000) * rate.input +
    (tokens.cacheReadTokens / 1_000_000) * cacheReadRate +
    ((tokens.cacheWriteTokens ?? 0) / 1_000_000) * cacheWriteRate +
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
