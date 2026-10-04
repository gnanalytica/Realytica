import { useEffect, useRef, type RefObject } from 'react';

/** From this width the proof pane stands beside the work. Below it, it lies over the lower part of it. */
const PROOF_BESIDE = '(min-width: 1024px)';

/** How much of the screen is still in sight above a proof pane that covers the rest. */
const LEFT_IN_SIGHT = 0.32;

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Brings the picked thing into sight.
 *
 * Picking opens the proof pane, and the copilot can pick something far down
 * a page the person was not on. When the thing is already on screen nothing
 * moves; otherwise its scroller is moved so it sits about a third of the way
 * down. In the work that also keeps it clear of a proof pane lying over the
 * bottom of a narrow screen; `within` is `pane` for the words marked inside
 * the proof pane itself, which nothing covers.
 */
export function useSeek<T extends HTMLElement>(picked: boolean, within: 'work' | 'pane' = 'work'): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    const scroller = el ? scrollerOf(el) : null;
    if (!picked || !el || !scroller) return;
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const covered = within === 'work' && !window.matchMedia(PROOF_BESIDE).matches;
    const floor = covered ? Math.min(view.bottom, window.innerHeight * LEFT_IN_SIGHT) : view.bottom;
    if (box.top >= view.top + 8 && box.bottom <= floor - 16) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Under a covering pane there is only a strip to show it in, so it goes to the top of that strip, just under the row of section icons.
    const rest = covered ? 56 : Math.max(16, scroller.clientHeight * 0.3);
    scroller.scrollTo({ top: Math.max(0, box.top - view.top + scroller.scrollTop - rest), behavior: calm ? 'auto' : 'smooth' });
  }, [picked, within]);
  return ref;
}
