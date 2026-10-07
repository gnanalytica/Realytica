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
  addAction,
  addEvidence,
  addFinding,
  answerFromFile,
  applyProjectChat,
  createAssessment,
  createProject,
  findingSeverityRequested,
  looksLikeFileQuestion,
  reportKindRequested,
  seedDemoProject,
  wantsDeterministicProjectChat,
  type DdProject,
  type DecisionRecord,
  type DocumentFact,
} from '@realytica/shared';

/** A decision as the record keeps one, to be given a title of the test's own. */
const seedDecision = (): DecisionRecord => seedDemoProject().decisions[0]!;

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
    // The page is cited either in words ("p.1") or as the mark the thread draws as a chip ("[ev:…:p1]").
    assert.match(out.assistantTurn.text, /\bp\.?1\b/);
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
    // The answer names the paper touched last first. These two are dated before the papers already on file, in a set
    // order, so which line is folded into which does not turn on how many milliseconds the lines above took to run.
    for (const [title, type, name, touched] of [
      ['RTC extract', 'RTC (record of rights)', 'Sunrise Estates Private Limited', '2020-02-02T00:00:00.000Z'],
      ['Khata extract, earlier', 'Khata certificate and extract', 'Sunrise Estates Private Limited', '2020-01-01T00:00:00.000Z'],
    ] as const) {
      const row = addEvidence(project, { title, kind: 'document', status: 'received' });
      row.documentType = type;
      row.attachments.push({ id: `a-${title}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k-${title}`, uploadedAt: at } as never);
      row.facts = [fact('owner', 'Owner', name, name, 1, `Name of the owner: ${name}`)];
      row.updatedAt = touched;
    }
    const lines = answerFromFile(project, 'who owns the property?')!.text.split('\n');
    assert.equal(lines.length, 4, lines.join(' | '));
    assert.match(lines[3]!, /^⚑ The names differ/, 'the flag still opens its line, so it is drawn as a row');
    assert.match(lines[2]!, /Sunrise Estates Private Limited.+\bp\.?1\b.+ .*Sunrise Estates Private Limited/, 'the plain lines past the room are folded into the one before');
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

