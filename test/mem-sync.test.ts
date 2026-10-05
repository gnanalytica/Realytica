/**
 * The project's memory and several instances over one project store.
 *
 * Memory is kept in the graph store, beside the graph and apart from it: an
 * entry for every event that changes what a project knows. It is told from
 * the record, after the record is durable, and nothing waits for it.
 *
 * What is pinned here. A save tells memory what the document it wrote holds,
 * after the document is written and without waiting, and adds nothing to the
 * document. A write that fails is told again by the next save or the next
 * read of the project, on any instance, and an entry told twice is one entry.
 * A write goes through only if memory stands where the writer believed. A
 * copy older than the one memory was told from tells nothing, a record that
 * has lost what memory was told from is told whole, and a memory written in
 * a later shape is left alone, and only a deployment that may raise the
 * shape does. A long record is told a write at a time. A question is told
 * once the request that asked has named who asked, though the project was
 * saved before that. Deleting the chats takes the entries of their turns. A
 * store with no room is left alone, quietly, and the graph is drawn all the
 * same. A project that is gone, document and all, takes its memory with it,
 * whichever build removed it and in the order the delete route removes it,
 * and a project whose document is still in storage keeps it. Reading memory
 * back gives each entry the titles the record has now.
 *
 * Run against the real filesystem store and the file the memory is kept in
 * on a machine with no graph database, in a temporary directory. Two `Store`
 * objects over that directory stand in for two instances. The Neo4j store's
 * side of the same rules is in `mem-neo4j-statements.test.ts`, and the rule
 * that turns a record into entries is in `mem-delta.test.ts`.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import {
  MEM_AT_MOST,
  MEM_CHAT_KINDS,
  MEM_SCHEMA,
  MEM_SCHEMA_FIRST,
  STANDARD_FACT_KEYS,
  addEvidence,
  addFinding,
  applyProjectChat,
  clearProjectConversation,
  createProject,
  memWho,
  memoryDelta,
  type DdProject,
  type MemEntry,
  type MemWatermark,
} from '@realytica/shared';
import type { GraphAdapter } from '../apps/api/src/graph/types';
import type { MemBatch, MemoryPort, MemWriteAnswer } from '../apps/api/src/graph/mem/types';

type StoreModule = typeof import('../apps/api/src/store');
type Instance = InstanceType<StoreModule['Store']>;
type SyncModule = typeof import('../apps/api/src/graph/mem/sync');

let root: string;
let dataDir: string;
let Store: StoreModule['Store'];
/** This deployment's memory store, which with no graph database configured is the file. */
let memory: MemoryPort;
let syncMemory: SyncModule['syncMemory'];
let sweepMemory: SyncModule['sweepMemory'];
let MEMORY_WAIT_MS: number;
let MEMORY_SWEEP_MS: number;
let SWEEP_AT_MOST: number;
let writeMemory: typeof import('../apps/api/src/graph/mem/write').writeMemory;
let readMemory: typeof import('../apps/api/src/graph/mem/read').readMemory;
let storage: typeof import('../apps/api/src/storage').storageAdapter;
let shapeRefused: typeof import('../apps/api/src/graph/mem/types').shapeRefused;
/** This deployment's graph store, which with nothing configured is the journal. */
let graph: GraphAdapter;

/** Every instance a test boots, so that what it tells in the background is over before the next test. */
const booted: Instance[] = [];

const LEAD = 'lead@example.com';
const TENANT = 'tnt_memory_tests';

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-sync-'));
  process.env.REALYTICA_DATA_DIR = root;
  const storeModule = await import('../apps/api/src/store');
  Store = storeModule.Store;
  dataDir = storeModule.DATA_DIR;
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ syncMemory, sweepMemory, MEMORY_WAIT_MS, MEMORY_SWEEP_MS, SWEEP_AT_MOST } = await import('../apps/api/src/graph/mem/sync'));
  ({ writeMemory } = await import('../apps/api/src/graph/mem/write'));
  ({ readMemory } = await import('../apps/api/src/graph/mem/read'));
  ({ storageAdapter: storage } = await import('../apps/api/src/storage'));
  ({ shapeRefused } = await import('../apps/api/src/graph/mem/types'));
  ({ graphAdapter: graph } = await import('../apps/api/src/graph'));
});

afterEach(async () => {
  for (const instance of booted.splice(0)) await instance.graphCaughtUp();
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

function file(name: string, tenantId = TENANT): DdProject {
  const project = createProject({ name, type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MS1');
  project.tenantId = tenantId;
  return project;
}

/** Raises a finding, at an instant the test names: the project's clock is what tells one copy from the next. */
function raise(project: DdProject, title: string, at: string) {
  const finding = addFinding(project, { title, description: 'Two papers disagree.', severity: 'high', discipline: 'legal' }, LEAD);
  project.updatedAt = at;
  return finding;
}

/**
 * An instance of a project store that holds one workspace. Memory left behind
 * is looked for a workspace at a time, so a test of the look names a
 * workspace of its own and is not kept waiting behind every other test's
 * projects.
 */
async function boot(tenantId = TENANT): Promise<Instance> {
  const instance = new Store();
  await instance.init();
  instance.data.tenants = [{ id: tenantId, name: 'Memory tests', createdAt: '2026-10-05T08:00:00.000Z' }];
  booted.push(instance);
  return instance;
}

/** Fresh instances over a store that holds exactly `projects`, each already saved once and told to memory. */
async function instances(projects: DdProject[], count = 1, tenantId = TENANT): Promise<Instance[]> {
  const seed = await boot(tenantId);
  seed.data.projects = projects;
  await seed.save();
  await seed.graphCaughtUp();
  const made: Instance[] = [];
  for (let i = 0; i < count; i += 1) made.push(await boot(tenantId));
  return made;
}

function held(instance: Instance, project: DdProject): DdProject {
  const found = instance.data.projects!.find((p) => p.id === project.id);
  assert.ok(found, 'the instance holds the project');
  return found;
}

/**
 * Removes a project in the order the delete route does: off the list and
 * saved, which is what forgetting its grants does, then its documents, then
 * saved again.
 */
async function remove(instance: Instance, project: DdProject): Promise<void> {
  instance.data.projects = instance.data.projects!.filter((other) => other.id !== project.id);
  await instance.save();
  await storage.deleteCaseDocuments(project.id);
  await instance.save();
}

async function documentOf(project: DdProject): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dataDir, 'uploads', project.id, 'project.json'), 'utf-8')) as Record<string, unknown>;
}

