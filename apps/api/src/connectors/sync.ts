/**
 * Reading a project's connected folder: what is new or changed in it is
 * taken in as if it had been dropped in the app.
 *
 * A file of the folder goes down the path a dropped paper goes down. Its
 * bytes are stored, it is read here (text layer or OCR, `readIngestLocally`),
 * its pages are kept beside it, and it is put on the record by the same step
 * that files a dropped paper the moment it is read (`landIngestFile`): on the
 * row it answers or a row of its own, with what it states waiting there for a
 * person. A file changed in the folder goes down it again, as a paper dropped
 * a second time does. Each file on the record says where it came from
 * (`origin`: the folder, its path there, and which state of the file it is).
 *
 * No model is asked. A drop asks one for the papers this server could not
 * read; a timer that did would spend on every scan put in a folder with
 * nobody there. Those papers are filed as read here, and "Read the filed
 * documents" in the chat sends them to a model as it does any other.
 *
 * A file is taken once for each state of it: by the service's id for it and
 * its checksum. Which were taken, and which were left out, is kept beside the
 * project's documents (`LEDGER_KEY`), and is also read off the record's own
 * files, so a run cut short between the two takes nothing twice. A file whose
 * content is one already taken from another place in the folder is left out
 * and said to be the same file.
 *
 * A run is bounded: so many files, so much time. What it did not reach waits
 * for the next and is counted. The cursor moves only when a run has been
 * through the whole folder with nothing waiting and nothing failed; until
 * then the next run asks the folder the same question, and what was already
 * taken is passed over.
 *
 * Two runs at once on one folder would each take the same file. A run marks
 * the ledger while it works, and one that finds the mark, and finds it not
 * yet stale, does nothing and says so.
 */

import { randomUUID } from 'node:crypto';
import {
  CONNECTOR_KIND_LABEL,
  clearSkipped,
  extractReadableExcerpt,
  keepReadings,
  landIngestFile,
  noteSkipped,
  refreshProjectDerived,
  type ChatIngestFile,
  type ConnectorKind,
  type DdProject,
  type FileOrigin,
} from '@realytica/shared';
import { wordsOfDocx } from '../documents/docx-outline';
import { readIngestLocally } from '../documents/intake';
import { keepPageTexts } from '../documents/page-text';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { store } from '../store';
import { LOCAL_MAX_FILE_BYTES } from '../uploads';
import { providerFor } from './index';
import { FileUnreadable, FolderGone, tooLarge, type FolderProvider, type RemoteEntry } from './provider';

/** Where a project keeps which files of its folder were taken in or left out. */
export const LEDGER_KEY = 'connector-ledger.json';

/**
 * The most one file of a folder can be: the app's own limit on a file. A
 * dropped file is held lower on Vercel only because the platform cuts the
 * request that carries it, and nothing carries this one.
 */
export const MAX_FILE_BYTES = LOCAL_MAX_FILE_BYTES;

/** How far down a folder is read, and how many folders of it. Past either, the run says the folder was not read whole. */
const MAX_DEPTH = 8;
const MAX_FOLDERS = 400;
/** How long one file may be read for: a long scan's later pages are left for a model. */
const FILE_READ_MS = 60_000;
/** A mark left by a run that died is stale this long after its budget ran out. */
const LEASE_SLACK_MS = 90_000;
/** The cursor is set this far behind the run that moved it, for a clock that is not Google's. Files in the overlap are passed over by their checksum. */
const CURSOR_OVERLAP_MS = 5 * 60_000;

const READABLE_TYPE = /^(?:application\/pdf|image\/(?:jpe?g|png|gif|bmp|tiff?|webp)|text\/|application\/json|application\/vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet))/i;
const READABLE_EXT = /\.(?:pdf|jpe?g|png|gif|bmp|tiff?|webp|txt|csv|md|json|docx|xlsx)$/i;

/** Why a file of this kind is left out, or nothing where it can be taken in. */
export function unreadableKind(name: string, mimeType: string): string | undefined {
  if (READABLE_TYPE.test(mimeType) || READABLE_EXT.test(name)) return undefined;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
  return `${ext ? `A .${ext} file` : 'This kind of file'} cannot be read here. PDFs, images, text, Word and Excel files can.`;
}

interface LedgerFile {
  checksum: string;
  path: string;
  /** Where its bytes are, when it was taken in. */
  storageKey?: string;
  /** Why it was left out, when it was. */
  skipped?: string;
}

