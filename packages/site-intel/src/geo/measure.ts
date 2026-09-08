export type LatLng = { lat: number; lng: number };

// Mean Earth radius — the conventional value for haversine. Kept consistent with
// the other distance helpers (geo/places, site-photos-upload) so the same two
// points never yield different distances across the app.
const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline path, in metres. */
export function pathLengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Spherical polygon area, in square metres (always non-negative).
 * Uses the spherical-excess shoelace formula; accurate for the
 * neighbourhood-scale polygons valuers draw.
 */
export function polygonAreaSqMeters(points: LatLng[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += toRad(p2.lng - p1.lng) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${m.toFixed(m < 100 ? 1 : 0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

const SQFT_PER_SQM = 10.7639104;
const SQM_PER_ACRE = 4046.8564224;

export function formatArea(m2: number): { sqm: string; sqft: string; acres: string } {
  return {
    sqm: `${m2.toFixed(m2 < 100 ? 1 : 0)} m²`,
    sqft: `${(m2 * SQFT_PER_SQM).toLocaleString("en-IN", { maximumFractionDigits: 0 })} sq ft`,
    acres: `${(m2 / SQM_PER_ACRE).toFixed(3)} acres`,
  };
}
