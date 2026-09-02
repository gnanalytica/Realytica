/**
 * The project as one reader may see it.
 *
 * Every reader in this codebase takes a whole `DdProject` — the chat, the
 * search index, the graph, the registers, the report builder. That is what
 * makes this approach possible and it is why it is the right one: rather than
 * teaching six surfaces to filter, hand all six a project that does not
 * contain what the reader may not see.
 *
 * It matters most for the chat. Giving a model the whole file and instructing
 * it to withhold the valuation is a technique that fails silently and
 * conversationally: a model told not to mention something mentions it, and
 * nobody finds out which conversation leaked. A model handed a project with no
 * `valuationRuns` on it cannot cite a valuation, because there is not one.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not secure writing. The API mutates the real project, not this
 *    copy, so every write needs its own check that the target is inside the
 *    grant. Treating a projection as a write gate is a false sense of
 *    security, and `writableCheckIds` below exists so the caller has the
 *    answer without recomputing it.
 *
 *  - It does not pretend the withheld parts are absent. `withheld` names what
 *    was taken out, so a direct question can be answered with "you do not have
 *    access to that" rather than an emptiness that reads as a fact.
 */

import { grantAllows, grantCanWrite, type GrantArea, type ProjectGrant } from './project-access';
import type {
  ActionRecord,
  DdAssessment,
  DdProject,
  DecisionRecord,
  EvidenceRecord,
  FindingRecord,
  RiskRecord,
  ScopeInstance,
} from './types';

/** What a reader is allowed, before any of it is applied. */
export type ProjectAccess =
  /** Staff and above: the file as it is. */
  | { kind: 'full' }
  /** A collaborator, holding exactly one grant on this project. */
  | { kind: 'granted'; grant: ProjectGrant; email: string };

export type WithheldPart =
  | 'assessments'
  | 'evidence'
  | 'findings'
  | 'risks'
  | 'actions'
  | 'decisions'
  | 'valuation'
  | 'reports'
  | 'commercials'
  | 'site_record'
  | 'conversation';

export interface ProjectView {
  /** A real project, safe to hand to anything that reads one. */
  project: DdProject;
  /** True when nothing was removed. */
  complete: boolean;
  /** What was taken out, so a question about it gets an honest answer. */
  withheld: WithheldPart[];
  /** Checks this reader may record. Empty for a reviewer. */
  writableCheckIds: Set<string>;
}

function overlaps(a: readonly string[] | undefined, b: Set<string>): boolean {
  if (!a) return false;
  for (const id of a) if (b.has(id)) return true;
  return false;
}

/** The whole file, for anybody whose role reaches every project. */
export function fullView(project: DdProject): ProjectView {
  const writable = new Set<string>();
  for (const a of project.assessments) for (const s of a.scopes) for (const c of s.checks) writable.add(c.id);
  return { project, complete: true, withheld: [], writableCheckIds: writable };
}

