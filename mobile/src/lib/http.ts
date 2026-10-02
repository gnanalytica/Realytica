/**
 * One HTTP call to the Realytica API, and what can go wrong with it.
 *
 * Plain TypeScript with no React Native imports, so the outbox engine that
 * uses it can be run against a real server from Node as well as on a phone.
 */

export type ApiErrorKind = 'http' | 'network' | 'timeout';

export class ApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status; 0 when the server was never reached. */
    readonly status: number,
    readonly kind: ApiErrorKind,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The request never got an answer: no signal, server down, or too slow. */
  get unreachable(): boolean {
    return this.kind !== 'http';
  }
}

export interface CallOptions {
  server: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as multipart/form-data; fetch sets the boundary itself. */
  form?: FormData;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** `https://host/` + `/projects` → `https://host/api/projects`. */
export function apiUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, '')}/api${path.startsWith('/') ? path : `/${path}`}`;
}

export async function call<T>(opts: CallOptions): Promise<T> {
  const { server, path, method = 'GET', token, json, form, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: string | FormData | undefined;
  if (form) body = form;
  else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(apiUrl(server, path), { method, headers, body, signal: controller.signal });
  } catch {
    clearTimeout(timer);
    if (timedOut) throw new ApiError('The server took too long to answer. Try again when the signal is better.', 0, 'timeout');
    throw new ApiError(`Could not reach ${hostOf(server)}. Check your signal.`, 0, 'network');
  }

  try {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (!res.ok) {
      // The API always answers errors as { error: string }: that sentence is meant for the person.
      const message =
        parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : describeStatus(res.status);
      throw new ApiError(message, res.status, 'http');
    }
    if (parsed === undefined && text) {
      throw new ApiError('The server sent something this app did not understand.', res.status, 'http');
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (timedOut) throw new ApiError('The server took too long to answer. Try again when the signal is better.', 0, 'timeout');
    throw new ApiError(`The connection to ${hostOf(server)} dropped. Try again.`, 0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

function describeStatus(status: number): string {
  if (status === 401) return 'This phone is no longer paired. Pair it again from the web app.';
  if (status === 403) return 'You do not have permission to do that on this project.';
  if (status === 404) return 'The server could not find that. It may have been removed.';
  if (status === 413) return 'That was too large for the server to accept.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (status >= 500) return `The server had a problem (${status}). Try again shortly.`;
  return `The server refused the request (${status}).`;
}

export function hostOf(server: string): string {
  return server.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}
