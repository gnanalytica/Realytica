/**
 * The catalog of fields, held to what a catalog author is promised and to
 * what one is held to (docs/fields.md).
 *
 * The product's own catalog has no fault and breaks no limit: a field set
 * that names a field, a rule row or a list that does not exist, or that
 * reads itself in a ring, fails here and not on a person's screen. The rest
 * builds small catalogs of its own to show each mechanism working, so
 * nothing here depends on a department's file.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  RULE_ROWS,
  addFieldRecord,
  buildFieldCatalog,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  evaluateFormula,
  fieldCatalog,
  fieldOrder,
  fieldSetsOf,
  functionHasSheets,
  functionSections,
  menuFunctions,
  readFunctionFields,
  readSheet,
  resolveFields,
  ruleRow,
  ruleRowFaults,
  setFieldValues,
  statedBySeveral,
  type CheckFieldDef,
  type CheckFieldValue,
  type CheckFormula,
  type DdProject,
  type FieldSet,
  type RuleRow,
} from '@realytica/shared';

const FN = 'finance.funding';
const set = (id: string, fields: CheckFieldDef[], more: Partial<FieldSet> = {}): FieldSet => ({ id, fn: FN, title: id, v: 1, fields, rules: [], ...more });
const num = (key: string, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label: key, kind: 'number', ...more });
const computed = (key: string, formula: CheckFormula, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label: key, kind: 'computed', formula, ...more });

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-CAT');
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  return p;
}

/** A project's sheet read against a catalog of the test's own. */
function sheet(p: DdProject, sets: FieldSet[], id: string, rules: readonly RuleRow[] = [], now = new Date('2026-10-12T00:00:00Z')) {
  const catalog = buildFieldCatalog(sets);
  const resolution = resolveFields(p, now, catalog, rules);
  const reading = readSheet(p, id, undefined, resolution, catalog, now)!;
  const value = (key: string) => reading.fields.find((f) => f.def.key === key)?.held?.value ?? null;
  return { catalog, reading, value, view: (key: string) => reading.fields.find((f) => f.def.key === key)! };
}

const write = (p: DdProject, sets: FieldSet[], id: string, values: Record<string, unknown>) => assert.deepEqual(setFieldValues(p, { set: id }, values, 'tester', {}, buildFieldCatalog(sets)).rejected, []);

/* ==================================================================== */
/* The product's own catalog                                             */
/* ==================================================================== */

describe('the catalog', () => {
  it('has no fault: nothing reads a field, a list, a situation or a rule row that is not there, and nothing is a ring', () => {
    assert.deepEqual(catalogFaults(), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
    assert.equal(fieldOrder().cycle, undefined);
  });

  it('breaks none of the limits a catalog author is held to, each reported by its field set', () => {
    const breaches = catalogLimits();
    const bySet = new Map<string, string[]>();
    for (const breach of breaches) bySet.set(breach.set, [...(bySet.get(breach.set) ?? []), `${breach.field ?? '(set)'}: ${breach.said}`]);
    assert.deepEqual(Object.fromEntries(bySet), {}, 'fix these in the file that declares the set');
  });

  it('exposes every check’s fields through the same door, unchanged', () => {
    const catalog = fieldCatalog();
    const parcel = catalog.sets.get('land_site.parcel_identification')!;
    assert.equal(parcel.fn, 'legal.title');
    assert.deepEqual(parcel.fields.map((f) => f.key), ['survey_numbers', 'extent_title', 'extent_survey', 'extent_khata']);
    assert.ok(catalog.checks.has(parcel.id));
    assert.ok(!fieldSetsOf('legal.title').some((s) => s.id === parcel.id), 'a check is not a sheet');
  });

  it('takes a new file by one line: the folder’s index is the only file that names a field-set file', () => {
    const dir = 'packages/shared/src/operating-model/field-sets';
    const index = readFileSync(`${dir}/index.ts`, 'utf8');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !['index.ts', 'builders.ts', 'state-packs.ts', 'rule-rows.ts', 'shared-records.ts'].includes(f));
    assert.ok(files.includes('example-land-holding.ts'));
    for (const file of files) {
      const name = file.replace(/\.ts$/, '');
      assert.equal(index.split(`'./${name}'`).length - 1, 1, `${file} is imported once in index.ts`);
      const exported = /export const (\w+): FieldSet\[\]/.exec(readFileSync(`${dir}/${file}`, 'utf8'))?.[1];
      assert.ok(exported && index.includes(`...${exported},`), `${file} exports one array of field sets, spread into FIELD_SETS`);
    }
    // And the sets of a file that is registered are simply there: a function, its sheets, its page.
    const added = buildFieldCatalog([...FIELD_SETS, set('finance.funding.plan', [num('equity')])]);
    assert.deepEqual(fieldSetsOf(FN, added).map((s) => s.id), ['finance.funding.plan']);
  });

  it('gives a function that is not built a page as soon as it has a sheet', () => {
    assert.equal(functionHasSheets('legal.title'), true);
    assert.deepEqual(functionSections('legal.title'), ['standing', 'sheet', 'chain', 'checks', 'documents', 'connections']);
    assert.equal(functionHasSheets('legal.contracts'), false);
    assert.equal(menuFunctions('legal').find((fn) => fn.key === 'legal.contracts')!.built, false);
    assert.deepEqual(functionSections('legal.contracts'), []);
  });
});

