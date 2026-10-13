/**
 * The rule table as a list a firm admin can work down, and what checking a
 * row does.
 *
 * No built-in row is verified, and this test keeps it so: a row becomes
 * verified only as a firm's own, under the name of the person who read its
 * instrument, with the clause and the day read. The person and the clause
 * here are invented; the rows are the catalog's.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RULE_ROWS,
  addFieldRecord,
  checkRuleRow,
  createProject,
  fieldCatalog,
  firmRuleRows,
  lawRuleRowRef,
  readSheet,
  resolveFields,
  ruleRowFaults,
  ruleRowReaders,
  ruleRowsListed,
  setFieldValues,
  type LawRuleRowOffer,
} from '@realytica/shared';

const NOW = '2026-10-13T06:00:00.000Z';
const ADMIN = 'R. Admin (admin@example.com)';

describe('the rule rows, listed by the department that reads them', () => {
  const groups = ruleRowsListed();
  const every = new Set(groups.flatMap((group) => group.rows));

  it('lists every row of the table once or more, and none as verified', () => {
    assert.equal(every.size, RULE_ROWS.length);
    assert.equal([...every].filter((row) => row.verified).length, 0, 'no built-in row is verified');
    assert.equal(RULE_ROWS.filter((row) => row.verified).length, 0);
    assert.deepEqual(groups.map((group) => group.verified), groups.map(() => 0));
  });

  it('gives each row where it is written and the fields worked out from it', () => {
    for (const row of every) {
      assert.ok(row.source.regulation.trim(), `${row.key} names its regulation`);
      assert.ok(row.citation.startsWith(row.source.regulation), `${row.key} has a citation in a line`);
    }
    const majority = [...every].find((row) => row.key === 'age_of_majority_years')!;
    assert.deepEqual(
      majority.readBy.map((reader) => [reader.department, reader.set, reader.field]),
      [['legal', 'legal.title.owner_facts', 'majority_on']],
      'read by Title’s own addition to the owner, listed under Legal and not as a shared record',
    );
    assert.ok(groups.find((group) => group.department === 'legal')!.rows.includes(majority));
  });

  it('groups by department in a fixed order, and says which rows no field reads', () => {
    const order = groups.map((group) => group.department);
    assert.deepEqual(order, ['legal', 'finance', 'design', 'construction', 'procurement', 'commercial', 'shared', 'unread'].filter((key) => order.includes(key as never)));
    const readers = ruleRowReaders(fieldCatalog());
    for (const row of groups.find((group) => group.department === 'unread')?.rows ?? []) assert.equal(readers.get(row.key), undefined);
    for (const group of groups.filter((held) => held.department !== 'unread')) for (const row of group.rows) assert.ok(row.readBy.length > 0, `${row.key} under ${group.label} is read by a field`);
  });
});

describe('a firm admin marks a row checked', () => {
  const row = RULE_ROWS.find((held) => held.key === 'age_of_majority_years')!;

  it('refuses without the clause, the day read, or a name, and for a row that is not there', () => {
    const offers: LawRuleRowOffer[] = [];
    assert.throws(() => checkRuleRow(offers, lawRuleRowRef(row), { clause: '  ', readOn: '2026-10-12' }, ADMIN, NOW), /Say which clause/);
    assert.throws(() => checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3', readOn: '12-10-2026' }, ADMIN, NOW), /the day the instrument was read/);
    assert.throws(() => checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3', readOn: '2026-11-01' }, ADMIN, NOW), /cannot be ahead of today/);
    assert.throws(() => checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3', readOn: '2026-10-12' }, ' ', NOW), /named person/);
    assert.throws(() => checkRuleRow(offers, { ...lawRuleRowRef(row), from: '1900-01-01' }, { clause: 'section 3', readOn: '2026-10-12' }, ADMIN, NOW), /No rule row by that id/);
    assert.deepEqual(offers, []);
  });

  it('keeps the row as the firm’s own, verified by name with the clause and the day, and leaves the built-in table as it was', () => {
    const offers: LawRuleRowOffer[] = [];
    const offer = checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3(1)', readOn: '2026-10-12', page: 2 }, ADMIN, NOW);
    assert.deepEqual(
      { value: offer.row.value, clause: offer.row.source.clause, page: offer.row.source.page, verified: offer.row.verified, by: offer.row.verifiedBy, on: offer.row.verifiedOn },
      { value: row.value, clause: 'section 3(1)', page: 2, verified: true, by: ADMIN, on: '2026-10-12' },
    );
    assert.equal(row.verified, false, 'the built-in row is not touched');

    const firm = firmRuleRows(offers)!;
    assert.deepEqual(ruleRowFaults(firm), [], 'the firm’s table has one row for the place and day, not two');
    assert.equal(firm.filter((held) => held.key === row.key).length, RULE_ROWS.filter((held) => held.key === row.key).length);
    const listed = ruleRowsListed(firm).flatMap((group) => group.rows).find((held) => held.key === row.key)!;
    assert.deepEqual([listed.verified, listed.verifiedBy, listed.verifiedOn, listed.source.clause], [true, ADMIN, '2026-10-12', 'section 3(1)']);
    assert.throws(() => checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3', readOn: '2026-10-12' }, ADMIN, NOW, firm), /verified already/);
  });

  it('makes a figure worked out from it stop saying "not verified", on that firm’s table only', () => {
    const p = createProject({ name: 'Tank Bund Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-RR', 'lead@example.com');
    p.jurisdiction = 'Karnataka';
    const owner = addFieldRecord(p, 'legal.title.owners', { name: 'C. Vendor', share_pct: 100, capacity: 'minor through a guardian' }, 'lead@example.com').record!.id;
    assert.deepEqual(setFieldValues(p, { set: 'legal.title.owners', record: owner }, { date_of_birth: '2015-06-01' }, 'lead@example.com').rejected, []);
    const at = new Date('2026-10-12T00:00:00Z');
    const cites = (rows?: ReturnType<typeof firmRuleRows>) =>
      readSheet(p, 'legal.title.owners', owner, rows ? resolveFields(p, at, undefined, rows) : undefined, undefined, at)!
        .fields.find((view) => view.def.key === 'majority_on')!
        .cites!.map((cite) => [cite.key, cite.verified]);
    assert.deepEqual(cites(), [['age_of_majority_years', false]]);
    const offers: LawRuleRowOffer[] = [];
    checkRuleRow(offers, lawRuleRowRef(row), { clause: 'section 3(1)', readOn: '2026-10-12' }, ADMIN, NOW);
    assert.deepEqual(cites(firmRuleRows(offers)), [['age_of_majority_years', true]]);
    assert.deepEqual(cites(), [['age_of_majority_years', false]], 'another firm still reads the built-in row');
  });
});
