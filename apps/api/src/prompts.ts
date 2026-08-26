import { PersistedPromptStore, setPromptStore, type PromptPersistence, type PromptStoreData } from '@valytica/agents';
import { store } from './store';

/**
 * The prompt registry, persisted through the app's own store.
 *
 * Same shape and the same reasoning as `./memory.ts`: `@valytica/agents` takes
 * a `{load, save}` port and leaves the backend to the caller, so the registry
 * inherits the durability guarantee the cases already have (filesystem
 * locally, Vercel Blob in a deployment) instead of inventing a weaker second
 * one. `save` resolves only once the write is durable, which is what serverless
 * demands — an instance can be frozen the moment a response is sent, so a
 * scheduled write is a write that never happens.
 *
 * Only custom versions and the active selection are persisted. Built-ins come
 * from the build, and a persisted copy would shadow the shipped text after an
 * upgrade — the store enforces that on load; this port just never sends them.
 */
const persistence: PromptPersistence = {
  async load(): Promise<PromptStoreData | null> {
    return store.data.prompts ?? null;
  },
  async save(data: PromptStoreData): Promise<void> {
    store.data.prompts = data;
    await store.save();
  },
};

/**
 * The process-wide prompt store.
 *
 * One instance, because `PersistedPromptStore` serialises its writes through a
 * single queue — two instances over the same document would each hold a
 * partial view and the last writer would drop the other's versions.
 */
export const promptStore = new PersistedPromptStore(persistence);

/**
 * Point the agent layer's resolver at this store.
 *
 * Until this runs, `resolvePrompt` falls back to an in-memory store, which
 * means every agent renders its built-in and an operator's edit is silently
 * ignored. Called from `initApp` so it is in force before the first request,
 * on a server and on a cold serverless invocation alike.
 */
export async function initPrompts(): Promise<void> {
  setPromptStore(promptStore);
  await promptStore.ready();
}
