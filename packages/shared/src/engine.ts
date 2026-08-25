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
  Comparable,
  ComparableAdjustment,
  CompletenessItem,
  CompletenessSummary,
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
  EvidenceItem,
  EvidenceSourceType,
  ExtractedField,
  ExtractionMethod,
  IndicativeValue,
  LocalityReference,
  MarketContext,
  PlanningPosition,
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
  ValueAnchor,
  ValueDriver,
} from './types';
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
  { pattern: /sale.?agreement|koopovereenkomst|agreement.?to.?sell/i, kind: 'sale_agreement', confidence: 0.88 },
  { pattern: /\bec[-_ ]|encumbrance/i, kind: 'encumbrance_certificate', confidence: 0.91 },
  { pattern: /khata/i, kind: 'khata_extract', confidence: 0.9 },
  { pattern: /rera/i, kind: 'rera_registration', confidence: 0.89 },
  { pattern: /kadaster|uittreksel/i, kind: 'kadaster_extract', confidence: 0.92 },
  { pattern: /woz/i, kind: 'woz_assessment', confidence: 0.94 },
  { pattern: /energie|energy.?label/i, kind: 'energy_label', confidence: 0.9 },
  { pattern: /\boc[-_ ]|occupancy/i, kind: 'occupancy_certificate', confidence: 0.87 },
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
    case 'khata_extract':
      return [
        mkField('khataNumber', 'Khata number', `K/${Math.floor(rnd('khata', 1000, 9999))}/${new Date().getFullYear()}`, conf('khata'), docId, 'ocr'),
        mkField('assessedArea', 'Assessed area', identity.builtUpAreaSqm.toFixed(1), conf('area'), docId, 'parser', 'sqm'),
      ];
    case 'property_tax_receipt':
      return [
        mkField('assessmentYear', 'Assessment year', String(uploadYear - Math.floor(rnd('ay', 0, 1))), conf('ay'), docId, 'ocr'),
        mkField('annualTax', 'Annual tax paid', String(Math.round(rnd('tax', 8000, 65000))), conf('tax'), docId, 'ocr', identity.currency),
      ];
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
    case 'rera_registration':
      return [
        mkField('reraNumber', 'RERA registration number', `PR/${identity.state.slice(0, 2).toUpperCase()}/${Math.floor(rnd('rera', 100000, 999999))}`, conf('rera'), docId, 'ocr'),
        mkField('reraValidTill', 'Valid until', `${uploadYear + Math.floor(rnd('reraexp', 1, 5))}-12-31`, conf('reraexp'), docId, 'parser'),
      ];
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

function selectComparableCandidates(identity: PropertyIdentity, pool: Comparable[], localities: LocalityReference[]): Comparable[] {
  const byLocality = pool.filter(c => addressMentions(c, identity.locality));
  let candidates = byLocality;

  if (candidates.length < 4) {
    const byCity = pool.filter(c => addressMentions(c, identity.city));
    candidates = dedupeById([...candidates, ...byCity]);
  }

  if (candidates.length < 4) {
    const countryLocalities = localities.filter(l => l.country === identity.country);
    const byCountry = pool.filter(c => countryLocalities.some(l => addressMentions(c, l.locality) || addressMentions(c, l.city)));
    candidates = dedupeById([...candidates, ...byCountry]);
  }

  return candidates;
}

/**
 * Applies signed, per-comparable adjustments (time, size, floor/age/condition,
 * tenure) to bring a raw pool transaction toward the subject's own profile, and
 * sets the final `similarity` score used both to rank and to weight the
 * comparable-sales anchor.
 */
