// Site intelligence — the factors around a location that move its value, and
// which a buyer or owner almost never knows to look for.
//
// Distinct from `src/lib/risk-flags.ts`, which reads the CASE (deed, khata,
// deviations) once a valuer has documents in hand. This module reads the
// GROUND: what the state's own GIS says about the point on the map, before any
// paperwork exists. The two meet in the report; they never share a code.

import type { LatLng } from "./geo/measure";
import type { ParcelRecord } from "./cadastre";
import type { StateKey } from "./states";

/** Which way a factor pushes the value. */
export type FactorDirection = "uplift" | "drag";

/**
 * How much attention the factor deserves. `critical` is reserved for the ones
 * that can make a property unsellable or unfinanceable (lake bed, prohibited
 * land, acquisition alignment) — not merely expensive.
 */
export type FactorSeverity = "info" | "caution" | "critical";

/**
 * Where the claim comes from. The distinction is load-bearing: `observed` means
 * a government layer put the subject inside or beside a mapped feature and we
 * can name the layer; `inferred` means we derived it from distance or an
 * attribute that is a proxy, not the thing itself; `declared` means the user
 * told us in a follow-up answer and nothing verified it.
 */
export type FactorConfidence = "observed" | "inferred" | "declared";

/** Provenance for a single factor, so every number on screen can be traced. */
export type FactorEvidence = {
  /** Human-readable origin, e.g. "Telangana GIS — HMDA/ORR water bodies". */
  source: string;
  /** Service + layer id actually queried, e.g. "TankInformationSystem/…/13". */
  layer?: string;
  /** Distance from the subject to the feature, metres. Null when containment. */
  distanceM?: number | null;
  /** The few attributes worth showing. Never the whole row. */
  attributes?: Record<string, string | number | null>;
};

/**
 * One thing that moves the value, expressed so a layperson can act on it.
 *
 * `impactLowPct`/`impactHighPct` are percentage adjustments to the base rate,
 * signed (drag is negative). A range, not a point, because the honest answer to
 * "how much does a lake buffer cost you" is a band — and showing a band is what
 * keeps this an estimate rather than a valuation.
 */
export type SiteFactor = {
  code: string;
  label: string;
  direction: FactorDirection;
  severity: FactorSeverity;
  confidence: FactorConfidence;
  /** One sentence, plain language, no jargon. This is what most users read. */
  headline: string;
  /** The why — regulation, order, or mechanism. Shown on expand. */
  detail: string;
  impactLowPct: number;
  impactHighPct: number;
  evidence: FactorEvidence;
};

/** A question we ask only because no public layer can answer it. */
export type FollowUpQuestion = {
  key: string;
  question: string;
  /** Why we are asking — shown inline; users answer more honestly when told. */
  because: string;
  kind: "choice" | "number" | "boolean";
  options?: { value: string; label: string }[];
  unit?: string;
  /** Asking is pointless unless the subject is one of these. */
  appliesTo?: SubjectKind[];
  required: boolean;
};

