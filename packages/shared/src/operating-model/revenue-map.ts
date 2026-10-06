/**
 * The revenue map: what the state's own cadastre and GIS say about the survey
 * number on this file.
 *
 * This is Kshetra's read (`@realytica/site-intel`), held on the project in a
 * shape the shared package can reason about without importing the engine.
 * The engine runs in the API; this file owns the record it leaves behind, the
 * standing that record has, and how the GIS overlay draws it.
 *
 * ## Standing
 *
 * Everything else on the overlay is either `context` (OpenStreetMap, OpenCity
 * — volunteer or civic geometry) or `survey` (an outline a person supplied).
 * A revenue-map read is neither. The parcel ring is the government's own
 * published boundary for that survey number, the water body is the state's
 * water-body layer, the zone is the planning authority's land-use polygon.
 * That is stronger than a blue OSM shape. It is still not evidence: it was
 * machine-read, the register carries its own survey error, and the layer
 * publisher has no SLA. So it gets a standing of its own — `record` — and the
 * rule that nothing here is filed until a person attaches the extract stays
 * exactly where it was.
 *
 * ## What is kept and what is not
 *
 * The features around the parcel are kept, clipped and simplified, because
 * re-reading ten government layers on every overlay open is a thirty-second
 * wait against servers that go down several times an afternoon. The value
 * band is NOT kept. Realytica has its own valuation model with its own rate
 * anchors and externality rules; what it wants from the revenue map is the
 * distances and the guidance rate, not a second opinion on the number.
 *
 * ## A site on several survey numbers
 *
 * A township stands on many survey numbers, and each is its own parcel on the
 * state's map. Every read is kept, one per parcel, in `revenueMaps`. The field
 * that held the one read, `revenueMap`, still holds one: the first. It is kept
 * that way because the code before this is still running against the same
 * store and knows nothing else, and because the first read does not move as
 * more are added — so the boundary drawn from it and the evidence row filed
 * from it stay put while a person works down a list of numbers. The largest
 * parcel would change with every read, and would hand the boundary to one
 * mistaken read of a big plot in the wrong village.
 */

import type { GeoPoint, ParcelBoundary } from '../types';
import { buildBoundary } from '../geometry';
import type { DdProject, EvidenceRecord } from './types';
import { addEvidence } from './operations';
import { SURVEY_LIST_SEPARATOR } from './document-parse';
import type { DocumentFact } from './document-parse';
import { acceptedFacts, factReview, liveFacts, standingFacts, stands, waitingReadings } from './fact-review';

/** Which state's layers were read. */
export type RevenueMapState = 'TS' | 'KA';

export type RevenueMapFeatureKind =
  /** A tank, lake, reservoir or river from the state's water-body layer. */
  | 'state_water'
  /** A nala, stream or canal — the drain whose buffer binds. */
  | 'state_drain'
  /** A recorded flood extent. */
  | 'state_flood'
  /** A road or rail alignment that is planned or being acquired. */
  | 'state_alignment'
  /** A master-plan land-use polygon, labelled by its zone. */
  | 'state_landuse'
  /** A metro station or similar transport node. */
  | 'state_transport'
  /** A parcel on the prohibited (Section 22-A) register. */
  | 'state_prohibited';

export interface RevenueMapFeature {
  id: string;
  kind: RevenueMapFeatureKind;
  /** The engine's layer key, so a hit can name its source layer. */
  layerKey: string;
  name: string | null;
  distanceM: number;
  /** True when the parcel's centre falls inside this feature. */
  contains: boolean;
  ring?: GeoPoint[];
  line?: GeoPoint[];
  point?: GeoPoint;
  /**
   * Only on a read as it is stored after the first: where this feature's
   * shape is kept, in place of the shape itself. `^` and a feature's id is
   * that feature of the first read; anything else is a key into the
   * project's `revenueShapes`. Never on a read handed out by `revenueReads`,
   * which puts the shape back.
   */
  shape?: string;
}

/** The shape of a feature of the state's layers: its outline, its line or its point. */
export interface RevenueShape {
  ring?: GeoPoint[];
  line?: GeoPoint[];
  point?: GeoPoint;
}

/** Whether a factor pushes the value up, down, or only warns. */
export type RevenueMapDirection = 'up' | 'down' | 'neutral';

export interface RevenueMapFactor {
  code: string;
  label: string;
  direction: RevenueMapDirection;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** One sentence, plain language. */
  headline: string;
  /** The rule, order or mechanism behind it. */
  detail: string;
  /** The engine's own impact band, percent of value. Advisory here. */
  impactLowPct: number;
  impactHighPct: number;
  /** Which layer produced this, as the engine keys it, for the audit trail. */
  layerKey: string;
  /** The same, as a person would name it: "Telangana GIS — HMDA water bodies". */
  source: string;
  distanceM: number | null;
}

export interface RevenueMapInsight {
  code: string;
  kind: 'planned' | 'zoning' | 'risk' | 'existing';
  layerKey: string;
  featureId: string | null;
  title: string;
  status: string;
  distanceM: number;
  direction: string | null;
  meaning: string;
  source: string;
}

export interface RevenueMapAnchor {
  /** Rupees per unit as the state publishes it, before any multiple. */
  guidancePerUnit: number;
  unit: 'sqyd' | 'sqft';
  /** The locality or road the rate was matched to. */
  locality: string | null;
  /** The engine's note: which table, captured when, what it assumed. */
  note: string;
}

export interface RevenueMapRead {
  readAt: string;
  state: RevenueMapState;
  /** The engine's parcel reference, replayable. */
  parcelRef: string;
  surveyNo: string;
  village: string | null;
  /** Mandal in Telangana, taluk in Karnataka. */
  mandal: string | null;
  district: string | null;
  /** Which published layer the parcel came from, as the engine labels it. */
  sourceLabel: string;
  /** The parcel's outer ring(s), the first being the one drawn as the boundary. */
  rings: GeoPoint[][];
  centre: GeoPoint;
  /** Surveyed extent from the ring. */
  areaSqm: number;
  /** The extent the register itself records, verbatim, when it does. */
  registerExtent: string | null;
  classification: string | null;
  /** Set when the parcel is on the prohibited register; the category. */
  prohibitedCategory: string | null;
  /** True when the parcel's layer is not joined to the prohibited register at all. */
  prohibitedRegisterUnjoined: boolean;
  features: RevenueMapFeature[];
  factors: RevenueMapFactor[];
  insights: RevenueMapInsight[];
  anchor: RevenueMapAnchor | null;
  /** Layers that were read and found nothing near the parcel. */
  emptyLayers: string[];
  /** Layers that could not be read. Their silence means nothing. */
  unreadLayers: { layer: string; reason: string }[];
  /**
   * The survey numbers a person asked for that this parcel answered, where
   * they are not its own. Karnataka's map holds whole survey numbers, so 41/1
   * and 41/2 are both answered by the parcel for 41, and the total must count
   * it once. Absent on a read nobody asked for under another number.
   */
  askedAs?: string[];
  /**
   * Only on a read as it is stored after the first: which first read the
   * shapes it notes as `^…` are on, as that read's parcel and moment. A shape
   * is taken from the first read only while the first read is still that
   * one. Never on a read handed out by `revenueReads`.
   */
  shapesOn?: string;
}

/**
 * The hobli a parcel lies in, where that is what its read holds in place of a
 * class of land.
 *
 * A read's `classification` is the register's class for the parcel where the
 * state's map gives one. Karnataka's gives none; the engine puts the hobli
 * there, a revenue circle between the taluk and the village. A hobli is a
 * place, and is told as one: never as the land's class.
 */
export function hobliOf(read: Pick<RevenueMapRead, 'classification'>): string | null {
  return /^(.*\S)\s+hobli$/i.exec((read.classification ?? '').trim())?.[1] ?? null;
}

/** The class of land the register records for the parcel, where it records one. Never a hobli. */
export function landClassOf(read: Pick<RevenueMapRead, 'classification'>): string | null {
  return hobliOf(read) ? null : read.classification?.trim() || null;
}

export const REVENUE_MAP_CAVEAT =
  'Read by machine from the state’s published cadastre and GIS. A government record, not a licensed survey and not filed evidence: the register carries its own survey error, and the extract still has to be obtained and attached by a person.';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

/**
 * The engine's check of the area quoted for the site against one parcel's
 * boundary. It is true of a parcel that stands alone. The land area of a site
 * on several survey numbers is all of them, and held against one it reads as
 * a discrepancy on every parcel — so it is left out wherever more than one
 * read is kept, whoever made the reads and whenever: the comparison is made
 * on what the parcels add up to instead.
 */
const QUOTED_AREA_CHECK = 'parcel_extent_mismatch';

function withoutQuotedAreaCheck(read: RevenueMapRead): RevenueMapRead {
  const factors = read.factors ?? [];
  return factors.some((f) => f.code === QUOTED_AREA_CHECK) ? { ...read, factors: factors.filter((f) => f.code !== QUOTED_AREA_CHECK) } : read;
}

/*
 * How several reads are stored.
 *
 * A read of a parcel carries the state's layers round it: the tanks within a
 * kilometre, the streams beside it, each with its whole outline. On a real
 * site that is most of a read's sixty-odd kilobytes — and the parcel next
 * door is read against the same tanks. Seventy parcels each carrying their
 * own copy of one lake is a project record too large to load, on this branch
 * and on the one in production, which read the same store.
 *
 * So the first read is stored whole, in `revenueMap`, exactly as the code
 * that knows only that field expects it. Every read after it is stored in
 * `revenueMaps` with what is its own — its outline, its area, what the
 * register and the engine say of it, how far each feature lies from it — and,
 * in place of each feature's shape, a note of where that shape is kept: on
 * the first read where the first read holds it, otherwise once in
 * `revenueShapes`. The first place in `revenueMaps` stands for the first read
 * without repeating it: which parcel, and when it was read.
 *
 * Nothing is lost by this. `storedReads` puts every shape back, and a read
 * taken out of the store is the read the engine gave. A record stored before
 * this, with every read whole, is read the same way: a shape that is on the
 * feature is simply used.
 */

/** A feature's own shape, where it carries one. */
function shapeOf(f: RevenueMapFeature | undefined): RevenueShape | null {
  if (!f) return null;
  return f.ring ? { ring: f.ring } : f.line ? { line: f.line } : f.point ? { point: f.point } : null;
}

/** How a stored read names the first read its shapes are on: that read's parcel, and the moment it was made. */
function stampOf(first: RevenueMapRead): string {
  return `${first.parcelRef}@${first.readAt}`;
}

/**
 * A read as the engine gave it: each feature with its shape on it, from
 * wherever it is kept. A shape noted as being on the first read is taken
 * from it only where the first read is the one the note was written against.
 * Where it is not — a build that knows the list and not this way of keeping
 * it took the first read off — the feature comes back without a shape, and
 * is not drawn: never with the outline of some other tank.
 */