describe('a catalog with a fault', () => {
  const faults = (sets: FieldSet[], rules: RuleRow[] = []) => catalogFaults(sets, rules);

  it('is refused for a ring, across sets and through a mirror', () => {
    const ring = [
      set('a', [computed('x', { op: 'field', key: 'y', at: { fn: FN, set: 'b', field: 'y' } })]),
      set('b', [computed('y', { op: 'add', left: { op: 'field', key: 'z' }, right: { op: 'const', value: 1 } }), { key: 'z', label: 'z', kind: 'number', sameAs: { fn: FN, set: 'a', field: 'x' } }]),
    ];
    assert.ok(faults(ring).some((f) => /in a ring: a::x → b::y → b::z → a::x/.test(f)), faults(ring).join('\n'));
    assert.ok(fieldOrder(buildFieldCatalog(ring)).cycle);
  });

  it('is refused for a mirror or a formula that points at nothing', () => {
    const said = faults([
      set('a', [
        { key: 'm', label: 'm', kind: 'number', sameAs: { fn: FN, set: 'nowhere', field: 'x' } },
        computed('c', { op: 'field', key: 'gone' }),
        computed('d', { op: 'sum_if', over: { records: 'not_a_set' }, column: 'amount', where: { column: 'status', is: 'equals', value: 'approved' } }),
        computed('e', { op: 'rate', table: 'no_such_rule' }),
        computed('f', { op: 'if', when: { field: 'missing_gate', is: 'true' }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } }),
        computed('g', { op: 'irr', over: { table: 'flows' }, date: 'on', amount: 'net' }),
      ]),
    ]).join('\n');
    for (const expected of ['a/m: reads nowhere/x', 'a/c: reads a/gone', 'a/d: reads not_a_set/amount', 'a/e: reads the rule "no_such_rule"', 'a/f: reads a/missing_gate', 'a/g: reads a/flows']) assert.ok(said.includes(expected), `${expected}\n${said}`);
  });

  it('is refused for the rest a catalog can get wrong', () => {
    const said = faults([
      set('a', [
        { key: 'note', label: 'Note', kind: 'longtext' },
        { key: 's', label: 's', kind: 'text', tier: 'situational' },
        { key: 'r', label: 'r', kind: 'ref' },
        { key: 'o', label: 'o', kind: 'enum', optionSet: 'no_list' },
        { key: 'w', label: 'w', kind: 'text', showWhen: { situation: 'no_situation' } },
        { key: 'dup', label: 'dup', kind: 'text' },
        { key: 'dup', label: 'dup', kind: 'text' },
        { key: 'usual', label: 'usual', kind: 'number', defaults: [{ value: 30, from: 'state_pack' }] },
      ]),
      set('land_site.parcel_identification', [num('x')]),
      { ...set('c', [num('x')]), fn: 'not.a.function' },
    ]).join('\n');
    for (const expected of ['a/note: a longtext field needs maxLength', 'a/s: a situational field needs showWhen', 'a/r: a ref field needs a target', 'a/o: option set "no_list"', 'a/w: showWhen names situation "no_situation"', 'a/dup: declared twice', 'a/usual: a usual value needs where it is written', 'a check already has this id', '"not.a.function" is not a function']) {
      assert.ok(said.includes(expected), `${expected}\n${said}`);
    }
  });
});

