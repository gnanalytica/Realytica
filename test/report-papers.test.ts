/**
 * Two reports a project manager is sent every month, dropped as they arrive.
 *
 * A rehearsal on a firm's own papers found that a cost consultant's monthly
 * cost report was filed as a "Contract" and offered to Legal, with "0 facts"
 * and nothing reaching the Cost Report, that a page of site photographs was
 * said to be "in Kannada", and that a technical due diligence report was filed
 * as an "Approval" with none of its thirteen observations offered. The same
 * things had passed on papers invented to be easy.
 *
 * These papers are invented too, but in the shape the real ones have: a cost
 * report in three forms (a text layer, pages that are pictures, and pages of
 * type round a picture of the table), a page of photographs captioned in
 * English, and a due diligence report whose observations are a table.
 *
 * What the bundled OCR makes of a table of figures is measured here and not
 * assumed. On the invented report drawn at 300 dpi (eleven packages, six
 * columns, ruled, with shaded heading rows) it reads every figure of every
 * row once the rules are lifted, and the rows add up to the page's own total
 * to the rupee. Read with its rules on, half the rows were lost or had a
 * digit changed. A scanned or photographed table will read worse than a clean
 * drawn one: that is what the add-up check and a person's eye are for.
 *
 * No model is called and nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ANSWER_WAITED_FOR_MS,
  READING_UNDER_WAY_MS,
  REPORT_OBSERVATIONS_SET,
  classifyIngestFile,
  costPapersOf,
  createProject,
  documentWorkstream,
  functionOfDocument,
  landIngestFile,
  papersInHand,
  parseDocumentText,
  readingLine,
  reportObservations,
  startCostReport,
  acceptCostOffersOnPage,
  costReportOf,
  costReportTotals,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';
import { noteAsked, notReadYetCard, setDroppedAside, wasAsked } from '../apps/api/src/documents/dropped';
import { needsModelReading, readIngestLocally, routeReading, whyUnread } from '../apps/api/src/documents/intake';
import { offerModelRowsOfPaper, offerRowsOfPaper, readCostPictures, rowsOfferedSaid } from '../apps/api/src/documents/offers';
import { whatWasDropped } from '../apps/api/src/documents/questionnaire-drop';
import { releaseOcr } from '../apps/api/src/documents/read-text';
import { readingBanner } from '../apps/web/src/lib/reading-pending';
import { COST_PACKAGES, COST_TOTAL } from './fixtures/cost-report';
import { OBSERVATIONS, costReportWithPictureOn, costReportWithTextLayer, dueDiligenceReport } from './fixtures/report-papers';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error('Reading a report reached for the network.');
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await releaseOcr();
});

function project(): DdProject {
  return createProject({ name: 'Lakeview Residences', type: 'residential', location: 'Kere Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-RP1', 'tester');
}

async function read(fileName: string, bytes: Uint8Array): Promise<ChatIngestFile> {
  return readIngestLocally({ fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `key-${fileName}` }, Buffer.from(bytes));
}

/** The paper put on the register as a drop puts it, and its row. */
function landed(p: DdProject, paper: ChatIngestFile): string {
  const evidenceId = landIngestFile(p, paper, 'tester');
  assert.ok(evidenceId, 'the paper is on a row');
  return evidenceId!;
}

/** Every offered row's figures, by package, as the fixture writes them. */
function figures(p: DdProject, evidenceId: string): Array<{ name: string; budget?: number; awarded?: number; anticipated?: number; certified?: number }> {
  return costPapersOf(p)
    .find((paper) => paper.evidenceId === evidenceId)!
    .offers.map((offer) => ({ name: offer.cells.name, budget: offer.cells.budget, awarded: offer.cells.poIssued, anticipated: offer.cells.anticipatedCost, certified: offer.cells.certified }));
}

const EXPECTED = COST_PACKAGES.map((pack) => ({ name: pack.name, budget: pack.budget, awarded: pack.awarded, anticipated: pack.anticipated, certified: pack.certified }));

