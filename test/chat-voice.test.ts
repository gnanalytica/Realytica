/**
 * The chat should sound like a colleague, not a form letter.
 *
 * Measured across twelve realistic questions before this: every reply opened
 * "Today on Harohalli Greenfield Township (RYT-0001)." — the project's own name
 * and reference read back to somebody looking at both in the header two inches
 * above. Under it sat a database breadcrumb pretending to be a sentence
 * ("Regulatory & Planning · Approval conditions are tracked to evidence —
 * pending"), and under THAT, a rule about how the product works, appended to
 * every answer forever: "You close the check — the model does not", "This
 * product does not log in or scrape the portal", "Scope cards are not
 * bulk-added", "Nothing is filed until you approve."
 *
 * What is pinned here is the shape, not the wording — a phrase test would fail
 * on every honest edit. Four properties: no masthead, no middot paths in
 * speech, the standing policy said once per turn rather than once per card,
 * and an action a person can take.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProjectChat, createProject, seedDemoProject, type DdProject } from '@realytica/shared';

const empty = (): DdProject =>
  createProject({ name: 'Greenfield', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-WZ');

/** Every reply worth checking, from one seeded file. */
function replies(): Array<{ q: string; text: string }> {
  return [
    'guide me',
    'what do i still need to collect?',
    'is the title clean?',
    'what is the biggest risk on this file?',
    'is there any litigation?',
    'what assets should I add?',
  ].map((q) => ({ q, text: applyProjectChat(seedDemoProject(), q).assistantTurn.text }));
}

describe('the chat voice', () => {
  it('never opens with a masthead naming the file you are looking at', () => {
    for (const { q, text } of replies()) {
      assert.doesNotMatch(text, /^Today on /i, q);
      assert.doesNotMatch(text, /\(RYT-\d+\)/, `${q}: the reference belongs in the header, not the reply`);
    }
    assert.doesNotMatch(applyProjectChat(empty(), 'guide me').assistantTurn.text, /^Today on /i);
  });

  it('does not read a database path aloud', () => {
    for (const { q, text } of replies()) {
      // A middot joins a scope to a check title in the registers, where it is
      // a breadcrumb. In a sentence it is a machine talking.
      const firstLine = text.split('\n')[0] ?? '';
      assert.doesNotMatch(firstLine, / · /, `${q}: ${firstLine}`);
    }
  });

  it('stays short enough to read at a glance', () => {
    for (const { q, text } of replies()) {
      assert.ok(text.length <= 260, `${q}: ${text.length} chars — ${text}`);
      assert.ok(text.split('\n').filter(Boolean).length <= 4, `${q}: too many lines`);
    }
  });

  it('ends on something the person can do', () => {
    for (const { q, text } of replies()) {
      assert.match(
        text,
        /approve|tick|cross|ask|drop|open|pick|start|say|which|add|name it|collect/i,
        `${q}: no action — ${text}`,
      );
    }
  });

  it('says the portal policy once per turn, not once per card', () => {
    const project = seedDemoProject();
    const result = applyProjectChat(project, 'is there any litigation?');
    const text = result.assistantTurn.text;
    const said = (text.match(/scrape/gi) ?? []).length;
    assert.equal(said, 1, `stated ${said} times: ${text}`);
    for (const card of result.proposals ?? []) {
      assert.doesNotMatch(card.rationale, /scrape|does not log in/i, 'a card repeats no standing policy');
    }
  });

  it('asks a short question when it cannot tell what was meant', () => {
    const out = applyProjectChat(seedDemoProject(), 'what is the biggest risk on this file?');
    assert.ok((out.assistantTurn.choices ?? []).length > 1, 'the options are the answer');
    assert.ok(out.assistantTurn.text.length < 40, out.assistantTurn.text);
    assert.doesNotMatch(out.assistantTurn.text, /I have not assumed|not certain enough/i);
  });
});
