/**
 * Observations and mitigations: the table a technical due diligence is.
 *
 * An engineer walks a building and writes down what they saw, how much it
 * matters, and what to do about it — area by area, each with the photograph
 * that shows it and, where there is one, the clause of the code it breaches.
 * That table is the report. Everything else in the file feeds it.
 *
 * An observation is a finding. It is not a second register: the same record
 * the checks raise and the chat proposes, with the three things an engineer's
 * table adds — where in the building, the mitigation, and the reference. So
 * an observation written here is on the findings register, in the graph and
 * in the report without anything being copied.
 *
 * Photographs are proof, and they come from two places: files on the
 * document register, and the site log the phone keeps. A site-log photograph
 * is filed onto the register the first time it is used as proof, so one
 * photograph is one row however it arrived.
 */

import { attachEvidenceFile } from './capabilities';
import { SCOPE_LABEL } from './catalogs';
import { workstreamOfCheck, type DepartmentKey } from './departments';
import { addEvidence, addFinding } from './operations';
import type { DdProject, EvidenceRecord, FindingRecord, FindingSeverity, ScopeKey } from './types';

/** Severity in the words an engineer's table uses. */
export const RISK_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical risk',
  high: 'High risk',
  medium: 'Moderate risk',
  low: 'Low risk',
};

const CLOSED: ReadonlySet<string> = new Set(['rejected', 'duplicate', 'superseded']);
const RISK_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The disciplines a department's checks cover, plus the technical one engineering always owns. */
function disciplinesOf(project: DdProject, department: DepartmentKey): Set<ScopeKey> {
  const out = new Set<ScopeKey>(department === 'construction' ? ['technical', 'quality'] : []);
  for (const a of project.assessments ?? []) {
    if (a.status === 'archived') continue;
    for (const s of a.scopes) {
      if (s.checks.some((c) => workstreamOfCheck(c.definitionId).split('.')[0] === department)) out.add(s.scopeKey);
    }
  }
  return out;
}

/**
 * The observations of one department's work: every finding in its
 * disciplines that still stands. Ordered as the table is read — by area as
 * first written, then by risk.
 */
