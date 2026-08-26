/**
 * Builds a `SiteContext` for a case: where it is, what is around it, and what
 * the approach road looks like.
 *
 * Everything here is *context*. Nothing here is allowed to become an extent,
 * a boundary or a setback — `SiteContext` in the shared types carries the
 * full argument for why, and it is the argument that keeps this file from
 * growing a `computeAreaFromPolygon`.
 */

import type {
  AmenityKind,
  NearbyAmenity,
  PropertyIdentity,
  SiteContext,
  SiteContextGap,
  SiteLocation,
  StreetViewImage,
  GeoPoint,
} from '@valytica/shared';
import { bearingDegrees, haversineMetres, isSiteAccurate, siteContextQuery } from '@valytica/shared';
import type { PlaceProvider } from './types';

/**
 * Viewport bias points, used only to stop the geocoder wandering.
 *
 * These are not evidence and never leave this module: their sole job is to
 * make "Whitefield" resolve to the Whitefield in Bengaluru rather than the one
 * in Manchester. A wrong bias biases a search; it cannot manufacture a
 * location, because a result is still whatever Google matched and still
 * carries its own precision class.
 */
const CITY_BIAS: Record<string, GeoPoint> = {
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  rotterdam: { lat: 51.9244, lng: 4.4777 },
  utrecht: { lat: 52.0907, lng: 5.1214 },
};

const REGION_CODE: Record<string, string> = { IN: 'in', NL: 'nl' };

/** The kinds actually searched, in the order they are shown. */
const SEARCHED_KINDS: AmenityKind[] = ['transit', 'school', 'hospital', 'market', 'airport'];

/** How far a Street View camera may be from the site pin before it is a different place. */
const STREETVIEW_RADIUS_METRES = 60;

export interface BuildSiteContextInput {
  caseId: string;
  identity: PropertyIdentity;
  provider: PlaceProvider;
  /** Case-reference timestamp, as everywhere else in this codebase — not wall-clock. */
  now: string;
  /**
   * Builds the URL the browser will load for a Street View frame. Supplied by
   * the API layer, which owns the proxy route that holds the key. Defaulted
   * to that route's own convention so a direct caller (a script, a test) gets
   * something coherent rather than an empty string.
   */
  streetViewUrl?: (panoramaId: string, headingDegrees: number) => string;
}

/**
 * The string handed to the geocoder is assembled by
 * `siteContextQuery` in `@valytica/shared`, not here.
 *
 * It lives there because the staleness check needs it too — to tell whether
 * a cached location was built from the address the case still holds — and
 * the shared package cannot import this one. A second copy here would drift,
 * and the drift would show up as a location that rebuilds on every read or
 * never rebuilds at all.
 *
 * A survey number is deliberately never the whole query. "Sy. No. 118/2,
 * Varthur Hobli" is a perfectly good legal description of a parcel and a
 * useless postal address; sending it alone gets a confident match on the
 * centre of Varthur, which is the exact failure `GeocodePrecision` exists to
 * expose. The address line leads when there is one; when there is not, the
 * query is locality-level and the precision it comes back with will say so.
 */

function caveatFor(precision: SiteLocation['precision'], resolvedAddress: string): string {
  switch (precision) {
    case 'rooftop':
      return `Located from the address on file, which matched "${resolvedAddress}". The pin marks that address — it is not a surveyed parcel boundary, and it does not show where the property's limits run.`;
    case 'interpolated':
      return `Located by interpolating along the street from the address on file ("${resolvedAddress}"), so the pin may sit some way from the actual gate. It is not a surveyed parcel boundary.`;
    case 'locality_centre':
      return `The address on file did not resolve to a specific building — the pin is the centre of "${resolvedAddress}", not this property. Everything measured from it describes the neighbourhood, not the site. Add a street address or project name to place it properly.`;
    case 'approximate':
    default:
      return `The geocoder matched "${resolvedAddress}" but could not say how precisely. Treat the pin as indicative of the area only, not of this property.`;
  }
}

