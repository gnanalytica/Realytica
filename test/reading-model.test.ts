/**
 * What the model reader is sent, and what comes back from it.
 *
 * More papers go to an outside model now: the ones this server could not read
 * well. So what leaves is held here. Only the pages the router named are cut
 * out and sent; a page the model names is put back where it sits in the whole
 * file; and a value it reads under one of the rules' own keys is kept in the
 * rules' own form, with its words still checked on its page.
 *
 * And what comes back is held to three things. A value that has to be exact
 * is in the words quoted for it. Words are found on a page only with the
 * value's own among them, and only on a page that was sent. And the second
 * reader is asked blind: it is sent a page and the names of what to read, and
 * never what the first reader read.
 *
 * The model is a local stand-in that answers as a gateway does: a tool call,
 * and no citations.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { enrichIngestWithDocumentIntelligence } from '../packages/agents/src/project/ingest-intelligence';
import { addEvidence, attachEvidenceFile, createProject, needsReadingAgain, readingLine, STANDARD_FACT_KEYS, type ChatIngestFile, type ReadingCoverage } from '../packages/shared/src';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeModelReading, pagesOf, readIngestLocally } from '../apps/api/src/documents/intake';
import { releaseOcr } from '../apps/api/src/documents/read-text';
import { confirmProposedType, correctProposedType, readOntoRegister, setAsideProposedType } from '../apps/api/src/documents/register-read';

/** Each page of the test PDF is one point wider than the last, so the stand-in can tell which pages it was shown. */
const PAGE_TEXT = [
  'This deed recites an earlier Sale Deed registered as Document No. 1184/2003-04 at Suvarnagiri',
  'The schedule land is bounded on the north by Survey No. 72 and on the south by Temple Tank Road',
  'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021. Stamp duty paid: Rs. 17,83,600',
];
const pageWidth = (page: number): number => 500 + page;

async function pdfOf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((text, i) => doc.addPage([pageWidth(i + 1), 700]).drawText(text, { x: 20, y: 600, size: 10, font }));
  return Buffer.from(await doc.save());
}

const threePagePdf = (): Promise<Buffer> => pdfOf(PAGE_TEXT);

interface Asked {
  /** The pages of the original the stand-in was shown, read off their widths. */
  pages: number[];
  prompt: string;
  guide: string;
}

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', {
    type: 'message_start',
    message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } },
  });
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

const field = (key: string, value: string, quote: string, page: number | null, unit: string | null = null, originalValue: string | null = null) => ({ key, label: key, value, unit, confidence: 0.9, quote, originalValue, page });

/** What a second reader read on a page for one of the rules' keys: the value as the page states it, and the words it read it from. */
type SecondRead = { value: string; words: string; unit?: string; originalValue?: string };
const KEY_OF_LABEL = new Map(Object.entries(STANDARD_FACT_KEYS).map(([key, known]) => [known.label, key]));

/** The words this server's OCR read on a Kannada page: Kannada for the labels, Latin for a name and the numbers. */
const KANNADA_PAGE = 'ಖಾತಾ ಪ್ರಮಾಣ ಪತ್ರ. ಈ ಕಚೇರಿಯ ಖಾತಾ ವಹಿಯಲ್ಲಿ ದಾಖಲಾಗಿರುತ್ತದೆ. ಖಾತಾ ಸಂಖ್ಯೆ: 1907/88/3. ಮಾಲೀಕರ ಹೆಸರು: ರತ್ನಮ್ಮ, Smt. Rathnamma Siddalingaiah';

