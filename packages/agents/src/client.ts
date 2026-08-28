import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentCapability,
  AgentKind,
  AgentRun,
  AgentUsage,
  CaseCostSummary,
  CostBreakdownEntry,
  ModelTier,
  ModelTierAssignment,
} from '@realytica/shared';
import { apiKeyFor, baseUrl, defaultProviderId, tierRoute } from './config';
import { warnOnce } from './warn';

export { warnOnce };
import { readEnv } from './env';

/**
 * The single place the Anthropic client, the model tiering and the pricing
 * table live.
 *
 * Realytica runs local-first and must keep working with no credentials at all —
 * the deterministic engine is the product's floor, and the agent layer is an
 * addition on top of it. So nothing here throws on a missing key: callers ask
 * `agentCapability()` first and the UI degrades honestly.
 *
 * Tiering exists because a single case runs a planner, up to seven agents and
 * a critic. On one frontier model, cost-per-case — not accuracy — becomes the
 * variable that decides what this can be sold for. Extraction, classification
 * and field normalisation are mechanical and do not improve on a bigger model;
 * judgment, adversarial checking and title-chain reasoning do. So the frontier
 * model is spent where being wrong is expensive, and nowhere else.
 */

/* ==================================================================== */
/* Tier assignment                                                       */
/* ==================================================================== */

/**
 * Which tier each agent runs on.
 *
 * Overridable per agent (see `tierFor`) because these are judgements about
 * where quality is the binding constraint, and a deployment that disagrees —
 * or that hits a bad extraction on a particular corpus of scans — should be
 * able to move one agent up without forking the code or collapsing every tier.
 *
 * `document_intelligence` is the one genuinely contested placement, and it is
 * deliberately left on `extraction`:
 *
 *   - It is the only agent whose output every other agent inherits. A misread
 *     area or khata number propagates into pathways, the diligence plan and
 *     the verdict, so the cost of an error here is not local.
 *   - But it is also the only agent whose errors are *caught*. Every field it
 *     emits carries a confidence and lands in the evidence ledger against the
 *     source document; the deterministic re-screen re-runs on what it changed;
 *     and the critic reads the result adversarially on the judgment tier. The
 *     expensive failure mode is a confident misread that nothing checks, and
 *     that is not the shape of this pipeline.
 *   - It is also by far the heaviest agent per case: it is the only one that
 *     puts whole scanned PDFs into the input, and it runs once per document
 *     rather than once per case. Tiering it is most of the saving; leaving it
 *     on the frontier model would make the rest of this change cosmetic.
 *
 * That is a trade, not a certainty. `REALYTICA_TIER_DOCUMENT_INTELLIGENCE=judgment`
 * reverses it for a deployment whose documents are worse than ours, and the
 * per-agent cost breakdown makes the price of reversing it visible.
 */
export const AGENT_TIERS: Record<AgentKind, ModelTier> = {
  /**
   * Reads search results into typed findings and judges whether each one is
   * about *this* parcel. Reasoning rather than extraction: the hard part is
   * not pulling fields out of a page, it is deciding that a court listing
   * naming a different Survey No. 42 is not evidence about this property.
   */
  property_discovery: 'reasoning',
  /** Reads scanned deeds and khata extracts and returns typed fields. See the note above. */
  document_intelligence: 'extraction',
  // Reads prose into typed particulars and writes a short reply. Mechanical,
  // and the highest-frequency agent here — one call per chat turn — so the
  // tier that fits the work is also the one that keeps a conversation from
  // costing more than the diligence. Move it with
  // REALYTICA_TIER_INTAKE_CONCIERGE if a deployment finds it reads thin.
  intake_concierge: 'extraction',

  /** Reads a case's shape and emits a task list. Structured, bounded, and its failure is already survivable — the orchestrator falls back to the fixed pipeline. */
  planner: 'reasoning',
  /** Maps each evidence gap onto routes from a supplied corpus. The corpus does the knowing; the model does the selecting. */
  proof_pathways: 'reasoning',
  /** Summarises web search results into locality findings. The search tool supplies the facts. */
  market_research: 'reasoning',
  /** Turns findings already on the case into actions and draft messages, none of which are sent automatically. */
  diligence_planner: 'reasoning',
  /** Open-ended web exploration, but bounded by explicit iteration and dollar budgets rather than by model quality. */
  explorer: 'reasoning',
  /** Never makes a model call of its own — it schedules the others. Tiered for completeness so the record cannot go stale. */
  orchestrator: 'reasoning',

  /** The adversarial check on everything above. A weak critic is worse than no critic: it launders unsupported claims as verified. */
  critic: 'judgment',
  /** Answers the user directly, in their words, about their own case. This is the output a buyer actually reads. */
  analyst_copilot: 'judgment',
  /** Title-chain reasoning: multi-party, multi-decade, and the place where a plausible-looking wrong answer costs the most. */
  title_graph: 'judgment',
};

