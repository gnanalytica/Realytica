/**
 * The tender form: a client's answers read into the Tender terms sheet, and
 * the sheet written back out as the form.
 *
 * Before a tender document is written the consultant sends the client a
 * form of some fifty rows in ten sections. A row asks for an answer and says
 * the form the answer takes ("% of contract value", "yes / no"); the client
 * fills "Client Response", names a paper under "Document Attached", or
 * writes "Not Applicable".
 *
 * Reading one (`loadTenderForm`):
 * - a row is matched to the fields of `procurement.boq.tender_terms` by its
 *   wording (`TENDER_FORM_ROWS`), tolerant of spelling and of numbering;
 * - a filled response is OFFERED as each field's value, with the file, the
 *   sheet and the row as its source, and counts for nothing until a person
 *   accepts it on the field. A value that cannot be read as the field's type
 *   is offered nowhere: the row is said to be unread, for a person to type;
 * - "Not Applicable" is offered as not applicable, and is taken or set aside
 *   by a lead or signer (`decideTenderFormOffer`);
 * - a paper named under "Document Attached" is offered as the field's paper
 *   where a document of that name is on the project;
 * - a row left unanswered is a line of Papers owed, owed by the client and
 *   wanted by the day the form asks for its reply.
 *
 * Writing one (`tenderFormExport`): the same rows in the same columns, each
 * response put together by code from the values that stand on the sheet. A
 * form written here is read back into the same values.
 */

import { validateFieldValue } from './check-fields';
import { CHECKLIST_LIMITS, listDay, loadTrackedList, type ChecklistDraft, type ListLoadReport } from './checklist';
import { optionSetById, type FieldCatalog } from './field-registry';
import { addFieldRecord, decideField, fieldRecords, proposeFieldValues, readSheet, refChoices, type FieldProposal, type FieldWriteOptions } from './field-sheets';
import { TENDER_TERMS } from './field-sets/construction-procurement/tender-terms';
import { fieldCatalogFor } from './firm-fields';
import { partiesByRole } from './project-parties';
import { daySaid } from './said';
import type { CheckFieldDef, CheckFieldValue, DdProject, FieldAddress } from './types';

export { TENDER_TERMS };

const PARTIES = 'shared.parties';
/** The role a consultant named on the form is given on the party record. */
const PARTY_ROLE: Record<string, string> = { client: 'owner', architect: 'architect', structural_consultant: 'structural_consultant', mep_consultant: 'mep_consultant', pmc: 'project_manager' };

const FN = 'procurement.boq';

/* ==================================================================== */
/* The rows of the form                                                  */
/* ==================================================================== */

type Picks = ReadonlyArray<readonly [string, RegExp]>;

/** How a response is read as one field's value. */
type Reader =
  | { as: 'yes_no'; about?: RegExp; lead?: boolean }
  | { as: 'share'; nth?: number; after?: RegExp; last?: boolean }
  | { as: 'money' }
  | { as: 'count'; unit: 'days' | 'months' | 'years' | 'kva'; nth?: number }
  | { as: 'bill' }
  | { as: 'pick'; of: Picks }
  | { as: 'picks'; of: Picks }
  | { as: 'date' }
  | { as: 'party' }
  | { as: 'materials'; part: 'named' | 'rates' | 'wastage' };

interface FormField {
  key: string;
  /** What leads its part of a response where a row answers several fields: "Cap: 5%". */
  tag?: string;
  read: Reader;
}

export interface TenderFormRow {
  no: string;
  item: string;
  details: string;
  fields: FormField[];
  /** The field that holds the paper the row asks for. */
  paper?: string;
}

export interface TenderFormSection {
  no: string;
  title: string;
  rows: TenderFormRow[];
}

