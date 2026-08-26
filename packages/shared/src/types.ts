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
  /**
   * The title graph reduced to findings. Optional so that adding it did not
   * force a change on every existing construction site — the same reason
   * `explorations` is optional on `CaseIntelligence`.
   */
  titleGraph?: TitleGraphSummary;
  /** Diligence procedures evaluated for this case's jurisdiction. */
  playbooks?: PlaybookRun[];
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
  /** Agent output. Absent until an agent has run against this case. */
  intelligence?: CaseIntelligence;
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

/* ------------------------------------------------------------------ */
/* Agentic layer                                                       */
/* ------------------------------------------------------------------ */

/**
 * The agent roster.
 *
 * Agents supply *inputs and narrative*; they never overwrite a computed
 * valuation. The deterministic engine stays the arithmetic authority, so a
 * model that is wrong can widen or contradict the evidence but cannot silently
 * move the number a user acts on.
 */
export type AgentKind =
  | 'orchestrator'
  | 'planner'
  | 'critic'
  | 'explorer'
  | 'document_intelligence'
  | 'proof_pathways'
  | 'analyst_copilot'
  | 'market_research'
  | 'diligence_planner'
  /**
   * Proposes title-graph edges the deterministic builder then accepts or
   * rejects. It never writes to the graph itself — see `EdgeProposal`.
   */
  | 'title_graph';

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentStep {
  id: string;
  at: string;
  kind: 'plan' | 'tool_call' | 'tool_result' | 'message' | 'error';
  label: string;
  detail?: string;
  toolName?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Estimated, from the model's published rates — shown so cost is never a surprise. */
  estimatedCostUsd: number;
}

export interface AgentRun {
  id: string;
  caseId: string;
  agent: AgentKind;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  model: string;
  /** The tier that chose `model`. Absent on runs recorded before tiering. */
  tier?: ModelTier;
  steps: AgentStep[];
  summary?: string;
  /** What was actually put in front of the model, when retrieval selected it. */
  retrieval?: RetrievalSelection;
  error?: string;
  usage?: AgentUsage;
  /** Evidence this run contributed to the case ledger. */
  producedEvidenceIds: string[];
}

/* --- Proof sourcing: how to actually obtain a missing document ------ */

export type ProofRouteKind =
  | 'online_portal'
  | 'in_person_office'
  | 'authorised_intermediary'
  | 'from_seller'
  | 'from_lender'
  | 'court_or_tribunal'
  | 'reconstruct_from_secondary';

/** One concrete way to obtain a proof, costed and sequenced. */
export interface ProofRoute {
  id: string;
  kind: ProofRouteKind;
  title: string;
  /** BBMP, Sub-Registrar, DC office, K-RERA, Kadaster … */
  authority: string;
  portalOrAddress?: string;
  /** Form number, Sakala service code, or statutory reference. */
  formOrReference?: string;
  steps: string[];
  prerequisites: string[];
  typicalCost?: { low: number; high: number; currency: CurrencyCode };
  typicalDurationDays?: { low: number; high: number };
  feasibility: 'straightforward' | 'moderate' | 'difficult' | 'blocked';
  /** How this route can fail — stated, not glossed. */
  risks: string[];
  confidence: number;
  evidenceIds: string[];
}

/**
 * Every viable way to close one evidence gap.
 *
 * The point is exhaustiveness: a buyer stuck without a khata needs to know all
 * the routes and their trade-offs, not just the first one a model thought of.
 */
export interface DocumentPathway {
  id: string;
  targetKind: 'missing_document' | 'unresolved_check' | 'weak_evidence';
  /** Document kind, compliance check key, or evidence id this closes. */
  targetKey: string;
  targetLabel: string;
  whyItMatters: string;
  /** Ranked best-first; an empty list means the gap has no known route. */
  routes: ProofRoute[];
  recommendedRouteId?: string;
  /** What becomes provable once this lands. */
  unlocks: string[];
  /** Which screen outputs would change — confidence, a risk, a compliance check. */
  wouldResolve: string[];
}

/* --- External research ---------------------------------------------- */

export interface ResearchFinding {
  id: string;
  claim: string;
  sourceUrl?: string;
  sourceTitle?: string;
  retrievedAt: string;
  relevance: string;
  confidence: number;
  corroboration: 'multiple_sources' | 'single_source' | 'uncorroborated';
  /** True when the finding contradicts something the deterministic engine holds. */
  contradictsEngine: boolean;
}

