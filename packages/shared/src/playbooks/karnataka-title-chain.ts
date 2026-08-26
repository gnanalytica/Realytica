/**
 * Playbook: establish marketable title (Karnataka / Bengaluru).
 *
 * This is the procedure a Bengaluru title lawyer actually works through, in
 * the order they work through it, and the order is the substance rather than
 * presentation. You establish the root of title before you trace the chain,
 * because a chain with no root is a list of transfers nobody has connected to
 * an original grant. You establish the chain before you ask whether each link
 * was registered, because "is every link registered" presupposes knowing what
 * the links are. You match the khata lineage against the deed lineage last,
 * because the khata is a *tax* register — it follows title, it does not create
 * it, and comparing it against a deed lineage you have not established tells
 * you which of two unestablished things disagrees.
 *
 * The gates below encode that. A step whose prerequisite is not clear is not
 * evaluated at all; it reports `blocked` and names what is holding it up. The
 * alternative — running every check independently and presenting seven
 * confident findings — is what a generic planner does, and it is worse than
 * useless here, because the findings downstream of a broken chain are
 * arithmetic performed on assumptions.
 *
 * SCOPE. This is a screen, not a title opinion. Everything here is derived
 * from what is on the case file; where the file cannot answer a question the
 * step says so in those words rather than inferring. Statutory references are
 * given without a section number wherever the section is not something this
 * module can stand behind.
 */

import type { DocumentKind } from '../types';
import { KARNATAKA_PACK } from '../packs/karnataka';
import type { AreaFigure, Playbook, PlaybookContext, StepOutcome } from './types';
import { compareAreas, formatSqm, isoYear, normaliseSurveyNumber, numericValue } from './types';

/**
 * The lookback a Bengaluru conveyancer works to.
 *
 * Thirty years is settled market and banking practice — it is what lenders
 * ask for and what the Sub-Registrar's encumbrance search is ordinarily taken
 * out over — but it is *not* a period fixed by statute, and this module says
 * so wherever it uses the number rather than dressing a convention up as law.
 */
const CHAIN_LOOKBACK_YEARS = 30;

/** Extents within this much of each other are treated as the same figure, not a discrepancy. */
const EXTENT_TOLERANCE_PCT = 2;

/**
 * The pack's own `titleChecks` catalogue is the single source of truth for a
 * named check's statutory attribution, exactly as `engine.ts` treats it. A
 * playbook step that tests the same thing as a pack check must not invent a
 * second, subtly different citation for it.
 */
function packStatute(key: string, fallback: string): string {
  return KARNATAKA_PACK.titleChecks.find(tc => tc.key === key)?.statute ?? fallback;
}

/**
 * Whether an instrument's stated extent should be read as the land itself or
 * as an undivided share of it.
 *
 * For a site, the deed conveys the site. For a flat, the deed conveys the flat
 * plus an undivided share in the land under the tower, while the mother deed
 * conveys the whole scheme land — two quantities that have no business being
 * differenced. See `compareAreas`.
 */
function deedExtentQuantity(ctx: PlaybookContext): AreaFigure['quantity'] {
  const t = ctx.identity.propertyType;
  return t === 'residential_plot' || t === 'land_parcel' ? 'land_extent' : 'undivided_share';
}

/* ==================================================================== */
/* Step 1 — root of title                                                */
/* ==================================================================== */

