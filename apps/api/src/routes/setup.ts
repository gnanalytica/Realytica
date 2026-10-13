/**
 * Set up, as it stands: one read of everything that can be connected or
 * scheduled, for the page that lists it (`setup.ts` in the shared model
 * says each row).
 *
 * GET /api/setup
 *
 * Read-only, and it changes no rule. Each fact is one another route already
 * answers: the outside channels (`/outside/status`), a project's folder
 * (`/connector`), the law sources (`/law-watch`), keys and webhooks
 * (`/integrations`). What it adds is whether the timer and a model are set
 * up, which were said only as asides on other pages. The firm's own people
 * read it; keys and webhooks are in it for a firm admin only, as on
 * Integrations.
 */
import { Router } from 'express';
import { envName, fileSweepModelSetUp, readEnv } from '@realytica/agents';
import { can, reachesEveryProject, setupShown, type SetupFacts } from '@realytica/shared';
import { needs, principalOf } from '../auth/middleware';
import { providerFor } from '../connectors';
import { sealingAvailable } from '../flows/secret-box';
import { readIntegrations } from '../integrations/documents';
import { loadLawWatch } from '../law-watch';
import { outsideStatus } from '../outside/config';
import { store } from '../store';

export const setupRouter = Router();

setupRouter.get('/', needs('read'), async (req, res, next) => {
  try {
    const me = principalOf(req);
    // Who else the firm writes to and what it has connected is not for somebody working from a grant.
    if (!reachesEveryProject(me.role)) {
      res.status(403).json({ error: 'Set up is for the firm’s own people.' });
      return;
    }
    const bootstrap = store.data.tenants?.[0]?.id;
    const projects = (store.data.projects ?? []).filter((project) => (project.tenantId ?? bootstrap) === me.tenantId && project.status !== 'closed');
    const drive = providerFor('google_drive');
    const facts: SetupFacts = {
      mail: Boolean(readEnv('RESEND_API_KEY')),
      channels: outsideStatus(),
      folders: { configured: drive.configured(), ...(drive.address() ? { address: drive.address() } : {}) },
      timer: Boolean(process.env.CRON_SECRET),
      model: fileSweepModelSetUp(),
      law: (await loadLawWatch(me.tenantId)).sources,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        reference: project.reference,
        ...(project.connector ? { connector: project.connector } : {}),
        ...(project.reportDay?.setting ? { reportDay: project.reportDay.setting } : {}),
      })),
      names: { mail: envName('RESEND_API_KEY'), folders: 'GOOGLE_SERVICE_ACCOUNT_JSON', timer: 'CRON_SECRET', model: envName('API_KEY'), webhooks: envName('CREDENTIAL_KEY') },
    };
    if (can(me.role, 'admin')) {
      const [{ keys }, { endpoints }] = await Promise.all([readIntegrations('keys'), readIntegrations('endpoints')]);
      const now = Date.now();
      const mine = endpoints.filter((endpoint) => endpoint.tenantId === me.tenantId);
      facts.integrations = {
        keys: keys.filter((key) => key.tenantId === me.tenantId && !key.revokedAt && !(key.expiresAt && Date.parse(key.expiresAt) <= now)).length,
        webhooks: sealingAvailable(),
        endpoints: mine.length,
        failing: mine.filter((endpoint) => endpoint.failingSince).map((endpoint) => ({ url: endpoint.url, since: endpoint.failingSince! })),
      };
    }
    res.json(setupShown(facts));
  } catch (err) {
    next(err);
  }
});
