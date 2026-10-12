/**
 * The daily timer: who may call it, that calling it twice is calling it
 * once, that one project failing leaves the rest of the run to finish, and
 * that it writes only the projects whose alerts moved. Then the same against
 * the real store, with a project saved before milestones had planned starts,
 * baselines or readings, which has to load as it was written.
 *
 * Every project, activity and date is invented.
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addMilestones, alertConditions, createProject, progressSummary, scheduleWatch, syncAlerts, type DdProject, type ProjectAlert } from '@realytica/shared';

type Cron = typeof import('../apps/api/src/routes/cron');
type StoreModule = typeof import('../apps/api/src/store');
let cron: Cron;
let Store: StoreModule['Store'];
let store: StoreModule['store'];

const PM = 'pm@example.com';
const SECRET = 'a-secret-of-sixteen-or-more';
const BEARER = `Bearer ${SECRET}`;
const day = (d: string) => new Date(`${d}T01:30:00.000Z`);

before(async () => {
  process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-cron-'));
  process.env.REALYTICA_AUTH_MODE = 'off';
  delete process.env.CRON_SECRET;
  cron = await import('../apps/api/src/routes/cron');
  ({ Store, store } = await import('../apps/api/src/store'));
});

/** A project whose one milestone is behind from 17 October 2026 and late from 1 November, its alerts up to date as of the 16th. */
function behindProject(reference: string): DdProject {
  const p = createProject({ name: `Lakeview ${reference}`, type: 'residential', location: 'Lakeview', city: 'Mysuru' }, reference);
  const [m] = addMilestones(p, [{ name: 'Plinth', weight: 5, plannedFinish: '2026-10-31' }], PM);
  m!.plannedStart = '2026-10-01';
  m!.percent = 20;
  syncAlerts(p, day('2026-10-16'));
  return p;
}

/** A stand-in for the store that counts what it is asked to write. */
function source(projects: DdProject[], failing: string[] = []) {
  const saved: string[] = [];
  const told: Array<{ id: string; keys: string[] }> = [];
  const sweepSource: import('../apps/api/src/routes/cron').SweepSource = {
    ids: () => projects.map((p) => p.id),
    fresh: async (id) => projects.find((p) => p.id === id),
    save: async (project) => {
      if (failing.includes(project.id)) throw new Error('storage did not answer');
      saved.push(project.id);
    },
    tell: async (project, raised: ProjectAlert[]) => void told.push({ id: project.id, keys: raised.map((a) => a.key).filter((key) => key.startsWith('slip:')) }),
  };
  return { sweepSource, saved, told };
}

