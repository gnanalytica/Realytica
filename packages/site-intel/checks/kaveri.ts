/**
 * Pure checks for the Kaveri guidance values: name matching, the choice of a
 * village's typical rate, the road override, unit conversion, and how the
 * anchor is built for a Bengaluru plot. No network.
 * Run: pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/test-kaveri.ts
 */
import assert from "node:assert/strict";

import { resolveRate } from "../src/guidance-rates";
import {
  KAVERI_CAPTURED_ON,
  kaveriFlatRateFor,
  kaveriRateFor,
  kaveriRoads,
  kaveriVillageCount,
  kaveriVillagesFor,
  looseName,
  normName,
  type KaveriVillage,
} from "../src/karnataka/rates";

// ------------------------------------------------------------------ names

assert.equal(normName("White Field"), "whitefield");
assert.equal(normName("WHITE-FIELD"), "whitefield");
assert.equal(normName("Hosahalli (Chanarayanapatana Hobli)"), "hosahalli", "a bracketed hobli is not part of the name");
assert.equal(normName("B.T.M. Layout"), "btmlayout");
assert.equal(normName(null), "");

assert.equal(looseName("Katthinagenahalli"), looseName("Kattinagenahalli"));
assert.equal(looseName("Hebburu"), looseName("Hebbur"));
assert.equal(looseName("Mavatthura"), looseName("Mavathuru"));
assert.equal(looseName("Thigalarahalli"), looseName("Tigalarahalli"));
assert.notEqual(looseName("Hosahalli"), looseName("Hosakote"), "different villages stay different");

// --------------------------------------------------------------- capture

assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(KAVERI_CAPTURED_ON), "the capture carries its date");
assert.ok(kaveriVillageCount() > 200, `capture holds ${kaveriVillageCount()} villages`);

// Koramangala is a K-GIS village in Bengaluru Urban (code 20…) and a Kaveri
// village under the Jayanagar registration district. The join is by name
// inside the Bhoomi district.
const kora = kaveriVillagesFor("2004030001", "Koramangala");
assert.ok(kora.length >= 1, "Koramangala matches by name inside district 20");
assert.ok(kora.every((v) => v.bhoomiDistrict === "20"));
// Ramanagara (29) has its own Koramangala village, which is exactly why the
// join is inside the district; a district outside the capture has none.
assert.ok(kaveriVillagesFor("2904030001", "Koramangala").every((v) => v.bhoomiDistrict === "29"));
assert.equal(kaveriVillagesFor("3104030001", "Koramangala").length, 0, "no match outside the captured districts");
assert.equal(kaveriVillagesFor("2004030001", "No Such Place").length, 0);
// Spelling variants join when unambiguous: the revenue map's "Hebburu" is
// Kaveri's "Hebbur" in Tumakuru (Bhoomi district 18).
const hebbur = kaveriVillagesFor("1804010001", "Hebburu");
assert.ok(hebbur.length >= 1, "a loose spelling joins when it is the only candidate");
assert.equal(normName(hebbur[0].name), "hebbur");
// A taluk headquarters: the revenue map says "Anekal" in Kasaba hobli, Kaveri
// says "Anekal Kasaba". The hobli is tried, then the usual suffixes.
const anekal = kaveriVillagesFor("2003010043", "Anekal", "Kasaba");
assert.ok(anekal.length >= 1 && normName(anekal[0].name) === "anekalkasaba", "Anekal joins via its hobli");
assert.ok(kaveriVillagesFor("2003010043", "Anekal").length >= 1, "and via the Kasaba suffix without one");
assert.equal(kaveriVillagesFor("2003010043", "Anekal", "Nowhere")[0]?.name, "Anekal Kasaba", "a wrong hobli still falls through to the suffix");

// ------------------------------------------------------------- fixtures

const village = (roads: KaveriVillage["roads"], urban = false): KaveriVillage => ({
  code: 1,
  name: "Testahalli",
  hobli: "Kasaba",
  taluk: "Anekal",
  district: "Basavanagudi",
  bhoomiDistrict: "20",
  urban,
  roads,
});

const v = village([
  { code: 1, name: "Main Road", res: 100_000 },
  { code: 2, name: "1st Cross", res: 60_000 },
  { code: 3, name: "Others Main Roads Testahalli", res: 40_000 },
  { code: 4, name: "Other Cross Road Testahalli", res: 30_000 },
  { code: 5, name: "Testahalli (Flat/Apartment)", res: 0 },
  { code: 6, name: "Testahalli farmland", agri: [["Dry, No Source of Irrigation", 2_420_000], ["Wet", 4_840_000], ["NA Dry land (Undeveloped) - Residential Use", 48_400_000]] },
  { code: 7, name: "Typo Road", res: 148_100_000 },
]);

