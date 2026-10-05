/**
 * What typed words can do to what waits, and what a pressed choice does.
 *
 * Accepting changes the record without the person touching it. It was read
 * out of any sentence that held "approve", "ok" or "skip", and a rule was
 * added for each sentence found to go wrong: "don't approve this" recorded a
 * value, and so did "can I approve this later?" and a thank-you. Then the
 * forms were closed, and what still went wrong came from finding a card by
 * the words somebody typed: "no", said after "which one?", logged a risk.
 *
 * So typed words do three things: take what the last reply left ("approve
 * all"), take everything open when that is said in full, and take or set
 * aside one card by its exact title in quotes. A bare "yes", a card's name
 * without quotes and a bare "skip" take nothing. Everything else is a choice
 * that is pressed, and a choice carries the ids of what it means.
 *
 * This file is a table: a sentence, the state it is said in, and what must
 * happen, which for most of them is nothing. It holds each form, every
 * sentence that was found doing the wrong thing, and ordinary sentences that
 * mention approving, accepting or skipping without asking for it. The flows
 * that went wrong across several turns follow as scenarios.
 *
 * Every name and number in the papers is invented. Nothing here may reach
 * the network.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  CHOICE_SENTENCE,
  NOTHING_ACCEPTED,
  NOTHING_SET_ASIDE,
  NOTHING_TO_READ,
  WAITING_FROM_EARLIER,
  acceptedFacts,
  addEvidence,
  applyProjectAgentTurn,
  applyProjectChat,
  choiceMayBePressed,
  clearProjectConversation,
  commitChatProposal,
  createChatProposal,
  lastSpokenReply,
  noteProjectEdit,
  parseDocumentText,
  projectNextStep,
  proposedFacts,
  rankTalkSittings,
  readInstruction,
  rejectChatProposal,
  seedBdaReferenceProject,
  seedDemoProject,
  turnChips,
  waitingOnCanvas,
  wantsDeterministicProjectChat,
  type ChatChoice,
  type ChatIngestFile,
  type ChatProposal,
  type ChatSitting,
  type CheckInstance,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type ProjectChatResult,
} from '@realytica/shared';
import { readOntoRegister } from '../apps/api/src/documents/register-read';
import { releaseOcr } from '../apps/api/src/documents/read-text';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error('Reading an instruction reached for the network.');
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await releaseOcr();
});

/** The first lines of a paper of each kind, enough for the reader to know what it is. */
const HEADING = {
  khata: 'KHATA CERTIFICATE\nKhata No. 112/4',
  conversion: 'OFFICIAL MEMORANDUM\nConversion of agricultural land for non-agricultural purposes under Section 95 of the Karnataka Land Revenue Act',
  deed: 'SALE DEED\nThis deed of absolute sale is made and executed',
} as const;

const fact = (key: string, label: string, value: string | number, display = String(value)): DocumentFact => ({
  key,
  label,
  value,
  display,
  page: 1,
  quote: `${label}: ${display}`,
  ...(typeof value === 'number' ? { unit: 'sqm' } : {}),
});

/** A paper as the reader hands it on: what it is, read from its heading, and what it states. */
function paper(fileName: string, kind: keyof typeof HEADING, ...facts: DocumentFact[]): ChatIngestFile {
  const read = parseDocumentText([HEADING[kind]], fileName);
  return {
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    storageKey: `s3://${fileName}`,
    read: { type: read.type, label: read.label, confidence: 0.9, method: 'text', summary: read.summary, facts, flags: [], rowHints: read.rowHints, scopes: read.scopes, evidenceKind: read.evidenceKind },
  };
}

/** A conversion order that states its date: one value waiting on the paper, and one card on the check that can take it. */
const order = (): ChatIngestFile => paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019'));

