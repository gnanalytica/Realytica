
import {
  KAVERI_CAPTURED_ON,
  KAVERI_FLATS_CAPTURED_ON,
  kaveriFlatRateFor,
  kaveriRateFor,
  kaveriVillagesFor,
} from "./karnataka/rates";
import type { StateKey } from "./states";

// The rate the estimate is anchored to.
//
// Telangana publishes a guidance (circle) rate for every locality on the IGRS
// portal. It is the statutory minimum for stamp duty, not a market price, and it
// sits below traded prices by a margin that varies by locality — so a raw
// guidance rate is a floor, and an estimate built on it without a multiplier
// reads absurdly low to anyone who knows the area.
//
// Two honesty constraints shape this module:
//
//   1. The table below is a SNAPSHOT, hand-entered, not a live feed. The IGRS
//      portal drives its district -> mandal -> village cascade over AJAX behind
//      a session, so there is no stable URL to read a rate from. The snapshot
//      date travels with every anchor and the UI shows it, because a stale
//      statutory rate presented as current is exactly the kind of confident-and-
//      wrong this product exists to prevent.
//   2. Anything the user knows beats anything we guessed. A supplied rate wins
//      outright and is labelled as theirs.
//
// Replacing the snapshot with a live sync means implementing a fetch behind
// `lookupGuidance`; nothing else in the module changes.

import type { RateAnchor, SubjectKind } from "./types";
import captured from "./igrs-rates.json";
import { districtFamily, normaliseDistrict } from "./rate-coverage";

/**
 * The captured IGRS table — the published statutory rate for every village the
 * portal lists, from `pnpm capture:igrs`.
 *
 * It supersedes the hand-entered snapshot below, which stays only as a fallback
 * for anything the capture has not reached. Hand-entering was not merely
 * incomplete: it carried Gachibowli at Rs 32,000/sq yd against a published
 * Rs 40,100. Read the source, do not estimate it.
 */
type CapturedEntry = {
  district: string;
  mandal: string;
  village: string;
  landPerSqYd: number;
  builtPerSqft: number;
  effectiveFrom: string | null;
};

const CAPTURED = (captured as { capturedOn?: string; entries?: CapturedEntry[] }).entries ?? [];
export const IGRS_CAPTURED_ON = (captured as { capturedOn?: string }).capturedOn ?? null;

/** village -> entries, so a lookup is a map hit rather than a scan of 25k rows. */
const CAPTURED_BY_VILLAGE = new Map<string, CapturedEntry[]>();
const CAPTURED_BY_MANDAL = new Map<string, CapturedEntry[]>();
for (const e of CAPTURED) {
  const v = norm(e.village);
  const m = norm(e.mandal);
  if (v) CAPTURED_BY_VILLAGE.set(v, [...(CAPTURED_BY_VILLAGE.get(v) ?? []), e]);
  if (m) CAPTURED_BY_MANDAL.set(m, [...(CAPTURED_BY_MANDAL.get(m) ?? []), e]);
}

/**
 * How far traded prices run above the statutory rate. IGRS publishes the
 * statutory figure only, so the multiple stays ours — and it is the largest
 * single unknown in the estimate, which is why the band carries a spread and
 * why a rate the user supplies always wins.
 */
function multipleFor(district: string): number {
  const family = districtFamily(district);
  if (family === "hyderabad") return 2.3;
  if (family === "ranga reddy") return 2.1;
  if (family === "medak" || family === "nalgonda") return 1.8;
  return 1.7;
}

