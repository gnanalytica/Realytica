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
 * copy older than the one memory was told from tells nothing, and a record
 * that has lost what memory was told from is told whole. Which shape of
 * memory a deployment may write over: a later one is left alone, which is
 * said once in the log, an earlier one is started over, every entry let go
 * and the whole record told again,
 * by the live site always and by any other deployment only where the live
 * site has not written, and the live site starts over whatever it did not
 * write itself. A long record is told a write at a time. A question is told
 * once the request that asked has named who asked, though the project was
 * saved before that, and a work-pane note at once. Deleting the chats takes
 * the entries of their turns, and an instance that read the project before
 * they were deleted does not put them back. A store with no room is left
 * alone, quietly, and the graph is drawn all the same. A project that is
 * gone, document and all, takes its memory with it, whichever build removed
 * it and in the order the delete route removes it, and a project whose
 * document is still in storage keeps it. Reading memory back gives each
 * entry the titles the record has now.
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
  MEM_SCHEMA,
  MEM_TURN_KINDS,
  STANDARD_FACT_KEYS,
  addEvidence,
  addFinding,
  applyProjectChat,
  clearProjectConversation,
  createProject,
  memWho,
  memoryDelta,
  noteProjectEdit,
  type DdProject,
  type MemEntry,
  type MemFact,
  type MemWatermark,
} from '@realytica/shared';
import type { GraphAdapter } from '../apps/api/src/graph/types';
import type { MemBatch, MemoryPort, MemWriteAnswer, MemWriter, ShapeRuling } from '../apps/api/src/graph/mem/types';

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
let shapeRule: typeof import('../apps/api/src/graph/mem/types').shapeRule;
/** This deployment's graph store, which with nothing configured is the journal. */
let graph: GraphAdapter;

/** Every instance a test boots, so that what it tells in the background is over before the next test. */
const booted: Instance[] = [];

const LEAD = 'lead@example.com';
const TENANT = 'tnt_memory_tests';

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-mem-sync-'));
  process.env.REALYTICA_DATA_DIR = root;
  // Whatever the shell says, this machine is not the live site. A test that is, says so where it applies.
  delete process.env.VERCEL_ENV;
  const storeModule = await import('../apps/api/src/store');
  Store = storeModule.Store;
  dataDir = storeModule.DATA_DIR;
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  ({ syncMemory, sweepMemory, MEMORY_WAIT_MS, MEMORY_SWEEP_MS, SWEEP_AT_MOST } = await import('../apps/api/src/graph/mem/sync'));
  ({ writeMemory } = await import('../apps/api/src/graph/mem/write'));
  ({ readMemory } = await import('../apps/api/src/graph/mem/read'));
  ({ storageAdapter: storage } = await import('../apps/api/src/storage'));
  ({ shapeRule } = await import('../apps/api/src/graph/mem/types'));
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

/** Where a project's memory stands in the record, in which shape and whose it is. Which facts it holds is asked apart (`factsOf`). */
async function standsAt(project: DdProject | string): Promise<MemWatermark | undefined> {
  const id = typeof project === 'string' ? project : project.id;
  const held = (await memory.watermarks([id])).get(id);
  if (!held) return undefined;
  const { factsRev: _facts, ...where } = held;
  return where;
}

const factsOf = (project: DdProject | string): Promise<MemFact[]> => memory.factsOf(typeof project === 'string' ? project : project.id);