/* --- Insights & copilot ---------------------------------------------- */

export interface AgentInsight {
  id: string;
  title: string;
  body: string;
  category: 'valuation' | 'risk' | 'compliance' | 'market' | 'process';
  importance: 'high' | 'medium' | 'low';
  evidenceIds: string[];
  /** True when this rests on model reasoning rather than a documented fact. */
  inferred: boolean;
}

export interface CopilotTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  citedEvidenceIds: string[];
  toolCalls?: { name: string; summary: string }[];
  /** Set when the agent declined to answer because the evidence does not support one. */
  refusedForLackOfEvidence?: boolean;
}

export interface CaseIntelligence {
  runs: AgentRun[];
  plan?: AgentPlan;
  verification?: VerificationSummary;
  /** Optional so that adding exploration did not force a change on every existing construction site. */
  explorations?: ExplorationSession[];
  pathways: DocumentPathway[];
  research: ResearchFinding[];
  insights: AgentInsight[];
  conversation: CopilotTurn[];
  lastRunAt?: string;
  /** Per-agent model and spend for the last run. Optional — older cases have none. */
  cost?: CaseCostSummary;
  /** External data pulled into this case, including the sources that could not be reached. */
  ingestions?: IngestionReport[];
  /** What cross-case memory was consulted for this case, and what it returned. */
  memory?: MemoryRecall;
}

/** Reported to the UI so it can degrade honestly when no key is configured. */
export interface AgentCapability {
  available: boolean;
  /** 'ok' | 'no_credentials' | 'disabled' */
  reason: string;
  model: string;
  webSearchEnabled: boolean;
  /** Agents the deployment permits, in run order. */
  enabledAgents: AgentKind[];
  /** Which model each agent will actually use. Absent on older API versions. */
  tiers?: ModelTierAssignment[];
}

/* ------------------------------------------------------------------ */
/* Verification, planning and open-ended exploration                   */
/* ------------------------------------------------------------------ */

export type CriticVerdict = 'supported' | 'partly_supported' | 'unsupported' | 'contradicted';

/**
 * One adversarial check of another agent's claim.
 *
 * A generative agent asked to be exhaustive will reach past its grounding —
 * that is the failure mode this product cannot afford, because an invented fee
 * or a fabricated service code reads exactly like a real one. The critic exists
 * to make that reach visible rather than to be polite about it.
 */
export interface CriticFinding {
  id: string;
  /** What was checked: a pathway id, route id, insight id, or research finding id. */
  targetId: string;
  targetKind: 'proof_route' | 'pathway' | 'insight' | 'research_finding' | 'copilot_answer';
  targetLabel: string;
  verdict: CriticVerdict;
  /** The specific claim examined, quoted. */
  claim: string;
  reasoning: string;
  /** Corpus entry, evidence id or dataset the check was made against. */
  checkedAgainst: string[];
  /** Set when the claim states a figure, code or procedure the grounding does not contain. */
  unsupportedSpecifics: string[];
  confidence: number;
}

export interface VerificationSummary {
  checkedCount: number;
  findings: CriticFinding[];
  /** Ids the critic judged unsupported or contradicted — the UI must mark these. */
  flaggedIds: string[];
  /** 0..100 share of checked claims that came back supported. */
  groundingScore: number;
}

/* --- Dynamic planning ------------------------------------------------ */

export type TaskDepth = 'skip' | 'light' | 'standard' | 'deep';

export interface PlannedTask {
  agent: AgentKind;
  depth: TaskDepth;
  /** Why this case warrants this depth — shown to the user, not just logged. */
  rationale: string;
  /** Lower runs earlier; equal values may run concurrently. */
  order: number;
  /** Specific things this run should concentrate on for this case. */
  focus: string[];
}

export interface AgentPlan {
  id: string;
  createdAt: string;
  /** The planner's read of what this case actually needs. */
  caseAssessment: string;
  tasks: PlannedTask[];
  /** Named things the planner deliberately chose not to do, and why. */
  deliberateOmissions: string[];
  estimatedCostUsd: number;
}

/* --- Open-ended exploration ------------------------------------------ */

export type SourceReachability = 'fetched' | 'blocked_auth' | 'blocked_captcha' | 'not_found' | 'rate_limited';

/** A lead the explorer chose to follow, and what came of it. */
export interface ExplorationLead {
  id: string;
  question: string;
  /** Why the agent decided this was worth pursuing. */
  motivation: string;
  queries: string[];
  visited: { url: string; title?: string; reachability: SourceReachability; note?: string }[];
  outcome: 'answered' | 'partial' | 'dead_end';
  finding?: string;
  confidence: number;
  spawnedLeadIds: string[];
}

