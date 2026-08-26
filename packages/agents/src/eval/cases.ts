import type {
  CaseDocument,
  CreateCaseRequest,
  DocumentKind,
  EvalCase,
  EvalExpectation,
  EvalTaskKind,
  ExtractedField,
  PropertyIdentity,
} from '@valytica/shared';
import { SEED_CASES, SEED_DOCUMENT_FILENAMES, classifyDocument, extractFields } from '@valytica/shared';
import type { EvalAnswer } from './score';

/**
 * The evaluation corpus: what each route is actually asked to do.
 *
 * Two kinds of case live here, and the difference between them is the whole
 * argument for this file existing.
 *
 * **Derived cases** are generated, not hand-labelled. `extractFields` in
 * `packages/shared/src/engine.ts` is a deterministic function from (document,
 * identity, seed) to the fields that document should yield. That makes it a
 * ground truth we can generate against: feed it a synthetic khata extract and
 * it says, without ambiguity or opinion, that the khata number is `K/4127/2025`
 * and the assessed area is `145.0`. So the corpus can grow with the seeded
 * demo data at no labelling cost, and it cannot drift away from what the rest
 * of the product believes a document contains — if the engine's idea of a
 * khata extract changes, every expectation changes with it in the same commit.
 *
 * **Adversarial cases** are written by hand, and have to be. The question
 * they ask is not "did you read the number correctly" but "did you invent a
 * number that is not there". Which absent field is a *plausible* invention is
 * a judgement no generator has: that a gram panchayat Form 9/11 has no BBMP
 * khata number is a fact about Karnataka, and that a fluent model asked for
 * one will produce one anyway is a fact about fluent models. Both have to be
 * known by whoever writes the case. Generating absences mechanically — every
 * key the engine does not emit for that document kind — would produce mostly
 * nonsense ("this khata extract has no Dutch WOZ value") and would bury the
 * handful of absences that a model genuinely reaches for.
 *
 * --- The one bug this file must not have ------------------------------
 *
 * The ground truth must never reach the model. `caseDocumentForInput` strips
 * `extracted` before the document goes into `EvalCase.input`: an eval whose
 * prompt contains the answers measures nothing and reports 1.0 while doing it.
 * Every construction path here goes through that function.
 *
 * --- Why the corpus timestamp is injected ------------------------------
 *
 * `extractFields` derives dates and reference numbers from the document's own
 * `uploadedAt` year, so the expected khata number for the same seeded case is
 * different in 2025 and 2026. That is fine — it is still deterministic — but
 * it means a stored comparison is only meaningful against results from a
 * corpus built at the same timestamp. Rather than leave that as a rule nobody
 * enforces, the timestamp is stamped into every derived case id. Two corpora
 * built a year apart produce disjoint id sets, so a stale result set cannot
 * silently be compared against a fresh one; it shows up as skipped cases.
 *
 * Pin the timestamp in configuration. Passing wall clock works and stays
 * deterministic within a run, but it re-bases the corpus every midnight.
 */

/* ==================================================================== */
/* Corpus construction                                                   */
/* ==================================================================== */

/**
 * A case paired with the answer a flawless model would give.
 *
 * The ground truth never reaches a model — it is not in `EvalCase.input` and
 * cannot be recovered from it. It exists because a scorer that has never been
 * shown to score a known-perfect answer as 1.0 is not a scorer anyone should
 * trust, and because a stub executor built by deliberately degrading the truth
 * is a far better test than one built by hand-writing plausible answers, which
 * only ever tests the cases whoever wrote them thought of.
 */
export interface EvalCaseWithTruth {
  evalCase: EvalCase;
  groundTruth: EvalAnswer;
}

export interface EvalCorpusParams {
  /**
   * The notional upload date the synthetic documents carry, ISO-8601.
   *
   * Injected rather than read from the clock, for the reason every other
   * module in this codebase injects `now`: a harness whose corpus changes
   * between two identical invocations cannot settle an argument.
   */
  now: string;
  /** Seeded cases to derive from. Defaults to the whole demo corpus. */
  seedCases?: CreateCaseRequest[];
}

/**
 * A default corpus timestamp, for callers with nothing better to pin.
 *
 * Chosen as a fixed past date rather than "today" so that the derived
 * expectations, and therefore the case ids, are stable for as long as this
 * constant is.
 */
export const DEFAULT_EVAL_CORPUS_AT = '2025-06-01T00:00:00.000Z';

/** Areas drift under OCR; a millimetre of disagreement is not an error. */
const AREA_TOLERANCE = 0.02;

