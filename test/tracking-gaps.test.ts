/**
 * Tracking over time, where the periods and the photo stations meet.
 *
 * Ten things two builders reported as open, each held here: a late issue
 * reads the period's last day; a set nobody has kept says so in one line and
 * nags nobody until it is started; what holds from period to period is
 * carried and what is read afresh opens blank beside last period's value; a
 * worked-out field says what it waits for; a past period is opened from a
 * list and compared with the one before; a period that is due is told once
 * to whoever issues it; a milestone is not marked complete without the
 * photographs it needs; a first period opens a row for each kind or
 * building; a line names a person and never prints an address; a report's
 * Word file prints the site log's photographs; and the view across projects
 * reads the schedule and the units sold by period.
 *
 * Every project, person and figure is invented. No model is called.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AS_NOW_NO_HISTORY,
  FIELD_SETS,
  MILESTONE_PHOTO_WAIVERS,
  MilestonePhotosWanting,
  STATIONS_SET,
  STATION_PHOTO_COLUMNS,
  STATION_ROUND_SET,
  acrossProjects,
  addEvidence,
  addFieldRecord,
  addMilestones,
  asAtMoment,
  attachEvidenceFile,
  comparePeriods,
  compareSheetPeriods,
  createProject,
  decidesIn,
  enteredAfterPeriod,
  departmentRole,
  fieldIsDerived,
  frozenAsNowSaid,
  functionReportTemplate,
  gatherPeriodsDue,
  generateReport,
  issuePeriod,
  issueSheetPeriod,
  logSiteEntry,
  markMilestonePercent,
  milestonePhotoChecklist,
  milestonePhotoStanding,
  milestonesShortOfPhotos,
  openPeriod,
  periodDuePeople,
  periodIssuedSaid,
  periodSeries,
  periodsDue,
  periodsOf,
  personSaid,
  photoSeries,
  photoStations,
  placeEntryShots,
  projectAsAt,
  projectAsOfPeriod,
  projectShots,
  projectView,
  readFunctionFields,
  readSheet,
  readSheetPeriod,
  resolveReportBlock,
  resolveStationPhotos,
  roleCanEdit,
  setFieldValues,
  setMilestonePercent,
  setTeamMember,
  startSheetPeriod,
  stationRound,
  stationRoundDue,
  stationShots,
  tellSaid,
  type DdProject,
  type FieldWriteOptions,
  type ProjectGrant,
  type TellPerson,
} from '@realytica/shared';
import type { PeriodsDueSource } from '../apps/api/src/cron/periods-due';
import { reportTablePhotos } from '../apps/web/src/lib/report-photos';

const LEAD = 'a.rao@firm.example';
const JUNIOR = 'junior@firm.example';
const POSITION = 'finance.lenders.position';
const CASH_MONTHS = 'finance.funding.cash_months';
const CERTIFICATES = 'finance.funding.rera_certificates';
const ARCHITECT = 'design.certificates.architect';
const STOCK = 'commercial.inventory.stock';
const at = (iso: string) => new Date(iso);
/** The daily job, loaded when it is run: the API's own modules are read once a data folder is named. */
const periodsDueSweep = async (now: Date, source: PeriodsDueSource) => (await import('../apps/api/src/cron/periods-due')).periodsDueSweep(now, source);
/** Noon in India on 13 October 2026, a Tuesday. */
const NOW = at('2026-10-13T06:30:00Z');

function project(name = 'Lakeside'): DdProject {
  const p = createProject({ name, type: 'residential', location: 'Whitefield', city: 'Bengaluru', currentStage: 'construction' }, `RYT-${name.slice(0, 3).toUpperCase()}`);
  p.jurisdiction = 'Karnataka';
  p.createdAt = '2026-01-01T04:00:00.000Z';
  p.historyFrom = '2026-01-01T04:00:00.000Z';
  setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { finance: 'lead', construction: 'lead', commercial: 'lead', legal: 'lead', design: 'lead' } }, 'owner');
  setTeamMember(p, { email: JUNIOR, departments: { finance: 'contributor', construction: 'contributor' } }, 'owner');
  return p;
}

const seat = (p: DdProject, email: string): FieldWriteOptions => ({
  mayDecide: decidesIn(p, { email }),
  mayEdit: (department) => roleCanEdit(departmentRole(p, { email }, department)),
  roleIn: (department) => departmentRole(p, { email }, department),
});

function add(p: DdProject, set: string, values: Record<string, unknown>, made?: string): string {
  const out = addFieldRecord(p, set, values, LEAD);
  assert.deepEqual(out.rejected, [], set);
  // A record of a project whose past is being told: on the record, and each of its values standing, from the day named.
  if (made) {
    out.record!.createdAt = made;
    for (const value of Object.values(out.record!.values)) value.at = made;
  }
  return out.record!.id;
}

/** A lender, and money drawn in July: what brings the loan position into play. */
function funded(p: DdProject): string {
  const facility = add(p, 'finance.lenders.facilities', { name: 'Construction loan', sanctioned_amount: 600_000_000 }, '2026-07-02T06:00:00.000Z');
  add(p, 'finance.lenders.drawdowns', { tranche: 'T0', facility, disbursed_on: '2026-07-02', disbursed_amount: 380_000_000 }, '2026-07-02T06:00:00.000Z');
  return facility;
}

/** A paper on file, by its register row: what an evidence field holds. */
function paper(p: DdProject, title: string): string {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, LEAD);
  row.createdAt = '2026-08-20T06:00:00.000Z';
  return row.id;
}

let shotNo = 0;
function shoot(p: DdProject, date: string, stationId: string, author = 'Asha Rao (asha@firm.example)'): void {
  shotNo += 1;
  const { entry } = logSiteEntry(p, { clientId: `gap-${shotNo}`, date, photos: [{ storageKey: `site_${p.id}_${shotNo}.png`, fileName: `shot-${shotNo}.png`, mimeType: 'image/png', takenAt: `${date}T05:00:00Z`, stationId }] }, author);
  placeEntryShots(p, entry);
}

/** A building, a milestone, and two monthly stations its completion needs. */
function site(): { p: DdProject; slab: string; north: string; stair: string } {
  const p = project('Canal');
  add(p, 'shared.buildings', { name: 'Block A' });
  const [slab] = addMilestones(p, [{ name: 'Slab, level 3', weight: 10 }], LEAD).map((milestone) => milestone.id) as [string];
  const north = add(p, STATIONS_SET, { label: 'North corner', milestone: slab, needed: true, every: 'month' });
  const stair = add(p, STATIONS_SET, { label: 'Stair core', milestone: slab, needed: true, every: 'month' });
  return { p, slab, north, stair };
}

/* ==================================================================== */
/* a. A late issue reads the period's last day                           */
/* ==================================================================== */

