/**
 * Who is asking, which workspace they are asking about, and what that lets
 * them do.
 *
 * Until now every request was anonymous and the actor came out of the request
 * body — so the audit trail recorded whatever the client claimed, and any
 * caller could read any project. Both are the same defect wearing two hats:
 * the server took the client's word for who it was.
 *
 * The identity itself is issued elsewhere (Google Identity Platform, or Google
 * Identity Services, or anything else that signs a JWT). Nothing in this file
 * knows how a token is verified. What lives here is the part that has to be
 * the same on the server, in the tests and in the UI: the shape of a
 * membership, and the single table that says what each role may do.
 */

/** A workspace. One firm, one set of projects, one set of members. */
export interface Tenant {
  id: string;
  name: string;
  /** The email domain that may join without an invite, when the firm wants one. */
  autoJoinDomain?: string;
  createdAt: string;
}

/**
 * How much of the business somebody is trusted with.
 *
 * Shaped around a developer and the people around them rather than around a
 * professional firm: staff are inside and see every site, everybody else is a
 * collaborator who reaches nothing until they are put on one.
 *
 * `collaborator` is the row that matters. A contractor invited to one site
 * must not be able to read the acquisition file for a site still under
 * negotiation, and a role that grants "read" across the workspace cannot
 * express that however carefully it is named.
 */
export type WorkspaceRole = 'owner' | 'manager' | 'staff' | 'viewer' | 'collaborator';

export const WORKSPACE_ROLES: WorkspaceRole[] = ['owner', 'manager', 'staff', 'viewer', 'collaborator'];

export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
  viewer: 'Viewer',
  collaborator: 'Collaborator',
};

export const WORKSPACE_ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: 'Everything, including handing the workspace to somebody else.',
  manager: 'Every project, and who is in the workspace.',
  staff: 'Every project. Cannot add people or delete a project.',
  viewer: 'Reads every project. Changes nothing.',
  collaborator: 'Only the projects you put them on, and only the parts you tick.',
};

/**
 * Whether this role reaches every project without being named on one.
 *
 * The single question the projection and the project list both turn on, so it
 * is asked once here rather than spelled out as a role comparison in two
 * places that could drift apart.
 */
export function reachesEveryProject(role: WorkspaceRole): boolean {
  return role !== 'collaborator';
}

/**
 * Names a store written before this reshape used.
 *
 * A membership row is authorisation data, so an unrecognised role must not
 * fall through to something permissive — anything not named here becomes a
 * collaborator, which reaches nothing.
 */
export function migrateWorkspaceRole(raw: string): WorkspaceRole {
  if ((WORKSPACE_ROLES as string[]).includes(raw)) return raw as WorkspaceRole;
  if (raw === 'admin') return 'manager';
  if (raw === 'member') return 'staff';
  return 'collaborator';
}

/**
 * What a request is trying to do, coarsely.
 *
 * Deliberately four, not one per route. A permission matrix with sixty rows is
 * one nobody reads, and a route that needs its own row usually wants a
 * different check — "can this person issue a report" is about the report's
 * state, not about their role.
 */
export type Capability =
  /** See projects and everything on them. */
  | 'read'
  /** Change a record: checks, evidence, findings, risks, reports. */
  | 'write'
  /** Create or delete a project, and run the workspace's members. */
  | 'admin'
  /** Transfer or delete the workspace itself. */
  | 'owner';

const GRANTS: Record<WorkspaceRole, Capability[]> = {
  owner: ['read', 'write', 'admin', 'owner'],
  manager: ['read', 'write', 'admin'],
  staff: ['read', 'write'],
  viewer: ['read'],
  // A collaborator's writing is decided per project, by their grant. At the
  // workspace level they hold `write` so the method gate lets them through;
  // whether this particular check is theirs to record is the grant's answer,
  // and asking it here would be asking the wrong question.
  collaborator: ['read', 'write'],
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return GRANTS[role].includes(capability);
}

/** A person's standing in one workspace. */
export interface Membership {
  tenantId: string;
  /**
   * The identity provider's stable subject claim.
   *
   * Empty until the person first signs in: an invite is written against an
   * email, because that is all an admin knows about somebody who has never
   * been here. The subject is bound on first sign-in and is what every later
   * request matches on — an email can be reassigned inside a company, a
   * subject cannot.
   */
  subject?: string;
  email: string;
  name?: string;
  role: WorkspaceRole;
  invitedBy?: string;
  createdAt: string;
  lastSeenAt?: string;
}

/**
 * A verified caller, resolved to one workspace.
 *
 * Produced by the server from a verified token plus a membership. It is never
 * read from a request body, which is the whole point.
 */
export interface Principal {
  subject: string;
  email: string;
  name?: string;
  tenantId: string;
  role: WorkspaceRole;
}

/**
 * How this person is written into an audit trail.
 *
 * The email rather than the subject, because a trail is read by people and
 * `114820398471029384756` tells them nothing. The subject is what the system
 * matches on; the email is what it prints.
 */
export function actorOf(principal: Principal): string {
  return principal.email || principal.subject;
}

/** Emails compare case-insensitively; identity providers do not agree on case. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/**
 * Find the membership a token belongs to.
 *
 * Subject first, then an unclaimed invite against the same email. The order
 * matters: once a subject is bound, a later invite to the same address must
 * not be able to hand somebody else's account a different role.
 */
export function membershipFor(
  memberships: Membership[],
  identity: { subject: string; email: string },
): Membership | undefined {
  const bound = memberships.find((m) => m.subject && m.subject === identity.subject);
  if (bound) return bound;
  return memberships.find((m) => !m.subject && sameEmail(m.email, identity.email));
}

/**
 * A workspace must keep at least one owner.
 *
 * Otherwise the last owner demoting themselves — usually while tidying up —
 * leaves a workspace nobody can administer, and there is no way back from
 * inside the product.
 */
export function wouldOrphanWorkspace(
  memberships: Membership[],
  tenantId: string,
  changing: Membership,
  nextRole: WorkspaceRole | 'removed',
): boolean {
  if (changing.role !== 'owner') return false;
  if (nextRole === 'owner') return false;
  const owners = memberships.filter((m) => m.tenantId === tenantId && m.role === 'owner');
  return owners.length <= 1;
}
