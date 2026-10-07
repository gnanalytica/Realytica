/**
 * The cost register: the budget in work packages, the contracts that cover
 * them, a contractor's bills line by line, what the certifier passed, and
 * what was paid.
 *
 * Asked the way a cost consultant uses it, and then the way it could be
 * misused. Every refusal the register makes is here with the sentence a
 * person is given, because a refusal that does not say what to do next is a
 * dead end. A refused change must also leave the record as it was, so each
 * one is checked against what stood before (`refused`).
 *
 * The positions are held against arithmetic written out by hand
 * (`costExample` in `fixtures.ts`), not against another run of the same sums.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BILL_CORE_COLUMNS,
  addBill,
  addContract,
  addEvidence,
  addMilestones,
  addWorkPackages,
  billLineStatus,
  billPosition,
  certifyBill,
  certifyLine,
  contractPosition,
  costRegister,
  costSourceSaid,
  costSummary,
  createProject,
  defineCostColumn,
  moneySaid,
  packagePosition,
  recordPayment,
  removeBill,
  removeContract,
  removeWorkPackage,
  setBillLines,
  setCostForecast,
  standingCertification,
  updateBillLine,
  updateContract,
  updateWorkPackage,
  voidPayment,
  withdrawCertification,
  type BillLineInput,
  type DdProject,
} from '@realytica/shared';
import { COST_ACCOUNTS, COST_CERTIFIER, COST_LEAD, costExample } from './fixtures';

function bare(): DdProject {
  return createProject({ name: 'Cost test', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C1');
}

/** A project with one package, one contract that covers it, and nothing billed. */
function awarded() {
  const project = bare();
  const [pack] = addWorkPackages(project, [{ code: 'B', name: 'Structure', budget: 5_000_000 }], COST_LEAD);
  const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: [pack!.id], value: 4_500_000 }, COST_LEAD);
  return { project, pack: pack!, contract };
}

/** The same, with a bill of two lines on it: 6,00,000 and 4,00,000. */
function billed() {
  const { project, pack, contract } = awarded();
  const bill = addBill(
    project,
    {
      contractId: contract.id,
      number: 'RA-1',
      date: '2026-08-31',
      lines: [
        { item: '2.4', description: 'RCC M30 in raft foundation', workPackageId: pack.id, amount: 600_000, readBy: 'person' },
        { item: '2.6', description: 'RCC M30 in columns', workPackageId: pack.id, amount: 400_000, readBy: 'person' },
      ],
    },
    COST_LEAD,
  );
  return { project, pack, contract, bill };
}

