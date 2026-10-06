/**
 * The notes of a meeting, kept on the file.
 *
 * One test for each rule. That words are told to be notes of a meeting, not
 * to be, or left for a person to say. That the rules read what the notes
 * mark as decided, to be done and open, with who and by when, and guess no
 * date and no name. That a model's reading is held to the notes' own words.
 * That notes are kept as a meeting and not filed as a paper, and that what
 * they say waits on cards until a person accepts it, when a decision and an
 * action are the records the project already has and a point left open is a
 * decision still to be made. That memory tells them with the meeting they
 * came from. That an action past its date raises one alert, to the person it
 * is on, and that closing it clears the alert. And that the chat lists the
 * meetings kept, each with a way to open its notes.
 *
 * Every name, place and line of notes here is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEETING_IS_NOTES,
  applyProjectChat,
  commitChatProposal,
  createProject,
  meetingItemsHeld,
  meetingItemsTogether,
  meetingNotesDropped,
  meetingNotesMark,
  meetingNotesPasted,
  meetingNotesSeen,
  meetingOfRecord,
  meetingDigest,
  meetingsHeld,
  memAnswer,
  memAsksMemory,
  memoryDelta,
  memoryFacts,
  openAlerts,
  readMeetingNotes,
  syncAlerts,
  type ChatIngestFile,
  type DdProject,
  type MeetingGiven,
  type MeetingRecord,
} from '@realytica/shared';
import { parseAnswer } from '../apps/web/src/components/chat/answer-blocks';

const LEAD = 'lead@example.com';

const NOTES = [
  'Minutes of the meeting, Northfield corner plot',
  'Date: 3 October 2026',
  'Present: Asha Rao, Vikram Shetty, Meera Nair',
  '',
  'The broker left early and the tea was cold.',
  'It was agreed that the boundary wall will be built before the monsoon.',
  'Somebody should speak to the neighbour about the fence by 20 October 2026.',
  '',
  'Decision: Go ahead with the resurvey of the plot before the sale agreement.',
  'Action: Vikram to get the encumbrance certificate by Friday.',
  'Action: Collect the tax paid receipts',
  'Open: Whether the access road is wide enough for the fire tender.',
].join('\n');

/** Where the words of the notes are kept, as the server hands it to the rules. No test here reads the file. */
const FILE = { storageKey: 'notes-1.txt', fileName: 'Meeting notes pasted 2026-10-06.txt', mimeType: 'text/plain', sizeBytes: NOTES.length };

function plot(): DdProject {
  return createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MT1');
}

/** Paste the notes into the chat, as the server hands them to the rules once it has read them. */
function paste(project: DdProject, notes = NOTES, more: Partial<MeetingGiven> = {}) {
  const given: MeetingGiven = { keep: { file: FILE, came: 'pasted', reading: readMeetingNotes(notes), digest: meetingDigest(notes) }, ...more } as MeetingGiven;
  return applyProjectChat(project, 'Notes of a meeting pasted, about 100 words', { actor: LEAD, meeting: given, modelReader: false });
}

function kept(project: DdProject): MeetingRecord {
  const meeting = meetingsHeld(project)[0];
  assert.ok(meeting, 'a meeting is kept');
  return meeting;
}

/** Accept the card raised for the item of the notes that says this, and give the record made of it. */
function accept(project: DdProject, says: string): string {
  const item = kept(project).items.find((held) => held.text.includes(says));
  assert.ok(item, `the notes gave an item that says “${says}”`);
  const made = commitChatProposal(project, item.proposalId, LEAD).recordId;
  assert.ok(made, 'accepting the card made a record');
  return made;
}

describe('whether words are the notes of a meeting', () => {
  it('says yes to notes with a heading, who was there and marked lines', () => {
    assert.equal(meetingNotesSeen(NOTES), 'yes');
    assert.equal(meetingNotesPasted(NOTES), 'yes');
  });

  it('asks where it cannot tell: marked lines under no heading, and the minutes of a board', () => {
    assert.equal(meetingNotesSeen('Decision: keep the old gate.\nAction: paint it.\nOpen: who pays.'), 'maybe');
    assert.equal(meetingNotesSeen(`Minutes of the meeting of the board of directors\nPresent: A Rao, V Shetty\nResolved that the company sell the plot.\nDecision: sell.`), 'maybe');
  });

  it('says no to a message that mentions a meeting, and to a paper the rules read as one', () => {
    assert.equal(meetingNotesPasted('Can you draft the meeting notes for yesterday?\nThanks'), 'no');
    assert.equal(meetingNotesSeen('This deed of sale is made on the third day of October between the vendor and the purchaser.\nThe schedule property is described below.'), 'no');
    const deed: ChatIngestFile = { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'deed.pdf', excerpt: NOTES, read: { type: 'sale_deed' } as ChatIngestFile['read'] };
    assert.equal(meetingNotesDropped(deed), 'no', 'a deed that recites a meeting is a deed');
  });
});

