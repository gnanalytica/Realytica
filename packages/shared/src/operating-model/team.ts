/**
 * Who works on a project, and what they may do in each department.
 *
 * A person's firm role sets a default — owners and managers lead every
 * department, staff contribute, viewers read — and the project's team list
 * says otherwise where it needs to: a lawyer who leads Legal and reads
 * nothing else, a CA who signs Finance's reports. Collaborators from outside
 * the firm reach only the departments the team list gives them.
 */

import type { DdProject } from './types';
import type { WorkspaceRole } from './tenancy';
import type { DepartmentKey, DepartmentRole } from './departments';
import { DEFAULT_DEPARTMENTS, DEPARTMENT_KEYS, scopesOfDepartments } from './departments';
import type { GrantArea, ProjectRole } from './project-access';
import type { ScopeKey } from './types';
import { recordAuditEvent } from './operations';

export interface TeamMember {
  email: string;
  name?: string;
  departments: Partial<Record<DepartmentKey, DepartmentRole>>;
  /** For a signer: what they are and the registration their reports carry. */
  signer?: { profession: string; registration?: string; firm?: string };
  addedAt: string;
  addedBy: string;
}

export interface TeamMemberInput {
  email: string;
  name?: string;
  departments: Partial<Record<DepartmentKey, DepartmentRole>>;
  signer?: { profession: string; registration?: string; firm?: string };
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

export function setTeamMember(project: DdProject, input: TeamMemberInput, actor: string): TeamMember {
  const email = normalise(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That is not an email address.');
  const departments = Object.fromEntries(Object.entries(input.departments).filter(([k, v]) => DEPARTMENT_KEYS.includes(k as DepartmentKey) && v)) as TeamMember['departments'];
  if (Object.values(departments).includes('signer') && !input.signer?.profession?.trim()) throw new Error('A signer needs their profession, and the registration their reports carry.');
  const team = project.team ?? [];
  const held = team.find((m) => m.email === email);
  const member: TeamMember = {
    email,
    ...(input.name?.trim() ? { name: input.name.trim() } : held?.name ? { name: held.name } : {}),
    departments,
    ...(input.signer ? { signer: { profession: input.signer.profession.trim(), ...(input.signer.registration ? { registration: input.signer.registration.trim() } : {}), ...(input.signer.firm ? { firm: input.signer.firm.trim() } : {}) } } : {}),
    addedAt: held?.addedAt ?? new Date().toISOString(),
    addedBy: held?.addedBy ?? actor,
  };
  project.team = [...team.filter((m) => m.email !== email), member];
  recordAuditEvent(project, { actor, action: 'set_team_member', entityType: 'team', entityId: email, newValue: JSON.stringify(departments) });
  return member;
}

export function removeTeamMember(project: DdProject, email: string, actor: string): void {
  const key = normalise(email);
  const before = (project.team ?? []).length;
  project.team = (project.team ?? []).filter((m) => m.email !== key);
  if (project.team.length !== before) recordAuditEvent(project, { actor, action: 'remove_team_member', entityType: 'team', entityId: key });
}

const DEFAULT_BY_WORKSPACE_ROLE: Record<WorkspaceRole, DepartmentRole | undefined> = {
  owner: 'lead',
  manager: 'lead',
  staff: 'contributor',
  viewer: 'viewer',
  collaborator: undefined,
};

/** What a person may do in one department of this project. Undefined: nothing. */
export function departmentRole(project: DdProject, person: { email: string; workspaceRole?: WorkspaceRole }, department: DepartmentKey): DepartmentRole | undefined {
  const member = (project.team ?? []).find((m) => m.email === normalise(person.email));
  // The team list says what it says; a department it leaves out falls back to
  // the firm role, which for an outside collaborator is nothing.
  const explicit = member?.departments[department];
  if (explicit) return explicit;
  return person.workspaceRole ? DEFAULT_BY_WORKSPACE_ROLE[person.workspaceRole] : undefined;
}

/** Every department role a person holds on this project. */
export function departmentRoles(project: DdProject, person: { email: string; workspaceRole?: WorkspaceRole }): Partial<Record<DepartmentKey, DepartmentRole>> {
  return Object.fromEntries(DEPARTMENT_KEYS.map((d) => [d, departmentRole(project, person, d)]).filter(([, r]) => r)) as Partial<Record<DepartmentKey, DepartmentRole>>;
}

/** The departments this project uses: its own choice, else the firm's, else all six. */
export function projectDepartments(project: DdProject, firmDefaults?: readonly DepartmentKey[]): DepartmentKey[] {
  const chosen = project.departments ?? firmDefaults ?? DEFAULT_DEPARTMENTS;
  return DEPARTMENT_KEYS.filter((d) => chosen.includes(d));
}

export function setProjectDepartments(project: DdProject, departments: readonly DepartmentKey[], actor: string): DepartmentKey[] {
  const next = DEPARTMENT_KEYS.filter((d) => departments.includes(d));
  if (!next.length) throw new Error('A project uses at least one department.');
  project.departments = next;
  recordAuditEvent(project, { actor, action: 'set_departments', entityType: 'project', entityId: project.id, newValue: next.join(', ') });
  return next;
}

/**
 * What an outside collaborator's department roles open on the file, in the
 * terms the redaction already understands: the scopes whose checks those
 * departments hold, and the areas beside them. Firm staff need none of this —
 * they reach every project — so it is only ever written for a collaborator.
 */
export function departmentReach(departments: Partial<Record<DepartmentKey, DepartmentRole>>): { role: ProjectRole; scopeKeys: ScopeKey[]; areas: GrantArea[] } {
  const held = (Object.entries(departments) as Array<[DepartmentKey, DepartmentRole]>).filter(([, r]) => r);
  const keys = held.map(([d]) => d);
  const areas = new Set<GrantArea>();
  if (keys.includes('finance')) {
    areas.add('valuation');
    areas.add('commercials');
  }
  if (keys.includes('construction')) areas.add('site_record');
  if (held.some(([, r]) => r === 'lead' || r === 'signer')) areas.add('reports');
  if (held.some(([, r]) => r === 'lead')) areas.add('decisions');
  const writes = held.some(([, r]) => r !== 'viewer');
  return { role: writes ? 'contributor' : 'reviewer', scopeKeys: scopesOfDepartments(keys) as ScopeKey[], areas: [...areas] };
}
