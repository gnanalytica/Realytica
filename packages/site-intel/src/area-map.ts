// The neighbourhood, drawn and told.
//
// `buildAreaMap` turns the layer hits into shapes that can be drawn on the same
// sketch as the survey boundaries — the lake the buffer factor talks about, the
// alignment the acquisition factor talks about — so a finding is something the
// person can see beside their own plot rather than take on trust.
//
// `deriveInsights` turns the same hits into sentences: what is there, how far,
// which way, and what it means for this land. It deliberately overlaps the
// factor list. The factors say what moves the price; the insights say what is
// around and what is coming, whether or not it has a percentage attached, and
// a station 1.8 km away or a planning boundary the plot sits inside are things
// a buyer wants told even when we will not price them.
//
// Pure: no network, no clock.

import type { LatLng } from "./geo/measure";
import type { LayerHit, LayerOutcome } from "./arcgis";
import {
  bearingDegrees,
  compassLabel,
  distanceToSegmentMeters,
  nearestPointOnPaths,
} from "./geometry";
import { LAYER_BY_KEY, layersFor } from "./layers";
import { classifyZone } from "./karnataka/layers";
import type { StateKey } from "./states";
import type { AreaFeature, AreaFeatureKind, AreaInsight, AreaMap } from "./types";

const KIND_BY_LAYER: Record<string, AreaFeatureKind> = {
  water_bodies: "water",
  flooding: "flood",
  nala_widening: "nala",
  rrr_alignment: "rrr",
  metro_stations: "metro",
  industrial: "industrial",
  prohibited_land: "prohibited",
  hmda_zone: "hmda_zone",
  // Karnataka
  ka_water: "water",
  ka_drain: "nala",
};

/** A hit's own kind, when a layer might hold more than one. */
function kindOf(key: string): AreaFeatureKind {
  return KIND_BY_LAYER[key];
}

/** Beyond this the feature is context, not neighbourhood, and is not drawn. */
const DRAW_RADIUS_M = 3_000;
/** A hard cap per layer so one dense tank cluster cannot bloat the payload. */
const MAX_PER_LAYER = 30;
/**
 * Long alignments are returned whole — the Regional Ring Road is one feature
 * hundreds of kilometres long. Only the vertices near the plot are shipped.
 */
const CLIP_RADIUS_M = 6_000;

