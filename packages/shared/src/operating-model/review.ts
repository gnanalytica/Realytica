/**
 * Deciding what a reader proposed, one value at a time, where it sits.
 *
 * A document filed from an upload carries what it states as proposed facts on
 * its own row. A person accepts each value there, corrects it first, or sets
 * it aside — and the decision follows the value: setting aside the deed's
 * extent also sets aside the check value read from it, and accepting it
 * records that value on the check it answers. Nothing here writes to the
 * chat. The chat talks; the registers are where things are decided.
 */

import { paperCarries, type DocumentFact } from './document-parse';
import type { ChatProposal, DdProject, EvidenceRecord } from './types';
import { findCheck, recordAuditEvent, recordCheckFields } from './operations';
import { isBlank } from './check-fields';
import { acceptedOneAtATime, factReview, stands } from './fact-review';
import { commitChatProposal, rejectChatProposal } from './wizard';
import { decidedOnACheck, factFillProposals, pendingFactProposals } from './document-intake';

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------- */
/* Deciding a document's values                                           */
/* -------------------------------------------------------------------- */

export type FactDecision = 'accept' | 'reject' | 'reopen';

export interface FactEdit {
  value: string | number | boolean;
  display: string;
}

/** A check-values card read from this document. */
function fillsFrom(project: DdProject, evidence: EvidenceRecord): ChatProposal[] {
  const keys = new Set(evidence.attachments.map((a) => a.storageKey));
  return project.chatProposals.filter(
    (p) =>
      p.kind === 'record_check_fields'
      && p.status === 'proposed'
      && (p.payload.sourceEvidenceId === evidence.id || (typeof p.payload.sourceStorageKey === 'string' && keys.has(p.payload.sourceStorageKey))),
  );
}

/**
 * The check fields on a card that carry this fact. A fact is keyed by the
 * check field it answers wherever one exists, so the key is the link — two
 * fields that merely hold the same value (two "yes" answers) are not.
 */
function fieldsCarrying(card: ChatProposal, fact: DocumentFact): string[] {
  const values = (card.payload.values ?? {}) as Record<string, unknown>;
  const decided = (card.payload.decided ?? {}) as Record<string, string>;
  return Object.keys(values).filter((key) => !decided[key] && key === fact.key);
}

/** What the page was read as for this fact, whatever a person corrected it to. */
function asRead(fact: DocumentFact): DocumentFact['value'] {
  return fact.readAs ? fact.readAs.value : fact.value;
}

/**
 * Whether a card's waiting field holds the reading this fact is. A card is
 * raised with one reading's value, and the fact under the same key may since
 * have become another: the other reader's value was kept, or the paper was
 * read again. Such a field is the old reading's, not this one's.
 */
function holdsThisReading(card: ChatProposal, fact: DocumentFact): boolean {
  return String(((card.payload.values ?? {}) as Record<string, unknown>)[fact.key]) === String(asRead(fact));
}

/** The paper a check-values card was read from: by its row, or by the stored file where the card was raised before the row was. */
function sourceRow(project: DdProject, card: ChatProposal): EvidenceRecord | undefined {
  const storageKey = typeof card.payload.sourceStorageKey === 'string' ? card.payload.sourceStorageKey : undefined;
  return (
    (typeof card.payload.sourceEvidenceId === 'string' ? project.evidence.find((e) => e.id === card.payload.sourceEvidenceId) : undefined)
    ?? (storageKey ? project.evidence.find((e) => e.attachments.some((a) => a.storageKey === storageKey)) : undefined)
  );
}

/**
 * Whether a card's field came from a reading that still waits on its paper: a
 * model's value nobody has accepted, or one two readers differ on. Such a
 * field is decided where the reading is. Accepting everything on a card, or
 * everything a reply left, is not looking at it, and leaves it waiting.
 */
export function fromWaitingReading(project: DdProject, card: ChatProposal, key: string): boolean {
  return waitingSource(project, card, key) !== undefined;
}

/** The reading a card's field came from, where that reading still waits on its paper. */
function waitingSource(project: DdProject, card: ChatProposal, key: string): { row: EvidenceRecord; fact: DocumentFact } | undefined {
  const value = String(((card.payload.values ?? {}) as Record<string, unknown>)[key]);
  const row = sourceRow(project, card);
  const fact = (row?.facts ?? []).find(
    (f) => f.key === key && factReview(f) === 'proposed' && !stands(f, row!) && (String(f.value) === value || (f.otherReading !== undefined && String(f.otherReading.value) === value)),
  );
  return row && fact ? { row, fact } : undefined;
}

