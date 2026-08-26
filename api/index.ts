import type { IncomingMessage, ServerResponse } from 'node:http';
import { app, initApp } from '../apps/api/src/app';

/**
 * Vercel serverless function entry point — Node.js runtime (not Edge; the
 * app uses Node built-ins via Express/multer and the Anthropic SDK).
 *
 * This wraps the same Express `app` that the local server (`apps/api/src/
 * index.ts`) listens with, so route wiring is defined exactly once. Express
 * apps are directly callable as a plain `(req, res)` handler — see
 * `Application`'s call signature in `@types/express-serve-static-core` — so
 * no adapter layer or `@vercel/node` request/response types are needed here.
 *
 * `vercel.json` at the repo root routes every `/api/*` request to this
 * function; Express's own router then dispatches within it exactly as it
 * does locally, including its own JSON 404 for unmatched `/api/*` paths.
 *
 * Vercel may reuse this module across invocations on a warm instance but
 * never runs its top-level code concurrently for a single instance, so the
 * init promise below is created once per cold start and reused by every
 * request that instance handles afterwards, rather than re-run per request.
 */
let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initApp().catch((err: unknown) => {
      // Don't cache a failed init — let the next invocation retry it.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ensureInit();
  app(req, res);
}
