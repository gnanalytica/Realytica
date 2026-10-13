/**
 * Tender terms: what the client has to answer before a tender document can
 * be written, one record for each package being tendered.
 *
 * A consultant sends the client a form: who the consultants are, whether
 * there is earnest money and a mobilisation advance and on what terms, what
 * the client will supply, water and power on site, retention and security,
 * the type of contract and its periods, approved makes, the formats of the
 * guarantees, and the appendices. Most of its rows are not papers but
 * answers, so they are fields here, each of its own type, and the form is
 * read into them and written back out of them (`tender-form.ts`).
 *
 * The record itself holds what every tender has: the contract, its periods,
 * the damages and the payment terms, and three yes-or-no answers. Everything
 * that follows from a yes is a sheet of that record, opened only once the
 * answer is yes, so a tender with no advance, no earnest money and nothing
 * supplied by the client is a short sheet. What every tender also has but
 * nobody reads in one glance (the consultants, the site's water and power,
 * retention, makes and formats, the appendices) is a sheet each.
 *
 * These are the terms the tender offers. Once a contract is signed its own
 * terms are the contract's (`procurement.orders.terms`), entered from the
 * contract and never copied from here.
 */

import type { FieldSet, ShowWhen } from '../../types';
import { BOQ, SET, add, at, computed, countWhere, date, f, money, n, own, paper, party, sub } from './parts';

export const TENDER_TERMS = 'procurement.boq.tender_terms';

const here = (field: string) => at(BOQ, TENDER_TERMS, field);
const yes = (field: string): ShowWhen => ({ field: here(field), is: 'true' });
/** A sheet every tender has: shown whether or not a tender is on record yet. */
const ALWAYS: ShowWhen = { any: [{ records: TENDER_TERMS, is: 'any' }, { records: TENDER_TERMS, is: 'none' }] };
const ESCALATES = ['escalation by formula', 'escalation by indices'];

const yesNo = (key: string, label: string, more: Record<string, unknown> = {}) => ({ key, label, kind: 'boolean' as const, control: 'switch' as const, ...more });
const share = (key: string, label: string, more: Record<string, unknown> = {}) => ({ key, label, kind: 'percent' as const, precision: 2, ...more });
const span = (key: string, label: string, unit: 'days' | 'months' | 'years', more: Record<string, unknown> = {}) => ({ key, label, kind: 'duration' as const, unit, min: 0, ...more });
const FORM = 'Client’s reply to the tender form';

