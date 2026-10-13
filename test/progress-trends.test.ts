/**
 * Progress over time, and a field drawn over time (docs/fields.md, Progress
 * and Trends).
 *
 * - Planned progress is worked out from each milestone's planned start and
 *   finish by its weight, and typed by nobody.
 * - A milestone's readings are thinned to month-ends past a hundred and
 *   twenty days, never dropped.
 * - Planned against actual is drawn month by month from those readings.
 * - Earned value is there only where every milestone is tied to a work
 *   package with a budget.
 * - RERA's quarterly progress is a row a building a quarter, every figure
 *   worked out as at the quarter's end.
 * - A field declares how it is drawn over time, in four forms and no more;
 *   `moved` says how far a figure has come since the last period or a number
 *   of days; a threshold is an ordinary status over it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  READINGS_KEPT_DAYS,
  actualPercentOn,
  addFieldRecord,
  addMilestones,
  addWorkPackages,
  buildFieldCatalog,
  catalogFaults,
  createProject,
  earnedValue,
  fieldTrend,
  issuePeriod,
  issueSheetPeriod,
  plannedFraction,
  plannedPercent,
  progressCurve,
  readFunctionFields,
  readSheet,
  resolveFields,
  setFieldValues,
  setMilestonePercent,
  setTeamMember,
  stand,
  thinReadings,
  type CheckFieldValue,
  type DdProject,
  type FieldSet,
} from '@realytica/shared';

const LEAD = 'lead@firm.example';
const PROGRAMME = 'construction.progress.programme';
const MONTH = 'construction.progress.month';
const QUARTERS = 'legal.rera.progress_quarters';
const at = (iso: string) => new Date(iso);
const typed = (value: CheckFieldValue['value'], when: string): CheckFieldValue => ({ value, at: when, by: LEAD, state: 'typed', origin: { kind: 'person' } });

function project(): DdProject {
  const p = createProject({ name: 'Lakeside', type: 'residential', location: 'Whitefield', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-PRG');
  p.jurisdiction = 'Karnataka';
  p.createdAt = '2026-01-01T04:00:00.000Z';
  p.historyFrom = '2026-01-01T04:00:00.000Z';
  setTeamMember(p, { email: LEAD, name: 'A. Rao', departments: { construction: 'lead', legal: 'lead', finance: 'lead', commercial: 'lead' } }, 'owner');
  return p;
}

/** Two milestones: foundations (weight 1) from 1 June to 30 June, structure (weight 3) from 1 July to 30 October. */
function scheduled(): DdProject {
  const p = project();
  const [foundations, structure] = addMilestones(p, [{ name: 'Foundations', weight: 1, plannedFinish: '2026-06-30' }, { name: 'Structure', weight: 3, plannedFinish: '2026-10-29' }], LEAD);
  foundations!.plannedStart = '2026-06-01';
  structure!.plannedStart = '2026-07-01';
  return p;
}
const report = (p: DdProject, name: string, on: string, percent: number) => setMilestonePercent(p, p.milestones!.find((m) => m.name === name)!.id, percent, LEAD, `${on}T09:00:00.000Z`, on);

