/**
 * Global Core + Country Pack + State/Municipality Pack reference data.
 *
 * This is static "world knowledge" the engine consults — it is not user data and
 * it is not computed by scoring logic. Magnitudes are chosen to be plausible to a
 * property professional in each market (see quality bar in the build brief), not
 * to be actual current market data.
 *
 * Comparable records intentionally have no structured locality/city field (the
 * shared contract in `types.ts` does not carry one) — the engine matches on the
 * `address` string containing the locality/city name instead, which is why every
 * address below is written as "<building>, <locality>, <city>, <state>".
 */

import type { AerodromeReference, Comparable, CountryCode, CountryPack, LocalityReference, PropertyType, ReferenceData, StatePack, WaterExposureReference } from './types';
import { KARNATAKA_PACK } from './packs/karnataka';

/* ------------------------------------------------------------------ */
/* Country packs                                                       */
/* ------------------------------------------------------------------ */

const INDIA_PACK: CountryPack = {
  country: 'IN',
  countryName: 'India',
  currency: 'INR',
  locale: 'en-IN',
  parcelIdLabel: 'Survey / Khata number',
  statutoryRateLabel: 'Circle rate',
  // Phase 1 is deliberately one state/metro. Every rule below — the Khata
  // extract, the 5.6% stamp duty, the IGR registry naming — is Karnataka's.
  coveredStates: ['Karnataka'],
  // Weights sum to 100. Title deed, encumbrance certificate, khata extract and the
  // latest tax receipt are the four documents a title check cannot proceed
  // without, so together they carry 70/100 of the score — the "critical" set
  // that dominates completeness even if every optional document is missing.
  requiredDocuments: [
    { kind: 'title_deed', label: 'Title deed / sale deed', weight: 25, required: true },
    { kind: 'encumbrance_certificate', label: 'Encumbrance certificate (13–30 year)', weight: 20, required: true },
    { kind: 'khata_extract', label: 'Khata extract / property register extract', weight: 15, required: true },
    { kind: 'property_tax_receipt', label: 'Property tax receipt (latest)', weight: 10, required: true },
    { kind: 'occupancy_certificate', label: 'Occupancy certificate', weight: 13, required: false },
    { kind: 'approved_building_plan', label: 'Approved building plan', weight: 12, required: false },
    { kind: 'rera_registration', label: 'RERA registration', weight: 5, required: false },
  ],
  datasets: [
    'State Registration Department (IGR)',
    'RERA registry',
    'Municipal property tax roll',
    'Survey & Settlement records',
  ],
  // Karnataka rates. These are state-set in India, which is precisely why the
  // pack declares its covered states above.
  stampDutyPct: 5.6,
  registrationFeePct: 1,
  // Bengaluru apartment conventions. Saleable is above 1.0 because super
  // built-up loads a share of common area on top of what the FAR counts;
  // constructed is above 1.0 because basement parking and service floors are
  // FAR-exempt and still have to be built and paid for. Both are norms, not
  // measurements — a sanctioned plan and a price list replace them.
  areaRatios: {
    saleableToFar: 1.25,
    constructedToFar: 1.35,
    source: 'Bengaluru development convention — super built-up loading and FAR-exempt basement/service area',
    verifyNote:
      'These are market norms for a mid-rise Bengaluru residential scheme, not figures measured from a plan. ' +
      'A sanctioned building plan gives the real constructed area and a developer price list gives the real ' +
      'saleable area; either one supersedes the ratio it replaces. A scheme with no basement parking, or one ' +
      'selling on carpet area under RERA, will differ materially.',
  },
  notes:
    'Stamp duty and registration are levied on the higher of transacted price or the circle rate ' +
    '(statutory guidance value) recorded by the State Registration Department. Circle rates typically ' +
    'lag market price, especially in fast-appreciating micro-markets, so they are used here only as a ' +
    'conservative floor anchor, not as a market estimate.',
};

const NETHERLANDS_PACK: CountryPack = {
  country: 'NL',
  countryName: 'Netherlands',
  currency: 'EUR',
  locale: 'nl-NL',
  // Dutch conveyancing instruments are national (Kadaster, WOZ, energielabel),
  // so coverage here is a statement about market-data reach, not document rules.
  coveredStates: ['Noord-Holland', 'Utrecht', 'Zuid-Holland'],
  parcelIdLabel: 'Kadastrale aanduiding',
  statutoryRateLabel: 'WOZ value',
  // Weights sum to 100. Kadaster extract, WOZ assessment and the sale/purchase
  // agreement are the three documents that establish who owns what and on what
  // terms; together they carry 70/100 so an optional-only file set never scores
  // as "complete".
  requiredDocuments: [
    { kind: 'kadaster_extract', label: 'Kadaster extract (uittreksel)', weight: 25, required: true },
    { kind: 'sale_agreement', label: 'Sale agreement (koopovereenkomst)', weight: 25, required: true },
    { kind: 'woz_assessment', label: 'WOZ assessment (waardebeschikking)', weight: 20, required: true },
    { kind: 'energy_label', label: 'Energy label (energielabel)', weight: 15, required: true },
    { kind: 'lease_agreement', label: 'Lease agreement (huurovereenkomst)', weight: 15, required: false },
  ],
  datasets: ['Kadaster', 'CBS/NVM transaction statistics', 'BAG registry', 'Ruimtelijke plannen', 'Energielabel register'],
  // Overdrachtsbelasting (transfer tax): 10.4% is the non-owner-occupied / investor
  // rate that applies to the kind of acquisitions this product screens.
  stampDutyPct: 10.4,
  // The Kadaster registration levy is a small fixed notary disbursement rather than
  // a percentage of price, so this is left near-zero rather than fabricating a rate.
  registrationFeePct: 0.1,
  // The Netherlands sells and permits on gebruiksoppervlakte (NEN 2580 usable
  // floor area), so there is no super-built-up loading to add and the two
  // ratios sit close to 1. Stated rather than omitted so the residual reads
  // the same way in both countries instead of silently skipping a step.
  areaRatios: {
    saleableToFar: 1.0,
    constructedToFar: 1.15,
    source: 'NEN 2580 gebruiksoppervlakte — sale and permit measure the same area, so no loading applies',
    verifyNote:
      'Dutch practice measures both the sale and the permit on NEN 2580 usable floor area, so saleable and ' +
      'permitted area coincide. The constructed ratio still exceeds 1 for parking and services. A NEN 2580 ' +
      'meetrapport for the specific scheme replaces both.',
  },
  notes:
    'Overdrachtsbelasting (property transfer tax) is 10.4% for investment acquisitions, versus a reduced ' +
    'rate for owner-occupiers under the starters exemption. The WOZ value is a municipal assessment used ' +
    'for tax purposes and is republished annually with roughly a one-year valuation lag against market price.',
};

export const COUNTRY_PACKS: CountryPack[] = [INDIA_PACK, NETHERLANDS_PACK];

/* ------------------------------------------------------------------ */
/* State / Municipality packs                                          */
/* ------------------------------------------------------------------ */

// Phase 1's one state/metro (India, Karnataka, Bengaluru — see SOURCE_SPEC.md)
// now has its own State Pack tier. See packages/shared/src/packs/karnataka.ts
// for the substance and, critically, the provenance/verify-note discipline
// every statutory figure in it carries.
export const STATE_PACKS = [KARNATAKA_PACK];

/**
 * Find the State Pack for an identity, tolerating how people actually write a
 * jurisdiction down.
 *
 * `identity.state` is free text and reaches the engine from several places —
 * a typed case field, a project's `jurisdiction`, an intake answer. Those
 * sources do not agree on granularity: a project records the state *and* the
 * planning authority that governs the site ("Karnataka / BMRDA", "Karnataka /
 * BBMP"), because which authority sanctions a layout is the thing an analyst
 * needs on the file. That is correct data and it is not a state name.
 *
 * This used to be `p.state.toLowerCase() === identity.state.toLowerCase()`,
 * so every one of those strings missed and the Karnataka pack silently did
 * not load: no title checks, no transaction costs, the state's own required
 * documents dropped from the completeness list, and a confident verdict on
 * top of all three with nothing saying the state layer had not run. A screen
 * that quietly measures a Bengaluru property against the country pack alone
 * is exactly the failure this product exists to prevent, so the matcher is
 * written to the shape of the data rather than the data to the matcher.
 *
 * A jurisdiction is read as authority segments separated by `/`, `,`, `|`,
 * `;`, `>` or `·` — the separators that mean "and then, within it". A pack
 * matches when it is the whole string or any one segment. Hyphens are NOT
 * separators: `Noord-Holland` is one province, not two.
 *
 * Matching stays exact per segment. A pack that governs Karnataka must not
 * answer for Kerala because a prefix happened to line up, and a substring
 * test would do precisely that.
 */
function normaliseJurisdictionSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(the\s+)?state\s+of\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The authority segments in a jurisdiction string, most-general first. */
export function jurisdictionSegments(state: string): string[] {
  return state
    .split(/[/,|;>·]/)
    .map(normaliseJurisdictionSegment)
    .filter(Boolean);
}

export function resolveStatePack(
  identity: { country: CountryCode; state: string },
  packs: StatePack[] = STATE_PACKS,
): StatePack | undefined {
  const whole = normaliseJurisdictionSegment(identity.state);
  const segments = jurisdictionSegments(identity.state);
  return packs.find((pack) => {
    if (pack.country !== identity.country) return false;
    const packState = normaliseJurisdictionSegment(pack.state);
    return packState === whole || segments.includes(packState);
  });
}

/* ------------------------------------------------------------------ */
/* Locality references                                                 */
/* ------------------------------------------------------------------ */

const TREND_PERIODS = ['2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'] as const;

/**
 * Builds 8 quarters of trend data (oldest first) that land on `currentMedian` in
 * the final quarter, growing at a constant quarterly rate implied by `yoyPct`.
 * This is an approximation (real series are not perfectly geometric) but it keeps
 * every locality's trend internally consistent with its own headline `yoyChangePct`.
 */
function buildTrend(
  currentMedian: number,
  yoyPct: number,
  roundTo: number,
): { period: string; medianPricePerSqm: number }[] {
  const quarterlyGrowth = Math.pow(1 + yoyPct / 100, 1 / 4) - 1;
  const values: number[] = new Array(TREND_PERIODS.length);
  values[TREND_PERIODS.length - 1] = currentMedian;
  for (let i = TREND_PERIODS.length - 2; i >= 0; i -= 1) {
    values[i] = values[i + 1] / (1 + quarterlyGrowth);
  }
  return TREND_PERIODS.map((period, i) => ({
    period,
    medianPricePerSqm: Math.round(values[i] / roundTo) * roundTo,
  }));
}

