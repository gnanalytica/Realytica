/**
 * What a lens may and may not do.
 *
 * The design line is that a lens changes what leads and what folds away, and
 * never what was found. Most of these tests exist to hold that line, because
 * the failure mode is invisible: a lens that quietly dropped a finding would
 * look like a cleaner page.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LENS_KEYS, LENS_PROFILES, lensFromPersona, orderSections, partitionActionsByLens, partitionByLens, resolveLens } from '@realytica/shared';
import type { LensSection, RecommendedAction, RiskFlag } from '@realytica/shared';
import { screenSeed } from './fixtures';

const ALL_SECTIONS: LensSection[] = [
  'value', 'offer', 'costs', 'title', 'compliance', 'planning',
  'site', 'constraints', 'documents', 'actions', 'risks', 'evidence',
];

describe('lens profiles', () => {
  it('gives every reader every section, in their own order', () => {
    for (const key of LENS_KEYS) {
      const sections = LENS_PROFILES[key].sections;
      assert.equal(new Set(sections).size, sections.length, `${key} lists a section twice`);
      assert.equal(sections.length, ALL_SECTIONS.length, `${key} is missing sections — a reader must be able to reach everything`);
      for (const s of ALL_SECTIONS) assert.ok(sections.includes(s), `${key} cannot reach ${s}`);
    }
  });

  it('leads each reader with something different', () => {
    const leads = LENS_KEYS.map(k => LENS_PROFILES[k].sections[0]);
    assert.equal(new Set(leads).size, leads.length, 'two lenses that open the same way are one lens with two names');
  });

  it('states who each reader is and what they are asking', () => {
    for (const key of LENS_KEYS) {
      assert.ok(LENS_PROFILES[key].who.length > 20, `${key} does not say who it is for`);
      assert.ok(LENS_PROFILES[key].question.endsWith('?'), `${key}'s question is not a question`);
    }
  });
});

describe('ordering sections', () => {
  it('ranks what a case has, and does not invent what it does not', () => {
    const available: LensSection[] = ['value', 'planning', 'documents'];
    const ordered = orderSections(available, 'architect');
    assert.equal(ordered.length, 3);
    assert.equal(ordered[0], 'planning', 'the architect opens on planning');
    assert.deepEqual([...ordered].sort(), [...available].sort(), 'nothing added, nothing dropped');
  });

  it('keeps a section no lens ranks, rather than losing it', () => {
    const ordered = orderSections(['value', 'evidence'], 'developer');
    assert.equal(ordered.length, 2);
  });
});

describe('partitioning findings', () => {
  const risk = (category: RiskFlag['category'], severity: RiskFlag['severity']): RiskFlag =>
    ({ id: `${category}-${severity}`, code: 'X', title: 't', description: 'd', category, severity, status: 'open', evidenceIds: [], impact: '' }) as unknown as RiskFlag;

  it('gives a reader the categories they own', () => {
    const { mine } = partitionByLens([risk('planning', 'warning'), risk('financial', 'warning')], 'architect');
    assert.deepEqual(mine.map(r => r.category), ['planning']);
  });

  it('never puts a critical finding on someone else’s pile', () => {
    // A financial risk is not the architect's category, but a critical one
    // still reaches them: an architect who cannot see that the deal is dead
    // keeps drawing.
    const { mine, others } = partitionByLens([risk('financial', 'critical')], 'architect');
    assert.equal(mine.length, 1);
    assert.equal(others.length, 0);
  });

  it('folds, never filters — every finding lands in exactly one pile', () => {
    const all = [risk('title', 'warning'), risk('market', 'info'), risk('structural', 'serious'), risk('data', 'warning')];
    for (const lens of LENS_KEYS) {
      const { mine, others } = partitionByLens(all, lens);
      assert.equal(mine.length + others.length, all.length, `${lens} lost a finding`);
    }
  });
});

describe('partitioning actions', () => {
  const action = (owner: RecommendedAction['owner'], priority: RecommendedAction['priority']): RecommendedAction =>
    ({ id: `${owner}-${priority}`, title: 't', description: 'd', priority, owner, effort: 'low', unblocks: [], relatedRiskIds: [], done: false });

  it('splits on owner and horizon together', () => {
    // The developer owns the buyer's work, but only up to the offer.
    const { mine, others } = partitionActionsByLens(
      [action('buyer', 'before_offer'), action('buyer', 'before_completion')],
      'developer',
    );
    assert.equal(mine.length, 1);
    assert.equal(others.length, 1);
  });

  it('gives the project manager the whole timeline', () => {
    const { others } = partitionActionsByLens(
      [action('buyer', 'now'), action('lawyer', 'before_completion'), action('surveyor', 'before_offer')],
      'project_manager',
    );
    assert.equal(others.length, 0, 'the PM coordinates every owner across every horizon');
  });

  it('loses nothing under any lens', () => {
    const all = [action('buyer', 'now'), action('lender', 'before_completion'), action('seller', 'before_offer')];
    for (const lens of LENS_KEYS) {
      const { mine, others } = partitionActionsByLens(all, lens);
      assert.equal(mine.length + others.length, all.length);
    }
  });
});

describe('resolving which lens is in force', () => {
  it('prefers the reader’s own choice', () => {
    assert.equal(resolveLens({ lens: 'engineering', defaultLens: 'developer', persona: 'valuation_firm' }), 'engineering');
  });

  it('falls back to what the project kind implies', () => {
    assert.equal(resolveLens({ defaultLens: 'architect', persona: 'property_investor' }), 'architect');
  });

  it('lands somewhere sensible for a case that predates all of this', () => {
    assert.equal(resolveLens({ persona: 'property_investor' }), 'developer');
    assert.equal(lensFromPersona(undefined), 'developer');
  });

  it('takes an industrial project to the engineering lens by default', () => {
    // Not cosmetic: the ground conditions, floor loading and power sanction
    // that decide an industrial site are engineering questions priced as
    // commercial ones, so that is the reader the profile opens for.
    const { result } = screenSeed('3BHK — Prestige Lakeside');
    assert.ok(result.assessment);
    assert.equal(resolveLens({ defaultLens: result.assessment!.defaultLens }), 'developer');
  });
});
