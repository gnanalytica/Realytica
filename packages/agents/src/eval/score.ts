import type { EvalCase, EvalExpectation, EvalFieldResult, EvalScore, ExtractedField } from '@valytica/shared';

/**
 * Scoring one model's answer against one case.
 *
 * Two decisions shape everything in this file.
 *
 * **A fabrication is not a lower score.** An expectation marked
 * `mustBeAbsent` is a field the document genuinely does not contain. A model
 * that answers it anyway has produced a survey number, a fee or a form code
 * that does not exist, and the reader has no way to tell it from a real one —
 * that is categorically worse than reading a real number wrong, which the next
 * document in the bundle will contradict. So `EvalScore.fabrications` counts
 * these separately, `EvalFieldResult.fabricated` marks each one, and ranking
 * treats the count as a gate rather than a weight (see `rank.ts`).
 *
 * **Refusal is not fabrication, and it is not correctness either.** A model
 * answering "not stated in this document" for an absent field has done exactly
 * the right thing and is scored correct. The same string for a field that *is*
 * in the document is simply wrong. Treating the refusal itself as a value
 * would count candour as invention and teach the harness to prefer models that
 * say nothing — which is why `isAnswered` is a shared notion applied to both
 * halves of the score, not a special case bolted onto the absence branch.
 *
 * Everything is normalised before comparison: whitespace, case, Unicode
 * dashes, Indian digit grouping and lakh/crore wording, currency symbols and
 * unit suffixes. Normalisation is deliberately about *rendering* only. It
 * never converts units and never rounds a value into range — "1,45,000" and
 * "145000" are the same answer; 145 sqm and 1,560 sq ft are not.
 */

/**
 * What a model returned, keyed by expectation key.
 *
 * Deliberately `unknown` per value rather than `string`: a real provider hands
 * back numbers, nulls, arrays of quoted strings and occasionally a whole
 * object, and coercing at the boundary would decide too early what counts as
 * an answer. `stringifyAnswer` does that in one place, where the rules are
 * visible.
 */
export type EvalAnswer = Record<string, unknown>;

/** Shown in `EvalFieldResult.expected` for an absence: the correct answer is no answer. */
export const ABSENT_EXPECTED_LABEL = '(absent)';

/** Shown in `EvalFieldResult.actual` when the model gave nothing. */
export const NO_ANSWER_LABEL = '(no answer)';

/** Longest `actual` kept in a field result. Long enough to see the mistake, short enough to render. */
const MAX_ACTUAL_LENGTH = 160;

/* ==================================================================== */
/* Normalisation                                                         */
/* ==================================================================== */

