/**
 * Playbook: is non-agricultural use of this land lawful?
 *
 * Bengaluru's periphery is agricultural revenue land with houses on it. The
 * question this procedure answers is not "is the paperwork tidy" but "is the
 * use anyone intends to make of this land something the state has permitted",
 * and the two come apart constantly: a site can carry a registered sale deed,
 * a khata and paid tax receipts and still be land on which no one may lawfully
 * build, because the Deputy Commissioner never converted it under s.95 of the
 * Karnataka Land Revenue Act 1964.
 *
 * The sequence matters as much as it does for the title chain. You read the
 * revenue record first, because "is a conversion order needed" is a question
 * the revenue record answers and nothing else does. You look for the
 * conversion order second. You test the order's own conditions third, because
 * an order granted for a purpose, with a period to commence that purpose, can
 * lapse — an expired conversion is not a conversion. Only then does layout
 * sanction, zoning and betterment become answerable, because each of those is
 * an approval granted *on the footing* that the land was lawfully
 * non-agricultural.
 *
 * THE REVENUE LAYOUT. The finding this procedure exists to make loudly is the
 * combination — a layout with no planning sanction, sitting on land the
 * revenue record still calls agricultural. That is not "unapproved layout,
 * minor". Sites in it were carved out by sketch, sold by agreement or GPA, and
 * the buyer's exposure runs to refusal of khata, refusal of plan sanction,
 * refusal of finance, and in the worst case resumption or demolition. This
 * module states the combination explicitly rather than reporting two
 * independent amber findings and leaving the reader to assemble the sentence.
 */

import type { DocumentKind, PropertyType } from '../types';
import { KARNATAKA_PACK } from '../packs/karnataka';
import type { Playbook, PlaybookContext, StepOutcome } from './types';
import { isoYear, normaliseSurveyNumber } from './types';

/**
 * The pack's own catalogue is the single source of truth for a named check's
 * statutory attribution — see the same helper in the title-chain playbook.
 */
function packStatute(key: string, fallback: string): string {
  return KARNATAKA_PACK.titleChecks.find(tc => tc.key === key)?.statute ?? fallback;
}

function isLandType(t: PropertyType): boolean {
  return t === 'residential_plot' || t === 'land_parcel';
}

/**
 * Broad use family, used instead of exact `permittedUses` membership.
 *
 * The locality reference's `permittedUses` is a market dataset listing the
 * property types tracked in that micro-market — it is NOT the Master Plan's
 * land-use schedule for a specific parcel. Testing "is `residential_plot` in
 * the list" against a locality whose list happens to name apartments and
 * villas would report a residential site as an impermissible use in a
 * residential zone, which is a false mismatch of exactly the kind this module
 * is written to avoid. Comparing use families is the honest comparison the
 * data actually supports, and the finding says what the data is.
 */
type UseFamily = 'residential' | 'commercial' | 'industrial' | 'unspecified';

function useFamily(t: PropertyType): UseFamily {
  switch (t) {
    case 'residential_apartment':
    case 'residential_villa':
    case 'residential_plot':
      return 'residential';
    case 'commercial_office':
    case 'retail_unit':
      return 'commercial';
    case 'industrial_warehouse':
      return 'industrial';
    case 'land_parcel':
    default:
      return 'unspecified';
  }
}

/* ==================================================================== */
/* Step 1 — revenue classification                                       */
/* ==================================================================== */

/**
 * Note the deliberate reading of `clear` here: it means "the classification is
 * established", not "the classification is favourable". A step whose question
 * is "what does the revenue record say" is answered when the record has been
 * read, and the finding states which answer it gave. Marking an agricultural
 * classification as `attention` would block the conversion-order step behind
 * it — and the conversion order is precisely what you go and look for once you
 * know the land is agricultural. A gate that fires there would stop the
 * procedure at the exact moment it becomes useful.
 */
