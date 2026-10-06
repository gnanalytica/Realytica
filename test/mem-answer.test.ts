/**
 * Memory said to a person by rule: the facts under an answer the chat gave
 * by rule, and the answer to a question put to memory itself.
 *
 * One test a rule. Under an answer: the facts the question is about, what
 * waits first, at most four, each with its tag at a place the turn keeps,
 * and nothing where memory holds nothing about the question. A question to
 * memory: read as one in each of its forms and not when it is another kind
 * of sentence, answered with the facts about what it names, who and when,
 * then the decisions and actions, then the assistant's notes set apart, and
 * in one line when it names nothing memory can find.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEM_UNDER_ANSWER,
  addDecision,
  addEvidence,
  createAssessment,
  createProject,
  memAnswer,
  memAsksMemory,
  memSaidUnder,
  memTagPrinted,
  memThought,
  memUnderAnswer,
  memoryFacts,
  patchProject,
  reviewFacts,
  type DocumentFact,
  type MemFact,
  type MemSaid,
} from '@realytica/shared';

const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';

const value = (key: string, held: DocumentFact['value'], display = String(held)): DocumentFact => ({ key, label: key, value: held, display, page: 1, quote: `${key}: ${display}`, review: 'proposed' });

/**
 * A project with a land area a person typed and another waiting on a card, a
 * certificate whose extent was accepted, reopened and corrected and whose
 * number still waits, a decision that speaks of the land area, and two notes
 * of the assistant's.
 */
function plot() {
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-A1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const paper = addEvidence(project, { title: 'Municipal certificate of the plot', kind: 'document' }, LEAD);
  paper.documentType = 'Khata certificate and extract';
  paper.facts = [value('extent_khata', 1100.9, '11,850 sq ft'), value('khata_number', '1234/56')];
  reviewFacts(project, paper.id, ['extent_khata'], 'accept', VALUER);
  reviewFacts(project, paper.id, ['extent_khata'], 'reopen', VALUER);
  reviewFacts(project, paper.id, ['extent_khata'], 'accept', VALUER, { value: 1096.2, display: '11,800 sq ft' });
  patchProject(project, { landAreaSqm: 1210 }, LEAD);
  project.chatProposals.push({ id: 'prop_1', kind: 'patch_project', title: 'Update land', rationale: '', impact: '', status: 'proposed', payload: { landAreaSqm: 1300 }, createdAt: '2026-10-06T08:00:00.000Z', createdBy: 'assistant' });
  addDecision(project, { title: 'Hold the advance until the land area is settled', decisionType: 'hold_payment', decisionMaker: 'Lead', rationale: 'Two figures.' }, LEAD);
  // The days the record gives each of these, fixed so the lines can be read here.
  for (const event of project.audit) event.at = '2026-10-05T10:00:00.000Z';
  for (const fact of paper.facts) if (fact.decidedAt) fact.decidedAt = '2026-10-05T10:00:00.000Z';
  paper.createdAt = '2026-10-04T10:00:00.000Z';
  project.decisions[0]!.createdAt = '2026-10-05T10:00:00.000Z';
  const facts: MemFact[] = [
    ...memoryFacts(project).held,
    memThought(project.id, { note: 'The land area on the card came from the seller’s broker.', aboutId: project.id, turnId: 'cht_1', at: '2026-10-06T09:00:00.000Z' })!,
    memThought(project.id, { note: 'The certificate is in the seller’s own name.', aboutId: paper.id, turnId: 'cht_2', at: '2026-10-06T09:05:00.000Z' })!,
  ];
  return { project, paper, facts };
}

/** Every place a turn would keep holds the tag of the fact it is kept for. */
function placesHold(said: MemSaid): void {
  for (const rest of said.rests) {
    const printed = memTagPrinted(rest.tag, rest.stands);
    for (const at of rest.at) assert.equal(said.text.slice(at, at + printed.length), printed, `the place kept for ${rest.id}`);
  }
}

describe('under an answer the chat gave by rule', () => {
  it('are the facts the question is about, what waits first, at most four, each with its tag at a place the turn keeps; and nothing where memory holds none', () => {
    const { project, facts } = plot();

    // A kind of value named: the one waiting on a card first, which the rule that read the record did not say, then the one a person typed.
    const land = memUnderAnswer(project, facts, { question: 'What is the land area?' })!;
    assert.equal(
      land.text,
      ['In this project’s memory:', '- Land area: 1,300 sqm [waiting] · raised on a card · 6 Oct 2026 · “Update land”', `- Land area: 1,210 sqm [approved] · ${LEAD} · 5 Oct 2026`].join('\n'),
    );
    assert.deepEqual(land.rests.map((rest) => [rest.tag, rest.stands]), [['proposed', false], ['approved', undefined]]);
    placesHold(land);

    // A record named: its values and the note about it, the note last and said to be a thought.
    const paper = memUnderAnswer(project, facts, { question: 'What does the Municipal certificate of the plot say?' })!;
    assert.deepEqual(paper.text.split('\n').slice(1).map((line) => /\[([^\]]+)\]/.exec(line)![1]), ['waiting · stands', 'approved', 'thought']);
    assert.match(paper.text, /^- The certificate is in the seller’s own name\. \[thought\] · 6 Oct 2026 · about “Municipal certificate of the plot”$/m);
    placesHold(paper);

    // Nothing the question is about: nothing is said. The project as a whole: what waits anywhere on it, then the newest a person approved.
    assert.equal(memUnderAnswer(project, facts, { question: 'What can you do?' }), undefined);
    for (const whole of [memUnderAnswer(project, facts, { question: 'What do you make of this project so far, in two sentences?' })!, memUnderAnswer(project, facts, { question: 'What can you do?' }, { whole: true })!]) {
      const tags = whole.text.split('\n').slice(1).map((line) => /\[([^\]]+)\]/.exec(line)![1]);
      assert.deepEqual(tags, ['waiting', 'waiting · stands', 'approved', 'approved'], 'at most four, and what waits before what stands');
      assert.equal(whole.rests.length, MEM_UNDER_ANSWER);
      assert.ok(!whole.text.includes('[thought]'), 'and no note of the assistant’s among the facts of the whole project');
      placesHold(whole);
    }

    // Put under an answer, every place moves with it.
    const under = memSaidUnder('The project record says 1,210 sqm.\n', land);
    assert.equal(under.text, `The project record says 1,210 sqm.\n\n${land.text}`);
    placesHold(under);
  });
});

