/**
 * What the Neo4j adapter asks of the database, and in what order.
 *
 * Several instances hold the same project, and the graph store must refuse
 * the one still holding an older copy. In Neo4j that is a marker node a
 * project: a sync takes it first, in the same transaction, and writes only if
 * the marker says its copy is not older and is not already drawn.
 * `graph-sync.test.ts` proves the refusal on the journal, where what is on
 * disk can be read back.
 *
 * Nothing here reaches a database. The suite is forbidden one (see
 * `no-ambient-credentials.ts`), so the adapter is handed a driver whose
 * sessions record every statement and its parameters and answer the marker's
 * statement as each test says. That proves the order, the parameters, the
 * number of statements, and that the writes depend on the answer. It cannot
 * prove what a statement itself does: that is Cypher, and only a database
 * runs it. `scripts/probe-neo4j.ts` runs the same statements against one.
 */

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Driver } from 'neo4j-driver';
import { PROJECT_NODE_KINDS, projectLayerFor, type ProjectGraphNode } from '@realytica/shared';
import type { ProjectGraphSnapshot } from '../apps/api/src/graph/types';
import { drawingOf } from '../apps/api/src/graph/drawing';

type Neo4jModule = typeof import('../apps/api/src/graph/neo4j');

const PROJECT = 'prj-statements-test';

interface Asked {
  query: string;
  params: Record<string, unknown>;
  /** Which transaction of the session the statement ran in, counted from one. */
  transaction: number;
}

/** What the marker's statement answers. */
let marker: { current: boolean; held: number; drawn: boolean };
let asked: Asked[];
let transactions: number;
let adapter: Neo4jModule['neo4jAdapter'];
let ensureNeo4jSchema: Neo4jModule['ensureNeo4jSchema'];
let closeNeo4j: Neo4jModule['closeNeo4j'];
let useNeo4jDriver: Neo4jModule['useNeo4jDriver'];

/** A driver whose every session writes down what it is asked. */
function recordingDriver(): Driver {
  const session = {
    async executeWrite<T>(work: (tx: { run: (query: string, params?: Record<string, unknown>) => Promise<unknown> }) => Promise<T>): Promise<T> {
      transactions += 1;
      const transaction = transactions;
      return work({
        run: async (query, params = {}) => {
          asked.push({ query, params, transaction });
          // The marker's is the only statement whose answer the adapter reads.
          const answers = /RETURN held/.test(query) ? [{ get: (key: string) => (marker as Record<string, unknown>)[key] }] : [];
          return { records: answers };
        },
      });
    },
    async close(): Promise<void> {},
  };
  return { session: () => session, close: async () => {} } as unknown as Driver;
}

function parcel(id: string): ProjectGraphNode {
  return { id, kind: 'parcel', layer: 'entity', origin: 'derived', label: id };
}

function snapshot(revision?: number): ProjectGraphSnapshot {
  return {
    projectId: PROJECT,
    builtAt: '2026-10-05T10:00:00.000Z',
    ...(revision === undefined ? {} : { revision }),
    nodes: [parcel('p1'), parcel('p2')],
    edges: [{ id: 'e1', from: 'p1', to: 'p2', rel: 'cites' }],
  };
}

before(async () => {
  ({ neo4jAdapter: adapter, ensureNeo4jSchema, closeNeo4j, useNeo4jDriver } = await import('../apps/api/src/graph/neo4j'));
});

// No address is configured, so an adapter left without this driver has nowhere to dial and throws.
beforeEach(() => {
  asked = [];
  transactions = 0;
  useNeo4jDriver(recordingDriver());
});

afterEach(async () => {
  await closeNeo4j();
});

