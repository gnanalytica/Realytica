/**
 * Procurement › Tenders: the rules, with no server.
 *
 * A tender's stages are worked in order and their dates agree. Bids are set
 * against the estimate and against the others, and a flag is raised by the
 * arithmetic alone, exactly past the limit, in words that judge nothing. A
 * letter of acceptance offers the awarded value to Finance, and the Cost
 * Report is written only when the offer is accepted. A stage past its date
 * is an alert, once for that date. Somebody working from a grant is handed
 * none of it unless the grant names Procurement.
 *
 * The project, the packages, the bidders and the figures are invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TENDER_BID_FLAG_PERCENT,
  TENDER_LINE_FLAG_PERCENT,
  TENDER_MIN_BIDS_TO_FLAG,
  TENDER_STAGES,
  TENDER_STAGE_LABEL,
  acceptTenderOffer,
  addTenderBidder,
  addWorkPackages,
  alertConditions,
  costReportOf,
  createProject,
  declineTenderOffer,
  functionSections,
  functionsHoldingRecords,
  menuFunctions,
  placeFromText,
  departmentDefinition,
  issueCostReport,
  projectView,
  recommendTender,
  recordLetterOfAcceptance,
  removeTender,
  removeTenderBidder,
  reofferTender,
  setTenderEstimate,
  setTenderStage,
  startCostReport,
  startTender,
  syncAlerts,
  tenderComparison,
  tenderOffersWaiting,
  tenderPercentSaid,
  tenderStagesPastDue,
  tenderStanding,
  tendersOf,
  updateTenderBidder,
  withdrawLetterOfAcceptance,
  withheldAnswer,
  workstreamDefinition,
  type DdProject,
  type ProjectGrant,
  type PlaceReading,
  type Tender,
  type TenderStageKey,
} from '@realytica/shared';

const NOW = new Date('2026-10-12T09:00:00.000Z');
const ACTOR = 'buyer@builders.example';

/** A project with two work packages, and a tender started for the first. */
function tendered(estimate?: number): { project: DdProject; tender: Tender; packageId: string; otherId: string } {
  const project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TN1');
  const [electrical, lifts] = addWorkPackages(project, [{ code: 'E1', name: 'Electrical works', budget: 58_000_000 }, { name: 'Lifts', budget: 34_000_000 }], ACTOR);
  const tender = startTender(project, { workPackageId: electrical!.id, ...(estimate !== undefined ? { estimate } : {}) }, ACTOR);
  return { project, tender, packageId: electrical!.id, otherId: lifts!.id };
}

const stageOf = (tender: Tender, key: TenderStageKey) => tender.stages.find((stage) => stage.key === key)!;

/** Every stage before one, done on a day or gone without, so the one after can be worked. */
function settledUpTo(project: DdProject, tender: Tender, upTo: TenderStageKey, day = '2026-10-01'): void {
  for (const key of TENDER_STAGES) {
    if (key === upTo) return;
    if (key === 'queries' || key === 'negotiation') setTenderStage(project, tender.id, key, { notNeeded: true }, ACTOR, NOW);
    else setTenderStage(project, tender.id, key, { doneOn: day }, ACTOR, NOW);
  }
}

describe('a tender', () => {
  it('is for one work package, with the nine stages in order and nothing on them', () => {
    const { project, tender, packageId } = tendered(55_000_000);
    assert.deepEqual(tender.stages.map((stage) => stage.key), [...TENDER_STAGES]);
    assert.deepEqual(
      TENDER_STAGES.map((key) => TENDER_STAGE_LABEL[key]),
      ['Tender documents ready', 'Issued to bidders', 'Queries and addenda', 'Bids received', 'Comparison', 'Negotiation', 'Recommendation', 'Letter of acceptance', 'Contract signed'],
    );
    assert.ok(tender.stages.every((stage) => Object.keys(stage).length === 1));
    assert.deepEqual([tender.workPackageId, tender.packageName, tender.estimate], [packageId, 'E1 Electrical works', 55_000_000]);
    assert.equal(project.audit.at(-1)?.action, 'start_tender');
    assert.throws(() => startTender(project, { workPackageId: packageId }, ACTOR), /has a tender already/);
    assert.throws(() => startTender(project, { workPackageId: 'wpk_nowhere' }, ACTOR), /No work package by that id/);
    assert.throws(() => startTender(project, { workPackageId: tendered().otherId, estimate: 0 }, ACTOR), /No work package/);
    assert.throws(() => setTenderEstimate(project, tender.id, -4, ACTOR), /more than nothing/);
    assert.equal(setTenderEstimate(project, tender.id, null, ACTOR).estimate, undefined);
  });

  it('makes Procurement a live department with Tenders its one built function', () => {
    assert.equal(departmentDefinition('procurement').status, 'live');
    assert.deepEqual(departmentDefinition('procurement').workstreams.filter((ws) => ws.status === 'live').map((ws) => ws.key), ['procurement.boq']);
    assert.equal(workstreamDefinition('procurement.orders')?.status, 'coming_soon');
  });
});

