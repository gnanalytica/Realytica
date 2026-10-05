/**
 * The stored graph and several instances over one project store.
 *
 * Serverless runs more than one instance, each holding every project as it
 * stood when that instance last read it. Before this, an instance's first save
 * pushed the graph of every project it held, however old its copy, and the
 * graph store took whatever arrived last: a nine o'clock copy went over the
 * graph a ten o'clock copy had built, and the nodes the newer copy had added
 * were deleted. A save also waited on the graph store for as long as the
 * graph store cared to take.
 *
 * What is pinned here. The project store numbers each write of a project's
 * document, and the number is its own. The graph store refuses a copy older
 * than the one it holds, and writes nothing for a copy it has already drawn.
 * A save waits only for what it wrote and removed, and for a bounded time.
 * What an instance has merely read it offers afterwards, which is how a
 * graph left behind is caught up, and an older copy offered that way is
 * refused like any other. A later write the graph store turned away because
 * a clock ran behind is offered again. A project that left an instance's
 * list and came back keeps its graph.
 *
 * Run against the real filesystem store and the real journal in a temporary
 * directory: what is asserted is what is on disk afterwards. Two `Store`
 * objects over that directory stand in for two instances, as in
 * `store-sync.test.ts`. The Neo4j adapter's side of the same refusal is in
 * `graph-neo4j-statements.test.ts`, and the index the instances share is in
 * `store-index.test.ts`.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import { addAsset, createProject, type DdProject, type ProjectGraphNode } from '@realytica/shared';
import type { GraphAdapter } from '../apps/api/src/graph/types';
import type { GraphSettlement } from '../apps/api/src/graph/sync';

type StoreModule = typeof import('../apps/api/src/store');
type Instance = InstanceType<StoreModule['Store']>;

let root: string;
let dataDir: string;
let Store: StoreModule['Store'];
/** This deployment's graph store, which with nothing configured is the journal. */
let graph: GraphAdapter;
let syncGraph: typeof import('../apps/api/src/graph/sync').syncGraph;
let GRAPH_WAIT_MS: number;

/** Every instance a test boots, so that what it offers in the background is over before the next test. */
const booted: Instance[] = [];

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'realytica-graph-sync-'));
  process.env.REALYTICA_DATA_DIR = root;
  const storeModule = await import('../apps/api/src/store');
  Store = storeModule.Store;
  // The store keeps its data in a generation folder inside the data directory.
  dataDir = storeModule.DATA_DIR;
  ({ graphAdapter: graph } = await import('../apps/api/src/graph'));
  ({ syncGraph, GRAPH_WAIT_MS } = await import('../apps/api/src/graph/sync'));
});

afterEach(async () => {
  for (const instance of booted.splice(0)) await instance.graphCaughtUp();
});