interface Ledger {
  kind: ConnectorKind;
  folderId: string;
  /** A run is at work until then. */
  lease?: { until: number };
  files: Record<string, LedgerFile>;
}

type Vault = Pick<typeof storageAdapter, 'getDocument' | 'putDocument' | 'deleteDocument'>;

async function readLedger(vault: Vault, projectId: string, kind: ConnectorKind, folderId: string): Promise<Ledger> {
  const bytes = await vault.getDocument(projectId, LEDGER_KEY);
  if (bytes) {
    try {
      const held = JSON.parse(bytes.toString('utf-8')) as Partial<Ledger>;
      // Another folder's ledger says nothing of this one.
      if (held.kind === kind && held.folderId === folderId && held.files && typeof held.files === 'object') return { kind, folderId, lease: held.lease, files: held.files };
    } catch {
      /* a ledger that cannot be read is begun again; the record's own files still say what was taken */
    }
  }
  return { kind, folderId, files: {} };
}

/** Forget which files of a folder were taken: for a project that is disconnected from it. */
export async function forgetLedger(projectId: string, vault: Vault = storageAdapter): Promise<void> {
  await vault.deleteDocument(projectId, LEDGER_KEY);
}

/** What a run reads projects from and writes them to: the store, or a stand-in under test. */
export interface SyncSource {
  /** The project as storage has it now. Throws when storage did not answer. */
  fresh(id: string): Promise<DdProject | undefined>;
  /** Write the project, resolving once it is durable. */
  save(project: DdProject): Promise<void>;
}

export const fromStore: SyncSource = {
  fresh: async (id) => {
    await store.pullFresh(id);
    return store.data.projects?.find((project) => project.id === id);
  },
  save: async (project) => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  },
};

export interface SyncOptions {
  now: Date;
  /** Read the whole folder, not only what was made or changed since the cursor: a file moved into the folder keeps its dates and is found only this way. */
  full?: boolean;
  /** Files taken in by one run, at most. */
  maxFiles?: number;
  /** How long one run goes on starting files. */
  budgetMs?: number;
  provider?: FolderProvider;
  source?: SyncSource;
  vault?: Vault;
}

export interface SyncRun {
  takenIn: number;
  changed: number;
  skipped: number;
  waiting: number;
  failed: number;
  /** Another run was at work on this folder, and this one did nothing. */
  busy?: true;
  /** Why the folder could not be read, where it could not. */
  error?: string;
}

export const NOT_SET_UP = 'The firm has not set this up.';

/** Who the trail names for a paper a folder brought: the folder, never a person who did not drop it. */
export function folderActor(kind: ConnectorKind): string {
  return `${CONNECTOR_KIND_LABEL[kind]} folder`;
}

