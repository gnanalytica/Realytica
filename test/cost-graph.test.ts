/**
 * The cost register in the project's graph, and who may see it.
 *
 * The graph is what the chat reads and what a search walks, so three things
 * are asked of the register's part of it. Every record is a node and every
 * tie between two of them is a relation, so "what was this certificate
 * issued on" is a walk and not a guess. A bill line is found by its own
 * words and says its own amounts and the page or the cell they were read
 * from, because a model handed "item 2.4" can say nothing about it. And none
 * of it reaches somebody whose grant leaves out the budget and figures: not
 * the register, not its nodes, and not an id to write to.
 *
 * The file drawn is the one `costExample` in `fixtures.ts` works by hand.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProjectTools } from '@realytica/agents';
import {
  GRANT_AREAS,
  PROJECT_EDGE_LABEL,
  addBill,
  addContract,
  addEvidence,
  addWorkPackages,
  buildProjectGraph,
  certifyBill,
  certifyLine,
  createProject,
  extractProjectSubgraph,
  findProjectNodes,
  projectEdgeEndpointsValid,
  projectEdgePhrase,
  projectLayerFor,
  projectRecordIds,
  projectView,
  recordPayment,
  removeWorkPackage,
  retrieveProjectNeighbourhood,
  serializeProjectSubgraph,
  setCostForecast,
  setProjectDepartments,
  traceProjectNode,
  updateWorkPackage,
  validateProjectGraph,
  withheldAnswer,
  withheldBriefing,
  type DdProject,
  type ProjectGrant,
  type ProjectGraphEdge,
  type ProjectGraphNode,
} from '@realytica/shared';
import { COST_ACCOUNTS, COST_CERTIFIER, COST_LEAD, costExample } from './fixtures';

type Graph = { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] };
type Kind = ProjectGraphNode['kind'];

const COST_KINDS: readonly Kind[] = ['work_package', 'contract', 'bill', 'bill_line', 'certification'];
const COST_RELATIONS = ['covers', 'billed_under', 'has_line', 'prices', 'certifies_bill', 'measured_against'] as const;

/** The worked example, drawn. */
function drawn() {
  const example = costExample();
  return { ...example, graph: buildProjectGraph(example.project) };
}

/**
 * A register the size of a real one: twelve running bills of 150 lines each,
 * every line read off a cell of its bill's own sheet and pricing one of three
 * work packages. The first line of each bill is the raft.
 */
function largeRegister() {
  const project = createProject({ name: 'Large register', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C4');
  const packs = addWorkPackages(
    project,
    [
      { code: 'A', name: 'Earthwork', budget: 10_000_000 },
      { code: 'B', name: 'Structure', budget: 50_000_000 },
      { code: 'C', name: 'Finishes' },
    ],
    COST_LEAD,
  );
  const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: packs.map((pack) => pack.id), value: 90_000_000 }, COST_LEAD);
  const sheets: string[] = [];
  const bills = Array.from({ length: 12 }, (_, b) => {
    const sheet = addEvidence(project, { title: `RA Bill ${b + 1}.xlsx`, kind: 'document', status: 'received' }, COST_LEAD);
    sheets.push(sheet.id);
    return addBill(
      project,
      {
        contractId: contract.id,
        number: `RA-${b + 1}`,
        date: `2026-${String(b + 1).padStart(2, '0')}-28`,
        evidenceId: sheet.id,
        lines: Array.from({ length: 150 }, (_row, i) => ({
          item: `${b + 1}.${i + 1}`,
          description: i === 0 ? 'RCC M30 in raft foundation' : `Item ${i + 1} of the bill of quantities`,
          workPackageId: packs[i % 3]!.id,
          amount: 1000 + i,
          source: { evidenceId: sheet.id, sheet: `RA ${b + 1}`, cell: `H${i + 2}` },
          readBy: 'sheet' as const,
        })),
      },
      COST_LEAD,
    );
  });
  return { project, packs, contract, bills, sheets };
}

const nodeOf = (graph: Graph, id: string): ProjectGraphNode => {
  const node = graph.nodes.find((n) => n.id === id);
  assert.ok(node, `${id} is not a node`);
  return node;
};

/** Every edge of one relation, as "the label it leaves > the label it reaches", sorted. */
function joined(graph: Graph, rel: string, among?: (node: ProjectGraphNode) => boolean): string[] {
  return graph.edges
    .filter((edge) => edge.rel === rel)
    .map((edge) => [nodeOf(graph, edge.from), nodeOf(graph, edge.to)] as const)
    .filter(([from, to]) => !among || among(from) || among(to))
    .map(([from, to]) => `${from.label} > ${to.label}`)
    .sort();
}

const isCost = (node: ProjectGraphNode): boolean => COST_KINDS.includes(node.kind);

