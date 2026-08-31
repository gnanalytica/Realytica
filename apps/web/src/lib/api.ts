import type {
  AgentCapability,
  AgentKind,
  AgentRun,
  AgentStep,
  CaseSummary,
  ComparisonResult,
  CopilotTurn,
  CreateCaseRequest,
  CaseDocument,
  DataSourceDescriptor,
  DocumentKind,
  IngestionReport,
  IntakeReadout,
  IntakeSession,
  MemoryRecall,
  PromptDescriptor,
  PromptInvariantCheck,
  PropertyCase,
  ReferenceData,
  RiskStatus,
  RunGraph,
  SiteContext,
  StalenessReport,
  TitleGraph,
  DisclosureLevel,
  ProjectIntent,
  ProjectKind,
  ScreenResult,
  CaseRequest,
  RequestRecipient,
  RequestStatus,
  TechnicalFinding,
  TechnicalFindingDraft,
  TechnicalSystem,
  TechnicalFindingPatch,
  TechnicalFindingReviewState,
  TelemetrySummary,
  UpdateCaseRequest,
  DdEdge,
  DdGraph,
  DdNode,
  DdProject,
  ProjectSummary,
  Asset,
  DdAssessment,
  CheckInstance,
  EvidenceRecord,
  FindingRecord,
  RiskRecord,
  ActionRecord,
  DecisionRecord,
  GeneratedReport,
  StageRecord,
  CreateProjectInput,
  CreateAssetInput,
  CreateAssessmentInput,
  RecordCheckInput,
  CreateEvidenceInput,
  CreateFindingInput,
  CreateRiskInput,
  CreateActionInput,
  CreateDecisionInput,
  GenerateReportInput,
  ChangeSincePrevious,
  ScopeDefinition,
  DdTypeDefinition,
  CheckDefinition,
  PatchProjectInput,
  ProjectDashboard,
  ProjectGraphNode,
  ProjectGraphEdge,
  ValuationRun,
  ValuationSignOff,
  CapabilityRun,
  AiDraft,
  AiDraftStatus,
  EvidenceAttachment,
  ProjectChatResult,
  ProjectScreenSnapshot,
  OrchestratorRun,
} from '@realytica/shared';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CopilotAnswer {
  userTurn: CopilotTurn;
  assistantTurn: CopilotTurn;
  /** One line per user command the turn executed (the authorship law's acting half). */
  appliedCommands?: string[];
  /** Views the person asked chat to open; the caller navigates to the first. */
  navigations?: { target: string }[];
}

/**
 * Read the copilot's NDJSON response, reporting progress as it arrives.
 *
 * Written to survive not streaming. A proxy that buffers the whole body
 * delivers every line in one chunk, and this reads them in order and ends at
 * the same result — so a deployment where streaming does not work behaves
 * exactly as it did before, with the steps arriving all at once at the end
 * instead of never. That is the property that made streaming worth adding on
 * the existing route rather than a second one.
 *
 * A partial line at a chunk boundary is normal and is why the buffer is kept
 * across reads: a 4KB chunk will routinely split a step in half, and parsing
 * eagerly would throw on valid output.
 */
