/**
 * Whose bill a model call lands on.
 *
 * The leak this closes was not an unguarded route. `/api/telemetry` was behind
 * `admin` and always had been — the records simply had no workspace on them,
 * so every workspace's admin read every workspace's spend, correctly
 * authorised and completely wrong.
 *
 * What is worth testing is the mechanism rather than the filter, because the
 * mechanism is the unusual part: nothing passes a workspace into a model call.
 * The API puts the signed-in principal into async-local storage for the life
 * of the request and the provider wrapper reads it, so a call made six frames
 * deep inside an agent is attributed without the agent knowing a workspace
 * exists. That is the composition asserted below — the real middleware helper,
 * the real wrapper, a stub provider standing in only for the network.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryTelemetrySink,
  instrument,
  setTelemetrySink,
  setTenantResolver,
} from '@realytica/agents';
import type { LlmProvider, LlmRequest, LlmResult } from '@realytica/agents';
import { currentTenantId, withPrincipal } from '../apps/api/src/auth/current';
import type { Principal } from '@realytica/shared';

const sink = new MemoryTelemetrySink();

const stub: LlmProvider = {
  id: 'anthropic',
  descriptor: () => ({ id: 'anthropic', label: 'stub', configured: true, models: [] }) as never,
  complete: async (): Promise<LlmResult> =>
    ({
      text: 'ok',
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, estimatedCostUsd: 0 },
      capabilityGaps: [],
      retries: 0,
      toolCalls: [],
    }) as unknown as LlmResult,
  runTools: async () => ({}) as unknown as LlmResult,
};

const provider = instrument(stub, 'anthropic');
const request = { agent: 'analyst_copilot', model: 'stub-1', maxTokens: 10, system: [], messages: [] } as unknown as LlmRequest;

function principal(tenantId: string): Principal {
  return { subject: `sub-${tenantId}`, email: `a@${tenantId}.test`, tenantId, role: 'owner' };
}

before(() => {
  setTelemetrySink(sink);
  setTenantResolver(currentTenantId);
});

after(() => {
  setTelemetrySink(null);
  setTenantResolver(null);
});

describe('a call made inside a request', () => {
  it('is billed to the workspace that made it, without being told', async () => {
    await withPrincipal(principal('tnt_one'), () => provider.complete(request));
    const [record] = await sink.query({ tenants: ['tnt_one'] });
    assert.equal(record?.tenantId, 'tnt_one');
  });

  it('follows the request across an await, which is the whole point', async () => {
    await withPrincipal(principal('tnt_two'), async () => {
      // Several frames and a turn of the event loop, the way a real agent
      // reaches a provider. A parameter would have had to survive all of it.
      await new Promise((r) => setTimeout(r, 1));
      await (async () => provider.complete(request))();
    });
    const [record] = await sink.query({ tenants: ['tnt_two'] });
    assert.equal(record?.tenantId, 'tnt_two');
  });

  it('does not leak into the next workspace’s call', async () => {
    const one = await sink.query({ tenants: ['tnt_one'] });
    assert.equal(one.length, 1, 'a later call was attributed to an earlier workspace');
  });
});

describe('a call made outside a request', () => {
  it('carries no workspace rather than the last one seen', async () => {
    // A warm-up probe, an evaluation harness, a script. Guessing here is how
    // a script's spend lands on whichever workspace happened to be last.
    await provider.complete(request);
    const orphans = await sink.query({ tenants: [null] });
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]?.tenantId, undefined);
  });
});

describe('the filter', () => {
  it('matches only what was asked for, and never everything by default', async () => {
    const all = await sink.query();
    assert.equal(all.length, 3, 'an unfiltered query is still every record — that is why no route issues one');
    assert.deepEqual((await sink.query({ tenants: ['tnt_two'] })).map((r) => r.tenantId), ['tnt_two']);
    assert.deepEqual(await sink.query({ tenants: [] }), []);
  });
});
