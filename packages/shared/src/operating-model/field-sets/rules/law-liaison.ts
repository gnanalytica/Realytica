/**
 * The figures a law sets that Law and Liaison read: the sizes from which a
 * registration, a clearance or a consent is needed, and the periods a filing,
 * a conveyance or a clearance runs for.
 *
 * Every row is unverified. Each was taken from the research behind these
 * sheets, which read most of them in secondary sources or from memory, and
 * no named person has checked one against its instrument. The screen says so
 * beside every value worked out from one.
 *
 * `from` is the day the instrument came into force where the research gives
 * it. Where it does not, `from` is the day the research read the figure
 * (2026-10-12): the row is known from then, and says nothing of earlier days.
 */

import type { RuleRow } from '../../types';

const READ_ON = '2026-10-12';
const RERA = 'Real Estate (Regulation and Development) Act, 2016';
const RERA_IN_FORCE = '2017-05-01';
const EIA = 'Environment Impact Assessment Notification, 2006';
const EIA_IN_FORCE = '2006-09-14';
const KARNATAKA = { state: 'Karnataka' };

export const LAW_LIAISON_RULE_ROWS: RuleRow[] = [
  /* --- RERA ------------------------------------------------------------ */
  {
    key: 'rera_registration_land_floor',
    label: 'Land area up to which a project needs no registration',
    jurisdiction: {},
    value: 500,
    unit: 'sqm',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 3(2)(a)' },
    verified: false,
  },
  {
    key: 'rera_registration_units_floor',
    label: 'Units up to which a project needs no registration',
    jurisdiction: {},
    value: 8,
    unit: 'units',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 3(2)(a)' },
    verified: false,
  },
  {
    key: 'rera_quarterly_filing_days',
    label: 'Days after a quarter ends by which its update is filed',
    jurisdiction: KARNATAKA,
    value: 15,
    unit: 'days',
    from: READ_ON,
    source: { regulation: 'Karnataka Real Estate (Regulation and Development) Rules, 2017', url: 'https://rera.karnataka.gov.in' },
    verified: false,
  },
  {
    key: 'rera_annual_report_months',
    label: 'Months after the financial year ends by which the audited statement is filed',
    jurisdiction: {},
    value: 6,
    unit: 'months',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 4(2)(l)(D), third proviso' },
    verified: false,
  },
  {
    key: 'rera_alteration_consent_share',
    label: 'Share of allottees whose written consent a change to the sanctioned plan needs',
    jurisdiction: {},
    value: 66.67,
    unit: '%',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 14(2)(ii)' },
    verified: false,
  },
  {
    key: 'rera_extension_most_months',
    label: 'Longest a registration may be extended, in all',
    jurisdiction: {},
    value: 12,
    unit: 'months',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 6' },
    verified: false,
  },
  {
    key: 'rera_conveyance_months',
    label: 'Months after the occupancy certificate by which common areas are conveyed',
    jurisdiction: {},
    value: 3,
    unit: 'months',
    from: RERA_IN_FORCE,
    source: { regulation: RERA, clause: 'section 17' },
    verified: false,
  },
  {
    key: 'rera_delay_interest_spread',
    label: 'Interest for delay, over the State Bank’s marginal cost of lending rate',
    jurisdiction: KARNATAKA,
    value: 2,
    unit: '%',
    from: READ_ON,
    source: { regulation: 'Karnataka Real Estate (Regulation and Development) Rules, 2017' },
    verified: false,
  },

  /* --- Agreements ------------------------------------------------------ */
  {
    key: 'earnest_forfeit_most',
    label: 'Most of the basic sale price a court has let a promoter forfeit',
    jurisdiction: {},
    value: 10,
    unit: '%',
    from: READ_ON,
    source: { regulation: 'Godrej Projects Development Limited v Anil Karlekar, 2025 INSC 143 (Supreme Court)' },
    verified: false,
  },
  {
    key: 'specific_performance_suit_years',
    label: 'Years from the day fixed for performance within which a suit to compel a sale is brought',
    jurisdiction: {},
    value: 3,
    unit: 'years',
    from: '1964-01-01',
    source: { regulation: 'Limitation Act, 1963', clause: 'Schedule, article 54' },
    verified: false,
  },

  /* --- Height ---------------------------------------------------------- */
  {
    key: 'high_rise_height',
    label: 'Height from which a building is a high-rise',
    jurisdiction: KARNATAKA,
    value: 21,
    unit: 'm',
    from: READ_ON,
    source: { regulation: 'Karnataka Fire Force (Amendment) Act, 2023', url: 'https://prsindia.org/files/bills_acts/bills_states/karnataka/2023/Bill3of2023Karnataka.pdf' },
    verified: false,
  },
  {
    key: 'electrical_inspection_height',
    label: 'Height above which a building’s installation is inspected before it is energised',
    jurisdiction: {},
    value: 15,
    unit: 'm',
    from: READ_ON,
    source: { regulation: 'Central Electricity Authority (Measures relating to Safety and Electric Supply) Regulations' },
    verified: false,
  },
  {
    key: 'height_clearance_validity_years',
    label: 'Years a height clearance for a building runs',
    jurisdiction: {},
    value: 8,
    unit: 'years',
    from: READ_ON,
    source: {
      regulation: 'Ministry of Civil Aviation (Height Restrictions for Safeguarding of Aircraft Operations) Rules, 2015, as amended',
      clause: 'rule 9A',
      url: 'https://civilaviation.gov.in/sites/default/files/2023-12/Ministry%20of%20Civil%20Aviation%20%28Height%20Restrictions%20for%20Safeguarding%20of%20Aircraft%20Operations%29%20Second%20Amendment%20Rules%2C%202023.pdf',
    },
    verified: false,
  },

  /* --- Environment and pollution control ------------------------------- */
  {
    key: 'environment_clearance_built_up_area',
    label: 'Built-up area from which a building project needs an environment clearance',
    jurisdiction: {},
    value: 20000,
    unit: 'sqm',
    from: EIA_IN_FORCE,
    source: { regulation: EIA, clause: 'Schedule, item 8(a)' },
    verified: false,
  },
  {
    key: 'environment_clearance_township_built_up_area',
    label: 'Built-up area from which a project is cleared as a township or area development',
    jurisdiction: {},
    value: 150000,
    unit: 'sqm',
    from: EIA_IN_FORCE,
    source: { regulation: EIA, clause: 'Schedule, item 8(b)' },
    verified: false,
  },
  {
    key: 'environment_clearance_validity_years',
    label: 'Years an environment clearance for a building project runs',
    jurisdiction: {},
    value: 10,
    unit: 'years',
    from: READ_ON,
    source: { regulation: 'Ministry of Environment, Forest and Climate Change, office memorandum of 2022 on the validity of clearances', url: 'https://www.greentribunal.gov.in/sites/default/files/news_updates/8721_5.pdf' },
    verified: false,
  },
  {
    key: 'pollution_consent_built_up_area',
    label: 'Built-up area from which the pollution control board’s consent is needed',
    jurisdiction: KARNATAKA,
    value: 2000,
    unit: 'sqm',
    from: READ_ON,
    source: { regulation: 'Karnataka State Pollution Control Board, as stated before the National Green Tribunal', url: 'https://www.greentribunal.gov.in/sites/default/files/news_updates/Appeal%20No.%2038%20of%202025%20Report%20of%20R-1%20&%202.pdf' },
    verified: false,
  },

  /* --- Building bye-laws ------------------------------------------------ */
  {
    key: 'deviation_compounding_limit',
    label: 'Deviation from the sanctioned plan that can be regularised for a fee',
    jurisdiction: { state: 'Karnataka', city: 'Bengaluru' },
    value: 5,
    unit: '%',
    from: READ_ON,
    source: { regulation: 'Bangalore Mahanagara Palike Building Bye-laws, 2003', url: 'https://site.bbmp.gov.in/PDF/Bangalore-Building-Byelaws-%202003.pdf' },
    verified: false,
  },
];