describe('the limits', () => {
  it('report, by field set, a sheet that always shows too much, a table that should be records, a statutory figure in a label and a choice that is not one', () => {
    const wide = set('wide', Array.from({ length: 13 }, (_, i) => num(`f${i}`)));
    const fine = set('fine', [...Array.from({ length: 12 }, (_, i) => num(`f${i}`)), num('extra', { tier: 'expert' })]);
    const tables = set('tables', [
      { key: 'seven', label: 'Seven', kind: 'table', columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, label: `c${i}`, kind: 'text' as const })) },
      { key: 'nocs', label: 'NOCs', kind: 'table', columns: [{ key: 'noc', label: 'NOC', kind: 'text' }, { key: 'valid_to', label: 'Valid to', kind: 'date' }] },
      { key: 'deposit_70_percent', label: 'Deposit', kind: 'number' },
      { key: 'height', label: 'Above 21 m', kind: 'boolean' },
      { key: 'status', label: 'Status', kind: 'enum', options: ['converted', 'Not applicable'] },
    ]);
    const breaches = catalogLimits([wide, fine, tables]);
    assert.deepEqual(breaches.map((b) => `${b.set}/${b.field ?? ''}:${b.limit}`), ['wide/:core_fields', 'tables/seven:wide_table', 'tables/nocs:table_is_records', 'tables/deposit_70_percent:statutory_number', 'tables/height:statutory_number', 'tables/status:option_not_applicable']);
  });
});

/* ==================================================================== */
/* Formulas                                                              */
/* ==================================================================== */

describe('formulas', () => {
  const v = (value: CheckFieldValue['value']): CheckFieldValue => ({ value, at: '', by: '' });
  const rows = { flows: v([{ on: '2026-01-01', net: -1000, kind: 'cost' }, { on: '2027-01-01', net: 1100, kind: 'sale' }, { on: '2027-01-01', net: 50, kind: 'cost' }]) };

  it('take the least and the most, leaving out what is not known', () => {
    const of = [{ op: 'field', key: 'a' }, { op: 'field', key: 'b' }, { op: 'const', value: 7 }] as CheckFormula[];
    assert.equal(evaluateFormula({ op: 'min', of }, { a: v(3) }), 3);
    assert.equal(evaluateFormula({ op: 'max', of }, { a: v(3), b: v(12) }), 12);
    assert.equal(evaluateFormula({ op: 'min', of: [{ op: 'field', key: 'a' }] }, {}), null);
  });

  it('choose by a condition, and give no answer where the condition cannot be told', () => {
    const slab: CheckFormula = { op: 'if', when: { left: { op: 'field', key: 'price' }, is: 'lte', right: { op: 'const', value: 4_500_000 } }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 5 } };
    assert.equal(evaluateFormula(slab, { price: v(4_000_000) }), 1);
    assert.equal(evaluateFormula(slab, { price: v(6_000_000) }), 5);
    assert.equal(evaluateFormula(slab, {}), null);
    const gate: CheckFormula = { op: 'if', when: { any: [{ field: 'kind', is: 'in', value: ['a', 'b'] }, { field: 'flag', is: 'true' }] }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } };
    assert.equal(evaluateFormula(gate, { kind: v('b') }), 1);
    assert.equal(evaluateFormula(gate, { kind: v('c'), flag: v(false) }), 0);
  });

  it('sum and count the rows that meet a condition', () => {
    assert.equal(evaluateFormula({ op: 'sum_if', over: { table: 'flows' }, column: 'net', where: { column: 'kind', is: 'equals', value: 'cost' } }, rows), -950);
    assert.equal(evaluateFormula({ op: 'count_if', over: { table: 'flows' }, where: { column: 'net', is: 'gt', value: 0 } }, rows), 2);
    assert.equal(evaluateFormula({ op: 'count_if', over: { table: 'flows' }, where: { column: 'kind', is: 'in', value: ['sale'] } }, {}), null);
  });

  it('work out a rate of return and a present value from dated flows', () => {
    const irr = evaluateFormula({ op: 'irr', over: { table: 'flows' }, date: 'on', amount: 'net' }, rows)!;
    assert.ok(Math.abs(irr - 15) < 0.01, `1,000 out and 1,150 back a year on is 15% (${irr})`);
    const npv = evaluateFormula({ op: 'npv', rate: { op: 'const', value: 15 }, over: { table: 'flows' }, date: 'on', amount: 'net' }, rows)!;
    assert.ok(Math.abs(npv) < 0.01, `and at 15% it is worth nothing (${npv})`);
    assert.equal(evaluateFormula({ op: 'irr', over: { table: 'flows' }, date: 'on', amount: 'net' }, { flows: v([{ on: '2026-01-01', net: 5 }]) }), null, 'money one way has no rate');
  });

  it('do sums on dates, and a computed field that yields a date keeps it as one', () => {
    const p = project();
    const sets = [
      set('dates', [
        { key: 'signed', label: 'Signed', kind: 'date' },
        computed('due', { op: 'add_days', date: { op: 'date', key: 'signed' }, days: { op: 'const', value: 28 } }, { yields: 'date' }),
        computed('renewal', { op: 'add_months', date: { op: 'date', key: 'signed' }, months: { op: 'const', value: 1 } }, { yields: 'date' }),
        computed('days_left', { op: 'subtract', left: { op: 'date', key: 'due' }, right: { op: 'today' } }),
      ]),
    ];
    write(p, sets, 'dates', { signed: '2026-01-31' });
    const { value } = sheet(p, sets, 'dates', [], new Date('2026-02-20T09:00:00Z'));
    assert.equal(value('due'), '2026-02-28');
    assert.equal(value('renewal'), '2026-02-28', 'a month on from the 31st is the month’s last day');
    assert.equal(value('days_left'), 8);
  });
});

