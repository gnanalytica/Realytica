/**
 * Papers owed: the one list a project's three records of what is owed make
 * on screen, a department at a time, and the four lines Overview opens with.
 *
 * A project has no page of its own for the list. Every count, notice and
 * request row opens the Documents of the department that holds the paper,
 * and a request that belongs to no department opens the firm's Requests.
 *
 * The documents the checks expect, the lines of a loaded list and the
 * requests made by hand stay three records. Here they are read as one list
 * by who owes the paper, each line standing in one of four places. Every
 * project, party and paper is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEPARTMENT_KEYS,
  PAPERS_OWED,
  PROJECT_COCKPIT_PANES,
  PAPER_STANDING_LABEL,
  addAction,
  addChecklistItems,
  addEvidence,
  addMilestones,
  addRequest,
  applyProjectChat,
  checklistFunction,
  checklistSheet,
  createProject,
  ensureWorkstreamChecks,
  paperLineSaid,
  paperPlace,
  papersOwed,
  papersOwedCsvFile,
  papersOwedSaid,
  papersPlacePath,
  portfolioView,
  projectBrief,
  raiseChecklistRequests,
  recordDispatch,
  recordReply,
  receiveChecklistItem,
  requestDepartment,
  requestPlace,
  requirementSheet,
  tellSaid,
  type DdProject,
  type PaperLine,
  type PapersPlace,
} from '@realytica/shared';

const LEAD = 'lead@example.com';
const NOW = '2026-10-12T06:00:00.000Z';

function project(): DdProject {
  return createProject({ name: 'Canal Street block', type: 'residential', location: 'Canal Street', city: 'Kadamba', currentStage: 'construction' }, 'RYT-PO1', LEAD);
}

/** A list on two desks, one line asked for and one answered, and two requests made by hand. */
function worked(): DdProject {
  const p = project();
  addChecklistItems(
    p,
    'construction',
    [
      { title: 'Pour cards for the raft', owedBy: 'Hill Builders' },
      { title: 'Cube test results', owedBy: 'Hill Builders' },
      { title: 'Lift shop drawings', owedBy: 'Lift vendor' },
      { title: 'Temporary power sanction' },
    ],
    LEAD,
  );
  addChecklistItems(p, 'finance', [{ title: 'Bank guarantee', owedBy: 'Hill Builders' }, { title: 'Insurance policy', owedBy: 'Hill Builders' }], LEAD);
  const id = (title: string) => p.checklist!.find((item) => item.title === title)!.id;
  raiseChecklistRequests(p, { department: 'construction', itemIds: [id('Lift shop drawings')], dueAt: '2026-10-06' }, LEAD);
  raiseChecklistRequests(p, { department: 'construction', itemIds: [id('Pour cards for the raft')], dueAt: '2026-10-05' }, LEAD);
  const answered = p.requests!.find((request) => request.checklistItemIds?.includes(id('Pour cards for the raft')))!;
  recordDispatch(p, answered.id, { channel: 'email', to: 'site@hill.example', at: '2026-10-01T05:00:00.000Z', by: LEAD, reference: 'AAAAA-bbbbbb', expiresAt: '2026-12-01T00:00:00.000Z' });
  recordReply(p, answered.id, { channel: 'email', from: 'site@hill.example', fromName: 'Hill Builders site office', receivedAt: '2026-10-10T05:00:00.000Z', deliveryId: 'd-1', text: 'Attached.', attachments: [] });
  receiveChecklistItem(p, id('Insurance policy'), {}, LEAD);
  addRequest(p, { title: 'Crane hire quote', recipient: 'Hill Builders', dueAt: '2026-10-20', send: true }, LEAD);
  addRequest(p, { title: 'Fire NOC renewal copy', recipient: 'Fire consultant' }, LEAD);
  return p;
}

const lineOf = (p: DdProject, title: string, opts: Parameters<typeof papersOwed>[1] = { now: NOW }): PaperLine => {
  const view = papersOwed(p, opts);
  const found = [...view.parties.flatMap((party) => party.lines), ...view.inHand].find((line) => line.title === title);
  assert.ok(found, `${title} is on the list`);
  return found;
};

