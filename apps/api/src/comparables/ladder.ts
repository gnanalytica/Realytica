/**
 * Which (locality, city) pages a portal is asked for, in what order — and the
 * portal's own spelling of the locality, asked for first.
 *
 * Portals resolve a locality only inside a city, and file a village under the
 * metro thirty kilometres away. Neither half is reliably on the file, so both
 * ladders are walked and the pair is the unit of a lookup. A wrong guess is
 * safe: the adapters require the portal to report the locality it searched,
 * and the ranking applies a hard radius from the subject's real point, so a
 * bad pair finds nothing rather than something from the wrong place.
 *
 * Ported from Valytica, where every rule here was learnt against live pages.
 */

import { canonicalPortalCityName, isPortalCityName, type ComparableQuery } from '@realytica/shared';
import { haversineMetres } from '@realytica/shared';
import { AllVendorsUnavailable, unblockedFetch } from './unblocker';

/** `cityLevel`: the town's own page, for a subject whose locality is the town. */
export interface LocalityCityPair {
  locality: string;
  city: string;
  cityLevel?: boolean;
}

/** How many search pages an adapter served — zero means it was never reached, not that it had nothing. */
export interface AdapterOpts {
  onPagesResolved?: (n: number) => void;
}

/** A ceiling on paid requests per portal per search; about ₹2 a search at Zyte's rate. */
export const MAX_PAIRS = 8;

export function localityCityPairs(query: ComparableQuery): LocalityCityPair[] {
  const out: LocalityCityPair[] = [];
  const seen = new Set<string>();
  const push = (locality: string, city: string, cityLevel?: boolean): boolean => {
    const key = `${locality.toLowerCase()}|${city.toLowerCase()}|${cityLevel ? 'c' : 'l'}`;
    if (seen.has(key)) return true;
    seen.add(key);
    out.push(cityLevel ? { locality, city, cityLevel } : { locality, city });
    return out.length < MAX_PAIRS;
  };
  // The portal's own spelling and filing lead.
  for (const pair of query.resolvedPairs ?? []) if (!push(pair.locality, pair.city)) return out;
  const cities = query.cityCandidates.length ? query.cityCandidates : query.city ? [query.city] : [];
  if (!cities.length || !query.localityCandidates.length) return out;
  // City filing is portal-specific while the locality name is not, so the
  // resolver's name is crossed with the guessed cities too.
  for (const pair of query.resolvedPairs ?? []) {
    for (const city of cities) {
      if (pair.locality.toLowerCase() === city.toLowerCase()) continue;
      if (!push(pair.locality, city)) return out;
    }
  }
  for (const locality of query.localityCandidates) {
    if (isPortalCityName(locality)) continue;
    for (const city of cities) {
      if (locality.toLowerCase() === city.toLowerCase()) continue;
      if (!push(locality, city)) return out;
    }
  }
  // A town subject: its own city-level page is the local market. Not for a metro — that page is the whole metro.
  const subjectIsUrban = query.city != null && isPortalCityName(query.city);
  for (const city of cities) {
    const canonical = canonicalPortalCityName(city);
    const isOwnTown = query.localityCandidates.some((l) => canonicalPortalCityName(l).toLowerCase() === canonical.toLowerCase());
    if (!isOwnTown && (subjectIsUrban || isPortalCityName(canonical))) continue;
    if (!push(canonical, canonical, true)) return out;
  }
  return out;
}

/* ==================================================================== */
/* Asking the portal what it calls the place                              */
/* ==================================================================== */

/** A same-named place this far away is somewhere else. Generous: the radius gate is the real fence. */
const MAX_RESOLVE_KM = 100;
const MAX_RESOLVE_CALLS = 2;
const RETRY_DELAYS_MS = [400, 1_200] as const;
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

interface Suggestion {
  locality: string;
  city: string;
  lat: number | null;
  lng: number | null;
  rfnum: string;
}

