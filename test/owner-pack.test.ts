/**
 * The owner pack: one paper for the owner, for a period, made by code from
 * the record.
 *
 * A test for each section with something in it and with nothing, for where a
 * period begins and ends, and for the rule that only what a named person has
 * accepted is in it: a Cost Report that is still a draft, and a line of a
 * meeting's notes still waiting on its card, are not.
 *
 * Every project, party, paper, person and figure here is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OWNER_PACK_PAPERS_SHOWN,
  addBill,
  addChecklistItems,
  addContract,
  addCostReportVariation,
  addDecision,
  addMilestones,
  addRequest,
  addWorkPackages,
  certifyBill,
  certifyLine,
  commitChatProposal,
  costReportOf,
  createProject,
  ensureWorkstreamChecks,
  issueCostReport,
  keepMeeting,
  ownerPack,
  ownerPackCostReport,
  ownerPackPeriod,
  ownerPackTitle,
  patchRecordStatus,
  raiseChecklistRequests,
  readMeetingNotes,
  requirementSheet,
  setCostReportChangeReason,
  setMilestonePercent,
  startCostReport,
  updateCostReportRow,
  type DdProject,
  type MeetingRecord,
  type OwnerPack,
  type OwnerPackPart,
  type OwnerPackSectionKey,
} from '@realytica/shared';

const LEAD = 'lead@example.com';
/** Monday 12 October 2026. */
const NOW = new Date('2026-10-12T10:00:00.000Z');
const SEPTEMBER = ownerPackPeriod({ month: '2026-09' });

