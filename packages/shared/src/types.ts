/**
 * Realytica domain contract.
 *
 * This file is the single source of truth shared by the API and the web client.
 * Every screen in the product maps onto one of the structures below, and every
 * number a user sees is expected to carry an `evidenceIds` trail back to a
 * `EvidenceItem` (principle 1: Evidence Before Assertion).
 */

import type { DisclosureLevel } from './disclosure';

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

/* ------------------------------------------------------------------ */
/* Project kind & assessment profile                                   */
/* ------------------------------------------------------------------ */

/**
 * What is actually being done with the site.
 *
 * `PropertyType` describes the *thing* — an apartment, a plot, a warehouse.
 * This describes the *undertaking*, and it is the undertaking that decides
 * how the thing should be assessed. The same 2-acre converted parcel is a
 * land-rate question to someone flipping it, a residual-value question to
 * someone building 120 flats on it, and an area-share question to someone
 * signing a JDA over it. One property type, three different assessments.
 *
 * Kept deliberately small and mutually exclusive: each value has to select a
 * materially different set of methods and checks, or it does not earn a slot.
 */
export type ProjectKind =
  /** Acquiring land with no scheme decided yet. Valued as land. */
  | 'land_acquisition'
  /** Subdividing land into sites and selling them. Valued on saleable site yield. */
  | 'plotted_development'
  /** Villas or row houses built for sale on a layout. */
  | 'villa_project'
  /** Multi-storey residential built for sale. */
  | 'apartment_project'
  /** Residential and commercial in one scheme. */
  | 'mixed_use_project'
  /** Office or retail built to lease or sell. Valued on income. */
  | 'commercial_development'
  /** Warehousing, logistics or manufacturing. */
  | 'industrial_development'
  /** Demolishing an existing building and rebuilding to a higher envelope. */
  | 'redevelopment'
  /** Developing someone else's land under a JDA for a revenue or area share. */
  | 'joint_development'
  /** Buying something already built — a unit, a floor, a whole building. */
  | 'built_asset_purchase';

/**
 * What the user says they mean to do. Distinct from `ProjectKind`: the intent
 * is what they told us, the kind is what we concluded. Keeping them separate
 * is what lets the product show its reasoning instead of asserting it.
 */
export type ProjectIntent =
  | 'buy_and_hold'
  | 'buy_and_build'
  | 'subdivide_and_sell'
  | 'partner_with_landowner'
  | 'redevelop_existing'
  | 'unknown';

/**
 * Who the assessment is written for. Four readers with genuinely different
 * questions, not four skins on one page:
 *
 * - `developer` decides whether to buy and at what number.
 * - `engineering` decides whether it can be built and what it costs to build.
 * - `architect` decides what envelope the statute actually permits.
 * - `project_manager` decides the sequence, the approvals and the dates.
 */
export type LensKey = 'developer' | 'engineering' | 'architect' | 'project_manager';

/** How a valuation method is being used on this project kind. */
export type MethodRole = 'primary' | 'supporting' | 'sense_check' | 'not_applicable';

export interface MethodStance {
  method: ValuationMethod;
  role: MethodRole;
  /**
   * Relative emphasis *within* this method's role band. The role decides the
   * band's share of the blend; this orders the methods inside it, on top of
   * the engine's own base weight. `0` is reserved for `not_applicable` and
   * suppresses the anchor entirely — the method is not merely down-weighted,
   * it does not apply and is not shown as if it did.
   */
  weightFactor: number;
  /** Why this method leads or does not, for this kind of project. */
  why: string;
}

/**
 * The assessment method for one project kind: which valuations lead, which
 * checks cannot be skipped, which documents the conclusion depends on, and
 * the single question the reader is really asking.
 *
 * This is a stated method, not a hidden one. Everything here is rendered to
 * the user, because a user who cannot see why a number was reached that way
 * has no basis for trusting it.
 */
export interface AssessmentProfile {
  kind: ProjectKind;
  label: string;
  /** One line: what this kind of project is. */
  summary: string;
  /** The single question the assessment exists to answer. */
  headlineQuestion: string;
  /** What the decision actually turns on, in the reader's own terms. */
  decisionBasis: string[];
  methodStances: MethodStance[];
  /**
   * Compliance/title check keys that are load-bearing for this kind. An
   * unresolved check on this list is escalated rather than listed quietly.
   */
  criticalChecks: string[];
  /** Documents the conclusion is not credible without. */
  requiredDocuments: DocumentKind[];
  /** Who the report addresses unless the reader picks otherwise. */
  defaultLens: LensKey;
}

/**
 * How the project kind was arrived at.
 *
 * `alternatives` being non-empty is the important case: it means the evidence
 * narrows the kind but does not settle it, so the profile in force is a
 * working assumption. The UI says exactly that and offers `settledBy` as the
 * one question that would resolve it. Silently picking the most likely kind
 * and presenting its numbers as findings is the failure mode this type
 * exists to prevent.
 */
export interface ProjectKindInference {
  kind: ProjectKind;
  /** 0..1 */
  confidence: number;
  /** Each fact that pushed the conclusion, in plain language. */
  basis: string[];
  /** Kinds this same evidence is also consistent with. */
  alternatives: ProjectKind[];
  /** The one answer that would settle it. Absent when the inference is decisive. */
  settledBy?: string;
}

/**
 * The project kind in force on a case, and where it came from.
 *
 * `source` matters: `'user'` means someone stated it and the engine must not
 * second-guess it; `'inferred'` means the engine concluded it and should keep
 * showing its reasoning until a human confirms.
 */
export interface ProjectBrief {
  kind: ProjectKind;
  source: 'user' | 'inferred';
  intent: ProjectIntent;
  inference: ProjectKindInference;
  /** Units planned, when the user has said. Sharpens the residual anchor. */
  unitsPlanned?: number;
  /**
   * Present when the kind in force does not fit the subject — a subdivision
   * on a site too small to subdivide, a redevelopment with nothing standing.
   *
   * A caution, not a refusal: someone assembling adjacent parcels, or
   * screening a site before the neighbour's is bought, has a real reason to
   * ask the question this way. But the figures underneath are then answering
   * a hypothetical, and the reader has to be told which.
   */
  fitCaution?: string;
  /** ISO date the kind was last set or confirmed. */
  decidedAt: string;
}

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
  /**
   * Restrictions on the parcel that come from something other than its title
   * — an aerodrome height cap, a transmission corridor, a highway control
   * line. Absent means nobody has looked; the engine reports that as its own
   * finding rather than as an all-clear.
   */
  siteConstraints?: SiteConstraintDeclaration[];
}

/* ------------------------------------------------------------------ */
/* Statutory site constraints                                          */
/* ------------------------------------------------------------------ */

/**
 * Restrictions on a parcel that come from something other than its title.
 *
 * A title screen answers "can this be transferred to me". These answer the
 * separate question "and once it is, what may I do with it" — and they are
 * the class of defect most likely to be discovered after money has changed
 * hands, because none of them appears in any deed. A high-tension line
 * crossing a site is not in the sale deed. Neither is a height cap imposed
 * because the site sits under an approach funnel, nor a highway control line
 * that will take the front twelve metres when the road is widened.
 *
 * The drain and lake buffers already in the pack are members of this family;
 * these six are the rest of it for a Bengaluru parcel.
 */
export type SiteConstraintKey =
  /** Height capped by an aerodrome's obstacle-limitation surfaces; needs an AAI NOC. */
  | 'airport_height'
  /** Statutory clearance from an overhead transmission line's conductors. */
  | 'high_tension_line'
  /** Building line / control line setback from a national or state highway. */
  | 'highway_control_line'
  /** Setback from a railway boundary. */
  | 'railway_boundary'
  /** Setback from a burial ground or crematorium. */
  | 'burial_ground'
  /** Within or adjoining a granted quarrying or mining lease area. */
  | 'quarry_lease';

/**
 * Whether a constraint applies, does not apply, or has not been looked at.
 *
 * Three states rather than a boolean, because the third is the common one and
 * the whole product turns on not letting it read as the second. "Nobody has
 * checked whether a transmission line crosses this site" and "no transmission
 * line crosses this site" are different facts with different consequences,
 * and a `boolean | undefined` invites a call site to conflate them.
 */
