/**
 * Rules of the chat that sit between its other files.
 *
 * Each of these was seen going wrong on a real project. A choice offered for
 * one of two checks with the same title opened the other. The tag under
 * "Accepted 13 values on 2 documents." read "0 committed". Accepting the one
 * card of values on a check opened the list of due diligences and not the
 * check. What a meeting decided, and an entry read from a voice note, were
 * reported as "other changes" and landed on Overview. And a document a
 * model's reply cited opened in the register of every document, when the
 * same document asked for by a typed sentence opened on its function's page.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptValueOffers,
  addAsset,
  addComparable,
  addEvidence,
  applyProjectAgentTurn,
  applyProjectChat,
  cockpitPath,
  createChatProposal,
  createProject,
  meetingDigest,
  paneForProposalKind,
  parseDocumentText,
  placeOfRecord,
  projectRegisterBriefing,
  quickAssessment,
  readMeetingNotes,
  readVoiceNote,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  siteEntryCardSaid,
  siteEntryProposed,
  valueOffers,
  waitingOnCanvas,
  wantsDeterministicProjectChat,
  type ChatChoice,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
  type ProjectChatResult,
} from '@realytica/shared';

const fact = (key: string, label: string, value: string | number, display = String(value)): DocumentFact => ({ key, label, value, display, page: 1, quote: `${label}: ${display}` });

/** A paper as the reader hands it on: what it is, read from its heading, and what it states. */
function paper(fileName: string, heading: string, ...facts: DocumentFact[]): ChatIngestFile {
  const read = parseDocumentText([heading], fileName);
  return {
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    storageKey: `s3://${fileName}`,
    read: { type: read.type, label: read.label, confidence: 0.9, method: 'text', summary: read.summary, facts, flags: [], rowHints: read.rowHints, scopes: read.scopes, evidenceKind: read.evidenceKind },
  };
}

