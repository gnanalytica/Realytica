/**
 * What one collaborator may see and touch on one project.
 *
 * A developer's staff see every site. Everybody else — a civil contractor, a
 * structural consultant, a panel advocate, a site helper — is on one site, and
 * often on one part of it. A workspace role cannot express that, however
 * carefully it is named, so access to a project is its own record.
 *
 * Four levels, narrowing:
 *
 *     project  →  which assessments  →  which scopes  →  which areas
 *
 * Everything is deny-by-default and stated explicitly. `allAssessments: false`
 * with an empty list means none, not all — a convention where "empty" silently
 * meant "everything" is the convention that puts the wrong contractor on the
 * acquisition file. The `all*` flags are separate booleans rather than an empty
 * array so the difference between "every assessment, including the one you
 * start next month" and "these three" is written down rather than inferred.
 */

import type { ScopeKey } from './types';

/** What a collaborator may do inside what they can see. */
export type ProjectRole = 'contributor' | 'reviewer';

export const PROJECT_ROLES: ProjectRole[] = ['contributor', 'reviewer'];

export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  contributor: 'Contributor',
  reviewer: 'Reviewer',
};

export const PROJECT_ROLE_HINT: Record<ProjectRole, string> = {
  contributor: 'Records checks, uploads documents and raises findings — within what you tick below.',
  reviewer: 'Reads what you tick below. Changes nothing.',
};

/**
 * The parts of a file that are not a scope, and that an outsider must never
 * see by accident.
 *
 * Each is off unless ticked. They are separate from scopes because none of
 * them belongs to a discipline: a contractor working the technical scope has
 * no more business seeing what you think the site is worth than one working
 * the legal scope does.
 */
export type GrantArea = 'valuation' | 'decisions' | 'reports' | 'commercials' | 'site_record';

export const GRANT_AREAS: GrantArea[] = ['valuation', 'decisions', 'reports', 'commercials', 'site_record'];

export const GRANT_AREA_LABEL: Record<GrantArea, string> = {
  valuation: 'Valuation',
  decisions: 'Decisions',
  reports: 'Reports',
  commercials: 'Budget and figures',
  site_record: 'Site visits and sheets',
};

export const GRANT_AREA_HINT: Record<GrantArea, string> = {
  valuation: 'What the site is worth, the approaches behind it, and any property screen.',
  decisions: 'Proceed, hold, conditions — the commercial calls and their reasoning.',
  reports: 'Issued and draft reports on this project.',
  commercials: 'The budget on the project record, and figures derived from it.',
  site_record: 'Site visits, their photographs, and placed master-plan sheets.',
};

/** One person's access to one project. */
export interface ProjectGrant {
  id: string;
  tenantId: string;
  projectId: string;
  /**
   * The address the grant is written against.
   *
   * Matched to a membership the same way an invite is, so a project can be
   * staffed before the person has ever signed in.
   */
  email: string;
  role: ProjectRole;
  /** Every assessment on the project, including ones started later. */
  allAssessments: boolean;
  assessmentIds: string[];
  /** Every scope inside those assessments, including ones added later. */
  allScopes: boolean;
  scopeKeys: ScopeKey[];
  areas: GrantArea[];
  /**
   * When this access lapses.
   *
   * Contractors churn and nobody remembers to revoke. An expiry that the
   * server enforces is the difference between access ending and access being
   * meant to end.
   */
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  note?: string;
}

export interface CreateProjectGrantInput {
  email: string;
  role?: ProjectRole;
  allAssessments?: boolean;
  assessmentIds?: string[];
  allScopes?: boolean;
  scopeKeys?: ScopeKey[];
  areas?: GrantArea[];
  expiresAt?: string;
  note?: string;
}

export function grantHasExpired(grant: ProjectGrant, now = new Date()): boolean {
  if (!grant.expiresAt) return false;
  const at = Date.parse(grant.expiresAt);
  return Number.isFinite(at) && at <= now.getTime();
}

export function grantAllows(grant: ProjectGrant, area: GrantArea): boolean {
  return grant.areas.includes(area);
}

export function grantCanWrite(grant: ProjectGrant): boolean {
  return grant.role === 'contributor';
}

/**
 * A one-line summary of the reach, for a list where the detail would not fit.
 *
 * Deliberately says "nothing yet" out loud. A grant with no assessments ticked
 * is a person who was added and then forgotten, and a row that renders as
 * blank is a row nobody notices.
 */
export function describeGrant(grant: ProjectGrant): string {
  const parts: string[] = [PROJECT_ROLE_LABEL[grant.role]];
  if (grant.allAssessments) parts.push('all assessments');
  else if (grant.assessmentIds.length === 0) parts.push('no assessments yet');
  else parts.push(`${grant.assessmentIds.length} assessment${grant.assessmentIds.length === 1 ? '' : 's'}`);

  if (!grant.allScopes && grant.scopeKeys.length > 0) {
    parts.push(`${grant.scopeKeys.length} scope${grant.scopeKeys.length === 1 ? '' : 's'}`);
  }
  if (grant.areas.length > 0) parts.push(grant.areas.map((a) => GRANT_AREA_LABEL[a].toLowerCase()).join(', '));
  return parts.join(' · ');
}
