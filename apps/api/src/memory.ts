import type { MemoryFact } from '@valytica/shared';
import { PersistedMemoryStore, type MemoryPersistence } from '@valytica/agents';
import { store } from './store';

/**
 * Cross-case memory, persisted through the app's own store.
 *
 * `@valytica/agents` deliberately does not know how this deployment persists
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
