/**
 * The seeded rule table: figures a law sets, each a dated row with where it
 * is written. Catalog authors add rows in a file of their own and register
 * it in `index.ts`; a figure is never typed into a formula.
 *
 * Every row here is unverified: it was read, and no named person has checked
 * it against the instrument. Marking one verified is a person's act, with
 * their name and the day.
 */

import type { RuleRow } from '../types';

export const BASE_RULE_ROWS: RuleRow[] = [
  {
    key: 'rera_deposit_share',
    label: 'Share of allottees’ money kept in the project account',
    jurisdiction: {},
    value: 70,
    unit: '%',
    from: '2017-05-01',
    source: { regulation: 'Real Estate (Regulation and Development) Act, 2016', clause: 'section 4(2)(l)(D)' },
    verified: false,
  },
  {
    key: 'gst_flat_affordable',
    label: 'GST on an affordable residential unit, on the whole consideration',
    jurisdiction: {},
    value: 1,
    unit: '%',
    from: '2019-04-01',
    source: { regulation: 'Notification No. 03/2019-Central Tax (Rate)' },
    verified: false,
  },
  {
    key: 'gst_flat_other',
    label: 'GST on any other residential unit, on the whole consideration',
    jurisdiction: {},
    value: 5,
    unit: '%',
    from: '2019-04-01',
    source: { regulation: 'Notification No. 03/2019-Central Tax (Rate)' },
    verified: false,
  },
  {
    key: 'gst_registered_procurement_min',
    label: 'Least share of inputs bought from registered suppliers',
    jurisdiction: {},
    value: 80,
    unit: '%',
    from: '2019-04-01',
    source: { regulation: 'Notification No. 03/2019-Central Tax (Rate)' },
    verified: false,
  },
];
