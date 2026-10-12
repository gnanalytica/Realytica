/**
 * What the daily review suggested, and a person's answer to it.
 *
 * On a project (`/api/projects/:projectId/daily-review`):
 *
 * GET    /                         the suggestions nobody has decided, whether a model is set up, and where this person decides
 * POST   /:suggestionId/accept     it becomes a finding or a risk, made the way any other is
 * POST   /:suggestionId/dismiss    set aside with a reason, and never raised again
 *
 * For the firm's own people: somebody working from a grant is answered as if
 * nothing were here (`workspaceOnly`), since a suggestion is read off the
 * whole file. Reading is any of theirs. Accepting and dismissing is for a
 * lead or a signer of the suggestion's department, by the project's team
 * list or the firm role's default (`decidesFor`), and the shared function
 * does the refusing.
 *
 * The review itself runs on the daily timer (`../cron/file-sweep.ts`). No
 * route here asks a model anything.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DEPARTMENT_KEYS,
  DecisionRefused,
  SWEEP_LIMITS,
  acceptSweepSuggestion,
  actorOf,
  dismissSweepSuggestion,
  openSweepSuggestions,
  projectDepartments,
  type DdProject,
  type DepartmentKey,
  type FileSweepState,
  type SweepSuggestion,
} from '@realytica/shared';
import { fileSweepModelSetUp } from '@realytica/agents';
import { decidesFor } from '../auth/access';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { readSweepState, writeSweepState } from '../cron/file-sweep';
import { store } from '../store';

type Params = { projectId: string; suggestionId?: string };

export const fileSweepRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
fileSweepRouter.use(workspaceOnly);

// Reading is any of them's. Deciding is for those who may change a record, and then for a lead or signer of the department.
fileSweepRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

function projectOf(req: Request, res: Response): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

/** A suggestion's id, as a path gives it. One that is no id names nothing. */
const suggestionId = z.string().min(1).max(80).regex(/^[\w-]+$/);

export interface DailyReviewShown {
  /** Whether a model is set up. Without one the review does not run. */
  model: boolean;
  /** When the project was last reviewed. */
  sweptAt?: string;
  suggestions: SweepSuggestion[];
  /** The departments whose suggestions this person may accept or dismiss. */
  decidesIn: DepartmentKey[];
}

function shown(req: Request, project: DdProject, state: FileSweepState): DailyReviewShown {
  const mayDecide = decidesFor(req, project);
  const reach = new Set<DepartmentKey>([...projectDepartments(project), ...state.suggestions.map((held) => held.department)]);
  return {
    model: fileSweepModelSetUp(),
    ...(state.sweptAt ? { sweptAt: state.sweptAt } : {}),
    suggestions: openSweepSuggestions(state),
    decidesIn: DEPARTMENT_KEYS.filter((department) => reach.has(department) && mayDecide(department)),
  };
}

function fail(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  res.status(err instanceof DecisionRefused ? 403 : /^No suggestion by that id/.test(message) ? 404 : / already\.$/.test(message) ? 409 : 400).json({ error: message });
}

/** What the review keeps, or a 503 said plainly: a decision is never made on a guess at what is held. */
async function held(res: Response, projectId: string): Promise<FileSweepState | undefined> {
  try {
    return await readSweepState(projectId);
  } catch {
    res.status(503).json({ error: 'The daily review’s suggestions could not be read just now.' });
    return undefined;
  }
}

fileSweepRouter.get('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const state = await held(res, project.id);
  if (state) res.json(shown(req, project, state));
});

fileSweepRouter.post('/:suggestionId/accept', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const id = suggestionId.safeParse((req.params as Params).suggestionId);
  const parsed = z.object({ as: z.enum(['finding', 'risk']).optional() }).safeParse(req.body ?? {});
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Say which suggestion, and whether it is a finding or a risk.' });
    return;
  }
  const state = await held(res, project.id);
  if (!state) return;
  try {
    const { record, suggestion } = acceptSweepSuggestion(project, state, id.data, { actor: actorOf(principalOf(req)), ...(parsed.data.as ? { as: parsed.data.as } : {}) }, decidesFor(req, project));
    // The record first: a finding on the file with its suggestion still open is put right by a second answer, a suggestion marked accepted with no finding is not.
    await store.save();
    await writeSweepState(project.id, state);
    res.json({ ...shown(req, project, state), project, record: { type: suggestion.record!.type, id: record.id } });
  } catch (err) {
    fail(res, err);
  }
});

fileSweepRouter.post('/:suggestionId/dismiss', async (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  const id = suggestionId.safeParse((req.params as Params).suggestionId);
  const parsed = z.object({ reason: z.string().trim().min(3).max(SWEEP_LIMITS.reason) }).safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Say why it is dismissed, in a line.' });
    return;
  }
  const state = await held(res, project.id);
  if (!state) return;
  try {
    dismissSweepSuggestion(state, id.data, { actor: actorOf(principalOf(req)), reason: parsed.data.reason }, decidesFor(req, project));
    await writeSweepState(project.id, state);
    res.json(shown(req, project, state));
  } catch (err) {
    fail(res, err);
  }
});
