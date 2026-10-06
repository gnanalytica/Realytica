/**
 * The departments' calls: who works where, engagements, certified reports,
 * milestones and the site log, alerts, links, ownership, the graph's impact
 * walk, and documents too large for one request.
 *
 * Reads that are pure functions of the project — the timeline, quick
 * assessments, the approvals register, progress — are not here: the browser
 * already holds the project and works them out itself.
 */

import type {
  AnswerProof,
  AnswerSource,
  CertifiedReadout,
  CertifiedReport,
  CreateEngagementInput,
  DdProject,
  DepartmentKey,
  DepartmentRole,
  Engagement,
  EngagementPatch,
  GraphImpact,
  LinkEnd,
  LinkType,
  Milestone,
  ObservationInput,
  ObservationPatch,
  ProjectAlert,
  ProjectLink,
  TeamMember,
} from '@realytica/shared';
import { fetchWithAuth, request } from './api';

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export interface FileCertifiedBody {
  workstream: string;
  title: string;
  evidenceId: string;
  signer: { name: string; profession: string; registration?: string; firm?: string };
  issuedOn?: string;
  scope?: string;
  figure?: { value: number; unit: 'INR' | '%' };
  verdict?: 'clear' | 'conditions' | 'blockers';
  conditions?: string[];
}

export interface PairCode {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform?: 'ios' | 'android' | 'web';
  email: string;
  createdAt: string;
  lastSeenAt?: string;
  push: boolean;
}

