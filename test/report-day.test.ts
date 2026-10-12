/**
 * Reports on a set day, quarters, and an owner pack kept as it was issued.
 *
 * The day rule at the ends of months and at India's midnight, a second run
 * preparing nothing, a pack that reads as issued after the record has moved,
 * quarters at their four boundaries in both years, and the checklist where
 * the chat's tool, the status report and a spreadsheet read it.
 *
 * The project, the people and the papers are invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addChecklistItems,
  checklistCsv,
  checklistSheet,
  createProject,
  indiaDay,
  isQuarter,
  issueOwnerPack,
  issueReport,
  keepOwnerPack,
  ownerPackPeriod,
  ownerPackStanding,
  ownerPacksKept,
  placeOfRecord,
  prepareReportsDue,
  preparedReportSaid,
  projectView,
  quarterHolding,
  quarterKey,
  quarterOfKey,
  quarterSaid,
  raiseChecklistRequests,
  refreshOwnerPack,
  reopenOwnerPack,
  reportDayIn,
  reportPeriodDue,
  quarterYearOf,
  reportPeriodSaid,
  reportsWaiting,
  setReportDay,
  statusPeriodAsked,
  statusPeriodSaid,
  statusReport,
  mayIssueOwnerPack,
  mayPrepareOwnerPack,
  setTeamMember,
  addRequest,
  applyProjectChat,
  type DdProject,
  type ProjectGrant,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';
import type { ReportDaySource } from '../apps/api/src/cron/report-day';

/** Loaded when first run: the API's storage is set up as its module loads. */
const reportDay = async (now: Date, source: ReportDaySource) => (await import('../apps/api/src/cron/report-day')).reportDay(now, source);

const LEAD = 'asha@builders.example';

function fresh(): DdProject {
  const project = createProject({ name: 'Canal Street offices', type: 'commercial', location: 'Canal Street', city: 'Kadamba' }, 'RYT-RD1');
  setTeamMember(project, { email: LEAD, name: 'Asha Rao', departments: { finance: 'lead' } }, LEAD);
  return project;
}

/** A moment by the clock in India. */
const india = (day: string, time = '07:00'): Date => new Date(`${day}T${time}:00+05:30`);
const span = (period: { from: string; to: string } | undefined): string | undefined => (period ? `${period.from.slice(0, 10)}..${period.to.slice(0, 10)}` : undefined);

