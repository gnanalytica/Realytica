/**
 * A paper reaches the fields that wait for it.
 *
 * Twenty-two invented papers, one of each kind a field reads, each dropped
 * as a person drops one: read here from its text layer, sent to the model
 * reader where the rules made little of it, put on its row, and offered to
 * the fields. What is held:
 *
 * - every paper is recognised as its own kind and filed under its own name,
 *   never in a requirement's slot that only resembles it;
 * - the model reader is told the catalog's own keys for the paper's kind and
 *   answers in them, and a value under a key of its own invention is dropped;
 * - a value is offered once, on the function that owns it, and to the record
 *   the paper names (a parcel by its survey number, a contract by its
 *   number), never as the whole holding;
 * - a record a paper offers is one line to accept;
 * - nothing offered counts until a person accepts it.
 *
 * The model is a local stand-in that answers as a gateway does: a tool call,
 * and no citations. No call leaves the machine.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mergeModelReading, needsModelReading, readIngestLocally } from '../apps/api/src/documents/intake';
import { notReadYetCard } from '../apps/api/src/documents/dropped';
import { confirmProposedType } from '../apps/api/src/documents/register-read';
import { enrichIngestWithDocumentIntelligence } from '../packages/agents/src/project/ingest-intelligence';
import {
  acceptAllFromPaper,
  answerFromFile,
  approvalsRegister,
  proposeFieldValues,
  refChoices,
  resolveFields,
  addEvidence,
  addFieldRecord,
  classifyIngestFile,
  createProject,
  decideField,
  documentAnswers,
  documentWorkstream,
  fieldCatalog,
  fieldRecords,
  fieldState,
  landIngestFile,
  matchReadToRow,
  offerPaperToSheets,
  paperKeyClashes,
  paperKeyGuide,
  paperKeys,
  papersInHand,
  papersNoFieldReads,
  parseDocumentText,
  proposalsFromIngest,
  readDocumentTypes,
  readFunctionFields,
  readSheet,
  RECORD_AS_OFFERED,
  setFieldValues,
  standingFieldLines,
  unknownPaperKinds,
  workstreamDefinition,
  type CheckFieldValue,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
} from '../packages/shared/src';
import { PAPERS, type InventedPaper } from './fixtures/field-papers';

type PaperName = keyof typeof PAPERS;

/** What the stand-in answers for a paper: a key, the value, the words on the page that state it, the page, and a unit. */
type Said = [key: string, value: string, quote: string, page: number, unit?: string];

/** What a model would read off each paper the rules make little of, in the catalog's keys, and one key of its own that no field waits for. */
const MODEL_READS: Partial<Record<PaperName, Said[]>> = {
  commencementCertificate: [['issued_on', '05-03-2026', 'Commencement certificate issued on 5 March 2026', 1]],
  jointDevelopmentAgreement: [
    ['jda_date', '14-02-2025', 'is made at Mysuru on 14-02-2025', 1],
    ['document_number', '3120/2024-25', 'registered as Document No. 3120/2024-25', 1],
    ['owner_share', '38', 'The Owner shall be entitled to 38 percent', 1],
    ['owner_share_percent', '38', 'The Owner shall be entitled to 38 percent', 1],
    ['land_extent', '2,023', 'measuring 2,023 square metres (20 Guntas)', 1, 'sqm'],
    ['refundable_deposit', '1,50,00,000', 'a refundable deposit of Rs. 1,50,00,000', 1, 'INR'],
    ['sanction_due_months', '9', 'obtain plan sanction within 9 months of this agreement', 1],
    ['build_months', '36', 'complete construction within 36 months of plan sanction', 1],
    ['grace_months', '6', 'with a grace period of 6 months', 1],
    ['delay_compensation', '12', 'pay the Owner Rs. 12 per square foot per month', 1],
    ['far_assumed', '2.25', 'The agreement assumes an FAR of 2.25', 1],
    ['sharing', 'Area', 'on an area sharing basis', 1],
  ],
  powerOfAttorney: [
    ['executed_on', '02-08-2019', 'Executed at Mysuru on 02-08-2019', 1],
    ['document_number', '214/2019-20', 'registered as Document No. 214/2019-20', 1],
    ['attorney', 'K. Advocate', 'constitute Sri K. Advocate as my true and lawful attorney', 1],
    ['powersGranted', 'to sell the property', 'The attorney is authorised to sell the property', 1],
  ],
  loanSanctionLetter: [
    ['sanction_ref', 'MB/CF/2026/118', 'Ref: MB/CF/2026/118', 1],
    ['sanction_date', '20-03-2026', 'Date: 20-03-2026', 1],
    ['sanctioned_amount', '12,00,00,000', 'sanction a construction term loan of Rs. 12,00,00,000', 1, 'INR'],
    ['cost_appraised', '31,00,00,000', 'an appraised project cost of Rs. 31,00,00,000', 1, 'INR'],
    ['min_promoter_share', '30', 'Minimum promoter contribution: 30 percent', 1],
    ['kind', 'Construction term loan', 'sanction a construction term loan', 1],
    ['spread', '2.10', 'plus a spread of 2.10 percent', 1],
    ['tenor', '48', 'Tenor: 48 months', 1],
    ['moratorium', '18', 'a moratorium of 18 months', 1],
    ['availability_end', '30-09-2027', 'Availability period ends 30-09-2027', 1],
    ['lenderName', 'Meridian Bank', 'Meridian Bank - Corporate Finance Branch', 1],
  ],
  disbursementAdvice: [
    ['tranche', 'Tranche 1', 'Loan account: MB/CF/2026/118. Tranche 1.', 1],
    ['disbursed_on', '30-06-2026', 'has been disbursed on 30-06-2026', 1],
    ['disbursed_amount', '3,00,00,000', 'an amount of Rs. 3,00,00,000', 1, 'INR'],
  ],
  bankGuarantee: [
    ['guarantee_number', 'HB/BG/2026/0457', 'Guarantee No. HB/BG/2026/0457', 1],
    ['contract_number', 'WO/2026/014', 'having awarded contract WO/2026/014 to Northgate Builders', 1],
    ['guaranteed_amount', '92,00,000', 'up to an amount of Rs. 92,00,000', 1, 'INR'],
    ['issued_on', '10-04-2026', 'Date of issue: 10-04-2026', 1],
    ['valid_until', '30-09-2027', 'shall remain valid until 30-09-2027', 1],
    ['claim_until', '30-12-2027', 'must be lodged on or before 30-12-2027', 1],
  ],
  workOrder: [
    ['contract_number', 'WO/2026/014', 'Work Order No. WO/2026/014', 1],
    ['commencement_date', '15-04-2026', 'Date of commencement: 15-04-2026', 1],
    ['completion_date', '30-06-2027', 'Date for completion: 30-06-2027', 1],
    ['defect_liability_months', '12', 'Defect liability period: 12 months', 1],
    ['contractPrice', '18,40,00,000', 'a contract price of Rs. 18,40,00,000', 1, 'INR'],
  ],
  runningBill: [['billAmount', '1,35,00,000', 'This bill: Rs. 1,35,00,000', 1, 'INR']],
  variationClaim: [
    ['variation_reference', 'VO-09', 'Ref: VO-09', 1],
    ['contract_number', 'WO/2026/014', 'Contract: WO/2026/014, Civil and structure', 1],
    ['amount_claimed', '18,20,000', 'We claim Rs. 18,20,000 for this extra item', 1, 'INR'],
    ['description', 'a transfer beam at podium level was added', 'a transfer beam at podium level was added', 1],
  ],
  timeClaim: [
    ['claim_number', 'TC-01', 'Claim No. TC-01', 1],
    ['contract_number', 'WO/2026/014', 'Contract: WO/2026/014, Civil and structure', 1],
    ['days_claimed', '45', 'We claim an extension of 45 days', 1],
    ['cost_claimed', '31,50,000', 'prolongation cost of Rs. 31,50,000', 1, 'INR'],
  ],
  bid: [
    ['earnest_money_amount', '3,00,000', 'bank guarantee BG/EMD/771 for Rs. 3,00,000', 1, 'INR'],
    ['earnest_money_instrument_number', 'BG/EMD/771', 'Earnest money: bank guarantee BG/EMD/771', 1],
    ['earnest_money_valid_until', '20-10-2026', 'valid to 20-10-2026', 1],
    ['quotedAmount', '2,89,00,000', 'Total quoted amount: Rs. 2,89,00,000', 1, 'INR'],
  ],
  allotmentLetter: [
    ['unit_number', 'A-301', 'allot to you Apartment No. A-301 in Tower A', 1],
    ['agreed_value', '81,00,000', 'for a total price of Rs. 81,00,000', 1, 'INR'],
    ['covered_parking_allotted', '1', 'with 1 covered car park', 1],
    ['allotment_date', '12-05-2026', 'Date: 12-05-2026', 1],
    ['booking_amount_received', '8,10,000', 'the booking amount of Rs. 8,10,000', 1, 'INR'],
  ],
  agreementForSale: [
    ['unit_number', 'A-301', 'agrees to purchase Apartment No. A-301', 1],
    ['consideration', '81,00,000', 'for a total price of Rs. 81,00,000', 1, 'INR'],
    ['agreement_registered_on', '22-06-2026', 'registered on 22-06-2026', 1],
    ['carpet_area', '78.50', 'having a carpet area of 78.50 square metres', 1, 'sqm'],
    ['possession_promised_by', '31-12-2027', 'on or before 31-12-2027', 1],
  ],
  demandLetter: [
    ['demand_number', 'DN-04', 'Demand No. DN-04', 1],
    ['unit_number', 'A-301', 'Unit: A-301', 1],
    ['demand_date', '08-10-2026', 'Date: 08-10-2026', 1],
    ['due_date', '23-10-2026', 'is due on or before 23-10-2026', 1],
    ['principal', '12,15,000', 'the instalment of Rs. 12,15,000', 1, 'INR'],
    ['paymentMilestone', 'fourth floor slab', 'On completion of the fourth floor slab', 1],
  ],
  paymentReceipt: [['receiptNumber', 'RC-0412', 'Receipt No. RC-0412', 1]],
};

