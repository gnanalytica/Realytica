/**
 * Recording a check from chat.
 *
 * The authorship law is what these tests are really about. A person saying
 * "mark it compliant" is the person concluding, and it executes — chat is an
 * input method, not a second actor. A model reaching the same conclusion has
 * to raise a card. Both end at the same `recordCheckResult`, so a chat-
 * recorded result and a ticked one are the same event, raise the same
 * finding, and land on the same audit trail.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectChat,
  checkResultChoices,
  commitChatProposal,
  createChatProposal,
  parseCheckOwner,
  parseCheckResult,
  seedDemoProject,
  type DdProject,
} from '@realytica/shared';

function firstCheck(project: DdProject) {
  const assessment = project.assessments[0]!;
  const scope = assessment.scopes[0]!;
  const check = scope.checks[0]!;
  return { assessment, scope, check, sitting: { ddId: assessment.id, scopeId: scope.id, checkId: check.id } };
}

describe('the result vocabulary', () => {
  it('reads each result off the words people use', () => {
    const cases: Array<[string, string]> = [
      ['mark it compliant', 'compliant'],
      ['this one passed', 'compliant'],
      ['mark it non-compliant', 'non_compliant'],
      ['that check failed', 'non_compliant'],
      ['mark it partially compliant', 'partially_compliant'],
      ['not applicable here', 'not_applicable'],
      ['we cannot verify this', 'unable_to_verify'],
      ['no evidence on file', 'missing_evidence'],
      ['this needs a lawyer', 'requires_expert_review'],
      ['reset it to pending', 'pending'],
    ];
    for (const [text, expected] of cases) {
      assert.equal(parseCheckResult(text), expected, text);
    }
  });

  it('reads the qualified phrase before the bare one', () => {
    // Every one of these contains "compliant". Order in the phrase table is
    // the only thing stopping them all recording a pass.
    assert.equal(parseCheckResult('non-compliant'), 'non_compliant');
    assert.equal(parseCheckResult('not compliant'), 'non_compliant');
    assert.equal(parseCheckResult('partially compliant'), 'partially_compliant');
  });

  it('finds no result in a sentence that names none', () => {
    for (const text of ['mark it as started', 'set it in progress', 'mark it done soon']) {
      assert.equal(parseCheckResult(text), null, text);
    }
  });

  it('reads an owner, including "me"', () => {
    assert.equal(parseCheckOwner('assign the khata check to Priya Shah', 'operator'), 'Priya Shah');
    assert.equal(parseCheckOwner('assign the khata check to me', 'Asha'), 'Asha');
    assert.equal(parseCheckOwner('mark it compliant', 'Asha'), null);
  });
});

describe('a person recording a check through chat', () => {
  it('records the result and says so', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    const out = applyProjectChat(project, `Mark "${check.title}" as compliant`, { sitting });
    assert.deepEqual((out.assistantTurn.toolCalls ?? []).map((t) => t.name), ['record_check']);
    assert.equal(check.result, 'compliant');
    assert.match(out.assistantTurn.text, /Recorded/);
  });

  it('takes "it" to mean the check on screen', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    applyProjectChat(project, 'mark it as compliant', { sitting });
    assert.equal(check.result, 'compliant');
  });

  it('names the finding a material result raised', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    const before = project.findings.length;
    const out = applyProjectChat(project, `Mark "${check.title}" as non-compliant`, { sitting });
    assert.equal(project.findings.length, before + 1, 'a material result raises a finding');
    assert.match(out.assistantTurn.text, /raised a high finding/i, 'and the person is told it did');
  });

  it('moves the scope to in progress on its own', () => {
    const project = seedDemoProject();
    const { scope, check, sitting } = firstCheck(project);
    assert.notEqual(scope.status, 'complete');
    applyProjectChat(project, `Mark "${check.title}" as compliant`, { sitting });
    assert.ok(scope.status === 'in_progress' || scope.status === 'complete');
  });

  it('assigns an owner without concluding anything', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    const was = check.result;
    applyProjectChat(project, `Assign "${check.title}" to me`, { sitting, actor: 'Asha Menon' });
    assert.equal(check.owner, 'Asha Menon');
    assert.equal(check.result, was, 'an owner is not a conclusion');
  });

  it('offers the real results when the state word is not one', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    const out = applyProjectChat(project, `Mark "${check.title}" as started`, { sitting });
    assert.equal(check.result, 'pending', 'nothing recorded');
    assert.match(out.assistantTurn.text, /does not have a “started” state/);
    const choices = out.assistantTurn.choices ?? [];
    assert.ok(choices.some((c) => c.kind === 'owner'), 'what they usually mean is that it is theirs');
    assert.ok(choices.filter((c) => c.kind === 'result').length >= 6);
    for (const choice of choices) {
      assert.ok(choice.detail, 'each option says what it will do');
      assert.equal(choice.sitting?.checkId, check.id, 'and lands on this check');
    }
  });

  it('will not record against a check it is not sure of', () => {
    const project = seedDemoProject();
    const out = applyProjectChat(project, 'mark the boundary check as compliant');
    assert.deepEqual((out.assistantTurn.toolCalls ?? []).map((t) => t.name), ['clarify']);
    assert.match(out.assistantTurn.text, /nothing changed/i, 'an instruction that did not land must say so');
    const touched = project.assessments
      .flatMap((a) => a.scopes)
      .flatMap((s) => s.checks)
      .filter((c) => c.result !== 'pending' && c.result !== 'partially_compliant' && c.result !== 'non_compliant');
    assert.ok(touched.every((c) => c.updatedAt <= project.updatedAt));
    assert.match(out.assistantTurn.text, /^Did you mean /, 'it asks rather than acting');
  });

  it('carries the instruction onto the options, not just the check', () => {
    const project = seedDemoProject();
    const out = applyProjectChat(project, 'mark the boundary check as non-compliant');
    for (const choice of out.assistantTurn.choices ?? []) {
      assert.match(choice.send, /non-compliant/, 'picking must record, not merely open');
      assert.ok(choice.sitting?.checkId);
    }
  });

  it('ignores where the person is standing when they named another check', () => {
    // Sitting on check A, asking about a different one. The URL must never
    // redirect an instruction to the record that happens to be on screen.
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    const out = applyProjectChat(project, 'mark the boundary check as compliant', { sitting });
    assert.deepEqual((out.assistantTurn.toolCalls ?? []).map((t) => t.name), ['clarify']);
    assert.equal(check.result, 'pending', 'the check on screen was not touched');
  });
});

describe('a model proposing a check result', () => {
  it('writes only once a person commits the card', () => {
    const project = seedDemoProject();
    const { check } = firstCheck(project);
    const card = createChatProposal(
      'record_check',
      `Record ${check.title}`,
      'The khata extract on file names a different survey number.',
      'Records the check and raises a finding.',
      { checkId: check.id, result: 'non_compliant', comments: 'Survey number on the extract does not match.' },
      'model',
    );
    project.chatProposals.push(card);
    assert.equal(check.result, 'pending', 'a proposed card writes nothing');

    const before = project.findings.length;
    commitChatProposal(project, card.id, 'Asha Menon');
    assert.equal(check.result, 'non_compliant');
    assert.equal(project.findings.length, before + 1, 'and raises its finding on commit');
    assert.equal(project.audit.at(-1)?.actor, 'Asha Menon', 'recorded against the person who accepted it');
  });
});

describe('the offered result options', () => {
  it('leaves out the state the check is already in', () => {
    const rows = checkResultChoices('Some check');
    assert.ok(!rows.some((r) => /not started/i.test(r.label)), 'offering "pending" would be a button that does nothing');
  });

  it('sends a message that reads back as the result it names', () => {
    const project = seedDemoProject();
    const { check, sitting } = firstCheck(project);
    for (const choice of checkResultChoices(check.title, { sitting })) {
      if (choice.kind !== 'result') continue;
      const fresh = seedDemoProject();
      const target = firstCheck(fresh);
      const out = applyProjectChat(fresh, choice.send, { sitting: target.sitting });
      assert.deepEqual(
        (out.assistantTurn.toolCalls ?? []).map((t) => t.name),
        ['record_check'],
        `"${choice.send}" did not record`,
      );
      assert.notEqual(target.check.result, 'pending');
    }
  });
});
