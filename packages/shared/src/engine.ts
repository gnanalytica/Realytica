/**
 * Valytica scoring engine.
 *
 * Every exported function here is a pure function of its arguments — no
 * `Math.random()`, no `Date.now()`, no ambient state. Where a case needs
 * case-specific but reproducible variation (e.g. a synthetic metro-distance
 * estimate used by one value driver) we derive it from a PRNG seeded by the
 * case id, so re-running `runScreen` on the same input always produces the
 * same `ScreenResult` byte-for-byte.
 */

import type {
  ActionOwner,
  ActionPriority,
  BufferRule,
  Comparable,
  ComparableAdjustment,
  CompletenessItem,
  CompletenessSummary,
  ComplianceCheck,
  ComplianceVerdict,
  ComparisonResult,
  ComparisonRow,
  ConfidenceBand,
  ConfidenceFactor,
  ConfidenceSummary,
  CountryCode,
  CountryPack,
  CaseDocument,
  CurrencyCode,
  DocumentKind,
  DriverCategory,
  DutySlab,
  EvidenceItem,
  EvidenceSourceType,
  ExtractedField,
  ExtractionMethod,
  IndicativeValue,
  LayoutApproval,
  LocalityReference,
  MarketContext,
  PlanningPosition,
  PlotAttributes,
  PlotFacing,
  PropertyCase,
  PropertyIdentity,
  PropertySnapshot,
  PropertyType,
  RecommendedAction,
  ReferenceData,
  RiskCategory,
  RiskFlag,
  RiskSeverity,
  ScreenResult,
  ScreenVerdict,
  StateComplianceSummary,
  StatePack,
  TransactionCostBreakdown,
  ValueAnchor,
  ValueDriver,
  SiteContext,
} from './types';
import { amenityDistance, nearestTransit, sitePinIsAccurate } from './site';
import { COMPASS_SIDES, analyseTitleGraph, type CompassSide } from './graph';
import { runPlaybooks } from './playbooks';
import { ENGINE_VERSION } from './constants';
import { REFERENCE_DATA } from './reference';

/* ==================================================================== */
/* Deterministic PRNG                                                    */
/* ==================================================================== */

/** xmur3 string hash — turns an arbitrary seed string into a 32-bit int seed. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 — small, fast, deterministic PRNG. Returns a function producing floats in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a deterministic [0,1) generator from any string seed (e.g. a case id). */
function seededRandom(seed: string): () => number {
  const hash = xmur3(seed);
  return mulberry32(hash());
}

/** Deterministic float in [min, max) derived from a string seed. */
function seededRange(seed: string, min: number, max: number): number {
  return min + seededRandom(seed)() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Rounds a monetary amount to a sensible display precision for its currency. */
export function roundMoney(value: number, currency: CurrencyCode): number {
  const nearest = currency === 'INR' ? 1000 : 100;
  return Math.round(value / nearest) * nearest;
}

/** Rounds a per-sqm rate to a sensible display precision for its currency. */
function roundRate(value: number, currency: CurrencyCode): number {
  const nearest = currency === 'INR' ? 100 : 10;
  return Math.round(value / nearest) * nearest;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/* Small deterministic name pools used only to make simulated OCR output read as
 * plausible demo data — never presented as a real person. */
const IN_FIRST_NAMES = ['Ananya', 'Rahul', 'Priya', 'Arjun', 'Kavya', 'Vikram', 'Sneha', 'Rohit', 'Divya', 'Karthik'];
const IN_LAST_NAMES = ['Rao', 'Reddy', 'Nair', 'Iyer', 'Menon', 'Sharma', 'Gupta', 'Kulkarni', 'Shetty', 'Pillai'];
const NL_FIRST_NAMES = ['Lars', 'Anouk', 'Sven', 'Femke', 'Daan', 'Sanne', 'Bram', 'Eva', 'Thijs', 'Julia'];
const NL_LAST_NAMES = ['de Vries', 'Jansen', 'Bakker', 'Visser', 'Smit', 'Meijer', 'Mulder', 'de Groot', 'Bos', 'Vos'];

function syntheticPersonName(seed: string, country: CountryCode): string {
  const firsts = country === 'IN' ? IN_FIRST_NAMES : NL_FIRST_NAMES;
  const lasts = country === 'IN' ? IN_LAST_NAMES : NL_LAST_NAMES;
  const r = seededRandom(seed);
  const first = firsts[Math.floor(r() * firsts.length)];
  const last = lasts[Math.floor(r() * lasts.length)];
  return `${first} ${last}`;
}

/* ==================================================================== */
/* Document classification                                               */
/* ==================================================================== */

const CLASSIFICATION_RULES: { pattern: RegExp; kind: DocumentKind; confidence: number }[] = [
  { pattern: /sale.?deed|title.?deed|conveyance/i, kind: 'title_deed', confidence: 0.93 },
  { pattern: /mother.?deed|link.?doc/i, kind: 'mother_deed', confidence: 0.9 },
  { pattern: /sale.?agreement|koopovereenkomst|agreement.?to.?sell/i, kind: 'sale_agreement', confidence: 0.88 },
  { pattern: /\bec[-_ ]|encumbrance/i, kind: 'encumbrance_certificate', confidence: 0.91 },
  { pattern: /khata/i, kind: 'khata_extract', confidence: 0.9 },
  { pattern: /form.?9|form.?11/i, kind: 'form_9_11', confidence: 0.88 },
  { pattern: /rera/i, kind: 'rera_registration', confidence: 0.89 },
  { pattern: /kadaster|uittreksel/i, kind: 'kadaster_extract', confidence: 0.92 },
  { pattern: /woz/i, kind: 'woz_assessment', confidence: 0.94 },
  { pattern: /energie|energy.?label/i, kind: 'energy_label', confidence: 0.9 },
  { pattern: /\boc[-_ ]|occupancy/i, kind: 'occupancy_certificate', confidence: 0.87 },
  { pattern: /conversion|dc.?convert|s\.?95/i, kind: 'conversion_certificate', confidence: 0.88 },
  { pattern: /commencement|cc[-_ ]/i, kind: 'commencement_certificate', confidence: 0.87 },
  { pattern: /betterment/i, kind: 'betterment_charges_receipt', confidence: 0.86 },
  { pattern: /possession|allotment/i, kind: 'possession_certificate', confidence: 0.83 },
  { pattern: /jda|joint.?development/i, kind: 'joint_development_agreement', confidence: 0.85 },
  { pattern: /sanctioned.?plan.*bbmp|bbmp.*sanctioned.?plan/i, kind: 'sanctioned_plan_bbmp', confidence: 0.85 },
  { pattern: /tax|receipt|belasting/i, kind: 'property_tax_receipt', confidence: 0.85 },
  { pattern: /plan|drawing|dwg|blueprint|floor.?plan|plattegrond/i, kind: 'approved_building_plan', confidence: 0.75 },
  { pattern: /lease|huur|tenanc(y|e)/i, kind: 'lease_agreement', confidence: 0.84 },
  { pattern: /valuation|appraisal|taxatie/i, kind: 'valuation_report', confidence: 0.82 },
];

/**
 * Deterministic keyword/pattern classifier over a document's filename. This
 * simulates the first pass of a real classifier without any ML model — real
 * OCR/ML classification would replace this function's body, not its signature.
 */
export function classifyDocument(fileName: string, mimeType: string): { kind: DocumentKind; confidence: number } {
  if (mimeType.startsWith('image/')) {
    // A bare building-plan drawing photographed on-site still reads as a plan;
    // only fall through to "photograph" when the filename gives no hint.
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(fileName)) {
        return { kind: rule.kind, confidence: Math.max(0.55, rule.confidence - 0.15) };
      }
    }
    return { kind: 'photograph', confidence: 0.8 };
  }
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(fileName)) {
      return { kind: rule.kind, confidence: rule.confidence };
    }
  }
  if (/floor.?plan|plattegrond/i.test(fileName)) {
    return { kind: 'floor_plan', confidence: 0.78 };
  }
  return { kind: 'unclassified', confidence: 0.3 };
}

/* ==================================================================== */
/* Field extraction (simulated OCR/parsing)                              */
/* ==================================================================== */

function mkField(
  key: string,
  label: string,
  value: string,
  confidence: number,
  sourceDocumentId: string,
  method: ExtractionMethod,
  unit?: string,
): ExtractedField {
  return { key, label, value, unit, confidence, sourceDocumentId, sourcePage: 1, method };
}

/**
 * Deterministic simulated OCR/extraction. Real values are derived from the
 * document kind and the property identity so the output is plausible and
 * stable for a given (document, identity, seed) triple — no two calls with the
 * same inputs will ever disagree, which matters because `runScreen` may
 * re-derive fields for documents that were uploaded without extraction having
 * run yet.
 */
/**
 * Synthetic schedule of property for the demo extractor.
 *
 * A Bengaluru site deed states the boundaries and the two dimensions as well
 * as the extent, and the graph now reads all three. Without them the demo
 * cases would exercise none of that, and the schedule card would be empty on
 * exactly the cases it was built for.
 *
 * Two details matter, both about not manufacturing findings:
 *
 * - The dimensions come from the case's own `plot.dimensionsFt` where it has
 *   them, and are otherwise derived from the recorded extent and rounded to
 *   whole feet, which is what a deed does. Either way the product agrees with
 *   the stated extent to within `AREA_DRIFT_FLOOR`, so `area_mismatch` does
 *   not fire on arithmetic that is actually correct.
 *
 * - The abutters are seeded from the *case*, not the document, so the sale
 *   deed and the mother deed describe the same neighbours and
 *   `boundary_mismatch` does not fire on two documents that agree.
 *
 * Only for an Indian site — a flat's deed has no site dimensions to state,
 * and inventing some would put a fictional rectangle into the reconciliation.
 */
function scheduleFields(identity: PropertyIdentity, seed: string, docId: string, confidence: number): ExtractedField[] {
  if (identity.country !== 'IN' || identity.plotAreaSqm <= 0 || identity.builtUpAreaSqm > 0) return [];

  const METRES_PER_FOOT = 0.3048;
  const areaSqft = identity.plotAreaSqm / (METRES_PER_FOOT * METRES_PER_FOOT);
  // Where the case already records the site's dimensions, the deed states
  // those. Deriving a different pair from the extent would put the case
  // record and its own title deed into a disagreement this codebase invented.
  const recorded = identity.plot?.dimensionsFt;
  const eastWestFt = recorded ? recorded.width : Math.round(Math.sqrt(areaSqft / round2(seededRange(`${seed}:schedule:ratio`, 1.35, 1.65))));
  const northSouthFt = recorded ? recorded.depth : Math.round(areaSqft / eastWestFt);

  // A site's facing *is* the side its access road runs along, and the case
  // already records both the facing and the road width. The schedule states
  // the road on that side and states its recorded width — a schedule that
  // put the road somewhere else, or gave it a different width, would put the
  // deed at odds with the plot facts on the same screen.
  const roadWidth = identity.plot?.roadWidthFt ?? [20, 30, 40][Math.floor(seededRange(`${seed}:schedule:road`, 0, 3))];
  const facing = identity.plot?.facing ?? 'east';
  const roadSide: CompassSide = facing === 'unknown' ? 'east' : (facing.split('_')[0] as CompassSide);
  const neighbour = (side: string): string => `Sy. No. ${Math.floor(seededRange(`${seed}:schedule:${side}`, 100, 190))}/${Math.floor(seededRange(`${seed}:schedule:${side}:sub`, 1, 9))}`;

  const label: Record<CompassSide, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };
  const key: Record<CompassSide, string> = { north: 'boundaryNorth', east: 'boundaryEast', south: 'boundarySouth', west: 'boundaryWest' };

  return [
    ...COMPASS_SIDES.map(side =>
      mkField(key[side], `Boundary — ${label[side]}`, side === roadSide ? `${roadWidth} feet wide road` : neighbour(side), confidence, docId, 'ocr'),
    ),
    mkField('dimensionEastWest', 'Dimension — East to West', String(eastWestFt), confidence, docId, 'parser', 'ft'),
    mkField('dimensionNorthSouth', 'Dimension — North to South', String(northSouthFt), confidence, docId, 'parser', 'ft'),
  ];
}

export function extractFields(doc: CaseDocument, identity: PropertyIdentity, seed: string): ExtractedField[] {
  const rnd = (label: string, min: number, max: number): number => seededRange(`${seed}:${doc.id}:${label}`, min, max);
  const conf = (label: string): number => round2(rnd(`conf:${label}`, 0.6, 0.98));
  const docId = doc.id;
  // Anchored on the document's own upload timestamp rather than the system clock,
  // so extraction stays deterministic no matter when this function actually runs.
  const uploadYear = new Date(doc.uploadedAt).getFullYear();

  switch (doc.kind) {
    case 'title_deed':
      return [
        mkField('ownerName', 'Registered owner', syntheticPersonName(`${seed}:${docId}:owner`, identity.country), conf('owner'), docId, 'ocr'),
        mkField('deedDate', 'Deed execution date', new Date(2015 + Math.floor(rnd('year', 0, 9)), Math.floor(rnd('month', 0, 11)), 1 + Math.floor(rnd('day', 0, 27))).toISOString().slice(0, 10), conf('deedDate'), docId, 'ocr'),
        mkField('registrationNumber', 'Registration number', `${identity.state.slice(0, 2).toUpperCase()}-${Math.floor(rnd('regno', 100000, 999999))}`, conf('regno'), docId, 'ocr'),
        mkField('extent', 'Extent conveyed', identity.plotAreaSqm.toFixed(1), conf('extent'), docId, 'parser', 'sqm'),
        ...scheduleFields(identity, seed, docId, conf('schedule')),
      ];
    case 'sale_agreement':
      return [
        mkField('agreementDate', 'Agreement date', new Date(2024, Math.floor(rnd('month', 0, 11)), 1 + Math.floor(rnd('day', 0, 27))).toISOString().slice(0, 10), conf('agrDate'), docId, 'ocr'),
        mkField('agreedPrice', 'Agreed price', String(Math.round(rnd('price', (identity.askingPrice ?? 0) * 0.9, (identity.askingPrice ?? 0) * 1.0) || 0)), conf('price'), docId, 'ocr', identity.currency),
      ];
    case 'encumbrance_certificate':
      return [
        mkField('ecPeriod', 'Period covered', `${2010 + Math.floor(rnd('span', 0, 5))}–${2024 + Math.floor(rnd('span2', 0, 2))}`, conf('ecPeriod'), docId, 'ocr'),
        mkField('encumbranceCount', 'Registered encumbrances', String(Math.floor(rnd('count', 0, 2))), conf('count'), docId, 'ocr'),
      ];
    case 'khata_extract': {
      // Karnataka's A/B distinction is the single biggest binary in a
      // Bengaluru title screen, so a khata extract's classification field
      // is derived from the case's own recorded khata type when known,
      // rather than left to a random draw.
      const khataType = identity.karnataka?.khataType;
      const classification =
        khataType === 'a_khata'
          ? 'A'
          : khataType === 'b_khata'
            ? 'B'
            : khataType === 'gram_panchayat_form_9_11'
              ? 'Form 9/11 (Gram Panchayat)'
              : 'Unclassified';
      return [
        mkField('khataNumber', 'Khata number', `K/${Math.floor(rnd('khata', 1000, 9999))}/${uploadYear}`, conf('khata'), docId, 'ocr'),
        mkField('khataClassification', 'Khata classification', classification, conf('khataClass'), docId, 'ocr'),
        mkField('assessedArea', 'Assessed area', identity.builtUpAreaSqm.toFixed(1), conf('area'), docId, 'parser', 'sqm'),
      ];
    }
    case 'property_tax_receipt': {
      const fields = [
        mkField('assessmentYear', 'Assessment year', String(uploadYear - Math.floor(rnd('ay', 0, 1))), conf('ay'), docId, 'ocr'),
        mkField('annualTax', 'Annual tax paid', String(Math.round(rnd('tax', 8000, 65000))), conf('tax'), docId, 'ocr', identity.currency),
      ];
      if (identity.country === 'IN') {
        const zoneLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const zone = identity.karnataka?.bbmpTaxZone ?? zoneLetters[Math.floor(rnd('zone', 0, zoneLetters.length))];
        fields.push(
          mkField('sasApplicationNumber', 'SAS application number', `SAS-${Math.floor(rnd('sas', 100000, 999999))}`, conf('sas'), docId, 'ocr'),
          mkField('bbmpZone', 'BBMP tax zone', zone, conf('zoneConf'), docId, 'ocr'),
        );
      }
      return fields;
    }
    case 'approved_building_plan':
      return [
        mkField('approvalAuthority', 'Approving authority', identity.country === 'IN' ? 'Municipal planning authority' : 'Gemeente (municipality)', conf('auth'), docId, 'ocr'),
        mkField('approvedFar', 'Approved FAR/FSI', round2(rnd('far', 1.2, 3.4)).toFixed(2), conf('far'), docId, 'parser'),
      ];
    case 'occupancy_certificate':
      return [
        mkField('ocIssueDate', 'Issue date', new Date(2016 + Math.floor(rnd('ocy', 0, 8)), Math.floor(rnd('ocm', 0, 11)), 1).toISOString().slice(0, 10), conf('ocDate'), docId, 'ocr'),
        mkField('ocNumber', 'OC reference number', `OC-${Math.floor(rnd('ocn', 10000, 99999))}`, conf('ocn'), docId, 'ocr'),
      ];
    case 'rera_registration': {
      const isKarnataka = identity.state.toLowerCase() === 'karnataka';
      const reraNumber = isKarnataka
        ? `PRM/KA/RERA/${Math.floor(rnd('krera1', 1250, 1299))}/${Math.floor(rnd('krera2', 300, 499))}/PR/${String(1 + Math.floor(rnd('kreram', 0, 11))).padStart(2, '0')}${uploadYear}/${Math.floor(rnd('krera3', 100000, 999999))}`
        : `PR/${identity.state.slice(0, 2).toUpperCase()}/${Math.floor(rnd('rera', 100000, 999999))}`;
      return [
        mkField('reraNumber', isKarnataka ? 'K-RERA registration number' : 'RERA registration number', reraNumber, conf('rera'), docId, 'ocr'),
        mkField('reraValidTill', 'Valid until', `${uploadYear + Math.floor(rnd('reraexp', 1, 5))}-12-31`, conf('reraexp'), docId, 'parser'),
      ];
    }
    case 'mother_deed':
      return [
        mkField('surveyNumber', 'Survey number', identity.parcelId || `Sy. No. ${Math.floor(rnd('sy', 10, 400))}/${Math.floor(rnd('sysub', 1, 9))}`, conf('sy'), docId, 'ocr'),
        mkField('extentConveyed', 'Extent', identity.plotAreaSqm.toFixed(1), conf('extent'), docId, 'parser', 'sqm'),
        ...scheduleFields(identity, seed, docId, conf('schedule')),
      ];
    case 'conversion_certificate':
      return [
        mkField(
          'conversionOrderNumber',
          'DC conversion order number',
          `ALN(SLR)CR-${Math.floor(rnd('convno', 100, 999))}/${uploadYear - 1}-${String(uploadYear).slice(-2)}`,
          conf('convno'),
          docId,
          'ocr',
        ),
        mkField(
          'conversionOrderDate',
          'Conversion order date',
          new Date(uploadYear - Math.floor(rnd('convyr', 0, 3)), Math.floor(rnd('convm', 0, 11)), 1 + Math.floor(rnd('convd', 0, 27))).toISOString().slice(0, 10),
          conf('convdate'),
          docId,
          'ocr',
        ),
      ];
    case 'form_9_11':
      return [mkField('formReference', 'Form 9/11 reference', `Form 9 & 11/${Math.floor(rnd('f911', 100, 999))}/${uploadYear}`, conf('f911'), docId, 'ocr')];
    case 'commencement_certificate':
      return [mkField('ccNumber', 'Commencement certificate number', `CC/${Math.floor(rnd('cc', 1000, 9999))}/${uploadYear}`, conf('cc'), docId, 'ocr')];
    case 'betterment_charges_receipt':
      return [mkField('bettermentAmount', 'Betterment charges paid', String(Math.round(rnd('betterment', 20000, 250000))), conf('betterment'), docId, 'ocr', identity.currency)];
    case 'possession_certificate':
      return [
        mkField(
          'possessionDate',
          'Possession handover date',
          new Date(uploadYear, Math.floor(rnd('possm', 0, 11)), 1 + Math.floor(rnd('possd', 0, 27))).toISOString().slice(0, 10),
          conf('poss'),
          docId,
          'ocr',
        ),
      ];
    case 'joint_development_agreement':
      return [mkField('jdaSharingRatio', 'JDA sharing ratio (owner:developer)', `${40 + Math.floor(rnd('jda', 0, 20))}:${60 - Math.floor(rnd('jda2', 0, 20))}`, conf('jda'), docId, 'ocr')];
    case 'sanctioned_plan_bbmp':
      return [mkField('sanctionNumber', 'BBMP sanction number', `BBMP/Addl.Dir/${Math.floor(rnd('sanc', 1000, 9999))}/${uploadYear}`, conf('sanc'), docId, 'ocr')];
    case 'valuation_report':
      return [
        mkField('valuerName', 'Valuer / firm', 'Independent valuer on file', conf('valuer'), docId, 'ocr'),
        mkField('reportDate', 'Report date', new Date(uploadYear, Math.floor(rnd('vdm', 0, 11)), 1).toISOString().slice(0, 10), conf('vdate'), docId, 'ocr'),
      ];
    case 'lease_agreement':
      return [
        mkField('tenantName', 'Tenant', syntheticPersonName(`${seed}:${docId}:tenant`, identity.country), conf('tenant'), docId, 'ocr'),
        mkField('annualRent', 'Annual rent', String(Math.round(rnd('rent', identity.builtUpAreaSqm * 400, identity.builtUpAreaSqm * 900))), conf('rentConf'), docId, 'ocr', identity.currency),
        mkField('leaseExpiry', 'Lease expiry', `${uploadYear + Math.floor(rnd('lexp', 1, 6))}-${String(1 + Math.floor(rnd('lexpm', 0, 11))).padStart(2, '0')}-01`, conf('lexpConf'), docId, 'parser'),
      ];
    case 'kadaster_extract':
      return [
        mkField('kadastraalAanduiding', 'Kadastrale aanduiding', identity.parcelId || `${identity.city.slice(0, 3).toUpperCase()} ${Math.floor(rnd('kad', 1000, 9999))}`, conf('kad'), docId, 'ocr'),
        mkField('perceelOppervlakte', 'Perceel oppervlakte', identity.plotAreaSqm.toFixed(1), conf('kadarea'), docId, 'parser', 'sqm'),
      ];
    case 'energy_label': {
      const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const idx = Math.floor(rnd('elabel', 0, labels.length));
      return [
        mkField('energyLabel', 'Energy label', labels[idx], conf('elabelConf'), docId, 'ocr'),
        mkField('validUntil', 'Valid until', `${uploadYear + 8}-01-01`, conf('evalid'), docId, 'parser'),
      ];
    }
    case 'woz_assessment':
      return [
        mkField('wozValue', 'WOZ value', String(Math.round(rnd('woz', identity.builtUpAreaSqm * 4000, identity.builtUpAreaSqm * 8500))), conf('wozConf'), docId, 'ocr', 'EUR'),
        mkField('referenceDate', 'Reference date (waardepeildatum)', `${uploadYear - 1}-01-01`, conf('wozref'), docId, 'parser'),
      ];
    case 'floor_plan':
      return [mkField('drawnArea', 'Drawn area', identity.builtUpAreaSqm.toFixed(1), conf('drawn'), docId, 'parser', 'sqm')];
    case 'photograph':
    case 'other':
    case 'unclassified':
    default:
      return [];
  }
}

