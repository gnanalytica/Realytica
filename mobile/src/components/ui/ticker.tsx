import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { TICK_MS } from '@/theme/motion';
import { Text } from './text';

/**
 * A number that runs to its new value instead of jumping: a count of people,
 * a percentage. `from` starts the first run somewhere else (a ring counting up
 * from nothing as it opens). With Reduce Motion on, it simply changes.
 */
export function useTicker(target: number, { from, duration = TICK_MS }: { from?: number; duration?: number } = {}): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? target : (from ?? target));
  // Where the last run got to, so a change mid-run carries on from there.
  const last = useRef(reduced ? target : (from ?? target));

  useEffect(() => {
    const start = last.current;
    if (reduced || start === target || duration <= 0) {
      last.current = target;
      setShown(target);
      return;
    }
    const began = Date.now();
    let frame = requestAnimationFrame(function step() {
      const t = Math.min(1, (Date.now() - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      const value = start + (target - start) * eased;
      last.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);

  return shown;
}

interface TickerProps extends Omit<ComponentProps<typeof Text>, 'children'> {
  value: number;
  /** How the number is written; whole numbers by default. */
  format?: (n: number) => string;
  from?: number;
  duration?: number;
}

/** A Text whose number ticks. Screen readers hear only the final value, never the run. */
export function Ticker({ value, format = (n) => String(Math.round(n)), from, duration, accessibilityLabel, ...text }: TickerProps) {
  const shown = useTicker(value, { from, duration });
  return (
    <Text {...text} accessibilityLabel={accessibilityLabel ?? format(value)}>
      {format(shown)}
    </Text>
  );
}
