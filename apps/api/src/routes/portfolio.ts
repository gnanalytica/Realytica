import { Router } from 'express';
import { portfolioView, reachesEveryProject } from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';
import { liveGrant, projectFor } from '../auth/access';

/**
 * The firm's engagements, across every file the caller can reach.
 *
 * Built from each caller's projection, like My work, so it needs no access
 * rule of its own: a collaborator sees the pipeline of the files they are on,
 * with only what their grant reaches inside each.
 */
export const portfolioRouter = Router();

portfolioRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const bootstrap = store.data.tenants?.[0]?.id;
  const mine = (store.data.projects ?? []).filter((p) => (p.tenantId ?? bootstrap) === me.tenantId);
  const reachable = reachesEveryProject(me.role)
    ? mine
    : mine.filter((p) => liveGrant(me.tenantId, p.id, me.email));
  const asked = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : undefined;
  res.json(portfolioView(reachable.map((p) => projectFor(req, p)), new Date().toISOString(), 14, asked));
});
