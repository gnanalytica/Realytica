/**
 * A request that leaves the firm, and what comes back.
 *
 * A request is sent to an outside party by email or WhatsApp (`RequestDispatch`),
 * carrying a reference that names it. What that party sends back is a reply
 * (`RequestReply`): who sent it, when, their words and their papers. A reply
 * is somebody outside the firm speaking, so it settles nothing by itself:
 *
 * - the request stays `sent`, and stands as "answered, waiting for a person
 *   to confirm" (`requestStanding`) until one of the firm's people confirms
 *   the reply or sets it aside;
 * - its papers go on the register through the same intake as a dropped
 *   file, each marked as an unconfirmed reply's (`EvidenceRecord.unconfirmedReply`),
 *   and a paper so marked answers no checklist line by its name;
 * - confirming is a named person's act: the mark comes off, the request is
 *   answered, and a request for one checklist line marks that line in hand.
 *
 * Mail that names no request, an expired or unknown one, or comes from an
 * address the project does not know, is not a reply. It waits in the firm's
 * "To sort" tray (`TrayItem`) until a person files it to a project or
 * discards it.
 *
 * Everything here is optional on the stored types: a project written before
 * this has no dispatches and no replies, and reads as it always did.
 */

import { receiveChecklistItem } from './checklist';
import { patchRequest } from './project-requests';
import type { DdProject, ProjectRequest } from './types';

export type OutsideChannel = 'email' | 'whatsapp';

export const OUTSIDE_CHANNEL_LABEL: Record<OutsideChannel, string> = { email: 'Email', whatsapp: 'WhatsApp' };

/** What an inbound message may carry. Past these it is cut, and says so. */
export const OUTSIDE_LIMITS = {
  /** Papers taken from one message. */
  attachments: 10,
  /** One paper, in bytes. */
  attachmentBytes: 25 * 1024 * 1024,
  /** All the papers of one message, in bytes. */
  messageBytes: 50 * 1024 * 1024,
  /** A message's own words kept, in characters. */
  text: 4000,
  subject: 300,
  fileName: 180,
  /** Days a request's reference is good for after it is sent. */
  referenceDays: 60,
  /** Items the tray keeps for one firm. */
  tray: 500,
} as const;

/** One sending of a request to an outside party. */
export interface RequestDispatch {
  id: string;
  channel: OutsideChannel;
  /** The address or number it went to. */
  to: string;
  at: string;
  by: string;
  /** The reference a reply names the request by: `<code>-<signature>`. */
  reference: string;
  /** After this the reference is not honoured, and a reply to it goes to the tray. */
  expiresAt: string;
  /** The provider's id for what was sent: a WhatsApp message id a reply can quote. */
  providerId?: string;
}

/** A paper that came with a message. */
export interface ReplyAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  /** The register row it is filed on, once it is on a project. */
  evidenceId?: string;
}

/** A paper a message carried that was not taken, and why. */
export interface ReplySkipped {
  fileName: string;
  reason: string;
}

/** What an outside party sent back to a request. */
export interface RequestReply {
  id: string;
  channel: OutsideChannel;
  /** The address or number it came from. */
  from: string;
  fromName?: string;
  receivedAt: string;
  /** The provider's id for the delivery: one delivery is one reply, however often it is sent. */
  deliveryId: string;
  subject?: string;
  /** Their own words, cut to `OUTSIDE_LIMITS.text`. Never rendered as markup, and no link in them is followed. */
  text?: string;
  attachments: ReplyAttachment[];
  skipped?: ReplySkipped[];
  confirmedAt?: string;
  confirmedBy?: string;
  setAsideAt?: string;
  setAsideBy?: string;
}

/** Why a message is in the tray and not on a request. */
export type TrayReason = 'no_reference' | 'unknown_reference' | 'expired' | 'unknown_sender' | 'unverified_sender' | 'closed';

export const TRAY_REASON_LABEL: Record<TrayReason, string> = {
  no_reference: 'Names no request',
  unknown_reference: 'Reference not recognised',
  expired: 'Reference expired',
  unknown_sender: 'Sender not on the project',
  unverified_sender: 'Sender could not be verified',
  closed: 'Request already closed',
};

/** A message nobody has sorted: held for the firm, on no project. */
export interface TrayItem {
  id: string;
  tenantId: string;
  channel: OutsideChannel;
  from: string;
  fromName?: string;
  receivedAt: string;
  deliveryId: string;
  subject?: string;
  text?: string;
  reason: TrayReason;
  /** The project and request its reference named, where it named one. A hint for the person sorting, never acted on. */
  projectId?: string;
  requestId?: string;
  attachments: ReplyAttachment[];
  skipped?: ReplySkipped[];
}

export type RequestStanding = ProjectRequest['status'] | 'replied';

export const REQUEST_REPLIED_LABEL = 'Answered, waiting for a person to confirm';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A reply nobody has confirmed or set aside. */
export function replyWaits(reply: RequestReply): boolean {
  return !reply.confirmedAt && !reply.setAsideAt;
}