describe('a cost report with a text layer', () => {
  it('is recognised as a cost report, is no contract, and is filed under Finance, Budget', async () => {
    const paper = await read('Lakeview CR-05 Aug 2026.pdf', await costReportWithTextLayer());
    assert.deepEqual([paper.read?.type, paper.read?.label, paper.read?.method], ['cost_report', 'Cost report', 'text']);
    // Read whole from its own text: nothing is said to be wanting, though it states no fact with a key, and the keyed-fact reader is not asked.
    assert.deepEqual(paper.reading?.modelReasons, []);
    assert.equal(needsModelReading(paper), false);
    const p = project();
    assert.equal(classifyIngestFile(p, paper).hint.kind, 'document', 'never listed as a contract, whatever contracts it names');
    const evidenceId = landed(p, paper);
    const row = p.evidence.find((held) => held.id === evidenceId)!;
    assert.deepEqual([row.documentType, row.kind, documentWorkstream(p, row), functionOfDocument(p, row)], ['Cost report', 'document', 'finance.budget', 'finance.budget']);
  });

  it('offers its eleven packages to the Cost Report with the page each is on, and types none', async () => {
    const paper = await read('Lakeview CR-05 Aug 2026.pdf', await costReportWithTextLayer());
    const p = project();
    const evidenceId = landed(p, paper);
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const offered = offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: false });
    assert.deepEqual(offered, { costRows: { offered: 11, said: '' } });
    assert.equal(rowsOfferedSaid(offered), '11 rows offered to the Cost Report');
    assert.deepEqual(figures(p, evidenceId), EXPECTED);
    const held = costPapersOf(p)[0]!;
    assert.equal(held.offers.every((offer) => offer.page === 2 && offer.reader === 'text' && offer.status === 'offered'), true);
    assert.deepEqual(held.pages.map((page) => [page.page, page.addsUp]), [[2, true]]);
    assert.equal(held.offers[4]!.cells.awardedTo, 'Harbour Joinery');
    assert.equal(costReportOf(p, report.id).rows.length, 0, 'nothing is on the Cost Report until a person accepts it');
    // Accepted, the ledger's total is the report's own.
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 2, report.id, 'lead'), { accepted: 11, left: 0 });
    assert.equal(costReportTotals(costReportOf(p, report.id)).budget, COST_TOTAL.budget);
  });

  it('is known by its name alone where its pages give no words', () => {
    assert.equal(parseDocumentText(['Lakeview Residences'], 'Monthly Cost Report - August 2026.pdf').label, 'Cost report');
    assert.equal(parseDocumentText(['Lakeview Residences'], 'Site layout.pdf').type, 'other');
  });
});

describe('a cost report whose pages are pictures', () => {
  const bytes = new Uint8Array(readFileSync(path.resolve('test/fixtures/documents/SCANNED_Cost_Report_Tables_As_Images.pdf')));
  let paper: ChatIngestFile;
  before(async () => {
    paper = await read('Lakeview CR-05 Aug 2026 (scan).pdf', bytes);
  });

  it('is recognised by OCR of its cover, and filed under Finance, Budget', () => {
    assert.deepEqual([paper.read?.type, paper.read?.label], ['cost_report', 'Cost report']);
    assert.deepEqual(paper.reading?.readers, { text: 0, ocr: 3, model: 0 });
    const p = project();
    const evidenceId = landed(p, paper);
    const row = p.evidence.find((held) => held.id === evidenceId)!;
    assert.equal(documentWorkstream(p, row), 'finance.budget');
  });

  it('does not say a page of photographs captioned in English is in Kannada', () => {
    const reasons = paper.reading?.modelReasons.join(' ') ?? '';
    assert.doesNotMatch(reasons, /Kannada|script/i, reasons);
    assert.match(reasons, /OCR was unsure of pages? /, 'a photograph reads badly, and that is what is said of it');
  });

  it('has every figure of its table read by the bundled OCR, the rows adding up to the page’s total to the rupee', () => {
    const p = project();
    const evidenceId = landed(p, paper);
    const offered = offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: false });
    assert.equal(offered.costRows?.offered, 11);
    const held = costPapersOf(p)[0]!;
    assert.equal(held.offers.every((offer) => offer.page === 2 && offer.reader === 'ocr' && !offer.unplaced), true);
    // The figures, not the words: OCR reads "Constructions" a letter out, and a name is a person's to check.
    assert.deepEqual(figures(p, evidenceId).map(({ name: _name, ...row }) => row), EXPECTED.map(({ name: _name, ...row }) => row));
    assert.deepEqual(held.pages.map((page) => [page.page, page.reader, page.addsUp]), [[2, 'ocr', true]]);
    // The page of photographs is where a table might be that nobody here could read; the cover, read surely, is not.
    assert.deepEqual(held.pictures, [3]);
  });
});

