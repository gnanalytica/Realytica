/**
 * Prompt versions and which one is active.
 *
 * ## Shape of the thing
 *
 * A prompt has exactly one built-in version — version 1, from the build — plus
 * however many custom versions an operator has written. The built-in is never
 * persisted, never editable and never deletable, which is what makes the
 * feature safe to ship: no sequence of edits, no corrupt blob, no half-applied
 * migration can leave a deployment with no way back to the text the evaluation
 * gate was run against. Deleting the version that happens to be active drops
 * the selection rather than the fallback, so the prompt reverts to the
 * built-in instead of leaving a dangling id nothing can resolve.
 *
 * ## Durability
 *
 * `PersistedPromptStore` copies `PersistedMemoryStore` deliberately, down to
 * the write queue: it writes through to its port on every mutation and does
 * not resolve until that write has. No debouncing, no timers, no background
 * flush. Valytica runs on serverless, where the process can be frozen the
 * instant the response is sent, and a scheduled write there is a write that
 * never happens. Concurrent writes are chained through a single queue so two
 * requests resolving together cannot interleave their saves — an interleaved
 * save here would not lose a cache entry, it would lose somebody's prompt.
 *
 * The port is injected rather than imported so this package never depends on
 * the API layer: `apps/api` implements `{load, save}` over its `StorageAdapter`
 * (filesystem locally, Vercel Blob in deployment) and hands it in. Nothing in
 * this file knows whether it is talking to a disk, a blob store or an array.
 *
 * ## Recomputed, not trusted
 *
 * Two derived fields on a stored version are recomputed from its content every
 * time it is loaded rather than read back from persistence:
 *
 * - `contentHash`, because it is the thing a run is attributed by. A stored
 *   hash that disagreed with its stored content would make "which text
 *   produced this" answerable and wrong, which is worse than unanswerable.
 * - `invariants`, because the checks are code and the content is data. Adding
 *   a guardrail in a later build must retro-flag the versions that were
 *   written before it existed; a stored result would say the old version still
 *   passes a check it was never run against.
 *
 * ## Clocks
 *
 * `createdAt` is the only value here that cannot be derived from content, and
 * the clock is injected for it — as everywhere else in this codebase — so a
 * test can produce a byte-identical store twice. Nothing else in this file
 * reads `Date.now()` or `Math.random()`.
 */

import { createHash } from 'node:crypto';
import type { PromptDescriptor, PromptVersion } from '@valytica/shared';
import { BUILT_IN_PROMPTS, builtInPrompt, type BuiltInPrompt } from './registry';
import { checkInvariants, invariantsFor } from './invariants';

/* ==================================================================== */
/* Persistence shape and port                                            */
/* ==================================================================== */

/**
 * What gets written.
 *
 * Built-in versions are absent by construction — they come from code, and
 * persisting a copy of them is how a deployment ends up running last month's
 * "built-in" after an upgrade.
 *
 * `nextVersion` is a high-water mark rather than something derived from the
 * versions present. If versions 1..3 exist and 3 is deleted, the next custom
 * version must be 4, not 3: a run recorded three weeks ago says
 * `{ version: 3, contentHash: … }`, and handing that number to different text
 * would make the ledger quietly lie about what produced a finding.
 */
export interface PromptStoreData {
  /** Envelope version for this file's own shape, not a prompt version. */
  version: 1;
  /** Custom versions per prompt key, oldest first. */
  customVersions: Record<string, PromptVersion[]>;
  /** Active version id per prompt key. A key that is absent uses its built-in. */
  active: Record<string, string>;
  /** Next custom version number per prompt key. Never decreases. */
  nextVersion: Record<string, number>;
}

/** The injected durability port. `load` returning null means "nothing stored yet". */
export interface PromptPersistence {
  load(): Promise<PromptStoreData | null>;
  save(data: PromptStoreData): Promise<void>;
}

export interface PromptStoreOptions {
  /** Injected clock, so a version's `createdAt` is reproducible in a test. */
  now?: () => string;
}

export interface UpdatePromptVersionInput {
  key: string;
  versionId: string;
  label: string;
  content: string;
  notes?: string;
  /** Make the edited version active in the same operation. */
  activate?: boolean;
}

export interface CreatePromptVersionInput {
  key: string;
  label: string;
  content: string;
  notes?: string;
  /** Make the new version active in the same operation. Almost always what an editor wants. */
  activate?: boolean;
}

