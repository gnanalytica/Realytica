/**
 * Construction › Progress: milestones, the daily site log, and how far along
 * the work is.
 *
 * The site log is written from the phone, often with no signal, so an entry
 * carries the id the phone gave it and filing the same entry twice files it
 * once. Progress is the weighted share of milestones complete, as the latest
 * site entries report them.
 */

import type { DdProject } from './types';
import type { GeoPoint } from '../types';
import { costRegister } from './cost';
import { recordAuditEvent } from './operations';
import { standingNumber, standingRecords, standingText } from './standing-records';

export interface Milestone {
  id: string;
  name: string;
  /** Its share of the whole, relative to the other milestones. */
  weight: number;
  /** The phase or block it belongs to, when the project has phases. */
  assetId?: string;
  /** The day work on it is planned to begin, when the schedule gives one. */
  plannedStart?: string;
  plannedFinish?: string;
  /** The planned finish it was first given, kept through later re-plans so the slip shows. */
  baselineFinish?: string;
  /** 0..100, as last reported. */
  percent: number;
  /** What was reported and on which day, one a day, oldest first: the rate a projected finish is read from. */
  readings?: Array<{ on: string; percent: number }>;
  completedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SiteLogPhoto {
  storageKey: string;
  fileName: string;
  mimeType: string;
  takenAt?: string;
  point?: GeoPoint;
  caption?: string;
  /** Where on the project it was taken, the station it is a shot of, and how those were set (`photo-stations.ts`). */
  place?: import('./capture').PhotoPlace;
  stationId?: string;
  placed?: import('./capture').PhotoPlacing;
}

export interface SiteLogEntry {
  id: string;
  /** The phone's own id for the entry: filing it twice files it once. */
  clientId: string;
  date: string;
  author: string;
  weather?: string;
  manpower: Array<{ trade: string; count: number }>;
  workDone: string;
  milestoneUpdates: Array<{ milestoneId: string; percent: number }>;
  issues: Array<{ title: string; severity: 'low' | 'medium' | 'high'; note?: string }>;
  photos: SiteLogPhoto[];
  point?: GeoPoint;
  /** The voice note the entry was read from, where it was: the file, and its words kept beside it. */
  voiceNote?: import('./site-notes').VoiceNoteFile;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The milestones a building project usually reports against, weighted the way
 * stage payments usually are. A starting point a project lead edits, never a
 * claim about any particular project.
 */
export const MILESTONE_TEMPLATE: ReadonlyArray<{ name: string; weight: number }> = [
  { name: 'Excavation and shoring', weight: 5 },
  { name: 'Foundation and basement', weight: 15 },
  { name: 'Plinth', weight: 5 },
  { name: 'Superstructure (frame and slabs)', weight: 30 },
  { name: 'Masonry and plastering', weight: 12 },
  { name: 'Services (MEP) rough-in', weight: 10 },
  { name: 'Finishes', weight: 13 },
  { name: 'External works and amenities', weight: 6 },
  { name: 'Testing, commissioning and OC', weight: 4 },
];

export function addMilestones(project: DdProject, rows: ReadonlyArray<{ name: string; weight: number; assetId?: string; plannedFinish?: string }>, actor: string): Milestone[] {
  const at = nowIso();
  const added = rows
    .filter((r) => r.name.trim() && r.weight > 0)
    .map((r) => ({ id: newId('mil'), name: r.name.trim(), weight: r.weight, ...(r.assetId ? { assetId: r.assetId } : {}), ...(r.plannedFinish ? { plannedFinish: r.plannedFinish, baselineFinish: r.plannedFinish } : {}), percent: 0, updatedAt: at, updatedBy: actor }));
  project.milestones = [...(project.milestones ?? []), ...added];
  if (added.length) recordAuditEvent(project, { actor, action: 'add_milestones', entityType: 'milestone', entityId: project.id, newValue: added.map((m) => m.name).join(', ') });
  return added;
}

/** How many days of readings a milestone keeps. */
const READINGS_KEPT = 120;

/**
 * Record how far along a milestone is. `on` is the day the reading is of,
 * which for a site entry filed late is the entry's day and not today.
 */
export function setMilestonePercent(project: DdProject, milestoneId: string, percent: number, actor: string, at = nowIso(), on = at.slice(0, 10)): Milestone {
  const m = (project.milestones ?? []).find((x) => x.id === milestoneId);
  if (!m) throw new Error('No milestone by that id.');
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Progress is a percentage between 0 and 100.');
  m.percent = Math.round(percent);
  m.readings = [...(m.readings ?? []).filter((r) => r.on !== on), { on, percent: m.percent }].sort((a, b) => a.on.localeCompare(b.on)).slice(-READINGS_KEPT);
  m.updatedAt = at;
  m.updatedBy = actor;
  if (m.percent === 100 && !m.completedOn) m.completedOn = at.slice(0, 10);
  if (m.percent < 100) delete m.completedOn;
  return m;
}

export interface SiteLogInput {
  clientId: string;
  date: string;
  weather?: string;
  manpower?: Array<{ trade: string; count: number }>;
  workDone?: string;
  milestoneUpdates?: Array<{ milestoneId: string; percent: number }>;
  issues?: Array<{ title: string; severity?: 'low' | 'medium' | 'high'; note?: string }>;
  photos?: SiteLogPhoto[];
  point?: GeoPoint;
  voiceNote?: import('./site-notes').VoiceNoteFile;
}

/**
 * File a site log entry. Idempotent on the phone's own id, so a queue that
 * resends after a dropped connection cannot double the day.
 */
export function logSiteEntry(project: DdProject, input: SiteLogInput, author: string): { entry: SiteLogEntry; duplicate: boolean } {
  const held = (project.siteLog ?? []).find((e) => e.clientId === input.clientId);
  if (held) return { entry: held, duplicate: true };
  if (!input.clientId?.trim()) throw new Error('A site entry needs the id the phone gave it.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('A site entry needs its date, as YYYY-MM-DD.');
  const at = nowIso();
  const entry: SiteLogEntry = {
    id: newId('log'),
    clientId: input.clientId,
    date: input.date,
    author,
    ...(input.weather ? { weather: input.weather } : {}),
    manpower: (input.manpower ?? []).filter((m) => m.trade.trim() && m.count > 0),
    workDone: (input.workDone ?? '').trim(),
    milestoneUpdates: (input.milestoneUpdates ?? []).filter((u) => (project.milestones ?? []).some((m) => m.id === u.milestoneId)),
    issues: (input.issues ?? []).filter((i) => i.title.trim()).map((i) => ({ title: i.title.trim(), severity: i.severity ?? 'medium', ...(i.note ? { note: i.note } : {}) })),
    photos: input.photos ?? [],
    ...(input.point ? { point: input.point } : {}),
    ...(input.voiceNote ? { voiceNote: input.voiceNote } : {}),
    createdAt: at,
  };
  for (const u of entry.milestoneUpdates) setMilestonePercent(project, u.milestoneId, u.percent, author, at, entry.date);
  project.siteLog = [...(project.siteLog ?? []), entry];
  recordAuditEvent(project, { actor: author, action: 'site_log', entityType: 'site_log', entityId: entry.id, newValue: `${entry.date}: ${entry.workDone.slice(0, 120)}` });
  return { entry, duplicate: false };
}

/* ==================================================================== */
/* Extensions of time                                                     */
/* ==================================================================== */

/** Procurement's time claims and the contracts they are made under: the two sets an extension is read from. */
export const TIME_CLAIMS_SET = 'procurement.orders.time_claims';
export const CONTRACTS_SET = 'shared.contracts';

export interface MilestoneExtensions {
  /** Days each open milestone's planned finish moves by, by milestone id. Only milestones that move. */
  days: Map<string, number>;
  /** Days granted on contracts whose packages serve no milestone: granted, and moving nothing on the schedule. */
  unplaced: number;
  /** The most days granted on any one contract. */
  most: number;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * What the extensions of time that stand do to the schedule.
 *
 * A time claim's days granted count once a person has typed or accepted
 * them: a figure a paper or a model offered moves nothing. The days granted
 * on a contract are the sum of its claims'. A contract covers the milestones
 * its work packages are measured against, and every open milestone planned
 * to finish after the earliest of those, because work that follows waits on
 * it. A milestone several contracts cover moves by the most any one of them
 * was granted, so two extensions for the same weeks are not added together.
 * A milestone that is complete does not move.
 */
export function milestoneExtensions(project: Pick<DdProject, 'milestones'> & Partial<Pick<DdProject, 'fieldSheets' | 'cost'>>): MilestoneExtensions {
  const out: MilestoneExtensions = { days: new Map(), unplaced: 0, most: 0 };
  const granted = new Map<string, number>();
  for (const claim of standingRecords(project, TIME_CLAIMS_SET)) {
    const contract = standingText(claim, 'contract');
    const days = standingNumber(claim, 'days_granted');
    if (contract && days !== undefined && days > 0) granted.set(contract, (granted.get(contract) ?? 0) + days);
  }
  if (!granted.size) return out;
  const register = costRegister(project);
  const milestones = project.milestones ?? [];
  const contracts = standingRecords(project, CONTRACTS_SET);
  for (const [contractId, days] of granted) {
    out.most = Math.max(out.most, days);
    const packageId = standingText(contracts.find((held) => held.id === contractId), 'package');
    const packages = packageId ? (register.contracts.find((contract) => contract.workPackageIds.includes(packageId))?.workPackageIds ?? [packageId]) : [];
    const served = new Set(register.workPackages.filter((pack) => packages.includes(pack.id) && pack.milestoneId).map((pack) => pack.milestoneId!));
    const first = milestones.filter((m) => served.has(m.id) && m.plannedFinish).map((m) => m.plannedFinish!.slice(0, 10)).sort()[0];
    if (first === undefined) {
      out.unplaced += days;
      continue;
    }
    for (const milestone of milestones) {
      if (milestone.percent >= 100 || !milestone.plannedFinish) continue;
      if (served.has(milestone.id) || milestone.plannedFinish.slice(0, 10) > first) out.days.set(milestone.id, Math.max(out.days.get(milestone.id) ?? 0, days));
    }
  }
  return out;
}

/** The day a milestone is planned to finish once the extensions granted are counted. Its own planned finish where none covers it. */
export function plannedFinishAfterExtensions(milestone: Pick<Milestone, 'id' | 'plannedFinish'>, extensions: MilestoneExtensions): string | undefined {
  const planned = milestone.plannedFinish?.slice(0, 10);
  const days = extensions.days.get(milestone.id);
  return planned && days ? addDays(planned, days) : planned;
}

export interface ProgressSummary {
  /** Weighted share of milestones complete, 0..100. Null with no milestones. */
  percent: number | null;
  milestones: number;
  complete: number;
  /** Milestones past their planned finish, as extensions of time granted have moved it, and not complete. */
  late: Array<{ name: string; plannedFinish: string; percent: number }>;
  lastEntry?: { date: string; author: string; manpower: number };
  /** Total workers on the latest day logged. */
  openIssues: number;
}

export function progressSummary(project: DdProject, now = new Date()): ProgressSummary {
  const milestones = project.milestones ?? [];
  const totalWeight = milestones.reduce((n, m) => n + m.weight, 0);
  const percent = totalWeight > 0 ? Math.round((milestones.reduce((n, m) => n + m.weight * m.percent, 0) / totalWeight) * 10) / 10 : null;
  const today = now.toISOString().slice(0, 10);
  const log = [...(project.siteLog ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const last = log[0];
  const extensions = milestoneExtensions(project);
  const finish = (m: Milestone) => plannedFinishAfterExtensions(m, extensions);
  return {
    percent,
    milestones: milestones.length,
    complete: milestones.filter((m) => m.percent >= 100).length,
    late: milestones.filter((m) => m.percent < 100 && (finish(m) ?? today) < today).map((m) => ({ name: m.name, plannedFinish: finish(m)!, percent: m.percent })),
    ...(last ? { lastEntry: { date: last.date, author: last.author, manpower: last.manpower.reduce((n, x) => n + x.count, 0) } } : {}),
    openIssues: log.reduce((n, e) => n + e.issues.length, 0),
  };
}
