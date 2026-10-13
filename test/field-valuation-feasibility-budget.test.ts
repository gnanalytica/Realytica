/**
 * The sheets of Valuation, Feasibility and Budget, read as a person meets
 * them: what shows with nothing in play, what a situation turns on, a figure
 * worked out and a standing with what they were worked out from, a rule that
 * fires and then does not, a rule row cited as unverified, what a match
 * leaves over, and that a field not showing is never counted missing.
 *
 * Every project, party and figure here is invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  PROJECT_FIGURES,
  RULE_ROWS,
  addCostReportVariation,
  addEvidence,
  addFieldRecord,
  addWorkPackages,
  buildFieldCatalog,
  cashFlowPosition,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  fieldSetsOf,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  ruleRowFaults,
  setCostForecast,
  setFieldValues,
  setSituation,
  startCostReport,
  type DdProject,
} from '@realytica/shared';

const VAL = 'finance.valuation';
const FEA = 'finance.feasibility';
const BUD = 'finance.budget';
const NOW = new Date('2026-10-13T00:00:00Z');
const CR = 10_000_000;
const MINE = FIELD_SETS.filter((set) => /^finance\.(valuation|feasibility|budget)\./.test(set.id));

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-VFB');
  p.jurisdiction = 'Karnataka';
  p.landAreaSqm = 4_000;
  p.stakeholders.push({ id: 'stk_bank', name: 'Lakeside Co-operative Bank', role: 'Lender' }, { id: 'stk_qs', name: 'Quantity surveyor', role: 'QS' }, { id: 'stk_le', name: 'Lender’s engineer', role: 'LIE' }, { id: 'stk_tenant', name: 'Corner Pharmacy', role: 'Tenant' });
  createAssessment(p, { ddType: 'acquisition', name: 'Land diligence', owner: 'Lead', targetType: 'project' });
  createAssessment(p, { ddType: 'cost_schedule', name: 'Cost and schedule', owner: 'Lead', targetType: 'project' });
  addEvidence(p, { title: 'Working papers', kind: 'document' }, 'tester');
  return p;
}

/** Records values on a check, citing a paper so a field that needs proof goes in. */
function onCheck(p: DdProject, definitionId: string, values: Record<string, unknown>): void {
  const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId);
  assert.ok(check, `${definitionId} is on the project`);
  recordCheckFields(p, check.id, values, 'tester', p.evidence[0]!.id);
}

const write = (p: DdProject, set: string, values: Record<string, unknown>, record?: string) => assert.deepEqual(setFieldValues(p, { set, ...(record ? { record } : {}) }, values, 'tester').rejected, []);
const add = (p: DdProject, set: string, values: Record<string, unknown>) => {
  const made = addFieldRecord(p, set, values, 'tester');
  assert.deepEqual(made.rejected, []);
  return made.record!;
};

