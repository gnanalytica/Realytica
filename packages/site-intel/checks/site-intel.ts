/**
 * Pure unit checks for the site-intelligence module: geometry, the cadastre
 * query builder, factor derivation, follow-up questions and the estimate maths.
 * No network — the ArcGIS client is deliberately not exercised here.
 * Run: pnpm exec tsx scripts/test-site-intel.ts
 */
import assert from "node:assert/strict";

import {
  bboxAround,
  distanceToPathMeters,
  distanceToRingsMeters,
  pointInRing,
  pointInRings,
  ringsCentroid,
  type Ring,
} from "../src/geometry";
import {
  CADASTRE_BY_KEY,
  buildCadastreWhere,
  compareParcelNumbers,
  decodeClassification,
  parcelExtent,
  shapeParcel,
  shapeSummary,
  sqlLiteral,
  parcelRef,
  parseParcelRef,
} from "../src/cadastre";
import { classifyProhibited, deriveFactors, sortFactors } from "../src/factors";
import { extentMismatchFactor, parcelFactors } from "../src/parcel-factors";
import { factorsFromAnswers, outstandingQuestions } from "../src/questions";
import { buildEstimate, estimateConfidence, roundToBand } from "../src/estimate";
import { lookupGuidance, resolveRate } from "../src/guidance-rates";
import { districtFamily, districtHasGuidance } from "../src/rate-coverage";
import { isWithinCoverage } from "../src/layers";
import { buildSketch } from "../src/plot-map";
import type { LayerOutcome } from "../src/arcgis";
import type { SiteFactor } from "../src/types";

// ---------------------------------------------------------------- geometry

const unitSquare: Ring = [
  [78.0, 17.0],
  [78.01, 17.0],
  [78.01, 17.01],
  [78.0, 17.01],
  [78.0, 17.0],
];

assert.equal(pointInRing({ lat: 17.005, lng: 78.005 }, unitSquare), true);
assert.equal(pointInRing({ lat: 17.02, lng: 78.005 }, unitSquare), false);
assert.equal(pointInRings({ lat: 17.005, lng: 78.005 }, [unitSquare]), true);

// A point inside reports zero distance, not the distance to the nearest edge.
assert.equal(distanceToRingsMeters({ lat: 17.005, lng: 78.005 }, [unitSquare]), 0);

// One degree of latitude is ~111 km, so 0.01 degrees north of the top edge is
// roughly 1.1 km away. Allow a wide tolerance: this checks the order of
// magnitude and the sign, not the projection.
const outside = distanceToRingsMeters({ lat: 17.02, lng: 78.005 }, [unitSquare]);
assert.ok(outside > 1_000 && outside < 1_300, `expected ~1.1 km, got ${outside}`);

const line = distanceToPathMeters({ lat: 17.0, lng: 78.0 }, [
  [78.0, 17.001],
  [78.01, 17.001],
]);
assert.ok(line > 100 && line < 125, `expected ~111 m to the path, got ${line}`);

const box = bboxAround({ lat: 17.0, lng: 78.0 }, 1_000);
assert.ok(box.xmin < 78 && box.xmax > 78 && box.ymin < 17 && box.ymax > 17);
// A metre box must be wider in longitude than in latitude at this latitude.
assert.ok(box.xmax - box.xmin > box.ymax - box.ymin);

const centroid = ringsCentroid([unitSquare]);
assert.ok(centroid);
assert.ok(Math.abs(centroid!.lat - 17.005) < 1e-6);
assert.ok(Math.abs(centroid!.lng - 78.005) < 1e-6);
assert.equal(ringsCentroid([]), null);

assert.equal(isWithinCoverage({ lat: 17.4, lng: 78.4 }), true);
assert.equal(isWithinCoverage({ lat: 12.97, lng: 77.59 }), true, "Bengaluru is covered since 2026-09-06");
assert.equal(isWithinCoverage({ lat: 19.07, lng: 72.87 }), false, "Mumbai is not");

// ---------------------------------------------------------------- cadastre

// Injection attempt is stripped, not escaped into a working predicate.
assert.equal(sqlLiteral("Kokapet"), "'Kokapet'");
assert.equal(sqlLiteral("x' OR '1'='1"), "'x OR 11'");
assert.ok(!sqlLiteral("Ghatkesar; DROP TABLE").includes(";"));

