/**
 * A sheet kept by period, and the project read as at a day (docs/fields.md,
 * Periods and As at).
 *
 * - Issuing a period writes down every field in play, the worked-out ones
 *   among them, as it read and printed, with its footnote. What the project
 *   does next does not change it.
 * - The sheet goes on as the next period's, keeping what the set carries.
 * - An issue is corrected by a revision kept beside it.
 * - The project is read as at a past day: fields from their history,
 *   records by the day they were made and taken off, milestones from their
 *   readings, the site log and the Cost Reports issued by then. An issued
 *   period wins.
 * - A report made for a period reads as at its last day, says so, and is not
 *   moved by what is recorded after. What the record does not reach is
 *   printed as now, and says so.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AS_NOW_NO_HISTORY,
  COST_REPORT_PERIODS,
  FIELD_SETS,
  FieldRefused,
  addCostReportPackage,
  addFieldRecord,
  addMilestones,
  catalogFaults,
  compareSheetPeriods,
  costReportDue,
  createProject,
  decidesIn,
  departmentRole,
  fieldCatalog,
  generateReport,
  issueCostReport,
  issuePeriod,
  issueSheetPeriod,
  periodSeries,
  periodsDue,
  periodsOf,
  projectAsAt,
  projectView,
  readFunctionFields,
  readSheet,
  readSheetPeriod,
  removeFieldRecord,
  reopenCostReport,
  resolveFieldBlock,
  resolveFields,
  reviseSheetPeriod,
  roleCanEdit,
  setFieldValues,
  setMilestonePercent,
  setTeamMember,
  stand,
  startCostReport,
  asAtMoment,
  type CheckFieldValue,
  type DdProject,
  type FieldWriteOptions,
  type ProjectGrant,
} from '@realytica/shared';

const POSITION = 'finance.lenders.position';
const MONTH = 'construction.progress.month';
const CASH = 'finance.funding.cash';
const CASH_MONTHS = 'finance.funding.cash_months';
const REPORTS = 'finance.lenders.engineer_reports';
const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';

function project(): DdProject {
  const p = createProject({ name: 'Lakeside', type: 'residential', location: 'Whitefield', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-SNP');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { finance: 'lead', construction: 'lead', commercial: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { finance: 'contributor' } }, 'owner');
  funded(p, '2026-07-02T06:00:00.000Z');
  return p;
}

const seat = (p: DdProject, email: string): FieldWriteOptions => ({
  mayDecide: decidesIn(p, { email }),
  mayEdit: (department) => roleCanEdit(departmentRole(p, { email }, department)),
  roleIn: (department) => departmentRole(p, { email }, department),
});
const typed = (value: CheckFieldValue['value'], when: string, by = LEAD): CheckFieldValue => ({ value, at: when, by, state: 'typed', origin: { kind: 'person' } });

/**
 * A lender on the project, and money drawn: what brings the loan position into play. `made` dates the two records, for a
 * project whose past is being told.
 */
function funded(p: DdProject, made?: string): void {
  const facility = addFieldRecord(p, 'finance.lenders.facilities', { name: 'Construction loan', sanctioned_amount: 600_000_000 }, LEAD).record!;
  const drawdown = addFieldRecord(p, 'finance.lenders.drawdowns', { tranche: 'T0', facility: facility.id, disbursed_on: '2026-07-02', disbursed_amount: 380_000_000 }, LEAD).record!;
  if (!made) return;
  for (const record of [facility, drawdown]) {
    record.createdAt = made;
    for (const value of Object.values(record.values)) value.at = made;
  }
}
const at = (iso: string) => new Date(iso);