/** Everything memory says of where it stands, the digest of its facts included: what a writer hands back to write from there. */
async function heldAt(project: DdProject): Promise<MemWatermark> {
  return (await memory.watermarks([project.id])).get(project.id) ?? {};
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

/**
 * One pass over these copies, as an instance that has asked the memory store
 * nothing yet, on a deployment that is not the live site unless the test
 * says it is. `asked` counts how often the project store was asked whether
 * it still holds a copy.
 */
function pass(owed: DdProject[], opts: { known?: Map<string, MemWatermark>; stillStored?: boolean; gone?: string[]; live?: boolean; asked?: { times: number } } = {}) {
  const stillStored = async (): Promise<boolean> => {
    if (opts.asked) opts.asked.times += 1;
    return opts.stillStored ?? true;
  };
  return syncMemory({ owed: owed.map((project) => ({ project, tenantId: TENANT })), gone: opts.gone ?? [], known: opts.known ?? new Map(), stillStored }, memory, opts.live ?? false);
}

/** An entry as a store is handed one, about a made-up finding. */
function madeUp(projectId: string, sourceId: string, more: Partial<MemEntry> = {}): MemEntry {
  return { id: `${projectId}::mem::${sourceId}`, kind: 'finding_raised', at: '2026-10-05T09:00:00.000Z', by: 'who_00000000000000', sourceId, about: ['fnd_1'], ...more };
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
    assert.equal((writing.mock.calls[0]!.arguments[0] as MemBatch).live, false, 'a machine that is not the live site does not say it is');
    const entries = await entriesOf(project);
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.about]), [['finding_raised', [finding.id]]]);
    assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA, auditThrough: project.audit.at(-1)!.id }, 'in this build’s shape, and not marked the live site’s');
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
    const stands = await heldAt(project);
    assert.equal(first.length, 2);

    // The whole record again, by a writer that knows where memory stands and leaves its facts as they are.
    const told = memoryDelta(project, {});
    const whole = { ...told, through: { ...told.through, factsRev: stands.factsRev } };
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
      live: false,
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
    const stood = await heldAt(project);
    const before_ = await entriesOf(project);

    raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
    const told = memoryDelta(project, stood);
    const next = { ...told, through: { ...told.through, factsRev: stood.factsRev } };
    assert.equal(next.entries.length, 1);
    assert.deepEqual(await writeMemory(memory, TENANT, {}, next), { moved: stood }, 'a writer that believes nothing has been told');
    assert.deepEqual(await writeMemory(memory, TENANT, { ...stood, auditThrough: 'aud_elsewhere' }, next), { moved: stood });
    assert.deepEqual(await writeMemory(memory, TENANT, { ...stood, factsRev: 'facts_as_somebody_else_left_them' }, next), { moved: stood }, 'or that it holds other facts than it does');
    assert.deepEqual(await entriesOf(project), before_, 'none of them wrote an entry');
    assert.deepEqual(await heldAt(project), stood, 'or moved the watermark');

    assert.deepEqual(await writeMemory(memory, TENANT, stood, next), { written: 1 });
    assert.deepEqual(await heldAt(project), next.through);
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
    assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: later, entries: [], live: false }), { written: 0 });

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

  it('is left alone by an instance that believed memory stood in its own shape, once the store says otherwise', async () => {
    const project = file('Raised meanwhile plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const known = new Map<string, MemWatermark>();
    await pass([project], { known });
    // A later build raises this project's memory, and this instance does not hear of it.
    const later = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_from_a_later_build' };
    assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: later, entries: [], live: false }), { written: 0 });

    raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
    const written = mock.method(memory, 'write');
    try {
      const passed = await pass([project], { known });
      assert.equal(written.mock.callCount(), 1, 'it offered what came after, as it believed it could');
      assert.deepEqual([passed.settled.length, passed.failed], [1, 0], 'and was told to stand down, which settles the copy and is no failure');
    } finally {
      written.mock.restore();
    }
    assert.equal(known.has(project.id), false, 'what it believed is not kept');
    assert.deepEqual(await standsAt(project), later);
    assert.deepEqual(await entriesOf(project), [], 'and nothing was written');
  });

  it('is said once in the log, however many projects and passes, and on the live site it is said that it was put back', async () => {
    // A shape no other test here writes, so the line is this test's to hear first.
    const later = MEM_SCHEMA + 2;
    const leftBy = async (name: string, live: boolean): Promise<DdProject> => {
      const project = file(name);
      raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
      assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: { schema: later, auditThrough: 'aud_later' }, entries: [], live }), { written: 0 });
      return project;
    };
    // Two projects a preview of a later branch told first.
    const projects = [await leftBy('First later shape plot', false), await leftBy('Second later shape plot', false)];
    const warned = mock.method(console, 'warn', () => {});
    try {
      const first = await pass(projects);
      assert.deepEqual([first.settled.length, first.failed], [2, 0]);
      await pass(projects);
      const lines = said(warned, /^\[memory\]/);
      assert.equal(lines.length, 1, 'once, though it is true of two projects on two passes');
      assert.ok(lines[0]!.includes(`in an earlier shape (${MEM_SCHEMA}) than a project's memory holds (${later}), and stands down: nothing is written for such projects`), lines[0]);
      assert.doesNotMatch(lines[0]!, /live site/, 'a preview is not told it is the live site');

      // The live site, put back to an earlier build: the later build of it wrote this project's memory.
      const ours = await leftBy('Put back plot', true);
      const back = await pass([ours], { live: true });
      await pass([ours], { live: true });
      assert.deepEqual([back.settled.length, back.failed], [1, 0], 'it stands down as any earlier build does');
      const putBack = said(warned, /^\[memory\]/).slice(1);
      assert.equal(putBack.length, 1, 'and says so once, in words of its own');
      assert.match(putBack[0]!, /stands down: nothing is written for such projects\. This is the live site, so a later build of it wrote them: it has been put back to an earlier one$/);
    } finally {
      warned.mock.restore();
    }
    for (const project of projects) assert.deepEqual(await entriesOf(project), [], 'and nothing was written');
  });

  it('is asked about again the next time the project is told: standing down is not kept', async () => {
    const project = file('Stood down plot');
    const finding = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    // A preview of a later branch wrote this project's memory first.
    await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA + 1, auditThrough: 'aud_later' }, entries: [madeUp(project.id, 'aud_later')], live: false });
    const known = new Map<string, MemWatermark>();
    const asked = mock.method(memory, 'watermarks');
    const written = mock.method(memory, 'write');
    try {
      const stoodDown = await pass([project], { known });
      assert.deepEqual(stoodDown.settled, [{ projectId: project.id, builtAt: project.updatedAt }], 'the copy has nothing to tell');
      assert.deepEqual([stoodDown.made, stoodDown.failed], [1, 0], 'one read of where memory stands, and no write');
      assert.equal(written.mock.callCount(), 0);
      assert.equal(known.has(project.id), false, 'where memory stood is not kept from a pass that was turned away');

      // The live site, in this build's shape, tells the project: it does not stand down for a preview's writing.
      const told = await pass([project], { live: true });
      assert.equal(told.settled.length, 1);
      assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA, auditThrough: project.audit.at(-1)!.id, live: true });
      assert.deepEqual(await findingsTold(project), [finding.id], 'what the preview wrote is let go, and the record is told');

      // The deployment that stood down asks again, finds memory in its own shape, and carries on.
      const second = raise(project, 'Boundary is open', '2026-10-05T10:00:00.000Z');
      const reads = asked.mock.callCount();
      const carried = await pass([project], { known });
      assert.equal(asked.mock.callCount() - reads, 1, 'it read where memory stands again, having kept nothing');
      assert.equal(carried.settled.length, 1);
      assert.deepEqual((await findingsTold(project)).sort(), [finding.id, second.id].sort());
      assert.equal((await standsAt(project))?.live, true, 'and the live site’s mark stays under another deployment’s write');
      assert.equal(known.get(project.id)?.live, true, 'as this instance now knows');
    } finally {
      asked.mock.restore();
      written.mock.restore();
    }
  });
});

