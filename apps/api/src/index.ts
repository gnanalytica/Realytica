import { app, initApp } from './app';
import { store } from './store';

/**
 * Local-server entry point: awaits app initialisation, then listens on a
 * port. This is `pnpm dev` and `pnpm start`'s entry — the app itself lives in
 * `./app`, which is also what the Vercel serverless function
 * (`/api/index.ts` at the repo root) imports, so the two deployment targets
 * never carry two copies of the route wiring.
 */

const PORT = Number(process.env.PORT) || 5174;

async function main(): Promise<void> {
  await initApp();

  const server = app.listen(PORT, () => {
    console.log(`[realytica-api] listening on port ${PORT} (${store.data.projects?.length ?? 0} project(s) loaded)`);
  });

  function shutdown(signal: string): void {
    console.log(`[realytica-api] received ${signal}, flushing store and shutting down`);
    store
      .flush()
      .catch((err: unknown) => {
        console.error('[realytica-api] failed to flush store during shutdown:', err);
      })
      .finally(() => {
        server.close(() => process.exit(0));
      });
    // Force-exit if flushing or close hangs (e.g. a lingering keep-alive
    // connection, or a remote adapter that never resolves).
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[realytica-api] failed to start:', err);
  process.exit(1);
});
