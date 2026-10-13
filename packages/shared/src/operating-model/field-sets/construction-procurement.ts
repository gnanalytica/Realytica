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

import type { FieldSet } from '../types';
import { CONSTRUCTION_SETS } from './construction-procurement/construction';
import { PROCUREMENT_SETS } from './construction-procurement/procurement';

export { CONSTRUCTION_PROCUREMENT_RULE_ROWS } from './construction-procurement/rule-rows';

export const CONSTRUCTION_PROCUREMENT_FIELD_SETS: FieldSet[] = [...CONSTRUCTION_SETS, ...PROCUREMENT_SETS];
