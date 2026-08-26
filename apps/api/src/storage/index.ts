import type { StorageAdapter } from './types';
import { filesystemAdapter } from './filesystem';

/**
 * Adapter selection.
 *
 * Vercel Blob whenever `BLOB_READ_WRITE_TOKEN` is present — that's how a
 * Blob store attached to a Vercel project announces itself, in both
 * `vercel dev` and a real deployment. Everywhere else (`pnpm dev` on a
 * laptop, CI, a container with no Vercel configuration) falls back to the
 * filesystem adapter this app has always used, unchanged.
 *
 * `@vercel/blob` is imported dynamically, only inside the branch that needs
 * it, so it is never required at runtime on the filesystem path — a machine
 * with the package uninstalled and no token set still boots fine.
 */
async function selectAdapter(): Promise<StorageAdapter> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
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
