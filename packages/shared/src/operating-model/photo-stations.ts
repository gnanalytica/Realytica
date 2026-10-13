/**
 * Photographs tied to a place and a period: the same place seen over time.
 *
 * A photo station is a place on the project that is shot again and again
 * from the same spot: a record of the set `construction.site.stations`,
 * with a building, a floor, an element, a milestone and how often it is to
 * be shot. A photograph of either store (the phone's site log, the document
 * register) carries the station it is a shot of and its place, and this
 * file reads the two stores as one list of shots.
 *
 * Everything here is worked out by code. A shot reaches a station because a
 * person picked the station on the phone, or because the photograph's own
 * position fell within a named distance of exactly one station's recorded
 * point; otherwise it waits, "place not set", for a person. A model writes
 * nothing here: the element it picked in a photograph is offered for the
 * place, and is the place's only once a person takes it.
 *
 * A station's standing (shot this period, due, overdue, never shot) is read
 * afresh each time from the days its shots were taken, by the day it is in
 * India. All period arithmetic is in `photoPeriod`, and nowhere else.
 *
 * Pure, apart from the three functions that set a place.
 */

import type { GeoPoint } from '../types';
import type { PhotoPlace, PhotoPlacing } from './capture';
import { PHOTO_ELEMENTS, PHOTO_ELEMENT_LABEL, photoWrittenByModelBefore, type PhotoElement } from './photo-picks';
import type { Milestone, SiteLogEntry, SiteLogPhoto } from './progress';
import { QUARTER_YEAR_DEFAULT, indiaToday, quarterKey, quarterOf, quarterSaid, type QuarterYear } from './quarters';
import { daySaid } from './said';
import { standingRecords, standingText, type StandingRecord } from './standing-records';
import type { DdProject, EvidenceAttachment, EvidenceRecord } from './types';

/** The set that keeps the stations, and the shared sets and the function a place links into. */
export const STATIONS_SET = 'construction.site.stations';
export const STATION_ROUND_SET = 'construction.site.round';
export const SITE_FN = 'construction.site';
const BUILDINGS_SET = 'shared.buildings';
const UNITS_SET = 'shared.units';

/** How often a station is to be shot. */
export const STATION_EVERY = ['week', 'month', 'quarter'] as const;
export type StationEvery = (typeof STATION_EVERY)[number];
export const STATION_EVERY_LABEL: Record<StationEvery, string> = { week: 'Every week', month: 'Every month', quarter: 'Every quarter' };

/**
 * How near a photograph's own position has to be to a station's recorded
 * point to be taken as a shot of it, in metres. A phone's position is
 * commonly twenty to thirty metres out on a site, so a tighter figure would
 * leave most shots unplaced; and where two stations are both within it the
 * shot is given to neither, since position alone cannot tell them apart
 * (the same corner on two floors).
 */
export const STATION_MATCH_M = 30;

/** The most a floor's word may be. */
export const PLACE_FLOOR_MOST = 40;

/* ==================================================================== */
/* The period: the one place a week, a month or a quarter is worked out  */
/* ==================================================================== */

/** A period of days: `from` and `to` are its first and last day, both inside it. */
export interface PhotoPeriod {
  /** `2026-W42`, `2026-10`, `FY2026-Q3`. */
  key: string;
  from: string;
  to: string;
  /** As a person reads it: "Week of 12 Oct 2026", "October 2026", "Q3 FY 2026-27". */
  said: string;
}

const DAY_MS = 86_400_000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The week, month or quarter a day falls in, or the one so many before or
 * after it (`shift`).
 *
 * A week is Monday to Sunday, numbered as ISO 8601 numbers it. A month is
 * the calendar month. A quarter is one of `quarters.ts`, numbered in the
 * financial year unless the calendar year is asked for.
 *
 * This is the only place this file, the report section and the screen work
 * out a period: everything else asks here. A general notion of a period can
 * replace this one function and nothing else.
 */
