/**
 * Playbook: is the record right, and does the area reconcile?
 *
 * Two questions that look administrative and are not.
 *
 * THE REGISTER. Whether a Bengaluru property sits on an A-khata or a B-khata
 * is the single biggest binary in the whole screen. A-khata is the compliant
 * BBMP register entry; B-khata is the separate register of properties BBMP
 * records for tax purposes while declining to treat as regular. The
 * consequence is not a footnote: scheduled banks routinely refuse home loans
 * on B-khata property, BBMP will not sanction a building plan on it, and it
 * resells into a cash-buyer-only market at a real discount to A-khata stock.
 * A buyer who is told "it has a khata" and not told which one has been told
 * nothing.
 *
 * THE AREA. Bengaluru quotes and prices on super built-up area. RERA mandates
 * carpet area. The two run 25-35% apart. Everything downstream — the price per
 * square foot, the comparison against a neighbouring project, the loan-to-value
 * the bank computes — is wrong by that margin if the basis is not tracked, and
 * wrong in the direction that flatters the seller.
 *
 * Which is why the area-basis guard here is enforced twice over. It is a step,
 * because the user needs to see the basis stated. And it is a guard inside
 * every single area comparison this module makes (`compareAreas`), because a
 * step can be read past and a guard cannot: no two figures are ever
 * differenced unless they measure the same quantity on the same basis, and
 * where they do not, the finding says so in place of a percentage. A khata's
 * assessed area of 145 sqm against a deed extent of 55 sqm is not a 164%
 * discrepancy — it is a building measured against an undivided share of land,
 * and reporting it as a defect sends a buyer to a lawyer over arithmetic.
 */

import type { KarnatakaJurisdiction, KhataType, PropertyType } from '../types';
import { BBMP_TAX_ZONES, KARNATAKA_PACK, KHATA_TYPE_LABEL } from '../packs/karnataka';
import type { AreaFigure, Playbook, PlaybookContext, StepOutcome } from './types';
import { compareAreas, formatSqm, isoYear, numericValue } from './types';

/** Square feet to square metres, for reconciling a site's plan dimensions against a deed extent. */
const SQFT_TO_SQM = 0.09290304;

/** Extents within this much of each other are the same figure written twice, not a discrepancy. */
const EXTENT_TOLERANCE_PCT = 2;

function packStatute(key: string, fallback: string): string {
  return KARNATAKA_PACK.titleChecks.find(tc => tc.key === key)?.statute ?? fallback;
}

function isLandType(t: PropertyType): boolean {
  return t === 'residential_plot' || t === 'land_parcel';
}

/**
 * The consequence sentence for a B-khata, written once and used wherever the
 * classification comes up.
 *
 * Kept as a named constant rather than inlined because it is the single most
 * important sentence this playbook produces, and because a consequence that
 * gets paraphrased differently in three places gets trusted in none of them.
 */
const B_KHATA_CONSEQUENCE =
  'B-khata is not a lesser grade of the same thing: it is the separate register BBMP maintains for properties it records ' +
  'for tax purposes but does not treat as regular. The consequences are concrete and they compound — scheduled banks ' +
  'routinely refuse home loans against B-khata property, BBMP will not sanction a building plan on it so it cannot be ' +
  'lawfully built on or extended, and it resells into a cash-buyer-only market at a real discount to A-khata stock. ' +
  'Conversion to A-khata is possible in some cases and impossible in others, and which it is depends on the underlying ' +
  'reason for the B classification — an unapproved layout, a pending DC conversion, or tax arrears are three very ' +
  'different problems wearing the same label. Establish the reason before pricing the risk.';

/**
 * Whether the recorded register type and the recorded jurisdiction can both be
 * true at once. Where they cannot, the register is not established, and
 * everything read off it is read off something unidentified.
 */
function registerIsCoherent(khataType: KhataType | undefined, jurisdiction: KarnatakaJurisdiction | undefined): boolean {
  if (!khataType || khataType === 'unknown') return false;
  if (jurisdiction === 'gram_panchayat') {
    // Outside municipal limits the register is the panchayat's own Form 9 and
    // Form 11. A BBMP A/B classification recorded against panchayat land is a
    // category error somewhere in the file, not a finding about the property.
    return khataType === 'gram_panchayat_form_9_11' || khataType === 'none';
  }
  if (khataType === 'gram_panchayat_form_9_11') {
    return jurisdiction === undefined || jurisdiction === 'unknown';
  }
  return true;
}

/* ==================================================================== */
/* Step 1 — which register                                               */
/* ==================================================================== */

