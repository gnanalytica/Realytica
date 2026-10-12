/**
 * "Today" is the day it is in India, and the checklist's spreadsheet.
 *
 * India is five and a half hours ahead of UTC, so from midnight to half past
 * five there the UTC day is still yesterday. Whatever compares a day with
 * today, or picks the quarter it is, goes by India's day: an action due the
 * 12th is overdue as the 13th begins there, and the quarter turns at
 * midnight there. `tenders.test.ts` holds the same for a tender's stages.
 *
 * Then the checklist as a spreadsheet: nothing in it runs as a formula, a
 * line stays one line, and the file says it is UTF-8.
 *
 * The project, the people and the papers are invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acrossProjects,
  addAction,
  addEvidence,
  checklistCsv,
  checklistCsvFile,
  createProject,
  departmentAnalytics,
  indiaToday,
  quarterHolding,
  quartersBefore,
  type ChecklistSheet,
} from '@realytica/shared';

const WHO = 'lead@firm.example';

describe('today', () => {
  it('is the day in India, as YYYY-MM-DD', () => {
    assert.equal(indiaToday(new Date('2026-10-12T06:00:00.000Z')), '2026-10-12');
    // Midnight in India is half past six the evening before in UTC.
    assert.equal(indiaToday(new Date('2026-10-12T18:29:59.999Z')), '2026-10-12');
    assert.equal(indiaToday(new Date('2026-10-12T18:30:00.000Z')), '2026-10-13');
    assert.equal(indiaToday(new Date('2026-10-12T20:30:00.000Z')), '2026-10-13', 'two in the morning of the 13th');
    assert.equal(indiaToday(new Date('2026-12-31T19:00:00.000Z')), '2027-01-01');
    assert.equal(indiaToday(new Date('2028-02-28T18:30:00.000Z')), '2028-02-29');
  });

  it('is what the figures across projects call today, and what makes an action overdue', () => {
    const night = new Date('2026-10-12T20:30:00.000Z');
    assert.equal(acrossProjects([], night).today, '2026-10-13');

    const project = createProject({ name: 'Night Block', type: 'residential', location: 'Ward 4', city: 'Kadamba', currentStage: 'construction' }, 'RYT-IN1', WHO);
    const deed = addEvidence(project, { title: 'Sale deed', kind: 'document', status: 'received' }, WHO);
    deed.workstream = 'legal.title';
    addAction(project, { title: 'Get the mother deed', kind: 'clarification', owner: 'asha@firm.example', priority: 'high', dueDate: '2026-10-12', evidenceIds: [deed.id] }, WHO);
    addAction(project, { title: 'Confirm the survey number', kind: 'clarification', owner: 'asha@firm.example', priority: 'low', dueDate: '2026-10-13', evidenceIds: [deed.id] }, WHO);
    const legal = (at: Date) => departmentAnalytics(project, at).departments.find((d) => d.label === 'Legal')!;
    assert.deepEqual(legal(night).actionsOverdue.rows.map((row) => row.title), ['Get the mother deed'], 'due the 12th is overdue once the 13th has begun in India');
    assert.deepEqual(legal(new Date('2026-10-12T18:00:00.000Z')).actionsOverdue.rows, [], 'and not at half past eleven on the 12th');
  });

  it('is what the quarter it is goes by', () => {
    // Two in the morning of 1 October in India: the quarter has turned.
    const turned = new Date('2026-09-30T20:30:00.000Z');
    assert.equal(quarterHolding(turned).from, '2026-10-01T00:00:00.000Z');
    assert.equal(quarterHolding(turned, -1).from, '2026-07-01T00:00:00.000Z');
    assert.deepEqual(quartersBefore(turned, 'financial', 2).map((quarter) => quarter.key), ['FY2026-Q3', 'FY2026-Q2']);
    // Half past eleven on 30 September there: it has not.
    assert.equal(quarterHolding(new Date('2026-09-30T18:00:00.000Z')).from, '2026-07-01T00:00:00.000Z');
    // The year turns with it.
    assert.equal(quarterHolding(new Date('2026-12-31T20:00:00.000Z')).from, '2027-01-01T00:00:00.000Z');
    assert.equal(quarterHolding(new Date('2026-10-12T06:00:00.000Z')).from, '2026-10-01T00:00:00.000Z');
  });
});

describe('the checklist as a spreadsheet', () => {
  /** A sheet of one line, with these words in it. */
  const sheet = (over: { title: string; owedBy?: string; note?: string }): ChecklistSheet => {
    const line = { item: { id: 'cl_1', department: 'finance', title: over.title, ...(over.owedBy ? { owedBy: over.owedBy } : {}), ...(over.note ? { note: over.note } : {}) }, status: 'pending', overdue: false };
    return { stages: [{ stage: 'No stage', packages: [{ package: 'No package', lines: [line] }] }], total: 1, received: 0, requested: 0, pending: 1, overdue: 0, toConfirm: 0, percent: 0, owing: [] } as unknown as ChecklistSheet;
  };
  const cells = (csv: string): string => csv.slice(csv.indexOf('\n') + 1);

  it('gives a cell that opens with a tab or a carriage return as text, as it does one that opens with a sign', () => {
    assert.match(cells(checklistCsv(sheet({ title: 'Bill', owedBy: '\t=1+1' }))), /,'\t=1\+1,/);
    assert.match(cells(checklistCsv(sheet({ title: 'Bill', owedBy: '\r=1+1' }))), /,"'\r=1\+1",/);
    for (const sign of ['=', '+', '-', '@']) assert.ok(cells(checklistCsv(sheet({ title: `${sign}SUM(A1)` }))).includes(`,'${sign}SUM(A1),`), sign);
  });

  it('quotes a carriage return, so a line stays one line', () => {
    assert.ok(cells(checklistCsv(sheet({ title: 'Bill', note: 'a\rb' }))).endsWith(',"a\rb"\n'));
    assert.ok(cells(checklistCsv(sheet({ title: 'नक्शा, "final"' }))).includes(',"नक्शा, ""final""",'));
  });

  it('is downloaded after a byte-order mark, so Excel reads Indian scripts', () => {
    const held = sheet({ title: 'ನಕ್ಷೆ — नक्शा' });
    const file = checklistCsvFile(held);
    assert.equal(file.charCodeAt(0), 0xfeff);
    assert.equal(file.slice(1), checklistCsv(held));
    assert.deepEqual([...Buffer.from(file, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(file.includes('ನಕ್ಷೆ — नक्शा'));
  });
});
