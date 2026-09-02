import type {
  IntakeSession,
  LlmCallRecord,
  MemoryFact,
  Membership,
  PropertyCase,
  DdProject,
  Tenant,
} from '@realytica/shared';
import type { PromptStoreData } from '@realytica/agents';
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
   * Due-diligence projects — the BRD operating model. Kept in the same
   * document as cases so there is still one durability path.
   */
  projects?: DdProject[];
  nextProjectSeq?: number;
  /**
   * Cross-case agent memory (see `@realytica/agents`'s `memory/`).
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
   * Model-call telemetry (see `@realytica/agents`'s `telemetry/`).
   *
   * Bounded by the sink's own retention rule rather than by anything here —
   * this is the highest-volume collection in the store, and two components
   * trimming it is how records go missing for reasons nobody can reconstruct.
   *
   * Optional so a store written before telemetry existed still loads.
   */
  telemetry?: LlmCallRecord[];
  /**
   * Custom prompt versions and which one is in force (see `@realytica/agents`'s
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
  /**
   * In-flight intake conversations (see `@realytica/agents`'s `intake/`).
   *
   * Kept here rather than in their own document for the same reason memory is:
   * one document means one durability path. A session is small — a handful of
   * turns and a flat field list — and is pruned once it has produced a case,
   * so this does not grow without bound.
   *
   * Optional so a store written before the intake existed still loads.
   */
  intakeSessions?: IntakeSession[];
  /**
   * The ids of the projects held in their own documents.
   *
   * A persistence detail, not domain data: `projects` is the array everything
   * reads, and this is only how the core document remembers which shards to
   * load. Present in the core document, empty in memory after load.
   *
   * Optional so a store written before sharding still loads — such a document
   * carries its projects inline under `projects`, and the first save migrates
   * them out.
   */
  projectIds?: string[];
  /**
   * Workspaces, and who is in them.
   *
   * In the core document rather than sharded: the whole set is read on every
   * authenticated request to resolve a principal, so it must be in memory
   * anyway, and it is two small arrays. They live here for the same reason
   * everything else does — one document, one durability path.
   *
   * Optional so a store written before tenancy still loads. A store with no
   * tenants is a fresh install, and the first person to sign in claims it.
   */
  tenants?: Tenant[];
  memberships?: Membership[];
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
  return { cases: [], nextReferenceSeq: 1, projects: [], nextProjectSeq: 1, tenants: [], memberships: [] };
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
    projects: Array.isArray(loaded.projects) ? loaded.projects : [],
    nextProjectSeq:
      typeof loaded.nextProjectSeq === 'number' && Number.isFinite(loaded.nextProjectSeq)
        ? loaded.nextProjectSeq
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
    intakeSessions: Array.isArray(loaded.intakeSessions) ? loaded.intakeSessions : undefined,
    projectIds: Array.isArray(loaded.projectIds) ? loaded.projectIds.filter((id): id is string => typeof id === 'string') : undefined,
    // Authorisation data, so the shape check is stricter than elsewhere: a row
    // missing a tenant or a role is a row that cannot be reasoned about, and
    // dropping it is safer than defaulting it to something permissive.
    tenants: Array.isArray(loaded.tenants)
      ? loaded.tenants.filter((t): t is Tenant => Boolean(t && typeof t.id === 'string' && typeof t.name === 'string'))
      : undefined,
    memberships: Array.isArray(loaded.memberships)
      ? loaded.memberships.filter(
          (m): m is Membership =>
            Boolean(m && typeof m.tenantId === 'string' && typeof m.email === 'string' && typeof m.role === 'string'),
        )
      : undefined,
  };
}

/**
 * Where one project's document lives, under its own id.
 *
 * Rides the document path (the same one uploads use) rather than needing a
 * new adapter method, so both backends got sharding for free and a deleted
 * project takes its shard with it through the delete that already existed.
 */
const PROJECT_KEY = 'project.json';

class Store {
  data: StoreData = emptyStore();

  /**
   * projectId -> the `updatedAt` its shard was last written from.
   *
   * The same "a record that has not moved cannot need rewriting" rule the
   * graph sync runs on. It is what turns a save from one 700KB rewrite into
   * one small write for the project that actually changed.
   */
  private persistedAt = new Map<string, string>();

