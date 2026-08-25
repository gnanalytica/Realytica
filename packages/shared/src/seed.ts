/**
 * Demo data for local-first development and product walkthroughs.
 *
 * `SEED_CASES` deliberately covers both country packs and both ends of the
 * outcome spectrum: a clean case that should screen well, and a compromised
 * case that should screen badly, in each currency where practical.
 */

import type { CreateCaseRequest } from './types';

const WHITEFIELD_APARTMENT: CreateCaseRequest = {
  identity: {
    label: '3BHK — Prestige Lakeside Habitat, Whitefield',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Whitefield',
    addressLine: 'Prestige Lakeside Habitat, ITPL Main Road, Whitefield',
    postalCode: '560066',
    parcelId: 'Survey No. 42/3, Whitefield',
    propertyType: 'residential_apartment',
    tenure: 'freehold',
    builtUpAreaSqm: 145,
    plotAreaSqm: 55,
    yearBuilt: 2020,
    floor: 7,
    totalFloors: 14,
    askingPrice: 13500000,
    currency: 'INR',
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: true,
      landConversionStatus: 'not_applicable',
      areaBasis: 'carpet',
      bbmpTaxZone: 'D',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Meera Krishnan',
  persona: 'property_investor',
  notes: 'Considering this as a rental-yield play. Want a clear read on fair value and resale liquidity before making an offer.',
};

const GACHIBOWLI_LEASEHOLD_OFFICE: CreateCaseRequest = {
  identity: {
    label: 'Leasehold office floor — Vertex Panache IT Park, Bellandur',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Outer Ring Road (Bellandur)',
    addressLine: 'Vertex Panache IT Park, Outer Ring Road, Bellandur',
    postalCode: '560103',
    parcelId: 'Survey No. 12/2, Bellandur',
    propertyType: 'commercial_office',
    tenure: 'leasehold',
    builtUpAreaSqm: 650,
    plotAreaSqm: 150,
    yearBuilt: 1994,
    floor: 2,
    totalFloors: 9,
    askingPrice: 78000000,
    currency: 'INR',
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: false,
      landConversionStatus: 'not_applicable',
      areaBasis: 'super_built_up',
      bbmpTaxZone: 'D',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Suresh Achar',
  persona: 'developer_acquisition_manager',
  notes: 'Seller claims stable IT-tenant income and quotes a premium price on that basis. Title and building-compliance paperwork is thin — verify before committing anything.',
};

/**
 * The case built to make the Karnataka compliance engine earn its keep: a
 * B-khata, unconverted (still agricultural), gram-panchayat site flagged as
 * near a rajakaluve. Deliberately given almost no documents — a real buyer
 * confronted with this little paperwork on this kind of property should get
 * an honestly bad screen, not a falsely reassuring one.
 */
const GUNJUR_GRAM_PANCHAYAT_SITE: CreateCaseRequest = {
  identity: {
    label: 'Residential site — Site No. 42, Sri Ranga Layout, off Sarjapur Road',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Sarjapur Road',
    addressLine: 'Site No. 42, Sri Ranga Layout, Gunjur Post, off Sarjapur Road',
    postalCode: '562125',
    parcelId: 'Survey No. 88/2, Gunjur Village',
    propertyType: 'residential_plot',
    tenure: 'freehold',
    // A vacant site — nothing is built on it yet, so it is priced on plot
    // area, not built-up area.
    builtUpAreaSqm: 0,
    plotAreaSqm: 220,
    askingPrice: 3800000,
    currency: 'INR',
    // Bad on every plot-specific axis, to earn the land-rate path's discounts:
    // a narrow lane, no corner frontage, the worst-priced facing, an
    // elongated non-standard shape, a revenue layout (not a sanctioned one),
    // and no confirmed demarcation/possession.
    plot: {
      roadWidthFt: 20,
      cornerSite: false,
      facing: 'south_west',
      dimensionsFt: { width: 24, depth: 99 },
      layoutApproval: 'revenue_layout',
      demarcated: false,
    },
    karnataka: {
      jurisdiction: 'gram_panchayat',
      khataType: 'b_khata',
      eKhataIssued: false,
      landConversionStatus: 'agricultural',
      areaBasis: 'unknown',
      nearRajakaluve: true,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Ganesh Naik',
  persona: 'property_investor',
  notes:
    'Broker is pushing this as an under-the-radar bargain near the Sarjapur growth corridor. Seller has only a sale agreement and a panchayat Form 9/11 — no khata, no EC, no conversion order. Want an honest read before paying even the token booking amount.',
};

/**
 * The mirror-image demo case: a clean, BDA-approved, east-facing 30x40 site
 * on a 40ft road in Devanahalli — a land-led locality where the reference
 * pool already carries genuine `residential_plot` comparables — so the
 * land-rate path has both a good and a bad example. Converted, documented
 * and demarcated throughout, this should screen well.
 */
const DEVANAHALLI_BDA_SITE: CreateCaseRequest = {
  identity: {
    label: 'Residential site — Site No. 118, Nadaprabhu Kempegowda Layout, Devanahalli',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Devanahalli',
    addressLine: 'Site No. 118, Nadaprabhu Kempegowda Layout, Devanahalli',
    postalCode: '562110',
    parcelId: 'Survey No. 55/1, Devanahalli',
    propertyType: 'residential_plot',
    tenure: 'freehold',
    builtUpAreaSqm: 0,
    // 30x40 ft = 1,200 sq ft ≈ 111.5 sqm.
    plotAreaSqm: 111.5,
    askingPrice: 4200000,
    currency: 'INR',
    plot: {
      roadWidthFt: 40,
      cornerSite: false,
      facing: 'east',
      dimensionsFt: { width: 30, depth: 40 },
      layoutApproval: 'bda_approved',
      demarcated: true,
    },
    karnataka: {
      jurisdiction: 'BDA',
      khataType: 'a_khata',
      eKhataIssued: true,
      landConversionStatus: 'converted',
      areaBasis: 'unknown',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Chandrashekar Gowda',
  persona: 'property_investor',
  notes:
    'A clean, BDA-approved site in a land-banking corridor near the airport. Looking for a straightforward read on land value and whether the paperwork is genuinely in order before committing.',
};

const ZUIDAS_OFFICE: CreateCaseRequest = {
  identity: {
    label: 'Grade-A office floor — WTC Tower H, Zuidas',
    country: 'NL',
    state: 'Noord-Holland',
    city: 'Amsterdam',
    locality: 'Zuidas',
    addressLine: 'WTC Tower H, Strawinskylaan 1, Zuidas',
    postalCode: '1077XW',
    parcelId: 'AMSTERDAM AC 4321',
    propertyType: 'commercial_office',
    tenure: 'freehold',
    builtUpAreaSqm: 680,
    plotAreaSqm: 200,
    yearBuilt: 2015,
    floor: 8,
    totalFloors: 12,
    askingPrice: 5700000,
    currency: 'EUR',
  },
  ownerName: 'Bram de Groot',
  persona: 'valuation_firm',
  notes: 'Sense-checking an internal valuation ahead of a client engagement.',
};

const DE_PIJP_APARTMENT: CreateCaseRequest = {
  identity: {
    label: '2-room apartment — Van Woustraat, De Pijp',
    country: 'NL',
    state: 'Noord-Holland',
    city: 'Amsterdam',
    locality: 'De Pijp',
    addressLine: 'Van Woustraat 145-2, De Pijp',
    postalCode: '1073AK',
    parcelId: 'AMSTERDAM P 8765',
    propertyType: 'residential_apartment',
    tenure: 'freehold',
    builtUpAreaSqm: 72,
    plotAreaSqm: 30,
    yearBuilt: 1932,
    floor: 1,
    totalFloors: 3,
    askingPrice: 575000,
    currency: 'EUR',
  },
  ownerName: 'Sanne Bakker',
  persona: 'property_adviser',
  notes: "Advising a first-time buy-to-let client. Want a clear read on yield and condition risk given the building's age.",
};

export const SEED_CASES: CreateCaseRequest[] = [
  WHITEFIELD_APARTMENT,
  GACHIBOWLI_LEASEHOLD_OFFICE,
  GUNJUR_GRAM_PANCHAYAT_SITE,
  ZUIDAS_OFFICE,
  DE_PIJP_APARTMENT,
  DEVANAHALLI_BDA_SITE,
];

/**
 * Realistic filenames the API can materialise as demo `CaseDocument`s for
 * each seed case, keyed by the case's `identity.label`. Filenames are chosen
 * to exercise `classifyDocument`'s keyword patterns correctly.
 */
export const SEED_DOCUMENT_FILENAMES: Record<string, string[]> = {
  [WHITEFIELD_APARTMENT.identity.label]: [
    'Sale_Deed_2020_Prestige_Lakeside.pdf',
    'Mother_Deed_Link_Documents_1998_2020.pdf',
    'EC_2010_2025_Whitefield.pdf',
    'Khata_Extract_2025.pdf',
    'Property_Tax_Receipt_2025-26.pdf',
    'Approved_Building_Plan_BBMP.pdf',
    'Occupancy_Certificate_2020.pdf',
    'RERA_Registration_Certificate.pdf',
  ],
  [GACHIBOWLI_LEASEHOLD_OFFICE.identity.label]: ['Lease_Agreement_IT_Tenant.pdf', 'Approved_Building_Plan_1994.pdf'],
  // Deliberately thin — no khata, no EC, no conversion order — so the case
  // screens badly on genuine document absence, not just on the identity flags.
  [GUNJUR_GRAM_PANCHAYAT_SITE.identity.label]: ['Sale_Agreement_SriRanga_Site42.pdf', 'Form_9_11_GramPanchayat_SriRanga.pdf'],
  [ZUIDAS_OFFICE.identity.label]: [
    'Koopovereenkomst_WTC_Tower_H.pdf',
    'Kadaster_Uittreksel_2025.pdf',
    'WOZ_beschikking_2026.pdf',
    'Energielabel_C_2024.pdf',
    'Huurovereenkomst_Tenant_BV.pdf',
  ],
  [DE_PIJP_APARTMENT.identity.label]: [
    'Koopovereenkomst_Van_Woustraat.pdf',
    'Kadaster_Uittreksel_VanWoustraat.pdf',
    'WOZ_beschikking_2026_VanWoustraat.pdf',
    'Energielabel_D_2023.pdf',
  ],
  // Clean and fully documented — the counterpart to the Gunjur site above, so
  // the land-rate path has both a good and a bad example.
  [DEVANAHALLI_BDA_SITE.identity.label]: [
    'Sale_Deed_2024_Devanahalli_Site118.pdf',
    'Mother_Deed_Link_Documents_Devanahalli.pdf',
    'EC_30Year_2025_Devanahalli.pdf',
    'Khata_Extract_2025_Devanahalli.pdf',
    'Property_Tax_Receipt_2025-26_Devanahalli.pdf',
    'DC_Conversion_Certificate_Devanahalli.pdf',
    'BDA_Possession_Certificate_Site118.pdf',
  ],
};