function withShapes(read: RevenueMapRead, first: RevenueMapRead | undefined, shapes: Readonly<Record<string, RevenueShape>> | undefined): RevenueMapRead {
  // A read is taken as it is found: one that holds no features at all is still a read.
  const features = read.features ?? [];
  if (read.shapesOn === undefined && !features.some((f) => f.shape)) return read;
  const { shapesOn, ...own } = read;
  const onFirst = first && shapesOn === stampOf(first) ? first : undefined;
  return {
    ...own,
    features: features.map((f) => {
      if (!f.shape) return f;
      const { shape, ...rest } = f;
      const kept = shape.startsWith('^') ? shapeOf((onFirst?.features ?? []).find((held) => held.id === shape.slice(1))) : (shapes?.[shape] ?? null);
      return kept ? { ...rest, ...kept } : rest;
    }),
  };
}

/** What stands in `revenueMaps` for the first read: which parcel it is and when it was read, and none of what it found. */
function standsForFirst(first: RevenueMapRead): RevenueMapRead {
  return { ...first, rings: [], features: [], factors: [], insights: [], anchor: null, emptyLayers: [], unreadLayers: [] };
}

/**
 * The reads as they are kept, each as the engine gave it, the one
 * `revenueMap` holds first.
 *
 * `revenueMap` is the field the code before this knew, and that code still
 * runs against the same store: it reads one parcel, replaces it, clears it,
 * and has never heard of the list. So the list is believed only while its
 * first place still stands for the very read `revenueMap` holds — the same
 * parcel, read at the same moment. Once they differ, that code has written
 * since, and what it wrote is all there is: the one read it holds, or none. A
 * list it cleared without seeing, and then read another parcel beside, must
 * not come back as parcels of a site that was cleared.
 *
 * What a parcel was asked for as is a fact about the parcel, not about one
 * read of it, so it is carried over to a read that code made of the same
 * parcel: it does not record it.
 */
function storedReads(project: Pick<DdProject, 'revenueMap' | 'revenueMaps' | 'revenueShapes'>): RevenueMapRead[] {
  const held = project.revenueMap;
  if (!held) return [];
  const list = project.revenueMaps ?? [];
  const was = list.find((r) => r.parcelRef === held.parcelRef);
  // The first read is stored whole. Should a build that stored reads another way ever have left it otherwise, its shapes are put back too.
  const whole = withShapes(held, undefined, project.revenueShapes);
  const first = !whole.askedAs?.length && was?.askedAs?.length ? { ...whole, askedAs: was.askedAs } : whole;
  const head = list[0];
  if (!head || head.parcelRef !== held.parcelRef || head.readAt !== held.readAt) return [first];
  return [first, ...list.slice(1).map((read) => withShapes(read, whole, project.revenueShapes))];
}

/**
 * Every read kept for the project, as it is to be told: the one `revenueMap`
 * holds first, and — where there is more than one — each without the engine's
 * check of the quoted area against that one parcel. The check stays in the
 * store, so it is told again if the site goes back to one parcel.
 */
export function revenueReads(project: Pick<DdProject, 'revenueMap' | 'revenueMaps' | 'revenueShapes'>): RevenueMapRead[] {
  const reads = storedReads(project);
  return reads.length > 1 ? reads.map(withoutQuotedAreaCheck) : reads;
}

/**
 * A survey number as it is kept: without its spaces, and without a zero
 * before the digits of a part. "77/03" is how one clerk writes 77/3, and a
 * list that holds both holds one number.
 */
function tidyNumber(surveyNo: string): string {
  return surveyNo
    .replace(/\s+/g, '')
    .split(/([/-])/)
    .map((part) => part.replace(/^0+(?=\d)/, ''))
    .join('');
}

/** "41/2a", "41 / 2A" and "41/02A" are one survey number. */
function surveyKey(surveyNo: string): string {
  return tidyNumber(surveyNo).toUpperCase();
}

/**
 * Survey numbers in the order a register lists them: each part by its
 * number, then by its letters, so 77/3, 77/4, 77/5 and 77/10 sit together
 * and in that order, and 77 comes before any part of it.
 */
export function bySurveyNumber(a: string, b: string): number {
  const parts = (surveyNo: string) =>
    surveyKey(surveyNo)
      .split(/[/-]/)
      .map((part) => {
        const [, digits, letters] = /^(\d*)(.*)$/.exec(part) ?? [];
        return { n: digits ? Number(digits) : Infinity, letters: letters ?? '' };
      });
  const x = parts(a);
  const y = parts(b);
  for (let at = 0; at < Math.max(x.length, y.length); at += 1) {
    const p = x[at];
    const q = y[at];
    if (!p || !q) return p ? 1 : -1;
    if (p.n !== q.n) return p.n < q.n ? -1 : 1;
    if (p.letters !== q.letters) return p.letters < q.letters ? -1 : 1;
  }
  return 0;
}

/** The kept read that answers a survey number: by the parcel's own number, or by one it was asked for as. */
export function revenueReadFor(reads: readonly RevenueMapRead[], surveyNo: string): RevenueMapRead | undefined {
  const key = surveyKey(surveyNo);
  return reads.find((r) => surveyKey(r.surveyNo) === key || (r.askedAs ?? []).some((a) => surveyKey(a) === key));
}

/**
 * Store these reads, each given whole: the first where the old field holds
 * it, and — only once there is more than one — the rest in the list, each
 * shape kept once. See "How several reads are stored" above.
 */
function keepReads(project: DdProject, reads: RevenueMapRead[]): void {
  const first = reads[0];
  project.revenueMap = first;
  if (reads.length < 2) {
    project.revenueMaps = undefined;
    project.revenueShapes = undefined;
    return;
  }
  // A shape is the same shape when its points are the same points: the state's layer hands each parcel the same outline of a tank.
  const written = (shape: RevenueShape) => JSON.stringify(shape);
  const onFirst = new Map<string, string>();
  for (const f of first.features ?? []) {
    const shape = shapeOf(f);
    if (shape && !onFirst.has(written(shape))) onFirst.set(written(shape), `^${f.id}`);
  }
  const once = new Map<string, string>();
  const shapes: Record<string, RevenueShape> = {};
  const rest = reads.slice(1).map((read) => ({
    ...read,
    shapesOn: stampOf(first),
    features: (read.features ?? []).map((f) => {
      const shape = shapeOf(f);
      if (!shape) return f;
      const key = written(shape);
      let at = onFirst.get(key) ?? once.get(key);
      if (!at) {
        at = `s${once.size}`;
        once.set(key, at);
        shapes[at] = shape;
      }
      const { ring: _ring, line: _line, point: _point, ...own } = f;
      return { ...own, shape: at };
    }),
  }));
  project.revenueMaps = [standsForFirst(first), ...rest];
  project.revenueShapes = once.size ? shapes : undefined;
}

/** What a parcel was asked for as, with one more number when it is not the parcel's own. */
function askedOf(earlier: RevenueMapRead | undefined, surveyNo: string, askedAs: string | undefined): string[] {
  const out = [...(earlier?.askedAs ?? [])];
  const asked = askedAs?.replace(/\s+/g, '');
  if (asked && surveyKey(asked) !== surveyKey(surveyNo) && !out.some((a) => surveyKey(a) === surveyKey(asked))) out.push(asked);
  return out;
}

function boundaryOf(read: RevenueMapRead): ParcelBoundary | null {
  const ring = read.rings[0];
  return ring?.length >= 3 ? buildBoundary(ring, 'revenue_map', read.readAt, `${read.sourceLabel}, Sy. ${read.surveyNo}`) : null;
}

/**
 * Keep a revenue-map read on the project.
 *
 * A read of a parcel not yet kept is added after the others. A read of a
 * parcel already kept takes that read's place, where it stood. `askedAs` is
 * the number the person asked for, remembered when the parcel that answered
 * carries a different one.
 *
 * The first read's parcel ring is the project's boundary ONLY when no person
 * has supplied one. A surveyor's upload outranks the register — that is the
 * whole point of `BoundarySource` — and a fresh read must never overwrite it.
 * The boundary stays one ring, the first read's, however many parcels are
 * kept: everything that reads `surveyBoundary` was written for one outline.
 * Returns the boundary when this read set it.
 */
export function applyRevenueMap(project: DdProject, read: RevenueMapRead, actor = 'operator', askedAs?: string): ParcelBoundary | null {
  const reads = storedReads(project);
  const at = reads.findIndex((r) => r.parcelRef === read.parcelRef);
  const asked = askedOf(at >= 0 ? reads[at] : undefined, read.surveyNo, askedAs);
  const kept: RevenueMapRead = asked.length ? { ...read, askedAs: asked } : read;
  if (at >= 0) reads[at] = kept;
  else reads.push(kept);
  keepReads(project, reads);
  project.updatedAt = read.readAt;
  let boundary: ParcelBoundary | null = null;
  const onFile = project.surveyBoundary;
  if (!onFile || (onFile.source === 'revenue_map' && reads[0] === kept)) {
    boundary = boundaryOf(reads[0]);
    if (boundary) project.surveyBoundary = boundary;
  }
  if (!project.audit) project.audit = [];
  project.audit.push({
    id: id('aud'),
    at: read.readAt,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    newValue: `revenueMap ${read.parcelRef}`,
  });
  return boundary;
}

/**
 * A number asked for that a kept parcel already answers is remembered on that
 * parcel: the picker then shows it as read, and the map is not asked again.
 */
export function rememberAskedSurveyNo(project: DdProject, parcelRef: string, askedAs: string): RevenueMapRead | undefined {
  const reads = storedReads(project);
  const at = reads.findIndex((r) => r.parcelRef === parcelRef);
  if (at < 0) return undefined;
  const asked = askedOf(reads[at], reads[at].surveyNo, askedAs);
  if (asked.length !== (reads[at].askedAs ?? []).length) {
    reads[at] = { ...reads[at], askedAs: asked };
    keepReads(project, reads);
    project.updatedAt = nowIso();
  }
  return reads[at];
}

/**
 * Take one parcel's read off the project and keep the rest.
 *
 * When the read that goes was the first, the next becomes the one the old
 * field holds, and a boundary the first had supplied becomes the next one's.
 * Returns false when no read of that parcel is kept.
 */
export function removeRevenueMapRead(project: DdProject, parcelRef: string, actor = 'operator'): boolean {
  const reads = storedReads(project);
  const rest = reads.filter((r) => r.parcelRef !== parcelRef);
  if (rest.length === reads.length) return false;
  if (!rest.length) {
    clearRevenueMap(project, actor);
    return true;
  }
  const led = reads[0].parcelRef === parcelRef;
  keepReads(project, rest);
  if (led && project.surveyBoundary?.source === 'revenue_map') project.surveyBoundary = boundaryOf(rest[0]) ?? undefined;
  const at = nowIso();
  project.updatedAt = at;
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    oldValue: `revenueMap ${parcelRef}`,
  });
  return true;
}

/** Drop every read. A boundary a read supplied goes with them; a person's upload stays. */
export function clearRevenueMap(project: DdProject, actor = 'operator'): void {
  if (!project.revenueMap && !project.revenueMaps?.length) return;
  const at = nowIso();
  project.revenueMap = undefined;
  project.revenueMaps = undefined;
  project.revenueShapes = undefined;
  if (project.surveyBoundary?.source === 'revenue_map') project.surveyBoundary = undefined;
  project.updatedAt = at;
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    oldValue: 'revenueMap',
  });
}