describe('the sets declared as sheets kept by period', () => {
  it('are the sheets the design lists, and each declaration can work', () => {
    const snapshots = FIELD_SETS.filter((set) => set.periodic && !set.records).map((set) => `${set.id} ${String(set.periodic!.every)}`).sort();
    assert.deepEqual(snapshots, [
      'commercial.buyers.collections month',
      'commercial.buyers.dues month',
      'commercial.inventory.bookings week',
      'commercial.inventory.enquiries week',
      'commercial.inventory.stock week',
      'commercial.marketing.spend month',
      'construction.progress.month month',
      'construction.safety.statistics month',
      'design.rfis.log month',
      'finance.funding.cash month',
      'finance.funding.receivables month',
      'finance.lenders.position month',
      'procurement.orders.position month',
    ]);
    assert.deepEqual(catalogFaults().filter((fault) => /periodic/.test(fault)), []);
  });
});

describe('issuing a sheet’s period', () => {
  function withPosition(): DdProject {
    const p = project();
    assert.deepEqual(setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000, outstanding_per_books: 410_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD)).rejected, []);
    return p;
  }

  it('freezes every field in play, the worked-out ones among them, as it read and printed, with its footnote', () => {
    const p = withPosition();
    const live = readSheet(p, POSITION)!;
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    assert.deepEqual([issued.key, issued.from, issued.to, issued.status, issued.issuedBy], ['2026-09', '2026-09-01', '2026-09-30', 'issued', LEAD]);
    const frozen = issued.frozen!;
    for (const view of live.fields.filter((held) => held.shown !== 'hidden')) assert.ok(frozen[view.def.key], `${view.def.key} is frozen`);
    assert.deepEqual([frozen.outstanding_per_statement!.value, frozen.outstanding_per_statement!.said], [410_000_000, '₹41 Cr']);
    assert.match(frozen.outstanding_per_statement!.footnote ?? '', /^Entered by A\. Rao on /, 'by the name the team gives them, never their address');
    const worked = Object.entries(frozen).filter(([, field]) => field.derived);
    assert.ok(worked.length >= 3, 'the figures nobody typed are written down too');
    assert.equal(frozen.position_standing!.derived, true);
    assert.equal(frozen.position_standing!.said, live.fields.find((view) => view.def.key === 'position_standing')!.text);
  });

  it('the issued period does not change when the sheet is edited after, and reads as it was issued', () => {
    const p = withPosition();
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 432_000_000, outstanding_per_books: 440_000_000 }, LEAD, seat(p, LEAD));
    const september = readSheetPeriod(p, POSITION, '2026-09')!;
    assert.equal(september.editable, false);
    const view = (key: string) => september.reading.fields.find((held) => held.def.key === key)!;
    assert.deepEqual([view('outstanding_per_statement').text, view('outstanding_per_books').text], ['₹41 Cr', '₹41 Cr']);
    assert.equal(view('position_standing').text, p.fieldSheets![POSITION]!.periods![0]!.frozen!.position_standing!.said, 'a standing is not worked out again from today’s figures');
    assert.equal(readSheet(p, POSITION)!.fields.find((held) => held.def.key === 'outstanding_per_statement')!.text, '₹43.2 Cr', 'the sheet itself is the open period');
    assert.equal(p.fieldSheets![POSITION]!.periods![0]!.values.outstanding_per_statement!.value, 410_000_000);
  });

  it('the sheet goes on as the next period’s: what the set carries stays, marked as carried, and the rest opens blank with its past kept', () => {
    const p = project();
    setFieldValues(p, { set: CASH }, { as_at: '2026-09-30', figures_from: 'package', opening_balance: 5_000_000 }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, CASH, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    const sheet = p.fieldSheets![CASH]!;
    assert.deepEqual(sheet.open, { key: '2026-10', openedAt: '2026-10-05T06:00:00.000Z', openedBy: LEAD, carried: { from: '2026-09', keys: ['figures_from', 'opening_balance'] } });
    assert.equal(sheet.values.opening_balance!.value, 5_000_000);
    assert.equal(sheet.values.as_at!.value, null, 'the day it is as at is the new month’s to give');
    assert.deepEqual(sheet.values.as_at!.history!.map((entry) => entry.value), ['2026-09-30'], 'and what it held is its history');
    const reading = readSheet(p, CASH)!;
    assert.equal(reading.fields.find((view) => view.def.key === 'opening_balance')!.carried, 'September');
    assert.equal(reading.fields.find((view) => view.def.key === 'as_at')!.carried, undefined);
    // Written again, a carried value is the new month's own.
    setFieldValues(p, { set: CASH }, { opening_balance: 6_000_000 }, LEAD, seat(p, LEAD));
    assert.deepEqual(p.fieldSheets![CASH]!.open!.carried!.keys, ['figures_from']);
  });

  it('is a lead’s or a signer’s, refused while a value waits, and refused twice for one period', () => {
    const p = withPosition();
    assert.throws(() => issueSheetPeriod(p, POSITION, { actor: JUNIOR }, seat(p, JUNIOR), { at: at('2026-10-05T06:00:00Z') }), /issued by a lead or a signer/);
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    assert.throws(() => issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: at('2026-10-06T06:00:00Z') }), /already issued/);
    assert.throws(() => issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-12', at: at('2026-10-06T06:00:00Z') }), /has not begun/);
    assert.throws(() => issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-W40', at: at('2026-10-06T06:00:00Z') }), /kept by the month/);
    // A project with no lender: the sheet holds nothing, typed or worked out.
    const q = createProject({ name: 'Bare', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-BARE');
    assert.throws(() => issueSheetPeriod(q, POSITION, { actor: LEAD }), /holds nothing to issue/);
    assert.throws(() => issueSheetPeriod(q, 'finance.funding.plan', { actor: LEAD }), FieldRefused);
  });

  it('is what the page says of the sheet: the one line that opens the past, what is due, and what one press issues', () => {
    const p = withPosition();
    const before = readFunctionFields(p, 'finance.lenders', at('2026-10-05T06:00:00Z')).sheets.find((held) => held.set.id === POSITION)!.periods!;
    assert.deepEqual([before.toIssue?.key, before.due, before.pastSaid], [undefined, undefined, undefined], 'nothing is due of a sheet nobody has started, and it has no earlier period to issue');
    assert.equal(before.first!.said, 'No period kept yet · Start with October 2026', 'it says so in one quiet line');
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-08', at: at('2026-09-03T06:00:00Z') });
    const page = readFunctionFields(p, 'finance.lenders', at('2026-10-05T06:00:00Z'));
    const periods = page.sheets.find((held) => held.set.id === POSITION)!.periods!;
    assert.equal(periods.pastSaid, 'August issued by A. Rao');
    assert.equal(periods.toIssue!.key, '2026-09');
    // How the lender classes the account goes on; what is outstanding is a balance as at a day, and opens blank.
    assert.deepEqual(periods.carried, { from: 'August', keys: ['account_class'] });
    const [due] = page.needs.due_soon.filter((need) => need.kind === 'due');
    assert.deepEqual([due!.label, due!.text.replace(/\d+ of \d+ fields/, 'n of m fields')], ['Loan position', 'September: n of m fields, due 7 Oct 2026']);
    assert.equal(readFunctionFields(p, 'finance.lenders', at('2026-10-09T06:00:00Z')).needs.failing.filter((need) => need.kind === 'due').length, 1, 'past its day it is failing');
    // Three months on with nothing issued: the latest is asked for, and the ones between are said to be not kept.
    const later = readFunctionFields(p, 'finance.lenders', at('2026-12-05T06:00:00Z')).sheets.find((held) => held.set.id === POSITION)!.periods!;
    assert.deepEqual([later.due!.period.key, later.notKeptSaid], ['2026-11', '2 periods not kept: October, September']);
  });
});

describe('a revision of a sheet’s period', () => {
  it('is kept beside the issue, takes writes of its own, and takes the issue’s place once issued', () => {
    const p = project();
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000, outstanding_per_books: 410_000_000 }, LEAD, seat(p, LEAD));
    const first = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    assert.throws(() => setFieldValues(p, { set: POSITION, period: '2026-09' }, { outstanding_per_books: 1 }, LEAD, seat(p, LEAD)), /This period is issued/);
    assert.throws(() => reviseSheetPeriod(p, POSITION, '2026-09', JUNIOR, seat(p, JUNIOR)), /opened by a lead or a signer/);
    const revision = reviseSheetPeriod(p, POSITION, '2026-09', LEAD, seat(p, LEAD));
    assert.deepEqual([revision.status, revision.revises], ['open', first.issuedAt]);
    assert.equal(reviseSheetPeriod(p, POSITION, '2026-09', LEAD, seat(p, LEAD)), revision, 'one revision is open at a time');
    assert.deepEqual(setFieldValues(p, { set: POSITION, period: '2026-09' }, { outstanding_per_books: 405_000_000 }, LEAD, seat(p, LEAD)).rejected, []);
    assert.equal(first.values.outstanding_per_books!.value, 410_000_000, 'the issue is as it was issued');
    assert.equal(p.fieldSheets![POSITION]!.values.outstanding_per_books!.value, null, 'and the sheet itself, the open month, is not touched: a balance is read afresh, so it opened blank');
    const open = readSheetPeriod(p, POSITION, '2026-09')!;
    assert.equal(open.editable, true);
    assert.equal(open.reading.fields.find((view) => view.def.key === 'outstanding_per_books')!.text, '₹40.5 Cr');
    // Until it is issued, a reading as at September is the first issue's.
    assert.equal(resolveFields(projectAsAt(p, '2026-09-30'), asAtMoment('2026-09-30')).read({ fn: 'finance.lenders', set: POSITION, field: 'outstanding_per_books' })!.value, 410_000_000);
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: at('2026-10-08T06:00:00Z') });
    assert.equal(resolveFields(projectAsAt(p, '2026-09-30'), asAtMoment('2026-09-30')).read({ fn: 'finance.lenders', set: POSITION, field: 'outstanding_per_books' })!.value, 405_000_000);
    const kept = periodsOf(p, POSITION, at('2026-10-09T06:00:00Z'));
    assert.deepEqual(kept.map((instance) => [instance.status, instance.superseded ?? false, Boolean(instance.revises)]), [['issued', false, true], ['issued', true, false]]);
    assert.equal(readFunctionFields(p, 'finance.lenders', at('2026-10-09T06:00:00Z')).sheets.find((held) => held.set.id === POSITION)!.periods!.pastSaid, 'September issued by A. Rao, revised · 1 earlier');
    assert.equal(readSheetPeriod(p, POSITION, '2026-09', undefined, first.issuedAt)!.reading.fields.find((view) => view.def.key === 'outstanding_per_books')!.text, '₹41 Cr', 'the first issue is still read as it was sent');
  });
});

