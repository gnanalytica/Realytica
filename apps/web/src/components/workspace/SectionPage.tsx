import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../ui/kit';
import { useEdges } from '../../lib/useEdges';

/**
 * One function's page: its sections one under another, and a rail down the
 * left that says which one you are in and takes you to any of them.
 *
 * The rail is thirty-eight pixels of icons that opens over the page to show
 * the names, on hover or on keyboard focus, so the names cost the work no
 * width. Where the work column is too narrow for a rail (a phone, or the work
 * beside an open proof pane) it lies across the top instead, with only the
 * current section named.
 *
 * It measures the nearest scrolling ancestor, so it works wherever it is
 * dropped: inside the project's work surface or the example's.
 */

export interface PageSection {
  id: string;
  name: string;
  icon: LucideIcon;
  body: ReactNode;
}

/** How far below the top of the scroller a section's heading counts as "the one in view". */
const SPY_LINE = 96;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

export function SectionPage({
  sections,
  lead,
  jump,
  className,
}: {
  sections: PageSection[];
  /** What stands above the first section: how the function stands, a notice. */
  lead?: ReactNode;
  /** A section to bring into view from outside the page, such as an answer in the chat. `at` makes a repeat count. */
  jump?: { id: string; at: number } | null;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string | undefined>(sections[0]?.id);
  /*
   * After a jump the section asked for stays marked until the page has come
   * to rest and the person scrolls for themselves. A short last section can
   * never reach the top of the scroller, so measuring while the jump is
   * still travelling, or straight after it, would mark its neighbour.
   */
  const held = useRef(false);
  const ids = sections.map((s) => s.id).join('|');

  useEffect(() => {
    const el = root.current;
    const scroller = scrollParent(el);
    if (!el || !scroller) return;
    const measure = () => {
      if (held.current) return;
      const top = scroller.getBoundingClientRect().top;
      const parts = Array.from(el.querySelectorAll<HTMLElement>('[data-section]'));
      if (!parts.length) return;
      let at = parts[0]!;
      for (const part of parts) {
        if (part.getBoundingClientRect().top - top <= SPY_LINE) at = part;
      }
      // At the foot of a page that scrolls, the last section is the one in view however short it is.
      const scrolls = scroller.scrollHeight > scroller.clientHeight + 2;
      if (scrolls && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) at = parts[parts.length - 1]!;
      setCurrent(at.dataset.section);
    };
    /*
     * What lets go of a held section: anything a person does to scroll for
     * themselves. A wheel, a finger and a key each say so directly; a press
     * on the scroller covers dragging its scrollbar, which fires none of
     * those. `scrollend` covers the jump itself coming to rest, where the
     * browser has it.
     */
    const release = () => {
      held.current = false;
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    const lets = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'scrollend'] as const;
    for (const type of lets) scroller.addEventListener(type, release, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', measure);
      for (const type of lets) scroller.removeEventListener(type, release);
    };
  }, [ids]);

  const go = useCallback((id: string) => {
    // Matched on the attribute's value, not through a selector: the id can come from an address, and an address can hold anything.
    const part = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-section]') ?? []).find((el) => el.dataset.section === id);
    if (!part) return;
    held.current = true;
    setCurrent(id);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    part.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }, []);

  useEffect(() => {
    if (jump) go(jump.id);
  }, [jump, go]);

  // Where the icons lie in a row, whether the row has more to show past either edge.
  const [row, edges] = useEdges(ids);

  return (
    <div
      ref={root}
      className={cn('grid grid-cols-1 items-start gap-2 [@container(min-width:35rem)]:-ml-2.5 [@container(min-width:35rem)]:grid-cols-[38px_minmax(0,1fr)] [@container(min-width:35rem)]:gap-2.5', className)}
    >
      {/*
        The holder stays put while the page scrolls; the row or rail inside it
        is what scrolls sideways or opens. They are two elements so the fades
        at the row's edges can sit still over it.
      */}
      <div
        className={cn(
          'sticky top-0 z-[4] -my-1.5 bg-page',
          // A scroller's own padding stays above a sticky child, and the page would show through it: the row's ground reaches up to cover that strip.
          'shadow-[0_-16px_0_0_var(--page)]',
          '[@container(min-width:35rem)]:top-3 [@container(min-width:35rem)]:my-0 [@container(min-width:35rem)]:w-[38px] [@container(min-width:35rem)]:bg-transparent [@container(min-width:35rem)]:shadow-none',
        )}
      >
      <nav
        ref={row}
        aria-label="Parts of this page"
        className={cn(
          // Narrow: a row of icons across the top, only the current one named.
          'flex gap-0.5 overflow-x-auto py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // Wide: the rail, which opens over the page.
          '[@container(min-width:35rem)]:grid [@container(min-width:35rem)]:w-[38px] [@container(min-width:35rem)]:grid-cols-1 [@container(min-width:35rem)]:overflow-hidden [@container(min-width:35rem)]:rounded-[11px] [@container(min-width:35rem)]:p-[3px]',
          '[@container(min-width:35rem)]:transition-[width,background-color,box-shadow] [@container(min-width:35rem)]:delay-75 [@container(min-width:35rem)]:duration-base [@container(min-width:35rem)]:ease-state motion-reduce:transition-none',
          '[@container(min-width:35rem)]:hover:w-[168px] [@container(min-width:35rem)]:hover:bg-surface [@container(min-width:35rem)]:hover:shadow-pop [@container(min-width:35rem)]:hover:ring-1 [@container(min-width:35rem)]:hover:ring-[var(--ring)]',
          '[@container(min-width:35rem)]:has-[button:focus-visible]:w-[168px] [@container(min-width:35rem)]:has-[button:focus-visible]:bg-surface [@container(min-width:35rem)]:has-[button:focus-visible]:shadow-pop [@container(min-width:35rem)]:has-[button:focus-visible]:ring-1 [@container(min-width:35rem)]:has-[button:focus-visible]:ring-[var(--ring)]',
        )}
      >
        {sections.map((section) => {
          const on = section.id === current;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => go(section.id)}
              aria-current={on ? 'true' : undefined}
              title={section.name}
              className={cn(
                'flex h-8 min-w-0 shrink-0 items-center gap-[7px] overflow-hidden whitespace-nowrap rounded-lg px-2 text-left text-[13px] coarse:h-11',
                'transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px]',
                '[@container(min-width:35rem)]:gap-2.5 [@container(min-width:35rem)]:px-[7px]',
                on ? 'bg-brand-soft font-semibold text-brand-strong' : 'text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              <section.icon size={18} strokeWidth={1.7} aria-hidden className="shrink-0" />
              <span className={cn(on ? 'inline' : 'hidden', '[@container(min-width:35rem)]:inline')}>{section.name}</span>
            </button>
          );
        })}
      </nav>
        {/* The row hides its scrollbar, so a fade says there are more icons that way. The rail never scrolls and has none. */}
        {edges.start ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-page to-transparent [@container(min-width:35rem)]:hidden" /> : null}
        {edges.end ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-page to-transparent [@container(min-width:35rem)]:hidden" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        {lead}
        {/* A section brought into view stops clear of what stays put above it: the row of icons where the page is narrow, nothing but a margin where the rail stands beside it. */}
        {sections.map((section) => (
          <section
            key={section.id}
            data-section={section.id}
            aria-label={section.name}
            className="flex scroll-mt-16 flex-col gap-3.5 [@container(min-width:35rem)]:scroll-mt-3"
          >
            {section.body}
          </section>
        ))}
      </div>
    </div>
  );
}