/** A guarantee whose words never say what it is: the rules cannot name it, and a model does. */
const UNNAMED: InventedPaper = {
  fileName: 'Instrument_HB_0457.pdf',
  is: 'Bank guarantee',
  pages: ['Harbour Bank - Mysuru Main Branch\nInstrument HB/BG/2026/0457 issued 10-04-2026.\nWe undertake to pay Lakeside Homes LLP up to Rs. 92,00,000 on demand, until 30-09-2027.'],
};
const UNNAMED_READS: Said[] = [
  ['guarantee_number', 'HB/BG/2026/0457', 'Instrument HB/BG/2026/0457 issued 10-04-2026', 1],
  ['guaranteed_amount', '92,00,000', 'up to Rs. 92,00,000 on demand', 1, 'INR'],
  ['valid_until', '30-09-2027', 'on demand, until 30-09-2027', 1],
];

/** A paper as a PDF with a text layer: a line of the page on each line, none wrapped. */
async function pdfOf(paper: InventedPaper): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of paper.pages) {
    const page = doc.addPage([2400, 800]);
    text.split('\n').forEach((line, n) => page.drawText(line, { x: 20, y: 760 - n * 18, size: 9, font }));
  }
  return Buffer.from(await doc.save());
}

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Every value a paper offered that waits or stands on a sheet, by where it is: `set/field` to what the field holds. */
function fromPaper(project: DdProject, evidenceId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const mine = (value: CheckFieldValue) => value.origin?.kind === 'paper' && value.origin.evidenceId === evidenceId;
  for (const [setId, sheet] of Object.entries(project.fieldSheets ?? {})) {
    for (const [key, value] of Object.entries(sheet.values ?? {})) if (mine(value)) out[`${setId}/${key}`] = value.value;
    for (const record of sheet.records ?? []) for (const [key, value] of Object.entries(record.values)) if (mine(value)) out[`${setId}/${key}`] = value.value;
  }
  return out;
}

