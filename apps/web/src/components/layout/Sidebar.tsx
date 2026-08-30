import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Gauge, GitCompare, Info, LayoutDashboard, MessageSquare, ScrollText, X } from 'lucide-react';
import { cn } from '../ui/kit';
import { AmbientField, BrandMark, RampRule } from '../visuals';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end: boolean;
}

/**
 * Grouped, because six flat items is a list and two groups of three is a
 * structure. The split is real rather than cosmetic: the first group is the
 * work — the cases, the intake that makes them, and a comparison across them —
 * and the second is the machinery, which most people open once and never
 * again.
 *
 * The order and the labels are unchanged. Both were argued for separately and
 * neither is the grouping's business:
 *
 *   Your cases first, and the intake named for its job. "Chat" named the
 *   MECHANISM, and sat two rows from a copilot inside every case that is also
 *   a chat and does something entirely different — answering about one file,
 *   with citations. Two nav-level things called chat is how a person ends up
 *   asking which one they are supposed to use.
 */
const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Work',
    items: [
      { to: '/cases', label: 'Your cases', icon: LayoutDashboard, end: false },
      { to: '/app', label: 'Start a case', icon: MessageSquare, end: true },
      { to: '/compare', label: 'Compare', icon: GitCompare, end: false },
    ],
  },
  {
    heading: 'Machinery',
    items: [
      { to: '/observability', label: 'AI activity', icon: Gauge, end: false },
      { to: '/prompts', label: 'AI instructions', icon: ScrollText, end: false },
      { to: '/about', label: 'About', icon: Info, end: false },
    ],
  },
];

/**
 * The left rail.
 *
 * It carries the product's identity on every screen, so it is the one piece of
 * app chrome that gets the full treatment: the ramp along its top edge, a very
 * low ambient field behind it so it is not a flat grey column, and the mark
 * itself at the head rather than a coloured square with a glyph in it.
 *
 * The active item is a ramp rail plus a brand wash plus a glow on the icon.
 * Three signals for one state is deliberate — this is the element a user
 * glances at to answer "where am I", and the previous flat soft-blue fill was
 * routinely mistaken for a hover state that had got stuck.
 *
 * Collapses to an icon rail on large screens (state remembered in localStorage
 * by the parent); becomes an overlay drawer below `lg`.
 */
export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
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

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-[#0a0912]/60 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[228px] shrink-0 flex-col overflow-hidden border-r border-hairline bg-tile-sunken transition-transform duration-200 ease-out',
          'lg:static lg:z-auto lg:translate-x-0',
          collapsed && 'lg:w-[64px]',
          mobileOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full lg:translate-x-0',
        )}
        aria-label="Primary"
      >
        <AmbientField variant="band" className="-z-10" intensity={0.5} />
        <RampRule className="absolute inset-x-0 top-0 z-10" />

        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-hairline px-3">
          <BrandMark size={26} />
          <span className={cn('truncate font-display text-[16px] tracking-tight text-ink', collapsed && 'lg:hidden')}>
            Realytica
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink coarse:p-3 lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.heading} className={cn(gi > 0 && 'mt-5')}>
              <p
                className={cn(
                  'mb-1.5 px-2.5 font-mono text-micro uppercase tracking-[0.14em] text-ink-muted',
                  // Collapsed, the heading has nothing to head — a rule keeps
                  // the grouping visible without a word that would not fit.
                  collapsed && 'lg:mx-2 lg:mb-2 lg:h-px lg:bg-hairline lg:px-0 lg:text-[0px]',
                )}
              >
                {group.heading}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-[13px] font-medium',
                        'transition-[background-color,color] duration-quick ease-state coarse:min-h-11',
                        isActive ? 'bg-brand/12 text-brand' : 'text-ink-secondary hover:bg-brand/6 hover:text-ink',
                        collapsed && 'lg:justify-center lg:px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-ramp" />
                        )}
                        <item.icon
                          size={16}
                          className={cn('shrink-0 transition-colors duration-quick', isActive && 'drop-shadow-[0_0_6px_rgb(var(--brand-rgb)/0.7)]')}
                        />
                        <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-hairline p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mb-3 hidden w-full items-center justify-center rounded-lg py-1.5 text-ink-muted transition-colors hover:bg-brand/8 hover:text-brand lg:flex"
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
          <div className={cn('text-mini leading-snug text-ink-muted', collapsed && 'lg:hidden')}>
            <p className="flex items-center gap-1.5 font-medium text-ink-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-ramp" aria-hidden="true" />
              Property Screen · MVP
            </p>
            <p className="mt-0.5">Diligence / Project / Portfolio — later phases</p>
          </div>
        </div>
      </aside>
    </>
  );
}
