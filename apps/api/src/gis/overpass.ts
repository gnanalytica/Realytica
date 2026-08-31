/**
 * OpenStreetMap context around a pin — volunteer geometry, not statute.
 *
 * Cached on disk like the reference shelf. Never written to the evidence
 * register or the project graph. Failed fetches are remembered briefly so a
 * down Overpass instance does not stall every overlay open.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GIS_OVERLAY_RADIUS_M, osmElementsToFeatures, type GisContextFeature, type OsmElementLike } from '@realytica/shared';
import { readEnv } from '@realytica/agents';
import { DATA_DIR } from '../storage/filesystem';

const CACHE_DIR = path.join(DATA_DIR, 'gis-context');
const FETCH_MS = 20_000;
const OK_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'Realytica-gis-context/1.0 (due-diligence OS; OSM as context, not evidence)';

export interface OsmContextPull {
  features: GisContextFeature[];
  fetchedAt?: string;
  error?: string;
  cache: 'fresh' | 'hit' | 'miss';
}

interface CacheRow {
  fetchedAt: string;
  ok: boolean;
  error?: string;
  elements?: OsmElementLike[];
}

function overpassUrl(): string {
  return readEnv('REALYTICA_OVERPASS_URL') || DEFAULT_URL;
}

function cacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(4)}_${lng.toFixed(4)}_${radiusM}`;
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function bboxAround(lat: number, lng: number, radiusM: number): { south: number; west: number; north: number; east: number } {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - dLat,
    west: lng - dLng,
    north: lat + dLat,
    east: lng + dLng,
  };
}

function queryFor(lat: number, lng: number, radiusM: number): string {
  const b = bboxAround(lat, lng, radiusM);
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:20];
(
  way["natural"="water"](${box});
  way["landuse"="reservoir"](${box});
  way["landuse"="basin"](${box});
  way["waterway"](${box});
  way["landuse"](${box});
);
out geom;`;
}

async function readCache(key: string): Promise<CacheRow | undefined> {
  try {
    return JSON.parse(await readFile(cachePath(key), 'utf8')) as CacheRow;
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, row: CacheRow): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(key), JSON.stringify(row), 'utf8');
}

function stillFresh(row: CacheRow, now: number): boolean {
  const age = now - Date.parse(row.fetchedAt);
  if (!Number.isFinite(age) || age < 0) return false;
  return age < (row.ok ? OK_TTL_MS : FAIL_TTL_MS);
}

export async function fetchOsmContext(
  pin: { lat: number; lng: number },
  options?: { radiusM?: number; force?: boolean },
): Promise<OsmContextPull> {
  const radiusM = options?.radiusM ?? GIS_OVERLAY_RADIUS_M;
  const key = cacheKey(pin.lat, pin.lng, radiusM);
  const now = Date.now();
  if (!options?.force) {
    const cached = await readCache(key);
    if (cached && stillFresh(cached, now)) {
      return {
        features: cached.ok ? osmElementsToFeatures(cached.elements ?? []) : [],
        fetchedAt: cached.fetchedAt,
        error: cached.ok ? undefined : cached.error,
        cache: 'hit',
      };
    }
  }

  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(overpassUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(queryFor(pin.lat, pin.lng, radiusM))}`,
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) {
      const error = `Overpass returned ${res.status}`;
      await writeCache(key, { fetchedAt, ok: false, error });
      return { features: [], fetchedAt, error, cache: 'fresh' };
    }
    const body = (await res.json()) as { elements?: OsmElementLike[] };
    const elements = Array.isArray(body.elements) ? body.elements : [];
    await writeCache(key, { fetchedAt, ok: true, elements });
    return { features: osmElementsToFeatures(elements), fetchedAt, cache: 'fresh' };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Overpass fetch failed';
    await writeCache(key, { fetchedAt, ok: false, error });
    return { features: [], fetchedAt, error, cache: 'fresh' };
  }
}
