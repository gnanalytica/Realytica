import type {
  Flow,
  FlowRunRecord,
  StoredCredential,
  LlmCallRecord,
  MemoryFact,
  Membership,
  ProjectGrant,
  DdProject,
  Tenant,
} from '@realytica/shared';
import { deriveHealth, evaluateRevisits, migrateWorkspaceRole, syncAlerts, type ProjectAlert } from '@realytica/shared';
import type { PromptStoreData } from '@realytica/agents';
import { storageAdapter } from './storage';
import type { DeviceRecord, PairCode } from './devices';
import type { GraphSettlement, GraphSyncRun, OwedGraph } from './graph/sync';
import type { GraphSyncRefused } from './graph/types';
import { finishAfterReply } from './runs/background';

/**
 * The in-memory case store, durably backed by whichever `StorageAdapter` is
 * active (see `./storage/index.ts`) — the filesystem locally, Vercel Blob in
 * a deployment with a Blob store attached.
 *
 * The whole dataset is small (a handful of projects), so it is kept
 * entirely in memory and mirrored to the adapter on every mutation. There is
 * no more debouncing: on serverless the instance can be frozen the moment a
 * response is sent, so a write that hasn't fired yet by then is a write that
 * never happens. Every mutation site now awaits `store.save()` directly.
 */

export interface StoreData {
  /** Due-diligence projects — the operating model this product runs on. */
  projects?: DdProject[];
  nextProjectSeq?: number;
  /**
   * Cross-case agent memory (see `@realytica/agents`'s `memory/`).
   *
   * Kept in the same document as the projects rather than in its own, because
   * one document means one durability path — and durability is the property
   * that matters on serverless, where a write that has only been scheduled is
   * a write that never happens. The cost is that a case mutation rewrites the
   * memory set with it; facts are small and this dataset is small, so that is
   * the cheaper side of the trade. If memory ever outgrows the projects it
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
   * Flows: the agentic pipeline as an operator drew it.
   *
   * Data rather than code by design — see `packages/shared/src/flow`. Kept in
   * the core document because a flow is small and a run has to be able to read
   * one without a second fetch.
   */
  flows?: Flow[];
  /**
   * What happened when a flow ran.
   *
   * Kept because a run that leaves no trace cannot be asked about, and the
   * question people have about automation is always retrospective: why did
   * this fire, what did it decide, what did it cost. A result returned once to
   * whoever happened to be looking is not an answer to any of those.
   *
   * Bounded per flow rather than globally — see `flows/runs.ts`. A global cap
   * would let one busy flow evict the history of every other one, which is the
   * opposite of what a retention rule is for.
   */
  flowRuns?: FlowRunRecord[];
  /**
   * Secrets flow nodes authenticate with.
   *
   * Write-only from every route: stored here, never returned. Holding them at
   * all is a deliberate widening of this deployment's blast radius — a backup
   * of this document now carries credentials — taken so an operator can wire a
   * connector without a deploy.
   */
  credentials?: StoredCredential[];
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
  /**
   * Who is on which project, and how narrowly.
   *
   * Beside the memberships for the same reason: read on every request that
   * touches a project, and small.
   */
  grants?: ProjectGrant[];
  /**
   * Phones paired for the site app, and the short-lived codes that pair them.
   * Beside the memberships because every request from a phone resolves its
   * person through them.
   */
  devices?: DeviceRecord[];
  pairCodes?: PairCode[];
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
  return { projects: [], nextProjectSeq: 1, tenants: [], memberships: [], grants: [] };
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
    flows: Array.isArray(loaded.flows) ? loaded.flows : undefined,
    credentials: Array.isArray(loaded.credentials) ? loaded.credentials : undefined,
    projectIds: Array.isArray(loaded.projectIds) ? loaded.projectIds.filter((id): id is string => typeof id === 'string') : undefined,
    // Authorisation data, so the shape check is stricter than elsewhere: a row
    // missing a tenant or a role is a row that cannot be reasoned about, and
    // dropping it is safer than defaulting it to something permissive.
    tenants: Array.isArray(loaded.tenants)
      ? loaded.tenants.filter((t): t is Tenant => Boolean(t && typeof t.id === 'string' && typeof t.name === 'string'))
      : undefined,
    memberships: Array.isArray(loaded.memberships)
      ? loaded.memberships
          .filter(
            (m): m is Membership =>
              Boolean(m && typeof m.tenantId === 'string' && typeof m.email === 'string' && typeof m.role === 'string'),
          )
          // A role written before the reshape is renamed here rather than
          // wherever it is read, so there is one place that knows the old
          // names. An unrecognised one becomes a collaborator, which reaches
          // nothing — authorisation data must not fall back to permissive.
          .map((m) => ({ ...m, role: migrateWorkspaceRole(m.role as string) }))
      : undefined,
    grants: Array.isArray(loaded.grants)
      ? loaded.grants.filter(
          (g): g is ProjectGrant =>
            Boolean(g && typeof g.tenantId === 'string' && typeof g.projectId === 'string' && typeof g.email === 'string'),
        )
      : undefined,
    devices: Array.isArray(loaded.devices)
      ? loaded.devices.filter((d): d is DeviceRecord => Boolean(d && typeof d.id === 'string' && typeof d.tokenHash === 'string' && typeof d.tenantId === 'string'))
      : undefined,
    // Only codes still worth keeping: an expired code is noise in the core document.
    pairCodes: Array.isArray(loaded.pairCodes)
      ? loaded.pairCodes.filter((c): c is PairCode => Boolean(c && typeof c.code === 'string' && typeof c.expiresAt === 'string' && Date.parse(c.expiresAt) > Date.now() - 86_400_000))
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

/**
 * The key a project's document carries its revision under.
 *
 * The revision is the store's and not the project's. It is taken off a
 * document as it is read and put on as one is written, so nothing above the
 * store sees it, and nothing above the store, undo included, can put an old
 * one back. A build that predates it loads the key as part of the project and
 * writes it back as it found it.
 */
const REVISION_KEY = 'storeRevision';

/** A project as its document holds it, and the revision the document carried. */
interface Shard {
  project: DdProject;
  revision: number;
}

/**
 * How often a miss may pay for a re-read of the workspace document.
 *
 * Long enough that a wrong id in a URL cannot turn into a storage read per
 * request; short enough that "create it, then open it" — which is one human
 * click after another — always crosses it.
 */
const REFRESH_MIN_INTERVAL_MS = 2_000;

/** How often one project may be re-read from storage for a request; see `syncProject`. */
const PROJECT_SYNC_INTERVAL_MS = 1_000;

/** How often the workspace document may be re-read for a request; see `syncIndex`. */
const INDEX_SYNC_INTERVAL_MS = 2_000;

/**
 * Every workspace field, as JSON, keyed by name. Projects are sharded and
 * the index is derived, so neither is part of it.
 */
function coreSnapshot(data: StoreData): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (key === 'projects' || key === 'projectIds') continue;
    out.set(key, JSON.stringify(value ?? null));
  }
  return out;
}

