/**
 * A model's page for a value is checked, never taken on its word.
 *
 * Measured on production on 2 October 2026: thirty-two scanned title documents
 * read by Gemini, and one by Claude, all through OpenRouter. The readings were
 * good (the Claude one named every part of a hundred-page title bundle), yet
 * not one value reached the file, because a value is filed only with its page
 * and only Anthropic's citations could prove a page. OpenRouter strips those
 * even when the model behind it is Claude.
 *
 * So the page is now checked here: against the page's own text where this
 * server read it, or by cutting that one page out and asking a reader whether
 * the words are printed on it. These tests hold the rule that matters: a page
 * reaches a fact only when its words were found on it, and a quote looked for
 * on its page and not there is dropped.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  answerConfirms,
  findQuoteInPages,
  normalizeForPage,
  onePagePdf,
  pageHolds,
  passagesPrompt,
  pdfPageCount,
  placeQuotes,
  type CheckPage,
} from '../packages/agents/src/agents/page-check';
import { CUT_OFF_REASON, describeChecks, originalPage, runDocumentIntelligence } from '../packages/agents/src/agents/document-intelligence';
import { enrichIngestWithDocumentIntelligence } from '../packages/agents/src/project/ingest-intelligence';
import { createProject, type CaseDocument, type ChatIngestFile, type PropertyIdentity } from '../packages/shared/src';

/** Each page of the test PDF is one point wider than the last, so a reader shown one page can tell which it is. */
const PAGE_TEXT = [
  'Khata No. KH-7741-B/2019 issued to Sri Ramaiah',
  'Sale consideration Rs. 45,00,000 paid in full',
  'Schedule: bounded on the north by Sy. No. 118/3',
];
const pageWidth = (page: number): number => 500 + page;

async function threePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  PAGE_TEXT.forEach((text, i) => {
    const page = doc.addPage([pageWidth(i + 1), 700]);
    page.drawText(text, { x: 40, y: 600, size: 12, font });
  });
  return Buffer.from(await doc.save());
}

describe('matching a quote against a page', () => {
  it('ignores spacing, punctuation and case, and keeps every script', () => {
    assert.equal(normalizeForPage('Khata  No.:\nKH-7741/B'), 'khata no kh 7741 b');
    assert.equal(normalizeForPage('ಸರ್ವೆ ನಂ. ೧೧೮/೩'), 'ಸರ್ವೆ ನಂ ೧೧೮ ೩', 'Kannada letters, signs and digits survive');
  });

  it('finds a quote printed verbatim, however it is broken across lines', () => {
    assert.ok(pageHolds('... the vendor\nSri. Ramaiah, son of Late Sri. Kempaiah ...', 'Sri Ramaiah, son of late Sri Kempaiah'));
  });

  it('forgives the odd word OCR got wrong in a long quote, but not a missing passage', () => {
    const ocr = 'This deed of sale is made on the 28th day of Jnne 2011 at Bengaluru between the vendor and the purchaser';
    assert.ok(pageHolds(ocr, 'made on the 28th day of June 2011 at Bengaluru between the vendor and the purchaser'));
    assert.equal(pageHolds(ocr, 'the purchaser shall pay the balance consideration within ninety days'), false);
  });

  it('wants a short quote verbatim, and a very short one not at all', () => {
    assert.ok(pageHolds('Survey No. 118/3, Whitefield', 'No. 118/3'));
    assert.equal(pageHolds('Survey No. 118/3, Whitefield', 'No. 118/4'), false);
    assert.equal(pageHolds('2011 2012 2013', '2011'), true, 'four characters is the floor');
    assert.equal(pageHolds('Sy 51', 'Sy'), false, 'too short to say where it is');
  });

  it('places a quote on the page that holds it, preferring the page the reading named', () => {
    const pages = ['Khata No. KH-7741-B/2019', 'Nothing here', 'Khata No. KH-7741-B/2019 repeated'];
    assert.equal(findQuoteInPages('Khata No. KH-7741-B/2019', pages, 3), 3, 'the named page holds it, so it is that page');
    assert.equal(findQuoteInPages('Khata No. KH-7741-B/2019', pages, 2), 1, 'the named page does not, so the first that does');
    assert.equal(findQuoteInPages('Sale consideration', pages, 1), undefined);
  });
});

