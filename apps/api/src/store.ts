import type { LlmCallRecord, MemoryFact, PropertyCase } from '@valytica/shared';
import type { PromptStoreData } from '@valytica/agents';
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
  /**
   * Model-call telemetry (see `@valytica/agents`'s `telemetry/`).
   *
   * Bounded by the sink's own retention rule rather than by anything here —
   * this is the highest-volume collection in the store, and two components
   * trimming it is how records go missing for reasons nobody can reconstruct.
   *
   * Optional so a store written before telemetry existed still loads.
   */
  telemetry?: LlmCallRecord[];
  /**
   * Custom prompt versions and which one is in force (see `@valytica/agents`'s
   * `prompts/`).
   *
   * Built-in versions are never written here — they come from the build, and a
   * persisted copy would shadow the shipped text after an upgrade. So a store
   * with no `prompts` key and one where every prompt is on its built-in are
   * the same state, which is the correct default: unedited.
   *
   * Optional so a store written before the prompt registry existed still loads.
   */
  prompts?: PromptStoreData;
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

/**
 * Coerce whatever was on disk into a usable `StoreData`.
 *
 * This rebuilds the object field by field rather than spreading, so a
 * malformed document cannot smuggle in a shape the app then trusts. That is
 * the right default and it has one trap, which this comment exists to stop
 * anyone falling into again: **a field not named here is silently discarded on
 * load, however faithfully it was saved.** `memory` and `telemetry` were both
 * added to `StoreData` and to the save path without being added here, which
 * made them write-only — persisted on every mutation, gone on every restart,
 * with nothing logged either way.
 *
 * So: adding a collection to `StoreData` means adding it here too. Each is
 * carried through only when it is the right shape and left `undefined`
 * otherwise, since absent and unusable should land in the same state — the
 * one the owning component treats as "nothing stored yet".
 */
function normalizeStoreData(loaded: StoreData | null): StoreData {
  if (!loaded) return emptyStore();
  return {
    cases: Array.isArray(loaded.cases) ? loaded.cases : [],
    nextReferenceSeq:
      typeof loaded.nextReferenceSeq === 'number' && Number.isFinite(loaded.nextReferenceSeq)
        ? loaded.nextReferenceSeq
        : 1,
    memory: Array.isArray(loaded.memory) ? loaded.memory : undefined,
    telemetry: Array.isArray(loaded.telemetry) ? loaded.telemetry : undefined,
    // The prompt store does its own hydration — dropping unusable versions and
    // clearing selections that point at nothing, loudly. Anything object-shaped
    // is handed over so that repair happens there, where it can be reported,
    // rather than here, where it would be a silent discard.
    prompts:
      loaded.prompts && typeof loaded.prompts === 'object' && !Array.isArray(loaded.prompts)
        ? loaded.prompts
        : undefined,
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