describe('a sheet’s periods, compared and drawn', () => {
  it('sets the sheet as it reads now beside the last period issued, and gives a figure period by period', () => {
    const p = project();
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000, outstanding_per_books: 410_000_000 }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-08', at: at('2026-09-04T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 432_000_000 }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: at('2026-10-05T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 450_000_000 }, LEAD, seat(p, LEAD));
    const now = compareSheetPeriods(p, POSITION, undefined, at('2026-10-13T06:00:00Z'))!;
    assert.equal(now.fields.find((field) => field.key === 'outstanding_per_statement')!.said, 'Was ₹43.2 Cr in September; now ₹45 Cr');
    const september = compareSheetPeriods(p, POSITION, '2026-09', at('2026-10-13T06:00:00Z'))!;
    assert.equal(september.fields.find((field) => field.key === 'outstanding_per_statement')!.said, 'Was ₹41 Cr in August; now ₹43.2 Cr');
    const series = periodSeries(p, { set: POSITION, field: 'outstanding_per_statement' }, at('2026-10-13T06:00:00Z'));
    assert.deepEqual(series.map((point) => [point.period.key, point.value, point.status]), [['2026-08', 410_000_000, 'issued'], ['2026-09', 432_000_000, 'issued'], ['2026-10', 450_000_000, 'open']]);
  });
});

