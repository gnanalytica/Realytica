/**
 * Sales and Marketing's field sets, read the way a person reads them.
 *
 * Each test builds a project with invented units, buyers and papers and
 * asserts what shows: how few fields an untouched record asks for, what a
 * situation turns on, a figure worked out from its inputs, a standing read
 * from papers on file, a rule failing and then passing, and the rule row a
 * figure came from, said to be unverified.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIELD_SETS,
  RULE_ROWS,
  addEvidence,
  addFieldRecord,
  catalogFaults,
  catalogLimits,
  createAssessment,
  createProject,
  fieldCatalog,
  readFunctionFields,
  readSheet,
  recordCheckFields,
  resolveFields,
  ruleRow,
  ruleRowFaults,
  setFieldValues,
  setSituation,
  workstreamDefinition,
  type DdProject,
} from '@realytica/shared';
import { CUSTOMER_SETS, SALES_MARKETING_FIELD_SETS, UNIT_STATUS } from '../packages/shared/src/operating-model/field-sets/sales-marketing';
import { SALES_MARKETING_RULE_ROWS } from '../packages/shared/src/operating-model/field-sets/rules/sales-marketing';

const LEAD = 'lead@example.com';
const TODAY = new Date('2026-10-12T00:00:00Z');
const UNITS = 'shared.units';

function project(): DdProject {
  const p = createProject({ name: 'Lakeside Residences', type: 'residential', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-SLS', LEAD);
  p.jurisdiction = 'Karnataka';
  createAssessment(p, { ddType: 'acquisition', name: 'Diligence', owner: LEAD, targetType: 'project' });
  return p;
}

/** One sheet, or one record of a set that repeats, as the page draws it on the day of the test. */
function sheet(p: DdProject, set: string, record?: string) {
  const reading = readSheet(p, set, record, resolveFields(p, TODAY), fieldCatalog(), TODAY)!;
  const view = (key: string) => reading.fields.find((f) => f.def.key === key)!;
  return {
    reading,
    view,
    value: (key: string) => view(key).held?.value ?? null,
    shown: (key: string) => view(key).shown,
    // What shows as Commercial draws it: the record's own fields and the ones its functions add. What Tax, the Architect and the site add to a unit is on their pages.
    showing: () => reading.fields.filter((f) => f.shown === 'shown' && (!f.def.addedBy || f.def.addedBy.startsWith('commercial.'))).map((f) => f.def.key),
    said: () => reading.insights.map((i) => i.text),
  };
}

const page = (p: DdProject, fn: string) => readFunctionFields(p, fn, TODAY);
const write = (p: DdProject, set: string, values: Record<string, unknown>, record?: string) => assert.deepEqual(setFieldValues(p, { set, ...(record ? { record } : {}) }, values, LEAD).rejected, []);
const add = (p: DdProject, set: string, values: Record<string, unknown>): string => {
  const out = addFieldRecord(p, set, values, LEAD);
  assert.deepEqual(out.rejected, []);
  return out.record!.id;
};
const paper = (p: DdProject, title: string): string => addEvidence(p, { title, kind: 'document' }, LEAD).id;

/** A price list, and four units of one tower: one in stock, two sold, one not released. */
function withUnits(p: DdProject) {
  write(p, 'commercial.market.price_list', { version: 'PL-3', effective_from: '2026-05-01', base_rate: 80_000, floor_rise: 500, floor_rise_from: 2, discount_limit_pct: 3 });
  const inStock = add(p, UNITS, { number: 'A-101', tower: 'A', floor: 1, type: '2 BHK', carpet_area: '70 sqm', sale_released: true });
  const booked = add(p, UNITS, { number: 'A-501', tower: 'A', floor: 5, type: '3 BHK', carpet_area: '100 sqm', sale_released: true });
  write(p, UNITS, { sale_booked_on: '2026-05-28', sale_agreed_value: 8_000_000, sale_allotment_letter: [paper(p, 'Allotment letter A-501')], sale_allotted_on: '2026-06-01', sale_received_before_agreement: 1_200_000 }, booked);
  const agreed = add(p, UNITS, { number: 'A-502', tower: 'A', floor: 5, type: '2 BHK', carpet_area: '70 sqm', sale_released: true });
  write(
    p,
    UNITS,
    { sale_agreed_value: 5_500_000, sale_allotment_letter: [paper(p, 'Allotment letter A-502')], sale_allotted_on: '2026-06-10', sale_received_before_agreement: 500_000, sale_agreement: [paper(p, 'Agreement for sale A-502')], sale_agreement_registered_on: '2026-07-15' },
    agreed,
  );
  const unreleased = add(p, UNITS, { number: 'A-601', tower: 'A', floor: 6, type: '3 BHK', carpet_area: '100 sqm' });
  return { inStock, booked, agreed, unreleased };
}

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

