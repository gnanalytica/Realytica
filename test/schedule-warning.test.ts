/**
 * What the schedule says before a date is missed: each rule at the day and
 * the percent where it starts to hold, a projected finish from no readings,
 * one and several, the project's own completion, the alerts those raise and
 * that a day passing raises no second one, and the status report's line.
 *
 * Every project, activity and date is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUE_SOON_DAYS,
  DUE_SOON_FLOOR_PERCENT,
  addMilestones,
  alertConditions,
  createProject,
  logSiteEntry,
  milestoneWatch,
  replanMilestone,
  scheduleWatch,
  setMilestonePercent,
  statusReport,
  syncAlerts,
  type DdProject,
  type Milestone,
} from '@realytica/shared';

const PM = 'pm@example.com';
const day = (d: string) => new Date(`${d}T06:00:00.000Z`);

/** A project with one milestone, its dates and percent as given. */
function withMilestone(dates: { start?: string; finish?: string }, percent = 0): { p: DdProject; m: Milestone } {
  const p = createProject({ name: 'Lakeview block A', type: 'residential', location: 'Lakeview', city: 'Mysuru' }, 'RYT-SW1');
  const [m] = addMilestones(p, [{ name: 'Plinth', weight: 5, ...(dates.finish ? { plannedFinish: dates.finish } : {}) }], PM);
  if (dates.start) m!.plannedStart = dates.start;
  m!.percent = percent;
  return { p, m: m! };
}

const scheduleAlerts = (p: DdProject, now: Date) => alertConditions(p, now).filter((c) => /^(slip|late|eot):/.test(c.key));

describe('behind as the date comes up', () => {
  it('holds from fourteen days out, under the straight line between planned start and finish', () => {
    assert.equal(DUE_SOON_DAYS, 14);
    // Thirty days of work; fourteen days out is day sixteen, 53% along the line.
    const dates = { start: '2026-10-01', finish: '2026-10-31' };
    const at = (percent: number, today: string) => milestoneWatch(withMilestone(dates, percent).p, withMilestone(dates, percent).m, day(today));

    const behind = at(52, '2026-10-17');
    assert.deepEqual({ level: behind.level, expected: behind.expectedPercent, days: behind.daysToFinish, say: behind.say }, { level: 'behind', expected: 53, days: 14, say: 'Due in 14 days, 52% done, expected 53%.' });
    assert.equal(at(53, '2026-10-17').level, undefined, 'on the line is not behind');
    assert.equal(at(0, '2026-10-16').level, undefined, 'fifteen days out is not looked at yet');
    assert.equal(at(0, '2026-10-16').expectedPercent, 50, 'the expected percent is shown all the same');
  });

  it('holds on the day itself and gives way to late the day after', () => {
    const dates = { start: '2026-10-01', finish: '2026-10-31' };
    const { p, m } = withMilestone(dates, 99);
    assert.deepEqual({ level: milestoneWatch(p, m, day('2026-10-31')).level, say: milestoneWatch(p, m, day('2026-10-31')).say }, { level: 'behind', say: 'Due today, 99% done, expected 100%.' });
    assert.deepEqual({ level: milestoneWatch(p, m, day('2026-11-01')).level, say: milestoneWatch(p, m, day('2026-11-01')).say }, { level: 'late', say: '1 day late, 99% done.' });
  });

  it('with no planned start, holds under eighty percent', () => {
    assert.equal(DUE_SOON_FLOOR_PERCENT, 80);
    const at = (percent: number, today: string) => {
      const { p, m } = withMilestone({ finish: '2026-10-31' }, percent);
      return milestoneWatch(p, m, day(today));
    };
    const behind = at(79, '2026-10-17');
    assert.deepEqual({ level: behind.level, expected: behind.expectedPercent, say: behind.say }, { level: 'behind', expected: undefined, say: 'Due in 14 days, 79% done, expected 80% or more.' });
    assert.equal(at(80, '2026-10-17').level, undefined);
    assert.equal(at(0, '2026-10-16').level, undefined);
  });

  it('says nothing of a milestone that is finished, or has no planned finish', () => {
    const done = withMilestone({ finish: '2026-10-31' }, 100);
    assert.equal(milestoneWatch(done.p, done.m, day('2026-11-20')).level, undefined);
    const undated = withMilestone({}, 10);
    assert.equal(milestoneWatch(undated.p, undated.m, day('2026-11-20')).level, undefined);
  });
});

