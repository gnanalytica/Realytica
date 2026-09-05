/**
 * A card that changes a value must show the change.
 *
 * A creation is fully described by its title — "Add Land parcel" tells you
 * what approving does, because there was nothing there before. An edit is
 * not: "Record the built-up area" does not say the file already holds 9,290
 * sqm and this would make it 8,140, and the rationale is written in prose by
 * a model, which is the wrong place to learn it. Somebody approving that card
 * is approving a number they cannot see, against one they cannot see either.
 *
 * Every "before" here is read from the project and every "after" from the
 * card's own payload — never from the card's prose. A rationale that
 * disagrees with its payload is caught by the row rather than believed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createChatProposal,
  createProject,
  proposalChanges,
  seedDemoProject,
  type DdProject,
} from '@realytica/shared';

const project = (): DdProject =>
  createProject(
    { name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru', builtUpAreaSqm: 9290 },
    'RYT-C1',
  );

const card = (kind: string, payload: Record<string, unknown>) =>
  createChatProposal(kind as never, 'A change', 'because', 'writes it', payload, 'operator');

describe('proposalChanges', () => {
  it('shows the value on the file beside the one proposed', () => {
    const p = project();
    const rows = proposalChanges(p, card('patch_project', { builtUpAreaSqm: 8140 }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, 'Built-up area');
    assert.equal(rows[0]!.from, '9,290');
    assert.equal(rows[0]!.to, '8,140');
    assert.equal(rows[0]!.unit, 'sqm');
  });

  it('says "not set" rather than inventing a before', () => {
    const p = project();
    const rows = proposalChanges(p, card('patch_project', { landAreaSqm: 4046 }));
    assert.equal(rows[0]!.from, undefined, 'an absent value is absent, not zero');
    assert.equal(rows[0]!.to, '4,046');
  });

  it('drops a field the card would not actually move', () => {
    const p = project();
    const rows = proposalChanges(p, card('patch_project', { builtUpAreaSqm: 9290, city: 'Bengaluru' }));
    assert.deepEqual(rows, [], 'proposing what is already there is not a change');
  });

  it('reads the payload, never the card’s prose', () => {
    const p = project();
    const lying = createChatProposal(
      'patch_project' as never,
      'Set built-up to 12,000 sqm',
      'The survey says 12,000 sqm.',
      'writes it',
      { builtUpAreaSqm: 8140 },
      'operator',
    );
    const rows = proposalChanges(p, lying);
    assert.equal(rows[0]!.to, '8,140', 'the row shows what would actually be written');
  });

  it('names the stage move in words, not keys', () => {
    const p = project();
    const rows = proposalChanges(p, card('change_stage', { stage: 'construction', reason: 'site started' }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, 'Stage');
    assert.ok(!/[a-z]_[a-z]/.test(rows[0]!.to), `a lifecycle key leaked: ${rows[0]!.to}`);
  });

  it('shows a check result changing', () => {
    const p = seedDemoProject();
    const check = p.assessments[0]!.scopes[0]!.checks[0]!;
    const rows = proposalChanges(p, card('record_check', { checkId: check.id, result: 'compliant', comments: 'seen' }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, 'Result');
    assert.equal(rows[0]!.to, 'Compliant');
  });

  it('returns nothing for a card that creates a record', () => {
    const p = project();
    for (const kind of ['add_asset', 'start_dd', 'add_finding', 'file_evidence', 'generate_report']) {
      assert.deepEqual(proposalChanges(p, card(kind, { name: 'Land parcel', title: 'x' })), [], kind);
    }
  });

  it('survives a card pointing at a record this project does not hold', () => {
    const p = project();
    assert.deepEqual(proposalChanges(p, card('record_check', { checkId: 'chk_nope', result: 'compliant' })), []);
    assert.deepEqual(proposalChanges(p, card('record_check_fields', { checkId: 'chk_nope', values: { a: 1 } })), []);
  });
});
