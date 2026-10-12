/**
 * Monthly Cost Report: package rows as the figure of record, exec totals,
 * issue freeze, and work-package mirroring on the cost register.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addCostReportBasicPrice,
  addCostReportPackage,
  addCostReportVariation,
  addWorkPackages,
  costReportMonthBounds,
  costReportMonthLabel,
  costReportOf,
  costReportTotals,
  costRegister,
  costReportChanges,
  createProject,
  importCostReportRows,
  issueCostReport,
  largestCostMovements,
  parseCostReportTable,
  removeCostReportPackage,
  removeWorkPackage,
  reopenCostReport,
  setCostReportChangeReason,
  setCostReportPhotos,
  startCostReport,
  updateCostReportRow,
} from '@realytica/shared';

function project() {
  return createProject(
    { name: 'Kalidasa Road', type: 'residential', location: 'Mysore', city: 'Mysore', currentStage: 'construction' },
    'RYT-CR1',
    'tester',
  );
}

describe('cost report period', () => {
  it('names a calendar month and its bounds', () => {
    assert.equal(costReportMonthLabel('2026-08-15'), 'August 2026');
    assert.deepEqual(costReportMonthBounds('2026-08-15'), { from: '2026-08-01', to: '2026-08-31' });
  });

  it('starts a draft seeded from work packages', () => {
    const p = project();
    addWorkPackages(p, [{ code: 'A', name: 'Civil', budget: 1_000_000 }, { name: 'MEP', budget: 500_000 }], 'tester');
    const report = startCostReport(p, { month: '2026-08-10' }, 'tester');
    assert.equal(report.label, 'August 2026');
    assert.equal(report.status, 'draft');
    assert.equal(report.rows.length, 2);
    assert.equal(report.rows[0]!.budget, 1_000_000);
    assert.equal(report.rows[0]!.anticipatedCost, 1_000_000);
    assert.equal(report.rows[0]!.poIssued, 0);
    assert.ok(costRegister(p).workPackages.some((w) => w.id === report.rows[0]!.workPackageId));
  });

  /** July issued with a ledger, a variation, a typed reason and a note on a row. */
  function julyIssued() {
    const p = project();
    addWorkPackages(p, [{ code: 'A', name: 'Civil', budget: 1000 }, { code: 'B', name: 'MEP', budget: 500 }, { name: 'Lifts', budget: 200 }], 'tester');
    const july = startCostReport(p, { month: '2026-07-01' }, 'tester');
    const [civil, mep, lifts] = july.rows;
    updateCostReportRow(p, july.id, civil!.id, { budget: 1100, poIssued: 900, amountPaid: 300.5, anticipatedCost: 1180, note: 'Revised quote awaited' }, 'tester');
    updateCostReportRow(p, july.id, mep!.id, { poIssued: 450, amountPaid: 100, anticipatedCost: 470 }, 'tester');
    addCostReportVariation(p, july.id, { description: 'Extra piling', amount: 80, workPackageId: civil!.workPackageId }, 'tester');
    addCostReportBasicPrice(p, july.id, { item: 'Steel', tenderRate: 60, currentRate: 65, quantity: 10 }, 'tester');
    setCostReportChangeReason(p, july.id, civil!.workPackageId, 'Rock met at the east footings', 'tester');
    removeCostReportPackage(p, july.id, lifts!.id, 'tester');
    issueCostReport(p, july.id, 'tester');
    return { p, july };
  }
  const figures = (rows: ReadonlyArray<{ code?: string; name: string; budget: number; poIssued: number; amountPaid: number; anticipatedCost: number }>) =>
    rows.map((r) => [r.code, r.name, r.budget, r.poIssued, r.amountPaid, r.anticipatedCost]);

  it('starts a later month from the last issued report’s rows, with its own logs empty', () => {
    const { p, july } = julyIssued();
    const before = JSON.stringify(costReportOf(p, july.id));
    const august = startCostReport(p, { month: '2026-08-20' }, 'tester');
    assert.equal(august.status, 'draft');
    // The package list is July's: Lifts was taken off that report and stays off.
    assert.deepEqual(figures(august.rows), [['A', 'Civil', 1100, 900, 300.5, 1180], ['B', 'MEP', 500, 450, 100, 470]]);
    assert.deepEqual(august.rows.map((r) => r.workPackageId), costReportOf(p, july.id).rows.map((r) => r.workPackageId));
    // Rows of its own, and nothing that belongs to July's period.
    assert.ok(august.rows.every((r) => !costReportOf(p, july.id).rows.some((held) => held.id === r.id)));
    assert.ok(august.rows.every((r) => r.note === undefined));
    for (const key of ['variations', 'changeReasons', 'basicPriceAdjustments', 'photoEvidenceIds', 'note'] as const) assert.equal(august[key], undefined, key);
    // The issued report is not rewritten, now or when the new draft is edited.
    updateCostReportRow(p, august.id, august.rows[0]!.id, { anticipatedCost: 1300 }, 'tester');
    assert.equal(JSON.stringify(costReportOf(p, july.id)), before);
  });

  it('shows no movement between a freshly started report and the one before it', () => {
    const { p } = julyIssued();
    const august = startCostReport(p, { month: '2026-08-01' }, 'tester');
    const comparison = costReportChanges(p, august.id)!;
    assert.equal(comparison.previous.label, 'July 2026');
    assert.deepEqual(comparison.packages.map((c) => c.name), ['Civil', 'MEP']);
    assert.ok(comparison.packages.every((c) => c.unexplained === 0 && c.reason === undefined && c.causes.length === 0));
    assert.deepEqual(largestCostMovements(comparison), []);
    // The log of variations is each period's own, so it is the one figure not carried: August has logged none yet.
    assert.deepEqual(comparison.totals.figures.variations, { previous: 80, current: 0, change: -80 });
    for (const figure of ['budget', 'poIssued', 'amountPaid', 'anticipatedCost'] as const) {
      assert.ok(comparison.packages.every((c) => c.figures[figure].change === 0), figure);
      assert.equal(comparison.totals.figures[figure].change, 0, figure);
    }
    assert.deepEqual(
      [comparison.totals.forecastAgainstBudget.change, comparison.totals.explained, comparison.totals.unexplained, comparison.totals.added, comparison.totals.removed],
      [0, 0, 0, 0, 0],
    );
  });

  it('starts from the latest issued report before the period, not from a draft or a later one', () => {
    const { p } = julyIssued();
    const august = startCostReport(p, { month: '2026-08-01' }, 'tester');
    updateCostReportRow(p, august.id, august.rows[0]!.id, { anticipatedCost: 1250 }, 'tester');
    // August is still a draft: September starts from July.
    const draftAhead = startCostReport(p, { month: '2026-09-01' }, 'tester');
    assert.equal(draftAhead.rows[0]!.anticipatedCost, 1180);
    issueCostReport(p, august.id, 'tester');
    const october = startCostReport(p, { month: '2026-10-01' }, 'tester');
    assert.equal(october.rows[0]!.anticipatedCost, 1250);
    // A report for a month before every issued one is a first report: the register's packages, nothing ordered or paid.
    const june = startCostReport(p, { month: '2026-06-01' }, 'tester');
    assert.deepEqual(figures(june.rows), [['A', 'Civil', 1100, 0, 0, 1100], ['B', 'MEP', 500, 0, 0, 500], [undefined, 'Lifts', 200, 0, 0, 200]]);
    // Asked for with no seed, it starts empty whatever was issued.
    assert.deepEqual(startCostReport(p, { month: '2026-11-01', seedPackages: false }, 'tester').rows, []);
  });

  it('leaves out a package taken off the register since the last report', () => {
    const { p, july } = julyIssued();
    const mep = costReportOf(p, july.id).rows.find((r) => r.name === 'MEP')!;
    removeWorkPackage(p, mep.workPackageId, 'tester');
    const august = startCostReport(p, { month: '2026-08-01' }, 'tester');
    assert.deepEqual(august.rows.map((r) => r.name), ['Civil']);
    assert.equal(costReportChanges(p, august.id)!.packages.find((c) => c.name === 'MEP')!.status, 'removed');
  });

  it('sums Budget vs PO vs Paid and Budget vs Anticipated from the same rows', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    addCostReportPackage(p, report.id, { name: 'Civil', budget: 100, poIssued: 80, amountPaid: 40, anticipatedCost: 110 }, 'tester');
    addCostReportPackage(p, report.id, { name: 'MEP', budget: 50, poIssued: 50, amountPaid: 10, anticipatedCost: 45 }, 'tester');
    const totals = costReportTotals(costReportOf(p, report.id));
    assert.deepEqual(
      [totals.budget, totals.poIssued, totals.amountPaid, totals.anticipatedCost, totals.anticipatedVariance, totals.commitmentVariance],
      [150, 130, 50, 155, 5, -20],
    );
    assert.ok(totals.paidOfIssued !== undefined && Math.abs(totals.paidOfIssued - 50 / 130) < 1e-9);
  });

  it('edits a draft row and mirrors the package budget on the register', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const row = addCostReportPackage(p, report.id, { code: 'B', name: 'Structure', budget: 2_000_000 }, 'tester');
    updateCostReportRow(p, report.id, row.id, { budget: 2_500_000, poIssued: 1_000_000, anticipatedCost: 2_600_000 }, 'tester');
    const next = costReportOf(p, report.id).rows[0]!;
    assert.equal(next.budget, 2_500_000);
    assert.equal(next.poIssued, 1_000_000);
    const pack = costRegister(p).workPackages.find((w) => w.id === next.workPackageId)!;
    assert.equal(pack.budget, 2_500_000);
    assert.equal(pack.name, 'Structure');
  });

  it('refuses edits once issued, and allows them again after reopen', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const row = addCostReportPackage(p, report.id, { name: 'Civil', budget: 100 }, 'tester');
    issueCostReport(p, report.id, 'tester');
    assert.equal(costReportOf(p, report.id).status, 'issued');
    assert.throws(() => updateCostReportRow(p, report.id, row.id, { budget: 200 }, 'tester'), /issued/i);
    assert.throws(() => addCostReportPackage(p, report.id, { name: 'MEP', budget: 50 }, 'tester'), /issued/i);
    assert.throws(() => removeCostReportPackage(p, report.id, row.id, 'tester'), /issued/i);
    reopenCostReport(p, report.id, 'tester');
    updateCostReportRow(p, report.id, row.id, { budget: 200 }, 'tester');
    assert.equal(costReportOf(p, report.id).rows[0]!.budget, 200);
  });

  it('will not issue an empty report', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    assert.throws(() => issueCostReport(p, report.id, 'tester'), /at least one package/i);
  });
});

