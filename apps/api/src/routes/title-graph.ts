import { Router } from 'express';
import { buildTitleGraph } from '@valytica/shared';
import { findCase } from './cases';

/**
 * The title graph's nodes and edges.
 *
 * `ScreenResult.titleGraph` is a `TitleGraphSummary` — chains, breaks,
 * contradictions, an integrity score — deliberately not the graph itself, so
 * every screen result does not carry a structure only one view draws. That
 * left the client with findings *about* a graph it could not see, and the
 * findings are structural: "no instrument on file conveys title, so the chain
 * has no root" is a statement about shape.
 *
 * Rebuilt on read rather than stored, exactly as the run graph is, and for the
 * same reason: a stored projection can disagree with what it describes. The
 * build is deterministic and measured at well under a millisecond per case.
 */
export const titleGraphRouter = Router({ mergeParams: true });

titleGraphRouter.get<{ id: string }>('/', (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json(buildTitleGraph(found, new Date().toISOString()));
});
