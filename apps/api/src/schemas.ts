import { z } from 'zod';
import type {
  AgentKind,
  AreaBasis,
  DocumentKind,
  KarnatakaAttributes,
  SiteConstraintDeclaration,
  SiteConstraintKey,
  KarnatakaJurisdiction,
  KhataType,
  LandConversionStatus,
  LayoutApproval,
  PlotAttributes,
  PlotFacing,
  TechnicalDdPhase,
  TechnicalFindingReviewState,
  TechnicalSystem,
} from '@realytica/shared';

/**
 * zod schemas mirroring the request-body shapes of `@realytica/shared`'s
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
export const riskSeveritySchema = z.enum(['info', 'warning', 'serious', 'critical']);

export const technicalSystemSchema = z.enum([
  'architectural',
  'structural',
  'mep_hvac',
  'mep_phe',
  'mep_fire',
  'mep_electrical',
  'mep_ibms',
  'statutory',
  'ehs',
  'project_ops',
]) satisfies z.ZodType<TechnicalSystem>;

export const technicalDdPhaseSchema = z.enum(['built', 'proposed']) satisfies z.ZodType<TechnicalDdPhase>;

export const technicalFindingReviewStateSchema = z.enum(['proposed', 'accepted', 'rejected']) satisfies z.ZodType<TechnicalFindingReviewState>;

/**
 * The draft shape — what a person filling in the form and a copilot tool
 * call both have to supply. `evidenceDocumentIds` defaults to empty rather
 * than being required: a user typing up a fresh site observation may not
 * have a photo attached yet, and the finding should still be saveable.
 */
export const technicalFindingDraftSchema = z.object({
  system: technicalSystemSchema,
  zone: z.string().min(1).max(200),
  observation: z.string().min(1).max(2000),
  severity: riskSeveritySchema,
  recommendation: z.string().min(1).max(2000),
  codeCitation: z.string().max(300).optional(),
  evidenceDocumentIds: z.array(z.string()).max(20).default([]),
});

export const updateTechnicalFindingSchema = z.object({
  zone: z.string().min(1).max(200).optional(),
  observation: z.string().min(1).max(2000).optional(),
  severity: riskSeveritySchema.optional(),
  recommendation: z.string().min(1).max(2000).optional(),
  codeCitation: z.string().max(300).optional(),
  evidenceDocumentIds: z.array(z.string()).max(20).optional(),
  status: riskStatusSchema.optional(),
  // FINANCIAL and approved-vs-as-built enrichments — reachable only through
  // this route, never through technicalFindingDraftSchema or the copilot's
  // propose tool. A cost with no cost consultant or BOQ behind it, or a
  // deviation flag inferred rather than asserted, is exactly the fabricated
  // figure this product's evidence discipline exists to refuse — so these
  // are a person's own entry, always.
  estimatedCost: z.number().min(0).max(1_000_000_000_000).optional(),
  estimatedCostCurrency: currencyCodeSchema.optional(),
  owner: z.string().max(200).optional(),
  deviatesFromApproved: z.boolean().optional(),
});

/**
 * Accepting or rejecting a proposal is its own endpoint rather than a field
 * on the general update — the same reason `riskStatusBodySchema` is separate
 * from a generic PATCH: a state transition with a closed set of outcomes
 * should not be reachable by typing an arbitrary string into a JSON body.
 */
export const technicalFindingReviewBodySchema = z.object({
  reviewState: z.enum(['accepted', 'rejected']),
});

export const technicalDocumentsProvidedBodySchema = z.object({
  itemId: z.string().min(1),
  provided: z.boolean(),
});

// Karnataka State Pack attributes, carried on `PropertyIdentity.karnataka`.
// The `satisfies` checks keep each enum in sync with its `types.ts` union.
export const karnatakaJurisdictionSchema = z.enum(['BBMP', 'BDA', 'BMRDA', 'BIAAPA', 'gram_panchayat', 'unknown']) satisfies z.ZodType<KarnatakaJurisdiction>;

export const khataTypeSchema = z.enum(['a_khata', 'b_khata', 'e_khata', 'gram_panchayat_form_9_11', 'none', 'unknown']) satisfies z.ZodType<KhataType>;

export const landConversionStatusSchema = z.enum(['converted', 'agricultural', 'not_applicable', 'unknown']) satisfies z.ZodType<LandConversionStatus>;

export const areaBasisSchema = z.enum(['carpet', 'built_up', 'super_built_up', 'unknown']) satisfies z.ZodType<AreaBasis>;

export const bbmpTaxZoneSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);

