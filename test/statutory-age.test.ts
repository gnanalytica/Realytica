/**
 * How old a statutory figure is, on the line where the figure is.
 *
 * The staleness engine has always known this. It could only be asked through
 * `buildStaleness`, which needs a `PropertyCase` — and the surface people
 * actually use holds a `DdProject`, so no screen ever asked. The result was a
 * pack whose every figure was years past its own "serious" threshold, with
 * nothing anywhere saying so, under a provenance line that read identically on
 * the day the figure was written.
 *
 * Two exported helpers close that, and the property worth pinning is not their
 * arithmetic but their agreement: the number beside a figure and the report's
 * verdict on the same figure come from one place, so they cannot drift.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KARNATAKA_PACK, packStaleness, statutoryAge } from '@realytica/shared';

/** Thresholds the staleness module documents: 548 days warn, 1095 serious. */
const NOW = '2026-09-03T00:00:00.000Z';
const daysBefore = (days: number): string => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

describe('statutoryAge', () => {
  it('says nothing about a figure that is still current', () => {
    assert.equal(statutoryAge(daysBefore(30), NOW).severity, null);
    assert.equal(statutoryAge(daysBefore(547), NOW).severity, null);
  });

  it('warns at the threshold the module documents, and escalates at the second', () => {
    assert.equal(statutoryAge(daysBefore(548), NOW).severity, 'warning');
    assert.equal(statutoryAge(daysBefore(1094), NOW).severity, 'warning');
    assert.equal(statutoryAge(daysBefore(1095), NOW).severity, 'serious');
  });

  it('counts the days rather than approximating them', () => {
    assert.equal(statutoryAge(daysBefore(400), NOW).ageDays, 400);
  });

  it('does not throw on a date it cannot parse', () => {
    // A pack edited by hand is the likeliest source of one, and a provenance
    // line is the worst place in the product to throw.
    const { severity } = statutoryAge('not a date', NOW);
    assert.equal(severity, null);
  });
});

describe('packStaleness', () => {
  it('reports every statutory figure the pack carries, oldest first', () => {
    const rules = packStaleness(KARNATAKA_PACK, NOW);
    assert.ok(rules.length >= 5, `expected every rule, got ${rules.length}`);
    for (let i = 1; i < rules.length; i += 1) {
      assert.ok(rules[i - 1].ageDays >= rules[i].ageDays, 'must be sorted oldest first');
    }
  });

  it('names the source alongside the age, because the age alone is not actionable', () => {
    for (const rule of packStaleness(KARNATAKA_PACK, NOW)) {
      assert.ok(rule.source.length > 0, `${rule.label} must name what refreshes it`);
      assert.ok(rule.label.length > 0);
    }
  });

  it('finds the Karnataka pack past its own serious threshold today', () => {
    // Not a synthetic date: this is the shipped pack, and it is the finding
    // the audit raised. If a refresh ever lands, this test is the thing that
    // notices — change it then, deliberately.
    const rules = packStaleness(KARNATAKA_PACK, NOW);
    const serious = rules.filter((r) => r.severity === 'serious');
    assert.ok(
      serious.length > 0,
      'the shipped pack is carried from 2022–2023 dates; if this now passes, the pack was refreshed and this expectation should move with it',
    );
  });
});