/* ==================================================================== */
/* The rule table                                                        */
/* ==================================================================== */

describe('the rule table', () => {
  const row = (more: Partial<RuleRow>): RuleRow => ({ key: 'far_limit', label: 'FAR', jurisdiction: { state: 'Karnataka' }, value: 1.75, from: '2015-01-01', source: { regulation: 'Zoning regulations', clause: 'Table 9', page: 41 }, verified: false, ...more });
  const rows: RuleRow[] = [
    row({ when: { road_width_m: { min: 0, max: 12 } }, value: 1.75 }),
    row({ when: { road_width_m: { min: 12, max: 18 } }, value: 2.25, to: '2024-12-31' }),
    row({ when: { road_width_m: { min: 12, max: 18 } }, value: 2.5, from: '2025-01-01', verified: true, verifiedBy: 'A. Rao', verifiedOn: '2026-10-01' }),
    row({ jurisdiction: { state: 'Tamil Nadu' }, value: 2 }),
  ];

  it('gives the row for the place, the day and the band, and none where none applies', () => {
    const place = { state: 'Karnataka', city: 'Bengaluru' };
    assert.equal(ruleRow(rows, 'far_limit', place, '2026-10-12', { road_width_m: 9 })!.value, 1.75);
    assert.equal(ruleRow(rows, 'far_limit', place, '2024-06-01', { road_width_m: 12 })!.value, 2.25, 'a band takes its lower end');
    assert.equal(ruleRow(rows, 'far_limit', place, '2026-10-12', { road_width_m: 12 })!.value, 2.5, 'and the row in force that day');
    assert.equal(ruleRow(rows, 'far_limit', place, '2026-10-12', { road_width_m: 30 }), undefined);
    assert.equal(ruleRow(rows, 'far_limit', place, '2026-10-12', {}), undefined, 'a condition the row names has to be given');
    assert.equal(ruleRow(rows, 'far_limit', { state: 'Tamil Nadu' }, '2026-10-12', {})!.value, 2);
    assert.deepEqual(ruleRowFaults(rows), []);
    assert.ok(ruleRowFaults([row({ source: { regulation: '' } }), row({ verified: true })]).length >= 2);
  });

  it('is read by a formula, and the value says which row it came from and whether anybody verified it', () => {
    const p = project();
    const sets = [
      set('far', [
        num('road_width'),
        num('far_achieved'),
        computed('far_allowed', { op: 'rate', table: 'far_limit', where: { road_width_m: { field: 'road_width' } } }),
        {
          key: 'far_standing',
          label: 'FAR',
          kind: 'status',
          cases: [{ when: { kind: 'at_most', fields: ['far_achieved', 'far_allowed'], say: 'FAR achieved is {a} and {b} is allowed.', severity: 'high' }, label: 'Over the limit', tone: 'critical' }],
          otherwise: { label: 'Within the limit', tone: 'good' },
        },
      ]),
    ];
    assert.deepEqual(catalogFaults(sets, rows), []);
    write(p, sets, 'far', { road_width: 9, far_achieved: 2 });
    const narrow = sheet(p, sets, 'far', rows);
    assert.equal(narrow.value('far_allowed'), 1.75);
    assert.equal(narrow.value('far_standing'), 'Over the limit');
    assert.deepEqual(narrow.view('far_allowed').cites?.map((c) => [c.key, c.value, c.verified, c.source.clause]), [['far_limit', 1.75, false, 'Table 9']]);
    assert.equal(narrow.view('far_standing').cites?.[0]?.verified, false, 'a standing that reads the limit cites the same row');

    write(p, sets, 'far', { road_width: 15 });
    const wide = sheet(p, sets, 'far', rows);
    assert.equal(wide.value('far_allowed'), 2.5);
    assert.equal(wide.value('far_standing'), 'Within the limit');
    assert.equal(wide.view('far_allowed').cites?.[0]?.verified, true);
  });
});

