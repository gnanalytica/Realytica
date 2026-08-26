/**
 * The schedule of property: boundaries, dimensions, and the two
 * contradictions they make findable.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_DATA, analyseTitleGraph } from '@valytica/shared';
import type { CaseDocument, DocumentKind } from '@valytica/shared';
import { NOW, caseFrom, documentsFor, seedFor, screenSeed } from './fixtures';

function analyse(documents: CaseDocument[]) {
  const seed = seedFor('Devanahalli');
  const { result } = screenSeed('Devanahalli', { documents });
  return analyseTitleGraph(caseFrom(seed.identity, documents, result), NOW);
}

function edit(documents: CaseDocument[], kind: DocumentKind, key: string, value: string): CaseDocument[] {
  return documents.map(doc =>
    doc.kind === kind ? { ...doc, extracted: doc.extracted.map(f => (f.key === key ? { ...f, value } : f)) } : doc,
  );
}

describe('schedule extraction', () => {
  test('a site deed yields four boundaries and two dimensions', () => {
    const seed = seedFor('Devanahalli');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const deed = documents.find(d => d.kind === 'title_deed')!;
    const keys = deed.extracted.map(f => f.key);
    for (const key of ['boundaryNorth', 'boundaryEast', 'boundarySouth', 'boundaryWest', 'dimensionEastWest', 'dimensionNorthSouth']) {
      assert.ok(keys.includes(key), `expected ${key} on the sale deed`);
    }
  });

  test('a flat deed yields no schedule, because a flat has no site dimensions', () => {
    const seed = seedFor('Whitefield');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const deed = documents.find(d => d.kind === 'title_deed')!;
    assert.equal(deed.extracted.filter(f => /^boundary|^dimension/.test(f.key)).length, 0);
  });

  test('the schedule places the road on the side the case records as facing', () => {
    const seed = seedFor('Devanahalli');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const deed = documents.find(d => d.kind === 'title_deed')!;
    // The fixture site faces east on a 40ft road; a schedule that put the
    // road elsewhere would contradict the plot facts on the same screen.
    const east = deed.extracted.find(f => f.key === 'boundaryEast')!;
    assert.match(east.value, /40 feet wide road/);
  });
});

describe('the title graph reads the schedule', () => {
  test('boundaries become edges, one per document per side', () => {
    const seed = seedFor('Devanahalli');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const analysis = analyse(documents);
    const edges = analysis.graph.edges.filter(e => e.kind === 'describes_boundary');
    // A sale deed and a mother deed, four sides each.
    assert.equal(edges.length, 8);
  });

  test('dimensions become an area claim derived from the deed itself', () => {
    const seed = seedFor('Devanahalli');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const analysis = analyse(documents);
    const derived = analysis.graph.edges.filter(e => e.kind === 'asserts_area' && e.attributes?.fieldKey === 'scheduleDimensions');
    assert.equal(derived.length, 2, 'one per instrument carrying a schedule');
    // 30ft x 40ft = 1200 sqft = 111.48 sqm, against a recorded 111.5.
    const sqm = derived[0].attributes!.areaSqm as number;
    assert.ok(Math.abs(sqm - seed.identity.plotAreaSqm) / seed.identity.plotAreaSqm < 0.02);
  });

  test('agreeing documents raise nothing', () => {
    const seed = seedFor('Devanahalli');
    const analysis = analyse(documentsFor(seed.identity, seed.identity.label));
    assert.equal(analysis.contradictions.filter(c => c.kind === 'boundary_mismatch').length, 0);
    assert.equal(analysis.contradictions.filter(c => c.kind === 'area_mismatch').length, 0);
  });

  test('two deeds naming different abutters on one side raise boundary_mismatch', () => {
    const seed = seedFor('Devanahalli');
    const documents = edit(documentsFor(seed.identity, seed.identity.label), 'mother_deed', 'boundaryNorth', 'Sy. No. 999/9');
    const found = analyse(documents).contradictions.find(c => c.kind === 'boundary_mismatch');
    assert.ok(found, 'a disagreeing schedule must be raised');
    assert.equal(found.severity, 'serious');
    assert.equal(found.claims.length, 2, 'both sides of the disagreement must be quoted');
  });

  test('punctuation and noise words are not a disagreement', () => {
    const seed = seedFor('Devanahalli');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const north = documents.find(d => d.kind === 'title_deed')!.extracted.find(f => f.key === 'boundaryNorth')!.value;
    // Same parcel, written the long way. The merge key must absorb this, or
    // the one check that catches a wrong-parcel purchase cries wolf.
    const restated = north.replace(/^Sy\. No\. /, 'Survey Number ');
    assert.notEqual(restated, north);
    const edited = edit(documents, 'mother_deed', 'boundaryNorth', restated);
    assert.equal(analyse(edited).contradictions.filter(c => c.kind === 'boundary_mismatch').length, 0);
  });

  test('a deed that contradicts its own arithmetic raises area_mismatch', () => {
    const seed = seedFor('Devanahalli');
    const documents = edit(documentsFor(seed.identity, seed.identity.label), 'title_deed', 'dimensionNorthSouth', '52');
    const found = analyse(documents).contradictions.find(c => c.kind === 'area_mismatch');
    assert.ok(found, 'dimensions that do not multiply to the stated extent must be raised');
    // Two claims from the same field key must name their sources, or the
    // sentence reads as one source contradicting itself.
    assert.match(found.statement, /Sale_Deed/);
    assert.match(found.statement, /Mother_Deed/);
  });
});
