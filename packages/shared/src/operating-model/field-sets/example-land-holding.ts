/**
 * The worked example of a field set: Legal › Title's land holding, and the
 * owners of it as a set that repeats.
 *
 * It is here to show every part of the field system once, on a function that
 * already exists, and it is what docs/fields.md walks through. It is not the
 * catalog for Title: a department's own file replaces it.
 */

import type { FieldReportTemplate, FieldSet } from '../types';

const FN = 'legal.title';
const HOLDING = 'legal.title.holding';
const OWNERS = 'legal.title.owners';
const PARCEL_CHECK = 'land_site.parcel_identification';

/**
 * The report Title hands over on the holding: sections in order, each a
 * block of fields, a table, a chart, or a place for a person's own words
 * with a cap. Declared on the set below (`reports`); a person may then move,
 * add and remove sections on the report itself.
 */
const HOLDING_REPORT: FieldReportTemplate = {
  id: 'legal.title.holding.report',
  title: 'Land holding report',
  sections: [
    { heading: 'The holding', fields: ['tenure', 'extent', 'extent_on_check', 'owners_count', 'value_at_rate', 'standing', 'seller', 'possession_verified'] },
    { heading: 'Owners', records: OWNERS, columns: ['name', 'share_pct', 'capacity', 'guardian'] },
    { heading: 'Shares held', chart: { of: { records: OWNERS }, x: 'name', y: 'share_pct' } },
    { heading: 'Chain of title', table: 'chain' },
    { heading: 'Conversion', fields: ['conversion_order_no', 'conversion_date'] },
    { heading: 'The parcel check', fields: ['survey_numbers', 'extent_title', 'extent_survey', 'extent_khata'].map((field) => ({ fn: FN, set: PARCEL_CHECK, field })) },
    { heading: 'Opinion on the holding', note: { maxLength: 800, hint: 'The signer’s view of the holding, in their own words.' } },
  ],
};

