/**
 * Pure checks for the Karnataka side: the UTM conversion and WKT parsing the
 * parcel service depends on, the village index, refs, the state guard on
 * rates, the state-specific questions, and the Bengaluru factor and insight
 * rules. No network.
 * Run: pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/test-karnataka.ts
 */
import assert from "node:assert/strict";

import type { LayerOutcome } from "../src/arcgis";
import { buildAreaMap, deriveInsights } from "../src/area-map";
import { PARCEL_REF_PATTERN, parseParcelRef } from "../src/cadastre";
import { lookupGuidance } from "../src/guidance-rates";
import { deriveKaFactors } from "../src/karnataka/factors";
import { cleanSurveyNo } from "../src/karnataka/kgis";
import { KA_LAYERS, classifyZone } from "../src/karnataka/layers";
import { utmToLatLng, wktToRings } from "../src/karnataka/utm";
import {
  kaDistricts,
  kaTaluks,
  kaVillageByCode,
  kaVillageByLabel,
  kaVillageCount,
  kaVillageLabels,
} from "../src/karnataka/village-index";
import { LAYER_BY_KEY, isWithinCoverage, layersFor } from "../src/layers";
import { factorsFromAnswers, outstandingQuestions, questionsFor } from "../src/questions";
import { stateAt } from "../src/states";

// ---------------------------------------------------------------- projection

// White Field survey no 1's first vertex as K-GIS returned it, and where it
// is: Whitefield, Bengaluru. Checked against the live service on 2026-09-06.
const wf = utmToLatLng(798369.9848, 1435735.1186);
assert.ok(Math.abs(wf.lat - 12.97279) < 2e-5, `lat ${wf.lat}`);
assert.ok(Math.abs(wf.lng - 77.75018) < 2e-5, `lng ${wf.lng}`);

// Equator on the central meridian round-trips to the origin.
const origin = utmToLatLng(500_000, 0);
assert.ok(Math.abs(origin.lat) < 1e-9 && Math.abs(origin.lng - 75) < 1e-9);

const rings = wktToRings(
  "POLYGON ((798369.98 1435735.12, 798389.98 1435884.98, 798419.38 1435870.0, 798369.98 1435735.12))",
);
assert.equal(rings.length, 1);
assert.equal(rings[0].length, 4);
assert.ok(rings[0][0][0] > 77 && rings[0][0][0] < 78, "rings are [lng, lat]");

const multi = wktToRings("MULTIPOLYGON (((1 2, 3 4, 5 6, 1 2)), ((7 8, 9 10, 11 12, 7 8)))");
assert.equal(multi.length, 2, "each polygon of a multipolygon is a ring");
assert.deepEqual(wktToRings("POLYGON EMPTY"), []);

// --------------------------------------------------------------- survey nos

assert.equal(cleanSurveyNo(" 12 "), "12");
assert.equal(cleanSurveyNo("12/1"), "12/1");
assert.equal(cleanSurveyNo("12/1a"), "12/1A");
assert.equal(cleanSurveyNo("12; DROP"), null);
assert.equal(cleanSurveyNo(""), null);

// ------------------------------------------------------------ village index

assert.ok(kaVillageCount() > 4_000, `index holds ${kaVillageCount()} villages`);
assert.ok(kaDistricts().includes("Bengaluru (Urban)"));
assert.ok(kaTaluks("Bengaluru (Urban)").includes("Bangalore-East"));
const labels = kaVillageLabels("Bengaluru (Urban)", "Bangalore-East");
assert.ok(labels.includes("White Field (K R Pura-3)"), "village labels carry the hobli");
assert.equal(new Set(labels).size, labels.length, "labels within a taluk are unique");
const wfVillage = kaVillageByLabel("Bengaluru (Urban)", "Bangalore-East", "White Field (K R Pura-3)")!;
assert.equal(wfVillage.code, "2004030029");
assert.deepEqual(wfVillage.ids, ["21434"]);
const anekal = kaVillageByCode("2003010043")!;
assert.equal(anekal.ids.length, 2, "a village with two K-GIS ids keeps both");
assert.equal(kaVillageByLabel("Bengaluru (Urban)", "Anekal", "Nowhere (Kasaba)"), null);

