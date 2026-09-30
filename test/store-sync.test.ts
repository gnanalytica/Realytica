/**
 * Several instances over one store.
 *
 * Serverless runs more than one instance, each holding the store it loaded
 * at its own boot. Before this, an approval made through one was invisible to
 * the next page another served, that instance's next save put its older copy
 * back over it, and every save rewrote the workspace document from the saving
 * instance's snapshot — so a refresh of the samples on one could be undone by
 * a chat turn on another.
 *
 * Two `Store` objects over the same filesystem directory stand in for two
 * instances: the property under test is what reaches storage and back.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { createProject, seedBdaReferenceProject, seedDemoProject, type DdProject } from '@realytica/shared';

type StoreModule = typeof import('../apps/api/src/store');
let Store: StoreModule['Store'];

before(async () => {
  process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-sync-'));
  Store = (await import('../apps/api/src/store')).Store;
});

async function twoInstances(projects: DdProject[]): Promise<[InstanceType<StoreModule['Store']>, InstanceType<StoreModule['Store']>]> {
  const seed = new Store();
  await seed.init();
  seed.data.projects = projects;
  seed.data.memberships = [];
  await seed.save();
  const a = new Store();
  const b = new Store();
  await a.init();
  await b.init();
  return [a, b];
}

function touch(project: DdProject, at: string): void {
  project.updatedAt = at;
}

describe('two instances over one store', () => {
  it('serve and build on each other’s writes to a project', async () => {
    const [a, b] = await twoInstances([seedDemoProject(), seedBdaReferenceProject()]);
    const onA = a.data.projects![0]!;
    const heldByB = b.data.projects!.find((p) => p.id === onA.id)!;

    onA.name = 'Renamed through A';
    touch(onA, '2026-09-30T10:00:00.000Z');
    await a.save();

    await b.syncProject(onA.id, { force: true });
    assert.equal(heldByB.name, 'Renamed through A', 'the object B already held is the live one');

    heldByB.description = 'Described through B';
    touch(heldByB, '2026-09-30T10:01:00.000Z');
    await b.save();

    await a.syncProject(onA.id, { force: true });
    assert.equal(onA.name, 'Renamed through A', 'B did not put its older copy back');
    assert.equal(onA.description, 'Described through B');
  });

  it('leaves alone a change this instance has not written yet', async () => {
    const [a, b] = await twoInstances([seedDemoProject()]);
    const onA = a.data.projects![0]!;
    onA.name = 'Written by A';
    touch(onA, '2026-09-30T11:00:00.000Z');
    await a.save();

    const onB = b.data.projects![0]!;
    onB.name = 'Not yet written by B';
    touch(onB, '2026-09-30T11:00:05.000Z');
    await b.syncProject(onB.id, { force: true });
    assert.equal(onB.name, 'Not yet written by B');
  });

  it('keep one index: projects created and removed on either survive the other’s saves', async () => {
    const [keep, gone] = [seedDemoProject(), seedBdaReferenceProject()];
    const [a, b] = await twoInstances([keep, gone]);

    const created = createProject({ name: 'Made on A', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0101');
    a.data.projects!.push(created);
    await a.save();

    b.data.projects = b.data.projects!.filter((p) => p.id !== gone.id);
    await b.save();

    await a.syncIndex();
    await b.syncIndex();
    for (const instance of [a, b]) {
      const ids = instance.data.projects!.map((p) => p.id).sort();
      assert.deepEqual(ids, [keep.id, created.id].sort());
    }

    // A later save through A must not bring the removed project back.
    const again = new Store();
    await again.init();
    assert.deepEqual(again.data.projects!.map((p) => p.id).sort(), [keep.id, created.id].sort());
  });

  it('does not undo another instance’s workspace change when saving its own project', async () => {
    const [a, b] = await twoInstances([seedDemoProject()]);
    a.data.memberships = [{ tenantId: 'tnt_x', email: 'new@example.com', role: 'staff' } as never];
    await a.save();

    const onB = b.data.projects![0]!;
    touch(onB, '2026-09-30T12:00:00.000Z');
    await b.save();

    const fresh = new Store();
    await fresh.init();
    assert.equal(fresh.data.memberships?.some((m) => m.email === 'new@example.com'), true, 'the member A added is still there');
    // What every request does first.
    await b.syncIndex();
    assert.equal(b.data.memberships?.some((m) => m.email === 'new@example.com'), true, 'and B knows them before its next request');
  });
});
