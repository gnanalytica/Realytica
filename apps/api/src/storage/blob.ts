import { put, head, list, del } from '@vercel/blob';
import type { HeadBlobResult, ListBlobResultBlob } from '@vercel/blob';
import type { StoreData } from '../store';
import type { StorageAdapter } from './types';

/**
 * The Vercel Blob-backed `StorageAdapter` — used in place of the filesystem
 * one whenever `BLOB_READ_WRITE_TOKEN` is present (see `./index.ts`). Only
 * ever loaded via that dynamic import, so a machine with no Blob store
 * configured never resolves `@vercel/blob` at all.
 *
 * The case store lives at one stable pathname; documents live under
 * `uploads/<caseId>/<key>`, mirroring the filesystem layout closely enough
 * that `deleteCaseDocuments` can list-by-prefix and delete.
 */

const STORE_PATHNAME = 'store/realytica.json';
/**
 * The pre-rename store pathname. A Blob store written before the Realytica
 * rename holds every case here, so reads fall back to it when the current
 * pathname resolves to nothing. Writes always go to `STORE_PATHNAME`, so the
 * first save after this deploy migrates the data; the old blob is left
 * untouched rather than deleted, so nothing is lost if the migration needs
 * to be reversed.
 */
const LEGACY_STORE_PATHNAME = 'store/valytica.json';
const UPLOADS_PREFIX = 'uploads/';

function documentPathname(caseId: string, key: string): string {
  return `${UPLOADS_PREFIX}${caseId}/${key}`;
}

/**
 * Every blob this app writes is private, and that is not configurable.
 *
 * A public blob has a guessable-free but permanently unauthenticated URL:
 * anyone holding it can read the bytes forever, with no session, no
 * expiry and nothing in an access log tying it to a person. What this store
 * holds is title deeds, encumbrance certificates and site photographs of
 * other people's property — the case file itself. It was `'public'` until a
 * store created with `--access private` refused the write, which is the good
 * kind of failure: the store's own setting caught what the code had assumed.
 *
 * Deliberately a constant rather than an environment variable. A knob here
 * would let one misconfigured deployment publish a client's deeds, and no
 * deployment of this product has a reason to want that.
 */
const BLOB_ACCESS = 'private' as const;

/**
 * How this deployment proves it may touch the store.
 *
 * There are two schemes and which one you get is decided by the store, not by
 * you. Connecting a **public** store to a project writes a static
 * `BLOB_READ_WRITE_TOKEN`. Connecting a **private** one does not: it writes
 * `BLOB_STORE_ID`, and the credential is the per-invocation `VERCEL_OIDC_TOKEN`
 * the platform injects at runtime. So a private store that is correctly
 * connected shows NO read-write token in `vercel env ls`, which looks exactly
 * like a connection that failed.
 *
 * Both are supported because both are real: the static token is what a
 * non-Vercel host or a local script has, OIDC is what a private store on
 * Vercel has, and preferring the static one when present keeps every existing
 * deployment working unchanged.
 *
 * Read per call rather than memoised at module load. An OIDC token is
 * short-lived and refreshed per invocation — caching it would work for the
 * first request an instance serves and fail for the rest, which is the
 * hardest shape of bug to see in a warm-instance serverless runtime.
 */
interface BlobAuth {
  /** Spread into every SDK call: either `{ token }` or `{ oidcToken, storeId }`. */
  options: { token?: string; oidcToken?: string; storeId?: string };
  /** The bearer value for a direct `fetch` of a private blob URL. */
  bearer: string;
}

function requireAuth(): BlobAuth {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return { options: { token }, bearer: token };

  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  if (oidcToken && storeId) return { options: { oidcToken, storeId }, bearer: oidcToken };

  // `./index.ts` only selects this adapter when one of the two is configured,
  // so reaching here means it was unset out from under us mid-process. The
  // message names both schemes, because "the token is missing" sent the last
  // person looking for a variable a private store never issues.
  throw new Error(
    'Vercel Blob is not authenticated — set BLOB_READ_WRITE_TOKEN, or run on Vercel with ' +
      'BLOB_STORE_ID set and VERCEL_OIDC_TOKEN available (the private-store path).',
  );
}

/**
 * A resolved blob's URL and the moment it was last written, used to build a
 * cache-busting read. `list()` and `head()` are control-plane calls — they
 * always reflect the latest write, unlike the blob's own public URL, which
 * is served through a CDN and can keep answering with a previously-cached
 * body for a short window right after an overwrite.
 */
interface ResolvedBlob {
  url: string;
  uploadedAt: Date;
}

// Cheap warm-instance memoisation: once a pathname's current URL is known,
// `head(url)` (a single control-plane lookup) confirms it is still current
// far more cheaply than re-listing. Cold starts (or a miss below) fall back
// to `list()`, which is the only way to discover a blob's URL from its
// pathname alone.
const knownUrls = new Map<string, string>();

async function resolveBlob(pathname: string, auth: BlobAuth): Promise<ResolvedBlob | null> {
  const cached = knownUrls.get(pathname);
  if (cached) {
    try {
      const meta: HeadBlobResult = await head(cached, auth.options);
      return { url: meta.url, uploadedAt: meta.uploadedAt };
    } catch {
      // The cached URL no longer resolves — e.g. the blob was deleted since,
      // or this is a fresh process that inherited nothing. Fall through to
      // an authoritative list().
      knownUrls.delete(pathname);
    }
  }
  // `list()` matches by prefix, not exact pathname, so this could in principle
  // come back with more than one entry if something else's pathname happened
  // to start with this exact string — nothing in this adapter ever creates
  // such a name, but the explicit `.find` below (rather than trusting
  // `blobs[0]`) means that assumption isn't load-bearing.
  const { blobs } = await list({ prefix: pathname, ...auth.options, limit: 10 });
  const match: ListBlobResultBlob | undefined = blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  knownUrls.set(pathname, match.url);
  return { url: match.url, uploadedAt: match.uploadedAt };
}

