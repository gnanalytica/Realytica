
// ArcGIS REST client for the Telangana GIS layers.
//
// Two things about this server shape the design. Its `distance`/`units` query
// parameters silently return zero features rather than an error, so proximity is
// NEVER asked of the server — we send an envelope and measure locally. And it
// answers over plain HTTP with no SLA, so every call is individually timed out
// and every failure is returned as a value, not thrown: a lookup that loses one
// layer must still produce the other eight plus an honest gap.

import { mapWithConcurrency } from "./concurrency";
import { WATER_MIRROR_CAPTURED_ON, mirroredWaterBodies } from "./layer-mirror";
import type { LatLng } from "./geo/measure";
import { haversineMeters } from "./geo/measure";
import {
  bboxAround,
  distanceToPathsMeters,
  distanceToRingsMeters,
  pointInRings,
  type Path,
  type Ring,
} from "./geometry";
import { TGRAC_ROOT, type LayerSpec } from "./layers";

export type AttributeBag = Record<string, string | number | null>;

/**
 * The feature's shape, in degrees, as the server returned it. Kept so the
 * area map can draw the lake or the alignment the factor is talking about —
 * a finding a person can see on the same sketch as their boundary is one they
 * believe, and one they can check against the ground.
 */
export type HitGeometry = {
  rings?: Ring[];
  paths?: Path[];
  /** [lng, lat] */
  point?: [number, number];
};

export type LayerHit = {
  layerKey: string;
  /** Metres from the subject. 0 when the subject is inside the feature. */
  distanceM: number;
  /** True only for polygons that actually contain the point. */
  contains: boolean;
  attributes: AttributeBag;
  geometry?: HitGeometry;
};

export type LayerOutcome =
  | {
      ok: true;
      key: string;
      hits: LayerHit[];
      /**
       * Set when the live layer could not be read and the answer came from the
       * on-disk mirror instead. Carried all the way to the evidence line on
       * screen — a mirrored answer shown as a live one is the same dishonesty
       * as a stale rate with today's date beside it.
       */
      mirroredOn?: string;
    }
  | { ok: false; key: string; reason: "timeout" | "http" | "server" | "parse"; detail: string };

type EsriFeature = {
  attributes?: Record<string, unknown>;
  geometry?: {
    rings?: Ring[];
    paths?: Path[];
    x?: number;
    y?: number;
  };
};

type EsriResponse = {
  features?: EsriFeature[];
  error?: { code?: number; message?: string };
};

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * How many times to re-ask a layer that failed to connect.
 *
 * The state hosts these as separate ArcGIS services on one machine and they
 * fall over independently — measured from one point, `water_bodies` and
 * `prohibited_land` refused the connection in 114 ms and 672 ms while the other
 * seven answered normally. A refusal that fast is a blip, not a busy server,
 * and re-asking costs almost nothing.
 *
 * It matters more for these two than for any other layer: they carry the lake
 * buffer and the Section 22-A register, the two findings that can make a
 * property unsellable. Losing them to a dropped connection turns the most
 * important answer in the report into "could not be reached".
 */
const RETRIES = 2;
const RETRY_BACKOFF_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
const DEFAULT_CONCURRENCY = 4;
/** A neighbourhood query that returns this many rows is a mis-scoped envelope. */
const MAX_FEATURES = 400;

function cleanAttributes(raw: Record<string, unknown> | undefined, keep: string[]): AttributeBag {
  const out: AttributeBag = {};
  if (!raw) return out;
  for (const key of keep) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v === "number") out[key] = Number.isFinite(v) ? v : null;
    else if (typeof v === "string") {
      const trimmed = v.trim();
      out[key] = trimmed === "" ? null : trimmed;
    } else out[key] = null;
  }
  return out;
}

function buildUrl(spec: LayerSpec, point: LatLng): string {
  const params = new URLSearchParams({
    where: spec.where ?? "1=1",
    outFields: spec.outFields.join(","),
    returnGeometry: spec.attributesOnly ? "false" : "true",
    outSR: "4326",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: String(MAX_FEATURES),
    f: "json",
  });
  if (spec.maxAllowableOffset) {
    params.set("maxAllowableOffset", String(spec.maxAllowableOffset));
    params.set("geometryPrecision", "5");
  }

  // A zero radius means "does this feature contain the point". Without
  // geometry coming back there is no local containment test, so the server is
  // asked the exact question with a point, not a 1 m box — a box touching a
  // zone boundary returns both zones and neither is the answer.
  if (spec.attributesOnly && spec.radiusM === 0) {
    params.set("geometryType", "esriGeometryPoint");
    params.set(
      "geometry",
      JSON.stringify({ x: point.lng, y: point.lat, spatialReference: { wkid: 4326 } }),
    );
    return `${spec.root ?? TGRAC_ROOT}/${spec.path}/query?${params.toString()}`;
  }

  // Otherwise an envelope. Of zero width it is still a valid intersects test
  // and is far cheaper than pulling every parcel in the neighbourhood.
  const box = bboxAround(point, Math.max(spec.radiusM, 1));
  params.set("geometryType", "esriGeometryEnvelope");
  params.set(
    "geometry",
    JSON.stringify({ ...box, spatialReference: { wkid: 4326 } }),
  );

  return `${spec.root ?? TGRAC_ROOT}/${spec.path}/query?${params.toString()}`;
}

