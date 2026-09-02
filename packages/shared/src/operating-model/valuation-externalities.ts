/**
 * What is next to the site, and what it takes off the value.
 *
 * A site under a 220kV transmission line, or inside a rajakaluve buffer, or
 * backing onto a cremation ground, does not transact at the locality median.
 * Every valuer in Bengaluru knows this and adjusts for it; the product knew
 * none of it. The comparable adjustment list was road width, corner site,
 * facing, dimensions and layout approval — every one of them a positive or
 * neutral plot attribute. There was no way for the number to go down because
 * of what the site is next to.
 *
 * The galling part was that the FACTS were already on the file and unused:
 * `land_site.flood_drainage` records whether the site sits in a rajakaluve
 * buffer and by how much it falls short, and the GIS overlay already computes
 * the distance from the pin to OSM water, BBMP lakes and ward boundaries. An
 * insight rule already fired on a buffer shortfall. None of it touched a
 * number.
 *
 * ## Why the rates are written down here
 *
 * Each rate is a JUDGEMENT. There is no statute that says a high-tension line
 * within fifteen metres costs twelve per cent, and anybody who tells you
 * otherwise is selling something. What there is, is a range that transaction
 * evidence and published guidance broadly support, and a valuer who should be
 * able to disagree with the number this product used.
 *
 * So every rate carries its `basis` — where it comes from and how firm it is —
 * and every applied adjustment names the rate it used. That is the same
 * treatment the check tolerances get, for the same reason: a threshold nobody
 * can find is a threshold nobody can argue with, and an adjustment a valuer
 * cannot argue with is one they will simply override, silently.
 *
 * ## What this deliberately does not do
 *
 * It does not stack without limit. Four overlapping constraints on one site
 * are usually one bad location rather than four independent discounts, and
 * multiplying them out reaches numbers no transaction supports. `applyAll`
 * compounds them and then caps the total — and reports the cap when it bites,
 * because a silently truncated discount is a wrong number wearing a right
 * one's clothes.
 */

/** A physical thing near the site that a market prices in. */
export type ExternalityKey =
  | 'ht_line'
  | 'rajakaluve'
  | 'lake_buffer'
  | 'floodplain'
  | 'cremation_ground'
  | 'landfill'
  | 'sewage_works'
  | 'railway'
  | 'highway_noise'
  | 'quarry';

export interface ExternalityBand {
  /** Applies when the feature is within this many metres. */
  withinM: number;
  /** Signed fraction of value. Negative is a discount. */
  pct: number;
  say: string;
}

export interface ExternalityRule {
  key: ExternalityKey;
  label: string;
  /** Nearest band first. The first band whose distance contains the feature wins. */
  bands: ExternalityBand[];
  /**
   * Where the rate comes from and how firm it is.
   *
   * Read this before arguing with the number. Some of these rest on statutory
   * setbacks that make land unbuildable — those are the firm ones. Others rest
   * on market observation, which varies by locality and by year.
   */
  basis: string;
  /** What has to be on the file for this to apply. */
  triggeredBy: string;
}

/**
 * The table.
 *
 * Ordered roughly by how firm the rate is: a statutory setback that makes land
 * unbuildable is arithmetic on the developable area, and a market aversion to
 * a view is a matter of degree.
 */
