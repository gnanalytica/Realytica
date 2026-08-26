import { useEffect, useRef, useState } from 'react';

export interface AnimatedNumberProps {
  value: number;
  /** Renders the number. Called on every frame, so keep it cheap. */
  format: (v: number) => string;
  /** Milliseconds. Kept short — this is a readout settling, not a scoreboard. */
  duration?: number;
  className?: string;
}

/**
 * A figure that counts to its value rather than appearing at it.
 *
 * The one idea worth taking from the animated-component libraries: when a
 * valuation changes because a document landed or a screen re-ran, an
 * instantly-replaced number is a change you can miss entirely. Counting draws
 * the eye to the thing that moved.
 *
 * Two rules it obeys that most count-up components do not:
 *
 *  - It animates *between* values, not from zero. Re-running a screen that
 *    moves a range by two lakh should show a two-lakh move; restarting from
 *    zero would imply the whole figure had just been established.
 *  - It never animates on first paint. A number that counts up every time you
 *    open a page is decoration, and it delays the one thing the reader came
 *    for. Only a change to an already-visible figure is worth animating.
 *
 * Reduced motion is honoured by the same CSS rule as everything else — this
 * uses rAF rather than CSS, so it checks the media query itself.
 */
export function AnimatedNumber({ value, format, duration = 420, className }: AnimatedNumberProps) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number>();

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;

    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      // The same decelerating curve as `ease-enter`, so a counting number and a
      // panel arriving beside it settle together rather than at different rates.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, duration]);

  /*
   * `tabular` on the wrapper, always.
   *
   * Without fixed-width digits a counting number changes width on nearly every
   * frame, which shoves whatever sits beside it back and forth. That reads as
   * a broken layout rather than as motion.
   */
  return <span className={className}>{format(shown)}</span>;
}
