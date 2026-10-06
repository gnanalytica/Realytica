/**
 * Which papers a model reads, how much of a paper was read, and whose value
 * stands where two readers disagree.
 *
 * Measured on 5 October 2026 with `pnpm eval:reading`: the rules read 51 of 55
 * fields off a clean English scan and none of 38 off a Kannada one; a scan fed
 * sideways gave nothing; a ten-page scan was read for eight pages and said
 * nothing of the other two; and a crooked, stamped photocopy returned fourteen
 * wrong values looking exactly like readings. A paper went to the model only
 * when the rules found few facts in it, which is a count of what the rules
 * made of it and says nothing of how well it was read.
 *
 * These hold what replaced that: the router's reasons, the reader's account of
 * each page, and the merge.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  addEvidence,
  attachEvidenceFile,
  createChatProposal,
  createProject,
  isIdentifierKey,
  keepReadings,
  mergeReading,
  needsReadingAgain,
  parseDocumentText,
  partlyReadSentence,
  proofSaid,
  proposeFacts,
  readingLine,
  readingSaid,
  readingWaitingFor,
  reviewFacts,
  sentToModelLine,
  soundReading,
  standingFacts,
  STANDARD_FACT_KEYS,
  STANDARD_PAPERS,
  standardFact,
  standardKeyFits,
  standardKeyGuide,
  valueChecks,
  type ChatIngestFile,
  type DocumentFact,
  type ReadingCoverage,
  runValuationApproaches,
  valueSummary,
} from '@realytica/shared';
import { mergeModelReading, needsModelReading, pagesOf, readIngestLocally, routeReading, supportedFacts } from '../apps/api/src/documents/intake';
import { valueWords } from '../apps/api/src/documents/locate';
import { firstPageImage, readDocumentText, releaseOcr, type PageRead } from '../apps/api/src/documents/read-text';
import { PAPERS } from '../evals/reading/papers';

after(() => releaseOcr());

const sound = (page: number): PageRead => ({ page, reader: 'ocr', confidence: 94 });
const ENGLISH = 'This Deed of Absolute Sale is made and executed at Suvarnagiri between the vendor and the purchaser named below.';
const KANNADA = 'ಈ ಶುದ್ಧ ಕ್ರಯ ಪತ್ರವನ್ನು ದಿನಾಂಕ 09-07-2021 ರಂದು Suvarnagiri ನಲ್ಲಿ ಬರೆದು ಕೊಡಲಾಗಿದೆ. ಮಾರಾಟಗಾರರು ಮತ್ತು ಖರೀದಿದಾರರು.';
const deed = { type: 'sale_deed' as const, confidence: 0.9, facts: [{}, {}, {}, {}] };

describe('which papers go to the model reader', () => {
  it('sends nothing that was read soundly and understood', () => {
    assert.deepEqual(routeReading({ pages: [sound(1), sound(2)], texts: [ENGLISH, ENGLISH], read: deed }), { reasons: [], pages: [] });
    assert.deepEqual(routeReading({ pages: [{ page: 1, reader: 'text' }], texts: [ENGLISH], read: deed }), { reasons: [], pages: [] });
  });

  it('sends a page in Kannada, and names the script and the page', () => {
    const route = routeReading({ pages: [sound(1), sound(2)], texts: [ENGLISH, KANNADA], read: deed });
    assert.deepEqual(route, { reasons: ['Page 2 is in Kannada.'], pages: [2] });
  });

  it('does not take an English page with a Kannada seal for a Kannada page', () => {
    const route = routeReading({ pages: [sound(1)], texts: [`${ENGLISH} ${ENGLISH} ${ENGLISH} ಕರ್ನಾಟಕ ಸರ್ಕಾರ`], read: deed });
    assert.deepEqual(route.reasons, []);
  });

  it('sends a page OCR was unsure of, and one a value was left out on', () => {
    const route = routeReading({ pages: [sound(1), { page: 2, reader: 'ocr', confidence: 79, unsure: true }, sound(3)], texts: [ENGLISH, ENGLISH, ENGLISH], withheld: [3], read: deed });
    assert.deepEqual(route, { reasons: ['OCR was unsure of pages 2 and 3.'], pages: [2, 3] });
  });

  it('says of a page that was turned and still not read surely only that OCR was unsure of it', () => {
    // It no longer claims the page lies on its side: the look of a page's strokes is a hint, and a ruled page gave the same hint.
    const route = routeReading({ pages: [sound(1), { page: 2, reader: 'ocr', confidence: 41, unsure: true, turned: 270 }], texts: [ENGLISH, 'x'], read: deed });
    assert.deepEqual(route, { reasons: ['OCR was unsure of page 2.'], pages: [2] });
  });

  it('says how many pages were read, and sends the ones that were not', () => {
    const pages: PageRead[] = [...Array.from({ length: 8 }, (_, i) => sound(i + 1)), { page: 9, reader: 'none', unread: 'past_ocr_limit' }, { page: 10, reader: 'none', unread: 'past_ocr_limit' }];
    const route = routeReading({ pages, texts: Array.from({ length: 8 }, () => ENGLISH), read: deed });
    assert.deepEqual(route, { reasons: ['8 of 10 pages read here; pages 9 and 10 were not.'], pages: [9, 10] });
    const long: PageRead[] = [...Array.from({ length: 8 }, (_, i) => sound(i + 1)), ...Array.from({ length: 32 }, (_, i): PageRead => ({ page: i + 9, reader: 'none', unread: 'past_ocr_limit' }))];
    assert.equal(routeReading({ pages: long, texts: [], read: deed }).reasons[0], '8 of 40 pages read here; pages 9 to 40 were not.');
  });

  it('sends a page whose text layer was not text, read or not', () => {
    const route = routeReading({ pages: [{ page: 1, reader: 'none', layerDiscarded: true, unread: 'nothing_legible' }], texts: [''] });
    assert.deepEqual(route, { reasons: ['Its one page could not be read here.', 'The text stored in page 1 is not readable text.'], pages: [1] });
  });

  it('keeps what the rules made of the paper as the last reason, and then sends it whole', () => {
    const few = routeReading({ pages: [sound(1), sound(2)], texts: [ENGLISH, ENGLISH], read: { type: 'sale_deed', confidence: 0.9, facts: [{}] } });
    assert.deepEqual(few, { reasons: ['Only 1 fact was found in it here.'], pages: [1, 2] });
    assert.deepEqual(routeReading({ pages: [sound(1)], texts: [ENGLISH], read: { type: 'other', confidence: 0, facts: [] } }).reasons, ['It was not recognised here.']);
    assert.deepEqual(routeReading({ pages: [sound(1)], texts: [ENGLISH], read: { ...deed, confidence: 0.3 } }).reasons, ['It is not clear here what kind of paper it is.']);
    const both = routeReading({ pages: [sound(1), sound(2)], texts: [KANNADA, KANNADA], read: { type: 'other', confidence: 0, facts: [] } });
    assert.deepEqual(both.reasons, ['Pages 1 and 2 are in Kannada.', 'It was not recognised here.'], 'the reason about the reading comes first');
  });

  it('asks a model for a row with reasons, and judges a row with no reading of its own as it always did', () => {
    const row = { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k' };
    const reading = { pagesInFile: 2, pagesRead: 2, readers: { text: 0, ocr: 2, model: 0 }, modelPages: [] as number[] };
    const read = { ...deed, label: 'Sale deed', method: 'ocr', flags: [], summary: '', rowHints: [], scopes: [], evidenceKind: 'document' };
    assert.equal(needsModelReading({ ...row, read, reading: { ...reading, modelReasons: [] } } as never), false);
    assert.equal(needsModelReading({ ...row, read, reading: { ...reading, modelReasons: ['OCR was unsure of page 2.'], modelPages: [2] } } as never), true, 'a deed with its facts still goes when a page of it was read badly');
    assert.equal(needsModelReading({ ...row, read } as never), false);
    assert.equal(needsModelReading(row as never), true);
  });
});

/* ==================================================================== */
/* A scan, as the reader accounts for it                                 */
/* ==================================================================== */