function project(): DdProject {
  return createProject({ name: 'Lakeshore Block C', type: 'residential', location: 'Lakeshore Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-OP1', LEAD);
}

const partsOf = (pack: OwnerPack, key: OwnerPackSectionKey): OwnerPackPart[] => pack.sections.find((section) => section.key === key)!.parts;
const partOf = (pack: OwnerPack, key: OwnerPackSectionKey, heading?: string): OwnerPackPart => {
  const found = partsOf(pack, key).find((part) => (heading ? part.heading?.startsWith(heading) : true));
  assert.ok(found, `no part “${heading}” in ${key}`);
  return found;
};
const said = (part: OwnerPackPart): string[] => part.lines.map((line) => line.what);

/** A milestone with its dates and what was reported of it, day by day. */
function milestone(p: DdProject, name: string, weight: number, plannedStart: string | undefined, plannedFinish: string, readings: Array<[string, number]> = []) {
  const [made] = addMilestones(p, [{ name, weight, plannedFinish }], LEAD);
  if (plannedStart) made!.plannedStart = plannedStart;
  for (const [on, percent] of readings) setMilestonePercent(p, made!.id, percent, 'site@example.com', `${on}T09:00:00.000Z`, on);
  return made!;
}

/** Three packages; August issued on budget; September issued with a variation, an award, a typed reason and two bills. */
function costed(): { p: DdProject; august: string; september: string } {
  const p = project();
  addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }, { code: 'B', name: 'Facade', budget: 500 }, { code: 'C', name: 'Lifts', budget: 200 }], LEAD);
  const set = (reportId: string, name: string, patch: Parameters<typeof updateCostReportRow>[3]) => updateCostReportRow(p, reportId, costReportOf(p, reportId).rows.find((row) => row.name === name)!.id, patch, LEAD);
  const august = startCostReport(p, { month: '2026-08-01' }, LEAD);
  set(august.id, 'Structure', { poIssued: 900, amountPaid: 300 });
  issueCostReport(p, august.id, LEAD);
  const september = startCostReport(p, { month: '2026-09-01' }, LEAD);
  set(september.id, 'Structure', { amountPaid: 450, anticipatedCost: 1180 });
  set(september.id, 'Facade', { poIssued: 560, anticipatedCost: 580 });
  const structure = costReportOf(p, september.id).rows.find((row) => row.name === 'Structure')!.workPackageId;
  addCostReportVariation(p, september.id, { description: 'Rock met at the east footings', amount: 120, workPackageId: structure }, LEAD);
  setCostReportChangeReason(p, september.id, structure, 'Rock excavation, and a longer crane hire.', LEAD);
  issueCostReport(p, september.id, LEAD);
  for (const report of p.costReports!) report.issuedAt = `${report.to}T12:00:00.000Z`;

  const contract = addContract(p, { contractor: 'Northgate Builders', title: 'Civil works', workPackageIds: [structure], value: 900 }, LEAD);
  const bill = (number: string, date: string, amount: number) => addBill(p, { contractId: contract.id, number, date, lines: [{ description: 'Work done', workPackageId: structure, amount, readBy: 'person' }] }, LEAD);
  bill('RA-03', '2026-08-31', 70);
  const certified = bill('RA-04', '2026-09-01', 100);
  certifyLine(p, certified.id, certified.lines[0]!.id, { amount: 90, note: 'East wall not cast to full height' }, LEAD);
  certifyBill(p, certified.id, { signer: { email: 'qs@example.com', name: 'Anita Rao', profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-10' }, LEAD);
  bill('RA-05', '2026-09-30', 40);
  bill('RA-06', '2026-10-01', 25);
  return { p, august: august.id, september: september.id };
}

/** Keep a meeting's notes and accept the first `accept` things read from them, as a person does. */
function meet(p: DdProject, notes: string[], accept: number): MeetingRecord {
  const text = notes.join('\n');
  const { meeting, cards } = keepMeeting(p, { file: { storageKey: 'notes.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: text.length }, came: 'pasted', reading: readMeetingNotes(text) }, LEAD);
  p.chatProposals.push(...cards);
  meeting.items.slice(0, accept).forEach((item) => commitChatProposal(p, item.proposalId, LEAD));
  return meeting;
}

describe('the period an owner pack is asked for', () => {
  it('is a month by its number, or two days with both taken in', () => {
    assert.deepEqual(SEPTEMBER, { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    assert.deepEqual(ownerPackPeriod({ month: '2026-12' }), { from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' });
    assert.deepEqual(ownerPackPeriod({ from: '2026-09-14', to: '2026-09-20' }), { from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' });
    assert.deepEqual(ownerPackPeriod({ from: '2026-09-14', to: '2026-09-14' }), { from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z' });
  });

  it('is the month it is made in when none is named, or what is named is no period', () => {
    const october = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    for (const asked of [{}, { month: '2026-13' }, { month: 'September' }, { from: '2026-09-20', to: '2026-09-14' }, { from: '2026-09-14' }, { from: 'x', to: 'y' }, { month: null, from: null, to: null }]) {
      assert.deepEqual(ownerPackPeriod(asked, NOW), october, JSON.stringify(asked));
    }
  });

  it('names the pack by the project and the period', () => {
    assert.equal(ownerPackTitle(project(), SEPTEMBER), 'Owner pack — Lakeshore Block C, September 2026');
    assert.equal(ownerPack(project(), ownerPackPeriod({ from: '2026-09-14', to: '2026-09-20' }), NOW).periodSaid, '14 Sep to 20 Sep 2026');
  });
});

describe('an owner pack of a project with nothing on it', () => {
  const pack = ownerPack(project(), SEPTEMBER, NOW);

  it('has its six sections, in their order, each saying in one line that it has nothing', () => {
    assert.deepEqual(pack.sections.map((section) => [section.key, section.title]), [
      ['standing', 'Where the project stands'],
      ['time', 'Time'],
      ['cost', 'Cost'],
      ['decisions', 'Decisions needed from the owner'],
      ['meetings', 'Decided in the period, and who owes what'],
      ['papers', 'Papers owed'],
    ]);
    assert.deepEqual([pack.periodSaid, pack.asOf], ['September 2026', '2026-10-12']);
    assert.deepEqual(said(partOf(pack, 'standing')), ['Stage: Under construction.', 'No milestones are on the schedule, so there is no percent complete and no completion date.']);
    assert.deepEqual(
      (['time', 'cost', 'decisions', 'meetings', 'papers'] as const).flatMap((key) => partsOf(pack, key).map((part) => [part.heading, part.lines.length, part.empty])),
      [
        ['Late, behind or slipping', 0, 'No milestones are on the schedule.'],
        ['Due in the next 30 days', 0, 'No milestone is planned to finish in the next 30 days.'],
        [undefined, 0, 'No Cost Report has been issued for September 2026.'],
        [undefined, 0, 'Nothing on the record needs a decision from the owner.'],
        ['Decided', 0, "No meeting's notes are kept for September 2026."],
        ['Who owes what', 0, "No meeting's notes are kept for September 2026."],
        [undefined, 0, 'No checklist is loaded, and the checks on the file expect no documents.'],
      ],
    );
    // Nothing disappears: a part with no lines always has its one line to say so.
    for (const section of pack.sections) for (const part of section.parts) assert.ok(part.lines.length || part.empty, `${section.key} › ${part.heading}`);
  });
});

describe('where the project stands, and time', () => {
  function scheduled(): DdProject {
    const p = project();
    milestone(p, 'Excavation', 5, '2026-05-01', '2026-06-15', [['2026-05-20', 40], ['2026-06-12', 100]]);
    milestone(p, 'Foundation', 15, '2026-06-16', '2026-09-20', [['2026-07-15', 30], ['2026-10-05', 85]]);
    milestone(p, 'Plinth', 5, '2026-09-21', '2026-10-20', [['2026-09-28', 10], ['2026-10-08', 35]]);
    milestone(p, 'Superstructure', 30, '2026-09-01', '2027-02-28', [['2026-09-15', 4], ['2026-10-10', 14]]);
    milestone(p, 'Masonry', 12, undefined, '2026-11-11');
    milestone(p, 'Services', 10, undefined, '2026-11-12');
    milestone(p, 'Finishes', 13, '2027-03-01', '2027-06-30');
    return p;
  }

  it('gives the stage, percent complete, planned and projected completion at the current rate, and the extension of time', () => {
    const lines = partOf(ownerPack(scheduled(), SEPTEMBER, NOW), 'standing').lines;
    assert.deepEqual(
      lines.map((line) => line.what),
      [
        'Stage: Under construction.',
        '26.3% complete: 1 of 7 milestones finished, each weighted by its share of the work.',
        'Planned completion: 30 Jun 2027.',
        'Projected completion at the current rate: 30 Jun 2027, no later than the planned date.',
        'No extension of time is indicated.',
      ],
    );
    // Each figure says what it was read from, and how fresh that is.
    assert.equal(lines[0]!.source, 'the project record');
    for (const line of lines.slice(1)) assert.equal(line.source, 'the schedule: 7 milestones on the progress board, last reported 10 Oct 2026');
  });

  it('flags an extension of time, in standing and among the decisions, when the work is projected past its date', () => {
    const p = scheduled();
    p.milestones!.find((m) => m.name === 'Finishes')!.plannedFinish = '2027-04-30';
    p.milestones!.find((m) => m.name === 'Finishes')!.plannedStart = '2027-03-01';
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(said(partOf(pack, 'standing')).slice(2), [
      'Planned completion: 30 Apr 2027.',
      'Projected completion at the current rate: 2 Jun 2027, about 33 days after the planned date.',
      'An extension of time is likely: at the current rate the work finishes about 33 days late.',
    ]);
    assert.deepEqual(said(partOf(pack, 'decisions')), ['Extension of time: at the current rate the work finishes about 33 days after the planned completion of 30 Apr 2027.']);
  });

  it('says there is no projection where no unfinished milestone has a rate', () => {
    const p = project();
    milestone(p, 'Foundation', 1, undefined, '2026-12-01', [['2026-10-01', 20]]);
    assert.deepEqual(said(partOf(ownerPack(p, SEPTEMBER, NOW), 'standing')).slice(3), [
      'No completion is projected: no unfinished milestone has progress reported on two days to take a rate from.',
      'No extension of time is indicated.',
    ]);
  });

  it('lists the milestones late, behind or slipping, each with its one-line warning, the late first', () => {
    const part = partOf(ownerPack(scheduled(), SEPTEMBER, NOW), 'time', 'Late');
    assert.deepEqual(
      part.lines.map((line) => [line.what, line.when, line.overdue ?? false]),
      [
        ['Foundation: 22 days late, 85% done.', '2026-09-20', true],
        ['Plinth: Due in 8 days, 35% done, expected 72%. At the current rate it finishes about 29 days late.', '2026-10-20', false],
        ['Superstructure: At the current rate it finishes about 94 days late.', '2027-02-28', false],
      ],
    );
    assert.equal(part.lines[0]!.source, 'the milestone, last reported 5 Oct 2026');
  });

  it('lists what is due in the next thirty days, to the day, and nothing finished or already past', () => {
    const part = partOf(ownerPack(scheduled(), SEPTEMBER, NOW), 'time', 'Due in the next 30 days');
    // 11 November is thirty days from 12 October; 12 November is thirty-one.
    assert.deepEqual(said(part), ['Plinth: planned to finish 20 Oct 2026, now at 35%.', 'Masonry: planned to finish 11 Nov 2026, now at 0%.']);
    assert.deepEqual(part.lines.map((line) => line.source), ['the milestone, last reported 8 Oct 2026', 'the milestone, with no progress reported yet']);
  });

  it('says so when nothing is late and nothing is due', () => {
    const p = project();
    milestone(p, 'Finishes', 1, '2027-03-01', '2027-06-30');
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(partsOf(pack, 'time').map((part) => [part.lines.length, part.empty]), [[0, 'No milestone is late, behind or slipping.'], [0, 'No milestone is planned to finish in the next 30 days.']]);
  });
});

describe('cost in an owner pack', () => {
  it('sets the forecast against the budget now and at the last report, each with the report it is from', () => {
    const { p } = costed();
    const part = partOf(ownerPack(p, SEPTEMBER, NOW), 'cost', 'Forecast against budget');
    assert.deepEqual(
      part.lines.map((line) => [line.what, line.source]),
      [
        ['Now: forecast ₹1,960 against a budget of ₹1,700, ₹260 over.', 'Cost Report September 2026, issued 30 Sep 2026 by lead@example.com'],
        ['At the last report: forecast ₹1,700 against a budget of ₹1,700, on budget. The forecast has moved +₹260 since.', 'Cost Report August 2026, issued 31 Aug 2026 by lead@example.com'],
      ],
    );
  });

  it('gives the largest package movements with what accounts for each, its unexplained amount and the reason typed', () => {
    const { p } = costed();
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(said(partOf(pack, 'cost', 'Largest package movements')), [
      'A · Structure: +₹180, from ₹1,000 to ₹1,180. Variation “Rock met at the east footings”: +₹120. Unexplained: +₹60. Reason given: Rock excavation, and a longer crane hire.',
      'B · Facade: +₹80, from ₹500 to ₹580. Awarded at ₹560, which accounts for +₹60. Unexplained: +₹20. No reason given.',
    ]);
    assert.deepEqual(said(partOf(pack, 'cost', 'Unexplained')), ['2 packages have a change no variation or award accounts for, +₹80 in all: A · Structure +₹60, B · Facade +₹20.']);
  });

  it('gives no more than three movements, the largest first', () => {
    const { p, september } = costed();
    addWorkPackages(p, [{ code: 'D', name: 'MEP', budget: 300 }, { code: 'E', name: 'Landscape', budget: 100 }], LEAD);
    const october = startCostReport(p, { month: '2026-10-01' }, LEAD);
    const set = (name: string, anticipatedCost: number) => updateCostReportRow(p, october.id, costReportOf(p, october.id).rows.find((row) => row.name === name)!.id, { anticipatedCost }, LEAD);
    set('Structure', 1190);
    set('Facade', 480);
    set('Lifts', 250);
    issueCostReport(p, october.id, LEAD);
    const pack = ownerPack(p, ownerPackPeriod({ month: '2026-10' }), NOW);
    assert.deepEqual(said(partOf(pack, 'cost', 'Largest')).map((line) => line.split(':')[0]), ['B · Facade', 'C · Lifts', 'A · Structure']);
    assert.equal(ownerPackCostReport(p, SEPTEMBER)!.id, september);
  });

  it('gives what was claimed against what was certified on the bills dated after the last report and up to the end of this one', () => {
    const { p } = costed();
    // RA-03 is dated the last day of August's report and RA-06 the day after September's: neither is in it.
    assert.deepEqual(
      partOf(ownerPack(p, SEPTEMBER, NOW), 'cost', 'Claimed against certified').lines.map((line) => [line.what, line.source]),
      [['Running bills dated after 31 Aug 2026 and up to 30 Sep 2026: ₹140 claimed on 2 bills, ₹90 certified, ₹50 not certified; 1 bill awaits a certificate.', 'the register of running bills and their certificates']],
    );
  });

  it('says there is nothing to compare a first report with, and still gives its forecast and its bills', () => {
    const { p } = costed();
    const pack = ownerPack(p, ownerPackPeriod({ month: '2026-08' }), NOW);
    assert.deepEqual(said(partOf(pack, 'cost', 'Forecast')), ['Now: forecast ₹1,700 against a budget of ₹1,700, on budget.', 'No Cost Report was issued before August 2026, so there is no earlier forecast to set beside it.']);
    assert.deepEqual(
      ['Largest', 'Unexplained'].map((heading) => [partOf(pack, 'cost', heading).lines.length, partOf(pack, 'cost', heading).empty]),
      [[0, 'Nothing to compare with: this is the first Cost Report issued.'], [0, 'Nothing to compare with: this is the first Cost Report issued.']],
    );
    assert.deepEqual(said(partOf(pack, 'cost', 'Claimed')), ['Running bills dated up to 31 Aug 2026: ₹70 claimed on 1 bill, ₹0 certified, ₹70 not certified; 1 bill awaits a certificate.']);
  });

  it('says so in one line when nothing moved, nothing is unexplained and no bill is dated in the span', () => {
    const p = project();
    addWorkPackages(p, [{ name: 'Structure', budget: 1000 }], LEAD);
    for (const month of ['2026-08-01', '2026-09-01']) issueCostReport(p, startCostReport(p, { month }, LEAD).id, LEAD);
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(
      ['Largest', 'Unexplained', 'Claimed'].map((heading) => [partOf(pack, 'cost', heading).lines.length, partOf(pack, 'cost', heading).empty]),
      [
        [0, "No package's forecast has moved since August 2026."],
        [0, 'Nothing is unexplained: variations and awards account for every change.'],
        [0, 'No running bill is dated after 31 Aug 2026 and up to 30 Sep 2026.'],
      ],
    );
    assert.equal(said(partOf(pack, 'cost', 'Forecast'))[1], 'At the last report: forecast ₹1,000 against a budget of ₹1,000, on budget. The forecast has not moved since.');
  });

  it('reads the report whose period takes in a day of the pack’s, to the day', () => {
    const { p, august, september } = costed();
    const reads = (from: string, to: string) => ownerPackCostReport(p, ownerPackPeriod({ from, to }))?.id;
    assert.equal(reads('2026-09-30', '2026-10-31'), september, 'the last day of September is a day of the report');
    assert.equal(reads('2026-10-01', '2026-10-31'), undefined, 'the day after is not');
    assert.equal(reads('2026-07-01', '2026-08-01'), august, 'the first day of August is a day of the report');
    assert.equal(reads('2026-07-01', '2026-07-31'), undefined, 'the day before is not');
    assert.equal(reads('2026-08-15', '2026-09-15'), september, 'of two it takes in, the later');
  });

  it('says in one line that no Cost Report is issued for the period, and never gives a draft’s figures', () => {
    const { p } = costed();
    const october = startCostReport(p, { month: '2026-10-01' }, LEAD);
    updateCostReportRow(p, october.id, costReportOf(p, october.id).rows[0]!.id, { anticipatedCost: 7777 }, LEAD);
    const pack = ownerPack(p, ownerPackPeriod({ month: '2026-10' }), NOW);
    assert.deepEqual(partsOf(pack, 'cost'), [{ lines: [], empty: "No Cost Report has been issued for October 2026. The one for October 2026 is a draft, and a draft's figures are not given. The last one issued is September 2026." }]);
    assert.doesNotMatch(JSON.stringify(pack), /7,777/);
    // Nor do its packages ask the owner for anything.
    assert.deepEqual(said(partOf(pack, 'decisions')), []);
  });
});

describe('the decisions an owner pack asks for', () => {
  it('lists packages over budget, packages not awarded, and the decisions left open on the project', () => {
    const { p } = costed();
    meet(p, ['Site meeting', 'Date: 9 September 2026', 'Open: Who bears the cost of the longer crane hire.'], 1);
    addDecision(p, { title: 'Approve the upgraded lobby stone', decisionType: 'other', decisionMaker: 'The owner', rationale: 'Asked by the architect.', status: 'pending' }, LEAD);
    addDecision(p, { title: 'Proceed with piling', decisionType: 'proceed', decisionMaker: 'The owner', rationale: 'Settled.', status: 'approved' }, LEAD);
    const lines = partOf(ownerPack(p, SEPTEMBER, NOW), 'decisions').lines;
    assert.deepEqual(
      lines.map((line) => [line.what, line.who, line.source]),
      [
        ['Over budget: A · Structure, forecast ₹1,180 against a budget of ₹1,000, ₹180 over.', undefined, 'Cost Report September 2026, issued 30 Sep 2026 by lead@example.com'],
        ['Over budget: B · Facade, forecast ₹580 against a budget of ₹500, ₹80 over.', undefined, 'Cost Report September 2026, issued 30 Sep 2026 by lead@example.com'],
        ['Not awarded: C · Lifts, budget ₹200, no PO issued.', undefined, 'Cost Report September 2026, issued 30 Sep 2026 by lead@example.com'],
        ['To be decided: “Who bears the cost of the longer crane hire”.', undefined, 'the meeting of 9 Sep 2026, its notes on file'],
        ['To be decided: “Approve the upgraded lobby stone”.', 'The owner', 'the decision register'],
      ],
    );
  });
});

describe('what was decided in the period, and who owes what', () => {
  const NOTES = [
    'Site progress meeting',
    'Date: 9 September 2026',
    'Present: Kiran Shetty, Anita Rao, Dev Menon',
    'Decision: Rock at the east footings to be broken, not blasted.',
    'Action: Kiran Shetty to send the crane hire quote by 30 October 2026.',
    'Action: Anita Rao to issue the facade letter of award.',
    'Action: Dev Menon to submit the revised footing drawings by 16 September 2026.',
    'Action: Kiran Shetty to book the cube tests by 18 September 2026.',
    'Decision: Night pours are allowed until November.',
  ];

  it('gives the decisions and the open actions of the period’s meetings, with owner and date, the overdue first', () => {
    const p = project();
    const meeting = meet(p, NOTES, 5);
    // The cube tests were booked: an action that is closed is owed by nobody.
    const booked = p.actions.find((action) => /cube tests/.test(action.title))!;
    patchRecordStatus(p, p.actions, booked.id, 'closed', 'action', LEAD);
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(
      partOf(pack, 'meetings', 'Decided').lines.map((line) => [line.what, line.when, line.source]),
      [['“Rock at the east footings to be broken, not blasted” (approved).', '2026-09-09', 'the meeting of 9 Sep 2026, its notes on file']],
    );
    assert.deepEqual(
      partOf(pack, 'meetings', 'Who owes what').lines.map((line) => [line.what, line.who, line.when, line.overdue ?? false]),
      [
        ['Overdue since 16 Sep 2026: “Dev Menon to submit the revised footing drawings by 16 September 2026”.', 'Dev Menon', '2026-09-16', true],
        ['Due 30 Oct 2026: “Kiran Shetty to send the crane hire quote by 30 October 2026”.', 'Kiran Shetty', '2026-10-30', false],
        ['No date given: “Anita Rao to issue the facade letter of award”.', 'Anita Rao', undefined, false],
      ],
    );
    assert.equal(meeting.items.length, 6);
  });

  it('shows nothing that still waits on its card, and says how many do', () => {
    const p = project();
    meet(p, NOTES, 5);
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.equal(partOf(pack, 'meetings', 'Decided').note, '1 thing read from the notes waits on a card, not yet accepted, and is not shown.');
    assert.doesNotMatch(JSON.stringify(pack), /Night pours/);
    // Accepted, it is a decision of the period like the other.
    commitChatProposal(p, p.meetings![0]!.items[5]!.proposalId, LEAD);
    const after = ownerPack(p, SEPTEMBER, NOW);
    assert.equal(partOf(after, 'meetings', 'Decided').note, undefined);
    assert.equal(said(partOf(after, 'meetings', 'Decided'))[1], '“Night pours are allowed until November” (approved).');
  });

  it('takes a meeting held on the first or the last day of the period, and none held the day before or after', () => {
    const p = project();
    for (const day of ['31 August 2026', '1 September 2026', '30 September 2026', '1 October 2026']) meet(p, ['Site meeting', `Date: ${day}`, `Decision: Agreed on ${day}.`], 1);
    assert.deepEqual(said(partOf(ownerPack(p, SEPTEMBER, NOW), 'meetings', 'Decided')), ['“Agreed on 1 September 2026” (approved).', '“Agreed on 30 September 2026” (approved).']);
    assert.deepEqual(said(partOf(ownerPack(p, ownerPackPeriod({ from: '2026-10-01', to: '2026-10-01' }), NOW), 'meetings', 'Decided')), ['“Agreed on 1 October 2026” (approved).']);
  });

  it('says so when the meetings of the period decided nothing and left nothing open', () => {
    const p = project();
    meet(p, ['Site meeting', 'Date: 9 September 2026', 'Present: Kiran Shetty', 'Open: Who bears the cost of the longer crane hire.'], 1);
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(partsOf(pack, 'meetings').map((part) => [part.lines.length, part.empty]), [[0, 'No decision from the meetings of the period is on the record.'], [0, 'No action from the meetings of the period is open.']]);
  });
});

describe('the papers owed, in an owner pack', () => {
  it('groups what is missing on the checklist by who owes it, with how many, the most first', () => {
    const p = project();
    addChecklistItems(
      p,
      'construction',
      [
        { title: 'Pour cards', stage: 'Construction', package: 'Civil', owedBy: 'Northgate Builders' },
        { title: 'Cube test results', owedBy: 'Northgate Builders' },
        { title: 'Lift shop drawings', owedBy: 'Lift vendor' },
        { title: 'Temporary power sanction' },
      ],
      LEAD,
    );
    addChecklistItems(p, 'finance', [{ title: 'Bank guarantee', owedBy: 'northgate builders' }], LEAD);
    raiseChecklistRequests(p, { department: 'construction', itemIds: [p.checklist!.find((item) => item.title === 'Lift shop drawings')!.id], dueAt: '2026-10-06' }, LEAD);
    const parts = partsOf(ownerPack(p, SEPTEMBER, NOW), 'papers');
    assert.deepEqual(
      parts.map((part) => [part.heading, part.lines.map((line) => [line.what, line.source])]),
      [
        [
          'Northgate Builders · 3',
          [
            ['Pour cards (Construction · Civil): not asked.', 'the checklist of Engineering'],
            ['Cube test results: not asked.', 'the checklist of Engineering'],
            ['Bank guarantee: not asked.', 'the checklist of Finance'],
          ],
        ],
        ['Lift vendor · 1', [['Lift shop drawings: asked for, due 6 Oct 2026 (overdue).', 'the checklist of Engineering']]],
        ['Nobody named · 1', [['Temporary power sanction: not asked.', 'the checklist of Engineering']]],
      ],
    );
  });

  it('adds what the checks expect and nobody has filed, and lists a party’s first few with the rest counted', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], LEAD);
    const sheet = requirementSheet(p);
    const first = sheet.groups[0]!.items[0]!;
    addRequest(p, { title: first.title, recipient: 'The developer', dueAt: '2026-11-01', evidenceId: first.evidenceId, send: true }, LEAD);
    const parts = partsOf(ownerPack(p, SEPTEMBER, NOW), 'papers');
    assert.ok(sheet.total > OWNER_PACK_PAPERS_SHOWN + 1, 'the checks expect more papers than a party lists');
    assert.deepEqual(parts.map((part) => part.heading), ['The developer · 1', `Nobody named · ${sheet.total - 1}`]);
    assert.deepEqual(said(parts[0]!), [`${first.title}: asked for, due 1 Nov 2026.`]);
    assert.match(parts[0]!.lines[0]!.source, /^the requirement sheet, expected by the check “/);
    assert.deepEqual([parts[1]!.lines.length, parts[1]!.note], [OWNER_PACK_PAPERS_SHOWN, `And ${sheet.total - 1 - OWNER_PACK_PAPERS_SHOWN} more.`]);
  });

  it('says so when every paper is in hand', () => {
    const p = project();
    addChecklistItems(p, 'legal', [{ title: 'Sale deed', owedBy: 'The owner' }], LEAD);
    p.checklist![0]!.received = { at: '2026-09-03T00:00:00.000Z', by: LEAD };
    assert.deepEqual(partsOf(ownerPack(p, SEPTEMBER, NOW), 'papers'), [{ lines: [], empty: 'Every paper on the checklist and the requirement sheet is in hand.' }]);
  });
});

describe('an owner pack as a reading of the record', () => {
  it('is the same pack asked twice, changes nothing on the project, and gives every line its source', () => {
    const { p } = costed();
    milestone(p, 'Foundation', 1, '2026-06-16', '2026-09-20', [['2026-07-15', 30], ['2026-10-05', 85]]);
    meet(p, ['Site meeting', 'Date: 9 September 2026', 'Decision: Rock to be broken, not blasted.', 'Action: Dev Menon to submit the drawings by 16 September 2026.'], 2);
    addChecklistItems(p, 'construction', [{ title: 'Pour cards', owedBy: 'Northgate Builders' }], LEAD);
    const before = JSON.stringify(p);
    const pack = ownerPack(p, SEPTEMBER, NOW);
    assert.deepEqual(ownerPack(p, SEPTEMBER, NOW), pack);
    assert.equal(JSON.stringify(p), before);
    const lines = pack.sections.flatMap((section) => section.parts.flatMap((part) => part.lines));
    assert.ok(lines.length > 15);
    for (const line of lines) assert.ok(line.source.trim(), `“${line.what}” names nothing behind it`);
  });
});
