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
import { haversineMetres } from '../site';
import {
  REVENUE_MAP_CAVEAT,
  extentAgainstDocuments,
  extentAgainstMap,
  parcelLabels,
  revenueExtent,
  revenueLayerLabel,
  revenueSiteBrief,
  siteRevenueFeatures,
  surveyNumbersLabel,
  unacceptedWords,
  wholeNumberWords,
  type RevenueExtent,
  type RevenueExtentParcel,
  type RevenueMapFeature,
  type RevenueMapFeatureKind,
  type RevenueMapRead,
  type RevenueSiteItem,
} from './revenue-map';

export const GIS_OVERLAY_RADIUS_M = 1_200;

export type GisContextKind =
  | 'osm_water'
  | 'osm_waterway'
  | 'osm_landuse'
  | 'civic_lake'
  | 'civic_ward'
  /** The state's own layers, read for the survey number on file — see `revenue-map.ts`. */
  | RevenueMapFeatureKind;

export interface GisContextFeature {
  id: string;
  kind: GisContextKind;
  name?: string;
  /** Closed outer ring when OSM sent a polygon. */
  ring?: GeoPoint[];
  /** Open polyline (drains, streams). */
  line?: GeoPoint[];
  /** A station or similar node. Only revenue-map features carry one. */
  point?: GeoPoint;
  landuse?: string;
  /** Revenue-map features: which government layer, and how far from the parcel. */
  layerKey?: string;
  distanceM?: number;
  /** Once several parcels are read: the one `distanceM` is measured from, the nearest, as it is told from the others. */
  nearestSurveyNo?: string;
}

/** One parcel read from the state's map, as the overlay draws it. */
export interface GisOverlayParcel {
  parcelRef: string;
  surveyNo: string;
  /** The number as it is told from the others: with its village where two parcels carry the same one. */
  label: string;
  /** The outline the read measured: the first ring the state's map holds for the number. */
  ring: GeoPoint[];
  areaSqm: number;
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
    | 'withdrawn_sheet'
    | 'revenue_parcel'
    | 'revenue_far_from_pin'
    | 'revenue_extent'
    | 'revenue_documents_extent'
    | 'revenue_prohibited'
    | 'revenue_register_unjoined'
    | 'revenue_factor'
    | 'revenue_insight'
    | 'revenue_anchor'
    | 'revenue_unread';
  severity: 'info' | 'flag';
  /**
   * `record` is a government layer read by machine for this survey number:
   * stronger than volunteer context, weaker than a filed extract.
   */
  standing: 'context' | 'survey' | 'record' | 'statute_needed';
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
  /**
   * Every parcel read from the state's map, each drawn with its survey
   * number. `survey` above stays one outline: a person's, or the first of
   * these. Absent from an overlay built before several were kept.
   */
  parcels?: GisOverlayParcel[];
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
  /** Present once the revenue map has been read for this file. */
  revenue?: {
    standing: 'record';
    readAt: string;
    state: RevenueMapRead['state'];
    surveyNo: string;
    village: string | null;
    sourceLabel: string;
    featureCount: number;
    unreadLayers: string[];
    caveat: string;
  };
  dpplansHint?: string;
  osm: {
    standing: 'context';
    fetchedAt?: string;
    featureCount: number;
    error?: string;
  };
  radiusM: number;
}

/** No closer than this either side of the centre: a small plot keeps the roads and neighbours that place it. */
export const SITE_FRAME_MARGIN_M = 150;

/** How far from the site a street-level photograph may stand and still be offered as a view of it. */
export const STREET_VIEW_REACH_M = 100;

/** Metres in a degree of latitude. A degree of longitude is this times the cosine of the latitude. */
const METRES_PER_DEG_LAT = 111_320;

/** The box a map of the site opens on, and the one point that stands for the site. */
export interface SiteFrame {
  south: number;
  west: number;
  north: number;
  east: number;
  /** The middle of the outline, or of all of them when there are several, otherwise the pin. */
  point: GeoPoint;
  from: 'outline' | 'outlines' | 'pin';
  /**
   * How far from `point` a street view may be looked for. A pin is on or
   * beside a road; the middle of an outline need not be, so its reach runs
   * out to the outline's corner before the same allowance is added.
   */
  reachM: number;
}

