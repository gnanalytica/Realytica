/**
 * App-wide civic map cache: OpenCity lakes/wards (public domain KML) and the
 * withdrawn RMP-2031 PDF index. Kept on disk, clipped per pin. Never evidence.
 *
 * DPPlans tiles are not fetched (paid commercial). GISMaps.in is not fetched
 * (unofficial); GBA wards from OpenCity replace that sitting for overlay.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseNamedPolygons, type NamedRing } from '@realytica/shared';
import { DATA_DIR } from '../storage/filesystem';

const CACHE_DIR = path.join(DATA_DIR, 'gis-context');
const FETCH_MS = 45_000;
const LAYER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'Realytica-gis-context/1.0 (due-diligence OS; OpenCity civic layers as context)';

const LAKES_URL =
  'https://data.opencity.in/dataset/c6f59a91-ac49-4fbf-ad80-0d21e3003263/resource/b45946a5-026d-44f7-96c2-063810e54bb4/download/4c6316b9-0777-44e1-bffb-a6f51f3d34aa.kml';
const WARDS_URL =
  'https://data.opencity.in/dataset/863209cb-4ced-4f51-b5c5-156939c50922/resource/9013d656-8051-4e2d-9648-46efd0d86d3d/download/gba-369-wards-december-2025.kml';
const RMP_2031_PACKAGE = 'https://data.opencity.in/api/3/action/package_show?id=bda-revised-master-plan-2031';

export interface CivicLayerPull {
  lakes: NamedRing[];
  wards: NamedRing[];
  errors: string[];
}

export interface WithdrawnSheet {
  name: string;
  url: string;
}

interface LayerFile {
  fetchedAt: string;
  ok: boolean;
  error?: string;
  rings?: NamedRing[];
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value), 'utf8');
}

function fresh(fetchedAt: string, ttl: number): boolean {
  const age = Date.now() - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

async function loadLayer(id: string, url: string, force?: boolean): Promise<{ rings: NamedRing[]; error?: string }> {
  const file = path.join(CACHE_DIR, `${id}.json`);
  const cached = await readJson<LayerFile>(file);
  if (!force && cached && fresh(cached.fetchedAt, cached.ok ? LAYER_TTL_MS : INDEX_TTL_MS)) {
    return { rings: cached.ok ? cached.rings ?? [] : [], error: cached.ok ? undefined : cached.error };
  }
  const fetchedAt = new Date().toISOString();
  const stale = cached?.ok ? cached.rings ?? [] : [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) {
      const error = `${id} returned ${res.status}`;
      if (stale.length) return { rings: stale, error: `${error} (serving stale cache)` };
      await writeJson(file, { fetchedAt, ok: false, error });
      return { rings: [], error };
    }
    const text = await res.text();
    const rings = parseNamedPolygons(text, id);
    await writeJson(file, { fetchedAt, ok: true, rings });
    return { rings };
  } catch (err) {
    const error = err instanceof Error ? err.message : `${id} fetch failed`;
    if (stale.length) return { rings: stale, error: `${error} (serving stale cache)` };
    await writeJson(file, { fetchedAt, ok: false, error });
    return { rings: [], error };
  }
}

export async function loadCivicLayers(opts?: { force?: boolean }): Promise<CivicLayerPull> {
  const [lakes, wards] = await Promise.all([
    loadLayer('opencity_lakes', LAKES_URL, opts?.force),
    loadLayer('opencity_gba_wards', WARDS_URL, opts?.force),
  ]);
  const errors = [lakes.error, wards.error].filter((e): e is string => Boolean(e));
  return { lakes: lakes.rings, wards: wards.rings, errors };
}

export async function loadWithdrawnRmpSheets(opts?: { force?: boolean }): Promise<WithdrawnSheet[]> {
  const file = path.join(CACHE_DIR, 'opencity_rmp2031_index.json');
  if (!opts?.force) {
    const cached = await readJson<{ fetchedAt: string; ok: boolean; sheets?: WithdrawnSheet[] }>(file);
    if (cached && fresh(cached.fetchedAt, INDEX_TTL_MS) && cached.ok) return cached.sheets ?? [];
  }
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(RMP_2031_PACKAGE, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) {
      await writeJson(file, { fetchedAt, ok: false });
      return [];
    }
    const body = (await res.json()) as {
      result?: { resources?: Array<{ name?: string; url?: string; format?: string }> };
    };
    const sheets = (body.result?.resources ?? [])
      .filter((r) => typeof r.name === 'string' && typeof r.url === 'string' && /pdf/i.test(r.format ?? 'pdf'))
      .map((r) => ({ name: r.name as string, url: r.url as string }));
    await writeJson(file, { fetchedAt, ok: true, sheets });
    return sheets;
  } catch {
    await writeJson(file, { fetchedAt, ok: false });
    return [];
  }
}

/** Warm the app-wide civic cache. Failures stay on disk; overlay still runs. */
export async function ingestCivicLayers(opts?: { force?: boolean }): Promise<{ lakes: number; wards: number; sheets: number; errors: string[] }> {
  const civic = await loadCivicLayers(opts);
  const sheets = await loadWithdrawnRmpSheets(opts);
  return { lakes: civic.lakes.length, wards: civic.wards.length, sheets: sheets.length, errors: civic.errors };
}