const ULB = CADASTRE_BY_KEY.ulb;
const RURAL = CADASTRE_BY_KEY.rural;

assert.equal(buildCadastreWhere(ULB, {}), "1=1");
assert.equal(
  buildCadastreWhere(ULB, { district: "Rangareddy", mandal: "Ghatkesar", village: "Boduppal" }),
  "D_Name='Rangareddy' AND M_Name='Ghatkesar' AND V_Name='Boduppal'",
);
assert.equal(
  buildCadastreWhere(ULB, { village: "Boduppal", parcelPrefix: "33" }),
  "V_Name='Boduppal' AND Parcel_num LIKE '33%'",
);
// A prefix of nothing but punctuation must not produce a bare LIKE '%'.
assert.equal(buildCadastreWhere(ULB, { village: "Boduppal", parcelPrefix: "??" }), "V_Name='Boduppal'");

// The two layers name the same concepts with different columns; the filter has
// to speak each one's language or the rural half silently returns nothing.
assert.equal(
  buildCadastreWhere(RURAL, { district: "Nalgonda", village: "Baleedupalle", parcelPrefix: "111" }),
  "District='Nalgonda' AND Village='Baleedupalle' AND Base_Syno LIKE '111%'",
);

// A parcel reference carries its layer, because object ids collide between them.
assert.equal(parcelRef("ulb", 72499), "ulb:72499");
assert.deepEqual(parseParcelRef("rural:12"), { source: "rural", id: 12 });
assert.equal(parseParcelRef("ghmc:12"), null, "an unknown layer is not addressable");
assert.equal(parseParcelRef("ulb:0"), null);
assert.equal(parseParcelRef("ulb:abc"), null);
assert.equal(parseParcelRef("72499"), null);

assert.deepEqual(decodeClassification("574171-Habited Village: Listed in Other Wards"), {
  code: "574171",
  label: "Habited Village: Listed in Other Wards",
});
assert.deepEqual(decodeClassification("Poramboke"), { code: null, label: "Poramboke" });
assert.deepEqual(decodeClassification(null), { code: null, label: null });

// Survey numbers sort as numbers, segment by segment.
const surveyNos = ["33/10", "12", "2", "33", "33/2", "120"];
assert.deepEqual(
  [...surveyNos].sort(compareParcelNumbers),
  ["2", "12", "33", "33/2", "33/10", "120"],
);

assert.equal(shapeSummary(ULB, { Parcel_num: "33/1" }), null, "a row without an id is not a parcel");
assert.equal(shapeSummary(ULB, { OBJECTID_12: 7 }), null, "a row without a survey number is not a parcel");

const summary = shapeSummary(ULB, {
  OBJECTID_12: 72499,
  Parcel_num: "12",
  V_Name: "Boduppal",
  M_Name: "Ghatkesar",
  D_Name: "Rangareddy",
  Classification_code: "574171-Habited Village: Listed in Other Wards",
  CATEGORY_OF_PROHIBITORY_LAND: null,
});
assert.ok(summary);
assert.equal(summary!.parcelNo, "12");
assert.equal(summary!.ref, "ulb:72499");
assert.equal(summary!.classification, "Habited Village: Listed in Other Wards");
assert.equal(summary!.prohibitedCategory, null);

// 0.01 degrees square at 17 N is roughly 1.11 km x 1.06 km, about 1.18 sq km.
const extent = parcelExtent([unitSquare]);
assert.ok(
  extent.sqm > 1_100_000 && extent.sqm < 1_250_000,
  `expected ~1.18 sq km, got ${extent.sqm}`,
);
assert.ok(Math.abs(extent.sqyd - extent.sqm / 0.83612736) < 1);
assert.ok(Math.abs(extent.acres - extent.sqm / 4046.8564224) < 0.01);
assert.deepEqual(parcelExtent([]), { sqm: 0, sqyd: 0, acres: 0 });