export type ConstraintPresence = 'present' | 'absent' | 'unknown';

/** What a case records about one constraint. */
export interface SiteConstraintDeclaration {
  key: SiteConstraintKey;
  presence: ConstraintPresence;
  /** Which line, which highway, how far — whatever the person who checked knows. */
  note?: string;
}

/**
 * What a State Pack knows about one constraint: what it restricts, who
 * decides, and what document settles it.
 *
 * Deliberately carries no metre figure. The drain buffers next door do carry
 * one and are hedged heavily for it; these are worse. An aerodrome height cap
 * is a function of distance and bearing from the runway and of the terrain
 * between, computed by the authority from its own surfaces. A transmission
 * clearance depends on the voltage class of that specific line. A highway
 * control line depends on the road's classification and on whether a
 * widening notification is in force. Printing a single number for any of them
 * would assert a precision none of them has, and this codebase has been down
 * that road once already with the rajakaluve buffers.
 */
export interface SiteConstraintRule {
  key: SiteConstraintKey;
  label: string;
  /** What the restriction actually does to the property. */
  restriction: string;
  /** Who decides, and what they issue. */
  authority: string;
  statute: string;
  /** What to obtain to settle it either way. */
  obtain: string;
  /** How bad it is when it is present and unresolved. */
  severityWhenPresent: RiskSeverity;
}

/**
 * An aerodrome near enough to a locality that its height restrictions may
 * reach it.
 *
 * Distance is indicative and locality-level: it exists so a case with no map
 * lookup still gets the question raised. Where a site context has actually
 * measured the distance, the engine prefers the measurement — the same
 * estimate-versus-measured split the transit driver uses, and for the same
 * reason.
 */
export interface AerodromeReference {
  name: string;
  /** Indicative straight-line kilometres from the locality to the aerodrome. */
  approxKm: number;
  note: string;
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
/* Development control                                                 */
/* ------------------------------------------------------------------ */

/**
 * FAR permitted at a given abutting road width.
 *
 * The single most consequential fact about a Bengaluru development site, and
 * the one most often assumed rather than checked: the zoning table gives a
 * headline FAR, and the width of the road the plot actually abuts caps it.
 * A 3.25-FAR zone reached by a 9m road is a 2.25-FAR site, and the 44%
 * difference is the whole scheme.
 */
export interface FarByRoadWidth {
  /** Inclusive lower bound of the band, in metres. */
  minRoadWidthM: number;
  /** Exclusive upper bound. Absent on the topmost band. */
  maxRoadWidthM?: number;
  far: number;
}

/** Maximum ground coverage, banded by plot size. Larger plots get less. */
export interface GroundCoverageBand {
  /** Inclusive upper bound of the band in sqm. Absent on the topmost band. */
  maxPlotAreaSqm?: number;
  coveragePct: number;
}

/** Minimum all-round setback, banded by building height. */
export interface SetbackBand {
  /** Inclusive upper bound of the band in metres of building height. Absent on the topmost band. */
  maxHeightM?: number;
  /** Minimum setback on every side, in metres. */
  allRoundM: number;
}

/** Car parking a use has to provide, and what a space costs in area. */
export interface ParkingNorm {
  /**
   * Which project kinds this norm covers.
   *
   * Keyed on what is being *built*, not on `PropertyType`, which is what is
   * being *bought*. A development site's property type is `land_parcel` or
   * `residential_plot` — so a norm keyed on property type matched nothing on
   * every site a yield is ever computed for, and silently reported zero
   * parking required.
   */
  appliesTo: ProjectKind[];
  /** One car space per this many sqm of constructed area. */
  sqmPerSpace: number;
  /** Visitor parking, as a share of the resident/occupant spaces. */
  visitorPct: number;
  /** Area one space consumes including its share of aisle and ramp. */
  sqmPerSpaceIncludingAisle: number;
}

/**
 * What the statute lets you build here, as tables.
 *
 * Deliberately a `StatutoryRule` like every other figure in a pack: these are
 * revised, they are revised often, and a yield computed against a stale table
 * is worse than no yield because it looks authoritative.
 */
export interface DevelopmentControl {
  farByRoadWidth: FarByRoadWidth[];
  groundCoverage: GroundCoverageBand[];
  setbacks: SetbackBand[];
  parking: ParkingNorm[];
  /** Typical floor-to-floor height, for turning a permitted area into floors. */
  floorToFloorM: number;
}

/**
 * A first-pass sizing of what this site can hold.
 *
 * Not a site plan and not a sanctioned scheme: no geometry, no block layout,
 * no orientation. It answers the four questions a developer, an engineer and
 * an architect all ask before anyone draws anything — what FAR actually
 * applies, how much of that survives coverage and setbacks, roughly how many
 * units that is, and whether the parking fits — and it says which of them it
 * could not answer and why.
 *
 * The `gaps` field carries as much weight as the numbers. A yield computed
 * without the abutting road width has assumed the zoning FAR applies, and
 * that assumption is the single most expensive one on this screen, so it is
 * never made silently.
 */
export interface SchematicYield {
  /** FAR the zoning gives for this locality, before any site-specific cap. */
  farFromZoning: number;
  /** FAR the abutting road width permits. Absent when the road width is unknown. */
  farFromRoadWidth?: number;
  /** The lower of the two, which is what actually applies. */
  farApplied: number;
  /** Which one binds — and `unknown` when the road width was never supplied. */
  bindingConstraint: 'road_width' | 'zoning' | 'unknown';
  /** Permitted FAR area on this plot, before coverage and setbacks bite. */
  permittedFarAreaSqm: number;

  /** Maximum share of the plot that may be built on. */
  groundCoveragePct: number;
  /** Footprint permitted by ground coverage alone. */
  coverageFootprintSqm: number;
  /** Setback assumed, from the height band the FAR area implies. */
  setbackAllRoundM: number;
  /** Footprint left after setbacks, for a rectangular plot of this area. */
  setbackFootprintSqm: number;
  /** The smaller of the two footprints — what can actually be built on. */
  footprintSqm: number;
  /** Floors needed to fit the permitted FAR area on that footprint. */
  floorsImplied: number;
  /** Height those floors reach, which is what the setback band was read from. */
  heightM: number;
  /**
   * True when the footprint cannot carry the permitted FAR area within a
   * plausible height — the site is coverage-bound, not FAR-bound, and the
   * headline FAR overstates what is achievable.
   */
  coverageBound: boolean;
  /**
   * False when the setbacks leave a floor plate too small to plan on. The
   * numbers below still compute; they just do not describe a building, and
   * the UI must not present them as if they did.
   */
  floorPlateViable: boolean;
  /** FAR area actually achievable once coverage and setbacks are applied. */
  achievableFarAreaSqm: number;

  /** Saleable area that converts to, at the pack's loading convention. */
  saleableAreaSqm: number;
  /** Indicative unit count at the assumed average unit size. */
  unitsIndicative?: number;
  /** Average saleable area per unit the count was computed at. */
  avgUnitSaleableSqm?: number;

  /** Car spaces the norms require. */
  parkingSpacesRequired: number;
  /** Spaces one basement level under the footprint would hold. */
  parkingSpacesPerBasement: number;
  /** Basement levels needed to meet the requirement. */
  basementLevelsNeeded: number;