/** The same, with both lines passed as claimed and the certificate issued. */
function certified() {
  const made = billed();
  for (const row of made.bill.lines) certifyLine(made.project, made.bill.id, row.id, { amount: row.amount }, COST_CERTIFIER);
  const certificate = certifyBill(made.project, made.bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' }, COST_CERTIFIER);
  return { ...made, certificate };
}

const line = (over: Partial<BillLineInput> = {}): BillLineInput => ({ item: '1', description: 'A line', amount: 1000, readBy: 'person', ...over });

/** The last line of the trail: what was done, to what kind of record, to which, and by whom. */
function lastAudit(project: DdProject): string[] {
  const event = project.audit.at(-1)!;
  return [event.action, event.entityType, event.entityId, event.actor];
}

/** A change that must be refused with this sentence, and must leave the register and the trail as they stood. */
function refused(project: DdProject, change: () => unknown, sentence: RegExp): void {
  const before = JSON.stringify([project.cost, project.audit.length]);
  assert.throws(change, sentence);
  assert.equal(JSON.stringify([project.cost, project.audit.length]), before, `a refusal changed the record: ${sentence}`);
}

describe('the cost register', () => {
  it('is empty until something is kept on it, and reading it changes nothing', () => {
    const project = bare();
    assert.deepEqual(costRegister(project), { workPackages: [], contracts: [], bills: [] });
    assert.deepEqual(costSummary(project), { committed: 0, claimed: 0, certified: 0, paid: 0, outstanding: 0, overpaid: 0, forecastOverBudget: false, certifiedOverBudget: false });
    assert.equal(project.cost, undefined, 'a read does not begin a register');
    refused(project, () => addWorkPackages(project, [{ name: '  ' }], COST_LEAD), /A work package needs a name\./);
    assert.equal(project.cost, undefined, 'nor does a change that was refused');
    assert.deepEqual(addWorkPackages(project, [], COST_LEAD), []);
    assert.equal(project.cost, undefined, 'nor adding nothing');
  });
});

describe('work packages', () => {
  it('are added together, each stamped with who and when', () => {
    const project = bare();
    const added = addWorkPackages(project, [{ code: ' A ', name: ' Earthwork ', budget: 1_000_000 }, { name: 'Finishes' }], COST_LEAD);
    assert.deepEqual(
      added.map((pack) => [pack.code, pack.name, pack.budget, pack.updatedBy]),
      [
        ['A', 'Earthwork', 1_000_000, COST_LEAD],
        [undefined, 'Finishes', undefined, COST_LEAD],
      ],
    );
    assert.ok(added.every((pack) => /^wpk_/.test(pack.id) && pack.createdAt === pack.updatedAt && !Number.isNaN(Date.parse(pack.createdAt))));
    assert.equal(new Set(added.map((pack) => pack.id)).size, 2);
    assert.deepEqual(costRegister(project).workPackages, added);
    assert.deepEqual(lastAudit(project), ['add_work_packages', 'work_package', project.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.newValue, 'A Earthwork, Finishes');
    // A budget of nothing is a budget: nothing is to be spent on it.
    assert.equal(addWorkPackages(project, [{ name: 'Provisional', budget: 0 }], COST_LEAD)[0]!.budget, 0);
  });

  it('are added all together or not at all', () => {
    const project = bare();
    refused(project, () => addWorkPackages(project, [{ name: 'Earthwork' }, { name: '' }], COST_LEAD), /A work package needs a name\./);
    assert.equal(project.cost, undefined, 'the good row was not kept without the bad one');
  });

  it('are refused a budget that is not an amount, and a milestone the project does not have', () => {
    const project = bare();
    for (const budget of [-1, Number.NaN, Number.POSITIVE_INFINITY, '100' as unknown as number]) {
      refused(project, () => addWorkPackages(project, [{ name: 'Earthwork', budget }], COST_LEAD), /A budget is an amount of money, zero or more\./);
    }
    refused(project, () => addWorkPackages(project, [{ name: 'Structure', milestoneId: 'mil_nothing' }], COST_LEAD), /No milestone by that id\./);
    const [milestone] = addMilestones(project, [{ name: 'Frame', weight: 1 }], COST_LEAD);
    assert.equal(addWorkPackages(project, [{ name: 'Structure', milestoneId: milestone!.id }], COST_LEAD)[0]!.milestoneId, milestone!.id);
  });

  it('say where their budget was read, on a paper the project holds', () => {
    const project = bare();
    refused(
      project,
      () => addWorkPackages(project, [{ name: 'Earthwork', source: { evidenceId: 'ev_nothing', page: 1 } }], COST_LEAD),
      /The paper a figure was read from is not on this project\. Upload it to the vault first\./,
    );
    const sheet = addEvidence(project, { title: 'Budget sheet.xlsx', kind: 'document' }, COST_LEAD);
    for (const page of [0, 1.5, -2]) {
      refused(project, () => addWorkPackages(project, [{ name: 'Earthwork', source: { evidenceId: sheet.id, page } }], COST_LEAD), /A page is a whole number, counted from 1\./);
    }
    const [pack] = addWorkPackages(project, [{ name: 'Earthwork', source: { evidenceId: sheet.id, sheet: ' Budget ', cell: ' C4 ', quote: '' } }], COST_LEAD);
    assert.deepEqual(pack!.source, { evidenceId: sheet.id, sheet: 'Budget', cell: 'C4' });
  });

  it('change one field at a time, and lose a field given as null', () => {
    const { project, pack } = awarded();
    const [milestone] = addMilestones(project, [{ name: 'Frame', weight: 1 }], COST_LEAD);
    const raised = updateWorkPackage(project, pack.id, { budget: 5_500_000, milestoneId: milestone!.id }, COST_CERTIFIER);
    assert.deepEqual(
      [raised.id, raised.code, raised.name, raised.budget, raised.milestoneId, raised.createdAt, raised.updatedBy],
      [pack.id, 'B', 'Structure', 5_500_000, milestone!.id, pack.createdAt, COST_CERTIFIER],
    );
    assert.deepEqual(lastAudit(project), ['update_work_package', 'work_package', pack.id, COST_CERTIFIER]);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['B Structure, ₹50,00,000', 'B Structure, ₹55,00,000']);

    const cleared = updateWorkPackage(project, pack.id, { budget: null, code: null, milestoneId: null }, COST_LEAD);
    assert.deepEqual(Object.keys(cleared).sort(), ['createdAt', 'id', 'name', 'updatedAt', 'updatedBy']);
    assert.equal(costRegister(project).workPackages[0], cleared, 'the register holds the package as it now is');

    refused(project, () => updateWorkPackage(project, pack.id, { name: ' ' }, COST_LEAD), /A work package needs a name\./);
    refused(project, () => updateWorkPackage(project, pack.id, { name: null }, COST_LEAD), /A work package needs a name\./);
    refused(project, () => updateWorkPackage(project, pack.id, { budget: -5 }, COST_LEAD), /A budget is an amount of money, zero or more\./);
    refused(project, () => updateWorkPackage(project, pack.id, { milestoneId: 'mil_nothing' }, COST_LEAD), /No milestone by that id\./);
    refused(project, () => updateWorkPackage(project, 'wpk_nothing', { name: 'Anything' }, COST_LEAD), /No work package by that id\./);
  });

  it('are still changed once the paper or the milestone behind them has left the project', () => {
    const project = bare();
    const sheet = addEvidence(project, { title: 'Budget sheet.xlsx', kind: 'document' }, COST_LEAD);
    const [milestone] = addMilestones(project, [{ name: 'Frame', weight: 1 }], COST_LEAD);
    const source = { evidenceId: sheet.id, sheet: 'Budget', cell: 'C5' };
    const [pack] = addWorkPackages(project, [{ name: 'Structure', budget: 5_000_000, source, milestoneId: milestone!.id }], COST_LEAD);
    // The paper is taken off the register and the milestone removed, as their own pages allow.
    project.evidence = project.evidence.filter((row) => row.id !== sheet.id);
    project.milestones = [];

    // What the package already says is left as it stands, and is no reason to refuse a change to something else.
    const raised = updateWorkPackage(project, pack!.id, { budget: 5_500_000 }, COST_LEAD);
    assert.deepEqual([raised.budget, raised.source, raised.milestoneId], [5_500_000, source, milestone!.id]);
    // What is named afresh is asked about afresh.
    refused(project, () => updateWorkPackage(project, pack!.id, { source: { ...source, cell: 'C6' } }, COST_LEAD), /The paper a figure was read from is not on this project\./);
    refused(project, () => updateWorkPackage(project, pack!.id, { milestoneId: 'mil_another' }, COST_LEAD), /No milestone by that id\./);
  });

  it('stay while a contract covers them or a bill line prices them', () => {
    const { project, pack, contract, bill } = billed();
    refused(project, () => removeWorkPackage(project, pack.id, COST_LEAD), /The contract with Sharma Constructions covers this work package\. Take it off the contract first\./);
    // The contract goes on covering it while one of its bills prices it, so the way out starts at the lines.
    refused(
      project,
      () => updateContract(project, contract.id, { workPackageIds: [] }, COST_LEAD),
      /A line of bill RA-1 prices a work package this would take off the contract\. Move the line first\./,
    );

    // A register other code wrote could hold a line whose contract no longer names its package. The line alone keeps the package.
    const stored = costRegister(project).contracts[0]!;
    stored.workPackageIds = [];
    refused(project, () => removeWorkPackage(project, pack.id, COST_LEAD), /A line of bill RA-1 prices this work package\. Move the line to another package first\./);
    stored.workPackageIds = [pack.id];

    for (const row of bill.lines) updateBillLine(project, bill.id, row.id, { workPackageId: null }, COST_LEAD);
    updateContract(project, contract.id, { workPackageIds: [] }, COST_LEAD);
    removeWorkPackage(project, pack.id, COST_LEAD);
    assert.deepEqual(costRegister(project).workPackages, []);
    assert.deepEqual(lastAudit(project), ['remove_work_package', 'work_package', pack.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.oldValue, 'B Structure');
    refused(project, () => removeWorkPackage(project, pack.id, COST_LEAD), /No work package by that id\./);
  });
});

describe('contracts', () => {
  it('name a contractor, the work, a value above zero, and packages of this project', () => {
    const project = bare();
    const [pack] = addWorkPackages(project, [{ name: 'Structure' }], COST_LEAD);
    const contract = addContract(
      project,
      { contractor: ' Sharma Constructions ', title: ' Civil works ', reference: ' WO-CIV-014 ', workPackageIds: [pack!.id, pack!.id], value: 4_500_000, retentionPercent: 5 },
      COST_LEAD,
    );
    assert.deepEqual(
      [contract.contractor, contract.title, contract.reference, contract.workPackageIds, contract.value, contract.retentionPercent, contract.updatedBy],
      ['Sharma Constructions', 'Civil works', 'WO-CIV-014', [pack!.id], 4_500_000, 5, COST_LEAD],
    );
    assert.match(contract.id, /^ctr_/);
    assert.deepEqual(lastAudit(project), ['add_contract', 'contract', contract.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.newValue, 'Sharma Constructions: Civil works, ₹45,00,000');
    // Work can be awarded before the budget is split: such a contract covers nothing yet.
    assert.deepEqual(addContract(project, { contractor: 'Lakshmi Interiors', title: 'Finishes', value: 800_000 }, COST_LEAD).workPackageIds, []);

    const good = { contractor: 'Acme Lifts', title: 'Lifts', value: 100 };
    refused(project, () => addContract(project, { ...good, contractor: ' ' }, COST_LEAD), /A contract names its contractor and says what the work is\./);
    refused(project, () => addContract(project, { ...good, title: '' }, COST_LEAD), /A contract names its contractor and says what the work is\./);
    for (const value of [0, -1, Number.NaN]) refused(project, () => addContract(project, { ...good, value }, COST_LEAD), /A contract’s value is an amount of money above zero\./);
    refused(
      project,
      () => addContract(project, { ...good, workPackageIds: [pack!.id, 'wpk_nothing'] }, COST_LEAD),
      /A contract covers work packages of this project\. One of those named is not one of them\./,
    );
    for (const retentionPercent of [-1, 100.5, Number.NaN]) {
      refused(project, () => addContract(project, { ...good, retentionPercent }, COST_LEAD), /Retention is a percentage between 0 and 100\./);
    }
    for (const retentionPercent of [0, 100]) assert.equal(addContract(project, { ...good, retentionPercent }, COST_LEAD).retentionPercent, retentionPercent);
  });

  it('are changed under the same rules', () => {
    const { project, pack, contract } = awarded();
    const [other] = addWorkPackages(project, [{ name: 'Earthwork' }], COST_LEAD);
    const next = updateContract(project, contract.id, { value: 5_000_000, workPackageIds: [pack.id, other!.id], retentionPercent: 10, reference: 'WO-2' }, COST_CERTIFIER);
    assert.deepEqual(
      [next.id, next.contractor, next.title, next.value, next.workPackageIds, next.retentionPercent, next.reference, next.createdAt, next.updatedBy],
      [contract.id, 'Sharma Constructions', 'Civil works', 5_000_000, [pack.id, other!.id], 10, 'WO-2', contract.createdAt, COST_CERTIFIER],
    );
    assert.equal(costRegister(project).contracts[0], next, 'the register holds the contract as it now is');
    assert.deepEqual(lastAudit(project), ['update_contract', 'contract', contract.id, COST_CERTIFIER]);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['Sharma Constructions: Civil works, ₹45,00,000', 'Sharma Constructions: Civil works, ₹50,00,000']);
    const cleared = updateContract(project, contract.id, { retentionPercent: null, reference: null }, COST_LEAD);
    assert.deepEqual(['retentionPercent' in cleared, 'reference' in cleared], [false, false]);

    refused(project, () => updateContract(project, contract.id, { value: 0 }, COST_LEAD), /A contract’s value is an amount of money above zero\./);
    refused(project, () => updateContract(project, contract.id, { contractor: '' }, COST_LEAD), /A contract names its contractor and says what the work is\./);
    refused(project, () => updateContract(project, contract.id, { title: null }, COST_LEAD), /A contract names its contractor and says what the work is\./);
    refused(project, () => updateContract(project, contract.id, { workPackageIds: ['wpk_nothing'] }, COST_LEAD), /One of those named is not one of them\./);
    refused(project, () => updateContract(project, contract.id, { retentionPercent: 101 }, COST_LEAD), /Retention is a percentage between 0 and 100\./);
    refused(project, () => updateContract(project, 'ctr_nothing', { value: 1 }, COST_LEAD), /No contract by that id\./);
  });
});

describe('the project’s own columns', () => {
  it('are defined once each, under a key no other column has', () => {
    const project = bare();
    const column = defineCostColumn(project, { key: ' boqRef ', label: ' BOQ ref ', kind: 'text' }, COST_LEAD);
    assert.deepEqual(column, { key: 'boqRef', label: 'BOQ ref', kind: 'text' });
    assert.deepEqual(costRegister(project).extraColumns, [column]);
    assert.deepEqual(lastAudit(project), ['define_cost_column', 'cost', project.id, COST_LEAD]);

    refused(project, () => defineCostColumn(project, { key: 'BOQREF', label: 'Again', kind: 'text' }, COST_LEAD), /This project already has a column with the key “BOQREF”\./);
    // The core columns are fields of every line, and no column of the project's may take one's place.
    assert.deepEqual(
      BILL_CORE_COLUMNS.map((core) => [core.key, core.label]),
      [
        ['item', 'Item'],
        ['description', 'Description'],
        ['unit', 'Unit'],
        ['rate', 'Rate'],
        ['quantityToDate', 'Quantity to date'],
        ['amountToDate', 'Amount to date'],
        ['previousAmount', 'Previous amount'],
        ['amount', 'This bill'],
      ],
    );
    for (const core of BILL_CORE_COLUMNS) {
      refused(project, () => defineCostColumn(project, { key: core.key, label: 'Mine', kind: 'money' }, COST_LEAD), /Every bill line already has “.+”\. Give the column another key\./);
    }
    refused(project, () => defineCostColumn(project, { key: 'Amount', label: 'Mine', kind: 'money' }, COST_LEAD), /Every bill line already has “Amount”\. Give the column another key\./);
    refused(project, () => defineCostColumn(project, { key: '', label: 'Mine', kind: 'money' }, COST_LEAD), /A column needs a key and the heading it is shown under\./);
    refused(project, () => defineCostColumn(project, { key: 'mine', label: ' ', kind: 'money' }, COST_LEAD), /A column needs a key and the heading it is shown under\./);
    refused(project, () => defineCostColumn(project, { key: 'mine', label: 'Mine', kind: 'date' as never }, COST_LEAD), /A column holds text, a number or money\./);
  });
});

describe('a bill', () => {
  it('is taken in under a contract, with its lines as they were read', () => {
    const { project, pack, contract } = awarded();
    const paper = addEvidence(project, { title: 'RA Bill 1.xlsx', kind: 'document' }, COST_LEAD);
    defineCostColumn(project, { key: 'boqRef', label: 'BOQ ref', kind: 'text' }, COST_LEAD);
    const bill = addBill(
      project,
      {
        contractId: contract.id,
        number: ' RA-1 ',
        date: '2026-08-31',
        periodFrom: '2026-08-01',
        periodTo: '2026-08-31',
        statedTotal: 575_000,
        evidenceId: paper.id,
        lines: [
          {
            item: ' 2.4 ',
            description: ' RCC M30 in raft foundation ',
            workPackageId: pack.id,
            unit: ' cum ',
            rate: 3000,
            quantityToDate: 200,
            amountToDate: 600_000,
            previousAmount: 0,
            amount: 600_000,
            variation: false,
            extra: { boqRef: 'S-04' },
            source: { evidenceId: paper.id, sheet: 'RA 1', cell: 'H19' },
            readBy: 'sheet',
          },
          // A credit is a line too: what a line claims may be less than nothing.
          { description: 'Credit for cement the owner supplied', amount: -25_000, readBy: 'person' },
        ],
      },
      COST_LEAD,
    );
    assert.match(bill.id, /^bill_/);
    assert.deepEqual(
      [bill.contractId, bill.number, bill.date, bill.periodFrom, bill.periodTo, bill.statedTotal, bill.evidenceId, bill.payments, bill.certifications, bill.createdBy],
      [contract.id, 'RA-1', '2026-08-31', '2026-08-01', '2026-08-31', 575_000, paper.id, [], [], COST_LEAD],
    );
    const [raft, credit] = bill.lines;
    assert.deepEqual(raft, {
      id: raft!.id,
      item: '2.4',
      description: 'RCC M30 in raft foundation',
      workPackageId: pack.id,
      unit: 'cum',
      rate: 3000,
      quantityToDate: 200,
      amountToDate: 600_000,
      previousAmount: 0,
      amount: 600_000,
      extra: { boqRef: 'S-04' },
      source: { evidenceId: paper.id, sheet: 'RA 1', cell: 'H19' },
      readBy: 'sheet',
    });
    assert.deepEqual(credit, { id: credit!.id, item: '', description: 'Credit for cement the owner supplied', amount: -25_000, readBy: 'person' });
    for (const core of BILL_CORE_COLUMNS) assert.ok(core.key in raft!, `a line has no ${core.key}`);
    assert.ok(/^line_/.test(raft!.id) && raft!.id !== credit!.id);
    assert.equal(costRegister(project).bills[0], bill);
    assert.deepEqual(lastAudit(project), ['add_bill', 'bill', bill.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.newValue, 'Sharma Constructions bill RA-1, 2026-08-31: 2 lines, ₹5,75,000');
  });

  it('gives every line an id of its own, however many are read at once', () => {
    // The lines of one bill are made in the same millisecond, and each is a node of the graph under its id.
    const { project, contract } = awarded();
    const bill = addBill(project, { contractId: contract.id, number: 'RA-9', date: '2026-08-31', lines: Array.from({ length: 2000 }, (_, i) => line({ item: String(i + 1) })) }, COST_LEAD);
    assert.equal(new Set(bill.lines.map((row) => row.id)).size, 2000);
  });

  it('is refused when its contract, its number or its date cannot be kept', () => {
    const { project, contract } = awarded();
    const other = addContract(project, { contractor: 'Lakshmi Interiors', title: 'Finishes', value: 800_000 }, COST_LEAD);
    const input = { contractId: contract.id, number: 'RA-1', date: '2026-08-31' };
    addBill(project, input, COST_LEAD);

    refused(project, () => addBill(project, { ...input, contractId: 'ctr_nothing' }, COST_LEAD), /No contract by that id\./);
    refused(project, () => addBill(project, { ...input, number: '  ' }, COST_LEAD), /A bill needs its number\./);
    // The same number is the same bill, however it was typed.
    for (const number of ['RA-1', ' ra-1 ', 'Ra-1']) {
      refused(project, () => addBill(project, { ...input, number }, COST_LEAD), /Sharma Constructions already has a bill numbered .+ under this contract\./);
    }
    // Another contractor numbers its own bills.
    assert.equal(addBill(project, { ...input, contractId: other.id }, COST_LEAD).number, 'RA-1');

    const next = { ...input, number: 'RA-2' };
    for (const date of ['31-08-2026', '2026-8-31', '', '2026-08-31T00:00:00Z']) {
      refused(project, () => addBill(project, { ...next, date }, COST_LEAD), /A bill needs its date: a day of the calendar, as YYYY-MM-DD\./);
    }
    refused(project, () => addBill(project, { ...next, periodFrom: 'August' }, COST_LEAD), /The period a bill covers is two days of the calendar, each as YYYY-MM-DD\./);
    refused(project, () => addBill(project, { ...next, periodFrom: '2026-09-01', periodTo: '2026-08-31' }, COST_LEAD), /The period a bill covers ends on or after the day it starts\./);
    refused(project, () => addBill(project, { ...next, statedTotal: Number.NaN }, COST_LEAD), /The total a bill states is a number\./);
    refused(project, () => addBill(project, { ...next, evidenceId: 'ev_nothing' }, COST_LEAD), /Upload the bill to the vault first\./);
  });

  it('is refused when one of its lines cannot be kept, and none of it is kept then', () => {
    const { project, pack, contract } = awarded();
    const input = { contractId: contract.id, number: 'RA-1', date: '2026-08-31' };
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number, '1000' as unknown as number]) {
      refused(project, () => addBill(project, { ...input, lines: [line(), line({ amount })] }, COST_LEAD), /Each line of a bill needs the amount it claims, as a number\./);
    }
    refused(project, () => addBill(project, { ...input, lines: [line({ rate: Number.NaN })] }, COST_LEAD), /A line’s rate, its quantity and its amounts are numbers\./);
    refused(project, () => addBill(project, { ...input, lines: [line({ item: ' ', description: '' })] }, COST_LEAD), /A bill line needs an item number or a description\./);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'ocr' as never })] }, COST_LEAD), /A line says who read it: a person, a sheet or a model\./);
    refused(project, () => addBill(project, { ...input, lines: [line({ source: { evidenceId: 'ev_nothing', page: 2 } })] }, COST_LEAD), /The paper a figure was read from is not on this project\./);

    // A line prices a package of its own contract, or none.
    const [elsewhere] = addWorkPackages(project, [{ name: 'Finishes' }], COST_LEAD);
    refused(
      project,
      () => addBill(project, { ...input, lines: [line({ workPackageId: elsewhere!.id })] }, COST_LEAD),
      /A line prices a work package its contract covers\. The contract with Sharma Constructions does not cover that one\./,
    );
    refused(project, () => addBill(project, { ...input, lines: [line({ workPackageId: 'wpk_nothing' })] }, COST_LEAD), /does not cover that one\./);
    assert.deepEqual(
      addBill(project, { ...input, lines: [line({ workPackageId: pack.id }), line()] }, COST_LEAD).lines.map((row) => row.workPackageId),
      [pack.id, undefined],
    );

    // A value in one of the project's own columns needs the column.
    const more = { ...input, number: 'RA-2', lines: [line({ extra: { boqRef: 'S-04' } })] };
    refused(project, () => addBill(project, more, COST_LEAD), /“boqRef” is not a column this project has defined\./);
    defineCostColumn(project, { key: 'boqRef', label: 'BOQ ref', kind: 'text' }, COST_LEAD);
    assert.deepEqual(addBill(project, more, COST_LEAD).lines[0]!.extra, { boqRef: 'S-04' });
  });
});

