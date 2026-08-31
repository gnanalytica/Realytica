/**
 * GIS context overlay: pin and optional survey sketch versus OpenStreetMap.
 *
 * This is a geometric overlay. It is not the RMP sheet, not a BBMP/BDA drain
 * class, and not this file's evidence. OSM water is a blue shape on a
 * volunteer map. The statutory hatch still has to be obtained on the land-use
 * sitting and filed by a person.
 */

import {
  buildBoundary,
  distancePointToPathM,
  distancePointToPolygonM,
  parseBoundary,
  pointInRing,
  ringsOverlap,
} from '../geometry';
import type { GeoPoint, ParcelBoundary } from '../types';
import {
  compareProjectPlanning,
  planningPinOf,
  type PlanningOverlayPin,
  type PlanningOverlayRead,
} from './planning-overlay';
import { planningMapsFor, type PlanningMapSource, type PlanningRealm } from './planning-maps';
import { civicHitsNear, matchNamedResources, simplifyRing, type NamedRing } from './civic-layers';
import type { ChatPlacesPull, DdProject } from './types';
import type { SittingRef } from './sitting';

export const GIS_OVERLAY_RADIUS_M = 1_200;

export type GisContextKind = 'osm_water' | 'osm_waterway' | 'osm_landuse' | 'civic_lake' | 'civic_ward';

export interface GisContextFeature {
  id: string;
  kind: GisContextKind;
  name?: string;
  /** Closed outer ring when OSM sent a polygon. */
  ring?: GeoPoint[];
  /** Open polyline (drains, streams). */
  line?: GeoPoint[];
  landuse?: string;
}

export interface GisOverlayHit {
  code:
    | 'not_rmp'
    | 'not_drain_class'
    | 'no_pin'
    | 'survey_on_file'
    | 'survey_area'
    | 'osm_water_overlap'
    | 'osm_water_inside'
    | 'osm_water_near'
    | 'osm_landuse_at_pin'
    | 'osm_unavailable'
    | 'map_sitting'
    | 'civic_ward'
    | 'civic_lake'
    | 'civic_lake_overlap'
    | 'withdrawn_sheet';
  severity: 'info' | 'flag';
  standing: 'context' | 'survey' | 'statute_needed';
  text: string;
  metres?: number;
  featureId?: string;
}

export interface GisOverlayRead {
  notStatute: true;
  notEvidence: true;
  notRmpGeometry: true;
  pin: PlanningOverlayPin | null;
  survey: {
    ring: GeoPoint[];
    source: ParcelBoundary['source'];
    computedAreaSqm: number;
    suppliedNote?: string;
    caveat: string;
  } | null;
  features: GisContextFeature[];
  hits: GisOverlayHit[];
  planning: PlanningOverlayRead;
  maps: {
    realm: PlanningRealm;
    sittings: PlanningMapSource[];
    liveOverlays: PlanningMapSource[];
    refused: PlanningMapSource[];
  };
  withdrawnSheets: Array<{ name: string; url: string; standing: 'withdrawn' }>;
  dpplansHint?: string;
  osm: {
    standing: 'context';
    fetchedAt?: string;
    featureCount: number;
    error?: string;
  };
  radiusM: number;
}

export interface OsmElementLike {
  type?: string;
  id?: number | string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
}

const NEAR_WATER_FLAG_M = 80;
const MAX_OSM_FEATURES = 80;
const CLOSED_EPS = 1e-6;

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function isClosed(points: GeoPoint[]): boolean {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.abs(a.lat - b.lat) < CLOSED_EPS && Math.abs(a.lng - b.lng) < CLOSED_EPS;
}

function aboutMetres(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (n < 20) return Math.round(n);
  return Math.round(n / 10) * 10;
}

function classify(tags: Record<string, string> | undefined): GisContextKind | null {
  if (!tags) return null;
  if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') {
    return 'osm_water';
  }
  if (tags.waterway) return 'osm_waterway';
  if (tags.landuse) return 'osm_landuse';
  return null;
}

