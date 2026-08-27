/**
 * Technical/construction due diligence — the shared catalog and pure helpers.
 *
 * What matters here: the catalog is a real closed set (every item resolves
 * back through its own id), the review-state split keeps a proposal out of
 * every "accepted" aggregate until it is actually accepted, and the counts a
 * headline reads (`openTechnicalFindingCounts`) never count a proposal or a
 * rejection as a fact about the building.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TECHNICAL_DOCUMENT_CHECKLIST,
  TECHNICAL_SYSTEMS,
  acceptedTechnicalFindings,
  groupFindingsBySystem,
  openTechnicalFindingCounts,
  proposedTechnicalFindings,
  technicalDocumentChecklist,
  technicalDocumentGaps,
  technicalDocumentItem,
} from '@realytica/shared';
import type { TechnicalFinding } from '@realytica/shared';

function finding(overrides: Partial<TechnicalFinding> = {}): TechnicalFinding {
  return {
    id: overrides.id ?? 'f1',
    caseId: 'case-1',
    system: 'structural',
    zone: 'Basement 2',
    observation: 'Water oozing from a nozzle outlet',
    severity: 'warning',
    recommendation: 'Identify the source and channel to sumps',
    evidenceDocumentIds: [],
    source: 'user',
    reviewState: 'accepted',
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('the document checklist', () => {
  it('every item resolves back through its own id', () => {
    for (const item of TECHNICAL_DOCUMENT_CHECKLIST) {
      assert.equal(technicalDocumentItem(item.id), item);
    }
  });

  it('splits cleanly by phase, with no id shared across phases', () => {
    const built = technicalDocumentChecklist('built');
    const proposed = technicalDocumentChecklist('proposed');
    assert.ok(built.length > 0 && proposed.length > 0);
    const builtIds = new Set(built.map(i => i.id));
    assert.ok(proposed.every(i => !builtIds.has(i.id)));
  });

  it('a missing key reads as not provided, never as an error', () => {
    const gaps = technicalDocumentGaps('built', undefined);
    assert.equal(gaps.length, technicalDocumentChecklist('built').length);
  });

  it('marking an item provided removes exactly that one gap', () => {
    const [first, ...rest] = technicalDocumentChecklist('built');
    const gaps = technicalDocumentGaps('built', { [first.id]: true });
    assert.equal(gaps.length, rest.length);
    assert.ok(!gaps.some(g => g.id === first.id));
  });
});

describe('review state keeps a proposal out of the case until accepted', () => {
  const findings: TechnicalFinding[] = [
    finding({ id: 'a', reviewState: 'accepted', status: 'open', severity: 'critical' }),
    finding({ id: 'p', reviewState: 'proposed', source: 'agent', severity: 'critical' }),
    finding({ id: 'r', reviewState: 'rejected', severity: 'critical' }),
  ];

  it('accepted/proposed/rejected partition the set with no overlap', () => {
    assert.deepEqual(acceptedTechnicalFindings(findings).map(f => f.id), ['a']);
    assert.deepEqual(proposedTechnicalFindings(findings).map(f => f.id), ['p']);
  });

  it('open-finding counts only ever read the accepted subset', () => {
    const counts = openTechnicalFindingCounts(findings);
    // Only 'a' is accepted-and-open-and-critical; the proposed and rejected
    // criticals must not inflate this, or a draft would read as a real
    // finding before anyone reviewed it.
    assert.equal(counts.openCritical, 1);
    assert.equal(counts.open, 1);
  });

  it('grouping by system only ever surfaces accepted findings', () => {
    const grouped = groupFindingsBySystem(findings);
    const total = grouped.reduce((n, g) => n + g.findings.length, 0);
    assert.equal(total, findings.length, 'grouping itself does not filter — callers pass it the accepted subset');
    // The tab passes acceptedTechnicalFindings(...) into this, not the raw
    // array — assert that composition actually drops the other two.
    const acceptedGrouped = groupFindingsBySystem(acceptedTechnicalFindings(findings));
    assert.equal(acceptedGrouped.reduce((n, g) => n + g.findings.length, 0), 1);
  });

  it('groups in catalog order, and skips a system with nothing in it', () => {
    const mixed = [finding({ id: 'x', system: 'ehs' }), finding({ id: 'y', system: 'architectural' })];
    const grouped = groupFindingsBySystem(mixed);
    assert.deepEqual(
      grouped.map(g => g.system),
      TECHNICAL_SYSTEMS.filter(s => s === 'architectural' || s === 'ehs'),
    );
  });
});
