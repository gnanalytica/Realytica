// The Karnataka GIS layers site intelligence consults around a Bengaluru plot.
//
// K-GIS (KSRSAC) publishes two things that matter here and one that is
// conspicuously missing.
//
// Present: the BMRDA master-plan land use for the local planning areas ringing
// the city (Anekal, Hoskote, Nelamangala, the airport area, Kanakapura, Magadi,
// Doddaballapura, Ramanagara) — proposed zoning, polygon by polygon; and the
// state-wide 2023 land-use survey, which is what is actually on the ground,
// including every tank, pond and drain.
//
// Missing: BDA's own RMP 2015 for the core city, which exists only as scanned
// planning-district sheets. Inside BDA limits the master-plan layer returns
// nothing, and that emptiness is reported as "not published", never as "no
// zoning".
//
// The 2023 land-use layer stands in for a water-bodies register. It is a
// remote-sensing classification, not a revenue record: it knows where the
// water is, not what the tank is called or whether it is encroached.

import type { LayerSpec } from "../layers";

export const KGIS_ROOT = "https://kgis.ksrsac.in/arcgis/rest/services";

const LULC = "LULC/State_LULC_2023/MapServer/0";
const LULC_SOURCE = "Karnataka GIS (K-GIS) — state land use 2023";

/**
 * K-GIS answers in seconds where Telangana answers in milliseconds, and the
 * master-plan polygons are enormous — a 400 m box around Anekal returns 122
 * features and 94 MB of geometry, in 47 seconds. So the master plan is read
 * twice without geometry: the zone AT the point (a point query, ~5 s) and
 * the zones in the 400 m box (~6 s), and it is not drawn on the map.
 */
const KGIS_TIMEOUT_MS = 25_000;

export const KA_LAYERS: LayerSpec[] = [
  {
    key: "ka_water",
    label: "Lakes, tanks and ponds",
    root: KGIS_ROOT,
    path: LULC,
    where: "LULC_Desc_1='Water bodies' AND LULC_Desc_2 IN ('Tank','Pond','Reservoir','River')",
    geometry: "polygon",
    radiusM: 1_000,
    outFields: ["Name", "LULC_Desc_2", "LULC_Desc_3"],
    source: `${LULC_SOURCE}, water bodies`,
    timeoutMs: KGIS_TIMEOUT_MS,
  },
  {
    key: "ka_drain",
    label: "Streams and storm-water drains",
    root: KGIS_ROOT,
    path: LULC,
    where: "LULC_Desc_1='Water bodies' AND LULC_Desc_2 IN ('Stream','Canal')",
    geometry: "polygon",
    radiusM: 150,
    outFields: ["Name", "LULC_Desc_2", "LULC_Desc_3"],
    source: `${LULC_SOURCE}, streams and drains`,
    timeoutMs: KGIS_TIMEOUT_MS,
  },
  {
    key: "ka_masterplan",
    label: "Master-plan land use at the plot (BMRDA planning areas)",
    root: KGIS_ROOT,
    path: "BMRDA/BMRDA/MapServer/4",
    geometry: "polygon",
    radiusM: 0,
    outFields: ["Town_Name", "Landuse", "Existing_L", "Proposed_L"],
    source: "Karnataka GIS (K-GIS) — BMRDA master plans, proposed land use",
    attributesOnly: true,
    timeoutMs: KGIS_TIMEOUT_MS,
  },
  {
    key: "ka_masterplan_near",
    label: "Master-plan land use within 400 m (BMRDA planning areas)",
    root: KGIS_ROOT,
    path: "BMRDA/BMRDA/MapServer/4",
    geometry: "polygon",
    radiusM: 400,
    outFields: ["Town_Name", "Landuse", "Existing_L", "Proposed_L"],
    source: "Karnataka GIS (K-GIS) — BMRDA master plans, proposed land use",
    attributesOnly: true,
    timeoutMs: KGIS_TIMEOUT_MS,
  },
  {
    key: "ka_lulc",
    label: "Current land use (2023)",
    root: KGIS_ROOT,
    path: LULC,
    geometry: "polygon",
    radiusM: 0,
    outFields: ["LULC_Desc_1", "LULC_Desc_2", "LULC_Desc_3", "Name"],
    source: LULC_SOURCE,
    timeoutMs: KGIS_TIMEOUT_MS,
  },
];

export const KA_DECISIVE_LAYER_KEYS = ["ka_water", "ka_masterplan"] as const;

/** Proposed-land-use wording in the BMRDA layer, grouped by what it means. */
export type ZoneClass =
  | "residential"
  | "commercial"
  | "industrial"
  | "agricultural"
  | "open_space"
  | "public"
  | "transport"
  | "water"
  | "forest"
  | "other";

export function classifyZone(proposed: string | null): ZoneClass {
  const p = (proposed ?? "").toLowerCase();
  if (!p) return "other";
  if (p.includes("resid")) return "residential";
  if (p.includes("commerc")) return "commercial";
  if (p.includes("industr")) return "industrial";
  if (p.includes("agri")) return "agricultural";
  if (p.includes("park") || p.includes("open space") || p.includes("recreat")) return "open_space";
  if (p.includes("public") || p.includes("utility")) return "public";
  if (p.includes("road") || p.includes("transport") || p.includes("railway") || p.includes("ring"))
    return "transport";
  if (p.includes("water")) return "water";
  if (p.includes("forest")) return "forest";
  return "other";
}
