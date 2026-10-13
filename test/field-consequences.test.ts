/**
 * What one department records, followed into the others.
 *
 * One invented project, "Tank Bund Residences", is built once for each
 * case. What is asserted is what a person reads: the schedule and the
 * Progress sheet after an extension of time is granted, the Cost Report and
 * Budget after a variation is approved, which units a court's order
 * restrains, the heirs under an owner who has died, and the figures RERA is
 * told each quarter.
 *
 * A value that only waits (offered by a paper or a model, accepted by
 * nobody) must change none of them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptVariationOffer,
  addContract,
  addFieldRecord,
  addMilestones,
  addWorkPackages,
  costReportOf,
  costReportTotals,
  createProject,
  declineVariationOffer,
  ensureWorkstreamChecks,
  fieldCatalog,
  papersOwed,
  papersOwedSaid,
  importSchedule,
  milestoneExtensions,
  progressSummary,
  projectBrief,
  proposeFieldValues,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  scheduleWatch,
  setFieldValues,
  startCostReport,
  uncoveredDays,
  updateCostReportRow,
  variationOffersWaiting,
  workstreamChecks,
  type DdProject,
} from '@realytica/shared';

const NOW = new Date('2026-10-12T00:00:00Z');
const LEAD = 'lead@example.com';

function sheet(p: DdProject, set: string, record?: string) {
  const reading = readSheet(p, set, record, undefined, undefined, NOW)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    text: (key: string) => view(key).text,
    shown: () => reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    says: () => reading.insights.map((i) => i.text),
  };
}

function record(p: DdProject, set: string, values: Record<string, unknown>): string {
  const out = addFieldRecord(p, set, values, LEAD);
  assert.deepEqual(out.rejected, [], `${set} took the record`);
  return out.record!.id;
}

function write(p: DdProject, set: string, values: Record<string, unknown>, recordId?: string): void {
  const out = setFieldValues(p, { set, ...(recordId ? { record: recordId } : {}) }, values, LEAD);
  assert.deepEqual(out.rejected, [], `${set} took the values`);
}

function onCheck(p: DdProject, fn: string, definitionId: string, values: Record<string, unknown>): void {
  ensureWorkstreamChecks(p, [fn], LEAD);
  const check = workstreamChecks(p, fn).find((held) => held.definitionId === definitionId)!;
  recordCheckFields(p, check.id, values as never, LEAD);
}

const needs = (p: DdProject, fn: string) => readFunctionFields(p, fn, NOW);
const lines = (p: DdProject, fn: string) => needs(p, fn).exceptions.map((line) => line.text);

/** The project under construction: two milestones, a civil contract measured against the first, and its package on a draft Cost Report. */
function building() {
  const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-CQ', LEAD);
  p.jurisdiction = 'Karnataka';
  p.stakeholders.push({ id: 'stk_builder', name: 'Northgate Builders', role: 'Contractor' }, { id: 'stk_bank', name: 'Meridian Bank', role: 'Lender' });
  const [frame, finishes] = addMilestones(p, [{ name: 'Frame', weight: 60, plannedFinish: '2026-12-15' }, { name: 'Finishes', weight: 40, plannedFinish: '2027-05-31' }], LEAD);
  const [civil, electrical] = addWorkPackages(p, [{ code: 'B2', name: 'Civil and structure', budget: 190_000_000, milestoneId: frame!.id }, { code: 'E1', name: 'Electrical', budget: 30_000_000 }], LEAD);
  addContract(p, { contractor: 'Northgate Builders', title: 'Civil and structure', workPackageIds: [civil!.id], value: 184_000_000, retentionPercent: 5 }, LEAD);
  const contract = record(p, 'shared.contracts', { title: 'Civil and structure', counterparty: 'stk_builder', package: civil!.id, signed_on: '2026-03-02', start_on: '2026-03-10', completion_on: '2027-06-30', defects_months: 12 });
  const report = startCostReport(p, { month: '2026-10-01' }, LEAD);
  const row = costReportOf(p, report.id).rows.find((held) => held.workPackageId === civil!.id)!;
  updateCostReportRow(p, report.id, row.id, { poIssued: 184_000_000, amountPaid: 61_000_000, anticipatedCost: 187_000_000 }, LEAD);
  return { p, frame: frame!, finishes: finishes!, civil: civil!, electrical: electrical!, contract, report, row };
}