describe('Sales and Marketing’s catalog', () => {
  it('has no fault and breaks no limit, set by set', () => {
    assert.deepEqual(catalogFaults(), []);
    assert.deepEqual(ruleRowFaults(RULE_ROWS), []);
    const mine = new Set(SALES_MARKETING_FIELD_SETS.map((set) => set.id));
    assert.deepEqual(catalogLimits().filter((breach) => mine.has(breach.set)), []);
    for (const set of SALES_MARKETING_FIELD_SETS) assert.ok(FIELD_SETS.includes(set), `${set.id} is registered`);
  });

  it('sits in five functions of Commercial, each a function the menu has', () => {
    const functions = [...new Set(SALES_MARKETING_FIELD_SETS.map((set) => set.fn))].sort();
    assert.deepEqual(functions, ['commercial.buyers', 'commercial.handover', 'commercial.inventory', 'commercial.market', 'commercial.marketing']);
    for (const fn of functions) assert.equal(workstreamDefinition(fn)?.department, 'commercial');
  });

  it('keeps every sheet short: twelve fields always shown at most, twenty on a record', () => {
    for (const set of SALES_MARKETING_FIELD_SETS) {
      const section = (key: string | undefined) => (set.sections ?? []).find((s) => s.key === key);
      const always = set.fields.filter((def) => !def.showWhen && def.tier !== 'expert' && !section(def.section)?.showWhen && section(def.section)?.tier !== 'expert');
      if (!set.records && !set.extends) assert.ok(always.length <= 12, `${set.id} always shows ${always.length}`);
      assert.ok(set.fields.length <= 20, `${set.id} declares ${set.fields.length}`);
    }
  });

  it('types no figure the law sets: every one is a row of the rule table, with its clause, and none verified', () => {
    for (const row of SALES_MARKETING_RULE_ROWS) {
      assert.equal(row.verified, false, row.key);
      assert.ok(row.source.clause && row.source.url, `${row.key} names its clause and its official page`);
    }
    // The deduction when an allottee cancels before the agreement, by days since the allotment letter.
    const place = { state: 'Karnataka', city: 'Bengaluru' };
    const slab = (days: number) => ruleRow(RULE_ROWS, 'rera_cancel_deduction', place, '2026-10-12', { days_from_allotment: days })?.value;
    assert.deepEqual([0, 15, 16, 30, 31, 60, 61, 200].map(slab), [0, 0, 1, 1, 1.5, 1.5, 2, 2]);
    assert.equal(ruleRow(RULE_ROWS, 'rera_refund_within_days', place, '2026-10-12', { stage: 'before_agreement' })?.value, 45);
    assert.equal(ruleRow(RULE_ROWS, 'rera_refund_within_days', place, '2026-10-12', { stage: 'after_agreement' })?.value, 60);
    // No option anywhere is a way of not answering.
    for (const set of SALES_MARKETING_FIELD_SETS) {
      const lists = [...set.fields.flatMap((def) => [def, ...(def.columns ?? [])]).flatMap((def) => def.options ?? []), ...(set.optionSets ?? []).flatMap((list) => list.options.map((o) => o.label))];
      for (const option of lists) assert.doesNotMatch(option, /^(n\/?a|not applicable|unknown|other|none)$/i, `${set.id}: "${option}"`);
    }
  });

  it('says nothing is wrong, and keeps nothing back, on a project that holds nothing', () => {
    const p = project();
    for (const fn of ['commercial.market', 'commercial.marketing', 'commercial.inventory', 'commercial.buyers', 'commercial.handover']) {
      const read = page(p, fn);
      assert.deepEqual(read.exceptions.filter((e) => e.kind !== 'missing').map((e) => e.text), [], fn);
      assert.deepEqual(read.situations.filter((s) => s.state !== 'off' || s.keptValues > 0).map((s) => s.situation.key), [], fn);
      // No standing claims to be in order before anything is recorded.
      for (const sheet of read.sheets) for (const view of sheet.reading?.fields ?? []) if (view.def.kind === 'status') assert.equal(view.held?.value ?? null, null, `${fn}: ${view.def.key}`);
      const shown = read.sheets.flatMap((sheet) => sheet.reading?.fields ?? []).filter((view) => view.shown === 'shown');
      assert.ok(shown.length <= 34, `${fn} opens on ${shown.length} fields across its sheets`);
    }
  });

  it('holds no prose a model could write: one bounded note in all, and nothing a paper offers is a sentence', () => {
    const notes = SALES_MARKETING_FIELD_SETS.flatMap((set) => set.fields.filter((def) => def.kind === 'longtext').map((def) => `${set.id}/${def.key}:${def.maxLength}`));
    assert.deepEqual(notes, ['commercial.handover.requests/note:300']);
    for (const set of SALES_MARKETING_FIELD_SETS) for (const def of set.fields) if (def.fromTypes) assert.notEqual(def.kind, 'longtext', `${set.id}/${def.key}`);
  });
});

/* ==================================================================== */
/* Sales: the unit, its sale, and the stock                              */
/* ==================================================================== */