/** The sample scan's page, as greyscale pixels. */
async function samplePage(): Promise<{ width: number; height: number; grey: Uint8Array }> {
  const bytes = new Uint8Array(readFileSync(path.resolve('test/fixtures/documents/SCANNED_Encumbrance_Certificate.pdf')));
  const img = (await firstPageImage(bytes))!;
  const stride = img.kind === 3 ? 4 : 3;
  const grey = new Uint8Array(img.width * img.height);
  for (let i = 0; i < grey.length; i += 1) {
    const j = i * stride;
    grey[i] = Math.round(0.299 * img.data[j]! + 0.587 * img.data[j + 1]! + 0.114 * img.data[j + 2]!);
  }
  return { width: img.width, height: img.height, grey };
}

type Picture = { width: number; height: number; grey: Uint8Array };

/** The picture turned a quarter turn clockwise, `turns` times. */
function turned(src: Picture, turns: number): Picture {
  let { width: w, height: h, grey } = src;
  for (let n = 0; n < turns; n += 1) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[x * h + (h - 1 - y)] = grey[y * w + x]!;
    [w, h, grey] = [h, w, out];
  }
  return { width: w, height: h, grey };
}

/** The picture with three column rules drawn the height of it, as a register page has: one in each margin, one through the writing. */
function ruled(src: Picture): Picture {
  const grey = Uint8Array.from(src.grey);
  for (const share of [0.06, 0.5, 0.94]) {
    const from = Math.round(src.width * share);
    for (let y = 0; y < src.height; y += 1) for (let x = from; x < from + 3; x += 1) grey[y * src.width + x] = 20;
  }
  return { ...src, grey };
}

/**
 * An image-only PDF, one greyscale picture a page, each drawn edge to edge. `rotate` is the page's own /Rotate.
 * `footer` is a line of real text set under each picture, as a scanning app stamps its name on every page.
 */
