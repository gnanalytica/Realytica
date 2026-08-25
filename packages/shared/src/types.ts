/**
 * Valytica domain contract.
 *
 * This file is the single source of truth shared by the API and the web client.
 * Every screen in the product maps onto one of the structures below, and every
 * number a user sees is expected to carry an `evidenceIds` trail back to a
 * `EvidenceItem` (principle 1: Evidence Before Assertion).
 */

/* ------------------------------------------------------------------ */
/* Geography & country packs                                           */
/* ------------------------------------------------------------------ */

export type CountryCode = 'IN' | 'NL';

export type CurrencyCode = 'INR' | 'EUR';

export type PropertyType =
  | 'residential_apartment'
  | 'residential_villa'
  | 'residential_plot'
  | 'commercial_office'
  | 'retail_unit'
  | 'industrial_warehouse'
  | 'land_parcel';

export type Tenure = 'freehold' | 'leasehold' | 'unknown';

/* ------------------------------------------------------------------ */
/* Case lifecycle                                                      */
/* ------------------------------------------------------------------ */

export type CaseStatus = 'draft' | 'collecting' | 'analysing' | 'screened' | 'archived';

export type PersonaKey =
  | 'property_investor'
  | 'developer_acquisition_manager'
  | 'property_adviser'
  | 'valuation_firm';

export interface PropertyIdentity {
  /** Human label used across the UI, e.g. "3BHK — Prestige Lakeside, Whitefield". */
  label: string;
  country: CountryCode;
  /** State (IN) or province (NL). */
  state: string;
  city: string;
  locality: string;
  addressLine: string;
  postalCode: string;
  /** Survey number (IN) / kadastrale aanduiding (NL). */
  parcelId: string;
  propertyType: PropertyType;
  tenure: Tenure;
  builtUpAreaSqm: number;
  plotAreaSqm: number;
  yearBuilt?: number;
  floor?: number;
  totalFloors?: number;
  /** Asking price in major units of `currency`. Optional — a case can be screened without one. */
  askingPrice?: number;
  currency: CurrencyCode;
  /**
   * Plot/site attributes. Present for land property types, where value is set
   * by the land itself rather than by a building — road width, shape, corner
   * position and layout approval move a Bengaluru site's rate materially.
   */
  plot?: PlotAttributes;
  /**
   * State-pack specific attributes. Present only when a State Pack defines them
   * — for Karnataka these drive the khata, jurisdiction and conversion checks
   * that dominate a Bengaluru title screen. Everything here is optional so the
   * core engine and other geographies are unaffected.
   */
  karnataka?: KarnatakaAttributes;
}

/**
 * Compass facing. In Bengaluru this is priced, not decorative — east and north
 * facing sites command a measurable premium, so it is recorded rather than
 * dismissed.
 */
export type PlotFacing =
  | 'north'
  | 'east'
  | 'north_east'
  | 'south'
  | 'west'
  | 'north_west'
  | 'south_east'
  | 'south_west'
  | 'unknown';

/**
 * Who approved the layout the site sits in. This is a value driver and a risk
 * in one: an unapproved or revenue layout trades at a heavy discount and is
 * hard to finance, while a BDA-approved site carries a premium.
 */
export type LayoutApproval =
  | 'bda_approved'
  | 'bmrda_approved'
  | 'panchayat_approved'
  | 'private_approved'
  | 'revenue_layout'
  | 'unapproved'
  | 'unknown';

export interface PlotAttributes {
  /** Abutting road width in feet — drives both rate and permissible FAR. */
  roadWidthFt?: number;
  /** Corner sites carry a premium for frontage and access. */
  cornerSite?: boolean;
  facing: PlotFacing;
  /** Site dimensions in feet; standard sizes (30x40, 40x60) resell more easily. */
  dimensionsFt?: { width: number; depth: number };
  layoutApproval: LayoutApproval;
  /** True when the site is fenced/demarcated and in undisputed possession. */
  demarcated?: boolean;
}