describe('a value compared across the papers', () => {
  it('is answered as "what is the extent?" is: every paper that states one, side by side', () => {
    const project = readFile();
    const asked = applyProjectChat(project, 'what is the extent?').assistantTurn.text;
    // The paper filed last is said first, and the deed and the khata here are often filed in the same millisecond: either order.
    assert.match(asked, /12,000 sqm/);
    assert.match(asked, /11,850 sqm/);
    for (const said of [
      'compare the extent on the deed and the khata',
      'reconcile the extent across the papers',
      'check the extent on the khata against the deed',
      'Please cross-check the site area between the deed and the khata',
      'how does the extent compare across the deed and the khata?',
    ]) {
      const out = applyProjectChat(project, said);
      assert.deepEqual(tools(out), ['answer_from_file'], said);
      assert.equal(out.assistantTurn.text, asked, said);
      assert.equal(out.proposals.length, 0, `${said}: no card to fetch a khata`);
      assert.ok(wantsDeterministicProjectChat(project, said), said);
    }
  });

  it('reads the owner and the survey number the same way', () => {
    assert.match(applyProjectChat(readFile(), 'compare the owner on the deed and the khata').assistantTurn.text, /Whitefield Tech Parks LLP.+same name/s);
    assert.match(applyProjectChat(readFile(), 'reconcile the survey numbers across the documents').assistantTurn.text, /118\/2/);
  });

  it('asks which value when papers are named and no value is, and each answer is one the file gives', () => {
    const project = readFile();
    const out = applyProjectChat(project, 'compare the deed and the khata');
    assert.equal(out.assistantTurn.text, 'Compare which value?');
    assert.deepEqual(out.assistantTurn.choices?.map((choice) => choice.label), ['Extent', 'Owner', 'Survey number']);
    assert.equal(out.proposals.length, 0);
    for (const choice of out.assistantTurn.choices ?? []) assert.deepEqual(tools(applyProjectChat(readFile(), choice.send)), ['answer_from_file'], choice.send);
  });

  it('opens a check or an action named by its own title after verify or confirm, and compares nothing', () => {
    const project = readFile();
    createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((scope) => scope.checks).find((c) => c.title === 'Parcel identification matches title and survey');
    assert.ok(check, 'the due diligence has the check');
    const action = addAction(project, { title: 'Verify parcel identity against the registry', kind: 'clarification', owner: 'tester', priority: 'medium' });
    // Each was answered "Survey No. 118/2. …", with the sale deed opened.
    const onCheck = applyProjectChat(project, 'confirm Parcel identification matches title and survey');
    assert.deepEqual(tools(onCheck), ['open_sitting']);
    assert.equal(onCheck.navigations.at(-1)?.checkId, check.id);
    const onAction = applyProjectChat(project, 'Verify parcel identity against the registry');
    assert.deepEqual(tools(onAction), ['open_sitting']);
    assert.equal(onAction.navigations.at(-1)?.actionId, action.id);
    // Both are read by the rules, with or without a model. A question that holds a title is not the title.
    for (const said of ['Verify parcel identity against the registry', 'confirm Parcel identification matches title and survey']) assert.ok(wantsDeterministicProjectChat(project, said), said);
    assert.equal(wantsDeterministicProjectChat(project, 'Why should we verify parcel identity against the registry before the sale agreement is signed by both sides?'), false);
  });

  it('takes a check of a value for a comparison only with a paper named to hold it against', () => {
    const project = readFile();
    for (const said of ['check the extent against the khata', 'confirm the extent matches the khata', 'verify the survey number across the deed and the EC']) {
      assert.deepEqual(tools(applyProjectChat(project, said)), ['answer_from_file'], said);
    }
    // Each names no paper. They were answered with the extent and the owner.
    for (const said of ['confirm the area matches', 'check the owner name against the PAN card', 'tally the names of the attendees']) {
      assert.ok(!tools(applyProjectChat(readFile(), said)).includes('answer_from_file'), said);
    }
    assert.deepEqual(tools(applyProjectChat(project, 'compare the names on the deed and the khata')), ['answer_from_file'], 'a name on a paper is the owner');
  });

  it('leaves the portal reply to a question about fetching a record', () => {
    const fetched = applyProjectChat(readFile(), 'How do I get the RTC from Bhoomi?');
    assert.ok(tools(fetched).includes('connectors'));
    assert.ok(fetched.proposals.some((card) => card.kind === 'open_connector'));
    // A comparison of something that is not a value on the papers is not taken for one.
    assert.ok(!tools(applyProjectChat(readFile(), 'compare the two valuations')).includes('answer_from_file'));
  });
});