/* ==================================================================== */
/* Evidence collection                                                   */
/* ==================================================================== */

/**
 * Every number the UI shows must trace back to one of these. `runScreen` uses
 * a single builder instance throughout so ids are assigned once, in one place,
 * and `assertEvidenceIntegrity` can then verify every `evidenceIds` array in
 * the finished result only ever points at ids this builder actually issued.
 */
class EvidenceBuilder {
  private items: EvidenceItem[] = [];

  constructor(
    private readonly caseId: string,
    private readonly now: string,
  ) {}

  add(input: {
    statement: string;
    sourceType: EvidenceSourceType;
    sourceRef: string;
    sourceLabel: string;
    confidence: number;
    capturedAt?: string;
  }): string {
    const id = `ev-${this.caseId}-${String(this.items.length + 1).padStart(3, '0')}`;
    this.items.push({
      id,
      statement: input.statement,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      sourceLabel: input.sourceLabel,
      confidence: input.confidence,
      capturedAt: input.capturedAt ?? this.now,
    });
    return id;
  }

  list(): EvidenceItem[] {
    return this.items;
  }
}

/* ==================================================================== */
/* Locality matching                                                     */
/* ==================================================================== */

export type LocalityMatchLevel = 'locality' | 'city' | 'country';

/**
 * Cascades exact locality -> city -> country-wide proxy. The level reached is
 * itself signal: a country-level fallback means we are pricing off a proxy
 * market, which `buildConfidence` and `buildRisks` both react to.
 */
function matchLocalityReference(
  identity: PropertyIdentity,
  localities: LocalityReference[],
): { ref: LocalityReference; matchLevel: LocalityMatchLevel } {
  const countryLocalities = localities.filter(l => l.country === identity.country);

  const exact = countryLocalities.find(
    l => l.city.toLowerCase() === identity.city.toLowerCase() && l.locality.toLowerCase() === identity.locality.toLowerCase(),
  );
  if (exact) return { ref: exact, matchLevel: 'locality' };

  const cityMatches = countryLocalities.filter(l => l.city.toLowerCase() === identity.city.toLowerCase());
  if (cityMatches.length > 0) {
    const best = cityMatches.reduce((a, b) => (b.sampleSize > a.sampleSize ? b : a));
    return { ref: best, matchLevel: 'city' };
  }

  if (countryLocalities.length > 0) {
    const best = countryLocalities.reduce((a, b) => (b.sampleSize > a.sampleSize ? b : a));
    return { ref: best, matchLevel: 'country' };
  }

  throw new Error(`No reference data available for country ${identity.country}`);
}

/* ==================================================================== */
/* State / Municipality Pack resolution                                  */
/* ==================================================================== */

/**
 * Picks the `StatePack` that covers a case's country + state, case-insensitive.
 * India sets its property register instrument, transaction taxes and title
 * checks at state level, so a pack only applies inside the state it was
 * calibrated for — anything else returns `undefined` and the engine falls
 * back to the country-level `outside_covered_state` risk rather than quietly
 * applying the wrong state's rules.
 */
function resolveStatePack(identity: PropertyIdentity, refData: ReferenceData): StatePack | undefined {
  return refData.statePacks.find(p => p.country === identity.country && p.state.toLowerCase() === identity.state.toLowerCase());
}

type RequiredDocSpec = { kind: DocumentKind; label: string; weight: number; required: boolean; note?: string };

/**
 * Merges a State Pack's required documents over the Country Pack's: the state
 * wins on any `kind` both packs name (e.g. a state's own khata-specific
 * wording), and state-only kinds (mother deed, conversion certificate, ...)
 * are added. Order is country-first-then-state so a `Map` keyed by `kind`
 * gives exactly "state overrides, state-only adds" semantics.
 */
function resolveRequiredDocuments(countryPack: CountryPack, statePack: StatePack | undefined): RequiredDocSpec[] {
  const merged = new Map<DocumentKind, RequiredDocSpec>();
  for (const rd of countryPack.requiredDocuments) merged.set(rd.kind, rd);
  if (statePack) {
    for (const rd of statePack.requiredDocuments) merged.set(rd.kind, rd);
  }
  return [...merged.values()];
}

/* ==================================================================== */
/* Land vs built classification & plot-specific value adjustments        */
/*                                                                        */
/* A site is priced per sqm of PLOT, a flat or office per sqm of         */
/* BUILT-UP space — two different quantities, not the same one scaled by */
/* a constant. Every place the engine picks a comparable, an area basis  */
/* or a benchmark rate has to know which side of that boundary the       */
/* subject sits on, so it is decided once here and reused everywhere.    */
/* ==================================================================== */

const LAND_PROPERTY_TYPES: PropertyType[] = ['residential_plot', 'land_parcel'];

function isLandPropertyType(propertyType: PropertyType): boolean {
  return LAND_PROPERTY_TYPES.includes(propertyType);
}

/** The area a subject's value is actually measured against: plot area for a site, built-up area for everything else. */
function subjectComparisonAreaSqm(identity: PropertyIdentity): number {
  return isLandPropertyType(identity.propertyType) ? identity.plotAreaSqm : identity.builtUpAreaSqm;
}

/**
 * Road width drives both access/visibility and permissible FAR in Bengaluru
 * zoning (several localities' own planning notes tie enhanced FAR to roads
 * 12m/40ft and wider), so a narrower road is priced down and a wider one up.
 * Bands follow common Bengaluru layout-road categories rather than a
 * continuous formula, since that is how the market actually steps.
 */
function roadWidthAdjustmentPct(roadWidthFt: number | undefined): number {
  if (roadWidthFt === undefined) return 0;
  if (roadWidthFt < 20) return -6;
  if (roadWidthFt < 30) return -3;
  if (roadWidthFt < 40) return 0;
  if (roadWidthFt < 60) return 4;
  return 8;
}

/** A genuine premium for dual road frontage and easier access — not decorative. */
function cornerSiteAdjustmentPct(cornerSite: boolean | undefined): number {
  return cornerSite === true ? 5 : 0;
}

/**
 * East and north facing command a measurable premium in the Bengaluru
 * market; south and west trade at a discount. Magnitudes are kept modest
 * (a handful of percent either way) — this is a real, priceable preference,
 * not the dominant driver of a site's value.
 */
const FACING_ADJUSTMENT_PCT: Record<PlotFacing, number> = {
  east: 4,
  north: 3,
  north_east: 5,
  north_west: 1,
  south_east: -1,
  south: -3,
  west: -4,
  south_west: -6,
  unknown: 0,
};

/**
 * Standard Bengaluru site sizes (30x40, 40x60, 50x80, ...) sit close to a
 * 4:3 aspect ratio and resell fastest; a very elongated site is harder to
 * build on efficiently and harder to resell, so a high depth-to-width ratio
 * is penalised on a step scale.
 */
function dimensionStandardnessAdjustmentPct(dims: PlotAttributes['dimensionsFt']): number {
  if (!dims || dims.width <= 0 || dims.depth <= 0) return 0;
  const longer = Math.max(dims.width, dims.depth);
  const shorter = Math.min(dims.width, dims.depth);
  const aspectRatio = longer / shorter;
  let pct = aspectRatio <= 1.45 ? 2 : 0;
  if (aspectRatio > 2.5) pct -= 5;
  else if (aspectRatio > 2.0) pct -= 3;
  else if (aspectRatio > 1.6) pct -= 1;
  return pct;
}

/**
 * BDA/BMRDA-approved layouts are the most bankable and carry a real premium;
 * a revenue layout or an outright unapproved layout is hard to finance and
 * hard to resell, so the discount here is deliberately the largest-magnitude
 * plot adjustment — matching how the market (and `buildStateCompliance`'s
 * own layout-approval-status check) actually treats the finding.
 */
const LAYOUT_APPROVAL_ADJUSTMENT_PCT: Record<LayoutApproval, number> = {
  bda_approved: 6,
  bmrda_approved: 3,
  panchayat_approved: 0,
  private_approved: -2,
  revenue_layout: -12,
  unapproved: -18,
  unknown: -5,
};

/* ==================================================================== */
/* Comparable selection & adjustment                                     */
/* ==================================================================== */

