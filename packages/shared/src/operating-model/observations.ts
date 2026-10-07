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
import { addAction, addEvidence, addFinding } from './operations';
import { observationRemedy } from './observation-table';
import { REMEDIAL_BANDS, type RemedialBand } from './standards';
import type { DdProject, EvidenceRecord, FindingRecord, FindingSeverity, ScopeKey } from './types';

export * from './observation-table';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
  /** What the mitigation costs, and how soon the money is needed. */
  cost?: number | null;
  costBand?: RemedialBand | null;
}

function titleFrom(description: string): string {
  const first = description.trim().split(/(?<=[.!?])\s+/)[0] ?? description.trim();
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
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
  if (input.cost != null || input.costBand != null) setObservationCost(project, record.id, { cost: input.cost ?? null, band: input.costBand ?? null }, actor);
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
  /** Whether it prints in the report. Leaving one out does not close it. */
  includeInReport?: boolean;
  cost?: number | null;
  costBand?: RemedialBand | null;
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
  if (patch.includeInReport !== undefined) record.includeInReport = patch.includeInReport;
  if (patch.cost !== undefined || patch.costBand !== undefined) {
    const held = observationRemedy(project, record.id);
    setObservationCost(project, record.id, { cost: patch.cost !== undefined ? patch.cost : (held?.costEstimate ?? null), band: patch.costBand !== undefined ? patch.costBand : (held?.costBand ?? null) }, actor);
  }
  record.updatedAt = at;
  project.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: 'update', entityType: 'finding', entityId: record.id, newValue: record.title });
  return record;
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

/** Choose whether a filed photograph prints in the report on its own. */
export function setPhotoInReport(project: DdProject, evidenceId: string, inReport: boolean, actor: string): EvidenceRecord {
  const row = project.evidence.find((e) => e.id === evidenceId);
  if (!row) throw new Error('No photograph by that id.');
  if (!row.attachments.some((a) => a.mimeType.startsWith('image/'))) throw new Error('That is not a photograph.');
  const at = nowIso();
  row.inReport = inReport || undefined;
  row.updatedAt = at;
  project.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: inReport ? 'photo_in_report' : 'photo_out_of_report', entityType: 'evidence', entityId: row.id, newValue: row.title });
  return row;
}

/**
 * Say what a photograph shows: accept a model's description, correct it, or
 * write one. `null` takes the description away again. Until this is called
 * the model's words are a suggestion on the photograph and print nowhere.
 */
export function setPhotoDescription(project: DdProject, evidenceId: string, text: string | null, actor: string): EvidenceRecord {
  const row = project.evidence.find((e) => e.id === evidenceId);
  const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
  if (!row || !shot) throw new Error('No photograph by that id.');
  const at = nowIso();
  const words = text?.trim() ?? '';
  if (!words) delete shot.shows;
  else shot.shows = { text: words.slice(0, 1200), by: actor, at, fromModel: words === (shot.observation?.description ?? '').trim() };
  row.updatedAt = at;
  project.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: words ? 'photo_described' : 'photo_description_cleared', entityType: 'evidence', entityId: row.id, newValue: words || undefined });
  return row;
}

/**
 * What an observation's mitigation costs and when the money is needed.
 *
 * The figure lives on a remediation action, not on the finding: that is the
 * record the remedial cost table already sums, so a cost entered beside an
 * observation and one entered on the action register are the same number.
 * The action is made the first time a cost is given, and keeps the
 * mitigation as its title.
 */
export function setObservationCost(project: DdProject, findingId: string, input: { cost: number | null; band: RemedialBand | null }, actor: string): void {
  const finding = project.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error('No observation by that id.');
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0)) throw new Error('A cost is a number, zero or more.');
  if (input.band != null && !(REMEDIAL_BANDS as readonly string[]).includes(input.band)) throw new Error('Unknown period for the cost.');
  const at = nowIso();
  const held = observationRemedy(project, findingId);
  if (!held) {
    if (input.cost == null && input.band == null) return;
    addAction(
      project,
      { title: finding.mitigation?.trim() || `Remedy: ${finding.title}`, kind: 'remediation', owner: finding.owner?.trim() || 'Unassigned', priority: finding.severity, costEstimate: input.cost ?? undefined, costBand: input.band ?? undefined, findingIds: [findingId] },
      actor,
    );
    return;
  }
  held.costEstimate = input.cost ?? undefined;
  held.costBand = input.band ?? undefined;
  if (finding.mitigation?.trim() && held.title.startsWith('Remedy: ')) held.title = finding.mitigation.trim();
  held.updatedAt = at;
  project.updatedAt = at;
  project.audit.push({ id: newId('aud'), at, actor, action: 'update', entityType: 'action', entityId: held.id, newValue: input.cost != null ? String(input.cost) : 'cost cleared' });
}
