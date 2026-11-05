/**
 * What the chat suggests is the person's own, said in their own sitting, and
 * waits where it can be decided (docs/product.md, "One chat, and what it may
 * do").
 *
 * - A question the chat asks is answered only by the next message in the
 *   same person's sitting. Any other reply ends the run, and "ask me" then
 *   says so and carries on where it stood. A field of words takes a message
 *   only where it plainly gives a value: never "thanks", "ok", "cool", a
 *   greeting or a question. A tap gives only a value the question offered.
 * - A value said in the chat rests on the person's words only where those
 *   words are theirs, are not a question, are more than a word cut out of a
 *   sentence, and give that value read by the field's own reader.
 * - A change to the record waits as a suggestion only where Key facts has a
 *   line for it: the saleable area has one. Any other waits as a card.
 * - "Approve all" takes what the chat suggested; "approve both", "these" and
 *   "them" take only what the last reply left.
 * - A collaborator's model reply links nowhere the firm keeps to itself.
 * - "Approve all" accepts a value on a shared record where accepting it on
 *   its field would.
 * - What the next-step rules raise on their own carries no chat message.
 * - What a collaborator's chat suggested on their copy is offered on the
 *   project, only on the fields in their reach.
 *
 * Every name is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectAgentTurn,
  applyProjectChat,
  askAnswerTyped,
  chatValuesCarried,
  chatWaiting,
  createChatProposal,
  createProject,
  fieldState,
  projectFactsWaiting,
  proposeFieldValues,
  setTeamMember,
  suggestionsOn,
  waitingOnCanvas,
  waitsWhereItLands,
  type ChatInHand,
  type ChoicePin,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
  type ProjectChatResult,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

const LEAD = 'lead@firm.example';
const OTHER = 'meera@firm.example';
const HOLDING = 'legal.title.holding';
const TITLE_PAGE = { pane: 'workstream', department: 'legal', fn: 'legal.title' } as const;
const tenure: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'tenure' };
const extent: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'extent' };

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-FIX');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', finance: 'lead' } }, 'owner');
  return p;
}

/** Say something, and keep both turns as the chat route keeps them: under the sitting where there is one, and signed by who said it. */
function sayIn(p: DdProject, words: string, opts: { sessionId?: string; actor?: string; sitting?: ChoicePin; place?: Record<string, string> } = {}): ProjectChatResult {
  const actor = opts.actor ?? LEAD;
  const out = applyProjectChat(p, words, { actor, chat: { ...(opts.sessionId ? { sessionId: opts.sessionId } : {}), actor }, place: (opts.place ?? TITLE_PAGE) as never, sitting: opts.sitting });
  for (const turn of [out.userTurn, out.assistantTurn]) {
    turn.actor = actor;
    if (opts.sessionId) turn.sessionId = opts.sessionId;
  }
  return out;
}

const message = (words: string, turnId = 'cht_fix', sessionId = 'sit_fix'): ChatInHand => ({ tag: { turnId, sessionId }, by: LEAD, message: words, at: '2026-11-05T06:00:00.000Z' });
const said = (quote?: string) => ({ kind: 'said', ...(quote === undefined ? {} : { quote }) }) as unknown as FieldOrigin;
const offer = (p: DdProject, address: FieldAddress, value: unknown, words: string, quote?: string) => proposeFieldValues(p, [{ address, value, origin: said(quote) }], 'model', undefined, { said: message(words) })[0]!;