function dedupeById(comps: Comparable[]): Comparable[] {
  const seen = new Set<string>();
  const out: Comparable[] = [];
  for (const c of comps) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/**
 * `Comparable` carries no structured locality/city field (see the contract in
 * `types.ts`), so locality/city filtering matches against the free-text
 * `address`, which every pool entry in `reference.ts` deliberately writes as
 * "<building>, <locality>, <city>, <state>".
 */
function addressMentions(comp: Comparable, needle: string): boolean {
  return comp.address.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Gates on the land/built boundary FIRST, before any locality/city/country
 * cascade — a comparable may never cross that boundary regardless of how
 * similar it otherwise looks, which is the core fix for a site being valued
 * against apartment comparables. `level` reports how far the search had to
 * widen to assemble a same-side candidate set, reusing the same
 * locality/city/country vocabulary `matchLocalityReference` uses elsewhere so
 * a widened land search can be surfaced through the existing
 * confidence/risk machinery rather than silently substituting the wrong side.
 */
function selectComparableCandidates(
  identity: PropertyIdentity,
  pool: Comparable[],
  localities: LocalityReference[],
): { candidates: Comparable[]; level: LocalityMatchLevel } {
  const sameSidePool = pool.filter(c => isLandPropertyType(c.propertyType) === isLandPropertyType(identity.propertyType));

  let candidates = sameSidePool.filter(c => addressMentions(c, identity.locality));
  let level: LocalityMatchLevel = 'locality';

  if (candidates.length < 4) {
    level = 'city';
    const byCity = sameSidePool.filter(c => addressMentions(c, identity.city));
    candidates = dedupeById([...candidates, ...byCity]);
  }

  if (candidates.length < 4) {
    level = 'country';
    const countryLocalities = localities.filter(l => l.country === identity.country);
    const byCountry = sameSidePool.filter(c => countryLocalities.some(l => addressMentions(c, l.locality) || addressMentions(c, l.city)));
    candidates = dedupeById([...candidates, ...byCountry]);
  }

  return { candidates, level };
}

/**
 * Applies signed, per-comparable adjustments to bring a raw pool transaction
 * toward the subject's own profile, and sets the final `similarity` score
 * used both to rank and to weight the comparable-sales/land-rate anchors.
 *
 * For a land subject this adds five plot-specific adjustments (road width,
 * corner site, facing, dimension standardness, layout approval) on top of
 * the existing time/size ones — each a signed, labelled
 * `ComparableAdjustment` so the chain from raw comp to adjusted rate stays
 * auditable. Like the existing floor/age/condition adjustment below, these
 * are derived from the SUBJECT's own plot attributes and applied uniformly
 * across every selected comp, because `Comparable` (see `types.ts`) carries
 * no per-comp road-width/facing/dimensions data to compare against.
 */
function adjustComparable(comp: Comparable, identity: PropertyIdentity, locality: LocalityReference, now: string, similarity: number): Comparable {
  const adjustments: ComparableAdjustment[] = [];
  const isLand = isLandPropertyType(identity.propertyType);

  // 1. Time / market movement — bring an older transaction up (or down) to the
  // valuation date using the locality's own annual trend.
  const monthsAgo = monthsBetween(comp.transactedAt, now);
  const timePct = round1(locality.yoyChangePct * (monthsAgo / 12));
  if (Math.abs(timePct) >= 0.1) {
    adjustments.push({ key: 'time', label: 'Time adjustment to valuation date', pct: timePct });
  }

  // 2. Size — larger units/sites typically transact at a discount per sqm,
  // smaller at a premium. Basis is plot area for a land subject, built-up
  // area otherwise — comparing a site's size fit against built-up area (or
  // vice versa) would silently reintroduce the land/built mismatch this
  // engine exists to prevent.
  const subjectArea = subjectComparisonAreaSqm(identity);
  const areaDeltaPct = (comp.areaSqm - subjectArea) / Math.max(subjectArea, 1);
  let sizePct = 0;
  if (areaDeltaPct > 0.2) sizePct = -3;
  else if (areaDeltaPct < -0.2) sizePct = 3;
  if (sizePct !== 0) {
    adjustments.push({ key: 'size', label: isLand ? 'Plot size differential' : 'Unit size differential', pct: sizePct });
  }

  if (isLand) {
    // 3. Plot-specific adjustments — road width, corner site, facing,
    // dimension standardness and layout approval. There is no building here
    // to have a floor, age or condition, so that adjustment is skipped
    // entirely rather than relying on those fields happening to be unset.
    const plot = identity.plot;

    const roadPct = roadWidthAdjustmentPct(plot?.roadWidthFt);
    if (roadPct !== 0) {
      adjustments.push({ key: 'road_width', label: `Road width (${plot?.roadWidthFt}ft)`, pct: roadPct });
    }

    const cornerPct = cornerSiteAdjustmentPct(plot?.cornerSite);
    if (cornerPct !== 0) {
      adjustments.push({ key: 'corner_site', label: 'Corner site premium', pct: cornerPct });
    }

    const facingPct = plot ? FACING_ADJUSTMENT_PCT[plot.facing] : 0;
    if (facingPct !== 0 && plot) {
      adjustments.push({ key: 'facing', label: `Facing (${plot.facing.replace(/_/g, ' ')})`, pct: facingPct });
    }

    const dimPct = dimensionStandardnessAdjustmentPct(plot?.dimensionsFt);
    if (dimPct !== 0) {
      adjustments.push({ key: 'dimension_standardness', label: 'Site dimension standardness', pct: dimPct });
    }

    const layoutPct = plot ? LAYOUT_APPROVAL_ADJUSTMENT_PCT[plot.layoutApproval] : 0;
    if (layoutPct !== 0 && plot) {
      adjustments.push({ key: 'layout_approval', label: `Layout approval (${plot.layoutApproval.replace(/_/g, ' ')})`, pct: layoutPct });
    }
  } else {
    // 3. Floor level, age & condition — normalises the comparable toward the
    // subject's own physical profile (the pool has no per-comp floor/age data,
    // so this is applied uniformly across all selected comps for one case).
    let conditionPct = 0;
    if (identity.floor !== undefined && identity.totalFloors !== undefined && identity.totalFloors > 0) {
      const rel = identity.floor / identity.totalFloors;
      if (rel >= 0.66) conditionPct += 2;
      else if (identity.floor <= 1) conditionPct -= 2;
    }
    if (identity.yearBuilt !== undefined) {
      const age = new Date(now).getFullYear() - identity.yearBuilt;
      if (age > 30) conditionPct -= 3;
      else if (age < 5) conditionPct += 2;
    }
    if (conditionPct !== 0) {
      adjustments.push({ key: 'condition', label: 'Floor level, age & condition', pct: round1(conditionPct) });
    }
  }

  // 4. Tenure — the comparable pool is predominantly freehold-quality market
  // stock, so a leasehold or unresolved-tenure subject is adjusted down rather
  // than assumed equivalent. Applies equally to land — a leasehold site is
  // just as real a discount as a leasehold flat.
  let tenurePct = 0;
  if (identity.tenure === 'leasehold') tenurePct = -8;
  else if (identity.tenure === 'unknown') tenurePct = -4;
  if (tenurePct !== 0) {
    adjustments.push({ key: 'tenure', label: 'Tenure adjustment', pct: tenurePct });
  }

  let running = comp.pricePerSqm;
  for (const adj of adjustments) {
    running *= 1 + adj.pct / 100;
  }

  return { ...comp, adjustments, adjustedPricePerSqm: roundRate(running, identity.currency), similarity };
}

/**
 * Selects 4-7 comparables (fewer only when the pool genuinely has less to
 * offer, which `buildRisks` flags), ranked by a similarity score blending
 * distance, area fit, recency and property-type match. Candidates are gated
 * to the subject's own land/built side before scoring even begins (see
 * `selectComparableCandidates`) — within that side, the similarity formula
 * itself is unchanged, including the existing type-mismatch penalty.
 */
function buildComparables(
  identity: PropertyIdentity,
  pool: Comparable[],
  localities: LocalityReference[],
  locality: LocalityReference,
  now: string,
): { comparables: Comparable[]; compMatchLevel: LocalityMatchLevel } {
  const { candidates, level } = selectComparableCandidates(identity, pool, localities);
  const subjectArea = subjectComparisonAreaSqm(identity);

  const scored = candidates.map(c => {
    const distanceScore = clamp(1 - c.distanceKm / 8, 0, 1);
    const areaScore = clamp(1 - Math.abs(c.areaSqm - subjectArea) / Math.max(subjectArea, 1), 0, 1);
    const monthsAgo = Math.max(0, monthsBetween(c.transactedAt, now));
    const recencyScore = clamp(1 - monthsAgo / 24, 0, 1);
    const typeScore = c.propertyType === identity.propertyType ? 1 : 0.3;
    const similarity = round2(clamp(0.35 * distanceScore + 0.25 * areaScore + 0.2 * recencyScore + 0.2 * typeScore, 0, 1));
    return { comp: c, similarity };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  const selected = scored.slice(0, Math.min(7, scored.length));

  return {
    comparables: selected.map(({ comp, similarity }) => adjustComparable(comp, identity, locality, now, similarity)),
    compMatchLevel: level,
  };
}

/* ==================================================================== */
/* Value anchors                                                         */
/* ==================================================================== */

const INCOME_ELIGIBLE_TYPES: PropertyType[] = ['commercial_office', 'retail_unit', 'industrial_warehouse'];

/** The subset of `PlanningPosition` the residual-development anchor needs. */
type PlanningForAnchors = Pick<PlanningPosition, 'farAllowed' | 'farUsed' | 'buildablePotentialSqm' | 'developmentPotential'>;

/** Assumptions behind the `residual_development` sense-check anchor — kept named and in one place so the rationale text and the maths never drift apart. */
const RESIDUAL_DEVELOPMENT_PERIOD_YEARS = 2;
const RESIDUAL_DEVELOPER_MARGIN_PCT = 0.2;
const RESIDUAL_DISCOUNT_RATE_PCT = 0.12;

/**
 * How much a comparable set disagrees with itself, as a coefficient of
 * variation over the adjusted rates.
 *
 * A comparable-driven anchor's confidence must fall as its evidence disperses.
 * Counting comparables alone gets this backwards: seven transactions spanning a
 * 3x rate range are weaker evidence than three that agree, but a count-based
 * score rates them higher. That matters most for land, where widening the
 * search beyond the locality can pull in a genuinely different market.
 */
function rateDispersion(rates: number[]): number {
  if (rates.length < 2) return 0;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return 0;
  const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance) / mean;
}

/** Confidence penalty for a dispersed comparable set. Caps so it never alone zeroes an anchor. */
function dispersionPenalty(rates: number[]): number {
  return clamp(rateDispersion(rates) * 0.8, 0, 0.35);
}

/**
 * Builds the value anchors available for the case. `statutory_reference` and
 * `index_trend` are always present; for a BUILT subject `comparable_sales`,
 * `income_capitalisation`, `depreciated_replacement_cost` and
 * `asking_price_adjusted` are conditional exactly as before. For a LAND
 * subject, `comparable_sales`/`depreciated_replacement_cost` are replaced by
 * `land_rate` (the primary anchor, highest weight) and — where genuine FAR
 * headroom exists — `residual_development` (a low-weight sense check);
 * `income_capitalisation` only applies with a documented lease.
 */
function buildAnchors(
  caseId: string,
  identity: PropertyIdentity,
  comparables: Comparable[],
  locality: LocalityReference,
  matchLevel: LocalityMatchLevel,
  compMatchLevel: LocalityMatchLevel,
  planning: PlanningForAnchors,
  /**
   * The statutory reference rate's display label — "Circle rate" for the
   * bare Country Pack, or a State Pack's own term (Karnataka says
   * "Guidance value") when one covers the case.
   */
  statutoryRateLabel: string,
  documents: CaseDocument[],
  now: string,
  evidence: EvidenceBuilder,
): ValueAnchor[] {
  const anchors: ValueAnchor[] = [];
  const isLand = isLandPropertyType(identity.propertyType);
  const area = identity.builtUpAreaSqm;
  const currency = identity.currency;

  // --- comparable_sales (built subjects only — see land_rate below) ---------
  if (!isLand && comparables.length > 0) {
    const compEvidenceIds = comparables.map(c =>
      evidence.add({
        statement: `${c.label} transacted ${c.transactedAt} at ${Math.round(c.pricePerSqm).toLocaleString()}/sqm, adjusted to ${Math.round(c.adjustedPricePerSqm).toLocaleString()}/sqm.`,
        sourceType: 'comparable',
        sourceRef: c.id,
        sourceLabel: c.source,
        confidence: c.similarity,
      }),
    );
    const weights = comparables.map(c => c.similarity || 0.01);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedMidRate = comparables.reduce((sum, c, i) => sum + c.adjustedPricePerSqm * weights[i], 0) / totalWeight;
    const adjustedRates = comparables.map(c => c.adjustedPricePerSqm);
    const lowRate = Math.min(...adjustedRates);
    const highRate = Math.max(...adjustedRates);
    const avgSimilarity = weights.reduce((a, b) => a + b, 0) / comparables.length;
    const recentCount = comparables.filter(c => monthsBetween(c.transactedAt, now) <= 12).length;
    const spread = dispersionPenalty(adjustedRates);
    const confidence = round2(
      clamp(0.45 + comparables.length * 0.04 + avgSimilarity * 0.25 + (recentCount / comparables.length) * 0.1 - spread, 0, 0.95),
    );
    const matchLabel = matchLevel === 'locality' ? identity.locality : matchLevel === 'city' ? identity.city : identity.country;
    anchors.push({
      id: `anchor-${caseId}-comparable_sales`,
      method: 'comparable_sales',
      label: 'Comparable sales',
      low: roundMoney(lowRate * area, currency),
      mid: roundMoney(weightedMidRate * area, currency),
      high: roundMoney(highRate * area, currency),
      weight: 0.4,
      confidence,
      rationale: `Derived from ${comparables.length} adjusted comparable transaction${comparables.length === 1 ? '' : 's'} in ${matchLabel}, averaging ${round1(avgSimilarity * 100)}% similarity to the subject after adjusting each for time, size, condition and tenure.${
        rateDispersion(adjustedRates) > 0.25
          ? ` The set disagrees widely (${Math.round(lowRate).toLocaleString()}-${Math.round(
              highRate,
            ).toLocaleString()}/sqm), which holds this anchor's confidence down.`
          : ''
      }`,
      evidenceIds: compEvidenceIds,
    });
  }

  // --- land_rate (land subjects only) — the primary anchor for a site -------
  // Land rate from the same adjusted land comparables (see `adjustComparable`,
  // which already layers road-width/corner/facing/dimension/layout-approval
  // adjustments on top of time/size for a land subject) × plot area. Absent
  // entirely — not fabricated — when no land comparable exists anywhere,
  // even after widening city-then-country; `buildRisks`/`buildConfidence`
  // surface that gap instead.
  if (isLand && comparables.length > 0) {
    const landEvidenceIds = comparables.map(c =>
      evidence.add({
        statement: `${c.label} (land) transacted ${c.transactedAt} at ${Math.round(c.pricePerSqm).toLocaleString()}/sqm of plot area, adjusted for time, size and this site's own attributes to ${Math.round(c.adjustedPricePerSqm).toLocaleString()}/sqm.`,
        sourceType: 'comparable',
        sourceRef: c.id,
        sourceLabel: c.source,
        confidence: c.similarity,
      }),
    );
    const weights = comparables.map(c => c.similarity || 0.01);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedMidRate = comparables.reduce((sum, c, i) => sum + c.adjustedPricePerSqm * weights[i], 0) / totalWeight;
    const adjustedRates = comparables.map(c => c.adjustedPricePerSqm);
    const lowRate = Math.min(...adjustedRates);
    const highRate = Math.max(...adjustedRates);
    const avgSimilarity = weights.reduce((a, b) => a + b, 0) / comparables.length;
    const recentCount = comparables.filter(c => monthsBetween(c.transactedAt, now) <= 12).length;

    // Confidence also reflects how much of the subject's own plot data
    // (which drove the plot-specific adjustments above) is actually known,
    // and how far the comparable search had to widen beyond the locality —
    // a land_rate built on assumed-unknown attributes or country-wide comps
    // should not read as confidently as one built on a fully-described,
    // locally-sourced set.
    const plot = identity.plot;
    const knownPlotFacts = [
      plot?.roadWidthFt !== undefined,
      plot?.cornerSite !== undefined,
      plot !== undefined && plot.facing !== 'unknown',
      plot?.dimensionsFt !== undefined,
      plot !== undefined && plot.layoutApproval !== 'unknown',
    ].filter(Boolean).length;
    const plotCompletenessPenalty = (5 - knownPlotFacts) * 0.02;
    const compGeographyPenalty = compMatchLevel === 'country' ? 0.1 : compMatchLevel === 'city' ? 0.04 : 0;
    const spread = dispersionPenalty(adjustedRates);
    const confidence = round2(
      clamp(
        0.5 +
          comparables.length * 0.04 +
          avgSimilarity * 0.25 +
          (recentCount / comparables.length) * 0.1 -
          plotCompletenessPenalty -
          compGeographyPenalty -
          spread,
        0,
        0.95,
      ),
    );
    const matchLabel = compMatchLevel === 'locality' ? identity.locality : compMatchLevel === 'city' ? identity.city : identity.country;

    const plotDescriptors: string[] = [];
    if (plot?.roadWidthFt !== undefined) plotDescriptors.push(`${plot.roadWidthFt}ft road`);
    if (plot?.cornerSite) plotDescriptors.push('corner site');
    if (plot && plot.facing !== 'unknown') plotDescriptors.push(`${plot.facing.replace(/_/g, ' ')} facing`);
    if (plot?.dimensionsFt) plotDescriptors.push(`${plot.dimensionsFt.width}x${plot.dimensionsFt.depth}ft`);
    if (plot && plot.layoutApproval !== 'unknown') {
      // 'revenue_layout' already ends in the word, so don't say "layout layout".
      const approval = plot.layoutApproval.replace(/_/g, ' ');
      plotDescriptors.push(approval.endsWith('layout') ? approval : `${approval} layout`);
    }

    anchors.push({
      id: `anchor-${caseId}-land_rate`,
      method: 'land_rate',
      label: 'Land rate',
      low: roundMoney(lowRate * identity.plotAreaSqm, currency),
      mid: roundMoney(weightedMidRate * identity.plotAreaSqm, currency),
      high: roundMoney(highRate * identity.plotAreaSqm, currency),
      weight: 0.5,
      confidence,
      rationale: `Primary basis for a site: derived from ${comparables.length} adjusted land-parcel comparable${comparables.length === 1 ? '' : 's'} in ${matchLabel}, applied per sqm of plot area and adjusted for time and size${
        plotDescriptors.length > 0 ? `, and this site's own ${plotDescriptors.join(', ')}` : ''
      }.${
        rateDispersion(adjustedRates) > 0.25
          ? ` These comparables disagree widely — adjusted rates run from ${Math.round(lowRate).toLocaleString()} to ${Math.round(
              highRate,
            ).toLocaleString()}/sqm, so confidence in this anchor is held down and the range is genuinely this uncertain.`
          : ''
      }`,
      evidenceIds: landEvidenceIds,
    });
  }

  // --- statutory_reference --------------------------------------------------
  {
    const floorRate = isLand ? locality.statutoryLandRatePerSqm : locality.statutoryRatePerSqm;
    const ceilingRate = isLand ? locality.medianLandRatePerSqm : locality.medianPricePerSqm;
    const statutoryArea = isLand ? identity.plotAreaSqm : area;
    const statutoryEvId = evidence.add({
      statement: isLand
        ? `${statutoryRateLabel} for land in ${locality.locality}, ${locality.city} is ${floorRate.toLocaleString()}/sqm of plot area against a market land rate of ${ceilingRate.toLocaleString()}/sqm.`
        : `${statutoryRateLabel} for ${locality.locality}, ${locality.city} is ${floorRate.toLocaleString()}/sqm against a market median of ${ceilingRate.toLocaleString()}/sqm.`,
      sourceType: 'external_dataset',
      sourceRef: locality.id,
      sourceLabel: locality.source,
      confidence: 0.8,
    });
    // Treated as a floor-to-ceiling band: the statutory rate is a hard floor
    // and the locality market median a ceiling, with the midpoint as the
    // central estimate. This keeps the anchor genuinely distinct from (and
    // more conservative than) the comparable/index anchors.
    const midRate = (floorRate + ceilingRate) / 2;
    const matchPenalty = matchLevel === 'country' ? 0.15 : matchLevel === 'city' ? 0.05 : 0;
    anchors.push({
      id: `anchor-${caseId}-statutory_reference`,
      method: 'statutory_reference',
      label: isLand ? `${statutoryRateLabel} reference (land)` : `${statutoryRateLabel} reference`,
      low: roundMoney(floorRate * statutoryArea, currency),
      mid: roundMoney(midRate * statutoryArea, currency),
      high: roundMoney(ceilingRate * statutoryArea, currency),
      weight: 0.15,
      confidence: round2(clamp(0.7 - matchPenalty, 0.2, 0.9)),
      rationale: isLand
        ? "Uses the statutory land guidance rate as a conservative floor and the locality's transacted land-rate median as a ceiling, applied to the plot area — statutory land rates typically lag realised land prices even more than built-property guidance values, so the midpoint is a cautious central estimate."
        : `Uses the ${statutoryRateLabel.toLowerCase()} as a conservative floor and the locality's transacted market median as a ceiling — statutory rates typically lag realised prices, so the midpoint is the central estimate.`,
      evidenceIds: [statutoryEvId],
    });
  }

  // --- income_capitalisation -------------------------------------------------
  // A bare site earns no rent, so this is suppressed for land subjects unless
  // a lease document genuinely exists (and, in that case, only off the
  // documented rent — never the locality-median-rent estimate a built
  // subject would fall back to, since that estimate itself assumes a built
  // rate that does not apply to land).
  const leaseDoc = documents.find(d => d.kind === 'lease_agreement');
  const rentFieldPreview = leaseDoc?.extracted.find(f => f.key === 'annualRent');
  const showIncomeAnchor = isLand ? Boolean(leaseDoc && rentFieldPreview) : INCOME_ELIGIBLE_TYPES.includes(identity.propertyType) || Boolean(leaseDoc);
  if (showIncomeAnchor) {
    const rentField = leaseDoc?.extracted.find(f => f.key === 'annualRent');
    let annualRent: number;
    let rentEvidenceId: string;
    if (rentField) {
      annualRent = Number(rentField.value);
      rentEvidenceId = evidence.add({
        statement: `Extracted annual rent of ${annualRent.toLocaleString()} ${currency} from the lease agreement.`,
        sourceType: 'document',
        sourceRef: leaseDoc?.id ?? 'lease_agreement',
        sourceLabel: leaseDoc?.fileName ?? 'Lease agreement',
        confidence: rentField.confidence,
      });
    } else {
      annualRent = locality.medianPricePerSqm * locality.grossYield * area;
      rentEvidenceId = evidence.add({
        statement: `No lease on file — annual rent estimated from the locality's ${round1(locality.grossYield * 100)}% gross yield and median rate.`,
        sourceType: 'model_inference',
        sourceRef: 'income_capitalisation.estimatedRent',
        sourceLabel: locality.source,
        confidence: 0.5,
      });
    }
    const capRateBand = 0.008;
    const highValueCapRate = Math.max(locality.grossYield - capRateBand, locality.grossYield * 0.6);
    const lowValueCapRate = locality.grossYield + capRateBand;
    anchors.push({
      id: `anchor-${caseId}-income_capitalisation`,
      method: 'income_capitalisation',
      label: 'Income capitalisation',
      low: roundMoney(annualRent / lowValueCapRate, currency),
      mid: roundMoney(annualRent / locality.grossYield, currency),
      high: roundMoney(annualRent / highValueCapRate, currency),
      weight: rentField ? 0.22 : 0.16,
      confidence: rentField ? 0.75 : 0.5,
      rationale: rentField
        ? 'Capitalises the documented lease rent at the locality gross yield; the range reflects plausible cap-rate movement of ±0.8 percentage points.'
        : `Capitalises an estimated market rent (locality gross yield ${round1(locality.grossYield * 100)}%) — treat as indicative until an actual lease is on file.`,
      evidenceIds: [rentEvidenceId],
    });
  }

  // --- depreciated_replacement_cost -------------------------------------------
  // Suppressed for land subjects — there is no building to depreciate.
  if (!isLand && identity.yearBuilt !== undefined) {
    const age = new Date(now).getFullYear() - identity.yearBuilt;
    const usefulLifeYears = 60;
    const depreciationFactor = clamp(1 - age / usefulLifeYears, 0.3, 1);
    const buildingValue = locality.replacementCostPerSqm * area * depreciationFactor;
    const landValue = identity.plotAreaSqm * locality.statutoryRatePerSqm * 0.5;
    const mid = buildingValue + landValue;
    const rcEvId = evidence.add({
      statement: `Replacement cost of ${locality.replacementCostPerSqm.toLocaleString()}/sqm depreciated ${round1((1 - depreciationFactor) * 100)}% for a ${age}-year-old building, plus land value from the statutory rate.`,
      sourceType: 'model_inference',
      sourceRef: 'depreciated_replacement_cost',
      sourceLabel: locality.source,
      confidence: 0.55,
    });
    anchors.push({
      id: `anchor-${caseId}-depreciated_replacement_cost`,
      method: 'depreciated_replacement_cost',
      label: 'Depreciated replacement cost',
      low: roundMoney(mid * 0.85, currency),
      mid: roundMoney(mid, currency),
      high: roundMoney(mid * 1.15, currency),
      weight: 0.12,
      confidence: age > 30 ? 0.4 : 0.55,
      rationale: `Building cost new, less straight-line depreciation over a ${usefulLifeYears}-year assumed life, plus land value from the statutory rate — most useful as a sense check on older or unique stock rather than a primary anchor.`,
      evidenceIds: [rcEvId],
    });
  }

  // --- asking_price_adjusted --------------------------------------------------
  if (identity.askingPrice !== undefined) {
    const askEvId = evidence.add({
      statement: `Seller-quoted asking price of ${identity.askingPrice.toLocaleString()} ${currency}.`,
      sourceType: 'user_input',
      sourceRef: 'identity.askingPrice',
      sourceLabel: 'Case identity — asking price',
      confidence: 0.99,
    });
    anchors.push({
      id: `anchor-${caseId}-asking_price_adjusted`,
      method: 'asking_price_adjusted',
      label: 'Asking price (adjusted)',
      low: roundMoney(identity.askingPrice * 0.95, currency),
      mid: roundMoney(identity.askingPrice, currency),
      high: roundMoney(identity.askingPrice * 1.03, currency),
      weight: 0.05,
      confidence: 0.25,
      rationale: 'An asking price is a claim by the seller, not evidence of value — included at deliberately low weight and confidence, mainly to compute the asking-vs-mid gap.',
      evidenceIds: [askEvId],
    });
  }

  // --- index_trend -------------------------------------------------------
  // Trends the land rate, per sqm of plot area, for a land subject.
  {
    const trendRate = isLand ? locality.medianLandRatePerSqm : locality.medianPricePerSqm;
    const trendArea = isLand ? identity.plotAreaSqm : area;
    const trendEvId = evidence.add({
      statement: isLand
        ? `Locality median land rate of ${trendRate.toLocaleString()}/sqm of plot area, trending ${round1(locality.yoyChangePct)}% YoY across ${locality.sampleSize} sampled transactions.`
        : `Locality median of ${trendRate.toLocaleString()}/sqm, trending ${round1(locality.yoyChangePct)}% YoY across ${locality.sampleSize} sampled transactions.`,
      sourceType: 'external_dataset',
      sourceRef: locality.id,
      sourceLabel: locality.source,
      confidence: 0.75,
    });
    const band = clamp(0.05 + (100 / Math.max(locality.sampleSize, 10)) * 0.05, 0.05, 0.18);
    const mid = trendRate * trendArea;
    anchors.push({
      id: `anchor-${caseId}-index_trend`,
      method: 'index_trend',
      label: isLand ? 'Locality land-rate index trend' : 'Locality index trend',
      low: roundMoney(mid * (1 - band), currency),
      mid: roundMoney(mid, currency),
      high: roundMoney(mid * (1 + band), currency),
      weight: isLand ? 0.2 : 0.22,
      confidence: round2(clamp(0.8 - (band - 0.05), 0.3, 0.85)),
      rationale: isLand
        ? `Locality median land rate per sqm applied to the plot area; the band widens for thinner samples (${locality.sampleSize} transactions).`
        : `Locality median price per sqm applied to the built-up area; the band widens for thinner samples (${locality.sampleSize} transactions).`,
      evidenceIds: [trendEvId],
    });
  }

  // --- residual_development (land subjects with real FAR headroom) ----------
  // A sense-check on development potential, not a market price: values the
  // permitted envelope as built product, nets construction cost and a
  // developer's margin, and discounts the result back to a land value today.
  // Skipped entirely when development potential is 'none' or 'limited', and
  // whenever the maths comes out non-positive (the development would destroy
  // value, not create it) — either way this is never fabricated to look like
  // a viable scheme it is not.
  if (isLand && (planning.developmentPotential === 'moderate' || planning.developmentPotential === 'significant')) {
    const buildableSqm = planning.buildablePotentialSqm;
    const gdv = buildableSqm * locality.medianPricePerSqm;
    const constructionCost = buildableSqm * locality.replacementCostPerSqm;
    const developerMargin = gdv * RESIDUAL_DEVELOPER_MARGIN_PCT;
    const residualToday = (gdv - constructionCost - developerMargin) / Math.pow(1 + RESIDUAL_DISCOUNT_RATE_PCT, RESIDUAL_DEVELOPMENT_PERIOD_YEARS);
    if (residualToday > 0) {
      const rdEvId = evidence.add({
        statement: `Permitted envelope of ${Math.round(buildableSqm).toLocaleString()} sqm at FAR ${locality.farAllowed}, built at ${locality.replacementCostPerSqm.toLocaleString()}/sqm and sold at the locality's built median of ${locality.medianPricePerSqm.toLocaleString()}/sqm, less a ${round1(RESIDUAL_DEVELOPER_MARGIN_PCT * 100)}% developer margin, discounted ${round1(RESIDUAL_DISCOUNT_RATE_PCT * 100)}%/yr over an assumed ${RESIDUAL_DEVELOPMENT_PERIOD_YEARS}-year build-and-sell period.`,
        sourceType: 'model_inference',
        sourceRef: 'residual_development',
        sourceLabel: locality.source,
        confidence: 0.4,
      });
      const band = 0.18;
      anchors.push({
        id: `anchor-${caseId}-residual_development`,
        method: 'residual_development',
        label: 'Residual development value',
        low: roundMoney(residualToday * (1 - band), currency),
        mid: roundMoney(residualToday, currency),
        high: roundMoney(residualToday * (1 + band), currency),
        weight: 0.08,
        confidence: planning.developmentPotential === 'significant' ? 0.45 : 0.35,
        rationale: `A sense-check on development potential, not a market price: values the FAR-${locality.farAllowed} permitted envelope as built product at the locality's median sale rate, nets off construction cost and a ${round1(RESIDUAL_DEVELOPER_MARGIN_PCT * 100)}% developer margin, and discounts the result back to today at ${round1(RESIDUAL_DISCOUNT_RATE_PCT * 100)}%/yr over an assumed ${RESIDUAL_DEVELOPMENT_PERIOD_YEARS}-year timeline. It depends on construction-cost, margin and absorption assumptions this screen cannot independently verify, so it carries lower weight and lower confidence than the direct land-rate anchor.`,
        evidenceIds: [rdEvId],
      });
    }
  }

  return anchors;
}

/** Blends anchors into a single low/mid/high, normalising by each anchor's relative weight. */
function blendIndicativeValue(anchors: ValueAnchor[], currency: CurrencyCode): { low: number; mid: number; high: number } {
  const totalWeight = anchors.reduce((s, a) => s + a.weight, 0) || 1;
  const low = anchors.reduce((s, a) => s + a.low * a.weight, 0) / totalWeight;
  const mid = anchors.reduce((s, a) => s + a.mid * a.weight, 0) / totalWeight;
  const high = anchors.reduce((s, a) => s + a.high * a.weight, 0) / totalWeight;
  return { low: roundMoney(low, currency), mid: roundMoney(mid, currency), high: roundMoney(high, currency) };
}

/**
 * "Range Before False Precision": widen the low/high band around the (fixed)
 * mid when confidence is low, so a thin-evidence case visibly shows a wider
 * spread rather than a falsely tight one.
 */
function widenForConfidence(
  base: { low: number; mid: number; high: number },
  band: ConfidenceBand,
  currency: CurrencyCode,
): { low: number; mid: number; high: number } {
  const factor = band === 'low' ? 1.5 : band === 'moderate' ? 1.15 : 1.0;
  const low = base.mid - (base.mid - base.low) * factor;
  const high = base.mid + (base.high - base.mid) * factor;
  return { low: roundMoney(Math.max(low, 0), currency), mid: base.mid, high: roundMoney(high, currency) };
}

/* ==================================================================== */
/* Value drivers                                                         */
/* ==================================================================== */

/**
 * Produces a bounded set of itemised drivers plus one reconciling driver.
 * Four are always applicable (tenure, locality liquidity, transit proximity,
 * planning headroom); floor level, building age, encumbrance/energy-label,
 * tenancy-in-place and — for Karnataka cases — the B-khata discount,
 * occupancy-certificate absence and gram-panchayat jurisdiction drivers are
 * added only when the underlying data exists. For a LAND subject, five more
 * plot-specific drivers (road width, corner site, facing, dimension
 * standardness, layout approval) reconcile to the locality LAND rate rather
 * than the built median, and occupancy-certificate absence is skipped
 * entirely — there is no structure on a bare site to have been occupied. A
 * final reconciling driver absorbs whatever gap between the subject's own mid
 * rate and the relevant locality median the itemised drivers don't explain,
 * so the list is not just decorative — it actually adds up to the anchor
 * blend.
 */
