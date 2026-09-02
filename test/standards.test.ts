/**
 * The words this product borrowed, and what it owes for them.
 *
 * Every mapping in `standards.ts` exists because the codebase was deciding for
 * itself something a standards body had already settled. The tests that matter
 * here are therefore not "does the function return a number" — they are the
 * three properties that make borrowing a published vocabulary honest rather
 * than decorative:
 *
 * 1. **Derived, never stored.** A rating computed from severity cannot drift
 *    from it. A second recorded grading always can, and the one that drifts is
 *    always the one a client reads.
 * 2. **The caveat travels with the word.** ASTM's REC taxonomy is the
 *    vocabulary a lender expects and is anchored to a US liability regime India
 *    has no analogue for. Borrowing the words while implying the protection
 *    would be worse than never mentioning them.
 * 3. **A gap is stated, not smoothed over.** An unrecognised area basis is
 *    undefined, an unpriced action is counted separately from a priced one, and
 *    an unknown part of a document reference becomes a visible placeholder.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENVIRONMENTAL_CONDITION_CAVEAT,
  REMEDIAL_BANDS,
  addAction,
  addFinding,
  areaBasisIsUndefined,
  areaBasisNote,
  classifyFinding,
  conditionRatings,
  createProject,
  escalatedFindings,
  iso19650Completeness,
  iso19650Name,
  looksLikeUniclassCode,
  normaliseAreaBasis,
  remedialCostSummary,
  ricsConditionRating,
  setActionCost,
  type DdProject,
} from '@realytica/shared';

function file(): DdProject {
  return createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-S1');
}

describe('the traffic light is derived from the severity, not kept beside it', () => {
  it('maps four severities onto the three gradings a TDD reader knows', () => {
    assert.equal(ricsConditionRating('critical'), 3);
    assert.equal(ricsConditionRating('high'), 3);
    assert.equal(ricsConditionRating('medium'), 2);
    assert.equal(ricsConditionRating('low'), 1);
  });

  it('cannot drift, because changing the severity moves the rating with it', () => {
    // The whole argument for deriving rather than storing, in one assertion.
    const project = file();
    const finding = addFinding(project, { title: 'Slab crack', description: 'Through-thickness at grid C4.', severity: 'low', discipline: 'technical' });
    assert.equal(conditionRatings(project).find((r) => r.rating === 1)!.count, 1);
    finding.severity = 'critical';
    assert.equal(conditionRatings(project).find((r) => r.rating === 3)!.count, 1);
    assert.equal(conditionRatings(project).find((r) => r.rating === 1)!.count, 0);
  });

  it('leaves closed findings out unless asked for them', () => {
    const project = file();
    const finding = addFinding(project, { title: 'Old', description: 'Fixed.', severity: 'high', discipline: 'technical' });
    finding.status = 'closed';
    assert.equal(conditionRatings(project).find((r) => r.rating === 3)!.count, 0);
    assert.equal(conditionRatings(project, { openOnly: false }).find((r) => r.rating === 3)!.count, 1);
  });
});

describe('dangerous is a separate question from serious', () => {
  it('keeps the escalation off the severity scale entirely', () => {
    // A rating of 3 says the defect is serious. It does not say somebody could
    // be hurt today, and no fifth severity could say both.
    const project = file();
    const serious = addFinding(project, { title: 'Facade', description: 'Spalling at high level.', severity: 'critical', discipline: 'technical' });
    assert.deepEqual(escalatedFindings(project), [], 'critical is not the same as escalated');

    classifyFinding(project, serious.id, { escalation: { immediateAction: true, notifiedTo: 'Site manager', notifiedAt: '2026-09-01' } });
    assert.equal(escalatedFindings(project).length, 1);
    assert.equal(escalatedFindings(project)[0]!.escalation!.notifiedTo, 'Site manager');
  });

  it('lets an escalation be cleared without touching the severity', () => {
    const project = file();
    const f = addFinding(project, { title: 'Lift', description: 'Out of service.', severity: 'medium', discipline: 'technical' });
    classifyFinding(project, f.id, { escalation: { immediateAction: true } });
    classifyFinding(project, f.id, { escalation: null });
    assert.deepEqual(escalatedFindings(project), []);
    assert.equal(f.severity, 'medium');
  });
});

describe('the environmental class carries its caveat or it is not worth having', () => {
  it('says what the standard does not do, in the caveat itself', () => {
    // The load-bearing half. India has no CERCLA analogue, so an HREC here
    // records what was found and how it was resolved — not a protection.
    assert.match(ENVIRONMENTAL_CONDITION_CAVEAT, /CERCLA/);
    assert.match(ENVIRONMENTAL_CONDITION_CAVEAT, /India has no equivalent/);
  });

  it('is a finding taxonomy rather than a discipline, so any finding can carry it', () => {
    // Contamination surfaces under legal (an indemnity) and technical (a slab)
    // as often as under ESG. Gating the field on discipline would mean the
    // finding that most needs the word could not carry it.
    const project = file();
    const legal = addFinding(project, { title: 'Indemnity', description: 'Vendor indemnity for prior use.', severity: 'high', discipline: 'legal' });
    classifyFinding(project, legal.id, { environmentalCondition: 'crec' });
    assert.equal(project.findings[0]!.environmentalCondition, 'crec');
  });
});

describe('the cost table says what it does not know', () => {
  it('counts a banded action with no figure, and keeps it out of the total', () => {
    // The failure this guards: a total that reads as complete while half the
    // actions have never been priced.
    const project = file();
    const priced = addAction(project, { title: 'Repoint', kind: 'remediation', owner: 'QS', priority: 'high' });
    const unpriced = addAction(project, { title: 'Reroof', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, priced.id, { costEstimate: 400000, costBand: 'immediate' });
    setActionCost(project, unpriced.id, { costBand: 'immediate' });

    const summary = remedialCostSummary(project);
    const immediate = summary.rows.find((r) => r.band === 'immediate')!;
    assert.equal(immediate.count, 2);
    assert.equal(immediate.costed, 1);
    assert.equal(immediate.total, 400000);
    assert.equal(summary.total, 400000);
    assert.equal(summary.uncosted, 1, 'and the shortfall travels with the figure');
  });

  it('counts an unbanded action separately, since the table cannot speak for it', () => {
    const project = file();
    addAction(project, { title: 'Chase the OC', kind: 'evidence_request', owner: 'Legal', priority: 'medium' });
    const summary = remedialCostSummary(project);
    assert.equal(summary.unbanded, 1);
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.rows.map((r) => r.count), [0, 0, 0, 0]);
  });

  it('returns every band in time order, so the shape of the spend is readable', () => {
    // Immediate first is the message: that is the money that changes the price.
    assert.deepEqual(remedialCostSummary(file()).rows.map((r) => r.band), [...REMEDIAL_BANDS]);
  });

  it('refuses a negative remedy cost at the door', () => {
    const project = file();
    const a = addAction(project, { title: 'Repair', kind: 'remediation', owner: 'QS', priority: 'low' });
    assert.throws(() => setActionCost(project, a.id, { costEstimate: -1 }), /cannot be negative/);
  });

  it('leaves closed actions out of what still has to be spent', () => {
    const project = file();
    const done = addAction(project, { title: 'Done', kind: 'remediation', owner: 'QS', priority: 'low' });
    setActionCost(project, done.id, { costEstimate: 100000, costBand: 'year_1' });
    done.status = 'closed';
    assert.equal(remedialCostSummary(project).total, 0);
    assert.equal(remedialCostSummary(project, { openOnly: false }).total, 100000);
  });
});

describe('a stated area basis either has a definition or it does not', () => {
  it('treats only carpet as defined, because only carpet is', () => {
    // RERA s.2(k). "Super built-up" has no statutory definition at all, which
    // is exactly why RERA stopped apartments being sold on it.
    assert.equal(areaBasisIsUndefined('carpet'), false);
    assert.equal(areaBasisIsUndefined('built_up'), true);
    assert.equal(areaBasisIsUndefined('super_built_up'), true);
  });

  it('reads the same basis however it was spelled', () => {
    assert.equal(normaliseAreaBasis('Super Built-Up'), 'super_built_up');
    assert.equal(areaBasisIsUndefined('super built-up'), true, 'the radio spelling');
    assert.equal(areaBasisIsUndefined('Carpet'), false);
  });

  it('defaults an unrecognised basis to undefined rather than defined', () => {
    // The safe direction. A basis this table has never heard of is precisely
    // the case where the stated area means nothing verifiable, and defaulting
    // the other way would let a typo silence the one warning that matters.
    assert.equal(areaBasisIsUndefined('saleable'), true);
    assert.match(areaBasisNote('saleable'), /Nobody has recorded/);
  });

  it('says why, in words a valuer can act on', () => {
    assert.match(areaBasisNote('carpet'), /RERA s\.2\(k\)/);
    assert.match(areaBasisNote('super_built_up'), /seller’s discretion/);
  });
});

describe('a document reference names what it can and marks what it cannot', () => {
  it('names a fully known container', () => {
    assert.equal(
      iso19650Name('RYT-001', { originator: 'GNA', volume: 'ZZ', level: '00', type: 'DR', role: 'A', number: '0101' }),
      'RYT001-GNA-ZZ-00-DR-A-0101',
    );
  });

  it('uses the standard’s own placeholder for a part nobody recorded', () => {
    // A name with a gap in it cannot be parsed back into its fields, and being
    // parseable is the whole point of a naming convention.
    assert.equal(iso19650Name('RYT-001', { type: 'RP' }), 'RYT001-XX-XX-XX-RP-XX-0000');
    assert.equal(iso19650Name('RYT-001', undefined), 'RYT001-XX-XX-XX-XX-XX-0000');
  });

  it('reports its own completeness, so a pack can state its conformance', () => {
    assert.deepEqual(iso19650Completeness({ originator: 'GNA', type: 'DR' }), { known: 2, total: 6 });
    assert.deepEqual(iso19650Completeness({ originator: '  ' }), { known: 0, total: 6 }, 'whitespace is not a recorded value');
  });
});

describe('a classification suggests rather than refuses', () => {
  it('recognises the shape of a Uniclass code without owning the table', () => {
    assert.equal(looksLikeUniclassCode('En_20_20_53'), true);
    assert.equal(looksLikeUniclassCode('Ss_25_10'), true);
    assert.equal(looksLikeUniclassCode('office building'), false);
  });
});