describe('a bill’s lines', () => {
  it('are replaced when the bill is read again, and are then undecided', () => {
    const { project, pack, bill } = billed();
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 600_000 }, COST_CERTIFIER);
    const old = bill.lines.map((row) => row.id);
    const sheet = addEvidence(project, { title: 'RA Bill 1.xlsx', kind: 'document' }, COST_LEAD);
    const read = line({ item: '2.4', description: 'RCC M30 in raft foundation', workPackageId: pack.id, amount: 590_000, source: { evidenceId: sheet.id, sheet: 'RA 1', cell: 'H19' }, readBy: 'sheet' });

    assert.equal(setBillLines(project, bill.id, [read], COST_LEAD), bill);
    assert.deepEqual(
      bill.lines.map((row) => [row.description, row.amount, row.readBy, row.certified]),
      [['RCC M30 in raft foundation', 590_000, 'sheet', undefined]],
    );
    assert.ok(!old.includes(bill.lines[0]!.id), 'a line read again is a new line');
    assert.deepEqual(lastAudit(project), ['set_bill_lines', 'bill', bill.id, COST_LEAD]);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['2 lines, ₹10,00,000', '1 line, ₹5,90,000']);

    refused(project, () => setBillLines(project, bill.id, [line(), line({ amount: Number.NaN })], COST_LEAD), /Each line of a bill needs the amount it claims, as a number\./);
    refused(project, () => setBillLines(project, 'bill_nothing', [], COST_LEAD), /No bill by that id\./);
  });

  it('are fixed while a certificate stands, and open again once it is withdrawn', () => {
    const { project, bill } = certified();
    const fixed = /A certificate stands on this bill\. Withdraw it before changing or deciding its lines\./;
    refused(project, () => setBillLines(project, bill.id, [line()], COST_LEAD), fixed);
    refused(project, () => updateBillLine(project, bill.id, bill.lines[0]!.id, { amount: 1 }, COST_LEAD), fixed);
    refused(project, () => certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 1, note: 'Looked at again' }, COST_CERTIFIER), fixed);

    withdrawCertification(project, bill.id, COST_CERTIFIER);
    assert.equal(updateBillLine(project, bill.id, bill.lines[0]!.id, { unit: 'cum' }, COST_LEAD).unit, 'cum');
    assert.equal(certifyLine(project, bill.id, bill.lines[1]!.id, { amount: 1, note: 'Looked at again' }, COST_CERTIFIER).certified?.amount, 1);
    assert.equal(setBillLines(project, bill.id, [line()], COST_LEAD).lines.length, 1);
  });

  it('are still changed once the paper they were read from has left the project, and so is their contract', () => {
    const { project, contract } = awarded();
    const paper = addEvidence(project, { title: 'RA Bill 1.pdf', kind: 'document' }, COST_LEAD);
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [line({ source: { evidenceId: paper.id, page: 2 }, readBy: 'model' })] }, COST_LEAD);
    updateContract(project, contract.id, { source: { evidenceId: paper.id, page: 1 } }, COST_LEAD);
    project.evidence = project.evidence.filter((row) => row.id !== paper.id);

    assert.deepEqual(updateBillLine(project, bill.id, bill.lines[0]!.id, { unit: 'cum' }, COST_LEAD).source, { evidenceId: paper.id, page: 2 });
    assert.deepEqual(updateContract(project, contract.id, { value: 5_000_000 }, COST_LEAD).source, { evidenceId: paper.id, page: 1 });
    refused(project, () => updateBillLine(project, bill.id, bill.lines[0]!.id, { source: { evidenceId: paper.id, page: 3 } }, COST_LEAD), /The paper a figure was read from is not on this project\./);
    refused(project, () => updateContract(project, contract.id, { source: { evidenceId: paper.id, page: 3 } }, COST_LEAD), /The paper a figure was read from is not on this project\./);
  });

  it('are changed one at a time, and the trail says what moved', () => {
    const { project, pack, contract, bill } = billed();
    const [raft, columns] = bill.lines;

    const described = updateBillLine(project, bill.id, raft!.id, { unit: 'cum', rate: 3000, quantityToDate: 200, variation: true }, COST_LEAD);
    assert.deepEqual([described.id, described.unit, described.rate, described.quantityToDate, described.variation], [raft!.id, 'cum', 3000, 200, true]);
    assert.equal(bill.lines[0], described, 'the bill holds the line as it now is');
    assert.deepEqual(lastAudit(project), ['update_bill_line', 'bill_line', raft!.id, COST_LEAD]);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['₹6,00,000, B Structure', '₹6,00,000, B Structure. Changed: unit, rate, quantity to date, variation']);

    const reclaimed = updateBillLine(project, bill.id, columns!.id, { amount: 450_000 }, COST_LEAD);
    assert.equal(reclaimed.amount, 450_000);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['₹4,00,000, B Structure', '₹4,50,000, B Structure. Changed: amount claimed']);

    // A line moved to another work package claims what it claimed. The trail says where it was and where it is.
    const [earthwork] = addWorkPackages(project, [{ code: 'A', name: 'Earthwork' }], COST_LEAD);
    updateContract(project, contract.id, { workPackageIds: [pack.id, earthwork!.id] }, COST_LEAD);
    assert.equal(updateBillLine(project, bill.id, raft!.id, { workPackageId: earthwork!.id }, COST_LEAD).workPackageId, earthwork!.id);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['₹6,00,000, B Structure', '₹6,00,000, A Earthwork. Changed: work package']);

    const cleared = updateBillLine(project, bill.id, raft!.id, { workPackageId: null, unit: null, variation: null }, COST_LEAD);
    assert.deepEqual(['workPackageId' in cleared, 'unit' in cleared, 'variation' in cleared, cleared.rate], [false, false, false, 3000]);

    refused(project, () => updateBillLine(project, bill.id, 'line_nothing', { amount: 1 }, COST_LEAD), /No line by that id on this bill\./);
    refused(project, () => updateBillLine(project, bill.id, raft!.id, { amount: Number.NaN }, COST_LEAD), /Each line of a bill needs the amount it claims, as a number\./);
    refused(project, () => updateBillLine(project, bill.id, raft!.id, { workPackageId: 'wpk_nothing' }, COST_LEAD), /does not cover that one\./);
    refused(project, () => updateBillLine(project, bill.id, raft!.id, { item: null, description: null }, COST_LEAD), /A bill line needs an item number or a description\./);
    refused(project, () => updateBillLine(project, 'bill_nothing', raft!.id, { amount: 1 }, COST_LEAD), /No bill by that id\./);
  });

  it('keep what was passed for them only while they are the same claim', () => {
    // The raft, 200 cum at 3,000, claimed at 6,00,000. The certifier passes 5,40,000 for 180 cum and says why.
    const fresh = () => {
      const project = bare();
      const [earthwork, structure] = addWorkPackages(project, [{ code: 'A', name: 'Earthwork' }, { code: 'B', name: 'Structure' }], COST_LEAD);
      const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: [earthwork!.id, structure!.id], value: 4_500_000 }, COST_LEAD);
      const bill = addBill(
        project,
        { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [{ item: '2.4', description: 'RCC M30 in raft', workPackageId: structure!.id, unit: 'cum', rate: 3000, quantityToDate: 200, amount: 600_000, readBy: 'person' }] },
        COST_LEAD,
      );
      certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 540_000, quantity: 180, note: '20 cum not yet cast' }, COST_CERTIFIER);
      return { project, bill, line: bill.lines[0]!, earthwork: earthwork!, structure: structure! };
    };
    const signed = { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' };

    // Somebody else then rewrites everything but the amount. It is another line, and nothing the certifier looked at.
    const rewritten = fresh();
    const other = updateBillLine(rewritten.project, rewritten.bill.id, rewritten.line.id, { item: '1.1', description: 'Excavation in soft rock', workPackageId: rewritten.earthwork.id, unit: 'sqm', rate: 1, quantityToDate: 5 }, COST_LEAD);
    assert.deepEqual([other.amount, other.certified], [600_000, undefined], 'the amount is as it was, and the decision is gone');
    assert.equal(billLineStatus(other, rewritten.bill), 'claimed');
    assert.match(rewritten.project.audit.at(-1)!.newValue ?? '', /\. What qs@firm\.in passed for it no longer stands$/, 'and the trail says so');
    // So it cannot be certified under the certifier's name until it is decided again.
    refused(rewritten.project, () => certifyBill(rewritten.project, rewritten.bill.id, signed, COST_CERTIFIER), /One line of this bill has not been decided yet\. Certify every line first\./);

    // Each of what a certifier looks at, changed alone, does the same.
    for (const patch of [{ amount: 590_000 }, { item: '2.5' }, { description: 'RCC M30 in raft, pour 2' }, { unit: 'sqm' }, { unit: null }, { rate: 3100 }, { quantityToDate: 190 }] as const) {
      const { project, bill, line } = fresh();
      assert.equal(updateBillLine(project, bill.id, line.id, patch, COST_LEAD).certified, undefined, JSON.stringify(patch));
    }

    // The same work put against another package is the same claim: the amount and the reason are still true of it.
    const moved = fresh();
    const elsewhere = updateBillLine(moved.project, moved.bill.id, moved.line.id, { workPackageId: moved.earthwork.id }, COST_LEAD);
    assert.deepEqual([elsewhere.workPackageId, elsewhere.certified?.amount, elsewhere.certified?.note, elsewhere.certified?.by], [moved.earthwork.id, 540_000, '20 cum not yet cast', COST_CERTIFIER]);
    assert.doesNotMatch(moved.project.audit.at(-1)!.newValue ?? '', /no longer stands/);
    // And so is one that only gained what is beside the claim: where it was read, its figures to date, that it is a variation.
    const beside = fresh();
    for (const patch of [{ amountToDate: 600_000, previousAmount: 0 }, { variation: true }, {}, { item: '2.4', rate: 3000 }] as const) {
      assert.equal(updateBillLine(beside.project, beside.bill.id, beside.line.id, patch, COST_LEAD).certified?.amount, 540_000, JSON.stringify(patch));
    }
    assert.equal(certifyBill(beside.project, beside.bill.id, signed, COST_CERTIFIER).gross, 540_000);
  });
});

