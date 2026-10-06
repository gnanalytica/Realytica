/**
 * A status report, written by code from what the project's memory is told.
 *
 * One test for each rule. That a sentence asks for one, and which period it
 * names. That what changed is a line for each thing that happened in the
 * period and nothing from outside it, each with the record behind it and
 * where that stands, and that a line resting only on something nobody has
 * accepted says so. That what waits is told with who it waits on, and what
 * comes next by its date. That the same record gives the same report twice.
 * That it is a draft among the project's reports, asked for again is the
 * same draft, and stops moving when issued. That a period with nothing in it
 * is said in one line. That a model's wording is held to the lines: it adds
 * none, drops none, and changes no figure, title, day, person or source.
 *
 * Every name, paper and date here is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAction,
  addDecision,
  addEvidence,
  addFinding,
  applyProjectChat,
  asksForStatusReport,
  commitChatProposal,
  createChatProposal,
  createProject,
  issueReport,
  keepMeeting,
  keepStatusWording,
  memoryDelta,
  patchRecordStatus,
  readMeetingNotes,
  resolveReportBlock,
  resolveStatusBlock,
  reviewFacts,
  statusLinesToWord,
  statusPeriodAsked,
  statusPeriodSaid,
  statusReport,
  statusWordingHeld,
  type DdProject,
  type DocumentFact,
  type StatusLine,
} from '@realytica/shared';

const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';

/** Wednesday 16 September 2026: the week began on Monday the 14th. */
const NOW = new Date('2026-09-16T10:00:00.000Z');
const WEEK = { from: '2026-09-14T00:00:00.000Z', to: NOW.toISOString() };

/** Do something to the project as though it were done at this moment: the trail's lines for it take that time. */
function on<T>(project: DdProject, at: string, act: () => T): T {
  const before = project.audit.length;
  const made = act();
  for (const event of project.audit.slice(before)) event.at = at;
  return made;
}

/**
 * A project with a month behind it. Before the week: a receipt filed, two
 * actions raised. In the week: a certificate filed and read and one of its
 * two values accepted, a decision, an action closed, a finding, another
 * action's date passing, a meeting's notes kept and its open point accepted.
 * Waiting at the end: the certificate's other value, a card, the open point,
 * the overdue action. Ahead: an action due on the 30th.
 */
