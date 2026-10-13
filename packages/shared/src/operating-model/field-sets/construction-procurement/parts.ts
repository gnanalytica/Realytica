/**
 * Small shapes the Construction and Procurement field sets write often:
 * formula leaves, a figure read from another part of the product, and the
 * three fields that say whether a thing with a closing date is still open.
 */

import type { CheckFieldDef, CheckFormula, FieldAddress, FormulaCondition, RowCondition, Tone } from '../../types';

/* --- The functions and the sets ---------------------------------------- */

export const PROGRESS = 'construction.progress';
/** Quality on site and snagging to handover are both the Technical function's: its tests, its non-conformances, its snag list. */
export const QAQC = 'construction.quality';
export const SAFETY = 'construction.safety';
export const HANDOVER = QAQC;
export const BOQ = 'procurement.boq';
export const ORDERS = 'procurement.orders';
export const VENDORS = 'procurement.vendors';
export const DELIVERIES = 'procurement.deliveries';

export const SET = {
  programme: 'construction.progress.programme',
  delayEvents: 'construction.progress.delay_events',
  siteLog: 'construction.progress.site_log',
  month: 'construction.progress.month',
  decisions: 'construction.progress.decisions',

  mixes: 'construction.quality.mixes',
  pours: 'construction.quality.pours',
  samples: 'construction.quality.samples',
  groups: 'construction.quality.sample_groups',
  steel: 'construction.quality.steel',
  tests: 'construction.quality.tests',
  inspections: 'construction.quality.inspections',
  ncrs: 'construction.quality.ncrs',
  quality: 'construction.quality.standing',

  incidents: 'construction.safety.incidents',
  permits: 'construction.safety.permits',
  training: 'construction.safety.training',
  equipment: 'construction.safety.equipment',
  licences: 'construction.safety.licences',
  statistics: 'construction.safety.statistics',
  establishment: 'construction.safety.establishment',

  unitReadiness: 'construction.quality.unit',
  snags: 'construction.quality.snags',
  systems: 'construction.quality.systems',
  warranties: 'construction.quality.warranties',
  readiness: 'construction.quality.handover',

  plan: 'procurement.boq.plan',
  packagePlans: 'procurement.boq.packages',
  evaluations: 'procurement.boq.evaluations',
  earnestMoney: 'procurement.boq.earnest_money',
  addenda: 'procurement.boq.addenda',

  contract: 'procurement.orders.contract',
  terms: 'procurement.orders.terms',
  variations: 'procurement.orders.variations',
  timeClaims: 'procurement.orders.time_claims',
  position: 'procurement.orders.position',

  vendor: 'procurement.vendors.vendor',
  securities: 'procurement.vendors.securities',
  policies: 'procurement.vendors.policies',
  vendorEvaluations: 'procurement.vendors.evaluations',
  cover: 'procurement.vendors.cover',

  receipts: 'procurement.deliveries.receipts',
  longLead: 'procurement.deliveries.orders',
  deliveries: 'procurement.deliveries.standing',
} as const;

export const CONTRACTS = 'shared.contracts';
export const PARTIES = 'shared.parties';
export const UNITS = 'shared.units';

/* --- Formula leaves ------------------------------------------------------ */

export const f = (key: string): CheckFormula => ({ op: 'field', key });
export const n = (value: number): CheckFormula => ({ op: 'const', value });
export const day = (key: string): CheckFormula => ({ op: 'date', key });
export const today: CheckFormula = { op: 'today' };
export const add = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'add', left, right });
export const sub = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
export const mul = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'multiply', left, right });
export const div = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'divide', left, right });
export const pct = (part: CheckFormula, whole: CheckFormula): CheckFormula => mul(div(part, whole), n(100));
export const when = (condition: FormulaCondition, then: CheckFormula, otherwise: CheckFormula): CheckFormula => ({ op: 'if', when: condition, then, else: otherwise });
export const isSet = (field: string): FormulaCondition => ({ field, is: 'set' });
export const equals = (field: string, value: string): FormulaCondition => ({ field, is: 'equals', value });
export const oneOf = (field: string, value: string[]): FormulaCondition => ({ field, is: 'in', value });

