/**
 * What is kept of a model's answer in the chat: what it picked, and no word
 * it wrote.
 *
 * Driven against a fake model endpoint. The model writes sentences beside
 * its tool calls, as models do, and then picks: field addresses, record
 * ids, marks. The reply is the card code makes of those picks from the
 * record, under a template's line. The sentences are in nothing that comes
 * back. A pick that names nothing on the record is dropped, a question the
 * record does not answer is said so by template with what to look at, and
 * what is left for memory is a mark's kind and what it is about.
 *
 * Every project, paper and figure is invented.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addAction, addEvidence, applyProjectAgentTurn, chatAnswerCard, chatAnswerSaid, chatAnswerText, chatPicksFrom, createProject, memMarkSaid, setFieldValues, type DdProject } from '@realytica/shared';

const BASE = 'http://card.test';
const SENIOR = 'senior/model';
const LEAD = 'lead@builders.example';
const realFetch = globalThis.fetch;

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
let turns: Block[][] = [];
let sent: Array<{ system: string; tools: Array<{ name: string; input_schema?: unknown }> }> = [];
let runProjectChat: typeof import('../packages/agents/src/agents/project-copilot').runProjectChat;

before(async () => {
  process.env.REALYTICA_BASE_URL = BASE;
  process.env.REALYTICA_API_KEY = 'test-key';
  process.env.REALYTICA_MODEL_JUDGMENT = SENIOR;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(BASE)) return realFetch(input as string, init);
    const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body ?? '{}'));
    sent.push({ system: JSON.stringify(body.system ?? ''), tools: body.tools ?? [] });
    const content = turns.shift() ?? [{ type: 'text', text: 'That is everything I found.' }];
    const stop = content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
    return new Response(JSON.stringify({ id: `msg_${sent.length}`, type: 'message', role: 'assistant', model: SENIOR, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 60 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  ({ runProjectChat } = await import('../packages/agents/src/agents/project-copilot'));
});

after(() => {
  globalThis.fetch = realFetch;
  for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT']) delete process.env[name];
});

/** A project with a land holding sheet filled in part, a paper and an action. */
function held(): { project: DdProject; paperId: string; actionId: string } {
  const project = createProject({ name: 'Tank Road plots', type: 'residential', location: 'Tank Road', city: 'Kadamba' }, 'RYT-CA1', LEAD);
  setFieldValues(project, { set: 'legal.title.holding' }, { tenure: 'freehold' }, LEAD);
  const paper = addEvidence(project, { title: 'Sale deed of the tank parcel', kind: 'document', status: 'received' }, LEAD);
  const action = addAction(project, { title: 'Get the encumbrance certificate', kind: 'clarification', owner: 'Anika Rao', priority: 'high', dueDate: '2026-11-01' }, LEAD);
  return { project, paperId: paper.id, actionId: action.id };
}

const PROSE = ['The land is plainly freehold and worth about ₹4,20,00,000, so I would go ahead.', 'In my view the title is clean.', 'I have noted that the seller seemed evasive.'];
const answer = (input: unknown, words = PROSE[1]!): Block[] => [{ type: 'text', text: words }, { type: 'tool_use', id: 'tu_answer', name: 'answer_with_fields', input }];

