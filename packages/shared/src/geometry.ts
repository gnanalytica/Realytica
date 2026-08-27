/**
 * Plane geometry over a parcel boundary.
 *
 * Zero dependencies, like the rest of this package, and deliberately modest
 * about what it claims. Every function here answers a question a surveyor
 * would answer better, and says so — the point is not to replace a survey but
 * to catch the cases where the polygon somebody supplied and the extent the
 * deed states are not the same parcel.
 *
 * --- The projection ------------------------------------------------------
 *
 * Coordinates arrive as latitude and longitude. Treating those as plane
 * coordinates is wrong everywhere and catastrophically wrong far from the
 * equator, so points are projected to metres on a local equirectangular
 * plane centred on the polygon itself. Over a parcel — tens or hundreds of
 * metres — that projection's error is far below the error in the boundary
 * data itself. Over a district it would not be, and nothing here should be
 * used at that scale.
 */

import type { BoundarySource, GeoPoint, ParcelBoundary } from './types';

/** Metres per degree of latitude. Constant enough at parcel scale. */
const METRES_PER_DEG_LAT = 111_320;

export interface PlanePoint {
  x: number;
  y: number;
}

/**
 * Project a ring to metres on a plane centred on its own centroid.
 *
 * Longitude degrees shrink with latitude, so the x scale is taken at the
 * ring's mean latitude. At Bengaluru's 13°N that is about 108.4 km/degree
 * against 111.3 at the equator — a 2.6% error if ignored, which on a 30x40
 * site is over a metre in the wrong direction.
 */
export function projectRing(ring: GeoPoint[]): PlanePoint[] {
  if (ring.length === 0) return [];
  const meanLat = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const meanLng = ring.reduce((sum, p) => sum + p.lng, 0) / ring.length;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);
  return ring.map(p => ({
    x: (p.lng - meanLng) * metresPerDegLng,
    y: (p.lat - meanLat) * METRES_PER_DEG_LAT,
  }));
}

/** Drop a duplicated closing vertex, which GeoJSON requires and the maths does not want. */
export function openRing(ring: PlanePoint[]): PlanePoint[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9;
  return closed ? ring.slice(0, -1) : ring;
}

/** Signed area by the shoelace formula. Positive for counter-clockwise. */
export function signedArea(ring: PlanePoint[]): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function areaSqm(ring: PlanePoint[]): number {
  return Math.abs(signedArea(ring));
}

