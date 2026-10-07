import type { NewReviewColumn, ReviewLibraryInput, ReviewLibraryItem, ReviewRowChoice, ReviewRun, ReviewTable } from '@realytica/shared';
import { fetchWithAuth, request } from './api';

/**
 * The review table's calls, and the workspace library's.
 *
 * Every change to a table answers with the table as the record holds it
 * afterwards, and not with the whole project: a run makes one call a paper,
 * and a project is a large thing to send back twenty-five times.
 */

/** A saved ask or playbook as this person is shown it. */
export type SavedReviewItem = ReviewLibraryItem & { mayChange: boolean };

interface Table {
  reviewTable: ReviewTable;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const reviewApi = {
  /** The table, whether a model is set up, and whether this person may change it. */
  open: (projectId: string) => request<Table & { model: boolean; mayChange: boolean }>(`/projects/${projectId}/review`),
  addColumns: (projectId: string, columns: NewReviewColumn[]) => request<Table>(`/projects/${projectId}/review/columns`, post({ columns })),
  removeColumn: (projectId: string, columnId: string) => request<Table>(`/projects/${projectId}/review/columns/${encodeURIComponent(columnId)}`, { method: 'DELETE' }),
  askAgain: (projectId: string, columnId: string, evidenceIds: string[]) =>
    request<Table>(`/projects/${projectId}/review/columns/${encodeURIComponent(columnId)}/ask-again`, post({ evidenceIds })),
  setReviewed: (projectId: string, evidenceId: string, reviewed: boolean) =>
    request<Table>(`/projects/${projectId}/review/rows/${evidenceId}/reviewed`, { method: 'PUT', body: JSON.stringify({ reviewed }) }),
  startRun: (projectId: string, evidenceIds: string[]) => request<Table & { run: ReviewRun }>(`/projects/${projectId}/review/runs`, post({ evidenceIds })),
  /** One paper of a run: every question asked of it, in one call. `failed` says why nothing was kept for it. */
  answerPaper: (projectId: string, runId: string, evidenceId: string, signal?: AbortSignal) =>
    request<Table & { failed?: string }>(`/projects/${projectId}/review/runs/${runId}/papers/${evidenceId}`, { ...post(), signal }),
  stopRun: (projectId: string, runId: string) => request<Table>(`/projects/${projectId}/review/runs/${runId}/stop`, post()),
  /** Puts a saved ask's or a playbook's columns on the table. `show` is the papers to look at afterwards, where it names any. */
  runSaved: (projectId: string, itemId: string, evidenceId?: string) =>
    request<Table & { show?: ReviewRowChoice }>(`/projects/${projectId}/review/library/${itemId}/run`, post(evidenceId ? { evidenceId } : {})),

  library: () => request<{ items: SavedReviewItem[]; mayAdd: boolean }>('/libraries/review'),
  save: (input: ReviewLibraryInput) => request<{ item: SavedReviewItem }>('/libraries/review', post(input)),
  change: (itemId: string, input: ReviewLibraryInput) => request<{ item: SavedReviewItem }>(`/libraries/review/${itemId}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (itemId: string) => request<void>(`/libraries/review/${itemId}`, { method: 'DELETE' }),
};

/** A project's review table, at the papers to show: one kind, one function's, or papers by name. */
export function reviewAddress(projectId: string, choice?: ReviewRowChoice): string {
  const base = `/projects/${projectId}/review`;
  if (choice?.by === 'kind') return `${base}?kind=${encodeURIComponent(choice.kind)}`;
  if (choice?.by === 'function') return `${base}?fn=${encodeURIComponent(choice.fn)}`;
  return choice?.by === 'papers' && choice.ids.length ? `${base}?paper=${choice.ids.map(encodeURIComponent).join(',')}` : base;
}

/**
 * Saves the table for the papers on screen to the reader's disk, as CSV or
 * as an Excel workbook. Fetched with the session's token and handed to the
 * browser as a download: a plain link would send no token.
 */
export async function saveReviewTable(projectId: string, format: 'csv' | 'xlsx', evidenceIds: string[], reference: string): Promise<void> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/review/export`, post({ format, evidenceIds }));
  if (!res.ok) {
    const said = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(said?.error ?? `The table could not be exported: ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reference}-review.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
