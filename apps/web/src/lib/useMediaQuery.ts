import { useEffect, useState } from 'react';

/**
 * A media query as React state.
 *
 * Needed where a breakpoint has to change BEHAVIOUR rather than styling. Most
 * of this app can answer "is there room" with a Tailwind prefix, and should —
 * a `lg:` class costs no render and no listener. This exists for the cases a
 * class cannot reach: the cockpit sets its chat column from an inline
 * `style={{ width }}`, because the width is dragged and persisted, and no CSS
 * breakpoint can override an inline style. Deciding whether to apply it at
 * all therefore has to happen in JavaScript.
 *
 * Initialised from `matchMedia` rather than from a default plus an effect, so
 * the first paint is already correct. A phone that rendered the desktop
 * layout for one frame would show three columns overflowing the viewport and
 * then snap — worse than the layout it is fixing.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Re-read on subscribe: the query can have changed between the initial
    // state and this effect (a rotation during hydration, a prop change).
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The cockpit's one structural breakpoint — Tailwind's `lg`. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
