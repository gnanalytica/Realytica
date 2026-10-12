/**
 * Bringing a schedule in from a spreadsheet: the columns in any order, the
 * dates as they are written here, the rows that could not be read handed
 * back with the reason, and a second import that moves the dates and leaves
 * what site has reported alone.
 *
 * Every project, activity and date is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { addMilestones, createProject, importSchedule, parseScheduleTable, readScheduleDay, setMilestonePercent, type DdProject } from '@realytica/shared';
import { tableTextOf } from '../apps/api/src/documents/table-file';

const PM = 'pm@example.com';

function project(): DdProject {
  return createProject({ name: 'Lakeview block A', type: 'residential', location: 'Lakeview', city: 'Mysuru' }, 'RYT-SI1');
}

describe('a date as a schedule writes it', () => {
  it('reads the common forms, the day before the month', () => {
    for (const text of ['2026-10-12', '12-10-2026', '12/10/26', '12.10.2026', '12 Oct 2026', '12-Oct-26', '12 October 2026', '2026-10-12T00:00:00.000Z']) {
      assert.equal(readScheduleDay(text), '2026-10-12', text);
    }
    assert.equal(readScheduleDay('3/4/2027'), '2027-04-03');
  });

  it('reads nothing from a day that is not on the calendar', () => {
    for (const text of ['31-02-2026', '12/13/2026', 'next month', '', '12 Okt 2026']) assert.equal(readScheduleDay(text), undefined, text);
  });
});

describe('a schedule read from a table', () => {
  it('takes the columns in any order, with commas or tabs', () => {
    const commas = parseScheduleTable('Planned finish,Weight,Activity,Planned start,% Complete\n30-11-2026,5,Plinth,01-11-2026,40%\n2027-03-31,30,"Superstructure, frame",01/12/26,0');
    assert.deepEqual(commas.rows, [
      { name: 'Plinth', plannedStart: '2026-11-01', plannedFinish: '2026-11-30', weight: 5, percent: 40 },
      { name: 'Superstructure, frame', plannedStart: '2026-12-01', plannedFinish: '2027-03-31', weight: 30, percent: 0 },
    ]);
    assert.deepEqual(commas.skipped, []);

    const tabs = parseScheduleTable('Task Name\tStart\tFinish\nPlinth\t1 Nov 2026\t30 Nov 2026');
    assert.deepEqual(tabs.rows, [{ name: 'Plinth', plannedStart: '2026-11-01', plannedFinish: '2026-11-30' }]);
  });

  it('reads a percentage column Excel kept as fractions', () => {
    const { rows } = parseScheduleTable('Milestone,Finish,% Complete\nPlinth,30-11-2026,0.45\nFinishes,30-06-2027,1');
    assert.deepEqual(rows.map((row) => row.percent), [45, 100]);
  });

  it('hands back each row it could not bring in, with the reason', () => {
    const { rows, skipped } = parseScheduleTable(
      ['Activity,Start,Finish', 'Plinth,01-11-2026,30-11-2026', 'Masonry,,', 'Finishes,,31-02-2027', 'Services,soon,30-04-2027', 'External works,01-06-2027,01-05-2027', 'PLINTH ,,15-12-2026', ',,01-01-2027'].join('\n'),
    );
    assert.deepEqual(rows.map((row) => row.name), ['Plinth']);
    assert.deepEqual(skipped, [
      { line: 3, name: 'Masonry', reason: 'No planned finish.' },
      { line: 4, name: 'Finishes', reason: '“31-02-2027” is not a date.' },
      { line: 5, name: 'Services', reason: '“soon” is not a date.' },
      { line: 6, name: 'External works', reason: 'Planned start is after planned finish.' },
      { line: 7, name: 'PLINTH', reason: 'Same name as a row above.' },
      { line: 8, name: '', reason: 'No name.' },
    ]);
  });

  it('refuses a table with no name or no finish column', () => {
    assert.throws(() => parseScheduleTable('Start,Finish\n01-11-2026,30-11-2026'), /Activity or Milestone column/);
    assert.throws(() => parseScheduleTable('Activity,Start\nPlinth,01-11-2026'), /Planned finish column/);
    assert.throws(() => parseScheduleTable('Activity,Finish'), /header row and at least one row/);
  });

  it('reads an Excel sheet, a date cell as its day', async () => {
    const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Schedule');
    sheet.addRow(['Activity', 'Planned start', 'Planned finish', 'Weight']);
    sheet.addRow(['Plinth', new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 10, 30)), 5]);
    sheet.addRow(['Finishes, internal', null, '30/06/2027', 13]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows, skipped } = parseScheduleTable(await tableTextOf({ originalname: 'Schedule.XLSX', buffer }));
    assert.deepEqual(rows, [
      { name: 'Plinth', plannedStart: '2026-11-01', plannedFinish: '2026-11-30', weight: 5 },
      { name: 'Finishes, internal', plannedFinish: '2027-06-30', weight: 13 },
    ]);
    assert.deepEqual(skipped, []);
  });
});

describe('a schedule put on the project', () => {
  it('adds what is new, with its dates, weight and progress', () => {
    const p = project();
    const result = importSchedule(p, parseScheduleTable('Activity,Start,Finish,Weight,% Complete\nPlinth,01-11-2026,30-11-2026,5,40\nFinishes,,30-06-2027,,').rows, PM, '2026-11-10T04:00:00.000Z');
    assert.deepEqual(result, { added: 2, updated: 0, unchanged: 0 });
    const [plinth, finishes] = p.milestones!;
    assert.deepEqual(
      { start: plinth!.plannedStart, finish: plinth!.plannedFinish, baseline: plinth!.baselineFinish, weight: plinth!.weight, percent: plinth!.percent, readings: plinth!.readings },
      { start: '2026-11-01', finish: '2026-11-30', baseline: '2026-11-30', weight: 5, percent: 40, readings: [{ on: '2026-11-10', percent: 40 }] },
    );
    assert.deepEqual({ weight: finishes!.weight, percent: finishes!.percent, start: finishes!.plannedStart }, { weight: 1, percent: 0, start: undefined });
  });

  it('on a second import moves the dates of a milestone it names again, and keeps its recorded progress', () => {
    const p = project();
    importSchedule(p, parseScheduleTable('Activity,Start,Finish,Weight\nPlinth,01-11-2026,30-11-2026,5').rows, PM);
    const plinth = p.milestones![0]!;
    setMilestonePercent(p, plinth.id, 35, 'site@example.com', '2026-11-12T10:00:00.000Z');
    setMilestonePercent(p, plinth.id, 55, 'site@example.com', '2026-11-19T10:00:00.000Z');

    const again = importSchedule(p, parseScheduleTable('Milestone,Finish,Weight,Progress\n  plinth ,15-12-2026,6,0\nMasonry,28-02-2027,12,0').rows, PM);
    assert.deepEqual(again, { added: 1, updated: 1, unchanged: 0 });
    assert.equal(p.milestones!.length, 2);
    assert.equal(p.milestones![0], plinth, 'the same milestone, not a second one');
    assert.equal(plinth.name, 'Plinth');
    assert.equal(plinth.percent, 55);
    assert.deepEqual(plinth.readings, [
      { on: '2026-11-12', percent: 35 },
      { on: '2026-11-19', percent: 55 },
    ]);
    assert.deepEqual({ start: plinth.plannedStart, finish: plinth.plannedFinish, weight: plinth.weight }, { start: '2026-11-01', finish: '2026-12-15', weight: 6 });
  });

  it('keeps the first planned finish as the baseline through every later re-plan', () => {
    const p = project();
    const sheet = (finish: string) => parseScheduleTable(`Activity,Finish\nPlinth,${finish}`).rows;
    importSchedule(p, sheet('30-11-2026'), PM);
    importSchedule(p, sheet('15-12-2026'), PM);
    importSchedule(p, sheet('10-01-2027'), PM);
    assert.deepEqual({ baseline: p.milestones![0]!.baselineFinish, finish: p.milestones![0]!.plannedFinish }, { baseline: '2026-11-30', finish: '2027-01-10' });
    assert.deepEqual(importSchedule(p, sheet('10-01-2027'), PM), { added: 0, updated: 0, unchanged: 1 });
  });

  it('gives a milestone from before baselines were kept the finish it had as its baseline', () => {
    const p = project();
    addMilestones(p, [{ name: 'Plinth', weight: 5 }], PM);
    p.milestones![0]!.plannedFinish = '2026-11-30';
    importSchedule(p, parseScheduleTable('Activity,Finish\nPlinth,15-12-2026').rows, PM);
    assert.equal(p.milestones![0]!.baselineFinish, '2026-11-30');
  });
});
