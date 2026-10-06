/**
 * A reading in progress, as the canvas draws it.
 *
 * The upload turn streams one line per thing that happens to a document — it
 * started, a page was reached, its facts were read, the model began and
 * finished. This folds those lines into one object per document, so the
 * reading desk can draw the page being scanned and each fact as it arrives,
 * instead of waiting for the turn's result to show everything at once.
 */

import type { ChatProposal, DocumentFact, ReadingStreamEvent } from '@realytica/shared';

/** Where a document's bytes can be had, to draw its pages. */
export type ReadingSource =
  | { kind: 'local'; file: File }
  | { kind: 'evidence'; evidenceId: string; fileId: string }
  | { kind: 'proposal'; proposalId: string };

export type ReadingPhase = 'queued' | 'reading' | 'read' | 'model' | 'done' | 'failed';

export interface ReadingFile {
  /** The file's storage key — what every stream line about it shares. */
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: ReadingSource | null;
  phase: ReadingPhase;
  /** The page being read, and how many there are. */
  page?: number;
  pages?: number;
  label?: string;
  method?: string;
  summary?: string;
  failure?: string;
  /** What this server's reader found, with where on the page. */
  facts: DocumentFact[];
  /** What only the model added. */
  modelFacts: DocumentFact[];
  notes?: string;
  /** When its facts arrived, so they are revealed once, not on every render. */
  readAt?: number;
}

export interface ReadingSession {
  id: string;
  /** `live` while a turn is reading; `review` when opened from cards already in the chat. */
  mode: 'live' | 'review';
  files: ReadingFile[];
  finished: boolean;
  /** Documents just filed — the desk steps through each one being filed, then hands back to the register. */
  filingKeys?: string[];
}

export function newReadingSession(mode: ReadingSession['mode'] = 'live'): ReadingSession {
  return { id: `rd_${Date.now().toString(36)}`, mode, files: [], finished: false };
}

/** A file the person dropped in, found by name and size — the turn never sends the bytes back. */
function localFor(files: File[] | undefined, name: string, size: number): File | undefined {
  return files?.find((f) => f.name === name && f.size === size) ?? files?.find((f) => f.name === name);
}

function patch(session: ReadingSession, key: string, change: (file: ReadingFile) => ReadingFile): ReadingSession {
  return { ...session, files: session.files.map((f) => (f.key === key ? change(f) : f)) };
}

export function applyReadingEvent(
  session: ReadingSession,
  event: ReadingStreamEvent,
  ctx: { localFiles?: File[] } = {},
): ReadingSession {
  switch (event.event) {
    case 'start': {
      const local = localFor(ctx.localFiles, event.fileName, event.sizeBytes);
      const source: ReadingSource | null = local
        ? { kind: 'local', file: local }
        : event.evidenceId && event.fileId
          ? { kind: 'evidence', evidenceId: event.evidenceId, fileId: event.fileId }
          : null;
      const file: ReadingFile = {
        key: event.key,
        fileName: event.fileName,
        mimeType: event.mimeType,
        sizeBytes: event.sizeBytes,
        source,
        phase: 'reading',
        page: 1,
        facts: [],
        modelFacts: [],
      };
      const exists = session.files.some((f) => f.key === event.key);
      return exists ? patch(session, event.key, () => file) : { ...session, files: [...session.files, file] };
    }
    case 'page':
      return patch(session, event.key, (f) => ({ ...f, page: event.page, pages: event.of }));
    case 'read':
      return patch(session, event.key, (f) => ({
        ...f,
        phase: event.failure && !event.facts.length ? 'failed' : 'read',
        label: event.label,
        method: event.method,
        pages: event.pages ?? f.pages,
        summary: event.summary,
        failure: event.failure,
        facts: event.facts,
        readAt: Date.now(),
      }));
    case 'model':
      return patch(session, event.key, (f) =>
        event.phase === 'start'
          ? { ...f, phase: 'model' }
          : {
              ...f,
              phase: f.phase === 'failed' && !(event.facts ?? []).length ? 'failed' : 'done',
              modelFacts: (event.facts ?? []).filter((m) => !f.facts.some((l) => l.key === m.key)),
              notes: event.notes ?? f.notes,
            },
      );
    case 'merged':
      // What the cards will carry: the rules' values, with a model's differing one beside it, then what only the model read.
      return patch(session, event.key, (f) => ({
        ...f,
        facts: event.facts.filter((fact) => fact.source !== 'model'),
        modelFacts: event.facts.filter((fact) => fact.source === 'model'),
      }));
    default:
      return session;
  }
}

/** Every file settles when the turn's result arrives, whether or not a model read it. */
export function finishReading(session: ReadingSession): ReadingSession {
  return {
    ...session,
    finished: true,
    files: session.files.map((f) => (f.phase === 'reading' || f.phase === 'model' || f.phase === 'read' ? { ...f, phase: f.phase === 'reading' && !f.facts.length ? 'failed' : 'done' } : f)),
  };
}

/** A document card, as a file on the desk — for opening the desk from cards already in the chat. */
export function readingFileFromProposal(card: ChatProposal): ReadingFile | null {
  if (card.kind !== 'file_evidence') return null;
  const p = card.payload as Record<string, unknown>;
  const key = typeof p.storageKey === 'string' ? p.storageKey : '';
  if (!key) return null;
  const facts = Array.isArray(p.facts) ? (p.facts as DocumentFact[]) : [];
  return {
    key,
    fileName: typeof p.fileName === 'string' ? p.fileName : 'Document',
    mimeType: typeof p.mimeType === 'string' ? p.mimeType : 'application/pdf',
    sizeBytes: typeof p.sizeBytes === 'number' ? p.sizeBytes : 0,
    source: { kind: 'proposal', proposalId: card.id },
    phase: typeof p.readFailure === 'string' && !facts.length ? 'failed' : 'done',
    label: typeof p.documentType === 'string' ? p.documentType : undefined,
    method: typeof p.readMethod === 'string' ? p.readMethod : undefined,
    failure: typeof p.readFailure === 'string' ? p.readFailure : undefined,
    facts: facts.filter((f) => f.source !== 'model'),
    modelFacts: facts.filter((f) => f.source === 'model'),
    notes: typeof p.extractionNotes === 'string' ? p.extractionNotes : undefined,
  };
}

/** Where a file stands with its card: waiting for a person, filed, or skipped. */
export function cardStateFor(key: string, proposals: ChatProposal[] | undefined): 'proposed' | 'committed' | 'rejected' | null {
  const card = [...(proposals ?? [])].reverse().find((p) => p.kind === 'file_evidence' && (p.payload as { storageKey?: unknown }).storageKey === key);
  if (!card) return null;
  return card.status === 'committed' ? 'committed' : card.status === 'rejected' ? 'rejected' : card.status === 'proposed' ? 'proposed' : null;
}

/** The fact a person is pointing at, on the file it comes from. */
export interface SourceFocus {
  key: string;
  fact: DocumentFact;
}
