import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { ENGINE_VERSION, compareCases } from '@valytica/shared';
import { store, initStore } from './store';
import { initPrompts } from './prompts';
import { initTelemetry } from './telemetry';
import { casesRouter } from './routes/cases';
import { documentsRouter, UPLOAD_LIMITS } from './routes/documents';
import { screenRouter, risksRouter, actionsRouter } from './routes/screen';
import { referenceRouter } from './routes/reference';
import { demoRouter, seedDemoData } from './routes/demo';
import { agentsCapabilityRouter, caseAgentsRouter } from './routes/agents';
import { caseKnowledgeRouter, sourcesRouter } from './routes/knowledge';
import { telemetryRouter } from './routes/telemetry';
import { promptsRouter } from './routes/prompts';
import { flowRouter } from './routes/flow';
import { intakeRouter } from './routes/intake';

const here = path.dirname(fileURLToPath(import.meta.url));
import { compareBodySchema } from './schemas';

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

app.get('/api/health', (_req, res) => {
  // `upload` describes what this deployment can accept, which differs between
  // a server and a serverless platform with its own request-body cap. The
  // client reads it here so it can reject or split an upload before sending,
  // rather than finding out from a failed request.
  res.json({
    status: 'ok',
    version: ENGINE_VERSION,
    cases: store.data.cases.length,
    upload: UPLOAD_LIMITS,
  });
});

app.use('/api/reference', referenceRouter);
app.use('/api/agents', agentsCapabilityRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/intake', intakeRouter);

// Mounted before the generic /api/cases router so nested case sub-resources
// resolve here first; :id is captured via mergeParams on each sub-router.
app.use('/api/cases/:id/documents', documentsRouter);
app.use('/api/cases/:id/screen', screenRouter);
app.use('/api/cases/:id/risks', risksRouter);
app.use('/api/cases/:id/actions', actionsRouter);
app.use('/api/cases/:id/agents', caseAgentsRouter);
app.use('/api/cases/:id/knowledge', caseKnowledgeRouter);
app.use('/api/cases/:id/flow', flowRouter);
app.use('/api/cases', casesRouter);

app.use('/api/demo', demoRouter);

app.post('/api/compare', (req, res) => {
  const parsed = compareBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const cases = parsed.data.caseIds
    .map((id) => store.data.cases.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (cases.length !== parsed.data.caseIds.length) {
    res.status(404).json({ error: 'One or more cases not found' });
    return;
  }
  const result = compareCases(cases, new Date().toISOString());
  res.json(result);
});

// 404 for any unmatched /api/* route.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/*
 * Serve the built web app from this same process, when it exists.
 *
 * In development Vite serves the UI on its own port and proxies /api here. For
 * a deployment that split means two services to host and a CORS story to get
 * right; serving the build from here makes Valytica a single process on a
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
const WEB_DIST = process.env.VALYTICA_WEB_DIST
  ? path.resolve(process.env.VALYTICA_WEB_DIST)
  : path.resolve(here, '../../web/dist');

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
  await initStore();
  // Before the first request, on a server and on a cold serverless invocation
  // alike: until this runs the agent layer resolves every prompt to its
  // built-in, so an operator's edit would be silently ignored rather than
  // reported as unavailable.
  await initPrompts();
  // Must run before the first model call, or that call goes unrecorded.
  initTelemetry();
  if (store.data.cases.length === 0) {
    const created = await seedDemoData();
    console.log(`[boot] store was empty — auto-seeded ${created} demo case(s)`);
  }
}