const indexFile = (): string => path.join(dataDir, 'realytica.json');

/** What another instance's save leaves in the index, from this one's point of view. */
async function rewriteIndex(change: (ids: string[]) => string[]): Promise<void> {
  const core = JSON.parse(await readFile(indexFile(), 'utf-8')) as { projectIds: string[] };
  core.projectIds = change(core.projectIds);
  await writeFile(indexFile(), JSON.stringify(core));
}

const entriesOf = (project: DdProject | string): Promise<MemEntry[]> => memory.entries(typeof project === 'string' ? project : project.id, 10_000);

async function standsAt(project: DdProject | string): Promise<MemWatermark | undefined> {
  const id = typeof project === 'string' ? project : project.id;
  return (await memory.watermarks([id])).get(id);
}

/** The findings memory has been told of, by the id of the finding each entry points at. */
async function findingsTold(project: DdProject): Promise<string[]> {
  return (await entriesOf(project)).filter((entry) => entry.kind === 'finding_raised').map((entry) => entry.about[0]!);
}

const hasMemory = async (project: DdProject | string): Promise<boolean> =>
  (await memory.projects()).some((row) => row.projectId === (typeof project === 'string' ? project : project.id));

/** A promise a test settles when it chooses. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** Lets what is already runnable run, timers aside. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function said(warned: { mock: { calls: Array<{ arguments: unknown[] }> } }, pattern: RegExp): string[] {
  return warned.mock.calls.map((call) => String(call.arguments[0])).filter((line) => pattern.test(line));
}

/** One pass over these copies, as an instance that has asked the memory store nothing yet. */
function pass(owed: DdProject[], opts: { known?: Map<string, MemWatermark>; stillStored?: boolean; gone?: string[] } = {}) {
  return syncMemory(
    { owed: owed.map((project) => ({ project, tenantId: TENANT })), gone: opts.gone ?? [], known: opts.known ?? new Map(), stillStored: async () => opts.stillStored ?? true },
    memory,
  );
}

describe('a save and the project’s memory', () => {
  it('tells memory what the document holds once the document is written, and adds nothing to the document', async () => {
    const project = file('Told plot');
    const finding = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const instance = await boot();
    instance.data.projects = [project];

    const order: string[] = [];
    const put = storage.putDocument.bind(storage);
    const putting = mock.method(storage, 'putDocument', async (...args: Parameters<typeof storage.putDocument>) => {
      await put(...args);
      order.push('document');
    });
    const write = memory.write.bind(memory);
    const writing = mock.method(memory, 'write', async (batch: MemBatch) => {
      order.push('memory');
      return write(batch);
    });
    try {
      await instance.save();
      await instance.graphCaughtUp();
    } finally {
      putting.mock.restore();
      writing.mock.restore();
    }

    assert.deepEqual(order, ['document', 'memory']);
    assert.equal((writing.mock.calls[0]!.arguments[0] as MemBatch).mayRaise, true, 'a deployment that is not a preview may raise the shape');
    const entries = await entriesOf(project);
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.about]), [['finding_raised', [finding.id]]]);
    assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA, auditThrough: project.audit.at(-1)!.id });
    assert.deepEqual((await memory.projects()).find((row) => row.projectId === project.id), { projectId: project.id, tenantId: TENANT });

    const stored = await documentOf(project);
    assert.deepEqual(Object.keys(stored).filter((key) => !(key in project)), ['storeRevision'], 'memory is kept in the graph store and nowhere on the record');
    assert.ok(!JSON.stringify(stored).includes('::mem::'));
  });

  it('does not wait for the memory store', async () => {
    const project = file('Unwaited plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const instance = await boot();
    instance.data.projects = [project];

    const reached = deferred();
    const gate = deferred();
    const write = memory.write.bind(memory);
    const writing = mock.method(memory, 'write', async (batch: MemBatch) => {
      reached.resolve();
      await gate.promise;
      return write(batch);
    });
    let saved = false;
    const saving = instance.save().then(() => {
      saved = true;
    });
    try {
      await reached.promise;
      for (let i = 0; i < 50 && !saved; i += 1) await turn();
      assert.equal(saved, true, 'the save is over though the memory store has not answered');
      assert.deepEqual(await entriesOf(project), []);
    } finally {
      gate.resolve();
      await saving;
      await instance.graphCaughtUp();
      writing.mock.restore();
    }
    assert.equal((await entriesOf(project)).length, 1, 'and what it was told is there once it has');
  });

  it('does not fail when the memory store is down, says so once, and tells it all at the next save', async () => {
    const project = file('Retold plot');
    const first = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const other = file('Second retold plot');
    raise(other, 'Access is unclear', '2026-10-05T09:00:00.000Z');
    const instance = await boot();
    instance.data.projects = [project, other];

    const warned = mock.method(console, 'warn', () => {});
    let down = true;
    const read = memory.watermarks.bind(memory);
    const asked = mock.method(memory, 'watermarks', async (ids: string[]) => {
      if (down) throw new Error('no route to the memory store');
      return read(ids);
    });
    const looked = mock.method(memory, 'projects');
    try {
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(asked.mock.callCount(), 1);
      assert.equal(said(warned, /^\[memory\]/).length, 1, 'a store that is down says so once a pass');
      assert.equal(looked.mock.callCount(), 0, 'and is asked for nothing else');
      assert.deepEqual(await entriesOf(project), []);

      // A read does not ask a store that failed every call. A save does.
      await instance.syncProject(project.id, { force: true });
      await instance.graphCaughtUp();
      assert.equal(asked.mock.callCount(), 1);

      down = false;
      const second = raise(held(instance, project), 'Boundary is open', '2026-10-05T10:00:00.000Z');
      await instance.save();
      await instance.graphCaughtUp();
      assert.deepEqual((await findingsTold(project)).sort(), [first.id, second.id].sort(), 'what was owed is told with what came after');
      assert.equal((await findingsTold(other)).length, 1, 'and so is the project this save did not write');
      assert.equal(said(warned, /^\[memory\]/).length, 1);
    } finally {
      asked.mock.restore();
      looked.mock.restore();
      warned.mock.restore();
    }
  });
});