/** Read one project's connected folder, and take in what is new or changed. Never throws. */
export async function syncFolder(projectId: string, opts: SyncOptions): Promise<SyncRun> {
  const run: SyncRun = { takenIn: 0, changed: 0, skipped: 0, waiting: 0, failed: 0 };
  const source = opts.source ?? fromStore;
  const vault = opts.vault ?? storageAdapter;
  const maxFiles = opts.maxFiles ?? 25;
  const budgetMs = opts.budgetMs ?? 180_000;
  const deadline = Date.now() + budgetMs;
  const at = opts.now.toISOString();
  let ledger: Ledger | undefined;
  let leased = false;
  /** The project's connector as storage has it now, or nothing where it has been disconnected, or connected elsewhere, since the run began. */
  const current = async (folderId: string): Promise<DdProject | undefined> => {
    const project = await source.fresh(projectId);
    return project?.connector?.folderId === folderId ? project : undefined;
  };
  let folderId = '';
  let provider: FolderProvider | undefined;
  try {
    const began = await source.fresh(projectId);
    const connector = began?.connector;
    if (!began || !connector) return run;
    folderId = connector.folderId;
    provider = opts.provider ?? providerFor(connector.kind);
    if (!provider.configured()) return { ...run, error: NOT_SET_UP };
    const actor = folderActor(connector.kind);

    ledger = await readLedger(vault, projectId, connector.kind, folderId);
    if (ledger.lease && ledger.lease.until > Date.now()) return { ...run, busy: true };
    ledger.lease = { until: deadline + LEASE_SLACK_MS };
    const keep = (): Promise<void> => vault.putDocument(projectId, LEDGER_KEY, Buffer.from(JSON.stringify(ledger)), 'application/json');
    await keep();
    leased = true;

    // What the record's own files say was taken: the latest state of each, where the ledger has none.
    const onRecord = new Map<string, { origin: FileOrigin; storageKey: string }>();
    for (const row of began.evidence) {
      for (const file of row.attachments) {
        const origin = file.origin;
        if (!origin || origin.kind !== connector.kind) continue;
        const held = onRecord.get(origin.fileId);
        if (!held || held.origin.takenAt < origin.takenAt) onRecord.set(origin.fileId, { origin, storageKey: file.storageKey });
      }
    }
    for (const [fileId, { origin, storageKey }] of onRecord) ledger.files[fileId] ??= { checksum: origin.checksum, path: origin.path, storageKey };

    /* ---- what is in the folder ---------------------------------------- */

    const since = opts.full ? undefined : connector.cursor;
    const found: Array<{ entry: RemoteEntry; path: string }> = [];
    const queue: Array<{ id: string; path: string; depth: number }> = [{ id: folderId, path: '', depth: 0 }];
    let folders = 0;
    /** Part of the folder was not read: too deep, or too many folders. The cursor stays. */
    let partly = false;
    while (queue.length) {
      const here = queue.shift()!;
      folders += 1;
      if (folders > MAX_FOLDERS) {
        partly = true;
        break;
      }
      let entries: RemoteEntry[];
      try {
        entries = await provider.list(here.id, since);
      } catch (err) {
        // A folder inside it removed while it was being read is no failure of the whole. The folder itself gone is.
        if (err instanceof FolderGone && here.depth > 0) continue;
        throw err;
      }
      for (const entry of entries) {
        const path = here.path ? `${here.path} / ${entry.name}` : entry.name;
        if (!entry.folder) found.push({ entry, path });
        else if (here.depth + 1 > MAX_DEPTH) partly = true;
        else queue.push({ id: entry.id, path, depth: here.depth + 1 });
      }
    }
    found.sort((a, b) => a.path.localeCompare(b.path));

    /* ---- which of it is new, and which is left out -------------------- */

    const takenContent = new Map<string, string>();
    for (const [fileId, held] of Object.entries(ledger.files)) if (held.storageKey) takenContent.set(held.checksum, fileId);
    const todo: Array<{ entry: RemoteEntry; path: string }> = [];
    const leftOut: Array<{ entry: RemoteEntry; path: string; reason: string }> = [];
    for (const item of found) {
      const { entry, path } = item;
      const held = ledger.files[entry.id];
      if (held && held.checksum === entry.checksum) continue;
      const same = entry.contentChecksum ? takenContent.get(entry.checksum) : undefined;
      const reason =
        entry.unreadable ??
        unreadableKind(entry.name, entry.mimeType) ??
        (entry.sizeBytes === 0 ? 'The file is empty.' : undefined) ??
        (entry.sizeBytes !== undefined && entry.sizeBytes > MAX_FILE_BYTES ? tooLarge(MAX_FILE_BYTES) : undefined) ??
        (same && same !== entry.id ? `The same file as ${ledger.files[same]!.path}, which is on the record.` : undefined);
      if (reason) leftOut.push({ entry, path, reason });
      else {
        todo.push(item);
        // Two copies found in one run: the first is taken, the second is the same file.
        if (entry.contentChecksum && !takenContent.has(entry.checksum)) takenContent.set(entry.checksum, entry.id);
      }
    }

    /** Leave a file out: said on the project, and remembered so the same state of it is not looked at again. */
    const leaveOut = async (items: typeof leftOut): Promise<boolean> => {
      if (!items.length) return true;
      const project = await current(folderId);
      if (!project?.connector) return false;
      for (const { entry, path, reason } of items) {
        noteSkipped(project.connector, { fileId: entry.id, path, reason, at });
        ledger!.files[entry.id] = { checksum: entry.checksum, path, skipped: reason };
        run.skipped += 1;
      }
      await source.save(project);
      await keep();
      return true;
    };
    if (!(await leaveOut(leftOut))) return run;

    /* ---- each new file, down the path a dropped paper goes ------------- */

    for (const [n, { entry, path }] of todo.entries()) {
      if (run.takenIn >= maxFiles || Date.now() > deadline) {
        run.waiting = todo.length - n;
        break;
      }
      const before = ledger.files[entry.id];
      let storageKey: string | undefined;
      let landed = false;
      try {
        const bytes = await provider.download(entry, MAX_FILE_BYTES);
        if (!bytes.length) throw new FileUnreadable('The file is empty.');
        storageKey = documentKey({ id: randomUUID(), fileName: entry.name });
        await vault.putDocument(projectId, storageKey, bytes, entry.mimeType);
        const row: ChatIngestFile = {
          fileName: entry.name,
          mimeType: entry.mimeType || 'application/octet-stream',
          sizeBytes: bytes.length,
          storageKey,
          excerpt: extractReadableExcerpt(bytes, entry.mimeType || '', entry.name) || undefined,
        };
        let paper = await readIngestLocally(row, bytes, undefined, { deadline: Math.min(deadline, Date.now() + FILE_READ_MS) });
        // The local reader takes no words from a Word file. Its own are enough to tell what it is.
        if (!paper.excerpt && /\.docx$/i.test(entry.name)) paper = { ...paper, excerpt: wordsOfDocx(bytes) };
        await keepPageTexts(projectId, [paper]);
        // Reading takes a while: the paper lands on the record as it stands now.
        const project = await current(folderId);
        if (!project?.connector) {
          await vault.deleteDocument(projectId, storageKey).catch(() => undefined);
          return run;
        }
        const evidenceId = landIngestFile(project, paper, actor);
        landed = Boolean(evidenceId);
        const filed = project.evidence.find((held) => held.id === evidenceId)?.attachments.find((file) => file.storageKey === storageKey);
        if (!filed) throw new Error('it could not be put on the record');
        keepReadings(project, [paper]);
        filed.origin = { kind: connector.kind, fileId: entry.id, path, checksum: entry.checksum, takenAt: at, ...(entry.link ? { link: entry.link } : {}), ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}) };
        project.connector.counts.takenIn += 1;
        if (before?.storageKey) project.connector.counts.changed += 1;
        clearSkipped(project.connector, entry.id);
        refreshProjectDerived(project);
        await source.save(project);
        ledger.files[entry.id] = { checksum: entry.checksum, path, storageKey };
        await keep();
        run.takenIn += 1;
        if (before?.storageKey) run.changed += 1;
      } catch (err) {
        if (err instanceof FileUnreadable) {
          if (!(await leaveOut([{ entry, path, reason: err.message }]))) return run;
          continue;
        }
        // The folder itself gone between two files is the whole run's failure, not this file's.
        if (err instanceof FolderGone) throw err;
        run.failed += 1;
        console.warn(`[connector] ${projectId}: ${path} was not taken in: ${(err as Error).message}`);
        // Bytes stored for a paper that never reached the record are taken back out.
        if (storageKey && !landed) await vault.deleteDocument(projectId, storageKey).catch(() => undefined);
      }
    }

    /* ---- how the folder stands after the run --------------------------- */

    const project = await current(folderId);
    if (!project?.connector) return run;
    project.connector.lastSyncAt = at;
    project.connector.lastError = undefined;
    project.connector.counts.waiting = run.waiting;
    if (!run.waiting && !run.failed && !partly) project.connector.cursor = new Date(opts.now.getTime() - CURSOR_OVERLAP_MS).toISOString();
    await source.save(project);
    return run;
  } catch (err) {
    const revoked = err instanceof FolderGone;
    const address = provider?.address();
    const message = revoked
      ? `The folder is no longer shared with ${address ?? 'this deployment'}. Share it again, or disconnect it.`
      : `The folder could not be read: ${(err as Error).message}`.slice(0, 300);
    console.warn(`[connector] ${projectId}: ${message}`);
    try {
      const project = folderId ? await current(folderId) : undefined;
      if (project?.connector) {
        project.connector.lastError = { message, at, ...(revoked ? { revoked: true } : {}) };
        await source.save(project);
      }
    } catch (again) {
      console.warn(`[connector] ${projectId}: the failure could not be noted: ${(again as Error).message}`);
    }
    return { ...run, error: message };
  } finally {
    if (ledger && leased) {
      delete ledger.lease;
      await vault.putDocument(projectId, LEDGER_KEY, Buffer.from(JSON.stringify(ledger)), 'application/json').catch(() => undefined);
    }
  }
}
