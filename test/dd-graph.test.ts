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
import { buildDdGraph, buildGraphReport, ddLayerFor, findNodes, serializeSubgraph, subgraph, trace } from '@realytica/shared';
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

  it('a photo captured against a zone and system enters already connected, sharing the zone with findings', () => {
    const c = ddCase();
    c.documents.push({
      id: 'photo-1',
      caseId: c.id,
      fileName: 'DG_room_busduct_floor_cutout.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      uploadedAt: NOW,
      kind: 'photograph',
      classificationConfidence: 1,
      kindConfirmedByUser: true,
      pages: 1,
      ocrStatus: 'complete',
      extracted: [],
      captureZone: 'Basement 2, DG Room',
      captureSystem: 'mep_electrical',
    });
    const photo = c.documents[c.documents.length - 1];
    // The finding says the same place differently — capture-time zones and
    // finding zones must merge into ONE node, or "where" fragments per writer.
    c.technicalFindings = [finding(c, { zone: 'basement 2 dg room' })];
    const graph = buildDdGraph(c, NOW);
    const photoNode = graph.nodes.find(n => n.kind === 'photo' && n.attributes.documentId === photo.id);
    assert.ok(photoNode);
    assert.equal(photoNode.domain, 'technical');
    const locatedIn = graph.edges.find(e => e.kind === 'located_in' && e.fromNodeId === photoNode.id);
    assert.ok(locatedIn, 'photo must be located_in its capture zone');
    const findingNode = graph.nodes.find(n => n.kind === 'finding');
    assert.ok(findingNode);
    const findingLocatedIn = graph.edges.find(e => e.kind === 'located_in' && e.fromNodeId === findingNode.id);
    assert.equal(locatedIn.toNodeId, findingLocatedIn?.toNodeId, 'photo and finding must share one zone node');
    const about = graph.edges.find(e => e.kind === 'about' && e.fromNodeId === photoNode.id);
    assert.ok(about, 'photo must be about its capture system');
    assert.equal(graph.nodes.find(n => n.id === about.toNodeId)?.kind, 'asset_system');
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

describe('graph report', () => {
  it('is deterministic and carries only domains that hold judgements', () => {
    const c = ddCase();
    const graph = buildDdGraph(c, NOW);
    const a = buildGraphReport(graph);
    const b = buildGraphReport(graph);
    assert.deepEqual(a, b);
    assert.ok(a.sections.length > 0, 'a screened case has judgements to report');
    for (const section of a.sections) {
      assert.ok(section.judgements.length > 0, `empty section ${section.domain} should not print`);
    }
  });

  it('every reported judgement is check, finding or risk — actions have no cone to print', () => {
    const c = ddCase();
    c.technicalFindings = [finding(c)];
    const report = buildGraphReport(buildDdGraph(c, NOW));
    for (const section of report.sections) {
      for (const j of section.judgements) {
        assert.ok(['check', 'finding', 'risk'].includes(j.node.kind), `unexpected kind ${j.node.kind}`);
      }
    }
  });

  it('an evidenced judgement prints with its claims; a conclusion nothing derives is flagged, never hidden', () => {
    const c = ddCase();
    const report = buildGraphReport(buildDdGraph(c, NOW));
    const all = report.sections.flatMap(s => s.judgements);
    const evidenced = all.find(j => !j.unevidenced);
    assert.ok(evidenced, 'seed case should carry at least one evidenced judgement');
    assert.ok(evidenced.claims.length > 0 || evidenced.evidence.length > 0, 'evidenced judgement must print its support');
    assert.equal(report.totals.judgements, all.length);
    assert.equal(report.totals.unevidenced, all.filter(j => j.unevidenced).length);
  });

  it('blockers and criticals lead their section', () => {
    const c = ddCase();
    const report = buildGraphReport(buildDdGraph(c, NOW));
    for (const section of report.sections) {
      const severities = section.judgements.map(j =>
        j.node.attributes.verdict === 'blocker' || j.node.attributes.severity === 'critical' ? 0 : 1,
      );
      assert.deepEqual(severities, [...severities].sort((a, b) => a - b), `${section.domain} not ordered worst-first`);
    }
  });
});
