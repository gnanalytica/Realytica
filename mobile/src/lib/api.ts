/**
 * The site app's calls to the Realytica API, signed with the device token.
 *
 * Every call reads the current pairing at the moment it is made. A 401 from
 * any of them means the server no longer accepts this phone, and ends the
 * pairing (see session.ts). Other errors are thrown as ApiError carrying the
 * server's own sentence, which is meant to be shown to the person as-is.
 */
import { apiUrl, ApiError, call, type CallOptions } from './http';
import { currentPairing, handleUnauthorized } from './session';
import type { HealthResponse, MeResponse, ProjectSummary, PublicDevice, SiteAlert, SiteView } from './types';

const READ_TIMEOUT_MS = 12_000;

async function authed<T>(opts: Omit<CallOptions, 'server' | 'token'>): Promise<T> {
  const pairing = currentPairing();
  if (!pairing) throw new ApiError('This phone is not paired.', 401, 'http');
  try {
    return await call<T>({ ...opts, server: pairing.server, token: pairing.token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) handleUnauthorized(pairing.token);
    throw err;
  }
}

const id = encodeURIComponent;

export const api = {
  me: () => authed<MeResponse>({ path: '/devices/me', timeoutMs: READ_TIMEOUT_MS }),

  setPushToken: (token: string | null) =>
    authed<{ device: PublicDevice }>({ path: '/devices/push-token', method: 'POST', json: { token } }),

  projects: () => authed<ProjectSummary[]>({ path: '/projects', timeoutMs: READ_TIMEOUT_MS }),

  site: (projectId: string) => authed<SiteView>({ path: `/projects/${id(projectId)}/site`, timeoutMs: READ_TIMEOUT_MS }),

  markAlertsRead: (projectId: string, ids: string[] | 'all') =>
    authed<{ read: number; alerts: SiteAlert[] }>({ path: `/projects/${id(projectId)}/alerts/read`, method: 'POST', json: { ids } }),

  health: (server: string) => call<HealthResponse>({ server, path: '/health', timeoutMs: 8_000 }),
};

/**
 * Where one photograph of a filed entry can be fetched, and the header it needs.
 * The bytes are behind the device token, so the image component sends it.
 */
export function photoSource(projectId: string, entryId: string, index: number): { uri: string; headers: Record<string, string> } | null {
  const pairing = currentPairing();
  if (!pairing) return null;
  return {
    uri: apiUrl(pairing.server, `/projects/${id(projectId)}/site-log/${id(entryId)}/photos/${index}`),
    headers: { Authorization: `Bearer ${pairing.token}` },
  };
}
