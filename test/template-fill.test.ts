/**
 * An empty form filled from the record: finding its blanks, what the record
 * offers for each, what a person decides, and the same file written back.
 *
 * The rules are checked on files made here, each kind of blank in both kinds
 * of file. Then the round trip: a filled Word file opens, holds each value in
 * the place its blank was and every other part byte for byte; a filled
 * workbook opens and holds each value in its cell with the cell's format.
 * Then what the standing rule asks: a blank nothing answers is offered
 * nothing, a value nobody accepted is not written, and a model's word can
 * name a value of the record and never be one. Then a hostile file.
 *
 * `template-route.test.ts` holds the wiring and who may do what.
 *
 * The form, the project, the people and the papers are invented.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  TEMPLATE_KEYS,
  TEMPLATE_LIMITS,
  addEvidence,
  createProject,
  decideTemplateFields,
  keepTemplateAsks,
  newTemplate,
  proposeFacts,
  templateAsks,
  templateAsksHeld,
  templateFieldsToAsk,
  templateOffers,
  templateRows,
  templateSourceList,
  templateSummary,
  templateValues,
  type DdProject,
  type DetectedField,
  type FillTemplate,
} from '@realytica/shared';
import { docxOutline } from '../apps/api/src/documents/docx-outline';
import { detectDocxFields, fillDocx } from '../apps/api/src/documents/template-docx';
import { TemplateTooLarge, detectTemplateFields, filledTemplateFile, templateSourcesPdf } from '../apps/api/src/documents/template-file';
import { detectXlsxFields, fillXlsx } from '../apps/api/src/documents/template-xlsx';
import { readZip, unpack, zipOf } from '../apps/api/src/documents/zip';

// The workbook library is the API's own.
const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');

/* ==================================================================== */
/* A Word form, written by hand                                          */
/* ==================================================================== */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const r = (text: string, props = ''): string => `<w:r>${props}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]): string => `<w:p>${runs.join('')}</w:p>`;
const tc = (inner: string, props = ''): string => `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${inner}</w:tc>`;
const tr = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = (...rows: string[]): string => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.join('')}</w:tbl>`;

const UNDERLINED = '<w:rPr><w:u w:val="single"/></w:rPr>';
const BOLD_MARK = '<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>';

const BODY = [
  p(r('Particulars of the property', '<w:rPr><w:b/></w:rPr>')),
  p(r('Project name: [Project Name]')),
  // Two blanks on one line, the second written across two runs.
  p(r('Survey number: '), r('______', UNDERLINED), r(' Extent: '), r('____', UNDERLINED), r('__', UNDERLINED)),
  p(r('Name of the developer:')),
  tbl(tr(tc(p(r('Particulars'))), tc(p(r('Details')))), tr(tc(p(r('Name of the vendor'))), tc('<w:p/>')), tr(tc(p(r('Date of registration'))), tc(`<w:p>${BOLD_MARK}</w:p>`))),
  // Heads of columns over an empty row, and a second empty row that nothing names.
  tbl(tr(tc(p(r('Purchaser'))), tc(p(r('Stamp duty')))), tr(tc('<w:p/>'), tc('<w:p/>')), tr(tc('<w:p/>'), tc('<w:p/>'))),
  `<w:sdt><w:sdtPr><w:alias w:val="Khata number"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${p(r('Click or tap here to enter text.', '<w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr>'))}</w:sdtContent></w:sdt>`,
  p(r('Zoning: '), `<w:fldSimple w:instr=" MERGEFIELD Zoning_of_the_land \\* MERGEFORMAT ">${r('«Zoning_of_the_land»')}</w:fldSimple>`),
  p(
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
    '<w:r><w:instrText xml:space="preserve"> MERGEFIELD SubRegistrar </w:instrText></w:r>',
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    r('«SubRegistrar»'),
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  ),
  // Neither of these is a blank: a footnote mark and a tick box.
  p(r('See note [1] and tick [ ] where it applies.')),
].join('');

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

function docx(body: string): Buffer {
  return zipOf([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: 'word/document.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>` },
    { name: 'word/styles.xml', content: STYLES },
  ]);
}

const mainOf = (file: Buffer): string => unpack(readZip(file).find((entry) => entry.name === 'word/document.xml')!, 1 << 22).toString('utf8');

/* ==================================================================== */
/* A workbook form                                                       */
/* ==================================================================== */

