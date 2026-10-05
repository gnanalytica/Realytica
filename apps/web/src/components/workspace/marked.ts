import { useEffect, useRef } from 'react';

/**
 * A row a link pointed at.
 *
 * A link from the chat, an alert or a card can name one record on a function's
 * page: a document, a check, an approval, a milestone. The page opens with
 * that row lit and in view, so the person lands on the thing and not on the
 * top of the list it is in. The row wears the colour of what is picked, the
 * same one a register gives the row a link opened.
 */
export const MARKED_ROW = 'bg-brand-soft ring-2 ring-inset ring-brand/35';

/**
 * Brings the marked row of a list into view when a link lands on it.
 *
 * Give the returned ref to anything that holds the rows, and put `data-marked`
 * on the row that is marked. `marked` is what the link named: the row comes
 * into view when it changes, and stays where the person scrolls it after.
 * `visit` is a number for the visit that landed here, where the caller keeps
 * one: the same row asked for on a later visit comes into view again.
 */
export function useMarkedRow<T extends HTMLElement>(marked: string | null | undefined, visit?: number) {
  const holder = useRef<T>(null);
  useEffect(() => {
    if (!marked) return;
    const row = holder.current?.querySelector<HTMLElement>('[data-marked]');
    if (!row) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }, [marked, visit]);
  return holder;
}
