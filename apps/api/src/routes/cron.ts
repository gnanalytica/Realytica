/**
 * The daily timer.
 *
 * GET /alerts   bring every project's alerts up to date, as of now
 *
 * Alerts are otherwise worked out when a project is saved, so a date that
 * came up on a day nobody touched the project raised nothing until somebody
 * did. Vercel calls this once a day (`crons` in `vercel.json`) and it does
 * for every project what a save does for one: raises what is new, resolves
 * what has cleared, and tells the people a new alert is for.
 *
 * It sits outside the sign-in gate, because the caller is the platform and
 * not a person, and behind its own: Vercel sends `Authorization: Bearer
 * <CRON_SECRET>` and nothing else is let in, a deployment with no secret set
 * included. Vercel may call twice for one day or miss a day, and does not
 * call again after a failure, so a run is safe to repeat: alerts are held by
 * the key of their condition, a project whose alerts have not moved is not
 * written, and one project failing leaves the rest of the run to finish.
 *
 * Moved means raised, resolved, or at another level. An alert's words count
 * the days left, so they differ every day; written for that alone, every
 * project with a date coming up would be saved daily, whole, over whatever
 * another instance wrote in between. The words are brought up to date by the
 * project's next save, and a reader is shown them as of the day they read.
 *
 * Every project is in this instance's memory already (`store.init`), so one
 * request goes through them all; each is re-read from storage first, one
 * small read a project. A project storage does not answer for is left out of
 * the run and counted as failed: the copy held here may be an old one.
 */

import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { syncAlerts, type DdProject, type ProjectAlert } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';

export const cronRouter = Router();

/** Whether a call carries the secret Vercel sends with a cron job. Never without a secret set. */
export function cronAuthorized(authorization: string | undefined, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = Buffer.from(authorization ?? '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** What a sweep reads projects from and writes them to: the store, or a stand-in under test. */
export interface SweepSource {
  ids(): string[];
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
  /**
   * Of these alert keys, the ones nobody has been told of on `day`, taken as
   * told from here on. Kept in storage, so a second run on the same day,
   * through this instance or another, tells nobody again.
   */
  claim(projectId: string, day: string, keys: string[]): Promise<string[]>;
  tell(project: DdProject, raised: ProjectAlert[]): Promise<void>;
}

/** Where a project keeps which alerts the timer told people of, and on which day. */
const TOLD_KEY = 'alerts-told.json';

const fromStore: SweepSource = {
  ids: () => (store.data.projects ?? []).map((project) => project.id),
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  },
  claim: async (projectId, day, keys) => {
    // Storage that cannot say who was told is taken to say nobody was: a warning sent twice costs less than one not sent.
    try {
      const bytes = await storageAdapter.getDocument(projectId, TOLD_KEY);
      const held = bytes ? (JSON.parse(bytes.toString('utf-8')) as { day?: string; keys?: string[] }) : {};
      const told = new Set(held.day === day ? (held.keys ?? []) : []);
      const fresh = keys.filter((key) => !told.has(key));
      if (fresh.length) await storageAdapter.putDocument(projectId, TOLD_KEY, Buffer.from(JSON.stringify({ day, keys: [...told, ...fresh] })), 'application/json');
      return fresh;
    } catch (err) {
      console.warn(`[cron] could not read who was told on ${projectId}: ${(err as Error).message}`);
      return keys;
    }
  },
  tell: async (project, raised) => (await import('../notify')).notifyRaised(project, raised),
};

export interface AlertSweep {
  projects: number;
  /** Projects whose alerts moved, and were written. */
  changed: number;
  raised: number;
  resolved: number;
  failed: number;
}

/** What the timer writes a project for: which alerts it holds, which are resolved, and each one's level. Not their words. */
function standing(alerts: readonly ProjectAlert[] | undefined): string {
  return JSON.stringify((alerts ?? []).map((alert) => [alert.key, Boolean(alert.resolvedAt), alert.severity, alert.title]));
}

/** Bring every project's alerts up to date as of `now`, writing only the projects whose alerts moved. */
export async function sweepAlerts(now: Date, source: SweepSource = fromStore): Promise<AlertSweep> {
  const out: AlertSweep = { projects: 0, changed: 0, raised: 0, resolved: 0, failed: 0 };
  for (const id of source.ids()) {
    out.projects += 1;
    try {
      const project = await source.fresh(id);
      if (!project) continue;
      const before = { alerts: structuredClone(project.alerts), updatedAt: project.updatedAt, health: project.health };
      const openBefore = (project.alerts ?? []).filter((alert) => !alert.resolvedAt).length;
      const raised = syncAlerts(project, now);
      if (standing(project.alerts) === standing(before.alerts)) {
        // Nothing moved: not the words of the day, and not even the empty list `syncAlerts` leaves on a project that had none.
        project.alerts = before.alerts;
        continue;
      }
      try {
        await source.save(project);
      } catch (err) {
        // As it was, so the next run finds the same alerts to raise and tells people then.
        Object.assign(project, before);
        throw err;
      }
      out.changed += 1;
      out.raised += raised.length;
      out.resolved += openBefore + raised.length - (project.alerts ?? []).filter((alert) => !alert.resolvedAt).length;
      if (raised.length) {
        const untold = new Set(await source.claim(project.id, now.toISOString().slice(0, 10), raised.map((alert) => alert.key)));
        const toTell = raised.filter((alert) => untold.has(alert.key));
        if (toTell.length) await source.tell(project, toTell);
      }
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] alerts on ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** The route's answer, apart from the wire: 401 without the secret, the counts with it. */
export async function alertsCron(authorization: string | undefined, now: Date, source?: SweepSource): Promise<{ status: number; body: AlertSweep | { error: string } }> {
  if (!cronAuthorized(authorization)) return { status: 401, body: { error: 'Unauthorized' } };
  return { status: 200, body: await sweepAlerts(now, source) };
}

cronRouter.get('/alerts', async (req, res) => {
  const { status, body } = await alertsCron(req.headers.authorization, new Date());
  if (status === 200) console.log(`[cron] alerts ${JSON.stringify(body)}`);
  res.status(status).json(body);
});
