import { z } from 'zod';
import type { DocumentKind } from '@valytica/shared';

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
