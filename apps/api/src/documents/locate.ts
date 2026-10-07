/**
 * Where on the page a fact's words are.
 *
 * A fact carries its page and its quote, which is enough to trust it and not
 * enough to see it: a person told "page 4" still has to find the sentence. The
 * reader knows where every word it read sits — the text layer places them, and
 * OCR boxes them — so each quote is matched back to those words here and the
 * boxes kept on the fact. One box per line, for the quote and for the value
 * inside it.
 *
 * Matching is on the same normalised text the quote was cut from, so a quote
 * that came from this page is found on it. Where it is not — a quote clipped
 * with an ellipsis, OCR that split a word differently — the ends are tried,
 * and then the value alone. A fact that cannot be placed keeps no marks
 * rather than marks in the wrong place.
 */

import type { DocumentFact, FactMarks, MarkRect } from '@realytica/shared';
import { normaliseDocumentText } from '@realytica/shared';
import type { LayoutWord, PageLayout } from './read-text';

function fold(text: string): string {
  return normaliseDocumentText(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

interface IndexedPage {
  /** The page's words, folded and joined by single spaces. */
  text: string;
  words: LayoutWord[];
  /** Where each word starts in `text`, and how long it is there. */
  spans: Array<{ start: number; length: number }>;
}

function indexPage(words: LayoutWord[]): IndexedPage {
  let text = '';
  const kept: LayoutWord[] = [];
  const spans: IndexedPage['spans'] = [];
  for (const word of words) {
    const folded = fold(word.text).replace(/\s+/g, '');
    if (!folded) continue;
    if (text) text += ' ';
    spans.push({ start: text.length, length: folded.length });
    kept.push(word);
    text += folded;
  }
  return { text, words: kept, spans };
}

/** The part of each word that falls inside [from, to), as boxes. */
function rectsFor(page: IndexedPage, from: number, to: number): MarkRect[] {
  const rects: MarkRect[] = [];
  page.spans.forEach((span, i) => {
    const end = span.start + span.length;
    if (end <= from || span.start >= to) return;
    const word = page.words[i]!;
    // A word only partly inside — the quote began or ended mid-word — is cut
    // in proportion, which is as exact as the word's own box allows.
    const cutStart = Math.max(0, from - span.start) / span.length;
    const cutEnd = Math.min(span.length, to - span.start) / span.length;
    rects.push({ x: word.x + word.w * cutStart, y: word.y, w: word.w * (cutEnd - cutStart), h: word.h });
  });
  return lines(rects);
}

/** Boxes on the same line joined into one, so a quote reads as a highlighted line, not a row of tiles. */
function lines(rects: MarkRect[]): MarkRect[] {
  const out: MarkRect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    const sameLine =
      last
      && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.max(last.h, r.h) * 0.5
      && r.x >= last.x - 0.01;
    if (last && sameLine) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x;
      last.h = Math.max(last.y + last.h, r.y + r.h) - y;
      last.x = x;
      last.y = y;
    } else {
      out.push({ ...r });
    }
  }
  return out.map(round);
}

function round(r: MarkRect): MarkRect {
  const f = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
  return { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) };
}

/** Where the quote's words are on the page, as a range of `page.text`. */
function findQuote(page: IndexedPage, quote: string): [number, number] | null {
  const q = fold(quote.replace(/^…|…$/g, ''));
  if (q.length < 3) return null;
  const at = page.text.indexOf(q);
  if (at >= 0) return [at, at + q.length];
  // The two ends, when the middle did not survive intact.
  if (q.length >= 40) {
    const head = q.slice(0, 24);
    const tail = q.slice(-24);
    const start = page.text.indexOf(head);
    if (start >= 0) {
      const end = page.text.indexOf(tail, start + head.length);
      if (end >= 0 && end - start < q.length * 1.6) return [start, end + tail.length];
    }
  }
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "2019-03-12" as Indian documents write a date: 12-03-2019, 12.03.2019, 12th March 2019… */
function dateForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [];
  const [, y, mm, dd] = m as unknown as [string, string, string, string];
  const d = String(Number(dd));
  const mo = String(Number(mm));
  const month = MONTHS[Number(mm) - 1]!;
  const mon = month.slice(0, 3);
  const th = /1[123]$/.test(d) ? 'th' : d.endsWith('1') ? 'st' : d.endsWith('2') ? 'nd' : d.endsWith('3') ? 'rd' : 'th';
  const forms: string[] = [];
  for (const day of new Set([dd, d])) {
    for (const mth of new Set([mm, mo])) for (const sep of ['-', '/', '.']) forms.push(`${day}${sep}${mth}${sep}${y}`);
    forms.push(`${day} ${month} ${y}`, `${day} ${mon} ${y}`, `${day}-${mon}-${y}`, `${day}${th} ${month} ${y}`, `${day}${th} ${month}, ${y}`, `${day}${th} day of ${month} ${y}`);
  }
  forms.push(`${month} ${d}, ${y}`, `${mon} ${d}, ${y}`);
  return forms;
}

