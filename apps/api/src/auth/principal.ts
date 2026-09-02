import {
  can,
  membershipFor,
  sameEmail,
  type Capability,
  type Membership,
  type Principal,
  type Tenant,
} from '@realytica/shared';
import type { AuthSettings } from './config';
import type { VerifiedToken } from './verify';

/**
 * Turning a verified token into somebody with standing in a workspace.
 *
 * Verification says the token is genuine. This says what it entitles you to,
 * which is a different question with a different answer: a real Google account
 * that nobody has invited is a real Google account with no business here.
 *
 * Pure functions over the store's arrays, so every rule below is testable
 * without an HTTP request — which matters, because these are the rules that
 * decide whether one firm can read another firm's file.
 */

export interface Workspace {
  tenants: Tenant[];
  memberships: Membership[];
}

export type Resolution =
  | { ok: true; principal: Principal; /** Rows the caller must persist. */ changed: boolean; workspace: Workspace }
  | { ok: false; status: 401 | 403; reason: string };

let sequence = 0;

function id(prefix: string): string {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Whether this person may claim a workspace that does not exist yet.
 *
 * With `REALYTICA_AUTH_BOOTSTRAP_EMAILS` unset, the first person to sign in
 * does — right for a firm standing up its own instance, wrong for anything on
 * a public URL, which is why it can be pinned to named addresses.
 */
function mayBootstrap(settings: AuthSettings, email: string): boolean {
  if (settings.bootstrapEmails.length === 0) return true;
  return settings.bootstrapEmails.some((allowed) => sameEmail(allowed, email));
}

/**
 * Resolve a verified identity against the workspaces on file.
 *
 * Mutates `workspace` in place when something has to be recorded — a first
 * workspace claimed, a subject bound to an invite, a last-seen stamp — and
 * reports it through `changed` so the caller knows to save. Doing the write
 * here rather than in the route keeps "who is this" in one place; reporting
 * it rather than saving here keeps this function pure enough to test.
 */
export function resolvePrincipal(
  workspace: Workspace,
  token: VerifiedToken,
  settings: AuthSettings,
): Resolution {
  if (settings.requireVerifiedEmail && token.email && !token.emailVerified) {
    return { ok: false, status: 403, reason: 'This account has not verified its email address.' };
  }

  const existing = membershipFor(workspace.memberships, { subject: token.subject, email: token.email });
  if (existing) {
    let changed = false;
    // The invite is claimed by whoever first signs in against it, and from
    // then on the subject is what matches. An email is reassignable inside a
    // company; a subject is not.
    if (!existing.subject) {
      existing.subject = token.subject;
      changed = true;
    }
    if (token.name && existing.name !== token.name) {
      existing.name = token.name;
      changed = true;
    }
    // A day's resolution is enough to answer "is this seat still in use" and
    // avoids a store write on every single request.
    const today = nowIso().slice(0, 10);
    if ((existing.lastSeenAt ?? '').slice(0, 10) !== today) {
      existing.lastSeenAt = nowIso();
      changed = true;
    }
    return {
      ok: true,
      changed,
      workspace,
      principal: {
        subject: token.subject,
        email: existing.email,
        name: existing.name ?? token.name,
        tenantId: existing.tenantId,
        role: existing.role,
      },
    };
  }

  // No membership. Three ways that can still end in a yes.
  if (workspace.tenants.length === 0) {
    if (!mayBootstrap(settings, token.email)) {
      return { ok: false, status: 403, reason: 'This workspace has not been set up for you.' };
    }
    const tenant: Tenant = {
      id: id('tnt'),
      name: token.email ? `${token.email.split('@')[1] ?? 'Workspace'}` : 'Workspace',
      createdAt: nowIso(),
    };
    const membership: Membership = {
      tenantId: tenant.id,
      subject: token.subject,
      email: token.email,
      name: token.name,
      role: 'owner',
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    workspace.tenants.push(tenant);
    workspace.memberships.push(membership);
    return {
      ok: true,
      changed: true,
      workspace,
      principal: {
        subject: token.subject,
        email: token.email,
        name: token.name,
        tenantId: tenant.id,
        role: 'owner',
      },
    };
  }

  // A workspace that has opted into a domain takes colleagues without an
  // invite each — as staff, never as managers: joining is not the same as
  // being trusted to run the place.
  const domain = token.email.split('@')[1]?.toLowerCase();
  const open = domain
    ? workspace.tenants.find((t) => (t.autoJoinDomain ?? '').toLowerCase() === domain)
    : undefined;
  if (open) {
    const membership: Membership = {
      tenantId: open.id,
      subject: token.subject,
      email: token.email,
      name: token.name,
      role: 'staff',
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    workspace.memberships.push(membership);
    return {
      ok: true,
      changed: true,
      workspace,
      principal: {
        subject: token.subject,
        email: token.email,
        name: token.name,
        tenantId: open.id,
        role: 'staff',
      },
    };
  }

  return {
    ok: false,
    status: 403,
    reason: 'You are not a member of this workspace. Ask an admin to invite you.',
  };
}

/** Whether a principal may do a thing. One call, so the rule is not restated. */
export function allows(principal: Principal, capability: Capability): boolean {
  return can(principal.role, capability);
}