describe('an extension of time that is granted moves the programme', () => {
  it('leaves the schedule alone until days are granted, and while they are only offered', () => {
    const { p, contract } = building();
    assert.equal(scheduleWatch(p, NOW).plannedCompletion, '2027-05-31');
    const claim = record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 45 });
    assert.equal(scheduleWatch(p, NOW).plannedCompletion, '2027-05-31', 'days claimed are not days granted');

    const offered = proposeFieldValues(p, [{ address: { fn: 'procurement.orders', set: 'procurement.orders.time_claims', record: claim, field: 'days_granted' }, value: 45, origin: { kind: 'external', source: 'Determination letter', asOf: '2026-10-05' } }], 'model');
    assert.deepEqual(offered.map((o) => o.outcome), ['waiting'], 'the offer was taken as an offer');
    assert.equal(milestoneExtensions(p).days.size, 0, 'a figure nobody accepted moves nothing');
    assert.equal(scheduleWatch(p, NOW).plannedCompletion, '2027-05-31');
    assert.equal(sheet(p, 'construction.progress.programme').value('completion_standing'), 'On programme');
  });

  it('moves the milestone its contract is measured against and the work that follows, on the schedule, on Progress and on Overview', () => {
    const { p, contract, frame, finishes } = building();
    record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 45, days_granted: 45, decided_on: '2026-10-05' });

    const watch = scheduleWatch(p, NOW);
    assert.deepEqual(
      watch.milestones.map((m) => [m.name, m.plannedFinish, m.extensionDays]),
      [['Frame', '2027-01-29', 45], ['Finishes', '2027-07-15', 45]],
    );
    assert.equal(watch.plannedCompletion, '2027-07-15');
    assert.equal(watch.completionBeforeExtensions, '2027-05-31');
    assert.equal(watch.extensionDays, 45);
    assert.match(watch.say!, /Planned completion 2027-07-15\. Extensions of time granted moved it 45 days from 2027-05-31\./);
    assert.equal(frame.plannedFinish, '2026-12-15', 'what the schedule itself holds is not rewritten');
    assert.equal(finishes.plannedFinish, '2027-05-31');

    const programme = sheet(p, 'construction.progress.programme');
    assert.equal(programme.value('planned_completion'), '2027-07-15');
    assert.equal(programme.value('extension_days'), 45);
    assert.equal(programme.value('completion_before_extensions'), '2027-05-31');
    assert.equal(programme.value('completion_standing'), 'On the extended programme', 'no longer "On programme" against the old date');
    assert.ok(programme.shown().includes('extension_days'));

    assert.equal(sheet(p, 'shared.contracts', contract).value('revised_completion'), '2027-08-14', 'the contract’s own date moves by the same days');

    const overview = projectBrief(p, NOW).map((line) => JSON.stringify(line)).join('\n');
    assert.match(overview, /2027|15 Jul/);
    assert.doesNotMatch(overview, /31 May 2027\b(?!.*moved)/, 'Overview does not give the old date as planned completion');
  });

  it('holds a milestone late against the moved date, not the old one', () => {
    const { p, contract } = building();
    const afterOld = new Date('2026-12-20T00:00:00Z');
    assert.deepEqual(progressSummary(p, afterOld).late.map((m) => m.name), ['Frame']);
    record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 45, days_granted: 45, decided_on: '2026-10-05' });
    assert.deepEqual(progressSummary(p, afterOld).late, [], 'inside the extended date it is not late');
    assert.deepEqual(progressSummary(p, new Date('2027-02-02T00:00:00Z')).late.map((m) => [m.name, m.plannedFinish]), [['Frame', '2027-01-29']]);
  });

  it('does not move a milestone that is complete, and says where granted days move nothing', () => {
    const { p, contract, frame, electrical } = building();
    frame.percent = 100;
    record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 30, days_granted: 30 });
    assert.deepEqual(scheduleWatch(p, NOW).milestones.map((m) => m.plannedFinish), ['2026-12-15', '2027-06-30']);

    // A second contract whose package is measured against no milestone.
    const other = record(p, 'shared.contracts', { title: 'Electrical', counterparty: 'stk_builder', package: electrical.id, completion_on: '2027-04-30' });
    record(p, 'procurement.orders.time_claims', { claim_no: 'TC-02', contract: other, days_claimed: 20, days_granted: 20 });
    assert.equal(scheduleWatch(p, NOW).extensionUnplaced, 20);
    const programme = sheet(p, 'construction.progress.programme');
    assert.equal(programme.value('extension_unplaced'), 20);
    assert.ok(programme.says().some((say) => /20 days of extension are granted on a contract whose package is measured against no milestone/.test(say)), programme.says().join(' | '));
  });

  it('carries the moved date to the lender, to RERA and to the landowner’s delivery date', () => {
    const { p, contract } = building();
    onCheck(p, 'construction.progress', 'schedule_progress.forecast_completion', { forecast_completion: '2027-05-31', contractual_completion: '2027-06-30' });
    write(p, 'legal.rera.registration', { registration_no: 'PRM/KA/RERA/1251/000/PR/000000/000001', declared_completion: '2027-06-30' });
    const programme = () => sheet(p, 'construction.progress.programme');
    assert.equal(programme().value('completion_now'), '2027-05-31');
    assert.equal(programme().says().filter((say) => /declared to RERA/.test(say)).length, 0);

    record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 45, days_granted: 45, decided_on: '2026-10-05' });
    assert.equal(programme().value('completion_now'), '2027-07-15', 'the later of the forecast and planned completion after extensions');
    assert.equal(programme().value('contractual_after_extensions'), '2027-08-14');
    assert.ok(programme().says().some((say) => /Completion is forecast for .*2027-07-15|15 Jul 2027/.test(say) && /declared to RERA/.test(say)), programme().says().join(' | '));
    assert.equal(sheet(p, 'finance.lenders.limits').value('completion_forecast'), '2027-07-15', 'the lender’s sheet reads the same date');
  });
});

describe('a milestone brought in complete', () => {
  it('takes its done date from the schedule, not the day of the import', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ2', LEAD);
    importSchedule(p, [{ name: 'Excavation', plannedFinish: '2026-06-20', percent: 100 }, { name: 'Plinth', plannedFinish: '2026-11-30', percent: 100 }, { name: 'Frame', plannedFinish: '2027-03-31', percent: 40 }], LEAD, '2026-10-13T04:00:00.000Z');
    assert.deepEqual(
      p.milestones!.map((m) => [m.name, m.completedOn]),
      [['Excavation', '2026-06-20'], ['Plinth', '2026-10-13'], ['Frame', undefined]],
      'a finish already past is the done date; one still ahead cannot be, so the day it was brought in stands',
    );
    // Brought in again complete, a milestone already on the project.
    importSchedule(p, [{ name: 'Frame', plannedFinish: '2026-10-01', percent: 100 }], LEAD, '2026-10-20T04:00:00.000Z');
    assert.equal(p.milestones![2]!.completedOn, '2026-10-01');
  });
});

