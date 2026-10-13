/**
 * Short hands for declaring the Finance, Tax, Lenders and Ledgers field
 * sets: a field of each kind, and the parts of a formula. They add nothing a
 * field set could not write out in full.
 */

import type { CheckFieldDef, CheckFormula, CheckInsightRule, FieldAddress, FormulaCondition, OptionSet, RefTarget, RowCondition, ShowWhen, Tone } from '../../types';

export const FIN = 'finance.funding';
export const TAX = 'finance.tax';
export const LEN = 'finance.lenders';
export const LED = 'finance.ledgers';

type More = Partial<CheckFieldDef>;

const INR = { dimension: 'money', currency: 'INR' } as const;

export const text = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'text', ...more });
export const money = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'money', ...INR, ...more });
export const percent = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'percent', ...more });
export const count = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'number', ...more });
export const day = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'date', ...more });
export const months = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'duration', unit: 'months', ...more });
/** A thing that was done or was not. */
export const tick = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'boolean', control: 'tick', required: false, ...more });
export const choice = (key: string, label: string, optionSet: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'enum', optionSet, ...more });
export const link = (key: string, label: string, target: RefTarget, more: More = {}): CheckFieldDef => ({ key, label, kind: 'ref', target, ...more });
export const paper = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, ...more });
export const worked = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, ...more });
export const rupees = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { ...INR, ...more });
export const share = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { unit: '%', ...more });
export const standing = (key: string, label: string, cases: NonNullable<CheckFieldDef['cases']>, otherwise: { label: string; tone: Tone }, more: More = {}): CheckFieldDef => ({ key, label, kind: 'status', cases, otherwise, ...more });
/** A field read here and entered where the address says. */
export const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: More = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });

export const options = (id: string, label: string, list: Array<[key: string, label: string, tone?: Tone]>): OptionSet => ({
  id,
  label,
  options: list.map(([key, said, tone]) => ({ key, label: said, ...(tone ? { tone } : {}) })),
});

export const rule = (kind: CheckInsightRule['kind'], fields: string[], say: string, severity: CheckInsightRule['severity'], more: Partial<CheckInsightRule> = {}): CheckInsightRule => ({ kind, fields, say, severity, ...more });

/* --- formulas ------------------------------------------------------- */

export const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
export const f = (key: string): CheckFormula => ({ op: 'field', key });
/** A field of another set. */
export const far = (address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address });
export const n = (value: number): CheckFormula => ({ op: 'const', value });
export const plus = (...parts: CheckFormula[]): CheckFormula => parts.reduce((left, right) => ({ op: 'add', left, right }));
export const minus = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
export const times = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'multiply', left, right });
export const over = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'divide', left, right });
/** The first as a percentage of the second. */
export const asPct = (part: CheckFormula, whole: CheckFormula): CheckFormula => times(over(part, whole), n(100));
/** That percentage of an amount. */
export const pctOf = (amount: CheckFormula, pct: CheckFormula): CheckFormula => over(times(amount, pct), n(100));
export const least = (...of: CheckFormula[]): CheckFormula => ({ op: 'min', of });
export const most = (...of: CheckFormula[]): CheckFormula => ({ op: 'max', of });
export const when = (condition: FormulaCondition, then: CheckFormula, otherwise: CheckFormula): CheckFormula => ({ op: 'if', when: condition, then, else: otherwise });
/** One field summed over the records of a set. */
export const sumOf = (set: string, field: string): CheckFormula => ({ op: 'records', set, reduce: 'sum', field });
/** A figure a regulation sets, from the rule table, in force on the day a date field of the set holds (today where none is named). */
export const rate = (table: string, on?: string, where?: Record<string, { field: string } | { value: string | number }>): CheckFormula => ({ op: 'rate', table, ...(on ? { on } : {}), ...(where ? { where } : {}) });
export const dateOf = (key: string): CheckFormula => ({ op: 'date', key });
export const today: CheckFormula = { op: 'today' };

/** No answer: what a branch gives where nothing can be worked out, in place of a zero nobody recorded. */
export const nothing: CheckFormula = over(n(0), n(0));
/** A field's amount, or zero where nothing is recorded under it: for a part that may fairly be left empty. */
export const orZero = (key: string): CheckFormula => most(f(key), n(0));
/** The size of a difference, whichever way it runs. */
export const sizeOf = (amount: CheckFormula): CheckFormula => most(amount, minus(n(0), amount));
/** The lower of two amounts, and no answer until both are known. */
export const lowerOfBoth = (a: CheckFormula, b: CheckFormula): CheckFormula => plus(least(a, b), times(n(0), plus(a, b)));
const sumWhere = (set: string, column: string, where: RowCondition): CheckFormula => ({ op: 'sum_if', over: { records: set }, column, where });
export const countWhere = (set: string, where: RowCondition): CheckFormula => ({ op: 'count_if', over: { records: set }, where });
export const addDays = (date: CheckFormula, by: CheckFormula): CheckFormula => ({ op: 'add_days', date, days: by });
export const addMonths = (date: CheckFormula, by: CheckFormula): CheckFormula => ({ op: 'add_months', date, months: by });
export const area = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], ...more });
/** A field shown only while its condition holds. */
export const only = (showWhen: ShowWhen, def: CheckFieldDef): CheckFieldDef => ({ ...def, tier: 'situational', showWhen });
/** For an amount that may run below zero: an overdrawn balance, a net outflow, a credit balance in the books. */
export const SIGNED = { min: -1_000_000_000_000_000 } as const;

/** Whether any record of a set states a field: asked through the field, so the catalog can check it is there. */
const anyStates = (set: string, field: string): FormulaCondition => ({ left: countWhere(set, { column: field, is: 'set' }), is: 'gt', right: n(0) });
/** One field summed over the records of a set, and no answer until a record states it: a total of nothing is not a zero somebody recorded. */
export const totalOf = (set: string, field: string): CheckFormula => when(anyStates(set, field), sumOf(set, field), nothing);
export const totalWhere = (set: string, column: string, where: RowCondition): CheckFormula => when(anyStates(set, column), sumWhere(set, column, where), nothing);
/** How many records of a set meet a condition, and no answer until a record states what the condition reads. */
export const tallyWhere = (set: string, where: RowCondition): CheckFormula => when(anyStates(set, where.column), countWhere(set, where), nothing);
/** A figure that stands at zero once a record of a set states a field, and has no answer before: nothing drawn on a facility is a zero, nothing drawn with no facility is not. */
export const once = (set: string, field: string, formula: CheckFormula): CheckFormula => when(anyStates(set, field), formula, nothing);
/** A limit read from the rule table, shown only beside the figure it is a limit on. */
export const limitFor = (key: string, limit: CheckFormula): CheckFormula => when({ field: key, is: 'set' }, limit, nothing);
