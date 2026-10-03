/**
 * Engagements, and the one project record every engagement draws on.
 *
 * An engagement is a piece of work a client commissions — "Technical DD for
 * the lender", "Acquisition screening for the developer" — with its client,
 * fee, due date and stage. It draws on workstreams; it does not own checks.
 * The checks live once, in the project record, grouped by workstream, so the
 * title check a lender's engagement needs is the same one the developer's
 * screening answered.
 */

import type { CheckInstance, DdAssessment, DdProject, EngagementStage, ReportKind } from './types';
import { addScopeToAssessment, createAssessment, recordAuditEvent } from './operations';
import { SCOPE_KEYS } from './catalogs';
import { WORKSTREAMS, scopesOfWorkstreams, workstreamOfCheck } from './departments';
import type { ScopeKey } from './types';

/* ==================================================================== */
/* The project record                                                    */
/* ==================================================================== */

/** Its name, as the record the engines read — never shown as an engagement. */
export const PROJECT_RECORD_NAME = 'Project record';

/** The assessment that holds every check on the project, one of each. */
export function projectRecord(project: DdProject): DdAssessment | undefined {
  return (project.assessments ?? []).find((a) => a.name === PROJECT_RECORD_NAME) ?? project.assessments?.[0];
}

/**
 * Make sure the checks these workstreams need are on the project record,
 * creating the record if the project has none. Only the scopes those
 * workstreams draw on are added, so opening Title work does not seed every
 * placeholder the whole library would.
 */
export function ensureWorkstreamChecks(project: DdProject, workstreams: readonly string[], actor: string): DdAssessment | undefined {
  const scopes = scopesOfWorkstreams(workstreams).filter((s): s is ScopeKey => (SCOPE_KEYS as readonly string[]).includes(s));
  if (!scopes.length) return undefined;
  const held = new Set(allChecks(project).map((c) => workstreamOfCheck(c.definitionId)));
  if (workstreams.every((w) => held.has(w))) return projectRecord(project);
  let record = (project.assessments ?? []).find((a) => a.name === PROJECT_RECORD_NAME);
  if (!record) {
    record = createAssessment(project, { ddType: 'custom', name: PROJECT_RECORD_NAME, owner: actor, targetType: 'project', extraScopes: scopes }, actor);
  }
  for (const key of scopes) {
    if (!record.scopes.some((s) => s.scopeKey === key)) addScopeToAssessment(project, record.id, key, actor);
  }
  return record;
}

/** Every check on the project, wherever an older file put it. */
export function allChecks(project: DdProject): CheckInstance[] {
  return (project.assessments ?? []).flatMap((a) => a.scopes.flatMap((s) => s.checks));
}

/** The checks in one workstream. */
export function workstreamChecks(project: DdProject, workstream: string): CheckInstance[] {
  return allChecks(project).filter((c) => workstreamOfCheck(c.definitionId) === workstream);
}

/* ==================================================================== */
/* Engagements                                                           */
/* ==================================================================== */

export type EngagementKind = 'acquisition_screening' | 'title_dd' | 'technical_dd' | 'lender_monitoring' | 'valuation' | 'custom';

export interface EngagementKindDefinition {
  label: string;
  purpose: string;
  workstreams: string[];
  reportKind: ReportKind;
}

export const ENGAGEMENT_KINDS: Record<EngagementKind, EngagementKindDefinition> = {
  acquisition_screening: {
    label: 'Acquisition screening',
    purpose: 'Whether to buy the land: title, approvals and an indicative value.',
    workstreams: ['legal.title', 'legal.approvals', 'finance.valuation'],
    reportKind: 'red_flag',
  },
  title_dd: {
    label: 'Title due diligence',
    purpose: 'The title chain, encumbrances and litigation, ending in an opinion.',
    workstreams: ['legal.title'],
    reportKind: 'detailed_dd',
  },
  technical_dd: {
    label: 'Technical due diligence',
    purpose: 'Whether what is built, or being built, is sound and as approved.',
    workstreams: ['construction.quality', 'construction.progress', 'construction.site', 'legal.approvals'],
    reportKind: 'detailed_dd',
  },
  lender_monitoring: {
    label: 'Lender’s independent engineer',
    purpose: 'Progress and cost certified before each loan drawdown.',
    workstreams: ['construction.progress', 'construction.quality', 'legal.approvals', 'finance.budget'],
    reportKind: 'executive_dd',
  },
  valuation: {
    label: 'Indicative valuation',
    purpose: 'What the site or project is worth, with the drivers and compliance behind it.',
    workstreams: ['finance.valuation', 'legal.title', 'legal.approvals'],
    reportKind: 'indicative_valuation',
  },
  custom: {
    label: 'Custom engagement',
    purpose: 'Workstreams chosen for this client.',
    workstreams: [],
    reportKind: 'executive_dd',
  },
};

