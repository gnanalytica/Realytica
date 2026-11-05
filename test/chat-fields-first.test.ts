/**
 * What the chat produces waits as a suggestion where it lands
 * (docs/product.md, "One chat, and what it may do"; docs/fields.md, "What a
 * value carries").
 *
 * - A value the person states in the chat, with no paper, waits on its field
 *   as proposed in their own words, under the message and the chat it was
 *   said in. Words the person did not say are no source.
 * - A fact of the project record the person states waits as a suggestion
 *   that Overview reads beside the fact.
 * - Overview's Needs you counts what waits a place at a time, and lists none
 *   of it one by one.
 * - The reply says where its message's suggestions went, a line a place.
 * - "Approve all" takes the values the last reply's message suggested, on
 *   the sheets as well as on the cards.
 *
 * Every name is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  applyProjectAgentTurn,
  applyProjectChat,
  chatTurnId,
  createAssessment,
  createChatProposal,
  createProject,
  fieldState,
  projectBrief,
  projectFactsWaiting,
  proposeFieldValues,
  readSheet,
  setTeamMember,
  suggestedLine,
  suggestionPlaces,
  suggestionsOn,
  type ChatInHand,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

const LEAD = 'lead@firm.example';
const HOLDING = 'legal.title.holding';
const extent: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'extent' };
const tenure: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'tenure' };

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-CFF');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', finance: 'lead' } }, 'owner');
  return p;
}

const message = (words: string, turnId = 'cht_said', sessionId = 'sit_one'): ChatInHand => ({ tag: { turnId, sessionId }, by: LEAD, message: words, at: '2026-11-05T06:00:00.000Z' });
const said = (quote: string) => ({ kind: 'said', quote }) as unknown as FieldOrigin;

describe('a value the person states in the chat', () => {
  it('waits on its field as proposed, in their own words, under the message and the chat it was said in', () => {
    const p = project();
    const out = proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model', undefined, { said: message('The extent is 5000 square metres') });
    assert.deepEqual(out.map((row) => row.outcome), ['waiting']);
    const held = p.fieldSheets?.[HOLDING]?.values.extent;
    assert.equal(fieldState(held), 'proposed', 'nothing stands until a person accepts it');
    assert.deepEqual(held?.chat, { turnId: 'cht_said', sessionId: 'sit_one' });
    assert.deepEqual(held?.origin, { kind: 'chat', by: LEAD, quote: '5000 square metres', turnId: 'cht_said', sessionId: 'sit_one', at: '2026-11-05T06:00:00.000Z' });
    const view = readSheet(p, HOLDING)!.fields.find((field) => field.def.key === 'extent')!;
    assert.equal(view.state, 'proposed');
    assert.deepEqual([view.source?.kind, view.source?.quote, view.source?.asOf], ['chat', '5000 square metres', '2026-11-05T06:00:00.000Z'], 'the field says who said it, their words and the day');
  });

  it('is refused for words the person did not say, and where no message is being answered', () => {
    const p = project();
    const [wrong] = proposeFieldValues(p, [{ address: extent, value: 6000, origin: said('6000 square metres') }], 'model', undefined, { said: message('The extent is 5000 square metres') });
    assert.equal(wrong!.outcome, 'refused');
    assert.match(wrong!.error!, /not in what the person said/);
    const [none] = proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model');
    assert.equal(none!.outcome, 'refused');
    assert.equal(p.fieldSheets?.[HOLDING]?.values.extent, undefined);
  });

  it('through the copilot’s tool, is the person’s words, and a paper’s value offered in the same turn carries the message too', async () => {
    const p = project();
    const row = addEvidence(p, { title: 'Sale deed 2019', kind: 'document' });
    const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
    const tools = createProjectTools(p, 'copilot', bag as never, { said: message('It is freehold, and the extent is 5000 square metres', 'cht_tool') }) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const run = async (args: unknown) => JSON.parse(await tools.find((tool) => tool.name === 'propose_field_values')!.run(args as never, undefined as never));
    const out = await run({
      values: [
        { address: tenure, value: 'freehold', origin: { kind: 'said', quote: 'It is freehold' } },
        { address: extent, value: 5000, origin: { kind: 'paper', evidenceId: row.id, page: 2, quote: 'measuring 5000 square metres' } },
      ],
    });
    assert.deepEqual(out.outcomes.map((row: { outcome: string }) => row.outcome), ['waiting', 'waiting']);
    const values = p.fieldSheets![HOLDING]!.values;
    assert.equal(values.tenure?.origin?.kind, 'chat');
    assert.equal(values.extent?.origin?.kind, 'paper');
    assert.deepEqual([values.tenure?.chat?.turnId, values.extent?.chat?.turnId], ['cht_tool', 'cht_tool']);
  });
});

describe('a fact of the project record the person states', () => {
  it('waits as a suggestion Overview reads beside the fact, in their words, under the message', () => {
    const p = project();
    const reply = applyProjectChat(p, 'The owner is Asha Menon', { actor: LEAD, chat: { sessionId: 'sit_one', actor: LEAD } });
    assert.equal(p.owner, undefined, 'nothing is written until a person accepts it');
    const [fact] = projectFactsWaiting(p);
    assert.deepEqual([fact?.key, fact?.label, fact?.to], ['owner', 'Owner', 'Asha Menon']);
    assert.equal(fact?.card.said?.quote, 'The owner is Asha Menon');
    assert.equal(fact?.card.said?.by, LEAD);
    assert.deepEqual(fact?.card.chat, { turnId: reply.userTurn.id, sessionId: 'sit_one' }, 'the card carries the message that raised it and its chat');
  });

  it('is not raised by a sentence that asks to be shown something', () => {
    const p = project();
    applyProjectChat(p, 'Show me the owner is Asha Menon', { actor: LEAD });
    assert.deepEqual(projectFactsWaiting(p), []);
  });
});

describe('Needs you on Overview', () => {
  it('counts what waits a place at a time, each opening where it sits, and lists none of it one by one', () => {
    const p = project();
    createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
    proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }, { address: tenure, value: 'freehold', origin: said('freehold, 5000 square metres') }], 'model', undefined, { said: message('freehold, 5000 square metres') });
    p.chatProposals.push(
      createChatProposal('add_finding', 'Boundary wall encroaches on the road', '', '', { title: 'Boundary wall encroaches on the road', description: 'The wall stands two metres onto the road.', severity: 'high', discipline: 'legal' }, LEAD),
      createChatProposal('add_finding', 'Khata is in an earlier owner’s name', '', '', { title: 'Khata is in an earlier owner’s name', severity: 'medium', discipline: 'legal' }, LEAD),
      createChatProposal('run_valuation', 'Run the valuation', '', '', {}, LEAD),
    );
    const needs = projectBrief(p, new Date('2026-11-05T06:00:00Z')).find((line) => line.key === 'needs')!;
    const lines = needs.parts.map((part) => part.text);
    assert.ok(lines.includes('Legal › Title: 2 suggestions'), lines.join(" | "));
    assert.ok(lines.includes('Findings: 2 suggestions'), lines.join(" | "));
    assert.ok(!lines.some((text) => text.includes('Boundary wall')), 'no suggestion is listed by itself');
    // What has no field or row is counted as it always was, and opens where it waits.
    assert.ok(lines.includes('1 more to accept'), lines.join(" | "));
    const title = needs.parts.find((part) => part.text.startsWith('Legal › Title'))!;
    assert.deepEqual(title.open, { pane: 'workstream', extra: { workstream: 'legal.title', stage: (title.open as { extra: { stage: string } }).extra.stage, section: 'sheet', item: `${HOLDING}::::extent` } });
    assert.equal((needs.parts.find((part) => part.text.startsWith('Findings'))!.open as { pane: string }).pane, 'findings');
  });
});

describe('the reply', () => {
  it('says where its message’s suggestions went, a line a place, each opening there', () => {
    const p = project();
    const turnId = chatTurnId();
    const bag = { proposals: [] as never[], navigations: [], toolCalls: [], choices: [] };
    const tools = createProjectTools(p, 'copilot', bag as never, { said: message('Freehold, 5000 square metres', turnId) }) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    return tools
      .find((tool) => tool.name === 'propose_field_values')!
      .run({ values: [{ address: tenure, value: 'freehold', origin: { kind: 'said', quote: 'Freehold, 5000 square metres' } }, { address: extent, value: 5000, origin: { kind: 'said', quote: '5000 square metres' } }] } as never, undefined as never)
      .then(() => {
        const finding = createChatProposal('add_finding', 'Boundary wall encroaches on the road', '', '', { title: 'Boundary wall encroaches on the road', description: 'The wall stands two metres onto the road.', severity: 'high', discipline: 'legal' }, 'copilot');
        const result = applyProjectAgentTurn(p, 'Freehold, 5000 square metres', { text: 'Offered.', proposals: [finding], navigations: [] }, { turnId, sessionId: 'sit_one' });
        assert.equal(result.userTurn.id, turnId, 'the message is kept under the id its suggestions name');
        assert.deepEqual(finding.chat, { turnId, sessionId: 'sit_one' });
        assert.deepEqual(result.assistantTurn.suggested?.map((line) => line.words), ['Suggested 2 values on Legal › Title', 'Suggested a finding on Findings']);
        assert.equal(result.assistantTurn.suggested?.[0]?.open.extra.workstream, 'legal.title');
        assert.deepEqual(result.assistantTurn.suggested?.[1]?.open, { pane: 'findings', extra: { findingId: finding.id } });

        // "Approve all" takes what the last reply's message suggested: the values on the sheet and the card.
        const approved = applyProjectChat(p, 'approve all', { actor: LEAD });
        assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.extent), 'accepted', approved.assistantTurn.text);
        assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.tenure), 'accepted');
        assert.equal(p.findings.length, 1, approved.assistantTurn.text);
        assert.match(approved.assistantTurn.text, /Accepted 2 values where they were suggested/);
      });
  });

  it('puts mixed suggestions in one place into one line', () => {
    const line = suggestedLine({ key: 'pane:actions', label: 'Actions', kinds: { action: 2, request: 1 } });
    assert.equal(line, 'Suggested 2 actions and a request on Actions');
    assert.equal(suggestedLine({ key: 'record', label: 'the project record', kinds: { fact: 1 } }), 'Suggested a change on Overview › Key facts');
    assert.equal(suggestedLine({ key: 'record', label: 'the project record', kinds: { fact: 2 }, keyFacts: ['Owner', 'City'] }), 'Suggested the owner and the city on Overview › Key facts');
  });

  it('lists a chat’s own suggestions by the chat they carry, and nobody else’s', () => {
    const p = project();
    proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model', undefined, { said: message('5000 square metres', 'cht_a', 'sit_a') });
    proposeFieldValues(p, [{ address: tenure, value: 'freehold', origin: said('freehold') }], 'model', undefined, { said: message('freehold', 'cht_b', 'sit_b') });
    assert.deepEqual(suggestionsOn(p, { sessionId: 'sit_a' }).map((one) => one.id), [`${HOLDING}::::extent`]);
    assert.deepEqual(suggestionPlaces(suggestionsOn(p)).map((place) => [place.label, place.count]), [['Legal › Title', 2]]);
  });
});