describe('deciding a line', () => {
  const signed = { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' };

  it('passes it as claimed, or at another amount with the reason', () => {
    const { project, bill } = billed();
    const [raft, columns] = bill.lines;
    const passed = certifyLine(project, bill.id, raft!.id, { amount: 600_000 }, COST_CERTIFIER);
    assert.deepEqual([passed.certified?.amount, passed.certified?.note, passed.certified?.by], [600_000, undefined, COST_CERTIFIER]);
    assert.ok(!Number.isNaN(Date.parse(passed.certified!.at)));
    assert.deepEqual(lastAudit(project), ['certify_line', 'bill_line', raft!.id, COST_CERTIFIER]);
    assert.equal(project.audit.at(-1)!.newValue, '₹6,00,000 of ₹6,00,000 claimed');

    // An adjustment says why.
    const why = /Say why the amount passed differs from the amount claimed\./;
    refused(project, () => certifyLine(project, bill.id, columns!.id, { amount: 350_000 }, COST_CERTIFIER), why);
    refused(project, () => certifyLine(project, bill.id, columns!.id, { amount: 350_000, note: '   ' }, COST_CERTIFIER), why);
    refused(project, () => certifyLine(project, bill.id, columns!.id, { amount: 0 }, COST_CERTIFIER), why);
    refused(project, () => certifyLine(project, bill.id, columns!.id, { amount: 400_000.01 }, COST_CERTIFIER), why);
    const adjusted = certifyLine(project, bill.id, columns!.id, { amount: 350_000, quantity: 87.5, note: ' Two columns are not cast ' }, COST_CERTIFIER);
    assert.deepEqual(adjusted.certified, { amount: 350_000, quantity: 87.5, note: 'Two columns are not cast', by: COST_CERTIFIER, at: adjusted.certified!.at });
    assert.equal(project.audit.at(-1)!.newValue, '₹3,50,000 of ₹4,00,000 claimed: Two columns are not cast');

    // What is passed is kept to the paisa. Less than half a paisa from the claim is the claim, and needs no reason.
    assert.equal(certifyLine(project, bill.id, raft!.id, { amount: 600_000.004 }, COST_CERTIFIER).certified?.amount, 600_000);
    // Nothing at all, with the reason, is a decision. And a line decided again is still one line decided.
    assert.equal(certifyLine(project, bill.id, columns!.id, { amount: 0, note: 'Not started' }, COST_CERTIFIER).certified?.amount, 0);
    assert.equal(billPosition(bill).decided, 2);

    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, '600000' as unknown as number]) {
      refused(project, () => certifyLine(project, bill.id, raft!.id, { amount, note: 'Any reason' }, COST_CERTIFIER), /What is passed for a line is an amount of money, as a number\./);
    }
    refused(project, () => certifyLine(project, bill.id, raft!.id, { amount: 600_000, quantity: Number.NaN }, COST_CERTIFIER), /The quantity passed for a line is a number\./);
    refused(project, () => certifyLine(project, bill.id, 'line_nothing', { amount: 1 }, COST_CERTIFIER), /No line by that id on this bill\./);
    refused(project, () => certifyLine(project, 'bill_nothing', raft!.id, { amount: 1 }, COST_CERTIFIER), /No bill by that id\./);
  });

  it('leaves it decided, and certified only while the bill’s certificate stands', () => {
    const { project, bill } = billed();
    const [raft, columns] = bill.lines;
    const stands = () => bill.lines.map((row) => billLineStatus(row, bill));
    assert.deepEqual(stands(), ['claimed', 'claimed']);
    certifyLine(project, bill.id, raft!.id, { amount: 600_000 }, COST_CERTIFIER);
    assert.deepEqual(stands(), ['decided', 'claimed'], 'what was passed for one line certifies nothing yet');
    certifyLine(project, bill.id, columns!.id, { amount: 350_000, note: 'Two columns are not cast' }, COST_CERTIFIER);
    assert.deepEqual(stands(), ['decided', 'decided']);
    certifyBill(project, bill.id, signed, COST_CERTIFIER);
    assert.deepEqual(stands(), ['certified', 'adjusted'], 'as claimed, and at another amount');
    withdrawCertification(project, bill.id, COST_CERTIFIER);
    assert.deepEqual(stands(), ['decided', 'decided'], 'a certificate that was withdrawn certifies nothing');
  });

  it('passes a credit as claimed, and carries it through to the certificate', () => {
    // 6,00,000 of work, less 25,000 for cement the owner supplied.
    const { project, pack, contract } = awarded();
    const bill = addBill(
      project,
      {
        contractId: contract.id,
        number: 'RA-1',
        date: '2026-08-31',
        lines: [
          { item: '2.4', description: 'RCC M30 in raft foundation', workPackageId: pack.id, amount: 600_000, readBy: 'person' },
          { description: 'Credit for cement the owner supplied', workPackageId: pack.id, unit: 'bag', quantityToDate: -50, amount: -25_000, readBy: 'person' },
        ],
      },
      COST_LEAD,
    );
    const [work, credit] = bill.lines;
    certifyLine(project, bill.id, work!.id, { amount: 600_000 }, COST_CERTIFIER);
    // A credit passed as claimed is passed at what it claims, and that needs no reason.
    const passed = certifyLine(project, bill.id, credit!.id, { amount: -25_000, quantity: -50 }, COST_CERTIFIER);
    assert.deepEqual([passed.certified?.amount, passed.certified?.quantity, passed.certified?.note], [-25_000, -50, undefined]);
    assert.equal(project.audit.at(-1)!.newValue, '−₹25,000 of −₹25,000 claimed');
    // Passed at any other amount it says why, like every adjustment.
    const why = /Say why the amount passed differs from the amount claimed\./;
    refused(project, () => certifyLine(project, bill.id, credit!.id, { amount: -20_000 }, COST_CERTIFIER), why);
    refused(project, () => certifyLine(project, bill.id, credit!.id, { amount: 0 }, COST_CERTIFIER), why);
    refused(project, () => certifyLine(project, bill.id, credit!.id, { amount: 25_000 }, COST_CERTIFIER), why);

    // 6,00,000 − 25,000 = 5,75,000. Less 5% retention, 28,750: 5,46,250 to pay.
    const certificate = certifyBill(project, bill.id, { ...signed, deductions: [{ kind: 'retention', amount: 28_750 }] }, COST_CERTIFIER);
    assert.deepEqual([certificate.gross, certificate.net], [575_000, 546_250]);
    assert.deepEqual(bill.lines.map((row) => billLineStatus(row, bill)), ['certified', 'certified']);
    assert.deepEqual(billPosition(bill), { claimed: 575_000, lines: 2, decided: 2, gross: 575_000, net: 546_250, paid: 0, outstanding: 546_250, overpaid: 0, status: 'certified' });
    assert.deepEqual(packagePosition(project, pack.id), { budget: 5_000_000, claimed: 575_000, certified: 575_000, balance: 4_425_000 });
    assert.deepEqual([contractPosition(project, contract.id).certified, costSummary(project).certified], [575_000, 575_000]);
  });

  it('keeps the floor on the certificate: the lines of a bill are not certified below nothing', () => {
    const { project, contract } = awarded();
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [line({ amount: 10_000 }), line({ description: 'Credit for cement the owner supplied', amount: -25_000 })] }, COST_LEAD);
    for (const row of bill.lines) certifyLine(project, bill.id, row.id, { amount: row.amount }, COST_CERTIFIER);
    refused(
      project,
      () => certifyBill(project, bill.id, signed, COST_CERTIFIER),
      /What was passed on this bill comes to −₹15,000\. A certificate is for nothing or more: the credits on it are larger than the work\./,
    );
    // The credit cut back to the work it is set against, with the reason, and the bill certifies at nothing.
    certifyLine(project, bill.id, bill.lines[1]!.id, { amount: -10_000, note: 'Only the cement used so far' }, COST_CERTIFIER);
    const certificate = certifyBill(project, bill.id, signed, COST_CERTIFIER);
    assert.deepEqual([certificate.gross, certificate.net], [0, 0]);
    assert.deepEqual(bill.lines.map((row) => billLineStatus(row, bill)), ['certified', 'adjusted']);
  });
});

