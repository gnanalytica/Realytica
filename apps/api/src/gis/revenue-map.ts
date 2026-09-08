/**
 * Reading the revenue map for a project — Kshetra's engine behind Realytica's
 * record.
 *
 * `@realytica/site-intel` takes a survey number, fetches the parcel from the
 * state's cadastre, reads the government layers around it, and tells what it
 * found. This file is the only place that engine is called from, and its job
 * is translation: the engine's report becomes a `RevenueMapRead`, the shape
 * the shared package holds on the project and draws on the overlay.
 *
 * What is deliberately left behind in the translation:
 *
 *  - the engine's value band. Realytica prices with its own model. The
 *    published guidance rate crosses over as an anchor, without the market
 *    multiple the engine applies to it, because that multiple is the engine's
 *    assumption and this file's valuer may hold a different one;
 *  - the follow-up questions. Realytica asks its own, on its checks;
 *  - the sketch. The overlay draws from the features, not from an SVG.
 *
 * Every network call here goes to a state government map server. None goes
 * to Kaveri: the guidance value is read from the table the engine ships,
 * captured offline and dated, so the portal policy in `portals.ts` holds.
 */

import type { RevenueMapFactor, RevenueMapFeature, RevenueMapFeatureKind, RevenueMapRead } from '@realytica/shared';
import { listDistricts, listMandals, listVillages, searchParcels } from '@realytica/site-intel/parcels';
import { runSiteIntel } from '@realytica/site-intel';
import { STATES, isStateKey, type StateKey } from '@realytica/site-intel/states';
import type { AreaFeature, SiteFactor, SiteIntelReport } from '@realytica/site-intel/types';

export type RevenueLevel =
  | { level: 'districts'; state: StateKey }
  | { level: 'mandals'; state: StateKey; district: string }
  | { level: 'villages'; state: StateKey; district: string; mandal: string };

export interface RevenueLevelResult {
  items: string[];
  /** Set when the live map was down and the on-disk snapshot answered. */
  snapshotOn?: string;
}

export type RevenueReadOutcome =
  | { ok: true; read: RevenueMapRead }
  | { ok: false; status: 400 | 404 | 502; error: string };

export { isStateKey };
export type { StateKey };

/** The picker's levels, named as each state names them. */
export function revenueLevelLabels(state: StateKey): { district: string; mandal: string; village: string } {
  return STATES[state].levels;
}

export async function revenueLevels(q: RevenueLevel): Promise<RevenueLevelResult | { error: string }> {
  const res =
    q.level === 'districts'
      ? await listDistricts(q.state)
      : q.level === 'mandals'
        ? await listMandals(q.district, q.state)
        : await listVillages(q.district, q.mandal, q.state);
  if (!res.ok) return { error: mapDown(q.state, res.detail) };
  return { items: res.data, ...(res.snapshotOn ? { snapshotOn: res.snapshotOn } : {}) };
}

function mapDown(state: StateKey, detail?: string): string {
  const who = state === 'KA' ? 'Karnataka’s survey-number map (K-GIS)' : 'The Telangana survey-number map';
  return `${who} is not responding right now${detail ? ` (${detail})` : ''}. Nothing on this file has changed.`;
}

export interface RevenueReadInput {
  state: StateKey;
  district: string;
  mandal: string;
  village: string;
  surveyNo: string;
  /** The land area on the project, so the engine's extent check has something to compare. */
  landAreaSqm?: number | null;
}

/**
 * Resolve the survey number to a parcel and read everything around it.
 *
 * Two round trips on purpose. The search answers "does this survey number
 * exist in that village" on its own, which is the cheap, precise refusal —
 * the one that catches a transliterated identifier naming another plot
 * before ten layers are read for the wrong land.
 */
export async function readRevenueMap(input: RevenueReadInput): Promise<RevenueReadOutcome> {
  const found = await searchParcels(
    { district: input.district, mandal: input.mandal, village: input.village, parcelPrefix: input.surveyNo },
    input.state,
  );
  if (!found.ok) {
    if (found.reason === 'parse') return { ok: false, status: 400, error: found.detail ?? 'That place could not be matched.' };
    return { ok: false, status: 502, error: mapDown(input.state, found.detail) };
  }
  const exact = found.data.find((p) => p.parcelNo === input.surveyNo) ?? (found.data.length === 1 ? found.data[0] : undefined);
  if (!exact) {
    const near = found.data.slice(0, 6).map((p) => p.parcelNo);
    return {
      ok: false,
      status: 404,
      error: near.length
        ? `Sy. ${input.surveyNo} is not in the published map for ${input.village}. Numbers that start the same way: ${near.join(', ')}.`
        : `Sy. ${input.surveyNo} is not in the published map for ${input.village}.`,
    };
  }

  const outcome = await runSiteIntel({
    parcelRef: exact.ref,
    kind: 'open_plot',
    area: input.landAreaSqm && input.landAreaSqm > 0 ? input.landAreaSqm : null,
    areaUnit: 'sqm',
  });
  if (!outcome.ok) {
    return { ok: false, status: outcome.reason === 'not_found' ? 502 : 400, error: outcome.message };
  }
  return { ok: true, read: toRevenueMapRead(outcome.report) };
}

