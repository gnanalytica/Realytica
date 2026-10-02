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
 * The filed rows a reading turn would take, in order.
 *
 * Unread means nothing stated is on the row AND no model has read it. A model
 * on a route without verified citations can say what a document is and
 * describe it while placing no value on a page; counting that as unread put
 * the same ten documents back into every turn, at a model's price each time,
 * and the ones after them were never reached.
 */
export function rowsToRead(project: DdProject, again: boolean): DdProject['evidence'] {
  // Only a card that carries a reading counts: one from a reading that failed
  // or ran out of time is no reason not to try again.
  const waiting = new Set(
    (project.chatProposals ?? [])
      .filter((card) => card.kind === 'file_evidence' && card.status === 'proposed')
      .filter((card) => Array.isArray((card.payload as { facts?: unknown }).facts) && ((card.payload as { facts: unknown[] }).facts.length > 0))
      .map((card) => String((card.payload as { storageKey?: unknown }).storageKey ?? '')),
  );
  return project.evidence.filter(
    (e) =>
      e.attachments.length > 0
      && !NOT_RELIED_ON.has(e.status)
      && (again || (!(e.facts ?? []).length && !e.modelReadAt))
      && !waiting.has(e.attachments[e.attachments.length - 1]!.storageKey),
  );
}

/** A reading turn stops starting new files after this long, and says how many are left. */
export const REREAD_BUDGET_MS = 300_000;

/**
 * Each filed row's latest file, the unread ones unless asked again, with its
 * bytes from storage. A file whose bytes are gone is left out rather than read
 * as empty, and so is one whose card from an earlier reading is still waiting:
 * asking again carries on with the rest instead of reading it twice.
 */
export async function filedDocumentsToRead(project: DdProject, again: boolean): Promise<StoredUpload[]> {
  const rows = rowsToRead(project, again);
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
