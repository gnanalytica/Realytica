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
 * the index entry, the grants, the graph and the memory.
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

describe('removing a project', () => {
  it('leaves it as it was, and says so, when its documents could not be removed', async () => {
    const project = await filed('Kept plot');
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
    assert.equal(store.data.projects![store.data.projects!.length - 1]!.id, project.id, 'where it was');
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
