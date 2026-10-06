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
 * So the page is now checked here: the value against the words quoted for
 * it, then against the page's own text where this server read it, then by
 * cutting that one page out and asking a second reader for the value by its
 * name. These tests hold the rules that matter: a page reaches a fact only
 * when the value was found on it; an exact value is held to its own quote;
 * and the second reader is never shown what the first one read.
 */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  findQuoteInPages,
  itemsPrompt,
  normalizeForPage,
  onePagePdf,
  numbersIn,
  pageHolds,
  pageStates,
  pdfPageCount,
  placeReadings,
  quoteStates,
  sameReading,
  type PageReading,
  type ReadPage,
  type ReadingToPlace,
} from '../packages/agents/src/agents/page-check';
import { CUT_OFF_REASON, describeChecks, originalPage, runDocumentIntelligence } from '../packages/agents/src/agents/document-intelligence';
import { enrichIngestWithDocumentIntelligence } from '../packages/agents/src/project/ingest-intelligence';
import { createProject, STANDARD_FACT_KEYS, type CaseDocument, type ChatIngestFile, type PropertyIdentity } from '../packages/shared/src';

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

  it('holds a number to its every digit, however many of the other words are there', () => {
    // Every word of the quote but its last is on the page, and that last is a digit out: one character, too short to count as a word.
    const page = 'The schedule property is the land in Survey No. 73/4 of Navilugudda Village, Kallusanka Hobli, measuring 2,450 square metres';
    assert.equal(pageHolds(page, 'the land in Survey No. 73/1 of Navilugudda Village, Kallusanka Hobli'), false, '73/1 is not on a page that prints 73/4');
    assert.equal(pageHolds(page, 'the land in Survey No. 73/4 of Navilugudda Village, Kallusanka Hobli'), true);
    assert.equal(pageHolds(page, 'Village, Kallusanka Hobli, measuring 2,540 square metres'), false, 'nor 2,540 on one that prints 2,450');
    assert.equal(pageHolds('Khata No. 1907/88/32 of the register', 'Khata No. 1907/88/3'), false, 'a number is not found inside a longer one');
    assert.equal(pageHolds('ಸರ್ವೆ ನಂಬರ್ 141/2 ರ ಜಮೀನು', 'ಸರ್ವೆ ನಂಬರ್ 141/2'), true);
    assert.equal(pageHolds('ಸರ್ವೆ ನಂಬರ್ 141/2 ರ ಜಮೀನು', 'ಸರ್ವೆ ನಂಬರ್ 143/2'), false);
    assert.equal(pageHolds('ಸರ್ವೆ ನಂಬರ್ ೧೪೧/೨ ರ ಜಮೀನು, ಕಲ್ಲುಸಂಕ ಹೋಬಳಿ', 'ಸರ್ವೆ ನಂಬರ್ ೧೪೩/೨ ರ ಜಮೀನು, ಕಲ್ಲುಸಂಕ ಹೋಬಳಿ'), false, 'in whichever digits the page writes it');
    assert.deepEqual(numbersIn('Rs. 3,18,50,000/- on 09-07-2021 for Sy. No. 73/4.'), ['3-18-50-000', '09-07-2021', '73-4']);
  });

  it('places a quote on the page that holds it, preferring the page the reading named', () => {
    const pages = ['Khata No. KH-7741-B/2019', 'Nothing here', 'Khata No. KH-7741-B/2019 repeated'];
    assert.equal(findQuoteInPages('Khata No. KH-7741-B/2019', pages, 3), 3, 'the named page holds it, so it is that page');
    assert.equal(findQuoteInPages('Khata No. KH-7741-B/2019', pages, 2), 1, 'the named page does not, so the first that does');
    assert.equal(findQuoteInPages('Sale consideration', pages, 1), undefined);
  });
});