/** A kind of paper as it is said mid-sentence: "a sale deed", "an encumbrance certificate". */
function aPaper(type: string): string {
  return `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${/^[A-Z][a-z]/.test(type) ? type.charAt(0).toLowerCase() + type.slice(1) : type}`;
}

/**
 * Whether recording this card's value for `key` would settle something a
 * person has not: the check already holds a different value, or another
 * document's different value waits for the same field. Either way the check
 * keeps both in front of a person rather than taking whichever was accepted
 * last.
 */
function contested(project: DdProject, card: ChatProposal, key: string): boolean {
  const checkId = String(card.payload.checkId);
  const value = String(((card.payload.values ?? {}) as Record<string, unknown>)[key]);
  let held: unknown;
  try {
    const field = findCheck(project, checkId).check.fields?.[key];
    held = isBlank(field) ? undefined : field!.value;
  } catch {
    return false;
  }
  if (held !== undefined && String(held) !== value) return true;
  return project.chatProposals.some(
    (other) =>
      other !== card
      && other.kind === 'record_check_fields'
      && other.status === 'proposed'
      && other.payload.checkId === checkId
      && waitingFieldKeys(other).includes(key)
      && String(((other.payload.values ?? {}) as Record<string, unknown>)[key]) !== value,
  );
}

/** The fields on a check card a person has to pick between documents for. */
export function contestedKeys(project: DdProject, card: ChatProposal): string[] {
  return waitingFieldKeys(card).filter((key) => contested(project, card, key));
}

/**
 * The other reader's value put in this one's place, and this one kept beside
 * it as the reading that was not chosen. The fact is changed where it stands,
 * so whatever already points at it still does.
 */
function takeOtherReading(fact: DocumentFact): void {
  const { otherReading: other, ...mine } = fact;
  if (!other) return;
  for (const key of Object.keys(fact)) delete (fact as unknown as Record<string, unknown>)[key];
  Object.assign(fact, other, { review: mine.review, otherReading: { ...mine, review: undefined, decidedBy: undefined, decidedAt: undefined, replaced: undefined } });
}

/**
 * Accept, set aside, or reopen values on one document.
 *
 * `keys` names facts by key; `'all'` is every value still waiting on it. An
 * edit applies to a single accepted value: the person's figure replaces the
 * page's, the quote stays, and the page's own reading is kept so reopening
 * puts it back.
 *
 * The decision follows the value onto the checks: accepting records each
 * check field read from the same value on this document, setting aside sets
 * those fields aside. A check value that will not record — a field that needs
 * proof the value lacks — stays waiting on its check rather than failing the
 * document's decision.
 *
 * A value two readers read differently (`otherReading`) is a choice, and only
 * a person naming that value makes it: accepting it by its key keeps this
 * server's reading, `take: 'other'` keeps the other reader's, and "all"
 * leaves it waiting, since nobody looked at it. "All" leaves a model's yes or
 * no waiting too, and a model's exact value with only a second model's
 * reading behind it (`acceptedOneAtATime`).
 *
 * A value that did not stand until now was offered to no check when it was
 * read. Accepting it offers it, and the value kept is the one offered: a
 * card raised earlier for another reading of the same key is set aside, so
 * the check is never given a value the document no longer states.
 *
 * A value under a key the row's kind of paper does not carry is not accepted:
 * it is no reading of that paper (`paperCarries`). "All" leaves it where it
 * is; naming it says why, and what to do first.
 */
