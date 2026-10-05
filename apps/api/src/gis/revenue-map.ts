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

import { acceptedFacts, revenueReads, splitSurveyNumbers, surveyNoFromParcelId, type DdProject } from '@realytica/shared';
import type { RevenueMapFactor, RevenueMapFeature, RevenueMapFeatureKind, RevenueMapRead } from '@realytica/shared';
import { kaVillageByCode } from '@realytica/site-intel/karnataka/village-index';
import { kaPickerLabel, kaVillageFromAddress } from '@realytica/site-intel/karnataka/place-match';
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
  /** The number resolved to a parcel already kept for the project, by this reference; nothing was read. */
  | { ok: true; already: string }
  /** `near` is set when the number is not in the published map: the numbers there that start the same way. */
  | { ok: false; status: 400 | 404 | 502; error: string; near?: string[] };

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
  /** The parcels already kept for the project, by reference. */
  kept?: readonly string[];
  /**
   * Answer from what is kept when the number resolves to a kept parcel,
   * instead of reading it afresh. Off unless asked for: a caller that knows
   * nothing of kept parcels gets a fresh read, as it always did.
   */
  unlessKept?: boolean;
  /** The number is one of several being read for the same site. */
  several?: boolean;
}

/**
 * The parcel the map answers a survey number with, among what its search
 * found — or none.
 *
 * The number itself, whatever the case of a letter in it. Failing that, a
 * lone result is taken only when it is the survey number the asked one is a
 * part of: "41/2" answered by "41", as Karnataka's map does, which holds
 * whole numbers. A lone result of any other kind is a neighbour the search
 * happened to find — "412" for "41", where the village has no 41 — and
 * reading it would put a stranger's parcel on the file under the number
 * that was asked for.
 */
export function parcelAnswering<T extends { parcelNo: string }>(found: readonly T[], surveyNo: string): T | undefined {
  const asked = surveyNo.toUpperCase();
  const exact = found.find((p) => p.parcelNo.toUpperCase() === asked);
  if (exact || found.length !== 1) return exact;
  const whole = found[0]!.parcelNo.toUpperCase();
  return asked.startsWith(`${whole}/`) || asked.startsWith(`${whole}-`) ? found[0] : undefined;
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
  const exact = parcelAnswering(found.data, input.surveyNo);
  if (!exact) {
    const near = found.data.slice(0, 6).map((p) => p.parcelNo);
    return {
      ok: false,
      status: 404,
      error: near.length
        ? `Sy. ${input.surveyNo} is not in the published map for ${input.village}. Numbers that start the same way: ${near.join(', ')}.`
        : `Sy. ${input.surveyNo} is not in the published map for ${input.village}.`,
      near,
    };
  }
  // Two numbers can be one parcel: Karnataka's map holds whole survey numbers,
  // so 41/1 and 41/2 both resolve to 41. The second is not read a second time.
  const kept = input.kept ?? [];
  if (input.unlessKept && kept.includes(exact.ref)) return { ok: true, already: exact.ref };

  // The engine holds the area quoted for the site against the parcel it reads.
  // That is asked only of a parcel that stands alone: a site's area is all of
  // its parcels. Where it was asked and others are read later, the shared
  // package leaves the check out as it reads them.
  const alone = !input.several && !kept.some((ref) => ref !== exact.ref);
  return readParcel(exact.ref, alone ? input.landAreaSqm : null);
}

/** Everything round one parcel, by the engine's own reference to it. */
async function readParcel(parcelRef: string, landAreaSqm: number | null | undefined): Promise<RevenueReadOutcome> {
  const outcome = await runSiteIntel({
    parcelRef,
    kind: 'open_plot',
    area: landAreaSqm && landAreaSqm > 0 ? landAreaSqm : null,
    areaUnit: 'sqm',
  });
  if (!outcome.ok) {
    return { ok: false, status: outcome.reason === 'not_found' ? 502 : 400, error: outcome.message };
  }
  return { ok: true, read: toRevenueMapRead(outcome.report) };
}

