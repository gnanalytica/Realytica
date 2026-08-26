/**
 * Google Maps Platform implementation of the place provider port.
 *
 * Four separate products sit behind this one class, and they fail
 * independently: Geocoding, Places (New) Nearby Search, Distance Matrix and
 * the Street View metadata endpoint. Each is wrapped so that a failure in one
 * degrades exactly one feature and names itself — a Places call rejected for
 * a billing problem must not take the map pin down with it.
 *
 * --- Why the key never leaves the server ----------------------------------
 *
 * Every call here is server-side, and the two *image* endpoints (Static Maps
 * and Street View) are reached through a proxy route in the API rather than
 * by handing the browser a URL with a key in it. A referrer-restricted
 * browser key is the usual answer to that and it is a real option, but it is
 * a second key with a second restriction policy to get right, and getting it
 * wrong bills the account. One server key, never rendered, is the smaller
 * surface.
 */

import type { GeocodePrecision, GeoPoint } from '@valytica/shared';
import {
  placeGap,
  placeOk,
  type GeocodeRequest,
  type GeocodeResult,
  type NearbyPlace,
  type NearbyRequest,
  type PlaceCapabilities,
  type PlaceOutcome,
  type PlaceProvider,
  type RouteLeg,
  type RouteRequest,
  type StreetViewLookup,
  type StreetViewPanorama,
} from './types';

/**
 * Where the six Google endpoints live.
 *
 * Overridable as a group rather than hardcoded, for two reasons that are
 * really one reason: a deployment behind an egress proxy needs to point these
 * somewhere else, and so does anything that wants to exercise this file
 * without a billing account attached. A provider whose network path has never
 * once been executed is a provider that works in principle, and this codebase
 * has had enough of those.
 */
export interface GoogleEndpoints {
  geocode: string;
  nearby: string;
  matrix: string;
  streetViewMetadata: string;
  staticMap: string;
  streetViewImage: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  geocode: 'https://maps.googleapis.com/maps/api/geocode/json',
  nearby: 'https://places.googleapis.com/v1/places:searchNearby',
  matrix: 'https://maps.googleapis.com/maps/api/distancematrix/json',
  streetViewMetadata: 'https://maps.googleapis.com/maps/api/streetview/metadata',
  staticMap: 'https://maps.googleapis.com/maps/api/staticmap',
  streetViewImage: 'https://maps.googleapis.com/maps/api/streetview',
};

/** Every outbound call gets a hard ceiling; a hung geocode must not hang a screen. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Which Places types stand in for each amenity kind, how far out to look, and
 * how many to keep.
 *
 * The radii are not uniform because the questions are not the same question.
 * A school 3 km away is a school you drive to daily and it matters; a metro
 * station 5 km away still shapes a Bengaluru commute; an airport is 35 km
 * away by definition and asking for one within 5 km would return nothing and
 * read as "no airport nearby".
 *
 * `employment` has no entry deliberately. Places has no type that means "IT
 * park", and the obvious substitutes — a text search for "tech park", the
 * `corporate_office` type — return an arbitrary subset of office buildings
 * that would be presented as the employment picture of a corridor. The
 * locality reference notes already describe employment catchment in prose
 * written by someone who knows; a worse machine answer next to it is not an
 * improvement.
 */
const KIND_QUERY: Partial<Record<NearbyRequest['kind'], { types: string[]; radiusMetres: number; limit: number }>> = {
  transit: { types: ['subway_station', 'train_station', 'light_rail_station'], radiusMetres: 6000, limit: 3 },
  school: { types: ['school'], radiusMetres: 3000, limit: 3 },
  hospital: { types: ['hospital'], radiusMetres: 6000, limit: 3 },
  market: { types: ['supermarket', 'shopping_mall'], radiusMetres: 3000, limit: 3 },
  airport: { types: ['international_airport', 'airport'], radiusMetres: 50000, limit: 1 },
};

export function nearbyQueryFor(kind: NearbyRequest['kind']): { types: string[]; radiusMetres: number; limit: number } | undefined {
  return KIND_QUERY[kind];
}

/**
 * Google's `location_type`, mapped onto the port's precision classes.
 *
 * `GEOMETRIC_CENTER` is the interesting one: Google returns it for the centre
 * of a polyline (a road) or a polygon (a locality, a ward). Neither is the
 * property. It is grouped with `APPROXIMATE` under `locality_centre` because
 * for this product's purposes they mean the same thing — "somewhere in the
 * right area" — and splitting them would invite a call site to treat one of
 * them as a site match.
 */
