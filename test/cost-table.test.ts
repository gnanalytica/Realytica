/**
 * A cost table as a cost consultant lays it out, read into the Cost Report.
 *
 * The table every case here reads is invented (test/fixtures/cost-report.ts):
 * eleven packages under three section headings, a sub-total under each
 * section, a contingency and the consultant's fee, a total, GST and a grand
 * total. Pasted as it stands, the old import took all twenty lines as
 * packages and the budget came out several times the report's own total,
 * with nothing said. These cases hold what is true now: a total is never a
 * package, the rows are held to the table's own total to the rupee, nothing
 * is written before a person confirms, and the ledger keeps what such a
 * report states.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptCostOffer,
  acceptCostOffersOnPage,
  addEvidence,
  compareCostReports,
  costAmount,
  costCheckSaid,
  costPaperSaid,
  costReportBottomLine,
  costReportDecisions,
  costReportOf,
  costReportTotals,
  createProject,
  figureOnPage,
  importCostReportRows,
  issueCostReport,
  offerCostRowsFromModel,
  offerCostRowsFromPages,
  parseCostReportTable,
  previewCostReportImport,
  readCostPage,
  readCostSheet,
  readCostText,
  setAsideCostOffer,
  startCostReport,
  SQM_PER_SQFT,
  type DdProject,
} from '@realytica/shared';
import { COST_BUILT_UP_SQFT, COST_GRAND_TOTAL, COST_GST, COST_HEADINGS, COST_LINES, COST_PACKAGES, COST_TOTAL, costTableAsPageText, costTablePasted } from './fixtures/cost-report';

function project(): DdProject {
  return createProject({ name: 'Lakeview Residences', type: 'residential', location: 'Kere Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-CT1', 'tester');
}

function paperOn(p: DdProject): string {
  const row = addEvidence(p, { title: 'Cost report, August 2026', kind: 'document', status: 'received' }, 'tester');
  row.documentType = 'Cost report';
  return row.id;
}

describe('an amount as a table writes it', () => {
  it('reads Indian grouping, a currency mark, lakh and crore, and a bracketed negative', () => {
    assert.equal(costAmount('12,50,00,000'), 12_50_00_000);
    assert.equal(costAmount('₹ 4.2 Cr'), 4_20_00_000);
    assert.equal(costAmount('Rs. 45 lakh'), 45_00_000);
    assert.equal(costAmount('(12,000)'), -12_000);
    assert.equal(costAmount('82,40,000/-'), 82_40_000);
  });

  it('takes a dash and a blank as no amount, and words as not an amount', () => {
    for (const none of ['', '  ', '-', '–', '—', 'nil', 'N/A']) assert.equal(costAmount(none), undefined, JSON.stringify(none));
    assert.equal(costAmount('Ridgeline Earthmovers'), null);
    assert.equal(costAmount('18%'), null);
  });
});

describe('a pasted table with sub-totals and GST', () => {
  const read = readCostText(costTablePasted());

  it('takes the eleven packages and no total, sub-total, GST line or heading as one', () => {
    assert.equal(read.header, 'found');
    assert.deepEqual(read.rows.map((row) => row.name), COST_PACKAGES.map((pack) => pack.name));
    for (const pack of COST_PACKAGES) {
      const row = read.rows.find((held) => held.name === pack.name)!;
      assert.deepEqual(
        { budget: row.budget, awarded: row.awarded, awardedTo: row.awardedTo, anticipated: row.anticipated, certified: row.certified },
        { budget: pack.budget, awarded: pack.awarded, awardedTo: pack.awardedTo, anticipated: pack.anticipated, certified: pack.certified },
        pack.name,
      );
    }
  });

  it('says what each line it did not take is', () => {
    assert.deepEqual(
      read.lines.map((line) => [line.label, line.as]),
      [
        ['CIVIL AND STRUCTURE', 'heading'],
        ['SUB-TOTAL A', 'sub_total'],
        ['FINISHES', 'heading'],
        ['SUB-TOTAL B', 'sub_total'],
        ['SERVICES', 'heading'],
        ['SUB-TOTAL C', 'sub_total'],
        ['TOTAL', 'total'],
        ['GST @ 18%', 'gst'],
        ['GRAND TOTAL', 'grand_total'],
      ],
    );
    assert.equal(read.stated.gst?.ratePct, 18);
    assert.deepEqual([read.stated.total?.budget, read.stated.gst?.budget, read.stated.grandTotal?.budget], [COST_TOTAL.budget, COST_GST.budget, COST_GRAND_TOTAL.budget]);
  });

  it('holds the rows to the table’s own total, to the rupee', () => {
    assert.equal(read.addsUp, true);
    assert.deepEqual(
      read.checks.map((check) => [check.column, check.taken, check.stated, check.difference]),
      [
        ['budget', COST_TOTAL.budget, COST_TOTAL.budget, 0],
        ['awarded', COST_TOTAL.awarded, COST_TOTAL.awarded, 0],
        ['certified', COST_TOTAL.certified, COST_TOTAL.certified, 0],
        ['anticipated', COST_TOTAL.anticipated, COST_TOTAL.anticipated, 0],
      ],
    );
  });

  it('marks the contingency and the consultant’s fee as what they are', () => {
    assert.deepEqual(read.rows.filter((row) => row.kind).map((row) => [row.name, row.kind]), [['Design contingency', 'contingency'], ['Project management consultancy fee', 'fee']]);
  });

  it('says a mismatch, with the difference, where a row is a rupee out', () => {
    const lines = COST_LINES.map((cells) => (cells[1] === 'Painting' ? [...cells.slice(0, 2), '95,00,001', ...cells.slice(3)] : cells));
    const off = readCostSheet([COST_HEADINGS, ...lines]);
    assert.equal(off.addsUp, false);
    assert.deepEqual(off.checks.find((check) => check.column === 'budget'), { column: 'budget', taken: COST_TOTAL.budget + 1, stated: COST_TOTAL.budget, difference: 1 });
    assert.equal(costCheckSaid(off, 'INR'), 'Budget: the rows come to ₹29,85,00,001 and the table’s total is ₹29,85,00,000, ₹1 over.');
  });

  it('works out the total before GST where the table states only a grand total and its GST', () => {
    const grid = [COST_HEADINGS, ...COST_LINES.filter((cells) => cells[1] !== 'TOTAL')];
    const noTotal = readCostSheet(grid);
    assert.equal(noTotal.addsUp, true);
    assert.equal(noTotal.checks.find((check) => check.column === 'budget')?.stated, COST_TOTAL.budget);
    // Awarded and certified have no grand total to be held to.
    assert.deepEqual(noTotal.checks.map((check) => check.column), ['budget', 'anticipated']);
  });

  it('says a table that states no total has none to be held to', () => {
    const none = readCostText('Packages\tBudget\tAnticipated final cost\nEarthwork\t85,00,000\t82,40,000\nLifts\t1,20,00,000\t1,16,00,000');
    assert.equal(none.addsUp, null);
    assert.deepEqual(none.checks, []);
  });
});

describe('a table with no heading row', () => {
  it('is read in the usual order of such a table, and says the columns were assumed', () => {
    const read = readCostText(costTablePasted(false));
    assert.equal(read.header, 'assumed');
    assert.deepEqual(read.columns, ['code', 'name', 'budget', 'awarded', 'awardedTo', 'anticipated', 'certified', 'perArea']);
    assert.deepEqual(read.rows.map((row) => row.name), COST_PACKAGES.map((pack) => pack.name));
    assert.equal(read.addsUp, true);
    assert.equal(read.rows.find((row) => row.name === 'RCC structure')?.awardedTo, 'Northgate Constructions');
  });
});

describe('the headings a consultant uses', () => {
  it('knows Packages, Description, Awarded value, Awarded to, Certified to date and Cost per sq ft', () => {
    const read = readCostText(
      ['Packages,Description,Budget,Awarded value,Awarded to,Certified to date,Anticipated final cost,Cost per sq ft', 'PKG-01,Earthwork and excavation,"85,00,000","82,40,000",Ridgeline Earthmovers,"82,40,000","82,40,000",69', 'PKG-02,Painting,"95,00,000",-,-,-,"95,00,000",79'].join('\n'),
    );
    assert.deepEqual(read.columns, ['name', 'description', 'budget', 'awarded', 'awardedTo', 'certified', 'anticipated', 'perArea']);
    assert.deepEqual(read.rows.map((row) => [row.name, row.budget, row.awarded, row.awardedTo, row.certified, row.anticipated]), [
      ['PKG-01', 85_00_000, 82_40_000, 'Ridgeline Earthmovers', 82_40_000, 82_40_000],
      ['PKG-02', 95_00_000, undefined, undefined, undefined, 95_00_000],
    ]);
  });

  it('takes a name under “Awarded value / Awarded to” as who it was awarded to, and says of any other words that they are not an amount', () => {
    const read = readCostText('Package\tBudget\tAwarded value / Awarded to\tAnticipated\nLifts\t1,20,00,000\tSummit Elevators\t1,16,00,000\nPainting\ttbd soon\t-\t95,00,000');
    assert.equal(read.rows[0]!.awardedTo, 'Summit Elevators');
    assert.equal(read.rows[0]!.awarded, undefined);
    assert.deepEqual(read.rows[1]!.problems, ['“tbd soon” under Budget is not an amount.']);
    assert.equal(read.rows[1]!.budget, undefined);
  });

  it('still reads the old plain sheet', () => {
    const rows = parseCostReportTable('Package,Budget,PO issued,Paid,Anticipated\nCivil,100,80,40,110\nMEP,50,50,10,45');
    assert.deepEqual(rows, [
      { name: 'Civil', budget: 100, poIssued: 80, amountPaid: 40, anticipatedCost: 110 },
      { name: 'MEP', budget: 50, poIssued: 50, amountPaid: 10, anticipatedCost: 45 },
    ]);
  });

  it('refuses, in a sentence, what is no table', () => {
    assert.throws(() => readCostText(''), /has no rows/);
    assert.throws(() => readCostText('Budget,Anticipated\n100,110'), /needs a column for the package/);
    assert.throws(() => readCostText('just some words\nand more words'), /No figures were found/);
  });
});

describe('the import is previewed, and writes nothing until it is confirmed', () => {
  it('says what it would do and leaves the report as it was', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const before = JSON.stringify(p);
    const preview = previewCostReportImport(p, report.id, costTablePasted());
    assert.equal(JSON.stringify(p), before, 'a preview changes nothing');
    assert.deepEqual([preview.adds, preview.updates, preview.read.lines.length, preview.read.addsUp], [11, 0, 9, true]);
    assert.equal(preview.rows.every((row) => row.on === 'add'), true);
  });

  it('once confirmed, the budget is the report’s own total and never several times it', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const preview = previewCostReportImport(p, report.id, costTablePasted());
    importCostReportRows(p, report.id, preview.rows, 'tester', preview.read);
    const totals = costReportTotals(costReportOf(p, report.id));
    assert.deepEqual(
      { budget: totals.budget, poIssued: totals.poIssued, anticipatedCost: totals.anticipatedCost, certified: totals.certified, amountPaid: totals.amountPaid },
      { budget: COST_TOTAL.budget, poIssued: COST_TOTAL.awarded, anticipatedCost: COST_TOTAL.anticipated, certified: COST_TOTAL.certified, amountPaid: 0 },
    );
    // A second paste of the same table updates the rows it made, and adds none.
    const again = previewCostReportImport(p, report.id, costTablePasted());
    assert.deepEqual([again.adds, again.updates], [0, 11]);
  });

  it('writes on the trail that a table was imported though its rows did not add up', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const preview = previewCostReportImport(p, report.id, 'Package\tBudget\nCivil\t100\nMEP\t50\nTOTAL\t160');
    assert.equal(preview.read.addsUp, false);
    importCostReportRows(p, report.id, preview.rows, 'tester', preview.read);
    const said = p.audit.find((event) => event.action === 'import_cost_report_rows')?.newValue ?? '';
    assert.match(said, /2 added, 0 updated\. Imported though the rows do not add up to the table’s total\. Budget: the rows come to ₹150 and the table’s total is ₹160, ₹10 under\./);
  });
});

describe('the ledger holds what a cost report holds', () => {
  function imported(): { p: DdProject; reportId: string } {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const preview = previewCostReportImport(p, report.id, costTablePasted());
    importCostReportRows(p, report.id, preview.rows, 'tester', preview.read);
    return { p, reportId: report.id };
  }

  it('keeps certified to date beside paid, and who each package was awarded to', () => {
    const { p, reportId } = imported();
    const rcc = costReportOf(p, reportId).rows.find((row) => row.name === 'RCC structure')!;
    assert.deepEqual({ certified: rcc.certified, amountPaid: rcc.amountPaid, awardedTo: rcc.awardedTo, poIssued: rcc.poIssued }, { certified: 6_04_25_000, amountPaid: 0, awardedTo: 'Northgate Constructions', poIssued: 12_18_60_000 });
    const painting = costReportOf(p, reportId).rows.find((row) => row.name === 'Painting')!;
    assert.equal('certified' in painting, false, 'a dash is no figure, not a zero');
  });

  it('does not list the contingency or the consultant’s fee as packages to be awarded', () => {
    const { p, reportId } = imported();
    const report = costReportOf(p, reportId);
    assert.equal(report.rows.find((row) => row.name === 'Design contingency')?.kind, 'contingency');
    assert.deepEqual(costReportDecisions(report).unawarded.map((pack) => pack.name), ['Masonry and plastering', 'Flooring and tiling', 'Painting', 'Plumbing and fire fighting']);
  });

  it('works out GST from the rule row and the totals before and after it, to the rupee of the report', () => {
    const { p, reportId } = imported();
    const line = costReportBottomLine(p, costReportOf(p, reportId));
    assert.deepEqual(line.beforeGst, { budget: COST_TOTAL.budget, anticipatedCost: COST_TOTAL.anticipated, certified: COST_TOTAL.certified });
    assert.equal(line.gst?.ratePct, 18);
    assert.deepEqual([line.gst?.budget, line.gst?.anticipatedCost], [COST_GST.budget, COST_GST.anticipated]);
    assert.deepEqual(line.afterGst, { budget: COST_GRAND_TOTAL.budget, anticipatedCost: COST_GRAND_TOTAL.anticipated });
    assert.equal(line.gst?.rule.key, 'gst_works_contract');
    assert.equal(line.gst?.rule.verified, false, 'the rate is a rule row nobody has verified, and is said to be');
    assert.equal(line.perArea, undefined, 'no built-up area on file, so no cost for each square foot');
  });

  it('works out the cost for each square foot where the built-up area is on file', () => {
    const { p, reportId } = imported();
    p.builtUpAreaSqm = COST_BUILT_UP_SQFT * SQM_PER_SQFT;
    const line = costReportBottomLine(p, costReportOf(p, reportId));
    assert.equal(line.perArea?.areaSqft, COST_BUILT_UP_SQFT);
    // The report's own figures: 29,85,00,000 and 29,75,00,000 over 1,20,000 sq ft.
    assert.deepEqual([line.perArea?.budgetPerSqft, line.perArea?.anticipatedPerSqft], [2487.5, 2479.17]);
  });

  it('carries the new figures into next month’s report, and compares them between months', () => {
    const { p, reportId } = imported();
    issueCostReport(p, reportId, 'tester');
    const september = startCostReport(p, { month: '2026-09-01' }, 'tester');
    const rcc = september.rows.find((row) => row.name === 'RCC structure')!;
    assert.deepEqual({ certified: rcc.certified, awardedTo: rcc.awardedTo }, { certified: 6_04_25_000, awardedTo: 'Northgate Constructions' });
    assert.equal(september.rows.find((row) => row.name === 'Design contingency')?.kind, 'contingency');
    rcc.certified = 7_10_00_000;
    const compared = compareCostReports(costReportOf(p, reportId), september);
    assert.deepEqual(compared.packages.find((pack) => pack.name === 'RCC structure')?.certified, { previous: 6_04_25_000, current: 7_10_00_000, change: 1_05_75_000 });
    assert.equal(compared.packages.find((pack) => pack.name === 'RCC structure')?.status, 'moved');
    assert.deepEqual(compared.totals.certified, { previous: COST_TOTAL.certified, current: COST_TOTAL.certified + 1_05_75_000, change: 1_05_75_000 });
    assert.equal(compared.packages.find((pack) => pack.name === 'Painting')?.certified, undefined, 'a package neither report states it for has none');
  });

  it('loads a report kept before these figures existed', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    importCostReportRows(p, report.id, [{ name: 'Civil', budget: 100, poIssued: 80, amountPaid: 40, anticipatedCost: 110 }], 'tester');
    const old = JSON.parse(JSON.stringify(p)) as DdProject;
    const totals = costReportTotals(costReportOf(old, report.id));
    assert.equal('certified' in totals, false);
    assert.equal(costReportBottomLine(old, costReportOf(old, report.id)).beforeGst.certified, undefined);
    assert.deepEqual(costReportDecisions(costReportOf(old, report.id)).unawarded, []);
  });
});

describe('a page of the report, as words', () => {
  const page = readCostPage(costTableAsPageText())!;

  it('reads every package and every figure from a line’s words in order', () => {
    assert.deepEqual(page.columns, ['code', 'name', 'budget', 'awarded', 'awardedTo', 'anticipated', 'certified', 'perArea']);
    assert.deepEqual(page.rows.map((row) => row.name), COST_PACKAGES.map((pack) => pack.name));
    for (const pack of COST_PACKAGES) {
      const row = page.rows.find((held) => held.name === pack.name)!;
      assert.deepEqual([row.budget, row.awarded, row.awardedTo, row.anticipated, row.certified], [pack.budget, pack.awarded, pack.awardedTo, pack.anticipated, pack.certified], pack.name);
      assert.equal(row.unplaced, undefined);
    }
    assert.equal(page.rows[1]!.quote, '2 RCC structure 12,50,00,000 12,18,60,000 Northgate Constructions 12,46,10,000 6,04,25,000 1,038');
  });

  it('holds them to the page’s own total, and reads the GST line and the grand total where they state fewer figures', () => {
    assert.equal(page.addsUp, true);
    assert.deepEqual([page.stated.gst?.budget, page.stated.gst?.anticipated, page.stated.gst?.ratePct], [COST_GST.budget, COST_GST.anticipated, 18]);
    assert.deepEqual([page.stated.grandTotal?.budget, page.stated.grandTotal?.anticipated], [COST_GRAND_TOTAL.budget, COST_GRAND_TOTAL.anticipated]);
  });

  it('gives a package whose figures do not fill the columns as unplaced, with no figure guessed', () => {
    // A blank cell where the table printed nothing: the line has three figures for five columns.
    const text = costTableAsPageText().replace('4 Flooring and tiling 3,10,00,000 - - 3,10,00,000 - 258', '4 Flooring and tiling 3,10,00,000 3,10,00,000 258');
    const read = readCostPage(text)!;
    const row = read.rows.find((held) => held.name === 'Flooring and tiling')!;
    assert.equal(row.unplaced, true);
    assert.deepEqual([row.budget, row.awarded, row.anticipated, row.certified], [undefined, undefined, undefined, undefined]);
    assert.equal(read.addsUp, false, 'and the rows no longer add up to the total, which is said');
  });

  it('finds no table on a page of prose that mentions a budget', () => {
    assert.equal(readCostPage('The budget was approved in March and the anticipated final cost is within it.\nNo variations were certified this month.'), null);
    assert.equal(readCostPage('MONTHLY COST REPORT\nCost Report No. 5 - August 2026\nLakeview Residences, Mysuru'), null);
  });

  it('is what a paste from the PDF is read as', () => {
    const pasted = readCostText(costTableAsPageText());
    assert.deepEqual(pasted.rows.map((row) => row.name), COST_PACKAGES.map((pack) => pack.name));
    assert.equal(pasted.addsUp, true);
  });
});

describe('rows a cost report offers', () => {
  function offered(): { p: DdProject; evidenceId: string; reportId: string } {
    const p = project();
    const evidenceId = paperOn(p);
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    offerCostRowsFromPages(p, evidenceId, [{ page: 1, text: 'MONTHLY COST REPORT\nCost Report No. 5', reader: 'text' }, { page: 2, text: costTableAsPageText(), reader: 'ocr' }], 3);
    return { p, evidenceId, reportId: report.id };
  }

  it('are offered with their page and the page’s own line, and write nothing', () => {
    const { p, evidenceId, reportId } = offered();
    const paper = p.costPapers!.find((held) => held.evidenceId === evidenceId)!;
    assert.equal(paper.offers.length, 11);
    assert.equal(paper.offers.every((offer) => offer.status === 'offered' && offer.page === 2 && offer.reader === 'ocr'), true);
    assert.equal(paper.offers[1]!.quote, '2 RCC structure 12,50,00,000 12,18,60,000 Northgate Constructions 12,46,10,000 6,04,25,000 1,038');
    assert.deepEqual(paper.offers[1]!.cells, { name: 'RCC structure', code: '2', budget: 12_50_00_000, poIssued: 12_18_60_000, anticipatedCost: 12_46_10_000, certified: 6_04_25_000, awardedTo: 'Northgate Constructions' });
    assert.deepEqual(paper.pages.map((page) => [page.page, page.addsUp]), [[2, true]]);
    // Page 3 nobody read: a table may be there. Page 1 was read as text and holds none.
    assert.deepEqual(paper.pictures, [3]);
    assert.equal(costReportOf(p, reportId).rows.length, 0, 'nothing is typed for anybody');
  });

  it('are accepted one at a time, with a cell corrected first where the person says so', () => {
    const { p, evidenceId, reportId } = offered();
    const paper = p.costPapers![0]!;
    const lifts = paper.offers.find((offer) => offer.cells.name === 'Lifts')!;
    const row = acceptCostOffer(p, evidenceId, lifts.id, reportId, 'lead', { certified: 12_00_000 });
    assert.deepEqual({ name: row.name, budget: row.budget, poIssued: row.poIssued, certified: row.certified, from: row.from }, { name: 'Lifts', budget: 1_20_00_000, poIssued: 1_16_00_000, certified: 12_00_000, from: { evidenceId, page: 2, quote: lifts.quote } });
    assert.deepEqual({ status: lifts.status, by: lifts.decidedBy, edited: lifts.edited, rowId: lifts.rowId }, { status: 'accepted', by: 'lead', edited: true, rowId: row.id });
    assert.equal(costReportOf(p, reportId).rows.length, 1);
    assert.throws(() => acceptCostOffer(p, evidenceId, lifts.id, reportId, 'lead'), /accepted already/);
  });

  it('are accepted all from a page, leaving the ones a person has to look at', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const text = costTableAsPageText().replace('4 Flooring and tiling 3,10,00,000 - - 3,10,00,000 - 258', '4 Flooring and tiling 3,10,00,000 3,10,00,000 258');
    offerCostRowsFromPages(p, evidenceId, [{ page: 2, text, reader: 'text' }], 2);
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 2, report.id, 'lead'), { accepted: 10, left: 1 });
    const unplaced = p.costPapers![0]!.offers.find((offer) => offer.unplaced)!;
    assert.throws(() => acceptCostOffer(p, evidenceId, unplaced.id, report.id, 'lead'), /Type them from the page, then accept/);
    acceptCostOffer(p, evidenceId, unplaced.id, report.id, 'lead', { budget: 3_10_00_000, anticipatedCost: 3_10_00_000 });
    assert.equal(costReportTotals(costReportOf(p, report.id)).budget, COST_TOTAL.budget);
  });

  it('keep what a person decided when the paper is read again, and offer nothing twice', () => {
    const { p, evidenceId, reportId } = offered();
    const paper = p.costPapers![0]!;
    acceptCostOffer(p, evidenceId, paper.offers[0]!.id, reportId, 'lead');
    setAsideCostOffer(p, evidenceId, paper.offers[1]!.id, 'lead');
    offerCostRowsFromPages(p, evidenceId, [{ page: 2, text: costTableAsPageText(), reader: 'ocr' }], 3);
    const again = p.costPapers![0]!;
    assert.equal(again.offers.length, 11);
    assert.deepEqual(again.offers.slice(0, 3).map((offer) => offer.status), ['accepted', 'set_aside', 'offered']);
  });

  it('are refused onto a report that is issued', () => {
    const { p, evidenceId, reportId } = offered();
    acceptCostOffersOnPage(p, evidenceId, 2, reportId, 'lead');
    issueCostReport(p, reportId, 'lead');
    offerCostRowsFromPages(p, evidenceId, [{ page: 2, text: costTableAsPageText().replace('9 Lifts', '9 Lifts and escalators'), reader: 'ocr' }], 3);
    const fresh = p.costPapers![0]!.offers.find((offer) => offer.status === 'offered')!;
    assert.throws(() => acceptCostOffer(p, evidenceId, fresh.id, reportId, 'lead'), /issued, and is not edited/);
  });

  it('say in one plain line that the tables are pictures, where no row could be read', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const paper = offerCostRowsFromPages(p, evidenceId, [{ page: 1, text: 'MONTHLY COST REPORT\nCost Report No. 5', reader: 'text' }], 3);
    assert.deepEqual(paper.pictures, [2, 3]);
    assert.equal(costPaperSaid(paper, false), 'The tables in this report are pictures, which only a model reader could read and none is set up here. Paste the table below, with the PDF open beside it.');
    assert.equal(costPaperSaid(paper, true), 'The tables in this report are pictures, and no row could be read from them. Paste the table below, with the PDF open beside it.');
    // With rows offered there is nothing to say.
    assert.equal(costPaperSaid(offered().p.costPapers![0]!, false), '');
  });
});

describe('rows a model read off a page', () => {
  const pageTexts = ['MONTHLY COST REPORT', costTableAsPageText()];

  it('are kept only in the ledger’s own keys, each amount worked out here from the figure as written', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const paper = offerCostRowsFromModel(
      p,
      evidenceId,
      [
        { page: 2, name: 'RCC structure', budget: '12,50,00,000', awarded: '12,18,60,000', awardedTo: 'Northgate Constructions', anticipated: '12,46,10,000', certified: '6,04,25,000', summary: 'The structure is on budget.', margin: '4,00,000' },
        { page: 2, name: 'Lifts', budget: 12000000 },
        { page: 9, name: 'Painting', budget: '95,00,000' },
        { page: 2, budget: '1,00,000' },
        'a sentence',
      ],
      pageTexts,
      2,
    );
    assert.equal(paper.offers.length, 1, 'a number that is not the figure as written, a page the paper does not have and a row with no name are dropped');
    const offer = paper.offers[0]!;
    assert.deepEqual(offer.cells, { name: 'RCC structure', budget: 12_50_00_000, poIssued: 12_18_60_000, anticipatedCost: 12_46_10_000, certified: 6_04_25_000, awardedTo: 'Northgate Constructions' });
    assert.equal(offer.proof, 'page_text');
    assert.equal(offer.reader, 'model');
    assert.equal(JSON.stringify(paper).includes('on budget'), false, 'no sentence a model wrote is kept');
  });

  it('are unverified where a figure is not among the words read on the cited page, and “all of a page” never takes them', () => {
    const p = project();
    const evidenceId = paperOn(p);
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    offerCostRowsFromModel(p, evidenceId, [{ page: 2, name: 'RCC structure', budget: '12,50,00,000', anticipated: '12,64,10,000' }, { page: 2, name: 'Lifts', budget: '1,20,00,000', anticipated: '1,16,00,000' }], pageTexts, 2);
    assert.deepEqual(p.costPapers![0]!.offers.map((offer) => [offer.cells.name, offer.proof]), [['RCC structure', 'unverified'], ['Lifts', 'page_text']]);
    assert.deepEqual(acceptCostOffersOnPage(p, evidenceId, 2, report.id, 'lead'), { accepted: 1, left: 1 });
    assert.deepEqual(costReportOf(p, report.id).rows.map((row) => row.name), ['Lifts']);
  });

  it('holds a figure to the page whatever its grouping, and not to a part of a longer figure', () => {
    assert.equal(figureOnPage('12,50,00,000', 'Budget 125000000 for the structure'), true);
    assert.equal(figureOnPage('125000000', 'Budget 12,50,00,000.'), true);
    assert.equal(figureOnPage('50,00,000', 'Budget 12,50,00,000'), false);
    assert.equal(figureOnPage('12,50,00,000', undefined), false);
  });

  it('says a model was asked and gave nothing, where it did', () => {
    const p = project();
    const evidenceId = paperOn(p);
    offerCostRowsFromPages(p, evidenceId, [{ page: 1, text: 'MONTHLY COST REPORT', reader: 'text' }], 2);
    const paper = offerCostRowsFromModel(p, evidenceId, [], ['MONTHLY COST REPORT'], 2, { failure: 'The reader did not answer in time.' });
    assert.equal(costPaperSaid(paper, true), 'The tables in this report are pictures. A model was asked to read them and gave nothing that could be kept: paste the table below, with the PDF open beside it.');
  });
});
