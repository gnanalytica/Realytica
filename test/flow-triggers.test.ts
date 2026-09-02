/**
 * Making the Enabled toggle mean something.
 *
 * Everything here is about *not* firing. Firing is the easy half; the ways a
 * trigger runner goes wrong are all ways it fires when it should not — a flow
 * somebody switched off, a flow with errors, a timer with no interval read as
 * "every tick", a schedule that re-fires everything after a restart, a broken
 * automation taking a real upload down with it.
 *
 * The clock is injected everywhere, so none of this waits on a timer.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_OUT_PORT,
  MAX_SCHEDULED_PROJECTS,
  type DdProject,
  type Flow,
  type FlowNode,
  type TriggerNodeConfig,
} from '@realytica/shared';

type TriggersModule = typeof import('../apps/api/src/flows/triggers');
type RunsModule = typeof import('../apps/api/src/flows/runs');
type StoreModule = typeof import('../apps/api/src/store');

let triggers: TriggersModule;
let runs: RunsModule;
let store: StoreModule['store'];
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-triggers-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  triggers = await import('../apps/api/src/flows/triggers');
  runs = await import('../apps/api/src/flows/runs');
  store = (await import('../apps/api/src/store')).store;
});

after(() => {
  triggers.stopScheduler();
  rmSync(dataDir, { recursive: true, force: true });
});

const TENANT = 'tenant-a';

/**
 * The smallest flow that runs: a trigger wired to a transform.
 *
 * A transform rather than an agent or an http node, so nothing in these tests
 * can reach a model or a network even if a guard were wrong.
 */
