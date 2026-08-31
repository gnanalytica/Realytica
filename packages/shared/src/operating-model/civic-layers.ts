/**
 * Named polygons from a civic KML/GeoJSON layer — wards, lakes, not a parcel.
 *
 * A parcel parser that picked one ring out of 369 wards would choose the
 * wrong land. This walks every placemark/feature, keeps a bbox, and lets
 * the overlay clip to the pin.
 */

import { distancePointToPolygonM, pointInRing, ringsOverlap } from '../geometry';
import type { GeoPoint } from '../types';

export interface NamedRing {
  id: string;
  name: string;
  ring: GeoPoint[];
  bbox: { south: number; west: number; north: number; east: number };
}

export interface CivicNearHit {
  feature: NamedRing;
  metres: number;
  inside: boolean;
  overlapsSurvey: boolean;
}

function bboxOf(ring: GeoPoint[]): NamedRing['bbox'] {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const p of ring) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }
  return { south, west, north, east };
}

function bboxTouches(
  box: NamedRing['bbox'],
  south: number,
  west: number,
  north: number,
  east: number,
): boolean {
  return box.south <= north && box.north >= south && box.west <= east && box.east >= west;
}

function cleanName(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function coordsToRing(text: string): GeoPoint[] {
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lng, lat] = tuple.split(',').map(Number);
      return { lat, lng };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
}

function nameFromProps(props: Record<string, unknown> | undefined): string {
  if (!props) return '';
  for (const key of ['name', 'Name', 'NAME', 'ward_name', 'WARD_NAME', 'WardName', 'lake', 'LAKE_NAME', 'LakeName']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function polygonOuter(coords: unknown): GeoPoint[] {
  if (!Array.isArray(coords) || !Array.isArray(coords[0])) return [];
  const outer = coords[0] as number[][];
  return outer
    .map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

const MAX_RING = 8_000;

function acceptRing(ring: GeoPoint[]): GeoPoint[] | null {
  if (ring.length < 4 || ring.length > MAX_RING) return null;
  return ring;
}

export function parseNamedPolygons(text: string, idPrefix: string): NamedRing[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const out: NamedRing[] = [];

  const push = (name: string, ring: GeoPoint[]) => {
    const accepted = acceptRing(ring);
    if (!accepted) return;
    out.push({
      id: `${idPrefix}_${out.length}`,
      name: name || `${idPrefix} ${out.length + 1}`,
      ring: accepted,
      bbox: bboxOf(accepted),
    });
  };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown }; type?: string; coordinates?: unknown }>;
        geometry?: { type?: string; coordinates?: unknown };
        coordinates?: unknown;
        properties?: Record<string, unknown>;
      };
      const features = Array.isArray(parsed.features) ? parsed.features : [parsed];
      for (const f of features) {
        const geom = f.geometry ?? f;
        const name = nameFromProps(f.properties);
        if (geom.type === 'Polygon') push(name, polygonOuter(geom.coordinates));
        if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
          for (const poly of geom.coordinates as unknown[]) push(name, polygonOuter(poly));
        }
      }
    } catch {
      return [];
    }
    return out;
  }

  if (!/<kml|<placemark|<coordinates/i.test(trimmed)) return [];
  const marks = trimmed.match(/<placemark\b[\s\S]*?<\/placemark>/gi) ?? [trimmed];
  for (const mark of marks) {
    const nameMatch = mark.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
    const name = cleanName(nameMatch?.[1] ?? '');
    const blocks = mark.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/gi) ?? [];
    for (const block of blocks) {
      const inner = block.replace(/<\/?coordinates\b[^>]*>/gi, '');
      push(name, coordsToRing(inner));
    }
  }
  return out;
}

export function simplifyRing(ring: GeoPoint[], maxVertices = 80): GeoPoint[] {
  if (ring.length <= maxVertices) return ring;
  const step = Math.ceil(ring.length / maxVertices);
  const out: GeoPoint[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const first = out[0];
  if (last && first && (last.lat !== out[out.length - 1]?.lat || last.lng !== out[out.length - 1]?.lng)) {
    out.push(last);
  }
  return out;
}

export function civicHitsNear(
  layers: NamedRing[],
  pin: GeoPoint | null,
  survey: GeoPoint[] | undefined,
  radiusM: number,
): CivicNearHit[] {
  if (!pin && !survey?.length) return [];
  const origin = pin ?? survey![0];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const south = origin.lat - dLat;
  const north = origin.lat + dLat;
  const west = origin.lng - dLng;
  const east = origin.lng + dLng;
  const hits: CivicNearHit[] = [];
  for (const feature of layers) {
    if (!bboxTouches(feature.bbox, south, west, north, east)) continue;
    const inside = pin ? pointInRing(pin, feature.ring) : false;
    const metres = pin ? distancePointToPolygonM(pin, feature.ring) : Number.POSITIVE_INFINITY;
    const overlapsSurvey = Boolean(survey && ringsOverlap(survey, feature.ring));
    if (!inside && !overlapsSurvey && !(Number.isFinite(metres) && metres <= radiusM)) continue;
    hits.push({ feature, metres: Number.isFinite(metres) ? metres : 0, inside, overlapsSurvey });
  }
  hits.sort((a, b) => a.metres - b.metres);
  return hits;
}

export function matchNamedResources(
  resources: Array<{ name: string; url: string }>,
  hay: string,
  limit = 4,
): Array<{ name: string; url: string }> {
  const tokens = hay
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return [];
  const scored = resources
    .map((row) => {
      const name = row.name.toLowerCase();
      let score = 0;
      for (const t of tokens) if (name.includes(t)) score += 1;
      return { row, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  const seen = new Set<string>();
  const out: Array<{ name: string; url: string }> = [];
  for (const hit of scored) {
    if (seen.has(hit.row.url)) continue;
    seen.add(hit.row.url);
    out.push(hit.row);
    if (out.length >= limit) break;
  }
  return out;
}
