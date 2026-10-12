/**
 * Every field set the product declares beyond the checks' own, and the rule
 * table their formulas read.
 *
 * One file per group of departments, each exporting an array of field sets.
 * A new file is registered by one line here: import its array and spread it
 * into `FIELD_SETS`. A file of rule rows is registered the same way in
 * `RULE_ROWS`. Nothing else is edited (docs/fields.md).
 */

import type { FieldSet, RuleRow } from '../types';
import { EXAMPLE_LAND_HOLDING } from './example-land-holding';
import { BASE_RULE_ROWS } from './rule-rows';
import { VALUATION_FEASIBILITY_BUDGET_RULE_ROWS } from './rules/valuation-feasibility-budget';
import { SHARED_RECORDS } from './shared-records';
import { VALUATION_FEASIBILITY_BUDGET_FIELD_SETS } from './valuation-feasibility-budget';

export const FIELD_SETS: readonly FieldSet[] = [
  ...SHARED_RECORDS,
  ...EXAMPLE_LAND_HOLDING,
  ...VALUATION_FEASIBILITY_BUDGET_FIELD_SETS,
];

export const RULE_ROWS: readonly RuleRow[] = [
  ...BASE_RULE_ROWS,
  ...VALUATION_FEASIBILITY_BUDGET_RULE_ROWS,
];