/** An amount in rupees as a deed writes it: 4,20,00,000 and 420,000,000. */
function rupeeForms(amount: number): string[] {
  if (!Number.isFinite(amount) || amount < 100) return [];
  const whole = String(Math.round(amount));
  const indian = whole.length > 3 ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return [indian, Math.round(amount).toLocaleString('en-US'), whole];
}

/** The value as the page might write it, longest first. */
function valueForms(fact: DocumentFact): string[] {
  const forms = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s !== 'string' && typeof s !== 'number') return;
    const f = fold(String(s));
    if (f.length >= 2) forms.add(f);
  };
  add(fact.originalValue);
  add(fact.value);
  add(fact.display);
  // "Sy. No. 118/2" is displayed with its label; the page may write the number alone.
  add(fact.display.replace(/^(?:sy\.?\s*no\.?|survey\s+no\.?)\s*/i, ''));
  if (typeof fact.value === 'string') dateForms(fact.value).forEach(add);
  if (fact.unit === 'INR') rupeeForms(Number(fact.value)).forEach(add);
  return [...forms].sort((a, b) => b.length - a.length);
}

function findValue(page: IndexedPage, fact: DocumentFact, within: [number, number] | null): [number, number] | null {
  for (const form of valueForms(fact)) {
    if (within) {
      const at = page.text.slice(within[0], within[1]).indexOf(form);
      if (at >= 0) return [within[0] + at, within[0] + at + form.length];
      continue;
    }
    const at = page.text.indexOf(form);
    if (at >= 0) return [at, at + form.length];
  }
  return null;
}

/** One fact's marks on its page, or none. */
export function locateFact(fact: DocumentFact, layout: PageLayout[] | undefined): FactMarks | undefined {
  const words = layout?.find((p) => p.page === fact.page)?.words;
  if (!words?.length) return undefined;
  const page = indexPage(words);
  const quote = findQuote(page, fact.quote);
  const value = findValue(page, fact, quote);
  if (!quote && !value) return undefined;
  const quoteRects = rectsFor(page, ...(quote ?? value!));
  if (!quoteRects.length) return undefined;
  const valueRects = value ? rectsFor(page, ...value) : [];
  return valueRects.length ? { quote: quoteRects, value: valueRects } : { quote: quoteRects };
}

/**
 * The words a fact's value was read from, or none where that cannot be told.
 *
 * Found as the marks are: the value as the page might write it, inside the
 * quote. A number the page groups oddly is not found that way ("17,8300" is
 * no way to write 178300), so a number is also looked for by its digits, and
 * a name by its words.
 */
export function valueWords(fact: DocumentFact, layout: PageLayout[] | undefined): LayoutWord[] {
  const words = layout?.find((p) => p.page === fact.page)?.words;
  if (!words?.length) return [];
  const page = indexPage(words);
  const quote = findQuote(page, fact.quote);
  const inside = (from: number, to: number) => page.words.filter((_, i) => page.spans[i]!.start < to && page.spans[i]!.start + page.spans[i]!.length > from);
  const value = findValue(page, fact, quote);
  if (value) return inside(...value);
  if (!quote) return [];
  if (typeof fact.value === 'number') {
    const digits = String(Math.round(fact.value));
    return digits.length < 3 ? [] : inside(...quote).filter((word) => word.text.replace(/\D/g, '') === digits);
  }
  // A name the page breaks or misspells is not found whole: its words are looked for one by one.
  const parts = fold(String(fact.value)).split(/[^\p{L}\p{M}\p{N}]+/u).filter((part) => part.length >= 3);
  return inside(...quote).filter((word) => parts.some((part) => fold(word.text).includes(part)));
}

/** Facts with their marks, where they could be placed. */
export function locateFacts(facts: DocumentFact[], layout: PageLayout[] | undefined): DocumentFact[] {
  if (!layout?.length) return facts;
  return facts.map((fact) => {
    const marks = locateFact(fact, layout);
    return marks ? { ...fact, marks } : fact;
  });
}
