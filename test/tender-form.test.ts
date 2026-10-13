/**
 * Tender terms, and the client's form that fills them.
 *
 * The form here is shaped as such a form is sent: lines above the table for
 * the project, the client, the package and the days; six columns; numbered
 * sections; rows that ask for an answer and say its form; and a signature
 * block. Its wording is a client's own, a letter or a word off the form's.
 * It is built as a workbook and read through the reader the API uses.
 *
 * Every name, firm, figure and paper is invented.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  RECORD_AS_OFFERED,
  TENDER_FORM_ROWS,
  TENDER_TERMS,
  addEvidence,
  addFieldRecord,
  catalogLimits,
  createProject,
  decideField,
  decideTenderFormOffer,
  fieldCatalog,
  loadTenderForm,
  papersOwed,
  parseTenderFormRows,
  parseTenderFormSheets,
  parseTrackedSheets,
  readFunctionFields,
  readSheet,
  setFieldValues,
  tenderFormExport,
  tenderFormRowFor,
  tenderFormSaid,
  tenderFormTable,
  wordingAlike,
  type DdProject,
  type TenderFormRead,
} from '@realytica/shared';
import { workbookSheets } from '../apps/api/src/documents/questionnaire-file';
import { tenderFormXlsx } from '../apps/api/src/documents/tender-form-file';

const NOW = '2026-10-13T06:00:00.000Z';
const FN = 'procurement.boq';
const HEAD = ['S.No', 'Information / Document Required', 'Details to be Provided', 'Client Response', 'Document Attached', 'Remarks'];

type Row = Array<string | number>;

/** The form as the client sent it back: most rows answered, one not applicable, two papers named, three rows left blank, one row of the client's own. */
const FORM: Row[] = [
  ['INFORMATION AND DOCUMENTS REQUIRED FROM THE CLIENT FOR PREPARATION OF THE TENDER DOCUMENT'],
  ['Project:', 'Lake Road offices', '', 'Client:', 'Lake Road Developers'],
  ['Package:', 'Civil and structural works', '', 'Issued by:', 'Northbank Cost Consultants'],
  ['Date of issue:', '01/10/2026', '', 'Response required by:', '20/10/2026'],
  [],
  HEAD,
  [1, 'CONSULTANT DETAILS'],
  ['1.1', 'Client / Owner', 'Firm, address, contact person, phone, email', 'Lake Road Developers, 4 Lake Road, Kadamba; R. Menon; 080-5550 0100'],
  ['1.2', 'Architect', 'Firm, address, contact person, phone, email', 'Meridian Design Studio, 12 Tank Bund Road, Kadamba'],
  ['1.3', 'Structural Consultant', 'Firm, address, contact person, phone, email', ''],
  ['1.6', 'Other Consultants', 'Role, firm and contact', 'Landscape consultant to be appointed'],
  [2, 'EARNEST MONEY DEPOSIT (EMD)'],
  ['2.1', 'EMD applicable', 'Yes / No', 'Yes'],
  ['2.2', 'EMD amount', 'Fixed or % of tender value', 'Rs. 5,00,000 fixed'],
  ['2.3', 'Mode of EMD', 'DD / BG / online transfer; in whose favour', 'DD or BG in favour of Lake Road Developers'],
  ['2.4', 'Validity and refund terms', 'Days', 'Valid 90 days; refund to unsuccessful bidders within 30 days of award'],
  [3, 'MOBILIZATION ADVANCE'],
  ['3.1', 'Mobilization advance applicable', 'Yes / No', 'Yes'],
  ['3.2', 'Mobilization advance amount', '% of contract value', '10% of contract value'],
  ['3.3', 'Security for advance', 'BG at 100% or 110%, and by when', 'Bank guarantee for 110% of the advance, before release'],
  ['3.4', 'Interest on advance', 'Free or bearing, with rate', 'Interest free'],
  ['3.5', 'Recovery of advance', 'From which RA bill; fully recovered by what % of work done', 'From 2nd RA bill at 10% of each bill; fully recovered by 80% of work done'],
  [4, 'MATERIALS SUPPLIED BY CLIENT'],
  ['4.1', 'Materials supplied by the client', 'Cement, reinforcement steel, others, or none', 'Not Applicable'],
  [5, 'WATER AND ELECTRICITY FOR CONSTRUCTION'],
  ['5.1', 'Water for construction', 'Available, source and charges', 'Yes, from borewell at site, free of charge'],
  ['5.2', 'Electricity for construction', 'Available, connection point, sanctioned load and charges', 'Yes; at the site boundary; 250 kVA sanctioned; chargeable at actuals'],
  [6, 'RETENTION MONEY'],
  ['6.1', 'Retention from each RA bill', '%', '5%'],
  ['6.2', 'Cap on retention', '% of contract or executed value', '5% of contract value'],
  ['6.5', 'Security deposit / performance guarantee', '% of contract value, form, validity', '5% of contract value by bank guarantee, valid 24 months'],
  [7, 'TYPE OF CONTRACT'],
  ['7.1', 'Type of contract', 'Item rate / lump sum / re-measurable / design and build', 'Item rate'],
  ['7.3', 'Contract period and expected start', 'Months; date', '18 months; start 01/01/2027'],
  ['7.4', 'Defect liability period', 'Months', '12 months'],
  ['7.5', 'Liquidated damages', 'Rate per week or day, cap %', '0.5% per week, maximum 5%'],
  ['7.6', 'Payment terms', 'Billing frequency, minimum bill value, certification and payment period in days', 'Monthly bills; minimum bill Rs. 25 lakh; certified in 10 days and paid within 30 days'],
  [10, 'APPENDICES'],
  ['10.1', 'Technical specifications', 'Attach', 'Attached', 'Civil specifications R2.pdf'],
  ['10.2', 'Schedule of quantities', 'Attach', 'Attached', 'Schedule of quantities civil.xlsx'],
  ['10.10', 'Soil investigation report', 'Attach', ''],
  ['11.1', 'Site canteen arrangements', 'Whether allowed', 'Allowed'],
  [],
  ['Name of client representative:', '', '', 'Designation:', ''],
  ['Signature:', '', '', 'Date:', '18/10/2026'],
  ['Please mark "Not Applicable" where an item does not apply.'],
];

