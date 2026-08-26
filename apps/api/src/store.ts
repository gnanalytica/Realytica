import type { MemoryFact, PropertyCase } from '@valytica/shared';
import { storageAdapter } from './storage';

/**
 * The in-memory case store, durably backed by whichever `StorageAdapter` is
 * active (see `./storage/index.ts`) — the filesystem locally, Vercel Blob in
 * a deployment with a Blob store attached.
 *
 * The whole dataset is small (a handful of property cases), so it is kept
 * entirely in memory and mirrored to the adapter on every mutation. There is
 * no more debouncing: on serverless the instance can be frozen the moment a
 * response is sent, so a write that hasn't fired yet by then is a write that
 * never happens. Every mutation site now awaits `store.save()` directly.
 */

export interface StoreData {
  cases: PropertyCase[];
  /** Monotonic counter used to mint human references like "VPS-0001". */
  nextReferenceSeq: number;
  /**
   * Cross-case agent memory (see `@valytica/agents`'s `memory/`).
   *
   * Kept in the same document as the cases rather than in its own, because
   * one document means one durability path — and durability is the property
   * that matters on serverless, where a write that has only been scheduled is
   * a write that never happens. The cost is that a case mutation rewrites the
   * memory set with it; facts are small and this dataset is small, so that is
   * the cheaper side of the trade. If memory ever outgrows the cases it
   * should move to its own blob, and this comment is the note to do so.
   *
   * Optional so a store written before memory existed still loads.
   */
  memory?: MemoryFact[];
}

// Re-exported for the routes that still build upload paths directly against
// the filesystem (case document upload/download/delete) rather than going
// through a `StorageAdapter` themselves. Those paths are only meaningful
// when the filesystem adapter is the active one — under Vercel Blob,
// documents live in Blob storage instead, and these three exports describe
// nothing that is actually persisted. See the top-level report for exactly
// which callers still depend on them.
export { DATA_DIR, UPLOADS_DIR, caseUploadDir } from './storage/filesystem';

function emptyStore(): StoreData {
  return { cases: [], nextReferenceSeq: 1 };
}

function normalizeStoreData(loaded: StoreData | null): StoreData {
  if (!loaded) return emptyStore();
  return {
    cases: Array.isArray(loaded.cases) ? loaded.cases : [],
    nextReferenceSeq:
      typeof loaded.nextReferenceSeq === 'number' && Number.isFinite(loaded.nextReferenceSeq)
        ? loaded.nextReferenceSeq
        : 1,
  };
}

class Store {
  data: StoreData = emptyStore();

  /** Load persisted state via the active adapter. Must be awaited once at
   * boot, before any route handler runs — after that, `data` is
   * synchronously readable exactly as it always was. */
  async init(): Promise<void> {
    const loaded = await storageAdapter.readStore();
    this.data = normalizeStoreData(loaded);
  }

  /** Mint the next human-readable case reference, e.g. "VPS-0001". */
  nextReference(): string {
    const seq = this.data.nextReferenceSeq;
    this.data.nextReferenceSeq += 1;
    return `VPS-${String(seq).padStart(4, '0')}`;
  }

  /**
   * Persist the current state, resolving only once it is durable.
   *
   * Call this after every mutation of `store.data` and await it before the
   * response is sent — this replaces the old 150ms debounce, which is
   * actively dangerous on serverless (see the module comment above).
   */
  async save(): Promise<void> {
    await storageAdapter.writeStore(this.data);
  }

  /** Alias for `save()`, kept for the SIGINT/SIGTERM shutdown path. */
  async flush(): Promise<void> {
    await this.save();
  }
}

export const store = new Store();

/**
 * Load the store at boot. `apps/api/src/index.ts` must `await` this before
 * serving any request (and before the empty-store auto-seed check), so that
 * `store.data` is populated by the time a route handler reads it.
 */
export async function initStore(): Promise<void> {
  await store.init();
}
