import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoreData } from '../store';
import type { StorageAdapter } from './types';

/**
 * The filesystem-backed `StorageAdapter` — exactly the layout and semantics
 * Valytica has always used locally: `VALYTICA_DATA_DIR` (or `../../data`,
 * i.e. `apps/api/data`, when unset) holds `valytica.json` plus an
 * `uploads/<caseId>/<key>` tree, directories are created on demand, and the
 * store file is written atomically (temp file, then rename) so a crash
 * mid-write can never leave it truncated.
 *
 * `store.ts` re-exports `DATA_DIR`, `UPLOADS_DIR` and `caseUploadDir` from
 * here so the handful of routes that still build upload paths directly
 * (rather than going through a `StorageAdapter`) keep compiling and working
 * unchanged on this backend. See the top-level report for which routes those
 * are and why they only make sense on this adapter.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.VALYTICA_DATA_DIR
  ? path.resolve(process.env.VALYTICA_DATA_DIR)
  : path.resolve(here, '../../data');

export const DATA_FILE = path.join(DATA_DIR, 'valytica.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

/** Directory that holds uploaded files for one case. Always built from a
 * case id we already found in the store — never from a raw path param. */
export function caseUploadDir(caseId: string): string {
  return path.join(UPLOADS_DIR, caseId);
}

function documentPath(caseId: string, key: string): string {
  return path.join(caseUploadDir(caseId), key);
}

async function readStore(): Promise<StoreData | null> {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as StoreData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt JSON, permissions error, etc. — warn and let the caller fall
    // back to an empty store rather than taking the whole app down over one
    // unreadable file.
    console.warn(
      `[storage/filesystem] failed to read ${DATA_FILE}, starting from an empty store: ${(err as Error).message}`,
    );
    return null;
  }
}

// Concurrent `save()` calls (two requests resolving close together) are real
// now that every mutation awaits a write instead of collapsing into one
// debounced flush. Chaining them through a single queue keeps the
// temp-file-then-rename sequence for each write from interleaving with the
// next one, without requiring every caller to coordinate that themselves.
let writeQueue: Promise<void> = Promise.resolve();

async function writeStore(data: StoreData): Promise<void> {
  const run = async (): Promise<void> => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    await fsp.rename(tmpFile, DATA_FILE);
  };
  const next = writeQueue.then(run, run);
  writeQueue = next;
  await next;
}

async function putDocument(caseId: string, key: string, bytes: Buffer, _contentType: string): Promise<void> {
  // Content type is meaningless on disk — the extension already carried by
  // `key` is what the rest of the app (and the OS) uses to interpret the
  // file, exactly as before.
  const dir = caseUploadDir(caseId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(documentPath(caseId, key), bytes);
}

async function getDocument(caseId: string, key: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(documentPath(caseId, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function deleteDocument(caseId: string, key: string): Promise<void> {
  await fsp.rm(documentPath(caseId, key), { force: true });
}

async function deleteCaseDocuments(caseId: string): Promise<void> {
  await fsp.rm(caseUploadDir(caseId), { recursive: true, force: true });
}

async function deleteAllDocuments(): Promise<void> {
  await fsp.rm(UPLOADS_DIR, { recursive: true, force: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
}

export const filesystemAdapter: StorageAdapter = {
  kind: 'filesystem',
  readStore,
  writeStore,
  putDocument,
  getDocument,
  deleteDocument,
  deleteCaseDocuments,
  deleteAllDocuments,
};
