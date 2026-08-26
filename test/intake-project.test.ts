/**
 * What the intake concludes about the project, and when it stops to ask.
 *
 * The behaviour under test is a judgement call the user made explicitly:
 * the product should decide the kind of project itself and only ask when it
 * genuinely cannot tell. So these assertions are as much about the questions
 * *not* asked as the ones that are.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REFERENCE_DATA } from '@realytica/shared';
import type { CaseDocument, IntakeField } from '@realytica/shared';
import { commitDraft, readDraft } from '@realytica/agents';
import { NOW } from './fixtures';

function field(path: string, label: string, value: string | number): IntakeField {
  return { path, label, value, provenance: 'stated', confirmed: true, at: NOW };
}

/** Enough for the engine to screen: locality, type, area. */
const APARTMENT_DRAFT: IntakeField[] = [
  field('locality', 'Locality', 'Whitefield'),
  field('propertyType', 'Property type', 'residential_apartment'),
  field('builtUpAreaSqm', 'Built-up area', 150),
  field('yearBuilt', 'Year built', 2018),
];

const SITE_DRAFT: IntakeField[] = [
  field('locality', 'Locality', 'Sarjapur Road'),
  field('propertyType', 'Property type', 'land_parcel'),
  field('plotAreaSqm', 'Plot area', 4000),
];

function read(fields: IntakeField[], documents: CaseDocument[] = []) {
  return readDraft({ fields, documents }, REFERENCE_DATA, NOW);
}

describe('the intake reads the project kind', () => {
  it('names a method as soon as a property type is known', () => {
    const readout = read(APARTMENT_DRAFT);
    assert.ok(readout.project, 'the reading is always present');
    assert.ok(readout.assessment, 'and so is the profile it selects');
    assert.equal(readout.assessment?.kind, readout.project?.kind);
  });

  it('does not ask about the kind when the draft settles it', () => {
    const readout = read(APARTMENT_DRAFT);
    assert.equal(readout.project?.alternatives.length, 0, 'a completed flat with a year built is not ambiguous');
    assert.equal(
      readout.gaps.find(g => g.path === 'projectKind'),
      undefined,
      'asking anyway is the form habit this design exists to avoid',
    );
  });

  it('does ask when a large bare site leaves it genuinely open', () => {
    const readout = read(SITE_DRAFT);
    assert.ok((readout.project?.alternatives.length ?? 0) > 0);
    const gap = readout.gaps.find(g => g.path === 'projectKind');
    assert.ok(gap, 'a 4,000 sqm parcel could be held, subdivided or built on — that is worth one question');
    assert.equal(gap?.blocking, false, 'but it must never block a screen: the engine assesses it as land meanwhile');
  });

  it('stops asking once the user answers', () => {
    const answered = [...SITE_DRAFT, field('projectKind', 'What you are doing here', 'plotted_development')];
    const readout = read(answered);
    assert.equal(readout.projectKindStated, true);
    assert.equal(readout.project?.kind, 'plotted_development');
    assert.equal(readout.gaps.find(g => g.path === 'projectKind'), undefined);
  });

  it('offers exactly the kinds the engine can assess', () => {
    const gap = read(SITE_DRAFT).gaps.find(g => g.path === 'projectKind');
    assert.equal(gap?.options?.length, 10, 'the option list is built from the profiles, so it cannot drift from them');
  });
});

describe('the reading survives into the case', () => {
  it('marks a stated kind as the user’s and an inferred one as ours', () => {
    const stated = commitDraft(
      { fields: [...SITE_DRAFT, field('projectKind', 'What you are doing here', 'plotted_development')], documents: [], ownerName: 'Test' },
      REFERENCE_DATA,
      NOW,
    );
    assert.ok(stated.ok);
    assert.equal(stated.request.project?.source, 'user');
    assert.equal(stated.request.project?.kind, 'plotted_development');

    const inferred = commitDraft({ fields: SITE_DRAFT, documents: [], ownerName: 'Test' }, REFERENCE_DATA, NOW);
    assert.ok(inferred.ok);
    assert.equal(inferred.request.project?.source, 'inferred');
    // The distinction is the point: "we think" must not become "you said"
    // at the moment a case is created.
    assert.equal(inferred.request.project?.kind, 'land_acquisition');
  });

  it('records the reading in the case note, saying which it was', () => {
    const inferred = commitDraft({ fields: SITE_DRAFT, documents: [], ownerName: 'Test' }, REFERENCE_DATA, NOW);
    assert.ok(inferred.ok);
    assert.match(inferred.request.notes ?? '', /read from the particulars, not stated/);
  });

  it('carries a fit caution through the commit', () => {
    const tiny = [
      field('locality', 'Locality', 'Sarjapur Road'),
      field('propertyType', 'Property type', 'residential_plot'),
      field('plotAreaSqm', 'Plot area', 220),
      field('projectKind', 'What you are doing here', 'plotted_development'),
    ];
    const out = commitDraft({ fields: tiny, documents: [], ownerName: 'Test' }, REFERENCE_DATA, NOW);
    assert.ok(out.ok);
    assert.ok(out.request.project?.fitCaution, 'a 220 sqm site cannot be subdivided, and the case must say so');
  });
});

describe('the unsettled kind is asked before documents', () => {
  it('asks what you are doing before asking for a khata extract', () => {
    const readout = read(SITE_DRAFT);
    // The draft is screenable and has critical documents outstanding, so the
    // stage is 'documents' — and asking for one first would be asking for the
    // right document by luck, since which documents are critical depends on
    // whether this is a purchase or a subdivision.
    assert.equal(readout.stage, 'documents');
    assert.equal(readout.nextQuestion?.path, 'projectKind');
  });

  it('goes back to documents once the kind is settled', () => {
    const answered = [...SITE_DRAFT, field('projectKind', 'What you are doing here', 'plotted_development')];
    const readout = read(answered);
    assert.notEqual(readout.nextQuestion?.path, 'projectKind');
  });
});
