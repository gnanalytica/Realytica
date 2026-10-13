/**
 * Titles and Litigation, as fields.
 *
 * Titles is worked inside Legal › Title (`legal.title`): land records,
 * chain of title, encumbrance and charge search, land character and
 * restrictions, and the title opinion. Litigation is its own function
 * (`legal.litigation`): matters, hearings and orders, searches, notices
 * and the money at stake.
 *
 * The parcel is the spine. A parcel, a party and a matter are the shared
 * records, with this department's facts added to them. Everything that
 * repeats under a parcel is a set of records linked to it: its land record,
 * its owners, the instruments that convey it, the entries a certificate
 * shows against it, the charges on it and the restrictions over it. Three
 * pairings say what does not line up: a survey number with no owner, a
 * certificate entry with no instrument in the chain, a suit schedule not
 * placed on a parcel.
 *
 * What a sheet shows by default is small. The hard cases (an owner who has
 * died, a minor, a sale through an attorney, an unregistered partition,
 * granted land, a live acquisition, a charge not released, a partition
 * suit) are more fields that stay out of sight until what is recorded
 * brings them in. Nobody is asked to switch them on: each follows from a
 * row or a value.
 *
 * The opinion is assembled, not typed: its standing is worked out from the
 * four sheets before it. The advocate gives a verdict, waives a requisition
 * and may leave one short note.
 *
 * Owners are the worked example's set (`legal.title.owners`), extended here.
 */

import type { CheckFieldDef, CheckFormula, CheckInsightRule, FieldAddress, FieldReportTemplate, FieldSet, OptionSet, RowCondition, ShowWhen, Tone } from '../types';
import { withLinks, type SetLinks } from './builders';

const TITLE = 'legal.title';
const LITIGATION = 'legal.litigation';

/** The sets of Title. Owners is the worked example's; the rest are declared here. */
const T = {
  owners: 'legal.title.owners',
  records: 'legal.title.records',
  landRecords: 'legal.title.land_records',
  ownership: 'legal.title.ownership',
  chain: 'legal.title.chain',
  instruments: 'legal.title.instruments',
  encumbrance: 'legal.title.encumbrance',
  certificates: 'legal.title.ec_certificates',
  entries: 'legal.title.ec_entries',
  charges: 'legal.title.charges',
  character: 'legal.title.character',
  restrictions: 'legal.title.restrictions',
  opinion: 'legal.title.opinion',
  requisitions: 'legal.title.requisitions',
} as const;

const L = {
  register: 'legal.litigation.register',
  diary: 'legal.litigation.diary',
  orders: 'legal.litigation.orders',
  cover: 'legal.litigation.order_cover',
  search: 'legal.litigation.search',
  searches: 'legal.litigation.registry_searches',
  hits: 'legal.litigation.search_hits',
  notices: 'legal.litigation.notices',
} as const;

const PARCELS = 'shared.parcels';
const MATTERS = 'shared.matters';

/* ------------------------------------------------------------------ */
/* Small shapes written once                                            */
/* ------------------------------------------------------------------ */

const title = (set: string, field: string): FieldAddress => ({ fn: TITLE, set, field });
const litigation = (set: string, field: string): FieldAddress => ({ fn: LITIGATION, set, field });
const shared = (set: string, field: string): FieldAddress => ({ fn: 'shared', set, field });

/** A list of choices: key, label and, where a choice says something by itself, its tone. */
const list = (id: string, label: string, options: Array<[key: string, label: string, tone?: Tone]>): OptionSet => ({
  id,
  label,
  options: options.map(([key, said, tone]) => ({ key, label: said, ...(tone ? { tone } : {}) })),
});

type More = Partial<CheckFieldDef>;

/** The same fact, entered on a check that already keeps it. */
const mirror = (key: string, label: string, kind: CheckFieldDef['kind'], sameAs: FieldAddress, more: More = {}): CheckFieldDef => ({ key, label, kind, sameAs, required: false, ...more });
const computed = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => ({ key, label, kind: 'computed', formula, precision: 0, ...more });
/** How many records of a set there are, or how many meet a condition. */
const count = (key: string, label: string, set: string, more: More = {}): CheckFieldDef => computed(key, label, { op: 'records', set, reduce: 'count' }, more);
const countIf = (key: string, label: string, set: string, where: RowCondition, more: More = {}): CheckFieldDef => computed(key, label, { op: 'count_if', over: { records: set }, where }, more);

/** The units land is written in. */
const LAND_UNITS = ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare', 'ground'];
const land = (key: string, label: string, more: More = {}): CheckFieldDef => ({ key, label, kind: 'area', dimension: 'area', enterIn: LAND_UNITS, ...more });

/** Fires when the first field is above nought: a count of things that should not be there. */
const none = (field: string, say: string, severity: CheckInsightRule['severity'], when?: ShowWhen): CheckInsightRule => ({ kind: 'at_most', fields: [field], against: 0, say, severity, ...(when ? { when } : {}) });
/** Fires when a count is still nought: the sheet has not been started. */
const notStarted = (field: string): { when: CheckInsightRule; label: string; tone: Tone } => ({ when: { kind: 'at_least', fields: [field], against: 1, say: 'Nothing is recorded yet.', severity: 'low' }, label: 'Not started', tone: 'neutral' });
const failing = (field: string, label: string, tone: Tone = 'critical'): { when: CheckInsightRule; label: string; tone: Tone } => ({ when: none(field, label, tone === 'critical' ? 'high' : 'medium'), label, tone });

const anyRecord = (set: string, where?: RowCondition): ShowWhen => ({ records: set, is: 'any', ...(where ? { where } : {}) });
const holds = (address: FieldAddress, is: 'set' | 'true' | 'false' | 'equals' | 'in', value?: unknown): ShowWhen => ({ field: address, is, ...(value !== undefined ? { value } : {}) });
const situation = (key: string): ShowWhen => ({ situation: key });
/** Out of sight until the set it is worked out from holds a record: a sheet nobody has started shows no row of noughts. */
const once = (set: string): More => ({ tier: 'situational', showWhen: anyRecord(set) });

/** A day a search or a record should be run again by: the day it was made plus the days it is relied on. */
const refreshBy = (key: string, label: string, madeOn: string, table: string, leadDays: number, more: More = {}): CheckFieldDef => ({
  key,
  label,
  kind: 'computed',
  yields: 'date',
  formula: { op: 'add_days', date: { op: 'date', key: madeOn }, days: { op: 'rate', table } },
  expires: { leadDays },
  ...more,
});

/* ------------------------------------------------------------------ */
/* Lists                                                                */
/* ------------------------------------------------------------------ */

const INSTRUMENT_KIND = list('instrument_kind', 'Instrument', [
  ['sale_deed', 'Sale deed'],
  ['gift_deed', 'Gift deed'],
  ['partition_deed', 'Partition deed'],
  ['release_deed', 'Release deed'],
  ['settlement_deed', 'Settlement deed'],
  ['exchange_deed', 'Exchange deed'],
  ['will', 'Will'],
  ['probate', 'Probate'],
  ['inheritance', 'Inheritance, with no instrument'],
  ['decree', 'Decree'],
  ['grant', 'Grant'],
  ['regrant', 'Regrant'],
  ['mortgage', 'Mortgage', 'warning'],
  ['release_of_mortgage', 'Release of mortgage', 'good'],
  ['agreement_to_sell', 'Agreement to sell', 'warning'],
  ['cancellation', 'Cancellation'],
  ['rectification', 'Rectification'],
  ['power_of_attorney', 'Power of attorney', 'warning'],
  ['lease', 'Lease'],
  ['development_agreement', 'Development agreement'],
]);

const COURT_FORUM = list('court_forum', 'Forum', [
  ['civil_court', 'Civil court'],
  ['commercial_court', 'Commercial court'],
  ['high_court', 'High Court'],
  ['supreme_court', 'Supreme Court'],
  ['rera_authority', 'RERA authority'],
  ['rera_adjudicating_officer', 'RERA adjudicating officer'],
  ['rera_appellate_tribunal', 'RERA appellate tribunal'],
  ['consumer_commission', 'Consumer commission'],
  ['company_law_tribunal', 'Company law tribunal'],
  ['debt_recovery_tribunal', 'Debt recovery tribunal'],
  ['green_tribunal', 'Green tribunal'],
  ['revenue_court', 'Revenue court'],
  ['land_tribunal', 'Land tribunal'],
  ['arbitral_tribunal', 'Arbitral tribunal'],
  ['criminal_court', 'Criminal court'],
  ['enforcement_authority', 'Enforcement or tax authority'],
]);

const CASE_STAGE = list('case_stage', 'Stage', [
  ['filing', 'Filing and scrutiny'],
  ['summons', 'Summons or notice'],
  ['appearance', 'Appearance'],
  ['written_statement', 'Written statement or objections'],
  ['interim_applications', 'Interim applications'],
  ['issues', 'Issues'],
  ['plaintiff_evidence', 'Plaintiff’s evidence'],
  ['defendant_evidence', 'Defendant’s evidence'],
  ['arguments', 'Arguments'],
  ['judgment', 'Judgment'],
  ['decree_drawn', 'Decree drawn'],
  ['execution', 'Execution'],
  ['appeal_admitted', 'Appeal admitted'],
  ['appeal_hearing', 'Appeal for hearing'],
  ['mediation', 'Referred to mediation or Lok Adalat'],
]);

const REGISTRY = list('court_registry', 'Registry', [
  ['district_courts', 'District and civil courts'],
  ['commercial_court', 'Commercial court'],
  ['high_court', 'High Court'],
  ['supreme_court', 'Supreme Court'],
  ['company_law_tribunal', 'Company law tribunal'],
  ['debt_recovery_tribunal', 'Debt recovery tribunal'],
  ['consumer_commission', 'Consumer commission'],
  ['rera_authority', 'RERA authority'],
  ['green_tribunal', 'Green tribunal'],
  ['revenue_court', 'Revenue court'],
  ['lok_adalat', 'Lok Adalat'],
]);

const RERA_FORUMS = ['rera_authority', 'rera_adjudicating_officer', 'rera_appellate_tribunal'];
const GRANT_KINDS = ['grant_condition', 'grant_to_scheduled_caste_or_tribe'];
const NOTIFIED_KINDS = ['acquisition', 'road_widening', 'plan_reservation'];
const ORDERED_KINDS = [...GRANT_KINDS, ...NOTIFIED_KINDS, 'tenancy'];
const NATURAL_PERSONS = ['individual', 'karta of an HUF'];
const ENTITIES = ['company', 'trust'];
const MINOR = 'minor through a guardian';

/* ==================================================================== */
/* TITLES                                                                */
/* ==================================================================== */

/* --- T1. Land records ------------------------------------------------ */

/** What the land records say of a parcel that every department reads: the land schedule. */
const PARCEL_FACTS: FieldSet = {
  id: 'legal.title.parcel_facts',
  fn: TITLE,
  title: 'Land schedule',
  v: 1,
  extends: PARCELS,
  optionSets: [
    list('land_class', 'Classification', [
      ['dry', 'Dry (khushki)'],
      ['wet', 'Wet (tari)'],
      ['garden', 'Garden (bagayat)'],
      ['plantation', 'Plantation'],
      ['converted', 'Converted to non-agricultural', 'good'],
    ]),
    list('khata_kind', 'Khata', [
      ['a_khata', 'A khata', 'good'],
      ['b_khata', 'B khata', 'warning'],
      ['e_khata', 'e-Khata', 'good'],
      ['panchayat', 'Panchayat property register'],
      ['municipal', 'Municipal property register'],
      ['no_khata', 'No khata held', 'critical'],
    ]),
  ],
  sections: [{ key: 'schedule', label: 'Land schedule' }],
  fields: [
    { key: 'land_class', label: 'Classification on the RTC', kind: 'enum', optionSet: 'land_class', section: 'schedule', required: false, from: 'RTC' },
    land('kharab_a', 'Phut kharab A', { section: 'schedule', required: false, from: 'RTC', hint: 'Part of the holding that cannot be cultivated.' }),
    land('kharab_b', 'Phut kharab B', { section: 'schedule', required: false, from: 'RTC', hint: 'Kept for a public purpose: a road, a drain, a tank. Never built on.' }),
    computed('net_extent', 'Net extent after kharab', { op: 'subtract', left: { op: 'subtract', left: { op: 'field', key: 'extent' }, right: { op: 'field', key: 'kharab_a' } }, right: { op: 'field', key: 'kharab_b' } }, { section: 'schedule', dimension: 'area', precision: 2 }),
    { key: 'khata_kind', label: 'Khata held', kind: 'enum', optionSet: 'khata_kind', section: 'schedule', required: false, from: 'Khata' },
    { key: 'khata_no', label: 'Khata number', kind: 'text', section: 'schedule', required: false, from: 'Khata', fromTypes: ['Khata certificate and extract'], factKey: 'khata_number' },
    { key: 'property_no', label: 'Municipal property number', kind: 'text', section: 'schedule', required: false, from: 'Khata' },
  ],
  rules: [],
};