after(async () => {
  delete process.env.REALYTICA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

function file(name: string): DdProject {
  return createProject({ name, type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-GS1');
}

/** Moves a project's clock the way every mutation does, to an instant the test names. */
function touch(project: DdProject, at: string): void {
  project.updatedAt = at;
}

/** A project's document as it is on disk, the store's own key included. */
async function documentOf(project: DdProject): Promise<DdProject & { storeRevision?: number }> {
  return JSON.parse(await readFile(path.join(dataDir, 'uploads', project.id, 'project.json'), 'utf-8')) as DdProject & { storeRevision?: number };
}

const indexFile = (): string => path.join(dataDir, 'realytica.json');
const journalFile = (): string => path.join(dataDir, 'project-graph-journal.json');

/** What another instance's save leaves in the index, from this one's point of view. */
async function rewriteIndex(change: (ids: string[]) => string[]): Promise<void> {
  const core = JSON.parse(await readFile(indexFile(), 'utf-8')) as { projectIds: string[] };
  core.projectIds = change(core.projectIds);
  await writeFile(indexFile(), JSON.stringify(core));
}

async function boot(): Promise<Instance> {
  const instance = new Store();
  await instance.init();
  booted.push(instance);
  return instance;
}

/** Fresh instances over a store that holds exactly `projects`, each already saved once and drawn. */
async function instances(projects: DdProject[], count = 1): Promise<Instance[]> {
  const seed = await boot();
  seed.data.projects = projects;
  await seed.save();
  await seed.graphCaughtUp();
  const made: Instance[] = [];
  for (let i = 0; i < count; i += 1) made.push(await boot());
  return made;
}

function held(instance: Instance, project: DdProject): DdProject {
  const found = instance.data.projects!.find((p) => p.id === project.id);
  assert.ok(found, 'the instance holds the project');
  return found;
}

async function hasNode(project: DdProject, nodeId: string): Promise<boolean> {
  const stored = await graph.readProject(project.id);
  return Boolean(stored?.nodes.some((n) => n.id === nodeId));
}

function parcel(id: string): ProjectGraphNode {
  return { id, kind: 'parcel', layer: 'entity', origin: 'derived', label: id };
}

/** A promise a test settles when it chooses. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets what is already runnable run, timers aside. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** What the loop reports back to a project store, kept for a test to read. */
function told(): { synced: string[]; purged: string[]; settle: GraphSettlement } {
  const synced: string[] = [];
  const purged: string[] = [];
  return {
    synced,
    purged,
    settle: {
      synced: (owed) => { synced.push(owed.project.id); },
      purged: (projectId) => { purged.push(projectId); },
      // A project store that has moved on from the copy, so the refusal stands.
      refused: async () => undefined,
    },
  };
}

function said(warned: { mock: { calls: Array<{ arguments: unknown[] }> } }, pattern: RegExp): string[] {
  return warned.mock.calls.map((call) => String(call.arguments[0])).filter((line) => pattern.test(line));
}

/**
 * Runs with the clock stopped, so that a revision can rise only by the store's
 * own count. With the clock running a later write is numbered later whatever
 * the count does, and a test of the count would pass without one.
 */
async function clockStopped(work: () => Promise<void>): Promise<void> {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T08:00:00.000Z') });
  try {
    await work();
  } finally {
    mock.timers.reset();
  }
}

describe('the revision of a project’s document', () => {
  it('rises with every write, and the project never shows it', () => clockStopped(async () => {
    const [a] = await instances([file('Revisions')]);
    const project = a!.data.projects![0]!;
    const first = (await documentOf(project)).storeRevision;
    assert.equal(typeof first, 'number', 'the document carries it');
    assert.equal('storeRevision' in project, false, 'the project read from it does not');

    touch(project, '2026-10-05T09:00:00.000Z');
    await a!.save();

    const second = (await documentOf(project)).storeRevision;
    assert.equal(second, first! + 1, 'the second write is numbered after the first, the clock not having moved');
    assert.equal('storeRevision' in project, false);
  }));

  it('is not put back by an undo that puts every older field back', () => clockStopped(async () => {
    const [a] = await instances([file('Undone')]);
    const project = a!.data.projects![0]!;
    // The file as it stood, the way an older build's undo keeps it: whole,
    // with the revision it had then among its fields.
    const asItStood = await documentOf(project);
    project.name = 'Changed by an instruction';
    touch(project, '2026-10-05T09:00:00.000Z');
    await a!.save();
    const changed = (await documentOf(project)).storeRevision;

    // What the undo route does to the project.
    const fields = project as unknown as Record<string, unknown>;
    for (const key of Object.keys(fields)) delete fields[key];
    Object.assign(fields, asItStood);
    touch(project, '2026-10-05T09:01:00.000Z');
    await a!.save();

    const after = await documentOf(project);
    assert.equal(after.name, 'Undone', 'the older fields are back');
    assert.equal(asItStood.storeRevision! < changed!, true, 'with the older revision among them');
    assert.equal(after.storeRevision, changed! + 1, 'and the write that put them back is still numbered last');
  }));

  it('numbers a later write above an earlier one the writing instance never read', async () => {
    const project = file('Lowered');
    const [a, late] = await instances([project], 2);
    const onA = held(a!, project);
    const first = (await documentOf(onA)).storeRevision!;
    for (const at of ['2026-10-05T09:00:00.000Z', '2026-10-05T09:01:00.000Z', '2026-10-05T09:02:00.000Z']) {
      touch(onA, at);
      await a!.save();
    }
    const newest = (await documentOf(onA)).storeRevision!;
    assert.ok(newest > first);

    // An instance that last read the project before those three writes, so
    // the highest number it has seen is the first. A build that does not
    // raise the number leaves an instance in the same place.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const onLate = held(late!, project);
    const tower = addAsset(onLate, { name: 'Tower A', assetType: 'Residential tower' });
    touch(onLate, '2026-10-05T09:03:00.000Z');
    await late!.save();

    assert.ok((await documentOf(onLate)).storeRevision! > newest, 'the copy the store now keeps has the highest number');
    assert.ok(await hasNode(project, tower.id), 'so the graph store took it');
  });
});

describe('an older copy of a project and the graph store', () => {
  it('leaves the newer graph in place, through the sync loop', async () => {
    // Two copies of one project: as it stood at nine, and at ten with a tower added.
    const older = file('Nine and ten');
    const newer = structuredClone(older);
    const tower = addAsset(newer, { name: 'Tower A', assetType: 'Residential tower' });
    const warned = mock.method(console, 'warn', () => {});
    try {
      await syncGraph([{ project: newer, revision: 2 }], [], told().settle, graph).finished;
      assert.ok(await hasNode(older, tower.id));

      const heard = told();
      await syncGraph([{ project: older, revision: 1 }], [], heard.settle, graph).finished;

      assert.ok(await hasNode(older, tower.id), 'what the ten o’clock copy drew is still there');
      assert.deepEqual(heard.synced, [older.id], 'turned away is settled, so the copy is not offered again');
      assert.equal(warned.mock.callCount(), 1, 'and it is said once');
      assert.match(String(warned.mock.calls[0]?.arguments[0]), /kept the stored graph of .+ built from revision 2, and this copy is revision 1/);
    } finally {
      warned.mock.restore();
    }

    // The same revision is not older. Drawn differently, it replaces what is
    // stored: the same copy of a project, drawn by newer code.
    await syncGraph([{ project: older, revision: 2 }], [], told().settle, graph).finished;
    assert.equal(await hasNode(older, tower.id), false, 'a different drawing at the same revision replaces what was drawn');
    await graph.purgeProject(older.id);
  });

  it('answers the refusal instead of throwing, and says which revision it holds', async () => {
    const project = file('Refused');
    const at = (revision: number | undefined, nodes: ProjectGraphNode[]) =>
      graph.syncProject({ projectId: project.id, builtAt: project.updatedAt, ...(revision === undefined ? {} : { revision }), nodes, edges: [] });
    await at(5, [parcel('refused-p1')]);

    assert.deepEqual(await at(4, [parcel('refused-p2')]), { refused: true, held: 5, drawn: false });
    assert.deepEqual(await at(4, [parcel('refused-p1')]), { refused: true, held: 5, drawn: true }, 'and when what it holds is already this drawing');
    // A snapshot built outside a save carries no revision and is the lowest.
    assert.deepEqual(await at(undefined, [parcel('refused-p2')]), { refused: true, held: 5, drawn: false });
    await graph.purgeProject(project.id);
  });

  it('writes nothing for a copy it has already drawn, and moves only the revision for a later one that draws the same', async () => {
    const project = file('Drawn');
    const at = (revision: number, nodes: ProjectGraphNode[]) =>
      graph.syncProject({ projectId: project.id, builtAt: project.updatedAt, revision, nodes, edges: [] });
    await at(1, [parcel('drawn-p1')]);
    const written = (await stat(journalFile())).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 12));

    assert.equal(await at(1, [parcel('drawn-p1')]), undefined, 'taken');
    assert.equal((await stat(journalFile())).mtimeMs, written, 'and the journal was not rewritten');

    assert.equal(await at(2, [parcel('drawn-p1')]), undefined);
    assert.deepEqual(await at(1, [parcel('drawn-p2')]), { refused: true, held: 2, drawn: false }, 'the later revision is the one held now');
    await graph.purgeProject(project.id);
  });
});

describe('what a save waits for, and what an instance offers of what it has read', () => {
  it('waits for the one project it wrote, drops none, and cannot put an older copy over a newer graph', async () => {
    const [p, q] = [file('Plot P'), file('Plot Q')];
    const [a, b] = await instances([p, q], 2);

    // Ten o'clock, through A: a tower on P.
    const tower = addAsset(held(a!, p), { name: 'Tower A', assetType: 'Residential tower' });
    touch(held(a!, p), '2026-10-05T10:00:00.000Z');
    await a!.save();
    await a!.graphCaughtUp();
    assert.ok(await hasNode(p, tower.id));

    // B booted before that and has not read P since. Its first save is of Q.
    assert.equal(held(b!, p).assets.length, 0, 'B still holds the nine o’clock copy of P');
    held(b!, q).description = 'Changed through B';
    touch(held(b!, q), '2026-10-05T10:05:00.000Z');
    const offered = mock.method(graph, 'syncProject');
    const purged = mock.method(graph, 'purgeProject');
    const warned = mock.method(console, 'warn', () => {});
    try {
      await b!.save();
      const waitedFor = offered.mock.calls.map((call) => call.arguments[0].projectId);
      assert.deepEqual(waitedFor, [q.id], 'the save waited for Q and for nothing else');

      // What B merely read is offered once the save is out of the way, at
      // the number it was read with: P among it, as B has it.
      await b!.graphCaughtUp();
      assert.ok(offered.mock.calls.some((call) => call.arguments[0].projectId === p.id), 'B’s copy of P was offered');
      assert.equal(said(warned, /kept the stored graph/).length, 1, 'and turned away, once');
      assert.equal(purged.mock.callCount(), 0, 'nothing was dropped');
    } finally {
      offered.mock.restore();
      purged.mock.restore();
      warned.mock.restore();
    }
    assert.ok(await hasNode(p, tower.id), 'the graph the ten o’clock copy of P built is as A left it');
  });

  it('drops the graph of a project it removed, and of no other', async () => {
    const [keep, gone] = [file('Kept'), file('Removed')];
    const [a] = await instances([keep, gone]);
    assert.ok(await graph.readProject(gone.id));

    a!.data.projects = a!.data.projects!.filter((project) => project.id !== gone.id);
    await a!.save();

    assert.equal(await graph.readProject(gone.id), null);
    assert.ok(await graph.readProject(keep.id), 'the project it was not asked about is still there');
  });

  it('drops the graph of a project another instance removed, at its own next save', async () => {
    const [keep, gone] = [file('Kept elsewhere'), file('Removed elsewhere')];
    const [a, b] = await instances([keep, gone], 2);

    // B removes the project, the graph store fails B's purge, and B is not heard from again.
    const down = mock.method(graph, 'purgeProject', async () => {
      throw new Error('the store is down');
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      b!.data.projects = b!.data.projects!.filter((project) => project.id !== gone.id);
      await b!.save();
    } finally {
      down.mock.restore();
      warned.mock.restore();
    }
    assert.ok(await graph.readProject(gone.id), 'the graph outlived the project');

    // A learns of the removal from the index. Its next save takes the graph with it.
    await a!.syncIndex();
    await a!.graphCaughtUp();
    assert.equal(a!.data.projects!.some((project) => project.id === gone.id), false);
    assert.ok(await graph.readProject(gone.id), 'not on the read: a save is what drops a graph');
    touch(held(a!, keep), '2026-10-05T10:00:00.000Z');
    await a!.save();

    assert.equal(await graph.readProject(gone.id), null);
    assert.ok(await graph.readProject(keep.id));
  });

  it('keeps the graph and the notes of a project that left its list and came back before it saved', async () => {
    const [p, other] = [file('Left and came back'), file('Stayed')];
    const [a] = await instances([p, other]);
    const note: ProjectGraphNode = { id: `${p.id}::note`, kind: 'thought', layer: 'deliberation', origin: 'authored', label: 'why this matters' };
    await graph.appendProject(p.id, [note], [{ id: `${p.id}::note>project`, from: note.id, to: p.id, rel: 'cites' }]);

    const purged = mock.method(graph, 'purgeProject');
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      // The index stops naming the project, though nobody deleted it, and A sees that.
      await rewriteIndex((ids) => ids.filter((id) => id !== p.id));
      await a!.syncIndex();
      assert.equal(a!.data.projects!.some((project) => project.id === p.id), false, 'it has left A’s list');

      // The index names it again, and A sees that too, before A has saved anything.
      await rewriteIndex((ids) => [...ids, p.id]);
      mock.timers.tick(2_001);
      await a!.syncIndex();
      assert.ok(a!.data.projects!.some((project) => project.id === p.id), 'and come back');

      touch(held(a!, other), '2026-10-05T10:00:00.000Z');
      await a!.save();
      await a!.graphCaughtUp();

      assert.equal(purged.mock.callCount(), 0, 'its graph was not dropped');
    } finally {
      mock.timers.reset();
      purged.mock.restore();
    }
    const stored = await graph.readProject(p.id);
    assert.ok(stored?.nodes.some((n) => n.id === note.id), 'the note written on it is still there');
    assert.ok(stored?.edges.some((e) => e.id === `${p.id}::note>project`), 'and still joined to it');
  });
});

describe('a graph that was left behind', () => {
  it('is caught up by the next instance that reads the project', async () => {
    const p = file('Lost with its instance');
    const [a, b] = await instances([p], 2);

    // A writes a tower while the graph store is down, and is not heard from again.
    const tower = addAsset(held(a!, p), { name: 'Tower A', assetType: 'Residential tower' });
    touch(held(a!, p), '2026-10-05T10:00:00.000Z');
    const down = mock.method(graph, 'syncProject', async () => {
      throw new Error('the store is down');
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      await a!.save();
      await a!.graphCaughtUp();
    } finally {
      down.mock.restore();
      warned.mock.restore();
    }
    assert.equal(await hasNode(p, tower.id), false, 'the graph is behind the project store');

    // B is asked about the project, which reads its document. Nothing is saved.
    await b!.syncProject(p.id);
    await b!.graphCaughtUp();

    assert.ok(await hasNode(p, tower.id), 'the read caught it up');
  });

  it('is redrawn when the same copy is now drawn differently', async () => {
    const p = file('Drawn by older code');
    await instances([p], 0);
    const revision = (await documentOf(p)).storeRevision!;
    // What an earlier build drew of this very copy: the same revision, another shape.
    await graph.syncProject({ projectId: p.id, builtAt: p.updatedAt, revision, nodes: [parcel(`${p.id}::old-shape`)], edges: [] });
    assert.equal(await hasNode(p, p.id), false);

    const b = await boot();
    await b.syncIndex();
    await b.graphCaughtUp();

    assert.ok(await hasNode(p, p.id), 'the project is drawn as this build draws it');
    assert.equal(await hasNode(p, `${p.id}::old-shape`), false, 'and the older shape is gone');
  });

  it('asks once about a copy it has read, and writes nothing when the graph is level', async () => {
    const p = file('Level');
    const [a] = await instances([p]);
    const written = (await stat(journalFile())).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 12));
    const offered = mock.method(graph, 'syncProject');
    try {
      await a!.syncProject(p.id);
      await a!.graphCaughtUp();
      assert.equal(offered.mock.callCount(), 1, 'the copy A read at boot was offered');
      assert.equal((await stat(journalFile())).mtimeMs, written, 'and there was nothing to write');

      await a!.syncProject(p.id, { force: true });
      await a!.graphCaughtUp();
      assert.equal(offered.mock.callCount(), 1, 'reading the same copy again offers nothing');
    } finally {
      offered.mock.restore();
    }
  });

  it('holds no read, and is asked for nothing more once the wait has run out', async () => {
    const [p, q] = [file('Read P'), file('Read Q')];
    const [a] = await instances([p, q]);
    const reached = deferred();
    const hung = deferred<never>();
    const silent = mock.method(graph, 'syncProject', () => {
      reached.resolve();
      return hung.promise;
    });
    const warned = mock.method(console, 'warn', () => {});
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      // The read comes back though the graph store has answered nothing.
      await a!.syncIndex();
      await reached.promise;
      assert.equal(silent.mock.callCount(), 1);

      mock.timers.tick(GRAPH_WAIT_MS);
      hung.reject(new Error('the connection was lost'));
      await a!.graphCaughtUp();

      assert.equal(silent.mock.callCount(), 1, 'the second project was not offered after the wait');
      assert.equal(said(warned, /could not sync project .+: the connection was lost/).length, 1);
    } finally {
      mock.timers.reset();
      silent.mock.restore();
      warned.mock.restore();
    }
  });
});