describe('a period issued after it ended', () => {
  it('freezes a sheet’s figures as the project stood on the period’s last day, not on the day of issue', () => {
    const p = project();
    funded(p);
    // A second drawdown, recorded on 5 October: October's entry.
    const facility = p.fieldSheets!['finance.lenders.facilities']!.records![0]!.id;
    add(p, 'finance.lenders.drawdowns', { tranche: 'T1', facility, disbursed_on: '2026-10-05', disbursed_amount: 50_000_000 }, '2026-10-05T06:00:00.000Z');
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 380_000_000, outstanding_per_books: 380_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    assert.equal(readSheet(p, POSITION, undefined, undefined, undefined, NOW)!.fields.find((view) => view.def.key === 'drawn')!.held!.value, 430_000_000, 'today the sheet reads both drawdowns');
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    assert.deepEqual([issued.key, issued.to], ['2026-09', '2026-09-30']);
    assert.equal(issued.frozen!.drawn!.value, 380_000_000, 'September carries nothing recorded in October');
    assert.equal(issued.frozen!.drawn!.said, '₹38 Cr');
    assert.equal(issued.frozen!.outstanding_per_statement!.value, 380_000_000, 'and what was typed on the sheet itself is the month’s own entry, whenever it was typed');
    assert.equal(issued.frozen!.drawn!.asNow, undefined, 'the record reaches the month’s end, so nothing is said to be as now');
    assert.equal(frozenAsNowSaid(FIELD_SETS.find((set) => set.id === POSITION)!, issued.frozen), undefined);
    // Read back as issued, it says the same on any later day.
    assert.equal(readSheetPeriod(p, POSITION, '2026-09')!.reading.fields.find((view) => view.def.key === 'drawn')!.text, '₹38 Cr');
  });

  it('marks a figure whose history does not reach the period’s end “as now”, and the issue says which', () => {
    const p = project();
    funded(p);
    // This project's history is whole only from 10 October: what it held on 30 September, the record cannot say.
    p.historyFrom = '2026-10-10T06:00:00.000Z';
    for (const sheet of Object.values(p.fieldSheets!)) for (const record of sheet.records ?? []) for (const value of Object.values(record.values)) value.at = '2026-10-10T06:00:00.000Z';
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 380_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    assert.equal(issued.frozen!.drawn!.value, 380_000_000, 'the figure is frozen all the same');
    assert.equal(issued.frozen!.drawn!.asNow, '2026-10-10', 'marked with the day its history begins');
    assert.match(issued.frozen!.drawn!.footnote ?? '', /As now: no history before 10 Oct 2026\./);
    assert.equal(issued.frozen!.outstanding_per_statement!.asNow, undefined, 'what was typed on the sheet is the period’s own');
    const said = frozenAsNowSaid(FIELD_SETS.find((set) => set.id === POSITION)!, issued.frozen)!;
    assert.match(said, /^\d+ figures as now, no history before 10 Oct 2026: /);
    assert.match(said, /Drawn to date|Drawn/);
    // On the issued sheet as it is read back, the field carries the mark.
    assert.equal(readSheetPeriod(p, POSITION, '2026-09')!.reading.fields.find((view) => view.def.key === 'drawn')!.frozen!.asNow, '2026-10-10');
  });

  it('marks a figure of a module that keeps no past, and reads an issued record’s worked-out fields as at its period’s end', () => {
    const p = project();
    const [frame] = addMilestones(p, [{ name: 'Frame', weight: 1, plannedFinish: '2026-12-31' }], LEAD);
    setMilestonePercent(p, frame!.id, 40, LEAD, '2026-09-20T06:00:00.000Z');
    setMilestonePercent(p, frame!.id, 70, LEAD, '2026-10-10T06:00:00.000Z');
    const QUARTERS = 'legal.rera.progress_quarters';
    const quarter = add(p, QUARTERS, { quarter_ending: '2026-09-30' });
    const record = issuePeriod(p, QUARTERS, quarter, { actor: LEAD }, seat(p, LEAD), undefined, NOW);
    assert.equal(record.frozen!.progress!.value, 40, 'the quarter is issued with what the milestones had reported by its last day');
    assert.equal(record.frozen!.progress!.asNow, undefined);
    // Earned value reads the cost register, which keeps no past: frozen on a sheet issued late, it is the day of issue's and says so.
    const MONTH = 'construction.progress.month';
    setFieldValues(p, { set: MONTH }, { labour_planned: 40 }, LEAD, seat(p, LEAD));
    const month = issueSheetPeriod(p, MONTH, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    const noPast = Object.entries(month.frozen!).filter(([, field]) => field.asNow === AS_NOW_NO_HISTORY);
    for (const [, field] of noPast) assert.match(field.footnote ?? '', /what keeps this figure keeps no history/);
    assert.equal(Object.values(month.frozen!).some((field) => field.asNow && field.asNow !== AS_NOW_NO_HISTORY), false, 'every figure with a past is read as at the month’s end');
  });
});

/* ==================================================================== */
/* b. The first period                                                   */
/* ==================================================================== */

describe('a set nobody has kept by period yet', () => {
  it('says so in one quiet line, asks for nothing, and is due only from the period it is started on', () => {
    const p = project();
    funded(p);
    setFieldValues(p, { set: POSITION }, { account_class: 'standard' }, LEAD, seat(p, LEAD));
    const sheet = (day: Date) => readFunctionFields(p, 'finance.lenders', day).sheets.find((held) => held.set.id === POSITION)!.periods!;
    const before = sheet(NOW);
    assert.equal(before.first!.said, 'No period kept yet · Start with October 2026');
    assert.deepEqual([before.first!.start.key, before.first!.earlier.key], ['2026-10', '2026-09']);
    assert.deepEqual([before.due, before.toIssue, before.notKeptSaid], [undefined, undefined, undefined], 'nothing nags before it is started');
    assert.equal(sheet(at('2027-03-05T06:00:00Z')).due, undefined, 'however long it is left');
    assert.equal(periodsDue(p, at('2027-03-05T06:00:00Z')).some((due) => due.set === POSITION), false);
    assert.throws(() => startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { period: '2026-12', at: NOW }), /has not begun/);
    assert.throws(() => startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { period: '2026-W40', at: NOW }), /kept by the month/);
    assert.equal(startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { at: NOW }).key, '2026-10');
    const started = sheet(NOW);
    assert.deepEqual([started.first, started.shown!.key, started.due, started.toIssue], [undefined, '2026-10', undefined, undefined], 'started on October, September is not asked for');
    assert.equal(startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { at: NOW }).key, '2026-10', 'asked twice, it is started once');
    assert.equal(p.fieldSheets![POSITION]!.periods, undefined);
    // October ends: now it is due, as any period is.
    const next = sheet(at('2026-11-03T06:00:00Z'));
    assert.deepEqual([next.due!.period.key, next.due!.late, next.toIssue!.key], ['2026-10', false, '2026-10']);
    assert.match(next.due!.said, /^October: \d+ of \d+ fields, due 7 Nov 2026$/);
    assert.equal(sheet(at('2026-11-09T06:00:00Z')).due!.late, true);
  });

  it('holds for a set of records too: the line, then one press opens the first period and the cycle begins', () => {
    const p = project();
    const page = (day: Date) => readFunctionFields(p, 'finance.funding', day).sheets.find((held) => held.set.id === CASH_MONTHS)!.periods!;
    assert.equal(page(NOW).first!.said, 'No period kept yet · Start with October 2026');
    assert.equal(page(at('2027-01-05T06:00:00Z')).due, undefined);
    const opened = openPeriod(p, CASH_MONTHS, LEAD, seat(p, LEAD), { period: '2026-09', at: NOW });
    assert.deepEqual([opened.period.key, opened.made], ['2026-09', 1]);
    const after = page(NOW);
    assert.deepEqual([after.first, after.due!.period.key], [undefined, '2026-09'], 'started on September, September is what is due');
  });
});