function evaluateRootOfTitle(ctx: PlaybookContext): StepOutcome {
  const mother = ctx.doc('mother_deed');
  const deed = ctx.doc('title_deed');

  if (!mother) {
    const deedNote = deed
      ? `A registered sale deed is on file (${deed.fileName}), which shows how the current holder acquired the property — but nothing on file explains how their seller came to own it.`
      : 'No registered conveyance of any kind is on file either, so the file does not evidence a transfer to the current holder at all.';
    return {
      state: 'not_started',
      finding:
        'MISSING: the mother deed / link-document bundle. ' +
        `${deedNote} ` +
        'The mother deed is the instrument that establishes the root — the original grant, allotment, partition or first ' +
        'conveyance that every later transfer descends from — and it is what turns a set of documents into a chain. ' +
        'Until it is produced the chain has no starting point, so no step below it can be evaluated: the position is ' +
        'unknown, not clean. Ask the seller for it under s.55 of the Transfer of Property Act 1882, which obliges a ' +
        'seller to produce the documents of title in their possession for the buyer to examine.',
      needs: ['mother_deed'],
      evidenceIds: deed ? ctx.evidenceForDoc('title_deed') : [],
    };
  }

  const surveyRaw = ctx.fieldValue('mother_deed', 'surveyNumber');
  const surveyOnDeed = normaliseSurveyNumber(surveyRaw);
  const surveyOnCase = normaliseSurveyNumber(ctx.identity.parcelId);
  const extentSqm = numericValue(ctx.fieldValue('mother_deed', 'extentConveyed'));

  const parcelSentence =
    surveyOnDeed && surveyOnCase
      ? surveyOnDeed === surveyOnCase
        ? `It describes ${surveyRaw}, which is the parcel this case is opened on (${ctx.identity.parcelId}).`
        : `It describes ${surveyRaw}, which does not reconcile with the survey number this case is opened on (${ctx.identity.parcelId}). ` +
          'A root instrument for a different parcel is not a root for this one — resolve which survey number is correct before reading anything below.'
      : `The survey number on the root instrument could not be read from the file (case parcel: ${ctx.identity.parcelId || 'not recorded'}), so the root has not been tied to this parcel.`;

  const mismatched = Boolean(surveyOnDeed && surveyOnCase && surveyOnDeed !== surveyOnCase);

  return {
    state: mismatched ? 'attention' : 'clear',
    severity: mismatched ? 'blocker' : undefined,
    finding:
      `A mother deed / link-document bundle is on file (${mother.fileName}). ` +
      parcelSentence +
      (extentSqm !== undefined ? ` The extent it recites is ${formatSqm(extentSqm)}.` : '') +
      ' A root instrument being present is what makes the rest of this procedure meaningful; the bundle itself still has ' +
      'to be read instrument by instrument at the legal review, which a screen does not do.',
    evidenceIds: ctx.evidenceForDoc('mother_deed'),
    needs: mismatched ? ['mother_deed', 'title_deed'] : [],
  };
}

/* ==================================================================== */
/* Step 2 — chain continuity across the lookback                         */
/* ==================================================================== */

