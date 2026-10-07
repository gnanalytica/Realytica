/**
 * Links: how the work in one department reaches the work in another.
 *
 * Departments are separate modules; links are what connects them. Some are
 * the system's own, read from the project — a commencement certificate gates
 * construction, the title feeds the valuation, progress feeds the cost to
 * complete — and some a person draws by hand. Both are graph edges, and the
 * graph is where "what does this depend on, and what depends on it" is asked.
 */

import type { DdProject } from './types';
import { recordAuditEvent } from './operations';
import { APPROVAL_KINDS, approvalsRegister } from './approvals';
import { workstreamDefinition } from './departments';
import { allChecks } from './engagements';
import { projectEdgeEndpointsValid, type ProjectGraphEdgeKind, type ProjectGraphNodeKind } from './project-ontology';

export type LinkType = 'gates' | 'feeds' | 'cites' | 'certifies' | 'draws_on' | 'relates';

export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  gates: 'gates',
  feeds: 'feeds',
  cites: 'cites',
  certifies: 'certifies',
  draws_on: 'draws on',
  relates: 'relates to',
};

export type LinkEndKind = 'workstream' | 'check' | 'document' | 'certified' | 'milestone' | 'approval' | 'engagement' | 'finding' | 'site_entry';

export interface LinkEnd {
  kind: LinkEndKind;
  id: string;
}

export interface ProjectLink {
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  type: LinkType;
  origin: 'system' | 'person';
  note?: string;
  createdAt: string;
  createdBy: string;
}

/** The department links the product draws itself. */
const DEPARTMENT_LINKS: ReadonlyArray<{ from: string; to: string; type: LinkType; note: string }> = [
  { from: 'legal.title', to: 'finance.valuation', type: 'feeds', note: 'Title blockers become valuation drivers and lender checks.' },
  { from: 'legal.approvals', to: 'finance.valuation', type: 'feeds', note: 'Approvals decide what may be valued as built.' },
  { from: 'legal.approvals', to: 'construction.progress', type: 'gates', note: 'Work may run only once the plan sanction and commencement certificate are in hand.' },
  { from: 'construction.progress', to: 'finance.budget', type: 'feeds', note: 'Progress decides the cost to complete.' },
  { from: 'construction.progress', to: 'finance.valuation', type: 'feeds', note: 'Work in place is part of the value as is.' },
  { from: 'construction.quality', to: 'finance.valuation', type: 'feeds', note: 'Defects and condition move the value.' },
  { from: 'design.compliance', to: 'legal.approvals', type: 'relates', note: 'What is drawn must fit what was approved.' },
  { from: 'procurement.orders', to: 'finance.budget', type: 'feeds', note: 'A signed order commits budget.' },
  { from: 'construction.progress', to: 'commercial.buyers', type: 'feeds', note: 'Milestones trigger buyers’ instalments.' },
  { from: 'commercial.buyers', to: 'finance.funding', type: 'feeds', note: 'Collections fund the project and the escrow.' },
];

/** Every link the project implies, before anything a person drew. */
export function systemLinks(project: DdProject): ProjectLink[] {
  const at = project.updatedAt;
  const link = (from: LinkEnd, to: LinkEnd, type: LinkType, note?: string): ProjectLink => ({
    id: `sys:${type}:${from.kind}:${from.id}->${to.kind}:${to.id}`,
    from,
    to,
    type,
    origin: 'system',
    ...(note ? { note } : {}),
    createdAt: at,
    createdBy: 'system',
  });
  const out: ProjectLink[] = DEPARTMENT_LINKS.map((d) => link({ kind: 'workstream', id: d.from }, { kind: 'workstream', id: d.to }, d.type, d.note));
  for (const line of approvalsRegister(project)) {
    for (const held of line.held) {
      out.push(link({ kind: 'document', id: held.evidenceId }, { kind: 'approval', id: line.kind.key }, 'certifies'));
    }
    if (line.kind.key === 'plan_sanction' || line.kind.key === 'commencement') {
      out.push(link({ kind: 'approval', id: line.kind.key }, { kind: 'workstream', id: 'construction.progress' }, 'gates'));
    }
  }
  const checks = allChecks(project);
  for (const check of checks) {
    for (const evidenceId of check.evidenceIds) out.push(link({ kind: 'document', id: evidenceId }, { kind: 'check', id: check.id }, 'cites'));
  }
  for (const report of project.certifiedReports ?? []) {
    out.push(link({ kind: 'certified', id: report.id }, { kind: 'workstream', id: report.workstream }, 'certifies'));
    out.push(link({ kind: 'certified', id: report.id }, { kind: 'document', id: report.evidenceId }, 'cites'));
  }
  for (const engagement of project.engagements ?? []) {
    for (const ws of engagement.workstreams) out.push(link({ kind: 'engagement', id: engagement.id }, { kind: 'workstream', id: ws }, 'draws_on'));
  }
  return out;
}

/** The kind of graph node each end of a link is drawn as. */
const LINK_END_NODE_KIND: Record<LinkEndKind, ProjectGraphNodeKind> = {
  workstream: 'workstream',
  check: 'check',
  document: 'evidence',
  certified: 'certified_report',
  milestone: 'milestone',
  approval: 'approval',
  engagement: 'engagement',
  finding: 'finding',
  site_entry: 'site_entry',
};

