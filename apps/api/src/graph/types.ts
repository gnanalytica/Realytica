/**
 * Where the project graph is kept.
 *
 * The graph is two things wearing one shape, and the split decides everything
 * about this port. `derived` nodes are a function of the project's own
 * registers: rebuild and you get them back, byte for byte. `authored` nodes —
 * an analyst's annotation, a link somebody drew by hand — came out of a
 * person's judgement and can never be regenerated, because the thing that
 * produced them was not a register.
 *
 * So a store here is an INDEX for the derived half and a HOME for the
 * authored half, and the two need different guarantees:
 *
 * - `syncProject` replaces a project's derived nodes wholesale. Losing them
 *   costs a rebuild, so a store may be wiped, migrated or swapped without
 *   ceremony.
 * - `appendProject` adds authored records and never overwrites. This is the
 *   half a store must not lose, and it is why the journal adapter exists at
 *   all — every hosted graph free tier deletes an idle instance, and a
 *   reasoning record that evaporates because nobody logged in for a month is
 *   worse than having no graph.
 *
 * That is also what makes the engine a genuine choice rather than a
 * commitment: the ontology and the writer are the asset, and Neo4j, Postgres
 * or a file behind this interface are all the same to everything above.
 *
 * --- What used to be here ------------------------------------------------
 *
 * This port carried a second, parallel half: `sync`/`append`/`read`/`purge`
 * over a `:Dd` case graph. It was written first and it was the better-designed
 * of the two — closed kinds, endpoint rules, edges closed rather than deleted
 * — but nothing in the running product ever wrote to it. No mounted route
 * creates a `PropertyCase`, the demo reset clears the array outright, and so
 * `syncGraph` iterated an always-empty list on every save while the project
 * half did the real work with none of the same guarantees.
 *
 * The fix was not to keep two graphs. It was to move the invariants onto the
 * one that is live — which is what `origin`, `closedAt` and the closed
 * vocabulary in `project-ontology.ts` now are — and delete the half that was
 * only pretending. `buildDdGraph` itself survives in `@realytica/shared`,
 * because the case copilot still projects one in memory to reason over; what
 * is gone is the claim that anybody was storing it.
 */

import type { ProjectGraphEdge, ProjectGraphNode } from '@realytica/shared';

/**
 * The project graph, persisted as an index of the registers plus whatever a
 * person has annotated onto it.
 */
export interface ProjectGraphSnapshot {
  projectId: string;
  builtAt: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

export interface GraphAdapter {
  /** Human name for the boot log, so it is obvious which backend is live. */
  readonly kind: 'journal' | 'neo4j';

  /**
   * Replace this project's derived half with `snapshot`'s.
   *
   * Authored nodes already stored for the project are left alone — a rebuild
   * is about what the registers say, and must not be able to delete a note
   * somebody wrote down.
   */
  syncProject(snapshot: ProjectGraphSnapshot): Promise<void>;

  /**
   * Add authored nodes and their edges. Never overwrites.
   *
   * Idempotent on node id, so replaying a journal — which is exactly how a
   * lost store is recovered — cannot double up.
   */
  appendProject(projectId: string, nodes: ProjectGraphNode[], edges: ProjectGraphEdge[]): Promise<void>;

  /**
   * Everything held for one project, derived and authored together.
   *
   * Open edges only by default. `asOf` returns the graph as it stood at an
   * instant instead: edges closed after it are still open, edges closed
   * before it are gone. That is what makes "what did this finding rest on
   * when we signed the March report" answerable, and it is why a sync closes
   * an edge rather than deleting it.
   */
  readProject(projectId: string, asOf?: string): Promise<ProjectGraphSnapshot | null>;

  /**
   * Undirected k-hop neighbourhood. Null when the project is not indexed —
   * the caller then extracts from the live registers, which are the source
   * of truth.
   */
  neighbourhood(projectId: string, seedIds: string[], hops: number): Promise<ProjectGraphSnapshot | null>;

  /** Drop everything for a project. Used when the project itself is deleted. */
  purgeProject(projectId: string): Promise<void>;

  /** True when the backend answered. Reported at boot rather than assumed. */
  healthy(): Promise<boolean>;
}
