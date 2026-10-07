/**
 * Comparables: the evidence a market rate rests on, kept on the file.
 *
 * ## What this is
 *
 * A register of the sales and listings a valuer compares the subject with —
 * each with where it came from (a portal listing and its link, a registered
 * sale and its document, a figure a valuer stands behind), how far away it is,
 * what its area is measured on, and the adjustments that bring it to the
 * subject: time, size, location, condition, and for an asking price the
 * listing discount. The weighted adjusted rate is what the comparable approach
 * runs on.
 *
 * ## Where the listings come from
 *
 * The portal search (the API's `comparables/` module) finds listings on
 * 99acres and MagicBricks near the subject, through a scraping vendor; this
 * file holds everything about them that is not network: turning a project into
 * a search, cleaning and de-duplicating what comes back, ranking it, and
 * saying why a search came back empty. Ported from Valytica, where every rule
 * here was learnt against live portals; the notes say what each one is for.
 *
 * ## The rules
 *
 * **A listing is an asking price.** It is labelled as one everywhere, and the
 * schedule says when no listing discount has been set — most property sells
 * below its asking price, and nothing here guesses by how much.
 *
 * **Found is not accepted.** A search adds what it found as proposed; the
 * valuer accepts or sets aside each one, and accepting the rate they give
 * accepts them. Only coarse location — a locality name and a city — ever
 * leaves for the vendor: never an owner, a survey number or an address line.
 */

import type { DdProject, EvidenceRecord } from './types';
import type { GeoPoint } from '../types';
import { haversineMetres } from '../site';
import { addEvidence, recordAuditEvent } from './operations';
import { decisionRefused } from './review';
import type { MayDecide } from './team';

/* ==================================================================== */
/* Units                                                                 */
/* ==================================================================== */

export type ComparableAreaUnit = 'sqft' | 'sqyd' | 'sqm' | 'acres' | 'cents' | 'guntas' | 'hectares';

const SQM_PER: Record<ComparableAreaUnit, number> = {
  sqft: 0.09290304,
  sqyd: 0.83612736,
  sqm: 1,
  acres: 4046.8564224,
  cents: 40.468564224,
  guntas: 101.17141056,
  hectares: 10000,
};

export function toSqm(value: number, unit: ComparableAreaUnit | null | undefined): number {
  return value * SQM_PER[unit ?? 'sqft'];
}

/** A unit as listings write it, or null. */
export function comparableAreaUnit(hint: string | null | undefined): ComparableAreaUnit | null {
  if (!hint) return null;
  const h = hint.toLowerCase().replace(/[.\s-]/g, '');
  if (h.includes('sqyd') || h.includes('yard') || h.includes('sqyrd') || h === 'gaj') return 'sqyd';
  if (h.includes('sqm') || h.includes('meter') || h.includes('metre')) return 'sqm';
  if (h.includes('acre')) return 'acres';
  if (h.includes('cent')) return 'cents';
  if (h.includes('gunta') || h.includes('guntha')) return 'guntas';
  if (h.includes('hectare') || h === 'ha') return 'hectares';
  if (h.includes('sqft') || h.includes('sqfeet') || h.includes('feet') || h === 'sft') return 'sqft';
  return null;
}

/**
 * An area expression — "2450-2560 sq.ft.", "1200 sqft", "150 sq.yd" — in square
 * metres. A range is its midpoint.
 */
export function parseAreaSqm(raw: string | number | null | undefined, unitHint?: string | null): number | null {
  if (raw == null) return null;
  let unit = comparableAreaUnit(unitHint);
  let value: number | null;
  if (typeof raw === 'number') {
    value = Number.isFinite(raw) && raw > 0 ? raw : null;
  } else {
    const text = raw.toLowerCase();
    const nums = (text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
    value = nums.length >= 2 ? (nums[0]! + nums[1]!) / 2 : (nums[0] ?? null);
    unit = comparableAreaUnit(text.replace(/[\d.,\s-]+/g, ' ').trim()) ?? unit;
  }
  if (value === null) return null;
  return toSqm(value, unit ?? 'sqft');
}

const CRORE = 10_000_000;
const LAKH = 100_000;

/**
 * An Indian price expression in rupees: "2.6 Cr", "2.6  - 2.72 Cr", "45 L",
 * "45 Lacs", "₹ 1,20,00,000". A range is its midpoint.
 */
export function parseIndianPrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  // Commas are deleted, not split on: "1,20,00,000" is one number.
  const text = raw.toLowerCase().replace(/₹/g, ' ').replace(/,/g, '').trim();
  if (!text) return null;
  const unitMult = (unit: string): number | null => {
    if (/^cr/.test(unit)) return CRORE;
    if (/^(l|lac|lakh)/.test(unit)) return LAKH;
    if (unit === 'k') return 1000;
    return null;
  };
  // In "2.6 - 2.72 cr" the unit sits only on the far end.
  const unitTokens = text.match(/cr|crore|crores|lakhs?|lacs?|l|k/g) ?? [];
  const trailing = unitTokens.length ? unitMult(unitTokens[unitTokens.length - 1]!) : null;
  const rangeParts = text.split(/\s*(?:-|to)\s*/).filter((p) => /\d/.test(p));
  const parts = rangeParts.length >= 2 ? rangeParts.slice(0, 2) : [text];
  const values: number[] = [];
  for (const part of parts) {
    const m = part.match(/([\d.]+)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|k)?/);
    if (!m) continue;
    const n = parseFloat(m[1]!);
    if (!Number.isFinite(n)) continue;
    const explicit = m[2] ? unitMult(m[2]) : null;
    let mult = explicit ?? trailing ?? 1;
    if (explicit == null && trailing == null && n < 100000) mult = LAKH; // a bare "45" is lakhs
    values.push(n * mult);
  }
  if (!values.length) return null;
  const mid = values.reduce((s, v) => s + v, 0) / values.length;
  return mid > 0 ? mid : null;
}