/** Which body's building and revenue rules the property actually falls under. */
export type KarnatakaJurisdiction =
  | 'BBMP'
  | 'BDA'
  | 'BMRDA'
  | 'BIAAPA'
  | 'gram_panchayat'
  | 'unknown';

/**
 * Khata is the BBMP property register entry. The A/B distinction is the single
 * biggest binary in a Bengaluru title screen: a B-khata property is recorded but
 * not fully compliant, which restricts bank lending, building plan sanction and
 * resale. e-Khata is the digitised record Karnataka moved to; a property without
 * one can be blocked at registration.
 */
export type KhataType =
  | 'a_khata'
  | 'b_khata'
  | 'e_khata'
  | 'gram_panchayat_form_9_11'
  | 'none'
  | 'unknown';

/** Agricultural land needs a DC conversion order before non-agricultural use. */
export type LandConversionStatus = 'converted' | 'agricultural' | 'not_applicable' | 'unknown';

/**
 * Bengaluru prices are quoted on super built-up area while RERA mandates carpet
 * area, so the basis a figure is quoted on changes the price per unit by 25-35%.
 * Recording it is what stops the app comparing two incomparable numbers.
 */
export type AreaBasis = 'carpet' | 'built_up' | 'super_built_up' | 'unknown';

export interface KarnatakaAttributes {
  jurisdiction: KarnatakaJurisdiction;
  khataType: KhataType;
  /** True when an e-khata (digitised record) has been issued for the property. */
  eKhataIssued: boolean;
  landConversionStatus: LandConversionStatus;
  areaBasis: AreaBasis;
  /** BBMP property-tax zone A-F, which sets the unit area value. */
  bbmpTaxZone?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** Karnataka RERA registration number, where the project is registered. */
  kreraNumber?: string;
  /** Set when the property is known to sit near a storm-water drain (rajakaluve). */
  nearRajakaluve?: boolean;
  /** Set when the property is known to sit near a lake boundary. */
  nearLake?: boolean;
  /** Granted land under the PTCL Act carries transfer restrictions. */
  grantedLandPtcl?: boolean;
}

/* ------------------------------------------------------------------ */
/* Documents, classification & extraction                              */
/* ------------------------------------------------------------------ */

export type DocumentKind =
  | 'title_deed'
  | 'sale_agreement'
  | 'encumbrance_certificate'
  | 'property_tax_receipt'
  | 'approved_building_plan'
  | 'occupancy_certificate'
  | 'khata_extract'
  | 'rera_registration'
  // --- Karnataka / Bengaluru pack -----------------------------------------
  | 'mother_deed'
  | 'conversion_certificate'
  | 'commencement_certificate'
  | 'betterment_charges_receipt'
  | 'possession_certificate'
  | 'form_9_11'
  | 'sanctioned_plan_bbmp'
  | 'joint_development_agreement'
  | 'valuation_report'
  | 'lease_agreement'
  | 'kadaster_extract'
  | 'energy_label'
  | 'woz_assessment'
  | 'floor_plan'
  | 'photograph'
  | 'other'
  | 'unclassified';

export type OcrStatus = 'pending' | 'processing' | 'complete' | 'failed';

export type ExtractionMethod = 'ocr' | 'parser' | 'external' | 'user';

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  unit?: string;
  /** 0..1 */
  confidence: number;
  sourceDocumentId: string;
  sourcePage?: number;
  method: ExtractionMethod;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  kind: DocumentKind;
  /** 0..1 confidence of the automatic classification. */
  classificationConfidence: number;
  /** True when a human corrected the machine classification. */
  kindConfirmedByUser: boolean;
  pages: number;
  ocrStatus: OcrStatus;
  extracted: ExtractedField[];
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Valuation                                                           */
/* ------------------------------------------------------------------ */

