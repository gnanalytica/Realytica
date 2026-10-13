/**
 * A cost report as a consultant sends it, read without being cleaned first.
 *
 * Two rehearsals on a consultant's own papers failed on the layout, not on
 * the arithmetic: fixes that passed on a table somebody had guessed at did
 * not hold on the table as it is laid out. So this file holds the layout
 * itself, on an invented report (`fixtures/documents/make_banded_report.py`):
 *
 * - a sub-total written with its section's letter and a dash before the
 *   words, a total of sub-totals in the middle of the table, a line named
 *   "Grand Total" that is before GST, and the total with GST under it called
 *   something else;
 * - a row for work not let yet whose own words are a column's ("unawarded",
 *   "Yet to be awarded"), which was dropped as a second heading row;
 * - a contingency worked on a sub-total, a row with no budget, a line of
 *   dashes, a heading with a second column that says "certify";
 * - the table as pictures, white on bands of colour, run on over two pages,
 *   with a contractor's name in a cell merged down four rows.
 *
 * What is held: the rows taken are the packages and nothing else; every line
 * not taken is listed with why; the rows are held to the table's own totals,
 * a page at a time, before any is offered; a page that is not held is not
 * offered at all; and a row taken off takes the package it made with it.
 *
 * Every name and figure is made up.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  COST_LINE_SAID,
  acceptCostOffer,
  acceptCostOffersOnPage,
  addEvidence,
  awardedToNamed,
  costAmount,
  costCheckSaid,
  costPaperPagesSaid,
  costPaperSaid,
  costPapersOf,
  costRegister,
  costReportDecisions,
  costReportOf,
  costReportTotals,
  costRowDoubts,
  createProject,
  importCostReportRows,
  landIngestFile,
  offerCostRowsFromPages,
  previewCostOffersOnPage,
  previewCostReportImport,
  readCostText,
  removeCostReportPackage,
  startCostReport,
  startTender,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';
import { readIngestLocally } from '../apps/api/src/documents/intake';
import { offerRowsOfPaper } from '../apps/api/src/documents/offers';
import { releaseOcr } from '../apps/api/src/documents/read-text';
import { costReportBandedPictures } from './fixtures/report-papers';

/** The invented table, a line to a row: packages, awarded to, budget, forecast, certified, still to certify, notes. */
const HEAD = ['Packages', 'Awarded To', 'Budget (Rs.) [P]', 'Forecast final cost of the project (Rs.) [Q]', 'Certified to 05 Nov 2026 (Rs.) [R]', 'Still to certify [S = Q-R]', 'Notes'];
const AS_SENT: string[][] = [
  ['BUDGET AGAINST FORECAST'],
  HEAD,
  ['Frame, envelope and blockwork', 'M/s. Harbourline Constructions Pvt. Ltd. (Frame & envelope only)', '9,40,10,250', '9,40,10,250', '61,02,400', '8,79,07,850', 'See note 2'],
  ['Extra items', '', '18,30,500', '37,45,900', '15,20,300', '22,25,600'],
  ['Frame - agreed changes', '', '82,15,700', '82,15,700', '70,05,111', '12,10,589'],
  ['Price adjustment for ready-mix concrete', '', '', '4,12,340', '7,205', '4,05,135'],
  ['P - Sub Total', '', '10,40,56,450', '10,63,84,190', '1,46,35,016', '9,17,49,174'],
  ['Owner supplied material'],
  ['Reinforcement supplied by the owner', 'Reinforcement by the owner - frame & envelope', '2,61,00,000', '2,61,00,000', '30,45,125', '2,30,54,875'],
  ['Q - Sub Total', '', '2,61,00,000', '2,61,00,000', '30,45,125', '2,30,54,875'],
  ['Interiors (unawarded, held against HCPL)', 'Yet to be Awarded', '7,05,20,300', '7,05,20,300', '-', '7,05,20,300'],
  ['Cladding and feature screens', 'Yet to be Awarded', '1,92,40,600', '1,92,40,600', '-', '1,92,40,600'],
  ['Building services', 'Yet to be Awarded', '6,15,08,200', '6,15,08,200', '-', '6,15,08,200'],
  ['Site works', 'Yet to be Awarded', '2,48,30,900', '2,48,30,900', '-', '2,48,30,900'],
  ['', '', '', '', '-', '-'],
  ['R - Sub Total', '', '17,61,00,000', '17,61,00,000', '-', '17,61,00,000'],
  ['S - Total - (P+Q+R)', '', '30,62,56,450', '30,85,84,190', '1,76,80,140', '29,09,04,050'],
  ['Sundries'],
  ['Sundry works', '', '6,20,000', '6,20,000', '-', '6,20,000'],
  ['Design fees', '', '71,50,000', '71,50,000', '-', '71,50,000'],
  ['Site supervision fee', '', '55,00,000', '55,00,000', '-', '55,00,000'],
  ['Signage and wayfinding', '', '4,10,000', '4,10,000', '-', '4,10,000'],
  ['T - Sub Total', '', '1,36,80,000', '1,36,80,000', '-', '1,36,80,000'],
  ['Contingency'],
  ['Add Contingency 4% on Sub Total (S+T)', '', '1,27,97,458', '1,04,69,718', '', '1,04,69,718'],
  ['U- Sub Total', '', '1,27,97,458', '1,04,69,718', '-', '1,04,69,718'],
  ['Grand Total - (S+T+U)', '', '33,27,33,908', '33,27,33,908', '1,76,80,140', '31,50,53,768'],
  ['GST (@18%)', '', '5,98,92,103', '5,98,92,103', '31,82,425', '5,67,09,678'],
  ['Project outlay', '', '39,26,26,011', '39,26,26,011', '2,08,62,565', '37,17,63,446'],
];
const pasted = (rows: string[][] = AS_SENT): string => rows.map((cells) => cells.join('\t')).join('\n');