function precisionOf(locationType: string | undefined, types: string[] | undefined): GeocodePrecision {
  // A result Google typed as a locality, ward or district is a region centre
  // no matter how precise the geometry claims to be.
  const regionish = /^(locality|sublocality|postal_code|administrative_area|neighborhood|political)/;
  if (types?.some(t => regionish.test(t))) return 'locality_centre';
  switch (locationType) {
    case 'ROOFTOP':
      return 'rooftop';
    case 'RANGE_INTERPOLATED':
      return 'interpolated';
    case 'GEOMETRIC_CENTER':
    case 'APPROXIMATE':
      return 'locality_centre';
    default:
      return 'approximate';
  }
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Google's REST geocoding/matrix endpoints answer HTTP 200 with a `status`
 * field carrying the actual outcome, so a non-OK status has to be read out of
 * the body. `REQUEST_DENIED` in particular is the shape a key restriction or
 * an unenabled API takes, and it is worth naming distinctly because the fix
 * is in the Cloud console rather than in this code.
 */
function statusProblem(status: string, errorMessage: string | undefined): string | null {
  if (status === 'OK' || status === 'ZERO_RESULTS') return null;
  if (status === 'REQUEST_DENIED') {
    return `the request was denied (${errorMessage ?? 'no reason given'}) — usually the API is not enabled on the Google Cloud project, or the key restriction excludes this call`;
  }
  if (status === 'OVER_QUERY_LIMIT') return 'the daily quota or billing limit on the Google Cloud project has been reached';
  return `Google returned ${status}${errorMessage ? ` — ${errorMessage}` : ''}`;
}

export interface GoogleMapsConfig {
  apiKey: string;
  /** Defaults to Google's own hosts. Overridden via VALYTICA_GOOGLE_MAPS_BASE_URL. */
  endpoints: GoogleEndpoints;
}

/**
 * Reads the server key from the environment.
 *
 * Two names are accepted because `GOOGLE_MAPS_API_KEY` is what every Google
 * sample calls it and is what an operator will reach for first, while the
 * `VALYTICA_` prefix is this project's own convention and wins where both are
 * set.
 */
export function readGoogleMapsConfig(env: NodeJS.ProcessEnv = process.env): GoogleMapsConfig | null {
  const apiKey = (env.VALYTICA_GOOGLE_MAPS_API_KEY ?? env.GOOGLE_MAPS_API_KEY ?? '').trim();
  if (apiKey.length === 0) return null;
  const base = (env.VALYTICA_GOOGLE_MAPS_BASE_URL ?? '').trim().replace(/\/$/, '');
  // One override for all six, keeping the paths, so a proxy or a stand-in
  // only has to mirror Google's own URL shape.
  const endpoints: GoogleEndpoints = base
    ? {
        geocode: `${base}/maps/api/geocode/json`,
        nearby: `${base}/v1/places:searchNearby`,
        matrix: `${base}/maps/api/distancematrix/json`,
        streetViewMetadata: `${base}/maps/api/streetview/metadata`,
        staticMap: `${base}/maps/api/staticmap`,
        streetViewImage: `${base}/maps/api/streetview`,
      }
    : GOOGLE_ENDPOINTS;
  return { apiKey, endpoints };
}

const GOOGLE_CAPABILITIES: PlaceCapabilities = {
  geocode: true,
  nearbySearch: true,
  routing: true,
  streetView: true,
};

export function createGoogleMapsProvider(config: GoogleMapsConfig): PlaceProvider {
  const { apiKey, endpoints } = config;

  return {
    id: 'google',
    label: 'Google Maps Platform',
    capabilities: GOOGLE_CAPABILITIES,
    configured: true,

    async geocode(request: GeocodeRequest): Promise<PlaceOutcome<GeocodeResult>> {
      const params = new URLSearchParams({ address: request.query, key: apiKey });
      if (request.regionCode) params.set('region', request.regionCode.toLowerCase());
      if (request.biasTo) {
        // A 0.4-degree box around the bias point (~45 km) keeps a Bengaluru
        // address from resolving to a same-named locality in another state,
        // which the geocoder will otherwise happily do.
        const { lat, lng } = request.biasTo;
        params.set('bounds', `${lat - 0.4},${lng - 0.4}|${lat + 0.4},${lng + 0.4}`);
      }
      try {
        const body = (await getJson(`${endpoints.geocode}?${params.toString()}`)) as {
          status?: string;
          error_message?: string;
          results?: Array<{
            formatted_address?: string;
            types?: string[];
            geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
          }>;
        };
        const problem = statusProblem(body.status ?? 'UNKNOWN', body.error_message);
        if (problem) {
          return placeGap({
            code: 'geocode_failed',
            attempted: `Resolving "${request.query}" to coordinates via Google Geocoding.`,
            consequence: `The property has no map location, so nothing on this case is shown on a map and no distance to anything nearby is measured — ${problem}.`,
          });
        }
        const top = body.results?.[0];
        const lat = top?.geometry?.location?.lat;
        const lng = top?.geometry?.location?.lng;
        if (top === undefined || typeof lat !== 'number' || typeof lng !== 'number') {
          return placeGap({
            code: 'geocode_no_match',
            attempted: `Resolving "${request.query}" to coordinates via Google Geocoding.`,
            consequence:
              'The address on file did not match anything the geocoder recognises, so the property is not placed on a map. ' +
              'A survey number on its own is not a postal address and will not resolve — add a street address or a project name to place it.',
          });
        }
        return placeOk({
          point: { lat, lng },
          precision: precisionOf(top.geometry?.location_type, top.types),
          resolvedAddress: top.formatted_address ?? request.query,
        });
      } catch (err) {
        return placeGap({
          code: 'geocode_error',
          attempted: `Resolving "${request.query}" to coordinates via Google Geocoding.`,
          consequence: `The property has no map location and no measured distances — the geocoding call failed: ${describe(err)}.`,
        });
      }
    },

    async nearby(request: NearbyRequest): Promise<PlaceOutcome<NearbyPlace[]>> {
      const query = KIND_QUERY[request.kind];
      if (!query) {
        return placeGap({
          code: `nearby_kind_unsupported:${request.kind}`,
          attempted: `Searching for nearby places of kind "${request.kind}".`,
          consequence: `Nothing of this kind is listed for the site — there is no reliable place category for it, so it is left out rather than filled with a guess.`,
        });
      }
      try {
        const body = (await getJson(endpoints.nearby, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
          },
          body: JSON.stringify({
            includedTypes: query.types,
            maxResultCount: Math.min(request.limit, query.limit),
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude: request.around.lat, longitude: request.around.lng },
                radius: Math.min(request.radiusMetres, 50000),
              },
            },
          }),
        })) as {
          places?: Array<{ id?: string; displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }>;
        };
        const places: NearbyPlace[] = [];
        for (const p of body.places ?? []) {
          const lat = p.location?.latitude;
          const lng = p.location?.longitude;
          const name = p.displayName?.text;
          if (typeof lat !== 'number' || typeof lng !== 'number' || !name || !p.id) continue;
          places.push({ id: p.id, name, point: { lat, lng } });
        }
        return placeOk(places);
      } catch (err) {
        return placeGap({
          code: `nearby_failed:${request.kind}`,
          attempted: `Searching Google Places for ${request.kind} within ${request.radiusMetres} m of the site.`,
          consequence: `Nothing of this kind is listed for the site — this is a failed lookup, not an empty neighbourhood: ${describe(err)}.`,
        });
      }
    },

    async route(request: RouteRequest): Promise<PlaceOutcome<RouteLeg[]>> {
      if (request.to.length === 0) return placeOk([]);
      // The Distance Matrix element cap is well above anything this product
      // asks for, but slicing keeps a future caller from discovering it the
      // expensive way.
      const destinations = request.to.slice(0, 25);
      const params = new URLSearchParams({
        origins: `${request.from.lat},${request.from.lng}`,
        destinations: destinations.map(d => `${d.lat},${d.lng}`).join('|'),
        mode: 'driving',
        key: apiKey,
      });
      try {
        const body = (await getJson(`${endpoints.matrix}?${params.toString()}`)) as {
          status?: string;
          error_message?: string;
          rows?: Array<{ elements?: Array<{ status?: string; distance?: { value?: number }; duration?: { value?: number } }> }>;
        };
        const problem = statusProblem(body.status ?? 'UNKNOWN', body.error_message);
        if (problem) {
          return placeGap({
            code: 'routing_failed',
            attempted: 'Measuring road distance from the site to each nearby place via Google Distance Matrix.',
            consequence: `Distances shown are straight-line only, which understates a real Bengaluru journey — ${problem}.`,
          });
        }
        const elements = body.rows?.[0]?.elements ?? [];
        const legs: RouteLeg[] = [];
        elements.forEach((el, i) => {
          // A per-element ZERO_RESULTS means no drivable route to that one
          // destination. Skipping it leaves that amenity with its straight-line
          // distance, which is the honest fallback.
          if (el.status !== 'OK') return;
          const metres = el.distance?.value;
          const seconds = el.duration?.value;
          if (typeof metres !== 'number' || typeof seconds !== 'number') return;
          legs.push({ toIndex: i, metres, seconds });
        });
        return placeOk(legs);
      } catch (err) {
        return placeGap({
          code: 'routing_error',
          attempted: 'Measuring road distance from the site to each nearby place via Google Distance Matrix.',
          consequence: `Distances shown are straight-line only, which understates a real Bengaluru journey: ${describe(err)}.`,
        });
      }
    },

    async findStreetView(lookup: StreetViewLookup): Promise<PlaceOutcome<StreetViewPanorama | null>> {
      const params = new URLSearchParams({
        location: `${lookup.near.lat},${lookup.near.lng}`,
        radius: String(lookup.radiusMetres),
        // `outdoor` excludes the interior panoramas businesses upload, which
        // are worse than useless here — a photo of a showroom floor presented
        // as the approach road to a site.
        source: 'outdoor',
        key: apiKey,
      });
      try {
        const body = (await getJson(`${endpoints.streetViewMetadata}?${params.toString()}`)) as {
          status?: string;
          error_message?: string;
          date?: string;
          pano_id?: string;
          location?: { lat?: number; lng?: number };
        };
        if (body.status === 'ZERO_RESULTS') return placeOk(null);
        const problem = statusProblem(body.status ?? 'UNKNOWN', body.error_message);
        if (problem) {
          return placeGap({
            code: 'streetview_failed',
            attempted: 'Looking up street-level imagery for the site via Google Street View.',
            consequence: `There is no street-level view of the approach to this site — ${problem}.`,
          });
        }
        const lat = body.location?.lat;
        const lng = body.location?.lng;
        if (!body.pano_id || typeof lat !== 'number' || typeof lng !== 'number') return placeOk(null);
        if (!body.date) {
          // Coverage with no capture date. Refused rather than shown undated —
          // see StreetViewPanorama.capturedAt.
          return placeGap({
            code: 'streetview_undated',
            attempted: 'Looking up street-level imagery for the site via Google Street View.',
            consequence:
              'A street-level image exists but Google does not report when it was taken, so it is not shown. ' +
              'An undated photograph of a fast-changing corridor is more likely to mislead than to inform.',
          });
        }
        return placeOk({ panoramaId: body.pano_id, point: { lat, lng }, capturedAt: body.date });
      } catch (err) {
        return placeGap({
          code: 'streetview_error',
          attempted: 'Looking up street-level imagery for the site via Google Street View.',
          consequence: `There is no street-level view of the approach to this site: ${describe(err)}.`,
        });
      }
    },
  };
}

