import { put, head, list, del, get } from '@vercel/blob';
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
/**
 * What to pass the SDK, which is usually nothing.
 *
 * `@vercel/blob` resolves credentials itself, in this order: an explicit
 * `token`, then `getVercelOidcToken()` paired with `storeId` or the
 * `BLOB_STORE_ID` env var, then `BLOB_READ_WRITE_TOKEN`. Crucially the OIDC
 * step is a FUNCTION CALL, not an env read — on Vercel the token lives in the
 * request context and `process.env.VERCEL_OIDC_TOKEN` is empty. Gating on that
 * variable ourselves therefore threw before the SDK ever got a chance, and
 * took the whole API down with it while `BLOB_STORE_ID` sat correctly set.
 *
 * So: hand over an explicit token when this host has one — a non-Vercel
 * deployment or a local script — and otherwise get out of the way. The SDK's
 * own error is better than any precondition we can write here, because it
 * knows which of the three schemes it tried.
 */
function blobOptions(): { token?: string } {
  // Trimmed: a token pasted with its line ending is an invalid HTTP header
  // value, and the resulting error names the header rather than the paste.
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? { token } : {};
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

async function resolveBlob(pathname: string): Promise<ResolvedBlob | null> {
  const cached = knownUrls.get(pathname);
  if (cached) {
    try {
      const meta: HeadBlobResult = await head(cached, blobOptions());
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
  const { blobs } = await list({ prefix: pathname, ...blobOptions(), limit: 10 });
  const match: ListBlobResultBlob | undefined = blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  knownUrls.set(pathname, match.url);
  return { url: match.url, uploadedAt: match.uploadedAt };
}

/**
 * A blob's current bytes, or null when it is not there.
 *
 * `get()` is used rather than a bare `fetch` of the blob's URL for two
 * reasons, and both were learned the hard way. It sets the authorization
 * header itself, which a private blob requires and which `head()` and
 * `list()` beside it already had — so a hand-rolled fetch 401s while every
 * control-plane call around it keeps working, and the failure reads as an
 * empty file rather than an auth error.
 *
 * And `useCache: false` is the supported way to defeat the CDN, replacing a
 * cache-busting query parameter built from `uploadedAt`. The concern it
 * addresses is real and unchanged — without it, reading the store back
 * straight after a write can return the previous version and silently lose
 * the change — but the SDK reads from origin storage directly, which is a
 * guarantee rather than a trick that depends on the CDN keying on the query
 * string.
 */
async function readBlobBytes(pathname: string): Promise<Buffer | null> {
  const result = await get(pathname, { access: BLOB_ACCESS, useCache: false, ...blobOptions() });
  if (!result || result.statusCode !== 200) return null;
  const bytes = await new Response(result.stream).arrayBuffer();
  return Buffer.from(bytes);
}

async function readPathname(pathname: string): Promise<StoreData | null> {
  const bytes = await readBlobBytes(pathname);
  if (!bytes) return null;
  const text = bytes.toString('utf8');
  if (!text.trim()) return null;
  return JSON.parse(text) as StoreData;
}

async function readStore(): Promise<StoreData | null> {
  try {
    return await readPathname(STORE_PATHNAME);
  } catch (err) {
    console.warn(`[storage/blob] failed to read the store, starting from an empty store: ${(err as Error).message}`);
    return null;
  }
}

async function writeStore(data: StoreData): Promise<void> {
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
    ...blobOptions(),
  });
  knownUrls.set(STORE_PATHNAME, result.url);
}

async function putDocument(caseId: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
  const pathname = documentPathname(caseId, key);
  // Same rationale as `writeStore`: a stable pathname so the bytes can be found
  // again, and overwrite allowed so re-uploading over an existing document id
  // does not error.
  const result = await put(pathname, bytes, {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    ...blobOptions(),
  });
  knownUrls.set(pathname, result.url);
}

async function getDocument(caseId: string, key: string): Promise<Buffer | null> {
  // Straight to `get()` by pathname — no `resolveBlob` first. Discovering the
  // URL was only ever needed to build a fetch by hand; the SDK takes the
  // pathname, which also saves a control-plane round trip on every document
  // opened in the viewer.
  return readBlobBytes(documentPathname(caseId, key));
}

async function deleteDocument(caseId: string, key: string): Promise<void> {
  const pathname = documentPathname(caseId, key);
  const resolved = await resolveBlob(pathname);
  knownUrls.delete(pathname);
  if (resolved) await del(resolved.url, blobOptions());
}

/** List every blob under a prefix, following `list()`'s cursor to completion. */
async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const found: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, cursor, limit: 1000, ...blobOptions() });
    found.push(...page.blobs);
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return found;
}

async function deleteCaseDocuments(caseId: string): Promise<void> {
  const prefix = documentPathname(caseId, '');
  const found = await listAll(prefix);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), blobOptions());
  for (const b of found) knownUrls.delete(b.pathname);
}

async function deleteAllDocuments(): Promise<void> {
  const found = await listAll(UPLOADS_PREFIX);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), blobOptions());
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
