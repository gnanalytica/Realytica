
// Fetching the survey-number map.
//
// Four reads, in the order a person actually thinks: which district, which
// mandal, which village, which survey number — then the parcel itself with its
// boundary. Plus the reverse, for when someone would rather point at the map
// than remember a number.
//
// Every read spans both published layers, because neither alone is the state.
// The municipal layer and the rural survey have disjoint districts, so a merged
// list is the only one that matches what a user believes exists. Failures are
// tracked per source: one layer being down must degrade the answer, not erase
// it, and a picker that silently shows an empty list when the state server is
// down is worse than one that says so — the user concludes their village is
// not covered.

import type { LatLng } from "./geo/measure";
import { mapWithConcurrency } from "./concurrency";
import {
  CADASTRE_BY_KEY,
  CADASTRE_SOURCES,
  buildCadastreWhere,
  cadastreUrl,
  compareParcelNumbers,
  outFieldsFor,
  parseParcelRef,
  shapeParcel,
  shapeSummary,
  sqlLiteral,
  type CadastreFilter,
  type CadastreSource,
  type ParcelRecord,
  type ParcelSummary,
} from "./cadastre";
import {
  INDEX_CAPTURED_ON,
  fallbackDistricts,
  fallbackMandals,
  fallbackVillages,
} from "./cadastre-fallback";
import { bboxAround, pointInRings, type Ring } from "./geometry";
import { getKgisParcel, kgisNeighbours } from "./karnataka/kgis";
import {
  KA_INDEX_CAPTURED_ON,
  kaDistricts,
  kaTaluks,
  kaVillageByLabel,
  kaVillageLabels,
} from "./karnataka/village-index";
import { kaveriVillagesFor } from "./karnataka/rates";
import type { StateKey } from "./states";

/**
 * A distinct-value scan over the 910k-row rural layer takes about 20 seconds on
 * the state's server, so the list reads get their own, longer budget. Feature
 * reads are narrow and stay tight.
 */
const LIST_TIMEOUT_MS = 28_000;
const FEATURE_TIMEOUT_MS = 12_000;

/**
 * The cadastre is republished on the order of months, and the district / mandal
 * / village lists are pure functions of it, so every user paying the 20-second
 * scan again would be a self-inflicted wound. Inside Kshetra this went through
 * Next's data cache; here it is a module-level map with the same week-long
 * TTL, which survives for the life of one process. The on-disk snapshot
 * (`cadastre-fallback`) is what covers a cold instance.
 */
const CACHE_SECONDS = 60 * 60 * 24 * 7;
const askCache = new Map<string, { at: number; body: EsriResponse }>();

/** The service caps a page at 1000; the picker never needs more than this. */
const MAX_ROWS = 400;

export type CadastreOutcome<T> =
  | {
      ok: true;
      data: T;
      /** Sources that failed, when the rest still answered. */
      partial?: string[];
      /** Set when the live read failed and this came from the on-disk snapshot. */
      snapshotOn?: string;
    }
  | { ok: false; reason: "timeout" | "http" | "server" | "parse"; detail: string };

/**
 * Serve a list from the snapshot when the live read failed or came back empty.
 * An empty live list is treated as a failure on purpose: the merge across two
 * layers turns a single downed source into a short list rather than an error,
 * and a user cannot tell those apart.
 */
function orSnapshot(
  live: CadastreOutcome<string[]>,
  offline: () => string[],
): CadastreOutcome<string[]> {
  if (live.ok && live.data.length > 0) return live;
  const fallback = offline();
  if (fallback.length === 0) return live;
  return { ok: true, data: fallback, snapshotOn: INDEX_CAPTURED_ON };
}

type EsriFeature = {
  attributes?: Record<string, unknown>;
  geometry?: { rings?: Ring[] };
};

type EsriResponse = {
  features?: EsriFeature[];
  error?: { code?: number; message?: string };
};

