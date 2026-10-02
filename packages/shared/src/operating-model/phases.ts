/**
 * What happened in each phase of a project's life.
 *
 * Changing stage hides nothing: every document, DD, check and finding stays
 * on the file in every phase. What was missing was a way to look back by
 * phase — "what did we file during Acquisition, and what did it find?" —
 * because nothing said which phase a record belonged to.
 *
 * Every record carries when it happened, and the stage history says which
 * phase the project was in at every moment, so the phase is read from the
 * two together rather than stamped on each record: a stamp would say the
 * same thing, and would be missing from every record written before it
 * existed. A project can go back to an earlier phase, so a phase can have
 * more than one span.
 */

import type { CheckResult, DdProject, LifecycleStage } from './types';
import { STAGES, SUB_STAGE_LABEL, stageAt, stageOf, type StageKey } from './departments';

export interface PhaseSpan {
  from: string;
  /** Absent while the project is still in it. */
  to?: string;
}

/** A whole stage — Construction — or one step inside it — Testing & commissioning. */
export type PhaseRef = { kind: 'stage'; key: StageKey } | { kind: 'step'; key: LifecycleStage };

function within(ref: PhaseRef, stage: LifecycleStage): boolean {
  return ref.kind === 'step' ? stage === ref.key : stageOf(stage) === ref.key;
}

export function phaseLabel(ref: PhaseRef): string {
  return ref.kind === 'step' ? SUB_STAGE_LABEL[ref.key] : STAGES.find((s) => s.key === ref.key)?.label ?? ref.key;
}

/** The project's own stage changes, oldest first. */
function projectStages(project: DdProject) {
  return project.stageHistory
    .filter((s) => s.subject === 'project')
    .slice()
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}

/** The lifecycle step the project was at at a moment. Before its first recorded stage, the first one. */
export function phaseAt(project: DdProject, at: string): LifecycleStage {
  return stageAt(project, at);
}

/** When the project was in a stage or step. Empty for one it never reached. */
export function phaseSpans(project: DdProject, ref: PhaseRef): PhaseSpan[] {
  const history = projectStages(project);
  const spans: PhaseSpan[] = [];
  let open: PhaseSpan | null = null;
  for (const entry of history) {
    const inPhase = within(ref, entry.stage);
    if (inPhase && !open) {
      open = { from: entry.effectiveAt };
      spans.push(open);
    } else if (!inPhase && open) {
      open.to = entry.effectiveAt;
      open = null;
    }
  }
  if (!history.length && within(ref, project.currentStage)) spans.push({ from: project.createdAt });
  return spans;
}

export interface PhaseItem {
  id: string;
  title: string;
  at: string;
  /** A short note: a check's result, a finding's severity, a document's file name. */
  detail?: string;
}

export interface PhaseRecord {
  phase: PhaseRef;
  label: string;
  spans: PhaseSpan[];
  documents: PhaseItem[];
  assessments: PhaseItem[];
  checks: Array<PhaseItem & { result: CheckResult }>;
  findings: PhaseItem[];
  risks: PhaseItem[];
  actions: PhaseItem[];
  decisions: PhaseItem[];
  reports: PhaseItem[];
}

const newestFirst = <T extends { at: string }>(rows: T[]) => rows.sort((a, b) => b.at.localeCompare(a.at));

/**
 * Everything done while the project was in one phase: documents filed, DDs
 * started, checks recorded, and what they raised. A document counts in the
 * phase its file arrived, a check in the phase its result was last recorded.
 */
export function phaseRecord(project: DdProject, phase: PhaseRef): PhaseRecord {
  const label = phaseLabel(phase);
  const inPhase = (at: string | undefined) => Boolean(at) && within(phase, phaseAt(project, at!));

  const documents: PhaseItem[] = [];
  for (const e of project.evidence) {
    const files = (e.attachments ?? []).filter((a) => inPhase(a.uploadedAt));
    if (!files.length) continue;
    documents.push({ id: e.id, title: e.title, at: files[0]!.uploadedAt, detail: files.map((f) => f.fileName).join(', ') });
  }

  const checks: PhaseRecord['checks'] = [];
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      for (const c of s.checks) {
        if (c.result === 'pending' || !inPhase(c.updatedAt)) continue;
        checks.push({ id: c.id, title: c.title, at: c.updatedAt, result: c.result, detail: a.name });
      }
    }
  }

  return {
    phase,
    label,
    spans: phaseSpans(project, phase),
    documents: newestFirst(documents),
    assessments: newestFirst(project.assessments.filter((a) => inPhase(a.createdAt)).map((a) => ({ id: a.id, title: a.name, at: a.createdAt }))),
    checks: newestFirst(checks),
    findings: newestFirst(project.findings.filter((f) => inPhase(f.createdAt)).map((f) => ({ id: f.id, title: f.title, at: f.createdAt, detail: f.severity }))),
    risks: newestFirst(project.risks.filter((r) => inPhase(r.createdAt)).map((r) => ({ id: r.id, title: r.title, at: r.createdAt }))),
    actions: newestFirst(project.actions.filter((x) => inPhase(x.createdAt)).map((x) => ({ id: x.id, title: x.title, at: x.createdAt }))),
    decisions: newestFirst(project.decisions.filter((d) => inPhase(d.decidedAt ?? d.createdAt)).map((d) => ({ id: d.id, title: d.title, at: d.decidedAt ?? d.createdAt }))),
    reports: newestFirst(project.reports.filter((r) => inPhase(r.generatedAt)).map((r) => ({ id: r.id, title: r.title, at: r.generatedAt }))),
  };
}

/** How much a phase holds, for its place on the lifecycle strip. */
export function phaseCount(record: PhaseRecord): number {
  return (
    record.documents.length + record.assessments.length + record.checks.length + record.findings.length
    + record.risks.length + record.actions.length + record.decisions.length + record.reports.length
  );
}
