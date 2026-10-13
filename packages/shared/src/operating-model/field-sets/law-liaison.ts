/**
 * Law and Liaison: the fields of Legal's agreements, RERA, handover and
 * approvals.
 *
 * Law keeps the terms of each paper and the dates that follow from them. It
 * types no figure another department holds: money paid, cost incurred,
 * progress and bookings are read where they are kept. Liaison keeps one
 * approval record for every authority (the shared approval, with its
 * dependencies, fees, queries, follow-ups and validity added here) and, for
 * each kind of approval, only what is peculiar to it.
 *
 * Whether an approval applies is worked out from sizes held in the rule
 * table (`rules/law-liaison.ts`). Every one of those rows is unverified, and
 * the screen says so beside the standing that read it.
 */

import type { CheckFieldDef, CheckFormula, FieldAddress, FieldReportTemplate, FieldSet, OptionDef, OptionSet, ShowWhen, Tone } from '../types';
import { withLinks, type SetLinks } from './builders';

const CONTRACTS = 'legal.contracts';
const RERA = 'legal.rera';
const HANDOVER = 'legal.handover';
const APPROVALS = 'legal.approvals';
const SHARED = 'shared';

const LAND = 'legal.contracts.land';
const PURCHASES = 'legal.contracts.purchases';
const OBLIGATIONS = 'legal.contracts.obligations';
const JDA = 'legal.contracts.jda';
const JDA_DELIVERY = 'legal.contracts.jda_delivery';
const ATTORNEYS = 'legal.contracts.attorneys';
const SALE_AGREEMENT = 'legal.contracts.sale_agreement';
const REGISTRATION = 'legal.rera.registration';
const PHASES = 'legal.rera.phases';
const COMPLIANCE = 'legal.rera.compliance';
const FILINGS = 'legal.rera.filings';
const CONVEYANCE = 'legal.handover.conveyance';
const REGISTER = 'legal.approvals.register';
const LAND_USE = 'legal.approvals.land_use';
const SANCTION = 'legal.approvals.sanction';
const REVISIONS = 'legal.approvals.revisions';
const DEVIATIONS = 'legal.approvals.deviations';
const OCCUPANCY = 'legal.approvals.occupancy';
const STOP_ORDERS = 'legal.approvals.stop_orders';
const HEIGHT = 'legal.approvals.height_fire';
const ENVIRONMENT = 'legal.approvals.environment';
const UTILITIES = 'legal.approvals.utilities';
const LIFTS = 'legal.approvals.lifts';
const APPROVAL = 'shared.approvals';
const BUILDING = 'shared.buildings';
const UNIT = 'shared.units';

const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });

/* --- Fields other functions already keep, read here by address -------- */
const EXTENT_TITLE = at('legal.title', 'land_site.parcel_identification', 'extent_title');
/** The land Title finds clear of restriction: what an agreement, a sanction and a conversion are held to. Title's to work out; read here. */
const TITLE_CLEAR = at('legal.title', 'legal.title.character', 'clear_extent');
const ROAD_WIDTH = at('legal.title', 'land_site.access', 'road_width_ft');
const SANCTION_CHECK = (field: string) => at(APPROVALS, 'regulatory.sanction', field);
const LAND_USE_CHECK = (field: string) => at(APPROVALS, 'regulatory.land_use', field);
const OCCUPANCY_CHECK = (field: string) => at(APPROVALS, 'regulatory.occupancy', field);
const CLEARANCE_CHECK = (field: string) => at(APPROVALS, 'esg.clearance', field);
const SERVICES_CHECK = (field: string) => at('construction.quality', 'technical.mep_capacity', field);
/** Completion as the programme now stands: the later of the forecast and planned completion after the extensions of time granted. */
const FORECAST_COMPLETION = at('construction.progress', 'construction.progress.programme', 'completion_now');

/* --- Small words for formulas ----------------------------------------- */
const fld = (key: string, from?: FieldAddress): CheckFormula => ({ op: 'field', key, ...(from ? { at: from } : {}) });
const day = (key: string, from?: FieldAddress): CheckFormula => ({ op: 'date', key, ...(from ? { at: from } : {}) });
const num = (value: number): CheckFormula => ({ op: 'const', value });
const TODAY: CheckFormula = { op: 'today' };
const minus = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
const rate = (table: string): CheckFormula => ({ op: 'rate', table });
/** A rule row given in years, as months, so a date can be moved by it. */
const yearsAsMonths = (table: string): CheckFormula => ({ op: 'multiply', left: rate(table), right: num(12) });
/** Never below nothing, and nothing where the amount is not known yet: days late, counted only once they are. */
const notBelowZero = (formula: CheckFormula): CheckFormula => ({ op: 'max', of: [num(0), formula] });
const figure = (key: string): CheckFormula => ({ op: 'figure', key });
/** What the last sanctioned revision states, read through the figures door, and `otherwise` where no sanctioned revision states it. */
const revisedOr = (what: 'built_up' | 'units' | 'height', otherwise: CheckFormula): CheckFormula => ({ op: 'if', when: { left: figure(`sanction.revisions_stating_${what}`), is: 'gt', right: num(0) }, then: figure(`sanction.revised_${what}`), else: otherwise });
/** How far over, or nothing where it is not over. No answer while the amount itself is not known. */
const overBy = (formula: CheckFormula): CheckFormula => ({ op: 'if', when: { left: formula, is: 'gt', right: num(0) }, then: formula, else: num(0) });

const opt = (key: string, label: string, tone?: Tone): OptionDef => ({ key, label, ...(tone ? { tone } : {}) });
const list = (id: string, label: string, options: OptionDef[]): OptionSet => ({ id, label, options });
/** A field another function keeps, read here. */
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: Partial<CheckFieldDef> = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });
const when = (set: string, fn: string, field: string, is: 'set' | 'true' | 'false' | 'equals' | 'in' | 'lt' | 'gt', value?: unknown): ShowWhen => ({ field: at(fn, set, field), is, ...(value === undefined ? {} : { value }) });

const JOINT_DEVELOPMENT: ShowWhen = { situation: 'joint_development' };
const JDA_PAPER = ['Joint development agreement'];

/* ==================================================================== */
/* Law: land agreements                                                  */
/* ==================================================================== */

