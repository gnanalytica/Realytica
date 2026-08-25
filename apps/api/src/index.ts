import express from 'express';
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { ENGINE_VERSION, compareCases } from '@valytica/shared';
import { store } from './store';
import { casesRouter } from './routes/cases';
import { documentsRouter } from './routes/documents';
import { screenRouter, risksRouter, actionsRouter } from './routes/screen';
import { referenceRouter } from './routes/reference';
import { demoRouter, seedDemoData } from './routes/demo';
import { agentsCapabilityRouter, caseAgentsRouter } from './routes/agents';
import { compareBodySchema } from './schemas';

const PORT = Number(process.env.PORT) || 5174;

const app = express();
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
  res.json({ status: 'ok', version: ENGINE_VERSION, cases: store.data.cases.length });
});

app.use('/api/reference', referenceRouter);
app.use('/api/agents', agentsCapabilityRouter);

// Mounted before the generic /api/cases router so nested case sub-resources
// resolve here first; :id is captured via mergeParams on each sub-router.
app.use('/api/cases/:id/documents', documentsRouter);
app.use('/api/cases/:id/screen', screenRouter);
app.use('/api/cases/:id/risks', risksRouter);
app.use('/api/cases/:id/actions', actionsRouter);
app.use('/api/cases/:id/agents', caseAgentsRouter);
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

if (store.data.cases.length === 0) {
  const created = seedDemoData();
  console.log(`[boot] store was empty — auto-seeded ${created} demo case(s)`);
}

const server = app.listen(PORT, () => {
  console.log(`[valytica-api] listening on port ${PORT} (${store.data.cases.length} case(s) loaded)`);
});

function shutdown(signal: string): void {
  console.log(`[valytica-api] received ${signal}, flushing store and shutting down`);
  store.flush();
  server.close(() => process.exit(0));
  // Force-exit if close hangs (e.g. a lingering keep-alive connection).
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
