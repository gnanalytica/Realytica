import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, FilePlus2, Gauge, GitCompare, Info, LayoutDashboard, ScrollText, X } from 'lucide-react';
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
  icon: typeof LayoutDashboard;
  end: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cases/new', label: 'New case', icon: FilePlus2, end: false },
  { to: '/compare', label: 'Compare', icon: GitCompare, end: false },
  { to: '/observability', label: 'Model ops', icon: Gauge, end: false },
  { to: '/prompts', label: 'Prompts', icon: ScrollText, end: false },
  { to: '/about', label: 'About', icon: Info, end: false },
];

/**
 * Fixed left navigation. Collapses to an icon rail on large screens (state
 * remembered in localStorage by the parent); becomes an overlay drawer below `lg`.
 */
export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
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
            Valytica
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:bg-sunken hover:text-ink',
                  collapsed && 'lg:justify-center lg:px-0',
                )
              }
            >
              <item.icon size={16} className="shrink-0" />
              <span className={cn(collapsed && 'lg:hidden')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-hairline p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mb-3 hidden w-full items-center justify-center rounded-lg py-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink lg:flex"
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
          <div className={cn('text-[11px] leading-snug text-ink-muted', collapsed && 'lg:hidden')}>
            <p className="font-medium text-ink-secondary">Property Screen · MVP</p>
            <p className="mt-0.5">Diligence / Project / Portfolio — later phases</p>
          </div>
        </div>
      </aside>
    </>
  );
}