describe('which deployment may write what over a project’s memory', () => {
  const S = MEM_SCHEMA;
  const preview: MemWriter = { schema: S, live: false };
  const liveSite: MemWriter = { schema: S, live: true };

  it('is one rule, which both stores keep', () => {
    const rule = (held: MemWatermark, writer: MemWriter): ShapeRuling => shapeRule({ ...held, auditThrough: 'aud_1' }, writer);
    const table: Array<[string, MemWatermark, MemWriter, ShapeRuling]> = [
      ['a preview carries on memory in its own shape', { schema: S }, preview, 'carry-on'],
      ['and the live site’s too, in that shape', { schema: S, live: true }, preview, 'carry-on'],
      ['a preview raises what the live site has not written, by starting it over', { schema: S - 1 }, preview, 'start-over'],
      ['and does not raise what the live site wrote', { schema: S - 1, live: true }, preview, { lower: S - 1 }],
      ['a preview stands down to a later shape, another preview’s', { schema: S + 1 }, preview, { newer: S + 1 }],
      ['or the live site’s', { schema: S + 1, live: true }, preview, { newer: S + 1 }],
      ['the live site starts over what it did not write: in its own shape', { schema: S }, liveSite, 'start-over'],
      ['in an earlier one', { schema: S - 1 }, liveSite, 'start-over'],
      ['and in a later one, so that it never stands down for a preview’s writing', { schema: S + 1 }, liveSite, 'start-over'],
      ['the live site carries on its own memory', { schema: S, live: true }, liveSite, 'carry-on'],
      ['raises its own, by starting it over', { schema: S - 1, live: true }, liveSite, 'start-over'],
      ['and stands down to a later live build', { schema: S + 1, live: true }, liveSite, { newer: S + 1 }],
    ];
    for (const [what, held, writer, ruling] of table) assert.deepEqual(rule(held, writer), ruling, what);
    assert.equal(shapeRule({}, preview), 'start-over', 'a memory never written stands nowhere, whoever writes it first');
    assert.equal(shapeRule({}, liveSite), 'start-over');
  });

  /** A write straight to the store, in a shape and as a writer the test names. */
  const write = (projectId: string, schema: number, live: boolean, more: Partial<MemBatch> = {}): Promise<MemWriteAnswer> =>
    memory.write({ projectId, tenantId: TENANT, from: {}, through: { schema, auditThrough: 'aud_2' }, entries: [madeUp(projectId, 'aud_2')], live, ...more });

  it('starts a memory over by letting every entry go, so that none stays as an earlier shape told it', async () => {
    const projectId = 'prj_started_over';
    // Two entries in an earlier shape. The second is one the later rule tells differently.
    const earlier = [madeUp(projectId, 'aud_1'), madeUp(projectId, 'aud_2', { kind: 'chat_asked', about: [] })];
    assert.deepEqual(await write(projectId, S - 1, false, { entries: earlier }), { written: 2 });

    // A writer that is to start over and believes memory stands somewhere is told where, and nothing is let go.
    assert.deepEqual(await write(projectId, S, false, { from: { auditThrough: 'aud_2' } }), { moved: { schema: S - 1, auditThrough: 'aud_2' } });
    assert.equal((await entriesOf(projectId)).length, 2);

    assert.deepEqual(await write(projectId, S, false), { written: 1 });
    assert.deepEqual(await entriesOf(projectId), [madeUp(projectId, 'aud_2')], 'the entry the later shape tells, as it tells it, and no other');
    assert.deepEqual(await standsAt(projectId), { schema: S, auditThrough: 'aud_2' });

    // The earlier build finds a later shape and stands down, with nothing written.
    assert.deepEqual(await write(projectId, S - 1, false, { entries: earlier }), { newer: S });
    assert.deepEqual(await entriesOf(projectId), [madeUp(projectId, 'aud_2')]);
    await memory.purge(projectId);
  });

  it('lets the live site start over what a preview left, whatever its shape, and marks the memory its own', async () => {
    for (const left of [S, S + 1]) {
      const projectId = `prj_preview_left_${left}`;
      assert.deepEqual(await write(projectId, left, false, { entries: [madeUp(projectId, 'aud_1'), madeUp(projectId, 'aud_2', { about: ['fnd_from_the_preview'] })] }), { written: 2 });

      assert.deepEqual(await write(projectId, S, true), { written: 1 }, `the live site is not turned away by shape ${left}`);
      assert.deepEqual(await entriesOf(projectId), [madeUp(projectId, 'aud_2')], 'nothing the preview wrote is trusted: its entries go, and the live site’s are written');
      assert.deepEqual(await standsAt(projectId), { schema: S, auditThrough: 'aud_2', live: true });

      // From the first live write on, only the live site raises.
      assert.deepEqual(await write(projectId, S + 1, false), { lower: S });
      assert.deepEqual(await standsAt(projectId), { schema: S, auditThrough: 'aud_2', live: true }, 'the shape and the place are as the live site left them');
      assert.deepEqual(await entriesOf(projectId), [madeUp(projectId, 'aud_2')]);
      // A preview in the live site's shape adds to it, and the mark stays.
      assert.deepEqual(await write(projectId, S, false, { from: { auditThrough: 'aud_2' }, through: { schema: S, auditThrough: 'aud_3' }, entries: [madeUp(projectId, 'aud_3')] }), { written: 1 });
      assert.deepEqual(await standsAt(projectId), { schema: S, auditThrough: 'aud_3', live: true });
      assert.equal((await entriesOf(projectId)).length, 2);
      // The live site raises its own by starting over, and an earlier live build then stands down.
      assert.deepEqual(await write(projectId, S + 1, true), { written: 1 });
      assert.deepEqual(await standsAt(projectId), { schema: S + 1, auditThrough: 'aud_2', live: true });
      assert.equal((await entriesOf(projectId)).length, 1);
      assert.deepEqual(await write(projectId, S, true), { newer: S + 1 });
      await memory.purge(projectId);
    }
  });

  it('has a deployment that is not the live site raise an earlier shape by telling the whole record again', async () => {
    const project = file('Raised plot');
    const first = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const second = raise(project, 'Boundary is open', '2026-10-05T09:30:00.000Z');
    const turns = applyProjectChat(project, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    // As a build with an earlier shape left it: told through the record's end, one event told as the later rule does not tell it, and one it does not tell at all.
    const told = memoryDelta(project, {});
    const toldBefore = [
      ...told.entries.map((entry) => (entry.about[0] === first.id ? { ...entry, kind: 'action_recorded' as const } : entry)),
      madeUp(project.id, 'aud_only_the_earlier_shape_told'),
    ];
    assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: { ...told.through, schema: MEM_SCHEMA - 1 }, entries: toldBefore, live: false }), { written: toldBefore.length });

    const asked = { times: 0 };
    const passed = await pass([project], { asked });
    assert.equal(passed.settled.length, 1);
    assert.deepEqual(await standsAt(project), told.through, 'in this build’s shape, where the record ends');
    const byId = (a: MemEntry, b: MemEntry): number => (a.id < b.id ? -1 : 1);
    assert.deepEqual((await entriesOf(project)).sort(byId), [...told.entries].sort(byId), 'every entry is as this build tells it, and there is no other');
    assert.deepEqual((await findingsTold(project)).sort(), [first.id, second.id].sort());
    assert.equal(asked.times, 1, 'the conversation is told from its start, so the project store was asked whether it still holds this copy');
  });

  it('turns a deployment that is not the live site away from memory the live site wrote in an earlier shape, quietly', async () => {
    const projects = [file('First held back plot'), file('Second held back plot')];
    for (const project of projects) {
      raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
      assert.deepEqual(await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA - 1, auditThrough: 'aud_live' }, entries: [madeUp(project.id, 'aud_live')], live: true }), { written: 1 });
    }
    const warned = mock.method(console, 'warn', () => {});
    const written = mock.method(memory, 'write');
    const known = new Map<string, MemWatermark>();
    try {
      const first = await pass(projects, { known });
      assert.equal(first.settled.length, 2, 'there is nothing for this deployment to tell, so the copies are not owed');
      assert.deepEqual([first.made, first.failed], [1, 0], 'it read where memory stands and made no write: not a failure of the store');
      await pass(projects, { known });
      assert.equal(written.mock.callCount(), 0);
      assert.equal(said(warned, /^\[memory\].*only the live site raises its own/).length, 1, 'said once, however many projects and passes');
      assert.equal(known.size, 0, 'and asked again each time, so that it is told once the live site has raised it');
    } finally {
      written.mock.restore();
      warned.mock.restore();
    }
    for (const project of projects) {
      assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA - 1, auditThrough: 'aud_live', live: true }, 'the live site’s memory is as it left it');

      // The live site, on this build, raises it: the whole record, told again.
      await pass([project], { live: true });
      assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA, auditThrough: project.audit.at(-1)!.id, live: true });
      assert.equal((await findingsTold(project)).length, 1);
      assert.ok(!(await entriesOf(project)).some((entry) => entry.sourceId === 'aud_live'), 'what the earlier shape held is let go');
    }
  });

  it('settles a copy the store turns away, though this instance believed it could write', async () => {
    const projects = [file('First turned away plot'), file('Second turned away plot')];
    for (const project of projects) raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const warned = mock.method(console, 'warn', () => {});
    // The live site wrote each of them in an earlier shape after this instance last asked.
    const held: MemoryPort = { ...memory, write: async () => ({ lower: MEM_SCHEMA - 1 }) };
    try {
      const known = new Map<string, MemWatermark>();
      const work = () => ({ owed: projects.map((project) => ({ project, tenantId: TENANT })), gone: [], known, stillStored: async () => true });
      const first = await syncMemory(work(), held, false);
      assert.equal(first.settled.length, 2);
      assert.equal(first.failed, 0);
      assert.equal(known.size, 0, 'what it believed is not kept');
      await syncMemory(work(), held, false);
      assert.ok(said(warned, /^\[memory\].*only the live site raises its own/).length <= 1, 'and it is said once a process at most');
    } finally {
      warned.mock.restore();
    }
  });

  it('starts over, as the live site, memory a preview wrote in the same shape and to the same place', async () => {
    const project = file('Untrusted plot');
    const finding = raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    // A preview told this very record, in this shape. One of its entries is not what the record tells.
    const told = memoryDelta(project, {});
    await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: told.through, entries: [{ ...told.entries[0]!, about: ['fnd_from_the_preview'] }], live: false });
    assert.deepEqual(await findingsTold(project), ['fnd_from_the_preview']);

    const known = new Map<string, MemWatermark>();
    const passed = await pass([project], { live: true, known });
    assert.deepEqual([passed.settled.length, passed.failed], [1, 0]);
    assert.deepEqual(await findingsTold(project), [finding.id], 'the first live write does not trust what a preview left');
    assert.deepEqual(await standsAt(project), { ...told.through, live: true });

    // Its own memory it carries on: the same record again writes nothing, on the instance that wrote it and on another.
    const written = mock.method(memory, 'write');
    try {
      await pass([project], { live: true, known });
      await pass([project], { live: true });
      assert.equal(written.mock.callCount(), 0);
    } finally {
      written.mock.restore();
    }
  });

  it('marks an empty record’s memory the live site’s too, though there is no entry to tell', async () => {
    const project = file('Empty plot');
    project.audit = [];
    await memory.write({ projectId: project.id, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA }, entries: [madeUp(project.id, 'aud_from_the_preview')], live: false });
    await pass([project], { live: true });
    assert.deepEqual(await standsAt(project), { schema: MEM_SCHEMA, live: true });
    assert.deepEqual(await entriesOf(project), [], 'and what the preview left under it is gone');
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
    const chats = async (): Promise<MemEntry[]> => (await entriesOf(project)).filter((entry) => MEM_TURN_KINDS.includes(entry.kind));
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
    const told = (await entriesOf(project)).filter((entry) => MEM_TURN_KINDS.includes(entry.kind));
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
    // And a write made on a work pane, which leaves its note in the same thread.
    noteProjectEdit(mine, 'Added a comparable.', { actor: LEAD });
    mine.updatedAt = '2026-10-05T10:10:00.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    const kinds = async (): Promise<string[]> => (await entriesOf(project)).map((entry) => entry.kind).sort();
    assert.deepEqual(await kinds(), ['chat_answered', 'chat_answered', 'chat_asked', 'chat_asked', 'edit_noted', 'finding_raised']);

    clearProjectConversation(mine);
    mine.updatedAt = '2026-10-05T11:00:00.000Z';
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(await kinds(), ['finding_raised'], 'the entries of the chat turns went with the chats, the note’s with them');
    assert.deepEqual(await findingsTold(project), [finding.id]);
    assert.equal((await standsAt(project))?.turnThrough, undefined);

    // A question asked afterwards is told as any other.
    ask('2026-10-05T11:05:00.000Z');
    await instance!.save();
    await instance!.graphCaughtUp();
    assert.deepEqual(await kinds(), ['chat_answered', 'chat_asked', 'finding_raised']);
  });
});