async function workbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Particulars');
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'Property particulars form';
  sheet.getCell('A3').value = 'Survey number';
  sheet.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  sheet.getCell('B3').font = { bold: true };
  sheet.getCell('A4').value = 'Name of the vendor:';
  sheet.getCell('A5').value = 1;
  sheet.getCell('B5').value = 'Date of registration';
  // A row of entries: its second words are an entry, not a label.
  sheet.getCell('A6').value = 'Cement';
  sheet.getCell('B6').value = 'OPC 53';
  // Heads of columns over an empty row.
  sheet.getCell('A8').value = 'Purchaser';
  sheet.getCell('B8').value = 'Stamp duty';
  sheet.getCell('C8').value = 'Remarks';
  sheet.getCell('D10').numFmt = '@';
  book.definedNames.add('Particulars!$D$10', 'Project_Name');
  // A name on a cell somebody has already written in is no blank.
  sheet.getCell('D11').value = 'Kadamba';
  book.definedNames.add('Particulars!$D$11', 'City');
  return Buffer.from(await book.xlsx.writeBuffer());
}

/* ==================================================================== */
/* A project with papers on it                                           */
/* ==================================================================== */

function project(): DdProject {
  const made = createProject({ name: 'Tamarind Court', type: 'residential', location: 'Lake Road', city: 'Kadamba' }, 'RYT-7001');
  made.developer = 'Tamarind Ladder Constructions LLP';
  const deed = addEvidence(made, { title: 'Sale deed of 2019', kind: 'document', status: 'received' }, 'tester');
  deed.documentType = 'Sale deed';
  deed.facts = proposeFacts(
    [],
    [
      // Read surely by the rules: it stands, with nobody's name on it.
      { key: 'survey_numbers', label: 'Survey number', value: '73/4', display: '73/4', page: 1, quote: 'all that piece of land bearing Survey No. 73/4' },
      { key: 'vendor', label: 'Vendor', value: 'Meenakshi Rao', display: 'Meenakshi Rao', page: 1, quote: 'Meenakshi Rao, hereinafter called the Vendor' },
      // A model's reading nobody has accepted: it waits, and is offered to nothing.
      { key: 'stamp_duty', label: 'Stamp duty', value: 560000, display: 'Rs. 5,60,000', page: 3, quote: 'stamp duty of Rs. 5,60,000', source: 'model', proof: 'page_text' },
    ],
  );
  // A person accepted the vendor's name, by name.
  const vendor = deed.facts.find((fact) => fact.key === 'vendor')!;
  vendor.review = 'accepted';
  vendor.decidedBy = 'asha@builders.example';
  vendor.decidedAt = '2026-10-02T09:00:00.000Z';
  return made;
}

const detected = (label: string, n = 0): DetectedField => ({ label, pattern: 'blank', place: { in: 'docx', kind: 'paragraph', p: n }, where: `Paragraph ${n + 1}` });

/* ==================================================================== */