function measure(spec: LayerSpec, point: LatLng, feature: EsriFeature): LayerHit | null {
  const attributes = cleanAttributes(feature.attributes, spec.outFields);
  const geom = feature.geometry;

  // No geometry asked for: the server's intersects test is the answer. With a
  // 1 m envelope that is containment; with a wider one it is "within the box",
  // reported at the box's radius so nothing downstream reads it as adjacent.
  if (spec.attributesOnly) {
    const contains = spec.radiusM === 0;
    return { layerKey: spec.key, distanceM: contains ? 0 : spec.radiusM, contains, attributes };
  }

  if (spec.geometry === "polygon") {
    const rings = geom?.rings;
    if (!rings?.length) return null;
    const contains = pointInRings(point, rings);
    return {
      layerKey: spec.key,
      distanceM: contains ? 0 : distanceToRingsMeters(point, rings),
      contains,
      attributes,
      geometry: { rings },
    };
  }

  if (spec.geometry === "polyline") {
    const paths = geom?.paths;
    if (!paths?.length) return null;
    return {
      layerKey: spec.key,
      distanceM: distanceToPathsMeters(point, paths),
      contains: false,
      attributes,
      geometry: { paths },
    };
  }

  const x = geom?.x;
  const y = geom?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return {
    layerKey: spec.key,
    distanceM: haversineMeters(point, { lat: y, lng: x }),
    contains: false,
    attributes,
    geometry: { point: [x, y] },
  };
}

async function queryOne(
  spec: LayerSpec,
  point: LatLng,
  defaultTimeoutMs: number,
): Promise<LayerOutcome> {
  const timeoutMs = spec.timeoutMs ?? defaultTimeoutMs;
  let last: LayerOutcome | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt);
    const outcome = await attemptOne(spec, point, timeoutMs);
    if (outcome.ok) return outcome;
    last = outcome;
    // A rejection the server actually authored is a real answer — the query was
    // wrong, or the layer is gone — and asking again will not change it. Only
    // transport failures are worth repeating.
    if (outcome.reason === "server" || outcome.reason === "http") break;
  }
  // Last resort for the one layer that must not go missing. The lake buffer can
  // make a plot unbuildable, and losing it to a refused connection would turn
  // the most consequential finding in the report into "not checked".
  if (spec.key === "water_bodies" && WATER_MIRROR_CAPTURED_ON) {
    const hits = mirroredWaterBodies(point, spec.radiusM);
    if (hits) {
      return { ok: true, key: spec.key, hits, mirroredOn: WATER_MIRROR_CAPTURED_ON };
    }
  }

  return last ?? { ok: false, key: spec.key, reason: "parse", detail: "no attempt was made" };
}

async function attemptOne(
  spec: LayerSpec,
  point: LatLng,
  timeoutMs: number,
): Promise<LayerOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(buildUrl(spec, point), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, key: spec.key, reason: "http", detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as EsriResponse;
    if (body.error) {
      return {
        ok: false,
        key: spec.key,
        reason: "server",
        detail: body.error.message ?? `code ${body.error.code ?? "?"}`,
      };
    }
    const hits = (body.features ?? [])
      .map((f) => measure(spec, point, f))
      .filter((h): h is LayerHit => h !== null)
      .filter((h) => h.distanceM <= Math.max(spec.radiusM, 1))
      .sort((a, b) => a.distanceM - b.distanceM);
    return { ok: true, key: spec.key, hits };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      key: spec.key,
      reason: aborted ? "timeout" : "parse",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function queryLayers(
  point: LatLng,
  specs: LayerSpec[],
  options: { timeoutMs?: number; concurrency?: number } = {},
): Promise<LayerOutcome[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  return mapWithConcurrency(specs, concurrency, (spec) => queryOne(spec, point, timeoutMs));
}

/** Exported for the probe script, which checks the live layers without the app. */
export const __internal = { buildUrl, measure, cleanAttributes };
