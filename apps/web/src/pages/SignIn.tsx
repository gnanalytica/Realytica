import { useEffect, useRef, useState } from 'react';
import { setToken } from '../lib/auth';
import { googleClientId, renderSignInButton } from '../lib/google-identity';
import { Callout, Card, CardBody, Spinner } from '../components/ui/kit';

/**
 * The door.
 *
 * A component that draws a button and knows nothing about where the token
 * comes from. Everything provider-specific — loading the script, initialising
 * the client, asking for a silent renewal later on — lives in
 * `lib/google-identity.ts`, because a session that runs out mid-edit has to be
 * renewed while this component is by definition *not* mounted.
 *
 * The client id is a build-time value (`VITE_GOOGLE_CLIENT_ID`) and is not a
 * secret; it is public by design, and the server checks that a token was
 * minted for it before believing a word.
 */
export default function SignIn({ notice, onSignedIn }: { notice?: string; onSignedIn: () => void }) {
  const clientId = googleClientId();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const parent = buttonRef.current;
    if (!parent) return;

    void renderSignInButton(parent, clientId, (token) => {
      if (cancelled) return;
      if (!token) {
        setError('Google returned no token. Try again.');
        return;
      }
      if (!setToken(token)) {
        setError('That token was not readable. Try again.');
        return;
      }
      onSignedIn();
    })
      .then(() => {
        if (!cancelled) setLoading(false);
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
