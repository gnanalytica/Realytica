/**
 * Parcel geometry.
 *
 * Tested against shapes whose answers are known by hand, because a geometry
 * bug is invisible: it returns a plausible number and nothing downstream can
 * tell it is wrong. The rectangle cases in particular pin the erosion formula
 * against the closed form (w−2d)(h−2d).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaSqm, boundaryMetrics, buildBoundary, distancePointToPolygonM, erodedAreaSqm, isConvex, openRing, parseBoundary, perimeterM, pointInRing, projectRing, ringsOverlap } from '@realytica/shared';
import type { GeoPoint } from '@realytica/shared';

/** A w x h rectangle in metres, placed near Bengaluru. */
function rectangle(widthM: number, heightM: number, lat = 12.97, lng = 77.59): GeoPoint[] {
  const dLat = heightM / 111_320;
  const dLng = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng },
    { lat, lng },
  ];
}

const close = (a: number, b: number, tol: number, what: string) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: expected ~${b}, got ${a}`);

describe('area and perimeter', () => {
  it('measures a 30x40 ft site — the Bengaluru standard — to within a square metre', () => {
    // 30ft x 40ft = 9.144m x 12.192m = 111.48 sqm, the seed case's plot area.
    const ring = rectangle(9.144, 12.192);
    close(areaSqm(projectRing(ring)), 111.48, 1, 'area of a 30x40 site');
  });

  it('measures a 1-acre parcel', () => {
    const ring = rectangle(63.61, 63.61); // 63.61m square ≈ 4046 sqm = 1 acre
    close(areaSqm(projectRing(ring)), 4046, 20, 'area of an acre');
  });

  it('gets the perimeter right', () => {
    close(perimeterM(projectRing(rectangle(20, 30))), 100, 0.5, 'perimeter of a 20x30');
  });

  it('corrects for longitude shrinking with latitude', () => {
    // The same degree span is a shorter distance further from the equator. If
    // the projection ignored that, these would come out equal — and a 30x40
    // site would be over a metre wrong in Bengaluru.
    const atEquator = areaSqm(projectRing(rectangle(50, 50, 0.0)));
    const atBengaluru = areaSqm(projectRing(rectangle(50, 50, 12.97)));
    close(atEquator, atBengaluru, 1, 'a 50x50 is a 50x50 wherever it is');
  });

  it('drops the duplicated closing vertex', () => {
    assert.equal(openRing(projectRing(rectangle(10, 10))).length, 4);
  });
});

describe('setback erosion', () => {
  it('matches the closed form on a rectangle', () => {
    // (w-2d)(h-2d) is the answer for a rectangle, and the formula must
    // reproduce it exactly rather than approximately.
    for (const [w, h, d] of [
      [20, 30, 3],
      [40, 60, 5],
      [12, 12, 2],
    ]) {
      const expected = (w - 2 * d) * (h - 2 * d);
      close(erodedAreaSqm(projectRing(rectangle(w, h)), d), expected, 1, `${w}x${h} eroded by ${d}m`);
    }
  });

  it('returns zero once the setback has swallowed the plot', () => {
    // A 14.8m square vanishes at a 7.4m setback. Anything at or beyond that
    // is nothing.
    assert.equal(erodedAreaSqm(projectRing(rectangle(14.8, 14.8)), 7.4), 0);
    assert.equal(erodedAreaSqm(projectRing(rectangle(14.8, 14.8)), 8), 0);
  });

  it('does not let the footprint grow again past full erosion', () => {
    // The regression this guards, and it is not hypothetical: the expression
    // is a parabola in d, so past the vertex it turns positive and reports a
    // footprint that increases with the setback. At 10m a side this square
    // was returning 27 sqm.
    const ring = projectRing(rectangle(14.8, 14.8));
    let previous = Infinity;
    for (const d of [1, 2, 3, 4, 5, 6, 7, 7.4, 8, 10, 20]) {
      const area = erodedAreaSqm(ring, d);
      assert.ok(area <= previous + 1e-6, `setting back further must never leave more: ${d}m gave ${area}`);
      previous = area;
    }
    assert.equal(previous, 0);
  });

  it('leaves a sliver where a sliver is what is left', () => {
    // The same square set back 7m leaves 0.8m x 0.8m. Rounding that to zero
    // would be as wrong as returning a negative: the parcel is not fully
    // consumed, it is merely unbuildable, and those are different findings.
    close(erodedAreaSqm(projectRing(rectangle(14.8, 14.8)), 7), 0.64, 0.05, 'a 0.8m sliver');
  });

  it('leaves the area alone at zero setback', () => {
    const ring = projectRing(rectangle(20, 30));
    close(erodedAreaSqm(ring, 0), areaSqm(ring), 0.01, 'no setback, no loss');
  });
});

describe('convexity', () => {
  it('calls a rectangle convex', () => {
    assert.equal(isConvex(projectRing(rectangle(20, 30))), true);
  });

  it('spots an L-shaped parcel', () => {
    // Concave, so the erosion formula overestimates — which is why callers
    // are told rather than left to assume.
    const lat = 12.97;
    const lng = 77.59;
    const dLat = (m: number) => m / 111_320;
    const dLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
    const L: GeoPoint[] = [
      { lat, lng },
      { lat, lng: lng + dLng(30) },
      { lat: lat + dLat(10), lng: lng + dLng(30) },
      { lat: lat + dLat(10), lng: lng + dLng(10) },
      { lat: lat + dLat(30), lng: lng + dLng(10) },
      { lat: lat + dLat(30), lng },
      { lat, lng },
    ];
    assert.equal(isConvex(projectRing(L)), false);
  });
});

describe('boundary metrics', () => {
  it('reports elongation, which is what makes a square assumption wrong', () => {
    const m = boundaryMetrics(rectangle(10, 60));
    assert.ok(m);
    close(m.elongation, 6, 0.1, 'a 10x60 strip is six times as long as it is wide');
    close(m.longestEdgeM, 60, 0.5, 'longest edge');
    close(m.shortestEdgeM, 10, 0.5, 'shortest edge');
  });

  it('refuses a ring that is not a polygon', () => {
    assert.equal(boundaryMetrics([{ lat: 12.97, lng: 77.59 }]), null);
    assert.equal(boundaryMetrics([]), null);
  });
});

describe('reading a boundary somebody supplied', () => {
  const geojson = (coords: number[][]) =>
    JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } });

  /** A 20x30m rectangle as [lng, lat] pairs, which is GeoJSON's order. */
  const RECT_LNGLAT: number[][] = [
    [77.59, 12.97],
    [77.590184, 12.97],
    [77.590184, 12.970269],
    [77.59, 12.970269],
    [77.59, 12.97],
  ];

  it('reads a GeoJSON polygon in [lng, lat] order', () => {
    const out = parseBoundary(geojson(RECT_LNGLAT));
    assert.ok(out.ok);
    assert.equal(out.format, 'uploaded_geojson');
    // If the order were flipped the parcel would land off the coast of
    // Somalia — this asserts it did not.
    assert.ok(Math.abs(out.ring[0].lat - 12.97) < 0.001);
    assert.ok(Math.abs(out.ring[0].lng - 77.59) < 0.001);
  });

  it('digs a Polygon out of a FeatureCollection', () => {
    const fc = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [RECT_LNGLAT] } }],
    });
    assert.equal(parseBoundary(fc).ok, true);
  });

  it('reads a KML coordinates block', () => {
    const kml = `<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
      ${RECT_LNGLAT.map(([lng, lat]) => `${lng},${lat},0`).join(' ')}
    </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    const out = parseBoundary(kml);
    assert.ok(out.ok);
    assert.equal(out.format, 'uploaded_kml');
  });

  it('refuses a Point, and says why in a sentence a person can act on', () => {
    const point = JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.59, 12.97] } });
    const out = parseBoundary(point);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /cannot enclose land/);
  });

  it('spots coordinates that are not latitude and longitude', () => {
    // A UTM grid, which is what a survey file usually arrives in.
    const utm = geojson([
      [563000, 1434000],
      [563050, 1434000],
      [563050, 1434030],
      [563000, 1434030],
      [563000, 1434000],
    ]);
    const out = parseBoundary(utm);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /projected grid/);
  });

  it('refuses something far too big to be a parcel', () => {
    const huge = geojson(Array.from({ length: 2500 }, (_, i) => [77.59 + i * 1e-5, 12.97]));
    const out = parseBoundary(huge);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /district or a road network/);
  });

  it('refuses collinear points that enclose nothing', () => {
    const line = geojson([
      [77.59, 12.97],
      [77.591, 12.97],
      [77.592, 12.97],
      [77.59, 12.97],
    ]);
    const out = parseBoundary(line);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /encloses no area/);
  });

  it('builds a stored boundary with its metrics computed once', () => {
    const out = parseBoundary(geojson(RECT_LNGLAT));
    assert.ok(out.ok);
    const boundary = buildBoundary(out.ring, 'uploaded_geojson', '2026-08-26T00:00:00.000Z', 'survey.kml');
    assert.ok(boundary);
    close(boundary.computedAreaSqm, 600, 15, 'a 20x30 measures 600 sqm');
    assert.equal(boundary.convex, true);
    assert.ok(boundary.elongation > 1.3);
  });
});

describe('point versus ring', () => {
  it('knows the centre of a rectangle is inside and a point outside is not', () => {
    const ring = rectangle(40, 40);
    const inside = { lat: 12.97 + 20 / 111_320, lng: 77.59 + 20 / (111_320 * Math.cos((12.97 * Math.PI) / 180)) };
    const outside = { lat: 12.97, lng: 77.59 + 80 / (111_320 * Math.cos((12.97 * Math.PI) / 180)) };
    assert.equal(pointInRing(inside, ring), true);
    assert.equal(pointInRing(outside, ring), false);
    assert.equal(distancePointToPolygonM(inside, ring), 0);
    close(distancePointToPolygonM(outside, ring), 40, 2, '40m east of a 40m-wide plot');
  });

  it('detects overlapping rectangles and ignores separated ones', () => {
    const a = rectangle(40, 40);
    const shifted = rectangle(40, 40, 12.97, 77.59 + 20 / (111_320 * Math.cos((12.97 * Math.PI) / 180)));
    const far = rectangle(40, 40, 12.97, 77.59 + 200 / (111_320 * Math.cos((12.97 * Math.PI) / 180)));
    assert.equal(ringsOverlap(a, shifted), true);
    assert.equal(ringsOverlap(a, far), false);
  });
});