function buildDrivers(
  caseId: string,
  identity: PropertyIdentity,
  locality: LocalityReference,
  planning: { farAllowed: number; farUsed: number },
  documents: CaseDocument[],
  baseMidPerSqm: number,
  now: string,
  evidence: EvidenceBuilder,
  siteContext: SiteContext | undefined,
): ValueDriver[] {
  const drivers: ValueDriver[] = [];
  let idx = 0;
  const nextId = (): string => {
    idx += 1;
    return `driver-${caseId}-${String(idx).padStart(2, '0')}`;
  };
  const directionOf = (pct: number): ValueDriver['direction'] => (pct > 0.5 ? 'positive' : pct < -0.5 ? 'negative' : 'neutral');
  const push = (label: string, impactPct: number, category: DriverCategory, explanation: string, evidenceIds: string[]): void => {
    drivers.push({ id: nextId(), label, direction: directionOf(impactPct), impactPct: round1(impactPct), category, explanation, evidenceIds });
  };

  // Tenure — always applicable.
  {
    let pct = 1;
    let text = 'Freehold tenure supports full comparability with the (predominantly freehold) comparable pool.';
    if (identity.tenure === 'leasehold') {
      pct = -6;
      text = 'Leasehold tenure is priced at a discount to the predominantly freehold comparable pool.';
    } else if (identity.tenure === 'unknown') {
      pct = -4;
      text = 'Tenure has not been confirmed from documents on file, so value is priced conservatively until it is.';
    }
    const evId = evidence.add({ statement: `Tenure recorded as ${identity.tenure}.`, sourceType: 'user_input', sourceRef: 'identity.tenure', sourceLabel: 'Case identity — tenure', confidence: 0.95 });
    push('Tenure', pct, 'legal', text, [evId]);
  }

  // Plot-specific drivers — land subjects only. Each reconciles the subject
  // toward the locality LAND rate (see the reconciling driver at the bottom),
  // and mirrors the same adjustments `adjustComparable` applies to land
  // comparables, so the value driver list and the land_rate anchor never
  // silently disagree about what the site's own attributes are worth.
  const isLand = isLandPropertyType(identity.propertyType);
  if (isLand) {
    const plot = identity.plot;

    if (plot?.roadWidthFt !== undefined) {
      const pct = roadWidthAdjustmentPct(plot.roadWidthFt);
      const evId = evidence.add({ statement: `Abutting road width recorded as ${plot.roadWidthFt}ft.`, sourceType: 'user_input', sourceRef: 'identity.plot.roadWidthFt', sourceLabel: 'Case identity — plot road width', confidence: 0.85 });
      push(
        'Road width',
        pct,
        'location',
        `A ${plot.roadWidthFt}ft abutting road ${pct >= 0 ? 'supports easier access and higher permissible FAR, both priced as a premium' : 'is narrower than the layout norm, constraining access and permissible FAR'}.`,
        [evId],
      );
    }

    if (plot?.cornerSite !== undefined) {
      const pct = cornerSiteAdjustmentPct(plot.cornerSite);
      const evId = evidence.add({ statement: `Corner-site status recorded as ${plot.cornerSite ? 'yes' : 'no'}.`, sourceType: 'user_input', sourceRef: 'identity.plot.cornerSite', sourceLabel: 'Case identity — corner site', confidence: 0.9 });
      push(
        'Corner site',
        pct,
        'location',
        plot.cornerSite ? 'Dual road frontage and better access earn a genuine corner-site premium.' : 'Not a corner site — priced at the layout baseline rather than the corner premium.',
        [evId],
      );
    }

    if (plot && plot.facing !== 'unknown') {
      const pct = FACING_ADJUSTMENT_PCT[plot.facing];
      const facingLabel = plot.facing.replace(/_/g, ' ');
      const evId = evidence.add({ statement: `Site facing recorded as ${facingLabel}.`, sourceType: 'user_input', sourceRef: 'identity.plot.facing', sourceLabel: 'Case identity — plot facing', confidence: 0.85 });
      push(
        'Facing',
        pct,
        'location',
        `${facingLabel[0].toUpperCase()}${facingLabel.slice(1)}-facing sites ${pct > 0 ? 'command a measurable premium' : pct < 0 ? 'trade at a discount' : 'are priced at the layout norm'} in the Bengaluru market.`,
        [evId],
      );
    }

    if (plot?.dimensionsFt) {
      const pct = dimensionStandardnessAdjustmentPct(plot.dimensionsFt);
      const evId = evidence.add({
        statement: `Site dimensions recorded as ${plot.dimensionsFt.width}ft x ${plot.dimensionsFt.depth}ft.`,
        sourceType: 'user_input',
        sourceRef: 'identity.plot.dimensionsFt',
        sourceLabel: 'Case identity — plot dimensions',
        confidence: 0.85,
      });
      push(
        'Dimension standardness',
        pct,
        'location',
        pct >= 0 ? 'A near-standard site shape resells more easily than an irregular one.' : 'An elongated, non-standard shape is harder to resell and is priced at a discount.',
        [evId],
      );
    }

    {
      const layoutApproval = plot?.layoutApproval ?? 'unknown';
      const pct = LAYOUT_APPROVAL_ADJUSTMENT_PCT[layoutApproval];
      const layoutLabel = layoutApproval.replace(/_/g, ' ');
      const evId = evidence.add({
        statement: `Layout approval recorded as ${layoutLabel}.`,
        sourceType: 'user_input',
        sourceRef: 'identity.plot.layoutApproval',
        sourceLabel: 'Case identity — layout approval',
        confidence: layoutApproval === 'unknown' ? 0.4 : 0.9,
      });
      const explanation =
        layoutApproval === 'bda_approved'
          ? 'BDA approval is the most bankable layout status and carries a real premium.'
          : layoutApproval === 'revenue_layout'
            ? 'A revenue layout (not a sanctioned residential layout) trades at a heavy discount and is hard to finance.'
            : layoutApproval === 'unapproved'
              ? 'An unapproved layout is the weakest possible status — hard to finance, hard to resell, and exposed to regularisation risk.'
              : layoutApproval === 'unknown'
                ? 'Layout approval status has not been confirmed, so value is priced conservatively until it is.'
                : `${layoutLabel} status is priced relative to a BDA-approved layout.`;
      push('Layout approval', pct, 'legal', explanation, [evId]);
    }
  }

  // B-khata discount — Karnataka only. B-khata property is shut out of
  // normal home-loan financing, which narrows the buyer pool to cash buyers
  // only and forces a real transaction-price discount independent of the
  // property's physical quality — placed early so it survives the cap below.
  if (identity.karnataka?.khataType === 'b_khata') {
    const evId = evidence.add({
      statement: 'Khata classification recorded as B-khata.',
      sourceType: 'user_input',
      sourceRef: 'identity.karnataka.khataType',
      sourceLabel: 'Case identity — Karnataka khata type',
      confidence: 0.9,
    });
    push(
      'B-khata discount',
      -12,
      'legal',
      'B-khata properties cannot get a home loan from scheduled banks, which narrows the buyer pool to cash buyers only — this alone typically forces a real transaction-price discount versus equivalent A-khata stock, independent of the property\'s physical quality.',
      [evId],
    );
  }

  // Gram Panchayat jurisdiction — Karnataka only. Outside BBMP/BDA limits,
  // height/density caps and lender caution both compress achievable value.
  if (identity.karnataka?.jurisdiction === 'gram_panchayat') {
    const evId = evidence.add({
      statement: 'Jurisdiction recorded as Gram Panchayat (outside BBMP/BDA limits).',
      sourceType: 'user_input',
      sourceRef: 'identity.karnataka.jurisdiction',
      sourceLabel: 'Case identity — Karnataka jurisdiction',
      confidence: 0.85,
    });
    push(
      'Gram Panchayat jurisdiction',
      -6,
      'legal',
      'Property sits outside BBMP/BDA limits under Gram Panchayat jurisdiction, which caps building height/density and is viewed more cautiously by mainstream lenders than BBMP-khata stock.',
      [evId],
    );
  }

  // Occupancy certificate absence — Karnataka only (this is distinct from,
  // and applies more broadly than, the age-triggered OC risk below). Not
  // applicable to land: a bare site has no structure to have been occupied.
  if (!isLand && identity.karnataka && !documents.some(d => d.kind === 'occupancy_certificate')) {
    const evId = evidence.add({
      statement: 'No occupancy certificate on file.',
      sourceType: 'model_inference',
      sourceRef: 'documents.occupancy_certificate',
      sourceLabel: 'Document completeness',
      confidence: 0.65,
    });
    push(
      'Occupancy certificate absence',
      -5,
      'legal',
      'Absent an OC, compliance with the sanctioned plan cannot be confirmed — both lenders and cautious buyers price this in as a discount.',
      [evId],
    );
  }

  // Locality liquidity — always applicable, continuous around a 60-day baseline.
  {
    const pct = clamp(((60 - locality.liquidityDays) / 60) * 4, -4, 4);
    const evId = evidence.add({ statement: `Median time-to-transact in ${locality.locality} is ${locality.liquidityDays} days.`, sourceType: 'external_dataset', sourceRef: locality.id, sourceLabel: locality.source, confidence: 0.7 });
    push(
      'Locality liquidity',
      pct,
      'market',
      `${locality.liquidityDays}-day median liquidity in the locality ${pct >= 0 ? 'supports a faster exit and a modest premium' : 'signals softer demand and is priced as a discount'}.`,
      [evId],
    );
  }

  // Transit proximity.
  //
  // Two ways to arrive at the same driver, and they are not interchangeable.
  //
  // The measured path runs only when a mapping provider located this property
  // *specifically* — `sitePinIsAccurate` gates on the geocode precision, and
  // a pin that landed on the centre of the locality is refused here even
  // though it is a perfectly good pin to draw on a map. A locality-centre
  // measurement is a fact about the locality, and the estimate below is
  // already a fact about the locality that says so; swapping one for the
  // other would trade a figure that admits what it is for one that does not,
  // while looking like an upgrade.
  //
  // The estimated path is the original behaviour, unchanged: a deterministic
  // per-case figure biased closer when the locality's own infrastructure note
  // mentions rail/metro/tram access. It is labelled as an inference, priced
  // identically, and carries half the confidence.
  {
    const transit = sitePinIsAccurate(siteContext) ? nearestTransit(siteContext) : undefined;
    if (transit && siteContext?.location) {
      const { metres, basis } = amenityDistance(transit);
      const distanceKm = round2(metres / 1000);
      const pct = clamp((1.5 - distanceKm) * 2, -3, 3);
      const basisText =
        basis === 'driving'
          ? 'by road'
          : 'in a straight line (no road-distance measurement was available, so the real journey is longer)';
      const evId = evidence.add({
        statement:
          `Distance to the nearest rapid-transit stop, ${transit.name}: ${distanceKm} km ${basisText}, measured from the ` +
          `located position of the property (${siteContext.location.resolvedAddress}) via ${siteContext.provider}.`,
        sourceType: 'external_dataset',
        sourceRef: 'siteContext.amenities.transit',
        sourceLabel: `${siteContext.provider} mapping data`,
        // Not 1.0. The distance is measured, but it is measured from a
        // geocoded address rather than from a surveyed corner, and it is a
        // distance to a station entrance the provider placed, not to a
        // platform.
        confidence: basis === 'driving' ? 0.85 : 0.75,
      });
      push('Transit proximity', pct, 'location', `${distanceKm} km from ${transit.name}, measured ${basis === 'driving' ? 'by road' : 'in a straight line'}.`, [evId]);
    } else {
      const infra = locality.infrastructureNote.toLowerCase();
      const nearTransit = /metro|rail|station|tram/.test(infra);
      const distanceKm = round2(seededRange(`${caseId}:metro`, nearTransit ? 0.2 : 1.0, nearTransit ? 1.2 : 3.0));
      const pct = clamp((1.5 - distanceKm) * 2, -3, 3);

      // When a mapping provider *did* find a station and this driver declined
      // to use it, say so here.
      //
      // Without this the case shows two different distances to the same metro
      // station on two different screens — a measured one on the location
      // view and an estimated one here — and nothing accounts for the gap.
      // Two unexplained numbers for one fact is worse than either number
      // alone, and the explanation is short: the pin those metres were
      // measured from is the middle of the locality, so they are a fact about
      // the locality and not about this site.
      const declined = siteContext?.location && nearestTransit(siteContext);
      const because = declined
        ? ` A nearby stop was found on the map, but the address on file only located to ${siteContext.location!.resolvedAddress} rather than to this property, so the distance measured from it is not used here.`
        : '';

      const evId = evidence.add({
        statement:
          `Estimated distance to the nearest rapid-transit stop: ${distanceKm} km (inferred from the locality's infrastructure note, not a measured survey).${because}`,
        sourceType: 'model_inference',
        sourceRef: 'drivers.transitProximity',
        sourceLabel: 'Locality infrastructure note',
        confidence: 0.5,
      });
      push('Transit proximity', pct, 'location', `Estimated ${distanceKm} km from the nearest rapid-transit stop.${because}`, [evId]);
    }
  }

  // Planning / FAR headroom — always applicable.
  {
    const headroom = planning.farAllowed - planning.farUsed;
    let pct: number;
    let text: string;
    if (headroom > 0.5) {
      pct = 3;
      text = `${round1(headroom)} FAR of unused development headroom is available under current zoning.`;
    } else if (headroom >= 0) {
      pct = 1;
      text = `A modest ${round1(headroom)} FAR of headroom remains under current zoning.`;
    } else {
      pct = -5;
      text = `Built FAR already exceeds the ${planning.farAllowed} allowed — this constrains upside and creates regularisation risk.`;
    }
    const evId = evidence.add({ statement: `FAR allowed ${planning.farAllowed} vs FAR used ${round2(planning.farUsed)}.`, sourceType: 'model_inference', sourceRef: 'planning.farUsed', sourceLabel: 'Planning position', confidence: 0.7 });
    push('Planning / FAR headroom', pct, 'planning', text, [evId]);
  }

  // Floor position — conditional on floor/totalFloors being known.
  if (identity.floor !== undefined && identity.totalFloors !== undefined && identity.totalFloors > 0) {
    const rel = identity.floor / identity.totalFloors;
    let pct = 0;
    let text = '';
    if (rel >= 0.66) {
      pct = 3;
      text = `Floor ${identity.floor} of ${identity.totalFloors} carries a light/view premium.`;
    } else if (identity.floor <= 1) {
      pct = -2.5;
      text = 'Ground/first-floor position typically trades at a discount for privacy and noise.';
    }
    if (pct !== 0) {
      const evId = evidence.add({ statement: `Unit is on floor ${identity.floor} of ${identity.totalFloors}.`, sourceType: 'user_input', sourceRef: 'identity.floor', sourceLabel: 'Case identity — floor', confidence: 0.9 });
      push('Floor position', pct, 'building', text, [evId]);
    }
  }

  // Building age — conditional on yearBuilt being known.
  if (identity.yearBuilt !== undefined) {
    const age = new Date(now).getFullYear() - identity.yearBuilt;
    let pct: number;
    if (age < 5) pct = 3;
    else if (age <= 15) pct = 1;
    else if (age <= 30) pct = -2;
    else pct = -5;
    const evId = evidence.add({ statement: `Building age is ${age} years (built ${identity.yearBuilt}).`, sourceType: 'user_input', sourceRef: 'identity.yearBuilt', sourceLabel: 'Case identity — year built', confidence: 0.9 });
    push('Building age', pct, 'building', `${age}-year-old building — ${pct >= 0 ? 'still within its low-maintenance window' : 'ageing toward higher near-term maintenance capex'}.`, [evId]);
  }

  // Encumbrance history — India only.
  if (identity.country === 'IN') {
    const ecDoc = documents.find(d => d.kind === 'encumbrance_certificate');
    const pct = ecDoc ? 2 : -4;
    const evId = evidence.add({
      statement: ecDoc ? 'Encumbrance certificate on file shows a clean chain of title.' : 'No encumbrance certificate on file to confirm a clean chain of title.',
      sourceType: ecDoc ? 'document' : 'model_inference',
      sourceRef: ecDoc ? ecDoc.id : 'completeness.encumbrance_certificate',
      sourceLabel: ecDoc ? ecDoc.fileName : 'Document completeness',
      confidence: ecDoc ? 0.85 : 0.6,
    });
    push(
      'Encumbrance history',
      pct,
      'legal',
      ecDoc ? 'A clean encumbrance certificate supports full value realisation.' : 'Absent an encumbrance certificate, value is priced conservatively against unresolved title risk.',
      [evId],
    );
  }

  // Energy label — Netherlands only, and only when the document has actually been extracted.
  if (identity.country === 'NL') {
    const labelDoc = documents.find(d => d.kind === 'energy_label');
    const labelField = labelDoc?.extracted.find(f => f.key === 'energyLabel');
    if (labelDoc && labelField) {
      const map: Record<string, number> = { A: 4, B: 2, C: 0, D: -1, E: -3, F: -5, G: -7 };
      const pct = map[labelField.value] ?? 0;
      const evId = evidence.add({ statement: `Energy label ${labelField.value} on file.`, sourceType: 'document', sourceRef: labelDoc.id, sourceLabel: labelDoc.fileName, confidence: labelField.confidence });
      push(
        'Energy label',
        pct,
        'building',
        `Energy label ${labelField.value} ${pct >= 0 ? 'is at or above the market norm' : 'is below the market norm and may deter buyers facing minimum-label rules'}.`,
        [evId],
      );
    }
  }

  // Tenancy in place — conditional on a lease agreement being on file.
  {
    const leaseDoc = documents.find(d => d.kind === 'lease_agreement');
    if (leaseDoc) {
      const evId = evidence.add({ statement: 'A lease agreement on file evidences in-place income.', sourceType: 'document', sourceRef: leaseDoc.id, sourceLabel: leaseDoc.fileName, confidence: 0.8 });
      push('Tenancy in place', 2, 'tenancy', 'A signed lease evidences in-place income and reduces near-term letting-void risk.', [evId]);
    }
  }

  // Cap the itemised set at 14 (land cases can carry five plot-specific
  // drivers on top of the Karnataka-specific ones) so a reconciling driver
  // always fits on top.
  const explicit = drivers.slice(0, 14);

  const benchmarkRate = isLand ? locality.medianLandRatePerSqm : locality.medianPricePerSqm;
  const gapPct = ((baseMidPerSqm - benchmarkRate) / benchmarkRate) * 100;
  const explainedPct = explicit.reduce((s, d) => s + d.impactPct, 0);
  const residualPct = round1(gapPct - explainedPct);
  const gapEvId = evidence.add({
    statement: isLand
      ? `Subject mid land rate of ${round1(baseMidPerSqm).toLocaleString()}/sqm vs locality median land rate ${benchmarkRate.toLocaleString()}/sqm implies a ${round1(gapPct)}% overall gap.`
      : `Subject mid rate of ${round1(baseMidPerSqm).toLocaleString()}/sqm vs locality median ${benchmarkRate.toLocaleString()}/sqm implies a ${round1(gapPct)}% overall gap.`,
    sourceType: 'model_inference',
    sourceRef: 'drivers.reconciliation',
    sourceLabel: locality.source,
    confidence: 0.55,
  });
  explicit.push({
    id: nextId(),
    label: 'Other locality-specific positioning',
    direction: directionOf(residualPct),
    impactPct: residualPct,
    category: 'market',
    explanation:
      'Captures the remaining gap between the subject and the locality median not itemised by the drivers above (micro-location, finish quality, aspect, and other unmodelled factors).',
    evidenceIds: [gapEvId],
  });

  return explicit;
}

/* ==================================================================== */
/* Risk flags                                                            */
/* ==================================================================== */

/**
 * Derives risk flags from real, checkable conditions rather than a fixed
 * template — a case only gets a `RiskFlag` when its data actually triggers
 * the corresponding rule. `status` is carried over from `previousResult` by
 * matching `code`, so a risk a user has already marked `mitigated` /
 * `accepted` stays that way across re-screens instead of reverting to `open`.
 */
/**
 * Builds a `(code, ...) -> RiskFlag` factory closed over one case id and its
 * previous result, so any part of the engine that discovers real jeopardy —
 * `buildRisks` itself, or `buildStateCompliance` below — can mint a `RiskFlag`
 * with the same id scheme (`risk-<caseId>-<code>`) and the same `status`
 * carry-over semantics, keeping Risks and Compliance from ever disagreeing
 * about what a risk's id or status is.
 */
function makeRiskFactory(
  caseId: string,
  previousResult: ScreenResult | undefined,
): (code: string, title: string, severity: RiskSeverity, category: RiskCategory, description: string, impact: string, mitigation: string, evidenceIds: string[]) => RiskFlag {
  return (code, title, severity, category, description, impact, mitigation, evidenceIds) => {
    const previous = previousResult?.risks.find(r => r.code === code);
    return {
      id: `risk-${caseId}-${code}`,
      code,
      title,
      severity,
      category,
      description,
      impact,
      mitigation,
      evidenceIds,
      status: previous?.status ?? 'open',
    };
  };
}