const parcel = shapeParcel(
  ULB,
  {
    OBJECTID_12: 1,
    Parcel_num: "45/2",
    V_Name: "Kokapet",
    M_Name: "Gandipet",
    D_Name: "Rangareddy",
    Classification_code: "576291-Habited Village",
    CATEGORY_OF_PROHIBITORY_LAND: null,
    EXTENT: "0.20",
  },
  [unitSquare],
);
assert.ok(parcel);
assert.equal(parcel!.parcelNo, "45/2");
assert.equal(parcel!.registerExtent, "0.20");
assert.ok(parcel!.areaSqyd > 0);
assert.equal(shapeParcel(ULB, { OBJECTID_12: 1, Parcel_num: "1" }, []), null);

// The rural layer's own columns shape into the same record.
const ruralParcel = shapeParcel(
  RURAL,
  {
    OBJECTID: 88,
    Base_Syno: "111",
    Village: "Baleedupalle",
    Mandal: "Addakal",
    District: "Mahabubnagar",
    Descriptio: "Surveyed",
  },
  [unitSquare],
);
assert.ok(ruralParcel);
assert.equal(ruralParcel!.ref, "rural:88");
assert.equal(ruralParcel!.parcelNo, "111");
assert.equal(ruralParcel!.classification, "Surveyed");
// The rural layer carries no Section 22-A join, so it must not imply a clean one.
assert.equal(ruralParcel!.prohibitedCategory, null);

// ------------------------------------------------------- prohibited register

assert.equal(classifyProhibited("Govt.Land "), "hard");
assert.equal(classifyProhibited("SURPLUS LANDS"), "hard");
assert.equal(classifyProhibited("Endowment Land"), "clearance");
assert.equal(classifyProhibited("Covered By Court Stay"), "clearance");
assert.equal(classifyProhibited("K.K"), "unknown");
assert.equal(classifyProhibited(null), "unknown");

const clean = { ...parcel!, prohibitedCategory: null, classification: "Habited Village" };
assert.deepEqual(parcelFactors(clean), []);

const banned = { ...parcel!, prohibitedCategory: "Government Land" };
const bannedFactors = parcelFactors(banned);
assert.equal(bannedFactors.length, 1);
assert.equal(bannedFactors[0].code, "parcel_prohibited_hard");
assert.equal(bannedFactors[0].severity, "critical");
assert.equal(bannedFactors[0].confidence, "observed");
assert.ok(bannedFactors[0].headline.includes("45/2"));

const endowed = { ...parcel!, prohibitedCategory: "Endowment Land" };
assert.equal(parcelFactors(endowed)[0].code, "parcel_prohibited_clearance");

const odd = { ...parcel!, prohibitedCategory: "K.K" };
assert.equal(parcelFactors(odd)[0].code, "parcel_prohibited_unknown");

const poramboke = { ...clean, classification: "Poramboke" };
assert.equal(parcelFactors(poramboke)[0].code, "parcel_classification_public");

// A sub-division smaller than the parent survey number is normal, not a flag.
assert.equal(extentMismatchFactor(clean, 200, "sqyd"), null);
assert.equal(extentMismatchFactor(clean, clean.areaSqyd, "sqyd"), null);
const over = extentMismatchFactor(clean, clean.areaSqyd * 2, "sqyd");
assert.ok(over);
assert.equal(over!.code, "parcel_extent_mismatch");
assert.equal(over!.confidence, "inferred");
assert.equal(extentMismatchFactor(clean, 0, "sqyd"), null);

// --------------------------------------------------------------- factors

function outcome(key: string, hits: Extract<LayerOutcome, { ok: true }>["hits"]): LayerOutcome {
  return { ok: true, key, hits };
}

const dry = deriveFactors({
  outcomes: [
    outcome("water_bodies", []),
    outcome("prohibited_land", []),
    outcome("flooding", []),
    outcome("nala_widening", []),
    outcome("rrr_alignment", []),
    outcome("metro_stations", []),
    outcome("industrial", []),
    outcome("hmda_zone", []),
    outcome("hmda_cadastral", []),
  ],
  kind: "open_plot",
});
assert.deepEqual(dry.factors, [], "nothing nearby means no factors, not invented ones");
assert.deepEqual(dry.gaps, []);

// A tank the subject sits inside is the most serious thing this module can find.
const inLake = deriveFactors({
  outcomes: [
    outcome("water_bodies", [
      {
        layerKey: "water_bodies",
        distanceM: 0,
        contains: true,
        attributes: { WB_Name: "Gurram Cheruvu", Area: 250_000 },
      },
    ]),
  ],
  kind: "open_plot",
});
assert.equal(inLake.factors[0].severity, "critical");
assert.equal(inLake.factors[0].direction, "drag");
assert.ok(inLake.factors[0].impactLowPct < -40);

