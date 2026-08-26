/**
 * What a sweep is allowed to look for, before any model runs.
 *
 * The whole plan is deterministic on purpose, so these tests exercise the
 * real thing rather than a stand-in — and the properties they hold are the
 * ones that make an empty findings list mean something.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCOVERY_PLAN, REFERENCE_DATA, fillQuery, planDiscovery, projectNameFrom } from '@realytica/shared';
import { runPropertyDiscovery } from '@realytica/agents';
import { NOW, caseFrom, documentsFor, seedFor } from './fixtures';

const site = () => seedFor('Site No. 42').identity;
const flat = () => seedFor('3BHK — Prestige Lakeside').identity;

describe('the plan', () => {
  it('orders the deal-stopping records before the informational ones', () => {
    const kinds = DISCOVERY_PLAN.map(p => p.kind);
    assert.ok(kinds.indexOf('litigation') < kinds.indexOf('listing'));
    assert.ok(kinds.indexOf('planning_notification') < kinds.indexOf('news'));
  });

  it('states what goes unchecked for every record kind', () => {
    for (const item of DISCOVERY_PLAN) {
      assert.ok(item.consequence.length > 40, `${item.kind} does not say what is at stake`);
      assert.ok(item.answers.endsWith('?'), `${item.kind}'s question is not a question`);
      assert.ok(item.queryTemplates.length > 0);
    }
  });
});

describe('what each disclosure level permits', () => {
  it('gates the parcel-specific records at locality level', () => {
    const plan = planDiscovery(site(), 'locality_only');
    const gatedKinds = plan.gated.map(g => g.kind);
    assert.ok(gatedKinds.includes('litigation'), 'a court listing cannot be found without the survey number');
    assert.ok(gatedKinds.includes('planning_notification'));
    assert.ok(gatedKinds.includes('rera_registration'));
    // The two that only need a locality still run, so the level is not useless.
    assert.ok(plan.searchable.some(s => s.item.kind === 'news'));
    assert.ok(plan.searchable.some(s => s.item.kind === 'listing'));
  });

  it('opens the parcel records at property_identifiers', () => {
    const plan = planDiscovery(site(), 'property_identifiers');
    const kinds = plan.searchable.map(s => s.item.kind);
    assert.ok(kinds.includes('litigation'));
    assert.ok(kinds.includes('planning_notification'));
    // The address-only record is still gated.
    assert.ok(plan.gated.some(g => g.kind === 'municipal_notice'));
  });

  it('opens the municipal record only at full_address', () => {
    const withAddress = { ...site(), addressLine: '14 Sri Ranga Layout Main Road' };
    const plan = planDiscovery(withAddress, 'full_address');
    assert.ok(plan.searchable.some(s => s.item.kind === 'municipal_notice'));
    assert.equal(plan.gated.length, 0, 'nothing is gated at the widest level');
  });

  it('says what each gated kind needs, and what it costs to leave it', () => {
    for (const gate of planDiscovery(site(), 'locality_only').gated) {
      assert.ok(gate.needs);
      assert.ok(gate.consequence.length > 40);
    }
  });
});

describe('a missing identifier is a different problem from a gated one', () => {
  it('does not blame disclosure for a survey number the case lacks', () => {
    const noParcel = { ...site(), parcelId: '' };
    const plan = planDiscovery(noParcel, 'property_identifiers');
    // Widening disclosure will not fix this, and the plan must not imply it would.
    assert.ok(plan.missingIdentifiers.some(m => m.kind === 'litigation'));
    assert.ok(plan.missingIdentifiers.some(m => /survey number/.test(m.needs)));
    assert.ok(!plan.gated.some(g => g.kind === 'litigation'), 'this is not a disclosure problem');
  });

  it('never builds a query with an empty placeholder', () => {
    // The failure this guards: a query built around a blank project name
    // searches for the locality and reports the result as if it were about
    // the project.
    assert.equal(fillQuery('K-RERA "{projectName}" {locality}', { locality: 'Whitefield' }), undefined);
    assert.equal(
      fillQuery('K-RERA "{projectName}" {locality}', { projectName: 'Prestige Lakeside Habitat', locality: 'Whitefield' }),
      'K-RERA "Prestige Lakeside Habitat" Whitefield',
    );
  });
});

describe('deriving a project name', () => {
  it('pulls it out of the label a person wrote', () => {
    assert.equal(projectNameFrom(flat()), 'Prestige Lakeside Habitat');
  });

  it('returns nothing rather than a guess when there is no project in the label', () => {
    assert.equal(projectNameFrom({ ...flat(), label: 'Whitefield' }), undefined);
    assert.equal(projectNameFrom({ ...flat(), label: '' }), undefined);
    assert.equal(projectNameFrom({ ...flat(), label: '3BHK — , Whitefield' }), undefined);
  });
});

describe('the sweep degrades honestly with no model', () => {
  it('still returns the plan, the gates and the unreachable registries', async () => {
    // No credentials are configured in the test environment, so this exercises
    // the path a deployment without a key actually takes. It must not be an
    // empty result: what would have been searched for, and what is going
    // unchecked, is a real answer about the case's blind spots.
    const seed = seedFor('Site No. 42');
    const documents = documentsFor(seed.identity, seed.identity.label);
    const caseData = { ...caseFrom(seed.identity, documents), disclosure: 'property_identifiers' as const };
    const { run, sweep } = await runPropertyDiscovery({
      caseId: caseData.id,
      caseData,
      refData: REFERENCE_DATA,
      now: NOW,
    });

    assert.notEqual(run.status, 'succeeded', 'nothing can succeed without a model');
    assert.ok(sweep.planOnlyReason, 'and the sweep must say why it only planned');
    assert.deepEqual(sweep.findings, [], 'no findings may be invented on this path');
    assert.equal(sweep.queriesRun.length, 0, 'nothing left the system');
    assert.ok(sweep.unreachable.length > 0, 'the registries a search cannot reach are still named');
    assert.ok(
      sweep.unreachable.some(u => /encumbrance|Kaveri|registration/i.test(`${u.label} ${u.whatItWouldHaveAnswered}`)),
      'including the encumbrance record, which is the one that would settle half of this',
    );
  });

  it('records the disclosure level it ran at', async () => {
    const seed = seedFor('Site No. 42');
    const caseData = caseFrom(seed.identity, documentsFor(seed.identity, seed.identity.label));
    const { sweep } = await runPropertyDiscovery({ caseId: caseData.id, caseData, refData: REFERENCE_DATA, now: NOW });
    assert.equal(sweep.disclosure, 'locality_only', 'an unset level resolves to the narrowest');
  });

  it('cancels rather than searching when the level leaves nothing searchable', async () => {
    // Strip the identifiers a locality-level sweep would still use.
    const seed = seedFor('Site No. 42');
    const identity = { ...seed.identity, locality: '' };
    const caseData = caseFrom(identity, []);
    const { run, sweep } = await runPropertyDiscovery({ caseId: caseData.id, caseData, refData: REFERENCE_DATA, now: NOW });
    assert.equal(run.status, 'cancelled');
    assert.match(sweep.planOnlyReason ?? '', /Nothing can be searched for/);
  });
});