export const EXTERNALITY_RULES: readonly ExternalityRule[] = [
  {
    key: 'rajakaluve',
    label: 'Rajakaluve / storm-water drain buffer',
    bands: [
      { withinM: 0, pct: -0.35, say: 'Inside the buffer. The affected strip is not buildable and is exposed to demolition, not merely to a planning condition.' },
      { withinM: 25, pct: -0.12, say: 'Immediately outside the buffer — marketable, but the buffer is a live re-survey risk and buyers price it.' },
      { withinM: 75, pct: -0.04, say: 'Near a classified drain. Modest, and mostly about flooding perception.' },
    ],
    basis:
      'The firmest rate here, because it is not really a market discount: a strip inside a rajakaluve buffer cannot be built on and BBMP/NGT demolition of encroaching structures is a matter of record. 35% is a working figure for a site materially inside the buffer; where the encroaching share of the plot is known, that share should be excluded from developable area instead and this rule dropped.',
    triggeredBy: 'land_site.flood_drainage — near_rajakaluve, or buffer_available_m short of buffer_required_m.',
  },
  {
    key: 'ht_line',
    label: 'High-tension transmission line overhead or adjacent',
    bands: [
      { withinM: 15, pct: -0.15, say: 'Under or immediately beside the corridor. Statutory clearance under the Electricity Rules restricts what can be built beneath it, and resale is materially harder.' },
      { withinM: 40, pct: -0.07, say: 'Within sight and audible range of the corridor.' },
      { withinM: 100, pct: -0.02, say: 'Corridor visible from the site.' },
    ],
    basis:
      'Two effects compounded: a real restriction on building under the clearance envelope, and a persistent buyer aversion that shows up in resale times more than in headline rates. Indian transaction evidence is thin and locality-specific; treat 15% as the top of a 10–20% range for a site directly under a corridor and adjust on local comparables where you have them.',
    triggeredBy: 'Recorded on the site constraints check, or observed on a site visit.',
  },
  {
    key: 'floodplain',
    label: 'Floodplain or recorded inundation',
    bands: [
      { withinM: 0, pct: -0.25, say: 'On the floodplain. Insurance, foundation cost and lender appetite all move against the site.' },
      { withinM: 50, pct: -0.08, say: 'Adjoining a floodplain.' },
    ],
    basis: 'Rests on cost and financeability rather than taste: raised foundations, drainage works and a narrower lender pool. Where a flood study exists, use its cost rather than this rate.',
    triggeredBy: 'A flood or drainage finding, or a recorded inundation event.',
  },
  {
    key: 'lake_buffer',
    label: 'Lake buffer',
    bands: [
      { withinM: 0, pct: -0.2, say: 'Inside the lake buffer. Buildable area is restricted and the classification is subject to revision.' },
      { withinM: 75, pct: -0.03, say: 'Close to a lake. Often a premium for outlook and a discount for buffer risk; these broadly offset.' },
    ],
    basis:
      'Deliberately smaller than the rajakaluve rate and deliberately near-nil at distance. Proximity to a lake in Bengaluru cuts both ways — outlook is a premium, buffer revision is a risk — and a rule that only discounted would misprice the good side of it.',
    triggeredBy: 'GIS overlay lake proximity, or a recorded lake buffer finding.',
  },
  {
    key: 'cremation_ground',
    label: 'Cremation ground or burial ground',
    bands: [
      { withinM: 100, pct: -0.12, say: 'Adjacent or nearly so. A strong and durable buyer aversion in the residential market.' },
      { withinM: 300, pct: -0.05, say: 'Within a few hundred metres.' },
    ],
    basis: 'Purely market aversion, and strongly segment-dependent: material in residential, close to nil in industrial or warehousing. Apply it to residential and check whether it belongs at all on anything else.',
    triggeredBy: 'Observed on a site visit or recorded on the site constraints check.',
  },
  {
    key: 'landfill',
    label: 'Landfill or waste processing',
    bands: [
      { withinM: 500, pct: -0.15, say: 'Odour and leachate risk are both live at this distance.' },
      { withinM: 1500, pct: -0.05, say: 'Within the odour catchment on a bad day.' },
    ],
    basis: 'Wide bands because the effect travels — odour is a wind-direction problem, not a distance problem, and 1.5 km downwind can be worse than 500 m across. Where prevailing wind is known, weight accordingly.',
    triggeredBy: 'Site constraints, an environmental finding, or a site visit observation.',
  },
  {
    key: 'sewage_works',
    label: 'Sewage treatment plant',
    bands: [
      { withinM: 200, pct: -0.1, say: 'Odour is intermittent but remembered, and it shows in resale.' },
      { withinM: 600, pct: -0.03, say: 'Occasional odour on the wrong wind.' },
    ],
    basis: 'Same wind caveat as landfill, at a smaller scale. A well-run modern STP is materially less of a discount than an overloaded one — where the plant is identified, its condition is worth more than its distance.',
    triggeredBy: 'Site constraints or a site visit observation.',
  },
  {
    key: 'railway',
    label: 'Railway line',
    bands: [
      { withinM: 50, pct: -0.1, say: 'Noise and vibration are both present at this distance.' },
      { withinM: 150, pct: -0.04, say: 'Audible, particularly at night.' },
    ],
    basis: 'Noise and vibration. Vibration is the half buyers underestimate and surveyors do not. Freight lines are worse than passenger; a line with a level crossing nearby worse again.',
    triggeredBy: 'Site constraints or a site visit observation.',
  },
  {
    key: 'highway_noise',
    label: 'Highway or arterial road frontage',
    bands: [
      { withinM: 30, pct: -0.06, say: 'Noise and pollution against the access and visibility a main road gives.' },
    ],
    basis:
      'The smallest rate in the table and the one most likely to be wrong in either direction. Frontage on an arterial is a discount for residential and a premium for retail or commercial — check the use before applying it, and consider dropping it entirely for a retail subject.',
    triggeredBy: 'land_site.access — road width and class.',
  },
  {
    key: 'quarry',
    label: 'Active quarry or crusher',
    bands: [
      { withinM: 500, pct: -0.18, say: 'Blasting, dust and heavy vehicle movement.' },
      { withinM: 2000, pct: -0.05, say: 'Dust and truck traffic on the approach roads.' },
    ],
    basis: 'Among the larger rates because the effects are physical rather than perceptual — structural cracking from blasting is a real and litigated harm around Bengaluru’s quarry belts.',
    triggeredBy: 'Site constraints or a site visit observation.',
  },
];