function featureName(tags: Record<string, string> | undefined, kind: GisContextKind): string | undefined {
  if (!tags) return undefined;
  if (tags.name) return tags.name;
  if (kind === 'osm_waterway' && tags.waterway) return tags.waterway.replace(/_/g, ' ');
  if (kind === 'osm_landuse' && tags.landuse) return tags.landuse.replace(/_/g, ' ');
  if (kind === 'osm_water') return tags.natural === 'water' ? 'water' : tags.landuse?.replace(/_/g, ' ');
  return undefined;
}

/** Parse Overpass `out geom` ways into overlay features. Relations are skipped (incomplete rings). */
export function osmElementsToFeatures(elements: OsmElementLike[]): GisContextFeature[] {
  const out: GisContextFeature[] = [];
  for (const el of elements) {
    if (el.type !== 'way' && el.type !== undefined) continue;
    const kind = classify(el.tags);
    if (!kind) continue;
    const geom = (el.geometry ?? [])
      .map((g) => ({ lat: Number(g.lat), lng: Number(g.lon) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (geom.length < 2) continue;
    const closed = isClosed(geom);
    const feature: GisContextFeature = {
      id: `osm_${el.id ?? out.length}`,
      kind,
      name: featureName(el.tags, kind),
      landuse: el.tags?.landuse,
    };
    if (kind === 'osm_waterway' && !closed) {
      feature.line = geom;
    } else if (closed && geom.length >= 4) {
      feature.ring = geom;
    } else if (kind === 'osm_waterway' || kind === 'osm_water') {
      feature.line = geom;
    } else {
      continue;
    }
    out.push(feature);
    if (out.length >= MAX_OSM_FEATURES) break;
  }
  return out;
}

const SURVEY_CAVEAT =
  'Supplied survey outline — not a polygon this product drew, and not the land-use hatch on the RMP sheet.';

export function surveyOf(project: DdProject): GisOverlayRead['survey'] {
  const b = project.surveyBoundary;
  if (!b?.ring?.length) return null;
  return {
    ring: b.ring,
    source: b.source,
    computedAreaSqm: b.computedAreaSqm,
    suppliedNote: b.suppliedNote,
    caveat: SURVEY_CAVEAT,
  };
}

export function applySurveyBoundary(
  project: DdProject,
  fileText: string,
  note?: string,
  actor = 'operator',
): ParcelBoundary {
  const parsed = parseBoundary(fileText);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const source = parsed.format === 'uploaded_kml' ? 'uploaded_kml' : 'uploaded_geojson';
  const boundary = buildBoundary(parsed.ring, source, nowIso(), note);
  if (!boundary) {
    throw new Error('That outline encloses no area.');
  }
  project.surveyBoundary = boundary;
  project.updatedAt = boundary.suppliedAt;
  if (!project.audit) project.audit = [];
  project.audit.push({
    id: id('aud'),
    at: boundary.suppliedAt,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    newValue: note ?? source,
  });
  return boundary;
}

export function clearSurveyBoundary(project: DdProject, actor = 'operator'): void {
  if (!project.surveyBoundary) return;
  const at = nowIso();
  project.surveyBoundary = undefined;
  project.updatedAt = at;
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    oldValue: 'surveyBoundary',
  });
}

function waterHits(
  pin: PlanningOverlayPin | null,
  surveyRing: GeoPoint[] | undefined,
  features: GisContextFeature[],
): GisOverlayHit[] {
  const hits: GisOverlayHit[] = [];
  const waters = features.filter((f) => f.kind === 'osm_water' || f.kind === 'osm_waterway');
  if (!waters.length) return hits;

  if (surveyRing) {
    for (const f of waters) {
      if (f.ring && ringsOverlap(surveyRing, f.ring)) {
        hits.push({
          code: 'osm_water_overlap',
          severity: 'flag',
          standing: 'context',
          featureId: f.id,
          metres: 0,
          text: `The supplied survey outline overlaps OSM ${f.name ?? 'water'} (${f.kind.replace('osm_', '')}). That is volunteer map geometry — not a classified lake or rajakaluve, and not a buffer under NGT. Obtain the current BDA/BBMP drain map and file it.`,
        });
      }
    }
  }

  if (pin) {
    const origin = { lat: pin.lat, lng: pin.lng };
    let nearest: { feature: GisContextFeature; metres: number; inside: boolean } | undefined;
    for (const f of waters) {
      let metres = Number.POSITIVE_INFINITY;
      let inside = false;
      if (f.ring) {
        metres = distancePointToPolygonM(origin, f.ring);
        inside = metres === 0 && pointInRing(origin, f.ring);
      } else if (f.line) {
        metres = distancePointToPathM(origin, f.line);
      }
      if (!Number.isFinite(metres)) continue;
      if (!nearest || metres < nearest.metres) nearest = { feature: f, metres, inside };
    }
    if (nearest) {
      const metres = aboutMetres(nearest.metres);
      const label = nearest.feature.name ?? 'OSM water';
      if (nearest.inside) {
        hits.push({
          code: 'osm_water_inside',
          severity: 'flag',
          standing: 'context',
          featureId: nearest.feature.id,
          metres: 0,
          text: `The geocoded pin sits inside OSM “${label}”. A pin is not a parcel, and OSM water is not the legal lake/drain class. Confirm against the survey sketch and the current drain map.`,
        });
      } else {
        hits.push({
          code: nearest.metres <= NEAR_WATER_FLAG_M ? 'osm_water_near' : 'osm_water_near',
          severity: nearest.metres <= NEAR_WATER_FLAG_M ? 'flag' : 'info',
          standing: 'context',
          featureId: nearest.feature.id,
          metres,
          text: `Nearest OSM water/waterway (“${label}”) is about ${metres} m from the pin. CONTEXT only — not a statutory buffer, not measured to a classified rajakaluve.`,
        });
      }
    }
  }

  return hits;
}

function landuseHit(pin: PlanningOverlayPin | null, features: GisContextFeature[]): GisOverlayHit | undefined {
  if (!pin) return undefined;
  const origin = { lat: pin.lat, lng: pin.lng };
  for (const f of features) {
    if (f.kind !== 'osm_landuse' || !f.ring) continue;
    if (!pointInRing(origin, f.ring)) continue;
    const label = (f.landuse ?? f.name ?? 'unlabelled').replace(/_/g, ' ');
    return {
      code: 'osm_landuse_at_pin',
      severity: 'info',
      standing: 'context',
      featureId: f.id,
      text: `OSM landuse at the pin is “${label}”. That is not the RMP 2015 hatch for this survey number. File the BDA/LPA extract on the land-use check.`,
    };
  }
  return undefined;
}

export function compareProjectGis(
  project: DdProject,
  extra?: {
    sitting?: SittingRef;
    places?: ChatPlacesPull;
    osm?: { features: GisContextFeature[]; fetchedAt?: string; error?: string };
    civic?: { lakes?: NamedRing[]; wards?: NamedRing[]; error?: string };
    withdrawnSheets?: Array<{ name: string; url: string }>;
  },
): GisOverlayRead {
  const planning = compareProjectPlanning(project, { sitting: extra?.sitting, places: extra?.places });
  const pin = planning.pin ?? planningPinOf(project, extra?.places);
  const survey = surveyOf(project);
  const osmFeatures = extra?.osm?.features ?? [];
  const civicLakes = extra?.civic?.lakes ?? [];
  const civicWards = extra?.civic?.wards ?? [];
  const origin = pin ? { lat: pin.lat, lng: pin.lng } : null;
  const lakeHits = civicHitsNear(civicLakes, origin, survey?.ring, GIS_OVERLAY_RADIUS_M).slice(0, 12);
  const wardHits = civicHitsNear(civicWards, origin, survey?.ring, GIS_OVERLAY_RADIUS_M).slice(0, 8);
  const civicFeatures: GisContextFeature[] = [
    ...lakeHits.map((h) => ({
      id: h.feature.id,
      kind: 'civic_lake' as const,
      name: h.feature.name,
      ring: simplifyRing(h.feature.ring),
    })),
    ...wardHits.map((h) => ({
      id: h.feature.id,
      kind: 'civic_ward' as const,
      name: h.feature.name,
      ring: simplifyRing(h.feature.ring),
    })),
  ];
  const features = [...osmFeatures, ...civicFeatures];
  const hits: GisOverlayHit[] = [
    {
      code: 'not_rmp',
      severity: 'info',
      standing: 'statute_needed',
      text: 'This overlay intersects the pin (and a supplied survey sketch, if any) with OpenStreetMap and OpenCity civic layers (GBA wards, BBMP lakes). It does not georeference RMP map sheets. The land-use hatch still has to be read from the sheet or a certified extract.',
    },
    {
      code: 'not_drain_class',
      severity: 'info',
      standing: 'context',
      text: 'OSM water is not the current BBMP/BDA drain map. Lake and rajakaluve class — and which buffer binds — is revised by NGT and court directions. Do not treat a blue OSM polygon as that classification.',
    },
  ];

  if (!pin) {
    hits.push({
      code: 'no_pin',
      severity: 'flag',
      standing: 'statute_needed',
      text: 'No geocoded pin on this project, so there is nothing to overlay. Maps can place the address; it still is not a boundary.',
    });
  }

  if (survey) {
    hits.push({
      code: 'survey_on_file',
      severity: 'info',
      standing: 'survey',
      text: `Survey outline on file (${survey.source.replace(/_/g, ' ')}${survey.suppliedNote ? `, ${survey.suppliedNote}` : ''}): ${Math.round(survey.computedAreaSqm).toLocaleString()} sqm. ${survey.caveat}`,
    });
    if (project.landAreaSqm && project.landAreaSqm > 0) {
      const diffPct = ((survey.computedAreaSqm - project.landAreaSqm) / project.landAreaSqm) * 100;
      if (Math.abs(diffPct) >= 5) {
        hits.push({
          code: 'survey_area',
          severity: 'flag',
          standing: 'survey',
          text: `The outline encloses ${Math.abs(diffPct).toFixed(1)}% ${diffPct < 0 ? 'less' : 'more'} than the land area on this project (${Math.round(project.landAreaSqm).toLocaleString()} sqm). Both figures are kept. Reconciling them belongs to a surveyor — not this overlay.`,
        });
      }
    }
  }

  if (extra?.osm?.error) {
    hits.push({
      code: 'osm_unavailable',
      severity: 'info',
      standing: 'context',
      text: `OpenStreetMap context did not load (${extra.osm.error}). The pin and survey sketch still draw. Statutory land use is unchanged: obtain the RMP / LPA sheet.`,
    });
  }

  hits.push(...waterHits(pin, survey?.ring, osmFeatures));
  const landuse = landuseHit(pin, osmFeatures);
  if (landuse) hits.push(landuse);

  if (extra?.civic?.error) {
    hits.push({
      code: 'osm_unavailable',
      severity: 'info',
      standing: 'context',
      text: `OpenCity civic layers did not fully load (${extra.civic.error}). Ward/lake overlay may be incomplete.`,
    });
  }
  for (const h of wardHits) {
    if (!h.inside && !h.overlapsSurvey) continue;
    hits.push({
      code: 'civic_ward',
      severity: 'info',
      standing: 'context',
      featureId: h.feature.id,
      metres: aboutMetres(h.metres),
      text: `OpenCity GBA ward overlay: “${h.feature.name}” ${h.inside ? 'contains the pin' : 'overlaps the survey sketch'}. Civic delimitation (2025), not RMP land use. Source: data.opencity.in.`,
    });
  }
  for (const h of lakeHits.slice(0, 6)) {
    if (h.overlapsSurvey || h.inside) {
      hits.push({
        code: 'civic_lake_overlap',
        severity: 'flag',
        standing: 'context',
        featureId: h.feature.id,
        metres: aboutMetres(h.metres),
        text: `OpenCity BBMP lakes layer: “${h.feature.name}” ${h.inside ? 'contains the pin' : 'overlaps the survey sketch'}. CONTEXT — not drain class, not NGT buffer. Confirm on BBMP GIS / LMS.`,
      });
    } else if (h.metres <= 80) {
      hits.push({
        code: 'civic_lake',
        severity: 'flag',
        standing: 'context',
        featureId: h.feature.id,
        metres: aboutMetres(h.metres),
        text: `OpenCity BBMP lake “${h.feature.name}” is about ${aboutMetres(h.metres)} m from the pin. CONTEXT, not a classified buffer.`,
      });
    }
  }

  const maps = planningMapsFor(project, pin);
  for (const sitting of maps.sittings) {
    hits.push({
      code: 'map_sitting',
      severity: 'info',
      standing: sitting.key === 'bda_rmp' || sitting.key === 'bmrda_maps' ? 'statute_needed' : 'context',
      text: `Open ${sitting.label} (${sitting.url}). ${sitting.shows} ${sitting.caveat}`,
    });
  }

  const dpplansHint = pin
    ? `DPPlans is a paid third-party viewer, not the sanctioned sheet. You can search ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)} there yourself; do not scrape or file their JPEG as this project's extract.`
    : undefined;
  if (dpplansHint) {
    hits.push({ code: 'map_sitting', severity: 'info', standing: 'context', text: dpplansHint });
  }

  const hay = [project.location, project.siteAddress, project.city, project.name].filter(Boolean).join(' ');
  const matchedSheets = matchNamedResources(extra?.withdrawnSheets ?? [], hay);
  const withdrawnSheets = matchedSheets.map((s) => ({ ...s, standing: 'withdrawn' as const }));
  for (const sheet of withdrawnSheets) {
    hits.push({
      code: 'withdrawn_sheet',
      severity: 'info',
      standing: 'context',
      text: `Withdrawn RMP-2031 archive (not in force): ${sheet.name}. ${sheet.url} RMP 2015 remains the plan in force — do not file this PDF as the extract.`,
    });
  }

  return {
    notStatute: true,
    notEvidence: true,
    notRmpGeometry: true,
    pin,
    survey,
    features,
    hits,
    planning,
    maps,
    withdrawnSheets,
    dpplansHint,
    osm: {
      standing: 'context',
      fetchedAt: extra?.osm?.fetchedAt,
      featureCount: osmFeatures.length,
      error: extra?.osm?.error,
    },
    radiusM: GIS_OVERLAY_RADIUS_M,
  };
}

export function serializeGisOverlay(read: GisOverlayRead): string {
  const lines = [
    'GIS CONTEXT OVERLAY — pin and optional survey sketch versus OpenStreetMap. Not the RMP sheet. Not this project\'s evidence until a person files the extract or the survey.',
    read.pin
      ? `Pin: ${read.pin.lat.toFixed(5)}, ${read.pin.lng.toFixed(5)}${read.pin.resolvedAddress ? ` — ${read.pin.resolvedAddress}` : ''}. ${read.pin.caveat}`
      : 'Pin: none on this file.',
  ];
  if (read.survey) {
    lines.push(
      `Survey sketch: ${Math.round(read.survey.computedAreaSqm).toLocaleString()} sqm (${read.survey.source.replace(/_/g, ' ')}). ${read.survey.caveat}`,
    );
  } else {
    lines.push('Survey sketch: not on file. Upload a surveyor\'s GeoJSON or KML to draw an outline. A mouse-drawn shape is not a survey.');
  }
  const civicLakes = read.features.filter((f) => f.kind === 'civic_lake').length;
  const civicWards = read.features.filter((f) => f.kind === 'civic_ward').length;
  lines.push(
    `OSM context: ${read.osm.featureCount} feature${read.osm.featureCount === 1 ? '' : 's'} within ~${read.radiusM} m${read.osm.error ? ` (${read.osm.error})` : ''}. Standing: CONTEXT.`,
    `OpenCity civic: ${civicLakes} lake clip${civicLakes === 1 ? '' : 's'}, ${civicWards} ward clip${civicWards === 1 ? '' : 's'} (GBA 2025 / BBMP lakes). CONTEXT, not RMP, not drain class.`,
    `Planning realm: ${read.maps.realm}. Sittings: ${read.maps.sittings.map((s) => s.label).join('; ') || 'none'}.`,
  );
  if (read.dpplansHint) lines.push(read.dpplansHint);
  for (const sheet of read.withdrawnSheets) {
    lines.push(`Withdrawn (not in force): ${sheet.name} ${sheet.url}`);
  }
  for (const hit of read.hits) {
    lines.push(`• [${hit.severity}/${hit.standing}] ${hit.text}`);
  }
  return lines.join('\n');
}

export function wantsGisOverlay(question: string): boolean {
  const q = question.trim();
  return (
    /\b(gis overlay|map overlay|osm overlay|show (it )?on the map|intersect.{0,30}(map|osm|survey|water))\b/i.test(q)
    || /\b(overlay).{0,20}\b(map|osm|survey|gis)\b/i.test(q)
  );
}
