/**
 * Placing a model's quote on its page without taking the model's word for the page.
 *
 * A fact goes on file only with the page its words are printed on. Claude can
 * prove a page itself: Anthropic's citations are attached by the API to the
 * text the model drew on. No other model can, and the citations do not survive
 * a gateway such as OpenRouter even when the model behind it is Claude. Before
 * this module, every value a non-citing model read was therefore dropped from
 * the facts, however well it was read.
 *
 * So the page is checked here instead, in two ways, cheapest first:
 *
 * 1. **The page's own text.** Where this server read the document (a text
 *    layer, or OCR of a scan), the quote is looked for in each page's words.
 *    No model is involved, and a page that holds the words is the page.
 * 2. **The page alone.** Otherwise the page the reading named is cut out of
 *    the PDF as a document of one page and shown to a reader with the quotes:
 *    is each one printed here? Because only that page was sent, the page
 *    number is ours, not the model's. The reader also copies the words out as
 *    printed, and the copy has to match the quote.
 *
 * A quote that was looked for on its page and is not there is refuted, and its
 * field is dropped, exactly as a citation engine that cannot place a quote
 * drops it. A quote nothing could look for (no page named, the check failed,
 * the document had more pages to check than a reading may spend on) stays
 * unchecked: kept on the reading at a discount, never filed as a fact.
 */

import { z } from 'zod';
import type { AgentUsage } from '@realytica/shared';
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

/** A quote shorter than this is matched only verbatim: "2011" is on every page of a title bundle. */
const MIN_QUOTE_CHARS = 4;
/** Below this many words, a quote must appear verbatim rather than word by word. */
const MIN_WORDS_FOR_OVERLAP = 4;
/** Share of a quote's words a page's text must hold when the quote is not verbatim (OCR drops a letter here and there). */
const PAGE_WORD_SHARE = 0.85;

/**
 * Whether a page's text holds a quote: verbatim once spacing, punctuation and
 * case are set aside, or, for a longer quote, nearly every one of its words.
 */
