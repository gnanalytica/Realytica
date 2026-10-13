/**
 * Finance › Lenders: what each lender sanctioned, what is charged to it,
 * what it tests, what has been drawn and what is owed.
 *
 * Six functions of the catalog:
 *
 * - the facility, a record for each, read from the sanction letter;
 * - security: a record for each charge, guarantee and release letter, and
 *   the cover they give;
 * - conditions and covenants, each a record with its own standing, and the
 *   limits a regulator sets on deferring completion and on cost overrun;
 * - drawdowns, each paired to the milestone it answers to, with the cost
 *   incurred as the lender's engineer, the quantity surveyor and the
 *   accountant each state it, side by side;
 * - the lender's engineer's reports and what they ask to be put right;
 * - the escrow, the reserve and repayment.
 *
 * Nothing shows on a sheet until a facility is recorded. A figure that is
 * the lender's own is read from its letter and never assumed.
 */

import type { FieldSet, ShowWhen } from '../../types';
import { statedBySeveral } from '../builders';
import { DESIGNATED_ACCOUNT_KEPT, EXISTING, IF_DESIGNATED, IF_LENDER, LENDER_FUNDED, PAPER, SET } from './names';
import {
  FIN,
  LEN,
  asPct,
  at,
  choice,
  count,
  tallyWhere,
  dateOf,
  day,
  f,
  far,
  limitFor,
  link,
  lowerOfBoth,
  minus,
  mirror,
  money,
  months,
  most,
  n,
  nothing,
  once,
  only,
  options,
  orZero,
  over,
  paper,
  pctOf,
  percent,
  plus,
  rate,
  rule,
  rupees,
  share,
  standing,
  sumOf,
  totalOf,
  text,
  times,
  today,
  when,
  worked,
} from './kit';

const FROM_SANCTION = { from: 'Sanction letter', fromTypes: [PAPER.sanction] };
const FROM_ENGINEER = { from: 'Lender’s engineer’s report', fromTypes: [PAPER.lenderEngineer] };

const costStated = statedBySeveral({
  id: SET.costStated,
  fn: LEN,
  title: 'Cost incurred',
  key: 'cost_incurred',
  figure: { kind: 'money', dimension: 'money', currency: 'INR' },
  tolerancePct: 5,
  section: 'cost',
  tone: 'warning',
});
// Stated once for each drawdown, by each person who certifies it: the statement names the drawdown it was made for.
costStated.set.v = 2;
costStated.set.fields.push({ key: 'drawdown', label: 'For the drawdown', kind: 'ref', target: { set: SET.drawdowns }, required: false, since: 2 });
costStated.set.periodic = { every: { event: SET.drawdowns, on: 'requested_on' }, by: 'drawdown', per: ['source'], due: { days: 15 }, issuer: 'consultant' };

const LETTER_KIND = at(LEN, SET.letters, 'kind');
/** Routing and the reserve are asked about once an escrow account is named: a facility without one has neither. */
const ESCROW_NAMED: ShowWhen = { field: at(LEN, SET.escrow, 'escrow_account'), is: 'set' };

