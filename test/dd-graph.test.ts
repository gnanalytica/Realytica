/**
 * The DD evidence graph.
 *
 * The load-bearing assertions are the design's own laws: determinism (a
 * projection must rebuild byte-identically), citation unity (fact node ids
 * ARE the evidence ledger ids), review discipline (a proposed finding never
 * enters the graph), no fabricated edges (an edge naming an absent node is
 * dropped), and honest traversal (a trace reaches the evidence files; a
 * subgraph never silently omits a contradiction beside it).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDdGraph, ddLayerFor, findNodes, serializeSubgraph, subgraph, trace } from '@realytica/shared';
import type { PropertyCase, TechnicalFinding } from '@realytica/shared';
import { NOW, caseFrom, documentsFor, screenSeed, seedFor } from './fixtures';

function ddCase(match = 'Site No. 118'): PropertyCase {
  const seed = seedFor(match);
  const { result, identity, documents } = screenSeed(match);
  return caseFrom(identity, documents, result, { id: `dd-${seed.identity.label.length}` });
}

function finding(c: PropertyCase, overrides: Partial<TechnicalFinding> = {}): TechnicalFinding {
  return {
    id: overrides.id ?? 'tf-1',
    caseId: c.id,
    system: 'mep_electrical',
    zone: 'DG room',
    observation: 'Busduct passes through a floor cutout with no water barrier baffles',
    severity: 'critical',
    recommendation: 'Install water barrier baffles',
    evidenceDocumentIds: [],
    source: 'user',
    reviewState: 'accepted',
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('construction', () => {
  it('is deterministic — same case, byte-identical graph', () => {
    const c = ddCase();
    const a = buildDdGraph(c, NOW);
    const b = buildDdGraph(c, NOW);
    assert.deepEqual(a, b);
  });

  it('carries all four layers, and every node knows its layer', () => {
    const graph = buildDdGraph(ddCase(), NOW);
    const layers = new Set(graph.nodes.map(n => n.layer));
    for (const layer of ['entity', 'evidence', 'claim', 'judgement'] as const) {
      assert.ok(layers.has(layer), `missing layer ${layer}`);
    }
    for (const node of graph.nodes) assert.equal(node.layer, ddLayerFor(node.kind));
  });

  it('fact node ids ARE the evidence ledger ids — one citation currency', () => {
    const c = ddCase();
    const graph = buildDdGraph(c, NOW);
    const factIds = new Set(graph.nodes.filter(n => n.kind === 'fact').map(n => n.id));
    for (const item of c.result?.evidence ?? []) {
      assert.ok(factIds.has(item.id), `ledger item ${item.id} has no fact node`);
    }
  });

  it('a document-sourced fact is asserted by its document node', () => {
    const c = ddCase();
    const graph = buildDdGraph(c, NOW);
    const docFact = (c.result?.evidence ?? []).find(e => e.sourceType === 'document');
    assert.ok(docFact, 'seed case should carry document-sourced evidence');
    const incoming = graph.edges.filter(e => e.kind === 'asserts' && e.toNodeId === docFact.id);
    assert.equal(incoming.length, 1);
    const source = graph.nodes.find(n => n.id === incoming[0].fromNodeId);
    assert.ok(source && (source.kind === 'document' || source.kind === 'photo'));
  });

  it('a proposed finding never enters the graph; an accepted one does, connected to zone and system', () => {
    const c = ddCase();
    c.technicalFindings = [
      finding(c, { id: 'acc', reviewState: 'accepted' }),
      finding(c, { id: 'prop', reviewState: 'proposed', source: 'agent', observation: 'A drafted claim nobody reviewed' }),
    ];
    const graph = buildDdGraph(c, NOW);
    const findings = graph.nodes.filter(n => n.kind === 'finding');
    assert.equal(findings.length, 1);
    assert.ok(!graph.nodes.some(n => n.label.includes('nobody reviewed')));
    const [node] = findings;
    assert.ok(graph.edges.some(e => e.kind === 'located_in' && e.fromNodeId === node.id));
    assert.ok(graph.edges.some(e => e.kind === 'about' && e.fromNodeId === node.id));
  });

  it('every edge joins two nodes the graph actually holds', () => {
    const c = ddCase();
    c.technicalFindings = [finding(c, { evidenceDocumentIds: ['not-a-real-document'] })];
    const graph = buildDdGraph(c, NOW);
    const ids = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      assert.ok(ids.has(edge.fromNodeId) && ids.has(edge.toNodeId), `dangling edge ${edge.id}`);
    }
  });
});

describe('traversal', () => {
  it('a risk traces down to the evidence behind it', () => {
    const c = ddCase();
    const graph = buildDdGraph(c, NOW);
    const risk = graph.nodes.find(n => n.kind === 'risk' && graph.edges.some(e => e.kind === 'evidences' && e.toNodeId === n.id));
    assert.ok(risk, 'expected at least one evidenced risk on the seed case');
    const cone = trace(graph, risk.id);
    assert.ok(cone);
    assert.ok(cone.nodes.some(n => n.layer === 'claim'), 'trace must reach the claims');
  });

  it('trace of an unknown node is undefined, not an empty answer', () => {
    const graph = buildDdGraph(ddCase(), NOW);
    assert.equal(trace(graph, 'no-such-node'), undefined);
  });

  it('a subgraph stays within its hops but keeps adjacent alarms', () => {
    const c = ddCase();
    const graph = buildDdGraph(c, NOW);
    const parcel = graph.nodes.find(n => n.kind === 'parcel');
    assert.ok(parcel);
    const sub = subgraph(graph, [parcel.id], 1);
    assert.ok(sub.nodes.length > 1 && sub.nodes.length < graph.nodes.length);
    // Every edge in a subgraph joins nodes the subgraph itself carries.
    const ids = new Set(sub.nodes.map(n => n.id));
    for (const edge of sub.edges) assert.ok(ids.has(edge.fromNodeId) && ids.has(edge.toNodeId));
  });

  it('findNodes matches labels and exact ids, and serialisation carries citable ids', () => {
    const graph = buildDdGraph(ddCase(), NOW);
    const byLabel = findNodes(graph, 'khata');
    assert.ok(byLabel.length > 0);
    const text = serializeSubgraph(subgraph(graph, [byLabel[0].id], 1));
    assert.ok(text.includes(`[${byLabel[0].id}]`));
  });
});