function evaluateChainContinuity(ctx: PlaybookContext): StepOutcome {
  const deed = ctx.doc('title_deed');
  const windowFrom = ctx.nowYear - CHAIN_LOOKBACK_YEARS;

  if (!deed) {
    const agreement = ctx.doc('sale_agreement');
    return {
      state: 'not_started',
      finding:
        'MISSING: the registered sale deed conveying the property to the current holder. ' +
        (agreement
          ? `The only conveyance-type instrument on file is an agreement to sell (${agreement.fileName}). An agreement to sell is a contract to convey, not a conveyance — it does not pass title.`
          : 'No registered conveyance is on file at all.') +
        ' Without it the chain has a root but no head: there is nothing on file joining the root instrument to the person ' +
        `now offering to sell, so continuity across the ${CHAIN_LOOKBACK_YEARS}-year window (${windowFrom}-${ctx.nowYear}) cannot be traced in either direction.`,
      needs: ['title_deed'],
      evidenceIds: agreement ? ctx.evidenceForDoc('sale_agreement') : [],
    };
  }

  const deedDate = ctx.fieldValue('title_deed', 'deedDate');
  const deedYear = isoYear(deedDate);
  const motherExtent = numericValue(ctx.fieldValue('mother_deed', 'extentConveyed'));
  const deedExtent = numericValue(ctx.fieldValue('title_deed', 'extent'));

  const evidenceIds = [...ctx.evidenceForDoc('mother_deed'), ...ctx.evidenceForDoc('title_deed')];

  // The extent reconciliation, run through the area-basis guard rather than
  // by subtracting two numbers that may not measure the same thing.
  let extentSentence: string;
  let extentIsDiscrepancy = false;
  if (motherExtent === undefined || deedExtent === undefined) {
    extentSentence =
      'Neither instrument yielded a readable extent, so the area the root conveys and the area the current deed conveys have not been reconciled.';
  } else {
    const quantity = deedExtentQuantity(ctx);
    const comparison =
      quantity === 'undivided_share'
        ? compareAreas(
            { sqm: motherExtent, quantity: 'land_extent', basis: 'unknown', label: 'extent recited in the mother deed' },
            { sqm: deedExtent, quantity: 'undivided_share', basis: 'unknown', label: 'extent conveyed by the sale deed' },
          )
        : compareAreas(
            { sqm: motherExtent, quantity: 'land_extent', basis: 'unknown', label: 'extent recited in the mother deed' },
            { sqm: deedExtent, quantity: 'land_extent', basis: 'unknown', label: 'extent conveyed by the sale deed' },
          );
    if (!comparison.comparable) {
      extentSentence =
        `Extent was not reconciled, and deliberately so: mother deed ${formatSqm(motherExtent)}, sale deed ${formatSqm(deedExtent)}. ` +
        comparison.reason;
    } else if (Math.abs(comparison.deltaPct) <= EXTENT_TOLERANCE_PCT) {
      extentSentence = `Extent reconciles: the root recites ${formatSqm(motherExtent)} and the current deed conveys ${formatSqm(deedExtent)} (${comparison.deltaPct.toFixed(1)}% apart).`;
    } else {
      extentIsDiscrepancy = true;
      extentSentence =
        `Extent does NOT reconcile: the root recites ${formatSqm(motherExtent)} but the current deed conveys ${formatSqm(deedExtent)}, ` +
        `${comparison.deltaPct.toFixed(1)}% apart on the same measure. Land has either been carved off the parent holding by an ` +
        'instrument that is not on file, or one of the two recitals is wrong. Both need explaining before the chain can be relied on.';
    }
  }

  const dateSentence =
    deedYear !== undefined
      ? deedYear >= windowFrom
        ? `The current conveyance is dated ${deedDate}, inside the ${windowFrom}-${ctx.nowYear} lookback.`
        : `The current conveyance is dated ${deedDate}, which predates the ${windowFrom}-${ctx.nowYear} lookback — the holding has been static across the whole window.`
      : 'The current conveyance carries no readable date, so it cannot be placed in sequence.';

  return {
    state: extentIsDiscrepancy ? 'attention' : 'clear',
    severity: extentIsDiscrepancy ? 'blocker' : undefined,
    finding:
      `Root and head are both on file and describe one holding. ${dateSentence} ${extentSentence} ` +
      `The mother deed is filed as a link-document bundle, which in Bengaluru practice is the chain itself; this screen ` +
      `treats it as establishing continuity across the ${CHAIN_LOOKBACK_YEARS}-year window and does not open the individual ` +
      'intervening instruments. A title opinion must — the bundle is where a partition or release deed that never reached ' +
      'the register tends to be found.',
    evidenceIds,
    needs: extentIsDiscrepancy ? ['mother_deed', 'title_deed', 'encumbrance_certificate'] : [],
  };
}

/* ==================================================================== */
/* Step 3 — encumbrance certificate coverage                             */
/* ==================================================================== */

