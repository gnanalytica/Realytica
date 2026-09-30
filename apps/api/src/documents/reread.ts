/**
 * Reading documents that are already filed.
 *
 * The reader runs when a file is uploaded. Anything filed before it existed,
 * or before it could read that kind of document, sits on its row with nothing
 * read out of it: no facts, no page, no words, so no check can cite it and no
 * answer can quote it. "Read the filed documents" sends those files back down
 * the upload path from storage, so they are read exactly as a new upload is
 * and come back as cards for a person to approve.
 */

import type { DdProject } from '@realytica/shared';
import { storageAdapter } from '../storage';

/** "Read the filed documents", "read the uploaded documents again", "re-read the documents". */
export const READ_FILED_REQUEST =
  /^\s*(?:please\s+)?(?:re-?)?read\s+(?:all\s+)?(?:(?:the|my|our|these|those)\s+)?(?:(?:filed|uploaded|existing|unread|stored)\s+)?(?:documents?|docs|files|papers)(?:\s+(?:on\s+(?:this\s+)?(?:file|project)|again))*\s*[.!]?\s*$/i;

/** Whether documents already read are to be read again as well. */
export function asksAgain(question: string): boolean {
  return /\bre-read\b|\breread\b|\bagain\b/i.test(question);
}

/** As many as one upload turn takes. */
export const REREAD_LIMIT = 10;

const NOT_RELIED_ON = new Set(['rejected', 'superseded']);

export interface StoredUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  /** Already stored: read from here, never stored a second time. */
  storageKey: string;
}

/**
 * Each filed row's latest file, the unread ones unless asked again, with its
 * bytes from storage. A file whose bytes are gone is left out rather than read
 * as empty.
 */
export async function filedDocumentsToRead(project: DdProject, again: boolean): Promise<StoredUpload[]> {
  const rows = project.evidence.filter(
    (e) => e.attachments.length > 0 && !NOT_RELIED_ON.has(e.status) && (again || !(e.facts ?? []).length),
  );
  const out: StoredUpload[] = [];
  for (const row of rows) {
    if (out.length >= REREAD_LIMIT) break;
    const file = row.attachments[row.attachments.length - 1]!;
    const bytes = await storageAdapter.getDocument(project.id, file.storageKey);
    if (!bytes) continue;
    out.push({
      originalname: file.fileName,
      mimetype: file.mimeType,
      size: file.sizeBytes || bytes.length,
      buffer: bytes,
      storageKey: file.storageKey,
    });
  }
  return out;
}