/** The fourteen packages, in the table's order, with what the table states of each. */
const PACKAGES: Array<[name: string, budget: number | undefined, forecast: number, certified: number | undefined]> = [
  ['Frame, envelope and blockwork', 9_40_10_250, 9_40_10_250, 61_02_400],
  ['Extra items', 18_30_500, 37_45_900, 15_20_300],
  ['Frame - agreed changes', 82_15_700, 82_15_700, 70_05_111],
  ['Price adjustment for ready-mix concrete', undefined, 4_12_340, 7_205],
  ['Reinforcement supplied by the owner', 2_61_00_000, 2_61_00_000, 30_45_125],
  ['Interiors (unawarded, held against HCPL)', 7_05_20_300, 7_05_20_300, undefined],
  ['Cladding and feature screens', 1_92_40_600, 1_92_40_600, undefined],
  ['Building services', 6_15_08_200, 6_15_08_200, undefined],
  ['Site works', 2_48_30_900, 2_48_30_900, undefined],
  ['Sundry works', 6_20_000, 6_20_000, undefined],
  ['Design fees', 71_50_000, 71_50_000, undefined],
  ['Site supervision fee', 55_00_000, 55_00_000, undefined],
  ['Signage and wayfinding', 4_10_000, 4_10_000, undefined],
  ['Add Contingency 4% on Sub Total (S+T)', 1_27_97_458, 1_04_69_718, undefined],
];
const TOTAL = { budget: 33_27_33_908, forecast: 33_27_33_908, certified: 1_76_80_140 };

function project(): DdProject {
  return createProject({ name: 'Harbour Court', type: 'residential', location: 'Quay Road', city: 'Kadamba', currentStage: 'construction' }, 'RYT-CS1', 'tester');
}

function paperOn(p: DdProject): string {
  const row = addEvidence(p, { title: 'Cost report, October 2026', kind: 'document', status: 'received' }, 'tester');
  row.documentType = 'Cost report';
  return row.id;
}

