/**
 * Another system reading from Realytica, and being told by it.
 *
 * Mounted once, ahead of sign-in, because it holds the one surface a person's
 * sign-in does not open and an API key does:
 *
 * GET    /api/v1/projects                        the projects the key reaches
 * GET    /api/v1/projects/:projectId             one project's summary
 * GET    /api/v1/projects/:projectId/alerts      its open alerts (`?state=all` for resolved too)
 * GET    /api/v1/projects/:projectId/reports     its issued reports
 * GET    /api/v1/projects/:projectId/papers-owed the papers its checklist still waits for
 *
 * Read-only. A key writes nothing in this version. Each answer is built from
 * the view of the project the app hands one of the firm's own readers
 * (`projectView`), and from the same summaries the app's pages show, so a key
 * is told nothing the app would withhold; and from what people have settled:
 * a report is listed once a person has issued it, and a paper a matcher only
 * suggests is still owed.
 *
 * A key opens `/api/v1` and nothing else. Sent to any other route it is
 * refused here, before sign-in is asked, whatever the sign-in mode.
 *
 * The firm's own side is behind sign-in, for an owner or a manager:
 *
 * GET    /api/integrations                       keys, endpoints, recent deliveries
 * POST   /api/integrations/keys                  make a key (shown once)
 * DELETE /api/integrations/keys/:id              revoke one
 * POST   /api/integrations/endpoints             register an address (secret shown once)
 * DELETE /api/integrations/endpoints/:id         remove one
 * POST   /api/integrations/endpoints/:id/test    send it a test delivery
 */

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { envName, readEnv } from '@realytica/agents';
import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_LABEL,
  WEBHOOK_EVENTS,
  checklistOwed,
  projectView,
  toProjectSummary,
  type ApiKeyScope,
  type DdProject,
  type WebhookEventType,
} from '@realytica/shared';
import { authenticate, needs, principalOf } from '../auth/middleware';
import { sealingAvailable } from '../flows/secret-box';
import { rateLimit } from '../http/hardening';
import { readIntegrations, type ApiKeyRecord } from '../integrations/documents';
import { API_KEY_PREFIX, apiKeyForToken, createApiKey, keyReaches, publicApiKey, recordKeyUse, revokeApiKey } from '../integrations/keys';
import { forgetListeners } from '../integrations/observe';
import { WebhookUrlRefused, createEndpoint, publicDelivery, publicEndpoint, removeEndpoint, testEndpoint } from '../integrations/webhooks';
import { finishAfterReply } from '../runs/background';
import { store } from '../store';

export const integrationsRouter = Router();

function bearer(req: Request): string | undefined {
  const [scheme, token] = (req.header('authorization') ?? '').trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** Express 4 does not catch a rejected handler: hand what one throws to the error handler. */
const safely =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next);
  };

/* ==================================================================== */
/* /api/v1: what a key reads                                             */
/* ==================================================================== */

type KeyedRequest = Request & { apiKey?: ApiKeyRecord; keyProject?: DdProject };

/** How many requests one key may make a minute on one instance. */
const KEY_LIMIT_WINDOW_MS = 60_000;
const keyBuckets = new Map<string, { count: number; resetAt: number }>();

function keyLimit(): number {
  const raw = Number(readEnv('RATE_LIMIT_KEY'));
  return Number.isFinite(raw) && raw > 0 ? raw : 120;
}

/** Counted by key, not by address: two systems behind one address each have their own budget. */
function overLimit(keyId: string, now: number): number {
  const bucket = keyBuckets.get(keyId);
  if (!bucket || bucket.resetAt <= now) {
    for (const [id, held] of keyBuckets) if (held.resetAt <= now) keyBuckets.delete(id);
    keyBuckets.set(keyId, { count: 1, resetAt: now + KEY_LIMIT_WINDOW_MS });
    return 0;
  }
  bucket.count += 1;
  return bucket.count > keyLimit() ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0;
}

const v1 = Router();

v1.use((req: KeyedRequest, res: Response, next: NextFunction) => {
  const token = bearer(req);
  void (token ? apiKeyForToken(token) : Promise.resolve(undefined)).then((key) => {
    if (!key) {
      // One answer for no key, a made-up one, a revoked one and an expired one.
      res.status(401).json({ error: 'Send a valid API key: Authorization: Bearer rlk_…' });
      return;
    }
    req.apiKey = key;
    // Every request a key makes is written down, the refused ones too. Promised now, while the platform is still listening, and written once the answer is out.
    finishAfterReply(
      new Promise<void>((done) => {
        res.once('close', () => {
          recordKeyUse({ at: new Date().toISOString(), keyId: key.id, method: req.method, path: req.path, status: res.statusCode })
            .catch((err: Error) => console.warn(`[integrations] could not record a use of ${key.id}: ${err.message}`))
            .finally(done);
        });
      }),
    );
    const wait = overLimit(key.id, Date.now());
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: `Too many requests. A key may make ${keyLimit()} a minute; try again in ${wait}s.` });
      return;
    }
    next();
  }, next);
});