describe('the day a report is prepared on', () => {
  it('is the day set, and in a shorter month the month’s last day', () => {
    assert.equal(reportDayIn(31, 2026, 3), 30, 'April');
    assert.equal(reportDayIn(31, 2026, 1), 28, 'February');
    assert.equal(reportDayIn(30, 2028, 1), 29, 'February of a leap year');
    assert.equal(reportDayIn(31, 2026, 11), 31, 'December');
    assert.equal(reportDayIn(1, 2026, 1), 1);
  });

  it('prepares the month before, only on that day', () => {
    const monthly = { day: 31, every: 'month' as const };
    assert.equal(span(reportPeriodDue(monthly, india('2026-04-30'))), '2026-03-01..2026-04-01');
    assert.equal(reportPeriodDue(monthly, india('2026-04-29')), undefined);
    assert.equal(span(reportPeriodDue(monthly, india('2026-02-28'))), '2026-01-01..2026-02-01');
    assert.equal(span(reportPeriodDue(monthly, india('2028-02-29'))), '2028-01-01..2028-02-01');
    assert.equal(reportPeriodDue(monthly, india('2028-02-28')), undefined, 'the 28th is not the last day of a leap February');
    assert.equal(span(reportPeriodDue({ day: 1, every: 'month' }, india('2027-01-01'))), '2026-12-01..2027-01-01', 'December, across the year');
  });

  it('is read in India time, not UTC', () => {
    // 20:00 UTC on 30 September is 01:30 on 1 October in India.
    const late = new Date('2026-09-30T20:00:00.000Z');
    assert.deepEqual(indiaDay(late), { year: 2026, month: 9, date: 1 });
    assert.equal(span(reportPeriodDue({ day: 1, every: 'month' }, late)), '2026-09-01..2026-10-01');
    // 19:00 UTC on 1 October is already the 2nd in India.
    assert.equal(reportPeriodDue({ day: 1, every: 'month' }, new Date('2026-10-01T19:00:00.000Z')), undefined);
  });

  it('prepares a quarter only in the month after one ends', () => {
    const quarterly = { day: 5, every: 'quarter' as const };
    assert.equal(span(reportPeriodDue(quarterly, india('2026-10-05'))), '2026-07-01..2026-10-01');
    assert.equal(span(reportPeriodDue(quarterly, india('2027-01-05'))), '2026-10-01..2027-01-01');
    assert.equal(span(reportPeriodDue(quarterly, india('2026-04-05'))), '2026-01-01..2026-04-01');
    assert.equal(reportPeriodDue(quarterly, india('2026-11-05')), undefined);
    assert.equal(reportPeriodDue(quarterly, india('2026-10-04')), undefined);
  });

  it('is still owed after the day where the setting stood on it, so a missed run is caught up', () => {
    const since = (day: string) => ({ setAt: india(day).toISOString() });
    const monthly = { day: 1, every: 'month' as const, ...since('2026-08-15') };
    assert.equal(span(reportPeriodDue(monthly, india('2026-10-02'))), '2026-09-01..2026-10-01', 'the day after');
    assert.equal(span(reportPeriodDue(monthly, india('2026-10-31'))), '2026-09-01..2026-10-01', 'until the next day comes');
    assert.equal(span(reportPeriodDue(monthly, india('2026-11-01'))), '2026-10-01..2026-11-01');
    // The 28th: on 2 October the latest day that has come is 28 September, which asks for August.
    assert.equal(span(reportPeriodDue({ ...monthly, day: 28 }, india('2026-10-02'))), '2026-08-01..2026-09-01');
    // Quarterly, the day falls in October: owed from the 5th until the 5th of January.
    const quarterly = { day: 5, every: 'quarter' as const, ...since('2026-08-15') };
    assert.equal(span(reportPeriodDue(quarterly, india('2026-10-09'))), '2026-07-01..2026-10-01');
    assert.equal(span(reportPeriodDue(quarterly, india('2026-12-20'))), '2026-07-01..2026-10-01');
    assert.equal(span(reportPeriodDue(quarterly, india('2027-01-04'))), '2026-07-01..2026-10-01');
    assert.equal(span(reportPeriodDue(quarterly, india('2027-01-05'))), '2026-10-01..2027-01-01');
    // A day set after it passed asks for nothing until its next.
    assert.equal(reportPeriodDue({ day: 1, every: 'month', ...since('2026-10-05') }, india('2026-10-06')), undefined);
    assert.equal(span(reportPeriodDue({ day: 1, every: 'month', ...since('2026-10-05') }, india('2026-11-01'))), '2026-10-01..2026-11-01');
    assert.equal(span(reportPeriodDue({ day: 1, every: 'month', ...since('2026-10-01') }, india('2026-10-02'))), '2026-09-01..2026-10-01', 'set on the day itself, after the timer ran');
  });
});

