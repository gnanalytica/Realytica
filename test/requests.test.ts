/**
 * The request tracker.
 *
 * A gap is a fact about the file and recomputes; a request is an ACT with a
 * date, a recipient and a status. These assert the distinction holds: an
 * outstanding request suppresses its gap from being offered again, an undated
 * request is never overdue, and a settled request stops counting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOutstanding, isOverdue, orderRequests, renderRequestList, summariseRequests, unaskedGaps } from '@realytica/shared';
import type { CaseRequest, PropertyCase } from '@realytica/shared';
import { NOW, caseFrom, screenSeed } from './fixtures';

function seeded(): PropertyCase {
  const { result, identity, documents } = screenSeed('Site No. 118');
  return caseFrom(identity, documents, result, { id: 'req-1' });
}

function req(over: Partial<CaseRequest> = {}): CaseRequest {
  return {
    id: 'r1',
    caseId: 'req-1',
    domain: 'technical',
    what: 'Structural design basis report',
    why: 'Not marked received',
    recipient: 'vendor',
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const LATER = new Date(Date.parse(NOW) + 30 * 86_400_000).toISOString();
const EARLIER = new Date(Date.parse(NOW) - 30 * 86_400_000).toISOString();

describe('requests', () => {
  it('outstanding covers open and sent, and nothing else', () => {
    assert.equal(isOutstanding(req({ status: 'open' })), true);
    assert.equal(isOutstanding(req({ status: 'sent' })), true);
    assert.equal(isOutstanding(req({ status: 'answered' })), false);
    assert.equal(isOutstanding(req({ status: 'withdrawn' })), false);
  });

  it('a request with no due date is never overdue', () => {
    assert.equal(isOverdue(req(), NOW), false);
    assert.equal(isOverdue(req({ dueAt: EARLIER }), NOW), true);
    assert.equal(isOverdue(req({ dueAt: LATER }), NOW), false);
    // Settled requests cannot be late — the asking is over.
    assert.equal(isOverdue(req({ dueAt: EARLIER, status: 'answered' }), NOW), false);
  });

  it('the summary counts only what is still being waited on', () => {
    const s = summariseRequests(
      [
        req({ id: 'a', dueAt: EARLIER }),
        req({ id: 'b', status: 'sent', domain: 'legal' }),
        req({ id: 'c', status: 'answered' }),
        req({ id: 'd', status: 'withdrawn' }),
      ],
      NOW,
    );
    assert.equal(s.total, 4);
    assert.equal(s.outstanding, 2);
    assert.equal(s.overdue, 1);
    assert.equal(s.answered, 1);
    assert.equal(s.outstandingByDomain.technical, 1);
    assert.equal(s.outstandingByDomain.legal, 1);
  });

  it('overdue leads the order, settled sinks', () => {
    const ordered = orderRequests(
      [req({ id: 'answered', status: 'answered' }), req({ id: 'open' }), req({ id: 'late', dueAt: EARLIER })],
      NOW,
    );
    assert.equal(ordered[0].id, 'late');
    assert.equal(ordered[2].id, 'answered');
  });

  it('a gap already asked for is not offered again', () => {
    const c = seeded();
    const before = unaskedGaps(c, 'technical', NOW);
    assert.ok(before.length > 0, 'a fresh case owes technical documents');
    const first = before[0];
    c.requests = [req({ what: first.what, domain: 'technical' })];
    const after = unaskedGaps(c, 'technical', NOW);
    assert.ok(!after.some(g => g.what === first.what), 'nobody chases the same document twice');
    assert.equal(after.length, before.length - 1);
  });

  it('a withdrawn request re-opens the gap — we stopped asking, so it is unasked', () => {
    const c = seeded();
    const first = unaskedGaps(c, 'technical', NOW)[0];
    c.requests = [req({ what: first.what, status: 'withdrawn' })];
    assert.ok(unaskedGaps(c, 'technical', NOW).some(g => g.what === first.what));
  });

  it('the rendered list carries every outstanding item and nothing settled', () => {
    const c = seeded();
    const outstanding = req({ id: 'o', what: 'Current CFO from KSPCB' });
    const settled = req({ id: 's', what: 'Lift licences', status: 'answered' });
    const text = renderRequestList([outstanding, settled], c.identity.label, NOW);
    assert.ok(text.includes('Current CFO from KSPCB'));
    assert.ok(!text.includes('Lift licences'), 'an answered request is not still being asked for');
    assert.ok(text.includes(c.identity.label));
  });
});