/* ==================================================================== */
/* Rules, defaults, situations that follow                               */
/* ==================================================================== */

describe('rules', () => {
  it('compare in one direction, against a figure, under a condition, and across functions', () => {
    const p = project();
    const sets = [
      set(
        'consents',
        [num('allottees'), num('consented'), computed('needed', { op: 'multiply', left: { op: 'field', key: 'allottees' }, right: { op: 'const', value: 0.5 } }), num('shares'), { key: 'changing', label: 'Changing the plan', kind: 'boolean' }],
        {
          rules: [
            { kind: 'at_least', fields: ['consented', 'needed'], when: { field: { fn: FN, set: 'consents', field: 'changing' }, is: 'true' }, say: '{a} have consented and {b} are needed.', severity: 'high' },
            { kind: 'compare', fields: ['shares'], against: 100, tolerance: 0, say: 'Shares add to {a}, not {b}.', severity: 'medium' },
            { kind: 'at_most', fields: ['consented', 'title_extent'], at: { title_extent: { fn: 'legal.title', set: 'legal.title.holding', field: 'extent' } }, say: '{a} is more than {b}.', severity: 'low' },
          ],
        },
      ),
      ...FIELD_SETS,
    ];
    assert.deepEqual(catalogFaults(sets), []);
    write(p, sets, 'consents', { allottees: 100, consented: 40, shares: 90 });
    assert.deepEqual(sheet(p, sets, 'consents').reading.insights.map((i) => i.text), ['Shares add to 90, not 100.'], 'the consent rule waits for its condition');
    write(p, sets, 'consents', { changing: true });
    assert.deepEqual(sheet(p, sets, 'consents').reading.insights.map((i) => i.text), ['40 have consented and 50 are needed.', 'Shares add to 90, not 100.']);
    write(p, sets, 'legal.title.holding', { extent: '30 sqm' });
    assert.ok(sheet(p, sets, 'consents').reading.insights.some((i) => i.text === '40 is more than 30 sqm.'), 'a rule reads another function’s field by its address');
  });
});

describe('usual values', () => {
  it('stand in as assumed, feed what is worked out, are never counted, and give way to a real value', () => {
    const p = project();
    const sets = [
      set('search', [
        { key: 'years', label: 'Years searched', kind: 'number', defaults: [{ when: { field: { fn: FN, set: 'search', field: 'state_is_ka' }, is: 'true' }, value: 30, from: 'state_pack', cite: 'usual practice note' }, { value: 13, from: 'catalog', cite: 'the limitation period plus one' }] },
        { key: 'state_is_ka', label: 'In Karnataka', kind: 'boolean', required: false },
        computed('months', { op: 'multiply', left: { op: 'field', key: 'years' }, right: { op: 'const', value: 12 } }),
      ]),
    ];
    assert.deepEqual(catalogFaults(sets), []);
    const first = sheet(p, sets, 'search');
    assert.equal(first.view('years').state, 'assumed');
    assert.equal(first.value('years'), 13);
    assert.equal(first.value('months'), 156);
    assert.equal(first.view('years').missing, false);
    assert.equal(first.view('years').source?.kind, 'default');

    write(p, sets, 'search', { state_is_ka: true });
    assert.equal(sheet(p, sets, 'search').value('years'), 30, 'the first usual value whose condition holds');
    const page = readFunctionFields(p, FN, new Date(), buildFieldCatalog(sets));
    assert.equal(page.assumed, 1);
    assert.equal(page.counts.total, 0, 'an assumed value needs nobody');

    write(p, sets, 'search', { years: 42 });
    const typed = sheet(p, sets, 'search');
    assert.equal(typed.view('years').state, 'typed');
    assert.equal(typed.value('months'), 504);
  });
});