describe('papers owed, as one list', () => {
  it('is empty on a project that has asked for nothing', () => {
    const view = papersOwed(project(), { now: NOW });
    assert.deepEqual([view.total, view.owed, view.parties.length, view.inHand.length], [0, 0, 0, 0]);
    assert.equal(papersOwedSaid(view), 'Nothing asked for yet');
  });

  it('puts a loaded list, the requests made by hand and what the checks expect in one list, each line in one of four places', () => {
    const p = worked();
    const view = papersOwed(p, { now: NOW });
    assert.equal(view.total, 8);
    assert.deepEqual([view.owed, view.notAsked, view.asked, view.answered, view.inHand.length, view.overdue], [7, 4, 2, 1, 1, 1]);
    assert.equal(papersOwedSaid(view), '7 owed · 1 to confirm · 2 asked for · 4 not asked · 1 overdue');
    assert.equal(lineOf(p, 'Cube test results').standing, 'not_asked');
    assert.equal(lineOf(p, 'Lift shop drawings').standing, 'asked');
    assert.equal(lineOf(p, 'Pour cards for the raft').standing, 'answered');
    assert.equal(lineOf(p, 'Insurance policy').standing, 'in_hand');
    // A request made by hand is a line too: sent is asked for, a draft is not asked.
    assert.deepEqual([lineOf(p, 'Crane hire quote').from, lineOf(p, 'Crane hire quote').standing], ['request', 'asked']);
    assert.equal(lineOf(p, 'Fire NOC renewal copy').standing, 'not_asked');
    // The request that covers a line of the list is that line, not a second one.
    assert.equal([...view.parties.flatMap((party) => party.lines)].filter((line) => line.title === '1 document' || line.from === 'request').length, 2);

    ensureWorkstreamChecks(p, ['construction.quality'], LEAD);
    const expected = requirementSheet(p).total;
    assert.ok(expected > 0, 'the checks expect documents');
    // What the checks would expect and nobody has asked for is a list to pick from, not papers owed: it is counted nowhere.
    const both = papersOwed(p, { now: NOW });
    assert.equal(both.total, 8, 'a document nobody asked for is not owed by anybody');
    assert.deepEqual([both.owed, both.notAsked], [7, 4]);
    assert.equal(both.expected.length, expected);
    assert.equal(both.total + both.expected.length, requirementSheet(p).total + checklistSheet(p).total + 2, 'and nothing is counted twice or dropped');
    const soil = both.expected.find((line) => line.title === 'Soil investigation report')!;
    assert.deepEqual([soil.from, soil.standing, soil.party, soil.department], ['checks', 'not_asked', undefined, 'construction']);
    assert.equal(paperLineSaid(soil, (iso) => iso.slice(0, 10)), 'A check expects it');
    assert.ok(!both.parties.some((party) => party.lines.includes(soil)), 'and it is under nobody');
  });

  it('groups what is owed by who owes it, whoever has answered first and nobody named last', () => {
    const view = papersOwed(worked(), { now: NOW });
    assert.deepEqual(
      view.parties.map((party) => [party.party, party.lines.length, party.answered, party.overdue, party.notAsked]),
      [
        ['Hill Builders', 4, 1, 0, 2],
        ['Lift vendor', 1, 0, 1, 0],
        ['Fire consultant', 1, 0, 0, 1],
        [undefined, 1, 0, 0, 1],
      ],
    );
    // Inside a party the reply to confirm leads, then what is asked for, then what is not.
    assert.deepEqual(view.parties[0]!.lines.map((line) => line.standing), ['answered', 'asked', 'not_asked', 'not_asked']);
  });

  it('does not call a paper overdue once it is answered: it waits on the firm, not on them', () => {
    const p = worked();
    const answered = lineOf(p, 'Pour cards for the raft');
    assert.equal(answered.overdue, undefined, 'due 5 October, answered 10 October');
    assert.equal(answered.repliedBy, 'Hill Builders site office');
    assert.equal(paperLineSaid(answered, (iso) => iso.slice(0, 10)), 'Answered by Hill Builders site office · waiting for you to confirm');
    const late = lineOf(p, 'Lift shop drawings');
    assert.equal(late.overdue, true);
    assert.match(paperLineSaid(late, (iso) => iso.slice(0, 10)), /^Asked \d{4}-\d{2}-\d{2} · due 2026-10-06 \(overdue\)$/);
  });

  it('narrows to one desk, where a request tied to no desk is not shown', () => {
    const p = worked();
    const finance = papersOwed(p, { department: 'finance', now: NOW });
    assert.deepEqual([finance.total, finance.owed, finance.inHand.length], [2, 1, 1]);
    assert.ok(!finance.parties.some((party) => party.lines.some((line) => line.from === 'request')));
    const engineering = papersOwed(p, { department: 'construction', now: NOW });
    assert.deepEqual(engineering.parties.flatMap((party) => party.lines.map((line) => line.title)).sort(), ['Cube test results', 'Lift shop drawings', 'Pour cards for the raft', 'Temporary power sanction']);
  });

  it('exports as one spreadsheet no cell of which can run as a formula', () => {
    const p = project();
    addChecklistItems(p, 'finance', [{ title: '=SUM(A1), "quoted"', owedBy: '+91 consultant' }], LEAD);
    const csv = papersOwedCsvFile(papersOwed(p, { now: NOW }));
    assert.ok(csv.startsWith('﻿Owed by,Paper,Standing,Asked on,Due,Overdue,Department,Where,Document\n'));
    assert.ok(csv.includes(`'+91 consultant,"'=SUM(A1), ""quoted""",${PAPER_STANDING_LABEL.not_asked},`), csv);
  });

  it('shows somebody working from a grant only what their copy holds', () => {
    const p = worked();
    // A collaborator is handed no checklist and none of the firm's requests.
    const copy: DdProject = { ...structuredClone(p), checklist: undefined, requests: [] };
    assert.equal(papersOwed(copy, { now: NOW }).total, 0);
    // And whatever a copy holds, it is read without the firm's replies or its requests made by hand.
    const theirs = papersOwed(p, { now: NOW, outside: true });
    assert.equal(theirs.answered, 0);
    assert.equal(lineOf(p, 'Pour cards for the raft', { now: NOW, outside: true }).standing, 'asked');
    assert.equal(lineOf(p, 'Pour cards for the raft', { now: NOW, outside: true }).repliedBy, undefined);
    assert.ok(![...theirs.parties.flatMap((party) => party.lines), ...theirs.inHand].some((line) => line.from === 'request'));
  });
});

