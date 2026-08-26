/**
 * The memory ledger and the two stores built on it.
 *
 * ## Accretion, not mutation
 *
 * Nothing here deletes. A fact that is contradicted by a later one is marked
 * `supersededById` and stays in the ledger, because "we used to believe the
 * Kaveri portal answered, and we corrected that on 14 May" is itself a fact a
 * diligence tool should be able to produce. Recall hides superseded facts by
 * default — a prompt full of retracted beliefs is worse than no memory — but it
 * counts them in `excludedCount` so the omission is visible rather than silent,
 * and `MemoryQuery.asOf` can wind knowledge time back and return them.
 *
 * ## Why supersession is driven by a cardinality table
 *
 * "Contradiction" is not something you can read off two facts. `party:x
 * appeared_as owner` and `party:x appeared_as tenant` are both true; `source:y
 * reachability fetched` and `source:y reachability blocked_captcha` cannot be.
 * The difference is a property of the predicate, so it is declared in
 * `DEFAULT_CARDINALITY` rather than guessed. Unknown predicates default to
 * `single` — see the note on `PredicateCardinality`.
 *
 * ## Durability
 *
 * `PersistedMemoryStore` writes through to its port on every mutation and does
 * not resolve until that write has. No debouncing, no timers, no background
 * flush: Valytica runs on serverless, where the process can be frozen the
 * instant the response is sent, and a scheduled write there is a write that
 * never happens. Concurrent writes are chained through a single queue, exactly
 * as `apps/api/src/storage/filesystem.ts` chains its temp-file-then-rename, so
 * two requests resolving together cannot interleave their saves.
 *
 * This file imports nothing from the title graph and emits nothing typed as a
 * `TitleNode` or `TitleEdge`; see the header of `types.ts` for why that boundary
 * is structural rather than stylistic.
 */

import type { MemoryFact, MemoryScope } from '@valytica/shared';
import type {
  CardinalityResolver,
  MemoryAssertion,
  MemoryFactInput,
  MemoryPersistence,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
  MemoryStoreOptions,
  PredicateCardinality,
  RankedMemoryFact,
} from './types';

/* ==================================================================== */
/* Small deterministic helpers                                          */
/* ==================================================================== */

const MS_PER_DAY = 86_400_000;

/**
 * Recency half-life for ranking. Six months: long enough that a case from last
 * quarter still counts, short enough that a two-year-old rate observation does
 * not outrank a fresh one.
 */
export const DEFAULT_HALF_LIFE_DAYS = 180;

/** Default cap on a recall. Chosen to stay well inside a prompt budget. */
export const DEFAULT_RECALL_LIMIT = 40;

/** Separator for identity tuples: a unit separator cannot occur in a subject or object. */
const UNIT_SEP = '\u001f';

/**
 * FNV-1a, run twice with different offsets to give 64 bits.
 *
 * Ids must be derivable from content and nothing else: `extractFactsFromCase` is
 * deterministic and gets re-run over the same cases, and an id built from a UUID
 * or a clock would make every re-run look like new knowledge.
 */
function fnv1a64Hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** The tuple that makes two facts the same fact. */
export function memoryFactIdentity(f: {
  scope: MemoryScope;
  subject: string;
  predicate: string;
  object: string;
  sourceCaseId: string;
}): string {
  return [f.scope, f.subject, f.predicate, f.object, f.sourceCaseId].join(UNIT_SEP);
}