describe('a unit and its sale', () => {
  it('asks little of a unit nobody has released, and opens the sale step by step', () => {
    const p = project();
    const id = add(p, UNITS, { number: 'B-204', tower: 'B', floor: 2, carpet_area: '82 sqm' });
    const fresh = sheet(p, UNITS, id);
    assert.deepEqual(fresh.showing(), ['number', 'tower', 'floor', 'type', 'carpet_area', 'sale_released', 'sale_status', 'sale_list_price']);
    assert.equal(fresh.reading.fields.length > 40, true, 'the record declares the whole sale, the agreement and the possession');
    assert.equal(fresh.reading.fields.filter((f) => f.missing).length, 0, 'nothing of a sale that has not begun is counted missing');
    assert.equal(fresh.shown('sale_agreed_value'), 'hidden');
    assert.equal(fresh.shown('sale_agreement'), 'hidden');
    assert.equal(fresh.shown('sale_hold_until'), 'folded');

    write(p, UNITS, { sale_released: true }, id);
    const released = sheet(p, UNITS, id);
    assert.equal(released.shown('sale_agreed_value'), 'shown');
    assert.equal(released.shown('sale_allotment_letter'), 'shown');
    assert.equal(released.shown('sale_agreement'), 'hidden', 'the agreement waits for an allotment letter’s date');

    write(p, UNITS, { sale_allotted_on: '2026-09-20' }, id);
    const allotted = sheet(p, UNITS, id);
    assert.equal(allotted.shown('sale_agreement'), 'shown');
    assert.equal(allotted.value('sale_agreement_due'), '2026-11-20', 'two months on, read from the rule table');
    assert.equal(allotted.shown('handover_offered_on'), 'hidden', 'possession waits for the occupancy certificate');
  });

  it('reads the status from the papers on file, never from a choice', () => {
    const p = project();
    const id = add(p, UNITS, { number: 'B-204', carpet_area: '82 sqm' });
    const status = () => sheet(p, UNITS, id).value('sale_status');
    assert.equal(sheet(p, UNITS, id).view('sale_status').def.kind, 'status');
    assert.ok(setFieldValues(p, { set: UNITS, record: id }, { sale_status: UNIT_STATUS.booked }, LEAD).rejected.length > 0, 'a status cannot be written');

    assert.equal(status(), null, 'nothing recorded: no standing yet');
    write(p, UNITS, { sale_released: false }, id);
    assert.equal(status(), UNIT_STATUS.notReleased);
    write(p, UNITS, { sale_released: true }, id);
    assert.equal(status(), UNIT_STATUS.available);
    write(p, UNITS, { sale_hold_until: '2026-10-15' }, id);
    assert.equal(status(), UNIT_STATUS.held);
    write(p, UNITS, { sale_allotment_letter: [paper(p, 'Allotment letter')] }, id);
    assert.equal(status(), UNIT_STATUS.booked);
    // The agreement's fields come into play once the day of allotment is recorded. Before that the paper is kept and reads as nothing.
    write(p, UNITS, { sale_agreement: [paper(p, 'Agreement for sale')] }, id);
    assert.equal(status(), UNIT_STATUS.booked, 'a field that is not in play feeds no standing');
    write(p, UNITS, { sale_allotted_on: '2026-10-01' }, id);
    assert.equal(status(), UNIT_STATUS.agreement);
    write(p, UNITS, { sale_deed: [paper(p, 'Sale deed')] }, id);
    assert.equal(status(), UNIT_STATUS.saleDeed);
    assert.equal(sheet(p, UNITS, id).view('sale_status').tone, 'info');
    // Possession is asked about once the occupancy certificate is issued. A certificate filed before that is kept, and is no handover.
    write(p, UNITS, { sale_possession_certificate: [paper(p, 'Possession certificate')] }, id);
    assert.equal(status(), UNIT_STATUS.saleDeed);
    const occupancy = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'regulatory.occupancy')!;
    recordCheckFields(p, occupancy.id, { oc_issued: true, oc_date: '2026-09-01' }, LEAD);
    assert.equal(status(), UNIT_STATUS.handedOver);

    const other = add(p, UNITS, { number: 'B-205', sale_released: true, sale_allotment_letter: [paper(p, 'Allotment letter B-205')], sale_allotted_on: '2026-10-02', sale_cancellation: [paper(p, 'Cancellation letter B-205')] });
    assert.equal(sheet(p, UNITS, other).value('sale_status'), UNIT_STATUS.cancelled);
    assert.equal(sheet(p, UNITS, other).view('sale_status').tone, 'critical');
  });

  it('works out the list price, the discount and the advance, and says which row of the Act the cap came from', () => {
    const p = project();
    const { inStock, booked, agreed, unreleased } = withUnits(p);
    assert.equal(sheet(p, UNITS, inStock).value('sale_list_price'), 5_600_000, '70 sqm at the base rate: floor 1 is below the floor rise');
    assert.equal(sheet(p, UNITS, unreleased).value('sale_list_price'), 8_200_000, '100 sqm at the base rate and four floors of rise');

    const sale = sheet(p, UNITS, booked);
    assert.equal(sale.value('sale_list_price'), 8_150_000);
    assert.equal(sale.view('sale_list_price').text, '₹81.5 lakh');
    assert.equal(sale.value('sale_discount_pct'), 1.8);
    assert.equal(sale.value('sale_advance_pct'), 15);
    assert.equal(sale.value('sale_advance_over_cap'), 5);
    assert.deepEqual(
      sale.view('sale_advance_over_cap').cites?.map((c) => [c.key, c.value, c.source.clause, c.verified]),
      [['rera_advance_before_agreement_max', 10, 'section 13(1)', false]],
      'the figure carries its row, shown as not verified',
    );
    assert.ok(sale.said().includes('Received before the registered agreement is 5 % points above the cap the Act sets on an advance.'));
    assert.equal(sale.value('sale_agreement_due'), '2026-08-01');
    assert.equal(sale.value('sale_agreement_days_left'), -72);
    assert.equal(sale.value('sale_agreement_standing'), 'Agreement overdue');

    // The rule passes once the advance is inside the cap.
    write(p, UNITS, { sale_received_before_agreement: 800_000 }, booked);
    assert.equal(sheet(p, UNITS, booked).value('sale_advance_over_cap'), 0);
    assert.ok(!sheet(p, UNITS, booked).said().some((text) => /above the cap/.test(text)));

    // A registered agreement ends the count of days, and the discount rule reads the price list.
    const done = sheet(p, UNITS, agreed);
    assert.equal(done.value('sale_agreement_days_left'), null);
    assert.equal(done.value('sale_agreement_standing'), null);
    assert.equal(done.value('sale_discount_pct'), 3.6);
    assert.ok(done.said().includes('The discount is 3.6%; the price list allows 3% without further approval.'), done.said().join('\n'));
    write(p, UNITS, { sale_carpet_in_agreement: '72 sqm' }, agreed);
    assert.ok(sheet(p, UNITS, agreed).said().some((text) => /^The agreement states 72 sqm of carpet area and the unit register 70 sqm/.test(text)));
  });

  it('counts the stock from the units, and raises what a unit breaks on the function’s own sheet', () => {
    const p = project();
    withUnits(p);
    const stock = sheet(p, 'commercial.inventory.stock');
    assert.deepEqual(
      ['units_total', 'units_sold', 'sold_pct', 'unsold_value', 'lowest_list_price'].map(stock.value),
      [4, 2, 50, 5_600_000, 5_600_000],
    );
    assert.equal(stock.value('stock_standing'), null, 'nothing is typed on the absorption check, so nothing is compared');

    const bookings = sheet(p, 'commercial.inventory.bookings');
    assert.equal(bookings.value('value_booked'), 13_500_000);
    assert.equal(bookings.view('carpet_booked').text, '170 sqm');
    assert.equal(bookings.value('realised_rate'), 79_411.76);
    assert.deepEqual(['agreements_registered', 'agreements_overdue', 'advances_over_cap'].map(bookings.value), [1, 1, 1]);
    assert.equal(bookings.value('bookings_standing'), 'An advance is above the cap');

    const sales = page(p, 'commercial.inventory');
    assert.ok(sales.exceptions.some((e) => e.kind === 'rule' && e.text === '1 unit holds an advance above the cap the Act sets before a registered agreement.'));
    assert.deepEqual(sales.shared.map((s) => s.set.id).sort(), ['shared.parties', 'shared.units'], 'the units are listed on the Sales page, as the project’s');
    assert.deepEqual(sales.exceptions.filter((e) => e.kind === 'missing').map((e) => `${e.sheet}: ${e.label}`), ['Enquiries and site visits: Leads are kept in', 'Enquiries and site visits: Counts last read on', 'Enquiries and site visits: Enquiries and visits by week'], 'the sheets worked out from the units ask for nothing');

    // The absorption check's typed figure is compared with the register.
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'commercial_market.absorption');
    assert.ok(check, 'the assessment holds the absorption check');
    recordCheckFields(p, check.id, { units_total: 4, units_sold: 3 }, LEAD, paper(p, 'Sales MIS, September'));
    assert.equal(sheet(p, 'commercial.inventory.stock').value('stock_standing'), 'Differs from the absorption check');
    assert.ok(sheet(p, 'commercial.inventory.stock').said().includes('The unit register shows 2 sold and the absorption check records 3.'));
  });

  it('brings a joint development’s and a lender’s fields into play only when the project is one', () => {
    const p = project();
    const id = add(p, UNITS, { number: 'C-301', sale_released: true, sale_allotment_letter: [paper(p, 'Allotment letter C-301')], sale_allotted_on: '2026-09-01' });
    const before = sheet(p, UNITS, id);
    assert.equal(before.shown('sale_allotted_to'), 'hidden');
    assert.equal(before.shown('sale_lender_consent'), 'hidden');
    assert.equal(before.view('sale_lender_consent').missing, false);
    assert.ok(!before.said().some((text) => /lender/.test(text)));
    assert.deepEqual(page(p, 'commercial.inventory').situations.map((s) => [s.situation.key, s.state]), [['litigation_pending', 'off'], ['leads_contacted_by_phone_or_message', 'off'], ['channel_partners_engaged', 'off'], ['joint_development', 'off'], ['lender_funded', 'off']]);

    setSituation(p, 'commercial.inventory', 'joint_development', true, LEAD);
    // A lender is not said: a facility on Lenders' register is one.
    add(p, 'finance.lenders.facilities', { name: 'Construction loan' });
    const after = sheet(p, UNITS, id);
    assert.equal(after.shown('sale_allotted_to'), 'shown');
    assert.equal(after.shown('sale_lender_consent'), 'shown');
    assert.ok(after.said().includes('An allotment letter is on file for this unit and the lender’s consent to sell it is not.'));
    write(p, UNITS, { sale_lender_consent: [paper(p, 'Lender’s consent C-301')] }, id);
    assert.ok(!sheet(p, UNITS, id).said().some((text) => /lender/.test(text)));

    // Channel partners: nobody is asked. The first partner on the register turns the brokerage fields on.
    assert.equal(sheet(p, UNITS, id).shown('sale_partner'), 'hidden');
    assert.deepEqual(sheet(p, 'commercial.inventory.brokerage').showing(), []);
    p.stakeholders.push({ id: 'stk_cp', name: 'Northgate Realty', role: 'Channel partner' });
    const partner = add(p, 'commercial.inventory.partners', { party: 'stk_cp', registration_no: 'AG/KA/0000/2026', valid_to: '2026-11-15', registration_found: 'registered', empanelled_from: '2026-08-01' });
    assert.equal(sheet(p, UNITS, id).shown('sale_partner'), 'shown');
    write(p, UNITS, { sale_agreed_value: 6_000_000, sale_partner: partner, sale_brokerage_pct: 2 }, id);
    assert.equal(sheet(p, UNITS, id).value('sale_brokerage_expected'), 120_000);
    add(p, 'commercial.inventory.brokerage_invoices', { invoice_no: 'NR/26/014', partner, unit: id, amount: 150_000, invoiced_on: '2026-09-20' });
    const brokerage = sheet(p, 'commercial.inventory.brokerage');
    assert.deepEqual(['partners', 'expected', 'invoiced', 'paid', 'unpaid'].map(brokerage.value), [1, 120_000, 150_000, 0, 150_000]);
    assert.equal(brokerage.value('brokerage_standing'), 'Invoiced above what the sales give');
    assert.ok(page(p, 'commercial.inventory').exceptions.some((e) => e.text === 'Runs out on 15 Nov 2026'), 'an agent registration about to run out is said');
  });

  it('holds a buyer as ticks for papers, and asks for the rest only where it applies', () => {
    const p = project();
    p.stakeholders.push({ id: 'stk_buyer', name: 'A. Buyer', role: 'Customer' });
    const unit = add(p, UNITS, { number: 'C-302' });
    const id = add(p, 'commercial.inventory.buyers', { party: 'stk_buyer', unit, resident: 'in India', papers_on_file: ['PAN', 'proof of identity'] });
    const buyer = sheet(p, 'commercial.inventory.buyers', id);
    assert.equal(buyer.reading.title, 'A. Buyer');
    assert.deepEqual(buyer.showing(), ['party', 'unit', 'resident', 'papers_on_file', 'shown_before_booking', 'home_loan']);
    assert.equal(buyer.view('remittance_account').missing, false, 'a field that is not showing is not counted missing');
    assert.equal(buyer.reading.total, 5);

    write(p, 'commercial.inventory.buyers', { resident: 'abroad', home_loan: true }, id);
    const abroad = sheet(p, 'commercial.inventory.buyers', id);
    assert.equal(abroad.shown('remittance_account'), 'shown');
    assert.equal(abroad.view('remittance_account').missing, true);
    assert.equal(abroad.shown('lender'), 'shown');
    assert.deepEqual(abroad.said(), ['A home loan is recorded and the lender is not named.']);
    assert.ok(CUSTOMER_SETS.includes('commercial.inventory.buyers'));
    // Nothing on a buyer is an identity number.
    const defs = fieldCatalog().sets.get('commercial.inventory.buyers')!.fields;
    assert.ok(!defs.some((def) => /pan|aadhaar|passport|phone|email|address/i.test(def.key)));
  });
});

