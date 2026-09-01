/**
 * The graph store: two halves, two guarantees.
 *
 * The load-bearing assertion is that a REBUILD CANNOT DELETE A NOTE. Derived
 * nodes are a function of the project registers and get replaced wholesale;
 * authored ones came out of a person's judgement and can never be
 * regenerated. An adapter that lost the second half on a sync would quietly
 * destroy the only copy of why a conclusion was reached, and it would look
 * like it was working.
 *
 * These assertions used to run against a `:Dd` case graph — a second label
 * family the running product never wrote to, because no mounted route creates
 * a case. So the port's best guarantees were proven on the half nobody used
 * while the live project graph deleted its edges and had no authored half at
 * all. The contract is unchanged; what changed is that it is now pointed at
 * the graph the product actually stores.
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
import type { ProjectGraphEdge, ProjectGraphNode } from '@realytica/shared';
import type { GraphAdapter, ProjectGraphSnapshot } from '../apps/api/src/graph/types';

const PROJECT = 'prj-store-test';

function node(id: string, origin: 'derived' | 'authored', label = id): ProjectGraphNode {
  return origin === 'authored'
    ? { id, kind: 'thought', layer: 'deliberation', origin, label, detail: 'an analyst wrote this' }
    : { id, kind: 'parcel', layer: 'entity', origin, label, detail: '1,200 sqm · freehold' };
}

function edge(id: string, from: string, to: string): ProjectGraphEdge {
  return { id, from, to, rel: 'cites' };
}

function snapshot(nodes: ProjectGraphNode[], edges: ProjectGraphEdge[] = []): ProjectGraphSnapshot {
  return { projectId: PROJECT, builtAt: '2026-08-28T00:00:00.000Z', nodes, edges };
}

function contract(name: string, load: () => Promise<GraphAdapter>): void {
  describe(name, () => {
    let adapter: GraphAdapter;

    before(async () => { adapter = await load(); });
    // Per test, not per suite. Ids here are fixtures rather than the ids the
    // projection mints, so state leaking between tests lets one test's `e1`
    // satisfy the next one's assertion — which is exactly how the first run of
    // these passed on one adapter and failed on the other.
    beforeEach(async () => { await adapter.purgeProject(PROJECT); });
    after(async () => { await adapter.purgeProject(PROJECT); });

    it('reports null for a project it holds nothing for', async () => {
      assert.equal(await adapter.readProject('prj-that-does-not-exist'), null);
    });

    it('round-trips a derived graph, kind and layer intact', async () => {
      await adapter.syncProject(snapshot([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]));
      const back = await adapter.readProject(PROJECT);
      assert.ok(back);
      assert.deepEqual(back.nodes.map(n => n.id).sort(), ['p1', 'p2']);
      assert.equal(back.nodes[0].kind, 'parcel');
      assert.equal(back.nodes[0].layer, 'entity', 'the layer survives the round trip rather than being re-guessed wrong');
      assert.equal(back.nodes[0].origin, 'derived');
      assert.equal(back.edges.length, 1);
      assert.equal(back.edges[0].rel, 'cites');
    });

    it('A REBUILD DOES NOT DELETE A NOTE', async () => {
      // The invariant the whole split exists for. Node ids are derived from
      // the register rows, so an ordinary rebuild re-mints the same derived
      // ids and the annotation still lands.
      await adapter.syncProject(snapshot([node('p1', 'derived')]));
      await adapter.appendProject(PROJECT, [node('a1', 'authored', 'because the schedule does not close')], [edge('e2', 'a1', 'p1')]);

      await adapter.syncProject(snapshot([node('p1', 'derived'), node('p9', 'derived')]));

      const back = await adapter.readProject(PROJECT);
      assert.ok(back);
      const ids = back.nodes.map(n => n.id).sort();
      assert.ok(ids.includes('a1'), 'the authored node survived the rebuild');
      assert.ok(ids.includes('p9'), 'and the rebuild still added what it found');
      assert.ok(back.edges.some(e => e.id === 'e2'), 'and so did the edge that made it traversable');
    });

    it('drops an annotation whose target the rebuild removed, keeping the note', async () => {
      // Found by holding both adapters to this contract: Neo4j's DETACH DELETE
      // removes the edge with the node, and the journal was keeping a dangling
      // one. Neo4j is right — an edge naming an absent node is the same
      // fabricated connection the projection already refuses.
      //
      // The note itself still stands. Somebody wrote it, and a register row
      // leaving the file does not un-write it; it becomes a note that cites
      // something no longer on file, which is a fact worth being able to see.
      await adapter.syncProject(snapshot([node('p1', 'derived')]));
      await adapter.appendProject(PROJECT, [node('a1', 'authored')], [edge('e2', 'a1', 'p1')]);
      await adapter.syncProject(snapshot([node('p9', 'derived')]));

      const back = await adapter.readProject(PROJECT);
      assert.ok(back?.nodes.some(n => n.id === 'a1'), 'the note survives');
      assert.ok(!back?.edges.some(e => e.id === 'e2'), 'the dangling citation does not');
    });

    it('appends idempotently, so a replay cannot double up', async () => {
      // Replaying the journal is exactly how a lost store is recovered, so
      // this is the recovery path, not a nicety.
      await adapter.syncProject(snapshot([node('p1', 'derived')]));
      const authored = [node('a1', 'authored')];
      const edges = [edge('e1', 'a1', 'p1')];
      await adapter.appendProject(PROJECT, authored, edges);
      await adapter.appendProject(PROJECT, authored, edges);
      const back = await adapter.readProject(PROJECT);
      assert.equal(back?.nodes.filter(n => n.id === 'a1').length, 1);
      assert.equal(back?.edges.filter(e => e.id === 'e1').length, 1);
    });

    it('refuses to append a derived node', async () => {
      // A caller appending a derived node is confused about which half it is
      // writing; relabelling it silently would put something rebuildable into
      // the half that is never rebuilt.
      await adapter.syncProject(snapshot([]));
      await adapter.appendProject(PROJECT, [node('p-sneaky', 'derived')], []);
      const back = await adapter.readProject(PROJECT);
      assert.ok(!(back?.nodes ?? []).some(n => n.id === 'p-sneaky'));
    });

    it('CLOSES an edge the rebuild dropped, rather than deleting it', async () => {
      // "What did this finding rest on when we signed the March report" is a
      // question a diligence file has to be able to answer. A check dropping
      // an evidence reference changed the file; it did not make the March edge
      // a lie, and deleting it answers that question with silence.
      //
      // This is the assertion the project graph could not have passed before:
      // its sync deleted stale edges outright, and the property was proven
      // only on the case half nobody wrote to.
      await adapter.syncProject({ ...snapshot([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-03-01T00:00:00.000Z' });
      await adapter.syncProject({ ...snapshot([node('p1', 'derived'), node('p2', 'derived')], []), builtAt: '2026-07-01T00:00:00.000Z' });

      const now = await adapter.readProject(PROJECT);
      assert.ok(!now?.edges.some(e => e.id === 'e1'), 'gone from the current graph');

      const march = await adapter.readProject(PROJECT, '2026-04-01T00:00:00.000Z');
      assert.ok(march?.edges.some(e => e.id === 'e1'), 'and still there as of April');
    });

    it('reopens an edge the rebuild draws again, rather than stacking a second', async () => {
      await adapter.syncProject({ ...snapshot([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-03-01T00:00:00.000Z' });
      await adapter.syncProject({ ...snapshot([node('p1', 'derived'), node('p2', 'derived')], []), builtAt: '2026-07-01T00:00:00.000Z' });
      await adapter.syncProject({ ...snapshot([node('p1', 'derived'), node('p2', 'derived')], [edge('e1', 'p1', 'p2')]), builtAt: '2026-08-01T00:00:00.000Z' });

      const back = await adapter.readProject(PROJECT);
      const matches = back?.edges.filter(e => e.id === 'e1') ?? [];
      assert.equal(matches.length, 1, 'the same relationship asserted again is the same edge');
      assert.equal(matches[0].closedAt, undefined, 'and it is open');
    });

    it('purges everything for a project', async () => {
      await adapter.syncProject(snapshot([node('p1', 'derived')]));
      await adapter.appendProject(PROJECT, [node('a1', 'authored')], []);
      await adapter.purgeProject(PROJECT);
      assert.equal(await adapter.readProject(PROJECT), null);
    });

    it('returns a neighbourhood that reaches the evidence and the parent', async () => {
      await adapter.syncProject({
        projectId: PROJECT,
        builtAt: '2026-08-31T00:00:00.000Z',
        nodes: [
          { id: PROJECT, kind: 'project', layer: 'entity', origin: 'derived', label: 'Harohalli' },
          { id: 'scp-1', kind: 'scope', layer: 'judgement', origin: 'derived', label: 'Legal' },
          { id: 'chk-1', kind: 'check', layer: 'judgement', origin: 'derived', label: 'Title chain' },
          { id: 'ev-1', kind: 'evidence', layer: 'evidence', origin: 'derived', label: 'Sale deed' },
        ],
        edges: [
          { id: 'e-check', from: 'scp-1', to: 'chk-1', rel: 'has_check' },
          { id: 'e-ev', from: 'chk-1', to: 'ev-1', rel: 'supported_by' },
        ],
      });
      const sub = await adapter.neighbourhood(PROJECT, ['chk-1'], 1);
      assert.ok(sub);
      assert.ok(sub.nodes.some(n => n.id === 'ev-1'), 'one hop from the check reaches the deed');
      assert.ok(sub.nodes.some(n => n.id === 'scp-1'), 'and the parent scope');
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
