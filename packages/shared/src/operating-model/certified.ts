/**
 * Certified reports: what a named professional signs, and when it may need
 * revisiting.
 *
 * A certified report — a title opinion, a valuation, a progress certificate —
 * is the figure of record for its workstream. The quick assessment keeps
 * running beside it, and when later evidence moves the estimate far enough
 * from what was certified, the report is flagged for its signer to revisit:
 *
 * - a figure more than 10% from the certified one
 * - progress more than 5 points from the certified progress
 * - a verdict worse than the certified one: a new condition or blocker
 */

import type { DdProject } from './types';
import { recordAuditEvent } from './operations';
import { workstreamDefinition } from './departments';
import { quickAssessment, snapshotOf, type QuickSnapshot, type QuickVerdict } from './quick-assessments';

export interface CertifiedSigner {
  name: string;
  /** "Advocate", "Registered Valuer", "Structural Engineer". */
  profession: string;
  /** Enrolment, IBBI or council registration number, as the report states it. */
  registration?: string;
  firm?: string;
}

export interface CertifiedReport {
  id: string;
  workstream: string;
  title: string;
  /** The uploaded report on the document vault. */
  evidenceId: string;
  signer: CertifiedSigner;
  issuedOn?: string;
  scope?: string;
  /** The certified figure, when the report states one: a value, or progress. */
  figure?: { value: number; unit: 'INR' | '%' };
  verdict?: Exclude<QuickVerdict, 'insufficient'>;
  conditions: string[];
  /** The quick assessment when the report was filed, for the record. */
  baseline: QuickSnapshot;
  status: 'current' | 'superseded';
  revisit?: { flaggedAt: string; reasons: string[]; acknowledgedAt?: string; acknowledgedBy?: string };
  createdAt: string;
  createdBy: string;
}

export interface FileCertifiedInput {
  workstream: string;
  title: string;
  evidenceId: string;
  signer: CertifiedSigner;
  issuedOn?: string;
  scope?: string;
  figure?: { value: number; unit: 'INR' | '%' };
  verdict?: Exclude<QuickVerdict, 'insufficient'>;
  conditions?: string[];
}

/** Figures this far apart call for the report to be revisited. */
export const REVISIT_FIGURE_SHARE = 0.1;
/** Progress this many points apart does too. */
export const REVISIT_PROGRESS_POINTS = 5;

const VERDICT_RANK: Record<QuickVerdict, number> = { clear: 0, conditions: 1, blockers: 2, insufficient: -1 };

