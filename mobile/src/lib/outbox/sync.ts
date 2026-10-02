/**
 * When the outbox is sent: as soon as something is saved, whenever the app
 * comes to the front, the moment the connection comes back, and every 60
 * seconds while the app is open. Only one run happens at a time; a trigger
 * that arrives mid-run joins the run already going.
 */
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { photoForm } from '../photos';
import { queryClient } from '../query';
import { currentPairing, handleUnauthorized } from '../session';
import { runSync, type EngineDeps, type SyncOptions, type SyncReport } from './engine';
import { outboxItems, removeItem, updateItem } from './store';

export interface SyncStatus {
  running: boolean;
  /** The item on its way to the server now. */
  sendingId: string | null;
  lastRunAt?: string;
  /** When something last reached the server. */
  lastSentAt?: string;
  lastReport?: SyncReport;
}

let status: SyncStatus = { running: false, sendingId: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function syncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    syncStatus,
    syncStatus,
  );
}

const deps: EngineDeps = {
  pairing: () => {
    const p = currentPairing();
    return p ? { server: p.server, token: p.token, email: p.person.email } : null;
  },
  items: outboxItems,
  update: updateItem,
  remove: (id) => removeItem(id),
  photoForm,
  onUnauthorized: (token) => handleUnauthorized(token),
  onSent: (item) => {
    setStatus({ lastSentAt: new Date().toISOString() });
    void queryClient.invalidateQueries({ queryKey: ['site', item.projectId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
  onProgress: (id) => setStatus({ sendingId: id }),
};

let inFlight: Promise<SyncReport> | null = null;

/**
 * Send what is waiting. Automatic triggers share a run already in progress;
 * a request from the person ("Send now", "Try again") waits for it and then
 * runs again with their options, so it is never silently swallowed.
 */
export function syncNow(opts: SyncOptions = {}): Promise<SyncReport> {
  const asked = !!(opts.includeHeld || opts.only);
  if (inFlight) return asked ? inFlight.then(() => syncNow(opts)) : inFlight;
  const run = (async (): Promise<SyncReport> => {
    setStatus({ running: true });
    try {
      const report = await runSync(deps, opts);
      setStatus({ lastReport: report });
      return report;
    } catch (err) {
      // Only the phone's own storage can fail here (the engine reports network trouble itself).
      // Callers get a report either way, never a rejected promise.
      const report: SyncReport = { sent: 0, refused: 0, waiting: 0, lastError: `Could not update the outbox on this phone: ${(err as Error).message}` };
      setStatus({ lastReport: report });
      return report;
    } finally {
      setStatus({ running: false, sendingId: null, lastRunAt: new Date().toISOString() });
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}

/** Start the triggers. Returns a function that stops them. */
export function startSyncLoop(): () => void {
  void syncNow();

  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncNow();
  });

  let online: boolean | null = null;
  const net = NetInfo.addEventListener((s) => {
    const now = s.isConnected !== false && s.isInternetReachable !== false;
    if (now && online === false) void syncNow();
    online = now;
  });

  const timer = setInterval(() => {
    // Only while the app is in front: a background timer is not something phones allow anyway.
    if (Platform.OS === 'web' || AppState.currentState === 'active') void syncNow();
  }, 60_000);

  return () => {
    app.remove();
    net();
    clearInterval(timer);
  };
}
