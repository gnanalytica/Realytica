/**
 * How a value waits on a check's field: once.
 *
 * A check's field and a function's sheet are read by one system, and a value
 * offered to either waits as `proposed` on the field until a person accepts
 * it. For a check there were two ways to wait: on a card of values raised
 * when a paper is read, and (from a model's tool) on the field itself. Now
 * there is one.
 *
 * - **One store.** A value waiting for a check's field is kept on a card of
 *   that check's values, whoever offered it: the paper's reading, or a model
 *   naming the field by its address. The card carries the paper it was read
 *   from, and stays tied to what that paper says now.
 * - **Read on the field.** Whoever reads the check as a sheet (`readSheet`,
 *   `get_fields`, a function's page) sees the value on its field, `proposed`,
 *   with its page and words, or beside the value the field already holds.
 *   The card is that same value seen from the chat.
 * - **Decided from either side.** Accepting or setting aside the field
 *   settles the card; settling the card settles the field. Both go through
 *   the same decision, with the same gate.
 * - **Offered once.** A value already waiting for a field, held by it, or
 *   set aside on it is not offered again, by either door.
 */

import { fieldState, formatFieldValue, isBlank, standingField } from './check-fields';
import { alreadyDecided, statesTheSameOnField } from './document-intake';
import { decideCheckFields, pickCheckValue, waitingOnCheck } from './review';
import type { MayDecide } from './team';
import { createChatProposal } from './wizard';
import type { ChatProposal, CheckFieldDef, CheckFieldValue, CheckInstance, DdProject, FieldOrigin } from './types';

type Offer = NonNullable<CheckFieldValue['other']>[number];

/** Where a value waiting on a card was read: the paper the card cites, or the public source it names for this field. */
function originOf(card: ChatProposal | undefined, key: string, cite: { page?: number; quote?: string; sourceEvidenceId?: string }): FieldOrigin {
  const named = ((card?.payload.origins ?? {}) as Record<string, FieldOrigin | undefined>)[key];
  if (named?.kind === 'external') return named;
  const reader = card?.createdBy === 'copilot' ? 'model' : 'parser';
  if (cite.sourceEvidenceId) return { kind: 'paper', evidenceId: cite.sourceEvidenceId, page: cite.page ?? 0, quote: cite.quote ?? '', reader };
  return { kind: 'person' };
}

/**
 * A check's fields as the field system reads them: what the check stores,
 * with every value that waits for it shown on its field. One that waits for
 * an empty field is the field's own, `proposed`. One that waits where a value
 * is held sits beside it. Each carries the card it waits on. Nothing here is
 * stored: it is the check's cards, read as fields.
 */
export function checkFieldsAsRead(project: DdProject, check: CheckInstance): Record<string, CheckFieldValue> {
  const own = check.fields ?? {};
  if (!project.chatProposals?.some((card) => card.kind === 'record_check_fields' && card.status === 'proposed' && card.payload.checkId === check.id)) return own;
  const waiting = waitingOnCheck(project, check.id).fields;
  if (!waiting.length) return own;
  const cards = new Map(project.chatProposals.map((card) => [card.id, card]));
  const out: Record<string, CheckFieldValue> = { ...own };
  for (const field of waiting) {
    const offers: Offer[] = field.values.map((offer) => {
      const card = cards.get(offer.proposalId);
      return {
        value: offer.value as CheckFieldValue['value'],
        origin: originOf(card, field.key, offer),
        proposedBy: card?.createdBy === 'copilot' ? 'model' : 'parser',
        at: card?.createdAt,
        card: offer.proposalId,
      };
    });
    const held = out[field.key];
    if (!held || (isBlank(held) && fieldState(held) !== 'not_applicable')) {
      const [first, ...rest] = offers as [Offer, ...Offer[]];
      out[field.key] = {
        value: first.value,
        at: first.at ?? '',
        by: first.proposedBy ?? 'parser',
        state: 'proposed',
        origin: first.origin,
        proposedBy: first.proposedBy,
        card: first.card,
        ...(first.origin.kind === 'paper' ? { sourceEvidenceId: first.origin.evidenceId, page: first.origin.page, quote: first.origin.quote } : {}),
        ...(held?.declined ? { declined: held.declined } : {}),
        ...(rest.length || held?.other?.length ? { other: [...(held?.other ?? []), ...rest] } : {}),
      };
    } else {
      out[field.key] = { ...held, other: [...(held.other ?? []), ...offers] };
    }
  }
  return out;
}

export type CheckFieldDecision = 'accept' | 'keep' | 'set_aside';

/**
 * A decision on a check's field, where what it decides is a value waiting on
 * a card. Returns false where it is not, and the field's own decision runs.
 *
 * - `accept`: the value waiting for the field is recorded, as the card's
 *   acceptance records it. With `pick`, one of several waiting beside the
 *   value held is recorded and the rest are set aside.
 * - `set_aside`: the value waiting is set aside on its card, and remembered.
 * - `keep`: the value held stays, and every card's value for the field is
 *   set aside.
 */
