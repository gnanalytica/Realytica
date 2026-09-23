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

/* ------------------------------------------------------------------ */
/* The brief: the read as points a person can scan                    */
/* ------------------------------------------------------------------ */

/**
 * One line on the brief. `title` is the thing, `where` is how far and which
 * way, `says` is the one sentence that matters, `why` is the rule or the
 * next step behind it. Never a percentage — see the design note.
 */
export interface RevenueBriefItem {
  code: string;
  title: string;
  /** "40 m south", "inside the plot", or null when distance means nothing. */
  where: string | null;
  says: string;
  why: string | null;
  source: string;
  tone: 'critical' | 'warning' | 'info' | 'good';
  featureId: string | null;
}

export interface RevenueMapBrief {
  parcel: {
    surveyNo: string;
    place: string;
    source: string;
    readOn: string;
    extentSqm: number;
    registerExtent: string | null;
    classification: string | null;
  };
  /** The prohibited register, in one word a reader can act on. */
  register: { state: 'listed'; category: string } | { state: 'unjoined' } | { state: 'clear' };
  /** What pulls the value down or blocks a use. The engine's drag factors. */
  warnings: RevenueBriefItem[];
  /** Roads, rail, drains and stations that are proposed or under acquisition. */
  planned: RevenueBriefItem[];
  /** What the master plan or land-use survey zones this land as. */
  zoning: RevenueBriefItem[];
  /** Lakes, drains and other features nearby that no factor already covers. */
  nearby: RevenueBriefItem[];
  /** What works in the plot's favour. The engine's uplift factors. */
  positives: RevenueBriefItem[];
  guidance: { perUnit: number; unit: 'sqyd' | 'sqft'; locality: string | null; note: string } | null;
  notChecked: { layer: string; reason: string }[];
  /** Layers that answered and found nothing within reach of the parcel. */
  checkedClear: string[];
}

const MAX_BRIEF_ITEMS_PER_SECTION = 8;

