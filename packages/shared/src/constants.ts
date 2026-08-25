/**
 * Static label maps, option lists and product-spec transcriptions shared by the
 * API and the web client. Nothing here is computed — it is all editorial content
 * that must stay in sync with `docs/SOURCE_SPEC.md` and `types.ts`.
 */

import type {
  AreaBasis,
  CaseStatus,
  CountryCode,
  DocumentKind,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
  PersonaKey,
  PropertyType,
} from './types';
import {
  AREA_BASIS_LABEL,
  BBMP_TAX_ZONES,
  BENGALURU_METRO_LINES,
  JURISDICTION_LABEL,
  KARNATAKA_PACK,
  KHATA_TYPE_LABEL,
  LAND_CONVERSION_LABEL,
} from './packs/karnataka';

/** Version stamp written onto every `ScreenResult`. Bump when scoring logic changes. */
export const ENGINE_VERSION = '0.1.0';

/** Property types the MVP screens. Order drives select-box order in the UI. */
export const PROPERTY_TYPES: PropertyType[] = [
  'residential_apartment',
  'residential_villa',
  'residential_plot',
  'commercial_office',
  'retail_unit',
  'industrial_warehouse',
  'land_parcel',
];

/** All document kinds a case document can be classified into. */
export const DOCUMENT_KINDS: DocumentKind[] = [
  'title_deed',
  'sale_agreement',
  'encumbrance_certificate',
  'property_tax_receipt',
  'approved_building_plan',
  'occupancy_certificate',
  'khata_extract',
  'rera_registration',
  // --- Karnataka / Bengaluru pack -----------------------------------------
  'mother_deed',
  'conversion_certificate',
  'commencement_certificate',
  'betterment_charges_receipt',
  'possession_certificate',
  'form_9_11',
  'sanctioned_plan_bbmp',
  'joint_development_agreement',
  // -------------------------------------------------------------------------
  'valuation_report',
  'lease_agreement',
  'kadaster_extract',
  'energy_label',
  'woz_assessment',
  'floor_plan',
  'photograph',
  'other',
  'unclassified',
];

/**
 * Generic short label for every `DocumentKind`, exhaustive by construction
 * (TypeScript rejects a missing key). This is the canonical map — a page-level
 * fallback map may exist elsewhere until it is switched over to import this
 * one instead of maintaining its own copy.
 */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  title_deed: 'Title deed',
  sale_agreement: 'Sale agreement',
  encumbrance_certificate: 'Encumbrance certificate',
  property_tax_receipt: 'Property tax receipt',
  approved_building_plan: 'Approved building plan',
  occupancy_certificate: 'Occupancy certificate',
  khata_extract: 'Khata extract',
  rera_registration: 'RERA registration',
  // --- Karnataka / Bengaluru pack -----------------------------------------
  mother_deed: 'Mother deed',
  conversion_certificate: 'Conversion certificate (DC conversion order)',
  commencement_certificate: 'Commencement certificate',
  betterment_charges_receipt: 'Betterment charges receipt',
  possession_certificate: 'Possession certificate',
  form_9_11: 'Form 9 & 11 (gram panchayat)',
  sanctioned_plan_bbmp: 'Sanctioned plan (BBMP)',
  joint_development_agreement: 'Joint development agreement',
  // -------------------------------------------------------------------------
  valuation_report: 'Valuation report',
  lease_agreement: 'Lease agreement',
  kadaster_extract: 'Kadaster extract',
  energy_label: 'Energy label',
  woz_assessment: 'WOZ assessment',
  floor_plan: 'Floor plan',
  photograph: 'Photograph',
  other: 'Other',
  unclassified: 'Unclassified',
};

export const CASE_STATUSES: CaseStatus[] = ['draft', 'collecting', 'analysing', 'screened', 'archived'];

export const PERSONAS: { key: PersonaKey; label: string; description: string }[] = [
  {
    key: 'property_investor',
    label: 'Property Investor',
    description: 'Buying to hold or flip; wants a fast read on value, yield and downside risk.',
  },
  {
    key: 'developer_acquisition_manager',
    label: 'Developer / Acquisition Manager',
    description: 'Screening acquisition or development opportunities for commercial viability.',
  },
  {
    key: 'property_adviser',
    label: 'Property Adviser / Consultant',
    description: 'Advising a client and needs a defensible, evidence-backed view to hand over.',
  },
  {
    key: 'valuation_firm',
    label: 'Valuation Firm',
    description: 'Producing or sanity-checking a valuation and wants anchors, comparables and evidence.',
  },
];