export function perimeterM(ring: PlanePoint[]): number {
  const r = openRing(ring);
  if (r.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

export interface EdgeMetric {
  lengthM: number;
  /** Bearing in degrees from north, 0..360. */
  bearingDeg: number;
}

export function edges(ring: PlanePoint[]): EdgeMetric[] {
  const r = openRing(ring);
  const out: EdgeMetric[] = [];
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    out.push({
      lengthM: Math.hypot(dx, dy),
      bearingDeg: (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360,
    });
  }
  return out;
}

/**
 * Is the ring convex?
 *
 * Load-bearing, because the erosion below is exact for a convex polygon and
 * an overestimate for a concave one. A caller that does not know which it has
 * cannot know how much to trust the footprint, so this is reported rather
 * than assumed.
 */
export function isConvex(ring: PlanePoint[]): boolean {
  const r = openRing(ring);
  if (r.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const c = r[(i + 2) % r.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Area remaining after setting back `d` metres from every edge.
 *
 * For a convex polygon this is exact:
 *
 *     A' = A - P·d + d² · Σ cot(θᵢ/2)
 *
 * where θᵢ are the interior angles. The check that it is exact: a w×h
 * rectangle has four right angles, cot(45°) = 1, so the correction is 4d² and
 * the formula gives wh − 2d(w+h) + 4d² = (w−2d)(h−2d), which is the answer.
 *
 * For a concave polygon it overestimates, because a reflex corner eats more
 * than the formula credits. `isConvex` is what a caller checks before
 * believing it, and `boundaryMetrics` reports both rather than quietly
 * returning one number.
 *
 * Clamping at zero is not enough on its own, and getting that wrong is easy:
 * the expression is a parabola in `d`, so past the point where the polygon
 * has fully vanished it turns positive again and the footprint starts
 * *growing* with the setback. A 14.8m square set back 8m a side reported
 * 1.44 sqm — the square of the negative width — where the honest answer is
 * nothing at all.
 *
 * The parabola's vertex is exactly where the polygon collapses: dA'/dd = 0 at
 * d = P / (2·Σcot). Beyond that there is no parcel left, so the function
 * returns zero rather than the far branch of the curve. For the rectangle
 * above that vertex is 59.2/8 = 7.4m, which is the half-width — the right
 * answer, from the geometry rather than from a guard.
 */
export function erodedAreaSqm(ring: PlanePoint[], d: number): number {
  const r = openRing(ring);
  if (r.length < 3 || d <= 0) return areaSqm(r);
  const a = areaSqm(r);
  const p = perimeterM(r);

  let cornerCorrection = 0;
  for (let i = 0; i < r.length; i += 1) {
    const prev = r[(i - 1 + r.length) % r.length];
    const cur = r[i];
    const next = r[(i + 1) % r.length];
    const v1x = prev.x - cur.x;
    const v1y = prev.y - cur.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    const theta = Math.acos(cos);
    const half = theta / 2;
    if (Math.abs(Math.tan(half)) < 1e-9) continue;
    cornerCorrection += 1 / Math.tan(half);
  }

  // Past the parabola's vertex the polygon has vanished and the expression
  // starts climbing again. Anything at or beyond that setback leaves nothing.
  if (cornerCorrection > 1e-9 && d >= p / (2 * cornerCorrection)) return 0;

  return Math.max(a - p * d + d * d * cornerCorrection, 0);
}

export interface BoundaryMetrics {
  areaSqm: number;
  perimeterM: number;
  /** Longest edge — the best available proxy for frontage without knowing which edge faces the road. */
  longestEdgeM: number;
  shortestEdgeM: number;
  vertexCount: number;
  convex: boolean;
  /**
   * How elongated the parcel is: longest edge over shortest. A high ratio is
   * what makes the square-plot assumption in a schematic yield wrong, and by
   * how much.
   */
  elongation: number;
}

export function boundaryMetrics(ring: GeoPoint[]): BoundaryMetrics | null {
  const projected = openRing(projectRing(ring));
  if (projected.length < 3) return null;
  const es = edges(projected);
  const lengths = es.map(e => e.lengthM).filter(l => l > 0.01);
  if (lengths.length === 0) return null;
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  return {
    areaSqm: areaSqm(projected),
    perimeterM: perimeterM(projected),
    longestEdgeM: longest,
    shortestEdgeM: shortest,
    vertexCount: projected.length,
    convex: isConvex(projected),
    elongation: shortest > 0 ? longest / shortest : 1,
  };
}

/* ==================================================================== */
/* Reading a boundary somebody supplied                                  */
/* ==================================================================== */

/**
 * Parse a ring out of GeoJSON or KML.
 *
 * Deliberately narrow. It reads the outer ring of the first polygon it finds
 * and nothing else: no holes, no multipolygons, no coordinate reference
 * system other than WGS84, no styling. A parcel is one closed outline, and a
 * parser that silently picked one polygon out of a file containing five would
 * be choosing which land the user meant.
 *
 * Returns a named reason rather than throwing, so a bad file produces a
 * sentence a person can act on instead of a stack trace.
 */
export type BoundaryParse =
  | { ok: true; ring: GeoPoint[]; format: 'uploaded_geojson' | 'uploaded_kml' }
  | { ok: false; reason: string };

const MAX_VERTICES = 2000;

function validRing(points: GeoPoint[], format: 'uploaded_geojson' | 'uploaded_kml'): BoundaryParse {
  const cleaned = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (cleaned.length < 4) {
    return { ok: false, reason: 'That file does not contain a closed polygon — a parcel outline needs at least three distinct corners.' };
  }
  if (cleaned.length > MAX_VERTICES) {
    return { ok: false, reason: `That outline has ${cleaned.length} points, which is far more than a parcel boundary. It looks like a district or a road network rather than one plot.` };
  }
  const outOfRange = cleaned.find(p => Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180);
  if (outOfRange) {
    return { ok: false, reason: 'The coordinates are not latitude and longitude. A file in a projected grid (UTM, or a local survey grid) has to be converted to WGS84 first.' };
  }
  const metrics = boundaryMetrics(cleaned);
  if (!metrics || metrics.areaSqm <= 0) {
    return { ok: false, reason: 'That outline encloses no area — the points may be collinear, or listed in an order that folds the shape onto itself.' };
  }
  return { ok: true, ring: cleaned, format };
}

interface GeoJsonLike {
  type?: string;
  geometry?: GeoJsonLike;
  features?: GeoJsonLike[];
  geometries?: GeoJsonLike[];
  coordinates?: unknown;
}

/** Depth-first walk for the first Polygon, so a FeatureCollection works too. */
function findPolygon(node: GeoJsonLike | undefined): number[][] | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Polygon' && Array.isArray(node.coordinates)) {
    const outer = (node.coordinates as unknown[])[0];
    return Array.isArray(outer) ? (outer as number[][]) : null;
  }
  if (node.geometry) {
    const found = findPolygon(node.geometry);
    if (found) return found;
  }
  for (const child of [...(node.features ?? []), ...(node.geometries ?? [])]) {
    const found = findPolygon(child);
    if (found) return found;
  }
  return null;
}

export function parseBoundary(text: string): BoundaryParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'The file is empty.' };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: GeoJsonLike;
    try {
      parsed = JSON.parse(trimmed) as GeoJsonLike;
    } catch {
      return { ok: false, reason: 'That looks like JSON but could not be parsed. Check it is valid GeoJSON.' };
    }
    const coords = findPolygon(parsed);
    if (!coords) {
      return { ok: false, reason: 'No Polygon was found in that GeoJSON. A parcel boundary is a Polygon — a Point or a LineString cannot enclose land.' };
    }
    // GeoJSON is [longitude, latitude]. Reversing that is the single most
    // common way a boundary ends up in the sea off Somalia.
    return validRing(coords.map(c => ({ lat: Number(c[1]), lng: Number(c[0]) })), 'uploaded_geojson');
  }

  if (/<kml|<coordinates/i.test(trimmed)) {
    const match = trimmed.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
    if (!match) {
      return { ok: false, reason: 'No <coordinates> element was found in that KML.' };
    }
    const points = match[1]
      .trim()
      .split(/\s+/)
      .map(tuple => {
        // KML is longitude,latitude[,altitude] — the same order as GeoJSON.
        const [lng, lat] = tuple.split(',').map(Number);
        return { lat, lng };
      });
    return validRing(points, 'uploaded_kml');
  }

  return { ok: false, reason: 'That file is neither GeoJSON nor KML. Export the parcel outline as one of those and try again.' };
}

/**
 * Assemble a stored boundary from a ring, computing its metrics once.
 *
 * The metrics are stored rather than recomputed on read for one reason worth
 * stating: they are what a user was shown when they accepted the boundary,
 * and a later change to the projection or the formula must not silently
 * restate the area of a parcel somebody already made a decision about.
 */
export function buildBoundary(
  ring: GeoPoint[],
  source: BoundarySource,
  suppliedAt: string,
  suppliedNote?: string,
): ParcelBoundary | null {
  const m = boundaryMetrics(ring);
  if (!m) return null;
  return {
    ring,
    source,
    suppliedAt,
    suppliedNote,
    computedAreaSqm: Math.round(m.areaSqm * 100) / 100,
    perimeterM: Math.round(m.perimeterM * 100) / 100,
    longestEdgeM: Math.round(m.longestEdgeM * 100) / 100,
    shortestEdgeM: Math.round(m.shortestEdgeM * 100) / 100,
    convex: m.convex,
    elongation: Math.round(m.elongation * 100) / 100,
  };
}