const ENGINEERING = '/projects/prj_1/w/construction.progress?part=documents';
const FINANCE = '/projects/prj_1/w/finance.feasibility?part=documents';
const at = (place: PapersPlace | undefined): string => (place ? papersPlacePath('prj_1', place) : 'nowhere');

describe('where a paper owed is worked', () => {
  it('is the Documents of the department that holds it, and never a page of the project’s own', () => {
    assert.ok(!(PROJECT_COCKPIT_PANES as readonly string[]).includes('papers'));
    const p = worked();
    assert.equal(at(paperPlace(lineOf(p, 'Cube test results'))), ENGINEERING);
    assert.equal(at(paperPlace(lineOf(p, 'Bank guarantee'))), FINANCE);
    // A line can be named, to open on arrival.
    assert.equal(at(paperPlace(lineOf(p, 'Cube test results'), 'l:chk_1')), `${ENGINEERING}&item=l%3Achk_1`);
    // Design's functions hold sheets and their documents, so its papers are worked on the first of them.
    assert.equal(at(paperPlace({ department: 'design' })), '/projects/prj_1/w/design.drawings?part=documents');
    // A department with no function laid out in parts shows no list: its own page for a line nobody was asked for.
    for (const department of DEPARTMENT_KEYS.filter((key) => !checklistFunction(key))) assert.equal(at(paperPlace({ department })), `/projects/prj_1/d/${department}`);
  });

  it('sends a request to the department of the lines it covers, and one that belongs to none to the firm’s Requests', () => {
    const p = worked();
    const covering = p.requests!.find((request) => request.checklistItemIds?.length)!;
    assert.equal(requestDepartment(p, covering), 'construction');
    assert.equal(at(requestPlace(p, covering)), ENGINEERING);
    const byHand = p.requests!.find((request) => request.title === 'Crane hire quote')!;
    assert.equal(requestDepartment(p, byHand), undefined);
    assert.equal(at(requestPlace(p, byHand)), '/requests');
    // The firm's list of requests carries the place with each row.
    const rows = portfolioView([p], NOW).requests;
    assert.deepEqual(rows.map((row) => [row.request.title, papersPlacePath('prj_1', row.open)]).sort(), [
      ['Crane hire quote', '/requests'],
      ['Fire NOC renewal copy', '/requests'],
      ['Lift shop drawings', ENGINEERING],
      ['Pour cards for the raft', ENGINEERING],
    ]);
  });

  it('opens a notice of a reply where the reply is confirmed', () => {
    const p = worked();
    const replied = p.requests!.find((request) => request.replies?.length)!;
    const reply = replied.replies![0]!;
    const line = tellSaid(p, { id: 'tn_1', to: LEAD, at: reply.receivedAt, kind: 'request_replied', by: `outside:${reply.from}`, why: [], requestId: replied.id });
    assert.equal(line?.action, 'Confirm it answers the request, or set it aside.');
    assert.equal(at(line?.open), ENGINEERING);
    // The paper standing "To confirm" is on that department's list, so Confirm is one step from the notice.
    assert.equal(lineOf(p, 'Pour cards for the raft', { department: 'construction', now: NOW }).standing, 'answered');
    const byHand = p.requests!.find((request) => request.title === 'Crane hire quote')!;
    assert.equal(at(tellSaid(p, { id: 'tn_2', to: LEAD, at: NOW, kind: 'request_answered', by: LEAD, why: [], requestId: byHand.id })?.open), '/requests');
    const inHand = p.checklist!.find((item) => item.title === 'Insurance policy')!;
    assert.equal(at(tellSaid(p, { id: 'tn_3', to: LEAD, at: NOW, kind: 'line_answered', by: LEAD, why: [], checklistItemId: inHand.id })?.open), FINANCE);
  });
});

