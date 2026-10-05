/**
 * Keeping the stored graph level with the project store.
 *
 * The projection is cheap and pure, so the question is only WHEN to run it
 * and FOR WHAT. The project store says for what: it is the only thing that
 * knows which copy of each project this instance holds. It offers the copies
 * it has written, at once, and the copies it has read, when nothing is
 * waiting, each with the revision that copy was written under. The graph
 * store refuses a copy older than the one it holds and writes nothing for a
 * copy it has already drawn; see `types.ts`. So an instance holding an old
 * copy cannot put it over a newer graph, and a graph left behind is caught
 * up by the next instance that reads the project: after a sync that was lost
 * with its instance, an outage, or new code that draws the same record
 * differently.
 *
 * A project deleted from the store must not leave its graph behind: it holds
 * owner names and document titles, and "deleted" has to mean deleted. Which
 * projects are gone is also the project store's to say. Working it out here
 * from the projects handed over would purge every project that was not.
 *
 * A save waits for this, for the same reason it waits for its own write: on
 * serverless the process can be frozen the moment a response is sent. But
 * not for long. The graph is an index over data that is already durable in
 * the project store, so a graph store that is slow, unreachable or failing
 * must not fail a save or hold one. When the wait runs out no further call
 * is started. The call in flight is not abandoned: the platform is told the
 * work is still this request's, it runs on after the reply, and what became
 * of it is still reported to the project store. Whatever was not taken stays
 * owed and is offered again. A failure is logged, because a graph quietly
 * months out of date is worse than one obviously missing.
 *
 * A preview deployment stores no graph (see `preview.ts`), so none is built
 * for it: the projection would be worked out and handed to a store that
 * drops it. Dropping a deleted project's graph is the one write a preview
 * makes, and it goes through here like any other.
 *
 * This used to take a `cases` array too and project a second graph family from
 * it. That array is always empty — no mounted route creates a `PropertyCase`
 * and the demo reset clears it outright — so the loop ran over nothing on
 * every save while making the case graph look persisted. It is gone; see
 * `types.ts` for what replaced it.
 */

import { buildProjectGraph, type DdProject } from '@realytica/shared';
import { finishAfterReply } from '../runs/background';
import { graphAdapter } from './index';
import type { GraphAdapter, GraphSyncRefused } from './types';

/**
 * How long anything waits on the graph store, and how long one run goes on
 * starting calls to it: across every call of the run, not for each.
 */
export const GRAPH_WAIT_MS = 2_000;

/** A copy of a project the graph store is owed, and the revision to offer it at. */
export interface OwedGraph {
  project: DdProject;
  revision: number;
}

/**
 * How the project store hears what became of what it offered.
 *
 * Told as each answer lands, which for a call that outlives the wait is
 * after the run has stopped being waited for.
 */
export interface GraphSettlement {
  /** The graph store holds this copy's graph, or a later copy's. `builtAt` is the copy's `updatedAt` as it was drawn. */
  synced(owed: OwedGraph, builtAt: string): void;
  /** The graph store holds nothing more for this project. */
  purged(projectId: string): void;
  /**
   * The graph store turned the copy away: what it holds was built from a
   * later revision. Answers the revision to offer the same copy at instead,
   * when the project store still holds this copy and so the later revision
   * can only be of one it no longer has. Otherwise answers nothing, and the
   * refusal stands.
   */
  refused(owed: OwedGraph, answer: GraphSyncRefused): Promise<number | undefined>;
}

/** One pass over what the graph store is owed. Neither promise rejects. */
export interface GraphSyncRun {
  /** Settles when every call has answered or the wait has run out, whichever is first. True when it was the answers. */
  waited: Promise<boolean>;
  /** Settles when the last call started has answered, which may be after the wait. True when no call failed. */
  finished: Promise<boolean>;
}

const SETTLED: GraphSyncRun = { waited: Promise.resolve(true), finished: Promise.resolve(true) };

/**
 * Offer the graph store the copies it is owed, and drop the projects that
 * have gone.
 *
 * `adapter` is this deployment's store unless a caller names another, which
 * is how the loop is tested.
 */
export function syncGraph(owed: OwedGraph[], gone: string[], settle: GraphSettlement, adapter: GraphAdapter = graphAdapter): GraphSyncRun {
  if (adapter.detached) {
    // A store that keeps no graph is owed none.
    for (const item of owed) settle.synced(item, item.project.updatedAt);
    owed = [];
  }
  if (owed.length === 0 && gone.length === 0) return SETTLED;

  let waiting = true;
  let answered = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      waiting = false;
      resolve(false);
    }, GRAPH_WAIT_MS);
  });

  const offer = async ({ project, revision }: OwedGraph): Promise<void> => {
    const built = buildProjectGraph(project);
    const snapshot = { projectId: project.id, builtAt: project.updatedAt, nodes: built.nodes, edges: built.edges };
    const answer = await adapter.syncProject({ ...snapshot, revision });
    if (!answer) {
      settle.synced({ project, revision }, snapshot.builtAt);
      return;
    }
    const above = await settle.refused({ project, revision }, answer);
    if (above === undefined) {
      // Turned away is settled: the store holds a newer copy's graph, and
      // offering this one again would only be turned away again.
      if (!answer.drawn) {
        console.warn(`[graph] kept the stored graph of ${project.id}: it was built from revision ${answer.held}, and this copy is revision ${revision}`);
      }
      settle.synced({ project, revision }, snapshot.builtAt);
      return;
    }
    // Owed at the higher revision now; offered at it in this run if there is still time.
    if (!waiting) return;
    if (await adapter.syncProject({ ...snapshot, revision: above })) {
      console.warn(`[graph] kept the stored graph of ${project.id}: another copy was drawn while this one was offered again`);
    }
    settle.synced({ project, revision: above }, snapshot.builtAt);
  };

  const finished = (async (): Promise<boolean> => {
    try {
      for (const item of owed) {
        if (!waiting) break;
        try {
          await offer(item);
        } catch (err) {
          answered = false;
          console.warn(`[graph] could not sync project ${item.project.id}: ${(err as Error).message}`);
        }
      }
      for (const projectId of gone) {
        if (!waiting) break;
        try {
          await adapter.purgeProject(projectId);
          settle.purged(projectId);
        } catch (err) {
          answered = false;
          console.warn(`[graph] could not purge project ${projectId}: ${(err as Error).message}`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return answered;
  })();

  finishAfterReply(finished);
  return { waited: Promise.race([finished.then(() => true as const), gaveUp]), finished };
}