describe('a record asked for by its own words', () => {
  it('opens the finding the words name', () => {
    for (const said of ['show me the mortgage on the EC', 'open the mortgage finding', 'show me the subsisting mortgage', 'Open "Subsisting mortgage on the EC"']) {
      const project = readFile();
      const finding = project.findings.find((f) => f.title === 'Subsisting mortgage on the EC')!;
      const out = applyProjectChat(project, said);
      // Was: "Nothing on this project is called “mortgage on the EC”. Nothing moved."
      assert.deepEqual(out.navigations.at(-1), { target: 'findings', findingId: finding.id }, said);
      assert.match(out.assistantTurn.text, /^“Subsisting mortgage on the EC” is on the right — critical/, said);
      assert.ok(wantsDeterministicProjectChat(readFile(), said), said);
    }
  });

  it('finds the paper on file by the short name of its kind', () => {
    const project = readFile();
    const ec = project.evidence.find((e) => e.documentType === 'Encumbrance certificate')!;
    // A row that still waits for its paper, titled with the same letters.
    const expected = addEvidence(project, { title: 'EC', kind: 'document' });
    assert.equal(expected.attachments.length, 0);
    // Was: "Two records match “EC”. Which one?" between that row and the mortgage finding, and the certificate on file was not offered.
    for (const said of ['show me the EC', 'open the EC']) {
      const out = applyProjectChat(project, said);
      assert.equal(out.navigations.at(-1)?.evidenceId, ec.id, said);
      assert.equal(out.assistantTurn.choices, undefined, said);
    }
    // The finding is still found by its kind or its words, and the waiting row by its title in quotes.
    assert.equal(applyProjectChat(project, 'show me the EC finding').navigations.at(-1)?.target, 'findings');
    assert.equal(applyProjectChat(project, 'show me the mortgage on the EC').navigations.at(-1)?.target, 'findings');
    assert.deepEqual(applyProjectChat(project, 'Open "EC"').assistantTurn.choices?.map((choice) => choice.label), ['EC', 'Subsisting mortgage on the EC']);
  });

  it('opens a paper by its title or by the kind of paper it is, on the page of the function that holds it', () => {
    const project = readFile();
    const ec = project.evidence.find((e) => e.documentType === 'Encumbrance certificate')!;
    for (const said of ['open the encumbrance certificate', 'show me the encumbrance certificate (Form 15/16, 30-year)']) {
      const nav = applyProjectChat(project, said).navigations.at(-1)!;
      assert.deepEqual([nav.target, nav.workstream, nav.section, nav.evidenceId], ['workstream', 'legal.title', 'documents', ec.id], said);
    }
  });

  it('opens a risk, an action and a decision the same way', () => {
    const project = readFile();
    applyProjectChat(project, 'Add a risk: boundary wall encroachment on the north edge');
    const risk = project.risks.find((r) => /boundary wall/.test(r.title))!;
    assert.equal(applyProjectChat(project, 'open the boundary wall risk').navigations.at(-1)?.riskId, risk.id);
    project.decisions.push({ ...structuredClone(seedDecision()), id: 'dec_1', title: 'The lender will be given the 30-year encumbrance certificate.', status: 'approved' });
    const out = applyProjectChat(project, 'show me the lender decision');
    assert.deepEqual(out.navigations.at(-1), { target: 'decisions', item: 'dec_1' });
    assert.equal(out.assistantTurn.text, '“The lender will be given the 30-year encumbrance certificate.” is open in Decisions — approved.');
  });

  it('asks which when several records hold the words, and moves nowhere', () => {
    const project = readFile();
    addFinding(project, { title: 'Khata extent is short of the deed', description: 'x', severity: 'high', discipline: 'legal' });
    const out = applyProjectChat(project, 'open the khata');
    assert.equal(out.navigations.length, 0);
    assert.equal(out.assistantTurn.text, 'Two records match “khata”. Which one?');
    assert.deepEqual(out.assistantTurn.choices?.map((choice) => choice.kind), ['document', 'finding']);
    assert.ok(!tools(out).includes('connectors'), 'a paper on file is not answered with where to fetch one');
    // Each choice opens its own record.
    const [paper, finding] = out.assistantTurn.choices!;
    assert.ok(applyProjectChat(project, paper!.send, { sitting: paper!.sitting }).navigations.at(-1)?.evidenceId);
    assert.ok(applyProjectChat(project, finding!.send, { sitting: finding!.sitting }).navigations.at(-1)?.findingId);
  });

  it('means a paper still expected only by its whole name', () => {
    const project = readFile();
    const expected = addEvidence(project, { title: 'Survey sketch', kind: 'document', status: 'expected' });
    // Its whole name is the row.
    assert.equal(applyProjectChat(project, 'open the survey sketch').navigations.at(-1)?.evidenceId, expected.id);
    // A word of its name is not: a file holds dozens of such rows, each a word or two long.
    assert.ok(!applyProjectChat(project, 'show me the sketch').navigations.some((nav) => nav.evidenceId === expected.id));
  });

  it('opens a paper on file asked for with its kind beside it, and never says where to fetch one', () => {
    const project = readFile();
    const khata = project.evidence.find((e) => e.documentType === 'Khata certificate and extract')!;
    for (const said of ['show me the khata document', 'show me the khata documents', 'open the khata paper']) {
      const out = applyProjectChat(project, said);
      assert.equal(out.navigations.at(-1)?.evidenceId, khata.id, said);
      assert.ok(!tools(out).includes('connectors'), said);
    }
  });

  it('leaves a question a question, and a name nothing answers to a name nothing answers to', () => {
    assert.deepEqual(tools(applyProjectChat(readFile(), 'show me the mortgage on the EC?')), ['answer_from_file']);
    assert.equal(applyProjectChat(readFile(), 'open Zorblax').assistantTurn.text, 'Nothing on this project is called “Zorblax”. Nothing moved.');
    // A page by that name is the page: the reader of places comes first.
    assert.equal(applyProjectChat(readFile(), 'open findings').navigations.at(-1)?.target, 'findings');
  });
});
