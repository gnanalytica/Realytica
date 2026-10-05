/**
 * A preview deployment keeps no graph.
 *
 * A preview runs a branch against the live site's graph store. A branch that
 * draws the graph differently would rewrite every stored project in its own
 * shape, and a note pinned to a node the other side deletes loses its link
 * for good. So the store a preview is handed must be one it cannot change,
 * and one that never answers with a graph drawn by other code.
 *
 * Run against the real journal in a temporary directory rather than a stand-in
 * store: what is asserted is what is on disk afterwards.
 *
 * The routes a preview answers are asked over HTTP in
 * `graph-preview-routes.test.ts`.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { createProject, type DdProject, type NodeHandlerInput, type ProjectGraphNode } from '@realytica/shared';
import type { GraphAdapter, ProjectGraphSnapshot } from '../apps/api/src/graph/types';
import { PREVIEW_KEEPS_NO_GRAPH, detached, graphAnsweredBy, isPreviewDeployment } from '../apps/api/src/graph/preview';

const PROJECT = 'prj-preview-test';

function parcel(id: string): ProjectGraphNode {
  return { id, kind: 'parcel', layer: 'entity', origin: 'derived', label: id };
}

function note(id: string): ProjectGraphNode {
  return { id, kind: 'thought', layer: 'deliberation', origin: 'authored', label: 'why this matters' };
}

function snapshot(nodes: ProjectGraphNode[], projectId = PROJECT): ProjectGraphSnapshot {
  return { projectId, builtAt: '2026-10-04T00:00:00.000Z', nodes, edges: [] };
}

function file(name: string): DdProject {
  return createProject({ name, type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-PV1');
}

/**
 * A project that reports what was read of it.
 *
 * A graph cannot be built without reading the registers, so what the sync
 * loop read is how a test sees whether it built one.
 */
