/**
 * The project graph is a graph OF THE PROPERTY, not only of the workflow.
 *
 * Before this, a file's graph could be traversed end to end without ever
 * reaching the land being bought. It held project -> assessment -> scope ->
 * check -> finding -> risk -> action and the evidence each rested on: all true,
 * none of it the property. There was no parcel node, no owner, no deed — while
 * `runScreen` was computing a full chain of title on every screen and dropping
 * everything but the summary.
 *
 * These tests pin the two claims that closed that: the property entities are
 * in the graph, and the vocabulary that describes them is closed.
 *
 * They run against the seeds and a hand-built title summary rather than a
 * mock, because the property under test is what the REAL projection emits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectGraph,
  isProjectEdgeKind,
  isProjectNodeKind,
  PROJECT_EDGE_KINDS,
  PROJECT_NODE_KINDS,
  projectEdgeEndpointsValid,
  projectLayerFor,
  seedBdaReferenceProject,
  seedDemoProject,
  validateProjectGraph,
  type DdProject,
  type TitleGraphSummary,
} from '@realytica/shared';

/** A screen result carrying a two-link chain, one contradiction and a break. */
function titleSummary(): TitleGraphSummary {
  return {
    builtAt: '2026-08-31T00:00:00.000Z',
    nodeCount: 7,
    edgeCount: 8,
    integrityScore: 62,
    headline: 'Two conveyances on file; the 1994 schedule does not close.',
    contradictions: [
      {
        id: 'con-extent',
        kind: 'area_mismatch',
        subject: 'Extent of Sy. No. 118/2',
        statement: 'The sale deed recites 1,208 sqm; the khata records 1,161 sqm.',
        claims: [
          { sourceRef: 'doc-1', sourceLabel: 'Sale deed', fieldKey: 'extent', value: '1208', unit: 'sqm', confidence: 0.9 },
          { sourceRef: 'doc-2', sourceLabel: 'Khata extract', fieldKey: 'extent', value: '1161', unit: 'sqm', confidence: 0.8 },
        ],
        divergence: 0.039,
        severity: 'warning',
        resolvedBy: ['Obtain a fresh survey sketch from the taluk office.'],
      },
    ],
    resolutionPaths: [],
    chains: [
      {
        parcelNodeId: 'tg-parcel-118-2',
        parcelLabel: 'Sy. No. 118/2, Harohalli',
        rootAt: '1994-06-02',
        yearsEstablished: 32,
        yearsExpected: 30,
        breaks: [
          {
            id: 'brk-1',
            kind: 'missing_predecessor',
            statement: 'No registered instrument between the 1994 grant and the 1998 gift.',
            severity: 'serious',
            resolvedBy: ['Produce the mother deed.'],
          },
        ],
        links: [
          {
            id: 'lnk-1',
            instrumentNodeId: 'tg-inst-grant-1994',
            label: 'Grant, 1994',
            at: '1994-06-02T00:00:00.000Z',
            fromPartyNodeId: 'tg-party-state',
            fromPartyLabel: 'State of Karnataka',
            toPartyNodeId: 'tg-party-ramaiah',
            toPartyLabel: 'Ramaiah S/o Muniyappa',
            extentSqm: 1208,
          },
          {
            id: 'lnk-2',
            instrumentNodeId: 'tg-inst-gift-1998',
            label: 'Gift deed, 1998',
            at: '1998-11-14T00:00:00.000Z',
            fromPartyNodeId: 'tg-party-ramaiah',
            fromPartyLabel: 'Ramaiah S/o Muniyappa',
            toPartyNodeId: 'tg-party-lakshmi',
            toPartyLabel: 'Lakshmamma',
            extentSqm: 1208,
          },
        ],
      },
    ],
  };
}

/** A seeded file with particulars and a screened title chain on it. */
function screenedProject(): DdProject {
  const project = seedDemoProject();
  project.parcelId = 'Sy. No. 118/2';
  project.tenure = 'freehold';
  project.landAreaSqm = 1208;
  project.karnataka = {
    jurisdiction: 'BBMP',
    khataType: 'a_khata',
    eKhataIssued: true,
    landConversionStatus: 'converted',
    areaBasis: 'super_built_up',
    kreraNumber: 'PRM/KA/RERA/1251/446/PR/2026/001',
  };
  project.plot = { facing: 'east', layoutApproval: 'bda_approved', cornerSite: true };
  project.stakeholders = [
    { id: 'stk-1', name: 'Sundaram & Co', role: 'Title counsel', organisation: 'Sundaram & Co LLP' },
    { id: 'stk-2', name: 'HDFC', role: 'Lender' },
  ];
  project.lastScreenResult = { titleGraph: titleSummary() } as DdProject['lastScreenResult'];
  return project;
}