describe('quarters', () => {
  it('begin on the first of January, April, July and October, and end where the next begins', () => {
    // The quarter it is turns at midnight in India, which is half past six the evening before in UTC.
    assert.equal(span(quarterHolding(new Date('2026-03-31T18:29:59.999Z'))), '2026-01-01..2026-04-01');
    assert.equal(span(quarterHolding(new Date('2026-03-31T18:30:00.000Z'))), '2026-04-01..2026-07-01');
    assert.equal(span(quarterHolding(new Date('2026-12-31T18:29:59.999Z'))), '2026-10-01..2027-01-01');
    assert.equal(span(quarterHolding(new Date('2026-01-15T00:00:00.000Z'), -1)), '2025-10-01..2026-01-01');
    assert.ok(isQuarter(quarterHolding(new Date('2026-08-09T00:00:00.000Z'))));
    assert.ok(!isQuarter({ from: '2026-07-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' }));
    assert.ok(!isQuarter({ from: '2026-08-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }));
  });

  it('are numbered in the financial year unless the calendar year is asked for', () => {
    const q = (from: string) => quarterHolding(new Date(from));
    assert.deepEqual([quarterSaid(q('2026-04-01')), quarterSaid(q('2026-07-01')), quarterSaid(q('2026-10-01')), quarterSaid(q('2027-01-01'))], ['Q1 FY 2026-27', 'Q2 FY 2026-27', 'Q3 FY 2026-27', 'Q4 FY 2026-27']);
    assert.deepEqual([quarterSaid(q('2026-01-01'), 'calendar'), quarterSaid(q('2026-07-01'), 'calendar'), quarterSaid(q('2026-10-01'), 'calendar')], ['Q1 2026', 'Q3 2026', 'Q4 2026']);
    assert.equal(quarterSaid(q('2026-03-31')), 'Q4 FY 2025-26', 'January to March closes the financial year before');
    assert.equal(quarterSaid(q('2099-10-01')), 'Q3 FY 2099-00');
    assert.equal(reportPeriodSaid(q('2026-07-01')), 'Q2 FY 2026-27 (July to September 2026)');
    assert.equal(statusPeriodSaid(q('2026-07-01')), 'July to September 2026');
    assert.equal(reportPeriodSaid({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }), 'September 2026');
  });

  it('are asked for by a key that reads back to the same three months in either year', () => {
    for (const from of ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']) {
      const period = quarterHolding(new Date(from));
      assert.deepEqual(quarterOfKey(quarterKey(period)), period);
      assert.deepEqual(quarterOfKey(quarterKey(period, 'calendar')), period);
    }
    assert.equal(quarterKey(quarterHolding(new Date('2026-07-01'))), 'FY2026-Q2');
    assert.equal(span(quarterOfKey('FY2026-Q4')), '2027-01-01..2027-04-01');
    assert.equal(span(quarterOfKey('2026-Q3')), '2026-07-01..2026-10-01');
    assert.equal(quarterOfKey('2026-Q5'), undefined);
    assert.equal(span(ownerPackPeriod({ quarter: 'FY2026-Q2' })), '2026-07-01..2026-10-01');
    assert.equal(span(ownerPackPeriod({ month: '2026-09' })), '2026-09-01..2026-10-01');
  });

  it('are a period a status report can be asked for', () => {
    const project = fresh();
    const now = india('2026-10-12');
    assert.equal(span(statusPeriodAsked(project, 'Write the status report for last quarter', now).period), '2026-07-01..2026-10-01');
    assert.equal(statusPeriodAsked(project, 'status report for this quarter', now).period.from, '2026-10-01T00:00:00.000Z');
    assert.equal(span(statusPeriodAsked(project, 'write a status report for Q2 FY 2026-27', now).period), '2026-07-01..2026-10-01');
    assert.equal(span(statusPeriodAsked(project, 'write a status report for Q1 2026', now).period), '2026-01-01..2026-04-01');
    // A quarter by its number wins over the word "quarterly", and a year written as a range is a financial year.
    assert.equal(span(statusPeriodAsked(project, 'Prepare the quarterly status report for Q1 FY 2026-27', now).period), '2026-04-01..2026-07-01');
    assert.equal(span(statusPeriodAsked(project, 'status report for q1 of 2026-27', now).period), '2026-04-01..2026-07-01');
    assert.equal(span(statusPeriodAsked(project, 'status report for Q2 2026-27', now).period), '2026-07-01..2026-10-01');
    assert.equal(statusPeriodAsked(project, 'Prepare the quarterly status report', now).period.from, '2026-10-01T00:00:00.000Z', 'with no quarter named, this one so far');
  });
});

describe('a report day', () => {
  it('is set by its day, its reports, how often and who is told, and refuses what is not one', () => {
    const project = fresh();
    assert.throws(() => setReportDay(project, { day: 0, reports: ['status'], every: 'month', tell: [] }, LEAD), /1 to 31/);
    assert.throws(() => setReportDay(project, { day: 3, reports: [], every: 'month', tell: [] }, LEAD), /status report, the owner pack or both/);
    const setting = setReportDay(project, { day: 1, reports: ['owner_pack', 'status'], every: 'month', tell: [' Asha@Builders.example ', LEAD] }, LEAD)!;
    assert.deepEqual([setting.reports, setting.tell, setting.quarters], [['status', 'owner_pack'], [LEAD], undefined]);
    assert.equal(project.audit.at(-1)!.action, 'set_report_day');
    setReportDay(project, null, LEAD);
    assert.equal(project.reportDay?.setting, undefined);
  });

  it('prepares both reports for the month just ended, each waiting, and nothing on any other day', () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [LEAD] }, LEAD);
    assert.deepEqual(prepareReportsDue(project, india('2026-09-30')), []);
    assert.deepEqual(prepareReportsDue(project, india('2026-10-02')), []);
    const made = prepareReportsDue(project, india('2026-10-01'));
    assert.deepEqual(made.map((line) => [line.kind, span(line)]), [['status', '2026-09-01..2026-10-01'], ['owner_pack', '2026-09-01..2026-10-01']]);
    const report = project.reports.find((held) => held.id === made[0]!.id)!;
    assert.equal(report.kind, 'status');
    assert.equal(report.status, 'generated');
    assert.equal(preparedReportSaid(project, report), 'Prepared, waiting to be issued');
    const pack = ownerPacksKept(project)[0]!;
    assert.deepEqual([pack.id, pack.status, pack.preparedBy, pack.pack.periodSaid], [made[1]!.id, 'prepared', 'system', 'September 2026']);
    assert.equal(reportsWaiting(project).length, 2);
  });

  it('prepares nothing a second time on the day, however often it runs', () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [] }, LEAD);
    assert.equal(prepareReportsDue(project, india('2026-10-01', '06:00')).length, 2);
    const was = JSON.stringify([project.reports, project.ownerPacks, project.reportDay, project.audit.length]);
    assert.deepEqual(prepareReportsDue(project, india('2026-10-01', '06:00')), []);
    assert.deepEqual(prepareReportsDue(project, india('2026-10-01', '23:30')), []);
    assert.equal(JSON.stringify([project.reports, project.ownerPacks, project.reportDay, project.audit.length]), was);
    // The next month is another period.
    assert.equal(prepareReportsDue(project, india('2026-11-01')).length, 2);
  });

  it('leaves alone a pack a person already keeps for the period, and names a quarter by its number', () => {
    const project = fresh();
    setReportDay(project, { day: 31, reports: ['status', 'owner_pack'], every: 'quarter', tell: [] }, LEAD);
    const mine = keepOwnerPack(project, quarterOfKey('FY2026-Q2')!, LEAD, india('2026-10-03'));
    issueOwnerPack(project, mine.id, { actor: LEAD });
    const made = prepareReportsDue(project, india('2026-10-31'));
    assert.equal(made.length, 2);
    assert.equal(project.ownerPacks!.length, 1, 'no second pack');
    assert.equal(made[1]!.id, mine.id);
    assert.equal(project.reports.at(-1)!.title, 'Status report — Canal Street offices, Q2 FY 2026-27 (July to September 2026)');
    assert.equal(mine.title, 'Owner pack — Canal Street offices, Q2 FY 2026-27 (July to September 2026)');
    assert.equal(reportsWaiting(project).length, 1, 'the issued pack waits for nobody');
    issueReport(project, made[0]!.id, LEAD);
    assert.equal(reportsWaiting(project).length, 0);
  });
});