describe('a projected finish, at the current rate', () => {
  const far = { finish: '2026-11-14' };

  it('is not offered with no readings, or with one', () => {
    const { p, m } = withMilestone(far);
    assert.equal(milestoneWatch(p, m, day('2026-10-12')).projectedFinish, undefined);
    setMilestonePercent(p, m.id, 30, PM, '2026-10-11T09:00:00.000Z');
    assert.equal(milestoneWatch(p, m, day('2026-10-12')).projectedFinish, undefined);
    // Twice on one day is still one reading.
    setMilestonePercent(p, m.id, 32, PM, '2026-10-11T17:00:00.000Z');
    assert.equal(m.readings!.length, 1);
    assert.equal(milestoneWatch(p, m, day('2026-10-12')).projectedFinish, undefined);
  });

  it('carries the rate from the first reading to today on from today', () => {
    // 10% to 30% in ten days is two points a day: seventy more take thirty-five days, to 15 November.
    const readings = (finish: string, today = '2026-10-11') => {
      const { p, m } = withMilestone({ finish });
      setMilestonePercent(p, m.id, 10, PM, '2026-10-01T09:00:00.000Z');
      setMilestonePercent(p, m.id, 22, PM, '2026-10-06T09:00:00.000Z');
      setMilestonePercent(p, m.id, 30, PM, '2026-10-11T09:00:00.000Z');
      return milestoneWatch(p, m, day(today));
    };
    const onTime = readings('2026-11-15');
    assert.deepEqual({ projected: onTime.projectedFinish, late: onTime.projectedDaysLate, level: onTime.level }, { projected: '2026-11-15', late: undefined, level: undefined });
    const oneLate = readings('2026-11-14');
    assert.deepEqual(
      { projected: oneLate.projectedFinish, late: oneLate.projectedDaysLate, level: oneLate.level, say: oneLate.say },
      { projected: '2026-11-15', late: 1, level: 'slipping', say: 'At the current rate it finishes about 1 day late.' },
    );
    assert.equal(readings('2026-11-10').projectedDaysLate, 5);
    // A day on with nothing more reported: twenty points in eleven days, so seventy more take thirty-nine, to 20 November.
    assert.equal(readings('2026-11-15', '2026-10-12').projectedFinish, '2026-11-20');
  });

  it('slows with every day nothing is reported: a milestone that has stood still is slipping, not finishing today', () => {
    const stalled = (today: string) => {
      const { p, m } = withMilestone({ finish: '2026-11-30' });
      setMilestonePercent(p, m.id, 10, PM, '2026-10-01T09:00:00.000Z');
      setMilestonePercent(p, m.id, 50, PM, '2026-10-11T09:00:00.000Z');
      return milestoneWatch(p, m, day(today));
    };
    // On the day of the reading: four points a day, fifty more take thirteen days.
    const fresh = stalled('2026-10-11');
    assert.deepEqual({ projected: fresh.projectedFinish, late: fresh.projectedDaysLate, level: fresh.level }, { projected: '2026-10-24', late: undefined, level: undefined });
    // Four weeks on at the same fifty percent: forty points in thirty-eight days, so fifty more take forty-eight, to 26 December.
    const later = stalled('2026-11-08');
    assert.deepEqual(
      { projected: later.projectedFinish, late: later.projectedDaysLate, level: later.level, say: later.say },
      { projected: '2026-12-26', late: 26, level: 'slipping', say: 'At the current rate it finishes about 26 days late.' },
    );
    // Between the two, the last day it still lands inside its date and the first it does not: forty points in 26 days, and in 27.
    assert.deepEqual([stalled('2026-10-23').projectedFinish, stalled('2026-10-23').level], ['2026-11-20', undefined]);
    assert.deepEqual([stalled('2026-10-31').projectedFinish, stalled('2026-10-31').level], ['2026-12-08', 'slipping']);
    const turn = ['2026-10-27', '2026-10-28'].map((today) => [stalled(today).projectedFinish, stalled(today).projectedDaysLate]);
    assert.deepEqual(turn, [
      ['2026-11-29', undefined],
      ['2026-12-01', 1],
    ]);
  });

  it('is not offered on the day of the first reading, or before it', () => {
    const { p, m } = withMilestone(far);
    setMilestonePercent(p, m.id, 10, PM, '2026-10-11T09:00:00.000Z');
    setMilestonePercent(p, m.id, 30, PM, '2026-10-12T09:00:00.000Z');
    assert.equal(milestoneWatch(p, m, day('2026-10-11')).projectedFinish, undefined);
    assert.equal(milestoneWatch(p, m, day('2026-10-10')).projectedFinish, undefined);
    // The day after the first: twenty points in a day, seventy more take four.
    assert.equal(milestoneWatch(p, m, day('2026-10-12')).projectedFinish, '2026-10-16');
  });

  it('is not offered when the readings do not rise', () => {
    const { p, m } = withMilestone(far);
    setMilestonePercent(p, m.id, 30, PM, '2026-10-01T09:00:00.000Z');
    setMilestonePercent(p, m.id, 30, PM, '2026-10-11T09:00:00.000Z');
    assert.equal(milestoneWatch(p, m, day('2026-10-12')).projectedFinish, undefined);
  });

  it('reads the site log for what was reported before readings were kept', () => {
    const { p, m } = withMilestone(far);
    logSiteEntry(p, { clientId: 'c1', date: '2026-10-01', milestoneUpdates: [{ milestoneId: m.id, percent: 10 }] }, 'site@example.com');
    logSiteEntry(p, { clientId: 'c2', date: '2026-10-11', milestoneUpdates: [{ milestoneId: m.id, percent: 30 }] }, 'site@example.com');
    assert.deepEqual(m.readings, [
      { on: '2026-10-01', percent: 10 },
      { on: '2026-10-11', percent: 30 },
    ], 'a site entry is a reading of its own day, not of the day it was filed');
    delete m.readings;
    assert.equal(milestoneWatch(p, m, day('2026-10-11')).projectedFinish, '2026-11-15');
  });

  it('is added to the warning of a milestone that is also behind', () => {
    const { p, m } = withMilestone({ start: '2026-10-01', finish: '2026-10-21' });
    setMilestonePercent(p, m.id, 10, PM, '2026-10-01T09:00:00.000Z');
    setMilestonePercent(p, m.id, 30, PM, '2026-10-11T09:00:00.000Z');
    const watch = milestoneWatch(p, m, day('2026-10-11'));
    assert.deepEqual({ level: watch.level, say: watch.say }, { level: 'behind', say: 'Due in 10 days, 30% done, expected 50%. At the current rate it finishes about 25 days late.' });
  });
});