describe('a later write the graph store turned away', () => {
  it('is offered again above the number held, when the project store still holds it', async () => {
    const p = file('Behind by three seconds');
    const [a, b] = await instances([p], 2);
    const now = Date.now();
    mock.timers.enable({ apis: ['Date'], now });
    try {
      // A's clock runs three seconds ahead.
      mock.timers.setTime(now + 3_000);
      held(a!, p).description = 'Written through A';
      touch(held(a!, p), '2026-10-05T10:00:00.000Z');
      await a!.save();
      const ahead = (await documentOf(p)).storeRevision!;

      // B's clock is right, and B has not read the project since it booted.
      mock.timers.setTime(now);
      const tower = addAsset(held(b!, p), { name: 'Tower A', assetType: 'Residential tower' });
      touch(held(b!, p), '2026-10-05T10:01:00.000Z');
      await b!.save();

      assert.ok((await documentOf(p)).storeRevision! < ahead, 'the later write carries the lower number');
      assert.ok(await hasNode(p, tower.id), 'and the graph is of the copy the project store keeps all the same');

      // What B writes next is numbered above what the graph store holds.
      touch(held(b!, p), '2026-10-05T10:02:00.000Z');
      await b!.save();
      assert.ok((await documentOf(p)).storeRevision! > ahead);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('a graph store that does not answer', () => {
  const CONTEXT = Symbol.for('@vercel/request-context');

  it('holds a save for the wait and no longer, and the call is left to finish after the reply', async () => {
    assert.equal(GRAPH_WAIT_MS, 2_000);
    const [a] = await instances([file('Slow graph')]);
    const project = a!.data.projects![0]!;
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' });
    touch(project, '2026-10-05T11:00:00.000Z');

    // What the platform is handed to keep the instance alive for.
    const kept: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[CONTEXT] = { get: () => ({ waitUntil: (work: Promise<unknown>) => { kept.push(work); } }) };
    const answer = graph.syncProject.bind(graph);
    const reached = deferred();
    const gate = deferred();
    const slow = mock.method(graph, 'syncProject', async (snapshot: Parameters<GraphAdapter['syncProject']>[0]) => {
      reached.resolve();
      await gate.promise;
      return answer(snapshot);
    });
    const warned = mock.method(console, 'warn', () => {});
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let saved = false;
      const saving = a!.save().then(() => { saved = true; });
      await reached.promise;

      mock.timers.tick(GRAPH_WAIT_MS - 1);
      await turn();
      assert.equal(saved, false, 'inside the wait, the save is still waiting');

      mock.timers.tick(1);
      await saving;
      assert.equal(said(warned, /had not answered in time/).length, 1);
      assert.ok((await documentOf(project)).assets.some((asset) => asset.id === tower.id), 'the project store has the change');
      assert.equal(await hasNode(project, tower.id), false, 'and the graph store does not, yet');
      assert.ok(kept.length > 0, 'the platform was told the work is still this request’s');

      // The graph store answers, after the reply has gone.
      gate.resolve();
      await Promise.all(kept);
      assert.ok(await hasNode(project, tower.id), 'the call that outlived the wait finished');
      assert.equal(slow.mock.callCount(), 1);
    } finally {
      mock.timers.reset();
      slow.mock.restore();
      warned.mock.restore();
      delete (globalThis as Record<symbol, unknown>)[CONTEXT];
    }

    // Its answer counted: nothing is owed, so nothing is offered again.
    const offered = mock.method(graph, 'syncProject');
    try {
      await a!.save();
      await a!.graphCaughtUp();
      assert.equal(offered.mock.callCount(), 0);
    } finally {
      offered.mock.restore();
    }
  });

  it('logs once a failure that comes after the wait, and offers the project again on the next save', async () => {
    const [a] = await instances([file('Failed late')]);
    const project = a!.data.projects![0]!;
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' });
    touch(project, '2026-10-05T11:00:00.000Z');

    const reached = deferred();
    const hung = deferred<never>();
    const silent = mock.method(graph, 'syncProject', () => {
      reached.resolve();
      return hung.promise;
    });
    const warned = mock.method(console, 'warn', () => {});
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const saving = a!.save();
      await reached.promise;
      mock.timers.tick(GRAPH_WAIT_MS);
      await saving;
      // The pass that follows a save leaves alone a project whose offer is still out.
      await a!.graphCaughtUp();
      assert.equal(silent.mock.callCount(), 1);
      assert.equal(said(warned, /could not sync/).length, 0, 'nothing has failed yet');

      hung.reject(new Error('the connection was lost'));
      await turn();
      await turn();
      assert.equal(said(warned, /could not sync project .+: the connection was lost/).length, 1, 'the failure is logged, once');
    } finally {
      mock.timers.reset();
      silent.mock.restore();
      warned.mock.restore();
    }
    assert.equal(await hasNode(project, tower.id), false);

    // Nothing has changed since, so all this save has for the graph store is what it could not hand over.
    await a!.save();
    await a!.graphCaughtUp();
    assert.ok(await hasNode(project, tower.id), 'the next save hands it over');
  });

  it('does not fail a save when it throws, and is offered the project again on the next', async () => {
    const [a] = await instances([file('Failing graph')]);
    const project = a!.data.projects![0]!;
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' });
    touch(project, '2026-10-05T11:00:00.000Z');

    const down = mock.method(graph, 'syncProject', async () => {
      throw new Error('the store is down');
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      await a!.save();
      await a!.graphCaughtUp();
      assert.ok(said(warned, /could not sync project .+: the store is down/).length > 0, 'the failure is logged');
    } finally {
      down.mock.restore();
      warned.mock.restore();
    }
    assert.ok((await documentOf(project)).assets.some((asset) => asset.id === tower.id), 'the project store has the change');
    assert.equal(await hasNode(project, tower.id), false);

    await a!.save();
    await a!.graphCaughtUp();
    assert.ok(await hasNode(project, tower.id));
  });

  it('is not asked again by every read while it is down', async () => {
    const p = file('Down');
    const [a] = await instances([p]);
    const down = mock.method(graph, 'syncProject', async () => {
      throw new Error('the store is down');
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      await a!.syncProject(p.id);
      await a!.graphCaughtUp();
      assert.equal(down.mock.callCount(), 1, 'the first read asked');

      await a!.syncProject(p.id, { force: true });
      await a!.syncIndex();
      await a!.graphCaughtUp();
      assert.equal(down.mock.callCount(), 1, 'the next reads did not');
    } finally {
      down.mock.restore();
      warned.mock.restore();
    }
    // A save asks either way, which is how a store that was down is found to be back.
    const offered = mock.method(graph, 'syncProject');
    try {
      await a!.save();
      await a!.graphCaughtUp();
      assert.equal(offered.mock.callCount(), 1);
    } finally {
      offered.mock.restore();
    }
  });

  it('gives one save one wait, however many projects it wrote', async () => {
    const [p, q] = [file('First of two'), file('Second of two')];
    const [a] = await instances([p, q]);
    touch(held(a!, p), '2026-10-05T11:00:00.000Z');
    touch(held(a!, q), '2026-10-05T11:00:00.000Z');

    const first = deferred();
    const second = deferred();
    let calls = 0;
    const slow = mock.method(graph, 'syncProject', () => {
      calls += 1;
      if (calls === 1) {
        first.resolve();
        // Answers a second and a half into the wait.
        return new Promise<void>((resolve) => setTimeout(resolve, 1_500));
      }
      second.resolve();
      return new Promise<never>(() => {});
    });
    const warned = mock.method(console, 'warn', () => {});
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let saved = false;
      const saving = a!.save().then(() => { saved = true; });
      await first.promise;
      mock.timers.tick(1_500);
      await second.promise;

      mock.timers.tick(GRAPH_WAIT_MS - 1_500 - 1);
      await turn();
      assert.equal(saved, false, 'the second call is inside the same wait as the first');
      mock.timers.tick(1);
      await saving;
      assert.equal(slow.mock.callCount(), 2);
    } finally {
      mock.timers.reset();
      slow.mock.restore();
      warned.mock.restore();
    }
  });

  it('is asked for nothing more in a pass once the wait has run out', async () => {
    const [first, second, gone] = [file('First'), file('Second'), file('Gone')];
    const calls: string[] = [];
    const silent: GraphAdapter = {
      ...graph,
      syncProject: (snapshot) => {
        calls.push(`sync ${snapshot.projectId}`);
        return new Promise<never>(() => {});
      },
      purgeProject: async (projectId) => {
        calls.push(`purge ${projectId}`);
      },
    };
    const heard = told();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const run = syncGraph([{ project: first, revision: 1 }, { project: second, revision: 1 }], [gone.id], heard.settle, silent);
      await turn();
      mock.timers.tick(GRAPH_WAIT_MS);

      assert.equal(await run.waited, false, 'the wait ran out before the answers came');
      assert.deepEqual([heard.synced, heard.purged], [[], []], 'nothing is reported as taken');
      assert.deepEqual(calls, [`sync ${first.id}`], 'and the store was not asked again after it failed to answer');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('two saves of one project that overlap', () => {
  it('number the later write higher, and leave the graph and the debt as the later one has them', async () => {
    const p = file('Overlapping');
    const [a] = await instances([p]);
    const project = held(a!, p);

    const answer = graph.syncProject.bind(graph);
    const reached = deferred();
    const gate = deferred();
    const offers: number[] = [];
    const slow = mock.method(graph, 'syncProject', async (snapshot: Parameters<GraphAdapter['syncProject']>[0]) => {
      offers.push(snapshot.revision!);
      // The first save's offer is still out when the second save comes and goes.
      if (offers.length === 1) {
        reached.resolve();
        await gate.promise;
      }
      return answer(snapshot);
    });
    const warned = mock.method(console, 'warn', () => {});
    try {
      const towerA = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' });
      touch(project, '2026-10-05T11:00:00.000Z');
      const first = a!.save();
      await reached.promise;

      const towerB = addAsset(project, { name: 'Tower B', assetType: 'Residential tower' });
      touch(project, '2026-10-05T11:01:00.000Z');
      await a!.save();

      gate.resolve();
      await first;
      await a!.graphCaughtUp();

      assert.equal(offers.length, 2);
      assert.ok(offers[1]! > offers[0]!, 'the second write is numbered above the first');
      assert.equal((await documentOf(project)).storeRevision, offers[1], 'and is the one the project store keeps');
      assert.ok((await hasNode(p, towerA.id)) && (await hasNode(p, towerB.id)), 'the graph is the later write’s');
      assert.equal(said(warned, /kept the stored graph/).length, 1, 'the earlier write’s offer, arriving late, was turned away');

      // Neither write is still owed.
      await a!.save();
      await a!.graphCaughtUp();
      assert.equal(offers.length, 2);
    } finally {
      slow.mock.restore();
      warned.mock.restore();
    }
  });
});