/* ==================================================================== */
/* Collections: demands, dues, cancellations                             */
/* ==================================================================== */

describe('demands and collections', () => {
  function withDemands(p: DdProject) {
    const unit = add(p, UNITS, { number: 'A-501' });
    p.milestones = [
      { id: 'ms_plinth', name: 'Plinth', weight: 10, percent: 100, completedOn: '2026-06-20', updatedAt: '2026-06-20T00:00:00.000Z', updatedBy: LEAD },
      { id: 'ms_slab', name: 'First slab', weight: 10, percent: 40, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: LEAD },
    ];
    write(p, 'commercial.buyers.collections', { lending_rate: 8.8 });
    const old = add(p, 'commercial.buyers.demands', { demand_no: 'DN-01', unit, raised_on: '2026-06-16', due_on: '2026-07-01', principal: 1_000_000, certified_on: '2026-06-20', settled_by: [{ receipt_no: 'R-11', received_on: '2026-07-05', amount: 400_000, mode: 'bank_transfer' }] });
    add(p, 'commercial.buyers.demands', { demand_no: 'DN-02', unit, raised_on: '2026-09-16', due_on: '2026-10-01', principal: 500_000 });
    add(p, 'commercial.buyers.demands', { demand_no: 'DN-03', unit, raised_on: '2026-10-10', due_on: '2026-11-01', principal: 800_000 });
    add(p, 'commercial.buyers.demands', { demand_no: 'DN-04', unit, raised_on: '2026-08-01', due_on: '2026-08-16', principal: 300_000, settled_by: [{ receipt_no: 'R-14', received_on: '2026-08-10', amount: 300_000, mode: 'cheque' }] });
    return { unit, old };
  }

  it('works out what is outstanding, how old it is and the interest, from the receipts set against each demand', () => {
    const p = project();
    const { old } = withDemands(p);
    const demand = sheet(p, 'commercial.buyers.demands', old);
    assert.deepEqual(['received', 'outstanding', 'days_past_due', 'demand_standing'].map(demand.value), [400_000, 600_000, 103, 'Overdue']);
    assert.equal(demand.value('interest_accrued'), 18_286.03, '6,00,000 at 10.8% for 103 days');
    assert.deepEqual(demand.said(), ['Raised on 16 Jun 2026, before the stage was certified on 20 Jun 2026.', 'No stage completion certificate is cited for this demand.']);
    assert.deepEqual(demand.reading.chips, ['Unit A-501', 'Outstanding ₹6 lakh', 'Demand Overdue']);

    const collections = sheet(p, 'commercial.buyers.collections');
    assert.deepEqual(['demanded', 'received', 'outstanding', 'efficiency_pct', 'interest_rate'].map(collections.value), [2_600_000, 700_000, 1_900_000, 26.9, 10.8]);
    assert.deepEqual(collections.view('interest_rate').cites?.map((c) => [c.key, c.value, c.verified]), [['rera_delay_interest_spread', 2, false]]);

    const dues = sheet(p, 'commercial.buyers.dues');
    assert.deepEqual(
      ['overdue', 'overdue_first_month', 'overdue_second_month', 'overdue_third_month', 'overdue_beyond', 'due_within_month'].map(dues.value),
      [1_100_000, 500_000, 0, 0, 600_000, 800_000],
    );
    assert.equal(dues.value('dues_standing'), 'Dues older than three months');
  });

  it('leaves a demand with no milestone, and a milestone with no demand, as things to match', () => {
    const p = project();
    const { old } = withDemands(p);
    write(p, 'commercial.buyers.collections', { demands_to_milestones: [{ demand: old, milestone: 'ms_plinth' }] });
    const match = sheet(p, 'commercial.buyers.collections').view('demands_to_milestones').match!;
    assert.deepEqual(match.pairs.map((pair) => [pair.leftLabel, pair.rightLabel]), [['DN-01', 'Plinth']]);
    assert.deepEqual(match.left.leftover.map((item) => item.label), ['DN-02', 'DN-03', 'DN-04']);
    assert.deepEqual(match.right.leftover.map((item) => item.label), ['First slab']);
    const buyers = page(p, 'commercial.buyers');
    assert.equal(buyers.counts.unmatched, 4);
    assert.ok(buyers.exceptions.some((e) => e.kind === 'unmatched' && e.text === 'Milestones: First slab'));
  });

  it('opens reminders and notices only once a demand is overdue, and nobody sets that', () => {
    const p = project();
    const unit = add(p, UNITS, { number: 'A-101' });
    const id = add(p, 'commercial.buyers.demands', { demand_no: 'DN-09', unit, raised_on: '2026-10-05', due_on: '2026-10-25', principal: 200_000 });
    assert.equal(sheet(p, 'commercial.buyers.collections').shown('notices'), 'hidden');
    assert.deepEqual(page(p, 'commercial.buyers').situations.map((s) => [s.situation.key, s.state]), [['buyer_in_default', 'off']]);
    write(p, 'commercial.buyers.demands', { due_on: '2026-10-08' }, id);
    assert.equal(sheet(p, 'commercial.buyers.collections').shown('notices'), 'shown');
    assert.deepEqual(page(p, 'commercial.buyers').situations.map((s) => [s.situation.key, s.state]), [['buyer_in_default', 'on']]);
  });

  it('holds a payment plan to a hundred, and to the cap on what is asked before the agreement', () => {
    const p = project();
    const id = add(p, 'commercial.buyers.plans', {
      name: 'Construction-linked',
      kind: 'construction_linked',
      valid_from: '2026-05-01',
      stages: [
        { stage_no: 1, pct: 10, before_agreement: true },
        { stage_no: 2, pct: 10, before_agreement: true },
        { stage_no: 3, pct: 70, before_agreement: false },
      ],
    });
    const plan = sheet(p, 'commercial.buyers.plans', id);
    assert.deepEqual(['stages_total_pct', 'before_agreement_pct', 'advance_cap_pct', 'plan_standing'].map(plan.value), [90, 20, 10, 'Does not add up']);
    assert.deepEqual(plan.said(), ['The stages add to 90%, not 100.', 'The plan asks 20% before the registered agreement; the cap is 10%.']);
    assert.equal(plan.shown('interest_borne_until'), 'hidden');
    write(p, 'commercial.buyers.plans', { stages: [{ stage_no: 1, pct: 10, before_agreement: true }, { stage_no: 2, pct: 90, before_agreement: false }] }, id);
    const fixed = sheet(p, 'commercial.buyers.plans', id);
    assert.equal(fixed.value('plan_standing'), 'In order');
    assert.deepEqual(fixed.said(), []);
    write(p, 'commercial.buyers.plans', { kind: 'subvention' }, id);
    assert.equal(sheet(p, 'commercial.buyers.plans', id).shown('interest_borne_until'), 'shown');
  });
});