/** A conversion order that states its date: one value waiting on the paper, and one card on the check that takes it. */
const order = (): ChatIngestFile =>
  paper('Conversion order.pdf', 'OFFICIAL MEMORANDUM\nConversion of agricultural land for non-agricultural purposes under Section 95 of the Karnataka Land Revenue Act', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019'));

/** A khata that states only a PID. No check takes one, so it leaves a value on the paper and no card. */
const khata = (): ChatIngestFile => paper('Khata.pdf', 'KHATA CERTIFICATE\nKhata No. 112/4', fact('pid', 'PID', '81-120-99'));

const press = (p: DdProject, choice: ChatChoice): ProjectChatResult => applyProjectChat(p, choice.send, { sitting: choice.sitting });

describe('a choice opens the record on the button', () => {
  /** The seeded project with one title on a check in each of two due diligences. */
  function twins(): { p: DdProject; first: string; second: string; title: string } {
    const p = seedDemoProject();
    const [a, b] = p.assessments;
    assert.ok(a && b, 'the seeded project runs two due diligences');
    const one = a.scopes[0]!.checks[0]!;
    const other = b.scopes[0]!.checks[0]!;
    other.title = one.title;
    return { p, first: one.id, second: other.id, title: one.title };
  }

  it('asks which of two checks with one title, and opens the one that is pressed', () => {
    const { p, first, second, title } = twins();
    const asked = applyProjectChat(p, `Open "${title}"`);
    assert.equal(asked.navigations.length, 0, 'nothing is picked for the person');
    assert.equal(asked.assistantTurn.text, `Two records match “${title}”. Which one?`);
    const choices = asked.assistantTurn.choices!;
    assert.deepEqual(choices.map((choice) => choice.sitting?.checkId), [first, second]);
    assert.notEqual(choices[0]!.detail, choices[1]!.detail, 'the due diligence each sits in tells them apart to a person');
    // The second button used to open the first check: the open resolved from the words alone.
    assert.equal(press(p, choices[1]!).navigations.at(-1)?.checkId, second);
    assert.equal(press(p, choices[0]!).navigations.at(-1)?.checkId, first);
  });

  it('keeps to the words when the pinned record is not one they name', () => {
    const { p, second } = twins();
    const other = p.assessments[0]!.scopes[0]!.checks[1]!;
    const out = applyProjectChat(p, `Open "${other.title}"`, { sitting: { checkId: second } });
    assert.equal(out.navigations.at(-1)?.checkId, other.id, 'the address of another check does not redirect a sentence that names this one');
  });

  it('does not take the check a person is on for the answer to a name that fits other records too', () => {
    const p = seedDemoProject();
    const dd = p.assessments[0]!;
    const scope = dd.scopes[0]!;
    const check = scope.checks[0]!;
    check.title = 'Parcel identification matches title and survey';
    p.evidence.push({ ...structuredClone(p.evidence[0]!), id: 'ev_survey', title: 'Survey plan', documentType: 'Survey sketch', status: 'received', checkIds: [], attachments: [{ id: 'at_survey', fileName: 'sketch.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k_survey', uploadedAt: '2026-10-01T00:00:00.000Z' } as never] });
    // The page sends the check in view with every sentence typed on it. That reopened the check, and the survey plan was not offered.
    const on = { ddId: dd.id, scopeId: scope.id, checkId: check.id };
    const asked = applyProjectChat(p, 'open the survey', { sitting: on });
    assert.equal(asked.navigations.length, 0, 'nothing is picked for the person');
    assert.match(asked.assistantTurn.text, /records match “survey”\. Which one\?$/);
    const labels = asked.assistantTurn.choices!.map((choice) => choice.label);
    assert.ok(labels.includes('Survey plan') && labels.includes(check.title), labels.join(' | '));
    // Asked from Overview it is the same question.
    assert.deepEqual(applyProjectChat(p, 'open the survey').assistantTurn.choices!.map((choice) => choice.label), labels);
    // Each choice still opens its own record from that page.
    const paper = asked.assistantTurn.choices!.find((choice) => choice.label === 'Survey plan')!;
    assert.equal(press(p, paper).navigations.at(-1)?.evidenceId, 'ev_survey');
    assert.equal(press(p, asked.assistantTurn.choices!.find((choice) => choice.label === check.title)!).navigations.at(-1)?.checkId, check.id);
  });

  it('takes “this” for a word that points, and not for a name', () => {
    const p = seedDemoProject();
    const titled = p.assessments.flatMap((a) => a.scopes.flatMap((scope) => scope.checks)).filter((check) => /\bthis\b/.test(check.title));
    assert.ok(titled.length, 'a check on the seeded project has “this” in its title');
    // Each opened a check with "this" in its title, or asked which of them: the plural was cut off "this" before it was looked at.
    for (const said of ['show me this', 'open this', 'view this', 'open this check']) {
      const on = p.assessments[0]!.scopes[0]!;
      for (const sitting of [undefined, { ddId: p.assessments[0]!.id, scopeId: on.id, checkId: on.checks[0]!.id }]) {
        const out = applyProjectChat(p, said, { sitting });
        assert.equal(out.assistantTurn.choices, undefined, said);
        assert.deepEqual(out.navigations.map((nav) => nav.target), [said.endsWith('check') ? 'dd' : 'overview'], said);
      }
    }
    // The title itself still names its checks.
    assert.deepEqual(applyProjectChat(p, `Open "${titled[0]!.title}"`).assistantTurn.choices?.map((choice) => choice.sitting?.checkId), titled.map((check) => check.id));
    assert.deepEqual(applyProjectChat(p, 'open the statutory NOCs').assistantTurn.choices?.map((choice) => choice.sitting?.checkId), titled.map((check) => check.id));
    // So does the title typed without its quotes: in a longer name "this" is a word of the title. Was: the first due diligence's check was opened, and nobody was asked which.
    for (const said of [`open ${titled[0]!.title}`, 'show me the statutory NOCs required at this stage']) {
      const out = applyProjectChat(p, said);
      assert.deepEqual(out.navigations, [], said);
      assert.deepEqual(out.assistantTurn.choices?.map((choice) => choice.sitting?.checkId), titled.map((check) => check.id), said);
    }
    // A short name that holds it still points, wherever the word stands.
    for (const said of ['open this stage', 'show me the stage of this']) assert.doesNotMatch(applyProjectChat(p, said).assistantTurn.text, /records match/, said);
  });

  it('pins a paper as the paper, and tells a finding from a risk by its kind', () => {
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR1');
    for (const key of ['a', 'b']) {
      p.evidence.push({ ...structuredClone(seedDemoProject().evidence[0]!), id: `ev_${key}`, title: 'Sale deed', documentType: 'Sale deed', status: 'received', checkIds: [], attachments: [{ id: `at_${key}`, fileName: `deed-${key}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k_${key}`, uploadedAt: '2026-10-01T00:00:00.000Z' } as never] });
    }
    const asked = applyProjectChat(p, 'show me the sale deed');
    assert.deepEqual(asked.assistantTurn.choices!.map((choice) => [choice.detail, choice.sitting]), [['deed-a.pdf', { evidenceId: 'ev_a' }], ['deed-b.pdf', { evidenceId: 'ev_b' }]]);
    assert.equal(press(p, asked.assistantTurn.choices![1]!).navigations.at(-1)?.evidenceId, 'ev_b');

    const q = seedDemoProject();
    q.risks[0]!.title = q.findings[0]!.title;
    const which = applyProjectChat(q, `Open "${q.findings[0]!.title}"`);
    assert.deepEqual(which.assistantTurn.choices!.map((choice) => choice.kind), ['finding', 'risk']);
    assert.equal(press(q, which.assistantTurn.choices![1]!).navigations.at(-1)?.riskId, q.risks[0]!.id);
    assert.equal(press(q, which.assistantTurn.choices![0]!).navigations.at(-1)?.findingId, q.findings[0]!.id);
  });
});

describe('what an approval says it did', () => {
  it('tags the reply in the reply’s own terms', () => {
    const p = seedBdaReferenceProject();
    applyProjectChat(p, '', { ingest: [khata()] });
    const out = applyProjectChat(p, 'approve all');
    assert.equal(out.assistantTurn.text, 'Accepted 1 value on 1 document.');
    assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'approve', summary: 'Accepted 1 value' }]);
    assert.deepEqual(out.commands.slice(0, 1), ['Accepted 1 value'], 'the toast says the same');
  });

  it('opens the check when the one card it took put values on a check', () => {
    const p = seedBdaReferenceProject();
    applyProjectChat(p, '', { ingest: [order()] });
    const out = applyProjectChat(p, 'approve all');
    // The date is one value: accepted on its paper, it is on the check its card offered it to.
    assert.equal(out.assistantTurn.text, 'Accepted 1 value on 1 document.');
    const nav = out.navigations.at(-1)!;
    const seat = p.assessments.flatMap((a) => a.scopes.map((scope) => ({ a, scope }))).find(({ scope }) => scope.checks.some((check) => check.id === nav.checkId));
    assert.ok(seat, 'the check the values went onto');
    // The card names its check and nothing else. With no due diligence and scope beside it the address was the list of due diligences.
    assert.deepEqual([nav.target, nav.ddId, nav.scopeId], ['scope', seat.a.id, seat.scope.id]);
    assert.equal(cockpitPath(p.id, 'scope', nav), `/projects/${p.id}/dd/${seat.a.id}/scopes/${seat.scope.id}?check=${nav.checkId}`);
    assert.deepEqual(out.commands.slice(-1), ['Opened Checks'], 'and the toast names the tab, not the pane’s key');
  });

  it('names what a meeting decided and left open, with what is to be done', () => {
    const notes = ['Minutes of the meeting', 'Date: 3 October 2026', 'Present: Asha Rao, Vikram Shetty', 'Decision: Resurvey the plot before the sale agreement.', 'Decision: Keep the old gate.', 'Action: Vikram to get the encumbrance certificate by Friday.', 'Action: Collect the tax paid receipts', 'Open: Whether the access road is wide enough.'].join('\n');
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR2');
    applyProjectChat(p, 'Notes of a meeting pasted', { meeting: { keep: { file: { storageKey: 'n.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: notes.length }, came: 'pasted', reading: readMeetingNotes(notes), digest: meetingDigest(notes) } }, modelReader: false });
    const out = applyProjectChat(p, 'approve all');
    // Was: "Opened 2 actions and applied 3 other changes."
    assert.match(out.assistantTurn.text, /^Recorded 2 decisions, noted 1 open point and opened 2 actions\./);
    assert.doesNotMatch(out.assistantTurn.text, /other change/);
    assert.deepEqual([p.decisions.filter((d) => d.status === 'approved').length, p.decisions.filter((d) => d.status === 'pending').length, p.actions.length], [2, 1, 2]);
  });

  /** A voice note's site entry, on the card the server raises for it. */
  function siteEntry(p: DdProject): string {
    const note = { storageKey: 'note.m4a', fileName: 'note.m4a', mimeType: 'audio/mp4' };
    const entry = siteEntryProposed(readVoiceNote('Slab casting done on the second floor today. Two masons were absent.', '2026-10-05'), note, '2026-10-05');
    assert.ok(entry, 'the note says something to enter');
    const said = siteEntryCardSaid(entry);
    const card = createChatProposal('log_site_entry', said.title, said.rationale, said.impact, { ...entry, ...note } as unknown as Record<string, unknown>, 'tester');
    // Raised by a reply, as a drop raises it, so "approve all" has it to take.
    applyProjectAgentTurn(p, 'x', { text: 'A voice note: a site entry is proposed.', proposals: [card], navigations: [] });
    return card.id;
  }

  it('says a site entry was added to the site log, and opens the log at it', () => {
    const p = seedDemoProject();
    const cardId = siteEntry(p);
    // It waits where it will be filed, and not on Overview by default.
    assert.equal(paneForProposalKind('log_site_entry'), 'workstream');
    const waits = waitingOnCanvas(p).entries.find((entry) => entry.proposalId === cardId)!;
    assert.deepEqual([waits.pane, waits.extra, waits.fn], ['workstream', { workstream: 'construction.progress', section: 'progress' }, 'construction.progress']);

    const out = applyProjectChat(p, 'approve all');
    assert.match(out.assistantTurn.text, /^Added 1 entry to the site log\./);
    const entry = p.siteLog!.at(-1)!;
    const nav = out.navigations.at(-1)!;
    assert.deepEqual([nav.target, nav.workstream, nav.section, nav.item], ['workstream', 'construction.progress', 'progress', entry.id]);
    assert.deepEqual(out.commands.slice(-1), ['Opened Progress']);
  });

  it('leaves a site entry on Overview where the project has no Progress page', () => {
    const p = seedDemoProject();
    setProjectDepartments(p, ['legal'], 'tester');
    const cardId = siteEntry(p);
    const waits = waitingOnCanvas(p).entries.find((entry) => entry.proposalId === cardId)!;
    assert.deepEqual([waits.pane, waits.extra], ['overview', undefined]);
    assert.equal(applyProjectChat(p, 'approve all').navigations.at(-1)?.target, 'overview');
  });
});

describe('one card waiting', () => {
  it('is said as one: “it is waiting”, in the next step and in an update read from a sentence', () => {
    const fresh = (): DdProject => createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-ONE');
    const withLand = fresh();
    addAsset(withLand, { name: 'Land parcel', assetType: 'land_parcel' }, 'tester');
    const next = applyProjectChat(withLand, 'What should I do next?');
    assert.equal(next.proposals.length, 1);
    // Was: "They are waiting on the right. One at a time — the rest can wait."
    assert.equal(next.assistantTurn.text.split('\n').at(-1), 'It is waiting on the right.');
    const one = applyProjectChat(fresh(), 'The owner is Asha Menon');
    assert.equal(one.proposals.length, 1);
    // Was: "I can apply these updates from what you just said. They are waiting on the right; …"
    assert.equal(one.assistantTurn.text.split('\n')[0], 'I can apply this update from what you just said. It is waiting on the right; nothing is written until you accept it there.');
  });
});

describe('what a valuation run says', () => {
  const plot = (): DdProject => {
    const p = createProject({ name: 'Whitefield plot', type: 'residential', location: 'White Field', city: 'Bengaluru' }, 'RYT-VAL');
    p.landAreaSqm = 1200;
    p.saleableAreaSqm = 1200;
    return p;
  };

  it('says there is no figure while there is none, and what the first approaches still need', () => {
    const p = plot();
    const out = applyProjectChat(p, 'Run the valuation');
    // Was: "Indicative value INR 0 (residual). This is not a certified IBBI certificate." under the tag "Indicative INR 0".
    assert.equal(out.assistantTurn.text, 'No figure yet. Comparable rate on saleable area needs rate applied. Depreciated replacement cost needs land rate.');
    assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'run_valuation', summary: 'No figure yet' }]);
    // The Valuation page says the same of the same working.
    const page = quickAssessment(p, 'finance.valuation');
    assert.equal(page.headline, 'No figure yet');
    assert.ok(page.points.some((point) => point.text === 'Comparable rate on saleable area: needs rate applied'));
    assert.match(projectRegisterBriefing(p), /^The latest valuation run gave no figure\.$/m);
  });

  it('says how many values wait to be accepted where the page shows a provisional figure', () => {
    const p = plot();
    for (const [n, price] of [58_000_000, 62_000_000, 60_500_000].entries()) addComparable(p, { title: `Plot, Sy. ${120 + n}`, price, areaSqm: 1200, kind: 'transaction', weight: 1 }, 'tester');
    // The sales offer a rate nobody has accepted. The page counts it and shows a figure; the run does not.
    const page = quickAssessment(p, 'finance.valuation');
    const figure = /^₹[\d.]+ Cr$/.exec(page.headline)?.[0];
    assert.ok(figure, page.headline);
    const out = applyProjectChat(p, 'Run the valuation');
    // Was: "No figure yet. Comparable rate on saleable area needs rate applied. …" beside the page's figure.
    assert.equal(out.assistantTurn.text, `No figure yet. 1 value waits on the Valuation page to be accepted. With it the page shows ${figure}, provisional.`);
    assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'run_valuation', summary: 'No figure yet · 1 to accept' }]);
    assert.match(projectRegisterBriefing(p), /^The latest valuation run gave no figure\.$/m);

    // With no area on the file the offered rate gives no figure. An approach is said to need only what nothing offers, as on the page.
    const bare = createProject({ name: 'Whitefield plot', type: 'residential', location: 'White Field', city: 'Bengaluru' }, 'RYT-VA2');
    for (const [n, price] of [58_000_000, 62_000_000, 60_500_000].entries()) addComparable(bare, { title: `Plot, Sy. ${120 + n}`, price, areaSqm: 1200, kind: 'transaction', weight: 1 }, 'tester');
    assert.ok(quickAssessment(bare, 'finance.valuation').points.some((point) => point.text === 'Comparable rate on saleable area: needs area valued'));
    // Was: "… needs area valued and rate applied."
    assert.equal(applyProjectChat(bare, 'Run the valuation').assistantTurn.text, 'No figure yet. 1 value waits on the Valuation page to be accepted. Comparable rate on saleable area needs area valued. Depreciated replacement cost needs plot area and land rate.');
  });

  it('names the approach the run used, and writes the amount as the Valuation page does', () => {
    const p = plot();
    for (const [n, price] of [58_000_000, 62_000_000, 60_500_000].entries()) addComparable(p, { title: `Plot, Sy. ${120 + n}`, price, areaSqm: 1200, kind: 'transaction', weight: 1 }, 'tester');
    acceptValueOffers(p, [valueOffers(p).find((offer) => offer.input === 'rate_per_sqm')!.id], 'tester');
    const out = applyProjectChat(p, 'Run the valuation');
    // Was: "Indicative value INR 60,166,667 (residual)." The premise of value is no approach, and the page writes "₹6.02 Cr".
    const used = quickAssessment(p, 'finance.valuation').points.find((point) => point.text.startsWith('Comparable rate on saleable area: ₹'))!.text;
    assert.match(used, /^Comparable rate on saleable area: ₹[\d.]+ Cr \(100%\)$/);
    const figure = /₹[\d.]+ Cr/.exec(used)![0];
    assert.equal(out.assistantTurn.text, `Indicative value ${figure}. ${used}. This is not a certified IBBI certificate. Sign-off stays unsigned.`);
    assert.deepEqual(out.assistantTurn.toolCalls, [{ name: 'run_valuation', summary: `Indicative ${figure}` }]);
    assert.ok(projectRegisterBriefing(p).includes(`Latest indicative valuation: ${figure} (unsigned). Not a certified IBBI certificate.`));
  });
});