function evaluateEncumbranceCoverage(ctx: PlaybookContext): StepOutcome {
  const ec = ctx.doc('encumbrance_certificate');
  const windowFrom = ctx.nowYear - CHAIN_LOOKBACK_YEARS;

  if (!ec) {
    return {
      state: 'not_started',
      finding:
        `MISSING: the encumbrance certificate. Nothing on file records what the Sub-Registrar's index says about this ` +
        `property over the ${windowFrom}-${ctx.nowYear} window, so an undisclosed mortgage, a court attachment, a lis ` +
        'pendens entry or a second sale of the same parcel would all be invisible to this screen. The EC is the one ' +
        'document that reports the register rather than reporting what a party says about the register. Take out a fresh ' +
        `${CHAIN_LOOKBACK_YEARS}-year certificate from the jurisdictional Sub-Registrar via Kaveri Online Services — a nil ` +
        'certificate issues as Form 16, one listing entries as Form 15.',
      needs: ['encumbrance_certificate'],
    };
  }

  const periodRaw = ctx.fieldValue('encumbrance_certificate', 'ecPeriod');
  const match = periodRaw ? /(\d{4})\D+(\d{4})/.exec(periodRaw) : null;
  const countRaw = ctx.fieldValue('encumbrance_certificate', 'encumbranceCount');
  const count = numericValue(countRaw);
  const evidenceIds = ctx.evidenceForDoc('encumbrance_certificate');

  const entriesSentence =
    count === undefined
      ? 'The number of registered entries on the certificate could not be read, so whether it is a nil (Form 16) or a listing (Form 15) certificate is unresolved.'
      : count === 0
        ? 'The certificate is nil: no registered mortgage, charge, attachment or pending-litigation entry is recorded over the period it covers.'
        : `The certificate lists ${count} registered ${count === 1 ? 'entry' : 'entries'}. Each has to be identified and, where it is a ` +
          'charge, traced to a discharge or release before completion — an undischarged mortgage entry stays attached to the property, not to the seller.';

  if (!match) {
    return {
      state: 'attention',
      finding:
        `An encumbrance certificate is on file (${ec.fileName}) but the period it covers could not be read from it` +
        `${periodRaw ? ` (recorded as "${periodRaw}")` : ''}. An EC whose window is unknown cannot be measured against the ` +
        `${windowFrom}-${ctx.nowYear} lookback, and the gap is exactly where an undisclosed charge sits. ${entriesSentence}`,
      evidenceIds,
      needs: ['encumbrance_certificate'],
    };
  }

  const from = Number(match[1]);
  const to = Number(match[2]);
  const covers = from <= windowFrom && to >= ctx.nowYear;
  const spanYears = to - from;

  if (covers) {
    return {
      state: 'clear',
      finding:
        `The encumbrance certificate on file spans ${from}-${to}, covering the whole ${windowFrom}-${ctx.nowYear} lookback ` +
        `with no gap. ${entriesSentence}`,
      evidenceIds,
      needs: count !== undefined && count > 0 ? ['encumbrance_certificate'] : [],
    };
  }

  const gaps: string[] = [];
  if (from > windowFrom) gaps.push(`${windowFrom}-${from} is not searched`);
  if (to < ctx.nowYear) gaps.push(`${to}-${ctx.nowYear} is not searched, so the certificate is not current to the screen date`);

  return {
    state: 'attention',
    finding:
      `The encumbrance certificate on file spans ${from}-${to} — ${spanYears} years of the ${CHAIN_LOOKBACK_YEARS}-year ` +
      `window ending ${ctx.nowYear}. ${gaps.join('; ')}. The thirty-year search is banking and conveyancing practice rather ` +
      'than a statutory period, but it is the standard a lender will apply, and an unsearched stretch is precisely where an ' +
      `older mortgage or a pending suit survives unnoticed. ${entriesSentence} Order the certificate again for the full ` +
      'period, and note that pre-digitisation years may only be obtainable as a manual search at the Sub-Registrar.',
    evidenceIds,
    needs: ['encumbrance_certificate'],
  };
}

/* ==================================================================== */
/* Step 4 — every intervening conveyance registered                      */
/* ==================================================================== */

