/**
 * A primary key is not something a person reads.
 *
 * A real answer, verbatim: "Legal DD: scope
 * scp_1a06d7c69ff-3aabde155fcff8-41b1e44a4fe088 ("legal") under the Approval /
 * Compliance DD (dd_1a06d7c69ff-9e8d8b87279e9-0df313e94060c). It has 5 checks,
 * all pending." Ninety-two characters of id in a sentence about five checks,
 * and the parenthetical repeated the record the four words before it had just
 * named in English.
 *
 * The renderer has understood `[id]` for a long time — it resolves the title
 * and opens the record in the work pane. It cannot guess that a bare `scp_…`
 * was meant as one, and the prompt that asks for titles rather than ids is a
 * request, not a guarantee. So the rewrite happens at the seam.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  addScopeToAssessment,
  createAssessment,
  createProject,
  linkRecordIds,
  type DdProject,
} from '@realytica/shared';

function fixture(): { project: DdProject; ddId: string; scopeId: string } {
  const project = createProject(
    { name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' },
    'RYT-C1',
  );
  const dd = createAssessment(
    project,
    { ddType: 'approval_compliance', name: 'Approval / Compliance DD', targetType: 'project', owner: 'operator' },
    'operator',
  );
  // The preset already instantiates a legal scope; take the one that exists.
  const scope = dd.scopes.find((s) => s.scopeKey === 'legal') ?? addScopeToAssessment(project, dd.id, 'legal', 'operator');
  return { project, ddId: dd.id, scopeId: scope.id };
}

describe('linkRecordIds', () => {
  it('turns a bare id into the token the renderer already resolves', () => {
    const { project, scopeId } = fixture();
    const out = linkRecordIds(project, `Legal DD: scope ${scopeId} has 5 checks, all pending.`);
    assert.equal(out, `Legal DD: scope [${scopeId}] has 5 checks, all pending.`);
    assert.ok(!/(?<!\[)scp_/.test(out), 'no bare id survives');
  });

  it('deletes a parenthesis that repeats the name beside it', () => {
    const { project, ddId } = fixture();
    const out = linkRecordIds(project, `It sits under the Approval / Compliance DD (${ddId}). Five checks pending.`);
    assert.equal(out, 'It sits under the Approval / Compliance DD. Five checks pending.');
  });

  it('keeps a parenthesised id the sentence has not named, as a link', () => {
    const { project, ddId } = fixture();
    // Nothing before the parenthesis says which assessment this is, so the id
    // is the only pointer a reader has — it becomes a chip rather than vanishing.
    const out = linkRecordIds(project, `Two assessments are open (${ddId}) and one is closed.`);
    assert.ok(out.includes(`[${ddId}]`), out);
  });

  it('leaves an id belonging to no record exactly as written', () => {
    const { project } = fixture();
    const text = 'Filed against scp_deadbeef-notreal-0000.';
    assert.equal(linkRecordIds(project, text), text, 'a link to nothing is worse than an ugly string');
  });

  it('never touches a Karnataka file’s own reference numbers', () => {
    const { project } = fixture();
    for (const text of [
      'Sy. No. 112/3 and 51/2B1 are in the schedule.',
      'Registration No: PRM/KA/RERA/1251/446/PR/030824/006958.',
      'Certificate IGR-EC-C-0004458-2021-22 covers 17-Feb-2021 to 28-Jul-2021.',
      'Khata 1234/5, assessment 56789.',
    ]) assert.equal(linkRecordIds(project, text), text, text);
  });

  it('does not double-wrap an id already written as a token', () => {
    const { project, scopeId } = fixture();
    const out = linkRecordIds(project, `Open [${scopeId}] to record it.`);
    assert.equal(out, `Open [${scopeId}] to record it.`);
  });

  it('leaves an evidence citation in its own form', () => {
    const { project } = fixture();
    const ev = addEvidence(project, { title: 'RERA certificate', kind: 'document', status: 'received' }, 'operator');
    const out = linkRecordIds(project, `Confirmed by [ev:${ev.id}] on the register.`);
    assert.equal(out, `Confirmed by [ev:${ev.id}] on the register.`, 'the evidence token has its own renderer');
  });

  it('rewrites the whole sentence that prompted this', () => {
    const { project, ddId, scopeId } = fixture();
    const out = linkRecordIds(
      project,
      `Legal DD: scope ${scopeId} ("legal") under the Approval / Compliance DD (${ddId}). It has 5 checks, all pending.`,
    );
    assert.equal(
      out,
      `Legal DD: scope [${scopeId}] ("legal") under the Approval / Compliance DD. It has 5 checks, all pending.`,
    );
  });
});
