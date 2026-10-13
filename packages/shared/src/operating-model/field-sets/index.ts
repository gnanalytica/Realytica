/**
 * Every field set the product declares beyond the checks' own, and the rule
 * table their formulas read.
 *
 * One file per group of departments, each exporting an array of field sets.
 * A new file is registered by one line here: import its array and spread it
 * into `FIELD_SETS`. A file of rule rows is registered the same way in
 * `RULE_ROWS`. Nothing else is edited (docs/fields.md).
 */

import type { FieldSet, RuleRow, RuleShape } from '../types';
import { DESIGN_FIELD_SETS, DESIGN_RULE_ROWS, DESIGN_RULE_SHAPES } from './architect-design-engineer-mep';
import { EXAMPLE_LAND_HOLDING } from './example-land-holding';
import { LAW_LIAISON_FIELD_SETS } from './law-liaison';
import { FINANCE_RULE_ROWS, FINANCE_TAX_LENDERS_FIELD_SETS } from './finance-tax-lenders';
import { BASE_RULE_ROWS } from './rule-rows';
import { TITLES_LITIGATION_RULE_ROWS } from './rules/titles-litigation';
import { LAW_LIAISON_RULE_ROWS } from './rules/law-liaison';
import { SHARED_RECORDS } from './shared-records';
import { TITLES_LITIGATION_FIELD_SETS } from './titles-litigation';
import { VALUATION_FEASIBILITY_BUDGET_RULE_ROWS } from './rules/valuation-feasibility-budget';
import { VALUATION_FEASIBILITY_BUDGET_FIELD_SETS } from './valuation-feasibility-budget';

export const FIELD_SETS: readonly FieldSet[] = [
  ...SHARED_RECORDS,
  ...EXAMPLE_LAND_HOLDING,
  ...TITLES_LITIGATION_FIELD_SETS,
  ...LAW_LIAISON_FIELD_SETS,
  ...VALUATION_FEASIBILITY_BUDGET_FIELD_SETS,
  ...FINANCE_TAX_LENDERS_FIELD_SETS,
  ...DESIGN_FIELD_SETS,
];

export const RULE_ROWS: readonly RuleRow[] = [
  ...BASE_RULE_ROWS,
  ...TITLES_LITIGATION_RULE_ROWS,
  ...LAW_LIAISON_RULE_ROWS,
  ...VALUATION_FEASIBILITY_BUDGET_RULE_ROWS,
  ...FINANCE_RULE_ROWS,
  ...DESIGN_RULE_ROWS,
];

/** Rules a formula may read whose figures are not loaded yet (see `RuleShape`). Registered as rule rows are. */
export const RULE_SHAPES: readonly RuleShape[] = [
  ...DESIGN_RULE_SHAPES,
];