/* ==================================================================== */
/* Tier → model                                                          */
/* ==================================================================== */

/**
 * Resolves a tier to the model id that will actually be sent.
 *
 * Delegates to `tierRoute` rather than reading the variables again. It used to
 * have its own copy of the tier table and its own env reads, which meant the
 * pricing comparison and the model shown in the UI could name a model no call
 * was made on — the two resolutions agreed only for as long as nobody edited
 * one of them.
 */
export function modelForTier(tier: ModelTier): string {
  return tierRoute(tier).model;
}

/**
 * The tier an agent runs on, after any per-agent override.
 *
 * `REALYTICA_TIER_<AGENT>` (e.g. `REALYTICA_TIER_DOCUMENT_INTELLIGENCE=judgment`)
 * moves a single agent between tiers. An unrecognised value is ignored rather
 * than throwing: a typo in a deployment env var must not take the agent layer
 * down, and the warning says exactly what was ignored.
 */
export function tierFor(agent: AgentKind): ModelTier {
  const raw = readEnv(`TIER_${agent.toUpperCase()}`);
  if (raw === 'extraction' || raw === 'reasoning' || raw === 'judgment') return raw;
  if (raw !== undefined && raw !== '') {
    warnOnce(
      `tier:${agent}:${raw}`,
      `Ignoring REALYTICA_TIER_${agent.toUpperCase()}="${raw}" — not one of extraction/reasoning/judgment. Using ${AGENT_TIERS[agent]}.`,
    );
  }
  return AGENT_TIERS[agent];
}

/** The model an agent will actually be called with. */
export function modelFor(agent: AgentKind): string {
  return modelForTier(tierFor(agent));
}

/** Every agent's tier and model, for the capability probe and the UI. */
export function modelTierAssignments(): ModelTierAssignment[] {
  return ALL_AGENTS.map(agent => {
    const tier = tierFor(agent);
    return { agent, tier, model: modelForTier(tier) };
  });
}

/**
 * The judgment-tier model, resolved once at module load.
 *
 * "What model is this deployment fronting", for a caller that has no agent in
 * hand. Every actual request goes through `modelFor(agent)`, which is
 * per-agent and reads env live.
 */
export const AGENT_MODEL = modelForTier('judgment');

/* ==================================================================== */
/* Requests                                                              */
/* ==================================================================== */

/**
 * Every request goes out with these. Adaptive thinking is the current API —
 * `budget_tokens` is rejected on Opus 5 — and the server-side fallback keeps a
 * safety decline from silently ending a run mid-diligence.
 *
 * The thinking config, betas and fallbacks are identical across tiers on
 * purpose: tiering is a decision about which model answers, not about which
 * of them is allowed to think or to be rescued from a refusal. A cheap model
 * that silently dies on a safety decline would cost more in re-runs than it
 * saved.
 */
export function baseRequestFor(agent: AgentKind) {
  return {
    model: modelFor(agent),
    thinking: { type: 'adaptive' as const },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
  };
}

/**
 * The pre-tiering constant, preserved so nothing outside this package breaks.
 * In-package callers use `baseRequestFor(agent)`; this is the judgment-tier
 * shape and is what an external caller with no agent in hand should get.
 */
export const BASE_REQUEST = {
  model: AGENT_MODEL,
  thinking: { type: 'adaptive' as const },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default' as const,
};

/* ==================================================================== */
/* Pricing                                                               */
/* ==================================================================== */

/**
 * Published rates per million tokens, used for the cost estimate shown to
 * users. Dated snapshots are listed alongside their alias because the tier
 * defaults pin a snapshot (`claude-haiku-4-5-20251001`) while an operator
 * overriding by env will usually type the alias.
 */
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

/** The most expensive rate we know, used as the deliberate fallback for an unpriced model. */
const FALLBACK_RATE_MODEL = 'claude-opus-5';


