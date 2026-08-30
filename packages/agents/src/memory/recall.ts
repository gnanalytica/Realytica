/**
 * Reading memory back for a case, and rendering it for a prompt.
 *
 * ## Why `consultedSubjects` is not optional
 *
 * A recall that returns an empty list of facts is ambiguous in the worst
 * possible way: it looks identical whether we asked about this promoter and
 * found nothing, or never asked at all. "No history for this promoter" is a real
 * and useful answer — it is the difference between an unknown seller and a
 * seller we have screened twice before — so every subject the case resolved to
 * is echoed back whether it hit or not, and the prompt renderer prints the
 * misses explicitly rather than leaving a blank.
 *
 * The same reasoning drives `excludedCount`: facts held back for being
 * superseded or expired are counted, never silently dropped. An omission the
 * reader cannot see is worse than no filter at all.
 *
 * ## The privacy boundary
 *
 * Memory holds party names — that is most of its value. `renderCaseContext` in
 * `context.ts` already strips owner, address and document contents before
 * anything reaches the market-research agent, because that agent talks to an
 * external search service. Memory would quietly undo that: a locality recall
 * dragging "we have seen K. Ramaiah as owner on three cases" into an external
 * prompt leaks exactly what the `externalSafe` flag exists to withhold.
 *
 * So `renderMemoryForPrompt` returns the empty string for `externalSafe`
 * contexts. Not a filtered subset, not names-only-redacted — nothing. Filtering
 * per scope would mean a future scope, or a future predicate on an existing
 * scope, could reintroduce a name without anyone noticing; refusing outright is
 * the version that stays correct as the schema grows.
 */

import type { MemoryFact, MemoryRecall, MemoryScope, PropertyCase } from '@realytica/shared';
import { partyMentionsInCase } from './learn';
import { DEFAULT_HALF_LIFE_DAYS, DEFAULT_RECALL_LIMIT } from './store';
import type { MemoryStore } from './types';
import {
  dedupeSubjects,
  localitySubject,
  parseSubjectKey,
  procedureSubject,
  sourceSubject,
  userSubject,
  type NormalisedSubject,
  type SubjectKind,
} from './subjects';

/* ==================================================================== */
/* Which subjects a case touches                                        */
/* ==================================================================== */

/**
 * One case can name a lot of sources. Capping per kind keeps a pathological
 * case from turning a recall into a scan, and keeps `consultedSubjects` short
 * enough to actually read.
 */
const DEFAULT_MAX_SUBJECTS_PER_KIND = 20;

/** Kind order for the consulted list, so a recall reads the same way every time. */
const KIND_ORDER: SubjectKind[] = ['locality', 'party', 'procedure', 'source', 'user'];

export interface SubjectsForCaseOptions {
  maxPerKind?: number;
}

/**
 * Resolve every subject a case gives us a reason to look up.
 *
 * Note what is *not* here: nothing is read from the title graph, even though it
 * holds a tidier party list. Memory resolves parties from the same extracted
 * fields `learn.ts` uses, so the two halves cannot drift and neither depends on
 * the graph existing.
 */
export function subjectsForCase(
  c: PropertyCase,
  opts: SubjectsForCaseOptions = {},
): NormalisedSubject[] {
  const maxPerKind = opts.maxPerKind ?? DEFAULT_MAX_SUBJECTS_PER_KIND;
  const collected: NormalisedSubject[] = [];

  const locality = localitySubject(c.identity.locality);
  if (locality) collected.push(locality);

  for (const mention of partyMentionsInCase(c)) collected.push(mention.subject);

  const intelligence = c.intelligence;
  for (const report of intelligence?.ingestions ?? []) {
    for (const attempt of report.attempted) {
      const s = sourceSubject(attempt.sourceLabel || attempt.sourceId);
      if (s) collected.push(s);
    }
  }
  for (const session of intelligence?.explorations ?? []) {
    for (const entry of session.unreachable) {
      const s = sourceSubject(entry.source);
      if (s) collected.push(s);
    }
    for (const lead of session.leads) {
      for (const visit of lead.visited) {
        const s = sourceSubject(visit.url);
        if (s) collected.push(s);
      }
    }
  }
  for (const pathway of intelligence?.pathways ?? []) {
    for (const route of pathway.routes) {
      const s = procedureSubject(route.title);
      if (s) collected.push(s);
    }
  }

  // Always consulted, even on an empty draft case: the owner's own
  // dispositions attached to it are the one thing memory can offer before a
  // single document has been uploaded.
  collected.push(userSubject(c.ownerName));

  const unique = dedupeSubjects(collected);

  // Group by kind in a fixed order, sort within the group, then cap. Sorting
  // before capping means the cap drops a predictable set rather than whichever
  // ones happened to be found last.
  const out: NormalisedSubject[] = [];
  for (const kind of KIND_ORDER) {
    const group = unique.filter(s => s.kind === kind).sort((a, b) => a.key.localeCompare(b.key));
    out.push(...group.slice(0, maxPerKind));
  }
  return out;
}