// --------------------------------------------------------------------- refs

assert.deepEqual(parseParcelRef("kgis:2004030029:12/1"), {
  source: "kgis",
  code: "2004030029",
  surveyNo: "12/1",
});
assert.deepEqual(parseParcelRef("ulb:72115"), { source: "ulb", id: 72115 });
assert.equal(parseParcelRef("kgis:2004030029:12;1"), null, "an injected character is rejected");
assert.equal(parseParcelRef("kgis:20040300:12"), null, "a short village code is rejected");
assert.ok(PARCEL_REF_PATTERN.test("kgis:2004030029:1"));
assert.ok(!PARCEL_REF_PATTERN.test("kgis:2004030029:"));

// ------------------------------------------------------------------ coverage

assert.equal(stateAt({ lat: 12.9698, lng: 77.75 }), "KA");
assert.equal(stateAt({ lat: 17.4, lng: 78.5 }), "TS");
assert.equal(stateAt({ lat: 19.07, lng: 72.87 }), null, "Mumbai is neither");
assert.ok(isWithinCoverage({ lat: 12.9698, lng: 77.75 }));
assert.equal(layersFor("KA"), KA_LAYERS);
assert.ok(LAYER_BY_KEY.ka_water && LAYER_BY_KEY.water_bodies, "both states' layers are addressable");
assert.ok(KA_LAYERS.every((l) => l.root?.startsWith("https://kgis.ksrsac.in")), "Karnataka layers point at K-GIS");

// ------------------------------------------------------------ rate guard

// A Bengaluru village must never borrow a same-named Telangana village's rate.
const guarded = lookupGuidance({ village: "Madhapur", mandal: "Anekal", district: "Bengaluru (Urban)", state: "KA" });
assert.equal(guarded.matchedOn, "none");
const unguarded = lookupGuidance({ village: "Madhapur", mandal: "Serilingampally", district: "Rangareddy", state: "TS" });
assert.notEqual(unguarded.matchedOn, "none", "the Telangana lookup still works");

// ------------------------------------------------------------ questions

const kaApproval = questionsFor("KA").find((q) => q.key === "approval")!;
const kaValues = kaApproval.options!.map((o) => o.value);
assert.ok(kaValues.includes("bda") && kaValues.includes("bmrda") && !kaValues.includes("hmda"));
assert.ok(kaValues.includes("panchayat") && kaValues.includes("unknown"), "the generic answers stay");
const tsApproval = questionsFor("TS").find((q) => q.key === "approval")!;
assert.ok(tsApproval.options!.some((o) => o.value === "hmda"));

assert.ok(outstandingQuestions("open_plot", {}, "KA").some((q) => q.key === "approval"));
assert.ok(
  questionsFor("KA").every((q) => !/Hyderabad/.test(q.because)),
  "no question talks about Hyderabad on a Bengaluru plot",
);
assert.ok(questionsFor("KA").some((q) => /Bengaluru/.test(q.because)), "the city is swapped, not dropped");
const cornerKa = factorsFromAnswers("open_plot", { corner: true, possession: false }, "KA");
assert.ok(cornerKa.every((f) => !/Hyderabad/.test(f.detail)), "declared factors name Bengaluru too");
const bdaFactor = factorsFromAnswers("open_plot", { approval: "bda" }, "KA");
assert.equal(bdaFactor[0].label, "BDA-approved layout");
assert.equal(bdaFactor[0].direction, "uplift");
const panchayatKa = factorsFromAnswers("open_plot", { approval: "panchayat" }, "KA");
assert.match(panchayatKa[0].detail, /BDA or BMRDA planning area/);
assert.ok(!/HMDA/.test(panchayatKa[0].detail), "no Telangana authority named for a Bengaluru plot");

