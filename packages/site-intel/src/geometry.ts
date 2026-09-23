// Pure geometry for site intelligence. No network, no Esri types — the ArcGIS
// client hands these functions plain rings and paths.
//
// Distances use a local equirectangular projection about the subject rather than
// haversine per segment: at neighbourhood scale the error is centimetres, and it
// makes point-to-segment projection ordinary planar algebra. Containment is ray
// casting in degrees, which is exact regardless of scale.

import { haversineMeters, type LatLng } from "./geo/measure";

/** A closed ring as ArcGIS returns it: [lng, lat] pairs. */
export type Ring = [number, number][];
/** An open path (polyline) as ArcGIS returns it. */
export type Path = [number, number][];

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres per degree of longitude at a given latitude. */
export function lngMetersPerDegree(lat: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(toRad(lat));
}

/** Metres per degree of latitude (constant on a sphere). */
export function latMetersPerDegree(): number {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

/**
 * A lat/lng envelope whose half-width is `meters` in both axes. Used to bound
 * an ArcGIS envelope query; the precise distance is always recomputed locally
 * afterwards, so an over-wide box costs bandwidth, never correctness.
 */
export function bboxAround(
  point: LatLng,
  meters: number,
): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const dLat = meters / latMetersPerDegree();
  const perLng = lngMetersPerDegree(point.lat);
  const dLng = perLng > 0 ? meters / perLng : dLat;
  return {
    xmin: point.lng - dLng,
    ymin: point.lat - dLat,
    xmax: point.lng + dLng,
    ymax: point.lat + dLat,
  };
}

/**
 * Ray casting. Counts crossings of the horizontal ray heading east from the
 * point; a vertex exactly on the ray is handled by the half-open `>` / `<=`
 * comparison, which is what keeps a shared vertex from counting twice.
 */
export function pointInRing(point: LatLng, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > point.lat !== yj > point.lat;
    if (!straddles) continue;
    const x = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (point.lng < x) inside = !inside;
  }
  return inside;
}

/**
 * Containment against an ArcGIS `rings` array, honouring holes: a point inside
 * an odd number of rings is inside the polygon. Esri encodes holes by winding
 * order, but parity gives the same answer for well-formed geometry without
 * needing to compute orientation.
 */
export function pointInRings(point: LatLng, rings: Ring[]): boolean {
  let hits = 0;
  for (const ring of rings) if (pointInRing(point, ring)) hits++;
  return hits % 2 === 1;
}

/** Perpendicular distance from `p` to segment `a`–`b`, in metres. */
export function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const mLat = latMetersPerDegree();
  const mLng = lngMetersPerDegree(p.lat);
  const px = 0;
  const py = 0;
  const ax = (a.lng - p.lng) * mLng;
  const ay = (a.lat - p.lat) * mLat;
  const bx = (b.lng - p.lng) * mLng;
  const by = (b.lat - p.lat) * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax - px, ay - py);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/** Shortest distance from `p` to any vertex-to-vertex segment of `path`. */
export function distanceToPathMeters(p: LatLng, path: Path): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineMeters(p, { lng: path[0][0], lat: path[0][1] });
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const a = { lng: path[i - 1][0], lat: path[i - 1][1] };
    const b = { lng: path[i][0], lat: path[i][1] };
    const d = distanceToSegmentMeters(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

/** Shortest distance to any of a multipart polyline's paths. */
export function distanceToPathsMeters(p: LatLng, paths: Path[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    const d = distanceToPathMeters(p, path);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Distance to a polygon: zero when the point is inside, otherwise the distance
 * to the nearest boundary edge. Callers that need to distinguish "inside" from
 * "on the edge" must test containment separately — both read as 0 here.
 */
export function distanceToRingsMeters(p: LatLng, rings: Ring[]): number {
  if (pointInRings(p, rings)) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    const d = distanceToPathMeters(p, ring);
    if (d < min) min = d;
  }
  return min;
}

/** Centroid of a ring set, used only for labelling a hit on a map. */
/**
 * A point that represents the polygon — and, importantly, one that lies inside
 * it. Every layer query for a parcel is run from this point, so a centroid that
 * lands in a neighbouring survey number or across a road would attribute the
 * wrong lake, zone and alignment to the plot.
 *
 * The area centroid is right for the common case. Cadastral parcels are often
 * L-shaped or crescent-shaped, though, and an area centroid can fall outside
 * those; when it does, fall back to the midpoint of the widest interior span
 * along the centroid's own latitude, which is always inside by construction.
 */
export function ringsCentroid(rings: Ring[]): LatLng | null {
  const outer = rings[0];
  if (!outer || outer.length === 0) return null;

  const areaCentroid = ringAreaCentroid(outer);
  if (areaCentroid && pointInRings(areaCentroid, rings)) return areaCentroid;

  const fallbackLat = areaCentroid ? areaCentroid.lat : vertexMean(rings)!.lat;
  const inside = widestInteriorMidpoint(rings, fallbackLat);
  if (inside) return inside;

  return areaCentroid ?? vertexMean(rings);
}

function vertexMean(rings: Ring[]): LatLng | null {
  let sumLat = 0;
  let sumLng = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
      n += 1;
    }
  }
  return n === 0 ? null : { lat: sumLat / n, lng: sumLng / n };
}