function fromCaptured(place: RateLookup): ResolvedRate | null {
  const family = districtFamily(place.district);
  const mandal = norm(place.mandal);
  const sameFamily = (e: CapturedEntry) => !family || districtFamily(e.district) === family;

  // District family alone is not tight enough at village level: an
  // "Anantharam" in Khammam/Manuguru matched a different Anantharam in
  // Bhadradri Kothagudem/Aswaraopeta — same pre-2016 parent, sixty kilometres
  // apart, and a rate that belongs to neither.
  //
  // The problem is AMBIGUITY, not the mandal. When one village of that name
  // exists in the family, it is the one meant, and requiring the mandal to
  // agree as well would throw the match away — the two sources spell mandals
  // differently often enough that strict matching cost Adilabad its entire
  // captured coverage. When several exist, the mandal is what tells them apart,
  // and without agreement there is no honest way to choose.
  const candidates = (CAPTURED_BY_VILLAGE.get(norm(place.village)) ?? []).filter(sameFamily);
  const byVillage =
    candidates.length <= 1
      ? candidates
      : candidates.filter((e) => mandal && norm(e.mandal) === mandal);
  const byMandal = (CAPTURED_BY_MANDAL.get(mandal) ?? []).filter(sameFamily);
  const hit = byVillage[0] ?? byMandal[0];
  if (!hit) return null;

  return {
    entry: {
      locality: hit.village,
      mandal: hit.mandal,
      district: hit.district,
      landPerSqYd: hit.landPerSqYd,
      builtPerSqft: hit.builtPerSqft,
      marketMultiple: multipleFor(hit.district),
      effectiveFrom: hit.effectiveFrom,
    },
    matchedOn: byVillage[0] ? "village" : "mandal",
  };
}

/** When the figures below were last reviewed against the IGRS portal. */
export const RATE_SNAPSHOT_ON = "2026-08-25";

export type GuidanceEntry = {
  locality: string;
  mandal: string | null;
  district: string;
  /** Statutory land rate, rupees per square yard. */
  landPerSqYd: number;
  /** Statutory built rate, rupees per square foot of built-up area. */
  builtPerSqft: number;
  /**
   * How far traded prices run above the statutory rate here. Central and
   * high-demand localities carry the widest gap; statutory rates in the outer
   * mandals track the market much more closely.
   */
  marketMultiple: number;
  /**
   * The date the state says this rate takes effect, when it came from the
   * captured IGRS table. Absent on hand-entered rows, which have no published
   * date of their own — and the difference matters, because a rate shown with
   * somebody's data-entry date beside it invites more trust than it has earned.
   */
  effectiveFrom?: string | null;
};

/**
 * Representative localities across the Hyderabad metropolitan region. Coverage
 * is deliberately broad rather than deep — the resolver falls back from village
 * to mandal to district, so an unlisted village still anchors to something
 * defensible instead of failing.
 */
