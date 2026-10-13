/**
 * What a second rehearsal on invented papers found, after the first one's
 * faults were fixed, each held here.
 *
 * - A cost report a spreadsheet printed has its table set in cells: a
 *   heading wrapped over three lines, a long name wrapped under its row, each
 *   figure at the middle of its cell. Read line by line it gave a heading in
 *   pieces and rows that did not add up; it is read by where its words sit.
 * - A scan read so poorly that most of its rows could not be placed is not
 *   offered row by row: the page is said to be a picture.
 * - A report's observations are found where a row's number stands on a line
 *   of its own, and a numbered heading over the table is no row.
 * - The reply to a drop says what a report offered and where it waits, and a
 *   cost report dropped during construction starts no due diligence.
 * - The owner pack, Overview and the chat count the papers owed one way, and
 *   Overview's figure for Budget and for Progress reads what their desks read.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  addCostReportPackage,
  addEvidence,
  addMilestones,
  applyProjectChat,
  chatQuestionAnswer,
  costCellsFromWords,
  costPapersOf,
  costReportDecisions,
  createProject,
  issueCostReport,
  landIngestFile,
  loadTrackedList,
  offerCostRowsFromPages,
  ownerPack,
  ownerPackPeriod,
  packageAwaitsNoAward,
  papersOwed,
  parseTrackedRows,
  projectBrief,
  quickAssessment,
  readCostWords,
  reportObservations,
  setMilestonePercent,
  startCostReport,
  updateCostReportRow,
  type ChatIngestFile,
  type CostPageWord,
  type DdProject,
} from '@realytica/shared';
import { readIngestLocally } from '../apps/api/src/documents/intake';
import { offerRowsOfPaper } from '../apps/api/src/documents/offers';
import { releaseOcr } from '../apps/api/src/documents/read-text';
import { COST_PACKAGES, COST_TOTAL } from './fixtures/cost-report';
import { costReportSetInCells } from './fixtures/report-papers';

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

const NOW = new Date('2026-10-13T06:00:00.000Z');

function project(): DdProject {
  return createProject({ name: 'Lakeview Residences', type: 'residential', location: 'Kere Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-RF1', 'tester');
}

async function read(fileName: string, bytes: Uint8Array): Promise<ChatIngestFile> {
  return readIngestLocally({ fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `key-${fileName}` }, Buffer.from(bytes));
}

describe('a cost table set in cells', () => {
  it('is read by where its words sit: every package, its contractor and its figures, adding up to the page’s total', async () => {
    const paper = await read('Lakeview CR-05 Aug 2026 (as printed).pdf', await costReportSetInCells());
    assert.deepEqual([paper.read?.type, paper.read?.method], ['cost_report', 'text']);
    const p = project();
    const evidenceId = landIngestFile(p, paper, 'tester')!;
    const offered = offerRowsOfPaper(p, evidenceId, paper);
    const held = costPapersOf(p).find((one) => one.evidenceId === evidenceId)!;
    assert.deepEqual(
      held.offers.map((offer) => ({ name: offer.cells.name, budget: offer.cells.budget, awarded: offer.cells.poIssued, awardedTo: offer.cells.awardedTo, anticipated: offer.cells.anticipatedCost, certified: offer.cells.certified })),
      COST_PACKAGES.map((pack) => ({ name: pack.name, budget: pack.budget, awarded: pack.awarded, awardedTo: pack.awardedTo, anticipated: pack.anticipated, certified: pack.certified })),
    );
    assert.equal(held.offers.some((offer) => offer.unplaced || offer.problems?.length), false, 'no row is left for a person to place');
    assert.equal(offered.costRows?.offered, COST_PACKAGES.length);
    const page = held.pages.find((one) => one.page === 2)!;
    assert.equal(page.addsUp, true);
    assert.deepEqual(page.checks.map((check) => [check.column, check.stated, check.difference]), [
      ['budget', COST_TOTAL.budget, 0],
      ['awarded', COST_TOTAL.awarded, 0],
      ['certified', COST_TOTAL.certified, 0],
      ['anticipated', COST_TOTAL.anticipated, 0],
    ]);
    // Its sub-totals, total, GST and grand total are lines of the page and never packages.
    assert.deepEqual(page.lines.filter((line) => line.as !== 'heading').map((line) => line.as), ['sub_total', 'sub_total', 'sub_total', 'total', 'gst', 'grand_total']);
  });

  /** Words laid out as a small table: each cell's lines about the middle of its row. */
  function laid(rows: string[][][], columns: Array<[number, number]>, right: number[]): CostPageWord[] {
    const words: CostPageWord[] = [];
    rows.forEach((cells, row) => {
      cells.forEach((said, column) => {
        said.forEach((line, n) => {
          const y = 0.2 + row * 0.06 + (n - (said.length - 1) / 2) * 0.012;
          const width = line.length * 0.006;
          let x = right.includes(column) ? columns[column]![1] - width : columns[column]![0];
          for (const text of line.split(' ')) {
            words.push({ text, x, y, w: text.length * 0.006, h: 0.01 });
            x += (text.length + 1) * 0.006;
          }
        });
      });
    });
    return words;
  }

  it('puts a wrapped heading over its column and a wrapped name with its row', () => {
    const columns: Array<[number, number]> = [[0.05, 0.08], [0.1, 0.3], [0.34, 0.46], [0.5, 0.62], [0.66, 0.78]];
    const words = laid(
      [
        [['Sl'], ['Packages'], ['Budget'], ['Anticipated final', 'cost'], ['Amount', 'certified']],
        [['1'], ['Earthwork and', 'excavation'], ['85,00,000'], ['82,40,000'], ['82,40,000']],
        [['2'], ['RCC structure'], ['12,50,00,000'], ['12,46,10,000'], ['6,04,25,000']],
        [['3'], ['Masonry and', 'plastering'], ['2,40,00,000'], ['2,40,00,000'], ['-']],
        [[''], ['TOTAL'], ['15,75,00,000'], ['15,68,50,000'], ['6,86,65,000']],
      ],
      columns,
      [2, 3, 4],
    );
    const cells = costCellsFromWords(words)!;
    assert.deepEqual(cells[0], ['Sl', 'Packages', 'Budget', 'Anticipated final cost', 'Amount certified']);
    assert.deepEqual(cells[1], ['1', 'Earthwork and excavation', '85,00,000', '82,40,000', '82,40,000']);
    const table = readCostWords(words)!;
    assert.deepEqual(table.rows.map((row) => [row.name, row.budget, row.anticipated, row.certified]), [
      ['Earthwork and excavation', 85_00_000, 82_40_000, 82_40_000],
      ['RCC structure', 12_50_00_000, 12_46_10_000, 6_04_25_000],
      ['Masonry and plastering', 2_40_00_000, 2_40_00_000, undefined],
    ]);
    assert.equal(table.addsUp, true);
  });

  it('gives nothing for a page of sentences, which is then read by its lines', () => {
    const words = 'The budget was approved in March and the anticipated final cost has not moved since the last report was issued.'.split(' ').map((text, n) => ({ text, x: 0.05 + (n % 8) * 0.1, y: 0.2 + Math.floor(n / 8) * 0.03, w: text.length * 0.006, h: 0.01 }));
    assert.equal(costCellsFromWords(words), null);
    assert.equal(readCostWords(words), null);
  });
});