function evaluateKhataType(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;
  const khataType = ka?.khataType;
  const jurisdiction = ka?.jurisdiction;
  const khataDoc = ctx.doc('khata_extract');
  const form911 = ctx.doc('form_9_11');
  const classificationOnExtract = ctx.fieldValue('khata_extract', 'khataClassification');
  const evidenceIds = [
    ...ctx.evidenceForRef('identity.karnataka.khataType'),
    ...ctx.evidenceForDoc('khata_extract'),
    ...ctx.evidenceForDoc('form_9_11'),
  ];

  if ((!khataType || khataType === 'unknown') && !khataDoc && !form911) {
    return {
      state: 'not_started',
      finding:
        'MISSING: the khata extract and khata certificate (or, for land outside municipal limits, the gram panchayat ' +
        'Form 9 and Form 11). Nothing on file says which property register this property sits on, and no register type ' +
        'is recorded on the case. That is the first thing to establish, not a detail: the A/B distinction decides whether ' +
        'a mainstream lender will finance the purchase at all, and every other step in this procedure reads figures off ' +
        'a register that has not yet been identified.',
      needs: ['khata_extract', 'form_9_11'],
    };
  }

  if (khataType === 'none') {
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        'No khata exists for this property. Without one, property tax cannot be paid in the owner\'s name, utilities and ' +
        'transfers become materially harder, and the property is outside the register the municipality actually works ' +
        'from. Establish why none was ever issued — an unapproved layout and an unconverted parent parcel are the usual ' +
        'reasons, and both are larger problems than the missing khata itself.',
      evidenceIds,
      needs: ['khata_extract'],
    };
  }

  if (!registerIsCoherent(khataType, jurisdiction)) {
    const recorded = khataType ? KHATA_TYPE_LABEL[khataType] : 'not recorded';
    return {
      state: 'attention',
      severity: khataType === 'b_khata' ? 'blocker' : 'attention',
      finding:
        `THE REGISTER IS NOT ESTABLISHED. The case records the register entry as "${recorded}" while placing the property ` +
        `under ${jurisdiction ?? 'an unrecorded'} jurisdiction, and those two statements do not sit together: outside ` +
        'municipal limits the register is the gram panchayat\'s Form 9 and Form 11, not a BBMP A/B khata. ' +
        (form911
          ? `A Form 9 and 11 extract IS on file (${form911.fileName}, reference ${ctx.fieldValue('form_9_11', 'formReference') ?? 'not read'}), ` +
            'which points to the panchayat register being the real one and the khata classification on the case being ' +
            'either a marketing description or a record of a different property. '
          : 'No panchayat extract is on file to settle it either. ') +
        (khataType === 'b_khata'
          ? `The recorded classification also matters on its own terms. ${B_KHATA_CONSEQUENCE} `
          : '') +
        'Nothing further in this procedure is evaluated until it is settled which register this property is actually on ' +
        '— an assessed area, a holder name or a tax position read off an unidentified register is a figure with no source.',
      evidenceIds,
      needs: ['khata_extract', 'form_9_11'],
    };
  }

  if (khataType === 'b_khata') {
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        `The property is on a B-khata${classificationOnExtract ? ` (extract classification "${classificationOnExtract}")` : ''}. ` +
        `${B_KHATA_CONSEQUENCE} The register is established, so the rest of this procedure can proceed — but read every ` +
        'finding below in the knowledge that the financing and plan-sanction position is already constrained.',
      evidenceIds,
      needs: khataDoc ? [] : ['khata_extract'],
    };
  }

  if (khataType === 'gram_panchayat_form_9_11') {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED: the property is on the gram panchayat register (Form 9, the property register extract, and Form 11, ' +
        'the demand and tax-paid register)' +
        `${form911 ? `, evidenced by ${form911.fileName}` : ', though neither extract is on file'}. For land genuinely ` +
        'outside municipal limits this is the correct register, not a deficient one — but its limits are real: Form 9/11 ' +
        'is an assessment record and not evidence of title, panchayat areas sit outside BBMP\'s building-plan regime, and ' +
        'lenders treat panchayat-register property more cautiously than BBMP A-khata stock. If the area has since been ' +
        'brought into city limits, a khata is due and the panchayat record alone will start to block transactions.',
      evidenceIds,
      needs: form911 ? [] : ['form_9_11'],
    };
  }

  // a_khata or e_khata against a municipal/development-authority jurisdiction.
  const evidencedByExtract = Boolean(khataDoc);
  const consistencySentence = classificationOnExtract
    ? classificationOnExtract.toUpperCase().startsWith('A')
      ? `The extract on file records classification "${classificationOnExtract}", consistent with the case record.`
      : `The extract on file records classification "${classificationOnExtract}", which does NOT read as an A-khata — ` +
        'reconcile the extract against the case record before relying on either.'
    : 'No khata extract is on file, so the classification rests on the case record rather than on the register itself. ' +
      'Obtain the khata extract and khata certificate; it is the first document a lender asks for and the cheapest gap ' +
      'on this list to close.';

  const jurisdictionSentence =
    jurisdiction === 'BBMP'
      ? ''
      : ` Note the jurisdiction: this property sits under ${jurisdiction}, and BBMP's A/B bifurcation is strictly a BBMP ` +
        `construct. For a ${jurisdiction} property the register entry is that authority's own khata, and "A-khata" is ` +
        'being used here in its common market sense of a regular, unqualified register entry. Confirm which body actually ' +
        'holds the register for this property.';

  return {
    state: 'clear',
    finding:
      `ESTABLISHED: the property is recorded on an A-khata — the regular register entry, which supports mainstream ` +
      `lending, building-plan sanction and resale without the B-khata restrictions. ${consistencySentence}` +
      jurisdictionSentence,
    evidenceIds,
    needs: evidencedByExtract ? [] : ['khata_extract'],
  };
}