export type ValuationMethod =
  | 'comparable_sales'
  /** Land rate per unit area applied to plot area — the primary basis for a site. */
  | 'land_rate'
  /** Land value plus what the permitted envelope could be built and sold for. */
  | 'residual_development'
  | 'income_capitalisation'
  | 'depreciated_replacement_cost'
  | 'statutory_reference'
  | 'asking_price_adjusted'
  | 'index_trend';

export interface ValueAnchor {
  id: string;
  method: ValuationMethod;
  label: string;
  low: number;
  mid: number;
  high: number;
  /** 0..1 — relative weight in the blended indicative range. */
  weight: number;
  /** 0..1 */
  confidence: number;
  rationale: string;
  evidenceIds: string[];
}

export interface ComparableAdjustment {
  key: string;
  label: string;
  /** Signed percentage applied to the raw price per sqm. */
  pct: number;
}

export interface Comparable {
  id: string;
  label: string;
  address: string;
  distanceKm: number;
  propertyType: PropertyType;
  areaSqm: number;
  /** ISO date. */
  transactedAt: string;
  price: number;
  pricePerSqm: number;
  adjustments: ComparableAdjustment[];
  adjustedPricePerSqm: number;
  source: string;
  /** 0..1 */
  similarity: number;
}

export type DriverCategory =
  | 'location'
  | 'building'
  | 'legal'
  | 'market'
  | 'planning'
  | 'tenancy';