export async function buildSiteContext(input: BuildSiteContextInput): Promise<SiteContext> {
  const { caseId, identity, provider, now } = input;
  const streetViewUrl =
    input.streetViewUrl ??
    ((panoramaId: string, heading: number): string =>
      `/api/cases/${encodeURIComponent(caseId)}/site-context/street-view?pano=${encodeURIComponent(panoramaId)}&heading=${Math.round(heading)}`);

  const gaps: SiteContextGap[] = [];
  const query = siteContextQuery(identity);

  if (query.length === 0) {
    gaps.push({
      code: 'no_address_on_file',
      attempted: 'Assembling an address to locate the property.',
      consequence: 'The case records no address, locality or city, so there is nothing to place on a map. Nothing about the surroundings of this site is known.',
    });
    return { caseId, location: null, amenities: [], streetView: null, gaps, provider: provider.id, builtAt: now };
  }

  if (!identity.addressLine.trim()) {
    gaps.push({
      code: 'address_line_missing',
      attempted: `Locating the property from "${query}".`,
      consequence:
        'No street address is recorded, only a locality, so the best the geocoder can return is the centre of that locality. ' +
        'Distances measured from it are neighbourhood distances, not distances from this property.',
    });
  }

  const geocoded = await provider.geocode({
    query,
    biasTo: CITY_BIAS[identity.city.trim().toLowerCase()],
    regionCode: REGION_CODE[identity.country],
  });

  if (!geocoded.ok) {
    gaps.push(geocoded.gap);
    return { caseId, location: null, amenities: [], streetView: null, gaps, provider: provider.id, builtAt: now };
  }

  const location: SiteLocation = {
    point: geocoded.value.point,
    precision: geocoded.value.precision,
    queried: query,
    resolvedAddress: geocoded.value.resolvedAddress,
    provider: provider.id,
    resolvedAt: now,
    caveat: caveatFor(geocoded.value.precision, geocoded.value.resolvedAddress),
  };

  const approximate = !isSiteAccurate(location.precision);

  /* -- Surroundings ---------------------------------------------------- */

  const amenities: NearbyAmenity[] = [];
  for (const kind of SEARCHED_KINDS) {
    const found = await provider.nearby({ around: location.point, kind, radiusMetres: 50000, limit: 3 });
    if (!found.ok) {
      // A kind with no supported place category is a design decision, not a
      // failure, and saying so on every case would be noise. Everything else
      // — a denied key, a quota wall — is a real gap the reader needs.
      if (!found.gap.code.startsWith('nearby_kind_unsupported')) gaps.push(found.gap);
      continue;
    }
    for (const place of found.value) {
      amenities.push({
        id: `${kind}:${place.id}`,
        kind,
        name: place.name,
        point: place.point,
        straightLineMetres: Math.round(haversineMetres(location.point, place.point)),
        fromApproximatePin: approximate,
      });
    }
  }

  amenities.sort((a, b) => (a.kind !== b.kind ? SEARCHED_KINDS.indexOf(a.kind) - SEARCHED_KINDS.indexOf(b.kind) : a.straightLineMetres - b.straightLineMetres));

  /* -- Road distance --------------------------------------------------- */

  if (amenities.length > 0) {
    const routed = await provider.route({ from: location.point, to: amenities.map(a => a.point) });
    if (routed.ok) {
      for (const leg of routed.value) {
        const amenity = amenities[leg.toIndex];
        if (!amenity) continue;
        amenity.drivingMetres = leg.metres;
        amenity.drivingSeconds = leg.seconds;
      }
    } else {
      gaps.push(routed.gap);
    }
  }

  /* -- Street-level imagery -------------------------------------------- */

  let streetView: StreetViewImage | null = null;
  const pano = await provider.findStreetView({ near: location.point, radiusMetres: STREETVIEW_RADIUS_METRES });
  if (!pano.ok) {
    gaps.push(pano.gap);
  } else if (pano.value === null) {
    gaps.push({
      code: 'streetview_no_coverage',
      attempted: `Looking for street-level imagery within ${STREETVIEW_RADIUS_METRES} m of the site.`,
      consequence:
        'There is no street-level photograph of the approach to this site. On the Bengaluru peripheries this is common on ' +
        'unadopted layout roads, and it is itself worth noting: the access road may not be a public road.',
    });
  } else {
    // The camera stood somewhere on the street; point it at the site rather
    // than leaving it facing whichever way the car happened to be driving.
    const heading = bearingDegrees(pano.value.point, location.point);
    streetView = {
      url: streetViewUrl(pano.value.panoramaId, heading),
      capturedAt: pano.value.capturedAt,
      panoramaId: pano.value.panoramaId,
      point: pano.value.point,
      headingDegrees: Math.round(heading),
      offsetMetres: Math.round(haversineMetres(pano.value.point, location.point)),
    };
  }

  return { caseId, location, amenities, streetView, gaps, provider: provider.id, builtAt: now };
}
