import { Router } from 'express';
import { can } from '@realytica/shared';
import { principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { memoryPort } from '../graph/mem';
import { readFacts, readLint, readMemory, readPages } from '../graph/mem/read';
import { store } from '../store';

/**
 * What the project's memory has been told, newest first.
 *
 * Memory is told after a save and nothing waits for it, so this is what has
 * reached it, which can be a moment behind the record. An entry points at the
 * record by id, and the titles here are the record's as it stands now.
 *
 * With them, the facts memory holds: each value with its tag, who approved
 * it or who read it and whether it stands, what states it, and its dates.
 * And how many values the record holds that were not made facts, and why.
 * The assistant's own notes are among the facts, tagged as thoughts, and
 * `pages` is what they are about: one page for each thing with a note on it.
 *
 * `/lint` answers what looks wrong in the project's memory, read against the
 * record as it stands. It lists and changes nothing.
 *
 * With it, how many nodes the project's memory is. And, for the workspace's
 * admins, how many the whole database holds: a database with an allowance of
 * nodes counts the graph's and memory's together, and this is where the
 * number can be watched. It is every workspace's nodes and not this one's,
 * so nobody else is shown it. The count is asked beside the entries and is
 * not part of them: one that fails is left out of the answer and logged.
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
  let entries: Awaited<ReturnType<typeof readMemory>>;
  let held: Awaited<ReturnType<typeof readFacts>>;
  let pages: Awaited<ReturnType<typeof readPages>>;
  try {
    entries = await readMemory(project, Number.isFinite(limit) ? limit : undefined);
    held = await readFacts(project);
    pages = await readPages(project);
  } catch (err) {
    res.status(503).json({ error: `The memory store did not answer: ${(err as Error).message}` });
    return;
  }
  const counted = await memoryPort.count(project.id).catch((err: unknown) => {
    console.warn(`[memory] could not count the nodes of ${project.id}: ${(err as Error).message}`);
    return undefined;
  });
  const nodes = counted && (can(principalOf(req).role, 'admin') ? counted : { project: counted.project });
  res.json({ entries, facts: held.lines, factsHeld: held.of, withheld: held.withheld, pages, ...(nodes ? { nodes } : {}) });
});

projectMemoryRouter.get('/lint', workspaceOnly, async (req, res) => {
  const { projectId } = req.params as { projectId?: string };
  const project = store.data.projects?.find((held) => held.id === projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  try {
    res.json({ findings: await readLint(project) });
  } catch (err) {
    res.status(503).json({ error: `The memory store did not answer: ${(err as Error).message}` });
  }
});