export function photoPeriod(day: string, every: StationEvery, shift = 0, year: QuarterYear = QUARTER_YEAR_DEFAULT): PhotoPeriod {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number) as [number, number, number];
  if (every === 'week') {
    const at = Date.UTC(y, m - 1, d);
    const monday = at - ((new Date(at).getUTCDay() + 6) % 7) * DAY_MS + shift * 7 * DAY_MS;
    // A week belongs to the year its Thursday is in.
    const thursday = new Date(monday + 3 * DAY_MS);
    const week = Math.floor((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / (7 * DAY_MS)) + 1;
    return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, from: isoDay(monday), to: isoDay(monday + 6 * DAY_MS), said: `Week of ${daySaid(isoDay(monday))}` };
  }
  if (every === 'quarter') {
    const quarter = quarterOf(y, Math.floor((m - 1) / 3) * 3 + shift * 3);
    return { key: quarterKey(quarter, year)!, from: quarter.from.slice(0, 10), to: isoDay(Date.parse(quarter.to) - DAY_MS), said: quarterSaid(quarter, year)! };
  }
  const first = new Date(Date.UTC(y, m - 1 + shift, 1));
  const [year4, month] = [first.getUTCFullYear(), first.getUTCMonth()];
  return { key: `${year4}-${String(month + 1).padStart(2, '0')}`, from: isoDay(first.getTime()), to: isoDay(Date.UTC(year4, month + 1, 0)), said: `${MONTH_NAMES[month]} ${year4}` };
}

/**
 * The day a photograph was taken, as the day it was in India. A moment that
 * says its own offset is read into India's day. One with no offset is the
 * camera's own clock, which was on site, so its date is the day.
 */
export function shotDay(takenAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(takenAt)) return takenAt;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(takenAt)) return takenAt.slice(0, 10);
  const at = new Date(takenAt);
  return Number.isNaN(at.getTime()) ? takenAt.slice(0, 10) : indiaToday(at);
}

/* ==================================================================== */
/* Shots: the two stores read as one list                                */
/* ==================================================================== */

/** One photograph, wherever it is kept. */
export interface StationShot {
  /** Its file's key in storage: the same photograph in both stores is one shot. */
  key: string;
  /** On the document register. */
  evidenceId?: string;
  fileId?: string;
  /** Still only in the site log. */
  siteLog?: { entryId: string; index: number };
  takenAt: string;
  /** The day it was taken, in India. */
  day: string;
  /** Who took it, where the record says. */
  by?: string;
  stationId?: string;
  place?: PhotoPlace;
  placed?: PhotoPlacing;
  /** The free-text area a person wrote before places were links. Still read. */
  zone?: string;
  /** The element a model picked in it, offered for the place while the place names none. */
  offer?: { element: PhotoElement; confidence: number };
  /** Words a model wrote about it before photographs were read as picks. Shown marked as such, and used for nothing. */
  writtenBefore?: string;
}

const photoOf = (row: EvidenceRecord): EvidenceAttachment | undefined => row.attachments.find((file) => file.mimeType.startsWith('image/'));

function shotOfEvidence(row: EvidenceRecord, file: EvidenceAttachment, authors: Map<string, string>): StationShot {
  const takenAt = file.capture?.takenAt ?? file.uploadedAt;
  const by = authors.get(file.storageKey) ?? row.owner;
  const best = [...(file.observation?.seen ?? [])].sort((a, b) => b.confidence - a.confidence)[0];
  return {
    key: file.storageKey,
    evidenceId: row.id,
    fileId: file.id,
    takenAt,
    day: shotDay(takenAt),
    ...(by ? { by } : {}),
    ...(file.capture?.stationId ? { stationId: file.capture.stationId } : {}),
    ...(file.capture?.place ? { place: file.capture.place } : {}),
    ...(file.capture?.placed ? { placed: file.capture.placed } : {}),
    ...(file.capture?.zone ? { zone: file.capture.zone } : {}),
    ...(best && !file.capture?.place?.element ? { offer: { element: best.element, confidence: best.confidence } } : {}),
    ...(photoWrittenByModelBefore(file.observation) && file.observation!.description.trim() ? { writtenBefore: file.observation!.description.trim() } : {}),
  };
}

