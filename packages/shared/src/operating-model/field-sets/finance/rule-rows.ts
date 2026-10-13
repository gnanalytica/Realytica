/**
 * The figures a law or a regulator sets that Finance, Tax, Lenders and
 * Ledgers read: RERA's deposit share, GST on a unit, tax deducted at source,
 * Karnataka's stamp duty and registration fee, and the Reserve Bank's limits
 * on a project loan.
 *
 * Not one of these rows is verified. Each was read on 12 October 2026 from
 * the source it names, most of them commentary and several from memory, and
 * the firm's chartered accountant confirms a row before anything rests on
 * it. The screen says "not verified" beside every value worked out from one.
 * Where the source gave no day a figure came into force, `from` is the first
 * day of the year it names, or the day it was read; the label says which.
 *
 * Tax deducted at source is under the Income-tax Act, 2025 from 1 April
 * 2026, where every deduction sits in section 393 by a serial of its table.
 * Each row's clause names the old section beside the new, because every
 * paper before that day cites the old one. No row is given for a payment
 * before that day: the rates then were the 1961 Act's, and nobody has read
 * them into this table.
 */

import type { RuleRow } from '../../types';

const KA = { state: 'Karnataka' };
const READ_ON = '2026-10-12';

const KRERA_FORMS = { regulation: 'Karnataka Real Estate Regulatory Authority (General) Regulations, 2022', url: 'https://cdn.taxguru.in/wp-content/uploads/2023/01/Karnataka-Real-Estate-Regulatory-Authority-General-Regulations-2022-Forms-And-Annexures.pdf' };
const GST_FAQ = 'https://www.gstcouncil.gov.in/sites/default/files/2024-02/faq-real-estate-sector.pdf';
const GST_RATE = 'Notification No. 03/2019-Central Tax (Rate)';
const TDS_2025 = 'Income-tax Act, 2025';
const TDS_URL = 'https://taxguru.in/income-tax/tds-rates-income-tax-act-2025-1-april-2026.html';
const KA_STAMP = { regulation: 'Karnataka Stamp Act, 1957, as reported', url: 'https://homefirstindia.com/blog/article/stamp-duty-registration-charges-karnataka' };
const RBI = { regulation: 'Reserve Bank of India (Project Finance) Directions, 2025, as summarised', url: 'https://conventuslaw.com/report/rbi-introduces-new-harmonised-framework-for-project-finance-key-highlights-of-the-reserve-bank-of-india-project-finance-directions-2025/' };

const row = (key: string, label: string, value: number, unit: string, from: string, source: RuleRow['source'], more: Partial<RuleRow> = {}): RuleRow => ({ key, label, jurisdiction: {}, value, unit, from, source, verified: false, ...more });