describe('a cost report whose table is a picture on a page of type', () => {
  it('has the picture read as well as the type, and offers its rows', async () => {
    const paper = await read('Lakeview CR-05.pdf', await costReportWithPictureOn('table'));
    assert.equal(paper.read?.type, 'cost_report');
    const p = project();
    const evidenceId = landed(p, paper);
    assert.equal(offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: false }).costRows?.offered, 11);
    assert.deepEqual(figures(p, evidenceId).map(({ name: _name, ...row }) => row), EXPECTED.map(({ name: _name, ...row }) => row));
    assert.deepEqual(costPapersOf(p)[0]!.pages.map((page) => [page.page, page.reader, page.addsUp]), [[2, 'ocr', true]]);
  });

  it('says in one plain line that the tables are pictures, where no row could be read and no model is set up', async () => {
    const paper = await read('Lakeview CR-05.pdf', await costReportWithPictureOn('photographs'));
    assert.equal(paper.read?.type, 'cost_report', 'still a cost report, by its cover');
    assert.doesNotMatch(paper.reading?.modelReasons.join(' ') ?? '', /Kannada/);
    const p = project();
    const evidenceId = landed(p, paper);
    const offered = offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: false });
    assert.deepEqual(offered, { costRows: { offered: 0, said: 'The tables in this report are pictures, which only a model reader could read and none is set up here. Paste the table below, with the PDF open beside it.' } });
    assert.deepEqual(costPapersOf(p)[0]!.pictures, [2]);
    assert.equal(rowsOfferedSaid(offered), 'its tables are pictures and no row was read from them');
  });

  it('shows a model those pages where one is set up, and offers what it gives as unverified where this server has no words to hold it to', async () => {
    const pdf = await costReportWithPictureOn('photographs');
    const paper = await read('Lakeview CR-05.pdf', pdf);
    const p = project();
    const evidenceId = landed(p, paper);
    const first = offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: true });
    assert.deepEqual(first.askModel, [2]);
    const shown: number[][] = [];
    const answered = await readCostPictures(paper, Buffer.from(pdf), first.askModel!, async (input) => {
      shown.push([...input.pages]);
      return { rows: [{ page: 2, name: 'RCC structure', budget: '12,50,00,000', anticipated: '12,46,10,000', note: 'On budget.' }, { page: 7, name: 'Lifts', budget: '1,20,00,000' }], pagesSent: [2] };
    });
    assert.deepEqual(shown, [[2]], 'only the pages nobody here could read');
    const after = offerModelRowsOfPaper(p, evidenceId, paper, answered!);
    assert.deepEqual(after.costRows, { offered: 1, said: '' });
    const offer = costPapersOf(p)[0]!.offers[0]!;
    assert.deepEqual([offer.reader, offer.proof, offer.cells.budget, offer.page], ['model', 'unverified', 12_50_00_000, 2]);
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 2, report.id, 'lead'), { accepted: 0, left: 1 }, 'an unverified row is a person’s to look at');
  });
});

