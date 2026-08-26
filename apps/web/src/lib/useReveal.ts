import { useEffect, useRef, useState } from 'react';

/**
 * Reveal an element the first time it scrolls into view.
 *
 * --- Why it starts revealed, not hidden ----------------------------------
 *
 * The obvious implementation starts every element at `opacity: 0` and lets an
 * observer turn it on. That has a failure mode this codebase has been bitten
 * by before in a different form: if the mechanism never runs, the content is
 * gone rather than merely unanimated. No IntersectionObserver, a JS error
 * higher up the tree, a hydration that never happens — and the page is blank
 * with the markup all present.
 *
 * So the hidden state is opt-in and is entered only once we know the
 * machinery works and the viewer wants motion. `prefers-reduced-motion`
 * short-circuits it entirely: the global CSS guard would collapse the
 * transition to 1ms anyway, but that still means a frame of invisible content
 * and a needless observer per element.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options: { delayMs?: number } = {}) {
  const ref = useRef<T | null>(null);
  // Revealed until proven otherwise — see above.
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const node = ref.current;
    if (!node) return;

    // Anything already on screen at mount stays visible. Animating it in
    // would mean the first thing a visitor sees is content fading in
    // underneath them, which reads as a slow page rather than a considered
    // one — the hero has its own entrance for that.
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight) return;

    setRevealed(false);
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Once revealed, stay revealed. Re-hiding on scroll-up is the
          // single most common way a reveal effect becomes an irritation.
          setRevealed(true);
          observer.disconnect();
        }
      },
      // A little before the edge, so the element is already settling by the
      // time it is properly in view rather than starting when it arrives.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return {
    ref,
    revealed,
    /** Spread onto the element: the transition, the hidden state, and the stagger. */
    props: {
      ref,
      className: revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      style: { transition: 'opacity 420ms cubic-bezier(0.16,1,0.3,1), transform 420ms cubic-bezier(0.16,1,0.3,1)', transitionDelay: `${options.delayMs ?? 0}ms` },
    },
  };
}