describe('the table pasted as the consultant lays it out', () => {
  const read = readCostText(pasted());

  it('takes the fourteen packages and nothing else, each figure in its own column', () => {
    assert.deepEqual(read.rows.map((row) => [row.name, row.budget, row.anticipated, row.certified]), PACKAGES);
    assert.deepEqual(read.columns, ['name', 'awardedTo', 'budget', 'anticipated', 'certified'], 'a second heading that says "certify" is no second Certified column, and the notes are no column');
    assert.equal(read.rows.some((row) => row.doubts?.length || row.problems?.length || row.unplaced), false);
  });

  it('never takes a lettered sub-total, a total of sub-totals, the total before GST, GST or the total with GST as a package', () => {
    const kinds = read.lines.map((line) => [line.label, line.as]);
    assert.deepEqual(kinds, [
      ['BUDGET AGAINST FORECAST', 'title'],
      ['P - Sub Total', 'sub_total'],
      ['Owner supplied material', 'heading'],
      ['Q - Sub Total', 'sub_total'],
      ['- -', 'empty'],
      ['R - Sub Total', 'sub_total'],
      ['S - Total - (P+Q+R)', 'total'],
      ['Sundries', 'heading'],
      ['T - Sub Total', 'sub_total'],
      ['Contingency', 'heading'],
      ['U- Sub Total', 'sub_total'],
      // Named "Grand Total", and above the GST line: the total before GST.
      ['Grand Total - (S+T+U)', 'total'],
      ['GST (@18%)', 'gst'],
      // Named for no total at all, and under the GST line with the two added together: the total with GST.
      ['Project outlay', 'grand_total'],
    ]);
    // Every line of the table is a row taken or a line said: none is dropped without a word.
    assert.equal(read.rows.length + read.lines.length, AS_SENT.length - 1, 'all but the row that names the columns');
    for (const line of read.lines) assert.ok(COST_LINE_SAID[line.as], `${line.label} has its reason`);
  });

  it('keeps a row for work not let yet, though its words are a column’s, and names nobody as who it was awarded to', () => {
    const interiors = read.rows.find((row) => row.name.startsWith('Interiors'))!;
    assert.deepEqual([interiors.budget, interiors.awardedTo], [7_05_20_300, undefined]);
    assert.deepEqual(read.rows.filter((row) => row.awardedTo).map((row) => row.name), ['Frame, envelope and blockwork', 'Reinforcement supplied by the owner']);
    for (const said of ['Yet to be Awarded', 'Unawarded', 'Not yet awarded', 'To be awarded', 'TBA', '-']) assert.equal(awardedToNamed(said), '', said);
    assert.equal(awardedToNamed('Harbourline Constructions'), 'Harbourline Constructions');
    // A contingency worked on a sub-total is a row, not a sub-total.
    assert.equal(read.rows.at(-1)!.kind, 'contingency');
  });

  it('ties the rows to the total before GST, section by section, and says the rupee that rounding leaves', () => {
    assert.deepEqual([read.stated.total?.budget, read.stated.gst?.budget, read.stated.gst?.ratePct, read.stated.grandTotal?.budget], [TOTAL.budget, 5_98_92_103, 18, 39_26_26_011]);
    assert.deepEqual(
      read.sections.map((section) => [section.label, section.as, section.rows, section.holds]),
      [
        ['P - Sub Total', 'sub_total', 4, true],
        ['Q - Sub Total', 'sub_total', 1, true],
        ['R - Sub Total', 'sub_total', 4, true],
        ['S - Total - (P+Q+R)', 'total', 9, true],
        ['T - Sub Total', 'sub_total', 4, true],
        ['U- Sub Total', 'sub_total', 1, true],
        ['Grand Total - (S+T+U)', 'total', 14, true],
      ],
    );
    assert.deepEqual(read.checks.map((check) => [check.column, check.stated, check.difference]), [['budget', TOTAL.budget, 0], ['certified', TOTAL.certified, 1], ['anticipated', TOTAL.forecast, 0]]);
    assert.deepEqual([read.tie.holds, read.tie.by, read.tie.rounding], [true, 'total', 1]);
    assert.equal(read.tie.said, 'The rows add up to “Grand Total - (S+T+U)”, to within ₹1 of rounding.');
    assert.equal(costCheckSaid(read, 'INR'), '', 'a rupee of rounding is not said to be a mismatch');
  });

  it('says a figure further out than rounding, against the sub-total it breaks', () => {
    const off = readCostText(pasted(AS_SENT.map((cells) => (cells[0] === 'Building services' ? ['Building services', 'Yet to be Awarded', '6,15,08,20', '6,15,08,200', '-', ''] : cells))));
    assert.equal(off.tie.holds, false);
    assert.match(off.tie.said, /^The rows above “R - Sub Total” do not add up to it: Budget 5,53,57,380 under\.$/);
  });

  it('shows what importing it would write, and the ledger’s totals before and after', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-10-01', seedPackages: false }, 'tester');
    const preview = previewCostReportImport(p, report.id, pasted());
    assert.deepEqual([preview.rows.length, preview.adds, preview.updates, preview.notTaken.length], [14, 14, 0, 0]);
    assert.deepEqual([preview.totals.before.rows, preview.totals.before.budget, preview.totals.after.rows, preview.totals.after.budget, preview.totals.after.anticipatedCost], [0, 0, 14, TOTAL.budget, TOTAL.forecast]);
    assert.equal(costReportOf(p, report.id).rows.length, 0, 'and writes nothing');
  });
});