/** What loading found and what it had to fix. Logged, so a repaired store is visible rather than silent. */
export interface PromptHydrationReport {
  loaded: number;
  /** Entries that were malformed, or for a prompt key this build no longer has. */
  dropped: number;
  /** Selections that pointed at a version id that is not present, cleared back to the built-in. */
  repaired: number;
}

export function emptyPromptStoreData(): PromptStoreData {
  return { version: 1, customVersions: {}, active: {}, nextVersion: {} };
}

/* ==================================================================== */
/* Content hashing                                                       */
/* ==================================================================== */

/**
 * The digest a run is attributed by.
 *
 * SHA-256 over the UTF-8 bytes of the content and nothing else — no key, no
 * label, no timestamp. Two versions with identical text therefore hash
 * identically, which is the property that matters: "did the text change
 * between these two runs" has to be answerable by comparing two strings, not
 * by trusting that two ids were minted the same way.
 */
export function promptContentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/**
 * Version ids are derived, not minted.
 *
 * `pv-<key with dots as dashes>-<n>`. Derived rather than a UUID so the same
 * store rebuilt from the same data has the same ids — a UUID here would make
 * every reload look like a new set of versions to anything comparing them, and
 * would make the built-in's id change from process to process, which is
 * exactly the id most likely to be written down in a deployment variable.
 */
export function promptVersionId(key: string, version: number): string {
  return `pv-${key.replace(/\./g, '-')}-${version}`;
}

/* ==================================================================== */
/* The built-in version                                                  */
/* ==================================================================== */

/**
 * Version 1 of a prompt, from code.
 *
 * Rebuilt on demand rather than cached so a caller cannot hold a reference and
 * mutate the catalogue's copy of the shipped text.
 */
export function builtInVersion(prompt: BuiltInPrompt): PromptVersion {
  return {
    id: promptVersionId(prompt.key, 1),
    promptKey: prompt.key,
    version: 1,
    label: 'Built-in',
    content: prompt.content,
    // Fixed rather than a build timestamp: this version's identity is its
    // content, and a createdAt that moved every deploy would make the version
    // list look like it had changed when nothing had.
    createdAt: '1970-01-01T00:00:00.000Z',
    builtIn: true,
    contentHash: promptContentHash(prompt.content),
    notes: prompt.notes,
    invariants: checkInvariants(prompt.content, invariantsFor(prompt.key, prompt.variables)),
  };
}

/* ==================================================================== */
/* The synchronous core                                                  */
/* ==================================================================== */

/**
 * Versions, selection and the rules over them, with no persistence.
 *
 * Kept free of I/O so both stores share exactly one implementation of the
 * rules — a second copy of "deleting the active version falls back to the
 * built-in" behind an async facade is how the two would drift apart, and the
 * drift would only show up the day somebody deleted a prompt in production.
 */
export class PromptCatalogue {
  private customVersions = new Map<string, PromptVersion[]>();
  private active = new Map<string, string>();
  private nextVersion = new Map<string, number>();
  private readonly now: () => string;

