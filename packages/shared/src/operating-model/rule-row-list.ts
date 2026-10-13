/**
 * The rule table as a list a person can check.
 *
 * Every figure a law, a regulator or a standards body sets is a dated row
 * (`field-sets/rule-rows.ts`), and no built-in row is verified: each was
 * written from a summary of its instrument. This is the list a firm admin
 * works down: the rows by the department whose fields read them, each with
 * where it is written, what it is worth, which fields are worked out from
 * it, and whether somebody has read the instrument.
 *
 * Checking a row is the firm-verified mechanism the law watch already uses
 * (`law-change.ts`): the row, as read, becomes the firm's own beside its
 * other verified rows, under the name of the person who read it, with the
 * clause and the day read. The built-in table is never marked verified.
 */

import { DEPARTMENT_SHORT, type DepartmentKey } from './departments';
import { fieldCatalog, type FieldCatalog } from './field-registry';
import { RULE_ROWS } from './field-sets';
import { departmentOfFunction } from './field-sheets';
import { lawRuleRowAt, lawRuleRowRef, type LawRuleRowOffer, type LawRuleRowRef } from './law-change';
import { ruleSourceSaid } from './rule-tables';
import type { CheckFieldDef, FieldSet, RuleRow } from './types';

/** A field worked out from a rule row. */
export interface RuleRowReader {
  fn: string;
  department?: DepartmentKey;
  set: string;
  setTitle: string;
  field: string;
  label: string;
}

export interface RuleRowListed {
  /** What names the row when it is checked: its key, place, conditions and the day it begins. */
  ref: LawRuleRowRef;
  key: string;
  label: string;
  value: number;
  unit?: string;
  jurisdiction: RuleRow['jurisdiction'];
  when?: RuleRow['when'];
  from: string;
  to?: string;
  source: RuleRow['source'];
  /** The regulation, its clause and page, in a line. */
  citation: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  /** The fields worked out from any row of this key. */
  readBy: RuleRowReader[];
}

export interface RuleRowGroup {
  /** The department whose fields read the rows. `shared`: read by a record every department links to. `unread`: no field names the row yet. */
  department: DepartmentKey | 'shared' | 'unread';
  label: string;
  rows: RuleRowListed[];
  verified: number;
}

/** The rule tables a formula names, however deep in the tree. */
function ratesNamed(formula: unknown, into: Set<string>): void {
  if (!formula || typeof formula !== 'object') return;
  if (Array.isArray(formula)) {
    for (const part of formula) ratesNamed(part, into);
    return;
  }
  const node = formula as Record<string, unknown>;
  if (node.op === 'rate' && typeof node.table === 'string') into.add(node.table);
  for (const part of Object.values(node)) ratesNamed(part, into);
}

/** Every field of the catalog worked out from a rule row, by the row's key. */
export function ruleRowReaders(catalog: FieldCatalog = fieldCatalog()): Map<string, RuleRowReader[]> {
  const out = new Map<string, RuleRowReader[]>();
  const seen = new Set<string>();
  const read = (set: FieldSet, def: CheckFieldDef) => {
    if (!def.formula) return;
    const named = new Set<string>();
    ratesNamed(def.formula, named);
    const department = departmentOfFunction(set.fn);
    for (const key of named) {
      // A field a department adds to a shared record is that department's reading, listed once and under it.
      const at = `${key}|${set.extends ?? set.id}|${def.key}`;
      if (seen.has(at)) continue;
      seen.add(at);
      out.set(key, [...(out.get(key) ?? []), { fn: set.fn, ...(department ? { department } : {}), set: set.id, setTitle: set.title, field: def.key, label: def.label }]);
    }
  };
  const sets = [...[...catalog.extending.values()].flat(), ...catalog.sets.values()];
  for (const set of sets) {
    for (const def of set.fields) read(set, def);
    for (const sheet of set.sheets ?? []) for (const def of sheet.fields) read(set, def);
  }
  return out;
}

const GROUP_ORDER: ReadonlyArray<RuleRowGroup['department']> = ['legal', 'finance', 'design', 'construction', 'procurement', 'commercial', 'shared', 'unread'];

/**
 * The rule rows by department, each with its citation, its source and what
 * reads it. A row read by two departments is listed under both. `rows` is
 * the table a firm reads (`ruleRowsFor`), so a row the firm has checked
 * shows as verified with who checked it and when.
 */