describe('an amount typed with its unit', () => {
  it('is read in crore and lakh, and what is not an amount is refused, never taken as nought', () => {
    assert.equal(costAmount('1.6 Cr'), 1_60_00_000);
    assert.equal(costAmount('12 lakh'), 12_00_000);
    assert.equal(costAmount('₹ 4,50,000'), 4_50_000);
    assert.equal(costAmount('about two crore'), null, 'refused: the box says why');
    assert.equal(costAmount(''), undefined, 'nothing typed is no amount');
  });
});

describe('a line that is no row of the ledger', () => {
  it('is known by a name with figures in it, or one too long to be a package’s', () => {
    assert.deepEqual(costRowDoubts({ name: 'Building services' }), []);
    assert.equal(costRowDoubts({ name: 'Building services 6,15,08,200 6,15,08,200 - 6,15,08,200' }).length, 1);
    assert.equal(costRowDoubts({ name: '1,92,40,600' }).length, 2);
    assert.equal(costRowDoubts({ name: 'The cost of the items below has been taken out of the contingency this month and is set against the frame package as agreed at the review' }).length, 1);
  });
});

describe('the table as pictures, dropped as the report is sent', () => {
  const realFetch = globalThis.fetch;
  let paper: ChatIngestFile;
  before(async () => {
    globalThis.fetch = (() => {
      throw new Error('Reading a report reached for the network.');
    }) as typeof fetch;
    const bytes = await costReportBandedPictures();
    paper = await readIngestLocally({ fileName: 'Harbour Court CR-07 Oct 2026.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'key-banded' }, Buffer.from(bytes));
  });
  after(async () => {
    globalThis.fetch = realFetch;
    await releaseOcr();
  });

  function dropped(): { p: DdProject; evidenceId: string; reportId: string } {
    const p = project();
    const evidenceId = landIngestFile(p, paper, 'tester')!;
    offerRowsOfPaper(p, evidenceId, paper, { modelSetUp: false });
    return { p, evidenceId, reportId: startCostReport(p, { month: '2026-10-01', seedPackages: false }, 'tester').id };
  }

  it('offers the fourteen packages, each figure right and in its own column, with no model', () => {
    const { p, evidenceId } = dropped();
    const held = costPapersOf(p).find((other) => other.evidenceId === evidenceId)!;
    assert.deepEqual(
      held.offers.map((offer) => [offer.cells.name, offer.cells.budget, offer.cells.anticipatedCost, offer.cells.certified]),
      PACKAGES,
      'the bundled OCR, with the shaded rows turned to dark on white and the picture read at twice its size',
    );
    assert.equal(held.offers.some((offer) => offer.cells.poIssued !== undefined || offer.cells.amountPaid !== undefined), false, 'nothing is put under a column the table does not have');
    assert.deepEqual(held.offers.map((offer) => offer.page), [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    assert.deepEqual(held.declined, []);
  });

  it('holds each page to its own totals before offering it: the first to its total, the second to the total it carries on from', () => {
    const { p, evidenceId } = dropped();
    const held = costPapersOf(p).find((other) => other.evidenceId === evidenceId)!;
    assert.deepEqual(held.pages.map((page) => [page.page, page.tie?.holds, page.tie?.by]), [[2, true, 'total'], [3, true, 'carried_total']]);
    assert.match(held.pages[1]!.tie!.said, /^With the total carried from the page before, the rows add up to “Grand Total/);
    assert.deepEqual(costPaperPagesSaid(held), ['Pages 2 and 3: 14 rows, held to the pages’ own totals.']);
    assert.equal(costPaperSaid(held, false), '');
  });

  it('gives a name in a cell merged down four rows to none of them, and names nobody for work not let', () => {
    const { p, evidenceId } = dropped();
    const offers = costPapersOf(p).find((other) => other.evidenceId === evidenceId)!.offers;
    assert.deepEqual(offers.slice(0, 4).map((offer) => offer.cells.awardedTo), [undefined, undefined, undefined, undefined], 'half a name is never set against a row');
    assert.deepEqual(offers.slice(5, 9).map((offer) => offer.cells.awardedTo), [undefined, undefined, undefined, undefined]);
  });

  it('accepts a page’s rows together only after showing what will be written, and the ledger then reads as the report does', () => {
    const { p, evidenceId, reportId } = dropped();
    const shown = previewCostOffersOnPage(p, evidenceId, 2, reportId);
    assert.deepEqual([shown.rows.length, shown.left, shown.holds, shown.totals.before.budget, shown.totals.after.budget, shown.totals.after.rows], [9, 0, true, 0, 30_62_56_450, 9]);
    assert.equal(costReportOf(p, reportId).rows.length, 0, 'looking writes nothing');
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 2, reportId, 'lead'), { accepted: 9, left: 0 });
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 3, reportId, 'lead'), { accepted: 5, left: 0 });
    const totals = costReportTotals(costReportOf(p, reportId));
    assert.deepEqual([totals.budget, totals.anticipatedCost], [TOTAL.budget, TOTAL.forecast]);
    // Work not let is "not awarded"; nothing here names a party with no PO.
    assert.deepEqual(costReportDecisions(costReportOf(p, reportId)).awardedNoPo, []);
  });

  it('takes the package a row made off with the row, where nothing else uses it', () => {
    const { p, evidenceId, reportId } = dropped();
    acceptCostOffersOnPage(p, evidenceId, 2, reportId, 'lead');
    assert.equal(costRegister(p).workPackages.length, 9);
    const report = costReportOf(p, reportId);
    // A tender is started on one: that package is used, and stays.
    const kept = report.rows.find((row) => row.name === 'Building services')!;
    startTender(p, { workPackageId: kept.workPackageId }, 'lead');
    for (const row of [...report.rows]) removeCostReportPackage(p, reportId, row.id, 'lead');
    assert.deepEqual(costRegister(p).workPackages.map((pack) => pack.name), ['Building services'], 'no name is left behind in the tenders’ picker but the one a tender is on');
  });
});