/**
 * The rate for a model id, or a loud fallback.
 *
 * An unknown id is a real possibility now that three env vars can each name a
 * model, and the two silent failure modes are both worse than a warning:
 * pricing at zero tells the user a run was free, and pricing at Opus while
 * saying nothing tells them tiering did not work. So this warns by name and
 * then prices at the most expensive rate we know — an over-estimate the user
 * can act on beats an under-estimate they cannot see.
 */
function rateFor(model: string): { input: number; output: number } {
  const known = RATES[model];
  if (known) return known;
  warnOnce(
    `rate:${model}`,
    `No published rate on file for model "${model}" — pricing it at ${FALLBACK_RATE_MODEL} rates, so the cost shown is an upper bound, not an estimate. Add it to RATES in packages/agents/src/client.ts.`,
  );
  return RATES[FALLBACK_RATE_MODEL];
}

/**
 * Prices a set of token counts against a specific model.
 *
 * Shared by `estimateUsage` and by the single-tier counterfactual in
 * `cost.ts` so the two cannot drift: the saving that justifies tiering has to
 * be computed with the same arithmetic as the bill it is compared against.
 */
export function priceTokensUsd(
  model: string,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens?: number },
): number {
  const rate = rateFor(model);
  // Cached reads bill at roughly a tenth of the input rate; a cache WRITE
  // bills at roughly 1.25x, which is what the later reads have to earn back.
  const usd =
    (tokens.inputTokens / 1_000_000) * rate.input +
    (tokens.cacheReadTokens / 1_000_000) * rate.input * 0.1 +
    ((tokens.cacheWriteTokens ?? 0) / 1_000_000) * rate.input * 1.25 +
    (tokens.outputTokens / 1_000_000) * rate.output;
  return Math.round(usd * 10000) / 10000;
}

/**
 * Costs one API response.
 *
 * `model` is required rather than read off a module-level constant: before
 * tiering there was only one model and the constant happened to be right;
 * with tiering it is wrong for every non-judgment agent, and the error runs
 * in the expensive direction — a Haiku extraction billed at Opus rates would
 * report five times its real cost and erase the saving on paper.
 */
export function estimateUsage(
  model: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): AgentUsage {
  // `cache_creation_input_tokens` is reported ALONGSIDE `input_tokens`, not
  // inside it, so dropping it does not merely lose detail — it loses the
  // charge entirely, and the turn that writes the cache reads as the cheapest
  // one in the run.
  const tokens = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
  return { ...tokens, estimatedCostUsd: priceTokensUsd(model, tokens) };
}

export function sumUsage(runs: (AgentUsage | undefined)[]): AgentUsage {
  return runs.filter((u): u is AgentUsage => u !== undefined).reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheWriteTokens: (acc.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0),
      estimatedCostUsd: Math.round((acc.estimatedCostUsd + u.estimatedCostUsd) * 10000) / 10000,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0 },
  );
}

/* ==================================================================== */
/* Cost rollup                                                           */
/* ==================================================================== */

const ZERO_USAGE: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Turns a case's agent runs into the number that decides what this can be
 * priced at.
 *
 * The saving is the entire argument for tiering, which is exactly why it is
 * computed conservatively. Two things this deliberately does not do:
 *
 *   - It does not invent token counts. `singleTierComparisonUsd` re-prices the
 *     tokens actually spent, at the judgment model's rates. A frontier model
 *     would in reality have produced somewhat different output lengths, and a
 *     comparison that guessed at that could be tuned to say anything. Holding
 *     the token counts fixed is the one counterfactual that cannot be.
 *   - It does not drop runs that were already on the judgment tier. They add
 *     an identical amount to both sides and so contribute zero saving, which
 *     is correct: excluding them would inflate the headline percentage.
 *
 * A deployment that overrides a tier upwards can make `savedUsd` negative.
 * It is left signed rather than clamped — "your overrides cost $0.20 more this
 * case" is information, and hiding it would make this number decorative.
 *
 * Rows are keyed by (agent, model, tier), not by run: document intelligence
 * runs once per document, and three scans are one line item, not three.
 */
