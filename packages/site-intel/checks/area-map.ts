/**
 * Pure checks for the area map and the insights: projection of overlays into
 * the sketch frame, bearings, what gets drawn and what gets said, and — the
 * one that matters most — that a layer which could not be read is reported as
 * unread, never as empty.
 * Run: pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/test-area-map.ts
 */
import assert from "node:assert/strict";

import type { LayerOutcome } from "../src/arcgis";
import { buildAreaMap, deriveInsights } from "../src/area-map";
import {
  bearingDegrees,
  compassLabel,
  nearestPointOnPaths,
  nearestVertex,
} from "../src/geometry";
import { buildSketch } from "../src/plot-map";

// ----------------------------------------------------------------- bearings

const origin = { lat: 17.4, lng: 78.5 };
assert.equal(compassLabel(bearingDegrees(origin, { lat: 17.41, lng: 78.5 })), "north");
assert.equal(compassLabel(bearingDegrees(origin, { lat: 17.4, lng: 78.51 })), "east");
assert.equal(compassLabel(bearingDegrees(origin, { lat: 17.39, lng: 78.49 })), "south-west");
assert.equal(compassLabel(359), "north", "wraps at 360");
assert.equal(compassLabel(-45), "north-west", "negative bearings normalise");

assert.deepEqual(
  nearestVertex(origin, [
    [
      [78.6, 17.4],
      [78.501, 17.4],
      [78.7, 17.4],
    ],
  ]),
  { lat: 17.4, lng: 78.501 },
);

// The nearest point on a long segment is the foot of the perpendicular, not an
// endpoint: a road running east-west 1 km south has both vertices far away.
const foot = nearestPointOnPaths(origin, [
  [
    [78.3, 17.39],
    [78.7, 17.39],
  ],
])!;
assert.ok(Math.abs(foot.lng - origin.lng) < 1e-6 && Math.abs(foot.lat - 17.39) < 1e-9);
assert.equal(compassLabel(bearingDegrees(origin, foot)), "south");

// ------------------------------------------------------------------ fixture

// A plot at the origin; a tank 200 m north-east; the RRR passing 1.2 km south;
// a station 900 m west; a drain 40 m east to be widened to 20 m; a prohibited
// parcel 30 m south with a category, and an ordinary cadastre row without one.
const dLat = (m: number) => m / 111_320;
const dLng = (m: number) => m / (111_320 * Math.cos((origin.lat * Math.PI) / 180));

const tank: [number, number][] = [
  [origin.lng + dLng(150), origin.lat + dLat(150)],
  [origin.lng + dLng(350), origin.lat + dLat(150)],
  [origin.lng + dLng(350), origin.lat + dLat(350)],
  [origin.lng + dLng(150), origin.lat + dLat(350)],
  [origin.lng + dLng(150), origin.lat + dLat(150)],
];
const rrr: [number, number][] = [
  [origin.lng - dLng(20_000), origin.lat - dLat(1_200)],
  [origin.lng + dLng(20_000), origin.lat - dLat(1_200)],
];
const drain: [number, number][] = [
  [origin.lng + dLng(40), origin.lat - dLat(300)],
  [origin.lng + dLng(40), origin.lat + dLat(300)],
];
const listed: [number, number][] = [
  [origin.lng - dLng(20), origin.lat - dLat(30)],
  [origin.lng + dLng(20), origin.lat - dLat(30)],
  [origin.lng + dLng(20), origin.lat - dLat(60)],
  [origin.lng - dLng(20), origin.lat - dLat(60)],
  [origin.lng - dLng(20), origin.lat - dLat(30)],
];

