/**
 * Building and caching a site's `SiteContext`.
 *
 * Four billed network calls sit behind one build (geocode, places, matrix,
 * street-view metadata), so it is cached on the project and rebuilt only when
 * the address it was built from has changed, or when someone asks for a
 * refresh explicitly.
 */

import type { PropertyCase, PropertyIdentity, SiteContext } from '@realytica/shared';
import { siteContextQuery } from '@realytica/shared';
import { buildSiteContext, placeProviderConfigured, placeProviderFor } from '@realytica/agents';

export interface SiteContextHolder {
  id: string;
  siteContext?: SiteContext;
}

function streetViewUrlFor(id: string): (panoramaId: string, heading: number) => string {
  return (panoramaId, heading) =>
    `/api/projects/${encodeURIComponent(id)}/site-context/street-view?pano=${encodeURIComponent(panoramaId)}&heading=${Math.round(heading)}`;
}

function isCurrent(context: SiteContext | undefined, identity: PropertyIdentity): boolean {
  if (!context) return false;
  if (!context.location) return context.provider !== 'unconfigured';
  return context.location.queried === siteContextQuery(identity);
}

export interface EnsureSiteContextOptions {
  force?: boolean;
}

export async function ensureIdentitySiteContext(
  holder: SiteContextHolder,
  identity: PropertyIdentity,
  now: string,
  options: EnsureSiteContextOptions = {},
): Promise<SiteContext | undefined> {
  if (!placeProviderConfigured()) {
    return holder.siteContext;
  }
  if (!options.force && isCurrent(holder.siteContext, identity)) return holder.siteContext;

  try {
    const context = await buildSiteContext({
      caseId: holder.id,
      identity,
      provider: placeProviderFor(),
      now,
      streetViewUrl: streetViewUrlFor(holder.id),
    });
    holder.siteContext = context;
    return context;
  } catch (err) {
    console.error(`[site-context] build failed for ${holder.id}:`, err);
    return holder.siteContext;
  }
}

/** @deprecated Case product path — kept so unmounted case routers still typecheck. */
export async function ensureSiteContext(
  caseData: PropertyCase,
  now: string,
  options: EnsureSiteContextOptions = {},
): Promise<SiteContext | undefined> {
  return ensureIdentitySiteContext(caseData, caseData.identity, now, options);
}
