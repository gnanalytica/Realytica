/**
 * A set kept by period (docs/fields.md, Periods): records as periods.
 *
 * - A period has a key that never changes, by the calendar in India and the
 *   year the project numbers its quarters in.
 * - A new period opens from the last: carried keys filled, the rest blank,
 *   and nothing made twice.
 * - Two periods are compared field by field, with the dated rows that
 *   explain a figure and what they leave, settled by a pick from a list.
 * - A period past its day is said to be late, one nobody kept is said to be
 *   not kept, and neither is filled in by anything but a person.
 * - A period is issued by a named person with the right role, is never
 *   edited after, and is corrected by a revision kept beside it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FieldRefused,
  addFieldRecord,
  catalogFaults,
  comparePeriods,
  createProject,
  currentPeriod,
  decidesIn,
  departmentRole,
  fieldCatalog,
  fieldRecords,
  issuePeriod,
  lastPeriod,
  monthsAfter,
  openPeriod,
  periodDue,
  periodOfDay,
  periodOfKey,
  periodShift,
  periodsDue,
  periodsDueSaid,
  reportsReadySaid,
  periodsNotKept,
  periodsOf,
  periodsStanding,
  proposeFieldValues,
  readFunctionFields,
  removeFieldRecord,
  resolveFields,
  revisePeriod,
  roleCanEdit,
  setFieldValues,
  setPeriodReason,
  setReportDay,
  setTeamMember,
  yearWritten,
  addEvidence,
  FIELD_SETS,
  type DdProject,
  type FieldWriteOptions,
} from '@realytica/shared';

const CASH = 'finance.funding.cash_months';
const WEEKS = 'finance.funding.forecast_weeks';
const CERTS = 'finance.funding.rera_certificates';
const YEARS = 'finance.funding.rera_years';
const REPORTS = 'finance.lenders.engineer_reports';
const DRAWDOWNS = 'finance.lenders.drawdowns';
const DEMANDS = 'commercial.buyers.demands';
const LEAD = 'lead@firm.example';
const JUNIOR = 'junior@firm.example';
const SIGNER = 'signer@firm.example';

function project(): DdProject {
  const p = createProject({ name: 'Lakeside', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-PER');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { finance: 'lead', commercial: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { finance: 'contributor' } }, 'owner');
  setTeamMember(p, { email: SIGNER, name: 'S. Menon', departments: { finance: 'signer' }, signer: { profession: 'Chartered accountant', registration: 'M-000001' } }, 'owner');
  return p;
}

const seat = (p: DdProject, email: string): FieldWriteOptions => ({
  mayDecide: decidesIn(p, { email }),
  mayEdit: (department) => roleCanEdit(departmentRole(p, { email }, department)),
  roleIn: (department) => departmentRole(p, { email }, department),
});

const month = (p: DdProject, first: string, values: Record<string, unknown> = {}) => {
  const out = addFieldRecord(p, CASH, { month: first, ...values }, LEAD, seat(p, LEAD));
  assert.deepEqual(out.rejected, []);
  return out.record!;
};

describe('a period’s key', () => {
  it('names a month by the day it holds, at both of its ends', () => {
    assert.deepEqual(periodOfDay('month', '2026-09-30'), { key: '2026-09', from: '2026-09-01', to: '2026-09-30', label: 'September 2026', short: 'September' });
    assert.equal(periodOfDay('month', '2026-10-01')!.key, '2026-10');
    assert.equal(periodOfDay('month', '2028-02-29')!.to, '2028-02-29', 'a leap year’s February');
    assert.equal(periodOfDay('month', '2026-12-31')!.key, '2026-12');
    assert.equal(periodShift(periodOfKey('2026-12')!, 1).key, '2027-01');
  });

  it('names a quarter in the Indian financial year, or in the calendar year where the project says so', () => {
    assert.equal(periodOfDay('quarter', '2026-09-30', 'financial')!.key, 'FY2026-Q2');
    assert.equal(periodOfDay('quarter', '2026-10-01', 'financial')!.key, 'FY2026-Q3');
    assert.equal(periodOfDay('quarter', '2027-03-31', 'financial')!.key, 'FY2026-Q4', 'January to March is the last quarter of the year that began the April before');
    assert.equal(periodOfDay('quarter', '2027-04-01', 'financial')!.key, 'FY2027-Q1');
    assert.equal(periodOfDay('quarter', '2026-09-30', 'calendar')!.key, '2026-Q3');
    assert.deepEqual([periodOfKey('FY2026-Q2')!.from, periodOfKey('FY2026-Q2')!.to, periodOfKey('FY2026-Q2')!.label], ['2026-07-01', '2026-09-30', 'Q2 FY 2026-27']);
    assert.equal(periodOfKey('2026-Q3')!.from, '2026-07-01');
    assert.equal(periodShift(periodOfKey('FY2026-Q4')!, 1).key, 'FY2027-Q1');
    assert.equal(periodShift(periodOfKey('2026-Q1')!, -1).key, '2025-Q4');
  });

  it('names a year from April to March, or January to December', () => {
    assert.deepEqual([periodOfDay('year', '2027-03-31', 'financial')!.key, periodOfDay('year', '2027-04-01', 'financial')!.key], ['FY2026', 'FY2027']);
    assert.deepEqual([periodOfKey('FY2026')!.from, periodOfKey('FY2026')!.to, periodOfKey('FY2026')!.label], ['2026-04-01', '2027-03-31', 'FY 2026-27']);
    assert.equal(periodOfDay('year', '2026-12-31', 'calendar')!.key, '2026');
    assert.equal(yearWritten('2026-27')!.key, 'FY2026', 'the year as a receipt writes it');
    assert.equal(yearWritten('FY 2026/27')!.key, 'FY2026');
    assert.equal(yearWritten('nineteen'), undefined);
  });

  it('names a week from Monday to Sunday, numbered as the calendar numbers weeks, across a year’s end', () => {
    assert.deepEqual([periodOfDay('week', '2026-10-05')!.key, periodOfDay('week', '2026-10-11')!.key, periodOfDay('week', '2026-10-12')!.key], ['2026-W41', '2026-W41', '2026-W42']);
    assert.deepEqual([periodOfDay('week', '2026-10-07')!.from, periodOfDay('week', '2026-10-07')!.to], ['2026-10-05', '2026-10-11']);
    assert.equal(periodOfDay('week', '2027-01-03')!.key, '2026-W53', 'the first days of January still belong to the old year’s last week');
    assert.equal(periodOfDay('week', '2027-01-04')!.key, '2027-W01');
    assert.equal(periodOfDay('week', '2024-12-30')!.key, '2025-W01', 'and the last days of December may belong to the new year’s first');
    assert.equal(periodOfKey('2026-W41')!.from, '2026-10-05');
    assert.equal(periodOfDay('week', '2026-10-05')!.short, 'Week of 5 Oct');
  });

  it('is nothing for words that are no period', () => {
    assert.equal(periodOfKey('2026-13'), undefined);
    assert.equal(periodOfKey('soon'), undefined);
    assert.equal(periodOfDay('month', '2026-02-30'), undefined);
    assert.equal(monthsAfter('2026-08-31', 6), '2027-02-28');
  });
});

describe('the sets declared as kept by period', () => {
  const periodic = FIELD_SETS.filter((set) => set.periodic && set.records).map((set) => set.id).sort();
  it('are the records the design lists, and each declaration can work', () => {
    assert.deepEqual(periodic, [
      'design.certificates.architect',
      'design.structural_set.engineer_certificates',
      'finance.funding.cash_months',
      'finance.funding.forecast_weeks',
      'finance.funding.rera_certificates',
      'finance.funding.rera_years',
      'finance.lenders.cost_incurred_stated',
      'finance.lenders.engineer_reports',
      'finance.tax.gst_months',
      'finance.tax.property_tax_years',
      'finance.tax.tds_months',
      'finance.tax.tds_statements',
      'legal.rera.filings',
      'legal.rera.progress_quarters',
    ].filter((id) => fieldCatalog().sets.has(id)));
    assert.deepEqual(catalogFaults().filter((fault) => /periodic/.test(fault)), []);
  });

  it('a declaration that cannot work is named: no period field, a rule row that is not on file, rows that are not there', () => {
    const cash = FIELD_SETS.find((set) => set.id === CASH)!;
    const broken = (periodic: object) => catalogFaults([...FIELD_SETS.filter((set) => set.id !== CASH), { ...cash, periodic: { ...cash.periodic!, ...periodic } }]).filter((fault) => fault.startsWith(CASH) && /periodic/.test(fault));
    assert.equal(broken({ by: 'net' }).length, 1, 'a worked-out figure names no period');
    assert.equal(broken({ due: { rate: 'no_such_row' } }).length, 1);
    assert.equal(broken({ carry: ['inflow'] }).length, 1, 'what is worked out is not carried');
    assert.equal(broken({ attribute: [{ field: 'collections', rows: { records: 'commercial.buyers.demands', table: 'no_table' }, date: 'received_on', amount: 'amount', label: 'x' }] }).length, 1);
    assert.equal(broken({ reasons: 'no_such_list' }).length >= 1, true);
  });
});

describe('a period read off a record', () => {
  it('is the month its date falls in, and a record that names no period yet is not one', () => {
    const p = project();
    month(p, '2026-08-01', { collections: 100, contractors: 40 });
    month(p, '2026-09-01', { collections: 120, contractors: 50 });
    addFieldRecord(p, CASH, { collections: 5 }, LEAD, seat(p, LEAD));
    const kept = periodsOf(p, CASH, new Date('2026-10-13T06:00:00Z'));
    assert.deepEqual(kept.map((instance) => instance.period.key), ['2026-09', '2026-08'], 'the latest first');
    assert.deepEqual(kept.map((instance) => instance.status), ['open', 'open']);
    assert.equal(kept[0]!.due, '2026-10-07', 'a week after the month ends');
    assert.equal(kept[0]!.late, true);
  });

  it('is numbered in the year the project numbers by, and is told apart from another in its period by what the set says', () => {
    const p = project();
    const add = (kind: string, end: string) => assert.deepEqual(addFieldRecord(p, CERTS, { kind, period_end: end }, LEAD, seat(p, LEAD)).rejected, []);
    add('accountant_withdrawal', '2026-09-30');
    add('architect_progress', '2026-09-30');
    add('accountant_withdrawal', '2026-06-30');
    const kept = periodsOf(p, CERTS, new Date('2026-10-13T06:00:00Z'));
    assert.deepEqual(kept.map((instance) => instance.id).sort(), ['FY2026-Q1|accountant_withdrawal', 'FY2026-Q2|accountant_withdrawal', 'FY2026-Q2|architect_progress']);
    assert.equal(kept.find((instance) => instance.id === 'FY2026-Q2|architect_progress')!.perSaid, 'Architect: progress');
    setReportDay(p, { day: 5, reports: ['status'], every: 'quarter', quarters: 'calendar', tell: [] }, LEAD);
    assert.deepEqual([...new Set(periodsOf(p, CERTS).map((instance) => instance.period.key))].sort(), ['2026-Q2', '2026-Q3'], 'the calendar year, once the project says so');
  });

  it('is due by the rule row where the law sets the day, read for the project’s place and for the period', () => {
    const p = project();
    const certificates = fieldCatalog().sets.get(CERTS)!.periodic!;
    assert.equal(periodDue(p, certificates, periodOfKey('FY2026-Q2')!), '2026-10-15', 'fifteen days after the quarter, in Karnataka');
    const years = fieldCatalog().sets.get(YEARS)!.periodic!;
    assert.equal(periodDue(p, years, periodOfKey('FY2026')!), '2027-09-30', 'six months after the year');
    const statements = fieldCatalog().sets.get('finance.tax.tds_statements')!.periodic!;
    assert.equal(periodDue(p, statements, periodOfKey('FY2026-Q2')!), '2026-10-31');
    assert.equal(periodDue(p, statements, periodOfKey('FY2026-Q4')!), '2027-05-31', 'the last quarter of the year has its own day');
    p.jurisdiction = 'Kerala';
    assert.equal(periodDue(p, certificates, periodOfKey('FY2026-Q2')!), undefined, 'no row on file for the place: no day is made up');
  });

  it('for a set kept by event is the event its link names', () => {
    const p = project();
    setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { finance: 'lead' } }, 'owner');
    const first = addFieldRecord(p, DRAWDOWNS, { tranche: 'T1', requested_on: '2026-08-10' }, LEAD, seat(p, LEAD)).record!;
    const second = addFieldRecord(p, DRAWDOWNS, { tranche: 'T2', requested_on: '2026-09-20' }, LEAD, seat(p, LEAD)).record!;
    assert.deepEqual(addFieldRecord(p, REPORTS, { report_no: 'LE-1', drawdown: first.id }, LEAD, seat(p, LEAD)).rejected, []);
    const kept = periodsOf(p, REPORTS, new Date('2026-10-13T06:00:00Z'));
    assert.deepEqual(kept.map((instance) => [instance.period.key, instance.period.label, instance.due]), [[`evt:${first.id}`, 'Drawdown T1', '2026-08-25']]);
    const [due] = periodsDue(p, new Date('2026-10-13T06:00:00Z')).filter((line) => line.set === REPORTS);
    assert.equal(due!.period.key, `evt:${first.id}`, 'the first drawdown’s report is open and not issued');
    issuePeriod(p, REPORTS, kept[0]!.record!, { actor: LEAD, name: 'K. Nair' }, seat(p, LEAD));
    const [next] = periodsDue(p, new Date('2026-10-13T06:00:00Z')).filter((line) => line.set === REPORTS);
    assert.deepEqual([next!.period.key, next!.state, next!.said], [`evt:${second.id}`, 'not_started', 'Drawdown T2: not started, was due 5 Oct 2026']);
  });
});

describe('opening a period', () => {
  it('fills the keys the set carries from the last period, marks them as carried, and leaves the rest blank', () => {
    const p = project();
    const signer = addFieldRecord(p, 'shared.parties', { name: 'Rao and Co', kind: 'company' }, LEAD, seat(p, LEAD)).record!;
    addFieldRecord(p, CERTS, { kind: 'accountant_withdrawal', period_end: '2026-06-30', signed_by: signer.id, membership_no: 'M-204512', document_id: 'UDIN-1', signed_on: '2026-07-10' }, LEAD, seat(p, LEAD));
    const opened = openPeriod(p, CERTS, JUNIOR, seat(p, JUNIOR), { period: 'FY2026-Q2' });
    assert.equal(opened.made, 1);
    const [record] = opened.records;
    assert.equal(record!.values.period_end!.value, '2026-09-30');
    assert.equal(record!.values.kind!.value, 'accountant_withdrawal', 'the same kind of certificate as last quarter');
    assert.equal(record!.values.signed_by!.value, signer.id);
    assert.equal(record!.values.membership_no!.value, 'M-204512');
    assert.equal(record!.values.document_id, undefined, 'the certificate’s own number is this quarter’s to give');
    assert.equal(record!.values.signed_on, undefined);
    assert.deepEqual([record!.carried!.from, record!.carried!.keys], ['FY2026-Q1', ['kind', 'signed_by', 'membership_no']]);
    const instance = periodsOf(p, CERTS).find((held) => held.record === record!.id)!;
    assert.deepEqual(instance.carried, { from: 'Q1 FY 2026-27', keys: ['kind', 'signed_by', 'membership_no'] });
    // Typed over, a value is no longer carried.
    setFieldValues(p, { set: CERTS, record: record!.id }, { membership_no: 'M-999999' }, JUNIOR, seat(p, JUNIOR));
    assert.deepEqual(periodsOf(p, CERTS).find((held) => held.record === record!.id)!.carried!.keys, ['kind', 'signed_by']);
  });

  it('makes nothing a second time, and opens the period today falls in where none is named', () => {
    const p = project();
    month(p, '2026-09-01', { collections: 120, contractors: 50 });
    const at = new Date('2026-10-13T06:00:00Z');
    const first = openPeriod(p, CASH, LEAD, seat(p, LEAD), { at });
    assert.deepEqual([first.period.key, first.made], ['2026-10', 1]);
    const again = openPeriod(p, CASH, LEAD, seat(p, LEAD), { at });
    assert.deepEqual([again.made, again.records.map((record) => record.id)], [0, first.records.map((record) => record.id)]);
    assert.equal(fieldRecords(p, CASH).length, 2);
    assert.equal(currentPeriod(p, CASH, at)!.span.key, '2026-10');
    assert.deepEqual(lastPeriod(p, CASH, at)!.instances.map((instance) => instance.period.key), ['2026-09']);
  });

  it('by the day in India: half past six in the evening in London on the last of the month is already the next month there', () => {
    const p = project();
    const opened = openPeriod(p, CASH, LEAD, seat(p, LEAD), { at: new Date('2026-09-30T18:30:00Z') });
    assert.equal(opened.period.key, '2026-10');
    const q = project();
    assert.equal(openPeriod(q, CASH, LEAD, seat(q, LEAD), { at: new Date('2026-09-30T18:29:59Z') }).period.key, '2026-09');
  });

  it('is refused to somebody who only reads the department, and for a period of another kind', () => {
    const p = project();
    assert.throws(() => openPeriod(p, CASH, 'stranger@firm.example', seat(p, 'stranger@firm.example')), FieldRefused);
    assert.throws(() => openPeriod(p, CASH, LEAD, seat(p, LEAD), { period: 'FY2026-Q2' }), /kept by the month/);
    assert.throws(() => openPeriod(p, 'finance.funding.plan', LEAD, seat(p, LEAD)), /not kept by period/);
  });
});

describe('comparing a period with the one before', () => {
  function two(): { p: DdProject; september: string; october: string } {
    const p = project();
    const september = month(p, '2026-09-01', { collections: 41_000_000, contractors: 30_000_000, taxes: 1_000_000 }).id;
    const october = month(p, '2026-10-01', { collections: 43_200_000, contractors: 30_000_000 }).id;
    return { p, september, october };
  }

  it('gives each figure as it was and as it is, by its key, in one templated line', () => {
    const { p, october } = two();
    const said = comparePeriods(p, CASH, october);
    assert.equal(said.previous!.period.key, '2026-09');
    const by = (key: string) => said.fields.find((field) => field.key === key)!;
    assert.equal(by('collections').said, 'Was ₹4.1 Cr in September; now ₹4.32 Cr');
    assert.deepEqual([by('collections').by, by('collections').bySaid], [2_200_000, '+₹22 lakh']);
    assert.equal(by('contractors').said, 'Unchanged at ₹3 Cr');
    assert.equal(by('taxes').said, 'Was ₹10 lakh in September; not entered for October yet');
    assert.equal(by('taxes').moved, false, 'a field merely blank this period has not moved');
    assert.equal(by('net').moved, true, 'a figure that is worked out is compared as any other');
    assert.equal(by('month'), undefined, 'the field that names the period is not a figure of it');
    assert.match(said.said, /^\d+ of \d+ fields moved since September$/);
  });

  it('sets the dated rows inside the period against the figure, and calls what they leave unexplained', () => {
    const { p, october } = two();
    const unit = addFieldRecord(p, 'shared.units', { number: 'A-501' }, LEAD, seat(p, LEAD)).record!;
    assert.deepEqual(
      addFieldRecord(p, DEMANDS, { unit: unit.id, demand_no: 'DN-1', settled_by: [{ receipt_no: 'R-1', received_on: '2026-10-05', amount: 25_000_000 }, { receipt_no: 'R-2', received_on: '2026-10-31', amount: 17_000_000 }, { receipt_no: 'R-0', received_on: '2026-09-30', amount: 9_000_000 }] }, LEAD, seat(p, LEAD)).rejected,
      [],
    );
    const move = comparePeriods(p, CASH, october).fields.find((field) => field.key === 'collections')!;
    assert.deepEqual(move.causes, [{ label: 'Receipts on demands', rows: 2, amount: 42_000_000, said: 'Receipts on demands: ₹4.2 Cr in 2 rows' }], 'the receipt dated the day before the month is not October’s');
    assert.equal(move.unexplained, 1_200_000);
    assert.equal(move.unexplainedSaid, 'Unexplained: ₹12 lakh');
    assert.equal(comparePeriods(p, CASH, october).unsettled, 1);
  });

  it('settles what is unexplained by a pick from the set’s list, never by a sentence', () => {
    const { p, october } = two();
    assert.throws(() => setPeriodReason(p, CASH, october, 'collections', 'the bank was slow to post two receipts', LEAD, seat(p, LEAD)), /Pick one of the reasons/);
    assert.throws(() => setPeriodReason(p, CASH, october, 'contractors', 'rounding', LEAD, seat(p, LEAD)), /Nothing of that figure is unexplained/);
    setPeriodReason(p, CASH, october, 'collections', 'dated_in_another_period', JUNIOR, seat(p, JUNIOR));
    const said = comparePeriods(p, CASH, october);
    assert.deepEqual([said.fields.find((field) => field.key === 'collections')!.reasonSaid, said.unsettled], ['Dated in another period', 0]);
    assert.ok(said.reasons.length >= 4);
    setPeriodReason(p, CASH, october, 'collections', null, LEAD, seat(p, LEAD));
    assert.equal(comparePeriods(p, CASH, october).unsettled, 1);
  });

  it('says a running total moved by the period’s own amount', () => {
    const p = project();
    const auditor = addFieldRecord(p, 'shared.parties', { name: 'Iyer Associates', kind: 'company' }, LEAD, seat(p, LEAD)).record!;
    const base = { auditor: auditor.id, completed: 40, collected_in_year: 1, withdrawn_in_year: 1, excess_withdrawn: 0 };
    addFieldRecord(p, YEARS, { ...base, year_end: '2026-03-31', collected_to_date: 100_000_000, withdrawn_to_date: 60_000_000 }, LEAD, seat(p, LEAD));
    const next = addFieldRecord(p, YEARS, { ...base, year_end: '2027-03-31', collected_to_date: 250_000_000, withdrawn_to_date: 60_000_000 }, LEAD, seat(p, LEAD)).record!;
    const said = comparePeriods(p, YEARS, next.id);
    assert.equal(said.fields.find((field) => field.key === 'collected_to_date')!.said, '+₹15 Cr in FY 2026-27: ₹10 Cr to ₹25 Cr');
    assert.equal(said.fields.find((field) => field.key === 'withdrawn_to_date')!.said, 'Unchanged at ₹6 Cr');
  });
});

describe('late, and not kept', () => {
  it('nothing is due of a set nobody has kept', () => {
    const p = project();
    assert.deepEqual(periodsDue(p, new Date('2026-10-13T06:00:00Z')), []);
    assert.equal(readFunctionFields(p, 'finance.funding', new Date('2026-10-13T06:00:00Z')).needs.due_soon.length, 0);
  });

  it('the latest period that has ended and is not issued is one line: how full it is and when it is due', () => {
    const p = project();
    month(p, '2026-08-01', { collections: 100, contractors: 40 });
    const page = readFunctionFields(p, 'finance.funding', new Date('2026-09-03T06:00:00Z'));
    const [line] = page.needs.due_soon.filter((need) => need.kind === 'due');
    assert.deepEqual([line!.label, line!.text], ['Cash by month', 'August: 3 of 3 fields, due 7 Sep 2026']);
    assert.equal(page.counts.due, 1);
    assert.equal(page.needs.failing.filter((need) => need.kind === 'due').length, 0);
  });

  it('past its day it is failing, said as late, and still one line for the set', () => {
    const p = project();
    month(p, '2026-07-01', { collections: 100, contractors: 40 });
    month(p, '2026-08-01', { collections: 100, contractors: 40 });
    const page = readFunctionFields(p, 'finance.funding', new Date('2026-09-20T06:00:00Z'));
    const lines = [...page.needs.failing, ...page.needs.due_soon].filter((need) => need.kind === 'due');
    assert.deepEqual(lines.map((need) => [need.need, need.text]), [['failing', 'August: 3 of 3 fields, was due 7 Sep 2026']], 'July is open too, and the set still asks for one thing');
  });

  it('a period that went by with nothing kept is said to be not kept, and is not filled in', () => {
    const p = project();
    month(p, '2026-06-01', { collections: 100, contractors: 40 });
    month(p, '2026-08-01', { collections: 100, contractors: 40 });
    const at = new Date('2026-10-13T06:00:00Z');
    assert.deepEqual(periodsNotKept(p, CASH, at).map((span) => span.key), ['2026-09', '2026-07']);
    const sheet = readFunctionFields(p, 'finance.funding', at).sheets.find((held) => held.set.id === CASH)!;
    assert.equal(sheet.periods!.notKeptSaid, '2 periods not kept: September, July');
    assert.equal(sheet.periods!.due!.said, 'September: not started, was due 7 Oct 2026');
    assert.equal(fieldRecords(p, CASH).length, 2, 'reading the page made no record');
    assert.equal(sheet.periods!.toOpen!.key, '2026-10');
    // Kept late, it is a record made today that says which month it is for: nothing is dated back.
    const late = openPeriod(p, CASH, LEAD, seat(p, LEAD), { period: '2026-07', at });
    assert.ok(late.records[0]!.createdAt > '2026-10-01');
    assert.deepEqual(periodsNotKept(p, CASH, at).map((span) => span.key), ['2026-09']);
  });

  it('once every instance of the period is issued nothing is due', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD));
    assert.deepEqual(periodsDue(p, new Date('2026-09-20T06:00:00Z')), []);
    assert.equal(readFunctionFields(p, 'finance.funding', new Date('2026-09-20T06:00:00Z')).sheets.find((held) => held.set.id === CASH)!.periods!.pastSaid, 'August issued by A. Rao');
  });
});

describe('issuing a period', () => {
  it('is a lead’s or a signer’s, under their name, and the record takes no write after', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    assert.throws(() => issuePeriod(p, CASH, august.id, { actor: JUNIOR }, seat(p, JUNIOR)), /issued by a lead or a signer/);
    const issued = issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD), undefined, new Date('2026-09-05T06:00:00Z'));
    assert.deepEqual(issued.issued, { by: LEAD, at: '2026-09-05T06:00:00.000Z' });
    assert.throws(() => setFieldValues(p, { set: CASH, record: august.id }, { collections: 999 }, LEAD, seat(p, LEAD)), /This period is issued/);
    assert.throws(() => removeFieldRecord(p, CASH, august.id, LEAD, seat(p, LEAD)), /This period is issued/);
    const row = addEvidence(p, { title: 'Cash book', kind: 'document' });
    const [offer] = proposeFieldValues(p, [{ address: { fn: 'finance.funding', set: CASH, field: 'taxes', record: august.id }, value: 5, origin: { kind: 'paper', evidenceId: row.id, page: 1, quote: 'taxes 5', reader: 'model' } }], 'model');
    assert.equal(offer!.outcome, 'refused', 'and nothing is offered to it');
    assert.throws(() => issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD)), /already issued/);
    assert.equal(p.audit.filter((event) => event.action === 'issue_period').length, 1);
    const [instance] = periodsOf(p, CASH, new Date('2026-09-20T06:00:00Z'));
    assert.deepEqual([instance!.status, instance!.late], ['issued', false], 'issued two days before it was due');
  });

  it('is refused while a value on it waits for a person', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    const row = addEvidence(p, { title: 'Cash book', kind: 'document' });
    proposeFieldValues(p, [{ address: { fn: 'finance.funding', set: CASH, field: 'taxes', record: august.id }, value: 5, origin: { kind: 'paper', evidenceId: row.id, page: 1, quote: 'taxes 5', reader: 'model' } }], 'model');
    assert.throws(() => issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD)), /1 value waits on it/);
  });

  it('of a paper an outside party signs is recorded by a lead or signer with the name it was signed under', () => {
    const p = project();
    const certificate = addFieldRecord(p, CERTS, { kind: 'accountant_withdrawal', period_end: '2026-09-30' }, LEAD, seat(p, LEAD)).record!;
    assert.throws(() => issuePeriod(p, CERTS, certificate.id, { actor: LEAD }, seat(p, LEAD)), /Give the name the consultant signed it under/);
    assert.throws(() => issuePeriod(p, CERTS, certificate.id, { actor: JUNIOR, name: 'R. Iyer' }, seat(p, JUNIOR)), FieldRefused);
    const issued = issuePeriod(p, CERTS, certificate.id, { actor: SIGNER, name: '  R.  Iyer ' }, seat(p, SIGNER));
    assert.equal(issued.issued!.name, 'R. Iyer');
    const page = readFunctionFields(p, 'finance.funding', new Date('2026-10-13T06:00:00Z'));
    assert.equal(page.sheets.find((held) => held.set.id === CERTS)!.periods!.pastSaid, 'Q2 FY 2026-27, Accountant: withdrawal issued by R. Iyer');
  });
});

describe('a revision', () => {
  it('is kept beside the issued period, which stays as it was and goes on being the one every figure reads', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD));
    assert.throws(() => revisePeriod(p, CASH, august.id, JUNIOR, seat(p, JUNIOR)), /opened by a lead or a signer/);
    const revision = revisePeriod(p, CASH, august.id, LEAD, seat(p, LEAD));
    assert.equal(revision.revises, august.id);
    assert.equal(revisePeriod(p, CASH, august.id, LEAD, seat(p, LEAD)).id, revision.id, 'one revision is open at a time');
    setFieldValues(p, { set: CASH, record: revision.id }, { collections: 130 }, LEAD, seat(p, LEAD));
    assert.equal(august.values.collections!.value, 100, 'the issued one is as it was issued');
    assert.equal(resolveFields(p).records(CASH)!.length, 1, 'one August counts');
    assert.equal(resolveFields(p).records(CASH)![0]!.collections!.value, 100, 'the issued one, until the revision is issued');
    const all = periodsOf(p, CASH);
    assert.deepEqual(all.map((instance) => [instance.status, Boolean(instance.revises)]), [['open', true], ['issued', false]]);
    assert.equal(periodsStanding(all).length, 1);
    assert.equal(periodsDue(p, new Date('2026-09-20T06:00:00Z')).length, 0, 'a revision open beside an issue is not a period left undone');
  });

  it('takes the issued period’s place once it is issued, and the first is still kept', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    issuePeriod(p, CASH, august.id, { actor: LEAD }, seat(p, LEAD));
    const revision = revisePeriod(p, CASH, august.id, LEAD, seat(p, LEAD));
    setFieldValues(p, { set: CASH, record: revision.id }, { collections: 130 }, LEAD, seat(p, LEAD));
    issuePeriod(p, CASH, revision.id, { actor: SIGNER }, seat(p, SIGNER));
    assert.deepEqual(resolveFields(p).records(CASH)!.map((row) => row.collections!.value), [130]);
    assert.deepEqual(fieldRecords(p, CASH).map((record) => record.id), [revision.id]);
    const all = periodsOf(p, CASH);
    assert.deepEqual(all.map((instance) => [instance.record, instance.superseded ?? false]), [[revision.id, false], [august.id, true]]);
    assert.equal(p.fieldSheets![CASH]!.records!.find((record) => record.id === august.id)!.values.collections!.value, 100);
    assert.throws(() => revisePeriod(p, CASH, august.id, LEAD, seat(p, LEAD)), /Revise that one/);
    const page = readFunctionFields(p, 'finance.funding', new Date('2026-09-20T06:00:00Z'));
    assert.equal(page.sheets.find((held) => held.set.id === CASH)!.periods!.pastSaid, 'August issued by S. Menon, revised · 1 earlier');
  });

  it('is only of a period that is issued', () => {
    const p = project();
    const august = month(p, '2026-08-01', { collections: 100, contractors: 40 });
    assert.throws(() => revisePeriod(p, CASH, august.id, LEAD, seat(p, LEAD)), /still open/);
  });
});

describe('the report day’s notice', () => {
  it('says the periods that are not issued, below the reports it prepared', () => {
    const p = project();
    month(p, '2026-08-01', { collections: 100, contractors: 40 });
    const at = new Date('2026-09-20T06:00:00Z');
    assert.deepEqual(periodsDueSaid(p, at), ['Cash by month, August: 3 of 3 fields, was due 7 Sep 2026']);
    const said = reportsReadySaid(p, [{ kind: 'status', from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', id: 'r1', at: at.toISOString() }], at);
    assert.match(said.text, /One period is not issued yet:\n- Cash by month, August: 3 of 3 fields, was due 7 Sep 2026$/);
    const q = project();
    assert.doesNotMatch(reportsReadySaid(q, [{ kind: 'status', from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', id: 'r1', at: at.toISOString() }], at).text, /not issued yet/);
  });
});

describe('a weekly set', () => {
  it('asks for last week once this week has begun', () => {
    const p = project();
    assert.deepEqual(addFieldRecord(p, WEEKS, { week_beginning: '2026-10-05', receipts: 10, payments: 4, closing: 6 }, LEAD, seat(p, LEAD)).rejected, []);
    const [due] = periodsDue(p, new Date('2026-10-12T06:00:00Z'));
    assert.deepEqual([due!.period.key, due!.said], ['2026-W41', 'Week of 5 Oct: 4 of 4 fields, due 13 Oct 2026']);
    assert.deepEqual(periodsDue(p, new Date('2026-10-11T06:00:00Z')), [], 'while the week is still running nothing of it is due');
  });
});
