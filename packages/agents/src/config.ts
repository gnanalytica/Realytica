/**
 * Which vendor this deployment talks to, with what key, and on what model.
 *
 * Setting the agent layer up is one key, one endpoint, and one model per tier.
 * The endpoint is what decides the provider:
 *
 *   REALYTICA_BASE_URL set    → every route defaults to the OpenAI-compatible
 *                               path, and the model strings are that gateway's
 *                               own ids (OpenRouter, LiteLLM, Groq, Together,
 *                               vLLM, Ollama, DeepSeek…)
 *   REALYTICA_BASE_URL unset  → Anthropic direct
 *
 * That keeps the shape of our internal provider port out of the operator's
 * environment. Nobody configuring a deployment is choosing between our
 * `LlmProvider` implementations; they are naming an endpoint and three models.
 *
 * `provider:model` still overrides, because "most agents on a gateway, document
 * intelligence on Anthropic for its verified citations" is a real configuration
 * and the only way to express it. It is an escape hatch, not the common path.
 *
 * This module is the single place any of that is decided. It imports nothing
 * but `env`, so every layer above — routing, the client, the providers, the
 * telemetry — can read from it without an import cycle, and there is no second
 * copy of the tier table to drift out of step.
 */

import type { ModelTier, ProviderId } from '@realytica/shared';
import { readEnv } from './env';
import { warnOnce } from './warn';

/* ==================================================================== */
/* Endpoint and credentials                                              */
/* ==================================================================== */

/** Every provider id, as values — `parseRoute` needs to recognise one in a string. */
export const PROVIDER_IDS = ['anthropic', 'openai_compatible'] as const;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out ? out : undefined;
}

/** The OpenAI-compatible endpoint, or undefined when there is none. */
export function baseUrl(): string | undefined {
  return trimmed(readEnv('BASE_URL'));
}

/**
 * Where Anthropic-format calls go, when not to Anthropic.
 *
 * This is the LiteLLM seat. A LiteLLM proxy serves `/v1/messages` in
 * Anthropic's own format and routes it onward to any vendor it is configured
 * for, so pointing the Anthropic client here keeps the full capability set —
 * PDF input, verified document citations, prompt caching, adaptive thinking —
 * on calls that end up at Gemini or DeepSeek. The OpenAI-compatible format has
 * no field for a file or a citation, so the same models reached through
 * `REALYTICA_BASE_URL` cannot offer either.
 *
 * Separate from `baseUrl()` because they are different protocols at different
 * paths, and a deployment can legitimately set only one. With LiteLLM in front
 * you set only this one: the default provider stays `anthropic`, and LiteLLM
 * does the fanning out.
 */
export function anthropicBaseUrl(): string | undefined {
  return trimmed(readEnv('ANTHROPIC_BASE_URL'));
}

/**
 * The provider a bare model name means.
 *
 * Read at call time rather than captured at module load: the tests set and
 * clear these variables around individual assertions, and a cached answer
 * would make the second test in a file depend on the first.
 */
export function defaultProviderId(): ProviderId {
  return baseUrl() ? 'openai_compatible' : 'anthropic';
}

/**
 * The key for one provider.
 *
 * `REALYTICA_API_KEY` is the one-key case: it belongs to whichever provider is
 * the default, because that is the endpoint that issued it. A deployment that
 * routes *some* agents to Anthropic while running a gateway names
 * `REALYTICA_ANTHROPIC_API_KEY` explicitly, and the explicit name always wins —
 * otherwise that agent would be sent the gateway's key and get a 401.
 *
 * Returns undefined rather than empty for an endpoint that needs no key at
 * all; vLLM and Ollama routinely run unauthenticated on a private network.
 */
export function apiKeyFor(provider: ProviderId): string | undefined {
  if (provider === 'anthropic') {
    const explicit = trimmed(readEnv('ANTHROPIC_API_KEY'));
    if (explicit) return explicit;
  }
  if (provider === defaultProviderId()) return trimmed(readEnv('API_KEY'));
  return undefined;
}