/* ==================================================================== */
/* Step 2 — e-khata                                                      */
/* ==================================================================== */

function evaluateEKhata(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;

  if (!ka) {
    return {
      state: 'not_started',
      finding:
        'MISSING: the e-khata status. Nothing on file records whether the digitised khata has been issued. Check it on ' +
        'the BBMP portal against the khata number and record the result.',
      needs: ['khata_extract'],
    };
  }

  if (ka.jurisdiction !== 'BBMP') {
    return {
      state: 'not_applicable',
      finding:
        `NOT APPLICABLE: e-khata is BBMP's digitisation of its own register, and this property falls under ` +
        `${ka.jurisdiction} jurisdiction, so no BBMP e-khata requirement attaches to it.` +
        (ka.eKhataIssued
          ? ' The case nonetheless records an e-khata as issued, which is worth resolving: either the property sits in a ' +
            'BBMP-administered pocket after all, or the record refers to that authority\'s own digitised khata. The two ' +
            'are not interchangeable at the registration counter.'
          : ' Confirm instead that the equivalent register entry for this jurisdiction is current and digitised where ' +
            'that authority has moved to a digital record.'),
      evidenceIds: ctx.evidenceForRef('identity.karnataka.eKhataIssued'),
      needs: [],
    };
  }

  if (ka.eKhataIssued) {
    return {
      state: 'clear',
      finding:
        'An e-khata has been issued for this BBMP property. That removes what has become one of the commonest avoidable ' +
        'causes of a registration appointment failing at the Sub-Registrar. Take a current printout at the time of ' +
        'registration rather than relying on one issued months earlier — the register is live and the counter checks it ' +
        'on the day.',
      evidenceIds: ctx.evidenceForRef('identity.karnataka.eKhataIssued'),
      needs: [],
    };
  }

  return {
    state: 'attention',
    finding:
      'No e-khata has been issued for this BBMP property. The underlying paper khata may be entirely in order, but the ' +
      'digitised record is what a growing share of lenders and the registration workflow itself now check, and its ' +
      'absence stalls or refuses registration on a ground that has nothing to do with the merits of the title. Apply for ' +
      'e-khata migration on the BBMP portal before scheduling registration — the timing is the point, because the ' +
      'application is made by the recorded owner, i.e. the seller, and is much harder to chase after completion.',
    evidenceIds: ctx.evidenceForRef('identity.karnataka.eKhataIssued'),
    needs: ['khata_extract'],
  };
}

/* ==================================================================== */
/* Step 3 — holder matches registered owner                              */
/* ==================================================================== */

function evaluateHolderMatch(ctx: PlaybookContext): StepOutcome {
  const khataDoc = ctx.doc('khata_extract');
  const form911 = ctx.doc('form_9_11');
  const registerDoc = khataDoc ?? form911;
  const ownerOnDeed = ctx.fieldValue('title_deed', 'ownerName');

  if (!registerDoc) {
    return {
      state: 'not_started',
      finding:
        'MISSING: the register extract itself. The case may record a khata type, but without the extract there is no ' +
        'holder name to match against the deed. This is the check that catches the commonest defect in an otherwise ' +
        'clean Bengaluru file: a sale that registered properly at the Sub-Registrar years ago but whose khata transfer ' +
        'was never applied for, leaving the property still recorded against a predecessor. The seller can convey; what ' +
        'they cannot do is hand over a register entry in their own name, and the buyer discovers it when they try to ' +
        `transfer the khata themselves.${ownerOnDeed ? ` The deed on file names ${ownerOnDeed} as registered owner.` : ''}`,
      needs: khataDoc === undefined && form911 === undefined ? ['khata_extract', 'form_9_11'] : ['khata_extract'],
    };
  }

  const khataNumber = ctx.fieldValue('khata_extract', 'khataNumber') ?? ctx.fieldValue('form_9_11', 'formReference');

  return {
    state: 'attention',
    finding:
      `NOT MATCHED — and this is a limit of the file rather than a defect found. The register extract on file ` +
      `(${registerDoc.fileName}${khataNumber ? `, reference ${khataNumber}` : ''}) does not carry the holder's name among ` +
      'the fields read from it, so no comparison against the deed has been made' +
      `${ownerOnDeed ? `; the deed names ${ownerOnDeed} as registered owner` : ''}. Read the holder name and the transfer ` +
      'endorsements off the extract and match them, name by name, against the deed chain. A mismatch here does not ' +
      'invalidate the sale — the register follows title, it does not create it — but it does mean the khata transfer is ' +
      'outstanding, and an outstanding khata transfer is a cost and a delay the buyer inherits at completion.',
    evidenceIds: [...ctx.evidenceForDoc('khata_extract'), ...ctx.evidenceForDoc('form_9_11')],
    needs: ['khata_extract', 'title_deed'],
  };
}

