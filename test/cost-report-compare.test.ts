/**
 * What moved between two Cost Reports, and why: the comparison package by
 * package, what variations and awards account for, what is left unexplained,
 * the typed reasons, and that a report kept before any of this still loads.
 *
 * The reload tests run against the real filesystem store, because what they
 * hold to is what a save writes and a boot reads back.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  addBill,
  addContract,
  addCostReportPackage,
  addCostReportVariation,
  addWorkPackages,
  certifyBill,
  certifyLine,
  compareCostReports,
  costRegister,
  costReportChanges,
  costReportOf,
  createProject,
  issueCostReport,
  largestCostMovements,
  previousCostReport,
  removeCostReportPackage,
  setCostReportChangeReason,
  startCostReport,
  updateCostReportRow,
  type CostReportPeriod,
  type DdProject,
} from '@realytica/shared';

const WHO = 'tester';

function project(reference = 'RYT-CC1'): DdProject {
  return createProject({ name: 'Lakeside Block', type: 'residential', location: 'Ward 4', city: 'Mysore', currentStage: 'construction' }, reference, WHO);
}

/**
 * Two months of one project. July is issued with three packages; August is a
 * draft seeded from the same packages. Each figure of August is then set by
 * the test that reads it.
 */
function twoMonths(reference?: string) {
  const p = project(reference);
  addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }, { code: 'B', name: 'Facade', budget: 500 }, { code: 'C', name: 'Lifts', budget: 200 }], WHO);
  const july = startCostReport(p, { month: '2026-07-01' }, WHO);
  const [structure, facade, lifts] = july.rows;
  updateCostReportRow(p, july.id, structure!.id, { poIssued: 900, amountPaid: 300, anticipatedCost: 1000 }, WHO);
  issueCostReport(p, july.id, WHO);
  const august = startCostReport(p, { month: '2026-08-01' }, WHO);
  const row = (name: string) => costReportOf(p, august.id).rows.find((r) => r.name === name)!;
  updateCostReportRow(p, august.id, row('Structure').id, { poIssued: 900, amountPaid: 300, anticipatedCost: 1000 }, WHO);
  return { p, july, august, row, ids: { structure: structure!.workPackageId, facade: facade!.workPackageId, lifts: lifts!.workPackageId } };
}

const changeOf = (p: DdProject, reportId: string, workPackageId: string) =>
  costReportChanges(p, reportId)!.packages.find((c) => c.workPackageId === workPackageId)!;

describe('comparing two Cost Reports', () => {
  it('says nothing moved on a package whose figures are the same', () => {
    const { p, august, ids } = twoMonths();
    const structure = changeOf(p, august.id, ids.structure);
    assert.equal(structure.status, 'unchanged');
    assert.deepEqual(structure.figures.anticipatedCost, { previous: 1000, current: 1000, change: 0 });
    assert.deepEqual(structure.causes, []);
    assert.equal(structure.unexplained, 0);
  });

  it('gives then, now and the change for every figure of a package that moved, and in total', () => {
    const { p, august, row, ids } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { budget: 1100, poIssued: 950, amountPaid: 420.5, anticipatedCost: 1180 }, WHO);
    addCostReportVariation(p, august.id, { description: 'Extra piling', amount: 60, workPackageId: ids.structure }, WHO);
    const comparison = costReportChanges(p, august.id)!;
    const structure = comparison.packages.find((c) => c.workPackageId === ids.structure)!;
    assert.equal(structure.status, 'moved');
    assert.deepEqual(structure.figures, {
      budget: { previous: 1000, current: 1100, change: 100 },
      poIssued: { previous: 900, current: 950, change: 50 },
      variations: { previous: 0, current: 60, change: 60 },
      amountPaid: { previous: 300, current: 420.5, change: 120.5 },
      anticipatedCost: { previous: 1000, current: 1180, change: 180 },
    });
    assert.deepEqual(comparison.totals.figures.anticipatedCost, { previous: 1700, current: 1880, change: 180 });
    assert.deepEqual(comparison.totals.figures.budget, { previous: 1700, current: 1800, change: 100 });
    // The forecast against the budget: level with it in July, 80 over in August.
    assert.deepEqual(comparison.totals.forecastAgainstBudget, { previous: 0, current: 80, change: 80 });
    assert.deepEqual([comparison.previous.label, comparison.current.label], ['July 2026', 'August 2026']);
  });

  it('reports a package added or removed as that, with no figure on the side it was not on', () => {
    const { p, august, row, ids } = twoMonths();
    removeCostReportPackage(p, august.id, row('Lifts').id, WHO);
    const added = addCostReportPackage(p, august.id, { code: 'D', name: 'Landscape', budget: 150, anticipatedCost: 160 }, WHO);
    const comparison = costReportChanges(p, august.id)!;
    const landscape = comparison.packages.find((c) => c.workPackageId === added.workPackageId)!;
    assert.equal(landscape.status, 'added');
    assert.deepEqual(landscape.figures.anticipatedCost, { current: 160, change: 160 });
    assert.ok(!('previous' in landscape.figures.budget));
    const lifts = comparison.packages.find((c) => c.workPackageId === ids.lifts)!;
    assert.equal(lifts.status, 'removed');
    assert.deepEqual(lifts.figures.anticipatedCost, { previous: 200, change: -200 });
    assert.ok(!('current' in lifts.figures.budget));
    // Neither is an unexplained change: coming or going is the reason.
    assert.deepEqual([landscape.unexplained, lifts.unexplained], [0, 0]);
    assert.deepEqual([comparison.totals.added, comparison.totals.removed], [160, 200]);
    assert.equal(comparison.totals.figures.anticipatedCost.change, -40);
    // The current report's packages in its order, then the ones removed.
    assert.deepEqual(comparison.packages.map((c) => c.name), ['Structure', 'Facade', 'Landscape', 'Lifts']);
  });

  it('is a pure reading: neither report is changed by it', () => {
    const { p, july, august } = twoMonths();
    const before = JSON.stringify([costReportOf(p, july.id), costReportOf(p, august.id)]);
    compareCostReports(costReportOf(p, july.id), costReportOf(p, august.id), costRegister(p).bills);
    assert.equal(JSON.stringify([costReportOf(p, july.id), costReportOf(p, august.id)]), before);
  });
});