const LAND_RECORDS_SHEET: FieldSet = {
  id: T.records,
  fn: TITLE,
  title: 'Land records',
  v: 1,
  sections: [{ key: 'extents', label: 'Extent, record by record' }, { key: 'state', label: 'Where the records stand' }],
  fields: [
    mirror('extent_title', 'Extent per title', 'area', title('land_site.parcel_identification', 'extent_title'), { unit: 'sqm', section: 'extents' }),
    mirror('extent_survey', 'Extent per survey sketch', 'area', title('land_site.parcel_identification', 'extent_survey'), { unit: 'sqm', section: 'extents' }),
    mirror('extent_khata', 'Extent per khata', 'area', title('land_site.parcel_identification', 'extent_khata'), { unit: 'sqm', section: 'extents' }),
    computed('extent_rtc', 'Extent per RTC, all parcels', { op: 'records', set: T.landRecords, reduce: 'sum', field: 'rtc_extent' }, { section: 'extents', dimension: 'area', precision: 2, ...once(PARCELS) }),
    computed('extent_net', 'Net extent after kharab', { op: 'records', set: PARCELS, reduce: 'sum', field: 'net_extent' }, { section: 'extents', dimension: 'area', precision: 2, ...once(PARCELS) }),
    countIf('extent_net_parcels', 'Parcels the net extent rests on', PARCELS, { column: 'net_extent', is: 'set' }, { section: 'extents', ...once(PARCELS) }),
    count('parcels', 'Parcels', PARCELS, { section: 'state' }),
    count('land_records', 'Parcels with a land record', T.landRecords, { section: 'state', ...once(PARCELS) }),
    countIf('mutations_open', 'Mutations pending or disputed', T.landRecords, { column: 'mutation', is: 'in', value: ['pending', 'disputed'] }, { section: 'state', ...once(T.landRecords) }),
    {
      key: 'records_standing',
      label: 'Land records',
      kind: 'status',
      section: 'state',
      cases: [
        notStarted('parcels'),
        { when: { kind: 'at_least', fields: ['land_records', 'parcels'], say: 'A parcel has no land record.', severity: 'medium' }, label: 'A parcel has no land record', tone: 'warning' },
        { when: { kind: 'compare', fields: ['extent_rtc', 'extent_title'], tolerance: 0.01, say: 'The RTCs and the title differ.', severity: 'high' }, label: 'RTC extent differs from the title', tone: 'critical' },
        failing('mutations_open', 'A mutation is not settled', 'warning'),
      ],
      otherwise: { label: 'Records agree', tone: 'good' },
    },
  ],
  rules: [
    { kind: 'compare', fields: ['extent_rtc', 'extent_title'], tolerance: 0.01, when: anyRecord(T.landRecords), say: 'The RTCs add up to {a} and the title recites {b}: {divergence} apart, outside {tolerance}.', severity: 'high' },
    none('mutations_open', '{a} mutation(s) are pending or disputed.', 'medium'),
    // A parcel with no extent or no kharab recorded adds nothing to the net extent: the figure says how many parcels it is a figure of.
    { kind: 'at_least', fields: ['extent_net_parcels', 'parcels'], when: anyRecord(PARCELS), say: 'Net extent after kharab rests on {a} of {b} parcels: the others have no extent or no kharab recorded.', severity: 'medium' },
  ],
};

