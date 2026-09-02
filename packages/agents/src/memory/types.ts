/**
 * Cross-case agent memory — contracts.
 *
 * ## What this is, and what it deliberately is not
 *
 * Every case in Realytica currently starts from nothing. The same promoter, the
 * same locality, the same registry counter and the same unreachable portal recur
 * across cases and none of it is retained. This module is the store that retains
 * it.
 *
 * It is a **separate structure from the title graph** (`TitleNode` / `TitleEdge`
 * in `@realytica/shared`), and that separation is the single most important
 * property of the design — not an implementation detail that could be tidied
 * away later.
 *
 * The title graph is a legal object. It is built deterministically from
 * documents, its ontology is closed, and a wrong edge in it is a liability.
 * Memory is the opposite: it is loose, accretive, derived from heuristics, and
 * explicitly **allowed to be wrong**. If the two shared a structure, "we think
 * this promoter is unreliable" would sit next to "this deed conveys 2,400 sqft"
 * with the same apparent standing. That is precisely the confusion that makes AI
 * output unusable in a diligence context, so it is prevented structurally:
 *
 * - nothing in `src/memory/` imports from `packages/shared/src/graph/`;
 * - nothing in `src/memory/` emits, accepts or re-exports a `TitleNode`,
 *   `TitleEdge`, `TitleGraph` or any of their satellites;
 * - a memory item is never evidence. `renderMemoryForPrompt` says so in the
 *   prompt text itself, because a model handed a bare list of remembered claims
 *   will cite them.
 *
 * The trade-off accepted here is that memory and the graph will sometimes hold
 * overlapping claims about the same party, and reconciling them is left to the
 * human reading the screen. That duplication is cheap. Conflating the two
 * standings of evidence is not.
 *
 * ## Bi-temporality
 *
 * Every fact carries two independent time axes, for the same reason the title
 * graph does:
 *
 * - **World time** (`validFrom` / `validTo`) — when the fact was true out there.
 *   A guidance-value gap observed in March 2025 stops being informative about
 *   the market a year later, so observations expire.
 * - **Knowledge time** (`assertedAt`) — when we came to believe it.
 *
 * A fact that was true and has since changed is a different animal from a fact
 * we have just corrected, and the only way to keep the two distinguishable is to
 * record both axes and never delete. A contradicting later fact therefore
 * **supersedes** rather than replaces: the old fact stays, with `supersededById`
 * pointing at whatever displaced it, and `queryAsOf` can wind knowledge time
 * back to before the correction and return the old belief. That is the whole
 * point of bi-temporality; if it does not actually work it is just two extra
 * fields.
 */

import type { MemoryFact, MemoryScope } from '@realytica/shared';

/* ==================================================================== */
/* Facts in, facts out                                                  */
/* ==================================================================== */

/**
 * A fact as a caller supplies it.
 *
 * `id` is optional — the store derives a stable one from the fact's identity
 * tuple when it is absent, so callers that do not care about ids (a REPL, a
 * one-off backfill) need not invent them, while `extractFactsFromCase` can
 * supply its own deterministic ids and get idempotent re-ingestion.
 *
 * `supersededById` is deliberately *not* accepted. Supersession is a conclusion
 * the store reaches by comparing assertions; letting a caller assert it directly
 * would allow a fact to be buried without anything having contradicted it.
 */
export type MemoryFactInput = Omit<MemoryFact, 'id' | 'supersededById'> & { id?: string };

/**
 * Whether a predicate can hold several values for one subject at once.
 *
 * This is the knob that decides what "contradiction" means, so it is explicit
 * rather than inferred.
 *
 * - `single` — the subject has one current value. A different value asserted
 *   later is a correction and supersedes. `source:kaveri reachability` is the
 *   archetype: it answered last month and captchas today, and only today's
 *   answer should reach a prompt.
 * - `multi` — values accumulate. `party:x appeared_as owner` and
 *   `... appeared_as tenant` are both true, and one case seeing a party as an
 *   owner must not bury another case seeing them as a tenant.
 *
 * The default for an unrecognised predicate is `single`. That is the safer
 * default in a diligence tool: an over-eager supersession hides a fact but keeps
 * it retrievable and counted in `excludedCount`, whereas a missed supersession
 * puts two contradictory statements in front of the model with nothing to
 * separate them.
 */