export const GUIDANCE_SNAPSHOT: GuidanceEntry[] = [
  { locality: "Jubilee Hills", mandal: "Shaikpet", district: "Hyderabad", landPerSqYd: 48000, builtPerSqft: 7800, marketMultiple: 2.6 },
  { locality: "Banjara Hills", mandal: "Khairatabad", district: "Hyderabad", landPerSqYd: 45000, builtPerSqft: 7400, marketMultiple: 2.6 },
  { locality: "Kokapet", mandal: "Rajendranagar", district: "Ranga Reddy", landPerSqYd: 30000, builtPerSqft: 5600, marketMultiple: 2.4 },
  { locality: "Narsingi", mandal: "Rajendranagar", district: "Ranga Reddy", landPerSqYd: 24000, builtPerSqft: 5000, marketMultiple: 2.3 },
  { locality: "Manikonda", mandal: "Rajendranagar", district: "Ranga Reddy", landPerSqYd: 26000, builtPerSqft: 5200, marketMultiple: 2.2 },
  { locality: "Gachibowli", mandal: "Serilingampally", district: "Ranga Reddy", landPerSqYd: 32000, builtPerSqft: 6000, marketMultiple: 2.4 },
  { locality: "Nanakramguda", mandal: "Serilingampally", district: "Ranga Reddy", landPerSqYd: 30000, builtPerSqft: 5800, marketMultiple: 2.4 },
  { locality: "Kondapur", mandal: "Serilingampally", district: "Ranga Reddy", landPerSqYd: 28000, builtPerSqft: 5400, marketMultiple: 2.2 },
  { locality: "Madhapur", mandal: "Serilingampally", district: "Ranga Reddy", landPerSqYd: 34000, builtPerSqft: 6200, marketMultiple: 2.3 },
  { locality: "Miyapur", mandal: "Serilingampally", district: "Ranga Reddy", landPerSqYd: 18000, builtPerSqft: 4200, marketMultiple: 2.1 },
  { locality: "Kukatpally", mandal: "Kukatpally", district: "Medchal Malkajgiri", landPerSqYd: 20000, builtPerSqft: 4600, marketMultiple: 2.1 },
  { locality: "Bachupally", mandal: "Quthbullapur", district: "Medchal Malkajgiri", landPerSqYd: 14000, builtPerSqft: 3800, marketMultiple: 2.0 },
  { locality: "Kompally", mandal: "Quthbullapur", district: "Medchal Malkajgiri", landPerSqYd: 13000, builtPerSqft: 3600, marketMultiple: 2.0 },
  { locality: "Shamirpet", mandal: "Shamirpet", district: "Medchal Malkajgiri", landPerSqYd: 7000, builtPerSqft: 2800, marketMultiple: 1.9 },
  { locality: "Uppal", mandal: "Uppal", district: "Medchal Malkajgiri", landPerSqYd: 15000, builtPerSqft: 3900, marketMultiple: 2.0 },
  { locality: "Ghatkesar", mandal: "Ghatkesar", district: "Medchal Malkajgiri", landPerSqYd: 8000, builtPerSqft: 2900, marketMultiple: 1.9 },
  { locality: "LB Nagar", mandal: "Hayathnagar", district: "Ranga Reddy", landPerSqYd: 16000, builtPerSqft: 4000, marketMultiple: 2.0 },
  { locality: "Hayathnagar", mandal: "Hayathnagar", district: "Ranga Reddy", landPerSqYd: 9000, builtPerSqft: 3000, marketMultiple: 1.9 },
  { locality: "Ibrahimpatnam", mandal: "Ibrahimpatnam", district: "Ranga Reddy", landPerSqYd: 5500, builtPerSqft: 2500, marketMultiple: 1.8 },
  { locality: "Adibatla", mandal: "Ibrahimpatnam", district: "Ranga Reddy", landPerSqYd: 9500, builtPerSqft: 3100, marketMultiple: 2.1 },
  { locality: "Shamshabad", mandal: "Shamshabad", district: "Ranga Reddy", landPerSqYd: 11000, builtPerSqft: 3300, marketMultiple: 2.0 },
  { locality: "Shadnagar", mandal: "Farooqnagar", district: "Ranga Reddy", landPerSqYd: 4000, builtPerSqft: 2200, marketMultiple: 1.8 },
  { locality: "Maheshwaram", mandal: "Maheshwaram", district: "Ranga Reddy", landPerSqYd: 6000, builtPerSqft: 2500, marketMultiple: 1.9 },
  { locality: "Shankarpally", mandal: "Shankarpalle", district: "Ranga Reddy", landPerSqYd: 6500, builtPerSqft: 2600, marketMultiple: 1.9 },
  { locality: "Chevella", mandal: "Chevella", district: "Ranga Reddy", landPerSqYd: 3500, builtPerSqft: 2100, marketMultiple: 1.8 },
  { locality: "Moinabad", mandal: "Moinabad", district: "Ranga Reddy", landPerSqYd: 5000, builtPerSqft: 2300, marketMultiple: 1.9 },
  { locality: "Patancheru", mandal: "Patancheruvu", district: "Sangareddy", landPerSqYd: 9000, builtPerSqft: 3000, marketMultiple: 1.9 },
  { locality: "Sangareddy", mandal: "Sangareddy", district: "Sangareddy", landPerSqYd: 5500, builtPerSqft: 2400, marketMultiple: 1.8 },
  { locality: "Medchal", mandal: "Medchal", district: "Medchal Malkajgiri", landPerSqYd: 8500, builtPerSqft: 2900, marketMultiple: 1.9 },
  { locality: "Toopran", mandal: "Toopran", district: "Medak", landPerSqYd: 3200, builtPerSqft: 2000, marketMultiple: 1.8 },
  { locality: "Choutuppal", mandal: "Choutuppal", district: "Yadadri", landPerSqYd: 3000, builtPerSqft: 2000, marketMultiple: 1.8 },
  { locality: "Bhuvanagiri", mandal: "Bhongir", district: "Yadadri", landPerSqYd: 3800, builtPerSqft: 2100, marketMultiple: 1.8 },
  { locality: "Secunderabad", mandal: "Secunderabad", district: "Hyderabad", landPerSqYd: 28000, builtPerSqft: 5200, marketMultiple: 2.2 },
  { locality: "Begumpet", mandal: "Secunderabad", district: "Hyderabad", landPerSqYd: 30000, builtPerSqft: 5600, marketMultiple: 2.3 },
  { locality: "Amberpet", mandal: "Amberpet", district: "Hyderabad", landPerSqYd: 18000, builtPerSqft: 4200, marketMultiple: 2.0 },
  { locality: "Khairatabad", mandal: "Khairatabad", district: "Hyderabad", landPerSqYd: 32000, builtPerSqft: 5800, marketMultiple: 2.3 },
];

