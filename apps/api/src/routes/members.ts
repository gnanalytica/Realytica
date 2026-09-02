import { Router } from 'express';
import { z } from 'zod';
import {
  WORKSPACE_ROLES,
  sameEmail,
  wouldOrphanWorkspace,
  type Membership,
  type WorkspaceRole,
} from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';

/**
 * Who is in this workspace, and what they may do.
 *
 * Reading the list is any member's business — knowing who else is on a file
 * is part of working on it. Changing it is an admin's, with one rule the
 * server keeps for everybody: a workspace must always have an owner, because
 * there is no way back into one that does not.
 */

export const membersRouter = Router();

function rows(tenantId: string): Membership[] {
  return (store.data.memberships ?? []).filter((m) => m.tenantId === tenantId);
}

const roleSchema = z.enum(WORKSPACE_ROLES as [WorkspaceRole, ...WorkspaceRole[]]);

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: roleSchema.default('staff'),
});

const patchSchema = z.object({ role: roleSchema });

membersRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const tenant = (store.data.tenants ?? []).find((t) => t.id === me.tenantId);
  res.json({
    tenant: tenant ? { id: tenant.id, name: tenant.name, autoJoinDomain: tenant.autoJoinDomain } : null,
    me,
    members: rows(me.tenantId)
      .map((m) => ({
        email: m.email,
        name: m.name,
        role: m.role,
        // Whether the invite has been taken up, without leaking the subject
        // itself — it is the identity provider's key, not ours to publish.
        signedIn: Boolean(m.subject),
        invitedBy: m.invitedBy,
        createdAt: m.createdAt,
        lastSeenAt: m.lastSeenAt,
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  });
});

membersRouter.post('/', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  // Only an owner may mint another owner. An admin promoting somebody past
  // themselves is a privilege escalation with extra steps.
  if (parsed.data.role === 'owner' && me.role !== 'owner') {
    res.status(403).json({ error: 'Only an owner can invite another owner.' });
    return;
  }
  if (rows(me.tenantId).some((m) => sameEmail(m.email, parsed.data.email))) {
    res.status(409).json({ error: 'That address is already in this workspace.' });
    return;
  }

  const membership: Membership = {
    tenantId: me.tenantId,
    email: parsed.data.email.trim(),
    role: parsed.data.role,
    invitedBy: me.email,
    createdAt: new Date().toISOString(),
  };
  if (!store.data.memberships) store.data.memberships = [];
  store.data.memberships.push(membership);
  await store.save();
  // No email is sent: the invite is a row that the address can claim on its
  // next sign-in. Telling somebody they can sign in is a thing this product
  // does not need to own.
  res.status(201).json({ email: membership.email, role: membership.role, signedIn: false });
});

membersRouter.patch('/:email', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const all = store.data.memberships ?? [];
  const target = all.find((m) => m.tenantId === me.tenantId && sameEmail(m.email, req.params.email));
  if (!target) {
    res.status(404).json({ error: 'Nobody by that address is in this workspace.' });
    return;
  }
  if (parsed.data.role === 'owner' && me.role !== 'owner') {
    res.status(403).json({ error: 'Only an owner can make somebody else an owner.' });
    return;
  }
  if (target.role === 'owner' && me.role !== 'owner') {
    res.status(403).json({ error: 'Only an owner can change an owner.' });
    return;
  }
  if (wouldOrphanWorkspace(all, me.tenantId, target, parsed.data.role)) {
    res.status(409).json({ error: 'This is the only owner. Make somebody else an owner first.' });
    return;
  }
  target.role = parsed.data.role;
  await store.save();
  res.json({ email: target.email, role: target.role, signedIn: Boolean(target.subject) });
});

membersRouter.delete('/:email', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const all = store.data.memberships ?? [];
  const target = all.find((m) => m.tenantId === me.tenantId && sameEmail(m.email, req.params.email));
  if (!target) {
    res.status(404).json({ error: 'Nobody by that address is in this workspace.' });
    return;
  }
  if (target.role === 'owner' && me.role !== 'owner') {
    res.status(403).json({ error: 'Only an owner can remove an owner.' });
    return;
  }
  if (wouldOrphanWorkspace(all, me.tenantId, target, 'removed')) {
    res.status(409).json({ error: 'This is the only owner. Make somebody else an owner first.' });
    return;
  }
  store.data.memberships = all.filter((m) => m !== target);
  await store.save();
  res.status(204).end();
});

/**
 * Open the workspace to a domain, or close it again.
 *
 * Owner-only, and never for a public mailbox provider: "anyone with a gmail
 * address may join" is not a workspace, it is a door left open.
 */
const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.in',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
]);

const domainSchema = z.object({ autoJoinDomain: z.string().trim().toLowerCase().nullable() });

membersRouter.patch('/', needs('owner'), async (req, res) => {
  const me = principalOf(req);
  const parsed = domainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const tenant = (store.data.tenants ?? []).find((t) => t.id === me.tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  const domain = parsed.data.autoJoinDomain;
  if (domain && PUBLIC_DOMAINS.has(domain)) {
    res.status(400).json({ error: `${domain} is a public mailbox provider. Invite people individually instead.` });
    return;
  }
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    res.status(400).json({ error: 'That is not a domain.' });
    return;
  }
  if (domain) tenant.autoJoinDomain = domain;
  else delete tenant.autoJoinDomain;
  await store.save();
  res.json({ id: tenant.id, name: tenant.name, autoJoinDomain: tenant.autoJoinDomain });
});
