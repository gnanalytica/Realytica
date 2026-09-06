/**
 * A server-hosted tool that did not run.
 *
 * Measured against OpenRouter with this deployment's own key. A request
 * carrying Anthropic's `web_search` server tool is accepted with HTTP 200, no
 * error and no warning — and the tool is dropped. The model then says, in
 * prose:
 *
 *     "I don't have a web search tool available in this conversation — only
 *      the tools listed at the start of our chat, and none of them are a web
 *      search function."
 *
 * `usage.server_tool_use` was null and no server-tool block appeared. Market
 * research, property discovery and exploration exist to bring in facts from
 * outside the case file; with the tool gone they were about to file that reply
 * as research.
 *
 * The declaration cannot catch this — `serverWebSearch` is true of the wire
 * format, and behind a gateway the vendor is unknowable. So it is read off the
 * answer, exactly as citations are.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serverToolGaps } from '../packages/agents/src/providers/anthropic';
import type { LlmTool } from '../packages/agents/src/providers/types';

const searchTool: LlmTool = {
  kind: 'server',
  name: 'web_search',
  gap: 'server_web_search_unavailable',
  native: { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
};

const schemaTool: LlmTool = {
  kind: 'schema',
  name: 'record_finding',
  description: 'Record one finding.',
  parameters: { type: 'object', properties: {} },
};

/** The shape OpenRouter actually returned: text only, no server-tool traces. */
const droppedIt = {
  content: [{ type: 'text', text: "I don't have a web search tool available in this conversation." }],
  usage: { input_tokens: 40, output_tokens: 300, server_tool_use: null },
};

const ranIt = {
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Balagere guidance value' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
    { type: 'text', text: 'The guidance value is…' },
  ],
  usage: { input_tokens: 40, output_tokens: 300, server_tool_use: { web_search_requests: 1 } },
};

describe('a server tool that was asked for', () => {
  it('reports the gap when the answer shows no trace of it running', () => {
    assert.deepEqual(serverToolGaps([searchTool], droppedIt), ['server_web_search_unavailable']);
  });

  it('reports nothing when the tool visibly ran', () => {
    assert.deepEqual(serverToolGaps([searchTool], ranIt), []);
  });

  it('accepts the usage line alone as proof, since a turn can end after the search', () => {
    const usageOnly = { content: [{ type: 'text', text: 'done' }], usage: { server_tool_use: { web_search_requests: 2 } } };
    assert.deepEqual(serverToolGaps([searchTool], usageOnly), []);
  });
});

describe('a call that asked for no server tool', () => {
  it('stays silent, so the real signal is not buried', () => {
    assert.deepEqual(serverToolGaps(undefined, droppedIt), []);
    assert.deepEqual(serverToolGaps([], droppedIt), []);
    assert.deepEqual(serverToolGaps([schemaTool], droppedIt), [], 'a client-side tool is not hosted by the route');
  });
});

describe('a malformed or absent answer', () => {
  it('counts as no trace rather than as proof', () => {
    assert.deepEqual(serverToolGaps([searchTool], null), ['server_web_search_unavailable']);
    assert.deepEqual(serverToolGaps([searchTool], { content: 'not an array' }), ['server_web_search_unavailable']);
  });

  it('reports each distinct gap once, however many tools share it', () => {
    const fetchTool: LlmTool = { ...searchTool, name: 'web_fetch' };
    assert.deepEqual(serverToolGaps([searchTool, fetchTool], droppedIt), ['server_web_search_unavailable']);
  });
});
