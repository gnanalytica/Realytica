/**
 * Removing a project.
 *
 * A project is gone when its documents are gone from storage, and every
 * instance takes that for the answer. A removal that carried on after its
 * documents could not be removed left the project half gone: off the list
 * and out of the index, its grants and its graph dropped, and its document
 * still in storage, where the next instance to look listed the project
 * again.
 *
 * What is pinned here. The documents go first. When they will not go, the
 * project is still on the list, with its grants, its document, its graph and
 * its memory as they were, and the caller is told so in words to pass on.
 * When they go, everything kept about the project goes with them at once:
 * the index entry, the grants, the graph and the memory. While they are
 * going, which takes longer than a page left open on the project waits
 * before it asks again, no read of storage lists the project again: the
 * removal used to end with the project listed and served and no document
 * behind it. And a project put back because its documents would not go is
 * read from storage again as any other is.
 *
 * Nor is a document written back. A save of the project that is on its way
 * to storage when the removal is asked for is let land first, and a save
 * does not begin a write of a project taken off since it began: a removal
 * never answers that the project is gone while its document is in storage
 * and nothing lists it. Once the removal has ended the instance lets go of
 * the project. Its document can still come back, saved by another instance
 * that held a change, and then this instance reads the project as it reads
 * any other and removes it when asked again; only a read that began before
 * the removal ended is not believed. And kept means kept: a removal that
 * took the project's own document before it failed writes it again.
 *
 * Run against the app's own store, the real filesystem store and the files
 * the graph and memory are kept in on a machine with no graph database, in a
 * temporary directory.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import { addFinding, createProject, type DdProject, type ProjectGrant } from '@realytica/shared';

type RemovalModule = typeof import('../apps/api/src/project-removal');

let root: string;
let dataDir: string;
let store: typeof import('../apps/api/src/store').store;
let Store: typeof import('../apps/api/src/store').Store;
let storage: typeof import('../apps/api/src/storage').storageAdapter;
let graph: typeof import('../apps/api/src/graph').graphAdapter;
let memory: typeof import('../apps/api/src/graph/mem').memoryPort;
let removeProject: RemovalModule['removeProject'];
let PROJECT_KEPT: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-removal-'));
  process.env.REALYTICA_DATA_DIR = root;
  const storeModule = await import('../apps/api/src/store');
  await storeModule.initStore();
  store = storeModule.store;
  Store = storeModule.Store;
  dataDir = storeModule.DATA_DIR;
  ({ storageAdapter: storage } = await import('../apps/api/src/storage'));
  ({ graphAdapter: graph } = await import('../apps/api/src/graph'));
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ removeProject, PROJECT_KEPT } = await import('../apps/api/src/project-removal'));
});

after(async () => {
  await store.graphCaughtUp();
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

const TENANT = 'tnt_removal_tests';

/** A project with something to remember, a person given access to it, saved and told. */
async function filed(name: string): Promise<DdProject> {
  const project = createProject({ name, type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-RM1');
  project.tenantId = TENANT;
  addFinding(project, { title: 'Extent differs', description: 'Two papers disagree.', severity: 'high', discipline: 'legal' }, 'lead@example.com');
  store.data.projects = [...(store.data.projects ?? []), project];
  const grant: ProjectGrant = {
    id: `grant-${project.id}`,
    tenantId: TENANT,
    projectId: project.id,
    email: 'surveyor@example.com',
    role: 'contributor',
    allAssessments: true,
    assessmentIds: [],
    allScopes: true,
    scopeKeys: [],
    areas: [],
    createdAt: '2026-10-05T08:00:00.000Z',
    createdBy: 'lead@example.com',
  };
  store.data.grants = [...(store.data.grants ?? []), grant];
  await store.save();
  await store.graphCaughtUp();
  return project;
}

const listed = (project: DdProject): boolean => (store.data.projects ?? []).some((other) => other.id === project.id);
const granted = (project: DdProject): boolean => (store.data.grants ?? []).some((grant) => grant.projectId === project.id);
const documentThere = (project: DdProject): Promise<boolean> => stat(path.join(dataDir, 'uploads', project.id, 'project.json')).then(() => true, () => false);
const indexed = async (project: DdProject): Promise<boolean> =>
  (JSON.parse(await readFile(path.join(dataDir, 'realytica.json'), 'utf-8')) as { projectIds: string[] }).projectIds.includes(project.id);
const remembered = async (project: DdProject): Promise<number> => (await memory.entries(project.id, 100)).length;

/** A promise a test settles when it chooses. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** Lets what is already runnable run, timers aside. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A change to a project that its instance has not written yet. */
function edit(project: DdProject, title: string, at: string) {
  const finding = addFinding(project, { title, description: 'Made up.', severity: 'low', discipline: 'legal' }, 'lead@example.com');
  project.updatedAt = at;
  return finding;
}

let ahead = 0;

/**
 * Reads the workspace from storage, as the request after next does. The
 * store reads it for a request at most once in two seconds, so the clock is
 * put on by a minute for the read, further each time.
 */
async function readWorkspace(): Promise<void> {
  ahead += 60_000;
  mock.timers.enable({ apis: ['Date'], now: Date.now() + ahead });
  try {
    await store.syncIndex();
  } finally {
    mock.timers.reset();
  }
}

/**
 * Starts removing a project whose documents take their time to go. Settles
 * when the removal is waiting on storage. `end` lets storage answer, and
 * with `fail` it answers that the documents would not go.
 */
async function removing(project: DdProject, fail = false): Promise<{ outcome: Promise<string>; end: () => void; restore: () => void }> {
  const reached = deferred();
  const gate = deferred();
  const remove = storage.deleteCaseDocuments.bind(storage);
  const slow = mock.method(storage, 'deleteCaseDocuments', async (id: string) => {
    reached.resolve();
    await gate.promise;
    if (fail) throw new Error('storage did not answer');
    return remove(id);
  });
  const outcome = removeProject(project.id);
  await reached.promise;
  return { outcome, end: gate.resolve, restore: () => slow.mock.restore() };
}

describe('removing a project', () => {
  it('leaves it as it was, and says so, when its documents could not be removed', async () => {
    const project = await filed('Kept plot');
    // Another project is listed after it, so that where it stood is not the end of the list.
    await filed('Listed after the kept plot');
    const stood = store.data.projects!.findIndex((other) => other.id === project.id);
    const warned = mock.method(console, 'warn', () => {});
    const failing = mock.method(storage, 'deleteCaseDocuments', async () => {
      throw new Error('storage did not answer');
    });
    try {
      assert.equal(await removeProject(project.id), 'kept');
      await store.save();
      await store.graphCaughtUp();
    } finally {
      failing.mock.restore();
      warned.mock.restore();
    }
    assert.match(PROJECT_KEPT, /has not been deleted/);
    assert.match(PROJECT_KEPT, /Try again/, 'in words a person can act on');
    assert.ok(listed(project), 'it is still on the list');
    assert.ok(stood < store.data.projects!.length - 1);
    assert.equal(store.data.projects!.findIndex((other) => other.id === project.id), stood, 'where it was');
    assert.ok(granted(project), 'with the access given to it');
    assert.ok(await documentThere(project));
    assert.ok(await indexed(project));
    assert.ok(await graph.readProject(project.id), 'its graph');
    assert.equal(await remembered(project), 1, 'and its memory');
  });

  it('takes everything kept about it, at once, when they go', async () => {
    const project = await filed('Removed plot');
    const other = await filed('Other plot');
    assert.equal(await removeProject(project.id), 'removed');
    await store.graphCaughtUp();

    assert.equal(listed(project), false);
    assert.equal(granted(project), false, 'the access given to it');
    assert.equal(await documentThere(project), false);
    assert.equal(await indexed(project), false);
    assert.equal(await graph.readProject(project.id), null, 'its graph');
    assert.equal(await remembered(project), 0, 'and its memory, with no second look a minute later');
    assert.equal((await memory.projects()).some((row) => row.projectId === project.id), false);

    assert.ok(listed(other) && granted(other) && (await documentThere(other)), 'and nothing of another project');
    assert.equal(await remembered(other), 1);
  });

  it('answers that there is none, for a project there is none of', async () => {
    assert.equal(await removeProject('prj_no_such_project'), 'absent');
  });
});

describe('a request about a project that arrives while its documents are going', () => {
  it('does not read the project back onto the list, and the removal ends with nothing of it left', async () => {
    const project = await filed('Open in a tab');
    const reads = mock.method(storage, 'readStore');
    const going = await removing(project);
    try {
      // The page left open on the project asks for it: the store reads the project, and then the workspace, from storage.
      assert.ok(await documentThere(project), 'its document is still in storage');
      await store.syncProject(project.id, { force: true });
      assert.equal(listed(project), false, 'the project was read, and not listed again');
      const before = reads.mock.callCount();
      await readWorkspace();
      assert.ok(reads.mock.callCount() > before, 'the workspace was read, with the index still naming the project');
      assert.equal(listed(project), false, 'and that did not list it again either');
      // A second request for the removal finds nothing to remove.
      assert.equal(await removeProject(project.id), 'absent');

      going.end();
      assert.equal(await going.outcome, 'removed');
    } finally {
      going.end();
      going.restore();
      reads.mock.restore();
    }
    await store.graphCaughtUp();

    assert.equal(listed(project), false);
    assert.equal(granted(project), false);
    assert.equal(await documentThere(project), false);
    assert.equal(await indexed(project), false, 'the index no longer names it, though it was read while the project was going');
    assert.equal(await graph.readProject(project.id), null, 'its graph');
    assert.equal(await remembered(project), 0, 'and its memory');

    // And the page asking once more, after, finds nothing to read.
    await store.syncProject(project.id, { force: true });
    assert.equal(listed(project), false);
  });

  it('finds the project where it was once its documents would not go, and storage is read for it again', async () => {
    const project = await filed('Asked for while kept');
    const warned = mock.method(console, 'warn', () => {});
    const going = await removing(project, true);
    try {
      await store.syncProject(project.id, { force: true });
      assert.equal(listed(project), false, 'not listed while the removal is deciding');
      going.end();
      assert.equal(await going.outcome, 'kept');
    } finally {
      going.end();
      going.restore();
      warned.mock.restore();
    }
    assert.ok(listed(project), 'it is on the list again');
    assert.ok(await documentThere(project));

    // Dropped from this instance's list by something that was not a removal: the next request reads it back from storage.
    store.data.projects = store.data.projects!.filter((other) => other.id !== project.id);
    await store.syncProject(project.id, { force: true });
    assert.ok(listed(project), 'a project put back is read from storage as any other is');

    // And asked again, with storage answering, it goes.
    assert.equal(await removeProject(project.id), 'removed');
    await store.graphCaughtUp();
    assert.equal(listed(project), false);
    assert.equal(await indexed(project), false);
  });
});

describe('a save of the project that is under way when its removal is asked for', () => {
  it('is let land before the documents are removed, so that no document is left for a project nothing lists', async () => {
    const project = await filed('Being saved');
    const put = storage.putDocument.bind(storage);
    const reached = deferred();
    const gate = deferred();
    let held = false;
    const slow = mock.method(storage, 'putDocument', async (...args: Parameters<typeof storage.putDocument>) => {
      // The first write of the project's document is kept on its way to storage.
      if (args[0] === project.id && args[1] === 'project.json' && !held) {
        held = true;
        reached.resolve();
        await gate.promise;
      }
      return put(...args);
    });
    const removals = mock.method(storage, 'deleteCaseDocuments');
    let outcome: string | undefined;
    try {
      // An edit's save, begun.
      edit(project, 'An edit', '2026-10-06T12:00:00.000Z');
      const saving = store.save();
      await reached.promise;
      // The removal is asked for while that write is out.
      const removal = removeProject(project.id).then((answer) => {
        outcome = answer;
      });
      for (let i = 0; i < 20; i += 1) await turn();
      assert.equal(outcome, undefined, 'the removal has not answered');
      assert.equal(removals.mock.callCount(), 0, 'and has removed nothing: the write would have landed after it');
      assert.equal(listed(project), false, 'though the project is off the list from the moment it was asked for');

      gate.resolve();
      await removal;
      await saving;
    } finally {
      gate.resolve();
      slow.mock.restore();
      removals.mock.restore();
    }
    await store.graphCaughtUp();

    assert.equal(outcome, 'removed');
    assert.equal(await documentThere(project), false, 'the write landed, and went with the rest');
    assert.equal(listed(project), false);
    assert.equal(await indexed(project), false);
    assert.equal(await remembered(project), 0);
  });

  it('is waited for with every other write of the project that is out, when two saves overlap', async () => {
    // Two saves of one project, each with its write on the way. Whichever lands first, the removal waits for the other.
    for (const landsFirst of [0, 1] as const) {
      const project = await filed(`Saved twice at once, write ${landsFirst + 1} lands first`);
      const put = storage.putDocument.bind(storage);
      const reached = [deferred(), deferred()];
      const gates = [deferred(), deferred()];
      let writes = 0;
      const slow = mock.method(storage, 'putDocument', async (...args: Parameters<typeof storage.putDocument>) => {
        if (args[0] === project.id && args[1] === 'project.json' && writes < 2) {
          const mine = writes;
          writes += 1;
          reached[mine]!.resolve();
          await gates[mine]!.promise;
        }
        return put(...args);
      });
      const removals = mock.method(storage, 'deleteCaseDocuments');
      let outcome: string | undefined;
      try {
        edit(project, 'An edit', '2026-10-06T12:00:00.000Z');
        const first = store.save();
        await reached[0]!.promise;
        edit(project, 'Another edit', '2026-10-06T12:00:01.000Z');
        const second = store.save();
        await reached[1]!.promise;

        // One of the two lands. The removal is asked for with the other still out.
        gates[landsFirst]!.resolve();
        for (let i = 0; i < 20; i += 1) await turn();
        const removal = removeProject(project.id).then((answer) => {
          outcome = answer;
        });
        for (let i = 0; i < 20; i += 1) await turn();
        assert.equal(removals.mock.callCount(), 0, 'one write has landed and the other is still out: nothing is removed yet');
        assert.equal(outcome, undefined);

        gates[1 - landsFirst]!.resolve();
        await removal;
        await Promise.all([first, second]);
      } finally {
        for (const gate of gates) gate.resolve();
        slow.mock.restore();
        removals.mock.restore();
      }
      await store.graphCaughtUp();
      assert.equal(outcome, 'removed');
      assert.equal(await documentThere(project), false, 'both landed before the documents went');
      assert.equal(await indexed(project), false);
    }
  });

  it('does not begin a write of the project once it has been taken off the list', async () => {
    const first = await filed('Written first');
    const second = await filed('Removed meanwhile');
    const put = storage.putDocument.bind(storage);
    const reached = deferred();
    const gate = deferred();
    let held = false;
    const wrote: string[] = [];
    const slow = mock.method(storage, 'putDocument', async (...args: Parameters<typeof storage.putDocument>) => {
      if (args[1] === 'project.json') wrote.push(args[0]);
      if (args[0] === first.id && args[1] === 'project.json' && !held) {
        held = true;
        reached.resolve();
        await gate.promise;
      }
      return put(...args);
    });
    try {
      // One save with two projects to write. It is still writing the first when the second is removed, start to end.
      edit(first, 'An edit', '2026-10-06T12:00:00.000Z');
      edit(second, 'An edit', '2026-10-06T12:00:00.000Z');
      const saving = store.save();
      await reached.promise;
      assert.equal(await removeProject(second.id), 'removed');
      assert.equal(await documentThere(second), false);

      gate.resolve();
      await saving;
    } finally {
      gate.resolve();
      slow.mock.restore();
    }
    await store.graphCaughtUp();

    assert.ok(!wrote.includes(second.id), 'the save that had it to write came to it after it was taken off, and left it');
    assert.equal(await documentThere(second), false, 'so nothing wrote the document back');
    assert.ok(await documentThere(first), 'and the project it was writing is written');
    assert.equal(await indexed(second), false);
  });
});

describe('a project whose removal has ended', () => {
  /** Another instance that holds the project with a change it has not written. */
  async function heldElsewhere(project: DdProject) {
    const other = new Store();
    await other.init();
    const theirs = other.data.projects!.find((held) => held.id === project.id)!;
    const unsaved = edit(theirs, 'Not written yet', '2026-10-06T12:00:00.000Z');
    return { other, unsaved };
  }

  it('is let go of: saved back by another instance, it is read as any other project and removed when asked again', async () => {
    const project = await filed('Held elsewhere');
    const { other, unsaved } = await heldElsewhere(project);

    assert.equal(await removeProject(project.id), 'removed');
    await store.graphCaughtUp();
    assert.equal(await documentThere(project), false);

    // Nothing in storage says the project was removed. The other instance saves its change, and the document is back.
    await other.save();
    await other.graphCaughtUp();
    assert.ok(await documentThere(project));
    assert.equal(listed(project), false, 'nothing has asked this instance for it yet');

    // A request about the project reaches this instance, and reads it from storage as every request does.
    await store.syncProject(project.id, { force: true });
    assert.ok(listed(project), 'the project came back with its document');
    const back = store.data.projects!.find((held) => held.id === project.id)!;
    assert.ok(back.findings.some((finding) => finding.id === unsaved.id), 'as the other instance saved it');
    // The index does not name it. This instance's next save names it there again.
    assert.equal(await indexed(project), false);
    await store.save();
    await store.graphCaughtUp();
    assert.ok(await indexed(project));

    // Asked to remove it a second time, it does.
    assert.equal(await removeProject(project.id), 'removed');
    await store.graphCaughtUp();
    assert.equal(await documentThere(project), false);
    assert.equal(await indexed(project), false);
    assert.equal(listed(project), false);
    assert.equal(await remembered(project), 0);
  });

  it('is listed again by a read of the workspace too, once the index names it again', async () => {
    const project = await filed('Named again');
    const { other } = await heldElsewhere(project);
    assert.equal(await removeProject(project.id), 'removed');
    // The other instance saves its change, reads the workspace, and its next save names the project in the index.
    await other.save();
    await other.syncIndex();
    await other.save();
    await other.graphCaughtUp();
    assert.ok(await indexed(project));

    await readWorkspace();
    assert.ok(listed(project), 'this instance lists what the index names and storage holds');
    await store.graphCaughtUp();
    assert.equal(await removeProject(project.id), 'removed');
    await store.graphCaughtUp();
  });

  it('is not listed by a read of storage that began before the removal ended', async () => {
    const project = await filed('Read across the removal');
    const read = storage.getDocument.bind(storage);
    const reached = deferred();
    const gate = deferred();
    let held = false;
    const slow = mock.method(storage, 'getDocument', async (caseId: string, key: string) => {
      const bytes = await read(caseId, key);
      // The first read of the project's document has it, and is kept from answering.
      if (caseId === project.id && key === 'project.json' && !held) {
        held = true;
        reached.resolve();
        await gate.promise;
      }
      return bytes;
    });
    try {
      // A request about the project reads it, and the removal begins and ends before storage has answered the read.
      const reading = store.syncProject(project.id, { force: true });
      await reached.promise;
      assert.equal(await removeProject(project.id), 'removed');
      assert.equal(await documentThere(project), false);
      gate.resolve();
      await reading;
    } finally {
      gate.resolve();
      slow.mock.restore();
    }
    assert.equal(listed(project), false, 'what that read found was a document on its way out');
    await store.save();
    await store.graphCaughtUp();
    assert.equal(await indexed(project), false, 'and nothing names the project again');
  });

  it('nor by a read of the workspace that began before it ended', async () => {
    const project = await filed('Workspace read across the removal');
    const read = storage.getDocument.bind(storage);
    const reached = deferred();
    const gate = deferred();
    let held = false;
    const slow = mock.method(storage, 'getDocument', async (caseId: string, key: string) => {
      const bytes = await read(caseId, key);
      if (caseId === project.id && key === 'project.json' && !held) {
        held = true;
        reached.resolve();
        await gate.promise;
      }
      return bytes;
    });
    // The removal is under way, its documents still in storage and the index still naming the project.
    const going = await removing(project);
    try {
      // The workspace is read: the index names a project this instance does not list, so its document is read.
      const reading = readWorkspace();
      await reached.promise;
      // The removal ends before storage has answered that read.
      going.end();
      assert.equal(await going.outcome, 'removed');
      gate.resolve();
      await reading;
    } finally {
      going.end();
      gate.resolve();
      going.restore();
      slow.mock.restore();
    }
    assert.equal(listed(project), false);
    await store.save();
    await store.graphCaughtUp();
    assert.equal(await indexed(project), false);
    assert.equal(await documentThere(project), false);
  });

  it('is still taken out of the index by the next save, when the save that ended its removal failed', async () => {
    const project = await filed('Index not written');
    const write = storage.writeStore.bind(storage);
    let down = true;
    const failing = mock.method(storage, 'writeStore', async (...args: Parameters<typeof storage.writeStore>) => {
      if (down) throw new Error('storage did not answer');
      return write(...args);
    });
    try {
      await assert.rejects(removeProject(project.id), /storage did not answer/);
      assert.equal(await documentThere(project), false, 'its documents are gone');
      assert.ok(await indexed(project), 'and the index still names it');
      // The workspace is read before the next save, as it is before every request.
      await readWorkspace();
      assert.equal(listed(project), false);
      down = false;
      await store.save();
    } finally {
      failing.mock.restore();
    }
    await store.graphCaughtUp();
    assert.equal(await indexed(project), false, 'the next save takes it out');
  });
});

describe('a removal that took the project’s own document and then failed', () => {
  /** Storage that removes the project's document, and then fails. */
  const partWay = () =>
    mock.method(storage, 'deleteCaseDocuments', async (caseId: string) => {
      await storage.deleteDocument(caseId, 'project.json');
      throw new Error('storage failed part-way');
    });

  it('writes the document again before it says the project was kept', async () => {
    const project = await filed('Half removed');
    const warned = mock.method(console, 'warn', () => {});
    const failing = partWay();
    try {
      assert.equal(await removeProject(project.id), 'kept');
    } finally {
      failing.mock.restore();
      warned.mock.restore();
    }
    await store.graphCaughtUp();
    assert.ok(listed(project));
    assert.ok(granted(project));
    assert.ok(await documentThere(project), 'kept means kept in storage too');
    assert.ok(await indexed(project));

    // An instance that starts now lists it, which it could not without the document.
    const cold = new Store();
    await cold.init();
    assert.ok(cold.data.projects!.some((held) => held.id === project.id));
  });

  it('leaves the writing to the next save when storage will not take the document either', async () => {
    const project = await filed('Half removed, storage down');
    const warned = mock.method(console, 'warn', () => {});
    const failing = partWay();
    const put = storage.putDocument.bind(storage);
    let down = true;
    const refusing = mock.method(storage, 'putDocument', async (...args: Parameters<typeof storage.putDocument>) => {
      if (down && args[1] === 'project.json') throw new Error('storage did not answer');
      return put(...args);
    });
    try {
      assert.equal(await removeProject(project.id), 'kept', 'the answer is the same: the project is still here');
      assert.ok(listed(project));
      assert.equal(await documentThere(project), false);
      const lines = warned.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.startsWith('[projects]'));
      assert.equal(lines.length, 2, 'that its documents would not go, and that it could not be written again');
      assert.match(lines[1]!, /could not write .* again after its removal failed: storage did not answer/);

      // The project counts as unsaved, so any save by this instance writes it.
      down = false;
      await store.save();
    } finally {
      refusing.mock.restore();
      failing.mock.restore();
      warned.mock.restore();
    }
    await store.graphCaughtUp();
    assert.ok(await documentThere(project));
  });
});
