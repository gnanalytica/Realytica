import { outgoingDocument, type DdProject, type OutgoingAbout, type OutgoingDraft, type OutgoingKind } from '@realytica/shared';
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

export const outgoingApi = {
  open: (projectId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing`),
  start: (projectId: string, input: { kind: OutgoingKind; about?: OutgoingAbout; to?: string; topic?: string }) => request<OutgoingShown & { draftId: string }>(`/projects/${projectId}/outgoing`, post(input)),
  change: (projectId: string, draftId: string, change: { to?: string; subject?: string; body?: string }) =>
    request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}`, { method: 'PUT', body: JSON.stringify(change) }),
  write: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}/write`, post()),
  approve: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}/approve`, post()),
  reopen: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}/reopen`, post()),
  remove: (projectId: string, draftId: string) => request<OutgoingShown>(`/projects/${projectId}/outgoing/${draftId}`, { method: 'DELETE' }),
  exported: (projectId: string, draftId: string) => request<{ noted: string }>(`/projects/${projectId}/outgoing/${draftId}/exported`, post()),
};

/** Where a draft opens: the Outgoing page of its project, on that draft. */
export function outgoingAddress(projectId: string, draftId?: string): string {
  return `/projects/${projectId}/outgoing${draftId ? `?draft=${encodeURIComponent(draftId)}` : ''}`;
}

/**
 * Saves a draft to the reader's disk as a Word file. The file is built here,
 * in the browser, from the draft as the page shows it, and the trail notes
 * that one was made before it is handed over: no file leaves that the trail
 * does not know of. Nothing is sent anywhere. The file is the person's to
 * send.
 */
export async function saveOutgoingDocx(project: DdProject, draft: OutgoingDraft): Promise<void> {
  const file = outgoingDocument(project, draft);
  const bytes = await outgoingDocx(file);
  await outgoingApi.exported(project.id, draft.id);
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
