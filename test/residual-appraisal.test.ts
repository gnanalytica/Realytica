/**
 * The three things a residual gets wrong by omission.
 *
 * A residual falls out of the appraisal at COMPLETION, financed over a build
 * it draws down gradually, and is what the land is worth rather than what
 * somebody can pay for it. Leave any of the three out and the figure reads
 * high — which matters more here than in the other approaches, because the
 * residual is the number a developer bids with.
 *
 * All three inputs are optional, so the tests that matter are the comparisons:
 * supplying a build period must reduce the finance charge, supplying a
 * discount rate must reduce the residual, and supplying acquisition costs must
 * reduce it again. Each is asserted as a direction and a mechanism rather than
 * a figure, so the rates stay tunable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runValuationApproaches, type DdProject, type CheckInstance } from '@realytica/shared';

/**
 * A project carrying one residual-inputs check, with the fields given.
 *
 * Built by hand rather than seeded: the seeds do not record a residual
 * appraisal, and the point here is the arithmetic over known inputs.
 */
function projectWithResidual(fields: Record<string, number>): DdProject {
  // `check.fields` is a record of `{ value }` objects, not an array — the same
  // shape `withComputed` and `fieldNumber` read in production.
  const recorded: Record<string, { value: number }> = {};
  for (const [key, value] of Object.entries(fields)) recorded[key] = { value };

  const check: CheckInstance = {
    id: 'chk_residual',
    definitionId: 'indicative_valuation.residual_inputs',
    title: 'Residual inputs',
    status: 'recorded',
    updatedAt: '2026-09-03T00:00:00.000Z',
    fields: recorded,
  } as unknown as CheckInstance;

  return {
    id: 'prj_test',
    name: 'Residual test',
    assessments: [
      {
        id: 'dd_1',
        name: 'Indicative valuation',
        scopes: [{ id: 'sc_1', scopeKey: 'financial_appraisal', assessmentId: 'dd_1', checks: [check] }],
      },
    ],
  } as unknown as DdProject;
}

/** The residual approach's own run out of a full working. */
function residualOf(project: DdProject) {
  const working = runValuationApproaches(project);
  const run = working.runs.find((r) => r.method === 'residual_land');
  assert.ok(run, 'the residual approach must be present in the working');
  return run;
}

const BASE = {
  gdv: 100_000_000,
  construction_cost: 60_000_000,
  developer_profit_pct: 20,
  finance_pct: 12,
};

describe('residual appraisal', () => {
  it('charges finance on the average drawdown once a build period is known', () => {
    const flat = residualOf(projectWithResidual(BASE));
    const spread = residualOf(projectWithResidual({ ...BASE, build_months: 24 }));

    const financeOf = (run: ReturnType<typeof residualOf>) =>
      run.steps.find((s) => s.label.startsWith('Finance'))?.value ?? 0;

    // Flat: 60,000,000 × 12% = 7,200,000 for however long the build takes.
    // Drawdown over two years: 60,000,000 × 12% × 2 × ½ = 7,200,000 — the same
    // here by coincidence of a two-year build, so use a one-year build where
    // the halving is visible.
    const oneYear = residualOf(projectWithResidual({ ...BASE, build_months: 12 }));
    assert.ok(
      financeOf(oneYear) < financeOf(flat),
      `a one-year drawdown must cost less than the flat charge — got ${financeOf(oneYear)} vs ${financeOf(flat)}`,
    );
    assert.ok(financeOf(spread) > 0, 'a two-year build still carries a finance charge');
  });

  it('discounts the residual back from completion to today', () => {
    const atCompletion = residualOf(projectWithResidual({ ...BASE, build_months: 36 }));
    const discounted = residualOf(projectWithResidual({ ...BASE, build_months: 36, discount_rate_pct: 12 }));

    assert.ok(atCompletion.amount !== null && discounted.amount !== null);
    assert.ok(
      discounted.amount < atCompletion.amount,
      `a residual three years out must be worth less today — got ${discounted.amount} vs ${atCompletion.amount}`,
    );
    assert.ok(
      discounted.steps.some((s) => s.label === 'Discounted to today'),
      'the discount must appear as its own step, not be folded into another',
    );
  });

  it('does not discount when no period is recorded, and says so', () => {
    // A discount rate with no period to apply it over is not a reason to guess
    // a period. It reports the omission instead.
    const run = residualOf(projectWithResidual({ ...BASE, discount_rate_pct: 12 }));
    assert.ok(!run.steps.some((s) => s.label === 'Discounted to today'));
    assert.match(run.weightBasis, /stated at completion rather than today/);
  });

  it('grosses acquisition costs up rather than subtracting them', () => {
    // If a buyer can afford 100 all-in and duty is 10%, the land is 100/1.1,
    // not 100 − 10. Subtracting understates it by the square of the rate.
    const bare = residualOf(projectWithResidual(BASE));
    const withCosts = residualOf(projectWithResidual({ ...BASE, land_acquisition_pct: 10 }));

    assert.ok(bare.amount !== null && withCosts.amount !== null);
    const expected = bare.amount / 1.1;
    assert.ok(
      Math.abs(withCosts.amount - expected) < 1,
      `expected the gross-up ${Math.round(expected)}, got ${Math.round(withCosts.amount)}`,
    );
    // The subtraction would have produced this instead — assert we did not.
    const subtracted = bare.amount * 0.9;
    assert.ok(withCosts.amount > subtracted, 'a gross-up must exceed a flat subtraction');
  });

  it('names every omission that makes the figure read high', () => {
    const run = residualOf(projectWithResidual(BASE));
    assert.match(run.weightBasis, /reads high/);
    assert.match(run.weightBasis, /no build period/);
    assert.match(run.weightBasis, /no discount rate/);
    assert.match(run.weightBasis, /no acquisition costs/);
  });

  it('stops warning once all three are supplied', () => {
    const run = residualOf(
      projectWithResidual({ ...BASE, build_months: 24, discount_rate_pct: 12, land_acquisition_pct: 6.6 }),
    );
    assert.doesNotMatch(run.weightBasis, /reads high/);
    assert.match(run.weightBasis, /discounted to today/);
  });

  it('still refuses to run without a required profit', () => {
    // The guard that already existed must survive the new steps.
    const run = residualOf(projectWithResidual({ gdv: 100_000_000, construction_cost: 60_000_000 }));
    assert.equal(run.amount, null);
    assert.ok(run.missing.some((m) => /profit/i.test(m)));
  });
});
