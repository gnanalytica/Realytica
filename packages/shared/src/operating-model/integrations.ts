/**
 * What another system may read from a firm's projects, and what it is told.
 *
 * Two things leave the product for a machine rather than a person: answers to
 * a request that carries an API key, and events sent to an address the firm
 * registered. This file holds the words both sides share, and the one piece
 * of working out that is the same wherever it runs: which events a saved
 * project has just had.
 *
 * An event is only ever something a person did or the record worked out for
 * itself: a paper filed, a value a named person accepted, a report a person
 * issued, an alert raised or resolved. Nothing a model proposed and nobody
 * accepted is an event.
 */

import type { ProjectAlert } from './alerts';
import type { DdProject } from './types';

/** What a key may read. Nothing here writes: a key cannot change a record. */
export const API_KEY_SCOPES = ['projects:read', 'documents:read', 'reports:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABEL: Record<ApiKeyScope, string> = {
  'projects:read': 'Projects and alerts',
  'documents:read': 'Papers owed',
  'reports:read': 'Issued reports',
};

/** What an endpoint may ask to be told of. */
export const WEBHOOK_EVENTS = ['paper.filed', 'value.accepted', 'alert.raised', 'alert.resolved', 'report.issued'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEventType, string> = {
  'paper.filed': 'Paper filed',
  'value.accepted': 'Value accepted',
  'alert.raised': 'Alert raised',
  'alert.resolved': 'Alert resolved',
  'report.issued': 'Report issued',
};

/** The event a test delivery carries. No endpoint subscribes to it; it is sent only when asked for. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export interface IntegrationEvent {
  /** The same for one happening however often it is worked out, so a receiver can drop a repeat. */
  id: string;
  type: WebhookEventType;
  /** When it happened, as the record has it. */
  at: string;
  projectId: string;
  /** Who did it, as the trail names them. Absent where the record worked it out, as it does an alert. */
  actor?: string;
  data: Record<string, unknown>;
}

function alertData(alert: ProjectAlert): Record<string, unknown> {
  return {
    alert: {
      id: alert.id,
      key: alert.key,
      department: alert.department,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      ...(alert.dueOn ? { dueOn: alert.dueOn } : {}),
      raisedAt: alert.raisedAt,
      ...(alert.resolvedAt ? { resolvedAt: alert.resolvedAt } : {}),
    },
  };
}

/**
 * The events on a project since `since`, read off its trail and its alerts.
 *
 * Read at save time by one observer, in place of a call at each place a
 * thing happens. A line on the trail is written by the request that saves
 * it, so "since a few minutes ago" finds what this save carries; each event's
 * id comes from the line or the alert it was read from, so a second look at
 * the same record gives the same ids and the sender drops the repeats.
 */
export function integrationEventsOf(project: DdProject, since: string): IntegrationEvent[] {
  const out: IntegrationEvent[] = [];
  const filed = new Set<string>();
  for (const line of project.audit ?? []) {
    if (line.at < since) continue;
    const base = { id: `evt_${line.id}`, at: line.at, projectId: project.id, actor: line.actor };
    if (line.entityType === 'evidence') {
      const paper = project.evidence.find((row) => row.id === line.entityId);
      const said = { paper: { id: line.entityId, ...(paper ? { title: paper.title, kind: paper.kind } : {}) } };
      if (line.action === 'create' || line.action === 'upload') {
        // A row made and a file put on it in one go is one paper filed.
        if (filed.has(line.entityId)) continue;
        filed.add(line.entityId);
        out.push({ ...base, type: 'paper.filed', data: said });
      } else if (line.action === 'accept_fact' || line.action === 'accept_fact_corrected') {
        out.push({ ...base, type: 'value.accepted', data: { ...said, ...(line.factKey ? { key: line.factKey } : {}), corrected: line.action === 'accept_fact_corrected' } });
      }
    } else if (line.entityType === 'valuation' && line.action === 'accept_value_inputs') {
      out.push({ ...base, type: 'value.accepted', data: { valuation: { id: line.entityId } } });
    } else if (line.entityType === 'report' && line.action === 'issue_report') {
      const report = project.reports.find((held) => held.id === line.entityId);
      out.push({
        ...base,
        type: 'report.issued',
        data: { report: { id: line.entityId, ...(report ? { kind: report.kind, title: report.title, ...(report.signedBy ? { signedBy: report.signedBy } : {}) } : {}) } },
      });
    } else if (line.entityType === 'cost_report' && line.action === 'issue_cost_report') {
      out.push({ ...base, type: 'report.issued', data: { report: { id: line.entityId, kind: 'cost_report', ...(line.newValue ? { title: line.newValue } : {}) } } });
    }
  }
  for (const alert of project.alerts ?? []) {
    if (alert.resolvedAt) {
      if (alert.resolvedAt >= since) out.push({ id: `evt_${alert.id}_resolved`, type: 'alert.resolved', at: alert.resolvedAt, projectId: project.id, data: alertData(alert) });
    } else if (alert.raisedAt >= since) {
      out.push({ id: `evt_${alert.id}_raised`, type: 'alert.raised', at: alert.raisedAt, projectId: project.id, data: alertData(alert) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