/* ==================================================================== */
/* c. Carried, read afresh, and waiting for                              */
/* ==================================================================== */

describe('what a new period opens with', () => {
  it('declares, for every set kept by period, a carry list of fields a person fills, with every running total among them', () => {
    for (const set of FIELD_SETS.filter((held) => held.periodic)) {
      const periodic = set.periodic!;
      for (const key of periodic.carry ?? []) {
        const def = set.fields.find((field) => field.key === key);
        assert.ok(def && !fieldIsDerived(def), `${set.id} carries ${key}, which is no field a person fills`);
        assert.notEqual(key, periodic.by, `${set.id} carries the field that names its period`);
      }
      // A total to date only grows: it opens from where it stood.
      for (const key of periodic.cumulative ?? []) assert.ok((periodic.carry ?? []).includes(key), `${set.id}: the running total ${key} is not carried`);
    }
    const carry = (id: string) => FIELD_SETS.find((set) => set.id === id)!.periodic!.carry ?? [];
    // A balance as at a day is read afresh; how the lender classes the account holds.
    assert.deepEqual(carry(POSITION), ['account_class', 'notice_dated', 'reply_by', 'matter']);
    // A month's collections and payments are each month's own.
    assert.deepEqual(carry(CASH_MONTHS), []);
    assert.deepEqual(carry('finance.funding.forecast_weeks'), []);
    // A bank's source, an opening balance, a rate, a party and a name hold.
    assert.deepEqual(carry('finance.funding.cash'), ['figures_from', 'opening_balance', 'gap_cover']);
    assert.deepEqual(carry(CERTIFICATES), ['signed_by', 'membership_no']);
    assert.deepEqual(carry('finance.tax.tds_statements'), ['statement_name']);
    assert.ok(carry('commercial.buyers.collections').includes('lending_rate'));
    assert.deepEqual(carry('finance.funding.rera_years'), ['auditor', 'collected_to_date', 'withdrawn_to_date']);
  });

  it('marks what a sheet carried, and shows last period’s value beside a field that opens blank', () => {
    const p = project();
    funded(p);
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000, outstanding_per_books: 405_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: at('2026-10-05T06:00:00Z') });
    const open = readSheet(p, POSITION, undefined, undefined, undefined, NOW)!;
    const view = (key: string) => open.fields.find((held) => held.def.key === key)!;
    assert.equal(view('account_class').carried, 'September', 'what holds is carried, and says where from');
    assert.equal(view('account_class').last, undefined, 'and is not shown a second time as last period’s');
    assert.equal(view('outstanding_per_statement').state, 'empty', 'a balance opens blank');
    assert.deepEqual(view('outstanding_per_statement').last, { said: '₹41 Cr', from: 'September' }, 'with last month’s beside it');
    assert.deepEqual(view('outstanding_per_books').last, { said: '₹40.5 Cr', from: 'September' });
    assert.equal(view('drawn').last, undefined, 'a worked-out field carries no such line');
    // Typed again, the field is this month's own; last month's stays beside it to compare.
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 432_000_000 }, LEAD, seat(p, LEAD));
    assert.equal(readSheet(p, POSITION, undefined, undefined, undefined, NOW)!.fields.find((held) => held.def.key === 'outstanding_per_statement')!.last!.said, '₹41 Cr');
  });

  it('does the same for a record: carried keys marked, fresh ones blank with the last record’s value beside them', () => {
    const p = project();
    const signer = add(p, 'shared.parties', { name: 'R. Iyer & Co', kind: 'firm' });
    const q1 = add(p, CERTIFICATES, { kind: 'accountant_withdrawal', period_end: '2026-06-30', signed_by: signer, membership_no: 'M-204511', signed_on: '2026-07-10' });
    issuePeriod(p, CERTIFICATES, q1, { actor: LEAD, name: 'R. Iyer' }, seat(p, LEAD), undefined, at('2026-07-12T06:00:00Z'));
    const opened = openPeriod(p, CERTIFICATES, LEAD, seat(p, LEAD), { period: 'FY2026-Q2', at: NOW });
    const reading = readSheet(p, CERTIFICATES, opened.records[0]!.id, undefined, undefined, NOW)!;
    const view = (key: string) => reading.fields.find((held) => held.def.key === key)!;
    assert.equal(view('membership_no').carried, 'Q1 FY 2026-27');
    assert.equal(view('membership_no').text, 'M-204511');
    assert.equal(view('signed_on').state, 'empty');
    assert.deepEqual(view('signed_on').last, { said: '10 Jul 2026', from: 'Q1 FY 2026-27' });
  });

  it('never leaves a worked-out field blank for want of an input: it says which field it waits for', () => {
    const p = project();
    const month = add(p, CASH_MONTHS, { month: '2026-09-01', collections: 100, contractors: 40 });
    const FUNDING_CASH = 'finance.funding.cash';
    add(p, 'shared.accounts', { name: 'Collection account' });
    const before = readSheet(p, FUNDING_CASH, undefined, undefined, undefined, NOW)!.fields.find((view) => view.def.key === 'closing_by_months')!;
    assert.equal(before.held?.value ?? null, null);
    assert.deepEqual(before.waitingFor, ['Opening balance']);
    setFieldValues(p, { set: FUNDING_CASH }, { opening_balance: 1_000 }, LEAD, seat(p, LEAD));
    const after = readSheet(p, FUNDING_CASH, undefined, undefined, undefined, NOW)!.fields.find((view) => view.def.key === 'closing_by_months')!;
    assert.deepEqual([after.held!.value, after.waitingFor], [1_060, undefined]);
    assert.ok(month);
  });
});

/* ==================================================================== */
/* d. Opening a past period                                              */
/* ==================================================================== */