export function fileCertifiedReport(project: DdProject, input: FileCertifiedInput, actor: string): CertifiedReport {
  if (!workstreamDefinition(input.workstream)) throw new Error('Unknown workstream.');
  if (!project.evidence.some((e) => e.id === input.evidenceId)) throw new Error('Upload the signed report to the vault first.');
  if (!input.signer.name.trim() || !input.signer.profession.trim()) throw new Error('A certified report names who signed it and their profession.');
  if (!input.figure && !input.verdict) throw new Error('A certified report states a figure or a conclusion.');
  const at = new Date().toISOString();
  for (const held of project.certifiedReports ?? []) {
    if (held.workstream === input.workstream && held.status === 'current') held.status = 'superseded';
  }
  const report: CertifiedReport = {
    id: `crt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    workstream: input.workstream,
    title: input.title.trim(),
    evidenceId: input.evidenceId,
    signer: { name: input.signer.name.trim(), profession: input.signer.profession.trim(), ...(input.signer.registration ? { registration: input.signer.registration.trim() } : {}), ...(input.signer.firm ? { firm: input.signer.firm.trim() } : {}) },
    ...(input.issuedOn ? { issuedOn: input.issuedOn } : {}),
    ...(input.scope ? { scope: input.scope.trim() } : {}),
    ...(input.figure ? { figure: input.figure } : {}),
    ...(input.verdict ? { verdict: input.verdict } : {}),
    conditions: (input.conditions ?? []).map((c) => c.trim()).filter(Boolean),
    baseline: snapshotOf(quickAssessment(project, input.workstream)),
    status: 'current',
    createdAt: at,
    createdBy: actor,
  };
  project.certifiedReports = [...(project.certifiedReports ?? []), report];
  const row = project.evidence.find((e) => e.id === input.evidenceId);
  if (row) row.used = true;
  recordAuditEvent(project, { actor, action: 'file_certified_report', entityType: 'certified_report', entityId: report.id, newValue: `${report.title} — ${report.signer.name}, ${report.signer.profession}` });
  return report;
}

/** Why a certified report may need revisiting, given where the estimate stands now. */
export function revisitReasons(report: CertifiedReport, current: QuickSnapshot): string[] {
  const reasons: string[] = [];
  if (report.figure && current.figure && report.figure.unit === current.figure.unit) {
    if (report.figure.unit === '%') {
      const gap = Math.abs(current.figure.value - report.figure.value);
      if (gap > REVISIT_PROGRESS_POINTS) reasons.push(`Progress now reads ${current.figure.value}% against ${report.figure.value}% certified.`);
    } else if (report.figure.value > 0) {
      const share = Math.abs(current.figure.value / report.figure.value - 1);
      if (share > REVISIT_FIGURE_SHARE) reasons.push(`The estimate is now ${Math.round(share * 100)}% from the certified figure.`);
    }
  }
  if (report.verdict && current.verdict !== 'insufficient' && VERDICT_RANK[current.verdict] > VERDICT_RANK[report.verdict]) {
    reasons.push(current.verdict === 'blockers' ? 'A blocker has appeared since it was certified.' : 'A new condition has appeared since it was certified.');
  }
  return reasons;
}

/**
 * Re-read every current certified report against its workstream's estimate,
 * flag the ones that need revisiting, and return those newly flagged.
 */
export function evaluateRevisits(project: DdProject, now = new Date()): CertifiedReport[] {
  const flagged: CertifiedReport[] = [];
  for (const report of project.certifiedReports ?? []) {
    if (report.status !== 'current') continue;
    const reasons = revisitReasons(report, snapshotOf(quickAssessment(project, report.workstream, now)));
    if (!reasons.length) {
      if (report.revisit && !report.revisit.acknowledgedAt) delete report.revisit;
      continue;
    }
    const same = report.revisit && report.revisit.reasons.join('|') === reasons.join('|');
    if (!same) {
      report.revisit = { flaggedAt: now.toISOString(), reasons };
      flagged.push(report);
    }
  }
  return flagged;
}

export function acknowledgeRevisit(project: DdProject, reportId: string, actor: string): CertifiedReport {
  const report = (project.certifiedReports ?? []).find((r) => r.id === reportId);
  if (!report?.revisit) throw new Error('Nothing to acknowledge on that report.');
  report.revisit.acknowledgedAt = new Date().toISOString();
  report.revisit.acknowledgedBy = actor;
  recordAuditEvent(project, { actor, action: 'acknowledge_revisit', entityType: 'certified_report', entityId: report.id, newValue: report.revisit.reasons.join(' ') });
  return report;
}

/** The current certified report for a workstream. */
export function currentCertified(project: DdProject, workstream: string): CertifiedReport | undefined {
  return (project.certifiedReports ?? []).find((r) => r.workstream === workstream && r.status === 'current');
}

/* ==================================================================== */
/* Reading a signed report out                                           */
/* ==================================================================== */

/** What the vault's reading of a signed report proposes, for a person to confirm. */
export interface CertifiedReadout {
  workstream?: string;
  title: string;
  signer: { name?: string; profession?: string; registration?: string; firm?: string };
  issuedOn?: string;
  scope?: string;
  figure?: { value: number; unit: 'INR' | '%' };
  verdict?: Exclude<QuickVerdict, 'insufficient'>;
  conditions: string[];
  /** Where each proposed value was read, so the form can show its words. */
  sources: Array<{ field: string; page?: number; quote?: string }>;
}

/** The profession that signs each kind of certified report, as the reader recognises it. */
const SIGNER_BY_TYPE: Record<string, { workstream: string; profession: string }> = {
  'Legal opinion on title': { workstream: 'legal.title', profession: 'Advocate' },
  'Valuation report': { workstream: 'finance.valuation', profession: 'Registered Valuer' },
  'Progress certificate': { workstream: 'construction.progress', profession: 'Independent Engineer' },
};

/**
 * Propose a certified report from a document already in the vault, from what
 * the reader found on it. Nothing is filed: the person checks every value
 * against the page before it becomes the figure of record.
 */
export function certifiedReadout(project: DdProject, evidenceId: string): CertifiedReadout {
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  if (!evidence) throw new Error('No document by that id.');
  const facts = evidence.facts ?? [];
  const fact = (...keys: string[]) => facts.find((f) => keys.includes(f.key));
  const sources: CertifiedReadout['sources'] = [];
  const take = (field: string, f: ReturnType<typeof fact>) => {
    if (f) sources.push({ field, page: f.page, quote: f.quote });
    return f;
  };
  const kind = evidence.documentType ? SIGNER_BY_TYPE[evidence.documentType] : undefined;
  const signerName = take('signer.name', fact('advocate', 'valuer', 'engineer', 'signed_by'));
  const registration = take('signer.registration', fact('enrolment_number', 'ibbi_registration', 'registration_number'));
  const issued = take('issuedOn', fact('issued_on', 'report_date', 'valuation_date'));
  const scope = take('scope', fact('subject', 'covered_survey_numbers'));
  const value = take('figure', fact('market_value', 'fair_value', 'value'));
  const percent = take('figure', fact('percent_complete', 'progress_percent'));
  const conclusion = take('verdict', fact('title_conclusion'));
  const conditions = take('conditions', fact('opinion_conditions'));

  let verdict: CertifiedReadout['verdict'];
  if (conclusion) {
    const said = String(conclusion.value);
    verdict = said === 'not clear' ? 'blockers' : said.includes('subject') ? 'conditions' : 'clear';
  }
  const figure = typeof value?.value === 'number' ? { value: value.value, unit: 'INR' as const } : typeof percent?.value === 'number' ? { value: percent.value, unit: '%' as const } : undefined;
  return {
    workstream: kind?.workstream ?? evidence.workstream,
    title: evidence.title,
    signer: {
      ...(signerName ? { name: String(signerName.value) } : {}),
      ...(kind ? { profession: kind.profession } : {}),
      ...(registration ? { registration: String(registration.value) } : {}),
    },
    ...(issued && typeof issued.value === 'string' ? { issuedOn: issued.value.slice(0, 10) } : {}),
    ...(scope ? { scope: String(scope.display ?? scope.value) } : {}),
    ...(figure ? { figure } : {}),
    ...(verdict ? { verdict } : {}),
    conditions: conditions ? [String(conditions.value)] : [],
    sources,
  };
}