describe('a document a model’s reply cites', () => {
  it('opens where a typed sentence and a pressed chip open it: on its function’s page, at Documents', () => {
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR3');
    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' });
    deed.documentType = 'Sale deed';
    deed.attachments.push({ id: 'at_1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k_1', uploadedAt: '2026-10-01T00:00:00.000Z' } as never);
    const chip = placeOfRecord(p, deed.id)!.open;
    assert.deepEqual([chip.pane, chip.extra.workstream, chip.extra.section], ['workstream', 'legal.title', 'documents'], 'a filed deed lives on Title, at its documents');
    const typed = applyProjectChat(p, 'open the sale deed').navigations.at(-1)!;
    const model = applyProjectAgentTurn(p, 'what does it say?', { text: 'It states the extent.', proposals: [], navigations: [], citedEvidenceIds: [deed.id] }).navigations.at(-1)!;
    // Was: { target: 'evidence', evidenceId }, the register of every document.
    for (const nav of [typed, model]) assert.deepEqual([nav.target, nav.workstream, nav.section, nav.evidenceId], ['workstream', 'legal.title', 'documents', deed.id]);
    assert.equal(model.stage, undefined, 'the reply was not told the stage on screen, so it names none and the one in view stays');
  });

  it('opens there too when the model’s own tools opened the document first', () => {
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR6');
    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' });
    deed.documentType = 'Sale deed';
    deed.attachments.push({ id: 'at_1', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k_1', uploadedAt: '2026-10-01T00:00:00.000Z' } as never);
    // A tool that traced a conclusion to the deed opens it by the register's address, at the page it read.
    const byTool = [{ target: 'evidence', evidenceId: deed.id, page: '2' }];
    // Was left as it came: { target: 'evidence', evidenceId }, the register of every document.
    for (const cited of [[deed.id], []]) {
      const nav = applyProjectAgentTurn(p, 'what does it say?', { text: 'It states the extent.', proposals: [], navigations: structuredClone(byTool), citedEvidenceIds: cited }).navigations.at(-1)!;
      assert.deepEqual([nav.target, nav.workstream, nav.section, nav.evidenceId, nav.page, nav.stage], ['workstream', 'legal.title', 'documents', deed.id, '2', undefined], `cited: ${cited.length}`);
    }
    // A page a tool opened that is no document stays as it came.
    const kept = applyProjectAgentTurn(p, 'where are the findings?', { text: 'Here.', proposals: [], navigations: [{ target: 'findings' }], citedEvidenceIds: [] }).navigations;
    assert.deepEqual(kept, [{ target: 'findings' }]);
  });

  it('still opens in the register when no function’s page holds it', () => {
    const p = seedDemoProject();
    const loose = p.evidence.find((e) => placeOfRecord(p, e.id)?.open.pane === 'evidence');
    assert.ok(loose, 'the seeded project holds a paper no function’s page lists');
    const nav = applyProjectAgentTurn(p, 'what does it say?', { text: 'It is expected.', proposals: [], navigations: [], citedEvidenceIds: [loose.id] }).navigations.at(-1)!;
    assert.deepEqual([nav.target, nav.evidenceId], ['evidence', loose.id]);
  });
});

describe('a draft to send asked for as an email', () => {
  it('is drafted as a letter, and not answered as talk', () => {
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR4');
    for (const said of ['Draft an email to the architect asking for the as-built drawings', 'Please write an e-mail to the architect about the fire NOC']) {
      const out = applyProjectChat(p, said);
      assert.deepEqual(out.assistantTurn.toolCalls?.map((call) => call.name), ['outgoing_draft'], said);
      assert.match(out.assistantTurn.text, /^Drafted a letter to the architect as RYT-CR4\/OUT\/\d\. It is open in Outgoing\./, said);
      assert.equal(out.navigations.at(-1)?.target, 'outgoing');
    }
    assert.equal(p.outgoing?.length, 2);
  });

  it('is drafted with a word that describes it, and with a please in front', () => {
    const p = createProject({ name: 'Corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-CR5');
    // Each was answered as talk, or with a questionnaire on file by suggesting answers to it.
    for (const said of ['Draft a quick email to the lender answering their questions', 'Please draft a brief letter to the bank about the open questions', 'Write a short formal letter to the architect about the fire NOC']) {
      const out = applyProjectChat(p, said);
      assert.deepEqual(out.assistantTurn.toolCalls?.map((call) => call.name), ['outgoing_draft'], said);
      assert.match(out.assistantTurn.text, /^Drafted a letter to the (?:lender|bank|architect)\b.* as RYT-CR5\/OUT\/\d\. It is open in Outgoing\./, said);
      assert.ok(wantsDeterministicProjectChat(p, said), said);
    }
    assert.equal(p.outgoing?.length, 3);
    // Who it is to ends at what the letter does. Was: to "The lender answering their questions", with no subject.
    assert.deepEqual([p.outgoing![0]!.to, p.outgoing![0]!.subject], ['The lender', 'Answering their questions']);
    // A reply answers a paper on the file, with a describing word as without one.
    assert.equal(applyProjectChat(p, 'Draft a short reply to the lender’s questions').assistantTurn.text, applyProjectChat(p, 'Draft a reply to the lender’s questions').assistantTurn.text);
  });
});