// The prohibited-land layer is the whole cadastre: every urban plot is a row in
// it, and only the ones carrying a category are listed under Section 22-A.
// Containment alone must not raise a critical "cannot be registered" warning.
const ordinaryPlot = deriveFactors({
  outcomes: [
    outcome("prohibited_land", [
      {
        layerKey: "prohibited_land",
        distanceM: 0,
        contains: true,
        attributes: {
          Parcel_num: "12",
          V_Name: "Boduppal",
          CATEGORY_OF_PROHIBITORY_LAND: null,
        },
      },
    ]),
  ],
  kind: "open_plot",
});
assert.deepEqual(ordinaryPlot.factors, [], "an unlisted parcel is not prohibited land");

const listedPlot = deriveFactors({
  outcomes: [
    outcome("prohibited_land", [
      {
        layerKey: "prohibited_land",
        distanceM: 0,
        contains: true,
        attributes: {
          Parcel_num: "45",
          V_Name: "Boduppal",
          CATEGORY_OF_PROHIBITORY_LAND: "Assigned Land",
        },
      },
    ]),
  ],
  kind: "open_plot",
});
assert.equal(listedPlot.factors[0].code, "prohibited_hard");

// An unrecognised register entry is flagged, not silently promoted to the
// harshest reading.
const oddEntry = deriveFactors({
  outcomes: [
    outcome("prohibited_land", [
      {
        layerKey: "prohibited_land",
        distanceM: 0,
        contains: true,
        attributes: { Parcel_num: "45", CATEGORY_OF_PROHIBITORY_LAND: "K.K" },
      },
    ]),
  ],
  kind: "open_plot",
});
assert.equal(oddEntry.factors[0].code, "prohibited_unclassified");

// An unlisted neighbour is not an adjacency warning either.
const unlistedNeighbour = deriveFactors({
  outcomes: [
    outcome("prohibited_land", [
      {
        layerKey: "prohibited_land",
        distanceM: 20,
        contains: false,
        attributes: { Parcel_num: "13", CATEGORY_OF_PROHIBITORY_LAND: null },
      },
    ]),
  ],
  kind: "open_plot",
});
assert.deepEqual(unlistedNeighbour.factors, []);

// A layer that could not be read is never silently treated as "nothing there".
// This is the whole reason the report carries gaps: an unreachable water-body
// layer and a plot with no lake near it produce the same empty result, and only
// one of them is safe to act on.
//
// A failed layer becomes a visible gap, never a silent absence.
const broken = deriveFactors({
  outcomes: [{ ok: false, key: "water_bodies", reason: "timeout", detail: "aborted" }],
  kind: "open_plot",
});
assert.equal(broken.factors.length, 0);
assert.equal(broken.gaps.length, 1);
assert.ok(broken.gaps[0].reason.includes("did not respond"));

// The client's own wording never reaches the screen: "fetch failed" tells the
// person deciding whether to trust the number nothing at all.
for (const reason of ["http", "server", "parse"] as const) {
  const g = deriveFactors({
    outcomes: [{ ok: false, key: "metro_stations", reason, detail: "fetch failed" }],
    kind: "open_plot",
  }).gaps;
  assert.equal(g.length, 1);
  assert.ok(!g[0].reason.includes("fetch failed"), `${reason} leaked the raw detail`);
  assert.ok(g[0].reason.includes("not checked"));
}

// Critical outranks caution; within a severity, the bigger swing comes first.
const ordered = sortFactors([
  { ...bannedFactors[0], code: "small_caution", severity: "caution", impactLowPct: -5, impactHighPct: -2 },
  { ...bannedFactors[0], code: "big_caution", severity: "caution", impactLowPct: -30, impactHighPct: -10 },
  { ...bannedFactors[0], code: "critical", severity: "critical" },
]);
assert.deepEqual(ordered.map((f) => f.code), ["critical", "big_caution", "small_caution"]);

// --------------------------------------------------------------- questions