/** What each government record says of one parcel. */
const LAND_RECORDS: FieldSet = {
  id: T.landRecords,
  fn: TITLE,
  title: 'Land record, parcel by parcel',
  v: 1,
  records: { of: 'land record', titleField: 'parcel', summaryFields: ['rtc_year', 'mutation', 'record_standing'] },
  optionSets: [
    list('mutation_state', 'Mutation', [
      ['settled', 'In the owner’s name', 'good'],
      ['pending', 'Pending', 'warning'],
      ['disputed', 'Disputed', 'critical'],
    ]),
    list('survey_sketch_kind', 'Sketch', [
      ['tippani', 'Tippani'],
      ['hissa_tippani', 'Hissa tippani'],
      ['pre_mutation', '11E sketch'],
      ['podi', 'Podi sketch'],
      ['village_map', 'Village map only', 'warning'],
      ['private_survey', 'Private total-station survey'],
    ]),
  ],
  sections: [{ key: 'rtc', label: 'RTC' }, { key: 'survey', label: 'Survey, khata and tax' }, { key: 'more', label: 'Boundaries', tier: 'expert' }],
  fields: [
    { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel', section: 'rtc', fromTypes: ['RTC (record of rights)'], factKey: 'survey_numbers' },
    { key: 'rtc_year', label: 'RTC year', kind: 'text', section: 'rtc', from: 'RTC', fromTypes: ['RTC (record of rights)'], hint: 'As printed: the revenue year.' },
    { key: 'rtc_fetched_on', label: 'RTC fetched on', kind: 'date', section: 'rtc', from: 'Bhoomi' },
    refreshBy('refresh_by', 'Fetch again by', 'rtc_fetched_on', 'search_fresh_days', 7, { section: 'rtc' }),
    land('rtc_extent', 'Extent per RTC', { section: 'rtc', from: 'RTC', fromTypes: ['RTC (record of rights)'], factKey: 'extent_title', proof: 'expected' }),
    { key: 'rtc_owner', label: 'Owner on the RTC', kind: 'ref', target: 'party', section: 'rtc', from: 'RTC', fromTypes: ['RTC (record of rights)'], factKey: 'owner' },
    { key: 'mutation', label: 'Mutation', kind: 'enum', control: 'segmented', optionSet: 'mutation_state', section: 'rtc', from: 'Mutation register' },
    { key: 'cultivator_differs', label: 'Cultivator differs from the owner', kind: 'boolean', control: 'switch', section: 'rtc', required: false, from: 'RTC' },
    { key: 'liability_on_rtc', label: 'Rights and liabilities column carries an entry', kind: 'boolean', control: 'switch', section: 'rtc', required: false, from: 'RTC' },
    { key: 'rtc', label: 'RTC', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'rtc', required: false },
    { key: 'sketch', label: 'Survey sketch held', kind: 'enum', optionSet: 'survey_sketch_kind', section: 'survey', from: 'Survey sketch' },
    { key: 'survey_sketch', label: 'Survey sketch', kind: 'evidence', accepts: 'document', viewer: 'drawing', section: 'survey', required: false },
    { key: 'podi_done', label: 'Sub-division (podi) done', kind: 'boolean', control: 'tick', section: 'survey', required: false },
    land('akarband_extent', 'Extent per akarband', { section: 'survey', required: false, from: 'Akarband' }),
    { key: 'khata_holder', label: 'Khata holder', kind: 'ref', target: 'party', section: 'survey', required: false, from: 'Khata' },
    { key: 'tax_paid_on', label: 'Property tax last paid on', kind: 'date', section: 'survey', required: false, from: 'Tax receipt' },
    {
      key: 'boundaries',
      label: 'Boundaries',
      kind: 'table',
      section: 'more',
      tier: 'expert',
      required: false,
      from: 'Deed schedule and sketch',
      columns: [
        { key: 'side', label: 'Side', kind: 'enum', options: ['north', 'east', 'south', 'west'] },
        { key: 'bounded_by', label: 'Bounded by', kind: 'text' },
        { key: 'length', label: 'Length', kind: 'number', unit: 'm', required: false },
      ],
    },
    {
      key: 'record_standing',
      label: 'This record',
      kind: 'status',
      section: 'rtc',
      cases: [{ when: { kind: 'compare', fields: ['rtc_extent', 'akarband_extent'], tolerance: 0, say: 'RTC and akarband differ.', severity: 'high' }, label: 'RTC and akarband differ', tone: 'critical' }],
      otherwise: { label: 'In order', tone: 'good' },
    },
  ],
  rules: [{ kind: 'compare', fields: ['rtc_extent', 'akarband_extent'], tolerance: 0, say: 'The RTC records {a} and the akarband {b}: {divergence} apart.', severity: 'high' }],
};

/* --- T2. Ownership, and the chain of title -------------------------- */

const OWNERSHIP: FieldSet = {
  id: T.ownership,
  fn: TITLE,
  title: 'Ownership and who signs',
  v: 1,
  situations: [
    { key: 'multiple_owners', label: 'More than one owner', scope: 'function', hint: 'Each sharer joins the deed, or the buyer takes an undivided share.', derive: { records: T.owners, is: 'at_least', n: 2 } },
    { key: 'owner_deceased', label: 'An owner has died', scope: 'function', hint: 'Every heir joins or releases, a married daughter among them.', derive: anyRecord(T.owners, { column: 'living', is: 'false' }) },
    { key: 'minor_owner', label: 'A minor holds a share', scope: 'function', hint: 'A guardian’s sale can be set aside when the minor comes of age, unless a court allowed it.', derive: anyRecord(T.owners, { column: 'capacity', is: 'equals', value: MINOR }) },
    { key: 'owner_is_entity', label: 'An owner is a company or a trust', scope: 'project', hint: 'Somebody has to have been authorised to sell.', derive: anyRecord(T.owners, { column: 'capacity', is: 'in', value: ENTITIES }) },
  ],
  sections: [
    { key: 'shares', label: 'Shares' },
    { key: 'joining', label: 'Joining the deed', showWhen: situation('multiple_owners') },
    { key: 'succession', label: 'Succession', showWhen: situation('owner_deceased') },
    { key: 'minors', label: 'Minors', showWhen: situation('minor_owner') },
    { key: 'entities', label: 'Companies and trusts', showWhen: situation('owner_is_entity') },
  ],
  fields: [
    computed('shares_total', 'Shares, added up', { op: 'records', set: T.owners, reduce: 'sum', field: 'share_pct' }, { section: 'shares', unit: '%', precision: 2 }),
    {
      key: 'owners_by_parcel',
      label: 'Survey numbers and their owners',
      kind: 'table',
      display: 'match',
      section: 'shares',
      required: false,
      ...once(T.owners),
      from: 'RTC and the last deed',
      columns: [
        { key: 'parcel', label: 'Survey number', kind: 'ref', target: 'parcel' },
        { key: 'owner', label: 'Owner', kind: 'ref', target: { set: T.owners } },
      ],
      match: { left: { column: 'parcel', label: 'Survey numbers', of: { target: 'parcel' } }, right: { column: 'owner', label: 'Owners', of: { target: { set: T.owners } } } },
    },
    {
      key: 'ownership_standing',
      label: 'Ownership',
      kind: 'status',
      section: 'shares',
      cases: [
        { when: { kind: 'at_least', fields: ['shares_total'], against: 0.01, say: 'No share is recorded.', severity: 'low' }, label: 'Shares not recorded', tone: 'neutral' },
        { when: { kind: 'compare', fields: ['shares_total'], against: 100, tolerance: 0, say: 'Shares do not add up.', severity: 'high' }, label: 'Shares do not add up', tone: 'critical' },
        failing('not_joining', 'An owner is not joining'),
        failing('owners_without_heirs', 'An owner has died with no heir recorded'),
        failing('approvals_not_held', 'An approval to sell is not held'),
      ],
      otherwise: { label: 'Every owner accounted for', tone: 'good' },
    },
    countIf('not_joining', 'Owners not joining the deed', T.owners, { column: 'joins_as', is: 'equals', value: 'not_joining' }, { section: 'joining', tier: 'situational' }),
    countIf('confirming', 'Confirming parties', T.owners, { column: 'joins_as', is: 'equals', value: 'confirming_party' }, { section: 'joining', tier: 'situational' }),
    computed('heirs', 'Heirs recorded', { op: 'records', set: T.owners, reduce: 'sum', field: 'heirs_recorded' }, { section: 'succession', tier: 'situational' }),
    countIf('owners_without_heirs', 'Owners who died with no heir recorded', T.owners, { column: 'heirs_wanting', is: 'gt', value: 0 }, { section: 'succession', tier: 'situational' }),
    { key: 'family_tree', label: 'Attested family tree', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'succession', tier: 'situational', from: 'Revenue office' },
    countIf('minors', 'Minors among the owners', T.owners, { column: 'capacity', is: 'equals', value: MINOR }, { section: 'minors', tier: 'situational' }),
    countIf('approvals_not_held', 'Approvals to sell not held', T.owners, { column: 'members_approval', is: 'equals', value: 'not_held' }, { section: 'entities', tier: 'situational' }),
  ],
  rules: [
    { kind: 'compare', fields: ['shares_total'], against: 100, tolerance: 0, when: situation('multiple_owners'), say: 'The owners’ shares add up to {a}, not {b}.', severity: 'high' },
    none('not_joining', '{a} owner(s) with a share join the deed as neither vendor nor confirming party.', 'high'),
    // Said once, on the Succession sheet of the owner it is about, where the line opens that sheet. Kept here at low so the standing above is not a second line under Needs you.
    { ...none('owners_without_heirs', 'An owner has died with no heir recorded', 'high'), severity: 'low' },
    none('minors', '{a} owner(s) are minors: each sale is open to challenge after majority unless a court allowed it.', 'medium'),
    none('approvals_not_held', '{a} owner(s) sell without the approval of their members or their authority.', 'critical'),
  ],
};

const owner = (field: string): FieldAddress => title(T.owners, field);

/** Titles’ facts about an owner, on the one owner record: how they join, and what follows from who they are. */
const OWNER_FACTS: FieldSet = {
  id: 'legal.title.owner_facts',
  fn: TITLE,
  title: 'Owner',
  v: 1,
  extends: T.owners,
  optionSets: [
    list('joins_as', 'Joins as', [
      ['vendor', 'Vendor', 'good'],
      ['confirming_party', 'Confirming party', 'good'],
      ['not_joining', 'Not joining', 'critical'],
    ]),
    list('succession_by', 'Succession', [
      ['probated_will', 'Will, with probate'],
      ['will', 'Will, without probate', 'warning'],
      ['intestate', 'Intestate'],
      ['survivorship', 'Survivorship'],
    ]),
    list('property_character', 'Property', [
      ['self_acquired', 'Self-acquired'],
      ['ancestral', 'Ancestral or joint family', 'warning'],
    ]),
    list('members_approval', 'Approval', [
      ['held', 'Held', 'good'],
      ['not_held', 'Not held', 'critical'],
      ['not_needed', 'Not needed'],
    ]),
  ],
  sections: [
    { key: 'minority', label: 'Minor', showWhen: holds(owner('capacity'), 'equals', MINOR) },
    { key: 'entity', label: 'Authority to sell', showWhen: holds(owner('capacity'), 'in', ENTITIES) },
  ],
  fields: [
    { key: 'joins_as', label: 'Joins the deed as', kind: 'enum', control: 'segmented', optionSet: 'joins_as', tier: 'situational', showWhen: { all: [situation('multiple_owners'), holds(owner('living'), 'true')] } },
    // An heir is a row on the Succession sheet of the owner who died, not another owner. What was saved under these two keys is kept and no longer asked.
    { key: 'heir_of', label: 'Heir of', kind: 'text', suggest: 'party', required: false, retired: true },
    { key: 'relation', label: 'Relation', kind: 'enum', options: ['spouse', 'son', 'daughter', 'mother', 'father', 'another heir'], required: false, retired: true },
    {
      key: 'living',
      label: 'Living',
      kind: 'boolean',
      control: 'switch',
      required: false,
      tier: 'situational',
      showWhen: holds(owner('capacity'), 'in', NATURAL_PERSONS),
      // Taken to be living, and a company or a trust to be in being, until somebody says otherwise: only the dead are asked about.
      defaults: [{ value: true, from: 'catalog', cite: 'An owner is taken to be living until a paper says otherwise' }],
    },
    // The death, how the share passed and the heirs it passed to are on the owner's Succession sheet, declared with the owner record
    // (example-land-holding.ts) under the keys they always had.
    // The minor's own facts (date of birth, the guardian, the court's leave and its order) are on the owner's Guardianship sheet, declared
    // with the owner record; what follows here is only what is worked out from them.
    {
      key: 'majority_on',
      label: 'Comes of age on',
      kind: 'computed',
      yields: 'date',
      section: 'minority',
      tier: 'situational',
      formula: { op: 'add_months', date: { op: 'date', key: 'date_of_birth' }, months: { op: 'multiply', left: { op: 'rate', table: 'age_of_majority_years' }, right: { op: 'const', value: 12 } } },
    },
    {
      key: 'challenge_days_left',
      label: 'Days the sale stays open to challenge',
      kind: 'computed',
      precision: 0,
      section: 'minority',
      tier: 'situational',
      formula: {
        op: 'subtract',
        left: { op: 'add_months', date: { op: 'date', key: 'majority_on' }, months: { op: 'multiply', left: { op: 'rate', table: 'minor_sale_challenge_years' }, right: { op: 'const', value: 12 } } },
        right: { op: 'today' },
      },
    },
    { key: 'resolution_date', label: 'Authorising resolution dated', kind: 'date', section: 'entity', tier: 'situational', from: 'Resolution' },
    { key: 'members_approval', label: 'Approval of the members or the authority', kind: 'enum', control: 'segmented', optionSet: 'members_approval', section: 'entity', tier: 'situational' },
  ],
  rules: [none('challenge_days_left', 'A sale for this minor stays open to challenge for another {a} days.', 'medium')],
};

const instrument = (field: string): FieldAddress => title(T.instruments, field);
const PARTITION_PAPERS = ['unregistered_deed', 'oral_memorandum'];

const CHAIN: FieldSet = {
  id: T.chain,
  fn: TITLE,
  title: 'Chain of title',
  v: 1,
  optionSets: [
    list('title_root', 'Root', [
      ['sale_deed', 'Sale deed', 'good'],
      ['partition', 'Partition'],
      ['decree', 'Decree'],
      ['government_grant', 'Government grant', 'warning'],
      ['inam_regrant', 'Inam regrant', 'warning'],
      ['land_reforms_occupancy', 'Land-reforms occupancy', 'warning'],
      ['ancestral', 'Ancestral, with no document', 'warning'],
    ]),
  ],
  situations: [
    { key: 'sale_through_attorney', label: 'A deed was signed by an attorney', scope: 'function', hint: 'A power of attorney conveys nothing by itself, and ends when the principal dies.', derive: anyRecord(T.instruments, { column: 'signed_through', is: 'equals', value: 'attorney' }) },
    { key: 'unregistered_partition', label: 'A partition was not registered', scope: 'function', hint: 'A paper that itself divides the land has to be registered to prove the division.', derive: anyRecord(T.instruments, { column: 'partition_form', is: 'in', value: PARTITION_PAPERS }) },
  ],
  sections: [
    { key: 'span', label: 'How far back' },
    { key: 'links', label: 'Links' },
    { key: 'attorney', label: 'Signed by an attorney', showWhen: situation('sale_through_attorney') },
    { key: 'partition', label: 'Unregistered partition', showWhen: situation('unregistered_partition') },
  ],
  fields: [
    mirror('root_date', 'Root of title', 'date', title('legal.title_chain', 'root_year'), { section: 'span' }),
    { key: 'root_kind', label: 'The root is a', kind: 'enum', optionSet: 'title_root', section: 'span', from: 'Mother deed', requiredWhen: anyRecord(T.instruments) },
    mirror('years_required', 'Years of chain required', 'duration', title('legal.title_chain', 'years_required'), { unit: 'years', section: 'span' }),
    computed('years_usual', 'Years a lender usually asks for', { op: 'rate', table: 'title_search_years' }, { unit: 'years', section: 'span' }),
    mirror('years_established', 'Years established', 'number', title('legal.title_chain', 'years_established'), { unit: 'years', section: 'span' }),
    count('instruments', 'Instruments recorded', T.instruments, { section: 'links' }),
    countIf('unregistered', 'Links with no registered instrument', T.instruments, { column: 'registered', is: 'false' }, { section: 'links', ...once(T.instruments) }),
    countIf('without_conveyance', 'Links resting on an attorney or an agreement alone', T.instruments, { column: 'conveyance_followed', is: 'false' }, { section: 'links', ...once(T.instruments) }),
    {
      key: 'chain_by_parcel',
      label: 'Survey numbers and the instruments that convey them',
      kind: 'table',
      display: 'match',
      section: 'links',
      required: false,
      ...once(T.instruments),
      from: 'Deed schedules',
      columns: [
        { key: 'parcel', label: 'Survey number', kind: 'ref', target: 'parcel' },
        { key: 'instrument', label: 'Instrument', kind: 'ref', target: { set: T.instruments } },
      ],
      match: { left: { column: 'parcel', label: 'Survey numbers', of: { target: 'parcel' } }, right: { column: 'instrument', label: 'Instruments', of: { target: { set: T.instruments } } } },
    },
    {
      key: 'chain_standing',
      label: 'Chain',
      kind: 'status',
      section: 'links',
      cases: [
        notStarted('instruments'),
        failing('unregistered', 'A link is not registered'),
        failing('without_conveyance', 'A link has no conveyance'),
        failing('principal_not_living', 'An attorney signed after the principal died'),
        failing('unregistered_partitions', 'A partition is not registered'),
        { when: { kind: 'at_least', fields: ['years_established', 'years_required'], say: 'Shorter than required.', severity: 'high' }, label: 'Shorter than required', tone: 'critical' },
        { when: { kind: 'at_least', fields: ['years_established', 'years_usual'], say: 'Shorter than a lender usually asks.', severity: 'medium' }, label: 'Shorter than a lender usually asks', tone: 'warning' },
      ],
      otherwise: { label: 'Chain established', tone: 'good' },
    },
    countIf('attorney_links', 'Deeds signed by an attorney', T.instruments, { column: 'signed_through', is: 'equals', value: 'attorney' }, { section: 'attorney', tier: 'situational' }),
    countIf('principal_not_living', 'Signed after the principal had died', T.instruments, { column: 'principal_alive_on_deed', is: 'false' }, { section: 'attorney', tier: 'situational' }),
    countIf('poa_unregistered', 'Powers of attorney not registered', T.instruments, { column: 'poa_registered', is: 'false' }, { section: 'attorney', tier: 'situational' }),
    countIf('unregistered_partitions', 'Partitions by an unregistered deed', T.instruments, { column: 'partition_form', is: 'equals', value: 'unregistered_deed' }, { section: 'partition', tier: 'situational' }),
    countIf('sharers_not_joined', 'Partitions a sharer did not join', T.instruments, { column: 'all_sharers_joined', is: 'false' }, { section: 'partition', tier: 'situational' }),
  ],
  rules: [
    none('unregistered', '{a} link(s) in the chain have no registered instrument.', 'high'),
    none('without_conveyance', '{a} link(s) rest on a power of attorney or an agreement, with no conveyance after it.', 'critical'),
    { kind: 'at_least', fields: ['years_established', 'years_required'], say: 'The chain is established for {a} and {b} are required.', severity: 'high' },
    { kind: 'compare', fields: ['instruments', 'on_check'], at: { on_check: title('legal.title_chain', 'instrument_count') }, tolerance: 0, when: anyRecord(T.instruments), say: 'Here {a} instruments are recorded and the chain check lists {b}.', severity: 'low' },
    none('principal_not_living', '{a} deed(s) were signed by an attorney after the principal had died.', 'critical'),
    none('poa_unregistered', '{a} deed(s) were signed under a power of attorney that is not registered.', 'high'),
    none('unregistered_partitions', '{a} partition(s) rest on an unregistered deed.', 'critical'),
    none('sharers_not_joined', '{a} partition(s) were not joined by every sharer.', 'high'),
  ],
};

/** One instrument in the chain. A deed, a will, a decree, or a link with no paper at all. */
const INSTRUMENTS: FieldSet = {
  id: T.instruments,
  fn: TITLE,
  title: 'Instruments in the chain',
  v: 1,
  records: { of: 'instrument', titleField: 'name', summaryFields: ['kind', 'executed_on', 'doc_no'] },
  optionSets: [
    INSTRUMENT_KIND,
    list('held_as', 'Held as', [
      ['original', 'Original', 'good'],
      ['certified_copy', 'Certified copy'],
      ['photocopy', 'Photocopy', 'warning'],
    ]),
    list('signed_through', 'Signed', [
      ['self', 'In person'],
      ['attorney', 'By an attorney', 'warning'],
      ['guardian', 'By a guardian', 'warning'],
      ['authorised_signatory', 'By an authorised signatory'],
    ]),
    list('partition_form', 'Partition by', [
      ['registered_deed', 'Registered deed', 'good'],
      ['unregistered_deed', 'Unregistered deed', 'critical'],
      ['oral_memorandum', 'Memorandum of an earlier oral partition', 'warning'],
      ['court_decree', 'Court decree'],
      ['revenue_only', 'Revenue sub-division only', 'warning'],
    ]),
  ],
  sections: [
    { key: 'deed', label: 'Instrument' },
    { key: 'signing', label: 'How it was signed' },
  ],
  // Two hard cases, each a sheet of the instrument that has it: one signed by an attorney, and a partition. Their fields are the instrument's, under the keys they always had.
  sheets: [
    {
      id: 'attorney',
      title: 'Signed by an attorney',
      showWhen: holds(instrument('signed_through'), 'equals', 'attorney'),
      fields: [
        { key: 'attorney', label: 'Attorney', kind: 'ref', target: 'party' },
        { key: 'poa_registered', label: 'Power of attorney registered', kind: 'boolean', control: 'switch' },
        { key: 'principal_alive_on_deed', label: 'Principal living on the day of the deed', kind: 'boolean', control: 'switch' },
        { key: 'poa', label: 'Power of attorney', kind: 'evidence', accepts: 'document', viewer: 'deed', required: false },
        { key: 'poa_executed_on', label: 'Power of attorney dated', kind: 'date', required: false, from: 'Power of attorney' },
        { key: 'poa_doc_no', label: 'Power of attorney, document number', kind: 'text', required: false, from: 'Power of attorney' },
        { key: 'poa_for_consideration', label: 'Given for consideration', kind: 'boolean', control: 'switch', required: false, hint: 'A power coupled with an interest does not end with the principal.' },
        { key: 'poa_revoked', label: 'Revoked before the deed', kind: 'boolean', control: 'switch', required: false },
      ],
      rules: [
        { kind: 'before', fields: ['poa_executed_on', 'executed_on'], say: 'The deed is dated {b}, before the power of attorney of {a} it was signed under.', severity: 'high' },
      ],
    },
    {
      id: 'partition',
      title: 'Partition',
      showWhen: holds(instrument('kind'), 'in', ['partition_deed', 'decree']),
      fields: [
        { key: 'partition_form', label: 'Partition made by', kind: 'enum', optionSet: 'partition_form' },
        { key: 'acted_upon', label: 'Acted upon by', kind: 'multi_enum', options: ['separate RTC', 'separate mutation', 'separate possession', 'separate khata'], required: false },
        { key: 'all_sharers_joined', label: 'Every sharer joined', kind: 'boolean', control: 'switch' },
        {
          key: 'shares_allotted',
          label: 'What each sharer took',
          kind: 'table',
          required: false,
          from: 'The partition deed or decree',
          columns: [
            { key: 'sharer', label: 'Sharer', kind: 'text', suggest: 'party' },
            { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel', required: false },
            { key: 'extent', label: 'Extent', kind: 'area', dimension: 'area', enterIn: LAND_UNITS, required: false },
          ],
        },
        { key: 'our_vendor_took', label: 'Our vendor’s schedule in it', kind: 'text', required: false, hint: 'As the deed letters it: Schedule B.' },
      ],
      rules: [],
    },
  ],
  fields: [
    { key: 'name', label: 'Instrument', kind: 'text', section: 'deed', hint: 'As the file calls it: Sale deed 2317 of 2019.' },
    { key: 'kind', label: 'Kind', kind: 'enum', optionSet: 'instrument_kind', section: 'deed' },
    { key: 'executed_on', label: 'Executed on', kind: 'date', section: 'deed', from: 'The instrument' },
    { key: 'from_party', label: 'From', kind: 'ref', target: 'party', section: 'deed' },
    { key: 'to_party', label: 'To', kind: 'ref', target: 'party', section: 'deed' },
    land('extent', 'Extent conveyed', { section: 'deed', required: false, fromTypes: ['Mother deed'], factKey: 'extent_title' }),
    { key: 'registered', label: 'Registered', kind: 'boolean', control: 'switch', section: 'deed' },
    { key: 'doc_no', label: 'Document number', kind: 'text', section: 'deed', from: 'The instrument', fromTypes: ['Mother deed'], factKey: 'document_number', requiredWhen: holds(instrument('registered'), 'true') },
    { key: 'registered_on', label: 'Registered on', kind: 'date', section: 'deed', from: 'The instrument', requiredWhen: holds(instrument('registered'), 'true') },
    { key: 'deed', label: 'The instrument', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'deed', required: false },
    { key: 'held_as', label: 'Held as', kind: 'enum', control: 'segmented', optionSet: 'held_as', section: 'deed', required: false },
    // The price and the duty paid on it are Law's, on the purchase this instrument completed: linked, and read from there.
    { key: 'purchase', label: 'Purchase, as Law records it', kind: 'ref', target: { set: 'legal.contracts.purchases' }, section: 'deed', required: false, tier: 'situational', showWhen: anyRecord('legal.contracts.purchases') },
    computed('consideration', 'Consideration, per that purchase', { op: 'field', key: 'consideration', at: { fn: 'legal.contracts', set: 'legal.contracts.purchases', field: 'consideration' }, via: 'purchase' }, { section: 'deed', dimension: 'money', currency: 'INR', precision: undefined, tier: 'situational', showWhen: holds(instrument('purchase'), 'set') }),
    { key: 'signed_through', label: 'Signed', kind: 'enum', optionSet: 'signed_through', section: 'signing', required: false },
    { key: 'conveyance_followed', label: 'A conveyance followed', kind: 'boolean', control: 'switch', section: 'signing', tier: 'situational', showWhen: holds(instrument('kind'), 'in', ['power_of_attorney', 'agreement_to_sell']) },
  ],
  rules: [{ kind: 'before', fields: ['executed_on', 'registered_on'], say: 'Registered on {b}, before it was executed on {a}.', severity: 'medium' }],
};

/* --- T3. Encumbrance and charge search ------------------------------- */

const SUBSISTING_CHARGE: ShowWhen = {
  any: [
    anyRecord(T.charges, { column: 'released', is: 'false' }),
    anyRecord(T.landRecords, { column: 'liability_on_rtc', is: 'true' }),
    holds(title('legal.encumbrances', 'ec_nil'), 'false'),
  ],
};

const ENCUMBRANCE: FieldSet = {
  id: T.encumbrance,
  fn: TITLE,
  title: 'Encumbrance and charge search',
  v: 1,
  optionSets: [
    list('originals_held_by', 'Originals with', [
      ['vendor', 'The vendor', 'good'],
      ['lender', 'A lender', 'critical'],
      ['developer', 'The developer'],
      ['advocate', 'An advocate'],
    ]),
  ],
  situations: [{ key: 'subsisting_charge', label: 'A charge is on the land', scope: 'function', hint: 'A mortgage by deposit of title deeds may not show on the certificate: a clean certificate is not a clean title.', derive: SUBSISTING_CHARGE }],
  sections: [
    { key: 'search', label: 'Period searched' },
    { key: 'entries', label: 'Entries against the chain' },
    { key: 'charges', label: 'Charges' },
    { key: 'registries', label: 'Other registries' },
    { key: 'open', label: 'Charge on the land', showWhen: situation('subsisting_charge') },
  ],
  fields: [
    mirror('ec_from', 'Searched from', 'date', title('legal.encumbrances', 'ec_from'), { section: 'search' }),
    mirror('ec_to', 'Searched to', 'date', title('legal.encumbrances', 'ec_to'), { section: 'search' }),
    mirror('ec_nil', 'Nil result', 'boolean', title('legal.encumbrances', 'ec_nil'), { section: 'search' }),
    count('certificates', 'Certificates held', T.certificates, { section: 'search' }),
    computed('years_covered', 'Years covered', { op: 'divide', left: { op: 'subtract', left: { op: 'date', key: 'ec_to' }, right: { op: 'date', key: 'ec_from' } }, right: { op: 'const', value: 365.25 } }, { unit: 'years', precision: 1, section: 'search', ...once(T.certificates) }),
    computed(
      'gap_days',
      'Days of the period no certificate covers',
      // Worked out by the figures door: certificates that overlap are merged and only days inside the period count, so it is never below nought (a sum of each certificate's days counted an overlap twice).
      { op: 'figure', key: 'title.ec_uncovered_days' },
      { unit: 'days', section: 'search', ...once(T.certificates) },
    ),
    {
      key: 'ec_to_chain',
      label: 'Certificate entries and the instruments they are',
      kind: 'table',
      display: 'match',
      section: 'entries',
      required: false,
      ...once(T.entries),
      from: 'Encumbrance certificate and the chain',
      columns: [
        { key: 'entry', label: 'Entry', kind: 'ref', target: { set: T.entries } },
        { key: 'instrument', label: 'Instrument', kind: 'ref', target: { set: T.instruments } },
      ],
      match: { left: { column: 'entry', label: 'Certificate entries', of: { records: T.entries, field: 'doc_no' } }, right: { column: 'instrument', label: 'Registered instruments', of: { records: T.instruments, field: 'doc_no' } } },
    },
    countIf('charges_open', 'Charges not released', T.charges, { column: 'released', is: 'false' }, { section: 'charges', ...once(T.charges) }),
    { key: 'originals_held_by', label: 'Original deeds are with', kind: 'enum', control: 'segmented', optionSet: 'originals_held_by', section: 'charges', ...once(T.certificates) },
    { key: 'cersai_searched_on', label: 'Security-interest registry searched on', kind: 'date', section: 'registries', from: 'CERSAI search report', ...once(T.certificates) },
    refreshBy('cersai_refresh_by', 'Search the registry again by', 'cersai_searched_on', 'search_fresh_days', 7, { section: 'registries', ...once(T.certificates) }),
    { key: 'cersai_ref', label: 'Registry search reference', kind: 'text', section: 'registries', tier: 'expert', required: false, from: 'CERSAI search report' },
    { key: 'mca_searched_on', label: 'Company charge register searched on', kind: 'date', section: 'registries', tier: 'situational', showWhen: situation('owner_is_entity'), from: 'Index of charges' },
    {
      key: 'encumbrance_standing',
      label: 'Encumbrance',
      kind: 'status',
      section: 'charges',
      cases: [failing('charges_open', 'A charge is not released'), notStarted('certificates'), failing('gap_days', 'The search period has a gap', 'warning')],
      otherwise: { label: 'Clear on the search', tone: 'good' },
    },
    countIf('liabilities_on_rtc', 'Parcels whose RTC carries a liability', T.landRecords, { column: 'liability_on_rtc', is: 'true' }, { section: 'open', tier: 'situational' }),
    count('charges', 'Charges recorded', T.charges, { section: 'open', tier: 'situational' }),
    { key: 'lender_letter', label: 'Lender’s letter on the originals', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'open', tier: 'situational', showWhen: holds(title(T.encumbrance, 'originals_held_by'), 'equals', 'lender') },
  ],
  rules: [
    none('gap_days', 'The certificates leave {a} of the search period uncovered.', 'medium', anyRecord(T.certificates)),
    { kind: 'at_least', fields: ['years_covered', 'required'], at: { required: title('legal.title_chain', 'years_required') }, say: 'The search covers {a} and the chain is required for {b}.', severity: 'high' },
    none('charges_open', '{a} charge(s) on the land are not released.', 'high'),
    { kind: 'compare', fields: ['charges_open', 'on_check'], at: { on_check: title('legal.encumbrances', 'subsisting_charges') }, tolerance: 0, when: anyRecord(T.charges), say: 'Here {a} charges are open and the encumbrance check records {b}.', severity: 'low' },
    { kind: 'at_least', fields: ['charges', 'liabilities_on_rtc'], say: 'The RTC of {b} parcel(s) carries a liability and {a} charge(s) are recorded.', severity: 'medium' },
  ],
};

const CERTIFICATES: FieldSet = {
  id: T.certificates,
  fn: TITLE,
  title: 'Encumbrance certificates',
  v: 1,
  records: { of: 'certificate', titleField: 'certificate_no', summaryFields: ['from', 'to', 'result'] },
  optionSets: [
    list('ec_result', 'Result', [
      ['nil', 'Nil', 'good'],
      ['entries', 'With entries', 'warning'],
    ]),
  ],
  fields: [
    { key: 'certificate_no', label: 'Certificate number', kind: 'text', from: 'Encumbrance certificate', fromTypes: ['Encumbrance certificate'], factKey: 'ec_certificate_number' },
    { key: 'sro', label: 'Sub-registrar office', kind: 'text', from: 'Encumbrance certificate', fromTypes: ['Encumbrance certificate'], factKey: 'ec_sub_registrar' },
    { key: 'from', label: 'Searched from', kind: 'date', from: 'Encumbrance certificate', fromTypes: ['Encumbrance certificate'], factKey: 'ec_from', proof: 'expected' },
    { key: 'to', label: 'Searched to', kind: 'date', from: 'Encumbrance certificate', fromTypes: ['Encumbrance certificate'], factKey: 'ec_to', proof: 'expected' },
    { key: 'result', label: 'Result', kind: 'enum', control: 'segmented', optionSet: 'ec_result' },
    { key: 'searched_by', label: 'Searched by', kind: 'enum', options: ['survey number', 'property or khata number', 'boundaries'], required: false },
    { key: 'property_as_searched', label: 'Property as the certificate describes it', kind: 'text', required: false, hint: 'A nil result for the wrong description proves nothing.' },
    { key: 'issued_on', label: 'Issued on', kind: 'date', required: false, fromTypes: ['Encumbrance certificate'], factKey: 'ec_issued_on' },
    computed('covered_days', 'Days covered', { op: 'add', left: { op: 'subtract', left: { op: 'date', key: 'to' }, right: { op: 'date', key: 'from' } }, right: { op: 'const', value: 1 } }, { unit: 'days' }),
    { key: 'certificate', label: 'Certificate', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
  ],
  rules: [{ kind: 'before', fields: ['from', 'to'], say: 'Searched to {b}, which is before it was searched from {a}.', severity: 'medium' }],
};

const entry = (field: string): FieldAddress => title(T.entries, field);

const ENTRIES: FieldSet = {
  id: T.entries,
  fn: TITLE,
  title: 'Entries on the certificates',
  v: 1,
  records: { of: 'entry', titleField: 'doc_no', summaryFields: ['nature', 'registered_on', 'treated_as'] },
  optionSets: [
    list('ec_entry_is', 'Entry is', [
      ['transfer', 'A transfer in the chain', 'good'],
      ['charge', 'A charge', 'warning'],
      ['earlier_agreement', 'An earlier agreement', 'warning'],
      ['other_land', 'Not this land', 'neutral'],
    ]),
  ],
  fields: [
    { key: 'doc_no', label: 'Document number', kind: 'text', from: 'Encumbrance certificate' },
    { key: 'registered_on', label: 'Registered on', kind: 'date', from: 'Encumbrance certificate' },
    { key: 'nature', label: 'Nature of the deed', kind: 'enum', optionSet: 'instrument_kind', from: 'Encumbrance certificate' },
    { key: 'executant', label: 'Executant, as printed', kind: 'text', suggest: 'party', required: false },
    { key: 'claimant', label: 'Claimant, as printed', kind: 'text', suggest: 'party', required: false },
    { key: 'treated_as', label: 'This entry is', kind: 'enum', control: 'segmented', optionSet: 'ec_entry_is' },
    { key: 'discharged_by', label: 'Discharged by document number', kind: 'text', required: false, tier: 'situational', showWhen: holds(entry('treated_as'), 'in', ['charge', 'earlier_agreement']) },
  ],
  rules: [],
};

const charge = (field: string): FieldAddress => title(T.charges, field);

const CHARGES: FieldSet = {
  id: T.charges,
  fn: TITLE,
  title: 'Charges on the land',
  v: 1,
  records: { of: 'charge', titleField: 'holder', summaryFields: ['kind', 'amount', 'released'] },
  optionSets: [
    list('charge_kind', 'Charge', [
      ['registered_mortgage', 'Registered mortgage'],
      ['deposit_of_title_deeds', 'Deposit of title deeds'],
      ['attachment', 'Attachment'],
      ['lien', 'Lien'],
      ['earlier_agreement', 'Earlier agreement to sell or develop'],
      ['lease', 'Lease'],
    ]),
  ],
  fields: [
    { key: 'holder', label: 'In favour of', kind: 'ref', target: 'party' },
    { key: 'kind', label: 'Kind', kind: 'enum', optionSet: 'charge_kind' },
    { key: 'amount', label: 'Amount secured', kind: 'money', dimension: 'money', currency: 'INR', required: false },
    { key: 'created_on', label: 'Created on', kind: 'date' },
    { key: 'found_in', label: 'Found in', kind: 'multi_enum', options: ['encumbrance certificate', 'security-interest registry', 'company charge register', 'RTC', 'lender’s letter'] },
    { key: 'registry_id', label: 'Registry reference', kind: 'text', required: false },
    { key: 'released', label: 'Released', kind: 'boolean', control: 'switch' },
    { key: 'released_on', label: 'Released on', kind: 'date', tier: 'situational', showWhen: holds(charge('released'), 'true') },
    { key: 'release_deed', label: 'Release deed', kind: 'evidence', accepts: 'document', viewer: 'deed', tier: 'situational', showWhen: holds(charge('released'), 'true') },
    { key: 'lender_noc', label: 'Holder’s no-objection letter', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, tier: 'situational', showWhen: holds(charge('released'), 'false') },
  ],
  rules: [{ kind: 'before', fields: ['created_on', 'released_on'], say: 'Released on {b}, before it was created on {a}.', severity: 'medium' }],
};

/* --- T4. Land character and restrictions ----------------------------- */

const GRANTED_LAND: ShowWhen = { any: [anyRecord(T.restrictions, { column: 'restriction', is: 'in', value: GRANT_KINDS }), holds(title(T.chain, 'root_kind'), 'in', ['government_grant', 'inam_regrant'])] };
const TENANCY: ShowWhen = { any: [anyRecord(T.restrictions, { column: 'restriction', is: 'equals', value: 'tenancy' }), anyRecord(T.landRecords, { column: 'cultivator_differs', is: 'true' }), holds(title(T.chain, 'root_kind'), 'equals', 'land_reforms_occupancy')] };
const LIVE_ACQUISITION = ['preliminary_notification', 'final_notification', 'award_passed', 'possession_taken'];

const CHARACTER: FieldSet = {
  id: T.character,
  fn: TITLE,
  title: 'Land character and restrictions',
  v: 1,
  optionSets: [
    list('land_origin', 'Origin', [
      ['private', 'Private or ancestral', 'good'],
      ['government_grant', 'Government grant', 'warning'],
      ['inam_regrant', 'Inam regrant', 'warning'],
      ['land_reforms_occupancy', 'Land-reforms occupancy', 'warning'],
      ['allotted', 'Acquired and allotted', 'info'],
      ['public_or_religious', 'Government, religious or forest land', 'critical'],
    ]),
  ],
  situations: [
    { key: 'granted_land', label: 'Granted land', scope: 'function', hint: 'A grant bars transfer for a term, and a grant to a Scheduled Caste or Tribe needs the government’s permission whatever the date.', derive: GRANTED_LAND },
    { key: 'tenancy_or_inam_history', label: 'Tenancy or inam in the history', scope: 'function', hint: 'A tenant’s occupancy right outranks the paper title.', derive: TENANCY },
    { key: 'acquisition_or_reservation', label: 'Acquisition or reservation notified', scope: 'function', hint: 'A buyer after notification gets a claim to compensation, not title against the State.', derive: anyRecord(T.restrictions, { column: 'restriction', is: 'in', value: NOTIFIED_KINDS }) },
  ],
  sections: [
    { key: 'character', label: 'Character' },
    { key: 'restrictions', label: 'Restrictions' },
    { key: 'granted', label: 'Granted land', showWhen: situation('granted_land') },
    { key: 'tenancy', label: 'Tenancy', showWhen: situation('tenancy_or_inam_history') },
    { key: 'acquisition', label: 'Acquisition', showWhen: situation('acquisition_or_reservation') },
  ],
  fields: [
    { key: 'origin', label: 'The land came from', kind: 'enum', control: 'tiles', optionSet: 'land_origin', section: 'character', from: 'Root document and RTC', requiredWhen: anyRecord(PARCELS) },
    mirror('zoning', 'Zoning in the plan in force', 'text', { fn: 'legal.approvals', set: 'regulatory.land_use', field: 'zoning' }, { section: 'character' }),
    mirror('conversion', 'Conversion', 'text', { fn: 'legal.approvals', set: 'regulatory.land_use', field: 'conversion_status' }, { section: 'character' }),
    count('restrictions', 'Restrictions recorded', T.restrictions, { section: 'restrictions', ...once(T.restrictions) }),
    countIf('applying', 'Restrictions that apply', T.restrictions, { column: 'applies', is: 'equals', value: 'applies' }, { section: 'restrictions', ...once(T.restrictions) }),
    countIf('unclear', 'Restrictions the papers leave unclear', T.restrictions, { column: 'applies', is: 'equals', value: 'unclear' }, { section: 'restrictions', ...once(T.restrictions) }),
    computed('restricted_extent', 'Extent under restriction', { op: 'sum_if', over: { records: T.restrictions }, column: 'extent', where: { column: 'applies', is: 'equals', value: 'applies' } }, { section: 'restrictions', dimension: 'area', precision: 2, ...once(T.restrictions) }),
    computed(
      'clear_extent',
      'Extent clear of restriction',
      { op: 'subtract', left: { op: 'field', key: 'extent_title', at: title('land_site.parcel_identification', 'extent_title') }, right: { op: 'field', key: 'restricted_extent' } },
      { section: 'restrictions', dimension: 'area', precision: 2, ...once(T.restrictions) },
    ),
    {
      key: 'restriction_standing',
      label: 'Restrictions',
      kind: 'status',
      section: 'restrictions',
      cases: [
        failing('without_permission', 'Granted land sold without permission'),
        failing('transferred_in_bar', 'Granted land sold inside the bar'),
        failing('restoration_live', 'Restoration proceedings on the land'),
        failing('claims_open', 'A tenancy claim stands'),
        failing('acquisitions_live', 'An acquisition is live'),
        failing('unclear', 'A restriction is unclear', 'warning'),
        failing('applying', 'A restriction applies', 'warning'),
      ],
      otherwise: { label: 'No restriction recorded', tone: 'neutral' },
    },
    countIf('without_permission', 'Grants transferred without permission', T.restrictions, { column: 'permission', is: 'equals', value: 'not_held' }, { section: 'granted', tier: 'situational' }),
    countIf('transferred_in_bar', 'Grants transferred inside the bar on transfer', T.restrictions, { column: 'days_inside_bar', is: 'gt', value: 0 }, { section: 'granted', tier: 'situational' }),
    countIf('restoration_live', 'Restoration proceedings pending or ordered', T.restrictions, { column: 'restoration', is: 'in', value: ['pending', 'ordered'] }, { section: 'granted', tier: 'situational' }),
    countIf('claims_open', 'Occupancy claims filed or granted', T.restrictions, { column: 'occupancy_claim', is: 'in', value: ['filed', 'granted'] }, { section: 'tenancy', tier: 'situational' }),
    countIf('acquisitions_live', 'Acquisitions not dropped', T.restrictions, { column: 'stage', is: 'in', value: LIVE_ACQUISITION }, { section: 'acquisition', tier: 'situational' }),
  ],
  rules: [
    none('without_permission', '{a} grant(s) were transferred without the government’s permission.', 'critical'),
    none('transferred_in_bar', '{a} grant(s) were first transferred before the bar on transfer ended.', 'critical'),
    none('restoration_live', '{a} restoration proceeding(s) are pending or ordered: the land can go back to the grantee’s family.', 'critical'),
    none('claims_open', '{a} occupancy claim(s) by a tenant are filed or granted.', 'critical'),
    none('acquisitions_live', '{a} acquisition(s) stand notified and not dropped.', 'critical'),
    none('unclear', '{a} restriction(s) cannot be settled from the papers on file.', 'medium'),
  ],
};

const restriction = (field: string): FieldAddress => title(T.restrictions, field);
const restrictionIs = (kinds: string[]): ShowWhen => holds(restriction('restriction'), 'in', kinds);

const RESTRICTIONS: FieldSet = {
  id: T.restrictions,
  fn: TITLE,
  title: 'Restrictions, parcel by parcel',
  v: 1,
  records: { of: 'restriction', titleField: 'restriction', summaryFields: ['parcel', 'applies', 'extent'] },
  optionSets: [
    list('restriction_kind', 'Restriction', [
      ['grant_condition', 'Condition of a grant'],
      ['grant_to_scheduled_caste_or_tribe', 'Grant to a Scheduled Caste or Tribe'],
      ['acquisition', 'Acquisition'],
      ['plan_reservation', 'Reservation in the plan'],
      ['road_widening', 'Road widening'],
      ['tenancy', 'Tenancy'],
      ['religious', 'Wakf or religious land'],
      ['forest', 'Forest'],
      ['kharab_b', 'Phut kharab B'],
      ['drain_or_tank_buffer', 'Tank or drain buffer'],
      ['power_line', 'Power line'],
      ['monument', 'Protected monument'],
      ['defence', 'Defence land nearby'],
    ]),
    list('restriction_applies', 'Applies', [
      ['applies', 'Applies', 'warning'],
      ['does_not_apply', 'Does not apply', 'good'],
      ['unclear', 'Unclear on the papers', 'warning'],
    ]),
    list('restriction_cure', 'Cure', [
      ['permission', 'Government permission'],
      ['denotification', 'Denotification'],
      ['exclusion', 'Leave it out of the plan'],
      ['order', 'An order or a release'],
      ['no_cure', 'No cure', 'critical'],
    ]),
    list('grant_permission', 'Permission', [
      ['held', 'Held', 'good'],
      ['not_held', 'Not held', 'critical'],
      ['not_needed', 'Not needed'],
    ]),
    list('restoration', 'Restoration', [
      ['pending', 'Pending', 'critical'],
      ['ordered', 'Ordered', 'critical'],
      ['dismissed', 'Dismissed', 'good'],
    ]),
    list('acquisition_stage', 'Stage', [
      ['preliminary_notification', 'Preliminary notification', 'critical'],
      ['final_notification', 'Final notification', 'critical'],
      ['award_passed', 'Award passed', 'critical'],
      ['possession_taken', 'Possession taken', 'critical'],
      ['denotified', 'Denotified', 'good'],
      ['lapsed', 'Lapsed', 'good'],
    ]),
    list('occupancy_claim', 'Claim', [
      ['filed', 'Filed', 'critical'],
      ['granted', 'Granted', 'critical'],
      ['rejected', 'Rejected', 'good'],
    ]),
  ],
  sections: [
    { key: 'what', label: 'Restriction' },
    { key: 'order', label: 'Order or notification', showWhen: restrictionIs(ORDERED_KINDS) },
    { key: 'grant', label: 'Grant', showWhen: restrictionIs(GRANT_KINDS) },
    { key: 'acquisition', label: 'Acquisition', showWhen: restrictionIs(NOTIFIED_KINDS) },
    { key: 'tenancy', label: 'Tenancy', showWhen: restrictionIs(['tenancy']) },
  ],
  fields: [
    { key: 'restriction', label: 'Restriction', kind: 'enum', optionSet: 'restriction_kind', section: 'what' },
    { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel', section: 'what' },
    { key: 'applies', label: 'Does it apply', kind: 'enum', control: 'segmented', optionSet: 'restriction_applies', section: 'what' },
    land('extent', 'Extent affected', { section: 'what', required: false }),
    { key: 'basis', label: 'Basis', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'what', required: false },
    { key: 'cure', label: 'Cure', kind: 'enum', optionSet: 'restriction_cure', section: 'what', required: false },
    { key: 'cured', label: 'Cured', kind: 'boolean', control: 'tick', section: 'what', required: false },
    { key: 'order_no', label: 'Order or notification number', kind: 'text', section: 'order', tier: 'situational' },
    { key: 'order_date', label: 'Dated', kind: 'date', section: 'order', tier: 'situational' },
    { key: 'grantee', label: 'Grantee', kind: 'ref', target: 'party', section: 'grant', tier: 'situational' },
    { key: 'bar_years', label: 'Years the grant bars transfer', kind: 'duration', unit: 'years', section: 'grant', tier: 'situational', from: 'Grant order' },
    { key: 'bar_ends', label: 'Bar on transfer ends', kind: 'computed', yields: 'date', section: 'grant', tier: 'situational', formula: { op: 'add_months', date: { op: 'date', key: 'order_date' }, months: { op: 'multiply', left: { op: 'field', key: 'bar_years' }, right: { op: 'const', value: 12 } } } },
    { key: 'first_transfer_on', label: 'First transferred on', kind: 'date', section: 'grant', tier: 'situational', from: 'Chain of title' },
    computed('days_inside_bar', 'Days before the bar ended that it was transferred', { op: 'subtract', left: { op: 'date', key: 'bar_ends' }, right: { op: 'date', key: 'first_transfer_on' } }, { unit: 'days', section: 'grant', tier: 'situational' }),
    { key: 'permission', label: 'Government’s permission to transfer', kind: 'enum', control: 'segmented', optionSet: 'grant_permission', section: 'grant', tier: 'situational' },
    { key: 'restoration', label: 'Restoration proceedings', kind: 'enum', control: 'segmented', optionSet: 'restoration', section: 'grant', tier: 'situational', required: false },
    { key: 'notifying_body', label: 'Notified by', kind: 'ref', target: 'party', section: 'acquisition', tier: 'situational' },
    { key: 'stage', label: 'Stage', kind: 'enum', optionSet: 'acquisition_stage', section: 'acquisition', tier: 'situational' },
    { key: 'occupancy_claim', label: 'Occupancy claim', kind: 'enum', control: 'segmented', optionSet: 'occupancy_claim', section: 'tenancy', tier: 'situational' },
  ],
  rules: [none('days_inside_bar', 'First transferred {a} before the bar on transfer ended.', 'critical')],
};

/* --- T5. Title opinion and requisitions ----------------------------- */

const opinion = (field: string): FieldAddress => title(T.opinion, field);
const OPINION_OWED = anyRecord(T.instruments);
const sum = (parts: CheckFormula[]): CheckFormula => parts.slice(1).reduce((left, right) => ({ op: 'add', left, right }), parts[0]!);
const at = (address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address });

const OPINION: FieldSet = {
  id: T.opinion,
  fn: TITLE,
  title: 'Title opinion',
  v: 1,
  optionSets: [
    list('title_verdict', 'Verdict', [
      ['clear_marketable', 'Clear and marketable', 'good'],
      ['clear_subject_to', 'Clear, subject to requisitions', 'warning'],
      ['defective', 'Defective', 'critical'],
      ['not_marketable', 'Not marketable', 'critical'],
    ]),
  ],
  sections: [
    { key: 'assembled', label: 'What it rests on' },
    { key: 'opinion', label: 'The opinion' },
    { key: 'litigation', label: 'Litigation', showWhen: situation('litigation_pending') },
    { key: 'notice', label: 'Public notice and note', tier: 'expert' },
  ],
  fields: [
    count('documents', 'Instruments scrutinised', T.instruments, { section: 'assembled', ...once(T.instruments) }),
    computed('search_years', 'Search period', { op: 'min', of: [at(title('legal.title_chain', 'years_established')), at(title(T.encumbrance, 'years_covered'))] }, { unit: 'years', precision: 1, section: 'assembled', ...once(T.instruments) }),
    computed(
      'defects_open',
      'Defects open in the records, chain, search and restrictions',
      sum([
        at(title(T.ownership, 'not_joining')),
        at(title(T.ownership, 'approvals_not_held')),
        at(title(T.chain, 'unregistered')),
        at(title(T.chain, 'without_conveyance')),
        at(title(T.chain, 'principal_not_living')),
        at(title(T.chain, 'unregistered_partitions')),
        at(title(T.encumbrance, 'charges_open')),
        at(title(T.character, 'without_permission')),
        at(title(T.character, 'transferred_in_bar')),
        at(title(T.character, 'restoration_live')),
        at(title(T.character, 'claims_open')),
        at(title(T.character, 'acquisitions_live')),
      ]),
      { section: 'assembled', ...once(T.instruments) },
    ),
    countIf('requisitions_open', 'Requisitions and conditions open', T.requisitions, { column: 'state', is: 'equals', value: 'open' }, { section: 'assembled', ...once(T.requisitions) }),
    countIf('waived', 'Requisitions waived', T.requisitions, { column: 'state', is: 'equals', value: 'waived' }, { section: 'assembled', ...once(T.requisitions) }),
    {
      key: 'title_standing',
      label: 'Title',
      kind: 'status',
      section: 'assembled',
      cases: [notStarted('documents'), failing('defects_open', 'A defect is open'), failing('requisitions_open', 'Requisitions are open', 'warning')],
      otherwise: { label: 'No open point', tone: 'good' },
    },
    { key: 'verdict', label: 'Verdict', kind: 'enum', control: 'tiles', optionSet: 'title_verdict', section: 'opinion', requiredWhen: OPINION_OWED },
    { key: 'opinion_for', label: 'Prepared for', kind: 'enum', options: ['acquisition', 'joint development', 'lender', 'RERA registration', 'home-loan project approval'], section: 'opinion', requiredWhen: OPINION_OWED },
    { key: 'opinion_by', label: 'Advocate', kind: 'ref', target: 'party', section: 'opinion', requiredWhen: OPINION_OWED },
    { key: 'opinion_date', label: 'Dated', kind: 'date', section: 'opinion', from: 'Signed opinion', requiredWhen: OPINION_OWED },
    refreshBy('refresh_by', 'Bring up to date by', 'opinion_date', 'title_opinion_refresh_days', 14, { section: 'opinion', tier: 'situational', showWhen: holds(opinion('opinion_date'), 'set') }),
    { key: 'opinion_doc', label: 'Signed opinion', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'opinion', requiredWhen: OPINION_OWED },
    computed('matters_pending', 'Matters pending', at(litigation(L.register, 'pending')), { section: 'litigation', tier: 'situational' }),
    computed('land_under_order', 'Orders in force that restrain a sale', at(litigation(L.diary, 'sale_restraints')), { section: 'litigation', tier: 'situational' }),
    { key: 'enrolment_no', label: 'Bar enrolment number', kind: 'text', section: 'notice', tier: 'expert', required: false, from: 'Signed opinion', fromTypes: ['Legal opinion on title'], factKey: 'enrolment_number' },
    {
      key: 'public_notices',
      label: 'Public notices',
      kind: 'table',
      section: 'notice',
      tier: 'expert',
      required: false,
      from: 'Newspaper clippings',
      columns: [
        { key: 'newspaper', label: 'Newspaper', kind: 'text' },
        { key: 'language', label: 'Language', kind: 'enum', options: ['English', 'Kannada', 'Hindi', 'Tamil', 'Telugu', 'Marathi'] },
        { key: 'published_on', label: 'Published on', kind: 'date' },
        { key: 'days_allowed', label: 'Days for objections', kind: 'number', required: false },
      ],
    },
    { key: 'clippings', label: 'Clippings', kind: 'evidence', accepts: 'any', viewer: 'image', section: 'notice', tier: 'expert', required: false },
    { key: 'verdict_note', label: 'Advocate’s note on the verdict', kind: 'longtext', maxLength: 800, section: 'notice', tier: 'expert', required: false },
  ],
  rules: [
    none('defects_open', 'The verdict is clear and marketable while {a} defect(s) are open in the records, chain, search or restrictions.', 'critical', holds(opinion('verdict'), 'equals', 'clear_marketable')),
    none('requisitions_open', 'The verdict is clear and marketable while {a} requisition(s) are open.', 'high', holds(opinion('verdict'), 'equals', 'clear_marketable')),
    none('land_under_order', '{a} order(s) in force restrain a sale of the land.', 'critical'),
  ],
};

const requisition = (field: string): FieldAddress => title(T.requisitions, field);

const REQUISITIONS: FieldSet = {
  id: T.requisitions,
  fn: TITLE,
  title: 'Requisitions and conditions before closing',
  v: 1,
  records: { of: 'requisition', titleField: 'about', summaryFields: ['category', 'state', 'reply_due'] },
  optionSets: [
    list('requisition_state', 'State', [
      ['open', 'Open', 'warning'],
      ['answered', 'Answered', 'info'],
      ['complied', 'Complied', 'good'],
      ['waived', 'Waived', 'neutral'],
    ]),
  ],
  fields: [
    { key: 'about', label: 'What it is about', kind: 'text', hint: 'A name, not a sentence: Release deed for the 2008 mortgage.' },
    { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', options: ['requisition', 'condition before closing'] },
    { key: 'category', label: 'Category', kind: 'enum', options: ['missing document', 'missing party', 'record mismatch', 'encumbrance', 'restriction', 'litigation'] },
    { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel', required: false },
    { key: 'raised_on', label: 'Raised on', kind: 'date' },
    { key: 'to', label: 'Asked of', kind: 'ref', target: 'party' },
    { key: 'reply_due', label: 'Reply due', kind: 'date' },
    { key: 'state', label: 'State', kind: 'enum', control: 'segmented', optionSet: 'requisition_state' },
    { key: 'replied_on', label: 'Replied on', kind: 'date', tier: 'situational', showWhen: holds(requisition('state'), 'in', ['answered', 'complied']) },
    { key: 'reply', label: 'Reply', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false, tier: 'situational', showWhen: holds(requisition('state'), 'in', ['answered', 'complied']) },
    { key: 'waived_by', label: 'Waived by', kind: 'ref', target: 'party', tier: 'situational', showWhen: holds(requisition('state'), 'equals', 'waived') },
    computed('days_past_due', 'Days past the reply date', { op: 'subtract', left: { op: 'today' }, right: { op: 'date', key: 'reply_due' } }, { unit: 'days', tier: 'situational', showWhen: holds(requisition('state'), 'equals', 'open') }),
  ],
  rules: [none('days_past_due', 'The reply was due {a} ago.', 'high')],
};

/* ==================================================================== */
/* LITIGATION                                                            */
/* ==================================================================== */

/* --- G1. Matter register -------------------------------------------- */

const matter = (field: string): FieldAddress => shared(MATTERS, field);

/** Litigation’s facts about a matter, on the one matter record every department links to. */
const MATTER_FACTS: FieldSet = {
  id: 'legal.litigation.matter_facts',
  fn: LITIGATION,
  title: 'Matter',
  v: 1,
  extends: MATTERS,
  optionSets: [
    COURT_FORUM,
    CASE_STAGE,
    list('matter_subject', 'Subject', [
      ['title_declaration', 'Title declaration'],
      ['partition', 'Partition'],
      ['specific_performance', 'Specific performance'],
      ['injunction', 'Injunction'],
      ['land_acquisition', 'Land acquisition'],
      ['grant_restoration', 'Restoration of granted land'],
      ['revenue', 'Revenue and mutation'],
      ['tenancy', 'Tenancy'],
      ['buyer_delay_or_refund', 'Buyer’s claim for delay or refund'],
      ['consumer', 'Consumer'],
      ['contractor_claim', 'Contractor or vendor claim'],
      ['arbitration', 'Arbitration'],
      ['insolvency', 'Insolvency'],
      ['environment', 'Environment'],
      ['tax', 'Tax'],
      ['labour', 'Labour'],
      ['criminal', 'Criminal'],
    ]),
    list('our_role', 'We are', [
      ['claimant', 'Plaintiff or petitioner'],
      ['defendant', 'Defendant or respondent'],
      ['not_a_party', 'Not a party: the land is affected', 'warning'],
    ]),
    list('case_state', 'State', [
      ['pending', 'Pending', 'warning'],
      ['disposed', 'Disposed', 'neutral'],
    ]),
    list('relief_claimed', 'Relief', [
      ['declaration', 'Declaration'],
      ['injunction', 'Injunction'],
      ['partition', 'Partition'],
      ['possession', 'Possession'],
      ['cancellation', 'Cancellation of a deed'],
      ['money', 'Money'],
      ['refund', 'Refund'],
      ['interest', 'Interest'],
      ['compensation', 'Compensation'],
      ['specific_performance', 'Specific performance'],
    ]),
    list('likelihood_of_loss', 'Likelihood', [
      ['remote', 'Remote', 'good'],
      ['possible', 'Possible', 'warning'],
      ['probable', 'Probable', 'critical'],
    ]),
  ],
  sections: [
    { key: 'case', label: 'Case' },
    { key: 'claim', label: 'What is claimed' },
    { key: 'view', label: 'Counsel’s view' },
    { key: 'pleading', label: 'Our pleading', showWhen: holds(matter('our_role'), 'equals', 'defendant') },
  ],
  fields: [
    { key: 'cnr', label: 'CNR number', kind: 'text', section: 'case', required: false, from: 'eCourts' },
    { key: 'forum', label: 'Forum', kind: 'enum', optionSet: 'court_forum', section: 'case', from: 'Case status page' },
    { key: 'subject_kind', label: 'About', kind: 'enum', optionSet: 'matter_subject', section: 'case', from: 'Pleadings' },
    { key: 'our_role', label: 'We are', kind: 'enum', control: 'segmented', optionSet: 'our_role', section: 'case' },
    { key: 'against', label: 'Other side', kind: 'ref', target: 'party', section: 'case', required: false },
    { key: 'counsel', label: 'Our counsel', kind: 'ref', target: 'party', section: 'case', required: false },
    { key: 'stage', label: 'Stage', kind: 'enum', optionSet: 'case_stage', section: 'case', from: 'Case status page' },
    { key: 'case_state', label: 'State', kind: 'enum', control: 'segmented', optionSet: 'case_state', section: 'case', from: 'Case status page' },
    { key: 'relief', label: 'Relief claimed', kind: 'multi_enum', optionSet: 'relief_claimed', section: 'claim', required: false, from: 'Pleadings' },
    { key: 'claim_amount', label: 'Amount claimed', kind: 'money', dimension: 'money', currency: 'INR', section: 'claim', required: false, from: 'Pleadings' },
    { key: 'schedule_recited', label: 'Survey numbers in the suit schedule, as recited', kind: 'text', section: 'claim', required: false, from: 'Plaint schedule' },
    { key: 'risk', label: 'Risk', kind: 'number', control: 'scale', min: 1, max: 5, section: 'view', required: false },
    { key: 'likelihood', label: 'Likelihood of loss', kind: 'enum', control: 'segmented', optionSet: 'likelihood_of_loss', section: 'view', required: false },
    { key: 'summons_served_on', label: 'Summons served on', kind: 'date', section: 'pleading', tier: 'situational', required: false },
    refreshBy('written_statement_by', 'Written statement to be filed by', 'summons_served_on', 'written_statement_days', 7, { section: 'pleading', tier: 'situational' }),
  ],
  rules: [],
};

const PENDING: RowCondition = { column: 'case_state', is: 'equals', value: 'pending' };
const register = (field: string): FieldAddress => litigation(L.register, field);
const money = (key: string, label: string, formula: CheckFormula, more: More = {}): CheckFieldDef => computed(key, label, formula, { dimension: 'money', currency: 'INR', ...more });

const REGISTER: FieldSet = {
  id: L.register,
  fn: LITIGATION,
  title: 'Matters and what is at stake',
  v: 1,
  situations: [
    { key: 'litigation_pending', label: 'Litigation pending', scope: 'project', hint: 'A case naming the land, a seller or the company is pending.', derive: anyRecord(MATTERS, PENDING) },
    { key: 'partition_suit', label: 'A partition suit', scope: 'function', hint: 'A preliminary decree declares shares and divides nothing.', derive: anyRecord(MATTERS, { column: 'subject_kind', is: 'equals', value: 'partition' }) },
    { key: 'earlier_agreement_holder_suing', label: 'An earlier agreement holder is suing', scope: 'function', hint: 'A later buyer with notice of the earlier agreement loses to it.', derive: anyRecord(MATTERS, { column: 'subject_kind', is: 'equals', value: 'specific_performance' }) },
    { key: 'insolvency', label: 'An insolvency is admitted or sought', scope: 'function', hint: 'Suits and recoveries against the debtor stop on admission, and a claim not filed in time is lost.', derive: anyRecord(MATTERS, { column: 'forum', is: 'equals', value: 'company_law_tribunal' }) },
  ],
  optionSets: [
    list('our_vendor_is', 'Our vendor is', [
      ['plaintiff', 'The plaintiff'],
      ['defendant', 'A defendant'],
      ['not_a_party', 'Not a party', 'warning'],
    ]),
    list('had_notice', 'Notice', [
      ['yes', 'We had notice', 'critical'],
      ['no', 'We had none', 'good'],
      ['disputed', 'Disputed', 'warning'],
    ]),
  ],
  sections: [
    { key: 'matters', label: 'Matters' },
    { key: 'money', label: 'Money at stake', showWhen: { any: [anyRecord(MATTERS), anyRecord(L.notices)] } },
    { key: 'earlier', label: 'Earlier agreement', showWhen: situation('earlier_agreement_holder_suing') },
    { key: 'insolvency', label: 'Insolvency', showWhen: situation('insolvency') },
  ],
  fields: [
    count('matters', 'Matters recorded', MATTERS, { section: 'matters' }),
    countIf('pending', 'Pending', MATTERS, PENDING, { section: 'matters' }),
    countIf('probable', 'Where loss is probable', MATTERS, { column: 'likelihood', is: 'equals', value: 'probable' }, { section: 'matters', ...once(MATTERS) }),
    {
      key: 'suits_to_parcels',
      label: 'Suit schedules and the parcels they cover',
      kind: 'table',
      display: 'match',
      section: 'matters',
      required: false,
      ...once(MATTERS),
      from: 'Plaint schedules',
      columns: [
        { key: 'matter', label: 'Suit schedule', kind: 'ref', target: 'matter' },
        { key: 'parcel', label: 'Parcel', kind: 'ref', target: 'parcel' },
      ],
      match: { left: { column: 'matter', label: 'Suit schedules', of: { records: MATTERS, field: 'schedule_recited' } }, right: { column: 'parcel', label: 'Parcels', of: { target: 'parcel' }, optional: true } },
    },
    {
      key: 'litigation_standing',
      label: 'Litigation',
      kind: 'status',
      section: 'matters',
      cases: [failing('probable', 'A loss is probable'), failing('pending', 'Matters are pending', 'warning'), failing('notices_open', 'A notice is open', 'warning')],
      otherwise: { label: 'Nothing pending', tone: 'neutral' },
    },
    money('claims_in_court', 'Claimed in pending matters', { op: 'sum_if', over: { records: MATTERS }, column: 'claim_amount', where: PENDING }, { section: 'money', tier: 'situational' }),
    money('contingent', 'Claimed where loss is possible', { op: 'sum_if', over: { records: MATTERS }, column: 'claim_amount', where: { column: 'likelihood', is: 'equals', value: 'possible' } }, { section: 'money', tier: 'situational' }),
    countIf('notices_open', 'Notices open', L.notices, { column: 'state', is: 'equals', value: 'open' }, { section: 'money', tier: 'situational' }),
    money('claims_in_notices', 'Claimed in open notices', { op: 'sum_if', over: { records: L.notices }, column: 'amount', where: { column: 'state', is: 'equals', value: 'open' } }, { section: 'money', tier: 'situational' }),
    money('claims_against_us', 'Claims against us', { op: 'add', left: { op: 'field', key: 'claims_in_court' }, right: { op: 'field', key: 'claims_in_notices' } }, { section: 'money', tier: 'situational' }),
    { key: 'their_agreement_on', label: 'Their agreement is dated', kind: 'date', section: 'earlier', tier: 'situational', from: 'Plaint' },
    { key: 'our_purchase_on', label: 'Our purchase is dated', kind: 'date', section: 'earlier', tier: 'situational' },
    { key: 'had_notice', label: 'Notice of their agreement', kind: 'enum', control: 'segmented', optionSet: 'had_notice', section: 'earlier', tier: 'situational' },
    { key: 'admitted_on', label: 'Admitted on', kind: 'date', section: 'insolvency', tier: 'situational', required: false, from: 'Tribunal’s order' },
    { key: 'claim_deadline', label: 'Claims close on', kind: 'date', section: 'insolvency', tier: 'situational', from: 'Public announcement' },
    { key: 'claim_filed_on', label: 'Our claim filed on', kind: 'date', section: 'insolvency', tier: 'situational', required: false },
  ],
  // A partition suit: who sues, whether every sharer is before the court, and how far the decree has gone. One sheet, opened from here while such a suit is on file.
  sheets: [
    {
      id: 'partition_suit',
      title: 'Partition suit',
      showWhen: situation('partition_suit'),
      sections: [
        { key: 'suit', label: 'The suit' },
        { key: 'decree', label: 'The decree' },
      ],
      fields: [
        { key: 'partition_matter', label: 'The suit', kind: 'ref', target: 'matter', section: 'suit' },
        { key: 'share_claimed', label: 'Share claimed', kind: 'percent', max: 100, precision: 2, section: 'suit', from: 'Plaint' },
        { key: 'our_vendor_is', label: 'Our vendor is', kind: 'enum', control: 'segmented', optionSet: 'our_vendor_is', section: 'suit' },
        { key: 'all_sharers_impleaded', label: 'Every sharer is a party', kind: 'boolean', control: 'switch', section: 'suit' },
        { key: 'preliminary_decree_on', label: 'Preliminary decree on', kind: 'date', section: 'decree', required: false, from: 'Decree' },
        { key: 'final_decree_on', label: 'Final decree on', kind: 'date', section: 'decree', required: false, from: 'Decree' },
        { key: 'final_decree_registered', label: 'Final decree registered', kind: 'boolean', control: 'switch', section: 'decree', required: false, showWhen: holds(register('final_decree_on'), 'set') },
        { key: 'lis_pendens_registered', label: 'Notice of the suit registered against the land', kind: 'boolean', control: 'switch', section: 'suit', required: false },
        { key: 'our_purchase_during_suit', label: 'Our purchase was made while the suit was pending', kind: 'boolean', control: 'switch', section: 'suit', required: false, hint: 'A transfer made while a suit is pending is bound by its result.' },
        {
          key: 'shares_decreed',
          label: 'Shares the decree declares',
          kind: 'table',
          section: 'decree',
          required: false,
          from: 'Decree',
          columns: [
            { key: 'sharer', label: 'Sharer', kind: 'text', suggest: 'party' },
            { key: 'share_pct', label: 'Share', kind: 'percent', max: 100, precision: 2 },
          ],
        },
        { key: 'compromise_recorded', label: 'Settled by a compromise the court recorded', kind: 'boolean', control: 'switch', section: 'decree', required: false },
        { key: 'decree', label: 'Decree', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'decree', required: false },
      ],
      rules: [],
    },
  ],
  rules: [
    { kind: 'at_least', fields: ['matters', 'on_search'], at: { on_search: title('legal.litigation', 'matters_found') }, say: 'The search report names {b} matters and {a} are recorded here.', severity: 'medium' },
    none('probable', 'Counsel calls a loss probable in {a} matter(s).', 'critical'),
    { kind: 'require_if', fields: ['preliminary_decree_on', 'final_decree_on'], say: 'A preliminary decree of {a} declares shares and divides nothing: no final decree is recorded.', severity: 'high' },
    { kind: 'before', fields: ['our_purchase_on', 'their_agreement_on'], when: holds(register('had_notice'), 'equals', 'yes'), say: 'Our purchase on {a} came after their agreement of {b}, and with notice of it.', severity: 'critical' },
    { kind: 'require_if', fields: ['claim_deadline', 'claim_filed_on'], say: 'Claims close on {a} and ours is not recorded as filed.', severity: 'high' },
  ],
};

/* --- G2. Hearings, orders and stays --------------------------------- */

const order = (field: string): FieldAddress => litigation(L.orders, field);
const SALE_RESTRAINTS = ['restrains_sale', 'restrains_registration', 'status_quo', 'attachment', 'receiver'];
/** One where an order in force has this effect, nought where it has not. Summed on the diary. */
const restraint = (key: string, label: string, effects: string[]): CheckFieldDef =>
  computed(key, label, { op: 'if', when: { all: [{ field: 'in_force', is: 'true' }, { field: 'effect', is: 'in', value: effects }] }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } }, { section: 'effect', tier: 'expert', required: false });

const DIARY: FieldSet = {
  id: L.diary,
  fn: LITIGATION,
  title: 'Hearings and orders',
  v: 1,
  situations: [{ key: 'interim_order_in_force', label: 'An order is in force', scope: 'function', hint: 'A transfer made while it stands is bound by the result, and breaching it is contempt.', derive: anyRecord(L.orders, { column: 'in_force', is: 'true' }) }],
  sections: [
    { key: 'hearings', label: 'Hearings' },
    { key: 'orders', label: 'Orders' },
    { key: 'restraints', label: 'What the orders in force restrain', showWhen: situation('interim_order_in_force') },
  ],
  fields: [
    {
      key: 'hearings',
      label: 'Hearing diary',
      kind: 'table',
      display: 'timeline',
      section: 'hearings',
      required: false,
      from: 'eCourts case history',
      columns: [
        { key: 'held_on', label: 'Date', kind: 'date' },
        { key: 'matter', label: 'Matter', kind: 'ref', target: 'matter' },
        { key: 'purpose', label: 'Listed for', kind: 'enum', optionSet: 'case_stage' },
        { key: 'outcome', label: 'What happened', kind: 'enum', options: ['heard', 'adjourned', 'order passed', 'not taken up'] },
        { key: 'next_step', label: 'Before the next date', kind: 'enum', options: ['file written statement', 'file objections', 'file evidence affidavit', 'produce documents', 'pay costs', 'brief counsel', 'obtain certified copy'], required: false },
        { key: 'attended_by', label: 'Attended by', kind: 'ref', target: 'party', required: false },
      ],
    },
    count('orders', 'Orders recorded', L.orders, { section: 'orders' }),
    countIf('orders_in_force', 'Orders in force', L.orders, { column: 'in_force', is: 'true' }, { section: 'orders', ...once(L.orders) }),
    countIf('directions_open', 'Orders still to be complied with', L.orders, { column: 'compliance', is: 'equals', value: 'to_comply' }, { section: 'orders', ...once(L.orders) }),
    money('ordered_unpaid', 'Ordered and not yet paid', { op: 'sum_if', over: { records: L.orders }, column: 'amount_ordered', where: { column: 'compliance', is: 'equals', value: 'to_comply' } }, { section: 'orders', ...once(L.orders) }),
    {
      key: 'order_standing',
      label: 'Orders',
      kind: 'status',
      section: 'orders',
      cases: [
        failing('construction_restraints', 'An order restrains construction'),
        failing('sale_restraints', 'An order restrains a sale'),
        failing('directions_open', 'An order is still to be complied with', 'warning'),
      ],
      otherwise: { label: 'Nothing binds the project', tone: 'neutral' },
    },
    computed('construction_restraints', 'Orders in force restraining construction', { op: 'records', set: L.orders, reduce: 'sum', field: 'restrains_construction' }, { section: 'restraints', tier: 'situational' }),
    computed('sale_restraints', 'Orders in force restraining a sale or its registration', { op: 'records', set: L.orders, reduce: 'sum', field: 'restrains_sale' }, { section: 'restraints', tier: 'situational' }),
  ],
  rules: [
    none('construction_restraints', '{a} order(s) in force restrain construction.', 'critical'),
    none('sale_restraints', '{a} order(s) in force restrain a sale or its registration.', 'critical'),
    none('directions_open', '{a} order(s) are still to be complied with.', 'high'),
  ],
};

const ORDERS: FieldSet = {
  id: L.orders,
  fn: LITIGATION,
  title: 'Orders',
  v: 1,
  records: { of: 'order', titleField: 'matter', summaryFields: ['order_date', 'effect', 'in_force'] },
  optionSets: [
    list('order_effect', 'Effect', [
      ['restrains_sale', 'Restrains sale', 'critical'],
      ['restrains_construction', 'Restrains construction', 'critical'],
      ['restrains_registration', 'Restrains registration', 'critical'],
      ['status_quo', 'Status quo', 'critical'],
      ['stays_authority', 'Stays an authority’s order', 'info'],
      ['directs_payment', 'Directs payment', 'warning'],
      ['attachment', 'Attachment', 'critical'],
      ['receiver', 'Receiver appointed', 'critical'],
      ['no_restraint', 'No restraint', 'good'],
    ]),
    list('ordered_as', 'Ordered as', [
      ['payment_to_allottee', 'Payment to the allottee'],
      ['penalty', 'Penalty'],
      ['other_payment', 'Another payment'],
    ]),
    list('order_compliance', 'Compliance', [
      ['to_comply', 'Still to comply', 'warning'],
      ['complied', 'Complied', 'good'],
    ]),
    list('disposal', 'Disposal', [
      ['allowed', 'Allowed'],
      ['dismissed', 'Dismissed'],
      ['decreed', 'Decreed'],
      ['compromised', 'Compromised'],
      ['withdrawn', 'Withdrawn'],
      ['abated', 'Abated'],
      ['remanded', 'Remanded'],
    ]),
  ],
  sections: [
    { key: 'order', label: 'Order' },
    { key: 'payment', label: 'Payment ordered', showWhen: holds(order('effect'), 'equals', 'directs_payment') },
    { key: 'effect', label: 'Counted as', tier: 'expert' },
  ],
  fields: [
    { key: 'matter', label: 'Matter', kind: 'ref', target: 'matter', section: 'order' },
    { key: 'order_date', label: 'Order dated', kind: 'date', section: 'order', from: 'Order' },
    { key: 'passed_by', label: 'Passed by', kind: 'enum', optionSet: 'court_forum', section: 'order', from: 'Order' },
    { key: 'kind', label: 'Kind', kind: 'enum', control: 'segmented', options: ['interim', 'final', 'ex parte', 'direction'], section: 'order' },
    { key: 'effect', label: 'Effect', kind: 'enum', optionSet: 'order_effect', section: 'order', hint: 'A person confirms what the order does.' },
    { key: 'in_force', label: 'In force', kind: 'boolean', control: 'switch', section: 'order' },
    { key: 'in_force_until', label: 'In force until', kind: 'date', section: 'order', required: false },
    { key: 'covers', label: 'Parcel covered', kind: 'ref', target: 'parcel', section: 'order', required: false },
    { key: 'order', label: 'The order', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'order', required: false },
    { key: 'ordered_as', label: 'Ordered as', kind: 'enum', control: 'segmented', optionSet: 'ordered_as', section: 'payment', tier: 'situational' },
    { key: 'amount_ordered', label: 'Amount ordered', kind: 'money', dimension: 'money', currency: 'INR', section: 'payment', tier: 'situational', from: 'Order' },
    { key: 'comply_by', label: 'To be complied with by', kind: 'date', section: 'payment', tier: 'situational', from: 'Order' },
    { key: 'compliance', label: 'Compliance', kind: 'enum', control: 'segmented', optionSet: 'order_compliance', section: 'payment', tier: 'situational' },
    computed('days_past_comply', 'Days past the day to comply', { op: 'subtract', left: { op: 'today' }, right: { op: 'date', key: 'comply_by' } }, { unit: 'days', section: 'payment', tier: 'situational', showWhen: holds(order('compliance'), 'equals', 'to_comply') }),
    restraint('restrains_construction', 'Restraining construction now', ['restrains_construction', 'status_quo']),
    restraint('restrains_sale', 'Restraining a sale now', SALE_RESTRAINTS),
    // What it binds: the parcel named above, and each parcel and unit on the list of what orders cover.
    computed(
      'things_covered',
      'Parcels and units recorded as covered',
      { op: 'add', left: { op: 'count_if', over: { records: L.cover }, where: { column: 'order', is: 'own' } }, right: { op: 'if', when: { field: 'covers', is: 'set' }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } } },
      { section: 'effect', tier: 'expert', required: false },
    ),
    computed(
      'binds_unknown',
      'Restrains, with nothing recorded as covered',
      { op: 'if', when: { all: [{ any: [{ left: { op: 'field', key: 'restrains_sale' }, is: 'gt', right: { op: 'const', value: 0 } }, { left: { op: 'field', key: 'restrains_construction' }, is: 'gt', right: { op: 'const', value: 0 } }] }, { left: { op: 'field', key: 'things_covered' }, is: 'eq', right: { op: 'const', value: 0 } }] }, then: { op: 'const', value: 1 }, else: { op: 'const', value: 0 } },
      { section: 'effect', tier: 'expert', required: false },
    ),
  ],
  rules: [
    none('days_past_comply', 'The order was to be complied with {a} ago.', 'critical'),
    none('binds_unknown', 'This order is in force and restrains, and no parcel or unit is recorded as covered by it.', 'medium'),
  ],
  // A final order: how the matter was disposed of, the day an appeal has to be filed by, and what has to be deposited first. Opened from that order alone.
  sheets: [
    {
      id: 'final_order',
      title: 'Final order and appeal',
      showWhen: holds(order('kind'), 'equals', 'final'),
      fields: [
        { key: 'disposal', label: 'Disposal', kind: 'enum', optionSet: 'disposal' },
        {
          key: 'appeal_by',
          label: 'Appeal or challenge to be filed by',
          kind: 'computed',
          yields: 'date',
          expires: { leadDays: 15 },
          formula: {
            op: 'if',
            when: { field: 'passed_by', is: 'equals', value: 'arbitral_tribunal' },
            then: { op: 'add_months', date: { op: 'date', key: 'order_date' }, months: { op: 'rate', table: 'award_challenge_months' } },
            else: { op: 'add_days', date: { op: 'date', key: 'order_date' }, days: { op: 'rate', table: 'appeal_days', where: { forum: { field: 'passed_by' } } } },
          },
        },
        { key: 'we_appeal', label: 'We are appealing', kind: 'boolean', control: 'switch', required: false },
        money(
          'pre_deposit',
          'Deposit before the appeal is heard',
          { op: 'divide', left: { op: 'multiply', left: { op: 'field', key: 'amount_ordered' }, right: { op: 'rate', table: 'rera_appeal_deposit_share', where: { ordered_as: { field: 'ordered_as' } } } }, right: { op: 'const', value: 100 } },
          { showWhen: { all: [holds(order('we_appeal'), 'true'), holds(order('passed_by'), 'in', RERA_FORUMS)] } },
        ),
      ],
      rules: [],
    },
  ],
};

/**
 * What an order covers: one record for each parcel or unit it binds, so an
 * order over six units is six lines under that order and each unit can be
 * asked which orders bind it. Sales reads these to say which units a
 * restraint holds (sales-marketing.ts).
 */
const cover = (field: string): FieldAddress => litigation(L.cover, field);
const viaOrder = (field: string): CheckFormula => ({ op: 'field', key: field, at: order(field), via: 'order' });

const COVER: FieldSet = {
  id: L.cover,
  fn: LITIGATION,
  title: 'What each order covers',
  v: 1,
  records: { of: 'parcel or unit covered', titleField: 'order', summaryFields: ['parcel', 'unit'] },
  fields: [
    { key: 'order', label: 'Order', kind: 'ref', target: { set: L.orders } },
    { key: 'parcel', label: 'Parcel covered', kind: 'ref', target: 'parcel', required: false },
    { key: 'unit', label: 'Unit covered', kind: 'ref', target: 'unit', required: false },
    computed('restrains_sale', 'Restraining a sale now', viaOrder('restrains_sale'), { tier: 'expert', required: false }),
    computed('restrains_construction', 'Restraining construction now', viaOrder('restrains_construction'), { tier: 'expert', required: false }),
    computed('land_sale_restraint', 'Restraining a sale over a parcel now', { op: 'if', when: { field: 'parcel', is: 'set' }, then: viaOrder('restrains_sale'), else: { op: 'const', value: 0 } }, { tier: 'expert', required: false }),
    computed('names_nothing', 'Names neither a parcel nor a unit', { op: 'if', when: { any: [{ field: 'parcel', is: 'set' }, { field: 'unit', is: 'set' }] }, then: { op: 'const', value: 0 }, else: { op: 'const', value: 1 } }, { tier: 'expert', required: false }),
  ],
  rules: [none('names_nothing', 'It names neither a parcel nor a unit that the order covers.', 'medium', holds(cover('order'), 'set'))],
};

/* --- G3. Court and registry searches -------------------------------- */

const SEARCH_OWED = anyRecord(L.searches);

const SEARCH: FieldSet = {
  id: L.search,
  fn: LITIGATION,
  title: 'Court and registry searches',
  v: 1,
  optionSets: [REGISTRY],
  sections: [
    { key: 'search', label: 'The search' },
    { key: 'result', label: 'What it found' },
    { key: 'entities', label: 'Company sellers', showWhen: situation('owner_is_entity') },
  ],
  fields: [
    { key: 'search_for', label: 'Search made for', kind: 'enum', control: 'segmented', options: ['acquisition', 'joint development', 'lender', 'periodic review'], section: 'search', requiredWhen: SEARCH_OWED },
    { key: 'searched_on', label: 'Searched on', kind: 'date', section: 'search', from: 'Search report', requiredWhen: SEARCH_OWED },
    refreshBy('refresh_by', 'Search again by', 'searched_on', 'search_fresh_days', 7, { section: 'search', tier: 'situational', showWhen: holds(litigation(L.search, 'searched_on'), 'set') }),
    { key: 'searched_by', label: 'Searched by', kind: 'ref', target: 'party', section: 'search', requiredWhen: SEARCH_OWED },
    mirror('searched_courts', 'Registries on the litigation check', 'multi_enum', title('legal.litigation', 'searched_courts'), { section: 'search' }),
    {
      key: 'names_searched',
      label: 'Names searched',
      kind: 'table',
      section: 'search',
      required: false,
      from: 'Deeds and RTC',
      columns: [
        { key: 'party', label: 'Party', kind: 'ref', target: 'party' },
        { key: 'spelling', label: 'Spelling searched', kind: 'text' },
        { key: 'script', label: 'Script', kind: 'enum', options: ['English', 'Kannada'] },
      ],
    },
    { key: 'report', label: 'Search report', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'search', tier: 'expert', required: false },
    count('registries', 'Searches logged', L.searches, { section: 'result' }),
    countIf('ours', 'Hits that are ours', L.hits, { column: 'relevant', is: 'equals', value: 'ours' }, { section: 'result', ...once(L.hits) }),
    computed('unlinked', 'Hits that are ours and linked to no matter', { op: 'subtract', left: { op: 'count_if', over: { records: L.hits }, where: { column: 'relevant', is: 'equals', value: 'ours' } }, right: { op: 'count_if', over: { records: L.hits }, where: { column: 'matter', is: 'set' } } }, { section: 'result', ...once(L.hits) }),
    mirror('lis_pendens', 'Lis pendens registered', 'boolean', title('legal.litigation', 'lis_pendens'), { section: 'result' }),
    {
      key: 'search_standing',
      label: 'Search',
      kind: 'status',
      section: 'result',
      cases: [notStarted('registries'), failing('unlinked', 'A hit is ours and has no matter')],
      otherwise: { label: 'Every hit is placed', tone: 'good' },
    },
    { key: 'insolvency_checked', label: 'Insolvency checked for company sellers', kind: 'boolean', control: 'tick', section: 'entities', tier: 'situational' },
  ],
  rules: [
    none('unlinked', '{a} hit(s) marked as ours are linked to no matter.', 'high'),
    { kind: 'compare', fields: ['ours', 'on_check'], at: { on_check: title('legal.litigation', 'matters_found') }, tolerance: 0, when: anyRecord(L.hits), say: 'The search turned up {a} matters that are ours and the litigation check records {b}.', severity: 'low' },
  ],
};

const SEARCHES: FieldSet = {
  id: L.searches,
  fn: LITIGATION,
  title: 'Search log',
  v: 1,
  records: { of: 'search', titleField: 'term', summaryFields: ['registry', 'hits'] },
  fields: [
    { key: 'term', label: 'Name or number searched', kind: 'text' },
    { key: 'registry', label: 'Registry', kind: 'enum', optionSet: 'court_registry' },
    { key: 'period_from', label: 'Period from', kind: 'date', required: false },
    { key: 'period_to', label: 'Period to', kind: 'date', required: false },
    { key: 'hits', label: 'Hits', kind: 'number', min: 0, precision: 0 },
    { key: 'proof', label: 'Printout', kind: 'evidence', accepts: 'any', viewer: 'image', required: false },
  ],
  rules: [{ kind: 'before', fields: ['period_from', 'period_to'], say: 'The period ends on {b}, before it begins on {a}.', severity: 'low' }],
};

const HITS: FieldSet = {
  id: L.hits,
  fn: LITIGATION,
  title: 'Search hits',
  v: 1,
  records: { of: 'hit', titleField: 'case_ref', summaryFields: ['registry', 'relevant'] },
  optionSets: [
    list('hit_is', 'This hit is', [
      ['ours', 'Ours', 'warning'],
      ['not_ours', 'Not ours', 'neutral'],
      ['namesake', 'Same name, another person', 'neutral'],
    ]),
  ],
  fields: [
    { key: 'case_ref', label: 'Case number or CNR', kind: 'text', from: 'Printout' },
    { key: 'registry', label: 'Registry', kind: 'enum', optionSet: 'court_registry' },
    { key: 'parties_shown', label: 'Parties, as shown', kind: 'text', required: false, from: 'Printout' },
    { key: 'relevant', label: 'This hit is', kind: 'enum', control: 'segmented', optionSet: 'hit_is' },
    { key: 'matter', label: 'Matter', kind: 'ref', target: 'matter', tier: 'situational', showWhen: holds(litigation(L.hits, 'relevant'), 'equals', 'ours') },
  ],
  rules: [],
};

/* --- G4. Notices, claims and exposure ------------------------------- */

const notice = (field: string): FieldAddress => litigation(L.notices, field);

const NOTICES: FieldSet = {
  id: L.notices,
  fn: LITIGATION,
  title: 'Notices and claims',
  v: 1,
  records: { of: 'notice', titleField: 'reference', summaryFields: ['kind', 'reply_due', 'state'] },
  optionSets: [
    list('notice_kind', 'Notice', [
      ['legal_notice', 'Legal notice'],
      ['show_cause', 'Authority’s show-cause notice'],
      ['rera_complaint', 'RERA complaint'],
      ['consumer_complaint', 'Consumer complaint'],
      ['insolvency_demand', 'Insolvency demand'],
      ['arbitration_notice', 'Arbitration notice'],
      ['tax_notice', 'Tax notice'],
      ['objection', 'Objection to a public notice'],
    ]),
    list('notice_state', 'State', [
      ['open', 'Open', 'warning'],
      ['replied', 'Replied', 'info'],
      ['closed', 'Closed', 'good'],
      ['became_a_case', 'Became a case', 'neutral'],
    ]),
  ],
  sections: [
    { key: 'notice', label: 'Notice' },
    { key: 'reply', label: 'Reply' },
  ],
  fields: [
    { key: 'reference', label: 'Reference', kind: 'text', section: 'notice', from: 'Notice' },
    { key: 'direction', label: 'Notice', kind: 'enum', control: 'segmented', options: ['received', 'sent'], section: 'notice' },
    { key: 'kind', label: 'Kind', kind: 'enum', optionSet: 'notice_kind', section: 'notice' },
    { key: 'dated', label: 'Received or sent on', kind: 'date', section: 'notice', from: 'Notice' },
    { key: 'counterparty', label: 'From or to', kind: 'ref', target: 'party', section: 'notice' },
    { key: 'about_parcel', label: 'Parcel', kind: 'ref', target: 'parcel', section: 'notice', required: false },
    { key: 'about_unit', label: 'Unit', kind: 'ref', target: 'unit', section: 'notice', required: false, tier: 'situational', showWhen: holds(notice('kind'), 'in', ['rera_complaint', 'consumer_complaint']) },
    { key: 'amount', label: 'Amount claimed', kind: 'money', dimension: 'money', currency: 'INR', section: 'notice', required: false, from: 'Notice' },
    { key: 'paper', label: 'The notice', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'notice', required: false },
    { key: 'state', label: 'State', kind: 'enum', control: 'segmented', optionSet: 'notice_state', section: 'reply' },
    { key: 'reply_due', label: 'Reply due', kind: 'date', section: 'reply', required: false },
    computed('days_past_due', 'Days past the reply date', { op: 'subtract', left: { op: 'today' }, right: { op: 'date', key: 'reply_due' } }, { unit: 'days', section: 'reply', tier: 'situational', showWhen: holds(notice('state'), 'equals', 'open') }),
    { key: 'replied_on', label: 'Replied on', kind: 'date', section: 'reply', tier: 'situational', showWhen: holds(notice('state'), 'in', ['replied', 'closed']) },
    { key: 'reply', label: 'The reply', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'reply', required: false, tier: 'situational', showWhen: holds(notice('state'), 'in', ['replied', 'closed']) },
    { key: 'matter', label: 'Matter it became', kind: 'ref', target: 'matter', section: 'reply', tier: 'situational', showWhen: holds(notice('state'), 'equals', 'became_a_case') },
  ],
  rules: [none('days_past_due', 'The reply was due {a} ago.', 'critical')],
};

/**
 * In the order a page lists them: each sheet, then the records it is worked
 * out from.
 */
/* ==================================================================== */
/* Reports                                                               */
/* ==================================================================== */

const titleAt = (set: string, fields: string[]): FieldAddress[] => fields.map((field) => title(set, field));

/** The title report: every sheet's standing and the lists behind it, with one bounded note for the advocate. */
const TITLE_REPORT: FieldReportTemplate = {
  id: 'legal.title.report',
  title: 'Title report',
  sections: [
    { heading: 'Opinion', fields: ['title_standing', 'verdict', 'opinion_for', 'opinion_by', 'opinion_date', 'search_years', 'defects_open', 'requisitions_open', 'waived'] },
    { heading: 'Land records', fields: titleAt(T.records, ['extent_title', 'extent_survey', 'extent_khata', 'extent_rtc', 'extent_net', 'parcels', 'mutations_open', 'records_standing']) },
    { heading: 'Owners', records: 'legal.title.owners', columns: ['name', 'share_pct', 'capacity', 'joins_as'] },
    { heading: 'Shares held', chart: { of: { records: 'legal.title.owners' }, x: 'name', y: 'share_pct' } },
    { heading: 'Ownership', fields: titleAt(T.ownership, ['shares_total', 'not_joining', 'confirming', 'heirs', 'minors', 'ownership_standing']) },
    { heading: 'Chain of title', fields: titleAt(T.chain, ['root_date', 'root_kind', 'years_required', 'years_established', 'instruments', 'unregistered', 'without_conveyance', 'chain_standing']) },
    { heading: 'Instruments', records: T.instruments, columns: ['name', 'kind', 'executed_on', 'doc_no', 'registered_on'] },
    { heading: 'Encumbrance', fields: titleAt(T.encumbrance, ['ec_from', 'ec_to', 'years_covered', 'gap_days', 'charges_open', 'encumbrance_standing']) },
    { heading: 'Charges on the land', records: T.charges, columns: ['holder', 'kind', 'amount', 'created_on', 'released'] },
    { heading: 'Land character', fields: titleAt(T.character, ['origin', 'restrictions', 'restricted_extent', 'clear_extent', 'restriction_standing']) },
    { heading: 'Requisitions and conditions', records: T.requisitions, columns: ['about', 'kind', 'raised_on', 'state'] },
    { heading: 'Matters in court', fields: ['matters_pending', 'land_under_order'] },
    { heading: 'Advocate’s remarks', note: { maxLength: 800, hint: 'What a reader should know that no field holds, in the advocate’s own words.' } },
  ],
};

/** The litigation report: what is at stake, the matters, and the orders in force. */
const LITIGATION_REPORT: FieldReportTemplate = {
  id: 'legal.litigation.report',
  title: 'Litigation report',
  sections: [
    { heading: 'What is at stake', fields: ['matters', 'pending', 'probable', 'claims_in_court', 'claims_against_us', 'contingent', 'notices_open', 'litigation_standing'] },
    { heading: 'Matters', records: 'shared.matters', columns: ['case_number', 'court', 'subject', 'stage', 'next_hearing', 'likelihood'] },
    { heading: 'Orders', fields: (['orders', 'orders_in_force', 'directions_open', 'ordered_unpaid', 'construction_restraints', 'sale_restraints', 'order_standing'] as const).map((field) => litigation(L.diary, field)) },
    { heading: 'Orders, one by one', records: L.orders, columns: ['matter', 'order_date', 'kind', 'effect', 'in_force', 'comply_by'] },
    { heading: 'Notices and claims', records: L.notices, columns: ['reference', 'kind', 'dated', 'counterparty', 'amount', 'state'] },
    { heading: 'Counsel’s remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } },
  ],
};

const REPORTS: SetLinks[] = [
  { set: T.opinion, reports: [TITLE_REPORT] },
  { set: L.register, reports: [LITIGATION_REPORT] },
];

export const TITLES_LITIGATION_FIELD_SETS: FieldSet[] = withLinks(
  [
  PARCEL_FACTS,
  LAND_RECORDS_SHEET,
  LAND_RECORDS,
  OWNERSHIP,
  OWNER_FACTS,
  CHAIN,
  INSTRUMENTS,
  ENCUMBRANCE,
  CERTIFICATES,
  ENTRIES,
  CHARGES,
  CHARACTER,
  RESTRICTIONS,
  OPINION,
  REQUISITIONS,
  MATTER_FACTS,
  REGISTER,
  DIARY,
  ORDERS,
  COVER,
  SEARCH,
  SEARCHES,
  HITS,
  NOTICES,
],
  REPORTS,
);
