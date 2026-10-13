/**
 * A drop of papers that is still being read, remembered past a reload.
 *
 * The server reads on when the page stops listening: a closed tab, a reload
 * or a dropped connection does not stop a paper being read and filed. The
 * page that comes back has no stream to listen to, so what was dropped is
 * kept here (the file names and the moment), and the papers are found on the
 * project as they land. A person who reloads at "7 of 10 read" is told the
 * reading continues and sees each paper as it arrives, never an unexplained
 * three.
 *
 * Kept in the browser, a drop at a time for each project. It is a note of
 * what was sent, never a record: the papers themselves are on the project.
 */

import type { EvidenceRecord } from '@realytica/shared';

export interface ReadingRemembered {
  /** When the papers were sent. */
  at: string;
  /** The files' names, as they were dropped. */
  names: string[];
}

/** How long a drop is looked for. Past this, whatever did not land is not coming, and the note is dropped. */
export const READING_REMEMBERED_MINUTES = 30;

const keyOf = (projectId: string): string => `realytica.reading.${projectId}`;

/** What of the browser's store is used here. */
interface Kept {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's store, or none where there is no browser or it is closed to the page. */
function store(): Kept | null {
  try {
    return (globalThis as { localStorage?: Kept }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberReading(projectId: string, names: string[], at: string = new Date().toISOString()): void {
  if (!names.length) return;
  try {
    store()?.setItem(keyOf(projectId), JSON.stringify({ at, names } satisfies ReadingRemembered));
  } catch {
    // A full or closed store costs the notice after a reload, and nothing else.
  }
}

export function forgetReading(projectId: string): void {
  try {
    store()?.removeItem(keyOf(projectId));
  } catch {
    // Nothing to forget.
  }
}

export function readingRemembered(projectId: string): ReadingRemembered | null {
  try {
    const raw = store()?.getItem(keyOf(projectId));
    const held = raw ? (JSON.parse(raw) as Partial<ReadingRemembered>) : null;
    return held && typeof held.at === 'string' && Array.isArray(held.names) && held.names.every((name) => typeof name === 'string') ? { at: held.at, names: held.names } : null;
  } catch {
    return null;
  }
}

export interface ReadingProgress {
  /** The papers that have landed, in the order dropped: the file's name and the row it was filed on. */
  landed: Array<{ name: string; evidenceId: string; title: string; facts: number }>;
  /** The files not on the project yet. */
  reading: string[];
  total: number;
  /** Every paper is on the project. */
  done: boolean;
  /** Too long ago to still be on its way. */
  stale: boolean;
}

/**
 * Where a remembered drop stands, read off the project. A paper has landed
 * when a file of its name was filed at or after the drop. Two files of one
 * name are two papers: each row answers for one of them.
 */
export function readingProgress(remembered: ReadingRemembered, evidence: readonly Pick<EvidenceRecord, 'id' | 'title' | 'attachments' | 'facts'>[], now: Date = new Date()): ReadingProgress {
  // A minute's grace: the page's clock and the server's are two clocks.
  const since = new Date(remembered.at).getTime() - 60_000;
  const taken = new Set<string>();
  const landed: ReadingProgress['landed'] = [];
  const reading: string[] = [];
  for (const name of remembered.names) {
    const row = evidence.find((held) => !taken.has(held.id) && (held.attachments ?? []).some((file) => file.fileName === name && new Date(file.uploadedAt).getTime() >= since));
    if (row) {
      taken.add(row.id);
      landed.push({ name, evidenceId: row.id, title: row.title, facts: row.facts?.length ?? 0 });
    } else {
      reading.push(name);
    }
  }
  const stale = now.getTime() - new Date(remembered.at).getTime() > READING_REMEMBERED_MINUTES * 60_000;
  return { landed, reading, total: remembered.names.length, done: reading.length === 0, stale };
}