describe('the timer', () => {
  function standIn(projects: DdProject[], opts: { failSaveOn?: string; firm?: string[] } = {}) {
    const calls = { saves: 0, told: [] as Array<{ project: string; to: string[]; kinds: string[] }> };
    const source: ReportDaySource = {
      ids: () => projects.map((project) => project.id),
      fresh: async (id) => {
        if (id === 'gone') throw new Error('storage did not answer');
        return projects.find((project) => project.id === id);
      },
      save: async (project) => {
        if (project.id === opts.failSaveOn) throw new Error('write refused');
        calls.saves += 1;
      },
      ownPeople: (_project, emails) => emails.filter((email) => (opts.firm ?? [LEAD]).includes(email)),
      tell: async (project, lines, to) => {
        calls.told.push({ project: project.id, to: [...to], kinds: lines.map((line) => line.kind) });
        return [...to];
      },
    };
    return { source, calls };
  }

  it('prepares, tells the firm’s people named once, and does neither on a second run', async () => {
    const project = fresh();
    const other = fresh();
    other.id = 'prj_other';
    setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [LEAD, 'owner@client.example'] }, LEAD);
    setReportDay(other, { day: 15, reports: ['status'], every: 'month', tell: [LEAD] }, LEAD);
    const { source, calls } = standIn([project, other]);
    const now = india('2026-10-01');
    assert.deepEqual(await reportDay(now, source), { projects: 2, prepared: 2, told: 1, failed: 0 });
    assert.deepEqual(calls.told, [{ project: project.id, to: [LEAD], kinds: ['status', 'owner_pack'] }], 'an address outside the firm is passed over');
    assert.deepEqual(project.reportDay!.prepared!.map((line) => line.told), [[LEAD], [LEAD]]);
    assert.equal(project.ownerPacks![0]!.status, 'prepared', 'nothing is issued by the timer');
    assert.equal(project.reports.at(-1)!.status, 'generated');
    assert.deepEqual(await reportDay(now, source), { projects: 2, prepared: 0, told: 0, failed: 0 });
    assert.deepEqual(await reportDay(india('2026-10-01', '22:00'), source), { projects: 2, prepared: 0, told: 0, failed: 0 });
    assert.equal(calls.told.length, 1);
    assert.equal(project.reports.length, 1);
  });

  it('finishes telling for a run that prepared and died, and then tells nobody again', async () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['owner_pack'], every: 'month', tell: [LEAD] }, LEAD);
    prepareReportsDue(project, india('2026-10-01'));
    const { source, calls } = standIn([project]);
    assert.deepEqual(await reportDay(india('2026-10-01', '09:00'), source), { projects: 1, prepared: 0, told: 1, failed: 0 });
    assert.deepEqual(await reportDay(india('2026-10-01', '10:00'), source), { projects: 1, prepared: 0, told: 0, failed: 0 });
    assert.equal(calls.told.length, 1);
  });

  it('counts a project that fails and carries on, leaving it as it was for the next run', async () => {
    const bad = fresh();
    bad.id = 'prj_bad';
    const good = fresh();
    for (const project of [bad, good]) setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [] }, LEAD);
    const was = JSON.stringify(bad);
    const gone = { id: 'gone' } as DdProject;
    const { source } = standIn([bad, gone, good], { failSaveOn: 'prj_bad' });
    assert.deepEqual(await reportDay(india('2026-10-01'), source), { projects: 2, prepared: 2, told: 0, failed: 2 });
    assert.equal(JSON.stringify(bad), was);
    assert.equal(good.ownerPacks!.length, 1);
    assert.deepEqual(good.reportDay!.prepared!.map((line) => [line.told, line.toldAt]), [[undefined, undefined], [undefined, undefined]], 'nobody was told, so nothing says anybody was');
  });

  it('tells on a later run where the first told nobody, and only then notes who was told', async () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status'], every: 'month', tell: [LEAD] }, LEAD, india('2026-09-20').toISOString());
    const { source, calls } = standIn([project]);
    const tell = source.tell;
    // The mail service refuses on the day.
    source.tell = async (held, lines, to) => {
      await tell(held, lines, to);
      return [];
    };
    assert.deepEqual(await reportDay(india('2026-10-01'), source), { projects: 1, prepared: 1, told: 0, failed: 0 });
    assert.deepEqual([project.reportDay!.prepared![0]!.told, project.reportDay!.prepared![0]!.toldAt], [undefined, undefined]);
    assert.equal(calls.saves, 1, 'the reports are written, and nothing more');
    source.tell = tell;
    assert.deepEqual(await reportDay(india('2026-10-02'), source), { projects: 1, prepared: 0, told: 1, failed: 0 }, 'the next day’s run tells them');
    assert.deepEqual(project.reportDay!.prepared![0]!.told, [LEAD]);
    assert.deepEqual(await reportDay(india('2026-10-03'), source), { projects: 1, prepared: 0, told: 0, failed: 0 });
    assert.equal(calls.told.length, 2);
  });

  it('prepares on its next run the report of a day it missed', async () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [LEAD] }, LEAD, india('2026-09-20').toISOString());
    const { source } = standIn([project]);
    // The run of 1 October never happened.
    assert.deepEqual(await reportDay(india('2026-10-02'), source), { projects: 1, prepared: 2, told: 1, failed: 0 });
    assert.deepEqual(project.reportDay!.prepared!.map((line) => [line.kind, span(line)]), [['status', '2026-09-01..2026-10-01'], ['owner_pack', '2026-09-01..2026-10-01']]);
    assert.deepEqual(await reportDay(india('2026-10-03'), source), { projects: 1, prepared: 0, told: 0, failed: 0 });
  });

  it('reads the project again after telling, so what somebody saved meanwhile is not written over', async () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status'], every: 'month', tell: [LEAD] }, LEAD);
    const { source } = standIn([project]);
    const written: DdProject[] = [];
    let reads = 0;
    let elsewhere: DdProject | undefined;
    source.fresh = async () => ((reads += 1) === 1 ? project : elsewhere);
    source.save = async (held) => {
      written.push(JSON.parse(JSON.stringify(held)) as DdProject);
    };
    source.tell = async (_held, _lines, to) => {
      // While the mail service is answering, another instance saves a paper on the project as this run first wrote it.
      elsewhere = JSON.parse(JSON.stringify(written[0])) as DdProject;
      addChecklistItems(elsewhere, 'finance', [{ title: 'Saved by another instance' }], LEAD);
      return [...to];
    };
    assert.deepEqual(await reportDay(india('2026-10-01'), source), { projects: 1, prepared: 1, told: 1, failed: 0 });
    assert.equal(reads, 2);
    assert.equal(written.length, 2);
    assert.equal(written[1]!.checklist!.some((item) => item.title === 'Saved by another instance'), true, 'the second write holds what the other instance saved');
    assert.deepEqual(written[1]!.reportDay!.prepared![0]!.told, [LEAD]);
  });
});