describe('a save that finds memory still being told', () => {
  it('is told by the same pass going round again, the later copy of one project and another project alike', async () => {
    const project = file('Overlapped plot');
    const first = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const other = file('Other overlapped plot');
    const instance = await boot();
    instance.data.projects = [project];

    const reached = deferred();
    const gate = deferred();
    const write = memory.write.bind(memory);
    const writing = mock.method(memory, 'write', async (batch: MemBatch) => {
      reached.resolve();
      await gate.promise;
      return write(batch);
    });
    try {
      await instance.save();
      await reached.promise;
      // The first copy is with the memory store. The project is written again, and another with it.
      const second = raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
      const elsewhere = raise(other, 'Access is unclear', '2026-10-05T10:00:00.000Z');
      instance.data.projects = [project, other];
      await instance.save();
      gate.resolve();
      await instance.graphCaughtUp();
      assert.deepEqual((await findingsTold(project)).sort(), [first.id, second.id].sort(), 'the copy written while the earlier one was being told');
      assert.deepEqual(await findingsTold(other), [elsewhere.id], 'and the project the pass had not been given');
    } finally {
      gate.resolve();
      writing.mock.restore();
    }
  });
});

describe('a memory that was left behind', () => {
  it('is caught up by the next instance that reads the project', async () => {
    const project = file('Left behind plot');
    const finding = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const other = file('Second left behind plot');
    raise(other, 'Access is unclear', '2026-10-05T09:00:00.000Z');
    const writer = await boot();
    writer.data.projects = [project, other];
    const warned = mock.method(console, 'warn', () => {});
    const failing = mock.method(memory, 'write', async () => {
      throw new Error('no route to the memory store');
    });
    try {
      await writer.save();
      await writer.graphCaughtUp();
      assert.equal(failing.mock.callCount(), 2, 'one project failing does not stop the next being tried');
      assert.equal(said(warned, /^\[memory\]/).length, 1, 'the failures of a pass are logged once, and the save was not failed by them');
      assert.match(said(warned, /^\[memory\]/)[0]!, /could not write the memory of/);
    } finally {
      failing.mock.restore();
      warned.mock.restore();
    }
    assert.deepEqual(await entriesOf(project), []);
    assert.equal(await standsAt(project), undefined, 'the watermark has not moved without the entries');

    const reader = await boot();
    await reader.syncProject(project.id);
    await reader.graphCaughtUp();
    assert.deepEqual(await findingsTold(project), [finding.id]);
    assert.equal((await findingsTold(other)).length, 1, 'with every other copy the instance has read');
  });

  it('is asked about once for a copy an instance has read, and written to only when there is something to tell', async () => {
    const project = file('Level plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [reader] = await instances([project]);
    const before_ = await entriesOf(project);

    const asked = mock.method(memory, 'watermarks');
    const written = mock.method(memory, 'write');
    try {
      await reader!.syncProject(project.id);
      await reader!.graphCaughtUp();
      assert.equal(asked.mock.callCount(), 1, 'where memory stands is read once');
      await reader!.syncProject(project.id, { force: true });
      await reader!.graphCaughtUp();
      assert.equal(asked.mock.callCount(), 1, 'and the same copy read again asks nothing');
      assert.equal(written.mock.callCount(), 0, 'nothing was written: memory already held it');
    } finally {
      asked.mock.restore();
      written.mock.restore();
    }
    assert.deepEqual(await entriesOf(project), before_);
  });

  it('holds no read of a project, though the memory store has answered nothing', async () => {
    const project = file('Unheld read plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [reader] = await instances([project]);
    const gate = deferred();
    const answer = memory.watermarks.bind(memory);
    const asked = mock.method(memory, 'watermarks', async (ids: string[]) => {
      await gate.promise;
      return answer(ids);
    });
    try {
      await reader!.syncProject(project.id);
      for (let i = 0; i < 20 && asked.mock.callCount() === 0; i += 1) await turn();
      assert.equal(asked.mock.callCount(), 1, 'the read came back with the memory store still asked');
    } finally {
      gate.resolve();
      await reader!.graphCaughtUp();
      asked.mock.restore();
    }
  });

  it('is not told a copy with a change not yet written', async () => {
    const project = file('Unwritten plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project]);
    const mine = held(instance!, project);
    const unsaved = raise(mine, 'Not saved yet', '2026-10-05T10:00:00.000Z');

    await instance!.syncProject(project.id, { force: true });
    await instance!.graphCaughtUp();
    assert.ok(!(await findingsTold(project)).includes(unsaved.id), 'memory is told what the project store holds, and it does not hold this');

    await instance!.save();
    await instance!.graphCaughtUp();
    assert.ok((await findingsTold(project)).includes(unsaved.id), 'the save that writes it tells it');
  });
});

describe('a memory that was removed while its project is still there', () => {
  it('is told again whole by the next save, from the record', async () => {
    const project = file('Removed memory plot');
    const first = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project]);
    await instance!.syncProject(project.id);
    await instance!.graphCaughtUp();
    assert.equal((await entriesOf(project)).length, 1);

    // Something that took the project for gone removed its memory. The instance still believes it stands where it stood.
    await memory.purge(project.id);
    const second = raise(held(instance!, project), 'Boundary is open', '2026-10-05T10:00:00.000Z');
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual((await findingsTold(project)).sort(), [first.id, second.id].sort());
    assert.equal((await standsAt(project))?.auditThrough, held(instance!, project).audit.at(-1)!.id);
  });
});

describe('an entry told twice', () => {
  it('is one entry, and is the entry as it was first told', async () => {
    const project = file('Twice told plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    addEvidence(project, { title: 'Sale deed', kind: 'document' }, LEAD);
    project.updatedAt = '2026-10-05T09:30:00.000Z';
    await pass([project]);
    const first = await entriesOf(project);
    const stands = (await standsAt(project))!;
    assert.equal(first.length, 2);

    // The whole record again, by a writer that knows where memory stands.
    const whole = memoryDelta(project, {});
    assert.deepEqual(await writeMemory(memory, TENANT, stands, whole), { written: 2 });
    assert.deepEqual(await entriesOf(project), first);

    // And an entry under an id memory holds, saying something else: an entry is an event, and does not change.
    const changed = { ...whole, entries: whole.entries.map((entry) => ({ ...entry, kind: 'paper_read' as const, label: 'Rewritten' })) };
    await writeMemory(memory, TENANT, stands, changed);
    assert.deepEqual(await entriesOf(project), first);
  });

  it('is scrubbed by the one function that writes, whoever made it', async () => {
    const projectId = 'prj_scrubbed_on_write';
    const answer = await writeMemory(memory, TENANT, {}, {
      projectId,
      through: { auditThrough: 'aud_1' },
      entries: [
        {
          id: `${projectId}::mem::aud_1`,
          kind: 'value_accepted',
          at: '2026-10-05T09:00:00.000Z',
          by: 'valuer@example.com',
          sourceId: 'aud_1',
          about: ['ev_1', 'seller@example.com'],
          key: 'extent_khata',
          label: 'Account 50100123456789',
          text: 'what somebody typed',
        } as MemEntry,
        { id: 'prj_another::mem::aud_2', kind: 'value_accepted', at: '2026-10-05T09:00:00.000Z', by: 'who_00000000000000', sourceId: 'aud_2', about: [] },
      ],
    });
    assert.deepEqual(answer, { written: 1 }, 'an entry of another project is left out');
    const [kept] = await entriesOf(projectId);
    assert.deepEqual(Object.keys(kept!).sort(), ['about', 'at', 'by', 'id', 'key', 'kind', 'label', 'sourceId']);
    assert.match(kept!.by, /^who_[0-9a-f]{14}$/);
    assert.deepEqual(kept!.about, ['ev_1']);
    assert.equal(kept!.label, STANDARD_FACT_KEYS.extent_khata!.label, 'the label is the fixed list’s name for the key, whatever the caller wrote');
    assert.equal((await standsAt(projectId))?.schema, MEM_SCHEMA, 'and it is written in this build’s shape whatever the caller said');

    // The store holds to the same rule when it is written to directly.
    const direct = await memory.write({
      projectId: 'prj_another',
      tenantId: TENANT,
      from: {},
      through: { schema: MEM_SCHEMA, auditThrough: 'aud_2' },
      entries: [{ ...kept!, about: ['taken'] }],
      mayRaise: true,
    });
    assert.deepEqual(direct, { written: 0 });
    assert.deepEqual(await entriesOf('prj_another'), []);
    assert.deepEqual(await entriesOf(projectId), [kept]);
    await memory.purge(projectId);
    await memory.purge('prj_another');
  });
});

describe('a write and where memory stands', () => {
  it('goes through only if memory stands where the writer believed, and is told where it stands if not', async () => {
    const project = file('Stood plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    await pass([project]);
    const stood = (await standsAt(project))!;
    const before_ = await entriesOf(project);

    raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
    const next = memoryDelta(project, stood);
    assert.equal(next.entries.length, 1);
    assert.deepEqual(await writeMemory(memory, TENANT, {}, next), { moved: stood }, 'a writer that believes nothing has been told');
    assert.deepEqual(await writeMemory(memory, TENANT, { ...stood, auditThrough: 'aud_elsewhere' }, next), { moved: stood });
    assert.deepEqual(await entriesOf(project), before_, 'neither wrote an entry');
    assert.deepEqual(await standsAt(project), stood, 'or moved the watermark');

    assert.deepEqual(await writeMemory(memory, TENANT, stood, next), { written: 1 });
    assert.deepEqual(await standsAt(project), next.through);
  });

  it('is asked again as the store says it stands, by an instance that believed otherwise', async () => {
    const project = file('Believed plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const known = new Map<string, MemWatermark>();
    await pass([project], { known });
    const believed = { ...known.get(project.id)! };

    // Another instance tells memory more, and this one does not hear of it.
    const second = raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
    await pass([project]);
    const third = raise(project, 'Access is unclear', '2026-10-05T11:00:00.000Z');

    const written = mock.method(memory, 'write');
    try {
      const passed = await pass([project], { known: new Map([[project.id, believed]]) });
      assert.equal(written.mock.callCount(), 2, 'turned away once, then taken');
      assert.deepEqual(passed.settled, [{ projectId: project.id, builtAt: project.updatedAt }]);
    } finally {
      written.mock.restore();
    }
    assert.ok((await findingsTold(project)).includes(second.id));
    assert.ok((await findingsTold(project)).includes(third.id));
    assert.equal((await standsAt(project))?.auditThrough, project.audit.at(-1)!.id);
  });
});

describe('a copy older than the one memory was told from', () => {
  it('tells nothing and moves nothing', async () => {
    const project = file('Older copy plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const older = structuredClone(project);
    raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
    await pass([project]);
    const before_ = await entriesOf(project);
    const stood = await standsAt(project);

    const written = mock.method(memory, 'write');
    try {
      // The project store holds the newer copy, which is what makes this one old.
      const passed = await pass([older], { stillStored: false });
      assert.equal(written.mock.callCount(), 0);
      assert.deepEqual(passed.settled, [{ projectId: project.id, builtAt: older.updatedAt }], 'it has nothing to tell, and is not asked about again');
    } finally {
      written.mock.restore();
    }
    assert.deepEqual(await entriesOf(project), before_);
    assert.deepEqual(await standsAt(project), stood);
  });
});

describe('a record that has lost what memory was told from', () => {
  it('is told whole, and memory keeps what both writers told', async () => {
    const project = file('Twice written plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [a, b] = await instances([project], 2);
    // Both have read the project and been answered where its memory stands.
    for (const instance of [a!, b!]) {
      await instance.syncProject(project.id);
      await instance.graphCaughtUp();
    }

    const fromA = raise(held(a!, project), 'From the first writer', '2026-10-05T10:00:00.000Z');
    await a!.save();
    await a!.graphCaughtUp();
    const afterA = await standsAt(project);

    // The second writes over the first without having read it: the last writer's copy is the record.
    const fromB = raise(held(b!, project), 'From the second writer', '2026-10-05T11:00:00.000Z');
    await b!.save();
    await b!.graphCaughtUp();

    const record = held(b!, project);
    assert.ok(!record.findings.some((finding) => finding.id === fromA.id), 'the record lost the first writer’s finding');
    const told = await findingsTold(project);
    assert.ok(told.includes(fromB.id), 'memory holds what the record holds now');
    assert.ok(told.includes(fromA.id), 'and still holds the event it was told before: it happened');
    assert.notDeepEqual(await standsAt(project), afterA);
    assert.equal((await standsAt(project))?.auditThrough, record.audit.at(-1)!.id, 'and stands where the record ends');

    // From there the record is told event by event again.
    const next = raise(record, 'After both', '2026-10-05T12:00:00.000Z');
    const written = mock.method(memory, 'write');
    try {
      await b!.save();
      await b!.graphCaughtUp();
      assert.equal(written.mock.callCount(), 1);
      assert.deepEqual((written.mock.calls[0]!.arguments[0] as MemBatch).entries.map((entry) => entry.about), [[next.id]]);
    } finally {
      written.mock.restore();
    }
  });
});

describe('a memory written in a later shape', () => {
  it('is left alone by this build', async () => {
    const project = file('Later shape plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const later = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_from_a_later_build' };
    assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: later, entries: [], mayRaise: true }), { written: 0 });

    const instance = await boot();
    instance.data.projects = [project];
    const written = mock.method(memory, 'write');
    try {
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(written.mock.callCount(), 0, 'it stands down before it writes');
    } finally {
      written.mock.restore();
    }
    assert.deepEqual(await standsAt(project), later);
    assert.deepEqual(await entriesOf(project), []);

    // And a write that reaches the store all the same is refused by it.
    assert.deepEqual(await writeMemory(memory, TENANT, {}, memoryDelta(project, {})), { newer: MEM_SCHEMA + 1 });
    assert.deepEqual(await standsAt(project), later);
    assert.deepEqual(await entriesOf(project), []);
  });
});

describe('a deployment that may not raise the shape of a project’s memory', () => {
  const batch = (projectId: string, schema: number, mayRaise: boolean): MemBatch => ({
    projectId,
    tenantId: TENANT,
    from: {},
    through: { schema, auditThrough: 'aud_1' },
    entries: [{ id: `${projectId}::mem::aud_1`, kind: 'finding_raised', at: '2026-10-05T09:00:00.000Z', by: 'who_00000000000000', sourceId: 'aud_1', about: ['fnd_1'] }],
    mayRaise,
  });

  it('is the rule both stores keep: never lower over higher, and a later shape only where it is held or the live site writes it', () => {
    const first = MEM_SCHEMA_FIRST;
    assert.deepEqual(shapeRefused(first + 1, first, true), { newer: first + 1 }, 'an older build stands down, wherever it runs');
    assert.deepEqual(shapeRefused(first + 1, first, false), { newer: first + 1 });
    assert.deepEqual(shapeRefused(first, first + 1, false), { lower: first }, 'a preview does not raise what the live site wrote');
    assert.deepEqual(shapeRefused(0, first + 1, false), { lower: 0 }, 'nor write a later shape where nothing is written yet');
    assert.equal(shapeRefused(0, first, false), undefined, 'the first shape shuts no build out, so a preview may write it first');
    assert.equal(shapeRefused(first + 1, first + 1, false), undefined, 'and it writes a shape the live site has already raised memory to');
    assert.equal(shapeRefused(first, first + 1, true), undefined, 'the live site raises');
    assert.equal(shapeRefused(0, first + 1, true), undefined);
  });

  it('writes nothing over memory in an earlier shape, and is told which it holds', async () => {
    const live = 'prj_live_wrote_first';
    assert.deepEqual(await memory.write(batch(live, MEM_SCHEMA, true)), { written: 1 });
    const stood = await standsAt(live);

    assert.deepEqual(await memory.write(batch(live, MEM_SCHEMA + 1, false)), { lower: MEM_SCHEMA });
    assert.deepEqual(await standsAt(live), stood, 'the watermark and the shape are as the live site left them');
    assert.equal((await entriesOf(live)).length, 1);

    const never = 'prj_nothing_written_yet';
    assert.deepEqual(await memory.write(batch(never, MEM_SCHEMA + 1, false)), { lower: 0 });
    assert.deepEqual(await entriesOf(never), [], 'and it does not write a later shape first');

    // The live site may, and from then on a preview with that shape writes it too.
    assert.deepEqual(await memory.write(batch(live, MEM_SCHEMA + 1, true)), { written: 1 });
    assert.deepEqual(await memory.write({ ...batch(live, MEM_SCHEMA + 1, false), from: { auditThrough: 'aud_1' } }), { written: 1 });
    for (const id of [live, never]) await memory.purge(id);
  });

  it('settles the copy and says so once, however many projects and passes there are', async () => {
    const projects = [file('First held back plot'), file('Second held back plot')];
    for (const project of projects) raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const warned = mock.method(console, 'warn', () => {});
    // A store whose every project the live site has left in an earlier shape.
    const held: MemoryPort = { ...memory, write: async () => ({ lower: MEM_SCHEMA - 1 }) };
    try {
      const work = () => ({ owed: projects.map((project) => ({ project, tenantId: TENANT })), gone: [], known: new Map<string, MemWatermark>(), stillStored: async () => true });
      const first = await syncMemory(work(), held);
      assert.equal(first.settled.length, 2, 'there is nothing for this deployment to tell, so the copies are not owed');
      assert.equal(first.failed, 0, 'and it is not a failure of the store');
      await syncMemory(work(), held);
      assert.equal(said(warned, /^\[memory\].*only the live site may raise it/).length, 1);
    } finally {
      warned.mock.restore();
    }
  });
});

describe('a question asked in chat', () => {
  it('is told with who asked and on which page, though the project was saved before the request named them', async () => {
    const project = file('Asked plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance, other] = await instances([project], 2);
    const mine = held(instance!, project);

    // The turns are written, and the project is saved while the answer is waited for: the model call's own bookkeeping saves it.
    const turns = applyProjectChat(mine, 'what is missing?');
    mine.updatedAt = '2026-10-05T10:00:00.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    const chats = async (): Promise<MemEntry[]> => (await entriesOf(project)).filter((entry) => MEM_CHAT_KINDS.includes(entry.kind));
    assert.deepEqual(await chats(), [], 'a turn with no author yet is not told');

    // Any other instance telling from the document it reads waits the same way.
    await other!.syncProject(project.id, { force: true });
    await other!.graphCaughtUp();
    assert.deepEqual(await chats(), []);

    // The request ends. It names who asked and where, and the project's clock moves, so the save writes it.
    for (const turn of [turns.userTurn, turns.assistantTurn]) {
      turn.actor = LEAD;
      turn.place = { pane: 'evidence' };
    }
    mine.updatedAt = '2026-10-05T10:00:05.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(
      (await chats()).map((entry) => [entry.kind, entry.by, entry.place]).sort(),
      [
        ['chat_answered', memWho(project.id, LEAD), { pane: 'evidence' }],
        ['chat_asked', memWho(project.id, LEAD), { pane: 'evidence' }],
      ],
    );
  });

  it('is told as nobody’s when the request that asked is long over and named nobody', async () => {
    const project = file('Unnamed plot');
    const turns = applyProjectChat(project, 'what is missing?');
    // Asked days ago, as a turn kept from before chats kept their author is.
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.at = '2026-10-01T09:00:00.000Z';
    project.updatedAt = '2026-10-01T09:00:00.000Z';
    await pass([project]);
    const told = (await entriesOf(project)).filter((entry) => MEM_CHAT_KINDS.includes(entry.kind));
    assert.deepEqual(told.map((entry) => entry.by), [memWho(project.id, 'nobody'), memWho(project.id, 'nobody')], 'told, and not as the server’s or as anybody’s');
  });

  it('is let go of when every chat is deleted, with every other entry kept', async () => {
    const project = file('Chats deleted plot');
    const finding = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project]);
    const mine = held(instance!, project);
    const ask = (at: string): void => {
      const turns = applyProjectChat(mine, 'what is missing?');
      for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
      mine.updatedAt = at;
    };
    ask('2026-10-05T10:00:00.000Z');
    ask('2026-10-05T10:05:00.000Z');
    await instance!.save();
    await instance!.graphCaughtUp();
    const kinds = async (): Promise<string[]> => (await entriesOf(project)).map((entry) => entry.kind).sort();
    assert.deepEqual(await kinds(), ['chat_answered', 'chat_answered', 'chat_asked', 'chat_asked', 'finding_raised']);

    clearProjectConversation(mine);
    mine.updatedAt = '2026-10-05T11:00:00.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(await kinds(), ['finding_raised'], 'the entries of the chat turns went with the chats');
    assert.deepEqual(await findingsTold(project), [finding.id]);
    assert.equal((await standsAt(project))?.turnThrough, undefined);

    // A question asked afterwards is told as any other.
    ask('2026-10-05T11:05:00.000Z');
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(await kinds(), ['chat_answered', 'chat_asked', 'finding_raised']);
  });
});

describe('the chats of a project that has been told nothing else', () => {
  it('take their entries with them all the same, though the record then has nothing to tell', async () => {
    const project = file('Only chats plot');
    const turns = applyProjectChat(project, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    project.updatedAt = '2026-10-05T09:00:00.000Z';
    const [instance] = await instances([project]);
    assert.deepEqual((await entriesOf(project)).map((entry) => entry.kind).sort(), ['chat_answered', 'chat_asked']);

    const mine = held(instance!, project);
    clearProjectConversation(mine);
    mine.updatedAt = '2026-10-05T10:00:00.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(await entriesOf(project), []);
    assert.equal((await standsAt(project))?.turnThrough, undefined, 'and memory stands at no turn');
  });
});

describe('a memory store with no room for another node', () => {
  const FULL = 'You have exceeded the logical size limit of 200000 nodes in your database (attempt to add 1 nodes would reach 200001 nodes). Please consider upgrading to the next tier.';

  it('is left alone, said once, while the graph is drawn and the save goes through', async () => {
    const projects = [file('No room plot'), file('Second no room plot')];
    for (const project of projects) raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const instance = await boot();
    instance.data.projects = projects;

    const warned = mock.method(console, 'warn', () => {});
    const write = memory.write.bind(memory);
    let full = true;
    const writing = mock.method(memory, 'write', async (batch: MemBatch): Promise<MemWriteAnswer> => (full ? { full: FULL } : write(batch)));
    try {
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(writing.mock.callCount(), 1, 'the second project is not tried: it would be turned away the same way');
      assert.equal(said(warned, /^\[memory\] the graph database has no room/).length, 1);
      assert.ok(said(warned, /no room/)[0]!.includes('200000 nodes'), 'in the database’s own words');
      for (const project of projects) assert.ok(await graph.readProject(project.id), 'the graph of the project was drawn all the same');
      assert.deepEqual(await entriesOf(projects[0]!), []);

      // A read does not ask a store that has no room. A save does, and says nothing more.
      await instance.syncProject(projects[0]!.id, { force: true });
      await instance.graphCaughtUp();
      assert.equal(writing.mock.callCount(), 1);
      raise(held(instance, projects[0]!), 'Boundary is open', '2026-10-05T10:00:00.000Z');
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(writing.mock.callCount(), 2);
      assert.equal(said(warned, /^\[memory\]/).length, 1, 'once, until a write is taken again');

      // Room is made. The next save tells everything that was owed.
      full = false;
      raise(held(instance, projects[0]!), 'Access is unclear', '2026-10-05T11:00:00.000Z');
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal((await findingsTold(projects[0]!)).length, 3);
      assert.equal((await findingsTold(projects[1]!)).length, 1);

      // And if it fills again, that is said again.
      full = true;
      raise(held(instance, projects[0]!), 'A fourth', '2026-10-05T12:00:00.000Z');
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(said(warned, /^\[memory\] the graph database has no room/).length, 2);
    } finally {
      writing.mock.restore();
      warned.mock.restore();
    }
  });

  it('can be watched: a project’s memory is counted, and everything the store holds', async () => {
    const project = file('Counted plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    raise(project, 'Boundary is open', '2026-10-05T09:30:00.000Z');
    const before_ = await memory.count(project.id);
    assert.equal(before_.project, 0);
    await pass([project]);
    const counted = await memory.count(project.id);
    assert.equal(counted.project, 3, 'two entries, and the node that says where memory stands');
    assert.equal(counted.database, before_.database + 3);
  });
});

describe('a long record', () => {
  /** A project whose audit trail holds more findings than one write tells. */
  function long(name: string, count: number): DdProject {
    const project = file(name);
    for (let i = 0; i < count; i += 1) {
      project.audit.push({ id: `aud_long_${i}`, at: '2026-10-05T09:00:00.000Z', actor: LEAD, action: 'create', entityType: 'finding', entityId: `fnd_long_${i}` });
    }
    project.updatedAt = '2026-10-05T09:00:00.000Z';
    return project;
  }

  it('is told a write at a time, each moving the watermark with its entries', async () => {
    const count = MEM_AT_MOST * 2 + 7;
    const project = long('Long plot', count);
    const stood: Array<string | undefined> = [];
    const write = memory.write.bind(memory);
    const writing = mock.method(memory, 'write', async (batch: MemBatch): Promise<MemWriteAnswer> => {
      assert.ok(batch.entries.length <= MEM_AT_MOST, 'no write is longer than the most one write tells');
      const answer = await write(batch);
      stood.push((await standsAt(project))?.auditThrough);
      return answer;
    });
    try {
      const passed = await pass([project]);
      assert.equal(writing.mock.callCount(), 3);
      assert.equal(passed.settled.length, 1);
    } finally {
      writing.mock.restore();
    }
    assert.equal((await entriesOf(project)).length, count);
    assert.equal(new Set(stood).size, 3, 'the watermark moved with every write');
    assert.equal(stood.at(-1), project.audit.at(-1)!.id);
  });

  it('is left owed when the pass runs out of time, and goes on from where it stood', async () => {
    assert.equal(MEMORY_WAIT_MS, 2_000);
    const count = MEM_AT_MOST * 2 + 7;
    const project = long('Slow long plot', count);
    const known = new Map<string, MemWatermark>();
    const write = memory.write.bind(memory);
    mock.timers.enable({ apis: ['setTimeout'] });
    const writing = mock.method(memory, 'write', async (batch: MemBatch): Promise<MemWriteAnswer> => {
      const answer = await write(batch);
      // The store took as long as a pass goes on for.
      mock.timers.tick(MEMORY_WAIT_MS);
      return answer;
    });
    try {
      const passed = await pass([project], { known });
      assert.equal(writing.mock.callCount(), 1, 'nothing more is started once the time is up');
      assert.deepEqual(passed.settled, [], 'and the copy stays owed');
      assert.equal((await entriesOf(project)).length, memoryDelta(project, {}).entries.length, 'with the first write’s entries in memory');
      assert.equal((await standsAt(project))?.auditThrough, project.audit[MEM_AT_MOST - 1]!.id, 'and the watermark where that write ended');
    } finally {
      mock.timers.reset();
      writing.mock.restore();
    }
    const passed = await pass([project], { known });
    assert.equal(passed.settled.length, 1);
    assert.equal((await entriesOf(project)).length, count);
  });
});

describe('a project that is gone', () => {
  it('takes its memory with it at once, removed in the order the delete route removes it, and no other project’s', async () => {
    const going = file('Going plot');
    raise(going, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const staying = file('Staying plot');
    raise(staying, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([going, staying]);
    assert.ok(await hasMemory(going));

    await remove(instance!, held(instance!, going));
    await instance!.graphCaughtUp();
    assert.equal(await hasMemory(going), false);
    assert.deepEqual(await entriesOf(going), []);
    assert.equal((await entriesOf(staying)).length, 1);
  });

  it('keeps its memory while its document is still in storage, though it has left an instance’s list', async () => {
    const project = file('Unlisted plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project]);
    // Out of the list, and nothing removed it: its document is where it was.
    instance!.data.projects = [];
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.equal((await entriesOf(project)).length, 1);
  });

  it('is looked for once a minute and no more often, however many passes there are', async () => {
    const project = file('Looked for plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const instance = await boot();
    instance.data.projects = [project];
    const looked = mock.method(memory, 'projects');
    try {
      await instance.save();
      await instance.graphCaughtUp();
      assert.equal(looked.mock.callCount(), 1, 'the pass that was first answered looks');
      const start = Date.now();

      raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
      await instance.save();
      await instance.syncProject(project.id, { force: true });
      await instance.graphCaughtUp();
      assert.equal((await findingsTold(project)).length, 2, 'a pass ran');
      assert.equal(looked.mock.callCount(), 1, 'and did not look again inside the minute');

      mock.timers.enable({ apis: ['Date'], now: start + MEMORY_SWEEP_MS + 1 });
      await instance.syncIndex();
      await instance.graphCaughtUp();
      assert.equal(looked.mock.callCount(), 2, 'a read looks once the minute is up, though nothing is owed');
    } finally {
      mock.timers.reset();
      looked.mock.restore();
    }
  });

  it('loses the memory a build that knows nothing of memory left behind, once it has been seen gone twice', async () => {
    const workspace = 'tnt_removed_elsewhere';
    const project = file('Removed elsewhere plot', workspace);
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const kept = file('Kept plot', workspace);
    raise(kept, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project, kept], 1, workspace);
    // The instance has read both and been answered, and its first look has found nothing gone.
    await instance!.syncIndex();
    await instance!.graphCaughtUp();

    // Removed the way an older build removes a project: the document, the index entry, the graph. Not the memory.
    await storage.deleteCaseDocuments(project.id);
    await rewriteIndex((ids) => ids.filter((id) => id !== project.id));

    const start = Date.now();
    mock.timers.enable({ apis: ['Date'], now: start + MEMORY_SWEEP_MS + 1 });
    try {
      await instance!.syncIndex();
      await instance!.graphCaughtUp();
      assert.equal(instance!.data.projects!.some((p) => p.id === project.id), false, 'the instance has seen the project go');
      assert.ok(await hasMemory(project), 'one look is not enough to remove what cannot be put back');

      mock.timers.setTime(start + 2 * (MEMORY_SWEEP_MS + 1));
      await instance!.syncIndex();
      await instance!.graphCaughtUp();
      assert.equal(await hasMemory(project), false, 'the second look removes it');
      assert.deepEqual(await entriesOf(project), []);
      assert.equal((await entriesOf(kept)).length, 1, 'and the project that is still there keeps its own');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('memory left behind while storage cannot say whether its project is gone', () => {
  it('is kept, however many times it is looked at', async () => {
    const workspace = 'tnt_storage_is_silent';
    const project = file('Looking plot', workspace);
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project], 1, workspace);
    const silent = 'prj_storage_is_silent';
    await memory.write({ projectId: silent, tenantId: workspace, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], mayRaise: true });
    const read = storage.getDocument.bind(storage);
    let askedOf = 0;
    const failing = mock.method(storage, 'getDocument', async (caseId: string, key: string) => {
      if (caseId === silent) {
        askedOf += 1;
        throw new Error('storage did not answer');
      }
      return read(caseId, key);
    });
    const looked = mock.method(memory, 'projects');
    const start = Date.now();
    mock.timers.enable({ apis: ['Date'], now: start });
    try {
      for (let look = 1; look <= 3; look += 1) {
        mock.timers.setTime(start + look * (MEMORY_SWEEP_MS + 1));
        await instance!.syncIndex();
        await instance!.graphCaughtUp();
      }
      assert.equal(looked.mock.callCount(), 3, 'it was looked at three times');
      assert.equal(askedOf, 3, 'and storage was asked about its project each time');
      assert.ok(await hasMemory(silent), 'no answer is not the answer that the project is gone');
    } finally {
      mock.timers.reset();
      failing.mock.restore();
      looked.mock.restore();
      await memory.purge(silent);
    }
  });
});

describe('looking for memory whose project is gone', () => {
  type Looks = Parameters<SyncModule['sweepMemory']>[0]['looks'];
  const looks = (): Looks => ({ seenGone: new Set(), from: 0 });
  const look = (carried: Looks, gone: (projectId: string) => boolean, tenantId = TENANT, heldIds: string[] = []) =>
    sweepMemory({ tenantIds: new Set([tenantId]), held: new Set(heldIds), gone: async (projectId) => gone(projectId), looks: carried }, memory);

  async function remembered(projectId: string, tenantId: string): Promise<void> {
    await memory.write({ projectId, tenantId, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], mayRaise: true });
  }

  it('removes it on the second look and not the first, and not if it was there in between', async () => {
    const workspace = 'tnt_swept';
    await remembered('prj_swept', workspace);
    const carried = looks();
    assert.deepEqual(await look(carried, (id) => id === 'prj_swept', workspace), []);
    assert.ok(await hasMemory('prj_swept'));
    // Back in storage at the next look: what was seen before is forgotten.
    assert.deepEqual(await look(carried, () => false, workspace), []);
    assert.deepEqual(await look(carried, (id) => id === 'prj_swept', workspace), []);
    assert.ok(await hasMemory('prj_swept'));
    assert.deepEqual(await look(carried, (id) => id === 'prj_swept', workspace), ['prj_swept']);
    assert.equal(await hasMemory('prj_swept'), false);
  });

  it('leaves the memory of a workspace this project store does not hold, and of a project this instance holds', async () => {
    const workspace = 'tnt_sparing';
    await remembered('prj_of_another_store', 'tnt_another_store');
    await remembered('prj_with_no_workspace', '');
    await remembered('prj_held_here', workspace);
    const carried = looks();
    const theirs = ['prj_of_another_store', 'prj_with_no_workspace', 'prj_held_here'];
    for (let i = 0; i < 3; i += 1) assert.deepEqual(await look(carried, (id) => theirs.includes(id), workspace, ['prj_held_here']), []);
    for (const id of theirs) {
      assert.ok(await hasMemory(id), `${id} keeps its memory`);
      await memory.purge(id);
    }
  });

  it('goes round a list longer than one look asks about, so that none of it is passed over', async () => {
    const workspace = 'tnt_long_list';
    const there = Array.from({ length: SWEEP_AT_MOST + 3 }, (_, i) => `prj_there_${String(i).padStart(2, '0')}`);
    for (const id of [...there, 'prj_zz_gone']) await remembered(id, workspace);
    const carried = looks();
    const asked: string[][] = [];
    const purged: string[] = [];
    for (let i = 0; i < 6 && !purged.length; i += 1) {
      const now: string[] = [];
      purged.push(
        ...(await look(carried, (id) => {
          now.push(id);
          return id === 'prj_zz_gone';
        }, workspace)),
      );
      asked.push(now);
    }
    assert.ok(asked.every((now) => now.length <= SWEEP_AT_MOST), 'a look asks storage about so many and no more');
    assert.ok(!asked[0]!.includes('prj_zz_gone'), 'the first look did not reach it');
    assert.deepEqual(purged, ['prj_zz_gone'], 'and a later one did, twice');
    for (const id of there) {
      assert.ok(await hasMemory(id));
      await memory.purge(id);
    }
  });
});

describe('reading memory back', () => {
  it('is newest first, with each entry’s ids resolved to the titles the record has now', async () => {
    const project = file('Read back plot');
    const surveyor = 'surveyor@example.com';
    project.team = [{ email: surveyor, name: 'The surveyor', departments: {}, addedAt: '2026-10-05T08:00:00.000Z', addedBy: LEAD }];
    const paper = addEvidence(project, { title: 'Sale deed', kind: 'document' }, LEAD);
    project.audit.at(-1)!.at = '2026-10-05T09:00:00.000Z';
    const finding = raise(project, 'Extent differs', '2026-10-05T10:00:00.000Z');
    project.audit.at(-1)!.at = '2026-10-05T10:00:00.000Z';
    // An answer that cites the paper and a person, as the graph names a person: by their address.
    project.conversation.push({ id: 'cht_read_back', role: 'assistant', text: 'What the surveyor found.', at: '2026-10-05T11:00:00.000Z', actor: LEAD, citedEvidenceIds: [paper.id], citedNodeIds: [`${project.id}::member::${surveyor}`] });
    await pass([project]);

    paper.title = 'Sale deed, registered copy';
    project.findings = project.findings.filter((other) => other.id !== finding.id);
    const lines = await readMemory(project, 50, memory);
    assert.deepEqual(
      lines.map((line) => ({ kind: line.kind, by: line.by, about: line.about.map((pointer) => pointer.title ?? null) })),
      [
        { kind: 'chat_answered', by: LEAD, about: ['Sale deed, registered copy', 'The surveyor'] },
        { kind: 'finding_raised', by: LEAD, about: [null] },
        { kind: 'paper_filed', by: LEAD, about: ['Sale deed, registered copy'] },
      ],
      'the paper by the name it has now, the person by theirs, the removed finding by its id alone',
    );
    assert.deepEqual(lines[1]!.about, [{ id: finding.id }]);
    assert.equal((await readMemory(project, 1, memory)).length, 1);
    const kept = JSON.stringify(await entriesOf(project));
    for (const word of ['Sale deed', surveyor, 'The surveyor', 'What the surveyor found']) assert.ok(!kept.includes(word), `${word} was never in memory`);
  });
});
