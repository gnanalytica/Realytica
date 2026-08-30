import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Two-finger pinch to zoom, and two-finger drag to pan.
 *
 * Both canvases handled a mouse wheel and a single dragging pointer, which
 * covers every desktop input and none of the ones a phone has. The graph is
 * the surface most worth looking at on a small screen — it is the only view
 * that shows a whole case at once — and it was the least usable, because the
 * only way to change the zoom was two buttons that step from the centre.
 *
 * Native listeners rather than React's synthetic touch events, for the same
 * reason the wheel handler is native: the synthetic ones are passive, so
 * `preventDefault()` in them does nothing and the browser's own page-zoom
 * takes the gesture instead. Bound to the viewport element alone, so a pinch
 * anywhere else on the page still zooms the page.
 *
 * A pinch is deliberately allowed to pan as well. Fingers do not hold still,
 * and a pinch that zooms but refuses to move drifts the thing you are
 * pinching out from under them.
 */
export function usePinchZoom(
  viewportRef: RefObject<HTMLElement | null>,
  onPinch: (factor: number, cx: number, cy: number, dx: number, dy: number) => void,
): void {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    /** Distance and midpoint of the last two-finger sample, in element space. */
    let last: { dist: number; cx: number; cy: number } | null = null;

    const measure = (touches: TouchList) => {
      const rect = el.getBoundingClientRect();
      const [a, b] = [touches[0], touches[1]];
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      last = measure(e.touches);
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !last) return;
      // Only once a two-finger gesture is genuinely under way, so a one-finger
      // drag on the canvas still reaches the pointer handlers that pan it.
      e.preventDefault();
      const now = measure(e.touches);
      // A zero or absurd ratio comes from a sample where the fingers landed on
      // the same point; skipping it beats dividing by it.
      if (last.dist > 0 && now.dist > 0) {
        onPinch(now.dist / last.dist, now.cx, now.cy, now.cx - last.cx, now.cy - last.cy);
      }
      last = now;
    };

    const onEnd = (e: TouchEvent) => {
      // Lifting one finger of two ends the pinch rather than continuing it
      // with a stale baseline, which would jump the zoom on the next sample.
      if (e.touches.length < 2) last = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [viewportRef, onPinch]);
}