describe('an issued record', () => {
  it('keeps every field as it read at issue, the worked-out ones among them: none is worked out again', () => {
    const p = project();
    const august = addFieldRecord(p, CASH_MONTHS, { month: '2026-08-01', collections: 500, contractors: 200 }, LEAD, seat(p, LEAD)).record!;
    issuePeriod(p, CASH_MONTHS, august.id, { actor: LEAD }, seat(p, LEAD));
    assert.deepEqual([august.frozen!.net!.value, august.frozen!.net!.derived, august.frozen!.net!.said], [300, true, '₹300']);
    assert.equal(august.frozen!.collections!.said, '₹500');
    // Were the stored figure ever to change under it, the issued net would still be the one that was issued.
    august.values.collections = { ...august.values.collections!, value: 900 };
    assert.equal(resolveFields(p).read({ fn: 'finance.funding', set: CASH_MONTHS, field: 'net', record: august.id })!.value, 300);
    const view = readSheet(p, CASH_MONTHS, august.id)!.fields.find((held) => held.def.key === 'net')!;
    assert.deepEqual([view.text, view.frozen?.said], ['₹300', '₹300']);
  });
});

describe('the Cost Report, read as periods', () => {
  function costed(): DdProject {
    const p = project();
    const august = startCostReport(p, { month: '2026-08-01', seedPackages: false }, LEAD);
    addCostReportPackage(p, august.id, { name: 'Civil', budget: 100_000_000 }, LEAD);
    issueCostReport(p, august.id, LEAD);
    august.issuedAt = '2026-09-05T06:00:00.000Z';
    return p;
  }

  it('gives its months as instances, the same way a set kept by period does, and is asked for when a month goes by', () => {
    const p = costed();
    const [august] = periodsOf(p, COST_REPORT_PERIODS, at('2026-10-13T06:00:00Z'));
    assert.deepEqual([august!.period.key, august!.status, august!.due, august!.late], ['2026-08', 'issued', '2026-09-07', false]);
    assert.deepEqual(costReportDue(p, at('2026-10-13T06:00:00Z'))!.said, 'September: not started, was due 7 Oct 2026');
    assert.ok(periodsDue(p, at('2026-10-13T06:00:00Z')).some((due) => due.set === COST_REPORT_PERIODS));
    assert.equal(costReportDue(p, at('2026-09-20T06:00:00Z')), undefined, 'August is issued, and September is still running');
    assert.equal(costReportDue(project(), at('2026-10-13T06:00:00Z')), undefined, 'nothing is due of a project that keeps no Cost Report');
  });

  it('draws a figure of it month by month from the reports that stand, and a revision takes its month once issued', () => {
    const p = costed();
    const september = startCostReport(p, { month: '2026-09-01' }, LEAD);
    issueCostReport(p, september.id, LEAD);
    const revision = reopenCostReport(p, september.id, LEAD);
    assert.equal(periodsOf(p, COST_REPORT_PERIODS).filter((instance) => instance.period.key === '2026-09').length, 2);
    const series = () => periodSeries(p, { set: COST_REPORT_PERIODS, field: 'budget' }).map((point) => [point.period.key, point.value]);
    assert.deepEqual(series(), [['2026-08', 100_000_000], ['2026-09', 100_000_000]], 'the draft beside the issue is not drawn');
    revision.rows[0]!.budget = 120_000_000;
    issueCostReport(p, revision.id, LEAD);
    assert.deepEqual(series(), [['2026-08', 100_000_000], ['2026-09', 120_000_000]]);
  });
});