// The village's typical value is the median of its "other roads", not of
// every named road — the named ones are the expensive ones.
const typical = kaveriRateFor([v])!;
assert.equal(typical.basis, "village_other_roads");
assert.equal(typical.landPerSqM, 35_000);
assert.ok(Math.abs(typical.landPerSqYd - 35_000 * 0.83612736) < 1e-6, "per sq m becomes per sq yd");
assert.equal(typical.roadCount, 4, "only roads with a plausible value count — the ₹14.8 crore/sq m typo is not one");
assert.equal(typical.locality, "Testahalli");
assert.equal(typical.marketMultiple, 1.4, "Bengaluru Urban is the urban multiple");

// A named road wins.
const road = kaveriRateFor([v], "Main Road")!;
assert.equal(road.basis, "road");
assert.equal(road.landPerSqM, 100_000);
assert.equal(road.locality, "Main Road, Testahalli");
// An unknown road falls back rather than failing.
assert.equal(kaveriRateFor([v], "Nowhere Road")!.basis, "village_other_roads");

// Agricultural: median per acre of the farming classes, converted to sq yd.
// "NA dry land" is converted land and does not count.
assert.ok(Math.abs(typical.agriPerSqYd! - 3_630_000 / 4840) < 1e-6);
assert.equal(kaveriRateFor([v], "Typo Road")!.basis, "village_other_roads", "a typo road cannot be chosen");
assert.ok(!kaveriRoads([v]).some((r) => r.name === "Typo Road"), "nor offered");

// Without "other roads" the median of all priced roads is used.
const noOthers = village([
  { code: 1, name: "A", res: 10 },
  { code: 2, name: "B", res: 30 },
  { code: 3, name: "C", res: 20 },
]);
const med = kaveriRateFor([noOthers])!;
assert.equal(med.basis, "village_median");
assert.equal(med.landPerSqM, 20);
assert.equal(med.agriPerSqYd, null);

// A rural village uses the rural multiple.
const rural = { ...noOthers, bhoomiDistrict: "21" };
assert.equal(kaveriRateFor([rural])!.marketMultiple, 1.3);

assert.equal(kaveriRateFor([]), null);
assert.equal(kaveriRateFor([village([{ code: 1, name: "X", res: 0 }])]), null, "a village with no priced road is unpriced");

// The road list for the question: priced roads only, deduplicated, sorted.
const roads = kaveriRoads([v, v]);
assert.deepEqual(
  roads.map((r) => r.name),
  ["1st Cross", "Main Road", "Other Cross Road Testahalli", "Others Main Roads Testahalli"],
);

// ---------------------------------------------------------------- anchor

const place = { village: "Koramangala", mandal: "Bangalore-East", district: "Bengaluru (Urban)", state: "KA" as const, villageCode: "2004030001" };
const anchor = resolveRate(place, "open_plot", null)!;
assert.equal(anchor.basis, "guidance_multiplied");
assert.match(anchor.note, /Kaveri/);
assert.match(anchor.note, /as published, read on \d{4}-\d{2}-\d{2}/);
assert.match(anchor.note, /assumption/, "the market multiple is called what it is");
assert.equal(anchor.unit, "sqyd");
assert.ok(anchor.ratePerUnit > 10_000, `Koramangala anchors at ₹${anchor.ratePerUnit}/sq yd`);

// A typed rate still wins; a flat still needs one.
assert.equal(resolveRate(place, "open_plot", 50_000)!.basis, "user");
// A flat anchors per sq ft: on a named complex, else the village's
// complexes, else the land rate standing in for built-up area.
const flat = resolveRate(place, "apartment", null)!;
assert.equal(flat.unit, "sqft");
assert.ok(flat.ratePerUnit > 1_000 && flat.ratePerUnit < 100_000, `Koramangala flat at ₹${flat.ratePerUnit}/sq ft`);
assert.match(flat.note, /Kaveri flat value|apartment complexes|stands in for built-up/);
const flatFixture = kaveriFlatRateFor([v])!;
assert.equal(flatFixture.basis, "land_rate", "no complexes in the fixture village: land rate stands in");
assert.ok(Math.abs(flatFixture.builtPerSqft - 35_000 / 10.7639) < 1e-6);
assert.equal(resolveRate({ ...place, villageCode: null }, "open_plot", null), null, "no village code, no join");
assert.equal(resolveRate({ ...place, village: "No Such Place" }, "open_plot", null), null);

// The road answer reaches the anchor.
const firstRoad = kaveriRoads(kora)[0].name;
const withRoad = resolveRate(place, "open_plot", null, firstRoad)!;
assert.match(withRoad.note, new RegExp(`Kaveri guidance value for ${firstRoad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

console.log("kaveri: all checks passed");
