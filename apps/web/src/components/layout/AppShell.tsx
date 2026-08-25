import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const SIDEBAR_STORAGE_KEY = 'valytica.sidebarCollapsed';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    /* storage blocked — default to expanded */
    return false;
  }
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
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage blocked — collapse state just won't persist across reloads */
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-full min-w-0">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        <TopBar onOpenMobile={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
