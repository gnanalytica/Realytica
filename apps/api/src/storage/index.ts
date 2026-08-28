import type { StorageAdapter } from './types';
import { filesystemAdapter } from './filesystem';

/**
 * Adapter selection.
 *
 * Vercel Blob whenever a connected store announces itself, which it does in
 * one of two ways depending on the store's own access setting.
 *
 * A **public** store writes a static `BLOB_READ_WRITE_TOKEN`. A **private**
 * one does not — it writes `BLOB_STORE_ID` and relies on the per-invocation
 * `VERCEL_OIDC_TOKEN` the platform injects at runtime. Testing only for the
 * token therefore rejected a correctly connected private store and fell
 * silently back to temporary storage, which on a serverless host means every
 * cold start reports an empty database and re-seeds the demo. The symptom
 * reads as "nothing was ever saved", which is a long way from the cause. Everywhere else (`pnpm dev` on a
 * laptop, CI, a container with no Vercel configuration) falls back to the
 * filesystem adapter this app has always used, unchanged.
 *
 * `@vercel/blob` is imported dynamically, only inside the branch that needs
 * it, so it is never required at runtime on the filesystem path — a machine
 * with the package uninstalled and no token set still boots fine.
 */
async function selectAdapter(): Promise<StorageAdapter> {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const { blobAdapter } = await import('./blob');
    return blobAdapter;
  }
  return filesystemAdapter;
}

// Top-level await: this module (and therefore `store.ts`, which imports it)
// finishes loading only once the adapter is chosen. Node's ESM loader and
// `tsx` both support this natively, so nothing downstream needs to change
// its import style to accommodate it.
export const storageAdapter: StorageAdapter = await selectAdapter();

console.log(`[storage] using the ${storageAdapter.kind} adapter`);