describe('a reader’s answer about one page', () => {
  it('confirms only when it says present and copies out the same words', () => {
    const quote = 'Sale consideration Rs. 45,00,000 paid in full';
    assert.ok(answerConfirms(quote, { present: true, text: 'Sale consideration Rs.45,00,000 paid in full' }));
    assert.equal(answerConfirms(quote, { present: true, text: 'Stamp duty Rs. 2,92,500 paid' }), false, 'present, but other words');
    assert.equal(answerConfirms(quote, { present: true }), false, 'present, with nothing copied out');
    assert.equal(answerConfirms(quote, { present: false, text: quote }), false);
    assert.equal(answerConfirms(quote, undefined), false);
  });

  it('numbers the passages it is shown', () => {
    assert.equal(passagesPrompt(['one\n two', 'three']), 'Passages:\n1. one two\n2. three');
  });
});

describe('placing a reading’s quotes', () => {
  const quotes = [
    { quote: 'Khata No. KH-7741-B/2019 issued to Sri Ramaiah', hint: 1 },
    { quote: 'Sale consideration Rs. 45,00,000 paid in full', hint: 2 },
    { quote: 'bounded on the north by Sy. No. 118/3', hint: 1 }, // really on page 3
    { quote: 'Document No. BNG-1-02345', hint: undefined }, // on no page, and no page named
  ];

  /** A reader that sees the test document's pages, recording what it was asked. */
  function reader(asked: Array<{ page: number; quotes: string[] }>): CheckPage {
    return async (page, qs) => {
      asked.push({ page, quotes: qs });
      return qs.map((q) => (pageHolds(PAGE_TEXT[page - 1] ?? '', q) ? { present: true, text: q } : { present: false }));
    };
  }

  it('places from the text when it has it, wherever the reading said, and calls no model', async () => {
    const asked: Array<{ page: number; quotes: string[] }> = [];
    const { placements, pagesChecked } = await placeQuotes({ quotes, pageTexts: PAGE_TEXT, checkPage: reader(asked) });
    assert.deepEqual(placements.slice(0, 3), [
      { status: 'placed', page: 1, method: 'text' },
      { status: 'placed', page: 2, method: 'text' },
      { status: 'placed', page: 3, method: 'text' },
    ]);
    assert.deepEqual(placements[3], { status: 'unchecked' }, 'not in the text, and no page to look on');
    assert.equal(pagesChecked, 0);
    assert.equal(asked.length, 0);
  });

  it('otherwise reads each named page once, with every quote said to be on it', async () => {
    const asked: Array<{ page: number; quotes: string[] }> = [];
    const { placements, pagesChecked } = await placeQuotes({ quotes, pageCount: 3, checkPage: reader(asked) });
    assert.deepEqual(placements, [
      { status: 'placed', page: 1, method: 'page' },
      { status: 'placed', page: 2, method: 'page' },
      { status: 'refuted', page: 1 },
      { status: 'unchecked' },
    ]);
    assert.equal(pagesChecked, 2);
    assert.deepEqual(asked.map((a) => [a.page, a.quotes.length]).sort(), [[1, 2], [2, 1]], 'one read per page, the busiest first');
  });

  it('leaves quotes unchecked, never refuted, when a page could not be read', async () => {
    const { placements } = await placeQuotes({ quotes: quotes.slice(0, 2), pageCount: 3, checkPage: async () => null });
    assert.deepEqual(placements, [{ status: 'unchecked' }, { status: 'unchecked' }]);
    const thrown = await placeQuotes({ quotes: quotes.slice(0, 1), pageCount: 3, checkPage: async () => { throw new Error('rate limited'); } });
    assert.deepEqual(thrown.placements, [{ status: 'unchecked' }]);
  });

  it('leaves a quote unchecked when the reader could not make out its part of the page', async () => {
    const { placements } = await placeQuotes({
      quotes: quotes.slice(0, 2),
      pageCount: 3,
      checkPage: async (_page, qs) => qs.map(() => ({ present: false, legible: false })),
    });
    assert.deepEqual(placements, [{ status: 'unchecked' }, { status: 'unchecked' }], 'a script the reader cannot read is no evidence the words are not there');
  });

  it('leaves a quote unchecked when the reader gave no answer about it', async () => {
    const { placements } = await placeQuotes({ quotes: quotes.slice(0, 1), pageCount: 3, checkPage: async () => [undefined] });
    assert.deepEqual(placements, [{ status: 'unchecked' }]);
  });

  it('spends at most its page budget, on the pages with the most quotes', async () => {
    const asked: Array<{ page: number; quotes: string[] }> = [];
    const { placements } = await placeQuotes({ quotes, pageCount: 3, checkPage: reader(asked), maxPages: 1 });
    assert.deepEqual(asked.map((a) => a.page), [1], 'page 1 has two quotes');
    assert.deepEqual(placements[1], { status: 'unchecked' }, 'page 2 was over the budget');
  });

  it('ignores a named page the document does not have', async () => {
    const asked: Array<{ page: number; quotes: string[] }> = [];
    const { placements } = await placeQuotes({ quotes: [{ quote: 'Sale consideration Rs. 45,00,000', hint: 9 }], pageCount: 3, checkPage: reader(asked) });
    assert.deepEqual(placements, [{ status: 'unchecked' }]);
    assert.equal(asked.length, 0);
  });

  it('looks on page 1 of a one-page document even when no page was named', async () => {
    const asked: Array<{ page: number; quotes: string[] }> = [];
    const { placements } = await placeQuotes({ quotes: [{ quote: PAGE_TEXT[0]! }], pageCount: 1, checkPage: reader(asked) });
    assert.deepEqual(placements, [{ status: 'placed', page: 1, method: 'page' }]);
  });
});