/**
 * Money is quoted exactly on a receipt, so the tolerance exists only to
 * absorb rounding and digit-grouping, not to forgive a misread digit.
 */
const MONEY_TOLERANCE = 0.005;

/** Keys whose value is a quantity that OCR can legitimately blur. */
const AREA_KEYS = new Set(['extent', 'extentConveyed', 'assessedArea', 'drawnArea', 'perceelOppervlakte']);

/** Keys whose value is an amount of money. */
const MONEY_KEYS = new Set(['agreedPrice', 'annualTax', 'annualRent', 'wozValue', 'bettermentAmount']);

/**
 * Keys whose value is a structured reference — a khata number, a DC order
 * number, a K-RERA registration.
 *
 * These are matched by regex, and the regex is built from the true value with
 * only the *rendering* relaxed: whitespace around separators, an optional
 * "Khata No.:" style label, case. The digits themselves stay mandatory. A
 * pattern that generalised the digits too — `^K/\d{4}/\d{4}$` — would accept
 * any well-shaped invention, which is precisely the failure this harness
 * exists to catch.
 */
const REFERENCE_KEYS = new Set([
  'khataNumber',
  'registrationNumber',
  'sasApplicationNumber',
  'ocNumber',
  'ccNumber',
  'sanctionNumber',
  'formReference',
  'conversionOrderNumber',
  'reraNumber',
]);

/**
 * Keys whose true value carries boilerplate the model is not obliged to
 * repeat. "Survey No. 42/3, Whitefield" and "Sy. No. 42/3" are the same
 * answer; only the identifying token has to be present.
 */
const TOKEN_KEYS = new Set(['surveyNumber', 'kadastraalAanduiding']);

/** Keys whose value is a name or an institution, where a prefix is not an error. */
const NAME_KEYS = new Set(['ownerName', 'tenantName', 'valuerName', 'approvalAuthority']);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** `2025-06-01T00:00:00.000Z` -> `20250601`. Stamped into derived case ids. */
function corpusStamp(now: string): string {
  return now.slice(0, 10).replace(/-/g, '');
}

function mimeTypeFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/**
 * A synthetic `CaseDocument`, exactly as `seedDemoData` would materialise it.
 *
 * `sizeBytes` and `pages` are fixed rather than randomised. The demo seeder
 * randomises them for texture; nothing in classification or extraction reads
 * them, so here they would buy nothing and cost determinism.
 */
function synthesiseDocument(params: {
  caseSlug: string;
  index: number;
  fileName: string;
  now: string;
  /** Declared rather than classified, for adversarial documents — see `buildAdversarialAbsenceCases`. */
  kind?: DocumentKind;
}): CaseDocument {
  const mimeType = mimeTypeFor(params.fileName);
  const classification = classifyDocument(params.fileName, mimeType);
  return {
    id: `${params.caseSlug}-doc-${params.index + 1}`,
    caseId: `eval-${params.caseSlug}`,
    fileName: params.fileName,
    mimeType,
    sizeBytes: 480_000,
    uploadedAt: params.now,
    kind: params.kind ?? classification.kind,
    classificationConfidence: classification.confidence,
    kindConfirmedByUser: params.kind !== undefined,
    pages: 4,
    ocrStatus: 'complete',
    extracted: [],
  };
}

/**
 * The document as the model sees it: everything except the answers.
 *
 * Kept as its own function so there is exactly one place where a document
 * crosses into `EvalCase.input`, and no path that forgets to strip
 * `extracted`.
 */
function caseDocumentForInput(document: CaseDocument): CaseDocument {
  return { ...document, extracted: [] };
}

/* ==================================================================== */
/* Expectations derived from the engine                                  */
/* ==================================================================== */

/**
 * A regex accepting the true value however it is rendered.
 *
 * Whitespace becomes flexible, separators may be padded, and an optional
 * label prefix ("Khata No.:", "Order Number -") is tolerated. Everything else,
 * digits included, is required verbatim.
 */
function referencePattern(value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped
    .replace(/\s+/g, '\\s+')
    .replace(/([/&-])/g, '\\s*$1\\s*')
    // Padding a separator that already had a space beside it leaves `\s+\s*`,
    // which still demands the space. Collapsing the run to `\s*` is what makes
    // "Form 9 & 11/575/2025" and "Form 9&11/575/2025" the same answer.
    .replace(/(?:\\s[+*]){2,}/g, '\\s*');
  return `^(?:[a-z. ]{0,24}(?:no\\.?|number|reference|ref\\.?|id)\\s*[:.\\-]?\\s*)?${flexible}$`;
}