export function observations(project: DdProject, department: DepartmentKey = 'construction'): FindingRecord[] {
  const disciplines = disciplinesOf(project, department);
  const rows = project.findings.filter((f) => !CLOSED.has(f.status) && disciplines.has(f.discipline));
  const areaOrder = new Map<string, number>();
  // The register keeps the order things were written in; a timestamp can tie.
  for (const f of rows) {
    const key = (f.area ?? '').toLowerCase();
    if (!areaOrder.has(key)) areaOrder.set(key, areaOrder.size);
  }
  return rows.sort(
    (a, b) =>
      areaOrder.get((a.area ?? '').toLowerCase())! - areaOrder.get((b.area ?? '').toLowerCase())! ||
      RISK_ORDER.indexOf(a.severity) - RISK_ORDER.indexOf(b.severity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export interface ObservationInput {
  /** Where in the building: pump room, basement, terrace. */
  area?: string;
  description: string;
  severity: FindingSeverity;
  mitigation?: string;
  /** The code or standard it is judged against: NBC 2016 Part 4, cl. 4.16.1. */
  standardRef?: string;
  discipline?: ScopeKey;
  /** A short title; taken from the description when left out. */
  title?: string;
  evidenceIds?: string[];
}

function titleFrom(description: string): string {
  const first = description.trim().split(/(?<=[.!?])\s+/)[0] ?? description.trim();
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

/**
 * What an observation says, in one line of the table.
 *
 * A finding raised by a check or written in the register has a title of its
 * own and a description beside it; one recorded here has only a description,
 * and its title is that description's first sentence. The table shows both
 * halves when they are two things and one when they are the same.
 */
export function observationStatement(f: Pick<FindingRecord, 'title' | 'description'>): string {
  const title = f.title.trim();
  const description = f.description.trim();
  if (!description) return title;
  if (!title || description.startsWith(title.replace(/…$/, ''))) return description;
  return `${title.replace(/[.:]$/, '')}. ${description}`;
}

function knownEvidence(project: DdProject, ids: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!project.evidence.some((e) => e.id === id)) throw new Error(`No document or photograph ${id} on this project.`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function addObservation(project: DdProject, input: ObservationInput, actor: string): FindingRecord {
  const description = input.description.trim();
  if (!description) throw new Error('Say what was observed.');
  const record = addFinding(
    project,
    {
      title: input.title?.trim() || titleFrom(description),
      description,
      severity: input.severity,
      discipline: input.discipline ?? 'technical',
      evidenceIds: knownEvidence(project, input.evidenceIds),
    },
    actor,
  );
  record.area = input.area?.trim() || undefined;
  record.mitigation = input.mitigation?.trim() || undefined;
  record.standardRef = input.standardRef?.trim() || undefined;
  return record;
}

export interface ObservationPatch {
  area?: string | null;
  description?: string;
  title?: string;
  severity?: FindingSeverity;
  mitigation?: string | null;
  standardRef?: string | null;
  discipline?: ScopeKey;
  evidenceIds?: string[];
}

export function patchObservation(project: DdProject, findingId: string, patch: ObservationPatch, actor: string): FindingRecord {
  const record = project.findings.find((f) => f.id === findingId);
  if (!record) throw new Error('No observation by that id.');
  const at = nowIso();
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    if (!description) throw new Error('Say what was observed.');
    // The title follows the description unless someone gave it its own.
    if (patch.title === undefined && record.title === titleFrom(record.description)) record.title = titleFrom(description);
    record.description = description;
  }
  if (patch.title !== undefined && patch.title.trim()) record.title = patch.title.trim();
  if (patch.severity !== undefined) record.severity = patch.severity;
  if (patch.discipline !== undefined) record.discipline = patch.discipline;
  if (patch.area !== undefined) record.area = patch.area?.trim() || undefined;
  if (patch.mitigation !== undefined) record.mitigation = patch.mitigation?.trim() || undefined;
  if (patch.standardRef !== undefined) record.standardRef = patch.standardRef?.trim() || undefined;
  if (patch.evidenceIds !== undefined) record.evidenceIds = knownEvidence(project, patch.evidenceIds);
  record.updatedAt = at;
  project.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: 'update', entityType: 'finding', entityId: record.id, newValue: record.title });
  return record;
}

/* ==================================================================== */
/* The table, as it is handed over                                       */
/* ==================================================================== */

export interface ObservationSummary {
  total: number;
  byRisk: Record<FindingSeverity, number>;
  withMitigation: number;
  withPhoto: number;
  areas: string[];
}

function isPhoto(project: DdProject, evidenceId: string): boolean {
  const row = project.evidence.find((e) => e.id === evidenceId);
  return row?.kind === 'photograph' || Boolean(row?.attachments.some((a) => a.mimeType.startsWith('image/')));
}

export function observationSummary(project: DdProject, rows: readonly FindingRecord[]): ObservationSummary {
  const byRisk: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const areas: string[] = [];
  for (const f of rows) byRisk[f.severity] += 1;
  // An area is spelt the way it was first written, which is the register's own order.
  const inTable = new Set(rows.map((f) => f.id));
  for (const f of project.findings) {
    if (inTable.has(f.id) && f.area && !areas.some((a) => a.toLowerCase() === f.area!.toLowerCase())) areas.push(f.area);
  }
  return {
    total: rows.length,
    byRisk,
    withMitigation: rows.filter((f) => f.mitigation).length,
    withPhoto: rows.filter((f) => f.evidenceIds.some((id) => isPhoto(project, id))).length,
    areas,
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function proofTitles(project: DdProject, f: FindingRecord): string {
  return f.evidenceIds.map((id) => project.evidence.find((e) => e.id === id)?.title ?? id).join('; ');
}

/** The observations and mitigations table: serial number, area, description, risk, mitigation, reference, proof. */
export function observationsCsv(project: DdProject, rows: readonly FindingRecord[]): string {
  const lines = [['S. No', 'Area', 'Description', 'Risk category', 'Mitigation', 'Reference', 'Discipline', 'Photographs and documents'].join(',')];
  rows.forEach((f, i) => {
    lines.push(
      [String(i + 1), f.area ?? '', observationStatement(f), RISK_LABEL[f.severity], f.mitigation ?? '', f.standardRef ?? '', SCOPE_LABEL[f.discipline] ?? f.discipline, proofTitles(project, f)]
        .map(csvCell)
        .join(','),
    );
  });
  return `${lines.join('\n')}\n`;
}

/** The same table as text, area by area: observation, risk, then the mitigation. */
export function observationsText(rows: readonly FindingRecord[]): string {
  const out: string[] = ['OBSERVATIONS AND MITIGATIONS', ''];
  let area: string | undefined;
  rows.forEach((f, i) => {
    const here = f.area ?? 'General';
    if (here !== area) {
      area = here;
      out.push(here);
    }
    out.push(`${i + 1}. ${observationStatement(f)}  [${RISK_LABEL[f.severity]}]`);
    if (f.mitigation) out.push(`   Mitigation: ${f.mitigation}`);
    if (f.standardRef) out.push(`   Reference: ${f.standardRef}`);
  });
  return out.join('\n');
}

/* ==================================================================== */
/* Photographs waiting to be used                                        */
/* ==================================================================== */

export interface PhotoCandidate {
  key: string;
  /** On the document register already. */
  evidenceId?: string;
  /** Still only in the site log: filed onto the register when it is first used. */
  siteLog?: { entryId: string; index: number };
  title: string;
  takenAt?: string;
  /** Where it was taken, when the capture or the caption says. */
  area?: string;
  /** What a model saw in it, in its own words. Never a diagnosis. */
  seen?: string;
  /** Findings a model thought the photograph might support, for a person to take or leave. */
  suggestions: Array<{ title: string; description: string; severity: FindingSeverity }>;
}

function usedEvidence(project: DdProject): Set<string> {
  const used = new Set<string>();
  for (const f of project.findings) for (const id of f.evidenceIds) used.add(id);
  for (const q of project.questionnaires ?? []) for (const question of q.questions) for (const p of question.proof) used.add(p.evidenceId);
  return used;
}

/**
 * Photographs on the file that prove nothing yet: no observation cites them
 * and no questionnaire answer rests on them. Newest first.
 */
export function unusedPhotos(project: DdProject): PhotoCandidate[] {
  const used = usedEvidence(project);
  const filedKeys = new Set(project.evidence.flatMap((e) => e.attachments.map((a) => a.storageKey)));
  const out: PhotoCandidate[] = [];
  for (const row of project.evidence) {
    if (used.has(row.id)) continue;
    const shot = row.attachments.find((a) => a.mimeType.startsWith('image/'));
    if (!shot || (row.kind !== 'photograph' && shot.observation?.subject !== 'property')) continue;
    const seen = shot.observation;
    out.push({
      key: row.id,
      evidenceId: row.id,
      title: row.title,
      takenAt: shot.capture?.takenAt ?? shot.uploadedAt,
      area: shot.capture?.zone,
      seen: seen?.description,
      suggestions: (seen?.suggestedFindings ?? []).map((s) => ({ title: s.title, description: [s.observed, s.whyItMayMatter].filter(Boolean).join(' '), severity: s.suggestedSeverity })),
    });
  }
  for (const entry of project.siteLog ?? []) {
    entry.photos.forEach((photo, index) => {
      if (filedKeys.has(photo.storageKey)) return;
      out.push({
        key: `${entry.id}:${index}`,
        siteLog: { entryId: entry.id, index },
        title: photo.caption?.trim() || photo.fileName,
        takenAt: photo.takenAt ?? entry.createdAt,
        seen: photo.caption?.trim() || undefined,
        suggestions: [],
      });
    });
  }
  return out.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? ''));
}

/**
 * Put a site-log photograph on the document register, so it can be cited.
 * Filing the same photograph twice files it once.
 */
export function fileSiteLogPhoto(project: DdProject, entryId: string, index: number, actor: string): EvidenceRecord {
  const entry = (project.siteLog ?? []).find((e) => e.id === entryId);
  const photo = entry?.photos[index];
  if (!entry || !photo) throw new Error('No site photograph there.');
  const held = project.evidence.find((e) => e.attachments.some((a) => a.storageKey === photo.storageKey));
  if (held) return held;
  const row = addEvidence(
    project,
    { title: photo.caption?.trim() || `Site photograph, ${entry.date}`, kind: 'photograph', status: 'received', source: `Site log · ${entry.author}`, description: photo.caption?.trim() || undefined },
    actor,
  );
  attachEvidenceFile(
    project,
    row.id,
    {
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      sizeBytes: 0,
      storageKey: photo.storageKey,
      capture: { purpose: 'diligence_inspection', takenAt: photo.takenAt ?? entry.createdAt, lat: photo.point?.lat ?? entry.point?.lat, lng: photo.point?.lng ?? entry.point?.lng, caption: photo.caption },
    },
    actor,
  );
  row.workstream = 'construction.site';
  return row;
}
