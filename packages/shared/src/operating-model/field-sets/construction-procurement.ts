/**
 * The field sets of Construction and Procurement.
 *
 * Construction: the programme and what delays it, the site log's figures,
 * the month at a glance, quality (pours, cube samples, steel, tests,
 * inspections, non-conformances), safety (incidents, permits, training,
 * plant, the establishment) and snagging to handover.
 *
 * Procurement: the plan for each package and how its bids were judged,
 * contracts and their terms, variations and time claims, guarantees and
 * insurance, the vendor's record, and what arrives on site.
 *
 * The sets themselves are in the folder of the same name, with the rule rows
 * their formulas read. This file is the one the folder's index registers.
 */

import type { CheckFieldDef, FieldAddress, FieldSet, ShowWhen } from '../types';
import { withLinks, type SetLinks } from './builders';
import { CONSTRUCTION_SETS } from './construction-procurement/construction';
import { PROCUREMENT_SETS } from './construction-procurement/procurement';

export { CONSTRUCTION_PROCUREMENT_RULE_ROWS } from './construction-procurement/rule-rows';

/* ==================================================================== */
/* What Construction and Procurement read from other departments         */
/* ==================================================================== */

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, tier: 'situational', ...more });
const REGISTERED: ShowWhen = { situation: 'rera_registered' };
const RFIS = 'design.rfis.requests';
const DEMANDS = 'commercial.buyers.demands';

const LINKS: SetLinks[] = [
  {
    set: 'construction.progress.programme',
    // What stops or binds the programme is recorded by others: the completion declared to RERA, a stop-work order, a court's restraint, the days the Architect's approved changes add.
    fields: [
      mirror('rera_completion', 'Completion declared to RERA', 'date', at('legal.rera', 'legal.rera.registration', 'declared_completion'), { section: 'completion', showWhen: REGISTERED }),
      mirror('stop_orders_in_force', 'Stop-work orders in force, per Liaison', 'number', at('legal.approvals', 'legal.approvals.register', 'stop_orders_in_force'), { section: 'completion', showWhen: { situation: 'stop_work_order' } }),
      mirror('court_restraints', 'Court orders in force restraining construction', 'number', at('legal.litigation', 'legal.litigation.diary', 'construction_restraints'), { section: 'completion', showWhen: { situation: 'litigation_pending' } }),
      mirror('design_change_days', 'Days added by approved design changes, per the Architect', 'number', at('design.changes', 'design.changes.summary', 'approved_days'), { unit: 'days', section: 'completion', showWhen: { records: 'design.changes.register', is: 'any', where: { column: 'time_effect', is: 'gt', value: 0 } } }),
    ],
    rules: [
      { kind: 'before', fields: ['forecast_completion', 'rera_completion'], say: 'Completion is forecast for {a}, after the {b} declared to RERA.', severity: 'critical' },
      { kind: 'at_most', fields: ['stop_orders_in_force'], against: 0, say: '{a} stop-work order(s) are in force.', severity: 'critical' },
      { kind: 'at_most', fields: ['court_restraints'], against: 0, say: '{a} court order(s) in force restrain construction.', severity: 'critical' },
    ],
  },
  {
    set: 'construction.progress.month',
    // The month's page reads the design and the money from those who keep them.
    fields: [
      mirror('drawings_for_construction', 'Drawings good for construction, per the Architect', 'number', at('design.drawings', 'design.drawings.register', 'at_construction_issue'), { section: 'work', showWhen: { records: 'shared.drawings', is: 'any' } }),
      mirror('rfis_open', 'Requests for information open, per the Architect', 'number', at('design.rfis', 'design.rfis.log', 'open'), { section: 'work', showWhen: { records: RFIS, is: 'any' } }),
      mirror('rfis_overdue', 'Requests for information overdue', 'number', at('design.rfis', 'design.rfis.log', 'overdue'), { section: 'work', showWhen: { records: RFIS, is: 'any' } }),
      mirror('certified_to_date', 'Certified to date, per the budget', 'money', at('finance.budget', 'finance.budget.to_complete', 'certified_to_date'), { dimension: 'money', currency: 'INR', section: 'buying', showWhen: { field: at('finance.budget', 'finance.budget.to_complete', 'certified_to_date'), is: 'gt', value: 0 } }),
    ],
  },
  {
    set: 'construction.quality.unit',
    // A unit is not handed over with money still owed on it: what is outstanding is Collections' figure of this unit.
    fields: [{ key: 'dues_outstanding', label: 'Demands outstanding on this unit, per Collections', kind: 'computed', dimension: 'money', currency: 'INR', tier: 'expert', formula: { op: 'sum_if', over: { records: DEMANDS }, column: 'outstanding', where: { column: 'unit', is: 'own' } } }],
    rules: [{ kind: 'at_most', fields: ['dues_outstanding'], against: 0, when: { field: at('shared', 'shared.units', 'site_handed_on'), is: 'set' }, say: 'The site has handed this unit over with {a} of demands outstanding.', severity: 'medium' }],
  },
  {
    set: 'procurement.boq.packages',
    // The drawings a package is tendered on are the Architect's, each naming its package.
    fields: [{ key: 'drawings_in_scope', label: 'Drawings naming this package, per the Architect', kind: 'computed', precision: 0, tier: 'situational', showWhen: { records: 'shared.drawings', is: 'any' }, formula: { op: 'count_if', over: { records: 'shared.drawings' }, where: { column: 'package', is: 'own', value: 'package' } } }],
  },
];

export const CONSTRUCTION_PROCUREMENT_FIELD_SETS: FieldSet[] = withLinks([...CONSTRUCTION_SETS, ...PROCUREMENT_SETS], LINKS);