/** Builds a signed-free Static Maps URL. Server-side only — carries the key. */
export function staticMapUrl(
  config: GoogleMapsConfig,
  centre: GeoPoint,
  options: { zoom: number; width: number; height: number; scale: 1 | 2; markers: Array<{ point: GeoPoint; label: string; colour: string }> },
): string {
  const params = new URLSearchParams({
    center: `${centre.lat},${centre.lng}`,
    zoom: String(options.zoom),
    size: `${options.width}x${options.height}`,
    scale: String(options.scale),
    maptype: 'roadmap',
    key: config.apiKey,
  });
  for (const m of options.markers) {
    params.append('markers', `color:${m.colour}|label:${m.label}|${m.point.lat},${m.point.lng}`);
  }
  return `${config.endpoints.staticMap}?${params.toString()}`;
}

/** Builds a Street View image URL. Server-side only — carries the key. */
export function streetViewImageUrl(
  config: GoogleMapsConfig,
  panoramaId: string,
  options: { heading: number; width: number; height: number },
): string {
  const params = new URLSearchParams({
    pano: panoramaId,
    size: `${options.width}x${options.height}`,
    heading: String(Math.round(options.heading)),
    pitch: '0',
    fov: '80',
    key: config.apiKey,
  });
  return `${config.endpoints.streetViewImage}?${params.toString()}`;
}
