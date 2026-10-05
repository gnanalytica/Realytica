/**
 * The chat a person actually has with a file — answers, commands, and the
 * sentences that used to go to the wrong place.
 *
 * Every case here is something that was observed going wrong through the
 * running product: "add a risk" creating an asset called "a risk", "open the
 * evidence register" opening a valuation check, a factual question turning
 * into an apology because no model was configured.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEvidence,
  addFinding,
  answerFromFile,
  applyProjectChat,
  createAssessment,
  createProject,
  findingSeverityRequested,
  looksLikeFileQuestion,
  reportKindRequested,
  wantsDeterministicProjectChat,
  type DdProject,
  type DocumentFact,
} from '@realytica/shared';

function fact(key: string, label: string, value: string | number | boolean, display: string, page: number, quote: string): DocumentFact {
  return { key, label, value, display, page, quote };
}

/** A file with a read sale deed, khata and EC on it — facts as the reader writes them. */
function readFile(): DdProject {
  const project = createProject({ name: 'Whitefield Tech Park Block C', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-J');
  const at = new Date().toISOString();
  const deed = addEvidence(project, { title: 'Sale deed (registered conveyance)', kind: 'document', status: 'received' });
  deed.documentType = 'Sale deed';
  deed.attachments.push({ id: 'a1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k1', uploadedAt: at } as never);
  deed.facts = [
    fact('purchaser', 'Purchaser', 'Whitefield Tech Parks LLP', 'Whitefield Tech Parks LLP', 1, 'IN FAVOUR OF Whitefield Tech Parks LLP'),
    fact('vendor', 'Vendor', 'Sunrise Estates Private Limited', 'Sunrise Estates Private Limited', 1, 'BY Sunrise Estates Private Limited'),
    fact('registration_date', 'Registered on', '2019-03-12', '12 Mar 2019', 3, 'Registered … on 12-03-2019.'),
    fact('survey_numbers', 'Survey number', '118/2', 'Sy. No. 118/2', 2, 'bearing Survey No. 118/2'),
    fact('extent_title', 'Extent per title', 12000, '12,000 sqm', 2, 'measuring 12,000 square metres'),
  ];
  const khata = addEvidence(project, { title: 'Khata extract + khata certificate', kind: 'document', status: 'received' });
  khata.documentType = 'Khata certificate and extract';
  khata.attachments.push({ id: 'a2', fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k2', uploadedAt: at } as never);
  khata.facts = [
    fact('owner', 'Owner on the khata', 'Whitefield Tech Parks LLP', 'Whitefield Tech Parks LLP', 1, 'Name of the owner: Whitefield Tech Parks LLP'),
    fact('extent_khata', 'Extent per khata', 11850, '11,850 sqm', 1, 'Site area: 11,850 square metres'),
  ];
  const ec = addEvidence(project, { title: 'Encumbrance certificate (Form 15/16, 30-year)', kind: 'document', status: 'received' });
  ec.documentType = 'Encumbrance certificate';
  ec.attachments.push({ id: 'a3', fileName: 'ec.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k3', uploadedAt: at } as never);
  ec.facts = [
    fact('ec_from', 'EC searched from', '1995-04-01', '1 Apr 1995', 1, 'from 01-04-1995'),
    fact('ec_to', 'EC searched to', '2025-03-31', '31 Mar 2025', 1, 'to 31-03-2025'),
    fact('ec_nil', 'Nil result', false, 'no — charges on record', 1, 'Mortgage by deposit of title deeds'),
    fact('subsisting_charges', 'Charges still subsisting', 1, '1', 1, 'Mortgage by deposit of title deeds'),
  ];
  addFinding(project, { title: 'Subsisting mortgage on the EC', description: 'From the EC.', severity: 'critical', discipline: 'legal' });
  return project;
}

function tools(result: ReturnType<typeof applyProjectChat>): string[] {
  return (result.assistantTurn.toolCalls ?? []).map((t) => t.name);
}

describe('answering from the file', () => {
  it('names the owner with the documents and pages behind it', () => {
    const out = applyProjectChat(readFile(), 'who owns the property?');
    assert.deepEqual(tools(out), ['answer_from_file']);
    assert.match(out.assistantTurn.text, /Whitefield Tech Parks LLP/);
    assert.match(out.assistantTurn.text, /p\.1/);
    assert.match(out.assistantTurn.text, /same name/);
  });

  it('puts every extent side by side and says how far apart they are', () => {
    const out = applyProjectChat(readFile(), 'what is the extent?');
    assert.match(out.assistantTurn.text, /12,000 sqm/);
    assert.match(out.assistantTurn.text, /11,850 sqm/);
    assert.match(out.assistantTurn.text, /differ by 1\.3%/);
  });

  it('answers "what is the encumbrance status" from the EC, not with a summary', () => {
    const out = applyProjectChat(readFile(), 'what is the encumbrance status?');
    assert.match(out.assistantTurn.text, /NOT clean/);
    // The EC is Title's paper, so it opens on Title's page, among its documents, and not in the register of every document.
    const nav = out.navigations.at(-1);
    assert.equal(nav?.workstream, 'legal.title');
    assert.equal(nav?.section, 'documents');
    assert.ok(nav?.evidenceId, 'opens the EC');
  });

  it('opens the source document at the page it quotes', () => {
    const out = applyProjectChat(readFile(), "what's the survey number?");
    const nav = out.navigations.find((n) => n.target === 'workstream');
    assert.equal(nav?.workstream, 'legal.title');
    assert.ok(nav?.evidenceId);
    assert.equal(nav?.page, '2');
  });

  it('keeps to four lines', () => {
    const project = readFile();
    for (const q of ['who owns it?', 'what is the extent?', 'is there a mortgage?', 'which findings are critical?', 'what documents are missing?', 'summarise this file', 'what can you do?']) {
      const text = applyProjectChat(project, q).assistantTurn.text;
      assert.ok(text.split('\n').filter(Boolean).length <= 4, `${q}: ${text}`);
    }
  });

  it('keeps a flagged line a line of its own when an answer is folded to four', () => {
    const project = readFile();
    const at = new Date().toISOString();
    // Two more papers that name an owner, so the answer runs to five lines before it is folded.
    for (const [title, type, name] of [['RTC extract', 'RTC (record of rights)', 'Sunrise Estates Private Limited'], ['Khata extract, earlier', 'Khata certificate and extract', 'Sunrise Estates Private Limited']] as const) {
      const row = addEvidence(project, { title, kind: 'document', status: 'received' });
      row.documentType = type;
      row.attachments.push({ id: `a-${title}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k-${title}`, uploadedAt: at } as never);
      row.facts = [fact('owner', 'Owner', name, name, 1, `Name of the owner: ${name}`)];
    }
    const lines = answerFromFile(project, 'who owns the property?')!.text.split('\n');
    assert.equal(lines.length, 4, lines.join(' | '));
    assert.match(lines[3]!, /^⚑ The names differ/, 'the flag still opens its line, so it is drawn as a row');
    assert.match(lines[2]!, /names Sunrise Estates Private Limited \(p\.1\)\. The .+ names Sunrise Estates Private Limited/, 'the plain lines past the room are folded into the one before');
  });

  it('is answered here, not handed to a model', () => {
    const project = readFile();
    for (const q of ['who owns the property?', 'is the land converted?', 'what can you do?', 'thanks']) {
      assert.ok(wantsDeterministicProjectChat(project, q), q);
    }
  });

  it('says what would answer a question the file cannot yet', () => {
    const project = createProject({ name: 'Empty', type: 'residential', location: 'X', city: 'Bengaluru' }, 'RYT-E');
    const out = applyProjectChat(project, 'is the land converted?');
    assert.match(out.assistantTurn.text, /DC conversion order/);
  });
});

describe('what counts as a question', () => {
  it('a statement is recorded, not answered', () => {
    assert.ok(!looksLikeFileQuestion('Land area is 12 acres'));
    assert.ok(looksLikeFileQuestion('what is the land area?'));
  });

  it('ranking is judgement, left to the copilot or a follow-up question', () => {
    assert.ok(!looksLikeFileQuestion('what is the biggest risk on this file?'));
    assert.ok(!looksLikeFileQuestion('should we buy this?'));
  });

  it('but when only one material item is open, the register already answers it', () => {
    const out = applyProjectChat(readFile(), 'what is the biggest risk on this file?');
    assert.deepEqual(tools(out), ['answer_from_file']);
    assert.match(out.assistantTurn.text, /Subsisting mortgage on the EC/);
    assert.match(out.assistantTurn.text, /only material item/);
  });

  it('a command is never mistaken for a question', () => {
    assert.equal(answerFromFile(readFile(), 'add a risk: boundary wall encroachment'), null);
  });
});

describe('commands that used to land in the wrong place', () => {
  it('"add a risk: …" logs a risk and adds no asset called "a risk"', () => {
    const project = readFile();
    applyProjectChat(project, 'Add a risk: boundary wall encroachment on the north edge');
    assert.ok(project.risks.some((r) => /boundary wall encroachment/.test(r.title)));
    assert.ok(!project.assets.some((a) => /^a risk$/i.test(a.name)), project.assets.map((a) => a.name).join(', '));
  });

  it('"add a note: …" never creates an asset called "a note"', () => {
    const project = readFile();
    const out = applyProjectChat(project, 'add a note: site visit booked for Friday');
    assert.ok(!project.assets.some((a) => /note/i.test(a.name)));
    assert.deepEqual(tools(out), ['clarify']);
    assert.ok((out.assistantTurn.choices ?? []).length > 0, 'offers where it could go');
  });

  it('"add evidence: …" puts a requested row on the register', () => {
    const project = readFile();
    applyProjectChat(project, 'add evidence: survey sketch');
    const row = project.evidence.find((e) => e.title === 'Survey sketch');
    assert.equal(row?.status, 'requested');
  });

  it('"add evidence: …" for a document already filed says so, instead of offering portals', () => {
    const project = readFile();
    const out = applyProjectChat(project, 'add evidence: sale deed');
    assert.match(out.assistantTurn.text, /already on the register/);
    assert.ok(!/places to get this/.test(out.assistantTurn.text));
    assert.equal(project.evidence.filter((e) => /sale deed/i.test(e.title)).length, 1, 'no duplicate row');
  });

  it('"open the evidence register" opens the register, not a check that mentions one', () => {
    const project = readFile();
    createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const out = applyProjectChat(project, 'open the evidence register');
    assert.ok(out.navigations.some((n) => n.target === 'evidence'), JSON.stringify(out.navigations));
    assert.ok(!tools(out).includes('open_sitting'));
    assert.ok(out.assistantTurn.text.split('\n').length <= 2, 'one line, not the whole briefing');
  });

  it('"generate a red flag report" offers that report even with nothing material', () => {
    const project = createProject({ name: 'Quiet', type: 'residential', location: 'X', city: 'Bengaluru' }, 'RYT-Q');
    const out = applyProjectChat(project, 'generate a red flag report');
    const card = out.proposals.find((p) => p.kind === 'generate_report');
    assert.equal(card?.payload.kind, 'red_flag');
    assert.equal(reportKindRequested('what does the red flag report say?'), null, 'asking about one is not asking for one');
  });

  it('re-grades a finding it can name, and asks when it cannot', () => {
    const project = readFile();
    const named = applyProjectChat(project, 'mark the "Subsisting mortgage" finding as high');
    assert.equal(project.findings.find((f) => f.title === 'Subsisting mortgage on the EC')?.severity, 'high');
    assert.match(named.assistantTurn.text, /was critical/);
    addFinding(project, { title: 'Built area exceeds permitted FAR', description: 'x', severity: 'high', discipline: 'regulatory' });
    const vague = applyProjectChat(project, 'mark the finding as critical');
    assert.deepEqual(tools(vague), ['clarify']);
    assert.ok((vague.assistantTurn.choices ?? []).length > 1);
    assert.equal(findingSeverityRequested('which findings are critical?'), null, 'a question about severity is not a change to it');
  });

  it('applies without printing record ids', () => {
    const out = applyProjectChat(readFile(), 'set owner to Asha Menon');
    assert.ok(!/\b(?:prj|ast|rsk|ev)_[0-9a-f]/.test(out.assistantTurn.text), out.assistantTurn.text);
  });
});