describe('the list, as the chat names it', () => {
  const WORDS = ['open Papers owed', 'open the checklist', 'show the requirement sheet', 'open requests'];

  it('opens the Documents of the department a person is in', () => {
    const p = worked();
    for (const said of WORDS) {
      const onBudget = applyProjectChat(structuredClone(p), said, { place: { pane: 'workstream', department: 'finance', fn: 'finance.budget' } });
      assert.deepEqual([onBudget.navigations.at(-1)?.target, onBudget.navigations.at(-1)?.workstream, onBudget.navigations.at(-1)?.section], ['workstream', 'finance.budget', 'documents'], said);
      const onLegal = applyProjectChat(structuredClone(p), said, { place: { pane: 'department', department: 'legal' } });
      assert.deepEqual([onLegal.navigations.at(-1)?.workstream, onLegal.navigations.at(-1)?.section], ['legal.title', 'documents'], said);
    }
  });

  it('opens the department whose list has the most owed from Overview, and names no page where no list is loaded', () => {
    for (const said of WORDS) {
      const out = applyProjectChat(worked(), said);
      assert.deepEqual([out.navigations.at(-1)?.workstream, out.navigations.at(-1)?.section], ['construction.progress', 'documents'], said);
      const bare = applyProjectChat(project(), said);
      assert.deepEqual(bare.navigations, [], said);
      assert.match(bare.assistantTurn.text, /Nothing moved\.$/, said);
    }
  });

  it('names no page for somebody working from a grant, whose copy holds no list', () => {
    const copy: DdProject = { ...worked(), checklist: undefined, requests: [] };
    const out = applyProjectChat(copy, 'open Papers owed', { outside: true });
    assert.deepEqual(out.navigations, []);
  });
});