describe('a cancellation', () => {
  const cancel = (p: DdProject, values: Record<string, unknown>) => add(p, 'commercial.buyers.cancellations', { unit: add(p, UNITS, { number: 'A-706' }), cancelled_by: 'allottee', reason: 'allottee_s_request', unit_cost: 8_000_000, received: 800_000, ...values });

  it('caps the deduction by the days since the allotment letter, and counts the days to refund', () => {
    const p = project();
    write(p, 'commercial.buyers.collections', { lending_rate: 8.8 });
    const id = cancel(p, { stage: 'before_agreement', allotted_on: '2026-08-01', requested_on: '2026-08-20', deducted: 100_000 });
    const first = sheet(p, 'commercial.buyers.cancellations', id);
    assert.deepEqual(['days_from_allotment', 'deduction_allowed_pct', 'most_deductible', 'refund_due', 'refund_due_by', 'refund_days_left', 'refund_standing'].map(first.value), [19, 1, 80_000, 700_000, '2026-10-04', -8, 'Refund overdue']);
    assert.deepEqual(first.view('deduction_allowed_pct').cites?.map((c) => [c.key, c.source.clause, c.verified]), [['rera_cancel_deduction', 'clause 9', false]]);
    assert.equal(first.view('refund_standing').cites?.[0]?.key, 'rera_refund_within_days', 'a standing that reads a limit cites its row');
    assert.ok(first.said().includes('Deducted ₹1 lakh; the most the terms allow is ₹80,000.'), first.said().join('\n'));
    assert.equal(first.shown('booking_amount'), 'hidden');
    assert.equal(first.view('booking_amount').missing, false);
    assert.equal(sheet(p, 'commercial.buyers.dues').value('refunds_overdue'), 1);
    assert.equal(sheet(p, 'commercial.buyers.dues').value('dues_standing'), 'A refund is overdue');

    write(p, 'commercial.buyers.cancellations', { deducted: 80_000 }, id);
    const within = sheet(p, 'commercial.buyers.cancellations', id);
    assert.ok(!within.said().some((text) => /^Deducted/.test(text)), 'the rule passes at the cap');
    assert.equal(within.value('refund_due'), 720_000);
    assert.equal(within.value('refund_late_interest'), 1_704.33, '7,20,000 at 10.8% for 8 days');

    write(p, 'commercial.buyers.cancellations', { refunded_on: '2026-10-12' }, id);
    const paid = sheet(p, 'commercial.buyers.cancellations', id);
    assert.equal(paid.value('refund_days_left'), null);
    assert.equal(paid.value('refund_standing'), null);
    assert.equal(sheet(p, 'commercial.buyers.dues').value('refunds_overdue'), 0);
    assert.equal(sheet(p, 'commercial.buyers.dues').value('refunds_outstanding'), 0);
  });

  it('takes the terms the stage and the reason call for', () => {
    const p = project();
    const day61 = cancel(p, { stage: 'before_agreement', allotted_on: '2026-06-01', requested_on: '2026-08-01' });
    assert.deepEqual(['days_from_allotment', 'deduction_allowed_pct', 'most_deductible'].map(sheet(p, 'commercial.buyers.cancellations', day61).value), [61, 2, 160_000]);
    const early = cancel(p, { stage: 'before_agreement', allotted_on: '2026-06-01', requested_on: '2026-06-16' });
    assert.deepEqual(['deduction_allowed_pct', 'most_deductible'].map(sheet(p, 'commercial.buyers.cancellations', early).value), [0, 0]);

    const after = cancel(p, { stage: 'after_agreement', requested_on: '2026-09-01', booking_amount: 400_000 });
    const registered = sheet(p, 'commercial.buyers.cancellations', after);
    assert.equal(registered.shown('allotted_on'), 'hidden');
    assert.equal(registered.shown('booking_amount'), 'shown');
    assert.deepEqual(['most_deductible', 'refund_due_by'].map(registered.value), [400_000, '2026-10-31']);

    const delayed = cancel(p, { stage: 'after_agreement', reason: 'possession_delayed', requested_on: '2026-09-01', booking_amount: 400_000, deducted: 400_000 });
    const fault = sheet(p, 'commercial.buyers.cancellations', delayed);
    assert.equal(fault.value('most_deductible'), 0);
    assert.ok(fault.said().includes('Deducted ₹4 lakh; the most the terms allow is ₹0.'), fault.said().join('\n'));

    const lapsed = cancel(p, { cancelled_by: 'promoter', stage: 'before_agreement', reason: 'agreement_not_registered_in_time', allotted_on: '2026-05-01', requested_on: '2026-08-01' });
    assert.equal(sheet(p, 'commercial.buyers.cancellations', lapsed).value('most_deductible'), 160_000, 'two per cent of the unit’s cost, from the model allotment letter');
  });
});