describe('who may call the timer', () => {
  it('nobody, on a deployment with no secret set', async () => {
    delete process.env.CRON_SECRET;
    const { sweepSource, saved } = source([behindProject('RYT-C01')]);
    for (const header of [undefined, '', 'Bearer ', 'Bearer undefined', BEARER]) {
      assert.deepEqual(await cron.alertsCron(header, day('2026-10-20'), sweepSource), { status: 401, body: { error: 'Unauthorized' } });
    }
    assert.deepEqual(saved, []);
  });

  it('only a call that carries the secret as Vercel sends it', async () => {
    process.env.CRON_SECRET = SECRET;
    const { sweepSource, saved } = source([behindProject('RYT-C02')]);
    for (const header of [undefined, '', SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`, 'Bearer wrong-secret-of-the-same-size']) {
      assert.equal((await cron.alertsCron(header, day('2026-10-20'), sweepSource)).status, 401, String(header));
    }
    assert.deepEqual(saved, [], 'a refused call does no work');
    assert.equal((await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource)).status, 200);
    assert.equal(saved.length, 1);
  });
});

describe('a run of the timer', () => {
  before(() => {
    process.env.CRON_SECRET = SECRET;
  });

  it('raises what the day brings, tells people once, and returns counts', async () => {
    const quiet = createProject({ name: 'Hillside', type: 'residential', location: 'Hillside', city: 'Mysuru' }, 'RYT-C03');
    // Up to date already, as a project is after any save.
    syncAlerts(quiet, day('2026-10-19'));
    const behind = behindProject('RYT-C04');
    const { sweepSource, saved, told } = source([quiet, behind]);

    const first = await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource);
    assert.deepEqual(first, { status: 200, body: { projects: 2, changed: 1, raised: 1, resolved: 0, failed: 0 } });
    assert.deepEqual(saved, [behind.id], 'only the project whose alerts moved is written');
    assert.deepEqual(told, [{ id: behind.id, keys: [`slip:${behind.milestones![0]!.id}:2026-10-31`] }]);
  });

  it('called twice for one day does the work once', async () => {
    const behind = behindProject('RYT-C05');
    const { sweepSource, saved, told } = source([behind]);
    await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource);
    const alerts = JSON.stringify(behind.alerts);
    const again = await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource);
    assert.deepEqual(again.body, { projects: 1, changed: 0, raised: 0, resolved: 0, failed: 0 });
    assert.equal(saved.length, 1);
    assert.equal(told.length, 1);
    assert.equal(JSON.stringify(behind.alerts), alerts);
  });

  it('the next day rewords the alert it holds and raises no second one', async () => {
    const behind = behindProject('RYT-C06');
    const { sweepSource, saved, told } = source([behind]);
    await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource);
    const next = await cron.alertsCron(BEARER, day('2026-10-21'), sweepSource);
    assert.deepEqual(next.body, { projects: 1, changed: 1, raised: 0, resolved: 0, failed: 0 });
    assert.equal(saved.length, 2);
    assert.equal(told.length, 1, 'nobody is told a second time');
    const held = behind.alerts!.filter((a) => a.key.startsWith('slip:'));
    assert.equal(held.length, 1);
    assert.equal(held[0]!.detail, 'Due in 10 days, 20% done, expected 67%.');
  });

  it('counts what has cleared', async () => {
    const behind = behindProject('RYT-C07');
    const { sweepSource } = source([behind]);
    await cron.alertsCron(BEARER, day('2026-10-20'), sweepSource);
    behind.milestones![0]!.percent = 100;
    const after = await cron.alertsCron(BEARER, day('2026-10-21'), sweepSource);
    assert.deepEqual(after.body, { projects: 1, changed: 1, raised: 0, resolved: 1, failed: 0 });
  });

  it('goes on past a project that fails, and leaves that one as it was for the next run', async () => {
    const [a, b, c] = [behindProject('RYT-C08'), behindProject('RYT-C09'), behindProject('RYT-C10')];
    const was = structuredClone({ alerts: b!.alerts, updatedAt: b!.updatedAt });
    const failing = source([a!, b!, c!], [b!.id]);
    const run = await cron.alertsCron(BEARER, day('2026-10-20'), failing.sweepSource);
    assert.equal(run.status, 200);
    assert.deepEqual(run.body, { projects: 3, changed: 2, raised: 2, resolved: 0, failed: 1 });
    assert.deepEqual(failing.saved, [a!.id, c!.id]);
    assert.deepEqual({ alerts: b!.alerts, updatedAt: b!.updatedAt }, was);
    assert.deepEqual(failing.told.map((t) => t.id), [a!.id, c!.id], 'nobody is told of an alert that was not written');

    // Storage answers again: the next run raises it and tells people then.
    const mended = source([a!, b!, c!]);
    assert.deepEqual((await cron.alertsCron(BEARER, day('2026-10-20'), mended.sweepSource)).body, { projects: 3, changed: 1, raised: 1, resolved: 0, failed: 0 });
    assert.deepEqual(mended.told.map((t) => t.id), [b!.id]);
  });
});

describe('against the store', () => {
  /** A milestone as it was written before planned starts, baselines and readings: these keys and no others. */
  const OLD_MILESTONES = [
    { id: 'mil_old_1', name: 'Plinth', weight: 5, plannedFinish: '2026-09-30', percent: 60, updatedAt: '2026-09-01T05:00:00.000Z', updatedBy: PM },
    { id: 'mil_old_2', name: 'Frame', weight: 30, percent: 0, updatedAt: '2026-09-01T05:00:00.000Z', updatedBy: PM },
    { id: 'mil_old_3', name: 'Excavation', weight: 5, plannedFinish: '2026-08-15', percent: 100, completedOn: '2026-08-14', updatedAt: '2026-08-14T05:00:00.000Z', updatedBy: PM },
  ];

  it('a project saved before this change loads as it was written, and reads without its new fields', async () => {
    const old = createProject({ name: 'Riverside', type: 'residential', location: 'Riverside', city: 'Mysuru' }, 'RYT-C11');
    old.milestones = structuredClone(OLD_MILESTONES);
    const writer = new Store();
    await writer.init();
    writer.data.projects = [old];
    await writer.save();

    const reader = new Store();
    await reader.init();
    const loaded = reader.data.projects!.find((p) => p.id === old.id)!;
    assert.deepEqual(loaded.milestones, OLD_MILESTONES, 'nothing is added to a stored milestone by loading it');

    const now = day('2026-10-12');
    const watch = scheduleWatch(loaded, now);
    assert.deepEqual(watch.milestones.map((m) => [m.name, m.level, m.expectedPercent, m.projectedFinish]), [
      ['Plinth', 'late', undefined, undefined],
      ['Frame', undefined, undefined, undefined],
      ['Excavation', undefined, undefined, undefined],
    ]);
    assert.deepEqual({ planned: watch.plannedCompletion, extension: watch.extensionLikely }, { planned: '2026-09-30', extension: true });
    assert.deepEqual(progressSummary(loaded, now).late, [{ name: 'Plinth', plannedFinish: '2026-09-30', percent: 60 }]);
    assert.ok(alertConditions(loaded, now).some((c) => c.key === 'late:Plinth:2026-09-30'), 'the late alert keeps the key it always had');
  });

  it('the timer writes a project whose alerts moved, once, and leaves the rest unwritten', async () => {
    process.env.CRON_SECRET = SECRET;
    const today = new Date();
    const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const quiet = createProject({ name: 'Hillside', type: 'residential', location: 'Hillside', city: 'Mysuru' }, 'RYT-C12');
    const due = createProject({ name: 'Lakeview', type: 'residential', location: 'Lakeview', city: 'Mysuru' }, 'RYT-C13');
    await store.init();
    store.data.projects!.push(quiet, due);
    await store.save();
    // Put on the held copy with no save, so its alert is not raised yet: what a date coming up looks like to the timer.
    due.milestones = [{ id: 'mil_due', name: 'Plinth', weight: 5, plannedFinish: inDays(5), percent: 10, updatedAt: due.updatedAt, updatedBy: PM }];
    const saved = { quiet: quiet.updatedAt, due: due.updatedAt };

    const first = await cron.alertsCron(BEARER, today);
    assert.deepEqual(first, { status: 200, body: { projects: 3, changed: 1, raised: 1, resolved: 0, failed: 0 } });
    assert.equal(quiet.updatedAt, saved.quiet);
    assert.notEqual(due.updatedAt, saved.due);

    const written = new Store();
    await written.init();
    const stored = written.data.projects!.find((p) => p.id === due.id)!;
    assert.deepEqual(stored.alerts!.filter((a) => a.key.startsWith('slip:')).map((a) => a.detail), ['Due in 5 days, 10% done, expected 80% or more.']);

    const at = due.updatedAt;
    const second = await cron.alertsCron(BEARER, today);
    assert.deepEqual(second.body, { projects: 3, changed: 0, raised: 0, resolved: 0, failed: 0 });
    assert.equal(due.updatedAt, at, 'a second call writes nothing');
  });
});
