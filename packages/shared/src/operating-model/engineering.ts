/**
 * The engineering desk: what a firm doing the technical work needs to see.
 *
 * Three readings of one project, each a pure function of the file:
 *
 * - the REQUIREMENT SHEET: every document the checks on the file expect,
 *   grouped by discipline, each one pending, asked for, or in hand;
 * - the SUPPORTING DOCUMENTS: what the client handed over that belongs to a
 *   department this project does not run — a sale deed on an engineering-only
 *   project is still evidence, it just has no home on screen;
 * - the SUMMARY: checks, findings and remedial cost by discipline, for the
 *   charts.
 *
 * Nothing here stores anything. The sheet is read off the evidence rows the
 * checks already seed, so a document filed anywhere — the chat, the vault, a
 * request answered — moves the sheet without anyone ticking a box.
 */

import { SCOPE_LABEL } from './catalogs';
import { DEPARTMENTS, workstreamDefinition, workstreamOfCheck, type DepartmentKey } from './departments';
import { remedialCostSummary } from './remedial';
import { requirementSheet } from './requirement-sheet';
import { projectDepartments } from './team';
import type { CheckResult, DdProject, EvidenceRecord, FindingRecord, FindingSeverity, ScopeKey } from './types';
import { documentWorkstream } from './vault';

export * from './requirement-sheet';

/* ==================================================================== */
/* Supporting documents                                                  */
/* ==================================================================== */

export interface SupportingDocument {
  evidence: EvidenceRecord;
  /** The workstream it would belong to, were its department on. */
  home?: string;
  homeLabel?: string;
}

/**
 * Filed documents that belong to a department this project does not run.
 *
 * A firm doing only the engineering still receives the client's deeds,
 * approvals and valuation. They are read and cited like any other document;
 * they simply have no workstream on screen. Switching the department on later
 * gives each its home again, because the home is read from what the document
 * is, never stored.
 */
export function supportingDocuments(project: DdProject): SupportingDocument[] {
  const enabled = new Set<string>(projectDepartments(project));
  const out: SupportingDocument[] = [];
  for (const evidence of project.evidence) {
    if (!evidence.attachments.length) continue;
    const home = documentWorkstream(project, evidence);
    if (!home) continue;
    const department = home.split('.')[0]!;
    if (enabled.has(department)) continue;
    const ws = workstreamDefinition(home);
    const dept = DEPARTMENTS.find((d) => d.key === department);
    out.push({ evidence, home, homeLabel: ws && dept ? `${dept.label.split(' ')[0]} › ${ws.label}` : undefined });
  }
  return out.sort((a, b) => (b.evidence.attachments[0]?.uploadedAt ?? '').localeCompare(a.evidence.attachments[0]?.uploadedAt ?? ''));
}

/* ==================================================================== */
/* The summary the charts read                                           */
/* ==================================================================== */

const SEVERITIES: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
const OPEN_FINDING: ReadonlySet<string> = new Set(['draft', 'under_review', 'open', 'accepted', 'monitoring']);
const ISSUE: ReadonlySet<CheckResult> = new Set<CheckResult>(['non_compliant', 'partially_compliant', 'missing_evidence', 'unable_to_verify']);

export interface DisciplineSummary {
  scopeKey: ScopeKey;
  label: string;
  checks: { total: number; answered: number; issues: number };
  findings: Record<FindingSeverity, number>;
  openFindings: number;
}

export interface EngineeringSummary {
  disciplines: DisciplineSummary[];
  checks: { total: number; answered: number; issues: number };
  findings: { open: number; bySeverity: Record<FindingSeverity, number> };
  documents: { total: number; received: number; requested: number; pending: number; overdue: number; percent: number };
  remedial: { total: number; currency: string; costed: number; uncosted: number; unbanded: number };
}

function emptySeverities(): Record<FindingSeverity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function findingIsOpen(finding: FindingRecord): boolean {
  return OPEN_FINDING.has(finding.status);
}

/**
 * Checks, findings, documents and remedial cost for one department's work,
 * discipline by discipline. A discipline appears once it has a check on the
 * file or a finding raised against it.
 */
export function engineeringSummary(project: DdProject, department: DepartmentKey = 'construction', now?: string): EngineeringSummary {
  const rows = new Map<ScopeKey, DisciplineSummary>();
  const row = (scopeKey: ScopeKey): DisciplineSummary => {
    let held = rows.get(scopeKey);
    if (!held) {
      held = { scopeKey, label: SCOPE_LABEL[scopeKey] ?? scopeKey, checks: { total: 0, answered: 0, issues: 0 }, findings: emptySeverities(), openFindings: 0 };
      rows.set(scopeKey, held);
    }
    return held;
  };
  const scopesHere = new Set<ScopeKey>();
  for (const assessment of project.assessments ?? []) {
    if (assessment.status === 'archived') continue;
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (workstreamOfCheck(check.definitionId).split('.')[0] !== department) continue;
        scopesHere.add(scope.scopeKey);
        const r = row(scope.scopeKey);
        r.checks.total += 1;
        if (check.result !== 'pending') r.checks.answered += 1;
        if (ISSUE.has(check.result)) r.checks.issues += 1;
      }
    }
  }
  for (const finding of project.findings) {
    if (!findingIsOpen(finding)) continue;
    // A finding belongs here when its discipline has checks here, or it was
    // raised from one of this department's checks.
    const fromCheck = finding.sourceCheckId
      ? (project.assessments ?? []).flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.id === finding.sourceCheckId)
      : undefined;
    const here = scopesHere.has(finding.discipline) || (fromCheck ? workstreamOfCheck(fromCheck.definitionId).split('.')[0] === department : false);
    if (!here) continue;
    const r = row(finding.discipline);
    r.findings[finding.severity] += 1;
    r.openFindings += 1;
  }
  const disciplines = [...rows.values()].sort((a, b) => b.openFindings - a.openFindings || a.label.localeCompare(b.label));
  const bySeverity = emptySeverities();
  for (const d of disciplines) for (const s of SEVERITIES) bySeverity[s] += d.findings[s];
  const sheet = requirementSheet(project, { department, now });
  const cost = remedialCostSummary(project);
  return {
    disciplines,
    checks: {
      total: disciplines.reduce((n, d) => n + d.checks.total, 0),
      answered: disciplines.reduce((n, d) => n + d.checks.answered, 0),
      issues: disciplines.reduce((n, d) => n + d.checks.issues, 0),
    },
    findings: { open: disciplines.reduce((n, d) => n + d.openFindings, 0), bySeverity },
    documents: { total: sheet.total, received: sheet.received, requested: sheet.requested, pending: sheet.pending, overdue: sheet.overdue, percent: sheet.percent },
    remedial: { total: cost.total, currency: cost.currency, costed: cost.rows.reduce((n, r) => n + r.costed, 0), uncosted: cost.uncosted, unbanded: cost.unbanded },
  };
}

export const FINDING_SEVERITIES = SEVERITIES;
