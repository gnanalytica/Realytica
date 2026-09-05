/**
 * An error delivered with HTTP 200.
 *
 * Measured against OpenRouter, which answers a failed call this way:
 *
 *     http 200
 *     {"type":"error","error":{"message":"Upstream error from Nvidia: Service
 *      temporarily overloaded","error_type":"provider_unavailable"}}
 *
 * The SDK sees a 2xx and parses the body as a message, so nothing throws.
 * `content` is then undefined and the first thing that walks it fails with
 * `content is not iterable` — which is what a person asking a question about
 * their property actually saw. The endpoint had already said what was wrong,
 * in a sentence, and the code threw it away in favour of a TypeError.
 */

import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { assertAnswered } from '../packages/agents/src/providers/anthropic';
import { ProviderCallError } from '../packages/agents/src/providers/types';
import { endpointName, upstreamSaid } from '../packages/agents/src/client';

describe('a 200 that is really an error', () => {
  it('raises the reason the endpoint gave, not a TypeError three layers down', () => {
    const body = {
      type: 'error',
      error: { type: 'api_error', message: 'Upstream error from Nvidia: Service temporarily overloaded' },
      request_id: 'gen-1788650445',
    };
    assert.throws(
      () => assertAnswered(body, 'nvidia/nemotron-3-ultra-550b-a55b:free'),
      (e: unknown) => {
        assert.ok(e instanceof ProviderCallError);
        assert.match(e.message, /Service temporarily overloaded/, 'the upstream sentence is the only actionable part');
        assert.match(e.message, /nemotron/, 'and it names which model could not be reached');
        assert.equal(e.status, 502, 'a bad answer from upstream, whatever the transport claimed');
        return true;
      },
    );
  });

  it('refuses a body with no content at all rather than iterating undefined', () => {
    assert.throws(() => assertAnswered({ id: 'msg_1', role: 'assistant' }, 'some/model'), ProviderCallError);
    assert.throws(() => assertAnswered(null, 'some/model'), ProviderCallError);
  });

  it('lets a real message through untouched', () => {
    const message = { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello' }] };
    assert.equal(assertAnswered(message, 'some/model'), message);
  });

  it('lets an empty-but-present content array through, which is a real answer', () => {
    const message = { type: 'message', role: 'assistant', content: [] };
    assert.equal(assertAnswered(message, 'some/model'), message);
  });
});

describe('errors name the endpoint this deployment actually called', () => {
  const before = process.env.REALYTICA_BASE_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.REALYTICA_BASE_URL;
    else process.env.REALYTICA_BASE_URL = before;
  });

  it('names the gateway when one is in the base-URL seat', () => {
    process.env.REALYTICA_BASE_URL = 'https://openrouter.ai/api';
    const named = endpointName();
    assert.match(named, /openrouter\.ai/, 'sending an operator to the Anthropic dashboard for a Google pool limit wastes their time');
    assert.doesNotMatch(named, /Anthropic/);
  });

  it('still names Anthropic when nothing is in that seat', () => {
    delete process.env.REALYTICA_BASE_URL;
    assert.equal(endpointName(), 'the Anthropic API');
  });
});

describe('what the endpoint itself said', () => {
  it('carries the upstream remedy through, because it is the only actionable part', () => {
    const said = upstreamSaid({
      message: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own key',
    });
    assert.match(said, /rate-limited upstream/);
    assert.match(said, /add your own key/);
  });

  it('adds nothing when the endpoint said nothing', () => {
    assert.equal(upstreamSaid({}), '');
    assert.equal(upstreamSaid({ message: '   ' }), '');
  });

  it('trims a whole JSON body rather than pasting it into a chat turn', () => {
    const long = upstreamSaid({ message: 'x'.repeat(500) });
    assert.ok(long.length < 260, 'an error a person reads is a sentence, not a payload');
    assert.match(long, /…$/);
  });
});