function str(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

function num(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function metres(d: number): string {
  return d < 1_000 ? `${Math.round(d)} m` : `${(d / 1_000).toFixed(1)} km`;
}

function hitsFor(outcomes: LayerOutcome[], key: string): LayerHit[] {
  const outcome = outcomes.find((o) => o.key === key);
  return outcome?.ok ? outcome.hits : [];
}

function wasRead(outcomes: LayerOutcome[], key: string): boolean {
  const outcome = outcomes.find((o) => o.key === key);
  return !!outcome && outcome.ok;
}

function sourceFor(key: string, outcomes: LayerOutcome[]): string {
  const base = LAYER_BY_KEY[key]?.source ?? "Telangana GIS";
  const outcome = outcomes.find((o) => o.key === key);
  const mirroredOn = outcome?.ok ? outcome.mirroredOn : undefined;
  return mirroredOn ? `${base} — local copy of ${mirroredOn}, live server unreachable` : base;
}

/**
 * Keep the parts of each path that pass near the point. The test is on the
 * SEGMENT, not its endpoints: the Regional Ring Road is digitised in long
 * straight runs, and the one that passes a kilometre from the plot can have
 * both ends twenty kilometres away. Kept segments are joined into runs so the
 * line stays continuous on screen.
 */
function clipPaths(paths: [number, number][][], point: LatLng): [number, number][][] {
  const out: [number, number][][] = [];
  for (const path of paths) {
    let run: [number, number][] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const near =
        distanceToSegmentMeters(point, { lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }) <=
        CLIP_RADIUS_M;
      if (near) {
        if (run.length === 0) run.push(a);
        run.push(b);
      } else if (run.length > 1) {
        out.push(run);
        run = [];
      }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

function nameFor(key: string, hit: LayerHit): string | null {
  const a = hit.attributes;
  switch (key) {
    case "water_bodies":
      return str(a.WB_Name);
    case "nala_widening":
      return str(a.Nala_Name);
    case "rrr_alignment":
      return str(a.Name) ?? "Regional Ring Road";
    case "metro_stations":
      return str(a.Name);
    case "prohibited_land":
      return str(a.SY_NO) ?? str(a.Parcel_num);
    case "hmda_zone":
      return str(a.ZNAME);
    case "ka_water":
    case "ka_drain":
      return str(a.Name) ?? str(a.LULC_Desc_2);
    default:
      return null;
  }
}

/** Only parcels actually on the Section 22-A register are worth drawing. */
function drawable(key: string, hit: LayerHit): boolean {
  if (key === "prohibited_land") return !!str(hit.attributes.CATEGORY_OF_PROHIBITORY_LAND);
  return true;
}

export function buildAreaMap(centre: LatLng, outcomes: LayerOutcome[], state: StateKey = "TS"): AreaMap {
  const features: AreaFeature[] = [];
  const emptyLayers: string[] = [];
  const unreadLayers: string[] = [];

  // Only the layers this state was actually asked about. Walking the whole
  // table would list every Telangana layer as "could not be read" under a
  // Bengaluru plot — which the Karnataka suite caught.
  // Attribute-only layers have no shape to draw and are told, not shown.
  const keys = layersFor(state)
    .filter((l) => !l.attributesOnly)
    .map((l) => l.key)
    .filter((k) => k in KIND_BY_LAYER);

  for (const key of keys) {
    if (!wasRead(outcomes, key)) {
      unreadLayers.push(key);
      continue;
    }
    // The planning boundary is a jurisdiction, not a neighbour: it is reported
    // as an insight, never drawn as a shape the size of a district — and never
    // listed as "empty" for the same reason.
    if (key === "hmda_zone" || key === "ka_lulc") continue;
    let count = 0;
    for (const hit of hitsFor(outcomes, key)) {
      if (count >= MAX_PER_LAYER) break;
      if (!drawable(key, hit)) continue;
      if (!hit.contains && hit.distanceM > DRAW_RADIUS_M) continue;
      const g = hit.geometry;
      if (!g) continue;
      const id = `${key}:${count}`;
      const base = {
        id,
        kind: kindOf(key),
        layerKey: key,
        name: nameFor(key, hit),
        distanceM: hit.distanceM,
        contains: hit.contains,
      };
      if (g.rings?.length) features.push({ ...base, rings: g.rings });
      else if (g.paths?.length) {
        const paths = clipPaths(g.paths, centre);
        if (paths.length) features.push({ ...base, paths });
      } else if (g.point) features.push({ ...base, point: g.point });
      else continue;
      count += 1;
    }
    if (count === 0) emptyLayers.push(key);
  }

  return { centre, features, emptyLayers, unreadLayers };
}

// ------------------------------------------------------------------ insights

function directionTo(point: LatLng, hit: LayerHit): string | null {
  if (hit.contains) return null;
  const g = hit.geometry;
  let target: LatLng | null = null;
  if (g?.point) target = { lng: g.point[0], lat: g.point[1] };
  else if (g?.rings?.length) target = nearestPointOnPaths(point, g.rings);
  else if (g?.paths?.length) target = nearestPointOnPaths(point, g.paths);
  if (!target) return null;
  return compassLabel(bearingDegrees(point, target));
}

function where(point: LatLng, hit: LayerHit): string {
  if (hit.contains) return "the plot sits inside it";
  const dir = directionTo(point, hit);
  return `${metres(hit.distanceM)} to the ${dir ?? "side"}`;
}

/** Feature id for a hit, matching what `buildAreaMap` assigned, when drawn. */
function featureIdFor(map: AreaMap, key: string, hit: LayerHit): string | null {
  const name = nameFor(key, hit);
  const f = map.features.find(
    (x) => x.layerKey === key && x.name === name && Math.abs(x.distanceM - hit.distanceM) < 0.5,
  );
  return f?.id ?? null;
}

type Ctx = { point: LatLng; outcomes: LayerOutcome[]; map: AreaMap; state: StateKey };

function rrrInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "rrr_alignment");
  if (!hits.length) return [];
  const h = hits[0];
  const near = h.distanceM <= 150;
  const corridor = h.distanceM <= 3_000;
  return [
    {
      code: "rrr",
      kind: "planned",
      layerKey: "rrr_alignment",
      featureId: featureIdFor(map, "rrr_alignment", h),
      title: "Regional Ring Road alignment",
      status: "Proposed — land acquisition in progress",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: near
        ? `The published alignment passes ${where(point, h)}. Land inside the corridor is acquired at a statutory award, not a negotiated price, and the timing is the authority's. Check the current notification for this village before paying anything.`
        : corridor
          ? `The alignment runs ${where(point, h)}. Close enough to gain from the access once it is built, far enough that the plot itself is not in the corridor. The gain is speculative until construction starts and is partly priced in near notified interchanges.`
          : `The alignment runs ${where(point, h)}. At this distance it shapes how fast the area develops rather than today's rate.`,
      source: sourceFor("rrr_alignment", outcomes),
    },
  ];
}

function metroInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "metro_stations").slice(0, 3);
  const seen = new Set<string>();
  const out: AreaInsight[] = [];
  for (const h of hits) {
    const name = str(h.attributes.Name) ?? "Metro station";
    if (seen.has(name)) continue;
    seen.add(name);
    const line = str(h.attributes.Line);
    out.push({
      code: `metro:${name}:${Math.round(h.distanceM)}`,
      kind: "existing",
      layerKey: "metro_stations",
      featureId: featureIdFor(map, "metro_stations", h),
      title: line ? `${name} metro station (${line})` : `${name} metro station`,
      status: "On the metro network map",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning:
        h.distanceM <= 700
          ? `${where(point, h)} — a genuine walk. Walk-to-station is one of the few premiums that survives a downturn, because it widens who can live or rent here.`
          : h.distanceM <= 1_500
            ? `${where(point, h)} — a short auto or feeder ride. Worth something, but much less than a walkable plot in the same locality.`
            : `${where(point, h)}. Shapes where the area is heading more than what this plot fetches today.`,
      source: sourceFor("metro_stations", outcomes),
    });
  }
  return out;
}

function nalaInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "nala_widening").slice(0, 2);
  return hits.map((h, i) => {
    const name = str(h.attributes.Nala_Name) ?? "Storm-water drain";
    const width = num(h.attributes.Prop_Width);
    const take = width !== null ? width / 2 : null;
    const inPath = take !== null && h.distanceM <= take;
    return {
      code: `nala:${i}`,
      kind: "planned",
      layerKey: "nala_widening",
      featureId: featureIdFor(map, "nala_widening", h),
      title: width !== null ? `${name} — widening to ${width} m` : `${name} — widening planned`,
      status: "Approved widening (GHMC)",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: inPath
        ? `The drain's centre line is ${where(point, h)}, and the widened channel takes roughly ${Math.round(take!)} m either side of it. The strip inside that width is acquired and structures on it are removed. Confirm the alignment against the circle office's drawing.`
        : `${where(point, h)}. Beside a drain you carry a building-line setback, you flood first, and the widening line moves as the survey is revised. Keep the frontage plan flexible.`,
      source: sourceFor("nala_widening", outcomes),
    };
  });
}

function floodInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "flooding");
  if (!hits.length) return [];
  const h = hits[0];
  return [
    {
      code: "flood",
      kind: "risk",
      layerKey: "flooding",
      featureId: featureIdFor(map, "flooding", h),
      title: "Recorded flooding area",
      status: "On the city's flood record",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: h.contains
        ? "The plot is inside an area the city's own records mark as flood-affected. Not a legal bar to building, but it hits insurability, ground-floor use and resale depth."
        : `${where(point, h)}. Being outside the mapped area is not the same as being on higher ground — check the plot level against the road and the nearest drain before the monsoon.`,
      source: sourceFor("flooding", outcomes),
    },
  ];
}

function waterInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "water_bodies").slice(0, 3);
  const seen = new Set<string>();
  const out: AreaInsight[] = [];
  for (const h of hits) {
    const name = str(h.attributes.WB_Name) ?? "Unnamed tank";
    // Unnamed tanks are common and several can sit within a kilometre, so the
    // code carries the distance as well as the name: it is what keeps two of
    // them apart on screen.
    const key = `${name}:${Math.round(h.distanceM / 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const status = str(h.attributes.WBS_2023);
    const areaSqm = num(h.attributes.Area);
    const large = areaSqm !== null && areaSqm >= 100_000;
    const buffer = large ? 30 : 9;
    const encroached = !!status && status.toLowerCase().includes("encroach");
    out.push({
      code: `water:${key}`,
      kind: h.contains || h.distanceM <= buffer ? "risk" : "existing",
      layerKey: "water_bodies",
      featureId: featureIdFor(map, "water_bodies", h),
      title: name,
      status: status ? `Register status 2023: ${status}` : "On the water-bodies register",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: h.contains
        ? "The plot falls inside the mapped water body. Construction in a tank bed is not regularisable and has been demolished on this basis since 2024. Get a surveyed full-tank-level check before any payment."
        : h.distanceM <= buffer
          ? `${where(point, h)} — inside the ${buffer} m no-construction buffer for a tank this size. The measurement is to the mapped edge, not the surveyed full tank level, so obtain the FTL and buffer certificate.`
          : encroached
            ? `${where(point, h)}. The register marks this tank as encroached, which is the pattern that precedes a HYDRAA notice in the pocket around it.`
            : `${where(point, h)}. Outside the statutory buffer on our measurement; at this distance an intact tank is an outlook rather than a restriction.`,
      source: sourceFor("water_bodies", outcomes),
    });
  }
  return out;
}

function industrialInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "industrial");
  if (!hits.length) return [];
  const h = hits[0];
  return [
    {
      code: "industrial",
      kind: "zoning",
      layerKey: "industrial",
      featureId: featureIdFor(map, "industrial", h),
      title: "Industrial land-use zone",
      status: "HMDA master plan zoning",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: h.contains
        ? "The master plan zones this location for manufacturing. A house here needs a change of land use, which is discretionary. Plots in these zones are routinely sold as residential; the zoning is what the sanctioning authority reads."
        : `${where(point, h)}. Adjacency brings heavy-vehicle traffic, effluent and noise, and it caps what a residential resale can fetch.`,
      source: sourceFor("industrial", outcomes),
    },
  ];
}

function prohibitedInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const listed = hitsFor(outcomes, "prohibited_land").filter((h) =>
    str(h.attributes.CATEGORY_OF_PROHIBITORY_LAND),
  );
  if (!listed.length) return [];
  const h = listed.find((x) => x.contains) ?? listed[0];
  const category = str(h.attributes.CATEGORY_OF_PROHIBITORY_LAND);
  const sy = str(h.attributes.SY_NO) ?? str(h.attributes.Parcel_num);
  return [
    {
      code: "prohibited",
      kind: "risk",
      layerKey: "prohibited_land",
      featureId: featureIdFor(map, "prohibited_land", h),
      title: sy ? `Prohibited-register parcel, survey no ${sy}` : "Prohibited-register parcel",
      status: category ? `Section 22-A: ${category}` : "Section 22-A entry",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: h.contains
        ? "This parcel itself is on the register. The sub-registrar cannot register a sale of it until the entry is cleared or released."
        : `${where(point, h)}. An adjoining prohibited parcel is a common source of boundary disputes and stop-work notices that catch the neighbour. Have the boundary demarcated against the village map.`,
      source: sourceFor("prohibited_land", outcomes),
    },
  ];
}

function zoneInsights({ outcomes }: Ctx): AreaInsight[] {
  const zone = hitsFor(outcomes, "hmda_zone").find((h) => h.contains);
  if (!zone) return [];
  const name = str(zone.attributes.ZNAME);
  return [
    {
      code: "hmda_zone",
      kind: "zoning",
      layerKey: "hmda_zone",
      featureId: null,
      title: name ? `Inside HMDA planning area — ${name}` : "Inside the HMDA planning area",
      status: "Metropolitan Development Plan 2031 applies",
      distanceM: 0,
      direction: null,
      meaning:
        "Building permission, layout approval and land-use here run through HMDA's master plan rather than the district town-planning office. The 2031 plan fixes the land-use zone and the road widths the plot must respect; a zoning certificate from HMDA confirms which zone this survey number falls in.",
      source: sourceFor("hmda_zone", outcomes),
    },
  ];
}

// ------------------------------------------------------------ Karnataka

function kaWaterInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  // A lake is often several polygons in the land-use survey; one card per
  // named lake, nearest polygon first.
  const seen = new Set<string>();
  const hits = hitsFor(outcomes, "ka_water").filter((h) => {
    const key = str(h.attributes.Name)?.toLowerCase() ?? `unnamed:${Math.round(h.distanceM / 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  return hits.map((h, i) => {
    const kind = (str(h.attributes.LULC_Desc_2) ?? "water body").toLowerCase();
    const name = str(h.attributes.Name) ?? `Unnamed ${kind}`;
    const inBuffer = h.contains || h.distanceM <= 30;
    return {
      code: `ka_water:${i}:${Math.round(h.distanceM)}`,
      kind: inBuffer ? "risk" : "existing",
      layerKey: "ka_water",
      featureId: featureIdFor(map, "ka_water", h),
      title: name,
      status: `Mapped as ${kind} in the 2023 land-use survey`,
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: h.contains
        ? "The 2023 survey maps the plot itself as water. A tank-bed plot cannot be regularised; get the tank boundary certified by the tahsildar before any payment."
        : inBuffer
          ? `${where(point, h)} — inside the 30 m lake buffer the RMP 2015 zoning regulations keep free of construction. Measured to the 2023 waterline, not the surveyed tank boundary, which is usually wider.`
          : `${where(point, h)}. Outside the 30 m buffer on our measurement. The revenue record's tank boundary follows the historic extent, so have it marked on the village map before committing.`,
      source: sourceFor("ka_water", outcomes),
    };
  });
}

function kaDrainInsights({ point, outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "ka_drain").slice(0, 2);
  return hits.map((h, i) => {
    const kind = (str(h.attributes.LULC_Desc_3) ?? str(h.attributes.LULC_Desc_2) ?? "drain").toLowerCase();
    const inBuffer = h.contains || h.distanceM <= 15;
    return {
      code: `ka_drain:${i}:${Math.round(h.distanceM)}`,
      kind: inBuffer ? "risk" : "existing",
      layerKey: "ka_drain",
      featureId: featureIdFor(map, "ka_drain", h),
      title: str(h.attributes.Name) ?? `Storm-water drain (${kind})`,
      status: "Mapped in the 2023 land-use survey",
      distanceM: h.distanceM,
      direction: directionTo(point, h),
      meaning: inBuffer
        ? `${where(point, h)}. RMP 2015 keeps 50 / 25 / 15 m either side of a primary / secondary / tertiary rajakaluve clear; even the narrowest reaches here. Rajakaluve encroachment is what BBMP's demolition drives target.`
        : `${where(point, h)}. A primary drain's 50 m buffer would reach this; ask the BBMP or taluk office which order it is. Drain-side plots flood first.`,
      source: sourceFor("ka_drain", outcomes),
    };
  });
}

function kaZoneInsights({ outcomes, map }: Ctx): AreaInsight[] {
  const hits = hitsFor(outcomes, "ka_masterplan");
  const out: AreaInsight[] = [];
  const containing = hits.find((h) => h.contains);
  if (containing) {
    const proposed = str(containing.attributes.Proposed_L) ?? str(containing.attributes.Landuse) ?? "unclassified";
    const town = str(containing.attributes.Town_Name);
    const zone = classifyZone(proposed);
    const reserved = zone === "open_space" || zone === "public" || zone === "forest" || zone === "water" || zone === "transport";
    out.push({
      code: "ka_zone",
      kind: reserved || zone === "industrial" ? "risk" : "zoning",
      layerKey: "ka_masterplan",
      featureId: featureIdFor(map, "ka_masterplan", containing),
      title: `Master plan: ${proposed}${town ? ` (${town} planning area)` : ""}`,
      status: "BMRDA master plan, proposed land use",
      distanceM: 0,
      direction: null,
      meaning:
        zone === "residential"
          ? "A house or a layout is a permitted use here; no change of land use stands between the plot and a plan sanction. Layout approval and conversion are still separate steps."
          : zone === "commercial"
            ? "Shops and offices are permitted as of right, usually with a higher floor-area ratio than residential zoning."
            : zone === "industrial"
              ? "A dwelling here needs a change of land use, which is discretionary. Plots in these zones are sold as residential constantly."
              : zone === "agricultural"
                ? "Building needs the land converted under Section 95 of the Land Revenue Act and a change of land use from the planning authority, neither guaranteed."
                : reserved
                  ? "Reserved land is earmarked for acquisition or kept undeveloped; a private plot here cannot get a plan sanction. Get the zonal certificate before paying anything."
                  : "The zone's wording does not map to a standard use. Ask the planning authority for a zonal certificate.",
      source: sourceFor("ka_masterplan", outcomes),
    });
  } else if (wasRead(outcomes, "ka_masterplan")) {
    out.push({
      code: "ka_zone_unpublished",
      kind: "zoning",
      layerKey: "ka_masterplan",
      featureId: null,
      title: "Inside BDA's planning area — RMP 2015 applies",
      status: "Zoning not published as a map layer",
      distanceM: 0,
      direction: null,
      meaning:
        "Bengaluru's own master plan is the Revised Master Plan 2015, in force since 2007 and published only as scanned planning-district sheets. RMP 2041 was notified in April 2026 and has no map yet. The zoning for this survey number has to be read from the sheet or confirmed by a BDA zonal certificate.",
      source: "Bangalore Development Authority — RMP 2015 (in force), RMP 2041 (notified 7 April 2026)",
    });
  }
  const near = hitsFor(outcomes, "ka_masterplan_near");
  const industrialNear = near.find((h) => classifyZone(str(h.attributes.Proposed_L)) === "industrial");
  if (industrialNear && classifyZone(str(containing?.attributes.Proposed_L)) !== "industrial") {
    out.push({
      code: "ka_industrial_near",
      kind: "zoning",
      layerKey: "ka_masterplan_near",
      featureId: null,
      title: "Land zoned industrial within about 400 m",
      status: "BMRDA master plan, proposed land use",
      distanceM: 400,
      direction: null,
      meaning:
        "Inside the 400 m box around the plot the master plan zones some land for industry. Adjacency brings heavy-vehicle traffic, effluent and noise, and it caps what a residential resale can fetch. The plan's polygons are too large to measure to on every check; the planning-district sheet shows the boundary.",
      source: sourceFor("ka_masterplan_near", outcomes),
    });
  }
  // What else the master plan puts within 400 m, so a buyer sees the mix.
  const uses = [...new Set(near.map((h) => str(h.attributes.Proposed_L)).filter((v): v is string => !!v))]
    .filter((u) => u !== (str(containing?.attributes.Proposed_L) ?? ""))
    .filter((u) => classifyZone(u) !== "transport" && classifyZone(u) !== "other");
  if (uses.length) {
    out.push({
      code: "ka_zone_mix",
      kind: "zoning",
      layerKey: "ka_masterplan_near",
      featureId: null,
      title: `Also zoned within 400 m: ${uses.slice(0, 5).join(", ")}${uses.length > 5 ? "…" : ""}`,
      status: "BMRDA master plan, proposed land use",
      distanceM: 400,
      direction: null,
      meaning:
        "The proposed uses the master plan places around this plot. A park or public reservation next door protects an outlook; a commercial strip changes the road; an industrial parcel changes the neighbourhood.",
      source: sourceFor("ka_masterplan_near", outcomes),
    });
  }
  return out;
}

function kaLulcInsights({ outcomes }: Ctx): AreaInsight[] {
  const at = hitsFor(outcomes, "ka_lulc").find((h) => h.contains);
  if (!at) return [];
  // "Built-up (Urban)" and "Built-up Urban" are one class written twice.
  const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const parts = [str(at.attributes.LULC_Desc_1), str(at.attributes.LULC_Desc_2), str(at.attributes.LULC_Desc_3)]
    .filter((v): v is string => !!v)
    .filter((v, i, arr) => arr.findIndex((w) => squash(w) === squash(v)) === i);
  return [
    {
      code: "ka_lulc",
      kind: "existing",
      layerKey: "ka_lulc",
      featureId: null,
      title: `On the ground in 2023: ${parts.join(" · ")}`,
      status: "State land-use survey, 2023",
      distanceM: 0,
      direction: null,
      meaning:
        "What the satellite survey saw at this spot, as against what the master plan proposes. A plot mapped as agricultural or wasteland is one the neighbourhood has not yet built up; one mapped as built-up already has, whatever its papers say.",
      source: sourceFor("ka_lulc", outcomes),
    },
  ];
}

const KIND_RANK: Record<AreaInsight["kind"], number> = {
  risk: 0,
  planned: 1,
  zoning: 2,
  existing: 3,
};

export function deriveInsights(
  point: LatLng,
  outcomes: LayerOutcome[],
  map?: AreaMap,
  state: StateKey = "TS",
): AreaInsight[] {
  const ctx: Ctx = { point, outcomes, map: map ?? buildAreaMap(point, outcomes, state), state };
  const all =
    state === "KA"
      ? [...kaWaterInsights(ctx), ...kaDrainInsights(ctx), ...kaZoneInsights(ctx), ...kaLulcInsights(ctx)]
      : [
    ...prohibitedInsights(ctx),
    ...waterInsights(ctx),
    ...nalaInsights(ctx),
    ...floodInsights(ctx),
    ...rrrInsights(ctx),
    ...industrialInsights(ctx),
    ...zoneInsights(ctx),
    ...metroInsights(ctx),
  ];
  return all.sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return k !== 0 ? k : a.distanceM - b.distanceM;
  });
}
