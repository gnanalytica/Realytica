/**
 * The JD split.
 *
 * What matters here is the refusal discipline as much as the arithmetic: a
 * ratio that does not read as a share, or a screen missing either anchor the
 * grading needs, must produce nothing rather than a verdict built on an
 * estimate. The arithmetic itself is checked through the real engine — a JDA
 * document on a real seed case — so the fair-share band is derived from
 * anchors the engine actually produced, not from hand-rolled figures.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessJdSplit, classifyDocument, extractFields, parseOwnerSharePct } from '@realytica/shared';
import type { CaseDocument } from '@realytica/shared';
import { NOW, documentsFor, screenSeed, seedFor } from './fixtures';

const SITE = 'Site No. 118';

function jdaDocument(): CaseDocument {
  const seed = seedFor(SITE);
  const fileName = 'JDA_Sharing_Agreement_Site118.pdf';
  const doc: CaseDocument = {
    id: 'doc-jda',
    caseId: 'test-case',
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    uploadedAt: NOW,
    kind: classifyDocument(fileName, 'application/pdf').kind,
    classificationConfidence: 0.9,
    kindConfirmedByUser: true,
    pages: 2,
    ocrStatus: 'complete',
    extracted: [],
  };
  doc.extracted = extractFields(doc, seed.identity, 'test-case');
  return doc;
}

describe('reading the ratio', () => {
  it('reads owner:developer shares that sum to a whole', () => {
    assert.equal(parseOwnerSharePct('45:55'), 45);
    assert.equal(parseOwnerSharePct('60/40'), 60);
  });

  it('refuses anything that is not a share of a whole', () => {
    // A ratio that does not sum near 100 is a proportion, not a share split.
    assert.equal(parseOwnerSharePct('12:30'), undefined);
    assert.equal(parseOwnerSharePct('45'), undefined);
    assert.equal(parseOwnerSharePct('as mutually agreed'), undefined);
  });
});

describe('grading a real JDA against the engine', () => {
  const seed = seedFor(SITE);
  const documents = [...documentsFor(seed.identity, seed.identity.label), jdaDocument()];
  const { result } = screenSeed(SITE, { documents });

  it('a JDA on file makes the case a joint development and produces a split', () => {
    assert.equal(result.project?.kind, 'joint_development');
    assert.ok(result.jdSplit, 'expected a jdSplit on a joint development with a stated ratio');
  });

  it('every figure in the split traces to an engine figure', () => {
    const split = result.jdSplit;
    assert.ok(split);
    const residual = result.anchors.find(a => a.method === 'residual_development');
    const landRate = result.anchors.find(a => a.method === 'land_rate');
    assert.ok(residual?.residual && landRate);
    const gross = residual.residual.steps.find(s => s.kind === 'gross');
    assert.ok(gross);
    assert.equal(split.schemeGrossValue, Math.round(gross.amount));
    assert.equal(split.offeredShareValue, Math.round((split.offeredOwnerSharePct / 100) * gross.amount));
    // The fair band is the land-rate band expressed as a share of gross.
    assert.equal(split.fairSharePctLow, Math.round((landRate.low / gross.amount) * 1000) / 10);
    assert.equal(split.fairSharePctHigh, Math.round((landRate.high / gross.amount) * 1000) / 10);
    assert.ok(split.fairSharePctLow > 0 && split.fairSharePctHigh >= split.fairSharePctLow);
  });

  it('the verdict is consistent with the band it states', () => {
    const split = result.jdSplit;
    assert.ok(split);
    if (split.verdict === 'developer_favoured') assert.ok(split.offeredOwnerSharePct < split.fairSharePctLow);
    if (split.verdict === 'landowner_favoured') assert.ok(split.offeredOwnerSharePct > split.fairSharePctHigh);
    assert.ok(split.statements.length >= 3);
    // The caveats name what the arithmetic does not price — the deposit and
    // timeline terms — because that is where JDA disputes originate.
    assert.ok(split.caveats.some(c => /deposit/i.test(c)));
  });

  it('the split cites the JDA as evidence', () => {
    const split = result.jdSplit;
    assert.ok(split);
    assert.equal(split.sourceDocumentId, 'doc-jda');
    assert.ok(split.evidenceIds.length > 0);
    const cited = result.evidence.find(e => e.id === split.evidenceIds[0]);
    assert.ok(cited && cited.sourceRef === 'doc-jda');
  });
});

describe('refusal over estimation', () => {
  it('no residual anchor means no verdict', () => {
    const split = assessJdSplit({
      offeredRatio: '45:55',
      residualAnchor: undefined,
      landRateAnchor: { id: 'a', method: 'land_rate', label: '', low: 1, mid: 2, high: 3, weight: 1, confidence: 1, rationale: '', evidenceIds: [] },
      plotAreaSqm: 100,
      currency: 'INR',
      money: n => String(n),
    });
    assert.equal(split, undefined);
  });

  it('a case that is not a joint development carries no split', () => {
    const { result } = screenSeed(SITE);
    assert.notEqual(result.project?.kind, 'joint_development');
    assert.equal(result.jdSplit, undefined);
  });
});