describe('a page whose rows its own totals do not hold', () => {
  const page = (rows: string[][]): string => rows.map((cells) => cells.filter(Boolean).join(' ')).join('\n');
  const SHORT_HEAD = ['Packages', 'Budget', 'Anticipated final cost'];
  const first = [SHORT_HEAD, ['Earthworks', '40,00,000', '42,00,000'], ['Piling', '1,10,00,000', '1,10,00,000'], ['Frame', '6,50,00,000', '6,61,00,000'], ['P - Sub Total', '8,00,00,000', '8,13,00,000'], ['Total - (P)', '8,00,00,000', '8,13,00,000']];

  it('is not offered at all where it is a picture, and is said to be one in a plain line', () => {
    const p = project();
    const evidenceId = paperOn(p);
    // The picture read with a figure's last digits lost: the rows no longer come to the sub-total.
    const misread = first.map((cells) => (cells[0] === 'Piling' ? ['Piling', '1,10,00,0', '1,10,00,000'] : cells));
    const held = offerCostRowsFromPages(p, evidenceId, [{ page: 2, text: page(misread), reader: 'ocr' }], 2);
    assert.equal(held.offers.length, 0, 'not one row of a page that does not hold is offered');
    assert.deepEqual(held.declined?.map((line) => [line.page, line.why]), [[2, 'not_tied']]);
    assert.match(held.declined![0]!.said, /^Page 2: its table is a picture the reader here could not read reliably \(The rows above “P - Sub Total” do not add up to it: Budget .* under\)\. Paste the table below, with the page open beside it\.$/);
    assert.deepEqual(held.pictures, [1, 2]);
    assert.equal(costPaperSaid(held, false), 'The tables in this report are pictures, and the reader here could not read them reliably: no row is offered. Paste the table below, with the PDF open beside it.');
  });

  it('is not offered where a picture states no total and most of its lines could not be set in their columns', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const loose = ['Packages Budget Anticipated final cost', 'Earthworks 40,00,000', 'Piling 1,10,00,000', 'Frame 6,50,00,000 6,61,00,000', 'Lifts 90,00,000'].join('\n');
    const held = offerCostRowsFromPages(p, evidenceId, [{ page: 1, text: loose, reader: 'ocr' }], 1);
    assert.deepEqual([held.offers.length, held.declined?.[0]?.why], [0, 'poorly_read']);
  });

  it('keeps "all of a page" from a page of type whose rows do not add up, which are then taken one at a time', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const report = startCostReport(p, { month: '2026-10-01', seedPackages: false }, 'tester');
    const off = first.map((cells) => (cells[0] === 'Piling' ? ['Piling', '1,10,00,900', '1,10,00,000'] : cells));
    const held = offerCostRowsFromPages(p, evidenceId, [{ page: 1, text: page(off), reader: 'text' }], 1);
    assert.equal(held.offers.length, 3, 'a page of type is offered, with what its total says of it');
    assert.equal(held.pages[0]!.tie?.holds, false);
    assert.deepEqual(previewCostOffersOnPage(p, evidenceId, 1, report.id).rows, []);
    assert.throws(() => acceptCostOffersOnPage(p, evidenceId, 1, report.id, 'lead'), /do not add up to the total it states/);
    acceptCostOffer(p, evidenceId, held.offers[0]!.id, report.id, 'lead');
    assert.equal(costReportOf(p, report.id).rows.length, 1);
  });

  it('offers nothing twice: a page that states a page’s rows again, and one that breaks its total down under other names', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const again = first;
    const breakdown = [SHORT_HEAD, ['Bulk excavation', '25,00,000', '26,00,000'], ['Disposal', '15,00,000', '16,00,000'], ['Bored piles', '1,10,00,000', '1,10,00,000'], ['Columns and slabs', '6,50,00,000', '6,61,00,000'], ['Total', '8,00,00,000', '8,13,00,000']];
    const held = offerCostRowsFromPages(
      p,
      evidenceId,
      [
        { page: 1, text: page(first), reader: 'text' },
        { page: 2, text: page(again), reader: 'text' },
        { page: 3, text: page(breakdown), reader: 'text' },
      ],
      3,
    );
    assert.deepEqual(held.offers.map((offer) => [offer.page, offer.cells.name]), [[1, 'Earthworks'], [1, 'Piling'], [1, 'Frame']]);
    assert.deepEqual(held.declined?.map((line) => [line.page, line.why, line.of]), [[2, 'repeats', 1], [3, 'breakdown', 1]]);
    assert.deepEqual(costPaperPagesSaid(held), [
      'Page 1: 3 rows, held to the page’s own totals.',
      'Page 2 states again the rows of page 1, with the same figures: nothing new is offered from it.',
      'Page 3 breaks down a total that page 1 already states, under other names: its rows are not offered, so nothing is counted twice. Type from it if the ledger is kept at that level.',
    ]);
  });
});

describe('a package awarded to a party with no PO value typed', () => {
  it('is said to be awarded, with the PO value not entered: never "not awarded"', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-10-01', seedPackages: false }, 'tester');
    const preview = previewCostReportImport(p, report.id, pasted());
    assert.equal(preview.rows.length, 14);
    importCostReportRows(p, report.id, preview.rows, 'tester', preview.read);
    const asks = costReportDecisions(costReportOf(p, report.id));
    assert.deepEqual(asks.awardedNoPo.map((pack) => pack.name), ['Frame, envelope and blockwork', 'Reinforcement supplied by the owner']);
    assert.equal(asks.unawarded.some((pack) => pack.name === 'Frame, envelope and blockwork'), false);
    assert.deepEqual(asks.unawarded.map((pack) => pack.name), ['Extra items', 'Frame - agreed changes', 'Price adjustment for ready-mix concrete', 'Interiors (unawarded, held against HCPL)', 'Cladding and feature screens', 'Building services', 'Site works', 'Sundry works', 'Signage and wayfinding']);
  });
});
