/**
 * The demo cases: four Bengaluru properties a person is meant to look at.
 *
 * These exist to show what the product does, so they are chosen to be four
 * genuinely different *kinds* of diligence rather than four rows of the same
 * shape. An independent house turns on an old title chain and a khata; a
 * high-street retail building turns on trade licensing and commercial
 * conversion; a gated community turns on the amenities' own approvals, which
 * are separate consents nobody thinks to ask for; an IT floor turns on the
 * lease, the fitout and the statutory certificates the tenant's own auditors
 * will want. A demo that showed four apartments would show one feature.
 *
 * Test and eval fixtures live in `fixtures.ts` and are deliberately NOT these.
 * See that file's header for why.
 *
 * Every figure here is representative rather than researched. They are
 * plausible Bengaluru numbers for the localities named, not quotations from
 * any real transaction, and no property, owner or registration number below
 * refers to a real one.
 */

import type { CreateCaseRequest } from './types';

/**
 * 1. An individual property.
 *
 * Old Jayanagar, which is where a Bengaluru title screen is at its most
 * interesting: a 1970s conveyance, a partition among heirs, and a khata that
 * has been transferred twice by hand. The building is worth little — the
 * value is the site under it — so the case exercises the land-rate path with
 * a structure sitting on top of it.
 */
