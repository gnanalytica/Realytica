/**
 * Connectors, watchers, and the RFI generator.
 *
 * The load-bearing claims: the connector catalogue stays consistent with the
 * domain maps it fronts (a fetchable connector must live on the department
 * its record kind belongs to); watcher alerts are the staleness report
 * routed, not recomputed — same items, same severities, new address; and an
 * RFI is an enumeration of recorded gaps — nothing in the request text that
 * the case does not show as missing, and a closed gap leaves the request.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DD_CONNECTORS,
  DD_DOMAIN_KEYS,
  REFERENCE_DATA,
  buildRfi,
  buildStaleness,
  connectorsForDomain,
  ddWatcherAlerts,
  domainForRecordKind,
  technicalDocumentGaps,
} from '@realytica/shared';
import type { PropertyCase } from '@realytica/shared';
import { NOW, caseFrom, screenSeed } from './fixtures';

function seededCase(): PropertyCase {
  const { result, identity, documents } = screenSeed('Site No. 118');
  return caseFrom(identity, documents, result, { id: 'conn-1' });
}

function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString();
}

describe('connector registry', () => {
  it('every connector names a real department, and keys are unique', () => {
    const keys = new Set<string>();
    for (const c of DD_CONNECTORS) {
      assert.ok((DD_DOMAIN_KEYS as string[]).includes(c.domain), `${c.key} has unknown domain ${c.domain}`);
      assert.ok(!keys.has(c.key), `duplicate connector key ${c.key}`);
      keys.add(c.key);
      assert.ok(c.settles.length > 0 && c.route.length > 0, `${c.key} must say what it settles and how to obtain it`);
    }
  });

  it('a fetchable connector lives on the department its record kind belongs to', () => {
    for (const c of DD_CONNECTORS.filter(c => c.recordKind)) {
      assert.equal(c.domain, domainForRecordKind(c.recordKind as string), `${c.key} disagrees with domainForRecordKind`);
    }
  });

  it('the land, legal, approvals and compliance departments each have connectors', () => {
    for (const domain of ['land', 'legal', 'approvals', 'compliance'] as const) {
      assert.ok(connectorsForDomain(domain).length > 0, `${domain} has no connectors`);
    }
  });
});

describe('watchers', () => {
  it('routes staleness items to departments without changing them', () => {
    const c = seededCase();
    c.registerSearches = [
      {
        kind: 'encumbrance_certificate',
        label: 'Encumbrance search',
        by: 'manual',
        authority: 'primary_register',
        retrievedAt: daysBefore(NOW, 60),
        nilResult: true,
        refresh: 'Search again through Kaveri.',
      },
    ];
    const report = buildStaleness(c, REFERENCE_DATA, NOW);
    const alerts = ddWatcherAlerts(c, REFERENCE_DATA, NOW);
    assert.equal(alerts.length, report.items.length, 'routing must not add or drop an alarm');
    const ec = alerts.find(a => a.key === 'register:encumbrance_certificate');
    assert.ok(ec, 'the stale register search must alarm');
    assert.equal(ec.domain, 'legal');
    const source = report.items.find(i => i.key === ec.key);
    assert.equal(ec.severity, source?.severity, 'severity must be the staleness report\'s own');
  });

  it('an expiring RERA registration rings in approvals', () => {
    const c = seededCase();
    c.documents.push({
      id: 'rera-doc',
      caseId: c.id,
      fileName: 'rera_certificate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedAt: NOW,
      kind: 'rera_registration',
      classificationConfidence: 1,
      kindConfirmedByUser: true,
      pages: 1,
      ocrStatus: 'complete',
      extracted: [
        { key: 'reraValidTill', label: 'Valid till', value: daysBefore(NOW, 30).slice(0, 10), confidence: 1, sourceDocumentId: 'rera-doc', method: 'parser' },
      ],
    });
    const alert = ddWatcherAlerts(c, REFERENCE_DATA, NOW).find(a => a.key === 'rera:rera-doc');
    assert.ok(alert, 'an expired registration must alarm');
    assert.equal(alert.domain, 'approvals');
  });
});

describe('rfi', () => {
  it('is deterministic and asks only for recorded gaps', () => {
    const c = seededCase();
    const a = buildRfi(c, { now: NOW });
    const b = buildRfi(c, { now: NOW });
    assert.deepEqual(a, b);
    assert.ok(a.items.length > 0, 'a fresh case owes documents');
    for (const item of a.items) {
      assert.ok(a.text.includes(item.what), `request text must carry "${item.what}"`);
    }
    assert.ok(a.text.includes(c.identity.label));
  });

  it('a domain-scoped request carries only that department\'s asks', () => {
    const c = seededCase();
    const technical = buildRfi(c, { now: NOW, domain: 'technical' });
    for (const item of technical.items) assert.equal(item.domain, 'technical');
    const all = buildRfi(c, { now: NOW });
    assert.ok(technical.items.length <= all.items.length);
  });

  it('closing a gap removes its ask', () => {
    const c = seededCase();
    const before = buildRfi(c, { now: NOW, domain: 'technical' });
    assert.ok(before.items.length > 0, 'the technical checklist starts unprovided');
    // Mark every checklist item received — the provided map is keyed by item id.
    c.technicalDocumentsProvided = Object.fromEntries(
      [...technicalDocumentGaps('built', undefined), ...technicalDocumentGaps('proposed', undefined)].map(item => [item.id, true]),
    );
    const after = buildRfi(c, { now: NOW, domain: 'technical' });
    assert.equal(after.items.length, 0, 'a fully-provided checklist owes nothing');
  });
});