function watched(project: DdProject): { project: DdProject; read: Set<string> } {
  const read = new Set<string>();
  const seen = new Proxy(project, {
    get(target, key, receiver) {
      if (typeof key === 'string') read.add(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return { project: seen, read };
}

/*
 * One directory for the file. The journal fixes where it writes when it is
 * first loaded, so it is loaded once, after the directory is named.
 */
let dataDir: string;
let store: GraphAdapter;
let preview: GraphAdapter;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'ryt-preview-graph-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  ({ journalAdapter: store } = await import('../apps/api/src/graph/journal'));
  preview = detached(store);
});
after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('a preview deployment and the graph store', () => {
  beforeEach(async () => {
    await store.purgeProject(PROJECT);
  });

  it('is a preview only where Vercel says so', () => {
    assert.equal(isPreviewDeployment({ VERCEL_ENV: 'preview' }), true);
    assert.equal(isPreviewDeployment({ VERCEL_ENV: 'production' }), false);
    assert.equal(isPreviewDeployment({ VERCEL_ENV: 'development' }), false);
    assert.equal(isPreviewDeployment({}), false, 'a server or a laptop is not a preview');
  });

  it('leaves the stored graph as the live site wrote it', async () => {
    await store.syncProject(snapshot([parcel('old-shape')]));
    await store.appendProject(PROJECT, [note('n1')], [{ id: 'e1', from: 'n1', to: 'old-shape', rel: 'cites' }]);

    await preview.syncProject(snapshot([parcel('new-shape')]));

    const held = await store.readProject(PROJECT);
    assert.ok(held);
    assert.deepEqual(held.nodes.map((n) => n.id).sort(), ['n1', 'old-shape'], 'the node the note is pinned to is still there');
    assert.ok(held.edges.some((e) => e.id === 'e1'), 'and so is the note’s link to it');
  });

  it('answers every read as not indexed, so the caller reads the live registers', async () => {
    await store.syncProject(snapshot([parcel('p1'), parcel('p2')]));

    assert.equal(await preview.readProject(PROJECT), null);
    assert.equal(await preview.neighbourhood(PROJECT, ['p1'], 2), null);
    assert.equal(await preview.impact(PROJECT, 'p1'), null);
  });

  it('refuses a note rather than taking one it cannot keep', async () => {
    await store.syncProject(snapshot([parcel('p1')]));

    await assert.rejects(preview.appendProject(PROJECT, [note('n2')], []), { message: PREVIEW_KEEPS_NO_GRAPH });

    const held = await store.readProject(PROJECT);
    assert.ok(held && !held.nodes.some((n) => n.id === 'n2'));
  });

  it('still drops the graph of a project that is deleted', async () => {
    // The record leaves the shared project store, so its graph must leave too.
    await store.syncProject(snapshot([parcel('p1')]));

    await preview.purgeProject(PROJECT);

    assert.equal(await store.readProject(PROJECT), null);
  });

  it('says what it is', () => {
    assert.equal(preview.detached, true);
    assert.equal(store.detached, undefined);
    assert.equal(preview.kind, store.kind);
  });

  it('is reported as the projection, not as the store it reads nothing from', () => {
    assert.equal(graphAnsweredBy(preview), 'projection');
    assert.equal(graphAnsweredBy(store), 'journal');
  });
});

describe('the sync loop on a preview', () => {
  let syncGraph: typeof import('../apps/api/src/graph/sync').syncGraph;

  before(async () => {
    ({ syncGraph } = await import('../apps/api/src/graph/sync'));
  });

  /** What the loop reports back to the project store, kept for a test to read. */
  function told(): { synced: string[]; purged: string[]; settle: import('../apps/api/src/graph/sync').GraphSettlement } {
    const synced: string[] = [];
    const purged: string[] = [];
    return {
      synced,
      purged,
      settle: {
        synced: (owed) => { synced.push(owed.project.id); },
        purged: (projectId) => { purged.push(projectId); },
        refused: async () => undefined,
      },
    };
  }

  it('builds no graph for a store that would drop it', async () => {
    const { project, read } = watched(file('Preview sync'));
    // What the live site stored for this project, in the live site's shape.
    await store.syncProject(snapshot([parcel('old-shape')], project.id));

    const heard = told();
    await syncGraph([{ project, revision: 1 }], [], heard.settle, preview).finished;

    assert.deepEqual([...read].sort(), ['id', 'updatedAt'], 'nothing of the file was read but which it is and when it changed');
    assert.deepEqual(heard.synced, [project.id], 'and a store that keeps no graph is owed none, so it is not offered again');
    const held = await store.readProject(project.id);
    assert.deepEqual(held?.nodes.map((n) => n.id), ['old-shape'], 'the stored graph is as the live site left it');

    await store.purgeProject(project.id);
  });

  it('still drops the graph of a project deleted on the preview', async () => {
    const project = file('Preview delete');
    await store.syncProject(snapshot([parcel('old-shape')], project.id));

    await syncGraph([{ project, revision: 1 }], [], told().settle, preview).finished;
    assert.ok(await store.readProject(project.id), 'not while the project is there');
    // The project store says which projects have gone; the loop does not guess it.
    const heard = told();
    await syncGraph([], [project.id], heard.settle, preview).finished;

    assert.deepEqual(heard.purged, [project.id]);
    assert.equal(await store.readProject(project.id), null);
  });

  it('builds and stores the graph where the store is the deployment’s own', async () => {
    // The same loop, not on a preview: the difference is the whole point.
    const { project, read } = watched(file('Live sync'));

    await syncGraph([{ project, revision: 1 }], [], told().settle, store).finished;

    assert.ok(read.has('evidence') && read.has('findings'), 'the registers were read');
    const held = await store.readProject(project.id);
    assert.ok(held?.nodes.some((n) => n.id === project.id && n.kind === 'project'));

    await syncGraph([], [project.id], told().settle, store).finished;
    assert.equal(await store.readProject(project.id), null);
  });
});

describe('a flow reading the graph', () => {
  it('reads the live registers when the store throws', async () => {
    // A store that is down is an incident the product survives: the registers
    // are the source, and a flow's step must not fail because an index did.
    const { graphAdapter } = await import('../apps/api/src/graph');
    const { handlersFor } = await import('../apps/api/src/flows/handlers');
    const project = file('Flow retrieve');
    const down = mock.method(graphAdapter, 'neighbourhood', async () => {
      throw new Error('the store is down');
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      const input: NodeHandlerInput = {
        node: { id: 'read', kind: 'retrieve', position: { x: 0, y: 0 }, config: { kind: 'retrieve', from: 'graph', query: project.id, hops: 1 } },
        payload: {},
        dryRun: false,
        note: () => {},
      };
      const out = await handlersFor({ tenantId: 'tenant', project, actor: 'tester' })(input);

      assert.equal(down.mock.callCount(), 1, 'the store was asked first');
      const retrieved = out.retrieved as ProjectGraphNode[];
      assert.ok(retrieved.some((n) => n.id === project.id), 'and the answer came from the projection');
      assert.ok(retrieved.length > 1);
      assert.equal(out.retrievedFrom, 'graph');
      assert.match(String(warned.mock.calls[0]?.arguments[0]), /fell back to the projection: the store is down/);
    } finally {
      down.mock.restore();
      warned.mock.restore();
    }
  });
});