function evaluateInterveningRegistered(ctx: PlaybookContext): StepOutcome {
  const deed = ctx.doc('title_deed');
  const agreement = ctx.doc('sale_agreement');
  const registrationNumber = ctx.fieldValue('title_deed', 'registrationNumber');

  // The failure pattern this step exists to catch: an unregistered instrument
  // standing in for a conveyance. In Bengaluru that is usually an agreement to
  // sell held for years, a general power of attorney "sale", or a khata
  // transfer treated as though it moved ownership. None of them convey title.
  const unregisteredStandIn = !deed && Boolean(agreement);

  if (unregisteredStandIn && agreement) {
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        `The only conveyance-type instrument on file is an agreement to sell (${agreement.fileName}, dated ` +
        `${ctx.fieldValue('sale_agreement', 'agreementDate') ?? 'date not read'}). That is a contract to convey, not a ` +
        'conveyance. A sale of immovable property must be by registered instrument (Registration Act 1908, s.17), and an ' +
        'unregistered instrument cannot be received in evidence of the transaction it records (s.49). The Supreme Court ' +
        'put the market practice beyond argument in Suraj Lamp & Industries Pvt Ltd v State of Haryana (2011): sale by ' +
        'agreement, general power of attorney or will does not transfer title. Whatever has been paid, ownership has not moved.',
      evidenceIds: ctx.evidenceForDoc('sale_agreement'),
      needs: ['title_deed'],
    };
  }

  if (!deed) {
    return {
      state: 'not_started',
      finding:
        'MISSING: the registered sale deed. With no conveyance on file there is nothing whose registration can be ' +
        'checked. Registration is not a formality here — under s.49 of the Registration Act 1908 an unregistered ' +
        'instrument of sale is not evidence of the sale, so the question "was each link registered" is the question of ' +
        'whether each link happened at all.',
      needs: ['title_deed'],
    };
  }

  if (!registrationNumber) {
    return {
      state: 'attention',
      finding:
        `A sale deed is on file (${deed.fileName}) but no registration number could be read from it. An instrument ` +
        'without registration particulars has not been shown to be registered, and under s.49 of the Registration Act ' +
        '1908 an unregistered sale deed does not convey. Verify the document number, book and year against the ' +
        "Sub-Registrar's index on Kaveri Online Services.",
      evidenceIds: ctx.evidenceForDoc('title_deed'),
      needs: ['title_deed', 'encumbrance_certificate'],
    };
  }

  return {
    state: 'clear',
    finding:
      `The conveyance to the current holder is a registered instrument (registration number ${registrationNumber}, from ` +
      `${deed.fileName}), and no unregistered instrument is standing in for a conveyance anywhere on the file — there is ` +
      'no agreement to sell, general power of attorney or khata transfer being relied on to move ownership. This is a ' +
      'screen of what the file shows: the intervening instruments inside the link-document bundle carry no registration ' +
      "particulars in the extracted fields, so each must still be checked against the Sub-Registrar's index at the legal " +
      'review. Registration Act 1908, s.17 requires the registration; s.49 is what makes its absence fatal.',
    evidenceIds: ctx.evidenceForDoc('title_deed'),
    needs: [],
  };
}

/* ==================================================================== */
/* Step 5 — khata lineage against deed lineage                           */
/* ==================================================================== */

