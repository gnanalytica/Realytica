/**
 * Project persistence is sharded, and only what moved is written.
 *
 * The store was one document rewritten in full on every mutation, which made
 * concurrency a whole-workspace problem: two requests that both loaded at the
 * same instant and both saved had the second silently discard everything the
 * first wrote — including projects it never touched. These tests pin the two
 * properties that fix the common case: a project's data lives in its own
 * document, and a save only rewrites the documents whose project actually
 * changed.
 *
 * Run against the real filesystem adapter in a temp directory, because the
 * property under test IS the adapter interaction; a mocked store would assert
 * that the code calls what it calls, which is not the same claim.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { seedBdaReferenceProject, seedDemoProject, type DdProject } from '@realytica/shared';

let dataDir: string;
let store: typeof import('../apps/api/src/store').store;
let initStore: typeof import('../apps/api/src/store').initStore;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'realytica-store-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  const mod = await import('../apps/api/src/store');
  store = mod.store;
  initStore = mod.initStore;
  await initStore();
});

after(() => {
  delete process.env.REALYTICA_DATA_DIR;
});

function shardPath(project: DdProject): string {
  return path.join(dataDir, 'uploads', project.id, 'project.json');
}

describe('project sharding', () => {
  it('writes each project to its own document and keeps none inline', async () => {
    const a = seedDemoProject();
    const b = seedBdaReferenceProject();
    store.data.projects = [a, b];
    await store.save();

    const core = JSON.parse(await readFile(path.join(dataDir, 'realytica.json'), 'utf-8')) as {
      projects: unknown[];
      projectIds: string[];
    };
    assert.deepEqual(core.projects, [], 'the core document holds no project data');
    assert.deepEqual([...core.projectIds].sort(), [a.id, b.id].sort(), 'it names the shards instead');

    const shard = JSON.parse(await readFile(shardPath(a), 'utf-8')) as DdProject;
    assert.equal(shard.reference, a.reference);
    assert.ok(shard.evidence.length > 0, 'the shard carries the project, not a stub');
  });

  it('leaves the core document small — it is no longer where the weight is', async () => {
    const core = await readFile(path.join(dataDir, 'realytica.json'), 'utf-8');
    const shard = await readFile(shardPath(store.data.projects![0]!), 'utf-8');
    assert.ok(core.length < 2_000, `core should be tiny, was ${core.length} bytes`);
    assert.ok(shard.length > core.length, 'the weight moved to the shard where it belongs');
  });

  it('rewrites only the project that changed', async () => {
    const [a, b] = store.data.projects!;
    const before = await stat(shardPath(b!));
    // Move A's clock the way every mutation does, leave B alone.
    await new Promise((resolve) => setTimeout(resolve, 12));
    a!.updatedAt = new Date().toISOString();
    await store.save();

    const afterA = await stat(shardPath(a!));
    const afterB = await stat(shardPath(b!));
    assert.ok(afterA.mtimeMs >= before.mtimeMs, 'the changed project was written');
    assert.equal(afterB.mtimeMs, before.mtimeMs, 'the untouched project was not rewritten');
  });

  it('loads the shards back on a cold start', async () => {
    const expected = store.data.projects!.map((p) => p.reference).sort();
    // A fresh init is exactly what a serverless cold start does.
    await initStore();
    assert.deepEqual(store.data.projects!.map((p) => p.reference).sort(), expected);
    assert.ok(store.data.projects![0]!.evidence.length > 0, 'and they come back whole');
    assert.equal(store.data.projectIds, undefined, 'the index is persistence-only, never left in memory');
  });

  it('drops a deleted project from the index', async () => {
    const removed = store.data.projects!.pop()!;
    await store.save();
    const core = JSON.parse(await readFile(path.join(dataDir, 'realytica.json'), 'utf-8')) as { projectIds: string[] };
    assert.ok(!core.projectIds.includes(removed.id));
  });
});