// --------------------------------------------------------------- zoning

assert.equal(classifyZone("Residential"), "residential");
assert.equal(classifyZone("Industrial Land"), "industrial");
assert.equal(classifyZone("Parks and Open space"), "open_space");
assert.equal(classifyZone("Public & Semi-Public"), "public");
assert.equal(classifyZone("Ring road"), "transport");
assert.equal(classifyZone("Existing road"), "transport");
assert.equal(classifyZone("WaterBodies"), "water");
assert.equal(classifyZone("Hillocks and Quarrys"), "other");
assert.equal(classifyZone(null), "other");

// ---------------------------------------------------------------- factors

const pt = { lat: 12.72, lng: 77.7 };
const square = (cx: number, cy: number, half = 0.001): [number, number][] => [
  [cx - half, cy - half],
  [cx + half, cy - half],
  [cx + half, cy + half],
  [cx - half, cy + half],
  [cx - half, cy - half],
];

const zoneHit = (proposed: string, contains: boolean, distanceM: number) => ({
  layerKey: "ka_masterplan",
  distanceM,
  contains,
  attributes: { Town_Name: "Anekal", Landuse: proposed, Existing_L: null, Proposed_L: proposed },
  geometry: { rings: [square(pt.lng, pt.lat)] },
});

function outcomesWith(...extra: LayerOutcome[]): LayerOutcome[] {
  const base: LayerOutcome[] = [
    { ok: true, key: "ka_water", hits: [] },
    { ok: true, key: "ka_drain", hits: [] },
    { ok: true, key: "ka_lulc", hits: [] },
  ];
  return [...base.filter((b) => !extra.some((e) => e.key === b.key)), ...extra];
}

// Residential zoning: a permitted use, told as such, not as a risk.
const res = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit("Residential", true, 0)] }), "open_plot");
assert.equal(res.factors[0].code, "zone_residential");
assert.equal(res.outsidePublishedMasterPlan, false);
assert.ok(!res.gaps.some((g) => g.layer.includes("BDA")));

// Industrial zoning is critical for a house, mild for farmland.
const indHouse = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit("Industrial Land", true, 0)] }), "independent_house");
assert.equal(indHouse.factors[0].code, "zone_industrial");
assert.equal(indHouse.factors[0].severity, "critical");
const indFarm = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit("Industrial Land", true, 0)] }), "agricultural_land");
assert.equal(indFarm.factors[0].severity, "caution");

// Agricultural zoning bites a plot but not farmland.
const agPlot = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit("Agriculture", true, 0)] }), "open_plot");
assert.equal(agPlot.factors[0].code, "zone_agricultural");
const agFarm = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit("Agriculture", true, 0)] }), "agricultural_land");
assert.equal(agFarm.factors.length, 0);

// Reserved and road reservations are critical whatever the use.
for (const p of ["Parks and Open space", "Public & Semi-Public", "Ring road", "WaterBodies"]) {
  const r = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [zoneHit(p, true, 0)] }), "open_plot");
  assert.equal(r.factors[0].severity, "critical", p);
}

// Industrial in the 400 m box, own zone residential: an adjacency caution, not a zone error.
const nearHit = (proposed: string) => ({
  layerKey: "ka_masterplan_near",
  distanceM: 400,
  contains: false,
  attributes: { Town_Name: "Anekal", Landuse: proposed, Existing_L: null, Proposed_L: proposed },
});
const adj = deriveKaFactors(
  outcomesWith(
    { ok: true, key: "ka_masterplan", hits: [zoneHit("Residential", true, 0)] },
    { ok: true, key: "ka_masterplan_near", hits: [nearHit("Residential"), nearHit("Industrial Land")] },
  ),
  "open_plot",
);
assert.deepEqual(adj.factors.map((f) => f.code).sort(), ["industrial_adjacent", "zone_residential"]);
assert.match(adj.factors.find((f) => f.code === "industrial_adjacent")!.headline, /about 400 m/);
// Industrial in the box when the plot itself is industrial: one factor, not two.
const indBoth = deriveKaFactors(
  outcomesWith(
    { ok: true, key: "ka_masterplan", hits: [zoneHit("Industrial Land", true, 0)] },
    { ok: true, key: "ka_masterplan_near", hits: [nearHit("Industrial Land")] },
  ),
  "open_plot",
);
assert.deepEqual(indBoth.factors.map((f) => f.code), ["zone_industrial"]);

