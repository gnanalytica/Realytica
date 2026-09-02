import { readPref, writePref } from './prefs';

/**
 * Holding the ID token, and knowing when it has run out.
 *
 * Google issues the token; this file only carries it. Which Google product
 * mints it is a deployment decision the server already knows about and reports
 * on `/api/health`, so this side stays deliberately ignorant of it — a token
 * arrives from somewhere, is attached to every request, and is dropped when
 * the server says it is no longer good.
 *
 * The token is kept in `localStorage` rather than in memory alone, because a
 * page refresh that signs you out is a page refresh nobody makes twice. It is
 * a bearer credential in a place XSS can reach, which is the accepted trade
 * for a single-page app with no server session; what limits the damage is that
 * it is short-lived — Google issues an hour — and that nothing else about the
 * account is stored beside it.
 */

const TOKEN_KEY = 'idToken';

export interface SignedIn {
  token: string;
  /** Seconds since the epoch, from the token's own `exp`. */
  expiresAt: number;
  email: string;
  name?: string;
  picture?: string;
}

let current: SignedIn | null = null;
const listeners = new Set<(next: SignedIn | null) => void>();

/**
 * Read the claims without verifying anything.
 *
 * Safe only for deciding what to draw. Every claim here is checked properly on
 * the server before it means anything, and nothing in the UI may treat this as
 * authorisation — the role comes from `/api/members`, which the server
 * answers, never from a claim the browser read out of a token it holds.
 */
function claimsOf(token: string): Record<string, unknown> | null {
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hydrate(token: string): SignedIn | null {
  const claims = claimsOf(token);
  if (!claims || typeof claims.exp !== 'number') return null;
  return {
    token,
    expiresAt: claims.exp,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
  };
}

/** A token inside a minute of expiry is treated as gone, not nearly gone. */
const EXPIRY_MARGIN_SECONDS = 60;

function live(session: SignedIn | null): SignedIn | null {
  if (!session) return null;
  return session.expiresAt - EXPIRY_MARGIN_SECONDS > Math.floor(Date.now() / 1000) ? session : null;
}

export function signedIn(): SignedIn | null {
  if (current) return live(current);
  const stored = readPref(TOKEN_KEY);
  if (!stored) return null;
  current = live(hydrate(stored));
  if (!current) writePref(TOKEN_KEY, '');
  return current;
}

export function setToken(token: string): SignedIn | null {
  const next = live(hydrate(token));
  current = next;
  writePref(TOKEN_KEY, next ? token : '');
  for (const listener of listeners) listener(next);
  return next;
}

export function signOut(): void {
  current = null;
  writePref(TOKEN_KEY, '');
  for (const listener of listeners) listener(null);
}

export function onAuthChange(listener: (next: SignedIn | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The header every request carries, or nothing when signed out. */
export function authHeader(): Record<string, string> {
  const session = signedIn();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
