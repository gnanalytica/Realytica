/**
 * What comes back from outside the firm, and where it goes.
 *
 * A message arrives from a provider's webhook already checked as that
 * provider's (`routes/outside.ts`). Here it is one of two things:
 *
 * - **A reply.** It names a request by a reference whose signature holds,
 *   the reference is still good, the request is still open, and the sender
 *   is somebody the project knows. Its papers go through the intake a
 *   dropped file goes through (stored, a row on the register, read), each
 *   marked as an unconfirmed reply's, and the request stands as "answered,
 *   waiting for a person to confirm". Nothing here marks anything received.
 * - **Something to sort.** Anything else: no reference, one that does not
 *   hold or has expired, a closed request, or a sender the project does not
 *   know. It is kept in the firm's tray, on no project, until a person files
 *   it or discards it.
 *
 * A delivery is taken once (`claimDelivery`): providers send again, and
 * anybody holding a signed delivery could. A message carries at most
 * `OUTSIDE_LIMITS.attachments` papers of `attachmentBytes` each; what is
 * past that is left out and named on the reply. No address written in a
 * message is fetched.
 */

import { randomUUID } from 'node:crypto';
import {
  OUTSIDE_LIMITS,
  addEvidence,
  attachEvidenceFile,
  confirmReply,
  dispatchByReference,
  foldAddress,
  foldPhone,
  projectParties,
  recordAuditEvent,
  recordReply,
  type ChatIngestFile,
  type DdProject,
  type OutsideChannel,
  type ReplyAttachment,
  type ReplySkipped,
  type TrayItem,
  type TrayReason,
} from '@realytica/shared';
import { grantsForProject } from '../auth/access';
import { keepPageTexts } from '../documents/page-text';
import { readOntoRegister, type RegisterUpload } from '../documents/register-read';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { store } from '../store';
import { quotedReference, referenceHolds, referenceTarget } from './config';
import { TooLarge, type ProviderFile } from './providers';

/** A message from outside, as either provider's webhook hands it over. */
export interface InboundMessage {
  channel: OutsideChannel;
  /** The provider's id for the delivery. */
  deliveryId: string;
  /** An email address, or a phone number's digits. */
  from: string;
  fromName?: string;
  receivedAt: string;
  subject?: string;
  text?: string;
  /** Everything in it shaped like a reference, the likeliest first. */
  references: string[];
  /** The id of a message of ours this one quotes, on WhatsApp. */
  quotedProviderId?: string;
  /** False where the provider says the sender could not be who the message claims. */
  verified: boolean;
  files: ProviderFile[];
}

export type InboundOutcome =
  | { outcome: 'duplicate' }
  | { outcome: 'reply'; projectId: string; requestId: string; replyId: string }
  | { outcome: 'tray'; reason: TrayReason; itemId: string }
  | { outcome: 'dropped'; why: string };

/** How long the papers of one message are read for before the provider is answered. A model reads them later, when somebody asks. */
const READ_MS = 10_000;

/* ==================================================================== */
/* A delivery, once                                                      */
/* ==================================================================== */

const DELIVERIES = 'outside-deliveries';
const SEEN_KEY = 'seen.json';
const SEEN_KEPT = 5000;
const SEEN_DAYS = 30;

async function seen(): Promise<Record<string, number>> {
  const bytes = await storageAdapter.getDocument(DELIVERIES, SEEN_KEY);
  return bytes ? (JSON.parse(bytes.toString('utf-8')) as Record<string, number>) : {};
}

/** Take a delivery, once. False when it was taken before. */
export async function claimDelivery(deliveryId: string, now = Date.now()): Promise<boolean> {
  const held = await seen();
  if (held[deliveryId]) return false;
  held[deliveryId] = now;
  const kept = Object.entries(held)
    .filter(([, at]) => now - at < SEEN_DAYS * 86_400_000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SEEN_KEPT);
  await storageAdapter.putDocument(DELIVERIES, SEEN_KEY, Buffer.from(JSON.stringify(Object.fromEntries(kept))), 'application/json');
  return true;
}

/** Give a delivery back, so the provider's next try is taken: for one that could not be put anywhere. */
async function releaseDelivery(deliveryId: string): Promise<void> {
  const held = await seen();
  if (!held[deliveryId]) return;
  delete held[deliveryId];
  await storageAdapter.putDocument(DELIVERIES, SEEN_KEY, Buffer.from(JSON.stringify(held)), 'application/json');
}

/* ==================================================================== */
/* The tray                                                              */
/* ==================================================================== */