/**
 * Read a kept parcel afresh, by its own reference.
 *
 * Not by its number in whatever village the picker now shows: a site can
 * span two villages that each hold a survey number 41, and reading "41"
 * again in the wrong one adds a stranger's parcel in place of renewing ours.
 */
export async function rereadRevenueMap(input: { parcelRef: string; landAreaSqm?: number | null; kept: readonly string[] }): Promise<RevenueReadOutcome> {
  const alone = !input.kept.some((ref) => ref !== input.parcelRef);
  return readParcel(input.parcelRef, alone ? input.landAreaSqm : null);
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
          note: guidance.note
            .replace(/ — name the road above and its own value applies/, '')
            // The engine's sentence about its own ×1.3 uplift describes a
            // figure this record does not carry.
            .replace(/\s*Uplifted ×[\d.]+ to a traded level[^.]*\./, ''),
        }
      : null,
    emptyLayers: report.areaMap.emptyLayers,
    unreadLayers: report.gaps,
  };
}


/* -------------------------------------------------------------------- */
/* Where to start the picker                                              */
/* -------------------------------------------------------------------- */

export interface RevenuePlaceSuggestion {
  state?: StateKey;
  district?: string;
  mandal?: string;
  village?: string;
  surveyNo?: string;
  /** Where the place came from, said beside the picker so a person checks a guess before reading. */
  from: 'last read' | 'address' | null;
  note?: string;
}

/** The first survey number a document was accepted as stating, when the project records none. */
function surveyNoFromDocuments(project: DdProject): string {
  for (const e of project.evidence) {
    const fact = acceptedFacts(e).find((f) => f.key === 'survey_numbers');
    const first = fact ? splitSurveyNumbers(String(fact.value))[0] : undefined;
    if (first) return first;
  }
  return '';
}

/**
 * The picker's starting place: the last read when there is one — its parcel
 * reference names the exact village — otherwise the village the site address
 * names, matched against the Karnataka index. The survey number comes from
 * the project's parcel, else from a document accepted as stating one.
 *
 * With several parcels kept, the last read is the most recent of them: a
 * person working down a list of numbers is still in that village.
 */
export function suggestRevenuePlace(project: DdProject): RevenuePlaceSuggestion {
  const surveyNo = surveyNoFromParcelId(project.parcelId) || surveyNoFromDocuments(project) || undefined;
  const last = revenueReads(project).reduce<RevenueMapRead | undefined>((latest, r) => (latest && latest.readAt >= r.readAt ? latest : r), undefined);
  if (last) {
    const code = last.state === 'KA' ? /^kgis:(\d+):/.exec(last.parcelRef)?.[1] : undefined;
    const v = code ? kaVillageByCode(code) : null;
    if (v) return { state: 'KA', district: v.district, mandal: v.taluk, village: kaPickerLabel(v), surveyNo: last.surveyNo || surveyNo, from: 'last read' };
    if (last.district && last.mandal && last.village) {
      return { state: last.state, district: last.district, mandal: last.mandal, village: last.village, surveyNo: last.surveyNo || surveyNo, from: 'last read' };
    }
  }
  const address = [project.siteAddress, project.location, project.city].filter(Boolean).join(', ');
  const hit = kaVillageFromAddress(address);
  if (hit.kind === 'match') {
    const agreed = hit.agrees.length ? `, and its ${hit.agrees.join(' and ')} ${hit.agrees.length === 1 ? 'agrees' : 'agree'}` : '';
    return {
      state: 'KA',
      district: hit.village.district,
      mandal: hit.village.taluk,
      village: hit.label,
      surveyNo,
      from: 'address',
      note: `The address names ${hit.village.village}${agreed}. Check it before reading.`,
    };
  }
  return {
    surveyNo,
    from: null,
    note:
      hit.kind === 'ambiguous'
        ? `${hit.candidates} villages share the name in the address. Add the hobli or taluk to the site address and the picker can choose.`
        : undefined,
  };
}