/**
 * An open-ended research run.
 *
 * Unlike the other agents this one has no fixed output shape to fill — it
 * decides what to look at, follows what it finds, and stops when the marginal
 * lead stops paying. The budget and the dead-end record are what keep that from
 * becoming an expensive wander.
 */
export interface ExplorationSession {
  id: string;
  caseId: string;
  objective: string;
  startedAt: string;
  finishedAt?: string;
  leads: ExplorationLead[];
  /** Sources the agent could not reach, so the user knows what was NOT checked. */
  unreachable: { source: string; reachability: SourceReachability; whatItWouldHaveAnswered: string }[];
  /** The agent's own account of what it still does not know. */
  openQuestions: string[];
  iterations: number;
  stoppedBecause: 'objective_met' | 'budget_exhausted' | 'no_new_leads' | 'error';
  usage?: AgentUsage;
}

/* ==================================================================== */
/* Title graph                                                          */
/* ==================================================================== */

/**
 * Chain of title is a directed, temporal graph, so it is modelled as one.
 *
 * A flat evidence ledger can record that a mother deed exists; it cannot
 * represent the *chain* — who conveyed what to whom, when, and whether the
 * links actually join up. Every real title defect lives in that structure:
 * a gap between two owners, an extent that grows between one deed and the
 * next, a khata that names someone the deeds never mention.
 *
 * Two properties are load-bearing.
 *
 * **Strict.** Unlike the agent-memory graph (see `MemoryFact`), this is a
 * legal object. A wrong edge here is a liability, so the ontology is closed
 * — the kinds below and no others — and construction is deterministic. A
 * model may *propose* an edge (see `EdgeProposal`); only the builder decides
 * whether it enters the graph, and a rejected proposal stays visible with
 * its reason rather than disappearing.
 *
 * **Bi-temporal.** Every assertion carries both when the fact was true in
 * the world (`validFrom`/`validTo`) and when we came to know it
 * (`assertedAt`). Property facts are inherently bi-temporal — "X owned this
 * from 1998 to 2007" and "we learned that on 2026-08-26, from the EC" are
 * different statements, and conflating them loses the ability to say which
 * document is out of date.
 */

export type TitleNodeKind =
  | 'party'
  /** A parcel: survey number, khata number, kadastrale aanduiding. */
  | 'parcel'
  /** A registered or executed document that does legal work: deed, agreement, JDA. */
  | 'instrument'
  | 'authority'
  | 'encumbrance'
  /** A permission: OC, CC, sanctioned plan, DC conversion order, RERA registration. */
  | 'approval';

export type TitleEdgeKind =
  /** instrument → party. The party receiving the interest. */
  | 'conveyed_to'
  /** instrument → party. The party parting with it. */
  | 'conveyed_by'
  /** instrument | approval | encumbrance → parcel. */
  | 'affects'
  /** instrument → instrument, or parcel → parcel (subdivision / amalgamation). */
  | 'derives_from'
  | 'encumbers'
  | 'issued_by'
  /** A later instrument replacing an earlier one (rectification, cancellation). */
  | 'supersedes'
  /** Any node → parcel, carrying a claimed area. The edge that makes area conflicts findable. */
  | 'asserts_area'
  /** Two nodes the builder judged to be the same real-world thing. */
  | 'identifies';

/**
 * Who says so, and when they said it.
 *
 * Separate from the node/edge itself because the same fact is often asserted
 * by several documents at different confidences, and a conflict between two
 * assertions is information rather than a problem to average away.
 */
export interface TitleAssertion {
  /** Document id, dataset id, or `identity` for the case record itself. */
  sourceRef: string;
  sourceLabel: string;
  sourceType: EvidenceSourceType;
  /** Knowledge time: when this became known to the case. */
  assertedAt: string;
  /** 0..1 */
  confidence: number;
  /** The extraction field key this came from, where it came from one. */
  fieldKey?: string;
}

export interface TitleNode {
  id: string;
  kind: TitleNodeKind;
  label: string;
  /**
   * Normalised identity used to merge the same real-world thing mentioned
   * across several documents ("Sy. No. 118/2" and "Survey Number 118/2").
   * Two nodes of the same kind with the same merge key are one node.
   */
  mergeKey: string;
  attributes: Record<string, string | number | boolean>;
  assertedBy: TitleAssertion[];
}

