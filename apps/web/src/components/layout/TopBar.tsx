import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../../lib/api';
import { applyTheme, getStoredTheme, type ThemeMode } from '../../lib/theme';
import { Dot, Tooltip } from '../ui/kit';
import ProjectSwitcher from './ProjectSwitcher';

export interface TopBarProps {
  onOpenMobile: () => void;
}

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/projects')) return '';
  if (pathname.startsWith('/libraries')) return 'Libraries';
  if (pathname.startsWith('/about')) return 'About Realytica';
  if (pathname.startsWith('/observability')) return 'AI activity';
  if (pathname.startsWith('/prompts')) return 'AI instructions';
  return 'Realytica';
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

type ApiStatus = 'checking' | 'online' | 'offline';

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
  const healthLabel =
    apiStatus === 'offline'
      ? 'API offline — start it with `pnpm dev:api`'
      : apiStatus === 'checking'
        ? 'Checking API…'
        : 'API online';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface/95 px-3 backdrop-blur-sm sm:gap-3 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        className="-ml-1 rounded-lg p-1.5 text-ink-secondary hover:bg-sunken hover:text-ink lg:hidden"
      >
        <Menu size={17} />
      </button>

      {location.pathname.startsWith('/projects') ? (
        <div className="min-w-0 flex-1">
          <ProjectSwitcher />
        </div>
      ) : (
        <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-ink">{pageTitle(location.pathname)}</h1>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <Tooltip label={healthLabel}>
          <span
            className="flex items-center gap-1.5 rounded-full bg-sunken px-2 py-1 text-mini font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
            aria-live="polite"
          >
            <Dot tone={apiStatus === 'offline' ? 'critical' : apiStatus === 'checking' ? 'neutral' : 'good'} />
            <span className="hidden sm:inline">
              {apiStatus === 'offline' ? 'API offline' : apiStatus === 'checking' ? 'Checking API' : 'API online'}
            </span>
          </span>
        </Tooltip>
        <button
          type="button"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Click to change.`}
          title={`Theme: ${THEME_LABEL[theme]}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary ring-1 ring-inset ring-[var(--ring)] transition-colors hover:bg-sunken hover:text-ink"
        >
          <ThemeIcon size={15} />
        </button>
      </div>
    </header>
  );
}
