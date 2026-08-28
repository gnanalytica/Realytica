/**
 * Where model calls go, with what key, and on what model.
 *
 * Setting the agent layer up is one key and one model per tier. There is no
 * provider to choose, because choosing a vendor is not this codebase's job any
 * more — a gateway in front of it does that, and every call leaves here in
 * Anthropic's wire format regardless of which company ends up answering it.
 *
 *   REALYTICA_BASE_URL unset  → api.anthropic.com, nothing else to run
 *   REALYTICA_BASE_URL set    → a gateway speaking the same format (OpenRouter,
 *                               a self-hosted LiteLLM), which fans out to any
 *                               vendor it is configured for; the model names
 *                               are that gateway's own
 *
 * This module is the single place any of that is decided. It imports nothing
 * but `env` and `warn`, so every layer above — routing, the client, the
 * provider, the telemetry — can read from it without an import cycle, and
 * there is no second copy of the tier table to drift out of step.
 */

import type { ModelTier } from '@realytica/shared';
import { readEnv } from './env';
import { warnOnce } from './warn';

/* ==================================================================== */
/* Endpoint and credentials                                              */
/* ==================================================================== */

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out ? out : undefined;
}

/**
 * The proxy to send Anthropic-format calls to, or undefined for Anthropic
 * itself.
 *
 * A gateway that serves `/v1/messages` in this format and routes onward —
 * OpenRouter, or a self-hosted LiteLLM — keeps PDF input and prompt caching on
 * calls that end up at Gemini or DeepSeek. Measured, not assumed. What does NOT
 * survive the hop is verified citations, which only Claude returns; that is
 * detected per call rather than declared, because from here the vendor is
 * unknowable.
 */
export function baseUrl(): string | undefined {
  return trimmed(readEnv('BASE_URL'));
}

/**
 * The key.
 *
 * One, because there is one endpoint. With a proxy in front it is the virtual
 * key that proxy issued, and the vendor keys live in the proxy's own config
 * where its budgets and spend limits can see them.
 *
 * Undefined is a valid answer: a proxy on a private network may need no key at
 * all, and the Anthropic SDK resolves `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`
 * and an `ant auth login` profile without us.
 */
export function apiKey(): string | undefined {
  return trimmed(readEnv('API_KEY'));
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
 * Anthropic ids, because that is where an unconfigured deployment points. A
 * proxy uses its own names, so falling through to a default while pointed at
 * one is worth saying out loud rather than letting the operator discover it as
 * a 404 mid-run.
 */
export const TIER_DEFAULT_MODELS: Record<ModelTier, string> = {
  extraction: 'claude-haiku-4-5-20251001',
  reasoning: 'claude-sonnet-5',
  judgment: 'claude-opus-5',
};

/**
 * The model one tier points at.
 *
 * The single resolution of a tier to a model. It used to exist twice — once in
 * `routing.ts` for the provider port and once in `client.ts` for the pricing
 * and the UI — which meant the screen could name a model the call was not made
 * on.
 */
export function modelForTier(tier: ModelTier): string {
  const name = TIER_MODEL_ENV[tier];
  const configured = trimmed(readEnv(name.slice('REALYTICA_'.length)));
  if (configured) return configured;
  const fallback = TIER_DEFAULT_MODELS[tier];
  const proxy = baseUrl();
  if (proxy) {
    warnOnce(
      `model:default:${tier}`,
      `${name} is unset, so the ${tier} tier falls back to "${fallback}" against ${proxy}. `
        + 'Set it to a model name that proxy defines.',
    );
  }
  return fallback;
}