function boxAround(point: GeoPoint, metres: number): Pick<SiteFrame, 'south' | 'west' | 'north' | 'east'> {
  const dLat = metres / METRES_PER_DEG_LAT;
  const dLng = dLat / Math.cos((point.lat * Math.PI) / 180);
  return { south: point.lat - dLat, west: point.lng - dLng, north: point.lat + dLat, east: point.lng + dLng };
}

/**
 * Where a map of the site opens: on the site, and on nothing else.
 *
 * The outline when one is on file; otherwise the pin, with the distance the
 * overlay reads context for around it. Wards, lakes and the state's layers
 * are context and never widen the frame — a ward is kilometres across, and
 * framing one left a 40 m plot seven pixels wide.
 *
 * A site on several survey numbers has several outlines, and the frame holds
 * all of them: every parcel read from the state's map, and a person's own
 * outline beside them. They are the site; a frame on the first parcel alone
 * left the rest of a township off the edge of the map.
 *
 * The point follows the frame. A geocode that landed on the locality and a
 * parcel read from the revenue map can be a kilometre apart, and a map framed
 * on the parcel with a street view opened beside the pin shows two places as
 * if they were one.
 *
 * The room round a large outline is a tenth of its own size, and it is part
 * of the frame rather than padding added in pixels when the map is fitted. A
 * map only has whole zoom levels, and on a narrow phone a few pixels of
 * padding were enough to tip a small plot out to the next one, twice as wide.
 *
 * Plain numbers, so that all of this can be tested without a map.
 */
export function siteFrame(read: Pick<GisOverlayRead, 'pin' | 'survey' | 'parcels'>): SiteFrame | null {
  const parcels = (read.parcels ?? []).map((p) => p.ring).filter((ring) => ring.length);
  // An outline the revenue map supplied is one of the parcels, and is counted once.
  const own = read.survey?.ring.length && !(read.survey.source === 'revenue_map' && parcels.length) ? [read.survey.ring] : [];
  const rings = [...own, ...parcels];
  if (rings.length) {
    let south = rings[0][0].lat;
    let north = rings[0][0].lat;
    let west = rings[0][0].lng;
    let east = rings[0][0].lng;
    for (const p of rings.flat()) {
      south = Math.min(south, p.lat);
      north = Math.max(north, p.lat);
      west = Math.min(west, p.lng);
      east = Math.max(east, p.lng);
    }
    const point = { lat: (south + north) / 2, lng: (west + east) / 2 };
    const room = boxAround(point, SITE_FRAME_MARGIN_M);
    return {
      south: Math.min(south - (north - south) * 0.1, room.south),
      west: Math.min(west - (east - west) * 0.1, room.west),
      north: Math.max(north + (north - south) * 0.1, room.north),
      east: Math.max(east + (east - west) * 0.1, room.east),
      point,
      from: rings.length > 1 ? 'outlines' : 'outline',
      reachM: Math.round(STREET_VIEW_REACH_M + haversineMetres(point, { lat: north, lng: east })),
    };
  }
  if (!read.pin) return null;
  const point = { lat: read.pin.lat, lng: read.pin.lng };
  return { ...boxAround(point, GIS_OVERLAY_RADIUS_M), point, from: 'pin', reachM: STREET_VIEW_REACH_M };
}

/**
 * Whether an address out of somebody else's catalogue may be offered as a link.
 *
 * Only https. An address is whatever the catalogue holds that day, and one
 * that begins `javascript:` runs when the link is clicked.
 */
export function isHttpsUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
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

/** An outline the site has: a person's, or a parcel read from the state's map under its survey number. */
interface SiteOutline {
  ring: GeoPoint[];
  surveyNo?: string;
}

/**
 * The outlines a feature touches, in words: a person's own by `own`, the
 * state's parcels by their survey numbers, so a lake under one parcel of
 * twelve says which.
 */
function outlinesInWords(over: SiteOutline[], own: string): string {
  const numbers = over.flatMap((o) => (o.surveyNo ? [o.surveyNo] : []));
  return [
    ...(over.some((o) => !o.surveyNo) ? [own] : []),
    ...(numbers.length ? [`the revenue map’s parcel${numbers.length === 1 ? '' : 's'} for ${surveyNumbersLabel(numbers)}`] : []),
  ].join(' and ');
}