describe('a scan whose table was read poorly', () => {
  it('is not offered row by row: the page is a picture, to be read by eye and pasted', () => {
    const p = project();
    const row = addEvidence(p, { title: 'Cost report, scanned', kind: 'document', status: 'received' }, 'tester');
    // What OCR made of a ruled table with hairline rules: a heading it could read and rows it could not.
    const text = ['Sl Packages Budget Awarded value Anticipated final cost Amount certified', '3 |Blockworkandplaser | 2100000 2 [21000001719]', '6 [Paming | esooow| | wwe]', '9 [tes | 11000000] 10800000 | 1050000]'].join('\n');
    const paper = offerCostRowsFromPages(p, row.id, [{ page: 2, text, reader: 'ocr' }], 3);
    assert.deepEqual([paper.offers.length, paper.pictures.includes(2)], [0, true]);
  });
});

describe('a report’s observations set in cells', () => {
  const page = [
    'TECHNICAL DUE DILIGENCE REPORT',
    '1. SUMMARY OF OBSERVATIONS',
    'No. Element Observation',
    'Risk',
    'category',
    'Recommendation',
    '1 Foundation Honeycombing seen on two pile caps at grid C4 and C5. High',
    'Break out the loose concrete and repair with non-shrink grout.',
    '2',
    'Basement retaining',
    'wall',
    'Seepage through the construction joint on the north wall. High',
    'Inject the joint with polyurethane grout.',
    '3 Columns',
    'Cover to reinforcement measured at 20 mm against 40 mm specified.',
    'Critical',
    'Stop further pours on the affected grid.',
    'Risk categories: Critical, High, Medium, Low.',
  ].join('\n');

  it('takes a number on a line of its own as a row, a numbered heading as none, and leaves the table’s key out of the last row', () => {
    const found = reportObservations([page]);
    assert.deepEqual(found.map((one) => [one.number, one.risk]), [['1', 'high'], ['2', 'high'], ['3', 'critical']]);
    assert.equal(found[0]!.seen.startsWith('Foundation Honeycombing seen'), true, found[0]!.seen);
    assert.equal(found[1]!.seen, 'Basement retaining wall Seepage through the construction joint on the north wall.');
    assert.equal(found[2]!.action, 'Stop further pours on the affected grid.');
  });
});