// The master-plan layer answered with nothing here: BDA's area, reported as a gap.
const bda = deriveKaFactors(outcomesWith({ ok: true, key: "ka_masterplan", hits: [] }), "open_plot");
assert.equal(bda.outsidePublishedMasterPlan, true);
assert.ok(bda.gaps.some((g) => g.layer.includes("BDA")), "unpublished zoning is a named gap");

// The master-plan layer FAILED: that is an outage gap, not a BDA gap.
const down = deriveKaFactors(outcomesWith({ ok: false, key: "ka_masterplan", reason: "timeout", detail: "" }), "open_plot");
assert.equal(down.outsidePublishedMasterPlan, false);
assert.ok(down.gaps.some((g) => g.layer.includes("Master-plan land use")));
assert.ok(!down.gaps.some((g) => g.layer.includes("BDA")));

// Water: 30 m buffer, Karnataka wording, no Telangana law cited.
const waterHit = (distanceM: number, contains = false) => ({
  layerKey: "ka_water",
  distanceM,
  contains,
  attributes: { Name: "Varthur Kere", LULC_Desc_2: "Tank", LULC_Desc_3: "Tank" },
  geometry: { rings: [square(pt.lng + 0.01, pt.lat)] },
});
const inBuffer = deriveKaFactors(outcomesWith({ ok: true, key: "ka_water", hits: [waterHit(20)] }), "open_plot");
assert.equal(inBuffer.factors[0].code, "water_body_buffer");
assert.match(inBuffer.factors[0].detail, /RMP 2015/);
assert.ok(!/GO Ms|HYDRAA/.test(inBuffer.factors[0].detail), "no Telangana rule cited in Bengaluru");
const outside = deriveKaFactors(outcomesWith({ ok: true, key: "ka_water", hits: [waterHit(31)] }), "open_plot");
assert.equal(outside.factors[0].code, "water_body_near", "31 m is outside the 30 m buffer");
const bed = deriveKaFactors(outcomesWith({ ok: true, key: "ka_water", hits: [waterHit(0, true)] }), "open_plot");
assert.equal(bed.factors[0].code, "water_body_bed");

// Drain: tertiary buffer applied, wider one warned.
const drainHit = (distanceM: number) => ({
  layerKey: "ka_drain",
  distanceM,
  contains: false,
  attributes: { Name: null, LULC_Desc_2: "Stream", LULC_Desc_3: "Storm Water Drain" },
  geometry: { rings: [square(pt.lng, pt.lat + 0.01)] },
});
const drainIn = deriveKaFactors(outcomesWith({ ok: true, key: "ka_drain", hits: [drainHit(10)] }), "open_plot");
assert.equal(drainIn.factors[0].code, "drain_buffer");
assert.match(drainIn.factors[0].detail, /50 \/ 25 \/ 15 m/);
const drainNear = deriveKaFactors(outcomesWith({ ok: true, key: "ka_drain", hits: [drainHit(40)] }), "open_plot");
assert.equal(drainNear.factors[0].code, "drain_near");

// --------------------------------------------------------------- insights