/** A khata that states an extent: one value waiting on the paper, and one card on the check that can take it. */
const khata = (fileName = 'Khata.pdf', ...more: DocumentFact[]): ChatIngestFile => paper(fileName, 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm'), ...more);

/** A khata that states only a PID. No check takes one, so it leaves a value on the paper and no card. */
const khataWithNoCard = (): ChatIngestFile => paper('Khata.pdf', 'khata', fact('pid', 'PID', '81-120-99'));

const drop = (p: DdProject, ...files: ChatIngestFile[]): ProjectChatResult => applyProjectChat(p, '', { ingest: files });

/** Keep an exchange under a chat, as the route keeps it. */
function kept(out: ProjectChatResult, chat: ChatSitting, actor?: string): ProjectChatResult {
  for (const turn of [out.userTurn, out.assistantTurn]) {
    turn.sessionId = chat.sessionId;
    if (chat.continues) turn.continues = chat.continues;
    if (actor) turn.actor = actor;
  }
  return out;
}

/** What the chat says back. With a chat named, the exchange is kept under it. */
function say(p: DdProject, sentence: string, chat?: ChatSitting): string {
  const out = applyProjectChat(p, sentence, { chat });
  return (chat ? kept(out, chat) : out).assistantTurn.text;
}

/** Press a choice: its sentence goes, and with it what it carries. */
const press = (p: DdProject, choice: ChatChoice): ProjectChatResult => applyProjectChat(p, choice.send, { sitting: choice.sitting });

/** A request for a paper, as a reply raises one. */
const request = (title: string): ChatProposal =>
  createChatProposal('request_evidence', title, 'It is missing.', 'Would write a collection action.', { title, kind: 'evidence_request', owner: 'tester', priority: 'low' }, 'tester');

/** A reply that raised these cards, as a model's does. */
const raise = (p: DdProject, text: string, ...cards: ChatProposal[]): ProjectChatResult => applyProjectAgentTurn(p, 'what is missing?', { text, proposals: cards, navigations: [] });

const rowOf = (p: DdProject, fileName: string): EvidenceRecord => p.evidence.find((e) => e.attachments.some((a) => a.storageKey === `s3://${fileName}`))!;

const checksOf = (p: DdProject): CheckInstance[] => p.assessments.filter((a) => a.status !== 'archived').flatMap((a) => a.scopes.flatMap((s) => s.checks));

const openCards = (p: DdProject): ChatProposal[] => p.chatProposals.filter((c) => c.status === 'proposed');

const toolsOf = (out: ProjectChatResult): string[] => (out.assistantTurn.toolCalls ?? []).map((call) => call.name);

/** The card each of the two papers raises, by the title it is shown under. */
const DATE = 'Record date of the conversion order on “Proposed use matches permitted land use”';
const EXTENT = 'Record extent per khata on “Parcel identification matches title and survey”';

/** The date the order states, once it is on the check it answers. */
const dateOnCheck = (p: DdProject) => checksOf(p).find((c) => c.definitionId === 'regulatory.land_use')!.fields?.conversion_date?.value;

/** The extent a khata states, once it is on the check it answers. */
const extentOnCheck = (p: DdProject) => checksOf(p).find((c) => c.definitionId === 'land_site.parcel_identification')!.fields?.extent_khata?.value;

/* ==================================================================== */
/* The table                                                             */
/* ==================================================================== */

/**
 * Where a sentence is said.
 *
 *  - `one`: the last reply read a conversion order. It left one card, the
 *    order's date, and the date waiting on the paper.
 *  - `two`: the last reply read the order and a khata together. It left two
 *    cards and a value on each paper.
 *  - `earlier`: the order was read, and then a question was answered. The
 *    card waits from the earlier reply, and the last one left nothing.
 *  - `asked`: as `two`, and then "ok", which the chat answered by saying
 *    what waits and offering the choices.
 *  - `theirs`: the order was read in another person's chat. This chat has
 *    said nothing.
 */
type State = 'one' | 'two' | 'earlier' | 'asked' | 'theirs';

type Card = 'date' | 'extent';

type Outcome =
  /** Typed, and these are accepted. Nothing else is. */
  | { accepts: Card[] }
  /** Typed, and these are set aside. Nothing else is. */
  | { setsAside: Card[] }
  /** Nothing is taken. The reply says what waits, and offers these to press: all of the last reply's, or one of its cards. */
  | { to: 'accept' | 'aside'; offers: Array<'all' | Card> }
  /** A typed form with nothing of the last reply's to take. Nothing is taken, and the reply says where the rest waits. */
  | 'nothing left'
  /** Not an instruction, and not answered as one. Nothing is taken and nothing is offered. */
  | 'talk';

const MINE: ChatSitting = { sessionId: 'ses_mine' };

function inState(state: State): { p: DdProject; chat?: ChatSitting } {
  const p = seedBdaReferenceProject();
  if (state === 'theirs') {
    kept(drop(p, order()), { sessionId: 'ses_theirs' }, 'someone.else@example.com');
    return { p, chat: MINE };
  }
  if (state === 'one' || state === 'earlier') drop(p, order());
  else drop(p, order(), khata());
  if (state === 'earlier') applyProjectChat(p, 'what is the land area?');
  if (state === 'asked') applyProjectChat(p, 'ok');
  return { p };
}

const date: Outcome = { accepts: ['date'] };
const both: Outcome = { accepts: ['date', 'extent'] };
const asideDate: Outcome = { setsAside: ['date'] };
/** What is offered where the last reply left one card and its paper's value, or two of each. */
const takeOne: Outcome = { to: 'accept', offers: ['all', 'date'] };
const takeTwo: Outcome = { to: 'accept', offers: ['all', 'date', 'extent'] };
const leaveOne: Outcome = { to: 'aside', offers: ['date'] };
const leaveTwo: Outcome = { to: 'aside', offers: ['date', 'extent'] };

const TABLE: Array<[State, string, Outcome]> = [
  // A. The last reply's.
  ['one', 'approve all', date],
  ['one', 'accept all', date],
  ['one', 'Approve all.', date],
  ['two', 'approve all', both],
  ['two', 'accept all', both],
  ['two', 'approve all of them', both],
  ['two', 'approve all of these', both],
  ['two', 'approve everything', both],
  ['two', 'accept everything', both],
  ['two', 'approve both', both],
  ['two', 'accept both', both],
  ['two', 'approve both of them', both],
  ['two', 'approve both of these', both],
  ['two', 'approve them', both],
  ['two', 'accept them', both],
  ['two', 'approve them all', both],
  ['two', 'approve these', both],
  // It takes the last reply's and no other reply's.
  ['earlier', 'approve all', 'nothing left'],
  ['earlier', 'approve both', 'nothing left'],
  ['theirs', 'approve all', 'nothing left'],

  // B. Everything open, said in full, and in these words only.
  ['earlier', 'approve all open', date],
  ['earlier', 'approve every open one', date],
  ['earlier', 'approve everything open', date],
  ['earlier', 'approve everything waiting', date],
  ['earlier', 'accept all open', date],
  ['earlier', 'accept every open one', date],
  ['earlier', 'accept everything open', date],
  ['earlier', 'accept everything waiting', date],
  ['theirs', 'approve all open', date],
  ['two', 'approve everything open', both],
  ['one', 'approve the entire extent', takeOne],
  ['one', 'approve the extent for every parcel', takeOne],
  ['one', 'approve all now', takeOne],
  ['earlier', 'approve the entire extent', 'talk'],
  ['earlier', 'approve the extent for every parcel', 'talk'],

  // C. One card, by its exact title in quotes, when the last reply listed it.
  ['one', `approve "${DATE}"`, date],
  ['one', `accept "${DATE}"`, date],
  ['one', `Approve “${DATE}”`, date],
  ['two', `approve "${EXTENT}"`, { accepts: ['extent'] }],
  ['asked', `Approve “${EXTENT}”`, { accepts: ['extent'] }],
  ['one', `skip "${DATE}"`, asideDate],
  ['one', `Skip “${DATE}”`, asideDate],
  ['one', `reject "${DATE}"`, asideDate],
  ['one', `set aside "${DATE}"`, asideDate],
  ['two', `skip "${EXTENT}"`, { setsAside: ['extent'] }],
  // A title the last reply did not list is not taken by typing it, whoever raised the card.
  ['earlier', `approve "${DATE}"`, 'nothing left'],
  ['theirs', `approve "${DATE}"`, 'nothing left'],
  ['earlier', `skip "${DATE}"`, 'nothing left'],
  // Part of a title, or a title no card has, is not a title.
  ['one', 'approve "Record date"', takeOne],
  ['one', 'approve "the conversion order"', takeOne],
  ['one', 'approve "no card is called this"', takeOne],
  ['one', 'skip "the conversion order"', leaveOne],

  // A name without quotes takes nothing, however many of a card's words it holds.
  ['two', 'approve the conversion order date', takeTwo],
  ['two', 'accept the date of the conversion order', takeTwo],
  ['two', 'approve the khata extent', takeTwo],
  ['two', 'approve extent per khata', takeTwo],
  ['two', 'approve the record', takeTwo],
  ['two', 'approve the survey number', takeTwo],
  ['two', 'accept the title and survey', takeTwo],
  ['two', 'approve the land use', takeTwo],
  ['two', 'accept the occupancy certificate', takeTwo],
  ['two', 'skip the survey', leaveTwo],
  ['two', 'skip the conversion order date', leaveTwo],
  ['one', 'approve the khata one', takeOne],
  ['one', 'skip the site visit', leaveOne],
  ['one', 'reject all', leaveOne],
  // Where the last reply left nothing, the same words are about the project and not about a card.
  ['earlier', 'approve the conversion order date', 'talk'],
  ['earlier', 'accept the title and survey', 'talk'],
  ['earlier', 'skip the survey', 'talk'],
  ['earlier', 'skip the conversion order date', 'talk'],
  ['earlier', 'set aside 10 lakh for contingencies', 'talk'],
  ['earlier', 'reject the contractor’s variation claim', 'talk'],
  ['one', 'set aside 10 lakh for contingencies', leaveOne],
  ['one', 'reject the contractor’s variation claim', leaveOne],

  // Assent takes nothing. Where the last reply left something, what can be pressed is offered.
  ['one', 'yes', takeOne],
  ['one', 'ok', takeOne],
  ['one', 'okay', takeOne],
  ['one', 'go ahead', takeOne],
  ['one', 'do it', takeOne],
  ['one', 'do that', takeOne],
  ['one', 'record it', takeOne],
  ['one', 'yes that’s right', takeOne],
  ['one', "yes that's right", takeOne],
  ['one', 'ok record it', takeOne],
  ['one', 'yes do that', takeOne],
  ['one', 'go ahead and record it', takeOne],
  ['one', 'Yes.', takeOne],
  ['one', 'OK!', takeOne],
  ['one', 'ok please', takeOne],
  ['one', 'please go ahead', takeOne],
  ['one', 'yes, go ahead', takeOne],
  ['one', 'yes yes', takeOne],
  ['one', 'ok 👍', takeOne],
  ['one', 'approve', takeOne],
  ['one', 'accept', takeOne],
  ['one', 'approve this', takeOne],
  ['one', 'accept it', takeOne],
  ['one', 'ok, approve it', takeOne],
  ['two', 'yes', takeTwo],
  ['two', 'ok', takeTwo],
  ['two', 'go ahead', takeTwo],
  ['two', 'approve', takeTwo],
  ['two', 'approve this', takeTwo],
  // Where it left nothing, "yes" answers whatever the chat said, and is talk.
  ['earlier', 'ok', 'talk'],
  ['earlier', 'yes', 'talk'],
  ['earlier', 'go ahead', 'talk'],
  ['earlier', 'approve', 'talk'],
  ['theirs', 'ok', 'talk'],
  ['theirs', 'yes', 'talk'],
  // A thank-you is not assent, and neither is a question.
  ['one', 'ok thanks', 'talk'],
  ['one', 'Okay, thank you.', 'talk'],
  ['one', 'yes, thank you', 'talk'],
  ['one', 'ok?', 'talk'],
  ['one', 'yes?', 'talk'],
  ['one', 'ok?!', 'talk'],
  ['one', 'can you go ahead?', 'talk'],

  // A form with words in front of it is not the form. It takes nothing, and the choices are offered.
  ['two', 'go ahead and approve all', takeTwo],
  ['two', 'just approve all', takeTwo],
  ['two', 'I approve all', takeTwo],
  ['two', 'sure, approve all', takeTwo],
  ['two', 'thanks, approve all', takeTwo],
  ['two', 'I think we can approve all open', takeTwo],
  ['one', `sure, approve "${DATE}"`, takeOne],
  ['one', 'approve all, thanks', takeOne],
  ['one', 'approve all and tell me what is next', takeOne],
  ['one', 'approve all but the khata', takeOne],

  // "Please", and a leading "ok", "okay" or "yes", stand around a form. A form asked for politely is still one.
  ['two', 'please approve all', both],
  ['two', 'ok, approve all', both],
  ['two', 'okay approve both', both],
  ['two', 'yes, approve all please.', both],
  ['two', 'can you approve all?', both],
  ['two', 'could you approve all', both],
  // "Would you" wonders about a form, and everything open is never asked for with a question: both are offered, not done.
  ['two', 'would you accept all of them?', takeTwo],
  ['two', 'would you approve them?', takeTwo],
  ['two', 'would you approve all', takeTwo],
  ['two', 'will you approve all?', both],
  ['two', 'can you approve all open?', takeTwo],
  ['two', 'would you accept everything waiting?', takeTwo],
  ['two', 'could you approve everything open?', takeTwo],
  // A closing symbol says something the words did not.
  ['two', 'approve all ❌', takeTwo],
  ['two', 'approve all 👎', takeTwo],
  ['two', 'approve all 👍', takeTwo],
  ['two', 'approve all :)', both],
  ['one', `can you skip "${DATE}"?`, asideDate],
  // A question is a question, with whatever mark it is closed.
  ['two', 'approve all?', 'talk'],
  ['two', 'approve both?', 'talk'],
  ['two', 'approve all?!', 'talk'],
  ['two', 'approve all!?', 'talk'],
  ['two', 'approve all؟', 'talk'],
  ['two', 'approve all？', 'talk'],
  ['two', 'approve all❓', 'talk'],
  ['two', 'approve all ❔', 'talk'],
  ['two', 'will you approve the conversion order date?', 'talk'],
  ['one', 'can you skip it?', 'talk'],

  // Setting aside with nothing in quotes takes nothing.
  ['one', 'skip', leaveOne],
  ['one', 'no thanks', leaveOne],
  ['one', 'no thank you', leaveOne],
  ['one', 'set aside', leaveOne],
  ['one', 'reject', leaveOne],
  ['one', 'skip it', leaveOne],
  ['one', 'skip this one', leaveOne],
  ['one', 'reject this', leaveOne],
  ['one', 'set it aside', leaveOne],
  ['one', 'ok skip', leaveOne],
  ['one', 'No thanks.', leaveOne],
  ['one', 'could you skip it', leaveOne],
  ['two', 'skip', leaveTwo],
  ['two', 'no thanks', leaveTwo],
  // And where the last reply left nothing it is talk: never a card from an earlier reply, another chat or another person.
  ['earlier', 'skip', 'talk'],
  ['earlier', 'no thanks', 'talk'],
  ['theirs', 'skip', 'talk'],
  ['theirs', 'no thanks', 'talk'],
  ['theirs', 'reject', 'talk'],

  // After the chat has offered the choices, a word typed back is not one of them.
  ['asked', 'all', 'talk'],
  ['asked', 'both', 'talk'],
  ['asked', 'everything', 'talk'],
  ['asked', 'all of them', 'talk'],
  ['asked', 'the conversion order date', 'talk'],
  ['asked', 'the khata extent', 'talk'],
  ['asked', 'extent per khata', 'talk'],
  ['asked', `“${DATE}”`, 'talk'],
  ['asked', 'no', 'talk'],
  ['asked', 'No.', 'talk'],
  ['asked', 'no please', 'talk'],
  ['asked', 'ok no', 'talk'],
  ['asked', 'no risk', 'talk'],
  ['asked', 'title', 'talk'],
  ['asked', 'survey', 'talk'],
  ['asked', 'parcel', 'talk'],
  ['asked', 'land', 'talk'],
  ['asked', 'use', 'talk'],
  ['asked', 'record', 'talk'],
  ['asked', 'the survey number', 'talk'],
  ['asked', 'what is the land area?', 'talk'],
  // The typed forms still are, and they answer the reply before the one that offered.
  ['asked', 'approve all', both],
  ['asked', 'Approve all', both],
  ['asked', 'ok', takeTwo],
  // The sentence a choice sends does nothing typed: it is the ids beside it that act.
  ['two', CHOICE_SENTENCE.all, 'talk'],
  ['two', CHOICE_SENTENCE.one, 'talk'],
  ['two', CHOICE_SENTENCE.aside, 'talk'],

  // A no, a condition or a time other than now, whatever verb the sentence holds.
  ['one', "don't approve this", 'talk'],
  ['one', 'do not approve this yet', 'talk'],
  ['one', "I can't approve this without the original", 'talk'],
  ['one', 'do I have to approve this?', 'talk'],
  ['one', 'can I approve this later?', 'talk'],
  ['one', 'I will approve this after the site visit', 'talk'],
  ['one', 'before I approve this, show me the page', 'talk'],
  ['one', "don't accept this", 'talk'],
  ['two', "don't approve all", 'talk'],
  ['two', 'if I approve all what happens', 'talk'],
  ['two', "don't approve the conversion order date", 'talk'],
  ['two', 'approve the decision if the conversion order is in hand', 'talk'],
  ['one', 'approve this later', 'talk'],
  ['one', 'accept it if the dates match', 'talk'],
  ['one', 'approve nothing until the survey is back', 'talk'],
  ['one', "I'll approve all tomorrow", 'talk'],
  ['one', 'should I approve all', 'talk'],
  ['one', 'never approve this', 'talk'],
  ['one', 'approve this but not the khata', 'talk'],
  ['one', 'we cannot accept this', 'talk'],
  ['one', "I won't approve this", 'talk'],
  ['one', 'approve this without the survey', 'talk'],
  ['one', 'approve it before the visit', 'talk'],
  ['one', 'approve this after lunch', 'talk'],
  ['one', 'approve this whether or not the khata agrees', 'talk'],
  ['one', 'I would approve all', 'talk'],
  ['one', 'skip it when the original arrives', 'talk'],
  ['one', 'no thanks, I will do it later', 'talk'],
  ['one', 'can we skip the site visit for now?', 'talk'],
  ['one', 'don’t skip the encumbrance certificate', 'talk'],
  ['one', 'what happens if I skip a check?', 'talk'],

  // Words the older reader took, and words near the forms that are not the forms.
  ['one', 'commit all', 'talk'],
  ['one', 'dismiss', 'talk'],
  ['one', 'sure', 'talk'],
  ['one', 'ok then', 'talk'],
  ['one', 'ok great', 'talk'],
  ['one', 'do it now', 'talk'],
  ['one', 'no', 'talk'],
  ['one', 'approved', 'talk'],
  ['one', 'record the date', 'talk'],

  // Ordinary sentences that mention approving, accepting, skipping, ok or yes.
  ['one', 'who has to approve the building plan?', 'talk'],
  ['one', 'the bank will approve the loan next week', 'talk'],
  ['one', 'is it ok to build before the conversion order comes?', 'talk'],
  ['one', 'ok what does the khata say about the extent', 'talk'],
  ['one', 'yes but is the conversion order date right', 'talk'],
  ['one', 'did the authority accept the revised drawings?', 'talk'],
  ['one', 'the seller says yes to the price', 'talk'],
  ['one', 'we cannot skip the encumbrance search', 'talk'],
  ['one', 'approval from the fire department is still pending', 'talk'],
  ['one', 'the plan was approved in 2019', 'talk'],
  ['one', 'should we accept the seller’s survey?', 'talk'],
  ['one', 'I accept that the title is weak', 'talk'],
  ['one', 'tell me when the plan is approved', 'talk'],
  ['one', 'go ahead and tell me what the khata says', 'talk'],
  ['one', 'ok ಖಾತಾ ಏನು ಹೇಳುತ್ತದೆ', 'talk'],
];

describe('a sentence, where it is said, and what it does', () => {
  for (const [state, sentence, outcome] of TABLE) {
    it(`${state}: ${sentence}`, () => {
      const { p, chat } = inState(state);
      const card = { date: openCards(p).find((c) => c.title === DATE), extent: openCards(p).find((c) => c.title === EXTENT) };
      const instruction = wantsDeterministicProjectChat(p, sentence, { chat });
      const out = applyProjectChat(p, sentence, { chat });
      const tools = toolsOf(out);

      const accepted: Card[] = [...(dateOnCheck(p) === '2019-04-02' ? (['date'] as const) : []), ...(extentOnCheck(p) === 1850 ? (['extent'] as const) : [])];
      const setAside: Card[] = (['date', 'extent'] as const).filter((key) => card[key]?.status === 'rejected');
      assert.deepEqual(accepted, typeof outcome === 'object' && 'accepts' in outcome ? outcome.accepts : [], 'what was accepted');
      assert.deepEqual(setAside, typeof outcome === 'object' && 'setsAside' in outcome ? outcome.setsAside : [], 'what was set aside');

      if (outcome === 'talk') {
        assert.ok(!tools.includes(NOTHING_ACCEPTED) && !tools.includes(NOTHING_SET_ASIDE) && !tools.includes('approve'), `it is answered as talk, and was answered: ${out.assistantTurn.text}`);
        assert.ok(!(out.assistantTurn.choices ?? []).some((choice) => choice.sitting?.decision), 'and nothing is offered to accept or set aside');
        return;
      }
      assert.equal(instruction, true, 'it is answered here, and no model reads it');
      if (outcome === 'nothing left') {
        assert.equal(tools.length, 1);
        assert.ok(tools[0] === NOTHING_ACCEPTED || tools[0] === NOTHING_SET_ASIDE, out.assistantTurn.text);
        assert.deepEqual(out.assistantTurn.choices ?? [], []);
      } else if ('offers' in outcome) {
        assert.deepEqual(tools, [outcome.to === 'accept' ? NOTHING_ACCEPTED : NOTHING_SET_ASIDE], out.assistantTurn.text);
        const offered = (out.assistantTurn.choices ?? []).map((choice) => {
          assert.equal(choice.sitting?.decision, outcome.to);
          const ids = choice.sitting?.proposalIds ?? [];
          if (ids.length !== 1 || (choice.sitting?.evidenceIds ?? []).length) return 'all';
          return ids[0] === card.date?.id ? 'date' : ids[0] === card.extent?.id ? 'extent' : ids[0];
        });
        assert.deepEqual(offered, outcome.offers);
        assert.deepEqual(out.assistantTurn.proposalIds ?? [], [], 'it raises nothing of its own');
      }
    });
  }

  it('reads the three forms off the words alone, and a card’s name off none', () => {
    assert.deepEqual(readInstruction('approve all'), { verb: 'accept', form: 'last' });
    assert.deepEqual(readInstruction('accept everything waiting'), { verb: 'accept', form: 'open' });
    assert.deepEqual(readInstruction('set aside "Request the survey sketch"'), { verb: 'aside', form: 'titled', title: 'Request the survey sketch' });
    for (const sentence of ['ok', 'approve the land use', 'just approve all', 'skip', 'no thanks']) assert.equal(readInstruction(sentence)?.form, 'unclear', sentence);
    for (const sentence of ['no', 'the land use', 'approve all?', "don't approve all"]) assert.equal(readInstruction(sentence), undefined, sentence);
  });
});

/* ==================================================================== */
/* A choice that is pressed                                              */
/* ==================================================================== */

describe('a choice that is pressed', () => {
  /** The order and a khata read together, then "ok": the reply that offers the choices. */
  const offered = (): { p: DdProject; all: ChatChoice; date: ChatChoice; extent: ChatChoice } => {
    const p = seedBdaReferenceProject();
    drop(p, order(), khata());
    const [all, date, extent] = applyProjectChat(p, 'ok').assistantTurn.choices!;
    return { p, all: all!, date: date!, extent: extent! };
  };

  it('says what it would take, and carries it by id', () => {
    const { p, all, date, extent } = offered();
    const cards = openCards(p);
    assert.deepEqual(
      [all, date, extent].map((choice) => [choice.label, choice.detail, choice.send, choice.kind]),
      [
        ['All 4 from the last reply', '1 on the Title documents, 1 on the Approvals documents, 1 on the Approvals checks and 1 on the Title checks', CHOICE_SENTENCE.all, 'accept'],
        [DATE, 'Waiting on the Approvals checks, from Conversion order.pdf', CHOICE_SENTENCE.one, 'accept'],
        [EXTENT, 'Waiting on the Title checks, from Khata.pdf', CHOICE_SENTENCE.one, 'accept'],
      ],
    );
    assert.deepEqual(all.sitting, {
      decision: 'accept',
      proposalIds: cards.map((c) => c.id),
      evidenceIds: [rowOf(p, 'Khata.pdf').id, rowOf(p, 'Conversion order.pdf').id],
    });
    assert.deepEqual(date.sitting, { decision: 'accept', proposalIds: [cards.find((c) => c.title === DATE)!.id] });
    assert.deepEqual(extent.sitting, { decision: 'accept', proposalIds: [cards.find((c) => c.title === EXTENT)!.id] });
  });

  it('takes the one card it names', () => {
    const { p, extent } = offered();
    assert.equal(press(p, extent).assistantTurn.text, 'Recorded values on 1 check. 2 more are waiting: 1 on the Approvals documents and 1 on the Approvals checks.');
    assert.equal(extentOnCheck(p), 1850);
    assert.equal(dateOnCheck(p), undefined);
  });

  it('takes what it names after other replies have come, and nothing of theirs', () => {
    const { p, all } = offered();
    // Another paper is read, and it is now the last reply. It leaves two values of its own.
    drop(p, paper('Sale deed.pdf', 'deed', fact('vendor', 'Vendor', 'A. Example'), fact('purchaser', 'Purchaser', 'B. Example')));
    assert.equal(proposedFacts(rowOf(p, 'Sale deed.pdf')).length, 2);

    press(p, all);
    assert.equal(dateOnCheck(p), '2019-04-02');
    assert.equal(extentOnCheck(p), 1850);
    assert.equal(proposedFacts(rowOf(p, 'Sale deed.pdf')).length, 2, 'the later reply’s paper was not what the choice named');
  });

  it('says so when what it names is no longer waiting, and takes nothing in its place', () => {
    const { p, all, date } = offered();
    press(p, all);
    // A card raised since then is waiting. It is not what either choice named.
    const later = openCards(p);
    assert.ok(later.length > 0);

    const again = press(p, all);
    assert.equal(again.assistantTurn.text, 'That is no longer waiting, so nothing was accepted.');
    assert.deepEqual(toolsOf(again), [NOTHING_ACCEPTED]);
    assert.equal(press(p, date).assistantTurn.text, 'That is no longer waiting, so nothing was accepted.');
    assert.deepEqual(openCards(p), later);
  });

  it('sets aside the one card it names, and only while it waits', () => {
    const p = seedBdaReferenceProject();
    drop(p, order(), khata());
    const [date, extent] = applyProjectChat(p, 'skip').assistantTurn.choices!;
    assert.deepEqual([date, extent].map((choice) => [choice!.label, choice!.send, choice!.kind, choice!.sitting?.decision]), [
      [DATE, CHOICE_SENTENCE.aside, 'set aside', 'aside'],
      [EXTENT, CHOICE_SENTENCE.aside, 'set aside', 'aside'],
    ]);

    assert.equal(press(p, extent!).assistantTurn.text, `Skipped “${EXTENT}”.`);
    assert.deepEqual(openCards(p).map((c) => c.title), [DATE]);
    const again = press(p, extent!);
    assert.equal(again.assistantTurn.text, 'That is no longer waiting, so nothing was set aside.');
    assert.deepEqual(toolsOf(again), [NOTHING_SET_ASIDE]);
    assert.deepEqual(openCards(p).map((c) => c.title), [DATE]);
  });

  it('takes, for an outside collaborator, only a paper a reply to them filed', () => {
    const p = seedBdaReferenceProject();
    // Their own paper, read in their own chat, and one of the firm's that is in their grant.
    drop(p, order());
    const theirs = rowOf(p, 'Conversion order.pdf');
    const firms = addEvidence(p, { title: 'Khata certificate', kind: 'document', status: 'received' });
    firms.facts = [{ ...fact('pid', 'PID', '81-120-99'), review: 'proposed' }];

    applyProjectChat(p, CHOICE_SENTENCE.all, { outside: true, sitting: { decision: 'accept', proposalIds: [], evidenceIds: [firms.id] } });
    assert.equal(proposedFacts(firms).length, 1, 'ids put together by hand do not reach the firm’s paper');
    applyProjectChat(p, CHOICE_SENTENCE.all, { outside: true, sitting: { decision: 'accept', proposalIds: [], evidenceIds: [theirs.id] } });
    assert.equal(proposedFacts(theirs).length, 0);
  });

  it('is not the words: the same sentence with no ids beside it does nothing', () => {
    const { p, all } = offered();
    const typed = applyProjectChat(p, all.send);
    assert.ok(!toolsOf(typed).includes('approve'));
    assert.equal(dateOnCheck(p), undefined);
    assert.equal(wantsDeterministicProjectChat(p, all.send), false, 'typed, it is talk');
    assert.equal(wantsDeterministicProjectChat(p, all.send, { sitting: all.sitting }), true, 'pressed, it is carried out here');
  });

  it('tells two cards with one title apart', () => {
    const p = seedBdaReferenceProject();
    const first = request('Request the survey sketch');
    const second = request('Request the survey sketch');
    const reply = raise(p, 'Two sketches are missing.', first);
    // A second card under the same title, listed by the same reply.
    p.chatProposals.push(second);
    reply.assistantTurn.proposalIds = [first.id, second.id];

    // The title is two cards' title, so typing it takes neither.
    const typed = applyProjectChat(p, 'approve "Request the survey sketch"');
    assert.deepEqual(toolsOf(typed), [NOTHING_ACCEPTED]);
    assert.deepEqual([first.status, second.status], ['proposed', 'proposed']);

    const choices = typed.assistantTurn.choices!.filter((choice) => choice.sitting?.proposalIds?.length === 1);
    assert.deepEqual(choices.map((choice) => choice.label), ['Request the survey sketch', 'Request the survey sketch']);
    press(p, choices[1]!);
    assert.deepEqual([first.status, second.status], ['proposed', 'committed'], 'the one that was pressed, by its id');
  });

  it('names the values a card records, and the paper each came from', () => {
    const p = seedBdaReferenceProject();
    // Two khatas read together that state different extents: two cards under one title.
    drop(p, khata('Khata 2019.pdf'), paper('Khata 2024.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1900, '1,900 sqm')));
    const choices = applyProjectChat(p, 'ok').assistantTurn.choices!.filter((choice) => choice.sitting?.proposalIds?.length === 1 && !choice.sitting.evidenceIds?.length);
    assert.deepEqual(choices.map((choice) => [choice.label, choice.detail]), [
      [EXTENT, 'Waiting on the Title checks, from Khata 2019.pdf'],
      [EXTENT, 'Waiting on the Title checks, from Khata 2024.pdf'],
    ]);
    assert.notDeepEqual(choices[0]!.sitting, choices[1]!.sitting);

    // A card that records several values says which, where its title says only how many.
    const q = seedBdaReferenceProject();
    drop(q, khata('Khata.pdf', fact('survey_numbers', 'Survey number', '41/1', 'Sy. No. 41/1')), order());
    const several = openCards(q).find((c) => /^Record 2 values on /.test(c.title))!;
    const choice = applyProjectChat(q, 'ok').assistantTurn.choices!.find((c) => c.sitting?.proposalIds?.length === 1 && c.sitting.proposalIds[0] === several.id)!;
    assert.match(choice.label, /^Record .+ and .+ on “Parcel identification matches title and survey”$/);
    assert.doesNotMatch(choice.label, /2 values/);
  });

  it('is a button only under the last thing the chat on screen said', () => {
    const accept: ChatChoice = { id: 'take_0', label: DATE, send: CHOICE_SENTENCE.one, sitting: { decision: 'accept', proposalIds: ['prp_x'] } };
    const aside: ChatChoice = { id: 'take_0', label: DATE, send: CHOICE_SENTENCE.aside, sitting: { decision: 'aside', proposalIds: ['prp_x'] } };
    const other: ChatChoice = { id: 'rec_0', label: 'Title', send: 'open Title' };
    const onScreen = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
      // A question on its way: the reply before it is still the last thing said.
      { id: 'u3', role: 'user' },
    ];
    for (const choice of [accept, aside]) {
      assert.equal(choiceMayBePressed(choice, { id: 'a2' }, onScreen, false), true);
      assert.equal(choiceMayBePressed(choice, { id: 'a1' }, onScreen, false), false, 'under an older reply it is words');
      assert.equal(choiceMayBePressed(choice, { id: 'a2' }, onScreen, true), false, 'and so it is in an earlier chat being read');
    }
    // A choice that only asks or opens stays a button wherever it is.
    assert.equal(choiceMayBePressed(other, { id: 'a1' }, onScreen, false), true);
    assert.equal(choiceMayBePressed(other, { id: 'a1' }, onScreen, true), true);
  });

  it('sends a sentence the older code in production reads as nothing', () => {
    /*
     * Production draws a stored choice as a button and sends its sentence to
     * its own reader. These are that reader's tests, as they stand there: the
     * words it takes for approving and for setting aside, and the verbs it
     * takes, beside anything in quotes, for a check to be recorded.
     */
    const readInProduction = [
      /^(yes|ok|okay|do it|go ahead)([.! ]|$)/,
      /\bapprove(\s+all)?\b/,
      /^(accept|commit)\b/,
      /\b(accept|commit) (this|all|the|it)\b/,
      /\b(reject|skip|dismiss|no thanks)\b/,
      /\b(mark|set|record|tick|cross|close|complete|conclude|note)\b/,
    ];
    // Cards whose titles hold every one of those words.
    const titles = [
      'Approve the revised plan',
      'Accept the seller’s terms',
      'Skip the second survey',
      'Reject the variation claim',
      'Commit the budget for the podium',
      'Record the check as compliant',
      'Close the action on the fire NOC',
      'OK to dismiss the objection',
    ];
    const p = seedBdaReferenceProject();
    raise(p, 'Eight things.', ...titles.slice(0, 4).map(request));
    const first = [...applyProjectChat(p, 'ok').assistantTurn.choices!, ...applyProjectChat(p, 'skip').assistantTurn.choices!];
    raise(p, 'And four more.', ...titles.slice(4).map(request));
    const second = [...applyProjectChat(p, 'ok').assistantTurn.choices!, ...applyProjectChat(p, 'skip').assistantTurn.choices!];
    drop(p, order(), khata());
    const third = [...applyProjectChat(p, 'ok').assistantTurn.choices!, ...applyProjectChat(p, 'skip').assistantTurn.choices!];

    const stored = p.conversation.flatMap((turn) => turn.choices ?? []).filter((choice) => choice.sitting?.decision);
    assert.equal(stored.length, first.length + second.length + third.length);
    assert.ok(stored.length >= 20);
    for (const choice of stored) {
      assert.ok(Object.values(CHOICE_SENTENCE).includes(choice.send as never), choice.send);
      for (const test of readInProduction) assert.doesNotMatch(choice.send.toLowerCase(), test, choice.label);
      assert.doesNotMatch(choice.send, /["“”]/, 'and it quotes nothing');
    }
  });
});

/* ==================================================================== */
/* A paper said to have arrived                                          */
/* ==================================================================== */

describe('a paper said to have arrived', () => {
  /** A project that is waiting for an occupancy certificate and a block plan. */
  const waitingFor = (): DdProject => {
    const p = seedBdaReferenceProject();
    addEvidence(p, { title: 'OC', kind: 'document', status: 'expected' });
    addEvidence(p, { title: 'Block plan', kind: 'document', status: 'expected' });
    return p;
  };
  const marked = (p: DdProject) => openCards(p).map((c) => c.title).filter((title) => title.startsWith('Mark '));

  it('is offered to be marked received when the whole sentence says so', () => {
    for (const [sentence, title] of [
      ['I have the OC', 'OC'],
      ['we have the OC now', 'OC'],
      ['We received the block plan today.', 'Block plan'],
      ['I got the block plan', 'Block plan'],
      ['we have received our OC', 'OC'],
      ['I’ve got the OC', 'OC'],
    ] as const) {
      const p = waitingFor();
      applyProjectChat(p, sentence);
      assert.deepEqual(marked(p), [`Mark “${title}” received`], sentence);
    }
  });

  it('is not when it is needed, promised, applied for, or part of something else', () => {
    for (const sentence of [
      'the seller will have the OC next month',
      'we need to have the OC by June',
      'we have filed the OC application',
      'nobody has received the OC',
      'I have the OC checklist from the architect',
      // "documents" holds the letters of the paper's title.
      'I have the documents now',
      // The sentence the page sends after a large file.
      'Read the filed documents',
      'I have a question about the block plan',
      'we received the block plan yesterday from the architect',
      'do we have the OC',
      'have you got the OC?',
      'we have the OC?!',
      'when will we have the block plan',
      'we have not received the OC',
      'we haven’t got the block plan',
      'I will have the OC by Friday',
    ]) {
      const p = waitingFor();
      applyProjectChat(p, sentence);
      assert.deepEqual(marked(p), [], sentence);
    }
  });

  it('is not what an assent to the next reply then marks received', () => {
    for (const [sentence, assent] of [
      ['I have the documents now', 'ok'],
      ['Read the filed documents', 'approve all'],
      ['I have a question about the block plan', 'yes'],
    ] as const) {
      const p = waitingFor();
      applyProjectChat(p, sentence);
      applyProjectChat(p, assent);
      assert.ok(p.evidence.filter((e) => e.title === 'OC' || e.title === 'Block plan').every((e) => e.status === 'expected'), `${sentence}, then ${assent}`);
    }
  });
});

/* ==================================================================== */
/* Across several turns                                                  */
/* ==================================================================== */

describe('“approve all”, offered and then said', () => {
  it('takes what the reply before the offer left', () => {
    const p = seedBdaReferenceProject();
    drop(p, order(), khata());
    const asked = applyProjectChat(p, 'ok');
    assert.equal(
      asked.assistantTurn.text,
      'Nothing was accepted. 4 are waiting: 1 on the Title documents, 1 on the Approvals documents, 1 on the Approvals checks and 1 on the Title checks. Pick what to accept below, or accept each where it is shown.',
    );
    assert.deepEqual(asked.assistantTurn.toolCalls, [{ name: NOTHING_ACCEPTED, summary: 'Nothing accepted' }]);

    // The reply that offered the choices is not the reply "approve all" answers.
    assert.equal(say(p, 'approve all'), 'Accepted 2 values on 2 documents.');
    assert.equal(dateOnCheck(p), '2019-04-02');
    assert.equal(extentOnCheck(p), 1850);
  });

  it('takes it after a sentence that only looked like it', () => {
    for (const almost of ['go ahead and approve all', 'just approve all', 'I approve all', 'sure, approve all', 'approve the survey number']) {
      const p = seedBdaReferenceProject();
      drop(p, order(), khata());
      // It takes nothing and raises nothing, so the reply before it is still the last reply.
      const out = applyProjectChat(p, almost);
      assert.deepEqual(toolsOf(out), [NOTHING_ACCEPTED], almost);
      assert.deepEqual(openCards(p).map((c) => c.title), [DATE, EXTENT], almost);

      assert.equal(say(p, 'approve all'), 'Accepted 2 values on 2 documents.', almost);
    }
  });

  it('says so once more than four are left, with where the rest wait', () => {
    const p = seedBdaReferenceProject();
    const cards = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].map((n) => request(`Request the ${n} paper`));
    raise(p, 'Six papers are missing.', ...cards);
    const out = applyProjectChat(p, 'ok');
    assert.equal(
      out.assistantTurn.text,
      'Nothing was accepted. 6 are waiting: 6 under Risks and actions. Pick what to accept below, or accept each where it is shown. Four from the last reply are below, and 2 more waiting under Risks and actions.',
    );
    const [all, ...each] = out.assistantTurn.choices!;
    assert.deepEqual(all!.sitting?.proposalIds, cards.map((card) => card.id), 'all six, though four are shown');
    assert.deepEqual(each.map((choice) => choice.sitting?.proposalIds), cards.slice(0, 4).map((card) => [card.id]));
  });

  it('offers nobody a card that is an admin’s, to accept or to set aside', () => {
    const p = seedBdaReferenceProject();
    const admins = createChatProposal('set_departments', 'Run Engineering only', 'Asked for in chat.', 'The project shows one department.', { departments: ['construction'] }, 'tester');
    const fireNoc = request('Request the fire NOC');
    raise(p, 'Both are waiting.', admins, fireNoc);

    for (const sentence of ['ok', 'skip']) {
      const offered = applyProjectChat(p, sentence).assistantTurn.choices!;
      assert.deepEqual(offered.map((choice) => choice.sitting?.proposalIds), [[fireNoc.id]], sentence);
    }
    // Named by its title, or by an id put where a choice's would be, it is still an admin's.
    assert.equal(say(p, 'approve "Run Engineering only"'), '“Run Engineering only” is for a workspace admin to accept. It waits where it is shown.');
    assert.equal(say(p, 'skip "Run Engineering only"'), '“Run Engineering only” is for a workspace admin to set aside. It waits where it is shown.');
    applyProjectChat(p, CHOICE_SENTENCE.aside, { sitting: { decision: 'aside', proposalIds: [admins.id] } });
    applyProjectChat(p, CHOICE_SENTENCE.one, { sitting: { decision: 'accept', proposalIds: [admins.id] } });
    assert.equal(admins.status, 'proposed');

    say(p, 'approve all');
    assert.equal(fireNoc.status, 'committed');
    assert.equal(admins.status, 'proposed', '"all" leaves it waiting');
  });

  it('is not answered by a word typed back, though a card has the word in its title', () => {
    for (const word of ['no', 'No.', 'no please', 'ok no', 'no risk', 'risk', 'access road']) {
      const p = seedBdaReferenceProject();
      const risk = createChatProposal(
        'add_risk',
        'Log risk: no access road to the site',
        'The approach is across a neighbour’s plot.',
        'Creates an open risk on the register.',
        { title: 'No access road to the site', category: 'operational', cause: 'The approach is across a neighbour’s plot.', impactType: 'operational', probability: 'possible', impactScore: 3, materiality: 'medium', owner: 'tester' },
        'tester',
      );
      raise(p, 'Two things.', risk, request('Request the survey sketch'));
      // The chat offers the two to press. What is typed next is not a press.
      assert.equal(applyProjectChat(p, 'ok').assistantTurn.choices!.length, 3, word);
      const risks = p.risks.length;
      const out = applyProjectChat(p, word);
      assert.equal(risk.status, 'proposed', word);
      assert.equal(p.risks.length, risks, `${word}: no risk was logged`);
      assert.ok(!toolsOf(out).includes('approve'), word);
    }
  });

  it('is the firm’s own people’s to say of everything that is open', () => {
    const p = seedBdaReferenceProject();
    drop(p, order());
    const out = applyProjectChat(p, 'approve all open', { outside: true });
    assert.equal(out.assistantTurn.text, 'Only the firm’s own people can accept everything that is open. Nothing was accepted.');
    assert.deepEqual(toolsOf(out), [NOTHING_ACCEPTED]);
    assert.equal(dateOnCheck(p), undefined);
    assert.equal(proposedFacts(rowOf(p, 'Conversion order.pdf')).length, 1);
  });
});

describe('“yes”, to a question the chat asked', () => {
  it('takes nothing, though the reply that asked listed a card', () => {
    const p = seedBdaReferenceProject();
    const card = request('Request the survey sketch');
    raise(p, 'The survey sketch is missing. Shall I also ask the seller for the tippani?', card);

    const out = applyProjectChat(p, 'yes');
    assert.equal(card.status, 'proposed');
    assert.deepEqual(toolsOf(out), [NOTHING_ACCEPTED]);
    assert.deepEqual(out.assistantTurn.choices!.map((choice) => choice.sitting?.proposalIds), [[card.id]]);
  });

  it('goes on to whatever answers talk when that reply left nothing', () => {
    const p = seedBdaReferenceProject();
    raise(p, 'The survey sketch is missing. Shall I ask the seller for it?');
    assert.equal(wantsDeterministicProjectChat(p, 'yes'), false, 'so that a model is asked, where there is one');
    assert.ok(!toolsOf(applyProjectChat(p, 'yes')).includes(NOTHING_ACCEPTED));
  });
});

describe('a paper read where it was filed on the register', () => {
  const bytes = readFileSync(path.resolve('test/fixtures/documents/Khata_Certificate_and_Extract_BBMP.pdf'));

  /** File the khata on a register row, as Upload on the row does. The note it writes names no sitting, and is signed by whoever filed it. */
  async function fileOnRegister(p: DdProject, actor: string): Promise<EvidenceRecord> {
    const row = addEvidence(p, { title: 'Khata certificate', kind: 'document', status: 'received' });
    const done = await readOntoRegister(p, [{ evidenceId: row.id, buffer: bytes, fileName: 'Khata.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 's3://register/Khata.pdf' }], actor);
    assert.equal(done.read, 1);
    const note = p.conversation.at(-1)!;
    assert.equal(note.sessionId, undefined);
    assert.equal(note.actor, actor);
    assert.ok(proposedFacts(row).length > 0 && (note.proposalIds ?? []).length > 0, 'it leaves values on the row and a card');
    return row;
  }
  const sitting = (actor: string, startedInMs = -1000): ChatSitting => ({ sessionId: 'ses_page', startedAt: new Date(Date.now() + startedInMs).toISOString(), actor });

  it('is what “approve all” answers in the chat that was open', async () => {
    const p = seedBdaReferenceProject();
    const chat = sitting('me@example.com');
    const row = await fileOnRegister(p, 'me@example.com');
    const waiting = proposedFacts(row).length;

    assert.equal(lastSpokenReply(p, chat)?.id, p.conversation.at(-1)!.id);
    assert.equal(say(p, 'approve all', chat), `Accepted ${waiting} values on 1 document.`);
    assert.equal(acceptedFacts(row).length, waiting);
  });

  it('and not an older reply of that chat', async () => {
    const p = seedBdaReferenceProject();
    const chat = sitting('me@example.com');
    kept(drop(p, order()), chat, 'me@example.com');
    const row = await fileOnRegister(p, 'me@example.com');

    say(p, 'approve all', chat);
    assert.equal(proposedFacts(row).length, 0, 'the khata, which the last reply read');
    assert.equal(dateOnCheck(p), undefined, 'and not the order’s date, from the reply before');
  });

  it('is not on screen in a chat that began after it', async () => {
    const p = seedBdaReferenceProject();
    const row = await fileOnRegister(p, 'me@example.com');
    const waiting = proposedFacts(row).length;
    const later = sitting('me@example.com', 1000);

    assert.equal(lastSpokenReply(p, later), undefined);
    say(p, 'approve all', later);
    assert.equal(proposedFacts(row).length, waiting);
  });

  it('is not a reply to somebody else who had a chat open', async () => {
    const p = seedBdaReferenceProject();
    const mine = sitting('me@example.com');
    kept(drop(p, order()), mine, 'me@example.com');
    // A colleague files the khata on the register while this chat is open.
    const row = await fileOnRegister(p, 'colleague@example.com');
    const waiting = proposedFacts(row).length;

    // What the chat last said to this person is still the reply about the order.
    assert.notEqual(lastSpokenReply(p, mine)?.id, p.conversation.at(-1)!.id);
    assert.match(say(p, 'approve all', mine), /^Accepted 1 value on 1 document\. \d+ more are waiting: /);
    assert.equal(dateOnCheck(p), '2019-04-02');
    assert.equal(proposedFacts(row).length, waiting, 'the colleague’s paper is theirs to accept');
    // And it is the reply their own chat answers.
    assert.equal(lastSpokenReply(p, { ...sitting('colleague@example.com'), sessionId: 'ses_theirs' })?.id, p.conversation.find((t) => t.actor === 'colleague@example.com')!.id);
  });
});

describe('the filed documents asked to be read, with none left to read', () => {
  it('is said in a line that the next instruction does not answer', () => {
    const p = seedBdaReferenceProject();
    const dropped = drop(p, order());
    const out = applyProjectChat(p, 'Read the filed documents', { nothingLeftToRead: true });
    assert.equal(out.assistantTurn.text, 'Nothing on file is left to read.');
    assert.deepEqual(out.assistantTurn.toolCalls, [{ name: NOTHING_TO_READ, summary: 'Nothing to read' }]);
    assert.deepEqual(out.assistantTurn.proposalIds ?? [], [], 'it raises no card of its own');

    assert.equal(lastSpokenReply(p)?.id, dropped.assistantTurn.id);
    assert.equal(say(p, 'approve all'), 'Accepted 1 value on 1 document.');
    assert.equal(dateOnCheck(p), '2019-04-02');
  });
});

describe('a card the reply points at', () => {
  it('is the reply’s, though an earlier reply raised it', () => {
    const p = seedBdaReferenceProject();
    const first = applyProjectChat(p, 'what’s next?');
    const [card] = openCards(p);
    assert.deepEqual(first.assistantTurn.proposalIds, [card!.id]);

    // Asked again, the reply says the same thing and raises nothing new. It still lists the request it tells the person to accept.
    const again = applyProjectChat(p, 'what’s next?');
    assert.match(again.assistantTurn.text, /accept the request waiting beside it/);
    assert.equal(openCards(p).length, 1);
    assert.deepEqual(again.assistantTurn.proposalIds, [card!.id]);

    // So "ok" is offered it, and "approve all" takes it.
    assert.deepEqual(applyProjectChat(p, 'ok').assistantTurn.choices!.map((choice) => choice.sitting?.proposalIds), [[card!.id]]);
    assert.equal(say(p, 'approve all'), 'Opened 1 action.');
    assert.deepEqual(p.actions.map((a) => a.title), [card!.title]);
  });
});

describe('an answer that cites papers', () => {
  /** Three papers read in three messages, and then a question the file answers by naming all three. */
  const asked = (): { p: DdProject; answer: ProjectChatResult; waiting: () => number } => {
    const p = seedBdaReferenceProject();
    drop(p, order());
    drop(p, khata());
    drop(p, paper('Sale deed.pdf', 'deed', fact('vendor', 'Vendor', 'A. Example'), fact('purchaser', 'Purchaser', 'B. Example')));
    const answer = applyProjectChat(p, 'which documents are on file?');
    assert.equal(answer.assistantTurn.citedEvidenceIds.length, 3, 'the answer names all three');
    return { p, answer, waiting: () => p.evidence.reduce((n, e) => n + proposedFacts(e).length, 0) };
  };

  it('leaves their values where they wait', () => {
    const { p, waiting } = asked();
    assert.equal(waiting(), 4);
    assert.equal(
      say(p, 'approve all'),
      'Nothing from the last reply is left to accept. 6 more are waiting: 3 on the Title documents, 1 on the Approvals documents, 1 on the Approvals checks and 1 on the Title checks. Each is accepted where it is shown.',
    );
    assert.equal(waiting(), 4, 'an answer filed nothing, so "all" of it is nothing');
  });

  it('has no chip for what waits on them, and "ok" under it is talk', () => {
    const { p, answer } = asked();
    assert.deepEqual(turnChips(p, answer.assistantTurn, waitingOnCanvas(p), {}), []);
    assert.ok(!toolsOf(applyProjectChat(p, 'ok')).includes(NOTHING_ACCEPTED));

    // The reply that read a paper has one for it, and the line that leads a new chat with what waits from earlier counts what it lists.
    const read = p.conversation.filter((t) => t.role === 'assistant').find((t) => t.toolCalls?.some((call) => call.name === 'ingest'))!;
    assert.ok(turnChips(p, read, waitingOnCanvas(p), {}).some((chip) => chip.kind === 'waiting' && /documents$/.test(chip.words)));
    const lead = { citedEvidenceIds: p.evidence.filter((e) => proposedFacts(e).length).map((e) => e.id), proposalIds: [], toolCalls: [{ name: WAITING_FROM_EARLIER }] };
    assert.deepEqual(turnChips(p, lead, waitingOnCanvas(p), {}).map((chip) => [chip.words, chip.count]), [
      ['waiting on the Title documents', 3],
      ['waiting on the Approvals documents', 1],
    ]);
  });

  it('while a paper given to a function is one the reply filed', () => {
    const p = seedBdaReferenceProject();
    // A paper no function holds, with a value on it, given to Title by the sentence the chat reads.
    drop(p, paper('Survey notes.pdf', 'khata', fact('pid', 'PID', '81-120-99')));
    const row = rowOf(p, 'Survey notes.pdf');
    const filed = applyProjectChat(p, `File “${row.title}” under Legal › Title`);
    assert.deepEqual(toolsOf(filed), ['assign_document']);

    say(p, 'approve all');
    assert.equal(proposedFacts(row).length, 0);
  });
});

describe('the last reply', () => {
  it('is said with what it left, after its values are taken', () => {
    const p = seedBdaReferenceProject();
    drop(p, khata('Khata 2019.pdf'));
    // The later khata states an extent that already waits on the check, so it raises no card of its own.
    const later = drop(p, khata('Khata 2024.pdf', fact('pid', 'PID', '81-120-12')));
    assert.deepEqual(openCards(p).filter((c) => later.assistantTurn.proposalIds?.includes(c.id)), []);

    assert.equal(say(p, 'approve all'), 'Accepted 2 values on 1 document. 2 more are waiting: 1 on the Title documents and 1 on the Title checks.');
    assert.equal(acceptedFacts(rowOf(p, 'Khata 2024.pdf')).length, 2);
    assert.equal(proposedFacts(rowOf(p, 'Khata 2019.pdf')).length, 1, 'the earlier paper’s value still waits');
    assert.equal(extentOnCheck(p), undefined, 'and so does its card: the check holds no extent yet');
  });

  it('that left only values on a paper is offered as one choice', () => {
    const p = seedBdaReferenceProject();
    drop(p, khataWithNoCard());
    const out = applyProjectChat(p, 'ok');
    assert.equal(out.assistantTurn.text, 'Nothing was accepted. 1 is waiting: 1 on the Title documents. Accept it below, or where it is shown.');
    assert.deepEqual(
      out.assistantTurn.choices!.map((choice) => [choice.label, choice.detail, choice.send, choice.sitting]),
      [['The one from the last reply', '1 on the Title documents', CHOICE_SENTENCE.all, { decision: 'accept', proposalIds: [], evidenceIds: [rowOf(p, 'Khata.pdf').id] }]],
    );
    assert.equal(press(p, out.assistantTurn.choices![0]!).assistantTurn.text, 'Accepted 1 value on 1 document.');
  });

  it('is not an edit somebody made in the work pane', () => {
    // An edit writes its own "Recorded." into the thread. The last thing the chat said is still the reply before it.
    const straight = seedBdaReferenceProject();
    const dropped = drop(straight, order());
    noteProjectEdit(straight, 'Recorded the land area.');
    assert.equal(lastSpokenReply(straight)?.id, dropped.assistantTurn.id);
    assert.equal(say(straight, 'approve all'), 'Accepted 1 value on 1 document.');

    // An edit that names a paper does not put that paper in front of "approve all" either.
    const moved = seedBdaReferenceProject();
    drop(moved, order());
    applyProjectChat(moved, 'open Title');
    noteProjectEdit(moved, 'Filed the conversion order.', { citedEvidenceIds: [rowOf(moved, 'Conversion order.pdf').id] });
    assert.equal(
      say(moved, 'approve all'),
      'Nothing from the last reply is left to accept. 2 more are waiting: 1 on the Approvals documents and 1 on the Approvals checks. Each is accepted where it is shown.',
    );
    assert.equal(dateOnCheck(moved), undefined);
  });

  it('is the last reply of the chat the sentence is typed in', () => {
    const p = seedBdaReferenceProject();
    const dropped = kept(drop(p, order()), { sessionId: 'ses_morning' });

    assert.equal(lastSpokenReply(p, { sessionId: 'ses_morning' })?.id, dropped.assistantTurn.id);
    assert.equal(lastSpokenReply(p, { sessionId: 'ses_other' }), undefined, 'a chat that has said nothing has no last reply');
    assert.equal(lastSpokenReply(p, { sessionId: 'ses_evening', continues: 'ses_morning' })?.id, dropped.assistantTurn.id, 'unless it carries an earlier chat on');

    // Typed in another chat, it is no answer to what the first one raised.
    say(p, 'approve all', { sessionId: 'ses_other' });
    assert.equal(dateOnCheck(p), undefined);
    // Carried on in a new sitting, the first chat's last reply is still the one answered.
    assert.equal(say(p, 'approve all', { sessionId: 'ses_evening', continues: 'ses_morning' }), 'Accepted 1 value on 1 document.');
    assert.equal(dateOnCheck(p), '2019-04-02');
  });

  it('is nothing on a project stored before a thread or cards were kept', () => {
    const p = seedBdaReferenceProject();
    delete (p as Partial<DdProject>).chatProposals;
    delete (p as Partial<DdProject>).conversation;
    assert.equal(wantsDeterministicProjectChat(p, 'approve all'), true);
    assert.equal(say(p, 'approve all'), 'Nothing waiting. Ask what’s next, or drop a document in.');
  });

  it('is nothing once every chat has been deleted', () => {
    const p = seedBdaReferenceProject();
    drop(p, order());
    // The thread is gone. What it raised still waits on the canvas.
    clearProjectConversation(p);
    say(p, 'approve all', { sessionId: 'ses_fresh' });
    assert.equal(dateOnCheck(p), undefined);
  });
});

describe('a card called “All conversion orders are on file”', () => {
  it('is that card by its title in quotes, and is not “all”', () => {
    const p = seedBdaReferenceProject();
    const named = request('All conversion orders are on file');
    drop(p, order());
    // A reply that lists both: the order's own card, and the one with "all" in its title.
    raise(p, 'One more thing.', named);

    // "Skip all" is not this card, though "all" is one of its words, and neither is "approve all conversion orders".
    say(p, 'skip all');
    say(p, 'approve all conversion orders are on file');
    assert.equal(named.status, 'proposed');

    say(p, 'approve "All conversion orders are on file"');
    assert.equal(named.status, 'committed');
    assert.equal(dateOnCheck(p), undefined, 'and not the order’s card');
  });
});

describe('a card whose title holds the words of a register command', () => {
  it('is that card, pressed or typed by its title in quotes', () => {
    for (const title of ['Log risk: the buyer may not accept the delayed handover', 'Close the action on the fire NOC']) {
      for (const how of ['pressed', 'typed'] as const) {
        const p = seedDemoProject();
        const card = request(title);
        raise(p, 'Two things.', card, request('Request the fire NOC'));
        const before = { risks: p.risks.map((r) => r.status), actions: p.actions.map((a) => a.status) };

        if (how === 'pressed') press(p, applyProjectChat(p, 'ok').assistantTurn.choices!.find((choice) => choice.label === title)!);
        else say(p, `approve "${title}"`);
        assert.equal(card.status, 'committed', `${title}, ${how}`);
        assert.deepEqual(p.risks.map((r) => r.status), before.risks, 'no risk on the register was touched');
        assert.deepEqual(p.actions.slice(0, before.actions.length).map((a) => a.status), before.actions, 'and no action was closed');
      }
    }
  });

  it('while the same words with no card named are the register’s', () => {
    const p = seedDemoProject();
    raise(p, 'One thing.', request('Request the fire NOC'));
    const risk = p.risks.find((r) => r.title === 'Fire approval risk on Tower A')!;
    say(p, 'accept the fire approval risk');
    assert.equal(risk.status, 'accepted');
  });
});

describe('a request that is already open', () => {
  it('is not offered again, however often “approve all” is said', () => {
    const p = seedBdaReferenceProject();
    drop(p, order());
    const first = applyProjectChat(p, 'approve all');
    // With the paper's value accepted, the reply offers the next step: a request for the paper the next check needs.
    const card = openCards(p).find((c) => c.kind === 'request_evidence' && first.assistantTurn.proposalIds?.includes(c.id));
    assert.ok(card, 'the next step is offered as a card');

    assert.equal(say(p, 'approve all'), 'Opened 1 action.');
    assert.equal(say(p, 'approve all'), 'Nothing waiting. Ask what’s next, or drop a document in.');
    assert.deepEqual(p.actions.map((a) => a.title), [card.title], 'one action, however often it is said');

    // The next step is the same check until the paper comes in. It says so, and offers no request beside it.
    const next = projectNextStep(p, 'tester');
    assert.deepEqual(next.proposals, []);
    assert.match(next.text, /\nIt’s open on the right\. Tick or cross it, or drop the document in here\.$/);

    // A request closed without the paper is one to make again.
    p.actions[0]!.status = 'closed';
    assert.deepEqual(projectNextStep(p, 'tester').proposals.map((c) => c.title), [card.title]);
  });

  it('is known by the paper it asks for, whatever it has been renamed to', () => {
    const p = seedBdaReferenceProject();
    applyProjectChat(p, 'what’s next?');
    say(p, 'approve all');
    assert.equal(p.actions.length, 1);

    p.actions[0]!.title = 'Chase the joint development agreement';
    assert.deepEqual(projectNextStep(p, 'tester').proposals, []);
    // A request for another paper is not that one.
    p.actions[0]!.status = 'closed';
    assert.equal(projectNextStep(p, 'tester').proposals.length, 1);
  });

  it('is known by the finding it asks proof for', () => {
    const p = seedDemoProject();
    // Every check decided, so the next step is the finding that has nothing behind it.
    for (const check of checksOf(p)) if (check.result === 'pending') check.result = 'compliant';
    const first = projectNextStep(p, 'tester');
    assert.equal(first.kind, 'prove_finding');
    assert.equal(first.proposals.length, 1);
    assert.match(first.text, /\nAccept it on the right, or drop the document in here\.$/);

    p.chatProposals.push(first.proposals[0]!);
    const { recordId } = commitChatProposal(p, first.proposals[0]!.id, 'tester');
    p.actions.find((a) => a.id === recordId)!.title = 'Get the conversion order from the seller';
    const again = projectNextStep(p, 'tester');
    assert.equal(again.kind, 'prove_finding');
    assert.deepEqual(again.proposals, []);
    assert.match(again.text, /\nIts proof has been asked for\. Drop the document in here when it comes\.$/);
  });
});

describe('a card set aside on the canvas', () => {
  it('is no longer what a choice or its title can take', () => {
    const p = seedBdaReferenceProject();
    drop(p, order(), khata());
    const [, date] = applyProjectChat(p, 'ok').assistantTurn.choices!;
    rejectChatProposal(p, date!.sitting!.proposalIds![0]!);

    assert.equal(press(p, date!).assistantTurn.text, 'That is no longer waiting, so nothing was accepted.');
    assert.deepEqual(toolsOf(applyProjectChat(p, `approve "${DATE}"`)), [NOTHING_ACCEPTED]);
    assert.equal(dateOnCheck(p), undefined);
  });
});

describe('“what’s next?”', () => {
  it('is the same question with either apostrophe', () => {
    // A check on the project is called "What the site is next to…". The question names no record.
    assert.ok(checksOf(seedBdaReferenceProject()).some((c) => /^What the site is next to/.test(c.title)));
    for (const sentence of ['what\'s next?', 'what’s next?', 'What’s next']) {
      assert.deepEqual(rankTalkSittings(seedBdaReferenceProject(), sentence), [], sentence);
    }
    assert.equal(say(seedBdaReferenceProject(), 'what’s next?'), say(seedBdaReferenceProject(), 'what\'s next?'));
    assert.match(say(seedBdaReferenceProject(), 'what’s next?'), /^Next up: /);
  });
});
