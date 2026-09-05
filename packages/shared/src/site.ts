/**
 * Pure geometry and classification helpers for `SiteContext`.
 *
 * These live in the shared package rather than beside the place provider
 * because the valuation engine needs them — the engine prices a transit
 * driver off a measured distance, and it must be able to ask "is this pin
 * precise enough to describe the property?" without depending on the agents
 * package. Keeping the answer in exactly one place is the point: two
 * definitions of "precise enough" drifting apart would show up as an engine
 * pricing a distance the UI is captioning as approximate.
 *
 * Nothing here calls out to anything. The shared package has no dependencies
 * and this file does not change that.
 */

import type { GeoPoint, GeocodePrecision, NearbyAmenity, SiteContext } from './types';

const EARTH_RADIUS_METRES = 6371008.8;

/** Great-circle distance between two points, in metres. */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `from` to `to`, degrees clockwise from north. */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Whether a geocode landed precisely enough to be treated as describing this
 * property rather than its neighbourhood.
 *
 * The gate every pricing decision runs through. A `locality_centre` match is
 * a real, useful, showable location — it just is not *this site*, and a
 * distance measured from it is a fact about the locality. The engine already
 * has a locality-level estimate for that; substituting a locality-level
 * measurement dressed as a site measurement would trade a figure that admits
 * what it is for one that does not.
 *
 * `stated` passes for the same reason and in the opposite direction. A
 * coordinate printed on this parcel's own site plan and approved onto the
 * record is about this parcel; calling it neighbourhood-level would understate
 * a better pin than any geocode of a village name can produce. What it is not
 * is *verified*, and that is carried by its caveat rather than by pretending
 * the distances measured from it describe somewhere else.
 */
export function isSiteAccurate(precision: GeocodePrecision): boolean {
  return precision === 'stated' || precision === 'rooftop' || precision === 'interpolated';
}

/** True when this context's pin is precise enough to price against. */
export function sitePinIsAccurate(context: SiteContext | undefined | null): boolean {
  return context?.location ? isSiteAccurate(context.location.precision) : false;
}

/**
 * The nearest transit amenity, or undefined.
 *
 * Exported so the engine needs to know neither how amenities are ordered nor
 * which kinds exist.
 */
export function nearestTransit(context: SiteContext | undefined | null): NearbyAmenity | undefined {
  if (!context) return undefined;
  return context.amenities.filter(a => a.kind === 'transit').sort((a, b) => a.straightLineMetres - b.straightLineMetres)[0];
}

/**
 * The distance to use when describing an amenity, and how it was arrived at.
 *
 * Road distance where a routing call returned one, straight line otherwise —
 * and the caller is handed `measured` so the sentence it writes can say which,
 * rather than printing a number whose meaning changes silently with whether a
 * billing account was active.
 */
export function amenityDistance(amenity: NearbyAmenity): { metres: number; basis: 'driving' | 'straight_line' } {
  return amenity.drivingMetres !== undefined ? { metres: amenity.drivingMetres, basis: 'driving' } : { metres: amenity.straightLineMetres, basis: 'straight_line' };
}
