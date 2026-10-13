/**
 * Construction's and Procurement's fields, held to what a person sees.
 *
 * Every project here is invented. The cases are the ones the catalog is
 * built around: a pour whose samples decide whether it is accepted, an
 * accident that has to be reported, and the hard one, a variation that
 * carries a time claim, whose days move a contract's completion date and
 * leave its guarantee running out too soon.
 *
 * What is asserted is the screen's own reading (`readSheet`,
 * `readFunctionFields`): which fields show, what is worked out and from
 * what, which rule says what, which rule row a figure came from and that it
 * is said to be unverified, what a match leaves over, and that a field that
 * is not showing is never counted missing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  PROJECT_FIGURES,
  TENDER_STAGES,
  TENDER_STAGES_OPTIONAL,
  RULE_ROWS,
  addContract,
  addEvidence,
  addFieldRecord,
  addMilestones,
  addTenderBidder,
  addWorkPackages,
  buildFieldCatalog,
  catalogFaults,
  catalogLimits,
  createProject,
  ensureWorkstreamChecks,
  evaluateFormula,
  fieldSetsOf,
  logSiteEntry,
  proposeFieldValues,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  recommendTender,
  recordLetterOfAcceptance,
  ruleRowFaults,
  setFieldValues,
  setSituation,
  setTenderStage,
  startTender,
  workstreamChecks,
  type CheckFieldValue,
  type DdProject,
  type FieldSet,
} from '@realytica/shared';

const NOW = new Date('2026-10-12T00:00:00Z');
const MINE = /^(construction|procurement)\./;

const PROGRAMME = 'construction.progress.programme';
const DELAY_EVENTS = 'construction.progress.delay_events';
const SITE_LOG = 'construction.progress.site_log';
const POURS = 'construction.quality.pours';
const SAMPLES = 'construction.quality.samples';
const GROUPS = 'construction.quality.sample_groups';
const TESTS = 'construction.quality.tests';
const NCRS = 'construction.quality.ncrs';
const QUALITY = 'construction.quality.standing';
const INCIDENTS = 'construction.safety.incidents';
const STATISTICS = 'construction.safety.statistics';
const ESTABLISHMENT = 'construction.safety.establishment';
const PLAN = 'procurement.boq.plan';
const PACKAGE_PLANS = 'procurement.boq.packages';
const EVALUATIONS = 'procurement.boq.evaluations';
const CONTRACTS = 'shared.contracts';
const TERMS = 'procurement.orders.terms';
const VARIATIONS = 'procurement.orders.variations';
const TIME_CLAIMS = 'procurement.orders.time_claims';
const POSITION = 'procurement.orders.position';
const SECURITIES = 'procurement.vendors.securities';
const COVER = 'procurement.vendors.cover';
const PARTIES = 'shared.parties';
const INSPECTIONS = 'construction.quality.inspections';

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Outer Ring Road', city: 'Bengaluru' }, 'RYT-CP');
  p.jurisdiction = 'Karnataka';
  p.stakeholders.push({ id: 'stk_builder', name: 'Northgate Builders', role: 'Contractor' }, { id: 'stk_bank', name: 'Meridian Bank', role: 'Bank' }, { id: 'stk_engineer', name: 'A. Menon', role: 'Engineer' });
  return p;
}

/** One holder as the page reads it on the test's day. */
function sheet(p: DdProject, set: string, record?: string) {
  const reading = readSheet(p, set, record, undefined, undefined, NOW)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    shown: () => reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    missing: () => reading.fields.filter((f) => f.missing).map((f) => f.def.key),
    says: () => reading.insights.map((i) => i.text),
  };
}

function record(p: DdProject, set: string, values: Record<string, unknown>): string {
  const out = addFieldRecord(p, set, values, 'tester');
  assert.deepEqual(out.rejected, [], `${set} took the record`);
  return out.record!.id;
}

