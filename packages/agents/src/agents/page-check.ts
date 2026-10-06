/**
 * Placing a model's reading on its page without taking the model's word for it.
 *
 * A fact goes on file only with the page it was read from. Claude can prove a
 * page itself: Anthropic's citations are attached by the API to the text the
 * model drew on. No other model can, and the citations do not survive a
 * gateway such as OpenRouter even when the model behind it is Claude. So the
 * page is checked here instead, in three steps, each cheaper than the next.
 *
 * 1. **Its own quote.** A value that has to be exact (a date, an area, a
 *    width, a count, an amount, an identifier) is held to the words quoted
 *    for it. A quote that ends "31-03-2024" beside the value 31-01-2024
 *    proves nothing whatever page it is on, and the value goes no further.
 * 2. **The page's own text.** Where this server read the document (a text
 *    layer, or OCR of a scan), the quote is looked for in the words of the
 *    pages that were sent to the reader, and it is found on a page only when
 *    the value's own words are on that page too. A quote most of whose words
 *    are there, with another surname at the end, is not found. Nor is a quote
 *    looked for on a page the reader never saw. A value that has to be exact
 *    is not found among words OCR read: the reader may have been handed those
 *    very words, and finding its quote among them proves only that it can
 *    copy.
 * 3. **A second reader, asked blind.** What is left, where it is under one
 *    of the rules' own keys, goes to a second reader shown that page alone.
 *    It is asked for the value by the key's name and meaning, from the fixed
 *    list. It is never shown the first reader's value or its quote: a reader
 *    shown "31-01-2024" and asked whether it is printed there said yes to a
 *    page that prints 31-03-2024. The comparing is done here, in code.
 *
 * Two readers agreeing is weaker than words found in the page's text, and is
 * said to be (`FactProof`). A value the second reader read differently is
 * refuted. One nobody could look for (no page named, a key of the reader's
 * own making, the check failed or ran out of time, more pages than a reading
 * may spend on) stays unchecked: kept on the reading at a discount, never
 * filed as a fact.
 */

import { z } from 'zod';
import type { AgentUsage } from '@realytica/shared';
import { datesIn, exactValue, normalizeDigits, parseIndianDate, STANDARD_FACT_KEYS, standardFact, standardKeyForm, standardValueForms } from '@realytica/shared';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { toolUseOf } from '../providers';
import type { LlmContentPart, LlmProvider, LlmSchemaTool } from '../providers';

/* ==================================================================== */
/* Matching a quote against words                                        */
/* ==================================================================== */