function shotOfSiteLog(entry: SiteLogEntry, photo: SiteLogPhoto, index: number): StationShot {
  const takenAt = photo.takenAt ?? entry.createdAt;
  return {
    key: photo.storageKey,
    siteLog: { entryId: entry.id, index },
    takenAt,
    day: photo.takenAt ? shotDay(photo.takenAt) : entry.date,
    by: entry.author,
    ...(photo.stationId ? { stationId: photo.stationId } : {}),
    ...(photo.place ? { place: photo.place } : {}),
    ...(photo.placed ? { placed: photo.placed } : {}),
  };
}

/** Who filed each site photograph, by its file's key. */
function siteAuthors(project: Pick<DdProject, 'siteLog'>): Map<string, string> {
  return new Map((project.siteLog ?? []).flatMap((entry) => entry.photos.map((photo) => [photo.storageKey, entry.author] as [string, string])));
}

/**
 * Every photograph on the project once, newest first: the site log's, and
 * the document register's rows that are photographs or carry a place. One
 * filed from the site log onto the register is the register's row.
 */
export function projectShots(project: Pick<DdProject, 'evidence' | 'siteLog'>): StationShot[] {
  const authors = siteAuthors(project);
  const out: StationShot[] = [];
  const filed = new Set<string>();
  for (const row of project.evidence) {
    const file = photoOf(row);
    if (!file || (row.kind !== 'photograph' && !file.capture?.stationId && !file.capture?.place)) continue;
    filed.add(file.storageKey);
    out.push(shotOfEvidence(row, file, authors));
  }
  for (const entry of project.siteLog ?? []) {
    entry.photos.forEach((photo, index) => {
      if (!filed.has(photo.storageKey)) out.push(shotOfSiteLog(entry, photo, index));
    });
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** The photographs a field holds, by the register rows it names, newest first. A row that is no photograph is left out. */
export function shotsOfEvidence(project: Pick<DdProject, 'evidence' | 'siteLog'>, evidenceIds: readonly string[]): StationShot[] {
  const authors = siteAuthors(project);
  const wanted = new Set(evidenceIds);
  return project.evidence
    .flatMap((row) => {
      const file = wanted.has(row.id) ? photoOf(row) : undefined;
      return file ? [shotOfEvidence(row, file, authors)] : [];
    })
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/* ==================================================================== */
/* Stations and their standing                                           */
/* ==================================================================== */

export interface PhotoStation {
  id: string;
  label: string;
  building?: string;
  floor?: string;
  element?: PhotoElement;
  milestone?: string;
  every: StationEvery;
  /** Its shot is needed before its milestone reads complete. */
  needed: boolean;
  /** The point a person recorded for it. Where none is recorded, `stationPoint` reads where it was first shot from. */
  point?: GeoPoint;
  /** Register rows a person filed on the station itself. */
  filed: string[];
}

type StationsOf = Partial<Pick<DdProject, 'fieldSheets'>>;

/** One station, read from a record already cut to the values that stand. */
function stationOf(standing: StandingRecord): PhotoStation {
  const every = standingText(standing, 'every');
  const element = standingText(standing, 'element');
  const [lat, lng] = [standing.values.lat?.value, standing.values.lng?.value];
  const filed = standing.values.shots?.value;
  const [building, floor, milestone] = [standingText(standing, 'building'), standingText(standing, 'floor'), standingText(standing, 'milestone')];
  return {
    id: standing.id,
    label: standingText(standing, 'label') ?? 'Station',
    ...(building ? { building } : {}),
    ...(floor ? { floor } : {}),
    ...(PHOTO_ELEMENTS.some((known) => known === element) ? { element: element as PhotoElement } : {}),
    ...(milestone ? { milestone } : {}),
    every: STATION_EVERY.find((known) => known === every) ?? 'month',
    needed: standing.values.needed?.value === true,
    ...(typeof lat === 'number' && typeof lng === 'number' ? { point: { lat, lng } } : {}),
    filed: Array.isArray(filed) ? filed.filter((id): id is string => typeof id === 'string') : [],
  };
}

/** The stations on the project's list, as they stand. */
export function photoStations(project: StationsOf): PhotoStation[] {
  return standingRecords(project, STATIONS_SET).map(stationOf);
}

/** The place a station is: what every shot of it is a shot of. */
export function stationPlace(station: PhotoStation): PhotoPlace {
  return {
    ...(station.building ? { building: station.building } : {}),
    ...(station.floor ? { floor: station.floor } : {}),
    ...(station.milestone ? { milestone: station.milestone } : {}),
    ...(station.element ? { element: station.element } : {}),
  };
}

/** The shots of one station, newest first: those that name it, and the register rows filed on it. */
export function stationShots(station: Pick<PhotoStation, 'id' | 'filed'>, shots: readonly StationShot[]): StationShot[] {
  return shots.filter((shot) => shot.stationId === station.id || (shot.evidenceId !== undefined && station.filed.includes(shot.evidenceId)));
}

export type StationStanding = 'shot' | 'due' | 'overdue' | 'never';
export const STATION_STANDING_LABEL: Record<StationStanding, string> = { shot: 'Shot this period', due: 'Due', overdue: 'Overdue', never: 'Never shot' };

/** How many periods back a standing looks before it stops counting. */
const PERIODS_BACK = 60;

export interface StandingRead {
  standing: StationStanding;
  /** The day of its latest shot. */
  lastDay?: string;
  /** Whole periods since the one its latest shot is in: 0 while shot this period. */
  behind?: number;
}

/**
 * Where a station stands on a day, from the days its shots were taken. Shot
 * this period; due, where its latest shot is in the period before; overdue,
 * where a whole period has gone by without one; never shot. A period begins
 * at midnight in India, so a monthly station shot on the 31st is due again
 * on the 1st.
 */
export function stationStanding(shotDays: readonly string[], every: StationEvery, today: string, year: QuarterYear = QUARTER_YEAR_DEFAULT): StandingRead {
  const lastDay = [...shotDays].sort().at(-1);
  if (!lastDay) return { standing: 'never' };
  if (lastDay >= photoPeriod(today, every, 0, year).from) return { standing: 'shot', lastDay, behind: 0 };
  let behind = 1;
  while (behind <= PERIODS_BACK && lastDay < photoPeriod(today, every, -behind, year).from) behind += 1;
  return { standing: behind === 1 ? 'due' : 'overdue', lastDay, behind };
}

/** A station with where it stands today and the shots that say so. */
export interface StationRow {
  station: PhotoStation;
  standing: StationStanding;
  lastDay?: string;
  behind?: number;
  /** The period today falls in, by the station's own interval. */
  period: PhotoPeriod;
  shots: StationShot[];
  /** The latest shot before this period: what the next one is framed against. */
  guide?: StationShot;
}

export interface StationRound {
  rows: StationRow[];
  /** The stations not photographed this period, the longest behind first. */
  due: StationRow[];
  /** Recent photographs that name no station and no place, waiting for a person. Empty on a project that keeps no station. */
  placeNotSet: StationShot[];
}

const BEHIND_ORDER: Record<StationStanding, number> = { overdue: 0, never: 1, due: 2, shot: 3 };

type RoundOf = StationsOf & Pick<DdProject, 'evidence' | 'siteLog'> & Partial<Pick<DdProject, 'reportDay'>>;

const quarterYear = (project: Partial<Pick<DdProject, 'reportDay'>>): QuarterYear => project.reportDay?.setting?.quarters ?? QUARTER_YEAR_DEFAULT;

/** Every station with its standing today, and what is not placed. */
export function stationRound(project: RoundOf, now: Date = new Date()): StationRound {
  const today = indiaToday(now);
  const year = quarterYear(project);
  const stations = photoStations(project);
  const all = projectShots(project);
  const rows = stations.map((station): StationRow => {
    const shots = stationShots(station, all);
    const period = photoPeriod(today, station.every, 0, year);
    const guide = shots.find((shot) => shot.day < period.from);
    return { station, ...stationStanding(shots.map((shot) => shot.day), station.every, today, year), period, shots, ...(guide ? { guide } : {}) };
  });
  const due = rows.filter((row) => row.standing !== 'shot').sort((a, b) => BEHIND_ORDER[a.standing] - BEHIND_ORDER[b.standing] || (b.behind ?? 0) - (a.behind ?? 0) || a.station.label.localeCompare(b.station.label));
  // A photograph waits for a place only where there is a station to give it, and only while it is recent: this month's or last month's.
  const since = photoPeriod(today, 'month', -1).from;
  const onStation = new Set(rows.flatMap((row) => row.shots.map((shot) => shot.key)));
  const placeNotSet = stations.length ? all.filter((shot) => shot.day >= since && !onStation.has(shot.key) && !shot.stationId && !placeHolds(shot.place)) : [];
  return { rows, due, placeNotSet };
}

const placeHolds = (place: PhotoPlace | undefined): boolean => Boolean(place && (place.building || place.floor || place.unit || place.milestone || place.element));

/** A station's point: the one recorded on it, else where it was first shot from by somebody who picked it on the phone. */
export function stationPoint(station: PhotoStation, project: Pick<DdProject, 'evidence' | 'siteLog'>): GeoPoint | undefined {
  if (station.point) return station.point;
  const first = [...pointedShots(project)].filter((held) => held.stationId === station.id && held.how === 'picked').sort((a, b) => a.takenAt.localeCompare(b.takenAt))[0];
  return first?.point;
}

/** The photographs of both stores that carry a position, with their station and how it was set. */
function pointedShots(project: Pick<DdProject, 'evidence' | 'siteLog'>): Array<{ stationId?: string; how?: PhotoPlacing['how']; takenAt: string; point: GeoPoint }> {
  const out: Array<{ stationId?: string; how?: PhotoPlacing['how']; takenAt: string; point: GeoPoint }> = [];
  for (const entry of project.siteLog ?? []) {
    for (const photo of entry.photos) {
      const point = photo.point ?? entry.point;
      if (point) out.push({ stationId: photo.stationId, how: photo.placed?.how, takenAt: photo.takenAt ?? entry.createdAt, point });
    }
  }
  for (const row of project.evidence) {
    const capture = photoOf(row)?.capture;
    if (capture?.lat !== undefined && capture.lng !== undefined) out.push({ stationId: capture.stationId, how: capture.placed?.how, takenAt: capture.takenAt ?? row.createdAt, point: { lat: capture.lat, lng: capture.lng } });
  }
  return out;
}

/* ==================================================================== */
/* Matching a shot to a station                                          */
/* ==================================================================== */

/** Metres between two points on a sphere: ample at the distances of one site. */
export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const [dLat, dLng] = [rad(b.lat - a.lat), rad(b.lng - a.lng)];
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface StationMatch {
  stationId: string;
  how: 'picked' | 'near';
  /** `near` only. */
  metres?: number;
}

/**
 * The station a photograph is a shot of, by code. The station picked on the
 * phone, where it is one on the list. Else the one station whose point the
 * photograph's own position is within `withinM` of: at the distance counts,
 * a metre past does not, and two stations both within it are a question for
 * a person. Else nothing, and the photograph waits as "place not set".
 */
export function matchStation(stations: ReadonlyArray<{ id: string; point?: GeoPoint }>, shot: { stationId?: string; point?: GeoPoint }, withinM: number = STATION_MATCH_M): StationMatch | undefined {
  if (shot.stationId && stations.some((station) => station.id === shot.stationId)) return { stationId: shot.stationId, how: 'picked' };
  if (!shot.point) return undefined;
  const near = stations.flatMap((station) => (station.point ? [{ id: station.id, metres: metresBetween(station.point, shot.point!) }] : [])).filter((held) => held.metres <= withinM);
  return near.length === 1 ? { stationId: near[0]!.id, how: 'near', metres: Math.round(near[0]!.metres * 10) / 10 } : undefined;
}

/**
 * Give the photographs of a site entry just filed their stations. Each is
 * matched by code, and one that matches takes the station's place. One that
 * matches nothing is left as it came, with no station.
 */
export function placeEntryShots(project: DdProject, entry: SiteLogEntry, at: string = new Date().toISOString()): number {
  const stations = photoStations(project);
  if (!stations.length) {
    for (const photo of entry.photos) delete photo.stationId;
    return 0;
  }
  const pointed = stations.map((station) => ({ station, id: station.id, point: stationPoint(station, project) }));
  let placed = 0;
  for (const photo of entry.photos) {
    const match = matchStation(pointed, { stationId: photo.stationId, point: photo.point ?? entry.point });
    if (!match) {
      delete photo.stationId;
      continue;
    }
    const station = pointed.find((held) => held.id === match.stationId)!.station;
    photo.stationId = station.id;
    photo.place = stationPlace(station);
    photo.placed = { how: match.how, by: match.how === 'picked' ? entry.author : 'Realytica', at, ...(match.metres !== undefined ? { metres: match.metres } : {}) };
    placed += 1;
  }
  return placed;
}

/* ==================================================================== */
/* A person sets a place                                                 */
/* ==================================================================== */

/** A photograph by where it is kept. */
export type ShotRef = { evidenceId: string } | { entryId: string; index: number };

type PlaceOf = StationsOf & Pick<DdProject, 'milestones'>;

/** What is wrong with a place, in a sentence. Nothing where every part of it names something the project keeps. */
export function placeFault(project: PlaceOf, place: PhotoPlace): string | undefined {
  const holds = (setId: string, id: string) => standingRecords(project, setId).some((record) => record.id === id);
  if (place.building !== undefined && !holds(BUILDINGS_SET, place.building)) return 'That building is not on the project.';
  if (place.unit !== undefined && !holds(UNITS_SET, place.unit)) return 'That unit is not on the project.';
  if (place.milestone !== undefined && !(project.milestones ?? []).some((milestone) => milestone.id === place.milestone)) return 'That milestone is not on the schedule.';
  if (place.element !== undefined && !PHOTO_ELEMENTS.some((known) => known === place.element)) return 'That element is not on the list.';
  if (place.floor !== undefined && (!place.floor.trim() || place.floor.trim().length > PLACE_FLOOR_MOST)) return `A floor is a word or two, at most ${PLACE_FLOOR_MOST} characters.`;
  return undefined;
}

const cleanPlace = (place: PhotoPlace): PhotoPlace => ({
  ...(place.building ? { building: place.building } : {}),
  ...(place.floor?.trim() ? { floor: place.floor.trim() } : {}),
  ...(place.unit ? { unit: place.unit } : {}),
  ...(place.milestone ? { milestone: place.milestone } : {}),
  ...(place.element ? { element: place.element } : {}),
});

/** Where a photograph's place is kept: the site log's own photograph, or the capture facts of a register row's file. */
function holderOf(project: DdProject, ref: ShotRef): { holder: { place?: PhotoPlace; stationId?: string; placed?: PhotoPlacing }; entityType: string; entityId: string } {
  if ('evidenceId' in ref) {
    const row = project.evidence.find((held) => held.id === ref.evidenceId);
    const file = row ? photoOf(row) : undefined;
    if (!row || !file) throw new Error('No photograph by that id.');
    file.capture ??= {};
    return { holder: file.capture, entityType: 'evidence', entityId: row.id };
  }
  const entry = (project.siteLog ?? []).find((held) => held.id === ref.entryId);
  const photo = entry?.photos[ref.index];
  if (!entry || !photo) throw new Error('No site photograph there.');
  return { holder: photo, entityType: 'site_log', entityId: entry.id };
}

/**
 * A person says where a photograph was taken: a station, a place, or both.
 * A station gives the photograph its own place, and a place given beside it
 * adds to that (a unit, say). `null` takes a station or a place away.
 */
export function setShotPlace(project: DdProject, ref: ShotRef, input: { stationId?: string | null; place?: PhotoPlace | null }, actor: string, at: string = new Date().toISOString()): void {
  const { holder, entityType, entityId } = holderOf(project, ref);
  const station = typeof input.stationId === 'string' ? photoStations(project).find((held) => held.id === input.stationId) : undefined;
  if (typeof input.stationId === 'string' && !station) throw new Error('No station by that id.');
  const given = input.place ? cleanPlace(input.place) : undefined;
  const fault = given ? placeFault(project, given) : undefined;
  if (fault) throw new Error(fault);
  if (input.stationId === null) delete holder.stationId;
  if (station) holder.stationId = station.id;
  if (input.place === null) delete holder.place;
  const place = { ...(input.place === undefined && !station ? (holder.place ?? {}) : {}), ...(given ?? {}), ...(station ? stationPlace(station) : {}) };
  if (placeHolds(place)) holder.place = place;
  else delete holder.place;
  if (holder.stationId || holder.place) holder.placed = { how: 'person', by: actor, at };
  else delete holder.placed;
  project.updatedAt = at;
  project.audit.push({ id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, at, actor, action: 'photo_place', entityType, entityId, newValue: placeSaid(project, holder.place, station?.label) || 'place taken away' });
}

/** A place in a line: the station, the building, the floor, the unit, the milestone and the element, as each is called. */
export function placeSaid(project: PlaceOf, place: PhotoPlace | undefined, stationLabel?: string): string {
  const named = (setId: string, id: string | undefined, field: string): string | undefined => (id ? (standingText(standingRecords(project, setId).find((record) => record.id === id), field) ?? undefined) : undefined);
  return [
    stationLabel,
    named(BUILDINGS_SET, place?.building, 'name'),
    place?.floor,
    named(UNITS_SET, place?.unit, 'number'),
    place?.milestone ? (project.milestones ?? []).find((milestone) => milestone.id === place.milestone)?.name : undefined,
    place?.element ? PHOTO_ELEMENT_LABEL[place.element] : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ==================================================================== */
/* The series: one station's shots by period                             */
/* ==================================================================== */

export interface SeriesGroup {
  period: PhotoPeriod;
  /** Newest first. */
  shots: StationShot[];
}

/** Shots grouped by the period each was taken in, the newest period first. */
export function photoSeries(shots: readonly StationShot[], every: StationEvery, year: QuarterYear = QUARTER_YEAR_DEFAULT): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>();
  for (const shot of [...shots].sort((a, b) => b.takenAt.localeCompare(a.takenAt))) {
    const period = photoPeriod(shot.day, every, 0, year);
    const group = groups.get(period.key) ?? { period, shots: [] };
    group.shots.push(shot);
    groups.set(period.key, group);
  }
  return [...groups.values()].sort((a, b) => b.period.from.localeCompare(a.period.from));
}

/**
 * The two periods put side by side: the earlier on the left, the later on
 * the right. The two newest where nobody has picked, else the two picked by
 * their keys. A series of one period has only a right side.
 */
export function seriesPair(groups: readonly SeriesGroup[], picked: { left?: string; right?: string } = {}): { left?: SeriesGroup; right?: SeriesGroup } {
  const byKey = (key: string | undefined) => (key ? groups.find((group) => group.period.key === key) : undefined);
  const right = byKey(picked.right) ?? groups[0];
  const left = byKey(picked.left) ?? groups.find((group) => group !== right && (!right || group.period.from < right.period.from));
  if (!right) return {};
  if (!left || left === right) return { right };
  return left.period.from <= right.period.from ? { left, right } : { left: right, right: left };
}

/* ==================================================================== */
/* Photographs a milestone needs                                         */
/* ==================================================================== */

export interface MilestonePhotoCheck {
  milestoneId: string;
  name: string;
  percent: number;
  /** Reported at a hundred per cent. */
  complete: boolean;
  /** The period a shot is needed in: the one the milestone was completed in, else the one today is in. By station, since each has its own interval. */
  stations: Array<{ id: string; label: string; have: boolean; period: PhotoPeriod; day?: string }>;
  /** How many of those stations have no shot. */
  short: number;
}

/**
 * The photographs each milestone needs, as a checklist. A station that names
 * a milestone and is marked as needed has to hold a shot from the period the
 * milestone was completed in, or later; while the milestone is still open,
 * from the period today is in.
 */
export function milestonePhotoChecklist(project: RoundOf & Pick<DdProject, 'milestones'>, now: Date = new Date()): MilestonePhotoCheck[] {
  const today = indiaToday(now);
  const year = quarterYear(project);
  const all = projectShots(project);
  const stations = photoStations(project).filter((station) => station.needed && station.milestone);
  return (project.milestones ?? []).flatMap((milestone: Milestone) => {
    const own = stations.filter((station) => station.milestone === milestone.id);
    if (!own.length) return [];
    const complete = milestone.percent >= 100;
    const on = complete ? (milestone.completedOn ?? today) : today;
    const rows = own.map((station) => {
      const period = photoPeriod(on, station.every, 0, year);
      const shot = stationShots(station, all).find((held) => held.day >= period.from);
      return { id: station.id, label: station.label, have: Boolean(shot), period, ...(shot ? { day: shot.day } : {}) };
    });
    return [{ milestoneId: milestone.id, name: milestone.name, percent: milestone.percent, complete, stations: rows, short: rows.filter((row) => !row.have).length }];
  });
}

/** One milestone's line of the checklist, in words code wrote. */
export function milestonePhotoSaid(check: MilestonePhotoCheck): string {
  const total = check.stations.length;
  const missing = check.stations.filter((row) => !row.have).map((row) => row.label);
  const noun = total === 1 ? 'photograph' : 'photographs';
  if (!check.short) return `${check.name}: ${total === 1 ? 'its required photograph is' : `all ${total} required photographs are`} taken.`;
  if (check.complete) return `${check.name} is reported complete and ${check.short} of its ${total} required ${noun} ${check.short === 1 ? 'is' : 'are'} not taken: ${missing.join(', ')}.`;
  return `${check.name}: ${total - check.short} of ${total} required ${noun} taken this period. Still to take: ${missing.join(', ')}.`;
}

/** Milestones reported complete with a required photograph missing. */
export function milestonesShortOfPhotos(checks: readonly MilestonePhotoCheck[]): MilestonePhotoCheck[] {
  return checks.filter((check) => check.complete && check.short > 0);
}

/* ==================================================================== */
/* What the phone is told                                                */
/* ==================================================================== */

/** A station as the site app is told of it: what to shoot, where it stands, and the last shot to frame against. */
export interface StationDue {
  id: string;
  label: string;
  /** The place in a line, as each part is called. */
  place: string;
  every: StationEvery;
  standing: StationStanding;
  period: { key: string; said: string; to: string };
  lastDay?: string;
  point?: GeoPoint;
  /** The latest shot before this period, to frame the next against: the register row and file, or the site entry and index. */
  guide?: { takenAt: string; evidenceId?: string; fileId?: string; siteLog?: { entryId: string; index: number } };
}

/** The stations not photographed this period, for the capture screen. */
export function stationsDue(project: RoundOf & Pick<DdProject, 'milestones'>, now: Date = new Date()): StationDue[] {
  return stationRound(project, now).due.map((row) => {
    const point = stationPoint(row.station, project);
    return {
      id: row.station.id,
      label: row.station.label,
      place: placeSaid(project, stationPlace(row.station)),
      every: row.station.every,
      standing: row.standing,
      period: { key: row.period.key, said: row.period.said, to: row.period.to },
      ...(row.lastDay ? { lastDay: row.lastDay } : {}),
      ...(point ? { point } : {}),
      ...(row.guide ? { guide: { takenAt: row.guide.takenAt, ...(row.guide.evidenceId ? { evidenceId: row.guide.evidenceId, fileId: row.guide.fileId } : {}), ...(row.guide.siteLog ? { siteLog: row.guide.siteLog } : {}) } } : {}),
    };
  });
}
