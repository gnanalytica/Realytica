/**
 * Keeping the chat short, and asking one question at a time.
 *
 * A prompt rule alone will not hold this. "Be concise" degrades the moment a
 * turn is hard, which is exactly the turn where a wall of text is least
 * useful — and "ask one question at a time" fails in a specific, predictable
 * way: the model asks three, the person answers the last one, and the other
 * two are lost. So this is enforced at the seam every model turn passes
 * through, next to the attribution check, for the same reason that one lives
 * there: it is the last point that sees the exact text a person will read.
 *
 * Two rules, and they are different in kind:
 *
 * 1. **One question per turn.** Extra questions are not deleted, they are
 *    HELD — moved onto the turn as a queue so the interview continues instead
 *    of losing them. Cutting them would be worse than the wall of text; the
 *    model asked them because it needs them.
 *
 * 2. **A word budget, applied by dropping whole paragraphs from the end.**
 *    Never a mid-sentence truncation: a half-sentence reads as a bug and, on
 *    a diligence file, a clause cut in half can invert what it said. The first
 *    paragraph carries the answer, so what goes is the elaboration.
 *
 * What is deliberately NOT trimmed: a turn that is mostly a list of records
 * the person asked for. "List every open finding" should return every open
 * finding, and a budget that ate the twelfth one would be a quiet lie about
 * the register. The budget applies to prose, and a line that begins as a list
 * item is not prose.
 */

/** Prose ceiling for one turn. Lists and cards carry the volume instead. */
export const TURN_WORD_BUDGET = 110;

const QUESTION = /[^.!?\n]*\?/g;
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface TrimmedTurn {
  text: string;
  /** Questions held back, in the order the model asked them. */
  heldQuestions: string[];
  /** True when prose was dropped, so the UI can offer "say more". */
  trimmed: boolean;
}

/**
 * The questions in a turn, in order, as whole sentences.
 *
 * A rhetorical question inside a sentence ("what does that mean? it means the
 * khata is stale") counts, and that is correct: the model should not be
 * writing those either. Being asked to rephrase costs a turn; a person
 * answering the wrong one of three costs the thread.
 */
export function questionsIn(text: string): string[] {
  return (text.match(QUESTION) ?? []).map((q) => q.trim()).filter((q) => q.length > 1);
}

/**
 * Hold every question after the first.
 *
 * The kept question is the FIRST, not the most important, because the model
 * wrote them in the order it wanted them answered and second-guessing that
 * order from here would need to understand the interview better than the
 * thing conducting it.
 */
function keepOneQuestion(text: string): { text: string; held: string[] } {
  const all = questionsIn(text);
  if (all.length <= 1) return { text, held: [] };
  const [first, ...rest] = all;
  let out = text;
  for (const question of rest) out = out.replace(question, '');
  return {
    text: out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    held: [first!, ...rest].slice(1),
  };
}

/** Drop whole paragraphs from the end until the prose fits. Lists are exempt. */
function fitBudget(text: string, budget: number): { text: string; trimmed: boolean } {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return { text, trimmed: false };

  const kept: string[] = [];
  let spent = 0;
  let trimmed = false;
  for (const paragraph of paragraphs) {
    const isList = paragraph.split('\n').some((line) => LIST_LINE.test(line));
    // A list the person asked for is the answer, not elaboration around it.
    if (isList) {
      kept.push(paragraph);
      continue;
    }
    const cost = words(paragraph);
    // The first paragraph is always kept whatever it costs — it carries the
    // answer, and a turn that dropped it would say nothing at length.
    if (kept.length === 0 || spent + cost <= budget) {
      kept.push(paragraph);
      spent += cost;
      continue;
    }
    trimmed = true;
  }
  return { text: kept.join('\n\n'), trimmed };
}

/**
 * Apply both rules to one model turn.
 *
 * Idempotent, and a no-op on a turn that was already crisp — which most are.
 * The point is the tail: the turn where the model has a lot to say is the
 * turn a person is least able to read it.
 */
export function trimTurn(text: string, budget = TURN_WORD_BUDGET): TrimmedTurn {
  const raw = text.trim();
  if (!raw) return { text: raw, heldQuestions: [], trimmed: false };

  const oneQuestion = keepOneQuestion(raw);
  const fitted = fitBudget(oneQuestion.text, budget);

  // A held question that the budget then dropped would vanish twice over.
  // Put it back as the last line, because an interview that stops asking has
  // stopped being an interview.
  let out = fitted.text;
  if (oneQuestion.held.length && !questionsIn(out).length) {
    const first = questionsIn(raw)[0];
    if (first) out = `${out}\n\n${first}`.trim();
  }

  return { text: out, heldQuestions: oneQuestion.held, trimmed: fitted.trimmed };
}
