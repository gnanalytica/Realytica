/**
 * A preview deployment and the project's memory.
 *
 * A preview keeps no graph: it runs a branch against the live site's graph
 * database, and a branch that draws the graph differently would redraw the
 * live site's (see `graph-preview.test.ts`). Memory has no such hazard. An
 * entry is told from the record by a rule that gives every build the same id
 * for the same event, and an entry found is never changed. So a preview
 * writes memory, into the database the live site uses, and still writes no
 * graph. What it may not do is pass for the live site: every write it makes
 * says it is not, so the store never marks a project's memory the live
 * site's for a preview's writing, and never lets a preview write a later
 * shape over what the live site wrote. Only the deployment Vercel calls
 * production is the live site: not a preview, and not a machine that is not
 * on Vercel at all, whatever database it is pointed at.
 *
 * Booted the way a preview is: Vercel's name for the deployment, and the
 * live site's graph database configured. Nothing here reaches a database.
 * The address is one nothing listens on, and the store is handed a driver
 * that records what it is asked.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Driver } from 'neo4j-driver';
import { MEM_SCHEMA, addFinding, createProject, type MemEntry } from '@realytica/shared';
import type { MemBatch, MemoryPort } from '../apps/api/src/graph/mem/types';

interface Asked {
  query: string;
  params: Record<string, unknown>;
}

let root: string;
let asked: Asked[] = [];
let Store: typeof import('../apps/api/src/store').Store;
let storage: typeof import('../apps/api/src/storage').storageAdapter;
let closeNeo4j: typeof import('../apps/api/src/graph/neo4j').closeNeo4j;

/** A driver whose every session writes down what it is asked, over a database that holds nothing. */
function recordingDriver(): Driver {
  const tx = {
    run: async (query: string, params: Record<string, unknown> = {}) => {
      asked.push({ query, params });
      // Where a project's memory stands, on a node just made: nowhere.
      const answers = /SET m\.asked/.test(query) ? [{ schema: null, auditThrough: null, turnThrough: null }] : [];
      return { records: answers.map((row) => ({ get: (key: string) => (row as Record<string, unknown>)[key] })) };
    },
  };
  type Work<T> = (transaction: typeof tx) => Promise<T>;
  const session = {
    executeWrite: async <T>(work: Work<T>): Promise<T> => work(tx),
    executeRead: async <T>(work: Work<T>): Promise<T> => work(tx),
    close: async (): Promise<void> => {},
  };
  return { session: () => session, close: async () => {} } as unknown as Driver;
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-preview-'));
  process.env.REALYTICA_DATA_DIR = root;
  process.env.VERCEL_ENV = 'preview';
  process.env.REALYTICA_NEO4J_URL = 'bolt://127.0.0.1:1';
  const neo4j = await import('../apps/api/src/graph/neo4j');
  neo4j.useNeo4jDriver(recordingDriver());
  closeNeo4j = neo4j.closeNeo4j;
  ({ Store } = await import('../apps/api/src/store'));
  ({ storageAdapter: storage } = await import('../apps/api/src/storage'));
});

after(async () => {
  await closeNeo4j();
  delete process.env.REALYTICA_DATA_DIR;
  delete process.env.VERCEL_ENV;
  delete process.env.REALYTICA_NEO4J_URL;
  await rm(root, { recursive: true, force: true });
});

const GRAPH = /Ryt|RYT_EDGE|GraphSync/;