describe('the Neo4j adapter syncing a project', () => {
  it('takes the project’s marker before anything else, in the transaction that writes', async () => {
    marker = { current: true, held: 3, drawn: false };

    const answer = await adapter.syncProject(snapshot(7));

    assert.equal(answer, undefined, 'a sync that was taken answers nothing');
    const [first, ...rest] = asked;
    assert.match(first!.query, /MERGE \(s:GraphSync \{ projectId: \$projectId \}\)/);
    const { nodes, edges } = snapshot();
    assert.deepEqual(first!.params, { projectId: PROJECT, revision: 7, drawing: drawingOf(nodes, edges) });
    assert.ok(rest.length > 0, 'the graph was written after it');
    assert.ok(asked.every((statement) => statement.transaction === 1), 'and in the one transaction, so the marker and the graph move together');
    assert.equal(rest.some((statement) => /GraphSync/.test(statement.query)), false, 'the marker is asked once');
    assert.ok(rest.some((statement) => /MERGE \(n:Ryt \{ id: row\.id \}\)/.test(statement.query)), 'the nodes are written');
    assert.ok(rest.some((statement) => /DETACH DELETE n/.test(statement.query)), 'and what the copy no longer draws is removed');
  });

  it('locks the marker before it reads the revision on it', async () => {
    marker = { current: true, held: 0, drawn: false };
    await adapter.syncProject(snapshot(1));

    // A write takes the node's lock; a read does not. Two syncs of one project
    // that both read first would both see the old revision and both write.
    const claim = asked[0]!.query;
    const locks = claim.indexOf('SET s.asked = $revision');
    const reads = claim.indexOf('coalesce(s.revision');
    assert.ok(locks > 0 && reads > locks, 'the write comes first in the statement');
    assert.match(claim, /SET s\.revision = CASE WHEN \$revision < held THEN held ELSE \$revision END/, 'a lower revision leaves the marker’s revision as it was');
    assert.match(claim, /s\.drawing = CASE WHEN \$revision < held THEN s\.drawing ELSE \$drawing END/, 'and its drawing');
    assert.match(claim, /RETURN held, \$revision >= held AS current, drawn/);
  });

  it('writes nothing when the marker holds a later copy, and answers the refusal', async () => {
    marker = { current: false, held: 9, drawn: false };

    const answer = await adapter.syncProject(snapshot(7));

    assert.deepEqual(answer, { refused: true, held: 9, drawn: false }, 'an answer, not an error');
    assert.equal(asked.length, 1, 'the marker was asked and nothing was written');
    assert.match(asked[0]!.query, /MERGE \(s:GraphSync/);
  });

  it('says so when the later copy it holds is drawn the same', async () => {
    marker = { current: false, held: 9, drawn: true };
    assert.deepEqual(await adapter.syncProject(snapshot(7)), { refused: true, held: 9, drawn: true });
  });

  it('writes nothing but the marker for a copy that is already drawn', async () => {
    marker = { current: true, held: 7, drawn: true };

    const answer = await adapter.syncProject(snapshot(8));

    assert.equal(answer, undefined, 'taken');
    assert.equal(asked.length, 1, 'one statement: the marker moved to the revision, and the graph is as it was');
  });

  it('offers a snapshot with no revision as the lowest', async () => {
    marker = { current: true, held: 0, drawn: false };
    await adapter.syncProject(snapshot());
    assert.equal(asked[0]!.params.revision, 0);
  });

  it('draws a whole project in five statements, however many kinds it holds', async () => {
    marker = { current: true, held: 0, drawn: false };
    const kinds = PROJECT_NODE_KINDS.map((kind, i): ProjectGraphNode => ({ id: `n${i}`, kind, layer: projectLayerFor(kind), origin: 'derived', label: kind }));

    await adapter.syncProject({ projectId: PROJECT, builtAt: '2026-10-05T10:00:00.000Z', revision: 1, nodes: kinds, edges: [{ id: 'e1', from: 'n0', to: 'n1', rel: 'cites' }] });

    // The marker, the nodes with their labels, the edges, what is no longer
    // drawn, and the edges to close. It was a statement a kind on top.
    assert.equal(asked.length, 5);
    const nodes = asked[1]!;
    assert.equal((nodes.params.rows as unknown[]).length, kinds.length, 'every node goes in the one statement');
    for (const kind of PROJECT_NODE_KINDS) {
      assert.ok(
        nodes.query.includes(`FOREACH (ignoreMe IN CASE WHEN row.kind = '${kind}' THEN [1] ELSE [] END | SET n:${kind}:${projectLayerFor(kind)})`),
        `which labels a ${kind}`,
      );
    }
    assert.ok(nodes.query.includes(`FOREACH (ignoreMe IN CASE WHEN row.origin = 'derived' THEN [1] ELSE [] END | SET n:derived)`));
    assert.ok(nodes.query.includes(`FOREACH (ignoreMe IN CASE WHEN row.origin = 'authored' THEN [1] ELSE [] END | SET n:authored)`));
    const clears = nodes.query.indexOf('REMOVE n:derived:authored');
    assert.ok(clears > 0 && nodes.query.indexOf('FOREACH') > clears, 'after the labels it had are cleared');
  });

  it('writes a note and its links in two', async () => {
    const note: ProjectGraphNode = { id: 'note-1', kind: 'thought', layer: 'deliberation', origin: 'authored', label: 'why this matters' };
    await adapter.appendProject(PROJECT, [note], [{ id: 'note-1>p1', from: 'note-1', to: 'p1', rel: 'cites' }]);
    assert.equal(asked.length, 2);
    assert.equal(asked.some((statement) => /GraphSync/.test(statement.query)), false, 'a note does not move the marker');
  });
});

describe('what a sync would draw', () => {
  it('is the same whatever order the snapshot was built in, and differs when anything drawn does', () => {
    const [a, b] = [parcel('p1'), parcel('p2')];
    const edge = { id: 'e1', from: 'p1', to: 'p2', rel: 'cites' as const };
    const drawing = drawingOf([a, b], [edge]);

    assert.match(drawing, /^[0-9a-f]{64}$/);
    assert.equal(drawingOf([b, a], [edge]), drawing);
    assert.notEqual(drawingOf([a, { ...b, label: 'renamed' }], [edge]), drawing);
    assert.notEqual(drawingOf([a, { ...b, status: 'missing' }], [edge]), drawing);
    assert.notEqual(drawingOf([a, b], []), drawing);
    assert.notEqual(drawingOf([a, b], [{ ...edge, to: 'p1' }]), drawing);
  });
});

describe('the Neo4j adapter and the marker’s lifetime', () => {
  it('drops the marker with the graph, and drops it first', async () => {
    await adapter.purgeProject(PROJECT);

    // Deleting the marker waits for a sync of the project that still holds
    // it, so the graph is removed after that sync wrote, not during.
    assert.equal(asked.length, 2);
    assert.match(asked[0]!.query, /MATCH \(s:GraphSync \{ projectId: \$projectId \}\) DELETE s/);
    assert.match(asked[1]!.query, /MATCH \(n:Ryt \{ projectId: \$projectId \}\) DETACH DELETE n/);
    assert.ok(asked.every((statement) => statement.transaction === 1 && statement.params.projectId === PROJECT));
  });

  it('keeps one marker a project', async () => {
    await ensureNeo4jSchema();
    assert.ok(
      asked.some((statement) => /CREATE CONSTRAINT graph_sync_project IF NOT EXISTS FOR \(s:GraphSync\) REQUIRE s\.projectId IS UNIQUE/.test(statement.query)),
      'two instances syncing a project for the first time merge the same node',
    );
  });

  it('never gives the marker the label or the relationship the graph is read by', async () => {
    marker = { current: true, held: 0, drawn: false };
    await adapter.syncProject(snapshot(1));
    await adapter.purgeProject(PROJECT);

    // A build that predates the marker matches `:Ryt` and `RYT_EDGE` alone,
    // and must go on reading and rebuilding the graph without meeting it.
    for (const { query } of asked.filter((statement) => /GraphSync/.test(statement.query))) {
      assert.equal(/Ryt|RYT_EDGE/.test(query), false);
    }
  });
});
