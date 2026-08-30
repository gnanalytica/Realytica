/**
 * Project kinds and their assessment profiles.
 *
 * The premise: a property screen is not one method applied to every subject.
 * A land parcel someone means to flip, the same parcel under a 120-flat
 * scheme, and the same parcel under a JDA are three different assessments —
 * different lead valuation methods, different checks that cannot be skipped,
 * different documents the conclusion depends on. Applying one method to all
 * of them produces a number that is defensible for none of them.
 *
 * So the kind of undertaking is inferred (or stated), a profile is selected,
 * and the profile is *shown* — including, when the evidence does not settle
 * the kind, the fact that it does not and the one question that would.
 *
 * This module is pure data and pure functions over it. It reaches nothing.
 */

import type {
  AssessmentProfile,
  DocumentKind,
  MethodStance,
  ProjectBrief,
  ProjectIntent,
  ProjectKind,
  PropertyIdentity,
  PropertyType,
} from './types';

/* ==================================================================== */
/* Profiles                                                              */
/* ==================================================================== */

/**
 * Every method a profile does not mention is left at the engine's base
 * weight. Only deliberate departures are listed, so a profile reads as a set
 * of decisions rather than a wall of restated defaults.
 */
function stance(method: MethodStance['method'], role: MethodStance['role'], weightFactor: number, why: string): MethodStance {
  return { method, role, weightFactor, why };
}