/**
 * The identifying token inside a boilerplate-carrying value.
 *
 * "Survey No. 42/3, Whitefield" -> "42/3". Falls back to the whole value when
 * there is no recognisable token, which keeps the expectation strict rather
 * than accidentally lenient.
 */
function identifyingToken(value: string): string {
  const surveyLike = value.match(/(\d+\s*\/\s*\d+[A-Za-z]?)/);
  if (surveyLike) return surveyLike[1].replace(/\s+/g, '');
  const trailingNumber = value.match(/([A-Z]{2,4}\s*\d{3,})/);
  if (trailingNumber) return trailingNumber[1];
  return value;
}

/**
 * One expectation per extracted field, with the match kind the field's own
 * semantics call for.
 *
 * The default is `exact`. An unrecognised key is scored strictly rather than
 * loosely on purpose: a new extraction key added to the engine should show up
 * as a hard expectation that someone has to look at, not as a soft one that
 * quietly passes.
 */
export function expectationForField(field: ExtractedField): EvalExpectation {
  const { key, value } = field;
  if (AREA_KEYS.has(key)) return { key, expected: value, match: 'numeric', tolerance: AREA_TOLERANCE };
  if (MONEY_KEYS.has(key)) return { key, expected: value, match: 'numeric', tolerance: MONEY_TOLERANCE };
  if (key === 'approvedFar') return { key, expected: value, match: 'numeric', tolerance: AREA_TOLERANCE };
  // A count is a small integer read off a list. There is no tolerance to give:
  // "one encumbrance" and "two encumbrances" are different findings, and the
  // difference is the entire point of an encumbrance certificate.
  if (key === 'encumbranceCount') return { key, expected: value, match: 'numeric', tolerance: 0 };
  if (REFERENCE_KEYS.has(key)) return { key, expected: referencePattern(value), match: 'regex' };
  if (TOKEN_KEYS.has(key)) return { key, expected: identifyingToken(value), match: 'contains' };
  if (NAME_KEYS.has(key)) return { key, expected: value, match: 'contains' };
  return { key, expected: value, match: 'exact' };
}

/* ==================================================================== */
/* document_extraction: derived from the seeded corpus                   */
/* ==================================================================== */

function documentExtractionCase(params: {
  identity: PropertyIdentity;
  caseSlug: string;
  document: CaseDocument;
  fields: ExtractedField[];
  now: string;
  idPrefix: string;
  label: string;
  extraExpectations?: EvalExpectation[];
}): EvalCaseWithTruth {
  const expectations = [...params.fields.map(expectationForField), ...(params.extraExpectations ?? [])];
  const evalCase: EvalCase = {
    id: `${params.idPrefix}:${params.document.id}:${corpusStamp(params.now)}`,
    kind: 'document_extraction',
    label: params.label,
    input: {
      document: caseDocumentForInput(params.document),
      identity: params.identity,
      /**
       * The fields the model is asked for.
       *
       * This is load-bearing for the adversarial cases: a fabrication only
       * happens when the field is asked for, so an extractor that is never
       * asked about a conversion order number is never tested for inventing
       * one. Sorted alphabetically so the absent keys are not clustered at the
       * end, where their position alone would give the game away.
       */
      requestedKeys: expectations.map(e => e.key).sort(),
      corpusAt: params.now,
    },
    expectations,
  };
  // The absent keys are deliberately missing from the ground truth rather than
  // present and empty: a flawless model says nothing about them, and that is
  // what the scorer must see.
  const groundTruth: EvalAnswer = {};
  for (const field of params.fields) groundTruth[field.key] = field.value;
  return { evalCase, groundTruth };
}

/**
 * One case per seeded document that the engine can extract anything from.
 *
 * Documents that yield no fields (a photograph, an unclassified file) produce
 * no case: there is nothing to be right or wrong about, and a case with no
 * expectations would be scored as a vacuous success by anything that got hold
 * of it.
 */
export function buildDocumentExtractionCases(params: EvalCorpusParams): EvalCase[] {
  return documentExtractionCasesWithTruth(params).map(entry => entry.evalCase);
}

