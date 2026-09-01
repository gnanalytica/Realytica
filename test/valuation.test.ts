/**
 * The arithmetic a buyer acts on, and the four ways it used to be wrong.
 *
 * Each describe block below is one defect the previous implementation shipped.
 * They are worth stating as failures rather than as features, because every
 * one of them produced a plausible number — that is what made them dangerous.
 *
 * 1. A missing input became a default, so a site with no locality match was
 *    valued at an invented 18,000/sqm with nothing on the page to say so.
 * 2. Replacement cost was never depreciated, overstating every building by
 *    whatever share of its life had run.
 * 3. The "income approach" was `capital × grossYield ÷ 0.07` — the comparable
 *    figure multiplied by a ratio of yields, which moves with the market
 *    number and tells you nothing new.
 * 4. The "residual" was GDV − construction: the price a developer would pay if
 *    they worked for nothing and borrowed for free.
 *
 * And the fifth, which is the one that connects this to the rest of the
 * product: the computation read `project.saleableAreaSqm` and ignored the area
 * somebody had evidenced on the valuation check against an approved drawing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_VALUATION_SPREAD,
  approachIsUsable,
  computeIndicativeValuation,
  createAssessment,
  createProject,
  recordCheckFields,
  runValuationApproaches,
  type DdProject,
  type ValuationApproachRun,
} from '@realytica/shared';

function file(): DdProject {
  const project = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-V1');
  createAssessment(project, { ddType: 'indicative_valuation', name: 'Valuation', owner: 'Lead', targetType: 'project' });
  return project;
}

function checkId(project: DdProject, definitionId: string): string {
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      const hit = s.checks.find((c) => c.definitionId === definitionId);
      if (hit) return hit.id;
    }
  }
  throw new Error(`no ${definitionId} on this file`);
}

/** Record with a cited evidence row, so `proof: 'required'` fields go in. */
function record(project: DdProject, definitionId: string, values: Record<string, unknown>) {
  const evidence = project.evidence[0] ?? null;
  const id = evidence?.id ?? project.evidence[0]?.id;
  return recordCheckFields(project, checkId(project, definitionId), values, 'operator', id);
}

function approach(project: DdProject, method: ValuationApproachRun['method']): ValuationApproachRun {
  const run = runValuationApproaches(project).runs.find((r) => r.method === method);
  assert.ok(run, `no ${method} run`);
  return run;
}

describe('a missing input stops its approach; it never becomes a default', () => {
  it('refuses to value on an invented rate when nothing is recorded and no locality matches', () => {
    // The single most dangerous line in the old file was `?? 18_000`.
    const project = file();
    const working = runValuationApproaches(project);
    assert.equal(working.reconciliation.indicated, null);
    assert.ok(working.reconciliation.skippedMethods.length >= 3);
    assert.match(working.reconciliation.spreadBasis, /no indication to give/);
  });

  it('names what was missing, per approach, so the page can say why', () => {
    const project = file();
    const income = approach(project, 'investment_income');
    assert.equal(income.amount, null);
    assert.ok(income.missing.includes('Capitalisation rate'));
    assert.ok(income.missing.includes('Achievable rent'));
    assert.equal(approachIsUsable(income), false);
  });

  it('shows no working at all for an approach that did not run', () => {
    // Half a calculation is worse than none — a reader seeing three of four
    // lines will assume the fourth was fine.
    const project = file();
    assert.deepEqual(approach(project, 'residual_land').steps, []);
  });
});

describe('replacement cost is depreciated', () => {
  it('takes off the share of life that has run', () => {
    const project = file();
    project.landAreaSqm = 1000;
    project.builtUpAreaSqm = 2000;
    record(project, 'indicative_valuation.cost_inputs', {
      land_rate_per_sqm: 20_000,
      replacement_rate: 30_000,
      effective_age_years: 15,
      expected_life_years: 60,
    });

    const cost = approach(project, 'depreciated_replacement_cost');
    // Land 1000 × 20,000 = 2,00,00,000. Building 2000 × 30,000 = 6,00,00,000,
    // less 15/60 = 25% → 4,50,00,000. Total 6,50,00,000.
    assert.equal(Math.round(cost.amount!), 65_000_000);
    assert.ok(cost.steps.some((s) => s.label === 'Less depreciation'));
    assert.match(cost.steps.find((s) => s.label === 'Less depreciation')!.expression, /\(1 − 15\/60\)/);
  });

  it('will not run a cost approach on a building with no age recorded', () => {
    // The old code simply used the undepreciated figure, which is always
    // wrong in the same direction: too high.
    const project = file();
    project.landAreaSqm = 1000;
    project.builtUpAreaSqm = 2000;
    record(project, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 20_000, replacement_rate: 30_000 });
    const cost = approach(project, 'depreciated_replacement_cost');
    assert.equal(cost.amount, null);
    assert.ok(cost.missing.includes('Effective age'));
  });

  it('values land alone when there is no building, without demanding an age', () => {
    const project = file();
    project.landAreaSqm = 1000;
    record(project, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 20_000 });
    const cost = approach(project, 'depreciated_replacement_cost');
    assert.equal(Math.round(cost.amount!), 20_000_000);
    assert.deepEqual(cost.missing, []);
  });
});

