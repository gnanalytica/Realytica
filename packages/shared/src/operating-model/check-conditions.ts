/**
 * When a check's fields are asked.
 *
 * A check's fields were all drawn, always. Some checks only matter in a
 * situation: the inputs of the income approach on a site nobody will let, the
 * residual's nine figures on a plot valued by comparison. Here a check is
 * given the condition its fields wait on, and the situations those conditions
 * name are declared for the function the check sits in. The catalog reads
 * both (`buildFieldCatalog`), so a check's field shows, folds and is counted
 * exactly as a field set's does.
 *
 * A field that holds a value is never hidden by this: an approach whose
 * inputs are already recorded is in play with nobody asked (`impliedBy`).
 *
 * Declared here, apart from the check schemas, so adding a condition to a
 * check is one entry and never an edit to the schema it belongs to.
 */

import type { FieldAddress, ShowWhen, Situation } from './types';

const VALUATION = 'finance.valuation';

/** The four approaches a valuation may be worked by, each with the check that holds its inputs and the inputs a person enters. */
const APPROACHES: ReadonlyArray<{ key: string; label: string; hint: string; check: string; inputs: string[] }> = [
  {
    key: 'comparable_approach',
    label: 'Comparable approach',
    hint: 'The value is worked from what comparable property sold or is offered for.',
    check: 'indicative_valuation.comparable_inputs',
    inputs: ['rate_per_sqm', 'rate_basis', 'comparable_count', 'net_adjustment_pct'],
  },
  {
    key: 'cost_approach',
    label: 'Cost approach',
    hint: 'The value is worked from what it would cost to replace, less depreciation, plus the land.',
    check: 'indicative_valuation.cost_inputs',
    inputs: ['replacement_rate', 'effective_age_years', 'expected_life_years', 'land_rate_per_sqm'],
  },
  {
    key: 'income_approach',
    label: 'Income approach',
    hint: 'The value is worked from the rent the property can earn.',
    check: 'indicative_valuation.income_inputs',
    inputs: ['achievable_rent', 'vacancy_pct', 'opex_pct', 'cap_rate_pct'],
  },
  {
    key: 'residual_approach',
    label: 'Residual approach',
    hint: 'The value is what is left of a development’s worth after its costs and the developer’s profit.',
    check: 'indicative_valuation.residual_inputs',
    inputs: ['gdv', 'construction_cost', 'developer_profit_pct'],
  },
];

const at = (set: string, field: string): FieldAddress => ({ fn: VALUATION, set, field });

/** The condition every field of a check waits on, by the check definition's id. */
export const CHECK_CONDITIONS: Readonly<Record<string, ShowWhen>> = Object.fromEntries(APPROACHES.map((approach) => [approach.check, { situation: approach.key }]));

/** The situations checks' conditions name, by the function they belong to. */
export const CHECK_SITUATIONS: ReadonlyArray<{ fn: string; situations: Situation[] }> = [
  {
    fn: VALUATION,
    situations: APPROACHES.map((approach) => ({
      key: approach.key,
      label: approach.label,
      scope: 'function' as const,
      hint: approach.hint,
      impliedBy: { any: approach.inputs.map((field) => ({ field: at(approach.check, field), is: 'set' as const })) },
    })),
  },
];
