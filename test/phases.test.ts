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
    assert.equal(phaseAt(p, T(5)), 'opportunity');
    assert.equal(phaseAt(p, T(10)), 'acquisition', 'a change takes effect at its own moment');
    assert.equal(phaseAt(p, T(25)), 'design');
    assert.equal(phaseAt(p, T(40)), 'acquisition');
  });

  it('counts every time the project was in a phase', () => {
    const p = journey();
    assert.deepEqual(phaseSpans(p, 'acquisition'), [{ from: T(10), to: T(20) }, { from: T(30) }]);
    assert.deepEqual(phaseSpans(p, 'handover'), [], 'never reached');
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

    const acquisition = phaseRecord(p, 'acquisition');
    assert.deepEqual(acquisition.assessments.map((a) => a.title), ['Acquisition']);
    assert.deepEqual(acquisition.findings.map((f) => f.title), ['Khata in a predecessor name']);
    assert.equal(acquisition.actions.length, 0, 'the action was raised during design');
    assert.equal(acquisition.label, 'Acquisition');

    assert.deepEqual(phaseRecord(p, 'opportunity').findings.map((f) => f.title), ['Encroachment on the east boundary']);
    assert.deepEqual(phaseRecord(p, 'design').actions.map((a) => a.title), ['Chase the corrected khata']);
    assert.equal(phaseCount(phaseRecord(p, 'handover')), 0);
  });
});