function keyOf(req: Request): ApiKeyRecord {
  const key = (req as KeyedRequest).apiKey;
  if (!key) throw new Error('Route reached without an API key');
  return key;
}

/** Refuse a key that was not given this scope. */
const scope =
  (wanted: ApiKeyScope): RequestHandler =>
  (req, res, next) => {
    if (keyOf(req).scopes.includes(wanted)) next();
    else res.status(403).json({ error: `This key cannot read that. It needs the scope ${wanted} (${API_KEY_SCOPE_LABEL[wanted]}).` });
  };

/** The firm's projects this key reaches, each as one of the firm's own readers is handed it. */
function reachable(key: ApiKeyRecord): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return (store.data.projects ?? []).filter((project) => keyReaches(key, project, bootstrap)).map((project) => projectView(project, { kind: 'full' }).project);
}

v1.get('/projects', scope('projects:read'), (req, res) => {
  res.json({ projects: reachable(keyOf(req)).map(toProjectSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
});

/** A project in another firm, off the key's list, or not there at all: one 404, which says none of the three. */
v1.param('projectId', (req: KeyedRequest, res, next, id: string) => {
  void store
    .syncProject(id)
    .catch(() => undefined)
    .then(() => {
      const project = reachable(keyOf(req)).find((held) => held.id === id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      req.keyProject = project;
      next();
    });
});

const projectOf = (req: Request): DdProject => (req as KeyedRequest).keyProject!;

v1.get('/projects/:projectId', scope('projects:read'), (req, res) => {
  res.json({ project: toProjectSummary(projectOf(req)) });
});

v1.get('/projects/:projectId/alerts', scope('projects:read'), (req, res) => {
  const all = req.query.state === 'all';
  const alerts = (projectOf(req).alerts ?? [])
    .filter((alert) => all || !alert.resolvedAt)
    .map((alert) => ({
      id: alert.id,
      key: alert.key,
      department: alert.department,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      dueOn: alert.dueOn ?? null,
      raisedAt: alert.raisedAt,
      resolvedAt: alert.resolvedAt ?? null,
    }));
  res.json({ alerts });
});

v1.get('/projects/:projectId/reports', scope('reports:read'), (req, res) => {
  // Issued only: a draft is nobody's statement yet.
  const reports = projectOf(req)
    .reports.filter((report) => report.status === 'issued')
    .map((report) => ({
      id: report.id,
      kind: report.kind,
      title: report.title,
      signedBy: report.signedBy ?? null,
      signedRole: report.signedRole ?? null,
      issuedAt: report.signedAt ?? null,
      generatedAt: report.generatedAt,
    }));
  res.json({ reports });
});

v1.get('/projects/:projectId/papers-owed', scope('documents:read'), (req, res) => {
  const owed = checklistOwed(projectOf(req));
  res.json({
    total: owed.total,
    owed: owed.owed,
    parties: owed.parties.map((party) => ({
      owedBy: party.owedBy ?? null,
      papers: party.lines.map((line) => ({
        id: line.item.id,
        title: line.item.title,
        department: line.item.department,
        stage: line.item.stage ?? null,
        package: line.item.package ?? null,
        status: line.status,
        askedOf: line.askedOf ?? null,
        dueAt: line.dueAt ?? null,
        overdue: Boolean(line.overdue),
      })),
    })),
  });
});

v1.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

integrationsRouter.use('/v1', v1);

/* ==================================================================== */
/* A key anywhere else                                                   */
/* ==================================================================== */

integrationsRouter.use((req, res, next) => {
  if (bearer(req)?.startsWith(API_KEY_PREFIX)) {
    res.status(401).json({ error: 'An API key is accepted only under /api/v1.' });
    return;
  }
  next();
});

/* ==================================================================== */
/* /api/integrations: the firm's own side                                */
/* ==================================================================== */

/** How many live keys and endpoints one firm may hold. */
const MOST_KEYS = 50;
const MOST_ENDPOINTS = 20;
const DELIVERIES_SHOWN = 50;

const keySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
  projectIds: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
});

const endpointSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
});

const idSchema = z.string().regex(/^[a-z]{3}_[0-9a-f]{12}$/);

const admin = Router();

function firmProjects(tenantId: string): DdProject[] {
  const bootstrap = store.data.tenants?.[0]?.id;
  return (store.data.projects ?? []).filter((project) => (project.tenantId ?? bootstrap) === tenantId);
}