/**
 * Land rate methodology (medianLandRatePerSqm / statutoryLandRatePerSqm).
 *
 * A land rate prices a sqm of PLOT; a built rate (medianPricePerSqm) prices a
 * sqm of BUILT-UP space on a multi-storey site — a different quantity, not the
 * same one scaled by a constant. FAR is what connects them, and it connects
 * them the opposite way intuition suggests: land is usually the SCARCER,
 * MORE-expensive-per-sqm quantity, not the cheaper one, because every sqm of
 * plot backs `farAllowed` sqm of saleable built area, all of it capitalising
 * that one plot.
 *
 * Approximate developer-economics identity used to derive the figures below:
 *
 *   medianPricePerSqm ≈ (landRatePerSqm / farAllowed) + constructionCostPerSqm + margin&otherCosts
 *   ⇒ landRatePerSqm  ≈ farAllowed × (k × medianPricePerSqm − replacementCostPerSqm)
 *
 * where k is the share of the built price that is land + margin + approvals
 * rather than pure shell construction — taken as ≈0.72 for established,
 * built-out localities (thicker developer margins; land itself is genuinely
 * scarce) and ≈0.76 for active peripheral growth corridors (thinner margins,
 * more of the price is land-driven). The FAR multiplier is exactly why a
 * Whitefield plot (FAR 2.75) prices well above the Whitefield apartment rate
 * even though "land must be cheaper than a finished flat" sounds intuitive —
 * the apartment rate is the land value *diluted* across every floor the FAR
 * permits, and grossing it back up by FAR is what a standalone plot buyer
 * actually pays per sqm of land.
 *
 * statutoryLandRatePerSqm (guidance value for land) is set at roughly
 * 0.48–0.56× the derived median land rate — a larger lag than the ~0.58–0.61×
 * typical of built-property guidance values in the same localities, because
 * periodic guidance-value revision cycles lag a speculative, retail-driven
 * plot market even more than they lag built-property transactions.
 *
 * Deliberate exceptions, each re-stated at the locality itself:
 *  - Outer Ring Road (Bellandur): a commercial corridor with no retail plot
 *    market — land is held in large institutional campus parcels, and
 *    high-spec Grade-A construction cost eats most of the FAR uplift, so the
 *    derived land rate sits BELOW the office built rate rather than above it.
 *  - Devanahalli: `medianPricePerSqm` here already tracks plotted/converted
 *    LAND, not apartment stock (see that locality's own comment below) — so
 *    its land rate sits only slightly above its own median, not diluted up
 *    by FAR the way a genuine apartment locality's is.
 *  - The Netherlands localities use related but distinct reasoning per
 *    locality — see the comment above that section.
 */
