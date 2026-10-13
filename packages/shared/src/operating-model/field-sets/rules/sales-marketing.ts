/**
 * The figures the law sets for selling a unit, taking money for it, handing
 * it over and advertising it: each a dated row with where it is written.
 *
 * Sales and Marketing read these with a `rate` formula; none is typed into a
 * field, a label or a formula. Every row is unverified. The Act and the
 * Karnataka papers were read in their official text when the catalog was
 * researched, and no named person has yet checked a row against the
 * instrument, which is what marking one verified means.
 *
 * The model allotment letter carries no date of its own. Its rows are dated
 * from the day the model agreement for sale was gazetted, as a stand-in, and
 * that date is one of the things a person has to check.
 */

import type { RuleRow } from '../../types';

const ACT = 'Real Estate (Regulation and Development) Act, 2016';
const ACT_URL = 'https://rera.karnataka.gov.in/resources/staticpage/Real_Estate_Act.pdf';
const ACT_FROM = '2017-05-01';

const KARNATAKA = { state: 'Karnataka' };
const ALLOTMENT = 'K-RERA Annexure-1, model form of allotment letter';
const ALLOTMENT_URL = 'https://rera.karnataka.gov.in/reraDocument?DOC=QuKqpiitJsqAcPp6DqDGig%3D%3D';
const AGREEMENT = 'Karnataka Real Estate (Regulation and Development) (First Amendment) Rules, 2020, Annexure-A agreement for sale';
const AGREEMENT_URL = 'https://rera.karnataka.gov.in/reraDocument?DOC=ibf3YlQD1L2R0uTQzijgfQ%3D%3D';
const MODEL_FORMS_FROM = '2020-06-15';
const ADVERTISING = 'K-RERA Circular RERA/ADM/CR-4/2019-20, guidelines for releasing of advertisement in print and electronic media';
const ADVERTISING_URL = 'https://rera.karnataka.gov.in/resources/circulars/circular2.pdf';
const ADVERTISING_FROM = '2019-11-14';

const act = (clause: string): RuleRow['source'] => ({ regulation: ACT, clause, url: ACT_URL });
const letter = (clause: string): RuleRow['source'] => ({ regulation: ALLOTMENT, clause, url: ALLOTMENT_URL });
const agreement = (clause: string): RuleRow['source'] => ({ regulation: AGREEMENT, clause, url: AGREEMENT_URL });
const circular = (clause: string): RuleRow['source'] => ({ regulation: ADVERTISING, clause, url: ADVERTISING_URL });

