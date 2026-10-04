/**
 * A preview deployment and the graph store.
 *
 * A preview runs a branch's code against the live site's data: the same
 * project store and the same graph store. Sharing the project record is safe,
 * because both sides read and write one shape. The graph is not a record. It
 * is a projection of one, and a branch that changes the projection would
 * rewrite every project's stored graph in its own shape on its first save;
 * the live site would then write it back in its own. Derived nodes survive
 * that. A note does not: it is pinned to a node by id, a node only one side
 * draws is deleted by the other side's sync, and the note's link goes with it
 * for good.
 *
 * So a preview keeps no graph. It writes nothing, and every read answers
 * "not indexed", which each caller already treats as "use the live
 * registers". What a preview shows is therefore its own projection of the
 * record, which is also the only graph its own code is sure to understand.
 *
 * Deleting a project is the one write that goes through. The record leaves
 * the shared project store, so its graph has to leave the shared graph store
 * too: it holds owner names and document titles.
 */

import type { GraphAdapter } from './types';

/** Vercel names the kind of deployment; anything else, a server or a laptop, is not a preview. */
export function isPreviewDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === 'preview';
}

export const PREVIEW_KEEPS_NO_GRAPH = 'A preview keeps no graph of its own, so a note cannot be saved here. Write it on the live site.';

/**
 * What a graph answer on this deployment is read from, for the responses that
 * name it: the store, or `projection` on a preview.
 *
 * A preview is handed the live site's store and reads nothing from it, so
 * naming the store there says the answer came from Neo4j when it was built
 * from the registers a moment ago. Health and the graph routes say the same
 * word, the one the impact route already answers with when its walk ran over
 * the registers.
 */
export function graphAnsweredBy(adapter: GraphAdapter): GraphAdapter['kind'] | 'projection' {
  return adapter.detached ? 'projection' : adapter.kind;
}

/** The same store, with every write but a purge refused and every read unanswered. */
export function detached(store: GraphAdapter): GraphAdapter {
  return {
    kind: store.kind,
    detached: true,
    async syncProject() {},
    async appendProject() {
      throw new Error(PREVIEW_KEEPS_NO_GRAPH);
    },
    async readProject() {
      return null;
    },
    async neighbourhood() {
      return null;
    },
    async impact() {
      return null;
    },
    purgeProject: (projectId) => store.purgeProject(projectId),
    healthy: () => store.healthy(),
  };
}
