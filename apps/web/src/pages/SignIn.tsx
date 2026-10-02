import { useEffect, useRef, useState } from 'react';
import { setToken } from '../lib/auth';
import { googleClientId, renderSignInButton } from '../lib/google-identity';
import { Lock } from 'lucide-react';
import { STAGES } from '@realytica/shared';
import { EASE_ENTER, motion } from '../lib/motion';
import { AiMark, Callout, Spinner } from '../components/ui/kit';

function Mark({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden>
      <svg viewBox="0 0 100 100" className="size-[55%]">
        <path d="M26 68 L50 26 L74 68 Z" fill="none" stroke="white" strokeWidth={10} strokeLinejoin="round" />
      </svg>
    </span>
  );
}

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
    <div className="grid min-h-dvh bg-page lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* The promise, on the wide screen only: a phone goes straight to the door. */}
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-[var(--text-inverse)] lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-brand/45 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 size-96 rounded-full bg-ai/30 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <Mark className="grid size-9 place-items-center rounded-xl bg-brand" />
          <span className="text-[16px] font-semibold tracking-tight">Realytica</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <motion.h1
            className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_ENTER }}
          >
            A property&rsquo;s whole life, in one place.
          </motion.h1>
          <p className="mt-4 text-[15px] leading-relaxed opacity-70">Its stages, its departments and their work, the documents read with their page, and a copilot beside every view.</p>
          <div className="mt-10 flex gap-2">
            {STAGES.map((stage, i) => (
              <div key={stage.key} className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium opacity-70">{stage.label}</p>
                <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-white/15">
                  <motion.span
                    className="block h-full rounded-full bg-white"
                    initial={{ width: 0 }}
                    animate={{ width: i < 2 ? '100%' : i === 2 ? '45%' : '0%' }}
                    transition={{ duration: 0.6, ease: EASE_ENTER, delay: 0.4 + i * 0.2 }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="mt-10 flex items-center gap-2 text-[13px] opacity-70">
            <Lock size={14} />
            The AI proposes. Nothing is filed until a person accepts it.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_ENTER, delay: 0.1 }}
        >
          <div className="flex items-center gap-2.5 lg:hidden">
            <Mark className="grid size-9 place-items-center rounded-xl bg-brand" />
            <span className="text-[16px] font-semibold tracking-tight text-ink">Realytica</span>
          </div>
          <div className="mt-8 rounded-2xl bg-surface p-6 shadow-raised ring-1 ring-[var(--ring)] lg:mt-0">
            <p className="text-[12px] font-medium text-ink-muted">Project workspace</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-ink">Sign in</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">With the Google account your workspace knows you by.</p>

            <div className="mt-5 space-y-3">
              {notice ? <Callout tone="warning" title="Signed out">{notice}</Callout> : null}
              {!clientId ? (
                <Callout tone="critical" title="No sign-in configured">
                  This build has no <span className="font-mono">VITE_GOOGLE_CLIENT_ID</span>. Set it to the OAuth web
                  client id from your Google Cloud project and rebuild.
                </Callout>
              ) : error ? (
                <Callout tone="critical" title="Sign-in unavailable">{error}</Callout>
              ) : null}
            </div>

            <div className="mt-5 flex min-h-11 justify-center">
              {loading && clientId && !error ? <Spinner /> : null}
              <div ref={buttonRef} />
            </div>
          </div>
          <p className="mt-5 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-ink-muted">
            <AiMark size="xs" className="mt-0.5" />
            Only people change the record. What the copilot writes waits for a person to accept it.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