describe('the property is in the graph', () => {
  it('has a parcel, and the file and its buildings stand on it', () => {
    const graph = buildProjectGraph(screenedProject());
    const parcel = graph.nodes.find((n) => n.kind === 'parcel' && n.label === 'Sy. No. 118/2');
    assert.ok(parcel, 'the land the file is about is a node');
    assert.match(parcel.detail ?? '', /1,208 sqm/);
    assert.match(parcel.detail ?? '', /freehold/);
    assert.ok(
      graph.edges.some((e) => e.rel === 'sited_at' && e.to === parcel.id),
      'and something stands on it',
    );
  });

  it('carries the chain of title the screen worked out and then used to drop', () => {
    const graph = buildProjectGraph(screenedProject());
    const instruments = graph.nodes.filter((n) => n.kind === 'instrument');
    assert.equal(instruments.length, 2, 'both conveyances');
    assert.ok(instruments.some((n) => n.label === 'Gift deed, 1998'));

    const parties = graph.nodes.filter((n) => n.kind === 'party').map((n) => n.label);
    assert.ok(parties.includes('Ramaiah S/o Muniyappa'), 'the vendor is a node, not a string on a card');
    assert.ok(parties.includes('Lakshmamma'));

    // The chain itself: the 1998 gift takes title from the 1994 grant.
    const gift = instruments.find((n) => n.label === 'Gift deed, 1998');
    const grant = instruments.find((n) => n.label === 'Grant, 1994');
    assert.ok(
      graph.edges.some((e) => e.rel === 'derives_from' && e.from === gift?.id && e.to === grant?.id),
      'the chain is traversable, not just listed',
    );
    assert.ok(graph.edges.some((e) => e.rel === 'conveyed_by' && e.from === gift?.id));
    assert.ok(graph.edges.some((e) => e.rel === 'conveyed_to' && e.from === gift?.id));
  });

  it('keeps the deed parcel and the declared parcel as two nodes, joined', () => {
    // Merging them would erase the ability to say the deed and the khata
    // describe the site differently, which is the finding this product exists
    // to surface.
    const graph = buildProjectGraph(screenedProject());
    const parcels = graph.nodes.filter((n) => n.kind === 'parcel');
    assert.equal(parcels.length, 2);
    assert.ok(graph.edges.some((e) => e.rel === 'derives_from' && parcels.some((p) => p.id === e.from)));
  });

  it('projects the stakeholder register, which reached the graph nowhere before', () => {
    const graph = buildProjectGraph(screenedProject());
    const counsel = graph.nodes.find((n) => n.label === 'Sundaram & Co');
    assert.ok(counsel, 'a person engaged on the file is a node');
    assert.equal(counsel.kind, 'party');
    assert.ok(graph.edges.some((e) => e.rel === 'engaged_on' && e.to === counsel.id));
  });

  it('turns the particulars into approvals and the authority that issued them', () => {
    const graph = buildProjectGraph(screenedProject());
    const approvals = graph.nodes.filter((n) => n.kind === 'approval').map((n) => n.label);
    assert.ok(approvals.some((l) => /khata/i.test(l)));
    assert.ok(approvals.some((l) => /DC conversion/i.test(l)));
    assert.ok(approvals.some((l) => /K-RERA/i.test(l)));
    assert.ok(approvals.some((l) => /layout/i.test(l)));

    const bbmp = graph.nodes.find((n) => n.kind === 'authority' && n.label === 'BBMP');
    assert.ok(bbmp, 'the jurisdiction is a body you can traverse to, not a tag');
    assert.ok(graph.edges.some((e) => e.rel === 'governed_by' && e.to === bbmp.id));
    assert.ok(graph.edges.some((e) => e.rel === 'issued_by' && e.to === bbmp.id));
  });

  it('carries a title contradiction as its own node', () => {
    const graph = buildProjectGraph(screenedProject());
    const conflict = graph.nodes.find((n) => n.kind === 'contradiction');
    assert.ok(conflict);
    assert.equal(conflict.label, 'Extent of Sy. No. 118/2');
    assert.equal(conflict.layer, 'claim');
    assert.ok(graph.edges.some((e) => e.rel === 'contradicts' && e.from === conflict.id));
  });

  it('gives an unscreened file a parcel anyway, from its own particulars', () => {
    // A file that has never been screened still knows what land it is about.
    const project = screenedProject();
    delete project.lastScreenResult;
    const graph = buildProjectGraph(project);
    assert.equal(graph.nodes.filter((n) => n.kind === 'parcel').length, 1);
    assert.equal(graph.nodes.filter((n) => n.kind === 'instrument').length, 0);
  });
});