const outcomes: LayerOutcome[] = [
  {
    ok: true,
    key: "water_bodies",
    hits: [
      {
        layerKey: "water_bodies",
        distanceM: 212,
        contains: false,
        attributes: { WB_Name: "Peddacheruvu", Area: 250_000, WBS_2023: "Intact" },
        geometry: { rings: [tank] },
      },
    ],
  },
  {
    ok: true,
    key: "rrr_alignment",
    hits: [
      {
        layerKey: "rrr_alignment",
        distanceM: 1_200,
        contains: false,
        attributes: { Name: "RRR North" },
        geometry: { paths: [rrr] },
      },
    ],
  },
  {
    ok: true,
    key: "metro_stations",
    hits: [
      {
        layerKey: "metro_stations",
        distanceM: 900,
        contains: false,
        attributes: { Name: "Uppal", Line: "Red" },
        geometry: { point: [origin.lng - dLng(900), origin.lat] },
      },
    ],
  },
  {
    ok: true,
    key: "nala_widening",
    hits: [
      {
        layerKey: "nala_widening",
        distanceM: 40,
        contains: false,
        attributes: { Nala_Name: "Kukatpally nala", Prop_Width: 20 },
        geometry: { paths: [drain] },
      },
    ],
  },
  {
    ok: true,
    key: "prohibited_land",
    hits: [
      {
        layerKey: "prohibited_land",
        distanceM: 0,
        contains: true,
        attributes: { CATEGORY_OF_PROHIBITORY_LAND: null, SY_NO: "12" },
        geometry: { rings: [listed] },
      },
      {
        layerKey: "prohibited_land",
        distanceM: 30,
        contains: false,
        attributes: { CATEGORY_OF_PROHIBITORY_LAND: "Govt Land", SY_NO: "13" },
        geometry: { rings: [listed] },
      },
    ],
  },
  { ok: true, key: "hmda_zone", hits: [{ layerKey: "hmda_zone", distanceM: 0, contains: true, attributes: { ZNAME: "Zone 4" } }] },
  { ok: true, key: "industrial", hits: [] },
  { ok: false, key: "flooding", reason: "timeout", detail: "8000 ms" },
];

// --------------------------------------------------------------- area map

const map = buildAreaMap(origin, outcomes);

assert.deepEqual(map.unreadLayers, ["flooding"], "an unread layer is named, not treated as empty");
assert.deepEqual(map.emptyLayers, ["industrial"], "a read-and-empty layer is named separately");

const kinds = map.features.map((f) => f.kind).sort();
assert.deepEqual(kinds, ["metro", "nala", "prohibited", "rrr", "water"]);

const prohibitedDrawn = map.features.filter((f) => f.kind === "prohibited");
assert.equal(prohibitedDrawn.length, 1, "only the parcel actually on the register is drawn");
assert.equal(prohibitedDrawn[0].name, "13");

assert.ok(!map.features.some((f) => f.kind === "hmda_zone"), "the planning boundary is never drawn as a shape");

const rrrDrawn = map.features.find((f) => f.kind === "rrr")!;
const rrrVertices = rrrDrawn.paths!.flat();
assert.ok(rrrVertices.length >= 2, "a long alignment keeps at least the segment that passes the plot");
assert.ok(
  rrrVertices.every(([lng]) => Math.abs(lng - origin.lng) < dLng(20_000) + 1e-9),
  "clipped vertices lie on the original line",
);

// --------------------------------------------------------------- insights

const insights = deriveInsights(origin, outcomes, map);
const byCode = Object.fromEntries(insights.map((i) => [i.code, i]));

assert.equal(insights[0].kind, "risk", "what can stop a sale comes first");
assert.ok(byCode.prohibited, "the neighbouring register parcel is told");
assert.match(byCode.prohibited.meaning, /30 m to the south/);
assert.equal(byCode.rrr.kind, "planned");
assert.equal(byCode.rrr.direction, "south");
assert.match(byCode.rrr.meaning, /1\.2 km to the south/);
assert.match(byCode.rrr.meaning, /not in the corridor/, "1.2 km is the corridor band, not acquisition");
assert.equal(byCode["metro:Uppal:900"].direction, "west");
assert.equal(byCode["metro:Uppal:900"].title, "Uppal metro station (Red)");
assert.equal(byCode["nala:0"].kind, "planned");
assert.match(byCode["nala:0"].title, /widening to 20 m/);
assert.match(byCode["nala:0"].meaning, /setback/, "40 m from a 20 m widening is beside it, not in it");
assert.equal(byCode["water:Peddacheruvu:21"].direction, "north-east");
assert.equal(byCode["water:Peddacheruvu:21"].kind, "existing");
assert.equal(byCode.hmda_zone.direction, null, "inside a jurisdiction has no direction");
assert.ok(!byCode.flood, "an unread layer produces no insight — silence, not a clean bill");
assert.ok(!byCode.industrial, "an empty layer produces no insight");