function scanPdf(pictures: Picture[], rotate = 0, footer = ''): Uint8Array {
  const objects: Buffer[] = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('')];
  const kids: string[] = [];
  for (const picture of pictures) {
    const [w, h] = picture.width > picture.height ? [842, 595] : [595, 842];
    const image = deflateSync(Buffer.from(picture.grey));
    const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q${footer ? ` BT /F1 8 Tf 30 14 Td (${footer}) Tj ET` : ''}`);
    const at = objects.length + 1;
    kids.push(`${at} 0 R`);
    objects.push(
      Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]${rotate ? ` /Rotate ${rotate}` : ''} /Resources << /XObject << /Im0 ${at + 1} 0 R >>${footer ? ' /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>' : ''} >> /Contents ${at + 2} 0 R >>`),
      Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`),
        image,
        Buffer.from('\nendstream'),
      ]),
      Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    );
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let size = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    size += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

describe('a scan, as the reader accounts for it', () => {
  it('reads a page fed sideways, whichever way it was fed, and says it turned it', async () => {
    const page = await samplePage();
    const upright = await readDocumentText(scanPdf([page]), 'application/pdf', 'scan.pdf');
    assert.equal(upright.pageReads?.[0]?.turned, undefined);
    for (const [turns, back] of [[1, 270], [3, 90]] as const) {
      const text = await readDocumentText(scanPdf([turned(page, turns)]), 'application/pdf', 'scan.pdf');
      assert.equal(text.pageReads?.[0]?.turned, back, `fed ${turns * 90} degrees clockwise, read ${back} degrees on`);
      assert.match(text.pages[0]!, /encumbrance/i, 'and its words came back');
      assert.ok(Math.abs((text.ocrConfidence ?? 0) - (upright.ocrConfidence ?? 0)) <= 3, 'as surely as when it is fed straight');
    }
  });

  it('turns a ruled page that was fed sideways, which the look of its lines never showed', async () => {
    // Fed sideways, a register page's column rules run across it and look like lines of writing: it looked upright, and
    // was left as it was at 49 in 100 with no fact in it. It reads badly as shown, and with its rules left out its lines run up.
    const text = await readDocumentText(scanPdf([turned(ruled(await samplePage()), 1)]), 'application/pdf', 'scan.pdf');
    assert.equal(text.pageReads?.[0]?.turned, 270);
    assert.ok((text.ocrConfidence ?? 0) >= 77, `read as well as the same page fed straight: ${text.ocrConfidence}`);
    assert.equal(parseDocumentText(text.pages, 'scan.pdf').type, 'encumbrance_certificate');
  });

  it('reads an upright page ruled into columns as it stands, and does not take its rules for lines of writing', async () => {
    // Three strokes the height of the page outweigh every line of writing across it. Read on that hint alone the
    // page came back a quarter turn round, at 50 in 100, with no fact in it and "in Kannada".
    const text = await readDocumentText(scanPdf([ruled(await samplePage())]), 'application/pdf', 'scan.pdf');
    assert.deepEqual([text.pageReads?.[0]?.reader, text.pageReads?.[0]?.turned, text.pageReads?.[0]?.unsure], ['ocr', undefined, undefined], 'read as it is shown, and surely');
    assert.ok((text.ocrConfidence ?? 0) >= 85, `as well as a page with no rules on it, near enough: ${text.ocrConfidence}`);
    const parsed = parseDocumentText(text.pages, 'scan.pdf');
    assert.equal(parsed.type, 'encumbrance_certificate');
    assert.deepEqual(parsed.facts.map((f) => [f.key, f.value]).slice(0, 4), [['survey_numbers', '118/2'], ['ec_from', '1995-04-01'], ['ec_to', '2025-03-31'], ['ec_nil', false]]);
    assert.deepEqual(routeReading({ pages: text.pageReads!, texts: text.pages, read: { type: parsed.type, confidence: parsed.confidence, facts: parsed.facts } }).reasons, [], 'and it is not for the model');
  });

  it('does not count a scanner’s footer as the page read', async () => {
    const page = await samplePage();
    // Two scanned pages, each with the scanning app's name set under it as real text. Only the first is sent to OCR.
    const text = await readDocumentText(scanPdf([page, page], 0, 'Scanned with a phone'), 'application/pdf', 'scan.pdf', { maxOcrPages: 1 });
    assert.deepEqual(text.pageReads?.map((p) => [p.page, p.reader, p.unread]), [[1, 'ocr', undefined], [2, 'none', 'past_ocr_limit']], 'a few words beside a picture of a page are not the page');
    assert.match(text.pages[1]!, /Scanned with a phone/, 'the words are kept; the page is not called read on their account');

    // A page that is typed and short is all there, and is read.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawText('Signed before me.', { x: 40, y: 760, size: 11, font: await doc.embedFont(StandardFonts.Helvetica) });
    const short = await readDocumentText(await doc.save(), 'application/pdf', 'typed.pdf');
    assert.deepEqual(short.pageReads, [{ page: 1, reader: 'text' }]);
  });

  it('shows a page the way its PDF says to, when the PDF says it is turned', async () => {
    const page = await samplePage();
    // The picture lies on its side in the file, and the page is marked to be shown a quarter turn round: upright, to a person.
    const text = await readDocumentText(scanPdf([turned(page, 3)], 90), 'application/pdf', 'scan.pdf');
    assert.equal(text.pageReads?.[0]?.turned, 90);
    assert.match(text.pages[0]!, /encumbrance/i);
  });

  it('says which pages it did not read, and why', async () => {
    const page = await samplePage();
    const text = await readDocumentText(scanPdf([page, page]), 'application/pdf', 'scan.pdf', { maxOcrPages: 1, maxPages: 2 });
    assert.deepEqual(text.pageReads?.map((p) => [p.page, p.reader, p.unread]), [[1, 'ocr', undefined], [2, 'none', 'past_ocr_limit']]);
    const cut = await readDocumentText(scanPdf([page, page]), 'application/pdf', 'scan.pdf', { maxPages: 1 });
    assert.deepEqual(cut.pageReads?.[1], { page: 2, reader: 'none', unread: 'past_page_limit' }, 'a page past the limit was never opened, and is said to be there');
    const late = await readDocumentText(scanPdf([page]), 'application/pdf', 'scan.pdf', { deadline: Date.now() - 1 });
    assert.equal(late.pageReads?.[0]?.unread, 'out_of_time');
  });

  it('puts how much was read on the reading, and holds each page for whoever stores it', async () => {
    const bytes = readFileSync(path.resolve('test/fixtures/documents/SCANNED_Encumbrance_Certificate.pdf'));
    const read = await readIngestLocally({ fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k' }, bytes);
    assert.deepEqual({ ...read.reading, modelReasons: [], modelPages: [] }, { pagesInFile: 1, pagesRead: 1, readers: { text: 0, ocr: 1, model: 0 }, ocrPages: [1], modelReasons: [], modelPages: [] }, 'and which pages it has only OCR’s word for');
    const kept = pagesOf(read)!;
    assert.deepEqual([kept.pagesInFile, kept.pagesRead, kept.pages.map((p) => [p.page, p.reader])], [1, 1, [[1, 'ocr']]]);
    assert.match(kept.pages[0]!.text, /encumbrance/i);
    assert.equal(Object.values(read).includes(kept as never), false, 'the pages travel with the row and are no field of it');

    const text = readFileSync(path.resolve('test/fixtures/documents/Khata_Certificate_and_Extract_BBMP.pdf'));
    const typed = await readIngestLocally({ fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: text.length, storageKey: 'k2' }, text);
    assert.equal(typed.reading?.readers.text, typed.reading?.pagesInFile);
    assert.equal(typed.reading?.ocrPages, undefined);
    assert.deepEqual(typed.reading?.modelReasons, [], 'a typed PDF the rules understood is not for the model');

    // Out of time before its one page: nothing read, and the reading says why.
    const late = await readIngestLocally({ fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k3' }, bytes, undefined, { deadline: Date.now() - 1 });
    assert.deepEqual([late.reading?.pagesRead, late.reading?.pagesInFile, late.reading?.unreadWhy], [0, 1, 'the reading ran out of time before page 1']);
    assert.equal(readingLine(late.reading), '0 of 1 pages read: the reading ran out of time before page 1. No model has read the rest.');
  });
});

/* ==================================================================== */
/* How much was read, said and kept                                      */
/* ==================================================================== */

describe('how much of a paper was read, as it is said and kept', () => {
  const partial: ReadingCoverage = {
    pagesInFile: 40,
    pagesRead: 8,
    readers: { text: 0, ocr: 8, model: 0 },
    ocrPages: [1, 2, 3, 4, 5, 6, 7, 8],
    modelReasons: ['8 of 40 pages read here; pages 9 to 40 were not.'],
    modelPages: Array.from({ length: 32 }, (_, i) => i + 9),
    unreadWhy: 'only the first 8 scanned pages of a file are read here',
  };
  const whole: ReadingCoverage = { pagesInFile: 2, pagesRead: 2, readers: { text: 0, ocr: 2, model: 0 }, modelReasons: [], modelPages: [] };

  it('says nothing of a paper read whole, and "8 of 40 pages read" with the reason of one that was not', () => {
    assert.equal(readingLine(whole), '');
    assert.equal(readingLine(undefined), '');
    assert.equal(readingLine(partial), '8 of 40 pages read: only the first 8 scanned pages of a file are read here. No model has read the rest.');
    assert.equal(partlyReadSentence([{ fileName: 'bundle.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', reading: partial }, { fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k2', reading: whole }]), '\nbundle.pdf: 8 of 40 pages read: only the first 8 scanned pages of a file are read here. No model has read the rest. Ask to read the filed documents to carry on.', 'and the chat says how to have the rest read');
  });

  it('says a model was asked and gave nothing, and what it was sent when that is not what was asked', () => {
    assert.equal(
      readingLine({ ...partial, modelFailure: 'The document reader did not answer in time.' }),
      '8 of 40 pages read: only the first 8 scanned pages of a file are read here. No model has read the rest: the document reader did not answer in time.',
    );
    assert.equal(readingLine({ ...whole, modelReasons: ['OCR was unsure of page 2.'], modelPages: [2], modelFailure: 'The document reader was rate limited.' }), 'A model was to read page 2 as well and did not: the document reader was rate limited.');
    // Too heavy to send whole: only the two ends went.
    const ends = { ...partial, pagesRead: 10, modelPagesSent: [9, 10, 39, 40], modelPagesRead: [9, 40] };
    assert.equal(
      readingLine(ends),
      '10 of 40 pages read: only the first 8 scanned pages of a file are read here. A model was sent pages 9, 10, 39 and 40; nothing it gave for pages 10 and 39 was found there. ' +
        'Only pages 9, 10, 39 and 40 went to the model: the file is too heavy to send whole, and pages 11 to 38 did not go.',
    );
    assert.equal(sentToModelLine(ends), 'Pages 9, 10, 39 and 40 of 40 went to the model reader.');
    // Could not be cut: the whole file went where one page needed it.
    const uncut = { ...whole, modelReasons: ['OCR was unsure of page 2.'], modelPages: [2], modelPagesSent: [1, 2], modelPagesRead: [2] };
    assert.equal(readingLine(uncut), 'The whole file went to the model, pages 1 and 2, where only page 2 needed it: the file could not be cut.');
    assert.equal(sentToModelLine(uncut), 'All 2 pages went to the model reader.');
    assert.equal(sentToModelLine(whole), '');
  });

  it('counts what a model read and no second look found, apart from the facts', () => {
    const loose: DocumentFact = { key: 'survey_numbers', label: 'Survey number', value: '143/2', display: '143/2', page: 1, quote: 'ಸರ್ವೆ ನಂಬರ್ 143/2', source: 'model', proof: 'unverified' };
    assert.equal(readingLine({ ...whole, modelPagesSent: [1, 2], modelPages: [1, 2], modelPagesRead: [1], unverified: [loose] }), '1 value a model read could not be verified on the page, and is kept apart as unverified.');
    assert.equal(proofSaid(loose), 'unverified');
    assert.equal(proofSaid({ source: 'model', proof: 'second_reader', value: '73/4' }), 'a second model read the same value off the page', 'said as what it is: two models agreeing');
    assert.equal(proofSaid({ source: 'model', proof: 'page_text', value: '73/4' }), 'its words are in the page’s own text');
    assert.equal(proofSaid({ source: 'model', proof: 'page_text', value: true }), 'the model’s answer; the words quoted for it are in the page’s text', 'a yes or no is never said to be found in the page’s text');
    assert.equal(proofSaid({ source: 'model', pageCheck: 'text', value: '73/4' }), 'its words are in the page’s own text', 'a value filed before the proof was kept is told by how its page was checked');
    assert.equal(proofSaid({ source: 'model', pageCheck: 'page', value: '73/4' }), 'a second model, shown the words, said they are on the page', 'and one confirmed before the second reader was asked blind says that it was shown the words');
    assert.equal(proofSaid({ source: 'parser', value: '73/4' }), '', 'the rules read the page’s own words, and nothing is said of that');
  });

  it('says of a page read here unsurely, that no model has read, that it is so', () => {
    const unsure = { ...whole, modelReasons: ['OCR was unsure of page 2.'], modelPages: [2] };
    assert.equal(readingLine(unsure), 'OCR was unsure of page 2. No model has read page 2.', 'read whole is not read well, and the row says which page');
    assert.equal(readingSaid(unsure), 'OCR was unsure of page 2. No model has read page 2. Ask to read the filed documents to carry on.');
    assert.equal(readingSaid(unsure, false), 'OCR was unsure of page 2. No model has read page 2. No model reader is set up here to read them.', 'where there is no model to ask, nobody is told to ask again');
    assert.equal(readingLine({ ...unsure, modelPagesSent: [2], modelPagesRead: [] }), '', 'once a model has answered there is no more to say of it');
    assert.equal(readingLine({ ...whole, pagesInFile: 1, pagesRead: 1, modelReasons: ['It was not recognised here.'], modelPages: [1] }), 'It was not recognised here. No model has read it.');
  });

  it('never throws on a reading that is not one, and takes nothing from a card that does not hold a sound one', () => {
    // A card's payload can come back from a browser. What is on it is checked, never trusted.
    const broken = [{ pagesInFile: 3, pagesRead: 1, modelReasons: ['x'] }, { pagesInFile: 3, pagesRead: 1, modelReasons: 'x', modelPages: 'all' }, { pagesInFile: '3' }, 'eight of ten', null, [], { pagesInFile: 2, pagesRead: 9, modelReasons: [], modelPages: [] }];
    for (const reading of broken) assert.doesNotThrow(() => [readingLine(reading as never), readingSaid(reading as never), sentToModelLine(reading as never), needsReadingAgain(reading as never)]);
    assert.equal(readingLine({ pagesInFile: 3, pagesRead: 1, modelReasons: ['Read in part.'] } as never), '1 of 3 pages read. No model has read the rest.', 'a list that is missing is an empty list');
    assert.equal(soundReading({ pagesInFile: 2, pagesRead: 9, modelReasons: [], modelPages: [] }), undefined, 'more pages read than the file has is no count at all');
    assert.deepEqual(
      soundReading({ pagesInFile: 3, pagesRead: 2, readers: { text: 'two', ocr: 2 }, modelReasons: ['ok', 7, ''], modelPages: [2, 'x', 9, 2], modelPagesSent: [3], modelFailure: 12, unverified: [{ key: 'a' }], modelChecksCut: 'yes', surprise: true }),
      { pagesInFile: 3, pagesRead: 2, readers: { text: 0, ocr: 2, model: 0 }, modelReasons: ['ok'], modelPages: [2], modelPagesSent: [3] },
      'what is not of its own type is dropped, a page the file does not have is no page, and nothing it does not know is carried',
    );

    const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
    project.chatProposals.push(createChatProposal('file_evidence', 'File scan.pdf', 'Dropped in the chat.', 'Files it on the register.', { storageKey: 'scan-1.pdf', fileName: 'scan.pdf', reading: { pagesInFile: 10, pagesRead: 8, modelReasons: ['x'] } }, 'tester'));
    assert.deepEqual(readingWaitingFor(project, 'scan-1.pdf'), { pagesInFile: 10, pagesRead: 8, readers: { text: 0, ocr: 0, model: 0 }, modelReasons: ['x'], modelPages: [] }, 'a reading with a list missing is made whole before it is filed');
    project.chatProposals.at(-1)!.payload.reading = { pagesInFile: 'ten' };
    assert.equal(readingWaitingFor(project, 'scan-1.pdf'), undefined);
  });

  it('carries the reading from the card a dropped file waits on to the row it is filed on', () => {
    const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
    const dropped: ChatIngestFile = { fileName: 'bundle.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bundle-2.pdf', reading: partial };
    project.chatProposals.push(createChatProposal('file_evidence', 'File bundle.pdf', 'Dropped in the chat.', 'Files it on the register.', { storageKey: 'bundle-2.pdf', fileName: 'bundle.pdf' }, 'tester'));
    keepReadings(project, [dropped]);
    assert.deepEqual(project.chatProposals.at(-1)!.payload.reading, partial, 'until a person approves the card, the reading waits on it');

    const row = addEvidence(project, { title: 'Title bundle', kind: 'document', status: 'expected' });
    const attached = attachEvidenceFile(project, row.id, { fileName: 'bundle.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bundle-2.pdf', capture: {} }, 'tester');
    assert.deepEqual(attached.reading, partial, 'filed, the file carries how much of it was read');

    // Read again once it is on a row: the newer reading replaces the older on the file itself.
    keepReadings(project, [{ ...dropped, reading: { ...partial, pagesRead: 9, modelPagesSent: partial.modelPages, modelPagesRead: [40] } }]);
    assert.deepEqual([attached.reading?.pagesRead, attached.reading?.modelPagesRead], [9, [40]]);

    // Unless it read fewer pages of the same file: ground already read is not lost to a pass that was cut short.
    const cutShort: ReadingCoverage = { pagesInFile: 40, pagesRead: 1, readers: { text: 0, ocr: 0, model: 1 }, modelReasons: [], modelPages: [], modelPagesSent: [1], modelPagesRead: [1] };
    keepReadings(project, [{ ...dropped, reading: cutShort }]);
    assert.deepEqual([attached.reading?.pagesRead, attached.reading?.unreadWhy], [9, partial.unreadWhy], '“9 of 40 pages read” is not overwritten by “1 of 40”');
    assert.match(readingLine(attached.reading), /^9 of 40 pages read/);
    assert.deepEqual([attached.reading?.modelPagesSent?.length, attached.reading?.modelPagesRead], [33, [1, 40]], 'and what the model was sent and read, then and now, is told together');
    // A model that failed before and answers now, with nothing found: it has answered, and is not asked the same again.
    const failedThenAnswered = mergeReading({ ...partial, modelFailure: 'The document reader did not answer in time.' }, { ...cutShort, modelPagesSent: partial.modelPages, modelPagesRead: [] });
    assert.deepEqual([failedThenAnswered.pagesRead, failedThenAnswered.modelFailure, failedThenAnswered.modelPagesRead, needsReadingAgain(failedThenAnswered)], [8, undefined, [], false]);
    // What the later attempt has to tell is still told: the model failed, or its checks were cut.
    assert.deepEqual(
      [mergeReading(partial, { ...cutShort, pagesRead: 3, modelFailure: 'The document reader did not answer in time.' }).pagesRead, mergeReading(partial, { ...cutShort, pagesRead: 3, modelFailure: 'The document reader did not answer in time.' }).modelFailure],
      [8, 'The document reader did not answer in time.'],
    );
    assert.equal(mergeReading(partial, { ...cutShort, modelChecksCut: true }).modelChecksCut, true);
    assert.deepEqual(mergeReading({ ...partial, pagesInFile: 12 }, cutShort), cutShort, 'a reading of another file is not laid over this one');
    assert.equal(attachEvidenceFile(project, row.id, { fileName: 'other.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'other-1.pdf', capture: {} }, 'tester').reading, undefined, 'a file nobody read here carries none');
  });

  it('keeps the reading on the file, and offers a paper for reading again while a model it needed has not answered', async () => {
    // Loaded here: it brings the storage adapter with it, which a test file cannot load at its top.
    const { rowsToRead } = await import('../apps/api/src/documents/reread');
    const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
    const row = addEvidence(project, { title: 'Title bundle', kind: 'document', status: 'received' });
    const file = attachEvidenceFile(project, row.id, { fileName: 'bundle.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bundle-1.pdf', capture: {} }, 'tester');
    row.facts = proposeFacts([], [{ key: 'survey_numbers', label: 'Survey number', value: '73/4', display: '73/4', page: 1, quote: 'Survey No. 73/4' }]);
    assert.deepEqual(rowsToRead(project, false, true), [], 'a row with its facts and no reading on its file is as it always was: read');

    file.reading = partial;
    assert.equal(needsReadingAgain(partial), true);
    assert.deepEqual(rowsToRead(project, false, true).map((e) => e.id), [row.id], 'read in part, with a model to read the rest: offered again');
    assert.deepEqual(rowsToRead(project, false, false), [], 'with no model the same eight pages would be read to the same end');

    file.reading = { ...partial, modelFailure: 'The document reader did not answer in time.' };
    assert.deepEqual(rowsToRead(project, false, true).map((e) => e.id), [row.id], 'and again after a model failed on it');

    file.reading = { ...partial, pagesRead: 9, modelPagesSent: partial.modelPages, modelPagesRead: [40] };
    assert.equal(needsReadingAgain(file.reading), false);
    assert.deepEqual(rowsToRead(project, false, true), [], 'a model that answered is not asked the same question twice');

    // Unless the time allowed ran out before its values were read a second time: those are unverified for want of a minute.
    file.reading = { ...file.reading, modelChecksCut: true };
    assert.equal(needsReadingAgain(file.reading), true);
    assert.deepEqual(rowsToRead(project, false, true).map((e) => e.id), [row.id], 'a paper whose checks were cut is taken again');
    assert.deepEqual(rowsToRead(project, false, false), [], 'where there is a model to take it');
  });

  it('reads a part-read paper here again before a model sees it, and sends only an unread one straight to the model', async () => {
    const { straightToModel } = await import('../apps/api/src/documents/reread');
    const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
    // Two rows the reader got little from: one filed before readings were kept, one read in part.
    const old = addEvidence(project, { title: 'Old scan', kind: 'document', status: 'received' });
    attachEvidenceFile(project, old.id, { fileName: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'old-1.pdf', capture: {} }, 'tester');
    const bundle = addEvidence(project, { title: 'Title bundle', kind: 'document', status: 'received' });
    attachEvidenceFile(project, bundle.id, { fileName: 'bundle.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bundle-9.pdf', capture: {} }, 'tester').reading = partial;
    assert.deepEqual([...straightToModel(project, false)], ['old-1.pdf'], 'the one that carries a reading is read here again first, so its eight pages are not lost to a model sent the file bare');
    assert.deepEqual([...straightToModel(project, true)], [], 'and asked to read again, everything is read from the start');
    // A row with its values is not sent bare either way.
    old.facts = proposeFacts([], ['survey_numbers', 'extent_title', 'registration_date'].map((key) => ({ key, label: key, value: '1', display: '1', page: 1, quote: key })));
    assert.deepEqual([...straightToModel(project, false)], []);
  });
});

/* ==================================================================== */
/* A value OCR could not make out                                        */
/* ==================================================================== */

describe('the words a value was read from', () => {
  const word = (text: string, confidence: number, n: number) => ({ text, confidence, x: 0.1 + n * 0.08, y: 0.5, w: 0.07, h: 0.02 });
  const layout = [{ page: 1, words: ['Stamp', 'duty', 'paid:', 'Rs.', '17,8300.', 'IN', 'FAVOUR', 'OF', 'TRUE'].map((t, n) => word(t, t === '17,8300.' ? 10 : t === 'TRUE' ? 31 : 96, n)) }];
  const fact = (over: Partial<DocumentFact>): DocumentFact => ({ key: 'k', label: 'K', value: '', display: '', page: 1, quote: '', ...over });

  it('finds a name where the page writes it', () => {
    const words = valueWords(fact({ value: 'TRUE', display: 'TRUE', quote: 'IN FAVOUR OF TRUE' }), layout);
    assert.deepEqual(words.map((w) => [w.text, w.confidence]), [['TRUE', 31]]);
  });

  it('finds a number by its digits when the page groups them as no number is written', () => {
    const words = valueWords(fact({ value: 178300, unit: 'INR', display: 'Rs 1.78 lakh', quote: 'Stamp duty paid: Rs. 17,8300.' }), layout);
    assert.deepEqual(words.map((w) => [w.text, w.confidence]), [['17,8300.', 10]]);
  });

  it('has none for a value worked out from the page, or a page it has no words for', () => {
    assert.deepEqual(valueWords(fact({ value: true, display: 'yes', quote: 'Stamp duty paid' }), layout), []);
    assert.deepEqual(valueWords(fact({ value: 'TRUE', display: 'TRUE', quote: 'IN FAVOUR OF TRUE', page: 2 }), layout), []);
  });

  it('finds a name by its words when the page does not have it whole', () => {
    // OCR read the initial as a Kannada digit and the name short; a reader that leaned on it gives the short name back.
    const page = [{ page: 1, words: ['Name:', 'Sri', '೧.', 'Narasimha', 'son', 'of', 'Sri', 'Doddaiah'].map((t, n) => word(t, t === 'Narasimha' ? 54 : 92, n)) }];
    const words = valueWords(fact({ value: 'Sri D. Narasimha', display: 'Sri D. Narasimha', quote: 'Name: Sri ೧. Narasimha son of Sri Doddaiah' }), page);
    assert.deepEqual(words.map((w) => [w.text, w.confidence]), [['Sri', 92], ['Narasimha', 54], ['Sri', 92]]);
  });

  it('leaves out a value read from a word OCR could not make out, and keeps the rest', () => {
    const facts = [
      fact({ key: 'purchaser', value: 'TRUE', display: 'TRUE', quote: 'IN FAVOUR OF TRUE' }),
      fact({ key: 'stamp_duty', value: 178300, unit: 'INR', display: 'Rs 1.78 lakh', quote: 'Stamp duty paid: Rs. 17,8300.' }),
      fact({ key: 'label', value: 'Stamp duty', display: 'Stamp duty', quote: 'Stamp duty paid' }),
      fact({ key: 'ec_nil', value: true, display: 'yes', quote: 'Stamp duty paid' }),
    ];
    const { facts: kept, withheld } = supportedFacts(facts, layout);
    assert.deepEqual(kept.map((f) => f.key), ['label', 'ec_nil'], 'a value whose words were read surely, and one with no words of its own to judge it by');
    assert.deepEqual(withheld, [1], 'and the page it was left out on is named, for the router');
    assert.deepEqual(supportedFacts(facts, undefined).facts.length, 4, 'a text layer was not guessed at: nothing of it is left out');
  });
});

/* ==================================================================== */
/* Two readers, one value                                                */
/* ==================================================================== */

describe('the model reader’s values, in the rules’ own keys and forms', () => {
  it('keeps a date, an amount, an area and a width as the rules keep them', () => {
    assert.deepEqual(standardFact('registration_date', '9th day of July, 2021'), { label: 'Registered on', value: '2021-07-09', display: '9 Jul 2021' });
    assert.equal(standardFact('ec_from', '01-04-1994')?.value, '1994-04-01');
    const price = standardFact('consideration', 'Rs. 3,18,50,000/-', 'INR');
    assert.deepEqual([price?.label, price?.value, price?.unit], ['Sale consideration', 31850000, 'INR']);
    assert.equal(standardFact('consideration', '3.185 crore')?.value, 31850000);
    assert.equal(standardFact('extent_title', '2,450', 'square metres')?.value, 2450);
    assert.equal(standardFact('extent_title', '2,450 sqm')?.value, 2450);
    assert.equal(standardFact('extent_title', '1 acre 22 guntas')?.value, 6273, 'as the rules count an acre and a gunta');
    assert.equal(standardFact('extent_khata', '12,000', 'sqft')?.value, 1114.84);
    assert.deepEqual(standardFact('road_width_ft', '12', 'm'), { label: 'Abutting road width', value: 39, unit: 'ft', display: '39 ft' });
    assert.equal(standardFact('road_width_ft', '40', 'ft')?.value, 40);
  });

  it('keeps a count, a yes or no, and one of a few words', () => {
    assert.equal(standardFact('ec_transactions', '3')?.value, 3);
    assert.equal(standardFact('ec_nil', 'No')?.value, false);
    assert.equal(standardFact('oc_issued', 'yes')?.value, true);
    assert.equal(standardFact('khata_type', 'A Khata')?.value, 'A-Khata');
    assert.equal(standardFact('access_type', 'Public Road')?.value, 'public road');
    assert.equal(standardFact('converted_use', 'Residential')?.value, 'residential');
  });

  it('files an identifier as the number alone, and a name as it is written', () => {
    assert.equal(standardFact('survey_numbers', 'Survey No. 73/4')?.value, '73/4');
    assert.equal(standardFact('survey_numbers', 'ಸರ್ವೆ ನಂಬರ್‌ 141/2')?.value, '141/2', 'whatever script its label is in');
    assert.equal(standardFact('khata_number', 'ಖಾತಾ ಸಂಖ್ಯೆ: 1907/88/3')?.value, '1907/88/3');
    assert.equal(standardFact('order_number', 'ಸಂಖ್ಯೆ: ALN(S)(H)SR 84/2018-19')?.value, 'ALN(S)(H)SR 84/2018-19');
    assert.equal(standardFact('survey_numbers', '214/అ')?.value, '214/అ', 'a letter that is part of the number stays');
    assert.equal(standardFact('document_number', 'HRK-1-03127-2021-22')?.value, 'HRK-1-03127-2021-22');
    assert.equal(standardFact('vendor', ' Copper Kettle Landholdings Private Limited ')?.value, 'Copper Kettle Landholdings Private Limited');
  });

  it('files nothing that cannot be put in the key’s form, and nothing under a key that is not one', () => {
    assert.equal(standardFact('registration_date', 'last July'), null);
    assert.equal(standardFact('extent_title', '14 cents'), null);
    assert.equal(standardFact('ec_nil', 'see below'), null);
    assert.equal(standardFact('khata_type', 'A'), null);
    assert.equal(standardFact('registrationNumber', '123'), null);
  });

  it('tells a reader every key, and names only keys the rules themselves file under', () => {
    const rules = readFileSync(path.resolve('packages/shared/src/operating-model/document-parse.ts'), 'utf8');
    const filed = rules.slice(0, rules.indexOf('export const STANDARD_FACT_KEYS'));
    const guide = standardKeyGuide();
    for (const key of Object.keys(STANDARD_FACT_KEYS)) {
      assert.ok(guide.includes(`  - ${key}: `), `${key} is in the guide, with what it means`);
      assert.ok(STANDARD_FACT_KEYS[key]!.papers.length > 0, `${key} belongs to a paper`);
      const literal = key.startsWith('boundary_') ? 'boundary_${side.toLowerCase()}' : `'${key}'`;
      assert.ok(filed.includes(literal), `${key} is a key the rules file a fact under`);
    }
    for (const paper of STANDARD_PAPERS) {
      const line = guide.split('\n').find((said) => said.startsWith(`  - ${paper} (`));
      assert.ok(line, `${paper} is in the guide with its keys`);
      assert.deepEqual(line!.slice(line!.indexOf('): ') + 3).split(', '), Object.keys(STANDARD_FACT_KEYS).filter((key) => standardKeyFits(key, paper)));
    }
    assert.match(guide, /Say in "paper" which of the papers below the document is, or "other"\. Use only that paper's keys/);
  });

  it('takes a key only on the kind of paper that carries it', () => {
    assert.equal(standardKeyFits('ec_nil', 'encumbrance_certificate'), true);
    assert.equal(standardKeyFits('ec_nil', 'rtc'), false, 'a record of rights certifies no nil encumbrance');
    assert.equal(standardKeyFits('owner', 'khata'), true);
    assert.equal(standardKeyFits('owner', 'encumbrance_certificate'), false, 'the applicant on an encumbrance certificate is not the owner');
    assert.equal(standardKeyFits('survey_numbers', 'sale_deed'), true);
    assert.equal(standardKeyFits('survey_numbers', 'other'), false, 'a paper of no known kind carries none of them');
    assert.equal(standardKeyFits('registrationNumber', 'sale_deed'), false);
    assert.equal(standardKeyFits('ec_nil', undefined), false);
  });

  it('carries, for every paper, each key the rules themselves read off that paper', () => {
    // The table is held to the rules: were it narrower than they are, a model's right value would be thrown away on the paper it belongs to.
    for (const paper of PAPERS) {
      const sides = paper.text.en;
      const parsed = parseDocumentText([[...sides.front, ...sides.back].map((line) => line.replace(/^# /, '')).join('\n')], 'document.pdf');
      assert.equal(parsed.type, paper.kind, `${paper.id} is read as what it is`);
      for (const fact of parsed.facts.filter((f) => f.key in STANDARD_FACT_KEYS)) {
        assert.equal(standardKeyFits(fact.key, parsed.type), true, `${fact.key} is read off a ${parsed.type}, so a ${parsed.type} carries it`);
      }
    }
  });

  it('tells an identifier by the form of its key, not by how the key’s name ends', () => {
    // `extent_khata` ends in "khata" and `tax_paid` in "id": taken for identifiers, an area read off a Kannada page was left unconverted and dropped.
    for (const key of ['extent_khata', 'extent_survey', 'tax_paid', 'registration_date', 'owner']) assert.equal(isIdentifierKey(key), false, key);
    for (const key of ['survey_numbers', 'khata_number', 'pid', 'document_number', 'sas_number', 'order_number']) assert.equal(isIdentifierKey(key), true, key);
    assert.equal(isIdentifierKey('registrationNumber'), true, 'a key of a reader’s own is still told by its name');
    assert.equal(isIdentifierKey('roadName'), false);
  });
});

describe('a model’s reading laid over this server’s', () => {
  const row = { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k' };
  const fact = (key: string, value: DocumentFact['value'], page: number, source?: 'model'): DocumentFact => ({ key, label: key, value, display: String(value), page, quote: `${key} ${value}`, ...(source ? { source, pageCheck: 'page' as const, proof: 'second_reader' as const } : {}) });
  const read = (facts: DocumentFact[]) => ({ type: 'sale_deed', label: 'Sale deed', confidence: 0.9, method: 'ocr', facts, flags: [], summary: 'as the rules wrote it', rowHints: [], scopes: [], evidenceKind: 'document' });
  /** Page 1 read soundly, page 2 badly, page 3 not at all. */
  const reading: ReadingCoverage = { pagesInFile: 3, pagesRead: 2, readers: { text: 0, ocr: 2, model: 0 }, ocrPages: [1, 2], modelReasons: ['OCR was unsure of page 2.', '2 of 3 pages read here; page 3 was not.'], modelPages: [2, 3] };
  const local = (facts: DocumentFact[]) => ({ ...row, pages: 3, read: read(facts), reading }) as unknown as ChatIngestFile;
  const model = (modelFacts: DocumentFact[], more: Partial<ChatIngestFile> = {}) =>
    ({ ...row, modelRead: true, modelFacts, reading: { ...reading, modelPagesSent: [2, 3], modelPagesRead: [...new Set(modelFacts.map((f) => f.page))] }, ...more }) as unknown as ChatIngestFile;
  /** Each value with who read it and, where another reader read it differently, that reader's value beside it. */
  const values = (file: ChatIngestFile) => Object.fromEntries((file.read?.facts ?? []).map((f) => [f.key, [f.value, f.source ?? 'parser', ...(f.otherReading ? [f.otherReading.value] : [])]]));

  it('keeps the rules’ fact where the two agree, however each wrote the value', () => {
    const merged = mergeModelReading(local([fact('consideration', 31850000, 2), fact('vendor', 'Copper Kettle Landholdings Private Limited', 2)]), model([fact('consideration', '3,18,50,000', 2, 'model'), fact('vendor', 'COPPER KETTLE LANDHOLDINGS PRIVATE LIMITED.', 2, 'model')]));
    assert.deepEqual(values(merged), { consideration: [31850000, 'parser'], vendor: ['Copper Kettle Landholdings Private Limited', 'parser'] });
    assert.equal(merged.read?.summary, 'as the rules wrote it');
  });

  it('keeps both where the two differ and each has its words on a page, for a person to choose', () => {
    // On a page OCR was unsure of, on a page read soundly, and where the model read a page this server never did.
    const merged = mergeModelReading(
      local([fact('purchaser', 'TRUE', 2), fact('survey_numbers', '73/4', 1), fact('document_number', '1184/2003-04', 1)]),
      model([fact('purchaser', 'Nine Lanterns Realty LLP', 2, 'model'), fact('survey_numbers', '73/1', 1, 'model'), fact('document_number', 'HRK-1-03127-2021-22', 3, 'model')]),
    );
    assert.deepEqual(values(merged), {
      purchaser: ['TRUE', 'parser', 'Nine Lanterns Realty LLP'],
      survey_numbers: ['73/4', 'parser', '73/1'],
      document_number: ['1184/2003-04', 'parser', 'HRK-1-03127-2021-22'],
    }, 'the rules’ value stands where it stood, and the model’s is set beside it: neither is taken for the other');
    assert.equal(merged.read?.facts.length, 3, 'one fact a key, as everything that reads a paper’s facts expects');
    const other = merged.read!.facts[1]!.otherReading!;
    assert.deepEqual([other.source, other.page, other.proof, other.quote], ['model', 1, 'second_reader', 'survey_numbers 73/1'], 'with its own page, words and proof');
    assert.equal(merged.read?.summary, 'as the rules wrote it', 'and what the rules read is not rewritten');
  });

  it('tells two numbers apart by their digits, however alike they look', () => {
    const merged = mergeModelReading(local([fact('survey_numbers', '73/4', 1), fact('khata_number', '1907/88/3', 1), fact('extent_title', 2450, 1)]), model([fact('survey_numbers', '734', 1, 'model'), fact('khata_number', '1907-88-3', 1, 'model'), fact('extent_title', 2540, 1, 'model')]));
    assert.deepEqual(values(merged), { survey_numbers: ['73/4', 'parser', '734'], khata_number: ['1907/88/3', 'parser'], extent_title: [2450, 'parser', 2540] }, '73/4 is not 734, and 2450 is not 2540; a dash for a stroke is the same number');
  });

  it('never removes a value the rules read from the page for one a model could place on no page', () => {
    const loose = (key: string, value: DocumentFact['value'], page = 0): DocumentFact => ({ ...fact(key, value, page), source: 'model', proof: 'unverified' });
    const merged = mergeModelReading(
      local([fact('registration_date', '2003-11-18', 2), fact('extent_title', 2450, 2), fact('sub_registrar', 'Suvarnagiri', 2)]),
      model([], { modelUnverified: [loose('registration_date', '2021-07-09', 2), loose('extent_title', 2540), loose('sub_registrar', 'suvarnagiri')] }),
    );
    assert.deepEqual(values(merged), { registration_date: ['2003-11-18', 'parser'], extent_title: [2450, 'parser'], sub_registrar: ['Suvarnagiri', 'parser'] }, 'every one of them stands, on the page OCR was unsure of too');
    assert.deepEqual(merged.reading?.unverified?.map((f) => [f.key, f.value, f.page, f.proof]), [['registration_date', '2021-07-09', 2, 'unverified'], ['extent_title', 2540, 0, 'unverified']], 'what the model said instead is kept apart, as unverified; what it said the same is no second copy');
    assert.equal((merged.read?.facts ?? []).some((f) => f.proof === 'unverified'), false, 'and none of it is among the facts');
  });

  it('adds what only the model read, and keeps what only the rules read', () => {
    const merged = mergeModelReading(local([fact('access_type', 'public road', 2)]), model([fact('boundary_north', 'Survey No. 72', 3, 'model')]));
    assert.deepEqual(values(merged), { access_type: ['public road', 'parser'], boundary_north: ['Survey No. 72', 'model'] });
  });

  it('takes no value from a model under a key this kind of paper does not carry, where the rules said what the paper is', () => {
    // The rules read a sale deed. The model gave a nil-encumbrance answer and an owner, which are an encumbrance certificate's and a khata's.
    const merged = mergeModelReading(
      local([fact('survey_numbers', '73/4', 1)]),
      model([fact('ec_nil', true, 2, 'model'), fact('owner', 'Sri Ramaiah', 2, 'model'), fact('stamp_duty', 1783600, 3, 'model'), fact('witnessName', 'Sri Lokesh', 3, 'model')], {
        kindHint: 'encumbrance_certificate',
        modelUnverified: [{ ...fact('khata_number', '1907/88/3', 2), source: 'model', proof: 'unverified' }],
      }),
    );
    assert.deepEqual(values(merged), { survey_numbers: ['73/4', 'parser'], stamp_duty: [1783600, 'model'], witnessName: ['Sri Lokesh', 'model'] }, 'a deed’s own key and a key of the model’s own are kept');
    assert.equal(merged.reading?.unverified, undefined);
    assert.equal(merged.kindHint, undefined, 'and the rules’ word for what the paper is stands over the model’s');
  });

  it('counts a page as read by the model only when a value came back that was found on it', async () => {
    // A page of typed text, then a page with nothing this server can read on it.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText('A note of the folios held in this office, kept for reference by the record keeper.', { x: 40, y: 760, size: 11, font });
    doc.addPage([595, 842]);
    const bytes = Buffer.from(await doc.save());
    const here = await readIngestLocally({ fileName: 'two.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k' }, bytes);
    assert.deepEqual([here.reading?.pagesRead, here.reading?.pagesInFile, here.reading?.modelPages], [1, 2, [1, 2]]);
    assert.equal(here.reading?.modelReasons[0], '1 of 2 pages read here; page 2 was not.');
    assert.equal(here.reading?.unreadWhy, 'nothing legible was found on page 2');

    // Sent both pages, the model gave nothing that was found on either: the paper is still read in part.
    const nothing = mergeModelReading(here, { ...here, read: undefined, modelRead: true, reading: { ...here.reading!, modelPagesSent: [1, 2], modelPagesRead: [] } });
    assert.deepEqual([nothing.reading?.pagesRead, nothing.reading?.readers, nothing.reading?.modelPagesRead], [1, { text: 1, ocr: 0, model: 0 }, []]);
    assert.equal(readingLine(nothing.reading), '1 of 2 pages read: nothing legible was found on page 2. A model was sent pages 1 and 2; nothing it gave for pages 1 and 2 was found there.');
    assert.equal(needsReadingAgain(nothing.reading), false, 'it answered, and is not asked the same question again');

    const merged = mergeModelReading(here, { ...here, read: undefined, modelRead: true, modelFacts: [fact('folio', 'F-22', 2, 'model')], reading: { ...here.reading!, modelPagesSent: [1, 2], modelPagesRead: [2] } });
    assert.deepEqual([merged.reading?.pagesRead, merged.reading?.readers, merged.reading?.modelPagesSent, merged.reading?.modelPagesRead], [2, { text: 1, ocr: 0, model: 1 }, [1, 2], [2]]);
    assert.equal(merged.pages, 2, 'the file still has the pages this server counted');
    const kept = pagesOf(merged)!;
    assert.deepEqual(kept.pages.map((page) => [page.page, page.reader]), [[1, 'text'], [2, 'model']], 'a page this server read keeps this server’s words');
    assert.equal(kept.pages[1]!.text, 'folio F-22', 'and one only the model read has what the model quoted from it');
    assert.equal(kept.pagesRead, 2);
  });

  it('adds only the model’s share to a count it did not make itself', () => {
    const merged = mergeModelReading(local([fact('survey_numbers', '73/4', 1)]), model([fact('stamp_duty', 1783600, 3, 'model')]));
    assert.deepEqual(merged.reading, { ...reading, readers: { text: 0, ocr: 2, model: 1 }, modelPagesSent: [2, 3], modelPagesRead: [3] });
    assert.equal(pagesOf(merged), undefined);
  });

  it('keeps this server’s reading when the model failed, and says on the reading that it did', () => {
    const before = local([fact('survey_numbers', '73/4', 1)]);
    const after = mergeModelReading(before, { ...row, readFailure: 'The document reader did not answer in time.' } as ChatIngestFile);
    assert.deepEqual(after.read, before.read, 'what was read here stands');
    assert.equal(after.readFailure, undefined, 'and the paper is not called unread');
    assert.equal(after.reading?.modelFailure, 'The document reader did not answer in time.');
    assert.equal(needsReadingAgain(after.reading), true, 'so it is offered for reading again');
    assert.equal(readingLine(after.reading), '2 of 3 pages read. No model has read the rest: the document reader did not answer in time.');
  });
});

/* ==================================================================== */
/* What rests on a model's value before anybody has accepted it          */
/* ==================================================================== */

describe('a model’s value that nobody has accepted', () => {
  const project = () => createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
  const stated = (key: string, value: DocumentFact['value'], source?: 'model'): DocumentFact => ({ key, label: key, value, display: String(value), page: 1, quote: `${key} ${value}`, ...(source ? { source, proof: 'second_reader' as const } : {}) });
  const charges = (p: ReturnType<typeof project>) => {
    const working = runValuationApproaches(p);
    return valueChecks(p, working, valueSummary(p, working)).find((c) => c.key === 'charges');
  };

  it('answers none of the lender’s checks, which say that a reading is waiting', () => {
    const p = project();
    const row = addEvidence(p, { title: 'Holdings extract', kind: 'document', status: 'received' });
    // A model took a holdings paper for an encumbrance certificate and read a nil result off it.
    row.facts = proposeFacts([], [stated('ec_nil', true, 'model')]);
    assert.deepEqual(standingFacts(row), []);
    const waiting = charges(p);
    assert.deepEqual([waiting?.verdict, waiting?.headline], ['unknown', 'A reading is waiting']);
    assert.match(waiting!.detail, /A model read “ec_nil: true”.*nobody has accepted it/);

    reviewFacts(p, row.id, ['ec_nil'], 'accept', 'tester');
    assert.equal(standingFacts(row).length, 1);
    assert.notEqual(charges(p)?.headline, 'A reading is waiting', 'accepted by a person, it answers the check as any value does');
  });

  it('is not what a check rests on while the rules’ own value stands beside it', () => {
    const p = project();
    const row = addEvidence(p, { title: 'Encumbrance certificate', kind: 'document', status: 'received' });
    row.facts = proposeFacts([], [stated('ec_nil', false), stated('subsisting_charges', 1)]);
    assert.equal(standingFacts(row).length, 2, 'what the rules read off the page stands before anybody has looked, as it always did');
    assert.notEqual(charges(p)?.headline, 'A reading is waiting');
  });

  it('is kept or set aside by a person naming it, and is left out of "accept all"', () => {
    const p = project();
    const row = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' });
    row.facts = proposeFacts([], [{ ...stated('survey_numbers', '73/4'), otherReading: stated('survey_numbers', '73/1', 'model') }, stated('sub_registrar', 'Suvarnagiri')]);

    const all = reviewFacts(p, row.id, 'all', 'accept', 'tester');
    assert.deepEqual(all.changed.map((f) => f.key), ['sub_registrar'], 'nobody looked at the value two readers read differently, so nobody accepted it');
    assert.equal(row.facts!.find((f) => f.key === 'survey_numbers')!.review, 'proposed');

    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester', undefined, { take: 'other' });
    const kept = row.facts!.find((f) => f.key === 'survey_numbers')!;
    assert.deepEqual([kept.value, kept.source, kept.review, kept.proof], ['73/1', 'model', 'accepted', 'second_reader'], 'the model’s reading, with its own words and proof');
    assert.deepEqual([kept.otherReading?.value, kept.otherReading?.source], ['73/4', undefined], 'and the one not chosen is kept beside it');
    assert.equal(row.facts!.filter((f) => f.key === 'survey_numbers').length, 1);

    // Reopened, both wait again; accepted by its key alone, the value shown is the one kept.
    reviewFacts(p, row.id, ['survey_numbers'], 'reopen', 'tester');
    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester');
    assert.deepEqual([row.facts!.find((f) => f.key === 'survey_numbers')!.value, row.facts!.find((f) => f.key === 'survey_numbers')!.review], ['73/1', 'accepted']);
  });
});