describe('the periods a set has kept', () => {
  it('are listed newest first, each with its status and who issued it, and one is read as issued beside the one before', () => {
    const p = project();
    funded(p);
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 380_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-08', at: at('2026-09-03T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000 }, LEAD, seat(p, LEAD));
    issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: at('2026-10-12T06:00:00Z') });
    const periods = readFunctionFields(p, 'finance.lenders', NOW).sheets.find((held) => held.set.id === POSITION)!.periods!;
    assert.equal(periods.pastSaid, 'September issued by A. Rao · 1 earlier');
    assert.deepEqual(periods.past.map((instance) => [instance.period.key, instance.status, instance.late, periodIssuedSaid(p, instance)]), [
      ['2026-09', 'issued', true, 'September issued by A. Rao'],
      ['2026-08', 'issued', false, 'August issued by A. Rao'],
    ]);
    // One picked: read only, as it was issued.
    const held = readSheetPeriod(p, POSITION, '2026-09')!;
    assert.equal(held.editable, false);
    assert.equal(held.reading.fields.find((view) => view.def.key === 'outstanding_per_statement')!.text, '₹41 Cr');
    // "Compare with the one before": September beside August, field by field.
    const comparison = compareSheetPeriods(p, POSITION, '2026-09', NOW)!;
    assert.deepEqual([comparison.current.period.key, comparison.previous!.period.key], ['2026-09', '2026-08']);
    assert.equal(comparison.fields.find((field) => field.key === 'outstanding_per_statement')!.said, 'Was ₹38 Cr in August; now ₹41 Cr');
    assert.match(comparison.said, /^\d+ of \d+ fields moved since August$/);
  });
});

/* ==================================================================== */
/* e. Being told a period is due                                         */
/* ==================================================================== */

describe('a period that is due', () => {
  const people: TellPerson[] = [
    { email: LEAD, workspaceRole: 'staff' },
    { email: JUNIOR, workspaceRole: 'staff' },
    { email: 'reader@firm.example', workspaceRole: 'viewer' },
  ];

  function owing(): DdProject {
    const p = project();
    add(p, CASH_MONTHS, { month: '2026-09-01', collections: 100 });
    // The junior opened it: named on the set.
    p.fieldSheets![CASH_MONTHS]!.records![0]!.by = JUNIOR;
    return p;
  }

  it('is told to whoever issues the set and whoever opened it, once for the period and for each of them, with no report day set', () => {
    const p = owing();
    assert.equal(p.reportDay?.setting, undefined, 'no report day is set');
    const [due] = periodsDue(p, NOW).filter((held) => held.set === CASH_MONTHS);
    assert.deepEqual(periodDuePeople(p, due!, people).sort(), [LEAD, JUNIOR].sort(), 'the lead who issues it and the junior who opened it; a viewer is told of nothing');
    const written = gatherPeriodsDue(p, people, NOW);
    assert.deepEqual(written.map((notice) => [notice.to, notice.kind, notice.setId, notice.period]).sort(), [[LEAD, 'period_due', CASH_MONTHS, '2026-09'], [JUNIOR, 'period_due', CASH_MONTHS, '2026-09']].sort());
    const line = tellSaid(p, written[0]!)!;
    assert.match(line.title, /^Due: Cash by month, September: \d+ of \d+ fields, (was )?due \d+ \w+ 2026$/);
    assert.equal(line.action, 'Fill what is missing and issue it.');
    assert.deepEqual(gatherPeriodsDue(p, people, NOW), [], 'a second run on the day tells nobody again');
    assert.deepEqual(gatherPeriodsDue(p, people, at('2026-10-20T06:00:00Z')), [], 'nor does one a week later, for the same period');
    // November: October is not opened, so it is October that is due now. Nobody opened it, so it is told to whoever issues it, once in its turn.
    assert.deepEqual(gatherPeriodsDue(p, people, at('2026-11-03T06:00:00Z')).map((notice) => [notice.to, notice.period]), [[LEAD, '2026-10']]);
  });

  it('tells nobody working from a grant, and nobody of a set that owes nothing', () => {
    const p = owing();
    const grant: ProjectGrant = { id: 'g1', tenantId: 't', projectId: p.id, email: 'outside@advocates.example', role: 'contributor', scopeKeys: [], areas: [], grantedBy: LEAD, grantedAt: NOW.toISOString() } as unknown as ProjectGrant;
    const outside: TellPerson = { email: 'outside@advocates.example', workspaceRole: 'collaborator', copy: projectView(p, { kind: 'granted', grant, email: 'outside@advocates.example' }).project };
    assert.deepEqual(gatherPeriodsDue(p, [outside], NOW), []);
    assert.deepEqual(gatherPeriodsDue(project('Quiet'), people, NOW), [], 'a project that keeps no set by period is told of none');
  });

  it('is written by the daily job, which is safe to run twice and leaves a project that owes nothing unwritten', async () => {
    const [p, quiet] = [owing(), project('Quiet')];
    const saved: string[] = [];
    const source: PeriodsDueSource = { ids: () => [p.id, quiet.id, 'gone'], fresh: async (id) => [p, quiet].find((held) => held.id === id), people: () => people, save: async (held) => void saved.push(held.id) };
    assert.deepEqual(await periodsDueSweep(NOW, source), { projects: 2, told: 1, notices: 2, failed: 0 });
    assert.deepEqual(saved, [p.id]);
    assert.deepEqual(await periodsDueSweep(NOW, source), { projects: 2, told: 0, notices: 0, failed: 0 }, 'run twice, it writes nothing the second time');
    assert.deepEqual(saved, [p.id]);
    // A write that fails leaves the project as storage has it, and the next run writes the same notices.
    const again = owing();
    const failing: PeriodsDueSource = { ...source, ids: () => [again.id], fresh: async () => again, save: async () => Promise.reject(new Error('storage is down')) };
    assert.deepEqual(await periodsDueSweep(NOW, failing), { projects: 1, told: 0, notices: 0, failed: 1 });
    assert.equal(again.tell?.notices?.length ?? 0, 0);
  });

  it('counts the photograph round among them: the stations not photographed this period are one line of kind due', () => {
    const { p, north } = site();
    shoot(p, '2026-10-02', north);
    const due = stationRoundDue(p, NOW)!;
    assert.deepEqual([due.set, due.period.key, due.late, due.said], [STATION_ROUND_SET, '2026-10', false, 'October: 1 of 2 stations photographed, due 31 Oct 2026']);
    const page = readFunctionFields(p, 'construction.site', NOW);
    assert.deepEqual(page.needs.due_soon.map((line) => [line.kind, line.text]), [['due', 'October: 1 of 2 stations photographed, due 31 Oct 2026']]);
    assert.equal(page.exceptions.filter((line) => line.kind === 'rule' && /no photograph this period/.test(line.text)).length, 0, 'and it is no rule’s line as well');
    assert.equal(periodsDue(p, NOW).some((held) => held.set === STATION_ROUND_SET), true);
    // A station a whole period behind makes the round late.
    assert.deepEqual([stationRoundDue(p, at('2026-12-03T06:00:00Z'))!.late, readFunctionFields(p, 'construction.site', at('2026-12-03T06:00:00Z')).needs.failing.filter((line) => line.kind === 'due').length], [true, 1]);
  });
});

/* ==================================================================== */
/* One notion of a period, and photographs as at a past one              */
/* ==================================================================== */

