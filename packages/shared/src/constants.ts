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
/**
 * 0.2.0 — land-rate valuation. Comparables no longer cross the land/built
 * boundary, sites value from a land rate on plot area, and guidance value for
 * a vacant site is computed on plot rather than built-up area. Results carry
 * this so a stored screen states which engine produced it.
 */
export const ENGINE_VERSION = '0.2.0';

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
    title: 'Realytica Due Diligence OS',
    description: 'The living project system of record: projects, nested assets, concurrent DDs, shared registers, reports, capabilities, and controlled AI drafts.',
  },
  {
    title: 'Reusable engines',
    description: 'Valuation, cost, schedule, market and benchmarking run against the same project objects — never a second silo.',
  },
  {
    title: 'Controlled AI',
    description: 'Drafts with human review. The operating model works with no model credentials.',
  },
  {
    title: 'Portfolio Intelligence',
    description: 'Optional grouping of projects. Roll-ups follow from the same registers.',
  },
];

export const PRODUCT_PRINCIPLES: SpecEntry[] = [
  {
    title: 'Manual-first foundation',
    description: 'Every core workflow must function without AI so users can trust, correct, and audit the system.',
  },
  {
    title: 'Assessment vs reality',
    description: 'A DD is an exercise at a point in time. Evidence, findings, risks and actions are reusable project reality.',
  },
  {
    title: 'Evidence-backed conclusions',
    description: 'Every finding, risk, decision and report statement links to evidence used, or explicitly shows missing evidence.',
  },
  {
    title: 'Tree UI, graph data',
    description: 'Users get understandable tree navigation. The data layer supports many-to-many links across DDs and registers.',
  },
  {
    title: 'Human control',
    description: 'Later AI recommends and drafts. Stage changes, legal conclusions and critical findings require review.',
  },
];

export const KEY_USER_JOBS: SpecEntry[] = [
  { title: 'Set up the project', description: 'Create a project, type, stage and nested asset tree.' },
  { title: 'Run concurrent DDs', description: 'Start several assessments against different targets from reusable templates.' },
  { title: 'Execute checks', description: 'Record results against expected evidence without inventing a pass.' },
  { title: 'Share registers', description: 'Findings, risks, actions and decisions live once at project level.' },
  { title: 'Link across DDs', description: 'One finding can drive risks and actions in several scopes.' },
  { title: 'Report from records', description: 'Generate executive and red-flag views without a second data silo.' },
  { title: 'Remember prior DDs', description: 'See what is new, closed, repeated or unresolved since last time.' },
  { title: 'Operate without AI', description: 'The full operating model works with no model credentials.' },
];

export const MVP_SCOPE: SpecEntry[] = [
  { title: 'Project setup', description: 'Type, location, stage, stakeholders, size metrics, optional portfolio.' },
  { title: 'Asset tree', description: 'Nested components with independent stage history.' },
  { title: 'DD creation', description: 'Type, target, scopes and checks instantiated from libraries.' },
  { title: 'Concurrent DDs', description: 'Several active assessments on one project.' },
  { title: 'Evidence register', description: 'Expected through used, file upload, superseded and missing.' },
  { title: 'Finding register', description: 'Shared, linkable, not copied per DD.' },
  { title: 'Risk and action registers', description: 'Scored risks and owned work items.' },
  { title: 'Decision register', description: 'What was decided, by whom, on what evidence.' },
  { title: 'Dashboards', description: 'Completeness, DD progress, action aging, change-since-previous.' },
  { title: 'IBBI valuation structure', description: 'Indicative decision-support run with sign-off states — not a certified value.' },
  { title: 'Capabilities', description: 'Valuation, cost, schedule, market, benchmarking, report builder.' },
  { title: 'AI drafts', description: 'Proposed records with review and commit into the same registers.' },
  { title: 'Project graph', description: 'Data links across assets, DDs and registers — tree UI, graph data.' },
];

export const OUT_OF_SCOPE: SpecEntry[] = [
  { title: 'Certified valuation', description: 'Indicative decision-support only unless a registered valuer signs separately.' },
  { title: 'AI completing DD', description: 'MVP does not assume a model must finish diligence before the manual model works.' },
  { title: 'Hardcoded DD tabs', description: 'DD types are templates, not permanent app folders.' },
  { title: 'Major infrastructure modules', description: 'Roads, rail, airports, ports, power plants are later.' },
  { title: 'Formal legal opinion', description: 'No certificate of title or formal legal opinion is issued.' },
];

export const ROLLOUT_PHASES: SpecEntry[] = [
  { title: 'MVP 1', description: 'Manual system of record: project, assets, DDs, scopes, checks, registers, basic reports.' },
  { title: 'MVP 2', description: 'Templates, dashboards, evidence completeness, change-since-previous, IBBI-aligned valuation structure, portfolios.' },
  { title: 'Phase 2', description: 'Valuation, cost, schedule, market and benchmarking engines as reusable capabilities on the project.' },
  { title: 'Phase 3', description: 'Controlled AI assistance: drafts with human review before they write into registers.' },
  { title: 'Phase 4', description: 'DD orchestrator plans next assessments and work from live registers. A model is optional.' },
  { title: 'Phase 5', description: 'Graph of data links, portfolio grouping, valuation sign-off workflow. BIM, live registries and mobile are later.' },
];
