import { z } from 'zod';
import type {
  AgentKind,
  AreaBasis,
  DocumentKind,
  KarnatakaAttributes,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
  LayoutApproval,
  PlotAttributes,
  PlotFacing,
} from '@valytica/shared';

/**
 * zod schemas mirroring the request-body shapes of `@valytica/shared`'s
 * domain types. Kept independent of the shared package's runtime exports
 * (only its *types* are referenced, for a compile-time cross-check) so this
 * file works even before the shared engine modules land.
 */

export const countryCodeSchema = z.enum(['IN', 'NL']);
export const currencyCodeSchema = z.enum(['INR', 'EUR']);

export const propertyTypeSchema = z.enum([
  'residential_apartment',
  'residential_villa',
  'residential_plot',
  'commercial_office',
  'retail_unit',
  'industrial_warehouse',
  'land_parcel',
]);

export const tenureSchema = z.enum(['freehold', 'leasehold', 'unknown']);

export const caseStatusSchema = z.enum(['draft', 'collecting', 'analysing', 'screened', 'archived']);

export const personaKeySchema = z.enum([
  'property_investor',
  'developer_acquisition_manager',
  'property_adviser',
  'valuation_firm',
]);

// `satisfies` gives us a compile-time check that this list stays in sync
// with the DocumentKind union in packages/shared/src/types.ts.
export const documentKindSchema = z.enum([
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
  'valuation_report',
  'lease_agreement',
  'kadaster_extract',
  'energy_label',
  'woz_assessment',
  'floor_plan',
  'photograph',
  'other',
  'unclassified',
]) satisfies z.ZodType<DocumentKind>;

export const riskStatusSchema = z.enum(['open', 'mitigated', 'accepted']);

// Karnataka State Pack attributes, carried on `PropertyIdentity.karnataka`.
// The `satisfies` checks keep each enum in sync with its `types.ts` union.
export const karnatakaJurisdictionSchema = z.enum(['BBMP', 'BDA', 'BMRDA', 'BIAAPA', 'gram_panchayat', 'unknown']) satisfies z.ZodType<KarnatakaJurisdiction>;

export const khataTypeSchema = z.enum(['a_khata', 'b_khata', 'e_khata', 'gram_panchayat_form_9_11', 'none', 'unknown']) satisfies z.ZodType<KhataType>;

export const landConversionStatusSchema = z.enum(['converted', 'agricultural', 'not_applicable', 'unknown']) satisfies z.ZodType<LandConversionStatus>;

export const areaBasisSchema = z.enum(['carpet', 'built_up', 'super_built_up', 'unknown']) satisfies z.ZodType<AreaBasis>;

export const bbmpTaxZoneSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);

export const karnatakaAttributesSchema = z.object({
  jurisdiction: karnatakaJurisdictionSchema,
  khataType: khataTypeSchema,
  eKhataIssued: z.boolean(),
  landConversionStatus: landConversionStatusSchema,
  areaBasis: areaBasisSchema,
  bbmpTaxZone: bbmpTaxZoneSchema.optional(),
  kreraNumber: z.string().optional(),
  nearRajakaluve: z.boolean().optional(),
  nearLake: z.boolean().optional(),
  grantedLandPtcl: z.boolean().optional(),
}) satisfies z.ZodType<KarnatakaAttributes>;

// Plot/site attributes, carried on `PropertyIdentity.plot`. Present for land
// property types (`residential_plot` / `land_parcel`), where value is set by
// the land itself rather than by a building.
export const plotFacingSchema = z.enum([
  'north',
  'east',
  'north_east',
  'south',
  'west',
  'north_west',
  'south_east',
  'south_west',
  'unknown',
]) satisfies z.ZodType<PlotFacing>;

export const layoutApprovalSchema = z.enum([
  'bda_approved',
  'bmrda_approved',
  'panchayat_approved',
  'private_approved',
  'revenue_layout',
  'unapproved',
  'unknown',
]) satisfies z.ZodType<LayoutApproval>;

export const plotAttributesSchema = z.object({
  roadWidthFt: z.number().nonnegative().optional(),
  cornerSite: z.boolean().optional(),
  facing: plotFacingSchema,
  dimensionsFt: z.object({ width: z.number().positive(), depth: z.number().positive() }).optional(),
  layoutApproval: layoutApprovalSchema,
  demarcated: z.boolean().optional(),
}) satisfies z.ZodType<PlotAttributes>;

export const propertyIdentitySchema = z.object({
  label: z.string().min(1),
  country: countryCodeSchema,
  state: z.string(),
  city: z.string(),
  locality: z.string(),
  addressLine: z.string(),
  postalCode: z.string(),
  parcelId: z.string(),
  propertyType: propertyTypeSchema,
  tenure: tenureSchema,
  builtUpAreaSqm: z.number().nonnegative(),
  plotAreaSqm: z.number().nonnegative(),
  yearBuilt: z.number().int().optional(),
  floor: z.number().int().optional(),
  totalFloors: z.number().int().optional(),
  askingPrice: z.number().nonnegative().optional(),
  currency: currencyCodeSchema,
  plot: plotAttributesSchema.optional(),
  karnataka: karnatakaAttributesSchema.optional(),
});

export const createCaseSchema = z.object({
  identity: propertyIdentitySchema,
  ownerName: z.string().min(1),
  persona: personaKeySchema,
  notes: z.string().optional(),
});

export const updateCaseSchema = z.object({
  identity: propertyIdentitySchema.partial().optional(),
  status: caseStatusSchema.optional(),
  persona: personaKeySchema.optional(),
  ownerName: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const updateDocumentSchema = z.object({
  kind: documentKindSchema.optional(),
  notes: z.string().optional(),
});

export const riskStatusBodySchema = z.object({
  status: riskStatusSchema,
});

export const actionDoneBodySchema = z.object({
  done: z.boolean(),
});

export const compareBodySchema = z.object({
  caseIds: z.array(z.string().min(1)).min(2).max(4),
});

/* ------------------------------------------------------------------ */
/* Agentic layer                                                       */
/* ------------------------------------------------------------------ */

// `satisfies` keeps this enum in sync with the AgentKind union in
// packages/shared/src/types.ts — the same convention used above.
export const agentKindSchema = z.enum([
  'orchestrator',
  'document_intelligence',
  'proof_pathways',
  'analyst_copilot',
  'market_research',
  'diligence_planner',
]) satisfies z.ZodType<AgentKind>;

export const runAgentsBodySchema = z.object({
  agents: z.array(agentKindSchema).min(1).optional(),
});

export const copilotBodySchema = z.object({
  question: z.string().min(1).max(2000),
});