/** Shoelace centroid. Null when the ring encloses no area (a line, a point). */
function ringAreaCentroid(ring: Ring): LatLng | null {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = xj * yi - xi * yj;
    twiceArea += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) return null;
  return { lat: cy / (3 * twiceArea), lng: cx / (3 * twiceArea) };
}

/**
 * Cast a horizontal ray across the polygon at `lat` and return the midpoint of
 * its longest interior segment.
 */
function widestInteriorMidpoint(rings: Ring[], lat: number): LatLng | null {
  const crossings: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi === yj) continue;
      if (lat < Math.min(yi, yj) || lat >= Math.max(yi, yj)) continue;
      crossings.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
    }
  }
  if (crossings.length < 2) return null;
  crossings.sort((a, b) => a - b);

  let best: { lng: number; width: number } | null = null;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (!best || width > best.width) {
      best = { lng: (crossings[i] + crossings[i + 1]) / 2, width };
    }
  }
  return best && best.width > 0 ? { lat, lng: best.lng } : null;
}

/**
 * Initial bearing from `from` to `to`, degrees clockwise from north, 0–360.
 * Great-circle formula; at neighbourhood scale it agrees with the planar
 * answer to well under a degree, and it costs nothing to be right.
 */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

/** "north-east" for 45°, and so on round the eight points. */
export function compassLabel(bearing: number): (typeof COMPASS)[number] {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

/**
 * The vertex of a feature closest to `p`. Used to say which way a lake or an
 * alignment lies: the direction to its nearest edge is what a person standing
 * on the plot would point at, where the direction to its centroid can be
 * misleading for anything long or large.
 */
export function nearestVertex(p: LatLng, coords: [number, number][][]): LatLng | null {
  let best: LatLng | null = null;
  let min = Number.POSITIVE_INFINITY;
  for (const part of coords) {
    for (const [lng, lat] of part) {
      const d = haversineMeters(p, { lat, lng });
      if (d < min) {
        min = d;
        best = { lat, lng };
      }
    }
  }
  return best;
}

/**
 * The point on a set of paths (or rings) closest to `p`. This, not the nearest
 * vertex, is what "which way is the road" means: an alignment digitised as
 * one twenty-kilometre segment has both vertices far to the east and west
 * while the road itself passes just to the south.
 */
export function nearestPointOnPaths(p: LatLng, paths: [number, number][][]): LatLng | null {
  const mLat = latMetersPerDegree();
  const mLng = lngMetersPerDegree(p.lat);
  let best: LatLng | null = null;
  let min = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    if (path.length === 1) {
      const d = haversineMeters(p, { lng: path[0][0], lat: path[0][1] });
      if (d < min) {
        min = d;
        best = { lng: path[0][0], lat: path[0][1] };
      }
      continue;
    }
    for (let i = 1; i < path.length; i++) {
      const ax = (path[i - 1][0] - p.lng) * mLng;
      const ay = (path[i - 1][1] - p.lat) * mLat;
      const bx = (path[i][0] - p.lng) * mLng;
      const by = (path[i][1] - p.lat) * mLat;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const d = Math.hypot(qx, qy);
      if (d < min) {
        min = d;
        best = { lng: p.lng + qx / mLng, lat: p.lat + qy / mLat };
      }
    }
  }
  return best;
}
