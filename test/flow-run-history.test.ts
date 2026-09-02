/**
 * Keeping what happened when a flow ran.
 *
 * The behaviour worth testing is the retention rule, because it is the one
 * that is silently wrong in the obvious implementation. A single global cap
 * looks equivalent and is not: a flow on a five-minute schedule will evict the
 * entire history of a flow that runs once a week, and the weekly one is
 * exactly the history somebody wants when it eventually breaks.
 *
 * Also asserted: the workspace boundary, because a run record names a project
 * and an actor, and the summary shape, because a list screen that had to ship
 * fifty payloads to draw fifty dates would be worse than no history at all.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FlowRunResult, TriggerOn } from '@realytica/shared';

/*
 * Imported dynamically, and only after the data directory is pointed at a
 * temporary one. `store.ts` reaches its storage adapter through a top-level
 * await, so a static import would both resolve the adapter before the
 * environment is set and force the file into a module format tsx cannot
 * transform. Every other test that touches the API store does the same.
 */
type RunsModule = typeof import('../apps/api/src/flows/runs');
type StoreModule = typeof import('../apps/api/src/store');

let runs: RunsModule;
let store: StoreModule['store'];
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-runs-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  runs = await import('../apps/api/src/flows/runs');
  store = (await import('../apps/api/src/store')).store;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

let clock = 0;

function resultFor(flowId: string, over: Partial<FlowRunResult> = {}): FlowRunResult {
  // A monotonic clock so ordering assertions are about the code, not the
  // resolution of Date.now() inside a fast loop.
  const startedAt = new Date(Date.UTC(2026, 0, 1) + clock++ * 60_000).toISOString();
  return {
    flowId,
    flowVersion: 1,
    startedAt,
    finishedAt: startedAt,
    status: 'ok',
    steps: [{ nodeId: 'n1', kind: 'trigger', label: 'Start', status: 'ok', at: startedAt, durationMs: 1 }],
    payload: { project: { id: 'p1' } },
    proposals: [],
    ...over,
  };
}

function record(flowId: string, over: Partial<Parameters<RunsModule['recordRun']>[0]> = {}) {
  return runs.recordRun({
    result: resultFor(flowId),
    tenantId: 'tenant-a',
    projectId: 'p1',
    dryRun: true,
    startedBy: 'operator@example.com',
    trigger: 'manual' as TriggerOn,
    ...over,
  });
}

beforeEach(() => {
  store.data.flowRuns = [];
  clock = 0;
});

describe('writing a run down', () => {
  it('keeps the facts that cannot be reconstructed afterwards', async () => {
    const saved = await record('flow-1', { trigger: 'schedule', startedBy: 'schedule', dryRun: false });
    const read = runs.runFor('tenant-a', saved.id);
    assert.ok(read);
    // Without these, a three-in-the-morning run and a mis-click are the same
    // row, which makes the history useless for the only question it is asked.
    assert.equal(read.trigger, 'schedule');
    assert.equal(read.startedBy, 'schedule');
    assert.equal(read.dryRun, false);
    assert.equal(read.projectId, 'p1');
  });

  it('lists newest first, whatever order they were written in', async () => {
    await record('flow-1');
    await record('flow-1');
    await record('flow-1');
    const listed = runs.runsFor('tenant-a', 'flow-1');
    assert.equal(listed.length, 3);
    assert.ok(listed[0].startedAt > listed[1].startedAt);
    assert.ok(listed[1].startedAt > listed[2].startedAt);
  });

  it('summarises rather than shipping the whole run to a list', async () => {
    await record('flow-1', {
      result: resultFor('flow-1', {
        steps: [
          { nodeId: 'a', kind: 'trigger', label: 'Start', status: 'ok', at: '2026-01-01T00:00:00.000Z', durationMs: 1 },
          { nodeId: 'b', kind: 'http', label: 'Fetch', status: 'failed', at: '2026-01-01T00:00:01.000Z', durationMs: 2 },
        ],
        proposals: [{ nodeId: 'c', draft: 'finding', title: 'Something' }],
      }),
    });
    const [summary] = runs.runsFor('tenant-a', 'flow-1');
    assert.equal(summary.stepCount, 2);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.proposalCount, 1);
    // The bulky parts are the whole reason a summary exists.
    assert.equal('steps' in summary, false);
    assert.equal('payload' in summary, false);
  });
});

