import { useEffect, useState } from 'react';
import { AreaUnitProvider } from '../../lib/units';
import { readPref, writePref } from '../../lib/prefs';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { AmbientField } from '../visuals';

const SIDEBAR_STORAGE_KEY = 'sidebarCollapsed';

function readStoredCollapsed(): boolean {
  return readPref(SIDEBAR_STORAGE_KEY) === '1';
}

/**
 * Two-column app frame: collapsible sidebar + sticky top bar + routed content.
 * Nothing in this tree scrolls the page horizontally — wide content scrolls in
 * its own box.
 *
 * Two things were added when the app got a visual system:
 *
 *  - An ambient field behind the content column, fixed rather than scrolling.
 *    It is what stops a workspace with four cards on it from being four cards
 *    on nothing, and being fixed means it does not travel with the page, which
 *    would turn a background into a moving object.
 *
 *  - A route transition. `key` on the pathname remounts the outlet, so every
 *    navigation gets one short entrance instead of the content simply being
 *    different on the next frame. It is 240ms and it is the difference between
 *    "the page changed" and "I changed the page".
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
    setCollapsed(prev => {
      const next = !prev;
      writePref(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <AreaUnitProvider>
      <div className="flex min-h-full min-w-0">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="relative flex min-h-full min-w-0 flex-1 flex-col">
          {/* Fixed, not absolute: an ambient field that scrolls with the page
              stops being ambient and becomes a very large slow-moving object. */}
          <AmbientField variant="band" className="fixed inset-0 -z-10" intensity={0.45} />
          <TopBar onOpenMobile={() => setMobileOpen(true)} />
          <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
            <div key={location.pathname} className="mx-auto w-full max-w-[1400px] animate-rise-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </AreaUnitProvider>
  );
}
