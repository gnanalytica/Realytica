/**
 * A citation that did not come back has to be recorded as missing.
 *
 * Declared capabilities cannot answer this once a proxy is in the base-URL
 * seat. Measured against a real LiteLLM proxy: the same Anthropic-format PDF
 * arrives at Gemini as `inline_data` with the citation request dropped en
 * route, and at an OpenAI-shaped endpoint the document is dropped entirely and
 * silently. The vendor is not knowable from here, so the only honest source of
 * truth is the answer itself.
 *
 * The failure this prevents is specific: a page reference in a diligence
 * report that nothing verified, presented exactly like one that was.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anthropicProvider, citationGap } from '../packages/agents/src/providers/anthropic';
import type { LlmContentBlock, LlmRequest } from '../packages/agents/src/providers/types';

function withDocument(wantCitations: boolean): LlmRequest {
  return {
    agent: 'document_intelligence',
    model: 'probe',
    maxTokens: 128,
    system: [],
    messages: [{
      role: 'user',
      content: [
        { type: 'document', document: { base64: 'JVBERi0=', mediaType: 'application/pdf', title: 'deed.pdf', wantCitations } },
        { type: 'text', text: 'What is the khata number?' },
      ],
    }],
  };
}

const answered: LlmContentBlock[] = [{ type: 'text', text: 'KH-7741-B/2019' }];
const cited: LlmContentBlock[] = [{
  type: 'text',
  text: 'KH-7741-B/2019',
  citations: [{ quote: 'Khata No. KH-7741-B/2019', page: 3, verified: true }],
}];

describe('a document read reports whether its citations arrived', () => {
  it('records the gap when citations were asked for and none came back', () => {
    assert.deepEqual(citationGap(withDocument(true), answered), ['citations_unavailable']);
  });

  it('records nothing when they did', () => {
    assert.deepEqual(citationGap(withDocument(true), cited), []);
  });

  it('stays silent when the call never asked', () => {
    // A read that did not want citations has not lost anything, and flagging
    // it would bury the calls that did.
    assert.deepEqual(citationGap(withDocument(false), answered), []);
  });

  it('stays silent when there is no document at all', () => {
    const chat: LlmRequest = {
      agent: 'analyst_copilot', model: 'probe', maxTokens: 128, system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };
    assert.deepEqual(citationGap(chat, answered), []);
  });
});

describe('the provider declares what its format can carry', () => {
  it('still claims document citations, because the format does', () => {
    // The declaration is about the wire format, which does carry them. Whether
    // a given call got them is the per-call gap above — the two answer
    // different questions and collapsing them loses one.
    assert.equal(anthropicProvider.descriptor().capabilities.documentCitations, true);
    assert.equal(anthropicProvider.descriptor().capabilities.pdfInput, true);
  });
});
