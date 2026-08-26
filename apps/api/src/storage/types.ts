import type { StoreData } from '../store';

/**
 * Where Valytica keeps its state.
 *
 * The app was built filesystem-first, which is right for a local-first tool and
 * wrong for serverless: on Vercel the filesystem is read-only apart from /tmp,
 * and nothing written survives the instance. Rather than fork the app, the two
 * places that actually touch persistence — the case store and uploaded document
 * bytes — go through this interface.
 *
 * The filesystem adapter must behave exactly as the app does today, because
 * `pnpm dev` is the verified path and a deployment change should not regress it.
 */
export interface StorageAdapter {
  /** Human name for the boot log, so it is obvious which backend is live. */
  readonly kind: 'filesystem' | 'vercel-blob';

  /** Load the whole store. Returns null when nothing has been persisted yet. */
  readStore(): Promise<StoreData | null>;

  /**
   * Persist the whole store.
   *
   * Must be durable by the time it resolves. The filesystem adapter writes to a
   * temp file and renames so a crash cannot truncate the JSON; a remote adapter
   * must not resolve before the write is acknowledged, because on serverless the
   * process can be frozen the moment the response is sent.
   */
  writeStore(data: StoreData): Promise<void>;

  /** Store the bytes of an uploaded document. */
  putDocument(caseId: string, key: string, bytes: Buffer, contentType: string): Promise<void>;

  /** Read a stored document back. Returns null when it is not there. */
  getDocument(caseId: string, key: string): Promise<Buffer | null>;

  deleteDocument(caseId: string, key: string): Promise<void>;

  /** Remove every document belonging to a case — used when a case is deleted. */
  deleteCaseDocuments(caseId: string): Promise<void>;

  /** Remove all documents for every case — used by the demo reset. */
  deleteAllDocuments(): Promise<void>;
}

/**
 * The storage key for one document.
 *
 * Derived from ids we have already resolved against the store, never from a raw
 * path parameter — the same guard the filesystem paths relied on, kept here so
 * it holds for every backend.
 */
export function documentKey(doc: { id: string; fileName: string }): string {
  const dot = doc.fileName.lastIndexOf('.');
  const ext = dot > 0 ? doc.fileName.slice(dot) : '';
  return `${doc.id}${ext}`;
}