export function reviewFacts(
  project: DdProject,
  evidenceId: string,
  keys: string[] | 'all',
  decision: FactDecision,
  actor: string,
  edit?: FactEdit,
  options: {
    /** Whether this person may record values on a check. A contractor's decision stops at the checks in their grant. */
    checkWritable?: (checkId: string) => boolean;
    /** Keep the other reader's value for the one key named, in place of this server's. */
    take?: 'other';
  } = {},
): { evidence: EvidenceRecord; changed: DocumentFact[] } {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence) throw new Error('Document not found');
  const facts = evidence.facts ?? [];
  const named = (f: DocumentFact) => keys === 'all' || keys.includes(f.key);
  const waiting = facts.filter((f) => named(f) && factReview(f) === 'proposed' && !(keys === 'all' && decision === 'accept' && acceptedOneAtATime(f)));
  const offPaper = decision === 'accept' ? waiting.filter((f) => !paperCarries(evidence.documentType, f.key)) : [];
  if (offPaper.length && keys !== 'all') {
    const offered = evidence.proposedDocumentType;
    throw new Error(
      offered
        ? `Say what this paper is first. A model takes it for ${aPaper(offered)}: confirm that, or say what it is, and “${offPaper[0]!.label}” can be accepted.`
        : `${evidence.documentType ? aPaper(evidence.documentType).replace(/^a/, 'A') : 'A paper of no kind'} does not carry “${offPaper[0]!.label}”, so it is not accepted on this row.`,
    );
  }
  const targets = decision === 'reopen' ? facts.filter((f) => named(f) && f.decidedAt && factReview(f) !== 'proposed') : waiting.filter((f) => !offPaper.includes(f));
  if (!targets.length) return { evidence, changed: [] };
  const at = nowIso();
  let rows = [...facts];
  /** The values that acted on nothing until this decision: no check was offered them when they were read. */
  const waited = new Set(decision === 'accept' ? targets.filter((f) => !stands(f, evidence)) : []);

  for (const fact of targets) {
    if (decision === 'accept') {
      if (options.take === 'other' && targets.length === 1) takeOtherReading(fact);
      const older = rows.filter((o) => o !== fact && o.key === fact.key && factReview(o) === 'accepted');
      rows = rows.filter((o) => !older.includes(o));
      if (older[0]) fact.replaced = { ...older[0], replaced: undefined };
      if (edit && targets.length === 1 && String(edit.value) !== String(fact.value)) {
        fact.readAs = { value: fact.value, display: fact.display };
        fact.value = edit.value;
        fact.display = edit.display;
        fact.edited = true;
      }
      fact.review = 'accepted';
      fact.decidedBy = actor;
      fact.decidedAt = at;
      recordAuditEvent(project, {
        actor,
        action: fact.edited ? 'accept_fact_corrected' : 'accept_fact',
        entityType: 'evidence',
        entityId: evidence.id,
        oldValue: older[0] ? `${older[0].label}: ${older[0].display}` : undefined,
        newValue: `${fact.label}: ${fact.display}`,
        factKey: fact.key,
        at,
      });
    } else if (decision === 'reject') {
      fact.review = 'rejected';
      fact.decidedBy = actor;
      fact.decidedAt = at;
      recordAuditEvent(project, { actor, action: 'set_aside_fact', entityType: 'evidence', entityId: evidence.id, oldValue: `${fact.label}: ${fact.display}`, factKey: fact.key, at });
    } else {
      if (factReview(fact) === 'accepted' && fact.replaced) {
        rows.push({ ...fact.replaced });
        fact.replaced = undefined;
      }
      if (fact.readAs) {
        fact.value = fact.readAs.value;
        fact.display = fact.readAs.display;
        fact.readAs = undefined;
        fact.edited = undefined;
      }
      fact.review = 'proposed';
      fact.decidedBy = undefined;
      fact.decidedAt = undefined;
      recordAuditEvent(project, { actor, action: 'reopen_fact', entityType: 'evidence', entityId: evidence.id, newValue: `${fact.label}: ${fact.display}`, factKey: fact.key, at });
    }
  }
  evidence.facts = rows;
  evidence.updatedAt = at;

  // Offered to the checks now: what was offered to none when it was read, because it waited.
  if (decision === 'accept') {
    const offer: DocumentFact[] = [];
    for (const fact of targets) {
      // No check was offered a value that waited. A check offered another reading of this key was not offered this one either.
      let unoffered = waited.has(fact);
      for (const card of fillsFrom(project, evidence)) {
        const stale = fieldsCarrying(card, fact).filter(() => !holdsThisReading(card, fact));
        if (!stale.length) continue;
        unoffered = true;
        // The other reading's card is set aside where it waits, by whoever may decide that check.
        if (!options.checkWritable || options.checkWritable(String(card.payload.checkId))) decideCheckFields(project, card.id, stale, 'reject', actor, undefined, { fromDocument: true });
      }
      // As the value kept and with its own page and words, unless a person already decided it on a check.
      if (unoffered && !decidedOnACheck(project, fact.key, asRead(fact), evidence)) offer.push(fact.readAs ? { ...fact, value: fact.readAs.value, display: fact.readAs.display } : fact);
    }
    // One card a check, carrying every value this decision brought it, as a reading does.
    if (offer.length) {
      const source = { fileName: evidence.attachments[0]?.fileName ?? evidence.title, evidenceId: evidence.id, documentLabel: evidence.documentType ?? evidence.title };
      project.chatProposals.push(...factFillProposals(project, offer, source, actor, [], { differences: true }));
    }
  }

  // The same value, waiting on the checks it answers.
  if (decision !== 'reopen') {
    for (const fact of targets) {
      for (const card of fillsFrom(project, evidence)) {
        if (options.checkWritable && !options.checkWritable(String(card.payload.checkId))) continue;
        const fields = fieldsCarrying(card, fact).filter((key) => decision !== 'accept' || !contested(project, card, key));
        if (!fields.length) continue;
        try {
          decideCheckFields(
            project,
            card.id,
            fields,
            decision === 'accept' ? 'accept' : 'reject',
            actor,
            fact.edited ? Object.fromEntries(fields.map((k) => [k, fact.value])) : undefined,
            { fromDocument: true },
          );
        } catch {
          /* it stays waiting on its check, where it can be decided on its own */
        }
      }
    }
  }
  return { evidence, changed: targets };
}