/**
 * Fallbacks by district for a point whose village and mandal are both unlisted.
 * Coarse by design — a district-level anchor says so in its note and the UI asks
 * the user for a local rate.
 */
const DISTRICT_FALLBACK: Record<string, Omit<GuidanceEntry, "locality" | "mandal" | "district">> = {
  hyderabad: { landPerSqYd: 25000, builtPerSqft: 5000, marketMultiple: 2.2 },
  "ranga reddy": { landPerSqYd: 12000, builtPerSqft: 3400, marketMultiple: 2.0 },
  "medchal malkajgiri": { landPerSqYd: 12000, builtPerSqft: 3400, marketMultiple: 2.0 },
  sangareddy: { landPerSqYd: 6000, builtPerSqft: 2500, marketMultiple: 1.8 },
  medak: { landPerSqYd: 3500, builtPerSqft: 2000, marketMultiple: 1.8 },
  yadadri: { landPerSqYd: 3200, builtPerSqft: 2000, marketMultiple: 1.8 },
  nalgonda: { landPerSqYd: 2800, builtPerSqft: 1900, marketMultiple: 1.7 },
};

/**
 * Agricultural land trades far below the plot rate for the same village because
 * it cannot be built on until it is converted. Applied to the land rate rather
 * than carried as a separate factor, so it never double-counts with zoning.
 */
const AGRICULTURAL_DISCOUNT = 0.12;

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export type RateLookup = {
  village: string | null;
  mandal: string | null;
  district: string | null;
  /** Telangana rates come from IGRS; Karnataka's from Kaveri, keyed on the K-GIS village code. */
  state?: StateKey;
  villageCode?: string | null;
  /** Karnataka: the revenue hobli, which Kaveri sometimes folds into the village name. */
  hobli?: string | null;
};

export type ResolvedRate = {
  entry: GuidanceEntry | null;
  matchedOn: "village" | "mandal" | "district" | "none";
};

/**
 * Resolve a place to a rate, village first, then mandal, then the district
 * average.
 *
 * **The district must match at every step.** Telangana village names repeat
 * relentlessly — there is a Kondapur in Ranga Reddy, Siddipet, Narayanpet,
 * Mahabubnagar and Jogulamba Gadwal, and a Madhapur in both Ranga Reddy and
 * Karimnagar. Matching on the name alone priced a farming village in Karimnagar
 * at Rs 34,000/sq yd, the HITEC City rate, roughly twenty times over. A wrong
 * number delivered confidently is the one failure this product cannot afford,
 * so a name that matches in the wrong district is treated as no match at all.
 *
 * The district names in the snapshot are the current ones; the cadastre's
 * municipal layer still uses pre-2016 districts, so `DISTRICT_ALIASES` bridges
 * the two vintages rather than letting a rename read as a different place.
 */
