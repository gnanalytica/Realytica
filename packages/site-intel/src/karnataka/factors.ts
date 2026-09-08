// Turning Karnataka layer hits into factors — the Bengaluru counterpart of
// `factors.ts`, kept separate because the rules are different law.
//
// The buffers here are the RMP 2015 zoning regulations as they stand after
// the Supreme Court's 2019 order set aside the NGT's wider ones: 30 m from a
// lake boundary, and 50 / 25 / 15 m from a primary / secondary / tertiary
// storm-water drain (rajakaluve). The land-use layer does not say which order
// a drain is, so the drain buffer is applied at the tertiary width and the
// message says the real one may be wider.
//
// Pure: no network, no clock.

import type { LayerOutcome } from "../arcgis";
import { factor, gapReason } from "../factors";
import { LAYER_BY_KEY } from "../layers";
import { classifyZone } from "./layers";
import type { SiteFactor, SubjectKind } from "../types";

const LAKE_BUFFER_M = 30;
const DRAIN_BUFFER_MIN_M = 15;
const DRAIN_BUFFER_MAX_M = 50;

const NEAR = {
  waterCaution: 150,
  waterAmenity: 900,
  drainNear: 60,
  industrialAdjacent: 400,
} as const;

function pct(low: number, high: number) {
  return { impactLowPct: low, impactHighPct: high };
}

function hitsFor(outcomes: LayerOutcome[], key: string) {
  const outcome = outcomes.find((o) => o.key === key);
  return outcome?.ok ? outcome.hits : [];
}

function wasRead(outcomes: LayerOutcome[], key: string): boolean {
  const outcome = outcomes.find((o) => o.key === key);
  return !!outcome && outcome.ok;
}