function evaluateRevenueClassification(ctx: PlaybookContext): StepOutcome {
  const status = ctx.karnataka?.landConversionStatus;
  const evidenceIds = ctx.evidenceForRef('identity.karnataka.landConversionStatus');

  if (!status || status === 'unknown') {
    return {
      state: 'not_started',
      finding:
        'MISSING: the revenue record for this survey number — the RTC/pahani (record of rights, tenancy and crops) and ' +
        'the mutation extract, obtainable from the Bhoomi record-of-rights system or the village accountant. Nothing on ' +
        'file says whether this land is classified as agricultural. That single fact decides whether a DC conversion ' +
        'order is a precondition to every other approval on this file or an irrelevance, so nothing downstream of it can ' +
        'be evaluated. This schema has no dedicated document type for an RTC, so it files under "other" alongside the ' +
        'layout-approval order.',
      needs: ['other', 'conversion_certificate'],
    };
  }

  if (status === 'agricultural') {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED — and the answer is agricultural: the revenue record classifies this as agricultural land. This step ' +
        'records the classification; whether the use being made of the land is lawful given that classification is the ' +
        'next step\'s question, and on this record it is the question that decides the case. Under s.95 of the Karnataka ' +
        'Land Revenue Act 1964 no non-agricultural use may be made of agricultural land without the Deputy ' +
        "Commissioner's conversion order, and that prohibition is not cured by a registered sale deed, a khata or paid " +
        'tax receipts — none of those bodies decides land use.',
      evidenceIds,
      needs: ['conversion_certificate'],
    };
  }

  if (status === 'converted') {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED: the revenue record classifies this land as converted to non-agricultural use. The conversion order ' +
        'itself, the extent it covers and the conditions attached to it are the next two steps — a conversion recorded ' +
        'in the abstract is not the same as an order on file that matches this survey number and whose conditions have ' +
        'been met.',
      evidenceIds,
      needs: ['conversion_certificate'],
    };
  }

  return {
    state: 'clear',
    finding:
      'ESTABLISHED: the case records this holding as never having been agricultural revenue land, so there is no ' +
      's.95 conversion to look for. Where that rests on an assumption rather than on a read of the revenue record, it is ' +
      'worth confirming: land inside long-settled city limits is usually genuinely non-agricultural, land anywhere near ' +
      'the periphery frequently is not.',
    evidenceIds,
    needs: [],
  };
}

/* ==================================================================== */
/* Step 2 — DC conversion order                                          */
/* ==================================================================== */