/** The replies on a request that wait for a person. */
export function repliesWaiting(request: ProjectRequest): RequestReply[] {
  return (request.replies ?? []).filter(replyWaits);
}

/**
 * How a request stands. A sent request with a reply nobody has looked at is
 * `replied`: answered by the other side, and waiting for one of the firm's
 * people to say so. It is never `answered` by a reply alone.
 */
export function requestStanding(request: ProjectRequest): RequestStanding {
  if (request.status === 'sent' && repliesWaiting(request).length) return 'replied';
  return request.status;
}

/** The requests on a project with a reply waiting, by checklist line: the lines that are "answered, waiting for a person to confirm". */
export function checklistLinesReplied(project: DdProject): Map<string, { request: ProjectRequest; reply: RequestReply }> {
  const out = new Map<string, { request: ProjectRequest; reply: RequestReply }>();
  for (const request of project.requests ?? []) {
    if (requestStanding(request) !== 'replied') continue;
    const reply = repliesWaiting(request)[0]!;
    for (const id of request.checklistItemIds ?? []) out.set(id, { request, reply });
  }
  return out;
}

/** An address as it is compared. */
export function foldAddress(address: string | undefined): string {
  return (address ?? '').trim().toLowerCase();
}

/** A phone number as it is compared: its digits. Fewer than eight is no number. */
export function foldPhone(phone: string | undefined): string {
  const digits = (phone ?? '').replace(/\D+/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

/** The bare address out of `Name <address>`, or the text itself where it is one. */
export function addressOf(written: string | undefined): string {
  const text = (written ?? '').trim();
  const angled = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text);
  const bare = angled ? angled[1]! : text;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bare) ? bare.toLowerCase() : '';
}

/** The name out of `Name <address>`, where one is written. */
export function nameOf(written: string | undefined): string | undefined {
  const name = /^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/.exec(written ?? '')?.[1]?.trim();
  return name || undefined;
}

/**
 * The outside addresses and numbers a project knows: everybody a request on
 * it was addressed or sent to, and its team. Whoever else may reach the
 * project (the firm's members, people working from a grant) is for the
 * caller to add, since the project does not hold them.
 */
export function projectParties(project: DdProject): { emails: Set<string>; phones: Set<string> } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const email = (value: string | undefined) => {
    const folded = addressOf(value);
    if (folded) emails.add(folded);
  };
  const phone = (value: string | undefined) => {
    const folded = foldPhone(value);
    if (folded) phones.add(folded);
  };
  for (const request of project.requests ?? []) {
    email(request.recipient);
    email(request.recipientEmail);
    phone(request.recipientPhone);
    for (const dispatch of request.dispatches ?? []) (dispatch.channel === 'email' ? email : phone)(dispatch.to);
  }
  for (const member of project.team ?? []) email(member.email);
  return { emails, phones };
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The words of a request as it is mailed. Written by rule from the request a person made, by no model. */
export function requestEmail(project: Pick<DdProject, 'name' | 'reference'>, request: ProjectRequest, reference: string, firm?: string): { subject: string; text: string } {
  const lines = [
    `${firm ? `${oneLine(firm)} asks` : 'You are asked'} for the following on ${oneLine(project.name)} (${project.reference}):`,
    '',
    oneLine(request.title),
    ...(request.detail ? ['', request.detail.trim()] : []),
    ...(request.dueAt ? ['', `Needed by ${request.dueAt.slice(0, 10)}.`] : []),
    '',
    'Reply to this email with the papers attached. Your reply reaches the project team, who confirm what they receive.',
    '',
    `Reference: ${reference}`,
  ];
  return { subject: `${oneLine(project.name)}: ${oneLine(request.title)}`.slice(0, OUTSIDE_LIMITS.subject), text: lines.join('\n') };
}

/**
 * The four values a WhatsApp template for a request takes, in order: the
 * project, what is asked for, when it is needed, and the reference. A
 * template value holds no line break and no run of spaces.
 */
export function requestTemplateValues(project: Pick<DdProject, 'name'>, request: ProjectRequest, reference: string): [string, string, string, string] {
  const value = (text: string, max: number): string => oneLine(text).slice(0, max) || '-';
  return [value(project.name, 120), value(request.title, 300), request.dueAt ? request.dueAt.slice(0, 10) : 'as soon as you can', reference];
}

function findRequest(project: DdProject, requestId: string): ProjectRequest {
  const request = (project.requests ?? []).find((held) => held.id === requestId);
  if (!request) throw new Error('No request by that id.');
  return request;
}

/** Record that a request was sent out. A draft becomes sent; the address it went to is kept on the request. */
export function recordDispatch(project: DdProject, requestId: string, input: Omit<RequestDispatch, 'id'>): RequestDispatch {
  const request = findRequest(project, requestId);
  if (request.status === 'answered' || request.status === 'cancelled') throw new Error('This request is closed.');
  const dispatch: RequestDispatch = { id: newId('dsp'), ...input };
  request.dispatches = [...(request.dispatches ?? []), dispatch];
  if (input.channel === 'email') request.recipientEmail = input.to;
  else request.recipientPhone = input.to;
  if (request.status === 'draft') patchRequest(project, requestId, { status: 'sent' }, input.by);
  request.updatedAt = input.at;
  project.audit.push({ id: newId('aud'), at: input.at, actor: input.by, action: 'request_dispatched', entityType: 'request', entityId: request.id, newValue: `${OUTSIDE_CHANNEL_LABEL[input.channel]} · ${input.to}` });
  project.updatedAt = input.at;
  return dispatch;
}