describe('an approved variation is offered to Finance, and moves the Cost Report only when taken', () => {
  it('offers nothing while the variation is claimed, or approved only by a paper nobody accepted', () => {
    const { p, contract } = building();
    const claimed = record(p, 'procurement.orders.variations', { ref: 'VO-07', contract, kind: 'extra item', claimed: 1_200_000, assessed: 1_130_000, stage: 'claimed' });
    assert.deepEqual(variationOffersWaiting(p), []);
    proposeFieldValues(p, [{ address: { fn: 'procurement.orders', set: 'procurement.orders.variations', record: claimed, field: 'stage' }, value: 'approved', origin: { kind: 'external', source: 'Variation order', asOf: '2026-08-01' } }], 'model');
    assert.deepEqual(variationOffersWaiting(p), [], 'an approval nobody accepted is not an approval');
  });

  it('shows on Budget that an approved variation waits, and writes nothing on the Cost Report', () => {
    const { p, contract, report, row, civil } = building();
    record(p, 'procurement.orders.variations', { ref: 'VO-07', contract, kind: 'extra item', claimed: 1_200_000, assessed: 1_130_000, stage: 'approved', approved_on: '2026-08-01' });
    const [offer] = variationOffersWaiting(p);
    assert.deepEqual(
      { ref: offer!.ref, pack: offer!.packageName, amount: offer!.amount, onto: offer!.onto },
      { ref: 'VO-07', pack: 'B2 Civil and structure', amount: 1_130_000, onto: { reportId: report.id, label: 'October 2026', rowId: row.id, poIssued: 184_000_000, anticipatedCost: 187_000_000 } },
    );
    assert.equal(costReportOf(p, report.id).rows.find((held) => held.workPackageId === civil.id)!.poIssued, 184_000_000, 'nothing is written until Finance accepts');

    const commitments = sheet(p, 'finance.budget.commitments');
    assert.equal(commitments.value('variations_waiting'), 1);
    assert.equal(commitments.value('commitment_standing'), 'An approved variation is not on the Cost Report', 'not "Within the budget" beside an approved variation');
    assert.ok(lines(p, 'finance.budget').some((say) => /₹11.3 lakh of approved variations wait for Finance to take onto the Cost Report/.test(say)), lines(p, 'finance.budget').join(' | '));
  });

  it('moves PO issued and the anticipated cost when Finance takes it, once, and clears the line on Budget', () => {
    const { p, contract, report, civil } = building();
    const variation = record(p, 'procurement.orders.variations', { ref: 'VO-07', contract, kind: 'extra item', claimed: 1_200_000, assessed: 1_130_000, stage: 'approved', approved_on: '2026-08-01' });
    const before = costReportTotals(costReportOf(p, report.id));
    const decision = acceptVariationOffer(p, variation, 'finance.lead@example.com');
    assert.deepEqual({ status: decision.status, amount: decision.amount, by: decision.decidedBy, reportId: decision.reportId }, { status: 'accepted', amount: 1_130_000, by: 'finance.lead@example.com', reportId: report.id });

    const held = costReportOf(p, report.id);
    const row = held.rows.find((r) => r.workPackageId === civil.id)!;
    assert.deepEqual([row.poIssued, row.anticipatedCost], [185_130_000, 188_130_000]);
    assert.equal(costReportTotals(held).poIssued - before.poIssued, 1_130_000);
    assert.deepEqual(held.variations!.map((v) => [v.description, v.amount, v.workPackageId, v.dated]), [['VO-07, approved variation', 1_130_000, civil.id, '2026-08-01']]);

    assert.deepEqual(variationOffersWaiting(p), [], 'taken once');
    assert.throws(() => acceptVariationOffer(p, variation, LEAD), /No approved variation by that id is waiting on Finance/);
    const commitments = sheet(p, 'finance.budget.commitments');
    assert.equal(commitments.value('variations_waiting'), 0);
    assert.notEqual(commitments.value('commitment_standing'), 'An approved variation is not on the Cost Report');

    // Assessed again at a higher figure: only the difference is offered.
    write(p, 'procurement.orders.variations', { assessed: 1_180_000 }, variation);
    assert.deepEqual(variationOffersWaiting(p).map((o) => [o.approved, o.taken, o.amount]), [[1_180_000, 1_130_000, 50_000]]);
  });

  it('leaves the forecast alone where Finance says it carried the variation already, and keeps a decline until the amount changes', () => {
    const { p, contract, report, civil } = building();
    const first = record(p, 'procurement.orders.variations', { ref: 'VO-07', contract, kind: 'extra item', claimed: 1_200_000, assessed: 1_130_000, stage: 'approved' });
    const second = record(p, 'procurement.orders.variations', { ref: 'VO-08', contract, kind: 'quantity deviation', claimed: 900_000, assessed: 900_000, stage: 'paid' });
    acceptVariationOffer(p, first, LEAD, { forecast: 'already_in' });
    const row = costReportOf(p, report.id).rows.find((r) => r.workPackageId === civil.id)!;
    assert.deepEqual([row.poIssued, row.anticipatedCost], [185_130_000, 187_000_000]);

    assert.throws(() => declineVariationOffer(p, second, '  ', LEAD), /Say why it is declined/);
    declineVariationOffer(p, second, 'Already inside the contract sum', LEAD);
    assert.deepEqual(variationOffersWaiting(p), []);
    assert.equal(costReportOf(p, report.id).rows.find((r) => r.workPackageId === civil.id)!.poIssued, 185_130_000, 'a decline writes nothing');
    write(p, 'procurement.orders.variations', { assessed: 950_000 }, second);
    assert.deepEqual(variationOffersWaiting(p).map((o) => [o.ref, o.amount]), [['VO-08', 950_000]]);
  });

  it('refuses to take a variation where no draft Cost Report holds the package', () => {
    const { p, electrical } = building();
    const other = record(p, 'shared.contracts', { title: 'Electrical', counterparty: 'stk_builder', package: electrical.id });
    const issued = record(p, 'procurement.orders.variations', { ref: 'VO-11', contract: other, kind: 'extra item', claimed: 400_000, assessed: 400_000, stage: 'approved' });
    p.costReports!.forEach((held) => (held.status = 'issued'));
    assert.throws(() => acceptVariationOffer(p, issued, LEAD), /No draft Cost Report holds this package/);
  });
});

