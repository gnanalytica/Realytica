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
 *
 * ## Renewal
 *
 * Short-lived is the security property and it used to be the whole user
 * experience too: at the hour mark the next request came back 401 and the app
 * threw you at the door, whatever you were in the middle of. That is a bad
 * trade to have made on the user's behalf, because the token can be renewed
 * without them doing anything.
 *
 * So this file now knows how to ask for a new one. It does not know *who* to
 * ask — the provider is injected with `setTokenRefresher`, keeping this file
 * as ignorant of Google as it has always been. Renewal is attempted before
 * expiry rather than after, because a 401 that has already happened has
 * already cost a failed request; the reactive path exists as well, for the
 * clock skew and the sleeping laptop that make the proactive one miss.
 *
 * A renewal that fails is not an error. It means the person really does need
 * to sign in again, which is the behaviour this replaces — so the fallback is
 * exactly what used to happen every hour.
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

/**
 * How early to start renewing.
 *
 * Comfortably more than `EXPIRY_MARGIN_SECONDS` so a renewal has room to fail
 * and be retried while the token in hand is still good — five minutes is long
 * enough for a couple of attempts over a bad connection, and short enough that
 * the token spends almost all of its life being the one Google issued.
 */
const RENEW_MARGIN_SECONDS = 300;

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
  if (next) standingDown = false;
  writePref(TOKEN_KEY, next ? token : '');
  armRenewal(next);
  for (const listener of listeners) listener(next);
  return next;
}

export function signOut(): void {
  current = null;
  standingDown = true;
  writePref(TOKEN_KEY, '');
  armRenewal(null);
  for (const listener of listeners) listener(null);
}

/* ==================================================================== */
/* Renewal                                                               */
/* ==================================================================== */

/**
 * How to get a new token, supplied by whoever knows the provider.
 *
 * Resolving `null` means "cannot, without asking them" and is an ordinary
 * answer rather than a failure — see the note at the top of this file.
 */
export type TokenRefresher = () => Promise<string | null>;

let refresher: TokenRefresher | null = null;
let renewalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Set by `signOut`, cleared by a successful `setToken`.
 *
 * Without it, renewal quietly undoes signing out. `signOut` runs when the
 * server has refused a token that was just renewed — and the very next request
 * would then call the provider, get a token back (Google is perfectly happy to
 * issue one; it is *this deployment* that refused it), and put the user back
 * in a session the server will refuse again. That is a loop, and it presents
 * as an app that cannot be signed out of.
 *
 * So a sign-out is a decision, and it stands until somebody signs in.
 */
let standingDown = false;

export function setTokenRefresher(fn: TokenRefresher | null): void {
  refresher = fn;
  armRenewal(current);
}

/**
 * Schedule the next attempt, or cancel a scheduled one.
 *
 * Called on every token change, so the timer always reflects the token
 * actually in hand rather than one that has since been replaced.
 */
function armRenewal(session: SignedIn | null): void {
  if (renewalTimer) {
    clearTimeout(renewalTimer);
    renewalTimer = null;
  }
  if (!session || !refresher) return;

  const secondsUntil = session.expiresAt - RENEW_MARGIN_SECONDS - Math.floor(Date.now() / 1000);
  // A token already inside the renewal window gets a short delay rather than
  // an immediate call, so arming during a render cannot start a fetch storm.
  const delayMs = Math.max(1_000, secondsUntil * 1000);
  // setTimeout clamps above ~24.8 days; nothing issues a token that long, but
  // an absurd `exp` should not wrap round to firing immediately.
  renewalTimer = setTimeout(() => void renewToken(), Math.min(delayMs, 2_147_000_000));
}

let renewing: Promise<SignedIn | null> | null = null;

/**
 * Ask for a new token now.
 *
 * Deduped: a proactive timer and a 401 arriving together must not open two
 * prompts, and every caller wants the same answer anyway.
 */
export function renewToken(): Promise<SignedIn | null> {
  if (renewing) return renewing;
  if (standingDown) return Promise.resolve(null);
  if (!refresher) return Promise.resolve(signedIn());

  renewing = refresher()
    .then((token) => (token ? setToken(token) : null))
    .catch(() => null)
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

/**
 * The session to use for the next request, renewed first if it is close to
 * running out.
 *
 * This is the proactive path in its useful form: a request made at minute 58
 * carries a token minted at minute 57 rather than one that 401s. When renewal
 * is not possible this returns whatever is in hand — including an expired
 * `null` — and lets the server have the last word, which is where the
 * authority belongs.
 */
export async function freshSession(): Promise<SignedIn | null> {
  const now = Math.floor(Date.now() / 1000);
  const session = signedIn();
  if (session && session.expiresAt - RENEW_MARGIN_SECONDS > now) return session;
  if (!refresher || standingDown) return session;
  return (await renewToken()) ?? signedIn();
}

export function onAuthChange(listener: (next: SignedIn | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The header every request carries, or nothing when signed out.
 *
 * Async because it renews first when the token is nearly out — the caller
 * awaiting one extra microtask is a far better trade than the caller getting a
 * 401 it then has to recover from.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const session = await freshSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
