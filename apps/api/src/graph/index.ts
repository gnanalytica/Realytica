/**
 * Adapter selection.
 *
 * Neo4j when a URL is configured, the journal otherwise — and the journal is
 * a real default rather than a stub, because the authored half of the graph
 * has to survive whatever happens to a free-tier instance.
 *
 * The driver is imported dynamically, only inside the branch that needs it, so
 * a deployment with no graph store configured never loads it. The same shape
 * `storage/index.ts` uses, for the same reason.
 */

import type { GraphAdapter } from './types';
import { journalAdapter } from './journal';

async function selectAdapter(): Promise<GraphAdapter> {
  if (!process.env.REALYTICA_NEO4J_URL) return journalAdapter;
  const { neo4jAdapter, ensureNeo4jSchema } = await import('./neo4j');
  if (!(await neo4jAdapter.healthy())) {
    // Falling back rather than failing to boot. A graph store is an index over
    // data that lives elsewhere, and an unreachable one must not take the
    // product down — but it is said out loud, because silently writing the
    // reasoning somewhere other than where an operator configured it is how
    // you discover months later that the graph was empty.
    console.warn('[graph] REALYTICA_NEO4J_URL is set but unreachable — using the journal adapter instead.');
    return journalAdapter;
  }
  await ensureNeo4jSchema();
  return neo4jAdapter;
}

export const graphAdapter: GraphAdapter = await selectAdapter();

console.log(`[graph] using the ${graphAdapter.kind} adapter`);

export type { GraphAdapter } from './types';