async function askCopilotStreaming(
  id: string,
  question: string,
  viewContext?: string,
  onStep?: (step: AgentStep) => void,
): Promise<CopilotAnswer> {
  const res = await fetch(`${BASE}/cases/${id}/agents/copilot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, viewContext }),
  });

  // A failure BEFORE the first line is still an ordinary status + JSON body:
  // validation, a missing case, no credentials. Only a failure after the
  // stream opened arrives as an error line.
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, res.status);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiRequestError('The copilot response could not be read.', 502);

  const decoder = new TextDecoder();
  let buffer = '';
  let answer: CopilotAnswer | null = null;
  let failure: string | null = null;

  const consume = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    let parsed: { type?: string; step?: AgentStep; error?: string } & Partial<CopilotAnswer>;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A line we cannot parse is not worth failing the answer over — the
      // result line is what matters and it is parsed on its own.
      return;
    }
    if (parsed.type === 'step' && parsed.step) onStep?.(parsed.step);
    else if (parsed.type === 'error') failure = parsed.error ?? 'The copilot failed.';
    else if (parsed.type === 'result' && parsed.userTurn && parsed.assistantTurn) {
      answer = {
        userTurn: parsed.userTurn,
        assistantTurn: parsed.assistantTurn,
        appliedCommands: parsed.appliedCommands,
        navigations: parsed.navigations,
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const l of lines) consume(l);
  }
  consume(buffer);

  if (failure) throw new ApiRequestError(failure, 502);
  if (!answer) {
    // The stream ended without a result and without an error — a killed
    // function, a dropped connection. Saying so beats returning a half-built
    // object the caller would render as an answer.
    throw new ApiRequestError('The copilot stopped before it answered. Please retry.', 502);
  }
  return answer;
}

export class ApiRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * What one upload call may contain. Reported by the API rather than assumed,
 * because it depends on where the API is running: a server takes whatever
 * multer allows, while a serverless platform caps the whole request body
 * regardless.
 */
export interface UploadLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxRequestBytes: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  cases?: number;
  projects?: number;
  upload: UploadLimits;
}

/**
 * What the prompt editor sends when saving.
 *
 * Structurally identical to `PromptDraft` in `pages/Prompts.tsx`, declared
 * here rather than imported so the API client does not depend on a page.
 * `invariants` is the editor's own live evaluation: it is sent so the two
 * sides can be compared, and the server ignores it and recomputes — a
 * client-supplied "all guardrails satisfied" is exactly the claim this system
 * must never take on trust.
 */
export interface PromptDraft {
  label: string;
  content: string;
  notes?: string;
  activate: boolean;
  invariants: PromptInvariantCheck[];
}

/** What every intake route returns: the stored half, and everything derived from it. */
export interface IntakeEnvelope {
  session: IntakeSession;
  readout: IntakeReadout;
}

/**
 * Where one document's bytes live.
 *
 * A standalone function as well as an `api` method because both viewers need
 * it — the preview modal builds an iframe `src`, the cockpit's viewer fetches
 * it — and two hand-written copies of a URL is how a route comes to be
 * renamed in one place and not the other.
 *
 * `download` forces the attachment path server-side, so the same URL backs
 * the viewer and the download button.
 */
export function documentFileUrl(id: string, docId: string, opts?: { download?: boolean }): string {
  return `${BASE}/cases/${id}/documents/${docId}/file${opts?.download ? '?download=1' : ''}`;
}

export function evidenceFileUrl(projectId: string, evidenceId: string, fileId: string): string {
  return `${BASE}/projects/${projectId}/evidence/${evidenceId}/files/${fileId}`;
}

export const api = {
  health: () => request<HealthResponse>('/health'),

  reference: () => request<ReferenceData>('/reference'),

  listCases: () => request<CaseSummary[]>('/cases'),

  getCase: (id: string) => request<PropertyCase>(`/cases/${id}`),

  createCase: (body: CreateCaseRequest) =>
    request<PropertyCase>('/cases', { method: 'POST', body: JSON.stringify(body) }),

  updateCase: (id: string, body: UpdateCaseRequest) =>
    request<PropertyCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteCase: (id: string) => request<void>(`/cases/${id}`, { method: 'DELETE' }),

  uploadDocuments: (id: string, files: File[], capture?: { zone?: string; system?: TechnicalSystem }) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    // Capture-time mapping: applied server-side to the image files only.
    if (capture?.zone) form.append('captureZone', capture.zone);
    if (capture?.system) form.append('captureSystem', capture.system);
    return request<CaseDocument[]>(`/cases/${id}/documents`, { method: 'POST', body: form });
  },

  updateDocument: (
    id: string,
    docId: string,
    body: { kind?: DocumentKind; notes?: string; captureZone?: string | null; captureSystem?: TechnicalSystem | null },
  ) =>
    request<CaseDocument>(`/cases/${id}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteDocument: (id: string, docId: string) =>
    request<void>(`/cases/${id}/documents/${docId}`, { method: 'DELETE' }),

  /**
   * Where a document's bytes are served from.
   *
   * A URL rather than a fetch, because the two things that consume it — an
   * `<iframe>`/`<img>` and a download link — both want the browser to do the
   * request itself. `download` swaps the route to the attachment path, so the
   * viewer and the save button share one address.
   */
  documentFileUrl,

  /** Change who the case is written for. Does not re-screen — see the route. */

  /**
   * Set how much about this property may leave the system. Does not re-run
   * anything — it governs the next search, not the last one.
   */
  setDisclosure: (id: string, disclosure: DisclosureLevel) =>
    request<PropertyCase>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ disclosure }) }),

  /**
   * Sweep public records for this property, at whatever disclosure level the
   * case carries. Returns the whole case, because the sweep lands on it.
   */
  discoverProperty: (id: string) => request<PropertyCase>(`/cases/${id}/agents/discover`, { method: 'POST' }),

  /** What statutory records this deployment can fetch, and the manual route for the rest. */
  recordCapability: (id: string) =>
    request<{
      provider: { id: string; label: string; configured: boolean; standing: string; capabilities: { kinds: string[]; regions: string[]; monitor: boolean } };
      manualRoutes: Record<string, { label: string; leavesUnknown: string; manualRoute: string }>;
    }>(`/cases/${id}/records`),

  /**
   * Fetch one statutory record from the configured vendor. A gap comes back
   * as `ok: false` with a reason and a manual route — a real answer about the
   * case, not a transport failure.
   */
  fetchRecord: (id: string, body: { kind: string; period?: { fromYear: number; toYear: number } }) =>
    request<
      | { ok: true; record: { kind: string; providerId: string; authority: string; nilResult?: boolean; coverageNote?: string; retrievedAt: string }; document?: CaseDocument; case: PropertyCase }
      | { ok: false; gap: { reason: string; kind: string; leavesUnknown: string; manualRoute: string; detail?: string } }
    >(`/cases/${id}/records`, { method: 'POST', body: JSON.stringify(body) }),

  /**
   * Supply the parcel outline as a KML or GeoJSON file's text. Re-screens,
   * because it changes the setback footprint and produces the extent
   * comparison nothing else on the case can.
   */
  setBoundary: (id: string, body: { fileText: string; note?: string }) =>
    request<PropertyCase>(`/cases/${id}/records/boundary`, { method: 'PUT', body: JSON.stringify(body) }),

  runScreen: (id: string) => request<ScreenResult>(`/cases/${id}/screen`, { method: 'POST' }),

  /**
   * State what kind of project this is and re-screen against it. Returns the
   * new result, because the whole point is that the numbers change.
   */
  setProjectKind: (id: string, body: { kind: ProjectKind; intent?: ProjectIntent; unitsPlanned?: number }) =>
    request<ScreenResult>(`/cases/${id}/project`, { method: 'PUT', body: JSON.stringify(body) }),

  setRiskStatus: (id: string, riskId: string, status: RiskStatus) =>
    request<ScreenResult>(`/cases/${id}/risks/${riskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  setActionDone: (id: string, actionId: string, done: boolean) =>
    request<ScreenResult>(`/cases/${id}/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    }),

  createTechnicalFinding: (id: string, draft: TechnicalFindingDraft) =>
    request<TechnicalFinding>(`/cases/${id}/technical-findings`, { method: 'POST', body: JSON.stringify(draft) }),

  updateTechnicalFinding: (id: string, findingId: string, patch: TechnicalFindingPatch) =>
    request<TechnicalFinding>(`/cases/${id}/technical-findings/${findingId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  reviewTechnicalFinding: (id: string, findingId: string, reviewState: Extract<TechnicalFindingReviewState, 'accepted' | 'rejected'>) =>
    request<TechnicalFinding>(`/cases/${id}/technical-findings/${findingId}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewState }),
    }),

  deleteTechnicalFinding: (id: string, findingId: string) =>
    request<void>(`/cases/${id}/technical-findings/${findingId}`, { method: 'DELETE' }),

  createRequests: (
    id: string,
    items: { domain: string; what: string; why: string; recipient: RequestRecipient; dueAt?: string; originGapId?: string }[],
  ) => request<CaseRequest[]>(`/cases/${id}/requests`, { method: 'POST', body: JSON.stringify({ items }) }),

  updateRequest: (
    id: string,
    requestId: string,
    body: { status?: RequestStatus; recipient?: RequestRecipient; dueAt?: string | null; answeredWithDocumentId?: string | null },
  ) => request<CaseRequest>(`/cases/${id}/requests/${requestId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteRequest: (id: string, requestId: string) =>
    request<void>(`/cases/${id}/requests/${requestId}`, { method: 'DELETE' }),

  setTechnicalDocumentProvided: (id: string, itemId: string, provided: boolean) =>
    request<{ technicalDocumentsProvided: Record<string, boolean> }>(`/cases/${id}/technical-documents`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId, provided }),
    }),

  compare: (caseIds: string[]) =>
    request<ComparisonResult>('/compare', { method: 'POST', body: JSON.stringify({ caseIds }) }),

  seedDemo: () => request<{ created: number }>('/demo/seed', { method: 'POST' }),

  resetAll: () => request<{ ok: true }>('/demo/reset', { method: 'POST' }),

  agentCapability: () => request<AgentCapability>('/agents/capability'),

  /** Cross-provider cost, latency and degradation, for the model-operations view. */
  telemetry: (params: { sinceMinutes?: number; caseId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.sinceMinutes) q.set('sinceMinutes', String(params.sinceMinutes));
    if (params.caseId) q.set('caseId', params.caseId);
    const suffix = q.toString() ? `?${q}` : '';
    return request<TelemetrySummary>(`/telemetry${suffix}`);
  },

  runAgents: (id: string, agents?: AgentKind[]) =>
    request<PropertyCase>(`/cases/${id}/agents/run`, {
      method: 'POST',
      body: JSON.stringify({ agents }),
    }),

  askCopilot: (id: string, question: string, viewContext?: string, onStep?: (step: AgentStep) => void) =>
    askCopilotStreaming(id, question, viewContext, onStep),

  clearConversation: (id: string) => request<void>(`/cases/${id}/agents/conversation`, { method: 'DELETE' }),

  /** Sources that bear on this property, including the ones that cannot be reached. */
  caseSources: (id: string) => request<DataSourceDescriptor[]>(`/cases/${id}/knowledge/sources`),

  /** What earlier cases established that touches this one. */
  caseMemory: (id: string) => request<MemoryRecall>(`/cases/${id}/knowledge/memory`),

  /** Teach cross-case memory what this case establishes. Idempotent. */
  learnFromCase: (id: string) =>
    request<{ learned: number; superseded: number; deduplicated: number; recall: MemoryRecall }>(
      `/cases/${id}/knowledge/memory`,
      { method: 'POST' },
    ),

  /**
   * Run ingestion. `allowNetwork` is off by default — reaching a public
   * register is still reaching outside the app, so it is the user's call.
   */
  ingest: (id: string, body: { sources?: string[]; files?: { fileName: string; content: string; sourceId: string }[]; allowNetwork?: boolean } = {}) =>
    request<{ report: IngestionReport; networkRequests: number; unknownFileSourceIds: string[] }>(
      `/cases/${id}/knowledge/ingest`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /**
   * The orchestration as a drawable graph.
   *
   * Derived server-side on every read rather than stored, so it can never
   * disagree with the runs it describes. A case that has not been through the
   * agents answers with the screen node alone, or with nothing — both are
   * states the canvas draws rather than errors.
   */
  caseFlow: (id: string) => request<RunGraph>(`/cases/${id}/flow`),

  /* --- Where the property is ---------------------------------------- */

  /**
   * Location, surroundings and street-level imagery.
   *
   * Always answers 200, even with no mapping provider configured — the reply
   * then carries a named gap saying so. A 404 would be indistinguishable from
   * "there is nothing nearby", which is the one thing this must never look
   * like.
   */
  siteContext: (id: string) => request<SiteContext>(`/cases/${id}/site-context`),

  /** Rebuild from the provider. The only way to retry an address that failed. */
  refreshSiteContext: (id: string) =>
    request<SiteContext>(`/cases/${id}/site-context/refresh`, { method: 'POST' }),

  /**
   * What has gone out of date on this case.
   *
   * Computed server-side on every read, never stored. A cached answer to
   * "how old is this?" is the one cache that is always wrong.
   */
  staleness: (id: string) => request<StalenessReport>(`/cases/${id}/staleness`),

  /* --- Prompt registry ---------------------------------------------- */

  /**
   * Every prompt, its versions, and which is in force.
   *
   * These four methods are named exactly as `pages/Prompts.tsx` looks for them
   * — it duck-types them off this object so it could be built before they
   * existed. Renaming one here does not break the build; it silently drops the
   * page back to an in-memory edit that reports "Saved" and is gone on reload.
   * So: if you rename one, rename it there too.
   */
  prompts: () => request<PromptDescriptor[]>('/prompts'),

  /** Save a new version. Returns the whole descriptor, because a create can move the active selection. */
  createPromptVersion: (key: string, draft: PromptDraft) =>
    request<PromptDescriptor>(`/prompts/${encodeURIComponent(key)}/versions`, {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  /**
   * Edit a custom version in place.
   *
   * Rewrites history: the content hash is recomputed, so a run already
   * recorded against this version id now points at text that is not what it
   * saw. The editor states that before offering it. The built-in is refused by
   * the server.
   */
  updatePromptVersion: (key: string, versionId: string, draft: PromptDraft) =>
    request<PromptDescriptor>(
      `/prompts/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body: JSON.stringify(draft) },
    ),

  activatePromptVersion: (key: string, versionId: string) =>
    request<PromptDescriptor>(
      `/prompts/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/activate`,
      { method: 'POST' },
    ),

  /** Delete a custom version. Deleting the one in force falls the prompt back to its built-in. */
  deletePromptVersion: (key: string, versionId: string) =>
    request<PromptDescriptor>(
      `/prompts/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'DELETE' },
    ),

  /**
   * The title graph's nodes and edges, for the chain diagram.
   *
   * Separate from the case because the screen result carries only the
   * findings; this is the structure they are findings about. Derived on read,
   * like the run graph.
   */
  caseTitleGraph: (id: string) => request<TitleGraph>(`/cases/${id}/title-graph`),

  /**
   * The STORED reasoning graph, which is not the same as the one the client
   * builds. It carries the annotations, which exist nowhere else, and `asOf`
   * answers what the case looked like at an instant — neither of which a
   * rebuild from the current case can produce.
   */
  caseGraph: (id: string, asOf?: string) =>
    request<{ graph: DdGraph | null; adapter: string; reason?: string }>(
      `/cases/${id}/graph${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`,
    ),

  annotateGraphNode: (
    id: string,
    body: { nodeId: string; text: string; author?: string; linkedNodeId?: string },
  ) =>
    request<{ node: DdNode; edges: DdEdge[] }>(`/cases/${id}/graph/annotations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* --- Conversational intake --------------------------------------- */

  /**
   * A session is a draft and a transcript, not a case.
   *
   * Every one of these returns both the session and its readout, computed
   * server-side on read. The page never derives what to ask next or whether
   * the draft is ready — one place decides that, so the chat and the API
   * cannot disagree about the same draft.
   */
  startIntake: () => request<IntakeEnvelope>('/intake', { method: 'POST' }),

  getIntake: (id: string) => request<IntakeEnvelope>(`/intake/${id}`),

  /** Send a message. Works with no model configured; the reply is then deterministic and says so. */
  intakeTurn: (id: string, message: string) =>
    request<IntakeEnvelope & { rejected: { path: string; reason: string }[] }>(`/intake/${id}/turns`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  /**
   * Answer one particular directly.
   *
   * What the option buttons use, and the only way to answer anything when no
   * model is configured. Recorded as `stated`, because pressing a labelled
   * button states a thing as plainly as typing it.
   */
  setIntakeField: (id: string, path: string, value: string | number | boolean | null, saidAs?: string) =>
    request<IntakeEnvelope>(`/intake/${id}/fields`, {
      method: 'POST',
      body: JSON.stringify({ path, value, saidAs }),
    }),

  /** Accept an inference. The only thing that turns one into an answer. */
  confirmIntakeField: (id: string, path: string) =>
    request<IntakeEnvelope>(`/intake/${id}/fields/${encodeURIComponent(path)}/confirm`, { method: 'POST' }),

  clearIntakeField: (id: string, path: string) =>
    request<IntakeEnvelope>(`/intake/${id}/fields/${encodeURIComponent(path)}`, { method: 'DELETE' }),

  uploadIntakeDocuments: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<IntakeEnvelope>(`/intake/${id}/documents`, { method: 'POST', body: form });
  },

  /**
   * Build the case.
   *
   * The only call here that creates anything, and it is always an explicit
   * press — never something a turn can trigger. Returns the screened case, so
   * the figures the conversation showed are the figures that land.
   */
  commitIntake: (id: string, body: { ownerName?: string } = {}) =>
    request<IntakeEnvelope & { case: PropertyCase; unconfirmed: IntakeSession['fields'] }>(`/intake/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  exploreCase: (id: string, body: { objective?: string; maxIterations?: number; maxCostUsd?: number }) =>
    request<PropertyCase>(`/cases/${id}/agents/explore`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  libraries: () =>
    request<{
      projectArchetypes: { key: string; label: string; examples: string }[];
      lifecycleStages: { key: string; label: string; meaning: string }[];
      scopes: ScopeDefinition[];
      ddTypes: DdTypeDefinition[];
      checks: CheckDefinition[];
    }>('/libraries'),

  listProjects: () => request<ProjectSummary[]>('/projects'),
  getProject: (id: string) => request<DdProject>(`/projects/${id}`),
  createProject: (body: CreateProjectInput & { actor?: string }) =>
    request<DdProject>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  addAsset: (projectId: string, body: CreateAssetInput & { actor?: string }) =>
    request<Asset>(`/projects/${projectId}/assets`, { method: 'POST', body: JSON.stringify(body) }),
  changeStage: (
    projectId: string,
    body: { subject: 'project' | 'asset'; assetId?: string; stage: string; reason: string; evidenceIds?: string[]; actor?: string },
  ) => request<StageRecord>(`/projects/${projectId}/stage`, { method: 'POST', body: JSON.stringify(body) }),
  createAssessment: (projectId: string, body: CreateAssessmentInput & { actor?: string }) =>
    request<DdAssessment>(`/projects/${projectId}/assessments`, { method: 'POST', body: JSON.stringify(body) }),
  setAssessmentStatus: (projectId: string, ddId: string, status: string, actor?: string) =>
    request<DdAssessment>(`/projects/${projectId}/assessments/${ddId}`, { method: 'PATCH', body: JSON.stringify({ status, actor }) }),
  assessmentChanges: (projectId: string, ddId: string) =>
    request<ChangeSincePrevious | null>(`/projects/${projectId}/assessments/${ddId}/changes`),
  recordCheck: (projectId: string, checkId: string, body: RecordCheckInput & { actor?: string }) =>
    request<{ check: CheckInstance; project: DdProject }>(`/projects/${projectId}/checks/${checkId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  addEvidence: (projectId: string, body: CreateEvidenceInput & { actor?: string }) =>
    request<EvidenceRecord>(`/projects/${projectId}/evidence`, { method: 'POST', body: JSON.stringify(body) }),
  patchEvidence: (
    projectId: string,
    evidenceId: string,
    body: { status: string; rejectionReason?: string; considered?: boolean; used?: boolean; actor?: string },
  ) => request<EvidenceRecord>(`/projects/${projectId}/evidence/${evidenceId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addFinding: (projectId: string, body: CreateFindingInput & { linkAssessmentIds?: string[]; actor?: string }) =>
    request<FindingRecord>(`/projects/${projectId}/findings`, { method: 'POST', body: JSON.stringify(body) }),
  linkFinding: (projectId: string, findingId: string, body: { assessmentIds?: string[]; assetIds?: string[]; evidenceIds?: string[] }) =>
    request<FindingRecord>(`/projects/${projectId}/findings/${findingId}/links`, { method: 'POST', body: JSON.stringify(body) }),
  patchFinding: (projectId: string, findingId: string, status: string) =>
    request<FindingRecord>(`/projects/${projectId}/findings/${findingId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  addRisk: (projectId: string, body: CreateRiskInput & { actor?: string }) =>
    request<RiskRecord>(`/projects/${projectId}/risks`, { method: 'POST', body: JSON.stringify(body) }),
  patchRisk: (projectId: string, riskId: string, status: string) =>
    request<RiskRecord>(`/projects/${projectId}/risks/${riskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  addAction: (projectId: string, body: CreateActionInput & { actor?: string }) =>
    request<ActionRecord>(`/projects/${projectId}/actions`, { method: 'POST', body: JSON.stringify(body) }),
  patchAction: (projectId: string, actionId: string, status: string) =>
    request<ActionRecord>(`/projects/${projectId}/actions/${actionId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  addDecision: (projectId: string, body: CreateDecisionInput & { actor?: string }) =>
    request<DecisionRecord>(`/projects/${projectId}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
  patchDecision: (projectId: string, decisionId: string, status: string) =>
    request<DecisionRecord>(`/projects/${projectId}/decisions/${decisionId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  generateReport: (projectId: string, body: GenerateReportInput) =>
    request<GeneratedReport>(`/projects/${projectId}/reports`, { method: 'POST', body: JSON.stringify(body) }),
  patchProject: (projectId: string, body: PatchProjectInput & { actor?: string }) =>
    request<DdProject>(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  projectDashboard: (projectId: string) => request<ProjectDashboard>(`/projects/${projectId}/dashboard`),
  projectGraph: (projectId: string) =>
    request<{ nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] }>(`/projects/${projectId}/graph`),
  runValuation: (projectId: string, actor?: string) =>
    request<ValuationRun>(`/projects/${projectId}/valuation`, { method: 'POST', body: JSON.stringify({ actor }) }),
  runProjectScreen: (projectId: string, actor?: string) =>
    request<{ snapshot: ProjectScreenSnapshot; valuationId: string; project: DdProject }>(`/projects/${projectId}/screen`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),
  patchValuation: (projectId: string, runId: string, signOff: ValuationSignOff) =>
    request<ValuationRun>(`/projects/${projectId}/valuation/${runId}`, { method: 'PATCH', body: JSON.stringify({ signOff }) }),
  snapshotCapabilities: (projectId: string) =>
    request<CapabilityRun[]>(`/projects/${projectId}/capabilities`, { method: 'POST', body: JSON.stringify({}) }),
  proposeAiDrafts: (projectId: string, actor?: string) =>
    request<{ drafts: AiDraft[]; agent: { available: boolean; reason: string } }>(`/projects/${projectId}/ai/drafts`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),
  reviewAiDraft: (projectId: string, draftId: string, status: Extract<AiDraftStatus, 'in_review' | 'accepted' | 'rejected'>, reviewNote?: string) =>
    request<AiDraft>(`/projects/${projectId}/ai/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ status, reviewNote }) }),
  commitAiDraft: (projectId: string, draftId: string) =>
    request<{ draft: AiDraft; recordId?: string }>(`/projects/${projectId}/ai/drafts/${draftId}/commit`, { method: 'POST', body: JSON.stringify({}) }),
  projectChat: (projectId: string, body: { question: string; viewContext?: string; actor?: string }) =>
    request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  projectChatFiles: (projectId: string, body: { files: File[]; question?: string; viewContext?: string; actor?: string }) => {
    const form = new FormData();
    body.files.forEach((f) => form.append('files', f));
    if (body.question) form.append('question', body.question);
    if (body.viewContext) form.append('viewContext', body.viewContext);
    if (body.actor) form.append('actor', body.actor);
    return request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat/files`, {
      method: 'POST',
      body: form,
    });
  },
  commitChatProposal: (projectId: string, proposalId: string) =>
    request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat/proposals/${proposalId}/commit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rejectChatProposal: (projectId: string, proposalId: string) =>
    request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat/proposals/${proposalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  clearProjectChat: (projectId: string) => request<void>(`/projects/${projectId}/chat`, { method: 'DELETE' }),
  orchestrateProject: (projectId: string, actor?: string) =>
    request<{ run: OrchestratorRun; drafts: AiDraft[]; project: DdProject }>(`/projects/${projectId}/orchestrate`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),
  uploadEvidenceFiles: (projectId: string, evidenceId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<EvidenceAttachment[]>(`/projects/${projectId}/evidence/${evidenceId}/files`, { method: 'POST', body: form });
  },
  evidenceFileUrl,
};

/**
 * The deployment's upload limits, fetched once and shared.
 *
 * Cached as the promise rather than the value so that several callers racing
 * on first use share one request instead of each firing their own. A failed
 * lookup is not cached: `uploadLimits()` falls back to a conservative guess
 * for that call and the next one tries again, so a blip does not leave the
 * app permanently guessing.
 */
let uploadLimitsPromise: Promise<UploadLimits> | null = null;

/**
 * Small enough to be safe on any host, including a serverless platform with a
 * request-body cap. Only used when the API cannot be reached to say otherwise
 * — in which case the upload is about to fail anyway, and rejecting a large
 * file early is the better of the two wrong answers.
 */
const FALLBACK_UPLOAD_LIMITS: UploadLimits = {
  maxFiles: 10,
  maxFileBytes: 4 * 1024 * 1024,
  maxRequestBytes: 4 * 1024 * 1024,
};

export async function uploadLimits(): Promise<UploadLimits> {
  if (!uploadLimitsPromise) {
    uploadLimitsPromise = api
      .health()
      .then((h) => h.upload ?? FALLBACK_UPLOAD_LIMITS)
      .catch(() => {
        uploadLimitsPromise = null;
        return FALLBACK_UPLOAD_LIMITS;
      });
  }
  return uploadLimitsPromise;
}

export interface AgentStreamHandlers {
  onStep?: (step: AgentStep) => void;
  onRun?: (run: AgentRun) => void;
  onDone?: (updated: PropertyCase) => void;
  onError?: (message: string) => void;
  /**
   * The connection opened but nothing came through — the stream is being
   * buffered by something in between. The run itself is still going server
   * side, so the caller should poll for the result rather than retry.
   */
  onStreamUnavailable?: () => void;
}

/**
 * Live agent-run progress over Server-Sent Events, so the UI can show what
 * each agent is doing instead of a bare spinner. Returns an unsubscribe
 * function — call it on unmount or before starting a new run.
 */
/**
 * How long to wait for the server's immediate "connected" event before deciding
 * the stream is being buffered somewhere in between.
 *
 * The server sends that event before it does any work, so its absence means the
 * connection is open but nothing is getting through — the failure mode on
 * proxies and serverless edges that buffer `text/event-stream`. It is
 * deliberately not a timeout on the *run*, which can legitimately take minutes.
 */
const STREAM_OPEN_TIMEOUT_MS = 20_000;

export function streamAgentRun(id: string, agents: AgentKind[] | undefined, handlers: AgentStreamHandlers): () => void {
  const query = agents && agents.length > 0 ? `?agents=${agents.map(encodeURIComponent).join(',')}` : '';
  const source = new EventSource(`${BASE}/cases/${id}/agents/stream${query}`);

  let sawAnyEvent = false;
  const bufferedCheck = setTimeout(() => {
    if (sawAnyEvent) return;
    // The run is already under way server-side — the GET started it — so this
    // must never retry it. Hand back to the caller to poll for the result
    // instead; starting a second orchestration would double the bill.
    handlers.onStreamUnavailable?.();
    source.close();
  }, STREAM_OPEN_TIMEOUT_MS);

  const markAlive = (): void => {
    sawAnyEvent = true;
    clearTimeout(bufferedCheck);
  };

  source.addEventListener('step', (event) => {
    markAlive();
    try {
      handlers.onStep?.(JSON.parse((event as MessageEvent<string>).data) as AgentStep);
    } catch {
      /* malformed event — drop it rather than crash the stream */
    }
  });

  source.addEventListener('run', (event) => {
    markAlive();
    try {
      handlers.onRun?.(JSON.parse((event as MessageEvent<string>).data) as AgentRun);
    } catch {
      /* ignore */
    }
  });

  source.addEventListener('done', (event) => {
    markAlive();
    try {
      handlers.onDone?.(JSON.parse((event as MessageEvent<string>).data) as PropertyCase);
    } catch {
      /* ignore */
    } finally {
      source.close();
    }
  });

  // A server-sent `event: error` and the browser's native connection-error
  // event both land in the 'error' listener; only the former carries `.data`.
  source.addEventListener('error', (event) => {
    markAlive();
    const raw = (event as MessageEvent<string>).data;
    if (raw) {
      try {
        const payload = JSON.parse(raw) as { error?: string };
        handlers.onError?.(payload.error ?? 'The agent run failed.');
      } catch {
        handlers.onError?.('The agent run failed.');
      }
    } else {
      handlers.onError?.('Lost connection to the agent run.');
    }
    source.close();
  });

  return () => {
    clearTimeout(bufferedCheck);
    source.close();
  };
}