describe('the days no encumbrance certificate covers', () => {
  it('merges certificates that overlap, counts only days inside the period, and is never below nought', () => {
    assert.equal(uncoveredDays({ from: 0, to: 99 }, []), 100);
    assert.equal(uncoveredDays({ from: 0, to: 99 }, [{ from: 0, to: 49 }, { from: 50, to: 99 }]), 0, 'two that meet leave no gap');
    assert.equal(uncoveredDays({ from: 0, to: 99 }, [{ from: 0, to: 60 }, { from: 40, to: 99 }, { from: 0, to: 99 }]), 0, 'three that overlap are not added together');
    assert.equal(uncoveredDays({ from: 0, to: 99 }, [{ from: -500, to: 20 }, { from: 31, to: 5000 }]), 10, 'what a certificate covers outside the period counts for nothing');
    assert.equal(uncoveredDays({ from: 0, to: 99 }, [{ from: 200, to: 300 }, { from: 30, to: 10 }]), 100);
  });

  it('reads the period off the encumbrance check and the certificates that stand', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ3', LEAD);
    p.jurisdiction = 'Karnataka';
    onCheck(p, 'legal.title', 'legal.encumbrances', { ec_from: '1994-04-01', ec_to: '2026-09-30' });
    record(p, 'legal.title.ec_certificates', { certificate_no: 'EC-1', from: '1994-04-01', to: '2004-03-31', result: 'nil' });
    record(p, 'legal.title.ec_certificates', { certificate_no: 'EC-2', from: '2004-04-01', to: '2026-08-31', result: 'nil' });
    const gap = () => sheet(p, 'legal.title.encumbrance').value('gap_days');
    assert.equal(gap(), 30, 'September 2026 is not covered');
    // The same paper read a second time as a third certificate over the whole period: the old sum went thousands of days below nought.
    const third = record(p, 'legal.title.ec_certificates', { certificate_no: 'EC-3', from: '1994-04-01', to: '2026-08-31', result: 'nil' });
    assert.equal(gap(), 30);
    write(p, 'legal.title.ec_certificates', { to: '2026-09-30' }, third);
    assert.equal(gap(), 0);
  });
});

describe('net extent says how many parcels it rests on', () => {
  it('names the parcels that add nothing to it', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ4', LEAD);
    p.jurisdiction = 'Karnataka';
    record(p, 'shared.parcels', { survey_number: '41/2', extent: '1 acre 20 guntas', kharab_a: '2 guntas', kharab_b: '1 gunta' });
    record(p, 'shared.parcels', { survey_number: '41/3', extent: '30 guntas', kharab_a: '0 guntas', kharab_b: '0 guntas' });
    record(p, 'shared.parcels', { survey_number: '42/1', extent: '20 guntas' });
    const records = sheet(p, 'legal.title.records');
    assert.equal(records.value('parcels'), 3);
    assert.equal(records.value('extent_net_parcels'), 2);
    assert.ok(records.says().includes('Net extent after kharab rests on 2 of 3 parcels: the others have no extent or no kharab recorded.'), records.says().join(' | '));
  });
});