/** The survey number as the engine wants it, from whatever the file recorded. */
export function surveyNoFromParcelId(parcelId: string | undefined | null): string {
  if (!parcelId) return '';
  const m = parcelId.match(/(\d+[\d/A-Za-z-]*)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** One piece of a list of survey numbers: a number, or words that cannot be read as one. */
export interface SurveyPiece {
  /** The number without its spaces or a part's leading zero — or, where the piece is not one number, the piece as it was written. */
  surveyNo: string;
  /** The number as the page or the person spelt it, where that is not how it is kept: "77/03" for 77/3. */
  written?: string;
  /** Why the piece is not read as a survey number. Absent on a number. */
  unreadable?: string;
}

/** A survey number as it is written: digits, a letter or two on them, and parts after a slash or a hyphen. */
const SURVEY_NUMBER = String.raw`\d+[0-9A-Za-z]*(?:\s*[/-]\s*[0-9A-Za-z]+)*`;
/** What may stand before the number in a piece: "Sy.", "Survey No.", "R.S. No:", or nothing. */
const SURVEY_LEAD = String.raw`(?:(?:re-?\s*)?sy\.?|survey|r\.?\s?s\.?|s\.)?\s*(?:no'?s?\.?|numbers?)?\s*[:.]?\s*`;

/**
 * Each piece of a list as a document or a person writes one — "41/2, 41/3
 * and 42", "Sy. Nos. 41/1 & 42" — split at commas, ampersands and the word.
 *
 * A piece is read as a survey number only when it is one. A range ("41 to
 * 45", "41-45"), two numbers with nothing between them ("41/1 41/2", "12;
 * 13") and a number behind other words come back as written, marked as not
 * read: taking the first number out of such a piece reads one parcel where
 * the person meant five, and says nothing about the rest. A piece with no
 * number in it is not a piece. A dash from a lower number to a higher is a
 * range here, though some write a part of a number that way: the line says
 * so, and how to write each.
 */
export function surveyPieces(text: string | undefined | null): SurveyPiece[] {
  const out: SurveyPiece[] = [];
  const add = (piece: SurveyPiece) => {
    if (!out.some((p) => surveyKey(p.surveyNo) === surveyKey(piece.surveyNo))) out.push(piece);
  };
  for (const raw of String(text ?? '').split(SURVEY_LIST_SEPARATOR)) {
    const piece = raw.trim().replace(/\s+/g, ' ');
    const numbers = piece.match(new RegExp(SURVEY_NUMBER, 'g')) ?? [];
    if (!numbers.length) continue;
    const one = new RegExp(`^${SURVEY_LEAD}(${SURVEY_NUMBER})(?![0-9A-Za-z/])`, 'i').exec(piece);
    const dashed = /^(\d+)\s*-\s*(\d+)$/.exec(numbers[0]!);
    if (/\d\s*(?:to|till|upto|up to|through|thru|–|—)\s*\d/i.test(piece)) {
      add({ surveyNo: piece, unreadable: 'A range is not read. Write each number, with commas between.' });
    } else if (dashed && Number(dashed[2]) > Number(dashed[1])) {
      // "5-12" may be meant as the twelfth part of 5. It cannot be told from 5 to 12, so it says how to write either.
      add({
        surveyNo: piece,
        unreadable: `A dash from a lower number to a higher is read as a range, and a range is not read. For a part of a number write ${dashed[1]}/${dashed[2]}; for a run of numbers write each, with commas between.`,
      });
    } else if (numbers.length > 1) {
      add({ surveyNo: piece, unreadable: 'More than one number here. Put a comma between them.' });
    } else if (!one) {
      add({ surveyNo: piece, unreadable: 'Not read as a survey number.' });
    } else {
      const written = one[1]!.replace(/\s+/g, '');
      const surveyNo = tidyNumber(written);
      add({ surveyNo, ...(written === surveyNo ? {} : { written }) });
    }
  }
  return out;
}

/** The survey numbers in such a list, once each, without the pieces that are not one. */
export function splitSurveyNumbers(text: string | undefined | null): string[] {
  return surveyPieces(text).flatMap((p) => (p.unreadable ? [] : [p.surveyNo]));
}

/**
 * The numbers in the project's own parcel identifier. That field is free
 * text and has always been read loosely — the first number in each piece —
 * which is kept: it is a person's own record of the parcel, not a list to
 * be taken literally.
 */
function parcelIdNumbers(parcelId: string | undefined | null): string[] {
  const out: string[] = [];
  for (const piece of String(parcelId ?? '').split(SURVEY_LIST_SEPARATOR)) {
    const found = new RegExp(SURVEY_NUMBER).exec(piece)?.[0];
    const number = found ? tidyNumber(found) : undefined;
    if (number && !out.some((n) => surveyKey(n) === surveyKey(number))) out.push(number);
  }
  return out;
}

/** The facts a document states survey numbers under: the ones it is about, and the ones an approval covers. */
const SURVEY_FACT_KEYS = ['survey_numbers', 'covered_survey_numbers'];

export interface OfferedSurveyNumber {
  /** As written, without spaces. */
  surveyNo: string;
  /** Set when a document's words are not one survey number: a range, or two run together. It is shown and cannot be read. */
  unreadable?: string;
  /** The project's own parcel identifier names it. */
  onProject: boolean;
  /** Each document read as stating it, and where a person stands on that reading. */
  documents: Array<{ evidenceId: string; document: string; page: number; accepted: boolean; byModel: boolean }>;
  /**
   * Recorded on the project, or accepted on a document. A number that is
   * neither was read by machine and still waits for a person.
   */
  accepted: boolean;
  /**
   * Whether anything may rest on it: it is on the project, or a reading that
   * stands states it (`stands`). False for a number only a model's reading
   * states that nobody has accepted, or one two readers differ on. Such a
   * number is offered here to be read and is counted for nothing else:
   * nothing waits for it to be read, and no extent is taken to be for it.
   */
  stands: boolean;
  /**
   * Set when this looks like another number the papers state, read without
   * its stroke — "472" beside 47/2: the number it may be. Only on a reading
   * nobody has accepted. It is offered and said to be doubtful, and like any
   * reading that waits it is not ticked; a person can still have it read.
   */
  maybe?: string;
  /**
   * How the papers spell it where that is not how it is kept: "77/03" for
   * 77/3. A map that spells the part with its zero is asked for it this way
   * when the number as kept is not found.
   */
  written?: string[];
}

/**
 * Every survey number the file states, for the picker to offer, in the order
 * of the numbers.
 *
 * The project's own parcel, and each number a document on the register was
 * read as stating — its own number, the list an approval covers — whether
 * that reading was accepted or still waits. A number two documents state, or
 * one document spells two ways, is offered once, naming each. A reading a
 * person set aside offers nothing, and neither does a document that was
 * replaced or refused. What could not be read as a number comes last.
 *
 * A page read by machine loses a stroke now and then, and 47/2 comes off it
 * as 472. Such a number is marked as a likely misreading only where the file
 * itself says so twice over: the papers state the other number, stroke and
 * all, and state no whole survey number as long as this one. A whole number
 * is what stands before a stroke, or a number written without one that is
 * not itself some other stated number with its stroke taken out: 471 beside
 * 472 says a village has numbers that long, and 472 is then a neighbour, not
 * a misreading. Where either is missing the number is offered as any other,
 * and so is a number a person has accepted or recorded: nothing is guessed
 * at, and nobody's own decision is second-guessed.
 */
export function offeredSurveyNumbers(project: DdProject): OfferedSurveyNumber[] {
  const out: OfferedSurveyNumber[] = [];
  /** Each number the papers write with a stroke, by what it reads as when the stroke is lost. */
  const strokeless = new Map<string, string>();
  const offer = (piece: SurveyPiece): OfferedSurveyNumber => {
    let held = out.find((o) => surveyKey(o.surveyNo) === surveyKey(piece.surveyNo));
    if (!held) {
      held = { surveyNo: piece.surveyNo, ...(piece.unreadable ? { unreadable: piece.unreadable } : {}), onProject: false, documents: [], accepted: false, stands: false };
      out.push(held);
    }
    return held;
  };
  for (const surveyNo of parcelIdNumbers(project.parcelId)) {
    const held = offer({ surveyNo });
    held.onProject = true;
    held.accepted = true;
    held.stands = true;
  }
  for (const row of project.evidence ?? []) {
    if (row.status === 'superseded' || row.status === 'rejected') continue;
    // Every reading that is not set aside: the picker shows what waits, and says of each that it does.
    for (const fact of liveFacts(row)) {
      if (!SURVEY_FACT_KEYS.includes(fact.key)) continue;
      const accepted = factReview(fact) === 'accepted';
      for (const piece of surveyPieces(String(fact.value))) {
        const held = offer(piece);
        if (stands(fact, row)) held.stands = true;
        const said = held.documents.find((d) => d.evidenceId === row.id);
        if (said) said.accepted = said.accepted || accepted;
        else held.documents.push({ evidenceId: row.id, document: row.documentType ?? row.title, page: fact.page, accepted, byModel: fact.source === 'model' });
        if (accepted) held.accepted = true;
        if (piece.unreadable) continue;
        if (piece.written && !held.written?.includes(piece.written)) held.written = [...(held.written ?? []), piece.written];
        for (const spelt of [piece.surveyNo, ...(piece.written ? [piece.written] : [])]) {
          const lost = spelt.replace(/[/-]/g, '').toUpperCase();
          if (lost !== spelt.toUpperCase() && !strokeless.has(lost)) strokeless.set(lost, held.surveyNo);
        }
      }
    }
  }

  const numbers = out.filter((o) => !o.unreadable);
  const hasStroke = (surveyNo: string) => /[/-]/.test(surveyNo);
  const digits = (surveyNo: string) => /^\d*/.exec(surveyNo)?.[0] ?? '';
  const beforeStroke = [...new Set(numbers.filter((o) => hasStroke(o.surveyNo)).map((o) => digits(o.surveyNo.split(/[/-]/)[0] ?? '')))];
  const longestWhole = Math.max(
    0,
    ...beforeStroke.map((base) => base.length),
    ...numbers.filter((o) => !hasStroke(o.surveyNo) && !strokeless.has(o.surveyNo.toUpperCase())).map((o) => digits(o.surveyNo).length),
  );
  for (const o of numbers) {
    // A number a person recorded or accepted is theirs, and is not doubted for them.
    if (o.onProject || o.accepted || hasStroke(o.surveyNo)) continue;
    const other = strokeless.get(o.surveyNo.toUpperCase());
    if (other && digits(o.surveyNo).length > longestWhole) o.maybe = other;
  }
  return [...numbers.sort((a, b) => bySurveyNumber(a.surveyNo, b.surveyNo)), ...out.filter((o) => o.unreadable)];
}

/**
 * The numbers a file states, for whatever waits until each is read. A number
 * that is likely another one misread, and that nobody has accepted, is not
 * one of them: it is on no map, and waiting for it would be waiting for
 * ever. One a person accepted is a number like any other, and is waited for.
 *
 * Nor is a number that does not stand: one only a model's reading states and
 * nobody has accepted, or one two readers differ on. It acts on nothing, so
 * nothing is held back for it either.
 */
export function statedNumbers(offered: readonly OfferedSurveyNumber[]): string[] {
  return offered.filter((o) => o.stands && !o.unreadable && !(o.maybe && !o.accepted)).map((o) => o.surveyNo);
}

export interface SurveyNumberLine {
  surveyNo: string;
  /** Why this line is not a survey number and cannot be read: a range, or two numbers run together. */
  unreadable?: string;
  /** Where the file states it. Absent for a number only a person typed, or only a kept read knows. */
  offered?: OfferedSurveyNumber;
  /** A person typed it into the picker. */
  typed: boolean;
  /** The kept read that answers it. Two numbers can share one: the map may hold them as one parcel. */
  read?: RevenueMapRead;
  /** How the papers, or the person, spelt it where that is not how it is kept: "77/03" for 77/3. */
  written?: string[];
}

/**
 * The picker's lines, each with the read that answers it when one is kept.
 *
 * First what a person typed that the file does not state, as they typed it:
 * it is theirs, and belongs under the field they typed it into. Then every
 * number the file states and every parcel kept, in the order of the numbers,
 * so the parts of one survey number sit together. What could not be read as
 * a number comes last.
 */
export function surveyNumberLines(project: DdProject, typed = ''): SurveyNumberLine[] {
  const reads = revenueReads(project);
  const stated: SurveyNumberLine[] = offeredSurveyNumbers(project).map((offered) => ({
    surveyNo: offered.surveyNo,
    ...(offered.unreadable ? { unreadable: offered.unreadable } : {}),
    offered,
    typed: false,
    ...(offered.unreadable ? {} : { read: revenueReadFor(reads, offered.surveyNo) }),
    ...(offered.written?.length ? { written: [...offered.written] } : {}),
  }));
  const own: SurveyNumberLine[] = [];
  for (const piece of surveyPieces(typed)) {
    const held = stated.find((l) => surveyKey(l.surveyNo) === surveyKey(piece.surveyNo));
    if (held) {
      held.typed = true;
      if (piece.written && !held.written?.includes(piece.written)) held.written = [...(held.written ?? []), piece.written];
    } else if (piece.unreadable) own.push({ surveyNo: piece.surveyNo, unreadable: piece.unreadable, typed: true });
    else own.push({ surveyNo: piece.surveyNo, typed: true, read: revenueReadFor(reads, piece.surveyNo), ...(piece.written ? { written: [piece.written] } : {}) });
  }
  const kept: SurveyNumberLine[] = [];
  for (const read of reads) {
    if (![...own, ...stated].some((l) => l.read === read)) kept.push({ surveyNo: read.surveyNo, typed: false, read });
  }
  const numbers = [...stated.filter((l) => !l.unreadable), ...kept].sort((a, b) => bySurveyNumber(a.surveyNo, b.surveyNo));
  return [...own, ...numbers, ...stated.filter((l) => l.unreadable)];
}

/** A short human label for a layer key, for the hit text. */
export function revenueLayerLabel(layerKey: string): string {
  return layerKey.replace(/^ka_/, '').replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/* The brief: the read as points a person can scan                    */
/* ------------------------------------------------------------------ */

/**
 * One line on the brief. `title` is the thing, `where` is how far and which
 * way, `says` is the one sentence that matters, `why` is the rule or the
 * next step behind it. Never a percentage — see the design note.
 */
export interface RevenueBriefItem {
  code: string;
  title: string;
  /** "40 m south", "inside the plot", or null when distance means nothing. */
  where: string | null;
  /** The distance behind `where`, so the nearest of several parcels can be told. */
  distanceM: number | null;
  says: string;
  why: string | null;
  source: string;
  tone: 'critical' | 'warning' | 'info' | 'good';
  featureId: string | null;
}

export interface RevenueMapBrief {
  parcel: {
    surveyNo: string;
    place: string;
    source: string;
    readOn: string;
    extentSqm: number;
    registerExtent: string | null;
    /** The class of land the register records, where the state's map gives one. */
    classification: string | null;
    /** The hobli the parcel lies in, where the state's map gives that. */
    hobli: string | null;
  };
  /** The prohibited register, in one word a reader can act on. */
  register: { state: 'listed'; category: string } | { state: 'unjoined' } | { state: 'clear' };
  /** What pulls the value down or blocks a use. The engine's drag factors. */
  warnings: RevenueBriefItem[];
  /** Roads, rail, drains and stations that are proposed or under acquisition. */
  planned: RevenueBriefItem[];
  /** What the master plan or land-use survey zones this land as. */
  zoning: RevenueBriefItem[];
  /** Lakes, drains and other features nearby that no factor already covers. */
  nearby: RevenueBriefItem[];
  /** What works in the plot's favour. The engine's uplift factors. */
  positives: RevenueBriefItem[];
  guidance: { perUnit: number; unit: 'sqyd' | 'sqft'; locality: string | null; note: string } | null;
  notChecked: { layer: string; reason: string }[];
  /** Layers that answered and found nothing within reach of the parcel. */
  checkedClear: string[];
}

const MAX_BRIEF_ITEMS_PER_SECTION = 8;

/** "40 m" or "1.2 km", the way a person says it. */
export function metresLabel(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m >= 1_000) return `${(m / 1_000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/**
 * A distance of zero is not a place. The engine reports 0 both for a feature
 * the parcel sits inside and for a factor that has no distance at all (the
 * extent check, a zone), and the sentence beside it already says which. So
 * zero prints nothing, and only a real distance gets a direction.
 */
function whereLabel(distanceM: number | null | undefined, direction: string | null | undefined): string | null {
  if (distanceM === null || distanceM === undefined || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  const d = metresLabel(distanceM);
  return direction ? `${d} ${direction}` : `${d} away`;
}

function factorTone(f: RevenueMapFactor): RevenueBriefItem['tone'] {
  if (f.direction === 'up') return 'good';
  if (f.severity === 'critical') return 'critical';
  if (f.severity === 'high' || f.severity === 'medium') return 'warning';
  return 'info';
}

function factorItem(f: RevenueMapFactor): RevenueBriefItem {
  return {
    code: f.code,
    title: f.label,
    where: whereLabel(f.distanceM, null),
    distanceM: f.distanceM,
    says: f.headline,
    why: f.detail || null,
    source: f.source || revenueLayerLabel(f.layerKey),
    tone: factorTone(f),
    featureId: null,
  };
}

function insightItem(i: RevenueMapInsight): RevenueBriefItem {
  const tone: RevenueBriefItem['tone'] = i.kind === 'risk' ? 'warning' : 'info';
  return {
    code: i.code,
    title: i.title,
    where: whereLabel(i.distanceM, i.direction),
    distanceM: i.distanceM,
    says: i.meaning,
    why: i.status || null,
    source: i.source,
    tone,
    featureId: i.featureId,
  };
}

function rankFactor(f: RevenueMapFactor): number {
  const sev = { critical: 4, high: 3, medium: 2, low: 1 }[f.severity];
  return sev * 2 + (f.direction === 'down' ? 1 : 0);
}

/**
 * The layer family a code belongs to — "water" for `water_body_near` and for
 * `ka_water:0:679`, "zone" for `zone_residential` and for `ka_zone_mix`.
 *
 * Factors and insights come from the same layers but name them differently:
 * a factor's `layerKey` is the ArcGIS path the evidence cites, an insight's is
 * the engine's own key. The code is the one thing both spell the same way.
 */
function family(code: string): string {
  const tokens = code.split(/[_:]/).filter((t) => t && t !== 'ka');
  return tokens[0] ?? code;
}

const PAIR_DISTANCE_M = 5;

function sameDistance(factorM: number | null, insightM: number): boolean {
  if (factorM === null || !Number.isFinite(factorM)) return true;
  if (factorM <= 0 && insightM <= 0) return true;
  return Math.abs(factorM - insightM) <= PAIR_DISTANCE_M;
}

/**
 * One item from a factor and the insight that describes the same feature.
 * The insight names the thing and says which way it lies; the factor says
 * what it means and what to do about it. Neither alone is the whole line.
 */
function mergedItem(f: RevenueMapFactor, i: RevenueMapInsight): RevenueBriefItem {
  return {
    code: f.code,
    title: i.title,
    where: whereLabel(i.distanceM, i.direction),
    distanceM: i.distanceM,
    says: f.headline,
    why: f.detail || i.status || null,
    source: f.source || i.source,
    tone: factorTone(f),
    featureId: i.featureId,
  };
}

/**
 * The read, grouped the way a reader asks about land: what is wrong with it,
 * what is coming near it, what the plan says it is, what else is around it,
 * what is in its favour, what the state says it is worth, and what could not
 * be checked. Every group is a short list; nothing here is a paragraph.
 *
 * The engine reports the same lake twice — once as a factor ("near a water
 * body", with the rule and the advice) and once as an insight ("Anekal Kere,
 * 679 m west"). One line, not two: a factor and an insight from the same
 * layer family at the same distance are merged, the insight lending its name
 * and direction, the factor its meaning and tone. A merged line sits under
 * the planning heading when the insight is a zone or a planned work — those
 * are the things a valuer cannot see from the ground — and otherwise under
 * the factor's own verdict.
 */
export function revenueMapBrief(read: RevenueMapRead): RevenueMapBrief {
  const factors = [...read.factors].sort((a, b) => rankFactor(b) - rankFactor(a));
  const insights = [...read.insights].sort((a, b) => a.distanceM - b.distanceM);

  const paired = new Set<RevenueMapFactor>();
  const warnings: RevenueBriefItem[] = [];
  const positives: RevenueBriefItem[] = [];
  const planned: RevenueBriefItem[] = [];
  const zoning: RevenueBriefItem[] = [];
  const nearby: RevenueBriefItem[] = [];

  for (const i of insights) {
    const fam = family(i.code);
    const match = factors.find((f) => !paired.has(f) && family(f.code) === fam && sameDistance(f.distanceM, i.distanceM));
    const item = match ? mergedItem(match, i) : insightItem(i);
    if (match) paired.add(match);
    if (i.kind === 'planned') planned.push(item);
    else if (i.kind === 'zoning') zoning.push(item);
    else if (match) (match.direction === 'up' ? positives : warnings).push(item);
    else nearby.push(item);
  }
  for (const f of factors) {
    if (paired.has(f)) continue;
    (f.direction === 'up' ? positives : warnings).push(factorItem(f));
  }
  // A factor's rank decides the order within a verdict, merged or not.
  const rankOf = (item: RevenueBriefItem) => {
    const f = read.factors.find((x) => x.code === item.code);
    return f ? rankFactor(f) : 0;
  };
  warnings.sort((a, b) => rankOf(b) - rankOf(a));
  positives.sort((a, b) => rankOf(b) - rankOf(a));

  const register: RevenueMapBrief['register'] = read.prohibitedCategory
    ? { state: 'listed', category: read.prohibitedCategory }
    : read.prohibitedRegisterUnjoined
      ? { state: 'unjoined' }
      : { state: 'clear' };

  return {
    parcel: {
      surveyNo: read.surveyNo,
      place: [read.village, read.mandal, read.district].filter(Boolean).join(', '),
      source: read.sourceLabel,
      readOn: read.readAt.slice(0, 10),
      extentSqm: Math.round(read.areaSqm),
      registerExtent: read.registerExtent,
      classification: landClassOf(read),
      hobli: hobliOf(read),
    },
    register,
    warnings: warnings.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    planned: planned.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    zoning: zoning.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    nearby: nearby.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    positives: positives.slice(0, MAX_BRIEF_ITEMS_PER_SECTION),
    guidance: read.anchor
      ? {
          perUnit: Math.round(read.anchor.guidancePerUnit),
          unit: read.anchor.unit,
          locality: read.anchor.locality,
          note: read.anchor.note,
        }
      : null,
    notChecked: read.unreadLayers.map((u) => ({ layer: revenueLayerLabel(u.layer), reason: u.reason })),
    checkedClear: read.emptyLayers.map(revenueLayerLabel),
  };
}

/* ------------------------------------------------------------------ */
/* Several parcels, read as one site                                  */
/* ------------------------------------------------------------------ */

/** "Sy. 41", "Sy. 41 and 42", "Sy. 41, 42 and 43" — and past `max`, the first of them and how many more. */
export function surveyNumbersLabel(numbers: readonly string[], max = 6): string {
  const shown = numbers.slice(0, max);
  const more = numbers.length - shown.length;
  if (more > 0) return `Sy. ${shown.join(', ')} and ${more} more`;
  return shown.length <= 1 ? `Sy. ${shown[0] ?? ''}` : `Sy. ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/**
 * What each parcel is called where it has to be told from the others: its
 * survey number, and its village once two parcels carry the same number. A
 * site that runs across two villages can hold a Sy. 41 in each, and "Sy. 41,
 * 41 and 42" names neither. Keyed by the parcel's reference, which is the
 * only thing about a parcel that is its alone.
 */
export function parcelLabels(reads: readonly RevenueMapRead[]): Map<string, string> {
  const placeOf = (r: RevenueMapRead) => r.village ?? r.mandal ?? r.district ?? r.parcelRef;
  const labels = new Map<string, string>();
  for (const read of reads) {
    const twins = reads.filter((r) => r.parcelRef !== read.parcelRef && surveyKey(r.surveyNo) === surveyKey(read.surveyNo));
    // Two villages can share a name as well as a number; the taluk tells those apart.
    const place = twins.some((r) => placeOf(r) === placeOf(read)) && read.mandal ? `${placeOf(read)}, ${read.mandal}` : placeOf(read);
    labels.set(read.parcelRef, twins.length ? `${read.surveyNo} (${place})` : read.surveyNo);
  }
  return labels;
}

/**
 * The extents a document states for the land, in the order the valuation
 * takes them: the title, the survey sketch, the khata, the sanctioned plan.
 */
const EXTENT_FACT_KEYS = ['extent_title', 'extent_survey', 'extent_khata', 'sanctioned_extent'];

/** Two statements of an extent this far apart are worth raising against each other. */
export const EXTENT_APART_PCT = 5;

/** How far apart two extents are, as a share of the larger. */
export function extentGapPct(a: number, b: number): number {
  const larger = Math.max(a, b);
  return larger > 0 ? (Math.abs(a - b) / larger) * 100 : 0;
}

/**
 * The one rule for when two extents disagree: the gap is a twentieth of the
 * larger, or more. The map's parcels against a person's outline, against the
 * land area on the project and against the documents, and the lender's check
 * of the papers against each other, all ask this — so that one screen cannot
 * call two figures apart while another calls the same two agreed.
 */
export function extentsApart(a: number, b: number): boolean {
  return extentGapPct(a, b) >= EXTENT_APART_PCT;
}

/** A row that stands for a paper somebody supplied and is still relied on, as the valuation counts one. */
function onFile(row: EvidenceRecord): boolean {
  if (row.status === 'superseded' || row.status === 'rejected' || row.status === 'missing') return false;
  return row.attachments.length > 0 || row.status === 'received' || row.status === 'validated' || row.status === 'used';
}

/**
 * The readings of an extent, or of the survey numbers one is for, that wait
 * on a paper on file: a model's that nobody has accepted, or one two readers
 * differ on. Counted for nothing here. Whatever sets extents against each
 * other or against the map says that they wait.
 */
export function landReadingsWaiting(project: DdProject, keys: readonly string[] = [...EXTENT_FACT_KEYS, ...SURVEY_FACT_KEYS]): Array<{ evidence: EvidenceRecord; fact: DocumentFact }> {
  return (project.evidence ?? []).filter(onFile).flatMap((evidence) => {
    // A value a person accepted stays in force while a newer reading waits beside it: that paper's value is told.
    const told = new Set(acceptedFacts(evidence).map((fact) => fact.key));
    return waitingReadings(evidence)
      .filter((fact) => keys.includes(fact.key) && !told.has(fact.key))
      .map((fact) => ({ evidence, fact }));
  });
}

/** Those readings in a clause: "a reading of the survey number on the sale deed is waiting to be accepted and is not counted". Empty when none wait. */
export function landReadingsWaitingSaid(waiting: ReadonlyArray<{ evidence: EvidenceRecord; fact: DocumentFact }>): string {
  if (!waiting.length) return '';
  const lower = (text: string) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
  const first = waiting[0]!;
  const on = lower(first.evidence.documentType ?? first.evidence.title);
  return waiting.length === 1
    ? `a reading of the ${lower(first.fact.label)} on the ${on} is waiting to be accepted and is not counted`
    : `${waiting.length} readings of an extent or a survey number are waiting to be accepted and are not counted`;
}

/** What one document states the extent of its land to be, and which land it says that is. */
export interface StatedExtent {
  evidenceId: string;
  /** The kind of document, and the page its extent is on. */
  document: string;
  page: number;
  /** Which extent it is: the title's, the survey sketch's, the khata's, the sanctioned plan's. */
  kind: string;
  /** "Sale deed, p. 3". */
  from: string;
  sqm: number;
  /**
   * The survey numbers the same document is read as stating: the ones a
   * person accepted, or, where none of its numbers is accepted yet, the ones
   * the rules read that still wait. Never a model's reading nobody has
   * accepted, nor one two readers differ on. Empty when it states none.
   */
  numbers: string[];
  /** Pieces of what it states that are not one survey number — a range, two run together — as written. */
  unreadable: string[];
  /**
   * It names one number, read off the page by the parser, and the parser
   * keeps one number where a deed lists several. Its land is that parcel at
   * least, and may be more.
   */
  atLeast: boolean;
  /**
   * The only reading of the numbers it names is one that waits: a model's
   * that nobody has accepted, or one two readers differ on. Which land its
   * extent is for is then not told yet. It is not taken to name none, which
   * would make its extent the whole site's, and nothing is set against it
   * until a person decides the reading.
   */
  numbersWaiting: boolean;
}

/**
 * The extent each document on file states, the best kind of document first
 * and of a kind the newest — the order the valuation takes them in — each
 * with the survey numbers that document is read as stating. One extent to a
 * document: its best. `accepted` takes only an extent a person accepted;
 * `standing` takes one the rules read that still waits as well, as the
 * lender's check of the papers always has. Neither takes a model's reading
 * nobody has accepted, nor a value two readers differ on (`standingFacts`):
 * a model's 1,115 beside a deed's 2,450 is not two papers disagreeing.
 *
 * Accepting an extent does not accept the numbers beside it — the valuation
 * accepts the one value it needs — so a document none of whose numbers is
 * accepted is still read as stating the ones that wait. Without them an
 * extent for three survey numbers looks like the extent of the whole site.
 */
function statedExtents(project: DdProject, which: 'accepted' | 'standing'): StatedExtent[] {
  const rows = (project.evidence ?? []).filter(onFile).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out: StatedExtent[] = [];
  for (const key of EXTENT_FACT_KEYS) {
    for (const row of rows) {
      if (out.some((s) => s.evidenceId === row.id)) continue;
      const fact = (which === 'accepted' ? acceptedFacts(row) : standingFacts(row)).find((f) => f.key === key);
      if (!fact) continue;
      const sqm = typeof fact.value === 'number' ? fact.value : Number(String(fact.value).replace(/[,\s]/g, ''));
      if (!Number.isFinite(sqm) || sqm <= 0) continue;
      const accepted = acceptedFacts(row).filter((f) => SURVEY_FACT_KEYS.includes(f.key));
      const stating = accepted.length ? accepted : standingFacts(row).filter((f) => SURVEY_FACT_KEYS.includes(f.key));
      const numbers: string[] = [];
      const unreadable: string[] = [];
      for (const piece of stating.flatMap((f) => surveyPieces(String(f.value)))) {
        const into = piece.unreadable ? unreadable : numbers;
        if (!into.some((n) => surveyKey(n) === surveyKey(piece.surveyNo))) into.push(piece.surveyNo);
      }
      const only = stating.length === 1 ? stating[0] : undefined;
      const document = row.documentType ?? row.title;
      out.push({
        evidenceId: row.id,
        document,
        page: fact.page,
        kind: key,
        from: `${document}, p. ${fact.page}`,
        sqm,
        numbers,
        unreadable,
        numbersWaiting: !stating.length && waitingReadings(row).some((f) => SURVEY_FACT_KEYS.includes(f.key)),
        // A model reads the whole list, and a person who corrected the value wrote what they meant: only the parser's one number is a floor.
        atLeast: Boolean(only && only.key === 'survey_numbers' && only.source !== 'model' && !only.edited && numbers.length === 1 && !unreadable.length),
      });
    }
  }
  return out;
}

/** What the documents on a file state the extent of the land to be, each piece of land counted once. */
export interface StatedLand {
  /** The extents counted: one for each set of survey numbers a document states one for. */
  sources: StatedExtent[];
  /** The extents not counted: about numbers already counted — the same land said again, or land that overlaps it. */
  others: StatedExtent[];
  /**
   * The counted extents added up: the one figure the documents state. Null
   * where they cannot be added — several documents name no survey number and
   * do not agree, so nothing says whether they are one piece of land or more.
   */
  sqm: number | null;
  /** "Sale deed, p. 3", or "3 documents". */
  from: string;
  /**
   * The survey numbers that land is: the ones those documents state it for —
   * or, where the document names none, every number the file states, since
   * an extent with no number to it can only be the whole site's.
   */
  numbers: string[];
  /** The documents themselves name those numbers. False where the extent is taken to be the whole site's. */
  named: boolean;
  /** Why this cannot be set against a map whatever is read, as words that follow what the documents state. */
  unset?: string;
}

const sum = (values: readonly number[]): number => values.reduce((total, n) => total + (n > 0 ? n : 0), 0);

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The land the documents state an extent for, and how much they say it is.
 *
 * One statement for each set of survey numbers, in the valuation's order: a
 * deed for each parcel states each parcel's extent, so the figure is those
 * added up; a deed and a khata for the same number state the same land
 * twice, and the better of the two is counted once.
 *
 * An extent whose document names no number can only be the whole site's, and
 * stands alone. Several such documents are one piece of land said again only
 * where each is a different kind of paper and they agree — a deed, its khata
 * and its sketch — and the best is counted. Two deeds that name no number
 * may be two plots, equal or not, and figures that differ may be two pieces
 * of land: nothing tells a second statement of the site from a deed for
 * another parcel, so none is taken for the site and no figure is given.
 *
 * A document that states a range, or two numbers run together, names land
 * this cannot tell, and nothing is set against it until a person writes the
 * numbers out.
 */
export function statedLand(project: DdProject, which: 'accepted' | 'standing' = 'accepted'): StatedLand | null {
  const stated = statedExtents(project, which);
  if (!stated.length) return null;
  const nameless = (s: StatedExtent) => !s.numbers.length && !s.unreadable.length && !s.numbersWaiting;
  const sources: StatedExtent[] = [];
  const others: StatedExtent[] = [];
  const counted = new Set<string>();
  let wholeSite = false;
  for (const s of stated) {
    if (wholeSite || (nameless(s) && sources.length)) others.push(s);
    else if (nameless(s)) {
      sources.push(s);
      wholeSite = true;
    } else if (s.numbers.some((n) => counted.has(surveyKey(n)))) others.push(s);
    else {
      sources.push(s);
      for (const n of s.numbers) counted.add(surveyKey(n));
    }
  }
  const offered = offeredSurveyNumbers(project).filter((o) => !o.unreadable);
  if (wholeSite) {
    const alike = others.filter(nameless);
    const all = [sources[0], ...alike];
    const oneLand = new Set(all.map((s) => s.kind)).size === all.length && !alike.some((s) => extentsApart(s.sqm, sources[0].sqm));
    if (!oneLand) {
      return {
        sources: all,
        others: others.filter((s) => !nameless(s)),
        sqm: null,
        from: `${all.length} documents`,
        numbers: [],
        named: false,
        unset: 'none of them names a survey number, so they may be the same land or different land: they are neither added up nor set against the map',
      };
    }
    // Every number the file states that stands, accepted or still waiting: a site is not set against the map while one of them is unread.
    // Nor while a number is stated only by a reading that waits: the numbers the site goes by are then not all told.
    const waits = landReadingsWaiting(project, SURVEY_FACT_KEYS);
    return {
      sources,
      others,
      sqm: sources[0].sqm,
      from: sources[0].from,
      numbers: statedNumbers(offered),
      named: false,
      ...(waits.length ? { unset: `${landReadingsWaitingSaid(waits)}, so the numbers this land goes by are not all told and the map is not set against it` } : {}),
    };
  }
  // Told in the order the file states them, whichever document was counted first.
  const stands = (n: string) => {
    const at = offered.findIndex((o) => surveyKey(o.surveyNo) === surveyKey(n));
    return at < 0 ? offered.length : at;
  };
  const cut = sources.find((s) => s.unreadable.length);
  const waits = sources.find((s) => s.numbersWaiting);
  return {
    sources,
    others,
    sqm: sum(sources.map((s) => s.sqm)),
    from: sources.length === 1 ? sources[0].from : `${sources.length} documents`,
    numbers: sources.flatMap((s) => s.numbers).sort((a, b) => stands(a) - stands(b)),
    named: true,
    ...(cut
      ? {
          unset: `${sources.length === 1 ? 'it' : cut.from} names ${listed(cut.unreadable.map((piece) => `“${piece}”`))}, which is not read as survey numbers, so the land it is for cannot be told and the map is not set against it`,
        }
      : waits
        ? {
            unset: `a reading of the survey numbers ${sources.length === 1 ? 'it' : waits.from} names is waiting to be accepted, so the land it is for is not told yet and the map is not set against it`,
          }
        : {}),
  };
}

export interface RevenueExtentParcel {
  parcelRef: string;
  surveyNo: string;
  /** The number as it is told from the others: with its village where two parcels carry the same one. */
  label: string;
  areaSqm: number;
  /** The extent the register itself records, verbatim, when it records one. */
  registerExtent: string | null;
  /**
   * The numbers it was asked for as and holds under its own. The outline is
   * then the whole survey number, not the part that was asked for.
   */
  askedAs: string[];
  /**
   * Set when every number this parcel answers comes off a reading nobody has
   * accepted: how that reading was made. A parcel read from it is still the
   * state's parcel; that it is this site's is a machine's word so far.
   */
  unaccepted: 'model' | 'page' | null;
}

/** What is said of a parcel that is the whole of a survey number asked for by a part of it. */
export function wholeNumberWords(askedAs: readonly string[]): string {
  return `whole survey number, asked for as ${askedAs.join(', ')}`;
}

/** What is said of a number that comes off a reading nobody has accepted, wherever it is shown. */
export function unacceptedWords(how: 'model' | 'page'): string {
  return how === 'model' ? 'read by the model, not yet accepted' : 'read from the page, not yet accepted';
}

export interface RevenueExtentDocuments extends StatedLand {
  /** How many of those numbers a kept parcel answers. */
  read: number;
  /**
   * The documents against the map, made only once every one of those numbers
   * is read: a total of two parcels against a deed for three says nothing.
   * Null as well where `unset` says why it cannot be made.
   */
  compared: {
    /** The land the documents are about, by label: the parcels that answer the numbers they name, or every parcel read where they name none. */
    parcels: string[];
    /** Those parcels' outlines added up. */
    mapSqm: number;
    /** How much more the map shows than the documents state. Negative when it shows less. */
    mapMoreSqm: number;
    apartPct: number;
    /** Worth raising, by `extentAgainstMap`. */
    apart: boolean;
    /** Parcels that are a whole survey number where the documents, or the file, name a part of it, by label. */
    wholeNumbers: string[];
    /**
     * Set against every parcel read, not against the one a document names: the
     * page was read as naming one number, its figure is more than that parcel
     * holds, and it is the figure of all the parcels together.
     */
    everyParcel: boolean;
  } | null;
}

export interface RevenueExtent {
  /** Each parcel's area from its outline, beside what the register records for it. */
  parcels: RevenueExtentParcel[];
  /** The outlines added up. The register's own extents are free text and are never added. */
  totalSqm: number;
  /** What the documents state, set against the parcels it is about. Null when no document on file states an extent. */
  documents: RevenueExtentDocuments | null;
}

/**
 * A figure stated for land against what the map's parcels for it measure.
 *
 * Apart by the one rule — except that a parcel which is the whole of a
 * survey number, where a part of it was named, holds the site's part and
 * more. The land on the map is then anything from the other parcels alone to
 * all of them together, and more land on the map is raised only when the
 * other parcels by themselves are already more than the figure: one whole
 * number accounts for a gap up to its own area and no further. Less land on
 * the map is never accounted for this way.
 */
export function extentAgainstMap(statedSqm: number, mapSqm: number, wholeSqm = 0): { apart: boolean; excused: boolean } {
  if (!extentsApart(statedSqm, mapSqm)) return { apart: false, excused: false };
  if (statedSqm > mapSqm || wholeSqm <= 0) return { apart: true, excused: false };
  const withoutWhole = Math.max(0, mapSqm - wholeSqm);
  const stillMore = withoutWhole > statedSqm && extentsApart(statedSqm, withoutWhole);
  return { apart: stillMore, excused: !stillMore };
}

/** Whether a kept parcel answers a survey number: by its own number, or by one it was asked for as. */
function answers(read: RevenueMapRead, surveyNo: string): boolean {
  return revenueReadFor([read], surveyNo) !== undefined;
}

/** The documents' land against the parcels read. `fileNumbers` is every survey number the file states, accepted or still waiting. */
function againstTheMap(
  land: StatedLand,
  reads: readonly RevenueMapRead[],
  labels: Map<string, string>,
  totalSqm: number,
  fileNumbers: readonly string[],
): RevenueExtentDocuments {
  const labelOf = (r: RevenueMapRead) => labels.get(r.parcelRef) ?? r.surveyNo;
  const answering = land.numbers.map((n) => reads.filter((r) => answers(r, n)));
  const read = answering.filter((found) => found.length).length;
  const base = { ...land, read };
  if (land.unset || land.sqm === null) return { ...base, compared: null };

  // A number two parcels carry — one in each of two villages — is not matched to whichever was read first.
  const twice = land.named ? answering.findIndex((found) => found.length > 1) : -1;
  if (twice >= 0) {
    const found = answering[twice];
    return {
      ...base,
      compared: null,
      unset: `${found.length === 2 ? 'two' : found.length} parcels read carry the number ${land.numbers[twice]}, ${surveyNumbersLabel(found.map(labelOf))}, and the documents do not say which, so the map is not set against it`,
    };
  }
  if (read < land.numbers.length) return { ...base, compared: null };

  // The land the documents are about: the parcels that answer the numbers they name, each once — or, where they name none, every parcel read.
  let about = land.named ? reads.filter((r) => answering.some((found) => found[0] === r)) : [...reads];
  let mapSqm = sum(about.map((r) => r.areaSqm));
  // A page read as naming one number may be a deed for several. Where its figure is more than the parcels it names hold, it
  // may be the site's: nothing is set against it while a number the file states is unread — two parcels of three are not
  // short of a deed for three — and once all are read, where it is the figure of every parcel read, those are its land.
  const short = land.named && land.sources.some((s) => s.atLeast) && land.sqm > mapSqm && extentsApart(land.sqm, mapSqm);
  if (short) {
    const unread = fileNumbers.filter((n) => !reads.some((r) => answers(r, n)));
    if (unread.length) return { ...land, named: false, numbers: [...fileNumbers], read: fileNumbers.length - unread.length, compared: null };
  }
  const everyParcel = short && about.length < reads.length && !extentsApart(land.sqm, totalSqm);
  if (everyParcel) {
    about = [...reads];
    mapSqm = totalSqm;
  }
  const isWhole = (r: RevenueMapRead) =>
    land.numbers.some((n, at) => answering[at][0] === r && surveyKey(n) !== surveyKey(r.surveyNo)) || ((!land.named || everyParcel) && (r.askedAs ?? []).length > 0);
  const whole = about.filter(isWhole);
  return {
    ...base,
    compared: {
      parcels: about.map(labelOf),
      mapSqm,
      mapMoreSqm: mapSqm - land.sqm,
      apartPct: extentGapPct(land.sqm, mapSqm),
      apart: extentAgainstMap(land.sqm, mapSqm, sum(whole.map((r) => r.areaSqm))).apart,
      wholeNumbers: whole.map(labelOf),
      everyParcel,
    },
  };
}

/**
 * The parcels' extents, their total, and the documents beside them.
 *
 * A parcel that answered two numbers — 41/1 and 41/2 on a map that holds only
 * 41 — is one parcel and is counted once.
 *
 * The comparison is like for like or it is not made. What the documents
 * state — see `statedLand` — is set against the parcels that answer the
 * numbers they name and no others, and only once all of those are read. An
 * extent whose document names no number is set against every parcel read,
 * once every number the file states is among them. Where the map holds the
 * whole of a survey number and a part of it was named, more land on the map
 * is what a part of a number looks like, and is said, not raised — up to
 * that parcel's own area.
 *
 * `which` is whose reading of an extent counts: one a person accepted, which
 * is what the map is set against on the screen; or one the rules read that
 * still waits as well, for the lender's check of the papers.
 */
export function revenueExtent(
  project: DdProject,
  reads: readonly RevenueMapRead[] = revenueReads(project),
  which: 'accepted' | 'standing' = 'accepted',
): RevenueExtent | null {
  if (!reads.length) return null;
  const labels = parcelLabels(reads);
  const offered = offeredSurveyNumbers(project).filter((o) => !o.unreadable);
  const parcels: RevenueExtentParcel[] = reads.map((r) => {
    const stated = offered.filter((o) => answers(r, o.surveyNo));
    const waiting = stated.length > 0 && !stated.some((o) => o.accepted);
    return {
      parcelRef: r.parcelRef,
      surveyNo: r.surveyNo,
      label: labels.get(r.parcelRef) ?? r.surveyNo,
      areaSqm: r.areaSqm,
      registerExtent: r.registerExtent,
      askedAs: r.askedAs ?? [],
      unaccepted: !waiting ? null : stated.some((o) => o.documents.some((d) => d.byModel)) ? 'model' : 'page',
    };
  });
  const totalSqm = sum(parcels.map((p) => p.areaSqm));
  const land = totalSqm > 0 ? statedLand(project, which) : null;
  return { parcels, totalSqm, documents: land ? againstTheMap(land, reads, labels, totalSqm, statedNumbers(offered)) : null };
}

/**
 * The documents' extent against the map, as two sentences a person can read:
 * what the documents state, and what the map shows for the same land — or
 * why the map is not set against it. One wording for the brief under the map
 * and for the overlay's hit.
 */
export function extentAgainstDocuments(extent: RevenueExtent): { stated: string; verdict: string; apart: boolean } | null {
  const documents = extent.documents;
  if (!documents) return null;
  const sqm = (n: number) => `${Math.round(n).toLocaleString()} sqm`;
  const { named, numbers, sources, compared } = documents;
  if (documents.sqm === null) {
    return { stated: `${listed(sources.map((s) => sqm(s.sqm)))} (${documents.from})`, verdict: documents.unset ?? '', apart: false };
  }
  // The numbers are said where the documents name them and the comparison is with those parcels, and not where a page read
  // as naming one number is taken for all of them, nor where some of what it names could not be read or waits to be accepted.
  const forNumbers = named && numbers.length && !compared?.everyParcel && !sources.some((s) => s.unreadable.length || s.numbersWaiting) ? ` for ${surveyNumbersLabel(numbers)}` : '';
  const stated = `${sqm(documents.sqm)}${forNumbers} (${documents.from})`;
  if (!compared) {
    if (documents.unset) return { stated, verdict: documents.unset, apart: false };
    const unread =
      numbers.length === 1
        ? `Sy. ${numbers[0]}${named ? '' : ', which the file states,'} is not read`
        : `${documents.read} of the ${numbers.length} numbers${named ? '' : ' the file states'} ${documents.read === 1 ? 'is' : 'are'} read`;
    return { stated, verdict: `${unread}, so the map is not set against it yet`, apart: false };
  }
  const gap = Math.round(Math.abs(compared.mapMoreSqm));
  const more = compared.mapMoreSqm > 0;
  const onMap = compared.everyParcel
    ? `the map shows ${sqm(compared.mapSqm)} for every parcel read`
    : named && compared.mapSqm !== extent.totalSqm
      ? `their parcels on the map measure ${sqm(compared.mapSqm)}`
      : `the map shows ${sqm(compared.mapSqm)}`;
  const lone = sources.filter((s) => s.atLeast).flatMap((s) => s.numbers);
  let after = '';
  if (compared.wholeNumbers.length && !compared.apart) {
    after = `; the map holds the whole of ${surveyNumbersLabel(compared.wholeNumbers)}, ${named ? 'of which the documents state a part' : 'asked for here by a part'}`;
  } else if (compared.wholeNumbers.length && more) {
    after = `; the map holds the whole of ${surveyNumbersLabel(compared.wholeNumbers)}, and the parcels without it still measure more than the documents state`;
  } else if (compared.apart && !more && lone.length) {
    after = `; the page was read as naming ${surveyNumbersLabel(lone)} alone, so if the document is for more survey numbers, read those too`;
  }
  return {
    stated,
    verdict: `${onMap}: ${gap === 0 ? 'the same' : `${gap.toLocaleString()} sqm ${more ? 'more' : 'less'} on the map`}${after}`,
    apart: compared.apart,
  };
}

export interface RevenueGuidance {
  /** The read the published value is taken from: the first that carries one. */
  read: RevenueMapRead;
  anchor: RevenueMapAnchor;
  /** Reads that carry a different published value. Named beside it, never averaged in. */
  differing: RevenueMapRead[];
  /** Parcels with land to them for which the map published no value. The value is not theirs, and that is said. */
  unpriced: RevenueMapRead[];
}

/**
 * One guidance value for the site, and which parcel it is.
 *
 * The state publishes a value by locality and road, so two parcels of one
 * site can carry two. An average of them is a figure the state never
 * published; the first is kept, and the others are named.
 */
export function revenueGuidance(reads: readonly RevenueMapRead[]): RevenueGuidance | null {
  const priced = (r: RevenueMapRead) => Boolean(r.anchor && r.anchor.guidancePerUnit > 0);
  const read = reads.find(priced);
  const anchor = read?.anchor;
  if (!read || !anchor) return null;
  const differing = reads.filter(
    (r) => r.anchor && r.anchor.guidancePerUnit > 0 && (r.anchor.unit !== anchor.unit || Math.round(r.anchor.guidancePerUnit) !== Math.round(anchor.guidancePerUnit)),
  );
  return { read, anchor, differing, unpriced: reads.filter((r) => r.areaSqm > 0 && !priced(r)) };
}

/**
 * What makes a feature in one read the same thing on the ground as a feature
 * in another. Never its id, which the engine numbers afresh in every read by
 * distance from that parcel, and the state's own object id does not come
 * through the engine.
 *
 * An area comes whole from the state's layer, so the same tank is the same
 * shape in every read: its layer, its name and its shape are its key. A line
 * does not. The engine keeps only the length of it near each parcel, and two
 * parcels a plot apart hold the same drain cut at different points — so the
 * shape tells two cuts of one length apart, and a line that has a name is
 * matched across reads another way; see `mergeFeatures`.
 */
function shapeKey(f: RevenueMapFeature): string {
  const points = f.ring ?? f.line ?? (f.point ? [f.point] : []);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return [f.kind, f.layerKey, f.name ?? '', points.length, ...[south, west, north, east].map((n) => n.toFixed(6))].join('|');
}

/** A line's layer and name, where it has a name. */
function nameKey(f: RevenueMapFeature): string | null {
  return f.line && f.name ? [f.kind, f.layerKey, f.name].join('|') : null;
}

/** A line's vertices, each to a tenth of a metre: what two cuts of one length of line have in common. */
function vertexKeys(line: readonly GeoPoint[]): string[] {
  return line.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
}

/** One length of a named line, as the reads so far have met it. */
interface LineLength {
  /** The key it is kept under. */
  key: string;
  /** Every vertex any cut of it holds. */
  vertices: Set<string>;
  /** The reads that hold a cut of it. */
  reads: Set<RevenueMapRead>;
}

export interface SiteRevenueFeature extends RevenueMapFeature {
  /** The parcel it lies nearest to, by label. `distanceM` is the distance from that one. */
  surveyNo: string;
}

/**
 * Each feature once across the reads, and for every feature of every read
 * the key it was kept under.
 *
 * Two cuts of a named line are one length of it only where they share a
 * vertex: the engine cuts the state's line where each parcel's reach ends,
 * and the vertices between are the line's own. A name alone is not enough. A
 * nala passes a site in two lengths, and one read may hold both, or each read
 * one — the north length beside one parcel, the south beside another — and
 * taking them for one line draws one length twice and loses the other, with
 * what is proposed along it. A cut that shares no vertex with a length
 * already met is a length of its own, known by its shape like any line with
 * no name. Of two lengths it could belong to, a cut is the one it shares
 * most with, and two features of one read are never the same length.
 */
function mergeFeatures(reads: readonly RevenueMapRead[]): { features: Map<string, SiteRevenueFeature>; keyOf: Map<RevenueMapFeature, string> } {
  const labels = parcelLabels(reads);
  const features = new Map<string, SiteRevenueFeature>();
  const keyOf = new Map<RevenueMapFeature, string>();
  const ids = new Set<string>();
  const lengths = new Map<string, LineLength[]>();
  for (const read of reads) {
    const label = labels.get(read.parcelRef) ?? read.surveyNo;
    const seen = new Map<string, number>();
    for (const f of read.features) {
      const name = nameKey(f);
      const mine = name && f.line ? vertexKeys(f.line) : [];
      let length: LineLength | undefined;
      let most = 0;
      for (const known of name ? (lengths.get(name) ?? []) : []) {
        if (known.reads.has(read)) continue;
        const shared = mine.reduce((n, vertex) => n + (known.vertices.has(vertex) ? 1 : 0), 0);
        if (shared > most) {
          length = known;
          most = shared;
        }
      }
      let key: string;
      if (length) {
        key = length.key;
        length.reads.add(read);
        for (const vertex of mine) length.vertices.add(vertex);
      } else {
        const base = shapeKey(f);
        // Two features of one read are never one thing, even where the state's layer holds the same shape twice.
        const nth = seen.get(base) ?? 0;
        seen.set(base, nth + 1);
        key = nth ? `${base}#${nth}` : base;
        if (name) lengths.set(name, [...(lengths.get(name) ?? []), { key, vertices: new Set(mine), reads: new Set([read]) }]);
      }
      keyOf.set(f, key);
      const held = features.get(key);
      if (held) {
        if (f.distanceM < held.distanceM) {
          held.distanceM = f.distanceM;
          held.surveyNo = label;
        }
        held.contains = held.contains || f.contains;
        // The longer cut of a line shows more of it.
        if (f.line && held.line && f.line.length > held.line.length) held.line = f.line;
        continue;
      }
      // Two reads reuse the same ids for different things, so an id already taken is told apart.
      let unique = f.id;
      for (let n = 2; ids.has(unique); n += 1) unique = `${f.id}~${n}`;
      ids.add(unique);
      features.set(key, { ...f, id: unique, surveyNo: label });
    }
  }
  return { features, keyOf };
}

/**
 * The state's features round every parcel, each kept once.
 *
 * Neighbouring parcels are read against the same lakes and drains, and a lake
 * drawn once for every read is a darker lake, counted as several. A feature
 * two reads share keeps the distance from the nearer parcel and names it.
 */
export function siteRevenueFeatures(reads: readonly RevenueMapRead[]): SiteRevenueFeature[] {
  return [...mergeFeatures(reads).features.values()];
}

export interface RevenueSiteItem extends RevenueBriefItem {
  /** The parcels it was found for under this heading, by label, in the order read. */
  parcels: string[];
  /** The parcel the line is told for, by reference: the one it bears on hardest. */
  told: string;
}

export interface RevenueSiteBrief {
  parcels: Array<
    RevenueMapBrief['parcel'] & {
      parcelRef: string;
      /** The number as it is told from the others. */
      label: string;
      askedAs: string[];
      register: RevenueMapBrief['register'];
      unaccepted: RevenueExtentParcel['unaccepted'];
    }
  >;
  extent: RevenueExtent;
  warnings: RevenueSiteItem[];
  planned: RevenueSiteItem[];
  zoning: RevenueSiteItem[];
  nearby: RevenueSiteItem[];
  positives: RevenueSiteItem[];
  guidance:
    | (NonNullable<RevenueMapBrief['guidance']> & {
        /** The parcel the value was read for, by label. */
        surveyNo: string;
        /** Parcels that carry a different published value. */
        differing: Array<{ surveyNo: string; perUnit: number; unit: 'sqyd' | 'sqft' }>;
        /** Parcels for which the map published no value, by label. */
        unpriced: string[];
      })
    | null;
  notChecked: Array<{ layer: string; reason: string; parcels: string[] }>;
  /** Layers that answered for every parcel and found nothing. */
  checkedClear: string[];
}

type BriefSection = 'warnings' | 'planned' | 'zoning' | 'nearby' | 'positives';

/** The headings in the order they are read, which is also from the gravest to the lightest. */
const BRIEF_SECTIONS: BriefSection[] = ['warnings', 'planned', 'zoning', 'nearby', 'positives'];

const TONE_WEIGHT: Record<RevenueBriefItem['tone'], number> = { critical: 3, warning: 2, info: 1, good: 0 };

/** Of two parcels' lines about the same thing, the graver is the one told; of two as grave, the nearer. */
function tellsFirst(a: RevenueBriefItem, b: RevenueBriefItem): boolean {
  if (TONE_WEIGHT[a.tone] !== TONE_WEIGHT[b.tone]) return TONE_WEIGHT[a.tone] > TONE_WEIGHT[b.tone];
  return (a.distanceM ?? Infinity) < (b.distanceM ?? Infinity);
}

/**
 * Where a line applies, once there are several parcels: a distance is from
 * the parcel it was measured from, and a line with no distance names the
 * parcels it is about unless it is about all of them.
 */
function whereAmong(where: string | null, from: string, parcels: string[], all: number): string | null {
  if (where) return where.endsWith(' away') ? `${where.slice(0, -' away'.length)} from Sy. ${from}` : `${where} of Sy. ${from}`;
  return parcels.length < all ? surveyNumbersLabel(parcels) : null;
}

/**
 * Every read as one brief: the parcels and their extents, and under the same
 * headings as one read, each finding once.
 *
 * Three parcels beside one tank would otherwise say so three times, and the
 * same tank would stand under three headings: a warning for the plot inside
 * its buffer, a plus for the one across the road, and "nearby" for the third.
 * A feature on the state's layer is one line, under the gravest heading any
 * parcel puts it under, told for the parcel it bears on hardest there. A
 * line with no feature behind it is the same line only where it says the
 * same thing under the same heading: two tanks that happen to share a label
 * are two tanks. One read comes back exactly as `revenueMapBrief` tells it.
 */
export function revenueSiteBrief(project: DdProject, reads: readonly RevenueMapRead[] = revenueReads(project)): RevenueSiteBrief | null {
  const extent = revenueExtent(project, reads);
  if (!extent) return null;
  const labels = parcelLabels(reads);
  const labelOf = (read: RevenueMapRead) => labels.get(read.parcelRef) ?? read.surveyNo;
  const each = reads.map((read) => ({ read, brief: revenueMapBrief(read) }));
  const { features, keyOf } = mergeFeatures(reads);

  interface Told {
    section: BriefSection;
    item: RevenueBriefItem;
    of: RevenueMapRead;
    featureId: string | null;
    parcels: RevenueMapRead[];
  }
  const told = new Map<string, Told>();
  for (const { read, brief } of each) {
    for (const section of BRIEF_SECTIONS) {
      for (const item of brief[section]) {
        const feature = item.featureId ? read.features.find((f) => f.id === item.featureId) : undefined;
        const shape = feature ? keyOf.get(feature) : undefined;
        const key = shape ? `feature|${shape}` : `line|${section}|${item.title}|${item.says}`;
        const held = told.get(key);
        if (!held) {
          told.set(key, { section, item, of: read, featureId: shape ? (features.get(shape)?.id ?? null) : item.featureId, parcels: [read] });
        } else if (BRIEF_SECTIONS.indexOf(section) < BRIEF_SECTIONS.indexOf(held.section)) {
          Object.assign(held, { section, item, of: read, parcels: [read] });
        } else if (section === held.section) {
          if (!held.parcels.includes(read)) held.parcels.push(read);
          if (tellsFirst(item, held.item)) Object.assign(held, { item, of: read });
        }
      }
    }
  }
  const section = (name: BriefSection): RevenueSiteItem[] => {
    // One parcel has no other to be told from: its lines are the ones its own brief holds, untouched.
    if (each.length === 1) return each[0].brief[name].map((item) => ({ ...item, parcels: [labelOf(each[0].read)], told: each[0].read.parcelRef }));
    const lines = [...told.values()]
      .filter((t) => t.section === name)
      .map((t) => {
        const parcels = t.parcels.map(labelOf);
        return { ...t.item, featureId: t.featureId, where: whereAmong(t.item.where, labelOf(t.of), parcels, each.length), parcels, told: t.of.parcelRef };
      });
    // The gravest first where a heading holds verdicts, the nearest first where it holds places.
    if (name === 'warnings' || name === 'positives') lines.sort((a, b) => TONE_WEIGHT[b.tone] - TONE_WEIGHT[a.tone]);
    else lines.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
    return lines.slice(0, MAX_BRIEF_ITEMS_PER_SECTION);
  };

  const notChecked: RevenueSiteBrief['notChecked'] = [];
  for (const { read, brief } of each) {
    for (const unread of brief.notChecked) {
      const held = notChecked.find((n) => n.layer === unread.layer);
      if (held) held.parcels.push(labelOf(read));
      else notChecked.push({ ...unread, parcels: [labelOf(read)] });
    }
  }

  const guidance = revenueGuidance(reads);
  return {
    parcels: each.map(({ read, brief }, at) => ({
      ...brief.parcel,
      parcelRef: read.parcelRef,
      label: labelOf(read),
      askedAs: read.askedAs ?? [],
      register: brief.register,
      unaccepted: extent.parcels[at]?.unaccepted ?? null,
    })),
    extent,
    warnings: section('warnings'),
    planned: section('planned'),
    zoning: section('zoning'),
    nearby: section('nearby'),
    positives: section('positives'),
    guidance: guidance
      ? {
          perUnit: Math.round(guidance.anchor.guidancePerUnit),
          unit: guidance.anchor.unit,
          locality: guidance.anchor.locality,
          note: guidance.anchor.note,
          surveyNo: labelOf(guidance.read),
          differing: guidance.differing.map((r) => ({ surveyNo: labelOf(r), perUnit: Math.round(r.anchor?.guidancePerUnit ?? 0), unit: r.anchor?.unit ?? guidance.anchor.unit })),
          unpriced: guidance.unpriced.map(labelOf),
        }
      : null,
    notChecked,
    checkedClear: each[0].brief.checkedClear.filter((layer) => each.every((e) => e.brief.checkedClear.includes(layer))),
  };
}

/** The code a filed revenue-map read carries, so the same read is filed once. */
export function revenueMapEvidenceCode(read: RevenueMapRead): string {
  return `revenue-map:${read.parcelRef}:${read.readAt}`;
}

/**
 * File the revenue-map read on the evidence register, when a person decides to.
 *
 * A read is a record until then: a machine reading of the state's published
 * cadastre and GIS layers. Filing it makes it citable, and the row says what
 * it is in its own title and description, so nobody later mistakes it for a
 * certified extract or a licensed survey. Filing the same read twice returns
 * the row already filed. One read is one row: the first, unless another is
 * named — a guidance value is cited to the read of the parcel it came from.
 * The row says what the screen says: on a site of several parcels the first
 * is filed as it is told there, without the quoted area held against it.
 */
export function fileRevenueMapAsEvidence(project: DdProject, actor = 'operator', read: RevenueMapRead | undefined = revenueReads(project)[0]): EvidenceRecord {
  if (!read) throw new Error('No revenue map has been read for this project.');
  const code = revenueMapEvidenceCode(read);
  const existing = project.evidence.find((e) => e.screenCode === code);
  if (existing) return existing;
  const place = [read.village, read.mandal, read.district].filter(Boolean).join(', ');
  const lines = [
    `Machine read of the state's published cadastre and GIS for Sy. ${read.surveyNo}${place ? `, ${place}` : ''}, from ${read.sourceLabel}, on ${read.readAt.slice(0, 10)}.`,
    `Surveyed extent from the parcel outline: ${Math.round(read.areaSqm).toLocaleString('en-IN')} m²${read.registerExtent ? `; the register records ${read.registerExtent}` : ''}.`,
    // A row cited for 41/1 must not pass for the outline of 41/1: the state's map holds the whole number.
    read.askedAs?.length
      ? `The state's map holds the whole survey number. It was asked for as ${read.askedAs.join(', ')}, and the outline and extent here are all of Sy. ${read.surveyNo}, which may be more land than the part asked for.`
      : '',
    landClassOf(read) ? `Classification on the register: ${landClassOf(read)}.` : '',
    hobliOf(read) ? `Hobli: ${hobliOf(read)}.` : '',
    read.prohibitedCategory ? `On the prohibited register: ${read.prohibitedCategory}.` : '',
    ...read.factors.map((f) => `${f.label}: ${f.headline}`),
    read.anchor ? `Guidance value as published: ₹${read.anchor.guidancePerUnit.toLocaleString('en-IN')} per ${read.anchor.unit === 'sqft' ? 'sq ft' : 'sq yd'}${read.anchor.locality ? ` (${read.anchor.locality})` : ''}.` : '',
    read.unreadLayers.length ? `Layers that could not be read: ${read.unreadLayers.map((l) => l.layer).join(', ')}.` : '',
    REVENUE_MAP_CAVEAT,
  ].filter(Boolean);
  return addEvidence(
    project,
    {
      title: `State revenue map read, Sy. ${read.surveyNo}${read.village ? ` ${read.village}` : ''}`,
      kind: 'gis',
      description: lines.join('\n'),
      source: 'revenue_map',
      status: 'received',
      screenCode: code,
    },
    actor,
  );
}
