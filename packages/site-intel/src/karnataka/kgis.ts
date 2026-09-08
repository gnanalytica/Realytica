
// Reading a Karnataka parcel from K-GIS.
//
// One call per survey number: `geomForSurveyNum/<villageId>/<surveyNo>/DD`
// answers with the boundary as WKT, or `204` when the village has no such
// number. There is no list to search, so the picker asks for exactly what the
// user typed, and the neighbours on the sketch are found by asking for the
// survey numbers either side of it — survey numbers were assigned walking the
// village, so N±6 is usually the plots around N. It is a heuristic and the
// map says so.

import { mapWithConcurrency } from "../concurrency";
import type { LatLng } from "../geo/measure";
import { haversineMeters } from "../geo/measure";
import type { ParcelRecord } from "../cadastre";
import { parcelExtent } from "../cadastre";
import { ringsCentroid, type Ring } from "../geometry";
import { KGIS_SOURCE_LABEL } from "./source";
import { kaVillageByCode, type KaVillage } from "./village-index";
import { wktToRings } from "./utm";

const KGIS_WS = "https://kgis.ksrsac.in:9000/genericwebservices/ws";
const TIMEOUT_MS = 15_000;
/** How far either side of the subject's number the neighbour probe looks. */
const NEIGHBOUR_SPAN = 6;
/** A probed neighbour further than this is a numbering coincidence, not a neighbour. */
const NEIGHBOUR_MAX_M = 500;

export type KgisOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "timeout" | "http" | "server" | "parse"; detail: string };

/** Survey numbers are digits, optional hissa after a slash, occasionally a letter. */
export function cleanSurveyNo(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9]{1,5}([/-][0-9A-Z]{1,6}){0,3}$/.test(s)) return null;
  return s;
}

/**
 * K-GIS maps whole survey numbers, not hissas: "12/1" cannot be asked for (a
 * slash is a path separator to it, and "12-1" answers nothing), and the
 * boundary it holds for 12 is the whole number. So a hissa is split off, the
 * whole number is fetched, and the record says which hissa was asked about.
 */
export function splitSurveyNo(raw: string): { base: string; hissa: string | null } | null {
  const s = cleanSurveyNo(raw);
  if (!s) return null;
  const m = /^([0-9]{1,5})(?:[/-](.+))?$/.exec(s);
  if (!m) return null;
  return { base: m[1], hissa: m[2] ?? null };
}

async function fetchRings(villageId: string, surveyNo: string): Promise<KgisOutcome<Ring[] | null>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${KGIS_WS}/geomForSurveyNum/${encodeURIComponent(villageId)}/${encodeURIComponent(surveyNo)}/DD`;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Kshetra)" },
    });
    if (!res.ok) return { ok: false, reason: "http", detail: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text.trim()) return { ok: true, data: null };
    const body = JSON.parse(text) as { message?: string; geom?: string }[];
    const rings: Ring[] = [];
    for (const row of body) {
      if (row.message !== "200" || !row.geom) continue;
      rings.push(...wktToRings(row.geom));
    }
    return { ok: true, data: rings.length ? rings : null };
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

export function kgisRef(code: string, surveyNo: string): string {
  return `kgis:${code}:${surveyNo}`;
}

function shape(v: KaVillage, surveyNo: string, rings: Ring[], hissa: string | null = null): ParcelRecord | null {
  const centroid = ringsCentroid(rings);
  if (!centroid) return null;
  const extent = parcelExtent(rings);
  return {
    ref: kgisRef(v.code, surveyNo),
    source: "kgis",
    state: "KA",
    parcelNo: surveyNo,
    village: v.village,
    mandal: v.taluk,
    district: v.district,
    classification: `${v.hobli} hobli`,
    prohibitedCategory: null,
    sourceLabel: KGIS_SOURCE_LABEL,
    rings,
    centroid,
    areaSqm: extent.sqm,
    areaSqyd: extent.sqyd,
    areaAcres: extent.acres,
    classificationCode: null,
    registerExtent: null,
    remarks: hissa
      ? `Hissa ${hissa} is not mapped separately on K-GIS; the boundary and extent shown are the whole survey number ${surveyNo}.`
      : null,
  };
}

/**
 * One parcel by village code and survey number. A village with two K-GIS ids
 * is asked under each until one answers; a `204` from every id means the
 * number is not on the map, which is a real answer, not a failure.
 */
export async function getKgisParcel(
  code: string,
  surveyNo: string,
): Promise<KgisOutcome<ParcelRecord | null>> {
  const v = kaVillageByCode(code);
  if (!v) return { ok: false, reason: "parse", detail: "Unknown village code." };
  const split = splitSurveyNo(surveyNo);
  if (!split) return { ok: false, reason: "parse", detail: "That is not a survey number." };

  let last: KgisOutcome<Ring[] | null> | null = null;
  for (const id of v.ids) {
    const res = await fetchRings(id, split.base);
    if (!res.ok) {
      last = res;
      continue;
    }
    if (res.data) return { ok: true, data: shape(v, split.base, res.data, split.hissa) };
    last = res;
  }
  if (last && !last.ok) return last;
  return { ok: true, data: null };
}

/**
 * The plots around a subject, by probing the survey numbers either side of it
 * and keeping the ones that are actually nearby. Returns whatever answered;
 * a probe that fails is dropped rather than failing the sketch.
 */
export async function kgisNeighbours(
  code: string,
  surveyNo: string,
  centre: LatLng,
): Promise<ParcelRecord[]> {
  const v = kaVillageByCode(code);
  const split = splitSurveyNo(surveyNo);
  if (!v || !split) return [];
  const base = Number.parseInt(split.base, 10);
  if (!Number.isFinite(base)) return [];

  const candidates: string[] = [];
  for (let d = 1; d <= NEIGHBOUR_SPAN; d++) {
    if (base - d >= 1) candidates.push(String(base - d));
    candidates.push(String(base + d));
  }

  const found = await mapWithConcurrency(candidates, 4, async (n) => {
    for (const id of v.ids) {
      const res = await fetchRings(id, n);
      if (res.ok && res.data) return shape(v, n, res.data);
      if (!res.ok) return null;
    }
    return null;
  });

  return found
    .filter((p): p is ParcelRecord => p !== null)
    .filter((p) => haversineMeters(centre, p.centroid) <= NEIGHBOUR_MAX_M);
}
