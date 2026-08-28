import fsp from 'node:fs/promises';
import { accessSync, constants, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoreData } from '../store';
import type { StorageAdapter } from './types';
import { readEnv } from '@realytica/agents';

/**
 * The filesystem-backed `StorageAdapter` — exactly the layout and semantics
 * Realytica has always used locally: `REALYTICA_DATA_DIR` (or `../../data`,
 * i.e. `apps/api/data`, when unset) holds `realytica.json` plus an
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

/** Can we create this directory and write into it? */
function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where this adapter keeps its data.
 *
 * `REALYTICA_DATA_DIR` always wins — an operator naming a directory means it,
 * and silently writing somewhere else would hide a misconfiguration rather
 * than surface it.
 *
 * Otherwise the default is `apps/api/data`, the layout Realytica has always
 * used. That default assumes a writable checkout, which is true on a laptop
 * and false in a read-only container — a serverless deployment with no Blob
 * store attached being the case that prompted this. There the write would
 * fail with EROFS during boot-time seeding, so every request 500s and the
 * app never serves at all. Falling back to the OS temp directory keeps it
 * running on the one path that is writable in those environments.
 *
 * That fallback trades durability for availability, so it is deliberately
 * loud: temp storage is typically wiped between instances, which means data
 * entered in one session can be gone in the next. It is a way to keep a
 * demo working, not a way to run the app — attaching a Blob store (which
 * sets `BLOB_READ_WRITE_TOKEN` and selects the Blob adapter instead) is.
 */
function resolveDataDir(): string {
  const override = readEnv('DATA_DIR');
  if (override) return path.resolve(override);
  const preferred = path.resolve(here, '../../data');
  if (isWritable(preferred)) return preferred;
  const fallback = path.join(os.tmpdir(), 'realytica-data');
  console.warn(
    `[storage/filesystem] ${preferred} is not writable — falling back to ${fallback}. ` +
      'This storage is temporary and data will not survive a restart. ' +
      'Connect a Vercel Blob store (which sets BLOB_STORE_ID, or BLOB_READ_WRITE_TOKEN for a public store) or set REALYTICA_DATA_DIR for durable storage.',
  );
  return fallback;
}

export const DATA_DIR = resolveDataDir();

export const DATA_FILE = path.join(DATA_DIR, 'realytica.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

/**
 * The pre-rename store filename. A checkout that ran the app before the
 * Realytica rename has its cases in this file and nowhere else, so reads fall
 * back to it when the current name is absent. Writes always go to
 * `DATA_FILE`, which migrates the data on the first save without ever
 * touching (or deleting) the old file — if this turns out to be the wrong
 * call, the original is still sitting there intact.
 */
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'valytica.json');

/** Directory that holds uploaded files for one case. Always built from a
 * case id we already found in the store — never from a raw path param. */
export function caseUploadDir(caseId: string): string {
  return path.join(UPLOADS_DIR, caseId);
}

function documentPath(caseId: string, key: string): string {
  return path.join(caseUploadDir(caseId), key);
}

async function readFile(file: string): Promise<StoreData | null> {
  try {
    const raw = await fsp.readFile(file, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as StoreData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt JSON, permissions error, etc. — warn and let the caller fall
    // back to an empty store rather than taking the whole app down over one
    // unreadable file.
    console.warn(
      `[storage/filesystem] failed to read ${file}, starting from an empty store: ${(err as Error).message}`,
    );
    return null;
  }
}

async function readStore(): Promise<StoreData | null> {
  const current = await readFile(DATA_FILE);
  if (current) return current;
  const legacy = await readFile(LEGACY_DATA_FILE);
  if (legacy) {
    console.info(
      `[storage/filesystem] read the pre-rename store at ${LEGACY_DATA_FILE}; ` +
        `the next save will write ${DATA_FILE} and leave the original in place.`,
    );
  }
  return legacy;
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