export const workspaceApi = {
  setDepartments: (projectId: string, departments: DepartmentKey[]) =>
    request<{ project: DdProject; departments: DepartmentKey[] }>(`/projects/${projectId}/departments`, { method: 'PUT', body: JSON.stringify({ departments }) }),

  setTeamMember: (
    projectId: string,
    email: string,
    body: { name?: string; departments: Partial<Record<DepartmentKey, DepartmentRole>>; signer?: { profession: string; registration?: string; firm?: string } },
  ) => request<{ project: DdProject; member: TeamMember }>(`/projects/${projectId}/team/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify(body) }),

  removeTeamMember: (projectId: string, email: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/team/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  startWorkstreamChecks: (projectId: string, workstream: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/workstreams/${workstream}/checks`, json({})),

  createEngagement: (projectId: string, body: CreateEngagementInput) =>
    request<{ project: DdProject; engagement: Engagement }>(`/projects/${projectId}/engagements`, json(body)),

  updateEngagement: (projectId: string, engagementId: string, patch: EngagementPatch) =>
    request<{ project: DdProject; engagement: Engagement }>(`/projects/${projectId}/engagements/${engagementId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  readCertified: (projectId: string, evidenceId: string) =>
    request<{ readout: CertifiedReadout }>(`/projects/${projectId}/certified/read`, json({ evidenceId })),

  fileCertified: (projectId: string, body: FileCertifiedBody) =>
    request<{ project: DdProject; report: CertifiedReport }>(`/projects/${projectId}/certified`, json(body)),

  acknowledgeRevisit: (projectId: string, reportId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/certified/${reportId}/acknowledge`, json({})),

  addMilestones: (projectId: string, body: { template?: boolean; rows?: Array<{ name: string; weight: number; plannedFinish?: string; assetId?: string }> }) =>
    request<{ project: DdProject; milestones: Milestone[] }>(`/projects/${projectId}/milestones`, json(body)),

  updateMilestone: (projectId: string, milestoneId: string, patch: { percent?: number; name?: string; weight?: number; plannedFinish?: string | null }) =>
    request<{ project: DdProject; milestone: Milestone }>(`/projects/${projectId}/milestones/${milestoneId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  removeMilestone: (projectId: string, milestoneId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }),

  readAlerts: (projectId: string, ids: string[] | 'all') =>
    request<{ read: number; alerts: ProjectAlert[] }>(`/projects/${projectId}/alerts/read`, json({ ids })),

  addLink: (projectId: string, body: { from: LinkEnd; to: LinkEnd; type: LinkType; note?: string }) =>
    request<{ project: DdProject; link: ProjectLink }>(`/projects/${projectId}/links`, json(body)),

  removeLink: (projectId: string, linkId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),

  addObservation: (projectId: string, body: ObservationInput & { department?: DepartmentKey }) => request<{ project: DdProject; findingId: string }>(`/projects/${projectId}/observations`, json(body)),

  patchObservation: (projectId: string, findingId: string, body: ObservationPatch) =>
    request<{ project: DdProject }>(`/projects/${projectId}/observations/${findingId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Accept, correct or write what a photograph shows; `null` clears it. */
  setPhotoDescription: (projectId: string, evidenceId: string, text: string | null) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/description`, { method: 'PUT', body: JSON.stringify({ text }) }),

  setPhotoInReport: (projectId: string, evidenceId: string, inReport: boolean) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/in-report`, { method: 'PUT', body: JSON.stringify({ inReport }) }),

  /** File a site-log photograph onto the document register, so it can be cited. */
  fileSitePhoto: (projectId: string, entryId: string, index: number) =>
    request<{ project: DdProject; evidenceId: string }>(`/projects/${projectId}/site-log/${entryId}/photos/${index}/file`, { method: 'POST' }),

  /** Import a questionnaire: an Excel, Word, PDF, CSV or text file, or the questions pasted as text. */
  importQuestionnaire: (projectId: string, input: ({ file: File; title?: string } | { title: string; text: string }) & { department?: DepartmentKey }) => {
    if ('file' in input) {
      const form = new FormData();
      form.append('file', input.file);
      if (input.department) form.append('department', input.department);
      if (input.title) form.append('title', input.title);
      return request<{ project: DdProject; questionnaireId: string }>(`/projects/${projectId}/questionnaires`, { method: 'POST', body: form });
    }
    return request<{ project: DdProject; questionnaireId: string }>(`/projects/${projectId}/questionnaires`, json(input));
  },

  /**
   * Saves the answered questionnaire to the reader's disk, as an Excel workbook or a PDF, each answer with its source.
   * Fetched with the session's token and handed to the browser as a download: a plain link would send no token.
   */
  saveQuestionnaire: async (projectId: string, questionnaireId: string, format: 'xlsx' | 'pdf', name: string): Promise<void> => {
    const res = await fetchWithAuth(`/api/projects/${projectId}/questionnaires/${questionnaireId}/export?format=${format}`);
    if (!res.ok) {
      const said = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(said?.error ?? `The questionnaire could not be taken out: ${res.status}`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  answerQuestion: (
    projectId: string,
    questionnaireId: string,
    questionId: string,
    body: { answer?: string | null; source?: AnswerSource | null; proof?: AnswerProof[]; note?: string | null; text?: string; section?: string | null; omitFromReport?: boolean },
  ) => request<{ project: DdProject }>(`/projects/${projectId}/questionnaires/${questionnaireId}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  addQuestion: (projectId: string, questionnaireId: string, body: { text: string; section?: string }) =>
    request<{ project: DdProject }>(`/projects/${projectId}/questionnaires/${questionnaireId}/questions`, json(body)),

  removeQuestion: (projectId: string, questionnaireId: string, questionId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/questionnaires/${questionnaireId}/questions/${questionId}`, { method: 'DELETE' }),

  confirmAnswers: (projectId: string, questionnaireId: string, questionIds?: string[]) =>
    request<{ project: DdProject; confirmed: number }>(`/projects/${projectId}/questionnaires/${questionnaireId}/confirm`, json({ questionIds })),

  removeQuestionnaire: (projectId: string, questionnaireId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/questionnaires/${questionnaireId}`, { method: 'DELETE' }),

  setDocumentWorkstream: (projectId: string, evidenceId: string, workstream: string | null) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/workstream`, { method: 'PUT', body: JSON.stringify({ workstream }) }),

  impact: (projectId: string, node: string) =>
    request<{ impact: GraphImpact; source: 'neo4j' | 'journal' | 'projection' }>(`/projects/${projectId}/graph/impact?node=${encodeURIComponent(node)}`),

  pairCode: () => request<PairCode>('/devices/pair-code', json({})),
  devices: () => request<{ devices: PairedDevice[] }>('/devices'),
  revokeDevice: (id: string) => request<void>(`/devices/${id}`, { method: 'DELETE' }),

  sitePhotoUrl: (projectId: string, entryId: string, index: number) => `/api/projects/${projectId}/site-log/${entryId}/photos/${index}`,
};

/**
 * File a document of any size into the vault, in parts small enough for a
 * serverless request. Reports progress as each part lands.
 */
export async function uploadLargeDocument(
  projectId: string,
  file: File,
  options: { evidenceId?: string; title?: string; onProgress?: (share: number) => void } = {},
): Promise<{ project: DdProject; evidenceId: string }> {
  const start = await request<{ uploadId: string; partBytes: number; parts: number }>(`/projects/${projectId}/uploads`, json({ fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size }));
  for (let n = 0; n < start.parts; n += 1) {
    const slice = file.slice(n * start.partBytes, Math.min(file.size, (n + 1) * start.partBytes));
    let tries = 0;
    for (;;) {
      const res = await fetchWithAuth(`/api/projects/${projectId}/uploads/${start.uploadId}/parts/${n}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: slice,
      });
      if (res.ok) break;
      tries += 1;
      if (tries >= 3) throw new Error(`Part ${n + 1} of ${start.parts} did not arrive (${res.status}).`);
    }
    options.onProgress?.((n + 1) / start.parts);
  }
  return request<{ project: DdProject; evidenceId: string }>(`/projects/${projectId}/uploads/${start.uploadId}/complete`, json({ evidenceId: options.evidenceId, title: options.title }));
}