function sheet(p: DdProject, id: string, record?: string) {
  const reading = readSheet(p, id, record, undefined, undefined, NOW)!;
  const view = (key: string) => {
    const found = reading.fields.find((f) => f.def.key === key);
    assert.ok(found, `${id} has ${key}`);
    return found;
  };
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    shown: () => reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    missing: () => reading.fields.filter((f) => f.missing).map((f) => f.def.key),
    said: () => reading.insights.map((i) => i.text),
  };
}

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('the sets of Valuation, Feasibility and Budget', () => {
  it('have no fault and break no limit', () => {
    const ids = new Set(MINE.map((set) => set.id));
    assert.deepEqual(catalogFaults().filter((fault) => [...ids].some((id) => fault.startsWith(id))), []);
    assert.deepEqual(catalogLimits().filter((breach) => ids.has(breach.set)), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
  });

  it('give each of the three functions its sheets, and keep what repeats as records', () => {
    assert.deepEqual(fieldSetsOf(VAL).map((s) => s.id.replace(`${VAL}.`, '')), ['instruction', 'land', 'approaches', 'leases', 'conclusion', 'reports', 'register']);
    assert.deepEqual(fieldSetsOf(FEA).map((s) => s.id.replace(`${FEA}.`, '')), ['areas', 'revenue', 'costs', 'approval_costs', 'periods', 'returns', 'sensitivity', 'decision', 'conditions']);
    assert.deepEqual(fieldSetsOf(BUD).map((s) => s.id.replace(`${BUD}.`, '')), ['approved', 'project_cost_stated', 'contingency', 'transfers', 'commitments', 'cost_report', 'to_complete', 'cost_to_complete_stated']);
    assert.deepEqual(MINE.filter((s) => s.records).map((s) => s.records!.of), ['lease', 'valuation report', 'fee', 'month', 'condition', 'statement', 'transfer', 'statement']);
    assert.deepEqual(MINE.filter((s) => s.extends).map((s) => s.extends), ['shared.parties', 'shared.parcels', 'shared.buildings'], 'a valuer, a parcel and a building are the shared records, with this department’s facts added');
  });

  it('never let a model’s sentence in: one bounded note a sheet at most, and nothing a paper offers lands on a worked-out field', () => {
    for (const set of MINE) {
      const notes = set.fields.filter((def) => def.kind === 'longtext');
      assert.ok(notes.length <= 1, `${set.id} has ${notes.length} notes`);
      for (const note of notes) assert.ok((note.maxLength ?? 0) <= 400, `${set.id}/${note.key} is bounded`);
      for (const def of set.fields) if (def.fromTypes) assert.ok(!['computed', 'status', 'longtext'].includes(def.kind) && !def.sameAs, `${set.id}/${def.key} can take a paper’s value`);
    }
  });

  it('keep every threshold in the rule table, each row unverified and said to be', () => {
    const rows = RULE_ROWS.filter((row) => /^(valuation|feasibility|budget)_/.test(row.key));
    assert.equal(rows.length, 9);
    assert.ok(rows.every((row) => row.verified === false && row.source.regulation.length > 20));
    assert.deepEqual(rows.filter((row) => row.when?.lender).map((row) => row.key), ['valuation_realisable_share', 'valuation_distress_share', 'valuation_guideline_variance_limit'], 'the lender’s figures are kept by lender');
  });

  it('never call a sheet in order over a figure that is not there, and face a new project with few fields', () => {
    const p = project();
    for (const set of MINE.filter((s) => !s.records && !s.extends)) {
      const reading = readSheet(p, set.id, undefined, undefined, undefined, NOW)!;
      const good = reading.fields.filter((f) => f.def.kind === 'status' && f.tone === 'good').map((f) => `${f.def.key}: ${f.held?.value}`);
      assert.deepEqual(good, [], `${set.id} with nothing recorded`);
      assert.deepEqual(reading.insights, [], `${set.id} says nothing of what nobody has filled`);
      const core = reading.fields.filter((f) => f.shown === 'shown' && (f.def.tier ?? reading.set.sections?.find((x) => x.key === f.def.section)?.tier) !== 'expert');
      assert.ok(core.length <= 12, `${set.id} shows ${core.length}`);
      assert.ok(reading.total <= 8, `${set.id} asks a person for ${reading.total} values`);
    }
    const asked = (fn: string) => fieldSetsOf(fn).filter((s) => !s.records).reduce((sum, s) => sum + readSheet(p, s.id, undefined, undefined, undefined, NOW)!.total, 0);
    assert.deepEqual([asked(VAL), asked(FEA), asked(BUD)], [11, 10, 6], 'what a person is asked to fill across each function’s sheets, of nearly four hundred fields declared');
  });

  it('read the modules’ figures through named adapters, and refuse one that is not there', () => {
    assert.equal(PROJECT_FIGURES['cost.budget']?.from, 'cost register');
    const bad = buildFieldCatalog([{ id: 'x', fn: BUD, title: 'x', v: 1, rules: [], fields: [{ key: 'a', label: 'a', kind: 'computed', formula: { op: 'figure', key: 'cost.no_such' } }] }]);
    assert.ok(bad.sets.has('x'));
    assert.ok(catalogFaults([{ id: 'x', fn: BUD, title: 'x', v: 1, rules: [], fields: [{ key: 'a', label: 'a', kind: 'computed', formula: { op: 'figure', key: 'cost.no_such' } }] }]).some((fault) => /reads the figure "cost.no_such"/.test(fault)));
  });
});

/* ==================================================================== */
/* Valuation: a valuation for a lender                                   */
/* ==================================================================== */

describe('Valuation', () => {
  it('opens its inputs by approach: nothing shows until an approach is used', () => {
    const p = project();
    assert.deepEqual(sheet(p, 'finance.valuation.approaches').shown(), []);
    assert.equal(sheet(p, 'finance.valuation.approaches').reading.total, 0, 'and nothing of it is counted');

    setSituation(p, VAL, 'income_approach', true, 'tester');
    const income = sheet(p, 'finance.valuation.approaches');
    assert.deepEqual(income.shown(), ['occupancy', 'let_area', 'achievable_rent', 'vacancy_pct', 'opex_pct', 'cap_rate_pct', 'income_value', 'leases_count', 'rent_roll_monthly', 'rent_on_leases', 'income_standing']);
    assert.deepEqual(income.missing(), ['occupancy'], 'the one field of it a person fills here; the rest are read from the income check');

    // A lease on file, and the rent the valuation assumes beside it.
    add(p, 'finance.valuation.leases', { tenant: 'stk_tenant', area_let: '200 sqm', monthly_rent: 240_000, lease_start: '2025-04-01', expires_on: '2030-03-31' });
    onCheck(p, 'indicative_valuation.income_inputs', { achievable_rent: 1_500, vacancy_pct: 5, opex_pct: 10, cap_rate_pct: 8 });
    const let_ = sheet(p, 'finance.valuation.approaches');
    assert.equal(let_.value('rent_on_leases'), 1_200);
    assert.equal(let_.value('income_standing'), 'Rent assumed differs from the leases');
    assert.deepEqual(let_.said(), ['The leases work out at 1,200 INR/sqm/month and the rent assumed is 1,500 INR/sqm/month: 20.0% apart, outside 10.0%.']);
    onCheck(p, 'indicative_valuation.income_inputs', { achievable_rent: 1_250 });
    assert.equal(sheet(p, 'finance.valuation.approaches').value('income_standing'), 'Rent follows the leases');
    assert.deepEqual(sheet(p, 'finance.valuation.approaches').said(), []);
  });

  it('gives a lender its values only when the valuation is for lending, from a share kept by lender and shown as unverified', () => {
    const p = project();
    onCheck(p, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 50_000 });
    onCheck(p, 'indicative_valuation.subject', { guideline_rate_per_sqm: 30_000 });

    const plain = sheet(p, 'finance.valuation.conclusion');
    assert.equal(plain.shown().length, 12, 'twelve fields with nothing in play');
    assert.equal(plain.value('fair_market_value'), 20 * CR, '4,000 sqm at the land rate adopted, read from the valuation');
    assert.equal(plain.view('fair_market_value').text, '₹20 Cr');
    assert.equal(plain.value('guideline_value'), 12 * CR);
    assert.equal(plain.value('vs_guideline'), 66.7);
    assert.equal(plain.value('outcome'), 'Indicated');
    assert.equal(plain.view('realisable_value').shown, 'hidden');
    assert.ok(!plain.missing().includes('realisable_share_stated') && !plain.missing().includes('liquidation_value'), 'what is not showing is not missing');
    assert.deepEqual(plain.missing(), ['major_factors', 'marketability', 'caveats']);

    onCheck(p, 'indicative_valuation.instruction', { purpose: 'lending' });
    const lending = sheet(p, 'finance.valuation.conclusion');
    assert.equal(lending.view('lender_policy').state, 'assumed');
    assert.equal(lending.value('realisable_share'), 90);
    assert.equal(lending.value('realisable_value'), 18 * CR);
    assert.equal(lending.value('distress_value'), 15 * CR);
    assert.deepEqual(lending.view('realisable_value').cites?.map((c) => [c.key, c.value, c.verified]), [['valuation_realisable_share', 90, false]], 'the value says which row it came from, and that nobody has verified it');
    assert.equal(lending.view('realisable_share_stated').shown, 'hidden');
    assert.equal(lending.value('guideline_standing'), 'Past the limit: say why');
    assert.equal(lending.view('guideline_standing').cites?.[0]?.verified, false);
    assert.deepEqual(lending.said(), ['The value is 66.7 % from the guidance value; past 20 % the report says why.']);
    assert.equal(sheet(p, 'finance.valuation.instruction').view('lender').missing, true, 'and the instruction now asks who the lender is');

    // The lender's own shares, off its sanction letter: the row for general practice is read no longer.
    write(p, 'finance.valuation.conclusion', { lender_policy: 'lender_stated', realisable_share_stated: 85, distress_share_stated: 70 });
    const stated = sheet(p, 'finance.valuation.conclusion');
    assert.equal(stated.value('realisable_value'), 17 * CR);
    assert.equal(stated.value('distress_value'), 14 * CR);
    assert.equal(stated.view('realisable_value').cites, undefined);
    assert.equal(stated.value('guideline_standing'), 'No limit on file for this lender', 'and the value is not said to be within a limit nobody has read');
  });

  it('holds the land to its title, and does not ask for a share until less than the freehold is valued', () => {
    const p = project();
    onCheck(p, 'land_site.parcel_identification', { extent_title: 4_400 });
    onCheck(p, 'indicative_valuation.cost_inputs', { land_rate_per_sqm: 50_000 });
    const land = sheet(p, 'finance.valuation.land');
    assert.equal(land.shown().length, 12);
    assert.equal(land.value('land_standing'), 'Plot area differs from the title');
    assert.deepEqual(land.said(), ['The plot valued is 4,000 sqm and the title gives 4,400 sqm: 9.1% apart, outside 1.0%.']);
    assert.equal(land.view('share_valued_pct').shown, 'hidden');

    onCheck(p, 'land_site.parcel_identification', { extent_title: 4_000 });
    onCheck(p, 'indicative_valuation.subject', { interest: 'leasehold', guideline_rate_per_sqm: 30_000 });
    const lease = sheet(p, 'finance.valuation.land');
    assert.equal(lease.value('land_standing'), 'In order');
    assert.equal(lease.view('share_valued_pct').shown, 'shown', 'a leasehold brings the interest’s fields into play, and nobody set it');
    assert.equal(lease.view('share_valued_pct').missing, true);
    assert.deepEqual(readFunctionFields(p, VAL, NOW).situations.filter((s) => s.state === 'on').map((s) => s.situation.key), ['partial_or_limited_interest', 'cost_approach'], 'and the cost approach is in play by the rate recorded for it');
  });
});

