/**
 * Alerts: what someone on the project should hear about without looking.
 *
 * Read from the project's state each time it changes — an approval expiring
 * or lapsed, a certified report flagged for revisiting, work logged before
 * the approvals that allow it, a milestone running late, a serious issue from
 * site. Each condition has a key, so it is raised once and resolved when the
 * condition clears; a new one is what goes out by email and to phones.
 */

import type { DdProject } from './types';
import type { DepartmentKey } from './departments';
import { approvalsRegister, constructionGate } from './approvals';
import { progressSummary } from './progress';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface ProjectAlert {
  id: string;
  /** The condition it stands for: raised once, resolved when it clears. */
  key: string;
  department: DepartmentKey;
  workstream?: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  dueOn?: string;
  raisedAt: string;
  resolvedAt?: string;
  /** Who has seen it, by email. */
  readBy: string[];
  /** When it went out by email and push, if it did. */
  sentAt?: string;
}

interface Condition {
  key: string;
  department: DepartmentKey;
  workstream?: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  dueOn?: string;
}

/** Every condition worth an alert right now. */
export function alertConditions(project: DdProject, now = new Date()): Condition[] {
  const out: Condition[] = [];
  for (const line of approvalsRegister(project, now)) {
    if (line.status === 'expiring' || line.status === 'expired') {
      const until = line.held.map((h) => h.validUntil).filter(Boolean).sort()[0];
      out.push({
        key: `approval:${line.kind.key}:${line.status}:${until ?? ''}`,
        department: 'legal',
        workstream: 'legal.approvals',
        severity: line.status === 'expired' ? 'critical' : 'warning',
        title: `${line.kind.label} ${line.status === 'expired' ? 'has lapsed' : 'is expiring'}`,
        detail: line.say,
        ...(until ? { dueOn: until } : {}),
      });
    } else if (line.status === 'missing') {
      out.push({ key: `approval:${line.kind.key}:missing`, department: 'legal', workstream: 'legal.approvals', severity: 'warning', title: `${line.kind.label} is not on file`, detail: line.say });
    }
  }
  for (const report of project.certifiedReports ?? []) {
    if (report.status === 'current' && report.revisit && !report.revisit.acknowledgedAt) {
      out.push({
        key: `revisit:${report.id}:${report.revisit.flaggedAt}`,
        department: report.workstream.split('.')[0] as DepartmentKey,
        workstream: report.workstream,
        severity: 'warning',
        title: `${report.title} may need revisiting`,
        detail: report.revisit.reasons.join(' '),
      });
    }
  }
  const gate = constructionGate(project, now);
  if (!gate.open && (project.siteLog ?? []).length > 0) {
    out.push({ key: 'gate:construction', department: 'construction', workstream: 'construction.progress', severity: 'critical', title: 'Work logged without the approvals that allow it', detail: `Not on file: ${gate.missing.join(', ')}.` });
  }
  for (const late of progressSummary(project, now).late) {
    out.push({ key: `late:${late.name}:${late.plannedFinish}`, department: 'construction', workstream: 'construction.progress', severity: 'warning', title: `${late.name} is late`, detail: `Planned to finish ${late.plannedFinish}; at ${late.percent}%.`, dueOn: late.plannedFinish });
  }
  for (const entry of project.siteLog ?? []) {
    entry.issues.forEach((issue, i) => {
      if (issue.severity !== 'high') return;
      out.push({ key: `issue:${entry.id}:${i}`, department: 'construction', workstream: 'construction.quality', severity: 'critical', title: `From site: ${issue.title}`, detail: `${entry.author}, ${entry.date}${issue.note ? ` — ${issue.note}` : ''}` });
    });
  }
  return out;
}

/**
 * Bring the project's alerts up to date: raise what is new, resolve what has
 * cleared. Returns the alerts raised now, for email and push.
 */
export function syncAlerts(project: DdProject, now = new Date()): ProjectAlert[] {
  const at = now.toISOString();
  const conditions = alertConditions(project, now);
  const live = new Set(conditions.map((c) => c.key));
  const held = project.alerts ?? [];
  for (const alert of held) {
    if (!alert.resolvedAt && !live.has(alert.key)) alert.resolvedAt = at;
  }
  const raised: ProjectAlert[] = [];
  for (const c of conditions) {
    const open = held.find((a) => a.key === c.key && !a.resolvedAt);
    if (open) continue;
    const alert: ProjectAlert = { id: `alr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, ...c, raisedAt: at, readBy: [] };
    held.push(alert);
    raised.push(alert);
  }
  project.alerts = held.slice(-500);
  return raised;
}

export function markAlertsRead(project: DdProject, ids: readonly string[] | 'all', reader: string): number {
  let n = 0;
  for (const alert of project.alerts ?? []) {
    if ((ids === 'all' || ids.includes(alert.id)) && !alert.readBy.includes(reader)) {
      alert.readBy.push(reader);
      n += 1;
    }
  }
  return n;
}

/** Open alerts, worst and newest first. */
export function openAlerts(project: DdProject): ProjectAlert[] {
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return (project.alerts ?? []).filter((a) => !a.resolvedAt).sort((a, b) => order[a.severity] - order[b.severity] || b.raisedAt.localeCompare(a.raisedAt));
}
