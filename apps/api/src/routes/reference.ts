import { Router } from 'express';
import { REFERENCE_DATA } from '@valytica/shared';

export const referenceRouter = Router();

referenceRouter.get('/', (_req, res) => {
  res.json(REFERENCE_DATA);
});