export function ruleRowsListed(rows: readonly RuleRow[] = RULE_ROWS, catalog: FieldCatalog = fieldCatalog()): RuleRowGroup[] {
  const readers = ruleRowReaders(catalog);
  const groups = new Map<RuleRowGroup['department'], RuleRowListed[]>();
  for (const row of rows) {
    const readBy = readers.get(row.key) ?? [];
    const listed: RuleRowListed = {
      ref: lawRuleRowRef(row),
      key: row.key,
      label: row.label,
      value: row.value,
      ...(row.unit ? { unit: row.unit } : {}),
      jurisdiction: row.jurisdiction,
      ...(row.when ? { when: row.when } : {}),
      from: row.from,
      ...(row.to ? { to: row.to } : {}),
      source: row.source,
      citation: ruleSourceSaid(row.source),
      verified: row.verified,
      ...(row.verifiedBy ? { verifiedBy: row.verifiedBy } : {}),
      ...(row.verifiedOn ? { verifiedOn: row.verifiedOn } : {}),
      readBy,
    };
    const departments = new Set<RuleRowGroup['department']>(readBy.map((reader) => reader.department ?? 'shared'));
    if (!departments.size) departments.add('unread');
    for (const department of departments) groups.set(department, [...(groups.get(department) ?? []), listed]);
  }
  const label = (department: RuleRowGroup['department']): string => (department === 'shared' ? 'Shared records' : department === 'unread' ? 'Read by no field yet' : DEPARTMENT_SHORT[department]);
  return [...groups]
    .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
    .map(([department, listed]) => ({ department, label: label(department), rows: listed, verified: listed.filter((row) => row.verified).length }));
}

/** The longest a clause, as read, may be. */
export const RULE_CLAUSE_MOST = 200;

export interface RuleRowCheck {
  /** The clause the figure was read in, as the instrument numbers it. */
  clause: string;
  /** The day the instrument was read. */
  readOn: string;
  page?: number;
  url?: string;
}

/**
 * Mark a row of the rule table checked against its instrument, by name.
 *
 * The row as it stands is kept as the firm's own: the same figure, with the
 * clause it was read in, the day it was read and who read it. It joins the
 * firm's offered rows already verified, so the firm's table carries it in
 * place of the built-in row (`firmRuleRows`), and every figure worked out
 * from it on that firm's projects stops saying "not verified". Refused for a
 * row that is not on the table, one already verified, a clause left empty,
 * or a day that is not a day or has not come.
 *
 * `rows` is the table the firm reads now; `offers` its offered rows, which
 * the new one is added to.
 */
export function checkRuleRow(offers: LawRuleRowOffer[], ref: LawRuleRowRef, check: RuleRowCheck, by: string, now: string, rows: readonly RuleRow[] = RULE_ROWS): LawRuleRowOffer {
  const row = lawRuleRowAt(ref, rows);
  if (!row) throw new Error('No rule row by that id.');
  if (row.verified) throw new Error('This row was verified already.');
  const clause = check.clause?.trim();
  if (!clause) throw new Error('Say which clause the figure was read in.');
  if (clause.length > RULE_CLAUSE_MOST) throw new Error(`A clause is at most ${RULE_CLAUSE_MOST} characters.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(check.readOn ?? '') || Number.isNaN(Date.parse(`${check.readOn}T00:00:00Z`))) throw new Error('Say the day the instrument was read, as YYYY-MM-DD.');
  if (check.readOn > now.slice(0, 10)) throw new Error('The day the instrument was read cannot be ahead of today.');
  if (!by.trim()) throw new Error('A row is checked by a named person.');
  const source = { ...row.source, clause, ...(check.page !== undefined ? { page: check.page } : {}), ...(check.url ? { url: check.url } : {}) };
  const offer: LawRuleRowOffer = {
    id: `lrc_${Date.parse(now).toString(36)}_${offers.length.toString(36)}`,
    changeId: `checked:${row.key}`,
    supersedes: lawRuleRowRef(row),
    row: { ...row, source, verified: true, verifiedBy: by, verifiedOn: check.readOn },
    offeredBy: by,
    offeredAt: now,
  };
  offers.push(offer);
  return offer;
}