describe('a tracked list’s signature line', () => {
  it('is neither a section nor a paper, and is said to have been skipped', () => {
    const head = ['Ref No', 'Orig. Sl.No', 'Package', 'Description of Information Required', 'Current Status', 'Responsibility'];
    const list = parseTrackedRows([['INFORMATION REQUIRED'], head, ['1', '', '', 'GENERAL'], ['1.1', '1', 'GENERAL', 'Soil investigation report', 'Pending', 'Lakeview Homes'], ['Prepared by:', 'Meridian Cost Consultants', '', 'Checked by:', '', '']])!;
    assert.deepEqual([list.drafts.length, list.sections, list.skipped.map((one) => one.reason)], [1, 1, ['a signature line']]);
  });
});

/** A project with two issued Cost Reports, a schedule with a milestone behind, and a list with lines asked for and not. */
function running(): DdProject {
  const p = project();
  const first = startCostReport(p, { month: '2026-09-01' }, 'tester');
  const structure = addCostReportPackage(p, first.id, { name: 'RCC structure', budget: 12_50_00_000, anticipatedCost: 12_46_10_000 }, 'tester');
  updateCostReportRow(p, first.id, structure.id, { poIssued: 12_18_60_000, certified: 6_04_25_000 }, 'tester');
  addCostReportPackage(p, first.id, { name: 'Painting', budget: 95_00_000, anticipatedCost: 95_00_000 }, 'tester');
  addCostReportPackage(p, first.id, { name: 'Design contingency', budget: 1_00_00_000, anticipatedCost: 1_00_00_000 }, 'tester');
  addCostReportPackage(p, first.id, { name: 'Supervision fee', budget: 40_00_000, anticipatedCost: 40_00_000 }, 'tester');
  issueCostReport(p, first.id, 'tester');
  const second = startCostReport(p, { month: '2026-10-01' }, 'tester');
  updateCostReportRow(p, second.id, second.rows.find((row) => row.name === 'RCC structure')!.id, { anticipatedCost: 12_60_00_000 }, 'tester');
  issueCostReport(p, second.id, 'tester');
  return p;
}

describe('what is not awarded', () => {
  it('never lists a contingency or a fee, whether the row says what it is or only its name does', () => {
    const p = running();
    const report = p.costReports!.at(-1)!;
    assert.deepEqual(costReportDecisions(report).unawarded.map((pack) => pack.name), ['Painting']);
    assert.equal(packageAwaitsNoAward({ name: 'Podium', kind: 'contingency' }), true);
    assert.equal(packageAwaitsNoAward({ name: 'Painting' }), false);
  });
});

describe('Overview’s figure for a function reads what its desk reads', () => {
  it('gives Budget the forecast of the last Cost Report issued, and says nothing is on file with none', () => {
    assert.equal(quickAssessment(project(), 'finance.budget', NOW).verdict, 'insufficient');
    const read = quickAssessment(running(), 'finance.budget', NOW);
    assert.deepEqual([read.headline, read.verdict], ['Forecast ₹14.95 Cr against ₹14.85 Cr', 'conditions']);
  });

  it('never says Progress is clear over a board that says a milestone is behind', () => {
    const p = project();
    const [m] = addMilestones(p, [{ name: 'Foundations', weight: 10, plannedFinish: '2026-10-20' }], 'tester');
    p.milestones![0]!.plannedStart = '2026-06-15';
    setMilestonePercent(p, m!.id, 40, 'tester', '2026-10-03T06:00:00.000Z');
    setMilestonePercent(p, m!.id, 50, 'tester', '2026-10-13T05:00:00.000Z');
    const read = quickAssessment(p, 'construction.progress', NOW);
    assert.equal(read.verdict, 'conditions');
    assert.match(read.points[0]!.text, /Foundations/);
    assert.doesNotMatch(read.points.map((point) => point.text).join(' '), /\d{4}-\d{2}-\d{2}/, 'no day is printed as it is stored');
  });
});