/** Metadata about the two country packs shipped in the MVP (Phase 1 India, Phase 3 Netherlands). */
export const COUNTRY_PACKS_META: {
  country: CountryCode;
  countryName: string;
  phase: string;
  flagLabel: string;
}[] = [
  { country: 'IN', countryName: 'India', phase: 'Phase 1 (MVP)', flagLabel: 'IN' },
  { country: 'NL', countryName: 'Netherlands', phase: 'Phase 3', flagLabel: 'NL' },
];

/* ------------------------------------------------------------------ */
/* Karnataka State Pack — enum option arrays for the case wizard       */
/*                                                                      */
/* The label maps themselves (KHATA_TYPE_LABEL and friends) live with   */
/* the pack's own content in packages/shared/src/packs/karnataka.ts —   */
/* they are re-exported here and turned into {key, label} option lists  */
/* because that is the shape a <select> in the wizard actually wants.   */
/* ------------------------------------------------------------------ */

export {
  AREA_BASIS_LABEL,
  BBMP_TAX_ZONES,
  BENGALURU_METRO_LINES,
  JURISDICTION_LABEL,
  KARNATAKA_PACK,
  KHATA_TYPE_LABEL,
  LAND_CONVERSION_LABEL,
};

export const KHATA_TYPE_OPTIONS: { key: KhataType; label: string }[] = (
  Object.keys(KHATA_TYPE_LABEL) as KhataType[]
).map(key => ({ key, label: KHATA_TYPE_LABEL[key] }));

export const JURISDICTION_OPTIONS: { key: KarnatakaJurisdiction; label: string }[] = (
  Object.keys(JURISDICTION_LABEL) as KarnatakaJurisdiction[]
).map(key => ({ key, label: JURISDICTION_LABEL[key] }));

export const LAND_CONVERSION_OPTIONS: { key: LandConversionStatus; label: string }[] = (
  Object.keys(LAND_CONVERSION_LABEL) as LandConversionStatus[]
).map(key => ({ key, label: LAND_CONVERSION_LABEL[key] }));

export const AREA_BASIS_OPTIONS: { key: AreaBasis; label: string }[] = (
  Object.keys(AREA_BASIS_LABEL) as AreaBasis[]
).map(key => ({ key, label: AREA_BASIS_LABEL[key] }));

/** BBMP property-tax zone options (A–F), for a case's `bbmpTaxZone` field. */
export const BBMP_TAX_ZONE_OPTIONS: { key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; label: string }[] = BBMP_TAX_ZONES.map(
  z => ({ key: z.zone, label: `Zone ${z.zone} — ${z.description}` }),
);

/* ------------------------------------------------------------------ */
/* About-page content, transcribed from docs/SOURCE_SPEC.md            */
/* ------------------------------------------------------------------ */

export interface SpecEntry {
  title: string;
  description: string;
}

export const PRODUCT_FAMILY: SpecEntry[] = [
  {
    title: 'Valytica Property Screen',
    description: 'Should I pursue this property? — the initial release, and the product this app implements.',
  },
  {
    title: 'Valytica Diligence',
    description: 'What exactly am I getting into? — a future product for deeper, document-level diligence.',
  },
  {
    title: 'Valytica Project Intelligence',
    description: 'Does this acquisition or development opportunity make commercial sense?',
  },
  {
    title: 'Valytica Portfolio Intelligence',
    description: 'Where are the risks and opportunities across our properties?',
  },
];

export const PRODUCT_PRINCIPLES: SpecEntry[] = [
  {
    title: 'Evidence Before Assertion',
    description: 'Every number a user sees carries an evidenceIds trail back to a concrete EvidenceItem.',
  },
  {
    title: 'Range Before False Precision',
    description: 'Values are shown as low / mid / high ranges, never a single misleadingly precise figure.',
  },
  {
    title: 'Explain the Why',
    description: 'Every driver, anchor and risk carries prose rationale, not just a number.',
  },
  {
    title: 'Uncertainty Must Be Visible',
    description: 'Confidence scores and range spread are surfaced explicitly, and widen when evidence is thin.',
  },
  {
    title: 'Drive Action',
    description: 'The output ends in concrete, owned, prioritised recommended actions — not just analysis.',
  },
];