/* ==================================================================== */
/* Handover                                                              */
/* ==================================================================== */

describe('possession and defects', () => {
  it('opens possession on a unit once the occupancy certificate is issued, and counts the days from then', () => {
    const p = project();
    write(p, 'commercial.buyers.collections', { lending_rate: 8.8 });
    const id = add(p, UNITS, { number: 'A-501', sale_released: true, sale_allotment_letter: [paper(p, 'Allotment letter A-501')], sale_allotted_on: '2025-01-10', sale_agreement: [paper(p, 'Agreement A-501')], sale_agreement_registered_on: '2025-02-20', sale_possession_promised: '2026-06-30' });
    assert.equal(sheet(p, UNITS, id).shown('handover_offered_on'), 'hidden');
    assert.deepEqual(page(p, 'commercial.handover').situations.map((s) => [s.situation.key, s.state]), [['handover_and_conveyance', 'off']]);

    const occupancy = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'regulatory.occupancy');
    assert.ok(occupancy, 'the assessment holds the occupancy check');
    recordCheckFields(p, occupancy.id, { oc_issued: true, oc_date: '2026-09-01' }, LEAD);
    assert.deepEqual(page(p, 'commercial.handover').situations.map((s) => [s.situation.key, s.state]), [['handover_and_conveyance', 'on']]);
    const handover = sheet(p, 'commercial.handover.possession');
    assert.deepEqual(['oc_date', 'offer_due', 'conveyance_due'].map(handover.value), ['2026-09-01', '2026-11-01', '2026-12-01']);
    assert.equal(handover.view('offer_due').cites?.[0]?.verified, false);

    write(p, UNITS, { handover_offered_on: '2026-10-01', handover_paid_by_buyer: 6_000_000 }, id);
    const unit = sheet(p, UNITS, id);
    assert.equal(unit.shown('handover_offered_on'), 'shown');
    assert.deepEqual(['handover_days_late', 'handover_delay_interest', 'handover_standing'].map(unit.value), [93, 165_106.85, 'Offered, not yet taken']);
    assert.ok(unit.said().includes('Possession is 93 days past the date the agreement promised.'));
    write(p, UNITS, { handover_taken_on: '2026-10-10', handover_given: ['keys', 'electricity meter'], sale_possession_certificate: [paper(p, 'Possession certificate A-501')] }, id);
    const taken = sheet(p, UNITS, id);
    assert.deepEqual(['handover_liability_ends', 'handover_standing', 'sale_status'].map(taken.value), ['2031-10-10', 'Taken', UNIT_STATUS.handedOver]);
    assert.deepEqual(['units_offered', 'units_handed_over', 'delay_interest'].map(sheet(p, 'commercial.handover.possession').value), [1, 1, 165_106.85]);
  });

  it('gives a defect in the liability period its day to be rectified by, and says when that has passed', () => {
    const p = project();
    const unit = add(p, UNITS, { number: 'A-501' });
    const id = add(p, 'commercial.handover.requests', { request_no: 'SR-031', unit, category: 'seepage_or_waterproofing', raised_on: '2026-09-01', in_liability_period: false });
    assert.equal(sheet(p, 'commercial.handover.requests', id).shown('rectify_by'), 'hidden');
    write(p, 'commercial.handover.requests', { in_liability_period: true }, id);
    const request = sheet(p, 'commercial.handover.requests', id);
    assert.deepEqual(['rectify_by', 'days_left', 'request_standing'].map(request.value), ['2026-10-01', -11, 'Past the time to rectify']);
    assert.equal(request.view('rectify_by').cites?.[0]?.source.clause, 'section 14(3)');
    // A snag is the site's record, kept by Technical against the unit: Handover reads how many are open.
    add(p, 'construction.quality.snags', { snag_no: 'SN-014', unit, raised_on: '2026-09-20' });
    const handover = sheet(p, 'commercial.handover.possession');
    assert.deepEqual(['snags_open', 'requests_open', 'requests_overdue', 'handover_standing'].map(handover.value), [1, 1, 1, 'A defect is past its time']);
    assert.ok(page(p, 'commercial.handover').exceptions.some((e) => e.text === 'Defects past the time the Act gives to rectify them: 1.'));

    write(p, 'commercial.handover.requests', { closed_on: '2026-10-11' }, id);
    assert.equal(sheet(p, 'commercial.handover.requests', id).value('request_standing'), null);
    assert.deepEqual(['requests_open', 'requests_overdue'].map(sheet(p, 'commercial.handover.possession').value), [0, 0]);
  });
});

