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

import type { MemoryFact, MemoryRecall, MemoryScope } from '@realytica/shared';
import { DEFAULT_RECALL_LIMIT } from './store';
import {
  parseSubjectKey,
  type SubjectKind,
} from './subjects';

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
  /**
   * Which workspaces' facts this recall may reach.
   *
   * Defaults to the one that owns the project, which is the safe answer and
   * the one a caller who has not thought about it should get. An app that
   * knows more — that a fact with no workspace on it predates tenancy and
   * belongs to the first workspace, say — passes the list itself.
   */
  tenants?: readonly (string | null)[];
  /** Extra subject keys to consult — a locality the user asked about, say. */
  extraSubjects?: string[];
  maxSubjectsPerKind?: number;
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
