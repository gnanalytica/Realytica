/**
 * The firm's engagements, read across files.
 *
 * Everything here is derived on read from the projects a person can see:
 * the pipeline by engagement stage, the proposals that wait for a person,
 * what the firm is waiting on from others, and what falls due in the next
 * fortnight. Nothing is stored, so nothing can drift from the files.
 */

import { toProjectSummary } from './operations';
import { currentEngagement } from './engagements';
import { requestAgeDays, waitingOn } from './project-requests';
import type { ChatProposalKind, DdProject, ProjectRequest, ProjectSummary } from './types';

export interface PortfolioDecision {
  projectId: string;
  projectName: string;
  proposalId: string;
  kind: ChatProposalKind | 'draft';
  title: string;
  createdAt: string;
}

export interface PortfolioWaiting {
  projectId: string;
  projectName: string;
  request: ProjectRequest;
  ageDays: number;
  overdue: boolean;
}

export type PortfolioDueKind = 'request' | 'action' | 'visit' | 'report';

export interface PortfolioDue {
  projectId: string;
  projectName: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  label: string;
  kind: PortfolioDueKind;
  refId: string;
}

export interface PortfolioView {
  generatedAt: string;
  /** The first day of the window, as the viewer's calendar has it. */
  today: string;
  projects: ProjectSummary[];
  decisions: PortfolioDecision[];
  waitingOn: PortfolioWaiting[];
  /** Every request on every file, any status, newest first. */
  requests: PortfolioWaiting[];
  upcoming: PortfolioDue[];
  /** Open blockers across files: critical findings plus blocker compliance checks. */
  blockers: number;
  /** Site visits planned inside the window. */
  visitsInWindow: number;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CLOSED_FINDING = new Set(['closed', 'rejected', 'duplicate', 'superseded']);

/** Open findings rated critical, the ones a portfolio has to see first. */
export function openBlockers(project: DdProject): number {
  const critical = project.findings.filter((f) => f.severity === 'critical' && !CLOSED_FINDING.has(f.status)).length;
  return critical;
}

/**
 * `today` is the viewer's own calendar date. The server's clock is UTC, and a
 * firm in Bengaluru opening the portfolio at 1am would otherwise see a
 * fortnight that starts yesterday.
 */
export function portfolioView(
  projects: DdProject[],
  now = new Date().toISOString(),
  windowDays = 14,
  today = now.slice(0, 10),
): PortfolioView {
  const until = addDays(today, windowDays - 1);
  const inWindow = (date: string | undefined): date is string => Boolean(date && date >= today && date <= until);

  const decisions: PortfolioDecision[] = [];
  const waiting: PortfolioWaiting[] = [];
  const everyRequest: PortfolioWaiting[] = [];
  const upcoming: PortfolioDue[] = [];
  let blockers = 0;
  let visitsInWindow = 0;

  for (const project of projects) {
    blockers += openBlockers(project);

    for (const p of project.chatProposals ?? []) {
      if (p.status !== 'proposed') continue;
      decisions.push({ projectId: project.id, projectName: project.name, proposalId: p.id, kind: p.kind, title: p.title, createdAt: p.createdAt });
    }
    for (const d of project.aiDrafts ?? []) {
      if (d.status !== 'draft' && d.status !== 'in_review') continue;
      decisions.push({ projectId: project.id, projectName: project.name, proposalId: d.id, kind: 'draft', title: d.title, createdAt: d.createdAt });
    }

    for (const request of project.requests ?? []) {
      everyRequest.push({
        projectId: project.id,
        projectName: project.name,
        request,
        ageDays: requestAgeDays(request, now),
        overdue: request.status === 'sent' && Boolean(request.dueAt && request.dueAt < today),
      });
    }

    for (const item of waitingOn(project, now)) {
      waiting.push({ projectId: project.id, projectName: project.name, ...item });
      if (inWindow(item.request.dueAt)) {
        upcoming.push({ projectId: project.id, projectName: project.name, date: item.request.dueAt, label: item.request.title, kind: 'request', refId: item.request.id });
      }
    }

    for (const a of project.actions) {
      if (a.status === 'closed' || !inWindow(a.dueDate)) continue;
      upcoming.push({ projectId: project.id, projectName: project.name, date: a.dueDate, label: a.title, kind: 'action', refId: a.id });
    }

    for (const v of project.siteVisits ?? []) {
      if (v.status !== 'planned' || !inWindow(v.visitedOn?.slice(0, 10))) continue;
      visitsInWindow += 1;
      upcoming.push({ projectId: project.id, projectName: project.name, date: v.visitedOn.slice(0, 10), label: 'Site visit', kind: 'visit', refId: v.id });
    }

    const current = currentEngagement(project);
    const due = current?.dueDate;
    if (current && current.stage !== 'issued' && inWindow(due)) {
      upcoming.push({ projectId: project.id, projectName: project.name, date: due, label: 'Report due', kind: 'report', refId: project.id });
    }
  }

  decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  waiting.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.ageDays - a.ageDays);
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName));

  return {
    generatedAt: now,
    today,
    projects: projects.map(toProjectSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    decisions,
    waitingOn: waiting,
    requests: everyRequest.sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt)),
    upcoming,
    blockers,
    visitsInWindow,
  };
}