export type PredicateCardinality = 'single' | 'multi';

/** Decides cardinality for a predicate. Overridable per store. */
export type CardinalityResolver = (predicate: string, scope: MemoryScope) => PredicateCardinality;

/** What one `assert` actually did. Returned so callers can log or test it. */
export interface MemoryAssertion {
  /** The fact as it now stands in the store. */
  fact: MemoryFact;
  /**
   * Facts this assertion displaced, in their updated (superseded) form. Never
   * removed from the store — a superseded fact is still the truth about what we
   * used to believe.
   */
  superseded: MemoryFact[];
  /**
   * True when an identical fact already stood and nothing changed. Re-running
   * `extractFactsFromCase` over the same case must be a no-op, so this is the
   * common case in practice rather than an edge case.
   */
  deduplicated: boolean;
  /**
   * True when the *incoming* fact arrived already stale — something newer on the
   * same subject and predicate was already known, so the arrival was filed as
   * superseded on the way in rather than being allowed to clobber later
   * knowledge. Late-arriving old news is a normal event once cases are processed
   * out of order.
   */
  arrivedSuperseded: boolean;
}

/* ==================================================================== */
/* Querying                                                             */
/* ==================================================================== */

/**
 * A read against memory.
 *
 * The two time parameters are independent on purpose, because they answer
 * different questions:
 *
 * - `asOf` rewinds **knowledge** time: "what did we believe on 1 March?" A fact
 *   asserted after `asOf` is invisible, and a fact superseded after `asOf` is
 *   still live.
 * - `validAt` rewinds **world** time: "what held in the world on 1 March?" A
 *   fact whose `validFrom`/`validTo` window excludes that instant is expired (or
 *   not yet in force).
 *
 * Supplying only `asOf` sets `validAt` to the same instant, because "as we knew
 * it at T" almost always means "and as it stood at T" too. Supplying both is how
 * you ask the genuinely bi-temporal question — "on 1 June, what did we believe
 * about how things stood in March?"
 */
export interface MemoryQuery {
  /** Normalised subject keys, e.g. `party:ramaiah-k`. Empty/absent matches all. */
  subjects?: string[];
  scopes?: MemoryScope[];
  predicates?: string[];
  /** Facts from these cases are skipped entirely — see `recallForCase`. */
  excludeCaseIds?: string[];
  /**
   * Which workspaces' facts may be recalled.
   *
   * `null` in the list means facts with no workspace on them — everything
   * learned before the field existed. A value rather than a flag, because who
   * those belong to is the caller's call and there is no answer this layer
   * could pick that is right on both a single-firm install and a shared one.
   *
   * Absent means no constraint. That is what a migration or a test wants, and
   * what no recall on behalf of a signed-in person should ever be.
   */
  tenants?: readonly (string | null)[];
  /** Knowledge time. Defaults to `now`. */
  asOf?: string;
  /** World time. Defaults to `asOf`, which defaults to `now`. */
  validAt?: string;
  /** Reference instant for recency ranking, and the default for both axes. */
  now: string;
  /** Include facts superseded as at `asOf`. Off by default. */
  includeSuperseded?: boolean;
  /** Include facts whose validity window excludes `validAt`. Off by default. */
  includeExpired?: boolean;
  minConfidence?: number;
  /** Half-life in days for the recency term of the rank. */
  halfLifeDays?: number;
  /** Hard cap on returned facts, applied after ranking. */
  limit?: number;
  /** Cap per scope, applied before the overall `limit`. */
  perScopeLimit?: number;
}

export interface RankedMemoryFact {
  fact: MemoryFact;
  /** `confidence` × recency decay. Deterministic given the query's `now`. */
  score: number;
  /** Days between `assertedAt` and the query's `now`, for explaining the rank. */
  ageDays: number;
}