function evaluateConversionOrder(ctx: PlaybookContext): StepOutcome {
  const status = ctx.karnataka?.landConversionStatus;
  const convDoc = ctx.doc('conversion_certificate');
  const orderNumber = ctx.fieldValue('conversion_certificate', 'conversionOrderNumber');
  const orderDate = ctx.fieldValue('conversion_certificate', 'conversionOrderDate');
  const surveyOnCase = ctx.identity.parcelId;

  if (status === 'not_applicable') {
    return {
      state: 'not_applicable',
      finding:
        'NOT APPLICABLE: the revenue record does not classify this holding as agricultural land, so there is no ' +
        'agricultural use to convert from and s.95 of the Karnataka Land Revenue Act 1964 is not engaged. The step is ' +
        'reported rather than omitted so it is visible that conversion was considered and dismissed on the record, not ' +
        'overlooked.',
      needs: [],
    };
  }

  if (!convDoc) {
    if (status === 'agricultural') {
      return {
        state: 'attention',
        severity: 'blocker',
        finding:
          'NO CONVERSION ORDER, ON LAND THE REVENUE RECORD STILL CALLS AGRICULTURAL. This is the finding, not a gap in ' +
          'the file. Any non-agricultural use of this land — building on it, and in practice selling it as a residential ' +
          'site — is unauthorised under s.95 of the Karnataka Land Revenue Act 1964 until the Deputy Commissioner ' +
          'converts it. The consequences run together: BBMP or the planning authority can refuse khata and building-plan ' +
          'sanction, mainstream lenders decline to finance unconverted land, the property is exposed to penalty and to ' +
          'resumption proceedings, and none of it is cured by the sale deed having registered without objection. ' +
          'Conversion is applied for by the *landholder*, not the buyer, so this is not a defect a purchaser can fix ' +
          'after completion — it has to be resolved before, or priced as the risk it is.',
        evidenceIds: ctx.evidenceForRef('identity.karnataka.landConversionStatus'),
        needs: ['conversion_certificate'],
      };
    }
    return {
      state: 'attention',
      finding:
        'The revenue record is stated to show this land as converted, but the conversion order itself is not on file, so ' +
        'the conversion cannot be verified — neither the extent it covers, nor the purpose it was granted for, nor the ' +
        'conditions attached. Lenders and the Sub-Registrar ask for the order, not for the assertion. Obtain a copy of ' +
        "the Deputy Commissioner's order from the seller or the DC's office.",
      evidenceIds: ctx.evidenceForRef('identity.karnataka.landConversionStatus'),
      needs: ['conversion_certificate'],
    };
  }

  // An order is on file. What the extraction can and cannot confirm about it
  // has to be stated precisely: the order number and date are readable, the
  // survey number and the extent converted are on the face of the order and
  // are not among the extracted fields.
  const evidenceIds = ctx.evidenceForDoc('conversion_certificate');
  const parcelSentence =
    `The order number and date are readable; the survey number and the extent the order converts are on the face of the ` +
    `order and are not among the fields extracted from it, so the match against this case's parcel ` +
    `(${surveyOnCase || 'not recorded'}) has NOT been made here and must be made by reading the order. A conversion order ` +
    'for a neighbouring survey number, or for a larger extent of which this site is only claimed to be part, is a common ' +
    'and easily missed substitution.';

  // A conversion order dated after the conveyance is a real and serious
  // ordering problem, and it is visible from the two dates on the file.
  const orderYear = isoYear(orderDate);
  const deedDate = ctx.fieldValue('title_deed', 'deedDate');
  const deedYear = isoYear(deedDate);
  const outOfOrder =
    orderDate !== undefined && deedDate !== undefined && orderYear !== undefined && deedYear !== undefined && orderDate > deedDate;

  const contradiction = status === 'agricultural';

  if (contradiction) {
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        `A DC conversion order is on file (${orderNumber ?? 'number not read'}, dated ${orderDate ?? 'date not read'}) but ` +
        'the revenue record on this case still classifies the land as agricultural. Those two statements cannot both be ' +
        'current. Either the order was never given effect in the revenue record — conversion is not complete until the ' +
        'mutation is carried out and the RTC updated — or the order does not cover this parcel. Resolve which before ' +
        `treating the land as non-agricultural. ${parcelSentence}`,
      evidenceIds,
      needs: ['conversion_certificate', 'other'],
    };
  }

  return {
    state: 'clear',
    finding:
      `A DC conversion order is on file: ${orderNumber ?? 'number not read'}, dated ${orderDate ?? 'date not read'} ` +
      `(${convDoc.fileName}), consistent with the revenue record's converted classification. ${parcelSentence}` +
      (outOfOrder
        ? ` One thing on the file needs explaining before it is relied on: the order is dated ${orderDate}, which is AFTER ` +
          `the conveyance on file (${deedDate}). If both dates are right, the land was sold as a site before it was ` +
          'lawfully converted; if one is a transcription error, correct it. Do not read past this.'
        : ''),
    evidenceIds,
    needs: outOfOrder ? ['conversion_certificate', 'title_deed'] : [],
  };
}

/* ==================================================================== */
/* Step 3 — conversion conditions complied with                          */
/* ==================================================================== */