describe('the stages of a tender', () => {
  it('carry a date and an owner each, and the dates run in order', () => {
    const { project, tender } = tendered();
    const issued = setTenderStage(project, tender.id, 'issued', { dueOn: '2026-10-20', owner: '  D. Pinto ' }, ACTOR, NOW);
    assert.deepEqual(issued, { key: 'issued', dueOn: '2026-10-20', owner: 'D. Pinto' });
    // A stage before is not due after it, and a stage after is not due before it.
    assert.throws(() => setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-21' }, ACTOR, NOW), /cannot be due after issued to bidders, which is due 2026-10-20/);
    assert.throws(() => setTenderStage(project, tender.id, 'bids_received', { dueOn: '2026-10-19' }, ACTOR, NOW), /cannot be due before issued to bidders, which is due 2026-10-20/);
    // The same day is in order.
    assert.equal(setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-20' }, ACTOR, NOW).dueOn, '2026-10-20');
    assert.equal(setTenderStage(project, tender.id, 'bids_received', { dueOn: '2026-10-20' }, ACTOR, NOW).dueOn, '2026-10-20');
    assert.throws(() => setTenderStage(project, tender.id, 'issued', { dueOn: '2026-02-30' }, ACTOR, NOW), /is a day, written YYYY-MM-DD/);
    assert.throws(() => setTenderStage(project, tender.id, 'issued', { dueOn: '20 Oct 2026' }, ACTOR, NOW), /is a day/);
    // Cleared with null, the date and the name both.
    assert.deepEqual(setTenderStage(project, tender.id, 'issued', { dueOn: null, owner: null }, ACTOR, NOW), { key: 'issued' });
    assert.equal(project.audit.at(-1)?.action, 'set_tender_stage');
  });

  it('are done in order: one waits on every stage before it', () => {
    const { project, tender } = tendered();
    assert.throws(() => setTenderStage(project, tender.id, 'issued', { doneOn: '2026-10-02' }, ACTOR, NOW), /Tender documents ready comes first: mark it done\./);
    setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-01' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'issued', { doneOn: '2026-10-02' }, ACTOR, NOW);
    // Queries may be gone without, and the refusal says so.
    assert.throws(() => setTenderStage(project, tender.id, 'bids_received', { doneOn: '2026-10-09' }, ACTOR, NOW), /Queries and addenda comes first: mark it done or not needed\./);
    assert.deepEqual(setTenderStage(project, tender.id, 'queries', { notNeeded: true }, ACTOR, NOW), { key: 'queries', notNeeded: true });
    assert.equal(setTenderStage(project, tender.id, 'bids_received', { doneOn: '2026-10-09' }, ACTOR, NOW).doneOn, '2026-10-09');
    assert.deepEqual(tenderStanding(tendersOf(project)[0]!, NOW), { at: 'comparison', settled: 4, late: [], say: 'At comparison' });
  });

  it('are done on a day that has come, and not before the stage before', () => {
    const { project, tender } = tendered();
    assert.throws(() => setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-13' }, ACTOR, NOW), /a day that has come/);
    assert.equal(setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-12' }, ACTOR, NOW).doneOn, '2026-10-12', 'today has come');
    assert.throws(() => setTenderStage(project, tender.id, 'issued', { doneOn: '2026-10-11' }, ACTOR, NOW), /Issued to bidders cannot be done before tender documents ready, done 2026-10-12/);
  });

  it('are opened again only from the end, and only two may be gone without', () => {
    const { project, tender } = tendered();
    setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-01' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'issued', { doneOn: '2026-10-02' }, ACTOR, NOW);
    assert.throws(() => setTenderStage(project, tender.id, 'documents_ready', { doneOn: null }, ACTOR, NOW), /Issued to bidders is already done\. Open that again first\./);
    assert.deepEqual(setTenderStage(project, tender.id, 'issued', { doneOn: null }, ACTOR, NOW), { key: 'issued' });
    assert.deepEqual(setTenderStage(project, tender.id, 'documents_ready', { doneOn: null }, ACTOR, NOW), { key: 'documents_ready' });
    for (const key of TENDER_STAGES) {
      if (key === 'queries' || key === 'negotiation') continue;
      assert.throws(() => setTenderStage(project, tender.id, key, { notNeeded: true }, ACTOR, NOW), /comes first|does not go without/, key);
    }
    assert.throws(() => setTenderStage(project, tender.id, 'documents_ready', { notNeeded: true }, ACTOR, NOW), /A tender does not go without tender documents ready\./);
  });

  it('keep the recommendation, the letter and the contract to what stands behind them', () => {
    const { project, tender } = tendered();
    const a = addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 54_800_000 }, ACTOR);
    settledUpTo(project, tender, 'recommendation');
    assert.throws(() => setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW), /Write the recommendation first\./);
    recommendTender(project, tender.id, { bidderId: a.id, text: 'Lowest of the bids that met the conditions.' }, ACTOR);
    setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW);
    assert.throws(() => setTenderStage(project, tender.id, 'letter_of_acceptance', { doneOn: '2026-10-06' }, ACTOR, NOW), /Record the letter of acceptance, with the bidder and the value\./);
    assert.throws(() => setTenderStage(project, tender.id, 'contract_signed', { doneOn: '2026-10-07' }, ACTOR, NOW), /Letter of acceptance comes first/);
    recordLetterOfAcceptance(project, tender.id, { bidderId: a.id, value: 54_000_000, letterOn: '2026-10-06' }, ACTOR, NOW);
    assert.throws(() => setTenderStage(project, tender.id, 'letter_of_acceptance', { doneOn: null }, ACTOR, NOW), /taken back, not opened again/);
    assert.equal(setTenderStage(project, tender.id, 'contract_signed', { doneOn: '2026-10-10' }, ACTOR, NOW).doneOn, '2026-10-10');
    assert.deepEqual(tenderStanding(tendersOf(project)[0]!, NOW), { settled: 9, late: [], say: 'Contract signed' });
  });
});