export const LENDER_SETS: FieldSet[] = [
  /* ================================================================== */
  /* The facility                                                        */
  /* ================================================================== */
  {
    id: SET.facilities,
    fn: LEN,
    title: 'Facilities',
    v: 1,
    records: { of: 'facility', titleField: 'name', summaryFields: ['lender', 'sanctioned_amount', 'rate_now'] },
    situations: [LENDER_FUNDED],
    optionSets: [
      options('lender_facility_kind', 'Kind of facility', [
        ['construction_term_loan', 'Construction term loan'],
        ['overdraft', 'Overdraft'],
        ['debentures', 'Non-convertible debentures'],
        ['lease_rental_discounting', 'Lease rental discounting'],
        ['land_backed_debt', 'Land-backed structured debt'],
        ['guarantee_limit', 'Bank guarantee limit'],
      ]),
      options('lender_rate_benchmark', 'Benchmark', [
        ['repo', 'Repo-linked'],
        ['mclr', 'Marginal cost of funds'],
        ['base_rate', 'Lender’s base rate'],
        ['treasury_bill', 'Treasury bill'],
        ['fixed', 'Fixed rate'],
      ]),
      options('lender_repayment_mode', 'Repayment', [
        ['instalments', 'Fixed instalments'],
        ['sweep', 'Share of collections swept'],
        ['both', 'Instalments and a sweep'],
        ['bullet', 'Bullet'],
      ]),
    ],
    sections: [
      { key: 'sanction', label: 'Sanction' },
      { key: 'money', label: 'Amount and contribution' },
      { key: 'interest', label: 'Interest' },
      { key: 'period', label: 'Period and repayment' },
    ],
    fields: [
      text('name', 'Facility', { section: 'sanction', hint: 'As the sanction letter names it.' }),
      link('lender', 'Lender', 'party', { section: 'sanction' }),
      choice('kind', 'Kind', 'lender_facility_kind', { section: 'sanction', ...FROM_SANCTION }),
      text('sanction_ref', 'Sanction reference', { section: 'sanction', ...FROM_SANCTION }),
      day('sanction_date', 'Sanctioned on', { section: 'sanction', ...FROM_SANCTION }),
      paper('sanction_letter', 'Sanction letter', { section: 'sanction' }),
      money('sanctioned_amount', 'Amount sanctioned', { section: 'money', proof: 'expected', ...FROM_SANCTION }),
      money('cost_appraised', 'Project cost appraised', { section: 'money', ...FROM_SANCTION }),
      percent('min_promoter_share', 'Minimum promoter contribution, share of cost', { section: 'money', ...FROM_SANCTION }),
      choice('benchmark', 'Benchmark', 'lender_rate_benchmark', { section: 'interest', ...FROM_SANCTION }),
      percent('benchmark_rate', 'Benchmark rate at the last reset', { section: 'interest', required: false, from: 'Reserve Bank, or the lender’s published rate' }),
      percent('spread', 'Spread', { section: 'interest', ...FROM_SANCTION }),
      share('rate_now', 'Rate now', plus(f('benchmark_rate'), f('spread')), { section: 'interest' }),
      months('tenor', 'Tenor', { section: 'period', ...FROM_SANCTION }),
      months('moratorium', 'Moratorium on principal', { section: 'period', required: false, ...FROM_SANCTION }),
      day('availability_end', 'Last date to draw', { section: 'period', expires: { leadDays: 60 }, ...FROM_SANCTION }),
      choice('repayment', 'Repayment', 'lender_repayment_mode', { section: 'period', ...FROM_SANCTION }),
    ],
    rules: [rule('at_most', ['sanctioned_amount', 'cost_appraised'], 'The sanction of {a} is more than the project cost appraised, {b}.', 'medium')],
  },

  /* ================================================================== */
  /* Security                                                            */
  /* ================================================================== */
  {
    id: SET.securities,
    fn: LEN,
    title: 'Security',
    v: 1,
    records: { of: 'security', titleField: 'asset', summaryFields: ['charge', 'ranking', 'value'] },
    optionSets: [
      options('lender_security_asset', 'Asset', [
        ['project_land', 'Project land'],
        ['structure', 'Structure'],
        ['unsold_units', 'Unsold units'],
        ['receivables', 'Receivables'],
        ['account_balances', 'Escrow and reserve balances'],
        ['other_property', 'Other property'],
        ['shares', 'Shares'],
      ]),
      options('lender_charge_kind', 'Charge', [
        ['registered_mortgage', 'Registered mortgage'],
        ['equitable_mortgage', 'Mortgage by deposit of title deeds'],
        ['hypothecation', 'Hypothecation'],
        ['assignment', 'Assignment'],
        ['pledge', 'Pledge'],
      ]),
      options('lender_charge_ranking', 'Ranking', [
        ['first_exclusive', 'First, exclusive'],
        ['first_pari_passu', 'First, shared'],
        ['second', 'Second'],
      ]),
    ],
    sections: [
      { key: 'charge', label: 'Charge' },
      { key: 'filings', label: 'Filings' },
      { key: 'value', label: 'Value and release' },
    ],
    fields: [
      choice('asset', 'Asset', 'lender_security_asset', { section: 'charge' }),
      link('facility', 'Facility', { set: SET.facilities }, { section: 'charge' }),
      link('parcel', 'Parcel', 'parcel', { section: 'charge', required: false }),
      link('owner', 'Owner of the asset', 'party', { section: 'charge' }),
      choice('charge', 'Charge', 'lender_charge_kind', { section: 'charge' }),
      choice('ranking', 'Ranking', 'lender_charge_ranking', { section: 'charge', control: 'segmented' }),
      day('created_on', 'Created on', { section: 'charge', from: 'Security document' }),
      paper('deed', 'Security document', { section: 'charge', viewer: 'deed' }),
      day('registered_on', 'Registered with the sub-registrar on', { section: 'filings', required: false }),
      day('company_filed_on', 'Filed with the registrar of companies on', { section: 'filings', required: false, from: 'Certificate of registration of charge' }),
      worked('company_filing_took', 'Days taken to file with the registrar of companies', { op: 'days_between', left: 'company_filed_on', right: 'created_on' }, { section: 'filings', unit: 'days', precision: 0 }),
      worked('company_filing_allowed', 'Days allowed to file with the registrar of companies', limitFor('company_filing_took', rate('company_charge_filing_days')), { section: 'filings', unit: 'days', precision: 0 }),
      day('registry_filed_on', 'Filed with the central registry on', { section: 'filings', required: false }),
      worked('registry_filing_took', 'Days taken to file with the central registry', { op: 'days_between', left: 'registry_filed_on', right: 'created_on' }, { section: 'filings', unit: 'days', precision: 0 }),
      worked('registry_filing_allowed', 'Days allowed to file with the central registry', limitFor('registry_filing_took', rate('security_registry_filing_days')), { section: 'filings', unit: 'days', precision: 0 }),
      standing(
        'filing_standing',
        'Filings',
        [
          { when: rule('at_most', ['company_filing_took', 'company_filing_allowed'], 'The charge was filed with the registrar of companies {a} after it was created; {b} is allowed.', 'high'), label: 'Filed late with the registrar of companies', tone: 'critical' },
          { when: rule('at_most', ['registry_filing_took', 'registry_filing_allowed'], 'The charge was filed with the central registry {a} after it was created; {b} is allowed.', 'medium'), label: 'Filed late with the central registry', tone: 'warning' },
        ],
        { label: 'Filed in time', tone: 'good' },
        { section: 'filings' },
      ),
      money('value', 'Value', { section: 'value', required: false, from: 'Valuation report' }),
      day('valued_on', 'Valued as at', { section: 'value', required: false, from: 'Valuation report' }),
      day('released_on', 'Released on', { section: 'value', required: false, from: 'Release letter' }),
    ],
    rules: [
      rule('at_most', ['company_filing_took', 'company_filing_allowed'], 'The charge was filed with the registrar of companies {a} after it was created; {b} is allowed.', 'high'),
      rule('at_most', ['registry_filing_took', 'registry_filing_allowed'], 'The charge was filed with the central registry {a} after it was created; {b} is allowed.', 'medium'),
    ],
  },
  {
    id: SET.security,
    fn: LEN,
    title: 'Security cover',
    v: 1,
    situations: [LENDER_FUNDED],
    sections: [
      { key: 'cover', label: 'Cover', showWhen: IF_LENDER },
      { key: 'title', label: 'Title and disclosure', showWhen: IF_LENDER },
    ],
    fields: [
      rupees('security_value', 'Value of the security', totalOf(SET.securities, 'value'), { section: 'cover' }),
      rupees('outstanding', 'Principal outstanding', far(at(LEN, SET.position, 'outstanding')), { section: 'cover' }),
      worked('cover', 'Security cover', over(f('security_value'), f('outstanding')), { section: 'cover', unit: 'times' }),
      months('revaluation_every', 'Revaluation every', { section: 'cover', required: false, ...FROM_SANCTION }),
      link('title_deeds_with', 'Original title deeds held by', 'party', { section: 'title', from: 'Lender’s receipt' }),
      paper('title_search', 'Lender’s title search report', { section: 'title' }),
      mirror('charges_on_ec', 'Charges subsisting on the encumbrance certificate', 'number', EXISTING.chargesOnEc, { section: 'title' }),
      { key: 'disclosed_on_rera_page', label: 'Mortgage disclosed on the RERA project page', kind: 'boolean', control: 'switch', section: 'title', required: false, from: 'RERA project page' },
    ],
    rules: [rule('at_least', ['charges_on_ec'], 'The encumbrance certificate shows {a} subsisting charges, and a facility is secured on the project.', 'medium', { against: 1, when: IF_LENDER })],
  },
  {
    id: SET.guarantees,
    fn: LEN,
    title: 'Guarantees',
    v: 1,
    records: { of: 'guarantee', titleField: 'guarantor', summaryFields: ['kind', 'amount'] },
    optionSets: [
      options('lender_guarantee_kind', 'Guarantee', [
        ['personal', 'Personal'],
        ['corporate', 'Corporate'],
      ]),
    ],
    fields: [
      link('guarantor', 'Guarantor', 'party'),
      choice('kind', 'Kind', 'lender_guarantee_kind', { control: 'segmented' }),
      money('amount', 'Amount', { required: false, hint: 'Left empty where the guarantee has no limit.' }),
      day('dated', 'Dated', { from: 'Guarantee deed' }),
      paper('deed', 'Guarantee deed', { viewer: 'deed' }),
      day('net_worth_certified_on', 'Net worth certificate dated', { required: false }),
      worked('net_worth_certificate_age', 'Age of the net worth certificate', minus(today, dateOf('net_worth_certified_on')), { unit: 'days', precision: 0 }),
    ],
    rules: [rule('at_most', ['net_worth_certificate_age'], 'The guarantor’s net worth certificate is {a} old.', 'medium', { against: 365 })],
  },
  {
    id: SET.unitReleases,
    fn: LEN,
    title: 'Release letters by unit',
    v: 1,
    records: { of: 'release letter', titleField: 'unit', summaryFields: ['letter_no', 'dated'] },
    optionSets: [
      options('lender_release_terms', 'Released', [
        ['unconditional', 'Without condition'],
        ['on_payment_to_escrow', 'On payment into the escrow'],
        ['at_minimum_price', 'At or above the minimum price'],
      ]),
    ],
    fields: [
      link('unit', 'Unit', 'unit'),
      link('facility', 'Facility', { set: SET.facilities }, { required: false }),
      text('letter_no', 'Letter number', { from: 'Release letter' }),
      day('dated', 'Dated', { from: 'Release letter' }),
      choice('terms', 'Released', 'lender_release_terms', { required: false, control: 'segmented' }),
      paper('letter', 'Release letter'),
    ],
    rules: [],
  },

  /* ================================================================== */
  /* Conditions and covenants                                            */
  /* ================================================================== */
  {
    id: SET.conditions,
    fn: LEN,
    title: 'Conditions of sanction',
    v: 1,
    records: { of: 'condition', titleField: 'clause', summaryFields: ['applies', 'met', 'condition_standing'] },
    optionSets: [
      options('lender_condition_applies', 'Applies', [
        ['pre_commitment', 'Before commitment'],
        ['pre_disbursement', 'Before disbursement'],
        ['post_disbursement', 'After disbursement'],
        ['ongoing', 'Throughout'],
      ]),
      options('lender_condition_met', 'Condition', [
        ['met', 'Met', 'good'],
        ['open', 'Open', 'warning'],
        ['waived', 'Waived', 'neutral'],
      ]),
    ],
    fields: [
      text('clause', 'Clause', { ...FROM_SANCTION }),
      text('wording', 'Condition, as the letter words it', { ...FROM_SANCTION }),
      choice('applies', 'Applies', 'lender_condition_applies'),
      choice('met', 'Condition', 'lender_condition_met', { control: 'segmented' }),
      day('due', 'Due', { required: false }),
      paper('proof', 'Proof'),
      worked(
        'holds_up_drawdown',
        'Holds up a drawdown',
        when({ all: [{ field: 'applies', is: 'equals', value: 'pre_disbursement' }, { field: 'met', is: 'equals', value: 'open' }] }, n(1), n(0)),
        { precision: 0, tier: 'expert' },
      ),
      worked('days_overdue', 'Days overdue', when({ field: 'met', is: 'equals', value: 'open' }, minus(today, dateOf('due')), n(0)), { unit: 'days', precision: 0 }),
      standing(
        'condition_standing',
        'Standing',
        [{ when: rule('at_most', ['days_overdue'], 'Open, and {a} past its date.', 'high', { against: 0 }), label: 'Overdue', tone: 'critical' }],
        { label: 'In hand', tone: 'good' },
      ),
    ],
    rules: [rule('at_most', ['days_overdue'], 'Open, and {a} past its date.', 'high', { against: 0 }), rule('require_if', ['met', 'proof'], 'Marked {a} with no proof on file.', 'low', { whenIn: ['met', 'waived'] })],
  },
  {
    id: SET.covenants,
    fn: LEN,
    title: 'Covenants',
    v: 1,
    records: { of: 'covenant', titleField: 'covenant', summaryFields: ['threshold', 'actual', 'covenant_standing'] },
    optionSets: [
      options('lender_covenant_kind', 'Covenant', [
        ['security_cover', 'Security cover (times)'],
        ['promoter_contribution', 'Promoter contribution (share of cost)'],
        ['debt_to_equity', 'Debt to equity (times)'],
        ['cost_overrun', 'Cost overrun (share of cost)'],
        ['collection_efficiency', 'Collected, as a share of demanded'],
        ['receivables_cover', 'Receivables cover (times)'],
        ['debt_service_cover', 'Debt service cover (times)'],
        ['sales_by_date', 'Sales by a date'],
        ['collections_by_date', 'Collections by a date'],
      ]),
      options('lender_covenant_test', 'Test', [
        ['at_least', 'At least'],
        ['at_most', 'At most'],
      ]),
      options('lender_frequency', 'How often', [
        ['monthly', 'Monthly'],
        ['quarterly', 'Quarterly'],
        ['half_yearly', 'Half-yearly'],
        ['yearly', 'Yearly'],
        ['once', 'Once'],
      ]),
    ],
    fields: [
      choice('covenant', 'Covenant', 'lender_covenant_kind', { ...FROM_SANCTION }),
      link('facility', 'Facility', { set: SET.facilities }, { required: false }),
      choice('test', 'Test', 'lender_covenant_test', { control: 'segmented' }),
      count('threshold', 'Threshold', { hint: 'In the covenant’s own measure.', ...FROM_SANCTION }),
      choice('frequency', 'Tested', 'lender_frequency', { required: false }),
      day('tested_on', 'Last tested on', { required: false }),
      count('stated', 'Actual, where it is not worked out here', { required: false, from: 'Compliance certificate' }),
      worked(
        'actual',
        'Actual',
        when(
          { field: 'covenant', is: 'equals', value: 'security_cover' },
          far(at(LEN, SET.security, 'cover')),
          when(
            { field: 'covenant', is: 'equals', value: 'promoter_contribution' },
            far(at(FIN, SET.plan, 'promoter_share')),
            when(
              { field: 'covenant', is: 'equals', value: 'debt_to_equity' },
              far(at(FIN, SET.plan, 'debt_to_equity')),
              when(
                { field: 'covenant', is: 'equals', value: 'cost_overrun' },
                far(at(LEN, SET.limits, 'overrun')),
                when({ field: 'covenant', is: 'equals', value: 'collection_efficiency' }, far(at(FIN, SET.receivables, 'collection_efficiency')), f('stated')),
              ),
            ),
          ),
        ),
      ),
      worked('short_by', 'Short of the covenant by', when({ field: 'test', is: 'equals', value: 'at_least' }, minus(f('threshold'), f('actual')), minus(f('actual'), f('threshold')))),
      paper('certificate', 'Compliance certificate'),
      standing(
        'covenant_standing',
        'Covenant',
        [{ when: rule('at_most', ['short_by'], 'The covenant is missed by {a}.', 'high', { against: 0 }), label: 'Breached', tone: 'critical' }],
        { label: 'Met', tone: 'good' },
      ),
    ],
    rules: [rule('at_most', ['short_by'], 'The covenant is missed by {a}.', 'high', { against: 0 })],
  },
  {
    id: SET.papersOwed,
    fn: LEN,
    title: 'Papers the lender is owed',
    v: 1,
    records: { of: 'paper', titleField: 'paper', summaryFields: ['frequency', 'next_due'] },
    optionSets: [
      options('lender_paper_owed', 'Paper', [
        ['progress_report', 'Progress report'],
        ['end_use_certificate', 'Accountant’s end-use certificate'],
        ['receivables_statement', 'Receivables statement'],
        ['audited_accounts', 'Audited accounts'],
        ['insurance_renewal', 'Insurance renewal'],
        ['engineer_report', 'Independent engineer’s report'],
        ['valuation', 'Valuation'],
        ['rera_update', 'RERA quarterly update'],
      ]),
    ],
    fields: [
      choice('paper', 'Paper', 'lender_paper_owed', { ...FROM_SANCTION }),
      choice('frequency', 'How often', 'lender_frequency'),
      day('next_due', 'Next due', { expires: { leadDays: 14 } }),
      day('last_sent_on', 'Last sent on', { required: false }),
      paper('last_sent', 'What was sent'),
    ],
    rules: [],
  },
  {
    id: SET.letters,
    fn: LEN,
    title: 'Letters from the lender',
    v: 1,
    records: { of: 'letter', titleField: 'kind', summaryFields: ['dated', 'reply_by'] },
    optionSets: [
      options('lender_letter_kind', 'Letter', [
        ['amendment', 'Amendment', 'info'],
        ['waiver', 'Waiver', 'good'],
        ['review', 'Review', 'neutral'],
        ['breach_notice', 'Notice of breach', 'warning'],
        ['recall_notice', 'Recall or demand notice', 'critical'],
      ]),
      options('lender_term_changed', 'Term changed', [
        ['amount', 'Amount'],
        ['rate', 'Interest'],
        ['tenor', 'Tenor or repayment'],
        ['availability', 'Last date to draw'],
        ['completion_date', 'Completion date committed'],
        ['security', 'Security'],
        ['covenant', 'A covenant'],
      ]),
    ],
    fields: [
      choice('kind', 'Letter', 'lender_letter_kind'),
      day('dated', 'Dated'),
      link('facility', 'Facility', { set: SET.facilities }, { required: false }),
      paper('letter', 'Letter'),
      only({ field: LETTER_KIND, is: 'in', value: ['amendment', 'waiver'] }, choice('term_changed', 'Term changed or waived', 'lender_term_changed')),
      only({ field: LETTER_KIND, is: 'equals', value: 'amendment' }, text('was', 'Was, as the letter words it', { required: false })),
      only({ field: LETTER_KIND, is: 'equals', value: 'amendment' }, text('now', 'Now, as the letter words it')),
      only({ field: LETTER_KIND, is: 'in', value: ['breach_notice', 'recall_notice'] }, day('reply_by', 'Reply by', { expires: { leadDays: 7 } })),
    ],
    rules: [],
  },
  {
    id: SET.compliance,
    fn: LEN,
    title: 'Conditions and covenants',
    v: 1,
    situations: [LENDER_FUNDED],
    optionSets: [
      options('lender_consent_matter', 'Needs the lender’s consent', [
        ['shareholding', 'Change of shareholding'],
        ['borrowing', 'Further borrowing'],
        ['charge', 'A further charge'],
        ['dividend', 'A dividend'],
        ['plan', 'Change of plan'],
        ['price_floor', 'A sale below the minimum price'],
        ['related_party', 'Payments to related parties'],
      ]),
    ],
    sections: [
      { key: 'standing', label: 'Standing', showWhen: IF_LENDER },
      { key: 'consents', label: 'Consents and price', showWhen: IF_LENDER, tier: 'expert' },
    ],
    fields: [
      worked('conditions_holding_drawdown', 'Conditions holding up a drawdown', totalOf(SET.conditions, 'holds_up_drawdown'), { section: 'standing', precision: 0 }),
      worked('conditions_overdue', 'Conditions overdue', tallyWhere(SET.conditions, { column: 'days_overdue', is: 'gt', value: 0 }), { section: 'standing', precision: 0 }),
      worked('covenants_breached', 'Covenants breached', tallyWhere(SET.covenants, { column: 'short_by', is: 'gt', value: 0 }), { section: 'standing', precision: 0 }),
      standing(
        'covenant_standing',
        'Covenants',
        [
          { when: rule('at_most', ['covenants_breached'], 'Covenants breached: {a}.', 'critical', { against: 0 }), label: 'Breached', tone: 'critical' },
          { when: rule('at_most', ['conditions_overdue'], 'Conditions of sanction overdue: {a}.', 'high', { against: 0 }), label: 'A condition is overdue', tone: 'warning' },
          { when: rule('at_most', ['conditions_holding_drawdown'], 'Conditions standing in the way of the next drawdown: {a}.', 'medium', { against: 0 }), label: 'Conditions hold up a drawdown', tone: 'warning' },
        ],
        { label: 'All met', tone: 'good' },
        { section: 'standing' },
      ),
      { key: 'consent_needed_for', label: 'Not to be done without the lender’s consent', kind: 'multi_enum', optionSet: 'lender_consent_matter', section: 'consents', required: false, ...FROM_SANCTION },
      money('floor_price', 'Lowest sale price the lender allows, a square metre', { section: 'consents', required: false, ...FROM_SANCTION }),
    ],
    rules: [
      rule('at_most', ['covenants_breached'], 'Covenants breached: {a}.', 'critical', { against: 0 }),
      rule('at_most', ['conditions_overdue'], 'Conditions of sanction overdue: {a}.', 'high', { against: 0 }),
      rule('at_most', ['conditions_holding_drawdown'], 'Conditions standing in the way of the next drawdown: {a}.', 'medium', { against: 0 }),
    ],
  },
  {
    id: SET.limits,
    fn: LEN,
    title: 'Completion date and cost overrun',
    v: 1,
    situations: [LENDER_FUNDED],
    sections: [
      { key: 'completion', label: 'Completion date committed', showWhen: IF_LENDER },
      { key: 'overrun', label: 'Cost overrun', showWhen: IF_LENDER },
    ],
    fields: [
      day('completion_committed', 'Completion date committed to the lender', { section: 'completion', hint: 'The date of commencement of commercial operations.', ...FROM_SANCTION }),
      day('completion_revised', 'Revised date', { section: 'completion', required: false, from: 'Amendment letter' }),
      mirror('completion_forecast', 'Completion forecast by the programme', 'date', EXISTING.forecastCompletion, { section: 'completion' }),
      worked('deferment', 'Deferment', over(minus(dateOf('completion_revised'), dateOf('completion_committed')), n(30.44)), { section: 'completion', unit: 'months', precision: 1 }),
      worked('deferment_allowed', 'Longest deferment allowed', limitFor('deferment', times(rate('rbi_dcco_deferment_max_years'), n(12))), { section: 'completion', unit: 'months', precision: 0 }),
      standing(
        'completion_standing',
        'Completion date',
        [
          { when: rule('at_most', ['deferment', 'deferment_allowed'], 'The completion date is deferred by {a}; the longest allowed is {b}.', 'critical'), label: 'Deferred beyond the limit', tone: 'critical' },
          { when: rule('before', ['completion_forecast', 'completion_committed'], 'Completion is forecast for {a}, after the {b} committed to the lender.', 'high'), label: 'Forecast after the committed date', tone: 'warning' },
        ],
        { label: 'Within the committed date', tone: 'good' },
        { section: 'completion' },
      ),
      mirror('budget_sanctioned', 'Budget sanctioned', 'money', EXISTING.budgetSanctioned, { section: 'overrun', dimension: 'money', currency: 'INR' }),
      mirror('cost_forecast', 'Cost forecast', 'money', EXISTING.budgetForecast, { section: 'overrun', dimension: 'money', currency: 'INR' }),
      share('overrun', 'Cost overrun', { op: 'variance_pct', left: f('cost_forecast'), right: f('budget_sanctioned') }, { section: 'overrun' }),
      share('overrun_allowed', 'Largest overrun a lender may finance', limitFor('overrun', rate('rbi_cost_overrun_max')), { section: 'overrun' }),
      standing(
        'overrun_standing',
        'Cost overrun',
        [{ when: rule('at_most', ['overrun', 'overrun_allowed'], 'The cost forecast is {a} over the sanctioned budget; a lender may finance {b}.', 'critical'), label: 'Beyond what a lender may finance', tone: 'critical' }],
        { label: 'Within the limit', tone: 'good' },
        { section: 'overrun' },
      ),
      only({ field: at(LEN, SET.limits, 'overrun'), is: 'gt', value: 0 }, day('lender_told_on', 'Lender told of the overrun on', { section: 'overrun', required: false })),
    ],
    rules: [
      rule('at_most', ['deferment', 'deferment_allowed'], 'The completion date is deferred by {a}; the longest allowed is {b}.', 'critical'),
      rule('before', ['completion_forecast', 'completion_committed'], 'Completion is forecast for {a}, after the {b} committed to the lender.', 'high'),
      rule('at_most', ['overrun', 'overrun_allowed'], 'The cost forecast is {a} over the sanctioned budget; a lender may finance {b}.', 'critical'),
      rule('require', ['lender_told_on'], 'The cost forecast is over the sanctioned budget and the lender has not been told.', 'high', { when: { field: at(LEN, SET.limits, 'overrun'), is: 'gt', value: 0 } }),
    ],
  },

  /* ================================================================== */
  /* Drawdowns                                                           */
  /* ================================================================== */
  {
    id: SET.drawdowns,
    fn: LEN,
    title: 'Drawdowns',
    v: 1,
    records: { of: 'drawdown', titleField: 'tranche', summaryFields: ['disbursed_amount', 'drawdown_standing'] },
    sections: [
      { key: 'plan', label: 'Planned' },
      { key: 'request', label: 'Requested' },
      { key: 'paid', label: 'Disbursed' },
    ],
    fields: [
      text('tranche', 'Tranche', { section: 'plan', hint: 'As the schedule numbers it.', from: FROM_SANCTION.from, fromTypes: [...FROM_SANCTION.fromTypes, 'Disbursement advice'] }),
      link('facility', 'Facility', { set: SET.facilities }, { section: 'plan', required: false }),
      day('planned_on', 'Planned for', { section: 'plan', ...FROM_SANCTION }),
      money('planned_amount', 'Planned amount', { section: 'plan', ...FROM_SANCTION }),
      day('requested_on', 'Requested on', { section: 'request', required: false }),
      money('requested_amount', 'Amount requested', { section: 'request', required: false }),
      paper('engineer_certificate', 'Lender’s engineer’s certificate', { section: 'request' }),
      day('disbursed_on', 'Disbursed on', { section: 'paid', required: false, from: 'Loan statement', fromTypes: ['Disbursement advice'] }),
      money('disbursed_amount', 'Amount disbursed', { section: 'paid', required: false, from: 'Loan statement', fromTypes: ['Disbursement advice'] }),
      link('credited_to', 'Credited to', 'account', { section: 'paid', required: false }),
      paper('end_use_certificate', 'Accountant’s end-use certificate', { section: 'paid' }),
      standing(
        'drawdown_standing',
        'Drawdown',
        [
          { when: rule('require_if', ['disbursed_on', 'engineer_certificate'], 'Disbursed on {a} with no certificate from the lender’s engineer on file.', 'high'), label: 'Disbursed without the engineer’s certificate', tone: 'critical' },
          { when: rule('require_if', ['disbursed_on', 'end_use_certificate'], 'Disbursed on {a} and the end-use certificate is not on file.', 'medium'), label: 'End-use certificate not on file', tone: 'warning' },
        ],
        { label: 'Certificates on file', tone: 'good' },
        { section: 'paid' },
      ),
    ],
    rules: [
      rule('require_if', ['disbursed_on', 'engineer_certificate'], 'Disbursed on {a} with no certificate from the lender’s engineer on file.', 'high'),
      rule('require_if', ['disbursed_on', 'end_use_certificate'], 'Disbursed on {a} and the end-use certificate is not on file.', 'medium'),
      rule('at_most', ['disbursed_amount', 'requested_amount'], '{a} was disbursed against a request for {b}.', 'low'),
    ],
  },
  costStated.set,
  {
    id: SET.drawdown,
    fn: LEN,
    title: 'Drawn against eligible',
    v: 1,
    situations: [LENDER_FUNDED],
    sections: [
      { key: 'drawn', label: 'Drawn', showWhen: IF_LENDER },
      { key: 'cost', label: 'Cost incurred, as each states it', showWhen: IF_LENDER },
      { key: 'eligible', label: 'Eligible', showWhen: IF_LENDER },
      { key: 'milestones', label: 'Milestones', showWhen: IF_LENDER },
    ],
    fields: [
      rupees('sanctioned', 'Sanctioned', totalOf(SET.facilities, 'sanctioned_amount'), { section: 'drawn' }),
      rupees('drawn', 'Drawn to date', once(SET.facilities, 'sanctioned_amount', sumOf(SET.drawdowns, 'disbursed_amount')), { section: 'drawn' }),
      rupees('undrawn', 'Undrawn', minus(f('sanctioned'), f('drawn')), { section: 'drawn' }),
      ...costStated.fields,
      share('debt_share', 'Debt share of the cost appraised', asPct(f('sanctioned'), sumOf(SET.facilities, 'cost_appraised')), { section: 'eligible' }),
      rupees('eligible', 'Drawdown eligible to date, on the lowest cost stated', lowerOfBoth(pctOf(f('cost_incurred_low'), f('debt_share')), f('sanctioned')), { section: 'eligible' }),
      rupees('headroom', 'Eligible and not yet drawn', minus(f('eligible'), f('drawn')), { section: 'eligible' }),
      standing(
        'headroom_standing',
        'Drawn against eligible',
        [{ when: rule('at_least', ['headroom'], 'What the cost incurred makes eligible, less what is drawn, stands at {a}.', 'high', { against: 0 }), label: 'Drawn beyond what is eligible', tone: 'critical' }],
        { label: 'Within what is eligible', tone: 'good' },
        { section: 'eligible' },
      ),
      {
        key: 'drawdown_to_milestone',
        label: 'Drawdowns to milestones',
        kind: 'table',
        display: 'match',
        section: 'milestones',
        required: false,
        columns: [link('drawdown', 'Drawdown', { set: SET.drawdowns }), link('milestone', 'Milestone', 'milestone')],
        match: {
          left: { column: 'drawdown', label: 'Drawdowns', of: { records: SET.drawdowns, field: 'tranche' } },
          right: { column: 'milestone', label: 'Milestones', of: { target: 'milestone' } },
        },
      },
    ],
    rules: [rule('at_least', ['headroom'], 'What the cost incurred makes eligible, less what is drawn, stands at {a}.', 'high', { against: 0 })],
  },
  {
    id: SET.tests,
    fn: LEN,
    title: 'Drawdown tests',
    v: 1,
    situations: [LENDER_FUNDED],
    sections: [
      { key: 'equity', label: 'Promoter contribution in step', showWhen: IF_LENDER },
      { key: 'progress', label: 'Drawn against physical progress', showWhen: IF_LENDER },
    ],
    fields: [
      rupees('equity_in', 'Promoter contribution brought in', far(at(FIN, SET.plan, 'equity_in')), { section: 'equity' }),
      rupees('drawn', 'Drawn to date', far(at(LEN, SET.drawdown, 'drawn')), { section: 'equity' }),
      // A share of no money is no share: with nothing brought in and nothing drawn there is no figure, and no rule speaks of one.
      share('equity_share', 'Promoter share of the money in so far', when({ left: plus(f('equity_in'), f('drawn')), is: 'gt', right: n(0) }, asPct(f('equity_in'), plus(f('equity_in'), f('drawn'))), nothing), { section: 'equity' }),
      share('equity_minimum', 'Lender’s minimum', { op: 'records', set: SET.facilities, reduce: 'max', field: 'min_promoter_share' }, { section: 'equity' }),
      standing(
        'equity_standing',
        'Promoter contribution',
        [{ when: rule('at_least', ['equity_share', 'equity_minimum'], 'The promoter has put in {a} of the money so far; the lender’s minimum is {b}.', 'high'), label: 'Behind the lender’s minimum', tone: 'critical' }],
        { label: 'In step', tone: 'good' },
        { section: 'equity' },
      ),
      mirror('physical_progress', 'Physical progress, from Progress', 'percent', EXISTING.actualProgress, { section: 'progress' }),
      share('drawn_share', 'Drawn, as a share of the sanction', asPct(f('drawn'), far(at(LEN, SET.drawdown, 'sanctioned'))), { section: 'progress' }),
      worked('drawn_ahead_by', 'Drawn ahead of physical progress by', minus(f('drawn_share'), f('physical_progress')), { section: 'progress', unit: 'points' }),
      standing(
        'progress_standing',
        'Drawn against progress',
        [{ when: rule('at_most', ['drawn_ahead_by'], 'The share drawn is {a} ahead of physical progress.', 'medium', { against: 10 }), label: 'Ahead of physical progress', tone: 'warning' }],
        { label: 'In step', tone: 'good' },
        { section: 'progress' },
      ),
    ],
    rules: [
      rule('at_least', ['equity_share', 'equity_minimum'], 'The promoter has put in {a} of the money so far; the lender’s minimum is {b}.', 'high'),
      rule('at_most', ['drawn_ahead_by'], 'The share drawn is {a} ahead of physical progress.', 'medium', { against: 10 }),
    ],
  },

  /* ================================================================== */
  /* The lender's engineer                                               */
  /* ================================================================== */
  {
    id: SET.engineerReports,
    fn: LEN,
    title: 'Lender’s engineer’s reports',
    v: 2,
    records: { of: 'report', titleField: 'report_no', summaryFields: ['visited_on', 'physical_progress', 'report_standing'] },
    // One for each drawdown: the report the lender's engineer makes before the money is released.
    periodic: { every: { event: SET.drawdowns, on: 'requested_on' }, by: 'drawdown', carry: ['engineer'], due: { days: 15 }, issuer: 'lender' },
    optionSets: [
      options('lender_work_quality', 'Quality of work', [
        ['good', 'Good', 'good'],
        ['acceptable', 'Acceptable', 'info'],
        ['poor', 'Poor', 'critical'],
      ]),
    ],
    sections: [
      { key: 'report', label: 'Report' },
      { key: 'progress', label: 'Progress and time' },
      { key: 'cost', label: 'Cost and drawdown' },
    ],
    fields: [
      text('report_no', 'Report number', { section: 'report', ...FROM_ENGINEER }),
      link('drawdown', 'For the drawdown', { set: SET.drawdowns }, { section: 'report', required: false, since: 2 }),
      link('engineer', 'Engineer', 'party', { section: 'report' }),
      day('report_date', 'Dated', { section: 'report', ...FROM_ENGINEER }),
      day('visited_on', 'Site visited on', { section: 'report', ...FROM_ENGINEER }),
      paper('report', 'Report', { section: 'report' }),
      paper('photographs', 'Photographs', { section: 'report', accepts: 'image', viewer: 'image' }),
      percent('physical_progress', 'Physical progress, per the engineer', { section: 'progress', ...FROM_ENGINEER }),
      mirror('firm_progress', 'Physical progress, from Progress', 'percent', EXISTING.actualProgress, { section: 'progress' }),
      worked('firm_ahead_by', 'Firm’s progress above the engineer’s', minus(f('firm_progress'), f('physical_progress')), { section: 'progress', unit: 'points' }),
      { key: 'deviation', label: 'Deviation from the sanctioned plan reported', kind: 'boolean', control: 'switch', section: 'progress', ...FROM_ENGINEER },
      only({ field: at(LEN, SET.engineerReports, 'deviation'), is: 'true' }, day('deviation_regularised_on', 'Deviation regularised on', { section: 'progress', required: false })),
      months('time_overrun', 'Time overrun', { section: 'progress', required: false, ...FROM_ENGINEER }),
      day('completion_expected', 'Completion expected by the engineer', { section: 'progress', ...FROM_ENGINEER }),
      choice('quality', 'Quality of work, as the engineer rates it', 'lender_work_quality', { section: 'progress', required: false, control: 'segmented', ...FROM_ENGINEER }),
      money('cost_to_complete', 'Cost to complete, per the engineer', { section: 'cost', ...FROM_ENGINEER }),
      money('revised_cost', 'Revised project cost, per the engineer', { section: 'cost', required: false, ...FROM_ENGINEER }),
      money('recommended_drawdown', 'Drawdown recommended', { section: 'cost', ...FROM_ENGINEER }),
      standing(
        'report_standing',
        'Report',
        [
          { when: rule('require_if', ['deviation', 'deviation_regularised_on'], 'The lender’s engineer reports a deviation from the sanctioned plan, and it is not shown as regularised.', 'high', { whenIn: ['true'] }), label: 'Deviation not regularised', tone: 'critical' },
          { when: rule('at_most', ['firm_ahead_by'], 'The firm’s progress is {a} above the lender’s engineer’s.', 'medium', { against: 5 }), label: 'Engineer’s progress below the firm’s', tone: 'warning' },
        ],
        { label: 'In line', tone: 'good' },
        { section: 'report' },
      ),
    ],
    rules: [
      rule('require_if', ['deviation', 'deviation_regularised_on'], 'The lender’s engineer reports a deviation from the sanctioned plan, and it is not shown as regularised.', 'high', { whenIn: ['true'] }),
      rule('at_most', ['firm_ahead_by'], 'The firm’s progress is {a} above the lender’s engineer’s.', 'medium', { against: 5 }),
      rule('before', ['completion_expected', 'completion_committed'], 'The lender’s engineer expects completion on {a}, after the {b} committed to the lender.', 'high', { at: { completion_committed: at(LEN, SET.limits, 'completion_committed') } }),
    ],
  },
  {
    id: SET.observations,
    fn: LEN,
    title: 'Lender’s engineer’s observations',
    v: 1,
    records: { of: 'observation', titleField: 'topic', summaryFields: ['severity', 'due', 'observation_standing'] },
    optionSets: [
      options('lender_observation_topic', 'About', [
        ['progress', 'Progress'],
        ['cost', 'Cost'],
        ['quality', 'Quality'],
        ['safety', 'Safety'],
        ['approvals', 'Approvals'],
        ['deviation', 'Deviation from the plan'],
        ['funding', 'Funding'],
        ['sales', 'Sales'],
      ]),
      options('lender_observation_severity', 'Severity', [
        ['high', 'High', 'critical'],
        ['medium', 'Medium', 'warning'],
        ['low', 'Low', 'neutral'],
      ]),
    ],
    fields: [
      choice('topic', 'About', 'lender_observation_topic', { ...FROM_ENGINEER }),
      link('report', 'Report', { set: SET.engineerReports }),
      choice('severity', 'Severity', 'lender_observation_severity', { control: 'segmented' }),
      link('owner', 'To be closed by', 'party', { required: false }),
      day('due', 'Due'),
      day('closed_on', 'Closed on', { required: false }),
      worked('days_past_due', 'Days open past its date', when({ field: 'closed_on', is: 'set' }, n(0), minus(today, dateOf('due'))), { unit: 'days', precision: 0 }),
      standing(
        'observation_standing',
        'Observation',
        [{ when: rule('at_most', ['days_past_due'], 'Open {a} past its date.', 'medium', { against: 0 }), label: 'Open past its date', tone: 'warning' }],
        { label: 'In hand', tone: 'good' },
      ),
    ],
    rules: [rule('at_most', ['days_past_due'], 'Open {a} past its date.', 'medium', { against: 0 })],
  },

  /* ================================================================== */
  /* Escrow, reserve and repayment                                       */
  /* ================================================================== */
  {
    id: SET.escrow,
    fn: LEN,
    title: 'Escrow and reserve',
    v: 1,
    situations: [LENDER_FUNDED, DESIGNATED_ACCOUNT_KEPT],
    optionSets: [
      options('lender_waterfall_head', 'Paid to', [
        ['statutory_dues', 'Statutory dues'],
        ['designated_account', 'Transfer to the RERA designated account'],
        ['interest', 'Interest'],
        ['principal', 'Principal'],
        ['reserve', 'Top-up of the reserve'],
        ['project_costs', 'Project costs'],
        ['surplus', 'Surplus to the promoter'],
      ]),
    ],
    sections: [
      { key: 'account', label: 'Escrow', showWhen: IF_LENDER },
      { key: 'routing', label: 'Collections through the escrow', showWhen: { all: [IF_LENDER, ESCROW_NAMED] } },
      { key: 'reserve', label: 'Debt service reserve', showWhen: { all: [IF_LENDER, ESCROW_NAMED] } },
    ],
    fields: [
      link('escrow_account', 'Escrow account', 'account', { section: 'account' }),
      paper('escrow_agreement', 'Escrow agreement', { section: 'account' }),
      {
        key: 'waterfall',
        label: 'Order of payments',
        kind: 'table',
        section: 'account',
        from: 'Escrow agreement',
        required: false,
        columns: [count('priority', 'Order'), choice('head', 'Paid to', 'lender_waterfall_head'), percent('share', 'Share', { required: false })],
      },
      only(IF_DESIGNATED, mirror('designated_deposit', 'RERA deposit rule, from Funding', 'text', at(FIN, SET.reraDeposit, 'deposit_standing'), { section: 'account' })),
      day('period_end', 'Period ending', { section: 'routing' }),
      money('collections', 'Collections in the period', { section: 'routing', from: 'Collections register' }),
      money('through_escrow', 'Credited to the escrow in the period', { section: 'routing', from: 'Escrow account statement', fromTypes: [PAPER.bankStatement] }),
      share('routed', 'Share routed through the escrow', asPct(f('through_escrow'), f('collections')), { section: 'routing' }),
      percent('sweep', 'Share of collections swept to the lender', { section: 'routing', required: false, ...FROM_SANCTION }),
      money('swept', 'Swept to the lender in the period', { section: 'routing', required: false, from: 'Escrow account statement' }),
      rupees('sweep_expected', 'Sweep expected', pctOf(f('collections'), f('sweep')), { section: 'routing' }),
      standing(
        'routing_standing',
        'Routing',
        [{ when: rule('at_least', ['routed'], '{a} of collections went through the escrow.', 'high', { against: 100 }), label: 'Collections outside the escrow', tone: 'critical' }],
        { label: 'All routed', tone: 'good' },
        { section: 'routing' },
      ),
      money('reserve_required', 'Reserve required', { section: 'reserve', required: false, from: 'Sanction letter and repayment schedule' }),
      money('reserve_held', 'Reserve held', { section: 'reserve', required: false, from: 'Reserve account statement' }),
      standing(
        'reserve_standing',
        'Reserve',
        [{ when: rule('at_least', ['reserve_held', 'reserve_required'], 'The reserve holds {a}; {b} is required.', 'high'), label: 'Reserve short', tone: 'critical' }],
        { label: 'Funded', tone: 'good' },
        { section: 'reserve' },
      ),
    ],
    rules: [
      rule('at_least', ['routed'], '{a} of collections went through the escrow.', 'high', { against: 100 }),
      rule('compare', ['swept', 'sweep_expected'], '{a} was swept to the lender; the sanction’s share of collections comes to {b}.', 'low', { tolerance: 0.01 }),
      rule('at_least', ['reserve_held', 'reserve_required'], 'The reserve holds {a}; {b} is required.', 'high'),
    ],
  },
  {
    id: SET.repayments,
    fn: LEN,
    title: 'Repayment schedule',
    v: 1,
    records: { of: 'instalment', titleField: 'due_on', summaryFields: ['principal', 'instalment_standing'] },
    fields: [
      day('due_on', 'Due on', { ...FROM_SANCTION }),
      link('facility', 'Facility', { set: SET.facilities }, { required: false }),
      money('principal', 'Principal', { ...FROM_SANCTION }),
      money('interest', 'Interest', { required: false }),
      day('paid_on', 'Paid on', { required: false, from: 'Loan statement' }),
      rupees('principal_paid', 'Principal repaid', when({ field: 'paid_on', is: 'set' }, f('principal'), n(0))),
      rupees('interest_paid', 'Interest paid', when({ field: 'paid_on', is: 'set' }, orZero('interest'), n(0))),
      worked('days_late', 'Days late', when({ field: 'paid_on', is: 'set' }, minus(dateOf('paid_on'), dateOf('due_on')), nothing), { unit: 'days', precision: 0 }),
      worked(
        'days_past_due',
        'Days past due',
        when({ field: 'paid_on', is: 'set' }, n(0), when({ field: 'due_on', is: 'set' }, most(minus(today, dateOf('due_on')), n(0)), nothing)),
        { unit: 'days', precision: 0 },
      ),
      standing(
        'instalment_standing',
        'Instalment',
        [
          { when: rule('at_most', ['days_past_due'], 'Unpaid, {a} past its date.', 'critical', { against: 0 }), label: 'Past due', tone: 'critical' },
          { when: rule('at_most', ['days_late'], 'Paid {a} late.', 'medium', { against: 0 }), label: 'Paid late', tone: 'warning' },
        ],
        { label: 'No delay', tone: 'good' },
      ),
    ],
    rules: [rule('at_most', ['days_past_due'], 'Unpaid, {a} past its date.', 'critical', { against: 0 }), rule('at_most', ['days_late'], 'Paid {a} late.', 'medium', { against: 0 })],
  },
  {
    id: SET.position,
    fn: LEN,
    title: 'Loan position',
    v: 1,
    // Kept by the month. What is owed and how the lender classes the account stand until restated.
    periodic: { every: 'month', carry: ['account_class', 'outstanding_per_statement', 'outstanding_per_books', 'notice_dated', 'reply_by', 'matter'], due: { days: 7 }, issuer: 'lead' },
    situations: [
      LENDER_FUNDED,
      { key: 'account_in_default', label: 'Recall or demand notice received', scope: 'function', derive: { records: SET.letters, is: 'any', where: { column: 'kind', is: 'equals', value: 'recall_notice' } } },
    ],
    optionSets: [
      options('lender_account_class', 'Classification', [
        ['standard', 'Standard', 'good'],
        ['sma_0', 'Special mention, first band', 'warning'],
        ['sma_1', 'Special mention, second band', 'warning'],
        ['sma_2', 'Special mention, third band', 'critical'],
        ['npa', 'Non-performing', 'critical'],
      ]),
    ],
    sections: [
      { key: 'position', label: 'Position', showWhen: IF_LENDER },
      { key: 'statement', label: 'Against the lender’s statement and the books', showWhen: { all: [IF_LENDER, { field: at(LEN, SET.position, 'drawn'), is: 'gt', value: 0 }] } },
      { key: 'default', label: 'Notice received', showWhen: { situation: 'account_in_default' } },
    ],
    fields: [
      rupees('drawn', 'Drawn to date', far(at(LEN, SET.drawdown, 'drawn')), { section: 'position' }),
      rupees('repaid', 'Principal repaid', once(SET.facilities, 'sanctioned_amount', sumOf(SET.repayments, 'principal_paid')), { section: 'position' }),
      rupees('outstanding', 'Principal outstanding', minus(f('drawn'), f('repaid')), { section: 'position' }),
      rupees('interest_paid', 'Interest paid to date', once(SET.facilities, 'sanctioned_amount', sumOf(SET.repayments, 'interest_paid')), { section: 'position' }),
      worked('days_past_due', 'Days past due', { op: 'records', set: SET.repayments, reduce: 'max', field: 'days_past_due' }, { section: 'position', unit: 'days', precision: 0 }),
      choice('account_class', 'Lender’s classification of the account', 'lender_account_class', { section: 'position', required: false, from: 'Lender’s statement' }),
      money('outstanding_per_statement', 'Outstanding per the lender’s statement', { section: 'statement', from: 'Loan statement' }),
      money('outstanding_per_books', 'Outstanding per the books', { section: 'statement', from: 'Loan ledger export' }),
      standing(
        'position_standing',
        'Loan account',
        [
          { when: rule('at_most', ['days_past_due'], 'An instalment is {a} past due.', 'critical', { against: 0 }), label: 'Payment past due', tone: 'critical' },
          { when: rule('compare', ['outstanding_per_statement', 'outstanding'], 'The lender’s statement shows {a} outstanding and the drawdowns less repayments come to {b}.', 'medium', { tolerance: 0.001 }), label: 'Statement and drawdown record differ', tone: 'warning' },
          { when: rule('compare', ['outstanding_per_statement', 'outstanding_per_books'], 'The lender’s statement shows {a} outstanding and the books {b}.', 'medium', { tolerance: 0.001 }), label: 'Statement and books differ', tone: 'warning' },
        ],
        { label: 'In order', tone: 'good' },
        { section: 'position' },
      ),
      only({ situation: 'account_in_default' }, day('notice_dated', 'Notice dated', { section: 'default' })),
      only({ situation: 'account_in_default' }, day('reply_by', 'Reply by', { section: 'default', expires: { leadDays: 7 } })),
      only({ situation: 'account_in_default' }, link('matter', 'Matter', 'matter', { section: 'default', required: false })),
    ],
    rules: [
      rule('at_most', ['days_past_due'], 'An instalment is {a} past due.', 'critical', { against: 0 }),
      rule('compare', ['outstanding_per_statement', 'outstanding'], 'The lender’s statement shows {a} outstanding and the drawdowns less repayments come to {b}.', 'medium', { tolerance: 0.001 }),
      rule('compare', ['outstanding_per_statement', 'outstanding_per_books'], 'The lender’s statement shows {a} outstanding and the books {b}.', 'medium', { tolerance: 0.001 }),
    ],
  },
];
