/**
 * Where a document's values stand with a person: proposed, accepted, or set
 * aside. Kept apart from the decisions themselves so the reader, the screen
 * and the filing code can ask without importing what decides.
 */

import type { DocumentFact, FactReview } from './document-parse';
import type { DdProject, EvidenceRecord } from './types';

/** Absent means accepted: a fact on file before values were reviewed one by one came with its approved card. */
export function factReview(fact: DocumentFact): FactReview {
  return fact.review ?? 'accepted';
}

/** What a document has been accepted as stating — what checks, the screen and the title graph may rely on. */
export function acceptedFacts(evidence: Pick<EvidenceRecord, 'facts'>): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => factReview(f) === 'accepted');
}

/** What a document states as far as anybody knows: accepted, or read and not yet decided. */
export function liveFacts(evidence: Pick<EvidenceRecord, 'facts'>): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => factReview(f) !== 'rejected');
}

export function proposedFacts(evidence: Pick<EvidenceRecord, 'facts'>): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => factReview(f) === 'proposed');
}

/** Every value waiting on a document, newest document first. */
export function factsAwaitingReview(project: DdProject): Array<{ evidence: EvidenceRecord; facts: DocumentFact[] }> {
  return project.evidence
    .map((evidence) => ({ evidence, facts: proposedFacts(evidence) }))
    .filter((row) => row.facts.length > 0)
    .sort((a, b) => b.evidence.updatedAt.localeCompare(a.evidence.updatedAt));
}

/**
 * What a new reading puts on a row: each value proposed, beside whatever the
 * row already holds.
 *
 * A value the row already accepts is not asked again when the page still says
 * it. A different value waits beside the accepted one, which stays in force
 * until the new one is accepted. Anything proposed or set aside from an
 * earlier reading of the same key is replaced by this one.
 */
export function proposeFacts(existing: DocumentFact[], incoming: DocumentFact[]): DocumentFact[] {
  const out = existing.filter((f) => !incoming.some((n) => n.key === f.key) || factReview(f) === 'accepted');
  for (const fact of incoming) {
    const accepted = out.find((f) => f.key === fact.key && factReview(f) === 'accepted');
    if (accepted && String(accepted.value) === String(fact.value)) {
      if (!accepted.marks && fact.marks) accepted.marks = fact.marks;
      continue;
    }
    out.push({ ...fact, review: 'proposed', decidedBy: undefined, decidedAt: undefined });
  }
  return out;
}

