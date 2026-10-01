/**
 * The chat's ladder: a free model first, the senior model when it is needed.
 *
 * Driven end to end against a fake model endpoint, because the interesting
 * part is not either model's answer but who answers: the free model's own
 * lookup stands; a hand-over, a failure, or a figure the file cannot back
 * goes to the senior model; and a free model's tokens cost nothing.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createProject, type DdProject } from '@realytica/shared';

const BASE = 'http://ladder.test';
const BASIC = 'basic/model:free';
const SENIOR = 'senior/model';

type Reply = { status?: number; body: unknown };
/** What the fake endpoint answers, per model, given what it was sent. */
let script: (model: string, messages: Array<{ role: string; content: unknown }>) => Reply;
const asked: string[] = [];
const realFetch = globalThis.fetch;

const message = (model: string, content: unknown[], stop: 'end_turn' | 'tool_use' = 'end_turn') => ({
  id: `msg_${asked.length}`,
  type: 'message',
  role: 'assistant',
  model,
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80 },
});
const text = (model: string, words: string) => ({ body: message(model, [{ type: 'text', text: words }]) });
const sawToolResult = (messages: Array<{ content: unknown }>) =>
  messages.some((m) => Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((b) => b.type === 'tool_result'));

let runProjectChat: typeof import('../packages/agents/src/agents/project-copilot').runProjectChat;

before(async () => {
  process.env.REALYTICA_BASE_URL = BASE;
  process.env.REALYTICA_API_KEY = 'test-key';
  process.env.REALYTICA_MODEL_JUDGMENT = SENIOR;
  process.env.REALYTICA_MODEL_BASIC = BASIC;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(BASE)) return realFetch(input as string, init);
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
    const body = JSON.parse(raw) as { model: string; messages: Array<{ role: string; content: unknown }> };
    asked.push(body.model);
    const reply = script(body.model, body.messages);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  ({ runProjectChat } = await import('../packages/agents/src/agents/project-copilot'));
});

after(() => {
  globalThis.fetch = realFetch;
  for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT', 'REALYTICA_MODEL_BASIC']) delete process.env[name];
});

beforeEach(() => {
  asked.length = 0;
});

const project = (): DdProject => createProject({ name: 'Whitefield plot', type: 'commercial', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-L1');

describe('a lookup', () => {
  it('is answered by the free model, and costs nothing', async () => {
    script = (model) => text(model, 'The project is a commercial site in Whitefield, Bengaluru.');
    const answer = await runProjectChat({ project: project(), question: 'Where is this project?' });
    assert.equal(answer.answeredBy, BASIC);
    assert.deepEqual(asked, [BASIC], 'the senior model was never called');
    assert.equal(answer.spend?.usd, 0);
    assert.equal(answer.spend?.exact, true);
  });
});

describe('a question that needs judgement', () => {
  it('is handed over by the free model, and answered by the senior one', async () => {
    script = (model, messages) => {
      if (model === SENIOR) return text(model, 'The title chain has a gap between 1998 and 2004.');
      if (sawToolResult(messages)) return text(model, '');
      return { body: message(model, [{ type: 'tool_use', id: 'tu_1', name: 'hand_over', input: { reason: 'it asks whether the title is clean' } }], 'tool_use') };
    };
    const answer = await runProjectChat({ project: project(), question: 'Is the title clean enough to buy?' });
    assert.equal(answer.answeredBy, SENIOR);
    assert.equal(answer.handedOverBecause, 'it asks whether the title is clean');
    assert.match(answer.text, /title chain has a gap/);
    assert.equal(asked.at(-1), SENIOR);
  });
});

describe('the free model failing', () => {
  it('hands over when its endpoint refuses, as free endpoints do under a strict data policy', async () => {
    script = (model) =>
      model === SENIOR
        ? text(model, 'It is a commercial site in Whitefield.')
        : { status: 404, body: { error: { message: 'No endpoints available matching your guardrail restrictions and data policy.' } } };
    const answer = await runProjectChat({ project: project(), question: 'Where is this project?' });
    assert.equal(answer.answeredBy, SENIOR);
    assert.equal(answer.handedOverBecause, 'the free model was unavailable');
  });

  it('hands over when it states a figure the file does not support', async () => {
    script = (model) =>
      model === SENIOR ? text(model, 'No budget is recorded on this file.') : text(model, 'The budget is ₹52,00,00,000.');
    const answer = await runProjectChat({ project: project(), question: 'What is the budget?' });
    assert.equal(answer.answeredBy, SENIOR);
    assert.equal(answer.handedOverBecause, 'it stated figures the file does not support');
  });
});

describe('writing that will be read as the firm’s', () => {
  it('goes to the senior model without asking the free one', async () => {
    script = (model) => text(model, 'Draft: The setback on the eastern boundary is not met.');
    const answer = await runProjectChat({ project: project(), question: 'Draft a finding that the setback breaches the lake buffer' });
    assert.deepEqual(asked, [SENIOR]);
    assert.equal(answer.handedOverBecause, 'it asked for writing');
  });
});