describe('the certificate for a bill', () => {
  const signer = { email: COST_CERTIFIER, name: 'R. Menon', profession: 'Quantity Surveyor', registration: 'RICS 1234567' };
  const input = { signer, certifiedOn: '2026-09-05' };

  it('is issued once every line is decided, for what was passed less the deductions', () => {
    const { project, bill } = billed();
    const [raft, columns] = bill.lines;
    refused(project, () => certifyBill(project, bill.id, input, COST_CERTIFIER), /2 lines of this bill have not been decided yet\. Certify every line first\./);
    certifyLine(project, bill.id, raft!.id, { amount: 600_000 }, COST_CERTIFIER);
    refused(project, () => certifyBill(project, bill.id, input, COST_CERTIFIER), /One line of this bill has not been decided yet\. Certify every line first\./);
    certifyLine(project, bill.id, columns!.id, { amount: 340_000, note: 'Two columns are not cast' }, COST_CERTIFIER);

    refused(project, () => certifyBill(project, bill.id, { ...input, signer: { ...signer, profession: ' ' } }, COST_CERTIFIER), /A certificate names who signed it and their profession\./);
    refused(project, () => certifyBill(project, bill.id, { ...input, signer: { ...signer, email: '' } }, COST_CERTIFIER), /A certificate names who signed it and their profession\./);
    refused(project, () => certifyBill(project, bill.id, { ...input, certifiedOn: '5 Sep 2026' }, COST_CERTIFIER), /A certificate needs the day it was issued: a day of the calendar, as YYYY-MM-DD\./);
    refused(project, () => certifyBill(project, bill.id, { ...input, evidenceId: 'ev_nothing' }, COST_CERTIFIER), /Upload the signed certificate to the vault first\./);
    const deduction = /A deduction is retention, advance recovery, tax, a penalty or another, and an amount of zero or more\./;
    refused(project, () => certifyBill(project, bill.id, { ...input, deductions: [{ kind: 'retention', amount: -1 }] }, COST_CERTIFIER), deduction);
    refused(project, () => certifyBill(project, bill.id, { ...input, deductions: [{ kind: 'gift' as never, amount: 1 }] }, COST_CERTIFIER), deduction);
    // 6,00,000 + 3,40,000 = 9,40,000 passed. Deductions of 9,40,001 would leave less than nothing to pay.
    refused(
      project,
      () => certifyBill(project, bill.id, { ...input, deductions: [{ kind: 'retention', amount: 47_000 }, { kind: 'penalty', amount: 893_001 }] }, COST_CERTIFIER),
      /The deductions come to more than the ₹9,40,000 certified\./,
    );

    const certificate = certifyBill(
      project,
      bill.id,
      {
        ...input,
        note: ' First certificate ',
        deductions: [
          { kind: 'retention', amount: 47_000 },
          { kind: 'tax', label: ' TDS 2% ', amount: 18_800 },
          { kind: 'penalty', amount: 0 },
        ],
      },
      COST_LEAD,
    );
    // Less 47,000 and 18,800: 8,74,200 to pay. A deduction of nothing takes nothing off and is not kept.
    assert.deepEqual(certificate, {
      id: certificate.id,
      gross: 940_000,
      deductions: [
        { kind: 'retention', amount: 47_000 },
        { kind: 'tax', label: 'TDS 2%', amount: 18_800 },
      ],
      net: 874_200,
      signer,
      certifiedOn: '2026-09-05',
      note: 'First certificate',
      createdAt: certificate.createdAt,
      createdBy: COST_LEAD,
    });
    assert.match(certificate.id, /^cert_/);
    assert.equal(standingCertification(bill), certificate);
    assert.deepEqual(lastAudit(project), ['certify_bill', 'certification', certificate.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.newValue, 'Bill RA-1: ₹9,40,000 gross, ₹8,74,200 net. R. Menon, Quantity Surveyor');

    refused(project, () => certifyBill(project, bill.id, input, COST_CERTIFIER), /This bill already has a certificate\. Withdraw it before issuing another\./);
  });

  it('is not issued on a bill with no lines, and may leave nothing to pay', () => {
    const { project, contract } = awarded();
    const empty = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31' }, COST_LEAD);
    refused(project, () => certifyBill(project, empty.id, input, COST_CERTIFIER), /This bill has no lines to certify\./);
    refused(project, () => certifyBill(project, 'bill_nothing', input, COST_CERTIFIER), /No bill by that id\./);

    // The whole of what was passed is recovered against an advance. Nothing is payable, so nothing is outstanding.
    const bill = addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', lines: [line({ amount: 100_000 })] }, COST_LEAD);
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 100_000 }, COST_CERTIFIER);
    const certificate = certifyBill(project, bill.id, { ...input, certifiedOn: '2026-10-05', deductions: [{ kind: 'advance_recovery', amount: 100_000 }] }, COST_CERTIFIER);
    assert.deepEqual([certificate.gross, certificate.net], [100_000, 0]);
    assert.deepEqual([billPosition(bill).status, billPosition(bill).outstanding, billPosition(bill).overpaid], ['paid', 0, 0]);
  });

  it('is withdrawn to open the bill again, and stays on it', () => {
    const open = billed();
    refused(open.project, () => withdrawCertification(open.project, open.bill.id, COST_CERTIFIER), /No certificate stands on this bill\./);

    const { project, bill, certificate } = certified();
    refused(project, () => withdrawCertification(project, 'bill_nothing', COST_CERTIFIER), /No bill by that id\./);
    const withdrawn = withdrawCertification(project, bill.id, COST_LEAD, ' The rate of item 2.6 is to be checked ');
    assert.equal(withdrawn, certificate);
    assert.deepEqual([withdrawn.withdrawn?.by, withdrawn.withdrawn?.reason], [COST_LEAD, 'The rate of item 2.6 is to be checked']);
    assert.equal(standingCertification(bill), undefined);
    assert.deepEqual(
      bill.lines.map((row) => row.certified?.amount),
      [600_000, 400_000],
      'what was passed on each line is kept, as the place to start from',
    );
    assert.deepEqual(lastAudit(project), ['withdraw_certification', 'certification', certificate.id, COST_LEAD]);
    assert.deepEqual([project.audit.at(-1)!.reason, project.audit.at(-1)!.oldValue], ['The rate of item 2.6 is to be checked', 'Bill RA-1: ₹10,00,000 gross, ₹10,00,000 net']);
    refused(project, () => withdrawCertification(project, bill.id, COST_LEAD), /No certificate stands on this bill\./);

    // Decided again and certified again. The bill keeps both certificates, and the second is the one that stands.
    certifyLine(project, bill.id, bill.lines[1]!.id, { amount: 380_000, note: 'Rate corrected' }, COST_CERTIFIER);
    const second = certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-20' }, COST_CERTIFIER);
    assert.deepEqual(
      bill.certifications.map((held) => [held.id, Boolean(held.withdrawn), held.gross]),
      [
        [certificate.id, true, 1_000_000],
        [second.id, false, 980_000],
      ],
    );
    assert.equal(standingCertification(bill), second);
  });
});

describe('paying, and what the job is expected to cost', () => {
  it('records what was paid against a bill', () => {
    const { project, bill } = certified();
    const advice = addEvidence(project, { title: 'Bank advice.pdf', kind: 'document' }, COST_ACCOUNTS);
    const payment = recordPayment(project, bill.id, { amount: 250_000.5, paidOn: '2026-09-12', reference: ' NEFT 4471 ', source: { evidenceId: advice.id, page: 1 } }, COST_ACCOUNTS);
    assert.deepEqual(payment, {
      id: payment.id,
      amount: 250_000.5,
      paidOn: '2026-09-12',
      reference: 'NEFT 4471',
      source: { evidenceId: advice.id, page: 1 },
      recordedAt: payment.recordedAt,
      recordedBy: COST_ACCOUNTS,
    });
    assert.match(payment.id, /^pay_/);
    assert.deepEqual(bill.payments, [payment]);
    assert.deepEqual(lastAudit(project), ['record_payment', 'bill', bill.id, COST_ACCOUNTS]);
    assert.equal(project.audit.at(-1)!.newValue, '₹2,50,000.50 paid on 2026-09-12 against bill RA-1 (NEFT 4471)');

    for (const amount of [0, -100, Number.NaN]) {
      refused(project, () => recordPayment(project, bill.id, { amount, paidOn: '2026-09-12' }, COST_ACCOUNTS), /A payment is an amount of money above zero\./);
    }
    refused(project, () => recordPayment(project, bill.id, { amount: 1, paidOn: 'yesterday' }, COST_ACCOUNTS), /A payment needs the day it was paid: a day of the calendar, as YYYY-MM-DD\./);
    refused(project, () => recordPayment(project, 'bill_nothing', { amount: 1, paidOn: '2026-09-12' }, COST_ACCOUNTS), /No bill by that id\./);
    refused(
      project,
      () => recordPayment(project, bill.id, { amount: 1, paidOn: '2026-09-12', source: { evidenceId: 'ev_nothing' } }, COST_ACCOUNTS),
      /The paper a figure was read from is not on this project\./,
    );
  });

  it('keeps the last forecast of the final cost', () => {
    const project = bare();
    for (const finalCost of [0, -1, Number.NaN]) {
      refused(project, () => setCostForecast(project, { finalCost }, COST_CERTIFIER), /The forecast final cost is an amount of money above zero\./);
    }
    assert.equal(project.cost, undefined);
    const first = setCostForecast(project, { finalCost: 6_200_000, note: ' Rock in the basement ' }, COST_CERTIFIER);
    assert.deepEqual([first.finalCost, first.note, first.by], [6_200_000, 'Rock in the basement', COST_CERTIFIER]);
    const second = setCostForecast(project, { finalCost: 6_500_000 }, COST_LEAD);
    assert.equal(costRegister(project).forecast, second);
    assert.deepEqual([second.finalCost, 'note' in second, second.by], [6_500_000, false, COST_LEAD]);
    assert.deepEqual(lastAudit(project), ['set_cost_forecast', 'cost', project.id, COST_LEAD]);
    assert.deepEqual([project.audit.at(-1)!.oldValue, project.audit.at(-1)!.newValue], ['₹62,00,000', '₹65,00,000']);
  });
});

