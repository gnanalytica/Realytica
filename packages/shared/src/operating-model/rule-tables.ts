/**
 * Reading the rule table: which row of a dated figure applies to a place, on
 * a day, under a set of conditions.
 *
 * A row applies where its place is the project's (every part of the place
 * the row names has to agree), every condition it names is met by what the
 * caller gives, and the day falls inside the time it is in force. Of several
 * that apply, the one that says most about the place and the conditions is
 * taken, and of those the latest in force.
 */

import type { RuleCitation, RuleRow } from './types';

export interface RulePlace {
  state?: string;
  city?: string;
  authority?: string;
}

const eq = (a: string | undefined, b: string | undefined): boolean => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

function applies(row: RuleRow, place: RulePlace, on: string, conditions: Record<string, string | number>): boolean {
  if (row.from > on || (row.to !== undefined && row.to < on)) return false;
  for (const part of ['state', 'city', 'authority'] as const) if (row.jurisdiction[part] && !eq(row.jurisdiction[part], place[part])) return false;
  for (const [name, wanted] of Object.entries(row.when ?? {})) {
    const given = conditions[name];
    if (given === undefined) return false;
    if (typeof wanted === 'string') {
      if (!eq(wanted, String(given))) return false;
      continue;
    }
    // A band takes its lower end and stops short of its upper, so two bands that meet never both apply.
    const n = Number(given);
    if (!Number.isFinite(n) || (wanted.min !== undefined && n < wanted.min) || (wanted.max !== undefined && n >= wanted.max)) return false;
  }
  return true;
}

const weight = (row: RuleRow): number => Object.values(row.jurisdiction).filter(Boolean).length * 10 + Object.keys(row.when ?? {}).length;

/** The row of a rule that applies, or undefined where none does. */
export function ruleRow(rows: readonly RuleRow[], key: string, place: RulePlace, on: string, conditions: Record<string, string | number> = {}): RuleRow | undefined {
  return rows
    .filter((row) => row.key === key && applies(row, place, on.slice(0, 10), conditions))
    .sort((a, b) => weight(b) - weight(a) || b.from.localeCompare(a.from))[0];
}

export function ruleCitation(row: RuleRow): RuleCitation {
  return { key: row.key, label: row.label, value: row.value, ...(row.unit ? { unit: row.unit } : {}), from: row.from, source: row.source, verified: row.verified };
}

/** Where a rule row is written, in a line: the regulation, its clause and page. */
export function ruleSourceSaid(source: RuleRow['source']): string {
  return [source.regulation, source.clause, source.page !== undefined ? `p. ${source.page}` : ''].filter(Boolean).join(', ');
}

/** What is wrong with a rule table, each fault in a sentence. Empty for one that can be used. */
export function ruleRowFaults(rows: readonly RuleRow[]): string[] {
  const faults: string[] = [];
  const day = /^\d{4}-\d{2}-\d{2}$/;
  rows.forEach((row, index) => {
    const at = `${row.key} (row ${index + 1})`;
    if (!row.key || !row.label) faults.push(`${at}: needs a key and a label.`);
    if (!day.test(row.from) || (row.to !== undefined && !day.test(row.to))) faults.push(`${at}: its dates are not days.`);
    if (row.to !== undefined && row.to < row.from) faults.push(`${at}: it ends before it begins.`);
    if (!row.source?.regulation?.trim()) faults.push(`${at}: needs the regulation it is written in.`);
    if (!Number.isFinite(row.value)) faults.push(`${at}: its value is not a number.`);
    if (row.verified && !row.verifiedBy) faults.push(`${at}: marked verified with nobody named.`);
    // Two rows for the same place and conditions may not be in force on the same day: nothing could choose between them.
    for (const other of rows.slice(index + 1)) {
      if (other.key !== row.key || JSON.stringify(other.jurisdiction) !== JSON.stringify(row.jurisdiction) || JSON.stringify(other.when ?? {}) !== JSON.stringify(row.when ?? {})) continue;
      const overlap = (row.to ?? '9999') >= other.from && (other.to ?? '9999') >= row.from;
      if (overlap && row.from === other.from) faults.push(`${at}: another row for the same place and conditions begins the same day.`);
    }
  });
  return faults;
}
