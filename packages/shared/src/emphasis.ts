/**
 * Finding the quantities in a sentence.
 *
 * The product's problem is not that it says too much — it is that everything
 * it says has the same shape. Fourteen thousand words of body text where a
 * currency figure, a statutory deadline and a hedge all render identically,
 * so a reader has to actually read all of it to find the one number they
 * came for. That is what makes a screen feel like somebody's notes.
 *
 * This splits a string into ordinary text and quantities, so the renderer can
 * weight them differently. It is deliberately a *lexical* pass and not a
 * semantic one: it does not know which number matters, only which spans are
 * numbers, and a reader scanning for "how much" or "by when" finds them
 * either way. Anything cleverer would need the sentence's meaning, and a
 * heuristic that guessed wrong would emphasise the wrong figure — worse than
 * emphasising all of them.
 *
 * Lives in `shared` rather than in the web app because the same rule has to
 * apply to a printed report and to a chat reply, and two implementations of
 * "what counts as a number here" would drift.
 */

export type EmphasisSpan = { text: string; quantity: boolean };

/**
 * One quantity: an optional currency mark, digits with separators, and an
 * optional unit.
 *
 * The unit list is closed and ordered longest-first, because an alternation
 * matches left to right and `m` would otherwise swallow the start of `m²`.
 * Ordinary words are never units — matching "5 of" or "3 the" would emphasise
 * half a sentence and defeat the point.
 */
const UNITS = [
  'sq\\s?ft',
  'sqft',
  'sqm',
  'm²',
  'acres?',
  'guntas?',
  'crores?',
  'lakhs?',
  'Cr\\b',
  'L\\b',
  'km',
  'ft\\b',
  'm\\b',
  'years?',
  'yrs?\\b',
  'months?',
  'days?',
  'floors?',
  'levels?',
  'spaces?',
  'points?',
  'sources?',
  'x\\b',
  '%',
].join('|');

const QUANTITY = new RegExp(
  // ₹1.2 Cr / $400,000 / 41,500 / 16.7% / 4,000 sqm / 9 floors / 30x40
  `(?:[₹$€]\\s?)?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:${UNITS}))?`,
  'gi',
);

/**
 * Split a string into spans, marking the quantities.
 *
 * Returns a single non-quantity span for a string with no numbers in it, so a
 * caller can render the result unconditionally without a special case.
 */
export function emphasise(text: string): EmphasisSpan[] {
  if (!text) return [];
  const spans: EmphasisSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(QUANTITY)) {
    const start = match.index ?? 0;
    const value = match[0];
    if (!value) continue;
    if (start > last) spans.push({ text: text.slice(last, start), quantity: false });
    spans.push({ text: value, quantity: true });
    last = start + value.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), quantity: false });
  return spans.length > 0 ? spans : [{ text, quantity: false }];
}

/**
 * How dense a string is in quantities, 0..1.
 *
 * Used to decide whether emphasis helps. A sentence that is nine-tenths
 * numbers gets nothing from bolding all of them — emphasising everything is
 * the same as emphasising nothing — so a caller can fall back to plain text
 * above a threshold rather than producing a wall of bold.
 */
export function quantityDensity(text: string): number {
  const spans = emphasise(text);
  const total = spans.reduce((n, s) => n + s.text.length, 0);
  if (total === 0) return 0;
  const quantity = spans.filter(s => s.quantity).reduce((n, s) => n + s.text.length, 0);
  return quantity / total;
}

/**
 * Words that end in a full stop without ending a sentence.
 *
 * The abbreviation trap is what makes naive sentence-splitting produce
 * nonsense in this domain specifically: "Survey No. 42", "s.45B", "Cl. 7",
 * "Rs. 40 lakh" and "e.g." all look like sentence ends, and a property
 * screen is full of them. Matched on the token immediately before the stop,
 * case-insensitively.
 */
const ABBREVIATIONS = new Set([
  'no',
  'nos',
  's',
  'ss',
  'sec',
  'cl',
  'art',
  'ltd',
  'pvt',
  'co',
  'rs',
  'sq',
  'approx',
  'vs',
  'v',
  'e.g',
  'i.e',
  'eg',
  'ie',
  'viz',
  'etc',
  'fig',
  'mr',
  'mrs',
  'dr',
  'st',
]);

/**
 * The first sentence, and everything after it.
 *
 * The shape most of this product's prose wants: a claim you can scan, and the
 * working behind it one click away. Splitting at the source would mean
 * rewriting every string in the engine; splitting here means the same strings
 * render as a lead and a detail wherever a surface wants that, and print
 * whole where it does not.
 *
 * Two things make this harder than a `split('.')`. A decimal point and a
 * statute reference both look like sentence ends — handled by requiring
 * whitespace after the stop, which `1.75` and `s.45B` do not have. And an
 * abbreviation genuinely is a word followed by a stop and a space, which is
 * why `ABBREVIATIONS` exists: "Survey No. 42 is the parcel" would otherwise
 * split after "No.".
 *
 * A following sentence may start with a digit — "…window ending 2026.
 * 1996-2012 is not searched" is two sentences and the second one carries the
 * finding — so the start class includes digits, which is exactly why the
 * abbreviation guard has to be real rather than incidental.
 */
export function splitLead(text: string): { lead: string; rest: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.+?[a-z0-9)\]"”][.!?])\s+(?=[A-Z0-9“"(])/);
  if (!match) return { lead: trimmed, rest: '' };
  const lead = match[1];

  // A one- to three-word "sentence" is an abbreviation or a fragment, not a
  // lead worth showing on its own.
  if (lead.split(/\s+/).length < 4) return { lead: trimmed, rest: '' };

  // The token before the stop decides it. `Survey No.` ends in an
  // abbreviation and is not a sentence however many words precede it.
  const lastWord = lead.slice(0, -1).split(/[\s(]/).pop() ?? '';
  if (ABBREVIATIONS.has(lastWord.toLowerCase())) return { lead: trimmed, rest: '' };

  return { lead, rest: trimmed.slice(match[0].length).trim() };
}