describe('a value held to the words quoted for it', () => {
  it('holds a date to the day its quote states', () => {
    // The shape of a reading measured on 5 October 2026: the quote right, the value a digit out.
    assert.equal(quoteStates({ key: 'ec_to', value: '31-01-2024' }, 'Period of search: from 01-04-1994 to 31-03-2024'), false);
    assert.equal(quoteStates({ key: 'ec_to', value: '31-03-2024' }, 'Period of search: from 01-04-1994 to 31-03-2024'), true);
    assert.equal(quoteStates({ key: 'registration_date', value: '28-06-2011' }, 'made on the 28th day of June 2011 at Bengaluru'), true, 'however the page writes the day');
    assert.equal(quoteStates({ key: 'registration_date', value: '28-06-2011' }, 'registered as document number 2811 of 2011'), false, 'digits that are not that date are not that date');
    assert.equal(quoteStates({ key: 'ec_from', value: '01-04-1994' }, 'ಶೋಧನೆಯ ಅವಧಿ: ೦೧-೦೪-೧೯೯೪ ರಿಂದ'), true, 'in whichever digits the page writes it');
  });

  it('holds an area, a width and a count to a figure in the quote', () => {
    assert.equal(quoteStates({ key: 'extent_title', value: '2450', unit: 'sqm' }, 'measuring 2,450 square metres'), true);
    assert.equal(quoteStates({ key: 'extent_title', value: '2540', unit: 'sqm' }, 'measuring 2,450 square metres'), false);
    assert.equal(quoteStates({ key: 'extent_khata', value: '1 acre 22 guntas' }, 'Extent held: 1 Acre 22 Guntas'), true);
    assert.equal(quoteStates({ key: 'extent_khata', value: '1,115', unit: 'sqm' }, 'ನಿವೇಶನದ ವಿಸ್ತೀರ್ಣ: 1,115 ಚದರ ಮೀಟರ್'), true, 'a unit in another script cannot be converted, and the figure is still there');
    assert.equal(quoteStates({ key: 'extent_khata', value: '1,151', unit: 'sqm' }, 'ನಿವೇಶನದ ವಿಸ್ತೀರ್ಣ: 1,115 ಚದರ ಮೀಟರ್'), false);
    assert.equal(quoteStates({ key: 'road_width_ft', value: '60', unit: 'ft' }, 'abutting a road 30 feet wide'), false, 'the width measured wrong on 5 October: 60 for a page that prints 30');
    assert.equal(quoteStates({ key: 'road_width_ft', value: '30', unit: 'ft' }, 'abutting a road 9.14 metres wide'), true, 'the same width, as the page writes it');
    assert.equal(quoteStates({ key: 'subsisting_charges', value: '2' }, 'a mortgage dated 2-3-2019 in favour of the bank'), false, 'the 2 of a date is not a count of two');
    assert.equal(quoteStates({ key: 'ec_transactions', value: '4' }, 'Number of transactions found: 4'), true);
    assert.equal(quoteStates({ key: 'permissible_far', value: '2.25' }, 'permissible FAR of 2.25 on the plot'), true);
  });

  it('holds an amount and an identifier as before, and more strictly', () => {
    assert.equal(quoteStates({ key: 'consideration', value: '3185000' }, 'ರೂ. 3,18,50,000'), false, 'a digit short');
    assert.equal(quoteStates({ key: 'consideration', value: '31850000' }, 'ರೂ. 3,18,50,000'), true);
    assert.equal(quoteStates({ key: 'consideration', value: '31800000' }, 'for a sum of Rs. 3.18 crore only'), true, 'said in crores');
    assert.equal(quoteStates({ key: 'survey_numbers', value: '73/4' }, 'Survey No. 73/4, situated at Navilugudda Village'), true);
    assert.equal(quoteStates({ key: 'survey_numbers', value: '73/1' }, 'Survey No. 73/4, situated at Navilugudda Village'), false);
    assert.equal(quoteStates({ key: 'survey_numbers', value: '73/4' }, 'Survey No. 7/34 of the village'), false, 'the same digits cut differently are another number');
    assert.equal(quoteStates({ key: 'survey_numbers', value: '73/4' }, 'Survey No. 73/4/5 of the village'), false, 'nor is a part of 73/4 the whole of it');
    assert.equal(quoteStates({ key: 'survey_numbers', value: '9' }, 'Survey No. 9/8, Bettadakoppa'), false, 'nor 9 the same as 9/8');
    assert.equal(quoteStates({ key: 'survey_numbers', value: '73/4, 73/5, 74/1' }, 'Survey Nos. 73/5 and others listed in the schedule'), true, 'a list is held to one of its numbers');
    assert.equal(quoteStates({ key: 'khata_number', value: '1907/88/3' }, 'ಖಾತಾ ಸಂಖ್ಯೆ: ೧೯೦೭/೮೮/೩'), true);
  });

  it('asks nothing of a name, a place, or a yes or no, and holds a number under a key of the reader’s own', () => {
    assert.equal(quoteStates({ key: 'owner', value: 'Rathnamma Siddalingaiah' }, 'Name of the owner: Smt. Rathnamma Siddalingaiah'), true);
    assert.equal(quoteStates({ key: 'ec_nil', value: 'yes' }, 'no other encumbrance was found'), true);
    assert.equal(quoteStates({ key: 'agreementDate', value: '12-03-2019' }, 'this agreement dated 12th March 2019'), true);
    assert.equal(quoteStates({ key: 'agreementDate', value: '12-03-2019' }, 'this agreement dated 21st March 2019'), false);
    assert.equal(quoteStates({ key: 'plotDimensions', value: '40 ft x 60 ft' }, 'East to West 40 feet and North to South 60 feet'), true);
    assert.equal(quoteStates({ key: 'plotDimensions', value: '40 ft x 80 ft' }, 'East to West 40 feet and North to South 60 feet'), false);
  });
});