describe('a situation that follows from what is recorded', () => {
  it('is in play exactly when its condition holds, and nobody sets it', () => {
    const p = project();
    const sets = [
      set('people', [{ key: 'name', label: 'Name', kind: 'text' }, { key: 'alive', label: 'Living', kind: 'boolean' }], { records: { of: 'person', titleField: 'name', summaryFields: [] } }),
      set('estate', [{ key: 'succession', label: 'Succession paper', kind: 'text', showWhen: { situation: 'someone_deceased' } }, { key: 'co_owner_consent', label: 'Co-owner consent', kind: 'boolean', showWhen: { situation: 'several' } }], {
        situations: [
          { key: 'someone_deceased', label: 'An owner has died', scope: 'function', derive: { records: 'people', is: 'any', where: { column: 'alive', is: 'false' } } },
          { key: 'several', label: 'More than one owner', scope: 'function', derive: { records: 'people', is: 'at_least', n: 2 } },
        ],
      }),
    ];
    assert.deepEqual(catalogFaults(sets), []);
    const catalog = buildFieldCatalog(sets);
    const shown = (key: string) => sheet(p, sets, 'estate').view(key).shown;
    assert.equal(shown('succession'), 'hidden');
    addFieldRecord(p, 'people', { name: 'A', alive: true }, 'tester', {}, catalog);
    assert.equal(shown('co_owner_consent'), 'hidden');
    addFieldRecord(p, 'people', { name: 'B', alive: false }, 'tester', {}, catalog);
    assert.equal(shown('succession'), 'shown');
    assert.equal(shown('co_owner_consent'), 'shown');
    const page = readFunctionFields(p, FN, new Date(), catalog);
    assert.deepEqual(page.situations.map((s) => [s.situation.key, s.state]), [['someone_deceased', 'on'], ['several', 'on']]);
  });
});

/* ==================================================================== */
/* Match, stated by several, extending a shared record, expiry           */
/* ==================================================================== */

describe('a match', () => {
  it('pairs two lists and counts what either side is left with as needing a person', () => {
    const p = project();
    const sets = [
      set('demands', [{ key: 'ref', label: 'Demand', kind: 'text' }], { records: { of: 'demand', titleField: 'ref', summaryFields: [] } }),
      set('stages', [
        { key: 'plan', label: 'Stages', kind: 'table', columns: [{ key: 'stage', label: 'Stage', kind: 'text' }] },
        {
          key: 'demand_to_stage',
          label: 'Demands to stages',
          kind: 'table',
          display: 'match',
          required: false,
          columns: [{ key: 'demand', label: 'Demand', kind: 'ref', target: { set: 'demands' } }, { key: 'stage', label: 'Stage', kind: 'text' }],
          match: { left: { column: 'demand', label: 'Demands', of: { records: 'demands', field: 'ref' } }, right: { column: 'stage', label: 'Stages', of: { table: { fn: FN, set: 'stages', field: 'plan' }, column: 'stage' } } },
        },
      ]),
    ];
    assert.deepEqual(catalogFaults(sets), []);
    const catalog = buildFieldCatalog(sets);
    const d1 = addFieldRecord(p, 'demands', { ref: 'DN-01' }, 'tester', {}, catalog).record!;
    addFieldRecord(p, 'demands', { ref: 'DN-02' }, 'tester', {}, catalog);
    write(p, sets, 'stages', { plan: [{ stage: 'Plinth' }, { stage: 'First slab' }, { stage: 'Roof' }], demand_to_stage: [{ demand: d1.id, stage: 'Plinth' }] });

    const match = sheet(p, sets, 'stages').view('demand_to_stage').match!;
    assert.deepEqual(match.pairs.map((pair) => [pair.leftLabel, pair.rightLabel]), [['DN-01', 'Plinth']]);
    assert.deepEqual(match.left.leftover.map((i) => i.label), ['DN-02']);
    assert.deepEqual(match.right.leftover.map((i) => i.label), ['First slab', 'Roof']);
    const page = readFunctionFields(p, FN, new Date(), catalog);
    assert.equal(page.counts.unmatched, 3);
    assert.deepEqual(page.exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text), ['Demands: DN-02', 'Stages: First slab', 'Stages: Roof']);
  });
});

