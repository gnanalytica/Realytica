/**
 * A project that starts under construction is not at risk for approvals
 * nobody entered.
 *
 * A project of the shape a rehearsal used: created at its fourth running
 * bill, with a schedule and site entries and no approval ever recorded. It
 * raises no alert about approvals and its health is not red for them. The
 * rule is not weakened where approvals are recorded: one approval on file, or
 * one recorded as not obtained, and the others needed are missing and work
 * logged without them is the critical alert it always was.
 *
 * Every project, paper, date and person is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, addMilestones, alertConditions, approvalsRegister, approvalsStanding, constructionGate, createProject, deriveHealth, logSiteEntry, patchProject, quickAssessment, syncAlerts, type DdProject } from '@realytica/shared';

const PM = 'pm@example.com';
const NOW = new Date('2026-10-12T06:00:00.000Z');

/** Under construction, with a milestone and a day logged from site, and nothing recorded of its approvals. */
function building(): DdProject {
  const p = createProject({ name: 'Hillview Residences', type: 'residential', location: 'Hillview Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-RA1', PM);
  const [m] = addMilestones(p, [{ name: 'Superstructure', weight: 30, plannedFinish: '2027-03-31' }], PM);
  logSiteEntry(p, { clientId: 'phone-1', date: '2026-10-10', workDone: 'Third floor slab poured', milestoneUpdates: [{ milestoneId: m!.id, percent: 40 }] }, 'site@example.com');
  return p;
}

function approval(p: DdProject, documentType: string, facts: Array<[string, string]>, status: 'received' | 'missing' = 'received') {
  const row = addEvidence(p, { title: documentType, kind: 'approval', status }, PM);
  row.documentType = documentType;
  if (status === 'received') row.attachments.push({ id: `att_${row.id}`, fileName: `${documentType}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: NOW.toISOString() });
  row.facts = facts.map(([key, value]) => ({ key, label: key, value, display: value, page: 1, quote: value }));
  return row;
}

const approvalAlerts = (p: DdProject) => alertConditions(p, NOW).filter((c) => /^(approval|gate):/.test(c.key));

describe('approvals nobody has recorded', () => {
  it('are not recorded, not missing: no alert, no closed gate, no red health', () => {
    const p = building();
    assert.equal(approvalsStanding(p), 'not_recorded');
    const register = approvalsRegister(p, NOW);
    assert.deepEqual(register.filter((line) => line.status === 'missing'), []);
    assert.ok(register.some((line) => line.status === 'not_recorded' && line.say === 'Approvals are not recorded yet.'));
    assert.deepEqual(constructionGate(p, NOW), { open: true, missing: [], unrecorded: true });
    assert.deepEqual(approvalAlerts(p), []);
    syncAlerts(p, NOW);
    assert.notEqual(deriveHealth(p), 'red');
    assert.ok(!quickAssessment(p, 'construction.progress').points.some((point) => /logged without/.test(point.text)));
  });

  it('can be said to be held elsewhere, by a person, and said otherwise again', () => {
    const p = building();
    patchProject(p, { approvalsElsewhere: true }, PM);
    assert.equal(approvalsStanding(p), 'elsewhere');
    assert.equal(p.approvalsElsewhere!.by, PM);
    assert.ok(approvalsRegister(p, NOW).some((line) => line.say === 'Held outside this record.'));
    assert.deepEqual(approvalAlerts(p), []);
    patchProject(p, { approvalsElsewhere: false }, PM);
    assert.equal(approvalsStanding(p), 'not_recorded');
  });
});

describe('the rule where approvals are recorded', () => {
  it('holds as it did once one approval is on file: the others needed are missing and work without them is critical', () => {
    const p = building();
    approval(p, 'RERA registration certificate', [['rera_approved_on', '2025-01-10']]);
    assert.equal(approvalsStanding(p), 'recorded');
    assert.equal(approvalsRegister(p, NOW).find((line) => line.kind.key === 'commencement')!.status, 'missing');
    assert.deepEqual(constructionGate(p, NOW), { open: false, missing: ['Building plan sanction', 'Commencement certificate'] });
    const raised = approvalAlerts(p);
    assert.ok(raised.some((c) => c.key === 'gate:construction' && c.severity === 'critical'));
    assert.ok(raised.some((c) => c.key === 'approval:commencement:missing'));
    syncAlerts(p, NOW);
    assert.equal(deriveHealth(p), 'red');
  });

  it('holds against an approval recorded as not obtained, with nothing else on file', () => {
    const p = building();
    approval(p, 'Commencement certificate', [], 'missing');
    assert.equal(approvalsStanding(p), 'recorded');
    const line = approvalsRegister(p, NOW).find((held) => held.kind.key === 'commencement')!;
    assert.deepEqual([line.status, line.say], ['missing', 'Recorded as not obtained.']);
    assert.ok(approvalAlerts(p).some((c) => c.key === 'gate:construction'));
  });

  it('holds against a lapsed approval, and saying they are held elsewhere does not switch it off', () => {
    const p = building();
    approval(p, 'Sanctioned building plan', [['sanction_date', '2020-01-10'], ['valid_until', '2025-01-10']]);
    patchProject(p, { approvalsElsewhere: true }, PM);
    assert.equal(approvalsStanding(p), 'recorded', 'what is recorded is read, whatever was said before');
    assert.equal(constructionGate(p, NOW).open, false);
    assert.ok(approvalAlerts(p).some((c) => c.key.startsWith('approval:plan_sanction:expired')));
  });
});
