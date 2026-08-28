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
import { after, before, describe, it } from 'node:test';
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

    before(async () => {
      adapter = await load();
      await adapter.purge(CASE);
    });
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

    it('purges everything for a case', async () => {
      await adapter.sync(graph([node('p1', 'derived')]));
      await adapter.append(CASE, [node('a1', 'authored')], []);
      await adapter.purge(CASE);
      assert.equal(await adapter.read(CASE), null);
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