export const ASSESSMENT_PROFILES: Record<ProjectKind, AssessmentProfile> = {
  land_acquisition: {
    kind: 'land_acquisition',
    label: 'Land acquisition',
    summary: 'Buying land with no scheme fixed yet.',
    headlineQuestion: 'What is this land worth today, and is the title clean enough to pay for it?',
    decisionBasis: [
      'The land rate the locality is actually transacting at, per unit of plot area',
      'Whether the title chain survives scrutiny — this is the point of no return',
      'What the statute permits to be built here, since that sets every downstream option',
    ],
    methodStances: [
      stance('land_rate', 'primary', 1.4, 'Land is priced per unit of area. This is the assessment.'),
      stance('index_trend', 'supporting', 1, 'Sanity-checks the land rate against the locality trend.'),
      stance('residual_development', 'sense_check', 0.6, 'No scheme is fixed, so a residual is one hypothesis among many — a bound on what the land could support, not a valuation.'),
      stance('comparable_sales', 'not_applicable', 0, 'Built-property comparables do not price a bare site.'),
      stance('income_capitalisation', 'not_applicable', 0, 'A bare site earns nothing to capitalise.'),
      stance('depreciated_replacement_cost', 'not_applicable', 0, 'There is no building to depreciate.'),
    ],
    criticalChecks: ['title_chain', 'encumbrance', 'land_conversion', 'khata_classification', 'acquisition_notification'],
    requiredDocuments: ['mother_deed', 'title_deed', 'encumbrance_certificate', 'conversion_certificate', 'khata_extract'],
  },

  plotted_development: {
    kind: 'plotted_development',
    label: 'Plotted development',
    summary: 'Subdividing land into sites and selling them.',
    headlineQuestion: 'How many saleable sites does this yield after statutory surrender, and what do they fetch?',
    decisionBasis: [
      'Net saleable area after roads, parks and civic amenity surrender — typically 40–45% of the gross is lost',
      'The site rate achievable in this layout, which is a different rate from the raw land rate paid',
      'Layout approval, without which the sites are not financeable and trade at a heavy discount',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2, 'Value is the sale proceeds of the sites less development cost and margin. The residual is the assessment, not a sense check.'),
      stance('land_rate', 'supporting', 1, 'Establishes the entry price the residual has to beat.'),
      stance('index_trend', 'supporting', 0.8, 'Trends the underlying land rate.'),
      stance('comparable_sales', 'not_applicable', 0, 'The subject is unsubdivided land, not a built unit.'),
      stance('income_capitalisation', 'not_applicable', 0, 'Sites are sold, not held for rent.'),
      stance('depreciated_replacement_cost', 'not_applicable', 0, 'Nothing is built.'),
    ],
    criticalChecks: ['title_chain', 'land_conversion', 'layout_approval', 'rajakaluve_buffer', 'lake_buffer', 'acquisition_notification'],
    requiredDocuments: ['mother_deed', 'title_deed', 'conversion_certificate', 'encumbrance_certificate', 'khata_extract'],
  },

  villa_project: {
    kind: 'villa_project',
    label: 'Villa / row-house project',
    summary: 'Villas or row houses built for sale on a layout.',
    headlineQuestion: 'What does the built scheme sell for, and does the land price leave a margin?',
    decisionBasis: [
      'Achievable sale rate for built villas in this micro-market, which is set by the layout, not the district',
      'Construction cost at villa specification — materially above apartment cost per sqm',
      'Ground coverage and setback rules, which bind a villa scheme harder than FAR does',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2, 'The scheme is the product. Value is what it sells for, less what it costs to build and a margin.'),
      stance('comparable_sales', 'supporting', 1.1, 'Built villa comparables set the sale rate the residual depends on.'),
      stance('land_rate', 'supporting', 1, 'The entry price the scheme has to carry.'),
      stance('income_capitalisation', 'not_applicable', 0, 'Villas here are built for sale, not for yield.'),
    ],
    criticalChecks: ['title_chain', 'land_conversion', 'layout_approval', 'setback_compliance', 'rera_registration'],
    requiredDocuments: ['title_deed', 'conversion_certificate', 'approved_building_plan', 'commencement_certificate', 'rera_registration'],
  },

  apartment_project: {
    kind: 'apartment_project',
    label: 'Apartment project',
    summary: 'Multi-storey residential built for sale.',
    headlineQuestion: 'Does the permitted envelope, built and sold at this location, carry the land price and a margin?',
    decisionBasis: [
      'FAR actually achievable here — road width, not the zoning table, is usually the binding constraint',
      'Sale rate per sqft of saleable area, and the absorption rate that sale depends on',
      'Construction cost and the build-and-sell period, which together decide whether the margin survives',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2.2, 'The envelope is the product. Land value is what is left after building it, selling it and taking a margin.'),
      stance('comparable_sales', 'supporting', 1.2, 'Sets the sale rate the residual turns on — the single most sensitive input in the model.'),
      stance('land_rate', 'supporting', 1, 'The entry price the scheme has to carry.'),
      stance('income_capitalisation', 'sense_check', 0.4, 'Relevant only if part of the scheme is retained and let.'),
      stance('depreciated_replacement_cost', 'not_applicable', 0, 'Nothing is built yet to depreciate.'),
    ],
    criticalChecks: ['title_chain', 'land_conversion', 'far_headroom', 'road_width', 'rajakaluve_buffer', 'aerodrome_height', 'rera_registration'],
    requiredDocuments: ['title_deed', 'mother_deed', 'conversion_certificate', 'approved_building_plan', 'commencement_certificate', 'rera_registration'],
  },

  mixed_use_project: {
    kind: 'mixed_use_project',
    label: 'Mixed-use project',
    summary: 'Residential and commercial in one scheme.',
    headlineQuestion: 'What is the right split between sale and lease components, and does each stand up on its own?',
    decisionBasis: [
      'Each component valued on its own basis — residential on sale, commercial on income — then summed, never blended',
      'Whether the zoning permits the commercial share at the intended proportion',
      'Parking, which binds a mixed scheme earlier than FAR does',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2, 'The scheme is the product, and it has two products in it.'),
      stance('income_capitalisation', 'supporting', 1.4, 'Prices the retained commercial component, which a sale-only view would misvalue.'),
      stance('comparable_sales', 'supporting', 1.1, 'Sets the residential sale rate.'),
      stance('land_rate', 'supporting', 1, 'The entry price the scheme has to carry.'),
    ],
    criticalChecks: ['title_chain', 'land_conversion', 'zoning_permitted_use', 'far_headroom', 'road_width', 'parking_provision', 'rera_registration'],
    requiredDocuments: ['title_deed', 'conversion_certificate', 'approved_building_plan', 'commencement_certificate', 'rera_registration'],
  },

  commercial_development: {
    kind: 'commercial_development',
    label: 'Commercial development',
    summary: 'Office or retail built to lease or sell.',
    headlineQuestion: 'What rent will this command, and what does that rent capitalise to against the build cost?',
    decisionBasis: [
      'Achievable rent per sqft and the cap rate the market applies to it — value here is income, not area',
      'Vacancy and the time to stabilised occupancy, which decide the actual return rather than the headline yield',
      'Parking provision and permitted use, which gate the tenant set entirely',
    ],
    methodStances: [
      stance('income_capitalisation', 'primary', 2.2, 'Commercial property is bought for its income. Capitalised rent is the assessment.'),
      stance('residual_development', 'supporting', 1.4, 'Tests whether the build cost is recovered by that capitalised value.'),
      stance('comparable_sales', 'supporting', 0.9, 'Useful where strata sale is the exit, weaker where it is a lease play.'),
      stance('land_rate', 'supporting', 0.8, 'The entry price the scheme has to carry.'),
    ],
    criticalChecks: ['title_chain', 'zoning_permitted_use', 'far_headroom', 'road_width', 'parking_provision', 'fire_noc'],
    requiredDocuments: ['title_deed', 'conversion_certificate', 'approved_building_plan', 'commencement_certificate', 'occupancy_certificate'],
  },

  industrial_development: {
    kind: 'industrial_development',
    label: 'Industrial / warehousing',
    summary: 'Warehousing, logistics or manufacturing.',
    headlineQuestion: 'Does the site take the loads, the trucks and the power this use needs, at a rent that pays for it?',
    decisionBasis: [
      'Rent per sqft of covered area on a long lease — the tenant covenant matters more than the location premium',
      'Approach road width and turning radius for container traffic, which disqualifies sites that otherwise price well',
      'Ground conditions, floor loading and power sanction, which are engineering constraints priced as commercial ones',
    ],
    methodStances: [
      stance('income_capitalisation', 'primary', 2, 'Industrial assets are underwritten on lease income and covenant.'),
      stance('land_rate', 'supporting', 1.2, 'Land is a larger share of industrial cost than of any other built use.'),
      stance('depreciated_replacement_cost', 'supporting', 1.3, 'A shed is close to its replacement cost — this is a genuine check here, not the weak sense check it is elsewhere.'),
      stance('comparable_sales', 'sense_check', 0.6, 'Industrial comparables are thin and rarely alike.'),
    ],
    criticalChecks: ['title_chain', 'land_conversion', 'zoning_permitted_use', 'road_width', 'pollution_consent'],
    requiredDocuments: ['title_deed', 'conversion_certificate', 'approved_building_plan', 'occupancy_certificate'],
  },

  redevelopment: {
    kind: 'redevelopment',
    label: 'Redevelopment',
    summary: 'Demolishing an existing building and rebuilding to a higher envelope.',
    headlineQuestion: 'Is the unused envelope worth more than the building standing on it, after what it costs to clear and rehouse?',
    decisionBasis: [
      'FAR headroom — the gap between what is built and what is permitted is the entire proposition',
      'Demolition, rehousing and consent costs, which are real and routinely underestimated',
      'Existing occupants and their rights, which decide the timeline more than any approval does',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2.2, 'The value is in the envelope not yet built. Only a residual reaches it.'),
      stance('depreciated_replacement_cost', 'supporting', 1.4, 'Values what stands today, which is the floor the redevelopment has to beat.'),
      stance('comparable_sales', 'supporting', 1, 'Sets the sale rate for the rebuilt product.'),
      stance('income_capitalisation', 'sense_check', 0.7, 'Values the income being given up during the build.'),
    ],
    criticalChecks: ['title_chain', 'far_headroom', 'occupancy_certificate', 'setback_compliance', 'road_width'],
    requiredDocuments: ['title_deed', 'approved_building_plan', 'occupancy_certificate', 'khata_extract', 'property_tax_receipt'],
  },

  joint_development: {
    kind: 'joint_development',
    label: 'Joint development',
    summary: "Developing someone else's land for a revenue or area share.",
    headlineQuestion: 'Does the share on offer compensate for the capital and the risk being carried?',
    decisionBasis: [
      'The share ratio expressed as a land price — what the developer is effectively paying per unit of area',
      "The landowner's title, since the developer's entire investment rests on it and the developer never owns it",
      'Refundable deposit, timelines and the penalty clauses, which is where JDA disputes actually originate',
    ],
    methodStances: [
      stance('residual_development', 'primary', 2, 'The scheme is valued in full, then split by the share ratio. Nothing else prices a JDA.'),
      stance('land_rate', 'supporting', 1.3, 'Converts the share ratio into an implied land price so the deal can be compared with an outright purchase.'),
      stance('comparable_sales', 'supporting', 1, 'Sets the sale rate the split rests on.'),
      stance('asking_price_adjusted', 'not_applicable', 0, 'There is no asking price in a share deal.'),
    ],
    criticalChecks: ['title_chain', 'encumbrance', 'jda_terms', 'power_of_attorney', 'land_conversion', 'rera_registration'],
    requiredDocuments: ['joint_development_agreement', 'mother_deed', 'title_deed', 'encumbrance_certificate', 'khata_extract'],
  },

  built_asset_purchase: {
    kind: 'built_asset_purchase',
    label: 'Built asset purchase',
    summary: 'Buying something already built — a unit, a floor, a whole building.',
    headlineQuestion: 'Is the asking price supported by what comparable stock actually transacts at, and is the title clean?',
    decisionBasis: [
      'Adjusted comparable transactions, which is the most direct evidence of value that exists',
      'Occupancy certificate and khata, which decide whether this is financeable and resaleable',
      'Age, condition and the sinking fund, which set what the price has to absorb after purchase',
    ],
    methodStances: [
      stance('comparable_sales', 'primary', 1.5, 'Direct evidence of what this stock transacts at. Nothing beats it where it exists.'),
      stance('index_trend', 'supporting', 1, 'Confirms the comparables against the locality trend.'),
      stance('income_capitalisation', 'supporting', 1, 'Prices the asset on yield, which is the alternative reading of the same purchase.'),
      stance('depreciated_replacement_cost', 'sense_check', 0.8, 'A cross-check on older stock, not a market price.'),
      stance('residual_development', 'not_applicable', 0, 'The building already exists; there is no scheme to residualise.'),
    ],
    criticalChecks: ['title_chain', 'encumbrance', 'occupancy_certificate', 'khata_classification', 'property_tax'],
    requiredDocuments: ['title_deed', 'sale_agreement', 'encumbrance_certificate', 'occupancy_certificate', 'khata_extract', 'property_tax_receipt'],
  },
};