export const TENDER_TERMS_SETS: FieldSet[] = [
  {
    id: TENDER_TERMS,
    fn: BOQ,
    title: 'Tender terms',
    v: 1,
    records: { of: 'tender', titleField: 'package', summaryFields: ['contract_type', 'contract_months', 'response_by'] },
    situations: [
      { key: 'earnest_money_applies', label: 'Earnest money applies', scope: 'function', hint: 'A tender asks its bidders for earnest money.', derive: { records: TENDER_TERMS, is: 'any', where: { column: 'emd_applies', is: 'true' } } },
      { key: 'mobilisation_advance_applies', label: 'Mobilisation advance applies', scope: 'function', hint: 'A tender offers the contractor an advance.', derive: { records: TENDER_TERMS, is: 'any', where: { column: 'advance_applies', is: 'true' } } },
      { key: 'client_supplies_materials', label: 'Client supplies materials', scope: 'function', hint: 'The client issues cement, steel or other material to the contractor.', derive: { records: TENDER_TERMS, is: 'any', where: { column: 'client_materials', is: 'true' } } },
      { key: 'price_escalation_applies', label: 'Price escalation applies', scope: 'function', hint: 'A tender’s price is not firm.', derive: { records: TENDER_TERMS, is: 'any', where: { column: 'price_basis', is: 'in', value: ESCALATES } } },
    ],
    sections: [
      { key: 'contract', label: 'Contract' },
      { key: 'damages', label: 'Liquidated damages' },
      { key: 'payment', label: 'Payment' },
      { key: 'applies', label: 'What applies' },
      { key: 'note', label: 'Note', tier: 'expert' },
    ],
    sheets: [
      {
        id: 'form',
        title: 'Issue and reply',
        showWhen: ALWAYS,
        fields: [
          party('issued_by', 'Issued by', { required: false }),
          date('issued_on', 'Issued on', { required: false, from: 'Tender form' }),
          date('response_by', 'Reply required by', { from: 'Tender form' }),
          party('answered_by', 'Answered for the client by', { required: false }),
          date('answered_on', 'Answered on', { required: false, from: FORM }),
        ],
        rules: [{ kind: 'before', fields: ['issued_on', 'response_by'], say: 'Issued on {a}, with a reply asked for by {b}: the reply is due before the form went out.', severity: 'low' }],
      },
      {
        id: 'consultants',
        title: 'Consultants',
        showWhen: ALWAYS,
        fields: [
          party('client', 'Client or owner', { from: FORM }),
          party('architect', 'Architect', { required: false, from: FORM }),
          party('structural_consultant', 'Structural consultant', { required: false, from: FORM }),
          party('mep_consultant', 'MEP consultant', { required: false, from: FORM }),
          party('pmc', 'Project management consultant', { required: false, from: FORM }),
          {
            key: 'other_consultants',
            label: 'Other consultants',
            kind: 'table',
            required: false,
            columns: [
              { key: 'party', label: 'Consultant', kind: 'ref', target: 'party' },
              { key: 'role', label: 'As', kind: 'enum', options: ['quantity surveyor', 'landscape', 'façade', 'interior', 'lighting', 'acoustic', 'traffic', 'green building', 'geotechnical', 'fire and life safety'] },
            ],
          },
        ],
        rules: [],
      },
      {
        id: 'earnest_money',
        title: 'Earnest money deposit',
        showWhen: { all: [{ situation: 'earnest_money_applies' }, yes('emd_applies')] },
        fields: [
          { key: 'emd_basis', label: 'Set as', kind: 'enum', control: 'segmented', options: ['fixed amount', 'share of the tender value'], from: FORM },
          money('emd_amount', 'Amount', { tier: 'situational', showWhen: { field: here('emd_basis'), is: 'equals', value: 'fixed amount' }, from: FORM }),
          share('emd_pct', 'Share of the tender value', { tier: 'situational', showWhen: { field: here('emd_basis'), is: 'equals', value: 'share of the tender value' }, from: FORM }),
          { key: 'emd_modes', label: 'Taken as', kind: 'multi_enum', optionSet: 'security_instrument', from: FORM },
          party('emd_favour', 'In favour of', { required: false, from: FORM }),
          span('emd_validity_days', 'Valid for', 'days', { from: FORM }),
          span('emd_refund_days', 'Refunded to the others within', 'days', { required: false, from: FORM }),
          computed('emd_deposits', 'Deposits received for this package', countWhere(SET.earnestMoney, own('package', 'package')), { precision: 0, from: 'Earnest money' }),
        ],
        rules: [],
      },
      {
        id: 'advance',
        title: 'Mobilisation advance',
        showWhen: { all: [{ situation: 'mobilisation_advance_applies' }, yes('advance_applies')] },
        sections: [
          { key: 'advance', label: 'Advance' },
          { key: 'recovery', label: 'Recovery' },
        ],
        fields: [
          share('advance_pct', 'Advance, of the contract value', { section: 'advance', from: FORM }),
          share('advance_bg_pct', 'Bank guarantee, of the advance', { section: 'advance', max: 200, from: FORM }),
          { key: 'advance_bg_due', label: 'Guarantee to be given', kind: 'enum', control: 'segmented', section: 'advance', options: ['on signing', 'before the advance is paid'], from: FORM },
          { key: 'advance_interest', label: 'Interest', kind: 'enum', control: 'segmented', section: 'advance', options: ['interest free', 'interest bearing'], from: FORM },
          share('advance_interest_pct', 'Rate of interest a year', { section: 'advance', tier: 'situational', showWhen: { field: here('advance_interest'), is: 'equals', value: 'interest bearing' }, from: FORM }),
          { key: 'recovery_from_bill', label: 'Recovery starts from running bill number', kind: 'number', min: 1, precision: 0, section: 'recovery', from: FORM },
          share('recovered_by_pct', 'Fully recovered by this share of the work done', { section: 'recovery', from: FORM }),
        ],
        rules: [
          { kind: 'at_least', fields: ['advance_bg_pct'], against: 100, say: 'The advance is secured by a bank guarantee of {a} of it: less than the advance itself.', severity: 'high' },
          { kind: 'at_least', fields: ['recovered_by_pct', 'advance_pct'], say: 'An advance of {b} of the contract value is to be recovered by {a} of the work: the bills to that point are worth less than the advance.', severity: 'high' },
        ],
      },
      {
        id: 'client_materials',
        title: 'Materials supplied by the client',
        showWhen: { all: [{ situation: 'client_supplies_materials' }, yes('client_materials')] },
        fields: [
          {
            key: 'materials',
            label: 'Materials, issue rates and wastage',
            kind: 'table',
            from: FORM,
            columns: [
              { key: 'material', label: 'Material', kind: 'enum', options: ['cement', 'reinforcement steel', 'structural steel', 'other'] },
              { key: 'unit', label: 'For each', kind: 'enum', options: ['bag', 'tonne', 'cubic metre', 'number'] },
              { key: 'issue_rate', label: 'Issue rate', kind: 'money', currency: 'INR' },
              { key: 'wastage_pct', label: 'Wastage allowed', kind: 'percent' },
              { key: 'penal_rate', label: 'Recovered for excess, at', kind: 'money', currency: 'INR' },
            ],
          },
          { key: 'materials_delivery', label: 'Delivery', kind: 'enum', options: ['delivered to site by the client', 'collected by the contractor from the client’s store'], from: FORM },
          { key: 'materials_unloading', label: 'Unloading and storage', kind: 'enum', control: 'segmented', options: ['by the client', 'by the contractor'], from: FORM },
          { key: 'materials_custody', label: 'In the custody of', kind: 'enum', control: 'segmented', options: ['the client', 'the contractor'], from: FORM },
        ],
        rules: [],
      },
      {
        id: 'utilities',
        title: 'Water and electricity for construction',
        showWhen: ALWAYS,
        sections: [
          { key: 'water', label: 'Water' },
          { key: 'power', label: 'Electricity' },
        ],
        fields: [
          yesNo('water_available', 'Water available at site', { section: 'water', from: FORM }),
          { key: 'water_source', label: 'Source', kind: 'enum', section: 'water', required: false, options: ['municipal supply', 'borewell', 'tanker'], from: FORM },
          { key: 'water_charges', label: 'Water is', kind: 'enum', control: 'segmented', section: 'water', options: ['free', 'chargeable', 'for the contractor to arrange'], from: FORM },
          yesNo('borewell_permitted', 'Contractor may sink a borewell', { section: 'water', from: FORM }),
          yesNo('power_available', 'Electricity available at site', { section: 'power', from: FORM }),
          { key: 'power_point', label: 'Connection point', kind: 'enum', section: 'power', required: false, options: ['at the site boundary', 'at the client’s panel', 'at the transformer'], from: FORM },
          { key: 'sanctioned_load', label: 'Sanctioned load', kind: 'number', unit: 'kVA', min: 0, section: 'power', required: false, from: FORM },
          { key: 'power_charges', label: 'Electricity is', kind: 'enum', control: 'segmented', section: 'power', options: ['free', 'chargeable', 'for the contractor to arrange'], from: FORM },
          yesNo('generator_by_contractor', 'Contractor to provide generator backup', { section: 'power', from: FORM }),
        ],
        rules: [],
      },
      {
        id: 'retention',
        title: 'Retention and security',
        showWhen: ALWAYS,
        sections: [
          { key: 'retention', label: 'Retention' },
          { key: 'security', label: 'Security deposit or performance guarantee' },
        ],
        fields: [
          share('retention_pct', 'Retention from each running bill', { section: 'retention', from: FORM }),
          share('retention_cap_pct', 'Retention, at most', { section: 'retention', from: FORM }),
          { key: 'retention_cap_of', label: 'The cap is of the', kind: 'enum', control: 'segmented', section: 'retention', options: ['contract value', 'executed value'], from: FORM },
          share('release_on_completion_pct', 'Released on completion', { section: 'retention', from: FORM }),
          computed('release_after_defects_pct', 'Released after the defects liability period', sub(n(100), f('release_on_completion_pct')), { section: 'retention', unit: '%', precision: 2 }),
          yesNo('retention_against_bg', 'Released early against a bank guarantee', { section: 'retention', from: FORM }),
          share('performance_pct', 'Security, of the contract value', { section: 'security', from: FORM }),
          { key: 'performance_form', label: 'Given as', kind: 'enum', optionSet: 'security_instrument', section: 'security', from: FORM },
          span('performance_valid_months', 'Valid for', 'months', { section: 'security', from: FORM }),
          computed('performance_needed_months', 'Contract period with the defects liability period', add(f('contract_months'), f('defects_months')), { section: 'security', unit: 'months', precision: 0, tier: 'expert' }),
        ],
        rules: [
          { kind: 'at_most', fields: ['retention_cap_pct', 'retention_pct'], say: 'Retention is capped at {a} where {b} is held from each bill: the cap is never reached.', severity: 'medium' },
          { kind: 'at_least', fields: ['performance_valid_months', 'performance_needed_months'], say: 'The performance guarantee is valid for {a}, and the contract period with the defects liability period runs {b}.', severity: 'high' },
        ],
      },
      {
        id: 'makes',
        title: 'Approved makes and guarantee formats',
        showWhen: ALWAYS,
        sections: [
          { key: 'makes', label: 'Approved makes' },
          { key: 'formats', label: 'Bank guarantee formats' },
        ],
        fields: [
          paper('approved_makes', 'Client’s list of approved makes', { section: 'makes' }),
          yesNo('equivalents_permitted', 'Equivalent makes permitted', { section: 'makes', from: FORM }),
          { key: 'equivalents_approved_by', label: 'An equivalent is approved by', kind: 'enum', section: 'makes', tier: 'situational', showWhen: yes('equivalents_permitted'), options: ['the architect', 'the client', 'the project management consultant'], from: FORM },
          paper('bg_format_emd', 'Format for the earnest money', { section: 'formats' }),
          paper('bg_format_advance', 'Format for the mobilisation advance', { section: 'formats' }),
          paper('bg_format_performance', 'Format for the security deposit or performance guarantee', { section: 'formats' }),
          { key: 'acceptable_banks', label: 'Banks accepted', kind: 'enum', section: 'formats', options: ['nationalised banks', 'scheduled commercial banks', 'banks on the client’s list'], from: FORM },
        ],
        rules: [],
      },
      {
        id: 'appendices',
        title: 'Appendices',
        showWhen: ALWAYS,
        sections: [
          { key: 'papers', label: 'Papers' },
          { key: 'cover', label: 'Insurance and warranty' },
          { key: 'rates', label: 'Rates' },
        ],
        fields: [
          paper('specifications', 'Technical specifications', { section: 'papers' }),
          paper('schedule_of_quantities', 'Schedule of quantities', { section: 'papers' }),
          paper('tender_drawings', 'Tender drawings, with the drawing list and revisions', { section: 'papers', viewer: 'drawing' }),
          paper('soil_report', 'Soil investigation report', { section: 'papers' }),
          paper('hs_manual', 'Health and safety manual', { section: 'papers' }),
          { key: 'insurances_required', label: 'Insurances asked for', kind: 'multi_enum', optionSet: 'insurance_kind', section: 'cover', from: FORM },
          { key: 'insurance_by', label: 'Insured by', kind: 'enum', control: 'segmented', section: 'cover', options: ['the client', 'the contractor'], from: FORM },
          { key: 'warranty_items', label: 'Warranties asked for', kind: 'multi_enum', section: 'cover', options: ['waterproofing', 'façade', 'lifts', 'MEP equipment', 'doors and windows', 'roofing'], from: FORM },
          span('warranty_years', 'Warranty period', 'years', { section: 'cover', from: FORM }),
          paper('warranty_format', 'Warranty format', { section: 'cover' }),
          paper('basic_prices', 'Basic price list, excluding tax', { section: 'rates' }),
          paper('day_work_rates', 'Day work rates', { section: 'rates' }),
        ],
        rules: [],
      },
    ],
    fields: [
      { key: 'package', label: 'Package', kind: 'ref', target: 'package', section: 'contract' },
      { key: 'contract_type', label: 'Type of contract', kind: 'enum', control: 'segmented', section: 'contract', options: ['item rate', 'lump sum', 're-measurable', 'design and build'], from: FORM },
      { key: 'price_basis', label: 'Price basis', kind: 'enum', control: 'segmented', section: 'contract', options: ['firm', ...ESCALATES], from: FORM },
      share('escalation_cap_pct', 'Escalation, at most', { section: 'contract', tier: 'situational', required: false, showWhen: { field: here('price_basis'), is: 'in', value: ESCALATES }, from: FORM }),
      span('contract_months', 'Contract period', 'months', { section: 'contract', from: FORM }),
      date('expected_start', 'Expected start', { section: 'contract', from: FORM }),
      span('defects_months', 'Defects liability period', 'months', { section: 'contract', from: FORM }),
      share('damages_rate_pct', 'Liquidated damages, of the contract value', { section: 'damages', from: FORM }),
      { key: 'damages_per', label: 'For each', kind: 'enum', control: 'segmented', section: 'damages', options: ['week', 'day'], from: FORM },
      share('damages_cap_pct', 'Liquidated damages, at most', { section: 'damages', from: FORM }),
      { key: 'billing_frequency', label: 'Bills are raised', kind: 'enum', control: 'segmented', section: 'payment', options: ['monthly', 'fortnightly', 'by milestone'], from: FORM },
      money('min_bill_value', 'Smallest bill taken', { section: 'payment', required: false, from: FORM }),
      span('certify_days', 'A bill is certified within', 'days', { section: 'payment', from: FORM }),
      span('pay_days', 'And paid within', 'days', { section: 'payment', from: FORM }),
      yesNo('emd_applies', 'Earnest money deposit', { section: 'applies', from: FORM }),
      yesNo('advance_applies', 'Mobilisation advance', { section: 'applies', from: FORM }),
      yesNo('client_materials', 'Materials supplied by the client', { section: 'applies', from: FORM }),
      { key: 'note', label: 'Note', kind: 'longtext', maxLength: 400, section: 'note', required: false },
    ],
    rules: [{ kind: 'at_most', fields: ['damages_rate_pct', 'damages_cap_pct'], say: 'Liquidated damages of {a} for each period are above the {b} they are capped at.', severity: 'medium' }],
  },
];
