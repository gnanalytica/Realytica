import type { NextFunction, Request, Response } from 'express';
import type { DdProject, GrantArea } from '@realytica/shared';
import { store } from '../store';
import { accessTo, outOfReach, projectFor } from './access';

/**
 * The guards that make a hundred project routes safe without editing a hundred
 * project routes.
 *
 * Doing this per handler is the pattern that fails: it works the day it is
 * written and springs a leak the first time somebody adds a route and does not
 * know they were supposed to. So all of these are mounted once, on the router,
 * and a route written next year inherits them.
 *
 *   `redactResponses` walks what a handler is about to send and swaps any
 *   project in it for the one this caller may read. It covers the shape almost
 *   every route returns — the project itself, or a record beside it.
 *
 *   `gateWrites` is its other half. Redaction hands out a copy; every write
 *   route mutates the original, so reading correctly and writing carelessly
 *   would look perfect and lose the file.
 *
 *   `requireArea` gates a whole path prefix, for the routes that answer with
 *   an area directly rather than through a project: `/valuation`, `/reports`,
 *   `/decisions`, `/sheets`.
 *
 *   `workspaceOnly` and `workspaceWrites` keep the file's own shape — its
 *   stage, its assessments, the orchestrator — out of a collaborator's hands.
 *
 * The first two are broad and shallow; the rest are narrow and certain.
 * Neither kind is enough alone, which is why there are both.
 */

function projectOf(req: Request): DdProject | undefined {
  const id = (req.params as { projectId?: string }).projectId;
  if (!id) return undefined;
  return store.data.projects?.find((p) => p.id === id);
}

/** Does this look like a project rather than some other record? */
function isProject(value: unknown): value is DdProject {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DdProject>;
  return typeof v.id === 'string' && typeof v.reference === 'string' && Array.isArray(v.assessments);
}

export function redactResponses(req: Request, res: Response, next: NextFunction): void {
  const project = projectOf(req);
  if (!project) {
    next();
    return;
  }
  const resolved = accessTo(req, project);
  // Staff and above read the file as it is; there is nothing to swap and no
  // reason to pay for walking every response body.
  if (!resolved.ok || resolved.access.kind === 'full') {
    next();
    return;
  }

  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    if (isProject(body)) return original(projectFor(req, body));
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const bag = body as Record<string, unknown>;
      if (isProject(bag.project)) {
        return original({ ...bag, project: projectFor(req, bag.project) });
      }
    }
    return original(body);
  };
  next();
}

/**
 * Refuse any write that names something the caller cannot see.
 *
 * Mounted once, for the same reason as the redactor: a per-handler check is a
 * decision per handler, and the one somebody forgets is the leak. It does not
 * need to know which route it is guarding — it takes every id-shaped string
 * out of the path and the body and refuses the request if any of them names a
 * record that exists on the file but not in this caller's projection.
 *
 * Two routes take their targets in a multipart body, which is parsed after
 * this runs; those call `assertMayWrite` themselves once they have it.
 */
export function gateWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const project = projectOf(req);
  if (!project) {
    next();
    return;
  }
  const resolved = accessTo(req, project);
  if (!resolved.ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  if (resolved.access.kind === 'full') {
    next();
    return;
  }
  // A reviewer was put on this project to read it. Saying so is honest: they
  // know the project exists, so there is nothing left to protect by lying.
  if (resolved.access.grant.role !== 'contributor') {
    res.status(403).json({ error: 'You have been given read-only access to this project.' });
    return;
  }

  const blocked = outOfReach(req, project);
  if (blocked.size === 0) {
    next();
    return;
  }
  for (const candidate of named(req)) {
    if (blocked.has(candidate)) {
      res.status(404).json({ error: 'That is not on this project.' });
      return;
    }
  }
  next();
}

/** Every string the request names, wherever it names it. */
function* named(req: Request): Generator<string> {
  for (const segment of req.url.split('?')[0]!.split('/')) if (segment) yield segment;
  yield* strings(req.body, 0);
}

function* strings(value: unknown, depth: number): Generator<string> {
  if (depth > 8) return;
  if (typeof value === 'string') {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* strings(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) yield* strings(item, depth + 1);
  }
}

/**
 * Refuse a whole path prefix unless the grant carries the area.
 *
 * A 404 rather than a 403, for the same reason a project in another workspace
 * is a 404: the question "is there a valuation on this file" is exactly what
 * somebody without access to it would like answered.
 */
export function requireArea(area: GrantArea) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const project = projectOf(req);
    if (!project) {
      next();
      return;
    }
    const resolved = accessTo(req, project);
    if (!resolved.ok) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (resolved.access.kind === 'full') {
      next();
      return;
    }
    if (!resolved.access.grant.areas.includes(area)) {
      res.status(404).json({ error: 'Not found on this project' });
      return;
    }
    next();
  };
}

/**
 * Refuse a path prefix to anybody working from a grant, whatever it says.
 *
 * For the surfaces that are the workspace thinking about the whole file rather
 * than work on part of it: the orchestrator, AI drafts, the audit-facing run
 * ledger, the model capabilities. No area ticks these on.
 */
export function workspaceOnly(req: Request, res: Response, next: NextFunction): void {
  guardWorkspace(req, res, next, false);
}

/**
 * The same, for a path a collaborator may read but not change: the stage of
 * the project, its assets, which assessments are on it, the graph annotations.
 * Being given a scope to work on is not being given the shape of the file.
 */
export function workspaceWrites(req: Request, res: Response, next: NextFunction): void {
  guardWorkspace(req, res, next, true);
}

function guardWorkspace(req: Request, res: Response, next: NextFunction, readsAreFine: boolean): void {
  if (readsAreFine && (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')) {
    next();
    return;
  }
  const project = projectOf(req);
  if (!project) {
    next();
    return;
  }
  const resolved = accessTo(req, project);
  if (!resolved.ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  if (resolved.access.kind !== 'full') {
    if (readsAreFine) {
      res.status(403).json({ error: 'That is not yours to change on this project.' });
      return;
    }
    res.status(404).json({ error: 'Not found on this project' });
    return;
  }
  next();
}
