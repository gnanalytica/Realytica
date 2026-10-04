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
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { ProjectGraphNode } from '@realytica/shared';
import type { GraphAdapter, ProjectGraphSnapshot } from '../apps/api/src/graph/types';
import { PREVIEW_KEEPS_NO_GRAPH, detached, isPreviewDeployment } from '../apps/api/src/graph/preview';

const PROJECT = 'prj-preview-test';

function parcel(id: string): ProjectGraphNode {
  return { id, kind: 'parcel', layer: 'entity', origin: 'derived', label: id };
}

function note(id: string): ProjectGraphNode {
  return { id, kind: 'thought', layer: 'deliberation', origin: 'authored', label: 'why this matters' };
}

function snapshot(nodes: ProjectGraphNode[]): ProjectGraphSnapshot {
  return { projectId: PROJECT, builtAt: '2026-10-04T00:00:00.000Z', nodes, edges: [] };
}

describe('a preview deployment and the graph store', () => {
  let dataDir: string;
  let store: GraphAdapter;
  let preview: GraphAdapter;

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ryt-preview-graph-'));
    process.env.REALYTICA_DATA_DIR = dataDir;
    ({ journalAdapter: store } = await import('../apps/api/src/graph/journal'));
    preview = detached(store);
  });
  beforeEach(async () => {
    await store.purgeProject(PROJECT);
  });
  after(async () => {
    await rm(dataDir, { recursive: true, force: true });
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
});
