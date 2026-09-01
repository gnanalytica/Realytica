/**
 * The schema catalogue has to stay attached to the checks it describes.
 *
 * The first version of this file did not exist, and seven of fourteen schema
 * declarations were keyed to check ids that were never real — `approvals.*`
 * when the scope is `regulatory`, `financial.*` when it is `cost_quantity`.
 * Nothing failed. The declarations simply sat there describing nothing, and
 * the checks they were meant for showed a comment box, exactly as before.
 *
 * That is the same failure the graph ontology had — a vocabulary declared and
 * never emitted — and it is invisible for the same reason: a lookup that
 * misses returns undefined, and undefined is a legal answer everywhere the
 * schema is read. So it is made impossible here rather than watched for.
 *
 * The rest of this file holds the properties a schema has to have to be worth
 * declaring: keys that resolve, formulas that reference real fields, tables
 * whose columns are storable, and units on anything a person could otherwise
 * misread by a factor of ten thousand.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECK_DEFINITIONS,
  CHECK_FIELDS,
  CHECK_INSIGHT_RULES,
  SCOPE_DEFINITIONS,
  areaBasisIsUndefined,
  checkInsights,
  evaluateFormula,
  validateFieldValue,
  type CheckFieldDef,
  type CheckFormula,
} from '@realytica/shared';

const REAL_IDS = new Set(CHECK_DEFINITIONS.map((c) => c.id));

describe('every declaration describes a check that exists', () => {
  it('has no field schema keyed to a check that is not real', () => {
    const dead = Object.keys(CHECK_FIELDS).filter((key) => !REAL_IDS.has(key));
    assert.deepEqual(dead, [], `these describe nothing: ${dead.join(', ')}`);
  });

  it('has no insight rule keyed to a check that is not real', () => {
    const dead = Object.keys(CHECK_INSIGHT_RULES).filter((key) => !REAL_IDS.has(key));
    assert.deepEqual(dead, [], `these fire for nothing: ${dead.join(', ')}`);
  });

  it('has no insight rule on a check with no fields to read', () => {
    const orphaned = Object.keys(CHECK_INSIGHT_RULES).filter((key) => !CHECK_FIELDS[key]?.length);
    assert.deepEqual(orphaned, []);
  });

  it('reaches the check definitions rather than sitting in the table', () => {
    // The declaration is only real once `checks()` has attached it.
    const declared = Object.keys(CHECK_FIELDS).length;
    const attached = CHECK_DEFINITIONS.filter((c) => c.fields?.length).length;
    assert.equal(attached, declared);
  });
});

describe('every rule reads fields that exist on its own check', () => {
  it('names only declared field keys', () => {
    const problems: string[] = [];
    for (const [checkId, rules] of Object.entries(CHECK_INSIGHT_RULES)) {
      const keys = new Set((CHECK_FIELDS[checkId] ?? []).map((f) => f.key));
      for (const rule of rules) {
        for (const key of rule.fields) {
          if (!keys.has(key)) problems.push(`${checkId}: rule reads "${key}", which the check does not record`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it('states a tolerance on every comparison', () => {
    // A tolerance is a judgement somebody should be able to argue with. An
    // implicit default is one nobody can find to argue with.
    const problems: string[] = [];
    for (const [checkId, rules] of Object.entries(CHECK_INSIGHT_RULES)) {
      for (const rule of rules) {
        if (rule.kind === 'compare' && rule.tolerance === undefined) problems.push(`${checkId} compares without saying how close is close enough`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

describe('every field is storable and legible', () => {
  const allFields: { checkId: string; field: CheckFieldDef }[] = [];
  for (const [checkId, fields] of Object.entries(CHECK_FIELDS)) for (const field of fields) allFields.push({ checkId, field });

  it('gives every enum something to choose from', () => {
    const problems = allFields
      .filter(({ field }) => (field.kind === 'enum' || field.kind === 'multi_enum') && !field.options?.length)
      .map(({ checkId, field }) => `${checkId}.${field.key}`);
    assert.deepEqual(problems, []);
  });

  it('puts a unit on every money and area figure', () => {
    // 1,208 is a very different fact in sqm and in sqft, and a report that
    // prints the number without the unit has said neither.
    const problems = allFields
      .filter(({ field }) => (field.kind === 'money' || field.kind === 'area') && !field.unit)
      .map(({ checkId, field }) => `${checkId}.${field.key}`);
    assert.deepEqual(problems, []);
  });

  it('gives every table columns, and never a table inside one', () => {
    for (const { checkId, field } of allFields) {
      if (field.kind !== 'table') continue;
      assert.ok(field.columns?.length, `${checkId}.${field.key} is a table with no columns`);
      for (const column of field.columns) {
        assert.notEqual(column.kind, 'table', `${checkId}.${field.key}.${column.key} nests a table`);
        assert.notEqual(column.kind, 'computed', `${checkId}.${field.key}.${column.key} computes inside a row`);
      }
    }
  });

  it('gives every computed field a formula, and no formula to anything else', () => {
    for (const { checkId, field } of allFields) {
      if (field.kind === 'computed') assert.ok(field.formula, `${checkId}.${field.key} computes nothing`);
      else assert.equal(field.formula, undefined, `${checkId}.${field.key} carries a formula it will never run`);
    }
  });

  it('never has two fields on one check sharing a key', () => {
    for (const [checkId, fields] of Object.entries(CHECK_FIELDS)) {
      const keys = fields.map((f) => f.key);
      assert.equal(new Set(keys).size, keys.length, `${checkId} has a duplicate field key`);
    }
  });

  it('has every formula reading fields the same check records', () => {
    const walk = (formula: CheckFormula, keys: Set<string>, tables: Map<string, Set<string>>, where: string) => {
      switch (formula.op) {
        case 'const':
          return;
        case 'field':
          assert.ok(keys.has(formula.key), `${where} reads "${formula.key}", which is not on this check`);
          return;
        case 'sum':
          assert.ok(tables.has(formula.table), `${where} sums "${formula.table}", which is not a table here`);
          assert.ok(tables.get(formula.table)!.has(formula.column), `${where} sums a column "${formula.column}" that table does not have`);
          return;
        case 'count':
          assert.ok(tables.has(formula.table), `${where} counts "${formula.table}", which is not a table here`);
          return;
        case 'days_between':
          assert.ok(keys.has(formula.left) && keys.has(formula.right), `${where} dates a span between fields this check does not record`);
          return;
        default:
          walk(formula.left, keys, tables, where);
          walk(formula.right, keys, tables, where);
      }
    };
    for (const [checkId, fields] of Object.entries(CHECK_FIELDS)) {
      const keys = new Set(fields.map((f) => f.key));
      const tables = new Map(fields.filter((f) => f.kind === 'table').map((f) => [f.key, new Set((f.columns ?? []).map((c) => c.key))]));
      for (const field of fields) {
        if (field.formula) walk(field.formula, keys, tables, `${checkId}.${field.key}`);
      }
    }
  });
});

describe('coverage across the catalogue', () => {
  it('records typed values on every scope, not just the ones that were easy', () => {
    const bare = SCOPE_DEFINITIONS.filter((scope) => !CHECK_DEFINITIONS.some((c) => c.scopeKey === scope.key && c.fields?.length)).map((s) => s.key);
    assert.deepEqual(bare, [], `these scopes record nothing but prose: ${bare.join(', ')}`);
  });

  it('leaves the judgement checks alone', () => {
    // The inverse claim, and the one that keeps this honest: a schema on
    // every check would mean somebody invented numbers for questions that
    // do not have any.
    const untyped = CHECK_DEFINITIONS.filter((c) => !c.fields?.length);
    assert.ok(untyped.length > 0, 'a schema on all 62 would mean numbers were invented for judgements');
  });
});

describe('formulas compute, and stay silent when they cannot', () => {
  const at = '2026-09-01T00:00:00.000Z';
  const val = (value: number | string) => ({ value, at, by: 'x' });

  it('works out a variance the way a cost report would', () => {
    const f: CheckFormula = { op: 'variance_pct', left: { op: 'field', key: 'now' }, right: { op: 'field', key: 'was' } };
    assert.equal(evaluateFormula(f, { now: val(110), was: val(100) }), 10);
  });

  it('returns null rather than zero when an input is missing', () => {
    // A variance against a figure nobody recorded is an unanswered question,
    // not zero variance, and the two must never render the same.
    const f: CheckFormula = { op: 'variance_pct', left: { op: 'field', key: 'now' }, right: { op: 'field', key: 'was' } };
    assert.equal(evaluateFormula(f, { now: val(110) }), null);
  });

  it('refuses to divide by zero', () => {
    const f: CheckFormula = { op: 'divide', left: { op: 'field', key: 'a' }, right: { op: 'field', key: 'b' } };
    assert.equal(evaluateFormula(f, { a: val(1), b: val(0) }), null);
  });

  it('sums and counts a table', () => {
    const rows = { value: [{ v: 10 }, { v: 5 }, { v: 2.5 }], at, by: 'x' };
    assert.equal(evaluateFormula({ op: 'sum', table: 't', column: 'v' }, { t: rows }), 17.5);
    assert.equal(evaluateFormula({ op: 'count', table: 't' }, { t: rows }), 3);
    assert.equal(evaluateFormula({ op: 'count', table: 't' }, {}), null);
  });

  it('counts days between two dates', () => {
    assert.equal(evaluateFormula({ op: 'days_between', left: 'a', right: 'b' }, { a: val('2026-01-31'), b: val('2026-01-01') }), 30);
  });
});

describe('the new kinds validate', () => {
  it('takes a multi-select from a list or a comma string, and refuses what is off it', () => {
    const def: CheckFieldDef = { key: 'x', label: 'Registries', kind: 'multi_enum', options: ['District court', 'NCLT'] };
    assert.deepEqual(validateFieldValue(def, ['NCLT']), { value: ['NCLT'] });
    assert.deepEqual(validateFieldValue(def, 'District court, NCLT'), { value: ['District court', 'NCLT'] });
    const bad = validateFieldValue(def, ['Star Chamber']);
    assert.ok('error' in bad);
    assert.match(bad.error, /District court, NCLT/);
  });

  it('validates a table row by row, naming the row that failed', () => {
    const def: CheckFieldDef = {
      key: 't',
      label: 'Chain',
      kind: 'table',
      columns: [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'extent', label: 'Extent', kind: 'area', unit: 'sqm' },
      ],
    };
    assert.ok(!('error' in validateFieldValue(def, [{ date: '1994-06-02', extent: 1208 }])));
    const bad = validateFieldValue(def, [{ date: '1994-06-02' }, { date: 'sometime in the nineties' }]);
    assert.ok('error' in bad);
    assert.match(bad.error, /row 2/);
  });

  it('rejects a column the table does not have', () => {
    const def: CheckFieldDef = { key: 't', label: 'Chain', kind: 'table', columns: [{ key: 'date', label: 'Date', kind: 'date' }] };
    const bad = validateFieldValue(def, [{ vibes: 'good' }]);
    assert.ok('error' in bad);
    assert.match(bad.error, /no column "vibes"/);
  });

  it('refuses to let anything write a computed field', () => {
    const def: CheckFieldDef = { key: 'c', label: 'Margin', kind: 'computed', formula: { op: 'const', value: 1 } };
    const bad = validateFieldValue(def, 42);
    assert.ok('error' in bad);
    assert.match(bad.error, /worked out from the other values/);
  });

  it('holds a number inside its declared bounds', () => {
    const def: CheckFieldDef = { key: 'p', label: 'Progress', kind: 'percent', unit: '%', min: 0, max: 100 };
    assert.ok('error' in validateFieldValue(def, 140));
    assert.deepEqual(validateFieldValue(def, 60), { value: 60 });
  });
});

describe('a stated area basis carries the figure that can be checked', () => {
  /*
   * The defect this replaced: `carpet`, `built-up` and `super built-up` were
   * offered as three equivalent bases. Only the first has a statutory
   * definition, and the third has none at all — the loading applied to reach it
   * is at the seller's discretion. A valuation quoting the third and nothing
   * else has stated a number nobody can arrive at independently.
   */
  const subject = CHECK_FIELDS['indicative_valuation.subject']!;
  const rules = CHECK_INSIGHT_RULES['indicative_valuation.subject']!;
  const key = (k: string) => subject.find((f) => f.key === k);

  it('records the quoted basis and the RERA carpet figure as different fields', () => {
    assert.ok(key('quoted_basis'), 'what the market said');
    assert.ok(key('rera_carpet_area'), 'and what can be verified');
    assert.equal(key('area_basis'), undefined, 'the single conflated field is gone');
  });

  it('asks for the carpet area only when the quote is on a basis without one', () => {
    const rule = rules.find((r) => r.kind === 'require_if' && r.fields[1] === 'rera_carpet_area')!;
    assert.ok(rule);
    assert.deepEqual(rule.whenIn, ['built-up', 'super built-up']);
    assert.ok(!rule.whenIn!.includes('carpet'), 'a carpet quote already is the carpet figure');
  });

  it('derives that gate list from the standards module rather than restating it', () => {
    // Two hand-maintained lists of the same fact drift, and the one that drifts
    // is always the one guarding the warning.
    const rule = rules.find((r) => r.kind === 'require_if' && r.fields[1] === 'rera_carpet_area')!;
    for (const basis of rule.whenIn!) assert.equal(areaBasisIsUndefined(basis), true);
  });

  it('keeps the RERA figure optional so the check is not blocked by it', () => {
    // It is an insight, not a gate. A valuer who cannot get the carpet area
    // should be told the quote is unverifiable, not prevented from recording
    // what the brochure said.
    assert.equal(key('rera_carpet_area')!.required, false);
    assert.equal(key('ipms_basis')!.required, false);
  });
});