export const PROJECT_KINDS: ProjectKind[] = Object.keys(ASSESSMENT_PROFILES) as ProjectKind[];

export function assessmentProfile(kind: ProjectKind): AssessmentProfile {
  return ASSESSMENT_PROFILES[kind];
}

export function projectKindLabel(kind: ProjectKind): string {
  return ASSESSMENT_PROFILES[kind].label;
}

/** The stance a profile takes on one method, or `null` where it takes none (base weight stands). */
export function methodStance(profile: AssessmentProfile, method: MethodStance['method']): MethodStance | null {
  return profile.methodStances.find(s => s.method === method) ?? null;
}

/* ==================================================================== */
/* Inference                                                             */
/* ==================================================================== */

const LAND_TYPES: PropertyType[] = ['residential_plot', 'land_parcel'];

/** Roughly half an acre. Below this, a site is a plot; above it, a scheme is plausible. */
const SCHEME_PLAUSIBLE_SQM = 2000;

/** Intent, where the user stated one, is decisive over every structural signal. */
const INTENT_KIND: Partial<Record<ProjectIntent, ProjectKind>> = {
  subdivide_and_sell: 'plotted_development',
  partner_with_landowner: 'joint_development',
  redevelop_existing: 'redevelopment',
  buy_and_hold: 'built_asset_purchase',
};