function adjustComparable(comp: Comparable, identity: PropertyIdentity, locality: LocalityReference, now: string, similarity: number): Comparable {
  const adjustments: ComparableAdjustment[] = [];

  // 1. Time / market movement — bring an older transaction up (or down) to the
  // valuation date using the locality's own annual trend.
  const monthsAgo = monthsBetween(comp.transactedAt, now);
  const timePct = round1(locality.yoyChangePct * (monthsAgo / 12));
  if (Math.abs(timePct) >= 0.1) {
    adjustments.push({ key: 'time', label: 'Time adjustment to valuation date', pct: timePct });
  }

  // 2. Size — larger units typically transact at a discount per sqm, smaller at a premium.
  const areaDeltaPct = (comp.areaSqm - identity.builtUpAreaSqm) / Math.max(identity.builtUpAreaSqm, 1);
  let sizePct = 0;
  if (areaDeltaPct > 0.2) sizePct = -3;
  else if (areaDeltaPct < -0.2) sizePct = 3;
  if (sizePct !== 0) {
    adjustments.push({ key: 'size', label: 'Unit size differential', pct: sizePct });
  }

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

  // 4. Tenure — the comparable pool is predominantly freehold-quality market
  // stock, so a leasehold or unresolved-tenure subject is adjusted down rather
  // than assumed equivalent.
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
 * distance, area fit, recency and property-type match.
 */
function buildComparables(identity: PropertyIdentity, pool: Comparable[], localities: LocalityReference[], locality: LocalityReference, now: string): Comparable[] {
  const candidates = selectComparableCandidates(identity, pool, localities);

  const scored = candidates.map(c => {
    const distanceScore = clamp(1 - c.distanceKm / 8, 0, 1);
    const areaScore = clamp(1 - Math.abs(c.areaSqm - identity.builtUpAreaSqm) / Math.max(identity.builtUpAreaSqm, 1), 0, 1);
    const monthsAgo = Math.max(0, monthsBetween(c.transactedAt, now));
    const recencyScore = clamp(1 - monthsAgo / 24, 0, 1);
    const typeScore = c.propertyType === identity.propertyType ? 1 : 0.3;
    const similarity = round2(clamp(0.35 * distanceScore + 0.25 * areaScore + 0.2 * recencyScore + 0.2 * typeScore, 0, 1));
    return { comp: c, similarity };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  const selected = scored.slice(0, Math.min(7, scored.length));

  return selected.map(({ comp, similarity }) => adjustComparable(comp, identity, locality, now, similarity));
}

/* ==================================================================== */
/* Value anchors                                                         */
/* ==================================================================== */

const INCOME_ELIGIBLE_TYPES: PropertyType[] = ['commercial_office', 'retail_unit', 'industrial_warehouse'];

/**
 * Builds 3-5 value anchors depending on what data is actually available for
 * the case. `comparable_sales`, `statutory_reference` and `index_trend` are
 * always present (every case has comparables-or-a-fallback, a matched
 * locality, and a country pack); `income_capitalisation`,
 * `depreciated_replacement_cost` and `asking_price_adjusted` are conditional.
 */
function buildAnchors(
  caseId: string,
  identity: PropertyIdentity,
  comparables: Comparable[],
  locality: LocalityReference,
  matchLevel: LocalityMatchLevel,
  countryPack: CountryPack,
  documents: CaseDocument[],
  now: string,
  evidence: EvidenceBuilder,
): ValueAnchor[] {
  const anchors: ValueAnchor[] = [];
  const area = identity.builtUpAreaSqm;
  const currency = identity.currency;

  // --- comparable_sales ---------------------------------------------------
  if (comparables.length > 0) {
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
    const confidence = round2(clamp(0.45 + comparables.length * 0.04 + avgSimilarity * 0.25 + (recentCount / comparables.length) * 0.1, 0, 0.95));
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
      rationale: `Derived from ${comparables.length} adjusted comparable transaction${comparables.length === 1 ? '' : 's'} in ${matchLabel}, averaging ${round1(avgSimilarity * 100)}% similarity to the subject after adjusting each for time, size, condition and tenure.`,
      evidenceIds: compEvidenceIds,
    });
  }

  // --- statutory_reference --------------------------------------------------
  {
    const statutoryEvId = evidence.add({
      statement: `${countryPack.statutoryRateLabel} for ${locality.locality}, ${locality.city} is ${locality.statutoryRatePerSqm.toLocaleString()}/sqm against a market median of ${locality.medianPricePerSqm.toLocaleString()}/sqm.`,
      sourceType: 'external_dataset',
      sourceRef: locality.id,
      sourceLabel: locality.source,
      confidence: 0.8,
    });
    // Treated as a floor-to-ceiling band: the statutory rate is a hard floor
    // and the locality market median a ceiling, with the midpoint as the
    // central estimate. This keeps the anchor genuinely distinct from (and
    // more conservative than) the comparable/index anchors.
    const floorRate = locality.statutoryRatePerSqm;
    const ceilingRate = locality.medianPricePerSqm;
    const midRate = (floorRate + ceilingRate) / 2;
    const matchPenalty = matchLevel === 'country' ? 0.15 : matchLevel === 'city' ? 0.05 : 0;
    anchors.push({
      id: `anchor-${caseId}-statutory_reference`,
      method: 'statutory_reference',
      label: `${countryPack.statutoryRateLabel} reference`,
      low: roundMoney(floorRate * area, currency),
      mid: roundMoney(midRate * area, currency),
      high: roundMoney(ceilingRate * area, currency),
      weight: 0.15,
      confidence: round2(clamp(0.7 - matchPenalty, 0.2, 0.9)),
      rationale: `Uses the ${countryPack.statutoryRateLabel.toLowerCase()} as a conservative floor and the locality's transacted market median as a ceiling — statutory rates typically lag realised prices, so the midpoint is the central estimate.`,
      evidenceIds: [statutoryEvId],
    });
  }

  // --- income_capitalisation -------------------------------------------------
  const leaseDoc = documents.find(d => d.kind === 'lease_agreement');
  if (INCOME_ELIGIBLE_TYPES.includes(identity.propertyType) || leaseDoc) {
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
  if (identity.yearBuilt !== undefined) {
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
  {
    const trendEvId = evidence.add({
      statement: `Locality median of ${locality.medianPricePerSqm.toLocaleString()}/sqm, trending ${round1(locality.yoyChangePct)}% YoY across ${locality.sampleSize} sampled transactions.`,
      sourceType: 'external_dataset',
      sourceRef: locality.id,
      sourceLabel: locality.source,
      confidence: 0.75,
    });
    const band = clamp(0.05 + (100 / Math.max(locality.sampleSize, 10)) * 0.05, 0.05, 0.18);
    const mid = locality.medianPricePerSqm * area;
    anchors.push({
      id: `anchor-${caseId}-index_trend`,
      method: 'index_trend',
      label: 'Locality index trend',
      low: roundMoney(mid * (1 - band), currency),
      mid: roundMoney(mid, currency),
      high: roundMoney(mid * (1 + band), currency),
      weight: 0.22,
      confidence: round2(clamp(0.8 - (band - 0.05), 0.3, 0.85)),
      rationale: `Locality median price per sqm applied to the built-up area; the band widens for thinner samples (${locality.sampleSize} transactions).`,
      evidenceIds: [trendEvId],
    });
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
 * Produces 5-9 drivers. Four are always applicable (tenure, locality
 * liquidity, transit proximity, planning headroom); floor level, building
 * age, encumbrance/energy-label and tenancy-in-place are added only when the
 * underlying data exists. A final reconciling driver absorbs whatever gap
 * between the subject's own mid rate and the locality median the itemised
 * drivers don't explain, so the list is not just decorative — it actually
 * adds up to the anchor blend.
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

  // Transit proximity — a deterministic (per-case) estimate, not a measured
  // survey; biased closer when the locality's own infrastructure note
  // mentions rail/metro/tram access.
  {
    const infra = locality.infrastructureNote.toLowerCase();
    const nearTransit = /metro|rail|station|tram/.test(infra);
    const distanceKm = round2(seededRange(`${caseId}:metro`, nearTransit ? 0.2 : 1.0, nearTransit ? 1.2 : 3.0));
    const pct = clamp((1.5 - distanceKm) * 2, -3, 3);
    const evId = evidence.add({
      statement: `Estimated distance to the nearest rapid-transit stop: ${distanceKm} km (inferred from the locality's infrastructure note, not a measured survey).`,
      sourceType: 'model_inference',
      sourceRef: 'drivers.transitProximity',
      sourceLabel: 'Locality infrastructure note',
      confidence: 0.5,
    });
    push('Transit proximity', pct, 'location', `Estimated ${distanceKm} km from the nearest rapid-transit stop.`, [evId]);
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

  // Cap the itemised set at 8 so a reconciling driver always fits within the 5-9 total.
  const explicit = drivers.slice(0, 8);

  const gapPct = ((baseMidPerSqm - locality.medianPricePerSqm) / locality.medianPricePerSqm) * 100;
  const explainedPct = explicit.reduce((s, d) => s + d.impactPct, 0);
  const residualPct = round1(gapPct - explainedPct);
  const gapEvId = evidence.add({
    statement: `Subject mid rate of ${round1(baseMidPerSqm).toLocaleString()}/sqm vs locality median ${locality.medianPricePerSqm.toLocaleString()}/sqm implies a ${round1(gapPct)}% overall gap.`,
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
function buildRisks(
  caseId: string,
  identity: PropertyIdentity,
  documents: CaseDocument[],
  completeness: CompletenessSummary,
  comparables: Comparable[],
  locality: LocalityReference,
  matchLevel: LocalityMatchLevel,
  planning: { farAllowed: number; farUsed: number },
  askingVsMidPctRaw: number | null,
  now: string,
  previousResult: ScreenResult | undefined,
  evidence: EvidenceBuilder,
): RiskFlag[] {
  const risks: RiskFlag[] = [];

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
    const previous = previousResult?.risks.find(r => r.code === code);
    risks.push({
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
    });
  };

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

  // Occupancy certificates are an India-specific construction-compliance
  // concept (they are not part of the Netherlands country pack at all), so
  // this check only applies to Indian cases — otherwise every older Dutch
  // building would trip a risk that doesn't meaningfully apply to it.
  if (identity.country === 'IN' && identity.yearBuilt !== undefined) {
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

function buildCompleteness(countryPack: CountryPack, documents: CaseDocument[]): CompletenessSummary {
  const items: CompletenessItem[] = countryPack.requiredDocuments.map(rd => {
    const doc = documents.find(d => d.kind === rd.kind);
    return {
      key: rd.kind,
      label: rd.label,
      satisfiedBy: [rd.kind],
      required: rd.required,
      present: Boolean(doc),
      documentId: doc?.id,
      weight: rd.weight,
      note: doc ? undefined : rd.required ? 'Required and not yet on file.' : 'Optional — improves confidence if provided.',
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
): ConfidenceSummary {
  const factors: ConfidenceFactor[] = [];
  const base = 30;
  factors.push({ key: 'base', label: 'Base score', contribution: base, note: 'Starting point before case-specific factors.' });

  const completenessContribution = Math.round((completeness.score / 100) * 25);
  factors.push({ key: 'completeness', label: 'Document completeness', contribution: completenessContribution, note: `${completeness.score}/100 document completeness score.` });

  const compCount = comparables.length;
  const compContribution = clamp(Math.round(compCount * 2.5), 0, 15);
  factors.push({ key: 'comparables', label: 'Comparable count & recency', contribution: compContribution, note: `${compCount} comparable(s) used in the comparable-sales anchor.` });

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
  const keyFacts = [
    { label: 'Property type', value: identity.propertyType.replace(/_/g, ' ') },
    { label: 'Built-up area', value: `${identity.builtUpAreaSqm.toLocaleString()} sqm` },
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
  if (missing.length > 0) {
    throw new Error(`Evidence traceability broken — dangling evidenceIds: ${missing.join(', ')}`);
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
}): ScreenResult {
  const { caseId, identity, documents, refData, now, previousResult } = input;
  const evidence = new EvidenceBuilder(caseId, now);

  const countryPack = refData.countryPacks.find(p => p.country === identity.country);
  if (!countryPack) {
    throw new Error(`No country pack registered for ${identity.country}`);
  }

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

  const { ref: locality, matchLevel } = matchLocalityReference(identity, refData.localities);
  const comparables = buildComparables(identity, refData.comparablePool, refData.localities, locality, now);
  const anchors = buildAnchors(caseId, identity, comparables, locality, matchLevel, countryPack, documentsWithExtraction, now, evidence);

  const baseBlend = blendIndicativeValue(anchors, identity.currency);
  const baseMidPerSqm = baseBlend.mid / identity.builtUpAreaSqm;

  const planning = buildPlanning(identity, locality, now, evidence);
  const completeness = buildCompleteness(countryPack, documentsWithExtraction);

  const askingVsMidPctRaw = identity.askingPrice !== undefined ? ((identity.askingPrice - baseBlend.mid) / baseBlend.mid) * 100 : null;

  const risks = buildRisks(caseId, identity, documentsWithExtraction, completeness, comparables, locality, matchLevel, planning, askingVsMidPctRaw, now, previousResult, evidence);
  const confidence = buildConfidence(completeness, comparables, matchLevel, documentsWithExtraction, anchors, identity.askingPrice !== undefined);

  const widened = widenForConfidence(baseBlend, confidence.band, identity.currency);
  const spreadPct = round1(((widened.high - widened.low) / 2 / widened.mid) * 100);
  const askingVsMidPct = identity.askingPrice !== undefined ? round1(((identity.askingPrice - widened.mid) / widened.mid) * 100) : null;

  const indicativeValue: IndicativeValue = {
    low: widened.low,
    mid: widened.mid,
    high: widened.high,
    currency: identity.currency,
    perSqm: {
      low: roundRate(widened.low / identity.builtUpAreaSqm, identity.currency),
      mid: roundRate(widened.mid / identity.builtUpAreaSqm, identity.currency),
      high: roundRate(widened.high / identity.builtUpAreaSqm, identity.currency),
    },
    spreadPct,
    askingVsMidPct,
  };

  const drivers = buildDrivers(caseId, identity, locality, planning, documentsWithExtraction, baseMidPerSqm, now, evidence);
  const actions = buildActions(caseId, completeness, risks, previousResult);
  const snapshot = buildSnapshot(identity, indicativeValue, confidence, risks, completeness, countryPack);
  const recommendation = buildRecommendation(risks, confidence, completeness, indicativeValue);

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
    recommendation,
  };

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
