/**
 * Fetch open official PDFs into a local shelf cache and extract citeable
 * passages. This is the reference corpus, not the evidence register.
 *
 * Allowed: IBBI circulars, gazettes, India Code PDFs that answer without
 * login. Refused: paid NBC/IVS, and every CAPTCHA/OTP portal.
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fetchableReferenceWorks,
  lookupReferences,
  referenceFetchUrl,
  searchPassages,
  serializeReferenceHits,
  splitReferenceText,
  type ReferenceHit,
  type ReferencePassage,
  type ReferenceWork,
  type ScopeKey,
} from '@realytica/shared';
import { DATA_DIR } from '../storage/filesystem';

const SHELF_DIR = path.join(DATA_DIR, 'reference-shelf');
const INDEX = path.join(SHELF_DIR, 'index.json');
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_MS = 25_000;

export interface ShelfCacheEntry {
  workId: string;
  fetchedAt: string;
  bytes: number;
  textChars: number;
  ok: boolean;
  error?: string;
  passages: ReferencePassage[];
}

type ShelfIndex = Record<string, ShelfCacheEntry>;

let memory: ShelfIndex | null = null;

async function loadIndex(): Promise<ShelfIndex> {
  if (memory) return memory;
  try {
    memory = JSON.parse(await readFile(INDEX, 'utf8')) as ShelfIndex;
  } catch {
    memory = {};
  }
  return memory;
}

async function saveIndex(index: ShelfIndex): Promise<void> {
  memory = index;
  await mkdir(SHELF_DIR, { recursive: true });
  const tmp = `${INDEX}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(index), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, INDEX);
}

function fontsUrl(): string {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return pathToFileURL(path.join(root, 'standard_fonts') + path.sep).href;
}

function workerSrc(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc();
  }
  const pdf = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: fontsUrl(),
  }).promise;
  const pages: string[] = [];
  const last = Math.min(pdf.numPages, 40);
  for (let i = 1; i <= last; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((item) => ('str' in item ? String(item.str) : '')).join(' ');
    if (line.trim()) pages.push(line);
  }
  return pages.join('\n');
}

async function download(url: string): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Realytica-reference-shelf/1.0 (official open PDFs only)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error(`file too large (${buf.byteLength} bytes)`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestReferenceWork(work: ReferenceWork): Promise<ShelfCacheEntry> {
  const url = referenceFetchUrl(work);
  try {
    const bytes = await download(url);
    await mkdir(SHELF_DIR, { recursive: true });
    await writeFile(path.join(SHELF_DIR, `${work.id}.pdf`), bytes);
    const text = await extractPdfText(bytes);
    await writeFile(path.join(SHELF_DIR, `${work.id}.txt`), text, 'utf8');
    const passages = splitReferenceText(work.title, text);
    const entry: ShelfCacheEntry = {
      workId: work.id,
      fetchedAt: new Date().toISOString(),
      bytes: bytes.byteLength,
      textChars: text.length,
      ok: text.length > 80,
      error: text.length > 80 ? undefined : 'PDF downloaded but no extractable text',
      passages,
    };
    const index = await loadIndex();
    index[work.id] = entry;
    await saveIndex(index);
    return entry;
  } catch (err) {
    const entry: ShelfCacheEntry = {
      workId: work.id,
      fetchedAt: new Date().toISOString(),
      bytes: 0,
      textChars: 0,
      ok: false,
      error: (err as Error).message,
      passages: [],
    };
    const index = await loadIndex();
    index[work.id] = entry;
    await saveIndex(index);
    return entry;
  }
}

export async function ingestOpenReferences(opts?: { force?: boolean }): Promise<{
  fetched: number;
  failed: number;
  skipped: number;
  entries: ShelfCacheEntry[];
}> {
  const index = await loadIndex();
  const entries: ShelfCacheEntry[] = [];
  let fetched = 0;
  let failed = 0;
  let skipped = 0;
  for (const work of fetchableReferenceWorks()) {
    const prior = index[work.id];
    if (!opts?.force && prior) {
      skipped += 1;
      entries.push(prior);
      continue;
    }
    const entry = await ingestReferenceWork(work);
    entries.push(entry);
    if (entry.ok) fetched += 1;
    else failed += 1;
  }
  return { fetched, failed, skipped, entries };
}

export async function attachShelfPassages(
  hits: ReferenceHit[],
  query: string,
): Promise<ReferenceHit[]> {
  const index = await loadIndex();
  return hits.map((hit) => {
    const cached = index[hit.id];
    if (!cached?.ok || !cached.passages.length) {
      return { ...hit, notEvidence: true as const, ingested: Boolean(cached?.ok) };
    }
    return {
      ...hit,
      notEvidence: true as const,
      ingested: true,
      passages: searchPassages(cached.passages, query, 3),
    };
  });
}

export async function lookupShelf(
  query: string,
  extra?: { scopeKey?: ScopeKey; checkTitle?: string },
): Promise<{ hits: ReferenceHit[]; text: string }> {
  const hits = await attachShelfPassages(lookupReferences(query, extra), query);
  return { hits, text: serializeReferenceHits(hits) };
}

export async function shelfStatus(): Promise<{
  dir: string;
  works: number;
  ingested: number;
  failed: number;
}> {
  const index = await loadIndex();
  const rows = Object.values(index);
  return {
    dir: SHELF_DIR,
    works: fetchableReferenceWorks().length,
    ingested: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
  };
}