export const EXTERNALITY_BY_KEY: Record<ExternalityKey, ExternalityRule> = Object.fromEntries(
  EXTERNALITY_RULES.map((r) => [r.key, r]),
) as Record<ExternalityKey, ExternalityRule>;

/* ==================================================================== */
/* Applying them                                                         */
/* ==================================================================== */

/** One externality actually present on this site, with its distance. */
export interface ExternalityObservation {
  key: ExternalityKey;
  /** Metres from the site. 0 means the site is inside or under it. */
  metres: number;
  /** Where this came from — a check field, a GIS reading, a site visit. */
  from: string;
  evidenceId?: string;
}

export interface AppliedExternality {
  key: ExternalityKey;
  label: string;
  metres: number;
  pct: number;
  say: string;
  basis: string;
  from: string;
  evidenceId?: string;
}

/**
 * The most a site's surroundings may take off it in total.
 *
 * Four overlapping constraints usually describe one bad location rather than
 * four independent problems, and compounding them unchecked reaches numbers no
 * transaction supports — a site with five of these would price at under a
 * third of the locality median, which is not what such sites sell for. The cap
 * is a judgement like the rates, and it is reported when it bites.
 */
export const MAX_EXTERNALITY_DISCOUNT = 0.45;

export interface ExternalityAdjustment {
  applied: AppliedExternality[];
  /** Compounded, signed. -0.18 means 18% off. */
  factorPct: number;
  /** True when the cap bit, so the page can say the raw total was larger. */
  capped: boolean;
  uncappedPct: number;
  say: string;
}

/** The band that applies at this distance, or null when the feature is too far to matter. */
export function bandFor(rule: ExternalityRule, metres: number): ExternalityBand | null {
  for (const band of rule.bands) {
    if (metres <= band.withinM) return band;
  }
  return null;
}

/**
 * Compound the observations into one adjustment.
 *
 * Compounded rather than summed: two 10% discounts leave 81% of the value, not
 * 80%. The difference is small on two and material on five, and summing is the
 * error that makes a stack of adjustments run away.
 */
export function applyExternalities(observations: readonly ExternalityObservation[]): ExternalityAdjustment {
  const applied: AppliedExternality[] = [];
  for (const observation of observations) {
    const rule = EXTERNALITY_BY_KEY[observation.key];
    if (!rule) continue;
    const band = bandFor(rule, observation.metres);
    if (!band) continue;
    applied.push({
      key: rule.key,
      label: rule.label,
      metres: observation.metres,
      pct: band.pct,
      say: band.say,
      basis: rule.basis,
      from: observation.from,
      ...(observation.evidenceId ? { evidenceId: observation.evidenceId } : {}),
    });
  }

  if (!applied.length) {
    return { applied, factorPct: 0, capped: false, uncappedPct: 0, say: 'Nothing recorded next to this site that a market would price in.' };
  }

  const remaining = applied.reduce((factor, a) => factor * (1 + a.pct), 1);
  const uncapped = remaining - 1;
  const capped = Math.abs(uncapped) > MAX_EXTERNALITY_DISCOUNT;
  const factorPct = capped ? -MAX_EXTERNALITY_DISCOUNT : uncapped;

  return {
    applied,
    factorPct,
    capped,
    uncappedPct: uncapped,
    say: capped
      ? `${applied.length} constraints compound to ${(uncapped * 100).toFixed(1)}%, which is capped at ${(MAX_EXTERNALITY_DISCOUNT * 100).toFixed(0)}%. Several overlapping constraints usually describe one bad location rather than that many independent discounts — check whether they should be one adjustment argued on its own terms.`
      : `${applied.length} constraint(s) compounding to ${(factorPct * 100).toFixed(1)}%.`,
  };
}