/** Stable id for a fact, derived from its identity tuple. */
export function memoryFactId(f: Parameters<typeof memoryFactIdentity>[0]): string {
  return `mem-${fnv1a64Hex(memoryFactIdentity(f))}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * `Date.parse` with an explicit fallback, so one malformed timestamp cannot turn
 * every comparison into `NaN` and quietly empty a recall.
 */
function timeOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t;
}

/* ==================================================================== */
/* Predicate cardinality                                                */
/* ==================================================================== */

/**
 * Which predicates hold one value and which accumulate.
 *
 * Keyed by predicate alone rather than by scope and predicate: predicate names
 * are already scope-specific by construction (`reachability` only ever describes
 * a source), and a flat table is easier to read than a nested one.
 */
export const DEFAULT_CARDINALITY: Record<string, PredicateCardinality> = {
  /* party — a party accumulates roles and spellings across cases. */
  appeared_as: 'multi',
  known_as: 'multi',

  /* locality — every case contributes an observation; the set is the signal. */
  observed_rate_per_sqm: 'multi',
  guidance_value_gap_pct: 'multi',
  guidance_value_exceeds_consideration: 'multi',
  recurring_risk_code: 'multi',

  /* source_reliability — only the current answer is actionable. */
  reachability: 'single',
  access: 'single',
  would_have_answered: 'single',

  /* procedure — current feasibility supersedes; what it was recommended for accumulates. */
  feasibility: 'single',
  authority: 'single',
  recommended_for: 'multi',

  /* user_preference — one persona, many observed dispositions. */
  persona: 'single',
  accepts_risk_category: 'multi',
  mitigates_risk_category: 'multi',
  accepts_risk_code: 'multi',
  mitigates_risk_code: 'multi',
};

export const defaultCardinality: CardinalityResolver = predicate =>
  DEFAULT_CARDINALITY[predicate] ?? 'single';

/* ==================================================================== */
/* The ledger                                                           */
/* ==================================================================== */

function copy(f: MemoryFact): MemoryFact {
  return { ...f };
}

/**
 * The synchronous core: supersession, bi-temporal filtering and ranking.
 *
 * Kept free of persistence so both stores share exactly one implementation of
 * the rules — a second copy of the supersession logic behind an async facade is
 * how the two would drift apart.
 */
export class MemoryLedger {
  private facts: MemoryFact[] = [];
  private byId = new Map<string, MemoryFact>();

  constructor(private readonly cardinality: CardinalityResolver = defaultCardinality) {}

  /**
   * Replace the ledger contents wholesale — used when loading from persistence.
   *
   * Repairs two things on the way in, because a store that silently honours
   * corrupt state is worse than one that fixes it loudly:
   * - entries missing a required field are dropped;
   * - a `supersededById` pointing at an id that is not present is cleared, since
   *   a dangling pointer would bury a fact forever with nothing visible to
   *   explain why.
   */
  hydrate(facts: MemoryFact[]): { loaded: number; dropped: number; repaired: number } {
    const usable = facts.filter(
      f =>
        !!f &&
        typeof f.id === 'string' &&
        typeof f.subject === 'string' &&
        typeof f.predicate === 'string' &&
        typeof f.object === 'string' &&
        typeof f.assertedAt === 'string' &&
        typeof f.validFrom === 'string',
    );
    const ids = new Set(usable.map(f => f.id));
    let repaired = 0;
    this.facts = usable.map(f => {
      if (f.supersededById && !ids.has(f.supersededById)) {
        repaired++;
        const { supersededById: _dangling, ...rest } = f;
        return { ...rest };
      }
      return copy(f);
    });
    this.byId = new Map(this.facts.map(f => [f.id, f]));
    return { loaded: this.facts.length, dropped: facts.length - usable.length, repaired };
  }

  /** Everything, superseded and expired included. Copies, so callers cannot mutate the ledger. */
  all(): MemoryFact[] {
    return this.facts.map(copy);
  }

  size(): number {
    return this.facts.length;
  }

  clear(): void {
    this.facts = [];
    this.byId = new Map();
  }

  /**
   * Give a fact an id that is stable for its content and unique in this ledger.
   *
   * A fact re-asserted after having been superseded has the same identity tuple
   * as the buried one, so the derived id collides. Rather than reuse the id (and
   * lose the earlier belief) the revival gets a numbered suffix.
   */
  private allocateId(base: string): string {
    if (!this.byId.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}-r${n}`;
      if (!this.byId.has(candidate)) return candidate;
    }
    throw new Error(`memory: could not allocate an id for ${base}`);
  }

  assert(input: MemoryFactInput): MemoryAssertion {
    const identity = memoryFactIdentity(input);

    // Idempotence first. Re-running extraction over an unchanged case must be a
    // no-op, or every run would double the store and inflate every "how often
    // has this recurred" count that reads it.
    const existing = this.facts.find(f => !f.supersededById && memoryFactIdentity(f) === identity);
    if (existing) {
      return { fact: copy(existing), superseded: [], deduplicated: true, arrivedSuperseded: false };
    }

    const id = this.allocateId(input.id ?? memoryFactId(input));
    const fact: MemoryFact = {
      ...input,
      id,
      confidence: clamp01(input.confidence),
    };
    delete (fact as { supersededById?: string }).supersededById;

    const superseded: MemoryFact[] = [];
    let arrivedSuperseded = false;

    if (this.cardinality(fact.predicate, fact.scope) === 'single') {
      const rivals = this.facts.filter(
        f =>
          !f.supersededById &&
          f.scope === fact.scope &&
          f.subject === fact.subject &&
          f.predicate === fact.predicate &&
          f.object !== fact.object,
      );
      const incomingAt = timeOf(fact.assertedAt, 0);
      // Anything already known that was asserted *later* than this arrival is
      // newer knowledge. Cases are not processed in order, so old news does turn
      // up after a correction, and it must not clobber it.
      const newer = rivals
        .filter(r => timeOf(r.assertedAt, 0) > incomingAt)
        .sort((a, b) => timeOf(b.assertedAt, 0) - timeOf(a.assertedAt, 0));
      if (newer.length > 0) {
        fact.supersededById = newer[0].id;
        arrivedSuperseded = true;
      } else {
        // Equal timestamps count as "not newer", so the last assertion at a
        // given instant wins. Deterministic, and the only alternative — refusing
        // to choose — would leave two contradictions live.
        for (const rival of rivals) {
          const updated: MemoryFact = { ...rival, supersededById: fact.id };
          const idx = this.facts.indexOf(rival);
          this.facts[idx] = updated;
          this.byId.set(updated.id, updated);
          superseded.push(copy(updated));
        }
      }
    }

    this.facts.push(fact);
    this.byId.set(fact.id, fact);
    return { fact: copy(fact), superseded, deduplicated: false, arrivedSuperseded };
  }

  /** Was this fact superseded *as far as we knew* at `asOfMs`? */
  private supersededAsOf(f: MemoryFact, asOfMs: number): boolean {
    if (!f.supersededById) return false;
    const by = this.byId.get(f.supersededById);
    // A dangling pointer is treated as "still live" — `hydrate` clears them, and
    // burying a fact because of a broken reference is the one failure mode this
    // design is meant to rule out.
    if (!by) return false;
    return timeOf(by.assertedAt, 0) <= asOfMs;
  }

  query(q: MemoryQuery): MemoryQueryResult {
    const nowMs = timeOf(q.now, 0);
    const asOfMs = q.asOf ? timeOf(q.asOf, nowMs) : nowMs;
    const validAtMs = q.validAt ? timeOf(q.validAt, asOfMs) : asOfMs;
    const halfLife = q.halfLifeDays && q.halfLifeDays > 0 ? q.halfLifeDays : DEFAULT_HALF_LIFE_DAYS;

    const subjects = q.subjects && q.subjects.length > 0 ? new Set(q.subjects) : null;
    const scopes = q.scopes && q.scopes.length > 0 ? new Set<MemoryScope>(q.scopes) : null;
    const predicates = q.predicates && q.predicates.length > 0 ? new Set(q.predicates) : null;
    const excludedCases =
      q.excludeCaseIds && q.excludeCaseIds.length > 0 ? new Set(q.excludeCaseIds) : null;
    const minConfidence = q.minConfidence ?? 0;

    let excludedCount = 0;
    const matched: RankedMemoryFact[] = [];

    for (const f of this.facts) {
      if (subjects && !subjects.has(f.subject)) continue;
      if (scopes && !scopes.has(f.scope)) continue;
      if (predicates && !predicates.has(f.predicate)) continue;
      // Case exclusion is applied before the superseded/expired accounting on
      // purpose: a fact this very case taught us is not an *omission* the reader
      // needs to see, it is simply out of scope for cross-case recall.
      if (excludedCases && excludedCases.has(f.sourceCaseId)) continue;
      // Knowledge time: not yet asserted at `asOf` means it does not exist yet.
      if (timeOf(f.assertedAt, 0) > asOfMs) continue;
      if (f.confidence < minConfidence) continue;

      if (!q.includeSuperseded && this.supersededAsOf(f, asOfMs)) {
        excludedCount++;
        continue;
      }
      if (!q.includeExpired) {
        const from = timeOf(f.validFrom, Number.NEGATIVE_INFINITY);
        const to = f.validTo ? timeOf(f.validTo, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
        if (validAtMs < from || validAtMs >= to) {
          excludedCount++;
          continue;
        }
      }

      const ageDays = Math.max(0, (nowMs - timeOf(f.assertedAt, nowMs)) / MS_PER_DAY);
      const score = f.confidence * Math.pow(0.5, ageDays / halfLife);
      matched.push({ fact: copy(f), score, ageDays });
    }

    // Confidence x recency, then newest, then id — the last term only so the
    // order is total and a recall renders identically on every run.
    matched.sort(
      (a, b) =>
        b.score - a.score ||
        timeOf(b.fact.assertedAt, 0) - timeOf(a.fact.assertedAt, 0) ||
        (a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0),
    );

    let kept = matched;
    const perScopeLimit = q.perScopeLimit;
    if (perScopeLimit && perScopeLimit > 0) {
      const seen = new Map<MemoryScope, number>();
      kept = kept.filter(r => {
        const n = (seen.get(r.fact.scope) ?? 0) + 1;
        seen.set(r.fact.scope, n);
        return n <= perScopeLimit;
      });
    }
    if (q.limit && q.limit > 0 && kept.length > q.limit) kept = kept.slice(0, q.limit);

    return {
      facts: kept.map(r => r.fact),
      ranked: kept,
      consultedSubjects: q.subjects ? [...q.subjects] : [],
      excludedCount,
      truncatedCount: matched.length - kept.length,
    };
  }
}