const trayCase = (tenantId: string): string => `outside-tray-${tenantId}`;
const TRAY_KEY = 'tray.json';

/** What waits to be sorted for one firm, the newest first. */
export async function readTray(tenantId: string): Promise<TrayItem[]> {
  const bytes = await storageAdapter.getDocument(trayCase(tenantId), TRAY_KEY);
  const items = bytes ? (JSON.parse(bytes.toString('utf-8')) as TrayItem[]) : [];
  return items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

async function writeTray(tenantId: string, items: TrayItem[]): Promise<void> {
  await storageAdapter.putDocument(trayCase(tenantId), TRAY_KEY, Buffer.from(JSON.stringify(items)), 'application/json');
}

/** The bytes of a paper held in the tray. */
export async function trayPaper(tenantId: string, itemId: string, attachmentId: string): Promise<{ attachment: ReplyAttachment; bytes: Buffer } | undefined> {
  const attachment = (await readTray(tenantId)).find((item) => item.id === itemId)?.attachments.find((held) => held.id === attachmentId);
  const bytes = attachment ? await storageAdapter.getDocument(trayCase(tenantId), attachment.storageKey) : null;
  return attachment && bytes ? { attachment, bytes } : undefined;
}

/** Take an item out of the tray and delete its papers from it. */
async function removeFromTray(tenantId: string, item: TrayItem): Promise<void> {
  await writeTray(tenantId, (await readTray(tenantId)).filter((held) => held.id !== item.id));
  for (const attachment of item.attachments) await storageAdapter.deleteDocument(trayCase(tenantId), attachment.storageKey).catch(() => undefined);
}

/** A person discards an item: it and its papers are gone. False where there is no such item. */
export async function discardTrayItem(tenantId: string, itemId: string): Promise<boolean> {
  const item = (await readTray(tenantId)).find((held) => held.id === itemId);
  if (!item) return false;
  await removeFromTray(tenantId, item);
  return true;
}

/* ==================================================================== */
/* The papers of a message                                               */
/* ==================================================================== */

interface Taken {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

/** A file's name as it is kept: no path, no control characters, and not endless. */
function cleanName(name: string): string {
  const base = name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()?.trim() ?? '';
  return (base || 'attachment').slice(-OUTSIDE_LIMITS.fileName);
}

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Download what a message may carry. What is over a cap, or would not download, is named and left out. */
async function takePapers(files: readonly ProviderFile[]): Promise<{ taken: Taken[]; skipped: ReplySkipped[] }> {
  const taken: Taken[] = [];
  const skipped: ReplySkipped[] = [];
  let total = 0;
  for (const file of files.filter((held) => !held.inline)) {
    const fileName = cleanName(file.fileName);
    if (taken.length >= OUTSIDE_LIMITS.attachments) {
      skipped.push({ fileName, reason: `More than ${OUTSIDE_LIMITS.attachments} papers in one message` });
      continue;
    }
    const room = Math.min(OUTSIDE_LIMITS.attachmentBytes, OUTSIDE_LIMITS.messageBytes - total);
    if ((file.sizeBytes ?? 0) > room) {
      skipped.push({ fileName, reason: `Larger than ${megabytes(OUTSIDE_LIMITS.attachmentBytes)}, or the message is over ${megabytes(OUTSIDE_LIMITS.messageBytes)}` });
      continue;
    }
    try {
      const bytes = await file.bytes(room);
      if (!bytes.length) {
        skipped.push({ fileName, reason: 'Empty' });
        continue;
      }
      total += bytes.length;
      taken.push({ fileName, mimeType: file.mimeType, bytes });
    } catch (err) {
      skipped.push({ fileName, reason: err instanceof TooLarge ? `Larger than ${megabytes(OUTSIDE_LIMITS.attachmentBytes)}, or the message is over ${megabytes(OUTSIDE_LIMITS.messageBytes)}` : 'Could not be downloaded' });
    }
  }
  return { taken, skipped };
}

const stem = (fileName: string): string => fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || fileName;

/**
 * Papers through the intake a dropped file goes through: stored, a row on
 * the register each, and read. `actor` is whose act the trail names: the
 * outside sender for a reply, the person filing for something sorted.
 */
async function fileOnRegister(project: DdProject, papers: readonly Taken[], source: string, actor: string): Promise<{ attachments: ReplyAttachment[]; read: () => Promise<void> }> {
  const attachments: ReplyAttachment[] = [];
  const reads: RegisterUpload[] = [];
  for (const paper of papers) {
    const storageKey = documentKey({ id: randomUUID(), fileName: paper.fileName });
    await storageAdapter.putDocument(project.id, storageKey, paper.bytes, paper.mimeType);
    const row = addEvidence(project, { title: stem(paper.fileName), kind: 'document', source, status: 'received' }, actor);
    const file = attachEvidenceFile(project, row.id, { fileName: paper.fileName, mimeType: paper.mimeType, sizeBytes: paper.bytes.length, storageKey }, actor);
    attachments.push({ id: file.id, fileName: paper.fileName, mimeType: paper.mimeType, sizeBytes: paper.bytes.length, storageKey, evidenceId: row.id });
    reads.push({ evidenceId: row.id, buffer: paper.bytes, fileName: paper.fileName, mimeType: paper.mimeType, sizeBytes: paper.bytes.length, storageKey });
  }
  const landed = async (file: ChatIngestFile): Promise<void> => {
    await keepPageTexts(project.id, [file]);
    project.updatedAt = new Date().toISOString();
    await store.save();
  };
  // Read after the caller has the papers on the record: a reader that hangs must not leave a filed paper unfiled.
  const read = async (): Promise<void> => {
    if (reads.length) await readOntoRegister(project, reads, actor, { deadline: Date.now() + READ_MS, modelBudgetMs: 0, landed }).catch(() => undefined);
    await store.save();
  };
  return { attachments, read };
}

/* ==================================================================== */
/* Where a message goes                                                  */
/* ==================================================================== */

const tenantOf = (project: DdProject): string | undefined => project.tenantId ?? store.data.tenants?.[0]?.id;

/** Whether a project knows this sender: a party a request went to, its team, the firm's own people, or somebody working from a grant on it. */
function knownSender(project: DdProject, message: InboundMessage): boolean {
  const parties = projectParties(project);
  if (message.channel === 'whatsapp') return parties.phones.has(foldPhone(message.from));
  const from = foldAddress(message.from);
  if (!from) return false;
  if (parties.emails.has(from)) return true;
  const tenantId = tenantOf(project);
  if (!tenantId) return false;
  if ((store.data.memberships ?? []).some((member) => member.tenantId === tenantId && foldAddress(member.email) === from)) return true;
  return grantsForProject(tenantId, project.id).some((grant) => foldAddress(grant.email) === from);
}

type Placed = { reply: { project: DdProject; requestId: string } } | { tray: { tenantId: string | undefined; reason: TrayReason; projectId?: string; requestId?: string } };

/** A reply to a request, or something to sort, and why. Reads the project the reference names as storage has it now. */
async function place(message: InboundMessage): Promise<Placed> {
  await store.syncIndex().catch(() => undefined);
  // Where no project is named, the tray is the firm's only where this deployment has one firm: it cannot be said whose it is among several.
  const sole = (store.data.tenants ?? []).length === 1 ? store.data.tenants![0]!.id : undefined;
  let reference = message.references.find(referenceHolds);
  if (!reference && message.quotedProviderId) reference = await quotedReference(message.quotedProviderId);
  if (!reference) return { tray: { tenantId: sole, reason: message.references.length ? 'unknown_reference' : 'no_reference' } };
  const target = await referenceTarget(reference);
  if (!target) return { tray: { tenantId: sole, reason: 'unknown_reference' } };
  await store.syncProject(target.projectId, { force: true });
  const project = store.data.projects?.find((held) => held.id === target.projectId);
  const found = project && tenantOf(project) === target.tenantId ? dispatchByReference(project, reference) : undefined;
  if (!project || !found || found.request.id !== target.requestId) return { tray: { tenantId: target.tenantId, reason: 'unknown_reference' } };
  const hint = { tenantId: target.tenantId, projectId: project.id, requestId: found.request.id };
  if (found.dispatch.expiresAt < message.receivedAt) return { tray: { ...hint, reason: 'expired' } };
  if (found.request.status !== 'sent') return { tray: { ...hint, reason: 'closed' } };
  if (!message.verified) return { tray: { ...hint, reason: 'unverified_sender' } };
  if (!knownSender(project, message)) return { tray: { ...hint, reason: 'unknown_sender' } };
  return { reply: { project, requestId: found.request.id } };
}

const words = (text: string | undefined, max: number): string | undefined => text?.replace(/\u0000/g, '').trim().slice(0, max) || undefined;

/** Take one message in: onto its request as a reply, or into the tray. Throws only where nothing could be kept, so the provider tries again. */
export async function takeIn(message: InboundMessage): Promise<InboundOutcome> {
  if (!(await claimDelivery(message.deliveryId))) return { outcome: 'duplicate' };
  try {
    const placed = await place(message);
    const said = { channel: message.channel, from: message.from, ...(message.fromName ? { fromName: words(message.fromName, 120) } : {}), receivedAt: message.receivedAt, deliveryId: message.deliveryId, subject: words(message.subject, OUTSIDE_LIMITS.subject), text: words(message.text, OUTSIDE_LIMITS.text) };

    if ('reply' in placed) {
      const { project, requestId } = placed.reply;
      const { taken, skipped } = await takePapers(message.files);
      const filed = await fileOnRegister(project, taken, `Reply from ${message.from}`, `outside:${message.from}`);
      const { reply } = recordReply(project, requestId, { ...said, attachments: filed.attachments, ...(skipped.length ? { skipped } : {}) });
      await store.save();
      await filed.read();
      return { outcome: 'reply', projectId: project.id, requestId, replyId: reply.id };
    }

    const { tenantId, reason, projectId, requestId } = placed.tray;
    if (!tenantId) {
      console.warn(`[outside] a ${message.channel} message naming no request was not kept: this deployment has more than one firm`);
      return { outcome: 'dropped', why: 'No firm to hold it for.' };
    }
    const held = await readTray(tenantId);
    if (held.length >= OUTSIDE_LIMITS.tray) {
      console.warn(`[outside] the tray of ${tenantId} is full; a ${message.channel} message was not kept`);
      return { outcome: 'dropped', why: 'The tray is full.' };
    }
    const { taken, skipped } = await takePapers(message.files);
    const attachments: ReplyAttachment[] = [];
    for (const paper of taken) {
      const id = randomUUID();
      const storageKey = documentKey({ id, fileName: paper.fileName });
      await storageAdapter.putDocument(trayCase(tenantId), storageKey, paper.bytes, paper.mimeType);
      attachments.push({ id, fileName: paper.fileName, mimeType: paper.mimeType, sizeBytes: paper.bytes.length, storageKey });
    }
    const item: TrayItem = { id: `tray_${randomUUID()}`, tenantId, ...said, reason, ...(projectId ? { projectId } : {}), ...(requestId ? { requestId } : {}), attachments, ...(skipped.length ? { skipped } : {}) };
    // Read again before writing: the papers took a while, and another message may have been kept meanwhile.
    await writeTray(tenantId, [...(await readTray(tenantId)).filter((kept) => kept.deliveryId !== item.deliveryId), item]);
    return { outcome: 'tray', reason, itemId: item.id };
  } catch (err) {
    await releaseDelivery(message.deliveryId).catch(() => undefined);
    throw err;
  }
}

/**
 * A person files something from the tray to a project: its papers go through
 * intake as their act, and the item leaves the tray. Named for a request,
 * it is that request's reply, confirmed by the same person in the same act.
 */
export async function fileTrayItem(tenantId: string, itemId: string, project: DdProject, requestId: string | undefined, actor: string): Promise<void> {
  const item = (await readTray(tenantId)).find((held) => held.id === itemId);
  if (!item) throw new Error('No item by that id.');
  if (requestId && !(project.requests ?? []).some((held) => held.id === requestId)) throw new Error('No request by that id.');
  const papers: Taken[] = [];
  for (const attachment of item.attachments) {
    const bytes = await storageAdapter.getDocument(trayCase(tenantId), attachment.storageKey);
    if (bytes) papers.push({ fileName: attachment.fileName, mimeType: attachment.mimeType, bytes });
  }
  const filed = await fileOnRegister(project, papers, `From ${item.from}, filed from the tray`, actor);
  if (requestId) {
    const { reply } = recordReply(project, requestId, { channel: item.channel, from: item.from, ...(item.fromName ? { fromName: item.fromName } : {}), receivedAt: item.receivedAt, deliveryId: item.deliveryId, subject: item.subject, text: item.text, attachments: filed.attachments, ...(item.skipped?.length ? { skipped: item.skipped } : {}) });
    confirmReply(project, requestId, reply.id, actor);
  } else {
    recordAuditEvent(project, { actor, action: 'tray_filed', entityType: 'project', entityId: project.id, newValue: `${item.from} · ${filed.attachments.length} paper${filed.attachments.length === 1 ? '' : 's'}` });
  }
  await store.save();
  await removeFromTray(tenantId, item);
  await filed.read();
}