describe('what accounts for a change', () => {
  it('sets a package’s variations against its change and keeps the rest as unexplained', () => {
    const { p, august, row, ids } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1180 }, WHO);
    const piling = addCostReportVariation(p, august.id, { description: 'Extra piling', amount: 60, workPackageId: ids.structure, dated: '2026-08-12' }, WHO);
    const drain = addCostReportVariation(p, august.id, { description: 'Storm water drain', amount: 45, workPackageId: ids.structure, contingencyDrawn: true }, WHO);
    const structure = changeOf(p, august.id, ids.structure);
    assert.deepEqual(structure.causes, [
      { kind: 'variation', variationId: piling.id, description: 'Extra piling', amount: 60, dated: '2026-08-12' },
      { kind: 'variation', variationId: drain.id, description: 'Storm water drain', amount: 45, contingencyDrawn: true },
    ]);
    assert.equal(structure.unexplained, 75);
    const totals = costReportChanges(p, august.id)!.totals;
    assert.deepEqual([totals.explained, totals.unexplained, totals.unexplainedPackages], [105, 75, 1]);
  });

  it('keeps an unexplained amount on its own package: another package’s variation does not absorb it', () => {
    const { p, august, row, ids } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1050 }, WHO);
    addCostReportVariation(p, august.id, { description: 'Stone cladding', amount: 50, workPackageId: ids.facade }, WHO);
    // Facade did not move, so its variation overshoots by 50 the other way; Structure's 50 has no cause.
    assert.equal(changeOf(p, august.id, ids.structure).unexplained, 50);
    assert.equal(changeOf(p, august.id, ids.facade).unexplained, -50);
    const totals = costReportChanges(p, august.id)!.totals;
    assert.deepEqual([totals.unexplained, totals.unexplainedPackages], [0, 2]);
  });

  it('lists a variation that names no package apart, set against no package', () => {
    const { p, august, row, ids } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1030 }, WHO);
    const loose = addCostReportVariation(p, august.id, { description: 'Site-wide hoarding', amount: 30 }, WHO);
    const comparison = costReportChanges(p, august.id)!;
    assert.deepEqual(comparison.unassignedVariations, [{ kind: 'variation', variationId: loose.id, description: 'Site-wide hoarding', amount: 30 }]);
    assert.equal(changeOf(p, august.id, ids.structure).unexplained, 30);
    assert.equal(comparison.totals.figures.variations.current, 30);
  });

  it('sets a newly awarded package’s step from the last forecast against its change, and no more than that', () => {
    const { p, august, row, ids } = twoMonths();
    // Facade: forecast 500 in July with no PO. Awarded at 560 in August, now forecast at 580.
    updateCostReportRow(p, august.id, row('Facade').id, { poIssued: 560, anticipatedCost: 580 }, WHO);
    const facade = changeOf(p, august.id, ids.facade);
    assert.deepEqual(facade.causes, [{ kind: 'award', poIssued: 560, amount: 60 }]);
    assert.equal(facade.unexplained, 20);
    // Lifts: a first order for part of the package, and the forecast did not move. The award accounts for nothing.
    updateCostReportRow(p, august.id, row('Lifts').id, { poIssued: 80 }, WHO);
    const lifts = changeOf(p, august.id, ids.lifts);
    assert.deepEqual(lifts.causes, [{ kind: 'award', poIssued: 80, amount: 0 }]);
    assert.equal(lifts.unexplained, 0);
    // Structure had a PO in July already, so a larger one now is not an award.
    updateCostReportRow(p, august.id, row('Structure').id, { poIssued: 950 }, WHO);
    assert.deepEqual(changeOf(p, august.id, ids.structure).causes, []);
  });

  it('orders the largest movements by size, either way, and leaves out what did not move', () => {
    const { p, august, row } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1040 }, WHO);
    updateCostReportRow(p, august.id, row('Facade').id, { anticipatedCost: 410 }, WHO);
    const comparison = costReportChanges(p, august.id)!;
    assert.deepEqual(largestCostMovements(comparison).map((c) => [c.name, c.figures.anticipatedCost.change]), [['Facade', -90], ['Structure', 40]]);
    assert.deepEqual(largestCostMovements(comparison, 1).map((c) => c.name), ['Facade']);
  });

  it('names the decisions: packages forecast over budget, and packages with no PO', () => {
    const { p, august, row } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1125.5 }, WHO);
    const { decisions } = costReportChanges(p, august.id)!;
    assert.deepEqual(decisions.overBudget.map((d) => [d.code, d.name, d.over]), [['A', 'Structure', 125.5]]);
    assert.deepEqual(decisions.unawarded.map((d) => d.name), ['Facade', 'Lifts']);
  });
});