describe('retention, per flow', () => {
  it('keeps the cap for one flow', async () => {
    for (let i = 0; i < runs.RUNS_KEPT_PER_FLOW + 12; i += 1) await record('busy');
    assert.equal(runs.runsFor('tenant-a', 'busy').length, runs.RUNS_KEPT_PER_FLOW);
  });

  it('drops the oldest, not the newest', async () => {
    for (let i = 0; i < runs.RUNS_KEPT_PER_FLOW + 3; i += 1) await record('busy');
    const kept = runs.runsFor('tenant-a', 'busy');
    const oldestKept = kept[kept.length - 1].startedAt;
    // The three earliest are gone; everything after them survived.
    assert.ok(oldestKept > new Date(Date.UTC(2026, 0, 1) + 2 * 60_000).toISOString());
  });

  it('never lets a busy flow evict a quiet one', async () => {
    // The bug a global cap has. The weekly flow's single run is exactly the
    // history somebody wants when it breaks a month from now.
    await record('weekly');
    for (let i = 0; i < runs.RUNS_KEPT_PER_FLOW * 2; i += 1) await record('every-five-minutes');

    assert.equal(runs.runsFor('tenant-a', 'weekly').length, 1);
    assert.equal(runs.runsFor('tenant-a', 'every-five-minutes').length, runs.RUNS_KEPT_PER_FLOW);
  });
});

describe('one workspace cannot read another one’s runs', () => {
  it('filters the list by workspace', async () => {
    await record('shared-id', { tenantId: 'tenant-a' });
    await record('shared-id', { tenantId: 'tenant-b' });
    assert.equal(runs.runsFor('tenant-a', 'shared-id').length, 1);
    assert.equal(runs.runsFor('tenant-b', 'shared-id').length, 1);
  });

  it('refuses a run by id from another workspace', async () => {
    const theirs = await record('flow-1', { tenantId: 'tenant-b' });
    // Undefined, which the route turns into a 404 — not a 403, which would
    // confirm the id exists.
    assert.equal(runs.runFor('tenant-a', theirs.id), undefined);
    assert.ok(runs.runFor('tenant-b', theirs.id));
  });
});

describe('the latest run of each flow', () => {
  it('picks the most recent per flow in one pass', async () => {
    await record('flow-1');
    await record('flow-2');
    const newest = await record('flow-1');

    const latest = runs.latestRunPerFlow('tenant-a', ['flow-1', 'flow-2', 'flow-3']);
    assert.equal(latest['flow-1'].id, newest.id);
    assert.ok(latest['flow-2']);
    // A flow that has never run has no entry rather than a fabricated one.
    assert.equal('flow-3' in latest, false);
  });

  it('does not reach across workspaces', async () => {
    await record('flow-1', { tenantId: 'tenant-b' });
    assert.deepEqual(runs.latestRunPerFlow('tenant-a', ['flow-1']), {});
  });
});

describe('deleting a flow', () => {
  it('forgets its runs, and only its runs', async () => {
    await record('doomed');
    await record('doomed');
    await record('survivor');

    await runs.forgetRuns(['doomed']);
    assert.equal(runs.runsFor('tenant-a', 'doomed').length, 0);
    assert.equal(runs.runsFor('tenant-a', 'survivor').length, 1);
  });

  it('is a no-op for a flow with no runs', async () => {
    await record('survivor');
    await runs.forgetRuns(['never-ran']);
    assert.equal(runs.runsFor('tenant-a', 'survivor').length, 1);
  });
});