export interface TitleEdge {
  id: string;
  kind: TitleEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  /** World time. Undefined means the document did not date it. */
  validFrom?: string;
  validTo?: string;
  assertedBy: TitleAssertion[];
  /** 0..1, the strongest assertion behind this edge. */
  confidence: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TitleGraph {
  caseId: string;
  builtAt: string;
  nodes: TitleNode[];
  edges: TitleEdge[];
}

/* --- Chain reconstruction -------------------------------------------- */

export interface ChainLink {
  id: string;
  instrumentNodeId: string;
  label: string;
  /** Instrument date, where the document carried one. */
  at?: string;
  fromPartyNodeId?: string;
  toPartyNodeId?: string;
  fromPartyLabel?: string;
  toPartyLabel?: string;
  documentId?: string;
  /** Area this instrument claims to convey, in sqm, where stated. */
  extentSqm?: number;
}

export type ChainBreakKind =
  /** An instrument with no antecedent — nothing explains how the grantor came to own it. */
  | 'missing_predecessor'
  /** Consecutive links where the grantor is not the previous grantee. */
  | 'party_discontinuity'
  /** An instrument the documents never dated, so it cannot be placed in sequence. */
  | 'undated_instrument'
  /** No instrument at all establishes the root of title. */
  | 'no_root'
  /** The chain is continuous but shallower than the jurisdiction expects. */
  | 'insufficient_depth';

export interface ChainBreak {
  id: string;
  kind: ChainBreakKind;
  /** The finding in words, naming the parties and dates involved. */
  statement: string;
  afterLinkId?: string;
  beforeLinkId?: string;
  severity: RiskSeverity;
  /** Plain descriptions of what would close this gap. */
  resolvedBy: string[];
}

export interface TitleChain {
  parcelNodeId: string;
  parcelLabel: string;
  /** Ordered oldest-first. Undated instruments sort last and raise a break. */
  links: ChainLink[];
  breaks: ChainBreak[];
  /** Date of the earliest instrument found. The chain is only as deep as the documents allow. */
  rootAt?: string;
  /** Span in years between the earliest and latest instrument. */
  yearsEstablished?: number;
  /** What the jurisdiction expects — 30 in Karnataka practice. */
  yearsExpected?: number;
}

/* --- Contradiction detection ----------------------------------------- */

export type ContradictionKind =
  | 'area_mismatch'
  | 'party_mismatch'
  | 'date_impossible'
  | 'identifier_mismatch'
  | 'status_conflict';

export interface ContradictionClaim {
  sourceRef: string;
  sourceLabel: string;
  fieldKey: string;
  value: string;
  unit?: string;
  confidence: number;
}

/**
 * Two or more sources that cannot both be right.
 *
 * Kept distinct from `RiskFlag`: a risk is a judgement about the property, a
 * contradiction is an observation about the paperwork. It becomes a risk only
 * once the engine decides it matters.
 */
export interface GraphContradiction {
  id: string;
  kind: ContradictionKind;
  /** What the sources disagree about, e.g. "Extent of Sy. No. 118/2". */
  subject: string;
  statement: string;
  claims: ContradictionClaim[];
  /** For numeric conflicts: spread as a fraction of the largest value, 0..1. */
  divergence?: number;
  severity: RiskSeverity;
  resolvedBy: string[];
}

/* --- Counterfactual resolution --------------------------------------- */

/**
 * What one missing document would fix.
 *
 * Evidence dependency is itself a graph, which makes "obtain this and four
 * risks collapse" computable rather than hand-written per case.
 */
export interface ResolutionPath {
  id: string;
  /** The document or fact to obtain, stated as an instruction. */
  obtain: string;
  documentKind?: DocumentKind;
  /** Ids of the `ChainBreak`s and `GraphContradiction`s this would close. */
  resolves: string[];
  /** Share of open finding weight this clears, 0..1. */
  impact: number;
  rationale: string;
}

/* --- Model-proposed edges -------------------------------------------- */

export type EdgeProposalOutcome =
  | 'accepted'
  | 'rejected_unknown_node'
  | 'rejected_low_confidence'
  | 'rejected_uncited'
  | 'rejected_invalid_kind'
  | 'duplicate';

/**
 * An edge a model suggested. The builder decides.
 *
 * This is the seam between "the model reads the deed and sees that Ramaiah
 * conveyed to the society" and "the graph now asserts that". Rejections stay
 * in the record with their reason, because a model repeatedly proposing an
 * edge the builder will not accept is itself a finding.
 */
export interface EdgeProposal {
  id: string;
  kind: TitleEdgeKind;
  fromMergeKey: string;
  toMergeKey: string;
  validFrom?: string;
  validTo?: string;
  rationale: string;
  citedDocumentIds: string[];
  confidence: number;
  outcome: EdgeProposalOutcome;
  rejectionReason?: string;
}

/** The graph reduced to what a screen needs to show. Carried on `ScreenResult`. */
export interface TitleGraphSummary {
  builtAt: string;
  nodeCount: number;
  edgeCount: number;
  chains: TitleChain[];
  contradictions: GraphContradiction[];
  resolutionPaths: ResolutionPath[];
  /** 0..100. How much of the title story the documents on file actually establish. */
  integrityScore: number;
  headline: string;
  /** Present when a model contributed edges this build. */
  proposals?: EdgeProposal[];
}

/* ==================================================================== */
/* Workflow playbooks                                                   */
/* ==================================================================== */

/**
 * A diligence procedure, encoded.
 *
 * A title lawyer doing Bengaluru diligence follows a defined sequence with
 * gates: establishing the chain comes before reconciling areas, because
 * reconciling areas against a chain you have not established is a number
 * without a meaning. A generic planner will happily do step four first.
 *
 * So the gates are explicit and the engine refuses to guess past them: a step
 * whose prerequisite is not `clear` reports `blocked`, naming what blocks it,
 * rather than producing a finding it cannot support.
 */
export type PlaybookStepState =
  | 'clear'
  | 'attention'
  /** A prerequisite step is not clear, so this one cannot be evaluated yet. */
  | 'blocked'
  /** Evaluable, but the documents needed have not been supplied. */
  | 'not_started'
  | 'not_applicable';

export interface PlaybookStepResult {
  key: string;
  label: string;
  /** The question a practitioner would actually ask at this step. */
  question: string;
  state: PlaybookStepState;
  /** Why it is in that state. Never empty — a state without a reason is not usable. */
  finding: string;
  requires: string[];
  /** Set when `state` is 'blocked': the prerequisite keys that are not clear. */
  blockedBy?: string[];
  evidenceIds: string[];
  /** Documents that would move this step forward. */
  needs: DocumentKind[];
  /** Statute, rule or circular this step tests against. */
  citation?: string;
}

export interface PlaybookRun {
  playbookId: string;
  label: string;
  /** The authority whose procedure this is — BBMP, DC office, Sub-Registrar. */
  authorityContext: string;
  steps: PlaybookStepResult[];
  /** 0..100 across steps that could be evaluated. Blocked steps are not counted as failures. */
  progressPct: number;
  /** Where the user should look first. */
  nextStepKey?: string;
  verdict: ComplianceVerdict;
}

/* ==================================================================== */
/* Model tiering & cost                                                 */
/* ==================================================================== */

/**
 * Not every agent needs the same model.
 *
 * Extraction, classification and field normalisation are mechanical; judgment,
 * adversarial checking and title-chain reasoning are not. Running the whole
 * roster on one frontier model makes cost-per-case the variable that decides
 * what this product can be priced at, for no gain on the steps where quality
 * is not the binding constraint.
 */
export type ModelTier =
  /** Mechanical: read a document, pull fields, normalise them. */
  | 'extraction'
  /** Structured reasoning over supplied facts: pathways, planning, research. */
  | 'reasoning'
  /** Where being wrong is expensive: critic, title chain, the copilot's answers. */
  | 'judgment';

export interface ModelTierAssignment {
  agent: AgentKind;
  tier: ModelTier;
  model: string;
}

export interface CostBreakdownEntry {
  agent: AgentKind;
  model: string;
  tier: ModelTier;
  usage: AgentUsage;
}

export interface CaseCostSummary {
  perAgent: CostBreakdownEntry[];
  total: AgentUsage;
  /** What this run would have cost with every agent on the judgment-tier model. */
  singleTierComparisonUsd: number;
  /** The difference. Shown because cost per case decides what this can be sold for. */
  savedUsd: number;
}

/* ==================================================================== */
/* Data acquisition                                                     */
/* ==================================================================== */

export type SourceKind =
  | 'registry'
  | 'guidance_value'
  | 'comparables'
  | 'planning'
  | 'tax'
  | 'rera'
  | 'cadastral';

export type SourceAccess =
  /** Reachable without credentials. */
  | 'open'
  | 'auth_required'
  | 'captcha'
  /** Exists only across a counter. */
  | 'offline_only'
  /** Reachable, but only as a file the user obtains and supplies. */
  | 'file_upload';

/**
 * A source of real data, and — when it cannot be reached — an honest account
 * of what was therefore not checked.
 *
 * `whatItWouldHaveAnswered` is required rather than optional on purpose. A
 * source list that silently omits the unreachable ones tells the user the
 * diligence was more complete than it was.
 */
export interface DataSourceDescriptor {
  id: string;
  label: string;
  authority: string;
  kind: SourceKind;
  country: CountryCode;
  state?: string;
  access: SourceAccess;
  url?: string;
  whatItWouldHaveAnswered: string;
  /** How to obtain it by hand when the machine cannot. */
  manualRoute?: string;
}

export type IngestedRecordType =
  | 'guidance_value'
  | 'comparable'
  | 'encumbrance'
  | 'instrument'
  | 'parcel'
  | 'approval';

export interface IngestedRecord {
  id: string;
  sourceId: string;
  recordType: IngestedRecordType;
  fields: Record<string, string | number | boolean>;
  /** When the source observed this, not when we read it. */
  observedAt: string;
  confidence: number;
}

export type IngestionOutcome = 'ingested' | 'unreachable' | 'no_match' | 'skipped';

export interface IngestionAttempt {
  sourceId: string;
  sourceLabel: string;
  access: SourceAccess;
  outcome: IngestionOutcome;
  note: string;
  recordCount: number;
}

export interface IngestionReport {
  id: string;
  caseId: string;
  startedAt: string;
  finishedAt?: string;
  attempted: IngestionAttempt[];
  records: IngestedRecord[];
  /** Graph nodes and edges this ingestion contributed. */
  addedNodeIds: string[];
  addedEdgeIds: string[];
}

/* ==================================================================== */
/* Agent memory                                                         */
/* ==================================================================== */

/**
 * What the system has learned across cases.
 *
 * Deliberately a *separate* structure from the title graph, not a section of
 * it. The title graph is a legal object built deterministically from
 * documents; memory is loose, accretive and allowed to be wrong. Mixing them
 * would let "we think this promoter is unreliable" sit alongside "this deed
 * conveys 2,400 sqft" with the same apparent standing, which is precisely the
 * confusion that makes AI output unusable in a diligence context.
 *
 * Bi-temporal for the same reason the title graph is: a fact that was true
 * and has since changed is different from a fact we have just corrected.
 */
export type MemoryScope =
  | 'party'
  | 'locality'
  /** Whether a given source actually answered last time it was tried. */
  | 'source_reliability'
  /** A procedure that worked: the counter that issued the certificate, the form that was accepted. */
  | 'procedure'
  | 'user_preference';

export interface MemoryFact {
  id: string;
  scope: MemoryScope;
  /** Normalised entity key, e.g. `party:ramaiah-s` or `locality:whitefield`. */
  subject: string;
  subjectLabel: string;
  predicate: string;
  object: string;
  /** World time. */
  validFrom: string;
  validTo?: string;
  /** Knowledge time. */
  assertedAt: string;
  sourceCaseId: string;
  sourceRef?: string;
  confidence: number;
  /** Set when a later fact replaced this one; superseded facts are kept, not deleted. */
  supersededById?: string;
}

export interface MemoryRecall {
  facts: MemoryFact[];
  /** Subjects looked up — shown even when nothing came back, so "no history" is visible. */
  consultedSubjects: string[];
  /** Facts held back because they were superseded or had expired. */
  excludedCount: number;
}

/* ==================================================================== */
/* Graph-backed retrieval                                               */
/* ==================================================================== */

/**
 * What was actually put in front of the model, and what was left out.
 *
 * Dumping the whole case into a prompt has a ceiling that real diligence
 * (40+ documents, hundreds of pages) passes immediately. Retrieval keeps the
 * context bounded, but a bounded context that hides its own omissions is
 * worse than an oversized one — so the sections dropped for budget are
 * recorded here and surfaced.
 */
export interface RetrievalSection {
  key: string;
  label: string;
  approxTokens: number;
  /** Why this was selected, or why it was dropped. */
  reason: string;
}

export interface RetrievalSelection {
  /** Graph nodes the focus resolved to. */
  focusNodeIds: string[];
  focusLabels: string[];
  included: RetrievalSection[];
  omitted: RetrievalSection[];
  approxTokens: number;
  budgetTokens: number;
}