async function workbook(rows: Row[]): Promise<Buffer> {
  const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Client inputs');
  rows.forEach((row, n) => {
    sheet.addRow(row);
    if (n === 0) sheet.mergeCells('A1:F1');
    // A section row is merged across the sheet from its name on.
    if (row.length === 2 && typeof row[0] === 'number') sheet.mergeCells(`B${n + 1}:F${n + 1}`);
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** A project with the parties the form names on its party record, and one of the two papers it names on file. */
function project(): { p: DdProject; client: string; architect: string; specs: string } {
  const p = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba', currentStage: 'procurement' }, 'RYT-T1');
  const party = (name: string) => addFieldRecord(p, 'shared.parties', { name, kind: 'company' }, 'buyer@builders.example').record!.id;
  const client = party('Lake Road Developers');
  const architect = party('Meridian Design Studio');
  party('Stonebridge Structures');
  const specs = addEvidence(p, { title: 'Civil specifications R2', kind: 'document', status: 'received' }, 'buyer@builders.example');
  specs.attachments.push({ id: 'att_specs', fileName: 'Civil specifications R2.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'specs.pdf', uploadedAt: '2026-10-01T00:00:00.000Z' });
  return { p, client, architect, specs: specs.id };
}

async function read(rows: Row[] = FORM): Promise<TenderFormRead> {
  const form = parseTenderFormSheets(await workbookSheets(await workbook(rows), { keepEmpty: true }));
  assert.ok(form, 'the workbook is a tender form');
  return form;
}

const view = (p: DdProject, record: string, key: string) => {
  const found = readSheet(p, TENDER_TERMS, record)!.fields.find((field) => field.def.key === key);
  assert.ok(found, `no field ${key}`);
  return found;
};
const at = (record: string, field: string) => ({ fn: FN, set: TENDER_TERMS, field, record });
const typed = (p: DdProject, record: string, values: Record<string, unknown>) => assert.deepEqual(setFieldValues(p, { set: TENDER_TERMS, record }, values, 'buyer@builders.example').rejected, []);
const said = (p: DdProject, record: string): string[] => {
  const reading = readSheet(p, TENDER_TERMS, record)!;
  return reading.findings.map((finding) => finding.insight.text);
};

/**
 * A lead accepts the record as it was offered, and then what its answers bring into play: the terms of an advance are
 * not asked, and so not offered to be accepted, until the advance itself is accepted as applying.
 */
function acceptAll(p: DdProject, record: string): void {
  decideField(p, at(record, RECORD_AS_OFFERED), 'accept', 'lead@builders.example');
  for (let round = 0; round < 4; round += 1) {
    const waiting = readSheet(p, TENDER_TERMS, record)!.fields.filter((field) => field.state === 'proposed');
    if (!waiting.length) return;
    for (const field of waiting) decideField(p, field.address, 'accept', 'lead@builders.example');
  }
}

describe('the Tender terms sheet', () => {
  const set = fieldCatalog().sets.get(TENDER_TERMS)!;

  it('is a record for each tender, inside the limits a catalog is held to, with nothing typed as prose but one bounded note', () => {
    assert.equal(set.fn, FN);
    assert.ok(set.records);
    assert.deepEqual(catalogLimits().filter((breach) => breach.set === TENDER_TERMS), []);
    const own = set.fields.filter((field) => !field.sheet);
    assert.ok(own.length <= 20, `${own.length} fields on the record`);
    for (const sheet of set.sheets ?? []) assert.ok(sheet.fields.length <= 20 && (sheet.sections ?? []).length <= 4, sheet.title);
    const prose = set.fields.filter((field) => field.kind === 'longtext' || field.kind === 'text');
    assert.deepEqual(prose.map((field) => [field.key, field.kind, field.maxLength]), [['note', 'longtext', 400]]);
    for (const table of set.fields.filter((field) => field.kind === 'table')) assert.ok((table.columns ?? []).length <= 6, table.key);
    // Consultants are links to the one party record, never names typed here.
    for (const key of ['client', 'architect', 'structural_consultant', 'mep_consultant', 'pmc']) assert.deepEqual([set.fields.find((field) => field.key === key)?.kind, set.fields.find((field) => field.key === key)?.target], ['ref', 'party']);
    // Every row of the form answers to fields that exist, and every paper it asks for to a field that holds papers.
    for (const row of TENDER_FORM_ROWS.flatMap((section) => section.rows)) {
      for (const field of row.fields) assert.ok(set.fields.some((def) => def.key === field.key), `${row.no} names ${field.key}`);
      if (row.paper) assert.equal(set.fields.find((def) => def.key === row.paper)?.kind, 'evidence', row.no);
    }
  });

  it('is short while nothing applies, and opens a sheet for each thing that does', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { contract_type: 'item rate' }, 'buyer@builders.example').record!.id;
    const shown = () => {
      const reading = readSheet(p, TENDER_TERMS, record)!;
      const own = reading.sections.flatMap((section) => section.fields).filter((field) => field.shown === 'shown').length;
      const sheets = Object.fromEntries(reading.depth.filter((depth) => depth.shown).map((depth) => [depth.sheet.id, depth.fields.filter((field) => field.shown === 'shown').length]));
      return { own, sheets };
    };
    const always = { form: 5, consultants: 6, utilities: 9, retention: 9, makes: 6, appendices: 12 };
    // Sixteen fields of its own, and the six sheets every tender has: none of the three that follow from a yes.
    assert.deepEqual(shown(), { own: 16, sheets: always });
    assert.deepEqual(readFunctionFields(p, FN).situations.filter((situation) => situation.state === 'on').map((situation) => situation.situation.key), []);

    typed(p, record, { advance_applies: true });
    assert.deepEqual(shown(), { own: 16, sheets: { ...always, advance: 6 } });
    typed(p, record, { advance_interest: 'interest bearing' });
    assert.deepEqual(shown().sheets.advance, 7);

    typed(p, record, { emd_applies: true });
    assert.deepEqual(shown().sheets.earnest_money, 6);
    typed(p, record, { emd_basis: 'fixed amount' });
    assert.deepEqual(shown().sheets.earnest_money, 7);

    typed(p, record, { client_materials: true });
    assert.deepEqual(shown().sheets.client_materials, 4);

    typed(p, record, { price_basis: 'escalation by formula' });
    assert.equal(shown().own, 17);
    assert.deepEqual(
      readFunctionFields(p, FN).situations.filter((situation) => situation.state === 'on').map((situation) => situation.situation.key).sort(),
      ['client_supplies_materials', 'earnest_money_applies', 'mobilisation_advance_applies', 'price_escalation_applies'],
    );

    // Taken back, each sheet closes and what it held is kept.
    typed(p, record, { advance_pct: 10 });
    typed(p, record, { advance_applies: false, emd_applies: false, client_materials: false, price_basis: 'firm' });
    assert.deepEqual(shown(), { own: 16, sheets: always });
    assert.equal(p.fieldSheets![TENDER_TERMS]!.records![0]!.values.advance_pct!.value, 10);
  });

  it('says when the advance is not covered by its guarantee', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { advance_applies: true, advance_pct: 10, advance_bg_pct: 90 }, 'buyer').record!.id;
    assert.deepEqual(said(p, record), ['The advance is secured by a bank guarantee of 90% of it: less than the advance itself.']);
    typed(p, record, { advance_bg_pct: 110 });
    assert.deepEqual(said(p, record), []);
  });

  it('says when the advance would be recovered before the work could pay for it', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { advance_applies: true, advance_pct: 10, recovered_by_pct: 5 }, 'buyer').record!.id;
    assert.deepEqual(said(p, record), ['An advance of 10% of the contract value is to be recovered by 5% of the work: the bills to that point are worth less than the advance.']);
    typed(p, record, { recovered_by_pct: 80 });
    assert.deepEqual(said(p, record), []);
    // With no advance the rule is not asked at all.
    typed(p, record, { recovered_by_pct: 5, advance_applies: false });
    assert.deepEqual(said(p, record), []);
  });

  it('says when retention is capped above what is ever held', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { retention_pct: 5, retention_cap_pct: 7.5 }, 'buyer').record!.id;
    assert.deepEqual(said(p, record), ['Retention is capped at 7.5% where 5% is held from each bill: the cap is never reached.']);
    typed(p, record, { retention_cap_pct: 5 });
    assert.deepEqual(said(p, record), []);
  });

  it('says when liquidated damages for one period are above their own cap', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { damages_rate_pct: 6, damages_cap_pct: 5 }, 'buyer').record!.id;
    assert.deepEqual(said(p, record), ['Liquidated damages of 6% for each period are above the 5% they are capped at.']);
    typed(p, record, { damages_rate_pct: 0.5 });
    assert.deepEqual(said(p, record), []);
  });

  it('says when the performance guarantee runs out before the defects liability period does', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { contract_months: 18, defects_months: 12, performance_valid_months: 24 }, 'buyer').record!.id;
    assert.deepEqual(said(p, record), ['The performance guarantee is valid for 24 months, and the contract period with the defects liability period runs 30 months.']);
    typed(p, record, { performance_valid_months: 30 });
    assert.deepEqual(said(p, record), []);
  });

  it('lets any answer be marked not applicable with a reason, and asked again', () => {
    const { p } = project();
    const record = addFieldRecord(p, TENDER_TERMS, { contract_type: 'lump sum' }, 'buyer').record!.id;
    decideField(p, at(record, 'retention_pct'), 'not_applicable', 'lead@builders.example', { reason: 'not_in_this_project' });
    assert.deepEqual([view(p, record, 'retention_pct').state, view(p, record, 'retention_pct').held?.naReason], ['not_applicable', 'not_in_this_project']);
    decideField(p, at(record, 'retention_pct'), 'reopen', 'lead@builders.example');
    assert.equal(view(p, record, 'retention_pct').state, 'empty');
  });
});