describe('a question put to memory itself', () => {
  it('is read as one in each of its forms, with what it is about, and no other sentence is', () => {
    for (const [question, kind, about] of [
      ['What does memory hold about the land area?', 'holds', 'the land area'],
      ['What do we know about the Municipal certificate of the plot?', 'holds', 'the Municipal certificate of the plot'],
      ['what was agreed about the price', 'agreed', 'the price'],
      ['What did we decide on the advance?', 'agreed', 'the advance'],
      ['What is still undecided about the land area?', 'undecided', 'the land area'],
      ['Tell me what memory holds about the land area and whether anything about it is still undecided', 'undecided', 'the land area and whether anything about it is still undecided'],
      ['What changed about the extent?', 'changed', 'the extent'],
      ['What do we know?', 'holds', undefined],
    ] as const) {
      assert.deepEqual(memAsksMemory(question), { kind, ...(about ? { about } : {}) }, question);
    }
    for (const question of ['What is the land area?', 'What is missing?', 'Add a note: what was agreed about the fence', 'Approve all', 'Which findings are unresolved?', 'What is accepted as proof of title?', 'What do you know about valuing land in a city?', '']) {
      assert.equal(memAsksMemory(question), undefined, question);
    }
  });

  it('is answered with the facts about what it names, who and when, then decisions and actions, then the assistant’s notes set apart; and in one line when it names nothing', () => {
    const { project, facts } = plot();
    const answer = (question: string): MemSaid => memAnswer(project, facts, memAsksMemory(question)!, { question });

    const undecided = answer('What is still undecided about the land area?');
    assert.equal(
      undecided.text,
      [
        'Still undecided about the land area:',
        '- Land area: 1,300 sqm [waiting] · raised on a card · 6 Oct 2026 · “Update land”',
        '',
        'Agreed so far:',
        `- Land area: 1,210 sqm [approved] · ${LEAD} · 5 Oct 2026`,
        '',
        'Decisions and actions still open:',
        `- Decision recorded: “Hold the advance until the land area is settled” (Hold payment, proposed) [approved] · ${LEAD} · 5 Oct 2026`,
        '',
        'The assistant’s own notes, which are not facts of the file:',
        '- The land area on the card came from the seller’s broker. [thought] · 6 Oct 2026',
      ].join('\n'),
      'the card is named, what stands beside it, the decision that speaks of it, and the note about it and no other',
    );
    assert.deepEqual(undecided.rests.map((rest) => rest.tag), ['proposed', 'approved', 'approved', 'thought']);
    placesHold(undecided);

    const agreed = answer('What was agreed about the land area?').text.split('\n');
    assert.deepEqual([agreed[0], agreed[3]], ['Agreed about the land area:', 'Not yet agreed:'], 'what a person approved first, and what waits said not to be agreed');

    const changed = answer('What changed about the extent per khata?');
    assert.match(changed.text, /^What changed about the extent per khata:\n- Extent per khata: 11,800 sq ft \[approved\] · valuer@example\.com · 5 Oct 2026 · “Municipal certificate of the plot”, p\.1 · before: corrected 5 Oct 2026 \(11,800 sq ft\); reopened 5 Oct 2026 \(11,850 sq ft\); accepted 5 Oct 2026 \(11,850 sq ft\)$/);
    placesHold(changed);
    assert.equal(answer('What changed about the land area?').text.split('\n')[0], 'Nothing memory holds about the land area has changed since it was first recorded.');

    const record = answer('What do we know about the Municipal certificate of the plot?');
    assert.deepEqual(record.text.split('\n').filter((line) => line.startsWith('- ')).map((line) => /\[([^\]]+)\]/.exec(line)![1]), ['approved', 'waiting · stands', 'thought'], 'a record by its title: its values, and the note about it');

    assert.equal(answer('What do we know about the weather?').text, 'Nothing in this project’s memory goes by “the weather”: no record has that title, and no kind of value has that name.');
    assert.deepEqual(answer('What do we know about the weather?').rests, []);
    // A reader of memory whose notes could not be read just now is told so.
    assert.match(memAnswer(project, facts.filter((fact) => fact.tag !== 'thought'), { kind: 'holds', about: 'the land area' }, { question: '' }, { notesUnread: true }).text, /\n\nThe memory store did not answer in time, so the assistant’s own notes are not among these\.$/);
  });
});