export const KEY_USER_JOBS: SpecEntry[] = [
  { title: 'Worth investigating?', description: 'Tell me if this property is worth investigating.' },
  { title: 'Probable worth', description: 'Tell me what this property is probably worth.' },
  { title: 'Explain the why', description: 'Explain why the property is worth that.' },
  { title: 'What could go wrong', description: 'Tell me what could make this a bad deal.' },
  { title: 'What is missing', description: 'Tell me what documents or information are missing.' },
  { title: 'Development potential', description: 'Tell me whether there is development potential.' },
  { title: 'Before proceeding', description: 'Tell me what I need to resolve before proceeding.' },
  { title: 'Compare properties', description: 'Help me compare several properties.' },
];

export const MVP_SCOPE: SpecEntry[] = [
  { title: 'Property case creation', description: 'Start a case for a specific property under a persona and owner.' },
  { title: 'Property identification', description: 'Capture address, parcel id, type, tenure and areas.' },
  { title: 'Document upload', description: 'Attach the documents a buyer typically holds or can obtain.' },
  { title: 'Document classification', description: 'Automatically identify what kind of document was uploaded.' },
  { title: 'OCR / extraction', description: 'Pull structured facts out of each document with a confidence score.' },
  { title: 'External property-data retrieval', description: 'Bring in locality, statutory-rate and comparable data from country packs.' },
  { title: 'Property snapshot', description: 'A plain-language headline and key facts for the property.' },
  { title: 'Indicative value range', description: 'A blended low / mid / high value, not a single number.' },
  { title: 'Multiple value anchors', description: 'Comparable sales, statutory reference, income, replacement cost, index trend, asking price.' },
  { title: 'Market comparables', description: 'A ranked, adjusted set of similar recent transactions.' },
  { title: 'Value drivers', description: 'The specific factors pushing value up or down and by how much.' },
  { title: 'Material risk flags', description: 'Title, planning, structural, financial, market, tenancy, environmental and data risks.' },
  { title: 'Planning position', description: 'Zoning, permitted uses, FAR and development headroom.' },
  { title: 'Document completeness', description: 'What is present, what is missing, and how critical the gaps are.' },
  { title: 'Confidence scoring', description: 'A 0-100 score built from named, signed factors.' },
  { title: 'Evidence traceability', description: 'Every figure in the result can be traced to a source.' },
  { title: 'Recommended actions', description: 'Concrete next steps, owned and prioritised.' },
  { title: 'Property Screen report', description: 'The full screen assembled into one shareable result.' },
];

export const OUT_OF_SCOPE: SpecEntry[] = [
  { title: 'Certified valuation', description: 'Not a substitute for a certified/registered valuer’s report.' },
  { title: 'Legal title certificate', description: 'Does not issue a legal certificate of title.' },
  { title: 'Formal legal opinion', description: 'No formal legal opinion is rendered.' },
  { title: 'Engineering inspection', description: 'No structural or engineering site inspection is performed.' },
  { title: 'Bank lending approval', description: 'Not a lending decision or approval.' },
  { title: 'Formal mortgage valuation', description: 'Not a substitute for a lender’s mortgage valuation.' },
  { title: 'Full project feasibility', description: 'Not a full development feasibility study.' },
  { title: 'Portfolio management', description: 'Ongoing portfolio management is a later product, not this one.' },
  { title: 'Automated purchase recommendation without explanation', description: 'Every recommendation ships with reasoning — a bare verdict is out of scope.' },
  { title: 'Nationwide support for every property type', description: 'Coverage is deliberately narrow at first, expanding by country pack and phase.' },
];

export const ROLLOUT_PHASES: SpecEntry[] = [
  { title: 'Phase 1 (MVP)', description: 'India, one state/metro, one property type, professional users first.' },
  { title: 'Phase 2', description: 'Second property type, second geography, comparison, collaboration, deeper diligence, professional review, additional data integrations.' },
  { title: 'Phase 3', description: 'Netherlands Country Pack.' },
  { title: 'Phase 4', description: 'Project Intelligence.' },
  { title: 'Phase 5', description: 'Portfolio Intelligence.' },
];
