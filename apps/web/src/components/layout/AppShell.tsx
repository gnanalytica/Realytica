import { Suspense, useEffect, useState } from 'react';
import { AreaUnitProvider } from '../../lib/units';
import { readPref, writePref } from '../../lib/prefs';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { Outlet, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from './ErrorBoundary';
import { Spinner } from '../ui/kit';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

/**
 * Shown while a lazily-loaded screen arrives.
 *
 * A spinner rather than a skeleton: a skeleton claims to know the shape of
 * what is coming, and these routes have nothing in common with each other.
 * It fades in rather than appearing, so a chunk that lands in 40ms reads as
 * an instant navigation instead of a flash of loading state.
 */
function PaneLoading() {
  return (
    <div className="flex min-h-[40vh] animate-fade-in items-center justify-center">
      <Spinner size={18} />
    </div>
  );
}

function readStoredCollapsed(): boolean {
  return readPref(SIDEBAR_STORAGE_KEY) === '1';
}

/**
 * Two-column app frame: fixed/collapsible sidebar + sticky top bar + routed content.
 * Nothing in this tree scrolls the page horizontally — wide content scrolls in its own box.
 */
export default function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // Close the mobile drawer automatically whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Crossing to desktop leaves the overlay mounted unless we dismiss it.
  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writePref(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const projectWorkspace = /^\/projects\/(?!new(?:\/|$))[^/]+/.test(location.pathname);

  return (
    <AreaUnitProvider>
    <div className="flex min-h-full min-w-0">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        <TopBar onOpenMobile={() => setMobileOpen(true)} />
        <main className={projectWorkspace ? 'min-h-0 min-w-0 flex-1 overflow-hidden p-0' : 'min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8'}>
          <div className={projectWorkspace ? 'h-full min-h-0 w-full' : 'mx-auto w-full max-w-[1400px]'}>
            {/* Inside the shell, not around it: a pane that throws leaves the
                sidebar and top bar standing, so the way out is a click away.
                The same boundary catches a route chunk that fails to load —
                a deploy mid-session invalidates the old chunk names, and
                "this screen could not be drawn, try again" is the right
                answer to that. */}
            <RouteErrorBoundary>
              <Suspense fallback={<PaneLoading />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </div>
    </AreaUnitProvider>
  );
}