/* ==================================================================== */
/* recallForCase                                                        */
/* ==================================================================== */

export interface RecallOptions {
  /** Reference instant. Drives recency ranking and defaults both time axes. */
  now: string;
  /** Knowledge time: "what did we believe at T". Defaults to `now`. */
  asOf?: string;
  /** World time: "what held at T". Defaults to `asOf`. */
  validAt?: string;
  /** Hard cap on returned facts. Defaults to `DEFAULT_RECALL_LIMIT`. */
  limit?: number;
  /** Cap per scope, so one chatty scope cannot crowd the others out. */
  perScopeLimit?: number;
  halfLifeDays?: number;
  minConfidence?: number;
  /**
   * Include facts this very case taught the store.
   *
   * Off by default, and that default is the point: recall exists to bring in
   * what *other* cases established. A case reciting its own extractions back to
   * itself looks like corroboration and is not.
   */
  includeOwnCase?: boolean;
  /** Extra subject keys to consult — a locality the user asked about, say. */
  extraSubjects?: string[];
  maxSubjectsPerKind?: number;
}

/**
 * What memory has to say about this case.
 *
 * Returns the frozen `MemoryRecall` shape and nothing more, so the value can be
 * dropped straight onto `CaseIntelligence.memory`.
 */
export async function recallForCase(
  store: MemoryStore,
  c: PropertyCase,
  opts: RecallOptions,
): Promise<MemoryRecall> {
  const subjects = subjectsForCase(c, { maxPerKind: opts.maxSubjectsPerKind });
  const keys = [...subjects.map(s => s.key), ...(opts.extraSubjects ?? [])];
  const consultedSubjects = [...new Set(keys)];

  // A case with no locality, no documents and no owner name still resolves to
  // `user:default`, so this branch is close to unreachable — but an empty
  // subject list would otherwise be read by the store as "match everything",
  // which is the one wrong answer available.
  if (consultedSubjects.length === 0) {
    return { facts: [], consultedSubjects: [], excludedCount: 0, storedFactCount: await storedCount(store) };
  }

  const result = await store.query({
    subjects: consultedSubjects,
    now: opts.now,
    asOf: opts.asOf,
    validAt: opts.validAt,
    excludeCaseIds: opts.includeOwnCase ? undefined : [c.id],
    limit: opts.limit ?? DEFAULT_RECALL_LIMIT,
    perScopeLimit: opts.perScopeLimit,
    halfLifeDays: opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    minConfidence: opts.minConfidence,
  });

  return {
    facts: result.facts,
    consultedSubjects,
    excludedCount: result.excludedCount,
    storedFactCount: await storedCount(store),
  };
}

/**
 * How much memory holds in total.
 *
 * Counted from `snapshot()` rather than from the query result, because the
 * query is filtered by subject and by case — a store full of facts about other
 * properties would report zero if this counted matches, which is exactly the
 * confusion the field exists to remove.
 *
 * `snapshot()` and not `size()`: the ledger has a `size()` but the
 * `MemoryStore` interface does not expose it, so reaching for it through a
 * duck-typed cast compiled and would have returned 0 forever — the same silent
 * wrong answer this field was added to prevent. Allocating the array is
 * acceptable here for the reason the store itself gives for holding everything
 * in memory: the dataset is small. If memory ever outgrows that, `size()`
 * belongs on the interface and this should call it.
 */
async function storedCount(store: MemoryStore): Promise<number> {
  return (await store.snapshot()).length;
}

/* ==================================================================== */
/* Rendering                                                            */
/* ==================================================================== */

const SCOPE_ORDER: MemoryScope[] = [
  'party',
  'locality',
  'source_reliability',
  'procedure',
  'user_preference',
];

