/**
 * What a model says of a photograph: picks off three lists.
 *
 * A model that looks at a site photograph names what is in it by an
 * element, a condition seen and a location, each off a fixed list, and how
 * sure it is. It writes no description, no note and no reasoning. The words
 * a person reads beside the photograph are made here from the picks, and a
 * pick of a condition that is a defect is proposed as a finding, with its
 * severity and the reason it matters taken from a table. A person accepts
 * the proposal the way any draft is accepted. The only free words about a
 * photograph are a person's own note, capped (`PHOTO_NOTE_MOST`).
 *
 * An observation kept before this (a description, notes and reasoning a
 * model wrote) still reads, and is shown as written by a model before the
 * change: it has no `seen`.
 *
 * Pure.
 */

import type { PhotoObservation, PhotoSubject, PhotoSuggestedFinding } from './photo-observation';
import type { FindingSeverity } from './types';

export const PHOTO_ELEMENTS = [
  'structure_frame', 'slab', 'column', 'beam', 'wall', 'plaster_finish', 'roof', 'waterproofing', 'floor', 'staircase', 'door_window', 'facade',
  'excavation_foundation', 'reinforcement', 'formwork', 'scaffolding', 'electrical', 'plumbing', 'fire_fighting', 'lift',
  'access_road', 'boundary_wall', 'drainage', 'water_body', 'vegetation', 'neighbouring_building', 'signage', 'materials_stored', 'plant_equipment', 'site_general',
] as const;
export type PhotoElement = (typeof PHOTO_ELEMENTS)[number];

export const PHOTO_CONDITIONS = [
  'no_defect_seen', 'work_in_progress', 'work_complete', 'crack', 'damp_or_stain', 'spalling', 'corrosion', 'honeycombing', 'exposed_reinforcement',
  'tilt_or_settlement', 'ponding_water', 'debris', 'unsafe_edge_or_access', 'encroachment', 'damaged', 'missing', 'not_clear',
] as const;
export type PhotoCondition = (typeof PHOTO_CONDITIONS)[number];

export const PHOTO_LOCATIONS = ['basement', 'ground_floor', 'upper_floor', 'roof_terrace', 'external_elevation', 'site_boundary', 'approach', 'plot_interior', 'not_clear'] as const;
export type PhotoLocation = (typeof PHOTO_LOCATIONS)[number];

const said = (key: string): string => key.replace(/_/g, ' ');
const titled = (key: string): string => said(key).replace(/^./, (first) => first.toUpperCase());

export const PHOTO_ELEMENT_LABEL = Object.fromEntries(PHOTO_ELEMENTS.map((key) => [key, titled(key)])) as Record<PhotoElement, string>;
export const PHOTO_CONDITION_LABEL = Object.fromEntries(PHOTO_CONDITIONS.map((key) => [key, said(key)])) as Record<PhotoCondition, string>;
export const PHOTO_LOCATION_LABEL = Object.fromEntries(PHOTO_LOCATIONS.map((key) => [key, said(key)])) as Record<PhotoLocation, string>;

/**
 * The conditions that are a defect: how grave each is taken to be, and why
 * it matters, once, the same for every photograph. A condition not here
 * proposes nothing.
 */
export const PHOTO_DEFECT_TABLE: Partial<Record<PhotoCondition, { severity: FindingSeverity; why: string }>> = {
  crack: { severity: 'medium', why: 'A crack needs its width, depth and cause looked at on site before it is taken as cosmetic.' },
  damp_or_stain: { severity: 'low', why: 'Damp or staining can mean a leak or failed waterproofing behind what is seen.' },
  spalling: { severity: 'high', why: 'Spalling concrete usually means the steel behind it is corroding.' },
  corrosion: { severity: 'medium', why: 'Corrosion reduces the section of the metal it is on and tends to go on.' },
  honeycombing: { severity: 'medium', why: 'Honeycombed concrete is weaker and lets water reach the reinforcement.' },
  exposed_reinforcement: { severity: 'high', why: 'Reinforcement left exposed corrodes and has lost its cover.' },
  tilt_or_settlement: { severity: 'critical', why: 'A tilt or settlement can mean the ground or the structure has moved.' },
  ponding_water: { severity: 'low', why: 'Standing water points to drainage that does not work or a surface laid to the wrong fall.' },
  unsafe_edge_or_access: { severity: 'high', why: 'An unprotected edge or unsafe access is a risk to people on site today.' },
  encroachment: { severity: 'high', why: 'Something built or kept over a boundary bears on title and on what can be built.' },
  damaged: { severity: 'medium', why: 'Damage seen in a photograph needs its extent looked at on site.' },
  missing: { severity: 'medium', why: 'Something expected and not there needs confirming on site.' },
};