describe('a station’s photographs as at a past period', () => {
  it('reads the round, the series and the report section as they stood, and prints a past period’s shot beside the one before', () => {
    const { p, north, stair } = site();
    shoot(p, '2026-08-20', north);
    shoot(p, '2026-09-18', north);
    shoot(p, '2026-10-07', north);
    shoot(p, '2026-09-25', stair);
    // As at the end of September, October's shot had not been taken.
    const then = stationRound(p, asAtMoment('2026-09-30'));
    assert.deepEqual(then.rows.map((row) => [row.station.label, row.period.key, row.standing, row.lastDay]), [['North corner', '2026-09', 'shot', '2026-09-18'], ['Stair core', '2026-09', 'shot', '2026-09-25']]);
    assert.equal(stationRoundDue(p, asAtMoment('2026-09-30')), undefined);
    assert.equal(stationRound(p, NOW).rows.find((row) => row.station.id === stair)!.standing, 'due');
    const station = photoStations(p).find((held) => held.id === north)!;
    const shots = stationShots(station, projectShots(p));
    assert.deepEqual(photoSeries(shots, 'month', undefined, '2026-09-30').map((group) => group.period.key), ['2026-09', '2026-08']);
    assert.deepEqual(photoSeries(shots, 'month').map((group) => group.period.key), ['2026-10', '2026-09', '2026-08']);
    // A section read as at 30 September prints September beside August, whatever was shot since.
    const block = resolveStationPhotos(p, { kind: 'station_photographs', asAt: '2026-09-30', photos: { show: 'period_and_last', most: 12, stations: [north] } }, NOW);
    assert.deepEqual(block.table!.rows.map((row) => [row.cells[2], row.cells[3], row.cells[4]]), [['August 2026', '20 Aug 2026', 'Asha Rao'], ['September 2026', '18 Sep 2026', 'Asha Rao']]);
    assert.equal(block.note, '1 of 1 station photographed in September 2026.');
    // And the monthly progress report made for September carries the section as at its last day.
    const report = generateReport(p, { kind: 'function', template: 'construction.progress.report', generatedBy: LEAD, period: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } }, LEAD);
    const photos = report.body.blocks.find((held) => held.source?.kind === 'station_photographs')!;
    assert.ok(functionReportTemplate('construction.progress.report'));
    assert.equal(photos.source!.asAt, '2026-09-30');
    assert.deepEqual([...new Set(resolveReportBlock(p, photos).table!.rows.map((row) => row.cells[2]))], ['August 2026', 'September 2026']);
  });
});

/* ==================================================================== */
/* f. A milestone and the photographs it needs                           */
/* ==================================================================== */

describe('a milestone that names required photographs', () => {
  it('is not marked complete while a station it needs has no shot this period, and says which', () => {
    const { p, slab, north } = site();
    shoot(p, '2026-10-02', north);
    assert.throws(
      () => markMilestonePercent(p, slab, 100, JUNIOR, { now: NOW }),
      (err: unknown) => err instanceof MilestonePhotosWanting && err.stations.join() === 'Stair core' && /^Slab, level 3 is not marked complete: its required photograph is not taken this period \(Stair core\)\./.test(err.message),
    );
    assert.equal(p.milestones![0]!.percent, 0, 'nothing is written');
    assert.equal(markMilestonePercent(p, slab, 90, JUNIOR, { now: NOW }).percent, 90, 'short of complete, it is marked as it always was');
    // The photograph is taken: now it completes.
    shoot(p, '2026-10-12', photoStations(p).find((station) => station.label === 'Stair core')!.id);
    const done = markMilestonePercent(p, slab, 100, JUNIOR, { now: NOW });
    assert.deepEqual([done.percent, done.photoWaiver], [100, undefined]);
    assert.equal(milestonePhotoStanding(milestonePhotoChecklist(p, NOW)[0]), 'complete, photographs taken');
  });

  it('is completed without them only by a pick from the list, made by somebody who may accept in Construction', () => {
    const { p, slab } = site();
    assert.throws(() => markMilestonePercent(p, slab, 100, JUNIOR, { now: NOW, waiver: 'no_access', mayWaive: false }), /picked by a lead or a signer of Construction/);
    assert.throws(() => markMilestonePercent(p, slab, 100, LEAD, { now: NOW, waiver: 'because I say so', mayWaive: true }), /Pick why from the list/);
    assert.equal(p.milestones![0]!.percent, 0);
    assert.ok(MILESTONE_PHOTO_WAIVERS.length <= 6, 'a short list');
    const done = markMilestonePercent(p, slab, 100, LEAD, { now: NOW, waiver: 'no_access', mayWaive: true });
    assert.deepEqual([done.percent, done.photoWaiver!.reason, done.photoWaiver!.by], [100, 'no_access', LEAD]);
    assert.equal(Object.keys(done.photoWaiver!).sort().join(), 'at,by,reason', 'a pick, who and when: no sentence is kept');
    const [check] = milestonePhotoChecklist(p, NOW);
    assert.equal(milestonePhotoStanding(check), 'complete, photographs waived: No access to the place');
    assert.deepEqual(milestonesShortOfPhotos([check!]), [], 'waived, it is short of nothing');
    assert.equal(p.audit.at(-1)!.action, 'milestone_photo_waiver');
    // Reopened, the waiver goes with the completion it was for.
    assert.equal(markMilestonePercent(p, slab, 80, LEAD, { now: NOW }).photoWaiver, undefined);
  });

  it('reads “complete, photographs wanting” where it was completed before this rule, or reported complete from site', () => {
    const { p, slab } = site();
    // As the record was written before the rule: complete, with no photograph.
    setMilestonePercent(p, slab, 100, LEAD, '2026-09-28T06:00:00.000Z');
    const [check] = milestonePhotoChecklist(p, NOW);
    assert.equal(milestonePhotoStanding(check), 'complete, photographs wanting');
    assert.equal(milestonesShortOfPhotos([check!]).length, 1);
    assert.equal(readFunctionFields(p, 'construction.site', NOW).needs.failing.some((line) => /required photograph/.test(line.text)), true, 'and it is a line under Failing on the Site record');
    // A lead picks why for the completion already made.
    markMilestonePercent(p, slab, 100, LEAD, { now: NOW, waiver: 'covered', mayWaive: true });
    assert.equal(milestonePhotoStanding(milestonePhotoChecklist(p, NOW)[0]), 'complete, photographs waived: The work was covered before it could be shot');
    assert.equal(p.milestones![0]!.completedOn, '2026-09-28', 'the day it was completed stands');
  });

  it('is marked as before where it names no required photograph', () => {
    const p = project('Plain');
    const [m] = addMilestones(p, [{ name: 'Plinth', weight: 1 }], LEAD);
    assert.equal(markMilestonePercent(p, m!.id, 100, JUNIOR, { now: NOW }).percent, 100);
  });
});

/* ==================================================================== */
/* g. A first period with several instances                              */
/* ==================================================================== */