describe('a model’s answer in the chat', () => {
  it('is the fields and records it picked, printed from the record, and none of the sentences it wrote', async () => {
    const { project, paperId, actionId } = held();
    sent = [];
    turns = [
      [{ type: 'text', text: PROSE[0]! }, { type: 'tool_use', id: 'tu_1', name: 'get_fields', input: { fn: 'legal.title' } }],
      answer({
        outcome: 'answered',
        fields: [{ set: 'legal.title.holding', field: 'tenure' }, { set: 'legal.title.holding', field: 'extent' }, { set: 'no.such.sheet', field: 'nothing' }],
        records: [actionId, paperId, 'act_that_is_not_there'],
        facts: ['m9'],
        passages: ['p4'],
        // A sentence under any name is not a thing to send, and is not read.
        answer: PROSE[0],
        mark: { kind: 'follow_up', record: actionId, note: PROSE[2] },
      }),
      [{ type: 'text', text: PROSE[2]! }],
    ];
    const said = await runProjectChat({ project, question: 'What is the tenure, and what is still to get?' });
    assert.deepEqual(
      said.card!.rows.map((row) => [row.kind, row.label, row.value, row.standing]),
      [
        ['field', 'Tenure (Land holding)', 'Freehold', 'typed'],
        ['record', 'Action', 'Get the encumbrance certificate · Not started · due 2026-11-01', 'on_record'],
        ['record', 'Paper', 'Sale deed of the tank parcel · Received', 'on_record'],
      ],
    );
    // The extent is on the sheet and empty: it answers nothing, and is offered as what to look at.
    assert.deepEqual(said.card!.look.map((item) => item.label), ['Extent held (Land holding)']);
    assert.equal(said.card!.outcome, 'partly');
    assert.equal(
      said.text,
      [
        'The record holds part of this:',
        '- Tenure (Land holding): Freehold (Entered by a person)',
        '- Action: Get the encumbrance certificate · Not started · due 2026-11-01 (On the record)',
        '- Paper: Sale deed of the tank parcel · Received (On the record; Sale deed of the tank parcel)',
        'To look at:',
        '- Extent held (Land holding)',
      ].join('\n'),
    );
    const all = JSON.stringify(said);
    for (const written of PROSE) assert.ok(!all.includes(written.slice(0, 30)), written);
    // What is left for memory is the mark's kind and the record's own name for the thing.
    assert.deepEqual(said.note, { note: 'To follow up: action “Get the encumbrance certificate”.', about: actionId });
    assert.ok(said.citedEvidenceIds.includes(paperId) && said.citedNodeIds.includes(actionId));
    // The turn as it is stored: the card, its text whole, and still nothing of the model's.
    const stored = applyProjectAgentTurn(project, 'What is the tenure, and what is still to get?', said);
    assert.equal(stored.assistantTurn.text, said.text);
    assert.deepEqual(stored.assistantTurn.card, said.card);
    assert.equal(stored.assistantTurn.unsupportedClaims, undefined);
    for (const written of PROSE) assert.ok(!JSON.stringify(project.conversation).includes(written.slice(0, 30)), written);
  });

  it('is told to pick and not to write, and its one way to answer has nowhere to put a sentence', async () => {
    const { project } = held();
    sent = [];
    turns = [answer({ outcome: 'answered', fields: [{ set: 'legal.title.holding', field: 'tenure' }], records: [], facts: [], passages: [] })];
    await runProjectChat({ project, question: 'Tenure?' });
    assert.match(sent[0]!.system, /You never write an answer/);
    const tool = sent[0]!.tools.find((held) => held.name === 'answer_with_fields')!;
    const strings: string[] = [];
    const walk = (schema: unknown, at: string): void => {
      const node = (schema && typeof schema === 'object' ? schema : {}) as { type?: unknown; enum?: unknown; properties?: Record<string, unknown>; items?: unknown };
      if (node.type === 'string' && !node.enum) strings.push(at);
      for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${at}.${key}`);
      if (node.items) walk(node.items, `${at}[]`);
    };
    walk(tool.input_schema, '');
    // Every free string is a key: a set, a field, a record, an id or a mark.
    assert.deepEqual(strings.sort(), ['.facts[]', '.fields[].field', '.fields[].record', '.fields[].set', '.look_at.fields[].field', '.look_at.fields[].record', '.look_at.fields[].set', '.look_at.papers[]', '.mark.field.field', '.mark.field.record', '.mark.field.set', '.mark.record', '.passages[]', '.records[]']);
  });

  it('that picks nothing on the record says so by template, and offers what to look at', async () => {
    const { project, paperId } = held();
    turns = [answer({ outcome: 'not_on_record', fields: [], records: [], facts: [], passages: [], look_at: { fields: [{ set: 'legal.title.holding', field: 'extent' }], papers: [paperId] } }, 'It is probably about two acres.')];
    const said = await runProjectChat({ project, question: 'What is the extent?' });
    assert.equal(said.text, ['Neither the record nor the papers answer this.', 'To look at:', '- Extent held (Land holding)', '- Sale deed of the tank parcel'].join('\n'));
    assert.ok(!said.text.includes('two acres'));
    // A model that never answers at all has said nothing, whatever it wrote.
    turns = [[{ type: 'text', text: 'The extent is 2 acres 10 guntas.' }]];
    const silent = await runProjectChat({ project, question: 'What is the extent?' });
    assert.equal(silent.text, 'Neither the record nor the papers answer this.');
    assert.deepEqual(silent.card!.rows, []);
  });

  it('says the template’s line in the question’s language where it has it, and the record’s words as the record writes them', async () => {
    const { project } = held();
    turns = [answer({ outcome: 'answered', fields: [{ set: 'legal.title.holding', field: 'tenure' }], records: [], facts: [], passages: [] }, 'यह भूमि फ्रीहोल्ड है।')];
    const hindi = await runProjectChat({ project, question: 'भूमि का स्वामित्व किस प्रकार का है?' });
    assert.equal(hindi.text, 'रिकॉर्ड से:\n- Tenure (Land holding): Freehold (Entered by a person)');
    turns = [answer({ outcome: 'not_on_record', fields: [], records: [], facts: [], passages: [] })];
    const kannada = await runProjectChat({ project, question: 'ಭೂಮಿಯ ವಿಸ್ತೀರ್ಣ ಎಷ್ಟು?' });
    assert.equal(kannada.text, 'ಇದಕ್ಕೆ ಉತ್ತರ ದಾಖಲೆಯಲ್ಲೂ ಇಲ್ಲ, ಕಾಗದಗಳಲ್ಲೂ ಇಲ್ಲ.');
    // A language the templates are not in is answered in English.
    assert.equal(chatAnswerSaid({ outcome: 'not_on_record', rows: [], look: [] }, { question: 'நிலத்தின் பரப்பளவு என்ன?' }).lead, 'Neither the record nor the papers answer this.');
  });
});

describe('a card', () => {
  it('prints a memory line with its mark and a passage with its cite, so tags and citations are made as they were', () => {
    const { project, paperId } = held();
    const card = chatAnswerCard(
      project,
      chatPicksFrom({ outcome: 'answered', fields: [], records: [], facts: ['[m2]', 'm7'], passages: ['p1'] }),
      {
        remembered: { lines: [{ mark: 'm2', id: 'fact-1', tag: 'approved', seed: 0, aboutId: paperId, text: 'approved · Registered on: 12 April 2019 · source: Sale deed of the tank parcel, p.3 · 2026-10-01' }] },
        passages: [{ mark: 'p1', evidenceId: paperId, title: 'Sale deed of the tank parcel', page: 4, quote: 'together with a right of way twelve feet wide' }],
      },
    );
    assert.equal(chatAnswerText(card), ['From the record:', '- Registered on: 12 April 2019 [m2] (Sale deed of the tank parcel, p.3)', `- Sale deed of the tank parcel, page 4: “together with a right of way twelve feet wide” [ev:${paperId}:p4]`].join('\n'));
    assert.deepEqual(card.rows.map((row) => row.standing), ['memory_approved', 'paper_words']);
  });

  it('leaves for memory only a mark about something on the record', () => {
    const { project, actionId } = held();
    assert.deepEqual(memMarkSaid(project, chatPicksFrom({ mark: { kind: 'contradiction', field: { set: 'legal.title.holding', field: 'extent' } } }).mark), { note: 'Contradiction: the field Extent held (Land holding).' });
    assert.equal(memMarkSaid(project, chatPicksFrom({ mark: { kind: 'open_question', record: 'not_a_record' } }).mark), undefined);
    assert.equal(chatPicksFrom({ mark: { kind: 'a hunch', record: actionId } }).mark, undefined);
    assert.equal(chatPicksFrom({ mark: { kind: 'follow_up' } }).mark, undefined);
  });
});