export interface ProjectKindSignals {
  /** Document kinds on the case. A JDA on file is decisive on its own. */
  documentKinds?: DocumentKind[];
  /** What the user said they mean to do. */
  intent?: ProjectIntent;
}

/**
 * Conclude what kind of project this is from what is known.
 *
 * The rules are deliberately conservative about the one thing they cannot
 * see: for a bare site with no stated intent, the structure of the case is
 * consistent with buying it, subdividing it or building on it, and those are
 * three different assessments. Rather than pick the most common and present
 * its numbers as findings, the inference returns the safest of the three
 * (land, valued as land) with the other two named as alternatives and the
 * question that would settle it. `confidence` reflects that honestly.
 */
export function inferProjectKind(
  identity: PropertyIdentity,
  signals: ProjectKindSignals = {},
): import('./types').ProjectKindInference {
  const docs = signals.documentKinds ?? [];
  const intent = signals.intent ?? 'unknown';
  const isLand = LAND_TYPES.includes(identity.propertyType);
  const isBuilt = !isLand;
  const hasBuilding = identity.builtUpAreaSqm > 0 && identity.yearBuilt !== undefined;
  const plot = identity.plotAreaSqm;

  // A JDA on file settles it regardless of anything else — the developer does
  // not own this land and never will, which changes every downstream figure.
  if (docs.includes('joint_development_agreement')) {
    return {
      kind: 'joint_development',
      confidence: 0.92,
      basis: ['A joint development agreement is on file, so the land is being developed under a share rather than bought outright.'],
      alternatives: [],
    };
  }

  const stated = INTENT_KIND[intent];
  if (stated) {
    return {
      kind: stated,
      confidence: 0.9,
      basis: [`You said the plan is to ${intentPhrase(intent)}.`],
      alternatives: [],
    };
  }

  if (isLand) {
    if (intent === 'buy_and_build') {
      // Intent narrows it to a scheme but not to which scheme — area is the
      // only structural signal available, and it is weak.
      const kind: ProjectKind = plot >= SCHEME_PLAUSIBLE_SQM ? 'apartment_project' : 'villa_project';
      return {
        kind,
        confidence: 0.55,
        basis: [
          'You said the plan is to build on the land.',
          `The site is ${Math.round(plot).toLocaleString()} sqm, which ${plot >= SCHEME_PLAUSIBLE_SQM ? 'supports a multi-storey scheme' : 'is closer to villa or row-house scale'}.`,
        ],
        alternatives: plot >= SCHEME_PLAUSIBLE_SQM ? ['villa_project', 'mixed_use_project', 'plotted_development'] : ['apartment_project', 'plotted_development'],
        settledBy: 'What are you building here — flats, villas, or sites for sale?',
      };
    }
    const schemePlausible = plot >= SCHEME_PLAUSIBLE_SQM;
    return {
      kind: 'land_acquisition',
      confidence: schemePlausible ? 0.45 : 0.7,
      basis: [
        `The subject is ${identity.propertyType === 'land_parcel' ? 'a land parcel' : 'a residential plot'} with no building on it.`,
        schemePlausible
          ? `At ${Math.round(plot).toLocaleString()} sqm it is large enough for a scheme, so how it is valued depends on what you intend to do with it.`
          : 'At this size it is most likely being bought as a site rather than developed.',
        'Valued as land until you tell us otherwise — that is the assessment that assumes least.',
      ],
      alternatives: schemePlausible ? ['plotted_development', 'apartment_project', 'villa_project'] : ['villa_project'],
      settledBy: 'Are you holding this as land, subdividing it, or building on it?',
    };
  }

  if (identity.propertyType === 'industrial_warehouse') {
    return hasBuilding
      ? {
          kind: 'built_asset_purchase',
          confidence: 0.75,
          basis: [`An industrial building of ${Math.round(identity.builtUpAreaSqm).toLocaleString()} sqm built in ${identity.yearBuilt} already stands here.`],
          alternatives: ['industrial_development'],
          settledBy: 'Are you buying the existing shed, or building a new one?',
        }
      : {
          kind: 'industrial_development',
          confidence: 0.7,
          basis: ['An industrial subject with no completed building recorded.'],
          alternatives: ['built_asset_purchase'],
          settledBy: 'Is there an existing building on this site?',
        };
  }

  const isCommercial = identity.propertyType === 'commercial_office' || identity.propertyType === 'retail_unit';
  if (isCommercial && !hasBuilding) {
    return {
      kind: 'commercial_development',
      confidence: 0.65,
      basis: ['A commercial subject with no completed building recorded, so this reads as a scheme rather than a purchase.'],
      alternatives: ['built_asset_purchase'],
      settledBy: 'Is the building already built, or are you building it?',
    };
  }

  // Everything else built: a unit, floor or building being bought.
  const basis: string[] = [];
  if (hasBuilding) basis.push(`A completed ${propertyTypePhrase(identity.propertyType)} built in ${identity.yearBuilt}.`);
  else basis.push(`A ${propertyTypePhrase(identity.propertyType)} that already exists as built stock.`);
  if (identity.askingPrice !== undefined) basis.push('An asking price is quoted, which is characteristic of a purchase rather than a scheme.');
  return {
    kind: 'built_asset_purchase',
    confidence: identity.askingPrice !== undefined ? 0.85 : 0.75,
    basis,
    alternatives: isBuilt && hasBuilding && plot > SCHEME_PLAUSIBLE_SQM ? ['redevelopment'] : [],
    settledBy: isBuilt && hasBuilding && plot > SCHEME_PLAUSIBLE_SQM ? 'Are you buying this to keep, or to knock down and rebuild?' : undefined,
  };
}