describe('the vocabulary is closed', () => {
  it('emits nothing outside the ontology, on either seed', () => {
    for (const seed of [seedDemoProject, seedBdaReferenceProject, screenedProject]) {
      const graph = buildProjectGraph(seed());
      for (const node of graph.nodes) {
        assert.ok(isProjectNodeKind(node.kind), `unknown node kind "${node.kind}"`);
        assert.equal(node.layer, projectLayerFor(node.kind), `${node.id} carries the wrong layer`);
        assert.equal(node.origin, 'derived', 'the projection produces nothing authored');
      }
      for (const edge of graph.edges) {
        assert.ok(isProjectEdgeKind(edge.rel), `unknown relation "${edge.rel}"`);
      }
    }
  });

  it('passes its own validator — endpoints, layers and all', () => {
    for (const seed of [seedDemoProject, seedBdaReferenceProject, screenedProject]) {
      const problems = validateProjectGraph(buildProjectGraph(seed()));
      assert.deepEqual(problems, [], problems.map((p) => p.reason).join('\n'));
    }
  });

  it('never leaves an edge pointing at a node it does not hold', () => {
    // The old builder guarded only chat citations, so a check naming a deleted
    // evidence row produced an edge into nothing. `/projects/:id/graph` serves
    // the raw projection, so that edge reached a renderer.
    const project = screenedProject();
    project.assessments[0]!.scopes[0]!.checks[0]!.evidenceIds.push('ev-that-was-deleted');
    const graph = buildProjectGraph(project);
    const ids = new Set(graph.nodes.map((n) => n.id));
    const dangling = graph.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    assert.deepEqual(dangling, []);
  });

  it('refuses an edge whose endpoints the ontology forbids', () => {
    const problems = validateProjectGraph({
      nodes: [
        { id: 'r1', kind: 'report', layer: 'judgement', origin: 'derived', label: 'Red flag' },
        { id: 'p1', kind: 'party', layer: 'entity', origin: 'derived', label: 'Ramaiah' },
      ],
      edges: [{ id: 'bad', from: 'r1', to: 'p1', rel: 'has_check' }],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!.reason, /may not join report to party/);
  });

  it('refuses a judgement resting on deliberation, in that direction only', () => {
    // The one-way rule. A thought may cite a finding; a finding may never be
    // reached by walking out of a thought, or an unreviewed model musing
    // becomes the support under a conclusion that reaches a bank.
    const nodes = [
      { id: 'f1', kind: 'finding' as const, layer: 'judgement' as const, origin: 'derived' as const, label: 'Gap' },
      { id: 't1', kind: 'thought' as const, layer: 'deliberation' as const, origin: 'derived' as const, label: 'Maybe' },
    ];
    const bad = validateProjectGraph({ nodes, edges: [{ id: 'x', from: 'f1', to: 't1', rel: 'cites' }] });
    assert.equal(bad.length, 2, 'wrong endpoints AND wrong direction');
    assert.ok(bad.some((p) => /deliberation is cited, never relied on/.test(p.reason)));

    const good = validateProjectGraph({ nodes, edges: [{ id: 'y', from: 't1', to: 'f1', rel: 'cites' }] });
    assert.deepEqual(good, []);
  });

  it('has no relation that is a second word for another', () => {
    // `uses_evidence`/`supported_by` and `mitigates`/`requires` were exactly
    // that, and each one meant every traversal had to remember both or
    // silently miss half of what it was walking.
    assert.ok(!(PROJECT_EDGE_KINDS as readonly string[]).includes('uses_evidence'));
    assert.ok(!(PROJECT_EDGE_KINDS as readonly string[]).includes('mitigates'));
    assert.equal(new Set(PROJECT_EDGE_KINDS).size, PROJECT_EDGE_KINDS.length);
    assert.equal(new Set(PROJECT_NODE_KINDS).size, PROJECT_NODE_KINDS.length);
  });

  it('names an endpoint rule for every relation it declares', () => {
    // The way a vocabulary rots is a kind added to the union and nowhere else.
    for (const kind of PROJECT_EDGE_KINDS) {
      assert.doesNotThrow(() => projectEdgeEndpointsValid(kind, 'project', 'asset'), `${kind} has no rule`);
    }
    for (const kind of PROJECT_NODE_KINDS) {
      assert.ok(projectLayerFor(kind), `${kind} has no layer`);
    }
  });
});
