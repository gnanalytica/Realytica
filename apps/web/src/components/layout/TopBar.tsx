import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  FolderPlus,
  Gauge,
  GitCompare,
  Info,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  ScrollText,
  Sun,
} from 'lucide-react';
import { api } from '../../lib/api';
import { applyTheme, getStoredTheme, type ThemeMode } from '../../lib/theme';
import { Tooltip, cn } from '../ui/kit';
import { RampRule } from '../visuals';

export interface TopBarProps {
  onOpenMobile: () => void;
}

/**
 * Route → title and icon, in the same words the sidebar uses.
 *
 * The icon is not decoration: the bar is 14px of type on a page that can be
 * six thousand pixels long, and a glyph is recognised at a glance where a word
 * has to be read.
 *
 * The titles matter more than they look. `/app` was titled "Dashboard" here
 * while the sidebar called it "Start a case" and the page itself is a
 * conversation — three names for one screen, which is the kind of drift a
 * route table collects when nobody owns it. Every title below is the sidebar's
 * label verbatim, so there is one name per destination.
 */
const ROUTES: { match: (p: string) => boolean; title: string; icon: typeof Info }[] = [
  { match: p => p === '/app', title: 'Start a case', icon: MessageSquare },
  { match: p => p.startsWith('/cases/new'), title: 'New property case', icon: FolderPlus },
  { match: p => /^\/cases\/[^/]+/.test(p), title: 'Case cockpit', icon: LayoutDashboard },
  { match: p => p.startsWith('/cases'), title: 'Your cases', icon: LayoutDashboard },
  { match: p => p.startsWith('/compare'), title: 'Compare', icon: GitCompare },
  { match: p => p.startsWith('/observability'), title: 'AI activity', icon: Gauge },
  { match: p => p.startsWith('/prompts'), title: 'AI instructions', icon: ScrollText },
  { match: p => p.startsWith('/about'), title: 'About', icon: Info },
];

function routeFor(pathname: string) {
  return ROUTES.find(r => r.match(pathname)) ?? { title: 'Realytica', icon: Info };
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

type ApiStatus = 'checking' | 'online' | 'offline';

const STATUS_STYLE: Record<ApiStatus, { dot: string; chip: string; label: string; long: string }> = {
  checking: { dot: 'bg-[var(--axis)]', chip: 'ring-[var(--ring)] text-ink-secondary', label: 'Checking API', long: 'Checking API…' },
  online: { dot: 'bg-good', chip: 'ring-good/40 text-[var(--status-good-text)]', label: 'API online', long: 'API online' },
  offline: {
    dot: 'bg-critical',
    chip: 'ring-critical/45 text-critical',
    label: 'API offline',
    long: 'API offline — start it with `pnpm dev:api`',
  },
};

/** Sticky top bar: route title, one-shot API health check, and the theme cycle control. */
export default function TopBar({ onOpenMobile }: TopBarProps) {
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    api.health().then(
      () => {
        if (!cancelled) setApiStatus('online');
      },
      () => {
        if (!cancelled) setApiStatus('offline');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    applyTheme(next);
  }

  const ThemeIcon = THEME_ICON[theme];
  const route = routeFor(location.pathname);
  const RouteIcon = route.icon;
  const status = STATUS_STYLE[apiStatus];

  return (
    // `glass` rather than a flat translucent fill: content scrolls under this
    // bar, and a plain 95% white strip turns whatever passes beneath it into
    // grey mush. The blur keeps the colour and loses the detail, which is the
    // right way round.
    <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline glass px-4 sm:px-6 lg:px-8">
      <RampRule className="absolute inset-x-0 top-0" />

      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        className="-ml-1 rounded-lg p-1.5 text-ink-secondary hover:bg-brand/10 hover:text-brand coarse:p-3 lg:hidden"
      >
        <Menu size={17} />
      </button>

      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand/12 text-brand" aria-hidden="true">
          <RouteIcon size={13} />
        </span>
        <h1 className="min-w-0 truncate text-[14px] font-semibold tracking-tight text-ink">{route.title}</h1>
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <Tooltip label={status.long}>
          <span
            className={cn('flex items-center gap-1.5 rounded-full bg-surface/70 px-2 py-1 text-mini font-medium ring-1 ring-inset', status.chip)}
            aria-live="polite"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {/*
                * A live pulse while the health check is in flight, and only
                * then. A dot that pulses forever is decoration; one that
                * pulses while something is genuinely outstanding is status.
                */}
              {apiStatus === 'checking' && <span className={cn('absolute inset-0 animate-ping rounded-full', status.dot)} />}
              <span className={cn('relative h-2 w-2 rounded-full', status.dot)} />
            </span>
            <span className="hidden sm:inline">{status.label}</span>
          </span>
        </Tooltip>
        <button
          type="button"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Click to change.`}
          title={`Theme: ${THEME_LABEL[theme]}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary ring-1 ring-inset ring-[var(--ring)] transition-colors hover:bg-brand/10 hover:text-brand coarse:h-11 coarse:w-11"
        >
          <ThemeIcon size={15} />
        </button>
      </div>
    </header>
  );
}
