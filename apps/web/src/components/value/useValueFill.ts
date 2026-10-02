import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Filling the inputs in front of the reader.
 *
 * Pressing "Value this property" checks the file on the server and comes back
 * with the inputs the file holds. They could all appear at once; instead they
 * arrive one at a time, in the order a valuer would reach for them, so the
 * reader sees each value land with its source beside it and watches the
 * figure move as each approach gets what it needs. That is the whole of the
 * reason for the motion: a value that appears with its provenance is read; a
 * page of values that appeared at once is skimmed.
 *
 * Everything shows at once for anyone who has asked for less motion.
 */

export type FillPhase = 'idle' | 'checking' | 'filling' | 'done';

/** One input every this many milliseconds: slow enough to read the source, quick enough not to wait on. */
export const FILL_STEP_MS = 260;

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface ValueFill {
  phase: FillPhase;
  /** The inputs shown so far during a fill. Null outside one: everything shows. */
  revealed: ReadonlySet<string> | null;
  /** The input filling right now. */
  current: string | null;
  /** How many of this fill's inputs have landed, and of how many. */
  progress: { done: number; total: number };
  /** Run the check, then fill the keys it returns. */
  start: (load: () => Promise<string[]>) => Promise<void>;
  /** Back to rest — after the reader has seen the summary of what was filled. */
  reset: () => void;
}

export function useValueFill(): ValueFill {
  const [phase, setPhase] = useState<FillPhase>('idle');
  const [order, setOrder] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const start = useCallback(async (load: () => Promise<string[]>) => {
    window.clearInterval(timer.current);
    setPhase('checking');
    setCount(0);
    let keys: string[];
    try {
      keys = await load();
    } catch (e) {
      setPhase('idle');
      throw e;
    }
    setOrder(keys);
    if (!keys.length || reducedMotion()) {
      setCount(keys.length);
      setPhase('done');
      return;
    }
    setPhase('filling');
    let n = 0;
    timer.current = window.setInterval(() => {
      n += 1;
      setCount(n);
      if (n >= keys.length) {
        window.clearInterval(timer.current);
        // One beat on the last value before the summary replaces the progress.
        window.setTimeout(() => setPhase('done'), FILL_STEP_MS * 2);
      }
    }, FILL_STEP_MS);
  }, []);

  const reset = useCallback(() => {
    window.clearInterval(timer.current);
    setPhase('idle');
    setOrder([]);
    setCount(0);
  }, []);

  const filling = phase === 'checking' || phase === 'filling';
  // One set per step, not per render: the page memoises the figure on it.
  const revealed = useMemo(() => (filling ? new Set(order.slice(0, count)) : null), [filling, order, count]);
  return {
    phase,
    revealed,
    current: phase === 'filling' && count > 0 ? (order[count - 1] ?? null) : null,
    progress: { done: count, total: order.length },
    start,
    reset,
  };
}

/**
 * A figure that travels to its new value rather than snapping to it.
 *
 * Used on the headline while the inputs fill: each approach that completes
 * moves the value, and a number that counts across is a number the reader
 * sees change. Snaps for anyone who has asked for less motion.
 */
export function useCountUp(target: number | null, durationMs = 640): number | null {
  const [shown, setShown] = useState(target);
  // Where the figure is on screen now, so a new target mid-count travels on
  // from there rather than jumping back to where the last count started.
  const current = useRef(target);
  useEffect(() => {
    const origin = current.current;
    if (target === null || origin === null || reducedMotion() || origin === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Decelerate into the value, as everything arriving in this app does.
      const value = origin + (target - origin) * (1 - Math.pow(1 - t, 3));
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return shown;
}
