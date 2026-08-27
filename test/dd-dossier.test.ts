/**
 * The department dossier.
 *
 * The load-bearing rule is the proof rule: a fact reaches a dossier only with
 * a document on this case behind it, so the source chip can always be opened.
 * Beyond that: determinism, department routing that follows the DOCUMENT, and
 * gap counting that falls when the gap is closed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REFERENCE_DATA, buildDepartmentDossier, domainsForDocumentKind } from '@realytica/shared';
import type { PropertyCase } from '@realytica/shared';
import { NOW, caseFrom, screenSeed } from './fixtures';

function seeded(): PropertyCase {
  const { result, identity, documents } = screenSeed('Site No. 118');
  return caseFrom(identity, documents, result, { id: 'dossier-1' });
}

describe('department dossier', () => {
  it('is deterministic', () => {
    const c = seeded();
    assert.deepEqual(
      buildDepartmentDossier(c, 'land', { refData: REFERENCE_DATA, now: NOW }),
      buildDepartmentDossier(c, 'land', { refData: REFERENCE_DATA, now: NOW }),
    );
  });

  it('every fact opens to a document that is actually on the case', () => {
    const c = seeded();
    const ids = new Set(c.documents.map(d => d.id));
    for (const domain of ['land', 'legal', 'approvals', 'technical', 'compliance'] as const) {
      const dossier = buildDepartmentDossier(c, domain);
      for (const fact of dossier.facts) {
        assert.ok(fact.sources.length > 0, `${domain}: fact "${fact.key}" has no source`);
        for (const s of fact.sources) {
          assert.ok(ids.has(s.documentId), `${domain}: fact "${fact.key}" cites a document not on the case`);
          assert.ok(s.documentName.length > 0);
        }
      }
    }
  });

  it('a fact belongs to the departments its DOCUMENT belongs to', () => {
    const c = seeded();
    const dossier = buildDepartmentDossier(c, 'land');
    assert.ok(dossier.facts.length > 0, 'the seed case files documents into Land');
    for (const fact of dossier.facts) {
      for (const s of fact.sources) {
        const doc = c.documents.find(d => d.id === s.documentId);
        assert.ok(doc);
        assert.ok(domainsForDocumentKind(doc.kind).includes('land'), `${doc.kind} does not route to land`);
      }
    }
  });

  it('a fact whose document leaves the case leaves with it', () => {
    const c = seeded();
    const before = buildDepartmentDossier(c, 'land');
    assert.ok(before.facts.length > 0);
    const dropped = before.facts[0].sources[0].documentId;
    c.documents = c.documents.filter(d => d.id !== dropped);
    const after = buildDepartmentDossier(c, 'land');
    for (const f of after.facts) {
      assert.ok(!f.sources.some(s => s.documentId === dropped), 'no fact may outlive its proof');
    }
  });

  it('document fact counts add up to the dossier facts', () => {
    const dossier = buildDepartmentDossier(seeded(), 'legal');
    const summed = dossier.documents.reduce((n, d) => n + d.factCount, 0);
    // Every source is one document's word, so the per-document counts add up
    // to the total number of statements, not to the number of grouped facts.
    assert.equal(summed, dossier.facts.reduce((n, f) => n + f.sources.length, 0));
    assert.equal(dossier.counts.facts, dossier.facts.length);
    assert.equal(dossier.counts.documents, dossier.documents.length);
  });

  it('closing a gap removes it from the department that owed it', () => {
    const c = seeded();
    const before = buildDepartmentDossier(c, 'technical');
    assert.ok(before.gaps.length > 0, 'the technical checklist starts unprovided');
    const closed = before.gaps[0];
    c.technicalDocumentsProvided = { [closed.id]: true };
    const after = buildDepartmentDossier(c, 'technical');
    assert.ok(!after.gaps.some(g => g.id === closed.id));
    assert.equal(after.counts.gaps, before.counts.gaps - 1);
  });

  it('watchers appear only when reference data is supplied', () => {
    const c = seeded();
    assert.equal(buildDepartmentDossier(c, 'legal').watchers.length, 0, 'no state pack, no staleness claim');
    const withRef = buildDepartmentDossier(c, 'legal', { refData: REFERENCE_DATA, now: NOW });
    for (const w of withRef.watchers) assert.equal(w.domain, 'legal');
  });

  it('the same fact from two documents reads as one corroborated line', () => {
    const dossier = buildDepartmentDossier(seeded(), 'land');
    // Deliberately not just "more than one source" — a DISPUTED fact also has
    // several, and conflating the two is exactly the bug this grouping fixes.
    const corroborated = dossier.facts.find(f => !f.varies && f.sources.length > 1);
    assert.ok(corroborated, 'the seed case has a fact two deeds both state identically');
    const seen = new Set(corroborated.sources.map(s => s.documentId));
    assert.equal(seen.size, corroborated.sources.length, 'one line per document, never twice');
  });

  it('documents stating different values produce one fact carrying both versions', () => {
    const c = seeded();
    const land = c.documents.filter(d => d.extracted.length > 0);
    assert.ok(land.length >= 2);
    // Make the second document contradict the first on its own leading field.
    const field = land[0].extracted[0];
    land[1].extracted = [{ ...field, value: `${field.value} (different)`, sourceDocumentId: land[1].id }];
    const dossier = buildDepartmentDossier(c, 'land');
    const varied = dossier.facts.find(f => f.key === field.key && f.varies);
    assert.ok(varied, 'a difference must survive rather than be flattened');
    assert.ok((varied.values?.length ?? 0) >= 2, 'both versions are kept');
    assert.equal(dossier.facts[0].varies, true, 'a fact with several versions leads the list');
    // This module never claims a contradiction — that judgement, with its
    // severity, belongs to the title graph's own detector.
    assert.ok(!('disputed' in varied), 'no second contradiction vocabulary');
  });

  it('carries the department its own question and connectors', () => {
    const dossier = buildDepartmentDossier(seeded(), 'approvals');
    assert.match(dossier.question, /permitted/i);
    assert.ok(dossier.connectors.length > 0);
    for (const c of dossier.connectors) assert.equal(c.domain, 'approvals');
  });
});