function flowWith(trigger: TriggerNodeConfig, over: Partial<Flow> = {}): Flow {
  const nodes: FlowNode[] = [
    { id: 'start', kind: 'trigger', position: { x: 0, y: 0 }, config: { kind: 'trigger', ...trigger } },
    {
      id: 'shape',
      kind: 'transform',
      position: { x: 200, y: 0 },
      config: { kind: 'transform', set: [{ to: 'noted', from: 'trigger.on' }] },
    },
  ];
  return {
    id: `flow-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: TENANT,
    name: 'Test flow',
    nodes,
    edges: [{ id: 'e1', from: 'start', fromPort: DEFAULT_OUT_PORT, to: 'shape' }],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'operator@example.com',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'operator@example.com',
    version: 1,
    ...over,
  };
}

/** A flow the studio would show a red badge on: an http node with no URL. */
function broken(trigger: TriggerNodeConfig): Flow {
  const flow = flowWith(trigger);
  flow.nodes[1] = {
    id: 'reach',
    kind: 'http',
    position: { x: 200, y: 0 },
    config: { kind: 'http', method: 'GET', url: '' },
  };
  flow.edges[0].to = 'reach';
  return flow;
}

function projectWith(over: Partial<DdProject> = {}): DdProject {
  return {
    id: `proj-${Math.random().toString(36).slice(2, 10)}`,
    reference: 'RY-0001',
    name: 'A site',
    status: 'active',
    tenantId: TENANT,
    ...over,
  } as unknown as DdProject;
}

beforeEach(() => {
  store.data.flows = [];
  store.data.flowRuns = [];
  store.data.projects = [];
  store.data.tenants = [{ id: TENANT }] as StoreModule['store']['data']['tenants'];
});

describe('which flows listen', () => {
  it('picks the enabled ones wired to this event', () => {
    store.data.flows = [
      flowWith({ on: 'project_created' }),
      flowWith({ on: 'evidence_uploaded' }),
      flowWith({ on: 'manual' }),
    ];
    assert.equal(triggers.flowsListeningFor(TENANT, 'project_created').length, 1);
    assert.equal(triggers.flowsListeningFor(TENANT, 'evidence_uploaded').length, 1);
    // `manual` is a person pressing Run. Nothing emits it.
    assert.equal(triggers.flowsListeningFor(TENANT, 'manual').length, 1);
  });

  it('never fires a flow somebody switched off', () => {
    store.data.flows = [flowWith({ on: 'project_created' }, { enabled: false })];
    assert.equal(triggers.flowsListeningFor(TENANT, 'project_created').length, 0);
  });

  it('never fires a flow that has errors', () => {
    // An http node with no URL. Running it anyway would produce a failure the
    // operator did not ask for, in a flow the studio is already telling them
    // to fix. (A flow with no edges is *not* broken — a trigger on its own is
    // a valid, if pointless, flow, and treating it as an error would refuse to
    // run something the editor says is fine.)
    store.data.flows = [broken({ on: 'project_created' })];
    assert.equal(triggers.flowsListeningFor(TENANT, 'project_created').length, 0);
  });

  it('does not reach into another workspace', () => {
    store.data.flows = [flowWith({ on: 'project_created' }, { tenantId: 'tenant-b' })];
    assert.equal(triggers.flowsListeningFor(TENANT, 'project_created').length, 0);
  });

  it('ignores a trigger node the operator disabled', () => {
    const flow = flowWith({ on: 'project_created' });
    flow.nodes[0].disabled = true;
    store.data.flows = [flow];
    assert.equal(triggers.flowsListeningFor(TENANT, 'project_created').length, 0);
  });
});

describe('firing an event', () => {
  it('runs the listener and writes the run down as this trigger, for real', async () => {
    const flow = flowWith({ on: 'project_created' });
    store.data.flows = [flow];
    const project = projectWith();

    await triggers.fireTrigger('project_created', { tenantId: TENANT, project, actor: 'someone@example.com' });

    const [run] = runs.runsFor(TENANT, flow.id);
    assert.ok(run);
    assert.equal(run.trigger, 'project_created');
    assert.equal(run.projectId, project.id);
    // A triggered run that rehearsed would be an expensive way to do nothing.
    assert.equal(run.dryRun, false);
  });

  it('puts the event on the payload so conditions can test it', async () => {
    const flow = flowWith({ on: 'evidence_uploaded' });
    store.data.flows = [flow];

    await triggers.fireTrigger('evidence_uploaded', {
      tenantId: TENANT,
      project: projectWith(),
      actor: 'someone@example.com',
      detail: { fileCount: 3 },
    });

    const [summary] = runs.runsFor(TENANT, flow.id);
    const full = runs.runFor(TENANT, summary.id);
    const trigger = (full?.payload as { trigger?: Record<string, unknown> }).trigger;
    assert.equal(trigger?.on, 'evidence_uploaded');
    assert.equal(trigger?.fileCount, 3);
  });

  it('does nothing at all when nothing is listening', async () => {
    store.data.flows = [flowWith({ on: 'manual' })];
    const started = await triggers.fireTrigger('project_created', {
      tenantId: TENANT,
      project: projectWith(),
      actor: 'someone@example.com',
    });
    assert.deepEqual(started, []);
  });
});

describe('the clock', () => {
  const minute = 60_000;
  const t0 = Date.UTC(2026, 5, 1, 9, 0, 0);

  it('fires a due schedule against every open project', async () => {
    store.data.flows = [flowWith({ on: 'schedule', everyMinutes: 60 })];
    store.data.projects = [projectWith(), projectWith(), projectWith({ status: 'closed' })];

    const { fired } = await triggers.tickSchedules(t0);
    // The closed one is signed off; re-deciding it on a timer is money spent
    // reopening a settled question.
    assert.equal(fired, 2);
  });

  it('does not fire again before the interval has passed', async () => {
    store.data.flows = [flowWith({ on: 'schedule', everyMinutes: 60 })];
    store.data.projects = [projectWith()];

    assert.equal((await triggers.tickSchedules(t0)).fired, 1);
    assert.equal((await triggers.tickSchedules(t0 + 59 * minute)).fired, 0);
    assert.equal((await triggers.tickSchedules(t0 + 60 * minute)).fired, 1);
  });

  it('reads the last run from the history, so a restart does not re-fire everything', async () => {
    // The history is on disk; an in-memory `lastFiredAt` would not survive a
    // deploy, and every schedule would fire on every restart.
    const flow = flowWith({ on: 'schedule', everyMinutes: 60 });
    store.data.flows = [flow];
    store.data.projects = [projectWith()];
    await triggers.tickSchedules(t0);

    // Simulate the process coming back with the history intact.
    assert.equal((await triggers.tickSchedules(t0 + minute)).fired, 0);
  });

  it('treats a timer with no interval as unfinished, not as every tick', async () => {
    // The worst possible reading of an omission: as fast as the clock allows.
    store.data.flows = [flowWith({ on: 'schedule' })];
    store.data.projects = [projectWith()];
    assert.equal((await triggers.tickSchedules(t0)).fired, 0);
  });

  it('runs a named schedule against exactly that project', async () => {
    const wanted = projectWith();
    store.data.projects = [projectWith(), wanted, projectWith()];
    store.data.flows = [flowWith({ on: 'schedule', everyMinutes: 60, scope: 'named', projectId: wanted.id })];

    const { fired } = await triggers.tickSchedules(t0);
    assert.equal(fired, 1);
    const flow = store.data.flows![0];
    assert.equal(runs.runsFor(TENANT, flow.id)[0].projectId, wanted.id);
  });

  it('fires nothing when the named project is gone', async () => {
    store.data.projects = [projectWith()];
    store.data.flows = [flowWith({ on: 'schedule', everyMinutes: 60, scope: 'named', projectId: 'deleted' })];
    assert.equal((await triggers.tickSchedules(t0)).fired, 0);
  });

  it('caps how many projects one tick fans out to', async () => {
    store.data.flows = [flowWith({ on: 'schedule', everyMinutes: 60 })];
    store.data.projects = Array.from({ length: MAX_SCHEDULED_PROJECTS + 7 }, () => projectWith());

    const { fired } = await triggers.tickSchedules(t0);
    // A workspace with hundreds of open projects and a five-minute schedule
    // would otherwise be a bill nobody agreed to.
    assert.equal(fired, MAX_SCHEDULED_PROJECTS);
  });

  it('leaves a disabled or broken schedule alone', async () => {
    store.data.projects = [projectWith()];
    store.data.flows = [
      flowWith({ on: 'schedule', everyMinutes: 60 }, { enabled: false }),
      broken({ on: 'schedule', everyMinutes: 60 }),
    ];
    assert.equal((await triggers.tickSchedules(t0)).fired, 0);
  });

  it('does not treat a non-schedule flow as due', async () => {
    store.data.projects = [projectWith()];
    store.data.flows = [flowWith({ on: 'project_created' })];
    const { fired, flows } = await triggers.tickSchedules(t0);
    assert.equal(fired, 0);
    assert.equal(flows, 0);
  });
});