function evaluateConversionConditions(ctx: PlaybookContext): StepOutcome {
  const status = ctx.karnataka?.landConversionStatus;
  if (status === 'not_applicable') {
    return {
      state: 'not_applicable',
      finding:
        'NOT APPLICABLE: no conversion order exists to carry conditions, because the land was never agricultural revenue land.',
      needs: [],
    };
  }

  const orderNumber = ctx.fieldValue('conversion_certificate', 'conversionOrderNumber');
  const orderDate = ctx.fieldValue('conversion_certificate', 'conversionOrderDate');
  const orderYear = isoYear(orderDate);
  const elapsed = orderYear !== undefined ? ctx.nowYear - orderYear : undefined;

  return {
    state: 'attention',
    finding:
      `The conditions attached to conversion order ${orderNumber ?? '(number not read)'}` +
      `${orderDate ? `, dated ${orderDate}` : ''} have NOT been verified, because they are printed on the face of the order ` +
      'and are not among the fields extracted from it. A s.95 order is a permission granted on terms — it names the ' +
      'purpose the land is converted for, it commonly requires the converted use to be commenced within a period stated ' +
      'in the order itself, and it is conditional on the conversion fine and any charges having been paid. This module ' +
      'deliberately does not assert what that period is: it is fixed by the order, not by a figure this playbook could ' +
      'quote, and quoting a wrong number here would be worse than quoting none. ' +
      (elapsed !== undefined
        ? elapsed <= 0
          ? 'The order is dated in the current year, so any commencement period on its face is unlikely to have run.'
          : `Roughly ${elapsed} ${elapsed === 1 ? 'year has' : 'years have'} passed since the order date, which is long ` +
            'enough that a commencement period could have expired — an order allowed to lapse is not a conversion, and ' +
            'revalidation is a fresh application, not a formality.'
        : 'The order date could not be read, so elapsed time against any commencement period cannot be assessed.') +
      ' Read the order and check three things against it: the purpose matches the use intended, the commencement ' +
      'condition has been met or has not yet expired, and the conversion fine receipt exists.',
    evidenceIds: ctx.evidenceForDoc('conversion_certificate'),
    needs: ['conversion_certificate', 'other'],
  };
}

/* ==================================================================== */
/* Step 4 — layout sanction                                              */
/* ==================================================================== */

function evaluateLayoutSanction(ctx: PlaybookContext): StepOutcome {
  const approval = ctx.identity.plot?.layoutApproval;
  const status = ctx.karnataka?.landConversionStatus;
  const evidenceIds = ctx.evidenceForRef('identity.plot.layoutApproval');

  if (!isLandType(ctx.identity.propertyType)) {
    return {
      state: 'not_applicable',
      finding:
        'NOT APPLICABLE: layout sanction is a question about how a parcel of land was subdivided into sites. For a unit ' +
        'in a development the equivalent approvals are the sanctioned building plan, the commencement certificate and the ' +
        'occupancy certificate, which the title-chain and khata procedures cover.',
      needs: [],
    };
  }

  if (!approval || approval === 'unknown') {
    return {
      state: 'not_started',
      finding:
        'MISSING: the layout-approval order for the layout this site sits in — the sanction issued by BDA, BMRDA, the ' +
        'planning authority or the gram panchayat that authorised the subdivision, together with the approved layout plan ' +
        'showing this site number on it. This schema has no dedicated document type for it, so it files under "other". ' +
        'Its absence from the file is not yet a finding, but it is the fact that decides whether this is a sanctioned ' +
        'layout or a revenue layout, and that is the most consequential single fact about a Bengaluru site — a fact a ' +
        'flat purchase never has to establish at all.',
      needs: ['other'],
    };
  }

  if (approval === 'revenue_layout' || approval === 'unapproved') {
    const unconverted = status === 'agricultural';
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        (approval === 'revenue_layout'
          ? 'REVENUE LAYOUT: the site was carved out of revenue land and sold without any sanctioned layout plan behind it. '
          : 'UNAPPROVED LAYOUT: no planning authority sanctioned the subdivision this site was created by. ') +
        (unconverted
          ? 'And the revenue record still classifies the land as agricultural. Take the two together, because that is how ' +
            'they operate: this is agricultural land, subdivided without sanction, being sold as residential sites. There ' +
            'is no approval to regularise against and no conversion to build on. BBMP or the planning authority can ' +
            'refuse khata and plan sanction outright, mainstream lenders will decline it, and the sites are exposed to ' +
            'resumption or demolition action irrespective of the sale deed having registered cleanly. Regularisation, ' +
            'where it is available at all, runs through the landholder and the DC, not through the buyer.'
          : 'The land is not recorded as agricultural, which removes one limb of the problem but not the layout itself: ' +
            'without a sanction order there is no approved layout plan against which a site number, its dimensions or its ' +
            'access road can be verified, khata and plan sanction can be refused, and lenders will typically decline.') +
        ' Do not treat a registered sale deed as evidence of a lawful layout; registration tests the instrument, not the ' +
        'subdivision. Get an independent legal opinion on regularisation prospects before offering.',
      evidenceIds,
      needs: ['other', 'conversion_certificate'],
    };
  }

  if (approval === 'panchayat_approved' || approval === 'private_approved') {
    return {
      state: 'attention',
      finding:
        `The layout is recorded as ${approval === 'panchayat_approved' ? 'gram panchayat-approved' : 'privately approved'}, ` +
        'not sanctioned by BDA or BMRDA. That is a real approval, but it has to be verified on its own merits rather than ' +
        'taken as equivalent: obtain the specific approval order, confirm it was within the approving body\'s competence ' +
        'for a layout of this size, and confirm the underlying land was converted before the layout was approved. ' +
        'Panchayat-approved layouts on unconverted land are a recurring pattern, and a panchayat approval does not ' +
        'substitute for a s.95 order.',
      evidenceIds,
      needs: ['other', 'conversion_certificate'],
    };
  }

  return {
    state: 'clear',
    finding:
      `The site sits in a ${approval === 'bda_approved' ? 'BDA' : 'BMRDA'}-sanctioned layout, which is the strongest layout ` +
      'position available in this market: the subdivision is traceable to an approval order, the approved layout plan ' +
      'fixes this site\'s number and dimensions, and khata, plan sanction and mortgage finance ordinarily follow without ' +
      'argument. Cross-check the approval order number and the site number against the approved layout plan and the ' +
      'title deed — the sanction is for the layout, and a site has to be shown to be part of it.',
    evidenceIds,
    needs: [],
  };
}