describe('the catalog of papers', () => {
  it('names no kind of paper the register cannot produce, and reads no fact of a paper into two fields', () => {
    assert.deepEqual(unknownPaperKinds(), [], 'every kind a field says it is read from is one the classifier can produce');
    assert.deepEqual(paperKeyClashes(), [], 'a value read from a paper is offered once: the second place it appears is a mirror');
  });

  it('lists the kinds of paper no field reads yet', () => {
    // Not a fault: a list to work down. A kind added with no field to read it shows here.
    assert.deepEqual(papersNoFieldReads(), ['Zoning certificate', 'Occupancy certificate', 'Utility NOC', 'Certificate of incorporation', 'TDS certificate', 'Running account bill', 'Payment receipt']);
  });

  it('files every kind of paper under a function that exists', () => {
    for (const { label } of readDocumentTypes()) {
      const fn = documentWorkstream(createProject({ name: 'p', type: 'residential', location: 'Kere', city: 'Mysuru' }, 'RYT-1'), { documentType: label, kind: 'document', id: 'e' } as never);
      assert.ok(fn && workstreamDefinition(fn), `${label} is held by a function`);
    }
  });

  it('tells a reader each paper’s keys by the field that waits, with what it holds and what it may be', () => {
    const guide = paperKeyGuide();
    assert.match(guide, /- joint_development_agreement \(Joint development agreement\):\n(?: {6}.*\n)* {6}owner_share: Owners’ share, of Joint development: terms; percent/);
    assert.match(guide, / {6}sharing: Sharing, of Joint development: the facts; one of: Area, Revenue, Both/);
    assert.match(guide, / {6}earnest_money_amount: Amount, of Earnest money; rupees/);
    assert.deepEqual(paperKeys('demand_letter').map((known) => known.key), ['demand_number', 'unit_number', 'demand_date', 'due_date', 'principal']);
    assert.equal(paperKeys('demand_letter').every((known) => fieldCatalog().sets.get(known.field.set)?.fields.some((def) => def.key === known.field.field)), true, 'each is a registered field’s');
  });
});

