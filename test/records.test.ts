/**
 * The records port.
 *
 * The property under test throughout is the one the port exists for: a
 * failure to search and a search that found nothing must never be the same
 * value. Confusing them turns "we could not check" into "nothing is
 * registered against this title", which is the most dangerous sentence this
 * product could utter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MANUAL_ROUTES,
  RECORD_DOCUMENT_KIND,
  createAggregatorProvider,
  readAggregatorConfig,
  recordProviderConfigured,
  recordProviderFor,
  unconfiguredRecordProvider,
} from '@realytica/agents';
import type { AggregatorConfig, RecordKind } from '@realytica/agents';
import { REFERENCE_DATA, buildStaleness } from '@realytica/shared';
import type { RegisterSearch } from '@realytica/shared';
import { NOW, caseFrom, documentsFor, seedFor } from './fixtures';

const ALL_KINDS = Object.keys(RECORD_DOCUMENT_KIND) as RecordKind[];

describe('the unconfigured provider is a real provider', () => {
  it('answers every record kind with a gap, never a throw or an empty', async () => {
    for (const kind of ALL_KINDS) {
      const out = await unconfiguredRecordProvider.fetch({ kind, identifiers: { state: 'Karnataka', parcelId: '42/3' } });
      assert.equal(out.ok, false);
      if (out.ok) continue;
      assert.equal(out.gap.reason, 'not_configured');
      assert.ok(out.gap.leavesUnknown.length > 40, `${kind} does not say what is now unknown`);
      assert.ok(out.gap.manualRoute.length > 20, `${kind} does not say how to get it by hand`);
    }
  });

  it('has a manual route for every record kind, with no gaps in the table', () => {
    for (const kind of ALL_KINDS) {
      assert.ok(MANUAL_ROUTES[kind], `${kind} has no manual route`);
      assert.ok(MANUAL_ROUTES[kind].label.length > 3);
    }
  });

  it('is what a deployment with no config resolves to', () => {
    assert.equal(recordProviderConfigured({}), false);
    assert.equal(recordProviderFor({}).id, 'unconfigured');
  });
});

describe('reading vendor config', () => {
  const base = {
    REALYTICA_RECORDS_BASE_URL: 'https://vendor.example/api',
    REALYTICA_RECORDS_API_KEY: 'k',
    REALYTICA_RECORDS_KINDS: 'encumbrance_certificate,khata_extract',
  };

  it('requires the coverage list rather than defaulting to everything', () => {
    // A provider that claims a kind it cannot deliver produces a failed fetch
    // where an honest one would have produced a coverage gap naming the
    // manual route. Silence about coverage is how a nil result gets made up.
    assert.equal(readAggregatorConfig({ ...base, REALYTICA_RECORDS_KINDS: undefined } as never), null);
    assert.equal(readAggregatorConfig({ ...base, REALYTICA_RECORDS_KINDS: 'nonsense' }), null);
  });

  it('needs a url and a key too', () => {
    assert.equal(readAggregatorConfig({ ...base, REALYTICA_RECORDS_API_KEY: undefined } as never), null);
    assert.equal(readAggregatorConfig({ ...base, REALYTICA_RECORDS_BASE_URL: undefined } as never), null);
  });

  it('reads a complete config and keeps only known kinds', () => {
    const config = readAggregatorConfig({ ...base, REALYTICA_RECORDS_KINDS: 'encumbrance_certificate,made_up' });
    assert.ok(config);
    assert.deepEqual(config.kinds, ['encumbrance_certificate']);
    assert.equal(config.baseUrl, 'https://vendor.example/api');
  });

  it('still reads under the old VALYTICA_ prefix', () => {
    const config = readAggregatorConfig({
      VALYTICA_RECORDS_BASE_URL: 'https://old.example',
      VALYTICA_RECORDS_API_KEY: 'k',
      VALYTICA_RECORDS_KINDS: 'khata_extract',
    });
    assert.ok(config);
  });
});

describe('an aggregator is a secondary source, and says so', () => {
  const config: AggregatorConfig = {
    id: 'test-vendor',
    label: 'Test Vendor',
    baseUrl: 'https://vendor.example',
    apiKey: 'k',
    authHeader: 'Authorization',
    kinds: ['encumbrance_certificate'],
    regions: ['Karnataka'],
    monitor: false,
    timeoutMs: 1000,
  };

  it('states its standing in the user’s terms', () => {
    const provider = createAggregatorProvider(config);
    assert.match(provider.standing, /not an independent authority/);
    assert.match(provider.standing, /Sub-Registrar record is right/);
  });

  it('refuses a kind outside the contract, with the manual route', async () => {
    const out = await createAggregatorProvider(config).fetch({
      kind: 'record_of_rights',
      identifiers: { state: 'Karnataka', parcelId: '42/3' },
    });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.gap.reason, 'out_of_coverage');
    assert.equal(out.gap.manualRoute, MANUAL_ROUTES.record_of_rights.manualRoute);
  });

  it('refuses a state outside the contract', async () => {
    const out = await createAggregatorProvider(config).fetch({
      kind: 'encumbrance_certificate',
      identifiers: { state: 'Maharashtra', parcelId: '42/3' },
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.gap.reason, 'out_of_coverage');
  });

  it('names a missing identifier as a missing identifier, not a vendor problem', async () => {
    const out = await createAggregatorProvider(config).fetch({
      kind: 'encumbrance_certificate',
      identifiers: { state: 'Karnataka' },
    });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.gap.reason, 'insufficient_identifiers');
    assert.match(out.gap.detail ?? '', /widening anything else will not/);
  });

  it('never throws on an unreachable vendor', async () => {
    const out = await createAggregatorProvider({ ...config, baseUrl: 'https://127.0.0.1:1', timeoutMs: 300 }).fetch({
      kind: 'encumbrance_certificate',
      identifiers: { state: 'Karnataka', parcelId: '42/3' },
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.gap.reason, 'unreachable');
  });
});

describe('a register search ages, and the watch now has something to watch', () => {
  function caseWithSearch(search: RegisterSearch) {
    const seed = seedFor('Site No. 42');
    const documents = documentsFor(seed.identity, seed.identity.label);
    return { ...caseFrom(seed.identity, documents), registerSearches: [search] };
  }

  const search = (retrievedAt: string, nilResult = false): RegisterSearch => ({
    kind: 'encumbrance_certificate',
    label: 'Encumbrance certificate',
    by: 'test-vendor',
    authority: 'secondary',
    retrievedAt,
    nilResult,
    refresh: 'Search it again.',
  });

  it('says nothing about a search run yesterday', () => {
    const report = buildStaleness(caseWithSearch(search('2026-08-25T00:00:00.000Z')), REFERENCE_DATA, NOW);
    assert.ok(!report.items.some(i => i.kind === 'register_search'));
  });

  it('flags one that is two months old', () => {
    const report = buildStaleness(caseWithSearch(search('2026-06-20T00:00:00.000Z')), REFERENCE_DATA, NOW);
    const item = report.items.find(i => i.kind === 'register_search');
    assert.ok(item, 'a 67-day-old encumbrance search is a real exposure');
    assert.ok(item.ageDays > 60);
  });

  it('is explicit that a nil result is only nil as at its date', () => {
    const report = buildStaleness(caseWithSearch(search('2026-06-20T00:00:00.000Z', true)), REFERENCE_DATA, NOW);
    const item = report.items.find(i => i.kind === 'register_search');
    assert.match(item?.what ?? '', /nil result is only nil as at the search date/);
  });
});