describe('a row known by its wording', () => {
  it('is matched a letter or a word off, with its section and number to help, and left unmatched where it is none of the form’s', () => {
    const match = (no: string, item: string, section?: string) => tenderFormRowFor({ no, item, ...(section ? { section } : {}) })?.no;
    assert.equal(match('3.1', 'Mobilization advance applicable', 'MOBILIZATION ADVANCE'), '3.1');
    assert.equal(match('12', 'Mobilisaton Advance - amount', 'Mobilisation advance'), '3.2');
    assert.equal(match('', 'Defect liability period'), '7.4');
    assert.equal(match('4', 'Liquidated damges'), '7.5');
    assert.equal(match('2.1', 'EMD applicable', 'EARNEST MONEY DEPOSIT (EMD)'), '2.1');
    assert.equal(match('9.9', 'Site canteen arrangements', 'APPENDICES'), undefined);
    assert.ok(wordingAlike('Retention from each RA bill', 'Retention from each running bill') > 0.6);
    assert.equal(wordingAlike('Soil investigation report', 'Day work rates'), 0);
  });
});

describe('the client’s form read as answers', () => {
  it('is known by its columns, with the lines above the table read and the signature block left out', async () => {
    const form = await read();
    assert.equal(form.sheet, 'Client inputs');
    assert.deepEqual(form.header, { project: 'Lake Road offices', client: 'Lake Road Developers', package: 'Civil and structural works', issuedBy: 'Northbank Cost Consultants', issuedOn: '01/10/2026', responseBy: '20/10/2026' });
    assert.equal(form.footer.date, '18/10/2026');
    assert.equal(form.rows.length, 28);
    assert.deepEqual([form.rows[0]!.no, form.rows[0]!.section, form.rows[0]!.row], ['1.1', 'CONSULTANT DETAILS', 8]);
    assert.ok(!form.rows.some((row) => /signature|representative|EARNEST MONEY DEPOSIT \(EMD\)/i.test(row.item)));
    // A tracked list is not a form, and a form is not a tracked list.
    assert.equal(parseTrackedSheets(await workbookSheets(await workbook(FORM))), undefined);
    assert.equal(parseTenderFormRows([['Ref No', 'Description of Information Required', 'Current Status'], ['1.1', 'Soil report', 'Pending']]), undefined);
  });

  it('offers each filled response as its field’s value, with the file, the sheet and the row as its source, and makes nothing stand', async () => {
    const { p, client, architect, specs } = project();
    const report = loadTenderForm(p, await read(), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-13' });
    assert.ok(report.record);
    const record = report.record!;
    const offered = (key: string) => {
      // What is stored, whatever its standing: a field of a sheet not yet open holds its offer all the same.
      const field = view(p, record, key);
      assert.equal(field.held?.state, 'proposed', key);
      return field.held!.value;
    };
    assert.deepEqual(
      ['client', 'architect', 'emd_applies', 'emd_basis', 'emd_amount', 'emd_modes', 'emd_favour', 'emd_validity_days', 'emd_refund_days'].map(offered),
      [client, architect, true, 'fixed amount', 500000, ['bank_guarantee', 'demand_draft'], client, 90, 30],
    );
    assert.deepEqual(['advance_applies', 'advance_pct', 'advance_bg_pct', 'advance_bg_due', 'advance_interest', 'recovery_from_bill', 'recovered_by_pct'].map(offered), [true, 10, 110, 'before the advance is paid', 'interest free', 2, 80]);
    assert.deepEqual(['water_available', 'water_source', 'water_charges', 'power_available', 'power_point', 'sanctioned_load', 'power_charges'].map(offered), [true, 'borewell', 'free', true, 'at the site boundary', 250, 'chargeable']);
    assert.deepEqual(['retention_pct', 'retention_cap_pct', 'retention_cap_of', 'performance_pct', 'performance_form', 'performance_valid_months'].map(offered), [5, 5, 'contract value', 5, 'bank_guarantee', 24]);
    assert.deepEqual(
      ['contract_type', 'contract_months', 'expected_start', 'defects_months', 'damages_rate_pct', 'damages_per', 'damages_cap_pct', 'billing_frequency', 'min_bill_value', 'certify_days', 'pay_days'].map(offered),
      ['item rate', 18, '2027-01-01', 12, 0.5, 'week', 5, 'monthly', 2500000, 10, 30],
    );
    assert.deepEqual(['issued_on', 'response_by', 'answered_on'].map(offered), ['2026-10-01', '2026-10-20', '2026-10-18']);
    // A paper named as attached and on the project is offered as the field's paper.
    assert.deepEqual(offered('specifications'), [specs]);
    // Where it came from: the file, the sheet and the row, with the client's own words.
    assert.deepEqual(view(p, record, 'damages_cap_pct').held!.origin, { kind: 'external', source: 'Client inputs for tender.xlsx · Client inputs · row 36', asOf: '2026-10-13', quote: '0.5% per week, maximum 5%' });
    // Nothing offered stands: the record is nothing yet, no rule reads it, and nothing is in play because of it.
    const reading = readSheet(p, TENDER_TERMS, record)!;
    assert.equal(reading.pending, true);
    assert.deepEqual(reading.findings, []);
    assert.deepEqual(readFunctionFields(p, FN).situations.filter((situation) => situation.state === 'on'), []);
    // The interest rate was not stated, the structural consultant was left blank: neither is offered.
    assert.deepEqual([view(p, record, 'advance_interest_pct').held, view(p, record, 'structural_consultant').held, view(p, record, 'emd_pct').held], [undefined, undefined, undefined]);
    assert.deepEqual([report.rows, report.offered, report.held, report.notApplicable, report.unanswered, report.refused], [28, 44, 0, 1, 2, []]);
    assert.deepEqual(report.unread, [{ no: '1.6', item: 'Other consultants', response: 'Landscape consultant to be appointed' }]);
    assert.deepEqual(report.unmatched, [{ no: '11.1', item: 'Site canteen arrangements' }]);
    assert.equal(tenderFormSaid(report), '44 values to accept · 1 not applicable · 2 still owed · 1 to type by hand · 1 not on the form');
  });

  it('makes each row left unanswered a line of Papers owed, owed by the client and wanted by the day the form asks', async () => {
    const { p } = project();
    const report = loadTenderForm(p, await read(), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-13' });
    assert.deepEqual(report.owed.added, ['1.3 Structural consultant', '10.2 Schedule of quantities civil.xlsx', '10.10 Soil investigation report']);
    const view = papersOwed(p, { department: 'procurement', now: NOW });
    const lines = view.parties.flatMap((party) => party.lines);
    assert.deepEqual(view.parties.map((party) => party.party), ['Lake Road Developers']);
    assert.deepEqual(
      lines.map((line) => [line.ref, line.title, line.standing, line.dueAt, line.round, line.where]),
      [
        ['1.3', 'Structural consultant', 'asked', '2026-10-20', 'Tender form', 'Civil and structural works · 1 Consultant details'],
        ['10.2', 'Schedule of quantities civil.xlsx', 'asked', '2026-10-20', 'Tender form', 'Civil and structural works · 10 Appendices'],
        ['10.10', 'Soil investigation report', 'asked', '2026-10-20', 'Tender form', 'Civil and structural works · 10 Appendices'],
      ],
    );
    // A paper named as attached that is not on file is still owed, under the name it will be filed as.
    assert.equal(lines[1]!.remark, 'Named on the form as attached, for schedule of quantities');
    assert.equal(lines[0]!.checklist!.item.fn, FN);
    // Past the day, they are overdue.
    assert.equal(papersOwed(p, { department: 'procurement', now: '2026-10-21T06:00:00.000Z' }).overdue, 3);
  });

  it('counts for nothing until a person accepts it, and then stands with the form as its source', async () => {
    const { p } = project();
    const record = loadTenderForm(p, await read(), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-13' }).record!;
    // A contributor may not accept; a lead may.
    assert.throws(() => decideField(p, at(record, 'retention_pct'), 'accept', 'buyer@builders.example', {}, { mayDecide: Object.assign(() => false, { roleIn: () => undefined }) as never }));
    acceptAll(p, record);
    const reading = readSheet(p, TENDER_TERMS, record)!;
    assert.notEqual(reading.pending, true);
    assert.deepEqual([view(p, record, 'retention_pct').state, view(p, record, 'advance_pct').state, view(p, record, 'damages_cap_pct').held?.origin?.kind], ['accepted', 'accepted', 'external']);
    assert.deepEqual(reading.depth.filter((depth) => depth.shown).map((depth) => depth.sheet.id).sort(), ['advance', 'appendices', 'consultants', 'earnest_money', 'form', 'makes', 'retention', 'utilities']);
    assert.deepEqual(said(p, record), ['The performance guarantee is valid for 24 months, and the contract period with the defects liability period runs 30 months.']);
  });

  it('offers "Not Applicable" as not applicable, for a lead or signer to take or set aside', async () => {
    const { p } = project();
    const record = loadTenderForm(p, await read(), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-13' }).record!;
    const form = p.tenderForms![0]!;
    assert.deepEqual(form.notApplicable.map((offer) => [offer.no, offer.item, offer.fields, offer.row]), [['4.1', 'Materials supplied by the client', ['client_materials'], 24]]);
    assert.deepEqual([form.record, form.package, form.client, form.responseBy, form.list], [record, 'Civil and structural works', 'Lake Road Developers', '2026-10-20', 'Tender terms: Civil and structural works']);
    assert.equal(view(p, record, 'client_materials').state, 'empty');
    const refuse = { mayDecide: Object.assign(() => false, { roleIn: () => undefined }) as never };
    assert.throws(() => decideTenderFormOffer(p, form.id, form.notApplicable[0]!.id, 'take', 'buyer@builders.example', refuse));
    assert.equal(p.tenderForms![0]!.notApplicable.length, 1);
    decideTenderFormOffer(p, form.id, form.notApplicable[0]!.id, 'take', 'lead@builders.example');
    const field = view(p, record, 'client_materials');
    assert.deepEqual([field.state, field.held?.naReason, field.held?.naNote], ['not_applicable', 'not_in_this_project', 'Client inputs for tender.xlsx, row 24']);
    assert.deepEqual(p.tenderForms![0]!.notApplicable, []);
    assert.throws(() => decideTenderFormOffer(p, form.id, 'tfo_nothing', 'take', 'lead'), /not waiting any more/);
  });

  it('read again with more answered: fills the same record, offers only what is new, and settles the lines that were owed', async () => {
    const { p } = project();
    const first = loadTenderForm(p, await read(), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-13' });
    acceptAll(p, first.record!);
    const rows = FORM.map((row) => [...row]);
    rows.find((row) => row[0] === '1.3')![3] = 'Stonebridge Structures, 8 Canal Street, Kadamba';
    rows.find((row) => row[0] === '7.4')![3] = '24 months';
    const preview = loadTenderForm(p, await read(rows), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-20', dryRun: true });
    assert.equal(view(p, first.record!, 'structural_consultant').state, 'empty', 'a dry run changes nothing');
    const again = loadTenderForm(p, await read(rows), { file: 'Client inputs for tender.xlsx', actor: 'buyer@builders.example', today: '2026-10-20' });
    assert.deepEqual([preview.offered, preview.held, preview.owed.becameReceived], [again.offered, again.held, again.owed.becameReceived]);
    assert.equal(again.record, first.record);
    assert.deepEqual([again.offered, again.held, again.unanswered], [2, 43, 1]);
    assert.deepEqual([again.owed.added, again.owed.becameReceived], [[], ['1.3 Structural consultant']]);
    assert.equal(p.tenderForms!.length, 1);
    assert.equal(p.fieldSheets![TENDER_TERMS]!.records!.length, 1);
    assert.equal(p.checklist!.length, 3);
    // The defects period the client now states waits beside the one accepted: it replaces nothing by itself.
    const defects = view(p, first.record!, 'defects_months');
    assert.deepEqual([defects.state, defects.held?.value, defects.waiting.length], ['accepted', 12, 1]);
  });
});

describe('the form written back out', () => {
  /** A tender with every kind of answer on its sheet, typed by a person. */
  function filled() {
    const made = project();
    const { p, client, architect, specs } = made;
    const record = addFieldRecord(p, TENDER_TERMS, { contract_type: 're-measurable', price_basis: 'escalation by indices' }, 'buyer@builders.example').record!.id;
    typed(p, record, {
      escalation_cap_pct: 7.5,
      contract_months: 20,
      expected_start: '2027-02-01',
      defects_months: 12,
      damages_rate_pct: 0.25,
      damages_per: 'day',
      damages_cap_pct: 10,
      billing_frequency: 'fortnightly',
      min_bill_value: 2500000,
      certify_days: 7,
      pay_days: 21,
      emd_applies: true,
      advance_applies: true,
      client_materials: true,
    });
    typed(p, record, {
      issued_on: '2026-10-01',
      response_by: '2026-10-20',
      client,
      architect,
      emd_basis: 'share of the tender value',
      emd_pct: 2,
      emd_modes: ['Bank guarantee', 'Online transfer'],
      emd_favour: client,
      emd_validity_days: 120,
      emd_refund_days: 45,
      advance_pct: 10,
      advance_bg_pct: 110,
      advance_bg_due: 'on signing',
      advance_interest: 'interest bearing',
      advance_interest_pct: 9,
      recovery_from_bill: 3,
      recovered_by_pct: 85,
      materials: [
        { material: 'cement', unit: 'bag', issue_rate: 380, wastage_pct: 2.5, penal_rate: 760 },
        { material: 'reinforcement steel', unit: 'tonne', issue_rate: 62000, wastage_pct: 3, penal_rate: 124000 },
      ],
      materials_delivery: 'collected by the contractor from the client’s store',
      materials_unloading: 'by the contractor',
      materials_custody: 'the contractor',
    });
    typed(p, record, {
      water_available: true,
      water_source: 'tanker',
      water_charges: 'for the contractor to arrange',
      borewell_permitted: false,
      power_available: true,
      power_point: 'at the transformer',
      sanctioned_load: 250,
      power_charges: 'chargeable',
      generator_by_contractor: true,
      retention_pct: 5,
      retention_cap_pct: 5,
      retention_cap_of: 'executed value',
      release_on_completion_pct: 50,
      retention_against_bg: true,
      performance_pct: 5,
      performance_form: 'Bank guarantee',
      performance_valid_months: 36,
      equivalents_permitted: true,
      equivalents_approved_by: 'the architect',
      acceptable_banks: 'scheduled commercial banks',
      specifications: [specs],
      insurances_required: ['Contractor’s all risk', 'Third party liability'],
      insurance_by: 'the contractor',
      warranty_items: ['waterproofing', 'lifts'],
      warranty_years: 10,
    });
    decideField(p, at(record, 'pmc'), 'not_applicable', 'lead@builders.example', { reason: 'not_in_this_project' });
    return { ...made, record };
  }

  it('is the same form, in the same columns, with each response put together from what stands on the sheet', () => {
    const { p, record } = filled();
    const out = tenderFormExport(p, record);
    assert.deepEqual([...out.columns], HEAD);
    assert.deepEqual(out.header, [['Project', 'Lake Road offices'], ['Client', 'Lake Road Developers'], ['Package', ''], ['Issued by', ''], ['Date of issue', '1 Oct 2026'], ['Response required by', '20 Oct 2026']]);
    assert.deepEqual(out.rows.filter((row) => row.section).map((row) => row.cells), TENDER_FORM_ROWS.map((section) => [section.no, section.title]));
    const response = (no: string) => out.rows.find((row) => !row.section && row.cells[0] === no)!.cells;
    assert.equal(response('2.2')[3], 'Share of tender value: 2%');
    assert.equal(response('3.5')[3], 'From running bill: 3; Fully recovered by: 85%');
    assert.equal(response('4.2')[3], 'cement: Rs. 380 per bag; reinforcement steel: Rs. 62,000 per tonne');
    assert.equal(response('4.4')[3], 'cement: 2.5%, excess at Rs. 760; reinforcement steel: 3%, excess at Rs. 1,24,000');
    assert.equal(response('7.5')[3], 'Rate: 0.25%; For each: day; Cap: 10%');
    assert.equal(response('7.6')[3], 'Bills: fortnightly; Smallest bill: Rs. 25,00,000; Certified within: 7 days; Paid within: 21 days');
    assert.equal(response('6.3')[3], '50%');
    assert.equal(response('1.5')[3], 'Not Applicable');
    assert.deepEqual(response('10.1').slice(3, 5), ['Attached', 'Civil specifications R2.pdf']);
    // What nobody has answered is a blank, with the form's own wording beside it.
    assert.deepEqual(response('1.3'), ['1.3', 'Structural consultant', 'Firm, address, contact person, phone and email', '', '', '']);
    assert.match(out.footer.at(-1)!, /Not Applicable/);
    // A value still waiting, and one standing in as assumed, are not written.
    const q = project();
    const waiting = loadTenderForm(q.p, parseTenderFormRows(tenderFormTable(out))!, { file: 'Round trip', actor: 'buyer' }).record!;
    assert.equal(tenderFormExport(q.p, waiting).rows.filter((row) => !row.section && row.cells[3]).length, 0);
  });

  it('is read back into the same values: a round trip offers nothing new', async () => {
    const { p, record } = filled();
    const out = tenderFormExport(p, record);
    const before = JSON.stringify(p.fieldSheets![TENDER_TERMS]);
    // As rows, and as the workbook the API writes.
    for (const form of [parseTenderFormRows(tenderFormTable(out), 'Tender information'), parseTenderFormSheets(await workbookSheets(await tenderFormXlsx(out)))]) {
      assert.ok(form);
      assert.equal(form.rows.length, TENDER_FORM_ROWS.flatMap((section) => section.rows).length);
      const report = loadTenderForm(p, form, { file: 'RYT-T1-tender-form.xlsx', record, actor: 'buyer@builders.example', today: '2026-10-13' });
      // Nothing waits beside any value: every response was read back as the value the sheet holds.
      assert.deepEqual(readSheet(p, TENDER_TERMS, record)!.fields.filter((field) => field.waiting.length || field.held?.state === 'proposed').map((field) => `${field.def.key}: ${field.waiting.map((value) => value.text).join(', ')}`), []);
      assert.deepEqual([report.offered, report.refused, report.unread, report.unmatched], [0, [], [], []]);
      // The sixty-two values typed on the sheet, each read back as itself.
      assert.equal(report.held, 62);
      assert.equal(report.record, record);
    }
    assert.equal(JSON.stringify(p.fieldSheets![TENDER_TERMS]), before, 'the sheet is as it was');
    // The one row marked not applicable is not offered again: the sheet already says so.
    assert.deepEqual(p.tenderForms![0]!.notApplicable, []);
  });
});
