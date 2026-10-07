/**
 * Memory said to a person by rule: the facts under an answer the chat gave
 * by rule, and the answer to a question put to memory itself.
 *
 * One test a rule. Under an answer: the facts the question is about, what
 * waits first, at most four, each with its tag at a place the turn keeps,
 * and nothing where memory holds nothing about the question; and a fact
 * only when it bears on what was asked, never for a stray word, a word that
 * is a whole label said of something else, the page or small talk; for a
 * question no rule answered, only a kind of value it names in full; and a
 * line with no mark of its own for a line's end to leave alone. A question
 * to memory: read as one in each of its forms and not
 * when it is another kind of sentence, answered with the facts about what it
 * names, who and when, then the decisions and actions, then the assistant's
 * notes set apart, and in one line when it names nothing memory can find;
 * and asked what was agreed, with the decisions first, each said to be
 * approved once.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEM_UNDER_ANSWER,
  addDecision,
  addEvidence,
  applyProjectChat,
  commitChatProposal,
  createAssessment,
  createProject,
  meetingDigest,
  meetingsHeld,
  memAnswer,
  memAsksMemory,
  memSaidUnder,
  memTagPrinted,
  memThought,
  memUnderAnswer,
  memoryFacts,
  patchProject,
  readMeetingNotes,
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
      ['In this project’s memory:', '- Land area: 1,300 sqm [waiting] raised on a card, 6 Oct 2026, “Update land”', `- Land area: 1,210 sqm [approved] by ${LEAD}, 5 Oct 2026`].join('\n'),
    );
    assert.deepEqual(land.rests.map((rest) => [rest.tag, rest.stands]), [['proposed', false], ['approved', undefined]]);
    placesHold(land);

    // A record named: its values and the note about it, the note last and said to be a thought.
    const paper = memUnderAnswer(project, facts, { question: 'What does the Municipal certificate of the plot say?' })!;
    assert.deepEqual(paper.text.split('\n').slice(1).map((line) => /\[([^\]]+)\]/.exec(line)![1]), ['waiting · stands', 'approved', 'thought']);
    assert.match(paper.text, /^- The certificate is in the seller’s own name\. \[thought\] 6 Oct 2026, about “Municipal certificate of the plot”$/m);
    // After the tag the line is words with commas between. No mark of its own stands where a line may end: the only one is inside a tag.
    assert.doesNotMatch(`${land.text}\n${paper.text}`.replaceAll('[waiting · stands]', ''), / · /);
    placesHold(paper);

    // Nothing the question is about: nothing is said. The project as a whole: what waits anywhere on it, then the newest a person approved.
    assert.equal(memUnderAnswer(project, facts, { question: 'What can you do?' }), undefined);
    for (const whole of [memUnderAnswer(project, facts, { question: 'What do you make of this project so far, in two sentences?' })!, memUnderAnswer(project, facts, { question: 'What should I do next?' }, { whole: true })!]) {
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

  it('are there only when they bear on what was asked: not for a stray word, a common word that is also a short name, the page, the sitting, or small talk', () => {
    const { project, paper } = plot();
    const filed = (title: string, kind: string, ...stated: DocumentFact[]) => {
      const row = addEvidence(project, { title, kind: 'document' }, LEAD);
      row.documentType = kind;
      row.facts = stated;
      return row;
    };
    filed('Zoning certificate of the plot', 'Zoning certificate', value('permissible_far', 2.25, '2.25'), value('zoning', 'Residential (Main)'));
    filed('Conveyance of 1998', 'Mother deed', value('root_year', '1998-09-06', '6 Sep 1998'), value('consideration', 1850000, 'Rs. 18,50,000'));
    filed('Search of the register', 'Encumbrance certificate', value('ec_nil', false, 'no'), value('subsisting_charges', 1, '1'));
    const receipt = filed('Receipt for the year', 'Property tax receipt', value('tax_paid_on', '2025-04-28', '28 Apr 2025'));
    // The page the questions are asked on holds values, and so does the record the sitting is on.
    const title = { department: 'legal', fn: 'legal.title' };
    const check = project.assessments[0]!.scopes[0]!.checks[0]!;
    paper.checkIds = [check.id];
    const facts = memoryFacts(project).held;
    assert.ok(facts.some((fact) => fact.fn === title.fn), 'the page holds facts');
    const kinds = (question: string, more: Partial<Parameters<typeof memUnderAnswer>[2]> = {}): string[] =>
      (memUnderAnswer(project, facts, { question, ...more })?.text.split('\n').slice(1) ?? []).map((line) => /^- ([^:]+):/.exec(line)![1]!).sort();

    // "Far" is the common word here, and the question is about the chain of title: the values its answer is made from.
    assert.deepEqual(kinds('How far back does the title go?', { place: title }), ['Root of title']);
    assert.deepEqual(kinds('How far along is the work?'), []);
    // FAR by its short name with the rest of its label, by the short name alone, and written out in full.
    assert.deepEqual(kinds('What is the permissible FAR?'), ['FAR permissible']);
    assert.deepEqual(kinds('What is the FAR?'), ['FAR permissible', 'Zoning in the plan in force']);
    assert.deepEqual(kinds('What is the floor area ratio?'), ['FAR permissible', 'Zoning in the plan in force']);
    // Written as the abbreviation it is the ratio, whatever word follows it.
    for (const question of ['Is the FAR more than 2?', 'Is the FAR too high?', 'Is the floor area ratio less than 2.5?']) assert.deepEqual(kinds(question), ['FAR permissible', 'Zoning in the plan in force'], question);
    // A question about no kind of value brings none: not the facts of the page it was asked on, nor of the record the sitting is on.
    assert.deepEqual(kinds('What’s missing here?', { place: title }), []);
    assert.deepEqual(kinds('What does this need?', { place: title, sitting: { checkId: check.id } }), []);
    // Asked in other words than the label's, it is still about what the encumbrance certificate found.
    assert.deepEqual(kinds('Is there a mortgage?', { place: title }), ['Charges still subsisting', 'Nil result']);
    // A word for something done names no kind of value alone, though "Paid on" is one.
    assert.ok(facts.some((fact) => fact.aboutId === receipt.id && fact.label === 'Paid on'));
    assert.deepEqual(kinds('Has the advance been paid?'), []);
    // One word that is a whole label names it only where the question is about nothing else. Said of the mortgage, "status" is about the mortgage.
    assert.ok(facts.some((fact) => fact.label === 'Project status'));
    assert.deepEqual(kinds('What is the status?'), ['Project status']);
    assert.deepEqual(kinds('What’s the status of the mortgage?', { place: title }), ['Charges still subsisting', 'Nil result']);
    assert.ok(!kinds('What is the name on the certificate?').includes('Project name') && !kinds('What type of deed is the conveyance?').includes('Project type'));
    // A greeting, a thank-you and "what can you do" have nothing under them, on any page, whatever the reply was about, with whatever few words people add.
    for (const question of ['hello', 'Hi!', 'hi there', 'thanks', 'Thank you!', 'thank you so much', 'What can you do?']) {
      assert.equal(memUnderAnswer(project, facts, { question, place: title }, { whole: true }), undefined, question);
    }
  });

  it('are the answer to a question no rule answered only where it names a kind of value in full', () => {
    const { project, facts } = plot();
    const named = (question: string) => memUnderAnswer(project, facts, { question }, { named: true })?.text;
    // The project's own field, asked for by its name.
    assert.match(named('What is the project type?') ?? '', /^In this project’s memory:\n- Project type: residential \[approved\] \d{1,2} \w{3} \d{4}$/);
    assert.equal(named('What is the land area?')?.split('\n').length, 3, 'what waits and what stands, as under any answer');
    // A record named, the project as a whole, or nothing memory holds: none is what was asked, and nothing is said.
    for (const question of ['What does the Municipal certificate of the plot say?', 'What do you make of this project so far?', 'Who has to keep the drain clear?', 'thanks']) assert.equal(named(question), undefined, question);
    // Nor is a matter of judgement answered by the value it is about, or a statement taken for a question.
    for (const said of ['Why is the project type residential?', 'Should the project type be residential?', 'The project type is residential']) assert.equal(named(said), undefined, said);
    // A question that asks who is answered by a name, and not by an area that happens to go by its words.
    assert.match(named('What is the extent per khata?') ?? '', /^In this project’s memory:\n- Extent per khata: 11,800 sq ft \[approved\] by valuer@example\.com, /);
    assert.equal(named('Who gave the extent per khata?'), undefined);
  });

  it('take a kind of value named in part where it is the only one the words fit, a question word for none of what is asked, and a field of the project by its value', () => {
    const { project } = plot();
    patchProject(project, { siteAddress: '12 Mill Road, Northfield' }, LEAD);
    const filed = (title: string, kind: string, ...stated: DocumentFact[]) => {
      const row = addEvidence(project, { title, kind: 'document' }, LEAD);
      row.documentType = kind;
      row.facts = stated;
    };
    filed('Sanctioned plan of the block', 'Sanctioned building plan', value('sanction_date', '2021-02-22', '22 Feb 2021'), value('sanctioned_area', 27000, '27,000 sqm'), value('refuge_area_provided', 310, '310 sqm'));
    filed('Sketch of the plot', 'Survey sketch', value('road_width_ft', 80, '80 ft'), value('extent_survey', 1105, '1,105 sqm'));
    filed('Search of the register', 'Encumbrance certificate', value('ec_transactions', 3, '3'));
    const facts = memoryFacts(project).held;
    const labels = (said: MemSaid | undefined): string[] => [...new Set((said?.text.split('\n').slice(1) ?? []).map((line) => /^- ([^:]+):/.exec(line)![1]!))];
    const named = (question: string): string[] => labels(memUnderAnswer(project, facts, { question }, { named: true }));
    const under = (question: string): string[] => labels(memUnderAnswer(project, facts, { question }));

    // "Which" and "whose", "how many" and "were found" are how a question is put, and none of what it is about.
    for (const question of ['Which city is it in?', 'Which city is the project in?', 'What city is the project in?', 'What is the city?']) assert.deepEqual(named(question), ['City'], question);
    for (const question of ['How many transactions were found?', 'How many transactions are there?']) assert.deepEqual(named(question), ['Transactions in the period'], question);
    // Part of a label names its kind of value where no other on record has those words.
    assert.deepEqual(named('What’s the address?'), ['Site address']);
    assert.deepEqual(named('What is the road width?'), ['Abutting road width']);
    assert.deepEqual(named('What is the refuge area?'), ['Refuge area provided']);
    // Not where two kinds have them, not by a word for what the value is of, and not by a word for something done.
    assert.ok(facts.some((fact) => fact.label === 'Built-up area sanctioned') && facts.some((fact) => fact.label === 'Extent per survey sketch'));
    for (const question of ['What is the area?', 'What is the sketch?', 'What was sanctioned?', 'What is the status of the mortgage?']) assert.deepEqual(named(question), [], question);
    // A field of the project whose value is all the question is about, however the project is said.
    assert.deepEqual(named('Is the property in Bengaluru?'), ['City']);
    assert.deepEqual(named('Is it residential?'), ['Project type']);
    assert.deepEqual(named('Is the site in Northfield?'), ['Location']);
    // Not where the question is about more than the value, asks who, or is one of judgement.
    for (const question of ['Is the property in Bengaluru or Mysuru?', 'What are residential rates in Northfield?', 'Who is in Bengaluru?', 'Why is it residential?']) assert.deepEqual(named(question), [], question);

    // Under an answer the chat gave by rule: the kind named in part where the answer is not made from it, and the values the answer is made from where it is.
    assert.deepEqual(under('What is the refuge area?'), ['Refuge area provided']);
    assert.deepEqual(under('Is the plan sanctioned?').sort(), ['Built-up area sanctioned', 'Date of sanction']);
    assert.deepEqual(under('What is the sanctioned built-up area?'), ['Built-up area sanctioned']);
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
    const { project, paper, facts } = plot();
    const answer = (question: string): MemSaid => memAnswer(project, facts, memAsksMemory(question)!, { question });

    const undecided = answer('What is still undecided about the land area?');
    assert.equal(
      undecided.text,
      [
        'Still undecided about the land area:',
        '- Land area: 1,300 sqm [waiting] raised on a card, 6 Oct 2026, “Update land”',
        '',
        'Agreed so far:',
        `- Land area: 1,210 sqm [approved] by ${LEAD}, 5 Oct 2026`,
        '',
        'Decisions and actions still open:',
        `- Decision recorded: “Hold the advance until the land area is settled” (Hold payment, proposed) [approved] by ${LEAD}, 5 Oct 2026`,
        '',
        'The assistant’s own notes, which are not facts of the file:',
        '- The land area on the card came from the seller’s broker. [thought] 6 Oct 2026',
      ].join('\n'),
      'the card is named, what stands beside it, the decision that speaks of it, and the note about it and no other',
    );
    assert.deepEqual(undecided.rests.map((rest) => rest.tag), ['proposed', 'approved', 'approved', 'thought']);
    placesHold(undecided);

    const agreed = answer('What was agreed about the land area?').text.split('\n');
    assert.deepEqual([agreed[0], agreed[3], agreed[6]], ['Decisions and actions about the land area:', 'Values approved:', 'Not yet agreed:'], 'the decision that speaks of it first, then what a person approved, and what waits said not to be agreed');
    assert.ok(agreed[1]!.startsWith('- Decision recorded: “Hold the advance until the land area is settled” (Hold payment, proposed) [approved]'), 'a decision nobody has approved yet still says how it stands');
    assert.ok(agreed[4]!.startsWith('- Land area: 1,210 sqm [approved]') && agreed[7]!.startsWith('- Land area: 1,300 sqm [waiting]'));

    // A paper that states a fact is a citation the page draws as a chip: the paper, at its page.
    const changed = answer('What changed about the extent per khata?');
    assert.equal(
      changed.text,
      `What changed about the extent per khata:\n- Extent per khata: 11,800 sq ft [approved] by valuer@example.com, 5 Oct 2026, before: corrected 5 Oct 2026 (11,800 sq ft); reopened 5 Oct 2026 (11,850 sq ft); accepted 5 Oct 2026 (11,850 sq ft) [ev:${paper.id}:p1]`,
      'the citation ends the line, after a space and no mark',
    );
    placesHold(changed);
    assert.equal(answer('What changed about the land area?').text.split('\n')[0], 'Nothing memory holds about the land area has changed since it was first recorded.');

    const record = answer('What do we know about the Municipal certificate of the plot?');
    assert.deepEqual(record.text.split('\n').filter((line) => line.startsWith('- ')).map((line) => /\[([^\]]+)\]/.exec(line)![1]), ['approved', 'waiting · stands', 'thought'], 'a record by its title: its values, and the note about it');

    assert.equal(answer('What do we know about the weather?').text, 'Nothing in this project’s memory goes by “the weather”: no record has that title, and no kind of value has that name.');
    assert.deepEqual(answer('What do we know about the weather?').rests, []);
    // "So far" names no FAR: the question is about the project.
    assert.equal(answer('What do we know so far?').text.split('\n')[0], 'In memory about this project:');
    // A reader of memory whose notes could not be read just now is told so.
    assert.match(memAnswer(project, facts.filter((fact) => fact.tag !== 'thought'), { kind: 'holds', about: 'the land area' }, { question: '' }, { notesUnread: true }).text, /\n\nThe memory store did not answer in time, so the assistant’s own notes are not among these\.$/);
  });

  it('asked what was agreed, says the decisions first, those out of a meeting before the rest, an approved one said to be approved once, and a value only where it is about the same thing', () => {
    const { project } = plot();
    // A deed that recites its four boundaries, each accepted by a person.
    const deed = addEvidence(project, { title: 'Sale deed of the plot', kind: 'document' }, LEAD);
    deed.documentType = 'Sale deed';
    deed.facts = [value('boundary_north', 'Survey No. 117'), value('boundary_south', 'Temple Tank Road'), value('boundary_east', 'Survey No. 119'), value('boundary_west', 'Survey No. 118/1')];
    reviewFacts(project, deed.id, ['boundary_north', 'boundary_south', 'boundary_east', 'boundary_west'], 'accept', VALUER);
    // A decision made by hand, and then one out of a meeting.
    addDecision(project, { title: 'Paint the boundary wall before handover', decisionType: 'other', decisionMaker: 'Lead', rationale: 'Agreed on site.' }, LEAD).status = 'approved';
    const notes = ['Minutes of the meeting, Northfield corner plot', 'Date: 3 October 2026', 'Present: Asha Rao, Vikram Shetty', '', 'Decision: The boundary wall on the east side will follow the survey sketch line, not the old fence.'].join('\n');
    const file = { storageKey: 'notes-1.txt', fileName: 'Meeting notes.txt', mimeType: 'text/plain', sizeBytes: notes.length };
    applyProjectChat(project, 'Notes of a meeting pasted', { actor: LEAD, meeting: { keep: { file, came: 'pasted', reading: readMeetingNotes(notes), digest: meetingDigest(notes) } }, modelReader: false });
    const item = meetingsHeld(project)[0]!.items.find((held) => held.text.includes('boundary wall'))!;
    assert.ok(commitChatProposal(project, item.proposalId!, LEAD).recordId, 'accepting the card made the decision');
    const facts = memoryFacts(project).held;
    const answer = (question: string): string[] => memAnswer(project, facts, memAsksMemory(question)!, { question }).text.split('\n');

    const wall = answer('What was agreed about the boundary wall?');
    assert.equal(wall[0], 'Decisions and actions about the boundary wall:');
    assert.match(wall[1]!, /^- Decision recorded: “The boundary wall on the east side will follow the survey sketch line, not the old fence\.” \[approved\] by .+, from the meeting of 3 Oct 2026 \[notes:/, 'out of the meeting, first');
    assert.match(wall[2]!, /^- Decision recorded: “Paint the boundary wall before handover” \[approved\] by /, 'then the one made by hand');
    assert.equal(wall.length, 3, 'and no boundary the deed recites: none of them is about a wall');
    for (const line of wall.slice(1)) assert.equal(line.split('approved').length - 1, 1, 'approved is said once, by the tag');

    // Asked about the boundary itself, the deed's four are about it, and follow the decisions.
    const boundary = answer('What was agreed about the boundary?');
    assert.deepEqual([boundary[0], boundary[3], boundary[4]], ['Decisions and actions about the boundary:', '', 'Values approved:']);
    assert.deepEqual(boundary.slice(5).map((line) => /^- (\w+ boundary): /.exec(line)?.[1]).sort(), ['East boundary', 'North boundary', 'South boundary', 'West boundary']);
    assert.ok(boundary.slice(5).every((line) => line.includes(`[ev:${deed.id}:p1]`)), 'each cited to the deed, at its page');
    // What memory holds about the wall is the same: the decisions, and no boundary.
    assert.deepEqual(answer('What do we know about the boundary wall?').filter((line) => /boundary: /.test(line)), []);
  });
});