describe('where the money stands', () => {
  it('reads a bill as claimed, in review, certified and then paid', () => {
    const { project, bills } = costExample();
    // RA-1: 4,00,000 + 6,00,000 claimed. 4,00,000 + 5,40,000 = 9,40,000 passed. Less 47,000 and 18,800 = 8,74,200. 8,00,000 paid.
    assert.deepEqual(billPosition(bills.ra1), { claimed: 1_000_000, lines: 2, decided: 2, gross: 940_000, net: 874_200, paid: 800_000, outstanding: 74_200, overpaid: 0, status: 'certified' });
    // RA-2: every line decided and its certificate withdrawn. It is in review, and nothing of it is certified.
    assert.deepEqual(billPosition(bills.ra2), { claimed: 1_150_000, lines: 3, decided: 3, paid: 0, status: 'in_review' });
    assert.deepEqual(billPosition(bills.f1), { claimed: 200_000, lines: 1, decided: 0, paid: 0, status: 'claimed' });

    // The rest of RA-1 comes in two parts. It is paid once what was paid reaches what was payable.
    recordPayment(project, bills.ra1.id, { amount: 74_199.5, paidOn: '2026-10-01' }, COST_ACCOUNTS);
    assert.deepEqual([billPosition(bills.ra1).status, billPosition(bills.ra1).outstanding], ['certified', 0.5]);
    recordPayment(project, bills.ra1.id, { amount: 0.5, paidOn: '2026-10-02' }, COST_ACCOUNTS);
    assert.deepEqual([billPosition(bills.ra1).status, billPosition(bills.ra1).paid, billPosition(bills.ra1).outstanding], ['paid', 874_200, 0]);
    // More than was payable is overpaid, as its own figure. Nothing is outstanding, and never less than nothing.
    recordPayment(project, bills.ra1.id, { amount: 100, paidOn: '2026-10-03' }, COST_ACCOUNTS);
    assert.deepEqual([billPosition(bills.ra1).status, billPosition(bills.ra1).outstanding, billPosition(bills.ra1).overpaid], ['paid', 0, 100]);
    // A payment before any certificate is counted as paid, and says nothing about where the bill stands.
    recordPayment(project, bills.f1.id, { amount: 50_000, paidOn: '2026-10-03' }, COST_ACCOUNTS);
    const early = billPosition(bills.f1);
    assert.deepEqual([early.status, early.paid, early.outstanding, early.overpaid], ['claimed', 50_000, undefined, undefined]);
  });

  it('counts what is certified only under a certificate that stands', () => {
    const { project, packages, contracts, bills } = costExample();
    // A: 4,00,000 and 1,00,000 claimed. Only RA-1's 4,00,000 is certified, because RA-2's certificate was withdrawn.
    assert.deepEqual(packagePosition(project, packages.earthwork.id), { budget: 1_000_000, claimed: 500_000, certified: 400_000, balance: 600_000 });
    // B: 6,00,000 and 10,00,000 claimed, and 5,40,000 certified.
    assert.deepEqual(packagePosition(project, packages.structure.id), { budget: 5_000_000, claimed: 1_600_000, certified: 540_000, balance: 4_460_000 });
    // C has no budget, so it has no balance.
    assert.deepEqual(packagePosition(project, packages.finishes.id), { claimed: 200_000, certified: 0 });
    // The civil contract: 45,00,000 less the 9,40,000 certified.
    assert.deepEqual(contractPosition(project, contracts.civil.id), { value: 4_500_000, claimed: 2_150_000, certified: 940_000, net: 874_200, paid: 800_000, balance: 3_560_000 });
    assert.deepEqual(contractPosition(project, contracts.interiors.id), { value: 800_000, claimed: 200_000, certified: 0, net: 0, paid: 0, balance: 800_000 });
    assert.throws(() => packagePosition(project, 'wpk_nothing'), /No work package by that id\./);
    assert.throws(() => contractPosition(project, 'ctr_nothing'), /No contract by that id\./);

    // RA-2 is certified again: 10,00,000 + 80,000 + nothing = 10,80,000, less 54,000 = 10,26,000.
    const second = certifyBill(project, bills.ra2.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-06', deductions: [{ kind: 'retention', amount: 54_000 }] }, COST_CERTIFIER);
    assert.deepEqual([second.gross, second.net, bills.ra2.certifications.length], [1_080_000, 1_026_000, 2]);
    assert.deepEqual(billPosition(bills.ra2), { claimed: 1_150_000, lines: 3, decided: 3, gross: 1_080_000, net: 1_026_000, paid: 0, outstanding: 1_026_000, overpaid: 0, status: 'certified' });
    assert.deepEqual(packagePosition(project, packages.earthwork.id), { budget: 1_000_000, claimed: 500_000, certified: 480_000, balance: 520_000 });
    assert.deepEqual(packagePosition(project, packages.structure.id), { budget: 5_000_000, claimed: 1_600_000, certified: 1_540_000, balance: 3_460_000 });
    assert.deepEqual(contractPosition(project, contracts.civil.id), { value: 4_500_000, claimed: 2_150_000, certified: 2_020_000, net: 1_900_200, paid: 800_000, balance: 2_480_000 });

    // Withdrawn once more, it leaves them again.
    withdrawCertification(project, bills.ra2.id, COST_CERTIFIER);
    assert.equal(packagePosition(project, packages.structure.id).certified, 540_000);
    assert.equal(contractPosition(project, contracts.civil.id).certified, 940_000);
  });

  it('sums the project: budget, committed, claimed, certified, paid, outstanding and the forecast', () => {
    const { project, packages, bills } = costExample();
    // Budget 10,00,000 + 50,00,000. Committed 45,00,000 + 8,00,000. Claimed 10,00,000 + 11,50,000 + 2,00,000.
    assert.deepEqual(costSummary(project), {
      budget: 6_000_000,
      committed: 5_300_000,
      claimed: 2_350_000,
      certified: 940_000,
      paid: 800_000,
      outstanding: 74_200,
      overpaid: 0,
      forecast: 6_500_000,
      // Finishes has no budget yet, so the forecast of the whole job is held against nothing.
      forecastOverBudget: false,
      certifiedOverBudget: false,
    });
    // Once every package has a budget, 65,00,000 is over the 62,00,000 of them.
    updateWorkPackage(project, packages.finishes.id, { budget: 200_000 }, COST_LEAD);
    assert.deepEqual([costSummary(project).budget, costSummary(project).forecastOverBudget], [6_200_000, true]);
    // A forecast of exactly the budget is not over it.
    setCostForecast(project, { finalCost: 6_200_000 }, COST_CERTIFIER);
    assert.equal(costSummary(project).forecastOverBudget, false);
    // What is paid before a certificate is paid, and is owed against nothing.
    recordPayment(project, bills.f1.id, { amount: 50_000, paidOn: '2026-10-03' }, COST_ACCOUNTS);
    assert.deepEqual([costSummary(project).paid, costSummary(project).outstanding], [850_000, 74_200]);

    // The budget cut to 3,00,000 + 5,00,000 + 1,00,000, below the 9,40,000 already certified.
    updateWorkPackage(project, packages.earthwork.id, { budget: 300_000 }, COST_LEAD);
    updateWorkPackage(project, packages.structure.id, { budget: 500_000 }, COST_LEAD);
    updateWorkPackage(project, packages.finishes.id, { budget: 100_000 }, COST_LEAD);
    assert.deepEqual([costSummary(project).budget, costSummary(project).certifiedOverBudget, costSummary(project).forecastOverBudget], [900_000, true, true]);
    assert.deepEqual(packagePosition(project, packages.earthwork.id), { budget: 300_000, claimed: 500_000, certified: 400_000, balance: -100_000 });

    // With one package left without a budget, a forecast of the whole job is held against nothing: 62,00,000 is not over a 6,00,000 that covers part of the work.
    updateWorkPackage(project, packages.earthwork.id, { budget: null }, COST_LEAD);
    assert.deepEqual([costSummary(project).budget, costSummary(project).forecastOverBudget], [600_000, false]);

    // With no budget on any package there is no budget to be over: not a budget of nothing.
    for (const pack of [...costRegister(project).workPackages]) updateWorkPackage(project, pack.id, { budget: null }, COST_LEAD);
    const none = costSummary(project);
    assert.deepEqual(['budget' in none, none.certifiedOverBudget, none.forecastOverBudget], [false, false, false]);
  });

  it('adds to the paisa', () => {
    // Ten paise and twenty paise are 0.30000000000000004 as the machine adds them, and 1.1 and 2.2 are 3.3000000000000003.
    assert.notEqual(0.1 + 0.2, 0.3);
    const { project, contract } = awarded();
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [line({ amount: 0.1 }), line({ amount: 0.2 })] }, COST_LEAD);
    assert.equal(billPosition(bill).claimed, 0.3);
    assert.equal(contractPosition(project, contract.id).claimed, 0.3);
    assert.equal(costSummary(project).claimed, 0.3);
    // The same for what is certified, and for what is left of the contract's value.
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 0.1 }, COST_CERTIFIER);
    certifyLine(project, bill.id, bill.lines[1]!.id, { amount: 0.2 }, COST_CERTIFIER);
    const certificate = certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' }, COST_CERTIFIER);
    assert.deepEqual([certificate.gross, certificate.net], [0.3, 0.3]);
    assert.equal(contractPosition(project, contract.id).balance, 4_499_999.7);
    recordPayment(project, bill.id, { amount: 0.1, paidOn: '2026-09-06' }, COST_ACCOUNTS);
    recordPayment(project, bill.id, { amount: 0.2, paidOn: '2026-09-07' }, COST_ACCOUNTS);
    assert.deepEqual([billPosition(bill).paid, billPosition(bill).outstanding, billPosition(bill).status], [0.3, 0, 'paid']);
  });
});

describe('what the register holds an entry to', () => {
  const signed = { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' };

  it('holds every date to the calendar', () => {
    const { project, contract } = awarded();
    const input = { contractId: contract.id, number: 'RA-1' };
    // The right shape and no such day: a thirteenth month, a thirtieth of February, the twenty-ninth in a year that is not a leap year.
    for (const day of ['2026-13-45', '2026-02-30', '2025-02-29', '2026-00-10', '2026-04-31']) {
      refused(project, () => addBill(project, { ...input, date: day }, COST_LEAD), /A bill needs its date: a day of the calendar, as YYYY-MM-DD\./);
      refused(project, () => addBill(project, { ...input, date: '2026-08-31', periodFrom: day }, COST_LEAD), /The period a bill covers is two days of the calendar, each as YYYY-MM-DD\./);
      refused(project, () => addBill(project, { ...input, date: '2026-08-31', periodTo: day }, COST_LEAD), /The period a bill covers is two days of the calendar, each as YYYY-MM-DD\./);
    }
    // The twenty-ninth of February in a leap year is a day.
    const bill = addBill(project, { ...input, date: '2024-02-29', periodFrom: '2024-02-01', periodTo: '2024-02-29', lines: [line()] }, COST_LEAD);
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 1000 }, COST_CERTIFIER);
    for (const certifiedOn of ['2026-13-45', '2026-02-30']) {
      refused(project, () => certifyBill(project, bill.id, { ...signed, certifiedOn }, COST_CERTIFIER), /A certificate needs the day it was issued: a day of the calendar, as YYYY-MM-DD\./);
    }
    certifyBill(project, bill.id, { ...signed, certifiedOn: '2024-03-05' }, COST_CERTIFIER);
    for (const paidOn of ['2026-13-45', '2026-02-30']) {
      refused(project, () => recordPayment(project, bill.id, { amount: 1, paidOn }, COST_ACCOUNTS), /A payment needs the day it was paid: a day of the calendar, as YYYY-MM-DD\./);
    }
    assert.equal(recordPayment(project, bill.id, { amount: 1, paidOn: '2024-03-31' }, COST_ACCOUNTS).paidOn, '2024-03-31');
  });

  it('refuses a certificate dated before its bill', () => {
    const { project, bill } = billed();
    for (const row of bill.lines) certifyLine(project, bill.id, row.id, { amount: row.amount }, COST_CERTIFIER);
    // The bill is dated 2026-08-31. Nothing is certified before it was raised.
    for (const certifiedOn of ['2026-08-30', '2025-09-05']) {
      refused(project, () => certifyBill(project, bill.id, { ...signed, certifiedOn }, COST_CERTIFIER), /A certificate is not dated before its bill\. This bill is dated 2026-08-31\./);
    }
    // The day of the bill itself is not before it.
    assert.equal(certifyBill(project, bill.id, { ...signed, certifiedOn: '2026-08-31' }, COST_CERTIFIER).certifiedOn, '2026-08-31');
    // No other pair of dates is held to an order: a payment may be entered for a day before the certificate.
    assert.equal(recordPayment(project, bill.id, { amount: 1, paidOn: '2026-08-01' }, COST_ACCOUNTS).paidOn, '2026-08-01');
  });

  it('keeps no figure too large to be money', () => {
    // 1e307 brought to the paisa is not a number any more, and a certificate added up from it was issued for NaN.
    const large = /That figure is too large to be kept: an amount on this register is below 10,000,000,000,000\./;
    const { project, pack, contract, bill } = billed();
    for (const figure of [1e307, -1e307, 1e13, -1e13, Number.MAX_VALUE]) {
      refused(project, () => addWorkPackages(project, [{ name: 'Finishes', budget: Math.abs(figure) }], COST_LEAD), large);
      refused(project, () => updateWorkPackage(project, pack.id, { budget: Math.abs(figure) }, COST_LEAD), large);
      refused(project, () => addContract(project, { contractor: 'Acme Lifts', title: 'Lifts', value: Math.abs(figure) }, COST_LEAD), large);
      refused(project, () => addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', lines: [line({ amount: figure })] }, COST_LEAD), large);
      refused(project, () => addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', statedTotal: figure }, COST_LEAD), large);
      for (const key of ['rate', 'quantityToDate', 'amountToDate', 'previousAmount'] as const) {
        refused(project, () => setBillLines(project, bill.id, [line({ [key]: figure })], COST_LEAD), large);
      }
      refused(project, () => updateBillLine(project, bill.id, bill.lines[0]!.id, { amount: figure }, COST_LEAD), large);
      refused(project, () => certifyLine(project, bill.id, bill.lines[0]!.id, { amount: figure, note: 'Any reason' }, COST_CERTIFIER), large);
      refused(project, () => certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 600_000, quantity: figure }, COST_CERTIFIER), large);
      refused(project, () => recordPayment(project, bill.id, { amount: Math.abs(figure), paidOn: '2026-09-12' }, COST_ACCOUNTS), large);
      refused(project, () => setCostForecast(project, { finalCost: Math.abs(figure) }, COST_CERTIFIER), large);
    }
    for (const row of bill.lines) certifyLine(project, bill.id, row.id, { amount: row.amount }, COST_CERTIFIER);
    refused(project, () => certifyBill(project, bill.id, { ...signed, deductions: [{ kind: 'retention', amount: 1e307 }] }, COST_CERTIFIER), large);

    // The largest figure that is kept is kept to the paisa, and adds up to a number.
    const [most] = addWorkPackages(project, [{ name: 'Everything', budget: 9_999_999_999_999.99 }], COST_LEAD);
    assert.equal(most!.budget, 9_999_999_999_999.99);
    const certificate = certifyBill(project, bill.id, signed, COST_CERTIFIER);
    assert.ok(Number.isFinite(certificate.gross) && Number.isFinite(certificate.net));
    for (const figure of Object.values(costSummary(project))) assert.ok(typeof figure !== 'number' || Number.isFinite(figure), `the summary holds ${figure}`);
  });

  it('keeps a line a model or a sheet read only with where it was read', () => {
    const { project, contract } = awarded();
    const paper = addEvidence(project, { title: 'RA Bill 1.pdf', kind: 'document' }, COST_LEAD);
    const input = { contractId: contract.id, number: 'RA-1', date: '2026-08-31' };
    const model = /A line a model read says the paper and the page it was read from\./;
    const sheet = /A line read off a spreadsheet says the paper, the sheet and the cell it was read from\./;
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'model' })] }, COST_LEAD), model);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'model', source: { evidenceId: paper.id, sheet: 'RA 1', cell: 'H12' } })] }, COST_LEAD), model);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'sheet' })] }, COST_LEAD), sheet);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'sheet', source: { evidenceId: paper.id, sheet: 'RA 1' } })] }, COST_LEAD), sheet);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'sheet', source: { evidenceId: paper.id, cell: 'H12' } })] }, COST_LEAD), sheet);
    refused(project, () => addBill(project, { ...input, lines: [line({ readBy: 'sheet', source: { evidenceId: paper.id, page: 2 } })] }, COST_LEAD), sheet);

    // What a person typed needs no source, and may say one.
    const read = [
      line(),
      line({ source: { evidenceId: paper.id, page: 2 } }),
      line({ readBy: 'model', source: { evidenceId: paper.id, page: 2 } }),
      line({ readBy: 'sheet', source: { evidenceId: paper.id, sheet: 'RA 1', cell: 'H12' } }),
    ];
    const bill = addBill(project, { ...input, lines: read }, COST_LEAD);
    assert.deepEqual(
      bill.lines.map((row) => [row.readBy, row.source ? costSourceSaid(row.source) : '']),
      [
        ['person', ''],
        ['person', 'p. 2'],
        ['model', 'p. 2'],
        ['sheet', 'sheet “RA 1”, cell H12'],
      ],
    );

    // The same when one line is changed, and when the lines are read again.
    const [typed, , byModel, bySheet] = bill.lines;
    refused(project, () => updateBillLine(project, bill.id, typed!.id, { readBy: 'model' }, COST_LEAD), model);
    refused(project, () => updateBillLine(project, bill.id, byModel!.id, { source: null }, COST_LEAD), model);
    refused(project, () => updateBillLine(project, bill.id, bySheet!.id, { source: { evidenceId: paper.id, sheet: 'RA 1' } }, COST_LEAD), sheet);
    refused(project, () => setBillLines(project, bill.id, [line({ readBy: 'sheet' })], COST_LEAD), sheet);
    // A person may take a line over and type it: it is theirs then, and needs no source.
    const taken = updateBillLine(project, bill.id, byModel!.id, { readBy: 'person', source: null }, COST_LEAD);
    assert.deepEqual([taken.readBy, 'source' in taken], ['person', false]);
  });

  it('brings every amount to the paisa on the way in', () => {
    const project = bare();
    // Half a paisa goes up, as a person rounds it: the machine holds 1234.565 as a shade less.
    const [pack] = addWorkPackages(project, [{ name: 'Structure', budget: 1234.565 }], COST_LEAD);
    assert.equal(pack!.budget, 1234.57);
    assert.equal(updateWorkPackage(project, pack!.id, { budget: 0.004 }, COST_LEAD).budget, 0);
    const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: [pack!.id], value: 999.994 }, COST_LEAD);
    assert.equal(contract.value, 999.99);
    refused(project, () => addContract(project, { contractor: 'Acme Lifts', title: 'Lifts', value: 0.004 }, COST_LEAD), /A contract’s value is an amount of money above zero\./);

    defineCostColumn(project, { key: 'gst', label: 'GST', kind: 'money' }, COST_LEAD);
    defineCostColumn(project, { key: 'area', label: 'Area', kind: 'number' }, COST_LEAD);
    const bill = addBill(
      project,
      {
        contractId: contract.id,
        number: 'RA-1',
        date: '2026-08-31',
        statedTotal: 100.005,
        lines: [line({ workPackageId: pack!.id, rate: 33.3333, quantityToDate: 3.00015, amountToDate: 300.014, previousAmount: 200.009, amount: 100.005, extra: { gst: 18.0009, area: 12.3456 } }), line({ amount: -0.004 })],
      },
      COST_LEAD,
    );
    const [row, dust] = bill.lines;
    assert.deepEqual([bill.statedTotal, row!.amount, row!.amountToDate, row!.previousAmount, row!.extra], [100.01, 100.01, 300.01, 200.01, { gst: 18, area: 12.3456 }]);
    // A rate and a quantity are not money counted out. They keep the decimals they came with.
    assert.deepEqual([row!.rate, row!.quantityToDate], [33.3333, 3.00015]);
    assert.ok(Object.is(dust!.amount, 0), 'less than half a paisa either way is nothing, and not a nothing with a minus on it');

    // What is passed, what is deducted, what is paid and what is forecast, the same.
    assert.equal(certifyLine(project, bill.id, row!.id, { amount: 100.005 }, COST_CERTIFIER).certified?.amount, 100.01, 'the claim to the paisa is the claim: no reason is asked');
    certifyLine(project, bill.id, dust!.id, { amount: 0.004 }, COST_CERTIFIER);
    const certificate = certifyBill(project, bill.id, { ...signed, deductions: [{ kind: 'retention', amount: 5.0005 }, { kind: 'tax', amount: 0.004 }] }, COST_CERTIFIER);
    assert.deepEqual([certificate.gross, certificate.deductions, certificate.net], [100.01, [{ kind: 'retention', amount: 5 }], 95.01]);
    refused(project, () => recordPayment(project, bill.id, { amount: 0.004, paidOn: '2026-09-12' }, COST_ACCOUNTS), /A payment is an amount of money above zero\./);
    assert.equal(recordPayment(project, bill.id, { amount: 95.005, paidOn: '2026-09-12' }, COST_ACCOUNTS).amount, 95.01);
    assert.deepEqual([billPosition(bill).paid, billPosition(bill).outstanding, billPosition(bill).status], [95.01, 0, 'paid']);
    assert.equal(setCostForecast(project, { finalCost: 2000.555 }, COST_CERTIFIER).finalCost, 2000.56);
    refused(project, () => setCostForecast(project, { finalCost: 0.004 }, COST_CERTIFIER), /The forecast final cost is an amount of money above zero\./);
  });
});