describe('the chat, Overview and the owner pack say one thing', () => {
  it('answers how much is certified from the Cost Report where no bill is certified on the register', () => {
    const card = chatQuestionAnswer(running(), { shape: 'figure', figure: 'certified' }, { now: NOW }).card;
    assert.equal(card.said!.lead, 'No bill is certified on the cost register. As the Cost Report states it:');
    assert.deepEqual(card.rows.map((row) => [row.label, row.value]), [['Certified · all packages · October 2026', '₹6.04 Cr']]);
  });

  it('prints the total with GST and what is certified in the pack, and no reason wanted of a movement nothing is unexplained in', () => {
    const p = running();
    const pack = ownerPack(p, ownerPackPeriod({ month: '2026-10' }, NOW), NOW);
    const cost = pack.sections.find((section) => section.key === 'cost')!;
    const said = cost.parts.flatMap((part) => [...part.lines, ...(part.more ?? [])]).map((line) => line.what);
    assert.ok(said.some((line) => /^With GST at 18% \(rate not checked\): forecast ₹17\.64 Cr against a budget of ₹17\.52 Cr\. Certified to date: ₹6\.04 Cr\.$/.test(line)), said.join('\n'));
    const moved = said.find((line) => line.startsWith('RCC structure:'))!;
    assert.match(moved, /Unexplained: \+₹13\.9 lakh\. No reason given\.$/);
  });

  it('counts a paper as owed once somebody was asked for it, in the pack as on Overview', () => {
    const p = running();
    // A line that names the round it was asked in has been asked for; the third names none.
    const drafts = ['Soil investigation report', 'Structural design basis report', 'Fire NOC drawings'].map((title, n) => ({ title, list: 'Information required', ref: `1.${n + 1}`, owedBy: 'Pillar Structural', package: 'GENERAL', ...(n < 2 ? { round: 'RFI-01' } : {}) }));
    loadTrackedList(p, 'finance', drafts, 'tester');
    const owed = papersOwed(p, { now: NOW.toISOString() });
    assert.equal(owed.owed - owed.notAsked, 2);
    const pack = ownerPack(p, ownerPackPeriod({ month: '2026-10' }, NOW), NOW);
    const papers = pack.sections.find((section) => section.key === 'papers')!;
    assert.equal(papers.parts[0]!.lines[0]!.what, 'Pillar Structural: 2 papers owed; 1 more not yet asked for.');
  });

  it('counts rows a cost report offered under Needs you on Overview, until they are decided', () => {
    const p = running();
    const row = addEvidence(p, { title: 'Cost report, November', kind: 'document', status: 'received' }, 'tester');
    offerCostRowsFromPages(p, row.id, [{ page: 2, text: ['Sl Packages Budget Anticipated final cost', '1 Lifts 1,20,00,000 1,16,00,000', '2 Landscape 60,00,000 60,00,000'].join('\n'), reader: 'text' }], 2);
    const needs = projectBrief(p, NOW).find((line) => line.key === 'needs')!;
    assert.ok(needs.parts.some((part) => part.text === '2 cost rows to accept'), JSON.stringify(needs.parts));
  });
});

describe('the reply to a report dropped on a project being built', () => {
  it('says what its table offered and where it waits, and starts no due diligence', async () => {
    const paper = await read('Lakeview CR-05 Aug 2026 (as printed).pdf', await costReportSetInCells());
    const p = project();
    const evidenceId = landIngestFile(p, paper, 'tester')!;
    offerRowsOfPaper(p, evidenceId, paper);
    const reply = applyProjectChat(p, '', { ingest: [{ ...paper, landed: true }], actor: 'tester' });
    assert.match(reply.assistantTurn.text.replace(/\s+/g, ' '), /11 rows of its cost table are offered to the Cost Report on Finance › Budget, each with its page\. None is on the report until a lead or signer of Finance accepts it there\./);
    assert.equal((p.chatProposals ?? []).some((card) => card.kind === 'start_dd'), false);
  });
});