/* ==================================================================== */
/* Step 5 — Master Plan zoning consistency                               */
/* ==================================================================== */

function evaluateMasterPlanZoning(ctx: PlaybookContext): StepOutcome {
  const planning = ctx.result?.planning;

  if (!planning) {
    return {
      state: 'not_started',
      finding:
        'MISSING: a planning position for this parcel. No screen has been run against this case, so there is no zoning, ' +
        'permitted-use or FAR position to test the intended use against. The authoritative source is the land-use ' +
        'zoning shown for this survey number on the master plan currently in force, read together with the zonal ' +
        'regulations — a zonal/land-use certificate from the planning authority is what a lender will ask for.',
      needs: ['other'],
    };
  }

  const subjectFamily = useFamily(ctx.identity.propertyType);
  const permittedFamilies = new Set(planning.permittedUses.map(u => useFamily(u as PropertyType)));
  const consistent = subjectFamily === 'unspecified' || permittedFamilies.has(subjectFamily);
  const evidenceIds = planning.evidenceIds.filter(id => (ctx.result?.evidence ?? []).some(e => e.id === id));

  // The comparison this step can honestly make, and the one it cannot, stated
  // rather than glossed: a market dataset's tracked property types are not a
  // statutory permitted-use schedule.
  const basisCaveat =
    'The comparison here is between use families (residential / commercial / industrial), not against a statutory ' +
    'permitted-use schedule: the permitted-use list carried for this locality is a market dataset describing what ' +
    'transacts here, and reading it as the Master Plan\'s land-use schedule for this specific survey number would ' +
    'produce mismatches that are artefacts of the dataset rather than planning findings. The parcel\'s actual land-use ' +
    'zone has to be read off the master plan land-use map or certified by the planning authority.';

  if (!consistent) {
    return {
      state: 'attention',
      finding:
        `The intended use is ${subjectFamily}, and the uses tracked for this locality (${planning.permittedUses.join(', ')}) ` +
        `under zoning "${planning.zoning}" do not include that family. That is a flag to check, not a conclusion. ` +
        `${basisCaveat}`,
      evidenceIds,
      needs: ['other'],
    };
  }

  const conversionCaveat = /agricultur|conversion/i.test(planning.zoning)
    ? ' Note what the zoning string itself says: this is a zone where parcels are commonly still agricultural and the ' +
      'land use is conversion-dependent, so zoning consistency here does not carry the weight it would inside a settled ' +
      'residential zone — the s.95 position above is doing the real work.'
    : '';

  return {
    state: 'clear',
    finding:
      `The intended use (${subjectFamily}) is consistent with the zoning recorded for this locality: "${planning.zoning}", ` +
      `permitted uses tracked as ${planning.permittedUses.join(', ')}, FAR ${planning.farAllowed}.` +
      conversionCaveat +
      ` ${basisCaveat}`,
    evidenceIds,
    needs: [],
  };
}

