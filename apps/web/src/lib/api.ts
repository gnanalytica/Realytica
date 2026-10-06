import type {
  PortfolioView,
  ProjectRequest,
  ProjectRequestStatus,
  DurableRun,
  DurableRunState,
  AgentCapability,
  AgentStep,
  ReadingStreamEvent,
  ChatTurnPlace,
  ChoicePin,
  CopilotTurn,
  DataSourceDescriptor,
  IngestionReport,
  MemoryRecall,
  PromptDescriptor,
  PromptInvariantCheck,
  ReferenceData,
  RunGraph,
  SiteContext,
  StalenessReport,
  TitleGraph,
  TelemetrySummary,
  DdProject,
  ProjectSummary,
  Asset,
  DdAssessment,
  CheckInstance,
  EvidenceStatus,
  EvidenceRecord,
  CaptureConcern,
  CaptureFactsInput,
  CreateSiteVisitInput,
  EnvironmentalCondition,
  FindingRecord,
  PatchSiteVisitInput,
  RemedialBand,
  RicsEscalation,
  RiskRecord,
  SheetFitReading,
  SheetKind,
  SheetPlacement,
  SheetRecord,
  SiteVisitRecord,
  VisitCoverageRow,
  ActionRecord,
  DecisionRecord,
  CheckFieldReading,
  CheckFieldWrite,
  GeneratedReport,
  ReportBoundSource,
  ReportDriftRow,
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
  AddComparableInput,
  ComparablePatch,
  ComparableRecord,
  ComparableSchedule,
  ComparableSearchRecord,
  CapabilityRun,
  AiDraft,
  AiDraftStatus,
  EvidenceAttachment,
  ProjectChatResult,
  ProjectScreenSnapshot,
  OrchestratorRun,
  GisOverlayRead,
  ParcelBoundary,
  RevenueMapRead,
  WorkspaceRole,
  ProjectGrant,
  CreateProjectGrantInput,
  WorkItem,
  CredentialKind,
  CredentialRecord,
  Flow,
  FlowProblem,
  FlowRunRecord,
  FlowRunSummary,
  FlowNodeType,
} from '@realytica/shared';
import { authHeader, renewToken, signOut } from './auth';
import type { RevenueReadResult } from './revenue-run';

const BASE = '/api';

/**
 * Every call goes out with the ID token, and a 401 gets one more chance.
 *
 * Centralised here rather than at each of the two hundred call sites, so a
 * method added later is authenticated by construction. `onUnauthorised` is how
 * the app learns it has been signed out — the token expiring mid-session looks
 * exactly like never having had one, and both should land on the same screen.
 *
 * ## Why a 401 is no longer the end
 *
 * It used to be: the first 401 dropped the session and threw whoever was
 * typing at the sign-in screen, losing whatever they had not saved. But an
 * expired token is not a refused one, and the difference is worth a round
 * trip. So a 401 buys exactly one renewal and one retry; if that comes back
 * 401 as well, the server is saying no rather than "not any more", and the
 * door is the right answer.
 *
 * One retry, never a loop. A server that answers 401 to a freshly minted token
 * would otherwise be met with an infinite renewal storm, which is a far worse
 * failure than being signed out.
 */
let onUnauthorised: (() => void) | null = null;

export function setUnauthorisedHandler(fn: (() => void) | null): void {
  onUnauthorised = fn;
}

async function headersFor(init?: RequestInit): Promise<Record<string, string>> {
  const auth = await authHeader();
  // FormData sets its own multipart boundary; naming a content type here would
  // break the upload.
  return init?.body instanceof FormData ? auth : { 'Content-Type': 'application/json', ...auth };
}

function noteStatus(status: number): void {
  if (status === 401) {
    signOut();
    onUnauthorised?.();
  }
}

/**
 * `fetch` with the token attached, renewed once if the server refuses it.
 *
 * Every call in this file goes through here, streaming ones included, so the
 * retry is not something a new endpoint has to remember. The `init.body` this
 * re-sends is a string or a `FormData`, both of which are re-readable; a
 * stream body would not be, and nothing here uses one.
 *
 * `noteStatus` is deliberately *not* called on the first 401 — signing out
 * before the retry would clear the very session the retry is trying to
 * rescue, and would flash the door on screen for the length of a round trip.
 */