/* ------------------------------------------------------------------ */
/* Translation                                                         */
/* ------------------------------------------------------------------ */

const FEATURE_KIND: Record<AreaFeature['kind'], RevenueMapFeatureKind | null> = {
  water: 'state_water',
  nala: 'state_drain',
  flood: 'state_flood',
  rrr: 'state_alignment',
  metro: 'state_transport',
  industrial: 'state_landuse',
  landuse: 'state_landuse',
  prohibited: 'state_prohibited',
  // HMDA's jurisdiction polygons are six shapes the size of districts; the
  // engine does not draw them and neither does the overlay.
  hmda_zone: null,
};

const SEVERITY: Record<SiteFactor['severity'], RevenueMapFactor['severity']> = {
  critical: 'critical',
  caution: 'high',
  info: 'low',
};

function toPoints(part: [number, number][]): { lat: number; lng: number }[] {
  return part.map(([lng, lat]) => ({ lat, lng }));
}

function toFeature(f: AreaFeature): RevenueMapFeature | null {
  const kind = FEATURE_KIND[f.kind];
  if (!kind) return null;
  const out: RevenueMapFeature = {
    id: f.id,
    kind,
    layerKey: f.layerKey,
    name: f.name,
    distanceM: f.distanceM,
    contains: f.contains,
  };
  if (f.rings?.[0]?.length) out.ring = toPoints(f.rings[0]);
  else if (f.paths?.[0]?.length) out.line = toPoints(f.paths[0]);
  else if (f.point) out.point = { lng: f.point[0], lat: f.point[1] };
  else return null;
  return out;
}

function toFactor(f: SiteFactor): RevenueMapFactor {
  return {
    code: f.code,
    label: f.label,
    direction: f.direction === 'uplift' ? 'up' : 'down',
    severity: SEVERITY[f.severity],
    headline: f.headline,
    detail: f.detail,
    impactLowPct: f.impactLowPct,
    impactHighPct: f.impactHighPct,
    layerKey: f.evidence.layer ?? f.evidence.source,
    source: f.evidence.source,
    distanceM: f.evidence.distanceM ?? null,
  };
}

/**
 * Whether the parcel's layer is joined to the prohibited register at all.
 * Telangana's municipal cadastre is; its rural survey and Karnataka's K-GIS
 * are not, and there a missing entry is silence rather than a clear title.
 */
function registerUnjoined(report: SiteIntelReport): boolean {
  const source = report.parcel?.source;
  return source === 'rural' || source === 'kgis';
}

export function toRevenueMapRead(report: SiteIntelReport, readAt = new Date().toISOString()): RevenueMapRead {
  const parcel = report.parcel;
  if (!parcel) throw new Error('The engine answered without a parcel; a revenue-map read needs one.');
  const anchor = report.estimate?.anchor ?? null;
  const guidance = anchor && anchor.basis !== 'user' ? anchor : null;
  return {
    readAt,
    state: report.state,
    parcelRef: parcel.ref,
    surveyNo: parcel.parcelNo,
    village: parcel.village,
    mandal: parcel.mandal,
    district: parcel.district,
    sourceLabel: parcel.sourceLabel,
    rings: parcel.rings.map(toPoints),
    centre: parcel.centroid,
    areaSqm: parcel.areaSqm,
    registerExtent: parcel.registerExtent,
    classification: parcel.classification,
    prohibitedCategory: parcel.prohibitedCategory,
    prohibitedRegisterUnjoined: !parcel.prohibitedCategory && registerUnjoined(report),
    features: report.areaMap.features.map(toFeature).filter((f): f is RevenueMapFeature => f !== null),
    factors: report.factors.filter((f) => f.confidence !== 'declared').map(toFactor),
    insights: report.insights.map((i) => ({
      code: i.code,
      kind: i.kind,
      layerKey: i.layerKey,
      featureId: i.featureId,
      title: i.title,
      status: i.status,
      distanceM: i.distanceM,
      direction: i.direction,
      meaning: i.meaning,
      source: i.source,
    })),
    anchor: guidance
      ? {
          // The engine multiplies guidance up to a market figure; the record
          // keeps what the state published and leaves the multiple to the valuer.
          guidancePerUnit: guidance.basis === 'guidance_multiplied' ? guidance.ratePerUnit / guidance.marketMultiple : guidance.ratePerUnit,
          unit: guidance.unit,
          locality: guidance.locality,
          // The engine's note points at its own "which road" question, which
          // this card does not ask. The rest of the sentence stands.
          note: guidance.note.replace(/ — name the road above and its own value applies/, ''),
        }
      : null,
    emptyLayers: report.areaMap.emptyLayers,
    unreadLayers: report.gaps,
  };
}
