/**
 * Where a document's values stand with a person: proposed, accepted, or set
 * aside. Kept apart from the decisions themselves so the reader, the screen
 * and the filing code can ask without importing what decides.
 *
 * One question is asked here and nowhere else: may this value be acted on
 * (`stands`). Whatever puts a value on a check card, counts it for a lender,
 * offers it to a valuation, dates an approval by it or says it in the chat as
 * on file reads a paper's values through `standingFacts`, or a reading not yet
 * on a row through `standingAsRead`. `liveFacts` is for a screen that shows
 * what waits, and labels it as waiting. A test reads the source and fails on
 * any other reader of a paper's values (`test/standing-readers.test.ts`).
 */

import { measuresStated, paperCarries, standardKeyForm, type DocumentFact, type FactProof, type FactReview } from './document-parse';
import { normalizeDigits } from '../script';
import type { DdProject, EvidenceRecord } from './types';

/** Absent means accepted: a fact on file before values were reviewed one by one came with its approved card. */
export function factReview(fact: DocumentFact): FactReview {
  return fact.review ?? 'accepted';
}

/** A row as far as its kind goes: what it holds, what it is typed as, and what a model offered to call it. */
type Paper = Pick<EvidenceRecord, 'facts' | 'documentType' | 'proposedDocumentType'>;

/**
 * What a document has been accepted as stating, and can state: what checks,
 * the screen and the title graph may rely on. A value under a key the row's
 * kind of paper does not carry is no reading of that paper, whoever accepted
 * it (`paperCarries`).
 */
export function acceptedFacts(evidence: Paper): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => factReview(f) === 'accepted' && paperCarries(evidence.documentType, f.key));
}

/**
 * What a document states as far as anybody knows: accepted, or read and not
 * yet decided. For a screen that shows what is waiting and says that it is.
 * Nothing that acts on a value reads this: see `standingFacts`.
 */
export function liveFacts(evidence: Pick<EvidenceRecord, 'facts'>): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => factReview(f) !== 'rejected');
}

/**
 * Whether a value's own standing lets it be acted on, whichever row it is on.
 *
 * What a person accepted does, and what they set aside does not. Of what
 * nobody has decided, only a value this server's rules read off a paper it
 * read surely, and that no other reader read differently:
 *
 * - a model's value waits until a person accepts it;
 * - so does every value on a paper this server had a reason to send to a
 *   model, the rules' own included (`unsure`): a poor scan's recital gave the
 *   rules an earlier deed's number, and it stood;
 * - a value another reader read differently (`otherReading`), verified on its
 *   page or not, waits until a person keeps one of the two.
 */
export function settled(fact: DocumentFact): boolean {
  // No decision on a value usually means it was on file before decisions were kept, and counts as accepted. Not where another
  // reader's value is beside it: such a value is a reading just made, and nobody has kept either.
  const review = fact.otherReading && !fact.review ? 'proposed' : factReview(fact);
  if (review !== 'proposed') return review === 'accepted';
  return fact.source !== 'model' && !fact.unsure && !fact.otherReading;
}

/**
 * Whether a value may be acted on.
 *
 * Its own standing has to allow it (`settled`), and it has to sit on a row
 * whose kind of paper carries its key (`paperCarries`): a nil-encumbrance
 * answer accepted on a paper that is no encumbrance certificate is not a
 * reading of that paper, and answers nothing.
 *
 * A value that waits acts on nothing, and whatever would have used it says a
 * reading is waiting (`waitingReadings`).
 */
export function stands(fact: DocumentFact, row: Pick<EvidenceRecord, 'documentType'>): boolean {
  return paperCarries(row.documentType, fact.key) && settled(fact);
}

/** What a document states that something may rest on. See `stands`. */
export function standingFacts(evidence: Paper): DocumentFact[] {
  return (evidence.facts ?? []).filter((f) => stands(f, evidence));
}

/**
 * What is read on a document and acts on nothing until a person decides it: a
 * model's value, one read off a paper this server was unsure of, or one two
 * readers differ on. Only a value that would stand once accepted: its key is
 * carried by the row's kind, or by the kind a model offered for the row and
 * nobody has answered.
 */
