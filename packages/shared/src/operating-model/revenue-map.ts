/**
 * The revenue map: what the state's own cadastre and GIS say about the survey
 * number on this file.
 *
 * This is Kshetra's read (`@realytica/site-intel`), held on the project in a
 * shape the shared package can reason about without importing the engine.
 * The engine runs in the API; this file owns the record it leaves behind, the
 * standing that record has, and how the GIS overlay draws it.
 *
 * ## Standing
 *
 * Everything else on the overlay is either `context` (OpenStreetMap, OpenCity
 * — volunteer or civic geometry) or `survey` (an outline a person supplied).
 * A revenue-map read is neither. The parcel ring is the government's own
 * published boundary for that survey number, the water body is the state's
 * water-body layer, the zone is the planning authority's land-use polygon.
 * That is stronger than a blue OSM shape. It is still not evidence: it was
 * machine-read, the register carries its own survey error, and the layer
 * publisher has no SLA. So it gets a standing of its own — `record` — and the
 * rule that nothing here is filed until a person attaches the extract stays
 * exactly where it was.
 *
 * ## What is kept and what is not
 *
 * The features around the parcel are kept, clipped and simplified, because
 * re-reading ten government layers on every overlay open is a thirty-second
 * wait against servers that go down several times an afternoon. The value
 * band is NOT kept. Realytica has its own valuation model with its own rate
 * anchors and externality rules; what it wants from the revenue map is the
 * distances and the guidance rate, not a second opinion on the number.
 */

import type { GeoPoint, ParcelBoundary } from '../types';
import { buildBoundary } from '../geometry';
import type { DdProject } from './types';

/** Which state's layers were read. */
export type RevenueMapState = 'TS' | 'KA';

export type RevenueMapFeatureKind =
  /** A tank, lake, reservoir or river from the state's water-body layer. */
  | 'state_water'
  /** A nala, stream or canal — the drain whose buffer binds. */
  | 'state_drain'
  /** A recorded flood extent. */
  | 'state_flood'
  /** A road or rail alignment that is planned or being acquired. */
  | 'state_alignment'
  /** A master-plan land-use polygon, labelled by its zone. */
  | 'state_landuse'
  /** A metro station or similar transport node. */
  | 'state_transport'
  /** A parcel on the prohibited (Section 22-A) register. */
  | 'state_prohibited';

export interface RevenueMapFeature {
  id: string;
  kind: RevenueMapFeatureKind;
  /** The engine's layer key, so a hit can name its source layer. */
  layerKey: string;
  name: string | null;
  distanceM: number;
  /** True when the parcel's centre falls inside this feature. */
  contains: boolean;
  ring?: GeoPoint[];
  line?: GeoPoint[];
  point?: GeoPoint;
}

/** Whether a factor pushes the value up, down, or only warns. */
export type RevenueMapDirection = 'up' | 'down' | 'neutral';

export interface RevenueMapFactor {
  code: string;
  label: string;
  direction: RevenueMapDirection;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** One sentence, plain language. */
  headline: string;
  /** The rule, order or mechanism behind it. */
  detail: string;
  /** The engine's own impact band, percent of value. Advisory here. */
  impactLowPct: number;
  impactHighPct: number;
  /** Which layer produced this, as the engine keys it, for the audit trail. */
  layerKey: string;
  /** The same, as a person would name it: "Telangana GIS — HMDA water bodies". */
  source: string;
  distanceM: number | null;
}

export interface RevenueMapInsight {
  code: string;
  kind: 'planned' | 'zoning' | 'risk' | 'existing';
  layerKey: string;
  featureId: string | null;
  title: string;
  status: string;
  distanceM: number;
  direction: string | null;
  meaning: string;
  source: string;
}

export interface RevenueMapAnchor {
  /** Rupees per unit as the state publishes it, before any multiple. */
  guidancePerUnit: number;
  unit: 'sqyd' | 'sqft';
  /** The locality or road the rate was matched to. */
  locality: string | null;
  /** The engine's note: which table, captured when, what it assumed. */
  note: string;
}

export interface RevenueMapRead {
  readAt: string;
  state: RevenueMapState;
  /** The engine's parcel reference, replayable. */
  parcelRef: string;
  surveyNo: string;
  village: string | null;
  /** Mandal in Telangana, taluk in Karnataka. */
  mandal: string | null;
  district: string | null;
  /** Which published layer the parcel came from, as the engine labels it. */
  sourceLabel: string;
  /** The parcel's outer ring(s), the first being the one drawn as the boundary. */
  rings: GeoPoint[][];
  centre: GeoPoint;
  /** Surveyed extent from the ring. */
  areaSqm: number;
  /** The extent the register itself records, verbatim, when it does. */
  registerExtent: string | null;
  classification: string | null;
  /** Set when the parcel is on the prohibited register; the category. */
  prohibitedCategory: string | null;
  /** True when the parcel's layer is not joined to the prohibited register at all. */
  prohibitedRegisterUnjoined: boolean;
  features: RevenueMapFeature[];
  factors: RevenueMapFactor[];
  insights: RevenueMapInsight[];
  anchor: RevenueMapAnchor | null;
  /** Layers that were read and found nothing near the parcel. */
  emptyLayers: string[];
  /** Layers that could not be read. Their silence means nothing. */
  unreadLayers: { layer: string; reason: string }[];
}

export const REVENUE_MAP_CAVEAT =
  'Read by machine from the state’s published cadastre and GIS. A government record, not a licensed survey and not filed evidence: the register carries its own survey error, and the extract still has to be obtained and attached by a person.';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

/**
 * Put a revenue-map read on the project.
 *
 * The parcel ring becomes the project's boundary ONLY when no person has
 * supplied one. A surveyor's upload outranks the register — that is the
 * whole point of `BoundarySource` — and a fresh read must never overwrite it.
 * When the boundary on file came from an earlier revenue-map read, it is
 * replaced, because the read is the source.
 */
export function applyRevenueMap(project: DdProject, read: RevenueMapRead, actor = 'operator'): ParcelBoundary | null {
  project.revenueMap = read;
  project.updatedAt = read.readAt;
  let boundary: ParcelBoundary | null = null;
  const onFile = project.surveyBoundary;
  if (!onFile || onFile.source === 'revenue_map') {
    const ring = read.rings[0];
    boundary = ring?.length >= 3 ? buildBoundary(ring, 'revenue_map', read.readAt, `${read.sourceLabel}, Sy. ${read.surveyNo}`) : null;
    if (boundary) project.surveyBoundary = boundary;
  }
  if (!project.audit) project.audit = [];
  project.audit.push({
    id: id('aud'),
    at: read.readAt,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    newValue: `revenueMap ${read.parcelRef}`,
  });
  return boundary;
}

/** Drop the read. A boundary it supplied goes with it; a person's upload stays. */
export function clearRevenueMap(project: DdProject, actor = 'operator'): void {
  if (!project.revenueMap) return;
  const at = nowIso();
  project.revenueMap = undefined;
  if (project.surveyBoundary?.source === 'revenue_map') project.surveyBoundary = undefined;
  project.updatedAt = at;
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    oldValue: 'revenueMap',
  });
}

/** The survey number as the engine wants it, from whatever the file recorded. */
export function surveyNoFromParcelId(parcelId: string | undefined | null): string {
  if (!parcelId) return '';
  const m = parcelId.match(/(\d+[\d/A-Za-z-]*)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** A short human label for a layer key, for the hit text. */
export function revenueLayerLabel(layerKey: string): string {
  return layerKey.replace(/^ka_/, '').replace(/_/g, ' ');
}