  /** What could not be computed, and what supplying it would settle. */
  gaps: string[];
  /**
   * Provenance for every norm used. `asOf` carries because the whole point of
   * a `StatutoryRule` is that a figure is only as current as its source — and
   * a yield computed against a superseded FAR table is worse than no yield,
   * since it looks authoritative.
   */
  asOf: string;
  source: string;
  verifyNote: string;
  evidenceIds: string[];
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
  /**
   * How the project's assessment profile is using this method, and why.
   * Present once a `ProjectBrief` is in force — which is always, since the
   * engine infers one when the case does not carry it.
   */
  role?: MethodRole;
  roleNote?: string;
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
  /**
   * The registries and datasets this pack's checks are written against.
   *
   * Carried onto the summary so the reader can see what was consulted and, by
   * omission, what was not. It was already on the State Pack and reached only
   * the agent layer, which meant the one audience it was written for — the
   * person deciding whether to trust the output — never saw it.
   */
  datasets?: string[];
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
  /**
   * What kind of undertaking this is, and how that was decided. Always
   * present on a fresh result — the engine infers one when the case does not
   * carry it — but optional on the type so results stored before the project
   * model existed still parse.
   */
  project?: ProjectBrief;
  /**
   * The assessment method that selection put in force: which valuations
   * lead, which checks cannot be skipped, what the reader is really asking.
   * Carried on the result rather than looked up by the UI so a stored result
   * still explains itself if the profile is later revised.
   */
  assessment?: AssessmentProfile;
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
  /**
   * A first-pass sizing of the scheme this site can hold. Present when a
   * State Pack carries development-control norms and the project is a
   * development rather than a purchase — a finished flat has no yield to
   * compute.
   */
  yield?: SchematicYield;
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
  /**
   * What the property would realise in a constrained sale. Present when the
   * locality reference carries the liquidity figure it is derived from.
   */
  forcedSale?: ForcedSaleValue;
  /**
   * What to offer and the argument for it. Present whenever a range was
   * produced — which is always — so this is optional only so that adding it
   * did not invalidate every stored result.
   */
  offer?: OfferAdvice;
  /**
   * Flood and lake-network exposure of the locality this property sits in.
   * Catchment-level, never parcel-level — see `WaterExposureReference`.
   */
  waterExposure?: WaterExposureReference;
  recommendation: {
    verdict: ScreenVerdict;
    headline: string;
    reasoning: string[];
    /** Conditions that must clear before the verdict can improve. */
    conditions: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Water exposure (catchment, not parcel)                              */
/* ------------------------------------------------------------------ */

export type FloodExposure = 'low' | 'moderate' | 'high';

/**
 * Bengaluru's three primary storm-water valley systems.
 *
 * The city drains through three trunk valleys rather than a grid, and which
 * one a locality sits in explains more about its flooding than any other
 * single fact: the Koramangala–Challaghatta valley carries the Agara →
 * Bellandur → Varthur lake chain and is where the tech corridor's repeated
 * inundation happens, while the Vrishabhavathi valley drains the older,
 * higher west and south-west.
 *
 * Named as a closed set because a locality belongs to exactly one, and
 * because "which valley" is a question a Bengaluru buyer's lawyer and
 * architect will both ask.
 */
export type BengaluruValley = 'vrishabhavathi' | 'koramangala_challaghatta' | 'hebbal_nagavara';

/**
 * A locality's exposure to flooding and to the lake/drain network.
 *
 * --- What this is, and the line it must not cross -------------------------
 *
 * This is a *catchment* classification, not a parcel one. A site on high
 * ground in Bellandur does not flood because Bellandur floods; a site in a
 * filled tank bed in "low-risk" Jayanagar may. The distinction is the whole
 * reason this is carried as reference data attached to a locality rather
 * than as a property attribute: it describes where the property sits in the
 * city's drainage, and it is explicitly not a prediction about the parcel.
 *
 * It is also deliberately not derived from a map. `SiteContext` sets out why
 * measuring to a blue line on a satellite tile measures something that is
 * not the legal or hydrological feature. This is published, dated,
 * attributed classification — the same standing as the stamp-duty slabs in
 * the State Pack, and carried with the same `asOf` and `verifyNote` for the
 * same reason.
 */
export interface WaterExposureReference {
  floodExposure: FloodExposure;
  valley: BengaluruValley;
  /** The lake or tank chain this locality drains into or through. */
  lakeChain: string;
  /**
   * Places within the locality with a reported history of inundation.
   * Empty is a real answer and means "none recorded here" — not "safe".
   */
  knownInundationPoints: string[];
  /** What the classification means for a buyer, in plain language. */
  note: string;
  source: string;
  asOf: string;
  /** What the reader must check for themselves before relying on this. */
  verifyNote: string;
}

/* ------------------------------------------------------------------ */
/* Forced-sale value                                                   */
/* ------------------------------------------------------------------ */

/** One named component of the forced-sale discount. */
export interface ForcedSaleComponent {
  key: string;
  label: string;
  /** Percentage points of discount this component contributes. Always positive. */
  pct: number;
  /** Why this property would sell for less under a constrained sale. */
  reason: string;
  evidenceIds: string[];
}

/**
 * What the property would fetch in a constrained sale, and why that is less
 * than the open-market range.
 *
 * A different question from `IndicativeValue`, asked by a different reader.
 * The indicative range answers "what is it worth"; this answers "what would
 * it realise if it had to be sold inside a fixed window" — the figure a
 * lender underwrites recovery against, and the one an investor uses to size
 * downside. Indian lending practice asks for it by name alongside market
 * value, so it is a first-class output rather than a percentage a reader is
 * left to apply themselves.
 *
 * The discount is built from named components rather than a flat haircut,
 * because the components are the point: a B-khata site is not discounted
 * because sites are discounted, it is discounted because no buyer in it can
 * get a home loan, which removes most of the market. That sentence is worth
 * more to a reader than the number.
 *
 * `lendable` is separate from the figure and gates how it may be read. Where
 * a blocker means no regulated lender would advance against the property at
 * all, a "forced sale value" that looks like a lending input would be
 * actively misleading — the number is then what a cash buyer aware of the
 * defect might pay, and it says so.
 */
export interface ForcedSaleValue {
  value: number;
  currency: CurrencyCode;
  /** The constrained marketing window assumed, in days. */
  marketingPeriodDays: number;
  /** Total discount from the open-market mid, in percent. */
  discountPct: number;
  components: ForcedSaleComponent[];
  /**
   * False when a finding on this case means a regulated lender would not
   * advance against the property at all — in which case this figure is not
   * a lending input and must not be presented as one.
   */
  lendable: boolean;
  /** Who this figure is for, and what it is not. */
  basis: string;
  evidenceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Offer advice                                                        */
/* ------------------------------------------------------------------ */

/** One argument a buyer can put to a seller, with the money attached. */
export interface OfferArgument {
  key: string;
  label: string;
  /**
   * Signed amount in major units, or null where the point is real but its
   * size is genuinely not known yet.
   *
   * Null is not a failure to compute. This product's standing rule is that
   * an unpriced item is not a zero, and an offer that quietly treated an
   * unquantified defect as costing nothing would be the most expensive
   * possible version of that mistake.
   */
  amount: number | null;
  /** The point, phrased as the buyer would put it to the seller. */
  argument: string;
  evidenceIds: string[];
}

export type OfferStance = 'offer' | 'offer_conditionally' | 'do_not_offer';

/**
 * What to offer, and the argument for it.
 *
 * Every part of this already existed in the screen — the range, the
 * confidence spread, the transaction costs, the unresolved findings, the
 * negative value drivers — and the product stopped one step short of
 * assembling them, to the point where a recommended action literally read
 * "build a negotiation case from the anchor breakdown". This is that
 * assembly, and nothing here computes a new valuation: every figure is
 * derived from `IndicativeValue` and `TransactionCostBreakdown`, which
 * remain the arithmetic authority.
 *
 * Three prices rather than one, because a single number is not how a
 * negotiation works, and because the three carry different meanings:
 * `opening` is defensible from the evidence, `target` is where the evidence
 * says the deal sits, and `walkAway` is the point past which the buyer is
 * paying for something nobody has shown them.
 */
export interface OfferAdvice {
  currency: CurrencyCode;
  /** Where to open. Defensible from the evidence without being the ask. */
  opening: number;
  /** Where the evidence says this settles. */
  target: number;
  /** Above this, the buyer is paying beyond what the evidence supports. */
  walkAway: number;
  /**
   * Total cash required at `target`: the price plus every acquisition cost
   * the state pack can compute, recalculated at the offer rather than at the
   * asking price. Stamp duty in Karnataka is charged on the higher of
   * consideration and guidance value, so a lower offer does not always lower
   * the duty — and a buyer who budgeted as though it did is short on
   * completion day.
   */
  allInAtTarget: number;
  /** Acquisition costs at `target`, the difference between it and `allInAtTarget`. */
  acquisitionCostsAtTarget: number;
  /** The asking price this advice was written against, when there is one. */
  askingPrice: number | null;
  /** Gap between the ask and `target`, in major units. Null with no ask. */
  gapToAsking: number | null;
  arguments: OfferArgument[];
  /** What must be true — not paid — before any offer is made. */
  preconditions: string[];
  /** Costs and risks deliberately not deducted, and why. */
  unpriced: string[];
  stance: OfferStance;
  headline: string;
  evidenceIds: string[];
}

/* ------------------------------------------------------------------ */
/* Staleness                                                           */
/* ------------------------------------------------------------------ */

export type StaleKind =
  /** The screen itself was run a while ago. */
  | 'screen'
  /** A statutory figure the screen relied on is carried from an older date. */
  | 'reference_data'
  /** A document has aged past the point where a counterparty will accept it. */
  | 'document'
  /** A certificate or registration has expired, or is about to. */
  | 'expiry'
  /** A planning position was last checked a while ago. */
  | 'planning'
  /** The map lookup was built from an address the case no longer holds. */
  | 'site_context';

export interface StaleItem {
  key: string;
  kind: StaleKind;
  label: string;
  /** What has aged, in plain language. */
  what: string;
  /** The date it is carried from, ISO. */
  asOf: string;
  ageDays: number;
  severity: RiskSeverity;
  /** What refreshes it. */
  refresh: string;
}

/**
 * What has gone out of date on this case.
 *
 * Derived on read, never stored — the same decision as `RunGraph` and for a
 * sharper reason. A staleness report frozen into a `ScreenResult` would be
 * a statement about how old things were on the day the screen ran, which is
 * the one thing a reader does not want to know. It has to be computed
 * against the moment it is read or it is itself the stalest thing on the
 * page.
 *
 * The material was already there and unread: every statutory figure in the
 * State Pack carries an `asOf` precisely because those numbers move, an
 * encumbrance certificate covers a period that ends, a K-RERA registration
 * expires, and a khata extract older than a year gets sent back. The screen
 * consumed all of it and never asked how old any of it was.
 */
export interface StalenessReport {
  checkedAt: string;
  items: StaleItem[];
  /** The oldest date anything this result depends on is carried from. */
  oldestAsOf: string | null;
  /** How the reader should take this, in one sentence. */
  headline: string;
}

/* ------------------------------------------------------------------ */
/* Site context (location, surroundings, street-level imagery)         */
/* ------------------------------------------------------------------ */

/**
 * How precisely a geocode landed on the ground.
 *
 * This exists because a map pin is the single most convincing thing this
 * product can put on a screen, and in Bengaluru it is very often wrong. A
 * geocoder resolves postal addresses; it does not resolve survey numbers.
 * Ask one for "Sy. No. 118/2, Varthur Hobli" and it returns the centre of
 * Varthur, confidently, with no signal in the payload that it has done so
 * unless you read the precision back out. So the precision is carried on the
 * location itself and every consumer is expected to branch on it:
 *
 *   rooftop          the provider matched a specific address/premise
 *   interpolated     interpolated along a road segment from a house-number range
 *   locality_centre  the provider fell back to the locality, ward or town
 *   approximate      matched something, but not a class this code recognises
 *
 * Only the first two are treated as describing *this property*. The other two
 * describe the neighbourhood, and are shown as such — never used to price a
 * driver, never captioned as the site.
 */
export type GeocodePrecision = 'rooftop' | 'interpolated' | 'locality_centre' | 'approximate';

/** WGS84 decimal degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SiteLocation {
  point: GeoPoint;
  precision: GeocodePrecision;
  /** The address string actually sent to the geocoder, verbatim. */
  queried: string;
  /** The provider's own formatted address for what it matched. */
  resolvedAddress: string;
  /** Provider id, e.g. "google". */
  provider: string;
  resolvedAt: string;
  /**
   * The caveat to render wherever this pin appears, in plain language.
   *
   * Written by the provider that produced the location rather than by the
   * component that draws it, so a pin can never be shown without the sentence
   * that qualifies it — the two travel together or not at all.
   */
  caveat: string;
}

export type AmenityKind = 'transit' | 'school' | 'hospital' | 'market' | 'employment' | 'airport';

/**
 * One nearby place, with the distance to it and an honest account of how that
 * distance was arrived at.
 *
 * `straightLineMetres` is computed here from the two coordinates and is
 * always present. `drivingMetres`/`drivingSeconds` are present only when a
 * routing call was actually made and returned — never estimated from the
 * straight line, because a 900 m crow-flight in Bengaluru is routinely a
 * 3.4 km drive and presenting one as the other is the kind of small lie that
 * makes a whole report untrustworthy.
 */
export interface NearbyAmenity {
  id: string;
  kind: AmenityKind;
  name: string;
  point: GeoPoint;
  /** Great-circle metres from the site pin. Always present. */
  straightLineMetres: number;
  /** Road-network metres. Present only when a routing call returned one. */
  drivingMetres?: number;
  /** Road-network seconds in typical traffic. Present only with `drivingMetres`. */
  drivingSeconds?: number;
  /**
   * True when the pin these distances were measured from was not resolved to
   * the property itself (see `GeocodePrecision`). The distance is then a
   * locality distance wearing a property's clothes, and is labelled that way.
   */
  fromApproximatePin: boolean;
}

/**
 * A street-level photograph of the site's surroundings.
 *
 * `capturedAt` is not decoration. Google's Bengaluru coverage on the
 * peripheries — Sarjapur, Hennur, Devanahalli, exactly the corridors where a
 * buyer most wants to see the road — is routinely years stale, and a
 * three-year-old image of an empty site next to a property being sold as
 * "adjacent to the new tech park" actively misleads. If the metadata endpoint
 * does not return a date, the image is not shown at all rather than shown
 * undated: see `PlaceProviderGap`.
 */
export interface StreetViewImage {
  /**
   * A URL on this API, not on the provider — the provider key is a server
   * secret and never reaches the browser. See the street-view proxy route.
   */
  url: string;
  /** Panorama capture date as the provider reports it, usually "YYYY-MM". */
  capturedAt: string;
  panoramaId: string;
  /** Where the camera stood, which is not where the property is. */
  point: GeoPoint;
  /** Camera bearing, degrees clockwise from north, pointed at the site pin. */
  headingDegrees: number;
  /** Metres between the camera and the site pin. */
  offsetMetres: number;
}

/**
 * Something the site-context build could not obtain, and what that leaves
 * unknown.
 *
 * Same discipline as `CapabilityGap` on the agent side: a missing key, a
 * quota error or a place with no coverage produces a named gap with a
 * consequence a user can read, not an empty array that looks like "nothing
 * nearby".
 */
export interface SiteContextGap {
  /** Stable identifier, e.g. "no_provider_key", "geocode_no_match". */
  code: string;
  /** What was attempted, in plain language. */
  attempted: string;
  /** What is not known as a result — never "unavailable". */
  consequence: string;
}

/**
 * Everything known about where this property sits and what surrounds it.
 *
 * --- What is deliberately absent -----------------------------------------
 *
 * There is no parcel polygon, no drawn boundary and no map-derived area, and
 * that is a design decision rather than an unbuilt feature.
 *
 * The title graph carries an `asserts_area` edge whose entire purpose is to
 * make the disagreement between the extent a sale deed conveys and the extent
 * a khata assesses findable and quotable, with each figure attributed to the
 * document that states it. Every number in that reconciliation traces to a
 * source a lawyer can demand a certified copy of. An area computed from a
 * polygon a user dragged over a satellite tile has no such source — it would
 * enter the same reconciliation as a third figure with the same visual weight
 * and no provenance at all, which is precisely the failure the feature was
 * built to catch. Extents are settled by a licensed surveyor's sketch, not by
 * a mouse.
 *
 * For the same reason there is no distance-to-rajakaluve or
 * distance-to-lake-boundary measurement. The Karnataka pack states plainly
 * that which buffer binds depends on how a specific drain is classified in
 * the current BBMP/BDA drain map, and that those distances have been revised
 * repeatedly by NGT orders, court directions and master-plan revisions. No
 * consumer map carries a rajakaluve layer; measuring to a blue line on a
 * satellite tile measures something that is not the legal feature, and
 * printing the result to a metre would assert a precision the legal position
 * does not have.
 */
export interface SiteContext {
  caseId: string;
  /** Null when the address could not be resolved at all. */
  location: SiteLocation | null;
  amenities: NearbyAmenity[];
  /** Null when there is no coverage, or coverage with no capture date. */
  streetView: StreetViewImage | null;
  gaps: SiteContextGap[];
  /** Provider id that produced this, e.g. "google" or "unconfigured". */
  provider: string;
  builtAt: string;
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
  /**
   * @deprecated Superseded by `lens`. Written for a demand-side buyer — an
   * investor, an adviser, a valuation firm — when the product's audience is
   * the supply side. Kept only so cases stored before lenses existed still
   * parse and still open somewhere sensible; see `lensFromPersona`.
   */
  persona: PersonaKey;
  /**
   * Who this case is being read by, which decides what leads and what folds
   * away. Absent means nobody has chosen — `resolveLens` then takes the
   * assessment profile's default, which is chosen from the project kind.
   */
  lens?: LensKey;
  /**
   * How much about this property may be said to something outside Realytica.
   * Absent means nobody has chosen, which resolves to the safe default — see
   * `resolveDisclosure`. A permissive setting must never be reachable by
   * omission.
   */
  disclosure?: DisclosureLevel;
  /**
   * The last sweep of outside records for this property. Stored on the case
   * rather than the screen result: it is not derived from the engine, it has
   * its own cost and its own consent, and re-running the screen must not
   * silently re-run a set of external searches.
   */
  discovery?: DiscoverySweep;
  /**
   * What is being done with the site, and how that was decided. Absent on
   * cases created before the project model existed — the engine infers a
   * brief for those on every run rather than treating the gap as a blocker.
   */
  project?: ProjectBrief;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  documents: CaseDocument[];
  result?: ScreenResult;
  notes: string;
  /** Agent output. Absent until an agent has run against this case. */
  intelligence?: CaseIntelligence;
  /**
   * Where the property is and what surrounds it. Absent until a place
   * provider has been configured and a build has run — and absent is the
   * correct state, not a degraded one: the whole engine screens a case
   * without it.
   */
  siteContext?: SiteContext;
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
  /**
   * Flood and lake-network exposure for this locality. Present only where a
   * classification has actually been carried — absent means not assessed,
   * which is not the same as low, and the engine says so rather than
   * defaulting.
   */
  waterExposure?: WaterExposureReference;
  /**
   * An aerodrome close enough to this locality that its obstacle-limitation
   * surfaces may reach it. Present only where one does.
   */
  aerodrome?: AerodromeReference;
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
  /**
   * How the three areas a development scheme deals in relate to each other.
   *
   * A residual values a scheme by selling what it builds, and there are three
   * different areas involved that a single number silently conflates:
   *
   *  - **FAR area** — what the zoning permits, which is what
   *    `PlanningPosition.buildablePotentialSqm` holds.
   *  - **Constructed area** — what actually gets built, which is larger:
   *    basement parking, service floors, and other FAR-exempt space still
   *    costs money to build.
   *  - **Saleable area** — what the buyer is invoiced for, which in India is
   *    super built-up: carpet plus walls plus a proportionate share of common
   *    areas, loaded on top.
   *
   * The residual was multiplying FAR area by a per-sqm sale rate for the GDV
   * and by a per-sqm construction rate for the cost, so both sides were
   * measured against the wrong quantity. These ratios convert once, in the
   * open, with a note saying they are market conventions rather than
   * measurements of a specific scheme.
   *
   * Country-level rather than per-locality: the loading a developer charges
   * and the parking a code requires are city-and-country conventions, and
   * eighteen copies of the same two numbers would drift apart.
   */
  areaRatios: AreaRatios;
  notes: string;
}

/**
 * FAR area → constructed area → saleable area, as ratios.
 *
 * Both are stated as `StatutoryRule`-style conventions rather than bare
 * numbers, because a reader has to be able to see they are assumptions: a
 * sanctioned plan and a price list replace both, and until one exists the
 * residual is quoting a market norm back at you.
 */
export interface AreaRatios {
  /**
   * Saleable (super built-up) area achieved per sqm of FAR area. Above 1 in
   * India, because loading is added on top of what the FAR counts.
   */
  saleableToFar: number;
  /**
   * Actual constructed area per sqm of FAR area. Above 1 because basement
   * parking, service floors and other FAR-exempt space is still built.
   */
  constructedToFar: number;
  /** Where these conventions come from, shown wherever they move a number. */
  source: string;
  /** What would replace them with a fact. */
  verifyNote: string;
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
  /**
   * Restrictions that are not about title and not about water. Optional so a
   * pack written before they existed still satisfies the type.
   */
  siteConstraints?: StatutoryRule<SiteConstraintRule[]>;
  /**
   * The development-control norms a schematic yield is computed against.
   * Optional so a pack written before they existed still satisfies the type —
   * and where a pack has none, the yield step reports that it could not be
   * run rather than falling back to numbers from somewhere else.
   */
  developmentControl?: StatutoryRule<DevelopmentControl>;
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
  /**
   * What is being done with the property, when the creator knows. Omitted,
   * the engine infers it on the first screen — so this is how a stated
   * intention survives into the case, not a required field.
   */
  project?: ProjectBrief;
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
  | 'title_graph'
  /**
   * Conducts the intake conversation that produces a case.
   *
   * Unlike every other agent it runs *before* a case exists, and it is the
   * only one whose output is a proposal for the user to accept rather than an
   * addition to a ledger. It decides nothing: which particular to ask for
   * next, which documents bear on the property and whether the draft is ready
   * are all settled deterministically (see `intake/readout.ts`). Its job is
   * language — reading what a person said into typed particulars, and asking
   * the next question like a person would.
   */
  | 'intake_concierge'
  /**
   * Sweeps public records for one specific property, under a disclosure level
   * a person chose. The only agent whose search targets are fixed by the
   * deterministic layer rather than decided by the model — see
   * `discovery.ts` — because which records matter is a domain question, not a
   * language one.
   */
  | 'property_discovery';

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
  /** Which provider served this run. Absent on runs predating the provider port. */
  provider?: ProviderId;
  /** Capabilities this run asked for and did not get. */
  capabilityGaps?: CapabilityGap[];
  /**
   * Prompt versions this run used.
   *
   * Recorded so a change in output can be attributed to a change in text. A
   * run that used an edited prompt which dropped a guardrail carries that here
   * too, because the finding it produced should not look the same as one
   * produced under the shipped rules.
   */
  prompts?: PromptUsage[];
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

/* --- Property discovery ---------------------------------------------- */

/**
 * The kinds of outside record a property can leave behind.
 *
 * Closed on purpose, like every other ontology here. A model that could
 * invent a record kind could report "zoning irregularity" as a category and
 * make it look like a finding of the same standing as a RERA registration.
 */
export type DiscoveryRecordKind =
  /** The project's registration with the state RERA authority, and its status. */
  | 'rera_registration'
  /** A development-authority notification or de-notification naming the parcel. */
  | 'planning_notification'
  /** A court or tribunal matter naming the parcel, the project or the owner's title. */
  | 'litigation'
  /** A municipal notice, demolition order or civic complaint against the property. */
  | 'municipal_notice'
  /** What the developer has completed, delayed or abandoned elsewhere. */
  | 'developer_track_record'
  /** A sale or rental listing, which prices the property but proves nothing about it. */
  | 'listing'
  /** Press or filings about the project, the layout or the corridor. */
  | 'news'
  | 'other';

/**
 * One thing found outside Realytica.
 *
 * `identityConfidence` is the field this type exists for. A search for
 * "Survey No. 42, Sarjapur" returns records about every other Survey No. 42
 * in Karnataka, and presenting one of those as a finding about this property
 * would be worse than finding nothing — it would be a fabricated encumbrance.
 * So every finding states how sure it is that the record is about *this*
 * parcel, and what it matched on to believe that.
 */
export interface DiscoveryFinding {
  id: string;
  kind: DiscoveryRecordKind;
  /** What was found, in one sentence. */
  claim: string;
  /** Why it bears on this case. */
  bearing: string;
  sourceUrl?: string;
  sourceTitle?: string;
  /** When the source was published, where the source says. */
  publishedAt?: string;
  retrievedAt: string;
  /**
   * 0..1 — confidence that this record is about this property, as distinct
   * from confidence that the record says what it says. A perfectly reliable
   * court listing about a different parcel is a 1.0 record at 0.1 identity.
   */
  identityConfidence: number;
  /** Which identifier matched, in plain words. */
  matchedOn: string;
  /** The disclosure level that made this findable. */
  foundAtDisclosure: DisclosureLevel;
  /** How much it would matter if it is both true and about this property. */
  materiality: RiskSeverity;
  corroboration: 'multiple_sources' | 'single_source' | 'uncorroborated';
}

/** A record kind that was not searched for, and what would unlock it. */
export interface DiscoveryGate {
  kind: DiscoveryRecordKind;
  /** The disclosure level this kind needs before it can be looked for. */
  needs: DisclosureLevel;
  /** What is going unchecked as a result. */
  consequence: string;
}

/**
 * One sweep of the outside world for a property.
 *
 * The three list fields are the point, and they are three different
 * statements that an ordinary "results" list collapses into one:
 * `findings` is what was found, `lookedForNotFound` is what was searched for
 * and genuinely was not there, and `notLookedFor` is what was never searched
 * because the disclosure level forbids it. Only the second is evidence of
 * absence.
 */
export interface DiscoverySweep {
  ranAt: string;
  /** The level in force when it ran. Findings are stamped with it individually too. */
  disclosure: DisclosureLevel;
  /** Every query actually issued — the audit trail of what left the system. */
  queriesRun: string[];
  findings: DiscoveryFinding[];
  lookedForNotFound: DiscoveryRecordKind[];
  notLookedFor: DiscoveryGate[];
  /** Sources declared unreachable, carried through so silence is explained. */
  unreachable: { label: string; whatItWouldHaveAnswered: string }[];
  /** Present when no model was available and only the deterministic plan ran. */
  planOnlyReason?: string;
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
  /** Fully resolved routing: provider, model and where the decision came from. */
  routes?: AgentRoute[];
  /** Providers this deployment knows about, and what each can do. */
  providers?: ProviderDescriptor[];
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
  /**
   * Any node -> parcel. One side of a schedule of property: "bounded on the
   * East by Sy. No. 118/3". Modelled as an edge rather than an attribute for
   * the same reason `asserts_area` is — several documents legitimately
   * describe the same side of the same parcel, and the whole point is to keep
   * their claims distinct so a disagreement survives to be found.
   */
  | 'describes_boundary'
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
  | 'status_conflict'
  /**
   * Two instruments describing the same parcel name different abutters on the
   * same side of it. In Karnataka conveyancing the schedule of property — the
   * four boundaries — is how a parcel is identified when survey numbers have
   * been subdivided and renumbered, so a north boundary that reads "Sy. No.
   * 118/3" in the mother deed and "road" in the sale deed is either a
   * subdivision nobody documented or the wrong parcel entirely.
   */
  | 'boundary_mismatch';

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
  /** Absent on runs recorded before the provider port existed. */
  provider?: ProviderId;
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
  /**
   * How many facts memory holds in total, for any case.
   *
   * Present so that "we looked and this property has no history" can be told
   * apart from "nothing has ever been taught to memory". Those two read
   * identically without it — both are an empty `facts` array — and they mean
   * completely different things: the first is a finding about the property,
   * the second is a fact about the deployment. Reporting the second as the
   * first is the same error as pricing an unknown route at zero.
   *
   * Optional so a recall recorded before this existed still loads.
   */
  storedFactCount?: number;
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

/* ==================================================================== */
/* Provider abstraction                                                 */
/* ==================================================================== */

/**
 * Which LLM provider a call goes to.
 *
 * The point of this abstraction is NOT to reduce every provider to what they
 * all share. A lowest-common-denominator port would cost this product the
 * features its guarantees rest on — document citations with verified page
 * locations are what separate "the khata number is on page 3" from a model
 * asserting a page number it may have invented.
 *
 * So the port declares capabilities instead of assuming them. A provider
 * says what it can do; a call that wanted something unavailable degrades
 * explicitly and records the gap (`CapabilityGap`), which then travels into
 * the evidence and the telemetry rather than disappearing. Losing a feature
 * is allowed. Losing it silently is not.
 */
export type ProviderId =
  | 'anthropic'
  /**
   * Any endpoint speaking the OpenAI Chat Completions shape: OpenRouter,
   * LiteLLM, Together, Groq, vLLM, Ollama. One implementation covers them
   * because the wire format is the same; they differ only in base URL,
   * credentials and which models they expose.
   */
  | 'openai_compatible';

/**
 * What a provider can actually do.
 *
 * Every flag here is something at least one agent asks for. A `false` is not
 * a defect — it is a fact the caller has to handle, and the reason each
 * degradation is named in `CapabilityGap` rather than inferred.
 */
export interface ProviderCapabilities {
  /**
   * Server-verified quotations from a supplied document, carrying the page
   * they came from. The extraction pipeline's grounding depends on this: a
   * self-reported page number is a claim, a citation is a location.
   */
  documentCitations: boolean;
  /** Explicit prompt-cache breakpoints. Absence costs money, not correctness. */
  promptCaching: boolean;
  /** Adaptive thinking / reasoning effort control. */
  adaptiveThinking: boolean;
  /** Search run by the provider, with results returned inline. */
  serverWebSearch: boolean;
  /** Server-side re-run on a safety decline, so one refusal cannot end a run. */
  refusalFallback: boolean;
  /** PDFs accepted as input without client-side rasterisation or text extraction. */
  pdfInput: boolean;
  /** A provider-run tool loop, as opposed to one this app drives itself. */
  toolLoop: boolean;
  /** Tool arguments guaranteed to validate against the declared schema. */
  strictTools: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** Recorded so a surprising response can be traced back to an endpoint. */
  baseUrl?: string;
  /** False when the provider has no credentials configured. */
  configured: boolean;
  capabilities: ProviderCapabilities;
  /** Models this deployment has declared for the provider, where it enumerates them. */
  models?: string[];
}

/** Where a routing decision came from. A surprising route must be explicable. */
export type RouteSource =
  | 'default'
  | 'tier_env'
  | 'agent_env'
  | 'global_env'
  | 'request';

/** One resolved decision: which provider and model this agent runs on. */
export interface AgentRoute {
  agent: AgentKind;
  tier: ModelTier;
  provider: ProviderId;
  model: string;
  source: RouteSource;
  /** Capabilities the provider lacks that this agent would otherwise use. */
  expectedGaps: CapabilityGap[];
}

/* ==================================================================== */
/* Telemetry: cost, performance, observability                          */
/* ==================================================================== */

/**
 * A feature a call wanted and did not get.
 *
 * Recorded per call rather than per provider, because the same provider can
 * supply a feature on one model and not another, and because the question a
 * user actually asks is "was THIS finding fully grounded", not "does this
 * vendor support citations in general".
 */
export type CapabilityGap =
  | 'citations_unavailable'
  | 'prompt_caching_unavailable'
  | 'adaptive_thinking_unavailable'
  | 'server_web_search_unavailable'
  | 'refusal_fallback_unavailable'
  | 'pdf_input_unavailable'
  | 'strict_tools_unavailable';

export type LlmCallOutcome = 'succeeded' | 'refused' | 'failed';

/**
 * One model call, as it actually happened.
 *
 * This is the unit every other view is built from: cost per case, provider
 * comparison, the latency profile, and the evaluation harness all aggregate
 * these. Kept flat and provider-neutral so records from different vendors sit
 * in one table and can be compared without a translation step.
 */
export interface LlmCallRecord {
  id: string;
  /** Absent for calls not made on behalf of a case, e.g. an evaluation run. */
  caseId?: string;
  agent: AgentKind;
  tier: ModelTier;
  provider: ProviderId;
  model: string;
  startedAt: string;
  /** Wall clock, including retries. What a user waited. */
  durationMs: number;
  /** Time to first streamed token. Absent when the call did not stream. */
  timeToFirstTokenMs?: number;
  usage: AgentUsage;
  outcome: LlmCallOutcome;
  error?: string;
  capabilityGaps: CapabilityGap[];
  /** Transport-level retries. A high count is a provider health signal. */
  retries: number;
}

export interface ProviderPerformance {
  provider: ProviderId;
  model: string;
  calls: number;
  failures: number;
  refusals: number;
  totalUsage: AgentUsage;
  /** Median rather than mean: one 90-second outlier should not define the profile. */
  medianDurationMs: number;
  p95DurationMs: number;
  /** Input tokens served from cache, as a fraction of all input tokens. */
  cacheHitRate: number;
  /** Fraction of calls that hit at least one capability gap. */
  degradedCallRate: number;
}

export interface TelemetrySummary {
  windowStartedAt: string;
  windowEndedAt: string;
  callCount: number;
  totalCostUsd: number;
  byProvider: ProviderPerformance[];
  /** Most recent calls, newest first. Bounded — this is a view, not the log. */
  recentCalls: LlmCallRecord[];
}

/* ==================================================================== */
/* Evaluation across providers and models                               */
/* ==================================================================== */

/**
 * What is being measured.
 *
 * Deliberately task-shaped rather than benchmark-shaped. "Which model is
 * better" is not answerable; "which model reads a Karnataka khata extract
 * without inventing a survey number" is, and it is the question that decides
 * whether a cheaper tier assignment is safe.
 */
export type EvalTaskKind =
  /** Fields pulled from a document, against known-correct values. */
  | 'document_extraction'
  /** Whether claims made are supported by the evidence supplied. */
  | 'grounding'
  /** Whether a proof route names a real authority, form and procedure. */
  | 'proof_routing'
  /** Whether title-chain reasoning reaches the right finding. */
  | 'title_reasoning';

export interface EvalExpectation {
  key: string;
  /** The correct value, or a regular expression source when a family is acceptable. */
  expected: string;
  match: 'exact' | 'numeric' | 'regex' | 'contains';
  /** Numeric matches only: fractional tolerance, e.g. 0.02 for 2%. */
  tolerance?: number;
  /**
   * A field whose absence is correct — the document does not contain it.
   * Scoring counts a confident wrong answer here as worse than no answer,
   * because inventing a survey number is the failure this product cannot
   * afford.
   */
  mustBeAbsent?: boolean;
}

export interface EvalCase {
  id: string;
  kind: EvalTaskKind;
  label: string;
  /** What the model is given. Interpretation depends on `kind`. */
  input: Record<string, unknown>;
  expectations: EvalExpectation[];
}

export interface EvalFieldResult {
  key: string;
  expected: string;
  actual: string;
  correct: boolean;
  /** Set when the model asserted a value for something that should be absent. */
  fabricated?: boolean;
}

export interface EvalScore {
  /** 0..1 across expectations. */
  score: number;
  /** Fabrications, counted separately: they are not just a lower score. */
  fabrications: number;
  fields: EvalFieldResult[];
}

export interface EvalRunResult {
  evalCaseId: string;
  provider: ProviderId;
  model: string;
  tier: ModelTier;
  score?: EvalScore;
  usage: AgentUsage;
  durationMs: number;
  capabilityGaps: CapabilityGap[];
  /** Set when the call failed outright; `score` is then absent. */
  error?: string;
}

export interface EvalRanking {
  provider: ProviderId;
  model: string;
  meanScore: number;
  fabrications: number;
  totalCostUsd: number;
  meanDurationMs: number;
  /**
   * Mean score per dollar spent.
   *
   * The number that actually settles a tier assignment: a model scoring 0.94
   * at a fifth of the cost of one scoring 0.97 is the right choice for
   * mechanical work and the wrong one where a mistake is expensive. Ranking
   * on score alone hides that trade; this surfaces it.
   */
  scorePerUsd: number;
}

export interface EvalComparison {
  id: string;
  taskKind: EvalTaskKind;
  startedAt: string;
  finishedAt?: string;
  /** Routes compared, in the order they were run. */
  routes: { provider: ProviderId; model: string }[];
  results: EvalRunResult[];
  ranking: EvalRanking[];
  /** Cases that could not be run at all, and why — never silently dropped. */
  skipped: { evalCaseId: string; reason: string }[];
}

/* ==================================================================== */
/* Prompt management                                                    */
/* ==================================================================== */

export type PromptRole =
  /** The shared preamble every agent inherits — where the anti-fabrication rules live. */
  | 'grounding'
  /** An agent's own role definition. */
  | 'system'
  /** A per-call instruction assembled from case data. */
  | 'instruction';

/**
 * A guardrail a prompt version is checked against.
 *
 * Editable prompts and a diligence product are an uncomfortable pair. The
 * shared preamble is not stylistic — it is the text that says never invent a
 * document, a statute, a case number or a figure, and an invented survey
 * number is the one failure this product cannot ship. A prompt UI that lets
 * someone delete that line while the app keeps reporting business as usual
 * would quietly remove the guarantee the whole evidence ledger rests on.
 *
 * So versions are not validated into acceptance or rejection — an operator may
 * genuinely need to rewrite a preamble — but every guardrail is checked, the
 * result travels with the version, and any run using a version that dropped
 * one is marked. Editing is allowed; editing invisibly is not.
 */
export interface PromptInvariantCheck {
  id: string;
  label: string;
  /** Why it matters, in product terms rather than prompt-engineering terms. */
  rationale: string;
  satisfied: boolean;
}

export interface PromptVersion {
  id: string;
  promptKey: string;
  /** Monotonic within a key. Version 1 is always the built-in. */
  version: number;
  label: string;
  content: string;
  createdAt: string;
  /** Shipped with the build. Never editable or deletable, so there is always a way back. */
  builtIn: boolean;
  /**
   * Digest of `content`.
   *
   * Recorded on every run that used it, so a result can be tied to the exact
   * text that produced it. Without this, "the extraction got worse last
   * Tuesday" is unanswerable the moment anyone edits a prompt.
   */
  contentHash: string;
  notes?: string;
  invariants: PromptInvariantCheck[];
}

export interface PromptDescriptor {
  /** Stable identity, e.g. `document_intelligence.system`. */
  key: string;
  agent: AgentKind;
  role: PromptRole;
  label: string;
  description: string;
  /**
   * Placeholders the template expects.
   *
   * A version that drops one renders a blank where a case fact should be, and
   * a prompt with a hole in it fails in a way that looks like a model problem.
   * Checked as an invariant rather than trusted.
   */
  variables: string[];
  activeVersionId: string;
  versions: PromptVersion[];
}

/** What a run actually used. Without it, comparing two versions is guesswork. */
export interface PromptUsage {
  promptKey: string;
  versionId: string;
  version: number;
  contentHash: string;
  /** Ids of guardrails the version in force did not satisfy. Empty is the normal case. */
  invariantsBroken: string[];
}

/* ==================================================================== */
/* Run graph — the visual view of an orchestration                      */
/* ==================================================================== */

export type RunGraphNodeKind =
  | 'plan'
  /** One agent run. */
  | 'agent'
  /** A deterministic step: the screening engine, the title graph, a re-screen. */
  | 'engine'
  /** Something produced and carried forward — a valuation, a pathway set. */
  | 'output';

export type RunGraphEdgeKind =
  /** B ran after A. */
  | 'sequence'
  /** A's output was an input to B. */
  | 'data'
  /** B re-ran something upstream because A changed a fact. */
  | 'feedback';

export interface RunGraphOutput {
  key: string;
  label: string;
  /** How many things: fields extracted, pathways produced, findings raised. */
  count?: number;
  /** One line a user reads without opening the node. */
  summary?: string;
}

export interface RunGraphNode {
  id: string;
  kind: RunGraphNodeKind;
  label: string;
  agent?: AgentKind;
  status: AgentRunStatus | 'ok';
  /**
   * Execution layer. Nodes sharing a lane ran concurrently — the orchestrator
   * groups planned tasks by `order`, and the canvas draws that grouping rather
   * than inventing a layout, so the picture is the schedule.
   */
  lane: number;
  provider?: ProviderId;
  model?: string;
  tier?: ModelTier;
  durationMs?: number;
  /** Absent rather than zero when the route's rates are unknown. */
  costUsd?: number;
  capabilityGaps?: CapabilityGap[];
  prompts?: PromptUsage[];
  outputs: RunGraphOutput[];
  /** Links the node back to the run it came from, for the detail panel. */
  runId?: string;
  detail?: string;
}

export interface RunGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: RunGraphEdgeKind;
  label?: string;
}

export interface RunGraphLane {
  index: number;
  label: string;
}

export interface RunGraph {
  caseId: string;
  builtAt: string;
  lanes: RunGraphLane[];
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  totals: {
    durationMs: number;
    /** Absent when any node on the graph could not be priced. */
    costUsd?: number;
    degradedNodes: number;
    failedNodes: number;
  };
}

/* ==================================================================== */
/* Conversational intake                                                */
/* ==================================================================== */

/**
 * Where a captured particular came from.
 *
 * The same distinction the evidence ledger already draws between a documented
 * fact and a `model_inference`, applied one stage earlier. An intake that
 * quietly fills in a khata type because the project name sounded like an
 * apartment complex has invented a particular, and every number downstream
 * inherits that invention while looking exactly like a number the user gave.
 * So nothing enters a draft without saying where it came from.
 */
export type IntakeProvenance =
  /** The user said it, in so many words. */
  | 'stated'
  /** Derived from something the user said. Always carries a `basis`. */
  | 'inferred'
  /** Read off a document they uploaded. */
  | 'document'
  /** A state-pack default that holds until contradicted. Always carries a `basis`. */
  | 'default';

/**
 * One particular, and its provenance.
 *
 * Addressed by a dotted `path` into `PropertyIdentity` rather than held in a
 * nested partial, because a flat list is what both the confirmation UI and the
 * "what changed this turn" receipt need, and assembling the nested object is a
 * single function at the end (`draftToCreateRequest`) rather than a merge on
 * every turn.
 */
export interface IntakeField {
  /** e.g. `locality`, `builtUpAreaSqm`, `karnataka.khataType`. */
  path: string;
  /** How this particular is named to a person. */
  label: string;
  value: string | number | boolean | null;
  /**
   * The value as a person reads it, where that differs from the stored form.
   *
   * Set for enums, whose stored values are identifiers — a panel rendering
   * `residential_apartment` or `a_khata` back at the user is showing them the
   * database, not their property. Decided here rather than in the UI because
   * the option labels live with the field table; numbers are deliberately not
   * given one, since their formatting depends on the reader's unit preference.
   */
  display?: string;
  /** What the user actually typed, when that differs from the parsed value. */
  saidAs?: string;
  provenance: IntakeProvenance;
  /** Why, for anything not `stated`. Shown, not merely logged. */
  basis?: string;
  /**
   * Whether the user has explicitly accepted this value.
   *
   * Only meaningful for `inferred` and `default`: a `stated` field is
   * confirmed by having been said. An unconfirmed inference may sit in the
   * draft and drive the preview, but it is marked wherever it appears and it
   * is never presented as something the user told us.
   */
  confirmed: boolean;
  at: string;
}

/** A particular the intake still wants, and what not having it costs. */
export interface IntakeGap {
  path: string;
  label: string;
  /** What the screen cannot do, or does worse, without this. */
  consequence: string;
  /**
   * True when the screen cannot run at all until this is known. Distinguished
   * from a gap that only widens the answer, because telling someone they are
   * blocked when they are merely imprecise is how a tool loses their patience.
   */
  blocking: boolean;
  /** Offered answers, where the field is an enum. Lets the UI show buttons instead of demanding prose. */
  options?: { value: string; label: string }[];
}

/**
 * A document the intake is asking for, and what it settles.
 *
 * Never chosen by a model. The list is derived from the playbook steps that
 * declare the document in their `needs`, plus whatever the engine's
 * completeness summary already calls critical — so the request is the same one
 * the deterministic layer would make, and a model cannot invent a document
 * that does not exist or omit one that does.
 */
export interface IntakeDocumentRequest {
  kind: DocumentKind;
  label: string;
  /** The question this document answers, taken from the step that needs it. */
  settles: string;
  /** Playbook step keys, for tracing the request back to the procedure. */
  neededBy: string[];
  /** Critical to the screen's completeness, as opposed to merely useful. */
  critical: boolean;
  received: boolean;
}

/**
 * How far the conversation has got.
 *
 * `ready` means the deterministic core would accept a case, not that the
 * conversation is finished — there is always more that could be asked, and
 * stopping is the user's call.
 */
export type IntakeStage = 'orienting' | 'particulars' | 'documents' | 'ready' | 'built';

export interface IntakeTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /**
   * Particulars this turn captured.
   *
   * Rendered as a visible receipt under the message. A conversation that
   * silently populates a form is worse than the form: the user cannot see
   * what it decided they said, so they cannot correct it.
   */
  captured?: IntakeField[];
  /** Documents this turn asked for. */
  requested?: DocumentKind[];
  /**
   * Existing cases this turn found.
   *
   * The concierge finds; the person opens. Rendered as cards under the reply
   * rather than navigated to, because opening a case is the user's move and an
   * agent that redirects on its own reading of "show me the Whitefield one"
   * has acted on an interpretation rather than an instruction.
   */
  matchedCaseIds?: string[];
  /**
   * The agent run behind an assistant turn.
   *
   * Absent when the turn came from the deterministic fallback — which is the
   * honest signal that no model was involved, not a missing field.
   */
  runId?: string;
}

/**
 * Everything derived from a draft, recomputed on every read.
 *
 * Not stored, for the same reason the run graph is not: it is a projection of
 * the captured fields plus the reference data, and a stored copy is a copy
 * that can disagree with what it describes.
 */
export interface IntakeReadout {
  stage: IntakeStage;
  gaps: IntakeGap[];
  documents: IntakeDocumentRequest[];
  /** True when the deterministic core would accept this draft as a case. */
  screenable: boolean;
  /**
   * The screen as it stands, run against the draft before any case exists.
   *
   * This is the point of the whole approach: the engine needs locality, type
   * and area to produce an indicative range and name the documents that decide
   * the rest, so a user can see a real answer three questions in rather than
   * after a form. Absent until `screenable`.
   */
  preview?: ScreenResult;
  /** One line on what the intake would ask next, when nothing else is pressing. */
  nextQuestion?: IntakeGap;
  /**
   * What kind of project this reads as, from what has been said so far.
   *
   * Present from the moment a property type is known, because the assessment
   * method is being selected from it whether or not anyone has been asked —
   * so the conversation should say which method it is using rather than
   * apply one silently. When the reading has alternatives, the intake asks;
   * when it does not, it states the conclusion and moves on. That is the
   * difference between an intake that decides and one that interrogates.
   */
  project?: ProjectKindInference;
  /** The profile that reading selects, so the chat can name the method in play. */
  assessment?: AssessmentProfile;
  /** True once the user has stated the kind themselves, rather than it being read off the draft. */
  projectKindStated?: boolean;
}

export interface IntakeSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  turns: IntakeTurn[];
  /** Captured particulars. The only stored half of the draft. */
  fields: IntakeField[];
  /** Documents received during the conversation, before a case exists to hold them. */
  documents: CaseDocument[];
  /** Set once the session has been committed and a case built from it. */
  caseId?: string;
  /** Who the case will belong to, and the lens the screen leads with. */
  ownerName?: string;
  persona?: PersonaKey;
}