describe('an owner pack that is kept', () => {
  it('opens as issued after the record has moved, and a waiting one is read again', () => {
    const project = fresh();
    addChecklistItems(project, 'finance', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }], LEAD);
    const period = ownerPackPeriod({ month: '2026-09' });
    const kept = keepOwnerPack(project, period, LEAD, india('2026-10-02'));
    assert.equal(ownerPackStanding(project, kept), 'Prepared 2 Oct 2026, waiting to be issued');

    // One waits for a period at a time: asked for again it is read again, and no second is kept.
    addChecklistItems(project, 'finance', [{ title: 'Column schedule', owedBy: 'Structural consultant' }], LEAD);
    const again = keepOwnerPack(project, period, LEAD, india('2026-10-03'));
    assert.equal(again.id, kept.id);
    assert.equal(project.ownerPacks!.length, 1);
    assert.match(JSON.stringify(again.pack), /Column schedule/);

    const issued = issueOwnerPack(project, kept.id, { actor: LEAD, name: 'Asha Rao' }, india('2026-10-04').toISOString());
    assert.deepEqual([issued.status, issued.issuedBy, issued.issuedName, issued.issuedAt], ['issued', LEAD, 'Asha Rao', india('2026-10-04').toISOString()]);
    assert.equal(ownerPackStanding(project, issued), 'Issued 4 Oct 2026 by Asha Rao');
    const frozen = JSON.stringify(issued.pack);

    // The record moves: a paper more, a new name for the project, a stage.
    addChecklistItems(project, 'finance', [{ title: 'Basic prices of steel', owedBy: 'Contractor' }], LEAD);
    project.name = 'Canal Street Tower';
    const now = JSON.stringify(ownerPacksKept(project)[0]!.pack);
    assert.equal(now, frozen);
    assert.doesNotMatch(now, /Basic prices of steel/);
    assert.equal(ownerPacksKept(project)[0]!.heading.name, 'Canal Street offices');
    assert.throws(() => refreshOwnerPack(project, kept.id, LEAD), /is issued/);
    assert.throws(() => issueOwnerPack(project, kept.id, { actor: LEAD }), /already issued/);

    // Asked for again, the issued one stays and a new one waits beside it.
    const next = keepOwnerPack(project, period, LEAD, india('2026-10-06'));
    assert.notEqual(next.id, kept.id);
    assert.match(JSON.stringify(next.pack), /Basic prices of steel/);
    assert.equal(JSON.stringify(project.ownerPacks!.find((held) => held.id === kept.id)!.pack), frozen);
  });

  it('is reopened only when issued: the issued one stays as it was sent, and a copy waits beside it', () => {
    const project = fresh();
    addChecklistItems(project, 'finance', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }], LEAD);
    const kept = keepOwnerPack(project, ownerPackPeriod({ month: '2026-09' }), LEAD, india('2026-10-02'));
    assert.throws(() => reopenOwnerPack(project, kept.id, LEAD), /Only an issued owner pack/);
    issueOwnerPack(project, kept.id, { actor: LEAD, name: 'Asha Rao' });
    const sent = JSON.stringify(kept);
    const open = reopenOwnerPack(project, kept.id, LEAD);
    assert.notEqual(open.id, kept.id);
    assert.deepEqual([open.status, open.issuedAt, open.issuedBy, open.issuedName], ['prepared', undefined, undefined, undefined]);
    assert.equal(JSON.stringify(open.pack), JSON.stringify(kept.pack), 'it begins as what was sent');
    assert.deepEqual(project.audit.slice(-3).map((event) => event.action), ['prepare_owner_pack', 'issue_owner_pack', 'reopen_owner_pack']);

    // Read again, the waiting one takes the record as it now is. What was sent does not move.
    addChecklistItems(project, 'finance', [{ title: 'Column schedule', owedBy: 'Structural consultant' }], LEAD);
    refreshOwnerPack(project, open.id, LEAD);
    assert.match(JSON.stringify(open.pack), /Column schedule/);
    assert.equal(JSON.stringify(project.ownerPacks!.find((held) => held.id === kept.id)), sent);
    assert.throws(() => refreshOwnerPack(project, kept.id, LEAD), /is issued/);

    assert.equal(reopenOwnerPack(project, kept.id, LEAD).id, open.id, 'one waits for a period at a time');
    assert.equal(project.ownerPacks!.length, 2);
    assert.throws(() => issueOwnerPack(project, 'opk_none', { actor: LEAD }), /No owner pack by that id/);
  });

  it('keeps the name its period went by when it was kept, whatever the project numbers quarters by since', () => {
    const project = fresh();
    setReportDay(project, { day: 5, reports: ['owner_pack'], every: 'quarter', tell: [] }, LEAD);
    const kept = keepOwnerPack(project, quarterOfKey('FY2026-Q2')!, LEAD, india('2026-10-03'));
    issueOwnerPack(project, kept.id, { actor: LEAD });
    assert.equal(kept.periodSaid, 'Q2 FY 2026-27 (July to September 2026)');
    setReportDay(project, { day: 5, reports: ['owner_pack'], every: 'quarter', quarters: 'calendar', tell: [] }, LEAD);
    assert.equal(reportPeriodSaid(kept.pack.period, quarterYearOf(project)), 'Q3 2026 (July to September 2026)', 'the project now numbers by the calendar year');
    assert.deepEqual([kept.periodSaid, kept.title], ['Q2 FY 2026-27 (July to September 2026)', 'Owner pack — Canal Street offices, Q2 FY 2026-27 (July to September 2026)']);
    assert.equal(reopenOwnerPack(project, kept.id, LEAD).periodSaid, 'Q2 FY 2026-27 (July to September 2026)');
    assert.equal(keepOwnerPack(project, ownerPackPeriod({ month: '2026-09' }), LEAD).periodSaid, 'September 2026');
  });

  it('is issued by a lead or a signer, kept by those who may edit, and is nobody’s outside the firm', () => {
    const project = fresh();
    setTeamMember(project, { email: 'vera@builders.example', departments: Object.fromEntries(['legal', 'finance', 'construction', 'design', 'commercial', 'procurement'].map((key) => [key, 'viewer'])) as never }, LEAD);
    assert.ok(mayIssueOwnerPack(project, { email: LEAD, role: 'staff' }), 'a lead in Finance');
    assert.ok(mayPrepareOwnerPack(project, { email: 'ravi@builders.example', role: 'staff' }) && !mayIssueOwnerPack(project, { email: 'ravi@builders.example', role: 'staff' }), 'staff edit and do not decide');
    assert.ok(!mayPrepareOwnerPack(project, { email: 'vera@builders.example', role: 'staff' }), 'a viewer in every department');
    assert.ok(!mayIssueOwnerPack(project, { email: 'sam@site.example', role: 'collaborator' }) && !mayPrepareOwnerPack(project, { email: 'sam@site.example', role: 'collaborator' }));

    keepOwnerPack(project, ownerPackPeriod({ month: '2026-09' }), LEAD);
    setReportDay(project, { day: 1, reports: ['status'], every: 'month', tell: [LEAD] }, LEAD);
    const grant: ProjectGrant = { id: 'g1', tenantId: 't1', projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: ['reports', 'commercials'], createdAt: project.createdAt, createdBy: LEAD };
    const copy = projectView(project, { kind: 'granted', grant, email: 'sam@site.example' }).project;
    assert.deepEqual([copy.ownerPacks, copy.reportDay], [[], undefined]);
  });
});