describe('cutting out one page', () => {
  it('gives a PDF of that page alone', async () => {
    const pdf = await threePagePdf();
    const one = await onePagePdf(pdf, 2);
    assert.ok(one);
    const doc = await PDFDocument.load(one);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(Math.round(doc.getPage(0).getWidth()), pageWidth(2), 'and it is page 2');
  });

  it('counts the pages of a PDF that keeps its page objects compressed', async () => {
    const pdf = await threePagePdf();
    const { countPdfPages } = await import('../packages/agents/src/pdf');
    assert.equal(countPdfPages(pdf), 1, 'the byte scan finds no page objects here and assumes one');
    assert.equal(await pdfPageCount(pdf), 3, 'the page tree knows better');
    assert.equal(await pdfPageCount(Buffer.from('not a pdf')), undefined);
  });

  it('gives nothing for a page the file does not have, or a file that is not a PDF', async () => {
    const pdf = await threePagePdf();
    assert.equal(await onePagePdf(pdf, 4), null);
    assert.equal(await onePagePdf(pdf, 0), null);
    assert.equal(await onePagePdf(Buffer.from('not a pdf'), 1), null);
  });
});

describe('a page the model named, as a page of the original', () => {
  it('is the page itself for a whole PDF, page 1 for an image, and mapped back through a window', () => {
    assert.equal(originalPage(4, true, undefined), 4);
    assert.equal(originalPage(null, true, undefined), undefined);
    assert.equal(originalPage(7, false, undefined), 1);
    // A window of pages 1–3 and 98–100 (0-based 0,1,2,97,98,99): its page 5 is page 99.
    const window = { pages: [0, 1, 2, 97, 98, 99], of: 100 };
    assert.equal(originalPage(5, true, window), 99);
    assert.equal(originalPage(7, true, window), undefined, 'past what was sent');
  });

  it('is described in words a person reads', () => {
    assert.equal(describeChecks({ placed: 3, refuted: 1, unchecked: 0 }), 'Each quote was looked for on its page here: 3 of 4 found.');
    assert.match(describeChecks({ placed: 1, refuted: 0, unchecked: 2 }), /2 could not be checked, so they stay readings with no page/);
    assert.equal(describeChecks({ placed: 0, refuted: 0, unchecked: 0 }), '');
  });
});

/* ==================================================================== */
/* The whole reading, against a gateway that returns no citations        */
/* ==================================================================== */

interface Seen {
  tool: string;
  model: string;
  /** For a page check: which page it was shown, read off the page's width, and how many pages it had. */
  page?: number;
  pages?: number;
  quotes?: string[];
}

