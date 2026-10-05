import { Router } from 'express';
import { workspaceOnly } from '../auth/project-guard';
import { memoryPort } from '../graph/mem';
import { readMemory } from '../graph/mem/read';
import { store } from '../store';

/**
 * What the project's memory has been told, newest first.
 *
 * Memory is told after a save and nothing waits for it, so this is what has
 * reached it, which can be a moment behind the record. An entry points at the
 * record by id, and the titles here are the record's as it stands now.
 *
 * With it, how many nodes the project's memory is and how many the whole
 * database holds. A database with an allowance of nodes counts the graph's
 * and memory's together, and this is where the number can be watched.
 *
 * For the firm's own people. The titles are taken from the whole record, so
 * `workspaceOnly` stands in front of the one route: somebody outside the
 * workspace, or working from a grant, is answered as if nothing were here.
 * Mounted on the app beside the project routes, after the sign-in every
 * route under `/api` has.
 */
export const projectMemoryRouter = Router({ mergeParams: true });

projectMemoryRouter.get('/', workspaceOnly, async (req, res) => {
  const { projectId } = req.params as { projectId?: string };
  const project = store.data.projects?.find((held) => held.id === projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const limit = Number(req.query.limit);
  try {
    const entries = await readMemory(project, Number.isFinite(limit) ? limit : undefined);
    res.json({ entries, nodes: await memoryPort.count(project.id) });
  } catch (err) {
    res.status(503).json({ error: `The memory store did not answer: ${(err as Error).message}` });
  }
});