describe('a court’s order says what it covers, and Sales says which units it holds', () => {
  function sued() {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-CQ5', LEAD);
    p.jurisdiction = 'Karnataka';
    const parcel = record(p, 'shared.parcels', { survey_number: '41/2', extent: '1 acre' });
    const units = ['A-101', 'A-102', 'A-103'].map((number) => record(p, 'shared.units', { number, tower: 'A', floor: 1 }));
    const matter = record(p, 'shared.matters', { case_number: 'O.S. 412/2026', court: 'City Civil Court', subject: 'Injunction against sale' });
    const order = record(p, 'legal.litigation.orders', { matter, order_date: '2026-09-20', kind: 'interim', effect: 'restrains_sale', in_force: true });
    return { p, parcel, units, matter, order };
  }

  it('says of an order in force that nothing is recorded as covered, on the order itself', () => {
    const { p, order } = sued();
    const line = needs(p, 'legal.litigation').exceptions.find((e) => /no parcel or unit is recorded as covered/.test(e.text));
    assert.deepEqual([line?.record, line?.need], [order, 'due_soon'], 'the line is on the order, so it opens the order');
  });

  it('marks the units an order names, and only those, and counts them on the inventory', () => {
    const { p, order, units } = sued();
    record(p, 'legal.litigation.order_cover', { order, unit: units[0] });
    record(p, 'legal.litigation.order_cover', { order, unit: units[2] });
    assert.deepEqual(units.map((unit) => sheet(p, 'shared.units', unit).value('sale_orders_in_force')), [1, 0, 1]);
    assert.ok(sheet(p, 'shared.units', units[0]).says().includes('Orders in force that restrain the sale of this unit: 1.'));
    assert.deepEqual(sheet(p, 'shared.units', units[1]).says().filter((say) => /restrain/.test(say)), []);
    assert.equal(sheet(p, 'commercial.inventory.stock').value('units_restrained'), 2);
    assert.ok(lines(p, 'commercial.inventory').some((say) => /Units covered by an order in force that restrains a sale: 2\./.test(say)), lines(p, 'commercial.inventory').join(' | '));
    assert.equal(needs(p, 'legal.litigation').exceptions.filter((e) => /no parcel or unit is recorded as covered/.test(e.text)).length, 0);

    // The order is vacated: no unit is held any more, and what it covered is still on the record.
    write(p, 'legal.litigation.orders', { in_force: false }, order);
    assert.deepEqual(units.map((unit) => sheet(p, 'shared.units', unit).value('sale_orders_in_force')), [0, 0, 0]);
    assert.equal(sheet(p, 'commercial.inventory.stock').value('units_restrained'), 0);
  });

  it('says so on the inventory where an order covers a parcel of the land', () => {
    const { p, order, parcel } = sued();
    record(p, 'legal.litigation.order_cover', { order, parcel });
    assert.equal(sheet(p, 'commercial.inventory.stock').value('land_restraints'), 1);
    assert.ok(lines(p, 'commercial.inventory').some((say) => /Orders in force that restrain a sale over a parcel of the land, and so every unit on it: 1\./.test(say)));
  });

  it('counts nothing for an order whose effect a paper offered and nobody accepted', () => {
    const { p, units, matter } = sued();
    const offered = record(p, 'legal.litigation.orders', { matter, order_date: '2026-10-01', kind: 'interim', in_force: true });
    proposeFieldValues(p, [{ address: { fn: 'legal.litigation', set: 'legal.litigation.orders', record: offered, field: 'effect' }, value: 'restrains_sale', origin: { kind: 'external', source: 'eCourts', asOf: '2026-10-02' } }], 'model');
    record(p, 'legal.litigation.order_cover', { order: offered, unit: units[1] });
    assert.equal(sheet(p, 'shared.units', units[1]).value('sale_orders_in_force'), 0);
  });
});

describe('a revision of the sanctioned plan, once sanctioned, is what every department is held to', () => {
  function revised() {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-CQ6', LEAD);
    p.jurisdiction = 'Karnataka';
    onCheck(p, 'legal.approvals', 'regulatory.sanction', { sanction_date: '2024-03-12', sanction_valid_to: '2028-03-11', sanctioned_area: 18000, sanctioned_far: 2.25 });
    const block = record(p, 'shared.buildings', { name: 'Block A', floors: 12 });
    write(p, 'shared.buildings', { sanctioned_units: 4, sanctioned_height: '36 m' }, block);
    record(p, 'design.brief.unit_types', { name: 'Type A', kind: '2bhk', count: 4, carpet_area: '80 sqm' });
    ['Ground', 'First'].forEach((level) => record(p, 'design.areas.floors', { level, built_up: '9000 sqm' }));
    const units = ['A-101', 'A-102', 'A-103', 'A-104', 'A-105'].map((number) => record(p, 'shared.units', { number, tower: 'A', floor: 1, carpet_area: '80 sqm' }));
    const revision = record(p, 'legal.approvals.revisions', { revision_no: 'Revision 2', reason: 'more_units', applied_on: '2026-06-18', standing: 'applied', allottees_at_application: 3, consents_held: 3, built_up_area_after: '19500 sqm', units_after: 6, height_after: '42 m' });
    return { p, units, revision };
  }
  const sanction = (p: DdProject) => sheet(p, 'legal.approvals.sanction');

  it('changes nothing while the revision is only applied for, or sanctioned only by a paper nobody accepted', () => {
    const { p, revision } = revised();
    assert.deepEqual([sanction(p).value('built_up_in_force'), sanction(p).value('units_in_force'), sanction(p).value('revised_on')], [18000, 4, null]);
    proposeFieldValues(p, [{ address: { fn: 'legal.approvals', set: 'legal.approvals.revisions', record: revision, field: 'standing' }, value: 'sanctioned', origin: { kind: 'external', source: 'Modified sanction', asOf: '2026-09-30' } }], 'model');
    assert.deepEqual([sanction(p).value('built_up_in_force'), sanction(p).value('units_in_force')], [18000, 4]);
    assert.equal(sheet(p, 'design.areas.statement').value('sanctioned_area'), 18000);
    assert.equal(sheet(p, 'design.areas.statement').value('area_standing'), 'Within the sanctioned area');
  });

  it('moves the sanction in force, the limit on the area statement, Sales’ unit count and what RERA is told', () => {
    const { p, revision } = revised();
    write(p, 'legal.approvals.revisions', { standing: 'sanctioned', sanctioned_on: '2026-09-30' }, revision);
    assert.deepEqual([sanction(p).value('built_up_in_force'), sanction(p).value('units_in_force'), sanction(p).value('height_in_force'), sanction(p).value('revised_on')], [19500, 6, 42, '2026-09-30']);

    // The Architect: the limit is the revised one, and the statement is said not to have followed the revision yet.
    const statement = sheet(p, 'design.areas.statement');
    assert.equal(statement.value('sanctioned_area'), 19500);
    assert.deepEqual([statement.value('units_designed'), statement.value('units_sanctioned')], [4, 6]);
    assert.ok(statement.says().some((say) => /The floors add to 18,000 sqm and the sanction, as last revised, gives 19,500 sqm: the area statement has not followed the revision\./.test(say)), statement.says().join(' | '));
    assert.ok(statement.says().includes('The unit mix comes to 4 units and the sanction, as last revised, allows 6.'), statement.says().join(' | '));

    // Sales: five units on the register were one too many under the first sanction and are inside the revised one.
    assert.deepEqual(lines(p, 'commercial.inventory').filter((say) => /sanction, as last revised/.test(say)), []);
    record(p, 'shared.units', { number: 'A-106', tower: 'A', floor: 1 });
    record(p, 'shared.units', { number: 'A-107', tower: 'A', floor: 1 });
    assert.ok(lines(p, 'commercial.inventory').includes('The register holds 7 units and the sanction, as last revised, allows 6.'), lines(p, 'commercial.inventory').join(' | '));

    // RERA: the areas and counts the application states are read, never typed, and follow the revision.
    const registration = sheet(p, 'legal.rera.registration');
    assert.deepEqual(
      [registration.value('built_up_sanctioned'), registration.value('units_sanctioned'), registration.value('units_on_register'), registration.value('carpet_area_on_register'), registration.value('carpet_area_designed')],
      [19500, 6, 7, 400, 320],
    );
    for (const key of ['land_clear_extent', 'built_up_sanctioned', 'units_sanctioned', 'carpet_area_designed', 'units_on_register', 'carpet_area_on_register']) {
      const def = registration.view(key).def;
      assert.ok(def.sameAs || def.kind === 'computed', `${key} is read from its owner`);
    }
    assert.ok(registration.says().includes('The register holds 7 units and the sanction, as last revised, allows 6.'));
  });

  it('opens what a revision changes as a sheet of the revision, each figure beside the one before', () => {
    const { p, revision } = revised();
    const reading = sheet(p, 'legal.approvals.revisions', revision);
    assert.deepEqual(reading.reading.depth.map((depth) => [depth.sheet.id, depth.shown]), [['what_changes', true]]);
    assert.deepEqual([reading.value('built_up_before'), reading.value('built_up_area_after'), reading.value('units_before'), reading.value('units_after'), reading.value('units_added')], [18000, 19500, 4, 6, 2]);
    assert.equal(reading.view('built_up_area_after').def.sheet, 'what_changes');
  });

  it('brings the environment clearance into play when a revision past the size is sanctioned', () => {
    const { p, revision } = revised();
    const environment = () => sheet(p, 'legal.approvals.environment').value('clearance_applies');
    assert.equal(environment(), 'Not needed at this size');
    write(p, 'legal.approvals.revisions', { standing: 'sanctioned', sanctioned_on: '2026-09-30', built_up_area_after: '20450 sqm' }, revision);
    assert.equal(environment(), 'Needed, as a building project');
  });

  it('counts the quarter’s figures from the units, the milestones and the bills, not from a typed box', () => {
    const { p } = revised();
    const compliance = sheet(p, 'legal.rera.compliance');
    for (const key of ['units_total', 'units_booked', 'cost_incurred', 'construction_complete']) {
      const owner = compliance.view(key).def.sameAs!;
      assert.ok(!/^(commercial_market|cost_quantity|schedule_progress)\./.test(owner.set), `${key} is no longer read from a typed check (${owner.set})`);
    }
    assert.equal(compliance.value('units_total'), 5);
  });
});