  constructor(options: PromptStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Replace the contents wholesale, repairing what cannot be honoured.
   *
   * A store that silently honours corrupt state is worse than one that fixes
   * it loudly, so: entries missing a required field are dropped; anything
   * claiming `builtIn: true` is dropped, since built-ins come from code and a
   * persisted one would shadow the shipped text after an upgrade; versions for
   * a key this build no longer declares are dropped; a selection pointing at a
   * version that is not present is cleared, which falls the prompt back to its
   * built-in rather than leaving it unresolvable.
   */
  hydrate(data: PromptStoreData | null | undefined): PromptHydrationReport {
    this.customVersions = new Map();
    this.active = new Map();
    this.nextVersion = new Map();

    let loaded = 0;
    let dropped = 0;
    let repaired = 0;

    const rawVersions = data?.customVersions ?? {};
    for (const key of Object.keys(rawVersions)) {
      const prompt = builtInPrompt(key);
      const list = rawVersions[key];
      if (!prompt || !Array.isArray(list)) {
        dropped += Array.isArray(list) ? list.length : 1;
        continue;
      }
      const usable: PromptVersion[] = [];
      for (const v of list) {
        if (
          !v ||
          typeof v.id !== 'string' ||
          typeof v.content !== 'string' ||
          typeof v.version !== 'number' ||
          !Number.isFinite(v.version) ||
          v.version < 2 ||
          v.builtIn === true
        ) {
          dropped++;
          continue;
        }
        usable.push(this.normaliseVersion(prompt, v));
      }
      usable.sort((a, b) => a.version - b.version);
      if (usable.length > 0) {
        this.customVersions.set(key, usable);
        loaded += usable.length;
      }
    }

    const rawNext = data?.nextVersion ?? {};
    for (const key of Object.keys(rawNext)) {
      const n = rawNext[key];
      if (typeof n === 'number' && Number.isFinite(n)) this.nextVersion.set(key, Math.max(2, Math.floor(n)));
    }
    // The high-water mark must always clear the versions actually present,
    // even if the stored counter was lost or written by an older build.
    for (const [key, list] of this.customVersions) {
      const highest = list.reduce((max, v) => Math.max(max, v.version), 1);
      this.nextVersion.set(key, Math.max(this.nextVersion.get(key) ?? 2, highest + 1));
    }

    const rawActive = data?.active ?? {};
    for (const key of Object.keys(rawActive)) {
      const id = rawActive[key];
      if (typeof id !== 'string' || !builtInPrompt(key)) {
        repaired++;
        continue;
      }
      if (!this.versions(key).some(v => v.id === id)) {
        repaired++;
        continue;
      }
      this.active.set(key, id);
    }

    return { loaded, dropped, repaired };
  }

  /** Recompute the derived fields and drop anything a caller should not be able to set. */
  private normaliseVersion(prompt: BuiltInPrompt, v: PromptVersion): PromptVersion {
    const content = v.content;
    return {
      id: typeof v.id === 'string' && v.id.length > 0 ? v.id : promptVersionId(prompt.key, v.version),
      promptKey: prompt.key,
      version: v.version,
      label: typeof v.label === 'string' && v.label.length > 0 ? v.label : `Version ${v.version}`,
      content,
      createdAt: typeof v.createdAt === 'string' ? v.createdAt : '1970-01-01T00:00:00.000Z',
      builtIn: false,
      contentHash: promptContentHash(content),
      notes: typeof v.notes === 'string' ? v.notes : undefined,
      invariants: checkInvariants(content, invariantsFor(prompt.key, prompt.variables)),
    };
  }

  /** Every version of a prompt, built-in first. Copies, so a caller cannot mutate the catalogue. */
  versions(key: string): PromptVersion[] {
    const prompt = builtInPrompt(key);
    if (!prompt) return [];
    return [builtInVersion(prompt), ...(this.customVersions.get(key) ?? []).map(v => ({ ...v }))];
  }

  /** The full descriptor for one prompt: what it is, every version, and which is in force. */
  descriptor(key: string): PromptDescriptor | undefined {
    const prompt = builtInPrompt(key);
    if (!prompt) return undefined;
    const versions = this.versions(key);
    const selected = this.active.get(key);
    // A selection that no longer resolves falls back rather than dangling.
    // `hydrate` and `deleteVersion` both keep this from happening; the check
    // costs nothing and means a descriptor is never unusable.
    const activeVersionId =
      selected && versions.some(v => v.id === selected) ? selected : versions[0].id;
    return {
      key: prompt.key,
      agent: prompt.agent,
      role: prompt.role,
      label: prompt.label,
      description: prompt.description,
      variables: [...prompt.variables],
      activeVersionId,
      versions,
    };
  }

  /** Every prompt this build declares, in catalogue order. */
  descriptors(): PromptDescriptor[] {
    return BUILT_IN_PROMPTS.map(p => this.descriptor(p.key)).filter(
      (d): d is PromptDescriptor => d !== undefined,
    );
  }

  /**
   * Write a new custom version.
   *
   * The number comes from the per-key high-water mark and never repeats, even
   * across deletions — see `PromptStoreData.nextVersion`. The invariants are
   * run here and travel with the version from this moment on: an edit that
   * drops a guardrail is *accepted*, because an operator may genuinely need to
   * rewrite a preamble and a tool that refuses gets worked around, but it is
   * accepted visibly.
   */
  createVersion(input: CreatePromptVersionInput): PromptVersion {
    const prompt = builtInPrompt(input.key);
    if (!prompt) throw new Error(`prompts: unknown prompt key "${input.key}"`);

    const version = this.nextVersion.get(input.key) ?? 2;
    this.nextVersion.set(input.key, version + 1);

    const created: PromptVersion = {
      id: promptVersionId(input.key, version),
      promptKey: input.key,
      version,
      label: input.label.trim().length > 0 ? input.label.trim() : `Version ${version}`,
      content: input.content,
      createdAt: this.now(),
      builtIn: false,
      contentHash: promptContentHash(input.content),
      notes: input.notes,
      invariants: checkInvariants(input.content, invariantsFor(prompt.key, prompt.variables)),
    };

    const list = this.customVersions.get(input.key) ?? [];
    list.push(created);
    this.customVersions.set(input.key, list);

    if (input.activate !== false) this.active.set(input.key, created.id);

    return { ...created };
  }

  /**
   * Edit a custom version in place.
   *
   * Refuses the built-in for the same reason `deleteVersion` does — it comes
   * from the build, and being unchangeable is what makes it the way back.
   *
   * For a custom version this rewrites history, and deliberately so: an
   * operator iterating on wording should not have to leave a trail of eight
   * near-identical versions to get one right. The cost is real and named here
   * rather than hidden: `contentHash` is recomputed, so a run already recorded
   * against this version id now points at text that is not what it saw. The
   * version number is not reused for anything else and the id is unchanged, so
   * the ledger still resolves — it is the *content* behind it that moved. The
   * UI states this before offering the edit and offers a new version instead;
   * this method is what happens when the operator chooses it anyway.
   *
   * Invariants are recomputed from the new content, never carried over. A
   * version that keeps a stale "all guardrails satisfied" after the text that
   * satisfied them was deleted is the exact failure the check exists to stop.
   */
  updateVersion(input: UpdatePromptVersionInput): PromptVersion {
    const prompt = builtInPrompt(input.key);
    if (!prompt) throw new Error(`prompts: unknown prompt key "${input.key}"`);
    if (input.versionId === promptVersionId(input.key, 1)) {
      throw new Error(
        `prompts: the built-in version of "${input.key}" cannot be edited — it comes from the build and is the way back to the shipped text. Save the change as a new version instead.`,
      );
    }
    const list = this.customVersions.get(input.key) ?? [];
    const index = list.findIndex(v => v.id === input.versionId);
    if (index === -1) throw new Error(`prompts: "${input.versionId}" is not a version of "${input.key}"`);

    const existing = list[index];
    const updated: PromptVersion = {
      ...existing,
      label: input.label.trim().length > 0 ? input.label.trim() : existing.label,
      content: input.content,
      notes: input.notes,
      contentHash: promptContentHash(input.content),
      invariants: checkInvariants(input.content, invariantsFor(prompt.key, prompt.variables)),
    };
    list[index] = updated;
    this.customVersions.set(input.key, list);

    // `activate: false` is not "deactivate" — a version already in force stays
    // in force after an edit. Only an explicit `true` changes the selection.
    if (input.activate === true) this.active.set(input.key, updated.id);

    return { ...updated };
  }

  /** Choose which version is in force. Throws on an id that is not a version of this prompt. */
  setActive(key: string, versionId: string): PromptVersion {
    const prompt = builtInPrompt(key);
    if (!prompt) throw new Error(`prompts: unknown prompt key "${key}"`);
    const match = this.versions(key).find(v => v.id === versionId);
    if (!match) throw new Error(`prompts: "${versionId}" is not a version of "${key}"`);
    if (match.builtIn) {
      // Recorded as an absence rather than as a pointer at the built-in id, so
      // "no selection" and "the built-in was chosen" stay the same state. They
      // behave identically and keeping two spellings of one thing invites a
      // bug where only one of them is handled.
      this.active.delete(key);
    } else {
      this.active.set(key, versionId);
    }
    return match;
  }

  /**
   * Delete a custom version.
   *
   * Refuses the built-in outright: it is not stored here to be deleted, and
   * the way back to the shipped text is the whole reason editing is safe.
   * Deleting the active version clears the selection, which falls the prompt
   * back to the built-in — not to the next-newest custom version, because
   * "your prompt was deleted so we quietly promoted a different edit" is a
   * change nobody asked for, and reverting to the shipped text is the one
   * outcome an operator can reason about.
   */
  deleteVersion(key: string, versionId: string): { deleted: PromptVersion; fellBackToBuiltIn: boolean } {
    const prompt = builtInPrompt(key);
    if (!prompt) throw new Error(`prompts: unknown prompt key "${key}"`);
    if (versionId === promptVersionId(key, 1)) {
      throw new Error(
        `prompts: the built-in version of "${key}" cannot be deleted — it comes from the build and is the way back to the shipped text.`,
      );
    }
    const list = this.customVersions.get(key) ?? [];
    const index = list.findIndex(v => v.id === versionId);
    if (index === -1) throw new Error(`prompts: "${versionId}" is not a version of "${key}"`);
    const [deleted] = list.splice(index, 1);
    if (list.length === 0) this.customVersions.delete(key);
    else this.customVersions.set(key, list);

    const wasActive = this.active.get(key) === versionId;
    if (wasActive) this.active.delete(key);

    return { deleted: { ...deleted }, fellBackToBuiltIn: wasActive };
  }

  /** The durable payload: custom versions and selection only. */
  toData(): PromptStoreData {
    const customVersions: Record<string, PromptVersion[]> = {};
    for (const [key, list] of [...this.customVersions].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      customVersions[key] = list.map(v => ({ ...v }));
    }
    const active: Record<string, string> = {};
    for (const [key, id] of [...this.active].sort((a, b) => (a[0] < b[0] ? -1 : 1))) active[key] = id;
    const nextVersion: Record<string, number> = {};
    for (const [key, n] of [...this.nextVersion].sort((a, b) => (a[0] < b[0] ? -1 : 1))) nextVersion[key] = n;
    return { version: 1, customVersions, active, nextVersion };
  }
}

/* ==================================================================== */
/* The store interface                                                   */
/* ==================================================================== */

export interface PromptStore {
  readonly kind: 'in-memory' | 'persisted';
  ready(): Promise<void>;
  descriptors(): Promise<PromptDescriptor[]>;
  descriptor(key: string): Promise<PromptDescriptor | undefined>;
  createVersion(input: CreatePromptVersionInput): Promise<PromptVersion>;
  updateVersion(input: UpdatePromptVersionInput): Promise<PromptVersion>;
  setActive(key: string, versionId: string): Promise<PromptVersion>;
  deleteVersion(key: string, versionId: string): Promise<{ deleted: PromptVersion; fellBackToBuiltIn: boolean }>;
  snapshot(): Promise<PromptStoreData>;
}

/* ==================================================================== */
/* In-memory store                                                       */
/* ==================================================================== */

/**
 * A store with no persistence at all.
 *
 * This is what the agent layer falls back to when the app has not injected a
 * port: every prompt resolves to its built-in, editing works for the life of
 * the process, and nothing survives a restart. It exists so this package stays
 * runnable with no storage configured — a script exercising an agent directly
 * should not need a blob store to render a system prompt.
 */
export class InMemoryPromptStore implements PromptStore {
  readonly kind = 'in-memory' as const;
  private readonly catalogue: PromptCatalogue;