describe('what the rules read out of notes', () => {
  const reading = readMeetingNotes(NOTES);

  it('reads the day, who was there, and each marked line as what it is', () => {
    assert.equal(reading.heldOn, '2026-10-03');
    assert.deepEqual(reading.attendees, ['Asha Rao', 'Vikram Shetty', 'Meera Nair']);
    assert.deepEqual(
      reading.items.map((item) => [item.kind, item.text]),
      [
        ['decision', 'Go ahead with the resurvey of the plot before the sale agreement.'],
        ['action', 'Vikram to get the encumbrance certificate by Friday.'],
        ['action', 'Collect the tax paid receipts'],
        ['open', 'Whether the access road is wide enough for the fire tender.'],
      ],
    );
    assert.ok(reading.items.every((item) => NOTES.includes(item.quote) && item.readBy === 'rules'), 'each with the words of the notes it came from');
  });

  it('reads who and by when from the line, and leaves both empty where the line gives neither', () => {
    const [, first, second] = reading.items;
    assert.deepEqual([first!.owner, first!.dueDate], ['Vikram', '2026-10-09'], 'Friday is the Friday after the day the meeting was held');
    assert.deepEqual([second!.owner, second!.dueDate], [undefined, undefined]);
  });

  it('reads no day from a weekday when the notes do not say when the meeting was', () => {
    const undated = readMeetingNotes('Meeting notes\nPresent: Asha Rao, Vikram Shetty\nAction: Vikram to get the encumbrance certificate by Friday.');
    assert.equal(undated.heldOn, undefined);
    assert.equal(undated.items[0]!.dueDate, undefined, 'never guessed from today');
    assert.equal(undated.items[0]!.owner, 'Vikram');
  });
});

describe('a model’s reading of notes', () => {
  const said = {
    items: [
      { kind: 'decision', text: 'Build the boundary wall before the monsoon', owner: null, quote: 'It was agreed that the boundary wall will be built before the monsoon.' },
      { kind: 'action', text: 'Asha to speak to the neighbour about the fence', owner: 'Asha', dueDate: '2026-10-08', quote: 'Somebody should speak to the neighbour about the fence by 20 October 2026.' },
      { kind: 'action', text: 'File the conversion application', owner: 'Vikram', quote: 'The conversion application is to be filed next week by the team.' },
      { kind: 'decision', text: 'Resurvey first', owner: null, quote: 'Go ahead with the resurvey of the plot before the sale agreement.' },
    ],
  };
  const held = meetingItemsHeld(NOTES, said, '2026-10-03');

  it('keeps an item only with words that are in the notes', () => {
    assert.deepEqual(held.map((item) => item.text), ['Build the boundary wall before the monsoon', 'Asha to speak to the neighbour about the fence', 'Resurvey first']);
    assert.ok(held.every((item) => item.readBy === 'model'));
  });

  it('keeps a name only when the quoted words have it, and reads the date from those words itself', () => {
    const fence = held[1]!;
    assert.equal(fence.owner, undefined, 'the quoted words name nobody');
    assert.equal(fence.dueDate, '2026-10-20', 'the day the notes give, not the day the model gave');
  });

  it('adds to the rules’ reading only what the rules did not read', () => {
    const both = meetingItemsTogether(readMeetingNotes(NOTES).items, held);
    assert.equal(both.length, 6, 'four marked lines, and two sentences only a model read');
    assert.equal(both.filter((item) => item.text === 'Resurvey first').length, 0, 'the same words read twice are the rules’ reading');
  });
});