describe('a question the chat asks', () => {
  it('is no longer open once a reply about something else is made, and “ask me” says so and carries on where it stood', () => {
    const p = project();
    const first = sayIn(p, "What's missing here?", { sessionId: 'sit_a' });
    assert.equal(first.assistantTurn.asking?.at, 0);
    sayIn(p, 'Add a risk: the drain crosses the plot', { sessionId: 'sit_a' });
    // Said after something else, "freehold" is not taken for the tenure.
    const late = sayIn(p, 'freehold', { sessionId: 'sit_a' });
    assert.equal(late.assistantTurn.asking, undefined, late.assistantTurn.text);
    assert.equal(p.fieldSheets?.[HOLDING]?.values.tenure, undefined, 'nothing was suggested on the tenure');
    sayIn(p, 'Add a risk: the lift may be late', { sessionId: 'sit_a' });
    const again = sayIn(p, 'ask me', { sessionId: 'sit_a' });
    assert.match(again.assistantTurn.text, /^The questions before stopped when something else was said, so I am carrying on where they stood\. 2 things are missing\./);
    assert.match(again.assistantTurn.text, /Tenure\?/);
    assert.match(sayIn(p, 'freehold', { sessionId: 'sit_a' }).assistantTurn.text, /^Suggested Freehold on Tenure\./);
    // Where the last reply offered to ask for something, that is asked, and the run before is still said to have ended.
    const q = project();
    sayIn(q, "What's missing here?", { sessionId: 'sit_c' });
    const offered = sayIn(q, 'what is the tenure of the land?', { sessionId: 'sit_c', place: { pane: 'overview' } });
    assert.ok(offered.assistantTurn.choices?.some((choice) => choice.label === 'Fill these in'), offered.assistantTurn.text);
    assert.match(sayIn(q, 'ask me', { sessionId: 'sit_c' }).assistantTurn.text, /^The questions before stopped when something else was said\. One thing is missing\./);
  });

  it('is answered by nobody but the person it was put to, with or without a sitting', () => {
    const p = project();
    sayIn(p, "What's missing here?");
    const theirs = sayIn(p, 'freehold', { actor: OTHER });
    assert.equal(theirs.assistantTurn.asking, undefined);
    assert.equal(p.fieldSheets?.[HOLDING]?.values.tenure, undefined, 'a colleague’s word is not an answer to somebody else’s question');
    const q = project();
    sayIn(q, "What's missing here?", { sessionId: 'sit_lead' });
    sayIn(q, 'freehold', { sessionId: 'sit_other', actor: OTHER });
    assert.equal(q.fieldSheets?.[HOLDING]?.values.tenure, undefined);
  });

  it('for a field of words, takes a message only where it plainly gives a value', () => {
    const p = project();
    const target = { kind: 'field' as const, address: { fn: 'finance.budget', set: 'finance.budget.approved', field: 'budget_version' }, label: 'Budget version', where: 'Finance › Budget' };
    for (const talk of ['thanks', 'Thank you!', 'ok', 'okay cool', 'cool', 'hello', 'hi there', 'good morning', 'got it', 'what is this?', 'is it the March one', 'approve all', 'skip']) {
      assert.equal(askAnswerTyped(p, target, talk), undefined, talk);
    }
    assert.deepEqual(askAnswerTyped(p, target, 'Revision 3 of March 2026'), { value: 'Revision 3 of March 2026' });
  });

  it('takes from a tap only a value the question offered', () => {
    const p = project();
    const first = sayIn(p, "What's missing here?", { sessionId: 'sit_tap' });
    const asking = first.assistantTurn.asking!;
    const forged = sayIn(p, 'Freehold', { sessionId: 'sit_tap', sitting: { ask: { act: 'answer', run: asking.run, at: asking.at, value: 'company_owned' } } });
    assert.match(forged.assistantTurn.text, /^That is not one of the answers offered, so nothing was changed\.\n\nLegal › Title — Land holding: Tenure\?/);
    assert.equal(p.fieldSheets?.[HOLDING]?.values.tenure, undefined);
    const tap = forged.assistantTurn.choices!.find((choice) => choice.label === 'Leasehold')!;
    assert.match(sayIn(p, tap.send, { sessionId: 'sit_tap', sitting: tap.sitting }).assistantTurn.text, /^Suggested Leasehold on Tenure\./);
  });
});