export interface Engagement {
  id: string;
  title: string;
  kind: EngagementKind;
  stage: EngagementStage;
  /** Who the work is for: "Canara Bank, Jayanagar", or the developer by name. */
  client?: string;
  fee?: number;
  /** Who leads it, as they sign. */
  lead?: string;
  dueDate?: string;
  /** What was asked for, in the client's words. */
  scope?: string;
  /** The workstreams it draws on; its checks are theirs. */
  workstreams: string[];
  reportIds: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface CreateEngagementInput {
  kind: EngagementKind;
  title?: string;
  client?: string;
  fee?: number;
  lead?: string;
  dueDate?: string;
  scope?: string;
  workstreams?: string[];
}

function newId(): string {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEngagement(project: DdProject, input: CreateEngagementInput, actor: string): Engagement {
  const def = ENGAGEMENT_KINDS[input.kind];
  if (!def) throw new Error('Unknown kind of engagement.');
  const workstreams = [...new Set(input.workstreams?.length ? input.workstreams : def.workstreams)].filter((w) => WORKSTREAMS.some((x) => x.key === w));
  if (!workstreams.length) throw new Error('An engagement draws on at least one workstream.');
  ensureWorkstreamChecks(project, workstreams, actor);
  const at = new Date().toISOString();
  const engagement: Engagement = {
    id: newId(),
    title: (input.title ?? def.label).trim(),
    kind: input.kind,
    stage: 'intake',
    ...(input.client ? { client: input.client.trim() } : {}),
    ...(input.fee !== undefined ? { fee: input.fee } : {}),
    ...(input.lead ? { lead: input.lead.trim() } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.scope ? { scope: input.scope.trim() } : {}),
    workstreams,
    reportIds: [],
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };
  project.engagements = [...(project.engagements ?? []), engagement];
  recordAuditEvent(project, { actor, action: 'create_engagement', entityType: 'engagement', entityId: engagement.id, newValue: `${engagement.title}${engagement.client ? ` for ${engagement.client}` : ''}` });
  return engagement;
}

export type EngagementPatch = Partial<Pick<Engagement, 'title' | 'stage' | 'client' | 'fee' | 'lead' | 'dueDate' | 'scope' | 'workstreams'>>;

export function updateEngagement(project: DdProject, id: string, patch: EngagementPatch, actor: string): Engagement {
  const e = (project.engagements ?? []).find((x) => x.id === id);
  if (!e) throw new Error('No engagement by that id.');
  Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  e.updatedAt = new Date().toISOString();
  recordAuditEvent(project, { actor, action: 'update_engagement', entityType: 'engagement', entityId: e.id, newValue: JSON.stringify(patch) });
  return e;
}

/** The engagement the project is mostly working for: the latest one not yet issued. */
export function currentEngagement(project: DdProject): Engagement | undefined {
  const list = project.engagements ?? [];
  return [...list].reverse().find((e) => e.stage !== 'issued') ?? list.at(-1);
}

/** The engagements that draw on a workstream. */
export function engagementsIn(project: DdProject, workstream: string): Engagement[] {
  return (project.engagements ?? []).filter((e) => e.workstreams.includes(workstream));
}

/** The engagement a report was written for: the one that lists it, else the one the project is working for. */
export function engagementForReport(project: DdProject, reportId: string): Engagement | undefined {
  return (project.engagements ?? []).find((e) => e.reportIds.includes(reportId)) ?? currentEngagement(project);
}