const JAYANAGAR_INDEPENDENT_HOUSE: CreateCaseRequest = {
  identity: {
    label: 'Independent house — 4th Main, Jayanagar 3rd Block',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Jayanagar',
    addressLine: 'No. 214, 4th Main Road, Jayanagar 3rd Block',
    postalCode: '560004',
    parcelId: 'Survey No. 87/2, Jayanagar, Bengaluru South Taluk',
    propertyType: 'residential_villa',
    tenure: 'freehold',
    builtUpAreaSqm: 232,
    plotAreaSqm: 223,
    yearBuilt: 1978,
    totalFloors: 2,
    askingPrice: 34000000,
    currency: 'INR',
    plot: {
      roadWidthFt: 40,
      cornerSite: true,
      facing: 'east',
      dimensionsFt: { width: 60, depth: 40 },
      layoutApproval: 'bda_approved',
      demarcated: true,
    },
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: false,
      landConversionStatus: 'not_applicable',
      areaBasis: 'built_up',
      bbmpTaxZone: 'B',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Lakshmi Narayan Rao',
  persona: 'property_investor',
  notes:
    'Family-owned since 1978 and sold after a partition among three heirs. I need the chain from the original conveyance to the present sellers, confirmation that every heir has released their share, and an e-khata position before I commit — the khata is A but has never been digitised.',
};

/**
 * 2. A commercial property.
 *
 * A standalone retail building on the Indiranagar 100 Ft Road frontage. Deliberately not
 * an office: the questions are commercial conversion, the trade licence, and
 * whether the ground-floor tenants hold anything that survives a sale.
 */
const INDIRANAGAR_RETAIL_BUILDING: CreateCaseRequest = {
  identity: {
    label: 'Retail building — 100 Ft Road, Indiranagar',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Indiranagar',
    addressLine: 'No. 42, 100 Feet Road, Indiranagar',
    postalCode: '560011',
    parcelId: 'Survey No. 118/1, Indiranagar, Bengaluru East Taluk',
    propertyType: 'retail_unit',
    tenure: 'freehold',
    builtUpAreaSqm: 520,
    plotAreaSqm: 186,
    yearBuilt: 2004,
    totalFloors: 3,
    askingPrice: 62000000,
    currency: 'INR',
    plot: {
      roadWidthFt: 60,
      cornerSite: false,
      facing: 'north',
      dimensionsFt: { width: 50, depth: 40 },
      layoutApproval: 'bda_approved',
      demarcated: true,
    },
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: true,
      landConversionStatus: 'not_applicable',
      areaBasis: 'built_up',
      bbmpTaxZone: 'A',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Ashwin Commercial Holdings',
  persona: 'developer_acquisition_manager',
  notes:
    'Three retail tenants in occupation, all on unregistered eleven-month agreements. I want to know what survives the sale, whether the building is assessed commercially, and whether the second and third floors were sanctioned — the third looks like a later addition.',
};

/**
 * 3. A gated community.
 *
 * The amenities are the point. A clubhouse, a pool, lifts, a sewage
 * treatment plant and a diesel generator are each a separate statutory
 * consent — KSPCB for the STP, CEIG for the DG and the substation, a fire NOC
 * for a building of this height, lift licences per lift — and they expire on
 * their own schedules. A buyer who checks only the title has checked the
 * least likely thing to be wrong.
 */
const WHITEFIELD_GATED_COMMUNITY: CreateCaseRequest = {
  identity: {
    label: '3BHK — Palm Meadows Enclave, Whitefield (gated community)',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Whitefield',
    addressLine: 'Tower 6, Unit 1104, Palm Meadows Enclave, Varthur Road, Whitefield',
    postalCode: '560102',
    parcelId: 'Survey No. 61/4, Varthur, Bengaluru East Taluk',
    propertyType: 'residential_apartment',
    tenure: 'freehold',
    builtUpAreaSqm: 168,
    plotAreaSqm: 62,
    yearBuilt: 2019,
    floor: 11,
    totalFloors: 18,
    askingPrice: 16800000,
    currency: 'INR',
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: true,
      landConversionStatus: 'converted',
      areaBasis: 'super_built_up',
      bbmpTaxZone: 'C',
      kreraNumber: 'PRM/KA/RERA/1251/446/PR/190815/002731',
      // Declared absent rather than left unknown: the engine reports an
      // unchecked buffer as its own finding, and this is the case that is
      // meant to demonstrate a file where the checking was actually done.
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Rohit Sabharwal',
  persona: 'property_adviser',
  notes:
    'Advising the buyer. Beyond title I need the common-area position: STP consent, DG and substation approvals, lift licences, the fire NOC for an 18-floor tower, and whether the association has taken over from the promoter. The promoter has produced buffer clearances for the block; I want them read rather than taken on the cover letter.',
};

/**
 * 4. An IT office floor.
 *
 * Leasehold, which changes the question entirely: the asset is the lease and
 * the fitout, not the land. Everything a tenant's auditor asks for — OC, fire,
 * CEIG, the lease itself and what happens at the end of it — is the diligence.
 */
const BELLANDUR_IT_FLOOR: CreateCaseRequest = {
  identity: {
    label: 'IT office floor — Level 8, Embassy TechVillage, Outer Ring Road',
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Outer Ring Road (Bellandur)',
    addressLine: 'Level 8, Block 4, Embassy TechVillage, Outer Ring Road, Devarabisanahalli',
    postalCode: '560103',
    parcelId: 'Survey No. 23/1, Devarabisanahalli, Bengaluru East Taluk',
    propertyType: 'commercial_office',
    tenure: 'leasehold',
    builtUpAreaSqm: 2415,
    plotAreaSqm: 0,
    yearBuilt: 2017,
    floor: 8,
    totalFloors: 14,
    askingPrice: 178000000,
    currency: 'INR',
    karnataka: {
      jurisdiction: 'BBMP',
      khataType: 'a_khata',
      eKhataIssued: true,
      landConversionStatus: 'converted',
      areaBasis: 'super_built_up',
      bbmpTaxZone: 'A',
      nearRajakaluve: false,
      nearLake: false,
      grantedLandPtcl: false,
    },
  },
  ownerName: 'Northbridge Capital Advisors',
  persona: 'valuation_firm',
  notes:
    'Valuing an assignment of the leasehold interest with the fitout in place. I need the head lease terms, the balance term and escalation, the occupancy and fire position for the whole block, and the CEIG approval for the floor’s electrical installation.',
};

export const SEED_CASES: CreateCaseRequest[] = [
  JAYANAGAR_INDEPENDENT_HOUSE,
  INDIRANAGAR_RETAIL_BUILDING,
  WHITEFIELD_GATED_COMMUNITY,
  BELLANDUR_IT_FLOOR,
];

/**
 * Realistic filenames the API materialises as demo `CaseDocument`s for each
 * seed case, keyed by the case's `identity.label`.
 *
 * Two rules. The names must exercise `classifyDocument`'s keyword patterns —
 * a file nothing classifies teaches the demo nothing. And each set is
 * deliberately INCOMPLETE in a way that is true to its property type: the
 * gaps are what the gap engine and the request tracker are for, and a case
 * where every document is present has nothing to show.
 */
export const SEED_DOCUMENT_FILENAMES: Record<string, string[]> = {
  // The chain is the story here, so the deeds are present and the e-khata is
  // conspicuously not.
  [JAYANAGAR_INDEPENDENT_HOUSE.identity.label]: [
    'Sale_Deed_1978_Jayanagar_3rdBlock.pdf',
    'Mother_Deed_Link_Documents_1952_1978.pdf',
    'Partition_Deed_2011_Rao_Family.pdf',
    'EC_30Year_1995_2025_Jayanagar_3rdBlock.pdf',
    'Khata_Extract_BBMP_2024.pdf',
    'Property_Tax_Receipt_2025-26_Jayanagar_3rdBlock.pdf',
  ],
  // Tenancy and sanction are the questions, so the sanctioned plan is here
  // and the occupancy certificate for the third floor is not.
  [INDIRANAGAR_RETAIL_BUILDING.identity.label]: [
    'Sale_Deed_2004_Indiranagar_100FtRoad.pdf',
    'EC_30Year_2025_Indiranagar.pdf',
    'Khata_Extract_BBMP_2025_Indiranagar.pdf',
    'Approved_Building_Plan_BBMP_2003.pdf',
    'Property_Tax_Receipt_2025-26_Commercial.pdf',
    'Lease_Agreement_Ground_Floor_Tenant.pdf',
  ],
  // The amenity consents are the point of this case, so they are the ones
  // present — and the fire NOC and the association handover are the ones
  // missing, which is the usual real-world shape.
  [WHITEFIELD_GATED_COMMUNITY.identity.label]: [
    'Sale_Deed_2019_Palm_Meadows_Enclave.pdf',
    'Mother_Deed_Link_Documents_Varthur.pdf',
    'EC_2010_2025_Whitefield.pdf',
    'Khata_Extract_2025_Whitefield.pdf',
    'Approved_Building_Plan_BBMP_Tower6.pdf',
    'Occupancy_Certificate_2019_PalmMeadows.pdf',
    'RERA_Registration_Certificate_PalmMeadows.pdf',
    'KSPCB_Consent_to_Operate_STP_2025.pdf',
    'CEIG_Approval_DG_and_Substation.pdf',
    'Lift_Licence_Renewal_2025_Tower6.pdf',
    'Property_Tax_Receipt_2025-26_PalmMeadows.pdf',
  ],
  // A leasehold floor. The lessor's own title is here because a buyer's
  // advisers ask for it on an assignment — a lease is only as good as the
  // interest it was granted out of. What is missing is the HEAD lease and the
  // mother deed: the first is the document the whole valuation rests on, and
  // the second is the ordinary next ask.
  [BELLANDUR_IT_FLOOR.identity.label]: [
    'Lease_Agreement_Level8_Block4.pdf',
    'Sale_Deed_2016_Devarabisanahalli_Block4.pdf',
    'Khata_Extract_BBMP_2025_Devarabisanahalli.pdf',
    'EC_30Year_2025_Devarabisanahalli.pdf',
    'Approved_Building_Plan_BBMP_Block4.pdf',
    'Occupancy_Certificate_2017_TechVillage.pdf',
    'CEIG_Approval_Electrical_Installation_Level8.pdf',
    'Property_Tax_Receipt_2025-26_TechVillage.pdf',
  ],
};
