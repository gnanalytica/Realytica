import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Whether a scroller has more to show, on each side.
 *
 * A row of chips or tabs hides its scrollbar on purpose — a visible one across
 * a five-item strip is uglier than the problem it solves — but hiding it
 * removes the only thing saying the row scrolls at all. On a phone that put
 * the last tab off the right edge with nothing to suggest it was there, so
 * the end of the product's own workflow order was invisible unless you
 * happened to swipe.
 *
 * Measured rather than assumed: a fade painted unconditionally would sit at
 * the edge of a row that fits, implying content that does not exist. `watch`
 * is anything that changes when the row's contents do, so a row whose items
 * are swapped without its own size changing is measured again.
 */
export function useEdges(watch?: unknown): [RefObject<HTMLDivElement>, { start: boolean; end: boolean }] {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // A couple of pixels of slack: sub-pixel widths otherwise leave a fade
      // showing at a scroll position that is visually the end.
      const maxScroll = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft < maxScroll - 2 });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [watch]);

  return [ref, edges];
}
