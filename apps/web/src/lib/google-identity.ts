/**
 * Talking to Google Identity Services, in one place.
 *
 * This used to live inside `SignIn.tsx`, which was fine while the only moment
 * the app needed a token was the moment somebody pressed the button. It is not
 * fine now: a session that runs out mid-edit has to be renewed while the app
 * is still on screen, and the sign-in component is by definition not mounted
 * then. So the provider moves out here, and `SignIn` becomes what it should
 * always have been — a component that renders a button and knows nothing about
 * where the token comes from.
 *
 * ## What "silent" can and cannot do
 *
 * GIS re-issues an ID token without any interaction when the person still has
 * a live Google session in this browser and has already consented to this
 * client. That covers the ordinary case this exists for: somebody signed in an
 * hour ago, is halfway through a report, and their token has aged out.
 *
 * It cannot help when they have signed out of Google, revoked consent, or
 * blocked third-party state — and it will not be allowed to hang around
 * waiting to find out. `requestSilentToken` resolves `null` on a timeout, and
 * the caller falls back to the door. A refresh that never settles would be
 * worse than one that fails: the app would sit there looking like it was
 * working.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** How long a silent attempt may take before the door is the honest answer. */
const SILENT_TIMEOUT_MS = 8_000;

interface PromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
}

interface GsiIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  prompt: (listener?: (notification: PromptNotification) => void) => void;
  cancel?: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GsiIdApi } };
  }
}

export function googleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
}

let scriptPromise: Promise<GsiIdApi> | null = null;

/** Load the script once, however many callers want it. */
export function loadGoogleIdentity(): Promise<GsiIdApi> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<GsiIdApi>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id);
      return;
    }
    const done = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('Google sign-in loaded but exposed no API'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('Google sign-in did not load')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = done;
    script.onerror = () => reject(new Error('Google sign-in did not load'));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    // A failed load must not be cached as a permanent failure — the network
    // comes back, and the next attempt deserves a real try.
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

/**
 * Whoever is waiting for the next credential GIS produces.
 *
 * One slot rather than a queue: `initialize` takes a single callback, so there
 * is only ever one outstanding request by construction, and a second caller
 * arriving mid-flight should join the first rather than start a rival prompt.
 */
let pending: ((token: string | null) => void) | null = null;
let initialisedFor: string | null = null;

function ensureInitialised(api: GsiIdApi, clientId: string): void {
  if (initialisedFor === clientId) return;
  api.initialize({
    client_id: clientId,
    callback: (response) => {
      const settle = pending;
      pending = null;
      settle?.(response.credential ?? null);
    },
    // The whole point of a silent renewal: do not ask somebody who has exactly
    // one account to pick it again.
    auto_select: true,
    cancel_on_tap_outside: false,
  });
  initialisedFor = clientId;
}

/**
 * Draw the sign-in button, and resolve when somebody uses it.
 *
 * Returns a token or `null` if the credential came back empty; the caller
 * decides what to say about it.
 */
export async function renderSignInButton(
  parent: HTMLElement,
  clientId: string,
  onToken: (token: string | null) => void,
): Promise<void> {
  const api = await loadGoogleIdentity();
  ensureInitialised(api, clientId);
  pending = onToken;
  api.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    width: 280,
  });
}

let inFlight: Promise<string | null> | null = null;

/**
 * Ask for a fresh ID token without showing the door.
 *
 * Resolves `null` — never rejects, never hangs — when Google will not or
 * cannot produce one. `null` is not an error condition to be reported; it is
 * the ordinary answer meaning "ask them to sign in", and the caller already
 * knows how to do that.
 */
export function requestSilentToken(): Promise<string | null> {
  if (inFlight) return inFlight;

  const clientId = googleClientId();
  if (!clientId) return Promise.resolve(null);

  inFlight = new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pending === finish) pending = null;
      resolve(token);
    };

    // The guard that matters. Every other exit below is best-effort: GIS has
    // changed which notification methods it reports over the years, and a
    // renewal that silently stopped settling would leave the app frozen behind
    // a spinner rather than showing the door.
    const timer = setTimeout(() => finish(null), SILENT_TIMEOUT_MS);

    void loadGoogleIdentity()
      .then((api) => {
        ensureInitialised(api, clientId);
        pending = finish;
        api.prompt((notification) => {
          const unavailable =
            notification.isNotDisplayed?.() ||
            notification.isSkippedMoment?.() ||
            notification.isDismissedMoment?.();
          if (unavailable) finish(null);
        });
      })
      .catch(() => finish(null));
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Stop any prompt that is still up — used when the app gives up and shows the door. */
export function cancelSilentToken(): void {
  window.google?.accounts.id.cancel?.();
}
