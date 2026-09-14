// Turning layer hits into the factors a buyer or owner can act on.
//
// Pure: no network, no clock. `deriveFactors` takes what the ArcGIS client
// returned and produces the list a person reads. Everything quantitative lives
// in the tables at the top so the domain assumptions are inspectable in one
// place rather than buried in branches.
//
// The impact bands are deliberately wide. A lake buffer does not cost a fixed
// percentage; it costs "a lot, and how much depends on the plot". Narrow bands
// would imply a precision this data cannot support, and the whole point of the
// product is to be honest about which way a factor pushes and roughly how hard.

import type { LayerOutcome } from "./arcgis";
import type {
  FactorConfidence,
  FactorSeverity,
  SiteFactor,
  SubjectKind,
} from "./types";
import { LAYER_BY_KEY } from "./layers";

/**
 * GO Ms No. 168 (MA&UD, 2012) sets the no-construction buffer around a water
 * body at 30 m from the full tank level for lakes above 10 hectares and 9 m
 * below that. We do not have the surveyed FTL line — only the water-body
 * polygon — so the polygon edge stands in for it. That makes a hit here a
 * reason to commission the FTL check, not a substitute for it, and every
 * message says so.
 */
const FTL_BUFFER_LARGE_M = 30;
const FTL_BUFFER_SMALL_M = 9;
const LARGE_WATER_BODY_SQM = 100_000;

/** Distances, in metres, at which each proximity factor stops applying. */
const NEAR = {
  waterCaution: 150,
  waterAmenity: 900,
  prohibitedAdjacent: 60,
  floodNear: 300,
  nalaNear: 60,
  rrrAcquisition: 150,
  rrrCorridorNear: 3_000,
  metroWalk: 700,
  metroShort: 1_500,
  industrialAdjacent: 400,
} as const;

function pct(low: number, high: number): { impactLowPct: number; impactHighPct: number } {
  return { impactLowPct: low, impactHighPct: high };
}

function hitsFor(outcomes: LayerOutcome[], key: string) {
  const outcome = outcomes.find((o) => o.key === key);
  return outcome?.ok ? outcome.hits : [];
}

function sourceFor(key: string, outcomes?: LayerOutcome[]): string {
  const base = LAYER_BY_KEY[key]?.source ?? "Telangana GIS";
  // Name the mirror on the evidence line when the answer came from it. Whoever
  // is deciding whether to trust a lake-buffer finding needs to know it was read
  // from a copy of some date rather than from the register today.
  const outcome = outcomes?.find((o) => o.key === key);
  const mirroredOn = outcome?.ok ? outcome.mirroredOn : undefined;
  return mirroredOn ? `${base} — local copy of ${mirroredOn}, live server unreachable` : base;
}

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

/**
 * Categories in the prohibited-land register that stop a registration outright,
 * as against ones that merely need a clearance. The register's own text is
 * free-form — "Govt Land", "Govt.Land ", "Sarkari" are three spellings of one
 * thing — so matching is on normalised substrings.
 */
const HARD_PROHIBITED = [
  "govt",
  "government",
  "sarkari",
  "assigned",
  "ceiling",
  "surplus",
  "bhoodan",
  "boodan",
  "poramboke",
  "shikam",
  "forest",
  "l.a. land",
  "land acq",
];
const CLEARANCE_PROHIBITED = ["endowment", "endwment", "wakf", "waqf", "court stay", "sez", "gairan"];

export function classifyProhibited(category: string | null): "hard" | "clearance" | "unknown" {
  if (!category) return "unknown";
  const c = category.toLowerCase();
  if (HARD_PROHIBITED.some((t) => c.includes(t))) return "hard";
  if (CLEARANCE_PROHIBITED.some((t) => c.includes(t))) return "clearance";
  return "unknown";
}

/** Encroachment wording in the water-body register, normalised to a flag. */
function isEncroached(status: string | null): boolean {
  return !!status && status.toLowerCase().includes("encroach");
}

export type DeriveInput = {
  outcomes: LayerOutcome[];
  kind: SubjectKind;
};

export type DeriveResult = {
  factors: SiteFactor[];
  gaps: { layer: string; reason: string }[];
  place: {
    village: string | null;
    mandal: string | null;
    district: string | null;
    withinHmda: boolean;
    withinOrr: boolean;
  };
};