describe('income is capitalised from net income, not scaled from the market figure', () => {
  it('works down from rent through vacancy and opex to a cap rate', () => {
    const project = file();
    record(project, 'indicative_valuation.income_inputs', {
      achievable_rent: 50,
      vacancy_pct: 5,
      opex_pct: 20,
      cap_rate_pct: 8,
      let_area: 1000,
    });
    const income = approach(project, 'investment_income');
    // 1000 × 50 × 12 = 6,00,000 gross. ×0.95 = 5,70,000. ×0.80 = 4,56,000 NOI.
    // ÷ 8% = 57,00,000.
    assert.equal(Math.round(income.amount!), 5_700_000);
    assert.deepEqual(
      income.steps.map((s) => s.label),
      ['Gross annual income', 'Less vacancy', 'Net operating income', 'Capitalised'],
    );
  });

  it('does not move when the comparable rate moves', () => {
    /*
     * The proof that this is a real income approach. The old formula was
     * `saleable × builtRate × yield ÷ 0.07` — change the market rate and the
     * "income" approach moved with it, so the two approaches could never
     * disagree and the cross-check was worthless.
     */
    const project = file();
    record(project, 'indicative_valuation.income_inputs', { achievable_rent: 50, cap_rate_pct: 8, let_area: 1000, vacancy_pct: 0, opex_pct: 0 });
    record(project, 'indicative_valuation.subject', { quoted_basis: 'carpet', quoted_area: 1000, interest: 'freehold' });
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    const first = approach(project, 'investment_income').amount;

    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 90_000 });
    const second = approach(project, 'investment_income').amount;
    assert.equal(first, second, 'the income indication is independent of the market rate');
    assert.notEqual(approach(project, 'comparable_rate').amount, null);
  });

  it('refuses a cap rate of zero rather than dividing by it', () => {
    const project = file();
    record(project, 'indicative_valuation.income_inputs', { achievable_rent: 50, cap_rate_pct: 0, let_area: 1000 });
    assert.equal(approach(project, 'investment_income').amount, null);
  });
});

describe('a residual carries what a developer actually pays', () => {
  it('takes off fees, finance, marketing and profit', () => {
    const project = file();
    record(project, 'indicative_valuation.residual_inputs', {
      gdv: 100_000_000,
      construction_cost: 50_000_000,
      professional_fees_pct: 10,
      finance_pct: 8,
      marketing_pct: 3,
      developer_profit_pct: 20,
    });
    const residual = approach(project, 'residual_land');
    // 10cr − 5cr − 50L fees − 40L finance − 30L marketing − 2cr profit = 1.8cr
    assert.equal(Math.round(residual.amount!), 18_000_000);
    assert.deepEqual(
      residual.steps.map((s) => s.label),
      ['Professional fees', 'Finance', 'Marketing and disposal', 'Developer’s profit', 'Residual to land'],
    );
  });

  it('will not run without a developer’s profit', () => {
    // Without it the answer is the price a developer would pay if they worked
    // for nothing, which is not a number anybody should see.
    const project = file();
    record(project, 'indicative_valuation.residual_inputs', { gdv: 100_000_000, construction_cost: 50_000_000 });
    const residual = approach(project, 'residual_land');
    assert.equal(residual.amount, null);
    assert.ok(residual.missing.includes('Developer’s required profit'));
  });
});

