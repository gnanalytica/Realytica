/**
 * The durable run ledger, and calibration arithmetic.
 *
 * The ledger's load-bearing property: interrupted is an inference, never a
 * stored state — a crashed process cannot record that it crashed, so a
 * `running` record gone quiet IS the crash record. Calibration's: raw
 * agreement flatters a judge on imbalanced labels, and a single-class label
 * set reports as unmeasurable rather than as agreement.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RUN_LEDGER_LIMIT, describeRun, runState, upsertRun, type DurableRun } from '@realytica/shared';
import { calibrate, parseCalibrationLine } from '@realytica/agents';

function run(overrides: Partial<DurableRun> = {}): DurableRun {
  return {
    id: 'run_1',
    projectId: 'prj_1',
    kind: 'chat_model',
    status: 'running',
    startedAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    steps: [],
    ...overrides,
  };
}

describe('run state is derived, not stored', () => {
  it('believes a fresh running record', () => {
    assert.equal(runState(run(), '2026-09-01T10:02:00.000Z'), 'running');
  });

  it('reads a stale running record as interrupted', () => {
    assert.equal(runState(run(), '2026-09-01T10:06:00.000Z'), 'interrupted');
  });

  it('never second-guesses a finished or failed record', () => {
    assert.equal(runState(run({ status: 'finished' }), '2026-09-02T10:00:00.000Z'), 'finished');
    assert.equal(runState(run({ status: 'failed' }), '2026-09-02T10:00:00.000Z'), 'failed');
  });

  it('says what to do about an interruption, in the line a person reads', () => {
    const line = describeRun(
      run({ steps: [{ at: '2026-09-01T10:00:01.000Z', kind: 'tool', label: 'search_registers' }] }),
      '2026-09-01T10:30:00.000Z',
    );
    assert.match(line, /interrupted after 1 step/);
    assert.match(line, /re-issue the request/i);
  });
});

describe('the ledger stays bounded and newest-first', () => {
  it('caps at the limit, evicting the oldest', () => {
    let ledger: DurableRun[] = [];
    for (let i = 0; i < RUN_LEDGER_LIMIT + 5; i += 1) {
      ledger = upsertRun(ledger, run({ id: `run_${i}` }));
    }
    assert.equal(ledger.length, RUN_LEDGER_LIMIT);
    assert.equal(ledger[0]!.id, `run_${RUN_LEDGER_LIMIT + 4}`);
    assert.ok(!ledger.some((row) => row.id === 'run_0'), 'the oldest fell off');
  });

  it('updates a run in place rather than duplicating it', () => {
    let ledger = upsertRun([], run());
    ledger = upsertRun(ledger, run({ status: 'finished', outcome: 'done' }));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]!.status, 'finished');
  });
});

describe('judge calibration', () => {
  it('computes agreement, kappa and the dangerous direction', () => {
    const report = calibrate([
      { id: 'a', human: 'pass', judge: 'pass' },
      { id: 'b', human: 'pass', judge: 'pass' },
      { id: 'c', human: 'fail', judge: 'fail' },
      { id: 'd', human: 'fail', judge: 'pass' },
    ]);
    assert.equal(report.records, 4);
    assert.equal(report.agreement, 0.75);
    assert.ok(report.kappa !== null && report.kappa > 0 && report.kappa < 1);
    assert.equal(report.falsePasses, 1);
    assert.equal(report.disagreements.length, 1);
    assert.ok(report.warnings.some((w) => /false pass/i.test(w)), 'the judge clearing a human fail is called out');
  });

  it('refuses to flatter a single-class label set', () => {
    const report = calibrate([
      { id: 'a', human: 'pass', judge: 'pass' },
      { id: 'b', human: 'pass', judge: 'pass' },
    ]);
    assert.equal(report.kappa, null, 'kappa is undefined when nobody ever failed anything');
    assert.ok(report.warnings.some((w) => /every human verdict/i.test(w)));
  });

  it('parses labels strictly and names the line that is wrong', () => {
    assert.deepEqual(parseCalibrationLine('{"id":"x","human":"pass","judge":"fail"}', 1), {
      id: 'x',
      human: 'pass',
      judge: 'fail',
      note: undefined,
    });
    const bad = parseCalibrationLine('{"id":"x","human":"maybe","judge":"pass"}', 7);
    assert.ok('error' in bad && /line 7/.test(bad.error));
  });
});
