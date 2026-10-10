/**
 * Find words on a PDF page so a fact without kept marks can still be drawn
 * over the page, the way the review proof pane does when a cell has a quote
 * but no boxes.
 *
 * Whole text items are returned, not character ranges: pdf.js gives each item
 * one transform and one width, so a sub-string's rectangle can only be
 * guessed. A slightly generous highlight over the right words beats a tight
 * one over the wrong ones.
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { FactMarks, MarkRect } from '@realytica/shared';

function fold(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Boxes as fractions of the page, so MarksOverlay can lay them over any size. */
async function rectsOnPage(page: PDFPageProxy, term: string): Promise<MarkRect[]> {
  const needle = fold(term);
  if (needle.length < 2) return [];
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const rects: MarkRect[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    if (!fold(item.str).includes(needle)) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.abs(item.height) || Math.abs(t[3]) || 10;
    rects.push({
      x: t[4] / viewport.width,
      y: (t[5] - height) / viewport.height,
      w: item.width / viewport.width,
      h: height / viewport.height,
    });
  }
  return rects;
}

/**
 * Marks for a term on a page: the quote boxes are every item that holds it,
 * and `value` is the same when a tighter value term is given and found.
 */
export async function marksFromPageText(
  page: PDFPageProxy,
  quoteTerm: string,
  valueTerm?: string,
): Promise<FactMarks | null> {
  const quote = await rectsOnPage(page, quoteTerm);
  if (!quote.length && valueTerm && fold(valueTerm) !== fold(quoteTerm)) {
    const valueOnly = await rectsOnPage(page, valueTerm);
    if (!valueOnly.length) return null;
    return { quote: valueOnly, value: valueOnly };
  }
  if (!quote.length) return null;
  const value =
    valueTerm && fold(valueTerm) !== fold(quoteTerm) ? await rectsOnPage(page, valueTerm) : undefined;
  return { quote, ...(value?.length ? { value } : { value: quote }) };
}

/**
 * The string to look for on the page when a fact has no kept marks.
 *
 * Prefers the value as it appears inside the quote (what the proof line
 * yellows), then a short stretch of the quote, then the display alone.
 */
export function proofHighlightTerm(fact: {
  quote?: string;
  originalValue?: string;
  value?: string | number | boolean;
  display: string;
  marks?: FactMarks;
}): string | undefined {
  if (fact.marks?.quote.length) return undefined;
  const q = fact.quote ?? '';
  const forms = [fact.originalValue, fact.value != null ? String(fact.value) : '', fact.display].filter(
    (s): s is string => Boolean(s && String(s).trim().length > 1),
  );
  const lower = q.toLowerCase();
  const inQuote = forms
    .map((f) => ({ f: String(f).trim(), at: lower.indexOf(String(f).trim().toLowerCase()) }))
    .find((h) => h.at >= 0);
  if (inQuote) return inQuote.f;
  const flat = q.replace(/\s+/g, ' ').trim();
  if (flat.length >= 2) return flat.length <= 60 ? flat : flat.split(/\s+/).slice(0, 6).join(' ');
  return forms[0]?.trim() || undefined;
}
