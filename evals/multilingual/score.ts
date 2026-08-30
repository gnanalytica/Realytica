/**
 * Scoring the three language rules, separately.
 *
 * One accuracy number would hide the finding. "Read the Kannada name" and
 * "did not romanise the survey number" fail in completely different ways and
 * call for completely different fixes — the first is a capability limit you
 * live with and report, the second is a correctness bug you must stop in code
 * because a plausible wrong identifier names a different instrument and
 * nothing downstream can catch it. So each rule is counted on its own.
 *
 * `romanised` is tracked apart from `wrong` for the same reason a hallucination
 * is tracked apart from a miss in the text eval: it is the failure that is
 * invisible once it is in a report.
 */

import { normalizeDigits, scriptOf } from '@realytica/shared';
import type { MultilingualExpectation, MultilingualFixture } from './fixtures';

export interface FieldOutcome {
  fixtureId: string;
  key: string;
  rule: MultilingualExpectation['rule'];
  verdict: 'correct' | 'wrong' | 'missed' | 'romanised' | 'lost-original';
  expected: string;
  got: string;
  note?: string;
}

export interface Answer {
  value?: string | null;
  originalValue?: string | null;
}

/*
 * Honorifics are not the test, and `\b` cannot remove them.
 *
 * A word boundary is defined against Latin word characters, so `\bश्री\b`
 * matches nothing in Devanagari and the honorific survived — which scored a
 * correct answer as having lost its original. Matched positionally instead:
 * these are prefixes, and every one of them is followed by the name.
 */
/*
 * Longest alternative first. A regex alternation takes the FIRST branch that
 * matches, not the longest, so `श्री` listed before `श्रीमती` matched the
 * prefix and left `मती` stuck to the name — which then compared unequal and
 * scored a correct answer as having dropped its original.
 */
const HONORIFICS = /(^|\s)(श्रीमती|श्री|shri\.?|smt\.?|sri\.?|ಶ್ರೀಮತಿ|ಶ್ರೀ|శ్రీమతి|శ్రీ)[\s.]*/giu;

/*
 * Everything after the name proper — a patronymic, a spouse, an address.
 *
 * Two alternations, not one, because `\b` is defined against Latin word
 * characters and silently matches nothing beside an Indic word. The Latin
 * relators keep their boundaries (or "bin" would fire inside "Robinson"); the
 * Indic ones cannot have them and do not need them.
 */
const RELATION_TAIL = /[,(]?\s*(\b(?:s\/o|w\/o|d\/o|son of|wife of|daughter of|bin|binti)\b|ಬಿನ್|తండ్రి|पुत्र|पत्नी)[\s\S]*$/iu;

/** A unit written after a quantity. The number is the value; the unit is context. */
const TRAILING_UNIT =
  /\s*((sq\.?|square)\s*(ft|foot|feet|yards?|yds?|m|metres?|meters?)|చదరపు\s*గజాలు|ಚದರ\s*ಅಡಿ|वर्ग\s*फुट)\.?$/iu;

function clean(s: string): string {
  return s
    .replace(RELATION_TAIL, '')
    .replace(HONORIFICS, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/-]/gu, '');
}

function sameText(a: string, b: string): boolean {
  return clean(a) === clean(b);
}