/* ==================================================================== */
/* Step 4 — area basis                                                   */
/* ==================================================================== */

function evaluateAreaBasis(ctx: PlaybookContext): StepOutcome {
  const basis = ctx.karnataka?.areaBasis;
  const evidenceIds = ctx.evidenceForRef('identity.karnataka.areaBasis');

  if (isLandType(ctx.identity.propertyType)) {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED: for a site the basis is the extent of land, and the carpet / built-up / super built-up distinction ' +
        'does not arise — those are ways of measuring a building. The basis that does have to be pinned down for a site ' +
        'is which land figure is being used: the extent recited in the deed, the dimensions shown for this site on the ' +
        'approved layout plan, or a measured survey on the ground. Those three routinely differ by a few percent, and on ' +
        'a narrow site a few percent is a setback.',
      evidenceIds,
      needs: [],
    };
  }

  if (!basis || basis === 'unknown') {
    return {
      state: 'not_started',
      finding:
        'MISSING: the stated basis of the quoted area. Neither the case nor the documents on file say whether the area ' +
        'being quoted is carpet, built-up or super built-up, and in Bengaluru that is a 25-35% question, not a rounding ' +
        'one — the city markets on super built-up while RERA requires carpet to be disclosed. Until it is known, no area ' +
        'on this file can be compared with any other area, and the price per square foot is unanchored. The sale ' +
        'agreement and the RERA disclosure for the project are where the carpet figure is stated; ask for both.',
      needs: ['sale_agreement', 'rera_registration'],
    };
  }

  if (basis === 'carpet') {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED: the quoted area is on a RERA carpet-area basis. That is the basis RERA requires to be disclosed ' +
        '(Real Estate (Regulation and Development) Act 2016, s.2(k)) and the one that compares directly against other ' +
        'carpet-area disclosures. Watch for the mixed file: a carpet figure in the agreement alongside a super built-up ' +
        'figure in the brochure and a plinth-area figure on the khata is normal, and it is why every comparison in this ' +
        'procedure is basis-checked before it is made rather than after.',
      evidenceIds,
      needs: [],
    };
  }

  if (basis === 'built_up') {
    return {
      state: 'clear',
      finding:
        'ESTABLISHED: the quoted area is built-up area — carpet plus wall thickness and balcony, but not a share of ' +
        'common areas. Built-up typically runs on the order of 10-15% above carpet, so a price per square foot computed ' +
        'on it understates the true carpet rate by a similar margin. The basis is known, which is what this step asks; ' +
        'the consequence is that any comparison against a RERA carpet disclosure must be re-expressed first, and this ' +
        'module will not difference the two.',
      evidenceIds,
      needs: [],
    };
  }

  return {
    state: 'clear',
    finding:
      'ESTABLISHED: the quoted area is SUPER BUILT-UP — carpet, plus walls, plus a loaded share of lobbies, lifts, ' +
      'staircases and amenities. This is the Bengaluru market convention and it is also the single largest distortion in ' +
      'any headline price per square foot here: super built-up runs 25-35% above the RERA carpet area for the same flat, ' +
      'so a rate quoted on it is 25-35% flattering against a carpet-area comparison, and a loan-to-value computed from it ' +
      'is measuring a different flat from the one RERA describes. The basis is known — that is what this step ' +
      'establishes — but every figure derived from the area needs re-expressing on carpet before it is compared with ' +
      'anything. Get the carpet area from the sale agreement or the K-RERA filing (Real Estate (Regulation and ' +
      'Development) Act 2016, s.2(k)) and work from that.',
    evidenceIds,
    needs: ['sale_agreement', 'rera_registration'],
  };
}

/* ==================================================================== */
/* Step 5 — assessed area reconciliation                                 */
/* ==================================================================== */

