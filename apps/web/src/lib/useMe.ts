import { useEffect, useState } from 'react';
import type { WorkspaceRole } from '@realytica/shared';
import { api } from './api';
import { onAuthChange } from './auth';

/**
 * Who is signed in, as the server says.
 *
 * Read once and shared, because a dozen screens want it and none of them want
 * a request for it. It is deliberately taken from `/members` rather than from
 * the token: the token says who you are, and only the server says what that
 * entitles you to. Hiding a control this way is a courtesy — every refusal
 * that matters happens on the server, so a stale answer here costs a confusing
 * button and never an unauthorised write.
 */
export interface Me {
  email: string;
  name?: string;
  tenantId: string;
  role: WorkspaceRole;
}

let cached: Me | null = null;
let inFlight: Promise<Me | null> | null = null;
const listeners = new Set<(me: Me | null) => void>();

async function load(): Promise<Me | null> {
  if (cached) return cached;
  inFlight ??= api
    .members()
    .then((res) => {
      cached = res.me;
      listeners.forEach((fn) => fn(cached));
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drop the cached answer — after a role change, or a sign-out. */
export function forgetMe(): void {
  cached = null;
  listeners.forEach((fn) => fn(null));
}

// A different person signing in must not inherit the last one's role.
onAuthChange(() => forgetMe());

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(cached);
  useEffect(() => {
    let live = true;
    listeners.add(setMe);
    void load().then((next) => {
      if (live) setMe(next);
    });
    return () => {
      live = false;
      listeners.delete(setMe);
    };
  }, []);
  return me;
}