describe('an item billed again on a later bill', () => {
  it('is counted at each bill’s own amount, never at its amount to date', () => {
    // Item 2.4 on two running bills. 6,00,000 to date on the first. 9,00,000 to date on the second, of which 6,00,000 was billed before.
    const { project, pack, contract } = awarded();
    const item = { item: '2.4', description: 'RCC M30 in raft foundation', workPackageId: pack.id, unit: 'cum', rate: 3000, readBy: 'person' as const };
    const first = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [{ ...item, quantityToDate: 200, amountToDate: 600_000, previousAmount: 0, amount: 600_000 }] }, COST_LEAD);
    const second = addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', lines: [{ ...item, quantityToDate: 300, amountToDate: 900_000, previousAmount: 600_000, amount: 300_000 }] }, COST_LEAD);
    // 6,00,000 + 3,00,000 = 9,00,000, which is what the item has come to. Not 6,00,000 + 9,00,000.
    assert.equal(packagePosition(project, pack.id).claimed, 900_000);
    assert.equal(contractPosition(project, contract.id).claimed, 900_000);
    assert.equal(costSummary(project).claimed, 900_000);

    for (const bill of [first, second]) {
      certifyLine(project, bill.id, bill.lines[0]!.id, { amount: bill.lines[0]!.amount }, COST_CERTIFIER);
      certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: bill.date }, COST_CERTIFIER);
    }
    assert.deepEqual(packagePosition(project, pack.id), { budget: 5_000_000, claimed: 900_000, certified: 900_000, balance: 4_100_000 });
    assert.deepEqual(contractPosition(project, contract.id), { value: 4_500_000, claimed: 900_000, certified: 900_000, net: 900_000, paid: 0, balance: 3_600_000 });
    assert.deepEqual([costSummary(project).certified, costSummary(project).outstanding], [900_000, 900_000]);
  });
});

describe('payments', () => {
  it('refuses a reference that already stands on the bill: the same payment entered twice', () => {
    const { project, contract, bill } = certified();
    const first = recordPayment(project, bill.id, { amount: 250_000, paidOn: '2026-09-12', reference: 'NEFT 4471' }, COST_ACCOUNTS);
    for (const reference of ['NEFT 4471', ' neft 4471 ', 'Neft 4471']) {
      refused(
        project,
        () => recordPayment(project, bill.id, { amount: 250_000, paidOn: '2026-09-13', reference }, COST_ACCOUNTS),
        /A payment with the reference .+ already stands on this bill\. If that one was entered wrongly, void it first\./,
      );
    }
    // Payments with no reference are not told apart by one: two of them are two payments.
    recordPayment(project, bill.id, { amount: 1000, paidOn: '2026-09-14' }, COST_ACCOUNTS);
    recordPayment(project, bill.id, { amount: 1000, paidOn: '2026-09-14' }, COST_ACCOUNTS);
    // One transfer may settle two bills, so the same reference on another bill is taken.
    const other = addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', lines: [line()] }, COST_LEAD);
    assert.equal(recordPayment(project, other.id, { amount: 500, paidOn: '2026-09-12', reference: 'NEFT 4471' }, COST_ACCOUNTS).reference, 'NEFT 4471');
    // Once the first is voided its reference stands on nothing, and the payment can be entered again as it should have been.
    voidPayment(project, bill.id, first.id, COST_ACCOUNTS, 'The amount was mistyped');
    assert.equal(recordPayment(project, bill.id, { amount: 205_000, paidOn: '2026-09-12', reference: 'NEFT 4471' }, COST_ACCOUNTS).amount, 205_000);
    assert.equal(billPosition(bill).paid, 207_000);
  });

  it('voids one entered wrongly: it stays on the bill, marked, and out of every sum', () => {
    const { project, contract, bill } = certified();
    // The certificate is for 10,00,000. 4,00,000 is entered against it by mistake, and 2,50,000 rightly.
    const wrong = recordPayment(project, bill.id, { amount: 400_000, paidOn: '2026-09-12', reference: 'NEFT 1' }, COST_ACCOUNTS);
    recordPayment(project, bill.id, { amount: 250_000, paidOn: '2026-09-13', reference: 'NEFT 2' }, COST_ACCOUNTS);
    assert.deepEqual([billPosition(bill).paid, billPosition(bill).outstanding], [650_000, 350_000]);

    refused(project, () => voidPayment(project, bill.id, wrong.id, COST_ACCOUNTS, '  '), /Say why the payment is voided\./);
    refused(project, () => voidPayment(project, bill.id, 'pay_nothing', COST_ACCOUNTS, 'Wrong bill'), /No payment by that id on this bill\./);
    refused(project, () => voidPayment(project, 'bill_nothing', wrong.id, COST_ACCOUNTS, 'Wrong bill'), /No bill by that id\./);

    const voided = voidPayment(project, bill.id, wrong.id, COST_LEAD, ' Paid to another contractor ');
    assert.equal(voided, wrong);
    assert.deepEqual([voided.amount, voided.reference, voided.voided?.by, voided.voided?.reason], [400_000, 'NEFT 1', COST_LEAD, 'Paid to another contractor']);
    assert.ok(!Number.isNaN(Date.parse(voided.voided!.at)));
    assert.equal(bill.payments.length, 2, 'what was once recorded as paid can still be read');
    assert.deepEqual(lastAudit(project), ['void_payment', 'bill', bill.id, COST_LEAD]);
    assert.deepEqual([project.audit.at(-1)!.reason, project.audit.at(-1)!.oldValue], ['Paid to another contractor', '₹4,00,000 paid on 2026-09-12 against bill RA-1 (NEFT 1)']);

    assert.deepEqual([billPosition(bill).paid, billPosition(bill).outstanding, billPosition(bill).status], [250_000, 750_000, 'certified']);
    assert.equal(contractPosition(project, contract.id).paid, 250_000);
    assert.deepEqual([costSummary(project).paid, costSummary(project).outstanding], [250_000, 750_000]);
    refused(project, () => voidPayment(project, bill.id, wrong.id, COST_LEAD, 'Once more'), /That payment is already voided\./);
  });

  it('do not set what one bill was overpaid against what another is owed', () => {
    const { project, bills } = costExample();
    // RA-1 has 74,200 still to pay. F-1, another contractor's, is certified at 2,00,000 and paid 2,50,000.
    certifyLine(project, bills.f1.id, bills.f1.lines[0]!.id, { amount: 200_000 }, COST_CERTIFIER);
    certifyBill(project, bills.f1.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-06' }, COST_CERTIFIER);
    recordPayment(project, bills.f1.id, { amount: 250_000, paidOn: '2026-10-07' }, COST_ACCOUNTS);
    const interiors = billPosition(bills.f1);
    assert.deepEqual([interiors.outstanding, interiors.overpaid, interiors.status], [0, 50_000, 'paid']);
    // Sharma is still owed its 74,200. Lakshmi's 50,000 too much is a figure of its own, and takes nothing off it.
    const summary = costSummary(project);
    assert.deepEqual([summary.certified, summary.paid, summary.outstanding, summary.overpaid], [1_140_000, 1_050_000, 74_200, 50_000]);
  });
});

describe('withdrawing a certificate that was paid against', () => {
  it('needs the reason, and leaves the money where it was paid', () => {
    const { project, bill } = certified();
    const payment = recordPayment(project, bill.id, { amount: 400_000, paidOn: '2026-09-12' }, COST_ACCOUNTS);
    const why = /Money has been paid against this certificate\. Say why it is withdrawn\./;
    refused(project, () => withdrawCertification(project, bill.id, COST_CERTIFIER), why);
    refused(project, () => withdrawCertification(project, bill.id, COST_CERTIFIER, '   '), why);

    const withdrawn = withdrawCertification(project, bill.id, COST_CERTIFIER, 'The rate of item 2.6 is to be checked');
    assert.equal(withdrawn.withdrawn?.reason, 'The rate of item 2.6 is to be checked');
    // The money is still paid. The bill is no longer certified, so nothing is payable under it and nothing outstanding.
    assert.deepEqual(bill.payments, [payment]);
    assert.deepEqual(billPosition(bill), { claimed: 1_000_000, lines: 2, decided: 2, paid: 400_000, status: 'in_review' });
    const summary = costSummary(project);
    assert.deepEqual([summary.certified, summary.paid, summary.outstanding, summary.overpaid], [0, 400_000, 0, 0]);

    // Certified again for less than was paid, the difference shows as overpaid.
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 300_000, note: 'Half the raft is cast' }, COST_CERTIFIER);
    certifyLine(project, bill.id, bill.lines[1]!.id, { amount: 0, note: 'Not started' }, COST_CERTIFIER);
    certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-20' }, COST_CERTIFIER);
    assert.deepEqual([billPosition(bill).net, billPosition(bill).outstanding, billPosition(bill).overpaid, billPosition(bill).status], [300_000, 0, 100_000, 'paid']);
  });

  it('asks for no reason where the only payment against it was voided', () => {
    const { project, bill } = certified();
    const payment = recordPayment(project, bill.id, { amount: 400_000, paidOn: '2026-09-12' }, COST_ACCOUNTS);
    voidPayment(project, bill.id, payment.id, COST_ACCOUNTS, 'Entered against the wrong bill');
    assert.equal(withdrawCertification(project, bill.id, COST_CERTIFIER).withdrawn?.reason, undefined);
  });
});

