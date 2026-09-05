/**
 * Building and caching a site's `SiteContext`.
 *
 * Four billed network calls sit behind one build (geocode, places, matrix,
 * street-view metadata), so it is cached on the project and rebuilt only when
 * the address it was built from has changed, or when someone asks for a
 * refresh explicitly.
 */

import type { DdProject, PropertyIdentity, SiteContext } from '@realytica/shared';
import { projectToIdentity, siteContextQuery } from '@realytica/shared';
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

/** The address string this project would hand the geocoder right now. */
export function projectSiteQuery(project: DdProject): string {
  return siteContextQuery(projectToIdentity(project));
}

/**
 * Rebuild the pin when a write has moved the property.
 *
 * Until now a pin existed only if somebody went to the Location view and asked
 * for one. So approving "record the address as Balagere Village, Varthur
 * Hobli" changed the record and left the map showing nothing, or worse, still
 * showing the old place — the staleness register would eventually say so, but
 * only to whoever went looking.
 *
 * Guarded on the query rather than on the field, and taken before and after
 * the write: renaming a project or editing its budget must not spend four
 * billed calls, and a patch that sets the address to what it already said must
 * not either. `ensureIdentitySiteContext` is a no-op without a mapping
 * provider, so a deployment with no key does nothing here and says nothing.
 */
export async function refreshSiteContextIfMoved(project: DdProject, before: string, now: string): Promise<void> {
  if (projectSiteQuery(project) === before) return;
  await ensureIdentitySiteContext(project, projectToIdentity(project), now);
}