describe('a note left in the thread by a work-pane write', () => {
  it('is told by the save that writes it, named or not, and holds back no question asked after it', async () => {
    const project = file('Noted plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const [instance] = await instances([project]);
    const mine = held(instance!, project);

    // A route that names nobody on its note, and then a person's question, in one save: nothing here has waited a moment.
    noteProjectEdit(mine, 'Filed a deed in the vault.');
    const note = mine.conversation.at(-2)!;
    const turns = applyProjectChat(mine, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    mine.updatedAt = new Date().toISOString();
    await instance!.save();
    await instance!.graphCaughtUp();

    const told = (await entriesOf(project)).filter((entry) => MEM_TURN_KINDS.includes(entry.kind));
    assert.deepEqual(
      told.map((entry) => [entry.kind, entry.sourceId, entry.by]).sort(),
      [
        ['chat_answered', turns.assistantTurn.id, memWho(project.id, LEAD)],
        ['chat_asked', turns.userTurn.id, memWho(project.id, LEAD)],
        ['edit_noted', note.id, memWho(project.id, 'nobody')],
      ],
      'the note is nobody’s, and the question behind it is told with it',
    );
    assert.equal((await standsAt(project))?.turnThrough, turns.assistantTurn.id);

    // One that says who wrote is theirs.
    noteProjectEdit(mine, 'Added a comparable.', { actor: LEAD });
    await instance!.save();
    await instance!.graphCaughtUp();
    const named = (await entriesOf(project)).filter((entry) => entry.kind === 'edit_noted' && entry.sourceId !== note.id);
    assert.deepEqual(named.map((entry) => entry.by), [memWho(project.id, LEAD)]);
  });
});

describe('a conversation told from its start', () => {
  /** A project with a finding told, and two questions asked and told. */
  async function asked(name: string): Promise<{ project: DdProject; a: Instance; b: Instance }> {
    const project = file(name);
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const other = file(`${name}, the other project`);
    raise(other, 'Access is unclear', '2026-10-05T09:00:00.000Z');
    const [a] = await instances([project, other]);
    const mine = held(a!, project);
    for (const at of ['2026-10-05T10:00:00.000Z', '2026-10-05T10:05:00.000Z']) {
      const turns = applyProjectChat(mine, 'what is missing?');
      for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
      mine.updatedAt = at;
    }
    await a!.save();
    await a!.graphCaughtUp();
    // A second instance boots now, and reads the project with its chats.
    const b = await boot();
    return { project, a: a!, b };
  }
  const chats = async (project: DdProject): Promise<number> => (await entriesOf(project)).filter((entry) => MEM_TURN_KINDS.includes(entry.kind)).length;

  it('is not told by an instance that read the project before its chats were deleted', async () => {
    const { project, a, b } = await asked('Stale chats plot');
    assert.equal(await chats(project), 4);

    const mine = held(a, project);
    clearProjectConversation(mine);
    mine.updatedAt = '2026-10-05T11:00:00.000Z';
    await a.save();
    await a.graphCaughtUp();
    assert.equal(await chats(project), 0, 'the chats are deleted, and memory lets go of their entries');
    assert.equal((await standsAt(project))?.turnThrough, undefined, 'and stands at no turn, as it does for a conversation never told');

    // The second instance saves another project. It has not read this one again: the copy it holds still has the turns.
    assert.equal(held(b, project).conversation.length, 4);
    const elsewhere = b.data.projects!.find((other) => other.id !== project.id)!;
    raise(elsewhere, 'Boundary is open', '2026-10-05T11:30:00.000Z');
    const written = mock.method(memory, 'write');
    try {
      await b.save();
      await b.graphCaughtUp();
      assert.deepEqual(written.mock.calls.map((call) => (call.arguments[0] as MemBatch).projectId), [elsewhere.id], 'it wrote the project it saved, and nothing of the one it holds an old copy of');
    } finally {
      written.mock.restore();
    }
    assert.equal(await chats(project), 0, 'the entries are not put back');

    // And once it reads the project as stored, it has nothing to tell.
    await b.syncProject(project.id, { force: true });
    await b.graphCaughtUp();
    assert.equal(held(b, project).conversation.length, 0);
    assert.equal(await chats(project), 0);
  });

  it('asks the project store before it is told, once, and only then', async () => {
    const project = file('Asked first plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const known = new Map<string, MemWatermark>();
    const asked_ = { times: 0 };
    await pass([project], { known, asked: asked_ });
    assert.equal(asked_.times, 0, 'audit events are only ever added: a copy that tells them needs no asking');

    const turns = applyProjectChat(project, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    project.updatedAt = '2026-10-05T10:00:00.000Z';
    // The project store no longer holds this copy: it is an older one.
    const older = await pass([project], { known, asked: asked_, stillStored: false });
    assert.equal(asked_.times, 1);
    assert.deepEqual(older.settled, [{ projectId: project.id, builtAt: project.updatedAt }], 'it has nothing to tell, and is not asked about again');
    assert.equal(older.made, 0, 'and the memory store was asked nothing');
    assert.equal(await chats(project), 0);

    await pass([project], { known, asked: asked_ });
    assert.equal(asked_.times, 2, 'the copy the project store holds is asked about and told');
    assert.equal(await chats(project), 2);

    const more = applyProjectChat(project, 'what is missing?');
    for (const turn of [more.userTurn, more.assistantTurn]) turn.actor = LEAD;
    project.updatedAt = '2026-10-05T10:05:00.000Z';
    await pass([project], { known, asked: asked_ });
    assert.equal(asked_.times, 2, 'turns told after a turn memory holds need no asking: a copy that holds that turn is not an older conversation');
    assert.equal(await chats(project), 4);
  });

  it('asks the project store once in a telling, though the memory store sends the writer round again', async () => {
    const project = file('Asked once plot');
    raise(project, 'Extent differs', '2026-10-05T09:00:00.000Z');
    const known = new Map<string, MemWatermark>();
    await pass([project], { known });
    const believed = new Map(known);
    // Another instance tells memory more, and this one does not hear of it.
    raise(project, 'Boundary is open', '2026-10-05T09:30:00.000Z');
    await pass([project]);
    const turns = applyProjectChat(project, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    project.updatedAt = '2026-10-05T10:00:00.000Z';

    const asked_ = { times: 0 };
    const written = mock.method(memory, 'write');
    try {
      const passed = await pass([project], { known: believed, asked: asked_ });
      assert.equal(written.mock.callCount(), 2, 'turned away once, then taken');
      assert.equal(passed.settled.length, 1);
    } finally {
      written.mock.restore();
    }
    assert.equal(asked_.times, 1, 'the copy was the stored one a moment ago, and is not asked about twice');
    assert.equal(await chats(project), 2);
  });

  it('is not told from a copy that changed while the project store was asked', async () => {
    const project = file('Changed while asked plot');
    const turns = applyProjectChat(project, 'what is missing?');
    for (const turn of [turns.userTurn, turns.assistantTurn]) turn.actor = LEAD;
    project.updatedAt = '2026-10-05T10:00:00.000Z';
    const builtAt = project.updatedAt;
    const passed = await syncMemory(
      {
        owed: [{ project, tenantId: TENANT }],
        gone: [],
        known: new Map(),
        stillStored: async () => {
          // A request changes the project in memory while storage is read.
          project.updatedAt = '2026-10-05T10:00:01.000Z';
          return true;
        },
      },
      memory,
      false,
    );
    assert.deepEqual(passed.settled, [], `the copy of ${builtAt} stays owed: the save that writes the change tells it`);
    assert.equal(await chats(project), 0);
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
    const facts = (await factsOf(project)).length;
    assert.ok(facts > 0);
    assert.equal(counted.project, 3 + facts, 'two entries, the node that says where memory stands, and a node a fact');
    assert.equal(counted.database, before_.database + 3 + facts);
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
    await memory.write({ projectId: silent, tenantId: workspace, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], live: false });
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
    await memory.write({ projectId, tenantId, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], live: false });
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
