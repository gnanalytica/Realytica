/**
 * Staleness, and the distinction it exists to hold: "this is old" and "this
 * is wrong" are different claims, and only the first is supportable from a
 * date.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_DATA, buildStaleness, siteContextQuery } from '@valytica/shared';
import type { CaseDocument, PropertyCase } from '@valytica/shared';
import { NOW, caseFrom, documentsFor, screenSeed, seedFor, preciseSiteContext } from './fixtures';

function report(caseData: PropertyCase) {
  return buildStaleness(caseData, REFERENCE_DATA, NOW);
}

function freshCase(uploadedAt = NOW, screenedAt = NOW): PropertyCase {
  const seed = seedFor('Whitefield');
  const documents = documentsFor(seed.identity, seed.identity.label, 'test-case', uploadedAt);
  const { result } = screenSeed('Whitefield', { documents, now: screenedAt });
  return caseFrom(seed.identity, documents, result);
}

describe('staleness', () => {
  test('the pack\'s own dates collapse into one item, not five', () => {
    const items = report(freshCase()).items.filter(i => i.kind === 'reference_data');
    assert.equal(items.length, 1, 'five permanent entries at the top of every report would be five entries nobody reads');
    assert.match(items[0].what, /every case in this deployment/);
  });

  test('a case-level headline counts only case-level items', () => {
    // A brand new case has nothing of its own aged past a threshold except
    // the EC window; the deployment note is reported separately so the buyer
    // is not told they have work they do not have.
    const staleness = report(freshCase());
    const caseItems = staleness.items.filter(i => i.kind !== 'reference_data');
    assert.match(staleness.headline, /Separately, the statutory figures this deployment carries/);
    assert.ok(caseItems.length < staleness.items.length);
  });

  test('an aged screen is reported with its age', () => {
    const item = report(freshCase(NOW, '2025-12-20T00:00:00.000Z')).items.find(i => i.kind === 'screen');
    assert.ok(item, 'a screen 249 days old must be raised');
    assert.equal(item.severity, 'serious');
    assert.ok(item.ageDays > 180);
  });

  test('a recent screen is not', () => {
    assert.equal(report(freshCase(NOW, '2026-08-01T00:00:00.000Z')).items.filter(i => i.kind === 'screen').length, 0);
  });

  test('an encumbrance certificate is a clean window, not a clean title', () => {
    const item = report(freshCase()).items.find(i => i.key.startsWith('ec_period'));
    assert.ok(item, 'an EC whose period ended before today must be raised');
    assert.match(item.what, /clean window, not a clean title/);
  });

  test('a RERA registration valid for years yet is not raised', () => {
    // The fixture's certificate runs to 2028 — reporting that as stale would
    // be the false positive that makes the list unreadable.
    assert.equal(report(freshCase()).items.filter(i => i.key.startsWith('rera')).length, 0);
  });

  test('an expired RERA registration is raised as expired', () => {
    const item = report(freshCase('2023-06-01T00:00:00.000Z')).items.find(i => i.key.startsWith('rera'));
    assert.ok(item, 'a certificate whose validity has passed must be raised');
    assert.equal(item.severity, 'serious');
    assert.match(item.what, /expired/);
    assert.match(item.what, /offence under the Act/);
  });

  test('documents age out on their own clock', () => {
    const aged = report(freshCase('2023-06-01T00:00:00.000Z')).items.filter(i => i.kind === 'document');
    assert.ok(aged.length >= 3, 'khata, EC and tax receipt all decay');
    for (const item of aged) assert.equal(item.severity, 'serious');
    assert.equal(report(freshCase()).items.filter(i => i.kind === 'document').length, 0);
  });

  test('a map lookup built from a different address is flagged', () => {
    const base = freshCase();
    const withSite = { ...base, siteContext: preciseSiteContext({ builtAt: '2026-06-01T00:00:00.000Z' }) };
    withSite.siteContext!.location!.queried = 'Some Other Address, Whitefield, Bengaluru, Karnataka, 560066';
    const item = report(withSite).items.find(i => i.kind === 'site_context');
    assert.ok(item, 'a context built from a superseded address must be flagged');
    assert.match(item.what, /measured from the old address/);
  });

  test('a map lookup built from the address on file is not', () => {
    const base = freshCase();
    const context = preciseSiteContext();
    // The same join the provider uses, so the two cannot drift.
    context.location!.queried = siteContextQuery(base.identity);
    assert.equal(report({ ...base, siteContext: context }).items.filter(i => i.kind === 'site_context').length, 0);
  });

  test('every item names something that refreshes it', () => {
    for (const item of report(freshCase('2023-06-01T00:00:00.000Z')).items) {
      assert.ok(item.refresh.length > 20, `${item.key} must say what refreshes it`);
      assert.ok(item.asOf.length > 0);
    }
  });
});