/* -------------------------------------------------------------------- */
/* Deciding a check's values                                               */
/* -------------------------------------------------------------------- */

export type FieldDecision = 'accept' | 'reject';

/** The fields on a check-values card nobody has decided yet. */
export function waitingFieldKeys(card: ChatProposal): string[] {
  const values = (card.payload.values ?? {}) as Record<string, unknown>;
  const decided = (card.payload.decided ?? {}) as Record<string, string>;
  return Object.keys(values).filter((key) => !decided[key]);
}

/**
 * Accept or set aside values on a check, one field at a time.
 *
 * Accepting records exactly those fields, with the page and quote they were
 * read from where the value is still the page's. The card stays waiting until
 * every field on it is decided, and then reads as filed if any value was
 * accepted, or set aside if none was.
 */
export function decideCheckFields(
  project: DdProject,
  proposalId: string,
  keys: string[],
  decision: FieldDecision,
  actor: string,
  overrides?: Record<string, unknown>,
  options: {
    /** Decided on the document already; the document need not be told. */
    fromDocument?: boolean;
  } = {},
): ChatProposal {
  const card = project.chatProposals.find((p) => p.id === proposalId);
  if (!card || card.kind !== 'record_check_fields') throw new Error('No check values waiting by that id');
  if (card.status !== 'proposed') throw new Error('These values were already decided');
  const payload = card.payload;
  const values = (payload.values ?? {}) as Record<string, unknown>;
  const decided = { ...((payload.decided ?? {}) as Record<string, 'accepted' | 'rejected'>) };
  const open = keys.filter((k) => k in values && !decided[k]);
  if (!open.length) return card;
  const checkId = String(payload.checkId);

  // A value whose reading still waits on its paper is decided there, where both readings and the page are: never here, one field at a time.
  if (decision === 'accept' && !options.fromDocument) {
    const held = open.map((k) => waitingSource(project, card, k)).find(Boolean);
    if (held) {
      const paper = held.row.documentType ?? held.row.title;
      throw new Error(
        held.fact.otherReading
          ? `Two readers read “${held.fact.label}” differently on ${paper}. Keep one of the two on the document; the check takes what is kept there.`
          : `“${held.fact.label}” is still waiting on ${paper}. Accept it on the document; the check takes it from there.`,
      );
    }
  }

  if (decision === 'accept') {
    const subset = Object.fromEntries(open.map((k) => [k, overrides && k in overrides ? overrides[k] : values[k]]));
    const offered = (payload.citations ?? {}) as Record<string, { page?: number; quote?: string; value?: unknown }>;
    const citations = Object.fromEntries(Object.entries(offered).filter(([k, c]) => k in subset && String(subset[k]) === String(c.value)));
    const storageKey = typeof payload.sourceStorageKey === 'string' ? payload.sourceStorageKey : undefined;
    const sourceEvidenceId =
      (typeof payload.sourceEvidenceId === 'string' && project.evidence.some((e) => e.id === payload.sourceEvidenceId) ? payload.sourceEvidenceId : undefined)
      ?? (storageKey ? project.evidence.find((e) => e.attachments.some((a) => a.storageKey === storageKey))?.id : undefined);
    const outcome = recordCheckFields(project, checkId, subset, actor, sourceEvidenceId, citations);
    if (outcome.rejected.length) throw new Error(outcome.rejected.map((r) => r.error).join(' '));
  } else {
    recordAuditEvent(project, { actor, action: 'set_aside_check_values', entityType: 'check', entityId: checkId, oldValue: open.map((k) => `${k}: ${String(values[k])}`).join('; ') });
  }
  for (const k of open) decided[k] = decision === 'accept' ? 'accepted' : 'rejected';
  payload.decided = decided;
  if (Object.keys(values).every((k) => decided[k])) {
    const any = Object.values(decided).includes('accepted');
    card.status = any ? 'committed' : 'rejected';
    if (any) card.committedRecordId = checkId;
  }
  /*
   * Accepted on the check as read off a document, so the document is
   * accepted as stating it — the same value is not asked about twice. Only
   * acceptance travels this way: setting a value aside on one check says
   * nothing about whether the page says it.
   */
  if (decision === 'accept' && !options.fromDocument) {
    const storageKey = typeof payload.sourceStorageKey === 'string' ? payload.sourceStorageKey : undefined;
    const row =
      (typeof payload.sourceEvidenceId === 'string' ? project.evidence.find((e) => e.id === payload.sourceEvidenceId) : undefined)
      ?? (storageKey ? project.evidence.find((e) => e.attachments.some((a) => a.storageKey === storageKey)) : undefined);
    const stated = open.filter((k) =>
      paperCarries(row?.documentType, k)
      && (row?.facts ?? []).some((f) => f.key === k && factReview(f) === 'proposed' && String(f.value) === String(overrides && k in overrides ? overrides[k] : values[k])),
    );
    if (row && stated.length) reviewFacts(project, row.id, stated, 'accept', actor);
  }
  return card;
}