const CHARGES: Picks = [
  ['for the contractor to arrange', /contractor to arrange|own arrangement|by (?:the )?contractor|contractor'?s? (?:own|scope)/i],
  ['chargeable', /chargeable|charged|at cost|at actuals?|metered|recover/i],
  ['free', /free|no charge|without charge/i],
];
const INSTRUMENTS: Picks = [
  ['Bank guarantee', /bank guarantee|\bbg\b/i],
  ['Demand draft', /demand draft|\bdd\b/i],
  ['Online transfer', /online|neft|rtgs|transfer/i],
  ['Fixed deposit', /fixed deposit|\bfdr?\b/i],
  ['Insurance surety bond', /surety/i],
];
const BY_WHOM: Picks = [
  ['the contractor', /contractor/i],
  ['the client', /client|employer|owner/i],
];
const consultant = (no: string, item: string, key: string): TenderFormRow => ({ no, item, details: 'Firm, address, contact person, phone and email', fields: [{ key, read: { as: 'party' } }] });
const paperRow = (no: string, item: string, paper: string, details = 'Attach the document'): TenderFormRow => ({ no, item, details, fields: [], paper });

/**
 * The form, row by row: what it asks, the form of the answer, and the field
 * or fields of the Tender terms sheet the answer is. This one table reads
 * the form and writes it.
 */
export const TENDER_FORM_ROWS: readonly TenderFormSection[] = [
  {
    no: '1',
    title: 'Consultant details',
    rows: [
      consultant('1.1', 'Client or owner', 'client'),
      consultant('1.2', 'Architect', 'architect'),
      consultant('1.3', 'Structural consultant', 'structural_consultant'),
      consultant('1.4', 'MEP consultant', 'mep_consultant'),
      consultant('1.5', 'Project management consultant', 'pmc'),
      { no: '1.6', item: 'Other consultants', details: 'Each with its role, firm, address, contact person, phone and email', fields: [] },
    ],
  },
  {
    no: '2',
    title: 'Earnest money deposit',
    rows: [
      { no: '2.1', item: 'Earnest money deposit applicable', details: 'Yes / No', fields: [{ key: 'emd_applies', read: { as: 'yes_no' } }] },
      { no: '2.2', item: 'Amount of earnest money', details: 'Fixed amount, or % of tender value', fields: [{ key: 'emd_amount', tag: 'Amount', read: { as: 'money' } }, { key: 'emd_pct', tag: 'Share of tender value', read: { as: 'share' } }] },
      { no: '2.3', item: 'Mode of earnest money', details: 'Demand draft / bank guarantee / online transfer, and in whose favour', fields: [{ key: 'emd_modes', tag: 'Mode', read: { as: 'picks', of: INSTRUMENTS } }, { key: 'emd_favour', tag: 'In favour of', read: { as: 'party' } }] },
      { no: '2.4', item: 'Validity and refund of earnest money', details: 'Validity in days; refund to unsuccessful bidders within days', fields: [{ key: 'emd_validity_days', tag: 'Valid for', read: { as: 'count', unit: 'days', nth: 0 } }, { key: 'emd_refund_days', tag: 'Refund within', read: { as: 'count', unit: 'days', nth: 1 } }] },
    ],
  },
  {
    no: '3',
    title: 'Mobilisation advance',
    rows: [
      { no: '3.1', item: 'Mobilisation advance applicable', details: 'Yes / No', fields: [{ key: 'advance_applies', read: { as: 'yes_no' } }] },
      { no: '3.2', item: 'Amount of mobilisation advance', details: '% of contract value', fields: [{ key: 'advance_pct', read: { as: 'share' } }] },
      { no: '3.3', item: 'Security for the advance', details: 'Bank guarantee at 100% or 110% of the advance, and by when', fields: [{ key: 'advance_bg_pct', tag: 'Bank guarantee', read: { as: 'share' } }, { key: 'advance_bg_due', tag: 'To be given', read: { as: 'pick', of: [['before the advance is paid', /before|prior|release|paid|payment/i], ['on signing', /sign|agreement|award|acceptance/i]] } }] },
      { no: '3.4', item: 'Interest on the advance', details: 'Interest free, or interest bearing with the rate', fields: [{ key: 'advance_interest', tag: 'Interest', read: { as: 'pick', of: [['interest free', /free|nil|no interest/i], ['interest bearing', /bearing|%|per ?cent|p\.?a\.?|per annum/i]] } }, { key: 'advance_interest_pct', tag: 'Rate', read: { as: 'share' } }] },
      { no: '3.5', item: 'Recovery of the advance', details: 'From which running bill; fully recovered by what % of work done', fields: [{ key: 'recovery_from_bill', tag: 'From running bill', read: { as: 'bill' } }, { key: 'recovered_by_pct', tag: 'Fully recovered by', read: { as: 'share', last: true } }] },
    ],
  },
  {
    no: '4',
    title: 'Materials supplied by the client',
    rows: [
      { no: '4.1', item: 'Materials supplied by the client', details: 'Cement, reinforcement steel, others, or none', fields: [{ key: 'client_materials', read: { as: 'materials', part: 'named' } }] },
      { no: '4.2', item: 'Issue rate of each material', details: 'Rate per unit', fields: [{ key: 'materials', read: { as: 'materials', part: 'rates' } }] },
      { no: '4.3', item: 'Delivery, unloading, storage and custody', details: 'Who delivers, who unloads and stores, and in whose custody', fields: [{ key: 'materials_delivery', tag: 'Delivery', read: { as: 'pick', of: [['collected by the contractor from the client’s store', /collect|from (?:the )?(?:client'?s? )?store|ex.?store/i], ['delivered to site by the client', /deliver|at site|to site/i]] } }, { key: 'materials_unloading', tag: 'Unloading and storage', read: { as: 'pick', of: [['by the contractor', /contractor/i], ['by the client', /client|employer|owner/i]] } }, { key: 'materials_custody', tag: 'Custody', read: { as: 'pick', of: BY_WHOM } }] },
      { no: '4.4', item: 'Wastage allowed and recovery for excess', details: 'Wastage %, and the penal recovery rate for excess consumption', fields: [{ key: 'materials', read: { as: 'materials', part: 'wastage' } }] },
    ],
  },
  {
    no: '5',
    title: 'Water and electricity for construction',
    rows: [
      { no: '5.1', item: 'Water for construction', details: 'Available at site (yes / no), source, and free / chargeable / contractor to arrange', fields: [{ key: 'water_available', tag: 'Available', read: { as: 'yes_no' } }, { key: 'water_source', tag: 'Source', read: { as: 'pick', of: [['borewell', /bore ?well/i], ['tanker', /tanker/i], ['municipal supply', /municipal|corporation|board|mains|piped/i]] } }, { key: 'water_charges', tag: 'Charges', read: { as: 'pick', of: CHARGES } }] },
      { no: '5.2', item: 'Electricity for construction', details: 'Available (yes / no), connection point, sanctioned load, and free / chargeable / contractor to arrange', fields: [{ key: 'power_available', tag: 'Available', read: { as: 'yes_no' } }, { key: 'power_point', tag: 'Connection point', read: { as: 'pick', of: [['at the transformer', /transformer/i], ['at the client’s panel', /panel|\bdb\b|distribution board/i], ['at the site boundary', /boundary|gate|entrance/i]] } }, { key: 'sanctioned_load', tag: 'Sanctioned load', read: { as: 'count', unit: 'kva' } }, { key: 'power_charges', tag: 'Charges', read: { as: 'pick', of: CHARGES } }] },
      // One row, as a consultant's form asks it: is a borewell permitted, and is the contractor to bring a generator.
      { no: '5.3', item: 'Borewell and generator set', details: 'Borewell permitted (yes / no); contractor to provide generator backup (yes / no)', fields: [{ key: 'borewell_permitted', tag: 'Borewell permitted', read: { as: 'yes_no', about: /bore ?well/i, lead: true } }, { key: 'generator_by_contractor', tag: 'Generator backup by the contractor', read: { as: 'yes_no', about: /generator|\bdg\b|genset|back ?up/i } }] },
    ],
  },
  {
    no: '6',
    title: 'Retention money',
    rows: [
      { no: '6.1', item: 'Retention from each running bill', details: '% of each running bill', fields: [{ key: 'retention_pct', read: { as: 'share' } }] },
      { no: '6.2', item: 'Cap on retention', details: '% of contract value or of executed value', fields: [{ key: 'retention_cap_pct', tag: 'Cap', read: { as: 'share' } }, { key: 'retention_cap_of', tag: 'Of the', read: { as: 'pick', of: [['executed value', /executed|work done|certified/i], ['contract value', /contract/i]] } }] },
      { no: '6.3', item: 'Release of retention', details: '% on completion; the balance after the defects liability period', fields: [{ key: 'release_on_completion_pct', tag: 'On completion', read: { as: 'share' } }] },
      { no: '6.4', item: 'Release of retention against a bank guarantee', details: 'Yes / No', fields: [{ key: 'retention_against_bg', read: { as: 'yes_no' } }] },
      { no: '6.5', item: 'Security deposit or performance guarantee', details: '% of contract value, its form and its validity', fields: [{ key: 'performance_pct', tag: 'Security', read: { as: 'share' } }, { key: 'performance_form', tag: 'Form', read: { as: 'pick', of: INSTRUMENTS } }, { key: 'performance_valid_months', tag: 'Valid for', read: { as: 'count', unit: 'months' } }] },
    ],
  },
  {
    no: '7',
    title: 'Type of contract',
    rows: [
      { no: '7.1', item: 'Type of contract', details: 'Item rate / lump sum / re-measurable / design and build', fields: [{ key: 'contract_type', read: { as: 'pick', of: [['design and build', /design/i], ['re-measurable', /re.?measur/i], ['lump sum', /lump/i], ['item rate', /item/i]] } }] },
      { no: '7.2', item: 'Price basis', details: 'Firm, or escalation with a formula or indices', fields: [{ key: 'price_basis', tag: 'Basis', read: { as: 'pick', of: [['firm', /^\s*(?:firm|fixed)\b/i], ['escalation by indices', /indic|index|\bwpi\b|\bcpi\b/i], ['escalation by formula', /formula|escalat|variation/i], ['firm', /firm|fixed/i]] } }, { key: 'escalation_cap_pct', tag: 'Escalation at most', read: { as: 'share', after: /cap|max|most|limit|exceed/i } }] },
      { no: '7.3', item: 'Contract period and expected start', details: 'Period in months, and the expected date of start', fields: [{ key: 'contract_months', tag: 'Period', read: { as: 'count', unit: 'months' } }, { key: 'expected_start', tag: 'Start', read: { as: 'date' } }] },
      { no: '7.4', item: 'Defects liability period', details: 'Months', fields: [{ key: 'defects_months', read: { as: 'count', unit: 'months' } }] },
      { no: '7.5', item: 'Liquidated damages', details: 'Rate per week or per day, and the cap as %', fields: [{ key: 'damages_rate_pct', tag: 'Rate', read: { as: 'share', nth: 0 } }, { key: 'damages_per', tag: 'For each', read: { as: 'pick', of: [['day', /\bday|daily|per diem/i], ['week', /week/i]] } }, { key: 'damages_cap_pct', tag: 'Cap', read: { as: 'share', after: /cap|max|most|limit|exceed|subject to/i, nth: 1 } }] },
      { no: '7.6', item: 'Payment terms', details: 'Billing frequency, minimum bill value, and the certification and payment periods in days', fields: [{ key: 'billing_frequency', tag: 'Bills', read: { as: 'pick', of: [['fortnightly', /fortnight|bi.?weekly/i], ['by milestone', /milestone|stage/i], ['monthly', /month/i]] } }, { key: 'min_bill_value', tag: 'Smallest bill', read: { as: 'money' } }, { key: 'certify_days', tag: 'Certified within', read: { as: 'count', unit: 'days', nth: 0 } }, { key: 'pay_days', tag: 'Paid within', read: { as: 'count', unit: 'days', nth: 1 } }] },
    ],
  },
  {
    no: '8',
    title: 'Approved makes',
    rows: [
      paperRow('8.1', 'List of approved makes', 'approved_makes', 'The client’s list for all materials'),
      { no: '8.2', item: 'Equivalent makes', details: 'Whether permitted (yes / no), and who approves an equivalent', fields: [{ key: 'equivalents_permitted', tag: 'Permitted', read: { as: 'yes_no' } }, { key: 'equivalents_approved_by', tag: 'Approved by', read: { as: 'pick', of: [['the architect', /architect/i], ['the project management consultant', /\bpmc\b|project manage/i], ['the client', /client|employer|owner/i]] } }] },
    ],
  },
  {
    no: '9',
    title: 'Bank guarantee formats',
    rows: [
      paperRow('9.1', 'Bank guarantee format for earnest money', 'bg_format_emd'),
      paperRow('9.2', 'Bank guarantee format for mobilisation advance', 'bg_format_advance'),
      paperRow('9.3', 'Bank guarantee format for security deposit or performance', 'bg_format_performance'),
      { no: '9.4', item: 'Acceptable banks', details: 'Nationalised / scheduled commercial / the client’s own list', fields: [{ key: 'acceptable_banks', read: { as: 'pick', of: [['banks on the client’s list', /list|approved|panel|enclosed|attached/i], ['nationalised banks', /nationali[sz]ed|public sector/i], ['scheduled commercial banks', /scheduled|commercial/i]] } }] },
    ],
  },
  {
    no: '10',
    title: 'Appendices',
    rows: [
      paperRow('10.1', 'Technical specifications', 'specifications'),
      paperRow('10.2', 'Schedule of quantities', 'schedule_of_quantities'),
      paperRow('10.3', 'Tender drawings', 'tender_drawings', 'With the drawing list and revisions'),
      paperRow('10.4', 'Advance payment guarantee specimen', 'bg_format_advance'),
      { no: '10.5', item: 'Insurance requirements', details: 'Policies, sums insured, and whether by the client or the contractor', fields: [{ key: 'insurances_required', tag: 'Policies', read: { as: 'picks', of: [['Contractor’s all risk', /\bcar\b|all risks?/i], ['Workmen’s compensation', /workm[ea]n|\bwc\b|employee/i], ['Third party liability', /third party|\btpl\b/i], ['Plant and machinery', /plant|machinery/i], ['Professional indemnity', /professional|indemnity/i]] } }, { key: 'insurance_by', tag: 'By', read: { as: 'pick', of: [['the contractor', /by (?:the )?contractor|contractor to|contractor'?s? (?:scope|account)|^the contractor$/i], ['the client', /by (?:the )?(?:client|employer|owner)|(?:client|employer|owner) to|^the client$/i]] } }] },
      { no: '10.6', item: 'Warranty requirements', details: 'The items under warranty and the period', fields: [{ key: 'warranty_items', tag: 'Items', read: { as: 'picks', of: [['waterproofing', /water ?proof/i], ['façade', /fa[cç]ade|glazing|cladding/i], ['lifts', /lift|elevator/i], ['MEP equipment', /\bmep\b|equipment|hvac|pump|\bdg\b/i], ['doors and windows', /door|window/i], ['roofing', /\broof/i]] } }, { key: 'warranty_years', tag: 'Period', read: { as: 'count', unit: 'years' } }] },
      paperRow('10.7', 'Warranty format', 'warranty_format'),
      paperRow('10.8', 'Basic price list', 'basic_prices', 'Materials with their basic rates, excluding tax'),
      paperRow('10.9', 'Day work rates', 'day_work_rates'),
      paperRow('10.10', 'Soil investigation report', 'soil_report'),
      paperRow('10.11', 'Health and safety manual', 'hs_manual'),
    ],
  },
];

export const TENDER_FORM_TITLE = 'Information and documents required from the client for preparation of the tender document';
export const TENDER_FORM_COLUMNS = ['S.No', 'Information / Document Required', 'Details to be Provided', 'Client Response', 'Document Attached', 'Remarks'] as const;
const NOT_APPLICABLE = 'Not Applicable';
const FOOTER = 'Mark "Not Applicable" where an item does not apply.';

/* ==================================================================== */
/* Reading the sheet                                                     */
/* ==================================================================== */

export interface TenderFormRead {
  sheet: string;
  header: { project?: string; client?: string; package?: string; issuedBy?: string; issuedOn?: string; responseBy?: string };
  footer: { name?: string; designation?: string; date?: string };
  /** Each item row as written, with its row number on the sheet. */
  rows: Array<{ row: number; no: string; item: string; details: string; response: string; attached: string; remarks: string; section?: string }>;
}

type FormColumn = 'no' | 'item' | 'details' | 'response' | 'attached' | 'remarks';

const flat = (cell: unknown): string => String(cell ?? '').replace(/\s+/g, ' ').trim();
const words = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function formColumns(row: readonly string[]): Partial<Record<FormColumn, number>> | undefined {
  const found: Partial<Record<FormColumn, number>> = {};
  row.forEach((cell, n) => {
    const name = words(cell);
    if (!name) return;
    const key: FormColumn | undefined =
      found.details === undefined && /details? to be provided|details? required|form of (?:the )?answer/.test(name)
        ? 'details'
        : found.response === undefined && /response|reply|answer/.test(name)
          ? 'response'
          : found.attached === undefined && /attach|enclos/.test(name)
            ? 'attached'
            : found.remarks === undefined && /^remarks?$|^notes?$|^comments?$/.test(name)
              ? 'remarks'
              : found.no === undefined && /^(?:s|sl|sr|serial)? ?(?:no|number)$|^item no$|^ref(?: no)?$/.test(name)
                ? 'no'
                : found.item === undefined && /information|document required|description|particulars|^item$/.test(name)
                  ? 'item'
                  : undefined;
    if (key) found[key] = n;
  });
  return found.details !== undefined && found.response !== undefined && found.item !== undefined ? found : undefined;
}

const HEADER_LINES: Array<[keyof TenderFormRead['header'], RegExp]> = [
  ['responseBy', /^(?:response|reply) (?:required )?by|^required by|^due by/],
  ['issuedOn', /^date of issue|^issued on|^date issued|^issue date/],
  ['issuedBy', /^issued by|^from$/],
  ['package', /^(?:work )?package|^tender$/],
  ['client', /^client|^owner|^employer/],
  ['project', /^project/],
];
const FOOTER_LINES: Array<[keyof TenderFormRead['footer'], RegExp]> = [
  ['designation', /designation|title/],
  ['date', /^date/],
  ['name', /name/],
];

/** "Label: value" in one cell, or a label in one cell and its value in the next. */
function labelled<K extends string>(row: readonly string[], lines: ReadonlyArray<[K, RegExp]>, into: Partial<Record<K, string>>): void {
  const cells = row.map(flat);
  cells.forEach((cell, n) => {
    const split = /^([^:]{2,60}):\s*(.*)$/.exec(cell);
    const name = words(split ? split[1]! : cell);
    const hit = lines.find(([key, says]) => into[key] === undefined && says.test(name));
    if (!hit) return;
    const value = split?.[2] || cells.slice(n + 1).find(Boolean) || '';
    if (value && !lines.some(([, says]) => says.test(words(value.replace(/:.*$/, ''))))) into[hit[0]] = value;
  });
}

/**
 * The rows of one sheet as a tender form, or nothing where no row heads one:
 * a form is known by its "Details to be Provided" and "Client Response"
 * columns. The lines above the table name the project, the client, the
 * package and the days; a row with no details and no response is a section.
 */
export function parseTenderFormRows(table: readonly (readonly string[])[], sheet = 'Sheet1'): TenderFormRead | undefined {
  const rows = table.map((r) => r.map(flat));
  const headAt = rows.slice(0, 30).findIndex((r) => formColumns(r));
  if (headAt < 0) return undefined;
  const columns = formColumns(rows[headAt]!)!;
  const read: TenderFormRead = { sheet, header: {}, footer: {}, rows: [] };
  for (const row of rows.slice(0, headAt)) labelled(row, HEADER_LINES, read.header);
  const at = (row: readonly string[], key: FormColumn): string => (columns[key] === undefined ? '' : (row[columns[key]!] ?? ''));
  let section: string | undefined;
  let ended = false;
  rows.slice(headAt + 1).forEach((row, n) => {
    if (!row.some(Boolean)) return;
    const written = [...new Set(row.filter(Boolean))];
    const [no, item, details, response, attached, remarks] = [at(row, 'no'), at(row, 'item'), at(row, 'details'), at(row, 'response'), at(row, 'attached'), at(row, 'remarks')];
    // The signature block and the instruction under the table.
    if (ended || /signature|^name\b|designation|not applicable.*where|where an item does not apply/i.test(written.join(' ')) && !details) {
      ended = true;
      labelled(row, FOOTER_LINES, read.footer);
      return;
    }
    // A section: one text beside its number, in one cell or merged across the sheet.
    const beside = written.filter((cell) => cell !== no);
    if (beside.length <= 1 || (!details && !response && !attached)) {
      section = (item || written.find((cell) => cell !== no) || written[0]!).replace(/^\d+[.)]?\s+/, '');
      return;
    }
    if (!item) return;
    read.rows.push({ row: headAt + 2 + n, no, item, details, response, attached, remarks, ...(section ? { section } : {}) });
  });
  return read.rows.length ? read : undefined;
}

/** A workbook's first sheet that is a tender form. */
export function parseTenderFormSheets(sheets: ReadonlyArray<{ name: string; rows: readonly (readonly string[])[] }>): TenderFormRead | undefined {
  for (const sheet of sheets) {
    const read = parseTenderFormRows(sheet.rows, sheet.name);
    if (read) return read;
  }
  return undefined;
}

/* ==================================================================== */
/* A row by its wording                                                  */
/* ==================================================================== */

const STOP = new Set(['of', 'the', 'and', 'or', 'for', 'to', 'by', 'a', 'an', 'in', 'at', 'on', 'with', 'be', 'is', 'are', 'from', 'each', 'its', 'if', 'any']);
/** What a form shortens, written out, so "EMD applicable" is read as the row it is. */
const SHORT: Record<string, string> = { emd: 'earnest money deposit', bg: 'bank guarantee', pbg: 'performance bank guarantee', dlp: 'defects liability period', ld: 'liquidated damages', ra: 'running', sd: 'security deposit', boq: 'schedule quantities', pmc: 'project management consultant', hse: 'health safety', ehs: 'health safety' };
const tokens = (text: string): string[] =>
  words(text)
    .split(' ')
    .flatMap((w) => (SHORT[w] ?? w).split(' '))
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/s$/, '') : w));

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, n) => n);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(prev[j]! + 1, next[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length]!;
}

const alike = (a: string, b: string): boolean => a === b || (a.length >= 5 && b.length >= 5 && distance(a, b) <= (a.length >= 9 ? 2 : 1));

/** How alike two wordings are, 0 to 1: the share of their words that pair up, a letter or two apart allowed. */
export function wordingAlike(a: string, b: string): number {
  const [left, right] = [tokens(a), tokens(b)];
  if (!left.length || !right.length) return 0;
  const free = [...right];
  let paired = 0;
  for (const word of left) {
    const hit = free.findIndex((other) => alike(word, other));
    if (hit < 0) continue;
    free.splice(hit, 1);
    paired += 1;
  }
  return (2 * paired) / (left.length + right.length);
}

/**
 * The row of the form a written row is: the best by wording, helped by its
 * section and its number where they agree. A row whose wording is not near
 * any is left unmatched, and said.
 */
export function tenderFormRowFor(row: { no: string; item: string; section?: string; details?: string }, taken: ReadonlySet<string> = new Set()): TenderFormRow | undefined {
  const best = rowScores(row)
    .filter((held) => !taken.has(held.row.no))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= ROW_MATCH ? best.row : undefined;
}

const ROW_MATCH = 0.6;

/** The kinds of answer a row's own "details" ask for, read from its words: a yes or no, a percentage, a period. */
function kindsAsked(details: string | undefined): Array<'yes_no' | 'share' | 'count'> {
  const said = details ?? '';
  return [/\byes\s*\/\s*no\b/i.test(said) ? ('yes_no' as const) : undefined, /%|per ?cent/i.test(said) ? ('share' as const) : undefined, /\b(?:months?|days?|years?|period)\b/i.test(said) ? ('count' as const) : undefined].filter((kind): kind is 'yes_no' | 'share' | 'count' => kind !== undefined);
}

/**
 * How well each row of the table answers to a written row.
 *
 * A consultant writes a row in as few words as its section allows: under
 * the retention's heading the rows are "Retention rate" and "Ceiling", and
 * under the advance's one is "Interest". Read by its words alone
 * such a row is its neighbour's or nobody's. So a row is known by three
 * things together: its wording, with its "details" beside it; its section;
 * and its number within that section, which counts for most where the
 * section is the table's own. A row whose details ask for a kind of answer
 * none of a candidate's fields takes (a yes or no, a percentage, a period)
 * is held to be less likely that candidate.
 */
function rowScores(row: { no: string; item: string; section?: string; details?: string }): Array<{ row: TenderFormRow; score: number }> {
  const section = row.section ? TENDER_FORM_ROWS.map((s) => ({ s, score: wordingAlike(row.section!, s.title) })).sort((a, b) => b.score - a.score)[0] : undefined;
  const asked = kindsAsked(row.details);
  const no = row.no.replace(/[.)]+$/, '');
  const out: Array<{ row: TenderFormRow; score: number }> = [];
  for (const held of TENDER_FORM_ROWS) {
    const inSection = Boolean(section && section.score >= 0.5 && section.s === held);
    for (const candidate of held.rows) {
      const wording = Math.max(wordingAlike(row.item, candidate.item), row.details ? wordingAlike(`${row.item} ${row.details}`, `${candidate.item} ${candidate.details}`) * 0.9 : 0);
      const kinds = new Set(candidate.fields.map((field) => field.read.as));
      const wrongKind = asked.length > 0 && candidate.fields.length > 0 && !asked.some((kind) => kinds.has(kind));
      const score = wording + (inSection ? 0.25 : 0) + (no === candidate.no ? (inSection ? 0.45 : 0.15) : 0) - (wrongKind ? 0.35 : 0);
      out.push({ row: candidate, score });
    }
  }
  return out;
}

/**
 * The rows of the table that the written rows of one form are, all at once:
 * the surest pair is settled first, so a row that is plainly one of the
 * table's is never taken by a vaguer one written above it. A written row
 * that is near none is left unmatched, in its place.
 */
export function tenderFormRowsFor(rows: ReadonlyArray<{ no: string; item: string; section?: string; details?: string }>): Array<TenderFormRow | undefined> {
  const pairs = rows.flatMap((row, at) => rowScores(row).filter((held) => held.score >= ROW_MATCH).map((held) => ({ at, ...held })));
  pairs.sort((a, b) => b.score - a.score || a.at - b.at);
  const out: Array<TenderFormRow | undefined> = rows.map(() => undefined);
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (out[pair.at] || taken.has(pair.row.no)) continue;
    out[pair.at] = pair.row;
    taken.add(pair.row.no);
  }
  return out;
}

/* ==================================================================== */
/* A response as a value                                                 */
/* ==================================================================== */

const SHARE = /(\d+(?:\.\d+)?)\s*(?:%|per ?cent\b|percent\b)/gi;
const MONEY = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?)?|([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?)/gi;
const UNIT = { days: /(\d+(?:\.\d+)?)\s*(?:calendar |working )?days?\b/gi, months: /(\d+(?:\.\d+)?)\s*(?:calendar )?months?\b/gi, years: /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/gi, kva: /(\d[\d,]*(?:\.\d+)?)\s*k(?:va|w)\b/gi } as const;
const DAY_WRITTEN = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/g;

const all = (text: string, says: RegExp): RegExpMatchArray[] => [...text.matchAll(new RegExp(says.source, says.flags))];
const figure = (text: string): number => Number(text.replace(/,/g, ''));

function moneyIn(text: string): number[] {
  return all(text, MONEY).map((hit) => {
    const scale = (hit[2] ?? hit[4] ?? '').toLowerCase();
    return figure(hit[1] ?? hit[3]!) * (scale.startsWith('c') ? 10_000_000 : scale.startsWith('l') ? 100_000 : 1);
  });
}

const MATERIALS: Picks = [
  ['cement', /cement/i],
  ['reinforcement steel', /reinforc|rebar|\btmt\b|(?<!structural )steel/i],
  ['structural steel', /structural steel/i],
  ['other', /other/i],
];
const MATERIAL_UNITS: Picks = [
  ['bag', /\bbags?\b/i],
  ['tonne', /tonnes?|\bmt\b|\bton\b/i],
  ['cubic metre', /cubic|cu\.? ?m|\bcum\b|m3/i],
  ['number', /\bnos?\b|number|each/i],
];

type MaterialRow = { material: string; unit?: string; issue_rate?: number; wastage_pct?: number; penal_rate?: number };

/** What a response says of each material, a part to a material: "Cement: Rs. 380 per bag; steel: Rs. 62,000 per tonne". */
function materialsIn(text: string, part: 'named' | 'rates' | 'wastage'): MaterialRow[] {
  const out: MaterialRow[] = [];
  // One part to a material where the response is written that way; else the whole of it for each material it names.
  const parts = text.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean);
  const apart = parts.filter((p) => MATERIALS.some(([, says]) => says.test(p))).length > 1 ? parts : part === 'named' ? text.split(/[;,\n]+| and /) : [text];
  for (const said of apart) {
    for (const [material, says] of MATERIALS) {
      if (!says.test(said) || out.some((row) => row.material === material)) continue;
      const monies = moneyIn(said);
      const shares = all(said, SHARE).map((hit) => Number(hit[1]));
      const unit = MATERIAL_UNITS.find(([, unitSays]) => unitSays.test(said))?.[0];
      out.push({
        material,
        ...(part === 'rates' && unit ? { unit } : {}),
        ...(part === 'rates' && monies[0] !== undefined ? { issue_rate: monies[0] } : {}),
        ...(part === 'wastage' && shares[0] !== undefined ? { wastage_pct: shares[0] } : {}),
        ...(part === 'wastage' && monies[0] !== undefined ? { penal_rate: monies[0] } : {}),
      });
    }
  }
  return out;
}

/** The part of a response that is one field's: what follows its tag, where the response is written in tagged parts. */
function partFor(response: string, field: FormField): { text: string; tagged: boolean } {
  if (field.tag) {
    for (const part of response.split(/[;\n]+/)) {
      const hit = new RegExp(`^\\s*${field.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`, 'i').exec(part);
      if (hit) return { text: hit[1]!.trim(), tagged: true };
    }
  }
  return { text: response, tagged: false };
}

/** One field's value as a response states it, or nothing where it cannot be read as the field's type. */
function valueFor(project: DdProject, catalog: FieldCatalog, response: string, field: FormField): unknown {
  const { text, tagged } = partFor(response, field);
  if (!text) return undefined;
  const read = field.read;
  switch (read.as) {
    case 'yes_no': {
      const plain = (said: string): boolean | undefined => (/^(?:yes|y|applicable|permitted|allowed|available|required|provided)\b/i.test(said) ? true : /^(?:no|n|not|nil|none)\b/i.test(said) ? false : undefined);
      if (!read.about || tagged) return plain(text);
      // One row that asks two things: each answer is the part of the response that speaks of it.
      const parts = text.split(/[;.?\n]+|,\s+(?=[A-Za-z])/).map((part) => part.trim()).filter(Boolean);
      const part = parts.find((held) => read.about!.test(held));
      if (!part) return read.lead ? plain(text) : undefined;
      if (/\b(?:no|not|nil|none|never)\b/i.test(part)) return false;
      return /\b(?:yes|permitted|allowed|applicable|required|provided?|to (?:provide|bring|arrange|supply|install)|shall|will|by (?:the )?contractor)\b/i.test(part) ? true : plain(part.replace(read.about, '').replace(/^[\s:–—-]+/, ''));
    }
    case 'share': {
      const shares = all(text, SHARE);
      if (tagged && !shares.length && /^\d+(?:\.\d+)?$/.test(text)) return Number(text);
      if (read.after) {
        const from = text.search(read.after);
        const later = from >= 0 ? all(text.slice(from), SHARE)[0] : undefined;
        if (later) return Number(later[1]);
        if (!tagged && read.nth === undefined) return undefined;
      }
      const hit = read.last ? shares.at(-1) : shares[tagged ? 0 : (read.nth ?? 0)];
      return hit ? Number(hit[1]) : undefined;
    }
    case 'money':
      return moneyIn(text)[0] ?? (tagged && /^[\d,]+(?:\.\d+)?$/.test(text) ? figure(text) : undefined);
    case 'count': {
      const hits = all(text, UNIT[read.unit]);
      const hit = hits[tagged ? 0 : (read.nth ?? 0)];
      if (hit) return figure(hit[1]!);
      // A period in months that is written in years.
      if (read.unit === 'months') {
        const years = all(text, UNIT.years)[0];
        if (years) return figure(years[1]!) * 12;
      }
      return tagged && /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : undefined;
    }
    case 'bill': {
      const hit = /(\d+)(?:st|nd|rd|th)?\s*(?:running|r\.?\s?a\.?|interim)?\s*(?:account\s*)?bill|bill\s*(?:no\.?|number)?\s*(\d+)/i.exec(text) ?? (tagged ? /^(\d+)$/.exec(text) : null);
      if (hit) return Number(hit[1] ?? hit[2]);
      const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'].findIndex((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
      return ordinal >= 0 ? ordinal + 1 : undefined;
    }
    case 'pick':
      return read.of.find(([, says]) => says.test(text))?.[0];
    case 'picks': {
      const picked = read.of.filter(([, says]) => says.test(text)).map(([value]) => value);
      return picked.length ? picked : undefined;
    }
    case 'date':
      return all(text, DAY_WRITTEN).map((hit) => listDay(hit[0])).find(Boolean);
    case 'party': {
      // The one party on the project the response names: the longest name it opens with, else the one name found in it.
      const said = words(text.replace(/^(?:in\s+)?favou?r of\s+/i, ''));
      const named = refChoices(project, 'party', catalog)
        .map((choice) => ({ ...choice, name: words(choice.label.split(',')[0]!) }))
        .filter((choice) => choice.name.length >= 3 && said.includes(choice.name))
        .sort((a, b) => Number(said.startsWith(b.name)) - Number(said.startsWith(a.name)) || b.name.length - a.name.length);
      return named.length === 1 || (named[0] && said.startsWith(named[0].name)) ? named[0]!.id : undefined;
    }
    case 'materials':
      return undefined;
  }
}

const isNotApplicable = (text: string): boolean => /^(?:n\.?\s?\/?\s?a\.?|not applicable|not app?licable)\.?$/i.test(text.trim());

/* ==================================================================== */
/* Loading a form                                                        */
/* ==================================================================== */

/** The fields of the Tender terms sheet a row of the form asks for: its answers, and the paper it names. */
function rowFields(row: TenderFormRow): string[] {
  return [...row.fields.map((field) => field.key), ...(row.paper ? [row.paper] : [])].filter((key, n, keys) => keys.indexOf(key) === n);
}

/** A row a client marked "Not Applicable": offered, and taken or set aside by a person. */
export interface TenderFormOffer {
  id: string;
  no: string;
  item: string;
  row: number;
  /** The fields the row answers. */
  fields: string[];
}

/** A tender form that was loaded: the record it fills, where it came from, and what still waits on a person. */
export interface TenderFormLoaded {
  id: string;
  /** The Papers owed list its unanswered rows are lines of. */
  list: string;
  record: string;
  file: string;
  sheet: string;
  package?: string;
  client?: string;
  responseBy?: string;
  loadedAt: string;
  by: string;
  notApplicable: TenderFormOffer[];
}

export interface TenderFormReport {
  list: string;
  /** The Tender terms record it fills. Absent on a dry run that would make one. */
  record?: string;
  rows: number;
  /** Values offered and waiting to be accepted, and values the sheet already holds. */
  offered: number;
  held: number;
  /** Rows marked not applicable, offered for a person to take. */
  notApplicable: number;
  /** Rows left unanswered: lines of Papers owed. */
  unanswered: number;
  /** Rows answered in words that could not be read as the field's type: for a person to type. */
  unread: Array<{ no: string; item: string; response: string }>;
  /** Rows whose wording is none of the form's. */
  unmatched: Array<{ no: string; item: string }>;
  refused: Array<{ no: string; item: string; error: string }>;
  /** Consultants the form names that are not parties on the project yet: each offered as a new party, to be accepted on Parties. Read the form again once they are, and its rows link to them. */
  parties: string[];
  owed: ListLoadReport;
}

const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Whether a document on the project is the paper a row names: its title or a file's name, less the extension. */
function documentNamed(project: DdProject, name: string): string | undefined {
  const bare = (text: string | undefined) => words((text ?? '').replace(/\.[a-z0-9]{1,5}$/i, ''));
  const wanted = bare(name);
  if (wanted.length < 3) return undefined;
  const hits = project.evidence.filter((e) => !e.supersededById && [e.title, e.fileName, ...e.attachments.map((a) => a.fileName)].some((held) => bare(held) === wanted));
  return hits.length === 1 ? hits[0]!.id : undefined;
}

/**
 * Load a tender form onto the project.
 *
 * `record` names the Tender terms record it fills; without one it fills the
 * record an earlier copy of the same form filled, else a new one, which is
 * nothing until a person accepts one of its values. With `dryRun` nothing is
 * changed and the report says what would be.
 */
export function loadTenderForm(
  project: DdProject,
  read: TenderFormRead,
  input: { file: string; record?: string; actor: string; dryRun?: boolean; today?: string; load?: string },
  catalog: FieldCatalog = fieldCatalogFor(project),
): TenderFormReport {
  if (input.dryRun) return loadTenderForm(JSON.parse(JSON.stringify(project)) as DdProject, read, { ...input, dryRun: false }, catalog);
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const file = flat(input.file).slice(0, 60) || 'Tender form';
  const pack = read.header.package ? flat(read.header.package).slice(0, 80) : undefined;
  const list = `Tender terms: ${pack ?? file}`.slice(0, CHECKLIST_LIMITS.label);
  const earlier = (project.tenderForms ?? []).find((held) => held.list.toLowerCase() === list.toLowerCase());
  const records = fieldRecords(project, TENDER_TERMS);
  let record = [input.record, earlier?.record].find((id) => id && records.some((held) => held.id === id));
  const cite = (row: number, quote: string) => ({ kind: 'external' as const, source: `${file} · ${read.sheet} · row ${row}`, asOf: today, quote: quote.slice(0, 200) });
  const address = (field: string): FieldAddress => ({ fn: FN, set: TENDER_TERMS, field, ...(record ? { record } : {}) });
  const report: TenderFormReport = { list, rows: read.rows.length, offered: 0, held: 0, notApplicable: 0, unanswered: 0, unread: [], unmatched: [], refused: [], parties: [], owed: { list, added: [], becameReceived: [], becamePartial: [], becameAssumed: [], reopened: [], gone: [], updated: 0, unchanged: 0 } };

  const proposals: Array<FieldProposal & { no: string; item: string }> = [];
  const offers: TenderFormOffer[] = [];
  const drafts: ChecklistDraft[] = [];
  const materials = new Map<string, MaterialRow>();
  let materialsRow: { row: number; quote: string; no: string; item: string } | undefined;
  const taken = new Set<string>();
  const newParties: Array<{ name: string; role: string; row: number; quote: string }> = [];
  const offer = (no: string, item: string, field: string, value: unknown, row: number, quote: string) => proposals.push({ address: address(field), value, origin: cite(row, quote), no, item });

  // The lines above the table are answers too: the package, the days, and the client where it is a party on the project.
  const top = 1;
  const packageId = pack ? refChoices(project, 'package', catalog).find((choice) => words(choice.label) === words(pack) || words(choice.label).endsWith(` ${words(pack)}`))?.id : undefined;
  if (packageId) offer('', 'Package', 'package', packageId, top, pack!);
  for (const [field, written] of [['issued_on', read.header.issuedOn], ['response_by', read.header.responseBy], ['answered_on', read.footer.date]] as const) {
    const day = listDay(written);
    if (day) offer('', field, field, day, top, written!);
  }
  const responseBy = listDay(read.header.responseBy);

  // Who owes an unanswered row: the client. Where People names one owner, that party, so the lines are theirs by the name every other list uses; else the client as the form writes it.
  const owners = partiesByRole(project).groups.find((group) => group.key === 'owner')?.parties ?? [];
  const client = owners.length === 1 ? owners[0]!.name : read.header.client ? flat(read.header.client) : 'Client';
  const matched = tenderFormRowsFor(read.rows);
  for (const [n, written] of read.rows.entries()) {
    const form = matched[n];
    if (!form) {
      report.unmatched.push({ no: written.no, item: written.item });
      continue;
    }
    taken.add(form.no);
    const section = TENDER_FORM_ROWS.find((held) => held.rows.includes(form))!;
    const response = written.response;
    const answered = Boolean(response || written.attached);
    drafts.push({
      title: form.item,
      list,
      ref: form.no,
      order: drafts.length,
      headings: [{ ref: section.no, title: section.title }],
      fn: FN,
      ...(pack ? { package: pack } : {}),
      owedBy: client,
      round: 'Tender form',
      ...(responseBy ? { targetDate: responseBy } : {}),
      status: answered ? 'received' : 'pending',
      ...(answered ? { remark: response || `Attached: ${written.attached}` } : {}),
      // The fields the row asks for: a value that stands on any of them, typed on the sheet or accepted from a form, answers the line.
      answers: { set: TENDER_TERMS, fields: rowFields(form) },
    });
    if (!answered) {
      report.unanswered += 1;
      continue;
    }
    if (isNotApplicable(response)) {
      const fields = [...form.fields.map((field) => field.key), ...(form.paper ? [form.paper] : [])].filter((key, n, keys) => keys.indexOf(key) === n);
      if (fields.length) offers.push({ id: newId('tfo'), no: form.no, item: form.item, row: written.row, fields });
      report.notApplicable += 1;
      continue;
    }
    let read_ = 0;
    for (const field of form.fields) {
      if (field.read.as === 'materials') {
        const rows = materialsIn(response, field.read.part);
        if (field.read.part === 'named') {
          const none = /^(?:none|nil|no)\b/i.test(response.trim());
          if (none || rows.length) offer(form.no, form.item, 'client_materials', !none, written.row, response);
          materialsRow = { row: written.row, quote: response, no: form.no, item: form.item };
        }
        for (const row of rows) materials.set(row.material, { ...(materials.get(row.material) ?? {}), ...row });
        if (rows.length || field.read.part === 'named') read_ += 1;
        continue;
      }
      const value = valueFor(project, catalog, response, field);
      // A consultant the project has no party for: the firm is offered as a new party, with the role the row gives it.
      if (value === undefined && field.read.as === 'party' && PARTY_ROLE[field.key]) {
        const name = flat(response.split(/[,;\n]/)[0] ?? '').slice(0, 120);
        if (name.length >= 3) {
          newParties.push({ name, role: PARTY_ROLE[field.key]!, row: written.row, quote: response });
          read_ += 1;
        }
        continue;
      }
      if (value === undefined) continue;
      offer(form.no, form.item, field.key, value, written.row, response);
      read_ += 1;
    }
    // Which of the two an amount of earnest money is, is said by how it was written.
    if (form.no === '2.2' && read_) {
      const share = proposals.some((p) => p.no === '2.2' && p.address.field === 'emd_pct');
      const kept = proposals.filter((p) => !(p.no === '2.2' && p.address.field === (share ? 'emd_amount' : 'emd_pct')));
      proposals.length = 0;
      proposals.push(...kept);
      offer(form.no, form.item, 'emd_basis', share ? 'share of the tender value' : 'fixed amount', written.row, response);
    }
    if (form.paper && written.attached) {
      const evidenceId = documentNamed(project, written.attached);
      if (evidenceId) {
        offer(form.no, form.item, form.paper, [evidenceId], written.row, written.attached);
        read_ += 1;
      } else {
        // Named and not on file: the paper is still owed, and its own name will answer the line once it is filed.
        const line = drafts.at(-1)!;
        line.status = 'pending';
        line.title = flat(written.attached).slice(0, CHECKLIST_LIMITS.title);
        line.remark = `Named on the form as attached, for ${form.item.toLowerCase()}`;
        read_ += 1;
      }
    }
    if (!read_ && form.fields.length + (form.paper ? 1 : 0) > 0) report.unread.push({ no: form.no, item: form.item, response: (response || written.attached).slice(0, 200) });
    if (!form.fields.length && !form.paper && response) report.unread.push({ no: form.no, item: form.item, response: response.slice(0, 200) });
  }
  if (materialsRow && materials.size) {
    // One table, in one order of columns, so the same form read twice offers the same rows.
    const rows = [...materials.values()].map((row) => ({ material: row.material, ...(row.unit ? { unit: row.unit } : {}), ...(row.issue_rate !== undefined ? { issue_rate: row.issue_rate } : {}), ...(row.wastage_pct !== undefined ? { wastage_pct: row.wastage_pct } : {}), ...(row.penal_rate !== undefined ? { penal_rate: row.penal_rate } : {}) }));
    offer(materialsRow.no, materialsRow.item, 'materials', rows, materialsRow.row, materialsRow.quote);
  }

  // Every party there is, and every one already offered and waiting: a name is offered once.
  const known = new Set(fieldRecords(project, PARTIES).map((held) => words(String(readSheet(project, PARTIES, held.id, undefined, catalog)?.fields.find((view) => view.def.key === 'name')?.held?.value ?? ''))));
  for (const party of newParties) {
    report.parties.push(party.name);
    if (known.has(words(party.name))) continue;
    known.add(words(party.name));
    proposeFieldValues(project, [{ address: { fn: 'shared', set: PARTIES, field: 'name' }, value: party.name, origin: cite(party.row, party.quote) }, { address: { fn: 'shared', set: PARTIES, field: 'roles' }, value: [party.role], origin: cite(party.row, party.quote) }], 'parser', catalog);
  }
  const outcomes = proposeFieldValues(project, proposals, 'parser', catalog);
  outcomes.forEach((outcome, n) => {
    record ??= outcome.address.record;
    if (outcome.outcome === 'waiting') report.offered += 1;
    else if (outcome.outcome === 'held') report.held += 1;
    else if (outcome.outcome === 'refused') report.refused.push({ no: proposals[n]!.no, item: proposals[n]!.item, error: outcome.error ?? 'Not taken.' });
  });
  // A form with nothing to offer still fills a record of its own, so what is not applicable has somewhere to be decided.
  if (!record && offers.length) record = addFieldRecord(project, TENDER_TERMS, {}, input.actor, {}, catalog).record?.id;
  // A blank form still fills a record of its own: its rows are answered on that record's sheet, and a line owed has to know which.
  if (!record && drafts.some((draft) => draft.status !== 'received')) record = addFieldRecord(project, TENDER_TERMS, {}, input.actor, {}, catalog).record?.id;
  report.owed = loadTrackedList(project, 'procurement', drafts.map((draft) => ({ ...draft, department: 'procurement' as const, ...(draft.answers && record ? { answers: { ...draft.answers, record } } : {}) })), input.actor, { openOnly: true, ...(input.load ? { load: input.load } : {}) });
  if (record) {
    report.record = record;
    // What is already not applicable on the sheet is not offered again.
    const reading = readSheet(project, TENDER_TERMS, record, undefined, catalog);
    const waiting = offers.filter((held) => held.fields.some((key) => reading?.fields.find((view) => view.def.key === key)?.state !== 'not_applicable'));
    const loaded: TenderFormLoaded = {
      id: earlier?.id ?? newId('tf'),
      list,
      record,
      file,
      sheet: read.sheet,
      ...(pack ? { package: pack } : {}),
      ...(read.header.client ? { client: flat(read.header.client).slice(0, 120) } : {}),
      ...(responseBy ? { responseBy } : {}),
      loadedAt: new Date().toISOString(),
      by: input.actor,
      notApplicable: waiting,
    };
    project.tenderForms = [...(project.tenderForms ?? []).filter((held) => held.id !== loaded.id), loaded];
  }
  return report;
}

/** A form's report in one line, for the notice that follows a load. */
export function tenderFormSaid(report: TenderFormReport): string {
  const part = (n: number, said: string) => (n ? `${n} ${said}` : '');
  return (
    [part(report.offered, report.offered === 1 ? 'value to accept' : 'values to accept'), part(report.held, 'already held'), part(report.parties.length, report.parties.length === 1 ? 'party to add' : 'parties to add'), part(report.notApplicable, 'not applicable'), part(report.unanswered, 'still owed'), part(report.unread.length, 'to type by hand'), part(report.unmatched.length, 'not on the form')]
      .filter(Boolean)
      .join(' · ') || 'Nothing to take from it'
  );
}

/**
 * Take a row a client marked "Not Applicable", or set it aside. Taken, each
 * field the row answers is marked not applicable ("not in this project"),
 * by a lead or signer as any field is. Either way the offer is settled.
 */
export function decideTenderFormOffer(project: DdProject, formId: string, offerId: string, decision: 'take' | 'set_aside', actor: string, options: FieldWriteOptions = {}, catalog: FieldCatalog = fieldCatalogFor(project)): TenderFormLoaded {
  const form = (project.tenderForms ?? []).find((held) => held.id === formId);
  const offer = form?.notApplicable.find((held) => held.id === offerId);
  if (!form || !offer) throw new Error('That is not waiting any more.');
  if (decision === 'take') {
    for (const field of offer.fields) {
      decideField(project, { fn: FN, set: TENDER_TERMS, field, record: form.record }, 'not_applicable', actor, { reason: 'not_in_this_project', note: `${form.file}, row ${offer.row}`.slice(0, 120) }, options, catalog);
    }
  } else if (options.mayDecide && !options.mayDecide('procurement')) {
    throw new Error('A lead or signer of Procurement sets this aside.');
  }
  form.notApplicable = form.notApplicable.filter((held) => held.id !== offerId);
  project.updatedAt = new Date().toISOString();
  return form;
}

/* ==================================================================== */
/* Writing the form                                                      */
/* ==================================================================== */

export interface TenderFormOut {
  title: string;
  /** The lines above the table, a label and its value. */
  header: Array<[string, string]>;
  columns: readonly string[];
  /** Section rows and item rows, in the form's order. */
  rows: Array<{ section: true; cells: [string, string] } | { section?: false; cells: [string, string, string, string, string, string] }>;
  footer: string[];
}

const stands = (state: string | undefined): boolean => state === 'accepted' || state === 'typed';

/** A value as the form writes it: plain enough to be read back as the same value. */
function written(project: DdProject, catalog: FieldCatalog, def: CheckFieldDef, value: CheckFieldValue): string {
  const raw = value.value;
  const options = def.optionSet ? (optionSetById(def.optionSet, catalog)?.options ?? []) : (def.options ?? []).map((option) => ({ key: option, label: option }));
  const label = (key: unknown) => options.find((option) => option.key === key)?.label ?? String(key);
  switch (def.kind) {
    case 'boolean':
      return raw === true ? 'Yes' : 'No';
    case 'percent':
      return `${raw}%`;
    case 'money':
      return `Rs. ${Number(raw).toLocaleString('en-IN')}`;
    case 'duration':
      return `${raw} ${def.unit ?? ''}`.trim();
    case 'number':
      return def.unit ? `${raw} ${def.unit}` : String(raw);
    case 'date':
      return daySaid(String(raw));
    case 'enum':
      return label(raw);
    case 'multi_enum':
      return (raw as string[]).map(label).join(', ');
    case 'ref':
      return refChoices(project, def.target, catalog).find((choice) => choice.id === raw)?.label ?? '';
    default:
      return String(raw ?? '');
  }
}

/**
 * The form for one tender, filled from what stands on its sheet: a value a
 * person typed or accepted. A value still waiting, one in dispute and one
 * standing in as assumed are not written: the client is sent what was
 * agreed, and a blank where nothing was.
 */
export function tenderFormExport(project: DdProject, recordId: string, catalog: FieldCatalog = fieldCatalogFor(project)): TenderFormOut {
  const reading = fieldRecords(project, TENDER_TERMS).some((record) => record.id === recordId) ? readSheet(project, TENDER_TERMS, recordId, undefined, catalog) : undefined;
  if (!reading) throw new Error('That tender is not on this project.');
  const view = (key: string) => reading.fields.find((held) => held.def.key === key);
  const said = (key: string): string => {
    const held = view(key);
    return held && stands(held.state) && held.held && held.held.value !== null && held.held.value !== '' ? written(project, catalog, held.def, held.held) : '';
  };
  const loaded = (project.tenderForms ?? []).find((held) => held.record === recordId);
  const out: TenderFormOut = {
    title: TENDER_FORM_TITLE,
    header: [
      ['Project', project.name],
      ['Client', said('client') || loaded?.client || ''],
      ['Package', said('package') || loaded?.package || ''],
      ['Issued by', said('issued_by')],
      ['Date of issue', said('issued_on')],
      ['Response required by', said('response_by')],
    ],
    columns: TENDER_FORM_COLUMNS,
    rows: [],
    footer: ['Name of the client’s representative:', 'Designation:', 'Signature:', `Date: ${said('answered_on')}`.trim(), FOOTER],
  };
  for (const section of TENDER_FORM_ROWS) {
    out.rows.push({ section: true, cells: [section.no, section.title] });
    for (const row of section.rows) {
      const keys = [...row.fields.map((field) => field.key), ...(row.paper ? [row.paper] : [])];
      const na = keys.length > 0 && keys.every((key) => view(key)?.state === 'not_applicable');
      let response = '';
      if (na) response = NOT_APPLICABLE;
      else if (row.fields.some((field) => field.read.as === 'materials')) {
        const part = (row.fields.find((field) => field.read.as === 'materials')!.read as { part: 'named' | 'rates' | 'wastage' }).part;
        const table = view('materials');
        const rows = table && stands(table.state) && Array.isArray(table.held?.value) ? (table.held!.value as unknown as MaterialRow[]) : [];
        const money = (amount: number | undefined) => (amount === undefined || amount === null ? '' : `Rs. ${Number(amount).toLocaleString('en-IN')}`);
        if (part === 'named') response = view('client_materials')?.held?.value === false && stands(view('client_materials')?.state) ? 'None' : rows.map((r) => r.material).join('; ');
        if (part === 'rates') response = rows.filter((r) => r.issue_rate !== undefined && r.issue_rate !== null).map((r) => `${r.material}: ${money(r.issue_rate)}${r.unit ? ` per ${r.unit}` : ''}`).join('; ');
        if (part === 'wastage') response = rows.filter((r) => (r.wastage_pct ?? r.penal_rate) !== undefined && (r.wastage_pct ?? r.penal_rate) !== null).map((r) => `${r.material}: ${[r.wastage_pct !== undefined && r.wastage_pct !== null ? `${r.wastage_pct}%` : '', r.penal_rate !== undefined && r.penal_rate !== null ? `excess at ${money(r.penal_rate)}` : ''].filter(Boolean).join(', ')}`).join('; ');
      } else {
        const parts = row.fields.map((field) => ({ field, text: said(field.key) })).filter((part) => part.text);
        response = parts.length === 1 && row.fields.length === 1 ? parts[0]!.text : parts.map((part) => (part.field.tag ? `${part.field.tag}: ${part.text}` : part.text)).join('; ');
      }
      const paper = row.paper ? view(row.paper) : undefined;
      const attached = paper && stands(paper.state) && Array.isArray(paper.held?.value) ? (paper.held!.value as string[]).map((id) => project.evidence.find((e) => e.id === id)).map((e) => e?.attachments[0]?.fileName ?? e?.fileName ?? e?.title ?? '').filter(Boolean).join('; ') : '';
      out.rows.push({ cells: [row.no, row.item, row.details, response || (attached && !row.fields.length ? 'Attached' : ''), attached, ''] });
    }
  }
  return out;
}

/** The form as rows of cells, top to bottom: what a spreadsheet is written from, and what `parseTenderFormRows` reads back. */
export function tenderFormTable(out: TenderFormOut): string[][] {
  return [[out.title], ...out.header.map(([label, value]) => [`${label}:`, value]), [], [...out.columns], ...out.rows.map((row) => [...row.cells]), [], ...out.footer.map((line) => [line])];
}
