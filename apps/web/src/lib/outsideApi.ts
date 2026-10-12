import type { DdProject, OutsideChannel, TrayItem } from '@realytica/shared';
import { fetchWithAuth, request } from './api';

/** Whether a channel is set up on this deployment, and the settings still missing. */
export interface ChannelStatus {
  send: boolean;
  receive: boolean;
  missing: string[];
}

export type OutsideStatus = Record<OutsideChannel, ChannelStatus>;

let statusOnce: Promise<OutsideStatus> | undefined;

/** Hand a file to the person as a download. A paper from outside is saved, never opened in the page. */
export async function saveFile(path: string, fileName: string): Promise<void> {
  const res = await fetchWithAuth(path);
  if (!res.ok) throw new Error('Could not open that paper');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Requests that leave the firm by email or WhatsApp, their replies, and the tray of what could not be placed. */
export const outsideApi = {
  /** Asked once a page load: it is a fact of the deployment. */
  status: (): Promise<OutsideStatus> => (statusOnce ??= request<OutsideStatus>('/outside/status').catch((err) => {
    statusOnce = undefined;
    throw err;
  })),
  send: (projectId: string, requestId: string, body: { channel: OutsideChannel; to: string }) =>
    request<{ project: DdProject }>(`/outside/projects/${projectId}/requests/${requestId}/send`, { method: 'POST', body: JSON.stringify(body) }),
  confirm: (projectId: string, requestId: string, replyId: string) =>
    request<{ project: DdProject }>(`/outside/projects/${projectId}/requests/${requestId}/replies/${replyId}/confirm`, { method: 'POST' }),
  setAside: (projectId: string, requestId: string, replyId: string) =>
    request<{ project: DdProject }>(`/outside/projects/${projectId}/requests/${requestId}/replies/${replyId}/set-aside`, { method: 'POST' }),
  tray: () => request<{ items: TrayItem[] }>('/outside/tray'),
  file: (itemId: string, body: { projectId: string; requestId?: string }) => request<{ items: TrayItem[] }>(`/outside/tray/${itemId}/file`, { method: 'POST', body: JSON.stringify(body) }),
  discard: (itemId: string) => request<{ items: TrayItem[] }>(`/outside/tray/${itemId}/discard`, { method: 'POST' }),
  savePaper: (itemId: string, attachmentId: string, fileName: string) => saveFile(`/api/outside/tray/${itemId}/papers/${attachmentId}`, fileName),
};