/** "40 m" or "1.2 km", the way a person says it. */
export function metresLabel(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m >= 1_000) return `${(m / 1_000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/**
 * A distance of zero is not a place. The engine reports 0 both for a feature
 * the parcel sits inside and for a factor that has no distance at all (the
 * extent check, a zone), and the sentence beside it already says which. So
 * zero prints nothing, and only a real distance gets a direction.
 */
function whereLabel(distanceM: number | null | undefined, direction: string | null | undefined): string | null {
  if (distanceM === null || distanceM === undefined || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  const d = metresLabel(distanceM);
  return direction ? `${d} ${direction}` : `${d} away`;
}

function factorTone(f: RevenueMapFactor): RevenueBriefItem['tone'] {
  if (f.direction === 'up') return 'good';
  if (f.severity === 'critical') return 'critical';
  if (f.severity === 'high' || f.severity === 'medium') return 'warning';
  return 'info';
}

function factorItem(f: RevenueMapFactor): RevenueBriefItem {
  return {
    code: f.code,
    title: f.label,
    where: whereLabel(f.distanceM, null),
    says: f.headline,
    why: f.detail || null,
    source: f.source || revenueLayerLabel(f.layerKey),
    tone: factorTone(f),
    featureId: null,
  };
}

function insightItem(i: RevenueMapInsight): RevenueBriefItem {
  const tone: RevenueBriefItem['tone'] = i.kind === 'risk' ? 'warning' : 'info';
  return {
    code: i.code,
    title: i.title,
    where: whereLabel(i.distanceM, i.direction),
    says: i.meaning,
    why: i.status || null,
    source: i.source,
    tone,
    featureId: i.featureId,
  };
}

function rankFactor(f: RevenueMapFactor): number {
  const sev = { critical: 4, high: 3, medium: 2, low: 1 }[f.severity];
  return sev * 2 + (f.direction === 'down' ? 1 : 0);
}

/**
 * The layer family a code belongs to — "water" for `water_body_near` and for
 * `ka_water:0:679`, "zone" for `zone_residential` and for `ka_zone_mix`.
 *
 * Factors and insights come from the same layers but name them differently:
 * a factor's `layerKey` is the ArcGIS path the evidence cites, an insight's is
 * the engine's own key. The code is the one thing both spell the same way.
 */
function family(code: string): string {
  const tokens = code.split(/[_:]/).filter((t) => t && t !== 'ka');
  return tokens[0] ?? code;
}

const PAIR_DISTANCE_M = 5;

function sameDistance(factorM: number | null, insightM: number): boolean {
  if (factorM === null || !Number.isFinite(factorM)) return true;
  if (factorM <= 0 && insightM <= 0) return true;
  return Math.abs(factorM - insightM) <= PAIR_DISTANCE_M;
}

/**
 * One item from a factor and the insight that describes the same feature.
 * The insight names the thing and says which way it lies; the factor says
 * what it means and what to do about it. Neither alone is the whole line.
 */
function mergedItem(f: RevenueMapFactor, i: RevenueMapInsight): RevenueBriefItem {
  return {
    code: f.code,
    title: i.title,
    where: whereLabel(i.distanceM, i.direction),
    says: f.headline,
    why: f.detail || i.status || null,
    source: f.source || i.source,
    tone: factorTone(f),
    featureId: i.featureId,
  };
}

/**
 * The read, grouped the way a reader asks about land: what is wrong with it,
 * what is coming near it, what the plan says it is, what else is around it,
 * what is in its favour, what the state says it is worth, and what could not
 * be checked. Every group is a short list; nothing here is a paragraph.
 *
 * The engine reports the same lake twice — once as a factor ("near a water
 * body", with the rule and the advice) and once as an insight ("Anekal Kere,
 * 679 m west"). One line, not two: a factor and an insight from the same
 * layer family at the same distance are merged, the insight lending its name
 * and direction, the factor its meaning and tone. A merged line sits under
 * the planning heading when the insight is a zone or a planned work — those
 * are the things a valuer cannot see from the ground — and otherwise under
 * the factor's own verdict.
 */
export function revenueMapBrief(read: RevenueMapRead): RevenueMapBrief {
  const factors = [...read.factors].sort((a, b) => rankFactor(b) - rankFactor(a));
  const insights = [...read.insights].sort((a, b) => a.distanceM - b.distanceM);

  const paired = new Set<RevenueMapFactor>();
  const warnings: RevenueBriefItem[] = [];
  const positives: RevenueBriefItem[] = [];
  const planned: RevenueBriefItem[] = [];
  const zoning: RevenueBriefItem[] = [];
  const nearby: RevenueBriefItem[] = [];

  for (const i of insights) {
    const fam = family(i.code);
    const match = factors.find((f) => !paired.has(f) && family(f.code) === fam && sameDistance(f.distanceM, i.distanceM));
    const item = match ? mergedItem(match, i) : insightItem(i);
    if (match) paired.add(match);
    if (i.kind === 'planned') planned.push(item);
    else if (i.kind === 'zoning') zoning.push(item);
    else if (match) (match.direction === 'up' ? positives : warnings).push(item);
    else nearby.push(item);
  }
  for (const f of factors) {
    if (paired.has(f)) continue;
    (f.direction === 'up' ? positives : warnings).push(factorItem(f));
  }
  // A factor's rank decides the order within a verdict, merged or not.
  const rankOf = (item: RevenueBriefItem) => {
    const f = read.factors.find((x) => x.code === item.code);
    return f ? rankFactor(f) : 0;
  };
  warnings.sort((a, b) => rankOf(b) - rankOf(a));
  positives.sort((a, b) => rankOf(b) - rankOf(a));

  const register: RevenueMapBrief['register'] = read.prohibitedCategory
    ? { state: 'listed', category: read.prohibitedCategory }
    : read.prohibitedRegisterUnjoined
      ? { state: 'unjoined' }
      : { state: 'clear' };

  return {
    parcel: {
      surveyNo: read.surveyNo,
      place: [read.village, read.mandal, read.district].filter(Boolean).join(', '),
      source: read.sourceLabel,
      readOn: read.readAt.slice(0, 10),
      extentSqm: Math.round(read.areaSqm),
      registerExtent: read.registerExtent,
      classification: read.classification,
    },
    register,
    warnings: warnings.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    planned: planned.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    zoning: zoning.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    nearby: nearby.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    positives: positives.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    guidance: read.anchor
      ? {
          perUnit: Math.round(read.anchor.guidancePerUnit),
          unit: read.anchor.unit,
          locality: read.anchor.locality,
          note: read.anchor.note,
        }
      : null,
    notChecked: read.unreadLayers.map((u) => ({ layer: revenueLayerLabel(u.layer), reason: u.reason })),
    checkedClear: read.emptyLayers.map(revenueLayerLabel),
  };
}