describe('a hard case opens as a small sheet from the row that has it', () => {
  it('declares one for each of the cases the catalog was short of, inside the limits', () => {
    const declared = [...fieldCatalog().sets.values()].flatMap((set) => (set.sheets ?? []).map((depth) => `${set.id}/${depth.id}`));
    for (const wanted of [
      'legal.title.owners/guardianship',
      'legal.title.owners/succession',
      'legal.title.instruments/attorney',
      'legal.title.instruments/partition',
      'legal.litigation.register/partition_suit',
      'legal.litigation.orders/final_order',
      'legal.approvals.revisions/what_changes',
      'procurement.orders.variations/time_claim',
      'procurement.orders.time_claims/cost_of_delay',
      'procurement.vendors.securities/invocation',
      'design.changes.register/buyers',
      'design.changes.register/modified_sanction',
      'commercial.buyers.cancellations/after_agreement',
    ]) assert.ok(declared.includes(wanted), `${wanted} is declared`);
    for (const set of fieldCatalog().sets.values()) {
      for (const depth of set.sheets ?? []) {
        assert.ok(depth.fields.length <= 20, `${set.id}/${depth.id} has at most twenty fields`);
        assert.ok((depth.sections ?? []).length <= 4, `${set.id}/${depth.id} has at most four sections`);
      }
    }
  });

  it('opens the cost of a delay from the claim that makes one, and says where its heads do not add up', () => {
    const { p, contract } = building();
    const plain = record(p, 'procurement.orders.time_claims', { claim_no: 'TC-01', contract, days_claimed: 10, with_cost: false });
    assert.deepEqual(sheet(p, 'procurement.orders.time_claims', plain).reading.depth.map((depth) => depth.shown), [false]);
    const costed = record(p, 'procurement.orders.time_claims', { claim_no: 'TC-02', contract, days_claimed: 45, with_cost: true, cost_claimed: 2_400_000, site_overheads: 1_200_000, idle_plant: 600_000, finance_cost: 300_000 });
    const reading = sheet(p, 'procurement.orders.time_claims', costed);
    assert.deepEqual(reading.reading.depth.map((depth) => [depth.sheet.id, depth.shown]), [['cost_of_delay', true]]);
    assert.equal(reading.value('heads_total'), 2_100_000);
    const line = needs(p, 'procurement.orders').exceptions.find((e) => /The heads add to/.test(e.text))!;
    assert.deepEqual([line.record, line.depth, line.label], [costed, 'cost_of_delay', 'Cost of delay'], 'the line names the claim and the sheet to open');
    assert.match(line.text, /The heads add to ₹21 lakh and ₹24 lakh is claimed/);
  });

  it('opens an invocation from the guarantee, asks nothing until there is a demand, and fails a demand lodged after claims closed', () => {
    const { p, contract } = building();
    const guarantee = record(p, 'procurement.vendors.securities', { number: 'BG/0456/26', kind: 'performance', instrument: 'bank_guarantee', contract, bank: 'stk_bank', amount: 9_200_000, valid_to: '2027-08-31', claim_until: '2027-09-30', confirmed_with_bank_on: '2026-03-20' });
    const before = needs(p, 'procurement.vendors');
    assert.deepEqual(before.exceptions.filter((e) => e.depth === 'invocation'), [], 'nothing on the sheet is asked for');
    write(p, 'procurement.vendors.securities', { invoked_on: '2027-10-04', amount_claimed: 9_500_000, ground: 'termination' }, guarantee);
    const said = needs(p, 'procurement.vendors').exceptions.filter((e) => e.depth === 'invocation').map((e) => e.text);
    assert.ok(said.includes('The demand was lodged 4 days after the last day the guarantee allows a claim.'), said.join(' | '));
    assert.ok(said.some((say) => /is demanded under a guarantee of/.test(say)), said.join(' | '));
  });

  it('opens the partition suit from the register only while one is on file', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ7', LEAD);
    p.jurisdiction = 'Karnataka';
    assert.deepEqual(sheet(p, 'legal.litigation.register').reading.depth.map((depth) => depth.shown), [false]);
    const suit = record(p, 'shared.matters', { case_number: 'O.S. 88/2025', court: 'Civil Judge', subject: 'Partition' });
    write(p, 'shared.matters', { subject_kind: 'partition', case_state: 'pending' }, suit);
    const register = sheet(p, 'legal.litigation.register');
    assert.deepEqual(register.reading.depth.map((depth) => [depth.sheet.id, depth.shown]), [['partition_suit', true]]);
    assert.equal(register.view('share_claimed').def.sheet, 'partition_suit', 'the fields it always had are on the sheet, under the keys they always had');
    write(p, 'legal.litigation.register', { partition_matter: suit, share_claimed: 25, shares_decreed: [{ sharer: 'B. Vendor', share_pct: 25 }] });
    assert.equal(sheet(p, 'legal.litigation.register').value('share_claimed'), 25);
  });

  it('says of a design change that is built that the revision it needs is not sanctioned', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ8', LEAD);
    p.jurisdiction = 'Karnataka';
    p.stakeholders.push({ id: 'stk_arch', name: 'Studio North', role: 'Architect' });
    const revision = record(p, 'legal.approvals.revisions', { revision_no: 'Revision 2', reason: 'layout', applied_on: '2026-06-18', standing: 'applied', allottees_at_application: 0, consents_held: 0 });
    const change = record(p, 'design.changes.register', { number: 'DC-14', raised_on: '2026-06-01', raised_by: 'stk_arch', origin: 'owner', stage: 'built', cost_effect: 'no effect', needs_modified_sanction: true, alters_promise: false, approved_by: 'stk_arch', approved_on: '2026-06-10' });
    const reading = () => sheet(p, 'design.changes.register', change);
    assert.deepEqual(reading().reading.depth.map((depth) => [depth.sheet.id, depth.shown]), [['buyers', false], ['modified_sanction', true]]);
    const lineTexts = () => needs(p, 'design.changes').exceptions.filter((e) => e.depth === 'modified_sanction').map((e) => e.text);
    assert.ok(lineTexts().includes('The change needs a modified sanction and no plan revision is linked to it.'), lineTexts().join(' | '));
    write(p, 'design.changes.register', { revision }, change);
    assert.equal(reading().value('revision_applied_on'), '2026-06-18');
    assert.ok(lineTexts().includes('The change is issued or built, and the revision of the sanction it needs is not sanctioned.'), lineTexts().join(' | '));
    write(p, 'legal.approvals.revisions', { standing: 'sanctioned', sanctioned_on: '2026-09-30' }, revision);
    assert.deepEqual(lineTexts(), []);
  });

  it('asks for a registered deed of cancellation only once the agreement is registered', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ9', LEAD);
    p.jurisdiction = 'Karnataka';
    const unit = record(p, 'shared.units', { number: 'A-101', tower: 'A', floor: 1 });
    const early = record(p, 'commercial.buyers.cancellations', { unit, cancelled_by: 'allottee', requested_on: '2026-08-01', stage: 'before_agreement' });
    assert.deepEqual(sheet(p, 'commercial.buyers.cancellations', early).reading.depth.map((depth) => depth.shown), [false]);
    const late = record(p, 'commercial.buyers.cancellations', { unit, cancelled_by: 'allottee', requested_on: '2026-08-01', stage: 'after_agreement', refunded_on: '2026-09-15', buyer_has_loan: true });
    const said = needs(p, 'commercial.buyers').exceptions.filter((e) => e.depth === 'after_agreement' && e.record === late).map((e) => e.text);
    assert.ok(said.includes('The refund was paid on 15 Sep 2026 and no deed of cancellation is recorded as registered.'), said.join(' | '));
    assert.ok(said.includes('The buyer took a home loan on the unit and no release from the lender is on file.'), said.join(' | '));
  });
});