export function waitingReadings(evidence: Paper): DocumentFact[] {
  const carried = (key: string) => paperCarries(evidence.documentType, key) || (evidence.proposedDocumentType !== undefined && paperCarries(evidence.proposedDocumentType, key));
  return proposedFacts(evidence).filter((f) => !settled(f) && carried(f.key));
}

/**
 * A reading that is not on a row yet carries no decision, so every value in
 * it is one nobody has decided. These two say which of them may be acted on
 * at once, as `standingFacts` does for a row, and which wait.
 */
export function standingAsRead(read: { facts: readonly DocumentFact[] } | null | undefined): DocumentFact[] {
  return (read?.facts ?? []).filter((f) => settled({ ...f, review: 'proposed' }));
}

export function waitingAsRead(read: { facts: readonly DocumentFact[] } | null | undefined): DocumentFact[] {
  return (read?.facts ?? []).filter((f) => !settled({ ...f, review: 'proposed' }));
}

/**
 * What stands behind a model's value: its words found in the page's own text,
 * a second model's reading of the page, or neither. A value filed before the
 * proof was kept is told by how its page was checked then.
 */
export function proofOf(fact: Pick<DocumentFact, 'source' | 'proof' | 'pageCheck'>): FactProof | undefined {
  if (fact.source !== 'model') return undefined;
  // An earlier name for a second model's reading, taken as that wherever it turns up.
  if ((fact.proof as string | undefined) === 'page_image') return 'second_reader';
  return fact.proof ?? (fact.pageCheck === 'page' ? 'second_reader' : fact.pageCheck ? 'page_text' : undefined);
}

/**
 * Whether a value has to be right to the digit: a survey number, a PID, a
 * khata or document number, a date, an area, a width, an amount, a count.
 * Told by the form of its key where the key is one of the rules', else by its
 * carrying a digit at all.
 */
export function exactValue(key: string, value: DocumentFact['value']): boolean {
  const form = standardKeyForm(key);
  return form ? ['identifier', 'date', 'rupees', 'sqm', 'feet', 'number'].includes(form) : /\d/.test(normalizeDigits(String(value)));
}

/**
 * Whether a waiting value is accepted only by a person who names it, never by
 * "accept all" on its row nor by "approve all" in the chat:
 *
 * - a value two readers differ on, since accepting it is choosing one;
 * - a model's yes or no, since no words on a page are the answer itself;
 * - a model's value that has to be exact and has only a second model's
 *   reading behind it, since two models agreeing is weaker than words found
 *   in the page's text;
 * - a model's area or width whose quote writes no unit these rules know: the
 *   figure was found in the words, and the unit was the model's.
 */
export function acceptedOneAtATime(fact: DocumentFact): boolean {
  if (fact.otherReading) return true;
  if (fact.source !== 'model') return false;
  if (typeof fact.value === 'boolean') return true;
  if (unitUnstated(fact)) return true;
  return proofOf(fact) !== 'page_text' && exactValue(fact.key, fact.value);
}

/** A model's area or width quoted without a unit these rules can convert. */
function unitUnstated(fact: DocumentFact): boolean {
  const form = standardKeyForm(fact.key);
  return fact.source === 'model' && (form === 'sqm' || form === 'feet') && !measuresStated(fact.key, fact.quote).length;
}

/**
 * What stands behind a model's value, in a few words for a screen. Empty for
 * a value the rules read: its words are the page's own.
 *
 * A yes or no is never said to be found in the page's text: the words quoted
 * for it are on the page, and the answer is the model's reading of them.
 */
export function proofSaid(fact: Pick<DocumentFact, 'source' | 'proof' | 'pageCheck' | 'value'>): string {
  const proof = proofOf(fact);
  if (!proof) return '';
  if (proof === 'unverified') return 'unverified';
  if (proof === 'second_reader') {
    // Before the second reader was asked blind it was shown the words, and said whether they were on the page.
    return fact.proof ? 'a second model read the same value off the page' : 'a second model, shown the words, said they are on the page';
  }
  return typeof fact.value === 'boolean' ? 'the model’s answer; the words quoted for it are in the page’s text' : 'its words are in the page’s own text';
}