export function lookupGuidance(place: RateLookup): ResolvedRate {
  // A Karnataka village that happens to share a name with a Telangana one
  // must not borrow its rate. The family test below passes everything when
  // the district is unknown to it, so the state is checked first.
  if (place.state && place.state !== "TS") return { entry: null, matchedOn: "none" };

  // The captured statutory table first — it is the published source. The
  // hand-entered snapshot below is only a fallback for what capture has not
  // reached, and is known to disagree with the portal where they overlap.
  const live = fromCaptured(place);
  if (live) return live;

  const village = norm(place.village);
  const mandal = norm(place.mandal);
  const district = normaliseDistrict(place.district);

  // Matched on the pre-2016 parent district, not the printed name — see
  // DISTRICT_FAMILY for why equality is the wrong test here.
  const family = districtFamily(place.district);
  const sameDistrict = (e: GuidanceEntry) => !family || districtFamily(e.district) === family;

  if (village) {
    const hit = GUIDANCE_SNAPSHOT.find((e) => norm(e.locality) === village && sameDistrict(e));
    if (hit) return { entry: hit, matchedOn: "village" };
  }
  if (mandal) {
    const hit = GUIDANCE_SNAPSHOT.find((e) => norm(e.mandal) === mandal && sameDistrict(e));
    if (hit) return { entry: hit, matchedOn: "mandal" };
  }
  if (district) {
    const fallback = DISTRICT_FALLBACK[district];
    if (fallback) {
      return {
        entry: {
          locality: place.district ?? "District average",
          mandal: null,
          district: place.district ?? "",
          ...fallback,
        },
        matchedOn: "district",
      };
    }
  }
  return { entry: null, matchedOn: "none" };
}

/**
 * The anchor an estimate is built on. A rate the user supplies always wins,
 * because it is the only input here that reflects an actual transaction.
 */
export function resolveRate(
  place: RateLookup,
  kind: SubjectKind,
  userRatePerUnit?: number | null,
  /** Karnataka only: the road the owner named, whose own Kaveri value then applies. */
  roadName?: string | null,
): RateAnchor | null {
  const unit: "sqyd" | "sqft" = kind === "apartment" ? "sqft" : "sqyd";

  if (userRatePerUnit && userRatePerUnit > 0) {
    return {
      ratePerUnit: userRatePerUnit,
      unit,
      basis: "user",
      locality: place.village ?? place.mandal ?? place.district,
      marketMultiple: 1,
      note: "Using the going rate you supplied. The factors below adjust it up or down.",
    };
  }

  if (place.state === "KA") return resolveKaveri(place, kind, unit, roadName);

  const { entry, matchedOn } = lookupGuidance(place);
  if (!entry) return null;

  const base = unit === "sqft" ? entry.builtPerSqft : entry.landPerSqYd;
  const adjusted = kind === "agricultural_land" ? base * AGRICULTURAL_DISCOUNT : base;
  const marketRate = Math.round(adjusted * entry.marketMultiple);

  const matchNote =
    matchedOn === "village"
      ? `Statutory rate for ${entry.locality}`
      : matchedOn === "mandal"
        ? `Statutory rate for ${entry.mandal} mandal — no separate rate listed for this village`
        : `District average for ${entry.district} — no local rate listed, so treat this as coarse`;

  return {
    ratePerUnit: marketRate,
    unit,
    basis: "guidance_multiplied",
    locality: entry.locality,
    marketMultiple: entry.marketMultiple,
    // The date has to be the rate's OWN date. A published rate carries the
    // effective date the state gave it; a hand-entered one carries only when
    // somebody typed it, and saying "snapshot of <today>" over a hand-entered
    // guess claims a currency it does not have. Boduppal was the case in point:
    // the guess said Rs 15,200/sq yd against a published Rs 22,100 effective
    // 05/06/2026, and printed a fresher-looking date than the real figure.
    note:
      `${matchNote}, uplifted ${entry.marketMultiple}x to a traded level. ` +
      `Statutory rates are a stamp-duty floor, not a market price. ` +
      (entry.effectiveFrom
        ? `Published by IGRS with effect from ${entry.effectiveFrom}.`
        : `Hand-entered reference figure, not read from the portal — confirm it on IGRS before relying on it.`),
  };
}