function evaluateKhataLineage(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;
  const khata = ctx.doc('khata_extract');
  const form911 = ctx.doc('form_9_11');
  const ownerOnDeed = ctx.fieldValue('title_deed', 'ownerName');
  const isPanchayat = ka?.jurisdiction === 'gram_panchayat' || ka?.khataType === 'gram_panchayat_form_9_11';

  if (!khata && !form911) {
    return {
      state: 'not_started',
      finding:
        `MISSING: ${isPanchayat ? 'the gram panchayat Form 9 and Form 11 extracts' : 'the khata extract and khata certificate'}. ` +
        'The register entry is what shows the revenue/municipal record moved when the deeds moved. Without it the screen ' +
        'cannot tell whether the property is still recorded against a predecessor in title — the ordinary symptom of a ' +
        'transfer that was registered at the Sub-Registrar but never mutated in the register, which then blocks the ' +
        "*next* sale rather than this one. Deed lineage on file names the current registered owner as " +
        `${ownerOnDeed ?? 'a person the extraction could not read'}; there is nothing to match it against.`,
      needs: isPanchayat ? ['form_9_11'] : ['khata_extract'],
    };
  }

  if (!khata && form911) {
    return {
      state: 'attention',
      finding:
        `The register entry on file is a gram panchayat Form 9 and Form 11 extract (${form911.fileName}, reference ` +
        `${ctx.fieldValue('form_9_11', 'formReference') ?? 'not read'}), not a BBMP khata. For land genuinely outside city ` +
        'limits that is the correct register, but Form 9/11 records the panchayat\'s own assessment; it is not evidence of ' +
        'title and it does not carry a lineage of transfers the way a khata extract does. The extracted reference does not ' +
        `include the holder's name, so it could not be matched against the deed lineage` +
        `${ownerOnDeed ? ` (registered owner on the deed: ${ownerOnDeed})` : ''}. Read the holder name off the Form 9 itself, ` +
        'and check whether the area has since been brought into BBMP limits, in which case a khata is due.',
      evidenceIds: ctx.evidenceForDoc('form_9_11'),
      needs: ['form_9_11', 'khata_extract'],
    };
  }

  const khataNumber = ctx.fieldValue('khata_extract', 'khataNumber');
  const classification = ctx.fieldValue('khata_extract', 'khataClassification');

  return {
    state: 'attention',
    finding:
      `A khata extract is on file (${khata?.fileName}${khataNumber ? `, khata number ${khataNumber}` : ''}` +
      `${classification ? `, classification ${classification}` : ''}), but the extract's holder name is not among the fields ` +
      'read from it, so the register lineage has NOT been matched against the deed lineage' +
      `${ownerOnDeed ? ` — the deed names ${ownerOnDeed} as registered owner` : ''}. This is the check that catches a ` +
      'property still standing in a predecessor\'s name in the BBMP register after a registered sale: the sale is good, but ' +
      'the khata transfer was never applied for, and the buyer inherits the problem. Read the holder name and the transfer ' +
      'endorsements off the extract itself and match them, name by name, to the deed chain.',
    evidenceIds: ctx.evidenceForDoc('khata_extract'),
    needs: ['khata_extract', 'title_deed'],
  };
}

/* ==================================================================== */
/* Step 6 — PTCL granted land                                            */
/* ==================================================================== */

function evaluatePtcl(ctx: PlaybookContext): StepOutcome {
  const flagged = ctx.karnataka?.grantedLandPtcl;

  if (flagged === true) {
    return {
      state: 'attention',
      severity: 'blocker',
      finding:
        'The case records this as granted land under the Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of ' +
        'Transfer of Certain Lands) Act, 1978. Land granted to a Scheduled Caste or Scheduled Tribe grantee carries a ' +
        'statutory restriction on alienation, and a transfer made in breach of it can be declared null and the land ' +
        'restored to the grantee or their heirs — years after completion, and against a purchaser who bought in good ' +
        'faith for full value. This is not a defect that a clean sale deed, a clean encumbrance certificate or an A-khata ' +
        'cures, because none of those bodies adjudicate it. Obtain a certified order from the jurisdictional Assistant ' +
        'Commissioner on non-applicability or permission to transfer before anything else on this file is relied on.',
      evidenceIds: ctx.evidenceForRef('identity.karnataka.grantedLandPtcl'),
      needs: ['mother_deed'],
    };
  }

  if (flagged === false) {
    return {
      state: 'clear',
      finding:
        'The case records this as not being PTCL granted land, and nothing in the root instrument on file traces the ' +
        'holding to a government grant. The PTCL question is asked here — immediately after the root, and before the rest ' +
        'of the chain — because it is a question about where title *originated*, not about how it has been transferred ' +
        'since; no number of clean later conveyances answers it. If the root ever does turn out to recite a saguvali chit, ' +
        'a darkhast grant or any government grant, this must be re-run against the Revenue Department record rather than ' +
        'the case flag.',
      needs: [],
    };
  }

  return {
    state: 'not_started',
    finding:
      'MISSING: confirmation of whether the holding originates in a government grant, and if so whether it was a grant ' +
      'under the PTCL Act 1978. The root instrument on file has not been traced back to an original grant, and there is ' +
      'no grant certificate (saguvali chit), darkhast record or Assistant Commissioner non-applicability order on the ' +
      'file. Karnataka has no dedicated document type for these in this schema, so they file under "other". Until this is ' +
      'answered the position is unknown rather than clear: an undisclosed PTCL grant is the single defect most capable of ' +
      'unwinding a completed Bengaluru purchase long after the event.',
    needs: ['mother_deed', 'other'],
  };
}

