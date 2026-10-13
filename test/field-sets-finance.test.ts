/**
 * The field sets of Finance (funding, cash, the RERA account), Tax, Lenders
 * and Ledgers, read the way a person meets them.
 *
 * Each test builds a project with invented values and asserts what shows:
 * how little a project that has recorded nothing is asked, what a situation
 * brings into play, what is worked out and from which rule row, a rule
 * failing and then passing, and that a field that is not showing is never
 * counted as missing. Every name and figure here is made up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  RULE_ROWS,
  addFieldRecord,
  addMilestones,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  fieldCatalog,
  fieldSetsOf,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  resolveFields,
  ruleRowFaults,
  setFieldValues,
  setSituation,
  workstreamDefinition,
  type DdProject,
} from '@realytica/shared';

const FNS = ['finance.funding', 'finance.tax', 'finance.lenders', 'finance.ledgers'];
const NOW = new Date('2026-11-15T00:00:00Z');
const CR = 10_000_000;
const LAKH = 100_000;

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Lakeside Road', city: 'Bengaluru' }, 'RYT-FIN');
  p.jurisdiction = 'Karnataka';
  for (const ddType of ['acquisition', 'cost', 'cost_schedule', 'feasibility', 'construction_progress'] as const) createAssessment(p, { ddType, name: ddType, owner: 'Lead', targetType: 'project' });
  p.stakeholders.push({ id: 'stk_qs', name: 'Quantity surveyor', role: 'QS' }, { id: 'stk_le', name: 'Lender’s engineer', role: 'LIE' }, { id: 'stk_builder', name: 'Northgate Builders', role: 'Contractor' });
  return p;
}

/** Writes to a sheet or a record, or to a check's own fields where the set is a check. */
function write(p: DdProject, set: string, values: Record<string, unknown>, record?: string): void {
  if (fieldCatalog().checks.has(set)) {
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === set);
    assert.ok(check, `${set} is on the project`);
    recordCheckFields(p, check.id, values, 'tester');
    return;
  }
  assert.deepEqual(setFieldValues(p, { set, ...(record ? { record } : {}) }, values, 'tester').rejected, []);
}

function add(p: DdProject, set: string, values: Record<string, unknown>): string {
  const made = addFieldRecord(p, set, values, 'tester');
  assert.ok(made.record, `${set}: ${JSON.stringify(made)}`);
  return made.record.id;
}

function sheet(p: DdProject, set: string, record?: string) {
  const reading = readSheet(p, set, record, resolveFields(p, NOW), fieldCatalog(), NOW)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    shown: () => reading.fields.filter((f) => f.shown === 'shown').map((f) => f.def.key),
    said: () => reading.insights.map((i) => i.text),
    cites: (key: string) => (view(key).cites ?? []).map((c) => [c.key, c.value, c.verified]),
  };
}