/* ==================================================================== */
/* In-memory store                                                      */
/* ==================================================================== */

/**
 * A store with no persistence at all.
 *
 * For tests, for scripts, and for a deployment that has deliberately turned
 * memory off — the interface stays satisfied so callers need no branch, and
 * everything is forgotten when the process ends.
 */
export class InMemoryMemoryStore implements MemoryStore {
  readonly kind = 'in-memory' as const;
  private readonly ledger: MemoryLedger;

  constructor(options: MemoryStoreOptions = {}) {
    this.ledger = new MemoryLedger(options.cardinality);
  }

  async ready(): Promise<void> {
    /* Nothing to load. */
  }

  async assert(fact: MemoryFactInput): Promise<MemoryAssertion> {
    return this.ledger.assert(fact);
  }

  async assertMany(facts: MemoryFactInput[]): Promise<MemoryAssertion[]> {
    return facts.map(f => this.ledger.assert(f));
  }

  async query(q: MemoryQuery): Promise<MemoryQueryResult> {
    return this.ledger.query(q);
  }

  async snapshot(): Promise<MemoryFact[]> {
    return this.ledger.all();
  }

  async clear(): Promise<void> {
    this.ledger.clear();
  }
}

/* ==================================================================== */
/* Persisted store                                                      */
/* ==================================================================== */

