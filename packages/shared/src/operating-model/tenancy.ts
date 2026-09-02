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
 * What a member may do.
 *
 * Four rather than two because a diligence firm has genuinely different
 * standing for a partner, a manager, a reviewer and a client who has been
 * given read access to their own file.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export const WORKSPACE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];

export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const WORKSPACE_ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: 'Everything an admin can do, and can hand the workspace to somebody else.',
  admin: 'Records and reports, plus who is in the workspace and what they may do.',
  member: 'Records checks, files evidence, writes findings and issues reports.',
  viewer: 'Reads the file. Cannot change anything on it.',
};

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
  admin: ['read', 'write', 'admin'],
  member: ['read', 'write'],
  viewer: ['read'],
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
