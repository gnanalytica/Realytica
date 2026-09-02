import { Router } from 'express';
import { capabilityWithRoutes, describeProviders, resolveRoute } from '@realytica/agents';

/**
 * Whether this deployment can run an agent at all.
 *
 * Realytica runs local-first: the deterministic screen is the product's floor
 * and works with zero credentials, so the client asks this up front and hides
 * what it cannot offer rather than discovering it from a 503.
 *
 * Everything else that was in this file drove the retired case surface — a
 * copilot, an explorer, an orchestration runner, all mounted under
 * `/api/cases/:id/agents`, which no route table has referenced since projects
 * replaced cases. The project cockpit has its own copilot and orchestrator,
 * and they were never these.
 */

export const agentsCapabilityRouter = Router();

agentsCapabilityRouter.get('/capability', (_req, res) => {
  // Routes come back from `capabilityWithRoutes` with `expectedGaps` empty:
  // resolving them needs a constructed provider, and the capability probe
  // must stay answerable on a deployment that has none. Filling them is this
  // layer's job, and it is worth doing here rather than in the client —
  // "no gaps" and "gaps not computed" are indistinguishable in the data, and
  // rendering the second as the first would claim a guarantee nobody checked.
  const capability = capabilityWithRoutes();
  res.json({
    ...capability,
    routes: (capability.routes ?? []).map(r => resolveRoute(r.agent).route),
    providers: describeProviders(),
  });
});