describe('the blanks of a Word file', () => {
  const found = detectDocxFields(docx(BODY));
  const by = (label: string) => found.find((field) => field.label === label);

  it('are found in the file’s own order, one of each kind, and nothing else', () => {
    assert.deepEqual(
      found.map((field) => [field.label, field.pattern]),
      [
        ['Project Name', 'bracket'],
        ['Survey number', 'blank'],
        ['Extent', 'blank'],
        ['Name of the developer', 'label'],
        ['Name of the vendor', 'table_cell'],
        ['Date of registration', 'table_cell'],
        ['Purchaser', 'table_cell'],
        ['Stamp duty', 'table_cell'],
        ['Khata number', 'content_control'],
        ['Zoning of the land', 'merge_field'],
        ['Sub Registrar', 'merge_field'],
      ],
    );
  });

  it('keep the exact place of each: the text pieces and characters, the paragraph, or the control', () => {
    assert.deepEqual(by('Project Name')!.place, { in: 'docx', kind: 'text', t0: 1, o0: 14, t1: 1, o1: 28 });
    // The second blank of the line is written across two runs of underscores.
    assert.deepEqual(by('Extent')!.place, { in: 'docx', kind: 'text', t0: 5, o0: 0, t1: 6, o1: 2 });
    const cell = by('Name of the vendor')!.place;
    assert.equal(cell.in === 'docx' && cell.kind, 'paragraph');
    assert.deepEqual(by('Khata number')!.place, { in: 'docx', kind: 'control', sdt: 0 });
    assert.equal(by('Name of the vendor')!.where, 'Table 1, row 2');
    assert.equal(by('Survey number')!.context, 'Survey number: ______ Extent: ______');
  });

  it('are named by the words before them, the words after, or the line above', () => {
    const labels = (body: string) => detectDocxFields(docx(body)).map((field) => field.label);
    assert.deepEqual(labels(p(r('1. Name of the architect ..........'))), ['Name of the architect']);
    assert.deepEqual(labels(p(r('__________ (Signature of the applicant)'))), ['Signature of the applicant']);
    assert.deepEqual(labels(p(r('Postal address of the site')) + p(r('________________'))), ['Postal address of the site']);
    assert.deepEqual(labels(p(r('Owner: {{owner_name}} of [______]'))), ['owner_name', 'of']);
  });

  it('do not include a table cell that is written in, merged down, or holds a table', () => {
    const body = tbl(tr(tc(p(r('Floor'))), tc(p(r('Area')))), tr(tc(p(r('Ground'))), tc(p(r('412 sqm')))), tr(tc(p(r('First'))), tc('<w:p/>', '<w:vMerge/>')));
    assert.deepEqual(detectDocxFields(docx(body)), []);
  });

  it('name a cell of a grid by its row and its column', () => {
    const body = tbl(tr(tc(p(r('Item'))), tc(p(r('Quantity'))), tc(p(r('Rate')))), tr(tc(p(r('Cement'))), tc('<w:p/>'), tc('<w:p/>')), tr(tc(p(r('Steel'))), tc('<w:p/>'), tc('<w:p/>')));
    assert.deepEqual(
      detectDocxFields(docx(body)).map((field) => field.label),
      ['Cement: Quantity', 'Cement: Rate', 'Steel: Quantity', 'Steel: Rate'],
    );
  });

  it('are refused for a file that is no Word document', () => {
    assert.throws(() => detectDocxFields(Buffer.from('not a zip at all, only words in a file')), /does not look like a Word document/);
    assert.throws(() => detectDocxFields(zipOf([{ name: 'xl/workbook.xml', content: '<workbook/>' }])), /does not look like a Word document/);
  });
});

describe('a Word file written back', () => {
  const file = docx(BODY);
  const found = detectDocxFields(file);
  const value: Record<string, string> = {
    'Project Name': 'Tamarind Court',
    'Survey number': '73/4',
    Extent: '1,214 sqm',
    'Name of the developer': 'Tamarind Ladder Constructions LLP',
    'Name of the vendor': 'Meenakshi Rao & Sons <HUF>',
    'Date of registration': '12 Mar 2019',
    'Khata number': '1187/2',
    'Zoning of the land': 'Residential (main)',
    'Sub Registrar': 'Kadamba North',
  };
  // Purchaser and Stamp duty are left out: nobody accepted a value for them.
  const filled = fillDocx(
    file,
    found.filter((field) => value[field.label]).map((field) => ({ place: field.place, value: value[field.label]! })),
  );

  it('opens, and holds each value in the place its blank was', () => {
    const lines = docxOutline(filled).map((line) => line.text);
    assert.deepEqual(lines, [
      'Particulars of the property',
      'Project name: Tamarind Court',
      'Survey number: 73/4 Extent: 1,214 sqm',
      'Name of the developer: Tamarind Ladder Constructions LLP',
      'Particulars',
      'Details',
      'Name of the vendor',
      'Meenakshi Rao & Sons <HUF>',
      'Date of registration',
      '12 Mar 2019',
      'Purchaser',
      'Stamp duty',
      '1187/2',
      'Zoning: Residential (main)',
      'Kadamba North',
      'See note [1] and tick [ ] where it applies.',
    ]);
  });

  it('keeps the formatting of the place it wrote in', () => {
    const xml = mainOf(filled);
    // The value in a run of underscores is in that run, underlined as it was.
    assert.ok(xml.includes(`<w:r>${UNDERLINED}<w:t xml:space="preserve">73/4</w:t></w:r>`));
    // The value in an empty cell takes the paragraph's own run formatting.
    assert.ok(xml.includes(`<w:p>${BOLD_MARK}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">12 Mar 2019</w:t></w:r></w:p>`));
    // What XML reserves is written as XML writes it.
    assert.ok(xml.includes('Meenakshi Rao &amp; Sons &lt;HUF&gt;'));
    // A content control stops showing its prompt, and its value is not grey.
    assert.ok(!xml.includes('<w:showingPlcHdr/>') && !xml.includes('PlaceholderText') && xml.includes('<w:alias w:val="Khata number"/>'));
    // A merge field stays a field, with the value as its result.
    assert.ok(xml.includes('MERGEFIELD Zoning_of_the_land') && xml.includes('MERGEFIELD SubRegistrar'));
  });

  it('leaves every other part of the file byte for byte, and the blanks nobody decided as they were', () => {
    const before = readZip(file);
    const after = readZip(filled);
    assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name));
    for (const entry of before.filter((e) => e.name !== 'word/document.xml')) assert.ok(after.find((e) => e.name === entry.name)!.data.equals(entry.data), entry.name);
    assert.deepEqual(detectDocxFields(filled).map((field) => field.label), ['Purchaser', 'Stamp duty']);
  });

  it('writes nothing when nothing was accepted: the main part is the one that was sent', () => {
    assert.equal(mainOf(fillDocx(file, [])), mainOf(file));
  });

  it('refuses a place that is not in the file', () => {
    assert.throws(() => fillDocx(file, [{ place: { in: 'docx', kind: 'paragraph', p: 999 }, value: 'x' }]), /not in the file as it was sent/);
    assert.throws(() => fillDocx(file, [{ place: { in: 'docx', kind: 'text', t0: 1, o0: 0, t1: 1, o1: 9999 }, value: 'x' }]), /not in the file as it was sent/);
    assert.throws(() => fillDocx(file, [{ place: { in: 'xlsx', sheet: 'A', cell: 'B2' }, value: 'x' }]), /not in the file as it was sent/);
  });
});