/** Letters, marks and digits of any script, lower-cased, everything else one space. */
export function normalizeForPage(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function words(normalized: string): string[] {
  // A word of one character (an initial, a lone digit) proves nothing about where a quote is.
  return normalized.split(' ').filter((w) => [...w].length > 1);
}

/**
 * The numbers in a text, each as its runs of digits: "73/4" is 73-4 and
 * "3,18,50,000" is 3-18-50-000, however it is punctuated, in whichever digits
 * it is written.
 */
export function numbersIn(text: string): string[] {
  return (normalizeDigits(text.normalize('NFKC')).match(/\d[\d/.,:-]*\d|\d/g) ?? []).map((number) => number.split(/\D+/).filter(Boolean).join('-'));
}

/**
 * Whether every number in a quote is in the other text, digit for digit.
 *
 * A word may be a letter out and still be the word: OCR drops one here and
 * there, and a quote is matched with that in mind. A number that is a digit
 * out is another number. "Survey No. 73/1" was held to be on a page that
 * prints 73/4, since a one-digit part is too short to count as a word and
 * every other word was there; and a quote ending in 73/1 was found inside
 * 73/12. So the numbers are looked for on their own, whole.
 */
function holdsItsNumbers(text: string, quote: string): boolean {
  const printed = new Set(numbersIn(text));
  return numbersIn(quote).every((number) => printed.has(number));
}

/** A quote shorter than this is matched only verbatim: "2011" is on every page of a title bundle. */
const MIN_QUOTE_CHARS = 4;
/** Below this many words, a quote must appear verbatim rather than word by word. */
const MIN_WORDS_FOR_OVERLAP = 4;
/** Share of a quote's words a page's text must hold when the quote is not verbatim (OCR drops a letter here and there). */
const PAGE_WORD_SHARE = 0.85;

/**
 * Whether a page's text holds a quote: verbatim once spacing, punctuation and
 * case are set aside, or, for a longer quote, nearly every one of its words.
 * Either way with every one of its numbers, exactly.
 *
 * That the quote is there says nothing of the value read from it: see
 * `pageStates`, which is what a reading is placed by.
 */
export function pageHolds(pageText: string, quote: string): boolean {
  const q = normalizeForPage(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  const page = normalizeForPage(pageText);
  if (!page || !holdsItsNumbers(pageText, quote)) return false;
  if (` ${page} `.includes(` ${q} `) || page.includes(q)) return true;
  const quoteWords = words(q);
  if (quoteWords.length < MIN_WORDS_FOR_OVERLAP) return false;
  const pageWords = new Set(words(page));
  const held = quoteWords.filter((w) => pageWords.has(w)).length;
  return held / quoteWords.length >= PAGE_WORD_SHARE;
}

/**
 * The page a quote is printed on, from the pages' own text: the page the
 * reading named when it holds the quote, else the first page that does.
 * Pages are 1-based; `pageTexts[0]` is page 1.
 */
export function findQuoteInPages(quote: string, pageTexts: readonly string[], hint?: number): number | undefined {
  if (hint !== undefined && hint >= 1 && hint <= pageTexts.length && pageHolds(pageTexts[hint - 1] ?? '', quote)) return hint;
  for (let i = 0; i < pageTexts.length; i += 1) {
    if (pageHolds(pageTexts[i] ?? '', quote)) return i + 1;
  }
  return undefined;
}

/** Without the zero-width joiners OCR writes inside and after a word of an Indic script, where another reader writes none. */
function unjoined(text: string): string {
  return text.replace(/[‌‍]/g, '');
}

/** A text's words for telling whether a value is among them: every script, lower-cased, no joiners, a single letter kept. */
function tokens(text: string): string[] {
  return normalizeForPage(unjoined(text)).split(' ').filter(Boolean);
}

/* ==================================================================== */
/* A value held to its own quote                                         */
/* ==================================================================== */

/** What one reader read for one thing. */
export interface Reading {
  /** One of the rules' keys (`STANDARD_FACT_KEYS`), or a key of the reader's own. */
  key: string;
  value: string;
  unit?: string | null;
  /** The value as the page prints it, where the page is not in English. */
  originalValue?: string | null;
}

/** A run of digits and what joins them, whole: "3,18,50,000", "2.25", "73/4", "31-03-2024". */
const FIGURE = /\d[\d/.,:-]*\d|\d/g;
/** A figure that is one number: digits, grouped by commas or not, with at most one decimal point. */
const PLAIN_NUMBER = /^\d[\d,]*(?:\.\d+)?$/;

/**
 * Every number written in a text, as a number: "3,18,50,000" is 31850000 and
 * "2.25" is 2.25, in whichever digits. Only a figure that is one number: the
 * 2 of "2-3-2019" and the 4 of "73/4" are parts of a date and of a survey
 * number, and a count of 2 is not found in either.
 */
function amountsIn(text: string): number[] {
  return (normalizeDigits(text.normalize('NFKC')).match(FIGURE) ?? [])
    .filter((figure) => PLAIN_NUMBER.test(figure))
    .map((figure) => Number(figure.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

/** How close two figures of one form have to be to be one figure: a whole unit for a measure or an amount, exactly for a ratio or a count. */
function sameFigure(form: string, a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) < (form === 'number' ? 0.005 : 0.5);
}

/** The parts of an identifier, as written: 73/4 is 73 and 4, KH-7741-B is KH, 7741 and B. Upper-cased, in Latin digits. */
function identifierParts(text: string): string[] {
  return normalizeDigits(text.normalize('NFKC')).toUpperCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** Each identifier a value names, where it names several: "73/4, 73/5 and 74" is three. */
function identifiersNamed(value: string): string[][] {
  return value
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map(identifierParts)
    .filter((parts) => parts.length > 0);
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a text writes an identifier, whole. 73/4 is not in "73/12", nor in
 * "173/4", nor in "73/4/5" (a part of it), nor is 9 in "9/8": the parts have
 * to stand joined as they are in the value, with nothing joined on at either
 * end.
 */
function writesIdentifier(text: string, parts: readonly string[]): boolean {
  const body = parts.map(escaped).join(String.raw`\s*[/\-.]\s*`);
  const whole = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}])(?<![\p{L}\p{M}\p{N}]\s*[/\-]\s*)${body}(?![\p{L}\p{M}\p{N}])(?!\s*[/\-]\s*[\p{L}\p{M}\p{N}])`, 'u');
  return whole.test(normalizeDigits(text.normalize('NFKC')).toUpperCase());
}

/** Stretches of a quote that start at a number and run on a few words: what it might state as an amount, an area or a width. */
function stretchesFromNumbers(quote: string): string[] {
  const text = normalizeDigits(quote.normalize('NFKC'));
  const out: string[] = [];
  for (const match of text.matchAll(FIGURE)) {
    if (!PLAIN_NUMBER.test(match[0])) continue;
    const rest = text.slice(match.index).split(/\s+/);
    for (let n = 1; n <= Math.min(6, rest.length); n += 1) out.push(rest.slice(0, n).join(' ').replace(/[\s.,;:)\]]+$/, ''));
  }
  return out;
}

/**
 * Whether the words quoted for a value state that value.
 *
 * The quote is what is looked for on the page, and the value is what is
 * filed. The two can part: measured, a quote that ends "to 31-03-2024" with
 * the value 31-01-2024 beside it, and an amount quoted as "3,18,50,000" and
 * given as 3185000. So every value that has to be exact is held to its own
 * quote, in the form its key is kept in:
 *
 * - a date: the quote states that day;
 * - an identifier: the quote writes it, whole, or one of them where the value
 *   is a list (twenty words do not hold thirteen survey numbers);
 * - an amount, an area, a width, a ratio or a count: some stretch of the
 *   quote, put in the key's own form, is the value, or every number the
 *   reader wrote for it is a number in the quote (an area whose unit is
 *   written in another script cannot be converted, and its figure can still
 *   be found).
 *
 * A name, a place, a yes or a no has nothing exact to hold, and passes.
 */
export function quoteStates(reading: Reading, quote: string): boolean {
  const form = standardKeyForm(reading.key);
  const value = String(reading.value ?? '');
  if (!exactValue(reading.key, value)) return true;
  // A date, under the rules' key for one or under a key of the reader's own.
  const day = form === 'date' ? standardFact(reading.key, value)?.value : form ? undefined : (parseIndianDate(normalizeDigits(value).trim()) ?? undefined);
  if (form === 'date' || day !== undefined) return typeof day === 'string' && datesIn(normalizeDigits(quote.normalize('NFKC'))).includes(day);
  if (form === 'identifier') {
    const named = identifiersNamed(String(standardFact(reading.key, value)?.value ?? value));
    return named.length > 0 && named.some((parts) => writesIdentifier(quote, parts));
  }
  const written = amountsIn(value);
  const quoted = amountsIn(quote);
  const everyNumber = written.length > 0 && written.every((n) => quoted.some((q) => Math.abs(q - n) < 1e-9));
  if (!form) return everyNumber;
  const wanted = standardFact(reading.key, value, reading.unit)?.value;
  if (typeof wanted !== 'number') return false;
  return everyNumber || stretchesFromNumbers(quote).some((stretch) => sameFigure(form, standardFact(reading.key, stretch)?.value, wanted));
}

/* ==================================================================== */
/* A value on a page                                                     */
/* ==================================================================== */

/**
 * Whether a page's text states a reading: it holds the quote (`pageHolds`)
 * and the value's own words.
 *
 * The quote alone is not enough. "Name of the owner: Smt. Rathnamma
 * Siddaramaiah" is held, by nearly every one of its words, on a page that
 * prints another surname, and the surname is the value. So each word of the
 * value has to be among the page's words: of the value as the page prints it
 * where the reader gave that, else of the value itself. A value that has to
 * be exact is in its quote already (`quoteStates`), and the quote's numbers
 * are looked for whole. A yes or a no has no words of its own on a page, and
 * rests on its quote.
 */
export function pageStates(pageText: string, reading: Reading, quote: string): boolean {
  if (!pageHolds(pageText, quote)) return false;
  const form = standardKeyForm(reading.key);
  if (form === 'yes_no' || exactValue(reading.key, reading.value)) return true;
  const printed = new Set(tokens(pageText));
  const among = (text: string | null | undefined) => {
    const said = tokens(text ?? '').filter((word) => [...word].length > 1);
    return said.length > 0 && said.every((word) => printed.has(word));
  };
  return among(reading.originalValue) || among(reading.value);
}

/* ==================================================================== */
/* Two readings of one thing                                             */
/* ==================================================================== */

/** Written before a name and no part of it. */
const HONORIFICS = new Set(['sri', 'shri', 'smt', 'mr', 'mrs', 'ms', 'dr', 'kum', 'kumari', 'late', 'ಶ್ರೀ', 'ಶ್ರೀಮತಿ']);

function nameTokens(text: string | null | undefined): string[] {
  return tokens(text ?? '').filter((word) => !HONORIFICS.has(word));
}

/**
 * Whether two readers, each reading the page for itself, read the same value
 * under one of the rules' keys.
 *
 * Each is put in the form the key is kept in, and the forms are compared: a
 * date as its day, an amount as its rupees, an area in square metres, an
 * identifier part by part (a list as the same set), one of a few choices as
 * the choice. Words are the same words once an honorific and the punctuation
 * are set aside, in the page's own script where both gave it, and never
 * roughly the same: one surname is not another for sharing a first name.
 */
export function sameReading(key: string, a: Reading, b: Reading): boolean {
  const known = STANDARD_FACT_KEYS[key];
  if (!known) return false;
  const [x, y] = [standardFact(key, a.value, a.unit), standardFact(key, b.value, b.unit)];
  if (!x || !y) return false;
  switch (known.form) {
    case 'date':
    case 'yes_no':
      return x.value === y.value;
    case 'rupees':
    case 'sqm':
    case 'feet':
    case 'number':
      return sameFigure(known.form, x.value, y.value);
    case 'identifier': {
      const set = (value: unknown) => identifiersNamed(String(value)).map((parts) => parts.join('/')).sort();
      const [mine, theirs] = [set(x.value), set(y.value)];
      return mine.length > 0 && mine.length === theirs.length && mine.every((id, i) => id === theirs[i]);
    }
    default: {
      if (known.choices) return x.value === y.value;
      const same = (p: string[], q: string[]) => p.length > 0 && (p.join(' ') === q.join(' ') || p.join('') === q.join(''));
      if (a.originalValue && b.originalValue && same(nameTokens(a.originalValue), nameTokens(b.originalValue))) return true;
      return same(nameTokens(String(x.value)), nameTokens(String(y.value)));
    }
  }
}

/* ==================================================================== */
/* Placing a reading's values                                            */
/* ==================================================================== */

export interface ReadingToPlace extends Reading {
  /** The words the reader quoted for the value. */
  quote: string;
  /** The 1-based page of the original document the reading says the quote is on. Where to look, nothing more. */
  hint?: number;
}

export type PlaceMethod = 'text' | 'page';

export type Placement =
  | { status: 'placed'; page: number; method: PlaceMethod }
  /** A second reader, shown the page alone and asked for the value by its name, read another value there. */
  | { status: 'refuted'; page: number }
  /** A value that has to be exact, and the words quoted for it do not state it. */
  | { status: 'unsupported' }
  /** Nothing could look: no page named, a key of the reader's own, the check failed, or the time or the budget ran out. */
  | { status: 'unchecked' };

/** What the second reader read on a page for one thing it was asked for. */
export interface PageReading {
  /** True only when the page states it. */
  found: boolean;
  /**
   * False when the reader could not make out the part of the page where it
   * would be: a faint or cut scan, or a script it cannot read. Absent means
   * it could.
   */
  legible?: boolean;
  value?: string;
  unit?: string;
  originalValue?: string;
  /** The words on the page it read the value from, copied as printed. */
  words?: string;
}

/**
 * Reads one page for the keys asked, and answers for each in order: undefined
 * for a key it gave no answer about, null for a page it could not read at
 * all. It is told the keys and nothing of what anybody else read.
 */
export type ReadPage = (page: number, keys: string[]) => Promise<(PageReading | undefined)[] | null>;

export interface PlaceReadingsInput {
  readings: ReadingToPlace[];
  /** The document's text page by page, as this server read it, when it did. */
  pageTexts?: readonly string[];
  /** The 1-based pages whose words in `pageTexts` are OCR's and not the file's own text layer. */
  ocrPages?: readonly number[];
  /** How many pages the document has, when known; a named page past it is no page. */
  pageCount?: number;
  /**
   * The 1-based pages the first reader was sent. A value is placed only on
   * one of them: a quote found on a page the reader never saw was not read
   * from it. Absent means every page went.
   */
  pagesSent?: readonly number[];
  /** The second reader. Absent, only the text is consulted. */
  readPage?: ReadPage;
  /** Pages one reading may have read by a second reader. */
  maxPages?: number;
  /** Pages read at once. */
  concurrency?: number;
}

export interface PlaceReadingsResult {
  placements: Placement[];
  /** Pages shown to the second reader. */
  pagesChecked: number;
}

export const DEFAULT_MAX_PAGES_CHECKED = 12;
const DEFAULT_CONCURRENCY = 4;

/**
 * Where each value of one reading was read from, checked and not claimed.
 *
 * See the head of this file for the three steps. The busiest pages go to the
 * second reader first, so a budget spent on a long bundle is spent where most
 * of the values are.
 */
export async function placeReadings(input: PlaceReadingsInput): Promise<PlaceReadingsResult> {
  const pageCount = input.pageCount ?? input.pageTexts?.length;
  const placements: Placement[] = input.readings.map(() => ({ status: 'unchecked' }));
  const ocr = new Set(input.ocrPages ?? []);
  const sent = input.pagesSent ? new Set(input.pagesSent) : undefined;
  const wasSent = (page: number) => !sent || sent.has(page);

  const waiting = new Map<number, number[]>();
  input.readings.forEach((reading, i) => {
    const exact = exactValue(reading.key, reading.value);
    if (exact && !quoteStates(reading, reading.quote)) {
      placements[i] = { status: 'unsupported' };
      return;
    }
    // The page's own text: on a page that was sent, and never among OCR's words for a value that has to be exact.
    const stated = (page: number) => wasSent(page) && !(exact && ocr.has(page)) && pageStates(input.pageTexts?.[page - 1] ?? '', reading, reading.quote);
    const pages = (input.pageTexts ?? []).map((_, n) => n + 1);
    const found = reading.hint !== undefined && pages.includes(reading.hint) && stated(reading.hint) ? reading.hint : pages.find(stated);
    if (found !== undefined) {
      placements[i] = { status: 'placed', page: found, method: 'text' };
      return;
    }
    // A second reader is asked by the key's own name and meaning, so only for one of the rules' keys.
    if (!STANDARD_FACT_KEYS[reading.key]) return;
    // A one-page document has no other page for the value to be on.
    const hint = reading.hint ?? (pageCount === 1 ? 1 : undefined);
    if (hint === undefined || hint < 1 || (pageCount !== undefined && hint > pageCount) || !wasSent(hint)) return;
    waiting.set(hint, [...(waiting.get(hint) ?? []), i]);
  });

  if (!input.readPage || waiting.size === 0) return { placements, pagesChecked: 0 };

  const pages = [...waiting.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .slice(0, input.maxPages ?? DEFAULT_MAX_PAGES_CHECKED);
  const read = input.readPage;

  await inBatches(pages, input.concurrency ?? DEFAULT_CONCURRENCY, async ([page, indexes]) => {
    // Each key once, however many of the first reader's values are under it.
    const keys = [...new Set(indexes.map((i) => input.readings[i]!.key))];
    let answers: (PageReading | undefined)[] | null;
    try {
      answers = await read(page, keys);
    } catch {
      answers = null;
    }
    if (!answers) return;
    for (const index of indexes) {
      const first = input.readings[index]!;
      const second = answers[keys.indexOf(first.key)];
      // No answer, or a page the reader could not make out: nobody has read it a second time.
      if (!second || second.legible === false) continue;
      // It read the page and did not find the thing there at all: the first reader's value was not read from this page.
      if (!second.found || !second.value) {
        placements[index] = { status: 'refuted', page };
        continue;
      }
      const theirs: Reading = { key: first.key, value: second.value, unit: second.unit, originalValue: second.originalValue };
      // The second reader is held to its own words as the first is: a value it cannot show is not a reading.
      if (exactValue(first.key, second.value) && !quoteStates(theirs, second.words ?? '')) continue;
      placements[index] = sameReading(first.key, first, theirs) ? { status: 'placed', page, method: 'page' } : { status: 'refuted', page };
    }
  });

  return { placements, pagesChecked: pages.length };
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/* ==================================================================== */
/* Cutting out a page                                                    */
/* ==================================================================== */

/**
 * How many pages a PDF has, read from its page tree; undefined when it cannot
 * be opened.
 *
 * The loader's own count is a scan of the raw bytes for page objects, which
 * finds none in a PDF that keeps them in compressed object streams (a merged
 * bundle often does) and then assumes one page. A check that believed that
 * would think page 2 of a hundred did not exist.
 */
export async function pdfPageCount(bytes: Buffer): Promise<number | undefined> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    return (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    return undefined;
  }
}

/** One page of a PDF as a PDF of its own; null when the file cannot be opened or has no such page. */
export async function onePagePdf(bytes: Buffer, page: number): Promise<Buffer | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (page < 1 || page > source.getPageCount()) return null;
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(source, [page - 1]);
    out.addPage(copied!);
    return Buffer.from(await out.save());
  } catch {
    return null;
  }
}

/* ==================================================================== */
/* The second reader                                                     */
/* ==================================================================== */

export const SECOND_READING_TOOL_NAME = 'record_page_values';

function secondReadingTool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: SECOND_READING_TOOL_NAME,
    description: 'Record, for every numbered item, whether this page states it, and the value as the page states it.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['values'],
      properties: {
        values: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['n', 'found', 'legible', 'value', 'unit', 'originalValue', 'words'],
            properties: {
              n: { type: 'integer', description: 'The item number, as given.' },
              found: { type: 'boolean', description: 'True only if this page states it.' },
              legible: {
                type: 'boolean',
                description: 'False when you cannot make out the part of the page where it would be, so cannot say either way.',
              },
              value: { type: ['string', 'null'], description: 'The value as this page states it. Null when not found.' },
              unit: { type: ['string', 'null'], description: 'The unit of an area or a width, in English. Null otherwise.' },
              originalValue: {
                type: ['string', 'null'],
                description: 'When the page is not in English: the value exactly as printed, in the page\'s own script. Null when it is.',
              },
              words: {
                type: ['string', 'null'],
                description: 'The words on this page that state it, at most twenty, copied exactly as printed. Null when not found.',
              },
            },
          },
        },
      },
    },
  };
}

const SecondReadingOutput = z.object({
  values: z.array(
    z.object({
      n: z.number().int(),
      found: z.boolean(),
      legible: z.boolean().nullish(),
      value: z.string().nullish(),
      unit: z.string().nullish(),
      originalValue: z.string().nullish(),
      words: z.string().nullish(),
    }),
  ),
});

/** What the second reader is shown the page as. */
export type CheckSource =
  | { kind: 'pdf'; bytes: Buffer }
  /** A photographed or scanned sheet: one page, page 1. */
  | { kind: 'image'; base64: string; mediaType: string };

export interface ModelPageReaderInput {
  provider: LlmProvider;
  model: string;
  caseId?: string;
  source: CheckSource;
  /** Each call's usage, to be priced and counted with the reading. */
  onUsage?: (usage: AgentUsage, model: string) => void;
  /** No call runs past this instant. One that would is not made, and its values stay unchecked. */
  stopAt?: number;
  /** Called when a page went unread for want of time: the stop was reached, or the call ran to its limit. */
  onCut?: () => void;
}

/**
 * The longest one page may take the second reader. It reads one page and
 * writes out a dozen values, which is slower than it sounds. At sixty
 * seconds, in the run of 5 October 2026, five dense Kannada pages came back
 * with nothing after 64 to 76 seconds in all: a reading, and then about the
 * sixty, which is what a call given up at its limit looks like. A request
 * with less time than this says so through `stopAt`.
 */
const SECOND_READING_CALL_LIMIT_MS = 150_000;
/**
 * What one second reading may write. A value comes with the words it was read
 * from, up to twenty, and a word of Kannada is several tokens where a word of
 * English is one or two. An answer cut short is no answer for any of its
 * items, so there is room for every item and for a model that thinks before
 * it answers. Only what is written is billed.
 */
const SECOND_READING_BASE_TOKENS = 1_500;
const SECOND_READING_TOKENS_A_VALUE = 400;

/**
 * The items as the second reader is shown them: numbered, each the key's name
 * and what it means, from the fixed list. Nothing of what anybody read.
 */
export function itemsPrompt(keys: readonly string[]): string {
  return [
    'Read these from the page:',
    ...keys.map((key, i) => {
      const known = STANDARD_FACT_KEYS[key];
      return `${i + 1}. ${known?.label ?? key}: ${known?.says ?? ''}${known?.choices ? `; one of: ${known.choices.join(', ')}` : ''}`;
    }),
  ].join('\n');
}

/**
 * A `ReadPage` that asks a model, one page at a time.
 *
 * The page goes as a document of one page (or the image itself), so whatever
 * the reader says is about that page and no other. It is sent the page and
 * the names of what to read, and nothing else: no value, no quote, not the
 * kind of paper. Every failure answers null, which leaves the values
 * unchecked and never refuted: a reader that could not be reached has said
 * nothing about the document.
 */
export function modelPageReader(input: ModelPageReaderInput): ReadPage {
  return async (page, keys) => {
    const left = input.stopAt === undefined ? SECOND_READING_CALL_LIMIT_MS : Math.min(SECOND_READING_CALL_LIMIT_MS, input.stopAt - Date.now());
    if (left < 1_000) {
      input.onCut?.();
      return null;
    }
    let part: LlmContentPart;
    if (input.source.kind === 'pdf') {
      const one = await onePagePdf(input.source.bytes, page);
      if (!one) return null;
      part = {
        type: 'document',
        document: { base64: one.toString('base64'), mediaType: 'application/pdf', title: `page ${page}`, wantCitations: false },
      };
    } else {
      if (page !== 1) return null;
      part = { type: 'image', image: { base64: input.source.base64, mediaType: input.source.mediaType } };
    }

    /*
     * Why a page came back with nothing, in the log. Never the page's words.
     * A call that fails leaves every value on its page unchecked, and without
     * this a run shows only that it happened.
     */
    const nothing = (why: string): null => {
      console.warn(`[second reader] page ${page}, ${keys.length} value${keys.length === 1 ? '' : 's'}: ${why}`);
      return null;
    };
    const system = await resolvePrompt(PROMPT_KEYS.documentIntelligenceSecondReading, { toolName: SECOND_READING_TOOL_NAME, forms: standardValueForms() });
    const started = Date.now();
    let result: Awaited<ReturnType<LlmProvider['complete']>>;
    try {
      result = await input.provider.complete({
        agent: 'document_intelligence',
        ...(input.caseId ? { caseId: input.caseId } : {}),
        model: input.model,
        maxTokens: SECOND_READING_BASE_TOKENS + keys.length * SECOND_READING_TOKENS_A_VALUE,
        system: [{ text: system.content, cacheBreakpoint: true }],
        tools: [secondReadingTool()],
        messages: [{ role: 'user', content: [part, { type: 'text', text: itemsPrompt(keys) }] }],
        timeoutMs: left,
      });
    } catch (e) {
      // Given up at its limit is out of time; anything else is a reader that could not be reached.
      const timedOut = Date.now() - started >= left - 500 || /timed out/i.test(e instanceof Error ? e.message : '');
      if (timedOut) input.onCut?.();
      return nothing(timedOut ? 'not answered in the time allowed' : `the call failed (${e instanceof Error ? e.name : 'error'})`);
    }
    input.onUsage?.(result.usage, input.model);

    const call = toolUseOf(result, SECOND_READING_TOOL_NAME);
    if (!call) return nothing(`no answer recorded (the reader stopped with ${result.stopReason ?? 'no reason given'})`);
    const parsed = SecondReadingOutput.safeParse(call.input);
    if (!parsed.success) return nothing(`an answer that could not be used (the reader stopped with ${result.stopReason ?? 'no reason given'})`);
    const byNumber = new Map(parsed.data.values.map((v) => [v.n, v]));
    return keys.map((_, i) => {
      const answer = byNumber.get(i + 1);
      return answer
        ? {
            found: answer.found,
            ...(answer.legible === false ? { legible: false } : {}),
            ...(answer.value ? { value: answer.value } : {}),
            ...(answer.unit ? { unit: answer.unit } : {}),
            ...(answer.originalValue ? { originalValue: answer.originalValue } : {}),
            ...(answer.words ? { words: answer.words } : {}),
          }
        : undefined;
    });
  };
}