/* ==================================================================== */
/* The register                                                          */
/* ==================================================================== */

export type ComparableSource = '99acres' | 'magicbricks' | 'registered_sale' | 'valuer';

export const COMPARABLE_SOURCE_LABEL: Record<ComparableSource, string> = {
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  registered_sale: 'Registered sale',
  valuer: 'Added by hand',
};

/** Which measure an area quotes. Comparing across them distorts a rate by up to a third. */
export type ComparableAreaBasis = 'carpet' | 'builtup' | 'super_builtup' | 'plot';

export const COMPARABLE_AREA_BASIS_LABEL: Record<ComparableAreaBasis, string> = {
  carpet: 'carpet',
  builtup: 'built-up',
  super_builtup: 'super built-up',
  plot: 'plot',
};

export type ComparableStatus = 'proposed' | 'accepted' | 'rejected';

/** Signed percentages that bring a comparable to the subject. */
export interface ComparableAdjustments {
  time?: number;
  size?: number;
  location?: number;
  condition?: number;
  /** For an asking price: what it would likely transact at. Negative. */
  listing?: number;
}

export const ADJUSTMENT_KEYS: Array<keyof ComparableAdjustments> = ['time', 'size', 'location', 'condition', 'listing'];

export const ADJUSTMENT_LABEL: Record<keyof ComparableAdjustments, string> = {
  time: 'Time',
  size: 'Size',
  location: 'Location',
  condition: 'Condition',
  listing: 'Listing discount',
};

export interface ComparableRecord {
  id: string;
  source: ComparableSource;
  /** A listing is an asking price; a transaction is a registered sale. */
  kind: 'listing' | 'transaction';
  status: ComparableStatus;
  /** The listing itself, which the valuer checks against. Required for a portal listing. */
  sourceUrl?: string;
  /** The document it was read from, for a registered sale or a broker's letter. */
  evidenceId?: string;
  title: string;
  point?: GeoPoint;
  distanceKm?: number;
  price: number;
  areaSqm: number;
  areaBasis?: ComparableAreaBasis;
  /** When it was listed or registered. */
  date?: string;
  adjustments: ComparableAdjustments;
  /** Its share of the weighted rate; floored at 0.1 when used. */
  weight: number;
  /** How well it matched the subject, 0..1, and why — for a found listing. */
  match?: { score: number; distance: number; size: number; type: number; areaBasis: number; recency: number };
  note?: string;
  addedAt: string;
  addedBy: string;
  decidedAt?: string;
  decidedBy?: string;
}

export function comparableRate(c: Pick<ComparableRecord, 'price' | 'areaSqm'>): number | null {
  return c.price > 0 && c.areaSqm > 0 ? c.price / c.areaSqm : null;
}

export function comparableNetAdjustmentPct(c: Pick<ComparableRecord, 'adjustments'>): number {
  return ADJUSTMENT_KEYS.reduce((sum, key) => sum + (c.adjustments[key] ?? 0), 0);
}

export function comparableAdjustedRate(c: Pick<ComparableRecord, 'price' | 'areaSqm' | 'adjustments'>): number | null {
  const rate = comparableRate(c);
  return rate === null ? null : rate * (1 + comparableNetAdjustmentPct(c) / 100);
}

/** The comparables a rate is drawn from now: found or accepted, not set aside. */
export function comparablesInPlay(project: DdProject): ComparableRecord[] {
  return (project.comparables ?? []).filter((c) => c.status !== 'rejected' && comparableRate(c) !== null);
}

export interface ComparableSchedule {
  comparables: ComparableRecord[];
  count: number;
  /** Σ(rate × weight) ÷ Σ weight, before adjustment. */
  rawRate: number;
  /** Σ(adjusted rate × weight) ÷ Σ weight. */
  adjustedRate: number;
  /** adjusted ÷ raw − 1, as a percentage: the net adjustment the approach applies. */
  netAdjustmentPct: number;
  listings: number;
  transactions: number;
  /** Listings with no listing discount set: asking prices standing in for sales. */
  undiscountedListings: number;
  /** Still proposed: found, not yet accepted. */
  proposed: number;
  sources: ComparableSource[];
  /** What the rate rests on, in the check's own vocabulary. */
  basis: string;
  /** Stable while the schedule says the same thing. */
  fingerprint: string;
}

/** Comparables this few are a sample, not a market. */
export const MIN_SCHEDULE = 3;