export class Store {
  data: StoreData = emptyStore();

  /**
   * projectId -> the `updatedAt` its shard was last written from.
   *
   * A record that has not moved cannot need rewriting. It is what turns a
   * save from one 700KB rewrite into one small write for the project that
   * actually changed.
   */
  private persistedAt = new Map<string, string>();

  /**
   * projectId -> the highest revision this instance has read or written for
   * that project's document.
   *
   * A revision orders the copies of one project. `updatedAt` cannot: it is
   * set to the time of whatever was read or decided, not to the time of the
   * write, and undo puts an older one back. So every write of a project's
   * document carries a number higher than any this instance has seen for it,
   * and never behind the clock.
   *
   * What that guarantees: a write is numbered above every copy the writing
   * instance has read or written, whatever the project's own fields say, and
   * above the number the graph store last turned it away with. What it does
   * not: between two instances that have not read each other's writes the
   * order is their clocks', so the later write has the higher number only as
   * far as the two clocks agree. Where they do not, the graph store turns
   * the later write away, and `offerAbove` is what puts that right.
   */
  private revisions = new Map<string, number>();

  /**
   * projectId -> the revision the graph store is owed that project at.
   *
   * Every copy this instance writes is owed at the number it was written
   * under, and every copy it reads is owed at the number it was read with,
   * until the graph store is seen to hold it. Owing what is read is what
   * catches a graph up when it was left behind: by a sync lost with its
   * instance, an outage, or new code that draws the same record differently.
   * It is safe because the graph store refuses a copy older than the one it
   * holds, and cheap because it writes nothing for one it has already drawn.
   */
  private graphOwed = new Map<string, number>();

