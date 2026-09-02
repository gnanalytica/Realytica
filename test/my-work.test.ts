/**
 * What is mine, and — the half that matters — what is not.
 *
 * The resolution rules here are deliberately narrow, and the reason is
 * asymmetric cost. A false negative is one row missing from a list somebody
 * can also reach through the registers. A false positive puts another person's
 * work on a screen whose entire promise is "this is yours", with nothing on it
 * to say the match was a guess. So the tests that matter are the ones that
 * assert a near miss stays out.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  myWorkOn,
  ownedBy,
  ownerSuggestions,
  seedDemoProject,
  sortWork,
  type DdProject,
  type WorkItem,
} from '@realytica/shared';

const ASHA = { email: 'asha@firm.in', name: 'Asha Rao' };
const NOW = '2026-09-02T00:00:00.000Z';

describe('whether an owner field names you', () => {
  it('matches the address, its local part, and the name as recorded', () => {
    assert.equal(ownedBy('asha@firm.in', ASHA), true);
    assert.equal(ownedBy('  ASHA@Firm.IN ', ASHA), true);
    assert.equal(ownedBy('asha', ASHA), true);
    assert.equal(ownedBy('Asha  Rao', ASHA), true);
  });

  it('does not match a first name that is not the whole name', () => {
    // A workspace with two Priyas is not unusual, and the failure would be
    // silent: one of them reads the other's work and has no way to know.
    assert.equal(ownedBy('Asha', { email: 'a@firm.in', name: 'Asha Rao' }), false);
    assert.equal(ownedBy('Asha R', ASHA), false);
    assert.equal(ownedBy('Asha Rao Jr', ASHA), false);
  });

  it('does not match somebody else with the same local part at another firm', () => {
    assert.equal(ownedBy('asha@other.in', ASHA), false);
  });

  it('treats an empty owner as nobody’s', () => {
    assert.equal(ownedBy(undefined, ASHA), false);
    assert.equal(ownedBy('   ', ASHA), false);
  });

  it('does not let a one-letter local part sweep up initials', () => {
    assert.equal(ownedBy('a', { email: 'a@firm.in' }), false);
  });
});

function withWork(over: (project: DdProject) => void): DdProject {
  const project = seedDemoProject();
  over(project);
  return project;
}

describe('what lands on the list', () => {
  it('collects across the registers, not just actions', () => {
    const project = withWork((p) => {
      p.actions[0]!.owner = 'asha@firm.in';
      p.actions[0]!.status = 'in_progress';
      p.findings[0]!.owner = 'Asha Rao';
      p.findings[0]!.status = 'open';
      p.evidence[0]!.owner = 'asha';
      p.evidence[0]!.status = 'expected';
    });
    const kinds = myWorkOn(project, ASHA, NOW).map((i) => i.kind);
    assert.ok(kinds.includes('action'));
    assert.ok(kinds.includes('finding'));
    assert.ok(kinds.includes('evidence'));
  });

  it('leaves out work that is finished, because that is not work', () => {
    const project = withWork((p) => {
      p.actions[0]!.owner = 'asha@firm.in';
      p.actions[0]!.status = 'closed';
      p.findings[0]!.owner = 'asha@firm.in';
      p.findings[0]!.status = 'closed';
      p.evidence[0]!.owner = 'asha@firm.in';
      p.evidence[0]!.status = 'validated';
    });
    assert.deepEqual(myWorkOn(project, ASHA, NOW), []);
  });

  it('leaves out everybody else’s', () => {
    const project = withWork((p) => {
      for (const a of p.actions) a.owner = 'somebody@else.in';
      for (const f of p.findings) f.owner = 'somebody@else.in';
    });
    assert.deepEqual(myWorkOn(project, ASHA, NOW), []);
  });

  it('says what the owner field actually said, so a near miss is visible', () => {
    const project = withWork((p) => {
      p.actions[0]!.owner = 'Asha Rao';
      p.actions[0]!.status = 'in_progress';
    });
    const [item] = myWorkOn(project, ASHA, NOW);
    assert.equal(item?.owner, 'Asha Rao');
  });

  it('marks a past due date late, whatever the status says', () => {
    const project = withWork((p) => {
      p.actions[0]!.owner = 'asha@firm.in';
      p.actions[0]!.status = 'in_progress';
      p.actions[0]!.dueDate = '2026-01-01T00:00:00.000Z';
    });
    assert.equal(myWorkOn(project, ASHA, NOW)[0]?.overdue, true);
  });

  it('carries the project on every row, because the list spans files', () => {
    const project = withWork((p) => {
      p.actions[0]!.owner = 'asha@firm.in';
      p.actions[0]!.status = 'in_progress';
    });
    const [item] = myWorkOn(project, ASHA, NOW);
    assert.equal(item?.projectId, project.id);
    assert.equal(item?.projectReference, project.reference);
  });

  it('finds work only in the project it is handed', () => {
    // The whole reason the API passes a projection: a collaborator's list is
    // safe with no access rule of its own, because a row outside their grant
    // is not in the copy this function reads.
    const whole = withWork((p) => {
      p.actions[0]!.owner = 'asha@firm.in';
      p.actions[0]!.status = 'in_progress';
    });
    const narrowed: DdProject = { ...whole, actions: [] };
    assert.equal(myWorkOn(whole, ASHA, NOW).length, 1);
    assert.equal(myWorkOn(narrowed, ASHA, NOW).length, 0);
  });
});

describe('the order it is read in', () => {
  const row = (over: Partial<WorkItem>): WorkItem => ({
    id: 'x',
    kind: 'action',
    title: 'x',
    projectId: 'p',
    projectName: 'P',
    projectReference: 'RYT-1',
    owner: 'asha@firm.in',
    status: 'in_progress',
    ...over,
  });

  it('puts what is late first, then what has a date, then what is severe', () => {
    const sorted = sortWork([
      row({ id: 'no-date', severity: 'low' }),
      row({ id: 'severe', severity: 'critical' }),
      row({ id: 'soon', dueDate: '2026-10-01' }),
      row({ id: 'late', dueDate: '2026-01-01', overdue: true }),
    ]);
    assert.deepEqual(sorted.map((i) => i.id), ['late', 'soon', 'severe', 'no-date']);
  });

  it('keeps a row with neither a date nor a severity rather than dropping it', () => {
    // "Somebody put my name on this and never said when" is a real state, and
    // hiding it is how it stays true.
    const sorted = sortWork([row({ id: 'orphan' })]);
    assert.deepEqual(sorted.map((i) => i.id), ['orphan']);
  });
});

describe('what to offer when somebody types an owner', () => {
  it('offers the names already on the file before the rest of the workspace', () => {
    const project = withWork((p) => {
      p.owner = 'Priya Shah';
      p.actions[0]!.owner = 'contractor@outside.in';
    });
    const offered = ownerSuggestions(project, [{ email: 'asha@firm.in', name: 'Asha Rao' }]);
    assert.ok(offered.indexOf('Priya Shah') < offered.indexOf('Asha Rao'));
    assert.ok(offered.includes('contractor@outside.in'));
  });

  it('offers each person once, however many rows they own', () => {
    const project = withWork((p) => {
      for (const a of p.actions) a.owner = 'Priya Shah';
      for (const f of p.findings) f.owner = 'priya shah';
    });
    const offered = ownerSuggestions(project, []);
    assert.equal(offered.filter((o) => o.toLowerCase() === 'priya shah').length, 1);
  });

  it('works with no project at all, for a file that does not exist yet', () => {
    assert.deepEqual(ownerSuggestions(undefined, [{ email: 'asha@firm.in' }]), ['asha@firm.in']);
  });
});