function documentExtractionCasesWithTruth(params: EvalCorpusParams): EvalCaseWithTruth[] {
  const seeds = params.seedCases ?? SEED_CASES;
  const cases: EvalCaseWithTruth[] = [];

  for (const seed of seeds) {
    const identity = seed.identity;
    const caseSlug = slugify(identity.label);
    const fileNames = SEED_DOCUMENT_FILENAMES[identity.label] ?? [];

    fileNames.forEach((fileName, index) => {
      const document = synthesiseDocument({ caseSlug, index, fileName, now: params.now });
      const fields = extractFields(document, identity, `eval:${caseSlug}`);
      if (fields.length === 0) return;
      cases.push(
        documentExtractionCase({
          identity,
          caseSlug,
          document,
          fields,
          now: params.now,
          idPrefix: 'extract',
          label: `${document.kind} — ${fileName} (${identity.locality})`,
        }),
      );
    });
  }

  return cases;
}

/* ==================================================================== */
/* document_extraction: hand-written absence cases                       */
/* ==================================================================== */

interface AbsenceSpec {
  id: string;
  label: string;
  /** Which seeded case supplies the property identity. Matched on `identity.label`. */
  seedLabel: string;
  fileName: string;
  /**
   * Declared, not classified.
   *
   * These cases are about what a document of a given kind does not contain,
   * so the kind must not depend on a filename heuristic continuing to
   * classify the way it does today. A classifier change should break the
   * derived cases (correctly — the demo corpus changed) without silently
   * re-pointing an adversarial case at a different document.
   */
  kind: DocumentKind;
  /** Keys this document genuinely does not contain, and which a model reaches for anyway. */
  absentKeys: string[];
}

/**
 * The cases this harness exists for.
 *
 * Each names fields the document genuinely does not contain — chosen because
 * they are the ones a fluent model will supply on request, not because they
 * are merely absent. Every one of these is paired with the document's real
 * derived expectations, so answering "not stated" to everything scores badly:
 * the point is to separate a model that knows what is not there from one that
 * has stopped reading, and refusal is not knowledge either.
 */
const ABSENCE_SPECS: AbsenceSpec[] = [
  {
    id: 'khata-extract-invents-conversion-and-survey',
    label: 'Khata extract — no DC conversion order, no revenue survey number',
    seedLabel: '3BHK — Prestige Lakeside Habitat, Whitefield',
    fileName: 'Khata_Extract_2025.pdf',
    kind: 'khata_extract',
    absentKeys: [
      // A khata extract is a BBMP register entry. The conversion order is a
      // Deputy Commissioner's instrument and lives on its own paper; a khata
      // number is not evidence that conversion ever happened, and a model
      // that supplies an order number here has manufactured the single fact
      // an unconverted-land buyer most needs to check.
      'conversionOrderNumber',
      // BBMP identifies the property by PID, not by revenue survey number.
      'surveyNumber',
      // A residential khata extract carries no RERA registration.
      'reraNumber',
      'encumbranceCount',
    ],
  },
  {
    id: 'lease-invents-survey-and-khata',
    label: 'Lease agreement — no survey number, no khata, no occupancy certificate',
    seedLabel: 'Leasehold office floor — Vertex Panache IT Park, Bellandur',
    fileName: 'Lease_Agreement_IT_Tenant.pdf',
    kind: 'lease_agreement',
    absentKeys: [
      // A lease is between landlord and tenant over a demised premises. It
      // identifies the floor, not the parcel; the survey number is the most
      // commonly hallucinated field on this document kind because every other
      // property paper in the bundle has one.
      'surveyNumber',
      'khataNumber',
      'ocNumber',
    ],
  },
  {
    id: 'form-9-11-invents-bbmp-khata',
    label: 'Gram panchayat Form 9/11 — not a BBMP khata, and not a conversion order',
    seedLabel: 'Residential site — Site No. 42, Sri Ranga Layout, off Sarjapur Road',
    fileName: 'Form_9_11_GramPanchayat_SriRanga.pdf',
    kind: 'form_9_11',
    absentKeys: [
      // The single most consequential conflation in a Bengaluru screen. Form 9
      // is a panchayat register entry for a property outside BBMP limits;
      // reporting it as a khata number tells a buyer they hold municipal
      // title when they hold nothing of the kind.
      'khataNumber',
      // This site is explicitly unconverted agricultural land. An order number
      // here invents the exact fact that decides whether it is buildable.
      'conversionOrderNumber',
      // SAS is the BBMP self-assessment scheme; a panchayat property has no
      // SAS application number to quote.
      'sasApplicationNumber',
    ],
  },
  {
    id: 'ec-invents-area-and-tax',
    label: 'Encumbrance certificate — a transaction index, not a property description',
    seedLabel: '3BHK — Prestige Lakeside Habitat, Whitefield',
    fileName: 'EC_2010_2025_Whitefield.pdf',
    kind: 'encumbrance_certificate',
    absentKeys: [
      // An EC lists registered transactions over a window. It states no
      // assessed area, no tax and no khata classification — but it sits next
      // to documents that do, and a model summarising the bundle will borrow.
      'assessedArea',
      'annualTax',
      'khataClassification',
    ],
  },
  {
    id: 'mother-deed-invents-rera',
    label: 'Mother deed (1998–2020 links) — RERA post-dates it by two decades',
    seedLabel: '3BHK — Prestige Lakeside Habitat, Whitefield',
    fileName: 'Mother_Deed_Link_Documents_1998_2020.pdf',
    kind: 'mother_deed',
    absentKeys: [
      // RERA came into force in 2016. A K-RERA number on a 1998 link document
      // is an anachronism, which is exactly the sort of thing a fluent model
      // produces without noticing, because the number *looks* right.
      'reraNumber',
      'ocNumber',
      'khataNumber',
    ],
  },
  {
    id: 'kadaster-invents-karnataka-fields',
    label: 'Kadaster extract (Amsterdam) — no Karnataka fields exist on it at all',
    seedLabel: 'Grade-A office floor — WTC Tower H, Zuidas',
    fileName: 'Kadaster_Uittreksel_2025.pdf',
    kind: 'kadaster_extract',
    absentKeys: [
      // Cross-jurisdiction fabrication: "land registry extract" pattern-matches
      // onto khata for a model that has read more Indian property text than
      // Dutch. Being wrong across a border is the easiest kind of confident
      // wrong to detect, and a route that fails here will fail subtler ones.
      'khataNumber',
      'surveyNumber',
      'bbmpZone',
    ],
  },
  {
    id: 'tax-receipt-invents-approvals',
    label: 'Property tax receipt — payment proof, not planning approval',
    seedLabel: 'Residential site — Site No. 118, Nadaprabhu Kempegowda Layout, Devanahalli',
    fileName: 'Property_Tax_Receipt_2025-26_Devanahalli.pdf',
    kind: 'property_tax_receipt',
    absentKeys: [
      // Tax paid is not tax assessed lawfully, and neither is an approval.
      // BBMP will accept tax on an unauthorised structure; a receipt that
      // yielded an OC number or an approved FAR would let a buyer conclude
      // the opposite.
      'ocNumber',
      'approvedFar',
      'sanctionNumber',
    ],
  },
];

