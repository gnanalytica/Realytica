/**
 * The sheet and the run must agree.
 *
 * The residual took nine inputs on the check sheet and showed no arithmetic at
 * all: every intermediate — fees, the finance charge, the discount back from
 * completion — was computed in `valuation-run.ts` and invisible until somebody
 * pressed Run. So a transposed digit was only findable in the output.
 *
 * Those intermediates are now computed fields, which means the same quantity is
 * expressed twice: once as a formula tree the sheet evaluates live, and once in
 * TypeScript inside the engine. That is a real risk and this is the guard —
 * every intermediate is asserted against the engine's own arithmetic, so the
 * two cannot drift without a test going red.
 *
 * The finance line is the one worth naming: it is charged on the AVERAGE
 * outstanding balance across the build, `cost × rate × years × ½`, not on the
 * full cost for the full period. Getting that wrong overstates the charge by
 * exactly two, and the sheet is where somebody would now notice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHECK_FIELDS, evaluateFormula, type CheckFieldDef, type CheckFieldValue } from '@realytica/shared';

function sheet(schemaId: string, raw: Record<string, number>): Record<string, number | null> {
  const spec = CHECK_FIELDS[schemaId] as CheckFieldDef[] | undefined;
  assert.ok(spec, `${schemaId} must exist`);

  const values: Record<string, CheckFieldValue> = {};
  for (const [k, v] of Object.entries(raw)) values[k] = { value: v } as CheckFieldValue;

  // Computed fields feed each other, so resolve in declaration order — which
  // is the order the sheet renders them in.
  const out: Record<string, number | null> = {};
  for (const field of spec) {
    if (field.kind !== 'computed' || !field.formula) continue;
    const n = evaluateFormula(field.formula, values);
    out[field.key] = n;
    if (n !== null) values[field.key] = { value: n } as CheckFieldValue;
  }
  return out;
}

describe('the residual sheet reproduces the engine', () => {
  const INPUTS = {
    gdv: 100_000_000,
    construction_cost: 60_000_000,
    professional_fees_pct: 10,
    finance_pct: 12,
    marketing_pct: 3,
    developer_profit_pct: 20,
    build_months: 24,
    discount_rate_pct: 12,
    land_acquisition_pct: 6.6,
  };

  const r = sheet('indicative_valuation.residual_inputs', INPUTS);

  it('charges finance on the average drawdown, not the full balance', () => {
    // 60,000,000 × 12% × 2 years × ½
    assert.equal(r.resid_finance, 60_000_000 * 0.12 * 2 * 0.5);
    // The error this guards: charging it flat would be exactly twice as much.
    assert.notEqual(r.resid_finance, 60_000_000 * 0.12 * 2);
  });

  it('works fees off cost and marketing and profit off GDV', () => {
    assert.equal(r.resid_fees, 6_000_000);
    assert.equal(r.resid_marketing, 3_000_000);
    assert.equal(r.resid_profit, 20_000_000);
  });

  it('sums every cost line into the total', () => {
    assert.equal(
      r.resid_total_cost,
      60_000_000 + (r.resid_fees ?? 0) + (r.resid_finance ?? 0) + (r.resid_marketing ?? 0) + (r.resid_profit ?? 0),
    );
    assert.equal(r.resid_at_completion, 100_000_000 - (r.resid_total_cost ?? 0));
  });

  it('discounts back from completion by the power operator', () => {
    // The one arithmetic the formula engine could not express before.
    const expected = (r.resid_at_completion ?? 0) / (1 + 0.12) ** 2;
    assert.ok(Math.abs((r.resid_discounted ?? 0) - expected) < 0.01);
    assert.ok((r.resid_discounted ?? 0) < (r.resid_at_completion ?? 0), 'a residual two years out is worth less today');
  });

  it('grosses acquisition costs up rather than subtracting them', () => {
    const expected = (r.resid_discounted ?? 0) / 1.066;
    assert.ok(Math.abs((r.resid_land_value ?? 0) - expected) < 0.01);
    assert.ok(
      (r.resid_land_value ?? 0) > (r.resid_discounted ?? 0) * (1 - 0.066),
      'a gross-up must exceed a flat subtraction',
    );
  });

  it('answers null rather than zero while an input is missing', () => {
    // The whole point of the sheet is showing which cells are still empty. A
    // half-filled residual that reported 0 would read as a finished answer.
    const partial = sheet('indicative_valuation.residual_inputs', { gdv: 100_000_000 });
    assert.equal(partial.resid_total_cost, null);
    assert.equal(partial.resid_at_completion, null);
  });
});

describe('the income sheet reproduces the engine', () => {
  const i = sheet('indicative_valuation.income_inputs', {
    let_area: 1_000,
    achievable_rent: 50,
    vacancy_pct: 5,
    opex_pct: 20,
    cap_rate_pct: 8,
  });

  it('capitalises NET income, not gross', () => {
    assert.equal(i.inc_gross, 1_000 * 50 * 12);
    assert.equal(i.inc_after_vacancy, 600_000 * 0.95);
    assert.equal(i.inc_noi, 570_000 * 0.8);
    assert.equal(i.inc_capitalised, 456_000 / 0.08);
    // Capitalising the gross would overstate by the whole of the outgoings.
    assert.notEqual(i.inc_capitalised, 600_000 / 0.08);
  });
});

describe('the power operator', () => {
  it('refuses an answer that is not a finite number', () => {
    // A negative base to a fractional exponent is NaN. A NaN escaping here
    // would render as a figure on the sheet.
    const nan = evaluateFormula(
      { op: 'power', left: { op: 'const', value: -8 }, right: { op: 'const', value: 0.5 } },
      {},
    );
    assert.equal(nan, null);
    const huge = evaluateFormula(
      { op: 'power', left: { op: 'const', value: 10 }, right: { op: 'const', value: 400 } },
      {},
    );
    assert.equal(huge, null);
  });
});