/**
 * What "accept all" left, and why, in a sentence: the values a person accepts
 * one at a time (`acceptedOneAtATime`). Empty when there are none.
 */
export function oneAtATimeSaid(facts: readonly DocumentFact[]): string {
  const left = facts.filter(acceptedOneAtATime);
  if (!left.length) return '';
  const why = (fact: DocumentFact) =>
    fact.otherReading ? 'two readings'
    : typeof fact.value === 'boolean' ? 'a model\u2019s yes or no'
    : proofOf(fact) === 'page_text' && unitUnstated(fact) ? 'its unit is not in the words quoted'
    : 'only a second model\u2019s reading behind it';
  const named = left.slice(0, 4).map((fact) => `${fact.label} (${why(fact)})`);
  const list = left.length > 4 ? `${named.join(', ')} and ${left.length - 4} more` : named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}` : named[0];
  return `${left.length === 1 ? 'One value is' : `${left.length} values are`} left to accept one at a time on the document: ${list}.`;
}

/**
 * Where a value another reader read differently stands, in a sentence: neither
 * taken yet, or which of the two a person kept.
 */
export function otherReadingSaid(fact: DocumentFact): string {
  if (!fact.otherReading) return '';
  if (fact.review === 'accepted') return `The two differ; ${fact.display} was kept.`;
  if (fact.review === 'rejected') return 'The two differ; neither was kept.';
  return 'The two differ; neither is taken until you keep one.';
}

/** What a waiting reading is, in a sentence for whatever would have used it. */
export function waitingReadingSaid(fact: DocumentFact, document: string): string {
  if (fact.otherReading) {
    return `Two readers read “${fact.label}” differently on ${document}, p. ${fact.page} (${fact.display} and ${fact.otherReading.display}), and nobody has kept one.`;
  }
  if (fact.source !== 'model') {
    return `“${fact.label}: ${fact.display}” was read on ${document}, p. ${fact.page}, a paper that was hard to read here, and nobody has accepted it.`;
  }
  return `A model read “${fact.label}: ${fact.display}” on ${document}, p. ${fact.page}, and nobody has accepted it.`;
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

/**
 * A new reading put on its row, once the row says what kind of paper it is
 * (its type, or the kind a model offered and nobody has answered).
 *
 * A value under a key that kind does not carry is no reading of the paper
 * (`paperCarries`). It does not wait there, and it does not bring back a value
 * a person's "It is not" set aside: it is kept as set aside, where a person
 * can still see what was read.
 */
export function proposeOnRow(row: Paper, incoming: DocumentFact[]): DocumentFact[] {
  const carried = (key: string) => paperCarries(row.documentType, key) || (row.proposedDocumentType !== undefined && paperCarries(row.proposedDocumentType, key));
  const out = proposeFacts(row.facts ?? [], incoming.filter((fact) => carried(fact.key)));
  for (const fact of incoming) {
    if (!carried(fact.key) && !out.some((held) => held.key === fact.key)) out.push({ ...fact, review: 'rejected' });
  }
  return out;
}

/**
 * Sets aside the values on a row that its paper, as a person has just said
 * what it is or is not, does not carry: a model read them as values of a kind
 * of paper this one turned out not to be. The rules' own values are left to
 * `stands`, which counts none the row's kind does not carry. Returns what was
 * set aside.
 */
export function setAsideOffPaper(row: Paper, actor: string, at = new Date().toISOString()): DocumentFact[] {
  const off = (row.facts ?? []).filter((fact) => fact.source === 'model' && factReview(fact) !== 'rejected' && !paperCarries(row.documentType, fact.key));
  for (const fact of off) {
    fact.review = 'rejected';
    fact.decidedBy = actor;
    fact.decidedAt = at;
  }
  return off;
}
