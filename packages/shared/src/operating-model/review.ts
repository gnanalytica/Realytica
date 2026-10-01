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

import type { DocumentFact } from './document-parse';
import type { ChatProposal, DdProject, EvidenceRecord } from './types';
import { findCheck, recordAuditEvent, recordCheckFields } from './operations';
import { isBlank } from './check-fields';
import { factReview } from './fact-review';
import { commitChatProposal, rejectChatProposal } from './wizard';
import { pendingFactProposals } from './document-intake';

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
  } = {},
): { evidence: EvidenceRecord; changed: DocumentFact[] } {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence) throw new Error('Document not found');
  const facts = evidence.facts ?? [];
  const named = (f: DocumentFact) => keys === 'all' || keys.includes(f.key);
  const targets =
    decision === 'reopen'
      ? facts.filter((f) => named(f) && f.decidedAt && factReview(f) !== 'proposed')
      : facts.filter((f) => named(f) && factReview(f) === 'proposed');
  if (!targets.length) return { evidence, changed: [] };
  const at = nowIso();
  let rows = [...facts];

  for (const fact of targets) {
    if (decision === 'accept') {
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
        at,
      });
    } else if (decision === 'reject') {
      fact.review = 'rejected';
      fact.decidedBy = actor;
      fact.decidedAt = at;
      recordAuditEvent(project, { actor, action: 'set_aside_fact', entityType: 'evidence', entityId: evidence.id, oldValue: `${fact.label}: ${fact.display}`, at });
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
      recordAuditEvent(project, { actor, action: 'reopen_fact', entityType: 'evidence', entityId: evidence.id, newValue: `${fact.label}: ${fact.display}`, at });
    }
  }
  evidence.facts = rows;
  evidence.updatedAt = at;

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
      (row?.facts ?? []).some((f) => f.key === k && factReview(f) === 'proposed' && String(f.value) === String(overrides && k in overrides ? overrides[k] : values[k])),
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
    const open = waitingFieldKeys(card).filter((key) => !contested(project, card, key));
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
