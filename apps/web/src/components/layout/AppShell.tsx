import { useEffect, useState } from 'react';
import { AreaUnitProvider } from '../../lib/units';
import { readPref, writePref } from '../../lib/prefs';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

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

  // Close the mobile drawer automatically whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writePref(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const cockpit = location.pathname.includes('/cockpit');

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
        <main className={cockpit ? 'min-h-0 min-w-0 flex-1 overflow-hidden p-0' : 'min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8'}>
          <div className={cockpit ? 'h-full min-h-0 w-full' : 'mx-auto w-full max-w-[1400px]'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </AreaUnitProvider>
  );
}