export function comparableSchedule(project: DdProject): ComparableSchedule | null {
  const rows = comparablesInPlay(project);
  if (!rows.length) return null;
  let w = 0;
  let raw = 0;
  let adjusted = 0;
  for (const c of rows) {
    const weight = Math.max(c.weight || 1, 0.1);
    w += weight;
    raw += comparableRate(c)! * weight;
    adjusted += comparableAdjustedRate(c)! * weight;
  }
  const rawRate = raw / w;
  const adjustedRate = adjusted / w;
  const listings = rows.filter((c) => c.kind === 'listing').length;
  const transactions = rows.length - listings;
  const basis =
    transactions === 0 ? 'portal listings (asking prices)' : listings === 0 ? 'reported transactions' : 'listings and transactions';
  const fingerprint = rows
    .map((c) => `${c.id}:${Math.round(comparableRate(c)!)}:${comparableNetAdjustmentPct(c)}:${Math.max(c.weight || 1, 0.1)}`)
    .sort()
    .join(',');
  return {
    comparables: rows,
    count: rows.length,
    rawRate,
    adjustedRate,
    netAdjustmentPct: (adjustedRate / rawRate - 1) * 100,
    listings,
    transactions,
    undiscountedListings: rows.filter((c) => c.kind === 'listing' && !(c.adjustments.listing && c.adjustments.listing < 0)).length,
    proposed: rows.filter((c) => c.status === 'proposed').length,
    sources: [...new Set(rows.map((c) => c.source))],
    basis,
    fingerprint: shortHash(fingerprint),
  };
}

/** A short, stable hash for ids. Not cryptographic; it only has to change when its input does. */
export function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddComparableInput {
  source?: ComparableSource;
  kind?: 'listing' | 'transaction';
  title: string;
  price: number;
  areaSqm: number;
  areaBasis?: ComparableAreaBasis;
  date?: string;
  sourceUrl?: string;
  evidenceId?: string;
  distanceKm?: number;
  adjustments?: ComparableAdjustments;
  weight?: number;
  note?: string;
}

