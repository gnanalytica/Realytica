/**
 * The cost table, as a reader of the report actually meets it.
 *
 * The unit tests in `standards.test.ts` pin the arithmetic. This pins the thing
 * that arithmetic is for: what the block PRINTS. A summary object that carries
 * `uncosted: 16` and a block that prints a confident total anyway would pass
 * every one of those tests and still mislead the only person who matters.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addAction,
  addFinding,
  classifyFinding,
  createProject,
  resolveReportBlock,
  setActionCost,
  type DdProject,
  type ReportBlock,
} from '@realytica/shared';

function file(): DdProject {
  return createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-R1');
}

function block(kind: 'remedial_cost' | 'findings'): ReportBlock {
  return { id: `blk-${kind}`, origin: 'derived', heading: kind, source: { kind }, createdAt: '', updatedAt: '' } as ReportBlock;
}

describe('the remedial cost block', () => {
  it('bands the spend and names the total it can stand behind', () => {
    const project = file();
    const now = addAction(project, { title: 'Repoint', kind: 'remediation', owner: 'QS', priority: 'high' });
    const later = addAction(project, { title: 'Reroof', kind: 'remediation', owner: 'QS', priority: 'medium' });
    setActionCost(project, now.id, { costEstimate: 400000, costBand: 'immediate' });
    setActionCost(project, later.id, { costEstimate: 1200000, costBand: 'years_1_5' });

    const lines = resolveReportBlock(project, block('remedial_cost')).lines;
    assert.ok(lines[0]!.startsWith('Immediate'), 'immediate first — that is the money that changes the price');
    // Indian digit grouping throughout — the same `en-IN` the rest of the file
    // formats money with, so 12 lakh reads as 12,00,000 rather than 1,200,000.
    assert.ok(lines.some((l) => l.includes('INR 12,00,000')));
    assert.ok(lines.some((l) => l.includes('Total of what has been priced: INR 16,00,000')));
  });

  it('says out loud what it has no figure for', () => {
    // The single most load-bearing number in a TDD report, and the easiest one
    // to read as final.
    const project = file();
    const banded = addAction(project, { title: 'Reroof', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, banded.id, { costBand: 'immediate' });
    addAction(project, { title: 'Chase the OC', kind: 'evidence_request', owner: 'Legal', priority: 'low' });

    const lines = resolveReportBlock(project, block('remedial_cost')).lines;
    assert.ok(lines.some((l) => l.includes('1 action(s), none of them priced yet')));
    assert.ok(lines.some((l) => l.includes('1 open action(s) carry no band')));
  });

  it('never prints a zero for a band nobody has priced', () => {
    // "INR 0 across 3 actions" reads as "these are free", which is the exact
    // opposite of what an unpriced band means — and it is the reading a buyer
    // would act on. Caught by looking at the rendered output, not by the
    // arithmetic tests, which were all passing.
    const project = file();
    const a = addAction(project, { title: 'Reroof', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, a.id, { costBand: 'years_1_5' });
    const lines = resolveReportBlock(project, block('remedial_cost')).lines;
    assert.ok(!lines.some((l) => /INR 0\b/.test(l)), lines.join(' | '));
  });

  it('still prints a partial band’s figure, with the shortfall beside it', () => {
    const project = file();
    const priced = addAction(project, { title: 'Repoint', kind: 'remediation', owner: 'QS', priority: 'high' });
    const bare = addAction(project, { title: 'Reroof', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, priced.id, { costEstimate: 250000, costBand: 'immediate' });
    setActionCost(project, bare.id, { costBand: 'immediate' });
    const [line] = resolveReportBlock(project, block('remedial_cost')).lines;
    assert.match(line!, /INR 2,50,000 across 2 action\(s\) — 1 of them not yet priced/);
  });

  it('returns a note rather than a fabricated zero when nothing is banded', () => {
    const project = file();
    const lines = resolveReportBlock(project, block('remedial_cost'));
    assert.deepEqual(lines.lines, []);
    assert.match(lines.note!, /No open action .* carries a remedial cost band/i);
  });

  it('walks back into the register, so a total can be argued with', () => {
    const project = file();
    const a = addAction(project, { title: 'Repoint', kind: 'remediation', owner: 'QS', priority: 'high' });
    setActionCost(project, a.id, { costEstimate: 100, costBand: 'immediate' });
    assert.deepEqual(resolveReportBlock(project, block('remedial_cost')).recordIds, [a.id]);
  });
});

describe('the findings block carries the grading a TDD reader knows', () => {
  it('leads with the condition rating and keeps the severity beside it', () => {
    const project = file();
    addFinding(project, { title: 'Facade spalling', description: 'At high level.', severity: 'critical', discipline: 'technical' });
    const [line] = resolveReportBlock(project, block('findings')).lines;
    assert.match(line!, /^\[3\] CRITICAL/);
  });

  it('prints the escalation, and prints its absence when nobody was told', () => {
    const project = file();
    const f = addFinding(project, { title: 'Lift', description: 'Brake failure.', severity: 'high', discipline: 'technical' });
    classifyFinding(project, f.id, { escalation: { immediateAction: true } });
    assert.match(resolveReportBlock(project, block('findings')).lines[0]!, /nobody recorded as notified/);

    classifyFinding(project, f.id, { escalation: { immediateAction: true, notifiedTo: 'Site manager', notifiedAt: '2026-09-01' } });
    assert.match(resolveReportBlock(project, block('findings')).lines[0]!, /Site manager notified on 2026-09-01/);
  });

  it('never prints an environmental class without the caveat that limits it', () => {
    // Borrowing ASTM's words while implying its protection would be worse than
    // never mentioning them.
    const project = file();
    const f = addFinding(project, { title: 'Prior use', description: 'Former dyeing unit.', severity: 'high', discipline: 'esg' });
    classifyFinding(project, f.id, { environmentalCondition: 'hrec' });
    const line = resolveReportBlock(project, block('findings')).lines[0]!;
    assert.match(line, /HREC/);
    assert.match(line, /India has no equivalent/);
  });
});