describe('the bidders of a tender', () => {
  it('are kept with what they quoted, revised, qualified and left out', () => {
    const { project, tender } = tendered();
    const a = addTenderBidder(project, tender.id, { name: ' Bidder A ', quoted: 54_800_000.004, qualifications: 'Price holds for 90 days.', exclusions: 'DG fuel tank.', lines: [{ item: 'Earthing', amount: 3_800_000 }] }, ACTOR);
    assert.deepEqual([a.name, a.quoted, a.revised, a.qualifications, a.exclusions, a.lines?.map((line) => [line.item, line.amount])], ['Bidder A', 54_800_000, undefined, 'Price holds for 90 days.', 'DG fuel tank.', [['Earthing', 3_800_000]]]);
    assert.throws(() => addTenderBidder(project, tender.id, { name: 'bidder a' }, ACTOR), /on this tender already/);
    assert.throws(() => addTenderBidder(project, tender.id, { name: '  ' }, ACTOR), /needs a name/);
    assert.throws(() => addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 0 }, ACTOR), /The amount quoted is an amount of money, more than nothing/);
    assert.throws(() => addTenderBidder(project, tender.id, { name: 'Bidder B', lines: [{ item: 'Earthing', amount: 1 }, { item: ' earthing ', amount: 2 }] }, ACTOR), /priced twice/);
    const revised = updateTenderBidder(project, tender.id, a.id, { revised: 53_900_000, exclusions: null }, ACTOR);
    assert.deepEqual([revised.quoted, revised.revised, revised.exclusions, revised.qualifications], [54_800_000, 53_900_000, undefined, 'Price holds for 90 days.']);
    assert.equal(project.audit.at(-1)?.newValue, 'Bidder A, quoted ₹5,48,00,000, revised ₹5,39,00,000');
    removeTenderBidder(project, tender.id, a.id, ACTOR);
    assert.equal(tendersOf(project)[0]!.bidders.length, 0);
    assert.throws(() => removeTenderBidder(project, tender.id, a.id, ACTOR), /No bidder by that id/);
  });
});

