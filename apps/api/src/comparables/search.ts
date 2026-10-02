/**
 * A portal search for comparables, end to end: ask the portal what it calls
 * the locality, fetch 99acres and MagicBricks side by side, clean and rank
 * what came back, and put the best on the register as proposed.
 *
 * Every adapter fails safe, so one portal breaking thins the result rather
 * than failing it; what failed and why is kept on the search, so an empty one
 * can say whether it was the vendor, the locality or the market.
 */

import {
  buildComparableQuery,
  explainEmptySearch,
  mergeComparableSearch,
  normaliseListings,
  scoreComparables,
  valueHasBuilding,
  haversineMetres,
  type ComparableQuery,
  type ComparableRecord,
  type ComparableSearchDiagnostics,
  type ComparableSearchRecord,
  type DdProject,
  type RawListing,
  type ScoredCandidate,
} from '@realytica/shared';
import { unblockerConfigured } from './unblocker';
import { resolveLocalities } from './ladder';
import { fetch99Acres } from './ninetynineacres';
import { fetchMagicBricks } from './magicbricks';

export { unblockerConfigured };

/*
 * Outside a metro the nearest listing is routinely several kilometres out, so
 * a thin strict result is re-scored at a wider radius — from the same pool, at
 * no extra cost — and the widening is reported, never hidden.
 */
const MIN_RESULTS_BEFORE_WIDENING = 3;
const WIDEN_STEPS = [2.5, 5] as const;
const MAX_RADIUS_KM = 25;

const ADAPTERS = [
  { source: '99acres', run: (q: ComparableQuery, onPages: (n: number) => void) => fetch99Acres(q, 2, { onPagesResolved: onPages }) },
  { source: 'magicbricks', run: (q: ComparableQuery, onPages: (n: number) => void) => fetchMagicBricks(q, { onPagesResolved: onPages }) },
] as const;

export async function searchPortals(query: ComparableQuery, opts: { nowMs: number; limit?: number }): Promise<{ results: ScoredCandidate[]; diagnostics: ComparableSearchDiagnostics }> {
  const resolution = await resolveLocalities(query).catch(() => ({ pairs: [], unavailable: true }));
  const resolved: ComparableQuery = resolution.pairs.length ? { ...query, resolvedPairs: resolution.pairs } : query;

  const pages: Record<string, number> = {};
  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.run(resolved, (n) => (pages[a.source] = n))));
  const bySource: ComparableSearchDiagnostics['bySource'] = {};
  const listings: RawListing[] = [];
  settled.forEach((outcome, i) => {
    const source = ADAPTERS[i]!.source;
    if (outcome.status === 'fulfilled') {
      bySource[source] = { fetched: outcome.value.length, error: false, pagesResolved: pages[source] ?? 0 };
      listings.push(...outcome.value);
    } else {
      bySource[source] = { fetched: 0, error: true, pagesResolved: pages[source] ?? 0 };
    }
  });

  const pool = normaliseListings(listings);
  const limit = opts.limit ?? 6;
  let radiusKmUsed = query.radiusKm;
  let results = scoreComparables(query, pool.kept, { nowMs: opts.nowMs, limit });
  if (results.length < MIN_RESULTS_BEFORE_WIDENING && pool.kept.length > 0) {
    for (const step of WIDEN_STEPS) {
      const widened = Math.min(query.radiusKm * step, MAX_RADIUS_KM);
      if (widened <= radiusKmUsed) continue;
      radiusKmUsed = widened;
      results = scoreComparables({ ...query, radiusKm: widened }, pool.kept, { nowMs: opts.nowMs, limit });
      if (results.length >= MIN_RESULTS_BEFORE_WIDENING) break;
    }
  }
  let nearestKm: number | null = null;
  if (query.point) {
    for (const c of pool.kept) {
      if (!c.point) continue;
      const km = haversineMetres(query.point, c.point) / 1000;
      if (nearestKm == null || km < nearestKm) nearestKm = Math.round(km * 10) / 10;
    }
  }
  return {
    results,
    diagnostics: {
      bySource,
      projectAdsDropped: pool.projectAdsDropped,
      duplicatesDropped: pool.duplicatesDropped,
      rateOutliersDropped: pool.rateOutliersDropped,
      candidatesConsidered: pool.kept.length,
      radiusKmUsed,
      radiusWidened: radiusKmUsed > query.radiusKm,
      nearestKm,
      resolvedLocalities: resolution.pairs.map((p) => `${p.locality}, ${p.city}`),
      resolverUnavailable: resolution.unavailable,
    },
  };
}

export type ComparableSearchOutcome =
  | { ok: true; search: ComparableSearchRecord; added: ComparableRecord[] }
  | { ok: false; reason: string; notConfigured?: boolean };

/** Search the portals for this project and put what was found on its register. */
export async function runComparableSearch(project: DdProject, actor: string, nowMs = Date.now()): Promise<ComparableSearchOutcome> {
  if (!unblockerConfigured()) {
    return { ok: false, notConfigured: true, reason: 'Portal search needs a scraping service. Set UNBLOCKER_PROVIDER and UNBLOCKER_API_KEY on the API; until then, add comparables by hand.' };
  }
  const built = buildComparableQuery(project, valueHasBuilding(project));
  if (!built.ok) return { ok: false, reason: built.reason };
  const { results, diagnostics } = await searchPortals(built.query, { nowMs });
  const search: ComparableSearchRecord = {
    at: new Date(nowMs).toISOString(),
    by: actor,
    localities: built.query.localityCandidates,
    cities: built.query.cityCandidates,
    radiusKm: diagnostics.radiusKmUsed,
    subclass: built.query.subclass,
    found: results.length,
    diagnostics,
    ...(results.length ? {} : { empty: explainEmptySearch(diagnostics) }),
  };
  const added = mergeComparableSearch(project, results, search, actor);
  return { ok: true, search, added };
}
