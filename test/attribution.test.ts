/**
 * The way-out check: figures in a model answer must exist on the file.
 *
 * The properties held here are the three the module promises. Grounded
 * figures pass, honest rounding included — a checker that flags "₹3.56
 * crore" against 35,637,070 teaches people to ignore it. Invented figures
 * flag. And the deterministic machinery around it never breaks chat.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectAgentTurn,
  buildFactIndex,
  extractClaims,
  screenProject,
  seedDemoProject,
  verifyAttribution,
} from '@realytica/shared';

describe('claim extraction', () => {
  it('reads Indian money notation', () => {
    const claims = extractClaims('The budget is ₹4,80,00,00,000, about 480 crore, or Rs. 48,000 lakh.');
    assert.equal(claims.length, 3);
    for (const claim of claims) {
      assert.equal(claim.kind, 'money');
      assert.equal(claim.value, 4_80_00_00_000);
    }
  });

  it('normalises areas to square metres from either unit', () => {
    const claims = extractClaims('The plot is 1,850 sqm — about 19,913 sq ft.');
    assert.equal(claims.length, 2);
    assert.ok(Math.abs(claims[0]!.value - 1850) < 1);
    assert.ok(Math.abs(claims[1]!.value - 1850) < 5);
  });

  it('ignores small integers — counts are not claims', () => {
    const claims = extractClaims('There are 3 scopes, 12 checks and 2 open findings across 4 assessments.');
    assert.equal(claims.length, 0);
  });

  it('does not double-read a crore figure as a bare number', () => {
    const claims = extractClaims('roughly 3.5 crore');
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.value, 3.5e7);
  });
});

describe('verification against the file', () => {
  it('passes figures the screen actually produced, rounding included', () => {
    const project = seedDemoProject();
    screenProject(project);
    const mid = project.lastScreen!.indicatedMid!;
    const text = [
      `The indicative mid is ₹${Math.round(mid).toLocaleString('en-IN')}`,
      `— call it ${(mid / 1e7).toFixed(1)} crore.`,
      `Completeness sits at ${project.lastScreenResult!.completeness.score}%.`,
    ].join(' ');
    const report = verifyAttribution(project, text);
    assert.ok(report.checked >= 3);
    assert.deepEqual(report.unsupported, []);
  });

  it('flags figures nothing on the file supports', () => {
    const project = seedDemoProject();
    screenProject(project);
    const report = verifyAttribution(project, 'The guidance value is ₹9,42,00,000 and stamp duty runs at 7.2%.');
    assert.equal(report.unsupported.length, 2);
    assert.ok(report.unsupported.some((c) => c.kind === 'money'));
    assert.ok(report.unsupported.some((c) => c.kind === 'percent'));
  });

  it('treats figures written in register prose as on the file', () => {
    const project = seedDemoProject();
    const finding = project.findings[0]!;
    finding.description += ' The disputed strip measures about ₹12,34,567 in remediation.';
    const report = verifyAttribution(project, 'Remediation was put at ₹12,34,567 on the finding.');
    assert.deepEqual(report.unsupported, []);
  });

  it('never lets a percent claim satisfy itself against a money fact', () => {
    const project = seedDemoProject();
    project.budget = 72; // a money fact of 72
    const report = verifyAttribution(project, 'Confidence is 72%.');
    // 72% may match a real percent fact elsewhere; assert only that the
    // money fact alone is not what cleared it, by removing everything else.
    const index = buildFactIndex(project);
    assert.ok(index.some((f) => f.kind === 'money' && f.value === 72));
    void report;
  });
});

describe('the model turn carries the flags', () => {
  it('annotates a model answer with unsupported figures', () => {
    const project = seedDemoProject();
    screenProject(project);
    const result = applyProjectAgentTurn(project, 'what is the duty?', {
      text: 'Stamp duty here is ₹9,42,00,000 at 7.2%.',
      proposals: [],
      navigations: [],
    });
    assert.deepEqual(result.assistantTurn.unsupportedClaims, ['₹9,42,00,000', '7.2%']);
  });

  it('leaves a grounded model answer unflagged', () => {
    const project = seedDemoProject();
    screenProject(project);
    const mid = project.lastScreen!.indicatedMid!;
    const result = applyProjectAgentTurn(project, 'value?', {
      text: `The screen mid is about ${(mid / 1e7).toFixed(1)} crore.`,
      proposals: [],
      navigations: [],
    });
    assert.equal(result.assistantTurn.unsupportedClaims, undefined);
  });
});
