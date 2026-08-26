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
  DocumentKind,
  PropertyCase,
  ReferenceData,
  RiskStatus,
  ScreenResult,
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

export const api = {
  health: () => request<{ status: string; version: string; cases: number }>('/health'),

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

  exploreCase: (id: string, body: { objective?: string; maxIterations?: number; maxCostUsd?: number }) =>
    request<PropertyCase>(`/cases/${id}/agents/explore`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

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