describe('one figure stated by several people', () => {
  it('is kept side by side, one record each, with the spread worked out and a standing over it', () => {
    const p = project();
    p.stakeholders.push({ id: 'stk_qs', name: 'Quantity surveyor', role: 'QS' }, { id: 'stk_le', name: 'Lender’s engineer', role: 'LIE' });
    const stated = statedBySeveral({ id: 'finance.funding.ctc_stated', fn: FN, title: 'Cost to complete', key: 'ctc', figure: { kind: 'money', dimension: 'money', currency: 'INR' }, tolerancePct: 5 });
    const sets = [stated.set, set('finance.funding.position', [num('drawn'), ...stated.fields])];
    assert.deepEqual(catalogFaults(sets), []);
    const catalog = buildFieldCatalog(sets);
    addFieldRecord(p, stated.set.id, { source: 'stk_qs', figure: '42 Cr', stated_on: '2026-09-30' }, 'tester', {}, catalog);
    assert.equal(sheet(p, sets, 'finance.funding.position').value('ctc_agreement'), 'Stated figures agree', 'one figure is no disagreement');
    addFieldRecord(p, stated.set.id, { source: 'stk_le', figure: '46 Cr', stated_on: '2026-10-05' }, 'tester', {}, catalog);
    const position = sheet(p, sets, 'finance.funding.position');
    assert.equal(position.value('ctc_low'), 420_000_000);
    assert.equal(position.value('ctc_high'), 460_000_000);
    assert.equal(position.value('ctc_spread'), 8.7);
    assert.equal(position.value('ctc_agreement'), 'Stated figures differ');
    assert.equal(position.view('ctc_low').text, '₹42 Cr');
    const page = readFunctionFields(p, FN, new Date(), catalog);
    assert.deepEqual(page.sheets[0]!.records!.map((r) => r.title), ['Quantity surveyor', 'Lender’s engineer'], 'each statement titled by who made it');
    assert.equal(page.counts.rule, 1);
  });
});

describe('a shared record', () => {
  it('is extended by a department with fields of its own, on the one record', () => {
    const extra: FieldSet = { id: 'commercial.buyers.party_more', fn: 'commercial.buyers', title: 'Customer', v: 1, extends: 'shared.parties', fields: [{ key: 'resident', label: 'Resident in India', kind: 'boolean', required: false }], rules: [] };
    const sets = [...FIELD_SETS, extra];
    assert.deepEqual(catalogFaults(sets), []);
    const catalog = buildFieldCatalog(sets);
    assert.ok(catalog.sets.get('shared.parties')!.fields.some((f) => f.key === 'resident'));
    assert.equal(catalog.sets.has(extra.id), false, 'it is not a sheet of its own');
    assert.ok(catalogFaults([...FIELD_SETS, { ...extra, fields: [{ key: 'name', label: 'Name', kind: 'text' }] }]).some((f) => /already has a field of this key/.test(f)));
  });

  it('are the ones the catalogs name, each a set that repeats', () => {
    const catalog = fieldCatalog();
    for (const id of ['shared.parties', 'shared.parcels', 'shared.buildings', 'shared.units', 'shared.drawings', 'shared.approvals', 'shared.matters', 'shared.contracts', 'shared.accounts']) assert.ok(catalog.sets.get(id)?.records, id);
  });
});

