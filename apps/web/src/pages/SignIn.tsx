import { useEffect, useRef, useState } from 'react';
import { setToken } from '../lib/auth';
import { Callout, Card, CardBody, Spinner } from '../components/ui/kit';

/**
 * The door.
 *
 * Google Identity Services rather than a bundled SDK: it is one script tag, it
 * needs nothing but an OAuth client id, and the thing it hands back — a signed
 * ID token — is exactly what the server verifies. A deployment on Identity
 * Platform swaps this component and nothing else, because everything below it
 * only ever sees a token.
 *
 * The client id is a build-time value (`VITE_GOOGLE_CLIENT_ID`) and is not a
 * secret; it is public by design, and the server checks that a token was
 * minted for it before believing a word.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google sign-in did not load')));
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in did not load'));
    document.head.appendChild(script);
  });
}

export default function SignIn({ notice, onSignedIn }: { notice?: string; onSignedIn: () => void }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void loadGsi()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              setError('Google returned no token. Try again.');
              return;
            }
            if (!setToken(response.credential)) {
              setError('That token was not readable. Try again.');
              return;
            }
            onSignedIn();
          },
          cancel_on_tap_outside: false,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 280,
        });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Google sign-in did not load');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, onSignedIn]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-page px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="space-y-4 text-center">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-ink">Realytica</p>
            <p className="mt-0.5 text-[12.5px] text-ink-secondary">Due diligence OS</p>
          </div>

          {notice ? <Callout tone="warning" title="Signed out">{notice}</Callout> : null}

          {!clientId ? (
            <Callout tone="critical" title="No sign-in configured">
              This build has no <span className="font-mono">VITE_GOOGLE_CLIENT_ID</span>. Set it to the OAuth web
              client id from your Google Cloud project and rebuild.
            </Callout>
          ) : error ? (
            <Callout tone="critical" title="Sign-in unavailable">{error}</Callout>
          ) : null}

          <div className="flex justify-center">
            {loading && clientId && !error ? <Spinner /> : null}
            <div ref={buttonRef} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
