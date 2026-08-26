import { Router } from 'express';
import { buildRunGraph } from '@realytica/agents';
import { findCase } from './cases';

/**
 * One orchestration, drawn as the graph it actually was.
 *
 * Derived on read rather than stored: the graph is a projection of
 * `case.intelligence` plus the deterministic screen, and persisting it would
 * create a second copy of the run that can disagree with the first. A case
 * that has never been through the agents still answers — with the screen node
 * alone, or with nothing — because "no runs yet" is a real state the canvas
 * has to draw, not an error.
 *
 * The build clock is passed in rather than read inside, so two calls a second
 * apart return byte-identical graphs and a selected node survives a refresh.
 */
export const flowRouter = Router({ mergeParams: true });

flowRouter.get<{ id: string }>('/', (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json(buildRunGraph(found, new Date().toISOString()));
});