describe('the chat', () => {
  it('opens the owner pack, and a kept pack or a prepared report by its name', () => {
    const project = fresh();
    setReportDay(project, { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: [] }, LEAD);
    const [status, pack] = prepareReportsDue(project, india('2026-10-01'));
    assert.deepEqual(placeOfRecord(project, pack!.id)?.open, { pane: 'reports', extra: { item: pack!.id } });

    const ask = (question: string) => applyProjectChat(project, question, { actor: LEAD });
    const page = ask('Open the owner pack');
    assert.deepEqual(page.navigations.at(-1), { target: 'reports' });

    const byName = ask('Open the owner pack for September 2026');
    assert.deepEqual(byName.navigations.at(-1), { target: 'reports', item: pack!.id });
    assert.match(byName.assistantTurn.text, /waiting to be issued/);

    const report = ask('Show me the status report for September 2026');
    assert.deepEqual(report.navigations.at(-1), { target: 'reports', item: status!.id });
    assert.match(report.assistantTurn.text, /prepared, waiting to be issued/);

    issueOwnerPack(project, pack!.id, { actor: LEAD, name: 'Asha Rao' }, india('2026-10-04').toISOString());
    assert.match(ask('Open the owner pack for September 2026').assistantTurn.text, /issued 4 Oct 2026 by Asha Rao/);
  });
});

