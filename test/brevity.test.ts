/**
 * The chat asks one thing at a time, and stays short.
 *
 * A prompt rule cannot hold this. "Be concise" degrades on exactly the hard
 * turn where a wall of text is least useful, and "one question at a time"
 * fails in a specific way: the model asks three, the person answers the last,
 * and the other two are lost. So it is enforced at the seam every model turn
 * passes through, and these are the properties that seam has to keep.
 *
 * The two rules the tests exist to protect against a well-meaning "fix":
 *
 *   Extra questions are HELD, never deleted. The model asked them because it
 *   needs them, and a shorter turn that lost the thread is not an improvement.
 *
 *   A list the person asked for is the answer, not padding. A budget that ate
 *   the twelfth open finding would be a quiet lie about the register.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TURN_WORD_BUDGET, applyProjectAgentTurn, questionsIn, seedDemoProject, trimTurn } from '@realytica/shared';

describe('one question per turn', () => {
  it('keeps the first and holds the rest', () => {
    const out = trimTurn('What extent does the title recite? And what does the khata say? Is the site fenced?');
    assert.equal(questionsIn(out.text).length, 1);
    assert.match(out.text, /What extent does the title recite\?/);
    assert.equal(out.heldQuestions.length, 2, 'the other two are held, not lost');
    assert.match(out.heldQuestions[0]!, /khata/);
  });

  it('keeps the FIRST, because that is the order the interview wanted', () => {
    // Not the longest or the most specific: second-guessing the order from
    // here would need to understand the interview better than the thing
    // conducting it.
    const out = trimTurn('Is it fenced? What exact extent, in square metres, does the registered sale deed recite?');
    assert.match(out.text, /Is it fenced\?/);
    assert.equal(out.heldQuestions.length, 1);
  });

  it('leaves a single-question turn exactly as it was', () => {
    const text = 'What extent does the title recite, in sqm?';
    const out = trimTurn(text);
    assert.equal(out.text, text);
    assert.deepEqual(out.heldQuestions, []);
    assert.equal(out.trimmed, false);
  });

  it('leaves a turn with no question alone', () => {
    const text = 'Recorded. The khata now matches the deed.';
    assert.equal(trimTurn(text).text, text);
  });

  it('is idempotent', () => {
    const once = trimTurn('One? Two? Three?');
    assert.equal(trimTurn(once.text).text, once.text);
  });
});

describe('the turn stays short', () => {
  it('drops whole paragraphs from the end, never half a sentence', () => {
    const answer = 'The DC conversion order is dated after this analysis.';
    const filler = Array.from({ length: 6 }, (_, i) => `Padding paragraph ${i} ${'word '.repeat(30)}`).join('\n\n');
    const out = trimTurn(`${answer}\n\n${filler}`);
    assert.ok(out.trimmed);
    assert.ok(out.text.startsWith(answer), 'the answer is the first paragraph and always survives');
    assert.ok(!out.text.includes('Padding paragraph 5'), 'the elaboration goes');
    // The failure this guards against: a clause cut in half can invert what
    // it said, which on a diligence file is worse than the wall of text. So
    // every paragraph that survives must appear WHOLE in the original — the
    // cut is only ever at a paragraph boundary.
    const original = `${answer}\n\n${filler}`;
    for (const paragraph of out.text.split(/\n{2,}/)) {
      assert.ok(original.includes(paragraph.trim()), 'a kept paragraph was altered rather than kept or dropped');
    }
  });

  it('keeps the first paragraph whatever it costs', () => {
    const long = `A single very long paragraph ${'word '.repeat(TURN_WORD_BUDGET * 2)}`;
    const out = trimTurn(long);
    assert.equal(out.text.trim(), long.trim(), 'a turn that dropped its only paragraph would say nothing at length');
  });

  it('never eats a list the person asked for', () => {
    // "List every open finding" must return every open finding.
    const rows = Array.from({ length: 20 }, (_, i) => `- Finding ${i}: ${'detail '.repeat(8)}`).join('\n');
    const out = trimTurn(`Here are the open findings.\n\n${rows}`);
    assert.ok(out.text.includes('Finding 19'), 'the twentieth row is still there');
  });

  it('puts a held question back if the budget swallowed the one it kept', () => {
    const filler = Array.from({ length: 5 }, (_, i) => `Context ${i} ${'word '.repeat(40)}`).join('\n\n');
    const out = trimTurn(`${filler}\n\nWhat extent does the title recite? What about the khata?`);
    assert.ok(questionsIn(out.text).length >= 1, 'an interview that stops asking has stopped being an interview');
  });
});

describe('it applies to every model turn, not just the well-behaved ones', () => {
  it('trims at the seam a person actually reads', () => {
    const project = seedDemoProject();
    const result = applyProjectAgentTurn(project, 'help me with the land DD', {
      text: 'What extent does the title recite? What does the khata say? Is the site demarcated?',
      proposals: [],
      navigations: [],
    });
    assert.equal(questionsIn(result.assistantTurn.text).length, 1);
    assert.equal(result.assistantTurn.heldQuestions?.length, 2);
    // And what was held is on the turn, so the thread can pick it up.
    assert.match(result.assistantTurn.heldQuestions![0]!, /khata/);
  });

  it('leaves a deterministic turn alone — that path is not a model', () => {
    const project = seedDemoProject();
    const before = project.conversation.length;
    applyProjectAgentTurn(project, 'x', { text: 'Recorded.', proposals: [], navigations: [] });
    assert.equal(project.conversation.length, before + 2);
    assert.equal(project.conversation[project.conversation.length - 1]!.text, 'Recorded.');
  });
});
