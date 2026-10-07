/**
 * The engineering desk: the requirement sheet, supporting documents and the
 * summary the charts read.
 *
 * Each is a pure function of the project, so each is tested on a project
 * built here. The cases are the ones a firm doing only the technical work
 * meets: nothing on the file, documents arriving, the client's deeds on a
 * project that runs no Legal department, and the chat doing the same things
 * the screen does.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  addFinding,
  addRequest,
  commitChatProposal,
  createChatProposal,
  createProject,
  engineeringSummary,
  ensureWorkstreamChecks,
  projectDepartments,
  requirementSheet,
  requirementSheetCsv,
  requirementSheetText,
  setProjectDepartments,
  supportingDocuments,
  workstreamOfCheck,
  type DdProject,
} from '@realytica/shared';

function project(): DdProject {
  return createProject({ name: 'Engineering test', type: 'commercial', location: 'MG Road', city: 'Bengaluru', currentStage: 'operations' }, 'RYT-E1');
}

function file(p: DdProject, title: string, documentType?: string) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  if (documentType) row.documentType = documentType;
  row.attachments.push({ id: `att_${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: new Date().toISOString() });
  return row;
}

describe('the technical checks', () => {
  it('sit in Technical due diligence, where an engineering firm works', () => {
    for (const id of ['technical.structural', 'technical.mep_capacity', 'technical.fire_life_safety', 'technical.constructability', 'technical.structural_condition', 'technical.services_condition', 'technical.as_built_architecture', 'technical.statutory_record']) {
      assert.equal(workstreamOfCheck(id), 'construction.quality', id);
    }
    // The drawing register stays with Design.
    assert.equal(workstreamOfCheck('technical.drawing_register'), 'design.drawings');
  });
});

describe('the requirement sheet', () => {
  it('is empty until checks are on the file', () => {
    const sheet = requirementSheet(project(), { department: 'construction' });
    assert.equal(sheet.total, 0);
    assert.equal(sheet.percent, 0);
    assert.deepEqual(sheet.groups, []);
  });

  it('lists what the checks expect, by discipline, all pending at first', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    const sheet = requirementSheet(p, { department: 'construction' });
    assert.ok(sheet.total > 0, 'the checks expect documents');
    assert.equal(sheet.received, 0);
    assert.equal(sheet.pending, sheet.total);
    for (const discipline of ['Architecture', 'Structural', 'MEP', 'Statutory']) {
      assert.ok(sheet.groups.some((g) => g.label === discipline), `${discipline} is on an engineering sheet`);
    }
    const structural = sheet.groups.find((g) => g.label === 'Structural')!;
    assert.ok(structural.items.some((i) => i.title === 'Soil investigation report'));
    for (const g of sheet.groups) {
      assert.equal(g.received + g.requested + g.pending, g.items.length);
      for (const item of g.items) assert.ok(item.checks.length >= 1 && item.evidenceId, `${item.title} names its check and its row`);
    }
  });

  it('names a document once per discipline however many checks want it', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    const sheet = requirementSheet(p, { department: 'construction' });
    for (const g of sheet.groups) {
      const titles = g.items.map((i) => i.title.toLowerCase());
      assert.equal(new Set(titles).size, titles.length, `${g.label} repeats a document`);
    }
  });

  it('moves a line to asked for when a request goes out, and to in hand when the paper arrives', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    const first = requirementSheet(p, { department: 'construction' }).groups[0]!.items[0]!;
    addRequest(p, { title: first.title, recipient: 'The developer', dueAt: '2020-01-01', evidenceId: first.evidenceId, send: true }, 'tester');
    const asked = requirementSheet(p, { department: 'construction', now: '2026-10-03T00:00:00Z' });
    const line = asked.groups.flatMap((g) => g.items).find((i) => i.evidenceId === first.evidenceId)!;
    assert.equal(line.status, 'requested');
    assert.equal(line.askedOf, 'The developer');
    assert.equal(line.overdue, true, 'a due date in the past is overdue');
    assert.equal(asked.requested, 1);
    assert.equal(asked.overdue, 1);

    const row = p.evidence.find((e) => e.id === first.evidenceId)!;
    row.status = 'received';
    row.attachments.push({ id: 'att_x', fileName: 'answer.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'answer.pdf', uploadedAt: '2026-10-03T00:00:00Z' });
    const got = requirementSheet(p, { department: 'construction' });
    const done = got.groups.flatMap((g) => g.items).find((i) => i.evidenceId === first.evidenceId)!;
    assert.equal(done.status, 'received');
    assert.equal(done.fileName, 'answer.pdf');
    assert.equal(got.received, 1);
    assert.ok(got.percent > 0);
  });

  it('narrows to one department and widens to the project', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality', 'legal.title'], 'tester');
    const engineering = requirementSheet(p, { department: 'construction' });
    const all = requirementSheet(p);
    assert.ok(all.total > engineering.total, 'the whole project expects more than engineering does');
    const legal = requirementSheet(p, { department: 'legal' });
    assert.ok(legal.total > 0);
  });

  it('exports as a spreadsheet and as a plain list', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    const sheet = requirementSheet(p, { department: 'construction' });
    const csv = requirementSheetCsv(sheet).trim().split('\n');
    assert.equal(csv[0], 'Discipline,Document,Status,Asked of,Due,Needed for');
    assert.equal(csv.length, sheet.total + 1);
    const text = requirementSheetText(sheet, { only: 'pending' });
    assert.ok(text.includes('[ ]'));
    assert.ok(!text.includes('[x]'));
  });
});

describe('supporting documents', () => {
  it('are the filed papers whose department this project does not run', () => {
    const p = project();
    setProjectDepartments(p, ['construction'], 'tester');
    const deed = file(p, 'Sale deed 2006', 'Sale deed');
    const oc = file(p, 'Occupancy certificate', 'Occupancy certificate');
    const photo = addEvidence(p, { title: 'Lobby', kind: 'photograph', status: 'received' }, 'tester');
    photo.attachments.push({ id: 'att_p', fileName: 'lobby.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'lobby.jpg', uploadedAt: new Date().toISOString() });
    const supporting = supportingDocuments(p);
    assert.deepEqual(supporting.map((s) => s.evidence.id).sort(), [deed.id, oc.id].sort());
    assert.equal(supporting.find((s) => s.evidence.id === deed.id)!.home, 'legal.title');
    assert.ok(supporting.every((s) => s.homeLabel?.startsWith('Legal')));
  });

  it('go home on their own when the department is switched on', () => {
    const p = project();
    setProjectDepartments(p, ['construction'], 'tester');
    file(p, 'Sale deed 2006', 'Sale deed');
    assert.equal(supportingDocuments(p).length, 1);
    setProjectDepartments(p, ['construction', 'legal'], 'tester');
    assert.equal(supportingDocuments(p).length, 0);
  });

  it('stop being supporting once given to a workstream that is on', () => {
    const p = project();
    setProjectDepartments(p, ['construction'], 'tester');
    const oc = file(p, 'Occupancy certificate', 'Occupancy certificate');
    oc.workstream = 'construction.quality';
    assert.equal(supportingDocuments(p).length, 0);
  });
});

describe('the engineering summary', () => {
  it('counts checks, findings and documents by discipline', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    addFinding(p, { title: 'Chiller past its service life', description: 'Two of three chillers are 18 years old.', severity: 'high', discipline: 'technical' }, 'tester');
    addFinding(p, { title: 'Hairline cracks at podium', description: 'Non-structural.', severity: 'low', discipline: 'technical' }, 'tester');
    addFinding(p, { title: 'Unregistered partition', description: 'Title matter.', severity: 'critical', discipline: 'legal' }, 'tester');
    const summary = engineeringSummary(p, 'construction');
    const technical = summary.disciplines.find((d) => d.scopeKey === 'technical')!;
    assert.ok(technical.checks.total > 0);
    assert.equal(technical.findings.high, 1);
    assert.equal(technical.findings.low, 1);
    assert.equal(summary.findings.open, 2, 'the legal finding is not engineering’s');
    assert.equal(summary.findings.bySeverity.critical, 0);
    assert.equal(summary.checks.answered, 0);
    assert.equal(summary.documents.total, requirementSheet(p, { department: 'construction' }).total);
  });
});

describe('the chat doing what the screen does', () => {
  it('changes the departments only when an admin approves', () => {
    const p = project();
    const card = createChatProposal('set_departments', 'Run Engineering only', 'Asked for in chat', 'The project shows one department', { departments: ['construction'] }, 'tester');
    p.chatProposals.push(card);
    assert.throws(() => commitChatProposal(p, card.id, 'tester'), /workspace admin/);
    assert.equal(projectDepartments(p).length, 6, 'nothing changed without an admin');
    commitChatProposal(p, card.id, 'tester', { admin: true });
    assert.deepEqual(projectDepartments(p), ['construction']);
  });

  it('asks for documents, one tracked request per paper', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['construction.quality'], 'tester');
    const items = requirementSheet(p, { department: 'construction' }).groups.flatMap((g) => g.items).slice(0, 3);
    const card = createChatProposal('request_documents', 'Ask the developer for 3 documents', 'They are missing', 'Three requests go out', { evidenceIds: items.map((i) => i.evidenceId), recipient: 'The developer', dueAt: '2026-10-20' }, 'tester');
    p.chatProposals.push(card);
    commitChatProposal(p, card.id, 'tester');
    const sheet = requirementSheet(p, { department: 'construction' });
    assert.equal(sheet.requested, 3);
    assert.equal((p.requests ?? []).length, 3);
    assert.ok((p.requests ?? []).every((r) => r.recipient === 'The developer' && r.status === 'sent'));
  });

  it('gives a supporting document to a workstream', () => {
    const p = project();
    setProjectDepartments(p, ['construction'], 'tester');
    const oc = file(p, 'Occupancy certificate', 'Occupancy certificate');
    const card = createChatProposal('assign_document', 'Use the occupancy certificate in Technical due diligence', 'It evidences the technical review', 'The document appears under Technical due diligence', { evidenceId: oc.id, workstream: 'construction.quality' }, 'tester');
    p.chatProposals.push(card);
    commitChatProposal(p, card.id, 'tester');
    assert.equal(oc.workstream, 'construction.quality');
    assert.equal(supportingDocuments(p).length, 0);
  });
});