const noAnswers = outstandingQuestions("open_plot", {});
assert.ok(noAnswers.length > 0);
assert.ok(noAnswers.some((q) => q.key === "approval"));
// Building age is meaningless for an open plot.
assert.ok(!noAnswers.some((q) => q.key === "age_years"));
assert.ok(outstandingQuestions("independent_house", {}).some((q) => q.key === "age_years"));
// Every question explains itself.
assert.ok(noAnswers.every((q) => q.because.length > 0));

const answered = outstandingQuestions("open_plot", { approval: "hmda" });
assert.ok(!answered.some((q) => q.key === "approval"));

assert.deepEqual(factorsFromAnswers("open_plot", {}), []);

const approved = factorsFromAnswers("open_plot", { approval: "hmda" });
assert.equal(approved.length, 1);
assert.equal(approved[0].direction, "uplift");
assert.equal(approved[0].confidence, "declared");

const unapproved = factorsFromAnswers("open_plot", { approval: "unapproved" });
assert.equal(unapproved[0].direction, "drag");
assert.ok(unapproved[0].impactLowPct < -20);

const disputed = factorsFromAnswers("open_plot", { litigation: true });
assert.equal(disputed[0].severity, "critical");

// A wider road lifts, a narrower one drags.
const narrow = factorsFromAnswers("open_plot", { road_width: 15 });
const wide = factorsFromAnswers("open_plot", { road_width: 60 });
assert.equal(narrow[0].direction, "drag");
assert.equal(wide[0].direction, "uplift");
assert.ok(wide[0].impactHighPct > narrow[0].impactHighPct);

// Depreciation grows with age and is capped.
const young = factorsFromAnswers("independent_house", { age_years: 5 });
const old = factorsFromAnswers("independent_house", { age_years: 60 });
assert.ok(old[0].impactLowPct <= young[0].impactLowPct);
assert.ok(old[0].impactLowPct >= -30);

// ---------------------------------------------------------------- estimate

assert.equal(roundToBand(10_473_912), 10_000_000);
assert.equal(roundToBand(13_821_455), 14_000_000);
assert.equal(roundToBand(0), 0);
assert.equal(roundToBand(-5), 0);

const guidance = lookupGuidance({ village: "Kokapet", mandal: null, district: "Ranga Reddy" });
assert.ok(guidance.entry, "a known Hyderabad-region locality must resolve");
assert.ok(guidance.entry!.landPerSqYd > 0 && guidance.entry!.builtPerSqft > 0);

// A locality name must never carry a rate across district lines. Telangana
// village names repeat relentlessly: there is a Madhapur in Ranga Reddy and
// another in Karimnagar, 150 km away. Matching on the name alone priced the
// farming village at the HITEC City rate — off by roughly twenty times,
// delivered with full confidence, which is the one failure this product cannot
// afford.
//
// Asserted as a RELATIONSHIP, not a fixed value: once `pnpm capture:igrs` has
// reached Karimnagar, its Madhapur has a real published rate of its own, and
// the thing that must stay true is that it is nothing like the city's.
const hitec = lookupGuidance({ village: "Madhapur", mandal: "Serilingampally", district: "Ranga Reddy" });
const farmland = lookupGuidance({ village: "Madhapur", mandal: "Koratla", district: "Karimnagar" });
if (hitec.entry && farmland.entry) {
  assert.ok(
    farmland.entry.landPerSqYd < hitec.entry.landPerSqYd / 3,
    `Madhapur in Karimnagar priced at ${farmland.entry.landPerSqYd} against the city's ${hitec.entry.landPerSqYd}`,
  );
  assert.notEqual(farmland.entry.landPerSqYd, hitec.entry.landPerSqYd);
}

// The same rule for a mandal name and for anything reached by family.
const wrongMandal = lookupGuidance({ village: null, mandal: "Serilingampally", district: "Warangal" });
if (wrongMandal.entry) {
  assert.notEqual(
    wrongMandal.entry.district.toLowerCase().replace(/\s+/g, " "),
    "ranga reddy",
    "a Warangal lookup reached a Ranga Reddy mandal",
  );
}