/* ==================================================================== */
/* Step 6 — rajakaluve / lake buffer                                     */
/* ==================================================================== */

function evaluateBufferClearance(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;
  const buffers = KARNATAKA_PACK.buffers;

  if (!ka) {
    return {
      state: 'not_started',
      finding:
        'MISSING: any record of whether this parcel abuts a storm-water drain (rajakaluve) or a lake boundary. Nothing ' +
        'on file says. This cannot be inferred from an address — it is read off the BBMP/BDA drain and lake maps against ' +
        'the survey number, and confirmed on the ground by a licensed surveyor. It matters more than its rarity ' +
        'suggests, because a buffer encroachment is grounds for demolition and overrides an otherwise clean title.',
      needs: ['other'],
    };
  }

  if (!ka.nearRajakaluve && !ka.nearLake) {
    return {
      state: 'clear',
      finding:
        'No proximity to a storm-water drain (rajakaluve) or a lake boundary is flagged for this parcel, so no ' +
        'no-construction buffer is indicated by what is on file. This is a negative recorded on the case rather than a ' +
        'survey result: if a site visit or the BBMP/BDA drain map shows a drain running along a boundary, re-run this ' +
        'with the flag set, because the buffer question then becomes the first question about the site.',
      evidenceIds: ctx.evidenceForRef('identity.karnataka.nearRajakaluve|nearLake'),
      needs: [],
    };
  }

  const drainRules = buffers.value.filter(b => /rajakaluve|drain|storm/i.test(`${b.key} ${b.label} ${b.appliesTo}`));
  const lakeRule = buffers.value.find(b => /lake/i.test(`${b.key} ${b.label} ${b.appliesTo}`));
  const drainMetres = drainRules.map(r => r.metres);
  const feature =
    ka.nearRajakaluve && ka.nearLake ? 'a storm-water drain (rajakaluve) and a lake' : ka.nearRajakaluve ? 'a storm-water drain (rajakaluve)' : 'a lake';

  const bands: string[] = [];
  if (ka.nearRajakaluve && drainMetres.length > 0) {
    bands.push(
      `${Math.min(...drainMetres)}-${Math.max(...drainMetres)}m from the drain edge depending on whether the drain is ` +
        'classified primary/valley-line, secondary or tertiary in the current BBMP/BDA drain map',
    );
  }
  if (ka.nearLake && lakeRule) {
    bands.push(`${lakeRule.metres}m from the lake's full tank level or surveyed boundary`);
  }

  return {
    state: 'attention',
    finding:
      `The parcel is flagged as near ${feature}. The buffer that would apply is ` +
      `${bands.length > 0 ? bands.join(', and ') : 'set by the applicable drain/lake buffer rules'} — but which figure ` +
      'actually binds depends on how this specific drain is classified in the current BBMP/BDA map, and these distances ' +
      `have been revised repeatedly by NGT orders, court directions and master-plan revisions. The State Pack's own ` +
      `figures are carried as of ${buffers.asOf} from ${buffers.source} and are indicative only. Construction inside a ` +
      'buffer is demolishable regardless of how clean the title is, so this is measured, not assumed: commission a ' +
      'licensed surveyor to measure the actual setback against the current drain-classification map before relying on ' +
      'any development or resale plan.',
    evidenceIds: ctx.evidenceForRef('identity.karnataka.nearRajakaluve|nearLake'),
    needs: ['other'],
  };
}