/** One thing a model picked in a photograph. */
export interface PhotoSeen {
  element: PhotoElement;
  condition: PhotoCondition;
  location: PhotoLocation;
  /** How sure the model said it was, 0 to 1. */
  confidence: number;
}

export const PHOTO_SEEN_AT_MOST = 8;

/** How long a person's note on a photograph may be. */
export const PHOTO_NOTE_MOST = 240;

/** What of a model's answer is read: picks on the lists, and nothing else. */
export function photoSeenFrom(given: unknown): PhotoSeen[] {
  const out: PhotoSeen[] = [];
  for (const raw of Array.isArray(given) ? given : []) {
    const one = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const element = PHOTO_ELEMENTS.find((known) => known === one.element);
    const condition = PHOTO_CONDITIONS.find((known) => known === one.condition);
    const location = PHOTO_LOCATIONS.find((known) => known === one.location) ?? 'not_clear';
    const confidence = typeof one.confidence === 'number' && Number.isFinite(one.confidence) ? Math.min(1, Math.max(0, one.confidence)) : 0;
    if (!element || !condition || out.length >= PHOTO_SEEN_AT_MOST) continue;
    if (!out.some((held) => held.element === element && held.condition === condition && held.location === location)) out.push({ element, condition, location, confidence });
  }
  return out;
}

/** One pick as a line: the element, the condition seen, and where. */
export function photoSeenSaid(seen: PhotoSeen): string {
  return `${PHOTO_ELEMENT_LABEL[seen.element]}: ${PHOTO_CONDITION_LABEL[seen.condition]}${seen.location === 'not_clear' ? '' : ` (${PHOTO_LOCATION_LABEL[seen.location]})`}`;
}

/**
 * An observation made from picks. Its description is the picks, one after
 * another; its elements are the elements picked; it has no note; and what it
 * proposes as findings are its defect picks, worded and graded from the
 * table. Every word is a list's or the table's.
 */
export function photoObservationOfPicks(subject: PhotoSubject, picks: readonly PhotoSeen[], model: string, at: string): PhotoObservation {
  if (subject === 'document') {
    return { subject, description: 'A photographed document.', elements: [], notes: [], suggestedFindings: [], seen: [], limits: 'A photographed document. Read through the extraction path rather than described here.', model, at };
  }
  const seen = [...picks];
  const suggestedFindings: PhotoSuggestedFinding[] = seen.flatMap((pick) => {
    const defect = PHOTO_DEFECT_TABLE[pick.condition];
    return defect ? [{ title: photoSeenSaid(pick), observed: photoSeenSaid(pick), whyItMayMatter: defect.why, suggestedSeverity: defect.severity, confidence: pick.confidence, seen: pick }] : [];
  });
  return {
    subject,
    description: seen.map(photoSeenSaid).join('; '),
    elements: [...new Set(seen.map((pick) => PHOTO_ELEMENT_LABEL[pick.element]))],
    notes: [],
    suggestedFindings,
    seen,
    ...(subject === 'unclear' && !seen.length ? { limits: 'What the photograph shows could not be told.' } : {}),
    model,
    at,
  };
}

/** A person's note on a photograph: their own words, one line, capped. An empty note takes the note away. */
export function setPhotoNote(observation: PhotoObservation, text: string, by: string, at: string): PhotoObservation {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length > PHOTO_NOTE_MOST) throw new Error(`A note on a photograph is at most ${PHOTO_NOTE_MOST} characters.`);
  if (!line) delete observation.personNote;
  else observation.personNote = { text: line, by, at };
  return observation;
}

/** Whether an observation's words are a model's own, kept before observations were picks. */
export function photoWrittenByModelBefore(observation: PhotoObservation | undefined): boolean {
  return Boolean(observation && !observation.seen && (observation.description.trim() || observation.notes.length || observation.suggestedFindings.length));
}