describe('a fact is kept by the department it belongs to, and read by the others', () => {
  it('holds the books’ provision to the claims Litigation marks probable and the amounts a court has ordered', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ10', LEAD);
    p.jurisdiction = 'Karnataka';
    assert.deepEqual(sheet(p, 'finance.ledgers.provisions').shown(), [], 'nothing shows until a matter is on the register');
    const suit = record(p, 'shared.matters', { case_number: 'CC 14/2026', court: 'Consumer Commission', subject: 'Refund with interest' });
    write(p, 'shared.matters', { case_state: 'pending', claim_amount: 4_500_000, likelihood: 'probable' }, suit);
    const other = record(p, 'shared.matters', { case_number: 'O.S. 9/2026', court: 'Civil Judge', subject: 'Boundary' });
    write(p, 'shared.matters', { case_state: 'pending', claim_amount: 2_000_000, likelihood: 'possible' }, other);
    const provisions = () => sheet(p, 'finance.ledgers.provisions');
    assert.deepEqual([provisions().value('probable_claims'), provisions().value('contingent_claims'), provisions().value('to_provide')], [4_500_000, 2_000_000, 4_500_000]);
    assert.equal(provisions().value('provision_standing'), 'Provision short');
    assert.ok(lines(p, 'finance.ledgers').some((say) => /The books provide ₹45 lakh less than the claims Litigation marks probable/.test(say)), lines(p, 'finance.ledgers').join(' | '));
    write(p, 'finance.ledgers.provisions', { provision_held: 4_500_000, provision_as_at: '2026-09-30' });
    assert.equal(provisions().value('provision_standing'), 'Provided for');
    for (const key of ['probable_claims', 'contingent_claims', 'ordered_unpaid']) {
      const def = provisions().view(key).def;
      assert.ok(def.sameAs || def.kind === 'computed', `${key} is read from Litigation, not typed`);
    }
  });

  it('keeps the welfare cess with Tax, worked out from a rule row nobody has verified, and tells the site what is unpaid', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-CQ11', LEAD);
    p.jurisdiction = 'Karnataka';
    write(p, 'finance.tax.welfare_cess', { cost_assessed: 180_000_000 });
    const cess = sheet(p, 'finance.tax.welfare_cess');
    assert.deepEqual([cess.value('payable'), cess.value('unpaid'), cess.value('cess_standing')], [1_800_000, 1_800_000, 'Cess unpaid']);
    assert.deepEqual(cess.view('payable').cites?.map((cite) => [cite.key, cite.verified]), [['bocw_welfare_cess_pct', false]]);
    assert.ok(sheet(p, 'construction.safety.establishment').says().includes('₹18 lakh of welfare cess is assessed and not paid.'));
    write(p, 'finance.tax.welfare_cess', { cess_paid: 1_800_000, paid_on: '2026-10-01' });
    assert.equal(sheet(p, 'finance.tax.welfare_cess').value('cess_standing'), 'Paid');
    assert.deepEqual(sheet(p, 'construction.safety.establishment').says().filter((say) => /welfare cess/.test(say)), []);
  });

  it('holds the commencement certificate to the day Construction says work began', () => {
    const { p } = building();
    write(p, 'legal.approvals.occupancy', { commencement_on: '2026-03-20' });
    write(p, 'construction.progress.programme', { started_on: '2026-03-10' });
    assert.ok(sheet(p, 'legal.approvals.occupancy').says().includes('Work began on site on 2026-03-10, before the commencement certificate of 2026-03-20.'), sheet(p, 'legal.approvals.occupancy').says().join(' | '));
    write(p, 'construction.progress.programme', { started_on: '2026-03-21' });
    assert.deepEqual(sheet(p, 'legal.approvals.occupancy').says().filter((say) => /Work began/.test(say)), []);
  });

  it('holds what a unit’s agreement states to the carpet area the Architect certifies as built', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ12', LEAD);
    p.jurisdiction = 'Karnataka';
    const unit = record(p, 'shared.units', { number: 'A-101', tower: 'A', floor: 1, carpet_area: '80 sqm' });
    write(p, 'shared.units', { sale_released: true, sale_allotted_on: '2026-05-02', sale_carpet_in_agreement: '80 sqm', carpet_area_as_built: '77.5 sqm' }, unit);
    const said = sheet(p, 'shared.units', unit).says();
    assert.ok(said.some((say) => /The agreement states 80 sqm of carpet area and the unit measures 77.5 sqm as built/.test(say)), said.join(' | '));
    assert.ok(said.some((say) => /This unit measures 77.5 sqm of carpet area as built and the register holds 80 sqm/.test(say)), said.join(' | '));
  });
});

