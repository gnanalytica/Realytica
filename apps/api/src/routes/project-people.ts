import { Router } from 'express';
import { z } from 'zod';
import {
  GRANT_AREAS,
  PROJECT_ROLES,
  SCOPE_KEYS,
  createProjectGrant,
  patchProjectGrant,
  sameEmail,
  type GrantArea,
  type Membership,
  type ProjectRole,
  type ScopeKey,
} from '@realytica/shared';
import { randomUUID } from 'node:crypto';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';

/**
 * Who is on this project, and how much of it they get.
 *
 * Staffing a site is the developer's job, so this is admin-only and mounted
 * under the project rather than beside the workspace member list: the question
 * "who is on the Whitefield file" is asked while looking at the Whitefield
 * file, not on a settings screen two clicks away.
 *
 * A grant is written against an address, exactly as an invite is, so a site
 * can be staffed before the contractor has ever signed in. Adding somebody who
 * is not yet in the workspace invites them as a collaborator in the same
 * motion — the alternative is two screens and a step everybody forgets, and a
 * collaborator with no grant can see nothing anyway.
 */

export const projectPeopleRouter = Router({ mergeParams: true });

const scopeSchema = z.enum(SCOPE_KEYS as [ScopeKey, ...ScopeKey[]]);
const areaSchema = z.enum(GRANT_AREAS as [GrantArea, ...GrantArea[]]);
const roleSchema = z.enum(PROJECT_ROLES as [ProjectRole, ...ProjectRole[]]);

const reachSchema = z.object({
  role: roleSchema.optional(),
  allAssessments: z.boolean().optional(),
  assessmentIds: z.array(z.string()).max(200).optional(),
  allScopes: z.boolean().optional(),
  scopeKeys: z.array(scopeSchema).max(64).optional(),
  areas: z.array(areaSchema).max(16).optional(),
  expiresAt: z.string().datetime().or(z.literal('')).optional(),
  note: z.string().max(500).optional(),
});

const addSchema = reachSchema.extend({ email: z.string().trim().email() });

function projectIdOf(req: { params: Record<string, string | undefined> }): string {
  return req.params.projectId ?? '';
}

function grants() {
  if (!store.data.grants) store.data.grants = [];
  return store.data.grants;
}

function members(tenantId: string): Membership[] {
  return (store.data.memberships ?? []).filter((m) => m.tenantId === tenantId);
}

projectPeopleRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const projectId = projectIdOf(req);
  const roster = members(me.tenantId);
  res.json({
    people: grants()
      .filter((g) => g.tenantId === me.tenantId && g.projectId === projectId)
      .map((g) => ({
        ...g,
        // Whether the address has ever been claimed, so a grant that is not
        // working reads as "not signed in" rather than as silence.
        name: roster.find((m) => sameEmail(m.email, g.email))?.name,
        signedIn: Boolean(roster.find((m) => sameEmail(m.email, g.email))?.subject),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    // The staff who reach this project without a grant, so the panel can say
    // so rather than reading as though nobody is on the file.
    staff: roster
      .filter((m) => m.role !== 'collaborator')
      .map((m) => ({ email: m.email, name: m.name, role: m.role }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  });
});

projectPeopleRouter.post('/', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const projectId = projectIdOf(req);
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const { email, ...reach } = parsed.data;
  if (grants().some((g) => g.tenantId === me.tenantId && g.projectId === projectId && sameEmail(g.email, email))) {
    res.status(409).json({ error: 'That address is already on this project.' });
    return;
  }

  const existing = members(me.tenantId).find((m) => sameEmail(m.email, email));
  if (existing && existing.role !== 'collaborator') {
    // Staff already reach every project. Writing a grant for them would look
    // like it narrowed their access, and it would not.
    res.status(409).json({ error: `${existing.email} is workspace staff and already reaches every project.` });
    return;
  }
  if (!existing) {
    store.data.memberships ??= [];
    store.data.memberships.push({
      tenantId: me.tenantId,
      email: email.trim(),
      role: 'collaborator',
      invitedBy: me.email,
      createdAt: new Date().toISOString(),
    });
  }

  const grant = createProjectGrant(
    { email, ...reach, expiresAt: reach.expiresAt || undefined },
    { id: `grn_${randomUUID()}`, tenantId: me.tenantId, projectId, createdBy: me.email },
  );
  grants().push(grant);
  await store.save();
  res.status(201).json(grant);
});

projectPeopleRouter.patch('/:grantId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = reachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const grant = grants().find(
    (g) => g.id === req.params.grantId && g.tenantId === me.tenantId && g.projectId === projectIdOf(req),
  );
  if (!grant) {
    res.status(404).json({ error: 'Nobody by that record is on this project.' });
    return;
  }
  patchProjectGrant(grant, { ...parsed.data, expiresAt: parsed.data.expiresAt });
  await store.save();
  res.json(grant);
});

projectPeopleRouter.delete('/:grantId', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const before = grants().length;
  store.data.grants = grants().filter(
    (g) => !(g.id === req.params.grantId && g.tenantId === me.tenantId && g.projectId === projectIdOf(req)),
  );
  if (store.data.grants.length === before) {
    res.status(404).json({ error: 'Nobody by that record is on this project.' });
    return;
  }
  // The membership stays. Taking somebody off one site is not throwing them
  // out of the workspace, and doing both from one button is how you lose the
  // contractor who is on three other files.
  await store.save();
  res.status(204).end();
});