describe('a value on a page', () => {
  const khata = 'KHATA EXTRACT\nName of the owner: Smt. Rathnamma Siddalingaiah\nKhata No. 1907/88/3';

  it('needs the value’s own words there, not only most of the quote', () => {
    const quote = (surname: string) => `Name of the owner: Smt. Rathnamma ${surname}`;
    assert.equal(pageHolds(khata, quote('Siddaramaiah')), true, 'nearly every word of the quote is on the page');
    assert.equal(pageStates(khata, { key: 'owner', value: 'Rathnamma Siddaramaiah' }, quote('Siddaramaiah')), false, 'and the surname that is the value is not');
    assert.equal(pageStates(khata, { key: 'owner', value: 'Rathnamma Siddalingaiah' }, quote('Siddalingaiah')), true);
    assert.equal(pageStates(khata, { key: 'owner', value: 'Rathnamma' }, quote('Siddalingaiah')), true, 'a name the page does print, however short');
  });

  it('takes the value as the page prints it, where the page is not in English', () => {
    const page = 'ಮಾಲೀಕರ ಹೆಸರು: ಶ್ರೀಮತಿ ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ';
    assert.equal(pageStates(page, { key: 'owner', value: 'Rathnamma Siddalingaiah', originalValue: 'ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ' }, 'ಮಾಲೀಕರ ಹೆಸರು: ಶ್ರೀಮತಿ ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ'), true);
    assert.equal(pageStates(page, { key: 'owner', value: 'Rathnamma Siddaramaiah', originalValue: 'ರತ್ನಮ್ಮ ಸಿದ್ದರಾಮಯ್ಯ' }, 'ಮಾಲೀಕರ ಹೆಸರು: ಶ್ರೀಮತಿ ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ'), false);
    assert.equal(pageStates(page, { key: 'owner', value: 'Rathnamma Siddalingaiah' }, 'ಮಾಲೀಕರ ಹೆಸರು: ಶ್ರೀಮತಿ ರತ್ನಮ್ಮ ಸಿದ್ದಲಿಂಗಯ್ಯ'), false, 'a spelling in Latin letters is on no Kannada page');
  });

  it('rests a yes or no, and an exact value, on the quote', () => {
    assert.equal(pageStates('It is certified that no other encumbrance was found for the period.', { key: 'ec_nil', value: 'yes' }, 'no other encumbrance was found'), true);
    assert.equal(pageStates(khata, { key: 'khata_number', value: '1907/88/3' }, 'Khata No. 1907/88/3'), true);
  });
});