describe('a preview deployment', () => {
  it('is handed the graph store detached, and the memory store whole', async () => {
    const { graphAdapter } = await import('../apps/api/src/graph');
    const { memoryPort } = await import('../apps/api/src/graph/mem');
    assert.equal(graphAdapter.detached, true);
    assert.equal(memoryPort.kind, 'neo4j', 'memory is kept where the live site keeps it');
  });

  it('says of every write that it is not the live site', async () => {
    const { writeMemory } = await import('../apps/api/src/graph/mem/write');
    const offered: MemBatch[] = [];
    const port = { write: async (batch: MemBatch) => (offered.push(batch), { written: 0 }) } as unknown as MemoryPort;
    await writeMemory(port, 'tnt_preview_memory', {}, { projectId: 'prj_preview_write', entries: [], through: {} });
    assert.equal(offered[0]!.live, false);
  });

  it('is not the live site, and neither is anything but the deployment Vercel runs as production', async () => {
    const { memWriter } = await import('../apps/api/src/graph/mem/write');
    assert.deepEqual(memWriter(), { schema: MEM_SCHEMA, live: false }, 'this deployment, a preview');
    const address = 'the-deployment.vercel.app';
    assert.equal(memWriter({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: address }).live, true, 'named production, at the address Vercel serves it from');
    const others: NodeJS.ProcessEnv[] = [
      { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: address },
      { VERCEL: '1', VERCEL_ENV: 'development', VERCEL_URL: address },
      { VERCEL: '1', VERCEL_URL: address },
      // A machine handed production's settings, as `vercel env pull` writes them: the name, and an address that is empty.
      { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: '', REALYTICA_NEO4J_URL: 'bolt://the-live-sites-database' },
      { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: '  ' },
      { VERCEL_ENV: 'production' },
      { REALYTICA_NEO4J_URL: 'bolt://the-live-sites-database' },
      {},
    ];
    for (const env of others) assert.equal(memWriter(env).live, false, `${JSON.stringify(env)} is not the live site`);
  });

  it('asks the memory store nothing while it holds no project', async () => {
    const instance = new Store();
    await instance.init();
    await instance.syncIndex();
    await instance.graphCaughtUp();
    assert.deepEqual(asked, [], 'an instance with nothing to tell does not start by looking for memory left behind');
  });

  it('writes a project’s memory on a save, under the ids any build gives the same events, and writes no graph', async () => {
    const project = createProject({ name: 'Preview memory plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MP1');
    project.tenantId = 'tnt_preview_memory';
    const finding = addFinding(project, { title: 'Extent differs', description: 'Two papers disagree.', severity: 'high', discipline: 'legal' }, 'lead@example.com');
    const instance = new Store();
    await instance.init();
    instance.data.projects = [project];
    await instance.save();
    await instance.graphCaughtUp();

    const write = asked.find((statement) => /MERGE \(e:MemEntry \{ id: entry\.id \}\)/.test(statement.query));
    assert.ok(write, 'the entries were written');
    assert.equal(write.params.projectId, project.id);
    assert.equal(write.params.tenantId, 'tnt_preview_memory');
    assert.equal(write.params.live, null, 'and it leaves whose memory it is as it found it: a preview never marks one the live site’s');
    const entries = write.params.entries as Array<Pick<MemEntry, 'id' | 'kind' | 'about'>>;
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.kind, entry.about]),
      [[`${project.id}::mem::${project.audit.at(-1)!.id}`, 'finding_raised', [finding.id]]],
      'an id that follows from the record alone, so the live site telling the same event writes the same node',
    );
    assert.ok(asked.some((statement) => /MERGE \(m:MemProject \{ id: \$id \}\)/.test(statement.query)));
    assert.deepEqual(asked.filter((statement) => GRAPH.test(statement.query)), [], 'and its projection of the graph stays out of the live site’s database');

    // Removing the project is the one graph write a preview makes, and its memory goes with it.
    asked = [];
    await storage.deleteCaseDocuments(project.id);
    instance.data.projects = [];
    await instance.save();
    await instance.graphCaughtUp();
    assert.ok(asked.some((statement) => /MATCH \(n:Ryt \{ projectId: \$projectId \}\)[\s\S]*DETACH DELETE/.test(statement.query)), 'the graph the live site drew is removed');
    for (const label of ['MemProject', 'MemEntry']) {
      assert.ok(asked.some((statement) => statement.query === `MATCH (n:${label} { projectId: $projectId }) DETACH DELETE n` && statement.params.projectId === project.id), `${label} nodes are removed`);
    }
  });
});
