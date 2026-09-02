import { Router } from 'express';
import { allDescriptors } from '@realytica/agents';

/**
 * The catalogue of external sources this build knows about.
 *
 * Including the ones that cannot be reached, which is the point: "we did not
 * look" and "we looked and it was down" are different answers, and a
 * catalogue that hides the unreachable ones can only give the first.
 *
 * The rest of this file — per-case applicability, ingestion runs, and the
 * memory recall behind them — served the retired case surface and was mounted
 * at `/api/cases/:id/knowledge`, which nothing has routed to since projects
 * replaced cases. Project memory has its own path through `recallForProject`.
 */
export const sourcesRouter = Router();

sourcesRouter.get('/', (_req, res) => {
  res.json(allDescriptors());
});