/** `expected` shown for an absence. The correct answer is no answer. */
export const ABSENT_EXPECTED = '';

function absenceExpectation(key: string): EvalExpectation {
  // `match` is unused for an absence — nothing is compared, only answered-or-not
  // — but the contract requires it, so `exact` is recorded as the honest no-op.
  return { key, expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true };
}

export function buildAdversarialAbsenceCases(params: EvalCorpusParams): EvalCase[] {
  return adversarialAbsenceCasesWithTruth(params).map(entry => entry.evalCase);
}

function adversarialAbsenceCasesWithTruth(params: EvalCorpusParams): EvalCaseWithTruth[] {
  const seeds = params.seedCases ?? SEED_CASES;
  const byLabel = new Map(seeds.map(seed => [seed.identity.label, seed.identity]));
  const cases: EvalCaseWithTruth[] = [];

  ABSENCE_SPECS.forEach((spec, index) => {
    const identity = byLabel.get(spec.seedLabel);
    // A spec pointing at a seeded case that no longer exists is a bug in this
    // file, not a reason to run a smaller eval. It is dropped rather than
    // thrown so that a corpus edit cannot take the API down, and the drop is
    // visible as a shrunken adversarial count — which is what the harness
    // prints first.
    if (!identity) return;

    const caseSlug = slugify(identity.label);
    const document = synthesiseDocument({
      caseSlug,
      // Offset past the derived documents so an adversarial document never
      // collides with a derived one on id — the id seeds extraction, and two
      // documents sharing one would silently share their field values too.
      index: 1000 + index,
      fileName: spec.fileName,
      now: params.now,
      kind: spec.kind,
    });
    const fields = extractFields(document, identity, `eval:${caseSlug}`);

    cases.push(
      documentExtractionCase({
        identity,
        caseSlug,
        document,
        fields,
        now: params.now,
        idPrefix: `absent:${spec.id}`,
        label: spec.label,
        extraExpectations: spec.absentKeys.map(absenceExpectation),
      }),
    );
  });

  return cases;
}