describe('the valuation uses the area somebody evidenced', () => {
  it('reads the check, not the project particular', () => {
    const project = file();
    project.saleableAreaSqm = 5000;
    record(project, 'indicative_valuation.subject', { quoted_basis: 'carpet', quoted_area: 1208, interest: 'freehold' });
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });

    const market = approach(project, 'comparable_rate');
    assert.equal(Math.round(market.amount!), 1208 * 50_000, 'the evidenced area, not the 5,000 on the project record');
    assert.equal(market.inputs.find((i) => i.key === 'area')!.source.kind, 'check_field');
  });

  it('prefers the RERA carpet figure when the quote is on a basis with no definition', () => {
    // The reason both are recorded. A value stated on super built-up is stated
    // on a number whose loading the seller chose.
    const project = file();
    record(project, 'indicative_valuation.subject', {
      quoted_basis: 'super built-up',
      quoted_area: 1400,
      rera_carpet_area: 940,
      interest: 'freehold',
    });
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });

    const market = approach(project, 'comparable_rate');
    assert.equal(Math.round(market.amount!), 940 * 50_000);
    assert.match(market.inputs.find((i) => i.key === 'area')!.note!, /no statutory definition/);
  });

  it('says out loud when it fell back to the project particular', () => {
    const project = file();
    project.saleableAreaSqm = 5000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    const area = runValuationApproaches(project).area;
    assert.equal(area.source.kind, 'project');
    assert.match(area.note!, /carries no proof requirement/);
  });
});

describe('every input says where it came from', () => {
  it('marks a locality median as a market observation, not evidence', () => {
    const project = file();
    project.landAreaSqm = 1000;
    const locality = { id: 'loc_1', locality: 'Harohalli', city: 'Bengaluru', medianLandRatePerSqm: 20_000 } as Parameters<typeof runValuationApproaches>[1];
    const cost = runValuationApproaches(project, locality).runs.find((r) => r.method === 'depreciated_replacement_cost')!;
    const rate = cost.inputs.find((i) => i.key === 'land_rate')!;
    assert.equal(rate.source.kind, 'locality');
    assert.equal(cost.weight > 0, true);
  });

  it('weights an evidenced rate above a borrowed one', () => {
    // Same approach, same asset — the only difference is where the rate came
    // from, and the reconciliation should care about that.
    const withLocality = file();
    withLocality.saleableAreaSqm = 1000;
    const borrowed = runValuationApproaches(withLocality, { id: 'l', locality: 'H', city: 'B', medianPricePerSqm: 50_000 } as Parameters<typeof runValuationApproaches>[1])
      .runs.find((r) => r.method === 'comparable_rate')!;

    const evidenced = file();
    evidenced.saleableAreaSqm = 1000;
    record(evidenced, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    const own = runValuationApproaches(evidenced).runs.find((r) => r.method === 'comparable_rate')!;

    assert.ok(own.weight > borrowed.weight, `${own.weight} should beat ${borrowed.weight}`);
    assert.match(borrowed.weightBasis, /locality median/);
  });
});

describe('the range comes from the approaches, not from a constant', () => {
  it('widens when the approaches disagree', () => {
    const tight = file();
    tight.saleableAreaSqm = 1000;
    tight.landAreaSqm = 1000;
    record(tight, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(tight, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 49_000 });
    const tightRun = runValuationApproaches(tight).reconciliation;

    const wide = file();
    wide.saleableAreaSqm = 1000;
    wide.landAreaSqm = 1000;
    record(wide, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(wide, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 20_000 });
    const wideRun = runValuationApproaches(wide).reconciliation;

    const spread = (r: typeof tightRun) => (r.high! - r.low!) / r.indicated!;
    assert.ok(spread(wideRun) > spread(tightRun), 'disagreement has to show in the band');
    assert.match(wideRun.spreadBasis, /half that spread/);
  });

  it('floors a single-approach valuation rather than implying precision', () => {
    const project = file();
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    const r = runValuationApproaches(project).reconciliation;
    assert.equal(r.usedMethods.length, 1);
    assert.ok(Math.abs((r.high! - r.indicated!) / r.indicated! - MIN_VALUATION_SPREAD) < 1e-9);
    assert.match(r.spreadBasis, /no cross-check to measure/);
  });
});

describe('the run a report reads', () => {
  it('says it could not be computed rather than printing zero', () => {
    const project = file();
    const computed = computeIndicativeValuation(project);
    assert.equal(computed.indicatedValue, 0);
    assert.equal(computed.working!.reconciliation.indicated, null, 'and the working says so unambiguously');
    assert.match(computed.ibbi.reconciliation, /No approach could be run/);
    assert.match(computed.ibbi.reconciliation, /Record those inputs/);
  });

  it('carries the caveat when a rate was borrowed from a locality', () => {
    const project = file();
    project.saleableAreaSqm = 1000;
    project.location = 'Koramangala';
    project.city = 'Bengaluru';
    const computed = computeIndicativeValuation(project);
    if (computed.working!.runs.some((r) => r.inputs.some((i) => i.source.kind === 'locality' && i.value !== null))) {
      assert.ok(computed.ibbi.caveats.some((c) => /locality reference medians/.test(c)));
    }
  });
});
