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
  EXTERNALITY_BY_KEY,
  RULE_8_ITEMS,
  addSiteVisit,
  createValuationRun,
  rule8Summary,
  setValuationValuer,
  valuationRule8,
  EXTERNALITY_RULES,
  MAX_COHERENT_SPREAD,
  MAX_EXTERNALITY_DISCOUNT,
  MIN_VALUATION_SPREAD,
  applyExternalities,
  bandFor,
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

/** Adds the land & site scope, which the valuation DD does not carry. */
function siteFileFor(project: DdProject): DdProject {
  createAssessment(project, { ddType: 'acquisition', name: 'Land', owner: 'Lead', targetType: 'project' });
  return project;
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

describe('what the site is next to comes off the value', () => {
  /** The surroundings live on the land & site scope, which the valuation DD does not carry. */
  const siteFile = (): DdProject => siteFileFor(file());

  /*
   * The gap this closes: the comparable adjustment list was road width, corner
   * site, facing, dimensions and layout approval — every one of them positive
   * or neutral. There was no way for a number to go down because of where the
   * site is, on a product built for Bengaluru, where a transmission corridor
   * or a rajakaluve is one of the first things a valuer looks for.
   */
  it('reads the rajakaluve fields that were already on the file and unused', () => {
    const project = siteFile();
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    const clean = runValuationApproaches(project).reconciliation.indicated!;

    record(project, 'land_site.flood_drainage', { near_rajakaluve: true });
    const working = runValuationApproaches(project);
    assert.equal(working.externalities.applied[0]!.key, 'rajakaluve');
    assert.equal(working.externalities.applied[0]!.metres, 0);
    assert.ok(working.reconciliation.indicated! < clean, 'the number has to move');
    assert.match(working.externalities.applied[0]!.from, /recorded as within the buffer/);
  });

  it('treats a buffer shortfall as being inside the buffer', () => {
    // 8 m available against 25 m required is inside it by another name, and
    // the insight rule already said so — it just never touched a number.
    const project = siteFile();
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(project, 'land_site.flood_drainage', { near_rajakaluve: false, buffer_required_m: 25, buffer_available_m: 8 });

    const applied = runValuationApproaches(project).externalities.applied;
    assert.equal(applied[0]!.metres, 0);
    assert.match(applied[0]!.from, /8 m available against 25 m required/);
  });

  it('applies the far band when the site clears its buffer', () => {
    const project = siteFile();
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(project, 'land_site.flood_drainage', { near_rajakaluve: false, buffer_required_m: 25, buffer_available_m: 60 });

    const applied = runValuationApproaches(project).externalities.applied;
    // 35 m clear → the 75 m band, not the 25 m one.
    assert.equal(applied[0]!.pct, -0.04);
  });

  it('takes the nearest band that contains the feature', () => {
    const ht = EXTERNALITY_BY_KEY.ht_line;
    assert.equal(bandFor(ht, 10)!.pct, -0.15);
    assert.equal(bandFor(ht, 30)!.pct, -0.07);
    assert.equal(bandFor(ht, 90)!.pct, -0.02);
    assert.equal(bandFor(ht, 400), null, 'far enough away is not an adjustment at all');
  });

  it('compounds rather than sums', () => {
    // Two 10% discounts leave 81% of the value, not 80%. Small on two,
    // material on five, and summing is what makes a stack run away.
    const out = applyExternalities([
      { key: 'ht_line', metres: 30, from: 'x' },
      { key: 'railway', metres: 100, from: 'y' },
    ]);
    // (1 - 0.07)(1 - 0.04) = 0.8928 → -10.72%
    assert.ok(Math.abs(out.factorPct + 0.1072) < 1e-6, String(out.factorPct));
  });

  it('caps a stack, and says the cap bit', () => {
    /*
     * Five overlapping constraints usually describe one bad location rather
     * than five independent discounts, and compounding them unchecked reaches
     * a number no transaction supports.
     */
    const out = applyExternalities([
      { key: 'rajakaluve', metres: 0, from: 'a' },
      { key: 'ht_line', metres: 10, from: 'b' },
      { key: 'landfill', metres: 300, from: 'c' },
      { key: 'quarry', metres: 400, from: 'd' },
      { key: 'cremation_ground', metres: 50, from: 'e' },
    ]);
    assert.equal(out.capped, true);
    assert.equal(out.factorPct, -MAX_EXTERNALITY_DISCOUNT);
    assert.ok(Math.abs(out.uncappedPct) > MAX_EXTERNALITY_DISCOUNT, 'and the raw total is kept');
    assert.match(out.say, /one bad location rather than that many/);
  });

  it('says nothing rather than nothing-found when the surroundings are clear', () => {
    const out = applyExternalities([]);
    assert.equal(out.factorPct, 0);
    assert.match(out.say, /Nothing recorded next to this site/);
  });

  it('keeps the unadjusted figure so the discount can be argued with separately', () => {
    // The whole reason it is applied at the end rather than inside each
    // approach: a reader sees the indication, the adjustment and the result.
    const project = siteFile();
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(project, 'land_site.flood_drainage', { near_rajakaluve: true });

    const w = runValuationApproaches(project);
    assert.equal(Math.round(w.unadjusted.indicated!), 50_000_000);
    assert.equal(Math.round(w.reconciliation.indicated!), Math.round(50_000_000 * 0.65));
    assert.match(w.reconciliation.spreadBasis, /for what the site is next to/);
  });

  it('every rate says where it comes from, so a valuer can disagree with it', () => {
    // There is no statute that prices a transmission corridor. The rates are
    // judgements and they have to be arguable, which means findable.
    for (const rule of EXTERNALITY_RULES) {
      assert.ok(rule.basis.length > 80, `${rule.key} has no real basis written down`);
      assert.ok(rule.triggeredBy.length > 10, `${rule.key} does not say what triggers it`);
      assert.ok(rule.bands.length > 0);
      for (const band of rule.bands) assert.ok(band.pct < 0 && band.pct > -1, `${rule.key} band out of range`);
    }
  });

  it('orders every rule’s bands nearest-first, or the wrong one would win', () => {
    // `bandFor` returns the first band containing the distance, so an
    // out-of-order table would silently apply a distant band to a near feature.
    for (const rule of EXTERNALITY_RULES) {
      const distances = rule.bands.map((b) => b.withinM);
      assert.deepEqual(distances, [...distances].sort((a, b) => a - b), `${rule.key} bands are out of order`);
    }
  });
});

describe('Rule 8(3) — which of the twelve this report answers', () => {
  /*
   * Checked against the rule itself rather than against the seven headings the
   * code happened to have. Five of the twelve were absent and two partial, and
   * the absent ones are the items that make a report a professional act rather
   * than a spreadsheet with headings.
   */
  function run(project: DdProject) {
    const computed = computeIndicativeValuation(project);
    return { computed, summary: rule8Summary(computed.ibbi, computed.ibbi.rule8 ?? {}) };
  }

  const status = (s: ReturnType<typeof rule8Summary>, item: string) => s.rows.find((r) => r.item === item)!.status;

  it('covers all twelve clauses of the rule, in order', () => {
    assert.deepEqual(
      RULE_8_ITEMS.map((r) => r.clause),
      ['8(3)(a)', '8(3)(b)', '8(3)(c)', '8(3)(d)', '8(3)(e)', '8(3)(f)', '8(3)(g)', '8(3)(h)', '8(3)(i)', '8(3)(j)', '8(3)(k)', '8(3)(l)'],
    );
  });

  it('reports the valuer and the conflict disclosure missing until a person supplies them', () => {
    // Nothing computes either, and defaulting them would put a disclosure on
    // the report that nobody made.
    const { summary } = run(file());
    assert.equal(status(summary, 'identity'), 'missing');
    assert.equal(status(summary, 'conflict'), 'missing');
    assert.match(summary.rows.find((r) => r.item === 'conflict')!.note!, /An absent disclosure is not a nil disclosure/);
    assert.match(summary.say, /does not meet the report-contents rule/);
  });

  it('reads the inspections off the site visits rather than asking twice', () => {
    // 8(3)(f) was free the moment site visits existed, and the limitations
    // travel with it — a value formed without seeing the roof has a hole in it
    // and the reader has to see the hole.
    const project = file();
    assert.equal(status(run(project).summary, 'inspections'), 'missing');

    addSiteVisit(project, {
      title: 'Inspection',
      purpose: 'valuation_inspection',
      visitedOn: '2026-08-12',
      surveyor: 'R. Iyer',
      limitations: [{ kind: 'height', what: 'Roof — no access equipment' }],
    });
    const after = run(project);
    assert.equal(status(after.summary, 'inspections'), 'stated');
    assert.deepEqual(after.computed.ibbi.rule8!.inspections![0]!.limitations, ['Roof — no access equipment']);
  });

  it('keeps restrictions on use apart from the caveats, because the rule does', () => {
    const { computed, summary } = run(file());
    assert.equal(status(summary, 'restrictions'), 'stated');
    assert.ok(computed.ibbi.rule8!.restrictionsOnUse!.some((r) => /not to be relied on by a lender/i.test(r)));
    assert.ok(!computed.ibbi.caveats.some((c) => /not to be relied on by a lender/i.test(c)), 'and does not duplicate it into the caveats');
  });

  it('lists what actually moved the number as the major factors', () => {
    const project = siteFileFor(file());
    project.saleableAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(project, 'land_site.flood_drainage', { near_rajakaluve: true });
    const { computed, summary } = run(project);
    assert.equal(status(summary, 'factors'), 'stated');
    assert.ok(computed.ibbi.rule8!.majorFactors!.some((f) => /Rajakaluve/.test(f)), 'the discount is a major factor');
    assert.ok(computed.ibbi.rule8!.majorFactors!.some((f) => /Not run:/.test(f)), 'and so is an approach that could not run');
  });

  it('takes a valuer and a nil conflict, and tells them apart from silence', () => {
    const project = file();
    const created = createValuationRun(project);
    assert.equal(status(rule8Summary(created.ibbi, created.ibbi.rule8 ?? {}), 'conflict'), 'missing');

    setValuationValuer(project, created.id, {
      valuer: { name: 'S. Rao', registrationNumber: 'IBBI/RV/06/2019/11234', registeredFor: 'Land and Building', firm: 'Rao & Co' },
      declaredConflict: false,
    });
    const after = valuationRule8(created);
    assert.equal(status(after, 'identity'), 'stated');
    assert.equal(status(after, 'conflict'), 'stated', 'declaring none is a positive statement');
    assert.equal(created.ibbi.rule8!.conflict!.declared, false);
  });

  it('refuses a declared interest with nothing described', () => {
    const project = file();
    const created = createValuationRun(project);
    assert.throws(
      () => setValuationValuer(project, created.id, { valuer: { name: 'S. Rao' }, declaredConflict: true }),
      /Say what it is, or declare none/,
    );
  });

  it('says a name without a registration number cannot be a registered valuer’s report', () => {
    const project = file();
    const created = createValuationRun(project);
    setValuationValuer(project, created.id, { valuer: { name: 'A. Analyst' }, declaredConflict: false });
    const after = valuationRule8(created);
    assert.equal(status(after, 'identity'), 'partial');
    assert.match(after.rows.find((r) => r.item === 'identity')!.note!, /cannot be a registered valuer’s report/);
  });

  it('never congratulates a complete structure into a certificate', () => {
    const project = file();
    const created = createValuationRun(project);
    addSiteVisit(project, { title: 'Inspection', purpose: 'valuation_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer' });
    setValuationValuer(project, created.id, {
      valuer: { name: 'S. Rao', registrationNumber: 'IBBI/RV/06/2019/11234', firm: 'Rao & Co' },
      declaredConflict: false,
      appointedOn: '2026-08-01',
    });
    const full = rule8Summary(
      { ...created.ibbi, evidenceReliedUponIds: ['ev_1'] },
      { ...(created.ibbi.rule8 ?? {}), inspections: [{ visitId: 'v', visitedOn: '2026-08-12', by: 'R. Iyer', limitations: [] }] },
    );
    if (full.missing === 0 && full.partial === 0) {
      assert.match(full.say, /complete structure, not a certified valuation/);
    }
  });
});

describe('approaches that disagree are not blended into a number none of them supports', () => {
  /*
   * Found by running it rather than by reasoning about it. A file with a
   * plausible comparable rate and a mistyped rent produced approaches at 0.5,
   * 13 and 18.5 crore, blended them to 7.3, and printed it with a correctly
   * enormous band. The band was right and nobody reads the band first.
   */
  it('withholds the figure when the spread is past blending, and says which approaches disagree', () => {
    const project = file();
    project.saleableAreaSqm = 1000;
    project.landAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 95_000, rate_basis: 'inspected comparables' });
    // A rent two orders of magnitude out — the exact mistype that produced this.
    record(project, 'indicative_valuation.income_inputs', { achievable_rent: 48, cap_rate_pct: 7.5, vacancy_pct: 6, opex_pct: 22 });

    const r = runValuationApproaches(project).reconciliation;
    assert.equal(r.outcome, 'approaches_disagree');
    assert.equal(r.indicated, null);
    assert.match(r.spreadBasis, /disagreement rather than cross-checking/);
    assert.ok(r.usedMethods.length >= 2, 'and every approach that ran is still listed');
  });

  it('does not tell somebody to record inputs they already recorded', () => {
    /*
     * The bug the live run found. A null `indicated` means two opposite things
     * — nothing ran, or several ran and disagreed — and the report inferred the
     * first, printing "No approach could be run." over four approaches that had
     * all run perfectly well. The two need opposite advice, so the distinction
     * is now in the data rather than in each reader's guess.
     */
    const project = file();
    project.saleableAreaSqm = 1000;
    project.landAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 95_000, rate_basis: 'inspected comparables' });
    record(project, 'indicative_valuation.income_inputs', { achievable_rent: 48, cap_rate_pct: 7.5 });

    const computed = computeIndicativeValuation(project);
    assert.ok(!/No approach could be run/.test(computed.ibbi.reconciliation), computed.ibbi.reconciliation);
    assert.match(computed.ibbi.reconciliation, /No figure is given/);
    assert.match(computed.ibbi.reconciliation, /disagreement rather than cross-checking/);
  });

  it('says nothing ran when nothing did', () => {
    const computed = computeIndicativeValuation(file());
    assert.equal(computed.working!.reconciliation.outcome, 'no_approach_ran');
    assert.match(computed.ibbi.reconciliation, /No approach could be run/);
  });

  it('still blends approaches that differ by a normal amount', () => {
    // Market, cost and income genuinely differ. A factor of two between them
    // is a valuation conversation, not an error.
    const project = file();
    project.saleableAreaSqm = 1000;
    project.landAreaSqm = 1000;
    record(project, 'indicative_valuation.comparable_inputs', { rate_per_sqm: 50_000, rate_basis: 'inspected comparables' });
    record(project, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 35_000 });

    const r = runValuationApproaches(project).reconciliation;
    assert.ok(r.indicated !== null, 'a 1.4× spread is still a valuation');
    assert.ok(MAX_COHERENT_SPREAD >= 0.5, 'and the threshold is deliberately generous');
  });

  it('takes a signed comparable adjustment, which is the ordinary case', () => {
    // `percent` refuses a negative by default, correctly for a vacancy rate and
    // wrongly for an adjustment — the comparables are better than the subject
    // more often than not.
    const project = file();
    project.saleableAreaSqm = 1000;
    const outcome = record(project, 'indicative_valuation.comparable_inputs', {
      rate_per_sqm: 50_000,
      rate_basis: 'inspected comparables',
      net_adjustment_pct: -8,
    });
    assert.deepEqual(outcome.rejected, []);
    const market = approach(project, 'comparable_rate');
    assert.equal(Math.round(market.amount!), Math.round(50_000_000 * 0.92));
    assert.ok(market.steps.some((s) => s.label === 'Adjusted'));
  });

  it('still refuses a negative where a negative is a typo', () => {
    const project = file();
    const outcome = record(project, 'indicative_valuation.income_inputs', { vacancy_pct: -5, achievable_rent: 50, cap_rate_pct: 8 });
    assert.equal(outcome.rejected.length, 1);
    assert.match(outcome.rejected[0]!.error, /cannot be negative/);
  });
});