export function factor(
  code: string,
  label: string,
  severity: FactorSeverity,
  direction: "uplift" | "drag",
  confidence: FactorConfidence,
  headline: string,
  detail: string,
  impact: { impactLowPct: number; impactHighPct: number },
  evidence: SiteFactor["evidence"],
): SiteFactor {
  return {
    code,
    label,
    severity,
    direction,
    confidence,
    headline,
    detail,
    ...impact,
    evidence,
  };
}

function waterFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "water_bodies");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const name = str(nearest.attributes.WB_Name) ?? "an unnamed tank";
  const areaSqm = num(nearest.attributes.Area);
  const status = str(nearest.attributes.WBS_2023);
  const buffer =
    areaSqm !== null && areaSqm >= LARGE_WATER_BODY_SQM ? FTL_BUFFER_LARGE_M : FTL_BUFFER_SMALL_M;
  const evidence = {
    source: sourceFor("water_bodies", outcomes),
    layer: LAYER_BY_KEY.water_bodies?.path,
    distanceM: nearest.distanceM,
    attributes: {
      water_body: name,
      status_2023: status,
      area_sqm: areaSqm,
    },
  };

  if (nearest.contains) {
    return [
      factor(
        "water_body_bed",
        "Inside a mapped water body",
        "critical",
        "drag",
        "observed",
        `This location falls inside ${name}, which the state's records map as a water body.`,
        "Construction inside a tank bed is not regularisable, and HYDRAA has demolished structures on this basis since 2024. Registration, building permission and bank finance are all at risk. Commission a surveyed full-tank-level (FTL) check before any payment.",
        pct(-65, -40),
        evidence,
      ),
    ];
  }

  if (nearest.distanceM <= buffer) {
    return [
      factor(
        "water_body_buffer",
        "Inside the lake buffer zone",
        "critical",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from ${name} — inside the ${buffer} m no-construction buffer that applies to a water body this size.`,
        `GO Ms No. 168 (MA&UD, 2012) prohibits construction within ${buffer} m of the full tank level for a water body of this extent. The distance here is measured to the mapped water-body boundary, not to a surveyed FTL line, so treat this as a strong reason to obtain the FTL and buffer certificate rather than as the certificate itself.`,
        pct(-40, -20),
        evidence,
      ),
    ];
  }

  if (nearest.distanceM <= NEAR.waterCaution) {
    const encroached = isEncroached(status);
    return [
      factor(
        "water_body_near",
        "Close to a water body",
        "caution",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from ${name}. Outside the statutory buffer on our measurement, but close enough that the surveyed line could fall differently.`,
        encroached
          ? `The register records this water body as encroached, which is the pattern that precedes an HYDRAA notice. Buyers in these pockets routinely face finance refusals even when the plot itself is clear. Get the FTL and buffer certificate.`
          : `Buffer distances are measured from a surveyed full tank level, which can sit tens of metres from the polygon boundary used here. Get the FTL and buffer certificate before committing.`,
        pct(-15, -5),
        evidence,
      ),
    ];
  }

  if (nearest.distanceM <= NEAR.waterAmenity && !isEncroached(status)) {
    return [
      factor(
        "water_body_amenity",
        "Near an intact water body",
        "info",
        "uplift",
        "inferred",
        `${metres(nearest.distanceM)} from ${name}, far enough to be an outlook rather than a restriction.`,
        "A live tank at this distance typically supports price rather than suppressing it, provided the plot itself is outside the buffer. The premium is modest and disappears if the water body is later reclassified.",
        pct(2, 6),
        evidence,
      ),
    ];
  }

  return [];
}

function prohibitedFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  // The layer queried here is the whole ULB cadastre, not a register of
  // prohibited parcels: every plot in a municipality is a row in it, and only
  // the ones carrying a category are actually listed under Section 22-A.
  // Treating containment alone as a hit would put a critical "cannot be
  // registered" warning on every ordinary plot in Hyderabad.
  const listed = hitsFor(outcomes, "prohibited_land").filter((h) =>
    str(h.attributes.CATEGORY_OF_PROHIBITORY_LAND),
  );
  if (listed.length === 0) return [];

  const containing = listed.find((h) => h.contains);
  const target = containing ?? listed[0];
  const category = str(target.attributes.CATEGORY_OF_PROHIBITORY_LAND);
  const survey = str(target.attributes.SY_NO) ?? str(target.attributes.Parcel_num);
  const evidence = {
    source: sourceFor("prohibited_land"),
    layer: LAYER_BY_KEY.prohibited_land?.path,
    distanceM: target.distanceM,
    attributes: {
      survey_no: survey,
      category: category,
      village: str(target.attributes.V_Name),
    },
  };

  if (!containing) {
    if (target.distanceM > NEAR.prohibitedAdjacent) return [];
    return [
      factor(
        "prohibited_adjacent",
        "Next to prohibited land",
        "caution",
        "drag",
        "observed",
        `A parcel ${metres(target.distanceM)} away is on the prohibited-property register${category ? ` as ${category.toLowerCase()}` : ""}.`,
        "The subject itself is not on the register, but an adjoining prohibited parcel is a common source of boundary encroachment claims and of stop-work notices that catch neighbours. Have the boundary physically demarcated against the village map.",
        pct(-10, -3),
        evidence,
      ),
    ];
  }

  const kind = classifyProhibited(category);
  if (kind === "clearance") {
    return [
      factor(
        "prohibited_clearance",
        "On the prohibited register",
        "critical",
        "drag",
        "observed",
        `This parcel is on the state's prohibited-property register${category ? ` as ${category.toLowerCase()}` : ""}, which blocks registration until it is cleared.`,
        "Endowment, wakf and court-stay entries can sometimes be released by the controlling authority, but the release — not an assurance that one is possible — is what makes the property transferable. Do not pay an advance against a promise to clear it.",
        pct(-55, -30),
        evidence,
      ),
    ];
  }

  if (kind === "unknown") {
    return [
      factor(
        "prohibited_unclassified",
        "On the prohibited register",
        "critical",
        "drag",
        "observed",
        `This parcel carries the register entry "${category}", which we cannot classify.`,
        "The register's category column is free text and this entry does not match a category we recognise. It may be a clerical note or a genuine bar. Ask the tahsildar's office what the entry refers to before treating the property as transferable.",
        pct(-60, -25),
        evidence,
      ),
    ];
  }

  return [
    factor(
      "prohibited_hard",
      "On the prohibited register",
      "critical",
      "drag",
      "observed",
      `This parcel is listed as prohibited property${category ? ` (${category.toLowerCase()})` : ""}. The sub-registrar cannot register a sale of it.`,
      "Section 22-A of the Registration Act bars registration of listed properties. Government, assigned, ceiling-surplus and bhoodan lands are not transferable by private sale at all, and money paid against one is very hard to recover. Verify the survey number on the Bhu Bharati prohibited list before anything else.",
      pct(-75, -45),
      evidence,
    ),
  ];
}

function floodFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "flooding");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const evidence = {
    source: sourceFor("flooding"),
    layer: LAYER_BY_KEY.flooding?.path,
    distanceM: nearest.distanceM,
  };
  if (nearest.contains) {
    return [
      factor(
        "flood_zone",
        "Inside a recorded flooding area",
        "caution",
        "drag",
        "observed",
        "This location sits inside an area the city's own records mark as flood-affected.",
        "Recorded inundation affects insurability, ground-floor usability and resale depth. It is not a legal restriction on construction, but buyers who know about it discount for it, and the ones who do not find out in the first heavy monsoon.",
        pct(-18, -8),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.floodNear) {
    return [
      factor(
        "flood_near",
        "Near a recorded flooding area",
        "info",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from an area recorded as flood-affected.`,
        "Being outside the mapped area is not the same as being on higher ground. Check the plot's level against the road and against the nearest drain before the monsoon, not after.",
        pct(-7, -2),
        evidence,
      ),
    ];
  }
  return [];
}

function nalaFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "nala_widening");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const proposed = num(nearest.attributes.Prop_Width);
  const name = str(nearest.attributes.Nala_Name);
  const evidence = {
    source: sourceFor("nala_widening"),
    layer: LAYER_BY_KEY.nala_widening?.path,
    distanceM: nearest.distanceM,
    attributes: { nala: name, proposed_width_m: proposed },
  };

  // The proposed width is the FULL widened channel, so the alignment can take
  // land up to half that width either side of the recorded centre line.
  const takeM = proposed !== null ? proposed / 2 : null;
  if (takeM !== null && nearest.distanceM <= takeM) {
    return [
      factor(
        "nala_widening_take",
        "In the path of drain widening",
        "critical",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from ${name ?? "a storm-water drain"} whose approved widening is ${proposed} m — the widened channel is likely to cross this location.`,
        "GHMC's nala widening programme acquires the strip inside the proposed width. Structures in it are removed and the land is not compensated at market rate. Confirm the alignment against the circle office's drawing before purchase.",
        pct(-45, -20),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.nalaNear) {
    return [
      factor(
        "nala_near",
        "Beside a storm-water drain",
        "caution",
        "drag",
        "observed",
        `${metres(nearest.distanceM)} from ${name ?? "a mapped storm-water drain"}${proposed !== null ? `, which is scheduled to be widened to ${proposed} m` : ""}.`,
        "Drain-adjacent plots carry a building-line setback, they are the first to flood, and the widening line moves as surveys are revised. The setback alone can cost a usable metre or two of frontage.",
        pct(-12, -4),
        evidence,
      ),
    ];
  }
  return [];
}

function rrrFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "rrr_alignment");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const evidence = {
    source: sourceFor("rrr_alignment"),
    layer: LAYER_BY_KEY.rrr_alignment?.path,
    distanceM: nearest.distanceM,
  };

  if (nearest.distanceM <= NEAR.rrrAcquisition) {
    return [
      factor(
        "rrr_acquisition",
        "On the Regional Ring Road alignment",
        "critical",
        "drag",
        "inferred",
        `${metres(nearest.distanceM)} from the published Regional Ring Road alignment — inside the corridor that is being acquired.`,
        "Land inside the alignment is acquired under the national highways process; the award is a statutory rate, not a negotiated one, and the timing is not in the owner's control. The alignment has been revised more than once, so confirm against the current notification for the village.",
        pct(-35, -15),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.rrrCorridorNear) {
    return [
      factor(
        "rrr_corridor",
        "In the Regional Ring Road corridor",
        "info",
        "uplift",
        "inferred",
        `${metres(nearest.distanceM)} from the Regional Ring Road alignment — close enough to benefit, far enough to avoid acquisition.`,
        "Land in the 0.5–3 km band around a new ring road is where the access premium lands: connectivity improves without the plot itself being taken. The premium is already partly priced in near notified interchanges, and it is speculative until construction actually starts.",
        pct(8, 25),
        evidence,
      ),
    ];
  }
  return [
    factor(
      "rrr_influence",
      "Within the Regional Ring Road influence zone",
      "info",
      "uplift",
      "inferred",
      `${metres(nearest.distanceM)} from the Regional Ring Road alignment.`,
      "Far enough that the effect on price is real but second-order — it shows up in how quickly the area develops rather than in today's rate.",
      pct(3, 8),
      evidence,
    ),
  ];
}

function metroFactors(outcomes: LayerOutcome[]): SiteFactor[] {
  const hits = hitsFor(outcomes, "metro_stations");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const name = str(nearest.attributes.Name) ?? "a metro station";
  const line = str(nearest.attributes.Line);
  const evidence = {
    source: sourceFor("metro_stations"),
    layer: LAYER_BY_KEY.metro_stations?.path,
    distanceM: nearest.distanceM,
    attributes: { station: name, line },
  };

  if (nearest.distanceM <= NEAR.metroWalk) {
    return [
      factor(
        "metro_walk",
        "Walking distance to metro",
        "info",
        "uplift",
        "observed",
        `${metres(nearest.distanceM)} from ${name} — a genuine walk-to-station location.`,
        "Walkability to a station is one of the few location premiums that survives a downturn, because it widens the tenant and buyer pool rather than depending on sentiment.",
        pct(10, 22),
        evidence,
      ),
    ];
  }
  if (nearest.distanceM <= NEAR.metroShort) {
    return [
      factor(
        "metro_near",
        "Short ride to metro",
        "info",
        "uplift",
        "observed",
        `${metres(nearest.distanceM)} from ${name}.`,
        "Close enough for a short auto or feeder ride. Worth a premium, but a much smaller one than a walkable plot in the same locality.",
        pct(4, 10),
        evidence,
      ),
    ];
  }
  return [
    factor(
      "metro_reachable",
      "Metro in the wider area",
      "info",
      "uplift",
      "observed",
      `${metres(nearest.distanceM)} from ${name}.`,
      "At this distance the station shapes the area's direction more than this particular plot's price.",
      pct(1, 4),
      evidence,
    ),
  ];
}

function industrialFactors(outcomes: LayerOutcome[], kind: SubjectKind): SiteFactor[] {
  const hits = hitsFor(outcomes, "industrial");
  if (hits.length === 0) return [];
  const nearest = hits[0];
  const residential = kind !== "agricultural_land";
  const evidence = {
    source: sourceFor("industrial"),
    layer: LAYER_BY_KEY.industrial?.path,
    distanceM: nearest.distanceM,
  };

  if (nearest.contains) {
    return [
      factor(
        "industrial_zone",
        "In an industrial land-use zone",
        residential ? "critical" : "caution",
        "drag",
        "observed",
        residential
          ? "The master plan puts this location in an industrial zone, where residential permission is not granted as of right."
          : "The master plan puts this location in an industrial zone.",
        residential
          ? "Building permission for a dwelling in a manufacturing zone requires a change of land use, which is a discretionary process with no guaranteed outcome. Plots here are routinely marketed as residential; the zoning is what the sanctioning authority reads."
          : "Industrial zoning raises value for industrial use and constrains every other use. Match the zoning to the intended use before buying.",
        residential ? pct(-35, -15) : pct(-8, 5),
        evidence,
      ),
    ];
  }
  if (residential && nearest.distanceM <= NEAR.industrialAdjacent) {
    return [
      factor(
        "industrial_adjacent",
        "Beside an industrial zone",
        "caution",
        "drag",
        "observed",
        `${metres(nearest.distanceM)} from land zoned for manufacturing.`,
        "Adjacency brings heavy-vehicle traffic, effluent and noise, and it caps the ceiling on what a residential resale can fetch however good the construction is.",
        pct(-15, -5),
        evidence,
      ),
    ];
  }
  return [];
}

function placeFrom(outcomes: LayerOutcome[]): DeriveResult["place"] {
  const cad = hitsFor(outcomes, "hmda_cadastral")[0];
  const zone = hitsFor(outcomes, "hmda_zone").find((h) => h.contains);
  const water = hitsFor(outcomes, "water_bodies")[0];
  return {
    village: str(cad?.attributes.Village) ?? str(water?.attributes.Village),
    mandal: str(cad?.attributes.Mandal) ?? str(water?.attributes.Mandal),
    district: str(cad?.attributes.District) ?? str(water?.attributes.District),
    withinHmda: !!zone || !!cad?.contains,
    withinOrr: hitsFor(outcomes, "water_bodies").length > 0 && !!water,
  };
}

const SEVERITY_RANK: Record<FactorSeverity, number> = { critical: 0, caution: 1, info: 2 };

export function sortFactors(factors: SiteFactor[]): SiteFactor[] {
  return [...factors].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const aMag = Math.max(Math.abs(a.impactLowPct), Math.abs(a.impactHighPct));
    const bMag = Math.max(Math.abs(b.impactLowPct), Math.abs(b.impactHighPct));
    return bMag - aMag;
  });
}

/**
 * A gap is read by whoever is deciding whether to trust the number, so it has
 * to say what was not checked in their language. The client's own `detail` —
 * "fetch failed", "HTTP 503" — is for the log, not the screen.
 */
export function gapReason(reason: Extract<LayerOutcome, { ok: false }>["reason"]): string {
  switch (reason) {
    case "timeout":
      return "The state GIS did not respond in time, so this was not checked.";
    case "http":
    case "server":
      return "The state GIS refused the request, so this was not checked.";
    default:
      return "The state GIS could not be reached, so this was not checked.";
  }
}

export function deriveFactors(input: DeriveInput): DeriveResult {
  const { outcomes, kind } = input;

  const factors = [
    ...prohibitedFactors(outcomes),
    ...waterFactors(outcomes),
    ...nalaFactors(outcomes),
    ...floodFactors(outcomes),
    ...industrialFactors(outcomes, kind),
    ...rrrFactors(outcomes),
    ...metroFactors(outcomes),
  ];

  const gaps = outcomes
    .filter((o): o is Extract<LayerOutcome, { ok: false }> => !o.ok)
    .map((o) => ({
      layer: LAYER_BY_KEY[o.key]?.label ?? o.key,
      reason: gapReason(o.reason),
    }));

  return { factors: sortFactors(factors), gaps, place: placeFrom(outcomes) };
}