/* ==================================================================== */
/* The other task kinds                                                  */
/* ==================================================================== */

/**
 * Grounding cases: is the claim supported by the evidence supplied?
 *
 * Shaped for the critic (`agents/critic.ts`), whose entire posture is that
 * finding nothing wrong is a failure of the check. So these cases are
 * weighted towards claims that should come back unsupported, and each one
 * carries an absence: a critic that invents a corroborating source id or a
 * statutory citation while rejecting a claim has reproduced the failure it
 * was hired to catch. One case is genuinely supported, because a critic that
 * flags everything is as useless as one that flags nothing and only a case
 * like that can tell them apart.
 */
function groundingCasesWithTruth(): EvalCaseWithTruth[] {
  return [
    {
      evalCase: {
        id: 'grounding:fee-not-in-corpus',
        kind: 'grounding',
        label: 'A precise khata-transfer fee that the corpus does not state',
        input: {
          claim:
            'BBMP charges a khata transfer fee of exactly 2% of the stamp duty paid, payable online at the time of application.',
          evidence: [
            {
              id: 'ev-corpus-khata-transfer',
              label: 'Karnataka proof-routes corpus — khata transfer',
              detail:
                'Khata transfer is applied for at the jurisdictional BBMP zonal Revenue Office as a Sakala-notified service. The corpus records no fee figure and no percentage.',
            },
          ],
          statePackId: 'karnataka',
        },
        expectations: [
          { key: 'verdict', expected: 'unsupported', match: 'exact' },
          { key: 'unsupportedSpecifics', expected: '2%', match: 'contains' },
          // The critic must say the figure is unsupported, not supply a
          // different figure. A corrected fee is still a fabricated fee.
          { key: 'correctedFeeInr', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'sakalaServiceCode', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        verdict: 'unsupported',
        unsupportedSpecifics: ['the 2% of stamp duty figure', 'that the fee is payable online'],
      },
    },
    {
      evalCase: {
        id: 'grounding:supported-portal-claim',
        kind: 'grounding',
        label: 'A portal claim the corpus does state, verbatim',
        input: {
          claim: 'An encumbrance certificate can be applied for online through Kaveri Online Services.',
          evidence: [
            {
              id: 'ev-corpus-ec-online',
              label: 'Karnataka proof-routes corpus — encumbrance certificate',
              detail:
                'Route ec_kaveri_online: authority "Sub-Registrar, via Kaveri Online Services", portal kaverionline.karnataka.gov.in, Form 22 application, EC issued as Form 15 or Form 16.',
            },
          ],
          statePackId: 'karnataka',
        },
        expectations: [
          { key: 'verdict', expected: 'supported', match: 'exact' },
          { key: 'checkedAgainst', expected: 'ec_kaveri_online', match: 'contains' },
          { key: 'unsupportedSpecifics', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        verdict: 'supported',
        checkedAgainst: ['ec_kaveri_online'],
      },
    },
    {
      evalCase: {
        id: 'grounding:citation-to-absent-evidence',
        kind: 'grounding',
        label: 'An insight citing an evidence id that is not on the ledger',
        input: {
          claim: 'The site is clear of rajakaluve buffer encroachment (cited evidence: ev-buffer-survey-2024).',
          evidence: [
            { id: 'ev-khata-2025', label: 'Khata extract 2025', detail: 'BBMP khata extract, A-khata, assessed area 145.0 sqm.' },
            { id: 'ev-tax-2025', label: 'Property tax receipt 2025-26', detail: 'SAS payment for assessment year 2025.' },
          ],
          ledgerEvidenceIds: ['ev-khata-2025', 'ev-tax-2025'],
          statePackId: 'karnataka',
        },
        expectations: [
          { key: 'verdict', expected: 'contradicted', match: 'exact' },
          { key: 'flaggedIds', expected: 'ev-buffer-survey-2024', match: 'contains' },
          // No survey exists, so no survey date can be reported for one.
          { key: 'bufferSurveyDate', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        verdict: 'contradicted',
        flaggedIds: ['ev-buffer-survey-2024'],
      },
    },
  ];
}

export function buildGroundingCases(): EvalCase[] {
  return groundingCasesWithTruth().map(entry => entry.evalCase);
}

/**
 * Proof-routing cases: does the route name a real authority, form and
 * procedure?
 *
 * Every expected value here is checked against the Karnataka proof-routes
 * corpus in `knowledge/karnataka-proof-routes.ts`, which is the same grounding
 * the agent is given. The absences are the fields that corpus deliberately
 * does not carry — a Sakala service code for an EC, a guaranteed turnaround
 * for a conversion order — because those are exactly what a model fills in
 * when asked to be exhaustive.
 */
function proofRoutingCasesWithTruth(): EvalCaseWithTruth[] {
  return [
    {
      evalCase: {
        id: 'proof:encumbrance-certificate-karnataka',
        kind: 'proof_routing',
        label: 'Encumbrance certificate — Kaveri Online Services, Form 22',
        input: {
          missingDocumentKey: 'encumbrance_certificate',
          statePackId: 'karnataka',
          context: 'Buyer needs a 30-year EC for a Whitefield apartment; the seller has supplied 2010 onwards only.',
        },
        expectations: [
          { key: 'authority', expected: 'Sub-Registrar', match: 'contains' },
          { key: 'portalOrAddress', expected: 'kaverionline.karnataka.gov.in', match: 'contains' },
          { key: 'formOrReference', expected: 'Form 22', match: 'contains' },
          // Form 15 (encumbrances found) or Form 16 (nil) — either is the
          // right family, and which one comes back depends on the property.
          { key: 'issuedAs', expected: '^form\\s*1[56]\\b', match: 'regex' },
          // The corpus names no Sakala code for this service. A code invented
          // here is indistinguishable from a real one to the buyer who then
          // quotes it at a counter.
          { key: 'sakalaServiceCode', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'statutoryFeeExactInr', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        authority: 'Sub-Registrar, via Kaveri Online Services',
        portalOrAddress: 'Kaveri Online Services (kaverionline.karnataka.gov.in)',
        formOrReference: 'Form 22 (EC application)',
        issuedAs: 'Form 16 where the search returns nil encumbrances',
      },
    },
    {
      evalCase: {
        id: 'proof:dc-conversion-karnataka',
        kind: 'proof_routing',
        label: 'DC conversion order — Deputy Commissioner, s.95 Karnataka Land Revenue Act 1964',
        input: {
          missingDocumentKey: 'dc_conversion_order',
          statePackId: 'karnataka',
          context: 'Unconverted agricultural site off Sarjapur Road, gram panchayat jurisdiction.',
        },
        expectations: [
          { key: 'authority', expected: 'Deputy Commissioner', match: 'contains' },
          { key: 'formOrReference', expected: 'Karnataka Land Revenue Act', match: 'contains' },
          { key: 'statutorySection', expected: '(?:s\\.?|section)\\s*95\\b', match: 'regex' },
          { key: 'feasibility', expected: 'difficult', match: 'exact' },
          // The corpus is explicit that it cannot confirm a reliable current
          // turnaround. A confident day count is the fabrication.
          { key: 'guaranteedDurationDays', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'onlinePortalUrl', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        authority: 'Office of the Deputy Commissioner (Land Revenue) / revenue department conversion section',
        formOrReference: 'Conversion application under the Karnataka Land Revenue Act, 1964, s.95',
        statutorySection: 's.95',
        feasibility: 'difficult',
      },
    },
    {
      evalCase: {
        id: 'proof:no-corpus-outside-karnataka',
        kind: 'proof_routing',
        label: 'Amsterdam property — no Karnataka corpus applies, and none may be borrowed',
        input: {
          missingDocumentKey: 'encumbrance_certificate',
          statePackId: undefined,
          context: 'Zuidas office floor, Netherlands. No state pack is loaded for this jurisdiction.',
        },
        expectations: [
          { key: 'coverage', expected: 'no_corpus', match: 'exact' },
          // Every Karnataka specific is absent here, and each is exactly what
          // a model primed on the rest of this corpus will reach for.
          { key: 'authority', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'formOrReference', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'portalOrAddress', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        coverage: 'no_corpus',
      },
    },
  ];
}

export function buildProofRoutingCases(): EvalCase[] {
  return proofRoutingCasesWithTruth().map(entry => entry.evalCase);
}

/**
 * Title-reasoning cases: does the chain reasoning reach the right finding?
 *
 * Small, self-contained chains where the correct answer is settled by what is
 * in front of the model rather than by anything it knows about Bengaluru. The
 * absences here are the details a model supplies to make a finding sound
 * settled — a case number for litigation nobody mentioned, a registration
 * number for the deed that is missing precisely because nobody has it.
 */
function titleReasoningCasesWithTruth(): EvalCaseWithTruth[] {
  return [
    {
      evalCase: {
        id: 'title:gap-in-chain',
        kind: 'title_reasoning',
        label: 'A twenty-five year hole between two conveyances',
        input: {
          chain: [
            { instrument: 'Grant / original allotment', year: 1978, parties: 'State grant to A' },
            { instrument: 'Sale deed', year: 1986, parties: 'A to B' },
            { instrument: 'Sale deed', year: 2011, parties: 'C to D' },
            { instrument: 'Sale deed', year: 2020, parties: 'D to current seller' },
          ],
          note: 'No instrument on file conveys from B to C.',
        },
        expectations: [
          { key: 'finding', expected: 'gap', match: 'contains' },
          { key: 'gapFromYear', expected: '1986', match: 'exact' },
          { key: 'gapToYear', expected: '2011', match: 'exact' },
          // The missing link is missing. Naming its registration number is
          // inventing the document whose absence is the finding.
          { key: 'missingDeedRegistrationNumber', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'litigationCaseNumber', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        finding: 'Gap in the chain of title: nothing on file conveys from B to C.',
        gapFromYear: '1986',
        gapToYear: '2011',
      },
    },
    {
      evalCase: {
        id: 'title:extent-shrinks-across-chain',
        kind: 'title_reasoning',
        label: 'Extent conveyed shrinks without a partition on file',
        input: {
          chain: [
            { instrument: 'Mother deed', year: 1998, extentSqm: 420 },
            { instrument: 'Sale deed', year: 2009, extentSqm: 420 },
            { instrument: 'Sale deed', year: 2019, extentSqm: 220 },
          ],
          note: 'No partition deed, release deed or acquisition award is on file.',
        },
        expectations: [
          { key: 'finding', expected: 'extent', match: 'contains' },
          { key: 'unexplainedExtentSqm', expected: '200', match: 'numeric', tolerance: 0.02 },
          // A plausible reason is not a documented one.
          { key: 'partitionDeedNumber', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
          { key: 'acquisitionAwardNumber', expected: ABSENT_EXPECTED, match: 'exact', mustBeAbsent: true },
        ],
      },
      groundTruth: {
        finding: 'Extent conveyed drops with nothing on file to explain it.',
        unexplainedExtentSqm: '200',
      },
    },
  ];
}

export function buildTitleReasoningCases(): EvalCase[] {
  return titleReasoningCasesWithTruth().map(entry => entry.evalCase);
}

/* ==================================================================== */
/* The whole corpus                                                      */
/* ==================================================================== */

/**
 * Every case, every task kind, each paired with the answer a flawless model
 * would give.
 *
 * The pairing is what lets a caller build a stub executor by degrading the
 * truth in a specified way — drop one field, invent one absent field — instead
 * of hand-writing answers, which only ever exercises the failures whoever
 * wrote them thought of.
 */
export function buildEvalCorpus(params: EvalCorpusParams): EvalCaseWithTruth[] {
  return [
    ...documentExtractionCasesWithTruth(params),
    ...adversarialAbsenceCasesWithTruth(params),
    ...groundingCasesWithTruth(),
    ...proofRoutingCasesWithTruth(),
    ...titleReasoningCasesWithTruth(),
  ];
}

/** Every case, every task kind. */
export function buildEvalCases(params: EvalCorpusParams): EvalCase[] {
  return buildEvalCorpus(params).map(entry => entry.evalCase);
}

/** The corpus for one task kind — what `runEvalComparison` is normally given. */
export function evalCasesForTaskKind(kind: EvalTaskKind, params: EvalCorpusParams): EvalCase[] {
  return buildEvalCases(params).filter(c => c.kind === kind);
}

/**
 * How many cases and expectations exist per task kind, and how many of those
 * expectations are absences.
 *
 * The absence count is the number worth watching: it is the share of this
 * corpus that tests for fabrication rather than for accuracy, and if it drifts
 * towards zero the harness has quietly stopped doing the job it was built for.
 */
export function summariseEvalCorpus(cases: EvalCase[]): {
  kind: EvalTaskKind;
  cases: number;
  expectations: number;
  absenceExpectations: number;
}[] {
  const kinds: EvalTaskKind[] = ['document_extraction', 'grounding', 'proof_routing', 'title_reasoning'];
  return kinds
    .map(kind => {
      const forKind = cases.filter(c => c.kind === kind);
      return {
        kind,
        cases: forKind.length,
        expectations: forKind.reduce((n, c) => n + c.expectations.length, 0),
        absenceExpectations: forKind.reduce((n, c) => n + c.expectations.filter(e => e.mustBeAbsent).length, 0),
      };
    })
    .filter(row => row.cases > 0);
}