/**
 * A Karnataka anchor from the Kaveri capture. Kaveri prices vacant land per
 * road, agricultural land per acre, and named apartment complexes per sq m
 * of built-up area.
 */
function resolveKaveri(
  place: RateLookup,
  kind: SubjectKind,
  unit: "sqyd" | "sqft",
  roadName?: string | null,
): RateAnchor | null {
  if (!place.villageCode || !place.village) return null;
  const villages = kaveriVillagesFor(place.villageCode, place.village, place.hobli);

  if (unit === "sqft") {
    const flat = kaveriFlatRateFor(villages, roadName);
    if (!flat) return null;
    const basisNote =
      flat.basis === "apartment"
        ? `Kaveri flat value for ${flat.locality}`
        : flat.basis === "village_apartments"
          ? `Median of the ${flat.apartmentCount} apartment complexes Kaveri prices in ${flat.locality} — name yours above and its own value applies`
          : `No apartment complex is priced separately in ${flat.locality}, so the vacant-land value stands in for built-up area, as the sub-registrar applies it`;
    return {
      ratePerUnit: Math.round(flat.builtPerSqft * flat.marketMultiple),
      unit,
      basis: "guidance_multiplied",
      locality: flat.locality,
      marketMultiple: flat.marketMultiple,
      note: `${basisNote}, ₹${Math.round(flat.perSqM).toLocaleString("en-IN")}/sq m as published, read on ${KAVERI_FLATS_CAPTURED_ON ?? KAVERI_CAPTURED_ON}. Uplifted ×${flat.marketMultiple} to a traded level, which is an assumption for the Bengaluru region rather than a measured gap.`,
    };
  }

  const rate = kaveriRateFor(villages, roadName);
  if (!rate) return null;

  const base =
    kind === "agricultural_land"
      ? (rate.agriPerSqYd ?? rate.landPerSqYd * AGRICULTURAL_DISCOUNT)
      : rate.landPerSqYd;
  const marketRate = Math.round(base * rate.marketMultiple);
  const agriNote =
    kind === "agricultural_land"
      ? rate.agriPerSqYd
        ? " Agricultural value per acre, converted to sq yd."
        : " No agricultural value listed, so the vacant-land value is discounted to a farmland level."
      : "";
  const basisNote =
    rate.basis === "road"
      ? `Kaveri guidance value for ${rate.locality}`
      : rate.basis === "village_other_roads"
        ? `Kaveri guidance value for unnamed roads in ${rate.locality} — name the road above and its own value applies (${rate.roadCount} roads listed)`
        : `Median of the ${rate.roadCount} road values Kaveri lists for ${rate.locality} — name the road above and its own value applies`;

  return {
    ratePerUnit: marketRate,
    unit,
    basis: "guidance_multiplied",
    locality: rate.locality,
    marketMultiple: rate.marketMultiple,
    note: `${basisNote}, ₹${Math.round(rate.landPerSqM).toLocaleString("en-IN")}/sq m as published, read on ${KAVERI_CAPTURED_ON}. Uplifted ×${rate.marketMultiple} to a traded level, which is an assumption for the Bengaluru region rather than a measured gap.${agriNote}`,
  };
}