/** A dispatch by its reference, on any request of the project. */
export function dispatchByReference(project: DdProject, reference: string): { request: ProjectRequest; dispatch: RequestDispatch } | undefined {
  for (const request of project.requests ?? []) {
    const dispatch = (request.dispatches ?? []).find((held) => held.reference === reference);
    if (dispatch) return { request, dispatch };
  }
  return undefined;
}

/**
 * Put a reply on its request. The request stays `sent`: a reply is the other
 * side's word, and waits for a person. One delivery is one reply: the same
 * delivery again changes nothing and is handed back as it was kept.
 */
export function recordReply(project: DdProject, requestId: string, input: Omit<RequestReply, 'id' | 'confirmedAt' | 'confirmedBy' | 'setAsideAt' | 'setAsideBy'>): { reply: RequestReply; fresh: boolean } {
  const request = findRequest(project, requestId);
  const kept = (request.replies ?? []).find((held) => held.deliveryId === input.deliveryId);
  if (kept) return { reply: kept, fresh: false };
  const reply: RequestReply = { id: newId('rpl'), ...input };
  request.replies = [...(request.replies ?? []), reply];
  request.updatedAt = input.receivedAt;
  // The papers are on the register already; each says whose word it is until a person confirms.
  for (const attachment of reply.attachments) {
    const row = attachment.evidenceId ? project.evidence.find((held) => held.id === attachment.evidenceId) : undefined;
    if (row) row.unconfirmedReply = { requestId: request.id, replyId: reply.id };
  }
  project.audit.push({ id: newId('aud'), at: input.receivedAt, actor: `outside:${input.from}`, action: 'request_replied', entityType: 'request', entityId: request.id, newValue: `${OUTSIDE_CHANNEL_LABEL[input.channel]} · ${reply.attachments.length} paper${reply.attachments.length === 1 ? '' : 's'}` });
  project.updatedAt = input.receivedAt;
  return { reply, fresh: true };
}

function findReply(request: ProjectRequest, replyId: string): RequestReply {
  const reply = (request.replies ?? []).find((held) => held.id === replyId);
  if (!reply) throw new Error('No reply by that id.');
  if (!replyWaits(reply)) throw new Error('This reply was already looked at.');
  return reply;
}

/**
 * A person confirms that a reply answers its request. Its papers stop being
 * the other side's word alone, the request is answered, and a request raised
 * for one checklist line marks that line in hand with the first paper. A
 * request for several lines leaves them to the checklist's own matching: no
 * rule can say which paper is which line.
 */
export function confirmReply(project: DdProject, requestId: string, replyId: string, actor: string): ProjectRequest {
  const request = findRequest(project, requestId);
  const reply = findReply(request, replyId);
  const at = nowIso();
  reply.confirmedAt = at;
  reply.confirmedBy = actor;
  const rows = reply.attachments.map((attachment) => project.evidence.find((held) => held.id === attachment.evidenceId)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  for (const row of rows) {
    delete row.unconfirmedReply;
    row.updatedAt = at;
  }
  const lines = (request.checklistItemIds ?? []).filter((id) => (project.checklist ?? []).some((item) => item.id === id && !item.received));
  if (lines.length === 1) receiveChecklistItem(project, lines[0]!, rows[0] ? { evidenceId: rows[0].id } : {}, actor);
  if (request.status !== 'answered') patchRequest(project, requestId, rows[0] ? { answeredByEvidenceId: rows[0].id } : { status: 'answered' }, actor);
  project.audit.push({ id: newId('aud'), at, actor, action: 'request_reply_confirmed', entityType: 'request', entityId: request.id, newValue: reply.from });
  return request;
}

/**
 * A person says a reply does not answer its request. The request goes on
 * waiting. Its papers stay on the register, marked rejected with the reason,
 * so the record shows what came and what was made of it.
 */
export function setAsideReply(project: DdProject, requestId: string, replyId: string, actor: string): ProjectRequest {
  const request = findRequest(project, requestId);
  const reply = findReply(request, replyId);
  const at = nowIso();
  reply.setAsideAt = at;
  reply.setAsideBy = actor;
  for (const attachment of reply.attachments) {
    const row = project.evidence.find((held) => held.id === attachment.evidenceId);
    if (!row) continue;
    delete row.unconfirmedReply;
    row.status = 'rejected';
    row.rejectionReason = `Set aside as a reply to “${request.title}”.`;
    row.updatedAt = at;
  }
  request.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: 'request_reply_set_aside', entityType: 'request', entityId: request.id, newValue: reply.from });
  project.updatedAt = at;
  return request;
}