/** A value waiting on a check, and the words it was read from. */
export interface WaitingCheckValue {
  proposalId: string;
  key: string;
  value: unknown;
  page?: number;
  quote?: string;
  /** The document it was read from, as a person names it. */
  source?: string;
  /** Its file, which tells two documents of the same kind apart. */
  fileName?: string;
  sourceEvidenceId?: string;
}

export interface CheckWaiting {
  /**
   * Each field with values waiting for it. `disagree` when they differ from
   * one another, or from the value the check already holds — a person picks.
   */
  fields: Array<{ key: string; values: WaitingCheckValue[]; recorded?: unknown; disagree: boolean }>;
  /** A result suggested for the check. */
  results: ChatProposal[];
  /** Anything else waiting that names the check — a request for its proof, a finding. */
  other: ChatProposal[];
}

function namesCheck(card: ChatProposal, checkId: string): boolean {
  const p = card.payload as Record<string, unknown>;
  if (p.checkId === checkId) return true;
  if (Array.isArray(p.checkIds) && p.checkIds.includes(checkId)) return true;
  return (card.citedNodeIds ?? []).includes(checkId);
}

/** Everything waiting on one check, field by field. */
export function waitingOnCheck(project: DdProject, checkId: string): CheckWaiting {
  let held: Record<string, unknown> = {};
  try {
    const { check } = findCheck(project, checkId);
    held = Object.fromEntries(Object.entries(check.fields ?? {}).filter(([, v]) => !isBlank(v)).map(([k, v]) => [k, v!.value]));
  } catch {
    return { fields: [], results: [], other: [] };
  }
  const cards = project.chatProposals.filter((p) => p.status === 'proposed' && namesCheck(p, checkId));
  const byKey = new Map<string, WaitingCheckValue[]>();
  for (const card of cards.filter((c) => c.kind === 'record_check_fields' && c.payload.checkId === checkId)) {
    const values = (card.payload.values ?? {}) as Record<string, unknown>;
    const citations = (card.payload.citations ?? {}) as Record<string, { page?: number; quote?: string }>;
    const evidenceId = typeof card.payload.sourceEvidenceId === 'string' ? card.payload.sourceEvidenceId : undefined;
    const storageKey = typeof card.payload.sourceStorageKey === 'string' ? card.payload.sourceStorageKey : undefined;
    // Raised before its document had a row, it is found by the stored file.
    const row =
      (evidenceId ? project.evidence.find((e) => e.id === evidenceId) : undefined)
      ?? (storageKey ? project.evidence.find((e) => e.attachments.some((a) => a.storageKey === storageKey)) : undefined);
    const source = row?.documentType ?? row?.title ?? (typeof card.payload.sourceFileName === 'string' ? card.payload.sourceFileName : undefined);
    for (const key of waitingFieldKeys(card)) {
      const list = byKey.get(key) ?? [];
      const fileName = row?.attachments[0]?.fileName ?? (typeof card.payload.sourceFileName === 'string' ? card.payload.sourceFileName : undefined);
      list.push({ proposalId: card.id, key, value: values[key], page: citations[key]?.page, quote: citations[key]?.quote, source, fileName, sourceEvidenceId: row?.id });
      byKey.set(key, list);
    }
  }
  const fields = [...byKey.entries()].map(([key, values]) => {
    const recorded = held[key];
    const distinct = new Set(values.map((v) => String(v.value)));
    return { key, values, recorded, disagree: distinct.size > 1 || (recorded !== undefined && !distinct.has(String(recorded))) };
  });
  return {
    fields,
    results: cards.filter((c) => c.kind === 'record_check'),
    other: cards.filter((c) => c.kind !== 'record_check' && c.kind !== 'record_check_fields'),
  };
}