export function summariseCost(runs: AgentRun[]): CaseCostSummary {
  const byKey = new Map<string, CostBreakdownEntry>();

  for (const run of runs) {
    // `tier` is optional on AgentRun — runs recorded before tiering, and the
    // orchestrator's synthesised failure runs, carry none. Falling back to the
    // static assignment attributes them to the tier they would have run on,
    // rather than dropping them out of the breakdown entirely.
    const tier = run.tier ?? AGENT_TIERS[run.agent];
    const usage = run.usage ?? ZERO_USAGE;
    const key = `${run.agent} ${run.model} ${tier}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.usage = sumUsage([existing.usage, usage]);
    } else {
      byKey.set(key, { agent: run.agent, model: run.model, tier, usage: { ...usage } });
    }
  }

  const perAgent = [...byKey.values()];
  const total = sumUsage(perAgent.map(e => e.usage));

  // Priced per row rather than off the summed totals, so the rounding happens
  // at the same granularity on both sides of the comparison. Otherwise the
  // "saving" quietly absorbs rounding drift and stops being reproducible from
  // the rows the user is shown.
  const judgmentModel = modelForTier('judgment');
  const singleTierComparisonUsd = round4(perAgent.reduce((acc, e) => acc + priceTokensUsd(judgmentModel, e.usage), 0));

  return {
    perAgent,
    total,
    singleTierComparisonUsd,
    savedUsd: round4(singleTierComparisonUsd - total.estimatedCostUsd),
  };
}

/* ==================================================================== */
/* Roster                                                                */
/* ==================================================================== */

/**
 * How each agent reaches a run.
 *
 * `enabledAgents` on the capability probe means "agents this deployment
 * permits a caller to ask for", which is not the same as "agents that exist".
 * Keeping those two ideas in one hand-maintained array is how `critic`,
 * `explorer` and `title_graph` fell off the list in the first place, so the
 * roster is now derived from a `Record<AgentKind, …>`: adding a kind to
 * `AgentKind` without classifying it here is a type error, not a silent
 * omission.
 */
type RosterPolicy =
  /** Offered to callers whenever the agent layer is available. */
  | 'offered'
  /** Offered only when web search is switched on — it reaches an external service. */
  | 'offered_with_web_search'
  /** Exists and is tiered, but is not something a caller picks: the orchestrator schedules it under its own rules. */
  | 'scheduled_by_orchestrator'
  /**
   * Runs outside a case entirely, so it is neither offered on a case nor
   * scheduled by the orchestrator.
   *
   * Added rather than filing the intake concierge under
   * `scheduled_by_orchestrator`, which would have compiled and been a lie: the
   * orchestrator never schedules it and there is no case for it to be
   * scheduled against. It runs before one exists.
   */
  | 'not_case_scoped';

/**
 * Deliberately reproduces today's effective roster rather than the roster a
 * complete list would imply.
 *
 * `resolvePlanningRoster` in `orchestrator.ts` builds its roster from
 * `capability.enabledAgents`, then adds `critic` unconditionally and
 * `explorer` only when web search is on AND the caller named it explicitly —
 * because the explorer is unbounded outbound web work that a default "run
 * agents" press must never start. Listing `explorer` as `offered` here would
 * put it into `capability.enabledAgents`, where the orchestrator's own filter
 * would pick it up and schedule it by default. That is a behaviour change, so
 * it is not made: both are `scheduled_by_orchestrator`, the orchestrator's
 * existing gating keeps working untouched, and the effective roster is
 * identical to before.
 *
 * `planner` runs on every orchestration and is never chosen, and `title_graph`
 * is scheduled by the graph builder, so neither belongs in a pick list either.
 * `orchestrator` stays `offered` purely because it always was: it is not
 * orchestrable and the roster filter drops it, but it is in the list the UI
 * renders today and removing it would change what that list shows.
 *
 * Declaration order is run order — `ALL_AGENTS` is `Object.keys` of this.
 */
const ROSTER_POLICY: Record<AgentKind, RosterPolicy> = {
  // Not scheduled by the orchestrator and not offered on a screen run: a
  // sweep costs money and sends identifiers outside, so it happens when a
  // person asks for it on a case whose disclosure level they chose.
  property_discovery: 'offered_with_web_search',
  orchestrator: 'offered',
  planner: 'scheduled_by_orchestrator',
  document_intelligence: 'offered',
  proof_pathways: 'offered',
  analyst_copilot: 'offered',
  market_research: 'offered_with_web_search',
  diligence_planner: 'offered',
  title_graph: 'scheduled_by_orchestrator',
  critic: 'scheduled_by_orchestrator',
  explorer: 'scheduled_by_orchestrator',
  intake_concierge: 'not_case_scoped',
};

/**
 * Every agent that exists, in run order.
 *
 * Derived from `ROSTER_POLICY` rather than written out again: the `Record<AgentKind, …>`
 * makes an unclassified new agent kind a compile error, and reading the keys
 * back means the list cannot disagree with the classification.
 */
export const ALL_AGENTS: AgentKind[] = Object.keys(ROSTER_POLICY) as AgentKind[];

/** The subset a caller may ask for, gated exactly as before tiering. */
function offeredAgents(webSearchEnabled: boolean): AgentKind[] {
  return ALL_AGENTS.filter(a => {
    const policy = ROSTER_POLICY[a];
    if (policy === 'offered') return true;
    if (policy === 'offered_with_web_search') return webSearchEnabled;
    return false;
  });
}

/* ==================================================================== */
/* Client & capability                                                   */
/* ==================================================================== */

let cached: Anthropic | null = null;

/**
 * An unset ANTHROPIC_API_KEY does not mean there are no credentials — the SDK
 * also resolves ANTHROPIC_AUTH_TOKEN and an `ant auth login` profile on disk.
 * So construct the client and let it resolve, rather than gating on the env var.
 */
export function getClient(): Anthropic | null {
  if (cached) return cached;
  if (readEnv('AGENTS_DISABLED') === '1') return null;
  try {
    /*
     * `apiKeyFor` resolves the one-key case (`REALYTICA_API_KEY`, when
     * Anthropic is the default provider) and the explicit
     * `REALYTICA_ANTHROPIC_API_KEY`. The bare `ANTHROPIC_API_KEY` is the SDK's
     * own and is left to it.
     *
     * Constructing bare when neither is set is what preserves the rest of the
     * SDK's chain — `ANTHROPIC_AUTH_TOKEN`, and an `ant auth login` profile on
     * disk, neither of which is an API key at all.
     */
    const override = apiKeyFor('anthropic');
    cached = override ? new Anthropic({ apiKey: override }) : new Anthropic();
    return cached;
  } catch {
    return null;
  }
}

/**
 * Whether anything can serve a call at all.
 *
 * Asked of the DEFAULT provider, not of Anthropic. A deployment pointed at a
 * gateway has no Anthropic key by design, and answering for Anthropic there
 * reported `no_credentials` on a perfectly configured install — the agent
 * layer would refuse every route while the endpoint it was told to use sat
 * there working.
 *
 * The gateway arm asks only for the endpoint: vLLM and Ollama routinely run
 * unauthenticated on a private network, so requiring a key would lock out two
 * of the endpoints this path exists to serve.
 */
function hasCredentials(): boolean {
  if (defaultProviderId() === 'openai_compatible') return baseUrl() !== undefined;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  // The prefixed and one-key spellings have to be recognised HERE too, or
  // setting one gives a working client behind a capability endpoint that still
  // says there are no credentials — the app would answer questions while
  // telling every screen it cannot.
  if (apiKeyFor('anthropic')) return true;
  // An `ant auth login` profile lives on disk; the SDK finds it without an env var.
  return process.env.ANTHROPIC_PROFILE !== undefined || readEnv('AGENTS_ASSUME_AUTH') === '1';
}

export function agentCapability(): AgentCapability {
  // Reported even when the layer is unavailable: "which model would have run"
  // is exactly what an operator staring at a disabled deployment wants to see.
  const tiers = modelTierAssignments();
  const model = modelForTier('judgment');
  if (readEnv('AGENTS_DISABLED') === '1') {
    return { available: false, reason: 'disabled', model, webSearchEnabled: false, enabledAgents: [], tiers };
  }
  if (!hasCredentials()) {
    return { available: false, reason: 'no_credentials', model, webSearchEnabled: false, enabledAgents: [], tiers };
  }
  // Web search sends locality and market terms to an external service, so it is
  // opt-in rather than on by default. Document contents never go near it.
  const webSearchEnabled = readEnv('AGENT_WEB_SEARCH') === '1';
  return {
    available: true,
    reason: 'ok',
    model,
    webSearchEnabled,
    enabledAgents: offeredAgents(webSearchEnabled),
    tiers,
  };
}

/** Narrows an unknown throw into a message worth showing a user. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic credentials rejected — check REALYTICA_API_KEY or run `ant auth login`.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API — try again shortly.';
  if (e instanceof Anthropic.BadRequestError) return `Request rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API — check network access.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