async function ask(
  source: CadastreSource,
  params: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<CadastreOutcome<EsriResponse>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FEATURE_TIMEOUT_MS);
  const url = `${cadastreUrl(source)}?${new URLSearchParams({ f: "json", ...params }).toString()}`;
  const cached = askCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_SECONDS * 1000) {
    clearTimeout(timer);
    return { ok: true, data: cached.body };
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, reason: "http", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as EsriResponse;
    if (body.error) {
      return { ok: false, reason: "server", detail: body.error.message ?? "query rejected" };
    }
    askCache.set(url, { at: Date.now(), body });
    return { ok: true, data: body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "parse",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the same read against every layer and merge. Fails only when every source
 * failed — a half-answer with the missing half named beats no answer.
 */
async function acrossSources<T>(
  run: (source: CadastreSource) => Promise<CadastreOutcome<T[]>>,
  merge: (all: T[]) => T[],
): Promise<CadastreOutcome<T[]>> {
  const results = await mapWithConcurrency(CADASTRE_SOURCES, CADASTRE_SOURCES.length, async (s) => ({
    source: s,
    outcome: await run(s),
  }));

  const good = results.filter((r) => r.outcome.ok);
  if (good.length === 0) {
    const first = results[0]?.outcome;
    return first && !first.ok ? first : { ok: false, reason: "parse", detail: "No cadastre source answered." };
  }

  const merged = merge(good.flatMap((r) => (r.outcome.ok ? r.outcome.data : [])));
  const failed = results.filter((r) => !r.outcome.ok).map((r) => r.source.label);
  return failed.length ? { ok: true, data: merged, partial: failed } : { ok: true, data: merged };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function distinct(
  source: CadastreSource,
  field: string,
  where: string,
): Promise<CadastreOutcome<string[]>> {
  const res = await ask(
    source,
    {
      where,
      outFields: field,
      returnDistinctValues: "true",
      returnGeometry: "false",
      orderByFields: field,
    },
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  if (!res.ok) return res;
  const out: string[] = [];
  for (const f of res.data.features ?? []) {
    const v = f.attributes?.[field];
    const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
    if (s) out.push(s);
  }
  return { ok: true, data: out };
}

/**
 * Every district either layer publishes. The municipal layer names the ten
 * pre-2016 districts and the rural layer names seven post-2016 ones, so the
 * merged list mixes both vintages — which is what the data says, and better
 * than picking one and dropping half the state.
 */
/**
 * Karnataka's lists come from the captured index only — K-GIS has no call that
 * enumerates villages, so the sweep is the source, not a fallback. It is
 * labelled with its date the same way a Telangana snapshot is.
 */
function kaList(items: string[]): CadastreOutcome<string[]> {
  return { ok: true, data: items, snapshotOn: KA_INDEX_CAPTURED_ON };
}

export async function listDistricts(state: StateKey = "TS"): Promise<CadastreOutcome<string[]>> {
  if (state === "KA") return kaList(kaDistricts());
  const live = await acrossSources((s) => distinct(s, s.fields.district, "1=1"), uniqueSorted);
  return orSnapshot(live, fallbackDistricts);
}

export async function listMandals(
  district: string,
  state: StateKey = "TS",
): Promise<CadastreOutcome<string[]>> {
  if (state === "KA") return kaList(kaTaluks(district));
  const live = await acrossSources(
    (s) => distinct(s, s.fields.mandal, `${s.fields.district}=${sqlLiteral(district)}`),
    uniqueSorted,
  );
  return orSnapshot(live, () => fallbackMandals(district));
}

export async function listVillages(
  district: string,
  mandal: string,
  state: StateKey = "TS",
): Promise<CadastreOutcome<string[]>> {
  if (state === "KA") return kaList(kaVillageLabels(district, mandal));
  const live = await acrossSources(
    (s) =>
      distinct(
        s,
        s.fields.village,
        `${s.fields.district}=${sqlLiteral(district)} AND ${s.fields.mandal}=${sqlLiteral(mandal)}`,
      ),
    uniqueSorted,
  );
  return orSnapshot(live, () => fallbackVillages(district, mandal));
}

/**
 * Survey numbers matching a filter, ordered the way a survey number reads.
 *
 * Karnataka has no list to search: the one number typed is fetched, and the
 * answer is that parcel or nothing. Typing "12" cannot offer 12/1 there.
 */
export async function searchParcels(
  filter: CadastreFilter,
  state: StateKey = "TS",
): Promise<CadastreOutcome<ParcelSummary[]>> {
  if (state === "KA") {
    const v =
      filter.district && filter.mandal && filter.village
        ? kaVillageByLabel(filter.district, filter.mandal, filter.village)
        : null;
    if (!v) return { ok: false, reason: "parse", detail: "Pick a district, taluk and village first." };
    if (!filter.parcelPrefix) return { ok: true, data: [] };
    const res = await getKgisParcel(v.code, filter.parcelPrefix);
    if (!res.ok) return res;
    if (!res.data) return { ok: true, data: [] };
    const { ref, source, parcelNo, village, mandal, district, classification, prohibitedCategory, remarks } = res.data;
    return {
      ok: true,
      data: [
        {
          ref,
          source,
          state: "KA",
          parcelNo,
          village,
          mandal,
          district,
          // A hissa that could not be resolved is said on the row itself.
          classification: remarks ? `Whole survey number — ${remarks.split(";")[0].toLowerCase()}` : classification,
          prohibitedCategory,
          guidanceKnown: kaveriVillagesFor(v.code, v.village, v.hobli).length > 0,
        },
      ],
    };
  }
  return acrossSources(
    async (source) => {
      const res = await ask(
        source,
        {
          where: buildCadastreWhere(source, filter),
          outFields: outFieldsFor(source).join(","),
          returnGeometry: "false",
          resultRecordCount: String(MAX_ROWS),
        },
        { timeoutMs: LIST_TIMEOUT_MS },
      );
      if (!res.ok) return res;
      const rows = (res.data.features ?? [])
        .map((f) => shapeSummary(source, f.attributes ?? {}))
        .filter((r): r is ParcelSummary => r !== null);
      return { ok: true, data: rows };
    },
    (all) => all.sort((a, b) => compareParcelNumbers(a.parcelNo, b.parcelNo)),
  );
}

/** One parcel with its boundary, ready to drive the whole dossier. */
export async function getParcel(ref: string): Promise<CadastreOutcome<ParcelRecord | null>> {
  const parsed = parseParcelRef(ref);
  if (!parsed) {
    return { ok: false, reason: "parse", detail: "A survey number reference is required." };
  }
  if (parsed.source === "kgis") return getKgisParcel(parsed.code, parsed.surveyNo);
  const source = CADASTRE_BY_KEY[parsed.source];
  const res = await ask(source, {
    where: `${source.fields.id}=${parsed.id}`,
    outFields: outFieldsFor(source).join(","),
    returnGeometry: "true",
    outSR: "4326",
  });
  if (!res.ok) return res;
  const feature = (res.data.features ?? [])[0];
  if (!feature) return { ok: true, data: null };
  return {
    ok: true,
    data: shapeParcel(source, feature.attributes ?? {}, feature.geometry?.rings ?? []),
  };
}

/**
 * Every parcel whose boundary falls in a box around a point — the subject's
 * neighbours, so the plot can be drawn where it actually sits rather than as a
 * shape floating on its own. This is the survey map a person recognises: their
 * number, and the numbers around it.
 */
export async function neighbouringParcels(
  point: LatLng,
  radiusM = 220,
  limit = 120,
  /** The subject's own ref; needed in Karnataka, where neighbours are found by number. */
  ref: string | null = null,
): Promise<CadastreOutcome<ParcelRecord[]>> {
  const parsed = ref ? parseParcelRef(ref) : null;
  if (parsed?.source === "kgis") {
    return { ok: true, data: await kgisNeighbours(parsed.code, parsed.surveyNo, point) };
  }
  const box = bboxAround(point, radiusM);
  return acrossSources<ParcelRecord>(
    async (source) => {
      const res = await ask(source, {
        where: "1=1",
        geometry: `${box.xmin},${box.ymin},${box.xmax},${box.ymax}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        outSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: outFieldsFor(source).join(","),
        returnGeometry: "true",
        resultRecordCount: String(limit),
      });
      if (!res.ok) return res;
      const rows: ParcelRecord[] = [];
      for (const f of res.data.features ?? []) {
        const rings = f.geometry?.rings ?? [];
        if (!rings.length) continue;
        const record = shapeParcel(source, f.attributes ?? {}, rings);
        if (record) rows.push(record);
      }
      return { ok: true, data: rows };
    },
    (all) => all.slice(0, limit),
  );
}

/**
 * The parcel under a dropped pin. An envelope wide enough to catch the parcel
 * whatever its shape, then point-in-polygon locally — the service's own spatial
 * relate is unreliable here, the same reason nothing else in this module asks
 * it for proximity.
 *
 * The two layers do not overlap geographically, so the first containing hit
 * across either of them is the answer.
 */
export async function findParcelAt(
  point: LatLng,
  searchRadiusM = 150,
): Promise<CadastreOutcome<ParcelRecord | null>> {
  const box = bboxAround(point, searchRadiusM);

  const found = await acrossSources<ParcelRecord>(
    async (source) => {
      const res = await ask(source, {
        where: "1=1",
        geometry: `${box.xmin},${box.ymin},${box.xmax},${box.ymax}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        outSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: outFieldsFor(source).join(","),
        returnGeometry: "true",
        resultRecordCount: "60",
      });
      if (!res.ok) return res;
      const hits: ParcelRecord[] = [];
      for (const f of res.data.features ?? []) {
        const rings = f.geometry?.rings ?? [];
        if (!rings.length || !pointInRings(point, rings)) continue;
        const record = shapeParcel(source, f.attributes ?? {}, rings);
        if (record) hits.push(record);
      }
      return { ok: true, data: hits };
    },
    (all) => all,
  );

  if (!found.ok) return found;
  return { ok: true, data: found.data[0] ?? null, partial: found.partial };
}