/**
 * Settle a field the documents disagree on: carry one value — or, with no
 * id, keep what the check holds — and set the rest aside where they wait.
 * Nothing changes on the documents themselves; each still states what it
 * states.
 */
export function pickCheckValue(project: DdProject, checkId: string, key: string, proposalId: string | null, actor: string): void {
  const waiting = project.chatProposals.filter(
    (p) => p.kind === 'record_check_fields' && p.status === 'proposed' && p.payload.checkId === checkId && waitingFieldKeys(p).includes(key),
  );
  if (proposalId !== null && !waiting.some((p) => p.id === proposalId)) throw new Error('That value is no longer waiting');
  // The chosen value first: if it will not record, nothing else is set aside.
  if (proposalId !== null) decideCheckFields(project, proposalId, [key], 'accept', actor);
  for (const other of waiting) if (other.id !== proposalId) decideCheckFields(project, other.id, [key], 'reject', actor);
}

/* -------------------------------------------------------------------- */
/* Deciding anything else waiting                                          */
/* -------------------------------------------------------------------- */

/**
 * Accept something waiting on the canvas — a request, a finding, a DD to
 * start — without a word in the chat.
 *
 * A DD started this way is offered the values already on file, the same as
 * one started from the chat, so they turn up waiting on its checks.
 */
export function acceptWaiting(project: DdProject, proposalId: string, actor: string): { proposal: ChatProposal; recordId?: string; offered: ChatProposal[] } {
  const card = project.chatProposals.find((p) => p.id === proposalId);
  if (!card) throw new Error('Nothing waiting by that id');
  if (card.kind === 'record_check_fields') {
    // Values the documents disagree on stay waiting for the picker: accepting the card is not choosing between them.
    // So does a value read from a reading that still waits on its paper: that one is decided there.
    const open = waitingFieldKeys(card).filter((key) => !contested(project, card, key) && !fromWaitingReading(project, card, key));
    const decided = open.length ? decideCheckFields(project, proposalId, open, 'accept', actor) : card;
    return { proposal: decided, recordId: String(card.payload.checkId), offered: [] };
  }
  const result = commitChatProposal(project, proposalId, actor);
  const offered: ChatProposal[] = [];
  if (card.kind === 'start_dd' || card.kind === 'add_scope') {
    const waiting = project.chatProposals.filter((p) => p.status === 'proposed');
    const fills = pendingFactProposals(project, actor, waiting);
    project.chatProposals.push(...fills);
    offered.push(...fills);
  }
  recordAuditEvent(project, { actor, action: 'accept_proposal', entityType: 'proposal', entityId: card.id, newValue: card.title });
  return { ...result, offered };
}

/** Set something waiting aside. It stays in the record, decided. */
export function setAsideWaiting(project: DdProject, proposalId: string, actor: string): ChatProposal {
  const card = rejectChatProposal(project, proposalId);
  recordAuditEvent(project, { actor, action: 'set_aside_proposal', entityType: 'proposal', entityId: card.id, oldValue: card.title });
  return card;
}
