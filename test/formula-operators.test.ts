/**
 * The formula operators that read lists: the latest of dated records, a
 * window of days, a table inside each record, several row conditions at once,
 * overlapping spans, a count as at a past day, a distinct count, and a match
 * side read from a table inside records.
 *
 * Each is asked directly (`evaluateFormula`) with rows written out here, so a
 * figure in the catalog that uses one rests on arithmetic this file states.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { addFieldRecord, createProject, daysCovered, evaluateFormula, fieldCatalogFor, ownRows, readMatch, resolveFields, rowMeets, setFieldValues, type CheckFieldDef, type CheckFieldValue, type CheckFormula, type FormulaOutside, type RowWhere } from '@realytica/shared';

const held = (value: unknown): CheckFieldValue => ({ value: value as CheckFieldValue['value'], at: '', by: 'tester' });
const record = (values: Record<string, unknown>): Record<string, CheckFieldValue> => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, held(value)]));
const outside = (sets: Record<string, Array<Record<string, CheckFieldValue>>>, own?: string): FormulaOutside => ({ read: () => undefined, records: (set) => sets[set], record: own, today: new Date('2026-10-13T06:00:00Z') });
const day = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

describe('several row conditions at once', () => {
  const both: RowWhere = { all: [{ column: 'standing', is: 'equals', value: 'sanctioned' }, { column: 'area', is: 'set' }] };
  const either: RowWhere = { any: [{ column: 'standing', is: 'equals', value: 'sanctioned' }, { column: 'area', is: 'gt', value: 100 }] };

  it('all of them hold, or any of them', () => {
    assert.equal(rowMeets({ standing: 'sanctioned', area: 50 }, both), true);
    assert.equal(rowMeets({ standing: 'sanctioned', area: null }, both), false);
    assert.equal(rowMeets({ standing: 'applied', area: 500 }, both), false);
    assert.equal(rowMeets({ standing: 'applied', area: 500 }, either), true);
    assert.equal(rowMeets({ standing: 'applied', area: 5 }, either), false);
  });

  it('count and sum over the rows that meet every one', () => {
    const rows = [record({ standing: 'sanctioned', area: 50 }), record({ standing: 'sanctioned' }), record({ standing: 'applied', area: 70 })];
    assert.equal(evaluateFormula({ op: 'count_if', over: { records: 'r' }, where: both }, {}, outside({ r: rows })), 1);
    assert.equal(evaluateFormula({ op: 'sum_if', over: { records: 'r' }, column: 'area', where: either }, {}, outside({ r: rows })), 50);
  });

  it('a join to the record asked from is settled inside either: unknown under all is no row, unknown under any is left out', () => {
    const joined: RowWhere = { all: [{ column: 'unit', is: 'own' }, { column: 'in_force', is: 'true' }] };
    assert.deepEqual(ownRows(joined, {}, 'u1'), { all: [{ column: 'unit', is: 'equals', value: 'u1' }, { column: 'in_force', is: 'true' }] });
    assert.equal(ownRows(joined, {}, undefined), null);
    assert.deepEqual(ownRows({ any: [{ column: 'unit', is: 'own' }, { column: 'in_force', is: 'true' }] }, {}, undefined), { any: [{ column: 'in_force', is: 'true' }] });
    const rows = [record({ unit: 'u1', in_force: true }), record({ unit: 'u1', in_force: false }), record({ unit: 'u2', in_force: true })];
    assert.equal(evaluateFormula({ op: 'count_if', over: { records: 'r' }, where: joined }, {}, outside({ r: rows }, 'u1')), 1);
  });
});

describe('the latest of dated records meeting a condition', () => {
  const rows = [
    record({ standing: 'sanctioned', sanctioned_on: '2026-03-01', units: 120, height: 45 }),
    record({ standing: 'sanctioned', sanctioned_on: '2026-08-15', units: 132 }),
    record({ standing: 'applied', applied_on: '2026-09-30', units: 150, height: 60 }),
    record({ standing: 'sanctioned', applied_on: '2026-01-10', units: 110 }),
  ];
  const latest = (field: string, where?: RowWhere, orBy?: string): CheckFormula => ({ op: 'records', set: 'r', reduce: 'latest', by: 'sanctioned_on', field, ...(orBy ? { orBy } : {}), ...(where ? { where } : {}) });
  const sanctioned: RowWhere = { column: 'standing', is: 'equals', value: 'sanctioned' };

  it('reads the field off the record dated last', () => {
    assert.equal(evaluateFormula(latest('units', sanctioned), {}, outside({ r: rows })), 132);
  });

  it('skips a record that does not meet the condition, however late it is', () => {
    assert.equal(evaluateFormula(latest('height', { all: [sanctioned, { column: 'height', is: 'set' }] }), {}, outside({ r: rows })), 45);
  });

  it('dates a record with no day by the other day named, and is nothing where none is dated', () => {
    assert.equal(evaluateFormula(latest('units', { column: 'units', is: 'equals', value: 110 }, 'applied_on'), {}, outside({ r: rows })), 110);
    assert.equal(evaluateFormula(latest('units', { column: 'units', is: 'equals', value: 110 }), {}, outside({ r: rows })), null);
    assert.equal(evaluateFormula(latest('units', sanctioned), {}, outside({ r: [] })), null);
  });

  it('reads a date field as its day', () => {
    assert.equal(evaluateFormula(latest('sanctioned_on', sanctioned), {}, outside({ r: rows })), day('2026-08-15'));
  });
});

describe('a window of days on a sum or a count', () => {
  const rows = [record({ on: '2026-06-30', amount: 100 }), record({ on: '2026-07-01', amount: 200 }), record({ on: '2026-09-30', amount: 400 }), record({ on: '2026-10-01', amount: 800 }), record({ amount: 1600 })];
  const values = { quarter_end: held('2026-09-30') };
  const quarter = { column: 'on', from: { op: 'add_months', date: { op: 'add_days', date: { op: 'date', key: 'quarter_end' }, days: { op: 'const', value: 1 } }, months: { op: 'const', value: -3 } }, to: { op: 'date', key: 'quarter_end' } } satisfies { column: string; from: CheckFormula; to: CheckFormula };

  it('takes the rows whose day falls on or between the two days, both ends counted', () => {
    assert.equal(evaluateFormula({ op: 'sum_if', over: { records: 'r' }, column: 'amount', where: { column: 'amount', is: 'set' }, between: quarter }, values, outside({ r: rows })), 600);
    assert.equal(evaluateFormula({ op: 'count_if', over: { records: 'r' }, where: { column: 'amount', is: 'set' }, between: quarter }, values, outside({ r: rows })), 2);
  });

  it('is open at an end left out, and leaves out a row with no day', () => {
    assert.equal(evaluateFormula({ op: 'sum_if', over: { records: 'r' }, column: 'amount', where: { column: 'amount', is: 'set' }, between: { column: 'on', to: { op: 'date', key: 'quarter_end' } } }, values, outside({ r: rows })), 700);
  });

  it('is no answer, not nought, while an end of the window is not recorded', () => {
    assert.equal(evaluateFormula({ op: 'sum_if', over: { records: 'r' }, column: 'amount', where: { column: 'amount', is: 'set' }, between: quarter }, {}, outside({ r: rows })), null);
  });
});

describe('a table kept inside each record, read as one list', () => {
  const demands = [
    record({ unit: 'u1', receipts: [{ received_on: '2026-07-10', amount: 500 }, { received_on: '2026-10-02', amount: 300 }] }),
    record({ unit: 'u2', receipts: [{ received_on: '2026-08-01', amount: 250 }] }),
    record({ unit: 'u3' }),
  ];

  it('sums a column over every record’s rows, inside a window', () => {
    const over = { records: 'd', table: 'receipts' };
    assert.equal(evaluateFormula({ op: 'sum_if', over, column: 'amount', where: { column: 'amount', is: 'set' } }, {}, outside({ d: demands })), 1050);
    assert.equal(evaluateFormula({ op: 'sum_if', over, column: 'amount', where: { column: 'amount', is: 'set' }, between: { column: 'received_on', from: { op: 'const', value: day('2026-07-01') }, to: { op: 'const', value: day('2026-09-30') } } }, {}, outside({ d: demands })), 750);
    assert.equal(evaluateFormula({ op: 'count_if', over, where: { column: 'amount', is: 'gt', value: 260 } }, {}, outside({ d: demands })), 2);
  });

  it('is no answer where the set is not known', () => {
    assert.equal(evaluateFormula({ op: 'sum_if', over: { records: 'none', table: 'receipts' }, column: 'amount', where: { column: 'amount', is: 'set' } }, {}, outside({})), null);
  });
});

describe('dated spans that overlap', () => {
  it('are counted once, both ends of each counted, and cut to a period', () => {
    assert.equal(daysCovered([{ from: 0, to: 9 }, { from: 5, to: 14 }, { from: 20, to: 20 }]), 16);
    assert.equal(daysCovered([{ from: 0, to: 9 }, { from: 10, to: 19 }]), 20, 'two that touch leave no gap and count no day twice');
    assert.equal(daysCovered([{ from: -50, to: 4 }, { from: 8, to: 500 }], { from: 0, to: 9 }), 7);
    assert.equal(daysCovered([{ from: 9, to: 3 }]), 0, 'a span that ends before it begins covers nothing');
  });

  it('as a formula: the days covered, and the days of a period left uncovered', () => {
    const values = { spans: held([{ from: '2026-01-01', to: '2026-01-20' }, { from: '2026-01-11', to: '2026-01-25' }, { from: '2026-03-01', to: '2026-03-01' }]), start: held('2026-01-01'), end: held('2026-01-31') };
    const within = { from: { op: 'date', key: 'start' }, to: { op: 'date', key: 'end' } } satisfies { from: CheckFormula; to: CheckFormula };
    assert.equal(evaluateFormula({ op: 'span_days', over: { table: 'spans' }, from: 'from', to: 'to', reduce: 'covered' }, values), 26);
    assert.equal(evaluateFormula({ op: 'span_days', over: { table: 'spans' }, from: 'from', to: 'to', within, reduce: 'covered' }, values), 25);
    assert.equal(evaluateFormula({ op: 'span_days', over: { table: 'spans' }, from: 'from', to: 'to', within, reduce: 'uncovered' }, values), 6);
    assert.equal(evaluateFormula({ op: 'span_days', over: { table: 'spans' }, from: 'from', to: 'to', reduce: 'uncovered' }, values), null, 'what a period leaves uncovered needs the period');
    assert.equal(evaluateFormula({ op: 'span_days', over: { table: 'spans' }, from: 'from', to: 'to', within, reduce: 'uncovered' }, { ...values, end: held(null) }), null);
  });
});

describe('a count as at a past day, and a distinct count', () => {
  const units = [
    record({ buyer: 'family-a', allotted_on: '2026-01-10' }),
    record({ buyer: 'family-a', allotted_on: '2026-02-01' }),
    record({ buyer: 'family-b', allotted_on: '2026-03-05', cancelled_on: '2026-04-01' }),
    record({ buyer: 'family-c', allotted_on: '2026-06-20' }),
    record({ allotted_on: '2026-01-15' }),
  ];
  const onDay = (iso: string, distinct?: string): CheckFormula => ({ op: 'count_if', over: { records: 'u' }, where: { column: 'allotted_on', is: 'set' }, asAt: { from: 'allotted_on', until: 'cancelled_on', on: { op: 'const', value: day(iso) } }, ...(distinct ? { distinct } : {}) });

  it('counts what had begun by that day and had not ended', () => {
    assert.equal(evaluateFormula(onDay('2026-03-10'), {}, outside({ u: units })), 4);
    assert.equal(evaluateFormula(onDay('2026-04-01'), {}, outside({ u: units })), 3, 'ended on the day itself is ended');
    assert.equal(evaluateFormula(onDay('2026-12-31'), {}, outside({ u: units })), 4);
    assert.equal(evaluateFormula(onDay('2025-12-31'), {}, outside({ u: units })), 0);
  });

  it('counts each value of a column once, and a row that names none not at all', () => {
    assert.equal(evaluateFormula(onDay('2026-03-10', 'buyer'), {}, outside({ u: units })), 2);
    assert.equal(evaluateFormula({ op: 'count_if', over: { records: 'u' }, where: { column: 'allotted_on', is: 'set' }, distinct: 'buyer' }, {}, outside({ u: units })), 3);
  });

  it('is no answer while the day asked about is not recorded', () => {
    assert.equal(evaluateFormula({ op: 'count_if', over: { records: 'u' }, where: { column: 'allotted_on', is: 'set' }, asAt: { from: 'allotted_on', on: { op: 'date', key: 'applied_on' } } }, {}, outside({ u: units })), null);
  });
});

describe('a match side read from a table inside records', () => {
  it('lists every name the table holds across the records, once each, and leaves over the ones no row pairs', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-FOP', 'lead@firm.example');
    const purchases = 'legal.contracts.purchases';
    assert.deepEqual(addFieldRecord(p, purchases, { deal: 'North parcel', vendors: [{ party: 'A. Vendor' }, { party: 'B. Vendor' }] }, 'lead@firm.example').rejected, []);
    assert.deepEqual(addFieldRecord(p, purchases, { deal: 'South parcel', vendors: [{ party: 'B. Vendor' }, { party: 'C. Vendor' }] }, 'lead@firm.example').rejected, []);
    const def: CheckFieldDef = {
      key: 'sellers_to_owners',
      label: 'Sellers and the owners they are',
      kind: 'table',
      display: 'match',
      columns: [
        { key: 'seller', label: 'Seller', kind: 'text' },
        { key: 'owner', label: 'Owner', kind: 'text' },
      ],
      match: { left: { column: 'seller', label: 'Sellers on the purchases', of: { records: purchases, table: 'vendors', column: 'party' } }, right: { column: 'owner', label: 'Owners', of: { records: purchases, table: 'vendors', column: 'party' }, optional: true } },
    };
    const catalog = fieldCatalogFor(p);
    const reading = readMatch(p, def, held([{ seller: 'A. Vendor', owner: 'A. Vendor' }]), resolveFields(p, new Date(), catalog), catalog)!;
    assert.deepEqual(reading.left.items.map((item) => item.label), ['A. Vendor', 'B. Vendor', 'C. Vendor']);
    assert.deepEqual(reading.left.leftover.map((item) => item.label), ['B. Vendor', 'C. Vendor']);
  });
});

describe('the operators in the catalog', () => {
  const LEAD = 'lead@firm.example';
  const fresh = () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-FOQ', LEAD);
    p.jurisdiction = 'Karnataka';
    return p;
  };
  const add = (p: ReturnType<typeof fresh>, set: string, values: Record<string, unknown>) => {
    const out = addFieldRecord(p, set, values, LEAD);
    assert.deepEqual(out.rejected, [], set);
    return out.record!.id;
  };

  it('Finance reads what Collections received in the quarter, receipt by receipt off every demand', () => {
    const p = fresh();
    const unit = add(p, 'shared.units', { number: 'A-101', tower: 'A', floor: 1 });
    add(p, 'commercial.buyers.demands', { unit, settled_by: [{ receipt_no: 'R-1', received_on: '2026-07-04', amount: 500_000 }, { receipt_no: 'R-2', received_on: '2026-10-02', amount: 300_000 }] });
    add(p, 'commercial.buyers.demands', { unit, settled_by: [{ receipt_no: 'R-3', received_on: '2026-09-30', amount: 250_000 }] });
    const resolved = resolveFields(p, new Date('2026-10-13T06:00:00Z'));
    const at = { fn: 'finance.funding', set: 'finance.funding.rera_deposit', field: 'receipts_in_quarter' };
    assert.equal(resolved.read(at)?.value ?? null, null, 'no figure until the quarter is named');
    // The quarter is asked about once a designated account is kept.
    add(p, 'shared.accounts', { name: 'Designated account', purpose: 'RERA designated' });
    assert.deepEqual(setFieldValues(p, { set: 'finance.funding.rera_cost' }, { quarter_end: '2026-09-30' }, LEAD).rejected, []);
    assert.equal(resolveFields(p, new Date('2026-10-13T06:00:00Z')).read(at)?.value, 750_000);
  });

  it('Liaison reads how many units Sales had allotted by the day a revision was applied for', () => {
    const p = fresh();
    for (const [number, allotted] of [['A-101', '2026-03-01'], ['A-102', '2026-06-15'], ['A-103', '2026-09-01']] as const) add(p, 'shared.units', { number, tower: 'A', floor: 1, sale_released: true, sale_allotted_on: allotted });
    add(p, 'shared.units', { number: 'A-104', tower: 'A', floor: 1 });
    const revision = add(p, 'legal.approvals.revisions', { revision_no: 'R1', reason: 'more_floors', applied_on: '2026-07-01' });
    const read = resolveFields(p, new Date('2026-10-13T06:00:00Z')).read({ fn: 'legal.approvals', set: 'legal.approvals.revisions', record: revision, field: 'units_allotted_at_application' });
    assert.equal(read?.value, 2);
  });
});
