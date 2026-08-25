import Anthropic from '@anthropic-ai/sdk';
import type { AgentCapability, AgentKind, AgentUsage } from '@valytica/shared';

/**
 * The single place the Anthropic client is constructed.
 *
 * Valytica runs local-first and must keep working with no credentials at all —
 * the deterministic engine is the product's floor, and the agent layer is an
 * addition on top of it. So nothing here throws on a missing key: callers ask
 * `agentCapability()` first and the UI degrades honestly.
 */

/** Opus 5 unless the deployment overrides it. */
export const AGENT_MODEL = process.env.VALYTICA_AGENT_MODEL ?? 'claude-opus-5';

/** Published rates per million tokens, used for the cost estimate shown to users. */
const RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const ALL_AGENTS: AgentKind[] = [
  'orchestrator',
  'document_intelligence',
  'proof_pathways',
  'analyst_copilot',
  'market_research',
  'diligence_planner',
];

let cached: Anthropic | null = null;

/**
 * An unset ANTHROPIC_API_KEY does not mean there are no credentials — the SDK
 * also resolves ANTHROPIC_AUTH_TOKEN and an `ant auth login` profile on disk.
 * So construct the client and let it resolve, rather than gating on the env var.
 */
export function getClient(): Anthropic | null {
  if (cached) return cached;
  if (process.env.VALYTICA_AGENTS_DISABLED === '1') return null;
  try {
    cached = new Anthropic();
    return cached;
  } catch {
    return null;
  }
}

function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  // An `ant auth login` profile lives on disk; the SDK finds it without an env var.
  return process.env.ANTHROPIC_PROFILE !== undefined || process.env.VALYTICA_AGENTS_ASSUME_AUTH === '1';
}

export function agentCapability(): AgentCapability {
  if (process.env.VALYTICA_AGENTS_DISABLED === '1') {
    return { available: false, reason: 'disabled', model: AGENT_MODEL, webSearchEnabled: false, enabledAgents: [] };
  }
  if (!hasCredentials()) {
    return { available: false, reason: 'no_credentials', model: AGENT_MODEL, webSearchEnabled: false, enabledAgents: [] };
  }
  // Web search sends locality and market terms to an external service, so it is
  // opt-in rather than on by default. Document contents never go near it.
  const webSearchEnabled = process.env.VALYTICA_AGENT_WEB_SEARCH === '1';
  return {
    available: true,
    reason: 'ok',
    model: AGENT_MODEL,
    webSearchEnabled,
    enabledAgents: webSearchEnabled ? ALL_AGENTS : ALL_AGENTS.filter(a => a !== 'market_research'),
  };
}

/**
 * Every request goes out with these. Adaptive thinking is the current API —
 * `budget_tokens` is rejected on Opus 5 — and the server-side fallback keeps a
 * safety decline from silently ending a run mid-diligence.
 */
export const BASE_REQUEST = {
  model: AGENT_MODEL,
  thinking: { type: 'adaptive' as const },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default' as const,
};

/*
 * Note on casts at the call sites.
 *
 * `@anthropic-ai/sdk` 0.71.2 ships types that predate two things this code
 * relies on: `thinking: {type: "adaptive"}` (the types know only
 * `enabled`/`disabled`) and the `fallbacks` parameter. Both are accepted at
 * runtime — `BASE_REQUEST` above is correct for the live API.
 *
 * Each agent therefore casts once, at its own call site. That is deliberate
 * rather than untidy: the four call shapes here are genuinely different types
 * (tool-runner params, stream params, create params, a tool union), so a single
 * shared helper would have to widen to something meaningless to cover them all.
 * A narrow cast to the right type at each site keeps the rest of the params
 * type-checked. Remove them when the SDK types catch up.
 */

export function estimateUsage(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): AgentUsage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const rate = RATES[AGENT_MODEL] ?? RATES['claude-opus-5'];
  // Cached reads bill at roughly a tenth of the input rate.
  const estimatedCostUsd =
    (input / 1_000_000) * rate.input + (cacheRead / 1_000_000) * rate.input * 0.1 + (output / 1_000_000) * rate.output;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

export function sumUsage(runs: (AgentUsage | undefined)[]): AgentUsage {
  return runs.filter((u): u is AgentUsage => u !== undefined).reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      estimatedCostUsd: Math.round((acc.estimatedCostUsd + u.estimatedCostUsd) * 10000) / 10000,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 },
  );
}

/** Narrows an unknown throw into a message worth showing a user. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic credentials rejected — check ANTHROPIC_API_KEY or run `ant auth login`.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API — try again shortly.';
  if (e instanceof Anthropic.BadRequestError) return `Request rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API — check network access.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
