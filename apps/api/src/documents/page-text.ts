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
 * for words. The chat searches them where no value on the file answers a
 * question (`paperPassages`), and a model in the chat has the same search as
 * a tool: this file hands it to the tool, because the pages are in storage.
 */

import { setPaperSearch } from '@realytica/agents';
import { papersAsked, type ChatIngestFile, type DdProject, type PaperPassage, type PaperWordsAsked } from '@realytica/shared';
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

/** A line that says it numbers the page ("Page 3", "Page 3 of 3"), or a number set between dashes as a printer centres one ("- 3 -"). */
const PAGE_NUMBER_LINE = /^\W*page\s+\d+(?:\s*(?:of|\/)\s*\d+)?\W*$|^\s*[-–—]\s*\d{1,4}\s*[-–—]\s*$/i;
/** "3 of 3", which numbers the page only where it is this page of this paper's count. */
const N_OF_M = /^\W*(\d+)\s+of\s+(\d+)\W*$/i;

/**
 * A page's words without the line that numbers it, at its head or its foot.
 * The line is the printer's and not the paper's: quoted, it reads as the end
 * of the passage ("…Bengaluru Page 3 of 3").
 *
 * Only a line that is unmistakably the page's own number is left out. A
 * survey number ("118/2"), a door number or a date alone on a line is the
 * paper's, and stays. `page` and `pagesInFile` are this page's number and how
 * many the paper has.
 */
function withoutPageNumber(text: string, page: number, pagesInFile: number): string {
  const numbers = (line: string): boolean => {
    if (PAGE_NUMBER_LINE.test(line)) return true;
    const count = N_OF_M.exec(line);
    return Boolean(count) && Number(count![1]) === page && Number(count![2]) === pagesInFile;
  };
  const lines = text.trim().split('\n');
  if (lines.length > 1 && numbers(lines[lines.length - 1]!)) lines.pop();
  if (lines.length > 1 && numbers(lines[0]!)) lines.shift();
  return lines.join('\n');
}

/**
 * A word without its ending, so that one asked for in one form is found in
 * another: witness and witnesses, inherited and inheritance, charge and
 * charged. English endings only. A word in another script is itself.
 */
function stem(word: string): string {
  if (!/^[a-z]{4,}$/.test(word)) return word;
  let out = word;
  if (out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else if (/(?:s|x|z|ch|sh)es$/.test(out)) out = out.slice(0, -2);
  else if (/[^su]s$/.test(out)) out = out.slice(0, -1);
  for (const ending of ['ance', 'ence', 'ment', 'ing', 'ed']) {
    if (out.endsWith(ending) && out.length - ending.length >= 4) {
      out = out.slice(0, -ending.length);
      break;
    }
  }
  return out.length > 4 && out.endsWith('e') ? out.slice(0, -1) : out;
}

/**
 * The page's own words around what was looked for, cut at word boundaries:
 * from where the most of the words stand together, and among such places the
 * one that writes the most of them as they were asked for, the first of
 * those. `text` is the page without the line that numbers it, `asked` the
 * words as asked, and `form` the form they are compared in.
 */
function snippetAround(text: string, asked: readonly string[], form: (word: string) => string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const wanted = asked.map(form);
  const found = [...flat.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].flatMap((word) => {
    const written = plain(word[0]);
    return wanted.includes(form(written)) ? [{ at: word.index, said: form(written), asAsked: asked.includes(written) }] : [];
  });
  let at = found[0]?.at ?? 0;
  let most = 0;
  for (const first of found) {
    const near = found.filter((other) => other.at >= first.at && other.at < first.at + (SNIPPET_CHARS * 2) / 3);
    // Every word together counts for more than any number written as asked.
    const score = new Set(near.map((other) => other.said)).size * (asked.length + 1) + new Set(near.filter((other) => other.asAsked).map((other) => other.said)).size;
    if (score > most) [most, at] = [score, first.at];
  }
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
 * whole, in any script, whatever their case or punctuation. `loose` matches
 * a word in any of its forms (`stem`): for a person's question, which is in
 * their words and not the paper's. `together` takes a page only where the
 * passage quoted from it holds every word: for a question's own words, two
 * of which are somewhere on most pages.
 */
export async function searchPageTexts(
  project: Pick<DdProject, 'id' | 'evidence'>,
  words: string,
  opts: { maxFiles?: number; maxHits?: number; loose?: boolean; together?: boolean } = {},
): Promise<PageTextSearch> {
  const maxFiles = opts.maxFiles ?? 40;
  const maxHits = opts.maxHits ?? 20;
  const form = opts.loose ? stem : (word: string): string => word;
  const asked = [...new Set(plain(words).split(' ').filter(Boolean))];
  const wanted = [...new Set(asked.map(form))];
  const rows = project.evidence
    .filter((row) => row.attachments.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const hits: PageTextHit[] = [];
  let opened = 0;
  if (!wanted.length) return { hits, opened, notOpened: rows.length };
  const holds = (text: string): boolean => {
    const held = new Set(plain(text).split(' ').map(form));
    return wanted.every((word) => held.has(word));
  };
  for (const row of rows) {
    if (opened >= maxFiles || hits.length >= maxHits) break;
    const file = row.attachments[row.attachments.length - 1]!;
    opened += 1;
    const kept = await loadPageTexts(project.id, file.storageKey);
    if (!kept) continue;
    for (const page of kept.pages) {
      if (hits.length >= maxHits) break;
      if (!holds(page.text)) continue;
      const snippet = snippetAround(withoutPageNumber(page.text, page.page, kept.pagesInFile), asked, form);
      if (opts.together && !holds(snippet)) continue;
      hits.push({ evidenceId: row.id, title: row.title, fileName: file.fileName, storageKey: file.storageKey, page: page.page, reader: page.reader, snippet });
    }
  }
  return { hits, opened, notOpened: Math.max(0, rows.length - opened) };
}

/**
 * The passages that answer a question put to the papers' own words: the
 * pages of the papers it is about that hold every word it asks for, in
 * whatever form the paper writes them, and in one passage where the question
 * says so (`together`). `project` is the record as the person asking may see
 * it, so only the papers on their copy are searched.
 */
export async function paperPassages(project: Pick<DdProject, 'id' | 'evidence'>, asked: PaperWordsAsked): Promise<{ passages: PaperPassage[]; notOpened: number }> {
  const papers = papersAsked(project, asked);
  if (!papers.length) return { passages: [], notOpened: 0 };
  const found = await searchPageTexts({ id: project.id, evidence: papers }, asked.words, { loose: true, together: asked.together });
  return { passages: found.hits.map((hit) => ({ evidenceId: hit.evidenceId, page: hit.page, snippet: hit.snippet, reader: hit.reader })), notOpened: found.notOpened };
}

// A model in the chat searches the same pages, through the tool the agents package gives it.
setPaperSearch((project, words) => searchPageTexts(project, words, { loose: true, maxHits: 8 }));