export function scoreField(
  fixture: MultilingualFixture,
  expectation: MultilingualExpectation,
  answer: Answer | undefined,
): FieldOutcome {
  const base = { fixtureId: fixture.id, key: expectation.key, rule: expectation.rule };
  const value = answer?.value?.trim() ?? '';
  const original = answer?.originalValue?.trim() ?? '';
  const expectedValue = expectation.value ?? '';

  if (expectation.value === null) {
    return value === ''
      ? { ...base, verdict: 'correct', expected: '(absent)', got: '(absent)' }
      : { ...base, verdict: 'wrong', expected: '(absent)', got: value };
  }

  if (value === '') {
    return { ...base, verdict: 'missed', expected: expectedValue, got: '(nothing)' };
  }

  /*
   * Rule 2, checked first and checked structurally.
   *
   * An identifier is wrong the moment its SCRIPT changes, whatever it
   * romanised to — so this asks whether any non-Latin letter in the expected
   * value survived, rather than comparing the strings. "214/అ" arriving as
   * "214/A" is a different plot, and it compares equal to nothing that would
   * catch it except this.
   */
  if (expectation.rule === 'identifier-verbatim') {
    const expectedHasIndic = scriptOf(expectedValue) !== 'latin';
    if (expectedHasIndic && scriptOf(value) === 'latin') {
      return {
        ...base,
        verdict: 'romanised',
        expected: expectedValue,
        got: value,
        note: 'An identifier was transliterated — it now names a different instrument.',
      };
    }
    return sameText(value, expectedValue)
      ? { ...base, verdict: 'correct', expected: expectedValue, got: value }
      : { ...base, verdict: 'wrong', expected: expectedValue, got: value };
  }

  if (expectation.rule === 'digits-converted') {
    // "300 sq. yards" is a correct reading of ౩౦౦ చదరపు గజాలు; the rule under
    // test is whether the DIGITS were converted, not whether the unit was
    // dropped.
    const value = (answer?.value ?? '').trim().replace(TRAILING_UNIT, '');
    const converted = normalizeDigits(value);
    if (converted !== value) {
      return {
        ...base,
        verdict: 'wrong',
        expected: expectedValue,
        got: value,
        note: 'Indic digits were left unconverted, so the value is not a number downstream.',
      };
    }
    return sameText(value, expectedValue)
      ? { ...base, verdict: 'correct', expected: expectedValue, got: value }
      : { ...base, verdict: 'wrong', expected: expectedValue, got: value };
  }

  if (expectation.rule === 'english-no-original') {
    // An invented original is its own failure: it asserts the page said
    // something in a script the page does not use.
    if (original !== '' && !sameText(original, value)) {
      return { ...base, verdict: 'wrong', expected: '(no original)', got: original, note: 'Invented an original for English text.' };
    }
    return sameText(value, expectedValue)
      ? { ...base, verdict: 'correct', expected: expectedValue, got: value }
      : { ...base, verdict: 'wrong', expected: expectedValue, got: value };
  }

  /*
   * Rule 1 — the reading AND the page's own text.
   *
   * The ORIGINAL is scored strictly and the READING is not, because a
   * romanisation is a reading and there is more than one valid one: ರಾಮಯ್ಯ is
   * "Ramayya" or "Ramaiah" and no registrar prefers either. Insisting on the
   * fixture's spelling would measure my transliteration taste rather than the
   * rule, and the rule is that the page's own text survives — which is
   * precisely what makes the spelling not matter.
   *
   * So a reading counts as right if it is Latin and non-empty. Getting the
   * WRONG name is caught by the original, which must match exactly.
   */
  const readingRight = scriptOf(value) === 'latin' && clean(value).length > 0;
  const originalRight = expectation.original !== null && expectation.original !== 'same'
    ? original !== '' && sameText(original, expectation.original)
    : true;

  if (readingRight && originalRight) return { ...base, verdict: 'correct', expected: expectedValue, got: value };
  if (readingRight && !originalRight) {
    return {
      ...base,
      verdict: 'lost-original',
      expected: String(expectation.original),
      got: original === '' ? '(nothing)' : original,
      note: 'The romanisation is right and the page text was dropped — nothing left to check it against.',
    };
  }
  return { ...base, verdict: 'wrong', expected: expectedValue, got: value };
}

export interface RuleTally {
  rule: MultilingualExpectation['rule'];
  total: number;
  correct: number;
  wrong: number;
  missed: number;
  romanised: number;
  lostOriginal: number;
}

export function tallyByRule(outcomes: FieldOutcome[]): RuleTally[] {
  const rules: MultilingualExpectation['rule'][] = [
    'name-keeps-both',
    'identifier-verbatim',
    'digits-converted',
    'english-no-original',
  ];
  return rules.map(rule => {
    const mine = outcomes.filter(o => o.rule === rule);
    return {
      rule,
      total: mine.length,
      correct: mine.filter(o => o.verdict === 'correct').length,
      wrong: mine.filter(o => o.verdict === 'wrong').length,
      missed: mine.filter(o => o.verdict === 'missed').length,
      romanised: mine.filter(o => o.verdict === 'romanised').length,
      lostOriginal: mine.filter(o => o.verdict === 'lost-original').length,
    };
  });
}