describe('the checklist of papers owed', () => {
  function withList(): DdProject {
    const project = fresh();
    addChecklistItems(
      project,
      'finance',
      [
        { title: 'Soil investigation report', stage: 'Concept', package: 'Civil', owedBy: 'Geotechnical consultant' },
        { title: 'Column schedule', stage: 'Tender', package: 'Civil', owedBy: 'Structural consultant' },
        { title: 'Beam schedule', stage: 'Tender', package: 'Civil', owedBy: 'Structural consultant' },
        { title: '=SUM(A1), "quoted"', owedBy: 'Structural consultant' },
      ],
      LEAD,
    );
    return project;
  }

  it('is in the status report among what waits: what nobody has asked for, by who owes it', () => {
    const project = withList();
    const period = ownerPackPeriod({ month: '2026-09' });
    const lines = () => statusReport(project, period, india('2026-10-12')).waiting.filter((line) => line.kind === 'checklist');
    assert.deepEqual(
      lines().map((line) => [line.who, line.what, line.stands, line.behind]),
      [
        ['Structural consultant', '3 papers on the checklist not in hand and not asked for: Column schedule; Beam schedule; =SUM(A1), "quoted".', 'not asked for', 'the checklist of Finance'],
        ['Geotechnical consultant', '1 paper on the checklist not in hand and not asked for: Soil investigation report.', 'not asked for', 'the checklist of Finance'],
      ],
    );
    // Asked for, a paper is a request, which the report has always listed: it is not said twice.
    raiseChecklistRequests(project, { department: 'finance' }, LEAD);
    assert.deepEqual(lines(), []);
    assert.equal(statusReport(project, period, india('2026-10-12')).waiting.filter((line) => line.kind === 'request').length, 2);
  });

  it('is in no status report somebody working from a grant reads, and a report the timer prepared is not theirs until it is issued', () => {
    const project = withList();
    addRequest(project, { title: 'Latest tax paid receipt', recipient: 'sam@site.example', send: true }, LEAD);
    setReportDay(project, { day: 1, reports: ['status'], every: 'month', tell: [] }, LEAD);
    const [made] = prepareReportsDue(project, india('2026-10-01'));
    const grant: ProjectGrant = { id: 'g1', tenantId: 't1', projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: ['reports'], createdAt: project.createdAt, createdBy: LEAD };
    const copy = () => projectView(project, { kind: 'granted', grant, email: 'sam@site.example' }).project;
    assert.deepEqual(copy().reports, [], 'prepared by the timer, and nobody has checked it');

    issueReport(project, made!.id, LEAD);
    const waiting = (on: DdProject) => on.reports[0]!.body.blocks.find((block) => block.source?.kind === 'status_waiting')!;
    assert.match(JSON.stringify(waiting(project).frozenTable), /Column schedule/, 'the firm’s own report holds the checklist as it stood');
    const theirs = waiting(copy());
    assert.doesNotMatch(JSON.stringify(copy().reports), /Column schedule|Soil investigation report|Structural consultant|on the checklist/);
    assert.deepEqual(theirs.frozenTable!.rows.map((row) => [row.cells[0], row.cells[1]]), [['1', 'Asked for and not received: Latest tax paid receipt.']]);
    assert.deepEqual([theirs.frozen!.length, theirs.frozenRecordIds!.length], [1, 1]);
    assert.match(JSON.stringify(waiting(project).frozenTable), /Column schedule/, 'and the project itself is not changed');
  });

  it('is read by the chat’s requirement tool, and is not there for somebody working from a grant', async () => {
    const project = withList();
    const run = async (on: DdProject, args: unknown) => {
      const bag = { proposals: [], navigations: [], toolCalls: [] as Array<{ name: string; summary: string }>, choices: [] };
      const tools = createProjectTools(on, 'tester', bag) as unknown as Array<{ name: string; run: (args: never, context: never) => Promise<string> | string }>;
      return { bag, said: JSON.parse(await tools.find((tool) => tool.name === 'get_requirement_sheet')!.run(args as never, undefined as never)) };
    };
    const { said, bag } = await run(project, {});
    assert.deepEqual([said.checklist.total, said.checklist.pending, said.checklist.papers.length], [4, 4, 4]);
    assert.deepEqual(said.checklist.papers[0], { title: 'Soil investigation report', stage: 'Concept', package: 'Civil', owedBy: 'Geotechnical consultant', status: 'pending' });
    assert.match(bag.toolCalls[0]!.summary, /checklist 0 of 4/);
    assert.equal((await run(project, { status: 'received' })).said.checklist.papers.length, 0);

    const grant: ProjectGrant = { id: 'g1', tenantId: 't1', projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: project.createdAt, createdBy: LEAD };
    const copy = projectView(project, { kind: 'granted', grant, email: 'sam@site.example' }).project;
    assert.equal((await run(copy, {})).said.checklist, undefined);
  });

  it('goes out as a spreadsheet, one line a paper, with nothing a spreadsheet would run', () => {
    const project = withList();
    raiseChecklistRequests(project, { department: 'finance', itemIds: [project.checklist![0]!.id], dueAt: '2026-10-30' }, LEAD);
    const csv = checklistCsv(checklistSheet(project, { department: 'finance', now: india('2026-11-02').toISOString() })).trimEnd().split('\n');
    assert.equal(csv[0], 'Stage,Package,Paper,Owed by,Status,Asked of,Due,Overdue,Received,Document,Note');
    assert.equal(csv.length, 5);
    assert.ok(csv.includes('Concept,Civil,Soil investigation report,Geotechnical consultant,Asked for,Geotechnical consultant,2026-10-30,yes,,,'), csv.join('\n'));
    assert.ok(csv.some((line) => line.includes('"\'=SUM(A1), ""quoted"""')), csv.join('\n'));
  });
});