function evaluateAssessedArea(ctx: PlaybookContext): StepOutcome {
  const khataDoc = ctx.doc('khata_extract');
  const assessed = numericValue(ctx.fieldValue('khata_extract', 'assessedArea'));
  const deedExtent = numericValue(ctx.fieldValue('title_deed', 'extent'));
  const basis = ctx.karnataka?.areaBasis ?? 'unknown';
  const land = isLandType(ctx.identity.propertyType);
  const evidenceIds = [...ctx.evidenceForDoc('khata_extract'), ...ctx.evidenceForDoc('title_deed')];
  const lines: string[] = [];
  let anyRealMismatch = false;
  let anyComparisonMade = false;

  if (!khataDoc && deedExtent === undefined) {
    return {
      state: 'not_started',
      finding:
        'MISSING: both sides of the reconciliation. Neither a khata extract carrying an assessed area nor a deed ' +
        'carrying a stated extent is on file, so there are no two figures to reconcile. The assessed area on the ' +
        'register, the extent conveyed by the deed and the dimensions on the sanctioned plan or approved layout plan are ' +
        'the three figures that have to agree; obtain them before any area on this file is relied on.',
      needs: ['khata_extract', 'title_deed', 'sanctioned_plan_bbmp'],
    };
  }

  /* --- Register assessed area against the deed extent ------------------ */
  if (assessed !== undefined && deedExtent !== undefined) {
    const assessedFigure: AreaFigure = {
      sqm: assessed,
      quantity: land ? 'built_area' : 'built_area',
      basis: 'unknown',
      label: 'assessed area on the khata extract',
    };
    const deedFigure: AreaFigure = {
      sqm: deedExtent,
      quantity: land ? 'land_extent' : 'undivided_share',
      basis: 'unknown',
      label: 'extent conveyed by the sale deed',
    };
    const cmp = compareAreas(assessedFigure, deedFigure);
    anyComparisonMade = true;
    if (!cmp.comparable) {
      lines.push(
        `Register against deed — NOT A MISMATCH, not compared: assessed area ${formatSqm(assessed)}, deed extent ` +
          `${formatSqm(deedExtent)}. ${cmp.reason} The khata's assessed area measures the structure BBMP levies tax on; ` +
          (land
            ? 'a vacant site has no structure, so a zero or nominal assessed area is what a correct record looks like.'
            : "the deed's extent for a unit is the undivided share of land that unit carries. They are supposed to differ."),
      );
    } else if (Math.abs(cmp.deltaPct) <= EXTENT_TOLERANCE_PCT) {
      lines.push(`Register against deed: ${formatSqm(assessed)} and ${formatSqm(deedExtent)} reconcile (${cmp.deltaPct.toFixed(1)}% apart).`);
    } else {
      anyRealMismatch = true;
      lines.push(
        `Register against deed: ${formatSqm(assessed)} against ${formatSqm(deedExtent)}, ${cmp.deltaPct.toFixed(1)}% apart ` +
          'on the same measure. That is a real discrepancy and needs explaining.',
      );
    }
  }

  /* --- Register assessed area against the floor area on the case ------- */
  if (assessed !== undefined && !land && ctx.identity.builtUpAreaSqm > 0) {
    const cmp = compareAreas(
      { sqm: assessed, quantity: 'built_area', basis: 'unknown', label: 'assessed area on the khata extract' },
      { sqm: ctx.identity.builtUpAreaSqm, quantity: 'built_area', basis, label: 'floor area recorded for this case' },
    );
    anyComparisonMade = true;
    if (!cmp.comparable) {
      lines.push(
        `Register against the case's own floor area — NOT A MISMATCH, not compared: ${formatSqm(assessed)} against ` +
          `${formatSqm(ctx.identity.builtUpAreaSqm)}. ${cmp.reason} BBMP's assessment measure is not stated on the ` +
          'extract, so even where the two numbers happen to be close, treating their difference as a discrepancy would ' +
          'be reading a basis conversion as a defect.',
      );
    } else if (Math.abs(cmp.deltaPct) <= EXTENT_TOLERANCE_PCT) {
      lines.push(`Register against the case's floor area: ${formatSqm(assessed)} and ${formatSqm(ctx.identity.builtUpAreaSqm)} reconcile.`);
    } else {
      anyRealMismatch = true;
      lines.push(
        `Register against the case's floor area: ${formatSqm(assessed)} against ${formatSqm(ctx.identity.builtUpAreaSqm)}, ` +
          `${cmp.deltaPct.toFixed(1)}% apart on the same basis. That is a real discrepancy — a khata assessed area below ` +
          'the actual built area is the signature of an unrecorded extension, which is also an unauthorised one.',
      );
    }
  }

  /* --- Deed extent against the layout plan dimensions ------------------ */
  const dims = ctx.identity.plot?.dimensionsFt;
  if (land && deedExtent !== undefined && dims && dims.width > 0 && dims.depth > 0) {
    const planSqm = dims.width * dims.depth * SQFT_TO_SQM;
    const cmp = compareAreas(
      { sqm: deedExtent, quantity: 'land_extent', basis: 'unknown', label: 'extent conveyed by the sale deed' },
      { sqm: planSqm, quantity: 'land_extent', basis: 'unknown', label: `site dimensions on file (${dims.width}x${dims.depth} ft)` },
    );
    anyComparisonMade = true;
    if (cmp.comparable && Math.abs(cmp.deltaPct) <= EXTENT_TOLERANCE_PCT) {
      lines.push(
        `Deed against site dimensions: ${formatSqm(deedExtent)} against ${dims.width}x${dims.depth} ft ` +
          `(${formatSqm(planSqm)}) reconcile, ${cmp.deltaPct.toFixed(1)}% apart. Confirm the same dimensions appear ` +
          'against this site number on the approved layout plan, not only in the particulars.',
      );
    } else if (cmp.comparable) {
      anyRealMismatch = true;
      lines.push(
        `Deed against site dimensions: ${formatSqm(deedExtent)} against ${dims.width}x${dims.depth} ft ` +
          `(${formatSqm(planSqm)}), ${cmp.deltaPct.toFixed(1)}% apart. On a site that gap is boundary, not rounding — ` +
          'commission a measured survey against the approved layout plan before completing.',
      );
    }
  }

  if (!khataDoc) {
    lines.push(
      'No khata extract is on file, so the register side of the reconciliation is missing entirely — the assessed area ' +
      'BBMP or the authority actually holds for this property is unknown.',
    );
  }

  if (lines.length === 0 || !anyComparisonMade) {
    return {
      state: 'not_started',
      finding:
        'MISSING: readable area figures. The documents on file did not yield an assessed area, a deed extent, or both, ' +
        'so no reconciliation was attempted and none is asserted. ' +
        (lines.length > 0 ? lines.join(' ') : ''),
      evidenceIds,
      needs: ['khata_extract', 'title_deed', 'sanctioned_plan_bbmp'],
    };
  }

  const allReconciled = !anyRealMismatch && khataDoc !== undefined;

  return {
    state: anyRealMismatch ? 'attention' : allReconciled ? 'clear' : 'attention',
    severity: anyRealMismatch ? 'blocker' : undefined,
    finding:
      (anyRealMismatch
        ? 'AREAS DO NOT RECONCILE. '
        : allReconciled
          ? 'Areas reconcile so far as the figures on file permit a like-for-like comparison. '
          : 'Areas could not be fully reconciled from what is on file, and no mismatch is asserted where a comparison ' +
            'was not legitimate. ') +
      lines.join(' ') +
      ' Every comparison above was basis-checked before it was made: figures measuring different quantities, or the same ' +
      'quantity on different bases, are reported as not compared rather than as a percentage.',
    evidenceIds,
    needs: anyRealMismatch || !khataDoc ? ['khata_extract', 'title_deed', 'sanctioned_plan_bbmp'] : [],
  };
}

