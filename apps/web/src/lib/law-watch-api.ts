import type { DepartmentKey, LawChange, LawProposedAction, LawSource, LawSourceInput } from '@realytica/shared';
import { request } from './api';

/**
 * The calls for the firm's law and policy watch. Every change answers with
 * the watch as the record holds it afterwards, and what this person may do.
 */

export interface LawWaiting extends LawChange {
  /** The projects the source bears on, each with the departments this person may put an action under. */
  bearsOn: Array<{ id: string; name: string; departments: DepartmentKey[] }>;
}

export interface LawWatchShown {
  sources: LawSource[];
  waiting: LawWaiting[];
  decided: LawChange[];
  /** Whether a model is set up to propose what a change means. */
  model: boolean;
  mayManage: boolean;
  mayReview: boolean;
  /** A line for the person, after a look. */
  said?: string;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });

export const lawWatchApi = {
  open: () => request<LawWatchShown>('/law-watch'),
  add: (input: LawSourceInput) => request<LawWatchShown>('/law-watch/sources', send('POST', input)),
  change: (sourceId: string, input: LawSourceInput & { paused?: boolean }) => request<LawWatchShown>(`/law-watch/sources/${sourceId}`, send('PUT', input)),
  remove: (sourceId: string) => request<LawWatchShown>(`/law-watch/sources/${sourceId}`, { method: 'DELETE' }),
  look: (sourceId: string) => request<LawWatchShown>(`/law-watch/sources/${sourceId}/look`, send('POST')),
  pages: (changeId: string) => request<{ before: string; after: string }>(`/law-watch/changes/${changeId}/pages`),
  confirm: (changeId: string, summary: string, projects: Array<{ projectId: string; actions: LawProposedAction[] }>) => request<LawWatchShown>(`/law-watch/changes/${changeId}/confirm`, send('POST', { summary, projects })),
  dismiss: (changeId: string, why?: string) => request<LawWatchShown>(`/law-watch/changes/${changeId}/dismiss`, send('POST', why ? { why } : {})),
};