/* ==================================================================== */
/* Step 7 — betterment charges                                           */
/* ==================================================================== */

function evaluateBettermentCharges(ctx: PlaybookContext): StepOutcome {
  const receipt = ctx.doc('betterment_charges_receipt');
  const approval = ctx.identity.plot?.layoutApproval;
  const amount = ctx.fieldValue('betterment_charges_receipt', 'bettermentAmount');

  if (receipt) {
    return {
      state: 'clear',
      finding:
        `A betterment/improvement charges receipt is on file (${receipt.fileName}` +
        `${amount ? `, amount ${amount} ${ctx.identity.currency}` : ''}). Confirm the receipt is in respect of this site ` +
        'and this layout, and that it is the final rather than a part payment — an unpaid balance attaches to the ' +
        'property and surfaces later as a refused khata transfer.',
      evidenceIds: ctx.evidenceForDoc('betterment_charges_receipt'),
      needs: [],
    };
  }

  const levyingBody =
    approval === 'bda_approved'
      ? 'BDA, which ordinarily collects betterment/improvement charges at the allotment or layout-release stage'
      : approval === 'bmrda_approved'
        ? 'BMRDA or the local planning authority for the layout'
        : approval === 'panchayat_approved'
          ? 'the gram panchayat, whose own improvement levy is separate from anything BBMP would charge on annexation'
          : 'the authority that sanctioned the layout';

  return {
    state: 'not_started',
    finding:
      'MISSING: the betterment/improvement charges receipt. Nothing on file evidences that the development charges ' +
      `levied for this layout's infrastructure have been paid to ${levyingBody}. This is the quiet one: unpaid ` +
      'betterment charges attach to the property rather than to the person who incurred them, and they surface at the ' +
      'point the buyer applies to transfer the khata into their own name, which is after completion. This module does ' +
      'not quote a rate or an amount — betterment levies are set and revised by the levying body, and a figure invented ' +
      'here would be worse than none. Ask the seller for the receipt, and ask the levying body for a no-dues position.',
    needs: ['betterment_charges_receipt'],
  };
}

/* ==================================================================== */
/* The playbook                                                          */
/* ==================================================================== */

const CONVERSION_NEEDS: DocumentKind[] = ['conversion_certificate', 'other'];