describe('cost report variations, basic prices and import', () => {
  it('records a variation log and refuses edits once issued', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    addCostReportPackage(p, report.id, { name: 'Civil', budget: 100 }, 'tester');
    addCostReportVariation(p, report.id, { description: 'Storm water drain', amount: 250_000, contingencyDrawn: true }, 'tester');
    assert.equal(costReportOf(p, report.id).variations!.length, 1);
    issueCostReport(p, report.id, 'tester');
    assert.throws(
      () => addCostReportVariation(p, report.id, { description: 'More', amount: 1 }, 'tester'),
      /issued/i,
    );
  });

  it('computes basic price adjustment amounts from rate delta × quantity', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    addCostReportPackage(p, report.id, { name: 'Civil', budget: 100 }, 'tester');
    const line = addCostReportBasicPrice(
      p,
      report.id,
      { item: 'PCC M10', unit: 'cum', tenderRate: 3870, currentRate: 4131, quantity: 100 },
      'tester',
    );
    assert.equal(line.amount, (4131 - 3870) * 100);
  });

  it('parses and imports a CSV ledger', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    const rows = parseCostReportTable(
      'Package,Budget,PO issued,Paid,Anticipated\nCivil,100,80,40,110\nMEP,50,50,10,45',
    );
    assert.equal(rows.length, 2);
    const result = importCostReportRows(p, report.id, rows, 'tester');
    assert.deepEqual([result.added, result.updated], [2, 0]);
    assert.equal(costReportOf(p, report.id).rows.length, 2);
    const again = importCostReportRows(p, report.id, [{ name: 'Civil', budget: 120 }], 'tester');
    assert.deepEqual([again.added, again.updated], [0, 1]);
    assert.equal(costReportOf(p, report.id).rows.find((r) => r.name === 'Civil')!.budget, 120);
  });

  it('pins vault photographs onto a draft report', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, 'tester');
    addCostReportPackage(p, report.id, { name: 'Civil', budget: 100 }, 'tester');
    assert.throws(() => setCostReportPhotos(p, report.id, ['missing'], 'tester'), /vault/i);
  });
});