describe('the blanks of a workbook', () => {
  it('are the empty cells beside a label, under a head of a column, and the cells the workbook names', async () => {
    const found = await detectXlsxFields(await workbook());
    assert.deepEqual(
      found.map((field) => [field.label, field.pattern, field.where]),
      [
        ['Survey number', 'cell_right', 'Particulars!B3'],
        ['Name of the vendor', 'cell_right', 'Particulars!B4'],
        ['Date of registration', 'cell_right', 'Particulars!C5'],
        ['Purchaser', 'cell_below', 'Particulars!A9'],
        ['Stamp duty', 'cell_below', 'Particulars!B9'],
        ['Remarks', 'cell_below', 'Particulars!C9'],
        ['Project Name', 'named_range', 'Particulars!D10'],
      ],
    );
    assert.deepEqual(found[0]!.place, { in: 'xlsx', sheet: 'Particulars', cell: 'B3' });
  });

  it('written back, open with each value in its cell, as words, and the cell’s format kept', async () => {
    const file = await workbook();
    const found = await detectXlsxFields(file);
    const at = (label: string) => found.find((field) => field.label === label)!.place;
    const filled = await fillXlsx(file, [
      { place: at('Survey number'), value: '73/4' },
      { place: at('Project Name'), value: 'Tamarind Court' },
      // Words that begin as a formula does are written as words.
      { place: at('Remarks'), value: '=HYPERLINK("http://example.test","x")' },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(filled as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.getWorksheet('Particulars')!;
    assert.equal(sheet.getCell('B3').value, '73/4');
    assert.equal(sheet.getCell('B3').font?.bold, true);
    assert.equal((sheet.getCell('B3').fill as { fgColor?: { argb?: string } }).fgColor?.argb, 'FFFFF2CC');
    assert.equal(sheet.getCell('D10').value, 'Tamarind Court');
    assert.equal(sheet.getCell('D10').numFmt, '@');
    assert.equal(sheet.getCell('C9').value, '=HYPERLINK("http://example.test","x")');
    assert.equal(sheet.getCell('C9').formula, undefined);
    // What was there is still there, and what nobody decided is still empty.
    assert.equal(sheet.getCell('A1').value, 'Property particulars form');
    assert.equal(sheet.getCell('A1').isMerged, true);
    assert.equal(sheet.getCell('B4').value, null);
    const still = (await detectXlsxFields(filled)).map((field) => field.where);
    for (const where of ['Particulars!B4', 'Particulars!C5', 'Particulars!A9', 'Particulars!B9']) assert.ok(still.includes(where), where);
    for (const where of ['Particulars!B3', 'Particulars!C9', 'Particulars!D10']) assert.ok(!still.includes(where), where);
  });

  it('are refused for a place that is on no sheet of the file', async () => {
    await assert.rejects(fillXlsx(await workbook(), [{ place: { in: 'xlsx', sheet: 'Nowhere', cell: 'B2' }, value: 'x' }]), /not in the file as it was sent/);
  });
});

describe('what the record offers for a blank', () => {
  it('is told by its label, through the table a questionnaire is answered with and the project’s own entries', () => {
    assert.deepEqual(templateAsks('Survey number'), ['survey_numbers', 'parcel']);
    assert.deepEqual(templateAsks('Survey_Number'), ['survey_numbers', 'parcel']);
    assert.deepEqual(templateAsks('Name of the project'), ['project_name']);
    assert.deepEqual(templateAsks('Signature of the applicant'), []);
  });

  it('is a value that stands on a paper, with the paper, the page, its words and whether a named person accepted it', () => {
    const file = project();
    const [vendor] = templateOffers(file, { label: 'Name of the vendor' });
    assert.equal(vendor!.value, 'Meenakshi Rao');
    assert.deepEqual(vendor!.source, {
      kind: 'paper',
      title: 'Sale deed',
      evidenceId: file.evidence[0]!.id,
      page: 1,
      quote: 'Meenakshi Rao, hereinafter called the Vendor',
      standing: { state: 'approved', by: 'asha@builders.example', at: '2026-10-02T09:00:00.000Z' },
    });
    // Read surely by the rules and accepted by nobody by name: offered, and said to be waiting.
    assert.deepEqual(templateOffers(file, { label: 'Survey number' })[0]!.source.standing, { state: 'waiting' });
  });

  it('is an entry of the project’s own record where no paper states it', () => {
    const [offer] = templateOffers(project(), { label: 'Project name' });
    assert.deepEqual(offer, { key: 'project_name', value: 'Tamarind Court', source: { kind: 'record', title: 'Project record: project name', standing: { state: 'waiting' } } });
  });

  it('is nothing for a blank no source answers, and nothing from a reading that waits', () => {
    const file = project();
    assert.deepEqual(templateOffers(file, { label: 'Signature of the applicant' }), []);
    // The stamp duty is a model's reading nobody accepted: it answers nothing, as it answers no questionnaire.
    assert.deepEqual(templateOffers(file, { label: 'Stamp duty' }), []);
    // A paper somebody rejected answers nothing either.
    file.evidence[0]!.status = 'rejected';
    assert.deepEqual(templateOffers(file, { label: 'Name of the vendor' }), []);
  });
});

describe('a template on a project', () => {
  const made = (file: DdProject, labels: string[]): FillTemplate =>
    newTemplate(file, { title: 'Bank form', fileName: 'bank-form.docx', format: 'docx', fileKey: 'k', detected: labels.map((label, n) => detected(label, n)) }, 'asha@builders.example');

  it('lists each blank as it stands, and a blank with no source as that', () => {
    const file = project();
    const template = made(file, ['Name of the vendor', 'Survey number', 'Stamp duty', 'Signature']);
    const rows = templateRows(file, template);
    assert.deepEqual(rows.map((row) => [row.field.label, row.status, row.offers[0]?.value]), [
      ['Name of the vendor', 'offered', 'Meenakshi Rao'],
      ['Survey number', 'offered', '73/4'],
      ['Stamp duty', 'no_source', undefined],
      ['Signature', 'no_source', undefined],
    ]);
    assert.deepEqual(templateSummary(rows), { total: 4, written: 0, accepted: 0, typed: 0, blank: 0, offered: 2, noSource: 2 });
    // Nothing is written until a person decides: an offer is not a value.
    assert.deepEqual(templateValues(template), []);
  });

  it('writes only what a person accepted or typed, each with their name and what it was taken from', () => {
    const file = project();
    const template = made(file, ['Name of the vendor', 'Survey number', 'Stamp duty', 'Signature']);
    const [vendor, survey, duty, signature] = template.fields;
    decideTemplateFields(
      file,
      template,
      [
        { fieldId: vendor!.id, decision: 'accept' },
        { fieldId: duty!.id, decision: 'type', value: '  Rs. 5,60,000  ' },
        { fieldId: signature!.id, decision: 'blank' },
      ],
      'dev@builders.example',
    );
    assert.deepEqual(templateValues(template).map((v) => v.value), ['Meenakshi Rao', 'Rs. 5,60,000']);
    assert.equal(vendor!.decidedBy, 'dev@builders.example');
    assert.equal(vendor!.source!.title, 'Sale deed');
    assert.equal(duty!.source, undefined);
    assert.deepEqual(templateRows(file, template).map((row) => row.status), ['accepted', 'offered', 'typed', 'blank']);
    // The survey number is still only offered: it is not in the file.
    assert.equal(survey!.value, undefined);

    const list = templateSourceList(file, template);
    assert.deepEqual(list.written.map((line) => [line.label, line.value, line.source]), [
      ['Name of the vendor', 'Meenakshi Rao', 'Sale deed, p. 1'],
      ['Stamp duty', 'Rs. 5,60,000', 'Typed'],
    ]);
    assert.match(list.written[0]!.standing, /Approved by asha@builders\.example on 2026-10-02\. Accepted for this file by dev@builders\.example\./);
    assert.deepEqual(list.empty.map((line) => line.why), ['A value is offered and nobody has accepted it', 'Left blank by dev@builders.example']);
    assert.ok(file.audit.some((event) => event.action === 'template_decided' && event.entityId === template.id && event.actor === 'dev@builders.example'));
  });

  it('keeps what was accepted as it stood, and lets a decision be taken back', () => {
    const file = project();
    const template = made(file, ['Name of the vendor']);
    const [vendor] = template.fields;
    decideTemplateFields(file, template, [{ fieldId: vendor!.id, decision: 'accept' }], 'dev@builders.example');
    // The paper is set aside afterwards: the file still says what it was filled from.
    file.evidence[0]!.status = 'rejected';
    assert.equal(templateValues(template)[0]!.value, 'Meenakshi Rao');
    decideTemplateFields(file, template, [{ fieldId: vendor!.id, decision: 'reopen' }], 'dev@builders.example');
    assert.deepEqual(templateValues(template), []);
    assert.equal(templateRows(file, template)[0]!.status, 'no_source');
  });

  it('refuses to accept where nothing is offered, and a decision about a blank it does not hold', () => {
    const file = project();
    const template = made(file, ['Signature']);
    assert.throws(() => decideTemplateFields(file, template, [{ fieldId: template.fields[0]!.id, decision: 'accept' }], 'dev@builders.example'), /Nothing on the record answers “Signature”/);
    assert.throws(() => decideTemplateFields(file, template, [{ fieldId: 'f_other', decision: 'blank' }], 'dev@builders.example'), /No blank by that id/);
  });

  it('holds no more blanks than one may, and says how many were left out', () => {
    const file = project();
    const template = made(file, Array.from({ length: TEMPLATE_LIMITS.fields + 25 }, (_, n) => `Item ${n + 1}`));
    assert.equal(template.fields.length, TEMPLATE_LIMITS.fields);
    assert.match(template.leftOut!, /Only the first 200 of its 225 blanks were taken in/);
    assert.throws(() => made(file, []), /No blanks were found/);
  });

  it('goes out as the same file filled, and a list of sources that is a PDF', async () => {
    const file = project();
    const original = docx(BODY);
    const { format, detected: found } = await detectTemplateFields({ originalname: 'Bank Form.DOCX', buffer: original });
    const template = newTemplate(file, { title: 'Bank form', fileName: 'Bank Form.DOCX', format, fileKey: 'k', detected: found }, 'asha@builders.example');
    const vendor = template.fields.find((field) => field.label === 'Name of the vendor')!;
    decideTemplateFields(file, template, [{ fieldId: vendor.id, decision: 'accept' }], 'dev@builders.example');
    const lines = docxOutline(await filledTemplateFile(template, original)).map((line) => line.text);
    assert.ok(lines.includes('Meenakshi Rao'));
    // The survey number is offered and was not accepted: its blank is as it was.
    assert.ok(lines.includes('Survey number: ______ Extent: ______'));
    const pdf = await templateSourcesPdf(file, template);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  });
});

describe('a model’s word about a blank', () => {
  it('is kept only as a key from the list, for a blank that was asked about', () => {
    const said = [
      { n: 1, key: 'sub_registrar' },
      // A value in place of a key, a key that is not on the list, a blank that was not asked about, and a second answer for one blank.
      { n: 2, key: 'Kadamba North' },
      { n: 2, value: 'Kadamba North' },
      { n: 3, key: 'made_up_key' },
      { n: 9, key: 'vendor' },
      { n: 1, key: 'vendor' },
      'vendor',
      null,
    ];
    assert.deepEqual(templateAsksHeld(said, 3), [{ n: 1, key: 'sub_registrar' }]);
    assert.deepEqual(templateAsksHeld(null, 3), []);
    assert.ok(TEMPLATE_KEYS.some((k) => k.key === 'sub_registrar') && TEMPLATE_KEYS.some((k) => k.key === 'project_name'));
  });

  it('names what a blank asks for, and the value still comes from the record with its source', () => {
    const file = project();
    const template = newTemplate(file, { title: 'Form', fileName: 'form.docx', format: 'docx', fileKey: 'k', detected: [detected('Seller (first party)', 0), detected('Survey number', 1)] }, 'asha@builders.example');
    // Only the blank the rules could not read is asked about.
    const toAsk = templateFieldsToAsk(template);
    assert.deepEqual(toAsk.map((field) => field.label), ['Seller (first party)']);
    assert.equal(keepTemplateAsks(template, toAsk, [{ n: 1, key: 'vendor', value: 'Somebody Else' }]), 1);
    assert.deepEqual(template.fields[0]!.asks, { key: 'vendor', by: 'model' });
    const [offer] = templateOffers(file, template.fields[0]!);
    assert.equal(offer!.value, 'Meenakshi Rao');
    assert.equal(offer!.source.title, 'Sale deed');
    // And it is still only an offer.
    assert.deepEqual(templateValues(template), []);
  });
});

describe('a hostile file', () => {
  it('that is a Word file unpacking to more than may be opened is refused before it is read', async () => {
    // Nine megabytes of spaces pack to a few kilobytes.
    const bomb = zipOf([{ name: 'word/document.xml', content: Buffer.alloc(9 * 1024 * 1024, 0x20) }]);
    assert.ok(bomb.length < 64 * 1024);
    await assert.rejects(detectTemplateFields({ originalname: 'form.docx', buffer: bomb }), (err: unknown) => err instanceof TemplateTooLarge && /too large to open as a template/.test(err.message));
    // The limit is on the file's text together: a large part beside a small main part is refused too.
    const beside = zipOf([
      { name: 'word/document.xml', content: `<w:document ${W}><w:body>${p(r('Name: ____'))}</w:body></w:document>` },
      { name: 'word/footnotes.xml', content: Buffer.alloc(9 * 1024 * 1024, 0x20) },
    ]);
    await assert.rejects(detectTemplateFields({ originalname: 'form.docx', buffer: beside }), TemplateTooLarge);
    assert.throws(() => fillDocx(bomb, []), /too large to open as a template/);
  });

  it('that is a workbook unpacking to more than may be opened is refused by the workbook’s own guard', async () => {
    const bomb = zipOf([{ name: 'xl/worksheets/sheet1.xml', content: Buffer.alloc(5 * 1024 * 1024, 0x20) }]);
    await assert.rejects(detectTemplateFields({ originalname: 'form.xlsx', buffer: bomb }), TemplateTooLarge);
  });

  it('that is too large as sent, or no kind of template, is refused', async () => {
    await assert.rejects(detectTemplateFields({ originalname: 'form.docx', buffer: Buffer.alloc(TEMPLATE_LIMITS.fileBytes + 1) }), TemplateTooLarge);
    await assert.rejects(detectTemplateFields({ originalname: 'form.pdf', buffer: Buffer.from('%PDF-') }), /A template is a Word file/);
  });

  it('with thousands of blanks is read no further than the reader looks', () => {
    const many = detectDocxFields(docx(Array.from({ length: 1500 }, (_, n) => p(r(`Item ${n + 1}: ______`))).join('')));
    assert.equal(many.length, TEMPLATE_LIMITS.fields * 5);
  });

  it('with a zip index that points outside the file is refused', () => {
    const good = docx(BODY);
    const cut = Buffer.concat([good.subarray(0, 40), good.subarray(good.length - 200)]);
    assert.throws(() => detectDocxFields(cut), /does not look like a Word document/);
  });
});
