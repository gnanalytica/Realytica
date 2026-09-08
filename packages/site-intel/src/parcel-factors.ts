// What the parcel record itself says, before any surrounding layer is read.
//
// A pin dropped near a survey number tells you about the neighbourhood. The
// parcel row tells you about the plot: whether it is on the Section 22-A
// prohibited register, how the revenue records classify it, and how big the
// surveyed boundary actually is. The last one matters more than people expect
// — a deed that says 300 sq yd against a survey boundary that measures 240 is
// the single most common way a plot turns out not to be what was sold.

import {
  classifyProhibited,
  factor,
} from "./factors";
import { KGIS_SOURCE } from "./karnataka/source";
import { CADASTRE_BY_KEY, type ParcelRecord } from "./cadastre";
import { convertArea } from "./area";
import type { SiteFactor } from "./types";

/**
 * How far the claimed extent may differ from the surveyed boundary before it
 * is worth raising. Cadastral polygons are digitised from paper maps, so a few
 * percent is noise; a fifth is a discrepancy someone should reconcile before
 * paying.
 */
const EXTENT_TOLERANCE = 0.2;

/** Classifications that mean the land is not private freehold, whatever the deed says. */
const NON_PRIVATE_CLASSIFICATIONS = [
  "poramboke",
  "government",
  "govt",
  "forest",
  "assigned",
  "inam",
  "shikam",
  "kunta",
  "tank",
  "burial",
  "khabar",
];

/** Provenance for a parcel row, whichever state's map it came from. */
function provenance(parcel: ParcelRecord): { source: string; layer: string | undefined } {
  if (parcel.source === "kgis") return { source: KGIS_SOURCE, layer: "geomForSurveyNum" };
  return { source: CADASTRE_BY_KEY[parcel.source].source, layer: CADASTRE_BY_KEY[parcel.source].path };
}

function evidenceFor(parcel: ParcelRecord) {
  return {
    ...provenance(parcel),
    distanceM: 0,
    attributes: {
      survey_no: parcel.parcelNo,
      village: parcel.village,
      classification: parcel.classification,
    },
  };
}

/**
 * Factors that come from the parcel row. Confidence is `observed` throughout —
 * unlike a proximity factor, there is no distance being interpreted here: the
 * register either names this survey number or it does not.
 */
export function parcelFactors(parcel: ParcelRecord): SiteFactor[] {
  const out: SiteFactor[] = [];
  const evidence = evidenceFor(parcel);

  if (parcel.prohibitedCategory) {
    const severity = classifyProhibited(parcel.prohibitedCategory);
    if (severity === "hard") {
      out.push(
        factor(
          "parcel_prohibited_hard",
          "This survey number is on the prohibited register",
          "critical",
          "drag",
          "observed",
          `Survey no ${parcel.parcelNo} is listed under Section 22-A as "${parcel.prohibitedCategory}".`,
          "A survey number on the Section 22-A register cannot be registered by the sub-registrar. The listing may be an error, or may cover only part of the survey number, but until it is removed by the collector no sale deed will be executed on it. Verify the entry against the district's own 22-A list before any payment.",
          { impactLowPct: -80, impactHighPct: -50 },
          evidence,
        ),
      );
    } else if (severity === "clearance") {
      out.push(
        factor(
          "parcel_prohibited_clearance",
          "Registration needs a clearance",
          "critical",
          "drag",
          "observed",
          `Survey no ${parcel.parcelNo} is listed as "${parcel.prohibitedCategory}", which registration treats as encumbered.`,
          "Endowment, wakf and court-stay entries do not always bar a sale outright, but they put the transaction behind a clearance from the relevant board or a vacation of the stay. Both take months and neither is certain.",
          { impactLowPct: -60, impactHighPct: -30 },
          evidence,
        ),
      );
    } else {
      out.push(
        factor(
          "parcel_prohibited_unknown",
          "Listed on the prohibited register",
          "critical",
          "drag",
          "observed",
          `Survey no ${parcel.parcelNo} carries the entry "${parcel.prohibitedCategory}" on the Section 22-A register.`,
          "The register's category wording is free text and this entry does not match a category we can classify. Treat it as blocking until the tahsildar's office explains it.",
          { impactLowPct: -60, impactHighPct: -25 },
          evidence,
        ),
      );
    }
  }

  const classification = (parcel.classification ?? "").toLowerCase();
  if (classification && NON_PRIVATE_CLASSIFICATIONS.some((t) => classification.includes(t))) {
    out.push(
      factor(
        "parcel_classification_public",
        "Revenue classification is not private land",
        "critical",
        "drag",
        "observed",
        `The revenue record classifies this survey number as "${parcel.classification}".`,
        "Classification is what the revenue department believes the land is, independent of who holds a document for it. Poramboke, government, assigned and inam classifications each need their own conversion or regularisation before a clean private title exists.",
        { impactLowPct: -70, impactHighPct: -35 },
        evidence,
      ),
    );
  }

  return out;
}

/**
 * The claimed-versus-surveyed extent check. Separate from `parcelFactors`
 * because it needs what the user says they are buying, which the parcel row
 * cannot know.
 */
export function extentMismatchFactor(
  parcel: ParcelRecord,
  claimedArea: number,
  claimedUnit: string,
): SiteFactor | null {
  if (!(claimedArea > 0) || !(parcel.areaSqyd > 0)) return null;
  const claimedSqyd = convertArea(claimedArea, claimedUnit, "sqyd");
  if (!(claimedSqyd > 0)) return null;

  const ratio = claimedSqyd / parcel.areaSqyd;
  // A sub-division sold out of a larger survey number is the normal case, not a
  // discrepancy. Only flag a claim that exceeds the surveyed boundary.
  if (ratio <= 1 + EXTENT_TOLERANCE) return null;

  const overBy = Math.round((ratio - 1) * 100);
  return factor(
    "parcel_extent_mismatch",
    "Claimed extent exceeds the surveyed boundary",
    "caution",
    "drag",
    "inferred",
    `The area being quoted is about ${overBy}% larger than the boundary recorded for survey no ${parcel.parcelNo}.`,
    "Cadastral boundaries are digitised from paper survey maps and carry their own error, so a small difference is normal. A large one usually means the sale covers more than one survey number, or that the extent on the paper does not match the ground. Ask for a surveyor's measurement before agreeing a price per yard.",
    { impactLowPct: -20, impactHighPct: -5 },
    {
      ...provenance(parcel),
      distanceM: 0,
      attributes: {
        surveyed_sqyd: Math.round(parcel.areaSqyd),
        claimed_sqyd: Math.round(claimedSqyd),
      },
    },
  );
}