/* ==================================================================== */
/* Market and Marketing                                                  */
/* ==================================================================== */

describe('the market and the launch', () => {
  it('restates a competitor’s rate on carpet area, and sets ours beside the range', () => {
    const p = project();
    write(p, 'commercial.market.price_list', { base_rate: 80_000 });
    const a = add(p, 'commercial.market.competitors', { project: 'Orchard Court', locality: 'Lake Road', units_total: 200, units_booked: 90, quoted_rate: 60_000, quoted_basis: 'super_built_up' });
    const quoted = sheet(p, 'commercial.market.competitors', a);
    assert.equal(quoted.shown('loading_pct'), 'shown');
    assert.equal(quoted.value('rate_on_carpet'), null, 'no rate on carpet until the loading is known');
    assert.deepEqual(quoted.said(), ['The rate is quoted on super_built_up area and no loading is recorded, so it cannot be restated on carpet area.']);
    write(p, 'commercial.market.competitors', { loading_pct: 30 }, a);
    assert.deepEqual(['sold_pct', 'rate_on_carpet'].map(sheet(p, 'commercial.market.competitors', a).value), [45, 78_000]);
    const b = add(p, 'commercial.market.competitors', { project: 'Canal View', locality: 'Lake Road', units_total: 120, units_booked: 30, quoted_rate: 86_000, quoted_basis: 'carpet' });
    assert.equal(sheet(p, 'commercial.market.competitors', b).shown('loading_pct'), 'hidden');
    const watch = sheet(p, 'commercial.market.watch');
    assert.deepEqual(['competitors', 'market_rate_low', 'market_rate_high', 'own_rate', 'rate_gap_pct'].map(watch.value), [2, 78_000, 86_000, 80_000, -2.4]);
    assert.equal(watch.view('price_position').def.control, 'scale');
  });

  it('counts what is released from the units, and holds the launch to no typed total', () => {
    const p = project();
    withUnits(p);
    write(p, 'commercial.marketing.launch', { kind: 'launch', launch_date: '2026-11-15', budget: '3.2 Cr' });
    const launch = sheet(p, 'commercial.marketing.launch');
    assert.deepEqual(['units_released', 'value_released', 'price_list'].map(launch.value), [3, 19_455_000, 'PL-3']);
    assert.equal(launch.view('kind').def.control, 'tiles');
    assert.deepEqual(launch.said(), ['A launch date of 15 Nov 2026 is set and nobody is recorded as approving the launch.']);
    assert.ok(launch.reading.fields.filter((f) => f.shown === 'shown').length <= 12);
  });
});