const LOCALITY_BASE: LocalityReference[] = [
  // --- India — Bengaluru --------------------------------------------------
  {
    id: 'in-blr-whitefield',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Whitefield',
    currency: 'INR',
    medianPricePerSqm: 92000,
    statutoryRatePerSqm: 53000,
    grossYield: 0.03,
    yoyChangePct: 9.5,
    liquidityDays: 55,
    sampleSize: 186,
    trend: buildTrend(92000, 9.5, 500),
    zoning: 'Residential (R1) — high density',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 2.75,
    planningNote:
      'BBMP zonal regulations permit FAR up to 2.75 on roads wider than 12m; several large IT-park-adjacent ' +
      'parcels have unused headroom from phased development.',
    replacementCostPerSqm: 26000,
    // FAR 2.75 × (0.72×92,000 − 26,000) ≈ 110,700 → 110,000: ~1.20× the built
    // median. Illustrative case for the methodology note above — a Whitefield
    // plot trades well above the apartment rate despite thin plot supply.
    medianLandRatePerSqm: 110000,
    statutoryLandRatePerSqm: 61000,
    infrastructureNote:
      'Served by the ITPL/Whitefield IT corridor and the Purple Line metro extension; arterial road widening ' +
      'has reduced peak-hour congestion since 2024.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-indiranagar',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Indiranagar',
    currency: 'INR',
    medianPricePerSqm: 150000,
    statutoryRatePerSqm: 88000,
    grossYield: 0.026,
    yoyChangePct: 6,
    liquidityDays: 70,
    sampleSize: 94,
    trend: buildTrend(150000, 6, 500),
    zoning: 'Residential (R1) — mixed with commercial road frontage',
    permittedUses: ['residential_apartment', 'retail_unit'],
    farAllowed: 2.25,
    planningNote: 'Mature, largely built-out locality; narrower internal roads cap FAR below newer corridors.',
    replacementCostPerSqm: 30000,
    // FAR 2.25 × (0.72×150,000 − 30,000) = 2.25 × 78,000 = 175,500 → 176,000:
    // ~1.17× the built median. Central, built-out, almost no plot supply —
    // exactly the "very high land rate, land itself is the scarce thing" case.
    medianLandRatePerSqm: 176000,
    statutoryLandRatePerSqm: 97000,
    infrastructureNote: 'Purple Line metro station within the locality; limited surface parking is a known constraint.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-sarjapur-road',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Sarjapur Road',
    currency: 'INR',
    medianPricePerSqm: 66000,
    statutoryRatePerSqm: 40000,
    grossYield: 0.034,
    yoyChangePct: 12.5,
    liquidityDays: 65,
    sampleSize: 152,
    trend: buildTrend(66000, 12.5, 500),
    zoning: 'Residential (R1) — growth corridor',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 2.75,
    planningNote: 'Fastest-appreciating of the tracked Bengaluru micro-markets; several large master-planned layouts still under construction.',
    replacementCostPerSqm: 24000,
    // Active growth corridor (k≈0.76): 2.75 × (0.76×66,000 − 24,000) ≈ 71,900
    // → 73,000, ~1.11× the built median. One of the corridors where sites
    // genuinely change hands — layouts sell directly to retail plot buyers.
    medianLandRatePerSqm: 73000,
    statutoryLandRatePerSqm: 36000,
    infrastructureNote: 'Road-widening and the proposed metro Phase 3 extension are the main upside catalysts; current peak-hour congestion is significant.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  // --- India — Bengaluru (continued) --------------------------------------
  // Phase 1 covers one state/metro, so every Indian locality is Karnataka /
  // Bengaluru. The office and retail corridors below keep the commercial
  // property types represented without reaching into another state's rules.
  {
    id: 'in-blr-orr-bellandur',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Outer Ring Road (Bellandur)',
    currency: 'INR',
    medianPricePerSqm: 86000,
    statutoryRatePerSqm: 58000,
    grossYield: 0.079,
    yoyChangePct: 6.4,
    liquidityDays: 145,
    sampleSize: 52,
    trend: buildTrend(86000, 6.4, 500),
    zoning: 'Commercial / IT-ITES corridor',
    permittedUses: ['commercial_office', 'retail_unit'],
    farAllowed: 3.25,
    planningNote:
      'BBMP permits enhanced FAR along the Outer Ring Road commercial corridor subject to road width and ' +
      'mandatory setbacks; several campuses retain unbuilt entitlement from phased approvals.',
    replacementCostPerSqm: 41000,
    // Deliberate exception: 3.25 × (0.72×86,000 − 41,000) ≈ 67,900 → 68,000,
    // BELOW the office built rate (86,000). High-spec Grade-A shell+core cost
    // eats most of the FAR uplift, and there is no retail plot market here —
    // land trades only in bulk institutional campus parcels, not small sites.
    medianLandRatePerSqm: 68000,
    statutoryLandRatePerSqm: 44000,
    infrastructureNote:
      'The ORR office cluster between Bellandur and Marathahalli drives Grade-A demand; the Blue Line metro ' +
      'corridor under construction is expected to ease the corridor\'s well-documented congestion.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-hebbal',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Hebbal',
    currency: 'INR',
    medianPricePerSqm: 79000,
    statutoryRatePerSqm: 46000,
    grossYield: 0.033,
    yoyChangePct: 8.1,
    liquidityDays: 62,
    sampleSize: 121,
    trend: buildTrend(79000, 8.1, 500),
    zoning: 'Residential (R2) — medium density with mixed-use frontage',
    permittedUses: ['residential_apartment', 'residential_villa', 'commercial_office'],
    farAllowed: 2.5,
    planningNote:
      'North Bengaluru growth corridor; BBMP zonal regulations allow FAR 2.5 with mixed-use frontage on ' +
      'arterial roads, and airport-corridor parcels are subject to height restrictions.',
    replacementCostPerSqm: 27500,
    // Active corridor (k≈0.76, plots genuinely trade here): 2.5 ×
    // (0.76×79,000 − 27,500) ≈ 81,300 → 81,000, a modest ~1.03× the built
    // median — Hebbal is more apartment-led than Sarjapur/Yelahanka, so the
    // land premium is thinner even though sites do change hands.
    medianLandRatePerSqm: 81000,
    statutoryLandRatePerSqm: 42000,
    infrastructureNote:
      'Airport-corridor position on the Bellary Road spine with metro Blue Line connectivity under delivery; ' +
      'flyover capacity remains the binding constraint at peak.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-koramangala',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Koramangala',
    currency: 'INR',
    medianPricePerSqm: 138000,
    statutoryRatePerSqm: 82000,
    grossYield: 0.036,
    yoyChangePct: 5.2,
    liquidityDays: 44,
    sampleSize: 98,
    trend: buildTrend(138000, 5.2, 500),
    zoning: 'Residential (R1) with commercial frontage overlay',
    permittedUses: ['residential_apartment', 'retail_unit', 'commercial_office'],
    farAllowed: 2.25,
    planningNote:
      'Established, largely built-out micro-market; commercial conversion on designated frontage roads is ' +
      'permitted but BBMP FAR headroom is thin and parking norms bind most redevelopment.',
    replacementCostPerSqm: 31000,
    // FAR 2.25 × (0.72×138,000 − 31,000) ≈ 153,800 → 154,000: ~1.12× the
    // built median. Central, built-out, almost no plot supply.
    medianLandRatePerSqm: 154000,
    statutoryLandRatePerSqm: 85000,
    infrastructureNote:
      'Central location with mature retail and startup-office demand; scarcity of new supply supports pricing ' +
      'and keeps time-to-transact short.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  // --- India — Bengaluru (Karnataka State Pack expansion) -----------------
  // Eight more micro-markets, chosen to span the real price ladder from
  // outer-IT-corridor (Electronic City) to heritage-premium (Jayanagar) to a
  // land-led, pre-conversion airport-corridor market (Devanahalli) — see the
  // Karnataka State Pack build brief. Guidance value is deliberately modelled
  // as a materially larger lag against market median in Devanahalli than in
  // the built-up city localities: peripheral/land guidance values are the
  // slowest of all to catch up with speculative, infrastructure-anticipation
  // pricing, which is itself the point the compliance view needs to make.
  {
    id: 'in-blr-hsr-layout',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'HSR Layout',
    currency: 'INR',
    medianPricePerSqm: 118000,
    statutoryRatePerSqm: 68000,
    grossYield: 0.03,
    yoyChangePct: 8,
    liquidityDays: 48,
    sampleSize: 132,
    trend: buildTrend(118000, 8, 500),
    zoning: 'Residential (R1) — established layout with sector commercial frontage',
    permittedUses: ['residential_apartment', 'retail_unit', 'commercial_office'],
    farAllowed: 2.5,
    planningNote:
      'BBMP property-tax Zone C; RMP 2015 zoning is Residential (R1) with a commercial overlay on sector arterial roads (e.g. 27th Main). Falls within BBMP\'s Bommanahalli zone; startup/office use in converted residential buildings is common but not always plan-compliant.',
    replacementCostPerSqm: 29000,
    // FAR 2.5 × (0.72×118,000 − 29,000) ≈ 139,900 → 140,000: ~1.19× the built
    // median. Established layout, high FAR, moderate scarcity.
    medianLandRatePerSqm: 140000,
    statutoryLandRatePerSqm: 78000,
    infrastructureNote:
      'No direct metro station; the Silk Board junction — where the under-construction Blue Line will eventually interchange — is the corridor\'s most congested pinch point, and access today is entirely road-based via Sarjapur Road, Hosur Road and the Outer Ring Road.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-jp-nagar',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'JP Nagar',
    currency: 'INR',
    medianPricePerSqm: 108000,
    statutoryRatePerSqm: 64000,
    grossYield: 0.029,
    yoyChangePct: 6,
    liquidityDays: 58,
    sampleSize: 140,
    trend: buildTrend(108000, 6, 500),
    zoning: 'Residential (R1) — established layout',
    permittedUses: ['residential_apartment', 'retail_unit'],
    farAllowed: 2.25,
    planningNote:
      'BBMP property-tax Zone C; RMP 2015 zoning is Residential (R1). A mature, largely built-out layout with limited redevelopment headroom under current setback and parking norms.',
    replacementCostPerSqm: 27000,
    // FAR 2.25 × (0.72×108,000 − 27,000) ≈ 114,200 → 114,000: ~1.06× the
    // built median — established and largely built out, but without the
    // extreme scarcity premium of Indiranagar/Koramangala/Jayanagar.
    medianLandRatePerSqm: 114000,
    statutoryLandRatePerSqm: 64000,
    infrastructureNote:
      'Green Line (JP Nagar station, part of the original Nagasandra–Yelachenahalli stretch) has been operational since 2021, giving direct CBD access without surface congestion.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-jayanagar',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Jayanagar',
    currency: 'INR',
    medianPricePerSqm: 132000,
    statutoryRatePerSqm: 80000,
    grossYield: 0.027,
    yoyChangePct: 5.5,
    liquidityDays: 50,
    sampleSize: 105,
    trend: buildTrend(132000, 5.5, 500),
    zoning: 'Residential (R1) — heritage layout, height-restricted in core blocks',
    permittedUses: ['residential_apartment', 'retail_unit'],
    farAllowed: 2.0,
    planningNote:
      'BBMP property-tax Zone B; RMP 2015 zoning is Residential (R1). One of BBMP\'s original planned layouts; heritage and height restrictions in the core blocks cap FAR below comparable-tier localities without that overlay.',
    replacementCostPerSqm: 30500,
    // FAR is capped at 2.0 by the heritage overlay, so the pure formula
    // (2.0 × (0.72×132,000 − 30,500) ≈ 129,100) only just clears the built
    // median; nudged to 137,000 (k≈0.75, ~1.04×) for the retail scarcity
    // premium a heritage core with almost no plot supply commands in
    // practice — one of the "very high land rate" localities alongside
    // Indiranagar and Koramangala, just capped lower by the FAR ceiling.
    medianLandRatePerSqm: 137000,
    statutoryLandRatePerSqm: 75000,
    infrastructureNote:
      'Green Line (Jayanagar station) is operational; the 4th Block shopping complex anchors local retail demand, while narrow internal roads cap the scale of any redevelopment.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-yelahanka',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Yelahanka',
    currency: 'INR',
    medianPricePerSqm: 68000,
    statutoryRatePerSqm: 40000,
    grossYield: 0.035,
    yoyChangePct: 10,
    liquidityDays: 60,
    sampleSize: 128,
    trend: buildTrend(68000, 10, 500),
    zoning: 'Residential (R2) — new-town / airport-corridor growth area',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 2.5,
    planningNote:
      'BBMP property-tax Zone D; RMP 2015 zoning is Residential (R2). The northern edge toward the airport carries a BIAAPA planning overlay and height restriction that a parcel-specific check should confirm before assuming full BBMP norms apply.',
    replacementCostPerSqm: 23000,
    // Active corridor (k≈0.76): 2.5 × (0.76×68,000 − 23,000) ≈ 71,700 →
    // 72,000, ~1.06× the built median. BDA/private layouts here sell
    // directly to retail plot buyers — one of the corridors sites genuinely
    // transact in.
    medianLandRatePerSqm: 72000,
    statutoryLandRatePerSqm: 35000,
    infrastructureNote:
      'The Blue Line airport extension (a planned Yelahanka station) is under construction; Bellary Road/NH44 gives current road access, but today\'s connectivity is entirely road-based.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-electronic-city',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Electronic City',
    currency: 'INR',
    medianPricePerSqm: 62000,
    statutoryRatePerSqm: 37000,
    grossYield: 0.038,
    yoyChangePct: 7,
    liquidityDays: 70,
    sampleSize: 158,
    trend: buildTrend(62000, 7, 500),
    zoning: 'Residential (R1/R2) with adjoining IT/ITES-SEZ zoning (Phase 1 & 2 tech parks)',
    permittedUses: ['residential_apartment', 'residential_villa', 'commercial_office'],
    farAllowed: 2.5,
    planningNote:
      'BBMP property-tax Zone E; RMP 2015 zoning is Residential (R1/R2) alongside IT/SEZ land use in the tech-park precincts. Falls mostly within BBMP\'s Bommanahalli zone (added 2007), though civic infrastructure inside the tech-park precincts is co-administered by ELCITA (Electronics City Industrial Township Authority) — confirm khata jurisdiction parcel-by-parcel rather than assuming uniform BBMP coverage across both phases.',
    replacementCostPerSqm: 23500,
    // 2.5 × (0.76×62,000 − 23,500) ≈ 59,100 → 59,000, just under the built
    // median (~0.95×) — plot supply here is genuinely thin (only a couple of
    // sites trade at all; most of the corridor is tech-park/apartment
    // stock), and commodity apartment pricing already prices in most of the
    // FAR uplift, so land sits at rough parity rather than well above it.
    medianLandRatePerSqm: 59000,
    statutoryLandRatePerSqm: 31000,
    infrastructureNote:
      'Yellow Line (RV Road–Bommasandra) commissioning was phased through 2024–2025 — verify current operational status for this stretch before treating it as delivered infrastructure. NICE Road and Hosur Road remain the historically congested surface routes.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-devanahalli',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Devanahalli',
    currency: 'INR',
    // Land-led market: pricing is per sqm of plotted/converted land, not built
    // apartment stock. Guidance value lags market median by roughly half here
    // (vs ~40% in the built-up city localities above) — peripheral, pre-
    // conversion land is exactly where guidance values are slowest to catch up
    // with speculative, infrastructure-anticipation pricing.
    medianPricePerSqm: 35000,
    statutoryRatePerSqm: 18000,
    // A nominal, low figure: this is a capital-appreciation/land-banking market,
    // not a rental-yield one, so the gross-yield field has limited meaning here
    // — flagged explicitly in the planning note rather than left to imply a
    // rent-driven return that does not really exist for most raw plots.
    grossYield: 0.015,
    yoyChangePct: 14,
    liquidityDays: 160,
    sampleSize: 38,
    trend: buildTrend(35000, 14, 500),
    zoning: 'Agricultural / residential — BIAAPA zonal regulations, conversion-dependent',
    permittedUses: ['residential_plot', 'residential_villa', 'land_parcel'],
    farAllowed: 1.5,
    planningNote:
      'Outside BBMP limits — administered under BIAAPA (Bengaluru International Airport Area Planning Authority) zonal regulations, with the surrounding taluk sitting in Bengaluru Rural district rather than Bengaluru Urban. No BBMP property-tax zone applies. Most parcels remain agricultural revenue land; DC conversion under Karnataka Land Revenue Act s.95 is a precondition for any residential or commercial use, and its absence is the most common reason a promising-looking plot here turns out to be undevelopable in the near term. This is a land-banking, infrastructure-anticipation market rather than a rental-yield one.',
    replacementCostPerSqm: 24000,
    // Exception to the FAR-dilution formula: `medianPricePerSqm` here already
    // IS a land/plotted rate, not an apartment rate (see the comment above),
    // so there is no multi-storey dilution to gross back up — the land rate
    // sits only modestly above its own median (comparables below transact in
    // the 31,800–36,500 band). Guidance keeps the same ~0.51 lag ratio as the
    // built figure, since it is the same DC guidance-value regime pricing the
    // same land.
    medianLandRatePerSqm: 37000,
    statutoryLandRatePerSqm: 19000,
    infrastructureNote:
      'Kempegowda International Airport anchors the corridor; the Blue Line metro extension to the airport, the Satellite Town Ring Road (STRR) and NH44 are the main medium-term catalysts, but all three are still under construction or planned — price appreciation here is substantially forward-looking and speculative, not backed by delivered infrastructure.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-kanakapura-road',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Kanakapura Road',
    currency: 'INR',
    medianPricePerSqm: 58000,
    statutoryRatePerSqm: 34000,
    grossYield: 0.033,
    yoyChangePct: 9,
    liquidityDays: 75,
    sampleSize: 96,
    trend: buildTrend(58000, 9, 500),
    zoning: 'Residential (R2) — growth corridor, BBMP inner stretch / BMRDA outer stretch',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 2.25,
    planningNote:
      'BBMP property-tax Zone E for the inner stretch (roughly up to Talaghattapura/Vajarahalli); beyond that the corridor passes into BMRDA-regulated and gram-panchayat areas before reaching Kanakapura town — treat jurisdiction as parcel-specific rather than assuming BBMP coverage along the full corridor. RMP 2015 zoning is Residential (R2).',
    replacementCostPerSqm: 23000,
    // Raw formula (k=0.76) gives 2.25 × (0.76×58,000 − 23,000) ≈ 47,400,
    // below the built median — but Kanakapura Road is a long-established
    // plotted-development corridor (Vajarahalli, Thalaghattapura and
    // similar BDA/BMRDA layouts) where individual home-builders compete for
    // a limited stock of good sites, a retail scarcity premium the pure
    // developer-economics formula does not capture. Nudged to 64,000
    // (~1.10× the built median) to reflect that — one of the corridors
    // sites genuinely transact in.
    medianLandRatePerSqm: 64000,
    statutoryLandRatePerSqm: 31000,
    infrastructureNote:
      'The Green Line\'s southern extension (Yelachenahalli–Silk Institute, via Konanakunte and Talaghattapura) runs along this corridor and is operational — one of the few outer growth corridors with delivered, not merely planned, metro access. NICE Road gives peripheral ring-road access.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  {
    id: 'in-blr-thanisandra-hennur',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Thanisandra/Hennur',
    currency: 'INR',
    medianPricePerSqm: 74000,
    statutoryRatePerSqm: 44000,
    grossYield: 0.032,
    yoyChangePct: 9.5,
    liquidityDays: 58,
    sampleSize: 118,
    trend: buildTrend(74000, 9.5, 500),
    zoning: 'Residential (R1/R2) — established growth corridor adjoining Manyata Tech Park',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 2.5,
    planningNote:
      'BBMP property-tax Zone D; RMP 2015 zoning is Residential (R1/R2). Adjoins the Manyata Tech Park employment cluster, which is the corridor\'s main rental-demand driver.',
    replacementCostPerSqm: 25500,
    // Active corridor (k≈0.76): 2.5 × (0.76×74,000 − 25,500) ≈ 76,900 →
    // 77,000, ~1.04× the built median — sites trade actively alongside the
    // Manyata-driven apartment demand.
    medianLandRatePerSqm: 77000,
    statutoryLandRatePerSqm: 40000,
    infrastructureNote:
      'Within commuting distance of the under-construction Blue Line station cluster around Hebbal; Hennur Road widening is underway. No metro station sits directly on this corridor today — connectivity is currently road-based.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  // --- Netherlands — Amsterdam -------------------------------------------------
  // Land-rate logic differs by locality here, not just by number:
  //  - Zuidas & De Pijp (Amsterdam): built out for decades/centuries, and
  //    Zuidas additionally sits substantially on municipal erfpacht
  //    (leasehold) rather than freehold — bare plots essentially never come
  //    to market. The figures are a conservative, notional back-calculation
  //    (not an observed transaction rate), and — because there is no
  //    independent market to pull ahead of the assessment — statutory sits
  //    much closer to median here (≈0.85–0.90×) than the ~0.5–0.6× typical
  //    where a real market exists. This is deliberate: it is how "plots
  //    barely transact" should look in the numbers, not an active market
  //    dressed up with a plausible-looking gap.
  //  - Kop van Zuid (Rotterdam) & Leidsche Rijn (Utrecht): both explicitly
  //    still have active build-out phases per their planningNote, so plots
  //    genuinely do trade — a normal ~0.55–0.58× statutory lag applies.
  //    Leidsche Rijn's low FAR (1.2, low-rise Vinex housing) means the
  //    FAR-dilution multiplier barely exceeds 1, so its land rate lands well
  //    BELOW the built rate — the mirror image of Bengaluru's high-FAR
  //    apartment markets, and a useful check that this isn't a formula
  //    hard-coded to always push land above built.
  {
    id: 'nl-ams-zuidas',
    country: 'NL',
    state: 'Noord-Holland',
    city: 'Amsterdam',
    locality: 'Zuidas',
    currency: 'EUR',
    medianPricePerSqm: 8200,
    statutoryRatePerSqm: 7400,
    grossYield: 0.056,
    yoyChangePct: 1.5,
    liquidityDays: 140,
    sampleSize: 26,
    trend: buildTrend(8200, 1.5, 50),
    zoning: 'Kantoren en gemengd stedelijk (Zuidas bestemmingsplan)',
    permittedUses: ['commercial_office', 'retail_unit'],
    farAllowed: 6,
    planningNote: 'High-rise business-district plan allows dense floor ratios; several dock plots retain unbuilt office entitlement under the Zuidasdok programme.',
    replacementCostPerSqm: 2650,
    // Formula (k=0.72, FAR 6) gives 6 × (0.72×8,200 − 2,650) ≈ 19,500 — the
    // extreme FAR makes the mechanical dilution-uplift implausibly large for
    // a market with no actual freehold bare-land sales to calibrate against.
    // Deliberately capped well below that to a conservative erfpacht-canon
    // style grondwaarde instead (~1.46× built) rather than presenting false
    // precision on a market that does not really transact.
    medianLandRatePerSqm: 12000,
    statutoryLandRatePerSqm: 10800,
    infrastructureNote: 'Zuid station gives direct rail/metro/international connections; the Zuidasdok infrastructure works are an ongoing construction-noise consideration through the decade.',
    source: 'Kadaster — non-residential transaction register',
  },
  {
    id: 'nl-ams-de-pijp',
    country: 'NL',
    state: 'Noord-Holland',
    city: 'Amsterdam',
    locality: 'De Pijp',
    currency: 'EUR',
    medianPricePerSqm: 7900,
    statutoryRatePerSqm: 7300,
    grossYield: 0.038,
    yoyChangePct: 6.5,
    liquidityDays: 28,
    sampleSize: 112,
    trend: buildTrend(7900, 6.5, 50),
    zoning: 'Wonen — gemengd binnenstedelijk',
    permittedUses: ['residential_apartment', 'retail_unit'],
    farAllowed: 2.4,
    planningNote: 'Dense pre-war building blocks are largely built out; municipal policy restricts short-stay letting, which affects buy-to-let assumptions.',
    replacementCostPerSqm: 2150,
    // 2.4 × (0.72×7,900 − 2,150) ≈ 8,500, ~1.08× built — modest since De
    // Pijp's dense pre-war blocks are fully built out and a bare plot here
    // would only ever arise from a rare demolition/infill, not a market.
    medianLandRatePerSqm: 8500,
    statutoryLandRatePerSqm: 7200,
    infrastructureNote: 'Well served by tram lines and the Ferdinand Bolstraat/Albert Cuyp retail strip; on-street parking permits are capped.',
    source: 'CBS/NVM transaction statistics — Amsterdam',
  },
  // --- Netherlands — Rotterdam -------------------------------------------------
  {
    id: 'nl-rot-kop-van-zuid',
    country: 'NL',
    state: 'Zuid-Holland',
    city: 'Rotterdam',
    locality: 'Kop van Zuid',
    currency: 'EUR',
    medianPricePerSqm: 5200,
    statutoryRatePerSqm: 4600,
    grossYield: 0.046,
    yoyChangePct: 7.5,
    liquidityDays: 45,
    sampleSize: 68,
    trend: buildTrend(5200, 7.5, 50),
    zoning: 'Gemengd — wonen, kantoor, voorzieningen',
    permittedUses: ['residential_apartment', 'commercial_office', 'retail_unit'],
    farAllowed: 3.2,
    planningNote: 'Former harbour redevelopment area still has several plots in active build-out; mixed-use zoning gives flexibility on end use.',
    replacementCostPerSqm: 2300,
    // Active redevelopment area (k=0.76): 3.2 × (0.76×5,200 − 2,300) ≈ 5,300,
    // roughly at parity with the built rate — remaining harbour-redevelopment
    // plots genuinely do trade here, unlike the two Amsterdam localities.
    medianLandRatePerSqm: 5300,
    statutoryLandRatePerSqm: 3100,
    infrastructureNote: 'Erasmus Bridge and Wilhelminapier metro access anchor the district; ongoing quayside development is a medium-term amenity upside.',
    source: 'CBS/NVM transaction statistics — Rotterdam',
  },
  // --- Netherlands — Utrecht -------------------------------------------------
  {
    id: 'nl-utr-leidsche-rijn',
    country: 'NL',
    state: 'Utrecht',
    city: 'Utrecht',
    locality: 'Leidsche Rijn',
    currency: 'EUR',
    medianPricePerSqm: 4800,
    statutoryRatePerSqm: 4300,
    grossYield: 0.042,
    yoyChangePct: 5,
    liquidityDays: 35,
    sampleSize: 95,
    trend: buildTrend(4800, 5, 50),
    zoning: 'Wonen — Vinex uitbreidingswijk',
    permittedUses: ['residential_apartment', 'residential_villa'],
    farAllowed: 1.2,
    planningNote: 'Low-rise Vinex-era masterplan; remaining build phases (Leidsche Rijn Centrum) will add retail and density over the next decade.',
    replacementCostPerSqm: 1950,
    // 1.2 × (0.76×4,800 − 1,950) ≈ 2,000, well BELOW the built rate — the
    // mirror image of the high-FAR Bengaluru/office markets above: low-rise
    // Vinex housing has little floor-area dilution, so a bare building plot
    // (kavel) here genuinely sells for a fraction of the finished home's sqm
    // rate, matching how Dutch greenfield land actually prices.
    medianLandRatePerSqm: 2000,
    statutoryLandRatePerSqm: 1100,
    infrastructureNote: 'Utrecht Leidsche Rijn rail station and A2 motorway access; local amenities are still catching up to population growth.',
    source: 'CBS/NVM transaction statistics — Utrecht',
  },
];

/* ==================================================================== */
/* Water exposure — catchment, not parcel                                */
/* ==================================================================== */

/**
 * Which of Bengaluru's three storm-water valleys each locality drains
 * through, and how exposed it is to flooding.
 *
 * --- On what this is sourced from ----------------------------------------
 *
 * The valley assignment and the lake chains are structural: the city drains
 * through the Vrishabhavathi, Koramangala–Challaghatta and Hebbal–Nagavara
 * systems, these are the systems the Revised Master Plan and the BBMP
 * storm-water drain network are organised around, and a locality's place in
 * one of them does not move. The exposure grade is a compiled judgement from
 * reported inundation across recent monsoons, not a reading off a published
 * hazard raster — which is exactly why it is carried with an `asOf`, a
 * `source` that says what it actually is, and a `verifyNote` naming the
 * authority a reader must go to.
 *
 * That is the same discipline the State Pack applies to stamp-duty slabs and
 * buffer distances, and for the same reason: a figure whose provenance is
 * overstated is worse than one that admits its limits, because a reader
 * cannot tell the difference until it costs them.
 *
 * --- The line this must not cross ----------------------------------------
 *
 * Every entry here describes a *locality*. A site on high ground in
 * Bellandur does not flood because Bellandur floods, and a site in a filled
 * tank bed in low-exposure Jayanagar may flood every year. The engine states
 * this as catchment exposure and never as a prediction about the parcel, and
 * the consequence it draws — go and check the ward drain map and the
 * property's own levels — is the same either way.
 */

const WATER_SOURCE =
  'Compiled from the BBMP/BDA storm-water valley system in the Revised Master Plan and reported monsoon inundation; ' +
  'exposure grade is a compiled judgement, not a published hazard classification';
const WATER_AS_OF = '2025-01-01';
const WATER_VERIFY =
  'Confirm against the BBMP ward-level storm-water drain map and the ward flood-vulnerability list for the specific ' +
  'survey number, and have a licensed surveyor take levels — a locality grade says nothing about where this parcel sits ' +
  'within it.';

const WATER_EXPOSURE: Record<string, Omit<WaterExposureReference, 'source' | 'asOf' | 'verifyNote'>> = {
  'in-blr-whitefield': {
    floodExposure: 'moderate',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Varthur–Belandur lake chain (lower K&C valley)',
    knownInundationPoints: ['Varthur Kodi', 'Gunjur', 'Siddapura junction'],
    note:
      'Whitefield sits at the lower end of the Koramangala–Challaghatta valley, downstream of the Bellandur–Varthur chain. ' +
      'Flooding here concentrates in the low-lying pockets around the Varthur tank and along the drains feeding it, rather ' +
      'than across the corridor generally.',
  },
  'in-blr-indiranagar': {
    floodExposure: 'moderate',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Upper K&C valley — Domlur/Challaghatta drain',
    knownInundationPoints: ['Domlur underpass', '100ft Road low points'],
    note:
      'Upper reaches of the K&C valley on generally higher, older, fully built ground. Surface flooding is a drainage-capacity ' +
      'problem at specific junctions rather than lake or valley inundation.',
  },
  'in-blr-sarjapur-road': {
    floodExposure: 'high',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Agara–Bellandur lake chain',
    knownInundationPoints: ['Rainbow Drive layout', 'Sunny Brooks', 'Kasavanahalli', 'Halanayakanahalli'],
    note:
      'Among the most flood-affected corridors in the city. Layouts along this stretch were developed rapidly on and around ' +
      'the Agara–Bellandur catchment, several of them across tank beds and rajakaluve alignments, and gated communities here ' +
      'have been inundated to first-floor level in recent monsoons. Buffer encroachment and flooding are the same question on ' +
      'this corridor.',
  },
  'in-blr-orr-bellandur': {
    floodExposure: 'high',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Bellandur–Varthur lake chain',
    knownInundationPoints: ['Bellandur tank bed periphery', 'ORR service roads', 'Devarabisanahalli'],
    note:
      'The corridor sits on the Bellandur tank catchment — the largest in the city and the trunk of the K&C valley. ' +
      'Office campuses along the ORR here have been cut off by flooding within the last few monsoons. For a commercial asset ' +
      'this is a business-interruption and tenant-retention question as much as a physical one.',
  },
  'in-blr-hebbal': {
    floodExposure: 'moderate',
    valley: 'hebbal_nagavara',
    lakeChain: 'Hebbal–Nagavara lake chain',
    knownInundationPoints: ['Hebbal flyover underpasses', 'Nagavara tank periphery'],
    note:
      'Head of the Hebbal–Nagavara valley. The lakes here hold and release rather than back up the way the K&C chain does, so ' +
      'exposure is concentrated at underpasses and immediate tank peripheries.',
  },
  'in-blr-koramangala': {
    floodExposure: 'high',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Koramangala valley trunk drain',
    knownInundationPoints: ['Koramangala 3rd Block', 'Ejipura', 'Sony World junction'],
    note:
      'The valley is named after this locality for a reason: the primary storm-water trunk runs through it, and several blocks ' +
      'sit below the drain level. Repeated inundation here is a drainage-capacity failure on a primary valley line, which is ' +
      'the hardest kind to remedy at a single property.',
  },
  'in-blr-hsr-layout': {
    floodExposure: 'high',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Agara lake / Somasundarapalya tank',
    knownInundationPoints: ['Somasundarapalya', 'Sector 2 low points', 'Agara lake periphery'],
    note:
      'Built across the Agara catchment with several sectors on former tank and drain alignments. Sector-level differences are ' +
      'large here — two addresses a kilometre apart can have entirely different histories.',
  },
  'in-blr-jp-nagar': {
    floodExposure: 'moderate',
    valley: 'vrishabhavathi',
    lakeChain: 'Puttenahalli–Sarakki tank chain',
    knownInundationPoints: ['Sarakki tank periphery', 'Puttenahalli low points'],
    note:
      'Vrishabhavathi valley on generally higher ground, with exposure concentrated around the Sarakki and Puttenahalli tank ' +
      'peripheries rather than across the locality.',
  },
  'in-blr-jayanagar': {
    floodExposure: 'low',
    valley: 'vrishabhavathi',
    lakeChain: 'Upper Vrishabhavathi',
    knownInundationPoints: [],
    note:
      'Old, planned, high-ground Bengaluru with a drainage network laid out with the layout itself. No recurring inundation is ' +
      'recorded at locality level — which is a statement about the locality and not a guarantee about any parcel in it, ' +
      'particularly one on a filled tank bed.',
  },
  'in-blr-yelahanka': {
    floodExposure: 'low',
    valley: 'hebbal_nagavara',
    lakeChain: 'Yelahanka–Allalasandra tank chain',
    knownInundationPoints: ['Allalasandra tank periphery'],
    note:
      'Upper catchment of the Hebbal–Nagavara valley, above most of the chain. Exposure is local to the tank peripheries.',
  },
  'in-blr-electronic-city': {
    floodExposure: 'moderate',
    valley: 'koramangala_challaghatta',
    lakeChain: 'Begur–Hulimavu tank chain',
    knownInundationPoints: ['Begur road low points', 'Hulimavu tank periphery'],
    note:
      'Sits across the Begur–Hulimavu chain at the southern edge of the K&C system. A tank breach on this chain has caused ' +
      'sudden localised flooding, which is a different risk profile from the slow backing-up seen on the Bellandur trunk.',
  },
  'in-blr-devanahalli': {
    floodExposure: 'low',
    valley: 'hebbal_nagavara',
    lakeChain: 'Upper Hebbal–Nagavara catchment',
    knownInundationPoints: [],
    note:
      'High upper catchment near the airport, well above the lake chains that cause the city\'s recurring flooding. The water ' +
      'question on this corridor is supply rather than inundation: much of it is outside the piped network and on borewells.',
  },
  'in-blr-kanakapura-road': {
    floodExposure: 'moderate',
    valley: 'vrishabhavathi',
    lakeChain: 'Vrishabhavathi valley — Talaghattapura/Konanakunte tanks',
    knownInundationPoints: ['Konanakunte cross', 'Vajarahalli'],
    note:
      'Vrishabhavathi valley on a corridor developing fast enough that drainage is being laid behind the building rather than ' +
      'ahead of it. Exposure is concentrated on the tank alignments the new layouts sit across.',
  },
  'in-blr-thanisandra-hennur': {
    floodExposure: 'moderate',
    valley: 'hebbal_nagavara',
    lakeChain: 'Rachenahalli–Nagavara tank chain',
    knownInundationPoints: ['Rachenahalli tank periphery', 'Thanisandra main road low points'],
    note:
      'Built rapidly across the Rachenahalli and Nagavara catchment. Several layouts here sit on or beside tank alignments, so ' +
      'the buffer question and the flooding question are closely linked on this corridor too.',
  },
};

/* ==================================================================== */
/* Aerodrome proximity                                                   */
/* ==================================================================== */

/**
 * Which aerodrome is near enough to a locality that its height restrictions
 * may reach it, and roughly how far.
 *
 * Two aerodromes matter in Bengaluru and they do different things. Kempegowda
 * International in the north is a live international airport with the full
 * obstacle-limitation apparatus around it, and the growth corridors selling
 * hardest on FAR headroom — Devanahalli, Yelahanka, the airport road — sit
 * inside its notified vicinity. HAL in the east is a working defence and
 * general-aviation aerodrome whose approach funnel crosses the older eastern
 * suburbs, and a great many buyers there have no idea it constrains anything.
 *
 * --- What the distance is, and is not ------------------------------------
 *
 * `approxKm` is an indicative locality-to-aerodrome figure whose only job is
 * to raise the question on a case that has no map lookup. It is not the input
 * to any height calculation and the engine never treats it as one: the cap is
 * computed by AAI from the site's own coordinates against surfaces that vary
 * with bearing and terrain, which is exactly why the check tells the reader to
 * apply for the NOC rather than quoting them a number.
 *
 * Where a site context has actually measured the distance to an airport, the
 * engine prefers the measurement — the same estimated-versus-measured split
 * the transit driver uses.
 */
const AERODROMES: Record<string, AerodromeReference> = {
  'in-blr-devanahalli': {
    name: 'Kempegowda International Airport (BLR)',
    approxKm: 5,
    note: 'The locality adjoins the airport. Height restriction is not a background consideration here — it is the first question to ask about any development plan.',
  },
  'in-blr-yelahanka': {
    name: 'Kempegowda International Airport (BLR)',
    approxKm: 18,
    note: 'Inside the airport\'s notified vicinity, and additionally near the Yelahanka Air Force Station, which carries its own restrictions.',
  },
  'in-blr-thanisandra-hennur': {
    name: 'Kempegowda International Airport (BLR)',
    approxKm: 22,
    note: 'On the airport corridor. Whether a specific site falls inside the restricted vicinity depends on where it sits along the corridor.',
  },
  'in-blr-hebbal': {
    name: 'Kempegowda International Airport (BLR)',
    approxKm: 26,
    note: 'At the city end of the airport corridor, generally outside the tightest surfaces but close enough that a tall proposal should be checked.',
  },
  'in-blr-indiranagar': {
    name: 'HAL Airport (VOBG)',
    approxKm: 4,
    note: 'Close to the HAL aerodrome, which is a working defence and general-aviation airfield. Its approach funnel constrains height across the older eastern suburbs, and most buyers here do not know it exists as a planning constraint.',
  },
  'in-blr-whitefield': {
    name: 'HAL Airport (VOBG)',
    approxKm: 11,
    note: 'Within reach of the HAL aerodrome\'s surfaces along parts of the corridor. Worth confirming for any proposal above a few floors.',
  },
};

/**
 * Localities with their water exposure attached.
 *
 * Joined here rather than written inline on each entry so the exposure table
 * can be read, reviewed and re-dated as one thing — it has a single `asOf`
 * and a single provenance, and scattering it through fourteen literals would
 * make that impossible to see. A locality with no entry keeps
 * `waterExposure` undefined, which the engine reports as "not assessed"
 * rather than as low.
 */
export const LOCALITIES: LocalityReference[] = LOCALITY_BASE.map(locality => {
  const exposure = WATER_EXPOSURE[locality.id];
  const aerodrome = AERODROMES[locality.id];
  return {
    ...locality,
    ...(exposure ? { waterExposure: { ...exposure, source: WATER_SOURCE, asOf: WATER_AS_OF, verifyNote: WATER_VERIFY } } : {}),
    ...(aerodrome ? { aerodrome } : {}),
  };
});

/* ------------------------------------------------------------------ */
/* Comparable pool                                                     */
/* ------------------------------------------------------------------ */

let comparableCounter = 0;

function mkComparable(opts: {
  localityKey: string;
  label: string;
  address: string;
  distanceKm: number;
  propertyType: PropertyType;
  areaSqm: number;
  transactedAt: string;
  pricePerSqm: number;
  source: string;
  /** Rounding granularity for the derived `price` field — 1000 for INR, 100 for EUR. */
  roundTo: number;
}): Comparable {
  comparableCounter += 1;
  const price = Math.round((opts.pricePerSqm * opts.areaSqm) / opts.roundTo) * opts.roundTo;
  return {
    id: `cmp-${opts.localityKey}-${String(comparableCounter).padStart(3, '0')}`,
    label: opts.label,
    address: opts.address,
    distanceKm: opts.distanceKm,
    propertyType: opts.propertyType,
    areaSqm: opts.areaSqm,
    transactedAt: opts.transactedAt,
    price,
    pricePerSqm: opts.pricePerSqm,
    // The pool holds raw, unadjusted transactions — `runScreen` applies
    // case-specific adjustments and overwrites `adjustedPricePerSqm` and
    // `similarity` on the copies it returns.
    adjustments: [],
    adjustedPricePerSqm: opts.pricePerSqm,
    source: opts.source,
    similarity: 0.7,
  };
}

const IGR_BLR = 'State Registration Department (IGR) — Bengaluru Urban registrations';
const KADASTER_NONRES = 'Kadaster — non-residential transaction register';
const NVM_AMS = 'CBS/NVM transaction statistics — Amsterdam';
const NVM_ROT = 'CBS/NVM transaction statistics — Rotterdam';
const NVM_UTR = 'CBS/NVM transaction statistics — Utrecht';

export const COMPARABLE_POOL: Comparable[] = [
  // --- Whitefield, Bengaluru (5) ---
  mkComparable({ localityKey: 'blr-whitefield', label: 'Prestige Shantiniketan — Tower 4', address: 'Prestige Shantiniketan, Tower 4, Whitefield, Bengaluru, Karnataka', distanceKm: 0.8, propertyType: 'residential_apartment', areaSqm: 128, transactedAt: '2025-11-02', pricePerSqm: 89500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-whitefield', label: 'Brigade Meadows Phase 2', address: 'Brigade Meadows, Phase 2, Whitefield, Bengaluru, Karnataka', distanceKm: 1.4, propertyType: 'residential_apartment', areaSqm: 102, transactedAt: '2025-06-14', pricePerSqm: 94200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-whitefield', label: 'Sobha Dream Acres', address: 'Sobha Dream Acres, Whitefield, Bengaluru, Karnataka', distanceKm: 2.1, propertyType: 'residential_apartment', areaSqm: 78, transactedAt: '2024-12-20', pricePerSqm: 91000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-whitefield', label: 'Godrej Woods Enclave', address: 'Godrej Woods Enclave, Whitefield, Bengaluru, Karnataka', distanceKm: 0.5, propertyType: 'residential_apartment', areaSqm: 145, transactedAt: '2026-03-05', pricePerSqm: 97800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-whitefield', label: 'Purva Palm Beach', address: 'Purva Palm Beach, Whitefield, Bengaluru, Karnataka', distanceKm: 1.9, propertyType: 'residential_apartment', areaSqm: 118, transactedAt: '2025-02-18', pricePerSqm: 88600, source: IGR_BLR, roundTo: 1000 }),

  // --- Indiranagar, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-indiranagar', label: '100 Feet Road Residency', address: '100 Feet Road Residency, Indiranagar, Bengaluru, Karnataka', distanceKm: 0.6, propertyType: 'residential_apartment', areaSqm: 95, transactedAt: '2025-09-10', pricePerSqm: 152000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-indiranagar', label: '12th Main Heritage Apartments', address: '12th Main Heritage Apartments, Indiranagar, Bengaluru, Karnataka', distanceKm: 1.2, propertyType: 'residential_apartment', areaSqm: 110, transactedAt: '2024-10-22', pricePerSqm: 147500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-indiranagar', label: 'Defence Colony Residency', address: 'Defence Colony Residency, Indiranagar, Bengaluru, Karnataka', distanceKm: 0.9, propertyType: 'residential_apartment', areaSqm: 88, transactedAt: '2026-01-15', pricePerSqm: 155300, source: IGR_BLR, roundTo: 1000 }),

  // --- Sarjapur Road, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-sarjapur', label: 'Godrej Bengaluru Skyline', address: 'Godrej Bengaluru Skyline, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 1.1, propertyType: 'residential_apartment', areaSqm: 132, transactedAt: '2025-07-08', pricePerSqm: 64000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-sarjapur', label: 'Shriram Chirping Woods', address: 'Shriram Chirping Woods, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 2.4, propertyType: 'residential_apartment', areaSqm: 98, transactedAt: '2025-12-30', pricePerSqm: 68500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-sarjapur', label: 'Sumadhura Silver Ripples', address: 'Sumadhura Silver Ripples, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 1.7, propertyType: 'residential_apartment', areaSqm: 115, transactedAt: '2024-09-16', pricePerSqm: 65800, source: IGR_BLR, roundTo: 1000 }),

  // --- Outer Ring Road (Bellandur), Bengaluru (5) ---
  mkComparable({ localityKey: 'blr-orr-bellandur', label: 'Embassy Tech Village — Block C', address: 'Embassy Tech Village, Block C, Outer Ring Road (Bellandur), Bengaluru, Karnataka', distanceKm: 0.9, propertyType: 'commercial_office', areaSqm: 720, transactedAt: '2025-08-21', pricePerSqm: 91500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-orr-bellandur', label: 'Cessna Business Park — Tower 2', address: 'Cessna Business Park, Tower 2, Outer Ring Road (Bellandur), Bengaluru, Karnataka', distanceKm: 1.6, propertyType: 'commercial_office', areaSqm: 540, transactedAt: '2025-03-12', pricePerSqm: 88200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-orr-bellandur', label: 'Prestige Tech Park IV', address: 'Prestige Tech Park IV, Outer Ring Road (Bellandur), Bengaluru, Karnataka', distanceKm: 2.3, propertyType: 'commercial_office', areaSqm: 860, transactedAt: '2026-01-29', pricePerSqm: 94700, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-orr-bellandur', label: 'Ecospace Business Park — Block 4', address: 'Ecospace Business Park, Block 4, Outer Ring Road (Bellandur), Bengaluru, Karnataka', distanceKm: 1.1, propertyType: 'commercial_office', areaSqm: 610, transactedAt: '2024-11-08', pricePerSqm: 83400, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-orr-bellandur', label: 'Kalyani Tech Park Annexe', address: 'Kalyani Tech Park Annexe, Outer Ring Road (Bellandur), Bengaluru, Karnataka', distanceKm: 2.8, propertyType: 'commercial_office', areaSqm: 470, transactedAt: '2025-06-03', pricePerSqm: 85900, source: IGR_BLR, roundTo: 1000 }),

  // --- Hebbal, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-hebbal', label: 'Godrej Air NXT', address: 'Godrej Air NXT, Hebbal, Bengaluru, Karnataka', distanceKm: 0.8, propertyType: 'residential_apartment', areaSqm: 116, transactedAt: '2025-09-25', pricePerSqm: 81300, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hebbal', label: 'Brigade Northridge', address: 'Brigade Northridge, Hebbal, Bengaluru, Karnataka', distanceKm: 1.9, propertyType: 'residential_apartment', areaSqm: 94, transactedAt: '2025-01-17', pricePerSqm: 76800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hebbal', label: 'Sobha Lake Gardens', address: 'Sobha Lake Gardens, Hebbal, Bengaluru, Karnataka', distanceKm: 2.5, propertyType: 'residential_apartment', areaSqm: 138, transactedAt: '2026-02-06', pricePerSqm: 83900, source: IGR_BLR, roundTo: 1000 }),

  // --- Koramangala, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-koramangala', label: '5th Block Garden Residency', address: '5th Block Garden Residency, Koramangala, Bengaluru, Karnataka', distanceKm: 0.7, propertyType: 'residential_apartment', areaSqm: 102, transactedAt: '2025-10-14', pricePerSqm: 141500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-koramangala', label: '80 Feet Road Retail Parade', address: '80 Feet Road Retail Parade, Koramangala, Bengaluru, Karnataka', distanceKm: 1.0, propertyType: 'retail_unit', areaSqm: 165, transactedAt: '2025-04-30', pricePerSqm: 158000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-koramangala', label: '6th Block Court Apartments', address: '6th Block Court Apartments, Koramangala, Bengaluru, Karnataka', distanceKm: 1.5, propertyType: 'residential_apartment', areaSqm: 87, transactedAt: '2024-12-02', pricePerSqm: 134200, source: IGR_BLR, roundTo: 1000 }),

  // --- HSR Layout, Bengaluru (4) ---
  mkComparable({ localityKey: 'blr-hsr', label: 'Salarpuria Sattva East Crest', address: 'Salarpuria Sattva East Crest, HSR Layout, Bengaluru, Karnataka', distanceKm: 0.6, propertyType: 'residential_apartment', areaSqm: 128, transactedAt: '2025-09-05', pricePerSqm: 119500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hsr', label: 'Mantri Espana', address: 'Mantri Espana, HSR Layout, Bengaluru, Karnataka', distanceKm: 1.3, propertyType: 'residential_apartment', areaSqm: 96, transactedAt: '2025-02-11', pricePerSqm: 114800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hsr', label: 'Sector 2 Lakeview Residency', address: 'Sector 2 Lakeview Residency, HSR Layout, Bengaluru, Karnataka', distanceKm: 1.9, propertyType: 'residential_apartment', areaSqm: 142, transactedAt: '2024-11-27', pricePerSqm: 122300, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hsr', label: '27th Main Business Suites', address: '27th Main Business Suites, HSR Layout, Bengaluru, Karnataka', distanceKm: 0.9, propertyType: 'retail_unit', areaSqm: 85, transactedAt: '2026-01-08', pricePerSqm: 131000, source: IGR_BLR, roundTo: 1000 }),

  // --- JP Nagar, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-jpnagar', label: 'Purva Westend', address: 'Purva Westend, JP Nagar, Bengaluru, Karnataka', distanceKm: 1.1, propertyType: 'residential_apartment', areaSqm: 118, transactedAt: '2025-07-19', pricePerSqm: 109200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-jpnagar', label: 'Mantri Synergy', address: 'Mantri Synergy, JP Nagar, Bengaluru, Karnataka', distanceKm: 0.7, propertyType: 'residential_apartment', areaSqm: 92, transactedAt: '2025-03-02', pricePerSqm: 104500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-jpnagar', label: '7th Phase Residency', address: '7th Phase Residency, JP Nagar, Bengaluru, Karnataka', distanceKm: 2.0, propertyType: 'residential_apartment', areaSqm: 105, transactedAt: '2024-10-08', pricePerSqm: 106900, source: IGR_BLR, roundTo: 1000 }),

  // --- Jayanagar, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-jayanagar', label: '4th Block Heritage Residency', address: '4th Block Heritage Residency, Jayanagar, Bengaluru, Karnataka', distanceKm: 0.5, propertyType: 'residential_apartment', areaSqm: 110, transactedAt: '2025-08-14', pricePerSqm: 134800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-jayanagar', label: 'Adarsh Welkin Park', address: 'Adarsh Welkin Park, Jayanagar, Bengaluru, Karnataka', distanceKm: 1.4, propertyType: 'residential_apartment', areaSqm: 98, transactedAt: '2025-01-26', pricePerSqm: 128600, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-jayanagar', label: '9th Block Residency Court', address: '9th Block Residency Court, Jayanagar, Bengaluru, Karnataka', distanceKm: 1.8, propertyType: 'residential_apartment', areaSqm: 88, transactedAt: '2026-02-19', pricePerSqm: 137200, source: IGR_BLR, roundTo: 1000 }),

  // --- Yelahanka, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-yelahanka', label: 'Brigade Calista', address: 'Brigade Calista, Yelahanka, Bengaluru, Karnataka', distanceKm: 1.2, propertyType: 'residential_apartment', areaSqm: 108, transactedAt: '2025-06-06', pricePerSqm: 66500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-yelahanka', label: 'Century Regalia', address: 'Century Regalia, Yelahanka, Bengaluru, Karnataka', distanceKm: 2.1, propertyType: 'residential_apartment', areaSqm: 92, transactedAt: '2025-11-23', pricePerSqm: 70200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-yelahanka', label: 'New Town Garden Residency', address: 'New Town Garden Residency, Yelahanka, Bengaluru, Karnataka', distanceKm: 0.8, propertyType: 'residential_apartment', areaSqm: 124, transactedAt: '2024-09-30', pricePerSqm: 64800, source: IGR_BLR, roundTo: 1000 }),

  // --- Electronic City, Bengaluru (4) ---
  mkComparable({ localityKey: 'blr-ecity', label: 'Sobha Dream Gardenia', address: 'Sobha Dream Gardenia, Electronic City, Bengaluru, Karnataka', distanceKm: 1.5, propertyType: 'residential_apartment', areaSqm: 96, transactedAt: '2025-05-15', pricePerSqm: 60800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-ecity', label: 'Provident Welworth City', address: 'Provident Welworth City, Electronic City, Bengaluru, Karnataka', distanceKm: 2.3, propertyType: 'residential_apartment', areaSqm: 88, transactedAt: '2025-10-02', pricePerSqm: 58900, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-ecity', label: 'Phase 1 Tech Residency', address: 'Phase 1 Tech Residency, Electronic City, Bengaluru, Karnataka', distanceKm: 0.9, propertyType: 'residential_apartment', areaSqm: 112, transactedAt: '2024-12-11', pricePerSqm: 63500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-ecity', label: 'Infosys Avenue Business Park', address: 'Infosys Avenue Business Park, Electronic City, Bengaluru, Karnataka', distanceKm: 1.1, propertyType: 'commercial_office', areaSqm: 480, transactedAt: '2026-01-20', pricePerSqm: 72000, source: IGR_BLR, roundTo: 1000 }),

  // --- Devanahalli, Bengaluru (6, plotted land) ---
  mkComparable({ localityKey: 'blr-devanahalli', label: 'Aerocity Layout Plot 42', address: 'Aerocity Layout Plot 42, Devanahalli, Bengaluru, Karnataka', distanceKm: 3.2, propertyType: 'residential_plot', areaSqm: 240, transactedAt: '2025-07-28', pricePerSqm: 34200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-devanahalli', label: 'Bettahalasuru Garden Plots', address: 'Bettahalasuru Garden Plots, Devanahalli, Bengaluru, Karnataka', distanceKm: 4.5, propertyType: 'residential_plot', areaSqm: 300, transactedAt: '2025-02-14', pricePerSqm: 31800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-devanahalli', label: 'Sadahalli Cross Villa Plot', address: 'Sadahalli Cross Villa Plot, Devanahalli, Bengaluru, Karnataka', distanceKm: 2.8, propertyType: 'residential_plot', areaSqm: 200, transactedAt: '2024-11-05', pricePerSqm: 36500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-devanahalli', label: 'Bagalur Cross Corner Site, 40x60 East-facing', address: 'Bagalur Cross Corner Site, Devanahalli, Bengaluru, Karnataka', distanceKm: 5.0, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-05-20', pricePerSqm: 38500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-devanahalli', label: 'Vishwanathapura Layout Site No. 18, 30x40', address: 'Vishwanathapura Layout, Site No. 18, Devanahalli, Bengaluru, Karnataka', distanceKm: 3.8, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-12-11', pricePerSqm: 35200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-devanahalli', label: 'BMRDA Layout Site, 50x80 North-facing', address: 'BMRDA Layout, Devanahalli, Bengaluru, Karnataka', distanceKm: 6.1, propertyType: 'residential_plot', areaSqm: 372, transactedAt: '2026-04-02', pricePerSqm: 39800, source: IGR_BLR, roundTo: 1000 }),

  // --- Kanakapura Road, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-kanakapura', label: 'Provident Sunworth City', address: 'Provident Sunworth City, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 1.6, propertyType: 'residential_apartment', areaSqm: 102, transactedAt: '2025-04-17', pricePerSqm: 57200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-kanakapura', label: 'Shriram Chirping Meadows', address: 'Shriram Chirping Meadows, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 2.4, propertyType: 'residential_apartment', areaSqm: 118, transactedAt: '2025-09-29', pricePerSqm: 59800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-kanakapura', label: 'Silk Institute Residency', address: 'Silk Institute Residency, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 0.9, propertyType: 'residential_apartment', areaSqm: 88, transactedAt: '2024-12-19', pricePerSqm: 55600, source: IGR_BLR, roundTo: 1000 }),

  // --- Thanisandra/Hennur, Bengaluru (3) ---
  mkComparable({ localityKey: 'blr-thanisandra', label: 'Prestige Jindal City', address: 'Prestige Jindal City, Thanisandra/Hennur, Bengaluru, Karnataka', distanceKm: 1.0, propertyType: 'residential_apartment', areaSqm: 108, transactedAt: '2025-08-01', pricePerSqm: 75400, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-thanisandra', label: 'Godrej Air NXT Extension', address: 'Godrej Air NXT Extension, Thanisandra/Hennur, Bengaluru, Karnataka', distanceKm: 1.8, propertyType: 'residential_apartment', areaSqm: 96, transactedAt: '2025-03-14', pricePerSqm: 72300, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-thanisandra', label: 'Nagavara Lake View Residency', address: 'Nagavara Lake View Residency, Thanisandra/Hennur, Bengaluru, Karnataka', distanceKm: 2.2, propertyType: 'residential_apartment', areaSqm: 128, transactedAt: '2024-11-30', pricePerSqm: 76800, source: IGR_BLR, roundTo: 1000 }),

  // ===================================================================
  // Bengaluru land / plot comparables (site transactions, not built stock)
  //
  // Weighted to the corridors where sites genuinely trade — Devanahalli
  // (above), Kanakapura Road, Yelahanka and Sarjapur Road most heavily, then
  // Hebbal and Thanisandra/Hennur, with only a couple each in Whitefield and
  // Electronic City where plot supply is thin. Sizes are standard Bengaluru
  // site dimensions (30x40 ft ≈ 111 sqm, 40x60 ft ≈ 223 sqm, 50x80 ft ≈ 372
  // sqm); `areaSqm` is plot area and `pricePerSqm` is the land rate, both
  // scattered around each locality's `medianLandRatePerSqm` in reference.ts
  // above with a modest corner/road-width/facing premium or discount, which
  // is exactly what `runScreen`'s plot-attribute adjustments are meant to
  // explain rather than leaving as unexplained scatter.
  // ===================================================================

  // --- Kanakapura Road, Bengaluru (3, plotted land) ---
  mkComparable({ localityKey: 'blr-kanakapura', label: 'BMRDA Layout Site No. 9, 30x40 West-facing', address: 'BMRDA Approved Layout, Thalaghattapura, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 2.6, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-06-25', pricePerSqm: 63000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-kanakapura', label: 'Corner site, 40x60, 60ft road', address: 'Vajarahalli Layout Corner Site, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 3.4, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-10-09', pricePerSqm: 68500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-kanakapura', label: 'Konanakunte Cross Site No. 76, 40x60', address: 'Konanakunte Cross, Site No. 76, Kanakapura Road, Bengaluru, Karnataka', distanceKm: 4.0, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2024-11-14', pricePerSqm: 59500, source: IGR_BLR, roundTo: 1000 }),

  // --- Yelahanka, Bengaluru (3, plotted land) ---
  mkComparable({ localityKey: 'blr-yelahanka', label: 'BDA Layout Site No. 112, 30x40 East-facing', address: 'BDA Layout, Site No. 112, Yelahanka, Bengaluru, Karnataka', distanceKm: 2.0, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-07-30', pricePerSqm: 74500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-yelahanka', label: 'Corner site, 40x60, 40ft road', address: 'Rajanukunte Corner Site, Yelahanka, Bengaluru, Karnataka', distanceKm: 5.5, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-02-22', pricePerSqm: 69800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-yelahanka', label: 'New Town BDA Layout Site, 50x80 North-facing', address: 'New Town BDA Layout, Yelahanka, Bengaluru, Karnataka', distanceKm: 1.4, propertyType: 'residential_plot', areaSqm: 372, transactedAt: '2026-03-18', pricePerSqm: 79200, source: IGR_BLR, roundTo: 1000 }),

  // --- Sarjapur Road, Bengaluru (3, plotted land) ---
  mkComparable({ localityKey: 'blr-sarjapur', label: 'Corner site, 40x60, Dommasandra', address: 'Dommasandra Layout Corner Site, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 3.1, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-05-08', pricePerSqm: 74800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-sarjapur', label: 'Chikkakannalli Layout Site No. 27, 30x40', address: 'Chikkakannalli Layout, Site No. 27, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 1.9, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-09-15', pricePerSqm: 70200, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-sarjapur', label: 'BMRDA Layout Site, 40x60, Attibele Road', address: 'BMRDA Layout, Attibele Road, Sarjapur Road, Bengaluru, Karnataka', distanceKm: 6.8, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2024-12-27', pricePerSqm: 67500, source: IGR_BLR, roundTo: 1000 }),

  // --- Hebbal, Bengaluru (2, plotted land) ---
  mkComparable({ localityKey: 'blr-hebbal', label: 'Corner site, 30x40, Kempapura', address: 'Kempapura Layout Corner Site, Hebbal, Bengaluru, Karnataka', distanceKm: 2.3, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-08-19', pricePerSqm: 93500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-hebbal', label: 'BDA Layout Site No. 54, 40x60, Jakkur Road', address: 'Jakkur Road Layout, Site No. 54, Hebbal, Bengaluru, Karnataka', distanceKm: 3.5, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-01-30', pricePerSqm: 87200, source: IGR_BLR, roundTo: 1000 }),

  // --- Thanisandra/Hennur, Bengaluru (2, plotted land) ---
  mkComparable({ localityKey: 'blr-thanisandra', label: 'Private Layout Site No. 63, 30x40, Kothanur', address: 'Kothanur Layout, Site No. 63, Thanisandra/Hennur, Bengaluru, Karnataka', distanceKm: 2.8, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-06-11', pricePerSqm: 82500, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-thanisandra', label: 'Corner site, 40x60, Bagalur Main Road', address: 'Bagalur Main Road Corner Site, Thanisandra/Hennur, Bengaluru, Karnataka', distanceKm: 4.2, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2024-10-25', pricePerSqm: 78600, source: IGR_BLR, roundTo: 1000 }),

  // --- Whitefield, Bengaluru (2, plotted land — supply here is genuinely thin) ---
  mkComparable({ localityKey: 'blr-whitefield', label: 'Varthur BDA Layout Site, 30x40 East-facing', address: 'Varthur BDA Layout Site, Whitefield, Bengaluru, Karnataka', distanceKm: 3.2, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-04-12', pricePerSqm: 112000, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-whitefield', label: 'Corner site, 40x60, 60ft road, Kadugodi', address: 'Kadugodi Corner Site, 60ft Road, Whitefield, Bengaluru, Karnataka', distanceKm: 4.7, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-11-05', pricePerSqm: 108500, source: IGR_BLR, roundTo: 1000 }),

  // --- Electronic City, Bengaluru (2, plotted land — supply here is genuinely thin) ---
  mkComparable({ localityKey: 'blr-ecity', label: 'Neeladri Road Layout Site No. 31, 30x40', address: 'Neeladri Road Layout, Site No. 31, Electronic City, Bengaluru, Karnataka', distanceKm: 2.9, propertyType: 'residential_plot', areaSqm: 111, transactedAt: '2025-03-27', pricePerSqm: 65800, source: IGR_BLR, roundTo: 1000 }),
  mkComparable({ localityKey: 'blr-ecity', label: 'Corner site, 40x60, Konappana Agrahara', address: 'Konappana Agrahara Corner Site, Electronic City, Bengaluru, Karnataka', distanceKm: 1.6, propertyType: 'residential_plot', areaSqm: 223, transactedAt: '2025-09-02', pricePerSqm: 69200, source: IGR_BLR, roundTo: 1000 }),

  // --- Zuidas, Amsterdam (5, office) ---
  mkComparable({ localityKey: 'ams-zuidas', label: 'WTC Tower H', address: 'WTC Tower H, Zuidas, Amsterdam, Noord-Holland', distanceKm: 0.4, propertyType: 'commercial_office', areaSqm: 850, transactedAt: '2025-09-18', pricePerSqm: 8350, source: KADASTER_NONRES, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-zuidas', label: 'Symphony Offices', address: 'Symphony Offices, Zuidas, Amsterdam, Noord-Holland', distanceKm: 0.9, propertyType: 'commercial_office', areaSqm: 640, transactedAt: '2025-03-22', pricePerSqm: 8050, source: KADASTER_NONRES, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-zuidas', label: 'The Rock Zuidas', address: 'The Rock, Zuidas, Amsterdam, Noord-Holland', distanceKm: 1.2, propertyType: 'commercial_office', areaSqm: 720, transactedAt: '2024-12-11', pricePerSqm: 8480, source: KADASTER_NONRES, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-zuidas', label: 'Mondriaan Tower Annex', address: 'Mondriaan Tower Annex, Zuidas, Amsterdam, Noord-Holland', distanceKm: 1.6, propertyType: 'commercial_office', areaSqm: 510, transactedAt: '2026-01-30', pricePerSqm: 7920, source: KADASTER_NONRES, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-zuidas', label: 'Vinoly Building', address: 'Vinoly Building, Zuidas, Amsterdam, Noord-Holland', distanceKm: 0.7, propertyType: 'commercial_office', areaSqm: 690, transactedAt: '2025-07-05', pricePerSqm: 8610, source: KADASTER_NONRES, roundTo: 100 }),

  // --- De Pijp, Amsterdam (5, residential) ---
  mkComparable({ localityKey: 'ams-depijp', label: 'Albert Cuypstraat woning', address: 'Albert Cuypstraat woning, De Pijp, Amsterdam, Noord-Holland', distanceKm: 0.3, propertyType: 'residential_apartment', areaSqm: 78, transactedAt: '2025-10-14', pricePerSqm: 8050, source: NVM_AMS, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-depijp', label: 'Ferdinand Bolstraat appartement', address: 'Ferdinand Bolstraat appartement, De Pijp, Amsterdam, Noord-Holland', distanceKm: 0.6, propertyType: 'residential_apartment', areaSqm: 65, transactedAt: '2025-05-02', pricePerSqm: 7780, source: NVM_AMS, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-depijp', label: 'Sarphatipark rand', address: 'Sarphatipark rand, De Pijp, Amsterdam, Noord-Holland', distanceKm: 0.5, propertyType: 'residential_apartment', areaSqm: 92, transactedAt: '2024-11-19', pricePerSqm: 8220, source: NVM_AMS, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-depijp', label: 'Van Woustraat bovenwoning', address: 'Van Woustraat bovenwoning, De Pijp, Amsterdam, Noord-Holland', distanceKm: 0.8, propertyType: 'residential_apartment', areaSqm: 71, transactedAt: '2026-02-08', pricePerSqm: 7650, source: NVM_AMS, roundTo: 100 }),
  mkComparable({ localityKey: 'ams-depijp', label: 'Diamantbuurt hoekwoning', address: 'Diamantbuurt hoekwoning, De Pijp, Amsterdam, Noord-Holland', distanceKm: 1.1, propertyType: 'residential_apartment', areaSqm: 105, transactedAt: '2025-08-27', pricePerSqm: 7910, source: NVM_AMS, roundTo: 100 }),

  // --- Kop van Zuid, Rotterdam (3) ---
  mkComparable({ localityKey: 'rot-kvz', label: 'Wilhelminapier penthouse', address: 'Wilhelminapier penthouse, Kop van Zuid, Rotterdam, Zuid-Holland', distanceKm: 0.5, propertyType: 'residential_apartment', areaSqm: 98, transactedAt: '2025-06-21', pricePerSqm: 5350, source: NVM_ROT, roundTo: 100 }),
  mkComparable({ localityKey: 'rot-kvz', label: 'Rijnhaven kade appartement', address: 'Rijnhaven kade appartement, Kop van Zuid, Rotterdam, Zuid-Holland', distanceKm: 0.9, propertyType: 'residential_apartment', areaSqm: 85, transactedAt: '2025-01-09', pricePerSqm: 5080, source: NVM_ROT, roundTo: 100 }),
  mkComparable({ localityKey: 'rot-kvz', label: 'De Rotterdam kantoorunit', address: 'De Rotterdam kantoorunit, Kop van Zuid, Rotterdam, Zuid-Holland', distanceKm: 0.7, propertyType: 'commercial_office', areaSqm: 340, transactedAt: '2024-10-30', pricePerSqm: 5220, source: NVM_ROT, roundTo: 100 }),

  // --- Leidsche Rijn, Utrecht (3) ---
  mkComparable({ localityKey: 'utr-lr', label: 'Terwijde rijtjeswoning', address: 'Terwijde rijtjeswoning, Leidsche Rijn, Utrecht, Utrecht', distanceKm: 1.0, propertyType: 'residential_apartment', areaSqm: 118, transactedAt: '2025-04-03', pricePerSqm: 4720, source: NVM_UTR, roundTo: 100 }),
  mkComparable({ localityKey: 'utr-lr', label: 'Parkwijk gezinswoning', address: 'Parkwijk gezinswoning, Leidsche Rijn, Utrecht, Utrecht', distanceKm: 1.4, propertyType: 'residential_apartment', areaSqm: 132, transactedAt: '2025-11-16', pricePerSqm: 4890, source: NVM_UTR, roundTo: 100 }),
  mkComparable({ localityKey: 'utr-lr', label: 'Grauwaart nieuwbouw appartement', address: 'Grauwaart nieuwbouw appartement, Leidsche Rijn, Utrecht, Utrecht', distanceKm: 0.6, propertyType: 'residential_apartment', areaSqm: 84, transactedAt: '2026-01-22', pricePerSqm: 4760, source: NVM_UTR, roundTo: 100 }),
];

export const REFERENCE_DATA: ReferenceData = {
  countryPacks: COUNTRY_PACKS,
  statePacks: STATE_PACKS,
  localities: LOCALITIES,
  comparablePool: COMPARABLE_POOL,
};