/* ==================================================================== */
/* Route syntax                                                          */
/* ==================================================================== */

/**
 * A route is a model name, optionally prefixed with a provider.
 *
 * The bare form is the common path and means *the default provider*. So
 * pointing the deployment at a gateway is one variable and the three model
 * names are that gateway's own ids, with no prefix to repeat:
 *
 *   claude-opus-5
 *   meta-llama/llama-3.3-70b-instruct
 *   llama3.3:70b
 *
 * The prefix stays available for the one configuration that needs it — most
 * agents on a gateway, one on a vendor directly:
 *
 *   anthropic:claude-opus-5
 *   openai_compatible:deepseek/deepseek-chat
 *
 * A colon is only read as a prefix when what precedes it is a provider we
 * have. Ollama writes its tags `llama3.3:70b` and OpenRouter its variants
 * `anthropic/claude-sonnet-4.5:beta`; treating every colon as a provider
 * separator rejected both as malformed, silently, leaving the tier on its
 * default. The model half is otherwise passed through verbatim, slashes
 * included.
 */
export function parseRoute(raw: string): { provider: ProviderId; model: string } | null {
  const value = raw.trim();
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon > 0) {
    const prefix = value.slice(0, colon);
    const rest = value.slice(colon + 1).trim();
    if (isProviderId(prefix)) return rest ? { provider: prefix, model: rest } : null;
  }
  return { provider: defaultProviderId(), model: value };
}

export function formatRoute(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

/* ==================================================================== */
/* Tiers                                                                 */
/* ==================================================================== */

export const TIER_MODEL_ENV: Record<ModelTier, string> = {
  extraction: 'REALYTICA_MODEL_EXTRACTION',
  reasoning: 'REALYTICA_MODEL_REASONING',
  judgment: 'REALYTICA_MODEL_JUDGMENT',
};

/**
 * The model each tier runs when nothing names one.
 *
 * Anthropic ids, because that is the default provider. They are also valid
 * OpenRouter ids for the same models, which makes the commonest gateway work
 * unconfigured — but no other gateway serves these names, so falling through
 * to a default while pointed at one is worth saying out loud rather than
 * letting the operator discover it as a 404 mid-run. `routeFor` warns.
 */
export const TIER_DEFAULT_MODELS: Record<ModelTier, string> = {
  extraction: 'claude-haiku-4-5-20251001',
  reasoning: 'claude-sonnet-5',
  judgment: 'claude-opus-5',
};

/**
 * Where one tier points, before any per-agent override.
 *
 * The single resolution of a tier to a provider and model. It used to exist
 * twice — once in `routing.ts` for the provider port and once in `client.ts`
 * for the pricing and the UI — which meant the screen could name a model the
 * call was not made on.
 */
export function tierRoute(tier: ModelTier): { provider: ProviderId; model: string } {
  const name = TIER_MODEL_ENV[tier];
  const raw = readEnv(name.slice('REALYTICA_'.length));
  if (raw) {
    const parsed = parseRoute(raw);
    if (parsed) return parsed;
    // Warned rather than thrown: a typo in a deployment variable must not take
    // the agent layer down, and the warning names exactly what was dropped.
    warnOnce(`route:${name}:${raw}`, `Ignoring ${name}="${raw}" — expected a model name, optionally prefixed "anthropic:" or "openai_compatible:".`);
  }
  const provider = defaultProviderId();
  if (provider === 'openai_compatible') {
    warnOnce(
      `route:default:${tier}`,
      `${name} is unset, so the ${tier} tier falls back to "${TIER_DEFAULT_MODELS[tier]}" against ${baseUrl()}. `
        + 'Set it to a model id that endpoint serves.',
    );
  }
  return { provider, model: TIER_DEFAULT_MODELS[tier] };
}