describe('the project as a whole', () => {
  function twoMilestones(): { p: DdProject; plinth: Milestone; frame: Milestone } {
    const p = createProject({ name: 'Lakeview block A', type: 'residential', location: 'Lakeview', city: 'Mysuru' }, 'RYT-SW2');
    const [plinth, frame] = addMilestones(
      p,
      [
        { name: 'Plinth', weight: 5, plannedFinish: '2026-11-14' },
        { name: 'Frame', weight: 30, plannedFinish: '2027-03-31' },
      ],
      PM,
    );
    return { p, plinth: plinth!, frame: frame! };
  }

  it('is planned to complete on the latest planned finish, and projects nothing without a rate', () => {
    const { p } = twoMilestones();
    const watch = scheduleWatch(p, day('2026-10-12'));
    assert.deepEqual(
      { planned: watch.plannedCompletion, projected: watch.projectedCompletion, extension: watch.extensionLikely, say: watch.say },
      { planned: '2027-03-31', projected: undefined, extension: false, say: 'Planned completion 2027-03-31.' },
    );
    assert.deepEqual(scheduleAlerts(p, day('2026-10-12')), []);
  });

  it('is likely to need an extension of time when the projection runs past planned completion', () => {
    const { p, frame } = twoMilestones();
    // One point in ten days: ninety-eight more take 980 days from 11 October 2026.
    setMilestonePercent(p, frame.id, 1, PM, '2026-10-01T09:00:00.000Z');
    setMilestonePercent(p, frame.id, 2, PM, '2026-10-11T09:00:00.000Z');
    const watch = scheduleWatch(p, day('2026-10-11'));
    assert.equal(watch.projectedCompletion, '2029-06-17');
    assert.equal(watch.extensionLikely, true);
    assert.match(watch.say!, /^Planned completion 2027-03-31\. At the current rate, about \d+ days later\.$/);
    assert.deepEqual(
      scheduleAlerts(p, day('2026-10-11')).map((c) => [c.key, c.title]),
      [
        [`slip:${frame.id}:2027-03-31`, 'Frame is likely to finish late'],
        ['eot:2027-03-31', 'Extension of time likely'],
      ],
    );
  });

  it('is not, while the projection lands on or before planned completion', () => {
    const { p, plinth } = twoMilestones();
    setMilestonePercent(p, plinth.id, 10, PM, '2026-10-01T09:00:00.000Z');
    setMilestonePercent(p, plinth.id, 30, PM, '2026-10-11T09:00:00.000Z');
    const watch = scheduleWatch(p, day('2026-10-11'));
    // The frame has no rate, so it is taken at its planned date.
    assert.deepEqual({ projected: watch.projectedCompletion, extension: watch.extensionLikely }, { projected: '2027-03-31', extension: false });
  });

  it('is, once planned completion has passed with work unfinished, and not once the work is done', () => {
    const { p, plinth, frame } = twoMilestones();
    setMilestonePercent(p, plinth.id, 100, PM, '2026-11-10T09:00:00.000Z');
    assert.equal(scheduleWatch(p, day('2027-03-31')).extensionLikely, false, 'not on the day itself');
    const after = scheduleWatch(p, day('2027-04-01'));
    assert.deepEqual({ extension: after.extensionLikely, say: after.say }, { extension: true, say: 'Planned completion 2027-03-31. That date has passed with work unfinished.' });
    setMilestonePercent(p, frame.id, 100, PM, '2027-04-02T09:00:00.000Z');
    assert.equal(scheduleWatch(p, day('2027-04-03')).extensionLikely, false);
  });
});

