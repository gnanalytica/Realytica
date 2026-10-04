import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../../lib/api';
import { applyTheme, getStoredTheme, type ThemeMode } from '../../lib/theme';
import { Dot, Tooltip, cn } from '../ui/kit';
import ProjectSwitcher from './ProjectSwitcher';

export interface TopBarProps {
  onOpenMobile: () => void;
  /** Leave the header to the page below the large breakpoint (a project's cockpit has its own). */
  desktopOnly?: boolean;
}

/**
 * Where a project puts its own controls in this bar: the selector that says
 * where in the project you are, the stage track, and what needs attention.
 *
 * A project used to draw a second bar of its own under this one, which made
 * two rows of chrome and eight controls before any work. The project's
 * workspace fills this element instead (through a portal), so the bar stays
 * one row and this component still knows nothing about a project.
 */
export const PROJECT_BAR_SLOT = 'project-bar-slot';

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/projects')) return '';
  if (pathname.startsWith('/libraries')) return 'Libraries';
  if (pathname.startsWith('/about')) return 'About Realytica';
  if (pathname.startsWith('/portfolio')) return 'Portfolio';
  if (pathname.startsWith('/requests')) return 'Requests';
  if (pathname.startsWith('/members')) return 'People';
  if (pathname.startsWith('/work')) return 'My work';
  return 'Realytica';
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

type ApiStatus = 'checking' | 'online' | 'offline';

/** Sticky top bar: route title, an API health check that retries until it answers, and the theme cycle control. */
export default function TopBar({ onOpenMobile, desktopOnly = false }: TopBarProps) {
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  /*
   * Checked until it answers, not once.
   *
   * A single failed probe — a cold start, a deploy rolling over, the dev
   * server restarting on a save — used to leave "API offline" pinned to
   * every page for the rest of the visit while every request underneath it
   * was succeeding. Offline now keeps asking, backing off, and clears itself
   * the moment the API is back.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = 3000;
    const probe = () => {
      api.health().then(
        () => {
          if (!cancelled) setApiStatus('online');
        },
        () => {
          if (cancelled) return;
          setApiStatus('offline');
          timer = setTimeout(probe, wait);
          wait = Math.min(wait * 2, 30000);
        },
      );
    };
    probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    applyTheme(next);
  }

  // One project's workspace, as against the list of projects or the form for a new one.
  const inProject = /^\/projects\/(?!new(?:\/|$))[^/]+/.test(location.pathname);
  const ThemeIcon = THEME_ICON[theme];
  const healthLabel =
    apiStatus === 'offline'
      ? import.meta.env.DEV
        ? 'API offline — start it with `pnpm dev:api`'
        : 'Cannot reach the server — retrying.'
      : apiStatus === 'checking'
        ? 'Checking API…'
        : 'API online';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-14 shrink-0 items-center gap-2 border-b border-hairline px-3 sm:gap-3 sm:px-6 lg:px-8',
        /*
         * Solid inside a project, glass elsewhere. Nothing scrolls under the
         * bar in a project's workspace, so the blur would show nothing; and a
         * backdrop filter makes the bar the frame for anything fixed inside
         * it, which would shrink the alerts' click-away layer to the bar.
         */
        inProject ? 'bg-surface' : 'bg-surface/90 backdrop-blur-md',
        desktopOnly ? 'hidden lg:flex' : 'flex',
      )}
    >
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        /* The button that opens navigation on a phone measured 29px. It is
           the one control a touch user cannot route around. */
        className="-ml-1 rounded-lg p-1.5 text-ink-secondary hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11 lg:hidden"
      >
        <Menu size={17} />
      </button>

      {inProject ? (
        <>
          <div className="min-w-0 max-w-[22rem] shrink">
            <ProjectSwitcher />
          </div>
          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-hairline lg:block" />
          <div id={PROJECT_BAR_SLOT} className="hidden min-w-0 flex-1 items-center gap-3 lg:flex" />
        </>
      ) : location.pathname.startsWith('/projects') ? (
        <div className="min-w-0 flex-1">
          <ProjectSwitcher />
        </div>
      ) : (
        /* Where you are, quietly: every page below carries its own heading, so
           this is a breadcrumb rather than a second title. */
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-muted">{pageTitle(location.pathname)}</p>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {/*
          Silent while healthy.

          A permanent green "API online" pill on every page, for every user, is
          an ops dashboard leaking into a product: it tells a valuer something
          they cannot act on and have no reason to think about, and it spends
          the one piece of always-visible chrome saying "nothing is wrong". The
          state worth interrupting somebody for is the other one, and that is
          the only one that now appears — with `aria-live` so it is announced
          when it does, rather than sitting in the tab order announcing health.
        */}
        {apiStatus === 'offline' ? (
          <Tooltip label={healthLabel}>
            <span
              className="flex items-center gap-1.5 rounded-full bg-critical/10 px-2 py-1 text-mini font-medium text-critical ring-1 ring-inset ring-critical/40"
              aria-live="polite"
            >
              <Dot tone="critical" />
              <span className="hidden sm:inline">API offline</span>
            </span>
          </Tooltip>
        ) : null}
        <button
          type="button"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Click to change.`}
          title={`Theme: ${THEME_LABEL[theme]}`}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-sunken hover:text-ink coarse:h-11 coarse:w-11',
            // Inside a project it stands in a row of plain icons (alerts, command, focus) and dresses as one of them.
            !inProject && 'ring-1 ring-inset ring-[var(--ring)]',
          )}
        >
          <ThemeIcon size={15} />
        </button>
      </div>
    </header>
  );
}
