/**
 * The project kind decides the assessment.
 *
 * These tests exist because the failure this model prevents is silent: an
 * engine that applies one blend to every subject still returns a number, and
 * the number looks fine. What it does not do is answer the question the
 * reader actually asked. So the assertions here are mostly about *which
 * methods ran*, not about the values they produced.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASSESSMENT_PROFILES,
  PROJECT_KINDS,
  assessmentFitCaution,
  assessmentProfile,
  inferProjectKind,
  resolveProjectBrief,
} from '@realytica/shared';
import type { CaseDocument, ProjectBrief, PropertyIdentity } from '@realytica/shared';
import { NOW, documentsFor, screenSeed, seedFor } from './fixtures';

const APARTMENT = '3BHK — Prestige Lakeside';
const SITE = 'Site No. 42';
const OFFICE = 'Vertex Panache';

function jdaDoc(caseId = 'test-case'): CaseDocument {
  return {
    id: 'doc-jda',
    caseId,
    fileName: 'joint-development-agreement.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    uploadedAt: NOW,
    kind: 'joint_development_agreement',
    classificationConfidence: 0.95,
    kindConfirmedByUser: true,
    pages: 30,
    ocrStatus: 'complete',
    extracted: [],
  };
}

describe('assessment profiles', () => {
  it('covers every project kind, keyed consistently', () => {
    for (const kind of PROJECT_KINDS) {
      const profile = ASSESSMENT_PROFILES[kind];
      assert.equal(profile.kind, kind, `${kind} profile is keyed under the wrong kind`);
      assert.ok(profile.headlineQuestion.endsWith('?'), `${kind} headline is not a question`);
      assert.ok(profile.decisionBasis.length >= 2, `${kind} needs at least two decision bases`);
      assert.ok(profile.criticalChecks.length > 0, `${kind} names no critical checks`);
      assert.ok(profile.requiredDocuments.length > 0, `${kind} requires no documents`);
    }
  });

  it('gives every kind exactly one primary method', () => {
    for (const kind of PROJECT_KINDS) {
      const primary = ASSESSMENT_PROFILES[kind].methodStances.filter(s => s.role === 'primary');
      assert.equal(primary.length, 1, `${kind} has ${primary.length} primary methods, expected exactly 1`);
    }
  });

  it('suppresses a method if and only if it marks it not applicable', () => {
    for (const kind of PROJECT_KINDS) {
      for (const stance of ASSESSMENT_PROFILES[kind].methodStances) {
        const suppressed = stance.weightFactor === 0;
        assert.equal(
          suppressed,
          stance.role === 'not_applicable',
          `${kind}/${stance.method}: weightFactor 0 and role not_applicable must agree`,
        );
      }
    }
  });
});

describe('project kind inference', () => {
  it('treats a joint development agreement as decisive', () => {
    const seed = seedFor(SITE);
    const inference = inferProjectKind(seed.identity, { documentKinds: ['title_deed', 'joint_development_agreement'] });
    assert.equal(inference.kind, 'joint_development');
    assert.deepEqual(inference.alternatives, []);
    assert.ok(inference.confidence > 0.9);
  });

  it('takes a stated intent over any structural signal', () => {
    const seed = seedFor(SITE);
    const inference = inferProjectKind(seed.identity, { intent: 'subdivide_and_sell' });
    assert.equal(inference.kind, 'plotted_development');
  });

  it('values a bare site as land and says what would settle it', () => {
    const seed = seedFor(SITE);
    const inference = inferProjectKind(seed.identity);
    assert.equal(inference.kind, 'land_acquisition');
    // The honest part: this is the assumption that assumes least, and the
    // inference must not present it as a finding.
    assert.ok(inference.alternatives.length > 0, 'a bare site with no stated intent has alternatives');
    assert.ok(inference.settledBy, 'and one question that would settle it');
    assert.ok(inference.confidence <= 0.7, `confidence ${inference.confidence} overstates an unstated intent`);
  });

  it('reads a completed apartment with an asking price as a purchase', () => {
    const seed = seedFor(APARTMENT);
    const inference = inferProjectKind(seed.identity);
    assert.equal(inference.kind, 'built_asset_purchase');
    assert.ok(inference.confidence >= 0.8);
  });

  it('does not overwrite a brief a person set', () => {
    const seed = seedFor(SITE);
    const stated: ProjectBrief = {
      kind: 'apartment_project',
      source: 'user',
      intent: 'buy_and_build',
      inference: { kind: 'apartment_project', confidence: 1, basis: ['You said so.'], alternatives: [] },
      decidedAt: NOW,
    };
    const resolved = resolveProjectBrief(seed.identity, NOW, stated, { documentKinds: ['joint_development_agreement'] });
    assert.equal(resolved.kind, 'apartment_project', 'a JDA on file must not override a stated brief');
    assert.equal(resolved.source, 'user');
  });

  it('re-infers a brief it inferred before, so new documents are read', () => {
    const seed = seedFor(SITE);
    const earlier = resolveProjectBrief(seed.identity, NOW);
    assert.equal(earlier.source, 'inferred');
    const later = resolveProjectBrief(seed.identity, NOW, earlier, { documentKinds: ['joint_development_agreement'] });
    assert.equal(later.kind, 'joint_development');
  });
});

describe('the profile reaches the anchors', () => {
  it('leads a finished apartment on comparable sales', () => {
    const { result } = screenSeed(APARTMENT);
    assert.equal(result.project?.kind, 'built_asset_purchase');
    const primary = result.anchors.find(a => a.role === 'primary');
    assert.equal(primary?.method, 'comparable_sales');
    assert.ok(primary?.roleNote, 'the primary anchor states why it leads');
  });

  it('drops the residual anchor entirely on a built asset purchase', () => {
    const { result } = screenSeed(APARTMENT);
    assert.equal(
      result.anchors.find(a => a.method === 'residual_development'),
      undefined,
      'a method the profile marks not applicable must be absent, not present at zero weight',
    );
  });

  it('leads a plotted development on the residual, not the land rate', () => {
    const seed = seedFor(SITE);
    const brief: ProjectBrief = {
      kind: 'plotted_development',
      source: 'user',
      intent: 'subdivide_and_sell',
      inference: { kind: 'plotted_development', confidence: 1, basis: ['stated'], alternatives: [] },
      decidedAt: NOW,
    };
    const { result } = screenSeed(SITE, { project: brief });
    assert.equal(result.project?.kind, 'plotted_development');
    const residual = result.anchors.find(a => a.method === 'residual_development');
    const land = result.anchors.find(a => a.method === 'land_rate');
    assert.ok(residual, 'a plotted development must produce a residual anchor');
    assert.equal(residual?.role, 'primary');
    assert.equal(land?.role, 'supporting');
    assert.ok(
      residual.weight > land!.weight,
      `residual weight ${residual.weight} should exceed land ${land!.weight} once the profile applies`,
    );
  });

  it('moves the same site to a different number when the plan changes', () => {
    const asLand = screenSeed(SITE).result;
    const asPlotted = screenSeed(SITE, {
      project: {
        kind: 'plotted_development',
        source: 'user',
        intent: 'subdivide_and_sell',
        inference: { kind: 'plotted_development', confidence: 1, basis: ['stated'], alternatives: [] },
        decidedAt: NOW,
      },
    }).result;
    // Same land, same evidence, two intentions — and therefore two answers.
    // If these ever coincide, the profile is not reaching the blend.
    assert.notEqual(
      asLand.indicativeValue.mid,
      asPlotted.indicativeValue.mid,
      'changing what you intend to build must change the valuation',
    );
  });

  it('never leaves an anchor without a stated role', () => {
    for (const label of [APARTMENT, SITE, OFFICE]) {
      const { result } = screenSeed(label);
      for (const anchor of result.anchors) {
        assert.ok(anchor.role, `${label}: ${anchor.method} has no role`);
        assert.notEqual(anchor.role, 'not_applicable', `${label}: ${anchor.method} survived as not_applicable`);
      }
    }
  });

  it('carries the profile onto the result so a stored screen explains itself', () => {
    const { result } = screenSeed(SITE);
    assert.ok(result.assessment, 'the result carries its assessment profile');
    assert.equal(result.assessment?.kind, result.project?.kind);
    assert.equal(result.assessment?.label, assessmentProfile(result.project!.kind).label);
  });

  it('reads a JDA on file and switches the whole assessment', () => {
    const seed = seedFor(SITE);
    const identity: PropertyIdentity = seed.identity;
    const documents = [...documentsFor(identity, seed.identity.label), jdaDoc()];
    const { result } = screenSeed(SITE, { documents });
    assert.equal(result.project?.kind, 'joint_development');
    const asking = result.anchors.find(a => a.method === 'asking_price_adjusted');
    assert.equal(asking, undefined, 'a share deal has no asking price to adjust');
  });
});

describe('the residual values the right product', () => {
  const plottedBrief: ProjectBrief = {
    kind: 'plotted_development',
    source: 'user',
    intent: 'subdivide_and_sell',
    inference: { kind: 'plotted_development', confidence: 1, basis: ['stated'], alternatives: [] },
    decidedAt: NOW,
  };

  it('values a plotted development as sites, not as an apartment envelope', () => {
    const { result, identity } = screenSeed(SITE, { project: plottedBrief });
    const residual = result.anchors.find(a => a.method === 'residual_development');
    assert.ok(residual);
    assert.equal(residual.label, 'Plotted layout residual');
    // The saleable area is the gross less the statutory surrender, and the
    // rate is the developed-site rate. If either is wrong the anchor lands in
    // a different order of magnitude — which is exactly what a FAR-envelope
    // residual did on this same site.
    assert.ok(
      residual.mid > identity.plotAreaSqm * 1000,
      `plotted residual ${residual.mid} is implausibly low for a ${identity.plotAreaSqm} sqm site`,
    );
  });

  it('states that the surrender ratio is a norm, not a measurement', () => {
    const { result } = screenSeed(SITE, { project: plottedBrief });
    const residual = result.anchors.find(a => a.method === 'residual_development');
    assert.match(residual!.rationale, /not measurements from an approved layout plan/);
  });

  it('prices the buildable envelope, not the zoning envelope, when the road caps the FAR', () => {
    const apartmentBrief: ProjectBrief = {
      kind: 'apartment_project',
      source: 'user',
      intent: 'buy_and_build',
      inference: { kind: 'apartment_project', confidence: 1, basis: ['stated'], alternatives: [] },
      decidedAt: NOW,
    };
    const seed = seedFor(SITE);
    // Big enough to carry a scheme, on a road narrow enough that the FAR band
    // binds below the zone's ratio — the ordinary Bengaluru case, and the one
    // where valuing the zoning envelope overstates the land by the whole
    // difference.
    const narrow = screenSeed(SITE, {
      project: apartmentBrief,
      identity: { plotAreaSqm: 8100, plot: { ...seed.identity.plot!, roadWidthFt: 30 } },
    });
    const y = narrow.result.yield;
    assert.ok(y, 'an apartment project on a site this size must produce a yield');
    assert.equal(y.bindingConstraint, 'road_width', 'a 30ft road should cap the FAR below the zoning ratio');

    const residual = narrow.result.anchors.find(a => a.method === 'residual_development');
    assert.ok(residual?.residual, 'the residual must carry its breakdown');
    // The saleable area the residual prices has to trace back to the FAR area
    // the yield says is achievable — not to plot area x the zoning FAR, which
    // is the envelope planning permission forbids.
    const impliedFarAreaSqm = residual.residual.areaSqm / 1.25;
    assert.ok(
      Math.abs(impliedFarAreaSqm - y.achievableFarAreaSqm) < y.achievableFarAreaSqm * 0.02,
      `residual prices ${Math.round(impliedFarAreaSqm)} sqm of FAR area but only ${y.achievableFarAreaSqm} sqm is buildable`,
    );
    assert.ok(
      impliedFarAreaSqm < 8100 * y.farFromZoning * 0.99,
      'the residual is still valuing the uncapped zoning envelope',
    );
    assert.match(residual.rationale, /cannot be built/);
  });

  it('leaves the envelope alone when nothing caps it', () => {
    const apartmentBrief: ProjectBrief = {
      kind: 'apartment_project',
      source: 'user',
      intent: 'buy_and_build',
      inference: { kind: 'apartment_project', confidence: 1, basis: ['stated'], alternatives: [] },
      decidedAt: NOW,
    };
    const seed = seedFor(SITE);
    const wide = screenSeed(SITE, {
      project: apartmentBrief,
      identity: { plotAreaSqm: 8100, plot: { ...seed.identity.plot!, roadWidthFt: 100 } },
    });
    const residual = wide.result.anchors.find(a => a.method === 'residual_development');
    assert.ok(residual?.residual);
    // A cap that fires when nothing binds would quietly shrink every residual
    // in the product, which is the failure mode a one-sided test misses.
    assert.doesNotMatch(residual.rationale, /cannot be built/);
  });

  it('nets demolition off a redevelopment residual', () => {
    const redevelopBrief: ProjectBrief = {
      kind: 'redevelopment',
      source: 'user',
      intent: 'redevelop_existing',
      inference: { kind: 'redevelopment', confidence: 1, basis: ['stated'], alternatives: [] },
      decidedAt: NOW,
    };
    const { result } = screenSeed(OFFICE, { project: redevelopBrief });
    const residual = result.anchors.find(a => a.method === 'residual_development');
    // The office seed may have no FAR headroom, in which case no residual is
    // produced at all — which is the correct outcome, not a failure. Assert
    // only on the case where one exists.
    if (residual) assert.match(residual.rationale, /demolition and site clearance/);
  });
});

describe('a method that does not fit its subject says so', () => {
  it('cautions against subdividing a site too small to subdivide', () => {
    const seed = seedFor(SITE);
    const caution = assessmentFitCaution(seed.identity, 'plotted_development');
    assert.ok(caution, `a ${seed.identity.plotAreaSqm} sqm site cannot be cut into a layout`);
    assert.match(caution!, /hypothetical/);
  });

  it('cautions against redeveloping a bare site', () => {
    const seed = seedFor(SITE);
    assert.ok(assessmentFitCaution(seed.identity, 'redevelopment'));
  });

  it('stays quiet when the method fits', () => {
    assert.equal(assessmentFitCaution(seedFor(SITE).identity, 'land_acquisition'), undefined);
    assert.equal(assessmentFitCaution(seedFor(APARTMENT).identity, 'built_asset_purchase'), undefined);
  });

  it('carries the caution onto the brief the engine resolves', () => {
    const seed = seedFor(SITE);
    const brief = resolveProjectBrief(seed.identity, NOW, {
      kind: 'plotted_development',
      source: 'user',
      intent: 'subdivide_and_sell',
      inference: { kind: 'plotted_development', confidence: 1, basis: ['stated'], alternatives: [] },
      decidedAt: NOW,
    });
    assert.ok(brief.fitCaution, 'a user-set kind still gets checked against the subject');
  });
});

describe('the residual measures each side against the right area', () => {
  it('sells saleable area and builds constructed area, not FAR area', () => {
    const { result } = screenSeed(SITE, {
      project: {
        kind: 'apartment_project',
        source: 'user',
        intent: 'buy_and_build',
        inference: { kind: 'apartment_project', confidence: 1, basis: ['stated'], alternatives: [] },
        decidedAt: NOW,
      },
      // A site big enough that the FAR headroom clears the 'moderate' bar.
      identity: { plotAreaSqm: 4000 },
    });
    const residual = result.anchors.find(a => a.method === 'residual_development');
    assert.ok(residual, 'an apartment scheme on 4,000 sqm should produce a residual');
    // Asserted against the structured steps rather than the sentence: the
    // three areas are data now, and the sentence is the part a chart cannot
    // say. The gross step is priced on saleable area, the construction step
    // on constructed area, and neither equals the FAR area they came from.
    const breakdown = residual.residual;
    assert.ok(breakdown, 'a residual carries its arithmetic');
    const gross = breakdown.steps.find(s => s.key === 'gross');
    const construction = breakdown.steps.find(s => s.key === 'construction');
    assert.ok(gross && construction);
    const saleable = Number((gross.note.match(/([\d,]+) sqm saleable/) ?? [])[1]?.replace(/,/g, ''));
    const constructed = Number((construction.note.match(/([\d,]+) sqm constructed/) ?? [])[1]?.replace(/,/g, ''));
    assert.ok(saleable > 0 && constructed > 0, 'both areas are stated');
    assert.notEqual(saleable, constructed, 'saleable and constructed are not the same quantity');
    assert.equal(breakdown.areaBasis, 'saleable super built-up area');
  });

  it('nets the steps to the residual it reports', () => {
    // The waterfall has to add up, or the chart draws a shape the number
    // does not agree with.
    const { result } = screenSeed(SITE, {
      project: {
        kind: 'apartment_project',
        source: 'user',
        intent: 'buy_and_build',
        inference: { kind: 'apartment_project', confidence: 1, basis: ['stated'], alternatives: [] },
        decidedAt: NOW,
      },
      identity: { plotAreaSqm: 4000 },
    });
    const breakdown = result.anchors.find(a => a.method === 'residual_development')?.residual;
    assert.ok(breakdown);
    const running = breakdown.steps.filter(s => s.kind !== 'result').reduce((sum, s) => sum + s.amount, 0);
    const stated = breakdown.steps.find(s => s.kind === 'result')?.amount ?? 0;
    assert.ok(Math.abs(running - stated) <= Math.max(2, Math.abs(stated) * 0.001), `steps net to ${running}, result says ${stated}`);
  });

  it('states the ratios as conventions rather than measurements', () => {
    const { result } = screenSeed(SITE, {
      project: {
        kind: 'apartment_project',
        source: 'user',
        intent: 'buy_and_build',
        inference: { kind: 'apartment_project', confidence: 1, basis: ['stated'], alternatives: [] },
        decidedAt: NOW,
      },
      identity: { plotAreaSqm: 4000 },
    });
    const residual = result.anchors.find(a => a.method === 'residual_development');
    assert.match(residual!.rationale, /not figures measured from a plan/);
  });
});