describe('a value said in the chat', () => {
  it('is refused where the words are not the person’s, are from a question, or are too little of what they said', () => {
    const p = project();
    assert.match(offer(p, tenure, 'freehold', 'The land is freehold', 'it is leasehold').error!, /not in what the person said/);
    assert.match(offer(p, tenure, 'freehold', 'Is it freehold or leasehold?', 'freehold or leasehold').error!, /from a question/);
    assert.match(offer(p, tenure, 'freehold', 'Is it freehold or leasehold').error!, /from a question/, 'a question with no mark is still a question');
    assert.match(offer(p, tenure, 'freehold', 'Yes, but it is not freehold', 'freehold').error!, /too little/);
    assert.equal(p.fieldSheets?.[HOLDING]?.values.tenure, undefined);
  });

  it('is refused where the words give some other value, read by the field’s own reader', () => {
    const p = project();
    assert.match(offer(p, extent, 6000, 'The extent is 5000 square metres', '5000 square metres').error!, /does not say Extent held/);
    // 5000 square feet is not 5000 of the field's own unit.
    assert.match(offer(p, extent, 5000, 'The extent is 5000 sqft', '5000 sqft').error!, /does not say Extent held/);
    assert.match(offer(p, tenure, 'freehold', 'The land is held outright', 'held outright').error!, /name the choice/);
    const permitted: FieldAddress = { fn: 'legal.approvals', set: 'legal.approvals.land_use', field: 'use_permitted' };
    assert.match(offer(p, permitted, true, 'The use is not permitted there', 'not permitted there').error!, /does not say/);
    assert.equal(offer(p, permitted, false, 'The use is not permitted there', 'not permitted there').outcome, 'waiting');
    const approvedOn: FieldAddress = { fn: 'finance.budget', set: 'finance.budget.approved', field: 'approved_on' };
    assert.match(offer(p, approvedOn, '2026-10-01', 'It was approved on 3 Oct 2026', 'approved on 3 Oct 2026').error!, /give the day/);
    assert.equal(offer(p, approvedOn, '2026-10-03', 'It was approved on 3 Oct 2026', 'approved on 3 Oct 2026').outcome, 'waiting');
    assert.equal(offer(p, extent, 5000, 'The extent is 5000 square metres', '5000 square metres').outcome, 'waiting');
    assert.equal(offer(p, tenure, 'freehold', 'The land is freehold, I checked', 'The land is freehold').outcome, 'waiting');
  });

  it('through the copilot’s tool, is refused with the reason in the result', async () => {
    const p = project();
    const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
    const tools = createProjectTools(p, 'copilot', bag as never, { said: message('Is it freehold or leasehold?', 'cht_tool') }) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const out = JSON.parse(await tools.find((tool) => tool.name === 'propose_field_values')!.run({ values: [{ address: tenure, value: 'freehold', origin: { kind: 'said', quote: 'freehold or leasehold' } }] } as never, undefined as never));
    assert.equal(out.outcomes[0].outcome, 'refused');
    assert.match(out.outcomes[0].error, /from a question the person asked/);
  });
});

describe('a change to the project record', () => {
  it('to the saleable area has a line on Key facts, and is counted as it shows', () => {
    const p = project();
    sayIn(p, 'Saleable area is 50000 sqm', { sessionId: 'sit_area' });
    assert.deepEqual(projectFactsWaiting(p).map((row) => [row.key, row.label, row.to]), [['saleableAreaSqm', 'Saleable area', '50,000']]);
    assert.deepEqual(suggestionsOn(p).map((one) => one.kind), ['fact']);
    assert.equal(chatWaiting(p, 'sit_area').cards.length, 1);
  });

  it('reads an area said in square feet, yards or guntas as square metres', () => {
    for (const [said, to] of [
      ['Saleable area is 50000 sqft', '4,645'],
      ['Saleable area is 50,000 sq ft', '4,645'],
      ['Saleable area is 1200 sq yd', '1,003'],
      ['The plot is 20 guntas', '2,023'],
    ] as const) {
      const p = project();
      sayIn(p, said, { sessionId: 'sit_units' });
      assert.deepEqual(projectFactsWaiting(p).map((row) => row.to), [to], said);
    }
  });

  it('with no line on Key facts waits as a card where cards wait, and is no suggestion', () => {
    const p = project();
    p.landAreaSqm = 4000;
    const card = createChatProposal('patch_project', 'Update land', 'Said in the chat.', 'Patches the project record.', { landAreaSqm: 4000 }, LEAD, { chat: { turnId: 'cht_same', sessionId: 'sit_same' } });
    p.chatProposals.push(card);
    assert.deepEqual(projectFactsWaiting(p), [], 'it would change nothing Key facts shows');
    assert.equal(waitsWhereItLands(card, p), false);
    assert.deepEqual(suggestionsOn(p), []);
    assert.deepEqual(chatWaiting(p, 'sit_same').cards, [], 'the strip’s Accept all leaves it');
    assert.ok(waitingOnCanvas(p).entries.some((entry) => entry.proposalId === card.id), 'it is listed with the cards, to accept or set aside');
  });
});

