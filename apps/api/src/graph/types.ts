/**
 * Where the reasoning graph is kept.
 *
 * The graph is two things wearing one shape, and the split decides everything
 * about this port. `derived` nodes are a function of the case's own stores:
 * rebuild and you get them back, byte for byte. `authored` nodes — the
 * questions, answers, thoughts and follow-ups — came out of a conversation and
 * can never be regenerated, because the thing that produced them was not a
 * document.
 *
 * So a store here is an INDEX for the derived half and a HOME for the authored
 * half, and the two need different guarantees:
 *
 * - `sync` replaces a case's derived nodes wholesale. Losing them costs a
 *   rebuild, so a store may be wiped, migrated or swapped without ceremony.
 * - `append` adds authored records and never overwrites. This is the half a
 *   store must not lose, and it is why the journal adapter exists at all —
 *   every hosted graph free tier deletes an idle instance, and a reasoning
 *   record that evaporates because nobody logged in for a month is worse than
 *   having no graph.
 *
 * That is also what makes the engine a genuine choice rather than a
 * commitment: the ontology and the writer are the asset, and Neo4j, Postgres
 * or a file behind this interface are all the same to everything above.
 */

import type { DdEdge, DdGraph, DdNode } from '@realytica/shared';

export interface GraphAdapter {
  /** Human name for the boot log, so it is obvious which backend is live. */
  readonly kind: 'journal' | 'neo4j';

  /**
   * Replace this case's derived half with `graph`'s.
   *
   * Authored nodes already stored for the case are left alone — a rebuild is
   * about what the documents say, and must not be able to delete a reason
   * somebody wrote down.
   */
  sync(graph: DdGraph): Promise<void>;

  /**
   * Add authored nodes and their edges. Never overwrites.
   *
   * Idempotent on node id, so replaying a journal — which is exactly how a
   * lost store is recovered — cannot double up.
   */
  append(caseId: string, nodes: DdNode[], edges: DdEdge[]): Promise<void>;

  /** Everything held for one case, derived and authored together. */
  read(caseId: string): Promise<DdGraph | null>;

  /** Drop everything for a case. Used when the case itself is deleted. */
  purge(caseId: string): Promise<void>;

  /** True when the backend answered. Reported at boot rather than assumed. */
  healthy(): Promise<boolean>;
}