/** The extraction a model on a gateway returns: good values, a page for most, no citation for any. */
const EXTRACTION = {
  kind: 'title_deed',
  kindConfidence: 0.9,
  notes: '',
  fields: [
    { key: 'khataNumber', label: 'Khata number', value: 'KH-7741-B/2019', unit: null, confidence: 0.92, quote: PAGE_TEXT[0], originalValue: null, page: 1 },
    { key: 'saleConsideration', label: 'Sale consideration', value: '4500000', unit: 'INR', confidence: 0.9, quote: PAGE_TEXT[1], originalValue: null, page: 2 },
    { key: 'boundaryNorth', label: 'North boundary', value: 'Sy. No. 118/3', unit: null, confidence: 0.85, quote: 'bounded on the north by Sy. No. 118/3', originalValue: null, page: 1 },
    { key: 'registrationNumber', label: 'Registration number', value: 'BNG-1-02345', unit: null, confidence: 0.8, quote: 'Document No. BNG-1-02345', originalValue: null, page: null },
  ],
};

function streamMessage(
  res: ServerResponse,
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown }>,
  stopReason = 'tool_use',
): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', {
    type: 'message_start',
    message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } },
  });
  content.forEach((block, index) => {
    if (block.type === 'tool_use') {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: block.name, input: {} } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    } else {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    }
    send('content_block_stop', { type: 'content_block_stop', index });
  });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

