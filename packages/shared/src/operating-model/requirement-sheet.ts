/**
 * The requirement sheet: every document the checks on the file expect, by
 * discipline, each one pending, asked for, or in hand.
 *
 * In its own module because the report reads it too, and the report resolver
 * may import nothing that reaches back into the operations.
 */

import { SCOPE_LABEL } from './catalogs';
import { workstreamOfCheck, type DepartmentKey } from './departments';
import type { CheckInstance, CheckResult, DdProject, EvidenceRecord, ProjectRequest, ScopeKey } from './types';

/* ==================================================================== */
/* The requirement sheet                                                 */
/* ==================================================================== */

/** Where one expected document stands. */
export type RequirementStatus = 'pending' | 'requested' | 'received';

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  pending: 'Not asked',
  requested: 'Asked for',
  received: 'In hand',
};

export interface RequirementItem {
  /** The evidence row that stands for this document; absent only on a file older than the seeding. */
  evidenceId?: string;
  title: string;
  scopeKey: ScopeKey;
  status: RequirementStatus;
  /** The checks that need it. */
  checks: Array<{ id: string; title: string; result: CheckResult; where: { ddId: string; scopeId: string; checkId: string } }>;
  /** Who was asked, and by when, when a request is out for it. */
  askedOf?: string;
  dueAt?: string;
  overdue?: boolean;
  requestId?: string;
  /** The file that answered it. */
  fileName?: string;
  receivedAt?: string;
}

export interface RequirementGroup {
  /** The discipline as the checks name it: Structural, MEP, Statutory. */
  key: string;
  scopeKey: ScopeKey;
  label: string;
  items: RequirementItem[];
  received: number;
  requested: number;
  pending: number;
}

export interface RequirementSheet {
  groups: RequirementGroup[];
  total: number;
  received: number;
  requested: number;
  pending: number;
  overdue: number;
  /** Whole percent in hand; 0 on an empty sheet. */
  percent: number;
}

const HELD: ReadonlySet<string> = new Set(['received', 'validated', 'used']);

function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function outstandingRequest(project: DdProject, evidenceId: string | undefined): ProjectRequest | undefined {
  if (!evidenceId) return undefined;
  return (project.requests ?? []).find((r) => r.evidenceId === evidenceId && (r.status === 'sent' || r.status === 'draft'));
}

/** The row standing for one expected document on one check. */
function rowFor(project: DdProject, check: CheckInstance, title: string): EvidenceRecord | undefined {
  const want = fold(title);
  const linked = project.evidence.filter((e) => e.checkIds.includes(check.id) || check.evidenceIds.includes(e.id));
  // The seeded row carries the expected title; a filed document that answered
  // it was linked to the check instead, under its own name.
  return (
    linked.find((e) => fold(e.title) === want) ??
    linked.find((e) => HELD.has(e.status) && e.attachments.length > 0 && (fold(e.title).includes(want) || want.includes(fold(e.title)))) ??
    project.evidence.find((e) => fold(e.title) === want && e.scopeInstanceIds.includes(check.scopeInstanceId))
  );
}

/**
 * Every document the checks on the file expect, once each per discipline —
 * Architecture, Structural, MEP, Statutory — which is the check's section.
 *
 * `department` narrows it to the checks one department holds — an
 * engineering firm's sheet is the Construction department's, whatever else
 * the project runs. Two checks wanting the same paper in the same discipline
 * are one line, naming both.
 */