/**
 * A store that reads and writes through an injected `MemoryPersistence` port.
 *
 * The port is injected rather than imported so this package never depends on the
 * API layer: `apps/api` implements the port over its `StorageAdapter`
 * (filesystem locally, Vercel Blob in deployment) and hands it in. Nothing in
 * this file knows whether it is talking to a disk, a blob store or an array.
 */
export class PersistedMemoryStore implements MemoryStore {
  readonly kind = 'persisted' as const;
  private readonly ledger: MemoryLedger;
  private loadPromise: Promise<void> | null = null;
  /**
   * Single write chain, mirroring `apps/api/src/storage/filesystem.ts`.
   *
   * `.then(run, run)` rather than `.then(run)` so one failed write does not wedge
   * every subsequent one behind a rejected promise.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: MemoryPersistence,
    options: MemoryStoreOptions = {},
  ) {
    this.ledger = new MemoryLedger(options.cardinality);
  }

  ready(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        let loaded: MemoryFact[] = [];
        try {
          loaded = (await this.persistence.load()) ?? [];
        } catch (err) {
          // Memory is an enhancement, never a dependency. An unreadable store
          // must degrade to "no history" rather than take a case down with it.
          console.warn(
            `[memory] could not load persisted facts, starting empty: ${(err as Error).message}`,
          );
          loaded = [];
        }
        const report = this.ledger.hydrate(loaded);
        if (report.dropped > 0 || report.repaired > 0) {
          console.warn(
            `[memory] loaded ${report.loaded} facts, dropped ${report.dropped} malformed, ` +
              `repaired ${report.repaired} dangling supersession pointers`,
          );
        }
      })();
    }
    return this.loadPromise;
  }

  /**
   * Queue a durable write of the ledger as it stands right now.
   *
   * The snapshot is taken at queue time, not at run time, so each caller's write
   * carries the state its own mutation produced — the same per-call semantics
   * the filesystem adapter has.
   */
  private persist(): Promise<void> {
    const payload = this.ledger.all();
    const run = (): Promise<void> => this.persistence.save(payload);
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async assert(fact: MemoryFactInput): Promise<MemoryAssertion> {
    await this.ready();
    const result = this.ledger.assert(fact);
    // A deduplicated assertion changed nothing, so there is nothing to make
    // durable — skipping the write keeps a re-run of extraction from rewriting
    // the whole store for no reason.
    if (!result.deduplicated) await this.persist();
    return result;
  }

  async assertMany(facts: MemoryFactInput[]): Promise<MemoryAssertion[]> {
    await this.ready();
    const results = facts.map(f => this.ledger.assert(f));
    if (results.some(r => !r.deduplicated)) await this.persist();
    return results;
  }

  async query(q: MemoryQuery): Promise<MemoryQueryResult> {
    await this.ready();
    return this.ledger.query(q);
  }

  async snapshot(): Promise<MemoryFact[]> {
    await this.ready();
    return this.ledger.all();
  }

  async clear(): Promise<void> {
    await this.ready();
    this.ledger.clear();
    await this.persist();
  }
}

/* ==================================================================== */
/* Test port                                                            */
/* ==================================================================== */

export interface InMemoryPersistence extends MemoryPersistence {
  /** What the port currently holds — the durable side, not the ledger's view. */
  readonly stored: MemoryFact[];
  /** Completed saves. Lets a test assert that a write actually happened. */
  readonly saveCount: number;
}

/**
 * A `MemoryPersistence` backed by an array.
 *
 * Shipped rather than left to each test to reinvent, and it copies on both
 * sides: a port that handed back the very objects the ledger holds would make a
 * test pass even if the store never serialised anything.
 */
export function createInMemoryPersistence(seed: MemoryFact[] = []): InMemoryPersistence {
  let facts: MemoryFact[] = seed.map(f => ({ ...f }));
  let saves = 0;
  return {
    async load() {
      return facts.map(f => ({ ...f }));
    },
    async save(next) {
      facts = next.map(f => ({ ...f }));
      saves++;
    },
    get stored() {
      return facts.map(f => ({ ...f }));
    },
    get saveCount() {
      return saves;
    },
  };
}