/**
 * Fetch a blob's current bytes, guaranteed fresh rather than a CDN-cached
 * previous version.
 *
 * Node's own `fetch` (undici) has no HTTP cache of its own to opt out of —
 * `RequestInit` here doesn't even have a `cache` option — so a plain
 * `no-store`-style flag would be a no-op anyway. The CDN sitting in front of
 * the blob's public URL is what can serve a previously-cached body right
 * after an overwrite, and the only thing that reliably defeats *that* is
 * changing the URL. `uploadedAt` comes from the control-plane call in
 * `resolveBlob`, which is always current, so folding it into the request URL
 * as a cache-busting query param means the URL changes exactly when the
 * content did, guaranteeing a fresh fetch. Skipping this is not a
 * theoretical concern: without it, reading the store back right after a
 * write can silently return the previous version and lose the change that
 * was just made.
 */
async function fetchFresh(resolved: ResolvedBlob, auth: BlobAuth): Promise<Response> {
  const bustParam = `v=${resolved.uploadedAt.getTime()}`;
  const url = `${resolved.url}${resolved.url.includes('?') ? '&' : '?'}${bustParam}`;
  // A private blob's URL is not a credential — the read is authenticated by
  // this header, and without it the fetch comes back 401 while `head()` and
  // `list()` above keep working, because those are control-plane calls that
  // already carry the token. That asymmetry is worth naming: it makes a
  // misconfiguration look like "the file exists but is empty" rather than
  // like an auth error.
  return fetch(url, { headers: { Authorization: `Bearer ${auth.bearer}` } });
}

async function readPathname(pathname: string, auth: BlobAuth): Promise<StoreData | null> {
  const resolved = await resolveBlob(pathname, auth);
  if (!resolved) return null;
  const res = await fetchFresh(resolved, auth);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as StoreData;
}

async function readStore(): Promise<StoreData | null> {
  const auth = requireAuth();
  try {
    const current = await readPathname(STORE_PATHNAME, auth);
    if (current) return current;
    const legacy = await readPathname(LEGACY_STORE_PATHNAME, auth);
    if (legacy) {
      console.info(
        `[storage/blob] read the pre-rename store at ${LEGACY_STORE_PATHNAME}; ` +
          `the next save will write ${STORE_PATHNAME} and leave the original in place.`,
      );
    }
    return legacy;
  } catch (err) {
    console.warn(`[storage/blob] failed to read the store, starting from an empty store: ${(err as Error).message}`);
    return null;
  }
}

async function writeStore(data: StoreData): Promise<void> {
  const auth = requireAuth();
  // Two flags, both load-bearing.
  //
  // `addRandomSuffix: false` keeps the store at a stable pathname — the default
  // appends a random suffix, which would move the store's address on every save
  // and make the previous one unfindable.
  //
  // `allowOverwrite: true` is what lets the second and every later save succeed.
  // Blob rejects a write to an existing pathname without it, so omitting it
  // would produce an app that works exactly once and then fails to persist
  // anything — the kind of fault that only appears after the first real edit.
  const result = await put(STORE_PATHNAME, JSON.stringify(data, null, 2), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    ...auth.options,
  });
  knownUrls.set(STORE_PATHNAME, result.url);
}

async function putDocument(caseId: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
  const auth = requireAuth();
  const pathname = documentPathname(caseId, key);
  // Same rationale as `writeStore`: a stable pathname so the bytes can be found
  // again, and overwrite allowed so re-uploading over an existing document id
  // does not error.
  const result = await put(pathname, bytes, {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    ...auth.options,
  });
  knownUrls.set(pathname, result.url);
}

async function getDocument(caseId: string, key: string): Promise<Buffer | null> {
  const auth = requireAuth();
  const pathname = documentPathname(caseId, key);
  const resolved = await resolveBlob(pathname, auth);
  if (!resolved) return null;
  const res = await fetchFresh(resolved, auth);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

async function deleteDocument(caseId: string, key: string): Promise<void> {
  const auth = requireAuth();
  const pathname = documentPathname(caseId, key);
  const resolved = await resolveBlob(pathname, auth);
  knownUrls.delete(pathname);
  if (resolved) await del(resolved.url, auth.options);
}

/** List every blob under a prefix, following `list()`'s cursor to completion. */
async function listAll(prefix: string, auth: BlobAuth): Promise<ListBlobResultBlob[]> {
  const found: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, cursor, limit: 1000, ...auth.options });
    found.push(...page.blobs);
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return found;
}

async function deleteCaseDocuments(caseId: string): Promise<void> {
  const auth = requireAuth();
  const prefix = documentPathname(caseId, '');
  const found = await listAll(prefix, auth);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), auth.options);
  for (const b of found) knownUrls.delete(b.pathname);
}

async function deleteAllDocuments(): Promise<void> {
  const auth = requireAuth();
  const found = await listAll(UPLOADS_PREFIX, auth);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), auth.options);
  for (const b of found) knownUrls.delete(b.pathname);
}

export const blobAdapter: StorageAdapter = {
  kind: 'vercel-blob',
  readStore,
  writeStore,
  putDocument,
  getDocument,
  deleteDocument,
  deleteCaseDocuments,
  deleteAllDocuments,
};
