/**
 * What a file is waiting on, and from whom.
 *
 * A request names a person, a thing asked for, when it was sent and when it
 * was promised. Its age is derived, never stored: a stored age is wrong the
 * morning after it is written. A request linked to an expected evidence row
 * answers itself when that row's document arrives, because the person who
 * files the deed should not also have to remember to close the chase for it.
 */

import type { DdProject, EvidenceStatus, ProjectRequest, ProjectRequestStatus } from './types';

export interface CreateRequestInput {
  title: string;
  detail?: string;
  recipient: string;
  recipientRole?: string;
  dueAt?: string;
  evidenceId?: string;
  /** Record it as sent now. A draft waits for someone to send it. */
  send?: boolean;
}

export interface PatchRequestInput {
  title?: string;
  detail?: string;
  recipient?: string;
  recipientRole?: string;
  dueAt?: string | null;
  status?: ProjectRequestStatus;
  answeredByEvidenceId?: string;
}

export interface WaitingOnItem {
  request: ProjectRequest;
  /** Whole days since it was sent. */
  ageDays: number;
  overdue: boolean;
}

const ARRIVED: ReadonlySet<EvidenceStatus> = new Set(['received', 'validated', 'used']);

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function requestsOf(project: DdProject): ProjectRequest[] {
  if (!project.requests) project.requests = [];
  return project.requests;
}

function findRequest(project: DdProject, requestId: string): ProjectRequest {
  const found = requestsOf(project).find((r) => r.id === requestId);
  if (!found) throw new Error(`Request ${requestId} not found`);
  return found;
}

export function addRequest(project: DdProject, input: CreateRequestInput, actor: string): ProjectRequest {
  const title = input.title.trim();
  const recipient = input.recipient.trim();
  if (!title) throw new Error('Say what is being asked for.');
  if (!recipient) throw new Error('Say who is being asked.');
  if (input.evidenceId && !project.evidence.some((e) => e.id === input.evidenceId)) {
    throw new Error(`Evidence ${input.evidenceId} not found`);
  }
  const at = nowIso();
  const request: ProjectRequest = {
    id: newId(),
    title,
    detail: input.detail?.trim() || undefined,
    recipient,
    recipientRole: input.recipientRole?.trim() || undefined,
    status: input.send ? 'sent' : 'draft',
    sentAt: input.send ? at : undefined,
    dueAt: input.dueAt || undefined,
    evidenceId: input.evidenceId,
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };
  requestsOf(project).push(request);
  // The row it will satisfy is now asked for, not merely expected.
  const row = input.evidenceId ? project.evidence.find((e) => e.id === input.evidenceId) : undefined;
  if (row && input.send && (row.status === 'expected' || row.status === 'missing')) {
    row.status = 'requested';
    row.owner = recipient;
    row.updatedAt = at;
  }
  project.audit.push({ id: `aud_${newId()}`, at, actor, action: 'request_created', entityType: 'request', entityId: request.id, newValue: `${title} · ${recipient}` });
  project.updatedAt = at;
  return request;
}

export function patchRequest(project: DdProject, requestId: string, input: PatchRequestInput, actor: string): ProjectRequest {
  const request = findRequest(project, requestId);
  const at = nowIso();
  const before = request.status;
  if (input.title !== undefined) request.title = input.title.trim() || request.title;
  if (input.detail !== undefined) request.detail = input.detail.trim() || undefined;
  if (input.recipient !== undefined) request.recipient = input.recipient.trim() || request.recipient;
  if (input.recipientRole !== undefined) request.recipientRole = input.recipientRole.trim() || undefined;
  if (input.dueAt !== undefined) request.dueAt = input.dueAt || undefined;
  if (input.answeredByEvidenceId !== undefined) {
    if (!project.evidence.some((e) => e.id === input.answeredByEvidenceId)) {
      throw new Error(`Evidence ${input.answeredByEvidenceId} not found`);
    }
    request.answeredByEvidenceId = input.answeredByEvidenceId;
    request.status = 'answered';
    request.answeredAt = at;
  }
  if (input.status !== undefined && input.status !== request.status) {
    request.status = input.status;
    if (input.status === 'sent' && !request.sentAt) request.sentAt = at;
    if (input.status === 'answered' && !request.answeredAt) request.answeredAt = at;
  }
  request.updatedAt = at;
  project.audit.push({
    id: `aud_${newId()}`,
    at,
    actor,
    action: 'request_updated',
    entityType: 'request',
    entityId: request.id,
    oldValue: before,
    newValue: request.status,
  });
  project.updatedAt = at;
  return request;
}

/**
 * Close every sent request whose linked document has arrived.
 *
 * Returns the ones it closed, so a caller can say so. Idempotent: an
 * answered request is never reopened here, because a document being
 * superseded later does not mean the person never sent it.
 */
export function reconcileRequests(project: DdProject, now = nowIso()): ProjectRequest[] {
  const closed: ProjectRequest[] = [];
  for (const request of requestsOf(project)) {
    if (request.status !== 'sent' || !request.evidenceId) continue;
    const row = project.evidence.find((e) => e.id === request.evidenceId);
    if (!row || !ARRIVED.has(row.status)) continue;
    request.status = 'answered';
    request.answeredByEvidenceId = row.id;
    request.answeredAt = now;
    request.updatedAt = now;
    closed.push(request);
  }
  return closed;
}

export function requestAgeDays(request: ProjectRequest, now = nowIso()): number {
  if (!request.sentAt) return 0;
  const ms = Date.parse(now) - Date.parse(request.sentAt);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

/** Everything sent and not yet answered, oldest first. */
export function waitingOn(project: DdProject, now = nowIso()): WaitingOnItem[] {
  const today = now.slice(0, 10);
  return requestsOf(project)
    .filter((r) => r.status === 'sent')
    .map((request) => ({
      request,
      ageDays: requestAgeDays(request, now),
      overdue: Boolean(request.dueAt && request.dueAt < today),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}
