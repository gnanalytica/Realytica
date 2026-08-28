/**
 * "Why do we say that?" as a traversal.
 *
 * The reasoning is only worth storing if it can be got back out, and the
 * failure mode is specific: a model asked why a conclusion was reached, handed
 * an empty list, will fill the silence with a plausible rationale nobody ever
 * gave. So the interesting assertions here are about what happens when the
 * record is SILENT, and about the direction of the walk — `cites` runs from
 * reasoning to fact, and reading it the wrong way round would return things a
 * conclusion depends on rather than things that discussed it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDdGraph, serializeWhy, why } from '@realytica/shared';
import type { CopilotTurn, PropertyCase } from '@realytica/shared';
import { NOW, caseFrom, screenSeed, seedFor } from './fixtures';

function ddCase(match = 'Site No. 118'): PropertyCase {
  const seed = seedFor(match);
  const { result, identity, documents } = screenSeed(match);
  return caseFrom(identity, documents, result, { id: `why-${seed.identity.label.length}` });
}

function withTurns(c: PropertyCase, conversation: CopilotTurn[]): PropertyCase {
  return { ...c, intelligence: { runs: [], explorations: [], pathways: [], research: [], insights: [], conversation } };
}

function turn(over: Partial<CopilotTurn> & { id: string; role: 'user' | 'assistant' }): CopilotTurn {
  return { text: 'text', at: NOW, citedEvidenceIds: [], ...over };
}

describe('recalling why', () => {
  it('finds the answer that cited a fact', () => {
    const base = ddCase();
    const evidenceId = base.result?.evidence?.[0]?.id;
    assert.ok(evidenceId);
    const g = buildDdGraph(withTurns(base, [
      turn({ id: 't1', role: 'user', text: 'Is the khata clean?' }),
      turn({ id: 't2', role: 'assistant', text: 'Yes, and here is why', citedEvidenceIds: [evidenceId] }),
    ]), NOW);

    const found = why(g, evidenceId);
    assert.ok(found);
    assert.equal(found.undiscussed, false);
    assert.ok(found.steps.some(s => s.node.kind === 'answer' && s.relation === 'cited'));
  });

  it('picks up the question that preceded the answer', () => {
    const base = ddCase();
    const evidenceId = base.result?.evidence?.[0]?.id;
    assert.ok(evidenceId);
    const g = buildDdGraph(withTurns(base, [
      turn({ id: 't1', role: 'user', text: 'Is the khata clean?' }),
      turn({ id: 't2', role: 'assistant', citedEvidenceIds: [evidenceId] }),
    ]), NOW);

    const found = why(g, evidenceId, 2);
    assert.ok(found?.steps.some(s => s.node.kind === 'question'), 'the question is half the reasoning');
  });

  it('stops at the depth asked for, so one question does not return the whole chat', () => {
    const base = ddCase();
    const evidenceId = base.result?.evidence?.[0]?.id;
    assert.ok(evidenceId);
    const g = buildDdGraph(withTurns(base, [
      turn({ id: 't1', role: 'user' }),
      turn({ id: 't2', role: 'assistant', citedEvidenceIds: [evidenceId] }),
      turn({ id: 't3', role: 'user' }),
      turn({ id: 't4', role: 'assistant' }),
    ]), NOW);

    // A long conversation is one connected component: without a bound, asking
    // why about anything returns every turn ever taken.
    assert.equal(why(g, evidenceId, 1)?.steps.length, 1);
    assert.ok((why(g, evidenceId, 4)?.steps.length ?? 0) > 1);
  });

  it('SAYS the record is silent rather than returning an empty list', () => {
    // The failure this exists to prevent: a model handed nothing will fill the
    // silence with a rationale nobody gave.
    const base = ddCase();
    const evidenceId = base.result?.evidence?.[0]?.id;
    assert.ok(evidenceId);
    const found = why(buildDdGraph(base, NOW), evidenceId);
    assert.ok(found);
    assert.equal(found.undiscussed, true);
    assert.match(serializeWhy(found), /Nothing in the case record discusses this/);
    assert.match(serializeWhy(found), /rather than inventing a rationale/);
  });

  it('never returns a fact as a reason', () => {
    // `cites` runs deliberation -> fact. Walked the wrong way this would hand
    // back the documents a conclusion rests on, dressed as reasoning about it.
    const base = ddCase();
    const evidenceId = base.result?.evidence?.[0]?.id;
    assert.ok(evidenceId);
    const g = buildDdGraph(withTurns(base, [turn({ id: 't1', role: 'assistant', citedEvidenceIds: [evidenceId] })]), NOW);
    const found = why(g, evidenceId);
    assert.ok(found);
    assert.ok(found.steps.every(s => s.node.layer === 'deliberation'), 'every step is reasoning, never evidence');
  });

  it('reports an unknown node rather than an empty result', () => {
    assert.equal(why(buildDdGraph(ddCase(), NOW), 'dd-parcel-deadbeef'), undefined);
  });
});
