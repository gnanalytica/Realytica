import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../ui/kit';
import { useEdges } from '../../lib/useEdges';

/**
 * One function's page: its parts, and a row across the top that says which
 * one you are in and takes you to any of them.
 *
 * Every part in the row is an icon with its name beside it, at every width:
 * nobody has to hover an icon to learn what it opens. Where the names do not
 * all fit (a phone, or the work beside an open proof pane) the row scrolls
 * sideways, with a fade at the edge that has more.
 *
 * It measures the nearest scrolling ancestor, so it works wherever it is
 * dropped: inside the project's work surface or the example's.
 *
 * A page given `only` draws that one part and nothing below it. The rail then
 * switches parts in place of scrolling to them (`onPick`), so a function
 * opens on the part that is its own and every other part is one press away,
 * never stacked down the page.
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
  only,
  onPick,
}: {
  sections: PageSection[];
  /** The one part to draw, by id. Absent: every part, one under another. */
  only?: string;
  /** With `only`: a part picked on the rail. */
  onPick?: (id: string) => void;
  /** What stands above the first section: how the function stands, a notice. */
  lead?: ReactNode;
  /** A section to bring into view from outside the page, such as an answer in the chat. `at` makes a repeat count. */
  jump?: { id: string; at: number } | null;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [spied, setCurrent] = useState<string | undefined>(sections[0]?.id);
  const current = only ?? spied;
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
    // One part drawn: there is nothing to tell apart by where the page is scrolled to.
    if (!el || !scroller || only) return;
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
  }, [ids, only]);

  const go = useCallback((id: string, fromOutside = false) => {
    if (only) {
      if (!fromOutside) onPick?.(id);
      return;
    }
    // Matched on the attribute's value, not through a selector: the id can come from an address, and an address can hold anything.
    const part = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-section]') ?? []).find((el) => el.dataset.section === id);
    if (!part) return;
    held.current = true;
    setCurrent(id);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A link that marked a row inside the part lands on the row. One that marked none, or a row that is not drawn, lands on the part.
    const row = fromOutside ? part.querySelector<HTMLElement>('[data-marked]') : null;
    (row ?? part).scrollIntoView({ block: row ? 'center' : 'start', behavior: calm ? 'auto' : 'smooth' });
  }, [only, onPick]);

  // A part switched to starts at its top, unless a link marked a record inside it: then the record is what comes into view.
  const jumped = jump?.at;
  useEffect(() => {
    if (!only) return;
    const row = jumped !== undefined ? root.current?.querySelector<HTMLElement>('[data-marked]') : null;
    if (row) row.scrollIntoView({ block: 'center' });
    else scrollParent(root.current)?.scrollTo({ top: 0 });
  }, [only, jumped]);

  useEffect(() => {
    if (jump) go(jump.id, true);
  }, [jump, go]);

  // Where the icons lie in a row, whether the row has more to show past either edge.
  const [row, edges] = useEdges(ids);

  return (
    <div ref={root} className={cn('grid grid-cols-1 items-start gap-2', className)}>
      {/*
        The parts of the page, each an icon with its name beside it: a part is
        never an icon alone that has to be hovered to be read. The holder
        stays put while the page scrolls; the row inside it scrolls sideways
        where the names do not all fit, with a fade at the edge that has more.
      */}
      <div
        className={cn(
          'sticky top-0 z-[4] -my-1.5 bg-page',
          // A scroller's own padding stays above a sticky child, and the page would show through it: the row's ground reaches up to cover that strip.
          'shadow-[0_-16px_0_0_var(--page)]',
        )}
      >
      <nav ref={row} aria-label="Parts of this page" className="flex gap-0.5 overflow-x-auto py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const on = section.id === current;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => go(section.id)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'flex h-8 min-w-0 shrink-0 items-center gap-[7px] overflow-hidden whitespace-nowrap rounded-lg px-2 text-left text-[13px] coarse:h-11',
                'transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px]',
                on ? 'bg-brand-soft font-semibold text-brand-strong' : 'text-ink-secondary hover:bg-sunken hover:text-ink',
              )}
            >
              <section.icon size={16} strokeWidth={1.7} aria-hidden className="shrink-0" />
              <span>{section.name}</span>
            </button>
          );
        })}
      </nav>
        {/* The row hides its scrollbar, so a fade says there are more parts that way. */}
        {edges.start ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-page to-transparent" /> : null}
        {edges.end ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-page to-transparent" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        {lead}
        {/* A section brought into view stops clear of what stays put above it: the row of icons where the page is narrow, nothing but a margin where the rail stands beside it. */}
        {(only ? sections.filter((section) => section.id === only) : sections).map((section) => (
          <section
            key={section.id}
            data-section={section.id}
            aria-label={section.name}
            className="flex scroll-mt-16 flex-col gap-3.5"
          >
            {section.body}
          </section>
        ))}
      </div>
    </div>
  );
}