describe('the project as at a day', () => {
  /** Three months of a project: a budget figure changed three times, cash months made and taken off, a milestone reported six times, two Cost Reports. */
  function storied(): DdProject {
    const p = project();
    p.createdAt = '2026-07-01T04:00:00.000Z';
    p.historyFrom = '2026-07-01T04:00:00.000Z';
    p.fieldSheets = {};
    funded(p, '2026-07-02T06:00:00.000Z');
    p.fieldSheets[POSITION] = { values: {} };
    p.fieldSheets[CASH_MONTHS] = { values: {}, records: [] };
    const values = p.fieldSheets[POSITION]!.values;
    for (const [value, when] of [[380_000_000, '2026-07-10T06:00:00.000Z'], [410_000_000, '2026-08-12T06:00:00.000Z'], [432_000_000, '2026-09-25T06:00:00.000Z'], [450_000_000, '2026-10-08T06:00:00.000Z']] as const) {
      stand(values, 'outstanding_per_statement', typed(value, when), { at: when, by: LEAD });
    }
    const month = (id: string, first: string, collections: number, made: string) => ({ id, createdAt: made, by: LEAD, values: { month: typed(first, made), collections: typed(collections, made), contractors: typed(1, made) } });
    p.fieldSheets[CASH_MONTHS]!.records = [month('rec_jul', '2026-07-01', 100, '2026-08-03T06:00:00.000Z'), month('rec_aug', '2026-08-01', 200, '2026-09-02T06:00:00.000Z'), month('rec_sep', '2026-09-01', 300, '2026-10-03T06:00:00.000Z'), { ...month('rec_dup', '2026-08-01', 999, '2026-08-20T06:00:00.000Z'), removed: { by: LEAD, at: '2026-09-10T06:00:00.000Z' } }];
    const [milestone] = addMilestones(p, [{ name: 'Structure', weight: 1, plannedFinish: '2026-12-31' }], LEAD);
    for (const [on, percent] of [['2026-07-15', 10], ['2026-07-31', 18], ['2026-08-20', 30], ['2026-08-31', 36], ['2026-09-28', 52], ['2026-10-10', 61]] as const) setMilestonePercent(p, milestone!.id, percent, LEAD, `${on}T09:00:00.000Z`, on);
    const august = startCostReport(p, { month: '2026-08-01', seedPackages: false }, LEAD);
    addCostReportPackage(p, august.id, { name: 'Civil', budget: 100_000_000 }, LEAD);
    issueCostReport(p, august.id, LEAD);
    august.issuedAt = '2026-09-05T06:00:00.000Z';
    const september = startCostReport(p, { month: '2026-09-01' }, LEAD);
    issueCostReport(p, september.id, LEAD);
    september.issuedAt = '2026-10-06T06:00:00.000Z';
    return p;
  }
  const read = (p: DdProject, day: string) => resolveFields(projectAsAt(p, day), asAtMoment(day));
  const outstanding = (p: DdProject, day: string) => read(p, day).read({ fn: 'finance.lenders', set: POSITION, field: 'outstanding_per_statement' });

  it('reads a field from its history on three past days, and from the sheet today', () => {
    const p = storied();
    assert.deepEqual(['2026-07-31', '2026-08-31', '2026-09-30'].map((day) => outstanding(p, day)!.value), [380_000_000, 410_000_000, 432_000_000]);
    assert.equal(resolveFields(p).read({ fn: 'finance.lenders', set: POSITION, field: 'outstanding_per_statement' })!.value, 450_000_000);
    assert.equal(outstanding(p, '2026-07-05'), undefined, 'before it was first typed, on a project whose history is whole, it held nothing');
    assert.equal(outstanding(p, '2026-09-30')!.asNow, undefined, 'read from the record: nothing about it is as now');
  });

  it('reads a set’s records as they were: made by then, and not yet taken off', () => {
    const p = storied();
    const months = (day: string) => read(p, day).records(CASH_MONTHS)!.map((row) => row.collections!.value);
    assert.deepEqual(months('2026-07-31'), [], 'July’s month was only written up in August');
    assert.deepEqual(months('2026-08-31'), [100, 999], 'the duplicate was still on the list');
    assert.deepEqual(months('2026-09-30'), [100, 200], 'taken off on 10 September; September’s month not yet made');
    assert.deepEqual(resolveFields(p).records(CASH_MONTHS)!.map((row) => row.collections!.value), [100, 200, 300]);
  });

  it('reads a milestone at what was last reported by the day, and the Cost Reports issued by then', () => {
    const p = storied();
    assert.deepEqual(['2026-07-10', '2026-07-31', '2026-08-31', '2026-09-30'].map((day) => projectAsAt(p, day).milestones![0]!.percent), [0, 18, 36, 52]);
    assert.equal(p.milestones![0]!.percent, 61, 'the project itself is not touched');
    assert.deepEqual(['2026-08-31', '2026-09-30', '2026-10-06'].map((day) => projectAsAt(p, day).costReports!.length), [0, 1, 2]);
    assert.equal(read(p, '2026-09-30').read({ fn: 'construction.progress', set: MONTH, field: 'progress' })!.value, 52, 'and a figure worked out from the milestones is as at the day');
  });

  it('an issued period wins over anything worked out afresh for a day it covers', () => {
    const p = storied();
    // September is issued in October, while the statement figure reads 450. What is written down is what was issued.
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: at('2026-10-09T06:00:00Z') });
    assert.equal(outstanding(p, '2026-09-30')!.value, 450_000_000, 'what September was issued as, not what history says stood on the 30th');
    assert.equal(outstanding(p, '2026-08-31')!.value, 410_000_000, 'a day no issue covers is still read from history');
    assert.equal(readSheet(projectAsAt(p, '2026-09-15'), POSITION, undefined, undefined, undefined, asAtMoment('2026-09-15'))!.fields.find((view) => view.def.key === 'outstanding_per_statement')!.frozen?.said, '₹45 Cr');
  });

  it('says what it cannot turn back: a value from before the project kept history, and a figure of a module that keeps none', () => {
    const p = storied();
    delete p.historyFrom;
    const early = outstanding(p, '2026-07-05')!;
    assert.deepEqual([early.value, early.asNow], [450_000_000, '2026-07-10'], 'today’s value, and the day its history begins');
    const q = storied();
    assert.deepEqual(setFieldValues(q, { set: 'finance.budget.contingency' }, { contingency_original: 5_000_000 }, LEAD, seat(q, LEAD)).rejected, []);
    const month = read(q, '2026-09-30').holder(MONTH);
    assert.equal(month.packages_awarded?.asNow ?? month.securities_expiring?.asNow ?? AS_NOW_NO_HISTORY, AS_NOW_NO_HISTORY);
    assert.equal(month.progress!.asNow, undefined, 'progress is read from the readings, and is not as now');
  });
});