describe('a technical due diligence report', () => {
  it('is recognised as a report, is no approval, and is filed under Engineering, Technical', async () => {
    const paper = await read('Lakeview TDD report Aug 2026.pdf', await dueDiligenceReport());
    assert.deepEqual([paper.read?.type, paper.read?.label], ['technical_report', 'Technical due diligence report']);
    const p = project();
    assert.equal(classifyIngestFile(p, paper).hint.kind, 'document');
    const evidenceId = landed(p, paper);
    const row = p.evidence.find((held) => held.id === evidenceId)!;
    assert.deepEqual([row.documentType, row.kind, documentWorkstream(p, row)], ['Technical due diligence report', 'document', 'construction.quality']);
  });

  it('is a report still, though it names the approvals it looked at', () => {
    const pages = ['TECHNICAL DUE DILIGENCE REPORT\nSite visit and visual inspection. The plan sanction, the sanctioned plan, the commencement certificate and the occupancy certificate were perused. LP No 12, date of sanction, FAR sanctioned and ground coverage are as on the drawings.\nObservations and risk category follow, with the mitigation recommended.'];
    assert.equal(parseDocumentText(pages, 'report.pdf').type, 'technical_report');
  });

  it('is not asked about: it is a paper, not a questionnaire', async () => {
    const bytes = await dueDiligenceReport();
    const paper = await read('Lakeview TDD report Aug 2026.pdf', bytes);
    const what = await whatWasDropped({ project: project(), paper, file: { originalname: paper.fileName, buffer: Buffer.from(bytes) }, fresh: true, whole: true });
    assert.deepEqual(what, { as: 'paper' });
  });

  for (const as of ['table', 'labelled'] as const) {
    it(`offers its thirteen observations to Technical as rows, each with its page and the page’s words (${as})`, async () => {
      const paper = await read('Lakeview TDD report Aug 2026.pdf', await dueDiligenceReport(as));
      const p = project();
      const evidenceId = landed(p, paper);
      const offered = offerRowsOfPaper(p, evidenceId, paper);
      assert.deepEqual(offered, { observations: 13 });
      assert.equal(rowsOfferedSaid(offered), '13 observations offered to Technical');
      const records = p.fieldSheets![REPORT_OBSERVATIONS_SET]!.records!;
      assert.equal(records.length, 13);
      // Each is a risk picked from the list and the report's own words, waiting: nothing stands until a person accepts it.
      assert.deepEqual(records.map((record) => record.values.risk?.value), OBSERVATIONS.map((one) => one.risk.toLowerCase()));
      for (const record of records) for (const value of Object.values(record.values)) assert.equal(value.state, 'proposed');
      const first = records[0]!.values;
      assert.equal(String(first.seen!.value).includes('Seepage along the construction joint at grid C-4'), true, String(first.seen!.value));
      assert.equal(first.action!.value, 'Inject the joint with polyurethane grout and test again after the monsoon.');
      assert.equal(first.element!.value, 'waterproofing');
      assert.deepEqual([first.seen!.sourceEvidenceId, first.seen!.page], [evidenceId, 1]);
      assert.equal(first.seen!.origin?.kind === 'paper' && first.seen!.origin.proof, 'page_text');
      assert.equal(records[12]!.values.seen!.page, 2, 'the eighth to the thirteenth are on the second page');
      assert.equal(records[4]!.values.risk!.value, 'critical');
      // Read again, it offers nothing twice.
      assert.deepEqual(offerRowsOfPaper(p, evidenceId, paper), { observations: 0 });
      assert.equal(p.fieldSheets![REPORT_OBSERVATIONS_SET]!.records!.length, 13);
    });
  }

  it('reads no observation into a numbered list that is none', () => {
    assert.deepEqual(reportObservations(['1 Introduction\n2 Scope of the visit\n3 Limitations\nThe High Court order of 2019 is noted.']), []);
    assert.deepEqual(reportObservations(['Photographs of the site follow.']), []);
  });
});

describe('“12 of 26 pages read”', () => {
  it('says which pages were not read, and why', () => {
    const pages = Array.from({ length: 26 }, (_, i) => ({ page: i + 1, reader: i < 2 ? ('text' as const) : i < 10 ? ('ocr' as const) : i < 12 ? ('text' as const) : ('none' as const), ...(i >= 12 ? { unread: 'past_ocr_limit' as const } : {}) }));
    const why = whyUnread(pages);
    assert.equal(why, 'pages 13 to 26 were left, as only the first 8 scanned pages of a file are read here');
    assert.equal(readingLine({ pagesInFile: 26, pagesRead: 12, readers: { text: 4, ocr: 8, model: 0 }, modelReasons: ['12 of 26 pages read here; pages 13 to 26 were not.'], modelPages: [13], unreadWhy: why }), '12 of 26 pages read: pages 13 to 26 were left, as only the first 8 scanned pages of a file are read here. No model has read the rest.');
  });

  it('names a page nothing legible was found on, and one the reading ran out of time before', () => {
    assert.equal(whyUnread([{ page: 1, reader: 'text' }, { page: 2, reader: 'none', unread: 'nothing_legible' }, { page: 3, reader: 'none', unread: 'out_of_time' }]), 'the reading ran out of time before page 3; nothing legible was found on page 2');
  });
});