const LAND_SETS: FieldSet[] = [
  {
    id: LAND,
    fn: CONTRACTS,
    title: 'Land agreements',
    v: 1,
    optionSets: [
      list('consent_held', 'Consent', [opt('not_needed', 'Not needed', 'neutral'), opt('held', 'Held', 'good'), opt('needed_not_held', 'Needed and not held', 'critical')]),
    ],
    situations: [
      {
        key: 'joint_development',
        label: 'Joint development',
        scope: 'project',
        hint: 'The land is developed under an agreement with its owners, who keep a share.',
        proposeFrom: { documentTypes: JDA_PAPER },
      },
      {
        key: 'leasehold_land',
        label: 'Leasehold land',
        scope: 'project',
        hint: 'The land is held on a lease or an allotment, not owned outright.',
        proposeFrom: { documentTypes: ['Lease deed'] },
      },
      {
        key: 'land_on_agreement_only',
        label: 'Land held on an agreement to sell',
        scope: 'function',
        hint: 'A purchase stands on an agreement to sell, with no conveyance yet.',
        derive: { records: PURCHASES, is: 'any', where: { column: 'instrument', is: 'equals', value: 'agreement_to_sell' } },
      },
    ],
    sections: [
      { key: 'land', label: 'Land secured' },
      { key: 'obligations', label: 'Conditions and obligations' },
      { key: 'lease', label: 'Leasehold', showWhen: { situation: 'leasehold_land' } },
    ],
    fields: [
      { key: 'purchases_count', label: 'Purchases recorded', kind: 'computed', precision: 0, section: 'land', formula: { op: 'records', set: PURCHASES, reduce: 'count' } },
      { key: 'land_bought', label: 'Land bought', kind: 'computed', dimension: 'area', section: 'land', formula: { op: 'records', set: PURCHASES, reduce: 'sum', field: 'extent_conveyed' } },
      {
        key: 'land_secured',
        label: 'Land bought or brought into joint development',
        kind: 'computed',
        dimension: 'area',
        section: 'land',
        formula: {
          op: 'if',
          when: { field: 'land_extent', at: at(CONTRACTS, JDA, 'land_extent'), is: 'set' },
          then: { op: 'add', left: fld('land_bought'), right: fld('land_extent', at(CONTRACTS, JDA, 'land_extent')) },
          else: fld('land_bought'),
        },
      },
      mirror('land_on_parcel_check', 'Extent clear of restriction, per Title', 'area', TITLE_CLEAR, { unit: 'sqm', section: 'land' }),
      { key: 'consideration_total', label: 'Consideration agreed', kind: 'computed', dimension: 'money', currency: 'INR', section: 'land', formula: { op: 'records', set: PURCHASES, reduce: 'sum', field: 'consideration' } },
      {
        key: 'agreements_to_complete',
        label: 'Agreements to sell with no conveyance yet',
        kind: 'computed',
        precision: 0,
        section: 'land',
        tier: 'situational',
        showWhen: { situation: 'land_on_agreement_only' },
        formula: { op: 'count_if', over: { records: PURCHASES }, where: { column: 'instrument', is: 'equals', value: 'agreement_to_sell' } },
      },
      { key: 'obligations_open', label: 'Open', kind: 'computed', precision: 0, section: 'obligations', formula: { op: 'count_if', over: { records: OBLIGATIONS }, where: { column: 'standing', is: 'equals', value: 'Open' } } },
      { key: 'obligations_overdue', label: 'Overdue', kind: 'computed', precision: 0, section: 'obligations', formula: { op: 'count_if', over: { records: OBLIGATIONS }, where: { column: 'standing', is: 'equals', value: 'Overdue' } } },
      { key: 'lessor', label: 'Lessor', kind: 'ref', target: 'party', section: 'lease', tier: 'situational', from: 'Lease deed' },
      { key: 'lease_start', label: 'Lease starts', kind: 'date', section: 'lease', tier: 'situational', from: 'Lease deed' },
      { key: 'lease_term', label: 'Term', kind: 'duration', unit: 'years', section: 'lease', tier: 'situational', from: 'Lease deed' },
      { key: 'lease_end', label: 'Lease ends', kind: 'computed', yields: 'date', section: 'lease', tier: 'situational', formula: { op: 'add_months', date: day('lease_start'), months: { op: 'multiply', left: fld('lease_term'), right: num(12) } } },
      { key: 'ground_rent', label: 'Ground rent, a year', kind: 'money', dimension: 'money', currency: 'INR', section: 'lease', tier: 'situational', required: false, from: 'Lease deed' },
      { key: 'consent_to_transfer', label: 'Lessor’s consent to transfer', kind: 'enum', control: 'segmented', optionSet: 'consent_held', section: 'lease', tier: 'situational' },
      { key: 'consent_to_mortgage', label: 'Lessor’s consent to mortgage', kind: 'enum', control: 'segmented', optionSet: 'consent_held', section: 'lease', tier: 'situational' },
      { key: 'consent_paper', label: 'Consent', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'lease', tier: 'situational', required: false },
      { key: 'build_by', label: 'To be built on by', kind: 'date', section: 'lease', tier: 'situational', required: false, expires: { leadDays: 365 }, from: 'Lease deed or allotment letter' },
    ],
    rules: [
      {
        kind: 'compare',
        fields: ['land_secured', 'land_on_parcel_check'],
        tolerance: 0.01,
        when: { records: PURCHASES, is: 'any' },
        say: 'The agreements bring in {a} and Title finds {b} clear of restriction: {divergence} apart, outside {tolerance}.',
        severity: 'high',
      },
      { kind: 'require_if', fields: ['consent_to_transfer', 'consent_paper'], whenIn: ['held'], say: 'The lessor’s consent to transfer is recorded as held, with no paper filed.', severity: 'medium' },
      { kind: 'require_if', fields: ['consent_to_mortgage', 'consent_paper'], whenIn: ['held'], say: 'The lessor’s consent to mortgage is recorded as held, with no paper filed.', severity: 'medium' },
    ],
  },
  {
    id: PURCHASES,
    fn: CONTRACTS,
    title: 'Land purchases',
    v: 1,
    records: { of: 'purchase', titleField: 'deal', summaryFields: ['instrument', 'extent_conveyed', 'standing'] },
    optionSets: [
      list('purchase_instrument', 'Instrument', [
        opt('mou', 'Memorandum of understanding'),
        opt('agreement_to_sell', 'Agreement to sell', 'warning'),
        opt('sale_deed', 'Sale deed', 'good'),
        opt('exchange', 'Exchange'),
        opt('lease', 'Lease'),
        opt('assignment', 'Assignment'),
        opt('cancellation', 'Cancellation', 'critical'),
      ]),
      list('signs_as', 'Signs as', [opt('self', 'Self'), opt('attorney', 'Attorney'), opt('guardian', 'Guardian'), opt('director', 'Director or partner')]),
    ],
    sections: [
      { key: 'paper', label: 'The paper' },
      { key: 'registration', label: 'Registration' },
      { key: 'terms', label: 'Terms' },
    ],
    fields: [
      { key: 'deal', label: 'Deal', kind: 'text', section: 'paper', hint: 'A name for it, as the firm calls it.' },
      { key: 'instrument', label: 'Instrument', kind: 'enum', optionSet: 'purchase_instrument', section: 'paper' },
      {
        key: 'vendors',
        label: 'Sellers',
        kind: 'table',
        section: 'paper',
        from: 'Deed',
        columns: [
          { key: 'party', label: 'Seller', kind: 'ref', target: 'party' },
          { key: 'share', label: 'Share', kind: 'percent', required: false },
          { key: 'signs_as', label: 'Signs as', kind: 'enum', optionSet: 'signs_as', required: false },
        ],
      },
      { key: 'purchaser', label: 'Purchaser', kind: 'ref', target: 'party', section: 'paper' },
      { key: 'agreement_date', label: 'Date of the paper', kind: 'date', section: 'paper', from: 'Deed', fromTypes: ['Agreement to sell', 'Sale deed'] },
      { key: 'deed', label: 'Deed', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'paper', proof: 'expected' },
      {
        key: 'doc_no',
        label: 'Document number',
        kind: 'text',
        section: 'registration',
        hint: 'Empty while the paper is not registered.',
        from: 'Sale deed',
        fromTypes: ['Sale deed'],
        factKey: 'document_number',
        requiredWhen: when(PURCHASES, CONTRACTS, 'instrument', 'in', ['sale_deed', 'exchange', 'lease']),
      },
      { key: 'sro', label: 'Sub-registrar office', kind: 'text', suggest: 'party', section: 'registration', from: 'Sale deed', fromTypes: ['Sale deed'], factKey: 'sub_registrar', requiredWhen: when(PURCHASES, CONTRACTS, 'instrument', 'in', ['sale_deed', 'exchange', 'lease']) },
      { key: 'registration_date', label: 'Registered on', kind: 'date', section: 'registration', from: 'Sale deed', fromTypes: ['Sale deed'], requiredWhen: when(PURCHASES, CONTRACTS, 'instrument', 'in', ['sale_deed', 'exchange', 'lease']) },
      { key: 'stamp_duty_paid', label: 'Stamp duty paid', kind: 'money', dimension: 'money', currency: 'INR', section: 'registration', required: false, from: 'Sale deed', fromTypes: ['Sale deed'], factKey: 'stamp_duty' },
      { key: 'schedule', label: 'Survey numbers conveyed', kind: 'table', section: 'terms', from: 'Schedule to the deed', columns: [{ key: 'parcel', label: 'Survey number', kind: 'ref', target: 'parcel' }] },
      { key: 'extent_conveyed', label: 'Extent conveyed', kind: 'area', dimension: 'area', enterIn: ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare'], section: 'terms', from: 'Deed', fromTypes: ['Sale deed', 'Agreement to sell'], factKey: 'extent_title', proof: 'expected' },
      { key: 'consideration', label: 'Consideration', kind: 'money', dimension: 'money', currency: 'INR', section: 'terms', from: 'Deed', fromTypes: ['Sale deed', 'Agreement to sell'], proof: 'expected' },
      {
        key: 'payment_terms',
        label: 'Payment terms',
        kind: 'table',
        section: 'terms',
        required: false,
        from: 'Agreement',
        columns: [
          { key: 'milestone', label: 'On', kind: 'text' },
          { key: 'payable_on', label: 'Payable on', kind: 'date', required: false },
          { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR' },
        ],
      },
      { key: 'long_stop_date', label: 'Day fixed for completion', kind: 'date', section: 'terms', required: false, expires: { leadDays: 30 }, from: 'Agreement', fromTypes: ['Agreement to sell'] },
      {
        key: 'suit_by',
        label: 'A suit to compel the sale is brought by',
        kind: 'computed',
        yields: 'date',
        section: 'terms',
        tier: 'situational',
        showWhen: when(PURCHASES, CONTRACTS, 'instrument', 'equals', 'agreement_to_sell'),
        expires: { leadDays: 180 },
        formula: { op: 'add_months', date: day('long_stop_date'), months: yearsAsMonths('specific_performance_suit_years') },
      },
      { key: 'possession_date', label: 'Possession delivered on', kind: 'date', section: 'terms', required: false, from: 'Possession letter' },
      {
        key: 'standing',
        label: 'Purchase',
        kind: 'status',
        section: 'paper',
        cases: [{ when: { kind: 'require_if', fields: ['possession_date', 'doc_no'], say: 'Possession was taken on {a} under a paper with no registration number recorded.', severity: 'high' }, label: 'Possession without registration', tone: 'critical' }],
        otherwise: { label: 'In order', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'require_if', fields: ['possession_date', 'doc_no'], say: 'Possession was taken on {a} under a paper with no registration number recorded.', severity: 'high' },
      { kind: 'before', fields: ['agreement_date', 'registration_date'], say: 'Registered on {b}, before the paper’s own date of {a}.', severity: 'medium' },
    ],
  },
  {
    id: OBLIGATIONS,
    fn: CONTRACTS,
    title: 'Conditions and obligations',
    v: 1,
    records: { of: 'obligation', titleField: 'kind', summaryFields: ['owed_by', 'due_on', 'standing'] },
    optionSets: [
      list('obligation_kind', 'Condition or obligation', [
        opt('clear_title', 'Clear a title requisition'),
        opt('family_consent', 'Consent of family members'),
        opt('conversion', 'Land conversion'),
        opt('khata', 'Khata transfer'),
        opt('vacate', 'Vacate occupants'),
        opt('taxes', 'Taxes paid to date'),
        opt('payment', 'A payment'),
        opt('possession', 'Deliver possession'),
        opt('plan_sanction', 'Obtain plan sanction'),
        opt('start_construction', 'Start construction'),
        opt('complete', 'Complete and hand over'),
        opt('refund_deposit', 'Refund the deposit'),
        opt('other', 'Other'),
      ]),
      list('arises_under', 'Arises under', [opt('land_purchase', 'A land purchase'), opt('joint_development', 'The joint development agreement'), opt('power_of_attorney', 'A power of attorney'), opt('sale_agreement', 'The agreement for sale')]),
    ],
    fields: [
      { key: 'kind', label: 'Condition or obligation', kind: 'enum', optionSet: 'obligation_kind' },
      { key: 'arises_under', label: 'Arises under', kind: 'enum', control: 'segmented', optionSet: 'arises_under' },
      { key: 'purchase', label: 'Purchase', kind: 'ref', target: { set: PURCHASES }, required: false, tier: 'situational', showWhen: when(OBLIGATIONS, CONTRACTS, 'arises_under', 'equals', 'land_purchase') },
      { key: 'clause', label: 'Clause', kind: 'text', required: false, hint: 'As numbered in the paper.' },
      { key: 'owed_by', label: 'Owed by', kind: 'ref', target: 'party' },
      { key: 'due_on', label: 'Due on', kind: 'date', required: false },
      { key: 'done_on', label: 'Done on', kind: 'date', required: false },
      { key: 'proof', label: 'Proof', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      {
        key: 'days_overdue',
        label: 'Days past due',
        kind: 'computed',
        precision: 0,
        unit: 'days',
        formula: { op: 'if', when: { field: 'done_on', is: 'set' }, then: num(0), else: notBelowZero(minus(TODAY, day('due_on'))) },
      },
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [
          { when: { kind: 'at_most', fields: ['days_overdue'], against: 0, say: 'Due {a} ago and not done.', severity: 'high' }, label: 'Overdue', tone: 'critical' },
          { when: { kind: 'require', fields: ['done_on'], say: 'Not done yet.', severity: 'low' }, label: 'Open', tone: 'info' },
        ],
        otherwise: { label: 'Done', tone: 'good' },
      },
    ],
    rules: [{ kind: 'require_if', fields: ['done_on', 'proof'], say: 'Marked done on {a}, with no proof filed.', severity: 'low' }],
  },
];

/* ==================================================================== */
/* Law: joint development and powers of attorney                         */
/* ==================================================================== */

const JDA_SETS: FieldSet[] = [
  {
    id: JDA,
    fn: CONTRACTS,
    title: 'Joint development: terms',
    v: 1,
    optionSets: [
      list('jda_model', 'Model', [opt('area_share', 'Area share', 'info'), opt('revenue_share', 'Revenue share', 'info'), opt('hybrid', 'Area and revenue', 'info'), opt('management_fee', 'Development management fee', 'neutral')]),
      list('share_basis', 'Share measured on', [
        opt('carpet_area', 'Carpet area', 'good'),
        opt('super_built_up_area', 'Super built-up area', 'warning'),
        opt('saleable_area', 'Saleable area', 'warning'),
        opt('gross_revenue', 'Gross revenue'),
        opt('net_revenue', 'Revenue net of taxes'),
      ]),
      list('deposit_refund_on', 'Refundable on', [opt('occupancy_certificate', 'Occupancy certificate'), opt('handover_of_owner_share', 'Handover of the owners’ share'), opt('set_off', 'Set off against revenue')]),
      list('mortgage_right', 'Right to mortgage', [opt('developer_share', 'Developer’s share only', 'good'), opt('whole_with_consent', 'Whole land, with the owners’ consent', 'warning'), opt('no_right', 'No right to mortgage', 'neutral')]),
      list('termination_event', 'Termination event', [
        opt('no_sanction', 'Sanction not obtained'),
        opt('not_started', 'Construction not started'),
        opt('stopped', 'Construction stopped'),
        opt('deposit_unpaid', 'Deposit unpaid'),
        opt('title_defect', 'Title defect'),
        opt('insolvency', 'Insolvency'),
      ]),
    ],
    sections: [
      { key: 'terms', label: 'Terms', showWhen: JOINT_DEVELOPMENT },
      { key: 'money', label: 'Deposits and compensation', showWhen: JOINT_DEVELOPMENT },
      { key: 'more', label: 'Mortgage, termination and disputes', showWhen: JOINT_DEVELOPMENT, tier: 'expert' },
    ],
    fields: [
      { key: 'developer', label: 'Developer', kind: 'ref', target: 'party', section: 'terms', tier: 'situational', from: 'Joint development agreement' },
      { key: 'jda_date', label: 'Date of the agreement', kind: 'date', section: 'terms', tier: 'situational', from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'jda_doc_no', label: 'Document number', kind: 'text', section: 'terms', tier: 'situational', hint: 'Empty while the agreement is not registered.', from: 'Joint development agreement', fromTypes: JDA_PAPER, factKey: 'document_number' },
      { key: 'jda_model', label: 'Model', kind: 'enum', control: 'tiles', optionSet: 'jda_model', section: 'terms', tier: 'situational' },
      { key: 'owner_share', label: 'Owners’ share', kind: 'percent', max: 100, precision: 2, section: 'terms', tier: 'situational', from: 'Joint development agreement', fromTypes: JDA_PAPER, proof: 'expected' },
      { key: 'developer_share', label: 'Developer’s share', kind: 'computed', unit: '%', section: 'terms', tier: 'situational', formula: minus(num(100), fld('owner_share')) },
      { key: 'share_basis', label: 'Share measured on', kind: 'enum', optionSet: 'share_basis', section: 'terms', tier: 'situational' },
      { key: 'land_extent', label: 'Land put into the agreement', kind: 'area', dimension: 'area', enterIn: ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare'], section: 'terms', tier: 'situational', from: 'Schedule to the agreement', fromTypes: JDA_PAPER },
      mirror('land_on_parcel_check', 'Extent clear of restriction, per Title', 'area', TITLE_CLEAR, { unit: 'sqm', section: 'terms', tier: 'situational' }),
      { key: 'agreement', label: 'Agreement, as signed', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'terms', tier: 'situational', proof: 'expected' },
      {
        key: 'jda_standing',
        label: 'Registration',
        kind: 'status',
        section: 'terms',
        tier: 'situational',
        cases: [{ when: { kind: 'require_if', fields: ['jda_date', 'jda_doc_no'], say: 'The agreement dated {a} has no registration number recorded.', severity: 'high' }, label: 'Not registered', tone: 'critical' }],
        otherwise: { label: 'Registered', tone: 'good' },
      },
      { key: 'refundable_deposit', label: 'Refundable deposit', kind: 'money', dimension: 'money', currency: 'INR', section: 'money', tier: 'situational', from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'non_refundable_deposit', label: 'Non-refundable amount', kind: 'money', dimension: 'money', currency: 'INR', section: 'money', tier: 'situational', required: false, from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'deposit_refund_on', label: 'Deposit refundable on', kind: 'enum', optionSet: 'deposit_refund_on', section: 'money', tier: 'situational' },
      { key: 'delay_compensation', label: 'Compensation for delay', kind: 'number', unit: 'INR a sq ft a month', section: 'money', tier: 'situational', required: false, from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'stamp_duty_paid', label: 'Stamp duty paid', kind: 'money', dimension: 'money', currency: 'INR', section: 'more', required: false, from: 'Stamp receipt' },
      { key: 'far_assumed', label: 'FAR the agreement assumes', kind: 'number', precision: 2, section: 'more', required: false, from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'mortgage_right', label: 'Right to mortgage', kind: 'enum', optionSet: 'mortgage_right', section: 'more', required: false },
      { key: 'termination_events', label: 'Termination events', kind: 'multi_enum', optionSet: 'termination_event', section: 'more', required: false },
      { key: 'dispute_forum', label: 'Dispute forum', kind: 'enum', control: 'segmented', options: ['arbitration', 'civil court'], section: 'more', required: false },
    ],
    rules: [
      { kind: 'require_if', fields: ['jda_date', 'jda_doc_no'], say: 'The agreement dated {a} has no registration number recorded.', severity: 'high' },
      { kind: 'compare', fields: ['land_extent', 'land_on_parcel_check'], tolerance: 0.01, say: 'The agreement brings in {a} and Title finds {b} clear of restriction: {divergence} apart, outside {tolerance}.', severity: 'high' },
      { kind: 'compare', fields: ['far_assumed', 'sanctioned'], at: { sanctioned: SANCTION_CHECK('sanctioned_far') }, tolerance: 0, say: 'The agreement assumes an FAR of {a} and {b} is sanctioned. Both shares are worked on the first.', severity: 'high' },
    ],
  },
  {
    id: JDA_DELIVERY,
    fn: CONTRACTS,
    title: 'Joint development: dates and shares',
    v: 1,
    sections: [
      { key: 'dates', label: 'Dates the agreement sets', showWhen: JOINT_DEVELOPMENT },
      { key: 'allocation', label: 'Allocation of units', showWhen: JOINT_DEVELOPMENT },
    ],
    fields: [
      { key: 'sanction_due_months', label: 'Plan sanction due within', kind: 'duration', unit: 'months', section: 'dates', tier: 'situational', from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'sanction_due', label: 'Plan sanction due by', kind: 'computed', yields: 'date', section: 'dates', tier: 'situational', formula: { op: 'add_months', date: day('jda_date', at(CONTRACTS, JDA, 'jda_date')), months: fld('sanction_due_months') } },
      mirror('sanction_date', 'Date of sanction', 'date', SANCTION_CHECK('sanction_date'), { section: 'dates', tier: 'situational' }),
      { key: 'build_months', label: 'Construction period', kind: 'duration', unit: 'months', section: 'dates', tier: 'situational', from: 'Joint development agreement', fromTypes: JDA_PAPER },
      { key: 'grace_months', label: 'Grace period', kind: 'duration', unit: 'months', section: 'dates', tier: 'situational', required: false, from: 'Joint development agreement', fromTypes: JDA_PAPER },
      {
        key: 'completion_due',
        label: 'Completion due by',
        kind: 'computed',
        yields: 'date',
        section: 'dates',
        tier: 'situational',
        formula: { op: 'add_months', date: day('sanction_date'), months: { op: 'add', left: fld('build_months'), right: notBelowZero(fld('grace_months')) } },
      },
      mirror('forecast_completion', 'Forecast completion', 'date', FORECAST_COMPLETION, { section: 'dates', tier: 'situational' }),
      {
        key: 'delivery_standing',
        label: 'Dates',
        kind: 'status',
        section: 'dates',
        tier: 'situational',
        cases: [
          { when: { kind: 'before', fields: ['sanction_date', 'sanction_due'], say: 'The plan was sanctioned on {a}, after the {b} the agreement allows.', severity: 'high' }, label: 'Sanction came late', tone: 'critical' },
          { when: { kind: 'before', fields: ['forecast_completion', 'completion_due'], say: 'Completion is forecast for {a}, after the {b} the agreement allows.', severity: 'high' }, label: 'Completion forecast late', tone: 'critical' },
        ],
        otherwise: { label: 'Within the agreement', tone: 'good' },
      },
      { key: 'allocation_agreement_on', label: 'Allocation agreement signed on', kind: 'date', section: 'allocation', tier: 'situational', from: 'Allocation agreement' },
      { key: 'owner_units', label: 'Units allotted to the owners', kind: 'computed', precision: 0, section: 'allocation', tier: 'situational', formula: { op: 'count_if', over: { records: UNIT }, where: { column: 'allotted_to', is: 'equals', value: 'owner' } } },
      { key: 'developer_units', label: 'Units allotted to the developer', kind: 'computed', precision: 0, section: 'allocation', tier: 'situational', formula: { op: 'count_if', over: { records: UNIT }, where: { column: 'allotted_to', is: 'equals', value: 'developer' } } },
      {
        key: 'owner_area_share',
        label: 'Owners’ share of the carpet area allotted',
        kind: 'computed',
        unit: '%',
        section: 'allocation',
        tier: 'situational',
        formula: {
          op: 'multiply',
          left: {
            op: 'divide',
            left: { op: 'sum_if', over: { records: UNIT }, column: 'carpet_area', where: { column: 'allotted_to', is: 'equals', value: 'owner' } },
            right: { op: 'sum_if', over: { records: UNIT }, column: 'carpet_area', where: { column: 'allotted_to', is: 'in', value: ['owner', 'developer'] } },
          },
          right: num(100),
        },
      },
      mirror('owner_share_agreed', 'Owners’ share in the agreement', 'percent', at(CONTRACTS, JDA, 'owner_share'), { section: 'allocation', tier: 'situational' }),
    ],
    rules: [
      { kind: 'before', fields: ['sanction_date', 'sanction_due'], say: 'The plan was sanctioned on {a}, after the {b} the agreement allows.', severity: 'high' },
      { kind: 'before', fields: ['forecast_completion', 'completion_due'], say: 'Completion is forecast for {a}, after the {b} the agreement allows.', severity: 'high' },
      {
        kind: 'compare',
        fields: ['owner_area_share', 'owner_share_agreed'],
        tolerance: 0.01,
        when: when(JDA, CONTRACTS, 'jda_model', 'in', ['area_share', 'hybrid']),
        say: 'The units allotted give the owners {a} of the carpet area and the agreement gives them {b}: {divergence} apart, outside {tolerance}.',
        severity: 'high',
      },
    ],
  },
  {
    id: 'legal.contracts.unit_allocation',
    fn: CONTRACTS,
    title: 'Allocation under the joint development',
    v: 1,
    extends: UNIT,
    optionSets: [list('jda_side', 'Allotted to', [opt('owner', 'Land owners'), opt('developer', 'Developer')])],
    fields: [{ key: 'allotted_to', label: 'Allotted to', kind: 'enum', control: 'segmented', optionSet: 'jda_side', required: false, tier: 'situational', showWhen: JOINT_DEVELOPMENT, from: 'Allocation agreement' }],
    rules: [],
  },
  {
    id: ATTORNEYS,
    fn: CONTRACTS,
    title: 'Powers of attorney',
    v: 1,
    records: { of: 'power of attorney', titleField: 'principal', summaryFields: ['attorney', 'dated', 'standing'] },
    optionSets: [
      list('attorney_power', 'Power', [
        opt('apply_for_approvals', 'Apply for approvals'),
        opt('sell_developer_share', 'Sell the developer’s share'),
        opt('mortgage_developer_share', 'Mortgage the developer’s share'),
        opt('execute_sale_deeds', 'Execute sale deeds'),
        opt('appear_before_authorities', 'Appear before authorities'),
        opt('receive_money', 'Receive money'),
      ]),
      list('attorney_force', 'In force', [opt('in_force', 'In force', 'good'), opt('revoked', 'Revoked', 'critical'), opt('principal_died', 'Principal has died', 'critical')]),
    ],
    fields: [
      { key: 'principal', label: 'Principal', kind: 'ref', target: 'party', fromTypes: ['Power of attorney'] },
      { key: 'attorney', label: 'Attorney', kind: 'ref', target: 'party', fromTypes: ['Power of attorney'] },
      { key: 'dated', label: 'Dated', kind: 'date', from: 'Power of attorney', fromTypes: ['Power of attorney'], factKey: 'executed_on' },
      { key: 'doc_no', label: 'Document number', kind: 'text', required: false, hint: 'Empty while it is not registered.', from: 'Power of attorney', fromTypes: ['Power of attorney'], factKey: 'document_number' },
      { key: 'powers', label: 'Powers granted', kind: 'multi_enum', optionSet: 'attorney_power' },
      { key: 'force', label: 'In force', kind: 'enum', control: 'segmented', optionSet: 'attorney_force' },
      { key: 'principal_confirmed_on', label: 'Principal last confirmed living on', kind: 'date', required: false },
      { key: 'replaced_by', label: 'Replaced by', kind: 'ref', target: { set: ATTORNEYS }, required: false, tier: 'situational', showWhen: when(ATTORNEYS, CONTRACTS, 'force', 'in', ['revoked', 'principal_died']) },
      { key: 'paper', label: 'Paper', kind: 'evidence', accepts: 'document', viewer: 'deed', required: false },
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [{ when: { kind: 'require_if', fields: ['force', 'replaced_by'], whenIn: ['revoked', 'principal_died'], say: 'This power of attorney has fallen away ({a}) and nothing replaces it.', severity: 'critical' }, label: 'Fallen away, not replaced', tone: 'critical' }],
        otherwise: { label: 'In order', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'require_if', fields: ['force', 'replaced_by'], whenIn: ['revoked', 'principal_died'], say: 'This power of attorney has fallen away ({a}) and nothing replaces it.', severity: 'critical' },
      { kind: 'require_if', fields: ['dated', 'doc_no'], say: 'The power of attorney dated {a} has no registration number recorded.', severity: 'medium' },
    ],
  },
];

/* ==================================================================== */
/* Law: the agreement for sale, and conveyance                           */
/* ==================================================================== */

const CUSTOMER_SETS: FieldSet[] = [
  {
    id: SALE_AGREEMENT,
    fn: CONTRACTS,
    title: 'Agreement for sale',
    v: 1,
    optionSets: [
      list('agreement_departure', 'Departs on', [
        opt('possession_date', 'Possession date'),
        opt('interest', 'Interest'),
        opt('forfeiture', 'Forfeiture'),
        opt('carpet_area_variation', 'Variation in carpet area'),
        opt('defects', 'Defects'),
        opt('common_areas', 'Common areas'),
        opt('assignment', 'Assignment'),
        opt('forum', 'Forum'),
      ]),
    ],
    situations: [
      {
        key: 'sale_agreement_departs_from_model',
        label: 'The agreement departs from the notified form',
        scope: 'function',
        derive: when(SALE_AGREEMENT, CONTRACTS, 'follows_model', 'false'),
      },
    ],
    sections: [
      { key: 'template', label: 'The form offered to buyers' },
      { key: 'departures', label: 'Departures from the notified form', showWhen: { situation: 'sale_agreement_departs_from_model' } },
    ],
    fields: [
      { key: 'template', label: 'Agreement for sale, as offered', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'template' },
      { key: 'version', label: 'Version', kind: 'text', section: 'template' },
      { key: 'follows_model', label: 'Follows the notified form', kind: 'boolean', control: 'switch', section: 'template' },
      { key: 'possession_promised', label: 'Possession promised by', kind: 'date', section: 'template', from: 'Agreement for sale' },
      mirror('declared_completion', 'Completion declared to the Authority', 'date', at(RERA, REGISTRATION, 'declared_completion'), { section: 'template' }),
      { key: 'delay_interest_spread', label: 'Interest for delay, over the State Bank’s lending rate', kind: 'computed', unit: '%', section: 'template', formula: rate('rera_delay_interest_spread') },
      {
        key: 'agreement_standing',
        label: 'Standing',
        kind: 'status',
        section: 'template',
        cases: [
          { when: { kind: 'before', fields: ['declared_completion', 'possession_promised'], say: 'Buyers are promised possession by {b}, before the {a} declared to the Authority.', severity: 'high' }, label: 'Possession promised too early', tone: 'critical' },
          { when: { kind: 'require_if', fields: ['follows_model', 'departures_approved_by'], whenIn: ['false'], say: 'The agreement departs from the notified form and nobody is recorded as approving the departures.', severity: 'medium' }, label: 'Departures not approved', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'departs_on', label: 'Departs on', kind: 'multi_enum', optionSet: 'agreement_departure', section: 'departures', tier: 'situational' },
      { key: 'forfeit_share', label: 'Forfeited on cancellation', kind: 'percent', max: 100, section: 'departures', tier: 'situational', required: false, from: 'Agreement for sale' },
      { key: 'forfeit_most', label: 'Most a court has let a promoter forfeit', kind: 'computed', unit: '%', section: 'departures', tier: 'situational', formula: rate('earnest_forfeit_most') },
      { key: 'interest_on_buyer', label: 'Interest the buyer pays on a late instalment', kind: 'percent', precision: 2, section: 'departures', tier: 'situational', required: false, from: 'Agreement for sale' },
      { key: 'interest_on_promoter', label: 'Interest the promoter pays on delay', kind: 'percent', precision: 2, section: 'departures', tier: 'situational', required: false, from: 'Agreement for sale' },
      { key: 'departures_approved_by', label: 'Departures approved by', kind: 'ref', target: 'party', section: 'departures', tier: 'situational' },
      { key: 'departures_approved_on', label: 'Approved on', kind: 'date', section: 'departures', tier: 'situational', required: false },
    ],
    rules: [
      { kind: 'before', fields: ['declared_completion', 'possession_promised'], say: 'Buyers are promised possession by {b}, before the {a} declared to the Authority.', severity: 'high' },
      { kind: 'require_if', fields: ['follows_model', 'departures_approved_by'], whenIn: ['false'], say: 'The agreement departs from the notified form and nobody is recorded as approving the departures.', severity: 'medium' },
      { kind: 'at_most', fields: ['forfeit_share', 'forfeit_most'], say: 'The agreement forfeits {a} on cancellation; a court has let a promoter keep {b}.', severity: 'medium' },
      { kind: 'compare', fields: ['interest_on_buyer', 'interest_on_promoter'], tolerance: 0, say: 'The buyer pays {a} on a late instalment and the promoter {b} on delay. The Act asks for the same rate both ways.', severity: 'medium' },
    ],
  },
  {
    id: CONVEYANCE,
    fn: HANDOVER,
    title: 'Conveyance and handover',
    v: 1,
    optionSets: [
      list('association_law', 'Registered under', [
        opt('apartment_ownership', 'Apartment ownership law'),
        opt('societies_registration', 'Societies registration law'),
        opt('cooperative_societies', 'Co-operative societies law'),
        opt('company', 'Companies law'),
      ]),
      list('handover_paper', 'Paper handed over', [
        opt('sanctioned_plans', 'Sanctioned plans'),
        opt('occupancy_certificate', 'Occupancy certificate'),
        opt('structural_drawings', 'Structural drawings'),
        opt('service_drawings', 'Service drawings'),
        opt('nocs', 'NOCs and clearances'),
        opt('warranties', 'Warranties'),
        opt('lift_licences', 'Lift licences'),
        opt('consent_to_operate', 'Consent to operate'),
        opt('accounts', 'Accounts'),
      ]),
    ],
    sections: [
      { key: 'conveyance', label: 'Conveyance of common areas' },
      { key: 'association', label: 'Association of allottees' },
      { key: 'handover', label: 'Papers handed over' },
    ],
    fields: [
      mirror('oc_date', 'Date of the occupancy certificate', 'date', OCCUPANCY_CHECK('oc_date'), { section: 'conveyance' }),
      { key: 'conveyance_due', label: 'Conveyance due by', kind: 'computed', yields: 'date', section: 'conveyance', formula: { op: 'add_months', date: day('oc_date'), months: rate('rera_conveyance_months') } },
      { key: 'conveyed_on', label: 'Common areas conveyed on', kind: 'date', section: 'conveyance', required: false, from: 'Conveyance deed' },
      { key: 'conveyance_deed', label: 'Conveyance deed', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'conveyance', required: false },
      {
        key: 'conveyance_days_late',
        label: 'Days past the day conveyance was due',
        kind: 'computed',
        precision: 0,
        unit: 'days',
        section: 'conveyance',
        formula: { op: 'if', when: { field: 'conveyed_on', is: 'set' }, then: overBy(minus(day('conveyed_on'), day('conveyance_due'))), else: overBy(minus(TODAY, day('conveyance_due'))) },
      },
      {
        key: 'conveyance_standing',
        label: 'Conveyance',
        kind: 'status',
        section: 'conveyance',
        cases: [{ when: { kind: 'at_most', fields: ['conveyance_days_late'], against: 0, say: 'Conveyance of the common areas is {a} past the day it was due.', severity: 'high' }, label: 'Late', tone: 'critical' }],
        otherwise: { label: 'In time', tone: 'good' },
      },
      { key: 'association', label: 'Association', kind: 'ref', target: 'party', section: 'association', required: false },
      { key: 'association_law', label: 'Registered under', kind: 'enum', optionSet: 'association_law', section: 'association', required: false },
      { key: 'association_registration_no', label: 'Registration number', kind: 'text', section: 'association', required: false, from: 'Registration certificate' },
      { key: 'association_registered_on', label: 'Registered on', kind: 'date', section: 'association', required: false, from: 'Registration certificate' },
      { key: 'declaration_deed_no', label: 'Deed of declaration, document number', kind: 'text', section: 'association', required: false, from: 'Deed of declaration' },
      { key: 'handed_over', label: 'Handed to the association', kind: 'multi_enum', optionSet: 'handover_paper', section: 'handover', required: false, from: 'Handover letter' },
      { key: 'handover_letter', label: 'Handover letter', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'handover', tier: 'expert', required: false },
    ],
    rules: [
      { kind: 'at_most', fields: ['conveyance_days_late'], against: 0, say: 'Conveyance of the common areas is {a} past the day it was due.', severity: 'high' },
      { kind: 'require_if', fields: ['conveyed_on', 'conveyance_deed'], say: 'The common areas are recorded as conveyed on {a}, with no deed filed.', severity: 'medium' },
    ],
  },
];

/* ==================================================================== */
/* Law: RERA                                                             */
/* ==================================================================== */

const RERA_PAPER = ['RERA registration certificate'];

const RERA_SETS: FieldSet[] = [
  {
    id: REGISTRATION,
    fn: RERA,
    title: 'RERA registration',
    v: 1,
    optionSets: [
      list('project_kind', 'Project type', [opt('plotted', 'Plotted development'), opt('group_housing', 'Group housing'), opt('villa', 'Villas'), opt('commercial', 'Commercial'), opt('mixed', 'Mixed'), opt('industrial', 'Industrial')]),
      list('certifier_role', 'Role', [opt('architect', 'Architect'), opt('engineer', 'Engineer'), opt('chartered_accountant', 'Chartered accountant'), opt('structural', 'Structural consultant'), opt('mep', 'Services consultant'), opt('contractor', 'Contractor')]),
      list('development_work', 'Development work', [
        opt('internal_roads', 'Internal roads'),
        opt('water_supply', 'Water supply'),
        opt('sewerage', 'Sewerage'),
        opt('storm_drains', 'Storm drains'),
        opt('landscaping', 'Landscaping'),
        opt('street_lighting', 'Street lighting'),
        opt('community_buildings', 'Community buildings'),
        opt('sewage_treatment', 'Sewage treatment'),
        opt('solid_waste', 'Solid waste'),
        opt('rainwater_harvesting', 'Rainwater harvesting'),
        opt('energy_management', 'Energy management'),
        opt('fire_protection', 'Fire protection'),
        opt('substation', 'Electrical substation'),
        opt('other', 'Other'),
      ]),
    ],
    situations: [
      { key: 'rera_registered', label: 'Registered with RERA', scope: 'project', hint: 'A registration number is recorded.', derive: when(REGISTRATION, RERA, 'registration_no', 'set') },
      { key: 'rera_validity_short', label: 'Registration running out', scope: 'function', hint: 'The registration ends within six months, has ended, or has been extended.', derive: { any: [when(REGISTRATION, RERA, 'validity_days_left', 'lt', 181), when(REGISTRATION, RERA, 'extended_to', 'set')] } },
      { key: 'phased', label: 'Registered in phases', scope: 'project', hint: 'Two or more phases are recorded, each a registration of its own.', derive: { records: PHASES, is: 'at_least', n: 2 } },
    ],
    sections: [
      { key: 'registration', label: 'Registration' },
      { key: 'extension', label: 'Extension', showWhen: { situation: 'rera_validity_short' } },
      { key: 'landowners', label: 'Land owners as promoters', showWhen: JOINT_DEVELOPMENT },
      { key: 'need', label: 'Whether registration is needed', tier: 'expert' },
      { key: 'application', label: 'On the application', tier: 'expert' },
    ],
    fields: [
      { key: 'promoter', label: 'Promoter', kind: 'ref', target: 'party', section: 'registration', from: 'Application' },
      { key: 'application_no', label: 'Application number', kind: 'text', section: 'registration', from: 'Acknowledgement', fromTypes: RERA_PAPER, factKey: 'rera_acknowledgement' },
      { key: 'applied_on', label: 'Applied on', kind: 'date', section: 'registration', from: 'Acknowledgement' },
      { key: 'registration_no', label: 'Registration number', kind: 'text', section: 'registration', from: 'Registration certificate', fromTypes: RERA_PAPER, factKey: 'rera_number', proof: 'expected' },
      { key: 'registered_on', label: 'Registered on', kind: 'date', section: 'registration', from: 'Registration certificate', fromTypes: RERA_PAPER, factKey: 'rera_approved_on' },
      { key: 'registration_valid_to', label: 'Valid to, as first granted', kind: 'date', section: 'registration', from: 'Registration certificate', fromTypes: RERA_PAPER, factKey: 'rera_valid_until' },
      { key: 'declared_completion', label: 'Completion declared to the Authority', kind: 'date', section: 'registration', from: 'Promoter’s declaration' },
      {
        key: 'validity_days_left',
        label: 'Days of registration left',
        kind: 'computed',
        precision: 0,
        unit: 'days',
        section: 'registration',
        formula: minus({ op: 'max', of: [day('registration_valid_to'), day('extended_to')] }, TODAY),
      },
      { key: 'designated_account', label: 'Designated account', kind: 'ref', target: 'account', section: 'registration' },
      {
        key: 'professionals',
        label: 'Certifying professionals',
        kind: 'table',
        section: 'registration',
        from: 'Certificates filed with the application',
        columns: [
          { key: 'role', label: 'Role', kind: 'enum', optionSet: 'certifier_role' },
          { key: 'party', label: 'Who', kind: 'ref', target: 'party' },
          { key: 'registration_no', label: 'Registration number', kind: 'text', required: false },
        ],
      },
      { key: 'certificate', label: 'Registration certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'registration' },
      {
        key: 'registration_standing',
        label: 'Registration',
        kind: 'status',
        section: 'registration',
        cases: [
          { when: { kind: 'at_least', fields: ['validity_days_left'], against: 0, say: 'The registration has run out.', severity: 'critical' }, label: 'Run out', tone: 'critical' },
          { when: { kind: 'before', fields: ['declared_completion', 'registration_valid_to'], say: 'Completion is declared for {a}, after the registration ends on {b}.', severity: 'high' }, label: 'Ends before the declared completion', tone: 'critical' },
          { when: { kind: 'require', fields: ['registration_no'], say: 'No registration number is recorded.', severity: 'medium' }, label: 'Applied, not registered', tone: 'warning' },
        ],
        otherwise: { label: 'Registered', tone: 'good' },
      },
      { key: 'extension_applied_on', label: 'Extension applied for on', kind: 'date', section: 'extension', tier: 'situational', required: false },
      { key: 'extension_ground', label: 'Ground', kind: 'enum', control: 'segmented', options: ['force majeure', 'other reasons'], section: 'extension', tier: 'situational', required: false },
      { key: 'extended_to', label: 'Extended to', kind: 'date', section: 'extension', tier: 'situational', required: false, from: 'Extension order' },
      { key: 'extension_limit', label: 'Latest day an extension may reach', kind: 'computed', yields: 'date', section: 'extension', tier: 'situational', formula: { op: 'add_months', date: day('registration_valid_to'), months: rate('rera_extension_most_months') } },
      {
        key: 'landowner_promoters',
        label: 'Land owners named as promoters',
        kind: 'table',
        section: 'landowners',
        tier: 'situational',
        required: false,
        from: 'Application',
        columns: [
          { key: 'party', label: 'Land owner', kind: 'ref', target: 'party' },
          { key: 'share', label: 'Share', kind: 'percent', required: false },
        ],
      },
      mirror('land_area', 'Land area in the title deeds', 'area', EXTENT_TITLE, { unit: 'sqm', section: 'need' }),
      mirror('units_total', 'Units in the scheme', 'number', at('commercial.market', 'commercial_market.absorption', 'units_total'), { section: 'need' }),
      {
        key: 'units_over_floor',
        label: 'Units over the size that needs no registration',
        kind: 'computed',
        precision: 0,
        section: 'need',
        hint: 'Nothing where the land itself is within the size that needs none.',
        formula: {
          op: 'if',
          when: { left: fld('land_area'), is: 'lte', right: rate('rera_registration_land_floor') },
          then: num(0),
          else: overBy(minus(fld('units_total'), rate('rera_registration_units_floor'))),
        },
      },
      {
        key: 'registration_needed',
        label: 'Registration',
        kind: 'status',
        section: 'need',
        cases: [{ when: { kind: 'at_most', fields: ['units_over_floor'], against: 0, say: 'The project is {a} unit(s) over the size that needs no registration.', severity: 'low' }, label: 'Needed', tone: 'info' }],
        otherwise: { label: 'Not needed at this size', tone: 'neutral' },
      },
      { key: 'project_kind', label: 'Project type', kind: 'enum', optionSet: 'project_kind', section: 'application', required: false },
      { key: 'development_works', label: 'Development works proposed', kind: 'multi_enum', optionSet: 'development_work', section: 'application', required: false },
      { key: 'proformas', label: 'Proformas filed', kind: 'multi_enum', options: ['allotment letter', 'agreement for sale', 'conveyance deed'], section: 'application', required: false },
      {
        key: 'past_projects',
        label: 'Promoter’s projects in the last five years',
        kind: 'table',
        section: 'application',
        required: false,
        from: 'Application',
        columns: [
          { key: 'name', label: 'Project', kind: 'text' },
          { key: 'completed', label: 'Completed', kind: 'boolean', required: false },
          { key: 'delay_months', label: 'Delay', kind: 'number', unit: 'months', required: false },
          { key: 'cases_pending', label: 'Cases pending', kind: 'number', required: false },
        ],
      },
    ],
    rules: [
      { kind: 'before', fields: ['declared_completion', 'registration_valid_to'], say: 'Completion is declared for {a}, after the registration ends on {b}.', severity: 'high' },
      { kind: 'before', fields: ['forecast', 'declared_completion'], at: { forecast: FORECAST_COMPLETION }, say: 'Completion is forecast for {a}, after the {b} declared to the Authority.', severity: 'high' },
      { kind: 'before', fields: ['applied_on', 'registered_on'], say: 'Registered on {b}, before it was applied for on {a}.', severity: 'medium' },
      { kind: 'before', fields: ['extended_to', 'extension_limit'], say: 'Extended to {a}, past the {b} the Act allows in all.', severity: 'high' },
    ],
  },
  {
    id: PHASES,
    fn: RERA,
    title: 'Phases',
    v: 1,
    records: { of: 'phase', titleField: 'name', summaryFields: ['registration_no', 'valid_to'] },
    fields: [
      { key: 'name', label: 'Phase', kind: 'text' },
      { key: 'registration_no', label: 'Registration number', kind: 'text', from: 'Registration certificate' },
      { key: 'valid_to', label: 'Valid to', kind: 'date', expires: { leadDays: 180 }, from: 'Registration certificate' },
      { key: 'declared_completion', label: 'Completion declared to the Authority', kind: 'date' },
      { key: 'designated_account', label: 'Designated account', kind: 'ref', target: 'account' },
      { key: 'sanction', label: 'Plan sanction', kind: 'ref', target: 'approval', required: false },
      { key: 'certificate', label: 'Registration certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
    ],
    rules: [{ kind: 'before', fields: ['declared_completion', 'valid_to'], say: 'Completion is declared for {a}, after this phase’s registration ends on {b}.', severity: 'high' }],
  },
  {
    id: COMPLIANCE,
    fn: RERA,
    title: 'RERA compliance',
    v: 1,
    sections: [
      { key: 'filings', label: 'Filings', showWhen: { situation: 'rera_registered' } },
      { key: 'position', label: 'What the next filing will say', showWhen: { situation: 'rera_registered' } },
    ],
    fields: [
      { key: 'filings_made', label: 'Filed', kind: 'computed', precision: 0, section: 'filings', tier: 'situational', formula: { op: 'count_if', over: { records: FILINGS }, where: { column: 'filed_on', is: 'set' } } },
      { key: 'filings_open', label: 'Open', kind: 'computed', precision: 0, section: 'filings', tier: 'situational', formula: { op: 'count_if', over: { records: FILINGS }, where: { column: 'standing', is: 'equals', value: 'Open' } } },
      { key: 'filings_overdue', label: 'Overdue', kind: 'computed', precision: 0, section: 'filings', tier: 'situational', formula: { op: 'count_if', over: { records: FILINGS }, where: { column: 'standing', is: 'equals', value: 'Overdue' } } },
      mirror('units_total', 'Units in the scheme', 'number', at('commercial.market', 'commercial_market.absorption', 'units_total'), { section: 'position', tier: 'situational' }),
      mirror('units_booked', 'Units sold', 'number', at('commercial.market', 'commercial_market.absorption', 'units_sold'), { section: 'position', tier: 'situational' }),
      mirror('cost_incurred', 'Spent to date', 'money', at('finance.budget', 'cost_quantity.budget_current', 'spent_to_date'), { unit: 'INR', section: 'position', tier: 'situational' }),
      mirror('construction_complete', 'Actual progress', 'percent', at('construction.progress', 'schedule_progress.planned_vs_actual', 'actual_percent'), { section: 'position', tier: 'situational' }),
      { key: 'deposit_share', label: 'Share of buyers’ money kept in the designated account', kind: 'computed', unit: '%', section: 'position', tier: 'situational', formula: rate('rera_deposit_share') },
    ],
    rules: [],
  },
  {
    id: FILINGS,
    fn: RERA,
    title: 'Filings',
    v: 1,
    records: { of: 'filing', titleField: 'period_end', summaryFields: ['kind', 'filing_due', 'standing'] },
    optionSets: [list('rera_filing_kind', 'Filing', [opt('quarterly', 'Quarterly update'), opt('annual', 'Annual audited statement')])],
    fields: [
      { key: 'period_end', label: 'Period ending', kind: 'date' },
      { key: 'kind', label: 'Filing', kind: 'enum', control: 'segmented', optionSet: 'rera_filing_kind' },
      {
        key: 'filing_due',
        label: 'Due by',
        kind: 'computed',
        yields: 'date',
        formula: {
          op: 'if',
          when: { field: 'kind', is: 'equals', value: 'annual' },
          then: { op: 'add_months', date: day('period_end'), months: rate('rera_annual_report_months') },
          else: { op: 'add_days', date: day('period_end'), days: rate('rera_quarterly_filing_days') },
        },
      },
      { key: 'filed_on', label: 'Filed on', kind: 'date', required: false, from: 'Portal acknowledgement' },
      { key: 'accountant_certificate', label: 'Chartered accountant’s certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      { key: 'architect_certificate', label: 'Architect’s certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, tier: 'situational', showWhen: when(FILINGS, RERA, 'kind', 'equals', 'quarterly') },
      { key: 'engineer_certificate', label: 'Engineer’s certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, tier: 'situational', showWhen: when(FILINGS, RERA, 'kind', 'equals', 'quarterly') },
      { key: 'acknowledgement', label: 'Acknowledgement', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      { key: 'days_overdue', label: 'Days past due, not filed', kind: 'computed', precision: 0, unit: 'days', formula: { op: 'if', when: { field: 'filed_on', is: 'set' }, then: num(0), else: notBelowZero(minus(TODAY, day('filing_due'))) } },
      { key: 'days_late', label: 'Days filed late', kind: 'computed', precision: 0, unit: 'days', formula: { op: 'if', when: { field: 'filed_on', is: 'set' }, then: notBelowZero(minus(day('filed_on'), day('filing_due'))), else: num(0) } },
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [
          { when: { kind: 'at_most', fields: ['days_overdue'], against: 0, say: 'Due {a} ago and not filed.', severity: 'critical' }, label: 'Overdue', tone: 'critical' },
          { when: { kind: 'require', fields: ['filed_on'], say: 'Not filed yet.', severity: 'low' }, label: 'Open', tone: 'info' },
          { when: { kind: 'at_most', fields: ['days_late'], against: 0, say: 'Filed {a} late.', severity: 'medium' }, label: 'Filed late', tone: 'warning' },
        ],
        otherwise: { label: 'Filed in time', tone: 'good' },
      },
    ],
    rules: [{ kind: 'require_if', fields: ['filed_on', 'acknowledgement'], say: 'Recorded as filed on {a}, with no acknowledgement on file.', severity: 'low' }],
  },
];

/* ==================================================================== */
/* Liaison: the approval record and the register                         */
/* ==================================================================== */

const standingIs = (...values: string[]): ShowWhen => when(APPROVAL, SHARED, 'standing', 'in', values);

const REGISTER_SETS: FieldSet[] = [
  {
    id: 'legal.approvals.approval',
    fn: APPROVALS,
    title: 'Approval: application, follow-up and validity',
    v: 1,
    extends: APPROVAL,
    optionSets: [
      list('approval_needed_before', 'Needed before', [
        opt('land_purchase', 'Land purchase'),
        opt('plan_sanction', 'Plan sanction'),
        opt('commencement', 'Commencement'),
        opt('during_construction', 'During construction'),
        opt('occupancy', 'Occupancy'),
        opt('handover', 'Handover'),
        opt('operation', 'Operation'),
      ]),
      list('query_about', 'About', [opt('documents', 'Documents'), opt('drawings', 'Drawings'), opt('fees', 'Fees'), opt('title', 'Title'), opt('site', 'Site inspection'), opt('technical', 'A technical point'), opt('other', 'Other')]),
      list('follow_up_mode', 'By', [opt('visit', 'Visit'), opt('call', 'Call'), opt('portal', 'Portal'), opt('letter', 'Letter')]),
      list('follow_up_outcome', 'Outcome', [
        opt('pending_at_desk', 'Pending at the desk'),
        opt('query_raised', 'Query raised', 'warning'),
        opt('inspection_fixed', 'Inspection fixed', 'info'),
        opt('file_moved', 'File moved', 'info'),
        opt('approved', 'Approved', 'good'),
        opt('rejected', 'Rejected', 'critical'),
      ]),
    ],
    sections: [
      { key: 'application', label: 'Application' },
      { key: 'trail', label: 'With the authority', showWhen: standingIs('applied', 'query_raised') },
      { key: 'fees', label: 'Fees and deposits' },
      { key: 'validity', label: 'Validity and renewal', showWhen: standingIs('in_hand', 'expired') },
    ],
    fields: [
      { key: 'needed_before', label: 'Needed before', kind: 'enum', optionSet: 'approval_needed_before', section: 'application', required: false },
      { key: 'applicant', label: 'Applicant', kind: 'ref', target: 'party', section: 'application', required: false },
      { key: 'application_no', label: 'Application number', kind: 'text', section: 'application', required: false, from: 'Acknowledgement' },
      { key: 'depends_on', label: 'Depends on', kind: 'table', section: 'application', required: false, columns: [{ key: 'approval', label: 'Approval', kind: 'ref', target: 'approval' }] },
      { key: 'decision_due', label: 'Decision due by', kind: 'date', section: 'trail', tier: 'situational', required: false, from: 'Acknowledgement' },
      {
        key: 'queries',
        label: 'Queries from the authority',
        kind: 'table',
        section: 'trail',
        tier: 'situational',
        required: false,
        from: 'Query letters',
        columns: [
          { key: 'raised_on', label: 'Raised on', kind: 'date' },
          { key: 'about', label: 'About', kind: 'enum', optionSet: 'query_about' },
          { key: 'replied_on', label: 'Replied on', kind: 'date', required: false },
        ],
      },
      {
        key: 'follow_ups',
        label: 'Follow-ups',
        kind: 'table',
        display: 'timeline',
        section: 'trail',
        tier: 'situational',
        required: false,
        columns: [
          { key: 'on', label: 'Date', kind: 'date' },
          { key: 'with', label: 'With', kind: 'text', hint: 'The desk or designation.' },
          { key: 'mode', label: 'By', kind: 'enum', optionSet: 'follow_up_mode' },
          { key: 'outcome', label: 'Outcome', kind: 'enum', optionSet: 'follow_up_outcome' },
          { key: 'next_on', label: 'Next action on', kind: 'date', required: false },
        ],
      },
      {
        key: 'fees',
        label: 'Fees and deposits',
        kind: 'table',
        section: 'fees',
        required: false,
        from: 'Demand notes and challans',
        columns: [
          { key: 'head', label: 'Head', kind: 'text' },
          { key: 'demand_no', label: 'Demand number', kind: 'text', required: false },
          { key: 'amount', label: 'Amount', kind: 'money', currency: 'INR' },
          { key: 'paid_on', label: 'Paid on', kind: 'date', required: false },
        ],
      },
      { key: 'fees_total', label: 'Fees demanded', kind: 'computed', dimension: 'money', currency: 'INR', section: 'fees', formula: { op: 'sum', table: 'fees', column: 'amount' } },
      { key: 'days_left', label: 'Days of validity left', kind: 'computed', precision: 0, unit: 'days', section: 'validity', tier: 'situational', formula: minus(day('valid_until'), TODAY) },
      { key: 'renewal_lead', label: 'Apply for renewal this long before', kind: 'duration', unit: 'days', section: 'validity', tier: 'situational', required: false },
      { key: 'renew_by', label: 'Apply for renewal by', kind: 'computed', yields: 'date', section: 'validity', tier: 'situational', formula: { op: 'add_days', date: day('valid_until'), days: minus(num(0), fld('renewal_lead')) } },
    ],
    rules: [
      { kind: 'require_if', fields: ['standing', 'paper'], whenIn: ['in_hand'], say: 'Recorded as in hand, with no paper filed against it.', severity: 'medium' },
      { kind: 'at_least', fields: ['days_left'], against: 0, when: standingIs('in_hand'), say: 'Recorded as in hand, and its validity has run out.', severity: 'high' },
    ],
  },
  {
    id: REGISTER,
    fn: APPROVALS,
    title: 'Approvals register',
    v: 1,
    situations: [
      {
        key: 'stop_work_order',
        label: 'A stop-work order is in force',
        scope: 'project',
        hint: 'An authority has ordered work to stop, and the order has not been lifted.',
        derive: { records: STOP_ORDERS, is: 'any', where: { column: 'force', is: 'equals', value: 'in_force' } },
      },
    ],
    sections: [
      { key: 'register', label: 'Where the approvals stand' },
      { key: 'more', label: 'Who follows up', tier: 'expert' },
    ],
    fields: [
      { key: 'approvals_recorded', label: 'Approvals recorded', kind: 'computed', precision: 0, section: 'register', formula: { op: 'records', set: APPROVAL, reduce: 'count' } },
      { key: 'in_hand', label: 'In hand', kind: 'computed', precision: 0, section: 'register', formula: { op: 'count_if', over: { records: APPROVAL }, where: { column: 'standing', is: 'equals', value: 'in_hand' } } },
      { key: 'with_authority', label: 'With the authority', kind: 'computed', precision: 0, section: 'register', formula: { op: 'count_if', over: { records: APPROVAL }, where: { column: 'standing', is: 'in', value: ['applied', 'query_raised'] } } },
      { key: 'run_out', label: 'Past their validity', kind: 'computed', precision: 0, section: 'register', formula: { op: 'count_if', over: { records: APPROVAL }, where: { column: 'days_left', is: 'lt', value: 0 } } },
      { key: 'fees_demanded', label: 'Fees demanded, all approvals', kind: 'computed', dimension: 'money', currency: 'INR', section: 'register', formula: { op: 'records', set: APPROVAL, reduce: 'sum', field: 'fees_total' } },
      mirror('conditions_total', 'Approval conditions recorded', 'number', at(APPROVALS, 'regulatory.conditions', 'total_conditions'), { section: 'register' }),
      {
        key: 'stop_orders_in_force',
        label: 'Stop-work orders in force',
        kind: 'computed',
        precision: 0,
        section: 'register',
        tier: 'situational',
        showWhen: { situation: 'stop_work_order' },
        formula: { op: 'count_if', over: { records: STOP_ORDERS }, where: { column: 'force', is: 'equals', value: 'in_force' } },
      },
      {
        key: 'register_standing',
        label: 'Register',
        kind: 'status',
        section: 'register',
        cases: [
          { when: { kind: 'at_most', fields: ['stop_orders_in_force'], against: 0, say: 'Stop-work orders in force: {a}.', severity: 'critical' }, label: 'Work is ordered to stop', tone: 'critical' },
          { when: { kind: 'at_most', fields: ['run_out'], against: 0, say: 'Approvals past their validity: {a}.', severity: 'high' }, label: 'An approval has run out', tone: 'critical' },
          // A register nobody has started is not in order: it is said to be empty.
          { when: { kind: 'at_least', fields: ['approvals_recorded'], against: 1, say: 'No approval is recorded.', severity: 'low' }, label: 'No approval recorded', tone: 'neutral' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'consultant', label: 'Liaison consultant', kind: 'ref', target: 'party', section: 'more', required: false },
    ],
    rules: [
      { kind: 'at_most', fields: ['run_out'], against: 0, say: 'Approvals past their validity: {a}.', severity: 'high' },
      { kind: 'at_most', fields: ['stop_orders_in_force'], against: 0, say: 'Stop-work orders in force: {a}.', severity: 'critical' },
    ],
  },
  {
    id: STOP_ORDERS,
    fn: APPROVALS,
    title: 'Stop-work orders',
    v: 1,
    records: { of: 'order', titleField: 'issued_by', summaryFields: ['order_date', 'reason', 'force'] },
    optionSets: [
      list('stop_scope', 'Scope', [opt('whole_site', 'Whole site'), opt('block', 'A block'), opt('activity', 'An activity')]),
      list('stop_reason', 'Reason', [opt('no_sanction', 'No sanction'), opt('deviation', 'Deviation'), opt('safety', 'Safety'), opt('pollution', 'Pollution'), opt('court_order', 'Court order'), opt('complaint', 'Complaint'), opt('dues', 'Dues')]),
      list('order_force', 'In force', [opt('in_force', 'In force', 'critical'), opt('lifted', 'Lifted', 'good')]),
    ],
    fields: [
      { key: 'issued_by', label: 'Issued by', kind: 'ref', target: 'party' },
      { key: 'order_date', label: 'Date of the order', kind: 'date', from: 'Notice' },
      { key: 'scope', label: 'Scope', kind: 'enum', control: 'segmented', optionSet: 'stop_scope' },
      { key: 'building', label: 'Block', kind: 'ref', target: 'building', required: false, tier: 'situational', showWhen: when(STOP_ORDERS, APPROVALS, 'scope', 'equals', 'block') },
      { key: 'reason', label: 'Reason', kind: 'enum', optionSet: 'stop_reason' },
      { key: 'force', label: 'In force', kind: 'enum', control: 'segmented', optionSet: 'order_force' },
      { key: 'reply_due', label: 'Reply due by', kind: 'date', required: false, from: 'Notice' },
      { key: 'reply_filed_on', label: 'Reply filed on', kind: 'date', required: false },
      { key: 'hearing_on', label: 'Hearing on', kind: 'date', required: false },
      { key: 'lifted_on', label: 'Lifted on', kind: 'date', tier: 'situational', showWhen: when(STOP_ORDERS, APPROVALS, 'force', 'equals', 'lifted') },
      { key: 'notice', label: 'Notice', kind: 'evidence', accepts: 'document', viewer: 'pdf', proof: 'expected' },
    ],
    rules: [
      { kind: 'require_if', fields: ['reply_due', 'reply_filed_on'], when: when(STOP_ORDERS, APPROVALS, 'force', 'equals', 'in_force'), say: 'A reply was due by {a} and none is recorded as filed.', severity: 'high' },
      { kind: 'before', fields: ['order_date', 'lifted_on'], say: 'Lifted on {b}, before the order’s own date of {a}.', severity: 'medium' },
    ],
  },
];

/* ==================================================================== */
/* Liaison: land use, plan sanction, occupancy                           */
/* ==================================================================== */

const SANCTION_PAPER = ['Sanctioned building plan'];
const CONVERSION_KNOWN: ShowWhen = { any: [{ situation: 'agricultural_needs_conversion' }, { field: LAND_USE_CHECK('conversion_status'), is: 'equals', value: 'converted' }] };

const PLAN_SETS: FieldSet[] = [
  {
    id: LAND_USE,
    fn: APPROVALS,
    title: 'Land conversion and use',
    v: 1,
    optionSets: [
      list('land_use_in_plan', 'Land use in the plan', [
        opt('residential', 'Residential'),
        opt('commercial', 'Commercial'),
        opt('industrial', 'Industrial'),
        opt('public', 'Public and semi-public'),
        opt('park', 'Park and open space', 'warning'),
        opt('agricultural', 'Agricultural', 'warning'),
        opt('green_belt', 'Green belt', 'critical'),
        opt('valley', 'Valley or buffer', 'critical'),
        opt('transport', 'Transport'),
      ]),
      list('conversion_route', 'Route', [opt('order', 'Deputy Commissioner’s order'), opt('deemed', 'Deemed conversion'), opt('conforms', 'Conforms to the master plan, no order needed')]),
      list('converted_purpose', 'Purpose', [opt('residential', 'Residential'), opt('commercial', 'Commercial'), opt('industrial', 'Industrial'), opt('mixed', 'Mixed'), opt('other', 'Other non-agricultural')]),
    ],
    situations: [
      {
        key: 'agricultural_needs_conversion',
        label: 'Agricultural land to be converted',
        scope: 'project',
        hint: 'The land is recorded as agricultural, and cannot be built on until it is converted.',
        derive: { field: LAND_USE_CHECK('conversion_status'), is: 'equals', value: 'agricultural' },
      },
    ],
    sections: [
      { key: 'use', label: 'Zoning and use' },
      { key: 'conversion', label: 'Conversion', showWhen: CONVERSION_KNOWN },
    ],
    fields: [
      mirror('zoning', 'Zoning in the plan in force', 'text', LAND_USE_CHECK('zoning'), { section: 'use' }),
      { key: 'land_use_in_plan', label: 'Land use in the plan', kind: 'enum', optionSet: 'land_use_in_plan', section: 'use', from: 'Master plan' },
      { key: 'use_permitted', label: 'Intended use permitted in that zone', kind: 'boolean', control: 'switch', section: 'use' },
      { key: 'change_of_use', label: 'Change-of-land-use order', kind: 'ref', target: 'approval', section: 'use', tier: 'situational', showWhen: when(LAND_USE, APPROVALS, 'use_permitted', 'false') },
      mirror('permissible_far', 'FAR permissible', 'number', SANCTION_CHECK('permissible_far'), { section: 'use' }),
      mirror('road_width', 'Abutting road width', 'number', ROAD_WIDTH, { unit: 'ft', section: 'use' }),
      mirror('conversion_status', 'DC conversion', 'enum', LAND_USE_CHECK('conversion_status'), { options: ['converted', 'agricultural'], section: 'use' }),
      {
        key: 'land_use_standing',
        label: 'Land use',
        kind: 'status',
        section: 'use',
        cases: [
          { when: { kind: 'at_most', fields: ['unconverted_extent'], against: 0, say: '{a} of the land is not covered by a conversion order.', severity: 'critical' }, label: 'Part of the land is not converted', tone: 'critical' },
          { when: { kind: 'require_if', fields: ['use_permitted', 'change_of_use'], whenIn: ['false'], say: 'The intended use is not permitted in this zone and no change-of-land-use order is linked.', severity: 'critical' }, label: 'Use not permitted', tone: 'critical' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'conversion_route', label: 'Route', kind: 'enum', optionSet: 'conversion_route', section: 'conversion', tier: 'situational' },
      {
        key: 'conversion_orders',
        label: 'Conversion orders',
        kind: 'table',
        section: 'conversion',
        tier: 'situational',
        from: 'DC conversion order',
        fromTypes: ['DC conversion order'],
        columns: [
          { key: 'order_no', label: 'Order number', kind: 'text' },
          { key: 'dated', label: 'Dated', kind: 'date' },
          { key: 'extent', label: 'Extent converted', kind: 'area', unit: 'sqm' },
          { key: 'purpose', label: 'Purpose', kind: 'enum', optionSet: 'converted_purpose', required: false },
        ],
      },
      {
        key: 'parcel_to_order',
        label: 'Survey numbers to conversion orders',
        kind: 'table',
        display: 'match',
        section: 'conversion',
        tier: 'situational',
        required: false,
        columns: [
          { key: 'parcel', label: 'Survey number', kind: 'ref', target: 'parcel' },
          { key: 'order', label: 'Order number', kind: 'text' },
        ],
        match: {
          left: { column: 'parcel', label: 'Survey numbers', of: { target: 'parcel' } },
          right: { column: 'order', label: 'Conversion orders', of: { table: at(APPROVALS, LAND_USE, 'conversion_orders'), column: 'order_no' } },
        },
      },
      { key: 'converted_extent', label: 'Extent converted', kind: 'computed', unit: 'sqm', section: 'conversion', tier: 'situational', formula: { op: 'sum', table: 'conversion_orders', column: 'extent' } },
      mirror('land_on_parcel_check', 'Extent clear of restriction, per Title', 'area', TITLE_CLEAR, { unit: 'sqm', section: 'conversion', tier: 'situational' }),
      { key: 'unconverted_extent', label: 'Extent not converted', kind: 'computed', unit: 'sqm', section: 'conversion', tier: 'situational', formula: overBy(minus(fld('land_on_parcel_check'), fld('converted_extent'))) },
      { key: 'records_show_conversion', label: 'Record of rights updated after conversion', kind: 'boolean', control: 'tick', section: 'conversion', tier: 'situational', required: false, from: 'RTC (record of rights)' },
      { key: 'use_by', label: 'Use to begin by', kind: 'date', section: 'conversion', tier: 'situational', required: false, expires: { leadDays: 180 }, from: 'A condition of the order' },
    ],
    rules: [
      { kind: 'at_most', fields: ['unconverted_extent'], against: 0, say: '{a} of the land is not covered by a conversion order.', severity: 'critical' },
      { kind: 'require_if', fields: ['use_permitted', 'change_of_use'], whenIn: ['false'], say: 'The intended use is not permitted in this zone and no change-of-land-use order is linked.', severity: 'critical' },
    ],
  },
  {
    id: SANCTION,
    fn: APPROVALS,
    title: 'Plan sanction',
    v: 1,
    situations: [
      { key: 'sanction_expiring', label: 'Plan sanction running out', scope: 'function', hint: 'The sanction ends within six months, has ended, or has been renewed.', derive: { any: [when(SANCTION, APPROVALS, 'sanction_days_left', 'lt', 181), when(SANCTION, APPROVALS, 'renewed_to', 'set')] } },
      { key: 'revised_sanction', label: 'Revised sanction', scope: 'project', hint: 'A revision of the sanctioned plan is recorded.', derive: { records: REVISIONS, is: 'any' } },
      { key: 'deviation_from_sanction', label: 'Built away from the sanctioned plan', scope: 'function', hint: 'A deviation from the sanctioned plan is recorded.', derive: { records: DEVIATIONS, is: 'any' } },
    ],
    sections: [
      { key: 'sanction', label: 'Sanction' },
      { key: 'renewal', label: 'Renewal', showWhen: { situation: 'sanction_expiring' } },
      { key: 'revision', label: 'Revisions', showWhen: { situation: 'revised_sanction' } },
      { key: 'deviation', label: 'Deviations', showWhen: { situation: 'deviation_from_sanction' } },
      { key: 'plan', label: 'On the sanctioned plan', tier: 'expert' },
    ],
    fields: [
      { key: 'sanction', label: 'Sanction', kind: 'ref', target: 'approval', section: 'sanction' },
      mirror('sanction_date', 'Date of sanction', 'date', SANCTION_CHECK('sanction_date'), { section: 'sanction' }),
      mirror('sanction_valid_to', 'Sanction valid to', 'date', SANCTION_CHECK('sanction_valid_to'), { section: 'sanction' }),
      { key: 'sanction_days_left', label: 'Days of sanction left', kind: 'computed', precision: 0, unit: 'days', section: 'sanction', formula: minus({ op: 'max', of: [day('sanction_valid_to'), day('renewed_to')] }, TODAY) },
      mirror('sanctioned_area', 'Built-up area sanctioned', 'area', SANCTION_CHECK('sanctioned_area'), { unit: 'sqm', section: 'sanction' }),
      mirror('sanctioned_far', 'FAR sanctioned', 'number', SANCTION_CHECK('sanctioned_far'), { section: 'sanction' }),
      { key: 'plot_area_per_plan', label: 'Plot area in the plan', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft', 'acre', 'gunta'], section: 'sanction', from: 'Sanctioned plan', fromTypes: SANCTION_PAPER, factKey: 'sanctioned_extent', proof: 'expected' },
      mirror('land_on_parcel_check', 'Extent clear of restriction, per Title', 'area', TITLE_CLEAR, { unit: 'sqm', section: 'sanction' }),
      { key: 'tallest', label: 'Tallest building, as sanctioned', kind: 'computed', dimension: 'length', section: 'sanction', formula: { op: 'records', set: BUILDING, reduce: 'max', field: 'sanctioned_height' } },
      { key: 'units_sanctioned', label: 'Units sanctioned', kind: 'computed', precision: 0, section: 'sanction', formula: { op: 'records', set: BUILDING, reduce: 'sum', field: 'sanctioned_units' } },
      { key: 'sanctioned_plan', label: 'Sanctioned plan', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'sanction', proof: 'expected' },
      {
        key: 'sanction_standing',
        label: 'Sanction',
        kind: 'status',
        section: 'sanction',
        cases: [
          { when: { kind: 'at_least', fields: ['sanction_days_left'], against: 0, say: 'The sanction has run out.', severity: 'critical' }, label: 'Run out', tone: 'critical' },
          { when: { kind: 'compare', fields: ['plot_area_per_plan', 'land_on_parcel_check'], tolerance: 0.01, say: 'The plan is drawn on {a} and Title finds {b} clear of restriction: {divergence} apart, outside {tolerance}.', severity: 'high' }, label: 'Plot area differs from the title', tone: 'critical' },
        ],
        otherwise: { label: 'In force', tone: 'good' },
      },
      { key: 'renewal_applied_on', label: 'Renewal applied for on', kind: 'date', section: 'renewal', tier: 'situational', required: false },
      { key: 'renewed_to', label: 'Renewed to', kind: 'date', section: 'renewal', tier: 'situational', required: false, from: 'Renewal endorsement' },
      { key: 'revisions_count', label: 'Revisions recorded', kind: 'computed', precision: 0, section: 'revision', tier: 'situational', formula: { op: 'records', set: REVISIONS, reduce: 'count' } },
      { key: 'revisions_short_of_consent', label: 'Revisions short of buyers’ consent', kind: 'computed', precision: 0, section: 'revision', tier: 'situational', formula: { op: 'count_if', over: { records: REVISIONS }, where: { column: 'consent_standing', is: 'equals', value: 'Consents short' } } },
      // The sanction as it now stands: what the last sanctioned revision states, and the sanction as first granted where no revision states it. The Architect's area statement, Sales' unit count and RERA's declared figures are held to these.
      { key: 'revised_on', label: 'Last revision sanctioned on', kind: 'computed', yields: 'date', section: 'revision', tier: 'situational', formula: figure('sanction.revised_day') },
      { key: 'built_up_in_force', label: 'Built-up area sanctioned, as last revised', kind: 'computed', dimension: 'area', unit: 'sqm', section: 'revision', tier: 'situational', formula: revisedOr('built_up', fld('sanctioned_area')) },
      { key: 'units_in_force', label: 'Units sanctioned, as last revised', kind: 'computed', precision: 0, section: 'revision', tier: 'situational', formula: revisedOr('units', fld('units_sanctioned')) },
      { key: 'height_in_force', label: 'Tallest building sanctioned, as last revised', kind: 'computed', dimension: 'length', section: 'revision', tier: 'situational', formula: revisedOr('height', fld('tallest')) },
      { key: 'deviations_over_limit', label: 'Deviations over the limit', kind: 'computed', precision: 0, section: 'deviation', tier: 'situational', formula: { op: 'count_if', over: { records: DEVIATIONS }, where: { column: 'within_limit', is: 'equals', value: 'Over the limit' } } },
      { key: 'architect', label: 'Registered architect', kind: 'ref', target: 'party', section: 'plan', required: false },
      { key: 'coverage', label: 'Ground coverage sanctioned', kind: 'percent', max: 100, section: 'plan', required: false, from: 'Sanctioned plan' },
      { key: 'road_surrender_area', label: 'Area given up for road widening', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'plan', required: false, from: 'Sanctioned plan' },
      {
        key: 'setbacks',
        label: 'Setbacks',
        kind: 'table',
        section: 'plan',
        required: false,
        from: 'Sanctioned plan',
        columns: [
          { key: 'side', label: 'Side', kind: 'enum', options: ['front', 'rear', 'left', 'right'] },
          { key: 'required_m', label: 'Required', kind: 'number', unit: 'm' },
          { key: 'provided_m', label: 'Provided', kind: 'number', unit: 'm' },
        ],
      },
    ],
    rules: [
      { kind: 'compare', fields: ['plot_area_per_plan', 'land_on_parcel_check'], tolerance: 0.01, say: 'The plan is drawn on {a} and Title finds {b} clear of restriction: {divergence} apart, outside {tolerance}.', severity: 'high' },
      { kind: 'at_least', fields: ['sanction_days_left'], against: 0, say: 'The sanction has run out.', severity: 'critical' },
    ],
  },
  {
    id: 'legal.approvals.building',
    fn: APPROVALS,
    title: 'Building, as sanctioned',
    v: 1,
    extends: BUILDING,
    optionSets: [list('building_use', 'Use', [opt('residential', 'Residential'), opt('commercial', 'Commercial'), opt('mixed', 'Mixed'), opt('amenity', 'Amenity'), opt('parking', 'Parking'), opt('services', 'Services')])],
    sections: [{ key: 'sanctioned', label: 'As sanctioned' }],
    fields: [
      { key: 'sanctioned_use', label: 'Use sanctioned', kind: 'enum', optionSet: 'building_use', section: 'sanctioned', required: false, from: 'Sanctioned plan' },
      { key: 'sanctioned_height', label: 'Height sanctioned', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'sanctioned', required: false, from: 'Sanctioned plan' },
      { key: 'sanctioned_units', label: 'Units sanctioned', kind: 'number', min: 0, section: 'sanctioned', required: false, from: 'Sanctioned plan' },
      { key: 'occupancy_certificate', label: 'Occupancy certificate', kind: 'ref', target: 'approval', section: 'sanctioned', required: false },
    ],
    rules: [],
  },
  {
    id: REVISIONS,
    fn: APPROVALS,
    title: 'Plan revisions',
    v: 1,
    records: { of: 'revision', titleField: 'revision_no', summaryFields: ['reason', 'standing', 'consent_standing'] },
    optionSets: [
      list('revision_reason', 'Reason', [
        opt('more_floors', 'More floors'),
        opt('more_units', 'More units'),
        opt('layout', 'Layout'),
        opt('use', 'Use'),
        opt('development_rights', 'Loading development rights'),
        opt('authority', 'The authority’s requirement'),
        opt('regularise', 'Regularising a deviation'),
      ]),
      list('revision_standing', 'Standing', [opt('applied', 'Applied', 'info'), opt('sanctioned', 'Sanctioned', 'good'), opt('refused', 'Refused', 'critical'), opt('withdrawn', 'Withdrawn', 'neutral')]),
    ],
    sections: [
      { key: 'revision', label: 'Revision' },
      { key: 'consents', label: 'Buyers’ consent' },
    ],
    // What the revision changes, each figure beside what the sanction gave before it: a sheet of its own, opened from the revision.
    sheets: [
      {
        id: 'what_changes',
        title: 'What changes',
        showWhen: when(REVISIONS, APPROVALS, 'reason', 'set'),
        sections: [
          { key: 'area', label: 'Area and units' },
          { key: 'form', label: 'Height, floors and parking' },
          { key: 'clearance', label: 'Environment clearance' },
        ],
        fields: [
          { key: 'built_up_before', label: 'Built-up area before', kind: 'computed', dimension: 'area', unit: 'sqm', section: 'area', formula: fld('sanctioned_area', at(APPROVALS, SANCTION, 'sanctioned_area')) },
          { key: 'built_up_area_after', label: 'Built-up area after', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'area', from: 'Area statement on the modified plan', fromTypes: ['Revised plan sanction'], factKey: 'revised_built_up_area', proof: 'expected' },
          { key: 'far_before', label: 'FAR before', kind: 'computed', precision: 2, section: 'area', formula: fld('sanctioned_far', at(APPROVALS, SANCTION, 'sanctioned_far')) },
          { key: 'far_after', label: 'FAR after', kind: 'number', min: 0, precision: 2, section: 'area', required: false, from: 'Modified plan' },
          { key: 'units_before', label: 'Units before', kind: 'computed', precision: 0, section: 'area', formula: fld('units_sanctioned', at(APPROVALS, SANCTION, 'units_sanctioned')) },
          { key: 'units_after', label: 'Units after', kind: 'number', min: 0, section: 'area', required: false, from: 'Modified plan', fromTypes: ['Revised plan sanction'], factKey: 'revised_units' },
          { key: 'carpet_area_after', label: 'Carpet area of all units after', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'area', required: false, from: 'Area statement on the modified plan' },
          { key: 'common_area_after', label: 'Common area after', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'area', required: false, from: 'Area statement on the modified plan' },
          { key: 'height_before', label: 'Height before', kind: 'computed', dimension: 'length', section: 'form', formula: fld('tallest', at(APPROVALS, SANCTION, 'tallest')) },
          { key: 'height_after', label: 'Height after', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'form', required: false, from: 'Modified plan', fromTypes: ['Revised plan sanction'], factKey: 'revised_height' },
          { key: 'floors_after', label: 'Floors after', kind: 'number', min: 0, precision: 0, section: 'form', required: false, from: 'Modified plan' },
          { key: 'parking_after', label: 'Car parks after', kind: 'number', min: 0, precision: 0, section: 'form', required: false, from: 'Modified plan' },
          { key: 'open_space_after', label: 'Open space after', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'form', required: false, from: 'Modified plan' },
          { key: 'units_added', label: 'Units added', kind: 'computed', precision: 0, section: 'area', tier: 'expert', formula: minus(fld('units_after'), fld('units_sanctioned', at(APPROVALS, SANCTION, 'units_sanctioned'))) },
          { key: 'area_short_of_clearance', label: 'Built-up area after, short of the size that needs an environment clearance', kind: 'computed', unit: 'sqm', section: 'clearance', formula: minus(rate('environment_clearance_built_up_area'), fld('built_up_area_after')) },
          {
            key: 'clearance_after',
            label: 'Environment clearance after the revision',
            kind: 'status',
            section: 'clearance',
            cases: [{ when: { kind: 'at_most', fields: ['area_short_of_clearance'], against: 0, say: 'After the revision the building is {a} short of the size that needs an environment clearance.', severity: 'low' }, label: 'Not needed at this size', tone: 'neutral' }],
            otherwise: { label: 'Needed at this size', tone: 'warning' },
          },
        ],
        rules: [],
      },
    ],
    fields: [
      { key: 'revision_no', label: 'Revision', kind: 'text', section: 'revision', hint: 'As the application numbers it.', fromTypes: ['Revised plan sanction'], factKey: 'revised_sanction_number' },
      { key: 'reason', label: 'Reason', kind: 'enum', optionSet: 'revision_reason', section: 'revision' },
      { key: 'applied_on', label: 'Applied on', kind: 'date', section: 'revision', from: 'Acknowledgement' },
      { key: 'standing', label: 'Standing', kind: 'enum', control: 'segmented', optionSet: 'revision_standing', section: 'revision' },
      { key: 'sanctioned_on', label: 'Sanctioned on', kind: 'date', section: 'revision', tier: 'situational', showWhen: when(REVISIONS, APPROVALS, 'standing', 'equals', 'sanctioned'), from: 'Modified sanction', fromTypes: ['Revised plan sanction'], factKey: 'revised_sanction_date' },
      { key: 'sanction', label: 'Modified sanction', kind: 'ref', target: 'approval', section: 'revision', required: false },
      { key: 'allottees_at_application', label: 'Allottees on the day of the application', kind: 'number', min: 0, section: 'consents', hint: 'A family counted once.', from: 'Sales register on that day' },
      { key: 'consents_held', label: 'Written consents held', kind: 'number', min: 0, section: 'consents', from: 'Consent letters' },
      {
        key: 'consent_share_held',
        label: 'Share of allottees who have consented',
        kind: 'computed',
        unit: '%',
        section: 'consents',
        formula: { op: 'multiply', left: { op: 'divide', left: fld('consents_held'), right: fld('allottees_at_application') }, right: num(100) },
      },
      { key: 'consent_share_needed', label: 'Share of allottees whose consent is needed', kind: 'computed', unit: '%', section: 'consents', formula: rate('rera_alteration_consent_share') },
      {
        key: 'consent_standing',
        label: 'Consent',
        kind: 'status',
        section: 'consents',
        cases: [{ when: { kind: 'at_least', fields: ['consent_share_held', 'consent_share_needed'], say: '{a} of allottees have consented in writing and {b} are needed.', severity: 'critical' }, label: 'Consents short', tone: 'critical' }],
        otherwise: { label: 'Consents in hand', tone: 'good' },
      },
      { key: 'consent_letters', label: 'Consent letters', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'consents', required: false },
      { key: 'alteration_filed_on', label: 'Alteration filed with RERA on', kind: 'date', section: 'consents' },
    ],
    rules: [
      { kind: 'at_least', fields: ['consent_share_held', 'consent_share_needed'], say: '{a} of allottees have consented in writing and {b} are needed.', severity: 'critical' },
      { kind: 'at_most', fields: ['height_after', 'airport'], at: { airport: at(APPROVALS, HEIGHT, 'height_allowed_by_airport') }, say: 'Height after the revision is {a}; the height clearance allows {b} above the ground.', severity: 'critical' },
      { kind: 'at_most', fields: ['height_after', 'fire'], at: { fire: at(APPROVALS, HEIGHT, 'fire_height_cleared') }, say: 'Height after the revision is {a}; the fire clearance covers {b}.', severity: 'critical' },
      { kind: 'at_most', fields: ['built_up_area_after', 'cleared'], at: { cleared: at(APPROVALS, ENVIRONMENT, 'ec_built_up_area') }, say: 'Built-up area after the revision is {a}; the environment clearance covers {b}.', severity: 'critical' },
      { kind: 'before', fields: ['applied_on', 'sanctioned_on'], say: 'Sanctioned on {b}, before it was applied for on {a}.', severity: 'medium' },
    ],
  },
  {
    id: DEVIATIONS,
    fn: APPROVALS,
    title: 'Deviations from the sanctioned plan',
    v: 1,
    records: { of: 'deviation', titleField: 'kind', summaryFields: ['deviation_share', 'within_limit', 'route'] },
    optionSets: [
      list('deviation_kind', 'Deviation', [
        opt('floor_area', 'Floor area'),
        opt('setback', 'Setback'),
        opt('coverage', 'Coverage'),
        opt('extra_floor', 'Extra floor'),
        opt('height', 'Height'),
        opt('parking_converted', 'Parking converted'),
        opt('use_changed', 'Use changed'),
      ]),
      list('deviation_route', 'Route', [opt('fee', 'Regularise for a fee', 'info'), opt('modified_plan', 'Modified plan', 'info'), opt('removal', 'Remove it', 'warning')]),
    ],
    fields: [
      { key: 'kind', label: 'Deviation', kind: 'enum', optionSet: 'deviation_kind' },
      { key: 'building', label: 'Block', kind: 'ref', target: 'building', required: false },
      { key: 'sanctioned', label: 'As sanctioned', kind: 'number', from: 'Sanctioned plan' },
      { key: 'as_built', label: 'As built', kind: 'number', from: 'As-built drawings' },
      { key: 'deviation_share', label: 'Deviation', kind: 'computed', unit: '%', formula: { op: 'variance_pct', left: fld('as_built'), right: fld('sanctioned') } },
      { key: 'limit', label: 'Deviation that can be regularised for a fee', kind: 'computed', unit: '%', formula: rate('deviation_compounding_limit') },
      {
        key: 'within_limit',
        label: 'Against the limit',
        kind: 'status',
        cases: [{ when: { kind: 'at_most', fields: ['deviation_share', 'limit'], say: 'Built {a} away from the sanction; {b} can be regularised for a fee.', severity: 'critical' }, label: 'Over the limit', tone: 'critical' }],
        otherwise: { label: 'Within the limit', tone: 'warning' },
      },
      { key: 'route', label: 'Route', kind: 'enum', control: 'segmented', optionSet: 'deviation_route' },
      { key: 'fee_paid', label: 'Fee paid', kind: 'money', dimension: 'money', currency: 'INR', required: false, tier: 'situational', showWhen: when(DEVIATIONS, APPROVALS, 'route', 'equals', 'fee'), from: 'Order' },
      { key: 'notice_received_on', label: 'Notice received on', kind: 'date', required: false, from: 'Notice' },
      { key: 'reply_due', label: 'Reply due by', kind: 'date', required: false, expires: { leadDays: 5 }, tier: 'situational', showWhen: when(DEVIATIONS, APPROVALS, 'notice_received_on', 'set'), from: 'Notice' },
    ],
    rules: [{ kind: 'at_most', fields: ['deviation_share', 'limit'], say: 'Built {a} away from the sanction; {b} can be regularised for a fee.', severity: 'critical' }],
  },
  {
    id: OCCUPANCY,
    fn: APPROVALS,
    title: 'Commencement and occupancy',
    v: 1,
    sections: [
      { key: 'commencement', label: 'Commencement' },
      { key: 'occupancy', label: 'Occupancy' },
      { key: 'partial', label: 'Blocks not yet covered', showWhen: when(OCCUPANCY, APPROVALS, 'oc_partial', 'true') },
    ],
    fields: [
      { key: 'commencement', label: 'Commencement certificate', kind: 'ref', target: 'approval', section: 'commencement' },
      { key: 'plinth_certificate_on', label: 'Plinth-stage certificate on', kind: 'date', section: 'commencement', required: false, from: 'Certificate' },
      { key: 'commencement_on', label: 'Commencement certificate on', kind: 'date', section: 'commencement', from: 'Commencement certificate', fromTypes: ['Commencement certificate'], factKey: 'issued_on' },
      { key: 'completion_certificate_on', label: 'Architect’s completion certificate on', kind: 'date', section: 'occupancy', required: false, from: 'Completion certificate' },
      { key: 'occupancy', label: 'Occupancy certificate', kind: 'ref', target: 'approval', section: 'occupancy', required: false },
      { key: 'occupancy_applied_on', label: 'Occupancy applied for on', kind: 'date', section: 'occupancy', required: false, from: 'Acknowledgement' },
      mirror('oc_issued', 'Occupancy certificate issued', 'boolean', OCCUPANCY_CHECK('oc_issued'), { section: 'occupancy' }),
      mirror('oc_date', 'Date of the occupancy certificate', 'date', OCCUPANCY_CHECK('oc_date'), { section: 'occupancy' }),
      mirror('oc_partial', 'Partial certificate only', 'boolean', OCCUPANCY_CHECK('oc_partial'), { section: 'occupancy' }),
      {
        key: 'buildings_without_certificate',
        label: 'Blocks with no occupancy certificate linked',
        kind: 'computed',
        precision: 0,
        section: 'partial',
        tier: 'situational',
        formula: minus({ op: 'count_if', over: { records: BUILDING }, where: { column: 'name', is: 'set' } }, { op: 'count_if', over: { records: BUILDING }, where: { column: 'occupancy_certificate', is: 'set' } }),
      },
    ],
    rules: [
      { kind: 'before', fields: ['commencement_on', 'completion_certificate_on'], say: 'The completion certificate is dated {b}, before commencement on {a}.', severity: 'medium' },
      { kind: 'before', fields: ['occupancy_applied_on', 'oc_date'], say: 'The occupancy certificate is dated {b}, before it was applied for on {a}.', severity: 'medium' },
      { kind: 'at_most', fields: ['buildings_without_certificate'], against: 0, say: '{a} block(s) have no occupancy certificate linked, and cannot be handed over.', severity: 'high' },
    ],
  },
];

/* ==================================================================== */
/* Liaison: height and fire, environment, utilities                      */
/* ==================================================================== */

const HIGH_RISE: ShowWhen = when(HEIGHT, APPROVALS, 'high_rise', 'equals', 'High-rise');
const HEIGHT_NOC_LINKED: ShowWhen = when(HEIGHT, APPROVALS, 'height_clearance', 'set');
const CLEARANCE_NEEDED: ShowWhen = { situation: 'environment_clearance_needed' };
const CONSENT_NEEDED: ShowWhen = when(ENVIRONMENT, APPROVALS, 'consent_applies', 'equals', 'Consent needed');

const SITE_SETS: FieldSet[] = [
  {
    id: HEIGHT,
    fn: APPROVALS,
    title: 'Height and fire clearances',
    v: 1,
    sections: [
      { key: 'height', label: 'Height' },
      { key: 'fire', label: 'Fire', showWhen: HIGH_RISE },
      { key: 'aviation', label: 'Airport height' },
      { key: 'clearance', label: 'The height clearance', showWhen: HEIGHT_NOC_LINKED },
    ],
    fields: [
      { key: 'height', label: 'Tallest building, as sanctioned', kind: 'computed', dimension: 'length', section: 'height', formula: { op: 'records', set: BUILDING, reduce: 'max', field: 'sanctioned_height' } },
      { key: 'height_short_of_high_rise', label: 'Short of the height that makes a high-rise', kind: 'computed', dimension: 'length', section: 'height', formula: minus(rate('high_rise_height_m'), fld('height')) },
      {
        key: 'high_rise',
        label: 'High-rise',
        kind: 'status',
        section: 'height',
        cases: [{ when: { kind: 'at_most', fields: ['height_short_of_high_rise'], against: 0, say: 'The tallest building is {a} short of a high-rise.', severity: 'low' }, label: 'Not a high-rise', tone: 'neutral' }],
        otherwise: { label: 'High-rise', tone: 'info' },
      },
      { key: 'fire_noc', label: 'Fire NOC', kind: 'ref', target: 'approval', section: 'fire', tier: 'situational' },
      { key: 'fire_height_cleared', label: 'Height the fire NOC covers', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'fire', tier: 'situational', from: 'Fire NOC', fromTypes: ['Fire NOC'], factKey: 'building_height', proof: 'expected' },
      { key: 'fire_final_clearance', label: 'Final fire clearance', kind: 'ref', target: 'approval', section: 'fire', tier: 'situational', required: false },
      mirror('refuge_area_required', 'Refuge area required', 'area', at('construction.quality', 'technical.fire_life_safety', 'refuge_area_required'), { unit: 'sqm', section: 'fire', tier: 'situational' }),
      mirror('refuge_area_provided', 'Refuge area provided', 'area', at('construction.quality', 'technical.fire_life_safety', 'refuge_area_provided'), { unit: 'sqm', section: 'fire', tier: 'situational' }),
      { key: 'nearest_aerodrome', label: 'Nearest aerodrome', kind: 'text', suggest: 'party', section: 'aviation', required: false, from: 'Colour-coded zoning map' },
      { key: 'site_elevation', label: 'Site elevation, above mean sea level', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'aviation', from: 'Licensed surveyor', fromTypes: ['Aviation height NOC'], proof: 'expected' },
      { key: 'top_elevation', label: 'Top of the tallest building, above mean sea level', kind: 'computed', dimension: 'length', section: 'aviation', formula: { op: 'add', left: fld('site_elevation'), right: fld('height') } },
      { key: 'zone_permitted_top', label: 'Top elevation the zoning map permits', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'aviation', from: 'Airports Authority of India, colour-coded zoning map' },
      {
        key: 'height_clearance_applies',
        label: 'Height clearance',
        kind: 'status',
        section: 'aviation',
        cases: [{ when: { kind: 'at_most', fields: ['top_elevation', 'zone_permitted_top'], say: 'The building tops out at {a}; the zoning map permits {b} without a clearance.', severity: 'medium' }, label: 'Needed', tone: 'warning' }],
        otherwise: { label: 'Within the zoning map', tone: 'neutral' },
      },
      { key: 'height_clearance', label: 'Height clearance', kind: 'ref', target: 'approval', section: 'aviation', required: false },
      { key: 'permitted_top', label: 'Top elevation the clearance permits', kind: 'number', dimension: 'length', enterIn: ['m', 'ft'], section: 'clearance', tier: 'situational', from: 'Aviation height NOC', fromTypes: ['Aviation height NOC'], factKey: 'permissible_top_elevation', proof: 'expected' },
      { key: 'headroom', label: 'Headroom under the clearance', kind: 'computed', dimension: 'length', section: 'clearance', tier: 'situational', formula: minus(fld('permitted_top'), fld('top_elevation')) },
      { key: 'height_allowed_by_airport', label: 'Height the clearance allows above the ground', kind: 'computed', dimension: 'length', section: 'clearance', tier: 'situational', formula: minus(fld('permitted_top'), fld('site_elevation')) },
      { key: 'clearance_issued_on', label: 'Clearance issued on', kind: 'date', section: 'clearance', tier: 'situational', from: 'Aviation height NOC', fromTypes: ['Aviation height NOC'], factKey: 'issued_on' },
      { key: 'clearance_valid_to', label: 'Clearance valid to', kind: 'computed', yields: 'date', section: 'clearance', tier: 'situational', expires: { leadDays: 365 }, formula: { op: 'add_months', date: day('clearance_issued_on'), months: yearsAsMonths('height_clearance_validity_years') } },
      { key: 'site_coordinates', label: 'Site coordinates', kind: 'text', section: 'clearance', tier: 'situational', required: false, hint: 'As surveyed. Wrong coordinates void the clearance.', from: 'Aviation height NOC', fromTypes: ['Aviation height NOC'] },
      {
        key: 'height_standing',
        label: 'Height and fire',
        kind: 'status',
        section: 'height',
        cases: [
          { when: { kind: 'at_least', fields: ['headroom'], against: 0, say: 'The building tops out {a} against the height clearance.', severity: 'critical' }, label: 'Above the cleared elevation', tone: 'critical' },
          { when: { kind: 'at_most', fields: ['height', 'fire_height_cleared'], say: 'The tallest building is sanctioned at {a}; the fire NOC covers {b}.', severity: 'critical' }, label: 'Above the fire-cleared height', tone: 'critical' },
        ],
        otherwise: { label: 'Within the clearances', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'at_least', fields: ['headroom'], against: 0, say: 'The building tops out {a} against the height clearance.', severity: 'critical' },
      { kind: 'at_most', fields: ['height', 'fire_height_cleared'], say: 'The tallest building is sanctioned at {a}; the fire NOC covers {b}.', severity: 'critical' },
      { kind: 'require_if', fields: ['height_clearance_applies', 'height_clearance'], whenIn: ['Needed'], say: 'A height clearance is needed and none is linked.', severity: 'high' },
      { kind: 'compare', fields: ['refuge_area_required', 'refuge_area_provided'], tolerance: 0, say: 'Refuge area required is {a} and {b} is provided.', severity: 'high' },
    ],
  },
  {
    id: ENVIRONMENT,
    fn: APPROVALS,
    title: 'Environment and pollution control',
    v: 1,
    optionSets: [list('pollution_category', 'Category', [opt('red', 'Red'), opt('orange', 'Orange'), opt('green', 'Green'), opt('white', 'White')])],
    situations: [
      {
        key: 'environment_clearance_needed',
        label: 'An environment clearance is needed',
        scope: 'function',
        hint: 'The built-up area is at or over the size from which a clearance is needed.',
        derive: when(ENVIRONMENT, APPROVALS, 'clearance_applies', 'in', ['Needed, as a building project', 'Needed, as a township or area development']),
      },
    ],
    sections: [
      { key: 'applies', label: 'What applies' },
      { key: 'clearance', label: 'Environment clearance', showWhen: CLEARANCE_NEEDED },
      { key: 'consent', label: 'Pollution control board', showWhen: CONSENT_NEEDED },
      { key: 'services', label: 'Water and sewage', tier: 'expert' },
    ],
    fields: [
      mirror('built_up_area', 'Built-up area sanctioned', 'area', SANCTION_CHECK('sanctioned_area'), { unit: 'sqm', section: 'applies', hint: 'The clearance counts basements and service areas.' }),
      { key: 'area_short_of_clearance', label: 'Short of the size that needs an environment clearance', kind: 'computed', unit: 'sqm', section: 'applies', formula: minus(rate('environment_clearance_built_up_area'), fld('built_up_area')) },
      { key: 'area_short_of_township', label: 'Short of the size cleared as a township', kind: 'computed', unit: 'sqm', section: 'applies', formula: minus(rate('environment_clearance_township_built_up_area'), fld('built_up_area')) },
      {
        key: 'clearance_applies',
        label: 'Environment clearance',
        kind: 'status',
        section: 'applies',
        cases: [
          { when: { kind: 'at_most', fields: ['area_short_of_clearance'], against: 0, say: 'The building is {a} short of the size that needs a clearance.', severity: 'low' }, label: 'Not needed at this size', tone: 'neutral' },
          { when: { kind: 'at_most', fields: ['area_short_of_township'], against: 0, say: 'The building is {a} short of a township.', severity: 'low' }, label: 'Needed, as a building project', tone: 'info' },
        ],
        otherwise: { label: 'Needed, as a township or area development', tone: 'info' },
      },
      { key: 'area_short_of_consent', label: 'Short of the size that needs the board’s consent', kind: 'computed', unit: 'sqm', section: 'applies', formula: minus(rate('pollution_consent_built_up_area'), fld('built_up_area')) },
      {
        key: 'consent_applies',
        label: 'Pollution control board’s consent',
        kind: 'status',
        section: 'applies',
        cases: [{ when: { kind: 'at_most', fields: ['area_short_of_consent'], against: 0, say: 'The building is {a} short of the size that needs the board’s consent.', severity: 'low' }, label: 'Not needed at this size', tone: 'neutral' }],
        otherwise: { label: 'Consent needed', tone: 'info' },
      },
      {
        key: 'environment_standing',
        label: 'Environment',
        kind: 'status',
        section: 'applies',
        cases: [
          { when: { kind: 'at_most', fields: ['built_up_area', 'ec_built_up_area'], say: '{a} is sanctioned and the clearance covers {b}.', severity: 'critical' }, label: 'Sanctioned over the cleared area', tone: 'critical' },
          { when: { kind: 'at_least', fields: ['reports_filed', 'reports_due'], say: '{a} half-yearly report(s) are filed of {b} due.', severity: 'high' }, label: 'Compliance reports behind', tone: 'warning' },
          { when: { kind: 'require_if', fields: ['clearance_applies', 'clearance'], whenIn: ['Needed, as a building project', 'Needed, as a township or area development'], say: 'An environment clearance is needed and none is linked.', severity: 'high' }, label: 'Clearance not on file', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'clearance', label: 'Environment clearance', kind: 'ref', target: 'approval', section: 'clearance', tier: 'situational' },
      mirror('clearance_granted_on', 'Clearance granted on', 'date', CLEARANCE_CHECK('ec_granted_on'), { section: 'clearance', tier: 'situational' }),
      { key: 'clearance_valid_to', label: 'Clearance valid to', kind: 'computed', yields: 'date', section: 'clearance', tier: 'situational', expires: { leadDays: 365 }, formula: { op: 'add_months', date: day('clearance_granted_on'), months: yearsAsMonths('environment_clearance_validity_years') } },
      { key: 'ec_built_up_area', label: 'Built-up area the clearance covers', kind: 'area', dimension: 'area', enterIn: ['sqm', 'sqft'], section: 'clearance', tier: 'situational', from: 'Environmental clearance', fromTypes: ['Environmental clearance'], factKey: 'cleared_built_up_area', proof: 'expected' },
      { key: 'ec_units', label: 'Units the clearance covers', kind: 'number', min: 0, section: 'clearance', tier: 'situational', required: false, from: 'Environmental clearance', fromTypes: ['Environmental clearance'], factKey: 'cleared_units' },
      mirror('reports_due', 'Half-yearly reports due', 'number', CLEARANCE_CHECK('compliance_reports_due'), { section: 'clearance', tier: 'situational' }),
      mirror('reports_filed', 'Half-yearly reports filed', 'number', CLEARANCE_CHECK('compliance_reports_filed'), { section: 'clearance', tier: 'situational' }),
      { key: 'pollution_category', label: 'Category the board has set', kind: 'enum', control: 'segmented', optionSet: 'pollution_category', section: 'consent', tier: 'situational', required: false, from: 'Consent' },
      { key: 'consent_to_establish', label: 'Consent for establishment', kind: 'ref', target: 'approval', section: 'consent', tier: 'situational' },
      { key: 'consent_to_operate', label: 'Consent for operation', kind: 'ref', target: 'approval', section: 'consent', tier: 'situational', required: false },
      mirror('water_demand', 'Water demand', 'number', SERVICES_CHECK('water_demand_kld'), { unit: 'KLD', section: 'services' }),
      mirror('sewage_plant_capacity', 'STP capacity', 'number', SERVICES_CHECK('stp_capacity_kld'), { unit: 'KLD', section: 'services' }),
    ],
    rules: [
      { kind: 'at_most', fields: ['built_up_area', 'ec_built_up_area'], say: '{a} is sanctioned and the clearance covers {b}.', severity: 'critical' },
      { kind: 'at_least', fields: ['reports_filed', 'reports_due'], say: '{a} half-yearly report(s) are filed of {b} due.', severity: 'high' },
      { kind: 'require_if', fields: ['clearance_applies', 'clearance'], whenIn: ['Needed, as a building project', 'Needed, as a township or area development'], say: 'An environment clearance is needed and none is linked.', severity: 'high' },
      { kind: 'at_most', fields: ['units_sanctioned', 'ec_units'], at: { units_sanctioned: at(APPROVALS, SANCTION, 'units_sanctioned') }, say: '{a} units are sanctioned and the clearance covers {b}.', severity: 'critical' },
    ],
  },
  {
    id: UTILITIES,
    fn: APPROVALS,
    title: 'Water and power',
    v: 1,
    sections: [
      { key: 'water', label: 'Water and sewer' },
      { key: 'power', label: 'Power' },
    ],
    fields: [
      { key: 'water_noc', label: 'Water and sewer NOC', kind: 'ref', target: 'approval', section: 'water' },
      { key: 'sewer_connection', label: 'Sewer connection available', kind: 'boolean', control: 'switch', section: 'water', from: 'Water and sewer NOC' },
      { key: 'water_connection_on', label: 'Water connection given on', kind: 'date', section: 'water', required: false, from: 'Connection order' },
      { key: 'power_sanction', label: 'Power sanction', kind: 'ref', target: 'approval', section: 'power' },
      mirror('connected_load', 'Connected load', 'number', SERVICES_CHECK('connected_load_kw'), { unit: 'kW', section: 'power' }),
      mirror('sanctioned_load', 'Sanctioned load', 'number', SERVICES_CHECK('sanctioned_load_kw'), { unit: 'kW', section: 'power' }),
      { key: 'supply_voltage', label: 'Supply voltage', kind: 'enum', control: 'segmented', options: ['low tension', '11 kV', '66 kV'], section: 'power', required: false, from: 'Sanction letter' },
      { key: 'height', label: 'Tallest building, as sanctioned', kind: 'computed', dimension: 'length', section: 'power', formula: { op: 'records', set: BUILDING, reduce: 'max', field: 'sanctioned_height' } },
      { key: 'height_over_inspection', label: 'Over the height from which the installation is inspected', kind: 'computed', dimension: 'length', section: 'power', formula: minus(fld('height'), rate('electrical_inspection_height')) },
      {
        key: 'inspection_applies',
        label: 'Electrical inspectorate’s safety approval',
        kind: 'status',
        section: 'power',
        cases: [{ when: { kind: 'at_most', fields: ['height_over_inspection'], against: 0, say: 'The tallest building is {a} over the height from which the installation is inspected.', severity: 'low' }, label: 'Needed before energising', tone: 'info' }],
        otherwise: { label: 'Not needed at this height', tone: 'neutral' },
      },
      { key: 'safety_approval', label: 'Electrical safety approval', kind: 'ref', target: 'approval', section: 'power', required: false },
      { key: 'permanent_supply_on', label: 'Permanent supply given on', kind: 'date', section: 'power', required: false, from: 'Distribution company' },
    ],
    rules: [
      { kind: 'at_most', fields: ['connected_load', 'sanctioned_load'], say: 'The connected load is {a} and {b} is sanctioned.', severity: 'high' },
      { kind: 'require_if', fields: ['inspection_applies', 'safety_approval'], whenIn: ['Needed before energising'], when: when(UTILITIES, APPROVALS, 'permanent_supply_on', 'set'), say: 'Permanent supply is recorded as given, with no electrical safety approval linked.', severity: 'critical' },
      { kind: 'require_if', fields: ['permanent_supply_on', 'power_sanction'], say: 'Permanent supply is recorded as given on {a}, with no power sanction linked.', severity: 'medium' },
    ],
  },
  {
    id: LIFTS,
    fn: APPROVALS,
    title: 'Lifts',
    v: 1,
    records: { of: 'lift', titleField: 'lift', summaryFields: ['building', 'licence_valid_to', 'standing'] },
    fields: [
      { key: 'lift', label: 'Lift', kind: 'text', hint: 'As numbered on site.' },
      { key: 'building', label: 'Block', kind: 'ref', target: 'building' },
      { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', options: ['passenger', 'service', 'fire'] },
      { key: 'erection_permission_no', label: 'Erection permission number', kind: 'text', required: false, from: 'Permission' },
      { key: 'erection_permission_on', label: 'Erection permission on', kind: 'date', required: false, from: 'Permission' },
      { key: 'licence_no', label: 'Licence number', kind: 'text', required: false, from: 'Licence' },
      { key: 'licence_on', label: 'Licensed on', kind: 'date', required: false, from: 'Licence' },
      { key: 'licence_valid_to', label: 'Licence valid to', kind: 'date', required: false, expires: { leadDays: 60 }, from: 'Licence' },
      { key: 'in_use', label: 'In use', kind: 'boolean', control: 'tick', required: false },
      { key: 'maintained_by', label: 'Maintained by', kind: 'ref', target: 'party', required: false },
      { key: 'licence', label: 'Licence', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [{ when: { kind: 'require_if', fields: ['in_use', 'licence_no'], whenIn: ['true'], say: 'This lift is in use with no licence recorded.', severity: 'critical' }, label: 'In use without a licence', tone: 'critical' }],
        otherwise: { label: 'In order', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'require_if', fields: ['in_use', 'licence_no'], whenIn: ['true'], say: 'This lift is in use with no licence recorded.', severity: 'critical' },
      { kind: 'before', fields: ['erection_permission_on', 'licence_on'], say: 'Licensed on {b}, before permission to erect it on {a}.', severity: 'medium' },
    ],
  },
];

/* ==================================================================== */
/* What Law and Liaison read from the other departments                  */
/* ==================================================================== */

const JDA_PAYMENTS = 'finance.tax.jda_payments';
const paidAs = (kind: string): CheckFormula => ({ op: 'sum_if', over: { records: JDA_PAYMENTS }, column: 'amount', where: { column: 'kind', is: 'equals', value: kind } });
const UNITS_ON_SALE: ShowWhen = { records: 'shared.units', is: 'any', where: { column: 'sale_released', is: 'true' } };
const ACCOUNT_KEPT: ShowWhen = { situation: 'designated_account_kept' };
const SALES_STOCK = (field: string) => at('commercial.inventory', 'commercial.inventory.bookings', field);
const RERA_ACCOUNT = (set: string, field: string) => at('finance.funding', `finance.funding.${set}`, field);

/** The approvals report: where every approval stands, what has run out, and what the plan sanction allows. */
const APPROVALS_REPORT: FieldReportTemplate = {
  id: 'legal.approvals.report',
  title: 'Approvals status report',
  sections: [
    { heading: 'Register', fields: ['approvals_recorded', 'in_hand', 'with_authority', 'run_out', 'fees_demanded', 'stop_orders_in_force', 'register_standing'] },
    { heading: 'Approvals', records: 'shared.approvals', columns: ['reference', 'kind', 'authority', 'standing', 'applied_on', 'issued_on', 'valid_until'] },
    { heading: 'Plan sanction', fields: ['sanction', 'sanction_date', 'sanction_valid_to', 'sanction_days_left', 'sanctioned_area', 'sanctioned_far', 'units_sanctioned', 'sanction_standing'].map((field) => at(APPROVALS, SANCTION, field)) },
    { heading: 'Land use and conversion', fields: ['zoning', 'conversion_status', 'converted_extent', 'unconverted_extent', 'land_use_standing'].map((field) => at(APPROVALS, LAND_USE, field)) },
    { heading: 'Commencement and occupancy', fields: ['commencement_on', 'occupancy_applied_on', 'oc_issued', 'oc_date', 'handed_before_certificate'].map((field) => at(APPROVALS, OCCUPANCY, field)) },
    { heading: 'Stop-work orders', records: STOP_ORDERS, columns: ['issued_by', 'order_date', 'scope', 'reason', 'force', 'lifted_on'] },
    { heading: 'Liaison’s remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

/** The RERA report: the registration, the filings made and owed, and the figures the next filing will carry. */
const RERA_REPORT: FieldReportTemplate = {
  id: 'legal.rera.report',
  title: 'RERA compliance report',
  sections: [
    { heading: 'Registration', fields: ['registration_no', 'registered_on', 'registration_valid_to', 'declared_completion', 'validity_days_left', 'registration_standing'].map((field) => at(RERA, REGISTRATION, field)) },
    { heading: 'Filings', fields: ['filings_made', 'filings_open', 'filings_overdue'] },
    { heading: 'Filings, one by one', records: FILINGS, columns: ['period_end', 'kind', 'filing_due', 'filed_on', 'standing'] },
    { heading: 'What the next filing will say', fields: ['units_total', 'units_booked', 'construction_complete', 'cost_incurred', 'realised_in_quarter', 'deposited_in_quarter', 'deposit_share', 'withdrawn_to_date', 'net_withdrawable'] },
    { heading: 'Remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

const LAW_LINKS: SetLinks[] = [
  {
    set: LAND,
    // Who has to sign, and what the advocate still asks before closing, are Title's: a purchase is read against them here.
    fields: [
      mirror('owners_not_joining', 'Owners with a share who join no deed, per Title', 'number', at('legal.title', 'legal.title.ownership', 'not_joining'), { section: 'obligations', tier: 'situational', showWhen: { field: at('legal.title', 'legal.title.ownership', 'not_joining'), is: 'gt', value: 0 } }),
      mirror('requisitions_open', 'Requisitions open, per Title', 'number', at('legal.title', 'legal.title.opinion', 'requisitions_open'), { section: 'obligations', tier: 'situational', showWhen: { field: at('legal.title', 'legal.title.opinion', 'requisitions_open'), is: 'gt', value: 0 } }),
    ],
    // A lender takes the lease as security: the lessor's consent to mortgage is then a paper the loan waits on.
    rules: [{ kind: 'require', fields: ['consent_to_mortgage'], when: { all: [{ situation: 'leasehold_land' }, { situation: 'lender_funded' }] }, say: 'A lender funds the project and the lessor’s consent to mortgage the lease is not recorded.', severity: 'high' }],
  },
  {
    set: JDA,
    // What has been paid to the landowner is Tax's record, payment by payment. The agreement's figures are held to it here.
    fields: [
      { key: 'refundable_paid', label: 'Refundable deposit paid, per Tax’s payments', kind: 'computed', dimension: 'money', currency: 'INR', section: 'money', tier: 'situational', showWhen: { records: JDA_PAYMENTS, is: 'any' }, formula: paidAs('refundable_deposit') },
      { key: 'non_refundable_paid', label: 'Paid outright, per Tax’s payments', kind: 'computed', dimension: 'money', currency: 'INR', section: 'money', tier: 'situational', showWhen: { records: JDA_PAYMENTS, is: 'any' }, formula: paidAs('non_refundable') },
    ],
    rules: [
      { kind: 'at_most', fields: ['refundable_paid', 'refundable_deposit'], when: { records: JDA_PAYMENTS, is: 'any' }, say: '{a} has been paid to the landowner as refundable deposit; the agreement provides {b}.', severity: 'medium' },
      { kind: 'at_most', fields: ['non_refundable_paid', 'non_refundable_deposit'], when: { records: JDA_PAYMENTS, is: 'any' }, say: '{a} has been paid to the landowner outright; the agreement provides {b}.', severity: 'medium' },
    ],
  },
  {
    set: SALE_AGREEMENT,
    sections: [{ key: 'in_use', label: 'Agreements as Sales records them', showWhen: UNITS_ON_SALE }],
    fields: [
      mirror('agreements_registered', 'Agreements registered', 'number', SALES_STOCK('agreements_registered'), { section: 'in_use', tier: 'situational' }),
      mirror('agreements_overdue', 'Agreements past the date they were due', 'number', SALES_STOCK('agreements_overdue'), { section: 'in_use', tier: 'situational' }),
      mirror('advances_over_cap', 'Units holding an advance above the cap', 'number', SALES_STOCK('advances_over_cap'), { section: 'in_use', tier: 'situational' }),
    ],
  },
  {
    set: REGISTRATION,
    // What the application declares, read from whoever keeps it. Law types none of these figures.
    sections: [{ key: 'declared', label: 'Declared with the application, as other departments record it', tier: 'expert' }],
    fields: [
      mirror('estimated_cost', 'Estimated cost of the project', 'money', RERA_ACCOUNT('rera_cost', 'total_estimated'), { dimension: 'money', currency: 'INR', section: 'declared' }),
      mirror('borrowings', 'Borrowings sanctioned', 'money', at('finance.lenders', 'finance.lenders.drawdown', 'sanctioned'), { dimension: 'money', currency: 'INR', section: 'declared' }),
      mirror('title_opinion', 'Title opinion', 'evidence', at('legal.title', 'legal.title.opinion', 'opinion_doc'), { section: 'declared' }),
      mirror('charges_open', 'Charges on the land not released', 'number', at('legal.title', 'legal.title.encumbrance', 'charges_open'), { section: 'declared' }),
      { key: 'agents_engaged', label: 'Channel partners engaged', kind: 'computed', precision: 0, section: 'declared', formula: { op: 'records', set: 'commercial.inventory.partners', reduce: 'count' } },
      // The areas and counts the application states. None is typed here: the land is Title's, the sanction Liaison's as last revised, the carpet area the Architect's, the units Sales'.
      mirror('land_clear_extent', 'Land, clear of restriction, per Title', 'area', TITLE_CLEAR, { unit: 'sqm', section: 'declared' }),
      mirror('built_up_sanctioned', 'Built-up area sanctioned, as last revised', 'area', at(APPROVALS, SANCTION, 'built_up_in_force'), { unit: 'sqm', section: 'declared' }),
      mirror('units_sanctioned', 'Units sanctioned, as last revised', 'number', at(APPROVALS, SANCTION, 'units_in_force'), { precision: 0, section: 'declared' }),
      mirror('carpet_area_designed', 'Carpet area of all units, per the Architect', 'area', at('design.areas', 'design.areas.statement', 'carpet_total'), { unit: 'sqm', section: 'declared' }),
      { key: 'units_on_register', label: 'Units on the register', kind: 'computed', precision: 0, section: 'declared', formula: { op: 'records', set: UNIT, reduce: 'count' } },
      { key: 'carpet_area_on_register', label: 'Carpet area of the units on the register', kind: 'computed', dimension: 'area', unit: 'sqm', section: 'declared', formula: { op: 'records', set: UNIT, reduce: 'sum', field: 'carpet_area' } },
    ],
    rules: [
      // A revision that adds units or area changes what was declared: the register and the Architect's statement have to follow it before the alteration is filed.
      { kind: 'at_most', fields: ['units_on_register', 'units_sanctioned'], when: { records: UNIT, is: 'any' }, say: 'The register holds {a} units and the sanction, as last revised, allows {b}.', severity: 'high' },
      { kind: 'compare', fields: ['carpet_area_on_register', 'carpet_area_designed'], when: { all: [{ records: UNIT, is: 'any', where: { column: 'carpet_area', is: 'set' } }, { records: 'design.brief.unit_types', is: 'any' }] }, tolerance: 0.001, say: 'The units on the register carry {a} of carpet area and the Architect’s statement gives {b}: {divergence} apart.', severity: 'medium' },
    ],
  },
  {
    set: COMPLIANCE,
    repoint: {
      // Units sold are counted from the unit records Sales keeps, and progress from the milestones Construction keeps.
      units_total: at('commercial.inventory', 'commercial.inventory.stock', 'units_total'),
      units_booked: at('commercial.inventory', 'commercial.inventory.stock', 'units_sold'),
      // Spent to date is what has been paid against certified bills on the cost register.
      cost_incurred: at('finance.budget', 'finance.budget.to_complete', 'paid_to_date'),
      construction_complete: at('construction.progress', 'construction.progress.programme', 'actual_percent'),
    },
    // The designated account's figures are Finance's. They are read here beside the filings they go into.
    fields: [
      mirror('realised_in_quarter', 'Realised from allottees in the quarter', 'money', RERA_ACCOUNT('rera_deposit', 'realised'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'situational', showWhen: ACCOUNT_KEPT }),
      mirror('deposited_in_quarter', 'Deposited in the designated account in the quarter', 'money', RERA_ACCOUNT('rera_deposit', 'deposited'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'situational', showWhen: ACCOUNT_KEPT }),
      mirror('withdrawn_to_date', 'Withdrawn to date', 'money', RERA_ACCOUNT('rera_withdrawal', 'withdrawn_to_date'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'situational', showWhen: ACCOUNT_KEPT }),
      mirror('net_withdrawable', 'Net amount that can be withdrawn now', 'money', RERA_ACCOUNT('rera_withdrawal', 'net_withdrawable'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'situational', showWhen: ACCOUNT_KEPT }),
      mirror('cost_incurred_counted', 'Cost incurred, as the accountant counts it', 'money', RERA_ACCOUNT('rera_cost', 'total_incurred'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'situational', showWhen: ACCOUNT_KEPT }),
      mirror('cost_to_complete', 'Cost to complete, per the budget', 'money', at('finance.budget', 'finance.budget.to_complete', 'cost_to_complete'), { dimension: 'money', currency: 'INR', section: 'position', tier: 'expert' }),
    ],
  },
  {
    set: CONVEYANCE,
    fields: [
      mirror('units_handed_over', 'Units handed over, per Sales', 'number', at('commercial.handover', 'commercial.handover.possession', 'units_handed_over'), { tier: 'situational', showWhen: { records: 'shared.units', is: 'any', where: { column: 'handover_taken_on', is: 'set' } } }),
    ],
  },
  {
    set: OCCUPANCY,
    // Possession is Sales' to record, unit by unit. A unit handed over while no occupancy certificate is recorded is said here.
    fields: [
      {
        key: 'handed_before_certificate',
        label: 'Units handed over with no occupancy certificate',
        kind: 'computed',
        precision: 0,
        section: 'occupancy',
        tier: 'situational',
        showWhen: { records: 'shared.units', is: 'any', where: { column: 'handover_taken_on', is: 'set' } },
        formula: { op: 'if', when: { field: 'oc_issued', is: 'true' }, then: { op: 'const', value: 0 }, else: { op: 'count_if', over: { records: 'shared.units' }, where: { column: 'handover_taken_on', is: 'set' } } },
      },
    ],
    rules: [
      { kind: 'at_most', fields: ['handed_before_certificate'], against: 0, say: '{a} unit(s) are recorded as handed over and no occupancy certificate is recorded.', severity: 'critical' },
      // The day work began is Construction's record: begun before the commencement certificate, it is work without leave.
      { kind: 'before', fields: ['commencement_on', 'started_on'], at: { started_on: at('construction.progress', 'construction.progress.programme', 'started_on') }, say: 'Work began on site on {b}, before the commencement certificate of {a}.', severity: 'critical' },
    ],
  },
  {
    set: ENVIRONMENT,
    // Whether a clearance is needed is read off the sanction as last revised: a revision sanctioned past the size the rule table gives brings the clearance into play with nobody typing the area again.
    repoint: { built_up_area: at(APPROVALS, SANCTION, 'built_up_in_force') },
    // The built-up area as designed is the Architect's: the clearance is held to it, and the sewage the plant is sized for is read from Services.
    fields: [
      mirror('built_up_designed', 'Built-up area as designed', 'area', at('design.areas', 'design.areas.statement', 'total_built_up'), { unit: 'sqm', section: 'clearance', tier: 'situational', showWhen: { records: 'design.areas.floors', is: 'any' } }),
      mirror('sewage_generated', 'Sewage generated, per the services design', 'number', at('design.sewage', 'design.sewage.plant', 'sewage_generated'), { unit: 'KLD', section: 'consent', tier: 'expert' }),
    ],
    rules: [{ kind: 'at_most', fields: ['built_up_designed', 'ec_built_up_area'], say: 'The design comes to {a} of built-up area; the environment clearance covers {b}.', severity: 'high' }],
  },
  // A lift is designed once, by Services. Its permission and licence are kept here, linked to that lift.
  { set: LIFTS, fields: [{ key: 'designed_as', label: 'Lift, as designed', kind: 'ref', target: { set: 'design.lifts.schedule' }, required: false }] },
  { set: REGISTER, reports: [APPROVALS_REPORT] },
  { set: COMPLIANCE, reports: [RERA_REPORT] },
];

export const LAW_LIAISON_FIELD_SETS: FieldSet[] = withLinks([...LAND_SETS, ...JDA_SETS, ...CUSTOMER_SETS, ...RERA_SETS, ...REGISTER_SETS, ...PLAN_SETS, ...SITE_SETS], LAW_LINKS);