describe('a report made for a period', () => {
  function reported(): { p: DdProject; reportId: string } {
    const p = project();
    p.historyFrom = '2026-07-01T04:00:00.000Z';
    p.fieldSheets = {};
    funded(p, '2026-07-02T06:00:00.000Z');
    p.fieldSheets[POSITION] = { values: {} };
    const values = p.fieldSheets[POSITION]!.values;
    stand(values, 'outstanding_per_statement', typed(410_000_000, '2026-08-12T06:00:00.000Z'), { at: '2026-08-12T06:00:00.000Z', by: LEAD });
    stand(values, 'outstanding_per_books', typed(410_000_000, '2026-08-12T06:00:00.000Z'), { at: '2026-08-12T06:00:00.000Z', by: LEAD });
    const report = generateReport(p, { kind: 'function', template: 'finance.lenders.report', generatedBy: LEAD, period: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } }, LEAD);
    return { p, reportId: report.id };
  }
  const NOW = at('2026-10-13T06:00:00Z');
  const position = (p: DdProject, reportId: string) => {
    const block = p.reports.find((report) => report.id === reportId)!.body.blocks.find((held) => held.heading === 'Loan position')!;
    return { source: block.source!, resolved: resolveFieldBlock(p, block.source!, NOW) };
  };

  it('reads its fields as at the period’s last day, and says the day', () => {
    const { p, reportId } = reported();
    assert.equal(p.reports.find((report) => report.id === reportId)!.title, 'Lender’s pack — Lakeside, September 2026');
    const { source, resolved } = position(p, reportId);
    assert.equal(source.asAt, '2026-09-30');
    assert.match(resolved.note ?? '', /^Figures as at 30 Sep 2026\./);
    assert.ok(resolved.lines.includes('Drawn to date: ₹38 Cr · worked out'), resolved.lines.join(' | '));
  });

  it('is not changed by what is recorded in October', () => {
    const { p, reportId } = reported();
    const before = position(p, reportId).resolved;
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 450_000_000, outstanding_per_books: 455_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    addFieldRecord(p, 'finance.lenders.drawdowns', { tranche: 'T9', disbursed_on: '2026-10-12', disbursed_amount: 50_000_000 }, LEAD, seat(p, LEAD));
    assert.deepEqual(position(p, reportId).resolved, before);
    const live = resolveFieldBlock(p, { kind: 'fields', addresses: position(p, reportId).source.addresses }, NOW);
    assert.ok(live.lines.includes('Drawn to date: ₹43 Cr · worked out'), 'the same section with no day reads the record as it stands');
    assert.doesNotMatch(live.note ?? '', /Figures as at/);
  });

  it('prints as now, and says so, what the record’s history does not reach', () => {
    const { p } = reported();
    delete p.historyFrom;
    const statement = { kind: 'fields' as const, addresses: [{ fn: 'finance.lenders', set: POSITION, field: 'outstanding_per_statement' }] };
    const july = resolveFieldBlock(p, { ...statement, asAt: '2026-07-31' }, NOW);
    assert.match(july.lines[0]!, /^Outstanding per the lender’s statement: ₹41 Cr \[1\] \[2\] · entered, as now$/);
    assert.deepEqual(july.footnotes!.map((note) => note.text).slice(1), ['As now: no history before 12 Aug 2026.']);
    assert.match(july.note ?? '', /^Figures as at 31 Jul 2026\./);
    // A day the history reaches is read from it, with nothing said to be as now.
    const september = resolveFieldBlock(p, { ...statement, asAt: '2026-09-30' }, NOW);
    assert.match(september.lines[0]!, /^Outstanding per the lender’s statement: ₹41 Cr \[1\] · entered$/);
  });

  it('a report made with no period reads the record as it stands, as it always did', () => {
    const p = project();
    const report = generateReport(p, { kind: 'function', template: 'finance.lenders.report', generatedBy: LEAD }, LEAD);
    assert.ok(report.body.blocks.every((block) => !block.source?.asAt));
    assert.equal(report.title, 'Lender’s pack — Lakeside');
  });
});