describe('a first period on a set that keeps several instances a period', () => {
  it('opens a row for each kind the set declares, never one blank row with no kind', () => {
    const p = project();
    const opened = openPeriod(p, CERTIFICATES, LEAD, seat(p, LEAD), { period: 'FY2026-Q2', at: NOW });
    const kinds = opened.records.map((record) => record.values.kind!.value);
    assert.ok(kinds.length >= 2);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.equal(kinds.every((kind) => typeof kind === 'string' && kind), true);
    assert.deepEqual(periodsOf(p, CERTIFICATES, NOW).map((instance) => instance.period.key), kinds.map(() => 'FY2026-Q2'));
    assert.equal(periodsOf(p, CERTIFICATES, NOW).every((instance) => instance.perSaid), true, 'each row says which certificate it is');
    assert.equal(openPeriod(p, CERTIFICATES, LEAD, seat(p, LEAD), { period: 'FY2026-Q2', at: NOW }).made, 0, 'asked twice, nothing is made twice');
  });

  it('opens a row for each building, and one blank row where the project keeps no building yet', () => {
    const p = project();
    const none = openPeriod(p, ARCHITECT, LEAD, seat(p, LEAD), { period: 'FY2026-Q1', at: NOW });
    assert.equal(none.made, 1, 'no building on the project: one row, to be said which');
    const q = project('Towers');
    const [a, b] = [add(q, 'shared.buildings', { name: 'Tower A' }), add(q, 'shared.buildings', { name: 'Tower B' })];
    const opened = openPeriod(q, ARCHITECT, LEAD, seat(q, LEAD), { period: 'FY2026-Q2', at: NOW });
    assert.deepEqual(opened.records.map((record) => record.values.building!.value).sort(), [a, b].sort());
    assert.deepEqual(periodsOf(q, ARCHITECT, NOW).map((instance) => instance.perSaid).sort(), ['Tower A', 'Tower B']);
    // The next quarter opens from these, a row for each, as before.
    assert.equal(openPeriod(q, ARCHITECT, LEAD, seat(q, LEAD), { period: 'FY2026-Q3', at: NOW }).made, 2);
  });
});

/* ==================================================================== */
/* h. Names, not addresses                                               */
/* ==================================================================== */

describe('a line that says who typed, accepted or issued something', () => {
  it('prints the name the team gives them, else the name part of their address, never the address', () => {
    const p = project();
    assert.equal(personSaid(p, LEAD), 'A. Rao');
    assert.equal(personSaid(p, 'A.RAO@firm.example'), 'A. Rao');
    assert.equal(personSaid(p, JUNIOR), 'junior', 'no name on the team: the name part');
    assert.equal(personSaid(p, 'Asha Rao (asha@firm.example)'), 'Asha Rao', 'a name with its address beside it is the name');
    assert.equal(personSaid(p, 'Realytica'), 'Realytica');
    assert.equal(personSaid(p, undefined), '');
    funded(p);
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 380_000_000, account_class: 'standard' }, JUNIOR, seat(p, JUNIOR));
    const view = readSheet(p, POSITION, undefined, undefined, undefined, NOW)!.fields.find((held) => held.def.key === 'outstanding_per_statement')!;
    assert.equal(view.source!.label, 'junior', 'who typed a value');
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    assert.match(issued.frozen!.outstanding_per_statement!.footnote!, /^Entered by junior on /);
    const everything = JSON.stringify([issued.frozen, readFunctionFields(p, 'finance.lenders', NOW).sheets.map((sheet) => [sheet.periods?.pastSaid, sheet.reading?.fields.map((held) => [held.source?.label, held.past?.line])])]);
    assert.equal(/@firm\.example/.test(everything), false, 'no line of the sheet, its history or its issue prints an address');
    assert.match(readFunctionFields(p, 'finance.lenders', NOW).sheets.find((sheet) => sheet.set.id === POSITION)!.periods!.pastSaid!, /issued by A\. Rao$/);
  });
});

/* ==================================================================== */
/* i. The Word file prints the site log's photographs                    */
/* ==================================================================== */