function buildRisks(
  caseId: string,
  identity: PropertyIdentity,
  documents: CaseDocument[],
  completeness: CompletenessSummary,
  comparables: Comparable[],
  locality: LocalityReference,
  matchLevel: LocalityMatchLevel,
  compMatchLevel: LocalityMatchLevel,
  countryPack: CountryPack,
  statePack: StatePack | undefined,
  planning: { farAllowed: number; farUsed: number },
  askingVsMidPctRaw: number | null,
  now: string,
  previousResult: ScreenResult | undefined,
  evidence: EvidenceBuilder,
): RiskFlag[] {
  const isLand = isLandPropertyType(identity.propertyType);
  const risks: RiskFlag[] = [];
  const makeRisk = makeRiskFactory(caseId, previousResult);

  const mk = (
    code: string,
    title: string,
    severity: RiskSeverity,
    category: RiskCategory,
    description: string,
    impact: string,
    mitigation: string,
    evidenceIds: string[],
  ): void => {
    risks.push(makeRisk(code, title, severity, category, description, impact, mitigation, evidenceIds));
  };

  // India sets its property-register instrument, stamp duty and registration fee
  // at state level, so a pack calibrated for one state cannot silently be
  // applied to another. Phase 1 covers a single state/metro; anything outside
  // it is flagged rather than screened against the wrong document set.
  if (identity.state && !countryPack.coveredStates.includes(identity.state)) {
    const evId = evidence.add({
      statement:
        `Property is in ${identity.state}, which is outside this release's covered ` +
        `${countryPack.countryName} coverage (${countryPack.coveredStates.join(', ')}).`,
      sourceType: 'model_inference',
      sourceRef: 'countryPack.coveredStates',
      sourceLabel: `${countryPack.countryName} country pack — coverage`,
      confidence: 0.99,
    });
    mk(
      'outside_covered_state',
      'Outside the covered state for this release',
      'serious',
      'data',
      `This release calibrates ${countryPack.countryName} rules for ${countryPack.coveredStates.join(', ')} only. ` +
        `${identity.state} sets its own registration instrument, stamp duty and registration fee, so the required-document ` +
        `list, statutory rate basis and transaction costs applied here are not this state's.`,
      'Document completeness, the statutory reference anchor and transaction-cost figures may all be wrong for this property — ' +
        'the screen should be read as indicative of the market only, not of the legal position.',
      `Treat the document checklist as provisional and confirm ${identity.state}'s own register extract, stamp duty and ` +
        'registration requirements with a local adviser. A State / Municipality Pack for this state is planned for Phase 2.',
      [evId],
    );
  }

  if (completeness.missingCritical.length > 0) {
    const evId = evidence.add({
      statement: `${completeness.missingCritical.length} required document(s) missing: ${completeness.missingCritical.join(', ')}.`,
      sourceType: 'model_inference',
      sourceRef: 'completeness.missingCritical',
      sourceLabel: 'Document completeness',
      confidence: 0.95,
    });
    mk(
      'missing_critical_documents',
      'Required documents missing',
      completeness.missingCritical.length >= 3 ? 'critical' : 'serious',
      'data',
      `${completeness.missingCritical.length} of the documents this country pack treats as critical are not on file: ${completeness.missingCritical.join(', ')}.`,
      'Key facts (title chain, statutory value, or compliance status) cannot be independently verified until these are produced.',
      'Request the missing documents from the seller or the relevant registry before proceeding.',
      [evId],
    );
  }

  if (identity.tenure === 'leasehold') {
    const evId = evidence.add({ statement: 'Tenure recorded as leasehold.', sourceType: 'user_input', sourceRef: 'identity.tenure', sourceLabel: 'Case identity — tenure', confidence: 0.95 });
    mk(
      'leasehold_tenure',
      'Leasehold tenure',
      'warning',
      'title',
      'The property is held on a leasehold rather than freehold basis.',
      'Remaining lease term, ground rent / renewal terms and any transfer restrictions can materially affect resale value and financing.',
      'Obtain the lease deed and confirm remaining term, rent reviews and renewal/transfer conditions.',
      [evId],
    );
  } else if (identity.tenure === 'unknown') {
    const evId = evidence.add({ statement: 'Tenure has not been confirmed.', sourceType: 'user_input', sourceRef: 'identity.tenure', sourceLabel: 'Case identity — tenure', confidence: 0.5 });
    mk(
      'unknown_tenure',
      'Tenure not confirmed',
      'serious',
      'title',
      'The case does not yet confirm whether the property is freehold or leasehold.',
      'Tenure is a first-order driver of value and mortgageability; the screen has priced this conservatively until it is resolved.',
      'Confirm tenure from the title deed / kadaster extract before relying on the indicative value.',
      [evId],
    );
  }

  if (identity.country === 'IN' && !documents.some(d => d.kind === 'encumbrance_certificate')) {
    const evId = evidence.add({ statement: 'No encumbrance certificate on file.', sourceType: 'model_inference', sourceRef: 'documents.encumbrance_certificate', sourceLabel: 'Document completeness', confidence: 0.9 });
    mk(
      'no_encumbrance_certificate',
      'Encumbrance certificate missing',
      'critical',
      'title',
      'No encumbrance certificate has been produced to evidence a clean chain of title over the statutory look-back period.',
      'Undisclosed mortgages, liens or litigation on the property would not be visible without this document — normally a precondition for any offer.',
      'Obtain a fresh encumbrance certificate (13–30 year) from the Sub-Registrar before making an offer.',
      [evId],
    );
  }

  if (askingVsMidPctRaw !== null && askingVsMidPctRaw > 15) {
    const evId = evidence.add({ statement: `Asking price sits ${round1(askingVsMidPctRaw)}% above the indicative mid value.`, sourceType: 'model_inference', sourceRef: 'indicativeValue.askingVsMidPct', sourceLabel: 'Indicative value', confidence: 0.8 });
    mk(
      'asking_price_above_mid',
      'Asking price well above indicative value',
      askingVsMidPctRaw > 30 ? 'serious' : 'warning',
      'financial',
      `The asking price is ${round1(askingVsMidPctRaw)}% above the indicative mid value derived from comparables, statutory reference and market trend.`,
      'Paying at or near asking would mean paying a premium the underlying evidence does not currently support.',
      'Use the anchor breakdown and comparables to support a negotiation, or seek an independent valuation before matching the ask.',
      [evId],
    );
  }

  if (comparables.length < 4 || locality.sampleSize < 40) {
    const evId = evidence.add({
      statement: `Only ${comparables.length} comparable(s) selected against a locality sample size of ${locality.sampleSize}.`,
      sourceType: 'model_inference',
      sourceRef: 'comparables.count',
      sourceLabel: 'Comparable selection',
      confidence: 0.8,
    });
    mk(
      'thin_comparable_evidence',
      'Thin comparable evidence',
      'warning',
      'market',
      `Only ${comparables.length} usable comparable transaction(s) were found, against a locality sample size of ${locality.sampleSize}.`,
      'A small comparable set makes the comparable-sales anchor more sensitive to any one transaction and widens genuine uncertainty in the value range.',
      'Commission a local agent opinion or a formal valuation to supplement the comparable set.',
      [evId],
    );
  }

  // Land-comparable geography — says so, through the same risk/confidence
  // machinery as `locality_data_thin` above, rather than silently falling
  // back to built comparables when a site's own locality has too few land
  // transactions. Distinct from `thin_comparable_evidence`: this is
  // specifically about having had to widen the SEARCH GEOGRAPHY for a land
  // subject, not about the resulting count being small.
  if (isLand) {
    if (comparables.length === 0) {
      const evId = evidence.add({
        statement: `No land-parcel comparables were found for this site anywhere in the reference pool, even after widening the search to a country-wide proxy.`,
        sourceType: 'model_inference',
        sourceRef: 'comparables.landSearch',
        sourceLabel: 'Comparable selection',
        confidence: 0.8,
      });
      mk(
        'no_land_comparables',
        'No land-parcel comparables available',
        'serious',
        'market',
        'No comparable land/plot transactions were found for this site, even after widening the search to a country-wide proxy.',
        'The land-rate anchor could not be built at all — the indicative value rests only on the statutory and index-trend anchors, both materially weaker bases on their own.',
        'Commission a local land-rate opinion or broker survey for this site before relying on the indicative value.',
        [evId],
      );
    } else if (compMatchLevel !== 'locality') {
      const widenedTo = compMatchLevel === 'city' ? identity.city : `a country-wide (${identity.country}) proxy`;
      const evId = evidence.add({
        statement: `Fewer than 4 land-parcel comparables were available within ${identity.locality} itself, so the search was widened to ${widenedTo}.`,
        sourceType: 'model_inference',
        sourceRef: 'comparables.landSearch',
        sourceLabel: 'Comparable selection',
        confidence: 0.75,
      });
      mk(
        'land_comparables_widened',
        'Land comparables sourced outside the immediate locality',
        'warning',
        'market',
        `Fewer than 4 land-parcel comparables were available within ${identity.locality} itself, so the comparable search was widened to ${widenedTo}.`,
        'A land rate built on comparables from outside the immediate locality is a real, if partial, proxy — it does not carry the same precision as locality-specific land transactions.',
        'Commission a local land-rate opinion for this specific locality to supplement the widened comparable set.',
        [evId],
      );
    }
  }

  // Occupancy certificates are an India-specific construction-compliance
  // concept (they are not part of the Netherlands country pack at all), so
  // this check only applies to Indian cases — otherwise every older Dutch
  // building would trip a risk that doesn't meaningfully apply to it. Where a
  // State Pack covers the case, its own (age-independent) occupancy-
  // certificate compliance check owns this ground instead, so the two views
  // don't double-flag the same gap.
  if (identity.country === 'IN' && !statePack && identity.yearBuilt !== undefined) {
    const age = new Date(now).getFullYear() - identity.yearBuilt;
    if (age > 30 && !documents.some(d => d.kind === 'occupancy_certificate')) {
      const evId = evidence.add({ statement: `Building is ${age} years old with no occupancy certificate on file.`, sourceType: 'model_inference', sourceRef: 'identity.yearBuilt', sourceLabel: 'Case identity — year built', confidence: 0.7 });
      mk(
        'aging_building_no_occupancy_certificate',
        'Older building without occupancy certificate',
        'serious',
        'structural',
        `The building is approximately ${age} years old and no occupancy certificate is on file.`,
        'Without an OC, compliance with the sanctioned plan (and therefore insurability, resale and further financing) cannot be confirmed.',
        'Request the occupancy certificate, or commission a structural/compliance survey if it cannot be produced.',
        [evId],
      );
    }
  }

  if (planning.farUsed > planning.farAllowed) {
    const evId = evidence.add({ statement: `FAR used (${round2(planning.farUsed)}) exceeds FAR allowed (${planning.farAllowed}).`, sourceType: 'model_inference', sourceRef: 'planning.farUsed', sourceLabel: 'Planning position', confidence: 0.75 });
    mk(
      'far_exceeded',
      'Built area exceeds permitted FAR',
      'critical',
      'planning',
      `Built-up area implies a FAR of ${round2(planning.farUsed)} against ${planning.farAllowed} permitted under current zoning.`,
      'Construction beyond the sanctioned FAR is typically unauthorised and can expose the buyer to regularisation costs, demolition orders, or an inability to obtain an occupancy certificate.',
      'Verify the approved building plan against as-built area and consult a local planning professional before proceeding.',
      [evId],
    );
  } else if (!locality.permittedUses.includes(identity.propertyType)) {
    const evId = evidence.add({ statement: `${identity.propertyType} is not listed among the permitted uses for ${locality.zoning}.`, sourceType: 'external_dataset', sourceRef: locality.id, sourceLabel: locality.source, confidence: 0.7 });
    mk(
      'zoning_mismatch',
      'Zoning / use mismatch',
      'serious',
      'planning',
      `Current zoning (${locality.zoning}) does not list ${identity.propertyType.replace(/_/g, ' ')} among its permitted uses.`,
      'The current or intended use may not be compliant, which can affect financing, insurance and resale.',
      'Confirm actual permitted use with the local planning authority before proceeding.',
      [evId],
    );
  }

  if (locality.liquidityDays > 100) {
    const evId = evidence.add({ statement: `Median liquidity in ${locality.locality} is ${locality.liquidityDays} days.`, sourceType: 'external_dataset', sourceRef: locality.id, sourceLabel: locality.source, confidence: 0.7 });
    mk(
      'long_liquidity',
      'Long time-to-transact',
      'info',
      'market',
      `The locality's median time-to-transact is ${locality.liquidityDays} days, longer than typical residential stock.`,
      'Exit may take longer than expected if a quick resale or refinancing is part of the plan.',
      'Build a longer hold horizon into any underwriting, or price in a liquidity discount.',
      [evId],
    );
  }

  if (identity.country === 'NL' && !documents.some(d => d.kind === 'energy_label')) {
    const evId = evidence.add({ statement: 'No energy label on file.', sourceType: 'model_inference', sourceRef: 'documents.energy_label', sourceLabel: 'Document completeness', confidence: 0.85 });
    mk(
      'missing_energy_label',
      'Energy label missing',
      'warning',
      'environmental',
      'Dutch law requires a valid energy label (energielabel) to be available at sale or lease, and none is on file.',
      "The transaction may not be legally completable without one, and the property's efficiency (and running costs) cannot be assessed.",
      'Order an energy label assessment before marketing or completing the transaction.',
      [evId],
    );
  }

  // Plot-specific risks — land subjects only. Layout approval itself is
  // handled as a Karnataka compliance check (`buildStateCompliance`, key
  // `layout_approval_status`) rather than here, since it is a statutory
  // finding with its own catalogued statute citation; demarcation/possession
  // and the road-width/FAR interaction are country-agnostic land concerns
  // that apply regardless of whether a State Pack covers the case.
  if (isLand && identity.plot) {
    const plot = identity.plot;

    if (plot.demarcated === false) {
      const evId = evidence.add({
        statement: 'Site recorded as not demarcated / possession not confirmed.',
        sourceType: 'user_input',
        sourceRef: 'identity.plot.demarcated',
        sourceLabel: 'Case identity — plot demarcation',
        confidence: 0.85,
      });
      mk(
        'plot_not_demarcated',
        'Site not demarcated — possession unconfirmed',
        'serious',
        'title',
        'The site has not been confirmed as fenced/demarcated or in undisputed possession.',
        'Boundary disputes and encroachment are common on undemarcated sites, and unclear possession complicates both financing and resale.',
        'Commission a licensed surveyor to demarcate the site and confirm physical possession before proceeding.',
        [evId],
      );
    }

    // Karnataka zonal FAR is commonly tied to road-width bands (several
    // tracked localities' own planning notes require ~12m/40ft+ frontage for
    // their higher FAR bands) — a narrower road caps what the permitted
    // envelope can actually deliver, independent of the FAR figure on paper.
    const FAR_ROAD_WIDTH_THRESHOLD_FT = 40;
    if (plot.roadWidthFt !== undefined && plot.roadWidthFt < FAR_ROAD_WIDTH_THRESHOLD_FT && planning.farAllowed > 2) {
      const evId = evidence.add({
        statement: `Abutting road width recorded as ${plot.roadWidthFt}ft against a zoning FAR of ${planning.farAllowed} that Bengaluru practice typically ties to wider frontage.`,
        sourceType: 'model_inference',
        sourceRef: 'identity.plot.roadWidthFt',
        sourceLabel: 'Case identity — plot road width',
        confidence: 0.6,
      });
      mk(
        'plot_road_width_far_cap',
        'Road width may cap achievable FAR',
        'warning',
        'planning',
        `The site's ${plot.roadWidthFt}ft abutting road is narrower than the ${FAR_ROAD_WIDTH_THRESHOLD_FT}ft threshold Bengaluru zoning commonly ties to its higher FAR bands.`,
        'The zoning FAR quoted for this locality may not actually be achievable on this specific site — confirm before pricing in the full permitted envelope.',
        'Confirm the road-width-linked FAR band that actually applies to this survey number with the local planning authority before relying on the zoning FAR figure.',
        [evId],
      );
    }
  }

  if (matchLevel === 'country') {
    const evId = evidence.add({
      statement: `No locality- or city-level reference data was available for ${identity.locality}, ${identity.city} — a country-level proxy was used instead.`,
      sourceType: 'model_inference',
      sourceRef: 'locality.matchLevel',
      sourceLabel: 'Locality match',
      confidence: 0.4,
    });
    mk(
      'locality_data_thin',
      'Locality reference data unavailable',
      'warning',
      'data',
      `${identity.locality} has no dedicated reference data — figures fall back to a country-level proxy, a materially weaker basis for the value range and market context shown.`,
      'Anchors, comparables and drivers derived from a country-wide proxy are considerably less precise than locality-specific data.',
      'Commission a local market appraisal to replace the proxy data before relying on this screen.',
      [evId],
    );
  }

  return risks;
}

/* ==================================================================== */
/* State compliance (Karnataka title checks)                             */
/* ==================================================================== */

/**
 * Karnataka title checks, each derived from what the case actually contains
 * (identity attributes, uploaded documents, extracted fields) rather than a
 * fixed template — a check only reaches `'clear'` or a jeopardy verdict when
 * the input actually answers the question; otherwise it is honestly
 * `'unknown'` and listed in `unresolved`. Every check that represents real
 * jeopardy also mints a `RiskFlag` via `makeRiskFactory` (the same factory
 * `buildRisks` uses) so Risks and Compliance can never disagree about a
 * finding's id, severity or carried-over status; the check's
 * `relatedRiskIds` points straight at it. Where a jeopardy is already
 * covered by a country-level risk (the encumbrance certificate), the check
 * links to that existing `RiskFlag` instead of minting a duplicate.
 */
