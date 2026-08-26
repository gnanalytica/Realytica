/**
 * Cross-case agent memory.
 *
 * What the system has learned across cases: which promoters recur, what a
 * locality's guidance-value gap looked like last time, which registry portal
 * answered and which captcha-walled us, which proof route worked, and what this
 * user habitually accepts rather than mitigates.
 *
 * ## The boundary this module exists on the other side of
 *
 * This is **not** the title graph and must never become a section of it. The
 * title graph (`TitleNode` / `TitleEdge` in `@valytica/shared`) is a legal
 * object built deterministically from documents, with a closed ontology, where a
 * wrong edge is a liability. Memory is loose, accretive, heuristic and expressly
 * allowed to be wrong.
 *
 * Keeping them apart is enforced structurally, not by convention:
 *
 * - nothing under `src/memory/` imports from `packages/shared/src/graph/`;
 * - nothing under `src/memory/` accepts, emits or re-exports a `TitleNode`,
 *   `TitleEdge`, `TitleGraph` or any of their satellites — party facts are
 *   derived from extracted document fields, not from the graph's party nodes,
 *   even though the graph has the tidier view;
 * - `renderMemoryForPrompt` states in the prompt itself that a memory item is
 *   context and never evidence, because a model handed a list of remembered
 *   claims will otherwise cite them.
 *
 * If the two were merged, "we think this promoter is unreliable" would sit
 * beside "this deed conveys 2,400 sqft" with the same apparent standing. That
 * confusion is precisely what makes AI output unusable in diligence, so the
 * separation is a product requirement rather than a tidiness preference.
 *
 * ## Wiring
 *
 * `MemoryStore` takes an injected `MemoryPersistence` port so this package never
 * depends on the API layer. `apps/api` implements that port over its
 * `StorageAdapter` — filesystem locally, Vercel Blob in deployment — and hands
 * it to `PersistedMemoryStore`. `InMemoryMemoryStore` and
 * `createInMemoryPersistence` cover tests and any deployment that has memory
 * switched off.
 */

export type {
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

export type { NormalisedSubject, SubjectKind } from './subjects';
export {
  SCOPE_FOR_SUBJECT_KIND,
  dedupeSubjects,
  localitySubject,
  looksLikePartyName,
  parseSubjectKey,
  partySubject,
  procedureSubject,
  sourceSubject,
  subjectFor,
  userSubject,
} from './subjects';

export type { InMemoryPersistence } from './store';
export {
  DEFAULT_CARDINALITY,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_RECALL_LIMIT,
  InMemoryMemoryStore,
  MemoryLedger,
  PersistedMemoryStore,
  createInMemoryPersistence,
  defaultCardinality,
  memoryFactId,
  memoryFactIdentity,
} from './store';

export type { ExtractFactsOptions, MemoryHorizons, PartyMention, ReachabilityValue } from './learn';
export { DEFAULT_HORIZONS, extractFactsFromCase, partyMentionsInCase } from './learn';

export type { RecallOptions, RenderMemoryOptions, SubjectsForCaseOptions } from './recall';
export { recallForCase, renderMemoryForPrompt, subjectsForCase } from './recall';