function str(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

function metres(d: number): string {
  return d < 1_000 ? `${Math.round(d)} m` : `${(d / 1_000).toFixed(1)} km`;
}

function sourceFor(key: string): string {
  return LAYER_BY_KEY[key]?.source ?? "Karnataka GIS";
}

function waterFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "ka_water");
  if (!hits.length) return [];
  const nearest = hits[0];
  const kind = (str(nearest.attributes.LULC_Desc_2) ?? "water body").toLowerCase();
  const name = str(nearest.attributes.Name) ?? `an unnamed ${kind}`;
  const evidence = {
    source: sourceFor("ka_water"),
    layer: LAYER_BY_KEY.ka_water?.path,
    distanceM: nearest.distanceM,
    attributes: { water_body: name, kind },
  };

  if (nearest.contains) {
    return [
      factor(
        "water_body_bed",
        "Inside a mapped water body",
        "critical",
        "drag",
        "observed",
        `The 2023 land-use survey maps this location as ${name}.`,
        "A plot inside a tank bed cannot be regularised, and Bengaluru has seen buildings on tank beds demolished on court orders. Before any payment, get the survey sketch overlaid on the village map and the tank's boundary certified by the tahsildar.",
        pct(-65, -40),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= LAKE_BUFFER_M) {
    return [
      factor(
        "water_body_buffer",
        "Inside the lake buffer zone",
        "critical",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from ${name} — inside the ${LAKE_BUFFER_M} m no-construction buffer.`,
        "The RMP 2015 zoning regulations and the Karnataka Tank Conservation and Development Authority Act keep a 30 m buffer from a lake boundary free of construction. The distance here is to the water as mapped in 2023, not to the surveyed tank boundary, so treat it as a strong reason to get the boundary certified rather than as the certificate.",
        pct(-40, -20),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.waterCaution) {
    return [
      factor(
        "water_body_near",
        "Close to a water body",
        "caution",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from ${name}. Outside the buffer on our measurement, but the surveyed tank boundary can sit wider than the water.`,
        "Tank boundaries in the revenue record follow the historic full extent, which in Bengaluru is often well beyond today's waterline. Get the tank boundary and buffer marked on the village map before committing.",
        pct(-15, -5),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.waterAmenity) {
    return [
      factor(
        "water_body_amenity",
        "Near a water body",
        "info",
        "uplift",
        "inferred",
        `${metres(nearest.distanceM)} from ${name}, far enough to be an outlook rather than a restriction.`,
        "A live lake at this distance supports price rather than suppressing it, provided the plot itself is outside the buffer.",
        pct(2, 6),
        evidence,
      ),
    ];
  }
  return [];
}

function drainFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "ka_drain");
  if (!hits.length) return [];
  const nearest = hits[0];
  const kind = (str(nearest.attributes.LULC_Desc_3) ?? str(nearest.attributes.LULC_Desc_2) ?? "drain").toLowerCase();
  const evidence = {
    source: sourceFor("ka_drain"),
    layer: LAYER_BY_KEY.ka_drain?.path,
    distanceM: nearest.distanceM,
    attributes: { kind },
  };
  if (nearest.contains || nearest.distanceM <= DRAIN_BUFFER_MIN_M) {
    return [
      factor(
        "drain_buffer",
        "Inside the storm-water drain buffer",
        "critical",
        "drag",
        "inferred",
        nearest.contains
          ? `The 2023 land-use survey maps this location as a ${kind}.`
          : `${metres(nearest.distanceM)} from a mapped ${kind} — inside even the narrowest rajakaluve buffer.`,
        `RMP 2015 keeps ${DRAIN_BUFFER_MAX_M} / 25 / ${DRAIN_BUFFER_MIN_M} m either side of a primary / secondary / tertiary storm-water drain free of construction. The layer does not say which order this one is, so the buffer that applies may be wider than the ${DRAIN_BUFFER_MIN_M} m tested here. Rajakaluve encroachments are what BBMP's demolition drives target.`,
        pct(-45, -20),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.drainNear) {
    return [
      factor(
        "drain_near",
        "Beside a storm-water drain",
        "caution",
        "drag",
        "observed",
        `${metres(nearest.distanceM)} from a mapped ${kind}. Outside the tertiary buffer; a primary drain's ${DRAIN_BUFFER_MAX_M} m would reach it.`,
        "Ask the BBMP or the taluk office which order the drain is. Drain-adjacent plots also flood first and carry a building-line setback.",
        pct(-12, -4),
        evidence,
      ),
    ];
  }
  return [];
}

function zoneFactors(outcomes: LayerOutcome[], kind: SubjectKind): SiteFactor[] {
  const hits = hitsFor(outcomes, "ka_masterplan");
  if (!hits.length) return [];
  const containing = hits.find((h) => h.contains);
  const residentialUse = kind === "open_plot" || kind === "independent_house" || kind === "apartment";
  const out: SiteFactor[] = [];

  if (containing) {
    const proposed = str(containing.attributes.Proposed_L) ?? str(containing.attributes.Landuse);
    const town = str(containing.attributes.Town_Name);
    const zone = classifyZone(proposed);
    const evidence = {
      source: sourceFor("ka_masterplan"),
      layer: LAYER_BY_KEY.ka_masterplan?.path,
      distanceM: 0,
      attributes: { planning_area: town, proposed_land_use: proposed },
    };
    const where = town ? `The ${town} master plan` : "The master plan";

    switch (zone) {
      case "industrial":
        out.push(
          factor(
            "zone_industrial",
            "Zoned industrial in the master plan",
            residentialUse ? "critical" : "caution",
            "drag",
            "observed",
            residentialUse
              ? `${where} zones this location "${proposed}", where a dwelling is not permitted as of right.`
              : `${where} zones this location "${proposed}".`,
            residentialUse
              ? "A house on industrially zoned land needs a change of land use under the Karnataka Town and Country Planning Act, which is discretionary and slow. Plots here are marketed as residential constantly; the zoning is what the sanctioning authority reads."
              : "Industrial zoning raises value for industrial use and constrains every other use.",
            residentialUse ? pct(-35, -15) : pct(-8, 5),
            evidence,
          ),
        );
        break;
      case "agricultural":
        if (kind !== "agricultural_land") {
          out.push(
            factor(
              "zone_agricultural",
              "Zoned agricultural in the master plan",
              "caution",
              "drag",
              "observed",
              `${where} keeps this location "${proposed}". Building a house or forming a layout needs the land converted and the use changed first.`,
              "Non-agricultural use of agricultural land needs conversion under Section 95 of the Karnataka Land Revenue Act and, inside a planning area, a change of land use from the planning authority. Neither is guaranteed and both cost a share of the land's value. Plots sold from 'revenue sites' in these zones cannot get a plan sanction until this is done.",
              pct(-40, -20),
              evidence,
            ),
          );
        }
        break;
      case "open_space":
      case "public":
      case "forest":
      case "water":
        out.push(
          factor(
            "zone_reserved",
            "Reserved in the master plan",
            "critical",
            "drag",
            "observed",
            `${where} reserves this location as "${proposed}", which is not land a private buyer can develop.`,
            "Land shown as park, open space, public or semi-public use, forest or water body in a master plan is earmarked for acquisition or kept undeveloped. A private sale here transfers a plot that cannot get a plan sanction. Confirm the zone with the planning authority's zonal certificate before paying anything.",
            pct(-70, -40),
            evidence,
          ),
        );
        break;
      case "transport":
        out.push(
          factor(
            "zone_transport",
            "On a proposed road or transport reservation",
            "critical",
            "drag",
            "observed",
            `${where} shows this location as "${proposed}" — inside a road or transport reservation.`,
            "Land inside a master-plan road reservation is acquired when the road is built, at a statutory award, and nothing can be sanctioned on it in the meantime. Check the reservation's width against the plan sheet; a plot partly inside loses that part.",
            pct(-45, -20),
            evidence,
          ),
        );
        break;
      case "commercial":
        if (kind === "open_plot") {
          out.push(
            factor(
              "zone_commercial",
              "Zoned commercial in the master plan",
              "info",
              "uplift",
              "observed",
              `${where} zones this location "${proposed}".`,
              "Commercial zoning allows shops and offices as of right and usually a higher floor-area ratio, which is worth a premium for an open plot on a road that can carry it.",
              pct(5, 15),
              evidence,
            ),
          );
        }
        break;
      case "residential":
        out.push(
          factor(
            "zone_residential",
            "Zoned residential in the master plan",
            "info",
            "uplift",
            "observed",
            `${where} zones this location "${proposed}", so a house or a layout is a permitted use.`,
            "Residential zoning is the baseline a buyer assumes; its value is that no change of land use stands between the plot and a plan sanction. Layout approval and conversion are still separate steps.",
            pct(0, 3),
            evidence,
          ),
        );
        break;
      default:
        break;
    }
  }

  // Industrial land in the 400 m box, whether or not the subject's own polygon
  // is zoned. The box query carries no geometry, so this is "within about
  // 400 m", not a measured distance, and the wording says so.
  if (residentialUse && !(containing && classifyZone(str(containing.attributes.Proposed_L)) === "industrial")) {
    const industrialNear = hitsFor(outcomes, "ka_masterplan_near").find(
      (h) => classifyZone(str(h.attributes.Proposed_L)) === "industrial",
    );
    if (industrialNear) {
      out.push(
        factor(
          "industrial_adjacent",
          "Land zoned industrial nearby",
          "caution",
          "drag",
          "observed",
          `Within about ${NEAR.industrialAdjacent} m of land the master plan zones for industry.`,
          "Adjacency brings heavy-vehicle traffic, effluent and noise, and it caps what a residential resale can fetch however good the construction is. The master plan's polygons are too large to measure an exact distance to on every check; the planning-district sheet shows where the boundary runs.",
          pct(-15, -5),
          {
            source: sourceFor("ka_masterplan_near"),
            layer: LAYER_BY_KEY.ka_masterplan_near?.path,
            distanceM: null,
          },
        ),
      );
    }
  }

  return out;
}

export type KaDeriveResult = {
  factors: SiteFactor[];
  gaps: { layer: string; reason: string }[];
  /** True when the master-plan layer answered and had nothing here: BDA's area. */
  outsidePublishedMasterPlan: boolean;
};

export function deriveKaFactors(outcomes: LayerOutcome[], kind: SubjectKind): KaDeriveResult {
  const factors = [
    ...waterFactors(outcomes),
    ...drainFactors(outcomes),
    ...zoneFactors(outcomes, kind),
  ];

  const gaps = outcomes
    .filter((o): o is Extract<LayerOutcome, { ok: false }> => !o.ok)
    .map((o) => ({
      layer: LAYER_BY_KEY[o.key]?.label ?? o.key,
      reason: gapReason(o.reason),
    }));

  const outsidePublishedMasterPlan =
    wasRead(outcomes, "ka_masterplan") && !hitsFor(outcomes, "ka_masterplan").some((h) => h.contains);
  if (outsidePublishedMasterPlan) {
    gaps.push({
      layer: "Master-plan zoning (BDA area)",
      reason:
        "Bengaluru's own master plan, RMP 2015, is published only as scanned planning-district sheets, not as a map layer. The zoning here could not be read; get a zonal certificate from BDA for this survey number.",
    });
  }

  return { factors, gaps, outsidePublishedMasterPlan };
}
