/**
 * Each page's text, kept beside the file it was read from.
 *
 * A reading used to keep what it understood (a document's kind, its facts,
 * their quotes) and throw the words away. Whatever the rules had no pattern
 * for was then gone: nothing could answer "what does the deed say about the
 * right of way" without reading the scan again.
 *
 * So the pages are kept: one small JSON object a file, stored through the
 * same adapter as the file and under the same project, at a key made from the
 * file's own. Nothing of it goes into the project record. It is deleted with
 * the project (everything under a project's uploads is), and `forgetPageTexts`
 * is for the day one paper can be deleted on its own.
 *
 * Read back two ways: one paper's pages, and a search of a project's papers
 * for words.
 */

import type { ChatIngestFile, DdProject } from '@realytica/shared';
import { storageAdapter } from '../storage';
import { pagesOf, type PaperPages } from './intake';

export type { PaperPage, PaperPages } from './intake';

/**
 * Where a file's pages are kept: beside it, under a name made from its key.
 *
 * The name starts with what it is and not with the file's key, so no listing
 * by the file's key as a prefix ever returns it, and it is one flat name,
 * because the filesystem adapter keeps a project's files in one directory.
 */
export function pageTextKey(storageKey: string): string {
  return `pagetext_${storageKey.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
}

/**
 * Keep the pages of the files a turn read, each beside its file.
 *
 * A file this process read carries its pages (`pagesOf`). One only the model
 * read this turn has the passages the model quoted, kept when nothing fuller
 * is there already. Never throws: a reading stands without its page text.
 */
export async function keepPageTexts(projectId: string, files: readonly ChatIngestFile[]): Promise<void> {
  for (const file of files) {
    const pages = pagesOf(file);
    if (!pages?.pages.length) continue;
    try {
      const key = pageTextKey(file.storageKey);
      // The model reader's quotes are thinner than a page of text: they do not replace one.
      if (pages.pages.every((page) => page.reader === 'model') && (await storageAdapter.getDocument(projectId, key))) continue;
      await storageAdapter.putDocument(projectId, key, Buffer.from(JSON.stringify(pages)), 'application/json');
    } catch (err) {
      console.warn(`[page text] could not keep the pages of a file: ${(err as Error).message}`);
    }
  }
}

/** One paper's pages as they were read, or null when none were kept. */
export async function loadPageTexts(projectId: string, storageKey: string): Promise<PaperPages | null> {
  try {
    const bytes = await storageAdapter.getDocument(projectId, pageTextKey(storageKey));
    const kept = bytes ? (JSON.parse(bytes.toString('utf8')) as Partial<PaperPages>) : null;
    return kept && kept.v === 1 && Array.isArray(kept.pages) ? (kept as PaperPages) : null;
  } catch {
    return null;
  }
}

/** Delete a paper's pages. For whatever deletes the paper's own file. */
export async function forgetPageTexts(projectId: string, storageKey: string): Promise<void> {
  await storageAdapter.deleteDocument(projectId, pageTextKey(storageKey));
}

export interface PageTextHit {
  evidenceId: string;
  /** The row's title, and the file on it the words were found in. */
  title: string;
  fileName: string;
  storageKey: string;
  /** 1-based. */
  page: number;
  /** Which reader's words these are; see `PaperPage.reader`. */
  reader: PaperPages['pages'][number]['reader'];
  /** The words around the first of the words looked for, as the page has them. */
  snippet: string;
}

export interface PageTextSearch {
  hits: PageTextHit[];
  /** Files opened, and files on the project that were not, because the search stops at a number of them. */
  opened: number;
  notOpened: number;
}

/** Letters, marks and digits of any script, lower-cased, everything else one space: the form words are looked for in. */
function plain(text: string): string {
  // OCR writes a zero-width non-joiner after a word's final consonant, where a typist writes none.
  return text.normalize('NFKC').replace(/[\u200c\u200d]/g, '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

const SNIPPET_CHARS = 180;

/** The page's own words around `word`, cut at word boundaries. */
function snippetAround(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(word));
  const from = Math.max(0, at - SNIPPET_CHARS / 3);
  const start = from === 0 ? 0 : flat.indexOf(' ', from) + 1;
  const cut = flat.slice(start, start + SNIPPET_CHARS);
  const end = start + cut.length >= flat.length ? cut : cut.slice(0, Math.max(cut.lastIndexOf(' '), 1));
  return `${start > 0 ? '…' : ''}${end.trim()}${start + end.length < flat.length ? '…' : ''}`;
}

/**
 * The pages of a project's papers that hold every one of the words asked for.
 *
 * Only the files on the project it is handed, so a person's own view of the
 * project is what is searched. It opens the latest file on each row, newest
 * row first, and stops at `maxFiles` of them; `notOpened` says how many it
 * left, so an answer can say it did not look everywhere. Words are matched
 * whole, in any script, whatever their case or punctuation.
 */
export async function searchPageTexts(
  project: Pick<DdProject, 'id' | 'evidence'>,
  words: string,
  opts: { maxFiles?: number; maxHits?: number } = {},
): Promise<PageTextSearch> {
  const maxFiles = opts.maxFiles ?? 40;
  const maxHits = opts.maxHits ?? 20;
  const wanted = [...new Set(plain(words).split(' ').filter(Boolean))];
  const rows = project.evidence
    .filter((row) => row.attachments.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const hits: PageTextHit[] = [];
  let opened = 0;
  if (!wanted.length) return { hits, opened, notOpened: rows.length };
  for (const row of rows) {
    if (opened >= maxFiles || hits.length >= maxHits) break;
    const file = row.attachments[row.attachments.length - 1]!;
    opened += 1;
    const kept = await loadPageTexts(project.id, file.storageKey);
    for (const page of kept?.pages ?? []) {
      if (hits.length >= maxHits) break;
      const held = new Set(plain(page.text).split(' '));
      if (!wanted.every((word) => held.has(word))) continue;
      hits.push({
        evidenceId: row.id,
        title: row.title,
        fileName: file.fileName,
        storageKey: file.storageKey,
        page: page.page,
        reader: page.reader,
        snippet: snippetAround(page.text, wanted[0]!),
      });
    }
  }
  return { hits, opened, notOpened: Math.max(0, rows.length - opened) };
}