function waterHits(
  pin: PlanningOverlayPin | null,
  outlines: SiteOutline[],
  features: GisContextFeature[],
): GisOverlayHit[] {
  const hits: GisOverlayHit[] = [];
  const waters = features.filter((f) => f.kind === 'osm_water' || f.kind === 'osm_waterway');
  if (!waters.length) return hits;

  for (const f of waters) {
    const ring = f.ring;
    const over = ring ? outlines.filter((o) => ringsOverlap(o.ring, ring)) : [];
    if (!over.length) continue;
    const which = outlinesInWords(over, 'the supplied survey outline');
    hits.push({
      code: 'osm_water_overlap',
      severity: 'flag',
      standing: 'context',
      featureId: f.id,
      metres: 0,
      text: `${which.charAt(0).toUpperCase()}${which.slice(1)} overlap${over.length === 1 ? 's' : ''} OSM ${f.name ?? 'water'} (${f.kind.replace('osm_', '')}). That is volunteer map geometry — not a classified lake or rajakaluve, and not a buffer under NGT. Obtain the current BDA/BBMP drain map and file it.`,
    });
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
    /** One read, or every read kept for a site on several survey numbers, the first leading. */
    revenue?: RevenueMapRead | RevenueMapRead[];
  },
): GisOverlayRead {
  const planning = compareProjectPlanning(project, { sitting: extra?.sitting, places: extra?.places });
  const pin = planning.pin ?? planningPinOf(project, extra?.places);
  const survey = surveyOf(project);
  const reads = !extra?.revenue ? [] : Array.isArray(extra.revenue) ? extra.revenue : [extra.revenue];
  const several = reads.length > 1;
  const labels = parcelLabels(reads);
  const parcels: GisOverlayParcel[] = reads.flatMap((r) =>
    r.rings[0]?.length ? [{ parcelRef: r.parcelRef, surveyNo: r.surveyNo, label: labels.get(r.parcelRef) ?? r.surveyNo, ring: r.rings[0], areaSqm: r.areaSqm }] : [],
  );
  /*
   * What a lake or a ward is tested against. With one outline it is the
   * boundary on file, as it always was. With several parcels it is each of
   * them by its survey number, and a person's own outline beside them — the
   * boundary the revenue map supplied is the first parcel, and is not tested
   * a second time under another name.
   */
  const outlines: SiteOutline[] = several
    ? [...(survey && survey.source !== 'revenue_map' ? [{ ring: survey.ring }] : []), ...parcels.map((p) => ({ ring: p.ring, surveyNo: p.label }))]
    : survey
      ? [{ ring: survey.ring }]
      : [];
  const osmFeatures = extra?.osm?.features ?? [];
  const civicLakes = extra?.civic?.lakes ?? [];
  const civicWards = extra?.civic?.wards ?? [];
  const origin = pin ? { lat: pin.lat, lng: pin.lng } : null;
  const civicNear = (layers: NamedRing[]) => {
    const near = civicHitsNear(layers, origin, survey?.ring, GIS_OVERLAY_RADIUS_M);
    // A parcel beside the first can lie on a lake the first does not touch.
    for (const parcel of several ? parcels : []) {
      for (const hit of civicHitsNear(layers, origin, parcel.ring, GIS_OVERLAY_RADIUS_M)) {
        if (!near.some((n) => n.feature.id === hit.feature.id)) near.push(hit);
      }
    }
    return near.sort((a, b) => a.metres - b.metres);
  };
  const lakeHits = civicNear(civicLakes).slice(0, 12);
  const wardHits = civicNear(civicWards).slice(0, 8);
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
  const revenueFeatures = siteRevenueContext(reads);
  const features = [...osmFeatures, ...civicFeatures, ...revenueFeatures];
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
    // One parcel of several is not the site: the land area is set against all of them, with the revenue map's own hits.
    const oneOfSeveral = several && survey.source === 'revenue_map';
    if (!oneOfSeveral && project.landAreaSqm && project.landAreaSqm > 0) {
      const diffPct = ((survey.computedAreaSqm - project.landAreaSqm) / project.landAreaSqm) * 100;
      // An outline the revenue map supplied for a part of a survey number is the whole of that number.
      const whole = survey.source === 'revenue_map' && reads[0]?.askedAs?.length ? reads[0] : undefined;
      const against = extentAgainstMap(project.landAreaSqm, survey.computedAreaSqm, whole ? survey.computedAreaSqm : 0);
      const encloses = `The outline encloses ${Math.abs(diffPct).toFixed(1)}% ${diffPct < 0 ? 'less' : 'more'} than the land area on this project (${Math.round(project.landAreaSqm).toLocaleString()} sqm).`;
      if (against.apart) {
        hits.push({
          code: 'survey_area',
          severity: 'flag',
          standing: 'survey',
          text: `${encloses} Both figures are kept. Reconciling them belongs to a surveyor — not this overlay.`,
        });
      } else if (against.excused && whole) {
        hits.push({ code: 'survey_area', severity: 'info', standing: 'survey', text: `${encloses} ${moreOnAWholeNumber([`${whole.surveyNo}`])}` });
      }
    }
  }

  if (several) hits.push(...revenueSiteHits(reads, project, origin));
  else if (reads[0]) hits.push(...revenueMapHits(reads[0], project, origin));

  if (extra?.osm?.error) {
    hits.push({
      code: 'osm_unavailable',
      severity: 'info',
      standing: 'context',
      // What a reader needs first is whether this is about their property.
      // It is not — so the reassurance leads and the provider's own status
      // code trails, rather than an HTTP number opening a sentence on a
      // dashboard about a piece of land.
      text: `Context layers are unavailable just now, so this map is showing less than usual. Nothing about the property has changed: the pin and survey sketch still draw, and statutory land use still comes from the RMP / LPA sheet. (OpenStreetMap: ${extra.osm.error}.)`,
    });
  }

  hits.push(...waterHits(pin, outlines, osmFeatures));
  const landuse = landuseHit(pin, osmFeatures);
  if (landuse) hits.push(landuse);

  if (extra?.civic?.error) {
    hits.push({
      code: 'osm_unavailable',
      severity: 'info',
      standing: 'context',
      text: `Some civic layers are unavailable just now, so the ward and lake overlay may be incomplete. (OpenCity: ${extra.civic.error}.)`,
    });
  }
  const touched = (ring: GeoPoint[]) => outlines.filter((o) => ringsOverlap(o.ring, ring));
  for (const h of wardHits) {
    const over = touched(h.feature.ring);
    if (!h.inside && !over.length) continue;
    hits.push({
      code: 'civic_ward',
      severity: 'info',
      standing: 'context',
      featureId: h.feature.id,
      metres: aboutMetres(h.metres),
      text: `OpenCity GBA ward overlay: “${h.feature.name}” ${h.inside ? 'contains the pin' : `overlaps ${outlinesInWords(over, 'the survey sketch')}`}. Civic delimitation (2025), not RMP land use. Source: data.opencity.in.`,
    });
  }
  for (const h of lakeHits.slice(0, 6)) {
    const over = touched(h.feature.ring);
    if (over.length || h.inside) {
      hits.push({
        code: 'civic_lake_overlap',
        severity: 'flag',
        standing: 'context',
        featureId: h.feature.id,
        metres: aboutMetres(h.metres),
        text: `OpenCity BBMP lakes layer: “${h.feature.name}” ${h.inside ? 'contains the pin' : `overlaps ${outlinesInWords(over, 'the survey sketch')}`}. CONTEXT — not drain class, not NGT buffer. Confirm on BBMP GIS / LMS.`,
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
    parcels,
    features,
    hits,
    planning,
    maps,
    withdrawnSheets,
    // The first read's, as it has always been; the layers are every read's.
    revenue: reads[0]
      ? {
          standing: 'record',
          readAt: reads[0].readAt,
          state: reads[0].state,
          surveyNo: reads[0].surveyNo,
          village: reads[0].village,
          sourceLabel: reads[0].sourceLabel,
          featureCount: revenueFeatures.length,
          unreadLayers: [...new Set(reads.flatMap((r) => r.unreadLayers.map((u) => u.layer)))],
          caveat: REVENUE_MAP_CAVEAT,
        }
      : undefined,
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

/* ------------------------------------------------------------------ */
/* The revenue map on the overlay                                      */
/* ------------------------------------------------------------------ */

const MAX_REVENUE_FEATURES = 120;
const MAX_REVENUE_FACTOR_HITS = 8;
const MAX_REVENUE_INSIGHT_HITS = 6;

function contextFeature(f: RevenueMapFeature): GisContextFeature | null {
  const feature: GisContextFeature = {
    id: f.id,
    kind: f.kind,
    name: f.name ?? undefined,
    layerKey: f.layerKey,
    distanceM: f.distanceM,
  };
  if (f.ring && f.ring.length >= 4) feature.ring = simplifyRing(f.ring);
  else if (f.line && f.line.length >= 2) feature.line = f.line;
  else if (f.point) feature.point = f.point;
  else return null;
  return feature;
}

/**
 * No more than the canvas is given to draw. Under the limit the features
 * keep the order the engine gave them; over it, the ones kept are the
 * nearest, not whichever layer happened to be read first.
 */
function withinTheLimit(features: GisContextFeature[]): GisContextFeature[] {
  if (features.length <= MAX_REVENUE_FEATURES) return features;
  return [...features].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)).slice(0, MAX_REVENUE_FEATURES);
}

/** The state's layers, clipped by the engine, simplified for the canvas. */
export function revenueMapFeatures(read: RevenueMapRead): GisContextFeature[] {
  return withinTheLimit(read.features.flatMap((f) => contextFeature(f) ?? []));
}

/**
 * The same for every read kept for a site: each feature once, with the
 * parcel it lies nearest. One read draws exactly as it always did.
 */
export function siteRevenueContext(reads: readonly RevenueMapRead[]): GisContextFeature[] {
  if (reads.length <= 1) return reads[0] ? revenueMapFeatures(reads[0]) : [];
  return withinTheLimit(
    siteRevenueFeatures(reads).flatMap((f) => {
      const feature = contextFeature(f);
      return feature ? [{ ...feature, nearestSurveyNo: f.surveyNo }] : [];
    }),
  );
}

function placeOf(read: RevenueMapRead): string {
  return [read.village, read.mandal, read.district].filter(Boolean).join(', ');
}

/** Beyond this, the pin and the parcel are not describing the same place. */
const REVENUE_FAR_FROM_PIN_M = 1_000;

/**
 * The geocoded address against the register's parcel. A survey number that
 * resolves twenty kilometres from the address on the file is the wrong
 * survey number, the wrong village, or the wrong address — and every layer
 * read around it describes somebody else's land.
 */
function farFromPinHit(read: RevenueMapRead, pin: GeoPoint | null | undefined): GisOverlayHit | undefined {
  if (!pin) return undefined;
  const apart = haversineMetres(pin, read.centre);
  if (apart <= REVENUE_FAR_FROM_PIN_M) return undefined;
  return {
    code: 'revenue_far_from_pin',
    severity: 'flag',
    standing: 'record',
    metres: Math.round(apart),
    text: `The revenue map places Sy. ${read.surveyNo}, ${placeOf(read)} about ${apart >= 2_000 ? `${(apart / 1000).toFixed(1)} km` : `${Math.round(apart)} m`} from this project’s pin. One of them is the wrong place: check the survey number, the village and the address before reading anything else off this overlay.`,
  };
}

function prohibitedHit(read: RevenueMapRead, label = read.surveyNo): GisOverlayHit | undefined {
  if (!read.prohibitedCategory) return undefined;
  return {
    code: 'revenue_prohibited',
    severity: 'flag',
    standing: 'record',
    text: `Sy. ${label} is on the prohibited-property register (${read.prohibitedCategory}). The Sub-Registrar cannot register a transfer of land on this list. Confirm against the district’s published list before anything else on this file.`,
  };
}

/**
 * Why more land on the map than a figure on the file is not raised: the map
 * holds the whole of a survey number where a part of it was asked for.
 */
function moreOnAWholeNumber(labels: readonly string[]): string {
  return `The map holds the whole of ${surveyNumbersLabel(labels)}, where a part was asked for, so more land on the map is what a part of a survey number looks like.`;
}

/**
 * What a parcel is beyond its number and its area, said wherever the parcel
 * is: that the map holds the whole survey number where a part was asked for,
 * so the outline may be more land than the site; and that the number was
 * asked for off a reading nobody has accepted yet.
 */
function parcelStanding(parcel: RevenueExtentParcel | undefined): string[] {
  if (!parcel) return [];
  return [...(parcel.askedAs.length ? [wholeNumberWords(parcel.askedAs)] : []), ...(parcel.unaccepted ? [unacceptedWords(parcel.unaccepted)] : [])];
}

/**
 * The extent the documents were accepted as stating, beside what the map
 * shows for the same land: two figures and the gap between them, in square
 * metres. A flag by the one rule for extents; information where the parcels
 * are not all read yet, and where the map holds the whole of a number the
 * documents state a part of.
 */
function documentsExtentHit(extent: RevenueExtent | null): GisOverlayHit | undefined {
  const words = extent ? extentAgainstDocuments(extent) : null;
  if (!words) return undefined;
  return {
    code: 'revenue_documents_extent',
    severity: words.apart ? 'flag' : 'info',
    standing: 'record',
    text: `The documents state ${words.stated}. ${words.verdict.charAt(0).toUpperCase()}${words.verdict.slice(1)}.${
      words.apart ? ' Both are kept. Which one is the land being sold is a question for the surveyor and the deed.' : ''
    }`,
  };
}

/**
 * What the read says, as overlay hits.
 *
 * A factor the engine marked as pushing the value down, or as critical, is a
 * flag. Everything else is a note. The engine's percentages are NOT carried
 * into the text: Realytica's valuation model owns the number, and a reader
 * who sees "-12%" beside a lake will treat it as the adjustment rather than
 * as one engine's opinion of one.
 */
export function revenueMapHits(read: RevenueMapRead, project: DdProject, pin?: GeoPoint | null): GisOverlayHit[] {
  const hits: GisOverlayHit[] = [];
  const readOn = read.readAt.slice(0, 10);
  const stated = revenueExtent(project, [read]);
  const parcel = stated?.parcels[0];
  const standing = [
    ...(parcel?.askedAs.length ? [` The map holds the ${wholeNumberWords(parcel.askedAs)}.`] : []),
    ...(parcel?.unaccepted ? [` The number is ${unacceptedWords(parcel.unaccepted)}.`] : []),
  ].join('');
  const extent = `${Math.round(read.areaSqm).toLocaleString()} sqm surveyed${read.registerExtent ? `; the register records “${read.registerExtent}”` : ''}`;
  hits.push({
    code: 'revenue_parcel',
    severity: 'info',
    standing: 'record',
    text: `Revenue map: Sy. ${read.surveyNo}, ${placeOf(read)} — ${read.sourceLabel}, read ${readOn}. ${extent}.${standing} ${REVENUE_MAP_CAVEAT}`,
  });

  const far = farFromPinHit(read, pin);
  if (far) hits.push(far);

  // A person's outline against the register's. `survey_area` already compares
  // the boundary on file to the land area typed on the project; this is the
  // other disagreement, between two drawn shapes.
  const onFile = project.surveyBoundary;
  if (onFile && onFile.source !== 'revenue_map' && read.areaSqm > 0) {
    // A person's outline of a part, beside a parcel that is the whole of the number: more land on the map is said, not raised.
    const against = extentAgainstMap(onFile.computedAreaSqm, read.areaSqm, parcel?.askedAs.length ? read.areaSqm : 0);
    const diffPct = ((onFile.computedAreaSqm - read.areaSqm) / read.areaSqm) * 100;
    const encloses = `The supplied survey outline encloses ${Math.abs(diffPct).toFixed(1)}% ${diffPct < 0 ? 'less' : 'more'} than the revenue map’s parcel for Sy. ${read.surveyNo} (${Math.round(read.areaSqm).toLocaleString()} sqm).`;
    if (against.apart) {
      hits.push({ code: 'revenue_extent', severity: 'flag', standing: 'record', text: `${encloses} Both are kept. Which one is the land being sold is a question for the surveyor and the deed.` });
    } else if (against.excused) {
      hits.push({ code: 'revenue_extent', severity: 'info', standing: 'record', text: `${encloses} ${moreOnAWholeNumber([read.surveyNo])}` });
    }
  }

  const documents = documentsExtentHit(stated);
  if (documents) hits.push(documents);

  const listed = prohibitedHit(read);
  if (listed) {
    hits.push(listed);
  } else if (read.prohibitedRegisterUnjoined) {
    hits.push({
      code: 'revenue_register_unjoined',
      severity: 'info',
      standing: 'statute_needed',
      text: `No prohibited-register entry came back for Sy. ${read.surveyNo}, because ${read.sourceLabel} is not joined to that register. This is silence, not a clean title: the district list still has to be checked.`,
    });
  }

  const factors = [...read.factors].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_REVENUE_FACTOR_HITS);
  for (const f of factors) {
    const flag = f.direction === 'down' || f.severity === 'critical' || f.severity === 'high';
    hits.push({
      code: 'revenue_factor',
      severity: flag ? 'flag' : 'info',
      standing: 'record',
      metres: f.distanceM ?? undefined,
      text: `${f.headline} ${f.detail} (Source: ${f.source || revenueLayerLabel(f.layerKey)}.)`,
    });
  }

  const told = new Set(read.factors.map((f) => f.layerKey));
  const insights = read.insights
    .filter((i) => i.kind === 'planned' || i.kind === 'zoning' || !told.has(i.layerKey))
    .slice(0, MAX_REVENUE_INSIGHT_HITS);
  for (const i of insights) {
    hits.push({
      code: 'revenue_insight',
      severity: 'info',
      standing: 'record',
      featureId: i.featureId ?? undefined,
      metres: i.distanceM,
      text: `${i.title} (${i.status}${i.direction ? `, ${Math.round(i.distanceM)} m ${i.direction}` : ''}): ${i.meaning} Source: ${i.source}.`,
    });
  }

  if (read.anchor) {
    hits.push({
      code: 'revenue_anchor',
      severity: 'info',
      standing: 'record',
      text: `Published guidance value ${read.anchor.locality ? `for ${read.anchor.locality}` : ''}: ₹${Math.round(read.anchor.guidancePerUnit).toLocaleString()} per ${read.anchor.unit === 'sqyd' ? 'sq yd' : 'sq ft'}. ${read.anchor.note}`,
    });
  }

  if (read.unreadLayers.length) {
    hits.push({
      code: 'revenue_unread',
      severity: 'info',
      standing: 'record',
      text: `${read.unreadLayers.length} government layer${read.unreadLayers.length === 1 ? '' : 's'} could not be read (${read.unreadLayers.map((u) => revenueLayerLabel(u.layer)).join(', ')}). Their absence from the map means nothing. Read the revenue map again later.`,
    });
  }

  return hits;
}

function rank(f: RevenueMapRead['factors'][number]): number {
  const sev = { critical: 4, high: 3, medium: 2, low: 1 }[f.severity];
  return sev * 2 + (f.direction === 'down' ? 1 : 0);
}

/** How many parcels a sentence lists one by one before it counts the rest. */
const MAX_PARCELS_TOLD = 12;

/**
 * What several reads say together, as overlay hits.
 *
 * The same things one read says, said for the site: the parcels and what
 * they add up to, each finding once, and anything that is about one parcel —
 * a listing on the prohibited register, a parcel far from the pin, a drain
 * beside one plot of twelve — naming the survey number it is about.
 */
function revenueSiteHits(reads: RevenueMapRead[], project: DdProject, pin?: GeoPoint | null): GisOverlayHit[] {
  const brief = revenueSiteBrief(project, reads);
  if (!brief) return [];
  const hits: GisOverlayHit[] = [];
  const labelOf = (read: RevenueMapRead) => brief.parcels.find((p) => p.parcelRef === read.parcelRef)?.label ?? read.surveyNo;
  const total = brief.extent.totalSqm;
  const each = brief.extent.parcels
    .slice(0, MAX_PARCELS_TOLD)
    .map((p) => `Sy. ${p.label} (${[`${Math.round(p.areaSqm).toLocaleString()} sqm`, ...(p.registerExtent ? [`the register records “${p.registerExtent}”`] : []), ...parcelStanding(p)].join('; ')})`)
    .join(', ');
  hits.push({
    code: 'revenue_parcel',
    severity: 'info',
    standing: 'record',
    text: `Revenue map: ${reads.length} parcels, ${[...new Set(reads.map((r) => r.sourceLabel))].join(' and ')}. ${each}${
      reads.length > MAX_PARCELS_TOLD ? ` and ${reads.length - MAX_PARCELS_TOLD} more` : ''
    }. ${Math.round(total).toLocaleString()} sqm in all, from the outlines. ${REVENUE_MAP_CAVEAT}`,
  });

  for (const read of reads) {
    const far = farFromPinHit(read, pin);
    if (far) hits.push(far);
  }

  // The shapes against each other, and against the figures on the file, are
  // compared once, with all the parcels together: one parcel of several is
  // never the whole of what a person outlined or a deed conveys.
  // A parcel that is the whole of a survey number, where a part was asked for, holds the site's part and more: it accounts
  // for more land on the map up to its own area, here as it does against the documents.
  const whole = brief.extent.parcels.filter((p) => p.askedAs.length);
  const wholeSqm = whole.reduce((sum, p) => sum + (p.areaSqm > 0 ? p.areaSqm : 0), 0);
  const said = moreOnAWholeNumber(whole.map((p) => p.label));
  const onFile = project.surveyBoundary;
  if (total > 0 && onFile && onFile.source !== 'revenue_map') {
    const against = extentAgainstMap(onFile.computedAreaSqm, total, wholeSqm);
    const diffPct = ((onFile.computedAreaSqm - total) / total) * 100;
    const encloses = `The supplied survey outline encloses ${Math.abs(diffPct).toFixed(1)}% ${diffPct < 0 ? 'less' : 'more'} than the revenue map’s ${reads.length} parcels together (${surveyNumbersLabel(brief.parcels.map((p) => p.label))}, ${Math.round(total).toLocaleString()} sqm).`;
    if (against.apart) {
      hits.push({ code: 'revenue_extent', severity: 'flag', standing: 'record', text: `${encloses} Both are kept. Which one is the land being sold is a question for the surveyor and the deed.` });
    } else if (against.excused) {
      hits.push({ code: 'revenue_extent', severity: 'info', standing: 'record', text: `${encloses} ${said}` });
    }
  }
  if (total > 0 && onFile?.source === 'revenue_map' && project.landAreaSqm && project.landAreaSqm > 0) {
    const against = extentAgainstMap(project.landAreaSqm, total, wholeSqm);
    const diffPct = ((total - project.landAreaSqm) / project.landAreaSqm) * 100;
    const enclose = `The ${reads.length} parcels read from the revenue map enclose ${Math.abs(diffPct).toFixed(1)}% ${diffPct < 0 ? 'less' : 'more'} than the land area on this project (${Math.round(project.landAreaSqm).toLocaleString()} sqm).`;
    if (against.apart) {
      hits.push({ code: 'survey_area', severity: 'flag', standing: 'record', text: `${enclose} Both figures are kept. Reconciling them belongs to a surveyor — not this overlay.` });
    } else if (against.excused) {
      hits.push({ code: 'survey_area', severity: 'info', standing: 'record', text: `${enclose} ${said}` });
    }
  }
  const documents = documentsExtentHit(brief.extent);
  if (documents) hits.push(documents);

  for (const read of reads) {
    const listed = prohibitedHit(read, labelOf(read));
    if (listed) hits.push(listed);
  }
  const unjoined = reads.filter((r) => !r.prohibitedCategory && r.prohibitedRegisterUnjoined);
  if (unjoined.length) {
    hits.push({
      code: 'revenue_register_unjoined',
      severity: 'info',
      standing: 'statute_needed',
      text: `No prohibited-register entry came back for ${surveyNumbersLabel(unjoined.map(labelOf), MAX_PARCELS_TOLD)}, because ${[...new Set(unjoined.map((r) => r.sourceLabel))].join(' and ')} is not joined to that register. This is silence, not a clean title: the district list still has to be checked.`,
    });
  }

  const finding = (code: 'revenue_factor' | 'revenue_insight', flag: boolean) => (item: RevenueSiteItem): GisOverlayHit => ({
    code,
    severity: flag ? 'flag' : 'info',
    standing: 'record',
    featureId: item.featureId ?? undefined,
    metres: item.distanceM ?? undefined,
    text: `${item.title}${item.where ? ` (${item.where})` : ''}: ${item.says}${item.why ? ` ${item.why}` : ''} (Source: ${item.source}.)`,
  });
  hits.push(...brief.warnings.map(finding('revenue_factor', true)));
  hits.push(...brief.positives.map(finding('revenue_factor', false)));
  hits.push(...[...brief.planned, ...brief.zoning, ...brief.nearby].map(finding('revenue_insight', false)));

  if (brief.guidance) {
    const g = brief.guidance;
    const unit = (u: 'sqyd' | 'sqft') => (u === 'sqyd' ? 'sq yd' : 'sq ft');
    hits.push({
      code: 'revenue_anchor',
      severity: 'info',
      standing: 'record',
      text: `Published guidance value ${g.locality ? `for ${g.locality}` : ''}: ₹${g.perUnit.toLocaleString()} per ${unit(g.unit)}, read for Sy. ${g.surveyNo}.${
        g.differing.length ? ` ${g.differing.map((d) => `Sy. ${d.surveyNo} carries ₹${d.perUnit.toLocaleString()} per ${unit(d.unit)}`).join('; ')}: the values differ by parcel and none is averaged.` : ''
      }${g.unpriced.length ? ` The map published no value for ${surveyNumbersLabel(g.unpriced, MAX_PARCELS_TOLD)}.` : ''} ${g.note}`,
    });
  }

  for (const unread of brief.notChecked) {
    hits.push({
      code: 'revenue_unread',
      severity: 'info',
      standing: 'record',
      text: `The ${unread.layer} layer could not be read for ${surveyNumbersLabel(unread.parcels, MAX_PARCELS_TOLD)}. Its absence from the map means nothing. Read the revenue map again later.`,
    });
  }

  return hits;
}
