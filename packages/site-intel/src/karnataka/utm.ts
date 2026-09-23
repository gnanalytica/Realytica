// UTM zone 43 N to WGS84, and WKT to rings.
//
// K-GIS hands back parcel boundaries as WKT in projected metres (EPSG:32643)
// whatever coordinate type is asked for — asking for degrees returns metres,
// asking for UTM returns nothing. So the conversion lives here, pure, with the
// standard series expansion; at Bengaluru's latitude it agrees with PROJ to
// well under a centimetre, which is far inside the survey's own error.

import type { Ring } from "../geometry";

const A = 6_378_137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

/** Northern hemisphere only — Karnataka is. */
export function utmToLatLng(
  easting: number,
  northing: number,
  zone = 43,
): { lat: number; lng: number } {
  const x = easting - 500_000;
  const m = northing / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));
  const phi1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 * E1) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const n1 = A / Math.sqrt(1 - E2 * sin1 * sin1);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = EP2 * cos1 * cos1;
  const r1 = (A * (1 - E2)) / Math.pow(1 - E2 * sin1 * sin1, 1.5);
  const d = x / (n1 * K0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lng0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lng =
    lng0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
      cos1;
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}

/**
 * `POLYGON ((x y, x y, …), (hole…))` or `MULTIPOLYGON (((…)), ((…)))` to
 * rings in degrees. Every innermost parenthesised list is a ring; the outer
 * nesting only says which polygon it belongs to, and the sketch draws them all.
 */
export function wktToRings(wkt: string, zone = 43): Ring[] {
  const rings: Ring[] = [];
  const re = /\(([^()]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wkt)) !== null) {
    const ring: Ring = [];
    for (const pair of m[1].split(",")) {
      const [xs, ys] = pair.trim().split(/\s+/);
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const { lat, lng } = utmToLatLng(x, y, zone);
      ring.push([lng, lat]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