export const KARNATAKA_LAND_USE_PLAYBOOK: Playbook = {
  id: 'karnataka_land_use',
  label: 'Lawfulness of non-agricultural use',
  authorityContext: "Deputy Commissioner's office (revenue), BDA / BMRDA / BIAAPA / gram panchayat (planning), BBMP",

  applicability(ctx) {
    const landType = isLandType(ctx.identity.propertyType);
    const status = ctx.karnataka?.landConversionStatus;

    if (!landType && status === 'not_applicable') {
      return {
        applicable: false,
        reason:
          `This is a ${ctx.identity.propertyType.replace(/_/g, ' ')} in a built development on land the case records as ` +
          'never having been agricultural revenue land. Conversion under s.95 of the Karnataka Land Revenue Act 1964 is a ' +
          'question about a parcel, settled once for a whole scheme by the promoter before construction — it is not a ' +
          'question a buyer of one unit can ask, act on, or obtain an order about. Where a unit buyer does want the ' +
          "scheme's conversion tested, it belongs in the promoter's approvals file, alongside the sanctioned plan and " +
          'the occupancy certificate, which the other two procedures cover.',
      };
    }

    return {
      applicable: true,
      reason: landType
        ? 'The property is a site or parcel, so the revenue classification of the land governs whether any ' +
          'non-agricultural use of it is lawful.'
        : 'The underlying land is recorded as agricultural, converted, or of unconfirmed classification, so the s.95 ' +
          'position bears on this property despite it being a built unit.',
    };
  },

  steps: [
    {
      key: 'revenue_classification',
      label: 'Revenue classification of the land',
      question: 'What does the revenue record say this land is — agricultural, or already non-agricultural?',
      requires: [],
      needs: CONVERSION_NEEDS,
      citation: 'Karnataka Land Revenue Act 1964 — record of rights (RTC / pahani). Section not asserted.',
      evaluate: evaluateRevenueClassification,
    },
    {
      key: 'dc_conversion_order',
      label: 'DC conversion order under s.95',
      question: 'Is there a Deputy Commissioner conversion order, and does it cover this survey number?',
      // Gate: whether an order is needed, missing or irrelevant is decided by
      // the revenue record. Reporting "no conversion order on file" against a
      // holding that was never agricultural is a false finding.
      requires: ['revenue_classification'],
      needs: ['conversion_certificate'],
      citation: packStatute('dc_conversion', 'Karnataka Land Revenue Act 1964, s.95'),
      evaluate: evaluateConversionOrder,
    },
    {
      key: 'conversion_conditions',
      label: 'Conversion conditions complied with',
      question: 'Was the converted use commenced within the order\'s period, for the purpose the order granted?',
      // Gate: conditions belong to an order. With no order established there
      // are no conditions to test, and asserting compliance or breach would be
      // pure invention.
      requires: ['dc_conversion_order'],
      needs: ['conversion_certificate', 'other'],
      citation: packStatute('dc_conversion', 'Karnataka Land Revenue Act 1964, s.95'),
      evaluate: evaluateConversionConditions,
    },
    {
      key: 'layout_sanction',
      label: 'Layout approval',
      question: 'Which authority sanctioned the layout this site sits in, and is that sanction traceable?',
      // Gate: deliberately on the revenue classification and NOT on the
      // conversion order. The revenue-layout finding is precisely the
      // combination of "no sanction" with "still agricultural", and gating
      // this behind a conversion order that does not exist would suppress the
      // most serious finding this procedure can make.
      requires: ['revenue_classification'],
      needs: ['other'],
      citation: packStatute('layout_approval_status', 'Karnataka Town and Country Planning Act 1961'),
      evaluate: evaluateLayoutSanction,
    },
    {
      key: 'master_plan_zoning',
      label: 'Master Plan zoning consistency',
      question: 'Is the intended use consistent with the land-use zoning in force for this parcel?',
      requires: ['revenue_classification'],
      needs: ['other'],
      citation:
        'Karnataka Town and Country Planning Act 1961; Revised Master Plan for Bengaluru (RMP 2015, as revised) — the plan in force for a given date must be confirmed.',
      evaluate: evaluateMasterPlanZoning,
    },
    {
      key: 'buffer_clearance',
      label: 'Rajakaluve / lake buffer clearance',
      question: 'Does the parcel fall inside a storm-water drain or lake no-construction buffer?',
      // Gate: a setback is measured from a boundary to a parcel, so the parcel
      // has to be identified in the revenue record first.
      requires: ['revenue_classification'],
      needs: ['other'],
      citation: packStatute(
        'rajakaluve_lake_buffer',
        'Karnataka Town and Country Planning Act 1961; NGT orders on Bengaluru lake and drain buffers',
      ),
      evaluate: evaluateBufferClearance,
    },
    {
      key: 'betterment_charges',
      label: 'Betterment / improvement charges',
      question: 'Have the development charges levied for this layout been paid, with no balance attaching to the site?',
      // Gate: which body levies betterment, and on what footing, follows from
      // who sanctioned the layout. Asking "have the charges been paid" with no
      // identified levying body is asking about nothing.
      requires: ['layout_sanction'],
      needs: ['betterment_charges_receipt'],
      citation:
        'Bangalore Development Authority Act 1976; Karnataka Municipal Corporations Act 1976 — betterment / improvement levy. Section and rate not asserted.',
      evaluate: evaluateBettermentCharges,
    },
  ],
};
