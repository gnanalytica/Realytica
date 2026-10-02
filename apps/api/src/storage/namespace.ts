import { readEnv } from '@realytica/agents';

/**
 * Which generation of stored data this deployment reads and writes.
 *
 * Every pathname the store and the document vault use sits under it:
 * `v2/store/realytica.json`, `v2/uploads/<projectId>/…` on Blob, and
 * `<data dir>/v2/…` on disk. Starting a new generation is how the data is
 * reset without deleting anything: the earlier generation stays where it
 * was, unread, so checking out older code finds its own data again.
 *
 * `REALYTICA_STORAGE_NAMESPACE` overrides it, for a scratch copy beside the
 * real one.
 */
export const STORAGE_NAMESPACE = (() => {
  const raw = readEnv('STORAGE_NAMESPACE')?.trim() || 'v2';
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(raw)) throw new Error('REALYTICA_STORAGE_NAMESPACE must be lower-case letters, digits and dashes.');
  return raw;
})();