// Two unnamed tanks at different distances get different codes — they are
// separate cards, and React keys, on screen.
const twoTanks = deriveInsights(origin, [
  {
    ok: true,
    key: "water_bodies",
    hits: [
      { layerKey: "water_bodies", distanceM: 355, contains: false, attributes: { WB_Name: null }, geometry: { rings: [tank] } },
      { layerKey: "water_bodies", distanceM: 962, contains: false, attributes: { WB_Name: null }, geometry: { rings: [tank] } },
    ],
  },
]);
assert.equal(new Set(twoTanks.map((i) => i.code)).size, 2, "unnamed tanks keep distinct codes");

// Every drawn feature an insight names is actually on the map.
for (const i of insights) {
  if (i.featureId) assert.ok(map.features.some((f) => f.id === i.featureId), `${i.code} points at a drawn feature`);
}
assert.ok(byCode.rrr.featureId, "the alignment insight links to its drawn line");

// A mirrored answer says so on the source line.
const mirrored = deriveInsights(origin, [
  { ...(outcomes[0] as Extract<LayerOutcome, { ok: true }>), mirroredOn: "2026-09-03" },
]);
assert.match(mirrored[0].source, /local copy of 2026-09-03/);

// ------------------------------------------------------------ projection

const plot: [number, number][] = [
  [origin.lng - dLng(15), origin.lat - dLat(15)],
  [origin.lng + dLng(15), origin.lat - dLat(15)],
  [origin.lng + dLng(15), origin.lat + dLat(15)],
  [origin.lng - dLng(15), origin.lat + dLat(15)],
  [origin.lng - dLng(15), origin.lat - dLat(15)],
];
const parcels = [{ ref: "ulb:1", parcelNo: "12", rings: [plot], prohibited: false }];
const size = { width: 460, height: 360 };

const plotView = buildSketch("ulb:1", parcels, size, origin, { overlays: map.features })!;
assert.ok(plotView.overlays.some((o) => o.kind === "nala"), "a drain 40 m away shows in the plot view");
assert.ok(!plotView.overlays.some((o) => o.kind === "rrr"), "an alignment 1.2 km away does not");
assert.ok(!plotView.overlays.some((o) => o.kind === "metro"), "an off-frame station gets no marker");

const areaView = buildSketch("ulb:1", parcels, size, origin, { frameHalfSpanM: 600, overlays: map.features })!;
assert.ok(areaView.overlays.some((o) => o.kind === "water"), "the tank shows at 600 m");
assert.ok(!areaView.overlays.some((o) => o.kind === "rrr"), "the alignment is still outside 600 m");
assert.equal(areaView.scale?.metres, 200, "scale bar is a round number at this zoom");

const wideView = buildSketch("ulb:1", parcels, size, origin, { frameHalfSpanM: 2_500, overlays: map.features, parcelsOnly: "subject" })!;
assert.ok(wideView.overlays.some((o) => o.kind === "rrr"), "the alignment shows at 2.5 km");
const station = wideView.overlays.find((o) => o.kind === "metro")!;
assert.ok(station && station.d === null && typeof station.x === "number", "a station is a point marker");
assert.ok(station.x! < wideView.centre.x, "the station west of the plot is drawn to its left");
assert.ok(
  Math.abs(wideView.centre.x - size.width / 2) < 1 && Math.abs(wideView.centre.y - size.height / 2) < 1,
  "the plot marker sits at the frame centre",
);
const tankShape = wideView.overlays.find((o) => o.kind === "water")!;
assert.ok(tankShape.labelX! > wideView.centre.x && tankShape.labelY! < wideView.centre.y, "the tank's label sits north-east of the plot");

// The wide view drops neighbours but keeps the subject.
const withNeighbour = buildSketch(
  "ulb:1",
  [...parcels, { ref: "ulb:2", parcelNo: "13", rings: [listed], prohibited: true }],
  size,
  origin,
  { frameHalfSpanM: 2_500, parcelsOnly: "subject" },
)!;
assert.equal(withNeighbour.shapes.length, 1);
assert.equal(withNeighbour.shapes[0].subject, true);

// Without options the sketch is exactly what it was: subject-fitted, no overlays.
const plain = buildSketch("ulb:1", parcels, size, origin)!;
assert.equal(plain.overlays.length, 0);
assert.ok(plain.scale && plain.scale.metres < areaView.scale!.metres, "the plot view is the closer zoom");
assert.ok([1, 2, 5].includes(plain.scale!.metres / 10 ** Math.floor(Math.log10(plain.scale!.metres))), "scale bar is a round number");

console.log("area-map: all checks passed");