describe('the script a page is said to be in', () => {
  const kannada = 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ ಕಂದಾಯ ಇಲಾಖೆ ಪಹಣಿ ಪತ್ರಿಕೆ ಸರ್ವೆ ನಂಬರ್';
  const noise = 'ಷಾ ಕ್ಮ ಏ ಸ ಡ್ ಡಿ ಛೆ ಕಿ ಹ ನಾಸಾ ಕ್ ಕ್ಷ ತ ಳ್ಳ ಚ';
  const caption = 'Photo 1: Tower A - third floor slab reinforcement in progress';
  const words = (text: string, confidence: number) => text.split(' ').map((word) => ({ text: word, x: 0, y: 0, w: 0.1, h: 0.02, confidence }));

  it('is told from the words OCR made out, so marks it guessed at in a photograph are no script', () => {
    const route = routeReading({
      pages: [{ page: 1, reader: 'ocr', confidence: 54, unsure: true }],
      texts: [`${noise}\n${caption}`],
      layout: [{ page: 1, words: [...words(noise, 30), ...words(caption, 93)] }],
      read: { type: 'cost_report', confidence: 0.9, facts: [1, 2, 3] },
    });
    assert.deepEqual(route.reasons, ['OCR was unsure of page 1.']);
  });

  it('is still Kannada for a page whose Kannada words OCR read', () => {
    const route = routeReading({
      pages: [{ page: 1, reader: 'ocr', confidence: 91 }],
      texts: [kannada],
      layout: [{ page: 1, words: words(kannada, 91) }],
      read: { type: 'rtc', confidence: 0.9, facts: [1, 2, 3] },
    });
    assert.deepEqual(route.reasons, ['Page 1 is in Kannada.']);
  });

  it('is told from the text itself where no word positions were kept', () => {
    assert.deepEqual(routeReading({ pages: [{ page: 1, reader: 'text' }], texts: [kannada], read: { type: 'rtc', confidence: 0.9, facts: [1, 2, 3] } }).reasons, ['Page 1 is in Kannada.']);
  });
});

