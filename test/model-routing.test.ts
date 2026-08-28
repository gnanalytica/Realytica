/**
 * One key, one endpoint, one model per tier: what the environment has to say
 * to point this deployment somewhere.
 *
 * The setup surface is what is under test, not the provider. A misread
 * variable does not throw — routing warns and falls back rather than taking
 * the agent layer down — so every mistake in this area is silent by
 * construction. It shows up as a tier quietly running on a model the endpoint
 * does not serve, or as a correctly configured install reporting itself as
 * having no credentials.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { routeFor } from '../packages/agents/src/routing';
import { apiKey, baseUrl, modelForTier } from '../packages/agents/src/config';
import { agentCapability } from '../packages/agents/src/client';

const OWNED = [
  'REALYTICA_BASE_URL',
  'REALYTICA_API_KEY',
  'REALYTICA_MODEL_EXTRACTION',
  'REALYTICA_MODEL_REASONING',
  'REALYTICA_MODEL_JUDGMENT',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_PROFILE',
];

const saved = new Map(OWNED.map(name => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function only(env: Record<string, string>): void {
  for (const name of OWNED) delete process.env[name];
  Object.assign(process.env, env);
}

describe('a model name is a name, not a structure', () => {
  it('passes a plain Anthropic id through', () => {
    only({ REALYTICA_MODEL_JUDGMENT: 'claude-opus-5' });
    assert.equal(modelForTier('judgment'), 'claude-opus-5');
  });

  it('keeps slashes, which a proxy model name routinely has', () => {
    only({ REALYTICA_BASE_URL: 'http://localhost:4000', REALYTICA_MODEL_REASONING: 'meta-llama/llama-3.3-70b-instruct' });
    assert.equal(modelForTier('reasoning'), 'meta-llama/llama-3.3-70b-instruct');
  });

  it('keeps a colon, which an Ollama tag and an OpenRouter variant both use', () => {
    // Read as a provider prefix, these parsed as providers named "llama3.3"
    // and "anthropic/claude-sonnet-4.5", were rejected as malformed, and left
    // the tier silently on its default.
    only({ REALYTICA_BASE_URL: 'http://localhost:4000', REALYTICA_MODEL_EXTRACTION: 'llama3.3:70b' });
    assert.equal(modelForTier('extraction'), 'llama3.3:70b');
    only({ REALYTICA_BASE_URL: 'http://localhost:4000', REALYTICA_MODEL_EXTRACTION: 'anthropic/claude-sonnet-4.5:beta' });
    assert.equal(modelForTier('extraction'), 'anthropic/claude-sonnet-4.5:beta');
  });

  it('falls back per tier when nothing names one', () => {
    only({});
    assert.equal(modelForTier('extraction'), 'claude-haiku-4-5-20251001');
    assert.equal(modelForTier('judgment'), 'claude-opus-5');
  });
});

describe('an agent routes by its tier', () => {
  it('takes the model its tier points at', () => {
    only({ REALYTICA_BASE_URL: 'http://localhost:4000', REALYTICA_MODEL_EXTRACTION: 'gemini-flash' });
    const route = routeFor('document_intelligence');
    assert.equal(route.tier, 'extraction');
    assert.equal(route.model, 'gemini-flash');
  });

  it('does not claim to know which vendor answered', () => {
    // Behind a proxy the company serving a call is the proxy's business. The
    // route names the format, and the model name is as far as attribution goes.
    only({ REALYTICA_BASE_URL: 'http://localhost:4000' });
    assert.equal(routeFor('critic').provider, 'anthropic');
  });
});

describe('one endpoint, one key', () => {
  it('reads both', () => {
    only({ REALYTICA_BASE_URL: 'http://localhost:4000/', REALYTICA_API_KEY: 'sk-virtual' });
    assert.equal(baseUrl(), 'http://localhost:4000/');
    assert.equal(apiKey(), 'sk-virtual');
  });

  it('treats an empty value as unset, not as a configured blank', () => {
    only({ REALYTICA_API_KEY: '   ' });
    assert.equal(apiKey(), undefined);
  });
});

describe('the capability probe answers for the configured endpoint', () => {
  it('reports no credentials when nothing at all is set', () => {
    only({});
    assert.equal(agentCapability().available, false);
  });

  it('is available on a key alone', () => {
    only({ REALYTICA_API_KEY: 'sk-ant-one' });
    assert.equal(agentCapability().reason, 'ok');
  });

  it('is available on an unauthenticated local proxy', () => {
    // A proxy on a private network needs no key; demanding one would lock out
    // the deployment shape this path exists to serve.
    only({ REALYTICA_BASE_URL: 'http://127.0.0.1:4000' });
    assert.equal(agentCapability().available, true);
  });
});
