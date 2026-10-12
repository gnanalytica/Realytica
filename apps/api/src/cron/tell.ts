/**
 * The timer's part in telling people: send what has waited long enough.
 *
 * A notice is written when a project is saved, and what leaves the app waits
 * a message's worth so that a drop of papers is one message a person. A save
 * sends what is due on the project it writes. A project nobody touches again
 * has nothing to send it, so the timer goes through every project and sends
 * what is due there.
 *
 * Safe to call twice: what is taken is marked taken and written before it is
 * sent, so a second run finds nothing, and the mail service is handed the
 * same key for the same message. A message that could not be sent has its
 * notices given back, and a run a message's worth later tries it again. One project failing is counted and leaves
 * the rest of the run to finish.
 */

import type { DdProject } from '@realytica/shared';
import { store } from '../store';
import { giveBackUnsent, sendTold, tellOut, tellPeople, type TellOut } from '../tell';

/** What a sweep reads projects from and writes them to: the store, or a stand-in under test. */
export interface TellSweepSource {
  ids(): string[];
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  due(project: DdProject, now: Date): TellOut[];
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
  send(project: DdProject, messages: TellOut[]): Promise<{ mailed: number; pushed: number; unsent?: string[] }>;
  /** Give back the notices of messages that could not be sent, so a later run tries them again. */
  giveBack?(project: DdProject, ids: string[], now: Date): Promise<void>;
}

const fromStore: TellSweepSource = {
  ids: () => (store.data.projects ?? []).map((project) => project.id),
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  due: (project, now) => tellOut(project, tellPeople(project), now),
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  },
  send: sendTold,
  giveBack: (project, ids, now) => giveBackUnsent(project.id, ids, now),
};

/** Send every message that is due as of `now`. Counts: projects looked at, people sent a message, notices in them, mail and push that went, projects that failed. */
export async function sweepTell(now: Date, source: TellSweepSource = fromStore): Promise<Record<string, number>> {
  const out = { projects: 0, messages: 0, notices: 0, mailed: 0, pushed: 0, failed: 0 };
  for (const id of source.ids()) {
    out.projects += 1;
    try {
      const project = await source.fresh(id);
      if (!project) continue;
      const before = structuredClone(project.tell);
      const due = source.due(project, now);
      if (!due.length) {
        project.tell = before;
        continue;
      }
      try {
        await source.save(project);
      } catch (err) {
        // As it was, so the next run finds the same notices due.
        project.tell = before;
        throw err;
      }
      const sent = await source.send(project, due);
      if (sent.unsent?.length) await source.giveBack?.(project, sent.unsent, now);
      out.messages += due.length;
      out.notices += due.reduce((n, message) => n + message.lines.length, 0);
      out.mailed += sent.mailed;
      out.pushed += sent.pushed;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cron] telling on ${id}: ${(err as Error).message}`);
    }
  }
  return out;
}