  /**
   * projectId -> the `updatedAt` of the copy this instance last saw the
   * graph store settle, so that reading the same copy again owes nothing.
   */
  private graphSeen = new Map<string, string>();

  /** Projects that have left this instance's list and whose graph has not been seen to go with them. */
  private graphGone = new Set<string>();

  /** Projects offered to the graph store in a call it has not answered yet. */
  private graphOffering = new Set<string>();

  /** The pass now offering the graph store what it is still owed, when there is one. */
  private catchingUp: Promise<void> | undefined;

  /**
   * True from a call the graph store failed until one it answers. While it
   * is, only a save asks: a store that is down is not asked again by every
   * request that reads a project.
   */
  private graphDown = false;

  /** What the graph sync reports back, as each answer lands. */
  private readonly graphSettlement: GraphSettlement = {
    synced: ({ project, revision }, builtAt) => {
      // Only if the copy offered is still the one owed: a save or a read
      // overlapping the offer may have moved the project on since.
      if (this.graphOwed.get(project.id) !== revision) return;
      this.graphOwed.delete(project.id);
      this.graphSeen.set(project.id, builtAt);
    },
    purged: (projectId) => {
      this.graphGone.delete(projectId);
    },
    refused: (owed, answer) => this.offerAbove(owed, answer),
  };

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
     * projects and the prompt store down with it. It is loud
     * because a project silently missing from the list looks exactly like a
     * project somebody deleted.
     */
    const ids = this.data.projectIds ?? [];
    if (ids.length > 0) {
      const read = await Promise.all(ids.map(id => this.readShard(id)));
      const shards = read.filter((shard): shard is Shard => shard !== null);
      const missing = ids.length - shards.length;
      if (missing > 0) console.warn(`[store] ${missing} project shard(s) named in the store could not be read`);
      // Inline projects win only when there are no shards at all, which is
      // the legacy shape; otherwise a half-migrated document would duplicate.
      const byId = new Map<string, DdProject>();
      for (const project of [...(this.data.projects ?? []), ...shards.map(shard => shard.project)]) byId.set(project.id, project);
      this.data.projects = [...byId.values()];
      for (const shard of shards) this.owe(shard.project, shard.revision);
    }
    this.data.projectIds = undefined;
    // Everything loaded is by definition already persisted, so nothing is
    // rewritten until it actually changes.
    for (const project of this.data.projects ?? []) this.persistedAt.set(project.id, project.updatedAt);
    // Only what loaded. An id the index names and this instance could not
    // read is not this instance's to drop from the index on its next save.
    const held = new Set((this.data.projects ?? []).map(project => project.id));
    this.indexed = new Set(ids.filter(id => held.has(id)));
    this.coreBaseline = coreSnapshot(this.data);
  }

  /**
   * Take what other instances have written to the workspace since this one
   * last looked: projects created or removed there, and the workspace fields
   * this instance has not itself changed — who belongs, what they may reach.
   *
   * Serverless runs several instances, each holding the store it loaded at
   * its own boot. Without this, a project refreshed through one instance was
   * missing from the next list another served, and a member added through
   * one was refused by the other. Called before every request; throttled,
   * and concurrent callers share one read.
   */
  async syncIndex(): Promise<void> {
    const now = Date.now();
    if (this.indexSync && now - this.indexSync.at < INDEX_SYNC_INTERVAL_MS) return this.indexSync.promise;
    const promise = this.pullIndex()
      .catch((err: unknown) => {
        console.warn(`[store] could not sync the workspace: ${(err as Error).message}`);
      })
      .then(() => this.catchUpGraph());
    this.indexSync = { at: now, promise };
    return promise;
  }

  private async pullIndex(): Promise<void> {
    const raw = await storageAdapter.readStore();
    if (!raw) return;
    const loaded = normalizeStoreData(raw) as Record<string, unknown>;
    const data = this.data as Record<string, unknown>;
    const mine = coreSnapshot(this.data);
    for (const key of new Set([...mine.keys(), ...Object.keys(loaded)])) {
      if (key === 'projects' || key === 'projectIds') continue;
      // Changed here and not yet written: this instance's own, left alone.
      if (mine.has(key) && mine.get(key) !== this.coreBaseline.get(key)) continue;
      const value = key in loaded ? loaded[key] : (raw as Record<string, unknown>)[key];
      data[key] = value;
      this.coreBaseline.set(key, JSON.stringify(value ?? null));
    }

    // A legacy document carries its projects inline and names no ids.
    if (!Array.isArray(raw.projectIds)) return;
    const stored = new Set(raw.projectIds.filter((id): id is string => typeof id === 'string'));
    const projects = this.data.projects ?? (this.data.projects = []);
    const held = new Set(projects.map((project) => project.id));
    const missing = [...stored].filter((id) => !held.has(id));
    const shards = (await Promise.all(missing.map((id) => this.readShard(id)))).filter((shard): shard is Shard => shard !== null);
    for (const { project, revision } of shards) {
      if (projects.some((other) => other.id === project.id)) continue;
      projects.push(project);
      this.persistedAt.set(project.id, project.updatedAt);
      this.owe(project, revision);
    }
    // Removed through another instance: this one knew it as stored, storage
    // no longer names it, and nothing about it here is waiting to be written.
    this.data.projects = projects.filter(
      (project) => stored.has(project.id) || !this.indexed.has(project.id) || this.persistedAt.get(project.id) !== project.updatedAt,
    );
    const live = new Set(this.data.projects.map((project) => project.id));
    for (const id of [...this.persistedAt.keys()]) if (!live.has(id)) this.forget(id);
    // Only the ids this instance holds. One the index names and this
    // instance could not read is not this instance's to drop from the index.
    this.indexed = new Set([...stored].filter((id) => live.has(id)));
  }

  /**
   * A project this instance held as stored has left its list. What was kept
   * about it goes, and its graph is dropped by this instance's next save,
   * whichever instance removed the project: the one that did may not have
   * reached the graph store. By a save and not sooner, and only if the
   * project is still gone then: a project that left the list and came back
   * keeps its graph and the notes written on it.
   */
  private forget(id: string): void {
    this.persistedAt.delete(id);
    this.revisions.delete(id);
    this.graphOwed.delete(id);
    this.graphSeen.delete(id);
    this.graphGone.add(id);
  }

  /**
   * One project, as storage has it now, before a request about it is served.
   *
   * An approval made through one instance was invisible to the next page
   * another served, and that instance's next save put its older copy back
   * over it. The stored copy replaces the held one in place, so every
   * reference a handler already holds stays the live one — unless this
   * instance holds a change of its own it has not written yet, which its own
   * save is about to do. Throttled per project; concurrent callers share one
   * read; `force` skips the throttle, for a turn that has been running long
   * enough for the file to have moved underneath it.
   */
  async syncProject(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    const last = this.projectSyncs.get(id);
    if (!opts.force && last && now - last.at < PROJECT_SYNC_INTERVAL_MS) return last.promise;
    const promise = this.pullProject(id)
      .catch((err: unknown) => {
        console.warn(`[store] could not sync project ${id}: ${(err as Error).message}`);
      })
      .then(() => this.catchUpGraph());
    this.projectSyncs.set(id, { at: now, promise });
    return promise;
  }

  private async pullProject(id: string): Promise<void> {
    const shard = await this.readShard(id);
    if (!shard) return;
    const { project: stored, revision } = shard;
    const projects = this.data.projects ?? (this.data.projects = []);
    const held = projects.find((project) => project.id === id);
    if (!held) {
      projects.push(stored);
      this.persistedAt.set(id, stored.updatedAt);
      this.owe(stored, revision);
      return;
    }
    if (stored.updatedAt === held.updatedAt) {
      this.owe(held, revision);
      return;
    }
    if (held.updatedAt !== this.persistedAt.get(id)) return;
    const target = held as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, stored);
    this.persistedAt.set(id, stored.updatedAt);
    this.owe(held, revision);
  }

  /**
   * The copy just read from storage is the one this instance holds, so the
   * graph store is owed it at the number it was read with: unless this
   * instance has already seen the graph store settle that very copy.
   * `updatedAt` moves with every write, so the same one is the same copy.
   */
  private owe(project: DdProject, revision: number): void {
    if (this.graphSeen.get(project.id) === project.updatedAt) return;
    this.graphOwed.set(project.id, Math.max(this.graphOwed.get(project.id) ?? 0, revision));
  }

  /** When the core document was last re-read, for the throttle below. */
  private lastRefresh = 0;

  /**
   * Each workspace field as this instance last read or wrote it, which is
   * how a change made here is told from one another instance made.
   */
  private coreBaseline = new Map<string, string>();

  /**
   * Of the project ids the stored index held when this instance last read or
   * wrote it, the ones this instance holds.
   *
   * A held project that is not in here was created here and is added to the
   * index by the next save. One that is in here and no longer held was
   * removed here and is taken out by the next save. So it must never name a
   * project this instance does not hold: one whose document would not load,
   * or one another instance created since. It did, and the next save took
   * those out of the index, though nobody had deleted them.
   */
  private indexed = new Set<string>();

  private indexSync: { at: number; promise: Promise<void> } | undefined;

  private projectSyncs = new Map<string, { at: number; promise: Promise<void> }>();

  /**
   * Re-read the workspace-level half of the store from the adapter.
   *
   * `init` runs once at boot and `data` is synchronous from then on, which is
   * exactly right for one long-running process and wrong for a serverless
   * deployment, where "the process" is several instances that each loaded
   * their own snapshot at their own cold start. A flow created on instance A
   * is durable the moment A returns 201, and still absent from instance B's
   * memory — so the very next read, if it lands on B, answers "Flow not
   * found" about something that demonstrably exists. Clicking again lands on
   * A and it works, which is what makes it look intermittent rather than
   * structural.
   *
   * So a handler that is about to 404 on something the caller has good reason
   * to believe exists calls this first, and only then decides.
   *
   * Deliberately narrow. It re-reads the core document — flows, tenants,
   * credentials, the workspace-level lists — and does NOT touch project
   * shards, which are large, numerous, and already reloaded per project where
   * that matters. It also leaves `persistedAt` alone: that map tracks what
   * THIS instance has written, and forgetting it would make the next save
   * rewrite every project.
   *
   * Throttled, because the miss path is reachable by anyone typing a URL and
   * an unthrottled reload would turn a 404 into a storage read per request.
   */
  async refreshWorkspace(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefresh < REFRESH_MIN_INTERVAL_MS) return;
    this.lastRefresh = now;
    try {
      const raw = await storageAdapter.readStore();
      /*
       * `readStore` answers null for a document that is absent OR unreadable —
       * the adapter logs the parse failure and recovers to an empty store,
       * which is the right call at boot and the wrong one here. Adopting it
       * would blank this instance's flows, tenants and credentials because a
       * document was briefly mid-write, turning a 404 on one flow into the
       * disappearance of all of them. Learning nothing is the safe outcome.
       */
      if (!raw) {
        console.warn('[store] the workspace document could not be read on refresh — keeping the snapshot in memory');
        return;
      }
      const loaded = normalizeStoreData(raw);
      // Projects are sharded and are not in this document; keeping ours
      // avoids emptying the list on every refresh.
      const projects = this.data.projects;
      this.data = { ...loaded, projects };
      this.data.projectIds = undefined;
    } catch (err) {
      // A refresh that fails must not turn a clean 404 into a 500 — the
      // caller carries on with the snapshot it already had.
      console.warn(`[store] could not refresh the workspace document: ${(err as Error).message}`);
    }
  }

  /** One project shard and the revision it was written under, or null when it is absent or unreadable. */
  private async readShard(id: string): Promise<Shard | null> {
    try {
      const bytes = await storageAdapter.getDocument(id, PROJECT_KEY);
      if (!bytes) return null;
      const parsed: unknown = JSON.parse(bytes.toString('utf-8'));
      if (typeof parsed !== 'object' || parsed === null) return null;
      const project = parsed as DdProject;
      if (typeof project.id !== 'string') return null;
      // The revision comes off here, the one place a document is read, and
      // is remembered if it is the highest seen for this project. A document
      // written before revisions, or by a build that has none, is the lowest.
      const document = parsed as Record<string, unknown>;
      const stored = document[REVISION_KEY];
      delete document[REVISION_KEY];
      const revision = Number.isSafeInteger(stored) ? (stored as number) : 0;
      if (revision > (this.revisions.get(project.id) ?? 0)) this.revisions.set(project.id, revision);
      return { project, revision };
    } catch (err) {
      console.warn(`[store] could not read project ${id}: ${(err as Error).message}`);
      return null;
    }
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
    // What a change means for people — alerts raised or cleared, certified
    // reports to revisit — is worked out before the write, so it is saved
    // with the change that caused it.
    const raised = new Map<string, ProjectAlert[]>();
    for (const project of changed) {
      try {
        evaluateRevisits(project);
        const fresh = syncAlerts(project);
        if (fresh.length) raised.set(project.id, fresh);
        // Health reads the alerts, so it is read again once they are settled.
        project.health = deriveHealth(project);
      } catch (err) {
        console.warn(`[store] could not refresh alerts on ${project.id}: ${(err as Error).message}`);
      }
    }
    for (const project of changed) {
      // See `revisions`. Raised before the write is awaited, so a save that
      // overlaps this one takes a higher number still.
      const revision = Math.max((this.revisions.get(project.id) ?? 0) + 1, Date.now());
      this.revisions.set(project.id, revision);
      await storageAdapter.putDocument(
        project.id,
        PROJECT_KEY,
        Buffer.from(JSON.stringify({ ...project, [REVISION_KEY]: revision })),
        'application/json',
      );
      this.persistedAt.set(project.id, project.updatedAt);
      this.graphOwed.set(project.id, revision);
    }
    // Shards for projects that are gone are dropped from the index here; the
    // documents themselves go with the project's own delete.
    const live = new Set(projects.map(project => project.id));
    for (const id of [...this.persistedAt.keys()]) {
      if (!live.has(id)) this.forget(id);
    }

    await this.writeCore(live);

    // After the store is durable, never before: the graph is an index over it,
    // and an index written ahead of the thing it indexes can point at a state
    // that never existed.
    //
    // A save waits, for a bounded time, on two things only: the copies it
    // wrote, and the graphs of projects that are gone. A project is gone only
    // if it is still out of this instance's list now: one that left the list
    // and came back before this save keeps its graph and its notes. Whatever
    // else the graph store is owed is offered once the save is out of the way.
    for (const id of [...this.graphGone]) if (live.has(id)) this.graphGone.delete(id);
    const run = await this.offerGraph(
      changed.flatMap(project => {
        const revision = this.graphOwed.get(project.id);
        return revision === undefined ? [] : [{ project, revision }];
      }),
      [...this.graphGone],
    );
    if (!(await run.waited)) {
      console.warn('[graph] the store had not answered in time: the save went on without it, and what it has not taken stays owed');
    }
    this.catchUpGraph(true);

    // Then tell people. Sent after the write, so an alert nobody can open is never mailed.
    if (raised.size) {
      const { notifyRaised } = await import('./notify');
      for (const project of changed) {
        const fresh = raised.get(project.id);
        if (fresh) await notifyRaised(project, fresh);
      }
    }
  }

  /**
   * The core document: everything that is not a project, plus the index of
   * which shards to load. `projects` is written empty rather than omitted so
   * an older build reading this document finds a shape it understands
   * instead of a missing key.
   *
   * Written only when this instance changed something in it, and then over
   * what is stored now rather than over this instance's snapshot of it: a
   * field it changed is its own, every other field keeps what another
   * instance wrote, and the index gains the projects created here and loses
   * the ones removed here, whatever else it names. Writing the whole snapshot
   * on every save was how one instance's save undid another's refresh of the
   * samples, or its new member. Two instances changing the SAME field still
   * resolve last-writer-wins.
   */
  private async writeCore(live: Set<string>): Promise<void> {
    const mine = coreSnapshot(this.data);
    const changed = [...mine].filter(([key, json]) => this.coreBaseline.get(key) !== json).map(([key]) => key);
    const created = [...live].filter((id) => !this.indexed.has(id));
    const removed = [...this.indexed].filter((id) => !live.has(id));
    if (!changed.length && !created.length && !removed.length) return;

    const raw = ((await storageAdapter.readStore()) ?? {}) as StoreData & Record<string, unknown>;
    const ids = new Set([...(Array.isArray(raw.projectIds) ? raw.projectIds : []), ...created]);
    for (const id of removed) ids.delete(id);
    const data = this.data as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...raw };
    for (const key of changed) merged[key] = data[key];
    await storageAdapter.writeStore({ ...(merged as StoreData), projects: [], projectIds: [...ids] });

    // What another instance wrote to a field this one left alone is now this one's too.
    const adopted = normalizeStoreData(merged as StoreData) as Record<string, unknown>;
    for (const key of mine.keys()) {
      if (changed.includes(key)) continue;
      data[key] = key in adopted ? adopted[key] : merged[key];
    }
    this.coreBaseline = coreSnapshot(this.data);
    // Of what the index now names, only what this instance holds: see `indexed`.
    this.indexed = new Set([...ids].filter((id) => live.has(id)));
  }

  /**
   * One pass of the graph sync over these copies and these departed projects.
   * Imported lazily to keep the store module free of a dependency on the
   * graph layer, which imports it back.
   */
  private async offerGraph(owed: OwedGraph[], gone: string[]): Promise<GraphSyncRun> {
    const { syncGraph } = await import('./graph/sync');
    for (const { project } of owed) this.graphOffering.add(project.id);
    const run = syncGraph(owed, gone, this.graphSettlement);
    void run.finished.then((answered) => {
      for (const { project } of owed) this.graphOffering.delete(project.id);
      if (owed.length > 0 || gone.length > 0) this.graphDown = !answered;
    });
    return run;
  }

  /**
   * Offer the graph store the copies it is still owed, with nothing waiting
   * on it: a reply is never held for a graph that some other instance, or an
   * earlier save, left behind. One pass at a time, each going on starting
   * calls for as long as a save would wait, and kept alive past the reply by
   * the platform. What a pass does not reach stays owed for the next read or
   * save.
   *
   * A read asks only while the graph store is answering. A save asks either
   * way, which is how a store that was down is found to be back.
   */
  private catchUpGraph(afterSave = false): void {
    if (this.catchingUp || this.graphOwed.size === 0 || (this.graphDown && !afterSave)) return;
    this.catchingUp = this.catchUp()
      .catch((err: unknown) => {
        console.warn(`[graph] could not catch the graph up: ${(err as Error).message}`);
      })
      .finally(() => {
        this.catchingUp = undefined;
      });
    finishAfterReply(this.catchingUp);
  }

  private async catchUp(): Promise<void> {
    // Not before the code that read the project has gone on with its own work.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const owed = (this.data.projects ?? []).flatMap((project) => {
      const revision = this.graphOwed.get(project.id);
      if (revision === undefined) return [];
      // Only a copy as stored. One with a change not yet written is owed by
      // the save that writes it, at the number that save gives it. And not
      // one whose last offer has yet to be answered.
      if (this.persistedAt.get(project.id) !== project.updatedAt || this.graphOffering.has(project.id)) return [];
      return [{ project, revision }];
    });
    await (await this.offerGraph(owed, [])).finished;
  }

  /**
   * Settles when the pass now catching the graph up, if there is one, has
   * finished. For a caller that has to see the graph store as this instance
   * leaves it: a script, a test.
   */
  async graphCaughtUp(): Promise<void> {
    await this.catchingUp;
  }

  /**
   * The graph store turned a copy away: what it holds was built from a later
   * revision, and is a different drawing.
   *
   * Usually the graph store is right. Another instance wrote the project
   * since, this copy is the older one, and the refusal stands. But a later
   * number is not always a later copy: an instance whose clock runs behind
   * numbers its write below one made before it, and a build that does not
   * raise the number can put an older copy back. The project store keeps
   * whichever copy was written last, so storage is asked. If it still holds
   * the copy that was offered, the graph is of a copy the project store no
   * longer has, and this one is owed again above the number held.
   */
  private async offerAbove({ project, revision }: OwedGraph, { held, drawn }: GraphSyncRefused): Promise<number | undefined> {
    // Whatever this instance next writes of the project is numbered above it.
    if (held > (this.revisions.get(project.id) ?? 0)) this.revisions.set(project.id, held);
    if (drawn) return undefined;
    const stored = await this.readShard(project.id);
    if (!stored || stored.project.updatedAt !== project.updatedAt || this.graphOwed.get(project.id) !== revision) return undefined;
    const above = held + 1;
    this.revisions.set(project.id, Math.max(this.revisions.get(project.id) ?? 0, above));
    this.graphOwed.set(project.id, above);
    return above;
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