describe('the alert a warning raises', () => {
  it('is one alert from the first day to the date, whose words move with the days left', () => {
    const { p, m } = withMilestone({ start: '2026-10-01', finish: '2026-10-31' }, 20);
    assert.deepEqual(syncAlerts(p, day('2026-10-16')).filter((a) => a.key.startsWith('slip:')), [], 'nothing fifteen days out');

    const [raised] = syncAlerts(p, day('2026-10-17')).filter((a) => a.key.startsWith('slip:'));
    assert.deepEqual(
      { key: raised!.key, department: raised!.department, severity: raised!.severity, title: raised!.title, detail: raised!.detail, dueOn: raised!.dueOn },
      { key: `slip:${m.id}:2026-10-31`, department: 'construction', severity: 'warning', title: 'Plinth is behind', detail: 'Due in 14 days, 20% done, expected 53%.', dueOn: '2026-10-31' },
    );
    raised!.readBy.push(PM);

    for (const today of ['2026-10-18', '2026-10-19', '2026-10-20']) {
      assert.deepEqual(syncAlerts(p, day(today)).filter((a) => a.key.startsWith('slip:')), [], `${today} raises nothing new`);
    }
    const held = p.alerts!.filter((a) => a.key.startsWith('slip:'));
    assert.equal(held.length, 1);
    assert.equal(held[0]!.id, raised!.id);
    assert.equal(held[0]!.detail, 'Due in 11 days, 20% done, expected 63%.');
    assert.deepEqual(held[0]!.readBy, [PM], 'who has read it stays');
    assert.equal(held[0]!.raisedAt, day('2026-10-17').toISOString());
  });

  it('clears when the work catches up, and gives way to the late alert once the date has passed', () => {
    const { p, m } = withMilestone({ start: '2026-10-01', finish: '2026-10-31' }, 20);
    syncAlerts(p, day('2026-10-20'));
    m.percent = 70;
    syncAlerts(p, day('2026-10-21'));
    assert.ok(p.alerts!.find((a) => a.key.startsWith('slip:'))!.resolvedAt, 'caught up');

    m.percent = 60;
    syncAlerts(p, day('2026-10-30'));
    const raised = syncAlerts(p, day('2026-11-01'));
    assert.deepEqual(raised.map((a) => a.key).filter((key) => /^(slip|late|eot):/.test(key)), ['late:Plinth:2026-10-31', 'eot:2026-10-31']);
    assert.deepEqual(p.alerts!.filter((a) => a.key.startsWith('slip:') && !a.resolvedAt), []);
  });

  it('is a new alert when the milestone is re-planned to a new date', () => {
    const { p, m } = withMilestone({ start: '2026-10-01', finish: '2026-10-31' }, 20);
    syncAlerts(p, day('2026-10-20'));
    replanMilestone(m, { plannedFinish: '2026-11-02' });
    const raised = syncAlerts(p, day('2026-10-21')).filter((a) => a.key.startsWith('slip:'));
    assert.deepEqual(raised.map((a) => a.key), [`slip:${m.id}:2026-11-02`]);
    assert.ok(p.alerts!.find((a) => a.key === `slip:${m.id}:2026-10-31`)!.resolvedAt);
    assert.equal(m.baselineFinish, '2026-10-31');
  });
});

describe('the status report', () => {
  it('carries the same warning on the milestone it lists as coming up', () => {
    const { p, m } = withMilestone({ start: '2026-10-01', finish: '2026-10-31' }, 20);
    const report = statusReport(p, { from: '2026-10-13T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' }, day('2026-10-20'));
    const line = report.next.find((l) => l.recordId === m.id)!;
    assert.match(line.what, /: Plinth, now at 20%\. Due in 11 days, 20% done, expected 63%\.$/);
    assert.equal(line.stands, 'behind');

    m.percent = 70;
    const onTrack = statusReport(p, { from: '2026-10-13T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' }, day('2026-10-20')).next.find((l) => l.recordId === m.id)!;
    assert.match(onTrack.what, /: Plinth, now at 70%\.$/);
    assert.equal(onTrack.stands, 'in progress');
  });
});
