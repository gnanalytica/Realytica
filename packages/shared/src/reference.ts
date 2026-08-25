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

import type { Comparable, CountryPack, LocalityReference, PropertyType, ReferenceData } from './types';

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
  stampDutyPct: 5.6,
  registrationFeePct: 1,
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
  notes:
    'Overdrachtsbelasting (property transfer tax) is 10.4% for investment acquisitions, versus a reduced ' +
    'rate for owner-occupiers under the starters exemption. The WOZ value is a municipal assessment used ' +
    'for tax purposes and is republished annually with roughly a one-year valuation lag against market price.',
};

export const COUNTRY_PACKS: CountryPack[] = [INDIA_PACK, NETHERLANDS_PACK];

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

export const LOCALITIES: LocalityReference[] = [
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
    infrastructureNote: 'Road-widening and the proposed metro Phase 3 extension are the main upside catalysts; current peak-hour congestion is significant.',
    source: 'State Registration Department (IGR) — Bengaluru Urban registrations',
  },
  // --- India — Pune --------------------------------------------------------
  {
    id: 'in-pun-baner',
    country: 'IN',
    state: 'Maharashtra',
    city: 'Pune',
    locality: 'Baner',
    currency: 'INR',
    medianPricePerSqm: 84000,
    statutoryRatePerSqm: 63000,
    grossYield: 0.033,
    yoyChangePct: 8,
    liquidityDays: 60,
    sampleSize: 121,
    trend: buildTrend(84000, 8, 500),
    zoning: 'Residential',
    permittedUses: ['residential_apartment'],
    farAllowed: 1.8,
    planningNote: 'Pune Development Plan base FSI of 1.1 is commonly topped up to ~1.8 via premium FSI/TDR purchase.',
    replacementCostPerSqm: 25500,
    infrastructureNote: 'Close to the Mumbai-Pune Expressway and Hinjawadi IT corridor; Metro Line 3 is under construction.',
    source: 'State Registration Department (IGR) — Pune registrations',
  },
  // --- India — Mumbai --------------------------------------------------------
  {
    id: 'in-mum-powai',
    country: 'IN',
    state: 'Maharashtra',
    city: 'Mumbai',
    locality: 'Powai',
    currency: 'INR',
    medianPricePerSqm: 258000,
    statutoryRatePerSqm: 195000,
    grossYield: 0.028,
    yoyChangePct: 5.5,
    liquidityDays: 80,
    sampleSize: 88,
    trend: buildTrend(258000, 5.5, 1000),
    zoning: 'Residential (Development Plan — Powai node)',
    permittedUses: ['residential_apartment'],
    farAllowed: 2.5,
    planningNote: 'Fungible FSI and premiums allow effective ratios above the base, but lake-buffer and height restrictions apply near Powai Lake.',
    replacementCostPerSqm: 32000,
    infrastructureNote: 'IIT Bombay and the Powai IT/BPO cluster anchor demand; access via JVLR is congested at peak hours.',
    source: 'State Registration Department (IGR) — Mumbai City & Suburban registrations',
  },
  // --- India — Hyderabad -----------------------------------------------------
  {
    id: 'in-hyd-gachibowli',
    country: 'IN',
    state: 'Telangana',
    city: 'Hyderabad',
    locality: 'Gachibowli',
    currency: 'INR',
    medianPricePerSqm: 88000,
    statutoryRatePerSqm: 60000,
    grossYield: 0.082,
    yoyChangePct: 7,
    liquidityDays: 150,
    sampleSize: 47,
    trend: buildTrend(88000, 7, 500),
    zoning: 'Commercial / IT-ITES corridor',
    permittedUses: ['commercial_office', 'retail_unit', 'residential_apartment'],
    farAllowed: 3.5,
    planningNote:
      'HMDA permits high FAR in the designated IT corridor subject to vacant-land tax and mandatory open-space ' +
      'norms; several Grade-A campuses still hold unbuilt entitlement.',
    replacementCostPerSqm: 42000,
    infrastructureNote: 'Outer Ring Road access and the Gachibowli-Kondapur IT cluster drive office demand; residential stock in the locality is comparatively thin.',
    source: 'State Registration Department (IGR) — Hyderabad (Telangana) registrations',
  },
  // --- Netherlands — Amsterdam -------------------------------------------------
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
    infrastructureNote: 'Utrecht Leidsche Rijn rail station and A2 motorway access; local amenities are still catching up to population growth.',
    source: 'CBS/NVM transaction statistics — Utrecht',
  },
];

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
const IGR_PUN = 'State Registration Department (IGR) — Pune registrations';
const IGR_MUM = 'State Registration Department (IGR) — Mumbai City & Suburban registrations';
const IGR_HYD = 'State Registration Department (IGR) — Hyderabad (Telangana) registrations';
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

  // --- Baner, Pune (3) ---
  mkComparable({ localityKey: 'pun-baner', label: 'Kunal Icon', address: 'Kunal Icon, Baner, Pune, Maharashtra', distanceKm: 0.7, propertyType: 'residential_apartment', areaSqm: 108, transactedAt: '2025-05-19', pricePerSqm: 82500, source: IGR_PUN, roundTo: 1000 }),
  mkComparable({ localityKey: 'pun-baner', label: 'Goel Ganga Newtown', address: 'Goel Ganga Newtown, Baner, Pune, Maharashtra', distanceKm: 1.3, propertyType: 'residential_apartment', areaSqm: 92, transactedAt: '2025-10-27', pricePerSqm: 86200, source: IGR_PUN, roundTo: 1000 }),
  mkComparable({ localityKey: 'pun-baner', label: 'Kohinoor Viva City', address: 'Kohinoor Viva City, Baner, Pune, Maharashtra', distanceKm: 2.0, propertyType: 'residential_apartment', areaSqm: 124, transactedAt: '2026-02-11', pricePerSqm: 83900, source: IGR_PUN, roundTo: 1000 }),

  // --- Powai, Mumbai (3) ---
  mkComparable({ localityKey: 'mum-powai', label: 'Hiranandani Gardens — Evita', address: 'Hiranandani Gardens, Evita, Powai, Mumbai, Maharashtra', distanceKm: 0.9, propertyType: 'residential_apartment', areaSqm: 105, transactedAt: '2025-08-04', pricePerSqm: 262000, source: IGR_MUM, roundTo: 1000 }),
  mkComparable({ localityKey: 'mum-powai', label: 'L&T Crescent Bay', address: 'L&T Crescent Bay, Powai, Mumbai, Maharashtra', distanceKm: 3.2, propertyType: 'residential_apartment', areaSqm: 138, transactedAt: '2025-01-29', pricePerSqm: 251500, source: IGR_MUM, roundTo: 1000 }),
  mkComparable({ localityKey: 'mum-powai', label: 'Adani Western Heights (Powai frontage)', address: 'Adani Western Heights, Powai, Mumbai, Maharashtra', distanceKm: 1.6, propertyType: 'residential_apartment', areaSqm: 92, transactedAt: '2024-11-06', pricePerSqm: 265800, source: IGR_MUM, roundTo: 1000 }),

  // --- Gachibowli, Hyderabad (5: 4 office + 1 residential) ---
  mkComparable({ localityKey: 'hyd-gachibowli', label: 'DivyaSree Orion — Block C', address: 'DivyaSree Orion, Block C, Gachibowli, Hyderabad, Telangana', distanceKm: 0.6, propertyType: 'commercial_office', areaSqm: 620, transactedAt: '2025-04-12', pricePerSqm: 86000, source: IGR_HYD, roundTo: 1000 }),
  mkComparable({ localityKey: 'hyd-gachibowli', label: 'Vertex Panache IT Park', address: 'Vertex Panache IT Park, Gachibowli, Hyderabad, Telangana', distanceKm: 1.1, propertyType: 'commercial_office', areaSqm: 480, transactedAt: '2025-11-25', pricePerSqm: 91500, source: IGR_HYD, roundTo: 1000 }),
  mkComparable({ localityKey: 'hyd-gachibowli', label: 'My Home Hub', address: 'My Home Hub, Gachibowli, Hyderabad, Telangana', distanceKm: 2.3, propertyType: 'commercial_office', areaSqm: 710, transactedAt: '2024-10-03', pricePerSqm: 84200, source: IGR_HYD, roundTo: 1000 }),
  mkComparable({ localityKey: 'hyd-gachibowli', label: 'Sarath City Centre Annexe', address: 'Sarath City Centre Annexe, Gachibowli, Hyderabad, Telangana', distanceKm: 1.8, propertyType: 'commercial_office', areaSqm: 395, transactedAt: '2026-02-27', pricePerSqm: 89900, source: IGR_HYD, roundTo: 1000 }),
  mkComparable({ localityKey: 'hyd-gachibowli', label: 'Aparna Sarovar Zenith', address: 'Aparna Sarovar Zenith, Gachibowli, Hyderabad, Telangana', distanceKm: 2.9, propertyType: 'residential_apartment', areaSqm: 122, transactedAt: '2025-06-30', pricePerSqm: 68500, source: IGR_HYD, roundTo: 1000 }),

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
  localities: LOCALITIES,
  comparablePool: COMPARABLE_POOL,
};
