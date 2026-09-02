import { useEffect, useState } from 'react';
import type { WorkPerson } from '@realytica/shared';
import { api } from './api';

/**
 * Everybody in this workspace, for the screens that need to offer a person.
 *
 * Read once and shared, like `useMe`. A failure is silent and returns nothing,
 * because every caller is offering a suggestion rather than gating on one: an
 * owner field with no list is the field as it was before this existed, which is
 * a fine thing to fall back to.
 */
let cached: WorkPerson[] | null = null;
let inFlight: Promise<WorkPerson[]> | null = null;

async function load(): Promise<WorkPerson[]> {
  if (cached) return cached;
  inFlight ??= api
    .members()
    .then((res) => {
      cached = res.members.map((m) => ({ email: m.email, name: m.name }));
      return cached;
    })
    .catch(() => [])
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function forgetRoster(): void {
  cached = null;
}

export function useRoster(): WorkPerson[] {
  const [roster, setRoster] = useState<WorkPerson[]>(cached ?? []);
  useEffect(() => {
    let live = true;
    void load().then((next) => {
      if (live) setRoster(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return roster;
}