/** A comparable a person adds by hand. Theirs, so accepted as it lands. */
export function addComparable(project: DdProject, input: AddComparableInput, actor: string): ComparableRecord {
  if (!(input.price > 0)) throw new Error('A comparable needs the price it sold or is listed at.');
  if (!(input.areaSqm > 0)) throw new Error('A comparable needs its area.');
  if (!input.title.trim()) throw new Error('Say what the comparable is — a locality, a building, a survey number.');
  if (input.evidenceId && !project.evidence.some((e) => e.id === input.evidenceId)) throw new Error('That document is not on the register.');
  const at = nowIso();
  // A pasted portal link says where the comparable came from better than the person has to.
  const host = input.sourceUrl?.match(/^https?:\/\/([^/?#:]+)/i)?.[1]?.toLowerCase() ?? '';
  const fromLink: ComparableSource | undefined = /(^|\.)99acres\.com$/.test(host) ? '99acres' : /(^|\.)magicbricks\.com$/.test(host) ? 'magicbricks' : undefined;
  const record: ComparableRecord = {
    id: newId(),
    source: input.source ?? fromLink ?? (input.evidenceId ? 'registered_sale' : 'valuer'),
    kind: input.kind ?? (input.source === '99acres' || input.source === 'magicbricks' ? 'listing' : 'transaction'),
    status: 'accepted',
    title: input.title.trim(),
    price: input.price,
    areaSqm: input.areaSqm,
    ...(input.areaBasis ? { areaBasis: input.areaBasis } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
    adjustments: cleanAdjustments(input.adjustments ?? {}),
    weight: input.weight ?? 1,
    ...(input.note ? { note: input.note } : {}),
    addedAt: at,
    addedBy: actor,
    decidedAt: at,
    decidedBy: actor,
  };
  project.comparables = [...(project.comparables ?? []), record];
  recordAuditEvent(project, { actor, action: 'add_comparable', entityType: 'comparable', entityId: record.id, newValue: `${record.title}: ₹${Math.round(record.price).toLocaleString('en-IN')} for ${Math.round(record.areaSqm)} sqm` });
  return record;
}

/** Adjustments are signed percentages, and none is past ±60%: past that it is a different property. */
function cleanAdjustments(input: ComparableAdjustments): ComparableAdjustments {
  const out: ComparableAdjustments = {};
  for (const key of ADJUSTMENT_KEYS) {
    const v = input[key];
    if (v === undefined || v === null || !Number.isFinite(v) || v === 0) continue;
    if (Math.abs(v) > 60) throw new Error(`${ADJUSTMENT_LABEL[key]} of ${v}% is past ±60% — at that distance it is not a comparable.`);
    out[key] = Math.round(v * 10) / 10;
  }
  return out;
}

export interface ComparablePatch {
  adjustments?: ComparableAdjustments;
  weight?: number;
  note?: string;
}

/** Change a comparable's adjustments or weight. */
export function updateComparable(project: DdProject, id: string, patch: ComparablePatch, actor: string): ComparableRecord {
  const c = (project.comparables ?? []).find((x) => x.id === id);
  if (!c) throw new Error('No comparable by that id.');
  if (patch.adjustments) c.adjustments = cleanAdjustments({ ...c.adjustments, ...patch.adjustments });
  if (patch.weight !== undefined) {
    if (!Number.isFinite(patch.weight) || patch.weight < 0 || patch.weight > 10) throw new Error('A weight is between 0 and 10.');
    c.weight = patch.weight;
  }
  if (patch.note !== undefined) c.note = patch.note.trim() || undefined;
  recordAuditEvent(project, { actor, action: 'update_comparable', entityType: 'comparable', entityId: c.id, newValue: JSON.stringify({ adjustments: c.adjustments, weight: c.weight }) });
  return c;
}

/**
 * Accept or set aside comparables, by id.
 *
 * Which comparables count sets the rate the schedule gives the valuation, so
 * deciding one is Finance's: with `mayDecide`, a lead's or a signer's there,
 * and anybody else is refused before anything changes.
 */
export function decideComparables(project: DdProject, ids: readonly string[], decision: 'accept' | 'reject', actor: string, options: { mayDecide?: MayDecide } = {}): number {
  if (options.mayDecide && !options.mayDecide('finance')) throw decisionRefused('Deciding a comparable', 'finance', options.mayDecide);
  const at = nowIso();
  let n = 0;
  for (const c of project.comparables ?? []) {
    if (!ids.includes(c.id)) continue;
    const next: ComparableStatus = decision === 'accept' ? 'accepted' : 'rejected';
    if (c.status === next) continue;
    c.status = next;
    c.decidedAt = at;
    c.decidedBy = actor;
    n += 1;
  }
  if (n) recordAuditEvent(project, { actor, action: decision === 'accept' ? 'accept_comparables' : 'set_aside_comparables', entityType: 'comparable', entityId: project.id, newValue: ids.join(', ') });
  return n;
}

/* ==================================================================== */
/* The schedule, on the register                                         */
/* ==================================================================== */

/** The code a filed schedule carries, so the same schedule is filed once. */
export function comparableScheduleCode(schedule: ComparableSchedule): string {
  return `comparables:${schedule.fingerprint}`;
}

function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * File the comparable schedule on the evidence register, so the rate drawn
 * from it can cite it — and accept the comparables it is drawn from.
 *
 * One row per distinct schedule: filing the same comparables with the same
 * adjustments twice returns the row already filed, and a changed schedule
 * supersedes the one before it.
 */
export function fileComparableSchedule(project: DdProject, actor: string): EvidenceRecord {
  const schedule = comparableSchedule(project);
  if (!schedule) throw new Error('There are no comparables to file.');
  const code = comparableScheduleCode(schedule);
  const proposed = schedule.comparables.filter((c) => c.status === 'proposed').map((c) => c.id);
  if (proposed.length) decideComparables(project, proposed, 'accept', actor);
  const existing = project.evidence.find((e) => e.screenCode === code);
  if (existing) return existing;
  for (const old of project.evidence) {
    if (old.screenCode?.startsWith('comparables:') && old.status !== 'superseded') old.status = 'superseded';
  }
  const at = nowIso();
  const lines = [
    `Comparable schedule of ${schedule.count}: weighted rate ${rupees(schedule.rawRate)}/sqm before adjustment, ${rupees(schedule.adjustedRate)}/sqm after (${schedule.netAdjustmentPct >= 0 ? '+' : ''}${schedule.netAdjustmentPct.toFixed(1)}%).`,
    ...schedule.comparables.map((c, i) => {
      const adj = ADJUSTMENT_KEYS.filter((k) => c.adjustments[k]).map((k) => `${ADJUSTMENT_LABEL[k].toLowerCase()} ${c.adjustments[k]! > 0 ? '+' : ''}${c.adjustments[k]}%`);
      return [
        `${i + 1}. ${COMPARABLE_SOURCE_LABEL[c.source]} — ${c.title}`,
        `${Math.round(c.areaSqm).toLocaleString('en-IN')} sqm${c.areaBasis ? ` (${COMPARABLE_AREA_BASIS_LABEL[c.areaBasis]})` : ''}`,
        `${rupees(c.price)} ${c.kind === 'listing' ? 'asking' : 'paid'}`,
        `${rupees(comparableRate(c)!)}/sqm`,
        c.date ? `${c.kind === 'listing' ? 'listed' : 'registered'} ${c.date}` : '',
        c.distanceKm !== undefined ? `${c.distanceKm.toFixed(1)} km` : '',
        adj.length ? `adjusted ${adj.join(', ')} to ${rupees(comparableAdjustedRate(c)!)}/sqm` : 'no adjustment',
        `weight ${Math.max(c.weight || 1, 0.1)}`,
        c.sourceUrl ?? '',
      ]
        .filter(Boolean)
        .join('; ');
    }),
    schedule.listings
      ? 'Listings are asking prices taken by machine from public portal pages on the dates shown. They are not transactions: each should be checked against its link before the schedule is relied on.'
      : '',
  ].filter(Boolean);
  return addEvidence(
    project,
    {
      title: `Comparable schedule, ${schedule.count} comparable${schedule.count === 1 ? '' : 's'}, ${at.slice(0, 10)}`,
      kind: 'document',
      description: lines.join('\n'),
      source: 'comparables',
      status: 'received',
      screenCode: code,
    },
    actor,
  );
}

/* ==================================================================== */
/* Searching: what the subject is                                        */
/* ==================================================================== */

export type ComparableSubclass =
  | 'residential_flat'
  | 'independent_house'
  | 'residential_plot'
  | 'commercial_plot'
  | 'commercial_building'
  | 'agricultural';

/**
 * The subject as a portal search sees it. Coarse on purpose: a point to rank
 * distance from (never sent to the vendor), locality and city names to search
 * by, and a size. No owner, no survey number, no address line.
 */
export interface ComparableQuery {
  subclass: ComparableSubclass;
  point: GeoPoint | null;
  city: string | null;
  /** Locality names to try, broadest-plausible first. */
  localityCandidates: string[];
  /** City names a portal might file them under. */
  cityCandidates: string[];
  bhk: number | null;
  targetAreaSqm: number | null;
  targetAreaBasis: ComparableAreaBasis | null;
  /** Portal-canonical pairs from the resolution step, which lead the ladder. */
  resolvedPairs?: Array<{ locality: string; city: string }>;
  radiusKm: number;
}

const LAND: ReadonlySet<ComparableSubclass> = new Set(['residential_plot', 'commercial_plot', 'agricultural']);

/** Land trades over a wider area than flats do, and farmland wider still. */
function radiusKmFor(subclass: ComparableSubclass): number {
  if (subclass === 'agricultural') return 10;
  return LAND.has(subclass) ? 3 : 4;
}

/* Portals index localities inside a city, and file a village under the metro nearby. */
const PORTAL_CITIES: ReadonlyArray<{ name: string; lat: number; lng: number }> = [
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Gurgaon', lat: 28.4595, lng: 77.0266 },
  { name: 'Noida', lat: 28.5355, lng: 77.391 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { name: 'Mysore', lat: 12.2958, lng: 76.6394 },
  { name: 'Mangalore', lat: 12.9141, lng: 74.856 },
  { name: 'Hubli', lat: 15.3647, lng: 75.124 },
  { name: 'Visakhapatnam', lat: 17.6868, lng: 83.2185 },
  { name: 'Vijayawada', lat: 16.5062, lng: 80.648 },
  { name: 'Tirupati', lat: 13.6288, lng: 79.4192 },
  { name: 'Warangal', lat: 17.9689, lng: 79.5941 },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { name: 'Lucknow', lat: 26.8467, lng: 80.9462 },
  { name: 'Nagpur', lat: 21.1458, lng: 79.0882 },
  { name: 'Indore', lat: 22.7196, lng: 75.8577 },
  { name: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { name: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
  { name: 'Goa', lat: 15.2993, lng: 74.124 },
];

/* Renamed cities the portals still file under their older names. */
const PORTAL_CITY_ALIAS: Record<string, string> = {
  bengaluru: 'Bangalore',
  'new delhi': 'Delhi',
  gurugram: 'Gurgaon',
  mysuru: 'Mysore',
  mangaluru: 'Mangalore',
  hubballi: 'Hubli',
  vizag: 'Visakhapatnam',
  cochin: 'Kochi',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  madras: 'Chennai',
};

const PORTAL_CITY_NAMES: ReadonlySet<string> = new Set([...PORTAL_CITIES.map((c) => c.name.toLowerCase()), ...Object.keys(PORTAL_CITY_ALIAS)]);

/** A metro's own name in any spelling. Never a locality inside a city. */
export function isPortalCityName(name: string): boolean {
  return PORTAL_CITY_NAMES.has(name.trim().toLowerCase());
}

/** The spelling the portals file a city under: "Bengaluru" is "Bangalore". */
export function canonicalPortalCityName(name: string): string {
  const key = name.trim().toLowerCase();
  return PORTAL_CITY_ALIAS[key] ?? PORTAL_CITIES.find((c) => c.name.toLowerCase() === key)?.name ?? name.trim();
}

/** The portal metro within 100 km of a point, nearest first, or null. */
export function nearestPortalCity(point: GeoPoint | null): string | null {
  if (!point) return null;
  let best: { name: string; km: number } | null = null;
  for (const c of PORTAL_CITIES) {
    const km = haversineMetres(point, c) / 1000;
    if (!best || km < best.km) best = { name: c.name, km };
  }
  return best && best.km <= 100 ? best.name : null;
}

/* A deed writes "Kanakamamidi Village, Moinabad Mandal"; portals index the names alone. */
const ADMIN_SUFFIX = /\s*[,(]?\s*\b(village|gram\s*panchayat|panchayat|mandal|taluk|taluka|tehsil|tahsil|hobli|post|p\.?o\.?|sub[-\s]?district|layout|extension)\b\s*\)?\.?$/i;
const TRAILING_CONJUNCTION = /[\s,]+(and|&|cum)[\s,]*$/i;
const DISTRICT_SUFFIX = /\b(district|dist|distt|zilla|jilla)\b\.?$/i;
const STATES = /^(india|telangana|andhra pradesh|karnataka|tamil nadu|maharashtra|kerala|goa|odisha|gujarat|rajasthan|punjab|haryana|delhi|west bengal|bihar|assam|uttar pradesh|madhya pradesh)$/i;

function stripAdminSuffix(segment: string): string {
  let out = segment.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(ADMIN_SUFFIX, '').replace(TRAILING_CONJUNCTION, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * A segment is a usable locality only if it is a name. Anything with a digit
 * is a plot, road, floor or PIN — which identifies the property, and never
 * leaves for the vendor.
 */
function usableSegment(segment: string): boolean {
  const s = segment.trim();
  return s.length >= 3 && s.length <= 60 && !/\d/.test(s) && !STATES.test(s) && !DISTRICT_SUFFIX.test(s);
}

/** Where the subject is, from the best point the file holds. */
export function subjectPoint(project: DdProject): GeoPoint | null {
  return project.siteCoordinate ?? project.siteContext?.location?.point ?? project.revenueMap?.centre ?? null;
}

function subclassOf(project: DdProject, building: boolean): ComparableSubclass {
  const commercial = project.type === 'commercial' || project.type === 'industrial' || project.type === 'logistics' || project.type === 'mixed_use';
  if (!building) return commercial ? 'commercial_plot' : 'residential_plot';
  if (commercial) return 'commercial_building';
  return /\b(villa|house|bungalow|row\s*house)\b/i.test(`${project.subtype ?? ''} ${project.name}`) ? 'independent_house' : 'residential_flat';
}

export type BuildComparableQuery = { ok: true; query: ComparableQuery } | { ok: false; reason: string };

/**
 * The search a project supports, or why it supports none.
 *
 * `building` decides land against built: a sanctioned plan on a site bought to
 * develop is not a building, and a plot is compared with plots.
 */
export function buildComparableQuery(project: DdProject, building: boolean): BuildComparableQuery {
  const point = subjectPoint(project);
  if (!point) {
    return { ok: false, reason: 'The site has no map location yet. Pin it on the Overview or read the revenue map, so listings can be ranked by distance.' };
  }
  const subclass = subclassOf(project, building);
  const city = project.city?.trim() || null;
  const segments = [project.location, project.siteAddress, project.revenueMap?.village]
    .filter((s): s is string => !!s)
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(usableSegment);
  const localities: string[] = [];
  const seen = new Set<string>();
  for (const raw of segments) {
    const name = stripAdminSuffix(raw.replace(/\s*\([^)]*\)\s*$/, ''));
    const key = name.toLowerCase();
    if (name.length < 3 || seen.has(key) || isPortalCityName(name) || (city && key === city.toLowerCase())) continue;
    seen.add(key);
    localities.push(name);
  }
  if (!localities.length) {
    return { ok: false, reason: 'The address names no locality the portals could search — add the locality to the project’s location.' };
  }
  const cities: string[] = [];
  const pushCity = (name: string | null | undefined) => {
    const v = name?.trim();
    if (!v || v.length < 3) return;
    const canonical = canonicalPortalCityName(v);
    if (!cities.some((c) => c.toLowerCase() === canonical.toLowerCase())) cities.push(canonical);
  };
  pushCity(city);
  const district = project.revenueMap?.district?.replace(/\s*\((?:urban|rural)\)\s*/i, ' ').replace(DISTRICT_SUFFIX, '').trim();
  pushCity(district && !isPortalCityName(district) ? district : null);
  pushCity(nearestPortalCity(point));
  const land = LAND.has(subclass);
  const targetAreaSqm = land ? (project.landAreaSqm ?? null) : (project.saleableAreaSqm ?? project.builtUpAreaSqm ?? null);
  return {
    ok: true,
    query: {
      subclass,
      point,
      city,
      localityCandidates: localities.slice(0, 2),
      cityCandidates: cities.slice(0, 4),
      bhk: null,
      targetAreaSqm: targetAreaSqm && targetAreaSqm > 0 ? targetAreaSqm : null,
      targetAreaBasis: land ? 'plot' : project.saleableAreaSqm ? 'super_builtup' : 'builtup',
      radiusKm: radiusKmFor(subclass),
    },
  };
}

/* ==================================================================== */
/* Searching: what came back                                             */
/* ==================================================================== */

/** One listing as a portal adapter maps it, already in square metres. */
export interface RawListing {
  source: '99acres' | 'magicbricks';
  sourceUrl: string;
  title: string;
  point: GeoPoint | null;
  price: number | null;
  areaSqm: number | null;
  areaBasis: ComparableAreaBasis | null;
  bhk: number | null;
  subtype: string | null;
  listedOn: string | null;
  /** A builder's marketing card, not a listing. Dropped, and counted. */
  isProjectAd: boolean;
}

export interface Candidate extends RawListing {
  ratePerSqm: number | null;
}

export interface NormaliseResult {
  kept: Candidate[];
  projectAdsDropped: number;
  unusableDropped: number;
  duplicatesDropped: number;
  rateOutliersDropped: number;
}

/**
 * Listers mistype areas, and a typo does not look like one until it is
 * priced: a plot advertised as "30 sq.yd" prices at fifteen times its
 * neighbours. The bound comes from the pool's own median, because a rupee band
 * that fits Whitefield rejects half of Mandya.
 */
const OUTLIER_FACTOR = 4;
const MIN_POOL_FOR_OUTLIER_TEST = 5;

export function normaliseListings(listings: readonly RawListing[]): NormaliseResult {
  let projectAdsDropped = 0;
  let unusableDropped = 0;
  const usable: Candidate[] = [];
  for (const l of listings) {
    if (l.isProjectAd) {
      projectAdsDropped += 1;
      continue;
    }
    if (l.price == null || l.areaSqm == null || l.price <= 0 || l.areaSqm <= 0) {
      unusableDropped += 1;
      continue;
    }
    usable.push({ ...l, ratePerSqm: l.price / l.areaSqm });
  }
  // The same property listed on both portals: rounded point, area and price.
  const byKey = new Map<string, Candidate>();
  for (const c of usable) {
    const key = c.point ? `${c.point.lat.toFixed(4)},${c.point.lng.toFixed(4)}|${Math.round(c.areaSqm! / 5) * 5}|${Math.round(c.price! / (5 * LAKH))}` : `url:${c.sourceUrl}`;
    const held = byKey.get(key);
    if (!held || completeness(c) > completeness(held)) byKey.set(key, c);
  }
  const deduped = [...byKey.values()];
  const rates = deduped.map((c) => c.ratePerSqm!).sort((a, b) => a - b);
  let kept = deduped;
  let rejected = 0;
  if (rates.length >= MIN_POOL_FOR_OUTLIER_TEST) {
    const mid = Math.floor(rates.length / 2);
    const median = rates.length % 2 === 0 ? (rates[mid - 1]! + rates[mid]!) / 2 : rates[mid]!;
    kept = deduped.filter((c) => c.ratePerSqm! <= median * OUTLIER_FACTOR && c.ratePerSqm! >= median / OUTLIER_FACTOR);
    rejected = deduped.length - kept.length;
  }
  return { kept, projectAdsDropped, unusableDropped, duplicatesDropped: usable.length - deduped.length, rateOutliersDropped: rejected };
}

function completeness(c: Candidate): number {
  return (c.point ? 2 : 0) + (c.bhk != null ? 1 : 0) + (c.listedOn ? 1 : 0) + (c.areaBasis ? 1 : 0);
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  distanceKm: number | null;
  parts: { distance: number; size: number; type: number; areaBasis: number; recency: number; source: number };
  /** Its share of the weighted rate, from its score. */
  suggestedWeight: number;
}

/**
 * The weights, summing to one. Distance dominates — a comparable has to be
 * near — then size and type; the area basis carries real weight because a
 * carpet rate against a super built-up subject reads a third high, which no
 * other figure on the row reveals.
 */
export const MATCH_WEIGHTS = { distance: 0.35, size: 0.22, type: 0.18, areaBasis: 0.15, recency: 0.07, source: 0.03 } as const;

const BASIS_RANK: Record<ComparableAreaBasis, number> = { carpet: 0, builtup: 1, super_builtup: 2, plot: 3 };

function decayKm(subclass: ComparableSubclass): number {
  if (subclass === 'agricultural') return 8;
  return LAND.has(subclass) ? 2.5 : 1.5;
}

export function scoreComparables(query: ComparableQuery, candidates: readonly Candidate[], opts: { nowMs: number; limit?: number }): ScoredCandidate[] {
  const scaleKm = decayKm(query.subclass);
  const subjectLand = LAND.has(query.subclass);
  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const distanceKm = query.point && c.point ? haversineMetres(query.point, c.point) / 1000 : null;
    // A candidate known to be too far cannot rank; one with no pin survives
    // on its other signals, but can never outrank a near, well-matched one.
    if (distanceKm != null && distanceKm > query.radiusKm) continue;
    const distance = distanceKm == null ? 0.5 : Math.exp(-distanceKm / scaleKm);
    const size = query.targetAreaSqm && c.areaSqm ? Math.max(0, 1 - Math.abs(Math.log(c.areaSqm / query.targetAreaSqm))) : 0.5;
    const candLand = /\b(plot|land|site|acre)\b/i.test(c.subtype ?? '') || c.areaBasis === 'plot';
    const type = subjectLand !== candLand ? 0.05 : subjectLand ? 1 : query.bhk == null || c.bhk == null ? 0.6 : [1, 0.55, 0.25][Math.abs(query.bhk - c.bhk)] ?? 0.1;
    const basis =
      query.targetAreaBasis == null || c.areaBasis == null
        ? 0.7
        : query.targetAreaBasis === c.areaBasis
          ? 1
          : query.targetAreaBasis === 'plot' || c.areaBasis === 'plot'
            ? 0.1
            : Math.abs(BASIS_RANK[query.targetAreaBasis] - BASIS_RANK[c.areaBasis]) === 1
              ? 0.7
              : 0.4;
    const listedMs = c.listedOn ? Date.parse(c.listedOn) : NaN;
    const recency = Number.isFinite(listedMs) ? Math.exp(-Math.max(0, (opts.nowMs - listedMs) / 86_400_000) / 130) : 0.5;
    const source = 0.6 - (c.point ? 0 : 0.1);
    const score =
      MATCH_WEIGHTS.distance * distance +
      MATCH_WEIGHTS.size * size +
      MATCH_WEIGHTS.type * type +
      MATCH_WEIGHTS.areaBasis * basis +
      MATCH_WEIGHTS.recency * recency +
      MATCH_WEIGHTS.source * source;
    scored.push({ candidate: c, score, distanceKm, parts: { distance, size, type, areaBasis: basis, recency, source }, suggestedWeight: 0 });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, opts.limit ?? 6);
  const total = top.reduce((s, x) => s + x.score, 0);
  for (const x of top) x.suggestedWeight = total > 0 ? Math.round((x.score / total) * top.length * 100) / 100 : 1;
  return top;
}

/* ==================================================================== */
/* A search, on the file                                                 */
/* ==================================================================== */

export interface ComparableSearchDiagnostics {
  /** Per portal: how many listings, whether it errored, and how many search pages it actually served. */
  bySource: Record<string, { fetched: number; error: boolean; pagesResolved: number }>;
  projectAdsDropped: number;
  duplicatesDropped: number;
  rateOutliersDropped: number;
  candidatesConsidered: number;
  radiusKmUsed: number;
  radiusWidened: boolean;
  /** The closest listing found anywhere, ignoring the radius. */
  nearestKm: number | null;
  resolvedLocalities: string[];
  resolverUnavailable: boolean;
}

export interface ComparableSearchRecord {
  at: string;
  by: string;
  localities: string[];
  cities: string[];
  radiusKm: number;
  subclass: ComparableSubclass;
  found: number;
  diagnostics: ComparableSearchDiagnostics;
  /** Why it came back empty, when it did — in words a valuer acts on. */
  empty?: string;
}

/**
 * Why a search came back empty.
 *
 * Every failure looks the same to a valuer — a vendor outage, a portal that
 * has never heard of the village, a quiet market, listings that were all too
 * far away — and each calls for something different. So the cause is read off
 * the diagnostics rather than reported as "no listings", in that order: our
 * fault first, then the portals', then the market's.
 */
export function explainEmptySearch(d: ComparableSearchDiagnostics): string {
  const sources = Object.entries(d.bySource);
  const errored = sources.filter(([, s]) => s.error).map(([name]) => name);
  if (errored.length) return `${errored.join(' and ')} could not be reached through the scraping service just now — try again shortly. This says nothing about the market.`;
  if (d.candidatesConsidered > 0) {
    return `The portals list ${d.candidatesConsidered} propert${d.candidatesConsidered === 1 ? 'y' : 'ies'} here, but none within ${d.radiusKmUsed} km${d.nearestKm != null ? ` — the nearest is ${d.nearestKm.toFixed(1)} km away` : ''}. Add comparables from registered sales, or weigh the far ones yourself.`;
  }
  const reached = sources.filter(([, s]) => s.pagesResolved > 0);
  if (!reached.length) {
    return d.resolverUnavailable
      ? 'The portals could not be asked where this locality is just now, so no search page was found. Try again shortly.'
      : d.resolvedLocalities.length
        ? `The portals know ${d.resolvedLocalities.join('; ')}, but no search page resolved for it. Check the project's locality spelling.`
        : 'Neither portal recognised the locality. The portals may not cover this area — registered sales are the way to comparables here.';
  }
  return `${reached.map(([name]) => name).join(' and ')} searched the locality and list nothing comparable. A quiet market — registered sales at the sub-registrar are the evidence to look for.`;
}

/**
 * Put what a search found on the register, as proposed.
 *
 * A listing already on the register — by its link — is left as it is: one a
 * person set aside stays set aside, one they accepted keeps its adjustments.
 * Proposed listings the new search did not find again are dropped, since they
 * were only ever this search's suggestion.
 */
export function mergeComparableSearch(project: DdProject, scored: readonly ScoredCandidate[], search: ComparableSearchRecord, actor: string): ComparableRecord[] {
  const at = nowIso();
  const held = project.comparables ?? [];
  const found = new Set(scored.map((s) => s.candidate.sourceUrl));
  const kept = held.filter((c) => c.status !== 'proposed' || !c.sourceUrl || found.has(c.sourceUrl));
  const added: ComparableRecord[] = [];
  for (const s of scored) {
    const c = s.candidate;
    if (kept.some((k) => k.sourceUrl === c.sourceUrl)) continue;
    const record: ComparableRecord = {
      id: newId(),
      source: c.source,
      kind: 'listing',
      status: 'proposed',
      sourceUrl: c.sourceUrl,
      title: c.title,
      ...(c.point ? { point: c.point } : {}),
      ...(s.distanceKm != null ? { distanceKm: Math.round(s.distanceKm * 100) / 100 } : {}),
      price: c.price!,
      areaSqm: Math.round(c.areaSqm! * 100) / 100,
      ...(c.areaBasis ? { areaBasis: c.areaBasis } : {}),
      ...(c.listedOn ? { date: c.listedOn } : {}),
      adjustments: {},
      weight: s.suggestedWeight || 1,
      match: { score: Math.round(s.score * 100) / 100, distance: s.parts.distance, size: s.parts.size, type: s.parts.type, areaBasis: s.parts.areaBasis, recency: s.parts.recency },
      addedAt: at,
      addedBy: actor,
    };
    kept.push(record);
    added.push(record);
  }
  project.comparables = kept;
  project.comparableSearch = search;
  recordAuditEvent(project, { actor, action: 'search_comparables', entityType: 'comparable', entityId: project.id, newValue: `${search.found} found on ${Object.keys(search.diagnostics?.bySource ?? {}).join(', ') || 'the portals'}; ${added.length} new` });
  return added;
}

/** A search this recent is not repeated on its own: every one costs vendor credit. */
export const COMPARABLE_SEARCH_FRESH_MS = 7 * 24 * 3600 * 1000;

export function comparableSearchIsFresh(project: DdProject, nowMs = Date.now()): boolean {
  const at = project.comparableSearch?.at;
  return !!at && nowMs - Date.parse(at) < COMPARABLE_SEARCH_FRESH_MS;
}