describe('an advertisement', () => {
  const advertisement = (p: DdProject, values: Record<string, unknown>) =>
    add(p, 'commercial.marketing.advertisements', { reference: 'AD-002', creative: [paper(p, 'Hoarding artwork')], number_matches: true, number_position: 'top right corner', website_shown: true, change_disclaimer: false, area_basis: 'carpet only', ...values });

  it('is measured against the circular, the unit register and the price list, and a person gives the verdict', () => {
    const p = project();
    withUnits(p);
    const id = advertisement(p, { medium: 'newspaper_or_magazine', lettering_ratio: 0.4, block_pct: 8, lowest_price_stated: 5_000_000 });
    const first = sheet(p, 'commercial.marketing.advertisements', id);
    assert.equal(first.value('measured'), 'Lettering too small');
    assert.deepEqual(first.view('lettering_least').cites?.map((c) => [c.key, c.value, c.source.clause, c.verified]), [['rera_ad_lettering_ratio_min', 0.5, 'paragraph 1(a)', false]]);
    assert.deepEqual(first.said(), [
      'The registration number’s lettering is 0.4 of the project name’s; the circular asks for at least 0.5.',
      'The registered block measures 8%; the circular asks for at least 10%.',
      'The lowest price stated is ₹50 lakh; the lowest on the price list is ₹56 lakh.',
    ]);

    write(p, 'commercial.marketing.advertisements', { lettering_ratio: 0.6, block_pct: 12, lowest_price_stated: 5_600_000, claims: [{ claim: 'Clubhouse with a pool', kind: 'amenity', backed_by: 'nothing' }] }, id);
    const second = sheet(p, 'commercial.marketing.advertisements', id);
    assert.equal(second.value('measured'), 'A claim is backed by nothing');
    assert.deepEqual(second.said(), ['Claims in the advertisement backed by neither the agreement’s schedules, the sanctioned plan nor a filed paper: 1.']);

    write(p, 'commercial.marketing.advertisements', { claims: [{ claim: 'Clubhouse with a pool', kind: 'amenity', backed_by: 'agreement schedule' }], released_on: '2026-11-16' }, id);
    const third = sheet(p, 'commercial.marketing.advertisements', id);
    assert.equal(third.value('measured'), 'No measured check fails');
    assert.deepEqual(third.said(), ['Released on 16 Nov 2026 with no verdict recorded.']);
    assert.equal(third.view('verdict').def.control, 'tiles');
    assert.equal(third.view('verdict').def.kind, 'enum', 'the verdict is a person’s choice; the measured standing is not');

    assert.deepEqual(['advertisements', 'passed', 'to_change', 'unchecked', 'advertising_standing'].map(sheet(p, 'commercial.marketing.advertising').value), [1, 0, 0, 1, 'An advertisement is not checked']);
    p.stakeholders.push({ id: 'stk_legal', name: 'P. Checker', role: 'Compliance' });
    write(p, 'commercial.marketing.advertisements', { verdict: 'pass', checked_by: 'stk_legal' }, id);
    assert.deepEqual(sheet(p, 'commercial.marketing.advertisements', id).said(), []);
    assert.equal(sheet(p, 'commercial.marketing.advertising').value('advertising_standing'), 'All passed');
  });

  it('asks for the print measurements of a print advertisement only, and stops measuring one that is withdrawn', () => {
    const p = project();
    const id = advertisement(p, { medium: 'website', website_shown: false });
    const web = sheet(p, 'commercial.marketing.advertisements', id);
    assert.equal(web.shown('block_pct'), 'hidden');
    assert.equal(web.view('block_pct').missing, false);
    assert.equal(web.value('measured'), 'Authority’s website not shown');
    write(p, 'commercial.marketing.advertisements', { withdrawn_on: '2026-10-01' }, id);
    assert.equal(sheet(p, 'commercial.marketing.advertisements', id).value('measured'), 'No measured check fails');
    // The page of the function says nothing of advertising until there is an advertisement.
    assert.deepEqual(sheet(project(), 'commercial.marketing.advertising').showing(), []);
  });

  it('sets a campaign’s spend against its budget, and the cost of what it brought', () => {
    const p = project();
    const id = add(p, 'commercial.marketing.campaigns', { name: 'Ring road hoardings', channel: 'outdoor', starts_on: '2026-11-15', ends_on: '2027-01-15', budget: 3_000_000, invoices: [{ invoice_no: 'H-01', on: '2026-11-20', amount: 3_150_000 }], leads: 96, visits: 30, sales: 3 });
    const campaign = sheet(p, 'commercial.marketing.campaigns', id);
    assert.deepEqual(['spent', 'spent_pct', 'spend_standing', 'cost_per_lead', 'cost_per_sale'].map(campaign.value), [3_150_000, 105, 'Over budget', 32_812.5, 1_050_000]);
    assert.deepEqual(campaign.said(), ['Spent ₹31.5 lakh against a budget of ₹30 lakh.']);
    write(p, 'commercial.marketing.launch', { budget: 3_000_000 });
    const spend = sheet(p, 'commercial.marketing.spend');
    assert.deepEqual(['budget', 'budgeted', 'spent', 'leads', 'spend_standing'].map(spend.value), [3_000_000, 3_000_000, 3_150_000, 96, 'Over the marketing budget']);
  });
});

describe('enquiries', () => {
  it('holds counts by week and by source, never a lead', () => {
    const p = project();
    withUnits(p);
    write(p, 'commercial.inventory.enquiries', { kept_in: 'a CRM', last_read: '2026-10-01', weeks: [{ week: '2026-09-28', enquiries: 40, qualified: 22, visits: 12 }, { week: '2026-10-05', enquiries: 60, qualified: 30, visits: 13 }] });
    const funnel = sheet(p, 'commercial.inventory.enquiries');
    assert.deepEqual(['enquiries', 'visits', 'enquiry_to_visit_pct', 'units_sold', 'visit_to_sale_pct', 'days_since_read'].map(funnel.value), [100, 25, 25, 2, 8, 11]);
    assert.deepEqual(funnel.said(), ['The counts were last read 11 days ago.']);
    assert.equal(funnel.view('weeks').def.display, 'chart');
    const keys = fieldCatalog().sets.get('commercial.inventory.enquiries')!.fields.flatMap((def) => [def.key, ...(def.columns ?? []).map((column) => column.key)]);
    assert.ok(!keys.some((key) => /name|phone|email|note|message|follow/.test(key)), 'no lead, no contact and no message is a field');
    assert.equal(funnel.shown('consent_recorded'), 'hidden');
    setSituation(p, 'commercial.inventory', 'leads_contacted_by_phone_or_message', true, LEAD);
    assert.equal(sheet(p, 'commercial.inventory.enquiries').shown('consent_recorded'), 'shown');
  });
});