describe('which report a Cost Report is read against', () => {
  it('has nothing to compare with while it is the only report, or the earlier one is still a draft', () => {
    const p = project();
    addWorkPackages(p, [{ name: 'Structure', budget: 1000 }], WHO);
    const july = startCostReport(p, { month: '2026-07-01' }, WHO);
    assert.equal(previousCostReport(p, july.id), undefined);
    assert.equal(costReportChanges(p, july.id), undefined);
    const august = startCostReport(p, { month: '2026-08-01' }, WHO);
    assert.equal(costReportChanges(p, august.id), undefined);
    issueCostReport(p, july.id, WHO);
    assert.equal(previousCostReport(p, august.id)!.id, july.id);
    // The earlier report is never read against a later one.
    assert.equal(previousCostReport(p, july.id), undefined);
  });

  it('reads a draft against the last issued, and an issued report against the one issued before it', () => {
    const { p, july, august } = twoMonths();
    issueCostReport(p, august.id, WHO);
    const september = startCostReport(p, { month: '2026-09-01' }, WHO);
    assert.equal(previousCostReport(p, september.id)!.id, august.id);
    assert.equal(previousCostReport(p, august.id)!.id, july.id);
  });
});

describe('claimed against certified', () => {
  it('totals the running bills dated after the last report’s period and up to the end of this one', () => {
    const { p, august, ids } = twoMonths();
    assert.equal(costReportChanges(p, august.id)!.billed, undefined);
    const contract = addContract(p, { contractor: 'Northside Builders', title: 'Structure', workPackageIds: [ids.structure], value: 900 }, WHO);
    const line = (amount: number) => ({ item: '1', description: 'Concrete', workPackageId: ids.structure, amount, readBy: 'person' as const });
    addBill(p, { contractId: contract.id, number: 'RA-1', date: '2026-07-20', lines: [line(100)] }, WHO);
    const second = addBill(p, { contractId: contract.id, number: 'RA-2', date: '2026-08-10', lines: [line(200)] }, WHO);
    addBill(p, { contractId: contract.id, number: 'RA-3', date: '2026-08-28', lines: [line(120)] }, WHO);
    addBill(p, { contractId: contract.id, number: 'RA-4', date: '2026-09-02', lines: [line(70)] }, WHO);
    certifyLine(p, second.id, second.lines[0]!.id, { amount: 180, note: 'Quantity measured short' }, WHO);
    certifyBill(p, second.id, { signer: { email: 'surveyor@example.test', profession: 'Quantity Surveyor' }, certifiedOn: '2026-08-15' }, WHO);
    // RA-1 is July's and RA-4 September's. RA-3 is claimed and not yet certified.
    assert.deepEqual(costReportChanges(p, august.id)!.billed, { bills: 2, awaitingCertificate: 1, claimed: 320, certified: 180, difference: 140 });
  });
});