describe('the comparison of bids', () => {
  /** Three bids at 100, 100 and one more: the last is set against a median of 100. */
  const three = (last: number, estimate?: number) => {
    const { project, tender } = tendered(estimate);
    addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 100_000 }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 100_000 }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder C', quoted: last }, ACTOR);
    return tenderComparison(tendersOf(project)[0]!);
  };

  it('names its limits, so they are changed in one place', () => {
    assert.deepEqual([TENDER_BID_FLAG_PERCENT, TENDER_LINE_FLAG_PERCENT, TENDER_MIN_BIDS_TO_FLAG], [15, 25, 3]);
  });

  it('flags a bid more than the limit from the median of the others, above or below, and not one at the limit', () => {
    const at = 100_000 * (1 + TENDER_BID_FLAG_PERCENT / 100);
    assert.deepEqual(three(at).flags, [], 'exactly at the limit is not past it');
    assert.deepEqual(three(100_000 * (1 - TENDER_BID_FLAG_PERCENT / 100)).flags, [], 'nor exactly at it below');
    const above = three(at + 0.01);
    assert.deepEqual(above.flags.map((flag) => [flag.name, flag.say]), [['Bidder C', 'Bidder C differs from the others by 15%, above the median.']]);
    assert.deepEqual(above.bids.map((bid) => bid.flagged), [false, false, true]);
    const below = three(82_000);
    assert.deepEqual(below.flags.map((flag) => flag.say), ['Bidder C differs from the others by 18%, below the median.']);
    assert.equal(Math.round(below.flags[0]!.percent), -18);
    assert.equal(three(81_750).flags[0]!.say, 'Bidder C differs from the others by 18.3%, below the median.');
  });

  it('says how far and which way, and never what to make of it', () => {
    const said = [...three(60_000).flags, ...three(140_000).flags].map((flag) => flag.say).join(' ');
    assert.match(said, /differs from the others by 40%, below the median\..*differs from the others by 40%, above the median\./);
    assert.doesNotMatch(said, /abnormal|unbalanced|suspicious|too (?:low|high)|reject|should|recommend|best|worst|risk|unrealistic|cheap/i);
  });

  it('sets a bid against the median of every bid, so one far from the rest does not flag the rest', () => {
    const { project, tender } = tendered();
    for (const [name, quoted] of [['Bidder A', 100_000], ['Bidder B', 110_000], ['Bidder C', 120_000], ['Bidder D', 150_000]] as const) addTenderBidder(project, tender.id, { name, quoted }, ACTOR);
    const compared = tenderComparison(tendersOf(project)[0]!);
    // The median of the four is 115,000. D is 30.4% above it, and A 13% below.
    assert.equal(compared.median, 115_000);
    assert.equal(compared.bids[3]!.againstOthers!.toFixed(1), '30.4');
    assert.equal(compared.bids[0]!.againstOthers!.toFixed(1), '-13.0');
    assert.deepEqual(compared.flags.map((flag) => flag.name), ['Bidder D']);
    assert.deepEqual(compared.bids.map((bid) => bid.lowest), [true, false, false, false]);
  });

  it('compares nothing against the others until there are three bids', () => {
    const { project, tender } = tendered();
    addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 100_000 }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 400_000 }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder C' }, ACTOR);
    const compared = tenderComparison(tendersOf(project)[0]!);
    assert.deepEqual(compared.flags, []);
    assert.deepEqual(compared.bids.map((bid) => bid.againstOthers), [undefined, undefined, undefined]);
    assert.deepEqual(compared.bids.map((bid) => bid.amount), [100_000, 400_000, undefined]);
  });

  it('sets each bid against the pre-tender estimate, as a percentage and no flag', () => {
    const compared = three(60_000, 80_000);
    assert.deepEqual(compared.bids.map((bid) => bid.againstEstimate), [25, 25, -25]);
    assert.deepEqual(compared.bids.map((bid) => tenderPercentSaid(bid.againstEstimate!)), ['25% above', '25% above', '25% below']);
    assert.equal(tenderPercentSaid(0), 'the same');
    assert.equal(compared.estimate, 80_000);
    assert.deepEqual(three(100_000).bids.map((bid) => bid.againstEstimate), [undefined, undefined, undefined], 'with no estimate there is nothing to set them against');
  });

  it('compares the revised figure where there is one', () => {
    const { project, tender } = tendered();
    addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 100_000 }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 100_000 }, ACTOR);
    const c = addTenderBidder(project, tender.id, { name: 'Bidder C', quoted: 130_000 }, ACTOR);
    assert.equal(tenderComparison(tendersOf(project)[0]!).flags.length, 1);
    updateTenderBidder(project, tender.id, c.id, { revised: 104_000 }, ACTOR);
    const compared = tenderComparison(tendersOf(project)[0]!);
    assert.deepEqual(compared.flags, []);
    assert.deepEqual([compared.bids[2]!.quoted, compared.bids[2]!.revised, compared.bids[2]!.amount], [130_000, 104_000, 104_000]);
  });

  it('flags one priced item past its own limit, item by item', () => {
    const { project, tender } = tendered();
    const at = 1000 * (1 - TENDER_LINE_FLAG_PERCENT / 100);
    addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 100_000, lines: [{ item: 'Earthing', amount: 1000 }, { item: 'Cables', amount: 5000 }] }, ACTOR);
    addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 100_000, lines: [{ item: 'earthing', amount: 1000 }, { item: 'Cables', amount: 5000 }] }, ACTOR);
    const c = addTenderBidder(project, tender.id, { name: 'Bidder C', quoted: 100_000, lines: [{ item: 'Earthing', amount: at }, { item: 'Cables', amount: 5200 }] }, ACTOR);
    let compared = tenderComparison(tendersOf(project)[0]!);
    assert.deepEqual(compared.lines.map((line) => line.item), ['Earthing', 'Cables'], 'one row an item, however its name was typed');
    assert.deepEqual(compared.flags, [], 'exactly at the limit is not past it');
    updateTenderBidder(project, tender.id, c.id, { lines: [{ item: 'Earthing', amount: 610 }, { item: 'Cables', amount: 5200 }] }, ACTOR);
    compared = tenderComparison(tendersOf(project)[0]!);
    assert.deepEqual(compared.flags.map((flag) => [flag.item, flag.say]), [['Earthing', 'Bidder C, Earthing: differs from the others by 39%, below the median.']]);
    assert.deepEqual(compared.lines[0]!.cells.map((cell) => cell.flagged), [false, false, true]);
    assert.deepEqual(compared.bids.map((bid) => bid.flagged), [false, false, false], 'the bid as a whole is within the limit');
  });
});

