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

const STORE_PATHNAME = 'store/valytica.json';
const UPLOADS_PREFIX = 'uploads/';

function documentPathname(caseId: string, key: string): string {
  return `${UPLOADS_PREFIX}${caseId}/${key}`;
}

function requireToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    // `./index.ts` only ever selects this adapter when the token is set, so
    // reaching here means it was unset out from under us mid-process.
    throw new Error('BLOB_READ_WRITE_TOKEN is not set — the Vercel Blob adapter cannot operate without it.');
  }
  return token;
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

async function resolveBlob(pathname: string, token: string): Promise<ResolvedBlob | null> {
  const cached = knownUrls.get(pathname);
  if (cached) {
    try {
      const meta: HeadBlobResult = await head(cached, { token });
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
  const { blobs } = await list({ prefix: pathname, token, limit: 10 });
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
async function fetchFresh(resolved: ResolvedBlob): Promise<Response> {
  const bustParam = `v=${resolved.uploadedAt.getTime()}`;
  const url = `${resolved.url}${resolved.url.includes('?') ? '&' : '?'}${bustParam}`;
  return fetch(url);
}

async function readStore(): Promise<StoreData | null> {
  const token = requireToken();
  try {
    const resolved = await resolveBlob(STORE_PATHNAME, token);
    if (!resolved) return null;
    const res = await fetchFresh(resolved);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as StoreData;
  } catch (err) {
    console.warn(`[storage/blob] failed to read the store, starting from an empty store: ${(err as Error).message}`);
    return null;
  }
}

async function writeStore(data: StoreData): Promise<void> {
  const token = requireToken();
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
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
  knownUrls.set(STORE_PATHNAME, result.url);
}

async function putDocument(caseId: string, key: string, bytes: Buffer, contentType: string): Promise<void> {
  const token = requireToken();
  const pathname = documentPathname(caseId, key);
  // Same rationale as `writeStore`: a stable pathname so the bytes can be found
  // again, and overwrite allowed so re-uploading over an existing document id
  // does not error.
  const result = await put(pathname, bytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    token,
  });
  knownUrls.set(pathname, result.url);
}

async function getDocument(caseId: string, key: string): Promise<Buffer | null> {
  const token = requireToken();
  const pathname = documentPathname(caseId, key);
  const resolved = await resolveBlob(pathname, token);
  if (!resolved) return null;
  const res = await fetchFresh(resolved);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

async function deleteDocument(caseId: string, key: string): Promise<void> {
  const token = requireToken();
  const pathname = documentPathname(caseId, key);
  const resolved = await resolveBlob(pathname, token);
  knownUrls.delete(pathname);
  if (resolved) await del(resolved.url, { token });
}

/** List every blob under a prefix, following `list()`'s cursor to completion. */
async function listAll(prefix: string, token: string): Promise<ListBlobResultBlob[]> {
  const found: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, cursor, limit: 1000, token });
    found.push(...page.blobs);
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return found;
}

async function deleteCaseDocuments(caseId: string): Promise<void> {
  const token = requireToken();
  const prefix = documentPathname(caseId, '');
  const found = await listAll(prefix, token);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), { token });
  for (const b of found) knownUrls.delete(b.pathname);
}

async function deleteAllDocuments(): Promise<void> {
  const token = requireToken();
  const found = await listAll(UPLOADS_PREFIX, token);
  if (found.length === 0) return;
  await del(found.map((b) => b.url), { token });
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
