/**
 * The timed routes run every job they hold, in turn.
 *
 * The jobs themselves are tested where they live. This is the part between
 * them: the order, one job failing or running long without stopping the
 * rest, a job passed over when the run has no time left for it, and each
 * job's counts answered under its own key. The daily route is called through
 * the app, with its real jobs, in `checklist-access.test.ts`.
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Cron = typeof import('../apps/api/src/routes/cron');
type TimedJob = import('../apps/api/src/routes/cron').TimedJob;

let cron: Cron;

const SECRET = 'a-secret-of-sixteen-or-more';
const BEARER = `Bearer ${SECRET}`;
const NOW = new Date('2026-10-20T01:30:00.000Z');
const SECOND = 1000;

before(async () => {
  process.env.REALYTICA_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'realytica-timed-'));
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.CRON_SECRET = SECRET;
  cron = await import('../apps/api/src/routes/cron');
});

/** Jobs that note the order they ran in. */
function noted(specs: Array<{ key: string; budgetMs?: number; run?: () => Promise<Record<string, number>> }>): { jobs: TimedJob[]; ran: string[] } {
  const ran: string[] = [];
  const jobs = specs.map(({ key, budgetMs = 10 * SECOND, run }) => ({
    key,
    budgetMs,
    run: async () => {
      ran.push(key);
      return run ? run() : { done: 1 };
    },
  }));
  return { jobs, ran };
}

describe('what each timer runs', () => {
  it('the daily run holds every job, alerts first and the two that ask a model last', () => {
    assert.deepEqual(cron.DAILY_JOBS.map((job) => job.key), ['alerts', 'periodsDue', 'tell', 'drive', 'reportDay', 'webhookRetry', 'lawWatch', 'fileSweep']);
  });

  it('the ten-minute run sends notices and retries webhooks; the hourly run reads the folders', () => {
    assert.deepEqual(cron.OFTEN_JOBS.map((job) => job.key), ['tell', 'webhookRetry']);
    assert.deepEqual(cron.HOURLY_JOBS.map((job) => job.key), ['drive']);
  });

  it('every job has a module under apps/api/src/cron or is the alert sweep, so none is left unwired', async () => {
    const files = (await readdir(path.join(process.cwd(), 'apps/api/src/cron'))).filter((name) => name.endsWith('.ts'));
    const source = await readFile(path.join(process.cwd(), 'apps/api/src/routes/cron.ts'), 'utf-8');
    for (const file of files) {
      assert.ok(source.includes(`'../cron/${file.replace(/\.ts$/, '')}'`), `${file} is called by no timed route`);
    }
  });

  it('a run fits inside the function’s limit with time to answer, even when every job takes all it may', async () => {
    const build = await readFile(path.join(process.cwd(), 'scripts/build-vercel-output.mjs'), 'utf-8');
    const limit = Number(/maxDuration:\s*(\d+)/.exec(build)?.[1]) * SECOND;
    assert.ok(limit > 0);
    for (const total of [cron.DAILY_BUDGET_MS, cron.OFTEN_BUDGET_MS, cron.HOURLY_BUDGET_MS]) assert.ok(total <= limit - 60 * SECOND);
    // The shorter runs never pass a job over.
    assert.ok(cron.OFTEN_JOBS.reduce((sum, job) => sum + job.budgetMs, 0) <= cron.OFTEN_BUDGET_MS);
    assert.ok(cron.HOURLY_JOBS.reduce((sum, job) => sum + job.budgetMs, 0) <= cron.HOURLY_BUDGET_MS);
    // On the daily run only the last job, the daily review, can be: everything before it fits whatever it takes.
    const beforeLast = cron.DAILY_JOBS.slice(0, -1).reduce((sum, job) => sum + job.budgetMs, 0);
    assert.ok(beforeLast <= cron.DAILY_BUDGET_MS);
    assert.equal(cron.DAILY_JOBS.at(-1)!.key, 'fileSweep');
  });

  it('vercel.json calls each timed route, each by a path of its own, and the build script declares none', async () => {
    const config = JSON.parse(await readFile(path.join(process.cwd(), 'vercel.json'), 'utf-8')) as { crons: Array<{ path: string; schedule: string }> };
    assert.deepEqual(config.crons.map((entry) => entry.path).sort(), ['/api/cron/alerts', '/api/cron/hourly', '/api/cron/often']);
    assert.equal(config.crons.find((entry) => entry.path === '/api/cron/alerts')!.schedule, '30 1 * * *');
    const build = await readFile(path.join(process.cwd(), 'scripts/build-vercel-output.mjs'), 'utf-8');
    assert.ok(!/crons\s*:/.test(build));
  });
});

