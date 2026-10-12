/**
 * The figures Titles and Litigation read: how far back a title is searched,
 * how long a search stays fresh, the periods a suit runs on.
 *
 * None of these was read in the official text for this file. Each row says
 * where it is written, or that it is practice and no statute sets it, and
 * every one is unverified until a named person checks it against the
 * instrument. The screen says so beside whatever is worked out from one.
 */

import type { RuleRow } from '../../types';

const LIMITATION = 'Limitation Act, 1963';
const RERA = 'Real Estate (Regulation and Development) Act, 2016';

/** Days allowed to appeal an order, by the forum that passed it. */
const appeal = (forum: string, value: number, from: string, regulation: string, clause: string): RuleRow => ({
  key: 'appeal_days',
  label: 'Days allowed to appeal an order',
  jurisdiction: {},
  when: { forum },
  value,
  unit: 'days',
  from,
  source: { regulation, clause },
  verified: false,
});

export const TITLES_LITIGATION_RULE_ROWS: RuleRow[] = [
  /* --- Practice, set by no statute ---------------------------------- */
  {
    key: 'title_search_years',
    label: 'Years of title a lender usually asks to be searched',
    jurisdiction: {},
    value: 30,
    unit: 'years',
    from: '2020-01-01',
    source: {
      regulation: 'Lenders’ practice for a title investigation report. Seen in title reports filed with a stock exchange; the circular itself was not read',
      url: 'https://nsearchives.nseindia.com/corporate/IDBITSL_14062025164300_TSR_Merged.pdf',
    },
    verified: false,
  },
  {
    key: 'search_fresh_days',
    label: 'Days a search or a land record is relied on before it is run again',
    jurisdiction: {},
    value: 30,
    unit: 'days',
    from: '2020-01-01',
    source: { regulation: 'Practice at a closing. A house rule: no statute sets it' },
    verified: false,
  },
  {
    key: 'title_opinion_refresh_days',
    label: 'Days a title opinion is relied on before it is brought up to date',
    jurisdiction: {},
    value: 90,
    unit: 'days',
    from: '2020-01-01',
    source: { regulation: 'Practice at a closing. A house rule: no statute sets it' },
    verified: false,
  },

  /* --- Minors -------------------------------------------------------- */
  {
    key: 'age_of_majority_years',
    label: 'Age of majority',
    jurisdiction: {},
    value: 18,
    unit: 'years',
    from: '1875-06-02',
    source: { regulation: 'Indian Majority Act, 1875', clause: 'section 3' },
    verified: false,
  },
  {
    key: 'minor_sale_challenge_years',
    label: 'Years after majority in which a ward may set aside a guardian’s transfer',
    jurisdiction: {},
    value: 3,
    unit: 'years',
    from: '1964-01-01',
    source: { regulation: LIMITATION, clause: 'Schedule, article 60' },
    verified: false,
  },

  /* --- Suits --------------------------------------------------------- */
  {
    key: 'written_statement_days',
    label: 'Days from service of summons to file a written statement',
    jurisdiction: {},
    value: 30,
    unit: 'days',
    from: '2002-07-01',
    source: { regulation: 'Code of Civil Procedure, 1908', clause: 'Order VIII rule 1' },
    verified: false,
  },
  appeal('civil_court', 30, '1964-01-01', LIMITATION, 'Schedule, article 116(b): an appeal to a court other than the High Court'),
  appeal('commercial_court', 60, '2018-05-03', 'Commercial Courts Act, 2015', 'section 13(1A)'),
  appeal('rera_authority', 60, '2017-05-01', RERA, 'section 44(2)'),
  appeal('rera_adjudicating_officer', 60, '2017-05-01', RERA, 'section 44(2)'),
  appeal('rera_appellate_tribunal', 60, '2017-05-01', RERA, 'section 58'),
  appeal('consumer_commission', 45, '2020-07-20', 'Consumer Protection Act, 2019', 'section 41'),
  appeal('company_law_tribunal', 45, '2016-06-01', 'Companies Act, 2013', 'section 421(3)'),
  appeal('green_tribunal', 90, '2010-10-18', 'National Green Tribunal Act, 2010', 'section 22'),
  {
    key: 'award_challenge_months',
    label: 'Months allowed to apply to set aside an arbitral award',
    jurisdiction: {},
    value: 3,
    unit: 'months',
    from: '1996-08-22',
    source: { regulation: 'Arbitration and Conciliation Act, 1996', clause: 'section 34(3)' },
    verified: false,
  },

  /* --- Appeals by a promoter ---------------------------------------- */
  {
    key: 'rera_appeal_deposit_share',
    label: 'Share of an ordered amount a promoter deposits before its appeal is heard',
    jurisdiction: {},
    when: { ordered_as: 'penalty' },
    value: 30,
    unit: '%',
    from: '2017-05-01',
    source: { regulation: RERA, clause: 'section 43(5), proviso' },
    verified: false,
  },
  {
    key: 'rera_appeal_deposit_share',
    label: 'Share of an ordered amount a promoter deposits before its appeal is heard',
    jurisdiction: {},
    when: { ordered_as: 'payment_to_allottee' },
    value: 100,
    unit: '%',
    from: '2017-05-01',
    source: { regulation: RERA, clause: 'section 43(5), proviso' },
    verified: false,
  },
];