/** What a walk from the project never arrives at, crossing each edge either way. */
function unreached(graph: Graph, projectId: string): string[] {
  const beside = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const edge of graph.edges) {
    beside.get(edge.from)!.push(edge.to);
    beside.get(edge.to)!.push(edge.from);
  }
  const seen = new Set([projectId]);
  const queue = [projectId];
  while (queue.length > 0) {
    for (const id of beside.get(queue.pop()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  return graph.nodes.filter((n) => !seen.has(n.id)).map((n) => n.label);
}

describe('the cost register in the graph', () => {
  it('draws every record as a node of its kind, in its layer', () => {
    const { graph } = drawn();
    const count = (kind: Kind) => graph.nodes.filter((n) => n.kind === kind).length;
    assert.deepEqual(COST_KINDS.map(count), [3, 2, 3, 6, 2]);
    assert.deepEqual(COST_KINDS.map(projectLayerFor), ['structure', 'entity', 'evidence', 'claim', 'judgement']);
    for (const node of graph.nodes.filter(isCost)) {
      assert.equal(node.layer, projectLayerFor(node.kind));
      assert.equal(node.origin, 'derived');
    }
  });

  it('says a work package by its code and name, with where its budget stands', () => {
    const { project, graph, packages } = drawn();
    const said = (g: Graph, id: string) => [nodeOf(g, id).label, nodeOf(g, id).detail, nodeOf(g, id).status];
    assert.deepEqual(said(graph, packages.earthwork.id), ['A Earthwork', 'Budget ₹10,00,000 · claimed ₹5,00,000 · certified ₹4,00,000 · left of the budget ₹6,00,000', 'under_way']);
    assert.deepEqual(said(graph, packages.structure.id), ['B Structure', 'Budget ₹50,00,000 · claimed ₹16,00,000 · certified ₹5,40,000 · left of the budget ₹44,60,000', 'under_way']);
    assert.deepEqual(said(graph, packages.finishes.id), ['C Finishes', 'No budget set · claimed ₹2,00,000 · certified ₹0', 'under_way']);

    // One nothing has been billed against, and one whose budget is cut below what is certified already.
    const [external] = addWorkPackages(project, [{ name: 'External works', budget: 500_000 }], COST_LEAD);
    updateWorkPackage(project, packages.earthwork.id, { budget: 300_000 }, COST_LEAD);
    const after = buildProjectGraph(project);
    assert.deepEqual(said(after, external!.id), ['External works', 'Budget ₹5,00,000 · claimed ₹0 · certified ₹0 · left of the budget ₹5,00,000', 'not_started']);
    assert.deepEqual(said(after, packages.earthwork.id), ['A Earthwork', 'Budget ₹3,00,000 · claimed ₹5,00,000 · certified ₹4,00,000 · over budget by ₹1,00,000', 'over_budget']);
  });

  it('says a contract and a bill by the contractor, with what was certified and paid', () => {
    const { graph, contracts, bills } = drawn();
    const civil = nodeOf(graph, contracts.civil.id);
    assert.deepEqual([civil.label, civil.detail, civil.status], ['Sharma Constructions: Civil works', 'Contract value ₹45,00,000 · certified ₹9,40,000 · paid ₹8,00,000 · left to certify ₹35,60,000 · ref. WO-CIV-014', undefined]);
    assert.equal(nodeOf(graph, contracts.interiors.id).detail, 'Contract value ₹8,00,000 · certified ₹0 · paid ₹0 · left to certify ₹8,00,000');

    const said = (id: string) => [nodeOf(graph, id).label, nodeOf(graph, id).detail, nodeOf(graph, id).key, nodeOf(graph, id).status];
    assert.deepEqual(said(bills.ra1.id), ['Sharma Constructions bill RA-1', '2026-08-31 · claimed ₹10,00,000 · certified ₹9,40,000 gross, ₹8,74,200 net · paid ₹8,00,000', 'RA-1', 'certified']);
    assert.deepEqual(said(bills.ra2.id), ['Sharma Constructions bill RA-2', '2026-09-30 · claimed ₹11,50,000 · not certified · paid ₹0', 'RA-2', 'in_review']);
    assert.deepEqual(said(bills.f1.id), ['Lakshmi Interiors bill F-1', '2026-10-02 · claimed ₹2,00,000 · not certified · paid ₹0', 'F-1', 'claimed']);
  });

  it('names who passed a line and who signed the certificate, each by what they did', () => {
    // A junior passes the line. The certifier signs the certificate. Neither is said to have done what the other did.
    const project = createProject({ name: 'Two hands', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C5');
    const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', value: 4_500_000 }, COST_LEAD);
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [{ item: '2.4', description: 'RCC M30 in raft foundation', amount: 200_000, readBy: 'person' }] }, COST_LEAD);
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 200_000 }, 'junior@firm.in');
    const before = nodeOf(buildProjectGraph(project), bill.lines[0]!.id).detail;
    assert.equal(before, 'Sharma Constructions bill RA-1 · claimed ₹2,00,000 · passed ₹2,00,000 by junior@firm.in, no certificate');
    const certificate = certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, name: 'R. Menon', profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05' }, COST_CERTIFIER);
    const graph = buildProjectGraph(project);
    const said = nodeOf(graph, bill.lines[0]!.id).detail ?? '';
    assert.equal(said, 'Sharma Constructions bill RA-1 · claimed ₹2,00,000 · certified ₹2,00,000, passed by junior@firm.in');
    assert.doesNotMatch(said, /certified ₹[\d,]+ by /, 'the junior passed it, and certified nothing');
    assert.equal(nodeOf(graph, certificate.id).detail, 'R. Menon, Quantity Surveyor · gross ₹2,00,000 · no deductions · net ₹2,00,000 · 2026-09-05');
  });

  it('tells two contractors’ certificates apart when their bills share a number', () => {
    const { project, contracts, bills, certificates } = drawn();
    // Lakshmi Interiors also numbers a bill RA-1.
    const theirs = addBill(project, { contractId: contracts.interiors.id, number: 'RA-1', date: '2026-10-10', lines: [{ description: 'False ceiling', amount: 100_000, readBy: 'person' }] }, COST_LEAD);
    certifyLine(project, theirs.id, theirs.lines[0]!.id, { amount: 100_000 }, COST_CERTIFIER);
    const second = certifyBill(project, theirs.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-11' }, COST_CERTIFIER);
    const graph = buildProjectGraph(project);
    assert.deepEqual(
      [nodeOf(graph, certificates.ra1.id).label, nodeOf(graph, second.id).label],
      ['Certificate for Sharma Constructions bill RA-1', 'Certificate for Lakshmi Interiors bill RA-1'],
    );
    assert.deepEqual([nodeOf(graph, bills.ra1.id).label, nodeOf(graph, theirs.id).label], ['Sharma Constructions bill RA-1', 'Lakshmi Interiors bill RA-1']);
    const labels = graph.nodes.filter((n) => n.kind === 'certification').map((n) => n.label);
    assert.equal(new Set(labels).size, labels.length, 'no two certificates are called the same');
  });

  it('says what is over: paid beyond what was payable, and certified beyond the contract', () => {
    const { project, contracts, bills } = drawn();
    // RA-1 is payable at 8,74,200 and has 8,00,000 paid. 74,300 more is 100 too much.
    recordPayment(project, bills.ra1.id, { amount: 74_300, paidOn: '2026-10-01' }, COST_ACCOUNTS);
    // The interiors contract is for 8,00,000. A second bill of 7,00,000 passed in full takes what is certified to 9,00,000.
    certifyLine(project, bills.f1.id, bills.f1.lines[0]!.id, { amount: 200_000 }, COST_CERTIFIER);
    certifyBill(project, bills.f1.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-06' }, COST_CERTIFIER);
    const more = addBill(project, { contractId: contracts.interiors.id, number: 'F-2', date: '2026-10-20', lines: [{ description: 'False ceiling', amount: 700_000, readBy: 'person' }] }, COST_LEAD);
    certifyLine(project, more.id, more.lines[0]!.id, { amount: 700_000 }, COST_CERTIFIER);
    certifyBill(project, more.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-10-21' }, COST_CERTIFIER);

    const graph = buildProjectGraph(project);
    assert.deepEqual(
      [nodeOf(graph, bills.ra1.id).detail, nodeOf(graph, bills.ra1.id).status],
      ['2026-08-31 · claimed ₹10,00,000 · certified ₹9,40,000 gross, ₹8,74,200 net · paid ₹8,74,300 · overpaid by ₹100', 'paid'],
    );
    assert.equal(nodeOf(graph, contracts.interiors.id).detail, 'Contract value ₹8,00,000 · certified ₹9,00,000 · paid ₹0 · certified beyond the contract value by ₹1,00,000');
  });

  it('says a bill line by its item, with its amounts, what was passed for it and where it was read', () => {
    const { project, graph, contracts, lines } = drawn();
    const said = (id: string) => [nodeOf(graph, id).label, nodeOf(graph, id).detail, nodeOf(graph, id).status];
    assert.deepEqual(said(lines.excavation.id), [
      '1.1 Excavation in ordinary soil',
      'Sharma Constructions bill RA-1 · work package A Earthwork · claimed ₹4,00,000 · 1,000 cum to date at ₹400 per cum · amount to date ₹4,00,000 · previously ₹0 · certified ₹4,00,000, passed by qs@firm.in · sheet “RA 1”, cell H12',
      'certified',
    ]);
    assert.deepEqual(said(lines.raft.id), [
      '2.4 RCC M30 in raft foundation',
      'Sharma Constructions bill RA-1 · work package B Structure · claimed ₹6,00,000 · 200 cum to date at ₹3,000 per cum · amount to date ₹6,00,000 · previously ₹0 · certified ₹5,40,000 for 180 cum, passed by qs@firm.in: 20 cum of the raft is not yet cast · sheet “RA 1”, cell H19',
      'adjusted',
    ]);
    // RA-2's certificate was withdrawn. What was passed on its lines is a decision and certifies nothing, and the line says so.
    // A page a model read says that it was, as a model's reading of a photograph does.
    assert.deepEqual(said(lines.columns.id), [
      '2.6 RCC M30 in columns, ground floor',
      'Sharma Constructions bill RA-2 · work package B Structure · claimed ₹10,00,000 · 250 cum to date at ₹4,000 per cum · amount to date ₹10,00,000 · previously ₹0 · passed ₹10,00,000 by qs@firm.in, no certificate · p. 2, read by a model',
      'decided',
    ]);
    // A variation prices no package, so it names none.
    assert.deepEqual(said(lines.rock.id), [
      'V-1 Extra rock cutting below the basement',
      'Sharma Constructions bill RA-2 · claimed ₹50,000 · passed ₹0 by qs@firm.in, no certificate: No instruction was given for it · p. 3, read by a model · variation',
      'decided',
    ]);
    // A line a person typed, with neither a quantity nor a rate, and nobody has decided it.
    assert.deepEqual(said(lines.painting.id), ['7.1 Internal painting, two coats', 'Lakshmi Interiors bill F-1 · work package C Finishes · claimed ₹2,00,000 · not yet decided', 'claimed']);
    for (const node of graph.nodes.filter((n) => n.kind === 'bill_line')) {
      assert.equal(/certified ₹/.test(node.detail ?? ''), node.status === 'certified' || node.status === 'adjusted', `${node.label} says certified, and is ${node.status}`);
    }

    // A rate with no quantity is said as a rate, and a long description is cut for the label.
    const long = addBill(
      project,
      { contractId: contracts.interiors.id, number: 'F-2', date: '2026-10-05', lines: [{ description: `Providing and fixing ${'vitrified tiles '.repeat(20)}`, unit: 'sqm', rate: 950, amount: 95_000, readBy: 'person' }] },
      COST_LEAD,
    );
    const node = nodeOf(buildProjectGraph(project), long.lines[0]!.id);
    assert.equal(node.label.length, 120);
    assert.equal(node.detail, 'Lakshmi Interiors bill F-2 · claimed ₹95,000 · rate ₹950 per sqm · not yet decided');
  });

  it('says a certificate by its bill, with who signed it, and says so when it was withdrawn', () => {
    const { graph, certificates } = drawn();
    const stands = nodeOf(graph, certificates.ra1.id);
    assert.deepEqual(
      [stands.label, stands.detail, stands.status],
      ['Certificate for Sharma Constructions bill RA-1', 'R. Menon, Quantity Surveyor · gross ₹9,40,000 · less retention ₹47,000, TDS 2% ₹18,800 · net ₹8,74,200 · 2026-09-05', 'current'],
    );
    // The chat is handed the label and the detail, not the status. A certificate that certifies nothing has to say so in words.
    const gone = nodeOf(graph, certificates.ra2.id);
    assert.deepEqual([gone.label, gone.status], ['Certificate for Sharma Constructions bill RA-2', 'withdrawn']);
    assert.match(
      gone.detail ?? '',
      /^Withdrawn \d{4}-\d{2}-\d{2}: The rate of item 2\.6 is to be checked · qs@firm\.in, Quantity Surveyor · gross ₹10,80,000 · less retention ₹54,000 · net ₹10,26,000 · 2026-10-03$/,
      'the signer by their address, where no name was given',
    );
  });

  it('writes money in the project’s own currency', () => {
    const project = createProject({ name: 'Euro register', type: 'residential', location: 'Dublin', city: 'Dublin', currentStage: 'construction', currency: 'EUR' }, 'RYT-E2');
    const [pack] = addWorkPackages(project, [{ name: 'Shell', budget: 2_000_000 }], COST_LEAD);
    const contract = addContract(project, { contractor: 'Murphy Builders', title: 'Shell and core', workPackageIds: [pack!.id], value: 1_250_000 }, COST_LEAD);
    const bill = addBill(project, { contractId: contract.id, number: 'RA-1', date: '2026-08-31', lines: [{ description: 'Ground slab', workPackageId: pack!.id, unit: 'sqm', rate: 80.5, quantityToDate: 1000, amount: 80_500, readBy: 'person' }] }, COST_LEAD);
    certifyLine(project, bill.id, bill.lines[0]!.id, { amount: 80_500 }, COST_CERTIFIER);
    const certificate = certifyBill(project, bill.id, { signer: { email: COST_CERTIFIER, profession: 'Quantity Surveyor' }, certifiedOn: '2026-09-05', deductions: [{ kind: 'retention', amount: 4025 }] }, COST_CERTIFIER);
    const graph = buildProjectGraph(project);
    assert.equal(nodeOf(graph, pack!.id).detail, 'Budget €2,000,000 · claimed €80,500 · certified €80,500 · left of the budget €1,919,500');
    assert.equal(nodeOf(graph, contract.id).detail, 'Contract value €1,250,000 · certified €80,500 · paid €0 · left to certify €1,169,500');
    assert.equal(nodeOf(graph, bill.id).detail, '2026-08-31 · claimed €80,500 · certified €80,500 gross, €76,475 net · paid €0');
    assert.equal(nodeOf(graph, bill.lines[0]!.id).detail, 'Murphy Builders bill RA-1 · work package Shell · claimed €80,500 · 1,000 sqm to date at €80.50 per sqm · certified €80,500, passed by qs@firm.in');
    assert.equal(nodeOf(graph, certificate.id).detail, 'qs@firm.in, Quantity Surveyor · gross €80,500 · less retention €4,025 · net €76,475 · 2026-09-05');
    assert.ok(!JSON.stringify(graph).includes('₹'), 'no rupee is written on a project kept in euros');
  });

  it('joins them by every relation the register has', () => {
    const { graph } = drawn();
    assert.deepEqual(joined(graph, 'covers'), ['Lakshmi Interiors: Finishes > C Finishes', 'Sharma Constructions: Civil works > A Earthwork', 'Sharma Constructions: Civil works > B Structure']);
    assert.deepEqual(joined(graph, 'billed_under'), [
      'Lakshmi Interiors bill F-1 > Lakshmi Interiors: Finishes',
      'Sharma Constructions bill RA-1 > Sharma Constructions: Civil works',
      'Sharma Constructions bill RA-2 > Sharma Constructions: Civil works',
    ]);
    assert.deepEqual(joined(graph, 'has_line'), [
      'Lakshmi Interiors bill F-1 > 7.1 Internal painting, two coats',
      'Sharma Constructions bill RA-1 > 1.1 Excavation in ordinary soil',
      'Sharma Constructions bill RA-1 > 2.4 RCC M30 in raft foundation',
      'Sharma Constructions bill RA-2 > 1.3 Backfilling with excavated earth',
      'Sharma Constructions bill RA-2 > 2.6 RCC M30 in columns, ground floor',
      'Sharma Constructions bill RA-2 > V-1 Extra rock cutting below the basement',
    ]);
    // The variation prices no package: it is outside what the contract covers.
    assert.deepEqual(joined(graph, 'prices'), [
      '1.1 Excavation in ordinary soil > A Earthwork',
      '1.3 Backfilling with excavated earth > A Earthwork',
      '2.4 RCC M30 in raft foundation > B Structure',
      '2.6 RCC M30 in columns, ground floor > B Structure',
      '7.1 Internal painting, two coats > C Finishes',
    ]);
    // A certificate that was withdrawn is still joined to the bill it was issued on.
    assert.deepEqual(joined(graph, 'certifies_bill'), ['Certificate for Sharma Constructions bill RA-1 > Sharma Constructions bill RA-1', 'Certificate for Sharma Constructions bill RA-2 > Sharma Constructions bill RA-2']);
    assert.deepEqual(joined(graph, 'measured_against'), ['B Structure > Foundation and basement']);
  });

  it('places them in Budget, on their papers and in the stage they arrived in', () => {
    const { graph } = drawn();
    // Budget holds a package, a contract and a bill. A line and a certificate arrive under their bill.
    assert.deepEqual(joined(graph, 'holds', isCost), [
      'Budget > A Earthwork',
      'Budget > B Structure',
      'Budget > C Finishes',
      'Budget > Lakshmi Interiors bill F-1',
      'Budget > Lakshmi Interiors: Finishes',
      'Budget > Sharma Constructions bill RA-1',
      'Budget > Sharma Constructions bill RA-2',
      'Budget > Sharma Constructions: Civil works',
    ]);
    assert.deepEqual(joined(graph, 'supported_by', isCost), [
      '1.1 Excavation in ordinary soil > RA Bill 1.xlsx',
      '1.3 Backfilling with excavated earth > RA Bill 2.pdf',
      '2.4 RCC M30 in raft foundation > RA Bill 1.xlsx',
      '2.6 RCC M30 in columns, ground floor > RA Bill 2.pdf',
      'A Earthwork > Budget sheet.xlsx',
      'B Structure > Budget sheet.xlsx',
      'Certificate for Sharma Constructions bill RA-1 > Payment certificate 1.pdf',
      'Sharma Constructions bill RA-1 > RA Bill 1.xlsx',
      'Sharma Constructions bill RA-2 > RA Bill 2.pdf',
      'Sharma Constructions: Civil works > Work order WO-CIV-014.pdf',
      'V-1 Extra rock cutting below the basement > RA Bill 2.pdf',
    ]);
    assert.deepEqual(joined(graph, 'in_stage', isCost), [
      'Certificate for Sharma Constructions bill RA-1 > Under construction',
      'Certificate for Sharma Constructions bill RA-2 > Under construction',
      'Lakshmi Interiors bill F-1 > Under construction',
      'Sharma Constructions bill RA-1 > Under construction',
      'Sharma Constructions bill RA-2 > Under construction',
    ]);
    assert.deepEqual(joined(graph, 'has_record', isCost), [], 'none of them is tied to the project: each is placed');
  });

  it('keeps to the ontology, reaches every node, and builds the same graph twice', () => {
    const { project, graph } = drawn();
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(unreached(graph, project.id), []);
    assert.equal(JSON.stringify(buildProjectGraph(project)), JSON.stringify(graph), 'not byte-identical on a rebuild');
    const ids = graph.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'no two records share a node');
  });

  it('draws nothing for a project that keeps no register, and nothing for an empty one', () => {
    const project = createProject({ name: 'No register', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C0');
    const before = buildProjectGraph(project);
    assert.deepEqual(before.nodes.filter(isCost), []);
    assert.deepEqual(before.edges.filter((edge) => (COST_RELATIONS as readonly string[]).includes(edge.rel)), []);

    // A register begun and emptied again is on the record and draws nothing, so the graph is the one it was.
    const [pack] = addWorkPackages(project, [{ name: 'Structure' }], COST_LEAD);
    assert.notEqual(JSON.stringify(buildProjectGraph(project)), JSON.stringify(before));
    removeWorkPackage(project, pack!.id, COST_LEAD);
    assert.deepEqual(project.cost, { workPackages: [], contracts: [], bills: [] });
    assert.equal(JSON.stringify(buildProjectGraph(project)), JSON.stringify(before));
  });

  it('is still reached with Finance switched off, when no Budget holds it', () => {
    const { project } = drawn();
    setProjectDepartments(project, ['legal', 'construction'], COST_LEAD);
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(joined(graph, 'holds', isCost), [], 'no function holds a cost record');
    assert.deepEqual(unreached(graph, project.id), []);
    assert.equal(graph.nodes.filter(isCost).length, 16, 'and every one of them is still drawn');

    // A package and a contract with no bill under them have no date to place them by. They are tied to the project.
    const lean = createProject({ name: 'Finance off', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C2');
    setProjectDepartments(lean, ['legal'], COST_LEAD);
    const [pack] = addWorkPackages(lean, [{ name: 'Structure' }], COST_LEAD);
    addContract(lean, { contractor: 'Sharma Constructions', title: 'Civil works', workPackageIds: [pack!.id], value: 1000 }, COST_LEAD);
    addContract(lean, { contractor: 'Acme Lifts', title: 'Lifts', value: 1000 }, COST_LEAD);
    const tied = buildProjectGraph(lean);
    assert.deepEqual(validateProjectGraph(tied), []);
    assert.deepEqual(unreached(tied, lean.id), []);
    // One tie reaches the package and, through it, the contract that covers it. The contract that covers nothing has its own.
    assert.deepEqual(joined(tied, 'has_record', isCost), ['Finance off > Acme Lifts: Lifts', 'Finance off > Structure']);
    for (const kind of ['work_package', 'contract', 'bill'] as const) assert.equal(projectEdgeEndpointsValid('has_record', 'project', kind), true, kind);
    for (const kind of ['bill_line', 'certification'] as const) assert.equal(projectEdgeEndpointsValid('has_record', 'project', kind), false, `${kind} arrives under its bill`);
  });
});

describe('finding a cost record, and what the chat is handed', () => {
  it('finds a bill line by a word of its description', () => {
    const { graph, lines } = drawn();
    assert.deepEqual(findProjectNodes(graph, 'raft').map((n) => n.id), [lines.raft.id]);
    assert.deepEqual(findProjectNodes(graph, 'Backfilling').map((n) => n.id), [lines.backfill.id]);
    // And by what its detail says: the cell it was read from, the reason it was adjusted.
    assert.deepEqual(findProjectNodes(graph, 'cell H19').map((n) => n.id), [lines.raft.id]);
    assert.deepEqual(findProjectNodes(graph, 'not compacted').map((n) => n.id), [lines.backfill.id]);
  });

  it('hands the chat a line with its claimed and certified amounts and its page or cell in words', () => {
    const { project, graph, lines, bills, packages, papers } = drawn();
    const text = serializeProjectSubgraph(extractProjectSubgraph(graph, [lines.raft.id], 1));
    assert.ok(
      text.includes(
        `[${lines.raft.id}] bill_line: 2.4 RCC M30 in raft foundation (Sharma Constructions bill RA-1 · work package B Structure · claimed ₹6,00,000 · 200 cum to date at ₹3,000 per cum · amount to date ₹6,00,000 · previously ₹0 · certified ₹5,40,000 for 180 cum, passed by qs@firm.in: 20 cum of the raft is not yet cast · sheet “RA 1”, cell H19)`,
      ),
      text,
    );
    // Its links are said in words, from the bill to the line and from the line to its package and its paper.
    assert.ok(text.includes(`[${bills.ra1.id}] has the line [${lines.raft.id}]`), text);
    assert.ok(text.includes(`[${lines.raft.id}] prices [${packages.structure.id}]`), text);
    assert.ok(text.includes(`[${lines.raft.id}] rests on [${papers.ra1.id}]`), text);
    // A key is told from its words by its underscore: `prices` and `covers` are said as they are keyed.
    for (const key of [...COST_RELATIONS, 'supported_by'].filter((rel) => rel.includes('_'))) assert.ok(!text.includes(key), `${key} reaches the chat as a key`);

    // The same by the question's own words, the way the chat asks: a line a model read off a page says its page.
    const asked = retrieveProjectNeighbourhood(project, 'columns, ground floor', 1);
    assert.deepEqual(asked.seeds.map((n) => n.id), [lines.columns.id]);
    assert.match(serializeProjectSubgraph(asked.graph), /claimed ₹10,00,000 · .* · passed ₹10,00,000 by qs@firm\.in, no certificate · p\. 2, read by a model\)/);
  });

  it('keeps two hops from a line small, on a register of twelve bills of 150 lines', () => {
    const { project, bills, packs, contract, sheets } = largeRegister();
    const graph = buildProjectGraph(project);
    const linesIn = (sub: Graph) => sub.nodes.filter((n) => n.kind === 'bill_line').map((n) => n.id);
    assert.equal(linesIn(graph).length, 1800);

    // The line, its bill, its package and its sheet, and what those lead on to. Not the bill's other 149 lines, nor the 600
    // that price the same package, nor the 149 read off the same sheet.
    const seed = bills[0]!.lines[0]!;
    const sub = extractProjectSubgraph(graph, [seed.id], 2);
    assert.deepEqual(linesIn(sub), [seed.id]);
    for (const id of [bills[0]!.id, packs[0]!.id, sheets[0]!, contract.id]) assert.ok(sub.nodes.some((n) => n.id === id), `${nodeOf(graph, id).label} is not in the neighbourhood`);
    assert.ok(sub.nodes.length <= 12, `${sub.nodes.length} nodes`);
    // It says where it sits without them.
    assert.match(nodeOf(sub, seed.id).detail ?? '', /^Sharma Constructions bill RA-1 · work package A Earthwork · claimed ₹1,000 · /);
    // At three hops, the most the chat may ask for, it reaches the other bills and still none of their lines.
    const wide = extractProjectSubgraph(graph, [seed.id], 3);
    assert.deepEqual(linesIn(wide), [seed.id]);
    assert.equal(wide.nodes.filter((n) => n.kind === 'bill').length, 12);

    // The way the chat asks: a word, at two hops. Five lines are taken as seeds, and no other line comes with them.
    const asked = retrieveProjectNeighbourhood(project, 'raft', 2);
    assert.equal(asked.seeds.length, 5);
    assert.deepEqual(linesIn(asked.graph), asked.seeds.map((n) => n.id));
    const text = serializeProjectSubgraph(asked.graph);
    assert.ok(asked.graph.nodes.length <= 30 && text.length < 12_000, `${asked.graph.nodes.length} nodes and ${text.length} characters`);
  });

  it('still brings a bill its own lines, a package the lines that price it, and a sheet the lines read off it', () => {
    const { project, bills, packs, sheets } = largeRegister();
    const graph = buildProjectGraph(project);
    const linesIn = (sub: Graph) => new Set(sub.nodes.filter((n) => n.kind === 'bill_line').map((n) => n.id));
    const own = new Set(bills[0]!.lines.map((row) => row.id));
    // What was asked about brings its lines: they are one step from the seed.
    assert.deepEqual(linesIn(extractProjectSubgraph(graph, [bills[0]!.id], 1)), own);
    assert.deepEqual(linesIn(extractProjectSubgraph(graph, [bills[0]!.id], 2)), own, 'its own 150 at two hops too, and no other bill’s');
    assert.deepEqual(linesIn(extractProjectSubgraph(graph, [sheets[0]!], 1)), own);
    // A line that was only reached on the way brings neither its package nor its bill: it names them in its own words.
    const read = extractProjectSubgraph(graph, [sheets[0]!], 2);
    assert.deepEqual([linesIn(read).size, read.nodes.filter((n) => n.kind === 'work_package').length], [150, 0]);
    assert.ok([...linesIn(read)].every((id) => /^Sharma Constructions bill RA-1 · work package [ABC] /.test(nodeOf(read, id).detail ?? '')));
    assert.equal(linesIn(extractProjectSubgraph(graph, [packs[2]!.id], 2)).size, 600, 'every third line of every bill prices it');
    // The contract was asked about, not its bills: it brings the twelve of them and none of their lines.
    const awarded = extractProjectSubgraph(graph, [bills[0]!.contractId], 2);
    assert.deepEqual([awarded.nodes.filter((n) => n.kind === 'bill').length, linesIn(awarded).size], [12, 0]);
  });

  it('says when a word matched more records than it took as seeds', async () => {
    // Eight bills, each with a line for the same waterproofing. Five are taken as seeds whatever the depth.
    const project = createProject({ name: 'Eight bills', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' }, 'RYT-C6');
    const contract = addContract(project, { contractor: 'Sharma Constructions', title: 'Civil works', value: 9_000_000 }, COST_LEAD);
    for (let n = 1; n <= 8; n += 1) {
      addBill(project, { contractId: contract.id, number: `RA-${n}`, date: `2026-0${n}-28`, lines: [{ item: `${n}.1`, description: 'Waterproofing to basement raft', amount: 10_000 * n, readBy: 'person' }] }, COST_LEAD);
    }
    for (const hops of [1, 2, 3]) {
      const asked = retrieveProjectNeighbourhood(project, 'waterproofing', hops);
      assert.deepEqual([asked.seeds.length, asked.matches], [5, 8], `at ${hops} hops`);
      assert.equal(asked.graph.nodes.filter((n) => n.kind === 'bill_line').length, 5);
      const header = serializeProjectSubgraph(asked.graph, 'live', { seeds: asked.seeds.length, matches: asked.matches }).split('\n')[1]!;
      assert.match(header, /^source=live nodes=\d+ edges=\d+ seeds=5 of 8 matches \(3 more matched and are not here: narrow the search\)$/);
    }
    // Narrowed to one bill, everything that matched is there and the header says nothing of seeds.
    const narrow = retrieveProjectNeighbourhood(project, 'RA-3', 1);
    assert.equal(narrow.matches, narrow.seeds.length);
    const whole = serializeProjectSubgraph(narrow.graph, 'live', { seeds: narrow.seeds.length, matches: narrow.matches }).split('\n')[1]!;
    assert.match(whole, /^source=live nodes=\d+ edges=\d+$/);
    assert.match(serializeProjectSubgraph(narrow.graph).split('\n')[1]!, /^source=live nodes=\d+ edges=\d+$/, 'and nothing where no count was given');
    assert.match(serializeProjectSubgraph(narrow.graph, 'live', { seeds: 5, matches: 6 }), /seeds=5 of 6 matches \(1 more matched and is not here: narrow the search\)/);

    // The chat's own tool builds its seeds itself. It says the same.
    const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] };
    const tools = createProjectTools(project, 'tester', bag) as unknown as Array<{ name: string; run: (args: never, context: never) => Promise<string> | string }>;
    const subgraph = tools.find((tool) => tool.name === 'get_subgraph')!;
    const handed = String(await subgraph.run({ query: 'waterproofing', hops: 2 } as never, {} as never));
    assert.match(handed.split('\n')[1]!, /seeds=5 of 8 matches \(3 more matched and are not here: narrow the search\)$/);
    assert.doesNotMatch(String(await subgraph.run({ query: 'RA-3', hops: 1 } as never, {} as never)).split('\n')[1]!, /seeds=/);
  });

  it('puts what is called by a word before what only mentions it', () => {
    const { graph, certificates, lines } = drawn();
    // The three lines of RA-2 say "no certificate" in their detail, and are written before the certificates of their bills.
    const found = findProjectNodes(graph, 'certificate');
    const at = (id: string) => found.findIndex((n) => n.id === id);
    const mentions = [lines.columns.id, lines.backfill.id, lines.rock.id];
    for (const id of mentions) assert.ok(at(id) !== -1, 'a line that says the word is still found');
    for (const certificate of [certificates.ra1.id, certificates.ra2.id]) {
      for (const id of mentions) assert.ok(at(certificate) < at(id), `${nodeOf(graph, certificate).label} comes after ${nodeOf(graph, id).label}`);
    }
    // Everything the word names comes first, in the graph's own order, and then everything that only says it, in the graph's own order.
    const named = found.filter((n) => n.label.toLowerCase().includes('certificate'));
    assert.deepEqual(found.slice(0, named.length), named);
    const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
    for (const group of [named, found.slice(named.length)]) {
      assert.deepEqual(group.map((n) => n.id), [...group].sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((n) => n.id));
    }
    // So both certificates are among the five seeds, and no line has taken the place of one.
    const seeds = found.slice(0, 5).map((n) => n.id);
    assert.ok(seeds.includes(certificates.ra1.id) && seeds.includes(certificates.ra2.id));
    // A kind's own word counts as its name: every bill comes before a line that only says "bill" in its detail.
    const bills = findProjectNodes(graph, 'bill');
    const firstLine = bills.findIndex((n) => n.kind === 'bill_line');
    assert.ok(firstLine > 0 && bills.slice(firstLine).every((n) => n.kind !== 'bill'), 'no bill comes after the first line');
  });

  it('finds every node of a kind by the words a cost consultant uses', () => {
    const { graph } = drawn();
    const found = (words: string, kind: Kind) => findProjectNodes(graph, words).filter((n) => n.kind === kind).length;
    assert.deepEqual(findProjectNodes(graph, 'bills').map((n) => n.label), ['Sharma Constructions bill RA-1', 'Sharma Constructions bill RA-2', 'Lakshmi Interiors bill F-1'], '"bills" finds every bill and nothing else');
    for (const [words, kind, count] of [
      ['Bills', 'bill', 3],
      ['running bill', 'bill', 3],
      ['running bills', 'bill', 3],
      ['work package', 'work_package', 3],
      ['work packages', 'work_package', 3],
      ['work_package', 'work_package', 3],
      ['contracts', 'contract', 2],
      ['bill lines', 'bill_line', 6],
      ['bill line', 'bill_line', 6],
      ['certificates', 'certification', 2],
      ['certificate', 'certification', 2],
      ['certifications', 'certification', 2],
    ] as const) {
      assert.equal(found(words, kind), count, `"${words}"`);
    }
  });

  it('walks a trace from a certificate down to its bill, the lines and the papers they were read from', () => {
    const { graph, certificates, bills, lines, papers, contracts } = drawn();
    const cone = traceProjectNode(graph, certificates.ra1.id);
    assert.ok(cone);
    const reached = new Set(cone.nodes.map((n) => n.id));
    for (const id of [certificates.ra1.id, bills.ra1.id, lines.excavation.id, lines.raft.id]) assert.ok(reached.has(id), `${nodeOf(graph, id).label} is not in the trace`);
    assert.ok(reached.has(papers.ra1.id), 'the sheet the lines were read from');
    assert.ok(reached.has(papers.certificate.id), 'and the signed certificate itself');
    // What it rests on, and no more: not the other bill, nor the contract it was raised under.
    for (const id of [bills.ra2.id, lines.columns.id, papers.ra2.id, contracts.civil.id]) assert.ok(!reached.has(id), `${nodeOf(graph, id).label} is no part of what this certificate rests on`);
    const text = serializeProjectSubgraph(cone);
    assert.ok(text.includes(`[${certificates.ra1.id}] is a certificate for [${bills.ra1.id}]`), text);
    assert.ok(text.includes(`[${lines.raft.id}] rests on [${papers.ra1.id}]`), text);

    // A trace from a bill goes down to its lines, and one from a line to its paper and no further.
    assert.deepEqual(new Set(traceProjectNode(graph, bills.ra2.id)!.nodes.map((n) => n.id)), new Set([bills.ra2.id, lines.columns.id, lines.backfill.id, lines.rock.id, papers.ra2.id]));
    assert.deepEqual(new Set(traceProjectNode(graph, lines.painting.id)!.nodes.map((n) => n.id)), new Set([lines.painting.id]));
  });

  it('says each relation in words that stay true of a certificate that was withdrawn', () => {
    const { graph, bills } = drawn();
    assert.deepEqual(PROJECT_EDGE_LABEL.covers, { forward: 'covers', backward: 'is covered by' });
    assert.deepEqual(PROJECT_EDGE_LABEL.billed_under, { forward: 'is billed under', backward: 'has the bill' });
    assert.deepEqual(PROJECT_EDGE_LABEL.has_line, { forward: 'has the line', backward: 'is a line of' });
    assert.deepEqual(PROJECT_EDGE_LABEL.prices, { forward: 'prices', backward: 'is priced by' });
    assert.deepEqual(PROJECT_EDGE_LABEL.measured_against, { forward: 'is measured against', backward: 'measures' });
    // A withdrawn certificate certifies nothing. It is still the certificate that was issued for that bill.
    assert.deepEqual(PROJECT_EDGE_LABEL.certifies_bill, { forward: 'is a certificate for', backward: 'has the certificate' });
    const reopened = nodeOf(graph, bills.ra2.id);
    assert.deepEqual([projectEdgePhrase('certifies_bill', 'forward', reopened), projectEdgePhrase('certifies_bill', 'backward', reopened)], ['is a certificate for', 'has the certificate']);
    // Budget holds a bill that is in hand: none of the words for a paper still awaited.
    assert.equal(projectEdgePhrase('holds', 'forward', reopened), 'holds');
  });
});

function grantOf(over: Partial<ProjectGrant> = {}): ProjectGrant {
  return {
    id: 'grant-1',
    tenantId: 't1',
    projectId: 'p1',
    email: 'contractor@outside.in',
    role: 'contributor',
    allAssessments: true,
    allScopes: true,
    assessmentIds: [],
    scopeKeys: [],
    areas: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'dev@firm.in',
    ...over,
  };
}

function seenBy(project: DdProject, over: Partial<ProjectGrant> = {}) {
  return projectView(project, { kind: 'granted', grant: grantOf(over), email: 'contractor@outside.in' });
}

/** Every id the register holds: its packages, contracts, bills, lines, payments and certificates. */
function costIds(project: DdProject): string[] {
  const cost = project.cost!;
  return [
    ...cost.workPackages.map((pack) => pack.id),
    ...cost.contracts.map((contract) => contract.id),
    ...cost.bills.flatMap((bill) => [bill.id, ...bill.lines.map((row) => row.id), ...bill.payments.map((payment) => payment.id), ...bill.certifications.map((certificate) => certificate.id)]),
  ];
}

describe('who may see the cost register', () => {
  it('keeps all of it from a collaborator whose grant leaves out the budget and figures', () => {
    const { project } = costExample();
    const ids = costIds(project);
    assert.equal(ids.length, 3 + 2 + 3 + 6 + 1 + 2, 'three packages, two contracts, three bills, six lines, a payment and two certificates');
    // Everything else is ticked, so what is missing is missing for this reason alone.
    const view = seenBy(project, { areas: GRANT_AREAS.filter((area) => area !== 'commercials') });
    assert.equal(view.project.cost, undefined);
    assert.ok(view.withheld.includes('commercials'), 'and they are told it was withheld, not that there is none');
    // Asked in the register's own phrases, they are told it is withheld. Never that there are none.
    for (const question of [
      'What is the budget for the structure?',
      'Which bills has Sharma raised?',
      'Has Sharma raised a bill this month?',
      'Which bills did the contractor raise last month?',
      'What is the retention held on the civil contract?',
      'How much retention money is with us?',
      'Show me the latest running bill',
      'Is RA bill 3 certified?',
      'Where is the contractor’s bill for August?',
      'Has the payment certificate gone out?',
      'Show me the work packages',
      'What is the contract value?',
      'What is the cost to complete?',
    ]) {
      assert.match(withheldAnswer(view, question) ?? '', /You do not have access to the budget, contracts, bills and payments on this project\./, question);
    }
    // The bare words are other things too: a paper filed as address proof, a tax receipt, a clause, an occupancy certificate.
    // A question about one of those is answered, not refused.
    for (const question of [
      'Is the latest electricity bill on file as address proof?',
      'Is the property tax payment receipt in?',
      'Was the payment of stamp duty recorded on the deed?',
      'Does the agreement have a retention of title clause?',
      'Is the occupancy certificate in?',
      'Who certified the title?',
    ]) {
      assert.equal(withheldAnswer(view, question), undefined, question);
    }
    // What the phrases miss the briefing covers: the model is told by name what this person has not been given.
    assert.match(withheldBriefing(view) ?? '', /They have not been given: [^.]*the budget, contracts, bills and payments on this project\./);

    const copy = JSON.stringify(view.project);
    for (const word of ['Sharma Constructions', 'raft foundation', 'Quantity Surveyor', 'NEFT 4471', 'Rock in the basement']) assert.equal(copy.includes(word), false, `“${word}” reaches them`);
    for (const id of ids) assert.equal(copy.includes(id), false, `${id} reaches them`);

    // The write gate takes the ids on the real file that are not on their copy. Every cost id is one.
    const theirs = projectRecordIds(view.project);
    const outOfReach = [...projectRecordIds(project)].filter((id) => !theirs.has(id));
    for (const id of ids) assert.ok(outOfReach.includes(id), `${id} is in their reach`);

    // The graph they are served is built from their copy: it draws none of the register.
    const graph = buildProjectGraph(view.project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(graph.nodes.filter(isCost), []);
    assert.ok(!graph.nodes.some((n) => ids.includes(n.id)));
    assert.deepEqual(findProjectNodes(graph, 'bills'), []);
  });

  it('hands it over when the budget and figures are ticked', () => {
    const { project } = costExample();
    const view = seenBy(project, { areas: ['commercials'] });
    assert.deepEqual(view.project.cost, project.cost);
    assert.ok(!view.withheld.includes('commercials'));
    const theirs = projectRecordIds(view.project);
    for (const id of costIds(project)) assert.ok(theirs.has(id), `${id} is out of their reach`);

    // The papers are not theirs to see, so the graph draws the register with no paper under it, and no edge to nothing.
    const graph = buildProjectGraph(view.project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.equal(graph.nodes.filter(isCost).length, 16);
    assert.deepEqual(joined(graph, 'supported_by', isCost), []);
    assert.equal(joined(graph, 'has_line').length, 6);
  });

  it('reports nothing withheld where there is no register and no budget to withhold', () => {
    const project = createProject({ name: 'Nothing kept', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C3');
    assert.ok(!seenBy(project).withheld.includes('commercials'));
    // A register begun and emptied holds nothing.
    const [pack] = addWorkPackages(project, [{ name: 'Structure' }], COST_LEAD);
    assert.ok(seenBy(project).withheld.includes('commercials'));
    removeWorkPackage(project, pack!.id, COST_LEAD);
    assert.ok(!seenBy(project).withheld.includes('commercials'));
    // A forecast alone is a figure.
    setCostForecast(project, { finalCost: 6_500_000 }, COST_LEAD);
    const view = seenBy(project);
    assert.ok(view.withheld.includes('commercials'));
    assert.equal(view.project.cost, undefined);
  });
});