describe('planned progress, worked out from the milestones’ dates', () => {
  it('is none before a milestone starts, all of it from its planned finish, and a straight line between', () => {
    const milestone = { plannedStart: '2026-07-01', plannedFinish: '2026-07-11' };
    assert.deepEqual(['2026-06-30', '2026-07-01', '2026-07-06', '2026-07-10', '2026-07-11', '2026-08-01'].map((day) => plannedFraction(milestone, day)), [0, 0, 0.5, 0.9, 1, 1]);
    assert.deepEqual(['2026-07-10', '2026-07-11'].map((day) => plannedFraction({ plannedFinish: '2026-07-11' }, day)), [0, 1], 'with no planned start it is a step at the finish');
    assert.equal(plannedFraction({}, '2026-07-11'), undefined);
  });

  it('is the milestones’ planned shares by their weights, at each boundary', () => {
    const p = scheduled();
    assert.equal(plannedPercent(p, '2026-05-31'), 0);
    assert.equal(plannedPercent(p, '2026-06-30'), 25, 'foundations planned done: a quarter of the weight');
    assert.equal(plannedPercent(p, '2026-08-30'), 62.5, 'and structure half way through its hundred and twenty days');
    assert.equal(plannedPercent(p, '2026-10-29'), 100);
    assert.equal(plannedPercent(p, '2027-01-01'), 100);
  });

  it('gives no figure while a milestone has no planned finish, and none with no milestones', () => {
    const p = scheduled();
    addMilestones(p, [{ name: 'Finishes', weight: 2 }], LEAD);
    assert.equal(plannedPercent(p, '2026-08-30'), null, 'a plan with a hole in it has no planned percent, never a low one');
    assert.equal(plannedPercent(project(), '2026-08-30'), null);
  });

  it('is what the programme sheet shows as planned, with nobody typing it', () => {
    const p = scheduled();
    const def = FIELD_SETS.find((set) => set.id === PROGRAMME)!.fields.find((field) => field.key === 'planned_percent')!;
    assert.deepEqual([def.kind, def.sameAs], ['computed', undefined], 'no longer a mirror of a figure somebody types on a check');
    const planned = resolveFields(p, at('2026-08-30T10:00:00Z')).read({ fn: 'construction.progress', set: PROGRAMME, field: 'planned_percent' });
    assert.equal(planned!.value, 62.5);
    assert.equal(setFieldValues(p, { set: PROGRAMME }, { planned_percent: 70 }, LEAD).rejected.length, 1, 'and it takes no typed value');
  });
});

