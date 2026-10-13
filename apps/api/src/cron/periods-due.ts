/**
 * The timer's part in saying a period is due.
 *
 * A set kept by period asks for its latest period that has ended and is not
 * issued. The page says so to whoever opens it, and the report day's notice
 * says so where a project has set a report day. This run says so to the
 * people whose it is to issue, whether or not a report day is set: for each
 * project it writes a notice for each period that is due and each of those
 * people (`gatherPeriodsDue` in the shared package), and the notices leave
 * the app as every notice does, in the next message a person is sent.
 *
 * Safe to run twice. A notice is held by its set, its period and the person
 * it is for, so a second run on the day, or on any later day, writes
 * nothing for a period already told. A project that owes nothing is not
 * written. One project failing is counted and leaves the rest to run. It
 * never throws.
 */

import { gatherPeriodsDue, type DdProject, type TellPerson } from '@realytica/shared';
import { store } from '../store';
import { tellPeople } from '../tell';

/** What a run reads projects from and writes them to: the store, or a stand-in under test. */
export interface PeriodsDueSource {
  ids(): string[];
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** Who could be told on a project. */
  people(project: DdProject): TellPerson[];
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
}

const fromStore: PeriodsDueSource = {
  ids: () => (store.data.projects ?? []).map((project) => project.id),
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  people: tellPeople,
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  },
};

/** Write a notice for every period that is due as of `now`. Counts: projects looked at, projects with a period newly told, notices written, projects that failed. */
export async function periodsDueSweep(now: Date, source: PeriodsDueSource = fromStore): Promise<Record<string, number>> {
  const out = { projects: 0, told: 0, notices: 0, failed: 0 };
  let ids: string[] = [];
  try {
    ids = source.ids();
  } catch (err) {
    console.warn(`[cron] periods due could not list projects: ${(err as Error).message}`);
    return { ...out, failed: 1 };
  }
  for (const id of ids) {
    try {
      const project = await source.fresh(id);
      if (!project) continue;
      out.projects += 1;
      // As it was, so a write that fails leaves this copy saying what storage says, and the next run writes the same notices.
      const before = structuredClone(project.tell);
      const written = gatherPeriodsDue(project, source.people(project), now);
      if (!written.length) continue;
      try {
        await source.save(project);
      } catch (err) {
        project.tell = before;
        throw err;
      }
      out.told += 1;
      out.notices += written.length;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] periods due on ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}
