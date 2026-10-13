/**
 * Sales and Marketing: what a developer's project office holds to sell the
 * units, take the money, hand them over, and stay lawful while advertising.
 *
 * Five functions of Commercial hold it. Market: the price list and the
 * competing projects. Marketing: the launch, the campaigns and every
 * advertisement checked before it is released. Sales: the stock, the
 * enquiries as counts, the buyers, the channel partners and each unit's sale.
 * Collections: payment plans, demands, dues and cancellations. Handover:
 * possession, snags and the defect liability period.
 *
 * The unit is the central record. It is the project's (`shared.units`), and
 * the sale of it is added to that one record: a unit's status is never typed,
 * it is read from which papers are on file for it. Whatever repeats and has
 * a life of its own (a demand, a cancellation, a service request, an
 * advertisement) is a set of records with a unit linked.
 *
 * Every figure the law sets is read from the rule table
 * (`rules/sales-marketing.ts`). The CRM stays the source for leads and
 * follow-ups: counts and sources are held here, no lead, no call note and no
 * message. Nothing here holds advertising copy.
 *
 * What a buyer is asked for is kept to what the allotment letter, the
 * agreement and the tax papers need, and is held as ticks for papers on file:
 * no identity number is a field. The sets in `CUSTOMER_SETS` are never
 * handed to an outside collaborator (`project-view.ts`).
 */

import type { CheckFieldDef, CheckFormula, CheckInsightRule, FieldAddress, FieldSet, FormulaCondition, OptionDef, RowCondition, ShowWhen, Tone } from '../types';
import { withLinks, type SetLinks } from './builders';

/* ==================================================================== */
/* Names                                                                 */
/* ==================================================================== */

const MARKET = 'commercial.market';
const MARKETING = 'commercial.marketing';
const SALES = 'commercial.inventory';
const BUYERS = 'commercial.buyers';
const HANDOVER = 'commercial.handover';

const UNITS = 'shared.units';
const PRICE_LIST = 'commercial.market.price_list';
const COMPETITORS = 'commercial.market.competitors';
const WATCH = 'commercial.market.watch';
const LAUNCH = 'commercial.marketing.launch';
const CAMPAIGNS = 'commercial.marketing.campaigns';
const SPEND = 'commercial.marketing.spend';
const ADVERTISEMENTS = 'commercial.marketing.advertisements';
const ADVERTISING = 'commercial.marketing.advertising';
const STOCK = 'commercial.inventory.stock';
const BOOKINGS = 'commercial.inventory.bookings';
const UNIT_SALE = 'commercial.inventory.unit_sale';
const UNIT_AGREEMENT = 'commercial.inventory.unit_agreement';
const CUSTOMERS = 'commercial.inventory.buyers';
const ENQUIRIES = 'commercial.inventory.enquiries';
const PARTNERS = 'commercial.inventory.partners';
const BROKERAGE = 'commercial.inventory.brokerage';
const BROKERAGE_INVOICES = 'commercial.inventory.brokerage_invoices';
const PLANS = 'commercial.buyers.plans';
const DEMANDS = 'commercial.buyers.demands';
const COLLECTIONS = 'commercial.buyers.collections';
const DUES = 'commercial.buyers.dues';
const CANCELLATIONS = 'commercial.buyers.cancellations';
const POSSESSION = 'commercial.handover.possession';
const UNIT_POSSESSION = 'commercial.handover.unit_possession';
// A snag is the site's record, kept once by Technical (construction.quality.snags) against the unit; Handover reads how many are open.
const SNAGS = 'construction.quality.snags';
const REQUESTS = 'commercial.handover.requests';

/**
 * The sets that hold a buyer as a person: who is buying, with whom, on what
 * papers, on whose loan. An outside collaborator is handed none of them, nor
 * the party records they link to, whatever their grant names.
 */
export const CUSTOMER_SETS: readonly string[] = [CUSTOMERS];

/** A unit's standing, as its status field says it. Read from papers on file, never typed. */
export const UNIT_STATUS = {
  notReleased: 'Not released',
  available: 'Available',
  held: 'Held',
  booked: 'Booked',
  agreement: 'Agreement registered',
  saleDeed: 'Sale deed registered',
  handedOver: 'Handed over',
  cancelled: 'Cancelled',
} as const;

const SOLD = [UNIT_STATUS.booked, UNIT_STATUS.agreement, UNIT_STATUS.saleDeed, UNIT_STATUS.handedOver];
const IN_STOCK = [UNIT_STATUS.available, UNIT_STATUS.held];

/* ==================================================================== */
/* Shapes written once                                                   */
/* ==================================================================== */

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });
const unit = (field: string): FieldAddress => at('shared', UNITS, field);

const f = (key: string, address?: FieldAddress): CheckFormula => ({ op: 'field', key, ...(address ? { at: address } : {}) });
const n = (value: number): CheckFormula => ({ op: 'const', value });
const add = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'add', left, right });
const minus = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
const times = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'multiply', left, right });
const over = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'divide', left, right });
const share = (part: CheckFormula, whole: CheckFormula): CheckFormula => times(over(part, whole), n(100));
/** The amount, or nothing where it is not recorded: for a part of a sum that may be left out. */
const orNone = (formula: CheckFormula): CheckFormula => ({ op: 'max', of: [formula, n(0)] });
const rate = (table: string, where?: Record<string, { field: string } | { value: string | number }>): CheckFormula => ({ op: 'rate', table, ...(where ? { where } : {}) });
const isSet = (field: string): FormulaCondition => ({ field, is: 'set' });
/**
 * A figure that stops being asked once something has happened: days left to
 * refund, once the refund is paid. Dividing by nothing gives no answer, which
 * is what a count of days left should give when there is nothing left to do.
 */
const until = (done: string, formula: CheckFormula): CheckFormula => over(formula, { op: 'if', when: isSet(done), then: n(0), else: n(1) });
/** A figure that is not asked until something is recorded: the least a measurement may be, before anything is measured. */
const once = (begun: string, formula: CheckFormula): CheckFormula => over(formula, { op: 'if', when: isSet(begun), then: n(1), else: n(0) });

const countOf = (set: string): CheckFormula => ({ op: 'records', set, reduce: 'count' });
/** A figure about the records of a set, with no answer while there are none: a sheet about partners says nothing of a project that has none. */
const ofAny = (set: string, titleField: string, formula: CheckFormula): CheckFormula => over(formula, { op: 'if', when: { left: { op: 'records', set, reduce: 'count', field: titleField }, is: 'gt', right: n(0) }, then: n(1), else: n(0) });
const sumOf = (set: string, field: string): CheckFormula => ({ op: 'records', set, reduce: 'sum', field });
const countWhere = (set: string, where: RowCondition): CheckFormula => ({ op: 'count_if', over: { records: set }, where });
const sumWhere = (set: string, column: string, where: RowCondition): CheckFormula => ({ op: 'sum_if', over: { records: set }, column, where });

type More = Partial<CheckFieldDef>;
const money = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'money', dimension: 'money', currency: 'INR', ...more });
const worked = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, ...more });
const workedMoney = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { dimension: 'money', currency: 'INR', ...more });
const workedCount = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { precision: 0, ...more });
const workedShare = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { unit: '%', precision: 1, ...more });
const workedDay = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => worked(key, label, formula, { yields: 'date', ...more });
const paper = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, ...more });

const options = (labels: Array<string | [label: string, tone: Tone]>): OptionDef[] =>
  labels.map((entry) => {
    const [label, tone] = typeof entry === 'string' ? [entry, undefined] : entry;
    return { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label, ...(tone ? { tone } : {}) };
  });

/** A standing case that holds while one field is filled and the next step's is not. */
const reached = (holds: string, next: string, label: string, tone: Tone, whenIn?: string[]): NonNullable<CheckFieldDef['cases']>[number] => ({
  when: { kind: 'require_if', fields: [holds, next], ...(whenIn ? { whenIn } : {}), say: `${label}.`, severity: 'low' },
  label,
  tone,
});
const above = (field: string, figure: number, say: string, severity: CheckInsightRule['severity']): CheckInsightRule => ({ kind: 'at_most', fields: [field], against: figure, say, severity });
const below = (field: string, figure: number, say: string, severity: CheckInsightRule['severity']): CheckInsightRule => ({ kind: 'at_least', fields: [field], against: figure, say, severity });

/* --- Existing fields this file reads, each where it is entered ----------- */

const OC_ISSUED = at('legal.approvals', 'regulatory.occupancy', 'oc_issued');
const OC_DATE = at('legal.approvals', 'regulatory.occupancy', 'oc_date');
const ABSORPTION_SOLD = at(MARKET, 'commercial_market.absorption', 'units_sold');
const APPRAISAL_RATE = at('finance.feasibility', 'financial_appraisal.revenue_assumptions', 'rate_per_sqm');
const APPRAISAL_MARKETING = at('finance.valuation', 'indicative_valuation.residual_inputs', 'marketing_pct');
const APPRAISAL_GDV = at('finance.valuation', 'indicative_valuation.residual_inputs', 'gdv');
const SANCTIONED_BUDGET = at('finance.budget', 'cost_quantity.budget_current', 'sanctioned_budget');

const INTEREST_RATE = at(BUYERS, COLLECTIONS, 'interest_rate');

/* ==================================================================== */
/* Market: the price list, and the projects it is sold against           */
/* ==================================================================== */