describe('a day that runs out', () => {
  it('is said on the function’s page when it has passed, or is within its lead time', () => {
    const p = project();
    const sets = [set('bg', [{ key: 'valid_until', label: 'Guarantee valid until', kind: 'date', expires: { leadDays: 30 } }])];
    const catalog = buildFieldCatalog(sets);
    const said = (day: string, now: string) => {
      write(p, sets, 'bg', { valid_until: day });
      return readFunctionFields(p, FN, new Date(now), catalog).exceptions.map((e) => `${e.tone}: ${e.text}`);
    };
    assert.deepEqual(said('2026-12-31', '2026-10-12T00:00:00Z'), []);
    assert.deepEqual(said('2026-11-01', '2026-10-12T00:00:00Z'), ['warning: Runs out on 2026-11-01']);
    assert.deepEqual(said('2026-10-01', '2026-10-12T00:00:00Z'), ['critical: Ran out on 2026-10-01']);
  });
});

/* ==================================================================== */
/* At the size the catalogs will be                                      */
/* ==================================================================== */

describe('at the size of a hundred functions', () => {
  // About 100 sets and 2,200 fields, each set with formulas over its own fields and one over its neighbour's.
  const big: FieldSet[] = Array.from({ length: 100 }, (_, s) =>
    set(`big.${s}`, [
      ...Array.from({ length: 18 }, (_, i) => num(`f${i}`, i >= 10 ? { tier: 'expert' as const, required: false } : {})),
      computed('total', { op: 'add', left: { op: 'field', key: 'f0' }, right: { op: 'field', key: 'f1' } }),
      computed('next', s < 99 ? { op: 'field', key: 'total', at: { fn: FN, set: `big.${s + 1}`, field: 'total' } } : { op: 'const', value: 0 }),
      computed('both', { op: 'add', left: { op: 'field', key: 'total' }, right: { op: 'field', key: 'next' } }),
      { key: 'standing', label: 'standing', kind: 'status', cases: [{ when: { kind: 'at_least', fields: ['total'], against: 1, say: 'x', severity: 'low' }, label: 'Low', tone: 'warning' }] },
    ]),
  );

  it('builds, checks and orders the whole catalog quickly, and reads one function without touching the rest', () => {
    const started = Date.now();
    const catalog = buildFieldCatalog(big);
    assert.deepEqual(catalogFaults(big, []), []);
    assert.equal(fieldOrder(catalog).cycle, undefined);
    assert.equal([...catalog.sets.values()].filter((s) => s.id.startsWith('big.')).reduce((n, s) => n + s.fields.length, 0), 2200);
    const whole = Date.now() - started;
    assert.ok(whole < 1500, `the whole catalog took ${whole} ms`);

    const p = project();
    for (const id of ['big.0', 'big.1']) setFieldValues(p, { set: id }, { f0: 1, f1: 2 }, 'tester', {}, catalog);
    // One sheet read: it resolves its own fields and the one neighbour its formula names, and nothing else of the hundred.
    let asked = 0;
    const counting = { ...catalog, sets: new Proxy(catalog.sets, { get: (target, name) => (name === 'get' ? (id: string) => (asked += 1, target.get(id)) : Reflect.get(target, name).bind?.(target) ?? Reflect.get(target, name)) }) };
    const at = Date.now();
    const reading = readSheet(p, 'big.0', undefined, undefined, counting as typeof catalog)!;
    assert.equal(reading.fields.find((f) => f.def.key === 'both')!.held?.value, 6);
    assert.ok(Date.now() - at < 200, `one sheet took ${Date.now() - at} ms`);
    assert.ok(asked < 200, `one sheet looked up a set ${asked} times, not once for every set in the catalog`);
  });

  it('shows of two hundred declared fields only what their tiers and conditions show', () => {
    const p = project();
    const sets = [
      set('long', [
        ...Array.from({ length: 10 }, (_, i) => num(`core${i}`)),
        ...Array.from({ length: 90 }, (_, i) => num(`sit${i}`, { showWhen: { situation: 'rare' } })),
        ...Array.from({ length: 100 }, (_, i) => num(`exp${i}`, { tier: 'expert', required: false })),
      ], { situations: [{ key: 'rare', label: 'Rare', scope: 'function' }] }),
    ];
    assert.deepEqual(catalogLimits(sets), []);
    const { reading } = sheet(p, sets, 'long');
    assert.equal(reading.fields.length, 200);
    assert.equal(reading.fields.filter((f) => f.shown === 'shown').length, 10);
    assert.equal(reading.fields.filter((f) => f.shown === 'folded').length, 100);
    assert.equal(reading.fields.filter((f) => f.missing).length, 10);
    assert.equal(reading.total, 10, 'and counts only what is in play and not folded away');
  });
});
