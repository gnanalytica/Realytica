/**
 * Looking back by phase.
 *
 * Changing stage hides nothing, and until now nothing said which phase a
 * record belonged to either, so "what did we do during Acquisition?" had no
 * answer short of reading dates. The phase is read from when a record
 * happened and the stage history, so records written before this existed
 * are placed as well as new ones.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addAction,
  addFinding,
  changeStage,
  createAssessment,
  createProject,
  phaseAt,
  phaseCount,
  phaseRecord,
  phaseSpans,
  type DdProject,
} from '@realytica/shared';

const T = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();

/** A file that went opportunity → acquisition → design → back to acquisition, on known days. */
function journey(): DdProject {
  const p = createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');
  p.stageHistory[0]!.effectiveAt = T(1);
  p.createdAt = T(1);
  changeStage(p, { subject: 'project', stage: 'acquisition', reason: 'LOI signed' }, 'tester');
  p.stageHistory.at(-1)!.effectiveAt = T(10);
  changeStage(p, { subject: 'project', stage: 'design', reason: 'Bought' }, 'tester');
  p.stageHistory.at(-1)!.effectiveAt = T(20);
  changeStage(p, { subject: 'project', stage: 'acquisition', reason: 'Adjacent plot' }, 'tester');
  p.stageHistory.at(-1)!.effectiveAt = T(30);
  return p;
}

describe('the phase of a moment', () => {
  it('is the stage the project was in then', () => {
    const p = journey();
    assert.equal(phaseAt(p, T(5)), 'opportunity_site');
    assert.equal(phaseAt(p, T(10)), 'acquisition', 'a change takes effect at its own moment');
    assert.equal(phaseAt(p, T(25)), 'design');
    assert.equal(phaseAt(p, T(40)), 'acquisition');
  });

  it('counts every time the project was in a phase', () => {
    const p = journey();
    assert.deepEqual(phaseSpans(p, { kind: 'step', key: 'acquisition' }), [{ from: T(10), to: T(20) }, { from: T(30) }]);
    assert.deepEqual(phaseSpans(p, { kind: 'step', key: 'handover' }), [], 'never reached');
    assert.deepEqual(phaseSpans(p, { kind: 'stage', key: 'pre_development' }), [{ from: T(1), to: T(20) }, { from: T(30) }], 'opportunity and acquisition are one stage');
  });
});

describe('what happened in a phase', () => {
  it('collects the records made while the project was in it, from both spans', () => {
    const p = journey();
    const dd = createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    dd.createdAt = T(12);
    const early = addFinding(p, { title: 'Encroachment on the east boundary', description: 'Seen on the walk.', severity: 'high', discipline: 'land_site', status: 'open' }, 'tester');
    early.createdAt = T(3);
    const later = addFinding(p, { title: 'Khata in a predecessor name', description: 'Khata not transferred.', severity: 'medium', discipline: 'legal', status: 'open' }, 'tester');
    later.createdAt = T(31);
    const action = addAction(p, { title: 'Chase the corrected khata', kind: 'evidence_request', owner: 'tester', priority: 'medium' }, 'tester');
    action.createdAt = T(22);

    const acquisition = phaseRecord(p, { kind: 'step', key: 'acquisition' });
    assert.deepEqual(acquisition.assessments.map((a) => a.title), ['Acquisition']);
    assert.deepEqual(acquisition.findings.map((f) => f.title), ['Khata in a predecessor name']);
    assert.equal(acquisition.actions.length, 0, 'the action was raised during design');
    assert.equal(acquisition.label, 'Acquisition');

    assert.deepEqual(phaseRecord(p, { kind: 'step', key: 'opportunity_site' }).findings.map((f) => f.title), ['Encroachment on the east boundary']);
    assert.deepEqual(phaseRecord(p, { kind: 'step', key: 'design' }).actions.map((a) => a.title), ['Chase the corrected khata']);
    assert.equal(phaseCount(phaseRecord(p, { kind: 'step', key: 'handover' })), 0);
    const pre = phaseRecord(p, { kind: 'stage', key: 'pre_development' });
    assert.deepEqual(pre.findings.map((f) => f.title).sort(), ['Encroachment on the east boundary', 'Khata in a predecessor name'], 'the whole stage holds both steps');
    assert.equal(pre.label, 'Pre-development');
  });
});
