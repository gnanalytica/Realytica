// The Telangana GIS layers site intelligence consults, and how far around the
// subject each one is worth looking.
//
// These are the state's own ArcGIS services (TGRAC, the Telangana Remote sensing
// Applications Centre). They are a departmental system, not a published API:
// there is no SLA, several folders are named `test`, and any of them can move.
// Every consumer therefore treats a layer failure as a GAP to be reported, never
// as an absence of the factor — "we could not check" and "there is nothing
// there" must never render the same way.
//
// Radii are the distance at which the feature stops plausibly moving a price,
// not the distance at which it stops existing. They bound the envelope query;
// the exact distance is always recomputed locally.

import { KA_LAYERS } from "./karnataka/layers";
import { STATES, stateAt, type StateKey } from "./states";

export type LayerGeometry = "polygon" | "polyline" | "point";

export type LayerSpec = {
  key: string;
  label: string;
  /** ArcGIS REST services root. Telangana's when omitted. */
  root?: string;
  /** `<folder>/<service>/MapServer/<layerId>` — appended to the server root. */
  path: string;
  /** Attribute filter, when one layer holds several things worth reading. */
  where?: string;
  geometry: LayerGeometry;
  /** Half-width of the envelope query, metres. */
  radiusM: number;
  outFields: string[];
  /**
   * Ask for attributes only. Containment is then the server's answer to a
   * 1 m envelope, and the feature is not drawn. For a layer whose polygons
   * are megabytes each — a master plan's road network is one polygon — this
   * is the difference between one second and a minute.
   */
  attributesOnly?: boolean;
  /**
   * Generalise geometry to this tolerance, in degrees, before it is sent.
   * ~0.0001 is eleven metres: fine for drawing a zone at 600 m, useless for
   * deciding whether a point is inside it, which is why a layer that uses
   * this must not be the one containment is judged on.
   */
  maxAllowableOffset?: number;
  /** Per-layer budget; the state servers differ by an order of magnitude. */
  timeoutMs?: number;
  /** Shown as provenance on any factor derived from this layer. */
  source: string;
};

export const TGRAC_ROOT = "http://tgracgis.telangana.gov.in/arcgis/rest/services";

/**
 * Layers queried per lookup. Ordered by how much a hit matters, because the
 * client runs them with a concurrency cap and a wall-clock budget: if the budget
 * runs out, the ones that can make a property unsellable have already run.
 */
export const SITE_LAYERS: LayerSpec[] = [
  {
    key: "water_bodies",
    label: "Lakes, tanks and their beds",
    path: "TankInformationSystem/TS_HMDA_ORR_GHMC_Water_Bodies/MapServer/13",
    geometry: "polygon",
    radiusM: 1_200,
    outFields: ["WB_Name", "Village", "Mandal", "District", "WBS_2023", "WB_Type", "Area"],
    source: "Telangana GIS — HMDA/ORR/GHMC water bodies",
  },
  {
    key: "prohibited_land",
    label: "Prohibited and government land",
    path: "Bhunaksha/Bhunaksha/MapServer/0",
    geometry: "polygon",
    radiusM: 250,
    outFields: [
      "Parcel_num",
      "V_Name",
      "M_Name",
      "D_Name",
      "CATEGORY_OF_PROHIBITORY_LAND",
      "SY_NO",
      "EXTENT",
    ],
    source: "Telangana GIS — Bhunaksha prohibited-parcel register",
  },
  {
    key: "flooding",
    label: "Recorded flooding areas",
    path: "Urban_Core/Telangana_Core_Urban_Region_V2/MapServer/89",
    geometry: "polygon",
    radiusM: 800,
    outFields: ["Flood"],
    source: "Telangana GIS — core urban region, revenue & disaster",
  },
  {
    key: "nala_widening",
    label: "Storm-water drain widening",
    path: "flood/vul/MapServer/3",
    geometry: "polyline",
    radiusM: 300,
    outFields: ["Nala_Name", "Prop_Width", "Circle", "District"],
    source: "Telangana GIS — GHMC nala proposed widths",
  },
  {
    key: "rrr_alignment",
    label: "Regional Ring Road alignment",
    path: "RRR/RRR/MapServer/14",
    geometry: "polyline",
    radiusM: 5_000,
    outFields: ["Name"],
    source: "Telangana GIS — Regional Ring Road alignment",
  },
  {
    key: "metro_stations",
    label: "Metro stations",
    path: "Urban_Core/Telangana_Core_Urban_Region_V2/MapServer/74",
    geometry: "point",
    radiusM: 2_500,
    outFields: ["Name", "Line"],
    source: "Telangana GIS — metro network",
  },
  {
    key: "industrial",
    label: "Industrial land use",
    path: "HMDA/HMDA/MapServer/4",
    geometry: "polygon",
    radiusM: 1_000,
    outFields: ["Village", "Mandal", "District", "Area"],
    source: "Telangana GIS — HMDA industrial parcels",
  },
  {
    key: "hmda_zone",
    label: "HMDA planning jurisdiction",
    path: "HMDA/HMDA/MapServer/0",
    geometry: "polygon",
    radiusM: 0,
    outFields: ["ZNAME"],
    source: "Telangana GIS — HMDA jurisdiction",
  },
  {
    key: "hmda_cadastral",
    label: "HMDA cadastral village",
    path: "HMDA/HMDA/MapServer/5",
    geometry: "polygon",
    radiusM: 0,
    outFields: ["Village", "Mandal", "District", "Parcels"],
    source: "Telangana GIS — HMDA cadastral",
  },
];

export const LAYER_BY_KEY: Record<string, LayerSpec> = Object.fromEntries(
  [...SITE_LAYERS, ...KA_LAYERS].map((l) => [l.key, l]),
);

/** The layer set for a state. */
export function layersFor(state: StateKey): LayerSpec[] {
  return state === "KA" ? KA_LAYERS : SITE_LAYERS;
}

/**
 * The layers whose absence changes the answer rather than merely thinning it.
 * If one of these could not be reached, the report says so prominently and the
 * estimate is still produced — but flagged as incomplete.
 */
export const DECISIVE_LAYER_KEYS = ["water_bodies", "prohibited_land"] as const;

/**
 * Telangana GIS covers Telangana. A point outside this box gets an honest
 * "not covered" rather than an estimate built from nothing. Generous bounds —
 * the layers themselves decide precision.
 */
export const TELANGANA_BOUNDS = STATES.TS.bounds;

export function isWithinCoverage(point: { lat: number; lng: number }): boolean {
  return stateAt(point) !== null;
}