/* ==================================================================== */
/* Feasibility: an appraisal, its cash flow and its sensitivity          */
/* ==================================================================== */

function appraisal(): DdProject {
  const p = project();
  onCheck(p, 'financial_appraisal.revenue_assumptions', { rate_per_sqm: 80_000, saleable_area: 10_000, assumption_dated: '2026-08-01' });
  onCheck(p, 'financial_appraisal.margin', { hurdle_pct: 20 });
  onCheck(p, 'indicative_valuation.residual_inputs', { gdv: 80 * CR, construction_cost: 40 * CR, professional_fees_pct: 5, marketing_pct: 3, land_acquisition_pct: 7 });
  write(p, 'finance.feasibility.costs', { land_cost: '12 Cr', contingency_pct: 5, gst_cost_pct: 10 });
  add(p, 'finance.feasibility.approval_costs', { head: 'plan_sanction', amount: '1.5 Cr', basis: 'Estimate' });
  return p;
}

describe('Feasibility', () => {
  it('works the costs out from what is recorded, and says where they differ from the appraisal check', () => {
    const p = appraisal();
    const costs = sheet(p, 'finance.feasibility.costs');
    assert.equal(costs.shown().filter((key) => !['construction_loaded', 'marketing_cost', 'cost_per_saleable'].includes(key)).length, 12);
    assert.equal(costs.value('approval_costs'), 1.5 * CR);
    assert.equal(costs.value('construction_loaded'), 48 * CR, '40 Cr with fees, contingency and tax of 20% on it');
    assert.equal(costs.value('marketing_cost'), 2.4 * CR);
    assert.equal(costs.value('total_cost'), 64.74 * CR, '12.84 for the land, 1.5 of fees, 48 built, 2.4 to sell');
    assert.equal(costs.value('cost_standing'), 'Worked out');
    assert.equal(costs.view('conversion_fee').shown, 'hidden');

    onCheck(p, 'financial_appraisal.margin', { total_cost: 60 * CR });
    const differs = sheet(p, 'finance.feasibility.costs');
    assert.equal(differs.value('cost_standing'), 'Differs from the appraisal check');
    assert.deepEqual(differs.said(), ['The costs here come to ₹64.74 Cr and the appraisal check records ₹60 Cr: 7.3% apart, outside 1.0%.']);

    // Agricultural land on the approvals check brings the conversion's costs in, and they are asked for.
    onCheck(p, 'regulatory.land_use', { conversion_status: 'agricultural' });
    const farm = sheet(p, 'finance.feasibility.costs');
    assert.equal(farm.view('conversion_fee').missing, true);
    assert.ok(farm.said().includes('The land is to be converted and no conversion fee is in the costs.'));
  });

  it('takes the landowner’s share out of the revenue only under a joint development', () => {
    const p = appraisal();
    const whole = sheet(p, 'finance.feasibility.revenue');
    assert.equal(whole.shown().filter((key) => !['assumption_age_days', 'assumption_age_limit', 'rate_over_comparables_limit'].includes(key)).length, 12);
    assert.equal(whole.value('gdv'), 80 * CR);
    assert.equal(whole.value('developer_revenue'), 80 * CR);
    assert.equal(whole.view('owner_share_assumed_pct').shown, 'hidden');
    assert.equal(whole.value('assumption_age_days'), 73);
    assert.deepEqual(whole.view('assumption_age_limit').cites?.map((c) => [c.key, c.verified]), [['feasibility_assumption_age_days', false]]);
    assert.equal(whole.value('revenue_standing'), 'In order');

    setSituation(p, FEA, 'joint_development', true, 'tester');
    assert.equal(sheet(p, 'finance.feasibility.revenue').view('owner_share_assumed_pct').missing, true);
    assert.deepEqual(sheet(p, 'finance.feasibility.revenue').said(), ['The land is under joint development and the landowner’s share is not in the appraisal.']);
    write(p, 'finance.feasibility.revenue', { owner_share_assumed_pct: 30, owner_share_of: 'Revenue' });
    const joint = sheet(p, 'finance.feasibility.revenue');
    assert.equal(joint.value('owner_share_revenue'), 24 * CR);
    assert.equal(joint.value('developer_revenue'), 56 * CR);
    assert.deepEqual(joint.said(), []);
  });

  it('works out the cash flow’s peak, its rate of return and its present value from the months, never typed', () => {
    const p = appraisal();
    onCheck(p, 'indicative_valuation.residual_inputs', { discount_rate_pct: 12 });
    const first = add(p, 'finance.feasibility.periods', { month: '2026-01-01', land: '12 Cr' });
    add(p, 'finance.feasibility.periods', { month: '2027-01-01', collections: '10 Cr', construction: '20 Cr' });
    add(p, 'finance.feasibility.periods', { month: '2028-01-01', collections: '50 Cr', construction: '10 Cr' });

    const month = sheet(p, 'finance.feasibility.periods', first.id);
    assert.equal(month.value('net'), -12 * CR);
    assert.equal(month.view('loan_drawn').shown, 'hidden');
    assert.deepEqual(month.missing(), [], 'a month asks for nothing but its date, and the loan’s columns are not there to be missed');

    write(p, 'finance.feasibility.returns', { equity: '15 Cr' });
    const returns = sheet(p, 'finance.feasibility.returns');
    assert.equal(returns.shown().filter((key) => !['hurdle_pct', 'discount_rate_pct', 'margin_on_revenue_pct', 'breakeven_sales_pct', 'payback_month'].includes(key)).length, 12);
    assert.equal(returns.value('months'), 3);
    assert.equal(returns.value('collections_total'), 60 * CR);
    assert.equal(returns.value('outflow_total'), 42 * CR);
    assert.equal(returns.value('peak_funding'), 22 * CR, 'twelve out, then ten more, before fifty comes in');
    assert.equal(returns.value('peak_month'), '2027-01-01');
    assert.equal(returns.value('project_irr'), 45.6, '12 out, 10 out a year on, 40 back a year after');
    assert.equal(returns.value('npv'), Math.round((-12 - 10 / 1.12 + 40 / 1.12 ** 2) * CR * 100) / 100);
    assert.equal(returns.value('profit'), 15.26 * CR);
    assert.equal(returns.value('margin_pct'), 23.6);
    assert.equal(returns.value('returns_standing'), 'Funding short of the peak');
    assert.ok(returns.said().includes('Equity and debt come to ₹15 Cr and the cash flow needs ₹22 Cr at its peak.'));
    assert.deepEqual(cashFlowPosition([{ day: 0, net: -12 }, { day: 365, net: -10 }, { day: 730, net: 40 }]), { peakFunding: 22, peakDay: 365, paybackDay: 730 });

    write(p, 'finance.feasibility.returns', { equity: '25 Cr' });
    const funded = sheet(p, 'finance.feasibility.returns');
    assert.equal(funded.value('returns_standing'), 'Clears the hurdle');
    assert.ok(!funded.said().some((line) => /at its peak/.test(line)));
    assert.equal(funded.view('interest_total').shown, 'hidden');

    // A lender: the debt assumed counts toward the peak, and each month takes the loan's columns.
    // Nobody says so: a facility on Lenders' register does.
    add(p, 'finance.lenders.facilities', { name: 'Construction loan' });
    write(p, 'finance.feasibility.returns', { equity: '10 Cr' });
    write(p, 'finance.feasibility.costs', { debt_assumed: '14 Cr', interest_rate_assumed_pct: 11 });
    assert.equal(sheet(p, 'finance.feasibility.returns').value('funds'), 24 * CR);
    assert.equal(sheet(p, 'finance.feasibility.returns').value('returns_standing'), 'Clears the hurdle');
    assert.equal(sheet(p, 'finance.feasibility.periods', first.id).view('loan_drawn').shown, 'shown');
  });

  it('computes the sensitivity grid from one step, and turns when a step loses money', () => {
    const p = appraisal();
    const grid = sheet(p, 'finance.feasibility.sensitivity');
    assert.equal(grid.shown().length, 12);
    assert.equal(grid.view('step_pct').state, 'assumed');
    assert.equal(grid.value('step_pct'), 5);
    assert.deepEqual(['margin_price_down_2', 'margin_price_down_1', 'margin_price_up_1', 'margin_price_up_2'].map((key) => grid.value(key)), [11.6, 17.6, 29.5, 35.4]);
    assert.deepEqual(['margin_cost_down_2', 'margin_cost_down_1', 'margin_cost_up_1', 'margin_cost_up_2'].map((key) => grid.value(key)), [33.5, 28.3, 19.2, 15]);
    assert.equal(grid.value('breakeven_price_fall_pct'), 19.7);
    assert.equal(grid.value('breakeven_cost_rise_pct'), 31.8);
    assert.equal(grid.value('sensitivity_standing'), 'Profit holds across the steps');
    assert.deepEqual(grid.missing(), [], 'a usual step stands in, so nothing is asked');

    write(p, 'finance.feasibility.sensitivity', { step_pct: 12 });
    const wide = sheet(p, 'finance.feasibility.sensitivity');
    assert.equal(wide.value('margin_price_down_2'), -5.2);
    assert.equal(wide.value('sensitivity_standing'), 'Two steps down in price lose money');
    assert.deepEqual(wide.said(), ['Two steps down in price leave a margin of -5.2 %.']);
  });

  it('asks for conditions only when the decision carries them, and counts them as a list of ticks', () => {
    const p = appraisal();
    onCheck(p, 'indicative_valuation.residual_inputs', { developer_profit_pct: 18, finance_pct: 12, build_months: 30, discount_rate_pct: 12 });
    write(p, 'finance.feasibility.decision', { asking_price: '14 Cr', decision: 'proceed' });
    const decided = sheet(p, 'finance.feasibility.decision');
    assert.equal(decided.shown().length, 12);
    assert.equal(decided.view('conditions_set').shown, 'hidden');
    const residual = decided.value('residual_land_value') as number;
    assert.equal(decided.value('headroom'), Math.round((residual - 14 * CR) * 100) / 100);
    assert.equal(decided.value('price_standing'), residual >= 14 * CR ? 'Asking price within the residual' : 'Asking price above the residual');

    write(p, 'finance.feasibility.decision', { decision: 'proceed_with_conditions' });
    add(p, 'finance.feasibility.conditions', { condition: 'Title cleared', met: true, met_on: '2026-09-30' });
    add(p, 'finance.feasibility.conditions', { condition: 'Plan sanctioned', met: false });
    const conditional = sheet(p, 'finance.feasibility.decision');
    assert.equal(conditional.value('conditions_set'), 2);
    assert.equal(conditional.value('conditions_met'), 1);
    assert.equal(conditional.value('conditions_standing'), 'Conditions open');
    assert.ok(conditional.said().includes('1 of 2 conditions are met.'));
  });
});

