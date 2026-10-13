/**
 * The chat's ladder: a free model first, the senior model when it is needed.
 *
 * Driven end to end against a fake model endpoint, because the interesting
 * part is not either model's answer but who answers: the free model's own
 * lookup stands; a hand-over, a failure, or an answer that picked nothing
 * on the record goes to the senior model; and a free model's tokens cost
 * nothing. A model answers by picking (`answer_with_fields`); what it
 * writes is not the answer.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { addAction, createProject, type DdProject } from '@realytica/shared';

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

const project = (): DdProject => {
  const p = createProject({ name: 'Whitefield plot', type: 'commercial', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-L1');
  addAction(p, { title: 'Get the khata extract', kind: 'clarification', owner: 'Anika Rao', priority: 'medium' }, 'lead@builders.example');
  return p;
};

/** A model's answer: it picks, once, and stops when it is told its picks were recorded. */
const picks = (model: string, messages: Array<{ content: unknown }>, input: Record<string, unknown>, words = '') =>
  sawToolResult(messages) ? text(model, '') : { body: message(model, [...(words ? [{ type: 'text', text: words }] : []), { type: 'tool_use', id: 'tu_a', name: 'answer_with_fields', input: { outcome: 'answered', fields: [], records: [], facts: [], passages: [], ...input } }], 'tool_use') };

describe('a lookup', () => {
  it('is answered by the free model, and costs nothing', async () => {
    const p = project();
    script = (model, messages) => picks(model, messages, { records: [p.actions[0]!.id] }, 'One action is open.');
    const answer = await runProjectChat({ project: p, question: 'What is open?' });
    assert.equal(answer.text, 'From the record:\n- Action: Get the khata extract · Not started (On the record)');
    assert.equal(answer.answeredBy, BASIC);
    assert.deepEqual([...new Set(asked)], [BASIC], 'the senior model was never called');
    assert.equal(answer.spend?.usd, 0);
    assert.equal(answer.spend?.exact, true);
  });
});

describe('a question that needs judgement', () => {
  it('is handed over by the free model, and answered by the senior one', async () => {
    script = (model, messages) => {
      if (model === SENIOR) return picks(model, messages, { outcome: 'not_on_record' }, 'The title chain has a gap between 1998 and 2004.');
      if (sawToolResult(messages)) return text(model, '');
      // The reason is one off a list. Words sent in its place are not kept: the list's first reason stands in.
      return { body: message(model, [{ type: 'tool_use', id: 'tu_1', name: 'hand_over', input: { reason: 'legal_standing' } }], 'tool_use') };
    };
    const answer = await runProjectChat({ project: project(), question: 'Is the title clean enough to buy?' });
    assert.equal(answer.answeredBy, SENIOR);
    assert.equal(answer.handedOverBecause, 'it is about title or legal standing');
    // The senior model's sentence is not the answer either: it picked nothing, and the reply says the record does not answer.
    assert.equal(answer.text, 'Neither the record nor the papers answer this.');
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

  it('hands over when it wrote an answer and picked nothing: a figure it states is never the reply', async () => {
    script = (model, messages) => (model === SENIOR ? picks(model, messages, { outcome: 'not_on_record' }) : text(model, 'The budget is ₹52,00,00,000.'));
    const answer = await runProjectChat({ project: project(), question: 'What is the budget?' });
    assert.equal(answer.answeredBy, SENIOR);
    assert.equal(answer.handedOverBecause, 'it had no answer');
    assert.ok(!JSON.stringify(answer).includes('52,00,00,000'));
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