function write(p: DdProject, set: string, values: Record<string, unknown>, id?: string): void {
  assert.deepEqual(setFieldValues(p, { set, ...(id ? { record: id } : {}) }, values, 'tester').rejected, []);
}

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('the Construction and Procurement catalog', () => {
  const mine = FIELD_SETS.filter((set) => MINE.test(set.id));

  it('has no fault and breaks no limit, set by set', () => {
    assert.deepEqual(catalogFaults().filter((fault) => MINE.test(fault)), []);
    assert.deepEqual(catalogLimits().filter((breach) => MINE.test(breach.set)).map((breach) => `${breach.set}/${breach.field ?? ''}: ${breach.said}`), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
  });

  it('gives each function of the two departments a page of sheets', () => {
    for (const fn of ['construction.progress', 'construction.quality', 'construction.safety', 'procurement.boq', 'procurement.orders', 'procurement.vendors', 'procurement.deliveries']) {
      assert.ok(fieldSetsOf(fn).length > 0, fn);
    }
    assert.deepEqual([...new Set(mine.map((set) => set.fn))].sort(), ['construction.progress', 'construction.quality', 'construction.safety', 'procurement.boq', 'procurement.deliveries', 'procurement.orders', 'procurement.vendors']);
  });

  it('keeps every figure a code, an Act or a form of contract sets in the rule table, each unverified and with where it is written', () => {
    const keys = new Set(['cube_samples_required', 'concrete_fck', 'cube_individual_margin', 'cube_group_margin', 'cube_group_deviation_factor', 'cube_variation_limit_pct', 'cube_test_age_days', 'rebar_yield_least', 'rebar_elongation_least', 'rebar_ratio_least', 'safety_officer_workers', 'performance_security_pct', 'performance_security_margin_days', 'claim_notice_days']);
    const rows = RULE_ROWS.filter((row) => keys.has(row.key));
    assert.deepEqual([...new Set(rows.map((row) => row.key))].sort(), [...keys].sort());
    for (const row of rows) {
      assert.equal(row.verified, false, `${row.key} is not verified`);
      assert.ok(row.source.regulation && (row.source.clause || row.source.url || /not read|recalled/.test(row.source.regulation)), `${row.key} says where it is written`);
    }
  });

  it('writes no prose from a model: every longtext is bounded, and at most one a set', () => {
    for (const set of mine) {
      const prose = set.fields.filter((def) => def.kind === 'longtext');
      assert.ok(prose.length <= 1, `${set.id} has ${prose.length} prose fields`);
      for (const def of prose) assert.ok((def.maxLength ?? 0) > 0 && def.maxLength! <= 800, `${set.id}/${def.key}`);
    }
    const p = project();
    const id = record(p, NCRS, { ncr_no: 'NCR-01' });
    const [refused] = proposeFieldValues(p, [{ address: { fn: 'construction.quality', set: NCRS, field: 'description', record: id }, value: 'Honeycombing at the column base.', origin: { kind: 'external', source: 'A model', asOf: '2026-10-12' } }], 'model');
    assert.equal(refused!.outcome, 'refused');
  });

  it('opens small: no sheet shows more than twelve fields before anything is recorded', () => {
    const p = project();
    for (const set of mine.filter((s) => !s.records && !s.extends)) {
      const shown = sheet(p, set.id).shown();
      assert.ok(shown.length <= 12, `${set.id} shows ${shown.length}`);
    }
    assert.equal(readFunctionFields(p, 'procurement.orders', NOW).counts.total, 0, 'an untouched function asks for nothing');
  });
});

/* ==================================================================== */
/* Figures read from the schedule, the site log, tenders, the cost register */
/* ==================================================================== */

describe('figures read from the modules that keep them', () => {
  it('reads progress, the projected finish and the site log, and holds none of them', () => {
    const p = project();
    const [frame, finishes] = addMilestones(p, [{ name: 'Frame', weight: 60, plannedFinish: '2026-11-30' }, { name: 'Finishes', weight: 40, plannedFinish: '2027-03-31' }], 'tester');
    logSiteEntry(p, { clientId: 'a', date: '2026-10-08', manpower: [{ trade: 'Mason', count: 30 }, { trade: 'Helper', count: 20 }], milestoneUpdates: [{ milestoneId: frame!.id, percent: 40 }] }, 'site');
    logSiteEntry(p, { clientId: 'b', date: '2026-10-10', manpower: [{ trade: 'Mason', count: 50 }], milestoneUpdates: [{ milestoneId: frame!.id, percent: 50 }], issues: [{ title: 'Drawing awaited' }] }, 'site');
    assert.ok(finishes);

    const programme = sheet(p, PROGRAMME);
    assert.equal(programme.value('actual_percent'), 30, 'half of sixty parts in a hundred');
    assert.equal(programme.value('planned_completion'), '2027-03-31');
    assert.equal(programme.view('actual_percent').state, 'accepted', 'worked out, so nobody is asked for it');
    assert.ok(!programme.missing().includes('actual_percent'));

    const log = sheet(p, SITE_LOG);
    assert.deepEqual([log.value('days_reported'), log.value('last_entry_on'), log.value('days_since_entry'), log.value('workers_latest'), log.value('hindrances')], [2, '2026-10-10', 2, 50, 1]);
    assert.equal(log.view('shift_hours').state, 'assumed', 'a usual shift stands in');
    assert.equal(log.value('manhours'), 800, 'a hundred worker-days of eight hours');
    assert.equal(log.value('reporting'), 'Reported to date');

    // Six days on with no report, the standing turns.
    const later = readSheet(p, SITE_LOG, undefined, undefined, undefined, new Date('2026-10-16T00:00:00Z'))!;
    assert.equal(later.fields.find((f) => f.def.key === 'reporting')!.held?.value, 'Site log behind');

    // A figure cannot be offered a value: it is worked out.
    const [refused] = proposeFieldValues(p, [{ address: { fn: 'construction.progress', set: SITE_LOG, field: 'workers_latest' }, value: 999, origin: { kind: 'external', source: 'Somewhere', asOf: '2026-10-12' } }], 'model');
    assert.equal(refused!.outcome, 'refused');
  });

  it('says nothing where a module holds nothing: no milestones is not nought per cent', () => {
    const p = project();
    const programme = sheet(p, PROGRAMME);
    assert.equal(programme.value('actual_percent'), null);
    assert.equal(programme.value('completion_standing'), null, 'and no standing is drawn from nothing');
    assert.equal(PROJECT_FIGURES['progress.percent']!.read(p, NOW, undefined, new Map()), null);
  });

  it('refuses a set that reads a figure nothing works out, or one of a package with no link to the package', () => {
    const bad: FieldSet = {
      id: 'procurement.boq.bad',
      fn: 'procurement.boq',
      title: 'Bad',
      v: 1,
      fields: [
        { key: 'a', label: 'a', kind: 'computed', formula: { op: 'figure', key: 'no.such.figure' } },
        { key: 'b', label: 'b', kind: 'computed', formula: { op: 'figure', key: 'package.budget' } },
      ],
      rules: [],
    };
    const said = catalogFaults([...FIELD_SETS, bad]).join('\n');
    assert.match(said, /procurement\.boq\.bad\/a: reads the figure "no\.such\.figure", which nothing works out/);
    assert.match(said, /procurement\.boq\.bad\/b: the figure "package\.budget" is of one package: name the link to it/);
  });

  it('joins rows to their own record, and reads through a link, in a catalog of two small sets', () => {
    const sets: FieldSet[] = [
      { id: 'procurement.orders.jobs', fn: 'procurement.orders', title: 'Jobs', v: 1, records: { of: 'job', titleField: 'name', summaryFields: [] }, fields: [{ key: 'name', label: 'Name', kind: 'text' }, { key: 'rate', label: 'Rate', kind: 'number' }, { key: 'hours', label: 'Hours', kind: 'computed', formula: { op: 'sum_if', over: { records: 'procurement.orders.shifts' }, column: 'hours', where: { column: 'job', is: 'own' } } }], rules: [] },
      { id: 'procurement.orders.shifts', fn: 'procurement.orders', title: 'Shifts', v: 1, records: { of: 'shift', titleField: 'job', summaryFields: [] }, fields: [{ key: 'job', label: 'Job', kind: 'ref', target: { set: 'procurement.orders.jobs' } }, { key: 'hours', label: 'Hours', kind: 'number' }, { key: 'cost', label: 'Cost', kind: 'computed', formula: { op: 'multiply', left: { op: 'field', key: 'hours' }, right: { op: 'field', key: 'rate', at: { fn: 'procurement.orders', set: 'procurement.orders.jobs', field: 'rate' }, via: 'job' } } }], rules: [] },
    ];
    const catalog = buildFieldCatalog(sets);
    assert.deepEqual(catalogFaults(sets, []), []);
    const p = project();
    const add = (set: string, values: Record<string, unknown>) => addFieldRecord(p, set, values, 'tester', {}, catalog).record!.id;
    const [one, two] = [add('procurement.orders.jobs', { name: 'Shuttering', rate: 100 }), add('procurement.orders.jobs', { name: 'Steel fixing', rate: 250 })];
    const shift = add('procurement.orders.shifts', { job: two, hours: 6 });
    add('procurement.orders.shifts', { job: two, hours: 4 });
    add('procurement.orders.shifts', { job: one, hours: 3 });
    const hours = (id: string) => readSheet(p, 'procurement.orders.jobs', id, undefined, catalog, NOW)!.fields.find((f) => f.def.key === 'hours')!.held?.value;
    assert.deepEqual([hours(one), hours(two)], [3, 10], 'each job sums its own shifts');
    assert.equal(readSheet(p, 'procurement.orders.shifts', shift, undefined, catalog, NOW)!.fields.find((f) => f.def.key === 'cost')!.held?.value, 1500, 'six hours at the rate of the job the shift links to');
    // Asked with nothing to join on, a join matches no row and a link reads nothing.
    const v = (value: CheckFieldValue['value']): CheckFieldValue => ({ value, at: '', by: '' });
    assert.equal(evaluateFormula({ op: 'count_if', over: { table: 't' }, where: { column: 'job', is: 'own' } }, { t: v([{ job: 'x' }]) }), 0);
    assert.equal(evaluateFormula({ op: 'field', key: 'rate', at: { fn: 'f', set: 's', field: 'rate' }, via: 'job' }, {}), null);
  });
});

/* ==================================================================== */
/* Quality: a pour, its samples, a group of four                         */
/* ==================================================================== */

describe('Quality: a pour is accepted on its samples', () => {
  const cast = { grade: 'M25', cast_on: '2026-08-01', tested_on: '2026-08-29' };

  function poured() {
    const p = project();
    const pour = record(p, POURS, { pour_no: 'P-014', poured_on: '2026-08-01', element: 'slab', grade: 'M25', volume: 42, released_by: 'stk_engineer' });
    return { p, pour };
  }

  it('asks for the samples its volume needs, from a row of the rule table said to be unverified', () => {
    const { p, pour } = poured();
    const read = sheet(p, POURS, pour);
    assert.equal(read.value('samples_required'), 4, 'forty-two cubic metres is in the band that asks four');
    const cite = read.view('samples_required').cites![0]!;
    assert.deepEqual([cite.key, cite.verified, cite.source.clause], ['cube_samples_required', false, 'clause 15.2.2']);
    assert.equal(read.value('acceptance'), 'Too few samples');
    assert.ok(read.view('acceptance').cites!.some((c) => c.key === 'cube_samples_required' && !c.verified), 'and the standing drawn from it says the same');
    assert.deepEqual(read.says(), ['0 samples were taken of this pour where 4 are required for its volume.']);
    // A larger pour asks one more for each further fifty cubic metres or part.
    write(p, POURS, { volume: 120 }, pour);
    assert.equal(sheet(p, POURS, pour).value('samples_required'), 6);
    // Typed in cubic feet, it is still the same band.
    write(p, POURS, { volume: '1483 cft' }, pour);
    assert.equal(sheet(p, POURS, pour).value('samples_required'), 4);
  });

  it('works out each sample against the limit for its grade, and the pour from its samples', () => {
    const { p, pour } = poured();
    const good = record(p, SAMPLES, { sample_no: 'S-1', pour, ...cast, cube_a: 27, cube_b: 28, cube_c: 29 });
    record(p, SAMPLES, { sample_no: 'S-2', pour, ...cast, cube_a: 27, cube_b: 27, cube_c: 27 });
    record(p, SAMPLES, { sample_no: 'S-3', pour, ...cast, cube_a: 26, cube_b: 26, cube_c: 26 });
    const weak = record(p, SAMPLES, { sample_no: 'S-4', pour, ...cast, cube_a: 20, cube_b: 20.5, cube_c: 19.5 });

    const first = sheet(p, SAMPLES, good);
    assert.deepEqual([first.value('age_days'), first.value('mean'), first.value('required'), first.value('acceptance')], [28, 28, 21, 'Meets the individual limit']);
    assert.deepEqual(first.view('required').cites!.map((c) => [c.key, c.verified]).sort(), [['concrete_fck', false], ['cube_individual_margin', false]]);

    const fourth = sheet(p, SAMPLES, weak);
    assert.deepEqual([fourth.value('mean'), fourth.value('fails'), fourth.value('acceptance')], [20, 1, 'Below the individual limit']);
    assert.deepEqual(fourth.says(), ['The sample averages 20 N/sqmm where it may not be below 21 N/sqmm.']);
    assert.equal(fourth.view('fails').shown, 'folded', 'the working behind the standing stays folded');

    const read = sheet(p, POURS, pour);
    assert.deepEqual([read.value('samples_taken'), read.value('samples_failing'), read.value('acceptance')], [4, 1, 'A sample is below the limit']);
    const quality = sheet(p, QUALITY);
    assert.deepEqual([quality.value('pours'), quality.value('samples_failing'), quality.value('pours_short')], [1, 1, 0]);
    // One line for the sample and one for its pour: the sheet above them counts, and says nothing a record has said.
    const failing = readFunctionFields(p, 'construction.quality', NOW).exceptions.filter((e) => e.kind === 'rule');
    assert.deepEqual(failing.map((e) => `${e.sheet}: ${e.text}`), ['Pours · P-014: A sample is below the limit', 'Cube samples · S-4: The sample averages 20 N/sqmm where it may not be below 21 N/sqmm.']);

    // The rule passes once the result is corrected, and the pour follows.
    write(p, SAMPLES, { cube_a: 25, cube_b: 25.5, cube_c: 24.5 }, weak);
    assert.deepEqual(sheet(p, SAMPLES, weak).says(), []);
    assert.equal(sheet(p, POURS, pour).value('acceptance'), 'No sample below the limit');
    assert.equal(sheet(p, QUALITY).value('samples_failing'), 0);
    assert.deepEqual(readFunctionFields(p, 'construction.quality', NOW).exceptions.filter((e) => e.kind === 'rule'), []);
  });

  it('does not hold an early result to the full-age limit, and calls out cubes that vary too much', () => {
    const { p, pour } = poured();
    const early = record(p, SAMPLES, { sample_no: 'S-7d', pour, grade: 'M25', cast_on: '2026-08-01', tested_on: '2026-08-08', cube_a: 17, cube_b: 17, cube_c: 17 });
    const read = sheet(p, SAMPLES, early);
    assert.deepEqual([read.value('age_days'), read.value('fails'), read.value('acceptance')], [7, 0, 'Early-age result']);
    const uneven = record(p, SAMPLES, { sample_no: 'S-9', pour, ...cast, cube_a: 30, cube_b: 20, cube_c: 25 });
    assert.deepEqual([sheet(p, SAMPLES, uneven).value('variation_pct'), sheet(p, SAMPLES, uneven).value('acceptance')], [20, 'Cubes vary too much']);
    const awaited = record(p, SAMPLES, { sample_no: 'S-10', pour, grade: 'M25', cast_on: '2026-10-01' });
    assert.equal(sheet(p, SAMPLES, awaited).value('acceptance'), 'Result awaited');
    assert.equal(sheet(p, POURS, pour).value('acceptance'), 'Too few samples', 'three of four, and none below the limit at full age');
  });

  it('holds a group of four to the mean limit, with the deviation where one is established', () => {
    const { p, pour } = poured();
    const ids = [[28, 28, 28], [27, 27, 27], [26, 26, 26], [20, 20, 20]].map((cubes, i) => record(p, SAMPLES, { sample_no: `S-${i + 1}`, pour, ...cast, cube_a: cubes[0], cube_b: cubes[1], cube_c: cubes[2] }));
    const group = record(p, GROUPS, { group_no: 'G-1', grade: 'M25', first: ids[0], second: ids[1], third: ids[2] });
    assert.equal(sheet(p, GROUPS, group).value('acceptance'), 'Group incomplete');
    write(p, GROUPS, { fourth: ids[3] }, group);
    let read = sheet(p, GROUPS, group);
    assert.deepEqual([read.value('mean'), read.value('required_mean'), read.value('acceptance')], [25.3, 29, 'Group mean below the limit']);
    write(p, GROUPS, { deviation: 6 }, group);
    read = sheet(p, GROUPS, group);
    assert.equal(read.value('required_mean'), 30, 'twenty-five and 0.825 of six is 29.95, above twenty-five and four');
    assert.ok(read.view('required_mean').cites!.every((c) => !c.verified));
    assert.equal(sheet(p, QUALITY).value('groups_failing'), 1);
  });

  it('shows a non-conformance’s deeper fields only when they apply, and never counts a hidden one missing', () => {
    const p = project();
    const ncr = record(p, NCRS, { ncr_no: 'NCR-07', raised_on: '2026-09-20', against: 'stk_builder', category: 'workmanship', severity: 'major', action_due: '2026-10-05' });
    let read = sheet(p, NCRS, ncr);
    assert.ok(!read.shown().includes('concession_by') && !read.shown().includes('hold_on_work'));
    assert.ok(!read.missing().includes('concession_by'), 'not showing, so not missing');
    assert.equal(read.value('standing'), 'Open');
    assert.deepEqual(readFunctionFields(p, 'construction.quality', NOW).situations.find((s) => s.situation.key === 'serious_defect_open')!.state, 'off');

    write(p, NCRS, { disposition: 'use_as_is_with_concession', severity: 'critical' }, ncr);
    read = sheet(p, NCRS, ncr);
    assert.ok(read.shown().includes('concession_by') && read.shown().includes('hold_on_work'));
    assert.ok(read.missing().includes('concession_by'), 'now in play, and asked for');

    // A critical one open brings the Critical part of the standing sheet into play, and nobody was asked.
    const fn = readFunctionFields(p, 'construction.quality', NOW);
    assert.equal(fn.situations.find((s) => s.situation.key === 'serious_defect_open')!.state, 'on');
    const quality = sheet(p, QUALITY);
    assert.ok(quality.shown().includes('critical_open'));
    assert.deepEqual([quality.value('critical_open'), quality.value('ncrs_raised'), quality.value('ncrs_open')], [1, 1, 1]);
    assert.deepEqual(quality.says(), ['1 critical non-conformances are open and work is held on 0 of them.']);

    // Closed without proof is said; closed with a named verifier and proof is closed.
    write(p, NCRS, { concession_by: 'stk_engineer', hold_on_work: true, closed_on: '2026-10-08' }, ncr);
    assert.equal(sheet(p, NCRS, ncr).value('standing'), 'Closed without proof');
    assert.equal(sheet(p, QUALITY).value('ncrs_closed'), 0, 'closed counts only with proof');
  });

  it('fails a test against its limit either way round, and asks the engineer only then', () => {
    const p = project();
    const test = record(p, TESTS, { test: 'Earth pit 3', subject: 'earth_resistance', tested_on: '2026-09-30', result: 1.6, limit: 2, sense: 'at_most' });
    let read = sheet(p, TESTS, test);
    assert.deepEqual([read.value('outcome'), read.shown().includes('verdict')], ['Passes', false]);
    write(p, TESTS, { result: 2.6 }, test);
    read = sheet(p, TESTS, test);
    assert.deepEqual([read.value('shortfall'), read.value('outcome'), read.shown().includes('verdict')], [0.6, 'Fails', true]);
    assert.deepEqual(read.missing(), ['verdict'], 'asked for once, as a field still empty');
    write(p, TESTS, { verdict: 'retest' }, test);
    assert.deepEqual(sheet(p, TESTS, test).missing(), []);
  });
});

/* ==================================================================== */
/* Safety: an accident that has to be reported                           */
/* ==================================================================== */

describe('Safety: incidents are rows, and the rates are worked out', () => {
  function site(workers = 50) {
    const p = project();
    logSiteEntry(p, { clientId: 'a', date: '2026-10-09', manpower: [{ trade: 'Mason', count: workers }] }, 'site');
    logSiteEntry(p, { clientId: 'b', date: '2026-10-10', manpower: [{ trade: 'Mason', count: workers }] }, 'site');
    return p;
  }

  it('opens on the statistics alone, and a near miss brings no reporting fields', () => {
    const p = site();
    const stats = sheet(p, STATISTICS);
    assert.deepEqual(stats.shown(), ['workforce', 'inducted', 'inducted_pct', 'training_sessions', 'incidents', 'lti_count', 'near_misses', 'manhours', 'ltifr']);
    const miss = record(p, INCIDENTS, { incident_no: 'I-01', occurred_on: '2026-10-09', kind: 'near_miss', cause: 'struck_by_object', actions_closed: true });
    const read = sheet(p, INCIDENTS, miss);
    assert.ok(!read.shown().includes('authority_told_on') && !read.shown().includes('days_lost'));
    assert.deepEqual(read.missing(), []);
    assert.equal(read.value('notice'), 'Recorded');
    assert.deepEqual([sheet(p, STATISTICS).value('near_misses'), sheet(p, STATISTICS).value('lti_count'), sheet(p, STATISTICS).value('ltifr')], [1, 0, 0]);
  });

  it('turns on what a lost-time injury needs, counts it, and says the authority has not been told', () => {
    const p = site();
    const injury = record(p, INCIDENTS, { incident_no: 'I-02', occurred_on: '2026-10-10', kind: 'lost_time_injury', cause: 'fall_from_height', employer: 'stk_builder', actions_closed: false });
    let read = sheet(p, INCIDENTS, injury);
    assert.ok(read.shown().includes('authority_told_on') && read.shown().includes('days_lost'));
    assert.ok(!read.shown().includes('police_told_on'), 'the police are asked about only for a fatality');
    assert.deepEqual(read.missing(), [], 'the notice is asked for by the rule, once, and not a second time as an empty field');
    assert.equal(read.value('notice'), 'Authority not told');
    assert.deepEqual(read.says(), ['A fatality or a lost-time injury is recorded and the authority has not been told.']);

    const fn = readFunctionFields(p, 'construction.safety', NOW);
    assert.equal(fn.situations.find((s) => s.situation.key === 'reportable_accident')!.state, 'on', 'derived from the row: nobody is asked');
    const stats = sheet(p, STATISTICS);
    assert.deepEqual([stats.value('workforce'), stats.value('lti_count'), stats.value('manhours'), stats.value('ltifr'), stats.value('unreported')], [50, 1, 800, 1250, 1]);
    assert.ok(stats.shown().includes('unreported'), 'the reportable part of the sheet is in play');
    assert.deepEqual(fn.exceptions.filter((e) => e.kind === 'rule').map((e) => e.text), ['A fatality or a lost-time injury is recorded and the authority has not been told.'], 'said once, on the incident');

    write(p, INCIDENTS, { authority_told_on: '2026-10-11', days_lost: 6 }, injury);
    read = sheet(p, INCIDENTS, injury);
    assert.deepEqual([read.value('notice'), read.says()], ['Recorded', []]);
    assert.deepEqual([sheet(p, STATISTICS).value('unreported'), sheet(p, STATISTICS).value('days_lost')], [0, 6]);
    // The vendor's own record counts the incident among their workers, with nothing typed there.
    const vendor = record(p, PARTIES, { name: 'Eastside Formwork' });
    write(p, INCIDENTS, { employer: vendor }, injury);
    assert.equal(sheet(p, PARTIES, vendor).value('incidents_on_workforce'), 1);
  });

  it('compares the register with the figure typed on the old check, where one is', () => {
    const p = site();
    record(p, INCIDENTS, { incident_no: 'I-03', occurred_on: '2026-10-10', kind: 'lost_time_injury', cause: 'electrical', authority_told_on: '2026-10-10', days_lost: 2, actions_closed: true });
    ensureWorkstreamChecks(p, ['construction.safety'], 'tester');
    const checks = workstreamChecks(p, 'construction.safety');
    recordCheckFields(p, checks.find((c) => c.definitionId === 'hse.incidents')!.id, { lti_count: 3 }, 'tester');
    const register = addEvidence(p, { title: 'Induction register, October', kind: 'document' });
    assert.deepEqual(recordCheckFields(p, checks.find((c) => c.definitionId === 'hse.training')!.id, { workforce: 50, inducted: 40 }, 'tester', register.id).rejected, []);
    const stats = sheet(p, STATISTICS);
    assert.ok(stats.says().includes('The incident register holds 1 lost-time injuries and the Incidents check records 3.'));
    assert.deepEqual([stats.value('inducted'), stats.value('inducted_pct'), stats.view('inducted').source?.kind], [40, 80, 'field'], 'the induction count is entered on the check and read here');
    assert.equal(checks.find((c) => c.definitionId === 'hse.incidents')!.fields!.lti_count!.value, 3, 'what was saved on the check still reads');
  });

  it('asks for a safety officer only once the workforce reaches the figure in the rule table', () => {
    const small = site(50);
    assert.ok(!sheet(small, ESTABLISHMENT).shown().includes('safety_officer'));
    assert.ok(!sheet(small, ESTABLISHMENT).missing().includes('safety_officer'));
    const large = site(520);
    const read = sheet(large, ESTABLISHMENT);
    const cite = read.view('officer_figure').cites![0]!;
    assert.deepEqual([read.value('officer_figure'), cite.key, cite.verified, cite.from], [500, 'safety_officer_workers', false, '2025-11-21']);
    assert.ok(read.shown().includes('safety_officer'));
    assert.ok(read.says().includes('The workforce has reached the figure at which a safety officer is required, and none is named.'));
    write(large, ESTABLISHMENT, { safety_officer: 'stk_engineer', safety_committee: true });
    assert.ok(!sheet(large, ESTABLISHMENT).says().some((line) => /safety officer/.test(line)));
  });
});

/* ==================================================================== */
/* Procurement: a package from plan to award                             */
/* ==================================================================== */

describe('Procurement: a package is planned back from the day it is needed on site', () => {
  function planned() {
    const p = project();
    const [frame] = addMilestones(p, [{ name: 'Frame', weight: 1, plannedFinish: '2027-05-31' }], 'tester');
    frame!.plannedStart = '2026-12-01';
    const [pack] = addWorkPackages(p, [{ code: 'B2', name: 'Civil and structure', budget: 190_000_000, milestoneId: frame!.id }], 'tester');
    const plan = record(p, PACKAGE_PLANS, { package: pack!.id, trade: 'civil_and_structure', route: 'limited_tender', contract_form: 'item rate', lead_weeks: 8 });
    return { p, pack: pack!, plan };
  }

  it('works the award and tender dates back from the schedule, and says when the award is late', () => {
    const { p, pack, plan } = planned();
    let read = sheet(p, PACKAGE_PLANS, plan);
    assert.equal(read.reading.title, 'B2 Civil and structure');
    assert.deepEqual([read.value('budget'), read.value('needed_on_site'), read.value('award_by'), read.value('tender_by')], [190_000_000, '2026-12-01', '2026-10-06', '2026-08-25']);
    assert.ok(!read.shown().includes('single_source_reason') && !read.missing().includes('single_source_reason'));
    assert.deepEqual([read.value('late'), read.value('standing')], [1, 'Award late against need']);
    assert.equal(sheet(p, PLAN).value('awards_late'), 1);

    // A negotiated route asks why there is one source.
    write(p, PACKAGE_PLANS, { route: 'negotiated' }, plan);
    read = sheet(p, PACKAGE_PLANS, plan);
    assert.ok(read.shown().includes('single_source_reason') && read.missing().includes('single_source_reason'));
    write(p, PACKAGE_PLANS, { single_source_reason: 'continuity of work' }, plan);
    assert.deepEqual(sheet(p, PACKAGE_PLANS, plan).missing(), []);

    // The tender tracker records the bids and the letter; the plan and the evaluation read them.
    const tender = startTender(p, { workPackageId: pack.id, estimate: 180_000_000 }, 'tester');
    const low = addTenderBidder(p, tender.id, { name: 'Northgate Builders', quoted: 178_000_000 }, 'tester');
    const high = addTenderBidder(p, tender.id, { name: 'Eastside Formwork', quoted: 184_000_000 }, 'tester');
    assert.ok(low);
    // The tracker's own order: each stage before the recommendation is done, or gone without where it may be.
    for (const [i, key] of TENDER_STAGES.slice(0, TENDER_STAGES.indexOf('recommendation')).entries()) {
      setTenderStage(p, tender.id, key, TENDER_STAGES_OPTIONAL.includes(key) ? { notNeeded: true } : { doneOn: `2026-09-${10 + i}` }, 'tester', NOW);
    }
    recommendTender(p, tender.id, { bidderId: high.id, text: 'Shorter programme.' }, 'tester');
    setTenderStage(p, tender.id, 'recommendation', { doneOn: '2026-10-05' }, 'tester', NOW);
    recordLetterOfAcceptance(p, tender.id, { bidderId: high.id, value: 184_000_000, letterOn: '2026-10-10' }, 'tester', NOW);
    read = sheet(p, PACKAGE_PLANS, plan);
    assert.deepEqual([read.value('estimate'), read.value('awarded_on'), read.value('late'), read.value('standing')], [180_000_000, '2026-10-10', 0, 'Awarded after it was needed']);
    assert.deepEqual(read.says(), ['The letter of acceptance is dated 2026-10-10, after the 2026-10-06 the award was needed by.']);
    assert.equal(sheet(p, PLAN).value('packages_awarded'), 1);

    const evaluation = record(p, EVALUATIONS, { package: pack.id, reasons: ['shortest time'], approver: 'stk_engineer' });
    const judged = sheet(p, EVALUATIONS, evaluation);
    assert.deepEqual([judged.value('bids'), judged.value('lowest_bid'), judged.value('awarded_value'), judged.value('above_lowest')], [2, 178_000_000, 184_000_000, 6_000_000]);
    assert.ok(judged.shown().includes('not_lowest_reason') && judged.missing().includes('not_lowest_reason'), 'an award above the lowest bid asks why');
    assert.deepEqual(judged.says(), ['Only 2 bids are priced, fewer than 3.']);
    write(p, EVALUATIONS, { not_lowest_reason: 'shorter time', technical: [{ bidder: 'stk_builder', criterion: 'similar work', weight: 60, score: 4 }, { bidder: 'stk_builder', criterion: 'plant', weight: 30, score: 3 }] }, evaluation);
    assert.deepEqual(sheet(p, EVALUATIONS, evaluation).says(), ['The technical weights come to 90, not 100.', 'Only 2 bids are priced, fewer than 3.']);
  });
});

/* ==================================================================== */
/* The hard case: a variation that carries a time claim                  */
/* ==================================================================== */

describe('Procurement: a variation with a time claim', () => {
  function contracted() {
    const p = project();
    const [pack, other] = addWorkPackages(p, [{ code: 'B2', name: 'Civil and structure', budget: 190_000_000 }, { code: 'E1', name: 'Electrical', budget: 30_000_000 }], 'tester');
    addContract(p, { contractor: 'Northgate Builders', title: 'Civil and structure', workPackageIds: [pack!.id], value: 184_000_000, retentionPercent: 5 }, 'tester');
    const contract = record(p, CONTRACTS, { title: 'Civil and structure', counterparty: 'stk_builder', package: pack!.id, signed_on: '2026-03-02', reference: 'WO/2026/014', conditions: 'fidic_red', start_on: '2026-03-10', completion_on: '2027-06-30', defects_months: 12 });
    const terms = record(p, TERMS, { contract, damages_pct_per_week: 0.5, damages_cap_pct: 5, deviation_limit_pct: 10, escalation: 'none', performance_security_pct: 5, insurances_required: ['contractor_s_all_risk'] });
    const guarantee = record(p, SECURITIES, { number: 'BG/0456/26', kind: 'performance', instrument: 'bank_guarantee', contract, bank: 'stk_bank', amount: 9_200_000, valid_to: '2027-08-31', confirmed_with_bank_on: '2026-03-20' });
    const event = record(p, DELAY_EVENTS, { event: 'Late issue of column drawings', kind: 'drawing_awaited', event_on: '2026-08-10', days: 45, cause: 'employer', on_critical_path: true, notice_on: '2026-09-02' });
    return { p, pack: pack!, other: other!, contract, terms, guarantee, event };
  }

  it('reads the contract’s value from the cost register, and starts with the guarantee in order', () => {
    const { p, contract, terms, guarantee } = contracted();
    const held = sheet(p, CONTRACTS, contract);
    assert.deepEqual([held.value('value'), held.value('days_granted'), held.value('revised_completion'), held.value('notice_period')], [184_000_000, 0, '2027-06-30', 28]);
    const cite = held.view('notice_period').cites![0]!;
    assert.deepEqual([cite.key, cite.verified, cite.source.clause], ['claim_notice_days', false, 'sub-clause 20.2.1']);
    assert.equal(held.view('value').state, 'accepted', 'read from the cost register, never typed here');

    const security = sheet(p, SECURITIES, guarantee);
    assert.deepEqual([security.value('obligation_ends'), security.value('renew_by'), security.value('days_left'), security.value('standing')], ['2027-08-29', '2027-07-17', 323, 'Valid']);
    assert.ok(security.view('obligation_ends').cites!.some((c) => c.key === 'performance_security_margin_days' && !c.verified));

    const position = sheet(p, TERMS, terms);
    assert.deepEqual([position.value('performance_required'), position.value('performance_held'), position.value('position')], [9_200_000, 9_200_000, 'In order']);
    assert.ok(!position.shown().includes('default_notice_on') && !position.shown().includes('escalation_cap_pct'), 'termination and price variation stay out of sight');
    assert.deepEqual(position.missing(), []);
  });

  it('shows a variation in thirteen fields, and the time claim’s only when it carries one', () => {
    const { p, contract } = contracted();
    const variation = record(p, VARIATIONS, { ref: 'VO-09', contract, kind: 'extra item', origin: 'design change', notified_on: '2026-09-05', claimed: 1_820_000, stage: 'claimed', built: false, time_effect: false });
    let read = sheet(p, VARIATIONS, variation);
    assert.deepEqual(read.shown(), ['ref', 'contract', 'kind', 'origin', 'notified_on', 'instruction', 'time_effect', 'claimed', 'assessed', 'rate_basis', 'stage', 'approved_on', 'built', 'standing']);
    assert.deepEqual(read.missing(), [], 'the time claim is not asked for');
    assert.equal(read.value('standing'), 'In order');

    write(p, VARIATIONS, { time_effect: true }, variation);
    read = sheet(p, VARIATIONS, variation);
    assert.deepEqual(read.shown().filter((key) => ['time_claim', 'days_claimed', 'days_granted'].includes(key)), ['time_claim', 'days_claimed', 'days_granted']);
    assert.deepEqual(read.missing(), ['time_claim'], 'asked for once, as a field still empty');

    // Switched off again, what was linked is kept and nothing is asked.
    write(p, VARIATIONS, { time_effect: false }, variation);
    assert.deepEqual(sheet(p, VARIATIONS, variation).missing(), []);
  });

  it('judges the notice against the contract’s period, and lets the days granted move the completion date and the guarantee', () => {
    const { p, contract, terms, guarantee, event } = contracted();
    const variation = record(p, VARIATIONS, { ref: 'VO-09', contract, kind: 'extra item', origin: 'design change', notified_on: '2026-09-05', claimed: 1_820_000, stage: 'claimed', built: false, time_effect: true });
    const claim = record(p, TIME_CLAIMS, { claim_no: 'TC-01', contract, event, notified_on: '2026-09-02', days_claimed: 45, with_cost: false });
    write(p, VARIATIONS, { time_claim: claim }, variation);

    let read = sheet(p, TIME_CLAIMS, claim);
    assert.deepEqual([read.value('event_on'), read.value('days_to_notice'), read.value('notice_period'), read.value('notice'), read.value('days_recorded')], ['2026-08-10', 23, 28, 'Notice in time', 45]);
    assert.ok(read.view('notice_period').cites!.some((c) => c.key === 'claim_notice_days' && !c.verified), 'the period is the form of contract’s, and is said to be unverified');
    assert.ok(!read.shown().includes('cost_claimed'), 'the cost of delay is not asked about');
    assert.deepEqual(read.says(), []);
    assert.equal(sheet(p, VARIATIONS, variation).value('days_claimed'), 45, 'the variation reads its claim’s days');
    assert.equal(sheet(p, VARIATIONS, variation).value('standing'), 'In order');

    // The inward stamp says a week later: the same arithmetic, the other answer.
    write(p, TIME_CLAIMS, { notified_on: '2026-09-09' }, claim);
    read = sheet(p, TIME_CLAIMS, claim);
    assert.deepEqual([read.value('days_to_notice'), read.value('notice')], [30, 'Notice out of time']);
    assert.deepEqual(read.says(), ['The notice came 30 days after the event, outside the 28 days the contract gives.']);
    assert.equal(sheet(p, POSITION).value('notices_late'), 1);
    // The contract's own clause, once recorded, takes the place of the usual period.
    write(p, CONTRACTS, { notice_days: 42 }, contract);
    assert.deepEqual([sheet(p, TIME_CLAIMS, claim).value('notice_period'), sheet(p, TIME_CLAIMS, claim).value('notice')], [42, 'Notice in time']);

    // Granting the forty-five days moves the completion date, and the guarantee no longer outlasts it.
    write(p, TIME_CLAIMS, { days_assessed: 45, days_granted: 45, decided_on: '2026-10-05', cause: 'employer' }, claim);
    const held = sheet(p, CONTRACTS, contract);
    assert.deepEqual([held.value('days_granted'), held.value('revised_completion')], [45, '2027-08-14']);
    const security = sheet(p, SECURITIES, guarantee);
    assert.deepEqual([security.value('obligation_ends'), security.value('standing')], ['2027-10-13', 'Runs out before the obligation ends']);
    assert.deepEqual(security.says(), ['The obligation it secures runs to 2027-10-13 and this runs out on 2027-08-31: have it extended.']);
    const cover = sheet(p, COVER);
    assert.equal(cover.value('uncovered'), 1);
    const needs = readFunctionFields(p, 'procurement.vendors', NOW);
    assert.deepEqual(needs.exceptions.filter((e) => e.kind === 'rule').map((e) => e.text), ['The obligation it secures runs to 2027-10-13 and this runs out on 2027-08-31: have it extended.'], 'the function’s page says so, once');

    // Extended, it is in order again, and nothing else changed hands.
    write(p, SECURITIES, { valid_to: '2027-10-31' }, guarantee);
    assert.deepEqual([sheet(p, SECURITIES, guarantee).value('standing'), sheet(p, SECURITIES, guarantee).says(), sheet(p, COVER).value('uncovered')], ['Valid', [], 0]);
    assert.equal(sheet(p, TERMS, terms).value('position'), 'In order');

    // More granted than claimed is said.
    write(p, TIME_CLAIMS, { days_granted: 50 }, claim);
    assert.ok(sheet(p, TIME_CLAIMS, claim).says().includes('50 days are granted, more than the 45 days claimed.'));
  });

  it('brings the cost of delay in only when the claim asks for it', () => {
    const { p, contract, event } = contracted();
    const claim = record(p, TIME_CLAIMS, { claim_no: 'TC-02', contract, event, notified_on: '2026-08-20', days_claimed: 30, with_cost: true });
    const read = sheet(p, TIME_CLAIMS, claim);
    assert.ok(['cost_head', 'cost_claimed', 'cost_assessed'].every((key) => read.shown().includes(key)));
    assert.deepEqual(read.missing(), ['cost_head', 'cost_claimed']);
  });

  it('counts approved, pending and built-but-unapproved variations on the contract and across the function', () => {
    const { p, contract, terms } = contracted();
    record(p, VARIATIONS, { ref: 'VO-07', contract, kind: 'extra item', origin: 'site instruction', notified_on: '2026-07-01', claimed: 1_200_000, assessed: 1_130_000, stage: 'approved', approved_on: '2026-08-01', built: true, time_effect: false });
    const loose = record(p, VARIATIONS, { ref: 'VO-08', contract, kind: 'quantity deviation', origin: 'quantity re-measure', notified_on: '2026-08-12', claimed: 900_000, stage: 'claimed', built: true, time_effect: false });
    assert.equal(sheet(p, VARIATIONS, loose).value('standing'), 'Built and not approved');
    assert.equal(sheet(p, CONTRACTS, contract).value('variations_approved'), 1_130_000);
    const position = sheet(p, TERMS, terms);
    assert.deepEqual([position.value('revised_value'), position.value('variation_pct'), position.value('position')], [185_130_000, 0.61, 'In order']);
    const all = sheet(p, POSITION);
    assert.deepEqual([all.value('variations'), all.value('variations_approved'), all.value('variations_pending'), all.value('built_unapproved')], [2, 1_130_000, 900_000, 900_000]);
    assert.deepEqual(sheet(p, VARIATIONS, loose).says(), ['It is built, worth ₹9 lakh as claimed, and not approved.']);
    // Past the deviation the contract allows, the position turns and names both figures.
    write(p, TERMS, { deviation_limit_pct: 0.5 }, terms);
    assert.equal(sheet(p, TERMS, terms).value('position'), 'Past the deviation limit');
    assert.ok(sheet(p, TERMS, terms).says().includes('Approved variations are 0.61 % of the contract value, past the 0.5% the contract allows.'));
  });

  it('pairs packages with contracts and leaves over the package nobody has contracted', () => {
    const { p, pack, other, contract } = contracted();
    let match = sheet(p, POSITION).view('package_cover').match!;
    assert.deepEqual([match.left.leftover.map((i) => i.label), match.right.leftover.map((i) => i.label)], [['B2 Civil and structure', 'E1 Electrical'], ['Civil and structure']]);
    write(p, POSITION, { package_cover: [{ package: pack.id, contract }] });
    match = sheet(p, POSITION).view('package_cover').match!;
    assert.deepEqual([match.left.leftover.map((i) => i.label), match.right.leftover.map((i) => i.label), match.pairs.length], [['E1 Electrical'], [], 1]);
    const needs = readFunctionFields(p, 'procurement.orders', NOW);
    assert.deepEqual(needs.exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text), ['Packages with no contract: E1 Electrical']);
    assert.ok(other);
  });

  it('opens termination only when a person says a contract is being terminated, and holds it to the cure period', () => {
    const { p, terms } = contracted();
    assert.ok(!sheet(p, TERMS, terms).shown().includes('terminated_on'));
    setSituation(p, 'procurement.orders', 'contract_being_terminated', true, 'tester');
    write(p, TERMS, { default_notice_on: '2026-09-01', cure_days: 28, terminated_on: '2026-09-20' }, terms);
    const read = sheet(p, TERMS, terms);
    assert.equal(read.value('cure_ends'), '2026-09-29');
    assert.deepEqual(read.says(), ['Terminated on 2026-09-20, before the cure period ended on 2026-09-29.']);
    // Out of play again, what was recorded is kept and no longer asked or judged.
    setSituation(p, 'procurement.orders', 'contract_being_terminated', false, 'tester');
    const kept = sheet(p, TERMS, terms);
    assert.deepEqual([kept.says(), kept.view('terminated_on').notInPlay, kept.view('terminated_on').held?.value], [[], true, '2026-09-20']);
  });

  it('scores a vendor from the site’s own records, with nothing typed on the vendor', () => {
    const { p } = contracted();
    const vendor = record(p, PARTIES, { name: 'Eastside Formwork', vendor_kind: ['contractor'], prequalified_limit: 50_000_000 });
    record(p, CONTRACTS, { title: 'Formwork', counterparty: vendor, signed_on: '2026-04-01' });
    record(p, INSPECTIONS, { request_no: 'IR-1', requested_on: '2026-09-01', contractor: vendor, activity: 'formwork', result: 'approved' });
    record(p, INSPECTIONS, { request_no: 'IR-2', requested_on: '2026-09-03', contractor: vendor, activity: 'reinforcement', result: 'rejected' });
    record(p, NCRS, { ncr_no: 'NCR-11', raised_on: '2026-09-04', against: vendor, category: 'workmanship', severity: 'minor', action_due: '2026-09-20' });
    const read = sheet(p, PARTIES, vendor);
    assert.deepEqual([read.value('contracts_held'), read.value('inspections_requested'), read.value('first_pass_pct'), read.value('ncrs_against')], [1, 2, 50, 1]);
    assert.ok(!read.shown().includes('udyam_no'));
    write(p, PARTIES, { small_enterprise: true }, vendor);
    assert.ok(sheet(p, PARTIES, vendor).shown().includes('udyam_no'));
  });
});