describe('a timed run', () => {
  it('is refused without the secret, and runs nothing', async () => {
    const { jobs, ran } = noted([{ key: 'one' }]);
    for (const header of [undefined, '', 'Bearer ', 'Bearer wrong-secret-of-the-same-size', SECRET]) {
      assert.deepEqual(await cron.timedCron(header, NOW, jobs, 60 * SECOND), { status: 401, body: { error: 'Unauthorized' } });
    }
    assert.deepEqual(ran, []);
  });

  it('runs every job in order and answers each one’s counts under its own key', async () => {
    const { jobs, ran } = noted([
      { key: 'one', run: async () => ({ projects: 3, changed: 1 }) },
      { key: 'two', run: async () => ({ mailed: 2 }) },
      { key: 'three', run: async () => ({ swept: 0, noModel: 1 }) },
    ]);
    const answer = await cron.timedCron(BEARER, NOW, jobs, 60 * SECOND);
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { one: { projects: 3, changed: 1 }, two: { mailed: 2 }, three: { swept: 0, noModel: 1 } });
    assert.deepEqual(ran, ['one', 'two', 'three']);
  });

  it('hands each job the time it was given and the same moment', async () => {
    const seen: Array<[string, number]> = [];
    const job: TimedJob = { key: 'one', budgetMs: 7 * SECOND, run: async (now, budgetMs) => (seen.push([now.toISOString(), budgetMs]), {}) };
    await cron.runTimed(NOW, [job], 60 * SECOND);
    assert.deepEqual(seen, [[NOW.toISOString(), 7 * SECOND]]);
  });

  it('goes on after a job that throws, and says what it threw', async () => {
    const { jobs, ran } = noted([
      { key: 'one' },
      {
        key: 'two',
        run: async () => {
          throw new Error('storage did not answer');
        },
      },
      { key: 'three' },
    ]);
    const out = await cron.runTimed(NOW, jobs, 60 * SECOND);
    assert.deepEqual(out, { one: { done: 1 }, two: { error: 'storage did not answer' }, three: { done: 1 } });
    assert.deepEqual(ran, ['one', 'two', 'three']);
  });

  it('goes on after a job that throws before it has started waiting', async () => {
    const jobs: TimedJob[] = [
      {
        key: 'one',
        budgetMs: SECOND,
        run: () => {
          throw new Error('could not start');
        },
      },
      { key: 'two', budgetMs: SECOND, run: async () => ({ done: 1 }) },
    ];
    assert.deepEqual(await cron.runTimed(NOW, jobs, 60 * SECOND), { one: { error: 'could not start' }, two: { done: 1 } });
  });

  it('leaves behind a job that outlasts its time, and starts the next', async () => {
    let finish: () => void = () => undefined;
    const { jobs, ran } = noted([
      { key: 'slow', budgetMs: 30, run: () => new Promise<Record<string, number>>((resolve) => (finish = () => resolve({ late: 1 }))) },
      { key: 'next' },
    ]);
    const out = await cron.runTimed(NOW, jobs, 60 * SECOND);
    finish();
    assert.deepEqual(Object.keys(out), ['slow', 'next']);
    assert.match((out.slow as { error: string }).error, /longer than its/);
    assert.deepEqual(out.next, { done: 1 });
    assert.deepEqual(ran, ['slow', 'next']);
  });

  it('does not start a job the run has no time left for, says so, and still runs a later one that fits', async () => {
    // A clock the first job moves on by 50 s.
    let at = 0;
    const { jobs, ran } = noted([
      { key: 'first', budgetMs: 50 * SECOND, run: async () => ((at += 50 * SECOND), { done: 1 }) },
      { key: 'long', budgetMs: 40 * SECOND },
      { key: 'short', budgetMs: 5 * SECOND },
    ]);
    const out = await cron.runTimed(NOW, jobs, 60 * SECOND, () => at);
    assert.deepEqual(ran, ['first', 'short']);
    assert.deepEqual(out.first, { done: 1 });
    assert.match((out.long as { notRun: string }).notRun, /needs 40 s and 10 s were left/);
    assert.deepEqual(out.short, { done: 1 });
  });
});
