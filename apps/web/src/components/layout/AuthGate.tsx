import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthChange, signedIn } from '../../lib/auth';
import { api, setUnauthorisedHandler } from '../../lib/api';
import SignIn from '../../pages/SignIn';
import { Spinner } from '../ui/kit';

/**
 * Nothing renders until we know who is asking.
 *
 * Three states, and the third is the one that matters. Signed out shows the
 * door. Signed in shows the app. And "the deployment has no provider
 * configured" shows the app too — with the server running as a single local
 * operator, which is how development works and which the server itself refuses
 * to allow in production.
 *
 * That third state is read from the server rather than guessed from whether a
 * client id was built in, because the server is the one enforcing it. A client
 * that decided for itself would be a client that could be told to skip the
 * door — and the server would still refuse it, which is the right outcome
 * reached by the wrong route.
 */

type State =
  | { kind: 'checking' }
  | { kind: 'open' }
  | { kind: 'needs-sign-in'; notice?: string }
  | { kind: 'signed-in' };

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  const settle = useCallback(async () => {
    try {
      const health = await api.health();
      if (health.auth?.mode === 'off') {
        setState({ kind: 'open' });
        return;
      }
    } catch {
      // The API being unreachable is not a reason to show the door: the app
      // shell reports it far better than a sign-in screen would.
      setState(signedIn() ? { kind: 'signed-in' } : { kind: 'needs-sign-in' });
      return;
    }
    setState(signedIn() ? { kind: 'signed-in' } : { kind: 'needs-sign-in' });
  }, []);

  useEffect(() => {
    void settle();
    return onAuthChange((next) => {
      setState((prev) =>
        prev.kind === 'open' ? prev : next ? { kind: 'signed-in' } : { kind: 'needs-sign-in' },
      );
    });
  }, [settle]);

  useEffect(() => {
    // A token expiring mid-session looks exactly like never having had one.
    setUnauthorisedHandler(() =>
      setState((prev) =>
        prev.kind === 'open' ? prev : { kind: 'needs-sign-in', notice: 'Your session ran out. Sign in again.' },
      ),
    );
    return () => setUnauthorisedHandler(null);
  }, []);

  if (state.kind === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page">
        <Spinner size={20} />
      </div>
    );
  }

  if (state.kind === 'needs-sign-in') {
    return <SignIn notice={state.notice} onSignedIn={() => setState({ kind: 'signed-in' })} />;
  }

  return <>{children}</>;
}