describe('the model reader, sent the pages this server could not read well', () => {
  const asked: Asked[] = [];
  let pageChecks = 0;
  /** Everything the second reader was sent in words, call by call: its instructions and the names of what to read. */
  const secondWasSent: string[] = [];
  /** What the stand-in answers with, set by each test: the kind and the paper it takes the file for, and the fields it read. */
  let kind = 'title_deed';
  let paper: string | null = 'sale_deed';
  let answer: (shown: number[]) => ReturnType<typeof field>[] = () => [];
  /** What the second reader reads off a page for a key, or null when the page does not state it. It finds nothing unless a test says what the page prints. */
  let secondReads: (page: number, key: string) => SecondRead | null = () => null;
  /** When set, the second reader takes the request and never answers, while the first reader still does. */
  let silentSecond = false;
  /** When set, the endpoint takes the request and never answers. */
  let silent = false;
  /** Whether the answer carries its `notes`. A reader through a gateway that does not hold it to the form leaves them out now and then. */
  let withNotes = true;
  let server: ReturnType<typeof createServer>;
  const ENV = ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_EXTRACTION', 'REALYTICA_MODEL_PAGE_CHECK'] as const;
  const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

  before(async () => {
    server = createServer(async (req, res) => {
      const call = await body(req);
      if (silent) return;
      const tool = String(call.tools?.[0]?.name ?? '');
      const [part, text] = call.messages[0].content as Array<Record<string, any>>;
      const sent = await PDFDocument.load(Buffer.from(part!.source.data, 'base64'));
      const pages = sent.getPages().map((page) => Math.round(page.getWidth()) - 500);
      if (tool !== 'record_document_extraction') {
        // A second reading, shown one page and the names of what to read: it gives what the test says that page states, and finds nothing otherwise.
        pageChecks += 1;
        secondWasSent.push(`${(call.system as Array<{ text: string }>).map((block) => block.text).join('\n')}\n${String(text?.text ?? '')}`);
        if (silentSecond) return;
        const keys = String(text?.text ?? '').split('\n').slice(1).map((line) => KEY_OF_LABEL.get(line.replace(/^\d+\.\s*/, '').split(':')[0]!) ?? '');
        streamMessage(
          res,
          {
            values: keys.map((key, i) => {
              const read = secondReads(pages[0]!, key);
              return { n: i + 1, found: read !== null, legible: true, value: read?.value ?? null, unit: read?.unit ?? null, originalValue: read?.originalValue ?? null, words: read?.words ?? null };
            }),
          },
          tool,
        );
        return;
      }
      asked.push({ pages, prompt: String(text?.text ?? ''), guide: (call.system as Array<{ text: string }>).map((block) => block.text).join('\n') });
      streamMessage(res, { kind, ...(paper ? { paper } : {}), kindConfidence: 0.9, ...(withNotes ? { notes: '' } : {}), fields: answer(pages) }, tool);
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

  const project = () => createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
  const coverage = (modelPages: number[]): ReadingCoverage => ({ pagesInFile: 3, pagesRead: 3, readers: { text: 3, ocr: 0, model: 0 }, modelReasons: ['OCR was unsure of the pages named.'], modelPages });

  async function read(file: Partial<ChatIngestFile>, pageTexts: string[] = PAGE_TEXT, stopAt?: number): Promise<ChatIngestFile> {
    asked.length = 0;
    pageChecks = 0;
    secondWasSent.length = 0;
    const [out] = await enrichIngestWithDocumentIntelligence({
      project: project(),
      files: [{ fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', ...file }],
      buffers: [await threePagePdf()],
      pageTexts: [pageTexts],
      ...(stopAt !== undefined ? { stopAt } : {}),
    });
    return out!;
  }

  it('sends only the pages the router named, and puts a value back on its page of the whole file', async () => {
    // Shown pages 1 and 3, the model calls them 1 and 2.
    answer = () => [field('document_number', 'HRK-1-03127-2021-22', 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021', 2)];
    const out = await read({ reading: coverage([1, 3]) });
    assert.deepEqual(asked.map((a) => a.pages), [[1, 3]], 'page 2 never left');
    assert.match(asked[0]!.prompt, /You are shown 2 of its 3 pages: 1, 3 of the original\. Count pages as they are given to you, from 1\./);
    assert.deepEqual(out.modelFacts?.map((f) => [f.key, f.value, f.page, f.pageCheck, f.proof]), [['document_number', 'HRK-1-03127-2021-22', 3, 'text', 'page_text']]);
    assert.deepEqual([out.reading?.modelPagesSent, out.reading?.modelPagesRead], [[1, 3], [3]], 'what was sent is said, and of that only the page a value was found on counts as read');
    assert.equal(pageChecks, 0, 'its words were found in the file’s own text, so no page was sent a second time');
  });

  it('sends the whole file when every page is named, or none is', async () => {
    answer = () => [];
    await read({ reading: coverage([1, 2, 3]) });
    assert.deepEqual(asked[0]!.pages, [1, 2, 3]);
    assert.doesNotMatch(asked[0]!.prompt, /You are shown/);
    await read({});
    assert.deepEqual(asked[0]!.pages, [1, 2, 3], 'a row this server did not read this turn is read whole, as before');
  });

  it('tells the model the rules’ own keys, and keeps a value under one in the rules’ own form', async () => {
    answer = () => [
      field('registration_date', '09-07-2021', 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021', 3),
      field('stamp_duty', 'Rs. 17,83,600', 'Stamp duty paid: Rs. 17,83,600', 3, 'INR'),
      field('boundary_north', 'Survey No. 72', 'bounded on the north by Survey No. 72', 2),
      // A name of the model's own passes through as it is.
      field('roadName', 'Temple Tank Road', 'on the south by Temple Tank Road', 2),
      // Not a date, so not filed as one.
      field('conversion_date', 'some time in the monsoon', 'This deed recites an earlier Sale Deed', 1),
    ];
    const out = await read({});
    assert.match(asked[0]!.guide, /Standard keys, for a document of any kind\./);
    assert.match(asked[0]!.guide, /- sale_deed \(Sale deed\): survey_numbers, extent_title, registration_date, document_number/, 'each paper with the keys it carries');
    assert.match(asked[0]!.guide, /- registration_date: the date the document itself was registered or executed/);
    assert.match(asked[0]!.guide, /under the keys boundary_north, boundary_east, boundary_south and boundary_west/, 'and the schedule is asked for under those same keys');
    const facts = Object.fromEntries((out.modelFacts ?? []).map((f) => [f.key, [f.value, f.unit, f.label, f.page]]));
    assert.deepEqual(facts, {
      registration_date: ['2021-07-09', undefined, 'Registered on', 3],
      stamp_duty: [1783600, 'INR', 'Stamp duty', 3],
      boundary_north: ['Survey No. 72', undefined, 'North boundary', 2],
      roadName: ['Temple Tank Road', undefined, 'roadName', 2],
    });
    assert.ok((out.modelFacts ?? []).every((f) => f.source === 'model' && f.pageCheck === 'text' && f.proof === 'page_text'), 'each still with its words found on its page, and saying so');
  });

  it('files no exact value that is not in its own quote, whatever its form, and no value that says it could not be read', async () => {
    answer = () => [
      // The quote is on the page; the value given for it is a digit short.
      field('stamp_duty', '1,78,360', 'Stamp duty paid: Rs. 17,83,600', 3, 'INR'),
      // The shape of the run of 5 October: the date in the quote, and another one given as the value.
      field('registration_date', '09-01-2021', 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021', 3),
      field('document_number', 'HRK-1-03127-2021-22', 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021', 3),
      field('vendor', 'Sri [name obscured by stamp]', 'This deed recites an earlier Sale Deed', 1),
      field('purchaser', 'illegible', 'This deed recites an earlier Sale Deed', 1),
    ];
    // A second reader that would agree with the wrong date, were it asked. It is not: the value fails on its own quote first.
    secondReads = (_page, key) => (key === 'registration_date' ? { value: '09-01-2021', words: 'on 09-01-2021' } : null);
    const out = await read({});
    secondReads = () => null;
    assert.deepEqual(out.modelFacts?.map((f) => [f.key, f.value]), [['document_number', 'HRK-1-03127-2021-22']]);
    assert.deepEqual(
      out.modelUnverified?.map((f) => [f.key, f.value, f.page, f.proof]),
      [['stamp_duty', 178360, 3, 'unverified'], ['registration_date', '2021-01-09', 3, 'unverified']],
      'the amount and the date their own quotes do not state are kept apart as unverified, with the page named for them; a value that says it could not be read is kept nowhere',
    );
    const askedFor = secondWasSent.map((sent) => sent.split('Read these from the page:')[1] ?? '').join('\n');
    assert.equal(/Registered on|Stamp duty/.test(askedFor), false, 'and nobody is asked to read a second time a value its own quote contradicts');
  });

  it('holds an area, a width and a count to their quotes as it does a date', async () => {
    kind = 'other';
    paper = 'zoning_certificate';
    const pages = ['Zoning certificate for the land in Survey No. 73/4', 'The land abuts a road 30 feet wide. Permissible FAR: 2.25', 'Issued on request'];
    answer = () => [
      field('road_width_ft', '60', 'The land abuts a road 30 feet wide', 2, 'ft'),
      field('permissible_far', '2.25', 'Permissible FAR: 2.25', 2),
      field('survey_numbers', '73/4', 'for the land in Survey No. 73/4', 1),
    ];
    const out = await read({}, pages);
    kind = 'title_deed';
    paper = 'sale_deed';
    assert.deepEqual(out.modelFacts?.map((f) => [f.key, f.value, f.proof]), [['permissible_far', 2.25, 'page_text'], ['survey_numbers', '73/4', 'page_text']]);
    assert.deepEqual(out.modelUnverified?.map((f) => [f.key, f.value, f.proof]), [['road_width_ft', 60, 'unverified']], '60 for a page that prints 30, as measured on 5 October');
  });

  it('hands back apart what it read under a rules’ key and could place on no page', async () => {
    answer = () => [
      field('registration_date', '18-11-2003', 'registered on the eighteenth of November', 1),
      field('sub_registrar', 'Suvarnagiri', 'in the office of the Sub-Registrar of Suvarnagiri taluk', null),
      field('sellerName', 'Somebody', 'conveyed by Somebody', null),
    ];
    const out = await read({});
    assert.deepEqual(out.modelFacts, undefined, 'none of them is a fact');
    assert.deepEqual(
      out.modelUnverified?.map((f) => [f.key, f.value, f.page, f.proof, f.source]),
      [['registration_date', '2003-11-18', 1, 'unverified', 'model'], ['sub_registrar', 'Suvarnagiri', 0, 'unverified', 'model']],
      'a date its own quote does not state, and a value nothing could look for, are handed back apart and marked; a name of the model’s own that nothing could check is not',
    );
    assert.deepEqual([out.reading?.modelPagesSent, out.reading?.modelPagesRead], [[1, 2, 3], []], 'and no page counts as read by the model');
  });

  it('takes a value under one of the rules’ keys only on the kind of paper that carries the key', async () => {
    // A record of rights, by the model's own account, with a nil-encumbrance answer and a sale price on it.
    kind = 'other';
    paper = 'rtc';
    answer = () => [
      field('ec_nil', 'yes', 'This deed recites an earlier Sale Deed', 1),
      field('consideration', 'Rs. 17,83,600', 'Stamp duty paid: Rs. 17,83,600', 3, 'INR'),
      field('survey_numbers', 'Survey No. 72', 'bounded on the north by Survey No. 72', 2),
    ];
    const rtc = await read({});
    assert.deepEqual(rtc.modelFacts?.map((f) => [f.key, f.value]), [['survey_numbers', '72']], 'a survey number is a record of rights’ to state; a nil encumbrance and a price are not');

    // No paper named, and a kind the rules have by name: the kind says which paper it is.
    kind = 'encumbrance_certificate';
    paper = null;
    const ec = await read({});
    assert.deepEqual(ec.modelFacts?.map((f) => [f.key, f.value]), [['ec_nil', true], ['survey_numbers', '72']]);

    // Neither: none of the rules' keys is taken.
    kind = 'other';
    const none = await read({});
    assert.equal(none.modelFacts, undefined);
    kind = 'title_deed';
    paper = 'sale_deed';
  });

  it('keeps a reading whose kind is given in the rules’ name for the paper, and one whose kind the catalogue does not have', async () => {
    // Told the papers by the rules' names, a reader writes one where the kind goes: "rtc" is a paper and no kind of document here.
    answer = () => [field('survey_numbers', 'Survey No. 72', 'bounded on the north by Survey No. 72', 2)];
    kind = 'rtc';
    paper = 'rtc';
    const both = await read({});
    assert.deepEqual(both.modelFacts?.map((f) => [f.key, f.value]), [['survey_numbers', '72']], 'the reading is kept, and read as that paper');
    assert.equal(both.readFailure, undefined);

    // The same with no paper named: the kind says which paper it is.
    kind = 'survey_sketch';
    paper = null;
    const byKind = await read({});
    assert.deepEqual(byKind.modelFacts?.map((f) => [f.key, f.value]), [['survey_numbers', '72']]);

    // A paper's name the reader spelt its own way.
    kind = 'other';
    paper = 'Encumbrance Certificate';
    answer = () => [field('ec_nil', 'no', 'bounded on the north by Survey No. 72', 2)];
    const spelt = await read({});
    assert.deepEqual(spelt.modelFacts?.map((f) => [f.key, f.value]), [['ec_nil', false]]);

    // An answer with no notes at all is still an answer.
    kind = 'title_deed';
    paper = 'sale_deed';
    withNotes = false;
    answer = () => [field('survey_numbers', 'Survey No. 72', 'bounded on the north by Survey No. 72', 2)];
    const bare = await read({});
    withNotes = true;
    assert.deepEqual([bare.readFailure, bare.modelFacts?.map((f) => f.value)], [undefined, ['72']]);

    // A kind the catalogue does not have, and no paper named: the reading is kept, as a paper of no known kind.
    // None of the rules' keys is taken on its strength, and what it states under a key of the reader's own is.
    kind = 'lift_fitness_certificate';
    paper = null;
    answer = () => [
      field('survey_numbers', 'Survey No. 72', 'bounded on the north by Survey No. 72', 2),
      field('roadName', 'Temple Tank Road', 'on the south by Temple Tank Road', 2),
    ];
    const unknown = await read({});
    assert.equal(unknown.readFailure, undefined, 'a paper with no name here is still a paper that was read');
    assert.deepEqual(unknown.modelFacts?.map((f) => [f.key, f.value]), [['roadName', 'Temple Tank Road']]);
    assert.equal(unknown.kindHint, undefined, 'and it is typed as nothing');
    kind = 'title_deed';
    paper = 'sale_deed';
  });

  it('does not hand a file’s own failure back as the model’s when the model read it', async () => {
    // This server found no legible text in the file. The model reads it, and its reading is not the failure it was handed.
    answer = () => [field('document_number', 'HRK-1-03127-2021-22', 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021', 3)];
    const unread = { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', readFailure: 'No legible text was found in the file.' };
    const out = await read({ readFailure: unread.readFailure });
    assert.equal(out.readFailure, undefined);
    assert.deepEqual(out.modelFacts?.map((f) => [f.key, f.value, f.page]), [['document_number', 'HRK-1-03127-2021-22', 3]]);
    const merged = mergeModelReading(unread, out);
    assert.equal(merged.readFailure, undefined, 'the model read what this server could not: that is the news about the paper');
    assert.deepEqual(merged.read?.facts.map((f) => [f.key, f.value, f.source]), [['document_number', 'HRK-1-03127-2021-22', 'model']]);

    // Where the model answers and finds nothing, the file is still one nobody could read.
    answer = () => [];
    const empty = await read({ readFailure: unread.readFailure });
    assert.equal(mergeModelReading(unread, empty).readFailure, unread.readFailure);
  });

  it('proves a value that has to be exact on the page itself, never by words OCR read there', async () => {
    // Page 3 is a scan. OCR read its document number a digit out, sure of itself, and the model gave the same number back.
    const ocr = [PAGE_TEXT[0]!, PAGE_TEXT[1]!, 'Registered as Document No. HRK-1-03121-2021-22 on 09-07-2021. Stamp duty paid: Rs. 17,83,600. In favour of Nine Lanterns Realty LLP'];
    const scanned: Partial<ChatIngestFile> = { reading: { ...coverage([3]), readers: { text: 2, ocr: 1, model: 0 }, ocrPages: [3] } };
    answer = () => [
      field('document_number', 'HRK-1-03121-2021-22', 'Registered as Document No. HRK-1-03121-2021-22 on 09-07-2021', 1),
      field('stamp_duty', 'Rs. 17,83,600', 'Stamp duty paid: Rs. 17,83,600', 1, 'INR'),
      field('purchaser', 'Nine Lanterns Realty LLP', 'In favour of Nine Lanterns Realty LLP', 1),
    ];
    // The second reader, shown the page alone and asked for each by name, reads what it prints: the number as it is, and the duty.
    secondReads = (_page, key) =>
      key === 'document_number'
        ? { value: 'HRK-1-03127-2021-22', words: 'Registered as Document No. HRK-1-03127-2021-22 on 09-07-2021' }
        : key === 'stamp_duty'
          ? { value: '17,83,600', words: 'Stamp duty paid: Rs. 17,83,600' }
          : null;
    const out = await read(scanned, ocr);
    assert.deepEqual(asked[0]!.pages, [3]);
    assert.equal(pageChecks, 1, 'the one page, shown once, for both values');
    assert.deepEqual(
      out.modelFacts?.map((f) => [f.key, f.value, f.page, f.pageCheck, f.proof]),
      [['stamp_duty', 1783600, 3, 'page', 'second_reader'], ['purchaser', 'Nine Lanterns Realty LLP', 3, 'text', 'page_text']],
      'the amount read the same by a second reader; the name, which is no number, found in the words read from the page',
    );
    assert.deepEqual(out.modelUnverified?.map((f) => [f.key, f.value, f.page, f.proof]), [['document_number', 'HRK-1-03121-2021-22', 3, 'unverified']], 'the number OCR and the model agreed on is not what a second reader read, and is returned as unverified with the page it was looked for on');
    // Blind: the second reader was sent the names of what to read, and nothing either the first reader or OCR read.
    assert.equal(secondWasSent.length, 1);
    assert.match(secondWasSent[0]!, /Read these from the page:\n1\. Document number: .*\n2\. Stamp duty: the stamp duty paid$/);
    for (const read of ['03121', '03127', '17,83,600', '1783600', 'HRK', 'Nine Lanterns']) assert.equal(secondWasSent[0]!.includes(read), false, `the second reader was shown “${read}”`);

    // The same words on a page with a text layer are the file's own: nothing is sent to be looked at again.
    const typed = await read({ reading: coverage([3]) }, ocr);
    assert.equal(pageChecks, 0);
    assert.deepEqual(typed.modelFacts?.map((f) => [f.key, f.proof]), [['document_number', 'page_text'], ['stamp_duty', 'page_text'], ['purchaser', 'page_text']]);

    // Where the page cannot be looked at, an exact value on a scanned page is unverified, not passed on OCR's word.
    secondReads = () => null;
    answer = () => [field('stamp_duty', 'Rs. 17,83,600', 'Stamp duty paid: Rs. 17,83,600', null, 'INR')];
    const unseen = await read(scanned, ocr);
    assert.equal(unseen.modelFacts, undefined);
    assert.deepEqual(unseen.modelUnverified?.map((f) => [f.key, f.page, f.proof]), [['stamp_duty', 0, 'unverified']]);
  });

  it('gives up on an endpoint that does not answer, inside the time it was given', async () => {
    silent = true;
    try {
      const began = Date.now();
      const out = await read({ reading: coverage([3]) }, PAGE_TEXT, Date.now() + 2_500);
      const took = Date.now() - began;
      assert.ok(took >= 2_000 && took < 6_000, `waited for the time it was given and no longer: ${took} ms`);
      assert.equal(out.readFailure, 'The document reader did not answer in time.');
      assert.equal(out.modelFacts, undefined);

      // With no time left, nothing is sent at all.
      const late = Date.now();
      const none = await read({ reading: coverage([3]) }, PAGE_TEXT, Date.now() + 200);
      assert.ok(Date.now() - late < 1_500);
      assert.equal(none.readFailure, 'The document reader did not answer in time.');
    } finally {
      silent = false;
    }
  });


  it('gives the model this server’s OCR words for a page that is not in Latin script, and for no other page', async () => {
    answer = () => [];
    await read({ reading: coverage([1, 3]) }, [PAGE_TEXT[0]!, PAGE_TEXT[1]!, KANNADA_PAGE]);
    const prompt = asked[0]!.prompt;
    assert.match(prompt, /This server's own OCR read the words below on the pages named, counted as they are given to you\./);
    assert.ok(prompt.includes(`[page 2]\n${KANNADA_PAGE}`), 'the Kannada page, by the number the model was given it under');
    assert.equal(prompt.includes(PAGE_TEXT[0]!), false, 'not the words of an English page: the model reads those off the image, past OCR’s mistakes');

    await read({ reading: coverage([1, 2]) }, [PAGE_TEXT[0]!, PAGE_TEXT[1]!, KANNADA_PAGE]);
    assert.doesNotMatch(asked[0]!.prompt, /OCR read/, 'and nothing of a page that was not sent');
    await read({});
    assert.doesNotMatch(asked[0]!.prompt, /OCR read/, 'nor anything for a paper wholly in English');
  });

  it('keeps a value’s original script only where it is printed on the page', async () => {
    answer = () => [
      field('owner', 'Rathnamma', 'ಮಾಲೀಕರ ಹೆಸರು: ರತ್ನಮ್ಮ', 3, null, 'ರತ್ನಮ್ಮ'),
      // The page prints this name in Latin letters only; the Kannada for it is the model's own.
      field('occupier', 'Smt. Rathnamma Siddalingaiah', 'Smt. Rathnamma Siddalingaiah', 3, null, 'ಶ್ರೀಮತಿ ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ'),
    ];
    // A khata, which is the paper that names an owner.
    kind = 'khata_extract';
    paper = 'khata';
    const out = await read({}, [PAGE_TEXT[0]!, PAGE_TEXT[1]!, KANNADA_PAGE]);
    kind = 'title_deed';
    paper = 'sale_deed';
    const facts = Object.fromEntries((out.modelFacts ?? []).map((f) => [f.key, [f.value, f.originalValue, f.originalScript]]));
    assert.deepEqual(facts, { owner: ['Rathnamma', 'ರತ್ನಮ್ಮ', 'kannada'], occupier: ['Smt. Rathnamma Siddalingaiah', undefined, undefined] });
  });

  it('reads a paper filed on a register row that the rules did not recognise, and files what the model found on its pages', async () => {
    // Nothing the rules have a name for: they find its survey number and no more.
    const lift = ['Lift fitness certificate LF-2231 for the building on Survey No. 73/4 at Navilugudda', 'Inspected and found fit for use until 09-07-2027 by the Inspector of Lifts'];
    kind = 'occupancy_certificate';
    answer = () => [
      field('survey_numbers', 'Survey No. 73/4', 'for the building on Survey No. 73/4 at Navilugudda', 1),
      field('certificateNumber', 'LF-2231', 'Lift fitness certificate LF-2231', 1),
      field('fitUntil', '09-07-2027', 'found fit for use until 09-07-2027', 2),
    ];
    asked.length = 0;
    const p = project();
    const row = addEvidence(p, { title: 'Lift papers', kind: 'document', status: 'received' });
    const bytes = await pdfOf(lift);
    const done = await readOntoRegister(p, [{ evidenceId: row.id, buffer: bytes, fileName: 'papers.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-papers.pdf' }], 'tester');
    kind = 'title_deed';
    assert.equal(done.read, 1);
    assert.deepEqual(asked.map((a) => a.pages), [[1, 2]], 'the model was asked, as it is for a file dropped in the chat, and shown the whole of a paper nobody recognised');
    assert.deepEqual((row.facts ?? []).map((f) => [f.key, f.value, f.page, f.source, f.review]), [
      ['certificateNumber', 'LF-2231', 1, 'model', 'proposed'],
      ['fitUntil', '09-07-2027', 2, 'model', 'proposed'],
    ], 'what the model read, each on its page; the survey number both read is the rules’, and the rules could not say what the paper is');
    assert.equal(row.documentType, undefined, 'a model’s word for what the paper is names nothing on the register');
    assert.equal(row.proposedDocumentType, 'Occupancy certificate', 'it is offered, for a person to confirm');
    assert.ok(row.modelReadAt, 'and the row is marked as read by a model');
    const [file] = done.files;
    assert.deepEqual([file!.reading?.pagesInFile, file!.reading?.pagesRead, file!.reading?.readers], [2, 2, { text: 2, ocr: 0, model: 2 }]);
    assert.deepEqual(file!.reading?.modelReasons, ['It was not recognised here.']);
    assert.deepEqual(pagesOf(file!)?.pages.map((page) => [page.page, page.reader]), [[1, 'text'], [2, 'text']], 'with each page’s text held for whoever stores it');
    assert.match(p.conversation.at(-1)?.text ?? '', /^Read the document you filed on the register\.\nA model takes it for an occupancy certificate\. That is an offer: confirm it on the row, and until then it answers no waiting row\./);
    assert.ok((row.facts ?? []).every((f) => f.proof === 'page_text'), 'each value says what stands behind it');
  });

  it('lays a model’s reading of a scanned page over this server’s own, each exact value proved on the page', async () => {
    // The repository's scanned encumbrance certificate: one page, read here by OCR.
    const bytes = readFileSync(path.resolve('test/fixtures/documents/SCANNED_Encumbrance_Certificate.pdf'));
    let pages: string[] = [];
    const local = await readIngestLocally({ fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-ec.pdf' }, bytes, undefined, { onPages: (read) => (pages = read) });
    await releaseOcr();
    assert.deepEqual(local.reading?.ocrPages, [1]);
    assert.deepEqual(Object.fromEntries(local.read!.facts.map((f) => [f.key, f.value])), { survey_numbers: '118/2', ec_from: '1995-04-01', ec_to: '2025-03-31', ec_nil: false, subsisting_charges: 1, ec_transactions: 3 });

    kind = 'encumbrance_certificate';
    paper = 'encumbrance_certificate';
    answer = () => [
      // The same as the rules read.
      field('survey_numbers', 'Survey No. 118/2', 'Encumbrances on the property: Survey No. 118/2', 1),
      // One more transaction than the rules counted, and said in the words quoted for it.
      field('ec_transactions', '4', 'Number of transactions found during the period: 4', 1),
      // A count the words quoted for it do not state: a heading, with no number in it.
      field('subsisting_charges', '2', 'TRANSACTIONS FOUND DURING THE PERIOD', 1),
      // What the rules have no name for, and so nobody can be asked for by name.
      field('applicationNumber', 'EC/WTF/2025/118842', 'Application No. EC/WTF/2025/118842', 1),
      // A name under a key of the model's own: its words are among those this server read on the page.
      field('executant', 'Ramaiah', 'Executant: Sri K. Ramaiah', 1),
      // A digit out, in the value and in its quote alike: a second reader reads what the page prints.
      field('ec_to', '31-03-2026', 'Period of search: from 01-04-1995 to 31-03-2026', 1),
      // An owner is not an encumbrance certificate's to name.
      field('owner', 'Sri K. Ramaiah', 'Executant: Sri K. Ramaiah', 1),
    ];
    secondReads = (_page, key) =>
      key === 'survey_numbers'
        ? { value: '118/2', words: 'Survey No. 118/2' }
        : key === 'ec_transactions'
          ? { value: '4', words: 'Number of transactions found during the period: 4' }
          : key === 'ec_to'
            ? { value: '31-03-2025', words: 'Period of search: from 01-04-1995 to 31-03-2025.' }
            : null;
    asked.length = 0;
    pageChecks = 0;
    secondWasSent.length = 0;
    const [model] = await enrichIngestWithDocumentIntelligence({ project: project(), files: [{ ...local, read: undefined }], buffers: [bytes], pageTexts: [pages] });
    secondReads = () => null;
    kind = 'title_deed';
    paper = 'sale_deed';
    assert.equal(pageChecks, 1, 'one page, read a second time once, for every value that has to be exact');
    assert.match(secondWasSent[0]!, /Read these from the page:\n1\. Survey number: .*\n2\. Transactions in the period: .*\n3\. EC searched to: /, 'asked by the names of the rules’ keys');
    assert.equal(/118842|2026|118\/2/.test(secondWasSent[0]!), false, 'and shown none of what the first reader read');

    const merged = mergeModelReading(local, model);
    const facts = Object.fromEntries(merged.read!.facts.map((f) => [f.key, f]));
    assert.deepEqual([facts.survey_numbers!.value, facts.survey_numbers!.source, facts.survey_numbers!.otherReading], ['118/2', undefined, undefined], 'where the two agree, the rules’ fact stands alone');
    assert.deepEqual(
      [facts.ec_transactions!.value, facts.ec_transactions!.otherReading?.value, facts.ec_transactions!.otherReading?.proof],
      [3, 4, 'second_reader'],
      'where they differ, both wait: the rules’ count, and the model’s that a second reader read the same',
    );
    assert.deepEqual([facts.executant!.value, facts.executant!.source, facts.executant!.proof, facts.executant!.page], ['Ramaiah', 'model', 'page_text', 1]);
    assert.ok(facts.executant!.marks?.quote.length, 'with where its words sit on the page, so they can be shown');
    assert.equal(facts.applicationNumber, undefined, 'an exact value under a key of the model’s own, on a scanned page, is nobody’s to confirm');
    assert.equal(facts.ec_to!.value, '2025-03-31', 'the rules’ date stands');
    assert.equal(facts.ec_to!.otherReading, undefined, 'and the model’s, which the second reader read differently, is not set beside it');
    assert.equal(facts.subsisting_charges!.otherReading, undefined, 'nor is a count its own quote does not state');
    assert.equal(facts.owner, undefined, 'a key this paper does not carry is not taken');
    assert.deepEqual(
      merged.reading?.unverified?.map((f) => [f.key, f.value, f.page, f.proof]),
      [['subsisting_charges', 2, 1, 'unverified'], ['applicationNumber', 'EC/WTF/2025/118842', 1, 'unverified'], ['ec_to', '2026-03-31', 1, 'unverified']],
      'each is kept apart, as unverified',
    );
    assert.deepEqual([merged.reading?.pagesRead, merged.reading?.readers, merged.reading?.modelPagesSent, merged.reading?.modelPagesRead], [1, { text: 0, ocr: 1, model: 1 }, [1], [1]]);
    assert.equal(readingLine(merged.reading), '3 values a model read could not be verified on the page, and are kept apart as unverified.');
  });

  it('finds a value’s words only on a page that was sent, and with the value’s own words there', async () => {
    // Only page 3 was sent. The office of the earlier deed is named on page 1, which the model never saw.
    kind = 'title_deed';
    paper = 'sale_deed';
    answer = () => [
      field('sub_registrar', 'Suvarnagiri', 'registered as Document No. 1184/2003-04 at Suvarnagiri', 1),
      // Most of these words are on page 3, and the name that is the value is not.
      field('purchaser', 'Nine Lamps Realty LLP', 'Stamp duty paid: Rs. 17,83,600. In favour of Nine Lamps Realty LLP', 1),
    ];
    const pages = [PAGE_TEXT[0]!, PAGE_TEXT[1]!, `${PAGE_TEXT[2]!}. In favour of Nine Lanterns Realty LLP`];
    // The second reader, asked for each by name on the page that was sent, reads what is there.
    secondReads = (_page, key) => (key === 'purchaser' ? { value: 'Nine Lanterns Realty LLP', words: 'In favour of Nine Lanterns Realty LLP' } : null);
    const out = await read({ reading: coverage([3]) }, pages);
    secondReads = () => null;
    assert.deepEqual(asked[0]!.pages, [3]);
    assert.equal(out.modelFacts, undefined, 'neither is a fact');
    assert.deepEqual(
      out.modelUnverified?.map((f) => [f.key, f.value, f.page]),
      [['sub_registrar', 'Suvarnagiri', 3], ['purchaser', 'Nine Lamps Realty LLP', 3]],
      'the office is not placed on page 1, which was never sent, and the name is not held by a page that prints another',
    );
    assert.deepEqual([out.reading?.modelPagesSent, out.reading?.modelPagesRead], [[3], []], 'and no page that was not sent is said to have been read by the model');
  });

  it('says on the reading when the second reader ran out of time, so the paper is taken again', async () => {
    // Page 3 is a scan, so its exact values go to the second reader. It never answers, and the request has two seconds.
    const scanned: Partial<ChatIngestFile> = { reading: { ...coverage([3]), readers: { text: 2, ocr: 1, model: 0 }, ocrPages: [3] } };
    answer = () => [field('stamp_duty', 'Rs. 17,83,600', 'Stamp duty paid: Rs. 17,83,600', 1, 'INR')];
    silentSecond = true;
    try {
      const out = await read(scanned, PAGE_TEXT, Date.now() + 2_500);
      assert.equal(pageChecks, 1, 'it was asked');
      assert.equal(out.modelFacts, undefined);
      assert.deepEqual(out.modelUnverified?.map((f) => [f.key, f.proof]), [['stamp_duty', 'unverified']], 'the value is unverified for want of a second reading');
      assert.equal(out.reading?.modelChecksCut, true, 'and the reading says why');
      const merged = mergeModelReading({ fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', ...scanned }, out);
      assert.equal(merged.reading?.modelChecksCut, true, 'kept through the merge');
      assert.equal(needsReadingAgain(merged.reading), true, 'so “Read the filed documents” takes the paper again');
      assert.match(readingLine(merged.reading), /The time allowed ran out before a second model had read every value’s page\./);
    } finally {
      silentSecond = false;
    }
    // Asked again with time to answer, the cut is gone.
    secondReads = (_page, key) => (key === 'stamp_duty' ? { value: '17,83,600', words: 'Stamp duty paid: Rs. 17,83,600' } : null);
    const again = await read(scanned, PAGE_TEXT);
    secondReads = () => null;
    assert.equal(again.reading?.modelChecksCut, undefined);
    assert.deepEqual(again.modelFacts?.map((f) => [f.key, f.proof]), [['stamp_duty', 'second_reader']]);
  });

  it('does not let a model type a row or answer a waiting one, until a person confirms what the paper is', async () => {
    // A paper the rules do not know, which the model takes for an encumbrance certificate with a nil result.
    const holdings = ['Statement of holdings for the land in Survey No. 73/4 at Navilugudda, issued on request', 'No encumbrance is recorded against the holding in this statement'];
    kind = 'encumbrance_certificate';
    paper = 'encumbrance_certificate';
    answer = () => [field('ec_nil', 'yes', 'No encumbrance is recorded against the holding', 2)];
    const p = project();
    const waiting = addEvidence(p, { title: 'Encumbrance certificate', kind: 'document', status: 'missing' });
    const row = addEvidence(p, { title: 'Holdings statement', kind: 'document', status: 'received' });
    const bytes = await pdfOf(holdings);
    attachEvidenceFile(p, row.id, { fileName: 'holdings.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-holdings.pdf', capture: {} }, 'tester');
    const cardsBefore = p.chatProposals.length;
    await readOntoRegister(p, [{ evidenceId: row.id, buffer: bytes, fileName: 'holdings.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-holdings.pdf' }], 'tester');
    kind = 'title_deed';
    paper = 'sale_deed';

    assert.deepEqual([row.documentType, row.proposedDocumentType], [undefined, 'Encumbrance certificate']);
    assert.deepEqual([waiting.status, waiting.supersededById], ['missing', undefined], 'the row waiting for an encumbrance certificate is still waiting');
    assert.deepEqual((row.facts ?? []).map((f) => [f.key, f.value, f.source, f.review]), [['ec_nil', true, 'model', 'proposed']], 'what the model read waits on the row for a person');
    assert.equal(p.chatProposals.slice(cardsBefore).some((card) => card.kind === 'record_check_fields'), false, 'and nothing is offered to a check on its strength');

    assert.equal(confirmProposedType(p, row.id), true);
    assert.deepEqual([row.documentType, row.proposedDocumentType], ['Encumbrance certificate', undefined]);
    assert.deepEqual([waiting.status, waiting.supersededById], ['superseded', row.id], 'confirmed by a person, the paper answers the row that was waiting for it');
    assert.equal(confirmProposedType(p, row.id), false, 'and there is nothing left to confirm');
  });

  it('lets a person refuse what a model took a paper for, or say what it is instead', async () => {
    const holdings = ['Statement of holdings for the land in Survey No. 73/4 at Navilugudda, issued on request', 'No encumbrance is recorded against the holding in this statement'];
    kind = 'encumbrance_certificate';
    paper = 'encumbrance_certificate';
    answer = () => [field('ec_nil', 'yes', 'No encumbrance is recorded against the holding', 2)];
    const bytes = await pdfOf(holdings);
    const filed = async (storageKey: string) => {
      const p = project();
      const waiting = addEvidence(p, { title: 'Encumbrance certificate', kind: 'document', status: 'missing' });
      const row = addEvidence(p, { title: 'Holdings statement', kind: 'document', status: 'received' });
      attachEvidenceFile(p, row.id, { fileName: 'holdings.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey, capture: {} }, 'tester');
      const again = () => readOntoRegister(p, [{ evidenceId: row.id, buffer: bytes, fileName: 'holdings.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey }], 'tester');
      await again();
      return { p, row, waiting, again };
    };

    // Set aside: the offer goes, the row is typed as nothing, and reading the paper again does not make the offer again.
    const refused = await filed('k-holdings-a.pdf');
    assert.equal(refused.row.proposedDocumentType, 'Encumbrance certificate');
    assert.equal(setAsideProposedType(refused.p, refused.row.id), true);
    assert.deepEqual([refused.row.documentType, refused.row.proposedDocumentType, refused.waiting.status], [undefined, undefined, 'missing']);
    assert.equal(setAsideProposedType(refused.p, refused.row.id), false, 'there is nothing left to set aside');
    await refused.again();
    assert.equal(refused.row.proposedDocumentType, undefined, 'an offer a person refused is not made twice');
    assert.doesNotMatch(refused.p.conversation.at(-1)?.text ?? '', /A model takes it for/);

    // Corrected: the person's word is the row's type, and it answers what was waiting for that paper and nothing else.
    const corrected = await filed('k-holdings-b.pdf');
    assert.equal(correctProposedType(corrected.p, corrected.row.id, 'A paper of my own invention'), false, 'only a kind of document the register knows');
    assert.equal(correctProposedType(corrected.p, corrected.row.id, 'RTC (record of rights)'), true);
    assert.deepEqual([corrected.row.documentType, corrected.row.proposedDocumentType, corrected.waiting.status], ['RTC (record of rights)', undefined, 'missing'], 'a record of rights does not answer the row waiting for an encumbrance certificate');
    assert.equal(correctProposedType(corrected.p, corrected.row.id, 'Sale deed'), false, 'with no offer waiting, there is nothing to correct here');
    kind = 'title_deed';
    paper = 'sale_deed';
  });

  it('keeps how much was read on the filed paper, and says so when the model was to read it and did not', async () => {
    // The model never answers, and the request that filed the paper has a second to give it.
    silent = true;
    try {
      const lift = ['Lift fitness certificate LF-2231 for the building on Survey No. 73/4 at Navilugudda', 'Inspected and found fit for use until 09-07-2027 by the Inspector of Lifts'];
      const p = project();
      const row = addEvidence(p, { title: 'Lift papers', kind: 'document', status: 'received' });
      const bytes = await pdfOf(lift);
      const file = attachEvidenceFile(p, row.id, { fileName: 'papers.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-papers-2.pdf', capture: {} }, 'tester');
      const began = Date.now();
      const done = await readOntoRegister(p, [{ evidenceId: row.id, buffer: bytes, fileName: 'papers.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-papers-2.pdf' }], 'tester', { modelBudgetMs: 1_000 });
      assert.ok(Date.now() - began < 5_000, 'the request is not held past its budget');
      assert.equal(done.read, 0);
      assert.equal(file.reading?.pagesRead, 2);
      assert.match(file.reading?.modelFailure ?? '', /^Not read yet: this turn ran out of time\./);
      assert.equal(needsReadingAgain(file.reading), true, 'stored as a paper a model has still to read, so it is offered again');
      assert.match(p.conversation.at(-1)?.text ?? '', /^papers\.pdf: A model was to read it as well and did not: not read yet: this turn ran out of time\./);
      assert.match(readingLine(file.reading), /^A model was to read it as well and did not/);
    } finally {
      silent = false;
    }
  });
});