describe('a paper is recognised as what it is', () => {
  it('each of the invented papers, by the rules alone', () => {
    for (const [name, paper] of Object.entries(PAPERS)) {
      assert.equal(parseDocumentText([...paper.pages], paper.fileName).label, paper.is, name);
    }
  });

  it('a sub-registrar’s place is read whole across the line its paragraph wrapped at', () => {
    // As a text layer gives a page: every paragraph broken where its line ran out of width, the place name after its first word.
    const wrap = (page: string) =>
      page
        .split('\n')
        .map((line) => line.replace(/(.{1,92})(?:\s+|$)/g, '$1\n').trimEnd())
        .join('\n');
    const wrapped = PAPERS.saleDeed.pages.map(wrap);
    assert.match(wrapped[1]!, /Sub-Registrar, Mysuru\nWest, on 23-08-2019/);
    const read = parseDocumentText(wrapped, PAPERS.saleDeed.fileName);
    assert.equal(read.facts.find((fact) => fact.key === 'sub_registrar')?.value, 'Mysuru West');
    assert.equal(read.facts.find((fact) => fact.key === 'boundary_north')?.value, 'Survey No. 40', 'and a short line still ends where it ends');
  });

  it('is matched to a requirement only where the requirement names that kind of paper and nothing else', () => {
    assert.equal(documentAnswers('Joint development agreement', 'Maintenance contracts'), false);
    assert.equal(documentAnswers('Joint development agreement', 'JDA/JV'), true);
    assert.equal(documentAnswers('Variation claim', 'Façade maintenance contract'), false);
    assert.equal(documentAnswers('RTC (record of rights)', 'Title extract'), false);
    assert.equal(documentAnswers('Lease deed', 'Release deed'), false);
    assert.equal(documentAnswers('Occupancy certificate', 'Allocation agreement'), false, 'never on letters inside another word');
    assert.equal(documentAnswers('Sale deed', 'Sale deed (registered conveyance)'), true);
    assert.equal(documentAnswers('Encumbrance certificate', 'Encumbrance certificate (30 years)'), true);
    assert.equal(documentAnswers('Survey sketch', 'Survey plans'), true);

    const project = createProject({ name: 'Kere Bank Residences', type: 'residential', location: 'Kere', city: 'Mysuru' }, 'RYT-0091');
    const slot = addEvidence(project, { title: 'Maintenance contracts', kind: 'contract', status: 'expected' }, 'tester');
    const jda = PAPERS.jointDevelopmentAgreement;
    const read = parseDocumentText([...jda.pages], jda.fileName);
    assert.equal(matchReadToRow(project, { ...read, method: 'text' } as never), undefined, 'a joint development agreement is not what "Maintenance contracts" waits for');
    assert.equal(slot.status, 'expected');

    // Nor is a file nobody could read: it answers a row titled as its kind is, never one that only shares a word with it.
    const facade = addEvidence(project, { title: 'Façade maintenance contract', kind: 'contract', status: 'expected' }, 'tester');
    const contracts = addEvidence(project, { title: 'Contracts', kind: 'contract', status: 'expected' }, 'tester');
    const unread = { fileName: 'Signed_contract_scan.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'k-scan.pdf', readFailure: 'No legible text was found in the file.' };
    assert.equal(classifyIngestFile(project, unread).evidence?.id, contracts.id);
    contracts.status = 'received';
    assert.equal(classifyIngestFile(project, unread).evidence, undefined, 'with no row of its kind waiting, it is a row of its own');
    assert.equal(facade.status, 'expected');
  });
});

describe('a paper dropped in the chat reaches the fields that wait for it', () => {
  let server: ReturnType<typeof createServer>;
  /** What the stand-in was asked, paper by paper: the user's prompt of each reading. */
  const asked: string[] = [];
  const ENV = ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_EXTRACTION', 'REALYTICA_MODEL_PAGE_CHECK'] as const;
  const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

  before(async () => {
    server = createServer(async (req, res) => {
      const call = await body(req);
      const tool = String(call.tools?.[0]?.name ?? '');
      const prompt = String((call.messages[0].content as Array<Record<string, any>>).find((part) => part.type === 'text')?.text ?? '');
      if (tool !== 'record_document_extraction') {
        // A second reading is never needed here: every paper has a text layer, and a value is found in its page's own words.
        streamMessage(res, { values: [] }, tool);
        return;
      }
      asked.push(prompt);
      // A paper the rules could not name is named by the reader: the one such paper here is a guarantee that does not call itself one.
      const paper = /recognised here as: (\w+)/.exec(prompt)?.[1] ?? (prompt.includes(UNNAMED.fileName) ? 'bank_guarantee' : 'other');
      const name = (Object.keys(PAPERS) as PaperName[]).find((key) => readDocumentTypes().find(({ type }) => type === paper)?.label === PAPERS[key].is);
      const fields = (prompt.includes(UNNAMED.fileName) ? UNNAMED_READS : name ? (MODEL_READS[name] ?? []) : []).map(([key, value, quote, page, unit]) => ({ key, label: `${key} as the model names it`, value, unit: unit ?? null, confidence: 0.9, quote, originalValue: null, page }));
      streamMessage(res, { kind: 'other', paper, kindConfidence: 0.9, notes: '', fields }, tool);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    for (const key of ENV) saved[key] = process.env[key];
    process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.REALYTICA_API_KEY = 'test-key';
    process.env.REALYTICA_MODEL_EXTRACTION = 'vendor/reader';
    process.env.REALYTICA_MODEL_PAGE_CHECK = 'other-vendor/checker';
  });

  after(async () => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** A project with what the papers name already on it: three survey numbers, a contract, a unit, and a planned drawdown. */
  function project(): DdProject {
    const p = createProject({ name: 'Kere Bank Residences', type: 'residential', location: 'Kere', city: 'Mysuru' }, 'RYT-0091');
    p.parcelId = 'Sy. No. 41/2, 41/3, 42/1';
    const add = (set: string, values: Record<string, unknown>) => {
      const made = addFieldRecord(p, set, values, 'tester');
      assert.deepEqual(made.rejected, [], set);
      return made.record!;
    };
    add('shared.contracts', { title: 'Civil and structure', reference: 'WO/2026/014' });
    add('shared.units', { number: 'A-301' });
    add('finance.lenders.drawdowns', { tranche: 'Tranche 1' });
    return p;
  }

  /** Drops one paper as the chat does: read here, read by the model where the rules made little of it, put on its row, and offered. */
  async function drop(p: DdProject, name: PaperName | InventedPaper): Promise<{ id: string; file: ChatIngestFile }> {
    const paper = typeof name === 'string' ? PAPERS[name] : name;
    const bytes = await pdfOf(paper);
    let pages: string[] = [];
    const row = { fileName: paper.fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `k-${paper.fileName}` };
    const local = await readIngestLocally(row, bytes, undefined, { onPages: (read) => (pages = read) });
    const [model] = needsModelReading(local) ? await enrichIngestWithDocumentIntelligence({ project: p, files: [local], buffers: [bytes], pageTexts: [pages] }) : [undefined];
    const file = mergeModelReading(local, model);
    const id = landIngestFile(p, file, 'tester');
    assert.ok(id, `${paper.fileName} is put on a row`);
    proposalsFromIngest(p, [{ ...file, landed: true }], 'tester');
    return { id: id!, file };
  }

  const accepts = (p: DdProject, fn: string) => readFunctionFields(p, fn).needs.accept;

  it('files each paper under its own name and kind, in the function that holds that kind', async () => {
    const p = project();
    // A requirement that only resembles a paper, of the kind a paper used to be dropped into.
    addEvidence(p, { title: 'Maintenance contracts', kind: 'contract', status: 'expected' }, 'tester');
    addEvidence(p, { title: 'Façade maintenance contract', kind: 'contract', status: 'expected' }, 'tester');
    addEvidence(p, { title: 'Title extract', kind: 'document', status: 'expected' }, 'tester');
    for (const name of ['jointDevelopmentAgreement', 'variationClaim', 'rtc', 'demandLetter', 'bid', 'runningBill', 'paymentReceipt'] as const) {
      const { id } = await drop(p, name);
      const row = p.evidence.find((e) => e.id === id)!;
      assert.deepEqual([row.title, row.documentType], [PAPERS[name].is, PAPERS[name].is], name);
      assert.ok(documentWorkstream(p, row), `${name} is held by a function`);
    }
    assert.deepEqual(p.evidence.filter((e) => e.status === 'expected').map((e) => e.title), ['Maintenance contracts', 'Façade maintenance contract', 'Title extract'], 'and no requirement was answered by a paper that is not it');
  });

  it('offers a sale deed once, to the purchase it conveys, and never as the whole holding', async () => {
    const p = project();
    const { id } = await drop(p, 'saleDeed');
    assert.deepEqual(asked.filter((prompt) => prompt.includes('Sale_Deed')), [], 'a deed the rules read whole is sent to no model');
    assert.deepEqual(fromPaper(p, id), {
      'legal.contracts.purchases/doc_no': '2317/2019-20',
      'legal.contracts.purchases/sro': 'Mysuru West',
      'legal.contracts.purchases/registration_date': '2019-08-23',
      'legal.contracts.purchases/stamp_duty_paid': 3584000,
      'legal.contracts.purchases/extent_conveyed': 6070,
      'legal.contracts.purchases/consideration': 64000000,
      'legal.title.owners/name': 'Lakeside Homes LLP',
    });
    assert.equal(p.fieldSheets?.['legal.title.holding']?.values.extent, undefined, 'one parcel’s deed is not the extent held');
    assert.equal(fieldRecords(p, 'legal.title.instruments').length + fieldRecords(p, 'finance.tax.instruments').length, 0, 'and it makes no second and third record of itself');

    // One line: the purchase, as the deed states it.
    const lines = accepts(p, 'legal.contracts');
    assert.deepEqual(lines.map((line) => [line.label, line.sheet, line.address?.field, line.whole?.length]), [['New purchase', 'Land purchases', RECORD_AS_OFFERED, 6]]);
    assert.match(lines[0]!.text, /^Document number 2317\/2019-20 · Sub-registrar office Mysuru West · /);
    assert.equal(readSheet(p, 'legal.contracts.land')!.fields.find((f) => f.def.key === 'purchases_count')!.held?.value, 0, 'which is no purchase until a person accepts it');

    // The owner the deed proposes, and the purchase, ask nothing while nobody has accepted them: no Missing line, no rule line,
    // no owner counted, and no name in a list of links. Each is one Accept line and nothing else.
    for (const fn of ['legal.title', 'legal.contracts']) {
      const offered = new Set(fieldRecords(p, fn === 'legal.title' ? 'legal.title.owners' : 'legal.contracts.purchases').map((record) => record.id));
      const about = readFunctionFields(p, fn).exceptions.filter((line) => line.record && offered.has(line.record));
      assert.deepEqual(about.map((line) => [line.need, line.label]), [['accept', fn === 'legal.title' ? 'New owner' : 'New purchase']], fn);
    }
    assert.deepEqual(resolveFields(p).records('legal.title.owners'), [], 'an owner nobody accepted is not an owner to any formula');
    assert.deepEqual(refChoices(p, { set: 'legal.title.owners' }), [], 'and nothing links to one');

    // Accepted once, by whoever may decide for Legal.
    const viewer = { mayDecide: () => false };
    assert.throws(() => decideField(p, lines[0]!.address!, 'accept', 'viewer', {}, viewer), /lead|signer|decide/i);
    decideField(p, lines[0]!.address!, 'accept', 'lead', {}, { mayDecide: () => true });
    assert.deepEqual(accepts(p, 'legal.contracts'), []);
    const [purchase] = fieldRecords(p, 'legal.contracts.purchases');
    assert.deepEqual(Object.values(purchase!.values).map(fieldState), ['accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted']);

    // The same deed dropped again offers nothing twice.
    await drop(p, 'saleDeed');
    assert.equal(fieldRecords(p, 'legal.contracts.purchases').length, 1);
    assert.deepEqual(accepts(p, 'legal.contracts'), []);
  });

  it('shows land in the units its paper writes, with the square metres beside them, and keeps the value the parser read', async () => {
    const p = project();
    await drop(p, 'saleDeed');
    const [purchase] = fieldRecords(p, 'legal.contracts.purchases');
    const view = readSheet(p, 'legal.contracts.purchases', purchase!.id)!.fields.find((f) => f.def.key === 'extent_conveyed')!;
    assert.equal(view.held?.value, 6070, 'the value is the square metres read, not a second sum');
    assert.equal(view.text, '1 acre 20 guntas (6,070 sqm)');
    assert.match(accepts(p, 'legal.contracts')[0]!.text, /Extent conveyed 1 acre 20 guntas \(6,070 sqm\)/);

    // A measure that does not come to the value offered is not kept as what the paper wrote.
    const row = p.evidence[0]!;
    const address = { fn: 'legal.contracts', set: 'legal.contracts.purchases', field: 'extent_conveyed' };
    const [other] = proposeFieldValues(p, [{ address, value: '5000 sqm', written: '9 acres', origin: { kind: 'paper', evidenceId: row.id, page: 1, quote: 'measuring 5000 square metres', reader: 'parser' } }], 'parser');
    const second = readSheet(p, address.set, other!.address.record)!.fields.find((f) => f.def.key === 'extent_conveyed')!;
    assert.doesNotMatch([second.text, ...second.waiting.map((w) => w.text)].join(' '), /9 acres/);
  });

  it('offers an RTC’s extent to its own parcel’s land record, found by survey number', async () => {
    const p = project();
    const land = addFieldRecord(p, 'legal.title.land_records', { parcel: '41/3' }, 'tester').record!;
    addFieldRecord(p, 'legal.title.land_records', { parcel: '41/2' }, 'tester');
    const { id } = await drop(p, 'rtc');
    assert.deepEqual(fromPaper(p, id), { 'legal.title.land_records/rtc_extent': 2833 });
    assert.equal(fieldState(land.values.rtc_extent), 'proposed', 'on the record of Survey No. 41/3');
    assert.equal(fieldRecords(p, 'legal.title.land_records').length, 2, 'and no new record');
    assert.equal(p.fieldSheets?.['legal.title.holding']?.values.extent, undefined);

    // With no record of that parcel yet, it makes one, linked to the parcel the RTC names.
    const q = project();
    const again = await drop(q, 'rtc');
    assert.deepEqual(fromPaper(q, again.id), { 'legal.title.land_records/parcel': '41/3', 'legal.title.land_records/rtc_extent': 2833 });
  });

  it('tells nothing a paper states as a fact until a person accepts it, and accepting it on its field is accepting it on its paper', async () => {
    const p = project();
    const now = new Date('2026-10-13T06:00:00.000Z');
    const order = await drop(p, 'conversionOrder');
    const line = () => approvalsRegister(p, now).find((held) => held.kind.key === 'conversion')!;
    // Read surely by the rules, and still nobody has looked: the Approvals card dates nothing by it.
    assert.equal(line().held[0]!.issuedOn, undefined);
    assert.match(line().say, /What was read off it is waiting to be accepted\.$/);
    const deed = await drop(p, 'saleDeed');
    assert.doesNotMatch(answerFromFile(p, 'What is the property worth?')?.text ?? '', /last changed hands/);

    // Accepted on the field it was offered to, by somebody who may decide: the paper is accepted as stating it.
    decideField(p, { fn: 'legal.title', set: 'legal.title.holding', field: 'conversion_date' }, 'accept', 'lead', {}, { mayDecide: () => true });
    assert.equal(line().held[0]!.issuedOn, '2018-06-12');
    assert.equal(p.evidence.find((e) => e.id === order.id)!.facts!.find((f) => f.key === 'conversion_date')!.review, 'accepted');
    assert.equal(p.evidence.find((e) => e.id === order.id)!.facts!.find((f) => f.key === 'conversion_order_no')?.review ?? 'proposed', 'proposed', 'and only that value');

    // The purchase, taken as the deed offered it: its consideration is then a fact the chat may tell.
    decideField(p, accepts(p, 'legal.contracts')[0]!.address!, 'accept', 'lead', {}, { mayDecide: () => true });
    assert.equal(p.evidence.find((e) => e.id === deed.id)!.facts!.find((f) => f.key === 'consideration')!.review, 'accepted');
    assert.match(answerFromFile(p, 'What is the property worth?')?.text ?? '', /last changed hands for/);
  });

  it('reads the papers the rules know into their fields', async () => {
    const p = project();
    const conversion = await drop(p, 'conversionOrder');
    assert.deepEqual(fromPaper(p, conversion.id), { 'legal.title.holding/conversion_order_no': 'ALN/SR/118/2018-19', 'legal.title.holding/conversion_date': '2018-06-12' });
    const sanction = await drop(p, 'planSanction');
    assert.deepEqual(fromPaper(p, sanction.id), { 'legal.approvals.sanction/plot_area_per_plan': 11129 });
    const ec = await drop(p, 'encumbranceCertificate');
    assert.deepEqual(fromPaper(p, ec.id), { 'legal.title.ec_certificates/from': '1994-01-01', 'legal.title.ec_certificates/to': '2026-09-30' });
    const occupancy = await drop(p, 'occupancyCertificate');
    assert.equal(p.evidence.find((e) => e.id === occupancy.id)!.documentType, 'Occupancy certificate');
  });

  it('reads a revised sanction into one revision record, and never over the first sanction’s fields', async () => {
    const p = project();
    const { id } = await drop(p, 'revisedSanction');
    assert.deepEqual(fromPaper(p, id), {
      'legal.approvals.revisions/revision_no': 'MUDA/TP/AD/123/2026-27',
      'legal.approvals.revisions/sanctioned_on': '2026-10-09',
      'legal.approvals.revisions/built_up_area_after': 20450,
      'legal.approvals.revisions/height_after': 47.8,
      'legal.approvals.revisions/units_after': 104,
    });
    assert.deepEqual(accepts(p, 'legal.approvals').map((line) => line.label), ['New revision']);
    assert.equal(p.chatProposals.some((card) => card.kind === 'record_check_fields'), false, 'no card offers its date or area to the first sanction’s check');
  });

  it('reads a commencement certificate into Liaison’s field, and Tax reads it there', async () => {
    const p = project();
    const { id } = await drop(p, 'commencementCertificate');
    assert.deepEqual(fromPaper(p, id), { 'legal.approvals.occupancy/commencement_on': '2026-03-05' });
    const tax = () => readSheet(p, 'finance.tax.gst')!.fields.find((f) => f.def.key === 'commenced_on')!;
    assert.equal(tax().held?.value ?? null, null, 'a value that waits counts for nothing, in Tax as anywhere');
    assert.equal(tax().missing, false, 'and Tax does not ask a person for what Liaison is offered');
    assert.deepEqual(accepts(p, 'finance.tax'), [], 'it is accepted once, where it is owned');
    acceptAllFromPaper(p, 'legal.approvals', id, 'lead', { mayDecide: () => true });
    assert.equal(tax().held?.value, '2026-03-05');
  });

  it('reads a joint development agreement into the catalog’s own keys, and drops a key of the reader’s own', async () => {
    const p = project();
    const { id, file } = await drop(p, 'jointDevelopmentAgreement');
    const prompt = asked.find((said) => said.includes('Joint_Development_Agreement'))!;
    assert.match(prompt, /recognised here as: joint_development_agreement \(Joint development agreement\)/);
    assert.match(prompt, /Fields are waiting for these of its keys: jda_date, document_number, owner_share, land_extent, /);
    assert.match(prompt, /Give nothing under a key of your own/);
    assert.equal(file.read!.facts.some((fact) => fact.key === 'owner_share_percent'), false, 'a key no field waits for is not kept');
    assert.ok(file.read!.facts.filter((fact) => fact.source === 'model').every((fact) => !/as the model names it/.test(fact.label)), 'and no value carries a label the model wrote');
    assert.deepEqual(fromPaper(p, id), {
      'legal.contracts.jda/jda_date': '2025-02-14',
      'legal.contracts.jda/jda_doc_no': '3120/2024-25',
      'legal.contracts.jda/owner_share': 38,
      'legal.contracts.jda/land_extent': 2023,
      'legal.contracts.jda/refundable_deposit': 15000000,
      'legal.contracts.jda/delay_compensation': 12,
      'legal.contracts.jda/far_assumed': 2.25,
      'legal.contracts.jda_delivery/sanction_due_months': 9,
      'legal.contracts.jda_delivery/build_months': 36,
      'legal.contracts.jda_delivery/grace_months': 6,
      'finance.tax.jda/sharing': 'area',
    });
    const share = p.fieldSheets!['legal.contracts.jda']!.values.owner_share!;
    assert.deepEqual([fieldState(share), share.origin], ['proposed', { kind: 'paper', evidenceId: id, page: 1, quote: 'The Owner shall be entitled to 38 percent', reader: 'model', proof: 'page_text' }]);
    assert.equal(readSheet(p, 'finance.feasibility.revenue')!.fields.find((f) => f.def.key === 'owner_share_assumed_pct')!.state, 'empty', 'the appraisal’s assumption is not a second place to accept the agreement’s share');
  });

  it('offers nothing of a paper only a model has named, until a person confirms what it is', async () => {
    const p = project();
    const { id } = await drop(p, UNNAMED);
    const row = p.evidence.find((e) => e.id === id)!;
    assert.deepEqual([row.documentType, row.proposedDocumentType], [undefined, 'Bank guarantee'], 'a model’s word for the paper is an offer');
    assert.deepEqual((row.facts ?? []).map((f) => [f.key, f.label, f.review]), [['guarantee_number', 'Guarantee or instrument number', 'proposed'], ['guaranteed_amount', 'Amount', 'proposed'], ['valid_until', 'Valid until', 'proposed']]);
    assert.deepEqual(fromPaper(p, id), {}, 'and a paper of no kind reaches no field');
    assert.equal(confirmProposedType(p, id, 'lead'), true);
    assert.deepEqual(fromPaper(p, id), {
      'procurement.vendors.securities/number': 'HB/BG/2026/0457',
      'procurement.vendors.securities/amount': 9200000,
      'procurement.vendors.securities/valid_to': '2027-09-30',
    });
    assert.deepEqual(accepts(p, 'procurement.vendors').map((line) => [line.label, line.oneAtATime]), [['New security', false]]);
  });

  it('reads the other papers of a project into the records they name', async () => {
    const p = project();
    const [contract] = fieldRecords(p, 'shared.contracts');
    const [unit] = fieldRecords(p, 'shared.units');
    const [drawdown] = fieldRecords(p, 'finance.lenders.drawdowns');
    const read = async (name: PaperName) => fromPaper(p, (await drop(p, name)).id);

    assert.deepEqual(await read('powerOfAttorney'), { 'legal.contracts.attorneys/dated': '2019-08-02', 'legal.contracts.attorneys/doc_no': '214/2019-20' });
    assert.deepEqual(await read('loanSanctionLetter'), {
      'finance.lenders.facilities/kind': 'construction_term_loan',
      'finance.lenders.facilities/sanction_ref': 'MB/CF/2026/118',
      'finance.lenders.facilities/sanction_date': '2026-03-20',
      'finance.lenders.facilities/sanctioned_amount': 120000000,
      'finance.lenders.facilities/cost_appraised': 310000000,
      'finance.lenders.facilities/min_promoter_share': 30,
      'finance.lenders.facilities/spread': 2.1,
      'finance.lenders.facilities/tenor': 48,
      'finance.lenders.facilities/moratorium': 18,
      'finance.lenders.facilities/availability_end': '2027-09-30',
    });
    assert.equal(fieldRecords(p, 'finance.funding.sources').length, 0, 'the sanctioned amount is the facility’s, and makes no second record under Funding');

    assert.deepEqual(await read('disbursementAdvice'), { 'finance.lenders.drawdowns/disbursed_on': '2026-06-30', 'finance.lenders.drawdowns/disbursed_amount': 30000000 });
    assert.equal(fieldState(drawdown!.values.disbursed_amount), 'proposed', 'on the drawdown the advice names, Tranche 1');
    assert.equal(fieldRecords(p, 'finance.lenders.drawdowns').length, 1);

    assert.deepEqual(await read('bankGuarantee'), {
      'procurement.vendors.securities/number': 'HB/BG/2026/0457',
      'procurement.vendors.securities/contract': contract!.id,
      'procurement.vendors.securities/amount': 9200000,
      'procurement.vendors.securities/issued_on': '2026-04-10',
      'procurement.vendors.securities/valid_to': '2027-09-30',
      'procurement.vendors.securities/claim_until': '2027-12-30',
    });
    assert.deepEqual(await read('workOrder'), {
      'shared.contracts/start_on': '2026-04-15',
      'shared.contracts/completion_on': '2027-06-30',
      'shared.contracts/defects_months': 12,
    });
    assert.equal(fieldState(contract!.values.start_on), 'proposed', 'on the contract it numbers, and no second contract');
    assert.equal(fieldRecords(p, 'shared.contracts').length, 1);

    assert.deepEqual(await read('variationClaim'), { 'procurement.orders.variations/ref': 'VO-09', 'procurement.orders.variations/contract': contract!.id, 'procurement.orders.variations/claimed': 1820000 });
    assert.deepEqual(await read('timeClaim'), {
      'procurement.orders.time_claims/claim_no': 'TC-01',
      'procurement.orders.time_claims/contract': contract!.id,
      'procurement.orders.time_claims/days_claimed': 45,
      'procurement.orders.time_claims/cost_claimed': 3150000,
    });
    // What the work order states of the contract is Procurement's to accept: the contract is a shared record, and the paper is filed under Orders.
    assert.deepEqual(accepts(p, 'procurement.orders').map((line) => line.label), ['New variation', 'New time claim', 'Commencement date', 'Completion date', 'Defect liability period']);
    assert.deepEqual(accepts(p, 'procurement.vendors').map((line) => line.label), ['New security'], 'and nothing of the contract is listed under a function its paper is not filed in');
    assert.deepEqual(await read('bid'), {
      'procurement.boq.earnest_money/amount': 300000,
      'procurement.boq.earnest_money/reference': 'BG/EMD/771',
      'procurement.boq.earnest_money/valid_to': '2026-10-20',
    });

    assert.deepEqual(await read('allotmentLetter'), {
      'shared.units/sale_agreed_value': 8100000,
      'shared.units/sale_covered_parking': 1,
      'shared.units/sale_allotted_on': '2026-05-12',
      'shared.units/sale_received_before_agreement': 810000,
    });
    assert.deepEqual(await read('agreementForSale'), {
      'shared.units/price_for_tax': 8100000,
      'shared.units/sale_agreement_registered_on': '2026-06-22',
      'shared.units/sale_carpet_in_agreement': 78.5,
      'shared.units/sale_possession_promised': '2027-12-31',
    });
    assert.equal(fieldState(unit!.values.sale_agreed_value), 'proposed', 'both on unit A-301, and no second unit');
    assert.equal(fieldRecords(p, 'shared.units').length, 1);

    assert.deepEqual(await read('demandLetter'), {
      'commercial.buyers.demands/demand_no': 'DN-04',
      'commercial.buyers.demands/unit': unit!.id,
      'commercial.buyers.demands/raised_on': '2026-10-08',
      'commercial.buyers.demands/due_on': '2026-10-23',
      'commercial.buyers.demands/principal': 1215000,
    });
    assert.deepEqual(accepts(p, 'commercial.buyers').map((line) => [line.label, line.source?.label]), [['New demand', 'Demand letter']]);

    // Nothing of any of it counts until a person accepts it.
    assert.deepEqual(standingFieldLines(p).filter((line) => line.value.origin?.kind === 'paper').map((line) => line.address.field), [], 'no value of any of these papers stands');
    // A paper no field reads is still filed as what it is, and offers nothing.
    assert.deepEqual(await read('runningBill'), {});
    assert.deepEqual(await read('paymentReceipt'), {});
    assert.deepEqual(p.evidence.filter((e) => ['Running account bill', 'Payment receipt'].includes(e.documentType ?? '')).map((e) => e.facts?.length ?? 0), [0, 0], 'with no value under a name of the model’s own');
  });
});

describe('a record a paper names', () => {
  const fact = (key: string, value: DocumentFact['value'], more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label: key, value, display: String(value), page: 1, quote: `the ${key} is ${String(value)}`, source: 'parser', ...more });
  const paper = (p: DdProject, type: string) => {
    const row = addEvidence(p, { title: type, kind: 'document' }, 'tester');
    row.documentType = type;
    return row;
  };
  const project = () => createProject({ name: 'Kere Bank Residences', type: 'residential', location: 'Kere', city: 'Mysuru' }, 'RYT-0091');

  it('is the record that already holds that name, so a second copy of a certificate makes no second certificate', () => {
    const p = project();
    const held = addFieldRecord(p, 'legal.title.ec_certificates', { certificate_no: 'EC/MYW/2026/1002', from: '1994-01-01', to: '2026-09-30', result: 'entries' }, 'tester').record!;
    const facts = [fact('ec_certificate_number', 'EC/MYW/2026/1002'), fact('ec_from', '1994-01-01'), fact('ec_to', '2026-09-30'), fact('ec_issued_on', '2026-10-05')];
    const out = offerPaperToSheets(p, paper(p, 'Encumbrance certificate').id, facts);
    assert.deepEqual(out.map((o) => [o.address.field, o.address.record, o.outcome]), [['certificate_no', held.id, 'held'], ['from', held.id, 'held'], ['to', held.id, 'held'], ['issued_on', held.id, 'waiting']]);
    assert.equal(fieldRecords(p, 'legal.title.ec_certificates').length, 1);
    // Found by its number however the paper spaces it.
    const spaced = offerPaperToSheets(p, paper(p, 'Encumbrance certificate').id, [fact('ec_certificate_number', 'EC / MYW / 2026 / 1002'), fact('ec_from', '1994-01-01')]);
    assert.deepEqual([...new Set(spaced.map((o) => o.address.record))], [held.id]);
    // A certificate of another number is another record.
    offerPaperToSheets(p, paper(p, 'Encumbrance certificate').id, [fact('ec_certificate_number', 'EC/MYW/2026/2217'), fact('ec_from', '2010-01-01')]);
    assert.equal(fieldRecords(p, 'legal.title.ec_certificates').length, 2);
  });

  it('is never a parcel the paper does not name alone: a paper for three survey numbers is offered to no one parcel’s record', () => {
    const p = project();
    p.parcelId = 'Sy. No. 41/2, 41/3';
    addFieldRecord(p, 'legal.title.land_records', { parcel: '41/3' }, 'tester');
    const [held] = fieldRecords(p, 'legal.title.land_records');
    const out = offerPaperToSheets(p, paper(p, 'RTC (record of rights)').id, [fact('survey_numbers', '41/2, 41/3'), fact('extent_title', 8903)]);
    assert.deepEqual(out.map((o) => [o.address.field, o.outcome]), [['rtc_extent', 'waiting']], 'its extent alone, with no parcel: a person links it');
    assert.equal(held!.values.rtc_extent, undefined, 'and not on the record of Survey No. 41/3');
    assert.equal(fieldRecords(p, 'legal.title.land_records').length, 2);
  });

  it('takes a model’s reading only when asked to hand on what waits, and never a value a person set aside or two readers differ on', () => {
    const p = project();
    const row = paper(p, 'Joint development agreement');
    const waiting = [fact('owner_share', 38, { source: 'model', review: 'proposed' }), fact('far_assumed', 2.25, { source: 'model', review: 'rejected' }), fact('jda_date', '2025-02-14', { otherReading: fact('jda_date', '2025-02-15', { source: 'model' }) })];
    assert.deepEqual(offerPaperToSheets(p, row.id, waiting), [], 'not to a caller that hands on only what stands');
    assert.deepEqual(offerPaperToSheets(p, row.id, waiting, undefined, { waiting: true }).map((o) => [o.address.field, o.outcome]), [['owner_share', 'waiting']]);
    assert.equal(fieldState(p.fieldSheets!['legal.contracts.jda']!.values.owner_share), 'proposed', 'where it waits, and counts for nothing');
  });

  it('is accepted as one line, leaves what a person has to name, and is refused to whoever may not decide', () => {
    const p = project();
    const row = paper(p, 'Demand letter');
    // The amount has only a second model's reading behind it: a person names that one.
    offerPaperToSheets(p, row.id, [fact('demand_number', 'DN-04', { source: 'model', proof: 'page_text' }), fact('due_date', '2026-10-23', { source: 'model', proof: 'page_text' }), fact('principal', 1215000, { source: 'model', proof: 'second_reader' })], undefined, { waiting: true });
    const [line] = readFunctionFields(p, 'commercial.buyers').needs.accept;
    assert.deepEqual([line!.label, line!.address?.field, line!.oneAtATime, line!.whole?.map((at) => at.field)], ['New demand', RECORD_AS_OFFERED, true, ['demand_no', 'due_on', 'principal']]);
    assert.throws(() => decideField(p, line!.address!, 'accept', 'viewer', {}, { mayDecide: () => false }));
    assert.throws(() => decideField(p, line!.address!, 'keep', 'lead', {}, { mayDecide: () => true }), /accepted or set aside/);
    decideField(p, line!.address!, 'accept', 'lead', {}, { mayDecide: () => true });
    const after = readFunctionFields(p, 'commercial.buyers').needs.accept;
    assert.deepEqual(after.map((left) => [left.label, left.address?.field, left.oneAtATime]), [['Demanded, before tax', 'principal', true]], 'what had to be named still waits, on a record that now is one');

    // And a record nobody wants is left, as one line.
    const q = project();
    offerPaperToSheets(q, paper(q, 'Demand letter').id, [fact('demand_number', 'DN-05'), fact('due_date', '2026-11-23')]);
    const [other] = readFunctionFields(q, 'commercial.buyers').needs.accept;
    decideField(q, other!.address!, 'set_aside', 'lead', {}, { mayDecide: () => true });
    assert.deepEqual(readFunctionFields(q, 'commercial.buyers').needs.accept, []);
  });

  it('keeps a typed record’s own lines: a value offered to a record a person made is accepted field by field', () => {
    const p = project();
    const made = addFieldRecord(p, 'commercial.buyers.demands', { demand_no: 'DN-04' }, 'tester').record!;
    setFieldValues(p, { set: 'commercial.buyers.demands', record: made.id }, { demand_no: 'DN-04' }, 'tester');
    offerPaperToSheets(p, paper(p, 'Demand letter').id, [fact('demand_number', 'DN-04'), fact('due_date', '2026-10-23')]);
    assert.deepEqual(readFunctionFields(p, 'commercial.buyers').needs.accept.map((line) => [line.label, line.record]), [['Due on', made.id]]);
  });
});

describe('papers dropped and still being read', () => {
  it('are said to be under way while a request could still be reading them, and left unread after', () => {
    const p = createProject({ name: 'Kere Bank Residences', type: 'residential', location: 'Kere', city: 'Mysuru' }, 'RYT-0091');
    const note = (fileName: string) => notReadYetCard({ fileName, mimeType: 'application/pdf', sizeBytes: 9, storageKey: `k-${fileName}` }, 'tester');
    p.chatProposals.push(note('rtc.pdf'), note('jda.pdf'));
    const began = Date.parse(String(p.chatProposals[0]!.payload.readingSince));
    assert.deepEqual(papersInHand(p, new Date(began + 60_000)).reading.map((paper) => paper.fileName), ['rtc.pdf', 'jda.pdf']);
    assert.deepEqual(papersInHand(p, new Date(began + 60_000)).unread, []);
    // One lands on its row: it is no longer in hand.
    const row = addEvidence(p, { title: 'RTC (record of rights)', kind: 'document' }, 'tester');
    row.attachments.push({ id: 'f1', fileName: 'rtc.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'k-rtc.pdf', uploadedAt: new Date().toISOString() } as never);
    assert.deepEqual(papersInHand(p, new Date(began + 60_000)).reading.map((paper) => paper.fileName), ['jda.pdf']);
    // Past the longest a request runs, nobody is reading it.
    const late = papersInHand(p, new Date(began + 20 * 60_000));
    assert.deepEqual([late.reading, late.unread.map((paper) => paper.fileName)], [[], ['jda.pdf']]);
  });
});
