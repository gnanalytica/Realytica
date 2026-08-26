/**
 * What has gone out of date on a case.
 *
 * Computed on every read rather than stored, which is the whole point — a
 * cached staleness report is a contradiction. See `buildStaleness` in the
 * shared package for the argument.
 */

import { Router } from 'express';
import { REFERENCE_DATA, buildStaleness } from '@valytica/shared';
import { findCase } from './cases';

export const stalenessRouter = Router({ mergeParams: true });

stalenessRouter.get<{ id: string }>('/', (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json(buildStaleness(found, REFERENCE_DATA, new Date().toISOString()));
});