function intentPhrase(intent: ProjectIntent): string {
  switch (intent) {
    case 'buy_and_hold':
      return 'buy and hold what is already built';
    case 'buy_and_build':
      return 'buy the land and build on it';
    case 'subdivide_and_sell':
      return 'subdivide the land and sell sites';
    case 'partner_with_landowner':
      return 'partner with the landowner rather than buy outright';
    case 'redevelop_existing':
      return 'redevelop what is standing';
    default:
      return 'proceed';
  }
}

function propertyTypePhrase(t: PropertyType): string {
  switch (t) {
    case 'residential_apartment':
      return 'apartment';
    case 'residential_villa':
      return 'villa';
    case 'residential_plot':
      return 'residential plot';
    case 'commercial_office':
      return 'office';
    case 'retail_unit':
      return 'retail unit';
    case 'industrial_warehouse':
      return 'industrial building';
    case 'land_parcel':
      return 'land parcel';
  }
}

/**
 * Smallest parcel a layout can plausibly be cut out of. Below roughly a
 * quarter acre there is nothing left after the statutory surrender to roads,
 * parks and civic amenity to sell as sites.
 */
const MIN_SUBDIVIDABLE_SQM = 1000;

/** Below this a multi-storey scheme is not a scheme, it is a house. */
const MIN_APARTMENT_SITE_SQM = 800;