export const siteConstraintKeySchema = z.enum([
  'airport_height',
  'high_tension_line',
  'highway_control_line',
  'railway_boundary',
  'burial_ground',
  'quarry_lease',
]) satisfies z.ZodType<SiteConstraintKey>;

export const siteConstraintDeclarationSchema = z.object({
  key: siteConstraintKeySchema,
  presence: z.enum(['present', 'absent', 'unknown']),
  note: z.string().max(500).optional(),
}) satisfies z.ZodType<SiteConstraintDeclaration>;

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
  siteConstraints: z.array(siteConstraintDeclarationSchema).max(12).optional(),
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

export const lensKeySchema = z.enum(['developer', 'engineering', 'architect', 'project_manager']);

export const disclosureLevelSchema = z.enum(['locality_only', 'property_identifiers', 'full_address']);

export const recordKindSchema = z.enum([
  'encumbrance_certificate',
  'certified_instrument',
  'record_of_rights',
  'mutation',
  'khata_extract',
  'property_tax',
  'survey_map',
]);

export const fetchRecordBodySchema = z.object({
  kind: recordKindSchema,
  period: z
    .object({ fromYear: z.number().int().min(1800).max(2200), toYear: z.number().int().min(1800).max(2200) })
    .optional(),
});

export const updateCaseSchema = z.object({
  identity: propertyIdentitySchema.partial().optional(),
  status: caseStatusSchema.optional(),
  persona: personaKeySchema.optional(),
  lens: lensKeySchema.optional(),
  disclosure: disclosureLevelSchema.optional(),
  ownerName: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const updateDocumentSchema = z.object({
  kind: documentKindSchema.optional(),
  notes: z.string().optional(),
  // Capture-time mapping (photographs). Null clears a mapping that was wrong;
  // undefined leaves it alone — the difference matters on a PATCH.
  captureZone: z.string().trim().max(120).nullable().optional(),
  captureSystem: technicalSystemSchema.nullable().optional(),
});

export const riskStatusBodySchema = z.object({
  status: riskStatusSchema,
});

export const actionDoneBodySchema = z.object({
  done: z.boolean(),
});

/**
 * Setting the project kind by hand. Only the kind and the intent are
 * accepted: `source`, `inference` and `decidedAt` are the server's to write,
 * because a client that could post its own `source: 'user'` inference could
 * make an inferred brief look confirmed.
 */
export const projectBriefBodySchema = z.object({
  kind: z.enum([
    'land_acquisition',
    'plotted_development',
    'villa_project',
    'apartment_project',
    'mixed_use_project',
    'commercial_development',
    'industrial_development',
    'redevelopment',
    'joint_development',
    'built_asset_purchase',
  ]),
  intent: z
    .enum(['buy_and_hold', 'buy_and_build', 'subdivide_and_sell', 'partner_with_landowner', 'redevelop_existing', 'unknown'])
    .optional(),
  unitsPlanned: z.number().int().positive().max(100000).optional(),
});

/**
 * A boundary is supplied as the text of a KML or GeoJSON file, or as a ring
 * of points from a map. Never as an area — a number cannot be eroded by a
 * setback, and an area with no shape is what the yield already assumes.
 */
export const boundaryBodySchema = z.union([
  z.object({
    fileText: z.string().min(1).max(2_000_000),
    note: z.string().max(500).optional(),
  }),
  z.object({
    ring: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(3).max(2000),
    source: z.enum(['drawn', 'surveyed']),
    note: z.string().max(500).optional(),
  }),
]);

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
  'planner',
  'critic',
  'explorer',
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
  /** What the analyst is viewing — forwarded to the model, never stored on the turn. */
  viewContext: z.string().max(300).optional(),
});

/* ------------------------------------------------------------------ */
/* Requests (RFIs)                                                     */
/* ------------------------------------------------------------------ */

export const requestRecipientSchema = z.enum(['vendor', 'vendor_advocate', 'site_team', 'authority', 'internal']);
export const requestStatusSchema = z.enum(['open', 'sent', 'answered', 'withdrawn']);

/**
 * Created in batches, because the way requests are actually made is "send the
 * whole list" — one at a time would make the common act five round trips.
 */
export const createRequestSchema = z.object({
  items: z
    .array(
      z.object({
        domain: z.string().min(1).max(40),
        what: z.string().trim().min(1).max(300),
        why: z.string().trim().min(1).max(500),
        recipient: requestRecipientSchema,
        dueAt: z.string().datetime().optional(),
        originGapId: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const updateRequestSchema = z.object({
  status: requestStatusSchema.optional(),
  recipient: requestRecipientSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  answeredWithDocumentId: z.string().nullable().optional(),
});