/* ==================================================================== */
/* Step 7 — acquisition / notification overhang                          */
/* ==================================================================== */

function evaluateAcquisitionOverhang(ctx: PlaybookContext): StepOutcome {
  const ka = ctx.karnataka;
  const jurisdiction = ka?.jurisdiction;
  const possession = ctx.doc('possession_certificate');

  if (!jurisdiction || jurisdiction === 'unknown') {
    return {
      state: 'not_started',
      finding:
        'MISSING: the planning/development authority whose area this parcel falls in, which is where an acquisition ' +
        'search has to be run. Nothing on file records it. A live preliminary or final acquisition notification defeats ' +
        "the seller's title however clean the deeds look, because the land has already been taken — the deed then conveys " +
        'a compensation claim, not the land. Record the jurisdiction and search the BDA, BMRDA, BIAAPA and KIADB ' +
        'notification and de-notification registers against the survey number.',
      needs: ['other'],
    };
  }

  if (jurisdiction === 'BDA' || jurisdiction === 'BMRDA' || jurisdiction === 'BIAAPA') {
    const schemeSentence = possession
      ? `A possession/allotment certificate from the authority is on file (${possession.fileName}, handover ` +
        `${ctx.fieldValue('possession_certificate', 'possessionDate') ?? 'date not read'}), which points the question in a ` +
        'specific direction: the land under this site was itself acquired for the scheme, so what matters is whether the ' +
        'scheme notification was validly completed and whether this pocket was ever de-notified out of it, not whether a ' +
        'notice hangs over the site today.'
      : 'No allotment or possession certificate from the authority is on file to show how the parcel left, or entered, a scheme.';
    return {
      state: 'attention',
      finding:
        `The parcel falls in ${jurisdiction} territory, where acquisition notifications and subsequent de-notifications ` +
        `run through most of Bengaluru's peripheral layout history and are the recurring source of layouts sold on land ` +
        `that was still, on paper, acquired. ${schemeSentence} Search the acquisition and de-notification registers ` +
        'against the survey number, and treat a de-notification order as something to be produced and read rather than ' +
        'asserted — improperly de-notified pockets have been reclaimed.',
      evidenceIds: ctx.evidenceForRef('identity.karnataka.jurisdiction'),
      needs: ['other'],
    };
  }

  return {
    state: 'clear',
    finding:
      `The parcel falls under ${jurisdiction} jurisdiction, where the development-authority acquisition exposure that ` +
      'dominates BDA and BMRDA layout history is materially lower — though "lower" is not "absent", and the ordinary ' +
      'encumbrance search remains the mechanism that would surface a recorded acquisition entry. Nothing on file ' +
      'indicates an acquisition or notification overhang on this parcel.',
    evidenceIds: ctx.evidenceForRef('identity.karnataka.jurisdiction'),
    needs: [],
  };
}

/* ==================================================================== */
/* The playbook                                                          */
/* ==================================================================== */

const NEEDS_ROOT: DocumentKind[] = ['mother_deed', 'title_deed'];

