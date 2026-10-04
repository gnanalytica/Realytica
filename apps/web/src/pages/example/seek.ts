import { useEffect, useRef, type RefObject } from 'react';

/**
 * For anything that can be picked: where the page is narrow a row of section
 * icons stays put across the top of it, and the thing is brought to rest
 * just under that row; where the rail stands beside the page a small margin
 * is enough. The same two figures the sections themselves stop at.
 */
export const SEEK = 'scroll-mt-16 [@container(min-width:35rem)]:scroll-mt-3';

/** What the keyboard can be handed back to without raising a phone's keyboard. */
const CONTROL = 'button:not([disabled]),a[href]';

/*
 * Where the keyboard goes when the proof closes: the control that was pressed
 * to open it, or else the picked thing itself. There is one workspace on
 * screen and one thing picked in it, so one handle is enough.
 */
let returnTo: HTMLElement | null = null;

/** Puts the keyboard back on the picked thing. */
export function backToPicked(): void {
  const el = returnTo;
  if (!el?.isConnected) return;
  (el.matches(CONTROL) ? el : el.querySelector<HTMLElement>(CONTROL))?.focus();
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Brings the picked thing into sight, each time it is shown.
 *
 * Picking opens the proof pane, and the copilot can pick something far down
 * a page the person was not on. When the thing is already in sight nothing
 * moves. Otherwise it is put about a third of the way down its scroller; on
 * a phone, where the proof pane leaves the work only a short strip, it goes
 * to the top of that strip instead, so as much of it shows as can.
 *
 * `visit` is 0 while the thing is not picked and a new number at each
 * showing, so asking to see what is already picked brings it back. `main` is
 * for the thing in the work itself, not for its echo in the proof pane.
 */
export function useSeek<T extends HTMLElement>(visit: number, main = true): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!visit || !el) return;
    if (main) {
      const pressed = document.activeElement;
      returnTo = pressed instanceof HTMLElement && el.contains(pressed) && pressed.matches(CONTROL) ? pressed : el;
    }
    const scroller = scrollerOf(el);
    if (scroller) {
      const box = el.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const clear = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      if (box.top < view.top + clear - 2 || box.bottom > view.bottom - 8) {
        const room = scroller.clientHeight - box.height - 16;
        const rest = Math.max(clear, Math.min(scroller.clientHeight * 0.3, room));
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({ top: Math.max(0, box.top - view.top + scroller.scrollTop - rest), behavior: calm ? 'auto' : 'smooth' });
      }
    }
    return () => {
      if (main && returnTo && el.contains(returnTo)) returnTo = null;
    };
  }, [visit, main]);
  return ref;
}