describe('“Reading continues” never sticks', () => {
  const file: ChatIngestFile = { fileName: 'Site queries.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'key-queries' };
  const minutes = (n: number, from: string): Date => new Date(Date.parse(from) + n * 60_000);

  function dropped(): { p: DdProject; since: string } {
    const p = project();
    const note = notReadYetCard(file, 'tester');
    p.chatProposals = [note];
    return { p, since: String(note.payload.readingSince) };
  }

  it('says a paper is being read while a request could be at work on it, and that it was left unread after', () => {
    const { p, since } = dropped();
    assert.deepEqual(papersInHand(p, minutes(1, since)).reading.map((paper) => paper.fileName), ['Site queries.pdf']);
    const later = papersInHand(p, new Date(Date.parse(since) + READING_UNDER_WAY_MS + 1));
    assert.deepEqual([later.reading.length, later.unread.length], [0, 1]);
  });

  it('does not say a file is being read once the chat has asked what it is', () => {
    const { p, since } = dropped();
    assert.equal(wasAsked(p, file.storageKey), false);
    noteAsked([p], file.storageKey, 'questionnaire', since);
    const hand = papersInHand(p, minutes(1, since));
    assert.deepEqual([hand.reading.length, hand.asked.length, hand.unread.length, hand.held.length], [0, 1, 0, 0]);
    assert.equal(hand.asked[0]!.asked, 'questionnaire');
    assert.equal(wasAsked(p, file.storageKey), true, 'and the question is not put a second time');
  });

  it('times a question nobody answered out to a paper to file, held where the papers are and on no banner', () => {
    const { p, since } = dropped();
    noteAsked([p], file.storageKey, 'questionnaire', since);
    const hand = papersInHand(p, new Date(Date.parse(since) + ANSWER_WAITED_FOR_MS + 1));
    assert.deepEqual([hand.reading.length, hand.asked.length, hand.unread.length, hand.held.length], [0, 0, 0, 1]);
    // A day later it is the same: nothing says it is on its way.
    const nextDay = papersInHand(p, minutes(24 * 60, since));
    assert.deepEqual([nextDay.reading.length, nextDay.asked.length, nextDay.unread.length, nextDay.held.length], [0, 0, 0, 1]);
  });

  it('is cleared by setting the paper aside, and survives the record being saved and loaded', () => {
    const { p, since } = dropped();
    const afterTheRequest = new Date(Date.parse(since) + READING_UNDER_WAY_MS + 1);
    assert.equal(papersInHand(p, afterTheRequest).unread.length, 1);
    assert.equal(setDroppedAside(p, file.storageKey), true);
    assert.equal(setDroppedAside(p, 'no-such-file'), false);
    const reloaded = JSON.parse(JSON.stringify(p)) as DdProject;
    const hand = papersInHand(reloaded, afterTheRequest);
    assert.deepEqual([hand.reading.length, hand.asked.length, hand.unread.length, hand.held.length], [0, 0, 0, 1]);
  });

  it('goes when the paper lands on its row', () => {
    const { p, since } = dropped();
    noteAsked([p], file.storageKey, 'questionnaire', since);
    landIngestFile(p, { ...file, readFailure: 'Not read.' }, 'tester');
    const hand = papersInHand(p, minutes(1, since));
    assert.deepEqual([hand.reading.length, hand.asked.length, hand.unread.length, hand.held.length], [0, 0, 0, 0]);
  });

  it('is what the notice on the page says, the same after a reload and from another browser', () => {
    const { p, since } = dropped();
    // What the browser that dropped it remembers past a reload; another browser remembers nothing.
    const remembered = { at: since, names: [file.fileName] };
    const notice = (at: Date, mine = true) => readingBanner({ remembered: mine ? remembered : null, evidence: p.evidence, inHand: papersInHand(p, at), live: false, now: at });

    // A minute in, with the request still at work: being read, and the page looks again.
    assert.deepEqual([notice(minutes(1, since))?.head, notice(minutes(1, since))?.reading, notice(minutes(1, since))?.poll], ['reading', [file.fileName], true]);
    assert.equal(notice(minutes(1, since), false)?.head, 'reading');

    // The chat asked what it is. It is not being read, whatever the browser remembers of the drop: this used to say
    // "Reading continues… being read" on every page for as long as nobody answered.
    noteAsked([p], file.storageKey, 'questionnaire', since);
    for (const mine of [true, false]) {
      const asked = notice(minutes(2, since), mine)!;
      assert.deepEqual([asked.head, asked.reading, asked.poll, asked.asked.map((paper) => paper.fileName)], ['asked', [], false, [file.fileName]]);
    }

    // Nobody answers. The notice goes, and stays gone: the file is held as a paper to file, said in Documents.
    const late = new Date(Date.parse(since) + ANSWER_WAITED_FOR_MS + 1);
    assert.equal(notice(late), null);
    assert.equal(notice(late, false), null);
    assert.equal(notice(minutes(24 * 60, since), false), null);
    assert.deepEqual(papersInHand(p, late).held.map((paper) => [paper.fileName, paper.asked]), [[file.fileName, 'questionnaire']]);
  });

  it('says a drop has all landed, once, and nothing while a reading is on the screen', () => {
    const { p, since } = dropped();
    const remembered = { at: since, names: [file.fileName] };
    landIngestFile(p, { ...file, readFailure: 'Not read.' }, 'tester');
    const at = minutes(1, since);
    const done = readingBanner({ remembered, evidence: p.evidence, inHand: papersInHand(p, at), live: false, now: at })!;
    assert.deepEqual([done.head, done.landed.length, done.reading, done.poll], ['done', 1, [], false]);
    assert.equal(readingBanner({ remembered, evidence: p.evidence, inHand: papersInHand(p, at), live: true, now: at }), null);
    // Closed, the browser's note is forgotten, and there is nothing to say.
    assert.equal(readingBanner({ remembered: null, evidence: p.evidence, inHand: papersInHand(p, at), live: false, now: at }), null);
  });

  it('reads a record kept before a question could be noted', () => {
    const { p, since } = dropped();
    const old = JSON.parse(JSON.stringify(p)) as DdProject;
    assert.deepEqual(papersInHand(old, minutes(1, since)).reading.length, 1);
  });
});
