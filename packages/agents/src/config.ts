/**
 * Which vendor this deployment talks to, and with what key.
 *
 * Setting the agent layer up should be three model names and one key. It used
 * to be two differently-named keys and a provider prefix on every model
 * string, which put the shape of our internal provider port into the operator's
 * environment for no benefit to them — the person configuring a deployment is
 * not choosing between our `LlmProvider` implementations, they are naming an
 * endpoint and three models.
 *
 * So the endpoint is what decides the provider:
 *
 *   REALYTICA_BASE_URL set    → every route defaults to the OpenAI-compatible
 *                               path, and the model strings are that gateway's
 *                               own ids (OpenRouter, LiteLLM, Groq, Together,
 *                               vLLM, Ollama, DeepSeek…)
 *   REALYTICA_BASE_URL unset  → Anthropic direct
 *
 * `provider:model` still works and still overrides, because a deployment that
 * uses a gateway for most work and Anthropic direct for document intelligence
 * is a real configuration and the only way to express it. It is an escape
 * hatch now rather than the common path.
 */

import type { ProviderId } from '@realytica/shared';
import { readEnv } from './env';

/** Every provider id, as values — `parseRoute` needs to recognise one in a string. */
export const PROVIDER_IDS = ['anthropic', 'openai_compatible'] as const;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out ? out : undefined;
}

/**
 * The OpenAI-compatible endpoint, or undefined when there is none.
 *
 * `REALYTICA_OPENAI_BASE_URL` is the older spelling and still read, so a
 * deployment already pointing at a gateway keeps working untouched.
 */
export function baseUrl(): string | undefined {
  return trimmed(readEnv('BASE_URL')) ?? trimmed(readEnv('OPENAI_BASE_URL'));
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
 * the default, because that is the endpoint it was issued by. A deployment
 * that routes *some* agents to a second vendor names that vendor's key
 * explicitly, and the explicit name always wins — otherwise pointing one agent
 * at Anthropic while running a gateway would send it the gateway's key.
 *
 * Returns undefined rather than empty for an endpoint that needs no key at
 * all; vLLM and Ollama routinely run unauthenticated on a private network.
 */
export function apiKeyFor(provider: ProviderId): string | undefined {
  const explicit = provider === 'anthropic'
    ? trimmed(readEnv('ANTHROPIC_API_KEY'))
    : trimmed(readEnv('OPENAI_API_KEY'));
  if (explicit) return explicit;
  if (provider === defaultProviderId()) return trimmed(readEnv('API_KEY'));
  return undefined;
}
