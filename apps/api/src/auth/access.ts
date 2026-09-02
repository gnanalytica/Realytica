import type { Request } from 'express';
import {
  fullView,
  grantHasExpired,
  projectRecordIds,
  projectView,
  reachesEveryProject,
  sameEmail,
  type DdProject,
  type ProjectAccess,
  type ProjectGrant,
  type ProjectView,
} from '@realytica/shared';
import { store } from '../store';
import { principalOf } from './middleware';

/**
 * What this caller may do on this project, resolved once per request.
 *
 * Two questions with different answers. `accessTo` says whether they may be
 * here at all and how much of the file they get; `projectFor` turns that into
 * the redacted project every read hands out. Writes take a third path, because
 * the API mutates the real project rather than the projection and treating a
 * projection as a write gate would be a false sense of security.
 */

function grants(): ProjectGrant[] {
  if (!store.data.grants) store.data.grants = [];
  return store.data.grants;
}

export function grantsForProject(tenantId: string, projectId: string): ProjectGrant[] {
  return grants().filter((g) => g.tenantId === tenantId && g.projectId === projectId);
}

/**
 * The live grant for one person on one project, or nothing.
 *
 * An expired grant is treated exactly as no grant. Contractors churn and
 * nobody remembers to revoke, so an expiry the server enforces is the
 * difference between access ending and access being meant to end.
 */
export function liveGrant(tenantId: string, projectId: string, email: string): ProjectGrant | undefined {
  return grantsForProject(tenantId, projectId).find((g) => sameEmail(g.email, email) && !grantHasExpired(g));
}

export type Access =
  | { ok: true; access: ProjectAccess }
  /** Not for you. The caller answers 404 — a 403 would confirm the project exists. */
  | { ok: false };

export function accessTo(req: Request, project: DdProject): Access {
  const me = principalOf(req);
  const bootstrap = store.data.tenants?.[0]?.id;
  if ((project.tenantId ?? bootstrap) !== me.tenantId) return { ok: false };

  if (reachesEveryProject(me.role)) return { ok: true, access: { kind: 'full' } };

  const grant = liveGrant(me.tenantId, project.id, me.email);
  if (!grant) return { ok: false };
  return { ok: true, access: { kind: 'granted', grant, email: me.email } };
}

/** The project as this caller may read it. Cached on the request. */
export function viewFor(req: Request, project: DdProject): ProjectView {
  const cached = (req as Request & { projectView?: ProjectView }).projectView;
  if (cached && cached.project.id === project.id) return cached;
  const resolved = accessTo(req, project);
  const view = resolved.ok ? projectView(project, resolved.access) : fullView(project);
  (req as Request & { projectView?: ProjectView }).projectView = view;
  return view;
}

/** The redacted project, for the many routes that just serialise one. */
export function projectFor(req: Request, project: DdProject): DdProject {
  return viewFor(req, project).project;
}

/**
 * Whether a caller with a narrowed grant is a reviewer rather than a
 * contributor. Staff and above are never reviewers here.
 */
export function isReadOnlyOn(req: Request, project: DdProject): boolean {
  const resolved = accessTo(req, project);
  if (!resolved.ok) return true;
  return resolved.access.kind === 'granted' && resolved.access.grant.role === 'reviewer';
}

/**
 * The ids on this project that this caller cannot reach.
 *
 * Everything on the real file, minus everything on their projection. It does
 * not matter what kind of record an id names — if it exists and they cannot
 * see it, they cannot write to it either. Cached on the request, because a
 * write route asks once and the walk is the expensive part.
 */
export function outOfReach(req: Request, project: DdProject): ReadonlySet<string> {
  const key = req as Request & { outOfReach?: { id: string; ids: Set<string> } };
  if (key.outOfReach && key.outOfReach.id === project.id) return key.outOfReach.ids;

  const view = viewFor(req, project);
  const ids = new Set<string>();
  if (!view.complete) {
    const seen = projectRecordIds(view.project);
    for (const id of projectRecordIds(project)) if (!seen.has(id)) ids.add(id);
  }
  key.outOfReach = { id: project.id, ids };
  return ids;
}

export class WriteRefused extends Error {
  /** 404 for a thing they may not know exists; 403 when the refusal is honest. */
  readonly status: 403 | 404;

  constructor(message: string, status: 403 | 404 = 404) {
    super(message);
    this.name = 'WriteRefused';
    this.status = status;
  }
}

/**
 * The write gate.
 *
 * Redaction secures reading; this secures changing. A check outside the grant
 * is not in the projection, but the route mutates the real project, so without
 * this a contractor could record a legal check by posting its id.
 *
 * The ids are taken flat rather than by kind on purpose: the question is never
 * "is this a valid check id" — the handler answers that — but "is this a thing
 * they can see". One id out of reach fails the whole call rather than being
 * quietly dropped, so a request that half-applied is impossible.
 */
export function assertMayWrite(
  req: Request,
  project: DdProject,
  ids: readonly (string | undefined | null)[] = [],
): void {
  const resolved = accessTo(req, project);
  if (!resolved.ok) throw new WriteRefused('Project not found');
  if (resolved.access.kind === 'full') return;

  if (resolved.access.grant.role !== 'contributor') {
    throw new WriteRefused('You have been given read-only access to this project.', 403);
  }

  const blocked = outOfReach(req, project);
  for (const id of ids) {
    if (id && blocked.has(id)) {
      throw new WriteRefused('That is not on this project.');
    }
  }
}

/** A collaborator may not do a thing that belongs to the workspace as a whole. */
export function assertWorkspaceWork(req: Request, project: DdProject, what: string): void {
  const resolved = accessTo(req, project);
  if (!resolved.ok) throw new WriteRefused('Project not found');
  if (resolved.access.kind === 'full') return;
  throw new WriteRefused(`${what} is not yours to change on this project.`, 403);
}
