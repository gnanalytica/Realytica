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
  PersonaKey,
  ReferenceData,
  RiskStatus,
  RunGraph,
  TitleGraph,
  ScreenResult,
  TelemetrySummary,
  UpdateCaseRequest,
} from '@valytica/shared';

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
  cases: number;
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

  uploadDocuments: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<CaseDocument[]>(`/cases/${id}/documents`, { method: 'POST', body: form });
  },

  updateDocument: (id: string, docId: string, body: { kind?: DocumentKind; notes?: string }) =>
    request<CaseDocument>(`/cases/${id}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteDocument: (id: string, docId: string) =>
    request<void>(`/cases/${id}/documents/${docId}`, { method: 'DELETE' }),

  runScreen: (id: string) => request<ScreenResult>(`/cases/${id}/screen`, { method: 'POST' }),

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

  askCopilot: (id: string, question: string) =>
    request<{ userTurn: CopilotTurn; assistantTurn: CopilotTurn }>(`/cases/${id}/agents/copilot`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

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
  commitIntake: (id: string, body: { ownerName?: string; persona?: PersonaKey } = {}) =>
    request<IntakeEnvelope & { case: PropertyCase; unconfirmed: IntakeSession['fields'] }>(`/intake/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  exploreCase: (id: string, body: { objective?: string; maxIterations?: number; maxCostUsd?: number }) =>
    request<PropertyCase>(`/cases/${id}/agents/explore`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