describe('the photographs a report’s table prints', () => {
  it('are the filed ones and the ones still in the site log, each under its station, period and day', () => {
    const { p, north, stair } = site();
    shoot(p, '2026-10-07', north);
    // The stair's shot is filed on the register.
    const row = addEvidence(p, { title: 'Stair core, October', kind: 'photograph', status: 'received' }, LEAD);
    attachEvidenceFile(p, row.id, { fileName: 'stair.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'doc_stair.jpg', capture: { takenAt: '2026-10-09T05:00:00Z', takenAtSource: 'stated', stationId: stair } }, LEAD);
    const block = resolveStationPhotos(p, { kind: 'station_photographs', photos: { show: 'period', most: 12 } }, NOW);
    assert.deepEqual(block.table!.columns, [...STATION_PHOTO_COLUMNS]);
    const photos = reportTablePhotos(p, block.table!);
    assert.equal(photos.length, 2, 'both stations’ photographs are printed');
    const [fromSite, filed] = [photos.find((photo) => photo.sitePhoto)!, photos.find((photo) => photo.evidenceId)!];
    assert.equal(fromSite.caption, 'North corner, October 2026: 7 Oct 2026 · Asha Rao');
    assert.equal(typeof fromSite.sitePhoto!.entryId, 'string');
    assert.deepEqual([filed.evidenceId, filed.mimeType, filed.caption.startsWith('Stair core, October 2026: 9 Oct 2026')], [row.id, 'image/jpeg', true]);
    // A station with no shot of the period has no photograph to print, and its row says so.
    const quiet = resolveStationPhotos(p, { kind: 'station_photographs', asAt: '2026-08-31', photos: { show: 'period', most: 12 } }, NOW);
    assert.deepEqual([reportTablePhotos(p, quiet.table!).length, quiet.table!.rows.every((held) => held.cells[3] === 'Not photographed')], [0, true]);
  });
});

/* ==================================================================== */
/* j. Across projects                                                    */
/* ==================================================================== */

describe('the view across projects', () => {
  it('reads the schedule month by month, planned against made, as a series of periods', () => {
    const p = project('Curve');
    const [structure] = addMilestones(p, [{ name: 'Structure', weight: 1, plannedFinish: '2026-12-31' }], LEAD);
    structure!.plannedStart = '2026-07-01';
    setMilestonePercent(p, structure!.id, 20, LEAD, '2026-08-20T06:00:00.000Z');
    setMilestonePercent(p, structure!.id, 45, LEAD, '2026-09-25T06:00:00.000Z');
    const made = periodSeries(p, { set: 'construction.progress.programme', field: 'actual_percent' }, NOW);
    assert.deepEqual(made.filter((point) => point.period.key >= '2026-08' && point.period.key <= '2026-10').map((point) => [point.period.key, point.value, point.status]), [['2026-08', 20, 'issued'], ['2026-09', 45, 'issued'], ['2026-10', 45, 'open']]);
    const [line] = acrossProjects([p], NOW).schedule.lines;
    assert.equal(line!.curve!.at(-1)!.key, '2026-10', 'the months that have begun, and none of the plan still ahead');
    assert.deepEqual([line!.curve!.find((point) => point.key === '2026-09')!.actual, typeof line!.curve!.find((point) => point.key === '2026-09')!.planned], [45, 'number']);
    assert.match(line!.curveSaid!, /^October 2026: 45% made against [\d.]+% planned$/);
  });

  it('reads units sold week by week where the week’s stock has been issued, and says nothing of a project that keeps none', () => {
    const p = project('Sold');
    for (const [number, sold] of [['A-101', true], ['A-102', true], ['A-103', false]] as const) add(p, 'shared.units', { number, sale_released: true, ...(sold ? { sale_allotment_letter: [paper(p, `Allotment letter ${number}`)], sale_allotted_on: '2026-08-20' } : {}) }, '2026-09-01T06:00:00.000Z');
    assert.equal(readSheet(p, STOCK, undefined, undefined, undefined, NOW)!.fields.find((view) => view.def.key === 'units_sold')!.held!.value, 2);
    const quiet = project('Unsold');
    assert.deepEqual(acrossProjects([p, quiet], NOW).sales.lines, [], 'nothing issued yet: a count with no past is no series');
    // The week that ended on 11 October is issued; a third unit is allotted since.
    issueSheetPeriod(p, STOCK, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    const third = p.fieldSheets!['shared.units']!.records!.find((record) => record.values.number!.value === 'A-103')!;
    assert.deepEqual(setFieldValues(p, { set: 'shared.units', record: third.id }, { sale_allotment_letter: [paper(p, 'Allotment letter A-103')], sale_allotted_on: '2026-10-12' }, LEAD, seat(p, LEAD)).rejected, []);
    const lines = acrossProjects([p, quiet], NOW).sales.lines;
    assert.deepEqual(lines.map((line) => line.projectName), ['Sold'], 'and nothing is said of a project that keeps no stock by period');
    assert.deepEqual(lines[0]!.points.map((point) => [point.key, point.value, point.open]), [['2026-W41', 2, false], ['2026-W42', 3, true]]);
    assert.deepEqual([lines[0]!.sold, lines[0]!.movement, lines[0]!.previousLabel], [3, 1, 'Week of 5 Oct 2026']);
  });

  it('is cut with the project it is read from: a copy that holds no stock sheet gives no sales line', () => {
    const p = project('Cut');
    add(p, 'shared.units', { number: 'B-1', sale_released: true, sale_allotment_letter: [paper(p, 'Allotment letter B-1')], sale_allotted_on: '2026-08-20' }, '2026-09-01T06:00:00.000Z');
    issueSheetPeriod(p, STOCK, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    const whole = acrossProjects([p], NOW).sales.lines.length;
    const grant = { id: 'g2', tenantId: 't', projectId: p.id, email: 'advocate@outside.example', role: 'contributor', scopeKeys: ['legal'], areas: [], grantedBy: LEAD, grantedAt: NOW.toISOString() } as unknown as ProjectGrant;
    const copy = projectView(p, { kind: 'granted', grant, email: 'advocate@outside.example' }).project;
    assert.equal(copy.fieldSheets?.[STOCK], undefined, 'Commercial’s stock is not on an advocate’s copy');
    assert.deepEqual([whole, acrossProjects([copy], NOW).sales.lines.length], [1, 0]);
    // And as at a past day, the copy is read as the project is.
    assert.equal(projectAsAt(copy, '2026-09-30').fieldSheets?.[STOCK], undefined);
  });
});

/* ==================================================================== */
/* Four more, reported by the builder of tracking                         */
/* ==================================================================== */

describe('what a period holds is decided by the day each entry describes', () => {
  /** July's drawdown, then one disbursed on 28 September that reaches the record on 3 October. */
  function late(): DdProject {
    const p = project();
    const facility = funded(p);
    add(p, 'finance.lenders.drawdowns', { tranche: 'T1', facility, disbursed_on: '2026-09-28', disbursed_amount: 50_000_000 }, '2026-10-03T06:00:00.000Z');
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 430_000_000, outstanding_per_books: 430_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    return p;
  }

  it('puts a September drawdown entered on 3 October in September as issued', () => {
    const p = late();
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { at: NOW });
    assert.equal(issued.key, '2026-09');
    assert.equal(issued.frozen!.drawn!.value, 430_000_000, 'the drawdown was disbursed in September, whenever it was typed');
    assert.equal(issued.frozen!.drawn!.said, '₹43 Cr');
    // As the record stood on 30 September it was not there: that is a different question, and is answered as before.
    assert.equal(projectAsAt(p, '2026-09-30').fieldSheets!['finance.lenders.drawdowns']!.records!.length, 1);
    assert.equal(projectAsOfPeriod(p, '2026-09-30').fieldSheets!['finance.lenders.drawdowns']!.records!.length, 2);
  });

  it('leaves out an entry that describes a later day, though it was typed before the period ended', () => {
    const p = project();
    const facility = funded(p);
    add(p, 'finance.lenders.drawdowns', { tranche: 'T1', facility, disbursed_on: '2026-10-05', disbursed_amount: 50_000_000 }, '2026-09-29T06:00:00.000Z');
    assert.equal(projectAsOfPeriod(p, '2026-09-30').fieldSheets!['finance.lenders.drawdowns']!.records!.length, 1);
  });

  it('falls back to when it was recorded for an entry with no date of its own', () => {
    const p = project();
    const facility = funded(p);
    // Planned, not yet disbursed: no day it describes.
    add(p, 'finance.lenders.drawdowns', { tranche: 'T2', facility, planned_on: '2026-09-15', planned_amount: 20_000_000 }, '2026-10-03T06:00:00.000Z');
    add(p, 'finance.lenders.drawdowns', { tranche: 'T3', facility, planned_on: '2026-11-15', planned_amount: 20_000_000 }, '2026-09-10T06:00:00.000Z');
    const tranches = projectAsOfPeriod(p, '2026-09-30').fieldSheets!['finance.lenders.drawdowns']!.records!.map((record) => record.values.tranche!.value);
    assert.deepEqual(tranches, ['T0', 'T3'], 'the one recorded by then is there, the one recorded after is not');
  });

  it('holds the rows of a dated table by their own day: a September receipt typed in October is September’s', () => {
    const p = project();
    const unit = add(p, 'shared.units', { number: 'A-501' }, '2026-08-01T06:00:00.000Z');
    const demand = add(p, 'commercial.buyers.demands', { demand_no: 'D-1', unit, raised_on: '2026-09-01', due_on: '2026-09-15', principal: 1_000_000, settled_by: [{ receipt_no: 'R-1', received_on: '2026-09-10', amount: 400_000, mode: null }] }, '2026-09-10T06:00:00.000Z');
    const record = p.fieldSheets!['commercial.buyers.demands']!.records!.find((held) => held.id === demand)!;
    assert.ok(Array.isArray(record.values.settled_by?.value), 'the demand holds its receipts');
    // On 4 October two more receipts are typed: one received on 29 September, one on 2 October.
    const out = setFieldValues(p, { set: 'commercial.buyers.demands', record: demand }, { settled_by: [{ receipt_no: 'R-1', received_on: '2026-09-10', amount: 400_000, mode: null }, { receipt_no: 'R-2', received_on: '2026-09-29', amount: 300_000, mode: null }, { receipt_no: 'R-3', received_on: '2026-10-02', amount: 100_000, mode: null }] }, LEAD, seat(p, LEAD));
    assert.deepEqual(out.rejected, []);
    record.values.settled_by!.at = '2026-10-04T06:00:00.000Z';
    const rows = (view: DdProject) => (view.fieldSheets!['commercial.buyers.demands']!.records!.find((held) => held.id === demand)!.values.settled_by!.value as Array<{ receipt_no: string }>).map((row) => row.receipt_no);
    assert.deepEqual(rows(projectAsOfPeriod(p, '2026-09-30')), ['R-1', 'R-2']);
    // A table keeps no past rows, so the issuer is told the table changed since and how many of its rows are September's.
    assert.deepEqual(enteredAfterPeriod(p, { from: '2026-09-01', to: '2026-09-30' }).map((entry) => entry.said), ['Demands: D-1, receipts set against this demand: 2 rows, the latest, dated 29 Sep 2026, entered 4 Oct 2026']);
  });

  it('lists for whoever issues the period what was entered after it ended, and nothing where nothing was', () => {
    const p = late();
    assert.deepEqual(
      enteredAfterPeriod(p, { from: '2026-09-01', to: '2026-09-30' }).map((entry) => [entry.said, entry.day, entry.enteredOn]),
      [['Drawdowns: T1, dated 28 Sep 2026, entered 3 Oct 2026', '2026-09-28', '2026-10-03']],
    );
    assert.deepEqual(enteredAfterPeriod(p, { from: '2026-08-01', to: '2026-08-31' }), []);
  });
});

describe('a period just opened', () => {
  it('does not say fields moved when they are merely blank: moved counts only fields with a value in both periods', () => {
    const p = project();
    add(p, CASH_MONTHS, { month: '2026-09-01', collections: 41_000_000, contractors: 30_000_000, taxes: 1_000_000 });
    const october = openPeriod(p, CASH_MONTHS, LEAD, seat(p, LEAD), { period: '2026-10', at: NOW }).records[0]!;
    const opened = comparePeriods(p, CASH_MONTHS, october.id, undefined, NOW);
    assert.equal(opened.moved, 0);
    assert.doesNotMatch(opened.said, /fields? moved since/);
    assert.equal(opened.said, 'Nothing entered for October yet to set beside September');
    for (const field of opened.fields) assert.equal(field.moved, false, field.key);
    // One figure typed: it is the one field with a value in both, and it has moved.
    setFieldValues(p, { set: CASH_MONTHS, record: october.id }, { collections: 43_000_000 }, LEAD, seat(p, LEAD));
    const typed = comparePeriods(p, CASH_MONTHS, october.id, undefined, NOW);
    assert.equal(typed.fields.find((field) => field.key === 'collections')!.moved, true);
    assert.equal(typed.fields.find((field) => field.key === 'contractors')!.moved, false);
    assert.match(typed.said, /^\d+ of \d+ fields moved since September$/);
    const [moved, of] = typed.said.match(/\d+/g)!.map(Number);
    assert.ok(of! < typed.fields.length, 'the fields blank in October are not among those that could have moved');
    assert.ok(moved! <= of!);
  });
});

describe('a sheet started on the current month', () => {
  it('can still keep the month before: it is opened beside the sheet, filled, and issued in its turn', () => {
    const p = project();
    funded(p);
    setFieldValues(p, { set: POSITION }, { account_class: 'standard' }, LEAD, seat(p, LEAD));
    startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { at: NOW });
    const periods = () => readFunctionFields(p, 'finance.lenders', NOW).sheets.find((held) => held.set.id === POSITION)!.periods!;
    assert.equal(periods().alsoKeep!.key, '2026-09', 'offered as “Also keep September”');
    assert.throws(() => startSheetPeriod(p, POSITION, JUNIOR, { ...seat(p, JUNIOR), mayEdit: () => false }, { period: '2026-09', at: NOW }), /reads this department/);
    assert.equal(startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { period: '2026-09', at: NOW }).key, '2026-09');
    assert.equal(startSheetPeriod(p, POSITION, LEAD, seat(p, LEAD), { period: '2026-09', at: NOW }).key, '2026-09');
    assert.equal(p.fieldSheets![POSITION]!.periods!.length, 1, 'asked twice, it is opened once');
    assert.equal(p.fieldSheets![POSITION]!.open!.key, '2026-10', 'the sheet stays on October');
    assert.equal(periods().alsoKeep!.key, '2026-08', 'and the month before that can be kept in the same way');
    // September is filled as an open period is, and issued under a name.
    const out = setFieldValues(p, { set: POSITION, period: '2026-09' }, { outstanding_per_statement: 380_000_000, outstanding_per_books: 380_000_000, account_class: 'standard' }, LEAD, seat(p, LEAD));
    assert.deepEqual(out.rejected, []);
    const issued = issueSheetPeriod(p, POSITION, { actor: LEAD }, seat(p, LEAD), { period: '2026-09', at: NOW });
    assert.deepEqual([issued.key, issued.status, issued.frozen!.drawn!.value], ['2026-09', 'issued', 380_000_000]);
    assert.equal(p.audit.at(-1)!.newValue, 'Loan position, September 2026', 'a first issue is not called a revision');
    assert.equal(p.fieldSheets![POSITION]!.open!.key, '2026-10', 'and October goes on, with what it holds');
    assert.equal(readSheet(p, POSITION, undefined, undefined, undefined, NOW)!.fields.find((view) => view.def.key === 'account_class')!.held!.value, 'standard');
  });

  it('is offered the month before on a set of records too, and opens it', () => {
    const p = project();
    openPeriod(p, CASH_MONTHS, LEAD, seat(p, LEAD), { period: '2026-10', at: NOW });
    const periods = () => readFunctionFields(p, 'finance.funding', NOW).sheets.find((held) => held.set.id === CASH_MONTHS)!.periods!;
    assert.equal(periods().alsoKeep!.key, '2026-09');
    const opened = openPeriod(p, CASH_MONTHS, LEAD, seat(p, LEAD), { period: '2026-09', at: NOW });
    assert.equal(opened.made, 1);
    assert.equal(periods().alsoKeep!.key, '2026-08');
  });
});

describe('the photograph round with stations on different intervals', () => {
  it('names, for each interval, how many stations wait and the day that round is due', () => {
    const p = project('Quarry');
    add(p, STATIONS_SET, { label: 'Gate', every: 'week' });
    add(p, STATIONS_SET, { label: 'Tower crane', every: 'week' });
    add(p, STATIONS_SET, { label: 'North corner', every: 'month' });
    add(p, STATIONS_SET, { label: 'Panorama', every: 'quarter' });
    assert.equal(stationRoundDue(p, NOW)!.said, '4 of 4 stations to photograph: 2 by the week, due 18 Oct 2026; 1 by the month, due 31 Oct 2026; 1 by the quarter, due 31 Dec 2026');
  });
});