/* MagicBricks' public autosuggest: LOCATION rows only, "Kothagudem, Khammam" -> the city is the tail. */
export function parseSuggestions(body: string): Suggestion[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = (json as { locationMap?: { LOCATION?: unknown } })?.locationMap?.LOCATION;
  if (!Array.isArray(rows)) return [];
  const out: Suggestion[] = [];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const parts = (typeof row.result === 'string' ? row.result : '').split(',').map((p) => p.trim()).filter(Boolean);
    const locality = typeof row.psmName === 'string' && row.psmName.trim() ? row.psmName.trim() : parts[0];
    const city = parts.length >= 2 ? parts[parts.length - 1] : null;
    const rfnum = typeof row.rfnum === 'string' ? row.rfnum : String(row.rfnum ?? '');
    if (!locality || !city || !rfnum) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    out.push({ locality, city, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, rfnum });
  }
  return out;
}

/* Nearest within range — except that an exact name beats a nearer fuzzy one ("Koramangala Block 6th"). */
function pickNearest(suggestions: Suggestion[], wanted: string, query: ComparableQuery): Suggestion | null {
  if (!query.point) return suggestions[0] ?? null;
  const name = wanted.trim().toLowerCase();
  let exact: { s: Suggestion; km: number } | null = null;
  let best: { s: Suggestion; km: number } | null = null;
  for (const s of suggestions) {
    if (s.lat == null || s.lng == null) continue;
    const km = haversineMetres(query.point, { lat: s.lat, lng: s.lng }) / 1000;
    if (km > MAX_RESOLVE_KM) continue;
    if (s.locality.trim().toLowerCase() === name && (!exact || km < exact.km)) exact = { s, km };
    if (!best || km < best.km) best = { s, km };
  }
  return exact?.s ?? best?.s ?? null;
}

type SuggestOutcome = { kind: 'answered'; suggestions: Suggestion[] } | { kind: 'unavailable'; reason: string };

async function suggestFor(name: string): Promise<SuggestOutcome> {
  // Lowercased: the endpoint's fuzzy match is case-sensitive.
  const url = `https://www.magicbricks.com/mbutility/homepageAutoSuggest?searchtxt=${encodeURIComponent(name.toLowerCase())}`;
  let reason = 'unknown';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    try {
      const res = await unblockedFetch(url, { timeoutMs: 15_000 });
      if (res.status === 200) return { kind: 'answered', suggestions: parseSuggestions(res.body) };
      reason = `status ${res.status}`;
      if (!RETRYABLE.has(res.status)) return { kind: 'unavailable', reason };
    } catch (err) {
      if (err instanceof AllVendorsUnavailable) return { kind: 'unavailable', reason: 'scraping vendor unavailable' };
      reason = err instanceof Error ? err.message : String(err);
    }
  }
  return { kind: 'unavailable', reason };
}

export interface ResolveOutcome {
  pairs: Array<{ locality: string; city: string }>;
  /** The resolver never answered for at least one name — not the same as it knowing nothing. */
  unavailable: boolean;
}

/** The portal's own (locality, city) for the query's locality names. Fails safe. */
export async function resolveLocalities(query: ComparableQuery): Promise<ResolveOutcome> {
  // A metro's own name returns malls, not places; the city ladder already carries it.
  const names = query.localityCandidates.filter((n) => !isPortalCityName(n)).slice(0, MAX_RESOLVE_CALLS);
  if (!names.length) return { pairs: [], unavailable: false };
  const settled = await Promise.allSettled(names.map((n) => suggestFor(n)));
  const pairs: ResolveOutcome['pairs'] = [];
  const seen = new Set<string>();
  let unavailable = false;
  settled.forEach((outcome, i) => {
    if (outcome.status !== 'fulfilled' || outcome.value.kind === 'unavailable') {
      unavailable = true;
      return;
    }
    const best = pickNearest(outcome.value.suggestions, names[i]!, query);
    if (!best || seen.has(best.rfnum)) return;
    seen.add(best.rfnum);
    pairs.push({ locality: best.locality, city: best.city });
  });
  return { pairs, unavailable };
}

/** Lowercase, hyphenated, punctuation gone: how both portals spell a place in a URL. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * `window.X = {...}` is a JS assignment, not a JSON document, so it cannot be
 * sliced with a pattern — brace-match past strings and escapes instead.
 */
export function extractAssignedObject(html: string, marker: RegExp): unknown {
  const at = html.search(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
