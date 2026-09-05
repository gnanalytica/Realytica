/**
 * What a turn cost, where the money was spent.
 *
 * Cost has been tracked per run since the telemetry module was written, and
 * surfaced only on the Observability page — an admin screen nobody is reading
 * while deciding whether to ask a follow-up.
 *
 * The constraint that shapes this is the pricing module's own invariant:
 * nothing reports a cost without reporting how much of it could be priced. An
 * unknown model prices at zero, so a bare "$0.00" beside a call that cost real
 * money reads as free rather than as unpriced. The flag travels with the
 * figure and the interface quotes one or the other, never a zero on its own.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProjectAgentTurn, createProject, type DdProject } from '@realytica/shared';

const project = (): DdProject =>
  createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');

const agent = (extra: Record<string, unknown> = {}) => ({
  text: 'Two encumbrances sit on the title.',
  proposals: [],
  navigations: [],
  citedEvidenceIds: [],
  citedNodeIds: [],
  ...extra,
});

describe('a turn carries what it cost', () => {
  it('lands on the turn when the model priced', () => {
    const p = project();
    const result = applyProjectAgentTurn(p, 'is the title clean?', agent({ spend: { usd: 0.0214, exact: true } }));
    assert.deepEqual(result.assistantTurn.spend, { usd: 0.0214, exact: true });
  });

  it('keeps the unpriced flag rather than dropping the figure', () => {
    const p = project();
    // A model with no rate on file prices at zero. The zero is not a price.
    const result = applyProjectAgentTurn(p, 'is the title clean?', agent({ spend: { usd: 0, exact: false } }));
    assert.equal(result.assistantTurn.spend?.exact, false, 'the interface must be able to say "not priced"');
  });

  it('is absent on a turn no model produced', () => {
    const p = project();
    const result = applyProjectAgentTurn(p, 'is the title clean?', agent());
    assert.equal(result.assistantTurn.spend, undefined, 'a deterministic answer is not a priced zero');
  });

  it('survives onto the stored conversation, not just the response', () => {
    const p = project();
    applyProjectAgentTurn(p, 'is the title clean?', agent({ spend: { usd: 0.031, exact: true } }));
    const stored = p.conversation.at(-1);
    assert.equal(stored?.spend?.usd, 0.031, 'scrolling back should still show what it cost');
  });
});