const PRICE_LIST_SET: FieldSet = {
  id: PRICE_LIST,
  fn: MARKET,
  title: 'Price list',
  v: 1,
  optionSets: [
    { id: 'sales_parking_kind', label: 'Parking', options: options(['garage', 'covered, basement', 'covered, podium', 'stilt', 'mechanical', 'open']) },
    { id: 'sales_priced_attribute', label: 'Priced attribute', options: options(['corner', 'park facing', 'pool facing', 'road facing', 'garden unit', 'top floor', 'terrace unit', 'east facing', 'north facing']) },
    { id: 'sales_charge_head', label: 'Charge', options: options(['club membership', 'infrastructure and utility deposits', 'legal and documentation', 'maintenance advance', 'corpus fund', 'power backup']) },
  ],
  sections: [
    { key: 'list', label: 'In force' },
    { key: 'rates', label: 'Rates' },
    { key: 'charges', label: 'Parking and other charges' },
    { key: 'history', label: 'Earlier lists', tier: 'expert' },
  ],
  fields: [
    { key: 'version', label: 'Price list in force', kind: 'text', section: 'list', from: 'Approved price sheet', fromTypes: ['Price sheet'], factKey: 'price_list_version' },
    { key: 'effective_from', label: 'In force from', kind: 'date', section: 'list', from: 'Approved price sheet', fromTypes: ['Price sheet'] },
    { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party', section: 'list' },
    paper('approval', 'Approval note', { section: 'list', tier: 'expert' }),
    money('base_rate', 'Base rate, a square metre of carpet area', { section: 'rates', from: 'Approved price sheet', fromTypes: ['Price sheet'], proof: 'expected', hint: 'The agreement prices a unit on its carpet area.' }),
    money('floor_rise', 'Floor rise, a square metre for each floor', { section: 'rates', from: 'Approved price sheet', fromTypes: ['Price sheet'], required: false }),
    { key: 'floor_rise_from', label: 'Floor rise starts above floor', kind: 'number', min: 0, precision: 0, section: 'rates', from: 'Approved price sheet', required: false },
    { key: 'discount_limit_pct', label: 'Discount allowed without further approval', kind: 'percent', max: 100, precision: 2, section: 'rates', from: 'Approval note' },
    { key: 'escalation_free', label: 'The price is free of escalation', kind: 'boolean', control: 'switch', section: 'rates', from: 'Agreement for sale', hint: 'Only an increase in an authority’s charges may be passed on, with its notification.' },
    {
      key: 'parking_prices',
      label: 'Parking prices',
      kind: 'table',
      section: 'charges',
      from: 'Approved price sheet',
      columns: [
        { key: 'kind', label: 'Parking', kind: 'enum', optionSet: 'sales_parking_kind' },
        money('price', 'Price'),
      ],
    },
    {
      key: 'other_charges',
      label: 'Other charges',
      kind: 'table',
      section: 'charges',
      from: 'Approved price sheet',
      required: false,
      columns: [
        { key: 'head', label: 'Charge', kind: 'enum', optionSet: 'sales_charge_head' },
        { key: 'basis', label: 'Charged', kind: 'enum', options: ['a square metre', 'lump sum'] },
        money('amount', 'Amount'),
        { key: 'in_agreement_value', label: 'In the agreement value', kind: 'boolean', control: 'checkbox' },
        { key: 'refundable', label: 'Refundable', kind: 'boolean', control: 'checkbox' },
      ],
    },
    {
      key: 'location_charges',
      label: 'Location charges',
      kind: 'table',
      section: 'charges',
      tier: 'expert',
      required: false,
      from: 'Approved price sheet',
      columns: [
        { key: 'attribute', label: 'For', kind: 'enum', optionSet: 'sales_priced_attribute' },
        { key: 'basis', label: 'Charged', kind: 'enum', options: ['a square metre', 'lump sum'] },
        money('amount', 'Amount'),
      ],
    },
    {
      key: 'earlier_lists',
      label: 'Earlier price lists',
      kind: 'table',
      display: 'timeline',
      section: 'history',
      tier: 'expert',
      required: false,
      columns: [
        { key: 'from', label: 'In force from', kind: 'date' },
        { key: 'version', label: 'Version', kind: 'text' },
        money('base_rate', 'Base rate'),
      ],
    },
  ],
  rules: [
    { kind: 'require', fields: ['approved_by'], say: 'The price list in force names nobody who approved it.', severity: 'medium' },
    { kind: 'require_if', fields: ['floor_rise', 'floor_rise_from'], say: 'A floor rise of {a} is recorded and not the floor it starts above.', severity: 'low' },
  ],
};

const COMPETITORS_SET: FieldSet = {
  id: COMPETITORS,
  fn: MARKET,
  title: 'Competing projects',
  v: 1,
  records: { of: 'competing project', titleField: 'project', summaryFields: ['locality', 'rate_on_carpet', 'sold_pct'] },
  optionSets: [
    { id: 'sales_area_basis', label: 'Area basis', options: options(['carpet', 'built-up', 'super built-up', 'plot']) },
    { id: 'sales_plan_kind', label: 'Payment plan', options: options(['construction-linked', 'time-linked', 'down-payment', 'subvention']) },
  ],
  sections: [
    { key: 'project', label: 'Project' },
    { key: 'sales', label: 'Sales, as disclosed' },
    { key: 'rate', label: 'Asking rate' },
    { key: 'more', label: 'More', tier: 'expert' },
  ],
  fields: [
    { key: 'project', label: 'Project', kind: 'text', section: 'project' },
    { key: 'developer', label: 'Developer', kind: 'text', suggest: 'party', section: 'project', required: false },
    { key: 'registration_no', label: 'Regulator’s registration number', kind: 'text', section: 'project', from: 'The regulator’s project page', hint: 'As printed on the project’s page on the regulator’s website.' },
    { key: 'locality', label: 'Locality', kind: 'text', section: 'project' },
    { key: 'distance', label: 'Distance from the site', kind: 'number', dimension: 'length', enterIn: ['km', 'm'], section: 'project', required: false },
    { key: 'stage', label: 'Stands', kind: 'enum', control: 'segmented', options: ['under construction', 'ready'], section: 'project', required: false },
    { key: 'units_total', label: 'Units in the project', kind: 'number', min: 0, precision: 0, section: 'sales', from: 'The regulator’s project page' },
    { key: 'units_booked', label: 'Units booked', kind: 'number', min: 0, precision: 0, section: 'sales', from: 'The project’s quarterly update' },
    { key: 'counts_as_at', label: 'Counts as at', kind: 'date', section: 'sales', from: 'The project’s quarterly update' },
    workedShare('sold_pct', 'Sold', share(f('units_booked'), f('units_total')), { section: 'sales' }),
    money('quoted_rate', 'Rate as quoted, a square metre', { section: 'rate', from: 'Listing or brochure', hint: 'An asking rate, not a price paid.' }),
    { key: 'quoted_basis', label: 'Quoted on', kind: 'enum', control: 'segmented', optionSet: 'sales_area_basis', section: 'rate', from: 'Listing or brochure' },
    {
      key: 'loading_pct',
      label: 'Loading over carpet area',
      kind: 'percent',
      max: 200,
      precision: 1,
      section: 'rate',
      tier: 'situational',
      showWhen: { field: at(MARKET, COMPETITORS, 'quoted_basis'), is: 'in', value: ['built_up', 'super_built_up'] },
      from: 'The regulator’s carpet area against the area quoted',
    },
    workedMoney(
      'rate_on_carpet',
      'Rate on carpet area, a square metre',
      { op: 'if', when: { field: 'quoted_basis', is: 'equals', value: 'carpet' }, then: f('quoted_rate'), else: times(f('quoted_rate'), add(n(1), over(f('loading_pct'), n(100)))) },
      { section: 'rate' },
    ),
    { key: 'launched_on', label: 'Launched on', kind: 'date', section: 'more', tier: 'expert', required: false },
    { key: 'completion_registered', label: 'Completion date as registered', kind: 'date', section: 'more', tier: 'expert', required: false, from: 'The regulator’s project page' },
    { key: 'payment_plan', label: 'Payment plan offered', kind: 'enum', optionSet: 'sales_plan_kind', section: 'more', tier: 'expert', required: false },
    { key: 'amenities', label: 'Amenities', kind: 'multi_enum', options: ['clubhouse', 'pool', 'gym', 'sports courts', 'school in campus', 'retail', 'EV charging', 'green rating'], section: 'more', tier: 'expert', required: false },
  ],
  rules: [
    { kind: 'require_if', fields: ['quoted_basis', 'loading_pct'], whenIn: ['built_up', 'super_built_up'], say: 'The rate is quoted on {a} area and no loading is recorded, so it cannot be restated on carpet area.', severity: 'medium' },
    { kind: 'at_most', fields: ['units_booked', 'units_total'], say: '{a} units are recorded as booked of {b} in the project.', severity: 'medium' },
  ],
};

const WATCH_SET: FieldSet = {
  id: WATCH,
  fn: MARKET,
  title: 'Market watch',
  v: 1,
  sections: [
    { key: 'watch', label: 'What is watched' },
    { key: 'rates', label: 'Our rate against the market' },
    { key: 'appraisal', label: 'Against the appraisal' },
  ],
  fields: [
    { key: 'watch_area', label: 'Localities watched', kind: 'text', section: 'watch', hint: 'Only a locality and the city leave the product for a listing search.' },
    { key: 'radius', label: 'Within', kind: 'number', dimension: 'length', enterIn: ['km'], section: 'watch', required: false },
    { key: 'refreshed_on', label: 'Last refreshed', kind: 'date', section: 'watch' },
    workedCount('competitors', 'Competing projects', countOf(COMPETITORS), { section: 'watch' }),
    workedMoney('market_rate_low', 'Lowest rate on carpet area nearby', { op: 'records', set: COMPETITORS, reduce: 'min', field: 'rate_on_carpet' }, { section: 'rates' }),
    workedMoney('market_rate_high', 'Highest rate on carpet area nearby', { op: 'records', set: COMPETITORS, reduce: 'max', field: 'rate_on_carpet' }, { section: 'rates' }),
    workedMoney('own_rate', 'Our base rate on carpet area', f('base_rate', at(MARKET, PRICE_LIST, 'base_rate')), { section: 'rates' }),
    workedShare('rate_gap_pct', 'Our rate against the middle of that range', { op: 'variance_pct', left: f('own_rate'), right: over(add(f('market_rate_low'), f('market_rate_high')), n(2)) }, { section: 'rates' }),
    { key: 'price_position', label: 'Where we mean to sit', kind: 'number', control: 'scale', min: 1, max: 5, section: 'rates', required: false, hint: '1 is well below the market, 5 well above.' },
    { key: 'rate_in_appraisal', label: 'Rate assumed in the appraisal', kind: 'money', unit: 'INR/sqm', section: 'appraisal', sameAs: APPRAISAL_RATE, required: false },
    workedShare('rate_vs_appraisal_pct', 'Our rate against the appraisal', { op: 'variance_pct', left: f('own_rate'), right: f('rate_in_appraisal') }, { section: 'appraisal' }),
    {
      key: 'price_standing',
      label: 'Price against the appraisal',
      kind: 'status',
      section: 'appraisal',
      cases: [
        { when: below('rate_vs_appraisal_pct', 0, 'The base rate on the price list is {a} against the rate the appraisal assumes.', 'high'), label: 'Below the appraisal', tone: 'warning' },
      ],
      otherwise: { label: 'At or above the appraisal', tone: 'good' },
    },
  ],
  rules: [below('rate_vs_appraisal_pct', 0, 'The base rate on the price list is {a} against the rate the appraisal assumes.', 'high')],
};

/* ==================================================================== */
/* Sales: the stock, and each unit's sale on the unit's own record       */
/* ==================================================================== */

const STOCK_SET: FieldSet = {
  id: STOCK,
  fn: SALES,
  title: 'Inventory',
  v: 1,
  // joint_development is declared by Law and lender_funded by Lenders; the fields here that wait on them name them.
  sections: [
    { key: 'stock', label: 'Stock' },
    { key: 'value', label: 'Unsold stock' },
    { key: 'check', label: 'Against the absorption check' },
  ],
  fields: [
    workedCount('units_total', 'Units on the register', countOf(UNITS), { section: 'stock' }),
    workedCount('units_sold', 'Sold', countWhere(UNITS, { column: 'sale_status', is: 'in', value: SOLD }), { section: 'stock' }),
    workedShare('sold_pct', 'Sold, of the register', share(f('units_sold'), f('units_total')), { section: 'stock' }),
    workedMoney('unsold_value', 'Value of stock at list price', sumWhere(UNITS, 'sale_list_price', { column: 'sale_status', is: 'in', value: IN_STOCK }), { section: 'value' }),
    worked('unsold_carpet_area', 'Carpet area in stock', sumWhere(UNITS, 'carpet_area', { column: 'sale_status', is: 'in', value: IN_STOCK }), { section: 'value', dimension: 'area' }),
    workedMoney('lowest_list_price', 'Lowest list price', { op: 'records', set: UNITS, reduce: 'min', field: 'sale_list_price' }, { section: 'value' }),
    { key: 'units_sold_on_check', label: 'Units sold, on the absorption check', kind: 'number', section: 'check', sameAs: ABSORPTION_SOLD, required: false },
    {
      key: 'stock_standing',
      label: 'Register against the check',
      kind: 'status',
      section: 'check',
      cases: [
        {
          when: { kind: 'compare', fields: ['units_sold', 'units_sold_on_check'], tolerance: 0, say: 'The register shows {a} sold and the absorption check records {b}.', severity: 'medium' },
          label: 'Differs from the absorption check',
          tone: 'warning',
        },
      ],
    },
  ],
  rules: [{ kind: 'compare', fields: ['units_sold', 'units_sold_on_check'], tolerance: 0, say: 'The unit register shows {a} sold and the absorption check records {b}.', severity: 'medium' }],
};

const BOOKINGS_SET: FieldSet = {
  id: BOOKINGS,
  fn: SALES,
  title: 'Bookings and agreements',
  v: 1,
  sections: [
    { key: 'value', label: 'Booked' },
    { key: 'papers', label: 'Agreements' },
  ],
  fields: [
    workedMoney('value_booked', 'Value booked', sumWhere(UNITS, 'sale_agreed_value', { column: 'sale_status', is: 'in', value: SOLD }), { section: 'value' }),
    worked('carpet_booked', 'Carpet area booked', sumWhere(UNITS, 'carpet_area', { column: 'sale_status', is: 'in', value: SOLD }), { section: 'value', dimension: 'area' }),
    workedMoney('realised_rate', 'Rate realised, a square metre of carpet area', over(f('value_booked'), f('carpet_booked')), { section: 'value' }),
    { key: 'rate_in_appraisal', label: 'Rate assumed in the appraisal', kind: 'money', unit: 'INR/sqm', section: 'value', sameAs: APPRAISAL_RATE, required: false },
    workedCount('covered_parking_booked', 'Garages and covered parking booked', sumWhere(UNITS, 'sale_covered_parking', { column: 'sale_status', is: 'in', value: SOLD }), { section: 'value' }),
    workedCount('agreements_registered', 'Agreements registered', countWhere(UNITS, { column: 'sale_status', is: 'in', value: [UNIT_STATUS.agreement, UNIT_STATUS.saleDeed, UNIT_STATUS.handedOver] }), { section: 'papers' }),
    workedCount('agreements_overdue', 'Agreements past the date they were due', countWhere(UNITS, { column: 'sale_agreement_standing', is: 'equals', value: 'Agreement overdue' }), { section: 'papers' }),
    workedCount('advances_over_cap', 'Units holding an advance above the cap', countWhere(UNITS, { column: 'sale_advance_over_cap', is: 'gt', value: 0 }), { section: 'papers' }),
    {
      key: 'bookings_standing',
      label: 'Bookings',
      kind: 'status',
      section: 'papers',
      cases: [
        { when: above('advances_over_cap', 0, '{a} unit(s) hold an advance above the cap the Act sets before a registered agreement.', 'critical'), label: 'An advance is above the cap', tone: 'critical' },
        { when: above('agreements_overdue', 0, '{a} agreement(s) are past the date they were to be registered by.', 'high'), label: 'An agreement is overdue', tone: 'warning' },
      ],
    },
  ],
  rules: [
    above('advances_over_cap', 0, '{a} unit(s) hold an advance above the cap the Act sets before a registered agreement.', 'critical'),
    above('agreements_overdue', 0, '{a} agreement(s) are past the date they were to be registered by.', 'high'),
    { kind: 'at_least', fields: ['realised_rate', 'rate_in_appraisal'], say: 'The rate realised is {a} a square metre; the appraisal assumes {b}.', severity: 'medium' },
  ],
};

const UNIT_SALE_SECTIONS: FieldSet['sections'] = [
  { key: 'sale', label: 'For sale' },
  { key: 'booking', label: 'Booking', showWhen: { field: unit('sale_released'), is: 'true' } },
  { key: 'partner', label: 'Channel partner', showWhen: { all: [{ situation: 'channel_partners_engaged' }, { field: unit('sale_released'), is: 'true' }] } },
];

const UNIT_SALE_SET: FieldSet = {
  id: UNIT_SALE,
  fn: SALES,
  title: 'A unit’s sale',
  v: 1,
  extends: UNITS,
  situations: [
    {
      key: 'channel_partners_engaged',
      label: 'Channel partners engaged',
      scope: 'project',
      derive: { records: PARTNERS, is: 'any' },
    },
  ],
  sections: UNIT_SALE_SECTIONS,
  fields: [
    { key: 'sale_released', label: 'Released for sale', kind: 'boolean', control: 'tick', section: 'sale', required: false },
    {
      key: 'sale_status',
      label: 'Status',
      kind: 'status',
      section: 'sale',
      // Each case holds while its paper is on file and the next step's is not. Nobody types a status.
      cases: [
        reached('sale_cancellation', 'sale_possession_certificate', UNIT_STATUS.cancelled, 'critical'),
        reached('sale_possession_certificate', 'sale_cancellation', UNIT_STATUS.handedOver, 'neutral'),
        reached('sale_deed', 'sale_possession_certificate', UNIT_STATUS.saleDeed, 'info'),
        reached('sale_agreement', 'sale_deed', UNIT_STATUS.agreement, 'info'),
        reached('sale_allotment_letter', 'sale_agreement', UNIT_STATUS.booked, 'info'),
        reached('sale_hold_until', 'sale_allotment_letter', UNIT_STATUS.held, 'warning'),
        reached('sale_released', 'sale_hold_until', UNIT_STATUS.available, 'good', ['true']),
      ],
      otherwise: { label: UNIT_STATUS.notReleased, tone: 'neutral' },
    },
    workedMoney(
      'sale_list_price',
      'List price',
      add(
        times(
          f('carpet_area'),
          add(f('base_rate', at(MARKET, PRICE_LIST, 'base_rate')), orNone(times(f('floor_rise', at(MARKET, PRICE_LIST, 'floor_rise')), orNone(minus(f('floor'), f('floor_rise_from', at(MARKET, PRICE_LIST, 'floor_rise_from'))))))),
        ),
        orNone(f('sale_location_charge')),
      ),
      { section: 'sale', hint: 'Carpet area at the base rate and floor rise on the price list in force, and this unit’s location charge.' },
    ),
    money('sale_location_charge', 'Location charge on this unit', { section: 'sale', tier: 'expert', required: false, from: 'Approved price sheet' }),
    { key: 'sale_hold_until', label: 'Held until', kind: 'date', section: 'sale', tier: 'expert', required: false, expires: { leadDays: 1 } },
    {
      key: 'sale_allotted_to',
      label: 'Whose unit',
      kind: 'enum',
      control: 'segmented',
      options: ['promoter', 'landowner', 'investor', 'retained'],
      section: 'sale',
      tier: 'situational',
      showWhen: { situation: 'joint_development' },
      required: false,
      from: 'Joint development agreement, sharing schedule',
    },

    { key: 'sale_booked_on', label: 'Booked on', kind: 'date', section: 'booking', required: false, from: 'Application form' },
    money('sale_agreed_value', 'Agreed value', { section: 'booking', required: false, proof: 'expected', from: 'Allotment letter', hint: 'Without GST, stamp duty and registration.' }),
    workedShare('sale_discount_pct', 'Discount from the list price', share(minus(f('sale_list_price'), f('sale_agreed_value')), f('sale_list_price')), { section: 'booking' }),
    { key: 'sale_plan', label: 'Payment plan', kind: 'ref', target: { set: PLANS }, section: 'booking', required: false, from: 'Agreement for sale, payment schedule' },
    { key: 'sale_covered_parking', label: 'Garages and covered parking allotted', kind: 'number', min: 0, precision: 0, section: 'booking', required: false, from: 'Allotment letter' },
    { key: 'sale_partner', label: 'Sold through', kind: 'ref', target: { set: PARTNERS }, section: 'partner', required: false },
    { key: 'sale_brokerage_pct', label: 'Brokerage rate on this sale', kind: 'percent', max: 100, precision: 2, section: 'partner', required: false, showWhen: { field: unit('sale_partner'), is: 'set' }, from: 'Empanelment letter' },
    workedMoney('sale_brokerage_expected', 'Brokerage this sale gives', times(f('sale_agreed_value'), over(f('sale_brokerage_pct'), n(100))), { section: 'partner', showWhen: { field: unit('sale_partner'), is: 'set' } }),
  ],
  rules: [
    { kind: 'at_most', fields: ['sale_discount_pct', 'discount_limit'], at: { discount_limit: at(MARKET, PRICE_LIST, 'discount_limit_pct') }, say: 'The discount is {a}; the price list allows {b} without further approval.', severity: 'medium' },
    { kind: 'require_if', fields: ['sale_partner', 'sale_brokerage_pct'], say: 'The unit is sold through a channel partner and no brokerage rate is recorded for the sale.', severity: 'low' },
  ],
};

const UNIT_AGREEMENT_SET: FieldSet = {
  id: UNIT_AGREEMENT,
  fn: SALES,
  title: 'A unit’s allotment and agreement',
  v: 1,
  extends: UNITS,
  sections: [
    { key: 'allotment', label: 'Allotment', showWhen: { field: unit('sale_released'), is: 'true' } },
    { key: 'agreement', label: 'Agreement for sale', showWhen: { field: unit('sale_allotted_on'), is: 'set' } },
    { key: 'deeds', label: 'Sale deed and cancellation', showWhen: { field: unit('sale_allotted_on'), is: 'set' } },
  ],
  fields: [
    paper('sale_allotment_letter', 'Allotment letter', { section: 'allotment', from: 'Allotment letter' }),
    { key: 'sale_allotted_on', label: 'Allotment letter dated', kind: 'date', section: 'allotment', required: false, from: 'Allotment letter' },
    money('sale_received_before_agreement', 'Received before the registered agreement', { section: 'allotment', required: false, from: 'Allotment letter' }),
    workedShare('sale_advance_pct', 'Advance, of the agreed value', share(f('sale_received_before_agreement'), f('sale_agreed_value')), { section: 'allotment' }),
    worked('sale_advance_over_cap', 'Advance against the cap', minus(f('sale_advance_pct'), rate('rera_advance_before_agreement_max')), { section: 'allotment', unit: '% points', precision: 1, hint: 'Above nought, more was taken before the registered agreement than the Act allows.' }),
    paper('sale_lender_consent', 'Lender’s consent to sell this unit', { section: 'allotment', tier: 'situational', showWhen: { situation: 'lender_funded' }, from: 'Lender’s letter' }),

    workedDay('sale_agreement_due', 'Agreement to be registered by', { op: 'add_months', date: { op: 'date', key: 'sale_allotted_on' }, months: rate('rera_agreement_within_months') }, { section: 'agreement' }),
    paper('sale_agreement', 'Registered agreement for sale', { section: 'agreement', viewer: 'deed', from: 'Agreement for sale' }),
    { key: 'sale_agreement_registered_on', label: 'Agreement registered on', kind: 'date', section: 'agreement', required: false, from: 'Agreement for sale, registration endorsement' },
    worked('sale_agreement_days_left', 'Days left to register the agreement', until('sale_agreement_registered_on', minus({ op: 'date', key: 'sale_agreement_due' }, { op: 'today' })), { section: 'agreement', unit: 'days', precision: 0 }),
    {
      key: 'sale_agreement_standing',
      label: 'Agreement',
      kind: 'status',
      section: 'agreement',
      cases: [
        { when: below('sale_agreement_days_left', 0, 'The agreement is past the day it was to be registered by.', 'high'), label: 'Agreement overdue', tone: 'critical' },
        { when: below('sale_agreement_days_left', 15, 'The agreement is to be registered in {a}.', 'medium'), label: 'Agreement due soon', tone: 'warning' },
      ],
      otherwise: { label: 'In time', tone: 'good' },
    },
    { key: 'sale_carpet_in_agreement', label: 'Carpet area in the agreement', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'agreement', required: false, from: 'Agreement for sale, recitals' },
    { key: 'sale_possession_promised', label: 'Possession promised by', kind: 'date', section: 'agreement', required: false, from: 'Agreement for sale' },
    { key: 'sale_agreement_notice_on', label: 'Notice to register served on', kind: 'date', section: 'agreement', tier: 'expert', required: false, from: 'Notice' },
    workedDay('sale_cancel_open_from', 'Cancellation open to the promoter from', { op: 'add_days', date: { op: 'date', key: 'sale_agreement_notice_on' }, days: rate('rera_agreement_notice_days') }, { section: 'agreement', tier: 'expert' }),

    paper('sale_deed', 'Registered sale deed', { section: 'deeds', viewer: 'deed', from: 'Sale deed' }),
    paper('sale_cancellation', 'Cancellation letter or deed', { section: 'deeds', tier: 'expert', from: 'Cancellation letter' }),
  ],
  rules: [
    above('sale_advance_over_cap', 0, 'Received before the registered agreement is {a} above the cap the Act sets on an advance.', 'critical'),
    { kind: 'require_if', fields: ['sale_allotment_letter', 'sale_lender_consent'], when: { situation: 'lender_funded' }, say: 'An allotment letter is on file for this unit and the lender’s consent to sell it is not.', severity: 'high' },
    { kind: 'require_if', fields: ['sale_allotment_letter', 'sale_allotted_on'], say: 'An allotment letter is on file and its date is not recorded.', severity: 'low' },
    { kind: 'compare', fields: ['sale_carpet_in_agreement', 'carpet_area'], tolerance: 0.001, say: 'The agreement states {a} of carpet area and the unit register {b}: {divergence} apart.', severity: 'high' },
    { kind: 'before', fields: ['sale_allotted_on', 'sale_agreement_registered_on'], say: 'The agreement was registered on {b}, before the allotment letter of {a}.', severity: 'medium' },
    { kind: 'require_if', fields: ['sale_agreement', 'sale_agreement_registered_on'], say: 'A registered agreement is on file and the day it was registered is not recorded.', severity: 'medium' },
  ],
};

const CUSTOMERS_SET: FieldSet = {
  id: CUSTOMERS,
  fn: SALES,
  title: 'Buyers',
  v: 1,
  records: { of: 'buyer', titleField: 'party', summaryFields: ['unit', 'resident'] },
  sections: [
    { key: 'buyer', label: 'Buyer' },
    { key: 'papers', label: 'Papers' },
    { key: 'loan', label: 'Home loan' },
    { key: 'abroad', label: 'Buying from abroad', showWhen: { field: at(SALES, CUSTOMERS, 'resident'), is: 'equals', value: 'abroad' } },
  ],
  fields: [
    { key: 'party', label: 'First applicant', kind: 'ref', target: 'party', section: 'buyer', from: 'Application form' },
    { key: 'unit', label: 'Unit', kind: 'ref', target: 'unit', section: 'buyer', from: 'Application form' },
    { key: 'resident', label: 'Resident', kind: 'enum', control: 'segmented', options: ['in India', 'abroad'], section: 'buyer' },
    {
      key: 'co_applicants',
      label: 'Co-applicants',
      kind: 'table',
      section: 'buyer',
      tier: 'expert',
      required: false,
      from: 'Application form',
      columns: [
        { key: 'party', label: 'Applicant', kind: 'ref', target: 'party' },
        { key: 'share_pct', label: 'Share', kind: 'percent', max: 100 },
      ],
    },
    workedShare('co_share_total', 'Shares of the co-applicants', { op: 'sum', table: 'co_applicants', column: 'share_pct' }, { section: 'buyer', tier: 'expert' }),
    {
      key: 'papers_on_file',
      label: 'Buyer’s papers on file',
      kind: 'multi_enum',
      options: ['PAN', 'proof of identity', 'proof of address', 'photograph', 'passport', 'power of attorney'],
      section: 'papers',
      hint: 'A tick for each paper held. No number from any of them is kept here.',
    },
    {
      key: 'shown_before_booking',
      label: 'Shown to the buyer before booking',
      kind: 'multi_enum',
      options: ['sanctioned plan and layout', 'specifications', 'stage-wise completion schedule', 'registration number and the Authority’s website', 'encumbrances on the unit'],
      section: 'papers',
      from: 'Site office',
    },
    { key: 'home_loan', label: 'Buying with a home loan', kind: 'boolean', control: 'switch', section: 'loan', required: false },
    { key: 'lender', label: 'Buyer’s lender', kind: 'ref', target: 'party', section: 'loan', tier: 'situational', showWhen: { field: at(SALES, CUSTOMERS, 'home_loan'), is: 'true' }, from: 'Loan sanction letter' },
    paper('tripartite_agreement', 'Tripartite agreement', { section: 'loan', tier: 'situational', showWhen: { field: at(SALES, CUSTOMERS, 'home_loan'), is: 'true' } }),
    { key: 'remittance_account', label: 'Pays from', kind: 'enum', control: 'segmented', options: ['NRE account', 'NRO account', 'FCNR account'], section: 'abroad', tier: 'situational' },
    { key: 'attorney', label: 'Signs through', kind: 'ref', target: 'party', section: 'abroad', tier: 'situational', required: false, from: 'Power of attorney' },
  ],
  rules: [
    { kind: 'require_if', fields: ['home_loan', 'lender'], whenIn: ['true'], say: 'A home loan is recorded and the lender is not named.', severity: 'medium' },
    { kind: 'compare', fields: ['co_share_total'], against: 100, tolerance: 0, say: 'The co-applicants’ shares add to {a}, not {b}.', severity: 'medium' },
  ],
};

const ENQUIRIES_SET: FieldSet = {
  id: ENQUIRIES,
  fn: SALES,
  title: 'Enquiries and site visits',
  v: 1,
  optionSets: [
    {
      id: 'marketing_channel',
      label: 'Lead source and marketing channel',
      options: options(['property portal', 'search advertising', 'social advertising', 'print', 'outdoor', 'radio', 'SMS or messaging', 'event or expo', 'channel partner', 'referral', 'site walk-in']),
    },
  ],
  situations: [
    {
      key: 'leads_contacted_by_phone_or_message',
      label: 'Leads are called or messaged',
      scope: 'function',
      hint: 'Promotional calls and messages go out to people who enquired.',
    },
  ],
  sections: [
    { key: 'source', label: 'Where the counts come from' },
    { key: 'funnel', label: 'Funnel' },
    { key: 'sources', label: 'By source' },
    { key: 'contact', label: 'Calling and messaging', showWhen: { situation: 'leads_contacted_by_phone_or_message' } },
  ],
  fields: [
    { key: 'kept_in', label: 'Leads are kept in', kind: 'enum', control: 'segmented', options: ['a CRM', 'a spreadsheet'], section: 'source', hint: 'It stays the source for every lead and follow-up. Counts are read from it.' },
    { key: 'last_read', label: 'Counts last read on', kind: 'date', section: 'source', from: 'CRM export' },
    worked('days_since_read', 'Days since the counts were read', minus({ op: 'today' }, { op: 'date', key: 'last_read' }), { section: 'source', unit: 'days', precision: 0 }),
    {
      key: 'weeks',
      label: 'Enquiries and visits by week',
      kind: 'table',
      display: 'chart',
      chart: { x: 'week', y: 'enquiries', mark: 'bar' },
      section: 'funnel',
      from: 'CRM export',
      columns: [
        { key: 'week', label: 'Week starting', kind: 'date' },
        { key: 'enquiries', label: 'Enquiries', kind: 'number', min: 0 },
        { key: 'qualified', label: 'Qualified', kind: 'number', min: 0, required: false },
        { key: 'visits', label: 'Site visits', kind: 'number', min: 0 },
      ],
    },
    workedCount('enquiries', 'Enquiries', { op: 'sum', table: 'weeks', column: 'enquiries' }, { section: 'funnel' }),
    workedCount('visits', 'Site visits', { op: 'sum', table: 'weeks', column: 'visits' }, { section: 'funnel' }),
    workedShare('enquiry_to_visit_pct', 'Enquiry to visit', share(f('visits'), f('enquiries')), { section: 'funnel' }),
    workedCount('units_sold', 'Units sold', f('units_sold', at(SALES, STOCK, 'units_sold')), { section: 'funnel' }),
    workedShare('visit_to_sale_pct', 'Visit to sale', share(f('units_sold'), f('visits')), { section: 'funnel' }),
    {
      key: 'by_source',
      label: 'Enquiries by source',
      kind: 'table',
      display: 'chart',
      chart: { x: 'source', y: 'enquiries', mark: 'bar' },
      section: 'sources',
      required: false,
      from: 'CRM export',
      columns: [
        { key: 'source', label: 'Source', kind: 'enum', optionSet: 'marketing_channel' },
        { key: 'enquiries', label: 'Enquiries', kind: 'number', min: 0 },
        { key: 'visits', label: 'Site visits', kind: 'number', min: 0, required: false },
        { key: 'sales', label: 'Sales', kind: 'number', min: 0, required: false },
      ],
    },
    {
      key: 'lost_by_reason',
      label: 'Lost, by reason',
      kind: 'table',
      section: 'sources',
      tier: 'expert',
      required: false,
      from: 'CRM export',
      columns: [
        { key: 'reason', label: 'Reason', kind: 'enum', options: ['price', 'location', 'unit not available', 'loan refused', 'bought elsewhere', 'postponed', 'not reachable'] },
        { key: 'leads', label: 'Leads', kind: 'number', min: 0 },
      ],
    },
    { key: 'consent_recorded', label: 'Consent to be contacted is recorded for each lead', kind: 'boolean', control: 'switch', section: 'contact', tier: 'situational' },
    { key: 'sender_registered', label: 'The sender is registered with the telecom operators', kind: 'boolean', control: 'switch', section: 'contact', tier: 'situational' },
    { key: 'templates_registered', label: 'Message templates are registered', kind: 'boolean', control: 'switch', section: 'contact', tier: 'situational', required: false },
  ],
  rules: [
    above('days_since_read', 7, 'The counts were last read {a} ago.', 'low'),
    { kind: 'at_most', fields: ['visits', 'enquiries'], say: '{a} site visits are recorded against {b} enquiries.', severity: 'low' },
    { kind: 'require_if', fields: ['consent_recorded', 'sender_registered'], when: { situation: 'leads_contacted_by_phone_or_message' }, say: 'Leads are called or messaged and whether the sender is registered is not answered.', severity: 'medium' },
  ],
};

const PARTNERS_SET: FieldSet = {
  id: PARTNERS,
  fn: SALES,
  title: 'Channel partners',
  v: 1,
  records: { of: 'channel partner', titleField: 'party', summaryFields: ['registration_found', 'valid_to'] },
  sections: [
    { key: 'registration', label: 'Registration as an agent' },
    { key: 'terms', label: 'Terms' },
    { key: 'more', label: 'More', tier: 'expert' },
  ],
  fields: [
    { key: 'party', label: 'Partner', kind: 'ref', target: 'party', section: 'registration', from: 'Empanelment letter' },
    { key: 'registration_no', label: 'Agent registration number', kind: 'text', section: 'registration', proof: 'expected', from: 'Agent registration certificate', fromTypes: ['RERA agent registration certificate'], factKey: 'agent_registration_number' },
    { key: 'valid_to', label: 'Registration valid to', kind: 'date', section: 'registration', expires: { leadDays: 60 }, from: 'Agent registration certificate', fromTypes: ['RERA agent registration certificate'] },
    paper('certificate', 'Registration certificate', { section: 'registration' }),
    {
      key: 'registration_found',
      label: 'On the regulator’s agent list',
      kind: 'enum',
      control: 'segmented',
      options: ['registered', 'not found', 'revoked'],
      section: 'registration',
      from: 'The regulator’s agent search',
      hint: 'Looked up by number, with the day it was read.',
    },
    paper('empanelment', 'Empanelment letter', { section: 'terms' }),
    { key: 'empanelled_from', label: 'Empanelled from', kind: 'date', section: 'terms', from: 'Empanelment letter', fromTypes: ['Empanelment letter'] },
    { key: 'brokerage_on', label: 'Brokerage is a share of', kind: 'enum', control: 'segmented', options: ['agreement value', 'basic sale price', 'all-inclusive consideration'], section: 'terms', from: 'Empanelment letter' },
    { key: 'payable_when', label: 'Payable when', kind: 'enum', control: 'segmented', options: ['booking confirmed', 'agreement registered', 'a share of the price is collected'], section: 'terms', from: 'Empanelment letter' },
    {
      key: 'payable_after_pct',
      label: 'Share of the price to be collected first',
      kind: 'percent',
      max: 100,
      section: 'terms',
      tier: 'situational',
      showWhen: { field: at(SALES, PARTNERS, 'payable_when'), is: 'equals', value: 'a share of the price is collected' },
      from: 'Empanelment letter',
    },
    {
      key: 'slabs',
      label: 'Brokerage slabs',
      kind: 'table',
      section: 'more',
      tier: 'expert',
      required: false,
      from: 'Empanelment letter',
      columns: [
        { key: 'sales_from', label: 'From sale', kind: 'number', min: 1 },
        { key: 'sales_to', label: 'To sale', kind: 'number', min: 1, required: false },
        { key: 'rate_pct', label: 'Rate', kind: 'percent', max: 100 },
      ],
    },
    { key: 'empanelled_to', label: 'Empanelled to', kind: 'date', section: 'more', tier: 'expert', required: false },
    { key: 'clawback', label: 'Brokerage is recovered if the sale is cancelled within', kind: 'duration', unit: 'days', section: 'more', tier: 'expert', required: false, from: 'Empanelment letter' },
    { key: 'lead_validity', label: 'A lead stays with the partner for', kind: 'duration', unit: 'days', section: 'more', tier: 'expert', required: false, from: 'Empanelment letter' },
  ],
  rules: [
    { kind: 'before', fields: ['empanelled_from', 'valid_to'], say: 'Empanelled from {a}, after the agent registration ran out on {b}.', severity: 'high' },
    { kind: 'require', fields: ['registration_no'], say: 'No agent registration number is recorded for this partner. An agent may not sell in a registered project without one.', severity: 'high' },
    { kind: 'require_if', fields: ['registration_found', 'certificate'], whenIn: ['not found', 'revoked'], say: 'The regulator’s list says {a} and no registration certificate is on file.', severity: 'high' },
  ],
};

const BROKERAGE_SET: FieldSet = {
  id: BROKERAGE,
  fn: SALES,
  title: 'Brokerage',
  v: 1,
  sections: [{ key: 'brokerage', label: 'Brokerage', showWhen: { situation: 'channel_partners_engaged' } }],
  fields: [
    workedCount('partners', 'Channel partners', ofAny(PARTNERS, 'party', { op: 'records', set: PARTNERS, reduce: 'count', field: 'party' }), { section: 'brokerage' }),
    workedMoney('expected', 'Brokerage the sales give', ofAny(PARTNERS, 'party', sumOf(UNITS, 'sale_brokerage_expected')), { section: 'brokerage' }),
    workedMoney('invoiced', 'Brokerage invoiced', ofAny(PARTNERS, 'party', sumOf(BROKERAGE_INVOICES, 'amount')), { section: 'brokerage' }),
    workedMoney('paid', 'Brokerage paid', ofAny(PARTNERS, 'party', sumWhere(BROKERAGE_INVOICES, 'amount', { column: 'paid_on', is: 'set' })), { section: 'brokerage' }),
    workedMoney('unpaid', 'Invoiced and not paid', minus(f('invoiced'), f('paid')), { section: 'brokerage' }),
    {
      key: 'brokerage_standing',
      label: 'Invoices against the sales',
      kind: 'status',
      section: 'brokerage',
      cases: [{ when: { kind: 'at_most', fields: ['invoiced', 'expected'], say: 'Brokerage invoiced is {a}; the sales give {b}.', severity: 'medium' }, label: 'Invoiced above what the sales give', tone: 'warning' }],
      otherwise: { label: 'Within what the sales give', tone: 'good' },
    },
  ],
  rules: [{ kind: 'at_most', fields: ['invoiced', 'expected'], say: 'Brokerage invoiced is {a}; the sales recorded give {b}.', severity: 'medium' }],
};

const BROKERAGE_INVOICES_SET: FieldSet = {
  id: BROKERAGE_INVOICES,
  fn: SALES,
  title: 'Brokerage invoices',
  v: 1,
  records: { of: 'brokerage invoice', titleField: 'invoice_no', summaryFields: ['partner', 'amount', 'paid_on'] },
  fields: [
    { key: 'invoice_no', label: 'Invoice number', kind: 'text', from: 'Brokerage invoice', fromTypes: ['Brokerage invoice'], factKey: 'invoice_number' },
    { key: 'partner', label: 'Partner', kind: 'ref', target: { set: PARTNERS } },
    { key: 'unit', label: 'For the sale of', kind: 'ref', target: 'unit' },
    money('amount', 'Amount before tax', { from: 'Brokerage invoice', fromTypes: ['Brokerage invoice'], factKey: 'taxable_value', proof: 'expected' }),
    { key: 'invoiced_on', label: 'Invoiced on', kind: 'date', from: 'Brokerage invoice', fromTypes: ['Brokerage invoice'], factKey: 'invoice_date' },
    { key: 'paid_on', label: 'Paid on', kind: 'date', required: false, from: 'Bank statement' },
    paper('invoice', 'Invoice'),
  ],
  rules: [{ kind: 'before', fields: ['invoiced_on', 'paid_on'], say: 'Paid on {b}, before the invoice of {a}.', severity: 'medium' }],
};

/* ==================================================================== */
/* Collections: plans, demands, dues, cancellations                      */
/* ==================================================================== */

const PLANS_SET: FieldSet = {
  id: PLANS,
  fn: BUYERS,
  title: 'Payment plans',
  v: 1,
  records: { of: 'payment plan', titleField: 'name', summaryFields: ['kind', 'stages_total_pct', 'plan_standing'] },
  fields: [
    { key: 'name', label: 'Plan', kind: 'text', from: 'Approved plans' },
    { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', optionSet: 'sales_plan_kind' },
    { key: 'valid_from', label: 'Offered from', kind: 'date' },
    { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party' },
    {
      key: 'stages',
      label: 'Stages',
      kind: 'table',
      from: 'Agreement for sale, payment schedule',
      columns: [
        { key: 'stage_no', label: 'Stage', kind: 'number', min: 1 },
        { key: 'milestone', label: 'Falls due on', kind: 'ref', target: 'milestone', required: false },
        { key: 'pct', label: 'Share of the agreed value', kind: 'percent', max: 100 },
        { key: 'days_to_pay', label: 'Days to pay', kind: 'duration', unit: 'days', required: false },
        { key: 'before_agreement', label: 'Before the agreement', kind: 'boolean', control: 'checkbox' },
      ],
    },
    workedShare('stages_total_pct', 'The stages add to', { op: 'sum', table: 'stages', column: 'pct' }),
    workedShare('before_agreement_pct', 'Asked before the registered agreement', { op: 'sum_if', over: { table: 'stages' }, column: 'pct', where: { column: 'before_agreement', is: 'true' } }),
    workedShare('advance_cap_pct', 'Cap on what may be asked before the agreement', once('stages', rate('rera_advance_before_agreement_max'))),
    {
      key: 'plan_standing',
      label: 'Plan',
      kind: 'status',
      cases: [
        { when: { kind: 'compare', fields: ['stages_total_pct'], against: 100, tolerance: 0, say: 'The stages add to {a}, not {b}.', severity: 'high' }, label: 'Does not add up', tone: 'critical' },
        { when: { kind: 'at_most', fields: ['before_agreement_pct', 'advance_cap_pct'], say: 'The plan asks {a} before the registered agreement; the cap is {b}.', severity: 'critical' }, label: 'Asks too much before the agreement', tone: 'critical' },
      ],
      otherwise: { label: 'In order', tone: 'good' },
    },
    { key: 'valid_to', label: 'Offered until', kind: 'date', tier: 'expert', required: false },
    {
      key: 'interest_borne_until',
      label: 'The promoter bears the buyer’s interest until',
      kind: 'date',
      tier: 'situational',
      showWhen: { field: at(BUYERS, PLANS, 'kind'), is: 'equals', value: 'subvention' },
      from: 'Approved plans',
    },
  ],
  rules: [
    { kind: 'compare', fields: ['stages_total_pct'], against: 100, tolerance: 0, say: 'The stages add to {a}, not {b}.', severity: 'high' },
    { kind: 'at_most', fields: ['before_agreement_pct', 'advance_cap_pct'], say: 'The plan asks {a} before the registered agreement; the cap is {b}.', severity: 'critical' },
    { kind: 'before', fields: ['valid_from', 'valid_to'], say: 'Offered until {b}, before it is offered from {a}.', severity: 'low' },
  ],
};

const DEMANDS_SET: FieldSet = {
  id: DEMANDS,
  fn: BUYERS,
  title: 'Demands',
  v: 1,
  records: { of: 'demand', titleField: 'demand_no', summaryFields: ['unit', 'outstanding', 'demand_standing'] },
  optionSets: [{ id: 'sales_receipt_mode', label: 'Paid by', options: options(['cheque', 'bank transfer', 'UPI', 'loan disbursement', 'tax deducted by the buyer']) }],
  sections: [
    { key: 'demand', label: 'Demand' },
    { key: 'stage', label: 'The stage it is raised on' },
    { key: 'received', label: 'Received against it' },
    { key: 'interest', label: 'Interest' },
  ],
  fields: [
    { key: 'demand_no', label: 'Demand number', kind: 'text', section: 'demand', from: 'Demand letter', fromTypes: ['Demand letter'], factKey: 'demand_number' },
    { key: 'unit', label: 'Unit', kind: 'ref', target: 'unit', section: 'demand' },
    { key: 'raised_on', label: 'Raised on', kind: 'date', section: 'demand', from: 'Demand letter', fromTypes: ['Demand letter'], factKey: 'demand_date' },
    { key: 'due_on', label: 'Due on', kind: 'date', section: 'demand', from: 'Demand letter', fromTypes: ['Demand letter'], factKey: 'due_date' },
    money('principal', 'Demanded, before tax', { section: 'demand', proof: 'expected', from: 'Demand letter', fromTypes: ['Demand letter'], factKey: 'principal' }),
    paper('stage_certificate', 'Stage completion certificate', { section: 'stage', from: 'Architect’s or engineer’s certificate' }),
    { key: 'certified_on', label: 'Stage certified on', kind: 'date', section: 'stage', required: false, from: 'Architect’s or engineer’s certificate', fromTypes: ['Stage completion certificate'] },
    {
      key: 'settled_by',
      label: 'Receipts set against this demand',
      kind: 'table',
      section: 'received',
      required: false,
      from: 'Receipt book and bank statement',
      columns: [
        { key: 'receipt_no', label: 'Receipt', kind: 'text' },
        { key: 'received_on', label: 'Received on', kind: 'date' },
        money('amount', 'Amount'),
        { key: 'mode', label: 'Paid by', kind: 'enum', optionSet: 'sales_receipt_mode' },
      ],
    },
    workedMoney('received', 'Received', orNone({ op: 'sum', table: 'settled_by', column: 'amount' }), { section: 'received' }),
    workedMoney('outstanding', 'Outstanding', minus(f('principal'), f('received')), { section: 'received' }),
    worked('days_past_due', 'Days past the due date', minus({ op: 'today' }, { op: 'date', key: 'due_on' }), { section: 'received', unit: 'days', precision: 0 }),
    {
      key: 'demand_standing',
      label: 'Demand',
      kind: 'status',
      section: 'received',
      cases: [
        { when: below('outstanding', 0.5, 'Nothing is outstanding.', 'low'), label: 'Paid', tone: 'good' },
        { when: above('days_past_due', 0, 'It is {a} past its due date.', 'high'), label: 'Overdue', tone: 'critical' },
      ],
      otherwise: { label: 'Not yet due', tone: 'neutral' },
    },
    workedMoney(
      'interest_accrued',
      'Interest on the delay',
      {
        op: 'if',
        when: { all: [{ left: f('days_past_due'), is: 'gt', right: n(0) }, { left: f('outstanding'), is: 'gt', right: n(0.5) }] },
        then: times(times(f('outstanding'), over(f('interest_rate', INTEREST_RATE), n(100))), over(f('days_past_due'), n(365))),
        else: n(0),
      },
      { section: 'interest' },
    ),
    money('interest_waived', 'Interest waived', { section: 'interest', tier: 'expert', required: false, from: 'Approval note' }),
    { key: 'waived_by', label: 'Waiver approved by', kind: 'ref', target: 'party', section: 'interest', tier: 'situational', showWhen: { field: at(BUYERS, DEMANDS, 'interest_waived'), is: 'set' } },
  ],
  rules: [
    { kind: 'before', fields: ['certified_on', 'raised_on'], say: 'Raised on {b}, before the stage was certified on {a}.', severity: 'high' },
    { kind: 'before', fields: ['raised_on', 'due_on'], say: 'Due on {b}, before it was raised on {a}.', severity: 'medium' },
    { kind: 'require', fields: ['stage_certificate'], say: 'No stage completion certificate is cited for this demand.', severity: 'medium' },
    { kind: 'at_most', fields: ['interest_waived', 'interest_accrued'], say: 'Interest waived is {a}; {b} has accrued.', severity: 'medium' },
  ],
};

const COLLECTIONS_SET: FieldSet = {
  id: COLLECTIONS,
  fn: BUYERS,
  title: 'Collections',
  v: 1,
  situations: [
    {
      key: 'buyer_in_default',
      label: 'A demand is overdue',
      scope: 'function',
      derive: { records: DEMANDS, is: 'any', where: { column: 'demand_standing', is: 'equals', value: 'Overdue' } },
    },
  ],
  sections: [
    { key: 'totals', label: 'Demanded and received' },
    { key: 'interest', label: 'Interest on delay' },
    { key: 'stages', label: 'Demands against milestones' },
    { key: 'default', label: 'Reminders and notices', showWhen: { situation: 'buyer_in_default' } },
  ],
  fields: [
    workedMoney('demanded', 'Demanded to date', sumOf(DEMANDS, 'principal'), { section: 'totals' }),
    workedMoney('received', 'Received to date', sumOf(DEMANDS, 'received'), { section: 'totals' }),
    workedMoney('outstanding', 'Outstanding', minus(f('demanded'), f('received')), { section: 'totals' }),
    workedShare('efficiency_pct', 'Collected, of what was demanded', share(f('received'), f('demanded')), { section: 'totals' }),
    { key: 'lending_rate', label: 'State Bank of India’s highest marginal cost of lending rate', kind: 'percent', max: 100, precision: 2, section: 'interest', from: 'State Bank of India, published rates', hint: 'A year. Read from the bank’s page, with the day it was read.' },
    worked('interest_rate', 'Interest rate on delay, a year', add(f('lending_rate'), rate('rera_delay_interest_spread')), { section: 'interest', unit: '%', precision: 2, hint: 'The same rate runs against the promoter and the allottee.' }),
    workedMoney('interest_accrued', 'Interest accrued on overdue demands', sumOf(DEMANDS, 'interest_accrued'), { section: 'interest' }),
    {
      key: 'demands_to_milestones',
      label: 'Demands against milestones',
      kind: 'table',
      display: 'match',
      section: 'stages',
      required: false,
      columns: [
        { key: 'demand', label: 'Demand', kind: 'ref', target: { set: DEMANDS } },
        { key: 'milestone', label: 'Milestone', kind: 'ref', target: 'milestone' },
      ],
      match: {
        left: { column: 'demand', label: 'Demands', of: { records: DEMANDS, field: 'demand_no' } },
        right: { column: 'milestone', label: 'Milestones', of: { target: 'milestone' } },
      },
    },
    {
      key: 'notices',
      label: 'Reminders and notices served',
      kind: 'table',
      display: 'timeline',
      section: 'default',
      tier: 'situational',
      required: false,
      from: 'Filed letters',
      columns: [
        { key: 'kind', label: 'Letter', kind: 'enum', options: ['reminder', 'notice of default', 'intimation of termination'] },
        { key: 'served_on', label: 'Served on', kind: 'date' },
        { key: 'unit', label: 'Unit', kind: 'ref', target: 'unit' },
      ],
    },
  ],
  rules: [
    { kind: 'require', fields: ['lending_rate'], when: { situation: 'buyer_in_default' }, say: 'A demand is overdue and the bank’s lending rate is not recorded, so no interest on the delay can be worked out.', severity: 'medium' },
    { kind: 'row_missing', fields: ['notices'], column: 'served_on', when: { situation: 'buyer_in_default' }, say: '{row}: the day it was served is not recorded.', severity: 'low' },
  ],
};

const overdueOlderThan = (days: number): CheckFormula => sumWhere(DEMANDS, 'outstanding', { column: 'days_past_due', is: 'gt', value: days });

const DUES_SET: FieldSet = {
  id: DUES,
  fn: BUYERS,
  title: 'Dues by age',
  v: 1,
  sections: [
    { key: 'overdue', label: 'Overdue' },
    { key: 'coming', label: 'Coming due' },
    { key: 'refunds', label: 'Refunds' },
  ],
  fields: [
    workedMoney('overdue', 'Overdue', overdueOlderThan(0), { section: 'overdue' }),
    workedMoney('overdue_first_month', 'Overdue, in the first month', minus(overdueOlderThan(0), overdueOlderThan(30)), { section: 'overdue' }),
    workedMoney('overdue_second_month', 'Overdue, in the second month', minus(overdueOlderThan(30), overdueOlderThan(60)), { section: 'overdue' }),
    workedMoney('overdue_third_month', 'Overdue, in the third month', minus(overdueOlderThan(60), overdueOlderThan(90)), { section: 'overdue' }),
    workedMoney('overdue_beyond', 'Overdue beyond three months', overdueOlderThan(90), { section: 'overdue' }),
    workedMoney('due_within_month', 'Falling due within a month', minus(overdueOlderThan(-31), overdueOlderThan(0)), { section: 'coming' }),
    workedMoney('refunds_outstanding', 'Refunds still to pay', sumWhere(CANCELLATIONS, 'refund_due', { column: 'refund_days_left', is: 'set' }), { section: 'refunds' }),
    workedCount('refunds_overdue', 'Refunds past the day they were due', countWhere(CANCELLATIONS, { column: 'refund_standing', is: 'equals', value: 'Refund overdue' }), { section: 'refunds' }),
    {
      key: 'dues_standing',
      label: 'Dues',
      kind: 'status',
      section: 'refunds',
      cases: [
        { when: above('refunds_overdue', 0, '{a} refund(s) are past the day they were due.', 'critical'), label: 'A refund is overdue', tone: 'critical' },
        { when: above('overdue_beyond', 0, '{a} of demands is overdue beyond three months.', 'high'), label: 'Dues older than three months', tone: 'warning' },
      ],
    },
  ],
  rules: [
    above('refunds_overdue', 0, '{a} refund(s) are past the day the terms give to pay them.', 'critical'),
    above('overdue_beyond', 0, '{a} of demands is overdue beyond three months.', 'high'),
  ],
};

const PROMOTER_AT_FAULT = ['possession_delayed', 'registration_suspended_or_revoked', 'false_statement_in_an_advertisement'];

const CANCELLATIONS_SET: FieldSet = {
  id: CANCELLATIONS,
  fn: BUYERS,
  title: 'Cancellations and refunds',
  v: 1,
  records: { of: 'cancellation', titleField: 'unit', summaryFields: ['cancelled_by', 'refund_due', 'refund_standing'] },
  optionSets: [
    {
      id: 'sales_cancel_reason',
      label: 'Reason',
      options: options([
        'allottee’s request',
        'allottee’s payment default',
        'agreement not registered in time',
        'possession delayed',
        'registration suspended or revoked',
        'false statement in an advertisement',
        'loan refused',
        'force majeure',
      ]),
    },
    {
      id: 'sales_cancel_stage',
      label: 'Stage of the sale',
      options: [
        { key: 'before_agreement', label: 'Before the registered agreement', tone: 'info' },
        { key: 'after_agreement', label: 'After the registered agreement', tone: 'warning' },
      ],
    },
  ],
  sections: [
    { key: 'request', label: 'Cancellation' },
    { key: 'deduction', label: 'What may be deducted' },
    { key: 'refund', label: 'Refund' },
  ],
  fields: [
    { key: 'unit', label: 'Unit', kind: 'ref', target: 'unit', section: 'request' },
    { key: 'cancelled_by', label: 'Cancelled by', kind: 'enum', control: 'segmented', options: ['allottee', 'promoter'], section: 'request', from: 'Cancellation letter' },
    { key: 'reason', label: 'Reason', kind: 'enum', optionSet: 'sales_cancel_reason', section: 'request', from: 'Cancellation letter' },
    paper('letter', 'Cancellation letter or notice', { section: 'request' }),
    { key: 'requested_on', label: 'Received on', kind: 'date', section: 'request', from: 'Cancellation letter', fromTypes: ['Cancellation letter'], factKey: 'received_on' },
    { key: 'stage', label: 'Stage of the sale', kind: 'enum', control: 'tiles', optionSet: 'sales_cancel_stage', section: 'request', hint: 'Which terms apply: the allotment letter’s before the agreement is registered, the agreement’s after.' },

    { key: 'allotted_on', label: 'Allotment letter dated', kind: 'date', section: 'deduction', tier: 'situational', showWhen: { field: at(BUYERS, CANCELLATIONS, 'stage'), is: 'equals', value: 'before_agreement' }, from: 'Allotment letter' },
    worked('days_from_allotment', 'Days from the allotment letter', { op: 'days_between', left: 'requested_on', right: 'allotted_on' }, { section: 'deduction', unit: 'days', precision: 0, showWhen: { field: at(BUYERS, CANCELLATIONS, 'stage'), is: 'equals', value: 'before_agreement' } }),
    workedShare('deduction_allowed_pct', 'Deduction allowed, of the unit’s cost', rate('rera_cancel_deduction', { days_from_allotment: { field: 'days_from_allotment' } }), { section: 'deduction', showWhen: { field: at(BUYERS, CANCELLATIONS, 'stage'), is: 'equals', value: 'before_agreement' } }),
    money('booking_amount', 'Booking amount in the agreement', { section: 'deduction', tier: 'situational', showWhen: { field: at(BUYERS, CANCELLATIONS, 'stage'), is: 'equals', value: 'after_agreement' }, from: 'Agreement for sale' }),
    money('unit_cost', 'Cost of the unit', { section: 'deduction', from: 'Allotment letter', hint: 'The agreed value, as the allotment letter or the agreement states it.' }),
    money('received', 'Received from the buyer', { section: 'deduction', from: 'Statement of account' }),
    workedMoney(
      'most_deductible',
      'Most that may be deducted',
      {
        op: 'if',
        when: { field: 'reason', is: 'in', value: PROMOTER_AT_FAULT },
        then: n(0),
        else: {
          op: 'if',
          when: { field: 'reason', is: 'equals', value: 'agreement_not_registered_in_time' },
          then: { op: 'min', of: [times(f('unit_cost'), over(rate('rera_forfeit_no_agreement_max'), n(100))), f('received')] },
          else: {
            op: 'if',
            when: { field: 'stage', is: 'equals', value: 'before_agreement' },
            then: { op: 'min', of: [times(f('unit_cost'), over(f('deduction_allowed_pct'), n(100))), f('received')] },
            else: f('booking_amount'),
          },
        },
      },
      { section: 'deduction' },
    ),
    money('deducted', 'Deducted', { section: 'deduction', from: 'Approval note' }),

    workedMoney('refund_due', 'Refund due', minus(f('received'), f('deducted')), { section: 'refund' }),
    workedDay('refund_due_by', 'Refund due by', { op: 'add_days', date: { op: 'date', key: 'requested_on' }, days: rate('rera_refund_within_days', { stage: { field: 'stage' } }) }, { section: 'refund' }),
    { key: 'refunded_on', label: 'Refund paid on', kind: 'date', section: 'refund', required: false, from: 'Bank statement' },
    worked('refund_days_left', 'Days left to refund', until('refunded_on', minus({ op: 'date', key: 'refund_due_by' }, { op: 'today' })), { section: 'refund', unit: 'days', precision: 0 }),
    {
      key: 'refund_standing',
      label: 'Refund',
      kind: 'status',
      section: 'refund',
      cases: [
        { when: below('refund_days_left', 0, 'The refund is past the day it was due.', 'critical'), label: 'Refund overdue', tone: 'critical' },
        { when: below('refund_days_left', 15, 'The refund is due in {a}.', 'medium'), label: 'Refund due soon', tone: 'warning' },
      ],
      otherwise: { label: 'In time', tone: 'good' },
    },
    workedMoney(
      'refund_late_interest',
      'Interest for a late refund',
      {
        op: 'if',
        when: { left: f('refund_days_left'), is: 'lt', right: n(0) },
        then: times(times(f('refund_due'), over(f('interest_rate', INTEREST_RATE), n(100))), over(minus(n(0), f('refund_days_left')), n(365))),
        else: n(0),
      },
      { section: 'refund' },
    ),
  ],
  rules: [
    { kind: 'at_most', fields: ['deducted', 'most_deductible'], say: 'Deducted {a}; the most the terms allow is {b}.', severity: 'critical' },
    { kind: 'before', fields: ['allotted_on', 'requested_on'], say: 'The cancellation was received on {b}, before the allotment letter of {a}.', severity: 'medium' },
    { kind: 'before', fields: ['requested_on', 'refunded_on'], say: 'Refunded on {b}, before the cancellation was received on {a}.', severity: 'medium' },
    below('refund_days_left', 0, 'The refund is past the day it was due and is not recorded as paid.', 'critical'),
  ],
};

/* ==================================================================== */
/* Handover: possession, snags, the defect liability period              */
/* ==================================================================== */

const SITUATION_HANDOVER = {
  key: 'handover_and_conveyance',
  label: 'Occupancy certificate issued',
  scope: 'project' as const,
  derive: { field: OC_ISSUED, is: 'true' as const },
};

const POSSESSION_SET: FieldSet = {
  id: POSSESSION,
  fn: HANDOVER,
  title: 'Handover',
  v: 1,
  situations: [SITUATION_HANDOVER],
  sections: [
    { key: 'certificate', label: 'Occupancy certificate' },
    { key: 'units', label: 'Possession' },
    { key: 'defects', label: 'Snags and defects' },
  ],
  fields: [
    { key: 'oc_issued', label: 'Occupancy certificate issued', kind: 'boolean', section: 'certificate', sameAs: OC_ISSUED, required: false },
    { key: 'oc_date', label: 'Date of the certificate', kind: 'date', section: 'certificate', sameAs: OC_DATE, required: false },
    workedDay('offer_due', 'Possession to be offered by', { op: 'add_months', date: { op: 'date', key: 'oc_date' }, months: rate('rera_possession_offer_within_months') }, { section: 'certificate' }),
    workedDay('conveyance_due', 'Sale deeds to be registered by', { op: 'add_months', date: { op: 'date', key: 'oc_date' }, months: rate('rera_conveyance_months') }, { section: 'certificate' }),
    workedCount('units_offered', 'Possession offered', countWhere(UNITS, { column: 'handover_offered_on', is: 'set' }), { section: 'units' }),
    workedCount('units_to_offer', 'Sold, with possession still to offer', once('oc_date', minus(f('units_sold', at(SALES, STOCK, 'units_sold')), f('units_offered'))), { section: 'units' }),
    workedCount('units_handed_over', 'Handed over', countWhere(UNITS, { column: 'sale_status', is: 'equals', value: UNIT_STATUS.handedOver }), { section: 'units' }),
    workedMoney('delay_interest', 'Interest owed to buyers for late possession', sumOf(UNITS, 'handover_delay_interest'), { section: 'units' }),
    workedCount('snags_open', 'Snags open, per the site', { op: 'records', set: SNAGS, reduce: 'sum', field: 'open' }, { section: 'defects' }),
    workedCount('requests_open', 'Service requests open', countWhere(REQUESTS, { column: 'days_left', is: 'set' }), { section: 'defects' }),
    workedCount('requests_overdue', 'Defects past the time to rectify', countWhere(REQUESTS, { column: 'request_standing', is: 'equals', value: 'Past the time to rectify' }), { section: 'defects' }),
    {
      key: 'handover_standing',
      label: 'Handover',
      kind: 'status',
      section: 'defects',
      cases: [
        { when: above('requests_overdue', 0, '{a} defect(s) are past the time the Act gives to rectify them.', 'critical'), label: 'A defect is past its time', tone: 'critical' },
        { when: above('units_to_offer', 0, 'Possession is still to be offered on {a} unit(s) sold.', 'medium'), label: 'Possession still to be offered', tone: 'warning' },
      ],
    },
  ],
  rules: [
    above('requests_overdue', 0, '{a} defect(s) are past the time the Act gives to rectify them.', 'critical'),
    above('units_to_offer', 0, 'Possession is still to be offered on {a} unit(s) sold.', 'medium'),
  ],
};

const UNIT_POSSESSION_SET: FieldSet = {
  id: UNIT_POSSESSION,
  fn: HANDOVER,
  title: 'A unit’s possession',
  v: 1,
  extends: UNITS,
  situations: [SITUATION_HANDOVER],
  sections: [{ key: 'possession', label: 'Possession', showWhen: { all: [{ situation: 'handover_and_conveyance' }, { field: unit('sale_allotted_on'), is: 'set' }] } }],
  fields: [
    paper('handover_offer_letter', 'Possession offer letter', { section: 'possession' }),
    paper('sale_possession_certificate', 'Possession certificate', { section: 'possession', from: 'Possession certificate' }),
    { key: 'handover_offered_on', label: 'Possession offered on', kind: 'date', section: 'possession', required: false, from: 'Possession offer letter' },
    money('handover_paid_by_buyer', 'Paid by the buyer to date', { section: 'possession', required: false, from: 'Statement of account' }),
    worked(
      'handover_days_late',
      'Days past the possession promised',
      orNone(minus({ op: 'if', when: isSet('handover_offered_on'), then: { op: 'date', key: 'handover_offered_on' }, else: { op: 'today' } }, { op: 'date', key: 'sale_possession_promised' })),
      { section: 'possession', unit: 'days', precision: 0 },
    ),
    workedMoney(
      'handover_delay_interest',
      'Interest owed for late possession',
      times(times(f('handover_paid_by_buyer'), over(f('interest_rate', INTEREST_RATE), n(100))), over(f('handover_days_late'), n(365))),
      { section: 'possession' },
    ),
    { key: 'handover_taken_on', label: 'Possession taken on', kind: 'date', section: 'possession', required: false, from: 'Possession certificate' },
    {
      key: 'handover_given',
      label: 'Handed to the buyer',
      kind: 'multi_enum',
      options: ['keys', 'electricity meter', 'water connection', 'copy of the occupancy certificate', 'unit plan as built', 'warranties', 'parking marked'],
      section: 'possession',
      required: false,
      from: 'Possession certificate',
    },
    workedDay('handover_liability_ends', 'Defect liability ends', { op: 'add_months', date: { op: 'date', key: 'handover_taken_on' }, months: rate('rera_defect_liability_months') }, { section: 'possession' }),
    {
      key: 'handover_standing',
      label: 'Possession',
      kind: 'status',
      section: 'possession',
      cases: [reached('handover_offered_on', 'handover_taken_on', 'Offered, not yet taken', 'warning'), reached('handover_taken_on', 'handover_given', 'Taken, handover list not ticked', 'warning')],
      otherwise: { label: 'Taken', tone: 'good' },
    },
  ],
  rules: [
    { kind: 'before', fields: ['handover_offered_on', 'handover_taken_on'], say: 'Possession was taken on {b}, before it was offered on {a}.', severity: 'medium' },
    above('handover_days_late', 0, 'Possession is {a} past the date the agreement promised.', 'high'),
    { kind: 'require_if', fields: ['handover_taken_on', 'sale_possession_certificate'], say: 'Possession is recorded as taken and no possession certificate is on file.', severity: 'medium' },
  ],
};

const DEFECT_CATEGORIES = options(['structural', 'seepage or waterproofing', 'plumbing', 'electrical', 'joinery', 'flooring and tiles', 'lift', 'common area', 'papers', 'account']);

const REQUESTS_SET: FieldSet = {
  id: REQUESTS,
  fn: HANDOVER,
  title: 'Service requests',
  v: 1,
  records: { of: 'service request', titleField: 'request_no', summaryFields: ['unit', 'category', 'request_standing'] },
  optionSets: [{ id: 'handover_defect_category', label: 'Category', options: DEFECT_CATEGORIES }],
  sections: [
    { key: 'request', label: 'Request' },
    { key: 'liability', label: 'Defect liability', showWhen: { field: at(HANDOVER, REQUESTS, 'in_liability_period'), is: 'true' } },
  ],
  fields: [
    { key: 'request_no', label: 'Request number', kind: 'text', section: 'request', from: 'Helpdesk or letter' },
    { key: 'unit', label: 'Unit', kind: 'ref', target: 'unit', section: 'request' },
    { key: 'category', label: 'Category', kind: 'enum', optionSet: 'handover_defect_category', section: 'request' },
    { key: 'raised_on', label: 'Raised on', kind: 'date', section: 'request', from: 'Helpdesk or letter' },
    { key: 'in_liability_period', label: 'Raised within the defect liability period', kind: 'boolean', control: 'switch', section: 'request', hint: 'Against the day the unit’s defect liability ends, on the unit.' },
    { key: 'contractor', label: 'Contractor responsible', kind: 'ref', target: 'party', section: 'request', required: false },
    { key: 'closed_on', label: 'Closed on', kind: 'date', section: 'request', required: false },
    paper('proof', 'Proof of the work done', { section: 'request', tier: 'expert' }),
    { key: 'note', label: 'Note', kind: 'longtext', maxLength: 300, section: 'request', tier: 'expert', required: false },
    workedDay('rectify_by', 'To be rectified by', { op: 'add_days', date: { op: 'date', key: 'raised_on' }, days: rate('rera_defect_rectify_within_days') }, { section: 'liability' }),
    worked('days_left', 'Days left to rectify', until('closed_on', minus({ op: 'date', key: 'rectify_by' }, { op: 'today' })), { section: 'liability', unit: 'days', precision: 0 }),
    {
      key: 'request_standing',
      label: 'Request',
      kind: 'status',
      section: 'liability',
      cases: [{ when: below('days_left', 0, 'It is past the day it was to be rectified by.', 'critical'), label: 'Past the time to rectify', tone: 'critical' }],
      otherwise: { label: 'Within time', tone: 'good' },
    },
  ],
  rules: [
    below('days_left', 0, 'It is past the day it was to be rectified by and is not recorded as closed.', 'critical'),
    { kind: 'before', fields: ['raised_on', 'closed_on'], say: 'Closed on {b}, before it was raised on {a}.', severity: 'low' },
  ],
};

/* ==================================================================== */
/* Marketing: the launch, the campaigns, every advertisement             */
/* ==================================================================== */

const LAUNCH_SET: FieldSet = {
  id: LAUNCH,
  fn: MARKETING,
  title: 'Launch',
  v: 1,
  optionSets: [
    {
      id: 'marketing_launch_kind',
      label: 'Kind of launch',
      options: [
        { key: 'launch', label: 'Launch', tone: 'info' },
        { key: 'phase_launch', label: 'Phase launch', tone: 'info' },
        { key: 'tower_release', label: 'New tower release', tone: 'neutral' },
        { key: 'relaunch', label: 'Relaunch', tone: 'warning' },
      ],
    },
  ],
  sections: [
    { key: 'launch', label: 'Launch' },
    { key: 'released', label: 'What is released' },
    { key: 'budget', label: 'Budget' },
    { key: 'ready', label: 'Ready to sell' },
    { key: 'more', label: 'More', tier: 'expert' },
  ],
  fields: [
    { key: 'kind', label: 'Kind of launch', kind: 'enum', control: 'tiles', optionSet: 'marketing_launch_kind', section: 'launch', hint: 'Nothing is advertised, marketed or booked before the project is registered.' },
    { key: 'launch_date', label: 'Launch date', kind: 'date', section: 'launch', from: 'Launch note' },
    { key: 'approved_by', label: 'Approved by', kind: 'ref', target: 'party', section: 'launch' },
    workedCount('units_released', 'Units released for sale', countWhere(UNITS, { column: 'sale_released', is: 'true' }), { section: 'released' }),
    workedMoney('value_released', 'Value released, at list price', sumWhere(UNITS, 'sale_list_price', { column: 'sale_released', is: 'true' }), { section: 'released' }),
    { key: 'price_list', label: 'Price list at launch', kind: 'text', section: 'released', sameAs: at(MARKET, PRICE_LIST, 'version'), required: false },
    {
      key: 'targets',
      label: 'Monthly targets',
      kind: 'table',
      display: 'chart',
      chart: { x: 'month', y: 'units', mark: 'bar' },
      section: 'released',
      from: 'Business plan',
      columns: [
        { key: 'month', label: 'Month', kind: 'date' },
        { key: 'units', label: 'Units', kind: 'number', min: 0 },
        money('value', 'Value', { required: false }),
        money('collections', 'Collections', { required: false }),
      ],
    },
    money('budget', 'Marketing budget', { section: 'budget', from: 'Approved budget', proof: 'expected' }),
    workedShare('budget_pct', 'Budget, of the development value', share(f('budget'), f('gdv', APPRAISAL_GDV)), { section: 'budget' }),
    { key: 'allowed_pct', label: 'Marketing allowed in the appraisal', kind: 'percent', section: 'budget', sameAs: APPRAISAL_MARKETING, required: false },
    {
      key: 'ready',
      label: 'In place before the first booking',
      kind: 'multi_enum',
      options: ['proforma allotment letter in the model form', 'proforma agreement in the model form', 'registration number on the site display board', 'sanctioned plans displayed at site', 'channel partners’ registrations checked'],
      section: 'ready',
    },
    { key: 'display_board', label: 'Site display board', kind: 'evidence', accepts: 'image', viewer: 'image', section: 'ready', tier: 'expert', required: false },
    {
      key: 'lender_approvals',
      label: 'Lenders that have approved the project',
      kind: 'table',
      section: 'more',
      tier: 'expert',
      required: false,
      from: 'Lender letters',
      columns: [
        { key: 'lender', label: 'Lender', kind: 'ref', target: 'party' },
        { key: 'reference', label: 'Approval reference', kind: 'text' },
        { key: 'on', label: 'Dated', kind: 'date' },
      ],
    },
  ],
  rules: [
    { kind: 'at_most', fields: ['budget_pct', 'allowed_pct'], say: 'The marketing budget is {a} of the development value; the appraisal allows {b}.', severity: 'medium' },
    { kind: 'require_if', fields: ['launch_date', 'approved_by'], say: 'A launch date of {a} is set and nobody is recorded as approving the launch.', severity: 'medium' },
  ],
};

const CAMPAIGNS_SET: FieldSet = {
  id: CAMPAIGNS,
  fn: MARKETING,
  title: 'Campaigns',
  v: 1,
  records: { of: 'campaign', titleField: 'name', summaryFields: ['channel', 'spent', 'spend_standing'] },
  sections: [
    { key: 'campaign', label: 'Campaign' },
    { key: 'spend', label: 'Spend' },
    { key: 'results', label: 'What it brought', showWhen: { field: at(MARKETING, CAMPAIGNS, 'starts_on'), is: 'set' } },
  ],
  fields: [
    { key: 'name', label: 'Campaign', kind: 'text', section: 'campaign', from: 'Media plan' },
    { key: 'channel', label: 'Channel', kind: 'enum', optionSet: 'marketing_channel', section: 'campaign', from: 'Media plan' },
    { key: 'agency', label: 'Agency or media owner', kind: 'ref', target: 'party', section: 'campaign', required: false, from: 'Release order' },
    { key: 'starts_on', label: 'Starts', kind: 'date', section: 'campaign', from: 'Media plan' },
    { key: 'ends_on', label: 'Ends', kind: 'date', section: 'campaign', from: 'Media plan' },
    { key: 'source_code', label: 'Source code in the CRM', kind: 'text', section: 'campaign', required: false, hint: 'What ties the CRM’s leads to this campaign.' },
    money('budget', 'Budget', { section: 'spend', from: 'Media plan' }),
    {
      key: 'invoices',
      label: 'Invoices',
      kind: 'table',
      section: 'spend',
      required: false,
      from: 'Agency and media invoices',
      columns: [
        { key: 'invoice_no', label: 'Invoice', kind: 'text' },
        { key: 'on', label: 'Dated', kind: 'date' },
        money('amount', 'Amount before tax'),
      ],
    },
    workedMoney('spent', 'Spent to date', orNone({ op: 'sum', table: 'invoices', column: 'amount' }), { section: 'spend' }),
    workedShare('spent_pct', 'Spent, of the budget', share(f('spent'), f('budget')), { section: 'spend' }),
    {
      key: 'spend_standing',
      label: 'Spend',
      kind: 'status',
      section: 'spend',
      cases: [
        { when: { kind: 'at_most', fields: ['spent', 'budget'], say: 'Spent {a} against a budget of {b}.', severity: 'high' }, label: 'Over budget', tone: 'critical' },
        { when: above('spent_pct', 80, 'Spend is {a} of the budget.', 'low'), label: 'Most of the budget is spent', tone: 'info' },
      ],
      otherwise: { label: 'Within budget', tone: 'good' },
    },
    { key: 'leads', label: 'Leads', kind: 'number', min: 0, precision: 0, section: 'results', required: false, from: 'CRM export' },
    { key: 'visits', label: 'Site visits', kind: 'number', min: 0, precision: 0, section: 'results', required: false, from: 'CRM export' },
    { key: 'sales', label: 'Sales credited', kind: 'number', min: 0, precision: 0, section: 'results', required: false, from: 'CRM export' },
    workedMoney('cost_per_lead', 'Cost of a lead', over(f('spent'), f('leads')), { section: 'results' }),
    workedMoney('cost_per_visit', 'Cost of a site visit', over(f('spent'), f('visits')), { section: 'results' }),
    workedMoney('cost_per_sale', 'Cost of a sale', over(f('spent'), f('sales')), { section: 'results' }),
  ],
  rules: [
    { kind: 'before', fields: ['starts_on', 'ends_on'], say: 'The campaign ends on {b}, before it starts on {a}.', severity: 'low' },
    { kind: 'at_most', fields: ['spent', 'budget'], say: 'Spent {a} against a budget of {b}.', severity: 'high' },
    { kind: 'at_most', fields: ['sales', 'visits'], say: '{a} sales are credited against {b} site visits.', severity: 'low' },
  ],
};

const SPEND_SET: FieldSet = {
  id: SPEND,
  fn: MARKETING,
  title: 'Marketing spend',
  v: 1,
  fields: [
    { key: 'budget', label: 'Marketing budget', kind: 'money', dimension: 'money', currency: 'INR', sameAs: at(MARKETING, LAUNCH, 'budget'), required: false },
    workedMoney('budgeted', 'Budgeted across campaigns', sumOf(CAMPAIGNS, 'budget')),
    workedMoney('spent', 'Spent across campaigns', sumOf(CAMPAIGNS, 'spent')),
    workedShare('spent_pct', 'Spent, of the marketing budget', share(f('spent'), f('budget'))),
    workedCount('leads', 'Leads', sumOf(CAMPAIGNS, 'leads')),
    workedCount('sales', 'Sales credited', sumOf(CAMPAIGNS, 'sales')),
    workedMoney('cost_per_lead', 'Cost of a lead', over(f('spent'), f('leads'))),
    workedMoney('cost_per_sale', 'Cost of a sale', over(f('spent'), f('sales'))),
    { key: 'credited_to', label: 'A sale is credited to', kind: 'enum', control: 'segmented', options: ['the first source', 'the last source'] },
    {
      key: 'spend_standing',
      label: 'Spend against the budget',
      kind: 'status',
      cases: [
        { when: { kind: 'at_most', fields: ['spent', 'budget'], say: 'Spent {a} against a marketing budget of {b}.', severity: 'high' }, label: 'Over the marketing budget', tone: 'critical' },
        { when: { kind: 'at_most', fields: ['budgeted', 'budget'], say: 'Campaigns are budgeted at {a} against a marketing budget of {b}.', severity: 'medium' }, label: 'Campaigns budgeted above the marketing budget', tone: 'warning' },
      ],
    },
  ],
  rules: [
    { kind: 'at_most', fields: ['spent', 'budget'], say: 'Spent {a} against a marketing budget of {b}.', severity: 'high' },
    { kind: 'at_most', fields: ['budgeted', 'budget'], say: 'Campaigns are budgeted at {a} against a marketing budget of {b}.', severity: 'medium' },
  ],
};

const PRINT_MEDIA = ['newspaper_or_magazine', 'brochure_or_prospectus', 'outdoor_hoarding', 'channel_partner_collateral'];

const ADVERTISEMENTS_SET: FieldSet = {
  id: ADVERTISEMENTS,
  fn: MARKETING,
  title: 'Advertisements',
  v: 1,
  records: { of: 'advertisement', titleField: 'reference', summaryFields: ['medium', 'verdict', 'measured'] },
  optionSets: [
    {
      id: 'marketing_ad_medium',
      label: 'Medium',
      options: options(['newspaper or magazine', 'outdoor hoarding', 'brochure or prospectus', 'website', 'property portal listing', 'social media', 'video', 'radio', 'SMS or messaging', 'email', 'site display board', 'channel partner collateral']),
    },
    {
      id: 'marketing_ad_verdict',
      label: 'Verdict',
      options: [
        { key: 'pass', label: 'Pass', tone: 'good' },
        { key: 'change_needed', label: 'Change needed', tone: 'warning' },
        { key: 'fail', label: 'Fail', tone: 'critical' },
      ],
    },
  ],
  sections: [
    { key: 'ad', label: 'Advertisement' },
    { key: 'number', label: 'Registration number' },
    { key: 'claims', label: 'What it states' },
    { key: 'check', label: 'Check' },
  ],
  fields: [
    { key: 'reference', label: 'Reference', kind: 'text', section: 'ad' },
    { key: 'medium', label: 'Medium', kind: 'enum', optionSet: 'marketing_ad_medium', section: 'ad' },
    { key: 'creative', label: 'The advertisement as released', kind: 'evidence', accepts: 'any', viewer: 'image', section: 'ad', proof: 'required' },
    { key: 'released_on', label: 'First released on', kind: 'date', section: 'ad', required: false, from: 'Release order' },
    { key: 'withdrawn_on', label: 'Withdrawn on', kind: 'date', section: 'ad', tier: 'expert', required: false },

    { key: 'number_matches', label: 'The number printed is the project’s, character for character', kind: 'boolean', control: 'tick', section: 'number', from: 'The advertisement against the registration certificate' },
    { key: 'number_position', label: 'Where the number sits', kind: 'enum', control: 'segmented', options: ['top right corner', 'elsewhere', 'spoken or sent', 'not given'], section: 'number', from: 'Measured on the advertisement' },
    { key: 'lettering_ratio', label: 'Number’s lettering against the project name’s', kind: 'number', min: 0, max: 5, precision: 2, section: 'number', required: false, from: 'Measured on the advertisement' },
    worked('lettering_least', 'Least the lettering may be', once('lettering_ratio', until('withdrawn_on', rate('rera_ad_lettering_ratio_min'))), { section: 'number', precision: 2 }),
    {
      key: 'block_pct',
      label: 'Registered block, the smaller of its share of length and of breadth',
      kind: 'percent',
      max: 100,
      precision: 1,
      section: 'number',
      tier: 'situational',
      showWhen: { field: at(MARKETING, ADVERTISEMENTS, 'medium'), is: 'in', value: PRINT_MEDIA },
      from: 'Measured on the advertisement',
    },
    workedShare('block_least', 'Least the registered block may be', once('block_pct', until('withdrawn_on', rate('rera_ad_registered_block_min'))), { section: 'number', showWhen: { field: at(MARKETING, ADVERTISEMENTS, 'medium'), is: 'in', value: PRINT_MEDIA } }),
    { key: 'website_shown', label: 'The Authority’s website is shown', kind: 'boolean', control: 'tick', section: 'number', from: 'The advertisement' },
    { key: 'change_disclaimer', label: 'Carries a “subject to change” disclaimer', kind: 'boolean', control: 'tick', section: 'number', from: 'The advertisement' },

    { key: 'area_basis', label: 'Areas are stated on', kind: 'enum', control: 'segmented', options: ['carpet only', 'carpet and super built-up', 'super built-up only', 'none stated'], section: 'claims', from: 'The advertisement' },
    money('lowest_price_stated', 'Lowest price stated', { section: 'claims', required: false, from: 'The advertisement' }),
    {
      key: 'claims',
      label: 'Amenities, specifications and approvals claimed',
      kind: 'table',
      section: 'claims',
      required: false,
      from: 'The advertisement',
      columns: [
        { key: 'claim', label: 'Claim, as printed', kind: 'text' },
        { key: 'kind', label: 'Kind', kind: 'enum', options: ['amenity', 'specification', 'approval', 'distance', 'possession date', 'return'] },
        { key: 'backed_by', label: 'Backed by', kind: 'enum', options: ['agreement schedule', 'sanctioned plan', 'a filed paper', 'nothing'] },
      ],
    },
    workedCount('claims_unbacked', 'Claims backed by nothing', { op: 'count_if', over: { table: 'claims' }, where: { column: 'backed_by', is: 'equals', value: 'nothing' } }, { section: 'claims' }),

    {
      key: 'measured',
      label: 'Measured checks',
      kind: 'status',
      section: 'check',
      // Each case holds while the advertisement is not withdrawn.
      cases: [
        reached('number_matches', 'withdrawn_on', 'Number is not the project’s', 'critical', ['false']),
        reached('number_position', 'withdrawn_on', 'Number not in its place', 'critical', ['elsewhere', 'not given']),
        { when: { kind: 'at_least', fields: ['lettering_ratio', 'lettering_least'], say: 'The number’s lettering is {a} of the project name’s; the least is {b}.', severity: 'high' }, label: 'Lettering too small', tone: 'critical' },
        { when: { kind: 'at_least', fields: ['block_pct', 'block_least'], say: 'The registered block is {a}; the least is {b}.', severity: 'high' }, label: 'Registered block too small', tone: 'critical' },
        reached('website_shown', 'withdrawn_on', 'Authority’s website not shown', 'critical', ['false']),
        reached('change_disclaimer', 'withdrawn_on', 'Carries a change disclaimer', 'critical', ['true']),
        reached('area_basis', 'withdrawn_on', 'Areas on super built-up only', 'warning', ['super built-up only']),
        { when: above('claims_unbacked', 0, '{a} claim(s) are backed by nothing.', 'high'), label: 'A claim is backed by nothing', tone: 'warning' },
      ],
      otherwise: { label: 'No measured check fails', tone: 'good' },
    },
    { key: 'verdict', label: 'Verdict', kind: 'enum', control: 'tiles', optionSet: 'marketing_ad_verdict', section: 'check', hint: 'A person decides. Not the person who made the advertisement.' },
    { key: 'checked_by', label: 'Checked by', kind: 'ref', target: 'party', section: 'check' },
  ],
  rules: [
    { kind: 'at_least', fields: ['lettering_ratio', 'lettering_least'], say: 'The registration number’s lettering is {a} of the project name’s; the circular asks for at least {b}.', severity: 'high' },
    { kind: 'at_least', fields: ['block_pct', 'block_least'], say: 'The registered block measures {a}; the circular asks for at least {b}.', severity: 'high' },
    above('claims_unbacked', 0, '{a} claim(s) in the advertisement are backed by neither the agreement’s schedules, the sanctioned plan nor a filed paper.', 'high'),
    { kind: 'at_least', fields: ['lowest_price_stated', 'lowest_list_price'], at: { lowest_list_price: at(SALES, STOCK, 'lowest_list_price') }, say: 'The lowest price stated is {a}; the lowest on the price list is {b}.', severity: 'high' },
    { kind: 'require_if', fields: ['released_on', 'verdict'], say: 'Released on {a} with no verdict recorded.', severity: 'high' },
    { kind: 'require_if', fields: ['verdict', 'checked_by'], say: 'A verdict of {a} is recorded and not who checked it.', severity: 'medium' },
  ],
};

const ADVERTISING_SET: FieldSet = {
  id: ADVERTISING,
  fn: MARKETING,
  title: 'Advertising compliance',
  v: 1,
  situations: [{ key: 'advertising_live', label: 'Advertisements on the register', scope: 'function', derive: { records: ADVERTISEMENTS, is: 'any' } }],
  sections: [
    { key: 'register', label: 'Register', showWhen: { situation: 'advertising_live' } },
    { key: 'exposure', label: 'What a contravention can cost', showWhen: { situation: 'advertising_live' } },
  ],
  fields: [
    workedCount('advertisements', 'Advertisements', ofAny(ADVERTISEMENTS, 'reference', { op: 'records', set: ADVERTISEMENTS, reduce: 'count', field: 'reference' }), { section: 'register' }),
    workedCount('passed', 'Passed', ofAny(ADVERTISEMENTS, 'reference', countWhere(ADVERTISEMENTS, { column: 'verdict', is: 'equals', value: 'pass' })), { section: 'register' }),
    workedCount('to_change', 'To change, or failed', ofAny(ADVERTISEMENTS, 'reference', countWhere(ADVERTISEMENTS, { column: 'verdict', is: 'in', value: ['change_needed', 'fail'] })), { section: 'register' }),
    workedCount('unchecked', 'With no verdict', minus(f('advertisements'), countWhere(ADVERTISEMENTS, { column: 'verdict', is: 'set' })), { section: 'register' }),
    {
      key: 'advertising_standing',
      label: 'Advertisements',
      kind: 'status',
      section: 'register',
      cases: [
        { when: above('to_change', 0, '{a} advertisement(s) are to change or have failed.', 'high'), label: 'An advertisement is to change', tone: 'critical' },
        { when: above('unchecked', 0, '{a} advertisement(s) have no verdict.', 'medium'), label: 'An advertisement is not checked', tone: 'warning' },
      ],
      otherwise: { label: 'All passed', tone: 'good' },
    },
    { key: 'project_cost', label: 'Estimated cost of the project', kind: 'money', unit: 'INR', section: 'exposure', sameAs: SANCTIONED_BUDGET, required: false },
    workedMoney('penalty_most', 'Most that may be levied for a contravening advertisement', ofAny(ADVERTISEMENTS, 'reference', times(f('project_cost'), over(rate('rera_penalty_contravention_max'), n(100)))), { section: 'exposure' }),
    workedMoney('penalty_most_unregistered', 'Most that may be levied for advertising before registration', ofAny(ADVERTISEMENTS, 'reference', times(f('project_cost'), over(rate('rera_penalty_unregistered_max'), n(100)))), { section: 'exposure' }),
  ],
  rules: [
    above('to_change', 0, '{a} advertisement(s) are marked to change or failed.', 'high'),
    above('unchecked', 0, '{a} advertisement(s) on the register have no verdict.', 'medium'),
  ],
};

/* ==================================================================== */
/* The catalog                                                           */
/* ==================================================================== */

/* ==================================================================== */
/* What Sales, Marketing, Collections and Handover read from others      */
/* ==================================================================== */

const RERA = (field: string): FieldAddress => ({ fn: 'legal.rera', set: 'legal.rera.registration', field });
const REGISTERED: ShowWhen = { situation: 'rera_registered' };

const LINKS: SetLinks[] = [
  // Nothing is advertised, launched or sold before the project is registered: the day is Legal's, and each date here is held to it.
  { set: LAUNCH, rules: [{ kind: 'before', fields: ['registered_on', 'launch_date'], at: { registered_on: RERA('registered_on') }, say: 'The launch is set for {b}, before the RERA registration of {a}.', severity: 'critical' }] },
  { set: ADVERTISEMENTS, rules: [{ kind: 'before', fields: ['registered_on', 'released_on'], at: { registered_on: RERA('registered_on') }, say: 'First released on {b}, before the RERA registration of {a}.', severity: 'critical' }] },
  {
    set: UNIT_AGREEMENT,
    rules: [
      { kind: 'before', fields: ['registered_on', 'sale_allotted_on'], at: { registered_on: RERA('registered_on') }, say: 'Allotted on {b}, before the RERA registration of {a}.', severity: 'critical' },
      { kind: 'before', fields: ['sale_possession_promised', 'declared_completion'], at: { declared_completion: RERA('declared_completion') }, when: REGISTERED, say: 'Possession is promised for {a}, after the completion of {b} declared to RERA.', severity: 'high' },
    ],
  },
  {
    set: UNIT_SALE,
    // Which side a unit falls to under a joint development is Legal's allocation. One allotted to the land owners is not the promoter's to sell.
    fields: [
      {
        key: 'sale_of_owners_unit',
        label: 'Released for sale though allotted to the land owners',
        kind: 'computed',
        precision: 0,
        section: 'sale',
        tier: 'expert',
        formula: { op: 'if', when: { all: [{ field: 'allotted_to', is: 'equals', value: 'owner' }, { field: 'sale_released', is: 'true' }] }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } },
      },
    ],
    rules: [{ kind: 'at_most', fields: ['sale_of_owners_unit'], against: 0, when: { situation: 'joint_development' }, say: 'This unit is allotted to the land owners under the joint development and is released for sale.', severity: 'high' }],
  },
  {
    set: STOCK,
    // An order in force that restrains a sale is Litigation's record; the unit count is held to the Architect's unit mix.
    fields: [
      { key: 'sale_restraints', label: 'Orders in force restraining a sale', kind: 'number', sameAs: { fn: 'legal.litigation', set: 'legal.litigation.diary', field: 'sale_restraints' }, required: false, section: 'stock', tier: 'situational', showWhen: { situation: 'litigation_pending' } },
    ],
    rules: [
      { kind: 'at_most', fields: ['sale_restraints'], against: 0, say: '{a} order(s) in force restrain a sale or its registration.', severity: 'critical' },
      { kind: 'compare', fields: ['units_total', 'units_designed'], at: { units_designed: { fn: 'design.brief', set: 'design.brief.sheet', field: 'units_total' } }, when: { records: 'design.brief.unit_types', is: 'any' }, tolerance: 0.001, say: 'The register holds {a} units and the Architect’s unit mix comes to {b}.', severity: 'medium' },
    ],
  },
  {
    set: CAMPAIGNS,
    fields: [{ key: 'contract', label: 'Contract with the agency', kind: 'ref', target: 'contract', required: false, tier: 'expert' }],
  },
  {
    set: POSSESSION,
    // The site hands a unit over before a buyer takes it: Technical's count is the ceiling on Handover's.
    rules: [{ kind: 'at_most', fields: ['units_handed_over', 'handed_by_site'], at: { handed_by_site: { fn: 'construction.quality', set: 'construction.quality.handover', field: 'units_handed' } }, when: { records: 'shared.units', is: 'any', where: { column: 'readiness', is: 'set' } }, say: '{a} unit(s) are recorded as taken by buyers and the site has handed over {b}.', severity: 'medium' }],
  },
  {
    set: UNIT_POSSESSION,
    fields: [{ key: 'handover_received_per_demands', label: 'Received on this unit, per Collections', kind: 'computed', dimension: 'money', currency: 'INR', section: 'possession', tier: 'expert', formula: { op: 'sum_if', over: { records: DEMANDS }, column: 'received', where: { column: 'unit', is: 'own' } } }],
    rules: [{ kind: 'compare', fields: ['handover_paid_by_buyer', 'handover_received_per_demands'], when: { records: DEMANDS, is: 'any' }, say: 'The buyer is taken to have paid {a} and Collections’ receipts on this unit come to {b}.', severity: 'medium' }],
  },
];

export const SALES_MARKETING_FIELD_SETS: FieldSet[] = withLinks(
  [
  // Market
  PRICE_LIST_SET,
  WATCH_SET,
  COMPETITORS_SET,
  // Marketing
  LAUNCH_SET,
  SPEND_SET,
  CAMPAIGNS_SET,
  ADVERTISING_SET,
  ADVERTISEMENTS_SET,
  // Sales
  STOCK_SET,
  BOOKINGS_SET,
  UNIT_SALE_SET,
  UNIT_AGREEMENT_SET,
  CUSTOMERS_SET,
  ENQUIRIES_SET,
  PARTNERS_SET,
  BROKERAGE_SET,
  BROKERAGE_INVOICES_SET,
  // Collections
  COLLECTIONS_SET,
  DUES_SET,
  DEMANDS_SET,
  PLANS_SET,
  CANCELLATIONS_SET,
  // Handover
  POSSESSION_SET,
  UNIT_POSSESSION_SET,
  REQUESTS_SET,
],
  LINKS,
);