/* ==================================================================== */
/* Step 6 — property tax current                                         */
/* ==================================================================== */

function evaluateTaxCurrent(ctx: PlaybookContext): StepOutcome {
  const receipt = ctx.doc('property_tax_receipt');
  const form911 = ctx.doc('form_9_11');
  const jurisdiction = ctx.karnataka?.jurisdiction;
  const panchayat = jurisdiction === 'gram_panchayat';

  if (!receipt) {
    return {
      state: 'not_started',
      finding:
        `MISSING: the latest ${panchayat ? 'gram panchayat tax-paid receipt (Form 11)' : 'property tax paid receipt'}. ` +
        'Nothing on file shows tax is current. Arrears do not stay with the person who ran them up — they attach to the ' +
        'property, and they surface at the point the buyer applies to transfer the register entry into their own name, ' +
        'which is after completion. The receipt also carries the identifiers the authority traces the property by (the ' +
        'SAS application number on a BBMP receipt), which is how you confirm the receipt is for this property rather ' +
        'than a neighbouring one.' +
        (form911 ? ` A Form 9/11 extract is on file but the tax-paid position it evidences was not read from it.` : ''),
      needs: panchayat ? ['form_9_11', 'property_tax_receipt'] : ['property_tax_receipt'],
    };
  }

  const yearRaw = ctx.fieldValue('property_tax_receipt', 'assessmentYear');
  const year = numericValue(yearRaw) ?? isoYear(yearRaw);
  const sas = ctx.fieldValue('property_tax_receipt', 'sasApplicationNumber');
  const amount = ctx.fieldValue('property_tax_receipt', 'annualTax');
  const evidenceIds = ctx.evidenceForDoc('property_tax_receipt');
  const identifierSentence = sas
    ? `The receipt carries SAS application number ${sas}, which is the identifier BBMP traces the property by across its systems — check it against the khata extract.`
    : 'The receipt carries no SAS application number among the extracted fields, so it has not been tied to this property by identifier; read it off the receipt.';

  if (year === undefined) {
    return {
      state: 'attention',
      finding:
        `A property tax receipt is on file (${receipt.fileName}${amount ? `, ${amount} ${ctx.identity.currency}` : ''}) but ` +
        'the assessment year could not be read from it, so whether tax is current as at the screen date is unresolved. ' +
        `${identifierSentence} Obtain a no-dues position from the assessing authority rather than inferring it from a ` +
        'single receipt: one paid year does not evidence that earlier years were.',
      evidenceIds,
      needs: ['property_tax_receipt'],
    };
  }

  const lag = ctx.nowYear - year;

  if (lag <= 1) {
    return {
      state: 'clear',
      finding:
        `Tax is paid for assessment year ${year}${amount ? ` (${amount} ${ctx.identity.currency})` : ''}, current as at the ` +
        `screen date (${ctx.nowYear}). ${identifierSentence} One current receipt evidences one year: ask for a no-dues ` +
        'certificate or the last several years of receipts before completion, because arrears attach to the property.',
      evidenceIds,
      needs: [],
    };
  }

  return {
    state: 'attention',
    finding:
      `The latest tax receipt on file is for assessment year ${year}, which is ${lag} years behind the screen date ` +
      `(${ctx.nowYear}). Either later payments were made and not supplied, or tax is in arrears. ${identifierSentence} ` +
      'Arrears attach to the property and are typically recovered from whoever holds it, together with interest and ' +
      'penalty, and unpaid tax will block the khata transfer the buyer needs to make after completion. Get the current ' +
      'position from the assessing authority, not from the seller.',
    evidenceIds,
    needs: ['property_tax_receipt'],
  };
}