function plot(): { project: DdProject; ids: Record<'khata' | 'receipt' | 'decision' | 'done' | 'late' | 'ahead' | 'finding' | 'open', string> } {
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-ST1');
  const value = (key: string, held: DocumentFact['value'], display: string): DocumentFact => ({ key, label: key, value: held, display, page: 1, quote: `${key}: ${display}`, review: 'proposed' });

  const receipt = on(project, '2026-09-01T09:00:00.000Z', () => addEvidence(project, { title: 'Tax paid receipt', kind: 'document' }, LEAD));
  const done = on(project, '2026-09-02T09:00:00.000Z', () => addAction(project, { title: 'Get the encumbrance certificate', kind: 'evidence_request', owner: 'Vikram', priority: 'high', dueDate: '2026-09-18' }, LEAD));
  const late = on(project, '2026-09-02T09:05:00.000Z', () => addAction(project, { title: 'Send the survey sketch', kind: 'clarification', owner: 'Asha', priority: 'medium', dueDate: '2026-09-15' }, LEAD));
  const ahead = on(project, '2026-09-02T09:10:00.000Z', () => addAction(project, { title: 'File the conversion application', kind: 'approval_submission', owner: 'Meera', priority: 'medium', dueDate: '2026-09-30' }, LEAD));

  const khata = on(project, '2026-09-14T09:00:00.000Z', () => addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD));
  khata.documentType = 'Khata certificate and extract';
  khata.readMethod = 'text';
  khata.createdAt = '2026-09-14T09:00:00.000Z';
  khata.facts = [value('extent_khata', 1100.9, '11,850 sq ft'), value('khata_number', '1234/56', '1234/56')];
  on(project, '2026-09-14T10:00:00.000Z', () => reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER));
  const decision = on(project, '2026-09-15T09:00:00.000Z', () => addDecision(project, { title: 'Proceed to the sale agreement', decisionType: 'other', decisionMaker: 'The partners', rationale: 'Title is clear so far.', status: 'approved' }, LEAD));
  on(project, '2026-09-15T11:00:00.000Z', () => patchRecordStatus(project, project.actions, done.id, 'closed', 'action', LEAD));
  const finding = on(project, '2026-09-15T12:00:00.000Z', () => addFinding(project, { title: 'Extent differs between two papers', description: 'The deed and the certificate disagree.', severity: 'high', discipline: 'legal', evidenceIds: [khata.id] }, LEAD));

  const card = createChatProposal('patch_project', 'Record the land area as 1,300 sqm', 'Suggested in chat.', 'The land area becomes 1,300 sqm.', { landAreaSqm: 1300 }, LEAD);
  card.createdAt = '2026-09-15T13:00:00.000Z';
  project.chatProposals.push(card);

  const notes = 'Site meeting notes\nDate: 14 September 2026\nPresent: Asha Rao, Meera Nair\nOpen: Who pays for the soil test.';
  const { meeting } = on(project, '2026-09-16T08:00:00.000Z', () => keepMeeting(project, { file: { storageKey: 'notes.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: notes.length }, came: 'pasted', reading: readMeetingNotes(notes) }, LEAD));
  meeting.keptAt = '2026-09-16T08:00:00.000Z';
  for (const item of meeting.items) project.chatProposals.push(createChatProposal('add_decision', `Open point: ${item.text}`, '', '', { title: item.text, decisionType: 'other', decisionMaker: '', rationale: 'Left open.', status: 'pending' }, LEAD));
  // The card the meeting raised is the one it names: accept it, as a person does.
  meeting.items[0]!.proposalId = project.chatProposals.at(-1)!.id;
  const open = on(project, '2026-09-16T08:30:00.000Z', () => commitChatProposal(project, meeting.items[0]!.proposalId, LEAD).recordId!);
  project.decisions.find((held) => held.id === open)!.createdAt = '2026-09-16T08:30:00.000Z';

  return { project, ids: { khata: khata.id, receipt: receipt.id, decision: decision.id, done: done.id, late: late.id, ahead: ahead.id, finding: finding.id, open } };
}

const said = (lines: readonly StatusLine[]): string[] => lines.map((line) => line.what);

describe('asking for a status report', () => {
  it('is an instruction to write one, and a question about the status is not', () => {
    for (const asked of ['Write this week’s status for the owner', 'write this week\'s status for the owner', 'Draft a status update since the last report', 'Status report for September', 'please prepare the weekly report']) {
      assert.equal(asksForStatusReport(asked), true, asked);
    }
    for (const asked of ['What is the status of the khata?', 'Is the status report issued?', 'What changed this week?', 'Give me a status update on the khata']) assert.equal(asksForStatusReport(asked), false, asked);
  });

  it('names its period: this week when it names none, a month, a day since, the last report', () => {
    const { project } = plot();
    const period = (asked: string) => statusPeriodAsked(project, asked, NOW);
    assert.deepEqual(period('Write this week’s status for the owner'), { period: WEEK, audience: 'the owner' });
    assert.deepEqual(period('Write the status').period, WEEK, 'the week so far, from Monday');
    assert.deepEqual(period('Status report for August').period, { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' });
    assert.deepEqual(period('Write the status for September').period, { from: '2026-09-01T00:00:00.000Z', to: NOW.toISOString() }, 'a month still running ends now');
    assert.deepEqual(period('Write the status for October').period.from, '2025-10-01T00:00:00.000Z', 'a month not yet begun is last year’s');
    assert.deepEqual(period('Write the status since 1 September').period, { from: '2026-09-01T00:00:00.000Z', to: NOW.toISOString() });
    assert.deepEqual(period('Write the status since Monday').period.from, '2026-09-14T00:00:00.000Z');
    assert.deepEqual(period('Write last week’s status').period, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' });
    assert.deepEqual(
      [statusPeriodSaid(WEEK), statusPeriodSaid(period('Status report for August').period), statusPeriodSaid({ from: '2025-12-29T00:00:00.000Z', to: '2026-01-05T00:00:00.000Z' })],
      ['14 Sep to 16 Sep 2026', 'August 2026', '29 Dec 2025 to 4 Jan 2026'],
    );

    // Since the last report: from where the last one issued ended. With none issued, from the project's start, and it says so.
    assert.equal(period('Write the status since the last report').noEarlier, true);
    const sent = plot().project;
    applyProjectChat(sent, 'Write the status report for September 2026', { actor: LEAD });
    assert.equal(statusPeriodAsked(sent, 'Write the status since the last report', NOW).noEarlier, true, 'a draft nobody issued is not the last report');
    issueReport(sent, sent.reports[0]!.id, LEAD);
    assert.deepEqual(statusPeriodAsked(sent, 'Write the status since the last report', new Date('2026-10-20T09:00:00.000Z')).period, { from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T09:00:00.000Z' });
    applyProjectChat(project, 'Write the status report for August 2026', { actor: LEAD });
    assert.equal(project.reports.length, 0, 'nothing happened in August, so there is still no report');
  });
});

describe('what changed in a period', () => {
  const { project, ids } = plot();
  const status = statusReport(project, WEEK, NOW);

  it('is one line for each thing that happened in it, in the order it happened, and nothing from outside it', () => {
    assert.deepEqual(said(status.changed), [
      'Filed and read: “Khata certificate” · accepted: Extent per khata 11,850 sq ft · 1 value waits to be accepted.',
      'Decision: “Proceed to the sale agreement”.',
      'Done: “Get the encumbrance certificate”.',
      'Finding raised: “Extent differs between two papers” (high).',
      'Overdue: “Send the survey sketch”, due 15 Sep 2026.',
      'Notes kept of the meeting of 14 Sep 2026: 1 thing read from them, 1 on the record.',
      'Left open: “Who pays for the soil test”.',
    ]);
    assert.ok(!status.changed.some((line) => line.what.includes('Tax paid receipt')), 'a paper filed before the period is not in it');
  });

  it('gives every line the record or paper behind it, who and when, and where it stands', () => {
    const [paper, decision, done, finding, late, meeting, open] = status.changed;
    assert.deepEqual([paper!.when, paper!.who, paper!.stands, paper!.behind, paper!.recordId], ['2026-09-14', `${LEAD}, ${VALUER}`, 'on file', '“Khata certificate”, Khata certificate and extract', ids.khata]);
    assert.deepEqual([decision!.stands, decision!.behind, decision!.recordId], ['approved', 'the decision register', ids.decision]);
    assert.deepEqual([done!.stands, done!.who, done!.when, done!.recordId], ['closed', LEAD, '2026-09-15', ids.done]);
    assert.deepEqual([finding!.behind, finding!.recordId, finding!.evidenceIds], ['“Khata certificate”', ids.finding, [ids.khata]]);
    assert.deepEqual([late!.who, late!.stands, late!.recordId], ['Asha', 'overdue', ids.late]);
    assert.deepEqual([meeting!.stands, meeting!.behind], ['on file', 'its notes, pasted']);
    assert.deepEqual([open!.stands, open!.behind, open!.recordId], ['pending', 'the meeting of 14 Sep 2026, its notes on file', ids.open]);
    assert.ok(status.changed.every((line) => line.behind && line.stands && line.when), 'no line without something behind it');
  });

  it('says so when a line rests only on something nobody has accepted', () => {
    const fresh = plot().project;
    const row = on(fresh, '2026-09-16T09:00:00.000Z', () => addEvidence(fresh, { title: 'Sale deed', kind: 'document' }, LEAD));
    row.readMethod = 'text';
    row.documentType = 'Sale deed';
    row.facts = [{ key: 'consideration', label: 'Consideration', value: 4500000, display: 'Rs 45,00,000', page: 2, quote: 'a sum of Rs 45,00,000', review: 'proposed' }];
    const line = statusReport(fresh, WEEK, NOW).changed.find((held) => held.what.includes('Sale deed'))!;
    assert.equal(line.what, 'Filed and read: “Sale deed” · none of its 1 value read is accepted yet.');
    assert.deepEqual([line.stands, line.waits], ['waiting', true]);
  });

  it('is the same report twice', () => {
    assert.deepEqual(statusReport(project, WEEK, NOW), status);
  });
});

describe('what is waiting, and what comes next', () => {
  const { project, ids } = plot();
  const status = statusReport(project, WEEK, NOW);

  it('tells what waits with who it waits on', () => {
    assert.deepEqual(
      status.waiting.map((line) => [line.what, line.who, line.stands]),
      [
        ['Overdue: “Send the survey sketch”, due 15 Sep 2026.', 'Asha', 'overdue'],
        ['To be decided: “Who pays for the soil test”.', 'nobody named', 'pending'],
        ['On a card, not yet accepted: Record the land area as 1,300 sqm.', LEAD, 'waiting'],
        ['1 value read off “Khata certificate” waits to be accepted.', LEAD, 'waiting'],
      ],
    );
    assert.deepEqual(status.waiting.map((line) => line.waits === true), [false, false, true, true], 'a card and a value nobody accepted are said to be waiting');
  });

  it('tells what comes next by its date', () => {
    assert.deepEqual(status.next.map((line) => [line.what, line.who, line.when, line.recordId]), [['Due 30 Sep 2026: “File the conversion application”.', 'Meera', '2026-09-30', ids.ahead]]);
  });
});

describe('the report', () => {
  it('is a draft among the project’s reports, asked for again is the same draft, and stops moving when issued', () => {
    const { project, ids } = plot();
    const first = applyProjectChat(project, 'Write the status report for September 2026 for the owner', { actor: LEAD });
    assert.equal(project.reports.length, 1);
    const report = project.reports[0]!;
    assert.deepEqual([report.kind, report.status, report.title], ['status', 'generated', 'Status report for the owner — Northfield corner plot, September 2026']);
    assert.deepEqual(report.body.blocks.map((block) => [block.heading, block.source?.kind]), [['What changed, September 2026', 'status_changed'], ['Waiting, and on whom', 'status_waiting'], ['What comes next', 'status_next']]);

    // The chat says it short, with a way to open it.
    const lines = first.assistantTurn.text.split('\n');
    assert.equal(lines[0], `Wrote the status report for the owner, September 2026, as a draft: [${report.id}]`);
    // Over the whole month both open actions passed their dates: the sketch on the 15th and the application on the 30th.
    assert.equal(lines[1], '- Changed: 2 papers, 1 value accepted, 2 decisions, 1 action done, 2 actions overdue, 1 finding raised, 1 meeting.');
    assert.equal(lines.at(-1), 'Every line in it names the record or paper behind it. Read it, edit it and issue it under your name.');
    assert.deepEqual(first.navigations.at(-1), { target: 'reports', item: report.id });

    // Its sections are tables that read the record, each row with what is behind it.
    const changed = resolveReportBlock(project, report.body.blocks[0]!);
    assert.deepEqual(changed.table!.columns, ['No.', 'What changed', 'When', 'Who', 'Stands', 'Behind it']);
    assert.deepEqual(changed.table!.rows[0], { cells: ['1', 'Filed: “Tax paid receipt”.', '1 Sep 2026', LEAD, 'on file', '“Tax paid receipt”'], recordId: ids.receipt, evidenceIds: [ids.receipt] });
    assert.equal(changed.lines.length, changed.table!.rows.length);

    const again = applyProjectChat(project, 'Write the status report for September 2026 for the owner', { actor: LEAD });
    assert.equal(project.reports.length, 1, 'no second report');
    assert.equal(again.assistantTurn.text.split('\n')[0], `The status report for the owner, September 2026, is already written as a draft: [${report.id}]`);

    // Issued, it says what it said, whatever the record goes on to say.
    const was = changed.lines;
    issueReport(project, report.id, LEAD, { name: 'A Partner' });
    on(project, '2026-09-20T09:00:00.000Z', () => addFinding(project, { title: 'A later finding', description: 'Raised after the report went out.', severity: 'low', discipline: 'legal' }, LEAD));
    assert.deepEqual(report.body.blocks[0]!.frozen, was);
    assert.ok(resolveReportBlock(project, report.body.blocks[0]!).lines.some((line) => line.includes('A later finding')), 'the record has moved, and the issued report has not');
    assert.deepEqual(memoryDelta(project, {}).entries.filter((entry) => entry.kind === 'report_issued').map((entry) => entry.about), [[report.id]], 'and memory is told it was issued');
  });

  it('says a period with nothing in it in one line', () => {
    const { project } = plot();
    const quiet = applyProjectChat(project, 'Write the status report for August 2026', { actor: LEAD });
    assert.equal(quiet.assistantTurn.text, 'Nothing changed on this project in the period asked for (August 2026), so no report was written.');
    assert.equal(project.reports.length, 0);
    const block = { id: 'rbk_1', origin: 'derived' as const, source: { kind: 'status_changed' as const, from: '2026-08-03T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' } };
    assert.deepEqual(resolveStatusBlock(project, block, NOW), { lines: [], recordIds: [], note: 'Nothing changed on this project in the period (3 Aug to 9 Aug 2026).' });
  });
});

describe('a model’s wording of the lines', () => {
  const lines = ['Filed and read: “Khata certificate” · accepted: Extent per khata 11,850 sq ft.', 'Overdue: “Send the survey sketch”, due 15 Sep 2026.'];

  it('is kept only for a line that exists, with that line’s figures and titles and no others', () => {
    const held = statusWordingHeld(lines, [
      { n: 1, text: 'The “Khata certificate” was filed and read, and its extent of 11850 sq ft was accepted.' },
      // A date moved, and the paper's name dropped.
      { n: 2, text: 'The survey sketch has been overdue since 16 Sep 2026.' },
      // A line the report does not have.
      { n: 3, text: 'The owner should also expect a delay.' },
      // A second wording of a line that has one, with a figure of its own.
      { n: 1, text: 'The “Khata certificate” came in with 2 values.' },
    ]);
    assert.deepEqual(held, [{ said: lines[0], as: 'The “Khata certificate” was filed and read, and its extent of 11850 sq ft was accepted.' }]);
    assert.deepEqual(statusWordingHeld(lines, 'not a list'), []);
  });

  it('replaces a line’s words and nothing else, only while the line stands, and can be turned off', () => {
    const { project, ids } = plot();
    applyProjectChat(project, 'Write the status report for September 2026', { actor: LEAD });
    const report = project.reports[0]!;
    const asked = statusLinesToWord(project, report, NOW);
    const at = asked.findIndex((row) => row.line.startsWith('Filed and read: “Khata certificate”'));
    const kept = keepStatusWording(report, asked, [
      { n: at + 1, text: 'The “Khata certificate” was filed and read. Its extent of 11,850 sq ft was accepted, and 1 value still waits.' },
      { n: asked.length + 5, text: 'An extra line.' },
    ]);
    assert.equal(kept, 1);

    const block = report.body.blocks[0]!;
    const before = resolveStatusBlock(project, { ...block, wording: undefined }, NOW);
    const shown = resolveStatusBlock(project, block, NOW);
    const row = shown.table!.rows.find((held) => held.worded)!;
    const plain = before.table!.rows.find((held) => held.recordId === ids.khata)!;
    assert.equal(row.cells[1], 'The “Khata certificate” was filed and read. Its extent of 11,850 sq ft was accepted, and 1 value still waits.');
    assert.deepEqual([row.cells[0], ...row.cells.slice(2), row.recordId, row.evidenceIds], [plain.cells[0], ...plain.cells.slice(2), plain.recordId, plain.evidenceIds], 'the day, the person, where it stands and what is behind it are untouched');
    assert.equal(shown.table!.rows.length, before.table!.rows.length, 'no line added and none dropped');
    assert.match(shown.note ?? '', /^A model reworded 1 line\./);

    assert.ok(!resolveStatusBlock(project, { ...block, source: { ...block.source!, plain: true } }, NOW).table!.rows.some((held) => held.worded), 'plain words: as code wrote it');

    // The other value is accepted: the line code writes is another line now, and the old wording is not shown for it.
    on(project, '2026-09-17T09:00:00.000Z', () => reviewFacts(project, ids.khata, ['khata_number'], 'accept', VALUER));
    assert.ok(!resolveStatusBlock(project, block, new Date('2026-09-18T10:00:00.000Z')).table!.rows.some((held) => held.worded));
  });
});
