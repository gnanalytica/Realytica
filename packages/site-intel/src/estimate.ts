// Turning an anchor rate and a list of factors into a value band.
//
// Factors compound multiplicatively, not additively. Additive percentages are
// the obvious implementation and they are wrong here for two reasons: three
// serious problems can sum past -100% and produce a negative value, and each
// successive discount in a real negotiation applies to what is left, not to the
// original. Compounding is also what a valuer does by hand.
//
// Two guard rails keep the compounded result sane. Uplifts are capped, because
// a plot does not become worth double for being east-facing on a wide corner
// near a metro — the market prices the best one or two advantages and largely
// ignores the rest. Drags have a floor, because even a plot with a serious
// legal problem retains land value; what collapses is liquidity, not the asset.
//
// Pure module: no network, no clock, no formatting.

import { convertArea } from "./area";
import type { RateAnchor, SiteEstimate, SiteFactor } from "./types";

/**
 * The most the factor stack may lift a rate. Set from what stacked advantages
 * actually fetch: a genuinely excellent plot trades at a large premium over an
 * ordinary one in the same locality, not a multiple of it.
 */
const MAX_UPLIFT_MULTIPLIER = 1.6;

/**
 * The least the factor stack may leave. A property that cannot be registered
 * still has land under it, and the residual is what a cash buyer with an appetite
 * for the problem will pay. Below this the number stops being an estimate and
 * starts being a guess about a specific negotiation.
 */
const MIN_DRAG_MULTIPLIER = 0.2;

/**
 * How wide the band is before any factor touches it.
 *
 * Without this, a plot with nothing remarkable about it prints "₹3.5 Cr to
 * ₹3.5 Cr" — a single number wearing a band's clothes, which is the precise
 * claim this product exists not to make. The spread is not decoration: the
 * anchor itself is uncertain, and by a knowable amount.
 *
 * A guidance rate uplifted by a locality multiple carries that multiple's error,
 * which is the largest single unknown in the whole calculation — two plots on
 * the same street routinely trade 20% apart. A rate the owner or a local broker
 * supplied is far better information, but it is still one person's read of the
 * market rather than a transaction price, so it is narrowed, not collapsed.
 */
const ANCHOR_SPREAD: Record<RateAnchor["basis"], number> = {
  guidance: 0.15,
  guidance_multiplied: 0.12,
  user: 0.05,
};

type Bound = "low" | "high";

function multiplierFor(factor: SiteFactor, bound: Bound): number {
  const pct = bound === "low" ? factor.impactLowPct : factor.impactHighPct;
  return 1 + pct / 100;
}

/**
 * Compound one side of the band. Uplifts and drags are compounded separately so
 * each can be clamped on its own — clamping the combined product would let a
 * large uplift mask a serious drag.
 */
function compound(factors: SiteFactor[], bound: Bound): { uplift: number; drag: number } {
  let uplift = 1;
  let drag = 1;
  for (const f of factors) {
    const m = multiplierFor(f, bound);
    if (m >= 1) uplift *= m;
    else drag *= m;
  }
  return {
    uplift: Math.min(uplift, MAX_UPLIFT_MULTIPLIER),
    drag: Math.max(drag, MIN_DRAG_MULTIPLIER),
  };
}

/** Area expressed in whatever unit the anchor's rate is quoted in. */
export function quantityFor(
  area: number,
  areaUnit: string,
  anchorUnit: "sqyd" | "sqft",
): number {
  return convertArea(area, areaUnit, anchorUnit);
}

/**
 * Round a rupee figure to a precision that matches its own uncertainty. Showing
 * a band of "₹1,04,73,912 to ₹1,38,21,455" implies a precision the inputs cannot
 * carry; rounding to two significant figures is what an estimate is entitled to.
 */
export function roundToBand(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = Math.floor(Math.log10(value));
  const step = Math.pow(10, Math.max(0, magnitude - 1));
  return Math.round(value / step) * step;
}

export function buildEstimate(
  anchor: RateAnchor,
  factors: SiteFactor[],
  area: number,
  areaUnit: string,
): SiteEstimate | null {
  if (!Number.isFinite(area) || area <= 0) return null;
  if (!Number.isFinite(anchor.ratePerUnit) || anchor.ratePerUnit <= 0) return null;

  const quantity = quantityFor(area, areaUnit, anchor.unit);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const low = compound(factors, "low");
  const high = compound(factors, "high");

  const spread = ANCHOR_SPREAD[anchor.basis] ?? 0.12;
  const adjustedRateLow = anchor.ratePerUnit * (1 - spread) * low.uplift * low.drag;
  const adjustedRateHigh = anchor.ratePerUnit * (1 + spread) * high.uplift * high.drag;

  // Compounding the low bound of every factor against the high bound of every
  // other can invert the band when a single factor is unusually wide. Order the
  // pair rather than emitting a reversed range.
  const rateLow = Math.min(adjustedRateLow, adjustedRateHigh);
  const rateHigh = Math.max(adjustedRateLow, adjustedRateHigh);

  const valueLow = roundToBand(rateLow * quantity);
  const valueHigh = roundToBand(rateHigh * quantity);

  return {
    anchor,
    adjustedRateLow: Math.round(rateLow),
    adjustedRateHigh: Math.round(rateHigh),
    valueLow,
    valueHigh: Math.max(valueLow, valueHigh),
    quantity: Math.round(quantity * 100) / 100,
    quantityUnit: anchor.unit,
    totalUpliftPct: Math.round((high.uplift - 1) * 100),
    totalDragPct: Math.round((low.drag - 1) * 100),
  };
}

/**
 * How much weight the band deserves. Driven by what was actually established,
 * not by how many factors were found: a confident-looking estimate built while
 * the decisive layers were unreachable is the failure mode worth guarding.
 */
export type EstimateConfidence = "indicative" | "moderate" | "low";

export function estimateConfidence(input: {
  anchorBasis: RateAnchor["basis"];
  gapCount: number;
  unansweredRequired: number;
}): { level: EstimateConfidence; reason: string } {
  if (input.gapCount > 0) {
    return {
      level: "low",
      reason:
        "One or more government layers could not be reached, so something that affects value may not have been checked.",
    };
  }
  if (input.unansweredRequired > 0) {
    return {
      level: "low",
      reason:
        "Some of the questions that move the number most have not been answered yet.",
    };
  }
  if (input.anchorBasis === "user") {
    return {
      level: "moderate",
      reason: "Anchored to the local rate you supplied, adjusted for what the maps show.",
    };
  }
  return {
    level: "indicative",
    reason:
      "Anchored to the statutory rate uplifted to a traded level. Good for a first read, not a substitute for a valuer's opinion.",
  };
}