  constructor(options: PromptStoreOptions = {}) {
    this.catalogue = new PromptCatalogue(options);
  }

  async ready(): Promise<void> {
    /* Nothing to load. */
  }

  async descriptors(): Promise<PromptDescriptor[]> {
    return this.catalogue.descriptors();
  }

  async descriptor(key: string): Promise<PromptDescriptor | undefined> {
    return this.catalogue.descriptor(key);
  }

  async createVersion(input: CreatePromptVersionInput): Promise<PromptVersion> {
    return this.catalogue.createVersion(input);
  }

  async updateVersion(input: UpdatePromptVersionInput): Promise<PromptVersion> {
    return this.catalogue.updateVersion(input);
  }

  async setActive(key: string, versionId: string): Promise<PromptVersion> {
    return this.catalogue.setActive(key, versionId);
  }

  async deleteVersion(key: string, versionId: string) {
    return this.catalogue.deleteVersion(key, versionId);
  }

  async snapshot(): Promise<PromptStoreData> {
    return this.catalogue.toData();
  }
}

/* ==================================================================== */
/* Persisted store                                                       */
/* ==================================================================== */

/**
 * A store that reads and writes through an injected `PromptPersistence` port.
 *
 * The write discipline is `PersistedMemoryStore`'s, for the same reason and in
 * the same shape: the snapshot is taken at queue time so each caller's write
 * carries the state its own mutation produced, and the queue is chained with
 * `.then(run, run)` so one failed write does not wedge every subsequent one
 * behind a rejected promise.
 */
export class PersistedPromptStore implements PromptStore {
  readonly kind = 'persisted' as const;
  private readonly catalogue: PromptCatalogue;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: PromptPersistence,
    options: PromptStoreOptions = {},
  ) {
    this.catalogue = new PromptCatalogue(options);
  }