/* ==================================================================== */
/* Step 7 — BBMP zone consistency                                        */
/* ==================================================================== */

function evaluateZoneConsistency(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;
  const receiptZone = ctx.fieldValue('property_tax_receipt', 'bbmpZone');
  const recordedZone = ka?.bbmpTaxZone;
  const evidenceIds = ctx.evidenceForDoc('property_tax_receipt');

  if (ka && ka.jurisdiction !== 'BBMP') {
    return {
      state: 'not_applicable',
      finding:
        `NOT APPLICABLE: the BBMP zonal unit-area-value schedule sets property tax inside BBMP limits, and this property ` +
        `falls under ${ka.jurisdiction}. Its tax is assessed by that authority on its own basis.` +
        (receiptZone
          ? ` The receipt on file nonetheless shows a BBMP zone letter (${receiptZone}), which should be reconciled ` +
            'against the assessing authority — a BBMP zone on a non-BBMP property is either a mis-transcription or a ' +
            'sign the property is in fact inside BBMP limits.'
          : ''),
      evidenceIds,
      needs: [],
    };
  }

  const zone = recordedZone ?? receiptZone;
  if (!zone) {
    return {
      state: 'not_started',
      finding:
        'MISSING: the BBMP property-tax zone. Neither the case nor the receipt on file records which of BBMP\'s six ' +
        'zones (A highest unit area value, F lowest) this property is assessed in. The zone sets the unit area value ' +
        'and therefore the tax, and a property assessed in too low a zone accrues a shortfall that BBMP can recover ' +
        'later from the current owner. Read it off the tax receipt or the BBMP property-tax portal.',
      needs: ['property_tax_receipt'],
    };
  }

  const zoneInfo = BBMP_TAX_ZONES.find(z => z.zone === zone);
  const locality = ctx.identity.locality;
  const corroborated = Boolean(zoneInfo && locality && zoneInfo.description.toLowerCase().includes(locality.toLowerCase()));
  const mismatchBetweenSources = Boolean(recordedZone && receiptZone && recordedZone !== receiptZone);

  if (mismatchBetweenSources) {
    return {
      state: 'attention',
      finding:
        `The case records BBMP zone ${recordedZone} while the tax receipt on file shows zone ${receiptZone}. Those cannot ` +
        'both be right, and the difference is money: the zone sets the unit area value the whole assessment is computed ' +
        'from, so an assessment run in the wrong zone leaves a recoverable shortfall attached to the property. Settle it ' +
        'against the BBMP property-tax portal for this SAS number.',
      evidenceIds,
      needs: ['property_tax_receipt'],
    };
  }

  if (corroborated) {
    return {
      state: 'clear',
      finding:
        `Zone ${zone} is recorded, and ${locality} is among the localities the State Pack carries as illustrative of that ` +
        `zone (${zoneInfo?.description ?? ''}). That is corroboration, not confirmation: BBMP's zones are set by ` +
        'notification and are redrawn as wards are added or reclassified, so the zone that applies to a specific street ' +
        'is a notification fact rather than something derivable from the locality name. Verify it on the BBMP ' +
        'property-tax portal against the SAS number before treating the assessment as correct.',
      evidenceIds,
      needs: [],
    };
  }

  return {
    state: 'attention',
    finding:
      `Zone ${zone} is recorded for a property in ${locality || 'an unrecorded locality'}, and this could NOT be ` +
      'corroborated against the State Pack\'s illustrative locality list for that zone. That is not a finding that the ' +
      'zone is wrong — the pack\'s list names a handful of examples per zone and is explicitly not a map, and BBMP zones ' +
      'are a notification fact that cannot be derived from a locality name. It is a flag that the assessment basis has ' +
      'not been independently corroborated here. Confirm the zone on the BBMP property-tax portal against the SAS ' +
      'number; a property assessed in too low a zone carries a recoverable shortfall.',
    evidenceIds,
    needs: ['property_tax_receipt'],
  };
}

/* ==================================================================== */
/* The playbook                                                          */
/* ==================================================================== */

