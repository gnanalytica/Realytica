/**
 * The graph store: two halves, two guarantees.
 *
 * The load-bearing assertion is that a REBUILD CANNOT DELETE A REASON. Derived
 * nodes are a function of the case store and get replaced wholesale; authored
 * ones came out of a conversation and can never be regenerated. An adapter
 * that lost the second half on a sync would quietly destroy the only copy of
 * why a conclusion was reached, and it would look like it was working.
 *
 * Both adapters are held to the identical contract, because the point of the
 * port is that the engine is a choice — Neo4j today, something else later,
 * with the ontology and the writer as the asset. A contract only one
 * implementation passes is not a port.
 *
 * The Neo4j half runs only when REALYTICA_NEO4J_URL points at a live instance;
 * otherwise it is skipped rather than mocked. A mocked graph store asserts
 * that our mock behaves like our mock.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { DdEdge, DdGraph, DdNode } from '@realytica/shared';
import type { GraphAdapter } from '../apps/api/src/graph/types';

const CASE = 'case-store-test';

function node(id: string, origin: 'derived' | 'authored', label = id): DdNode {
  return {
    id,
    kind: origin === 'authored' ? 'answer' : 'parcel',
    layer: origin === 'authored' ? 'deliberation' : 'entity',
    label,
    origin,
    attributes: { note: 'x', n: 1, flag: true },
  };
}

function edge(id: string, from: string, to: string): DdEdge {
  return { id, kind: 'cites', fromNodeId: from, toNodeId: to, label: 'cites' };
}

function graph(nodes: DdNode[], edges: DdEdge[] = []): DdGraph {
  return { caseId: CASE, builtAt: '2026-08-28T00:00:00.000Z', nodes, edges };
}

function contract(name: string, load: () => Promise<GraphAdapter>): void {
  describe(name, () => {
    let adapter: GraphAdapter;

    before(async () => { adapter = await load(); });
    // Per test, not per suite. Ids here are fixtures rather than the content
    // digests the projection mints, so state leaking between tests lets one
    // test's `e1` satisfy the next one's assertion — which is exactly how the
    // first run of these passed on one adapter and failed on the other.
    beforeEach(async () => { await adapter.purge(CASE); });
    after(async () => { await adapter.purge(CASE); });

    it('reports null for a case it holds nothing for', async () => {
      assert.equal(await adapter.read('case-that-does-not-exist'), null);
    });

    it('round-trips a derived graph, attributes intact', async () => {
      await adapter.sync(graph([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]));
      const back = await adapter.read(CASE);
      assert.ok(back);
      assert.deepEqual(back.nodes.map(n => n.id).sort(), ['p1', 'p2']);
      assert.deepEqual(back.nodes[0].attributes, { note: 'x', n: 1, flag: true });
      assert.equal(back.edges.length, 1);
    });

    it('A REBUILD DOES NOT DELETE A REASON', async () => {
      // The invariant the whole split exists for. Node ids are a digest of the
      // case content, so an ordinary rebuild re-mints the same derived ids and
      // the citation still lands.
      await adapter.sync(graph([node('p1', 'derived')]));
      await adapter.append(CASE, [node('a1', 'authored', 'because the schedule does not close')], [edge('e2', 'a1', 'p1')]);

      await adapter.sync(graph([node('p1', 'derived'), node('p9', 'derived')]));

      const back = await adapter.read(CASE);
      assert.ok(back);
      const ids = back.nodes.map(n => n.id).sort();
      assert.ok(ids.includes('a1'), 'the authored node survived the rebuild');
      assert.ok(ids.includes('p9'), 'and the rebuild still added what it found');
      assert.ok(back.edges.some(e => e.id === 'e2'), 'and so did the edge that made it traversable');
    });

    it('drops a citation whose target the rebuild removed, keeping the reason', async () => {
      // Found by holding both adapters to this contract: Neo4j's DETACH DELETE
      // removes the edge with the node, and the journal was keeping a dangling
      // one. Neo4j is right — an edge naming an absent node is the same
      // fabricated connection the projection already refuses.
      //
      // The reason itself still stands. Somebody wrote it, and a document
      // leaving the case does not un-write it; it becomes a reason that cites
      // something no longer on file, which is a fact worth being able to see.
      await adapter.sync(graph([node('p1', 'derived')]));
      await adapter.append(CASE, [node('a1', 'authored')], [edge('e2', 'a1', 'p1')]);
      await adapter.sync(graph([node('p9', 'derived')]));

      const back = await adapter.read(CASE);
      assert.ok(back?.nodes.some(n => n.id === 'a1'), 'the reason survives');
      assert.ok(!back?.edges.some(e => e.id === 'e2'), 'the dangling citation does not');
    });

    it('appends idempotently, so a replay cannot double up', async () => {
      // Replaying the journal is exactly how a lost store is recovered, so
      // this is the recovery path, not a nicety.
      await adapter.sync(graph([node('p1', 'derived')]));
      const authored = [node('a1', 'authored')];
      const edges = [edge('e1', 'a1', 'p1')];
      await adapter.append(CASE, authored, edges);
      await adapter.append(CASE, authored, edges);
      const back = await adapter.read(CASE);
      assert.equal(back?.nodes.filter(n => n.id === 'a1').length, 1);
      assert.equal(back?.edges.filter(e => e.id === 'e1').length, 1);
    });

    it('refuses to append a derived node', async () => {
      // A caller appending a derived node is confused about which half it is
      // writing; relabelling it silently would put something rebuildable into
      // the half that is never rebuilt.
      await adapter.sync(graph([]));
      await adapter.append(CASE, [node('p-sneaky', 'derived')], []);
      const back = await adapter.read(CASE);
      assert.ok(!(back?.nodes ?? []).some(n => n.id === 'p-sneaky'));
    });

    it('CLOSES an edge the rebuild dropped, rather than deleting it', async () => {
      // "What did we believe when we signed the March report" is a question a
      // diligence file has to be able to answer. A July certificate
      // superseding a March one changed the case; it did not make the March
      // edge a lie, and deleting it answers that question with silence.
      await adapter.sync({ ...graph([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-03-01T00:00:00.000Z' });
      await adapter.sync({ ...graph([node('p1', 'derived'), node('p2', 'derived')], []), builtAt: '2026-07-01T00:00:00.000Z' });

      const now = await adapter.read(CASE);
      assert.ok(!now?.edges.some(e => e.id === 'e1'), 'gone from the current graph');

      const march = await adapter.read(CASE, '2026-04-01T00:00:00.000Z');
      assert.ok(march?.edges.some(e => e.id === 'e1'), 'and still there as of April');
    });

    it('reopens an edge the rebuild draws again, rather than stacking a second', async () => {
      await adapter.sync({ ...graph([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-03-01T00:00:00.000Z' });
      await adapter.sync({ ...graph([node('p1', 'derived'), node('p2', 'derived')], []), builtAt: '2026-07-01T00:00:00.000Z' });
      await adapter.sync({ ...graph([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-08-01T00:00:00.000Z' });

      const back = await adapter.read(CASE);
      const matches = back?.edges.filter(e => e.id === 'e1') ?? [];
      assert.equal(matches.length, 1, 'the same relationship asserted again is the same edge');
      assert.equal(matches[0].closedAt, undefined, 'and it is open');
    });

    it('purges everything for a case', async () => {
      await adapter.sync(graph([node('p1', 'derived')]));
      await adapter.append(CASE, [node('a1', 'authored')], []);
      await adapter.purge(CASE);
      assert.equal(await adapter.read(CASE), null);
    });

    it('round-trips a project cockpit graph and returns a neighbourhood', async () => {
      const projectId = 'prj-store-test';
      await adapter.purgeProject(projectId);
      await adapter.syncProject({
        projectId,
        builtAt: '2026-08-31T00:00:00.000Z',
        nodes: [
          { id: projectId, kind: 'project', label: 'Harohalli' },
          { id: 'scp-1', kind: 'scope', label: 'Legal' },
          { id: 'chk-1', kind: 'check', label: 'Title chain' },
          { id: 'ev-1', kind: 'evidence', label: 'Sale deed' },
        ],
        edges: [
          { id: 'e-scope', from: projectId, to: 'scp-1', rel: 'has_scope' },
          { id: 'e-check', from: 'scp-1', to: 'chk-1', rel: 'has_check' },
          { id: 'e-ev', from: 'chk-1', to: 'ev-1', rel: 'uses_evidence' },
        ],
      });
      const back = await adapter.readProject(projectId);
      assert.ok(back);
      assert.equal(back.nodes.length, 4);
      const sub = await adapter.neighbourhood(projectId, ['chk-1'], 1);
      assert.ok(sub);
      assert.ok(sub.nodes.some(n => n.id === 'ev-1'), 'one hop from the check reaches the deed');
      assert.ok(sub.nodes.some(n => n.id === 'scp-1'), 'and the parent scope');
      await adapter.purgeProject(projectId);
      assert.equal(await adapter.readProject(projectId), null);
    });
  });
}

let dataDir: string | undefined;
contract('the journal adapter', async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'realytica-graph-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  const { journalAdapter } = await import('../apps/api/src/graph/journal');
  return journalAdapter;
});
after(async () => { if (dataDir) await rm(dataDir, { recursive: true, force: true }); });

if (process.env.REALYTICA_NEO4J_URL) {
  contract('the neo4j adapter', async () => {
    const { neo4jAdapter, ensureNeo4jSchema } = await import('../apps/api/src/graph/neo4j');
    await ensureNeo4jSchema();
    return neo4jAdapter;
  });
  after(async () => {
    const { closeNeo4j } = await import('../apps/api/src/graph/neo4j');
    await closeNeo4j();
  });
} else {
  describe('the neo4j adapter', () => {
    it('is skipped — set REALYTICA_NEO4J_URL to run it against a live instance', () => {
      assert.ok(true);
    });
  });
}