admin.get(
  '/',
  safely(async (req, res) => {
    const me = principalOf(req);
    const [keys, uses, endpoints, deliveries] = await Promise.all([readIntegrations('keys'), readIntegrations('uses'), readIntegrations('endpoints'), readIntegrations('deliveries')]);
    res.json({
      keys: keys.keys
        .filter((key) => key.tenantId === me.tenantId)
        .map((key) => publicApiKey(key, uses.lastUsedAt[key.id]))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      endpoints: endpoints.endpoints.filter((endpoint) => endpoint.tenantId === me.tenantId).map(publicEndpoint),
      deliveries: deliveries.deliveries
        .filter((delivery) => delivery.tenantId === me.tenantId)
        .slice(-DELIVERIES_SHOWN)
        .reverse()
        .map(publicDelivery),
      // Webhook secrets are kept sealed, which needs the deployment's key. Without it none can be registered, and the page says so.
      webhooks: sealingAvailable() ? { available: true } : { available: false, needs: envName('CREDENTIAL_KEY') },
      projects: firmProjects(me.tenantId).map((project) => ({ id: project.id, reference: project.reference, name: project.name })),
    });
  }),
);

admin.post(
  '/keys',
  safely(async (req, res) => {
    const me = principalOf(req);
    const parsed = keySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Give the key a name and at least one thing it may read.', details: parsed.error.flatten() });
      return;
    }
    const known = new Set(firmProjects(me.tenantId).map((project) => project.id));
    if (parsed.data.projectIds?.some((id) => !known.has(id))) {
      res.status(400).json({ error: 'One of those projects is not in this workspace.' });
      return;
    }
    const live = (await readIntegrations('keys')).keys.filter((key) => key.tenantId === me.tenantId && !key.revokedAt);
    if (live.length >= MOST_KEYS) {
      res.status(409).json({ error: `A workspace holds at most ${MOST_KEYS} live keys. Revoke one first.` });
      return;
    }
    const { token, key } = await createApiKey({
      tenantId: me.tenantId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      projectIds: parsed.data.projectIds,
      expiresInDays: parsed.data.expiresInDays ?? undefined,
      createdBy: me.email,
    });
    res.status(201).json({ token, key: publicApiKey(key) });
  }),
);

admin.delete(
  '/keys/:id',
  safely(async (req, res) => {
    const me = principalOf(req);
    const id = idSchema.safeParse(req.params.id);
    const key = id.success ? await revokeApiKey(me.tenantId, id.data, me.email) : undefined;
    if (!key) {
      res.status(404).json({ error: 'No such key.' });
      return;
    }
    res.json({ key: publicApiKey(key) });
  }),
);

admin.post(
  '/endpoints',
  safely(async (req, res) => {
    const me = principalOf(req);
    const parsed = endpointSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Give an https address and at least one event.', details: parsed.error.flatten() });
      return;
    }
    if (!sealingAvailable()) {
      res.status(400).json({ error: `Webhooks are off on this deployment: ${envName('CREDENTIAL_KEY')} is not set, so a signing secret cannot be kept safely.` });
      return;
    }
    const held = (await readIntegrations('endpoints')).endpoints.filter((endpoint) => endpoint.tenantId === me.tenantId);
    if (held.length >= MOST_ENDPOINTS) {
      res.status(409).json({ error: `A workspace holds at most ${MOST_ENDPOINTS} endpoints. Remove one first.` });
      return;
    }
    try {
      const { secret, endpoint } = await createEndpoint({ tenantId: me.tenantId, url: parsed.data.url, events: parsed.data.events as WebhookEventType[], createdBy: me.email });
      forgetListeners();
      res.status(201).json({ secret, endpoint: publicEndpoint(endpoint) });
    } catch (err) {
      if (!(err instanceof WebhookUrlRefused)) throw err;
      res.status(400).json({ error: err.message });
    }
  }),
);

admin.delete(
  '/endpoints/:id',
  safely(async (req, res) => {
    const me = principalOf(req);
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !(await removeEndpoint(me.tenantId, id.data))) {
      res.status(404).json({ error: 'No such endpoint.' });
      return;
    }
    forgetListeners();
    res.status(204).end();
  }),
);

admin.post(
  '/endpoints/:id/test',
  safely(async (req, res) => {
    const me = principalOf(req);
    const id = idSchema.safeParse(req.params.id);
    const delivery = id.success ? await testEndpoint(me.tenantId, id.data) : undefined;
    if (!delivery) {
      res.status(404).json({ error: 'No such endpoint.' });
      return;
    }
    forgetListeners();
    res.json({ delivery: publicDelivery(delivery) });
  }),
);

/** A test delivery calls out, and a key is minted here: few a minute is plenty. */
const adminLimit = rateLimit({ name: 'integrations', limit: 60, windowMs: 60_000 });

integrationsRouter.use('/integrations', authenticate, adminLimit, needs('admin'), admin);
