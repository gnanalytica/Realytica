
// A local copy of the layer that cannot be allowed to go missing.
//
// Two findings here can make a plot unbuildable or unregisterable: the lake
// buffer and the Section 22-A prohibited register. The register survives an
// outage for free, because its category arrives on the parcel row in the same
// call that fetched the parcel. The lake buffer does not — it is a separate
// live query to a separate ArcGIS service, and that service refused the
// connection in 114 ms while its neighbours answered fine.
//
// So the water bodies are mirrored to disk by `pnpm capture:water` and consulted
// when the live read fails. The answer is marked as coming from the copy, with
// its date, everywhere it surfaces. A mirrored answer presented as a live one
// would be the same dishonesty as a stale rate with a fresh date on it.

import mirror from "./water-bodies.json";
import type { LayerHit } from "./arcgis";
import type { LatLng } from "./geo/measure";
import type { Ring } from "./geometry";
import { distanceToRingsMeters, pointInRings } from "./geometry";

type MirroredBody = {
  name: string | null;
  areaSqm: number | null;
  status: string | null;
  village: string | null;
  rings: Ring[];
};

const RAW = mirror as { capturedOn?: string; bodies?: MirroredBody[] };

/** Null when no mirror has been captured, which is a legitimate state. */
export const WATER_MIRROR_CAPTURED_ON =
  RAW.capturedOn && RAW.capturedOn !== "pending" ? RAW.capturedOn : null;

const BODIES: MirroredBody[] = WATER_MIRROR_CAPTURED_ON ? (RAW.bodies ?? []) : [];

/**
 * A cheap bounding box per body, computed once at module load.
 *
 * Without it, one lookup walks 3,905 polygons and every vertex of each. The box
 * rejects almost all of them in four comparisons, which is what makes reading
 * the mirror comparable to the network call it replaces rather than slower.
 */
type Boxed = MirroredBody & {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

const BOXED: Boxed[] = BODIES.map((b) => {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of b.rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { ...b, minLng, maxLng, minLat, maxLat };
});

/** Degrees of latitude/longitude that cover `metres` at this latitude. */
function padding(point: LatLng, metres: number): { lat: number; lng: number } {
  const lat = metres / 111_320;
  const lng = metres / (111_320 * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.1));
  return { lat, lng };
}

/**
 * Water bodies within `radiusM` of a point, in the same shape the live client
 * returns, so nothing downstream needs to know where the answer came from.
 *
 * Returns null when there is no mirror to read — the caller must then report the
 * layer as unreachable rather than as empty. An unread lake layer and a plot
 * with no lake near it are indistinguishable, and only one is safe to act on.
 */
export function mirroredWaterBodies(point: LatLng, radiusM: number): LayerHit[] | null {
  if (!WATER_MIRROR_CAPTURED_ON) return null;

  const pad = padding(point, radiusM);
  const hits: LayerHit[] = [];

  for (const body of BOXED) {
    if (
      point.lng < body.minLng - pad.lng ||
      point.lng > body.maxLng + pad.lng ||
      point.lat < body.minLat - pad.lat ||
      point.lat > body.maxLat + pad.lat
    ) {
      continue;
    }
    const contains = pointInRings(point, body.rings);
    const distanceM = contains ? 0 : distanceToRingsMeters(point, body.rings);
    if (distanceM > radiusM) continue;
    hits.push({
      layerKey: "water_bodies",
      distanceM,
      contains,
      attributes: {
        WB_Name: body.name,
        Area: body.areaSqm,
        WBS_2023: body.status,
        Village: body.village,
      },
      geometry: { rings: body.rings },
    });
  }

  return hits.sort((a, b) => a.distanceM - b.distanceM);
}