describe('the recommendation and the letter of acceptance', () => {
  /** A tender ready for its letter, with a draft Cost Report holding its package. */
  function ready() {
    const made = tendered(55_000_000);
    const { project, tender, packageId } = made;
    const a = addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 54_800_000 }, ACTOR);
    const b = addTenderBidder(project, tender.id, { name: 'Bidder B', quoted: 53_800_000 }, ACTOR);
    const report = startCostReport(project, { month: '2026-10-01' }, 'finance@builders.example');
    // A new Cost Report opens with a row for each package of the register.
    const row = report.rows.find((held) => held.workPackageId === packageId)!;
    settledUpTo(project, tender, 'recommendation');
    return { ...made, a, b, report, row };
  }

  it('keeps the recommendation as a person’s words, under their name', () => {
    const { project, tender, a, b } = ready();
    assert.throws(() => recommendTender(project, tender.id, { bidderId: a.id, text: '   ' }, ACTOR), /in a person’s words/);
    assert.throws(() => recommendTender(project, tender.id, { bidderId: 'bdr_nobody', text: 'Them.' }, ACTOR), /No bidder by that id/);
    const first = recommendTender(project, tender.id, { bidderId: a.id, text: 'Met every condition.' }, ACTOR);
    assert.deepEqual([first.bidderId, first.text, first.by], [a.id, 'Met every condition.', ACTOR]);
    const second = recommendTender(project, tender.id, { bidderId: b.id, text: 'Lower after negotiation, same conditions.' }, 'lead@builders.example');
    assert.deepEqual([second.bidderId, second.by], [b.id, 'lead@builders.example']);
    assert.deepEqual([project.audit.at(-1)?.oldValue, project.audit.at(-1)?.newValue], ['Bidder A', 'Bidder B']);
    assert.throws(() => removeTenderBidder(project, tender.id, b.id, ACTOR), /the one recommended/);
  });

  it('offers the awarded value to Finance as PO issued, and writes nothing on the Cost Report', () => {
    const { project, tender, b, report, row } = ready();
    assert.throws(() => recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW), /Write the recommendation first\./);
    recommendTender(project, tender.id, { bidderId: b.id, text: 'Lowest that met the conditions.' }, ACTOR);
    assert.throws(() => recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW), /Recommendation comes first: mark it done\./);
    setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW);
    assert.throws(() => recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-04' }, ACTOR, NOW), /cannot be done before recommendation, done 2026-10-05/);
    assert.throws(() => recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08', evidenceId: 'ev_nowhere' }, ACTOR, NOW), /not on this project/);
    const awarded = recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW);
    assert.deepEqual([awarded.award?.bidderId, awarded.award?.value, awarded.award?.letterOn, awarded.award?.by], [b.id, 53_500_000, '2026-10-08', ACTOR]);
    assert.equal(stageOf(awarded, 'letter_of_acceptance').doneOn, '2026-10-08');
    assert.deepEqual([awarded.offer?.status, awarded.offer?.amount, awarded.offer?.workPackageId, awarded.offer?.offeredBy], ['offered', 53_500_000, tender.workPackageId, ACTOR]);
    // Offered, and not written: the row is as Finance left it.
    assert.equal(costReportOf(project, report.id).rows.find((held) => held.id === row.id)!.poIssued, 0);
    const [waiting] = tenderOffersWaiting(project);
    assert.deepEqual([waiting!.packageName, waiting!.bidderName, waiting!.onto], ['E1 Electrical works', 'Bidder B', { reportId: report.id, label: report.label, rowId: row.id, poIssued: 0 }]);
    // The award holds what it was made on.
    assert.throws(() => updateTenderBidder(project, tender.id, b.id, { revised: 1 }, ACTOR), /stay as they were awarded/);
    assert.throws(() => removeTenderBidder(project, tender.id, b.id, ACTOR), /holds the letter of acceptance/);
    assert.throws(() => removeTender(project, tender.id, ACTOR), /stays on the record/);
    assert.throws(() => recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 1, letterOn: '2026-10-08' }, ACTOR, NOW), /already/);
  });

  it('writes PO issued on the draft Cost Report when Finance accepts, under their name', () => {
    const { project, tender, b, report, row } = ready();
    recommendTender(project, tender.id, { bidderId: b.id, text: 'Lowest that met the conditions.' }, ACTOR);
    setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW);
    recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW);
    const accepted = acceptTenderOffer(project, tender.id, 'finance@builders.example');
    assert.deepEqual([accepted.status, accepted.decidedBy, accepted.reportId], ['accepted', 'finance@builders.example', report.id]);
    assert.equal(costReportOf(project, report.id).rows.find((held) => held.id === row.id)!.poIssued, 53_500_000);
    const line = project.audit.at(-1)!;
    assert.deepEqual([line.action, line.actor, line.oldValue], ['accept_tender_offer', 'finance@builders.example', 'PO issued ₹0']);
    assert.match(line.newValue!, /^PO issued ₹5,35,00,000 on October 2026, from the letter of acceptance for E1 Electrical works$/);
    assert.deepEqual(tenderOffersWaiting(project), []);
    assert.throws(() => acceptTenderOffer(project, tender.id, 'finance@builders.example'), /accepted already/);
    assert.throws(() => withdrawLetterOfAcceptance(project, tender.id, ACTOR), /Finance has accepted/);
  });

  it('is not written on an issued Cost Report: the offer waits for a draft', () => {
    const { project, tender, b, report, row } = ready();
    recommendTender(project, tender.id, { bidderId: b.id, text: 'Lowest that met the conditions.' }, ACTOR);
    setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW);
    recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW);
    issueCostReport(project, report.id, 'finance@builders.example');
    assert.equal(tenderOffersWaiting(project)[0]!.onto, undefined);
    assert.throws(() => acceptTenderOffer(project, tender.id, 'finance@builders.example'), /No draft Cost Report holds this package/);
    assert.equal(tendersOf(project)[0]!.offer?.status, 'offered');
    assert.equal(costReportOf(project, report.id).rows.find((held) => held.id === row.id)!.poIssued, 0);
  });

  it('can be declined with a reason, offered again, or taken back before Finance accepts', () => {
    const { project, tender, b, report, row } = ready();
    recommendTender(project, tender.id, { bidderId: b.id, text: 'Lowest that met the conditions.' }, ACTOR);
    setTenderStage(project, tender.id, 'recommendation', { doneOn: '2026-10-05' }, ACTOR, NOW);
    recordLetterOfAcceptance(project, tender.id, { bidderId: b.id, value: 53_500_000, letterOn: '2026-10-08' }, ACTOR, NOW);
    assert.throws(() => declineTenderOffer(project, tender.id, ' ', 'finance@builders.example'), /Say why/);
    assert.throws(() => reofferTender(project, tender.id, ACTOR), /Only a declined offer/);
    const declined = declineTenderOffer(project, tender.id, 'The value leaves out the DG set.', 'finance@builders.example');
    assert.deepEqual([declined.status, declined.reason], ['declined', 'The value leaves out the DG set.']);
    assert.equal(costReportOf(project, report.id).rows.find((held) => held.id === row.id)!.poIssued, 0);
    assert.throws(() => acceptTenderOffer(project, tender.id, 'finance@builders.example'), /declined already/);
    assert.equal(reofferTender(project, tender.id, ACTOR).status, 'offered');
    const back = withdrawLetterOfAcceptance(project, tender.id, ACTOR);
    assert.deepEqual([back.award, back.offer, stageOf(back, 'letter_of_acceptance').doneOn], [undefined, undefined, undefined]);
    removeTender(project, tender.id, ACTOR);
    assert.deepEqual(tendersOf(project), []);
  });
});

