/**
 * Building and caching a case's `SiteContext`.
 *
 * Four billed network calls sit behind one build (geocode, places, matrix,
 * street-view metadata), so it is cached on the case and rebuilt only when
 * the address it was built from has changed, or when someone asks for a
 * refresh explicitly. A screen that runs ten times against an unchanged
 * address costs one build.
 *
 * The cache key is the address string itself rather than a timestamp. A
 * time-based expiry would re-bill the account on a schedule to re-discover
 * the same coordinates for the same address; the thing that actually
 * invalidates a location is someone editing the address, and that is what is
 * compared.
 */

import type { PropertyCase, SiteContext } from '@valytica/shared';
import { siteContextQuery } from '@valytica/shared';
import { buildSiteContext, placeProviderConfigured, placeProviderFor } from '@valytica/agents';

/**
 * Builds the URL the browser loads for one Street View frame.
 *
 * A route on this API, never Google's own URL: the Maps key is a server
 * secret and a static-map or street-view URL carries it in the query string,
 * so handing one to the browser publishes it to anyone who opens dev tools.
 */
function streetViewUrlFor(caseId: string): (panoramaId: string, heading: number) => string {
  return (panoramaId, heading) =>
    `/api/cases/${encodeURIComponent(caseId)}/site-context/street-view?pano=${encodeURIComponent(panoramaId)}&heading=${Math.round(heading)}`;
}

/** True when the cached context was built from the address the case now holds. */
function isCurrent(context: SiteContext | undefined, caseData: PropertyCase): boolean {
  if (!context) return false;
  // A context that failed to geocode has no `location` and therefore no
  // `queried` to compare. Treat it as current so a case with an unresolvable
  // address does not re-bill four calls on every screen — a refresh is the
  // way to retry it.
  if (!context.location) return context.provider !== 'unconfigured';
  return context.location.queried === siteContextQuery(caseData.identity);
}

export interface EnsureSiteContextOptions {
  /** Rebuild even when the cached context matches the current address. */
  force?: boolean;
}

/**
 * Returns the case's site context, building it if needed.
 *
 * Mutates `caseData.siteContext` but does not save — the caller owns the
 * store write, so a screen that builds a context and then computes a result
 * persists both in one `store.save()` rather than two.
 *
 * Never throws. A provider failure comes back as a context full of named
 * gaps, because a screen must not fail because a map lookup did.
 */
export async function ensureSiteContext(caseData: PropertyCase, now: string, options: EnsureSiteContextOptions = {}): Promise<SiteContext | undefined> {
  if (!placeProviderConfigured()) {
    // No key. Leave whatever is cached alone — a context built when a key was
    // present is still true, and overwriting it with a wall of
    // "no_provider_key" gaps would destroy real data because of a
    // configuration change.
    return caseData.siteContext;
  }
  if (!options.force && isCurrent(caseData.siteContext, caseData)) return caseData.siteContext;

  try {
    const context = await buildSiteContext({
      caseId: caseData.id,
      identity: caseData.identity,
      provider: placeProviderFor(),
      now,
      streetViewUrl: streetViewUrlFor(caseData.id),
    });
    caseData.siteContext = context;
    return context;
  } catch (err) {
    // The builder is written not to throw, so reaching here means something
    // outside its error handling did. Log it and carry on with whatever was
    // cached: the screen is not the place to surface an infrastructure fault.
    console.error(`[site-context] build failed for case ${caseData.id}:`, err);
    return caseData.siteContext;
  }
}