describe('the budget, where only some packages have one', () => {
  it('holds what is certified against it on those packages and nothing else', () => {
    const { project, packages } = costExample();
    // Earthwork keeps a budget of 5,00,000 and has 4,00,000 certified on it. Structure's budget is taken off: its 5,40,000 is held against nothing.
    updateWorkPackage(project, packages.structure.id, { budget: null }, COST_LEAD);
    updateWorkPackage(project, packages.earthwork.id, { budget: 500_000 }, COST_LEAD);
    const within = costSummary(project);
    assert.deepEqual([within.budget, within.certified, within.certifiedOverBudget], [500_000, 940_000, false], '9,40,000 is certified in all, and only 4,00,000 of it against the 5,00,000');
    // Earthwork's budget cut below what is certified on it.
    updateWorkPackage(project, packages.earthwork.id, { budget: 300_000 }, COST_LEAD);
    assert.equal(costSummary(project).certifiedOverBudget, true);
    assert.equal(packagePosition(project, packages.earthwork.id).balance, -100_000);
  });
});

describe('the budget, once every package has one', () => {
  it('holds all that is certified against it, on whatever line', () => {
    // Budgets of 10,00,000 and 40,00,000: 50,00,000 for the whole job. A bill of 60,00,000 on lines that price no package, passed in full.
    const project = bare();
    const packs = addWorkPackages(project, [{ code: 'A', name: 'Earthwork', budget: 1_000_000 }, { code: 'B', name: 'Structure', budget: 4_000_000 }], COST_LEAD);
    const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: packs.map((pack) => pack.id), value: 6_000_000 }, COST_LEAD);
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [line({ amount: 2_000_000 }), line({ amount: 4_000_000 })] }, COST_LEAD);
    for (const row of bill.lines) certifyLine(project, bill.id, row.id, { amount: row.amount }, COST_CERTIFIER);
    assert.equal(costSummary(project).certifiedOverBudget, false, 'nothing is certified until the certificate is issued');
    certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' }, COST_CERTIFIER);
    const over = costSummary(project);
    // Not a rupee of it is on a package, and all of it is certified on the job the budget is for.
    assert.deepEqual(packs.map((pack) => packagePosition(project, pack.id).certified), [0, 0]);
    assert.deepEqual([over.budget, over.certified, over.certifiedOverBudget], [5_000_000, 6_000_000, true]);

    // A third package with no budget yet: the budget is for part of the work again, and what is on no package is held against nothing.
    const [finishes] = addWorkPackages(project, [{ code: 'C', name: 'Finishes' }], COST_LEAD);
    assert.equal(costSummary(project).certifiedOverBudget, false);
    updateWorkPackage(project, finishes!.id, { budget: 500_000 }, COST_LEAD);
    assert.deepEqual([costSummary(project).budget, costSummary(project).certifiedOverBudget], [5_500_000, true]);
    // Exactly the budget is not over it.
    updateWorkPackage(project, finishes!.id, { budget: 1_000_000 }, COST_LEAD);
    assert.deepEqual([costSummary(project).budget, costSummary(project).certifiedOverBudget], [6_000_000, false]);
  });
});

describe('taking back what was entered wrongly', () => {
  const signed = { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' };

  it('removes a bill nothing has been done on, and keeps one that has been worked on', () => {
    const { project, contract, bill } = billed();
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 600_000 }, COST_CERTIFIER);
    refused(project, () => removeBill(project, bill.id, COST_LEAD), /A line of this bill has been decided, so the bill is kept\. If it was taken in wrongly, replace its lines first\./);
    certifyLine(project, bill.id, bill.lines[1]!.id, { amount: 400_000 }, COST_CERTIFIER);
    certifyBill(project, bill.id, signed, COST_CERTIFIER);
    const kept = /A certificate was issued on this bill, so the bill is kept with it\./;
    refused(project, () => removeBill(project, bill.id, COST_LEAD), kept);
    // A certificate that was withdrawn was still issued.
    withdrawCertification(project, bill.id, COST_CERTIFIER);
    refused(project, () => removeBill(project, bill.id, COST_LEAD), kept);

    const second = addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30', lines: [line()] }, COST_LEAD);
    const payment = recordPayment(project, second.id, { amount: 500, paidOn: '2026-10-01' }, COST_ACCOUNTS);
    refused(project, () => removeBill(project, second.id, COST_LEAD), /A payment stands on this bill\. Void it first\./);
    voidPayment(project, second.id, payment.id, COST_ACCOUNTS, 'Entered against the wrong bill');
    removeBill(project, second.id, COST_LEAD);
    assert.deepEqual(costRegister(project).bills.map((held) => held.number), ['RA-1']);
    assert.deepEqual(lastAudit(project), ['remove_bill', 'bill', second.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.oldValue, 'Sharma Constructions bill RA-2, 2026-09-30: 1 line, ₹1,000');
    refused(project, () => removeBill(project, second.id, COST_LEAD), /No bill by that id\./);
    // Its number is the contract's to use again.
    assert.equal(addBill(project, { contractId: contract.id, number: 'RA-2', date: '2026-09-30' }, COST_LEAD).number, 'RA-2');
  });

  it('removes a contract once no bill was raised under it', () => {
    const { project, pack, contract, bill } = billed();
    refused(project, () => removeContract(project, contract.id, COST_LEAD), /Bill RA-1 was raised under this contract\. Remove its bills first\./);
    removeBill(project, bill.id, COST_LEAD);
    removeContract(project, contract.id, COST_LEAD);
    assert.deepEqual(costRegister(project).contracts, []);
    assert.deepEqual(lastAudit(project), ['remove_contract', 'contract', contract.id, COST_LEAD]);
    assert.equal(project.audit.at(-1)!.oldValue, 'Sharma Constructions: Civil works, ₹45,00,000');
    refused(project, () => removeContract(project, contract.id, COST_LEAD), /No contract by that id\./);
    // And the package it covered is free to go.
    removeWorkPackage(project, pack.id, COST_LEAD);
    assert.deepEqual(project.cost, { workPackages: [], contracts: [], bills: [] });
  });
});

describe('amounts and sources in words', () => {
  it('writes rupees grouped the Indian way, with paise only where there are any', () => {
    assert.equal(moneySaid(0), '₹0');
    assert.equal(moneySaid(999), '₹999');
    assert.equal(moneySaid(1000), '₹1,000');
    assert.equal(moneySaid(100_000), '₹1,00,000');
    assert.equal(moneySaid(12_345_678), '₹1,23,45,678');
    assert.equal(moneySaid(12_345_678.5), '₹1,23,45,678.50');
    assert.equal(moneySaid(0.05), '₹0.05');
    assert.equal(moneySaid(999.999), '₹1,000', 'rounded to the paisa first');
    assert.equal(moneySaid(-1200), '−₹1,200', 'the minus goes before the sign');
    assert.equal(moneySaid(-0.001), '₹0', 'and nothing is not minus nothing');
    assert.equal(moneySaid(1.005), '₹1.01', 'half a paisa goes up, as a person rounds it');
  });

  it('writes money in the project’s own currency', () => {
    assert.equal(moneySaid(12_345_678.5, 'INR'), '₹1,23,45,678.50');
    assert.equal(moneySaid(12_345_678.5, 'EUR'), '€12,345,678.50');
    assert.equal(moneySaid(-1200, 'EUR'), '−€1,200');
    // A project kept in euros says euros on its trail, and in what it refuses.
    const project = createProject({ name: 'Euro test', type: 'residential', location: 'Dublin', city: 'Dublin', currency: 'EUR' }, 'RYT-E1');
    const contract = addContract(project, { contractor: 'Murphy Builders', title: 'Shell and core', value: 1_250_000 }, COST_LEAD);
    assert.equal(project.audit.at(-1)!.newValue, 'Murphy Builders: Shell and core, €1,250,000');
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [line({ amount: 80_000 })] }, COST_LEAD);
    assert.equal(project.audit.at(-1)!.newValue, 'Murphy Builders bill RA-1, 2026-08-31: 1 line, €80,000');
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 80_000 }, COST_CERTIFIER);
    assert.equal(project.audit.at(-1)!.newValue, '€80,000 of €80,000 claimed');
    const signed = { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' };
    refused(project, () => certifyBill(project, bill.id, { ...signed, deductions: [{ kind: 'retention', amount: 80_001 }] }, COST_CERTIFIER), /The deductions come to more than the €80,000 certified\./);
    certifyBill(project, bill.id, signed, COST_CERTIFIER);
    assert.equal(project.audit.at(-1)!.newValue, 'Bill RA-1: €80,000 gross, €80,000 net. qs@firm.in, Quantity Surveyor');
    recordPayment(project, bill.id, { amount: 80_000, paidOn: '2026-09-12' }, COST_ACCOUNTS);
    assert.equal(project.audit.at(-1)!.newValue, '€80,000 paid on 2026-09-12 against bill RA-1');
  });

  it('says a source as its page, or its sheet and cell', () => {
    assert.equal(costSourceSaid({ page: 3 }), 'p. 3');
    assert.equal(costSourceSaid({ sheet: 'RA 3', cell: 'F14' }), 'sheet “RA 3”, cell F14');
    assert.equal(costSourceSaid({ sheet: 'RA 3' }), 'sheet “RA 3”');
    assert.equal(costSourceSaid({ cell: 'F14' }), 'cell F14');
    assert.equal(costSourceSaid({}), '');
  });
});