describe('a conditional requirement fires on the answer, not on the blank', () => {
  const at = '2026-09-01T00:00:00.000Z';
  const defs: CheckFieldDef[] = [
    { key: 'basis', label: 'Basis', kind: 'enum', options: ['carpet', 'super built-up'] },
    { key: 'carpet', label: 'Carpet area', kind: 'area', unit: 'sqm', required: false },
  ];
  const rule = { kind: 'require_if' as const, fields: ['basis', 'carpet'], whenIn: ['super built-up'], severity: 'high' as const, say: 'Quoted on {a}, with no carpet figure.' };

  it('fires when the gate is answered the way that needs the second field', () => {
    const out = checkInsights(defs, { basis: { value: 'super built-up', at, by: 'x' } }, [rule]);
    assert.equal(out.length, 1);
    assert.match(out[0]!.text, /super built-up/);
    assert.deepEqual(out[0]!.fields, ['basis', 'carpet']);
  });

  it('stays silent when the gate is answered the other way', () => {
    assert.deepEqual(checkInsights(defs, { basis: { value: 'carpet', at, by: 'x' } }, [rule]), []);
  });

  it('stays silent while the gate itself is unanswered', () => {
    // An unanswered gate is a question, not a shortfall. Demanding the
    // consequence of an answer nobody has given yet is how a form nags.
    assert.deepEqual(checkInsights(defs, { carpet: { value: null, at, by: 'x' } }, [rule]), []);
  });

  it('stops once the second field is filled', () => {
    const values = { basis: { value: 'super built-up', at, by: 'x' }, carpet: { value: 950, at, by: 'x' } };
    assert.deepEqual(checkInsights(defs, values, [rule]), []);
  });
});