describe('“approve” typed in a chat', () => {
  it('with “all” takes what the chat suggested; with “both”, “these” or “them”, only what the last reply left', () => {
    for (const [words, taken] of [['approve them', ['the lift may be late']], ['approve these', ['the lift may be late']], ['approve both', ['the lift may be late']], ['approve them all', ['the access road is not adopted', 'the lift may be late']], ['approve all', ['the access road is not adopted', 'the lift may be late']]] as const) {
      const p = project();
      sayIn(p, 'Add a risk: the access road is not adopted', { sessionId: 'sit_b' });
      sayIn(p, 'Add a risk: the lift may be late', { sessionId: 'sit_b' });
      sayIn(p, words, { sessionId: 'sit_b' });
      assert.deepEqual(p.risks.map((risk) => risk.title).sort(), [...taken], words);
    }
  });

  it('“approve all” accepts a value on a shared record as accepting it on its field would', () => {
    const p = project();
    const first = sayIn(p, 'The seller is Asha Menon', { sessionId: 'sit_s' });
    const party: FieldAddress = { fn: 'shared', set: 'shared.parties', field: 'name' };
    const [row] = proposeFieldValues(p, [{ address: party, value: 'Asha Menon', origin: said('The seller is Asha Menon') }], 'model', undefined, { said: message('The seller is Asha Menon', first.userTurn.id, 'sit_s') });
    assert.equal(row!.outcome, 'waiting');
    const out = applyProjectChat(p, 'approve all', { actor: LEAD, chat: { sessionId: 'sit_s', actor: LEAD }, mayDecide: (department) => department === 'legal' });
    assert.doesNotMatch(out.assistantTurn.text, /Nothing was accepted/, out.assistantTurn.text);
    const record = p.fieldSheets!['shared.parties']!.records![0]!;
    assert.equal(fieldState(record.values.name), 'accepted');
  });
});

describe('a model reply to an outside collaborator', () => {
  it('links to no register of the firm’s own', () => {
    const p = project();
    const risk = createChatProposal('add_risk', 'Add risk: the drain crosses the plot', 'Said in the chat.', 'Adds a risk.', { title: 'the drain crosses the plot' }, OTHER);
    const theirs = applyProjectAgentTurn(p, 'the drain crosses the plot', { text: 'Sent to the firm.', proposals: [risk], navigations: [] }, { turnId: 'cht_out', sessionId: 'sit_out' }, { outside: true });
    assert.equal(theirs.assistantTurn.suggested, undefined);
    const staff = createChatProposal('add_risk', 'Add risk: the lift may be late', 'Said in the chat.', 'Adds a risk.', { title: 'the lift may be late' }, LEAD);
    const ours = applyProjectAgentTurn(p, 'the lift may be late', { text: 'Suggested.', proposals: [staff], navigations: [] }, { turnId: 'cht_in', sessionId: 'sit_in' });
    assert.deepEqual(ours.assistantTurn.suggested?.map((line) => line.words), ['Suggested a risk on Risks and actions']);
  });
});

describe('what the next-step rules raise on their own', () => {
  it('carries no chat message, so a chat’s strip and Accept all leave it where it waits', () => {
    const p = project();
    const out = sayIn(p, 'what next?', { sessionId: 'sit_next', place: { pane: 'overview' } });
    assert.ok(out.proposals.length, out.assistantTurn.text);
    for (const card of out.proposals) assert.equal(card.chat, undefined, card.title);
    assert.deepEqual(chatWaiting(p, 'sit_next').places, []);
    // What the person's own words ask for still carries their message.
    const owner = sayIn(p, 'Set owner to Priya Shah', { sessionId: 'sit_next' });
    assert.deepEqual(owner.proposals[0]?.chat, { turnId: owner.userTurn.id, sessionId: 'sit_next' });
  });
});

describe('what a collaborator’s chat suggested on their copy', () => {
  it('is offered on the project with its words and message, only on the fields in their reach', () => {
    const p = project();
    const copy = structuredClone(p);
    const words = { turnId: 'cht_copy', text: 'It is freehold, the extent is 5000 square metres', by: 'surveyor@outside.example' };
    const inHand: ChatInHand = { tag: { turnId: words.turnId, sessionId: 'sit_copy' }, by: words.by, message: words.text, at: '2026-11-05T06:00:00.000Z' };
    proposeFieldValues(copy, [{ address: tenure, value: 'freehold', origin: said('It is freehold') }, { address: extent, value: 5000, origin: said('the extent is 5000 square metres') }], 'parser', undefined, { said: inHand });
    const carried = chatValuesCarried(p, copy, words, (_set, field) => field === 'tenure');
    assert.deepEqual(carried.map((row) => [row.address.field, row.outcome]), [['tenure', 'waiting']]);
    const held = p.fieldSheets![HOLDING]!.values;
    assert.deepEqual([fieldState(held.tenure), held.tenure?.origin?.kind, held.tenure?.chat], ['proposed', 'chat', { turnId: 'cht_copy', sessionId: 'sit_copy' }]);
    assert.equal(held.extent, undefined, 'a field out of their reach is not written');
  });
});