/* ==================================================================== */
/* Budget: a forecast over the budget                                    */
/* ==================================================================== */

function job(): { p: DdProject; packs: string[] } {
  const p = project();
  const packs = addWorkPackages(p, [{ code: 'P1', name: 'Structure', budget: 30 * CR }, { code: 'P2', name: 'Finishes', budget: 12 * CR }, { code: 'P3', name: 'MEP' }], 'tester').map((pack) => pack.id);
  return { p, packs };
}

describe('Budget', () => {
  it('reads the budget from the cost register, and pairs its packages with the appraisal’s cost heads', () => {
    const { p, packs } = job();
    const approved = sheet(p, 'finance.budget.approved');
    assert.equal(approved.shown().length, 12);
    assert.equal(approved.value('budget_total'), 42 * CR, 'the register’s own figure, not typed here');
    assert.equal(approved.value('packages_unbudgeted'), 1);
    assert.equal(approved.value('budget_standing'), 'Packages without a budget');
    assert.equal(approved.view('project_cost_low').shown, 'hidden', 'nobody has stated a project cost yet');
    assert.ok(setFieldValues(p, { set: 'finance.budget.approved' }, { budget_total: 1 }, 'tester').rejected.length, 'a figure of the register cannot be typed over');

    write(p, 'finance.feasibility.costs', { cost_by_head: [{ head: 'Structure', amount: 28 * CR, basis: 'Cost plan' }, { head: 'Finishes', amount: 10 * CR, basis: 'Cost plan' }, { head: 'External works', amount: 2 * CR, basis: 'Estimate' }] });
    write(p, 'finance.budget.approved', { packages_to_heads: [{ package: packs[0], head: 'Structure' }] });
    const match = sheet(p, 'finance.budget.approved').view('packages_to_heads').match!;
    assert.deepEqual(match.pairs.map((pair) => [pair.leftLabel, pair.rightLabel]), [['P1 Structure', 'Structure']]);
    assert.deepEqual(match.left.leftover.map((item) => item.label), ['P2 Finishes', 'P3 MEP']);
    assert.deepEqual(match.right.leftover.map((item) => item.label), ['Finishes', 'External works']);
    const page = readFunctionFields(p, BUD, NOW);
    assert.equal(page.counts.unmatched, 4);
    assert.ok(page.exceptions.some((e) => e.kind === 'unmatched' && e.text === 'Appraisal heads: External works'), 'a head the appraisal priced and no package carries');
  });

  it('opens the overrun’s fields only when the forecast is over the budget, and holds it against a contingency that is thin', () => {
    const { p } = job();
    const before = sheet(p, 'finance.budget.to_complete');
    assert.deepEqual(before.shown(), ['forecast_final_cost', 'forecast_dated', 'certified_to_date', 'paid_to_date', 'cost_to_complete', 'cash_to_complete', 'budget_total', 'overrun', 'contingency_left', 'overrun_standing'], 'the two limits read from the rule table are expert and worked out: they stay folded as the working behind the standings');
    assert.equal(before.view('funded_by').shown, 'hidden');
    assert.deepEqual(before.missing(), [], 'every figure of it is read or worked out');

    setCostForecast(p, { finalCost: 40 * CR }, 'tester');
    write(p, 'finance.budget.contingency', { contingency_original: '2 Cr' });
    const within = sheet(p, 'finance.budget.to_complete');
    assert.equal(within.value('overrun'), -2 * CR);
    assert.equal(within.value('overrun_standing'), 'Within the budget');
    assert.equal(within.view('funded_by').shown, 'hidden');

    // A variation drawn from contingency on the month's cost report, and a forecast now over the budget.
    const report = startCostReport(p, { month: '2026-09-15' }, 'tester');
    addCostReportVariation(p, report.id, { description: 'Deeper footings', amount: 1.2 * CR, contingencyDrawn: true, dated: '2026-09-20' }, 'tester');
    setCostForecast(p, { finalCost: 45 * CR }, 'tester');

    const contingency = sheet(p, 'finance.budget.contingency');
    assert.equal(contingency.value('contingency_drawn'), 1.2 * CR);
    assert.equal(contingency.value('contingency_left'), 0.8 * CR);
    assert.equal(contingency.value('contingency_left_pct'), 1.8);
    assert.equal(contingency.value('contingency_standing'), 'Thin');
    assert.deepEqual(contingency.view('contingency_standing').cites?.map((c) => [c.key, c.value, c.verified]), [['budget_contingency_floor', 3, false]]);
    assert.deepEqual(contingency.said(), ['Contingency is 1.8 % of the work left; 3 % at least.']);

    const over = sheet(p, 'finance.budget.to_complete');
    assert.equal(over.value('cost_to_complete'), 45 * CR);
    assert.equal(over.value('overrun'), 3 * CR);
    assert.equal(over.value('overrun_pct'), 7.1);
    assert.equal(over.value('overrun_standing'), 'Over the budget and the contingency');
    assert.deepEqual(over.missing(), ['overrun_causes', 'funded_by'], 'what the overrun is made of and who funds it; the lender’s date is asked only where a lender funds the job');
    assert.ok(over.said().includes('The forecast is ₹3 Cr over the budget and ₹80 lakh of contingency remains.'));
    assert.ok(over.said().includes('The forecast is over the budget and how the overrun is funded is not said.'));
    assert.deepEqual(readFunctionFields(p, BUD, NOW).situations.filter((s) => s.state === 'on').map((s) => s.situation.key), ['forecast_over_budget']);

    add(p, 'finance.lenders.facilities', { name: 'Construction loan' });
    assert.deepEqual(sheet(p, 'finance.budget.to_complete').missing(), ['overrun_causes', 'funded_by', 'lender_told_on']);
    write(p, 'finance.budget.to_complete', { funded_by: 'promoter', lender_told_on: '2026-10-01', overrun_causes: [{ cause: 'Variations', amount: 1.2 * CR }, { cause: 'Price rise', amount: 1.8 * CR }] });
    const explained = sheet(p, 'finance.budget.to_complete');
    assert.equal(explained.value('overrun_explained'), 3 * CR);
    assert.deepEqual(explained.missing(), []);
    assert.ok(!explained.said().some((line) => /funded/.test(line)));
  });

  it('keeps cost to complete as each person states it, and says when they differ from each other and from the register', () => {
    const { p } = job();
    setCostForecast(p, { finalCost: 45 * CR }, 'tester');
    assert.equal(sheet(p, 'finance.budget.to_complete').view('ctc_agreement').shown, 'hidden');

    add(p, 'finance.budget.cost_to_complete_stated', { source: 'stk_qs', figure: '44 Cr', stated_on: '2026-09-30' });
    const one = sheet(p, 'finance.budget.to_complete');
    assert.equal(one.view('ctc_agreement').shown, 'shown');
    assert.equal(one.value('ctc_agreement'), 'Stated figures agree');
    add(p, 'finance.budget.cost_to_complete_stated', { source: 'stk_le', figure: '48 Cr', stated_on: '2026-10-05' });
    const two = sheet(p, 'finance.budget.to_complete');
    assert.equal(two.value('ctc_low'), 44 * CR);
    assert.equal(two.value('ctc_high'), 48 * CR);
    assert.equal(two.value('ctc_spread'), 8.33);
    assert.equal(two.value('ctc_agreement'), 'Stated figures differ');
    assert.equal(two.value('ctc_against_stated'), -6.2);
    assert.ok(two.said().includes('Cost to complete works out at ₹45 Cr and the highest stated is ₹48 Cr: 6.3% apart, outside 5.0%.'));
    assert.deepEqual(readFunctionFields(p, BUD, NOW).sheets.find((s) => s.set.id === 'finance.budget.cost_to_complete_stated')!.records!.map((r) => r.title), ['Quantity surveyor', 'Lender’s engineer']);
  });

  it('reads the month’s cost report, and holds its anticipated cost to its budget', () => {
    const { p } = job();
    assert.equal(sheet(p, 'finance.budget.cost_report').value('reports'), 0);
    assert.equal(sheet(p, 'finance.budget.cost_report').value('anticipated_cost'), null, 'no report, no figure: never a zero');
    const report = startCostReport(p, { month: '2026-09-15' }, 'tester');
    report.rows[0]!.anticipatedCost = 33 * CR;
    report.rows[0]!.poIssued = 20 * CR;
    report.rows[0]!.amountPaid = 5 * CR;
    report.rows[1]!.anticipatedCost = 12 * CR;
    const read = sheet(p, 'finance.budget.cost_report');
    assert.equal(read.shown().length, 11);
    assert.equal(read.value('period_end'), '2026-09-30');
    assert.equal(read.value('report_budget'), 42 * CR);
    assert.equal(read.value('anticipated_variance'), 3 * CR);
    assert.equal(read.value('paid_of_issued_pct'), 25);
    assert.equal(read.value('report_standing'), 'Anticipated cost above the budget');
    assert.deepEqual(read.said(), ['Anticipated cost is ₹45 Cr against a budget of ₹42 Cr.']);
    report.rows[0]!.anticipatedCost = 30 * CR;
    assert.equal(sheet(p, 'finance.budget.cost_report').value('report_standing'), 'In order');
  });
});