export interface ValueDriver {
  id: string;
  label: string;
  direction: 'positive' | 'negative' | 'neutral';
  /** Signed percentage contribution to the mid value. */
  impactPct: number;
  category: DriverCategory;
  explanation: string;
  evidenceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

export type RiskSeverity = 'info' | 'warning' | 'serious' | 'critical';

export type RiskCategory =
  | 'title'
  | 'planning'
  | 'structural'
  | 'financial'
  | 'market'
  | 'tenancy'
  | 'environmental'
  | 'data';

export type RiskStatus = 'open' | 'mitigated' | 'accepted';

export interface RiskFlag {
  id: string;
  code: string;
  title: string;
  severity: RiskSeverity;
  category: RiskCategory;
  description: string;
  impact: string;
  mitigation: string;
  evidenceIds: string[];
  status: RiskStatus;
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export interface PlanningPosition {
  zoning: string;
  permittedUses: string[];
  farAllowed: number;
  farUsed: number;
  buildablePotentialSqm: number;
  restrictions: string[];
  developmentPotential: 'none' | 'limited' | 'moderate' | 'significant';
  statusNote: string;
  source: string;
  lastCheckedAt: string;
  evidenceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Completeness, confidence, evidence, actions                         */
/* ------------------------------------------------------------------ */

export interface CompletenessItem {
  key: string;
  label: string;
  /** Kinds of document that would satisfy this requirement. */
  satisfiedBy: DocumentKind[];
  required: boolean;
  present: boolean;
  documentId?: string;
  /** Relative weight in the completeness score. */
  weight: number;
  note?: string;
}

export interface CompletenessSummary {
  /** 0..100 */
  score: number;
  items: CompletenessItem[];
  missingCritical: string[];
}

export type ConfidenceBand = 'low' | 'moderate' | 'high';

export interface ConfidenceFactor {
  key: string;
  label: string;
  /** Signed points contributed to the 0..100 score. */
  contribution: number;
  note: string;
}

export interface ConfidenceSummary {
  /** 0..100 */
  score: number;
  band: ConfidenceBand;
  factors: ConfidenceFactor[];
  /** Plain-language statement of what would most raise confidence. */
  biggestLever: string;
}

export type EvidenceSourceType =
  | 'document'
  | 'external_dataset'
  | 'comparable'
  | 'user_input'
  | 'model_inference';

export interface EvidenceItem {
  id: string;
  statement: string;
  sourceType: EvidenceSourceType;
  /** Document id, dataset name, comparable id, or field name. */
  sourceRef: string;
  sourceLabel: string;
  /** 0..1 */
  confidence: number;
  capturedAt: string;
}

export type ActionPriority = 'now' | 'before_offer' | 'before_completion';
export type ActionOwner = 'buyer' | 'lawyer' | 'valuer' | 'lender' | 'seller' | 'surveyor';

export interface RecommendedAction {
  id: string;
  title: string;
  description: string;
  priority: ActionPriority;
  owner: ActionOwner;
  effort: 'low' | 'medium' | 'high';
  /** Human-readable statements of what this action unblocks. */
  unblocks: string[];
  relatedRiskIds: string[];
  done: boolean;
}

/* ------------------------------------------------------------------ */
/* Screen result                                                       */
/* ------------------------------------------------------------------ */

export type ScreenVerdict =
  | 'pursue'
  | 'pursue_with_conditions'
  | 'investigate_further'
  | 'do_not_pursue';

export interface IndicativeValue {
  low: number;
  mid: number;
  high: number;
  currency: CurrencyCode;
  perSqm: { low: number; mid: number; high: number };
  /** Half-width of the range as a percentage of mid — the "uncertainty is visible" number. */
  spreadPct: number;
  /** Signed % the asking price sits above (+) or below (-) the mid. Null when no asking price. */
  askingVsMidPct: number | null;
}

export interface MarketContext {
  medianPricePerSqm: number;
  yoyChangePct: number;
  liquidityDays: number;
  sampleSize: number;
  source: string;
  /** Last 8 quarters of median price per sqm, oldest first. */
  trend: { period: string; medianPricePerSqm: number }[];
}

export interface PropertySnapshot {
  headline: string;
  bullets: string[];
  keyFacts: { label: string; value: string; sourceEvidenceId?: string }[];
}

export type ComplianceVerdict = 'clear' | 'attention' | 'blocker' | 'unknown';

/** One state-specific check, e.g. "Khata classification" or "Rajakaluve buffer". */
export interface ComplianceCheck {
  key: string;
  label: string;
  verdict: ComplianceVerdict;
  /** What the engine concluded, in plain language. */
  finding: string;
  /** Why it matters commercially or legally. */
  consequence: string;
  /** What the user should do about it. */
  nextStep: string;
  statute: string;
  evidenceIds: string[];
  /** Risk ids this check produced, so the two views stay linked. */
  relatedRiskIds: string[];
}

export interface StateComplianceSummary {
  statePackId: string;
  state: string;
  /** 0..100 — share of applicable checks that came back clear. */
  score: number;
  checks: ComplianceCheck[];
  /** Checks that cannot be answered from what the user has supplied. */
  unresolved: string[];
  /** Provenance banner: statutory values are only as current as their source. */
  rulesAsOf: string;
  verifyNote: string;
}

/** Indicative acquisition cost on top of the price — stamp duty, cess, fees. */
export interface TransactionCostBreakdown {
  /** Value the duty is computed on: higher of consideration and guidance value. */
  dutiableValue: number;
  dutiableBasis: 'consideration' | 'statutory_guidance_value';
  lines: { key: string; label: string; pct: number | null; amount: number; note: string }[];
  total: number;
  totalPctOfPrice: number;
  currency: CurrencyCode;
  asOf: string;
  source: string;
  verifyNote: string;
}

export interface ScreenResult {
  caseId: string;
  generatedAt: string;
  /** Version of the scoring engine that produced this result. */
  engineVersion: string;
  snapshot: PropertySnapshot;
  indicativeValue: IndicativeValue;
  anchors: ValueAnchor[];
  comparables: Comparable[];
  drivers: ValueDriver[];
  risks: RiskFlag[];
  planning: PlanningPosition;
  completeness: CompletenessSummary;
  confidence: ConfidenceSummary;
  evidence: EvidenceItem[];
  actions: RecommendedAction[];
  marketContext: MarketContext;
  /** Present when a State Pack covers the property's state. */
  stateCompliance?: StateComplianceSummary;
  /** Present when the state pack can compute acquisition costs. */
  transactionCosts?: TransactionCostBreakdown;
  recommendation: {
    verdict: ScreenVerdict;
    headline: string;
    reasoning: string[];
    /** Conditions that must clear before the verdict can improve. */
    conditions: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Case aggregate                                                      */
/* ------------------------------------------------------------------ */

export interface PropertyCase {
  id: string;
  /** Short human reference, e.g. "VPS-2401". */
  reference: string;
  identity: PropertyIdentity;
  status: CaseStatus;
  persona: PersonaKey;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  documents: CaseDocument[];
  result?: ScreenResult;
  notes: string;
}

/** Case shape without the heavy nested payloads — used by list endpoints. */
export interface CaseSummary {
  id: string;
  reference: string;
  label: string;
  city: string;
  locality: string;
  country: CountryCode;
  propertyType: PropertyType;
  status: CaseStatus;
  updatedAt: string;
  documentCount: number;
  currency: CurrencyCode;
  askingPrice?: number;
  indicativeLow?: number;
  indicativeMid?: number;
  indicativeHigh?: number;
  confidenceScore?: number;
  confidenceBand?: ConfidenceBand;
  completenessScore?: number;
  verdict?: ScreenVerdict;
  openCriticalRisks: number;
}

/* ------------------------------------------------------------------ */
/* Reference data (Country Pack + State / Municipality Pack)           */
/* ------------------------------------------------------------------ */

export interface LocalityReference {
  id: string;
  country: CountryCode;
  state: string;
  city: string;
  locality: string;
  currency: CurrencyCode;
  /** Median transacted price per sqm for the locality. */
  medianPricePerSqm: number;
  /** Statutory reference rate: circle rate (IN) / WOZ per sqm (NL). */
  statutoryRatePerSqm: number;
  /** Gross rental yield, e.g. 0.031 for 3.1%. */
  grossYield: number;
  yoyChangePct: number;
  liquidityDays: number;
  sampleSize: number;
  /** Quarterly median series, oldest first. */
  trend: { period: string; medianPricePerSqm: number }[];
  zoning: string;
  permittedUses: string[];
  farAllowed: number;
  planningNote: string;
  /** Construction cost per sqm used by the replacement-cost anchor. */
  replacementCostPerSqm: number;
  /**
   * Median transacted *land* rate per sqm of plot area. A different quantity
   * from `medianPricePerSqm`, which is per sqm of built-up area — conflating
   * the two is the classic way to misprice a site.
   */
  medianLandRatePerSqm: number;
  /** Statutory guidance rate for land, per sqm of plot area. */
  statutoryLandRatePerSqm: number;
  infrastructureNote: string;
  source: string;
}

export interface CountryPack {
  country: CountryCode;
  countryName: string;
  currency: CurrencyCode;
  locale: string;
  parcelIdLabel: string;
  statutoryRateLabel: string;
  /**
   * States (IN) / provinces (NL) this pack's rules are actually calibrated for.
   *
   * India sets stamp duty, registration fees and the property-register
   * instrument at state level — a Khata extract is a Karnataka instrument, and
   * Telangana or Maharashtra would want a different document entirely. Until a
   * State / Municipality Pack tier exists, a pack's rules are only correct
   * inside these states, and the engine flags any case outside them rather than
   * quietly applying the wrong document set.
   */
  coveredStates: string[];
  /** Documents this country pack expects for a complete screen. */
  requiredDocuments: { kind: DocumentKind; label: string; weight: number; required: boolean }[];
  /** Registry/dataset names quoted as external sources. */
  datasets: string[];
  stampDutyPct: number;
  registrationFeePct: number;
  notes: string;
}

/**
 * A single statutory rule, carried with the provenance a user needs in order to
 * trust or challenge it.
 *
 * Karnataka's guidance values, stamp-duty slabs and buffer distances all change
 * by circular and notification. A screening tool that hard-codes them silently
 * goes stale and starts giving confidently wrong advice, so every statutory
 * value in a State Pack states when it was last confirmed and against what.
 */
export interface StatutoryRule<T> {
  value: T;
  /** ISO date the value was last confirmed against its source. */
  asOf: string;
  /** The circular, act, notification or portal this comes from. */
  source: string;
  /** Shown to the user wherever the rule drives a number they might act on. */
  verifyNote: string;
}

/** A stamp-duty band: `upTo` null means "and above". */
export interface DutySlab {
  upTo: number | null;
  pct: number;
}

/**
 * Buffer distances measured from a watercourse or waterbody edge, inside which
 * construction is restricted. These have been revised repeatedly in Karnataka
 * (NGT orders, RMP revisions), which is exactly why they carry provenance.
 */
export interface BufferRule {
  key: string;
  label: string;
  metres: number;
  appliesTo: string;
}

/**
 * The State / Municipality Pack — the tier between Country Pack and locality.
 *
 * Everything a country cannot answer uniformly lives here: the property
 * register instrument, transaction taxes, the statutory value basis and the
 * state's own title and planning checks.
 */
export interface StatePack {
  id: string;
  country: CountryCode;
  state: string;
  /** Cities/metros this pack's municipal rules are calibrated for. */
  coveredCities: string[];
  /** e.g. "Guidance value" in Karnataka, where other states say "circle rate". */
  statutoryRateLabel: string;
  statutoryRatePortal: string;
  /** Property register instrument, e.g. "Khata (BBMP)". */
  registerInstrumentLabel: string;
  /** Registering authority, e.g. "Sub-Registrar (Kaveri Online Services)". */
  registrationAuthority: string;
  /** State RERA authority name. */
  reraAuthority: string;
  /** Documents this state expects on top of, or instead of, the country set. */
  requiredDocuments: { kind: DocumentKind; label: string; weight: number; required: boolean; note?: string }[];
  stampDutySlabs: StatutoryRule<DutySlab[]>;
  /** Cess as a percentage of the stamp duty itself. */
  stampDutyCessPct: StatutoryRule<number>;
  /** Surcharge as a percentage of the stamp duty itself. */
  stampDutySurchargePct: StatutoryRule<number>;
  registrationFeePct: StatutoryRule<number>;
  buffers: StatutoryRule<BufferRule[]>;
  /** Named state-specific title checks surfaced in the compliance view. */
  titleChecks: { key: string; label: string; description: string; statute: string }[];
  datasets: string[];
  notes: string;
}

export interface ReferenceData {
  countryPacks: CountryPack[];
  statePacks: StatePack[];
  localities: LocalityReference[];
  comparablePool: Comparable[];
}

/* ------------------------------------------------------------------ */
/* Comparison (key user job 8)                                         */
/* ------------------------------------------------------------------ */

export interface ComparisonRow {
  key: string;
  label: string;
  /** Higher is better / lower is better / neutral — drives the winner highlight. */
  better: 'higher' | 'lower' | 'none';
  format: 'currency' | 'currency_per_sqm' | 'number' | 'percent' | 'score' | 'text' | 'days';
  values: { caseId: string; value: number | string | null; note?: string }[];
}

export interface ComparisonResult {
  generatedAt: string;
  cases: { id: string; reference: string; label: string; currency: CurrencyCode }[];
  rows: ComparisonRow[];
  /** Case id the engine would shortlist first, with the reason. */
  shortlist: { caseId: string; reason: string } | null;
  /** Cases that could not be compared like-for-like (e.g. different currency). */
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* API payloads                                                        */
/* ------------------------------------------------------------------ */

export interface CreateCaseRequest {
  identity: PropertyIdentity;
  ownerName: string;
  persona: PersonaKey;
  notes?: string;
}

export interface UpdateCaseRequest {
  identity?: Partial<PropertyIdentity>;
  status?: CaseStatus;
  persona?: PersonaKey;
  ownerName?: string;
  notes?: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