export function projectView(project: DdProject, access: ProjectAccess): ProjectView {
  if (access.kind === 'full') return fullView(project);
  const { grant } = access;
  const withheld: WithheldPart[] = [];

  /* ---- what of the assessment tree survives ---------------------------- */

  const assessments: DdAssessment[] = [];
  const scopeIds = new Set<string>();
  const checkIds = new Set<string>();
  const assessmentIds = new Set<string>();

  for (const assessment of project.assessments) {
    if (!grant.allAssessments && !grant.assessmentIds.includes(assessment.id)) continue;
    const scopes: ScopeInstance[] = assessment.scopes.filter(
      (s) => grant.allScopes || grant.scopeKeys.includes(s.scopeKey),
    );
    if (scopes.length === 0) continue;
    assessmentIds.add(assessment.id);
    for (const s of scopes) {
      scopeIds.add(s.id);
      for (const c of s.checks) checkIds.add(c.id);
    }
    assessments.push({ ...assessment, scopes });
  }
  if (assessments.length < project.assessments.length) withheld.push('assessments');

  /* ---- and what hangs off it ------------------------------------------- */

  // Evidence reaches a scope, a check, or — when it is filed at the assessment
  // level with no narrower link — an assessment. Evidence linked to nothing at
  // all stays inside: an unlinked row is as likely to be the term sheet as the
  // soil report, and guessing wrong on that is the expensive direction.
  const evidence: EvidenceRecord[] = project.evidence.filter((e) => {
    if (overlaps(e.scopeInstanceIds, scopeIds)) return true;
    if (overlaps(e.checkIds, checkIds)) return true;
    const narrower = (e.scopeInstanceIds?.length ?? 0) > 0 || (e.checkIds?.length ?? 0) > 0;
    return !narrower && overlaps(e.assessmentIds, assessmentIds);
  });
  const evidenceIds = new Set(evidence.map((e) => e.id));
  if (evidence.length < project.evidence.length) withheld.push('evidence');

  const findings: FindingRecord[] = project.findings.filter((f) => {
    if (f.sourceScopeId && scopeIds.has(f.sourceScopeId)) return true;
    if (f.sourceCheckId && checkIds.has(f.sourceCheckId)) return true;
    if (f.sourceAssessmentId && assessmentIds.has(f.sourceAssessmentId)) return true;
    if (overlaps(f.assessmentIds, assessmentIds)) return true;
    return overlaps(f.evidenceIds, evidenceIds);
  });
  const findingIds = new Set(findings.map((f) => f.id));
  if (findings.length < project.findings.length) withheld.push('findings');

  const risks: RiskRecord[] = project.risks.filter(
    (r) =>
      overlaps(r.scopeInstanceIds, scopeIds) ||
      overlaps(r.assessmentIds, assessmentIds) ||
      overlaps(r.findingIds, findingIds),
  );
  const riskIds = new Set(risks.map((r) => r.id));
  if (risks.length < project.risks.length) withheld.push('risks');

  // Work assigned to you is yours to see even when its finding is not: being
  // asked to do something you cannot read is worse than a small disclosure.
  const actions: ActionRecord[] = project.actions.filter(
    (a) =>
      overlaps(a.findingIds, findingIds) ||
      overlaps(a.riskIds, riskIds) ||
      overlaps(a.checkIds, checkIds) ||
      (a.owner ? a.owner.trim().toLowerCase() === access.email.trim().toLowerCase() : false),
  );
  if (actions.length < project.actions.length) withheld.push('actions');

  /* ---- the areas, each off unless ticked -------------------------------- */

  const area = (key: GrantArea): boolean => grantAllows(grant, key);

  const decisions: DecisionRecord[] = area('decisions') ? project.decisions : [];
  if (project.decisions.length > 0 && !area('decisions')) withheld.push('decisions');

  const valuationRuns = area('valuation') ? project.valuationRuns : [];
  if (!area('valuation')) withheld.push('valuation');

  const reports = area('reports') ? project.reports : [];
  if (project.reports.length > 0 && !area('reports')) withheld.push('reports');

  const siteVisits = area('site_record') ? project.siteVisits : [];
  const sheets = area('site_record') ? project.sheets : [];
  if (!area('site_record') && ((project.siteVisits?.length ?? 0) > 0 || (project.sheets?.length ?? 0) > 0)) {
    withheld.push('site_record');
  }

  /*
   * The thread is one conversation for the whole project, so a collaborator
   * reading it would read the developer's. Turns carry an actor from the day
   * this landed; a turn written before that has none and stays inside, because
   * an unattributed turn cannot be shown to be theirs.
   */
  const conversation = project.conversation.filter((t) => t.actor && t.actor === access.email);
  if (conversation.length < project.conversation.length) withheld.push('conversation');

  const commercial = area('commercials');
  if (!commercial && project.budget !== undefined) withheld.push('commercials');

  const view: DdProject = {
    ...project,
    assessments,
    evidence,
    findings,
    risks,
    actions,
    decisions,
    valuationRuns,
    reports,
    siteVisits,
    sheets,
    conversation,
    ...(commercial ? {} : { budget: undefined }),
    // A screen result carries an indicative value, so it travels with the
    // valuation rather than with the site.
    ...(area('valuation') ? {} : { lastScreen: undefined, lastScreenResult: undefined }),
    // Proposals, drafts and orchestrator runs are the workspace thinking aloud
    // about the whole file. None of it is a collaborator's.
    chatProposals: [],
    aiDrafts: [],
    orchestratorRuns: [],
    capabilityRuns: [],
    // The trail names everybody's actions across the whole project.
    audit: [],
  };

  const writableCheckIds = grantCanWrite(grant) ? checkIds : new Set<string>();

  return { project: view, complete: false, withheld: [...new Set(withheld)], writableCheckIds };
}

/**
 * What to say when somebody asks about something they cannot see.
 *
 * A register that omits a row is a list; a conversation that omits an answer
 * is a claim. "There is no valuation on this file" and "you do not have access
 * to the valuation" are different sentences and only one of them is true.
 */
export const WITHHELD_LABEL: Record<WithheldPart, string> = {
  assessments: 'some assessments on this project',
  evidence: 'some documents on this project',
  findings: 'some findings on this project',
  risks: 'some risks on this project',
  actions: 'some actions on this project',
  decisions: 'the decisions on this project',
  valuation: 'the valuation on this project',
  reports: 'the reports on this project',
  commercials: 'the budget and figures on this project',
  site_record: 'the site visits and sheets on this project',
  conversation: 'other people’s conversations on this project',
};
