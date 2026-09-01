import { useCallback, useEffect, useRef, useState } from 'react';
import type { DurableRunState } from '@realytica/shared';
import { api } from './api';

/**
 * Start a long operation and watch it from a distance.
 *
 * The pattern the API offers: the POST returns a run id immediately, the work
 * proceeds detached, and the run journal is the shared state. This hook is
 * the client half — start, poll, stop — so a person can begin a screen and
 * go and read something else instead of holding a connection open.
 *
 * Polling rather than streaming on purpose. The journal is durable, so a
 * reload mid-run picks the run back up; a stream would have to be
 * re-established and would still not survive the tab being closed, which is
 * the case this exists for.
 *
 * It stops on any terminal state, `interrupted` included — that is the honest
 * end for a run whose process died, and continuing to poll it would present
 * a dead run as a live one.
 */
const POLL_MS = 1500;
const TERMINAL: DurableRunState[] = ['finished', 'failed', 'interrupted'];

export interface BackgroundRunView {
  state: DurableRunState | null;
  line: string | null;
  busy: boolean;
  /** False when the platform would not keep detached work alive — worth saying so. */
  keptAlive: boolean | null;
  start: () => Promise<void>;
  error: string | null;
}

export function useBackgroundRun(
  projectId: string,
  kind: 'screen' | 'orchestrate',
  onSettled?: (state: DurableRunState) => void | Promise<void>,
): BackgroundRunView {
  const [runId, setRunId] = useState<string | null>(null);
  const [state, setState] = useState<DurableRunState | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [keptAlive, setKeptAlive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef<(s: DurableRunState) => void | Promise<void>>();
  settled.current = onSettled;

  const start = useCallback(async () => {
    setError(null);
    setState(null);
    setLine(null);
    try {
      const started = await api.startBackgroundRun(projectId, kind);
      setKeptAlive(started.keptAlive);
      setRunId(started.runId);
      setState('running');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run');
    }
  }, [projectId, kind]);

  useEffect(() => {
    if (!runId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      try {
        const run = await api.projectRun(projectId, runId);
        if (!live) return;
        setState(run.state);
        setLine(run.line);
        if (TERMINAL.includes(run.state)) {
          setRunId(null);
          await settled.current?.(run.state);
          return;
        }
      } catch (e) {
        if (!live) return;
        // A failed poll is not a failed run — the journal is durable and the
        // next tick may well read it. Keep polling; surface the reason.
        setError(e instanceof Error ? e.message : 'Could not read the run');
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, runId]);

  return { state, line, busy: runId !== null, keptAlive, start, error };
}
