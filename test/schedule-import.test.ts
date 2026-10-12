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
import { deflateRawSync } from 'node:zlib';
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

  it('reads the month before the day when told the sheet writes it so', () => {
    assert.equal(readScheduleDay('10/12/2026', true), '2026-10-12');
    assert.equal(readScheduleDay('10/25/26', true), '2026-10-25');
    assert.equal(readScheduleDay('25/10/2026', true), undefined);
    // A date that says which is which reads the same either way.
    for (const text of ['2026-10-12', '12 Oct 2026']) assert.equal(readScheduleDay(text, true), '2026-10-12', text);
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

  it('reads a percentage column of 0 and 1 as written: one percent is not all of it', () => {
    const read = (cells: string[]) => parseScheduleTable(['Milestone,Finish,% Complete', ...cells.map((cell, i) => `Activity ${i},30-11-2026,${cell}`)].join('\n')).rows.map((row) => row.percent);
    assert.deepEqual(read(['0', '1']), [0, 1]);
    assert.deepEqual(read(['1', '1', '']), [1, 1, undefined]);
    assert.deepEqual(read(['0', '0']), [0, 0]);
    // A value strictly between 0 and 1 is what says the column is fractions, at either edge.
    assert.deepEqual(read(['0', '1', '0.01']), [0, 100, 1]);
    assert.deepEqual(read(['0', '1', '0.99']), [0, 100, 99]);
    // And one above 1, or a percent sign, says it is not.
    assert.deepEqual(read(['0.5', '2']), [1, 2]);
    assert.deepEqual(read(['1%', '0']), [1, 0]);

    const p = project();
    importSchedule(p, parseScheduleTable('Milestone,Finish,% Complete\nPlinth,30-11-2026,1\nFrame,30-06-2027,0').rows, PM, '2026-11-10T04:00:00.000Z');
    assert.deepEqual(p.milestones!.map((m) => [m.percent, m.completedOn]), [[1, undefined], [0, undefined]], 'a milestone at one percent is not complete');
  });

  it('reads a column month first when a date in it can be read no other way, and says so', () => {
    const us = parseScheduleTable('Activity,Start,Finish\nPlinth,10/01/2026,10/12/2026\nFrame,10/13/2026,10/25/2026\nFinishes,11/01/2026,12/05/26');
    assert.deepEqual(us.rows, [
      { name: 'Plinth', plannedStart: '2026-10-01', plannedFinish: '2026-10-12' },
      { name: 'Frame', plannedStart: '2026-10-13', plannedFinish: '2026-10-25' },
      { name: 'Finishes', plannedStart: '2026-11-01', plannedFinish: '2026-12-05' },
    ]);
    assert.deepEqual(us.skipped, []);
    assert.deepEqual(us.notes, [
      'The planned start dates were read with the month first, as 10/25/2026 is written.',
      'The planned finish dates were read with the month first, as 10/25/2026 is written.',
    ]);

    // Nothing in the column says month first: the day comes first, as before, and nothing is noted.
    const here = parseScheduleTable('Activity,Finish\nPlinth,10/12/2026\nFrame,12/12/2026');
    assert.deepEqual([here.rows.map((row) => row.plannedFinish), here.notes], [['2026-12-10', '2026-12-12'], []]);
    // The edge: a second part of 12 says nothing, 13 does.
    assert.deepEqual(parseScheduleTable('Activity,Finish\nPlinth,10/12/2026\nFrame,11/13/2026').rows.map((row) => row.plannedFinish), ['2026-10-12', '2026-11-13']);
    // Each column by its own dates.
    const mixed = parseScheduleTable('Activity,Start,Finish\nPlinth,01/10/2026,10/25/2026');
    assert.deepEqual([mixed.rows, mixed.notes.length], [[{ name: 'Plinth', plannedStart: '2026-10-01', plannedFinish: '2026-10-25' }], 1]);
    // A column that says both is read day first, and the row that is no date that way is handed back.
    const both = parseScheduleTable('Activity,Finish\nPlinth,25/10/2026\nFrame,10/25/2026');
    assert.deepEqual([both.rows.map((row) => row.plannedFinish), both.skipped, both.notes], [['2026-10-25'], [{ line: 3, name: 'Frame', reason: '“10/25/2026” is not a date.' }], []]);
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

  it('reads an Excel cell as it is shown: formatted text, a formula, a link, and a cell in error as nothing', async () => {
    const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Schedule');
    sheet.addRow(['Activity', 'Planned finish', 'Weight', '% Complete']);
    sheet.addRow([{ richText: [{ font: { bold: true }, text: 'Plinth' }, { text: ' and footings' }] }, '30/11/2026', { formula: '2+3', result: 5 }, 40]);
    sheet.addRow([{ text: 'Frame', hyperlink: 'https://example.com/frame' }, { formula: 'DATE(2027,3,31)', result: new Date(Date.UTC(2027, 2, 31)) }, 30, { error: '#REF!' }]);
    sheet.addRow([{ formula: 'A1&"x"', result: { error: '#NAME?' } }, '30/06/2027', 1, 0]);
    const text = await tableTextOf({ originalname: 'schedule.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    assert.doesNotMatch(text, /object Object/);
    const { rows, skipped } = parseScheduleTable(text);
    assert.deepEqual(rows, [
      { name: 'Plinth and footings', plannedFinish: '2026-11-30', weight: 5, percent: 40 },
      { name: 'Frame', plannedFinish: '2027-03-31', weight: 30 },
    ]);
    assert.deepEqual(skipped, [{ line: 4, name: '', reason: 'No name.' }]);
  });

  it('does not open a workbook whose sheets unpack to more than may be opened', async () => {
    // A sheet of 5 MB of spaces packs to a few kilobytes, and says of itself that it unpacks to nothing.
    const packed = deflateRawSync(Buffer.alloc(5 * 1024 * 1024, 0x20));
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + packed.length, 16);
    const buffer = Buffer.concat([local, name, packed, central, name, end]);
    assert.ok(buffer.length < 100_000, 'small enough to be sent');
    await assert.rejects(tableTextOf({ originalname: 'schedule.xlsx', buffer }), /^Error: That workbook is too large to open: its sheets hold more than 4 MB\.$/);
    await assert.rejects(tableTextOf({ originalname: 'schedule.xlsx', buffer: Buffer.from('not a workbook at all, only some words long enough to look for an index in') }), /does not look like an Excel workbook/);
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

  it('on a second import takes a percent higher than the one recorded as a reading of that day, and never a lower one', () => {
    const p = project();
    importSchedule(p, parseScheduleTable('Activity,Finish,% Complete\nPlinth,30-11-2026,40\nFrame,31-03-2027,20\nFinishes,30-06-2027,10').rows, PM, '2026-11-10T04:00:00.000Z');
    const [plinth, frame, finishes] = p.milestones!;

    const again = importSchedule(p, parseScheduleTable('Activity,Finish,% Complete\nPlinth,30-11-2026,100\nFrame,31-03-2027,15\nFinishes,30-06-2027,10').rows, 'planner@example.com', '2026-11-24T04:00:00.000Z');
    assert.deepEqual(again, { added: 0, updated: 1, unchanged: 2 });
    assert.deepEqual(
      { percent: plinth!.percent, readings: plinth!.readings, completedOn: plinth!.completedOn, by: plinth!.updatedBy },
      { percent: 100, readings: [{ on: '2026-11-10', percent: 40 }, { on: '2026-11-24', percent: 100 }], completedOn: '2026-11-24', by: 'planner@example.com' },
    );
    assert.deepEqual({ percent: frame!.percent, readings: frame!.readings, by: frame!.updatedBy }, { percent: 20, readings: [{ on: '2026-11-10', percent: 20 }], by: PM }, 'a lower percent is left out');
    assert.deepEqual({ percent: finishes!.percent, readings: finishes!.readings }, { percent: 10, readings: [{ on: '2026-11-10', percent: 10 }] }, 'the same percent is no new reading');

    // One point more is taken; a sheet with no percent column changes nothing.
    assert.deepEqual(importSchedule(p, parseScheduleTable('Activity,Finish,% Complete\nFrame,31-03-2027,21').rows, PM, '2026-11-25T04:00:00.000Z'), { added: 0, updated: 1, unchanged: 0 });
    assert.equal(frame!.percent, 21);
    assert.deepEqual(importSchedule(p, parseScheduleTable('Activity,Finish\nFrame,31-03-2027').rows, PM, '2026-11-26T04:00:00.000Z'), { added: 0, updated: 0, unchanged: 1 });
    assert.equal(frame!.percent, 21);
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