// The 2016 split is why district names cannot be compared for equality. The
// municipal cadastre still files Ghatkesar under "Rangareddy"; the rate source
// files it under "Medchal Malkajgiri", where the mandal sits today. Requiring
// the printed names to match rejected a correct hit and silently coarsened a
// real Boduppal plot from its own mandal rate to a district average — from
// ₹3.1–3.9 Cr to ₹4.9–6.2 Cr.
assert.equal(districtFamily("Rangareddy"), districtFamily("Medchal Malkajgiri"));
assert.equal(districtFamily("Siddipet"), districtFamily("Medak"));
assert.notEqual(districtFamily("Karimnagar"), districtFamily("Ranga Reddy"));
assert.notEqual(districtFamily("Warangal"), districtFamily("Hyderabad"));

// An unknown district can never be covered, however the table grows.
assert.equal(districtHasGuidance(null), false);
assert.equal(districtHasGuidance("Atlantis"), false);

const anchor = resolveRate({ village: "Kokapet", mandal: null, district: "Ranga Reddy" }, "open_plot", null);
assert.ok(anchor);
assert.equal(anchor!.basis, "guidance_multiplied");
assert.ok(anchor!.marketMultiple > 1, "a guidance rate alone is a stamp-duty floor");

// The date beside a rate must be the RATE'S date, never today's. A captured
// rate cites the effective date the state published; a hand-entered one says
// plainly that it was not read from the portal. Printing a fresh-looking
// snapshot date over a guess claims a currency it has not got — and the guess
// for Boduppal was Rs 15,200/sq yd against a published Rs 22,100.
assert.ok(
  /with effect from \d{2}\/\d{2}\/\d{4}|Hand-entered reference figure/.test(anchor!.note),
  `the anchor note dates itself dishonestly: ${anchor!.note}`,
);
assert.ok(!anchor!.note.includes("Snapshot of"), "the old blanket snapshot date is back");

// A rate the user supplies always wins over the snapshot.
const userAnchor = resolveRate({ village: "Kokapet", mandal: null, district: "Ranga Reddy" }, "open_plot", 95_000);
assert.equal(userAnchor!.basis, "user");
assert.equal(userAnchor!.ratePerUnit, 95_000);

const flat = buildEstimate(userAnchor!, [], 200, "sqyd");
assert.ok(flat);
assert.equal(flat!.quantity, 200);
assert.equal(flat!.quantityUnit, "sqyd");

// An estimate with no factors is still a band, never a single number repeated:
// the anchor itself is uncertain, and printing "₹3.5 Cr to ₹3.5 Cr" claims a
// precision the inputs cannot support.
assert.ok(flat!.adjustedRateLow < 95_000, "no spread below the anchor");
assert.ok(flat!.adjustedRateHigh > 95_000, "no spread above the anchor");
assert.ok(flat!.valueHigh > flat!.valueLow, "the band collapsed to one number");

// A rate the user supplied is better information than a statutory one, so its
// band is tighter — but not zero.
const guidanceFlat = buildEstimate(anchor!, [], 200, "sqyd")!;
const relSpread = (e: { adjustedRateLow: number; adjustedRateHigh: number }) =>
  (e.adjustedRateHigh - e.adjustedRateLow) / (e.adjustedRateHigh + e.adjustedRateLow);
assert.ok(
  relSpread(flat!) < relSpread(guidanceFlat),
  "a user-supplied rate should narrow the band, not widen it",
);

// Bands never invert, and the value follows the direction of the factors.
const dragged = buildEstimate(userAnchor!, [bannedFactors[0]], 200, "sqyd")!;
assert.ok(dragged.valueHigh >= dragged.valueLow);
assert.ok(dragged.valueHigh < flat!.valueLow);

const lifted = buildEstimate(userAnchor!, [approved[0]], 200, "sqyd")!;
assert.ok(lifted.valueHigh > flat!.valueHigh);

// Drags floor out rather than compounding to nothing.
const catastrophe: SiteFactor[] = Array.from({ length: 8 }, (_, i) => ({
  ...bannedFactors[0],
  code: `drag_${i}`,
}));
const floored = buildEstimate(userAnchor!, catastrophe, 200, "sqyd")!;
assert.ok(floored.valueLow > 0, "a floored estimate is still a number, not zero");
assert.ok(floored.adjustedRateLow >= 95_000 * 0.95 * 0.2 - 1);