export function pageHolds(pageText: string, quote: string): boolean {
  const q = normalizeForPage(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  const page = normalizeForPage(pageText);
  if (!page) return false;
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

/** What a one-page reader answered for one passage. */
export interface PageAnswer {
  present: boolean;
  /**
   * False when the reader could not make out the part of the page where the
   * words would be: a faint or cut scan, or a script it cannot read. Absent
   * means it could.
   */
  legible?: boolean;
  /** The words as printed, copied by the reader. */
  text?: string;
}

/** Share of words two readings of the same words must have in common. */
const READINGS_WORD_SHARE = 0.6;

/**
 * Whether a reader's answer confirms a quote: it says the words are on the
 * page, and the words it copied out are the quote's.
 *
 * Softer than `pageHolds`, because both sides are readings of a printed page
 * (a vowel sign read differently, a digit dropped) rather than one reading set
 * against the page's own text. A reader that says "present" and copies out
 * something else has not confirmed anything.
 */
export function answerConfirms(quote: string, answer: PageAnswer | undefined): boolean {
  if (!answer?.present || !answer.text) return false;
  const q = normalizeForPage(quote);
  const a = normalizeForPage(answer.text);
  if (q.length < MIN_QUOTE_CHARS || !a) return false;
  if (a.includes(q) || q.includes(a)) return true;
  const qw = words(q);
  const aw = new Set(words(a));
  if (qw.length === 0 || aw.size === 0) return false;
  const shared = qw.filter((w) => aw.has(w)).length;
  return shared / Math.min(qw.length, aw.size) >= READINGS_WORD_SHARE;
}

/* ==================================================================== */
/* Placing a reading's quotes                                            */
/* ==================================================================== */

export interface QuoteToPlace {
  quote: string;
  /** The 1-based page of the original document the reading says the quote is on. Where to look, nothing more. */
  hint?: number;
}

export type PlaceMethod = 'text' | 'page';

export type Placement =
  | { status: 'placed'; page: number; method: PlaceMethod }
  /** Looked for on the page the reading named, and not there. */
  | { status: 'refuted'; page: number }
  /** Nothing could look: no page named, the check failed, or the budget ran out. */
  | { status: 'unchecked' };

/**
 * Reads one page and answers for each quote, in order: undefined for a quote it
 * gave no answer about, null for a page it could not check at all.
 */
export type CheckPage = (page: number, quotes: string[]) => Promise<(PageAnswer | undefined)[] | null>;

export interface PlaceQuotesInput {
  quotes: QuoteToPlace[];
  /** The document's text page by page, as this server read it, when it did. */
  pageTexts?: readonly string[];
  /** How many pages the document has, when known; a named page past it is no page. */
  pageCount?: number;
  /** The one-page reader. Absent, only the text is consulted. */
  checkPage?: CheckPage;
  /** Pages one reading may have read by a model. */
  maxPages?: number;
  /** Pages read at once. */
  concurrency?: number;
}

export interface PlaceQuotesResult {
  placements: Placement[];
  /** Pages shown to the one-page reader. */
  pagesChecked: number;
}

export const DEFAULT_MAX_PAGES_CHECKED = 12;
const DEFAULT_CONCURRENCY = 4;

/**
 * Where each quote of one reading is printed, checked rather than claimed.
 *
 * The text first, because it is free and exact: a quote found in a page's words
 * is placed there, whichever page the reading named. What is left goes to the
 * one-page reader, grouped by the page the reading named, the busiest pages
 * first so a budget spent on a long bundle is spent where most of the facts are.
 */
export async function placeQuotes(input: PlaceQuotesInput): Promise<PlaceQuotesResult> {
  const pageCount = input.pageCount ?? input.pageTexts?.length;
  const placements: Placement[] = input.quotes.map(() => ({ status: 'unchecked' }));

  const waiting = new Map<number, number[]>();
  input.quotes.forEach((q, i) => {
    if (input.pageTexts?.length) {
      const page = findQuoteInPages(q.quote, input.pageTexts, q.hint);
      if (page !== undefined) {
        placements[i] = { status: 'placed', page, method: 'text' };
        return;
      }
    }
    // A one-page document has no other page for the words to be on.
    const hint = q.hint ?? (pageCount === 1 ? 1 : undefined);
    if (hint === undefined || hint < 1 || (pageCount !== undefined && hint > pageCount)) return;
    if (normalizeForPage(q.quote).length < MIN_QUOTE_CHARS) return;
    waiting.set(hint, [...(waiting.get(hint) ?? []), i]);
  });

  if (!input.checkPage || waiting.size === 0) return { placements, pagesChecked: 0 };

  const pages = [...waiting.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .slice(0, input.maxPages ?? DEFAULT_MAX_PAGES_CHECKED);
  const check = input.checkPage;

  await inBatches(pages, input.concurrency ?? DEFAULT_CONCURRENCY, async ([page, indexes]) => {
    let answers: (PageAnswer | undefined)[] | null;
    try {
      answers = await check(page, indexes.map((i) => input.quotes[i]!.quote));
    } catch {
      answers = null;
    }
    if (!answers) return;
    indexes.forEach((quoteIndex, n) => {
      const answer = answers![n];
      // No answer, or a page the reader could not make out, is not "absent":
      // the quote stays unchecked rather than refuted.
      if (answer === undefined || answer.legible === false) return;
      placements[quoteIndex] = answerConfirms(input.quotes[quoteIndex]!.quote, answer)
        ? { status: 'placed', page, method: 'page' }
        : { status: 'refuted', page };
    });
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
/* The one-page reader                                                   */
/* ==================================================================== */

const PAGE_CHECK_TOOL_NAME = 'record_page_check';

function pageCheckTool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: PAGE_CHECK_TOOL_NAME,
    description: 'Record, for every numbered passage, whether it is printed on this page, and its words as printed.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['passages'],
      properties: {
        passages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['n', 'present', 'legible', 'text'],
            properties: {
              n: { type: 'integer', description: 'The passage number, as given.' },
              present: { type: 'boolean', description: 'True only if these words are printed on this page.' },
              legible: {
                type: 'boolean',
                description: 'False when you cannot make out the part of the page where these words would be, so cannot say either way.',
              },
              text: {
                type: ['string', 'null'],
                description: 'The words exactly as printed on this page, in its own script. Null when not present.',
              },
            },
          },
        },
      },
    },
  };
}

const PageCheckOutput = z.object({
  passages: z.array(
    z.object({ n: z.number().int(), present: z.boolean(), legible: z.boolean().nullish(), text: z.string().nullish() }),
  ),
});

/** What the one-page reader is shown the page as. */
export type CheckSource =
  | { kind: 'pdf'; bytes: Buffer }
  /** A photographed or scanned sheet: one page, page 1. */
  | { kind: 'image'; base64: string; mediaType: string };

export interface ModelPageCheckerInput {
  provider: LlmProvider;
  model: string;
  caseId?: string;
  source: CheckSource;
  /** Each check's usage, to be priced and counted with the reading. */
  onUsage?: (usage: AgentUsage, model: string) => void;
}

/** Passages as the reader is shown them: numbered, each on its own line. */
export function passagesPrompt(quotes: string[]): string {
  return ['Passages:', ...quotes.map((q, i) => `${i + 1}. ${q.replace(/\s+/g, ' ').trim()}`)].join('\n');
}

/**
 * A `CheckPage` that asks a model, one page at a time.
 *
 * The page goes as a document of one page (or the image itself), so whatever
 * the reader says is about that page and no other. Every failure answers null,
 * which leaves the quotes unchecked rather than refuted: a reader that could
 * not be reached has said nothing about the document.
 */
export function modelPageChecker(input: ModelPageCheckerInput): CheckPage {
  return async (page, quotes) => {
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

    const system = await resolvePrompt(PROMPT_KEYS.documentIntelligencePageCheck, { toolName: PAGE_CHECK_TOOL_NAME });
    const result = await input.provider.complete({
      agent: 'document_intelligence',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      model: input.model,
      maxTokens: 400 + quotes.length * 120,
      system: [{ text: system.content, cacheBreakpoint: true }],
      tools: [pageCheckTool()],
      messages: [{ role: 'user', content: [part, { type: 'text', text: passagesPrompt(quotes) }] }],
    });
    input.onUsage?.(result.usage, input.model);

    const call = toolUseOf(result, PAGE_CHECK_TOOL_NAME);
    if (!call) return null;
    const parsed = PageCheckOutput.safeParse(call.input);
    if (!parsed.success) return null;
    const byNumber = new Map(parsed.data.passages.map((p) => [p.n, p]));
    return quotes.map((_, i) => {
      const answer = byNumber.get(i + 1);
      return answer
        ? {
            present: answer.present,
            ...(answer.legible === false ? { legible: false } : {}),
            ...(answer.text ? { text: answer.text } : {}),
          }
        : undefined;
    });
  };
}