describe('the four lines Overview opens with', () => {
  it('says what needs a person, what is slipping and what is owed, each part opening the page that holds it', () => {
    const p = worked();
    addAction(p, { title: 'Decide who bears the crane hire', kind: 'clarification', owner: LEAD, priority: 'high', dueDate: '2026-10-01' }, LEAD);
    addMilestones(p, [{ name: 'Foundation', weight: 10, plannedFinish: '2026-09-20' }, { name: 'Finishes', weight: 10, plannedFinish: '2027-06-30' }], LEAD);
    const lines = projectBrief(p, new Date(NOW));
    assert.deepEqual(lines.map((line) => line.key), ['needs', 'slipping', 'owed']);
    const [needs, slipping, owed] = lines;
    // The reply waits on a line of Engineering's list, so that is where the part opens: Confirm is one step away.
    assert.deepEqual(needs!.parts.map((part) => [part.text, at(part.open)]), [['1 reply to confirm', ENGINEERING], ['1 action overdue', '/projects/prj_1/risks']]);
    assert.deepEqual(slipping!.parts.map((part) => [part.text, part.tone]), [['1 late', 'critical']]);
    assert.equal(at(slipping!.parts[0]!.open), '/projects/prj_1/w/construction.progress?part=progress');
    assert.equal(owed!.label, PAPERS_OWED);
    // Owed is what somebody was asked for. The four lines of the list asked of nobody are not counted, and no party is named for them.
    assert.deepEqual(owed!.parts.map((part) => [part.text, at(part.open)]), [
      ['3 owed', ENGINEERING],
      ['1 overdue', ENGINEERING],
      ['Hill Builders 2', ENGINEERING],
      ['Lift vendor 1', ENGINEERING],
    ]);
    assert.ok(!owed!.parts.some((part) => /not asked|Nobody named/.test(part.text)));
    // The line's own arrow goes to the department holding the most owed.
    assert.equal(at(owed!.open), ENGINEERING);
  });

  it('calls no paper owed that nobody has been asked for', () => {
    const p = project();
    addChecklistItems(p, 'construction', [{ title: 'Soil report' }, { title: 'Structural drawings' }, { title: 'Pour register' }], LEAD);
    const owed = projectBrief(p, new Date(NOW)).find((line) => line.key === 'owed')!;
    assert.deepEqual(owed.parts, []);
    assert.equal(owed.quiet, 'Nothing owed. 3 papers on the list, not asked for yet.');
  });

  it('names where each reply waits when they wait in more than one place', () => {
    const p = worked();
    const byHand = p.requests!.find((request) => request.title === 'Crane hire quote')!;
    recordDispatch(p, byHand.id, { channel: 'email', to: 'hire@hill.example', at: '2026-10-02T05:00:00.000Z', by: LEAD, reference: 'CCCCC-dddddd', expiresAt: '2026-12-01T00:00:00.000Z' });
    recordReply(p, byHand.id, { channel: 'email', from: 'hire@hill.example', receivedAt: '2026-10-11T05:00:00.000Z', deliveryId: 'd-2', text: 'Quote attached.', attachments: [] });
    const needs = projectBrief(p, new Date(NOW))[0]!;
    assert.deepEqual(needs.parts.map((part) => [part.text, at(part.open)]), [
      ['1 reply to confirm in Engineering', ENGINEERING],
      ['1 reply to confirm on Requests', '/requests'],
    ]);
  });

  it('says one plain line for each where there is nothing to act on', () => {
    const lines = projectBrief(project(), new Date(NOW));
    assert.deepEqual(lines.map((line) => [line.key, line.parts.length, line.quiet]), [
      ['needs', 0, 'Nothing waits for you.'],
      ['slipping', 0, 'No schedule yet. Bring it in on Progress.'],
      ['owed', 0, 'Nothing asked for yet. Load the list of papers on a department’s Documents.'],
    ]);
    // With nothing owed the line still opens a department's Documents, where a list is loaded.
    assert.match(at(lines[2]!.open), /^\/projects\/prj_1\/w\/[a-z.]+\?part=documents$/);
  });

  it('leaves the firm’s papers owed and its replies out for somebody working from a grant', () => {
    const lines = projectBrief(worked(), new Date(NOW), { outside: true });
    assert.deepEqual(lines.map((line) => line.key), ['needs', 'slipping']);
    assert.ok(!JSON.stringify(lines).includes('Hill Builders'));
    assert.ok(!lines.some((line) => line.parts.some((part) => /part=documents|^\/requests/.test(at(part.open)))));
  });

  it('has no cost line until a Cost Report is issued, and none at all for a copy handed no cost', () => {
    const p = worked();
    assert.ok(!projectBrief(p, new Date(NOW)).some((line) => line.key === 'cost'));
    addEvidence(p, { title: 'Soil report', kind: 'document', status: 'received' }, LEAD);
    assert.ok(!projectBrief({ ...p, cost: undefined, costReports: undefined }, new Date(NOW)).some((line) => line.key === 'cost'));
  });
});
