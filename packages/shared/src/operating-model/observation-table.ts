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