  ready(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        let data: PromptStoreData | null = null;
        try {
          data = await this.persistence.load();
        } catch (err) {
          // An unreadable prompt store must degrade to "built-ins only" rather
          // than take the agent layer down with it. That degradation is the
          // safe direction by construction: the built-in is the text the
          // evaluation gate was run against.
          console.warn(
            `[prompts] could not load persisted prompt versions, using built-ins only: ${(err as Error).message}`,
          );
          data = null;
        }
        const report = this.catalogue.hydrate(data);
        if (report.dropped > 0 || report.repaired > 0) {
          console.warn(
            `[prompts] loaded ${report.loaded} custom version(s), dropped ${report.dropped} unusable, ` +
              `reverted ${report.repaired} selection(s) to the built-in`,
          );
        }
      })();
    }
    return this.loadPromise;
  }

  private persist(): Promise<void> {
    const payload = this.catalogue.toData();
    const run = (): Promise<void> => this.persistence.save(payload);
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async descriptors(): Promise<PromptDescriptor[]> {
    await this.ready();
    return this.catalogue.descriptors();
  }

  async descriptor(key: string): Promise<PromptDescriptor | undefined> {
    await this.ready();
    return this.catalogue.descriptor(key);
  }

  async createVersion(input: CreatePromptVersionInput): Promise<PromptVersion> {
    await this.ready();
    const created = this.catalogue.createVersion(input);
    await this.persist();
    return created;
  }

  async updateVersion(input: UpdatePromptVersionInput): Promise<PromptVersion> {
    await this.ready();
    const updated = this.catalogue.updateVersion(input);
    await this.persist();
    return updated;
  }

  async setActive(key: string, versionId: string): Promise<PromptVersion> {
    await this.ready();
    const version = this.catalogue.setActive(key, versionId);
    await this.persist();
    return version;
  }

  async deleteVersion(key: string, versionId: string) {
    await this.ready();
    const result = this.catalogue.deleteVersion(key, versionId);
    await this.persist();
    return result;
  }

  async snapshot(): Promise<PromptStoreData> {
    await this.ready();
    return this.catalogue.toData();
  }
}

