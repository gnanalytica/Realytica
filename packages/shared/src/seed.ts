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
  },
  ownerName: 'Meera Krishnan',
  persona: 'property_investor',
  notes: 'Considering this as a rental-yield play. Want a clear read on fair value and resale liquidity before making an offer.',
};

const GACHIBOWLI_LEASEHOLD_OFFICE: CreateCaseRequest = {
  identity: {
    label: 'Leasehold office floor — Vertex Panache IT Park, Gachibowli',
    country: 'IN',
    state: 'Telangana',
    city: 'Hyderabad',
    locality: 'Gachibowli',
    addressLine: 'Vertex Panache IT Park, Survey No. 12, Gachibowli',
    postalCode: '500032',
    parcelId: 'Survey No. 12/2, Gachibowli',
    propertyType: 'commercial_office',
    tenure: 'leasehold',
    builtUpAreaSqm: 650,
    plotAreaSqm: 150,
    yearBuilt: 1994,
    floor: 2,
    totalFloors: 9,
    askingPrice: 78000000,
    currency: 'INR',
  },
  ownerName: 'Suresh Achar',
  persona: 'developer_acquisition_manager',
  notes: 'Seller claims stable IT-tenant income and quotes a premium price on that basis. Title and building-compliance paperwork is thin — verify before committing anything.',
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

export const SEED_CASES: CreateCaseRequest[] = [WHITEFIELD_APARTMENT, GACHIBOWLI_LEASEHOLD_OFFICE, ZUIDAS_OFFICE, DE_PIJP_APARTMENT];

/**
 * Realistic filenames the API can materialise as demo `CaseDocument`s for
 * each seed case, keyed by the case's `identity.label`. Filenames are chosen
 * to exercise `classifyDocument`'s keyword patterns correctly.
 */
export const SEED_DOCUMENT_FILENAMES: Record<string, string[]> = {
  [WHITEFIELD_APARTMENT.identity.label]: [
    'Sale_Deed_2020_Prestige_Lakeside.pdf',
    'EC_2010_2025_Whitefield.pdf',
    'Khata_Extract_2025.pdf',
    'Property_Tax_Receipt_2025-26.pdf',
    'Approved_Building_Plan_BBMP.pdf',
    'Occupancy_Certificate_2020.pdf',
    'RERA_Registration_Certificate.pdf',
  ],
  [GACHIBOWLI_LEASEHOLD_OFFICE.identity.label]: ['Lease_Agreement_IT_Tenant.pdf', 'Approved_Building_Plan_1994.pdf'],
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
};