/** En dash, em dash, minus sign and non-breaking hyphen all mean "-" here. */
const DASHES = /[‐‑‒–—―−]/g;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Case-, whitespace- and dash-insensitive form used for `exact` and `contains`. */
export function normaliseText(text: string): string {
  return collapse(text.replace(DASHES, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')).toLowerCase();
}

/**
 * The same, with all whitespace removed.
 *
 * Second-chance form for `contains`, so that "Sy. No. 42 / 3" still contains
 * "42/3". Spacing around a separator is a rendering artefact of OCR, not a
 * different answer.
 */
function tighten(text: string): string {
  return normaliseText(text).replace(/\s+/g, '');
}

/**
 * A number out of whatever the model wrote around it.
 *
 * Handles both digit-grouping conventions (1,350,000 and 13,50,000 — removing
 * the separators works for either), lakh and crore wording, currency symbols
 * and codes, and unit suffixes. Returns null when there is no number at all,
 * which scores as incorrect rather than as zero: "no figure given" and "zero"
 * are different answers, and on an encumbrance count they are opposite ones.
 */
export function parseQuantity(raw: string): number | null {
  let text = normaliseText(raw);
  if (!text) return null;

  // Currency markers, then unit suffixes. Neither carries magnitude. The
  // trailing full stop of "Rs." is consumed with the token, or it is left
  // behind as a stray decimal point in front of the figure.
  text = text.replace(/[₹$€£]/g, ' ').replace(/\b(?:rs|inr|eur|usd|gbp|aed)\b\.?/g, ' ');
  text = text.replace(/\b(?:sq\.?\s*m(?:tr|etre|eter)?s?|sqm|m2|m²|sq\.?\s*ft|sqft)\b/g, ' ');

  // Indian magnitude words, applied to the number immediately before them.
  // The number must start with a digit: a pattern that allowed leading
  // punctuation would swallow whatever the currency strip left behind and
  // then fail to parse, silently dropping the multiplier.
  const scaled = text.match(/(-?\d[\d,\s]*(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|crore|crores)\b/);
  if (scaled) {
    const base = Number(scaled[1].replace(/[,\s]/g, ''));
    if (Number.isFinite(base)) return base * (scaled[2].startsWith('cr') ? 10_000_000 : 100_000);
  }

  const digits = text.replace(/(\d),(?=\d)/g, '$1');
  const match = digits.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/* ==================================================================== */
/* Did the model answer at all?                                          */
/* ==================================================================== */

/**
 * Strings that mean "I am not telling you a value".
 *
 * This list is the difference between a harness that rewards honesty and one
 * that punishes it. A model that writes "not present in this document" for a
 * conversion order number has passed the hardest test in this corpus; if that
 * string were treated as an answer it would be recorded as a fabrication, and
 * the ranking would prefer whichever model stayed silent.
 */
const ABSTENTIONS = new Set([
  '',
  '-',
  '--',
  '/',
  '.',
  'n/a',
  'na',
  'nil',
  'none',
  'null',
  'undefined',
  'unknown',
  'unspecified',
  'absent',
  'blank',
  'empty',
  '?',
]);

/** Leading phrases that mean the same thing in a sentence rather than a token. */
const ABSTENTION_PREFIX =
  /^(?:n\/a|na|nil|none|nothing|unknown|absent|not\b|does not\b|doesn't\b|do not\b|don't\b|no such\b|no value\b|no [a-z ]{0,24}(?:is|was|are)?\s*(?:stated|given|present|found|recorded|mentioned)\b|cannot\b|can't\b|unable\b|this document does not\b)/;

/**
 * The answer as a single string.
 *
 * Arrays join, because a model asked for "encumbrances found" may return a
 * list and the list is the answer. Objects prefer a `value` property — that is
 * the shape `ExtractedField` uses, and it is what a provider port will hand
 * back — and otherwise serialise, so an unexpected shape is visible in the
 * field result rather than silently scored as nothing.
 */
export function stringifyAnswer(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.map(stringifyAnswer).filter(part => part.trim() !== '').join('; ');
  if (typeof raw === 'object') {
    const value = (raw as { value?: unknown }).value;
    if (value !== undefined) return stringifyAnswer(value);
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

/** True when the model asserted something, as opposed to declining to. */
export function isAnswered(raw: unknown): boolean {
  const text = normaliseText(stringifyAnswer(raw));
  if (ABSTENTIONS.has(text)) return false;
  return !ABSTENTION_PREFIX.test(text);
}

/* ==================================================================== */
/* Matching one expectation                                              */
/* ==================================================================== */

export interface ExpectationMatch {
  /** The model asserted a value, whether or not it was the right one. */
  answered: boolean;
  correct: boolean;
  /** The model asserted a value for something that is not in the document. */
  fabricated: boolean;
  /** The answer as scored, trimmed for display. */
  actual: string;
}

function numericMatch(expected: string, actual: string, tolerance: number): boolean {
  const target = parseQuantity(expected);
  const given = parseQuantity(actual);
  if (target === null || given === null) return false;
  // A fractional tolerance around zero admits nothing but zero, which is the
  // honest reading: 2% of nothing is nothing. Stated rather than left to the
  // arithmetic, because the arithmetic would silently accept 0.00001.
  if (target === 0) return given === 0;
  return Math.abs(given - target) <= Math.abs(target) * tolerance;
}

function regexMatch(pattern: string, actual: string): boolean {
  let compiled: RegExp;
  try {
    // Case-insensitive: a reference number's case is a rendering choice, not
    // part of the reference. Whitespace is collapsed first so a line break
    // inside a quoted reference cannot fail an otherwise correct answer.
    compiled = new RegExp(pattern, 'i');
  } catch {
    // An uncompilable pattern is a corpus bug. It shows up as a uniform zero
    // across every route, which is the loudest signal available from here —
    // no route is advantaged, and the flat line is conspicuous.
    return false;
  }
  return compiled.test(collapse(actual));
}

function containsMatch(expected: string, actual: string): boolean {
  const needle = normaliseText(expected);
  if (!needle) return false;
  if (normaliseText(actual).includes(needle)) return true;
  return tighten(actual).includes(tighten(expected));
}

export function matchExpectation(expectation: EvalExpectation, raw: unknown): ExpectationMatch {
  const actualRaw = stringifyAnswer(raw);
  const answered = isAnswered(raw);
  const actual = collapse(actualRaw).slice(0, MAX_ACTUAL_LENGTH);

  if (expectation.mustBeAbsent) {
    // Nothing is compared here. The only question is whether a value was
    // asserted for a field that has none, and that question has no partial
    // credit: a *correctly formatted* invented khata number is worse than a
    // malformed one, not better.
    return { answered, correct: !answered, fabricated: answered, actual: answered ? actual : NO_ANSWER_LABEL };
  }

  if (!answered) {
    return { answered: false, correct: false, fabricated: false, actual: NO_ANSWER_LABEL };
  }

  let correct: boolean;
  switch (expectation.match) {
    case 'numeric':
      correct = numericMatch(expectation.expected, actualRaw, expectation.tolerance ?? 0);
      break;
    case 'regex':
      correct = regexMatch(expectation.expected, actualRaw);
      break;
    case 'contains':
      correct = containsMatch(expectation.expected, actualRaw);
      break;
    case 'exact':
    default:
      correct = normaliseText(expectation.expected) === normaliseText(actualRaw);
      break;
  }

  return { answered: true, correct, fabricated: false, actual };
}

/* ==================================================================== */
/* Scoring a case                                                        */
/* ==================================================================== */

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Score one answer against one case.
 *
 * Every expectation produces a field result, including the ones the model got
 * right and the ones it declined. A bare score is not actionable: the question
 * an operator actually has is "which field did the cheap model get wrong", and
 * that is answerable only from the per-field detail.
 */
export function scoreEvalCase(evalCase: EvalCase, answer: EvalAnswer): EvalScore {
  const fields: EvalFieldResult[] = [];
  let correctCount = 0;
  let fabrications = 0;

  for (const expectation of evalCase.expectations) {
    const result = matchExpectation(expectation, answer[expectation.key]);
    if (result.correct) correctCount += 1;
    if (result.fabricated) fabrications += 1;

    const field: EvalFieldResult = {
      key: expectation.key,
      expected: expectation.mustBeAbsent ? ABSENT_EXPECTED_LABEL : expectation.expected,
      actual: result.actual,
      correct: result.correct,
    };
    // Set only when true, so a UI can test for the property's presence and a
    // stored result stays readable — every field carrying `fabricated: false`
    // would bury the handful that matter.
    if (result.fabricated) field.fabricated = true;
    fields.push(field);
  }

  // A case with nothing to check cannot demonstrate anything. `runEvalComparison`
  // skips these before they reach here, with a reason; scoring one as a perfect
  // 1.0 would let an empty corpus certify every route in it.
  const score = evalCase.expectations.length === 0 ? 0 : round4(correctCount / evalCase.expectations.length);

  return { score, fabrications, fields };
}

/**
 * `ExtractedField[]` as an answer map.
 *
 * The bridge from what `document_intelligence` actually returns to what this
 * file scores, so wiring the harness to the real agent is one call rather than
 * a reshaping the caller has to get right.
 */
export function answerFromExtractedFields(fields: ExtractedField[]): EvalAnswer {
  const answer: EvalAnswer = {};
  for (const field of fields) answer[field.key] = field.value;
  return answer;
}
