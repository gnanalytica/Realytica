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
  createProject,
  importCostReportRows,
  issueCostReport,
  parseCostReportTable,
  removeCostReportPackage,
  reopenCostReport,
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
