/**
 * Where the phone is, for tagging photos and the day's entry.
 *
 * Never blocks the work: if location is refused, switched off or slow (deep
 * inside a concrete frame, say), the entry is saved without it and the screen
 * says so. A recent fix is used straight away while a fresh one is sought.
 */
import * as Location from 'expo-location';

import type { GeoPoint } from './types';

export type Fix =
  | { ok: true; point: GeoPoint; accuracy: number | null; at: string }
  | { ok: false; reason: 'denied' | 'off' | 'unavailable' };

interface Options {
  /** Ask for permission if not yet decided (default true). */
  ask?: boolean;
  timeoutMs?: number;
}

export async function currentFix({ ask = true, timeoutMs = 20_000 }: Options = {}): Promise<Fix> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted' && ask) status = (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, reason: 'denied' };
    if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'off' };

    const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then(toFix)
      .catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const fix = await Promise.race([fresh, timeout]);
    clearTimeout(timer);
    if (fix) return fix;

    // No fresh fix in time: a position from the last few minutes is still the same site.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 }).catch(() => null);
    return last ? toFix(last) : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

function toFix(pos: Location.LocationObject): Fix {
  return {
    ok: true,
    point: { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) },
    accuracy: pos.coords.accuracy ?? null,
    at: new Date(pos.timestamp).toISOString(),
  };
}

/** Six decimal places is about 10 cm: more than GPS can promise, and short enough to read. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Metres between two points (haversine). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function describeDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function isValidPoint(p: Partial<GeoPoint> | null | undefined): p is GeoPoint {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    // 0,0 is what a camera with no fix writes, not a building site in the Gulf of Guinea.
    !(p.lat === 0 && p.lng === 0)
  );
}
