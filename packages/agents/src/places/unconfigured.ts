/**
 * The place provider that exists when nobody has set a key.
 *
 * It is a real provider, not a null: it answers every method, it answers
 * quickly, and every answer is a named gap explaining what is missing and
 * what that leaves unknown. The alternative — returning empty arrays — is the
 * failure mode this codebase keeps finding and removing, where a subsystem
 * looks complete and reports nothing, and a screen that has never once looked
 * at the map is indistinguishable from a screen that looked and found a quiet
 * street.
 */

import {
  placeGap,
  type GeocodeRequest,
  type GeocodeResult,
  type NearbyPlace,
  type NearbyRequest,
  type PlaceOutcome,
  type PlaceProvider,
  type RouteLeg,
  type RouteRequest,
  type StreetViewLookup,
  type StreetViewPanorama,
} from './types';

const SETUP =
  'no mapping provider is configured for this deployment (set VALYTICA_GOOGLE_MAPS_API_KEY, on a Google Cloud project with ' +
  'the Geocoding, Places, Distance Matrix and Street View Static APIs enabled and billing active)';

export const unconfiguredPlaceProvider: PlaceProvider = {
  id: 'unconfigured',
  label: 'No mapping provider configured',
  capabilities: { geocode: false, nearbySearch: false, routing: false, streetView: false },
  configured: false,

  async geocode(request: GeocodeRequest): Promise<PlaceOutcome<GeocodeResult>> {
    return placeGap({
      code: 'no_provider_key',
      attempted: `Resolving "${request.query}" to coordinates.`,
      consequence: `The property is not placed on a map and no distance to anything nearby is measured — ${SETUP}.`,
    });
  },

  async nearby(request: NearbyRequest): Promise<PlaceOutcome<NearbyPlace[]>> {
    return placeGap({
      code: 'no_provider_key',
      attempted: `Searching for ${request.kind} near the site.`,
      consequence: `What surrounds this site is not known — ${SETUP}.`,
    });
  },

  async route(_request: RouteRequest): Promise<PlaceOutcome<RouteLeg[]>> {
    return placeGap({
      code: 'no_provider_key',
      attempted: 'Measuring road distance from the site to nearby places.',
      consequence: `No distances are measured — ${SETUP}.`,
    });
  },

  async findStreetView(_lookup: StreetViewLookup): Promise<PlaceOutcome<StreetViewPanorama | null>> {
    return placeGap({
      code: 'no_provider_key',
      attempted: 'Looking up street-level imagery for the site.',
      consequence: `There is no street-level view of the approach to this site — ${SETUP}.`,
    });
  },
};
