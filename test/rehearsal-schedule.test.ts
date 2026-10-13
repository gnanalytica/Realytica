/**
 * The schedule cannot contradict itself, and a reading is placed at the day
 * it describes.
 *
 * A project of the shape a rehearsal used: a programme of several milestones,
 * two of them running late by their own rate, the last one a long way off
 * with nothing reported of it. Its completion is the latest finish over its
 * milestones as the work is going, and the summary line, the extension-of-time
 * flag and the owner pack are all read from that one figure. Then a site
 * entry that reaches the record late, for an earlier day.
 *
 * Every project, activity, date and figure is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addMilestones, alertConditions, createProject, logSiteEntry, milestoneWatch, ownerPack, ownerPackPeriod, progressReadings, scheduleWatch, setMilestonePercent, type DdProject, type Milestone } from '@realytica/shared';

const PM = 'pm@example.com';
const NOW = new Date('2026-10-12T06:00:00.000Z');

function project(): DdProject {
  return createProject({ name: 'Hillview Residences', type: 'residential', location: 'Hillview Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-RS1', PM);
}

function milestone(p: DdProject, name: string, plannedStart: string, plannedFinish: string, readings: Array<[string, number]> = []): Milestone {
  const [made] = addMilestones(p, [{ name, weight: 10, plannedFinish }], PM);
  made!.plannedStart = plannedStart;
  for (const [on, percent] of readings) setMilestonePercent(p, made!.id, percent, 'site@example.com', `${on}T09:00:00.000Z`, on);
  return made!;
}

/** Two milestones slipping by their own rate, and a last one far off with nothing reported. */
function slipping(): DdProject {
  const p = project();
  milestone(p, 'Superstructure', '2026-06-01', '2026-10-19', [['2026-10-11', 54], ['2026-10-12', 55]]);
  milestone(p, 'Masonry', '2026-08-01', '2026-11-30', [['2026-10-11', 19], ['2026-10-12', 20]]);
  milestone(p, 'Handover', '2027-12-01', '2028-03-15');
  return p;
}

describe('the project finishes when its last milestone does, as the work is going', () => {
  it('never says the work finishes on time above milestones that finish late', () => {
    const p = slipping();
    const watch = scheduleWatch(p, NOW);
    const late = watch.milestones.filter((m) => m.projectedDaysLate).map((m) => m.projectedDaysLate!);
    assert.equal(late.length, 2, 'two milestones finish late at the current rate');
    const most = Math.max(...late);

    assert.equal(watch.plannedCompletion, '2028-03-15');
    assert.ok(watch.projectedCompletion! > '2028-03-15', 'the last milestone waits on the ones before it');
    assert.equal(watch.projectedDaysLate, most, 'by the most any milestone before it is slipping');
    assert.equal(watch.extensionLikely, true);
    assert.match(watch.say!, new RegExp(`about ${most} days later`));

    const standing = ownerPack(p, ownerPackPeriod({ month: '2026-10' }), NOW).sections.find((section) => section.key === 'standing')!.parts[0]!.lines.map((line) => line.what);
    assert.ok(!standing.some((line) => /no later than the planned date|No extension of time is indicated/.test(line)), standing.join('\n'));
    assert.ok(standing.some((line) => line.includes(`about ${most} days after the planned date`)));
    assert.ok(standing.some((line) => line.startsWith('An extension of time is likely')));
    assert.ok(alertConditions(p, NOW).some((c) => c.key.startsWith('eot:')), 'and the alert is raised off the same figure');
  });

  it('carries a date already missed to what follows, with no rate anywhere', () => {
    const p = project();
    milestone(p, 'Plinth', '2026-07-01', '2026-09-12');
    milestone(p, 'Handover', '2027-01-01', '2027-06-30');
    p.milestones![0]!.percent = 60;
    const watch = scheduleWatch(p, NOW);
    assert.equal(watch.projectedDaysLate, 30, 'thirty days gone since the plinth was due');
    assert.equal(watch.projectedCompletion, '2027-07-30');
    assert.equal(watch.extensionLikely, true);
  });

  it('still says on time where nothing is slipping', () => {
    const p = project();
    milestone(p, 'Plinth', '2026-10-01', '2026-10-31', [['2026-10-02', 2], ['2026-10-12', 60]]);
    milestone(p, 'Handover', '2027-01-01', '2027-06-30');
    const watch = scheduleWatch(p, NOW);
    assert.equal(watch.projectedCompletion, '2027-06-30');
    assert.equal(watch.projectedDaysLate, undefined);
    assert.equal(watch.extensionLikely, false);
    const standing = ownerPack(p, ownerPackPeriod({ month: '2026-10' }), NOW).sections.find((section) => section.key === 'standing')!.parts[0]!.lines.map((line) => line.what);
    assert.ok(standing.includes('No extension of time is indicated.'));
  });
});

describe('a site entry that arrives late is placed at the day it describes', () => {
  /** 40% on the 5th and 55% on the 12th, both typed on the board on their own days. */
  function reported(): { p: DdProject; m: Milestone } {
    const p = project();
    const m = milestone(p, 'Superstructure', '2026-06-01', '2026-10-19', [['2026-10-05', 40], ['2026-10-12', 55]]);
    return { p, m };
  }

  it('never lowers where the milestone stands now', () => {
    const { p, m } = reported();
    const before = milestoneWatch(p, m, NOW);
    // A phone that was offline syncs its entry of the 8th after the 12th was typed.
    logSiteEntry(p, { clientId: 'phone-1', date: '2026-10-08', workDone: 'Slab poured', milestoneUpdates: [{ milestoneId: m.id, percent: 50 }] }, 'site@example.com');
    assert.equal(m.percent, 55, 'the latest day wins for now');
    assert.deepEqual(progressReadings(p, m), [{ on: '2026-10-05', percent: 40 }, { on: '2026-10-08', percent: 50 }, { on: '2026-10-12', percent: 55 }]);
    const after = milestoneWatch(p, m, NOW);
    assert.equal(after.projectedFinish, before.projectedFinish, 'and the rate is the same');
    assert.equal(after.projectedDaysLate, before.projectedDaysLate);
  });

  it('does not un-complete a milestone finished since', () => {
    const { p, m } = reported();
    setMilestonePercent(p, m.id, 100, PM, '2026-10-12T10:00:00.000Z', '2026-10-12');
    logSiteEntry(p, { clientId: 'phone-2', date: '2026-10-09', workDone: 'Shuttering', milestoneUpdates: [{ milestoneId: m.id, percent: 70 }] }, 'site@example.com');
    assert.equal(m.percent, 100);
    assert.equal(m.completedOn, '2026-10-12');
  });

  it('keeps the standing of a milestone that had no readings of its own', () => {
    const p = project();
    const [m] = addMilestones(p, [{ name: 'Plinth', weight: 5, plannedFinish: '2026-11-30' }], PM);
    m!.percent = 55;
    m!.updatedAt = '2026-10-10T08:00:00.000Z';
    setMilestonePercent(p, m!.id, 50, 'site@example.com', '2026-10-12T08:00:00.000Z', '2026-10-06');
    assert.equal(m!.percent, 55);
    assert.deepEqual(m!.readings, [{ on: '2026-10-06', percent: 50 }, { on: '2026-10-10', percent: 55 }]);
  });

  it('still takes a lower reading typed for today', () => {
    const { p, m } = reported();
    setMilestonePercent(p, m.id, 52, PM, '2026-10-12T11:00:00.000Z');
    assert.equal(m.percent, 52, 'a correction made today is today’s reading');
  });
});
