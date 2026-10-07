import { outgoingDocument, outgoingSeen, type DdProject, type OutgoingAbout, type OutgoingDraft, type OutgoingKind } from '@realytica/shared';
import { request } from './api';
import { outgoingDocx } from './outgoing-docx';

/**
 * The calls for what goes out: letters, replies, requests for information
 * and minutes. Every change answers with the drafts as the record holds them
 * afterwards, with whether a model is set up and what this person may do.
 */

export interface OutgoingShown {
  drafts: OutgoingDraft[];
  /** Whether a model is set up to write a body. */
  model: boolean;
  mayDraft: boolean;
  mayApprove: boolean;
  /** A line for the person, where something did not go as asked. */
  said?: string;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });
/** An act on the draft as this page holds it. The server does it only while the draft still says the same, and answers 409 where it does not. */
const asSeen = (draft: OutgoingDraft): RequestInit => post({ seen: outgoingSeen(draft) });

export const outgoingApi = {
  open: (projectId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing`),
  start: (projectId: string, input: { kind: OutgoingKind; about?: OutgoingAbout; to?: string; topic?: string }) => request<OutgoingShown & { draftId: string }>(`/projects/${projectId}/outgoing`, post(input)),
  change: (projectId: string, draftId: string, change: { to?: string; subject?: string; body?: string }) =>
    request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}`, { method: 'PUT', body: JSON.stringify(change) }),
  write: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}/write`, post()),
  approve: (projectId: string, draft: OutgoingDraft) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draft.id}/approve`, asSeen(draft)),
  reopen: (projectId: string, draft: OutgoingDraft) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draft.id}/reopen`, asSeen(draft)),
  remove: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}`, { method: 'DELETE' }),
  exported: (projectId: string, draft: OutgoingDraft) => request<{ noted: string }>(`/projects/${projectId}/outgoing/${draft.id}/exported`, asSeen(draft)),
};

/** Where a draft opens: the Outgoing page of its project, on that draft. */
export function outgoingAddress(projectId: string, draftId?: string): string {
  return `/projects/${projectId}/outgoing${draftId ? `?draft=${encodeURIComponent(draftId)}` : ''}`;
}

/**
 * Saves a draft to the reader's disk as a Word file. The file is built here,
 * in the browser, from the draft as the page shows it. Before it is handed
 * over the server is told which draft it was made from: where the draft has
 * changed since, it refuses and no file leaves, so a file that says it is
 * approved holds the approved words. The trail notes the file then too, so
 * none leaves that the trail does not know of. Nothing is sent anywhere. The
 * file is the person's to send.
 */
export async function saveOutgoingDocx(project: DdProject, draft: OutgoingDraft): Promise<void> {
  const file = outgoingDocument(project, draft);
  const bytes = await outgoingDocx(file);
  await outgoingApi.exported(project.id, draft);
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
