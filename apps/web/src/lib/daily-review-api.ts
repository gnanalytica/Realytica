import type { DdProject, DepartmentKey, SweepAs, SweepSuggestion } from '@realytica/shared';
import { request } from './api';

/**
 * The calls for what the daily review suggested. Every answer is the
 * suggestions nobody has decided, as the server holds them afterwards.
 */

export interface DailyReviewShown {
  /** Whether a model is set up. Without one the review does not run. */
  model: boolean;
  sweptAt?: string;
  suggestions: SweepSuggestion[];
  /** The departments whose suggestions this person may accept or dismiss. */
  decidesIn: DepartmentKey[];
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const dailyReviewApi = {
  open: (projectId: string) => request<DailyReviewShown>(`/projects/${projectId}/daily-review`),
  accept: (projectId: string, suggestionId: string) =>
    request<DailyReviewShown & { project: DdProject; record: { type: SweepAs; id: string } }>(`/projects/${projectId}/daily-review/${suggestionId}/accept`, post()),
  dismiss: (projectId: string, suggestionId: string, reason: string) => request<DailyReviewShown>(`/projects/${projectId}/daily-review/${suggestionId}/dismiss`, post({ reason })),
};