describe('notes given to the chat', () => {
  it('are kept as a meeting, with a card for each thing they say and nothing on the record', () => {
    const project = plot();
    const result = paste(project);
    const meeting = kept(project);
    assert.deepEqual([meeting.title, meeting.heldOn, meeting.attendees.length, meeting.came], ['Minutes of the meeting, Northfield corner plot', '2026-10-03', 3, 'pasted']);
    assert.equal(meeting.items.length, 4);
    assert.equal(result.proposals.length, 4, 'a card for each');
    assert.deepEqual([project.decisions.length, project.actions.length, project.evidence.length], [0, 0, 0], 'nothing is a decision, an action or a paper yet');
    assert.match(result.assistantTurn.text, /^Kept the notes as a meeting: /);
    assert.match(result.assistantTurn.text, /To do: Vikram to get the encumbrance certificate by Friday\. · Vikram · due 9 Oct 2026/);
    assert.match(result.assistantTurn.text, /To do: Collect the tax paid receipts · nobody named · no date given/);
    assert.ok(!JSON.stringify(project).includes('the tea was cold'), 'the record holds none of the words but the lines it quotes');
    assert.ok(project.audit.some((event) => event.entityType === 'meeting' && event.action === 'create' && event.entityId === meeting.id));
  });

  it('given twice are one meeting', () => {
    const project = plot();
    paste(project);
    const again = paste(project);
    assert.equal(meetingsHeld(project).length, 1);
    assert.match(again.assistantTurn.text, /^These notes are already kept, as the meeting of 3 Oct 2026/);
    assert.equal(again.proposals.length, 0);
  });

  it('dropped as a file are kept as a meeting and not filed as a paper', () => {
    const project = plot();
    const file: ChatIngestFile = { fileName: 'site-meeting-notes.txt', mimeType: 'text/plain', sizeBytes: NOTES.length, storageKey: 'dropped-1.txt', excerpt: NOTES };
    const result = applyProjectChat(project, '', { actor: LEAD, ingest: [file], modelReader: false });
    assert.equal(project.evidence.length, 0, 'not on the register of documents');
    assert.deepEqual([kept(project).came, kept(project).file.storageKey, kept(project).items.length], ['dropped', 'dropped-1.txt', 4]);
    assert.equal(result.proposals.length, 4);
  });

  it('that it cannot tell are asked about with two choices, and kept or filed only once a person says', () => {
    const project = plot();
    const file: ChatIngestFile = { fileName: 'points.txt', mimeType: 'text/plain', sizeBytes: 60, storageKey: 'dropped-2.txt', excerpt: 'Decision: keep the old gate.\nAction: paint it.\nOpen: who pays.' };
    const asked = applyProjectChat(project, '', { actor: LEAD, ingest: [file], modelReader: false });
    assert.match(asked.assistantTurn.text, /^Is “points\.txt” the notes of a meeting, or a document for the file\?/);
    assert.deepEqual(asked.assistantTurn.choices?.map((choice) => choice.label), ['Notes of a meeting', 'A document for the file']);
    assert.deepEqual([meetingsHeld(project).length, project.evidence.length, asked.proposals.length], [0, 0, 0], 'held, and neither kept nor filed');

    // "Notes of a meeting": the server reads the held words back and hands them over as the answer.
    const held = project.meetings![0]!;
    const words = file.excerpt!;
    const said = applyProjectChat(project, MEETING_IS_NOTES, { actor: LEAD, meeting: { keep: { file: held.file, came: 'dropped', reading: readMeetingNotes(words), digest: meetingDigest(words) }, askedId: held.id }, modelReader: false });
    assert.equal(meetingsHeld(project).length, 1);
    assert.equal(said.proposals.length, 3);

    // "A document": the server marks what it held and sends the file down the path every document takes.
    const other = plot();
    applyProjectChat(other, '', { actor: LEAD, ingest: [file], modelReader: false });
    other.meetings![0]!.standing = 'paper';
    applyProjectChat(other, '', { actor: LEAD, ingest: [file], modelReader: false });
    assert.deepEqual([other.evidence.length, other.meetings!.length], [1, 0], 'filed as a paper, and nothing held of it');
  });
});

