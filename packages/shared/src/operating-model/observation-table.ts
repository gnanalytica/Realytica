/**
 * The observations table, read: which findings are in it, in what order,
 * and how it goes out. Pure reads only, so the report resolver can use them.
 * Recording and changing an observation lives in `observations.ts`.
 */

import { SCOPE_LABEL } from './catalogs';
import { workstreamOfCheck, type DepartmentKey } from './departments';
import type { DdProject, FindingRecord, FindingSeverity, ScopeKey } from './types';

/** Severity in the words an engineer's table uses. */
export const RISK_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical risk',
  high: 'High risk',
  medium: 'Moderate risk',
  low: 'Low risk',
};

const CLOSED: ReadonlySet<string> = new Set(['rejected', 'duplicate', 'superseded']);
const RISK_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

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
  /** The file within that row, for its caption and for asking a model to describe it. */
  fileId?: string;
  /** Still only in the site log: filed onto the register when it is first used. */
  siteLog?: { entryId: string; index: number };
  title: string;
  /** The caption a person gave it. */
  caption?: string;
  takenAt?: string;
  point?: { lat: number; lng: number };
  /** Where it was taken, when the capture or the caption says. */
  area?: string;
  /** What a model saw in it, in its own words. A suggestion: never a diagnosis, and never printed as it stands. */
  seen?: string;
  /** What it shows, as a person accepted or wrote it. This is what the report prints. */
  shows?: string;
  /** A model has looked at it. */
  described: boolean;
  /** Findings a model thought the photograph might support, for a person to take or leave. */
  suggestions: Array<{ title: string; description: string; severity: FindingSeverity }>;
  /** The observations that cite it, by their number in the table. */
  usedIn: number[];
  /** An answer on a questionnaire rests on it. */
  provesAnAnswer: boolean;
  /** Chosen to print in the report on its own. */
  inReport: boolean;
}

function usedEvidence(project: DdProject): Set<string> {
  const used = new Set<string>();
  for (const f of project.findings) for (const id of f.evidenceIds) used.add(id);
  for (const q of project.questionnaires ?? []) for (const question of q.questions) for (const p of question.proof) used.add(p.evidenceId);
  return used;
}

/**
 * Every photograph on the project, newest first: the files on the document
 * register and the ones still only in the phone's site log, each with what a
 * person wrote about it, what a model saw in it, and where it is used.
 */
export function projectPhotos(project: DdProject, department: DepartmentKey = 'construction'): PhotoCandidate[] {
  const table = observations(project, department);
  const numberOf = new Map(table.map((f, i) => [f.id, i + 1]));
  const answered = new Set<string>();
  for (const q of project.questionnaires ?? []) for (const question of q.questions) for (const p of question.proof) answered.add(p.evidenceId);
  const filedKeys = new Set(project.evidence.flatMap((e) => e.attachments.map((a) => a.storageKey)));
  const out: PhotoCandidate[] = [];
  for (const row of project.evidence) {
    const shot = row.attachments.find((a) => a.mimeType.startsWith('image/'));
    if (!shot || (row.kind !== 'photograph' && shot.observation?.subject !== 'property')) continue;
    const seen = shot.observation;
    out.push({
      key: row.id,
      evidenceId: row.id,
      fileId: shot.id,
      title: row.title,
      caption: shot.capture?.caption,
      takenAt: shot.capture?.takenAt ?? shot.uploadedAt,
      point: shot.capture?.lat != null && shot.capture?.lng != null ? { lat: shot.capture.lat, lng: shot.capture.lng } : undefined,
      area: shot.capture?.zone,
      seen: seen?.description || undefined,
      shows: shot.shows?.text,
      described: Boolean(seen),
      suggestions: (seen?.suggestedFindings ?? []).map((s) => ({ title: s.title, description: [s.observed, s.whyItMayMatter].filter(Boolean).join(' '), severity: s.suggestedSeverity })),
      usedIn: project.findings.filter((f) => f.evidenceIds.includes(row.id) && numberOf.has(f.id)).map((f) => numberOf.get(f.id)!),
      provesAnAnswer: answered.has(row.id),
      inReport: row.inReport === true,
    });
  }
  for (const entry of project.siteLog ?? []) {
    entry.photos.forEach((photo, index) => {
      if (filedKeys.has(photo.storageKey)) return;
      out.push({
        key: `${entry.id}:${index}`,
        siteLog: { entryId: entry.id, index },
        title: photo.caption?.trim() || photo.fileName,
        caption: photo.caption?.trim() || undefined,
        takenAt: photo.takenAt ?? entry.createdAt,
        point: photo.point ?? entry.point,
        seen: undefined,
        described: false,
        suggestions: [],
        usedIn: [],
        provesAnAnswer: false,
        inReport: false,
      });
    });
  }
  return out.sort((x, y) => (y.takenAt ?? '').localeCompare(x.takenAt ?? ''));
}

/**
 * Photographs on the file that prove nothing yet: no observation cites them
 * and no questionnaire answer rests on them. Newest first.
 */
export function unusedPhotos(project: DdProject): PhotoCandidate[] {
  const used = usedEvidence(project);
  return projectPhotos(project).filter((p) => !p.evidenceId || !used.has(p.evidenceId));
}