describe('two readings of one thing', () => {
  it('compares each in the form its key is kept in', () => {
    assert.equal(sameReading('ec_to', { key: 'ec_to', value: '31-03-2024' }, { key: 'ec_to', value: '31 March 2024' }), true);
    assert.equal(sameReading('ec_to', { key: 'ec_to', value: '31-01-2024' }, { key: 'ec_to', value: '31-03-2024' }), false);
    assert.equal(sameReading('consideration', { key: 'consideration', value: '31850000' }, { key: 'consideration', value: '3,18,50,000' }), true);
    assert.equal(sameReading('extent_title', { key: 'extent_title', value: '2450', unit: 'sqm' }, { key: 'extent_title', value: '2,450 square metres' }), true);
    assert.equal(sameReading('extent_title', { key: 'extent_title', value: '2450', unit: 'sqm' }, { key: 'extent_title', value: '2450', unit: 'sqft' }), false, 'the same figure in another unit is another area');
    assert.equal(sameReading('road_width_ft', { key: 'road_width_ft', value: '60', unit: 'ft' }, { key: 'road_width_ft', value: '30', unit: 'ft' }), false);
    assert.equal(sameReading('ec_nil', { key: 'ec_nil', value: 'yes' }, { key: 'ec_nil', value: 'no' }), false);
    assert.equal(sameReading('khata_type', { key: 'khata_type', value: 'A Khata' }, { key: 'khata_type', value: 'A-Khata' }), true);
  });

  it('takes an identifier part by part, and a list as the same set', () => {
    assert.equal(sameReading('survey_numbers', { key: 'survey_numbers', value: 'Survey No. 73/4' }, { key: 'survey_numbers', value: '73/4' }), true);
    assert.equal(sameReading('survey_numbers', { key: 'survey_numbers', value: '73/4' }, { key: 'survey_numbers', value: '73/1' }), false);
    assert.equal(sameReading('survey_numbers', { key: 'survey_numbers', value: '73/4' }, { key: 'survey_numbers', value: '7/34' }), false);
    assert.equal(sameReading('survey_numbers', { key: 'survey_numbers', value: '73/4, 73/5' }, { key: 'survey_numbers', value: '73/5 and 73/4' }), true);
    assert.equal(sameReading('survey_numbers', { key: 'survey_numbers', value: '73/4, 73/5' }, { key: 'survey_numbers', value: '73/4' }), false, 'one of two is not both');
    assert.equal(sameReading('pid', { key: 'pid', value: '47-212-0903' }, { key: 'pid', value: '47/212/0903' }), true);
  });

  it('takes a name as the same name, never roughly the same', () => {
    assert.equal(sameReading('owner', { key: 'owner', value: 'Smt. Rathnamma Siddalingaiah' }, { key: 'owner', value: 'Rathnamma Siddalingaiah' }), true, 'an honorific apart');
    assert.equal(sameReading('owner', { key: 'owner', value: 'Rathnamma Siddaramaiah' }, { key: 'owner', value: 'Rathnamma Siddalingaiah' }), false, 'another surname');
    assert.equal(sameReading('owner', { key: 'owner', value: 'Narasimha Murthy' }, { key: 'owner', value: 'Narasimhamurthy' }), true, 'one name spaced two ways');
    assert.equal(sameReading('owner', { key: 'owner', value: 'Ramaiah' }, { key: 'owner', value: 'K. Ramaiah Gowda' }), false, 'a part of a name is not the name');
    assert.equal(
      sameReading('owner', { key: 'owner', value: 'Siddalingayya', originalValue: 'ಸಿದ್ದಲಿಂಗಯ್ಯ' }, { key: 'owner', value: 'Siddalingaiah', originalValue: 'ಸಿದ್ದಲಿಂಗಯ್ಯ' }),
      true,
      'two spellings in Latin letters of one name as the page prints it',
    );
    assert.equal(sameReading('boundaryNorth', { key: 'boundaryNorth', value: 'a road' }, { key: 'boundaryNorth', value: 'a road' }), false, 'a key of the reader’s own is not asked, so is never agreed');
  });

  it('shows the second reader the names of what to read, and nothing anybody read', () => {
    const prompt = itemsPrompt(['survey_numbers', 'ec_to', 'khata_type']);
    assert.equal(
      prompt,
      [
        'Read these from the page:',
        `1. Survey number: ${STANDARD_FACT_KEYS.survey_numbers!.says}`,
        `2. EC searched to: ${STANDARD_FACT_KEYS.ec_to!.says}`,
        `3. Khata type: ${STANDARD_FACT_KEYS.khata_type!.says}; one of: A-Khata, B-Khata, E-Khata`,
      ].join('\n'),
    );
  });
});

