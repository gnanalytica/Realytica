import type { IncomingMessage, ServerResponse } from 'node:http';
import { app, initApp } from './app';

/**
 * Vercel serverless function entry point — Node.js runtime (not Edge; the
 * app uses Node built-ins via Express/multer and the Anthropic SDK).
 *
 * This wraps the same Express `app` that the local server (`./index.ts`)
 * listens with, so route wiring is defined exactly once. Express apps are
 * directly callable as a plain `(req, res)` handler — see `Application`'s
 * call signature in `@types/express-serve-static-core` — so no adapter layer
 * or `@vercel/node` request/response types are needed here.
 *
 * This file is not itself the deployed function. The root `build` script
 * bundles it with esbuild into `api/index.mjs`, which is what Vercel picks
 * up, and `vercel.json` routes every `/api/*` request there; Express's own
 * router then dispatches within it exactly as it does locally, including its
 * own JSON 404 for unmatched `/api/*` paths.
 *
 * The bundling is not a packaging preference, it is a requirement. Vercel
 * transpiles function sources file by file rather than bundling them, and
 * this codebase is written for a bundler: `tsconfig.base.json` sets
 * `moduleResolution: "Bundler"`, so relative imports carry no file
 * extension. Node's ESM loader does not add one, so a file-by-file build
 * produces a module graph that cannot resolve itself at runtime. Bundling
 * resolves every one of those specifiers at build time instead.
 *
 * The bundle must be ESM, not CommonJS: `storage/index.ts` chooses its
 * adapter with a top-level `await`, and `app.ts` reads `import.meta.url` —
 * neither survives a CommonJS output format.
 *
 * Vercel may reuse the bundled module across invocations on a warm instance
 * but never runs its top-level code concurrently for a single instance, so
 * the init promise below is created once per cold start and reused by every
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
