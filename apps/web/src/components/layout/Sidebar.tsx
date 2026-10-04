import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, BookOpen, CircleCheck, FolderTree, Home, Inbox, Info, Users, X } from 'lucide-react';
import { cn } from '../ui/kit';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

export interface SidebarProps {
  collapsed: boolean;
  /** Inside a project workspace the rail stays narrow, whatever the preference. */
  forceCollapsed?: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof FolderTree;
  end: boolean;
  /** Addresses that are also this place: a project's own pages belong to the portfolio it was opened from. */
  also?: string;
}

/*
 * The firm's work first: its projects, what it is waiting on from others, and
 * the people it works with. Setup and reference sit below the rule.
 *
 * Portfolio and Projects were two entries here for one set of projects, shown
 * as a board by stage in one and as a list in the other. The portfolio now
 * has both views, and this is one entry.
 */
const PROJECT_ITEMS: NavItem[] = [
  { to: '/portfolio', label: 'Portfolio', icon: Home, end: false, also: '/projects' },
  { to: '/requests', label: 'Requests', icon: Inbox, end: false },
  { to: '/members', label: 'People', icon: Users, end: false },
];

const MORE_ITEMS: NavItem[] = [
  { to: '/work', label: 'My work', icon: CircleCheck, end: false },
  { to: '/libraries', label: 'Libraries', icon: BookOpen, end: false },
  { to: '/about', label: 'About', icon: Info, end: false },
];

function NavGroup({
  items,
  collapsed,
  heading,
}: {
  items: NavItem[];
  collapsed: boolean;
  heading?: string;
}) {
  const { pathname } = useLocation();
  return (
    <>
      {/*
        A rule, not a word.

        This group was headed "MORE", which names nothing: the reader learns
        that there are additional items, which they can already see. The split
        is real — above is the work, below is how the workspace is set up and
        what it has been doing — and a hairline says "different kind of thing"
        without spending a line of uppercase micro-caps saying it badly.
      */}
      {heading ? <hr className={cn('mx-2.5 my-3 border-t border-hairline', collapsed && 'lg:mx-1.5')} aria-hidden /> : null}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          /*
           * `aria-label` rather than the visible text, because the text is
           * `display:none` at this width and a hidden span names nothing.
           */
          aria-label={collapsed ? item.label : undefined}
          className={({ isActive: here }) => {
            const isActive = here || Boolean(item.also && pathname.startsWith(item.also));
            return cn(
              /* `coarse:` for the pointer, not `lg:` for the window: a tablet
                 is wide and still fingered. These rows measured 36px against
                 the 44 a thumb needs, on the app's primary navigation. */
              /* `min-h-11` rather than more padding: padding arithmetic landed
                 these at 43.5px — half a pixel short, and invisible unless the
                 measurement is taken unrounded. State the minimum instead of
                 computing it. */
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium coarse:min-h-11',
              'transition-[background-color,color] duration-quick ease-state',
              isActive
                ? 'bg-brand-soft text-brand before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-brand'
                : 'text-ink-secondary hover:bg-sunken hover:text-ink',
              // The narrow rail keeps its words, small, under each mark — an
              // eight-icon rail with no words is a memory test.
              collapsed && 'lg:flex-col lg:justify-center lg:gap-1 lg:px-0 lg:py-2 lg:before:inset-y-2',
            );
          }}
        >
          <item.icon size={collapsed ? 18 : 16} className="shrink-0" />
          <span className={cn(collapsed && 'lg:text-[10px] lg:font-medium lg:leading-none')}>{item.label}</span>
          {/*
            An eight-icon rail with no words is a memory test, and the browser's
            own `title` is the wrong answer to it: it waits about a second, which
            is longer than it takes to give up and click the icon to find out.
            This one appears on hover and on keyboard focus, immediately.

            `aria-hidden` because the link is already named above — a screen
            reader that read both would say every item twice.
          */}

        </NavLink>
      ))}
    </>
  );
}

/**
 * Fixed left navigation. Collapses to an icon rail on large screens (state
 * remembered in localStorage by the parent); becomes an overlay drawer below `lg`.
 */
export default function Sidebar({ collapsed: preferred, forceCollapsed = false, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const collapsed = preferred || forceCollapsed;
  /*
   * Escape closes it, and the page behind it stops scrolling while it is
   * open. A drawer without either is one a keyboard user cannot dismiss and
   * one that scrolls the wrong thing under a thumb — both invisible to a
   * mouse on a desktop, which is why they were missing.
   */
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen, onCloseMobile]);

  /*
   * A drawer parked offscreen is still in the accessibility tree.
   *
   * On a phone the rail is translated out of the viewport by a class, which
   * moves the pixels and nothing else: every one of its links stayed
   * focusable and stayed readable to a screen reader, at negative
   * coordinates, in front of the page the reader was actually on. `inert`
   * cannot be set from CSS and must not be set on the desktop rail — where
   * the same element is a permanent column — so the breakpoint is read here.
   */
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const aside = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = aside.current;
    if (!el) return;
    if (!desktop && !mobileOpen) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [desktop, mobileOpen]);

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}

      <aside
        ref={aside}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[220px] shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 ease-out',
          'lg:static lg:z-auto lg:translate-x-0',
          collapsed && 'lg:w-[72px]',
          mobileOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full lg:translate-x-0',
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline px-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand" aria-hidden="true">
            <svg viewBox="0 0 100 100" className="h-4 w-4">
              <path d="M26 68 L50 26 L74 68 Z" fill="none" stroke="white" strokeWidth={10} strokeLinejoin="round" />
            </svg>
          </span>
          <span className={cn('truncate text-[13px] font-semibold tracking-tight text-ink', collapsed && 'lg:hidden')}>
            Realytica
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11 lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/*
          `overflow-y-auto` clips on both axes, which would cut every tooltip
          off at the rail's edge. Collapsed, the rail is eight items and a
          heading — roughly 330px, shorter than any window this layout runs in
          — so it has nothing to scroll and can let them out. Expanded, the
          labels are already visible and scrolling matters more.
        */}
        <nav className={cn('flex-1 space-y-0.5 px-2 py-3', collapsed ? 'overflow-y-auto lg:overflow-visible' : 'overflow-y-auto')}>
          <NavGroup items={PROJECT_ITEMS} collapsed={collapsed} />
          <NavGroup items={MORE_ITEMS} collapsed={collapsed} heading="More" />
        </nav>

        <div className="border-t border-hairline p-3">
          {forceCollapsed ? null : (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="group relative mb-3 hidden w-full items-center justify-center rounded-lg py-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink lg:flex"
            >
              {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
              {/*
                The way back out of the icon rail was an unlabelled chevron, which
                is a poor thing to have to find when the labels are what you are
                looking for.
              */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-ink-inverse opacity-0 shadow-pop transition-opacity duration-quick ease-state lg:block group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </span>
            </button>
          )}
          <div className={cn('text-mini leading-snug text-ink-muted', collapsed && 'lg:hidden')}>
            <p className="font-medium text-ink-secondary">Project workspace</p>
          </div>
        </div>
      </aside>
    </>
  );
}