/** What is being valued. Drives both the questions and the rate basis. */
export const SUBJECT_KINDS = [
  "open_plot",
  "independent_house",
  "apartment",
  "agricultural_land",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = {
  open_plot: "Open plot",
  independent_house: "Independent house",
  apartment: "Flat / apartment",
  agricultural_land: "Agricultural land",
};

/** The subject as the estimator needs it. No PII — never an owner or door no. */
export type SiteSubject = {
  point: LatLng;
  kind: SubjectKind;
  /** Land or built-up extent, in `areaUnit`. */
  area: number;
  areaUnit: string;
  /** Answers to `FollowUpQuestion`s, keyed by question key. */
  answers: Record<string, string | number | boolean>;
  /** Set when the subject was chosen by survey number rather than by pin. */
  surveyNo?: string | null;
};

/** The rate the estimate is anchored to, and where it came from. */
export type RateAnchor = {
  /** Rupees per sq yard (land) or per sq ft (built-up). */
  ratePerUnit: number;
  unit: "sqyd" | "sqft";
  basis: "guidance" | "guidance_multiplied" | "user";
  /** Locality the rate was matched to, for display and for auditing a mismatch. */
  locality: string | null;
  /**
   * Market-to-guidance multiplier applied to a guidance rate. Guidance (circle)
   * rates in Telangana sit below traded prices by a margin that varies by
   * locality, so a raw guidance rate is a floor, not an estimate.
   */
  marketMultiple: number;
  note: string;
};

/** The finished estimate: a band, the factors that produced it, and the maths. */
export type SiteEstimate = {
  anchor: RateAnchor;
  /** Effective rate after factors, per `anchor.unit`. */
  adjustedRateLow: number;
  adjustedRateHigh: number;
  /** Total value band, rupees. */
  valueLow: number;
  valueHigh: number;
  /** Area normalised to the anchor's unit. */
  quantity: number;
  quantityUnit: "sqyd" | "sqft";
  /** Sum of factor adjustments actually applied, for the breakdown bar. */
  totalUpliftPct: number;
  totalDragPct: number;
};

/** How an overlay is drawn and which legend entry it belongs to. */
export type AreaFeatureKind =
  | "water"
  | "flood"
  | "nala"
  | "rrr"
  | "metro"
  | "industrial"
  | "prohibited"
  | "hmda_zone"
  /** A master-plan land-use polygon that is not industrial; labelled by its zone. */
  | "landuse";

/**
 * One mapped feature near the subject, in degrees, ready to be drawn on the
 * same sketch as the survey boundaries. Polygons carry `rings`, lines `paths`,
 * stations a single `point`. Exactly one is set.
 */
export type AreaFeature = {
  id: string;
  kind: AreaFeatureKind;
  layerKey: string;
  /** Short name for a hover or a label — the lake's name, the station's. */
  name: string | null;
  distanceM: number;
  contains: boolean;
  rings?: [number, number][][];
  paths?: [number, number][][];
  point?: [number, number];
};

/** The neighbourhood as the state's layers draw it, for the area view. */
export type AreaMap = {
  centre: LatLng;
  features: AreaFeature[];
  /** Layer keys that were read and simply had nothing near the plot. */
  emptyLayers: string[];
  /** Layer keys that could not be read; their absence on the map means nothing. */
  unreadLayers: string[];
};

/**
 * What kind of thing an insight describes. `planned` is the master-plan
 * material — an alignment, a widening, a station that is coming — and is
 * listed first because it is the part a buyer cannot see from the road.
 */
export type InsightKind = "planned" | "zoning" | "risk" | "existing";

/**
 * One thing around the plot worth knowing, told as a person would tell it:
 * what it is, how far, which way, and what it means for this land. Unlike a
 * `SiteFactor` it carries no percentage — some of these move the value, some
 * only explain the neighbourhood, and the honest list has both.
 */
export type AreaInsight = {
  code: string;
  kind: InsightKind;
  layerKey: string;
  /** Matches the feature drawn on the area map, when one is. */
  featureId: string | null;
  title: string;
  /** "Proposed", "Approved widening", "Recorded 2023" — the feature's own state. */
  status: string;
  distanceM: number;
  /** Compass direction from the plot, null when the plot is inside it. */
  direction: string | null;
  /** One or two sentences: what this means for the land. */
  meaning: string;
  source: string;
};

/** Everything one lookup produces. */
export type SiteIntelReport = {
  subject: SiteSubject;
  /** Where the point resolved to, as the state's own layers name it. */
  place: {
    village: string | null;
    mandal: string | null;
    district: string | null;
    withinHmda: boolean;
    withinOrr: boolean;
  };
  /**
   * The cadastral parcel the subject resolved to, when one did. Null means the
   * lookup was a bare pin, or the point falls outside the published cadastre.
   */
  parcel: ParcelRecord | null;
  /** Which state's layers were read. */
  state: StateKey;
  factors: SiteFactor[];
  /** The surroundings as drawn by the state's layers, for the area view. */
  areaMap: AreaMap;
  /** The surroundings as told: what is there, what is coming, what it means. */
  insights: AreaInsight[];
  /** Questions still worth asking, given what the layers already answered. */
  outstandingQuestions: FollowUpQuestion[];
  estimate: SiteEstimate | null;
  /** How much weight the band deserves, and why. */
  confidence: { level: "indicative" | "moderate" | "low"; reason: string } | null;
  /** Layers that failed or were skipped — surfaced, never silently dropped. */
  gaps: { layer: string; reason: string }[];
  generatedAt: string;
};