describe('a typed reason for a change', () => {
  it('is one line kept on the current report by package, and is shown on that package’s change', () => {
    const { p, august, row, ids } = twoMonths();
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1090 }, WHO);
    setCostReportChangeReason(p, august.id, ids.structure, '  Steel rate revised\n after the August order ', WHO);
    assert.deepEqual(costReportOf(p, august.id).changeReasons, { [ids.structure]: 'Steel rate revised after the August order' });
    const structure = changeOf(p, august.id, ids.structure);
    assert.equal(structure.reason, 'Steel rate revised after the August order');
    // The reason is beside the unexplained amount, not instead of it.
    assert.equal(structure.unexplained, 90);
    // Editing the row does not lose it.
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1095 }, WHO);
    assert.equal(changeOf(p, august.id, ids.structure).reason, 'Steel rate revised after the August order');
    setCostReportChangeReason(p, august.id, ids.structure, ' ', WHO);
    assert.ok(!('changeReasons' in costReportOf(p, august.id)));
  });

  it('can be given for a package that was removed, and is refused for no package, a long line or an issued report', () => {
    const { p, august, row, ids } = twoMonths();
    removeCostReportPackage(p, august.id, row('Lifts').id, WHO);
    setCostReportChangeReason(p, august.id, ids.lifts, 'Moved to the fit-out contract', WHO);
    assert.equal(changeOf(p, august.id, ids.lifts).reason, 'Moved to the fit-out contract');
    assert.throws(() => setCostReportChangeReason(p, august.id, 'wpk_nothing', 'Why', WHO), /No work package by that id\./);
    assert.throws(() => setCostReportChangeReason(p, august.id, ids.structure, 'x'.repeat(241), WHO), /one line of 240 characters at most/);
    issueCostReport(p, august.id, WHO);
    assert.throws(() => setCostReportChangeReason(p, august.id, ids.structure, 'Why', WHO), /issued/i);
    assert.equal(costReportOf(p, august.id).changeReasons![ids.lifts], 'Moved to the fit-out contract');
  });
});

describe('a Cost Report through a save and a reload', () => {
  let store: typeof import('../apps/api/src/store').store;
  let initStore: typeof import('../apps/api/src/store').initStore;

  before(async () => {
    process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-cost-compare-'));
    const mod = await import('../apps/api/src/store');
    store = mod.store;
    initStore = mod.initStore;
    await initStore();
  });

  after(() => {
    delete process.env.REALYTICA_DATA_DIR;
  });

  const reloaded = async (id: string): Promise<DdProject> => {
    await store.save();
    await initStore();
    return store.data.projects!.find((held) => held.id === id)!;
  };

  it('brings a typed reason back with the report it was typed on', async () => {
    const { p, august, row, ids } = twoMonths('RYT-CC2');
    updateCostReportRow(p, august.id, row('Structure').id, { anticipatedCost: 1090 }, WHO);
    setCostReportChangeReason(p, august.id, ids.structure, 'Steel rate revised', WHO);
    store.data.projects = [p];
    const back = await reloaded(p.id);
    assert.notEqual(back, p);
    assert.deepEqual(costReportOf(back, august.id).changeReasons, { [ids.structure]: 'Steel rate revised' });
    assert.equal(changeOf(back, august.id, ids.structure).reason, 'Steel rate revised');
  });

  it('loads a project saved before reasons were kept exactly as it was, and compares it', async () => {
    const p = project('RYT-CC3');
    const [pack] = addWorkPackages(p, [{ code: 'A', name: 'Structure', budget: 1000 }], WHO);
    // A report as it was written before this: these fields and no others.
    const kept = (id: string, label: string, month: string, anticipatedCost: number): CostReportPeriod => ({
      id,
      label,
      from: `2026-${month}-01`,
      to: `2026-${month}-30`,
      status: 'issued',
      rows: [{ id: `${id}_row`, workPackageId: pack!.id, code: 'A', name: 'Structure', budget: 1000, poIssued: 900, amountPaid: 100, anticipatedCost }],
      variations: [{ id: `${id}_var`, description: 'Extra piling', amount: 40, workPackageId: pack!.id }],
      createdAt: `2026-${month}-02T09:00:00.000Z`,
      createdBy: WHO,
      updatedAt: `2026-${month}-28T09:00:00.000Z`,
      updatedBy: WHO,
      issuedAt: `2026-${month}-28T09:00:00.000Z`,
      issuedBy: WHO,
    });
    const june = kept('crep_june', 'June 2026', '06', 1000);
    const september = kept('crep_september', 'September 2026', '09', 1100);
    p.costReports = [june, september];
    const written = JSON.parse(JSON.stringify(p.costReports)) as CostReportPeriod[];
    store.data.projects = [p];
    const back = await reloaded(p.id);
    assert.deepEqual(back.costReports, written);
    const structure = changeOf(back, september.id, pack!.id);
    assert.deepEqual(structure.figures.anticipatedCost, { previous: 1000, current: 1100, change: 100 });
    assert.equal(structure.unexplained, 60);
    assert.ok(!('reason' in structure));
  });

  it('loads a project that has no Cost Report at all', async () => {
    const p = project('RYT-CC4');
    assert.equal(p.costReports, undefined);
    store.data.projects = [p];
    const back = await reloaded(p.id);
    assert.equal(back.costReports, undefined);
  });
});