/** An end's kind, as a person would say it. */
const LINK_END_WORD: Record<LinkEndKind, string> = {
  workstream: 'a function',
  check: 'a check',
  document: 'a document',
  certified: 'a certified report',
  milestone: 'a milestone',
  approval: 'an approval',
  engagement: 'an engagement',
  finding: 'a finding',
  site_entry: 'a site entry',
};

/**
 * The graph edge a link is drawn as: which way round, and by which relation.
 *
 * A link is said the way a person says it ("this document cites that check",
 * "this certificate certifies that approval"). The graph says the same thing
 * from the conclusion to the paper: the check rests on the document, the
 * approval on its certificate. Every other link is drawn as it is said.
 */
export function linkEdge(link: { from: LinkEnd; to: LinkEnd; type: LinkType }): { from: LinkEnd; to: LinkEnd; rel: ProjectGraphEdgeKind } {
  if (link.type === 'cites' || (link.type === 'certifies' && link.from.kind === 'document')) {
    return link.from.kind === 'document' ? { from: link.to, to: link.from, rel: 'supported_by' } : { from: link.from, to: link.to, rel: 'supported_by' };
  }
  return { from: link.from, to: link.to, rel: link.type };
}

/**
 * Whether an end names what it says it names, on this project.
 *
 * A link carries an id and the kind the caller says that id is. The two can
 * disagree: a document's id sent as a certified report's. The kind decides
 * which relations the link may use, so a wrong one buys a relation the record
 * could never have. The id is looked up in the register of the kind declared,
 * and nowhere else.
 *
 * A workstream and an approval are not records a project adds. A workstream
 * is one the product defines, whether or not its department is switched on;
 * an approval is one of the kinds the approvals register knows.
 */
function endIsOnFile(project: DdProject, end: LinkEnd): boolean {
  switch (end.kind) {
    case 'workstream':
      return workstreamDefinition(end.id) !== undefined;
    case 'approval':
      return APPROVAL_KINDS.some((kind) => kind.key === end.id);
    case 'check':
      return allChecks(project).some((check) => check.id === end.id);
    case 'document':
      return project.evidence.some((row) => row.id === end.id);
    case 'certified':
      return (project.certifiedReports ?? []).some((report) => report.id === end.id);
    case 'milestone':
      return (project.milestones ?? []).some((milestone) => milestone.id === end.id);
    case 'engagement':
      return (project.engagements ?? []).some((engagement) => engagement.id === end.id);
    case 'finding':
      return project.findings.some((finding) => finding.id === end.id);
    case 'site_entry':
      return (project.siteLog ?? []).some((entry) => entry.id === end.id);
  }
}

/**
 * Draw a link by hand.
 *
 * A link the graph cannot draw is refused, for either of two reasons.
 *
 * The relation does not join those kinds. The ontology says which kinds each
 * relation may join: a check cannot gate a function, a milestone cannot feed
 * a document. `relates` joins any two things, so it is what the refusal
 * offers instead.
 *
 * Or an end is not what it is said to be. The rule above is asked of the
 * kinds the caller declares, so it is only worth anything if each id is a
 * record of that kind on this project.
 *
 * Taken as it came, such a link would sit on the file and be one the graph
 * has to leave out every time it is built.
 */
export function addLink(project: DdProject, input: { from: LinkEnd; to: LinkEnd; type: LinkType; note?: string }, actor: string): ProjectLink {
  if (input.from.kind === input.to.kind && input.from.id === input.to.id) throw new Error('A link joins two different things.');
  const edge = linkEdge(input);
  if (!projectEdgeEndpointsValid(edge.rel, LINK_END_NODE_KIND[edge.from.kind], LINK_END_NODE_KIND[edge.to.kind])) {
    throw new Error(
      `“${LINK_TYPE_LABEL[input.type]}” cannot join ${LINK_END_WORD[input.from.kind]} to ${LINK_END_WORD[input.to.kind]}. To say two things belong together, link them with “relates”.`,
    );
  }
  for (const end of [input.from, input.to]) {
    if (!endIsOnFile(project, end)) throw new Error(`“${end.id}” is not ${LINK_END_WORD[end.kind]} on this project.`);
  }
  const held = (project.links ?? []).find((l) => l.type === input.type && l.from.id === input.from.id && l.to.id === input.to.id);
  if (held) return held;
  const link: ProjectLink = {
    id: `lnk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    from: input.from,
    to: input.to,
    type: input.type,
    origin: 'person',
    ...(input.note ? { note: input.note.trim() } : {}),
    createdAt: new Date().toISOString(),
    createdBy: actor,
  };
  project.links = [...(project.links ?? []), link];
  recordAuditEvent(project, { actor, action: 'add_link', entityType: 'link', entityId: link.id, newValue: `${input.from.kind}:${input.from.id} ${input.type} ${input.to.kind}:${input.to.id}` });
  return link;
}

export function removeLink(project: DdProject, id: string, actor: string): void {
  const before = (project.links ?? []).length;
  project.links = (project.links ?? []).filter((l) => l.id !== id);
  if (project.links.length !== before) recordAuditEvent(project, { actor, action: 'remove_link', entityType: 'link', entityId: id });
}

/** Every link, the system's and people's together. */
export function projectLinks(project: DdProject): ProjectLink[] {
  return [...systemLinks(project), ...(project.links ?? [])];
}