export function buildStateCompliance(
  caseId: string,
  identity: PropertyIdentity,
  documents: CaseDocument[],
  statePack: StatePack,
  countryLevelRisks: RiskFlag[],
  previousResult: ScreenResult | undefined,
  evidence: EvidenceBuilder,
): { compliance: StateComplianceSummary; risks: RiskFlag[] } {
  const ka = identity.karnataka;
  const findDoc = (kind: DocumentKind): CaseDocument | undefined => documents.find(d => d.kind === kind);
  const checks: ComplianceCheck[] = [];
  const risks: RiskFlag[] = [];
  const unresolved: string[] = [];
  const makeRisk = makeRiskFactory(caseId, previousResult);

  const addRisk = (
    code: string,
    title: string,
    severity: RiskSeverity,
    category: RiskCategory,
    description: string,
    impact: string,
    mitigation: string,
    evidenceIds: string[],
  ): string => {
    const r = makeRisk(code, title, severity, category, description, impact, mitigation, evidenceIds);
    risks.push(r);
    return r.id;
  };

  const pushCheck = (
    key: string,
    label: string,
    verdict: ComplianceVerdict,
    finding: string,
    consequence: string,
    nextStep: string,
    statute: string,
    evidenceIds: string[],
    relatedRiskIds: string[],
  ): void => {
    checks.push({ key, label, verdict, finding, consequence, nextStep, statute, evidenceIds, relatedRiskIds });
    if (verdict === 'unknown') unresolved.push(label);
  };

  // The pack's own `titleChecks` catalog is the single source of truth for a
  // named check's statute citation — falling back to the given text only for
  // the one check (area basis) the catalog doesn't name.
  const statuteFor = (key: string, fallback: string): string => statePack.titleChecks.find(tc => tc.key === key)?.statute ?? fallback;

  // 1. Khata classification — the single biggest binary in a Bengaluru title screen.
  {
    const khataType = ka?.khataType;
    const khataDoc = findDoc('khata_extract');
    const evIds: string[] = [];
    if (khataDoc) {
      evIds.push(
        evidence.add({ statement: `Khata extract on file (${khataDoc.fileName}).`, sourceType: 'document', sourceRef: khataDoc.id, sourceLabel: khataDoc.fileName, confidence: khataDoc.classificationConfidence }),
      );
    }
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    let relatedRiskIds: string[] = [];

    if (khataType === 'a_khata') {
      verdict = 'clear';
      finding = 'Property is recorded on an A-khata — the fully compliant BBMP property register entry.';
      consequence = 'A-khata supports normal bank lending, building-plan sanction and resale without restriction.';
      nextStep = 'Confirm the khata extract matches the current owner and survey number before proceeding.';
    } else if (khataType === 'b_khata') {
      verdict = 'blocker';
      finding = 'Property is recorded on a B-khata — an irregular/provisional BBMP entry, not the fully compliant register.';
      consequence =
        'B-khata properties are routinely refused home-loan financing by scheduled banks, cannot get a building plan sanctioned, and sell at a real cash-buyer-only discount to A-khata stock — this is usually the single most consequential finding in a Bengaluru title screen.';
      nextStep =
        'Confirm the specific reason for B-khata status (unauthorised layout, DC-conversion pending, property-tax arrears) with BBMP and evaluate the cost/feasibility of conversion to A-khata before offering.';
      const evId = evidence.add({ statement: 'Khata classification recorded as B-khata.', sourceType: 'user_input', sourceRef: 'identity.karnataka.khataType', sourceLabel: 'Case identity — Karnataka khata type', confidence: 0.9 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_b_khata', 'B-khata property', 'critical', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else if (khataType === 'gram_panchayat_form_9_11') {
      verdict = 'attention';
      finding = 'Property is recorded under Gram Panchayat Form 9/11 rather than a BBMP khata — it sits outside Bengaluru municipal limits.';
      consequence = 'Form 9/11 properties face tighter limits on construction and are viewed cautiously by bank lenders relative to BBMP A-khata stock.';
      nextStep = 'Confirm current jurisdiction (BBMP/BDA limits sometimes expand over such land) and check the panchayat register for conversion or annexation notices.';
      const evId = evidence.add({ statement: 'Property register instrument recorded as Gram Panchayat Form 9/11.', sourceType: 'user_input', sourceRef: 'identity.karnataka.khataType', sourceLabel: 'Case identity — Karnataka khata type', confidence: 0.85 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_gram_panchayat_register', 'Gram Panchayat register (Form 9/11), not BBMP khata', 'warning', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else if (khataType === 'none') {
      verdict = 'attention';
      finding = 'No khata has been recorded for this property.';
      consequence = "Without any khata, property tax cannot be paid in the owner's name and registration/resale is materially harder.";
      nextStep = 'Apply for khata registration with BBMP/BDA before proceeding.';
      const evId = evidence.add({ statement: 'Khata type recorded as none.', sourceType: 'user_input', sourceRef: 'identity.karnataka.khataType', sourceLabel: 'Case identity — Karnataka khata type', confidence: 0.85 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_no_khata', 'No khata on record', 'serious', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else {
      verdict = 'unknown';
      finding = 'Khata classification (A-khata / B-khata / Form 9-11) has not been confirmed for this property.';
      consequence =
        'Khata status directly gates lending, plan sanction and resale, so the screen cannot rule out a B-khata restriction until this is confirmed.';
      nextStep = 'Obtain the khata extract (or Form 9/11 for gram-panchayat land) and record the classification.';
    }
    pushCheck('khata_classification', 'Khata classification', verdict, finding, consequence, nextStep, statuteFor('khata_classification', 'Karnataka Municipal Corporations Act, 1976 — BBMP khata register'), evIds, relatedRiskIds);
  }

  // 2. e-Khata issuance.
  {
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!ka) {
      verdict = 'unknown';
      finding = 'e-Khata issuance status has not been recorded.';
      consequence = 'Registration at the Sub-Registrar can stall without a matching e-khata on the Kaveri portal.';
      nextStep = "Check the property's e-khata status on the BBMP portal and record it.";
    } else if (ka.jurisdiction !== 'BBMP') {
      verdict = 'clear';
      finding = `e-Khata is a BBMP-specific digitised record; this property falls under ${ka.jurisdiction} jurisdiction.`;
      consequence = 'No e-khata-specific restriction applies outside BBMP limits.';
      nextStep = 'Confirm the equivalent property-register instrument for this jurisdiction is on file.';
    } else if (ka.eKhataIssued) {
      verdict = 'clear';
      finding = 'e-Khata has been issued for this property on the BBMP portal.';
      consequence = 'Registration at the Sub-Registrar should not be blocked on this ground.';
      nextStep = 'Keep the e-khata printout current at the time of registration.';
      evIds.push(evidence.add({ statement: 'e-Khata recorded as issued.', sourceType: 'user_input', sourceRef: 'identity.karnataka.eKhataIssued', sourceLabel: 'Case identity — e-Khata status', confidence: 0.85 }));
    } else {
      verdict = 'attention';
      finding = 'e-Khata has not yet been issued for this BBMP property.';
      consequence = "Absence of an e-khata is a common, avoidable cause of registration being stalled or refused at the Sub-Registrar's office.";
      nextStep = 'Apply for e-khata migration on the BBMP portal before scheduling registration.';
      const evId = evidence.add({ statement: 'e-Khata recorded as not issued.', sourceType: 'user_input', sourceRef: 'identity.karnataka.eKhataIssued', sourceLabel: 'Case identity — e-Khata status', confidence: 0.85 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_no_ekhata', 'e-Khata not issued', 'warning', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    }
    pushCheck('e_khata_issuance', 'e-Khata issuance', verdict, finding, consequence, nextStep, statuteFor('e_khata_issuance', 'BBMP e-Khata initiative, administered under the Karnataka Municipal Corporations Act 1976'), evIds, relatedRiskIds);
  }

  // 3. DC conversion status.
  {
    const status = ka?.landConversionStatus;
    const convDoc = findDoc('conversion_certificate');
    const isNonAgUse = identity.propertyType !== 'land_parcel';
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!status || status === 'unknown') {
      verdict = 'unknown';
      finding = 'DC (Deputy Commissioner) land-conversion status has not been confirmed.';
      consequence =
        'If the land is still agricultural, non-agricultural use or construction on it is unauthorised under s.95 of the Karnataka Land Revenue Act, 1964, putting financing and plan sanction at risk.';
      nextStep = 'Obtain the DC conversion order (or confirm the land was never agricultural) before proceeding.';
    } else if (status === 'agricultural' && isNonAgUse) {
      verdict = 'blocker';
      finding = `Land is recorded as still agricultural, but the property is being screened as a ${identity.propertyType.replace(/_/g, ' ')} — a non-agricultural use.`;
      consequence =
        'Non-agricultural use or construction on unconverted agricultural land is unauthorised under s.95 of the Karnataka Land Revenue Act, 1964, exposing the buyer to penalty, resumption, or an inability to register or mortgage the property.';
      nextStep = 'Obtain the DC conversion order before any construction, registration or financing step.';
      const evId = evidence.add({ statement: 'Land conversion status recorded as agricultural for a non-agricultural property type.', sourceType: 'user_input', sourceRef: 'identity.karnataka.landConversionStatus', sourceLabel: 'Case identity — DC conversion status', confidence: 0.9 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_unconverted_agricultural_land', 'Unconverted agricultural land under non-agricultural use', 'critical', 'planning', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else if (status === 'converted') {
      if (convDoc) {
        verdict = 'clear';
        finding = 'Land has been converted for non-agricultural use and the DC conversion certificate is on file.';
        consequence = 'Supports lawful non-agricultural use, financing and plan sanction.';
        nextStep = 'Cross-check the conversion order number and extent against the survey number on the title deed.';
        evIds.push(evidence.add({ statement: `DC conversion certificate on file (${convDoc.fileName}).`, sourceType: 'document', sourceRef: convDoc.id, sourceLabel: convDoc.fileName, confidence: convDoc.classificationConfidence }));
      } else {
        verdict = 'attention';
        finding = 'Land is recorded as converted for non-agricultural use, but the DC conversion certificate itself is not on file.';
        consequence = 'Without the certificate, the conversion cannot be independently verified — lenders and the Sub-Registrar will typically ask for it.';
        nextStep = 'Obtain a copy of the DC conversion order/certificate for the file.';
        const evId = evidence.add({ statement: 'Land conversion status recorded as converted, but no conversion certificate document is on file.', sourceType: 'model_inference', sourceRef: 'documents.conversion_certificate', sourceLabel: 'Document completeness', confidence: 0.7 });
        evIds.push(evId);
        const riskId = addRisk('karnataka_conversion_certificate_missing', 'DC conversion certificate not on file', 'warning', 'title', finding, consequence, nextStep, evIds);
        relatedRiskIds = [riskId];
      }
    } else {
      verdict = 'clear';
      finding = 'DC conversion is not applicable to this property.';
      consequence = 'No conversion-related restriction applies.';
      nextStep = 'No action needed on this point.';
    }
    pushCheck('dc_conversion', 'DC land-conversion status', verdict, finding, consequence, nextStep, statuteFor('dc_conversion', 'Karnataka Land Revenue Act 1964, s.95'), evIds, relatedRiskIds);
  }

  // 4. PTCL Act, 1978 granted land.
  {
    const flagged = ka?.grantedLandPtcl;
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (flagged === true) {
      verdict = 'blocker';
      finding = 'Property is flagged as granted land under the Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of Transfer of Certain Lands) Act, 1978 (PTCL Act).';
      consequence =
        'PTCL-granted land carries statutory restrictions — in many cases an outright prohibition — on transfer without government permission; a sale in breach of the Act can be set aside years later, even against a bona fide purchaser.';
      nextStep = 'Obtain a certified non-applicability / transfer-permission order from the Assistant Commissioner before proceeding — do not rely on the title deed alone.';
      const evId = evidence.add({ statement: 'Property flagged as PTCL Act 1978 granted land.', sourceType: 'user_input', sourceRef: 'identity.karnataka.grantedLandPtcl', sourceLabel: 'Case identity — PTCL granted-land flag', confidence: 0.9 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_ptcl_granted_land', 'PTCL Act granted-land transfer restriction', 'critical', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else if (flagged === false) {
      verdict = 'clear';
      finding = 'Property is not flagged as PTCL Act granted land.';
      consequence = 'No PTCL transfer restriction applies on the information provided.';
      nextStep = "If the seller's title traces back to a government grant, independently confirm the PTCL position with the Revenue Department regardless.";
    } else {
      verdict = 'unknown';
      finding = 'Whether the land was originally granted under the PTCL Act, 1978 has not been checked.';
      consequence = 'Undisclosed PTCL-granted status can void a sale years after completion.';
      nextStep = "Trace the title chain back to the original grant (if any) and check the Revenue Department's PTCL register.";
    }
    pushCheck('ptcl_restriction', 'PTCL Act 1978 granted-land status', verdict, finding, consequence, nextStep, statuteFor('ptcl_restriction', 'Karnataka Scheduled Castes and Scheduled Tribes (Prohibition of Transfer of Certain Lands) Act, 1978'), evIds, relatedRiskIds);
  }

  // 5. Rajakaluve / lake buffer.
  {
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!ka) {
      verdict = 'unknown';
      finding = 'Proximity to a storm-water drain (rajakaluve) or lake boundary has not been checked.';
      consequence = 'Construction within a drain/lake buffer is subject to demolition orders under NGT directions even where the property otherwise has clean title.';
      nextStep = 'Check the BBMP/BDA drain and lake maps for this survey number.';
    } else if (!ka.nearRajakaluve && !ka.nearLake) {
      verdict = 'clear';
      finding = 'No storm-water drain (rajakaluve) or lake-buffer proximity has been flagged for this property.';
      consequence = 'No buffer-zone construction restriction is indicated by the information on file.';
      nextStep = 'If a site inspection shows proximity to a drain or lake not captured here, re-run this check with that flag set.';
    } else {
      // Rajakaluve buffers are banded by drain classification (primary /
      // secondary / tertiary) — quoting a single rule's distance would
      // misleadingly imply we know which band applies, so this reports the
      // full range and leaves the specific figure to a survey.
      const drainRules: BufferRule[] = statePack.buffers.value.filter(b => /rajakaluve|drain|storm/i.test(`${b.key} ${b.label} ${b.appliesTo}`));
      const lakeRule = statePack.buffers.value.find(b => /lake/i.test(`${b.key} ${b.label} ${b.appliesTo}`));
      const drainMetres = drainRules.map(r => r.metres);
      const drainText = drainMetres.length > 0 ? (drainMetres.length > 1 ? `${Math.min(...drainMetres)}-${Math.max(...drainMetres)}m, depending on primary/secondary/tertiary classification` : `${drainMetres[0]}m`) : undefined;
      const featureLabel = ka.nearRajakaluve && ka.nearLake ? 'a storm-water drain (rajakaluve) and a lake' : ka.nearRajakaluve ? 'a storm-water drain (rajakaluve)' : 'a lake';
      const ruleText = [
        ka.nearRajakaluve && drainText ? `${drainText} from the drain edge` : null,
        ka.nearLake && lakeRule ? `${lakeRule.metres}m from ${lakeRule.appliesTo}` : null,
      ]
        .filter((s): s is string => Boolean(s))
        .join(' / ');
      verdict = 'attention';
      finding = `Property is recorded as being near ${featureLabel}.`;
      consequence =
        `Karnataka's buffer rules (${statePack.buffers.source}, as of ${statePack.buffers.asOf})${ruleText ? ` set a no-construction setback of ${ruleText}` : ' restrict construction near drains and lakes'}, but the distance that actually applies depends on how this specific drain is classified in the current BBMP/BDA drain-classification map, and these distances have been repeatedly revised by NGT orders — it cannot be assumed from a proximity flag alone.`;
      nextStep = 'Commission a licensed surveyor to measure the actual setback against the current BBMP/BDA drain-classification map before relying on any development or resale plan for this site.';
      const evId = evidence.add({ statement: `Property flagged as near ${featureLabel}.`, sourceType: 'user_input', sourceRef: 'identity.karnataka.nearRajakaluve|nearLake', sourceLabel: 'Case identity — buffer proximity flags', confidence: 0.8 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_buffer_proximity', 'Rajakaluve / lake buffer proximity', 'serious', 'environmental', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    }
    pushCheck('rajakaluve_lake_buffer', 'Rajakaluve / lake buffer', verdict, finding, consequence, nextStep, statuteFor('rajakaluve_lake_buffer', 'Karnataka Town and Country Planning Act 1961; NGT orders on Bengaluru lake and drain buffers'), evIds, relatedRiskIds);
  }

  // 6. Occupancy certificate — very commonly absent in Bengaluru. Not
  // applicable to a bare plot: there is no structure to have been occupied.
  {
    const ocDoc = findDoc('occupancy_certificate');
    const isLandType = identity.propertyType === 'residential_plot' || identity.propertyType === 'land_parcel';
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (isLandType) {
      verdict = 'clear';
      finding = 'Occupancy certificate is not applicable — this is a bare plot with no structure to have been occupied.';
      consequence = 'No occupancy-certificate-related restriction applies until a building is actually constructed on the site.';
      nextStep = 'Revisit this check once construction begins and an occupancy certificate becomes relevant.';
    } else if (ocDoc) {
      verdict = 'clear';
      finding = 'Occupancy certificate is on file.';
      consequence = 'Supports lawful occupation, insurability and normal resale/financing.';
      nextStep = 'Confirm the OC covers the specific unit/floor being screened, not just the overall project.';
      evIds.push(evidence.add({ statement: `Occupancy certificate on file (${ocDoc.fileName}).`, sourceType: 'document', sourceRef: ocDoc.id, sourceLabel: ocDoc.fileName, confidence: ocDoc.classificationConfidence }));
    } else {
      verdict = 'attention';
      finding = 'No occupancy certificate is on file — very commonly absent for Bengaluru stock, but still a gap.';
      consequence = 'Without an OC, compliance with the sanctioned plan cannot be confirmed, which can affect insurability, resale and further financing.';
      nextStep = "Request the occupancy certificate from the builder/seller, or check BBMP's OC-status portal for the project.";
      const evId = evidence.add({ statement: 'No occupancy certificate on file.', sourceType: 'model_inference', sourceRef: 'documents.occupancy_certificate', sourceLabel: 'Document completeness', confidence: 0.7 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_no_occupancy_certificate', 'Occupancy certificate not on file', 'warning', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    }
    pushCheck('occupancy_certificate_compliance', 'Occupancy certificate', verdict, finding, consequence, nextStep, statuteFor('occupancy_certificate_compliance', 'Karnataka Municipal Corporations Act 1976, s.310'), evIds, relatedRiskIds);
  }

  // 7. Encumbrance continuity — reuses the existing country-level risk (if any) rather than duplicating it.
  {
    const ecDoc = findDoc('encumbrance_certificate');
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    let evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (ecDoc) {
      verdict = 'clear';
      finding = 'A 30-year encumbrance certificate is on file, evidencing continuity of the recorded chain of title.';
      consequence = 'Supports a clean-title basis for lending and registration.';
      nextStep = 'Confirm the EC period actually spans the full 30 years and shows no unresolved entries.';
      evIds.push(evidence.add({ statement: `Encumbrance certificate on file (${ecDoc.fileName}).`, sourceType: 'document', sourceRef: ecDoc.id, sourceLabel: ecDoc.fileName, confidence: ecDoc.classificationConfidence }));
    } else {
      verdict = 'attention';
      finding = 'No encumbrance certificate is on file to evidence continuity of title.';
      consequence = 'Undisclosed mortgages, liens or pending litigation would not be visible without this document.';
      nextStep = 'Obtain a fresh 30-year encumbrance certificate from the Sub-Registrar (Kaveri Online Services).';
      const existing = countryLevelRisks.find(r => r.code === 'no_encumbrance_certificate');
      if (existing) {
        relatedRiskIds = [existing.id];
        evIds = [...existing.evidenceIds];
      }
    }
    pushCheck('encumbrance_continuity', 'Encumbrance continuity (30-year EC)', verdict, finding, consequence, nextStep, statuteFor('encumbrance_continuity', 'Registration Act 1908, s.57'), evIds, relatedRiskIds);
  }

  // 8. K-RERA registration — only for projects that require it.
  {
    const reraApplicable = identity.propertyType === 'residential_apartment' || identity.propertyType === 'residential_villa';
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!reraApplicable) {
      verdict = 'clear';
      finding = 'K-RERA registration is not applicable to this property type.';
      consequence = 'No RERA-related restriction applies.';
      nextStep = 'No action needed on this point.';
    } else {
      const reraDoc = findDoc('rera_registration');
      const kreraNumber = ka?.kreraNumber ?? reraDoc?.extracted.find(f => f.key === 'reraNumber')?.value;
      if (kreraNumber) {
        verdict = 'clear';
        finding = `K-RERA registration number ${kreraNumber} is on record for this project.`;
        consequence = 'Supports buyer protections (receivables escrow, delivery timeline, defect liability) under the RERA Act, 2016.';
        nextStep = 'Verify the registration is still active on the K-RERA portal (rera.karnataka.gov.in).';
        evIds.push(
          evidence.add({
            statement: `K-RERA registration number recorded: ${kreraNumber}.`,
            sourceType: reraDoc ? 'document' : 'user_input',
            sourceRef: reraDoc?.id ?? 'identity.karnataka.kreraNumber',
            sourceLabel: reraDoc?.fileName ?? 'Case identity — K-RERA number',
            confidence: 0.85,
          }),
        );
      } else {
        verdict = 'attention';
        finding = 'This is an apartment/villa project but no K-RERA registration number is on record.';
        consequence = 'Selling a RERA-eligible project without registration is a statutory breach and forfeits the buyer protections RERA provides.';
        nextStep = "Confirm the project's K-RERA registration number on rera.karnataka.gov.in before booking or paying any advance.";
        const evId = evidence.add({ statement: 'No K-RERA registration number on record for an apartment/villa project.', sourceType: 'model_inference', sourceRef: 'documents.rera_registration', sourceLabel: 'Document completeness', confidence: 0.6 });
        evIds.push(evId);
        const riskId = addRisk('karnataka_no_krera_registration', 'K-RERA registration not on record', 'warning', 'title', finding, consequence, nextStep, evIds);
        relatedRiskIds = [riskId];
      }
    }
    pushCheck('krera_registration', 'K-RERA registration', verdict, finding, consequence, nextStep, statuteFor('krera_registration', 'Real Estate (Regulation and Development) Act 2016, as administered by K-RERA'), evIds, relatedRiskIds);
  }

  // 9. Acquisition / de-notification status (BDA/BMRDA).
  {
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!ka || ka.jurisdiction === 'unknown') {
      verdict = 'unknown';
      finding = 'Whether this parcel has ever been notified for acquisition (and, if so, de-notified) by BDA/BMRDA has not been checked.';
      consequence = 'A parcel under an unresolved acquisition notification cannot be safely developed or financed even if title otherwise looks clean.';
      nextStep = 'Search the BDA/BMRDA acquisition and de-notification registers against the survey number.';
    } else if (ka.jurisdiction === 'BDA' || ka.jurisdiction === 'BMRDA') {
      verdict = 'attention';
      finding = `Property falls under ${ka.jurisdiction} jurisdiction, where historical land-acquisition notifications are common across Bengaluru's peripheral layouts.`;
      consequence = 'An unresolved or improperly de-notified acquisition can result in the land reverting to the acquiring authority regardless of the current sale deed.';
      nextStep = `Search the ${ka.jurisdiction} acquisition and de-notification registers against the survey number before proceeding.`;
      const evId = evidence.add({ statement: `Property jurisdiction recorded as ${ka.jurisdiction}.`, sourceType: 'user_input', sourceRef: 'identity.karnataka.jurisdiction', sourceLabel: 'Case identity — Karnataka jurisdiction', confidence: 0.8 });
      evIds.push(evId);
      const riskId = addRisk('karnataka_acquisition_notification_unconfirmed', `${ka.jurisdiction} acquisition/de-notification status unconfirmed`, 'warning', 'title', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    } else {
      verdict = 'clear';
      finding = `Property falls under ${ka.jurisdiction} jurisdiction, where BDA/BMRDA-style acquisition-notification exposure is materially lower.`;
      consequence = 'No specific acquisition-notification concern is indicated by jurisdiction alone.';
      nextStep = 'No action needed on this point beyond the standard encumbrance search.';
    }
    pushCheck('bda_bmrda_acquisition', 'Acquisition / de-notification status', verdict, finding, consequence, nextStep, statuteFor('bda_bmrda_acquisition', 'Bangalore Development Authority Act 1976; Bangalore Metropolitan Region Development Authority Act 1985'), evIds, relatedRiskIds);
  }

  // 10. Area basis — Bengaluru pricing is routinely quoted on super built-up
  // area. Not applicable to a bare plot: carpet/built-up/super-built-up is a
  // built-property distinction, and a site is priced on plot area directly.
  {
    const basis = ka?.areaBasis;
    const isLandType = identity.propertyType === 'residential_plot' || identity.propertyType === 'land_parcel';
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (isLandType) {
      verdict = 'clear';
      finding = 'Quoted-area basis (carpet / built-up / super built-up) is a built-property distinction and does not apply — this site is priced on plot area directly.';
      consequence = 'No area-basis distortion applies to a land rate quoted per sqm of plot area.';
      nextStep = 'No action needed on this point.';
    } else if (basis === 'carpet') {
      verdict = 'clear';
      finding = 'Quoted area is on a RERA carpet-area basis.';
      consequence = 'Price-per-sqm figures are directly comparable to RERA-mandated carpet-area disclosures and to other carpet-area comparables.';
      nextStep = 'No action needed on this point.';
    } else if (basis === 'built_up') {
      verdict = 'attention';
      finding = 'Quoted area is on a built-up basis, not RERA carpet area.';
      consequence = 'Built-up area typically runs 10-15% above carpet area, so a price-per-sqm computed on it understates the true carpet-area rate by a similar margin.';
      nextStep = 'Ask for the carpet-area figure (or the built-up-to-carpet efficiency ratio) before comparing this price per sqm to carpet-area comparables.';
      evIds.push(evidence.add({ statement: 'Area basis recorded as built-up, not carpet.', sourceType: 'user_input', sourceRef: 'identity.karnataka.areaBasis', sourceLabel: 'Case identity — area basis', confidence: 0.85 }));
    } else {
      verdict = 'attention';
      finding = basis === 'super_built_up' ? 'Quoted area is on a super built-up basis, not RERA carpet area.' : 'The basis the quoted area is measured on (carpet / built-up / super built-up) has not been confirmed.';
      consequence =
        'Bengaluru pricing is routinely quoted on super built-up area while RERA mandates carpet area — the quoted rate is typically 25-35% optimistic against a genuine carpet-area comparison, so anchors and comparables here may overstate value versus carpet-area market data.';
      nextStep = 'Obtain the RERA carpet-area figure from the sale agreement/RERA filing and re-express the price per sqm on that basis before relying on the comparable-sales anchor.';
      const evId = evidence.add({
        statement: basis === 'super_built_up' ? 'Area basis recorded as super built-up.' : 'Area basis has not been recorded.',
        sourceType: 'user_input',
        sourceRef: 'identity.karnataka.areaBasis',
        sourceLabel: 'Case identity — area basis',
        confidence: basis ? 0.85 : 0.4,
      });
      evIds.push(evId);
      const riskId = addRisk('karnataka_area_basis_not_carpet', 'Quoted area basis is not RERA carpet area', 'warning', 'data', finding, consequence, nextStep, evIds);
      relatedRiskIds = [riskId];
    }
    pushCheck('area_basis', 'Quoted area basis', verdict, finding, consequence, nextStep, 'Real Estate (Regulation and Development) Act, 2016 — s.2(k) carpet-area definition', evIds, relatedRiskIds);
  }

  // 11. Layout approval status — plot-specific, and per the pack's own
  // title-check catalogue "the single most consequential fact about a plot
  // that a flat purchase never has to establish". A revenue layout or an
  // outright unapproved layout is a blocker: BBMP/BDA can refuse khata and
  // building-plan sanction outright, and mainstream lenders will typically
  // decline to finance it.
  {
    const isLandType = identity.propertyType === 'residential_plot' || identity.propertyType === 'land_parcel';
    const layoutApproval = identity.plot?.layoutApproval;
    let verdict: ComplianceVerdict;
    let finding: string;
    let consequence: string;
    let nextStep: string;
    const evIds: string[] = [];
    let relatedRiskIds: string[] = [];

    if (!isLandType) {
      verdict = 'clear';
      finding = 'Layout approval status is a plot-specific check and does not apply to a built unit.';
      consequence = 'No layout-approval-specific restriction applies to a constructed unit.';
      nextStep = 'No action needed on this point.';
    } else if (!layoutApproval || layoutApproval === 'unknown') {
      verdict = 'unknown';
      finding = 'The layout approval status of this site (BDA / BMRDA / panchayat / private / revenue / unapproved) has not been confirmed.';
      consequence = 'Layout approval status gates khata issuance, building-plan sanction and financing, so the screen cannot rule out a revenue or unapproved layout until this is confirmed.';
      nextStep = 'Trace the layout-approval order (or its absence) for this survey number with the relevant planning authority before relying on this screen.';
    } else if (layoutApproval === 'bda_approved' || layoutApproval === 'bmrda_approved') {
      verdict = 'clear';
      finding = `The site sits in a ${layoutApproval === 'bda_approved' ? 'BDA' : 'BMRDA'}-approved layout.`;
      consequence = 'Supports normal khata issuance, building-plan sanction and mortgage financing.';
      nextStep = 'Cross-check the layout-approval order number against the survey number on the title deed.';
      evIds.push(evidence.add({ statement: `Layout approval recorded as ${layoutApproval.replace(/_/g, ' ')}.`, sourceType: 'user_input', sourceRef: 'identity.plot.layoutApproval', sourceLabel: 'Case identity — layout approval', confidence: 0.85 }));
    } else if (layoutApproval === 'panchayat_approved' || layoutApproval === 'private_approved') {
      verdict = 'attention';
      finding = `The site sits in a ${layoutApproval === 'panchayat_approved' ? 'gram panchayat-approved' : 'privately approved'} layout, not a BDA/BMRDA-sanctioned one.`;
      consequence = `${layoutApproval === 'panchayat_approved' ? 'Panchayat' : 'Private'} approval needs verifying on its own merits — lenders and BBMP/BDA treat it more cautiously than a BDA/BMRDA sanction.`;
      nextStep = 'Obtain and independently verify the specific approval order/certificate for this layout before relying on it for financing.';
      const evId = evidence.add({ statement: `Layout approval recorded as ${layoutApproval.replace(/_/g, ' ')}.`, sourceType: 'user_input', sourceRef: 'identity.plot.layoutApproval', sourceLabel: 'Case identity — layout approval', confidence: 0.8 });
      evIds.push(evId);
      const riskId = addRisk(
        'karnataka_plot_layout_needs_verification',
        `${layoutApproval === 'panchayat_approved' ? 'Panchayat' : 'Privately'}-approved layout needs verification`,
        'warning',
        'planning',
        finding,
        consequence,
        nextStep,
        evIds,
      );
      relatedRiskIds = [riskId];
    } else {
      // revenue_layout or unapproved — the serious/critical end.
      verdict = 'blocker';
      finding =
        layoutApproval === 'revenue_layout'
          ? 'The site sits in a revenue layout — carved out of agricultural revenue land and sold without a sanctioned layout plan.'
          : 'The site sits in a layout with no planning-authority approval at all.';
      consequence =
        'BBMP/BDA can refuse khata and building-plan sanction outright, mainstream lenders will typically decline to finance it, and the site can be exposed to demolition or resumption action even where the sale deed itself registered without issue.';
      nextStep = 'Do not treat the sale deed alone as proof of a lawful layout — trace the layout-approval order (if any) with BDA/BMRDA and get an independent legal opinion on regularisation prospects before offering.';
      const evId = evidence.add({ statement: `Layout approval recorded as ${layoutApproval.replace(/_/g, ' ')}.`, sourceType: 'user_input', sourceRef: 'identity.plot.layoutApproval', sourceLabel: 'Case identity — layout approval', confidence: 0.9 });
      evIds.push(evId);
      const riskId = addRisk(
        'karnataka_plot_layout_not_approved',
        layoutApproval === 'revenue_layout' ? 'Revenue layout, not a sanctioned residential layout' : 'Unapproved layout',
        layoutApproval === 'revenue_layout' ? 'serious' : 'critical',
        'planning',
        finding,
        consequence,
        nextStep,
        evIds,
      );
      relatedRiskIds = [riskId];
    }
    pushCheck('layout_approval_status', 'Layout approval status', verdict, finding, consequence, nextStep, statuteFor('layout_approval_status', 'Karnataka Town and Country Planning Act 1961, ss.17 & 32'), evIds, relatedRiskIds);
  }

  const applicable = checks.filter(c => c.verdict !== 'unknown');
  const clearCount = applicable.filter(c => c.verdict === 'clear').length;
  const score = applicable.length > 0 ? Math.round((clearCount / applicable.length) * 100) : 0;

  const compliance: StateComplianceSummary = {
    statePackId: statePack.id,
    state: statePack.state,
    score,
    checks,
    unresolved,
    // Buffer rules are the most frequently revised (NGT orders, RMP
    // revisions) of the pack's statutory rules, and are exactly the kind of
    // value a screen must not silently let go stale — so they carry the
    // provenance banner shown across the whole compliance view.
    rulesAsOf: statePack.buffers.asOf,
    verifyNote: statePack.buffers.verifyNote,
  };

  return { compliance, risks };
}

/* ==================================================================== */
/* Transaction costs (stamp duty, cess, surcharge, registration)         */
/* ==================================================================== */

/**
 * Karnataka charges stamp duty as a single flat rate on the whole dutiable
 * value based on which band it falls into (not a marginal/progressive
 * calculation like income tax) — this picks the smallest `upTo` that still
 * covers `value`, falling back to the open-ended ("and above") slab.
 */
function computeSlabDuty(value: number, slabs: DutySlab[]): number {
  const sorted = [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const slab = sorted.find(s => s.upTo === null || value <= s.upTo) ?? sorted[sorted.length - 1];
  return value * (slab.pct / 100);
}

/**
 * Stamp duty is charged on the higher of transacted consideration and the
 * statutory guidance value, then cess and surcharge are computed on the duty
 * itself (not on the price), then the registration fee on the dutiable
 * value. Every line is rounded to the nearest currency unit *before* summing,
 * so `lines` always sums exactly to `total` — no separate coarse rounding is
 * applied afterwards that could break that invariant.
 */
export function computeTransactionCosts(identity: PropertyIdentity, statePack: StatePack, locality: LocalityReference): TransactionCostBreakdown {
  const isLand = isLandPropertyType(identity.propertyType);
  const area = isLand ? identity.plotAreaSqm : identity.builtUpAreaSqm;
  const statutoryRate = isLand ? locality.statutoryLandRatePerSqm : locality.statutoryRatePerSqm;
  const guidanceValue = Math.round(statutoryRate * area);
  const consideration = identity.askingPrice !== undefined ? Math.round(identity.askingPrice) : 0;
  const dutiableValue = Math.max(consideration, guidanceValue);
  const dutiableBasis: TransactionCostBreakdown['dutiableBasis'] = consideration > guidanceValue ? 'consideration' : 'statutory_guidance_value';

  const dutyAmt = Math.round(computeSlabDuty(dutiableValue, statePack.stampDutySlabs.value));
  const cessPct = statePack.stampDutyCessPct.value;
  const surchargePct = statePack.stampDutySurchargePct.value;
  const registrationFeePct = statePack.registrationFeePct.value;
  const cessAmt = Math.round(dutyAmt * (cessPct / 100));
  const surchargeAmt = Math.round(dutyAmt * (surchargePct / 100));
  const registrationAmt = Math.round(dutiableValue * (registrationFeePct / 100));

  const lines: TransactionCostBreakdown['lines'] = [
    {
      key: 'stamp_duty',
      label: 'Stamp duty',
      pct: null,
      amount: dutyAmt,
      note: `Banded stamp duty on the dutiable value of ${identity.currency} ${dutiableValue.toLocaleString()} (the higher of ${identity.currency} ${consideration.toLocaleString()} consideration and the ${identity.currency} ${guidanceValue.toLocaleString()} ${statePack.statutoryRateLabel.toLowerCase()}), per ${statePack.stampDutySlabs.source}.`,
    },
    {
      key: 'cess',
      label: 'Cess',
      pct: cessPct,
      amount: cessAmt,
      note: `${cessPct}% of the stamp duty itself (${identity.currency} ${dutyAmt.toLocaleString()}), not of the price, per ${statePack.stampDutyCessPct.source}.`,
    },
    {
      key: 'surcharge',
      label: 'Surcharge',
      pct: surchargePct,
      amount: surchargeAmt,
      note: `${surchargePct}% of the stamp duty itself, not of the price, per ${statePack.stampDutySurchargePct.source}.`,
    },
    {
      key: 'registration_fee',
      label: 'Registration fee',
      pct: registrationFeePct,
      amount: registrationAmt,
      note: `${registrationFeePct}% of the dutiable value, per ${statePack.registrationFeePct.source}.`,
    },
  ];

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const priceBasis = consideration > 0 ? consideration : dutiableValue;
  const totalPctOfPrice = priceBasis > 0 ? round2((total / priceBasis) * 100) : 0;

  return {
    dutiableValue,
    dutiableBasis,
    lines,
    total,
    totalPctOfPrice,
    currency: identity.currency,
    asOf: statePack.stampDutySlabs.asOf,
    source: statePack.stampDutySlabs.source,
    verifyNote: statePack.stampDutySlabs.verifyNote,
  };
}

/* ==================================================================== */
/* Planning position                                                     */
/* ==================================================================== */

function buildPlanning(identity: PropertyIdentity, locality: LocalityReference, now: string, evidence: EvidenceBuilder): PlanningPosition {
  const farUsed = identity.plotAreaSqm > 0 ? identity.builtUpAreaSqm / identity.plotAreaSqm : 0;
  const buildablePotentialSqm = Math.max(0, (locality.farAllowed - farUsed) * identity.plotAreaSqm);
  const headroomRatio = identity.plotAreaSqm > 0 ? buildablePotentialSqm / identity.plotAreaSqm : 0;

  let developmentPotential: PlanningPosition['developmentPotential'] = 'none';
  if (headroomRatio > 1) developmentPotential = 'significant';
  else if (headroomRatio > 0.4) developmentPotential = 'moderate';
  else if (headroomRatio > 0.05) developmentPotential = 'limited';

  const evId = evidence.add({
    statement: `Zoning: ${locality.zoning}; FAR allowed ${locality.farAllowed}, FAR used ${round2(farUsed)}.`,
    sourceType: 'external_dataset',
    sourceRef: locality.id,
    sourceLabel: locality.source,
    confidence: 0.75,
  });

  const restrictions: string[] = [locality.planningNote];
  if (farUsed > locality.farAllowed) restrictions.push('Built FAR currently exceeds the permitted ratio.');

  return {
    zoning: locality.zoning,
    permittedUses: locality.permittedUses,
    farAllowed: locality.farAllowed,
    farUsed: round2(farUsed),
    buildablePotentialSqm: Math.round(buildablePotentialSqm),
    restrictions,
    developmentPotential,
    statusNote: locality.planningNote,
    source: locality.source,
    lastCheckedAt: now,
    evidenceIds: [evId],
  };
}

/* ==================================================================== */
/* Document completeness                                                 */
/* ==================================================================== */

function buildCompleteness(requiredDocs: RequiredDocSpec[], documents: CaseDocument[]): CompletenessSummary {
  const items: CompletenessItem[] = requiredDocs.map(rd => {
    const doc = documents.find(d => d.kind === rd.kind);
    return {
      key: rd.kind,
      label: rd.label,
      satisfiedBy: [rd.kind],
      required: rd.required,
      present: Boolean(doc),
      documentId: doc?.id,
      weight: rd.weight,
      note: doc ? undefined : rd.note ?? (rd.required ? 'Required and not yet on file.' : 'Optional — improves confidence if provided.'),
    };
  });
  const totalWeight = items.reduce((s, i) => s + i.weight, 0) || 1;
  const scoredWeight = items.reduce((s, i) => s + (i.present ? i.weight : 0), 0);
  const score = Math.round((scoredWeight / totalWeight) * 100);
  const missingCritical = items.filter(i => i.required && !i.present).map(i => i.label);
  return { score, items, missingCritical };
}

/* ==================================================================== */
/* Confidence scoring                                                    */
/* ==================================================================== */

/**
 * Builds the 0..100 confidence score from named, signed factors that
 * literally sum (from a stated base) to the final score, so the number is
 * auditable rather than asserted: `base + completeness + comparables +
 * locality_match + extraction + anchor_agreement + asking_price = score`.
 */
function buildConfidence(
  completeness: CompletenessSummary,
  comparables: Comparable[],
  matchLevel: LocalityMatchLevel,
  documents: CaseDocument[],
  anchors: ValueAnchor[],
  askingPricePresent: boolean,
  /**
   * Only passed for a land subject: how far the LAND-comparable search had
   * to widen (see `selectComparableCandidates`), and whether it found
   * anything at all. `undefined` for a built subject, which keeps this
   * factor list — and therefore every built demo case's confidence score —
   * byte-identical to before this feature existed.
   */
  landComparableGeography?: { level: LocalityMatchLevel; found: boolean },
): ConfidenceSummary {
  const factors: ConfidenceFactor[] = [];
  const base = 30;
  factors.push({ key: 'base', label: 'Base score', contribution: base, note: 'Starting point before case-specific factors.' });

  const completenessContribution = Math.round((completeness.score / 100) * 25);
  factors.push({ key: 'completeness', label: 'Document completeness', contribution: completenessContribution, note: `${completeness.score}/100 document completeness score.` });

  const compCount = comparables.length;
  const compContribution = clamp(Math.round(compCount * 2.5), 0, 15);
  factors.push({
    key: 'comparables',
    label: 'Comparable count & recency',
    contribution: compContribution,
    note: `${compCount} comparable(s) used in the ${landComparableGeography ? 'land-rate' : 'comparable-sales'} anchor.`,
  });

  const localityContribution = matchLevel === 'locality' ? 10 : matchLevel === 'city' ? 3 : -10;
  factors.push({
    key: 'locality_match',
    label: 'Locality match precision',
    contribution: localityContribution,
    note: matchLevel === 'locality' ? 'Exact locality reference matched.' : matchLevel === 'city' ? 'Fell back to a city-level reference.' : 'Fell back to a country-level proxy.',
  });

  const allExtracted = documents.flatMap(d => d.extracted);
  const avgExtractionConfidence = allExtracted.length > 0 ? allExtracted.reduce((s, f) => s + f.confidence, 0) / allExtracted.length : 0;
  const extractionContribution = allExtracted.length > 0 ? Math.round((avgExtractionConfidence - 0.5) * 20) : -5;
  factors.push({
    key: 'extraction',
    label: 'Extraction confidence',
    contribution: extractionContribution,
    note: allExtracted.length > 0 ? `Average field-extraction confidence ${round2(avgExtractionConfidence)}.` : 'No extracted fields available yet.',
  });

  const mids = anchors.map(a => a.mid).filter(m => m > 0);
  const avgMid = mids.reduce((s, m) => s + m, 0) / (mids.length || 1);
  const spread = mids.length > 1 ? (Math.max(...mids) - Math.min(...mids)) / avgMid : 0;
  const agreementContribution = clamp(Math.round((0.4 - spread) * 25), -15, 10);
  factors.push({ key: 'anchor_agreement', label: 'Anchor agreement', contribution: agreementContribution, note: `Anchors span ${round1(spread * 100)}% of their average mid value.` });

  const askingContribution = askingPricePresent ? 3 : -2;
  factors.push({
    key: 'asking_price',
    label: 'Asking price on file',
    contribution: askingContribution,
    note: askingPricePresent ? 'An asking price is available to sense-check against.' : 'No asking price on file to sense-check against.',
  });

  if (landComparableGeography) {
    const { level, found } = landComparableGeography;
    const contribution = !found ? -12 : level === 'locality' ? 6 : level === 'city' ? 0 : -6;
    factors.push({
      key: 'land_comparable_geography',
      label: 'Land comparable geography',
      contribution,
      note: !found
        ? 'No land-parcel comparables were found for this site anywhere in the reference pool, even after widening to a country-wide search.'
        : level === 'locality'
          ? 'Enough land-parcel comparables were found within the subject locality itself.'
          : level === 'city'
            ? 'Land-parcel comparables were only sufficient after widening the search to the city as a whole.'
            : 'Land-parcel comparables were only found after widening the search to a country-wide proxy.',
    });
  }

  const score = clamp(Math.round(factors.reduce((s, f) => s + f.contribution, 0)), 0, 100);
  const band: ConfidenceBand = score < 45 ? 'low' : score < 72 ? 'moderate' : 'high';

  const weakest = [...factors].filter(f => f.key !== 'base').sort((a, b) => a.contribution - b.contribution)[0];
  const biggestLever = weakest
    ? `${weakest.label} is the weakest contributor (${weakest.contribution >= 0 ? '+' : ''}${weakest.contribution} pts) — improving it would add the most confidence.`
    : 'Add more documents and comparables to raise confidence.';

  return { score, band, factors, biggestLever };
}

/* ==================================================================== */
/* Recommended actions                                                   */
/* ==================================================================== */

/**
 * Action ids are derived from stable semantic keys (`doc-<kind>`,
 * `risk-<code>`, or a fixed baseline key) rather than array position, so the
 * same logical action keeps the same id across re-screens — which is what
 * lets `done` be carried over from `previousResult` by matching `id`.
 */
function buildActions(caseId: string, completeness: CompletenessSummary, risks: RiskFlag[], previousResult: ScreenResult | undefined): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  const mk = (
    key: string,
    title: string,
    description: string,
    priority: ActionPriority,
    owner: ActionOwner,
    effort: 'low' | 'medium' | 'high',
    unblocks: string[],
    relatedRiskIds: string[],
  ): void => {
    const id = `action-${caseId}-${key}`;
    const previous = previousResult?.actions.find(a => a.id === id);
    actions.push({ id, title, description, priority, owner, effort, unblocks, relatedRiskIds, done: previous?.done ?? false });
  };

  // Baseline actions — always relevant regardless of what the case-specific risks turn up.
  mk('verify-parcel', 'Verify parcel identity against the registry', 'Cross-check the parcel/survey identifier against the land registry to confirm the physical parcel matches the documents on file.', 'before_offer', 'lawyer', 'low', ['Confirms parcel/address match'], []);
  mk('confirm-possession', 'Confirm vacant possession / tenancy status', 'Confirm whether the property will be delivered vacant or subject to an existing tenancy, and align the offer accordingly.', 'before_offer', 'buyer', 'low', ['Clarifies handover basis'], []);
  mk('lender-check', 'Sense-check the indicative value with a lender', 'Share the indicative value range with a prospective lender early to confirm financing feasibility at the likely price.', 'before_offer', 'lender', 'low', ['Confirms financing feasibility'], []);

  for (const item of completeness.items) {
    if (item.required && !item.present) {
      mk(`doc-${item.key}`, `Obtain ${item.label}`, `${item.label} is required for a complete screen and is not yet on file.`, 'before_offer', 'buyer', 'low', [`Confirms ${item.label.toLowerCase()}`], []);
    }
  }

  for (const risk of risks) {
    if (risk.status !== 'open') continue;
    switch (risk.code) {
      case 'no_encumbrance_certificate':
        mk('risk-no-ec', 'Pull a fresh encumbrance certificate', risk.mitigation, 'now', 'lawyer', 'low', ['Confirms clean chain of title'], [risk.id]);
        break;
      case 'unknown_tenure':
      case 'leasehold_tenure':
        mk('risk-tenure', 'Confirm tenure and lease terms', risk.mitigation, 'before_offer', 'lawyer', 'medium', ['Confirms tenure basis for valuation and financing'], [risk.id]);
        break;
      case 'asking_price_above_mid':
        mk('risk-asking-gap', 'Build a negotiation case from the anchor breakdown', risk.mitigation, 'before_offer', 'buyer', 'low', ['Supports a lower offer'], [risk.id]);
        break;
      case 'thin_comparable_evidence':
        mk('risk-thin-comps', 'Commission a local valuation opinion', risk.mitigation, 'before_offer', 'valuer', 'medium', ['Narrows the value range'], [risk.id]);
        break;
      case 'aging_building_no_occupancy_certificate':
        mk('risk-oc', 'Request the occupancy certificate or a compliance survey', risk.mitigation, 'before_offer', 'surveyor', 'medium', ['Confirms build compliance'], [risk.id]);
        break;
      case 'far_exceeded':
        mk('risk-far', 'Get a planning opinion on the FAR breach', risk.mitigation, 'now', 'lawyer', 'high', ['Assesses regularisation exposure'], [risk.id]);
        break;
      case 'zoning_mismatch':
        mk('risk-zoning', 'Confirm permitted use with the planning authority', risk.mitigation, 'before_offer', 'lawyer', 'medium', ['Confirms use compliance'], [risk.id]);
        break;
      case 'missing_energy_label':
        mk('risk-energy-label', 'Order an energy label assessment', risk.mitigation, 'before_completion', 'seller', 'low', ['Meets legal disclosure requirement'], [risk.id]);
        break;
      case 'locality_data_thin':
        mk('risk-locality-data', 'Commission a local market appraisal', risk.mitigation, 'before_offer', 'valuer', 'medium', ['Replaces the country-level proxy with local data'], [risk.id]);
        break;
      default:
        // Generic fallback for risk codes without a hand-authored action above
        // — chiefly the Karnataka compliance-driven risks (B-khata,
        // unconverted agricultural land, PTCL-granted land, buffer proximity,
        // ...), so a critical or serious compliance finding always drives a
        // concrete next step even before it earns its own bespoke wording.
        if (risk.severity === 'critical' || risk.severity === 'serious') {
          mk(`risk-${risk.code}`, `Resolve: ${risk.title}`, risk.mitigation, risk.severity === 'critical' ? 'now' : 'before_offer', 'lawyer', 'medium', [`Addresses ${risk.title.toLowerCase()}`], [risk.id]);
        }
        break;
    }
  }

  mk('final-review', 'Commission an independent valuation before completion', 'A Property Screen supports the decision to pursue but is not a certified valuation — commission one before completion.', 'before_completion', 'valuer', 'medium', ['Provides a certified value for financing/completion'], []);

  const priorityRank: Record<ActionPriority, number> = { now: 0, before_offer: 1, before_completion: 2 };
  actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  return actions.slice(0, 10);
}

/* ==================================================================== */
/* Snapshot & recommendation                                             */
/* ==================================================================== */

function buildSnapshot(
  identity: PropertyIdentity,
  indicativeValue: IndicativeValue,
  confidence: ConfidenceSummary,
  risks: RiskFlag[],
  completeness: CompletenessSummary,
  countryPack: CountryPack,
): PropertySnapshot {
  const openCritical = risks.filter(r => r.status === 'open' && r.severity === 'critical').length;
  const fmt = (v: number): string => `${indicativeValue.currency} ${v.toLocaleString(countryPack.locale)}`;
  const headline = `${identity.label} is indicatively worth ${fmt(indicativeValue.low)}–${fmt(indicativeValue.high)} (mid ${fmt(indicativeValue.mid)}), at ${confidence.band} confidence.`;
  const bullets: string[] = [
    `Indicative range spans ±${round1(indicativeValue.spreadPct)}% around the mid value.`,
    indicativeValue.askingVsMidPct !== null
      ? `Asking price sits ${indicativeValue.askingVsMidPct >= 0 ? '+' : ''}${round1(indicativeValue.askingVsMidPct)}% versus the indicative mid.`
      : 'No asking price on file to compare against the indicative mid.',
    `${completeness.score}/100 document completeness${completeness.missingCritical.length > 0 ? `, missing: ${completeness.missingCritical.join(', ')}` : ', all critical documents on file'}.`,
    openCritical > 0 ? `${openCritical} open critical risk${openCritical === 1 ? '' : 's'} require resolution before proceeding.` : 'No open critical risks identified.',
  ];
  // A bare site's meaningful area is plot area, not built-up area (which is
  // legitimately 0 for a site with nothing built on it yet).
  const isLand = isLandPropertyType(identity.propertyType);
  const keyFacts = [
    { label: 'Property type', value: identity.propertyType.replace(/_/g, ' ') },
    isLand
      ? { label: 'Plot area', value: `${identity.plotAreaSqm.toLocaleString()} sqm` }
      : { label: 'Built-up area', value: `${identity.builtUpAreaSqm.toLocaleString()} sqm` },
    { label: 'Tenure', value: identity.tenure },
    { label: 'Locality', value: `${identity.locality}, ${identity.city}` },
  ];
  return { headline, bullets, keyFacts };
}

function buildRecommendation(
  risks: RiskFlag[],
  confidence: ConfidenceSummary,
  completeness: CompletenessSummary,
  indicativeValue: IndicativeValue,
): ScreenResult['recommendation'] {
  const openRisks = risks.filter(r => r.status === 'open');
  const criticalOpen = openRisks.filter(r => r.severity === 'critical');
  const seriousOpen = openRisks.filter(r => r.severity === 'serious');
  const askingHigh = indicativeValue.askingVsMidPct !== null && indicativeValue.askingVsMidPct > 20;

  let verdict: ScreenVerdict;
  const reasoning: string[] = [];
  const conditions: string[] = [];

  if (criticalOpen.length > 0) {
    verdict = 'do_not_pursue';
    reasoning.push(`${criticalOpen.length} open critical risk${criticalOpen.length === 1 ? '' : 's'} (${criticalOpen.map(r => r.title).join(', ')}) are deal-threatening as things stand.`);
    conditions.push(...criticalOpen.map(r => r.mitigation));
  } else if (confidence.band === 'low' || completeness.missingCritical.length >= 2) {
    verdict = 'investigate_further';
    reasoning.push(`Confidence is ${confidence.band} and ${completeness.missingCritical.length} critical document(s) are missing — the evidence base is too thin for a firm verdict.`);
    conditions.push('Provide the missing critical documents and re-run the screen.');
  } else if (seriousOpen.length > 0 || askingHigh) {
    verdict = 'pursue_with_conditions';
    if (seriousOpen.length > 0) reasoning.push(`${seriousOpen.length} serious risk(s) need resolving: ${seriousOpen.map(r => r.title).join(', ')}.`);
    if (askingHigh) reasoning.push(`Asking price is ${round1(indicativeValue.askingVsMidPct ?? 0)}% above the indicative mid, which should be negotiated down.`);
    conditions.push(...seriousOpen.map(r => r.mitigation));
    if (askingHigh) conditions.push('Negotiate the price toward the indicative mid before committing.');
  } else {
    verdict = 'pursue';
    reasoning.push(`No open critical or serious risks were identified, and confidence is ${confidence.band}.`);
    reasoning.push(`Document completeness is ${completeness.score}/100.`);
  }

  reasoning.push(`Indicative value: ${indicativeValue.currency} ${indicativeValue.low.toLocaleString()}–${indicativeValue.high.toLocaleString()} (mid ${indicativeValue.mid.toLocaleString()}).`);
  if (reasoning.length < 3) reasoning.push(`${openRisks.length} open risk(s) in total across all severities.`);
  if (conditions.length === 0) conditions.push('No blocking conditions identified — proceed with standard due diligence.');

  const headline =
    verdict === 'pursue'
      ? 'Pursue — the evidence supports moving forward.'
      : verdict === 'pursue_with_conditions'
        ? 'Pursue, subject to the conditions below.'
        : verdict === 'investigate_further'
          ? 'Investigate further before forming a view.'
          : 'Do not pursue until the critical risks are resolved.';

  return { verdict, headline, reasoning: reasoning.slice(0, 5), conditions: [...new Set(conditions)].slice(0, 6) };
}

/* ==================================================================== */
/* Evidence integrity                                                    */
/* ==================================================================== */

/**
 * The traceability guarantee the UI relies on: every `evidenceIds` entry
 * anywhere in the result must name an id that actually exists in
 * `result.evidence`. Thrown errors here indicate an engine bug, not bad user
 * input, so this is an assertion, not a recoverable validation error.
 */
function assertEvidenceIntegrity(result: ScreenResult): void {
  const known = new Set(result.evidence.map(e => e.id));
  const missing: string[] = [];
  const check = (ids: string[], where: string): void => {
    for (const id of ids) {
      if (!known.has(id)) missing.push(`${where} -> ${id}`);
    }
  };
  result.anchors.forEach(a => check(a.evidenceIds, `anchor:${a.id}`));
  result.drivers.forEach(d => check(d.evidenceIds, `driver:${d.id}`));
  result.risks.forEach(r => check(r.evidenceIds, `risk:${r.id}`));
  check(result.planning.evidenceIds, 'planning');
  result.stateCompliance?.checks.forEach(c => check(c.evidenceIds, `compliance:${c.key}`));
  // Playbook steps cite evidence like every other surface, so they are held to
  // the same guarantee. A step whose citation dangles is worse than one with
  // no citation at all: it reads as traceable and is not.
  result.playbooks?.forEach(p => p.steps.forEach(step => check(step.evidenceIds, `playbook:${p.playbookId}:${step.key}`)));
  if (missing.length > 0) {
    throw new Error(`Evidence traceability broken — dangling evidenceIds: ${missing.join(', ')}`);
  }

  // Risks and Compliance must never disagree: every relatedRiskIds entry a
  // compliance check names has to point at a RiskFlag that actually exists
  // in this same result.
  const knownRiskIds = new Set(result.risks.map(r => r.id));
  const missingRiskLinks: string[] = [];
  result.stateCompliance?.checks.forEach(c => {
    for (const riskId of c.relatedRiskIds) {
      if (!knownRiskIds.has(riskId)) missingRiskLinks.push(`compliance:${c.key} -> ${riskId}`);
    }
  });
  if (missingRiskLinks.length > 0) {
    throw new Error(`Compliance/risk linkage broken — dangling relatedRiskIds: ${missingRiskLinks.join(', ')}`);
  }
}

/* ==================================================================== */
/* runScreen — the top-level entry point                                 */
/* ==================================================================== */

export function runScreen(input: {
  caseId: string;
  reference: string;
  identity: PropertyIdentity;
  documents: CaseDocument[];
  refData: ReferenceData;
  now: string;
  previousResult?: ScreenResult;
  /**
   * Where the property is and what surrounds it, when a mapping provider has
   * been configured and a build has run.
   *
   * Optional, and optional in the strong sense: every figure this engine
   * produces has a defined value without it. It is read in exactly one place
   * — the transit-proximity driver — and only when the geocode landed on the
   * property rather than on its locality. It never supplies an extent, a
   * boundary or a setback; see `SiteContext` for why.
   */
  siteContext?: SiteContext;
}): ScreenResult {
  const { caseId, identity, documents, refData, now, previousResult, siteContext } = input;
  const evidence = new EvidenceBuilder(caseId, now);

  const countryPack = refData.countryPacks.find(p => p.country === identity.country);
  if (!countryPack) {
    throw new Error(`No country pack registered for ${identity.country}`);
  }
  const statePack = resolveStatePack(identity, refData);
  const statutoryRateLabel = statePack?.statutoryRateLabel ?? countryPack.statutoryRateLabel;
  const requiredDocs = resolveRequiredDocuments(countryPack, statePack);

  // Backfill extraction for any document that has finished OCR but has not
  // had field extraction run against it yet — keeps the engine usable even
  // when the caller hasn't pre-populated `extracted`.
  const documentsWithExtraction: CaseDocument[] = documents.map(doc => {
    if (doc.extracted.length === 0 && doc.ocrStatus === 'complete' && doc.kind !== 'unclassified' && doc.kind !== 'photograph') {
      return { ...doc, extracted: extractFields(doc, identity, caseId) };
    }
    return doc;
  });

  // One evidence item per document-derived fact.
  for (const doc of documentsWithExtraction) {
    for (const field of doc.extracted) {
      evidence.add({
        statement: `${field.label}: ${field.value}${field.unit ? ` ${field.unit}` : ''} (from ${doc.fileName}).`,
        sourceType: 'document',
        sourceRef: doc.id,
        sourceLabel: doc.fileName,
        confidence: field.confidence,
      });
    }
  }

  const isLand = isLandPropertyType(identity.propertyType);
  const { ref: locality, matchLevel } = matchLocalityReference(identity, refData.localities);
  const { comparables, compMatchLevel } = buildComparables(identity, refData.comparablePool, refData.localities, locality, now);

  // Planning is computed before anchors (rather than after, as it used to
  // be) so the residual_development anchor can use it — it depends only on
  // identity/locality/now, never on anchors or comparables, so reordering it
  // changes no value, only the sequence evidence ids are minted in.
  const planning = buildPlanning(identity, locality, now, evidence);
  const anchors = buildAnchors(caseId, identity, comparables, locality, matchLevel, compMatchLevel, planning, statutoryRateLabel, documentsWithExtraction, now, evidence);

  const baseBlend = blendIndicativeValue(anchors, identity.currency);
  const baseMidPerSqm = baseBlend.mid / subjectComparisonAreaSqm(identity);

  const completeness = buildCompleteness(requiredDocs, documentsWithExtraction);

  const askingVsMidPctRaw = identity.askingPrice !== undefined ? ((identity.askingPrice - baseBlend.mid) / baseBlend.mid) * 100 : null;

  const baseRisks = buildRisks(
    caseId,
    identity,
    documentsWithExtraction,
    completeness,
    comparables,
    locality,
    matchLevel,
    compMatchLevel,
    countryPack,
    statePack,
    planning,
    askingVsMidPctRaw,
    now,
    previousResult,
    evidence,
  );

  // A State Pack's title checks run after the country-level risks so that
  // checks like "Encumbrance continuity" can link to an existing risk (e.g.
  // `no_encumbrance_certificate`) instead of minting a duplicate.
  const stateComplianceResult = statePack ? buildStateCompliance(caseId, identity, documentsWithExtraction, statePack, baseRisks, previousResult, evidence) : undefined;
  const risks = stateComplianceResult ? [...baseRisks, ...stateComplianceResult.risks] : baseRisks;

  const confidence = buildConfidence(
    completeness,
    comparables,
    matchLevel,
    documentsWithExtraction,
    anchors,
    identity.askingPrice !== undefined,
    isLand ? { level: compMatchLevel, found: comparables.length > 0 } : undefined,
  );

  const widened = widenForConfidence(baseBlend, confidence.band, identity.currency);
  const spreadPct = round1(((widened.high - widened.low) / 2 / widened.mid) * 100);
  const askingVsMidPct = identity.askingPrice !== undefined ? round1(((identity.askingPrice - widened.mid) / widened.mid) * 100) : null;

  // A site is priced per sqm of plot, not built-up area — showing the
  // indicative range per sqm of a (possibly zero) built-up area would be the
  // exact mispricing this feature exists to fix.
  const perSqmArea = subjectComparisonAreaSqm(identity);
  const indicativeValue: IndicativeValue = {
    low: widened.low,
    mid: widened.mid,
    high: widened.high,
    currency: identity.currency,
    perSqm: {
      low: roundRate(widened.low / perSqmArea, identity.currency),
      mid: roundRate(widened.mid / perSqmArea, identity.currency),
      high: roundRate(widened.high / perSqmArea, identity.currency),
    },
    spreadPct,
    askingVsMidPct,
  };

  const drivers = buildDrivers(caseId, identity, locality, planning, documentsWithExtraction, baseMidPerSqm, now, evidence, siteContext);
  const actions = buildActions(caseId, completeness, risks, previousResult);
  const snapshot = buildSnapshot(identity, indicativeValue, confidence, risks, completeness, countryPack);
  const recommendation = buildRecommendation(risks, confidence, completeness, indicativeValue);
  const transactionCosts = statePack ? computeTransactionCosts(identity, statePack, locality) : undefined;

  const marketContext: MarketContext = {
    medianPricePerSqm: locality.medianPricePerSqm,
    yoyChangePct: locality.yoyChangePct,
    liquidityDays: locality.liquidityDays,
    sampleSize: locality.sampleSize,
    source: locality.source,
    trend: locality.trend,
  };

  const result: ScreenResult = {
    caseId,
    generatedAt: now,
    engineVersion: ENGINE_VERSION,
    snapshot,
    indicativeValue,
    anchors,
    comparables,
    drivers,
    risks,
    planning,
    completeness,
    confidence,
    evidence: evidence.list(),
    actions,
    marketContext,
    stateCompliance: stateComplianceResult?.compliance,
    transactionCosts,
    recommendation,
  };

  /*
   * Title graph and playbooks.
   *
   * Both run after the result is assembled, and for different reasons. The
   * graph is independent of the screen — it reads documents, not valuations —
   * but attaching it here keeps a single object as the case's analytical
   * output rather than a second thing the caller has to remember to fetch.
   * Playbooks genuinely depend on the result: a step that asks whether a
   * statutory check cleared has to read the check.
   *
   * Neither may change a computed number. They are additive fields on a
   * finished `ScreenResult`, which is the same boundary the agent layer
   * observes — the engine stays the arithmetic authority.
   */
  const graphCase: PropertyCase = {
    id: caseId,
    reference: input.reference,
    identity,
    status: 'screened',
    persona: 'property_investor',
    ownerName: '',
    createdAt: now,
    updatedAt: now,
    documents: documentsWithExtraction,
    notes: '',
  };
  const analysis = analyseTitleGraph(graphCase, now);
  // An empty graph is not a finding, it is an absence. Attaching a summary
  // that says "0 nodes, integrity 0" would render as a title problem on a
  // case whose documents simply do not speak to ownership.
  if (analysis.graph.nodes.length > 0) {
    result.titleGraph = analysis.summary;
  }
  const playbooks = runPlaybooks({ ...graphCase, result }, result, now);
  if (playbooks.length > 0) {
    result.playbooks = playbooks;
  }

  assertEvidenceIntegrity(result);
  return result;
}

/* ==================================================================== */
/* compareCases — key user job 8                                         */
/* ==================================================================== */

function hasResult(c: PropertyCase): c is PropertyCase & { result: ScreenResult } {
  return c.result !== undefined;
}

/**
 * Builds the side-by-side comparison for a set of cases. Reads locality gross
 * yield and liquidity from the same static `REFERENCE_DATA` the rest of the
 * engine uses (via `matchLocalityReference`) since `ScreenResult` itself has
 * no dedicated yield field — this keeps the function pure and dependent only
 * on its arguments plus static reference data, never on live lookups.
 */
export function compareCases(cases: PropertyCase[], now: string): ComparisonResult {
  const rows: ComparisonRow[] = [];
  const caveats: string[] = [];

  const currencies = new Set(cases.map(c => c.identity.currency));
  const propertyTypes = new Set(cases.map(c => c.identity.propertyType));
  if (currencies.size > 1) {
    caveats.push(`Cases span multiple currencies (${[...currencies].join(', ')}) — currency-denominated figures are not directly comparable across them.`);
  }
  if (propertyTypes.size > 1) {
    caveats.push(`Cases span multiple property types (${[...propertyTypes].join(', ')}) — comparable-driven metrics may not be like-for-like.`);
  }
  const unscreened = cases.filter(c => !c.result);
  if (unscreened.length > 0) {
    caveats.push(`${unscreened.map(c => c.reference).join(', ')} ${unscreened.length === 1 ? 'has' : 'have'} not been screened yet — some rows are blank for ${unscreened.length === 1 ? 'it' : 'them'}.`);
  }

  const marketByCaseId = new Map(
    cases.map(c => {
      const { ref } = matchLocalityReference(c.identity, REFERENCE_DATA.localities);
      return [c.id, { grossYield: ref.grossYield, liquidityDays: c.result?.marketContext.liquidityDays ?? ref.liquidityDays }] as const;
    }),
  );

  rows.push({
    key: 'askingPrice',
    label: 'Asking price',
    better: 'none',
    format: 'currency',
    values: cases.map(c => ({ caseId: c.id, value: c.identity.askingPrice ?? null, note: c.identity.askingPrice === undefined ? 'No asking price on file' : undefined })),
  });
  rows.push({
    key: 'indicativeMid',
    label: 'Indicative mid value',
    better: 'none',
    format: 'currency',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.indicativeValue.mid ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'pricePerSqm',
    label: 'Indicative mid — per sqm',
    better: 'lower',
    format: 'currency_per_sqm',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.indicativeValue.perSqm.mid ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'askingVsMid',
    label: 'Asking vs indicative mid',
    better: 'lower',
    format: 'percent',
    values: cases.map(c => ({
      caseId: c.id,
      value: c.result?.indicativeValue.askingVsMidPct ?? null,
      note: c.result?.indicativeValue.askingVsMidPct == null ? 'No asking price on file, or not yet screened' : undefined,
    })),
  });
  rows.push({
    key: 'confidence',
    label: 'Confidence score',
    better: 'higher',
    format: 'score',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.confidence.score ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'completeness',
    label: 'Document completeness',
    better: 'higher',
    format: 'score',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.completeness.score ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'openCriticalRisks',
    label: 'Open critical risks',
    better: 'lower',
    format: 'number',
    values: cases.map(c => ({
      caseId: c.id,
      value: c.result ? c.result.risks.filter(r => r.status === 'open' && r.severity === 'critical').length : null,
      note: c.result ? undefined : 'Not yet screened',
    })),
  });
  rows.push({
    key: 'spreadPct',
    label: 'Value range spread',
    better: 'lower',
    format: 'percent',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.indicativeValue.spreadPct ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'yieldProxy',
    label: 'Locality gross yield (proxy)',
    better: 'higher',
    format: 'percent',
    values: cases.map(c => ({ caseId: c.id, value: round2((marketByCaseId.get(c.id)?.grossYield ?? 0) * 100) })),
  });
  rows.push({
    key: 'liquidityDays',
    label: 'Market liquidity (days to transact)',
    better: 'lower',
    format: 'days',
    values: cases.map(c => ({ caseId: c.id, value: marketByCaseId.get(c.id)?.liquidityDays ?? null })),
  });
  rows.push({
    key: 'developmentPotential',
    label: 'Development potential',
    better: 'none',
    format: 'text',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.planning.developmentPotential ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });
  rows.push({
    key: 'verdict',
    label: 'Recommendation',
    better: 'none',
    format: 'text',
    values: cases.map(c => ({ caseId: c.id, value: c.result?.recommendation.verdict ?? null, note: c.result ? undefined : 'Not yet screened' })),
  });

  const verdictRank: Record<ScreenVerdict, number> = { pursue: 3, pursue_with_conditions: 2, investigate_further: 1, do_not_pursue: 0 };
  const screened = cases.filter(hasResult);
  let shortlist: ComparisonResult['shortlist'] = null;
  if (screened.length > 0) {
    const openCriticalCount = (c: PropertyCase & { result: ScreenResult }): number => c.result.risks.filter(r => r.status === 'open' && r.severity === 'critical').length;
    const best = screened.reduce((a, b) => {
      const rankDelta = verdictRank[b.result.recommendation.verdict] - verdictRank[a.result.recommendation.verdict];
      if (rankDelta !== 0) return rankDelta > 0 ? b : a;
      const confidenceDelta = b.result.confidence.score - a.result.confidence.score;
      if (confidenceDelta !== 0) return confidenceDelta > 0 ? b : a;
      return openCriticalCount(b) < openCriticalCount(a) ? b : a;
    });
    shortlist = {
      caseId: best.id,
      reason: `${best.reference} has the strongest recommendation (${best.result.recommendation.verdict.replace(/_/g, ' ')}) at ${best.result.confidence.band} confidence (${best.result.confidence.score}/100) with ${openCriticalCount(best)} open critical risk(s).`,
    };
  }

  return {
    generatedAt: now,
    cases: cases.map(c => ({ id: c.id, reference: c.reference, label: c.identity.label, currency: c.identity.currency })),
    rows,
    shortlist,
    caveats,
  };
}