describe('a reading through a gateway that returns no citations', () => {
  const seen: Seen[] = [];
  let server: ReturnType<typeof createServer>;
  const ENV = ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_EXTRACTION', 'REALYTICA_MODEL_PAGE_CHECK'] as const;
  const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

  before(async () => {
    server = createServer(async (req, res) => {
      const call = await body(req);
      const tool = String(call.tools?.[0]?.name ?? '');
      if (tool === 'record_document_extraction') {
        seen.push({ tool, model: call.model });
        const asked = JSON.stringify(call.messages);
        if (asked.includes('long.pdf')) {
          // An answer stopped by the length limit, mid-sentence, before any tool call.
          streamMessage(res, [{ type: 'text', text: 'The first transaction is a sale deed dated' }], 'max_tokens');
          return;
        }
        // Visible text and a tool call, as a model behind a gateway answers: no citations anywhere.
        streamMessage(res, [
          { type: 'text', text: 'The khata number is KH-7741-B/2019.' },
          { type: 'tool_use', name: tool, input: EXTRACTION },
        ]);
        return;
      }
      // A page check: one page (or one image) and numbered passages.
      const [part, text] = call.messages[0].content as Array<Record<string, any>>;
      const quotes = String(text?.text ?? '').split('\n').slice(1).map((line) => line.replace(/^\d+\.\s*/, ''));
      let page = 1;
      let pages = 1;
      let printed = 'any words at all on a photographed sheet';
      if (part?.type === 'document') {
        const doc = await PDFDocument.load(Buffer.from(part.source.data, 'base64'));
        pages = doc.getPageCount();
        page = Math.round(doc.getPage(0).getWidth()) - 500;
        printed = PAGE_TEXT[page - 1] ?? '';
      }
      seen.push({ tool, model: call.model, page, pages, quotes });
      streamMessage(res, [{
        type: 'tool_use',
        name: tool,
        input: {
          passages: quotes.map((q, i) => (part?.type !== 'document' || pageHolds(printed, q)
            ? { n: i + 1, present: true, text: q }
            : { n: i + 1, present: false, text: null })),
        },
      }]);
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

  const identity = {
    label: 'Test site', country: 'IN', state: 'Karnataka', city: 'Bengaluru', locality: 'Whitefield', addressLine: 'Plot 4',
    postalCode: '560066', parcelId: '118/2', propertyType: 'plot', tenure: 'freehold', builtUpAreaSqm: 0, plotAreaSqm: 0, currency: 'INR',
  } as unknown as PropertyIdentity;

  function document(fileName: string, mimeType: string): CaseDocument {
    return {
      id: `doc-${fileName}`, caseId: 'case-1', fileName, mimeType, sizeBytes: 1, uploadedAt: '2026-10-02T00:00:00.000Z',
      kind: 'other', classificationConfidence: 0, kindConfirmedByUser: false, pages: 0, ocrStatus: 'pending', extracted: [],
    } as CaseDocument;
  }

  it('files the values found on their pages, drops the one not on its page, and keeps the unplaced one as a reading', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('deed.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
    });
    assert.equal(result.run.status, 'succeeded', result.run.error);
    assert.ok(result.run.capabilityGaps?.includes('citations_unavailable'), 'the gateway still returned no citations, and that is still recorded');

    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    assert.equal(byKey.get('khataNumber')?.sourcePage, 1);
    assert.equal(byKey.get('khataNumber')?.pageCheck, 'page');
    assert.equal(byKey.get('khataNumber')?.confidence, 0.92, 'a checked page keeps the reading’s confidence');
    assert.equal(byKey.get('saleConsideration')?.sourcePage, 2);
    assert.equal(byKey.has('boundaryNorth'), false, 'looked for on the page it was said to be on, and not there');
    const unplaced = byKey.get('registrationNumber');
    assert.ok(unplaced, 'a value nothing could check is kept as a reading');
    assert.equal(unplaced.sourcePage, undefined, 'with no page');
    assert.ok(unplaced.confidence <= 0.45, 'and at the discount of an unverified reading');

    const checks = seen.filter((s) => s.tool === 'record_page_check');
    assert.deepEqual(checks.map((c) => [c.page, c.pages, c.quotes?.length]).sort(), [[1, 1, 2], [2, 1, 1]], 'each page shown alone, once');
    assert.ok(checks.every((c) => c.model === 'other-vendor/checker'), 'on the model set to check');
    assert.equal(seen.find((s) => s.tool === 'record_document_extraction')?.model, 'vendor/reader');
    assert.equal(result.pageCheckUsage?.length, 2, 'what the checks cost is reported with the reading');

    assert.match(result.notes, /Each quote was looked for on its page here: 2 of 4 found\./);
    assert.doesNotMatch(result.notes, /self-reported/, 'not said of values that were checked');
  });

  it('places from the server’s own text without a single check when it has the pages', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('deed.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
      pageTexts: PAGE_TEXT,
    });
    const pages = Object.fromEntries(result.fields.map((f) => [f.key, [f.sourcePage, f.pageCheck]]));
    assert.deepEqual(pages.khataNumber, [1, 'text']);
    assert.deepEqual(pages.saleConsideration, [2, 'text']);
    assert.deepEqual(pages.boundaryNorth, [3, 'text'], 'found on page 3, though the reading said page 1');
    assert.equal(seen.filter((s) => s.tool === 'record_page_check').length, 0);
    assert.equal(result.pageCheckUsage, undefined);
  });

  it('checks a photographed sheet as page 1', async () => {
    seen.length = 0;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('khata.png', 'image/png'), fileBytes: png, identity, now: '2026-10-02T00:00:00.000Z',
    });
    assert.ok(result.fields.length > 0);
    assert.ok(result.fields.every((f) => f.sourcePage === 1 && f.pageCheck === 'page'), 'every quote found on the one sheet there is');
    assert.equal(seen.filter((s) => s.tool === 'record_page_check').length, 1, 'one look at the one sheet');
  });

  it('says a reading was cut off at its length limit, not that the file could not be read', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('long.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
    });
    assert.equal(result.run.status, 'failed');
    assert.equal(result.run.error, CUT_OFF_REASON);

    const project = createProject({ name: 'Long bundle', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-0042');
    const [file] = await enrichIngestWithDocumentIntelligence({
      project,
      files: [{ fileName: 'long.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k' } as ChatIngestFile],
      buffers: [await threePagePdf()],
    });
    assert.match(file!.readFailure ?? '', /cut off/, 'in words a person can act on');
    assert.doesNotMatch(file!.readFailure ?? '', /could not read this file/);
  });

  it('stops checking pages at the deadline and leaves the rest unchecked', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('deed.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
      checkDeadline: Date.now() - 1,
    });
    assert.equal(seen.filter((s) => s.tool === 'record_page_check').length, 0);
    assert.ok(result.fields.every((f) => f.sourcePage === undefined), 'nothing was checked, so nothing has a page');
    assert.equal(result.fields.length, 4, 'and nothing was refuted either');
  });
});