describe('a collaborator’s copy', () => {
  it('holds no issued period, frozen field or footnote its grant does not reach', () => {
    const p = project();
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 777_000_111, outstanding_per_books: 777_000_222 }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    const grant = { id: 'g1', tenantId: 't', projectId: p.id, email: 'out@side.example', role: 'viewer', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: ['title_ownership'], areas: [], createdAt: '', createdBy: '' } as unknown as ProjectGrant;
    const copy = JSON.stringify(projectView(p, { kind: 'grant', grant, email: 'out@side.example' } as never).project);
    assert.ok(JSON.stringify(p).includes('777000111'));
    assert.equal(copy.includes('777000111'), false);
    assert.equal(copy.includes('777000222'), false);
    assert.equal(copy.includes(POSITION), false);
  });
});

describe('a project that keeps none of this', () => {
  it('reads as it did: no period, nothing due, and removing a record still works', () => {
    const p = project();
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 5 }, LEAD, seat(p, LEAD));
    const record = addFieldRecord(p, CASH_MONTHS, { collections: 5 }, LEAD, seat(p, LEAD)).record!;
    removeFieldRecord(p, CASH_MONTHS, record.id, LEAD, seat(p, LEAD));
    assert.deepEqual(periodsDue(p, at('2026-10-13T06:00:00Z')), []);
    assert.equal(p.fieldSheets![POSITION]!.periods, undefined);
    assert.equal(fieldCatalog().sets.get(POSITION)!.periodic!.every, 'month');
    const page = readFunctionFields(p, 'finance.lenders', at('2026-10-13T06:00:00Z'));
    assert.equal([...page.needs.due_soon, ...page.needs.failing].filter((need) => need.kind === 'due').length, 0);
  });
});