describe('papers owed start from what the project asked for and what its fields name as owed', () => {
  it('counts nothing on a project whose checks expect documents nobody has asked for', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-CQ13', LEAD);
    p.jurisdiction = 'Karnataka';
    ensureWorkstreamChecks(p, ['legal.title', 'legal.approvals', 'construction.quality'], LEAD);
    const view = papersOwed(p, { now: NOW.toISOString() });
    assert.ok(view.expected.length > 20, 'the checks would expect many documents');
    assert.deepEqual([view.total, view.owed, view.notAsked, view.parties.length], [0, 0, 0, 0]);
    assert.equal(papersOwedSaid(view), 'Nothing asked for yet');
  });

  it('lists a paper a field says another party owes once it is due, under that party', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-CQ14', LEAD);
    p.jurisdiction = 'Karnataka';
    write(p, 'legal.title.holding', { tenure: 'freehold' });
    const view = papersOwed(p, { now: NOW.toISOString() });
    const advocate = view.parties.find((party) => party.lines.some((line) => line.title === 'Title opinion'));
    assert.ok(advocate, 'the title opinion the advocate owes is on the list');
    assert.deepEqual(advocate!.lines.filter((line) => line.title === 'Title opinion').map((line) => [line.from, line.standing]), [['fields', 'not_asked']]);
    assert.equal(view.owed, view.parties.reduce((n, party) => n + party.lines.length, 0));
    assert.ok(view.parties.every((party) => party.lines.every((line) => line.from !== 'checks' || line.standing !== 'not_asked')));
  });
});
