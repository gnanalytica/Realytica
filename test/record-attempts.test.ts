/**
 * Recording a record fetch that did not work.
 *
 * `registerSearches` holds the successes — what a register answered, and
 * when. That is the right shape for the staleness watch and the wrong shape
 * for a reader deciding what to do next, because it leaves a failure with no
 * trace: the card said "the vendor refused" in local state and a reload
 * erased it. These assert the two properties that make the attempt log worth
 * keeping — a later attempt supersedes an earlier one for the same record
 * rather than piling up, and the provider's own reason survives.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RecordFetchAttempt } from '@realytica/shared';

/** The route's own rule, extracted so it can be asserted without a server. */
function noteAttempt(existing: RecordFetchAttempt[], attempt: RecordFetchAttempt): RecordFetchAttempt[] {
  return [...existing.filter(a => a.kind !== attempt.kind), attempt];
}

const refused: RecordFetchAttempt = {
  kind: 'encumbrance_certificate',
  attemptedAt: '2026-08-20T10:00:00.000Z',
  by: 'kaveri',
  outcome: 'gap',
  reason: 'refused',
  leavesUnknown: 'Whether anything is registered against the parcel.',
  manualRoute: 'Apply at the Sub-Registrar office.',
};

describe('the record fetch attempt log', () => {
  it('keeps one attempt per record kind — the question is what happened last time', () => {
    const later: RecordFetchAttempt = { ...refused, attemptedAt: '2026-08-21T10:00:00.000Z', reason: 'unreachable' };
    const log = noteAttempt(noteAttempt([], refused), later);
    assert.equal(log.length, 1);
    assert.equal(log[0].reason, 'unreachable');
  });

  it('does not disturb a different record kind', () => {
    const other: RecordFetchAttempt = { ...refused, kind: 'khata_extract' };
    const log = noteAttempt(noteAttempt([], refused), other);
    assert.equal(log.length, 2);
    assert.deepEqual(log.map(a => a.kind).sort(), ['encumbrance_certificate', 'khata_extract']);
  });

  /*
   * The five reasons are not interchangeable. "No vendor is configured" is
   * ours to fix and "the vendor refused" is not, so collapsing them into a
   * single failed flag would remove the only thing that tells a reader which
   * of those two situations they are in.
   */
  it('carries the provider\'s own reason rather than a generic failure', () => {
    const log = noteAttempt([], refused);
    assert.equal(log[0].outcome, 'gap');
    assert.equal(log[0].reason, 'refused');
    assert.ok(log[0].manualRoute, 'a gap always states how to get it by hand');
  });

  it('records a success without a reason', () => {
    const ok: RecordFetchAttempt = { kind: 'khata_extract', attemptedAt: refused.attemptedAt, by: 'bhoomi', outcome: 'retrieved' };
    const log = noteAttempt([], ok);
    assert.equal(log[0].outcome, 'retrieved');
    assert.equal(log[0].reason, undefined);
  });
});
