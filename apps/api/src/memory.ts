import type { MemoryFact } from '@realytica/shared';
import { PersistedMemoryStore, type MemoryPersistence } from '@realytica/agents';
import { store } from './store';

/**
 * Cross-case memory, persisted through the app's own store.
 *
 * `@realytica/agents` deliberately does not know how this deployment persists
 * anything — it takes a port with `load`/`save` and leaves the backend to the
 * caller. This is that port, implemented over the same `StorageAdapter` the
 * cases use (filesystem locally, Vercel Blob in a deployment), so memory
 * inherits the durability guarantee that was already fought for rather than
 * inventing a second, weaker one.
 *
 * `save` resolves only once the write is durable, which is what
 * `PersistedMemoryStore` requires and what serverless demands: an instance can
 * be frozen the moment a response is sent, so a scheduled write is a write
 * that never happens.
 */
const persistence: MemoryPersistence = {
  async load(): Promise<MemoryFact[]> {
    return store.data.memory ?? [];
  },
  async save(facts: MemoryFact[]): Promise<void> {
    store.data.memory = facts;
    await store.save();
  },
};

/**
 * The process-wide memory store.
 *
 * One instance, because `PersistedMemoryStore` serialises its own writes
 * through a single queue — two instances over the same backing document would
 * each hold a partial view and the last writer would silently drop the
 * other's facts.
 */
export const memoryStore = new PersistedMemoryStore(persistence);

/**
 * Which workspaces' facts a project's recall may reach.
 *
 * Its own, and — when its workspace is the first on the deployment — the facts
 * that carry none, which is everything learned before the field existed. The
 * same rule `accessTo` applies to a project written before tenancy: on a
 * single-workspace install those facts are plainly theirs, and on a shared one
 * they are plainly not everyone's.
 */
export function memoryReadableBy(tenantId: string | undefined): (string | null)[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  if (!tenantId) return [null];
  return tenantId === bootstrap ? [tenantId, null] : [tenantId];
}

/**
 * Everything a project leaves behind, removed with it.
 *
 * Deleting a project used to remove the project and its documents and stop
 * there, which left two kinds of litter that matter for different reasons.
 * A grant is an access record: leaving one behind means "taken off the
 * project" never fully happened. A memory fact names the owner, the reference
 * and the locality: leaving one behind means "deleted" was not true, and it is
 * true in the one direction — personal data — where it has to be.
 *
 * Returns what went, so a caller can log it rather than guess.
 */
export async function forgetProjects(projectIds: readonly string[]): Promise<{ grants: number; facts: number }> {
  const drop = new Set(projectIds);
  if (drop.size === 0) return { grants: 0, facts: 0 };

  const before = store.data.grants?.length ?? 0;
  if (store.data.grants) store.data.grants = store.data.grants.filter((g) => !drop.has(g.projectId));
  const grants = before - (store.data.grants?.length ?? 0);

  let facts = 0;
  try {
    facts = await memoryStore.forget([...drop]);
  } catch {
    /* memory is context, never evidence: losing this erasure must not fail the delete */
  }
  return { grants, facts };
}