describe('what the notes say, once accepted', () => {
  function accepted(): { project: DdProject; decision: string; action: string; open: string } {
    const project = plot();
    paste(project);
    return { project, decision: accept(project, 'resurvey'), action: accept(project, 'encumbrance certificate'), open: accept(project, 'access road') };
  }

  it('is a decision and an action as the project already has them, and a point left open is a decision still to be made', () => {
    const { project, decision, action, open } = accepted();
    const made = project.decisions.find((record) => record.id === decision)!;
    assert.deepEqual([made.title, made.status, made.decisionMaker], ['Go ahead with the resurvey of the plot before the sale agreement.', 'approved', 'The meeting of 3 Oct 2026']);
    const todo = project.actions.find((record) => record.id === action)!;
    assert.deepEqual([todo.owner, todo.dueDate], ['Vikram', '2026-10-09']);
    const point = project.decisions.find((record) => record.id === open)!;
    assert.deepEqual([point.status, point.decisionMaker], ['pending', ''], 'nobody has made it yet');
    assert.equal(project.actions.length, 1, 'the action nobody accepted is still only a card');
  });

  it('knows the meeting it came from, and the words of the notes it rests on', () => {
    const { project, action } = accepted();
    const from = meetingOfRecord(project, action)!;
    assert.equal(from.meeting.id, kept(project).id);
    assert.equal(from.item.quote, 'Action: Vikram to get the encumbrance certificate by Friday.');
  });

  it('is told to memory: the meeting as an entry, and each record as a fact the meeting states', () => {
    const { project, decision } = accepted();
    const meeting = kept(project);
    const entries = memoryDelta(project, {}).entries;
    assert.deepEqual(entries.filter((entry) => entry.kind === 'meeting_kept').map((entry) => entry.about), [[meeting.id]]);
    const fact = memoryFacts(project).held.find((held) => held.aboutId === decision)!;
    assert.deepEqual([fact.key, fact.tag, fact.source, fact.quote], ['decision', 'approved', meeting.id, 'Decision: Go ahead with the resurvey of the plot before the sale agreement.']);
  });

  it('is found by “what was agreed about”, with the meeting it came from and a way to open its notes there', () => {
    const { project, decision } = accepted();
    const meeting = kept(project);
    const facts = memoryFacts(project).held;
    const question = 'What was agreed about the resurvey?';
    const answer = memAnswer(project, facts, memAsksMemory(question)!, { question });
    const item = meeting.items.find((held) => held.text.includes('resurvey'))!;
    assert.match(answer.text, /Decision recorded: “Go ahead with the resurvey of the plot before the sale agreement\.” \(approved\) \[approved\]/);
    assert.ok(answer.text.includes(`from the meeting of 3 Oct 2026 ${meetingNotesMark(meeting.id, item.id)}`));
    assert.deepEqual(answer.rests.map((rest) => rest.id), [facts.find((fact) => fact.aboutId === decision)!.id]);

    // The page draws the mark as a way to open the notes at that item, and draws the tag where the turn says it stands.
    const spans = parseAnswer(answer.text, () => false, answer.rests).flatMap((block) => ('items' in block ? block.items.flat() : 'spans' in block ? block.spans : []));
    assert.deepEqual(spans.filter((span) => span.kind === 'notes'), [{ kind: 'notes', meetingId: meeting.id, itemId: item.id }]);
    assert.deepEqual(spans.filter((span) => span.kind === 'memory').map((span) => (span.kind === 'memory' ? span.tag : '')), ['approved']);

    const whole = memAnswer(project, facts, memAsksMemory('What was agreed at the last meeting?')!, { question: 'What was agreed at the last meeting?' });
    assert.match(whole.text, /^Decisions and actions about the meeting of 3 Oct 2026 \[notes:/);
    assert.match(whole.text, /1 thing from its notes is still waiting on a card/);
    const undecided = memAnswer(project, facts, memAsksMemory('What is still undecided?')!, { question: 'What is still undecided?' });
    assert.match(undecided.text, /Decision still to be made: “Whether the access road is wide enough for the fire tender\.” \(pending\)/);
  });
});

describe('an action past its date', () => {
  it('raises one alert, to the person it is on, and closing the action clears it', () => {
    const project = plot();
    paste(project);
    const made = accept(project, 'encumbrance certificate');
    const action = project.actions.find((record) => record.id === made)!;

    assert.deepEqual(syncAlerts(project, new Date('2026-10-09T12:00:00Z')).filter((alert) => alert.key.startsWith('action:')), [], 'not on the day it is due');
    const raised = syncAlerts(project, new Date('2026-10-12T09:00:00Z')).filter((alert) => alert.key.startsWith('action:'));
    assert.equal(raised.length, 1);
    assert.deepEqual(
      [raised[0]!.key, raised[0]!.severity, raised[0]!.title, raised[0]!.to],
      [`action:${action.id}:due:2026-10-09`, 'warning', 'Overdue: Vikram to get the encumbrance certificate by Friday.', ['Vikram']],
    );
    assert.match(raised[0]!.detail, /^Due 9 Oct 2026, on Vikram\. From the meeting of 3 Oct 2026\.$/);
    assert.deepEqual(syncAlerts(project, new Date('2026-10-13T09:00:00Z')), [], 'raised once, not again each day');

    action.status = 'closed';
    syncAlerts(project, new Date('2026-10-14T09:00:00Z'));
    assert.deepEqual(openAlerts(project).filter((alert) => alert.key.startsWith('action:')), []);
  });
});

describe('asked which meetings were held', () => {
  it('lists them, each with a way to open its notes', () => {
    const project = plot();
    const none = applyProjectChat(project, 'What meetings were held?', { actor: LEAD });
    assert.match(none.assistantTurn.text, /^No meeting is kept on this file yet\./);
    paste(project);
    const listed = applyProjectChat(project, 'What meetings were held?', { actor: LEAD });
    const meeting = kept(project);
    assert.match(listed.assistantTurn.text, /^1 meeting is kept on this file:/);
    assert.ok(listed.assistantTurn.text.includes(`Minutes of the meeting, Northfield corner plot, 3 Oct 2026 ${meetingNotesMark(meeting.id)}`));
    assert.match(listed.assistantTurn.text, /present: Asha Rao, Vikram Shetty, Meera Nair · 1 decision, 2 actions, 1 open point, 4 still waiting to be accepted/);
    assert.equal(listed.proposals.length, 0, 'and raises nothing');
  });
});
