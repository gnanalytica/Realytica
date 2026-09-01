/**
 * Consistency in the eval harness: pass^k, and what counts as a pass.
 *
 * The property under test is τ-bench's: a route that passes half the corpus
 * every time and a route that passes all of it half the time are identical
 * at pass@1, and the harness must be able to tell them apart. The other
 * properties held: the fabrication gate is untouched by consistency, and a
 * crashed attempt counts against reliability even though it never counts
 * against accuracy.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attemptPassed, rankEvalResults, runEvalComparison } from '@realytica/agents';
import type { EvalCase, EvalRunResult } from '@realytica/shared';

const USAGE = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, estimatedCostUsd: 0.001 };

function fakeCase(id: string): EvalCase {
  return {
    id,
    kind: 'document_extraction',
    title: id,
    documentText: 'x',
    expectations: [{ key: 'khata', kind: 'value', expected: '123' }],
  } as unknown as EvalCase;
}

function result(caseId: string, attempt: number, opts: { correct?: boolean; fabricated?: boolean; error?: string } = {}): EvalRunResult {
  const base = {
    evalCaseId: caseId,
    provider: 'anthropic' as const,
    model: 'm-test',
    tier: 'extraction' as const,
    usage: USAGE,
    durationMs: 5,
    capabilityGaps: [],
    attempt,
  };
  if (opts.error) return { ...base, error: opts.error };
  return {
    ...base,
    score: {
      score: opts.correct === false ? 0 : 1,
      fabrications: opts.fabricated ? 1 : 0,
      fields: [{ key: 'khata', expected: '123', actual: opts.correct === false ? '999' : '123', correct: opts.correct !== false, fabricated: opts.fabricated }],
    },
  };
}

describe('what counts as a pass', () => {
  it('requires every field correct and zero fabrications', () => {
    assert.equal(attemptPassed(result('a', 1)), true);
    assert.equal(attemptPassed(result('a', 1, { correct: false })), false);
    assert.equal(attemptPassed(result('a', 1, { fabricated: true })), false);
  });

  it('counts a crashed attempt as a reliability failure', () => {
    assert.equal(attemptPassed(result('a', 1, { error: 'socket reset' })), false);
  });
});

describe('pass^k in the ranking', () => {
  it('separates a flaky route from a consistently-partial one', () => {
    // Route F: both cases flaky (pass one attempt, fail the other) — passRate 0.5, pass^2 0.
    const flaky = [
      result('c1', 1), result('c1', 2, { correct: false }),
      result('c2', 1, { correct: false }), result('c2', 2),
    ];
    // Route S: one case always passes, one always fails — passRate 0.5, pass^2 0.5.
    const steady = [
      result('c1', 1), result('c1', 2),
      result('c2', 1, { correct: false }), result('c2', 2, { correct: false }),
    ].map((r) => ({ ...r, model: 'm-steady' }));

    const [rowF] = rankEvalResults(flaky);
    const [rowS] = rankEvalResults(steady);
    assert.equal(rowF!.passRate, 0.5);
    assert.equal(rowS!.passRate, 0.5);
    assert.equal(rowF!.passConsistently, 0, 'flaky route: no case passes every time');
    assert.equal(rowS!.passConsistently, 0.5, 'steady route: half the cases pass every time');
    assert.equal(rowF!.flakyCases, 2);
    assert.equal(rowS!.flakyCases, 0);
  });

  it('reports nothing at a single attempt — the historical shape is unchanged', () => {
    const [row] = rankEvalResults([result('c1', 1), result('c2', 1)]);
    assert.equal(row!.attempts, undefined);
    assert.equal(row!.passRate, undefined);
  });

  it('keeps the fabrication gate above consistency', () => {
    // A perfectly consistent fabricating route must still rank below an
    // inconsistent clean one. Consistency informs; fabrication gates.
    const fabricating = [result('c1', 1, { fabricated: true }), result('c1', 2, { fabricated: true })].map((r) => ({ ...r, model: 'm-fab' }));
    const cleanFlaky = [result('c1', 1), result('c1', 2, { correct: false })].map((r) => ({ ...r, model: 'm-clean' }));
    const ranking = rankEvalResults([...fabricating, ...cleanFlaky]);
    assert.equal(ranking[0]!.model, 'm-clean');
    assert.equal(ranking[1]!.model, 'm-fab');
  });
});

describe('the runner repeats attempts', () => {
  it('runs each case k times and numbers the attempts', async () => {
    let calls = 0;
    const comparison = await runEvalComparison({
      taskKind: 'document_extraction',
      routes: [{ provider: 'anthropic', model: 'm-test', tier: 'extraction' }],
      cases: [fakeCase('c1'), fakeCase('c2')],
      attempts: 3,
      now: '2026-09-01T00:00:00.000Z',
      execute: () => {
        calls += 1;
        return { answer: { khata: '123' }, usage: USAGE, durationMs: 1 };
      },
    });
    assert.equal(calls, 6);
    assert.equal(comparison.results.length, 6);
    assert.deepEqual(
      comparison.results.filter((r) => r.evalCaseId === 'c1').map((r) => r.attempt),
      [1, 2, 3],
    );
  });
});
