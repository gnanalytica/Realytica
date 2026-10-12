/**
 * The calls for filling an empty form: take one in, read its blanks with
 * what the record offers for each, decide them, and take the files out.
 *
 * A template is not on the project the browser holds: it is read from its
 * own route, and what the record offers for a blank is worked out there, so
 * the page shows what the server would write.
 */

import type { DepartmentKey, TemplateDecision, TemplateView } from '@realytica/shared';
import { fetchWithAuth, request } from './api';

/** A template in a list: everything but its blanks. */
export type TemplateListed = Omit<TemplateView, 'rows'>;

export type TemplateFileKind = 'filled' | 'sources' | 'original';

export const templateApi = {
  list: (projectId: string, department: DepartmentKey) => request<{ templates: TemplateListed[]; model: boolean }>(`/projects/${projectId}/templates?department=${department}`),

  /** Take in a Word file or a workbook: its blanks are found, and each is offered what the record holds. */
  upload: (projectId: string, file: File, department: DepartmentKey) => {
    const form = new FormData();
    form.set('department', department);
    form.set('file', file);
    return request<{ template: TemplateView; model: boolean }>(`/projects/${projectId}/templates`, { method: 'POST', body: form });
  },

  get: (projectId: string, templateId: string) => request<{ template: TemplateView; model: boolean; mayEdit: boolean; mayDecide: boolean }>(`/projects/${projectId}/templates/${templateId}`),

  decide: (projectId: string, templateId: string, decisions: TemplateDecision[]) =>
    request<{ template: TemplateView }>(`/projects/${projectId}/templates/${templateId}/fields`, { method: 'PUT', body: JSON.stringify({ decisions }) }),

  remove: (projectId: string, templateId: string) => request<{ ok: true }>(`/projects/${projectId}/templates/${templateId}`, { method: 'DELETE' }),

  /**
   * Saves a template's file to the reader's disk: the same file filled, the list of its sources, or the file as it was sent.
   * Fetched with the session's token and handed to the browser as a download: a plain link would send no token.
   */
  save: async (projectId: string, templateId: string, kind: TemplateFileKind, name: string): Promise<void> => {
    const res = await fetchWithAuth(`/api/projects/${projectId}/templates/${templateId}/file?kind=${kind}`);
    if (!res.ok) {
      const said = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(said?.error ?? `The file could not be taken out: ${res.status}`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