export function decideCheckWaiting(
  project: DdProject,
  check: CheckInstance,
  def: CheckFieldDef,
  decision: CheckFieldDecision,
  actor: string,
  input: { value?: unknown; pick?: number } = {},
  options: { mayDecide?: MayDecide } = {},
): boolean {
  const read = checkFieldsAsRead(project, check)[def.key];
  const typed = input.value !== undefined && input.value !== null && input.value !== '';
  if (decision === 'accept' && input.pick !== undefined) {
    const card = read?.other?.[input.pick]?.card;
    if (!card) return false;
    pickCheckValue(project, check.id, def.key, card, actor, { mayDecide: options.mayDecide });
    return true;
  }
  if (decision === 'keep') {
    if (!read?.other?.some((other) => other.card)) return false;
    pickCheckValue(project, check.id, def.key, null, actor, { mayDecide: options.mayDecide });
    return true;
  }
  if (!read?.card || fieldState(read) !== 'proposed') return false;
  decideCheckFields(project, read.card, [def.key], decision === 'accept' ? 'accept' : 'reject', actor, decision === 'accept' && typed ? { [def.key]: input.value } : undefined, { mayDecide: options.mayDecide });
  return true;
}

/** One value offered for a check's field, already checked against the field. */
export interface CheckOffer {
  check: CheckInstance;
  def: CheckFieldDef;
  value: NonNullable<CheckFieldValue['value']>;
  origin: Extract<FieldOrigin, { kind: 'paper' | 'external' }>;
}

/** Why a value offered for a check's field makes no new card: the field holds it, it waits there already, or a person set it aside. */
export function checkOfferStanding(project: DdProject, offer: CheckOffer, pending: readonly ChatProposal[] = []): 'held' | 'waiting' | 'declined' | undefined {
  const { check, def } = offer;
  const held = standingField(check.fields?.[def.key]);
  if (!isBlank(held) && statesTheSameOnField(def, held!.value, offer.value)) return 'held';
  const waits = (card: ChatProposal) =>
    card.kind === 'record_check_fields'
    && card.status === 'proposed'
    && card.payload.checkId === check.id
    && def.key in ((card.payload.values ?? {}) as Record<string, unknown>)
    && !((card.payload.decided ?? {}) as Record<string, string>)[def.key]
    && statesTheSameOnField(def, ((card.payload.values ?? {}) as Record<string, unknown>)[def.key], offer.value);
  if ([...(project.chatProposals ?? []), ...pending].some(waits)) return 'waiting';
  if (alreadyDecided(project, check.id, def.key, offer.value)) return 'declined';
  return undefined;
}

/**
 * The cards that carry values offered for checks' fields: one for each check
 * and source, as a paper's reading makes them. Every line on a card is the
 * field's label, its value as the field prints it, and the page: put together
 * here, never written by a model.
 */
export function checkOfferCards(offers: readonly CheckOffer[], proposer: 'model' | 'parser'): ChatProposal[] {
  const groups = new Map<string, CheckOffer[]>();
  for (const offer of offers) {
    const source = offer.origin.kind === 'paper' ? offer.origin.evidenceId : `${offer.origin.source}@${offer.origin.asOf}`;
    const key = `${offer.check.id}::${source}`;
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  }
  return [...groups.values()].map((group) => {
    const { check, origin } = group[0]!;
    const values: Record<string, unknown> = {};
    const citations: Record<string, { page: number; quote: string; value: unknown }> = {};
    const origins: Record<string, FieldOrigin> = {};
    const lines: string[] = [];
    for (const offer of group) {
      values[offer.def.key] = offer.value;
      const said = formatFieldValue(offer.def, { value: offer.value, at: '', by: '' });
      if (offer.origin.kind === 'paper') {
        citations[offer.def.key] = { page: offer.origin.page, quote: offer.origin.quote.slice(0, 220), value: offer.value };
        lines.push(`${offer.def.label}: ${said} (p.${offer.origin.page})`);
      } else {
        origins[offer.def.key] = offer.origin;
        lines.push(`${offer.def.label}: ${said} (${offer.origin.source}, read ${offer.origin.asOf.slice(0, 10)})`);
      }
    }
    const keys = Object.keys(values);
    return createChatProposal(
      'record_check_fields',
      `Record ${keys.length === 1 ? '1 value' : `${keys.length} values`} on “${check.title}”`,
      lines.join(' '),
      'Writes these values onto the check, citing where each was read. The check result is not changed.',
      { checkId: check.id, values, ...(Object.keys(citations).length ? { citations } : {}), ...(Object.keys(origins).length ? { origins } : {}), ...(origin.kind === 'paper' ? { sourceEvidenceId: origin.evidenceId } : {}) },
      proposer === 'model' ? 'copilot' : 'operator',
      { citedNodeIds: [check.id], ...(origin.kind === 'paper' ? { citedEvidenceIds: [origin.evidenceId] } : {}) },
    );
  });
}