describe('placing a reading’s values', () => {
  const readings: ReadingToPlace[] = [
    { key: 'khata_number', value: 'KH-7741-B/2019', quote: 'Khata No. KH-7741-B/2019 issued to Sri Ramaiah', hint: 1 },
    { key: 'consideration', value: '4500000', unit: 'INR', quote: 'Sale consideration Rs. 45,00,000 paid in full', hint: 2 },
    { key: 'boundary_north', value: 'Sy. No. 118/3', quote: 'bounded on the north by Sy. No. 118/3', hint: 1 }, // really on page 3
    { key: 'document_number', value: 'BNG-1-02345', quote: 'Document No. BNG-1-02345', hint: undefined }, // on no page, and no page named
  ];

  /** What each page of the test document states, as a second reader that reads it for itself would give it. */
  const ON_PAGE: Array<Record<string, PageReading>> = [
    { khata_number: { found: true, value: 'KH-7741-B/2019', words: 'Khata No. KH-7741-B/2019 issued to Sri Ramaiah' } },
    { consideration: { found: true, value: '45,00,000', words: 'Sale consideration Rs. 45,00,000 paid in full' } },
    { boundary_north: { found: true, value: 'Sy. No. 118/3', words: 'bounded on the north by Sy. No. 118/3' } },
  ];

  /** A second reader that reads the test document's pages for itself, recording what it was asked. */
  function reader(asked: Array<{ page: number; keys: string[] }>, pages = ON_PAGE): ReadPage {
    return async (page, keys) => {
      asked.push({ page, keys });
      return keys.map((key) => pages[page - 1]?.[key] ?? { found: false });
    };
  }

  it('places from the text when it has it, wherever the reading said, and calls no model', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const { placements, pagesChecked } = await placeReadings({ readings, pageTexts: PAGE_TEXT, readPage: reader(asked) });
    assert.deepEqual(placements.slice(0, 3), [
      { status: 'placed', page: 1, method: 'text' },
      { status: 'placed', page: 2, method: 'text' },
      { status: 'placed', page: 3, method: 'text' },
    ]);
    assert.deepEqual(placements[3], { status: 'unchecked' }, 'not in the text, and no page to look on');
    assert.equal(pagesChecked, 0);
    assert.equal(asked.length, 0);
  });

  it('does not place an exact value by words OCR read, and has the page read a second time instead', async () => {
    // Page 2 is a scan: its words here are OCR's. The amount is in them, and so is the vendor's name.
    const asked: Array<{ page: number; keys: string[] }> = [];
    const mixed: ReadingToPlace[] = [
      { key: 'consideration', value: '4500000', quote: 'Sale consideration Rs. 45,00,000 paid in full', hint: 2 },
      { key: 'vendor', value: 'Ramaiah', quote: 'Khata No. KH-7741-B/2019 issued to Sri Ramaiah', hint: 2 },
      { key: 'khata_number', value: 'KH-7741-B/2019', quote: 'Khata No. KH-7741-B/2019 issued to Sri Ramaiah', hint: 1 },
      { key: 'stamp_duty', value: '4500000', quote: 'Sale consideration Rs. 45,00,000 paid in full', hint: undefined },
    ];
    const { placements, pagesChecked } = await placeReadings({ readings: mixed, pageTexts: PAGE_TEXT, ocrPages: [2], pageCount: 3, readPage: reader(asked) });
    assert.deepEqual(placements, [
      { status: 'placed', page: 2, method: 'page' },
      { status: 'placed', page: 1, method: 'text' },
      { status: 'placed', page: 1, method: 'text' },
      { status: 'unchecked' },
    ], 'the exact one on the scanned page by a second reading; a name, and one on a page with a text layer, by the text; one with no page to look on, not at all');
    assert.equal(pagesChecked, 1);
    assert.deepEqual(asked, [{ page: 2, keys: ['consideration'] }], 'asked for the key, and handed no value and no quote');

    // With no second reader, it stays unchecked: OCR's words do not stand in for the page.
    const alone = await placeReadings({ readings: mixed.slice(0, 1), pageTexts: PAGE_TEXT, ocrPages: [2], pageCount: 3 });
    assert.deepEqual(alone.placements, [{ status: 'unchecked' }]);
  });

  it('otherwise has each named page read once, for every key said to be on it', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const { placements, pagesChecked } = await placeReadings({ readings, pageCount: 3, readPage: reader(asked) });
    assert.deepEqual(placements, [
      { status: 'placed', page: 1, method: 'page' },
      { status: 'placed', page: 2, method: 'page' },
      { status: 'refuted', page: 1 },
      { status: 'unchecked' },
    ]);
    assert.equal(pagesChecked, 2);
    assert.deepEqual(asked.map((a) => [a.page, a.keys.length]).sort(), [[1, 2], [2, 1]], 'one read per page, the busiest first');
  });

  it('refutes a value the second reader read differently, and does not take the second reader’s for it', async () => {
    // The first reader's value is a digit out, in the value and in its quote alike. A reader shown that quote would say yes to it.
    const wrong: ReadingToPlace[] = [
      { key: 'ec_to', value: '31-01-2024', quote: 'Period of search: from 01-04-1994 to 31-01-2024', hint: 1 },
      { key: 'owner', value: 'Rathnamma Siddaramaiah', quote: 'Name of the owner: Smt. Rathnamma Siddaramaiah', hint: 1 },
      { key: 'survey_numbers', value: '143/2', quote: 'ಸರ್ವೆ ನಂಬರ್ 143/2', hint: 1 },
    ];
    const page: Record<string, PageReading> = {
      ec_to: { found: true, value: '31-03-2024', words: 'to 31-03-2024' },
      owner: { found: true, value: 'Rathnamma Siddalingaiah', words: 'Name of the owner: Smt. Rathnamma Siddalingaiah' },
      survey_numbers: { found: true, value: '141/2', words: 'ಸರ್ವೆ ನಂಬರ್ 141/2' },
    };
    const { placements } = await placeReadings({ readings: wrong, pageCount: 1, readPage: reader([], [page]) });
    assert.deepEqual(placements, [{ status: 'refuted', page: 1 }, { status: 'refuted', page: 1 }, { status: 'refuted', page: 1 }]);
  });

  it('goes no further with an exact value its own quote does not state', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const split: ReadingToPlace[] = [{ key: 'ec_to', value: '31-01-2024', quote: 'Period of search: from 01-04-1994 to 31-03-2024', hint: 1 }];
    // The page's text holds the quote, and a second reader would agree with the value: neither is asked.
    const agreeing: Record<string, PageReading> = { ec_to: { found: true, value: '31-01-2024', words: 'to 31-01-2024' } };
    const { placements, pagesChecked } = await placeReadings({ readings: split, pageTexts: ['Period of search: from 01-04-1994 to 31-03-2024'], pageCount: 1, readPage: reader(asked, [agreeing]) });
    assert.deepEqual(placements, [{ status: 'unsupported' }]);
    assert.equal(pagesChecked, 0);
    assert.equal(asked.length, 0);
  });

  it('does not take a second reading that cannot show its own words', async () => {
    const one: ReadingToPlace[] = [{ key: 'ec_to', value: '31-03-2024', quote: 'to 31-03-2024', hint: 1 }];
    const unshown: Record<string, PageReading> = { ec_to: { found: true, value: '31-03-2024', words: 'the period of search ends on the date above' } };
    const { placements } = await placeReadings({ readings: one, pageCount: 1, readPage: reader([], [unshown]) });
    assert.deepEqual(placements, [{ status: 'unchecked' }], 'a value it gave with no words that state it is not a second reading');
  });

  it('places a value only on a page the first reader was sent', async () => {
    // Ten pages. The office of an earlier deed is named on page 1; only pages 9 and 10 were sent.
    const pages = ['registered in the office of the Sub-Registrar, Suvarnagiri', ...Array.from({ length: 7 }, () => 'conditions of the conveyance'), 'the schedule property', 'in witness whereof'];
    const read: ReadingToPlace[] = [{ key: 'sub_registrar', value: 'Suvarnagiri', quote: 'in the office of the Sub-Registrar, Suvarnagiri', hint: 10 }];
    const asked: Array<{ page: number; keys: string[] }> = [];
    const none = await placeReadings({ readings: read, pageTexts: pages, pageCount: 10, pagesSent: [9, 10], readPage: reader(asked, []) });
    assert.deepEqual(none.placements, [{ status: 'refuted', page: 10 }], 'not placed on page 1, which it never saw; the page it named was read a second time and does not state it');
    assert.deepEqual(asked, [{ page: 10, keys: ['sub_registrar'] }]);
    const whole = await placeReadings({ readings: read, pageTexts: pages, pageCount: 10 });
    assert.deepEqual(whole.placements, [{ status: 'placed', page: 1, method: 'text' }], 'sent whole, page 1 is where it was read');
    // And a page it names that was not sent is not read a second time on its account.
    const unsent = await placeReadings({ readings: [{ ...read[0]!, hint: 3 }], pageCount: 10, pagesSent: [9, 10], readPage: reader(asked, []) });
    assert.deepEqual(unsent.placements, [{ status: 'unchecked' }]);
  });

  it('asks the second reader only for the rules’ own keys', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const own: ReadingToPlace[] = [{ key: 'stampVendorLicence', value: 'KA-SV-2291', quote: 'Stamp vendor licence KA-SV-2291', hint: 1 }];
    const { placements } = await placeReadings({ readings: own, pageCount: 1, readPage: reader(asked) });
    assert.deepEqual(placements, [{ status: 'unchecked' }], 'there is no fixed name to ask it by');
    assert.equal(asked.length, 0);
  });

  it('leaves values unchecked, never refuted, when a page could not be read', async () => {
    const { placements } = await placeReadings({ readings: readings.slice(0, 2), pageCount: 3, readPage: async () => null });
    assert.deepEqual(placements, [{ status: 'unchecked' }, { status: 'unchecked' }]);
    const thrown = await placeReadings({ readings: readings.slice(0, 1), pageCount: 3, readPage: async () => { throw new Error('rate limited'); } });
    assert.deepEqual(thrown.placements, [{ status: 'unchecked' }]);
  });

  it('leaves a value unchecked when the reader could not make out its part of the page', async () => {
    const { placements } = await placeReadings({
      readings: readings.slice(0, 2),
      pageCount: 3,
      readPage: async (_page, keys) => keys.map(() => ({ found: false, legible: false })),
    });
    assert.deepEqual(placements, [{ status: 'unchecked' }, { status: 'unchecked' }], 'a script the reader cannot read is no evidence the value is not there');
  });

  it('leaves a value unchecked when the reader gave no answer about it', async () => {
    const { placements } = await placeReadings({ readings: readings.slice(0, 1), pageCount: 3, readPage: async () => [undefined] });
    assert.deepEqual(placements, [{ status: 'unchecked' }]);
  });

  it('spends at most its page budget, on the pages with the most values', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const { placements } = await placeReadings({ readings, pageCount: 3, readPage: reader(asked), maxPages: 1 });
    assert.deepEqual(asked.map((a) => a.page), [1], 'page 1 has two values');
    assert.deepEqual(placements[1], { status: 'unchecked' }, 'page 2 was over the budget');
  });

  it('ignores a named page the document does not have', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const { placements } = await placeReadings({ readings: [{ ...readings[1]!, hint: 9 }], pageCount: 3, readPage: reader(asked) });
    assert.deepEqual(placements, [{ status: 'unchecked' }]);
    assert.equal(asked.length, 0);
  });

  it('looks on page 1 of a one-page document even when no page was named', async () => {
    const asked: Array<{ page: number; keys: string[] }> = [];
    const { placements } = await placeReadings({ readings: [{ ...readings[0]!, hint: undefined }], pageCount: 1, readPage: reader(asked) });
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
    assert.equal(describeChecks({ placed: 3, refuted: 1, unchecked: 0 }), 'Each value was looked for on its page here: 3 of 4 found.');
    assert.equal(describeChecks({ placed: 3, refuted: 0, unchecked: 0, unsupported: 1 }), 'Each value was looked for on its page here: 3 of 4 found.', 'one its own quote does not state was not found either');
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
  /** For a second reading: which page it was shown, read off the page's width, and how many pages it had. */
  page?: number;
  pages?: number;
  /** The keys it was asked for, told from the names it was shown. */
  keys?: string[];
  /** Everything it was sent in words, to hold that none of it is what the first reader read. */
  shown?: string;
}

/** The extraction a model on a gateway returns: good values, a page for most, no citation for any. */
const EXTRACTION = {
  kind: 'title_deed',
  kindConfidence: 0.9,
  notes: '',
  fields: [
    { key: 'khata_number', label: 'Khata number', value: 'KH-7741-B/2019', unit: null, confidence: 0.92, quote: PAGE_TEXT[0], originalValue: null, page: 1 },
    { key: 'consideration', label: 'Sale consideration', value: '4500000', unit: 'INR', confidence: 0.9, quote: PAGE_TEXT[1], originalValue: null, page: 2 },
    { key: 'boundary_north', label: 'North boundary', value: 'Sy. No. 118/3', unit: null, confidence: 0.85, quote: 'bounded on the north by Sy. No. 118/3', originalValue: null, page: 1 },
    { key: 'document_number', label: 'Registration number', value: 'BNG-1-02345', unit: null, confidence: 0.8, quote: 'Document No. BNG-1-02345', originalValue: null, page: null },
  ],
};

/** What each page of the test PDF states, as a second reader that reads the page for itself gives it. */
const SECOND_READER: Array<Record<string, { value: string; words: string }>> = [
  { khata_number: { value: 'KH-7741-B/2019', words: PAGE_TEXT[0]! } },
  { consideration: { value: '45,00,000', words: PAGE_TEXT[1]! } },
  { boundary_north: { value: 'Sy. No. 118/3', words: 'bounded on the north by Sy. No. 118/3' } },
];
/** On a photographed sheet, which this stand-in cannot see, it reads what the first reader read. */
const ON_THE_SHEET = Object.fromEntries(EXTRACTION.fields.map((f) => [f.key, { value: f.value, words: f.quote! }]));
const KEY_OF_LABEL = new Map(Object.entries(STANDARD_FACT_KEYS).map(([key, known]) => [known.label, key]));

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
        if (asked.includes('lift.pdf')) {
          // A gateway does not hold a model to the list of kinds: a paper it has no name for comes back under one of the model's own.
          streamMessage(res, [{ type: 'tool_use', name: tool, input: { ...EXTRACTION, kind: 'lift_fitness_certificate', fields: EXTRACTION.fields.slice(0, 1) } }]);
          return;
        }
        // Visible text and a tool call, as a model behind a gateway answers: no citations anywhere.
        streamMessage(res, [
          { type: 'text', text: 'The khata number is KH-7741-B/2019.' },
          { type: 'tool_use', name: tool, input: EXTRACTION },
        ]);
        return;
      }
      // A second reading: one page (or one image) and the numbered names of what to read from it.
      const [part, text] = call.messages[0].content as Array<Record<string, any>>;
      const keys = String(text?.text ?? '').split('\n').slice(1).map((line) => KEY_OF_LABEL.get(line.replace(/^\d+\.\s*/, '').split(':')[0]!) ?? '');
      let page = 1;
      let pages = 1;
      let states: Record<string, { value: string; words: string }> = ON_THE_SHEET;
      if (part?.type === 'document') {
        const doc = await PDFDocument.load(Buffer.from(part.source.data, 'base64'));
        pages = doc.getPageCount();
        page = Math.round(doc.getPage(0).getWidth()) - 500;
        states = SECOND_READER[page - 1] ?? {};
      }
      seen.push({ tool, model: call.model, page, pages, keys, shown: `${JSON.stringify(call.system)} ${String(text?.text ?? '')}` });
      streamMessage(res, [{
        type: 'tool_use',
        name: tool,
        input: {
          values: keys.map((key, i) => (states[key]
            ? { n: i + 1, found: true, legible: true, value: states[key]!.value, unit: null, originalValue: null, words: states[key]!.words }
            : { n: i + 1, found: false, legible: true, value: null, unit: null, originalValue: null, words: null })),
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

  it('files the values a second reader read the same, drops the one not read on its page, and keeps the unplaced one as a reading', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('deed.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
    });
    assert.equal(result.run.status, 'succeeded', result.run.error);
    assert.ok(result.run.capabilityGaps?.includes('citations_unavailable'), 'the gateway still returned no citations, and that is still recorded');

    const byKey = new Map(result.fields.map((f) => [f.key, f]));
    assert.equal(byKey.get('khata_number')?.sourcePage, 1);
    assert.equal(byKey.get('khata_number')?.pageCheck, 'page');
    assert.equal(byKey.get('khata_number')?.confidence, 0.92, 'a checked page keeps the reading’s confidence');
    assert.equal(byKey.get('consideration')?.sourcePage, 2, 'the second reader wrote the amount as the page does, and it is the same amount');
    assert.equal(byKey.has('boundary_north'), false, 'the page it was said to be on was read a second time, and does not state it');
    assert.deepEqual((result.unconfirmed ?? []).filter((f) => f.key === 'boundary_north').map((f) => [f.namedPage, f.looked]), [[1, true]], 'it is handed back apart, as looked for and not read there');
    const unplaced = byKey.get('document_number');
    assert.ok(unplaced, 'a value nothing could check is kept as a reading');
    assert.equal(unplaced.sourcePage, undefined, 'with no page');
    assert.ok(unplaced.confidence <= 0.45, 'and at the discount of an unverified reading');

    const second = seen.filter((s) => s.tool === 'record_page_values');
    assert.deepEqual(second.map((c) => [c.page, c.pages, c.keys]).sort(), [[1, 1, ['khata_number', 'boundary_north']], [2, 1, ['consideration']]], 'each page shown alone, once, with the names of what to read');
    assert.ok(second.every((c) => c.model === 'other-vendor/checker'), 'on the model set to read a second time');
    assert.equal(seen.find((s) => s.tool === 'record_document_extraction')?.model, 'vendor/reader');
    assert.equal(result.pageCheckUsage?.length, 2, 'what the second readings cost is reported with the reading');
    // Blind: nothing the first reader read is in what the second reader was sent, in its prompt or beside the page.
    for (const call of second) {
      for (const field of EXTRACTION.fields) {
        assert.equal(call.shown!.includes(field.value), false, `the second reader was shown the first reader's ${field.key}`);
        assert.equal(call.shown!.includes(field.quote!), false, `the second reader was shown the words quoted for ${field.key}`);
      }
    }

    assert.match(result.notes, /Each value was looked for on its page here: 2 of 4 found\./);
    assert.doesNotMatch(result.notes, /self-reported/, 'not said of values that were checked');
    assert.equal(result.checksCut, undefined, 'and no second reading went unmade for want of time');
  });

  it('places from the server’s own text without a single check when it has the pages', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('deed.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
      pageTexts: PAGE_TEXT,
    });
    const pages = Object.fromEntries(result.fields.map((f) => [f.key, [f.sourcePage, f.pageCheck]]));
    assert.deepEqual(pages.khata_number, [1, 'text']);
    assert.deepEqual(pages.consideration, [2, 'text']);
    assert.deepEqual(pages.boundary_north, [3, 'text'], 'found on page 3, though the reading said page 1');
    assert.equal(seen.filter((s) => s.tool === 'record_page_values').length, 0);
    assert.equal(result.pageCheckUsage, undefined);
  });

  it('keeps a reading under a kind the catalogue does not have, as “other”, and types nothing by it', async () => {
    seen.length = 0;
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('lift.pdf', 'application/pdf'), fileBytes: await threePagePdf(), identity, now: '2026-10-02T00:00:00.000Z',
      pageTexts: PAGE_TEXT,
    });
    assert.equal(result.run.status, 'succeeded', 'a paper the catalogue has no name for is still a paper that was read');
    assert.deepEqual([result.kind, result.paper], ['other', 'other']);
    assert.deepEqual(result.fields.map((f) => [f.key, f.sourcePage]), [['khata_number', 1]], 'what it states is kept as any reading is');
  });

  it('checks a photographed sheet as page 1', async () => {
    seen.length = 0;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const result = await runDocumentIntelligence({
      caseId: 'case-1', document: document('khata.png', 'image/png'), fileBytes: png, identity, now: '2026-10-02T00:00:00.000Z',
    });
    assert.equal(result.fields.length, 4);
    assert.ok(result.fields.every((f) => f.sourcePage === 1 && f.pageCheck === 'page'), 'every value read a second time on the one sheet there is');
    assert.equal(seen.filter((s) => s.tool === 'record_page_values').length, 1, 'one look at the one sheet');
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
    assert.equal(seen.filter((s) => s.tool === 'record_page_values').length, 0);
    assert.ok(result.fields.every((f) => f.sourcePage === undefined), 'nothing was checked, so nothing has a page');
    assert.equal(result.fields.length, 4, 'and nothing was refuted either');
    assert.equal(result.checksCut, true, 'and the reading says its checks were cut for time, so the paper is one to read again');
  });
});