// Uplifts cap rather than multiplying without limit.
const euphoria: SiteFactor[] = Array.from({ length: 8 }, (_, i) => ({
  ...approved[0],
  code: `lift_${i}`,
}));
const capped = buildEstimate(userAnchor!, euphoria, 200, "sqyd")!;
assert.ok(capped.adjustedRateHigh <= 95_000 * 1.05 * 1.6 + 1);

// Nothing to price is null, not zero.
assert.equal(buildEstimate(userAnchor!, [], 0, "sqyd"), null);
assert.equal(buildEstimate({ ...userAnchor!, ratePerUnit: 0 }, [], 200, "sqyd"), null);

// An unreachable layer outranks everything else in deciding confidence.
assert.equal(
  estimateConfidence({ anchorBasis: "user", gapCount: 1, unansweredRequired: 0 }).level,
  "low",
);
assert.equal(
  estimateConfidence({ anchorBasis: "user", gapCount: 0, unansweredRequired: 2 }).level,
  "low",
);
assert.equal(
  estimateConfidence({ anchorBasis: "user", gapCount: 0, unansweredRequired: 0 }).level,
  "moderate",
);
assert.equal(
  estimateConfidence({ anchorBasis: "guidance_multiplied", gapCount: 0, unansweredRequired: 0 }).level,
  "indicative",
);

// --------------------------------------------------------------- plot sketch

const centre = { lat: 17.005, lng: 78.005 };
const neighbour: Ring = [
  [78.01, 17.0],
  [78.02, 17.0],
  [78.02, 17.01],
  [78.01, 17.01],
  [78.01, 17.0],
];

assert.equal(
  buildSketch("ulb:1", [], { width: 400, height: 300 }, centre),
  null,
  "nothing to draw is null, not an empty canvas",
);
assert.equal(
  buildSketch(
    "ulb:1",
    [{ ref: "ulb:1", parcelNo: "1", rings: [[[78, 17]]], prohibited: false }],
    { width: 400, height: 300 },
    centre,
  ),
  null,
  "a ring with fewer than three points is not a polygon",
);

const sketch = buildSketch(
  "ulb:1",
  [
    { ref: "ulb:1", parcelNo: "12", rings: [unitSquare], prohibited: false },
    { ref: "ulb:2", parcelNo: "13", rings: [neighbour], prohibited: true },
  ],
  { width: 400, height: 300 },
  centre,
);
assert.ok(sketch);
assert.equal(sketch!.shapes.length, 2);

const subjectShape = sketch!.shapes.find((s) => s.ref === "ulb:1")!;
assert.equal(subjectShape.subject, true);
assert.equal(subjectShape.parcelNo, "12");
assert.ok(subjectShape.d.startsWith("M") && subjectShape.d.endsWith("Z"));
assert.equal(sketch!.shapes.find((s) => s.ref === "ulb:2")!.prohibited, true);

// The subject is drawn last so a neighbour's edge never overdraws its outline.
assert.equal(sketch!.shapes[sketch!.shapes.length - 1].subject, true);

// The subject is centred in the frame.
assert.ok(Math.abs(subjectShape.labelX - 200) < 2, `labelX ${subjectShape.labelX}`);
assert.ok(Math.abs(subjectShape.labelY - 150) < 2, `labelY ${subjectShape.labelY}`);

// Longitude is compressed at this latitude, so a square in degrees is wider
// than tall on the ground — the sketch must show that, not a perfect square.
const xs = subjectShape.d.match(/[ML]([\d.]+),/g)!.map((m) => Number(m.slice(1, -1)));
const ys = subjectShape.d.match(/,([\d.]+)/g)!.map((m) => Number(m.slice(1)));
const drawnWidth = Math.max(...xs) - Math.min(...xs);
const drawnHeight = Math.max(...ys) - Math.min(...ys);
assert.ok(drawnWidth < drawnHeight, "longitude must be scaled by cos(lat), not plotted raw");
assert.ok(drawnWidth / drawnHeight > 0.9, "and the correction is small at 17 N");

// The scale bar rounds to a readable step.
assert.ok(sketch!.scale);
assert.ok([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].includes(sketch!.scale!.metres));
assert.ok(sketch!.scale!.pixels > 0 && sketch!.scale!.pixels < 400);

console.log("site-intel: ok");