export const SALES_MARKETING_RULE_ROWS: RuleRow[] = [
  /* --- Money before the agreement, and the agreement itself --------------- */
  {
    key: 'rera_advance_before_agreement_max',
    label: 'Most that may be taken before a registered agreement for sale, as a share of the unit’s cost',
    jurisdiction: {},
    value: 10,
    unit: '%',
    from: ACT_FROM,
    source: act('section 13(1)'),
    verified: false,
  },
  {
    key: 'rera_agreement_within_months',
    label: 'Time from the allotment letter to a registered agreement for sale',
    jurisdiction: KARNATAKA,
    value: 2,
    unit: 'months',
    from: MODEL_FORMS_FROM,
    source: letter('clause 12(i)'),
    verified: false,
  },
  {
    key: 'rera_agreement_notice_days',
    label: 'Notice to the allottee before cancelling for an agreement not registered',
    jurisdiction: KARNATAKA,
    value: 15,
    unit: 'days',
    from: MODEL_FORMS_FROM,
    source: letter('clause 12(ii)'),
    verified: false,
  },
  {
    key: 'rera_forfeit_no_agreement_max',
    label: 'Most that may be forfeited where the agreement is not registered after notice, as a share of the unit’s cost',
    jurisdiction: KARNATAKA,
    value: 2,
    unit: '%',
    from: MODEL_FORMS_FROM,
    source: letter('clause 12(iii)'),
    verified: false,
  },

  /* --- Cancellation before the agreement: the deduction by day count ------ */
  // The form says "within 15 days", "16 to 30", "31 to 60" and "after 61 days". Day 61 itself is named by none of them and is read here with the last.
  ...(
    [
      [{ min: 0, max: 16 }, 0],
      [{ min: 16, max: 31 }, 1],
      [{ min: 31, max: 61 }, 1.5],
      [{ min: 61 }, 2],
    ] as const
  ).map(
    ([days, value]): RuleRow => ({
      key: 'rera_cancel_deduction',
      label: 'Deduction allowed when an allottee cancels before the agreement, as a share of the unit’s cost, by days since the allotment letter',
      jurisdiction: KARNATAKA,
      when: { days_from_allotment: { ...days } },
      value,
      unit: '%',
      from: MODEL_FORMS_FROM,
      source: letter('clause 9'),
      verified: false,
    }),
  ),

  /* --- Refunds and interest ------------------------------------------------ */
  {
    key: 'rera_refund_within_days',
    label: 'Time to refund after a cancellation before the agreement',
    jurisdiction: KARNATAKA,
    when: { stage: 'before_agreement' },
    value: 45,
    unit: 'days',
    from: MODEL_FORMS_FROM,
    source: letter('clauses 9 and 12'),
    verified: false,
  },
  {
    key: 'rera_refund_within_days',
    label: 'Time to refund after a cancellation or termination once the agreement is registered',
    jurisdiction: KARNATAKA,
    when: { stage: 'after_agreement' },
    value: 60,
    unit: 'days',
    from: MODEL_FORMS_FROM,
    source: agreement('clauses 7.5 and 9.2'),
    verified: false,
  },

  /* --- Area, possession, conveyance, defects ------------------------------ */
  {
    key: 'rera_carpet_increase_chargeable_max',
    label: 'Most increase in carpet area that may be charged for, as a share of the carpet area allotted',
    jurisdiction: KARNATAKA,
    value: 3,
    unit: '%',
    from: MODEL_FORMS_FROM,
    source: agreement('clause 1.7'),
    verified: false,
  },
  {
    key: 'rera_possession_offer_within_months',
    label: 'Time from the occupancy certificate to offering possession',
    jurisdiction: KARNATAKA,
    value: 2,
    unit: 'months',
    from: MODEL_FORMS_FROM,
    source: agreement('clause 7.2'),
    verified: false,
  },
  {
    key: 'rera_defect_liability_months',
    label: 'Defect liability period from handing over possession',
    jurisdiction: {},
    value: 60,
    unit: 'months',
    from: ACT_FROM,
    source: act('section 14(3)'),
    verified: false,
  },
  {
    key: 'rera_defect_rectify_within_days',
    label: 'Time to rectify a defect brought to the promoter’s notice in the liability period',
    jurisdiction: {},
    value: 30,
    unit: 'days',
    from: ACT_FROM,
    source: act('section 14(3)'),
    verified: false,
  },

  /* --- Advertising ---------------------------------------------------------- */
  {
    key: 'rera_ad_lettering_ratio_min',
    label: 'Least size of the registration number’s lettering against the project name’s',
    jurisdiction: KARNATAKA,
    value: 0.5,
    unit: 'ratio',
    from: ADVERTISING_FROM,
    source: circular('paragraph 1(a)'),
    verified: false,
  },
  {
    key: 'rera_ad_registered_block_min',
    label: 'Least size of the “RERA Registered” block in a print advertisement, as a share of its length and of its breadth',
    jurisdiction: KARNATAKA,
    value: 10,
    unit: '%',
    from: ADVERTISING_FROM,
    source: circular('paragraph 1(d)'),
    verified: false,
  },
  {
    key: 'rera_penalty_contravention_max',
    label: 'Most that may be levied for contravening the Act, as a share of the estimated cost of the project',
    jurisdiction: {},
    value: 5,
    unit: '%',
    from: ACT_FROM,
    source: act('section 61'),
    verified: false,
  },
  {
    key: 'rera_penalty_unregistered_max',
    label: 'Most that may be levied for advertising or selling before registration, as a share of the estimated cost of the project',
    jurisdiction: {},
    value: 10,
    unit: '%',
    from: ACT_FROM,
    source: act('section 59(1)'),
    verified: false,
  },
];
