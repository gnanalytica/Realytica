import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { ENGINE_VERSION } from '@realytica/shared';
import { store, initStore } from './store';
import { initPrompts } from './prompts';
import { initTelemetry } from './telemetry';
import { UPLOAD_LIMITS } from './routes/documents';
import { referenceRouter } from './routes/reference';
import { demoRouter, seedDemoProjects } from './routes/demo';
import { librariesRouter, projectsRouter } from './routes/projects';
import { agentsCapabilityRouter } from './routes/agents';
import { sourcesRouter } from './routes/knowledge';
import { telemetryRouter } from './routes/telemetry';
import { workRouter } from './routes/work';
import { promptsRouter } from './routes/prompts';
import { graphAdapter } from './graph';
import { authenticate, authSettings, initAuth, needs } from './auth/middleware';
import { reportOperators } from './auth/operator';
import { membersRouter } from './routes/members';

const here = path.dirname(fileURLToPath(import.meta.url));
import { readEnv } from '@realytica/agents';

/**
 * The Express app, fully configured but never listening.
 *
 * Split out of `index.ts` so the same app can be handed to Node's `http`
 * server for local dev (`index.ts`) and to a Vercel serverless function
 * (`/api/index.ts` at the repo root) without either entry point duplicating
 * route wiring. Nothing in this file may call `.listen()` — that stays the
 * job of whichever entry point imports `app` from here.
 */
export const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// One line per request: method, path, status, duration.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });
  next();
});

/**
 * Health is the one route outside the gate.
 *
 * A load balancer has no token, and a client needs to know the upload limits
 * before it can sign in. It reports the auth mode so the web app knows which
 * provider to offer — and nothing else about the deployment.
 */
app.get('/api/health', (_req, res) => {
  // `upload` describes what this deployment can accept, which differs between
  // a server and a serverless platform with its own request-body cap. The
  // client reads it here so it can reject or split an upload before sending,
  // rather than finding out from a failed request.
  res.json({
    status: 'ok',
    version: ENGINE_VERSION,
    projects: store.data.projects?.length ?? 0,
    graph: graphAdapter.kind,
    upload: UPLOAD_LIMITS,
    auth: { mode: authSettings().mode },
  });
});

/*
 * Everything below is authenticated.
 *
 * Mounted once, above the routers, rather than per route: a route added later
 * inherits the gate instead of being born unguarded, which is exactly how an
 * endpoint ends up public by accident.
 */
app.use('/api', authenticate);

/*
 * Reference data and the libraries are read-only and the same for everybody;
 * the project routes carry their own method gate. Telemetry is model spend and
 * prompts are what the agents are told to do — both are the workspace's
 * business rather than any member's, so both sit behind `admin`.
 */
app.use('/api/reference', needs('read'), referenceRouter);
app.use('/api/libraries', needs('read'), librariesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/agents', needs('read'), agentsCapabilityRouter);
app.use('/api/sources', needs('read'), sourcesRouter);
app.use('/api/telemetry', needs('admin'), telemetryRouter);
app.use('/api/prompts', needs('admin'), promptsRouter);
app.use('/api/demo', demoRouter);
app.use('/api/work', workRouter);
app.use('/api/members', membersRouter);

// 404 for any unmatched /api/* route.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/*
 * Serve the built web app from this same process, when it exists.
 *
 * In development Vite serves the UI on its own port and proxies /api here. For
 * a deployment that split means two services to host and a CORS story to get
 * right; serving the build from here makes Realytica a single process on a
 * single port, which is the difference between a one-click deploy and an
 * afternoon of wiring.
 *
 * Mounted after the /api routes and their 404 so it can never shadow the API,
 * and skipped entirely when there is no build — a dev process keeps behaving
 * exactly as before.
 *
 * On Vercel the static build is served directly from the edge (see the repo
 * root `vercel.json`), so this branch never runs there — `apps/web/dist`
 * never ships inside the serverless function bundle. It stays here purely so
 * `pnpm build && pnpm start` continues to serve one process on one port.
 */
const webDistOverride = readEnv('WEB_DIST');
const WEB_DIST = webDistOverride ? path.resolve(webDistOverride) : path.resolve(here, '../../web/dist');

if (existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  // SPA fallback: client-side routes like /cases/:id/valuation are not files,
  // so anything that is not an API call and not a real asset gets index.html.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
  console.log(`[boot] serving web build from ${WEB_DIST}`);
} else {
  console.log('[boot] no web build found — API only (run `pnpm build` to serve the UI from this process)');
}

// Global error handler — must be declared with 4 params for Express to treat
// it as error-handling middleware.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
};
app.use(errorHandler);

/**
 * Async setup that must finish before `app` serves its first request:
 * loading the store via its `StorageAdapter` (filesystem locally, Vercel
 * Blob in a deployment with a Blob store attached — see `./storage/index.ts`),
 * then the boot-time demo-data auto-seed if it came back empty.
 *
 * `index.ts` awaits this before calling `app.listen`; the Vercel function
 * entry (`/api/index.ts` at the repo root) awaits it once per cold start,
 * caching the promise so a burst of concurrent requests doesn't re-run it.
 */
export async function initApp(): Promise<void> {
  /*
   * First, before anything is loaded or served.
   *
   * A misconfiguration has to be a startup failure. The alternative — coming
   * up and deciding per request — is a deployment that boots green and serves
   * every project to anybody who finds the URL, which is precisely what this
   * codebase did until today.
   */
  const auth = initAuth();
  console.log(
    auth.mode === 'off'
      ? '[auth] OFF — every request is the local operator. Never run this on a shared URL.'
      : `[auth] ${auth.mode}: tokens must be issued for ${auth.verifier?.audience} by ${auth.verifier?.issuers.join(' or ')}`,
  );

  await initStore();
  // Before the first request, on a server and on a cold serverless invocation
  // alike: until this runs the agent layer resolves every prompt to its
  // built-in, so an operator's edit would be silently ignored rather than
  // reported as unavailable.
  await initPrompts();
  // Must run before the first model call, or that call goes unrecorded.
  initTelemetry();
  reportOperators(store.data.tenants?.length ?? 0);
  if (!store.data.projects?.length) {
    const created = await seedDemoProjects();
    console.log(`[boot] no projects — auto-seeded ${created} demo project(s)`);
  }
  void import('./reference/shelf-cache')
    .then(({ ingestOpenReferences }) => ingestOpenReferences())
    .then((r) => console.log(`[shelf] open PDFs ingested=${r.fetched} skipped=${r.skipped} failed=${r.failed}`))
    .catch((err) => console.warn(`[shelf] ingest skipped: ${(err as Error).message}`));
  void import('./gis/civic-cache')
    .then(({ ingestCivicLayers }) => ingestCivicLayers())
    .then((r) => console.log(`[gis] civic layers lakes=${r.lakes} wards=${r.wards} withdrawnSheets=${r.sheets}${r.errors.length ? ` errors=${r.errors.join('; ')}` : ''}`))
    .catch((err) => console.warn(`[gis] civic ingest skipped: ${(err as Error).message}`));
}
