/**
 * The index of projects, and the projects nobody deleted.
 *
 * The workspace document names the projects; each project is a document of
 * its own. An instance remembers which of the named projects it holds, so
 * that its next save adds to the index the ones it created and takes out the
 * ones it removed. It used to remember every id the index named, held or
 * not. Its next save then took out of the index every project it did not
 * hold: one another instance had created since this one last looked, or one
 * whose document would not load when this one booted. Nobody had deleted
 * them, and they left every instance's list.
 *
 * A project lost that way is not gone. Its document and its files are where
 * they were, and so are the grants written against it; only the index has
 * stopped naming it. The last test here is how one is put back.
 *
 * Two `Store` objects over one directory stand in for two instances, as in
 * `store-sync.test.ts`, against the real filesystem adapter.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import { createProject, type DdProject } from '@realytica/shared';

type StoreModule = typeof import('../apps/api/src/store');
type Instance = InstanceType<StoreModule['Store']>;

let root: string;
let dataDir: string;
let Store: StoreModule['Store'];
const booted: Instance[] = [];

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-index-'));
  process.env.REALYTICA_DATA_DIR = root;
  const storeModule = await import('../apps/api/src/store');
  Store = storeModule.Store;
  // The store keeps its data in a generation folder inside the data directory.
  dataDir = storeModule.DATA_DIR;
});

// What an instance offers the graph store in the background is over before the next test.
afterEach(async () => {
  for (const instance of booted.splice(0)) await instance.graphCaughtUp();
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

function file(name: string): DdProject {
  return createProject({ name, type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-IX1');
}

function touch(project: DdProject, at: string): void {
  project.updatedAt = at;
}

const indexFile = (): string => path.join(dataDir, 'realytica.json');
const documentFile = (project: DdProject): string => path.join(dataDir, 'uploads', project.id, 'project.json');

async function indexed(): Promise<string[]> {
  return (JSON.parse(await readFile(indexFile(), 'utf-8')) as { projectIds: string[] }).projectIds;
}

async function boot(): Promise<Instance> {
  const instance = new Store();
  await instance.init();
  booted.push(instance);
  return instance;
}

/** Fresh instances over a store that holds exactly `projects`. */
async function instances(projects: DdProject[], count: number): Promise<Instance[]> {
  const seed = await boot();
  seed.data.projects = projects;
  await seed.save();
  const made: Instance[] = [];
  for (let i = 0; i < count; i += 1) made.push(await boot());
  return made;
}

const lists = (instance: Instance, project: DdProject): boolean => instance.data.projects!.some((p) => p.id === project.id);

describe('the index and a project this instance does not hold', () => {
  it('keeps a project another instance created, whatever this one saves next', async () => {
    const held = file('Held by both');
    const [a, b] = await instances([held], 2);

    // A page load on A, a project created through B, and then two saves on A
    // before A looks at the index again. The first writes the workspace
    // document, as minting a reference or recording a model call does.
    await a!.syncIndex();
    const created = file('Created through B');
    b!.data.projects!.push(created);
    await b!.save();

    a!.data.nextProjectSeq = (a!.data.nextProjectSeq ?? 1) + 1;
    await a!.save();
    touch(a!.data.projects![0]!, '2026-10-05T10:00:00.000Z');
    await a!.save();

    assert.ok((await indexed()).includes(created.id), 'the index still names it');
    assert.ok(lists(await boot(), created), 'an instance booting now lists it');
    await b!.syncIndex();
    assert.ok(lists(b!, created), 'and the instance that created it has not lost it');
  });

  it('keeps a project whose document would not load when this instance booted', async () => {
    const [readable, unreadable] = [file('Readable'), file('Unreadable')];
    await instances([readable, unreadable], 0);
    const intact = await readFile(documentFile(unreadable), 'utf-8');
    // A read that failed, or a document caught half written.
    await writeFile(documentFile(unreadable), '{ "id": ');

    // The boot says so, loudly; that is not what is under test.
    const warned = mock.method(console, 'warn', () => {});
    const a = await boot().finally(() => warned.mock.restore());
    assert.equal(lists(a, unreadable), false, 'it is not in this instance’s list');
    touch(a.data.projects![0]!, '2026-10-05T10:00:00.000Z');
    await a.save();
    assert.ok((await indexed()).includes(unreadable.id), 'the index still names it');

    // Its document reads again, and the next look at the index lists it.
    await writeFile(documentFile(unreadable), intact);
    await a.syncIndex();
    assert.ok(lists(a, unreadable));
  });

  it('keeps a project whose document would not load when this instance looked at the index', async () => {
    const held = file('Held');
    const [a, b] = await instances([held], 2);
    const created = file('Created through B, unreadable to A');
    b!.data.projects!.push(created);
    await b!.save();
    const intact = await readFile(documentFile(created), 'utf-8');
    await writeFile(documentFile(created), '{ "id": ');

    const warned = mock.method(console, 'warn', () => {});
    await a!.syncIndex().finally(() => warned.mock.restore());
    assert.equal(lists(a!, created), false, 'A learned of it and could not read it');
    touch(a!.data.projects![0]!, '2026-10-05T10:00:00.000Z');
    await a!.save();

    assert.ok((await indexed()).includes(created.id), 'the index still names it');
    await writeFile(documentFile(created), intact);
    assert.ok(lists(await boot(), created));
  });

  it('still takes out of the index a project this instance removed itself', async () => {
    const [kept, removed] = [file('Kept'), file('Removed here')];
    const [a] = await instances([kept, removed], 1);

    a!.data.projects = a!.data.projects!.filter((project) => project.id !== removed.id);
    await a!.save();

    assert.deepEqual(await indexed(), [kept.id]);
  });
});

describe('a project the index lost though nobody deleted it', () => {
  it('is still in storage, and asking for it by id puts it back', async () => {
    const [kept, lost] = [file('Kept'), file('Lost from the index')];
    await instances([kept, lost], 0);
    // The index as the fault left it: every other project, and not this one.
    const core = JSON.parse(await readFile(indexFile(), 'utf-8')) as { projectIds: string[] };
    await writeFile(indexFile(), JSON.stringify({ ...core, projectIds: core.projectIds.filter((id) => id !== lost.id) }));

    const a = await boot();
    assert.equal(lists(a, lost), false, 'no instance lists it');
    const document = JSON.parse(await readFile(documentFile(lost), 'utf-8')) as DdProject;
    assert.equal(document.id, lost.id, 'its document is where it was, whole');
    assert.equal(document.name, 'Lost from the index');

    // Opening the project's page asks for it by id, which reads its document.
    await a.syncProject(lost.id);
    assert.ok(lists(a, lost), 'the instance holds it again');
    // The instance's next save names it in the index, and every other instance follows.
    await a.save();

    assert.ok((await indexed()).includes(lost.id));
    assert.ok(lists(await boot(), lost));
  });
});