export const EXAMPLE_LAND_HOLDING: FieldSet[] = [
  {
    id: HOLDING,
    fn: FN,
    title: 'Land holding',
    v: 1,
    reports: [HOLDING_REPORT],
    optionSets: [
      {
        id: 'land_tenure',
        label: 'Tenure',
        options: [
          { key: 'freehold', label: 'Freehold', tone: 'good' },
          { key: 'leasehold', label: 'Leasehold', tone: 'info' },
          { key: 'government_grant', label: 'Government grant', tone: 'warning' },
          { key: 'inam', label: 'Inam', tone: 'warning' },
          { key: 'unknown', label: 'Not known', tone: 'neutral', retired: true },
        ],
      },
      {
        id: 'title_event',
        label: 'Event',
        options: [
          { key: 'sale', label: 'Sale' },
          { key: 'gift', label: 'Gift' },
          { key: 'partition', label: 'Partition' },
          { key: 'inheritance', label: 'Inheritance' },
          { key: 'mortgage', label: 'Mortgage', tone: 'warning' },
          { key: 'release', label: 'Release', tone: 'good' },
        ],
      },
    ],
    situations: [
      {
        key: 'agricultural_land',
        label: 'Agricultural land',
        scope: 'project',
        hint: 'The land is, or was, recorded as agricultural.',
        proposeFrom: { documentTypes: ['RTC (record of rights)', 'DC conversion order'] },
      },
    ],
    sections: [
      { key: 'holding', label: 'Holding' },
      { key: 'history', label: 'History' },
      { key: 'conversion', label: 'Conversion', showWhen: { situation: 'agricultural_land' } },
      { key: 'notes', label: 'Notes', tier: 'expert' },
    ],
    fields: [
      { key: 'tenure', label: 'Tenure', kind: 'enum', control: 'tiles', optionSet: 'land_tenure', section: 'holding' },
      {
        key: 'extent',
        label: 'Extent held',
        kind: 'area',
        dimension: 'area',
        enterIn: ['acre', 'gunta', 'cent', 'sqm', 'sqft', 'hectare'],
        section: 'holding',
        from: 'Sale deed',
        fromTypes: ['Sale deed', 'Mother deed'],
        factKey: 'extent_title',
        proof: 'expected',
      },
      {
        key: 'extent_on_check',
        label: 'Land area in the title deeds',
        kind: 'area',
        unit: 'sqm',
        section: 'holding',
        sameAs: { fn: FN, set: 'land_site.parcel_identification', field: 'extent_title' },
        required: false,
      },
      {
        key: 'owners_count',
        label: 'Owners',
        kind: 'computed',
        section: 'holding',
        formula: { op: 'records', set: OWNERS, reduce: 'count' },
      },
      {
        key: 'value_at_rate',
        label: 'Value of the land at Valuation’s rate',
        kind: 'computed',
        dimension: 'money',
        currency: 'INR',
        section: 'holding',
        formula: {
          op: 'multiply',
          left: { op: 'field', key: 'extent' },
          right: { op: 'field', key: 'rate_per_sqm', at: { fn: 'finance.valuation', set: 'indicative_valuation.comparable_inputs', field: 'rate_per_sqm' } },
        },
      },
      {
        key: 'standing',
        label: 'Holding record',
        kind: 'status',
        section: 'holding',
        cases: [
          {
            when: { kind: 'compare', fields: ['extent', 'extent_on_check'], tolerance: 0.01, say: 'The extent held is {a} and the parcel check records {b}: {divergence} apart.', severity: 'high' },
            label: 'Extent differs from the parcel check',
            tone: 'critical',
          },
          { when: { kind: 'require', fields: ['tenure'], say: 'Tenure is not recorded.', severity: 'medium' }, label: 'Tenure not recorded', tone: 'warning' },
        ],
        otherwise: { label: 'In order', tone: 'good' },
      },
      { key: 'seller', label: 'Seller', kind: 'ref', target: 'party', section: 'holding', required: false },
      { key: 'possession_verified', label: 'Possession verified on site', kind: 'boolean', control: 'tick', section: 'holding', required: false },
      {
        key: 'chain',
        label: 'Chain of title',
        kind: 'table',
        display: 'timeline',
        section: 'history',
        required: false,
        columns: [
          { key: 'on', label: 'Date', kind: 'date' },
          { key: 'event', label: 'Event', kind: 'enum', optionSet: 'title_event' },
          { key: 'from', label: 'From', kind: 'text' },
          { key: 'to', label: 'To', kind: 'text' },
        ],
      },
      { key: 'mother_deed', label: 'Mother deed', kind: 'evidence', accepts: 'document', viewer: 'deed', section: 'history', required: false },
      // Owed by somebody else, and not before the land is being bought: listed under the advocate, never as the reader's to fill.
      { key: 'title_opinion', label: 'Title opinion', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'history', owedBy: 'advocate', dueFrom: 'acquisition' },
      // Owed by whoever the Seller link names on this holding.
      { key: 'possession_letter', label: 'Possession letter', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'history', owedBy: { ref: 'seller' }, dueFrom: 'acquisition' },
      {
        key: 'conversion_order_no',
        label: 'Conversion order number',
        kind: 'text',
        section: 'conversion',
        tier: 'situational',
        showWhen: { situation: 'agricultural_land' },
        from: 'DC conversion order',
        fromTypes: ['DC conversion order'],
        factKey: 'conversion_order_number',
      },
      {
        key: 'conversion_date',
        label: 'Converted on',
        kind: 'date',
        section: 'conversion',
        tier: 'situational',
        showWhen: { situation: 'agricultural_land' },
        from: 'DC conversion order',
        fromTypes: ['DC conversion order'],
      },
      // A day that runs out: the page says when it is about to, and a lead may put that line off until a day.
      { key: 'conversion_build_by', label: 'Build by, under the conversion order', kind: 'date', section: 'conversion', tier: 'situational', showWhen: { situation: 'agricultural_land' }, required: false, expires: { leadDays: 180 } },
      { key: 'access_confidence', label: 'Confidence in the access', kind: 'number', control: 'scale', min: 1, max: 5, section: 'notes', tier: 'expert', required: false },
      { key: 'remarks', label: 'Remarks', kind: 'longtext', maxLength: 300, section: 'notes', tier: 'expert', required: false },
    ],
    rules: [
      { kind: 'compare', fields: ['extent', 'extent_on_check'], tolerance: 0.01, say: 'The extent held is {a} and the parcel check records {b}: {divergence} apart, outside {tolerance}.', severity: 'high' },
    ],
  },
  {
    id: OWNERS,
    fn: FN,
    title: 'Owners',
    v: 1,
    records: { of: 'owner', titleField: 'name', summaryFields: ['share_pct', 'capacity'] },
    fields: [
      { key: 'name', label: 'Name', kind: 'text', suggest: 'party', fromTypes: ['Sale deed'], factKey: 'purchaser' },
      { key: 'share_pct', label: 'Share', kind: 'percent', max: 100, precision: 2 },
      { key: 'capacity', label: 'Holds as', kind: 'enum', control: 'segmented', options: ['individual', 'karta of an HUF', 'company', 'trust', 'minor through a guardian'] },
      {
        key: 'guardian',
        label: 'Guardian',
        kind: 'text',
        tier: 'situational',
        showWhen: { field: { fn: FN, set: OWNERS, field: 'capacity' }, is: 'equals', value: 'minor through a guardian' },
      },
    ],
    rules: [],
    // The hard case: an owner who is a minor. It opens from that owner's row as its own small sheet, and no other owner sees it.
    sheets: [
      {
        id: 'guardianship',
        title: 'Guardianship',
        showWhen: { field: { fn: FN, set: OWNERS, field: 'capacity' }, is: 'equals', value: 'minor through a guardian' },
        sections: [
          { key: 'minor', label: 'The minor' },
          { key: 'permission', label: 'The court’s permission' },
        ],
        fields: [
          { key: 'date_of_birth', label: 'Date of birth', kind: 'date', section: 'minor' },
          { key: 'guardian_kind', label: 'Guardian is', kind: 'enum', control: 'segmented', options: ['natural', 'testamentary', 'court-appointed'], section: 'minor' },
          // Asked of every minor: a guardian sells a minor's land only with the court's leave, so its absence is a gap and never a blank.
          { key: 'court_permission_no', label: 'Order number', kind: 'text', section: 'permission', from: 'Court order' },
          { key: 'court_permission_date', label: 'Order date', kind: 'date', section: 'permission', required: false },
          { key: 'permission_order', label: 'Order', kind: 'evidence', accepts: 'document', viewer: 'pdf', section: 'permission', required: false },
        ],
        rules: [
          { kind: 'require_if', fields: ['guardian_kind', 'court_permission_no'], whenIn: ['court-appointed'], say: 'The guardian is {a} and no order number is recorded.', severity: 'high' },
        ],
      },
    ],
  },
];