export async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const send = async (): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: { ...(await headersFor(init)), ...(init?.headers as Record<string, string> | undefined) },
    });

  const first = await send();
  if (first.status !== 401) {
    noteStatus(first.status);
    return first;
  }

  const renewed = await renewToken();
  if (!renewed) {
    noteStatus(401);
    return first;
  }

  const second = await send();
  noteStatus(second.status);
  return second;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${BASE}${path}`, init);
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
  const res = await fetchWithAuth(`${BASE}/cases/${id}/agents/copilot`, {
    method: 'POST',
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

/** What a chat turn reports while it runs: its steps, and any document being read. */
/** A chat turn's result, with the project as the turn left it. What the turn changed is on its reply (`changed`), and is undone from there. */
export type ProjectChatResponse = ProjectChatResult & { project: DdProject };

export interface ProjectChatListeners {
  onStep?: (step: AgentStep) => void;
  onReading?: (event: ReadingStreamEvent) => void;
  signal?: AbortSignal;
}

async function readProjectChatStream(
  res: Response,
  onStep?: (step: AgentStep) => void,
  onReading?: (event: ReadingStreamEvent) => void,
): Promise<ProjectChatResponse> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('ndjson')) {
    return (await res.json()) as ProjectChatResponse;
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ApiRequestError('The project chat response could not be read.', 502);
  const decoder = new TextDecoder();
  let buffer = '';
  let answer: ProjectChatResponse | null = null;
  let failure: string | null = null;

  const consume = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    let parsed: { type?: string; step?: AgentStep; error?: string } & Partial<ProjectChatResult & { project: DdProject }>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (parsed.type === 'step' && parsed.step) onStep?.(parsed.step);
    else if (parsed.type === 'reading') onReading?.(parsed as unknown as ReadingStreamEvent);
    else if (parsed.type === 'error') failure = parsed.error ?? 'The copilot failed.';
    else if (parsed.type === 'result' && parsed.userTurn && parsed.assistantTurn && parsed.project) {
      answer = parsed as ProjectChatResponse;
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
  if (!answer) throw new ApiRequestError('The copilot stopped before it answered. Please retry.', 502);
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
  /** Which identity provider this deployment trusts, if any. */
  auth?: { mode: 'identity_platform' | 'google' | 'oidc' | 'off' };
}

/** Who I am and who else is in this workspace, as the server sees it. */
export interface MembersResponse {
  tenant: { id: string; name: string; autoJoinDomain?: string } | null;
  me: {
    subject: string;
    email: string;
    name?: string;
    tenantId: string;
    role: WorkspaceRole;
    /** Runs the deployment, as opposed to a workspace in it. Edits the prompts. */
    operator: boolean;
  };
  members: Array<{
    email: string;
    name?: string;
    role: WorkspaceRole;
    signedIn: boolean;
    invitedBy?: string;
    createdAt: string;
    lastSeenAt?: string;
  }>;
}

/** Everything the canvas needs to draw a palette and fill an inspector. */
export interface FlowCatalogue {
  nodeTypes: FlowNodeType[];
  agents: Array<{ agent: string; tier: string; model: string }>;
  connectors: Array<{
    id: string;
    label: string;
    authority: string;
    access: string;
    whatItWouldHaveAnswered: string;
    manualRoute: string | null;
  }>;
  prompts: Array<{ key: string; label: string; versions: Array<{ id: string; label: string; builtIn: boolean; active: boolean }> }>;
  credentials: CredentialRecord[];
  credentialKinds: CredentialKind[];
}

export interface FlowSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  nodeCount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
  canRun: boolean;
  /** The most recent run, so a list can say "enabled, and failing since Tuesday". */
  lastRun?: FlowRunSummary;
}

/** A flow and what is wrong with it. The canvas needs both on every read. */
export interface FlowEnvelope {
  flow: Flow;
  problems: FlowProblem[];
  canRun: boolean;
}

/** Who is on one project, and the staff who reach it without being named. */
export interface ProjectPeopleResponse {
  people: Array<ProjectGrant & { name?: string; signedIn: boolean }>;
  staff: Array<{ email: string; name?: string; role: WorkspaceRole }>;
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

/** The file a document card would file, before it is filed. */
export function proposalFileUrl(projectId: string, proposalId: string): string {
  return `${BASE}/projects/${projectId}/chat/proposals/${proposalId}/file`;
}

export function evidenceFileUrl(
  projectId: string,
  evidenceId: string,
  fileId: string,
  opts?: { inline?: boolean },
): string {
  return `${BASE}/projects/${projectId}/evidence/${evidenceId}/files/${fileId}${opts?.inline ? '?inline=1' : ''}`;
}

export const api = {
  health: () => request<HealthResponse>('/health'),

  members: () => request<MembersResponse>('/members'),

  inviteMember: (email: string, role: WorkspaceRole) =>
    request<{ email: string; role: WorkspaceRole }>('/members', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  setMemberRole: (email: string, role: WorkspaceRole) =>
    request<{ email: string; role: WorkspaceRole }>(`/members/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (email: string) =>
    request<void>(`/members/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  myWork: () => request<{ items: WorkItem[]; asOf: string }>('/work'),
  portfolio: () => {
    // The viewer's own date, so the fortnight starts on their today.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return request<PortfolioView>(`/portfolio?today=${today}`);
  },
  createRequest: (
    projectId: string,
    body: { title: string; detail?: string; recipient: string; recipientRole?: string; dueAt?: string; evidenceId?: string; send?: boolean },
  ) => request<ProjectRequest>(`/projects/${projectId}/requests`, { method: 'POST', body: JSON.stringify(body) }),
  patchRequest: (
    projectId: string,
    requestId: string,
    body: { title?: string; detail?: string; recipient?: string; recipientRole?: string; dueAt?: string | null; status?: ProjectRequestStatus; answeredByEvidenceId?: string },
  ) => request<ProjectRequest>(`/projects/${projectId}/requests/${requestId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  flowCatalogue: () => request<FlowCatalogue>('/flows/catalogue'),

  listFlows: () => request<FlowSummary[]>('/flows'),

  getFlow: (id: string) => request<FlowEnvelope>(`/flows/${id}`),

  createFlow: (name: string) =>
    request<FlowEnvelope>('/flows', { method: 'POST', body: JSON.stringify({ name }) }),

  saveFlow: (id: string, flow: Pick<Flow, 'name' | 'description' | 'nodes' | 'edges' | 'enabled'>) =>
    request<FlowEnvelope>(`/flows/${id}`, { method: 'PUT', body: JSON.stringify(flow) }),

  deleteFlow: (id: string) => request<void>(`/flows/${id}`, { method: 'DELETE' }),

  runFlow: (id: string, body: { projectId: string; dryRun?: boolean; input?: Record<string, unknown> }) =>
    request<FlowRunRecord>(`/flows/${id}/run`, { method: 'POST', body: JSON.stringify(body) }),

  flowRuns: (id: string) => request<FlowRunSummary[]>(`/flows/${id}/runs`),

  flowRun: (runId: string) => request<FlowRunRecord>(`/flows/runs/${runId}`),

  saveCredential: (body: { label: string; kind: CredentialKind; secret: string; username?: string; target?: string }) =>
    request<CredentialRecord>('/flows/credentials', { method: 'POST', body: JSON.stringify(body) }),

  deleteCredential: (id: string) => request<void>(`/flows/credentials/${id}`, { method: 'DELETE' }),

  testCredential: (id: string, url?: string) =>
    request<{ outcome: 'ok' | 'refused' | 'unreachable'; detail: string; status?: number }>(
      `/flows/credentials/${id}/test`,
      { method: 'POST', body: JSON.stringify({ url }) },
    ),

  assign: (projectId: string, targetId: string, owner: string) =>
    request<{ assigned: { id: string; owner: string; title: string }; project: DdProject }>(
      `/projects/${projectId}/assign`,
      { method: 'PUT', body: JSON.stringify({ targetId, owner }) },
    ),

  projectPeople: (projectId: string) => request<ProjectPeopleResponse>(`/projects/${projectId}/people`),

  addProjectPerson: (projectId: string, body: CreateProjectGrantInput) =>
    request<ProjectGrant>(`/projects/${projectId}/people`, { method: 'POST', body: JSON.stringify(body) }),

  setProjectPersonReach: (projectId: string, grantId: string, body: Partial<CreateProjectGrantInput>) =>
    request<ProjectGrant>(`/projects/${projectId}/people/${grantId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  removeProjectPerson: (projectId: string, grantId: string) =>
    request<void>(`/projects/${projectId}/people/${grantId}`, { method: 'DELETE' }),

  setAutoJoinDomain: (autoJoinDomain: string | null) =>
    request<{ id: string; name: string; autoJoinDomain?: string }>('/members', {
      method: 'PATCH',
      body: JSON.stringify({ autoJoinDomain }),
    }),

  reference: () => request<ReferenceData>('/reference'),

  agentCapability: () => request<AgentCapability>('/agents/capability'),

  /** Cross-provider cost, latency and degradation, for the model-operations view. */
  telemetry: (params: { sinceMinutes?: number; caseId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.sinceMinutes) q.set('sinceMinutes', String(params.sinceMinutes));
    if (params.caseId) q.set('caseId', params.caseId);
    const suffix = q.toString() ? `?${q}` : '';
    return request<TelemetrySummary>(`/telemetry${suffix}`);
  },
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
  /**
   * Where a PROJECT sits, and what is around it.
   *
   * The route has existed since the mapping provider was written and nothing
   * in the web app has ever called it — so Street View, the static map and the
   * nearby list were served by an API nobody asked.
   */
  projectSiteContext: (projectId: string) => request<SiteContext>(`/projects/${projectId}/site-context`),
  refreshProjectSiteContext: (projectId: string) =>
    request<SiteContext>(`/projects/${projectId}/site-context/refresh`, { method: 'POST' }),

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
  /* `null` clears; an omitted key leaves that classification alone. */
  classifyFinding: (
    projectId: string,
    findingId: string,
    body: { escalation?: RicsEscalation | null; environmentalCondition?: EnvironmentalCondition | null; actor?: string },
  ) => request<FindingRecord>(`/projects/${projectId}/findings/${findingId}/classification`, { method: 'PATCH', body: JSON.stringify(body) }),
  /* --- Site visits, capture and sheets ------------------------------ */
  listVisits: (projectId: string) =>
    request<{ visits: SiteVisitRecord[]; coverage: VisitCoverageRow[]; concerns: CaptureConcern[] }>(`/projects/${projectId}/visits`),
  addVisit: (projectId: string, body: CreateSiteVisitInput & { actor?: string }) =>
    request<SiteVisitRecord>(`/projects/${projectId}/visits`, { method: 'POST', body: JSON.stringify(body) }),
  patchVisit: (projectId: string, visitId: string, body: PatchSiteVisitInput & { actor?: string }) =>
    request<SiteVisitRecord>(`/projects/${projectId}/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  /** `null` clears a fact; an omitted key leaves it alone. */
  setCapture: (projectId: string, evidenceId: string, fileId: string, body: CaptureFactsInput & { actor?: string }) =>
    request<EvidenceAttachment>(`/projects/${projectId}/evidence/${evidenceId}/files/${fileId}/capture`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  /** Omit fileId to read every photograph no model has looked at yet. */
  readPhotographs: (projectId: string, body: { evidenceId?: string; fileId?: string; limit?: number } = {}) =>
    request<{ read: number; drafts: number; documents: number; note?: string; results?: Array<{ fileName: string; subject: string; notes: number; error?: string }> }>(
      `/projects/${projectId}/photographs/read`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listSheets: (projectId: string) => request<{ sheets: SheetPlacement[] }>(`/projects/${projectId}/sheets`),
  addSheet: (
    projectId: string,
    body: { title: string; kind: SheetKind; evidenceId: string; attachmentId?: string; asOf?: string; issuer?: string; notes?: string; actor?: string },
  ) => request<SheetRecord>(`/projects/${projectId}/sheets`, { method: 'POST', body: JSON.stringify(body) }),
  setControlPoints: (
    projectId: string,
    sheetId: string,
    points: Array<{ u: number; v: number; lat: number; lng: number; label?: string }>,
  ) =>
    request<{ sheet: SheetRecord; reading: SheetFitReading }>(`/projects/${projectId}/sheets/${sheetId}/control-points`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    }),
  removeSheet: (projectId: string, sheetId: string) =>
    request<void>(`/projects/${projectId}/sheets/${sheetId}`, { method: 'DELETE' }),

  addRisk: (projectId: string, body: CreateRiskInput & { actor?: string }) =>
    request<RiskRecord>(`/projects/${projectId}/risks`, { method: 'POST', body: JSON.stringify(body) }),
  patchRisk: (projectId: string, riskId: string, status: string) =>
    request<RiskRecord>(`/projects/${projectId}/risks/${riskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  addAction: (projectId: string, body: CreateActionInput & { actor?: string }) =>
    request<ActionRecord>(`/projects/${projectId}/actions`, { method: 'POST', body: JSON.stringify(body) }),
  patchAction: (projectId: string, actionId: string, status: string) =>
    request<ActionRecord>(`/projects/${projectId}/actions/${actionId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setActionCost: (
    projectId: string,
    actionId: string,
    body: { costEstimate?: number | null; costBand?: RemedialBand | null; actor?: string },
  ) => request<ActionRecord>(`/projects/${projectId}/actions/${actionId}/cost`, { method: 'PATCH', body: JSON.stringify(body) }),
  addDecision: (projectId: string, body: CreateDecisionInput & { actor?: string }) =>
    request<DecisionRecord>(`/projects/${projectId}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
  patchDecision: (projectId: string, decisionId: string, status: string) =>
    request<DecisionRecord>(`/projects/${projectId}/decisions/${decisionId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  generateReport: (projectId: string, body: GenerateReportInput) =>
    request<GeneratedReport>(`/projects/${projectId}/reports`, { method: 'POST', body: JSON.stringify(body) }),
  /* --- Editing a report -------------------------------------------- */
  insertReportBlock: (
    projectId: string,
    reportId: string,
    body: { heading?: string; text?: string; source?: ReportBoundSource; afterBlockId?: string; actor?: string },
  ) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks`, { method: 'POST', body: JSON.stringify(body) }),
  editReportBlock: (projectId: string, reportId: string, blockId: string, body: { heading?: string; text?: string; actor?: string }) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  retuneReportBlock: (projectId: string, reportId: string, blockId: string, source: ReportBoundSource, actor?: string) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}/source`, {
      method: 'PUT',
      body: JSON.stringify({ source, actor }),
    }),
  detachReportBlock: (projectId: string, reportId: string, blockId: string, actor?: string) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}/detach`, { method: 'POST', body: JSON.stringify({ actor }) }),
  reattachReportBlock: (projectId: string, reportId: string, blockId: string, actor?: string) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}/reattach`, { method: 'POST', body: JSON.stringify({ actor }) }),
  moveReportBlock: (projectId: string, reportId: string, blockId: string, toIndex: number, actor?: string) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}/move`, {
      method: 'POST',
      body: JSON.stringify({ toIndex, actor }),
    }),
  removeReportBlock: (projectId: string, reportId: string, blockId: string) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}`, { method: 'DELETE' }),
  issueReport: (projectId: string, reportId: string, signOff?: { signerName?: string; signerRole?: string }) =>
    request<GeneratedReport>(`/projects/${projectId}/reports/${reportId}/issue`, { method: 'POST', body: JSON.stringify(signOff ?? {}) }),
  setReportSectionState: (projectId: string, reportId: string, blockId: string, state: 'drafted' | 'checked' | 'approved') =>
    request<unknown>(`/projects/${projectId}/reports/${reportId}/blocks/${blockId}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
  reportDrift: (projectId: string, reportId: string) =>
    request<{ reportId: string; status: string; rows: ReportDriftRow[] }>(`/projects/${projectId}/reports/${reportId}/drift`),

  checkFields: (projectId: string, checkId: string) =>
    request<CheckFieldReading & { checkId: string; title: string }>(`/projects/${projectId}/checks/${checkId}/fields`),
  recordCheckFields: (
    projectId: string,
    checkId: string,
    values: Record<string, CheckFieldWrite>,
    sourceEvidenceId?: string,
  ) =>
    request<CheckFieldReading & { checkId: string; project: DdProject }>(`/projects/${projectId}/checks/${checkId}/fields`, {
      method: 'PUT',
      body: JSON.stringify({ values, sourceEvidenceId }),
    }),

  patchProject: (projectId: string, body: PatchProjectInput & { actor?: string }) =>
    request<DdProject>(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  projectDashboard: (projectId: string) => request<ProjectDashboard>(`/projects/${projectId}/dashboard`),
  projectGraph: (projectId: string) =>
    request<{ nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[]; adapter?: string }>(`/projects/${projectId}/graph`),
  /**
   * The STORED graph, which is not the same as the projection above.
   *
   * It carries the annotations — held nowhere else — and `asOf` answers what
   * the file looked like at an instant, neither of which a rebuild from the
   * current registers can produce.
   */
  storedProjectGraph: (projectId: string, asOf?: string) =>
    request<{
      graph: { projectId: string; builtAt: string; nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] } | null;
      adapter: string;
      reason?: string;
      asOf: string | null;
    }>(`/projects/${projectId}/graph/stored${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`),
  annotateProjectGraphNode: (
    projectId: string,
    body: { nodeId: string; text: string; linkedNodeId?: string },
  ) =>
    request<{ node: ProjectGraphNode; edges: ProjectGraphEdge[] }>(`/projects/${projectId}/graph/annotations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  gisOverlay: (projectId: string, opts?: { force?: boolean }) =>
    request<GisOverlayRead>(`/projects/${projectId}/gis-overlay${opts?.force ? '?force=1' : ''}`),
  setSurveyBoundary: (projectId: string, body: { fileText: string; note?: string }) =>
    request<{ boundary: ParcelBoundary; notEvidence: true; note: string }>(`/projects/${projectId}/gis-overlay/survey`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  clearSurveyBoundary: (projectId: string) =>
    request<void>(`/projects/${projectId}/gis-overlay/survey`, { method: 'DELETE' }),
  revenueLevels: (projectId: string, q: { state: 'TS' | 'KA'; district?: string; mandal?: string }) => {
    const params = new URLSearchParams({ state: q.state });
    if (q.district) params.set('district', q.district);
    if (q.mandal) params.set('mandal', q.mandal);
    return request<{ items: string[]; snapshotOn?: string; labels: { district: string; mandal: string; village: string } }>(
      `/projects/${projectId}/gis-overlay/revenue/levels?${params.toString()}`,
    );
  },
  /** Where the revenue-map picker starts: the last read, or the village the site address names. */
  revenueSuggest: (projectId: string) =>
    request<{
      state?: 'TS' | 'KA';
      district?: string;
      mandal?: string;
      village?: string;
      surveyNo?: string;
      from: 'last read' | 'address' | null;
      note?: string;
    }>(`/projects/${projectId}/gis-overlay/revenue/suggest`),
  /**
   * Read one survey number off the state's map. A number the map does not
   * hold, and a read that failed, are answers here and not throws: a run of
   * several shows each number's own outcome and goes on to the next.
   * `unlessKept` answers from the parcel already kept when the number turns
   * out to be one; `several` says the request is one of a run of them. A
   * parcel that is kept is read again by its own reference, not by a place.
   */
  readRevenueMap: async (
    projectId: string,
    body:
      | { state: 'TS' | 'KA'; district: string; mandal: string; village: string; surveyNo: string; asWritten?: string[]; unlessKept?: boolean; several?: boolean }
      | { parcelRef: string; several?: boolean },
  ): Promise<RevenueReadResult> => {
    const res = await fetchWithAuth(`${BASE}/projects/${projectId}/gis-overlay/revenue`, { method: 'POST', body: JSON.stringify(body) });
    const answer = (await res.json().catch(() => ({}))) as {
      read?: RevenueMapRead;
      boundary?: ParcelBoundary | null;
      note?: string;
      already?: boolean;
      error?: string;
      near?: string[];
      alsoAsked?: string[];
      full?: boolean;
    };
    if (res.ok && answer.read) {
      return { ok: true, read: answer.read, boundary: answer.boundary ?? null, note: answer.note ?? '', ...(answer.already ? { already: true } : {}) };
    }
    // A server that has had too many requests for the minute says how long to leave it alone.
    const retryAfterS = Number(res.headers.get('Retry-After'));
    return {
      ok: false,
      status: res.status,
      error: answer.error ?? `${res.status} ${res.statusText}`,
      ...(answer.near ? { near: answer.near } : {}),
      ...(answer.alsoAsked?.length ? { alsoAsked: answer.alsoAsked } : {}),
      ...(answer.full ? { full: true } : {}),
      ...(Number.isFinite(retryAfterS) && retryAfterS > 0 ? { retryAfterS } : {}),
    };
  },
  fileRevenueMap: (projectId: string) =>
    request<{ evidence: EvidenceRecord; project: DdProject }>(`/projects/${projectId}/gis-overlay/revenue/file`, { method: 'POST' }),
  /**
   * Take one parcel's read off the project; the others stay. A parcel has to
   * be named: with none, the address would be the one that clears every read.
   */
  removeRevenueRead: (projectId: string, parcelRef: string) =>
    parcelRef
      ? request<void>(`/projects/${projectId}/gis-overlay/revenue/${encodeURIComponent(parcelRef)}`, { method: 'DELETE' })
      : Promise.reject(new ApiRequestError('No parcel was named to remove.', 400)),
  clearRevenueMap: (projectId: string) =>
    request<void>(`/projects/${projectId}/gis-overlay/revenue`, { method: 'DELETE' }),
  projectGraphNeighbourhood: (projectId: string, query: string, hops = 2) =>
    request<{
      query: string;
      hops: number;
      seeds: { id: string; kind: string; label: string }[];
      nodes: ProjectGraphNode[];
      edges: ProjectGraphEdge[];
      source: string;
      adapter: string;
      standing: string;
      error?: string;
    }>(`/projects/${projectId}/graph/neighbourhood?query=${encodeURIComponent(query)}&hops=${hops}`),
  lookupReferences: (query: string) =>
    request<{ standing: string; query: string; hits: { id: string; title: string; url: string; notEvidence: true }[]; text: string }>(
      `/libraries/references?q=${encodeURIComponent(query)}`,
    ),
  runValuation: (projectId: string, actor?: string) =>
    request<ValuationRun>(`/projects/${projectId}/valuation`, { method: 'POST', body: JSON.stringify({ actor }) }),
  runProjectScreen: (projectId: string, actor?: string) =>
    request<{ snapshot: ProjectScreenSnapshot; reportId?: string; project: DdProject }>(`/projects/${projectId}/screen`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),
  /** Check the property, and start its valuation DD if it has none. The inputs are offered on read. */
  valueProperty: (projectId: string) =>
    request<{ project: DdProject; verdict: string; comparableSearch: 'due' | 'fresh' | 'not_configured'; startedAssessmentId?: string }>(`/projects/${projectId}/value`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  acceptValueOffers: (projectId: string, ids: string[], record?: boolean) =>
    request<{ project: DdProject; applied: string[]; refused: { id: string; error: string }[]; runId?: string }>(`/projects/${projectId}/value/accept`, {
      method: 'POST',
      body: JSON.stringify({ ids, record }),
    }),
  comparables: (projectId: string) =>
    request<{ configured: boolean; comparables: ComparableRecord[]; search: ComparableSearchRecord | null; schedule: ComparableSchedule | null }>(`/projects/${projectId}/comparables`),
  searchComparables: (projectId: string) =>
    request<{ project: DdProject; found: number; added: string[]; empty?: string }>(`/projects/${projectId}/comparables/search`, { method: 'POST', body: JSON.stringify({}) }),
  addComparable: (projectId: string, input: AddComparableInput) =>
    request<{ project: DdProject; comparable: ComparableRecord }>(`/projects/${projectId}/comparables`, { method: 'POST', body: JSON.stringify(input) }),
  updateComparable: (projectId: string, comparableId: string, patch: ComparablePatch) =>
    request<{ project: DdProject }>(`/projects/${projectId}/comparables/${comparableId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  decideComparables: (projectId: string, ids: string[], decision: 'accept' | 'reject') =>
    request<{ project: DdProject; changed: number }>(`/projects/${projectId}/comparables/decide`, { method: 'POST', body: JSON.stringify({ ids, decision }) }),
  setAsideValueOffers: (projectId: string, ids: string[]) =>
    request<{ project: DdProject; setAside: number }>(`/projects/${projectId}/value/set-aside`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
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
  projectChat: (
    projectId: string,
    body: {
      question: string;
      viewContext?: string;
      /** The page the question is asked from, and the stage it is looked at in. */
      place?: ChatTurnPlace;
      actor?: string;
      /** The sitting these turns belong to, so history can be cut into chats. */
      sessionId?: string;
      /** The earlier chat this sitting carries on. */
      continues?: string;
      /** When this sitting began: what the server wrote since then is in this chat too. */
      sessionStartedAt?: string;
      sitting?: ChoicePin;
    },
    opts?: ProjectChatListeners,
  ) =>
    fetchWithAuth(`${BASE}/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: opts?.signal,
    }).then(async (res) => {
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) message = err.error;
        } catch {
          /* non-JSON */
        }
        throw new ApiRequestError(message, res.status);
      }
      return readProjectChatStream(res, opts?.onStep, opts?.onReading);
    }),
  /** Whether a voice note can be put into words here, where its sound is sent, and how large one request may be. */
  chatVoice: (projectId: string) => request<{ available: boolean; model?: string; host?: string; maxBytes: number; maxRequestBytes: number }>(`/projects/${projectId}/chat/voice`),

  projectChatFiles: (
    projectId: string,
    body: {
      files: File[];
      /** What this page knows of each file and its bytes may not say, in the order of the files. */
      captured?: Array<{ day?: string; takenAt?: string; seconds?: number }>;
      question?: string;
      viewContext?: string;
      place?: ChatTurnPlace;
      actor?: string;
      sessionId?: string;
      continues?: string;
      sessionStartedAt?: string;
      sitting?: ChoicePin;
    },
    opts?: ProjectChatListeners,
  ) => {
    const form = new FormData();
    body.files.forEach((f) => form.append('files', f));
    if (body.captured) form.append('captured', JSON.stringify(body.captured));
    if (body.question) form.append('question', body.question);
    if (body.viewContext) form.append('viewContext', body.viewContext);
    // A form carries words, so the place goes as one field of them.
    if (body.place) form.append('place', JSON.stringify(body.place));
    if (body.actor) form.append('actor', body.actor);
    if (body.sessionId) form.append('sessionId', body.sessionId);
    if (body.continues) form.append('continues', body.continues);
    if (body.sessionStartedAt) form.append('sessionStartedAt', body.sessionStartedAt);
    if (body.sitting?.ddId) form.append('ddId', body.sitting.ddId);
    if (body.sitting?.scopeId) form.append('scopeId', body.sitting.scopeId);
    if (body.sitting?.checkId) form.append('checkId', body.sitting.checkId);
    return fetchWithAuth(`${BASE}/projects/${projectId}/chat/files`, {
      method: 'POST',
      body: form,
      signal: opts?.signal,
    }).then(async (res) => {
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) message = err.error;
        } catch {
          /* non-JSON */
        }
        throw new ApiRequestError(message, res.status);
      }
      return readProjectChatStream(res, opts?.onStep, opts?.onReading);
    });
  },
  /** `payload` is the card as the person confirmed it in the wizard. */
  commitChatProposal: (projectId: string, proposalId: string, payload?: Record<string, unknown>) =>
    request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat/proposals/${proposalId}/commit`, {
      method: 'POST',
      body: JSON.stringify(payload ? { payload } : {}),
    }),
  rejectChatProposal: (projectId: string, proposalId: string) =>
    request<ProjectChatResult & { project: DdProject }>(`/projects/${projectId}/chat/proposals/${proposalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  clearProjectChat: (projectId: string) => request<void>(`/projects/${projectId}/chat`, { method: 'DELETE' }),
  /** Name a chat. An empty name hands it back to its first question. */
  renameChat: (projectId: string, sessionId: string, name: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  /*
   * Deciding on the canvas. Each names what it decides by id, writes no chat
   * turn, and answers with the project as it now stands.
   */
  /** Accept, set aside, correct or reopen values a document was read as stating. */
  reviewFacts: (
    projectId: string,
    evidenceId: string,
    body: {
      keys: string[] | 'all';
      decision: 'accept' | 'reject' | 'reopen';
      edit?: { value: string | number | boolean; display: string };
      /** Keep the other reader's value for the one key named. */
      take?: 'other';
    },
  ) =>
    request<{ project: DdProject; changed: number }>(`/projects/${projectId}/evidence/${evidenceId}/facts/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Confirm what a model took a filed document for, so it becomes the row's type. */
  confirmDocumentType: (projectId: string, evidenceId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/document-type/confirm`, { method: 'POST' }),
  /** Refuse what a model took a filed document for. The offer goes, and is not made again for that document. */
  setAsideDocumentType: (projectId: string, evidenceId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/document-type/set-aside`, { method: 'POST' }),
  /** Say what a filed document is, in place of what a model took it for. */
  correctDocumentType: (projectId: string, evidenceId: string, documentType: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/evidence/${evidenceId}/document-type/correct`, { method: 'POST', body: JSON.stringify({ documentType }) }),
  /** Accept or set aside values waiting on a check, a field at a time. */
  decideCheckFields: (projectId: string, proposalId: string, body: { keys: string[]; decision: 'accept' | 'reject'; values?: Record<string, unknown> }) =>
    request<{ project: DdProject }>(`/projects/${projectId}/proposals/${proposalId}/fields`, { method: 'POST', body: JSON.stringify(body) }),
  /** Carry one of the values the documents disagree on — or, with null, keep what the check holds. */
  pickCheckValue: (projectId: string, checkId: string, key: string, proposalId: string | null) =>
    request<{ project: DdProject }>(`/projects/${projectId}/checks/${checkId}/fields/${encodeURIComponent(key)}/pick`, {
      method: 'POST',
      body: JSON.stringify({ proposalId }),
    }),
  /** Accept something waiting, as proposed or as the person corrected it in the form. */
  acceptWaiting: (projectId: string, proposalId: string, payload?: Record<string, unknown>) =>
    request<{ project: DdProject; recordId?: string; offered: number }>(`/projects/${projectId}/proposals/${proposalId}/accept`, {
      method: 'POST',
      body: JSON.stringify(payload ? { payload } : {}),
    }),
  setAsideWaiting: (projectId: string, proposalId: string) =>
    request<{ project: DdProject }>(`/projects/${projectId}/proposals/${proposalId}/set-aside`, { method: 'POST', body: JSON.stringify({}) }),
  orchestrateProject: (projectId: string, actor?: string) =>
    request<{ run: OrchestratorRun; drafts: AiDraft[]; project: DdProject }>(`/projects/${projectId}/orchestrate`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    }),
  /** One status onto many rows, in one request and one line in the thread. */
  setEvidenceStatusBulk: (projectId: string, ids: string[], status: EvidenceStatus) =>
    request<{ updated: number; project: DdProject }>(`/projects/${projectId}/evidence/status`, {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),
  uploadEvidenceFiles: (projectId: string, evidenceId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<EvidenceAttachment[]>(`/projects/${projectId}/evidence/${evidenceId}/files`, { method: 'POST', body: form });
  },
  /**
   * A whole pack in one request, with its own row per file.
   *
   * One call rather than one per row, so filing a folder is a single event in
   * the thread instead of thirty, and a bad mapping fails before anything is
   * stored rather than halfway through.
   */
  fileEvidenceBatch: (projectId: string, entries: Array<{ file: File; evidenceId: string }>) => {
    const form = new FormData();
    entries.forEach((e) => form.append('files', e.file));
    form.append('targets', JSON.stringify(entries.map((e) => e.evidenceId)));
    return request<EvidenceAttachment[]>(`/projects/${projectId}/evidence/files`, { method: 'POST', body: form });
  },
  /**
   * The durable run ledger: what ran, and whether it finished. `state` is
   * derived server-side — an `interrupted` row is a run whose process died
   * mid-flight, which used to vanish without a trace.
   */
  projectRuns: (projectId: string) =>
    request<{ runs: Array<DurableRun & { state: DurableRunState; line: string }> }>(`/projects/${projectId}/runs`),

  /** One run, for polling something started in the background. */
  projectRun: (projectId: string, runId: string) =>
    request<DurableRun & { state: DurableRunState; line: string }>(`/projects/${projectId}/runs/${runId}`),

  /**
   * Start a long operation in the background and get a run id back at once.
   *
   * `keptAlive` says whether the platform accepted responsibility for work
   * that outlives the response. False on a serverless host without that hook
   * means the run may be frozen mid-flight — in which case polling reports
   * `interrupted` rather than hanging, which is why the caller is told.
   */
  startBackgroundRun: (projectId: string, kind: 'screen' | 'orchestrate', actor?: string) =>
    request<{ runId: string; keptAlive: boolean; pollUrl: string }>(
      `/projects/${projectId}/${kind}?background=1`,
      { method: 'POST', body: JSON.stringify({ actor }) },
    ),

  evidenceFileUrl,
};