/* ==================================================================== */
/* Test port                                                             */
/* ==================================================================== */

export interface InMemoryPromptPersistence extends PromptPersistence {
  /** What the port currently holds — the durable side, not the catalogue's view. */
  readonly stored: PromptStoreData | null;
  /** Completed saves. Lets a test assert that a write actually happened. */
  readonly saveCount: number;
  /**
   * How long the nth save takes, in ms.
   *
   * Per-save rather than fixed so a test can give the writes *descending*
   * delays: if the queue were not serialising, a slow first write would finish
   * after a fast second one and the store would end up holding the earlier
   * state. With the queue in place the order is the call order regardless of
   * how long each takes.
   */
  saveDelay: (index: number) => number;
  /**
   * `start:<n>` / `end:<n>` in the order they happened.
   *
   * A serialised queue produces strictly `start:0, end:0, start:1, end:1, …`;
   * any interleaving shows up here as two starts in a row.
   */
  readonly events: readonly string[];
}

/**
 * A `PromptPersistence` backed by an object.
 *
 * Shipped rather than left to each test to reinvent, and it deep-copies on
 * both sides: a port that handed back the very objects the catalogue holds
 * would make a test pass even if the store never serialised anything.
 */
export function createInMemoryPromptPersistence(
  seed: PromptStoreData | null = null,
): InMemoryPromptPersistence {
  let data: PromptStoreData | null = seed ? (JSON.parse(JSON.stringify(seed)) as PromptStoreData) : null;
  let started = 0;
  let saves = 0;
  const events: string[] = [];
  const port: InMemoryPromptPersistence = {
    async load() {
      return data ? (JSON.parse(JSON.stringify(data)) as PromptStoreData) : null;
    },
    async save(next) {
      const index = started++;
      events.push(`start:${index}`);
      const snapshot = JSON.parse(JSON.stringify(next)) as PromptStoreData;
      const ms = port.saveDelay(index);
      if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
      data = snapshot;
      saves++;
      events.push(`end:${index}`);
    },
    get stored() {
      return data ? (JSON.parse(JSON.stringify(data)) as PromptStoreData) : null;
    },
    get saveCount() {
      return saves;
    },
    get events() {
      return [...events];
    },
    saveDelay: () => 0,
  };
  return port;
}