  /** Load persisted state via the active adapter. Must be awaited once at
   * boot, before any route handler runs — after that, `data` is
   * synchronously readable exactly as it always was. */
  async init(): Promise<void> {
    const loaded = await storageAdapter.readStore();
    this.data = normalizeStoreData(loaded);

    /*
     * Load the project shards named by the core document.
     *
     * A legacy document carries its projects inline and names no ids; those
     * are already in `data.projects` and the first save migrates them out. A
     * sharded document names ids and holds none, so they are fetched here —
     * in parallel, because on Blob this is one network round trip per project
     * and doing them in sequence would put the whole set on the cold-start
     * path end to end.
     *
     * A shard that will not load is skipped with a warning rather than
     * failing the boot: one unreadable project must not take the other
     * projects, the cases and the prompt store down with it. It is loud
     * because a project silently missing from the list looks exactly like a
     * project somebody deleted.
     */
    const ids = this.data.projectIds ?? [];
    if (ids.length > 0) {
      const loadedProjects = await Promise.all(ids.map(id => this.readProject(id)));
      const shards = loadedProjects.filter((p): p is DdProject => p !== null);
      const missing = ids.length - shards.length;
      if (missing > 0) console.warn(`[store] ${missing} project shard(s) named in the store could not be read`);
      // Inline projects win only when there are no shards at all, which is
      // the legacy shape; otherwise a half-migrated document would duplicate.
      const byId = new Map<string, DdProject>();
      for (const project of [...(this.data.projects ?? []), ...shards]) byId.set(project.id, project);
      this.data.projects = [...byId.values()];
    }
    this.data.projectIds = undefined;
    // Everything loaded is by definition already persisted, so nothing is
    // rewritten until it actually changes.
    for (const project of this.data.projects ?? []) this.persistedAt.set(project.id, project.updatedAt);
  }

  /** One project shard, or null when it is absent or unreadable. */
  private async readProject(id: string): Promise<DdProject | null> {
    try {
      const bytes = await storageAdapter.getDocument(id, PROJECT_KEY);
      if (!bytes) return null;
      const parsed: unknown = JSON.parse(bytes.toString('utf-8'));
      if (typeof parsed !== 'object' || parsed === null) return null;
      const project = parsed as DdProject;
      return typeof project.id === 'string' ? project : null;
    } catch (err) {
      console.warn(`[store] could not read project ${id}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Mint the next human-readable case reference, e.g. "VPS-0001". */
  nextReference(): string {
    const seq = this.data.nextReferenceSeq;
    this.data.nextReferenceSeq += 1;
    return `VPS-${String(seq).padStart(4, '0')}`;
  }

  /** Mint the next project reference, e.g. "RYT-0001". */
  nextProjectReference(): string {
    const seq = this.data.nextProjectSeq ?? 1;
    this.data.nextProjectSeq = seq + 1;
    return `RYT-${String(seq).padStart(4, '0')}`;
  }

  /**
   * Persist the current state, resolving only once it is durable.
   *
   * Call this after every mutation of `store.data` and await it before the
   * response is sent — this replaces the old 150ms debounce, which is
   * actively dangerous on serverless (see the module comment above).
   */
  async save(): Promise<void> {
    const projects = this.data.projects ?? [];

    /*
     * Projects are written one document each, and only the ones that moved.
     *
     * The store used to be a single document rewritten in full on every
     * mutation, which made concurrency a whole-workspace problem: two
     * requests that both loaded at the same instant and both saved would have
     * the second silently discard everything the first wrote, including
     * projects it never touched. Sharding removes that entirely for the
     * common case — two people on two projects now write two different
     * documents and cannot collide at all.
     *
     * It also removes the write amplification the screen result introduced:
     * a chat turn on one project no longer re-serialises every other
     * project's evidence ledger to disk.
     *
     * What this does NOT fix, stated plainly so nobody reads more into it:
     * two concurrent writers on the SAME project still resolve last-writer-
     * wins. That window is one project and usually one person, and closing it
     * needs a compare-and-swap the storage adapters do not offer today.
     */
    const changed = projects.filter(project => this.persistedAt.get(project.id) !== project.updatedAt);
    for (const project of changed) {
      await storageAdapter.putDocument(
        project.id,
        PROJECT_KEY,
        Buffer.from(JSON.stringify(project)),
        'application/json',
      );
      this.persistedAt.set(project.id, project.updatedAt);
    }
    // Shards for projects that are gone are dropped from the index here; the
    // documents themselves go with the project's own delete.
    const live = new Set(projects.map(project => project.id));
    for (const id of [...this.persistedAt.keys()]) {
      if (!live.has(id)) this.persistedAt.delete(id);
    }

    // The core document: everything that is not a project, plus the index of
    // which shards to load. `projects` is written empty rather than omitted so
    // an older build reading this document finds a shape it understands
    // instead of a missing key.
    await storageAdapter.writeStore({ ...this.data, projects: [], projectIds: [...live] });

    // After the store is durable, never before: the graph is an index over it,
    // and an index written ahead of the thing it indexes can point at a state
    // that never existed. Imported lazily to keep the store module free of a
    // dependency on the graph layer, which imports it back.
    const { syncGraph } = await import('./graph/sync');
    await syncGraph(projects);
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