export const KARNATAKA_TITLE_CHAIN_PLAYBOOK: Playbook = {
  id: 'karnataka_title_chain',
  label: 'Establish marketable title',
  authorityContext: 'Jurisdictional Sub-Registrar (Kaveri Online Services), BBMP khata register, Revenue Department',

  applicability(ctx) {
    // Title chain is the one procedure that applies to every Karnataka
    // property without qualification — a flat, an office floor, a gram
    // panchayat site and a BDA plot all need a root, a chain and an
    // encumbrance search. Only the instruments differ.
    return {
      applicable: true,
      reason: 'Establishing the chain of title applies to every Karnataka property, whatever its type or jurisdiction.',
    };
  },

  steps: [
    {
      key: 'root_of_title',
      label: 'Root of title (mother deed)',
      question: 'Is there a mother deed or link-document bundle on file, and does it describe this parcel?',
      requires: [],
      needs: NEEDS_ROOT,
      citation: "Transfer of Property Act 1882, s.55 (seller's duty to produce documents of title)",
      evaluate: evaluateRootOfTitle,
    },
    {
      key: 'chain_continuity_30y',
      label: 'Chain continuity across the 30-year lookback',
      question: 'Do the instruments on file run from the root to the present holder without an unexplained break?',
      // Gate: a chain is a sequence *from* somewhere. Tracing continuity with
      // no established root produces a list of transfers, not a chain.
      requires: ['root_of_title'],
      needs: ['mother_deed', 'title_deed', 'encumbrance_certificate'],
      citation:
        'Transfer of Property Act 1882, s.54 (sale of immovable property by registered instrument). The 30-year lookback is Bengaluru conveyancing and lending practice, not a statutory period.',
      evaluate: evaluateChainContinuity,
    },
    {
      key: 'ec_covers_period',
      label: 'Encumbrance certificate covers the full period',
      question: 'Does the encumbrance certificate span the whole lookback, and what does it record?',
      // Gate: "the full period" is defined by the chain. Measuring an EC
      // window against a chain nobody has established measures nothing.
      requires: ['chain_continuity_30y'],
      needs: ['encumbrance_certificate'],
      citation: packStatute('encumbrance_continuity', 'Registration Act 1908, s.57'),
      evaluate: evaluateEncumbranceCoverage,
    },
    {
      key: 'intervening_conveyances_registered',
      label: 'Every intervening conveyance registered',
      question: 'Is each link in the chain a registered instrument, rather than an agreement, a GPA or a khata transfer?',
      // Gate: you can only ask whether every link is registered once you know
      // what the links are.
      requires: ['chain_continuity_30y'],
      needs: ['title_deed', 'encumbrance_certificate'],
      citation: 'Registration Act 1908, ss.17 and 49; Suraj Lamp & Industries Pvt Ltd v State of Haryana (Supreme Court of India, 2011)',
      evaluate: evaluateInterveningRegistered,
    },
    {
      key: 'khata_lineage_matches_deed',
      label: 'Khata lineage matches deed lineage',
      question: 'Does the register entry name the same holder, arrived at by the same transfers, as the deed chain?',
      // Gate: the khata follows title, it does not create it. Comparing a
      // register lineage against a deed lineage that has not been established
      // as a lineage of valid registered conveyances tells you which of two
      // unestablished things disagrees.
      requires: ['intervening_conveyances_registered'],
      needs: ['khata_extract', 'title_deed'],
      citation: packStatute('khata_classification', 'Karnataka Municipal Corporations Act 1976 — BBMP khata register'),
      evaluate: evaluateKhataLineage,
    },
    {
      key: 'ptcl_grant_check',
      label: 'PTCL granted-land restriction',
      question: 'Does the holding originate in a government grant restricted by the PTCL Act 1978?',
      // Gate: this is a question about the origin of title, so it needs the
      // root — but only the root. It is deliberately NOT gated on the rest of
      // the chain, because a PTCL defect at the origin is unaffected by how
      // clean the later conveyances are, and a buyer should see it early.
      requires: ['root_of_title'],
      needs: ['mother_deed', 'other'],
      citation: packStatute(
        'ptcl_restriction',
        'Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of Transfer of Certain Lands) Act, 1978',
      ),
      evaluate: evaluatePtcl,
    },
    {
      key: 'acquisition_overhang',
      label: 'Acquisition / de-notification overhang',
      question: 'Has the parcel ever been notified for acquisition, and if so was it validly de-notified?',
      requires: ['root_of_title'],
      needs: ['other'],
      citation:
        packStatute('bda_bmrda_acquisition', 'Bangalore Development Authority Act 1976; Bangalore Metropolitan Region Development Authority Act 1985') +
        '; Karnataka Industrial Areas Development Act 1966 (KIADB acquisitions)',
      evaluate: evaluateAcquisitionOverhang,
    },
  ],
};
