/**
 * Adapter selection.
 *
 * The graph store is where the annotations live, and an annotation exists
 * nowhere else. That makes the choice of adapter a data-durability decision
 * rather than a preference, and it is why the two failure modes are treated
 * completely differently:
 *
 * **Not configured, in production, is a DEPLOY ERROR.** The journal writes
 * beside the case store, which on a serverless host is `/tmp` — gone on the
 * next cold start. Falling back to it silently would accept annotations, tell
 * the analyst they were saved, and lose them, which is the worst outcome
 * available. So it refuses to boot and says exactly what to set. A deploy that
 * fails loudly is fixed in a minute; one that loses notes quietly is found
 * weeks later, by the person whose notes are gone.
 *
 * **Configured but unreachable is an INCIDENT, and the product survives it.**
 * Realytica's floor is the deterministic screen, and a graph outage must not
 * stop a valuer creating a case or uploading a deed. The writes fail, they are
 * logged, and the derived half rebuilds from the case store when the store
 * comes back. Annotations attempted during the outage are refused with a 503
 * rather than accepted — see the route.
 *
 * Locally, the journal is the right default and needs no account.
 */

import type { GraphAdapter } from './types';
import { journalAdapter } from './journal';

/** True on Vercel, where the filesystem the journal writes to is `/tmp`. */
function isServerless(): boolean {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

async function selectAdapter(): Promise<GraphAdapter> {
  if (!process.env.REALYTICA_NEO4J_URL) {
    if (isServerless()) {
      throw new Error(
        'REALYTICA_NEO4J_URL is not set. On a serverless host the journal adapter writes to /tmp, '
          + 'so graph annotations would be accepted and then silently lost on the next cold start. '
          + 'Set REALYTICA_NEO4J_URL, REALYTICA_NEO4J_USER and REALYTICA_NEO4J_PASSWORD — see docs/runbooks/deployment.md.',
      );
    }
    return journalAdapter;
  }

  const { neo4jAdapter, ensureNeo4jSchema } = await import('./neo4j');
  if (!(await neo4jAdapter.healthy())) {
    // Unreachable is not misconfigured. Keep serving — the case store is
    // durable and the derived half rebuilds — but never pretend the store is
    // somewhere else: on a serverless host the journal cannot hold an
    // annotation either, so a caller writing one gets an honest 503.
    console.warn('[graph] REALYTICA_NEO4J_URL is set but unreachable. The graph is degraded; annotations will be refused until it answers.');
    return neo4jAdapter;
  }
  await ensureNeo4jSchema();
  return neo4jAdapter;
}

export const graphAdapter: GraphAdapter = await selectAdapter();

console.log(`[graph] using the ${graphAdapter.kind} adapter`);

export type { GraphAdapter } from './types';