export interface MemoryQueryResult {
  facts: MemoryFact[];
  /** Same facts with their scores, for callers that want to explain the ordering. */
  ranked: RankedMemoryFact[];
  /**
   * Subjects the query asked about, echoed back even when they matched nothing.
   *
   * "No history for this promoter" is a useful answer and must be visible.
   * A recall that silently returns an empty list is indistinguishable from a
   * lookup that never ran.
   */
  consultedSubjects: string[];
  /**
   * Facts held back because they were superseded or had expired. Counted, not
   * hidden — an omission the reader cannot see is worse than no filter at all.
   */
  excludedCount: number;
  /** Facts dropped purely by `limit`/`perScopeLimit`, so truncation is visible too. */
  truncatedCount: number;
}

/* ==================================================================== */
/* Persistence port                                                     */
/* ==================================================================== */

/**
 * Where memory is kept.
 *
 * Deliberately two methods over the whole fact set rather than a record-level
 * CRUD interface. The app's `StorageAdapter` (see `apps/api/src/storage/`) is
 * whole-document too — it reads and writes one JSON blob — and a port that
 * promised per-record writes would be a lie on top of it. Memory is small (facts
 * are a few hundred bytes and a busy install accumulates thousands, not
 * millions), so rewriting the set is honest and cheap.
 *
 * `save` **must be durable by the time it resolves**. Realytica deploys to
 * serverless, where the process can be frozen the instant the HTTP response is
 * sent: a scheduled write is a write that never happens. That rules out
 * debouncing, `setTimeout` flushes and fire-and-forget background saves, and it
 * is why `MemoryStore`'s mutators are all `async` and all await their write.
 */
export interface MemoryPersistence {
  /** Everything ever asserted, superseded facts included. `[]` when empty. */
  load(): Promise<MemoryFact[]>;
  /** Replace the stored set. Resolves only once the write is durable. */
  save(facts: MemoryFact[]): Promise<void>;
}

/* ==================================================================== */
/* The store                                                            */
/* ==================================================================== */

export interface MemoryStoreOptions {
  /** Override the built-in predicate cardinality table. */
  cardinality?: CardinalityResolver;
}

/**
 * The read/write surface over memory.
 *
 * Small on purpose. Everything domain-specific — which subjects a case touches,
 * what a completed case teaches, how a recall is rendered for a prompt — lives
 * in `recall.ts` and `learn.ts` and is expressed in terms of this interface, so
 * the store stays a store.
 */
export interface MemoryStore {
  /** Named in the boot log so it is obvious which backend is live. */
  readonly kind: 'in-memory' | 'persisted';

  /**
   * Load from the persistence port if that has not happened yet.
   *
   * Idempotent and safe to call concurrently — the load is itself serialised, so
   * two requests racing on a cold instance do not both read and then fight over
   * the result.
   */
  ready(): Promise<void>;

  assert(fact: MemoryFactInput): Promise<MemoryAssertion>;

  /**
   * Assert a batch. One durable write for the batch rather than one per fact —
   * still durable by the time it resolves, which is the property that matters.
   * Facts are applied in the order given, so a batch that contradicts itself
   * ends with the last assertion standing.
   */
  assertMany(facts: MemoryFactInput[]): Promise<MemoryAssertion[]>;

  query(q: MemoryQuery): Promise<MemoryQueryResult>;

  /** Every fact, superseded and expired ones included. For export and inspection. */
  snapshot(): Promise<MemoryFact[]>;

  /**
   * Forget what these cases taught, and answer how many facts went.
   *
   * The one deletion in a store built on the principle that nothing is
   * deleted, and the distinction is worth being exact about: supersession is
   * how memory handles being *wrong*, and the old belief is kept because "we
   * used to think this" is itself a fact. This is not that. It is erasure —
   * the case is gone, and a fact naming its owner, its reference and its
   * locality has no subject any more. Keeping it would make "delete the
   * project" a lie in the one direction that matters.
   */
  forget(caseIds: readonly string[]): Promise<number>;

  /** Forget everything. Used by the demo reset, not by ordinary operation. */
  clear(): Promise<void>;
}