export const FINANCE_RULE_ROWS: RuleRow[] = [
  /* --- RERA ------------------------------------------------------------ */
  row('rera_deposit_share_stressed', 'Share of allottees’ money kept in the project account once receivables fall below the cost left to complete (in force from the year the regulations name)', 100, '%', '2022-01-01', { ...KRERA_FORMS, clause: 'Form 4, additional information (5)' }, { jurisdiction: KA }),

  /* --- GST on a unit --------------------------------------------------- */
  row('gst_scheme_generation', 'GST scheme for housing in force when a project began (1: with input credit)', 1, 'scheme', '2017-07-01', { regulation: GST_RATE, url: GST_FAQ }, { to: '2019-03-31' }),
  row('gst_scheme_generation', 'GST scheme for housing in force when a project began (2: without input credit)', 2, 'scheme', '2019-04-01', { regulation: GST_RATE, url: GST_FAQ }),
  row('gst_affordable_carpet_max', 'Largest carpet area of an affordable residential unit, outside the metropolitan cities', 90, 'sqm', '2019-04-01', { regulation: GST_RATE, url: GST_FAQ }),
  row('gst_affordable_carpet_max', 'Largest carpet area of an affordable residential unit, in a metropolitan city (Bengaluru taken as one from memory)', 60, 'sqm', '2019-04-01', { regulation: GST_RATE, url: GST_FAQ }, { jurisdiction: { city: 'Bengaluru' } }),
  row('gst_affordable_price_max', 'Highest price of an affordable residential unit', 4_500_000, 'INR', '2019-04-01', { regulation: GST_RATE, url: GST_FAQ }),
  row('gst_land_deduction', 'Share of the price of a unit deemed to be land', 33.33, '%', '2017-07-01', { regulation: 'Notification No. 11/2017-Central Tax (Rate)', clause: 'paragraph 2', url: GST_FAQ }),
  row('gst_residential_commercial_share_max', 'Largest share of commercial carpet area in a residential real estate project (from memory)', 15, '%', '2019-04-01', { regulation: GST_RATE }),
  row('gst_rcm_shortfall', 'GST by reverse charge on a shortfall in purchases from registered suppliers', 18, '%', '2019-04-01', { regulation: 'Notification No. 07/2019-Central Tax (Rate), as reported', url: 'https://taxguru.in/goods-and-service-tax/practical-gst-point-builders-developers-overlook-80-20-rule-paying.html' }),
  row('gst_cement', 'GST on cement', 28, '%', '2017-07-01', { regulation: 'Notification No. 01/2017-Central Tax (Rate), as reported' }, { to: '2025-09-21' }),
  row('gst_cement', 'GST on cement', 18, '%', '2025-09-22', { regulation: 'Notification No. 09/2025-Central Tax (Rate), as reported', url: 'https://cleartax.in/s/impact-of-gst-on-the-cement-industry' }),
  row('gst_works_contract', 'GST on a works contract, general rate', 18, '%', '2017-07-01', { regulation: 'Notification No. 11/2017-Central Tax (Rate), as amended and as reported' }),
  row('gst_monthly_return_due_day', 'Day of the next month by which the monthly return and its tax are due (from memory; in force on the day read)', 20, 'day of the month', READ_ON, { regulation: 'Central Goods and Services Tax Rules, 2017', clause: 'rule 61' }),

  /* --- Tax deducted at source ------------------------------------------ */
  row('tds_property_purchase', 'Tax deducted on buying immovable property', 1, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 3(i) (old section 194-IA)', url: TDS_URL }),
  row('tds_property_threshold', 'Consideration or stamp value from which tax is deducted on buying immovable property', 5_000_000, 'INR', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 3(i) (old section 194-IA)', url: TDS_URL }),
  row('tds_jda_cash', 'Tax deducted on money paid to a landowner under a joint development agreement', 10, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 3(ii) (old section 194-IC)', url: 'https://blog.tdsman.com/2026/05/tds-on-payment-under-joint-development-agreement-section-3931-194ic/' }),
  row('tds_contractor', 'Tax deducted on a payment to a contractor', 1, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 6(i) (old section 194C)', url: TDS_URL }, { when: { payee: 'individual_or_huf' } }),
  row('tds_contractor', 'Tax deducted on a payment to a contractor', 2, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 6(i) (old section 194C)', url: TDS_URL }, { when: { payee: 'other' } }),
  row('tds_contractor_single_threshold', 'Single payment to a contractor above which tax is deducted', 30_000, 'INR', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 6(i) (old section 194C)', url: TDS_URL }),
  row('tds_contractor_year_threshold', 'Payments to a contractor in a year above which tax is deducted', 100_000, 'INR', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1), table serial 6(i) (old section 194C)', url: TDS_URL }),
  row('tds_professional', 'Tax deducted on professional fees (from memory; the table serial is not confirmed)', 10, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1) (old section 194J)' }, { when: { service: 'professional' } }),
  row('tds_professional', 'Tax deducted on fees for technical services (from memory; the table serial is not confirmed)', 2, '%', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1) (old section 194J)' }, { when: { service: 'technical' } }),
  row('tds_professional_threshold', 'Fees in a year above which tax is deducted on professional or technical services (from memory)', 50_000, 'INR', '2026-04-01', { regulation: TDS_2025, clause: 'section 393(1) (old section 194J)' }),
  row('tds_no_pan_rate', 'Tax deducted where the payee gives no permanent account number (from memory)', 20, '%', '2026-04-01', { regulation: TDS_2025, clause: 'old section 206AA; the new section is not confirmed' }),
  row('tds_deposit_due_day', 'Day of the next month by which tax deducted is deposited (from memory)', 7, 'day of the month', '2026-04-01', { regulation: 'Income-tax Rules, as carried under the Income-tax Act, 2025', clause: 'old rule 30' }, { when: { month: 'ordinary' } }),
  row('tds_deposit_due_day', 'Day of the next month by which tax deducted in the last month of the year is deposited (from memory)', 30, 'day of the month', '2026-04-01', { regulation: 'Income-tax Rules, as carried under the Income-tax Act, 2025', clause: 'old rule 30' }, { when: { month: 'year_end' } }),
  row('tds_statement_due_days', 'Days after a quarter ends by which its statement of tax deducted is filed (from memory)', 31, 'days', '2026-04-01', { regulation: 'Income-tax Rules, as carried under the Income-tax Act, 2025', clause: 'old rule 31A' }, { when: { quarter: 'ordinary' } }),
  row('tds_statement_due_days', 'Days after the last quarter of the year ends by which its statement of tax deducted is filed (from memory)', 61, 'days', '2026-04-01', { regulation: 'Income-tax Rules, as carried under the Income-tax Act, 2025', clause: 'old rule 31A' }, { when: { quarter: 'year_end' } }),
  row('stamp_value_tolerance', 'How far a price may fall below the stamp duty value before the difference is taxed', 10, '%', '2026-04-01', { regulation: TDS_2025, clause: 'sections 53, 78 and 92(2)(m) (old sections 43CA, 50C and 56(2)(x))', url: TDS_URL }),

  /* --- Karnataka stamp duty and registration --------------------------- */
  row('ka_stamp_duty_sale', 'Stamp duty on a sale, up to twenty lakh rupees (in force on the day read; earlier days not confirmed)', 2, '%', READ_ON, { ...KA_STAMP, clause: 'Schedule, article 20' }, { jurisdiction: KA, when: { instrument: 'sale_deed', dutiable_value: { min: 0, max: 2_000_001 } } }),
  row('ka_stamp_duty_sale', 'Stamp duty on a sale, twenty-one to forty-five lakh rupees (in force on the day read; earlier days not confirmed)', 3, '%', READ_ON, { ...KA_STAMP, clause: 'Schedule, article 20' }, { jurisdiction: KA, when: { instrument: 'sale_deed', dutiable_value: { min: 2_100_000, max: 4_500_001 } } }),
  row('ka_stamp_duty_sale', 'Stamp duty on a sale, above forty-five lakh rupees (in force on the day read; earlier days not confirmed)', 5, '%', READ_ON, { ...KA_STAMP, clause: 'Schedule, article 20' }, { jurisdiction: KA, when: { instrument: 'sale_deed', dutiable_value: { min: 4_500_001 } } }),
  row('ka_cess', 'Cess on stamp duty (in force on the day read; earlier days not confirmed)', 10, '% of the duty', READ_ON, KA_STAMP, { jurisdiction: KA }),
  row('ka_surcharge', 'Surcharge on stamp duty in an urban area (in force on the day read; earlier days not confirmed)', 2, '% of the duty', READ_ON, KA_STAMP, { jurisdiction: KA, when: { locality: 'urban' } }),
  row('ka_surcharge', 'Surcharge on stamp duty in a rural area (in force on the day read; earlier days not confirmed)', 3, '% of the duty', READ_ON, KA_STAMP, { jurisdiction: KA, when: { locality: 'rural' } }),
  row('ka_registration_fee', 'Registration fee', 2, '%', '2025-08-31', { regulation: 'Registration Act, 1908, Karnataka table of fees, as reported', url: 'https://www.godrejproperties.com/blog/stamp-duty-and-registration-charges-karnataka-2026' }, { jurisdiction: KA }),

  /* --- Welfare cess on construction ------------------------------------ */
  row('bocw_welfare_cess_pct', 'Welfare cess on the cost of construction (from memory; the rate as notified is not confirmed)', 1, '%', '1996-09-26', { regulation: 'Building and Other Construction Workers’ Welfare Cess Act, 1996, and the notification under it', clause: 'section 3(1)' }),

  /* --- Project loans, charges, small suppliers ------------------------- */
  row('rbi_dcco_deferment_max_years', 'Longest the date of commencement of commercial operations may be deferred, for a project that is not infrastructure', 2, 'years', '2025-10-01', RBI),
  row('rbi_cost_overrun_max', 'Largest cost overrun a lender may finance, as a share of the original project cost', 10, '%', '2025-10-01', RBI),
  row('company_charge_filing_days', 'Days from creating a charge within which a company registers it (from memory; in force on the day read)', 30, 'days', READ_ON, { regulation: 'Companies Act, 2013', clause: 'section 77' }),
  row('security_registry_filing_days', 'Days from creating a security interest within which it is filed with the central registry (from memory; in force on the day read)', 30, 'days', READ_ON, { regulation: 'Securitisation and Reconstruction of Financial Assets and Enforcement of Security Interest Act, 2002', clause: 'section 23' }),
  row('small_enterprise_payment_days', 'Days within which a micro or small enterprise is paid (from memory; in force on the day read)', 45, 'days', READ_ON, { regulation: 'Micro, Small and Medium Enterprises Development Act, 2006', clause: 'section 15' }),
];
