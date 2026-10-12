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
 * Every project is in this instance's memory already (`store.init`), so one
 * request goes through them all; each is re-read from storage first, one
 * small read a project.
 */

import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { syncAlerts, type DdProject, type ProjectAlert } from '@realytica/shared';
import { store } from '../store';

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
  /** The project as storage has it now. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
  tell(project: DdProject, raised: ProjectAlert[]): Promise<void>;
}

const fromStore: SweepSource = {
  ids: () => (store.data.projects ?? []).map((project) => project.id),
  fresh: async (id) => {
    await store.syncProject(id, { force: true });
    return store.data.projects?.find((project) => project.id === id);
  },
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
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
      if (JSON.stringify(project.alerts ?? []) === JSON.stringify(before.alerts ?? [])) {
        // Nothing moved: not even the empty list `syncAlerts` leaves on a project that had none.
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
      if (raised.length) await source.tell(project, raised);
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