/** A figure another part of the product works out. `of` names the link to the one thing it is a figure of. */
export const figure = (key: string, of?: string): CheckFormula => ({ op: 'figure', key, ...(of ? { of } : {}) });
/** A figure from the rule table, under conditions taken from this set's own fields. */
export const rate = (table: string, where?: Record<string, string>): CheckFormula => ({ op: 'rate', table, ...(where ? { where: Object.fromEntries(Object.entries(where).map(([name, field]) => [name, { field }])) } : {}) });

export const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
/** A field of another set, as a figure. */
export const from = (address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address });
/** A field of the record one of this set's links holds: a figure, or a day. */
export const via = (link: string, address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address, via: link });
export const dayVia = (link: string, address: FieldAddress): CheckFormula => ({ op: 'date', key: address.field, at: address, via: link });
export const dayFrom = (address: FieldAddress): CheckFormula => ({ op: 'date', key: address.field, at: address });

/** The rows of a set that repeats that belong to this record: their `column` links to it, or holds what this record's `field` holds. */
export const own = (column: string, field?: string): RowCondition => ({ column, is: 'own', ...(field ? { value: field } : {}) });
export const countOf = (set: string): CheckFormula => ({ op: 'records', set, reduce: 'count' });
export const sumOf = (set: string, field: string): CheckFormula => ({ op: 'records', set, reduce: 'sum', field });
export const countWhere = (set: string, where: RowCondition): CheckFormula => ({ op: 'count_if', over: { records: set }, where });
export const sumWhere = (set: string, column: string, where: RowCondition): CheckFormula => ({ op: 'sum_if', over: { records: set }, column, where });

/* --- Fields -------------------------------------------------------------- */

type More = Partial<CheckFieldDef>;

export const computed = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, ...more });
export const computedDay = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', yields: 'date', formula, ...more });
export const computedMoney = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', dimension: 'money', currency: 'INR', formula, ...more });
export const money = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'money', currency: 'INR', ...more });
export const date = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'date', ...more });
export const text = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'text', ...more });
export const party = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'ref', target: 'party', ...more });
export const paper = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, ...more });
export const photo = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'evidence', accepts: 'image', viewer: 'image', required: false, ...more });
/** A mirror of a field entered on a check: read here, entered there. */
export const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: More = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });

/** One or nought: whether something holds, so that rows meeting it can be counted and summed. */
export const flag = (key: string, label: string, condition: FormulaCondition, more: More = {}): CheckFieldDef => computed(key, label, when(condition, n(1), n(0)), { precision: 0, tier: 'expert', ...more });

/**
 * Whether a thing with a closing date is still open, and whether it is past
 * the day it was due: two figures a list above it counts, and the standing
 * a person reads.
 *
 * `open` is one while `done` holds no date. `overdue` is one while it is
 * open and today is past `due`.
 */
export function openness(input: { done: string; due: string; labels: { open: string; overdue: string; closed: string }; say: string; openTone?: Tone }): CheckFieldDef[] {
  return [
    flag('open', 'Open', isSet(input.done), { formula: when(isSet(input.done), n(0), n(1)) }),
    computed('overdue', 'Overdue', when(isSet(input.done), n(0), when({ left: today, is: 'gt', right: day(input.due) }, n(1), n(0))), { precision: 0, tier: 'expert' }),
    {
      key: 'standing',
      label: 'Standing',
      kind: 'status',
      cases: [
        { when: { kind: 'at_most', fields: ['overdue'], against: 0, say: input.say, severity: 'high' }, label: input.labels.overdue, tone: 'critical' },
        { when: { kind: 'at_most', fields: ['open'], against: 0, say: input.say, severity: 'low' }, label: input.labels.open, tone: input.openTone ?? 'info' },
      ],
      otherwise: { label: input.labels.closed, tone: 'good' },
    },
  ];
}

/** A list of choices from plain words: the key is the words in lower snake case. */
export const choices = (labels: readonly string[]) => labels.map((label) => ({ key: optionKey(label), label }));
export const optionKey = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
