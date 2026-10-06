/**
 * Scoring a reading against what the page states.
 *
 * Every field the page states comes out one of four ways:
 *
 *   correct    the reader returned the true value
 *   missed     the reader returned nothing for it
 *   invented   the reader returned a value that is not the true one
 *   contested  two readers returned different values, both are held for a
 *              person to choose between, and one of them is the true one
 *
 * and a value returned for something the page does not state at all is
 * invented too. The failures are kept apart because they cost differently.
 * A missed field is a blank a person fills in. An invented one is a wrong
 * survey number or a predecessor's document number sitting on a card looking
 * like a reading, and nothing downstream can tell. A contested one is a
 * question put to a person with the right answer in it.
 *
 * Numbers, dates and identifiers must match exactly: for those, roughly right
 * is the failure, not the pass. Case, spacing, a trailing full stop and a
 * leading Sri or Smt. are not the value and are not compared.
 *
 * It is the value that is scored, and nothing that sits beside it. A value
 * read off a Kannada page may carry the page's own words too; where the
 * answer key takes the Kannada form it lists it, and a wrong reading with
 * the right original beside it is a wrong reading.
 *
 * Beside the fields, `wordsRead` says how much of the page's own text came
 * back at all. The reader's rules know English labels, so on a Kannada page
 * the fields say nothing about how well the pixels were read; the words do.
 */

import type { Paper, Value } from './papers';

export type Outcome = 'correct' | 'missed' | 'invented' | 'contested';

export interface FieldScore {
  key: string;
  outcome: Outcome;
  /** The true value or values. Absent when the page states no such thing. */
  want?: Value | Value[];
  got?: Value;
  /** The other reader's value, where the reading holds two for a person to choose between. */
  other?: Value;
  /**
   * For a value under a key the answer key does not have: whether the key is
   * one of the rules' own. Under one of those it is a wrong value (an
   * applicant returned as `owner`); under a name the reader made up it is
   * something else the page may well state, and is not scored.
   */
  standardKey?: boolean;
}

function plain(value: Value): string {
  return String(value)
    .normalize('NFC')
    .toLowerCase()
    // OCR writes a zero-width non-joiner after a word's final consonant, where a typist writes none.
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:sri|shri|smt|kum|m\/s)\.? /, '')
    .replace(/[\s.,;:]+$/, '');
}

function same(want: Value, got: Value): boolean {
  if (typeof want === 'boolean') return got === want;
  if (typeof want === 'number') {
    const n = typeof got === 'number' ? got : Number(String(got).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && Math.abs(n - want) < 0.005;
  }
  return plain(want) === plain(got);
}

export function scoreFields(
  truth: Paper['truth'],
  facts: Array<{ key: string; value: Value; otherReading?: { value: Value } }>,
  standardKey: (key: string) => boolean = () => true,
): FieldScore[] {
  const read = new Map(facts.map((fact) => [fact.key, fact] as const));
  const scores = Object.entries(truth).map(([key, want]): FieldScore => {
    const fact = read.get(key);
    if (fact === undefined || fact.value === '') return { key, outcome: 'missed', want };
    const right = (value: Value) => (Array.isArray(want) ? want : [want]).some((wanted) => same(wanted, value));
    const other = fact.otherReading?.value;
    if (other === undefined) return { key, outcome: right(fact.value) ? 'correct' : 'invented', want, got: fact.value };
    // Two readers, two values, both held for a person to choose between. Wrong when neither is the true one.
    return { key, outcome: right(fact.value) || right(other) ? 'contested' : 'invented', want, got: fact.value, other };
  });
  for (const [key, fact] of read) {
    if (!(key in truth)) scores.push({ key, outcome: 'invented', got: fact.value, standardKey: standardKey(key) });
  }
  return scores;
}

export interface Share {
  found: number;
  of: number;
}

const KANNADA = /[\u0C80-\u0CFF]/;

/** The distinct words of a page, without the punctuation round them. One-character scraps are not words. */
function wordsOf(page: string): Set<string> {
  const words = new Set<string>();
  // OCR writes a zero-width non-joiner after a word's final consonant, where a typist writes none.
  for (const raw of page.normalize('NFC').replace(/[\u200c\u200d]/g, '').toLowerCase().split(/\s+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
    if ([...word].length >= 2) words.add(word);
  }
  return words;
}

/**
 * How many of each page's own words are in the text read from that page,
 * Latin-script and Kannada-script words counted apart. A page the reader
 * never reached has none of its words read.
 */
export function wordsRead(printed: string[], read: string[]): { latin: Share; kannada: Share } {
  const latin = { found: 0, of: 0 };
  const kannada = { found: 0, of: 0 };
  printed.forEach((page, n) => {
    const got = wordsOf(read[n] ?? '');
    for (const word of wordsOf(page)) {
      const share = KANNADA.test(word) ? kannada : latin;
      share.of += 1;
      if (got.has(word)) share.found += 1;
    }
  });
  return { latin, kannada };
}