describe('a milestone’s readings', () => {
  it('are all kept for a hundred and twenty days, and past that the first and each month’s last', () => {
    const daily = (from: string, days: number) => Array.from({ length: days }, (_, index) => ({ on: new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10), percent: Math.min(100, index / 4) }));
    const all = daily('2026-01-05', 300);
    const today = all.at(-1)!.on;
    const kept = thinReadings(all, today);
    const cut = new Date(Date.parse(`${today}T00:00:00Z`) - READINGS_KEPT_DAYS * 86_400_000).toISOString().slice(0, 10);
    assert.equal(kept.filter((reading) => reading.on > cut).length, READINGS_KEPT_DAYS, 'every reading of the last hundred and twenty days');
    const old = kept.filter((reading) => reading.on <= cut).map((reading) => reading.on);
    assert.deepEqual(old, ['2026-01-05', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', cut].filter((day, index, days) => days.indexOf(day) === index && day <= cut));
    assert.ok(kept.length < all.length && kept[0]!.on === '2026-01-05');
    assert.deepEqual(thinReadings(all.slice(-50), today), all.slice(-50), 'nothing is thinned that is not old');
  });

  it('are thinned as they are written, so a long job still has its first report and its month-ends', () => {
    const p = scheduled();
    for (let index = 0; index < 400; index += 1) {
      const on = new Date(Date.UTC(2025, 5, 1) + index * 86_400_000).toISOString().slice(0, 10);
      setMilestonePercent(p, p.milestones![0]!.id, Math.min(100, Math.round(index / 4)), LEAD, `${on}T09:00:00.000Z`, on);
    }
    const readings = p.milestones![0]!.readings!;
    assert.equal(readings[0]!.on, '2025-06-01');
    assert.ok(readings.some((reading) => reading.on === '2025-08-31'), 'the last of a month long gone is still there');
    assert.ok(readings.length < 140 && readings.length > READINGS_KEPT_DAYS);
  });
});

describe('planned against actual, month by month', () => {
  function reported(): DdProject {
    const p = scheduled();
    for (const [name, on, percent] of [['Foundations', '2026-06-15', 40], ['Foundations', '2026-06-30', 90], ['Foundations', '2026-07-08', 100], ['Structure', '2026-07-31', 20], ['Structure', '2026-08-31', 45], ['Structure', '2026-09-28', 60]] as const) report(p, name, on, percent);
    return p;
  }

  it('reads each month at its last day: what was planned by then and what had been reported by then', () => {
    const p = reported();
    assert.deepEqual(['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'].map((day) => actualPercentOn(p, day)), [22.5, 40, 58.8, 70]);
    const curve = progressCurve(p, at('2026-10-13T10:00:00Z'));
    assert.deepEqual(curve.map((point) => point.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    assert.deepEqual(curve.map((point) => point.actual), [22.5, 40, 58.8, 70, 70], 'the month in hand is read as at today');
    assert.deepEqual([curve[0]!.planned, curve[4]!.on], [25, '2026-10-13']);
    // A month that has not come has a plan and no actual.
    const early = progressCurve(p, at('2026-08-10T10:00:00Z'));
    assert.deepEqual(early.slice(-2).map((point) => [point.month, point.actual === null, point.planned !== null]), [['2026-09', true, true], ['2026-10', true, true]]);
    assert.deepEqual(progressCurve(project(), at('2026-10-13T10:00:00Z')), []);
  });

  it('is the trend the programme sheet declares: a line of actual with planned drawn against it', () => {
    const p = reported();
    const trend = fieldTrend(p, { set: PROGRAMME, field: 'actual_percent' }, at('2026-10-13T10:00:00Z'))!;
    assert.equal(trend.mark, 'line');
    assert.deepEqual(trend.points.map((point) => [point.x, point.y]), [['2026-06', 22.5], ['2026-07', 40], ['2026-08', 58.8], ['2026-09', 70], ['2026-10', 70]]);
    assert.equal(trend.against!.label, 'Planned progress to date');
    assert.equal(trend.against!.points.length, 5);
    assert.match(trend.said, /^5 periods\. October 2026: 70% against \d+(\.\d+)?% \(planned progress to date\)\.$/);
  });
});

describe('earned value', () => {
  it('is there only where every milestone is tied to a work package with a budget', () => {
    const p = scheduled();
    report(p, 'Foundations', '2026-06-30', 100);
    report(p, 'Structure', '2026-08-30', 25);
    assert.equal(earnedValue(p, '2026-08-30'), undefined, 'no package is tied to a milestone: a weight is not money');
    const [first, second] = p.milestones!;
    addWorkPackages(p, [{ name: 'Substructure', budget: 20_000_000, milestoneId: first!.id }], LEAD);
    assert.equal(earnedValue(p, '2026-08-30'), undefined, 'one milestone still has no package');
    const view = () => readSheet(p, PROGRAMME, undefined, undefined, undefined, at('2026-08-30T10:00:00Z'))!.fields.find((held) => held.def.key === 'earned_value')!;
    assert.equal(view().shown, 'hidden', 'and the sheet shows no earned value at all');
    addWorkPackages(p, [{ name: 'Frame', budget: 60_000_000, milestoneId: second!.id }, { name: 'Slabs', budget: 20_000_000, milestoneId: second!.id }], LEAD);
    assert.deepEqual(earnedValue(p, '2026-08-30'), { budget: 100_000_000, planned: 60_000_000, earned: 40_000_000 });
    assert.notEqual(view().shown, 'hidden');
    const read = resolveFields(p, at('2026-08-30T10:00:00Z')).holder(PROGRAMME);
    assert.deepEqual([read.planned_value!.value, read.earned_value!.value, read.schedule_index!.value], [60_000_000, 40_000_000, 0.67]);
    assert.equal(read.cost_index?.value ?? null, null, 'with nothing certified there is no cost index');
    addWorkPackages(p, [{ name: 'No budget yet', milestoneId: second!.id }], LEAD);
    assert.equal(earnedValue(p, '2026-08-30'), undefined, 'a tied package with no budget takes it away again');
  });
});

describe('RERA’s quarterly progress', () => {
  it('is a row a quarter with every figure worked out as at the quarter’s end, and none typed', () => {
    const p = scheduled();
    for (const [name, on, percent] of [['Foundations', '2026-06-30', 100], ['Structure', '2026-08-31', 45], ['Structure', '2026-09-28', 60], ['Structure', '2026-10-10', 80]] as const) report(p, name, on, percent);
    const set = FIELD_SETS.find((held) => held.id === QUARTERS)!;
    assert.deepEqual(set.fields.filter((def) => def.kind !== 'computed' && def.kind !== 'status').map((def) => def.key), ['quarter_ending', 'building'], 'Law types the quarter and may link a building, and no figure');
    const q1 = addFieldRecord(p, QUARTERS, { quarter_ending: '2026-06-30' }, LEAD).record!;
    const q2 = addFieldRecord(p, QUARTERS, { quarter_ending: '2026-09-30' }, LEAD).record!;
    const now = at('2026-10-13T10:00:00Z');
    const row = (id: string) => resolveFields(p, now).holder(QUARTERS, id);
    assert.deepEqual([row(q1.id).progress!.value, row(q1.id).planned!.value, row(q1.id).milestones_complete!.value], [25, 25, 1]);
    assert.deepEqual([row(q2.id).progress!.value, row(q2.id).planned!.value], [70, 81.9], 'September’s row reads 60% of the structure, not the 80% reported in October');
    assert.equal(Math.round(Number(row(q2.id).behind!.value) * 10) / 10, 11.9);
    assert.equal(row(q2.id).quarter_standing!.value, 'Behind the plan');
    assert.equal(resolveFields(p, now).read({ fn: 'construction.progress', set: PROGRAMME, field: 'actual_percent' })!.value, 85, 'while the programme sheet reads today');
    // A quarter that has not ended reads as the project stands.
    const q3 = addFieldRecord(p, QUARTERS, { quarter_ending: '2026-12-31' }, LEAD).record!;
    assert.equal(row(q3.id).progress!.value, 85);
    // Issued, the row is what was filed: it does not move with what is reported after.
    issuePeriod(p, QUARTERS, q2.id, { actor: LEAD });
    report(p, 'Structure', '2026-09-29', 99);
    assert.equal(row(q2.id).progress!.value, 70);
  });

  it('is of one building where the milestones say which building they are of', () => {
    const p = project();
    p.assets = [{ id: 'ast_a', name: 'Tower A', assetType: 'tower' }, { id: 'ast_b', name: 'Tower B', assetType: 'tower' }] as never;
    const [a, b] = addMilestones(p, [{ name: 'A structure', weight: 1, assetId: 'ast_a', plannedFinish: '2026-09-30' }, { name: 'B structure', weight: 1, assetId: 'ast_b', plannedFinish: '2026-12-31' }], LEAD);
    setMilestonePercent(p, a!.id, 80, LEAD, '2026-09-20T09:00:00.000Z', '2026-09-20');
    setMilestonePercent(p, b!.id, 10, LEAD, '2026-09-20T09:00:00.000Z', '2026-09-20');
    const tower = addFieldRecord(p, 'shared.buildings', { name: 'Tower A' }, LEAD).record!;
    const one = addFieldRecord(p, QUARTERS, { quarter_ending: '2026-09-30', building: tower.id }, LEAD).record!;
    const whole = addFieldRecord(p, QUARTERS, { quarter_ending: '2026-09-30' }, LEAD).record!;
    const read = resolveFields(p, at('2026-10-13T10:00:00Z'));
    assert.deepEqual([read.holder(QUARTERS, one.id).progress!.value, read.holder(QUARTERS, whole.id).progress!.value], [80, 45]);
    assert.equal(read.holder(QUARTERS, one.id).planned!.value, 100);
  });
});

describe('how far a figure has moved', () => {
  it('since the last period issued is this period’s less the last, and a standing over it is a threshold', () => {
    const p = scheduled();
    report(p, 'Foundations', '2026-08-20', 60);
    const month = (now: string) => resolveFields(p, at(now)).holder(MONTH);
    assert.equal(month('2026-09-02T10:00:00Z').progress_added?.value ?? null, null, 'no month has been issued: nothing to move from');
    issueSheetPeriod(p, MONTH, { actor: LEAD }, {}, { period: '2026-08', at: at('2026-09-02T10:00:00Z') });
    assert.equal(month('2026-09-03T10:00:00Z').progress_added!.value, 0);
    assert.equal(month('2026-09-03T10:00:00Z').pace!.value, 'Little progress since the last month');
    report(p, 'Structure', '2026-09-25', 30);
    assert.deepEqual([month('2026-09-26T10:00:00Z').progress_added!.value, month('2026-09-26T10:00:00Z').pace!.value], [22.5, 'Moving']);
    // The standing that warns is a line under Needs you, like any other.
    report(p, 'Structure', '2026-09-26', 0);
    const page = readFunctionFields(p, 'construction.progress', at('2026-09-27T10:00:00Z'));
    assert.ok(page.needs.due_soon.some((need) => need.label === 'Pace' && need.text === 'Little progress since the last month'));
  });

  it('since a number of days is read from the record as it stood then, and is unknown where the record does not reach', () => {
    const tracked: FieldSet = {
      id: 'test.tracked',
      fn: 'legal.title',
      title: 'Tracked',
      v: 1,
      fields: [
        { key: 'figure', label: 'Figure', kind: 'money', currency: 'INR' },
        { key: 'moved_30', label: 'Moved in thirty days', kind: 'computed', formula: { op: 'moved', key: 'figure', since: { days: 30 } } },
        { key: 'moved_400', label: 'Moved in four hundred days', kind: 'computed', formula: { op: 'moved', key: 'figure', since: { days: 400 } } },
      ],
      rules: [],
    };
    const catalog = buildFieldCatalog([...FIELD_SETS, tracked]);
    const p = project();
    p.fieldSheets = { 'test.tracked': { values: {} } };
    const values = p.fieldSheets['test.tracked']!.values;
    for (const [value, when] of [[100, '2026-08-01T06:00:00.000Z'], [140, '2026-09-20T06:00:00.000Z'], [150, '2026-10-05T06:00:00.000Z']] as const) stand(values, 'figure', typed(value, when), { at: when, by: LEAD });
    const read = (now: string) => resolveFields(p, at(now), catalog).holder('test.tracked');
    assert.equal(read('2026-10-13T06:00:00Z').moved_30!.value, 50, '150 now, 100 on 13 September');
    assert.equal(read('2026-10-25T06:00:00Z').moved_30!.value, 10, '150 now, 140 on 25 September');
    assert.equal(read('2026-12-01T06:00:00Z').moved_30!.value, 0);
    assert.equal(read('2026-10-13T06:00:00Z').moved_400?.value ?? null, null, 'the project keeps no history that far back: no answer, not nought');
    assert.equal(read('2026-08-15T06:00:00Z').moved_30?.value ?? null, null, 'thirty days before, the field held nothing to move from');
    delete p.historyFrom;
    assert.equal(read('2026-10-13T06:00:00Z').moved_30?.value ?? null, null, 'and on a project that keeps no history yet nothing is said');
  });
});

describe('a field drawn over time', () => {
  it('is a line over the periods a sheet has issued, then the sheet as it reads now', () => {
    const p = project();
    const facility = addFieldRecord(p, 'finance.lenders.facilities', { name: 'Loan', sanctioned_amount: 600_000_000 }, LEAD).record!;
    const drawdown = addFieldRecord(p, 'finance.lenders.drawdowns', { tranche: 'T0', facility: facility.id, disbursed_on: '2026-07-02', disbursed_amount: 380_000_000 }, LEAD).record!;
    // Both were on the record in July: a month issued later reads the project as it stood at the month's end.
    for (const record of [facility, drawdown]) {
      record.createdAt = '2026-07-02T06:00:00.000Z';
      for (const value of Object.values(record.values)) value.at = record.createdAt;
    }
    const POSITION = 'finance.lenders.position';
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 380_000_000, outstanding_per_books: 380_000_000 }, LEAD);
    assert.equal(fieldTrend(p, { set: POSITION, field: 'outstanding_per_statement' }, at('2026-08-20T06:00:00Z')), undefined, 'one figure is not a trend');
    issueSheetPeriod(p, POSITION, { actor: LEAD }, {}, { period: '2026-08', at: at('2026-09-03T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 410_000_000 }, LEAD);
    issueSheetPeriod(p, POSITION, { actor: LEAD }, {}, { period: '2026-09', at: at('2026-10-05T06:00:00Z') });
    setFieldValues(p, { set: POSITION }, { outstanding_per_statement: 432_000_000 }, LEAD);
    const trend = fieldTrend(p, { set: POSITION, field: 'outstanding_per_statement' }, at('2026-10-13T06:00:00Z'))!;
    assert.deepEqual(trend.points.map((point) => [point.x, point.y, point.open ?? false]), [['2026-08', 380_000_000, false], ['2026-09', 410_000_000, false], ['2026-10', 432_000_000, true]]);
    assert.equal(trend.said, '3 periods. October 2026: ₹43.2 Cr, still open.');
    assert.equal(fieldTrend(p, { set: POSITION, field: 'outstanding_per_books' }), undefined, 'a field that declares no trend has none');
  });

  it('is a line of the values a typed field has held, where it says so', () => {
    const p = project();
    p.fieldSheets = { [MONTH]: { values: {} } };
    for (const [value, when] of [[40, '2026-07-05T06:00:00.000Z'], [55, '2026-08-04T06:00:00.000Z'], [70, '2026-09-30T18:29:59.000Z']] as const) stand(p.fieldSheets[MONTH]!.values, 'labour_planned', typed(value, when), { at: when, by: LEAD });
    const trend = fieldTrend(p, { set: MONTH, field: 'labour_planned' }, at('2026-10-13T06:00:00Z'))!;
    assert.deepEqual(trend.points.map((point) => [point.x, point.label, point.y]), [['2026-07-05', '5 Jul 2026', 40], ['2026-08-04', '4 Aug 2026', 55], ['2026-09-30', '30 Sep 2026', 70]], 'each from the day it began to stand, in India');
    assert.match(trend.said, /^3 values\. 30 Sep 2026: 70\.$/);
  });

  it('is declared in four forms and no more, and a declaration that cannot work is named', () => {
    const marks = new Set(FIELD_SETS.flatMap((set) => set.fields.flatMap((def) => (def.trend ? [`${def.trend.mark} ${def.trend.over}${def.trend.against ? ' against' : ''}`] : []))));
    assert.deepEqual([...marks].sort(), ['bar periods', 'line history', 'line periods', 'line periods against']);
    const month = FIELD_SETS.find((set) => set.id === MONTH)!;
    const broken = (patch: (set: FieldSet) => FieldSet) => catalogFaults([...FIELD_SETS.filter((set) => set.id !== MONTH), patch(month)]).filter((fault) => fault.startsWith(MONTH));
    const withField = (key: string, more: object) => (set: FieldSet): FieldSet => ({ ...set, fields: set.fields.map((def) => (def.key === key ? { ...def, ...more } : def)) });
    assert.equal(broken(withField('progress', { trend: { over: 'history', mark: 'line' } })).length, 1, 'what is worked out holds no history');
    assert.ok(broken(withField('progress', { trend: { over: 'periods', mark: 'line', against: 'no_such_field' } })).some((fault) => /drawn against "no_such_field"/.test(fault)));
    assert.ok(broken(withField('progress_added', { formula: { op: 'moved', key: 'no_such_field', since: 'last_period' } })).some((fault) => /says how far "no_such_field" moved/.test(fault)));
    const programme = FIELD_SETS.find((set) => set.id === PROGRAMME)!;
    const onProgramme = catalogFaults([...FIELD_SETS.filter((set) => set.id !== PROGRAMME), { ...programme, fields: [...programme.fields, { key: 'x_moved', label: 'x', kind: 'computed', required: false, formula: { op: 'moved', key: 'actual_percent', since: 'last_period' } }] }]).filter((fault) => fault.startsWith(PROGRAMME));
    assert.ok(onProgramme.some((fault) => /not kept by period/.test(fault)), 'since the last period, on a sheet that is not kept by period');
  });
});
