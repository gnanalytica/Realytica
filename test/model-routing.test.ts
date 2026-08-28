/**
 * One key, one model per tier: what the environment has to say to point this
 * deployment somewhere.
 *
 * The setup surface is the thing under test here, not the provider port. A
 * misread variable does not throw — routing deliberately warns and falls back
 * rather than taking the agent layer down — so every mistake in this area is
 * silent by construction. It shows up as a tier quietly running on the wrong
 * vendor's default model, or as a correctly configured install reporting
 * itself as having no credentials.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parseRoute, routeFor } from '../packages/agents/src/routing';
import { apiKeyFor, defaultProviderId } from '../packages/agents/src/config';
import { agentCapability } from '../packages/agents/src/client';

const OWNED = [
  'REALYTICA_BASE_URL',
  'REALYTICA_API_KEY',
  'REALYTICA_OPENAI_BASE_URL',
  'REALYTICA_OPENAI_API_KEY',
  'REALYTICA_ANTHROPIC_API_KEY',
  'REALYTICA_MODEL_EXTRACTION',
  'REALYTICA_MODEL_REASONING',
  'REALYTICA_MODEL_JUDGMENT',
  'REALYTICA_ROUTE_DOCUMENT_INTELLIGENCE',
  'REALYTICA_AGENT_MODEL',
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

describe('the default provider follows the endpoint', () => {
  it('is Anthropic when no base URL is set', () => {
    only({});
    assert.equal(defaultProviderId(), 'anthropic');
    assert.deepEqual(parseRoute('claude-opus-5'), { provider: 'anthropic', model: 'claude-opus-5' });
  });

  it('is the OpenAI-compatible path the moment a base URL appears', () => {
    only({ REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1' });
    assert.equal(defaultProviderId(), 'openai_compatible');
    // The point of the whole change: a gateway's model ids need no prefix.
    assert.deepEqual(parseRoute('meta-llama/llama-3.3-70b-instruct'), {
      provider: 'openai_compatible',
      model: 'meta-llama/llama-3.3-70b-instruct',
    });
  });

  it('still honours the older REALYTICA_OPENAI_BASE_URL spelling', () => {
    only({ REALYTICA_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1' });
    assert.equal(defaultProviderId(), 'openai_compatible');
  });
});

describe('a colon is a provider prefix only when it names a provider', () => {
  it('reads an explicit prefix and keeps the slashes in the model half', () => {
    only({});
    assert.deepEqual(parseRoute('openai_compatible:deepseek/deepseek-chat'), {
      provider: 'openai_compatible',
      model: 'deepseek/deepseek-chat',
    });
  });

  it("treats an Ollama tag as a model, not as a provider called 'llama3.3'", () => {
    // Rejecting this left the tier silently on its default model.
    only({ REALYTICA_BASE_URL: 'http://127.0.0.1:11434/v1' });
    assert.deepEqual(parseRoute('llama3.3:70b'), {
      provider: 'openai_compatible',
      model: 'llama3.3:70b',
    });
  });

  it('keeps an OpenRouter variant suffix intact', () => {
    only({ REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1' });
    assert.deepEqual(parseRoute('anthropic/claude-sonnet-4.5:beta'), {
      provider: 'openai_compatible',
      model: 'anthropic/claude-sonnet-4.5:beta',
    });
  });
});

describe('three model variables are the whole common path', () => {
  it('routes a tier by bare model name once an endpoint is set', () => {
    only({
      REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1',
      REALYTICA_MODEL_EXTRACTION: 'google/gemini-2.5-flash',
    });
    const route = routeFor('document_intelligence');
    assert.equal(route.provider, 'openai_compatible');
    assert.equal(route.model, 'google/gemini-2.5-flash');
    assert.equal(route.source, 'tier_env');
  });

  it('lets one agent go to a vendor directly while the rest use the gateway', () => {
    only({
      REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1',
      REALYTICA_MODEL_REASONING: 'meta-llama/llama-3.3-70b-instruct',
      REALYTICA_ROUTE_DOCUMENT_INTELLIGENCE: 'anthropic:claude-haiku-4-5-20251001',
    });
    assert.equal(routeFor('proof_pathways').provider, 'openai_compatible');
    const docs = routeFor('document_intelligence');
    assert.equal(docs.provider, 'anthropic');
    assert.equal(docs.source, 'agent_env');
  });
});

describe('one key belongs to whichever provider is the default', () => {
  it('serves Anthropic when there is no endpoint', () => {
    only({ REALYTICA_API_KEY: 'sk-ant-one' });
    assert.equal(apiKeyFor('anthropic'), 'sk-ant-one');
  });

  it('serves the gateway when there is one, and is not leaked to Anthropic', () => {
    // The gateway's key is not an Anthropic key; sending it to an agent
    // routed directly at Anthropic would be a guaranteed 401.
    only({ REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1', REALYTICA_API_KEY: 'sk-or-one' });
    assert.equal(apiKeyFor('openai_compatible'), 'sk-or-one');
    assert.equal(apiKeyFor('anthropic'), undefined);
  });

  it('lets an explicit per-provider key win, for the mixed deployment', () => {
    only({
      REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1',
      REALYTICA_API_KEY: 'sk-or-one',
      REALYTICA_ANTHROPIC_API_KEY: 'sk-ant-explicit',
    });
    assert.equal(apiKeyFor('anthropic'), 'sk-ant-explicit');
    assert.equal(apiKeyFor('openai_compatible'), 'sk-or-one');
  });
});

describe('the capability probe answers for the configured provider', () => {
  it('reports no credentials when nothing at all is set', () => {
    only({});
    assert.equal(agentCapability().available, false);
  });

  it('is available on a gateway with no Anthropic key anywhere', () => {
    // This reported `no_credentials` on a correctly configured install: the
    // probe asked Anthropic whether a deployment pointed at OpenRouter could run.
    only({ REALYTICA_BASE_URL: 'https://openrouter.ai/api/v1', REALYTICA_API_KEY: 'sk-or-one' });
    const capability = agentCapability();
    assert.equal(capability.available, true);
    assert.equal(capability.reason, 'ok');
  });

  it('is available on an unauthenticated local endpoint', () => {
    // vLLM and Ollama on a private network need no key; demanding one would
    // lock out two of the endpoints this path exists to serve.
    only({ REALYTICA_BASE_URL: 'http://127.0.0.1:11434/v1' });
    assert.equal(agentCapability().available, true);
  });
});
