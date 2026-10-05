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

import { acceptedFacts, applyRevenueMap, revenueReads, splitSurveyNumbers, surveyNoFromParcelId, type DdProject } from '@realytica/shared';
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
  /**
   * `near` is set when the number is not in the published map: the numbers
   * there that start the same way. `alsoAsked` is the other spellings of the
   * number the map was asked for, and did not hold either.
   */
  | { ok: false; status: 400 | 404 | 502; error: string; near?: string[]; alsoAsked?: string[] };

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
  /** How the papers, or the person, spell the number where that is not how it is kept: "77/03" for 77/3. */
  asWritten?: readonly string[];
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
 * The spellings a number is asked of the map under, in turn: as it is kept,
 * then as the papers write it.
 *
 * A number is kept without a zero before a part — 77/03 is 77/3 — and is
 * asked for that way first. A state's layer may spell the part with its
 * zero, and it matches the number exactly, so the paper's own spelling is
 * tried when the first is not found. Only another spelling of the same
 * number is ever tried, and only where it asks the map for something
 * different: Karnataka's map is asked for the whole survey number whatever
 * part is named, so 77/3 and 77/03 are one question there, asked once.
 */
export function spellingsToAsk(state: StateKey, surveyNo: string, asWritten: readonly string[] = []): string[] {
  const numberOf = (spelling: string) => splitSurveyNumbers(spelling)[0]?.toUpperCase();
  const asked = (spelling: string) => (state === 'KA' ? (spelling.split(/[/-]/)[0] ?? spelling) : spelling).toUpperCase();
  const out = [surveyNo];
  for (const spelling of asWritten) {
    const written = spelling.replace(/\s+/g, '');
    if (!written || !numberOf(surveyNo) || numberOf(written) !== numberOf(surveyNo)) continue;
    if (!out.some((held) => asked(held) === asked(written))) out.push(written);
  }
  return out.slice(0, 3);
}

/**
 * The parcel the map holds for a number, asked for under each spelling in
 * turn until one answers. `near` is what the first search found beside it,
 * for a person to pick from; `alsoAsked` the spellings tried after the
 * first. A search that fails is a failure whichever spelling it was for: an
 * answer of "not found" is only given when every spelling was truly asked.
 */
export async function parcelUnderAnySpelling<T extends { parcelNo: string }, F extends { ok: false }>(
  spellings: readonly string[],
  search: (spelling: string) => Promise<{ ok: true; data: T[] } | F>,
): Promise<{ found: T } | { failed: F } | { near: string[]; alsoAsked: string[] }> {
  let near: string[] = [];
  for (const [at, spelling] of spellings.entries()) {
    const res = await search(spelling);
    if (!res.ok) return { failed: res };
    const parcel = parcelAnswering(res.data, spelling);
    if (parcel) return { found: parcel };
    if (at === 0) near = res.data.slice(0, 6).map((p) => p.parcelNo);
  }
  return { near, alsoAsked: spellings.slice(1) };
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
  const sought = await parcelUnderAnySpelling(spellingsToAsk(input.state, input.surveyNo, input.asWritten), (spelling) =>
    searchParcels({ district: input.district, mandal: input.mandal, village: input.village, parcelPrefix: spelling }, input.state),
  );
  if ('failed' in sought) {
    const found = sought.failed;
    if (found.reason === 'parse') return { ok: false, status: 400, error: found.detail ?? 'That place could not be matched.' };
    return { ok: false, status: 502, error: mapDown(input.state, found.detail) };
  }
  if ('near' in sought) {
    const { near, alsoAsked } = sought;
    const spelt = alsoAsked.length ? `, under that spelling or as ${alsoAsked.join(' or ')}, the way it is written` : '';
    return {
      ok: false,
      status: 404,
      error: `Sy. ${input.surveyNo} is not in the published map for ${input.village}${spelt}.${near.length ? ` Numbers that start the same way: ${near.join(', ')}.` : ''}`,
      near,
      ...(alsoAsked.length ? { alsoAsked } : {}),
    };
  }
  const exact = sought.found;
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
/* Room on the file                                                    */
/* ------------------------------------------------------------------ */

/**
 * How heavy a project's record may be and still take another parcel's read.
 *
 * A project is stored, and sent to the page, as one piece. The host will not
 * send a piece much over four megabytes, so a record that grows past that
 * stops loading — here and in production, which read the same store — and
 * nothing on the page can then take a read off again. A read is refused well
 * short of it: everything else on the file goes on growing too.
 */
export const PROJECT_RECORD_CEILING_BYTES = 2_500_000;

/** The project's record as it is stored and sent, in bytes. */
export function recordBytes(project: DdProject): number {
  return Buffer.byteLength(JSON.stringify(project), 'utf8');
}

/**
 * What a read adds to a record besides itself: its line on the audit trail.
 * A read that makes the record heavier by no more than this has not made it
 * heavier.
 */
const BESIDES_THE_READ_BYTES = 1_000;

/**
 * Whether the file has room to keep this read, worked out by keeping it on a
 * copy and weighing the copy.
 *
 * Every read is weighed, a parcel read again among them: a fresh read can
 * come back carrying the outlines of half a district that the read it
 * replaces never held. It is refused only where it leaves the record over
 * the ceiling and heavier than it was — a parcel read again at the weight it
 * had is kept, however full the file: it is not what filled it.
 */
export function roomForRead(project: DdProject, read: RevenueMapRead, askedAs?: string): { fits: true } | { fits: false; error: string } {
  const now = JSON.stringify(project);
  const copy = JSON.parse(now) as DdProject;
  applyRevenueMap(copy, read, 'weighing', askedAs);
  const after = recordBytes(copy);
  if (after <= PROJECT_RECORD_CEILING_BYTES || after <= Buffer.byteLength(now, 'utf8') + BESIDES_THE_READ_BYTES) return { fits: true };
  const kept = revenueReads(project);
  const tooHeavy = `with it the project’s record would weigh over ${(PROJECT_RECORD_CEILING_BYTES / 1_000_000).toFixed(1)} MB, and a record much heavier than that stops opening`;
  if (!kept.length) {
    // Nothing from the map is on this file, so there is no read to take off: it is the rest of the file that fills it.
    return {
      fits: false,
      error: `No parcel is kept on this project, and its record is already too heavy to take one. Sy. ${read.surveyNo} was read from the map and is not kept: ${tooHeavy}. It is what else the file holds that fills it.`,
    };
  }
  const count = kept.length === 1 ? '1 parcel is' : `${kept.length} parcels are`;
  if (kept.some((r) => r.parcelRef === read.parcelRef)) {
    return {
      fits: false,
      error: `${count} kept on this project. Sy. ${read.surveyNo} was read again and the fresh read is not kept: it is heavier than the read it would replace, and ${tooHeavy}. The read already kept stays as it was.`,
    };
  }
  return { fits: false, error: `${count} kept on this project. Sy. ${read.surveyNo} was read from the map and is not kept: ${tooHeavy}. Remove a read that is not needed to make room.` };
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
