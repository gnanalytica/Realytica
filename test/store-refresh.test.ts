/**
 * An instance that has not heard of a flow yet must not say it never existed.
 *
 * `initStore` runs once at boot and `store.data` is synchronous from then on,
 * which is right for one long-running process and wrong for a serverless
 * deployment: "the process" is several instances, each holding the snapshot it
 * loaded at its own cold start. A flow created on instance A is durable the
 * moment A answers 201 and is still absent from instance B's memory — so the
 * very next read, if it lands on B, answers "Flow not found" about something
 * that demonstrably exists. Click again, land on A, and it works. That is what
 * made it look intermittent rather than structural.
 *
 * These tests stand in for the second instance by writing to the store
 * document behind this process's back — which is exactly what the other
 * instance's save looks like from here — and then asserting that a refresh
 * sees it.
 *
 * Run against the real filesystem adapter, like `store-sharding`, because the
 * property under test IS the adapter interaction.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let dataDir: string;
let store: typeof import('../apps/api/src/store').store;
let initStore: typeof import('../apps/api/src/store').initStore;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'realytica-refresh-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  const mod = await import('../apps/api/src/store');
  store = mod.store;
  initStore = mod.initStore;
  await initStore();
});

after(() => {
  delete process.env.REALYTICA_DATA_DIR;
});

const storePath = () => path.join(dataDir, 'realytica.json');

/** What the other instance's `save` leaves behind, from this one's point of view. */
async function writeFlowFromAnotherInstance(id: string, tenantId: string): Promise<void> {
  const raw = JSON.parse(await readFile(storePath(), 'utf-8')) as Record<string, unknown>;
  const flows = Array.isArray(raw.flows) ? (raw.flows as unknown[]) : [];
  flows.push({
    id,
    tenantId,
    name: 'Written elsewhere',
    nodes: [],
    edges: [],
    enabled: false,
    createdAt: new Date().toISOString(),
    createdBy: 'other@instance',
    updatedAt: new Date().toISOString(),
    updatedBy: 'other@instance',
    version: 1,
  });
  raw.flows = flows;
  await writeFile(storePath(), JSON.stringify(raw));
}

/** The throttle is real time, so a test that needs a second refresh waits it out. */
function clearRefreshThrottle(): void {
  (store as unknown as { lastRefresh: number }).lastRefresh = 0;
}

describe('workspace refresh', () => {
  it('picks up a flow another instance wrote after this one booted', async () => {
    store.data.flows = [];
    await store.save();

    await writeFlowFromAnotherInstance('flw_elsewhere', 't1');

    // Before refreshing, this instance genuinely does not have it — which is
    // the bug, and is what the 404 was truthfully reporting about its own memory.
    assert.equal(store.data.flows?.some((f) => f.id === 'flw_elsewhere'), false);

    clearRefreshThrottle();
    await store.refreshWorkspace();

    assert.equal(
      store.data.flows?.some((f) => f.id === 'flw_elsewhere'),
      true,
      'a refresh must see a flow written by another instance',
    );
  });

  it('keeps the projects it already holds, which live in their own shards', async () => {
    // The workspace document does not carry projects, so a naive reload would
    // replace a populated list with nothing and empty the projects page.
    const before = (store.data.projects ?? []).length;
    clearRefreshThrottle();
    await store.refreshWorkspace();
    assert.equal((store.data.projects ?? []).length, before);
  });

  it('throttles, so a wrong id in a URL cannot cost a storage read per request', async () => {
    clearRefreshThrottle();
    await store.refreshWorkspace();

    await writeFlowFromAnotherInstance('flw_throttled', 't1');
    // No throttle reset: this one lands inside the window and must be skipped.
    await store.refreshWorkspace();
    assert.equal(store.data.flows?.some((f) => f.id === 'flw_throttled'), false);

    clearRefreshThrottle();
    await store.refreshWorkspace();
    assert.equal(store.data.flows?.some((f) => f.id === 'flw_throttled'), true);
  });

  it('keeps what it has when the document is unreadable, rather than adopting an empty one', async () => {
    // The adapter answers null for a document that is absent OR unparseable —
    // it logs and recovers to empty, which is right at boot and catastrophic
    // here: a document caught mid-write would blank every flow, tenant and
    // credential this instance holds. A 404 on one flow must not become the
    // disappearance of all of them.
    const good = await readFile(storePath(), 'utf-8');
    const held = store.data.flows?.length ?? 0;
    assert.ok(held > 0, 'the fixture needs at least one flow for this to prove anything');

    await writeFile(storePath(), '{ not json at all');
    clearRefreshThrottle();
    await store.refreshWorkspace();

    assert.equal(store.data.flows?.length, held, 'an unreadable document must teach this instance nothing');
    await writeFile(storePath(), good);
  });
});