const SCOPE_HEADING: Record<MemoryScope, string> = {
  party: 'Parties seen before',
  locality: 'This locality, from earlier cases',
  source_reliability: 'How these sources behaved last time',
  procedure: 'Procedures tried before',
  user_preference: 'What this user has done before',
};

const KIND_NOUN: Record<SubjectKind, string> = {
  party: 'party',
  locality: 'locality',
  source: 'source',
  procedure: 'procedure',
  user: 'user',
};

/**
 * The standing notice that goes above every rendered recall.
 *
 * Without it a model handed a tidy list of remembered claims will cite them as
 * evidence, which breaks the first grounding principle and produces exactly the
 * output this product exists to avoid. The notice is not decoration; it is the
 * thing that keeps memory's standing distinct from the case's own evidence
 * ledger and from the title graph.
 */
const MEMORY_PREAMBLE = [
  'CROSS-CASE MEMORY — CONTEXT, NOT EVIDENCE',
  'These are things this system noticed on earlier, unrelated cases. This record is',
  'loose, accretive and allowed to be wrong. It is NOT part of this case’s evidence',
  'ledger and NOT part of its title graph.',
  '- Never cite a memory item as evidence, and never give it an evidence id.',
  '- Never state a memory item as a fact about this property.',
  '- Use it only to decide what to look at, what to double-check, and what to ask for.',
  '- Where it matters, verify it against this case’s own documents and say you did.',
].join('\n');

export interface RenderMemoryOptions {
  /**
   * Set for any agent that talks to an external service. See the privacy note at
   * the top of this file — this returns the empty string, not a filtered subset.
   */
  externalSafe?: boolean;
  /** Cap on rendered fact lines, independent of how many the recall carried. */
  maxLines?: number;
}

function renderFactLine(f: MemoryFact): string {
  const learned = f.assertedAt.slice(0, 10);
  const detail = [`confidence ${f.confidence.toFixed(2)}`, `learned ${learned}`, `case ${f.sourceCaseId}`];
  return `- ${f.subjectLabel} — ${f.predicate.replace(/_/g, ' ')}: ${f.object} (${detail.join(', ')})`;
}

/**
 * Render a recall as prompt text.
 *
 * Returns `''` when there is nothing to say, so callers can concatenate without
 * guarding — and `''` for `externalSafe`, unconditionally.
 */
export function renderMemoryForPrompt(
  recall: MemoryRecall,
  opts: RenderMemoryOptions = {},
): string {
  // The whole boundary, in one line. Memory holds owner and promoter names; an
  // external-facing agent must never see them, and the safe way to guarantee
  // that as the schema grows is to emit nothing at all rather than to filter.
  if (opts.externalSafe) return '';

  const maxLines = opts.maxLines ?? DEFAULT_RECALL_LIMIT;
  const withHits = new Set(recall.facts.map(f => f.subject));
  const misses = recall.consultedSubjects.filter(s => !withHits.has(s));

  if (recall.facts.length === 0 && misses.length === 0) return '';

  const sections: string[] = [MEMORY_PREAMBLE];
  let rendered = 0;

  for (const scope of SCOPE_ORDER) {
    const facts = recall.facts.filter(f => f.scope === scope);
    if (facts.length === 0) continue;
    const lines: string[] = [];
    for (const f of facts) {
      if (rendered >= maxLines) break;
      lines.push(renderFactLine(f));
      rendered++;
    }
    if (lines.length === 0) continue;
    sections.push([`${SCOPE_HEADING[scope]}:`, ...lines].join('\n'));
  }

  if (misses.length > 0) {
    // Printed as a positive statement rather than left as an absence. "We looked
    // and there is nothing" is information; a missing section is not.
    const described = misses.map(key => {
      const parsed = parseSubjectKey(key);
      return parsed ? `${key} (${KIND_NOUN[parsed.kind]})` : key;
    });
    sections.push(
      `Looked up and found no earlier history for: ${described.join(', ')}. Treat these as unknown, not as clean.`,
    );
  }

  if (recall.excludedCount > 0) {
    sections.push(
      `${recall.excludedCount} further remembered item(s) were held back as superseded by a later correction, or out of their validity window. They are retained in the store and can be inspected.`,
    );
  }

  const truncated = recall.facts.length - rendered;
  if (truncated > 0) {
    sections.push(`${truncated} lower-ranked memory item(s) omitted from this rendering for length.`);
  }

  return sections.join('\n\n');
}