export const KARNATAKA_KHATA_AREA_PLAYBOOK: Playbook = {
  id: 'karnataka_khata_area',
  label: 'Register accuracy and area reconciliation',
  authorityContext: 'BBMP (khata, e-khata, property tax) or the gram panchayat / development authority holding the register',

  applicability(ctx) {
    // Applies to every Karnataka property — but not in the same way. A BBMP
    // flat is screened against the A/B bifurcation and the e-khata; a gram
    // panchayat site against Form 9 and Form 11, where the A/B question is a
    // category error; a BDA plot against that authority's own register, where
    // "A-khata" is market shorthand rather than the BBMP construct. Those
    // differences are handled inside the steps, and the steps that do not
    // arise report `not_applicable` rather than vanishing, so the reader can
    // see the procedure was run in full.
    return {
      applicable: true,
      reason:
        'Every Karnataka property sits on some property register and is assessed to some tax, so the procedure applies ' +
        'throughout — which register, and therefore which steps arise, varies by jurisdiction.',
    };
  },

  steps: [
    {
      key: 'khata_type_established',
      label: 'Which register, and which classification',
      question: 'Which property register does this property sit on — BBMP A-khata, B-khata, or gram panchayat Form 9 & 11?',
      requires: [],
      needs: ['khata_extract', 'form_9_11'],
      citation: packStatute('khata_classification', 'Karnataka Municipal Corporations Act 1976 — BBMP khata register'),
      evaluate: evaluateKhataType,
    },
    {
      key: 'e_khata_issued',
      label: 'e-Khata issued',
      question: 'Has the digitised e-khata been issued for this property?',
      // Gate: e-khata is a BBMP register concept. Asking whether one has been
      // issued before knowing which register the property is on produces an
      // answer about the wrong register.
      requires: ['khata_type_established'],
      needs: ['khata_extract'],
      citation: packStatute('e_khata_issuance', 'BBMP e-Khata initiative, administered under the Karnataka Municipal Corporations Act 1976'),
      evaluate: evaluateEKhata,
    },
    {
      key: 'khata_holder_matches_owner',
      label: 'Register holder matches the registered owner',
      question: 'Is the register entry in the name of the person the deed records as owner?',
      requires: ['khata_type_established'],
      needs: ['khata_extract', 'title_deed'],
      citation: packStatute('khata_classification', 'Karnataka Municipal Corporations Act 1976 — BBMP khata register'),
      evaluate: evaluateHolderMatch,
    },
    {
      key: 'area_basis_known',
      label: 'Area basis known and consistently applied',
      question: 'On what basis is the area stated — carpet, built-up, super built-up, or extent of land?',
      // Declared before the reconciliation because a practitioner establishes
      // the basis first. Deliberately NOT a hard prerequisite of it: the basis
      // guard that actually prevents a false mismatch lives inside every
      // comparison (`compareAreas`), where it cannot be read past, and gating
      // the reconciliation behind this step as well would suppress a site's
      // extent reconciliation on the technicality that carpet-vs-super-built-up
      // does not arise for a plot.
      requires: ['khata_type_established'],
      needs: ['sale_agreement', 'rera_registration'],
      citation: 'Real Estate (Regulation and Development) Act 2016, s.2(k) — carpet area definition',
      evaluate: evaluateAreaBasis,
    },
    {
      key: 'assessed_area_reconciles',
      label: 'Assessed area reconciles with deed and plan',
      question: 'Do the assessed area, the extent conveyed and the sanctioned dimensions agree?',
      // Gate: an assessed area read off a register nobody has identified is a
      // number with no source. This is the local form of the rule that governs
      // the whole module — reconcile nothing against a record you have not
      // established.
      requires: ['khata_type_established'],
      needs: ['khata_extract', 'title_deed', 'sanctioned_plan_bbmp'],
      citation: packStatute('khata_classification', 'Karnataka Municipal Corporations Act 1976 — BBMP khata register'),
      evaluate: evaluateAssessedArea,
    },
    {
      key: 'property_tax_current',
      label: 'Property tax current, no arrears',
      question: 'Is property tax paid up to date, with nothing attaching to the property?',
      // Gate: BBMP, a municipal council and a gram panchayat each assess and
      // receipt property tax on different footings, and the SAS number on a
      // BBMP receipt is keyed to the khata. A receipt read without knowing
      // which register the property sits on evidences that a payment was made,
      // not that this property's tax is current.
      requires: ['khata_type_established'],
      needs: ['property_tax_receipt'],
      citation: packStatute('khata_classification', 'Karnataka Municipal Corporations Act 1976 — property tax under the Self-Assessment Scheme'),
      evaluate: evaluateTaxCurrent,
    },
    {
      key: 'bbmp_zone_consistent',
      label: 'BBMP tax zone consistent with the locality',
      question: 'Is the zone the property is assessed in consistent with where it actually is?',
      // Gate: the zone is a property of the assessment, so there has to be an
      // assessment to read it off.
      requires: ['property_tax_current'],
      needs: ['property_tax_receipt'],
      citation: 'BBMP property-tax zonal classification (Self-Assessment Scheme unit area values), set by BBMP notification',
      evaluate: evaluateZoneConsistency,
    },
  ],
};
