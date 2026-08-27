/**
 * Prompt caching: where the breakpoints land, and what a write costs.
 *
 * Two things are asserted, because getting either wrong is silently
 * expensive. First, the breakpoint has to sit BETWEEN the case corpus and the
 * question — caching is a prefix match, so a breakpoint after the question
 * caches nothing reusable and a corpus sharing a block with the question can
 * never be cached at all. Second, a cache WRITE has to be priced above a
 * plain input token: it costs ~1.25x, and a build that prices it at zero (or
 * drops it, which the API's separate `cache_creation_input_tokens` field
 * makes easy) reports the turn that pays for caching as the cheapest in the
 * run.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCompleteParams } from '../packages/agents/src/providers/anthropic';
import { estimateUsage, priceTokensUsd } from '../packages/agents/src/client';
import type { LlmRequest } from '../packages/agents/src/providers/types';

const MODEL = 'claude-sonnet-5';

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    agent: 'analyst_copilot',
    model: MODEL,
    maxTokens: 1000,
    system: [{ text: 'You are the analyst copilot.', cacheBreakpoint: true }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Case context: ...', cacheBreakpoint: true },
          { type: 'text', text: 'Question: is the khata clean?' },
        ],
      },
    ],
    ...overrides,
  };
}

type TextBlock = { type: string; text: string; cache_control?: { type: string } };

function userBlocks(params: Record<string, unknown>): TextBlock[] {
  const messages = params.messages as { role: string; content: TextBlock[] }[];
  return messages[0].content;
}

describe('cache breakpoints in a request', () => {
  it('marks a system block that asked for one', () => {
    const params = buildCompleteParams(request());
    const system = params.system as TextBlock[];
    assert.deepEqual(system[0].cache_control, { type: 'ephemeral' });
  });

  it('marks the corpus block and leaves the question unmarked', () => {
    const blocks = userBlocks(buildCompleteParams(request()));
    assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' });
    assert.equal(blocks[1].cache_control, undefined);
  });

  /*
   * The ordering IS the feature. Caching matches a prefix, so the corpus has
   * to come before the question — reversed, the cached prefix would end at a
   * sentence that changes every turn and the corpus behind it would be re-billed
   * in full on every call, which is exactly the state this replaced.
   */
  it('keeps the corpus ahead of the question', () => {
    const blocks = userBlocks(buildCompleteParams(request()));
    assert.ok(blocks[0].text.startsWith('Case context'));
    assert.ok(blocks[1].text.startsWith('Question:'));
  });

  it('does not mark a block that did not ask', () => {
    const params = buildCompleteParams(
      request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }] }),
    );
    assert.equal(userBlocks(params)[0].cache_control, undefined);
  });

  it('leaves a plain string message alone', () => {
    const params = buildCompleteParams(request({ messages: [{ role: 'user', content: 'hello' }] }));
    const messages = params.messages as { content: unknown }[];
    assert.equal(messages[0].content, 'hello');
  });
});

describe('what caching costs and saves', () => {
  it('reads a cache write out of its own usage field, not out of input_tokens', () => {
    const usage = estimateUsage(MODEL, {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
    });
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.cacheWriteTokens, 5000);
  });

  it('treats an absent cache-write field as zero rather than as an error', () => {
    const usage = estimateUsage(MODEL, { input_tokens: 100, output_tokens: 10 });
    assert.equal(usage.cacheWriteTokens, 0);
  });

  it('prices a write ABOVE a plain input token', () => {
    const write = priceTokensUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 });
    const plain = priceTokensUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 });
    assert.ok(write > plain, `a cache write (${write}) must cost more than plain input (${plain})`);
  });

  it('prices a read far below a plain input token', () => {
    const read = priceTokensUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    const plain = priceTokensUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 });
    assert.ok(read < plain / 5, `a cache read (${read}) must be a fraction of plain input (${plain})`);
  });

  /*
   * The whole economic case in one assertion. One write plus three reads of
   * the same corpus — a single copilot turn that goes four tool iterations —
   * has to beat sending it uncached four times, or the breakpoint is a
   * surcharge rather than a saving.
   */
  it('pays for itself once a written corpus is read three times', () => {
    const CORPUS = 20_000;
    const cached =
      priceTokensUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: CORPUS }) +
      priceTokensUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: CORPUS * 3 });
    const uncached = priceTokensUsd(MODEL, { inputTokens: CORPUS * 4, outputTokens: 0, cacheReadTokens: 0 });
    assert.ok(cached < uncached, `cached ${cached} should beat uncached ${uncached}`);
  });

  it('and a write that is never read is a loss — which is why placement matters', () => {
    const CORPUS = 20_000;
    const writeOnly = priceTokensUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: CORPUS });
    const uncached = priceTokensUsd(MODEL, { inputTokens: CORPUS, outputTokens: 0, cacheReadTokens: 0 });
    assert.ok(writeOnly > uncached);
  });
});
