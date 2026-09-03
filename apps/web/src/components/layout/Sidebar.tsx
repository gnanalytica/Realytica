import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, BookOpen, CircleCheck, FolderTree, Gauge, Info, ScrollText, Users, Workflow, X } from 'lucide-react';
import { cn } from '../ui/kit';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof FolderTree;
  end: boolean;
}

const PROJECT_ITEMS: NavItem[] = [
  // First, above Projects, because it is the question somebody opens this
  // app to answer and the projects list does not answer it.
  { to: '/work', label: 'My work', icon: CircleCheck, end: false },
  { to: '/projects', label: 'Projects', icon: FolderTree, end: false },
  { to: '/libraries', label: 'Libraries', icon: BookOpen, end: false },
];

const MORE_ITEMS: NavItem[] = [
  { to: '/flows', label: 'Automations', icon: Workflow, end: false },
  { to: '/members', label: 'Workspace', icon: Users, end: false },
  { to: '/observability', label: 'AI activity', icon: Gauge, end: false },
  { to: '/prompts', label: 'AI instructions', icon: ScrollText, end: false },
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
  return (
    <>
      {heading ? (
        <p className={cn('px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted', collapsed && 'lg:hidden')}>
          {heading}
        </p>
      ) : null}
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
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium',
              'transition-[background-color,color] duration-quick ease-state',
              isActive
                ? 'bg-brand-soft text-brand before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-brand'
                : 'text-ink-secondary hover:bg-sunken hover:text-ink',
              collapsed && 'lg:justify-center lg:px-0',
            )
          }
        >
          <item.icon size={16} className="shrink-0" />
          <span className={cn(collapsed && 'lg:hidden')}>{item.label}</span>
          {/*
            An eight-icon rail with no words is a memory test, and the browser's
            own `title` is the wrong answer to it: it waits about a second, which
            is longer than it takes to give up and click the icon to find out.
            This one appears on hover and on keyboard focus, immediately.

            `aria-hidden` because the link is already named above — a screen
            reader that read both would say every item twice.
          */}
          {collapsed ? (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap',
                'rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-ink-inverse opacity-0 shadow-pop',
                'transition-opacity duration-quick ease-state',
                'lg:block group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              {item.label}
            </span>
          ) : null}
        </NavLink>
      ))}
    </>
  );
}

/**
 * Fixed left navigation. Collapses to an icon rail on large screens (state
 * remembered in localStorage by the parent); becomes an overlay drawer below `lg`.
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
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[220px] shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 ease-out',
          'lg:static lg:z-auto lg:translate-x-0',
          collapsed && 'lg:w-[64px]',
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
            className="ml-auto rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink coarse:p-3 lg:hidden"
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
          <div className={cn('text-mini leading-snug text-ink-muted', collapsed && 'lg:hidden')}>
            <p className="font-medium text-ink-secondary">Due diligence OS</p>
          </div>
        </div>
      </aside>
    </>
  );
}