/**
 * Does the kind in force actually fit the subject?
 *
 * Returns the caution to show, or `undefined` when the kind is coherent.
 * Nothing here refuses the combination: a developer assembling adjacent
 * parcels, or screening one site before the neighbour's is agreed, is asking
 * a legitimate hypothetical. What must not happen is the product computing a
 * subdivision residual for a 220 sqm site and presenting it as a finding.
 */
export function assessmentFitCaution(identity: PropertyIdentity, kind: ProjectKind): string | undefined {
  const plot = Math.round(identity.plotAreaSqm);
  const built = identity.builtUpAreaSqm;
  switch (kind) {
    case 'plotted_development':
      if (plot > 0 && plot < MIN_SUBDIVIDABLE_SQM) {
        return `This site is ${plot.toLocaleString()} sqm. After the statutory surrender to roads, parks and civic amenity there is not enough left to cut into saleable sites, so the layout residual below is answering a hypothetical — a larger holding, or this parcel plus adjoining land.`;
      }
      return undefined;
    case 'apartment_project':
    case 'mixed_use_project':
      if (plot > 0 && plot < MIN_APARTMENT_SITE_SQM) {
        return `A ${plot.toLocaleString()} sqm site is small for a multi-storey scheme — setbacks and parking bind well before FAR does, so the buildable envelope used below is likely optimistic.`;
      }
      return undefined;
    case 'redevelopment':
      if (built <= 0) {
        return 'Nothing is recorded as standing on this site, so there is nothing to redevelop. The figures below value building on it from scratch.';
      }
      return undefined;
    case 'built_asset_purchase':
      if (built <= 0) {
        return 'No completed building is recorded on this subject, so there is no built asset to price. The comparables below are the closest built stock, not this property.';
      }
      return undefined;
    case 'land_acquisition':
      if (built > 0) {
        return `There is a ${Math.round(built).toLocaleString()} sqm building on this land. Valued as bare land, its value is being ignored — which is right only if you intend to clear it.`;
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * The brief in force for a case: what the case carries, or one inferred now.
 *
 * The engine calls this on every run so a case created before the project
 * model existed still gets a stated method rather than an unexplained blend.
 * An inferred brief is marked as such and keeps showing its reasoning; a
 * user-set one is taken at its word.
 */
export function resolveProjectBrief(
  identity: PropertyIdentity,
  now: string,
  existing?: ProjectBrief,
  signals: ProjectKindSignals = {},
): ProjectBrief {
  if (existing && existing.source === 'user') {
    // Recomputed rather than trusted from storage: the identity can change
    // after the kind was set (an area corrected, a building recorded), and a
    // caution that no longer applies is as misleading as a missing one.
    return { ...existing, fitCaution: assessmentFitCaution(identity, existing.kind) };
  }
  const inference = inferProjectKind(identity, signals);
  return {
    kind: inference.kind,
    source: 'inferred',
    intent: signals.intent ?? existing?.intent ?? 'unknown',
    inference,
    unitsPlanned: existing?.unitsPlanned,
    fitCaution: assessmentFitCaution(identity, inference.kind),
    decidedAt: now,
  };
}