export function requirementSheet(project: DdProject, opts: { department?: DepartmentKey; now?: string } = {}): RequirementSheet {
  const today = (opts.now ?? new Date().toISOString()).slice(0, 10);
  // Grouped the way the list is sent: by discipline, which is the check's section.
  const byScope = new Map<string, { scopeKey: ScopeKey; items: Map<string, RequirementItem> }>();
  for (const assessment of project.assessments ?? []) {
    if (assessment.status === 'archived') continue;
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (opts.department && workstreamOfCheck(check.definitionId).split('.')[0] !== opts.department) continue;
        for (const title of check.expectedEvidence) {
          const section = check.section?.trim() || SCOPE_LABEL[scope.scopeKey] || scope.scopeKey;
          const group = byScope.get(section) ?? { scopeKey: scope.scopeKey, items: new Map<string, RequirementItem>() };
          byScope.set(section, group);
          const items = group.items;
          const key = fold(title);
          const row = rowFor(project, check, title);
          const held = row ? HELD.has(row.status) : false;
          const request = outstandingRequest(project, row?.id);
          const status: RequirementStatus = held ? 'received' : row?.status === 'requested' || request?.status === 'sent' ? 'requested' : 'pending';
          const ref = { id: check.id, title: check.title, result: check.result, where: { ddId: assessment.id, scopeId: scope.id, checkId: check.id } };
          const existing = items.get(key);
          if (existing) {
            if (!existing.checks.some((c) => c.id === check.id)) existing.checks.push(ref);
            // In hand on any check is in hand: the paper is the same paper.
            if (status === 'received' && existing.status !== 'received') {
              existing.status = 'received';
              existing.evidenceId = row?.id ?? existing.evidenceId;
              existing.fileName = row?.attachments[0]?.fileName ?? row?.fileName;
              existing.receivedAt = row?.attachments[0]?.uploadedAt ?? row?.updatedAt;
            }
            continue;
          }
          const dueAt = status === 'requested' ? request?.dueAt : undefined;
          items.set(key, {
            evidenceId: row?.id,
            title,
            scopeKey: scope.scopeKey,
            status,
            checks: [ref],
            askedOf: status === 'requested' ? (request?.recipient ?? row?.owner) : undefined,
            dueAt,
            overdue: dueAt ? dueAt.slice(0, 10) < today : undefined,
            requestId: status === 'requested' ? request?.id : undefined,
            fileName: held ? (row?.attachments[0]?.fileName ?? row?.fileName) : undefined,
            receivedAt: held ? (row?.attachments[0]?.uploadedAt ?? row?.updatedAt) : undefined,
          });
        }
      }
    }
  }
  const groups: RequirementGroup[] = [...byScope.entries()]
    .map(([section, { scopeKey, items }]) => {
      const list = [...items.values()];
      return {
        key: section,
        scopeKey,
        label: section,
        items: list,
        received: list.filter((i) => i.status === 'received').length,
        requested: list.filter((i) => i.status === 'requested').length,
        pending: list.filter((i) => i.status === 'pending').length,
      };
    })
    .filter((g) => g.items.length)
    .sort((a, b) => a.label.localeCompare(b.label));
  const all = groups.flatMap((g) => g.items);
  const received = all.filter((i) => i.status === 'received').length;
  return {
    groups,
    total: all.length,
    received,
    requested: all.filter((i) => i.status === 'requested').length,
    pending: all.filter((i) => i.status === 'pending').length,
    overdue: all.filter((i) => i.overdue).length,
    percent: all.length ? Math.round((received / all.length) * 100) : 0,
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The sheet as a spreadsheet a client can be sent: one line per document. */
export function requirementSheetCsv(sheet: RequirementSheet): string {
  const lines = [['Discipline', 'Document', 'Status', 'Asked of', 'Due', 'Needed for'].join(',')];
  for (const group of sheet.groups) {
    for (const item of group.items) {
      lines.push(
        [group.label, item.title, REQUIREMENT_STATUS_LABEL[item.status], item.askedOf ?? '', item.dueAt?.slice(0, 10) ?? '', item.checks.map((c) => c.title).join('; ')]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The same list as plain text, for a message or an email. */
export function requirementSheetText(sheet: RequirementSheet, opts: { only?: RequirementStatus } = {}): string {
  const out: string[] = [];
  for (const group of sheet.groups) {
    const items = group.items.filter((i) => !opts.only || i.status === opts.only);
    if (!items.length) continue;
    out.push(`${group.label}`);
    for (const item of items) out.push(`  [${item.status === 'received' ? 'x' : ' '}] ${item.title}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}
