/**
 * What looks wrong in a project's memory.
 *
 * One reading of memory against itself and the record finds seven kinds of
 * thing, the gravest first, and changes nothing. A memory that holds what
 * the record gives, with nothing waiting long, is found clean. The chat's
 * one line counts each kind and says the first.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEM_LINT_KINDS,
  MEM_SCHEMA,
  addDecision,
  addEvidence,
  allChecks,
  checkSchema,
  createAssessment,
  createProject,
  memAsksForLint,
  memFactRev,
  memFactsRev,
  memLint,
  memLintLine,
  memThought,
  memWho,
  memoryDelta,
  memoryFacts,
  patchProject,
  recordCheckFields,
  reviewFacts,
  type DdProject,
  type DocumentFact,
  type MemFact,
  type MemHeld,
} from '@realytica/shared';

const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';
const NOW = '2026-10-06T12:00:00.000Z';

const value = (key: string, held: DocumentFact['value'], display = String(held)): DocumentFact => ({ key, label: key, value: held, display, page: 1, quote: `${key}: ${display}`, review: 'proposed' });

/** Memory as it stands when it has been told this copy of the record, whole. */
function toldOf(project: DdProject): MemHeld {
  const held = memoryFacts(project).held;
  return { held, stands: { ...memoryDelta(project, {}).through, schema: MEM_SCHEMA, factsRev: memFactsRev(new Map(held.map((fact) => [fact.id, memFactRev(fact)]))) } };
}

function plot() {
  const project = createProject({ name: 'Linted plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-LINT');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const khata = addEvidence(project, { title: 'Khata of the plot', kind: 'document' }, LEAD);
  khata.documentType = 'Khata certificate and extract';
  khata.facts = [value('extent_khata', 1100.9, '11,850 sq ft'), value('khata_number', '1234/56')];
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER);
  return { project, khata };
}

describe('a reading of memory for what looks wrong', () => {
  it('finds nothing in a memory that holds what the record gives, and changes nothing by looking', () => {
    const { project } = plot();
    const memory = toldOf(project);
    const before = JSON.stringify([project, memory]);
    assert.deepEqual(memLint(project, memory, NOW), []);
    assert.equal(JSON.stringify([project, memory]), before, 'neither the record nor memory is touched');
    assert.equal(memLintLine([]), 'Nothing looks wrong in this project’s memory.');
  });

  it('lists each of the seven kinds, the gravest first, each in a sentence made of the facts’ own labels and values', () => {
    const { project, khata } = plot();
    // A person typed a land area with no paper behind it, and recorded a field on a check the same way.
    patchProject(project, { landAreaSqm: 1210 }, LEAD);
    const check = allChecks(project).find((held) => checkSchema(held).fields.some((field) => field.kind === 'number' && field.proof !== 'required'))!;
    const field = checkSchema(check).fields.find((held) => held.kind === 'number' && held.proof !== 'required')!;
    recordCheckFields(project, check.id, { [field.key]: Math.max(field.min ?? 0, 1) + 1 }, VALUER);
    const told = toldOf(project);
    const extent = told.held.find((fact) => fact.id.endsWith(`${khata.id}::extent_khata::a`))!;
    const area = told.held.find((fact) => fact.id.endsWith('::land_area'))!;
    const waiting = told.held.find((fact) => fact.id.endsWith(`${khata.id}::khata_number::r`))!;

    const held: MemFact[] = [
      // The khata number has waited three weeks.
      ...told.held.map((fact) => (fact.id === waiting.id ? { ...fact, recordedAt: '2026-09-15T12:00:00.000Z' } : fact)),
      // A second approved extent for the same paper, and a waiting one that differs from the approved.
      { ...extent, id: `${extent.id}~1`, value: 1096.2, display: '11,800 sq ft' },
      { ...extent, id: extent.id.replace('::a', '::r'), tag: 'proposed', by: undefined, at: undefined, readBy: 'model', stands: false, value: 1200, display: '12,917 sq ft' },
      // An approved fact about a paper the record no longer holds, and a note about the same.
      { ...extent, id: `${project.id}::fact::ev_gone::extent_khata::a`, aboutId: 'ev_gone', source: 'ev_gone' },
      memThought(project.id, { note: 'The earlier khata was withdrawn.', aboutId: 'ev_gone', turnId: 'cht_1', at: NOW })!,
    ];
    // And the record has moved on since memory was told: the land area was changed, and a decision recorded.
    patchProject(project, { landAreaSqm: 1250 }, LEAD);
    addDecision(project, { title: 'Hold the advance', decisionType: 'hold_payment', decisionMaker: 'Lead', rationale: 'Waiting on a paper.' }, LEAD);

    const findings = memLint(project, { held, stands: told.stands }, NOW);
    assert.deepEqual([...new Set(findings.map((finding) => finding.kind))], [...MEM_LINT_KINDS], 'every kind, in the order of their gravity');
    const of = (kind: string) => findings.filter((finding) => finding.kind === kind);
    assert.equal(of('approved_disagree')[0]!.says, 'Two approved values for Extent per khata differ: 11,850 sq ft and 11,800 sq ft.');
    assert.equal(of('proposal_contradicts')[0]!.says, 'A waiting value for Extent per khata (12,917 sq ft) differs from the approved one (11,850 sq ft).');
    assert.ok(of('dropped_by_record').some((finding) => finding.factIds[0] === `${project.id}::fact::ev_gone::extent_khata::a`));
    assert.match(of('behind_record')[0]!.says, /^Memory is behind the record: \d+ facts? differ and 1 event is not told yet\.$/);
    assert.deepEqual(of('about_nothing').map((finding) => finding.says).sort(), ['A note is about a record the project no longer holds.', 'Extent per khata is about a record the project no longer holds.']);
    assert.deepEqual(of('no_source').map((finding) => finding.says).sort(), [`${field.label} (${Math.max(field.min ?? 0, 1) + 1}${field.unit ? ` ${field.unit}` : ''}) is approved with no paper behind it.`, 'Land area (1210) is approved with no paper behind it.'].sort());
    assert.equal(of('waiting_too_long')[0]!.says, 'Khata number (1234/56) has waited 21 days for a decision.');
    assert.equal(area.by, memWho(project.id, LEAD));

    const line = memLintLine(findings);
    assert.match(line, new RegExp(`^In this project’s memory, ${findings.length} things look wrong: 1 pair of approved values that differ, `));
    assert.ok(line.endsWith(`The first: ${findings[0]!.says}`), 'the chat’s one line counts each kind and says the first');
  });

  it('is asked for by a question about what looks wrong in memory, and by no other', () => {
    for (const question of ['What looks wrong in memory?', 'Is anything wrong in this project’s memory?', 'lint the memory', 'Check the memory please']) assert.ok(memAsksForLint(question), question);
    for (const question of ['What looks wrong with the title?', 'What is in memory about the khata?', 'What is the land area?']) assert.ok(!memAsksForLint(question), question);
  });
});