describe('a stage past its date', () => {
  it('is an alert with a key of its own, for Procurement, naming who the stage is with', () => {
    const { project, tender } = tendered();
    setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-09', owner: 'D. Pinto' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'issued', { dueOn: '2026-10-12' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'bids_received', { dueOn: '2026-11-02' }, ACTOR, NOW);
    const past = tenderStagesPastDue(project, NOW);
    assert.deepEqual(past, [
      {
        key: `tender:${tender.id}:documents_ready:due:2026-10-09`,
        department: 'procurement',
        workstream: 'procurement.boq',
        severity: 'warning',
        title: 'E1 Electrical works: tender documents ready is past its date',
        detail: 'Due 2026-10-09, with D. Pinto.',
        dueOn: '2026-10-09',
        to: ['D. Pinto'],
      },
    ]);
    // Due today is not past its date. Tomorrow it is, and says nobody is named.
    const tomorrow = tenderStagesPastDue(project, new Date('2026-10-13T09:00:00.000Z'));
    assert.deepEqual(tomorrow.map((c) => c.detail), ['Due 2026-10-09, with D. Pinto.', 'Due 2026-10-12, with nobody named for it.']);
    assert.ok(alertConditions(project, NOW).some((c) => c.key === past[0]!.key), 'it is one of the project’s alert conditions');
    assert.deepEqual(tenderStanding(tendersOf(project)[0]!, NOW).say, 'At tender documents ready, 1 stage past its date');
  });

  it('is raised once for that date, cleared when the stage is done, and raised again only for a new date that passes', () => {
    const { project, tender } = tendered();
    setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-09' }, ACTOR, NOW);
    const mine = () => (project.alerts ?? []).filter((alert) => alert.key.startsWith('tender:'));
    assert.equal(syncAlerts(project, NOW).filter((alert) => alert.key.startsWith('tender:')).length, 1);
    assert.equal(syncAlerts(project, new Date('2026-10-13T09:00:00.000Z')).length, 0, 'the next day raises no second');
    // Moved to a later date: the first clears, and nothing is raised until the new date passes.
    setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-20' }, ACTOR, NOW);
    assert.equal(syncAlerts(project, new Date('2026-10-14T09:00:00.000Z')).length, 0);
    assert.deepEqual(mine().map((alert) => Boolean(alert.resolvedAt)), [true]);
    const again = syncAlerts(project, new Date('2026-10-21T09:00:00.000Z'));
    assert.deepEqual(again.map((alert) => alert.key), [`tender:${tender.id}:documents_ready:due:2026-10-20`]);
    // Done: cleared.
    setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-21' }, ACTOR, new Date('2026-10-21T09:00:00.000Z'));
    syncAlerts(project, new Date('2026-10-22T09:00:00.000Z'));
    assert.ok(mine().every((alert) => alert.resolvedAt));
  });

  it('is no alert for a stage gone without', () => {
    const { project, tender } = tendered();
    setTenderStage(project, tender.id, 'documents_ready', { doneOn: '2026-10-01' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'issued', { doneOn: '2026-10-02' }, ACTOR, NOW);
    setTenderStage(project, tender.id, 'queries', { dueOn: '2026-10-05' }, ACTOR, NOW);
    assert.equal(tenderStagesPastDue(project, NOW).length, 1);
    setTenderStage(project, tender.id, 'queries', { notNeeded: true }, ACTOR, NOW);
    assert.deepEqual(tenderStagesPastDue(project, NOW), []);
  });
});

describe('somebody working from a grant', () => {
  const grant = (scopeKeys: ProjectGrant['scopeKeys'], more: Partial<ProjectGrant> = {}): ProjectGrant => ({
    id: 'grant-sam',
    tenantId: 't1',
    projectId: 'p1',
    email: 'sam@site.example',
    role: 'contributor',
    allAssessments: true,
    assessmentIds: [],
    allScopes: false,
    scopeKeys,
    areas: [],
    createdAt: NOW.toISOString(),
    createdBy: ACTOR,
    ...more,
  });

  function withBids(): DdProject {
    const { project, tender } = tendered(55_000_000);
    addTenderBidder(project, tender.id, { name: 'Bidder A', quoted: 54_800_000 }, ACTOR);
    setTenderStage(project, tender.id, 'documents_ready', { dueOn: '2026-10-09', owner: 'D. Pinto' }, ACTOR, NOW);
    syncAlerts(project, NOW);
    return project;
  }

  it('is handed no tenders, no bidders and no alert about them unless the grant names Procurement', () => {
    const project = withBids();
    for (const held of [grant(['technical']), grant([], { allScopes: true }), grant(['cost_quantity'], { areas: ['commercials', 'valuation', 'reports', 'decisions', 'site_record'] })]) {
      const view = projectView(project, { kind: 'granted', grant: held, email: held.email });
      assert.equal(view.project.procurement, undefined);
      assert.ok(view.withheld.includes('procurement'));
      assert.ok(!JSON.stringify(view.project).includes('Bidder A'), 'the bidder’s name is nowhere on the copy');
      assert.deepEqual((view.project.alerts ?? []).filter((alert) => alert.key.startsWith('tender:')), []);
      assert.equal(withheldAnswer(view, 'Who are the bidders on the electrical tender?'), 'You do not have access to the tenders, bidders and bids on this project. Ask whoever put you on this project if you need it.');
    }
  });

  it('is handed them where the grant names Procurement, with the package named though the Cost Report is not theirs', () => {
    const project = withBids();
    const view = projectView(project, { kind: 'granted', grant: grant(['procurement']), email: 'sam@site.example' });
    assert.equal(view.project.cost, undefined, 'the budget is still Finance’s to open');
    assert.deepEqual(tendersOf(view.project).map((tender) => [tender.packageName, tender.bidders.map((bidder) => bidder.name)]), [['E1 Electrical works', ['Bidder A']]]);
    assert.ok(!view.withheld.includes('procurement'));
    assert.deepEqual((view.project.alerts ?? []).filter((alert) => alert.key.startsWith('tender:')).map((alert) => alert.title), ['E1 Electrical works: tender documents ready is past its date']);
  });

  it('is told nothing is withheld where there are no tenders', () => {
    const project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TN2');
    assert.ok(!projectView(project, { kind: 'granted', grant: grant(['technical']), email: 'sam@site.example' }).withheld.includes('procurement'));
  });
});

describe('the Tenders page, in the menu and in the chat’s words', () => {
  const went = (reading: PlaceReading | null) => {
    assert.ok(reading && reading.kind === 'go', JSON.stringify(reading));
    return reading;
  };

  it('is a built function of Procurement, laid out in the parts every built function has', () => {
    const tenders = menuFunctions('procurement').find((fn) => fn.key === 'procurement.boq')!;
    assert.deepEqual([tenders.label, tenders.built], ['Tenders', true]);
    assert.deepEqual(menuFunctions('procurement').filter((fn) => fn.built).map((fn) => fn.label), ['Tenders']);
    assert.deepEqual(functionSections('procurement.boq'), ['standing', 'tenders', 'checks', 'documents', 'connections']);
  });

  it('is opened by its name, and at its own part by the words for it', () => {
    // At Pre-construction, where Procurement has work.
    const { project } = tendered();
    project.currentStage = 'procurement';
    assert.deepEqual([went(placeFromText(project, 'open Tenders')).place.fn, went(placeFromText(project, 'open Tenders')).section], ['procurement.boq', undefined]);
    for (const said of ['show the tender register', 'open the bid comparison', 'show bidders', 'open Tenders bidders', 'open Procurement Tenders stages', 'show Tenders bids']) {
      const reading = went(placeFromText(project, said));
      assert.deepEqual([reading.place.fn, reading.section], ['procurement.boq', 'tenders'], said);
    }
    assert.equal(went(placeFromText(project, 'open tendering')).place.fn, 'procurement.boq');
    assert.deepEqual([went(placeFromText(project, 'open Tenders documents')).place.fn, went(placeFromText(project, 'open Tenders documents')).section], ['procurement.boq', 'documents']);
  });

  it('holds its tab at any stage once a tender is on the project', () => {
    const empty = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TN3');
    assert.ok(!functionsHoldingRecords(empty).has('procurement.boq'));
    assert.ok(functionsHoldingRecords(tendered().project).has('procurement.boq'));
  });
});