const full = outcomesWith(
  { ok: true, key: "ka_masterplan", hits: [zoneHit("Residential", true, 0)] },
  { ok: true, key: "ka_masterplan_near", hits: [nearHit("Residential"), nearHit("Industrial Land"), nearHit("Parks and Open space"), nearHit("Road")] },
  { ok: true, key: "ka_water", hits: [waterHit(400)] },
  { ok: true, key: "ka_drain", hits: [drainHit(40)] },
  { ok: true, key: "ka_lulc", hits: [{ layerKey: "ka_lulc", distanceM: 0, contains: true, attributes: { LULC_Desc_1: "Built-up", LULC_Desc_2: "Built-up (Rural)", LULC_Desc_3: "Built-up (Rural)", Name: null } }] },
);
const map = buildAreaMap(pt, full, "KA");
const kinds = map.features.map((f) => f.kind).sort();
assert.deepEqual(kinds, ["nala", "water"], "the master plan is told, not drawn — its polygons are megabytes each");
assert.ok(!map.features.some((f) => f.layerKey === "ka_lulc"), "the current-use polygon is told, not drawn");
assert.deepEqual(map.unreadLayers, []);
assert.ok(!map.emptyLayers.includes("ka_masterplan"), "an attribute-only layer is not called empty");

const insights = deriveInsights(pt, full, map, "KA");
const codes = insights.map((i) => i.code);
assert.ok(codes.includes("ka_zone") && codes.includes("ka_industrial_near") && codes.includes("ka_lulc"));
const mix = insights.find((i) => i.code === "ka_zone_mix")!;
assert.match(mix.title, /Industrial Land, Parks and Open space/);
assert.ok(!/Road|Residential/.test(mix.title), "the plot's own zone and road polygons are not listed as the mix");
assert.ok(codes.some((c) => c.startsWith("ka_water:")) && codes.some((c) => c.startsWith("ka_drain:")));
assert.ok(!codes.includes("hmda_zone") && !codes.some((c) => c.startsWith("metro")), "no Telangana insights for a Bengaluru plot");
const zoneInsight = insights.find((i) => i.code === "ka_zone")!;
assert.match(zoneInsight.title, /Residential \(Anekal planning area\)/);
const lulc = insights.find((i) => i.code === "ka_lulc")!;
assert.equal(lulc.title, "On the ground in 2023: Built-up · Built-up (Rural)", "repeated class names are collapsed");
// The same lake in two polygons is one card.
const twoPolys = deriveInsights(pt, outcomesWith({ ok: true, key: "ka_water", hits: [waterHit(679), waterHit(683)] }), undefined, "KA");
assert.equal(twoPolys.filter((i) => i.code.startsWith("ka_water:")).length, 1, "one card per named lake");
const squashed = deriveInsights(pt, outcomesWith({ ok: true, key: "ka_lulc", hits: [{ layerKey: "ka_lulc", distanceM: 0, contains: true, attributes: { LULC_Desc_1: "Built-up", LULC_Desc_2: "Built-up (Urban)", LULC_Desc_3: "Built-up Urban", Name: null } }] }), undefined, "KA");
assert.equal(squashed.find((i) => i.code === "ka_lulc")!.title, "On the ground in 2023: Built-up · Built-up (Urban)");
const water = insights.find((i) => i.code.startsWith("ka_water:"))!;
assert.equal(water.direction, "east");
assert.match(water.meaning, /400 m to the east/);

// Inside BDA: the unpublished-zoning insight replaces a zone.
const core = deriveInsights(pt, outcomesWith({ ok: true, key: "ka_masterplan", hits: [] }), undefined, "KA");
assert.ok(core.some((i) => i.code === "ka_zone_unpublished"));
assert.match(core.find((i) => i.code === "ka_zone_unpublished")!.meaning, /RMP 2041/);
// ...but not when the layer simply failed.
const failed = deriveInsights(pt, outcomesWith({ ok: false, key: "ka_masterplan", reason: "http", detail: "" }), undefined, "KA");
assert.ok(!failed.some((i) => i.code === "ka_zone_unpublished"), "an outage is not BDA's area");

console.log("karnataka: all checks passed");