const page = (p: DdProject, fn: string) => readFunctionFields(p, fn, NOW);
const situation = (p: DdProject, fn: string, key: string) => page(p, fn).situations.find((s) => s.situation.key === key)?.state;

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('the Finance, Tax, Lenders and Ledgers catalog', () => {
  const mine = FIELD_SETS.filter((set) => FNS.includes(set.fn));

  it('has no fault and breaks no limit, in any of its sets', () => {
    assert.deepEqual(catalogFaults().filter((fault) => FNS.some((fn) => fault.includes(fn))), []);
    assert.deepEqual(catalogLimits(mine), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
  });

  it('gives each of the four functions a page of small sheets and records', () => {
    for (const fn of FNS) assert.ok(workstreamDefinition(fn), `${fn} is a function`);
    assert.deepEqual(FNS.map((fn) => fieldSetsOf(fn).length), [11, 16, 20, 8], 'sheets and record sets of each, the three that extend a shared record aside');
    assert.deepEqual(mine.filter((set) => set.extends).map((set) => [set.id, set.extends]), [
      ['finance.funding.account_facts', 'shared.accounts'],
      ['finance.tax.party_registrations', 'shared.parties'],
      ['finance.tax.unit_gst', 'shared.units'],
      ['finance.ledgers.supplier_facts', 'shared.parties'],
    ]);
    // No sheet always shows more than twelve fields, and no record holds more than twenty.
    for (const set of mine) assert.ok(set.fields.length <= 20, `${set.id} has ${set.fields.length} fields`);
  });

  it('keeps every figure a law sets in the rule table, each row unverified and saying where it is written', () => {
    for (const key of ['rera_deposit_share_stressed', 'gst_affordable_price_max', 'tds_property_purchase', 'tds_contractor', 'ka_stamp_duty_sale', 'ka_registration_fee', 'stamp_value_tolerance', 'rbi_cost_overrun_max']) {
      const rows = RULE_ROWS.filter((row) => row.key === key);
      assert.ok(rows.length > 0, key);
      for (const row of rows) {
        assert.equal(row.verified, false, key);
        assert.ok(row.source.regulation, key);
      }
    }
    // Tax deducted at source is cited by the 2025 Act's serial, with the old section named beside it.
    assert.match(RULE_ROWS.find((row) => row.key === 'tds_property_purchase')!.source.clause!, /section 393\(1\).*old section 194-IA/);
    // No label or key of a field carries the figure: the deposit share is read, never written.
    assert.ok(!mine.some((set) => set.fields.some((def) => /\b(70|100|80)\b/.test(`${def.key} ${def.label}`))));
  });

  it('says on every Tax sheet that it is a record and not advice', () => {
    for (const id of ['finance.tax.gst', 'finance.tax.tds', 'finance.tax.duty', 'finance.tax.jda', 'finance.tax.jda_tax']) {
      assert.match(fieldCatalog().sets.get(id)!.sections![0]!.label, /not tax advice$/, id);
    }
  });

  it('asks almost nothing of a project that has recorded nothing, and keeps nothing out of sight', () => {
    const p = project();
    const asked = Object.fromEntries(
      FNS.map((fn) => {
        const read = page(p, fn);
        const views = read.sheets.flatMap((s) => (s.reading ? s.reading.fields : []));
        assert.deepEqual(views.filter((v) => v.notInPlay).map((v) => v.def.key), [], `${fn} holds nothing that is not showing`);
        assert.equal(read.counts.rule, 0, `${fn} has no rule to fail`);
        return [fn, [views.filter((v) => v.shown === 'shown').length, read.counts.missing]];
      }),
    );
    // Shown, then asked for. Funding and Lenders show nothing until an account, a source or a facility is recorded.
    assert.deepEqual(asked, { 'finance.funding': [0, 0], 'finance.tax': [13, 2], 'finance.lenders': [0, 0], 'finance.ledgers': [11, 2] });
  });
});

/* ==================================================================== */
/* Finance: the RERA designated account                                  */
/* ==================================================================== */

describe('Finance: the RERA designated account', () => {
  const COST = 'finance.funding.rera_cost';
  const DEPOSIT = 'finance.funding.rera_deposit';
  const WITHDRAWAL = 'finance.funding.rera_withdrawal';

  function registered(): DdProject {
    const p = project();
    add(p, 'shared.accounts', { name: 'Designated account', purpose: 'RERA designated' });
    write(p, COST, {
      quarter_end: '2026-09-30',
      construction_estimated: '40 Cr',
      construction_per_engineer: '12 Cr',
      construction_per_books: '13 Cr',
      cost_rows: [
        { head: 'land_acquisition', estimated: 20 * CR, incurred: 20 * CR },
        { head: 'onsite', estimated: 2 * CR, incurred: 0.5 * CR },
      ],
    });
    return p;
  }

  it('shows nothing of it until an account is kept as the designated one, and counts none of it missing', () => {
    const p = project();
    assert.equal(situation(p, 'finance.funding', 'designated_account_kept'), 'off');
    // A value recorded early is kept, out of sight, and asks for nothing.
    write(p, COST, { quarter_end: '2026-09-30' });
    const hidden = sheet(p, COST);
    assert.deepEqual(hidden.shown(), []);
    assert.equal(hidden.view('quarter_end').notInPlay, true);
    assert.equal(hidden.view('construction_estimated').missing, false);
    assert.equal(hidden.reading.total, 0);
    assert.equal(page(p, 'finance.funding').counts.missing, 0);

    // Nobody sets the situation: recording the account does.
    add(p, 'shared.accounts', { name: 'Designated account', purpose: 'RERA designated' });
    assert.equal(situation(p, 'finance.funding', 'designated_account_kept'), 'on');
    assert.equal(sheet(p, COST).shown().length, 12);
    assert.equal(sheet(p, COST).view('construction_estimated').missing, true);
    // The deposit sheet's thirteenth, the count of designated accounts, is worked out and expert: it stays folded as the working behind the standing.
    assert.deepEqual([sheet(p, WITHDRAWAL).shown().length, sheet(p, DEPOSIT).shown().length], [10, 12]);
  });

  it('counts construction cost at the lower of the engineer’s figure and the books, and says so when the books are higher', () => {
    const p = registered();
    const cost = sheet(p, COST);
    assert.equal(cost.value('construction_counted'), 12 * CR);
    assert.equal(cost.value('other_incurred'), 20.5 * CR, 'the heads are rows, and their total is worked out');
    assert.deepEqual([cost.value('total_estimated'), cost.value('total_incurred'), cost.value('balance_cost')], [62 * CR, 32.5 * CR, 29.5 * CR]);
    assert.equal(cost.value('cost_standing'), 'Books above the engineer’s figure');
    assert.deepEqual(cost.said(), ['The books show ₹13 Cr of construction cost and the engineer certifies ₹12 Cr: the lower is counted.']);

    write(p, COST, { construction_per_books: '11 Cr' });
    const lower = sheet(p, COST);
    assert.equal(lower.value('construction_counted'), 11 * CR, 'and the books where they are lower');
    assert.equal(lower.value('cost_standing'), 'In order');
    assert.deepEqual(lower.said(), []);

    // One figure alone is not "the lower of the two".
    const q = project();
    add(q, 'shared.accounts', { name: 'Designated account', purpose: 'RERA designated' });
    write(q, COST, { construction_per_engineer: '12 Cr' });
    assert.equal(sheet(q, COST).value('construction_counted'), null);
  });

  it('moves the share to deposit to the higher rule row once estimated receivables fall below the cost left to complete', () => {
    const p = registered();
    write(p, 'indicative_valuation.subject', { guideline_rate_per_sqm: 60000 });
    write(p, DEPOSIT, { realised: '10 Cr', deposited: '7 Cr', receivable_sold: '20 Cr', unsold_carpet: '2000 sqm' });

    const ahead = sheet(p, DEPOSIT);
    assert.equal(ahead.value('quarter_end'), '2026-09-30', 'the quarter is entered once, on the cost sheet');
    assert.equal(ahead.value('unsold_value'), 12 * CR, 'unsold area at the guidance rate Valuation holds');
    assert.deepEqual([ahead.value('estimated_receivables'), ahead.value('balance_cost')], [32 * CR, 29.5 * CR]);
    assert.equal(ahead.value('required_share'), 70);
    assert.deepEqual(ahead.cites('required_share'), [['rera_deposit_share', 70, false]]);
    assert.equal(ahead.value('deposit_standing'), 'Deposited as required');
    assert.deepEqual(ahead.said(), []);

    write(p, DEPOSIT, { receivable_sold: '15 Cr' });
    const short = sheet(p, DEPOSIT);
    assert.equal(short.value('estimated_receivables'), 27 * CR);
    assert.equal(short.value('required_share'), 100);
    // The row it read is shown beside the value and the standing, and nobody has verified it.
    assert.deepEqual(short.cites('required_share'), [['rera_deposit_share_stressed', 100, false]]);
    assert.equal(short.view('required_share').cites![0]!.source.clause, 'Form 4, additional information (5)');
    assert.equal(short.view('deposit_standing').cites![0]!.verified, false);
    assert.equal(short.value('deposit_standing'), 'Short of the share to deposit');
    assert.equal(short.view('deposit_standing').tone, 'critical');
    assert.deepEqual(short.said(), ['70% of what was realised was deposited; 100% is required.']);

    write(p, DEPOSIT, { deposited: '10 Cr' });
    assert.equal(sheet(p, DEPOSIT).value('deposit_standing'), 'Deposited as required');
    assert.deepEqual(sheet(p, DEPOSIT).said(), []);

    // A second account kept as the designated one is said, once.
    add(p, 'shared.accounts', { name: 'Second designated account', purpose: 'RERA designated' });
    assert.deepEqual(sheet(p, DEPOSIT).said(), ['Accounts kept as the RERA designated account: 2. A registration has one.']);
  });

  it('takes the amount that can be withdrawn from the accountant’s certificate, and waits for the accountant on how it was worked', () => {
    const p = registered();
    write(p, WITHDRAWAL, { completion_by_architect: 45, withdrawable_certified: '32.5 Cr', withdrawn_to_date: '30 Cr' });
    const waiting = sheet(p, WITHDRAWAL);
    assert.equal(waiting.value('completion_by_cost'), 52.42);
    assert.equal(waiting.value('net_withdrawable'), 2.5 * CR, 'the certificate’s figure less what is withdrawn');
    assert.equal(waiting.value('by_cost'), 32.5 * CR, 'cost incurred is shown beside it, and decides nothing');
    assert.equal(waiting.value('withdrawal_standing'), 'Basis not confirmed by the accountant');
    assert.deepEqual(waiting.said(), ['The accountant has not said how the amount that can be withdrawn was worked.']);
    assert.equal(waiting.view('basis').def.kind, 'enum', 'a choice the accountant makes, never a formula');

    write(p, WITHDRAWAL, { basis: 'cost_incurred' });
    assert.equal(sheet(p, WITHDRAWAL).value('withdrawal_standing'), 'Within the certificate');
    assert.deepEqual(sheet(p, WITHDRAWAL).said(), []);

    write(p, WITHDRAWAL, { withdrawn_to_date: '33 Cr' });
    const over = sheet(p, WITHDRAWAL);
    assert.equal(over.value('withdrawal_standing'), 'Withdrawn beyond the certificate');
    assert.deepEqual(over.said(), ['₹33 Cr has been withdrawn and the certificate allows ₹32.5 Cr.']);
  });
});

/* ==================================================================== */
/* Finance: the funding plan and cash                                    */
/* ==================================================================== */

describe('Finance: the funding plan and cash', () => {
  it('adds the sources up, and holds the promoter’s share against the lender’s minimum only once a lender is recorded', () => {
    const p = project();
    write(p, 'cost_quantity.budget_current', { sanctioned_budget: '100 Cr' });
    assert.deepEqual(sheet(p, 'finance.funding.plan').shown(), [], 'nothing to show before the first source');
    add(p, 'finance.funding.sources', { kind: 'promoter_equity', planned: '25 Cr', brought_in: '10 Cr' });
    add(p, 'finance.funding.sources', { kind: 'construction_loan', planned: '40 Cr' });
    add(p, 'finance.funding.sources', { kind: 'customer_advances', planned: '35 Cr' });

    const plan = sheet(p, 'finance.funding.plan');
    assert.equal(plan.value('project_cost'), 100 * CR, 'the budget’s own figure, mirrored');
    assert.deepEqual([plan.value('planned_total'), plan.value('equity_planned'), plan.value('debt_planned'), plan.value('equity_in')], [100 * CR, 25 * CR, 40 * CR, 10 * CR]);
    assert.deepEqual([plan.value('promoter_share'), plan.value('debt_to_equity')], [25, 1.6]);
    assert.equal(plan.view('lender_minimum_share').shown, 'hidden');
    assert.equal(plan.value('plan_standing'), 'Sources cover the cost');

    add(p, 'finance.lenders.facilities', { name: 'Construction term loan', sanctioned_amount: '40 Cr', cost_appraised: '100 Cr', min_promoter_share: 30 });
    const funded = sheet(p, 'finance.funding.plan');
    assert.equal(funded.view('lender_minimum_share').shown, 'shown');
    assert.equal(funded.value('plan_standing'), 'Promoter contribution below the lender’s minimum');
    assert.deepEqual(funded.said(), ['Promoter contribution is 25% of cost and the lender’s minimum is 30%.']);
  });

  it('opens the shortfall fields only when the forecast runs below zero', () => {
    const p = project();
    add(p, 'shared.accounts', { name: 'Collection account', purpose: 'collection', bank_balance: '4.1 Cr' });
    write(p, 'finance.funding.cash', { as_at: '2026-10-31', figures_from: 'package', opening_balance: '2 Cr' });
    add(p, 'finance.funding.cash_months', { month: '2026-10-01', collections: '3 Cr', loan_drawn: '4 Cr', contractors: '4.6 Cr', interest: '30 lakh' });
    add(p, 'finance.funding.forecast_weeks', { week_beginning: '2026-11-02', receipts: '60 lakh', payments: '1.4 Cr', closing: '3.4 Cr' });

    const cash = sheet(p, 'finance.funding.cash');
    assert.deepEqual([cash.value('net_to_date'), cash.value('closing_by_months'), cash.value('months_less_banks')], [2.1 * CR, 4.1 * CR, 0]);
    assert.equal(cash.value('cash_standing'), 'Covered through the forecast');
    assert.equal(cash.view('gap_cover').shown, 'hidden');
    assert.equal(cash.view('gap_cover').missing, false);

    add(p, 'finance.funding.forecast_weeks', { week_beginning: '2026-11-09', receipts: '40 lakh', payments: '4.2 Cr', closing: -40 * LAKH });
    const short = sheet(p, 'finance.funding.cash');
    assert.equal(situation(p, 'finance.funding', 'cash_gap_ahead'), 'on');
    assert.equal(short.value('cash_standing'), 'Short within the forecast');
    assert.equal(short.value('gap_amount'), 40 * LAKH);
    assert.equal(short.view('gap_cover').missing, true, 'and now it is asked: who covers it');
    assert.deepEqual(short.said(), ['The forecast balance falls to −₹40 lakh.']);
  });
});

/* ==================================================================== */
/* Tax                                                                   */
/* ==================================================================== */

describe('Tax', () => {
  it('works stamp duty and fees out of dated rule rows, an instrument at a time, and flags a price under the stamp value', () => {
    const p = project();
    const deed = add(p, 'finance.tax.instruments', { instrument: 'sale_deed', executed_on: '2026-10-20', locality: 'urban', consideration: '80 lakh', extent: '1000 sqm', guidance_rate: 9000 });
    const under = sheet(p, 'finance.tax.instruments', deed);
    assert.deepEqual([under.value('stamp_value'), under.value('dutiable_value')], [90 * LAKH, 90 * LAKH], 'duty is charged on the higher of price and stamp value');
    assert.deepEqual([under.value('stamp_duty'), under.value('cess'), under.value('surcharge'), under.value('registration_fee'), under.value('total_duty')], [450_000, 45_000, 9_000, 180_000, 684_000]);
    assert.deepEqual(under.cites('total_duty'), [['ka_stamp_duty_sale', 5, false], ['ka_cess', 10, false], ['ka_surcharge', 2, false], ['ka_registration_fee', 2, false]]);
    assert.equal(under.value('below_tolerance_by'), 1 * LAKH);
    assert.equal(under.value('duty_standing'), 'Price below the stamp value tolerance');
    assert.equal(under.said()[0], 'The price is below the stamp duty value by ₹1 lakh more than the tolerance allows.');

    write(p, 'finance.tax.instruments', { consideration: '85 lakh', paid: '6.84 lakh' }, deed);
    const within = sheet(p, 'finance.tax.instruments', deed);
    assert.equal(within.value('duty_standing'), 'In order');
    assert.deepEqual(within.said(), []);
    assert.equal(sheet(p, 'finance.tax.duty').value('worked_out'), 684_000);

    // Before the day the rows were read, nobody has confirmed a rate: nothing is worked out, and nothing is guessed.
    const old = add(p, 'finance.tax.instruments', { instrument: 'sale_deed', executed_on: '2024-05-01', locality: 'urban', consideration: '80 lakh', extent: '1000 sqm', guidance_rate: 7000 });
    assert.equal(sheet(p, 'finance.tax.instruments', old).value('stamp_duty'), null);
    // And for an instrument whose duty was never sourced.
    const jda = add(p, 'finance.tax.instruments', { instrument: 'joint_development_agreement', executed_on: '2026-10-20', locality: 'urban', consideration: '5 Cr', extent: '1000 sqm', guidance_rate: 9000 });
    assert.equal(sheet(p, 'finance.tax.instruments', jda).value('stamp_duty'), null);
  });

  it('reads the GST rate on a unit from the rule table by its carpet area and price, on the unit’s own record', () => {
    const p = project();
    const unit = add(p, 'shared.units', { number: 'A-101', carpet_area: '55 sqm', price_for_tax: '40 lakh', demanded_for_tax: '10 lakh', gst_charged: 10_000 });
    const affordable = sheet(p, 'shared.units', unit);
    assert.equal(affordable.value('gst_rate'), 1);
    assert.deepEqual(affordable.cites('gst_rate'), [['gst_affordable_carpet_max', 60, false], ['gst_affordable_price_max', 4_500_000, false], ['gst_flat_affordable', 1, false]]);
    assert.equal(affordable.value('gst_standing'), 'As expected');

    write(p, 'shared.units', { price_for_tax: '60 lakh' }, unit);
    const other = sheet(p, 'shared.units', unit);
    assert.equal(other.value('gst_rate'), 5);
    assert.equal(other.value('gst_expected'), 50_000);
    assert.equal(other.value('gst_standing'), 'Differs from expected');
    assert.equal(sheet(p, 'finance.tax.gst').value('charge_standing'), 'Charged and expected differ');
  });

  it('dates a month’s deposit of tax deducted from the rule table, with the usual kind of month assumed', () => {
    const p = project();
    const month = add(p, 'finance.tax.tds_months', { month: '2026-08-01', deducted: 1 * LAKH, deposited: 1 * LAKH, deposited_on: '2026-09-10' });
    const late = sheet(p, 'finance.tax.tds_months', month);
    assert.equal(late.view('month_kind').state, 'assumed');
    assert.equal(late.value('due_on'), '2026-09-07');
    assert.deepEqual(late.cites('due_on'), [['tds_deposit_due_day', 7, false]]);
    assert.equal(late.value('month_standing'), 'Late');
    assert.deepEqual(late.said(), ['The deposit is 3 days late.']);

    write(p, 'finance.tax.tds_months', { deposited_on: '2026-09-05' }, month);
    assert.equal(sheet(p, 'finance.tax.tds_months', month).value('month_standing'), 'In time');
    write(p, 'finance.tax.tds_months', { month_kind: 'year_end' }, month);
    assert.equal(sheet(p, 'finance.tax.tds_months', month).value('due_on'), '2026-09-30');
    assert.equal(sheet(p, 'finance.tax.tds').value('deposit_standing'), 'Deposited in time');
  });

  it('keeps the joint development sheets out of sight until the project is one, then holds each payment to the owner against what is to be deducted', () => {
    const p = project();
    assert.deepEqual([sheet(p, 'finance.tax.jda').shown().length, sheet(p, 'finance.tax.jda_tax').shown().length], [0, 0]);
    assert.equal(page(p, 'finance.tax').exceptions.some((e) => e.sheet.startsWith('Joint development')), false);

    setSituation(p, 'finance.tax', 'joint_development', true, 'tester');
    assert.deepEqual([sheet(p, 'finance.tax.jda').shown().length, sheet(p, 'finance.tax.jda_tax').shown().length], [12, 11]);
    assert.equal(sheet(p, 'finance.tax.jda_tax').value('position_standing'), null, 'nothing recorded is no standing yet');

    const outright = add(p, 'finance.tax.jda_payments', { paid_on: '2026-06-01', amount: '1 Cr', kind: 'non_refundable', tax_deducted: 5 * LAKH });
    const short = sheet(p, 'finance.tax.jda_payments', outright);
    assert.deepEqual([short.value('tax_rate'), short.value('tax_due')], [10, 10 * LAKH]);
    assert.equal(short.view('accountant_view').shown, 'hidden');
    assert.equal(short.value('payment_standing'), 'Deducted differs from what is due');
    assert.deepEqual(short.said(), ['₹5 lakh was deducted and ₹10 lakh is due.']);
    assert.ok(sheet(p, 'finance.tax.jda_tax').said().includes('There is no accountant’s opinion on the joint development on file.'));

    write(p, 'finance.tax.jda_payments', { tax_deducted: 10 * LAKH }, outright);
    assert.equal(sheet(p, 'finance.tax.jda_payments', outright).value('payment_standing'), 'In order');

    // A refundable deposit is the accountant's call: nothing is worked out until it is made.
    const deposit = add(p, 'finance.tax.jda_payments', { paid_on: '2026-06-01', amount: '2 Cr', kind: 'refundable_deposit' });
    const waiting = sheet(p, 'finance.tax.jda_payments', deposit);
    assert.equal(waiting.view('accountant_view').shown, 'shown');
    assert.equal(waiting.value('tax_due'), null);
    assert.equal(waiting.value('payment_standing'), 'Accountant’s view needed');
    write(p, 'finance.tax.jda_payments', { accountant_view: 'do_not_deduct' }, deposit);
    assert.equal(sheet(p, 'finance.tax.jda_payments', deposit).value('tax_due'), 0);
    assert.equal(sheet(p, 'finance.ledgers.collections').value('owner_deposit_paid'), 2 * CR, 'and Ledgers reads the deposit for the landowner’s account');
  });
});

/* ==================================================================== */
/* Lenders                                                               */
/* ==================================================================== */

describe('Lenders', () => {
  function funded(): DdProject {
    const p = project();
    write(p, 'cost_quantity.budget_current', { sanctioned_budget: '100 Cr', current_forecast: '104 Cr' });
    add(p, 'finance.funding.sources', { kind: 'promoter_equity', planned: '25 Cr', brought_in: '10 Cr' });
    add(p, 'finance.lenders.facilities', { name: 'Construction term loan', sanctioned_amount: '40 Cr', cost_appraised: '100 Cr', min_promoter_share: 30, benchmark_rate: 6.5, spread: 3.25 });
    return p;
  }

  it('shows no sheet of it until a facility is recorded', () => {
    const p = project();
    const before = page(p, 'finance.lenders');
    assert.equal(before.sheets.flatMap((s) => (s.reading ? s.reading.fields : [])).filter((v) => v.shown !== 'hidden').length, 0);
    assert.equal(before.counts.total, 0);

    const q = funded();
    assert.equal(situation(q, 'finance.lenders', 'lender_funded'), 'on');
    const facility = page(q, 'finance.lenders').sheets.find((s) => s.set.id === 'finance.lenders.facilities')!.records![0]!;
    assert.equal(facility.title, 'Construction term loan');
    assert.ok(facility.chips.includes('Rate now 9.75%'));
    assert.ok(sheet(q, 'finance.lenders.drawdown').shown().length > 0);
    // Beyond the facility's own terms, the sheets ask three things. Escrow routing and the statement wait for an escrow account and a drawdown.
    const asked = page(q, 'finance.lenders').exceptions.filter((e) => e.kind === 'missing' && !e.record).map((e) => e.label);
    assert.deepEqual(asked, ['Original title deeds held by', 'Completion date committed to the lender', 'Escrow account']);
    assert.equal(sheet(q, 'finance.lenders.escrow').view('collections').shown, 'hidden');
  });

  it('pairs drawdowns to milestones, and sets what is drawn against the cost each of them states', () => {
    const p = funded();
    const [plinth] = addMilestones(p, [{ name: 'Plinth', weight: 10 }, { name: 'Fifth slab', weight: 20 }], 'tester');
    add(p, 'finance.lenders.cost_incurred_stated', { source: 'stk_qs', figure: '30 Cr', stated_on: '2026-09-30' });
    add(p, 'finance.lenders.cost_incurred_stated', { source: 'stk_le', figure: '27 Cr', stated_on: '2026-10-05' });
    const first = add(p, 'finance.lenders.drawdowns', { tranche: 'Tranche 1', planned_on: '2026-06-01', planned_amount: '12 Cr', disbursed_on: '2026-06-10', disbursed_amount: '12 Cr' });
    add(p, 'finance.lenders.drawdowns', { tranche: 'Tranche 2', planned_on: '2026-12-01', planned_amount: '10 Cr' });
    write(p, 'finance.lenders.drawdown', { drawdown_to_milestone: [{ drawdown: first, milestone: plinth!.id }] });

    const drawn = sheet(p, 'finance.lenders.drawdown');
    // The lender's engineer's figure beside the quantity surveyor's: neither overwrites the other.
    assert.deepEqual([drawn.value('cost_incurred_low'), drawn.value('cost_incurred_high'), drawn.value('cost_incurred_spread')], [27 * CR, 30 * CR, 10]);
    assert.equal(drawn.value('cost_incurred_agreement'), 'Stated figures differ');
    assert.deepEqual([drawn.value('debt_share'), drawn.value('eligible'), drawn.value('headroom')], [40, 10.8 * CR, -1.2 * CR]);
    assert.equal(drawn.value('headroom_standing'), 'Drawn beyond what is eligible');

    const match = drawn.view('drawdown_to_milestone').match!;
    assert.deepEqual(match.pairs.map((pair) => [pair.leftLabel, pair.rightLabel]), [['Tranche 1', 'Plinth']]);
    assert.deepEqual([match.left.leftover.map((i) => i.label), match.right.leftover.map((i) => i.label)], [['Tranche 2'], ['Fifth slab']]);
    const read = page(p, 'finance.lenders');
    assert.equal(read.counts.unmatched, 2);
    assert.deepEqual(read.exceptions.filter((e) => e.kind === 'unmatched').map((e) => e.text), ['Drawdowns: Tranche 2', 'Milestones: Fifth slab']);
    // A drawdown paid out with no certificate behind it is said on its own record.
    assert.equal(sheet(p, 'finance.lenders.drawdowns', first).value('drawdown_standing'), 'Disbursed without the engineer’s certificate');

    write(p, 'finance.lenders.drawdowns', { disbursed_amount: '10 Cr' }, first);
    assert.equal(sheet(p, 'finance.lenders.drawdown').value('headroom_standing'), 'Within what is eligible');
    assert.equal(sheet(p, 'finance.lenders.position').value('outstanding'), 10 * CR);
    assert.equal(sheet(p, 'finance.lenders.tests').value('equity_standing'), 'In step');
  });

  it('tests a covenant against a figure another function works out, and counts the breach', () => {
    const p = funded();
    const covenant = add(p, 'finance.lenders.covenants', { covenant: 'promoter_contribution', test: 'at_least', threshold: 30 });
    const breached = sheet(p, 'finance.lenders.covenants', covenant);
    assert.deepEqual([breached.value('actual'), breached.value('short_by')], [25, 5], 'the promoter’s share, from the funding plan');
    assert.equal(breached.value('covenant_standing'), 'Breached');
    assert.equal(sheet(p, 'finance.lenders.compliance').value('covenant_standing'), 'Breached');
    assert.deepEqual(sheet(p, 'finance.lenders.compliance').said(), ['Covenants breached: 1.']);

    add(p, 'finance.funding.sources', { kind: 'promoter_loan', planned: '10 Cr' });
    assert.equal(sheet(p, 'finance.lenders.covenants', covenant).value('covenant_standing'), 'Met');
    assert.equal(sheet(p, 'finance.lenders.compliance').value('covenant_standing'), 'All met');

    // One the product cannot work out takes the figure off the compliance certificate.
    const cover = add(p, 'finance.lenders.covenants', { covenant: 'debt_service_cover', test: 'at_least', threshold: 1.25, stated: 1.1 });
    assert.equal(sheet(p, 'finance.lenders.covenants', cover).value('covenant_standing'), 'Breached');
  });

  it('holds a deferred completion date and a cost overrun to the regulator’s limits, and the committed date to the programme’s forecast', () => {
    const p = funded();
    write(p, 'finance.lenders.limits', { completion_committed: '2027-03-31', completion_revised: '2029-06-30' });
    const deferred = sheet(p, 'finance.lenders.limits');
    assert.deepEqual([deferred.value('deferment'), deferred.value('deferment_allowed')], [27, 24]);
    assert.deepEqual(deferred.cites('deferment_allowed'), [['rbi_dcco_deferment_max_years', 2, false]]);
    assert.equal(deferred.value('completion_standing'), 'Deferred beyond the limit');
    assert.equal(deferred.value('overrun'), 4, 'the budget’s forecast against its sanction');
    assert.equal(deferred.value('overrun_standing'), 'Within the limit');
    assert.ok(deferred.said().includes('The cost forecast is over the sanctioned budget and the lender has not been told.'));

    write(p, 'finance.lenders.limits', { completion_revised: '2028-12-31', lender_told_on: '2026-11-01' });
    write(p, 'schedule_progress.forecast_completion', { forecast_completion: '2027-06-30' });
    const late = sheet(p, 'finance.lenders.limits');
    assert.equal(late.value('completion_standing'), 'Forecast after the committed date');
    assert.deepEqual(late.said(), ['Completion is forecast for 2027-06-30, after the 2027-03-31 committed to the lender.']);

    write(p, 'cost_quantity.budget_current', { current_forecast: '112 Cr' });
    const over = sheet(p, 'finance.lenders.limits');
    assert.equal(over.value('overrun_standing'), 'Beyond what a lender may finance');
    assert.deepEqual(over.cites('overrun_allowed'), [['rbi_cost_overrun_max', 10, false]]);
  });
});

/* ==================================================================== */
/* Ledgers                                                               */
/* ==================================================================== */

describe('Ledgers', () => {
  it('asks the reason for a difference with the books only where there is one, and keeps a line open until the reason closes it', () => {
    const p = project();
    const agreed = add(p, 'finance.ledgers.reconciliation_lines', { item: 'bank_balances', as_at: '2026-10-31', per_books: '4.2 Cr', per_project: '4.2 Cr' });
    const same = sheet(p, 'finance.ledgers.reconciliation_lines', agreed);
    assert.equal(same.view('reason').shown, 'hidden');
    assert.equal(same.view('reason').missing, false);
    assert.equal(same.value('line_standing'), 'Agrees');

    const line = add(p, 'finance.ledgers.reconciliation_lines', { item: 'creditors', as_at: '2026-10-31', per_books: '50 lakh', per_project: '48 lakh' });
    const open = sheet(p, 'finance.ledgers.reconciliation_lines', line);
    assert.equal(open.view('reason').missing, true);
    assert.deepEqual([open.value('difference'), open.value('open_amount'), open.value('line_standing')], [2 * LAKH, 2 * LAKH, 'Open']);
    assert.equal(sheet(p, 'finance.ledgers.reconciliation').value('lines_open'), 1);
    assert.equal(sheet(p, 'finance.ledgers.reconciliation').value('reconciliation_standing'), 'Differences open');

    write(p, 'finance.ledgers.reconciliation_lines', { reason: 'timing' }, line);
    assert.deepEqual([sheet(p, 'finance.ledgers.reconciliation_lines', line).value('open_amount'), sheet(p, 'finance.ledgers.reconciliation_lines', line).value('line_standing')], [0, 'Explained']);
    assert.equal(sheet(p, 'finance.ledgers.reconciliation').value('reconciliation_standing'), 'No difference open');

    // "Error" names the difference and closes nothing.
    write(p, 'finance.ledgers.reconciliation_lines', { reason: 'error' }, line);
    assert.equal(sheet(p, 'finance.ledgers.reconciliation_lines', line).value('line_standing'), 'Open');
    write(p, 'finance.ledgers.reconciliation', { package: 'tally', imported_on: '2026-11-10', signed_off_on: '2026-11-12' });
    assert.deepEqual(sheet(p, 'finance.ledgers.reconciliation').said(), ['Differences with the books still open: 1.', 'Signed off on 12 Nov 2026, and nobody is named.']);
  });

  it('sets what is certified and unpaid on a contract against the books, and an advance against its guarantee', () => {
    const p = project();
    const contract = add(p, 'shared.contracts', { title: 'Civil works', counterparty: 'stk_builder' });
    const account = add(p, 'finance.ledgers.contract_accounts', { contract, as_at: '2026-10-31', certified_net: '6 Cr', paid: '5 Cr', payable_per_books: '1.2 Cr', advance_paid: '1 Cr', advance_recovered: '40 lakh', advance_guarantee: '50 lakh' });
    const differs = sheet(p, 'finance.ledgers.contract_accounts', account);
    assert.equal(differs.reading.title, 'Civil works');
    assert.deepEqual([differs.value('payable'), differs.value('books_less_certificates'), differs.value('advance_balance')], [1 * CR, 20 * LAKH, 60 * LAKH]);
    assert.equal(differs.value('account_standing'), 'Advance not covered by the guarantee');
    assert.deepEqual(differs.said(), ['The advance outstanding is ₹60 lakh and the guarantee covers ₹50 lakh.', 'The books show ₹1.2 Cr payable and the certificates less payments ₹1 Cr.']);

    write(p, 'finance.ledgers.contract_accounts', { payable_per_books: '1 Cr', advance_guarantee: '1 Cr' }, account);
    assert.equal(sheet(p, 'finance.ledgers.contract_accounts', account).value('account_standing'), 'Agrees with the books');
    assert.equal(sheet(p, 'finance.ledgers.payables').value('payable'), 1 * CR);

    // A supplier recorded as a small enterprise brings the days it may wait into play, from the rule table.
    assert.equal(sheet(p, 'finance.ledgers.payables').view('small_enterprise_oldest').shown, 'hidden');
    add(p, 'shared.parties', { name: 'Hillside Fabricators', small_enterprise: true });
    write(p, 'finance.ledgers.payables', { small_enterprise_unpaid: '8 lakh', small_enterprise_oldest: 52 });
    const small = sheet(p, 'finance.ledgers.payables');
    assert.deepEqual(small.cites('small_enterprise_allowed'), [['small_enterprise_payment_days', 45, false]]);
    assert.ok(small.said().includes('A micro or small enterprise has waited 52 days to be paid; 45 days are allowed.'));
  });
});
