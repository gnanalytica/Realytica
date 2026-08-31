/**
 * Ask, do not guess.
 *
 * The cockpit had two silent failures. A name that did not resolve fell
 * through to the next-step briefing, which answered a different question
 * about a different check in a confident voice. And a verb with no command
 * behind it fell through to opening the thing and reading its current state
 * back, which is indistinguishable from having done what was asked.
 *
 * These tests hold the rule that replaced both: rank what is closest, offer
 * it, let the person pick — and when there is nothing to rank, ask a question
 * whose options come from the file. The load-bearing assertion in here is the
 * last one: every option offered has to actually work when picked, or this is
 * the same failure wearing better manners.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectChat,
  candidateChoices,
  looksLikeCommand,
  rankTalkSittings,
  resolveSubject,
  seedDemoProject,
  talkSittingFromText,
  type DdProject,
} from '@realytica/shared';

function ask(project: DdProject, question: string) {
  const result = applyProjectChat(project, question);
  return {
    tools: (result.assistantTurn.toolCalls ?? []).map((t) => t.name),
    text: result.assistantTurn.text,
    choices: result.assistantTurn.choices ?? [],
    navigations: result.navigations,
  };
}

describe('asking instead of guessing', () => {
  it('offers the near match for a partial name rather than acting on it', () => {
    // "boundary" does not reach "Physical boundaries match the sanctioned
    // plan" by exact tokens, and used to reach a Regulatory check in another
    // DD via the next-step fallback.
    const out = ask(seedDemoProject(), 'mark the boundary check as in progress');
    assert.deepEqual(out.tools, ['clarify']);
    assert.equal(out.choices.length, 1);
    assert.match(out.choices[0]!.label, /Physical boundaries/);
    assert.match(out.text, /not certain enough/i);
  });

  it('offers all of them when a name fits more than one record', () => {
    const out = ask(seedDemoProject(), 'set the encumbrance check as started');
    assert.deepEqual(out.tools, ['clarify']);
    assert.ok(out.choices.length >= 2, 'two DDs carry an encumbrance check');
    assert.match(out.text, /have not changed anything/i);
  });

  it('says nothing changed, in as many words', () => {
    for (const q of [
      'mark the boundary check as in progress',
      'set the encumbrance check as started',
      'close the litigation finding',
      'start the check',
    ]) {
      const out = ask(seedDemoProject(), q);
      assert.match(
        out.text,
        /not changed|nothing has changed|not certain enough/i,
        `"${q}" must state that nothing was written`,
      );
    }
  });

  it('carries the record state on each option, so the pick is informed', () => {
    const out = ask(seedDemoProject(), 'set the encumbrance check as started');
    for (const choice of out.choices) {
      assert.ok(choice.detail, 'a list of identical titles is not a choice');
      assert.match(choice.detail!, /·/);
    }
  });

  it('asks a narrowing question when nothing is named at all', () => {
    const out = ask(seedDemoProject(), 'start the check');
    assert.deepEqual(out.tools, ['clarify']);
    assert.ok(out.choices.length > 0, 'options come from the checks still pending');
    assert.match(out.text, /Did you mean|matches that name/i);
  });

  it('offers the register rather than a dead end on a record command', () => {
    // Was: "No matching open finding. Quote the title, or ask for a briefing."
    const out = ask(seedDemoProject(), 'close the litigation finding');
    assert.deepEqual(out.tools, ['clarify']);
    assert.ok(out.choices.length > 0);
    for (const choice of out.choices) assert.match(choice.send, /^Close finding "/);
  });

  it('does not answer a register command with portal routes', () => {
    // "close the litigation finding" used to match the eCourts connector on
    // the word alone and answer with a portal route, leaving the finding open.
    const out = ask(seedDemoProject(), 'close the litigation finding');
    assert.ok(!out.tools.includes('connectors'));
  });

  it('treats "accept the risk" as the risk, not as approving a card', () => {
    const out = ask(seedDemoProject(), 'accept the flood risk');
    assert.deepEqual(out.tools, ['clarify']);
    assert.ok(out.choices.every((c) => c.send.startsWith('Accept risk "')));
  });

  it('still opens a whole register when that is what was asked', () => {
    const out = ask(seedDemoProject(), 'open evidence');
    assert.ok(!out.tools.includes('clarify'), 'a pane name is not an ambiguous record');
  });

  it('still acts without asking when the name is unambiguous', () => {
    const out = ask(seedDemoProject(), 'show me the legal scope');
    assert.deepEqual(out.tools, ['open_sitting']);
    assert.equal(out.choices.length, 0);
    assert.ok(out.navigations[0]?.checkId, 'and it still lands on the field');
  });

  it('every offered choice resolves to a real action when picked', () => {
    // The whole mechanism turns on this. An option that comes back as another
    // clarification, or as the next-step briefing, is the original failure.
    const questions = [
      'mark the boundary check as in progress',
      'set the encumbrance check as started',
      'close the litigation finding',
      'close the drainage action',
      'accept the flood risk',
      'open the zzzz check',
      'start the check',
    ];
    let offered = 0;
    for (const question of questions) {
      const out = ask(seedDemoProject(), question);
      assert.ok(out.choices.length > 0, `"${question}" offered nothing`);
      for (const choice of out.choices) {
        offered += 1;
        const picked = ask(seedDemoProject(), choice.send);
        assert.ok(picked.tools.length > 0, `picking "${choice.send}" did nothing`);
        assert.ok(
          !picked.tools.includes('clarify') && !picked.tools.includes('next_step'),
          `picking "${choice.send}" led to ${picked.tools.join(',')} instead of an action`,
        );
      }
    }
    assert.ok(offered >= 10, 'expected a meaningful number of round-trips');
  });
});

describe('subject resolution', () => {
  it('keeps a loose hit out of the confident answer', () => {
    const project = seedDemoProject();
    // Available as a candidate...
    assert.ok(rankTalkSittings(project, 'boundary').length > 0);
    // ...but never as something to act on.
    assert.equal(talkSittingFromText(project, 'boundary'), null);
  });

  it('stems a plural onto its singular for candidates', () => {
    const project = seedDemoProject();
    const ranked = rankTalkSittings(project, 'boundary');
    assert.ok(ranked.some((row) => /Physical boundaries/.test(row.sitting.label)));
    assert.ok(ranked.every((row) => !row.confident), 'a stemmed hit is a guess, not a match');
  });

  it('will not let two close readings pick themselves', () => {
    const project = seedDemoProject();
    const resolution = resolveSubject(project, 'the encumbrance check');
    assert.equal(resolution.kind, 'ambiguous');
  });

  it('separates a command from a question', () => {
    assert.equal(looksLikeCommand('set the khata check as started'), true);
    assert.equal(looksLikeCommand('close the fire finding'), true);
    assert.equal(looksLikeCommand('what does the khata check need?'), false);
    assert.equal(looksLikeCommand('show me the legal scope'), false);
  });

  it('builds a pickable message that resolves back to what was suggested', () => {
    const project = seedDemoProject();
    const ranked = rankTalkSittings(project, 'boundary');
    const choices = candidateChoices(project, ranked);
    for (const choice of choices) {
      assert.match(choice.send, /^Open "/, 'a quoted title is the one decisive form');
      assert.ok(talkSittingFromText(project, choice.send), 'and it must resolve confidently');
    }
  });
});
