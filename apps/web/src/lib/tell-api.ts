import type { TellLine } from '@realytica/shared';
import { request } from './api';

/**
 * The calls for what I have been told: a paper filed, a value accepted or
 * changed, a checklist line or a request answered. Every one is the caller's
 * own; nothing here reads or marks for anybody else.
 */

export interface TellShown {
  notices: TellLine[];
  unread: number;
  /** The projects this person has quieted: nothing about them is mailed or pushed. */
  quiet: Array<{ projectId: string; projectName: string; projectReference: string }>;
  /** Whether anything can leave the app for this person: mail needs a key on the deployment, push a paired phone. */
  channels: { email: boolean; push: boolean };
  asOf: string;
}

export const tellApi = {
  open: () => request<TellShown>('/tell'),
  read: (ids: string[] | 'all') => request<{ read: number }>('/tell/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  quiet: (projectId: string, quiet: boolean) => request<{ projectId: string; quiet: boolean }>(`/tell/quiet/${encodeURIComponent(projectId)}`, { method: 'PUT', body: JSON.stringify({ quiet }) }),
};
