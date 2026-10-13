/**
 * Telling the people a change concerns.
 *
 * A paper is filed, a value is accepted or changed from what stood, a
 * checklist line or a request is answered. These hold who is told of each
 * and why, what the message says, that a drop of ten papers is one message a
 * person, that somebody working from a grant is told only of what their own
 * copy of the project holds, that a value no person has accepted is counted
 * and never said, and that a person who quiets a project is sent nothing
 * about it.
 *
 * The firm, the people, the project and the papers are invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TELL_BATCH_MS,
  TELL_KEEP,
  TELL_TRIES,
  addAction,
  addChecklistItems,
  addEvidence,
  addRequest,
  allChecks,
  attachEvidenceFile,
  concernedBy,
  createAssessment,
  createProject,
  createProjectGrant,
  departmentOfCheck,
  gatherTell,
  markTellRead,
  patchRequest,
  projectView,
  receiveChecklistItem,
  recordReply,
  reviewFacts,
  setTeamMember,
  setTellQuiet,
  takeTellDue,
  tellEvents,
  tellMessage,
  tellSaid,
  untakeTell,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type TellLine,
  type TellPerson,
} from '@realytica/shared';

const OWNER = 'omkar@firm.test';
const COUNSEL = 'chitra@firm.test';
const CA = 'farid@firm.test';
const STAFF = 'sunil@firm.test';
const VIEWER = 'vani@firm.test';
const LAB = 'lab@soil.test';

/** The firm: an owner, who leads everywhere; a counsel who leads Legal; a CA who signs Finance; one staff; one viewer. */
const FIRM: TellPerson[] = [
  { email: OWNER, name: 'Omkar Rao', workspaceRole: 'owner' },
  { email: COUNSEL, name: 'Chitra Bhat', workspaceRole: 'staff' },
  { email: CA, name: 'Farid Khan', workspaceRole: 'staff' },
  { email: STAFF, name: 'Sunil Hegde', workspaceRole: 'staff' },
  { email: VIEWER, name: 'Vani Shetty', workspaceRole: 'viewer' },
];

function plot(): DdProject {
  const project = createProject({ name: 'Kere Road plots', type: 'residential', location: 'Kere Road', city: 'Kadamba' }, 'RYT-T1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'Omkar Rao', targetType: 'project' });
  setTeamMember(project, { email: COUNSEL, departments: { legal: 'lead' } }, OWNER);
  setTeamMember(project, { email: CA, departments: { finance: 'signer' }, signer: { profession: 'Chartered Accountant' } }, OWNER);
  return project;
}

const fact = (key: string, value: string | number, display: string, page: number, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label: key.replaceAll('_', ' '), value, display, page, quote: `${key}: ${display}`, review: 'proposed', ...more });

/** A paper put on the file by a person, as an upload does it. */
function file(project: DdProject, title: string, by: string, more: { documentType?: string; facts?: DocumentFact[] } = {}): EvidenceRecord {
  const row = addEvidence(project, { title, kind: 'document', status: 'expected' }, by);
  if (more.documentType) row.documentType = more.documentType;
  attachEvidenceFile(project, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `store/${title}.pdf` }, by);
  if (more.facts) row.facts = more.facts;
  return row;
}

const told = (project: DdProject) => (project.tell?.notices ?? []).map((notice) => notice.to).sort();
const because = (project: DdProject, to: string) => (project.tell?.notices ?? []).filter((notice) => notice.to === to).flatMap((notice) => notice.why.map((why) => why.because));
const lineFor = (project: DdProject, to: string, reads: DdProject = project): TellLine => tellSaid(reads, project.tell!.notices!.find((notice) => notice.to === to)!)!;
const later = (ms: number) => new Date(Date.now() + ms);

describe('a paper filed', () => {
  it('is told to the lead and the signer of the department that holds it, and to nobody else', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [COUNSEL, OWNER], 'Legal holds a sale deed: its lead, and the owner who leads everywhere. Not Finance’s signer, the staff who filed it, or a viewer');
    assert.deepEqual(because(project, COUNSEL), ['decides']);
    const line = lineFor(project, COUNSEL);
    assert.equal(line.title, 'Filed: Sale deed 2019 · Legal › Title');
    assert.equal(line.action, 'Read it.');
  });

  it('that no function holds yet is told to whoever leads or signs anywhere on the project, to say where it belongs', () => {
    const project = plot();
    file(project, 'Scan 0042', STAFF);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [COUNSEL, CA, OWNER].sort());
    assert.equal(lineFor(project, CA).action, 'Say where it belongs.');
  });

  it('is not told to whoever filed it, and is one paper however many files go on its row', () => {
    const project = plot();
    const row = file(project, 'Mother deed', COUNSEL, { documentType: 'Mother deed' });
    attachEvidenceFile(project, row.id, { fileName: 'Mother deed part 2.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'store/part2.pdf' }, COUNSEL);
    assert.equal(tellEvents(project).events.length, 1);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [OWNER]);
  });

  it('is told to whoever is named on an open action, a request or a checklist line it answers or touches', () => {
    const project = plot();
    const row = addEvidence(project, { title: 'Encumbrance certificate', kind: 'document', status: 'expected' }, OWNER);
    row.documentType = 'Encumbrance certificate';
    addAction(project, { title: 'Chase the encumbrance certificate', kind: 'evidence_request', owner: 'Sunil Hegde', priority: 'medium', evidenceIds: [row.id] }, OWNER);
    addRequest(project, { title: 'EC for 2004 to 2026', recipient: 'Sub-registrar', evidenceId: row.id, send: true }, VIEWER);
    addChecklistItems(project, 'legal', [{ title: 'Encumbrance certificate' }], CA);
    attachEvidenceFile(project, row.id, { fileName: 'EC.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'store/ec.pdf' }, COUNSEL);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [CA, OWNER, STAFF, VIEWER].sort(), 'the action’s owner by name, who asked for it, and who put the line on the checklist');
    assert.equal(lineFor(project, STAFF).action, 'See whether “Chase the encumbrance certificate” can close.');
    assert.equal(lineFor(project, VIEWER).detail, 'It answers the request “EC for 2004 to 2026”.');
    assert.equal(lineFor(project, CA).detail, 'It answers “Encumbrance certificate” on Papers owed.');
  });

  it('whose values a reader read and nobody accepted is said only as waiting to be checked', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed', facts: [fact('survey_numbers', '118/2', '118/2', 2, { source: 'model' }), fact('rate_per_sqm', 85000, '₹85,000 a sq m', 4, { source: 'model' })] });
    gatherTell(project, FIRM);
    const line = lineFor(project, COUNSEL);
    assert.equal(line.waiting, 2);
    assert.equal(line.detail, '2 values waiting for you to check.');
    assert.equal(line.action, 'Check 2 values.');
    const message = tellMessage(project, [line], 'https://app.test/work');
    assert.doesNotMatch(JSON.stringify([line, message]), /118\/2|85,000|85000/, 'what the model read is in neither the app’s line nor the message');
  });

  it('that states, as it stands, something a check holds otherwise says both, with the page', () => {
    const project = plot();
    const check = allChecks(project).find((held) => held.definitionId === 'land_site.parcel_identification')!;
    check.fields = { extent_title: { value: 12000, at: new Date().toISOString(), by: OWNER } };
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed', facts: [fact('extent_title', 11400, '11,400 sqm', 3, { review: 'accepted' })] });
    gatherTell(project, FIRM);
    const line = lineFor(project, COUNSEL);
    assert.equal(line.detail, `extent title: 11,400 sqm on p. 3; “${check.title}” holds 12000.`);
    assert.equal(line.action, 'See which of the two is right.');
  });
});

describe('a value accepted or changed', () => {
  /** A sale deed on Legal’s file whose rate waits, with Finance’s own check already holding another rate typed by hand. */
  function deed() {
    const project = plot();
    const row = file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed', facts: [fact('rate_per_sqm', 85000, '₹85,000 a sq m', 4, { source: 'model' })] });
    gatherTell(project, FIRM);
    project.tell!.notices = [];
    const finance = allChecks(project).find((held) => held.fields === undefined && departmentOfCheck(project, held.id) === 'finance')!;
    finance.fields = { rate_per_sqm: { value: 80000, at: new Date().toISOString(), by: CA } };
    return { project, row, finance };
  }

  it('is told to the department whose check holds another value, with what that check holds', () => {
    const { project, row, finance } = deed();
    reviewFacts(project, row.id, ['rate_per_sqm'], 'accept', COUNSEL);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [CA, OWNER], 'Finance’s signer and the owner; the counsel who accepted it is not told');
    assert.ok(because(project, CA).includes('contradicts'));
    const line = lineFor(project, CA);
    assert.equal(line.title, 'Accepted: rate per sqm: ₹85,000 a sq m · Sale deed 2019, p. 4');
    assert.equal(line.detail, `“${finance.title}” in Finance holds 80000.`);
    assert.equal(line.action, `See which is right on “${finance.title}”.`);
    assert.equal(line.page, 4);
  });

  it('is told to the departments the paper’s function feeds, by the links the project draws', () => {
    const { project, row, finance } = deed();
    delete finance.fields;
    reviewFacts(project, row.id, ['rate_per_sqm'], 'accept', COUNSEL);
    gatherTell(project, FIRM);
    assert.deepEqual(because(project, CA), ['feeds'], 'Legal › Title feeds Finance › Valuation');
    assert.equal(lineFor(project, CA).action, 'See what it changes in Finance › Valuation.');
    assert.equal(lineFor(project, CA).detail, 'It feeds Finance › Valuation.');
  });

  it('that replaces what stood says what stood before', () => {
    const { project, row } = deed();
    reviewFacts(project, row.id, ['rate_per_sqm'], 'accept', COUNSEL);
    gatherTell(project, FIRM);
    project.tell!.notices = [];
    row.facts = [...(row.facts ?? []), fact('rate_per_sqm', 91000, '₹91,000 a sq m', 6, { source: 'model' })];
    reviewFacts(project, row.id, ['rate_per_sqm'], 'accept', OWNER);
    assert.deepEqual(tellEvents(project).events.map((event) => [event.kind, event.was, event.now]), [['value_changed', 'rate per sqm: ₹85,000 a sq m', 'rate per sqm: ₹91,000 a sq m']]);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [COUNSEL, CA].sort());
    const line = lineFor(project, COUNSEL);
    assert.equal(line.title, 'Changed: rate per sqm: ₹91,000 a sq m · Sale deed 2019, p. 6');
    assert.equal(line.detail, 'rate per sqm: ₹85,000 a sq m stood before.');
    assert.equal(line.action, 'Read the change.');
  });
});

describe('a checklist line or a request answered', () => {
  it('tells who put the line on the list and the desk that holds it', () => {
    const project = plot();
    const { added } = addChecklistItems(project, 'finance', [{ title: 'Soil investigation report' }], STAFF);
    const row = file(project, 'Borehole logs', OWNER);
    gatherTell(project, FIRM);
    project.tell!.notices = [];
    receiveChecklistItem(project, added[0]!.id, { evidenceId: row.id }, OWNER);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [CA, STAFF].sort());
    const line = lineFor(project, STAFF);
    assert.deepEqual([line.title, line.detail, line.action], ['In hand: Soil investigation report', 'Marked against Borehole logs.', 'Read it.']);
  });

  it('tells who asked', () => {
    const project = plot();
    const request = addRequest(project, { title: 'Latest tax paid receipt', recipient: 'Owner’s advocate', send: true }, STAFF);
    patchRequest(project, request.id, { status: 'answered' }, COUNSEL);
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [STAFF]);
    assert.deepEqual([lineFor(project, STAFF).title, lineFor(project, STAFF).action], ['Answered: Latest tax paid receipt', 'See what came.']);
  });
});

describe('what is told', () => {
  it('is told once: reading the trail again writes nothing, and a project’s history is nobody’s news', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    assert.equal(gatherTell(project, FIRM).length, 2);
    assert.equal(gatherTell(project, FIRM).length, 0);
    assert.equal(project.tell!.notices!.length, 2);

    const old = plot();
    file(old, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    assert.equal(gatherTell(old, FIRM, later(60 * 60_000)).length, 0, 'a trail first read an hour after the filing tells nobody of it');
  });

  it('is only of what a person did under their address', () => {
    const project = plot();
    file(project, 'Sample deed', 'operator', { documentType: 'Sale deed' });
    assert.equal(gatherTell(project, FIRM).length, 0);
  });

  it('goes out as one message a person for a drop of ten papers, once, after a message’s worth of waiting', () => {
    const project = plot();
    for (let n = 1; n <= 10; n += 1) file(project, `Sale deed ${n}`, STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    assert.equal(takeTellDue(project).size, 0, 'nothing leaves at once');
    const due = takeTellDue(project, later(TELL_BATCH_MS + 1000));
    assert.deepEqual([...due.keys()].sort(), [COUNSEL, OWNER]);
    assert.equal(due.get(COUNSEL)!.length, 10);
    const message = tellMessage(project, due.get(COUNSEL)!.map((notice) => tellSaid(project, notice)!), 'https://app.test/work');
    assert.equal(message.subject, 'Kere Road plots: 10 papers filed');
    assert.match(message.text, /Filed: Sale deed 1 · Legal › Title\n {2}Read it\./);
    assert.match(message.text, /Kere Road plots \(RYT-T1\)\nhttps:\/\/app\.test\/work$/);
    assert.equal(takeTellDue(project, later(TELL_BATCH_MS * 3)).size, 0, 'and a second run takes nothing');
  });

  it('is not mailed once it has been read in the app', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    assert.equal(markTellRead(project, 'all', COUNSEL), 1);
    assert.equal(markTellRead(project, project.tell!.notices!.map((notice) => notice.id), VIEWER), 0, 'nobody marks another’s');
    assert.deepEqual([...takeTellDue(project, later(TELL_BATCH_MS + 1000)).keys()], [OWNER]);
  });
});

describe('somebody working from a grant', () => {
  /** A soil lab made Legal’s signer by the team list, working from a grant: one that reaches no assessment, or one that reaches them all. */
  function withLab(reach: { allAssessments?: boolean; allScopes?: boolean } = {}) {
    const project = plot();
    project.tenantId = 'tnt_tell';
    setTeamMember(project, { email: LAB, departments: { legal: 'signer' }, signer: { profession: 'Geotechnical engineer' } }, OWNER);
    const grant = createProjectGrant({ email: LAB, ...reach }, { id: 'grt_lab', tenantId: 'tnt_tell', projectId: project.id, createdBy: OWNER });
    const lab = (): TellPerson => ({ email: LAB, workspaceRole: 'collaborator', copy: projectView(project, { kind: 'granted', grant, email: LAB }).project });
    return { project, lab };
  }

  /** A soil report filed against the assessment, with an action on the lab that names it. */
  function soilReportFiled(project: DdProject): EvidenceRecord {
    const row = addEvidence(project, { title: 'Soil report', kind: 'document', status: 'expected', assessmentIds: [project.assessments[0]!.id] }, OWNER);
    addAction(project, { title: 'Send the soil report', kind: 'evidence_request', owner: LAB, priority: 'medium', evidenceIds: [row.id] }, OWNER);
    attachEvidenceFile(project, row.id, { fileName: 'Soil.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'store/soil.pdf' }, STAFF);
    return row;
  }

  it('is not told of a paper their copy of the project does not hold, though they sign for its department and an action on them names it', () => {
    const { project, lab } = withLab();
    const row = soilReportFiled(project);
    assert.equal(lab().copy!.evidence.some((held) => held.id === row.id), false);
    const event = tellEvents(project).events[0]!;
    assert.deepEqual(concernedBy(project, event, [...FIRM, lab()]).map((c) => c.person.email).sort(), [COUNSEL, CA, OWNER].sort());
    gatherTell(project, [...FIRM, lab()]);
    assert.equal(told(project).includes(LAB), false);
    const notice = project.tell!.notices!.find((held) => held.to === OWNER)!;
    assert.equal(tellSaid(lab().copy!, notice), undefined, 'and a notice written for somebody else says nothing on the lab’s copy');
  });

  it('is told of one their copy holds, in that copy’s words', () => {
    const { project, lab } = withLab({ allAssessments: true, allScopes: true });
    const row = soilReportFiled(project);
    assert.equal(lab().copy!.evidence.some((held) => held.id === row.id), true);
    gatherTell(project, [...FIRM, lab()]);
    assert.deepEqual(because(project, LAB).sort(), ['decides', 'named']);
    const line = lineFor(project, LAB, lab().copy!);
    assert.deepEqual([line.title, line.detail, line.action], ['Filed: Soil report', 'It touches your action “Send the soil report”.', 'Say where it belongs.']);
  });
});

describe('quieting a project', () => {
  it('keeps what is told in the app and sends none of it, until it is stopped', () => {
    const project = plot();
    setTellQuiet(project, COUNSEL, true);
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [COUNSEL, OWNER], 'still written, for the app');
    assert.deepEqual([...takeTellDue(project, later(TELL_BATCH_MS + 1000)).keys()], [OWNER]);

    setTellQuiet(project, COUNSEL, false);
    assert.equal(takeTellDue(project, later(TELL_BATCH_MS * 2)).size, 0, 'what was passed over while quiet is not sent late');
    file(project, 'Mother deed', STAFF, { documentType: 'Mother deed' });
    gatherTell(project, FIRM);
    assert.deepEqual([...takeTellDue(project, later(TELL_BATCH_MS + 1000)).keys()].sort(), [COUNSEL, OWNER]);
  });

  it('passes over what was already waiting for the person', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    setTellQuiet(project, OWNER, true);
    assert.deepEqual([...takeTellDue(project, later(TELL_BATCH_MS + 1000)).keys()], [COUNSEL]);
  });
});

describe('a paper or a reply that no signed-in person brought', () => {
  it('tells the department’s lead and signer of a paper a connected folder brought', () => {
    const project = plot();
    file(project, 'Sale deed 2019', 'Google Drive folder', { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    assert.deepEqual(told(project), [COUNSEL, OWNER]);
    assert.equal(project.tell!.notices![0]!.by, 'Google Drive folder');
    assert.equal(lineFor(project, COUNSEL).title, 'Filed: Sale deed 2019 · Legal › Title');
  });

  /** A request the staff member raised and sent, and what came back by a channel, with papers or without. */
  function replied(from: string, channel: 'email' | 'whatsapp', papers: string[]) {
    const project = plot();
    const request = addRequest(project, { title: 'Latest tax paid receipt', recipient: 'Owner’s advocate', send: true }, STAFF);
    gatherTell(project, FIRM);
    const at = new Date().toISOString();
    const attachments = papers.map((title, n) => {
      const row = file(project, title, `outside:${from}`, { documentType: 'Sale deed' });
      return { id: `att-${n}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `store/${title}.pdf`, evidenceId: row.id };
    });
    recordReply(project, request.id, { channel, from, receivedAt: at, deliveryId: `delivery-${from}`, text: 'Attached, as asked.', attachments });
    gatherTell(project, FIRM);
    return { project, request };
  }
  const kindsFor = (project: DdProject, to: string) => (project.tell?.notices ?? []).filter((notice) => notice.to === to).map((notice) => notice.kind).sort();

  it('tells whoever raised a request of a reply by WhatsApp, and the department of the paper it carried', () => {
    const { project } = replied('919800000000', 'whatsapp', ['Tax receipt 2026']);
    assert.deepEqual(kindsFor(project, COUNSEL), ['paper_filed'], 'the lead of the department that holds the paper');
    assert.deepEqual(kindsFor(project, STAFF), ['paper_filed', 'request_replied'], 'who raised the request, of the paper and of the reply');
    const paper = tellSaid(project, project.tell!.notices!.find((notice) => notice.to === STAFF && notice.kind === 'paper_filed')!)!;
    assert.deepEqual([paper.detail, paper.action], ['It came in reply to the request “Latest tax paid receipt”.', 'Confirm it answers “Latest tax paid receipt”.']);
    const reply = tellSaid(project, project.tell!.notices!.find((notice) => notice.kind === 'request_replied')!)!;
    assert.deepEqual([reply.title, reply.detail, reply.action], ['Reply: Latest tax paid receipt', '1 paper came with it, waiting to be confirmed.', 'Confirm it answers the request, or set it aside.']);
    assert.doesNotMatch(JSON.stringify(reply), /Attached, as asked/, 'the other side’s words are not repeated');
  });

  it('tells whoever raised a request of an email reply that carried no paper', () => {
    const { project } = replied('advocate@chambers.test', 'email', []);
    assert.deepEqual(told(project), [STAFF]);
    const line = lineFor(project, STAFF);
    assert.deepEqual([line.title, line.detail], ['Reply: Latest tax paid receipt', 'Words alone, with no paper.']);
    assert.equal(tellMessage(project, [line], 'https://app.test/work').subject, 'Kere Road plots: 1 reply to a request');
  });

  it('does not tell a member of their own reply', () => {
    const { project } = replied(STAFF, 'email', []);
    assert.deepEqual(told(project), []);
  });
});

describe('a value nobody accepted', () => {
  it('is not stated against a check though the rules read it surely: it is counted as waiting', () => {
    const project = plot();
    const check = allChecks(project).find((held) => held.definitionId === 'land_site.parcel_identification')!;
    check.fields = { extent_title: { value: 12000, at: new Date().toISOString(), by: OWNER } };
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed', facts: [fact('extent_title', 11400, '11,400 sqm', 3, { source: 'parser' })] });
    gatherTell(project, FIRM);
    const line = lineFor(project, COUNSEL);
    assert.equal(line.waiting, 1);
    assert.equal(line.detail, '1 value waiting for you to check.');
    assert.doesNotMatch(JSON.stringify(line), /11,400|11400/);
  });
});

describe('the notices a project keeps', () => {
  it('drops read and sent ones first, and never one that has not left the app while those remain', () => {
    const project = plot();
    file(project, 'Sale deed 0', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    const waiting = project.tell!.notices!.map((notice) => notice.id);
    assert.equal(waiting.length, 2);
    const filler = Array.from({ length: TELL_KEEP - 2 }, (_, n) => ({ ...project.tell!.notices![0]!, id: `tel_old_${n}`, ...(n % 2 ? { readAt: new Date().toISOString() } : { batchedAt: new Date().toISOString() }) }));
    project.tell!.notices!.push(...filler);
    for (let n = 1; n <= 5; n += 1) file(project, `Sale deed ${n}`, STAFF, { documentType: 'Sale deed' });
    assert.equal(gatherTell(project, FIRM).length, 10);
    const kept = project.tell!.notices!;
    assert.equal(kept.length, TELL_KEEP);
    assert.equal(kept.filter((notice) => waiting.includes(notice.id)).length, 2, 'the two oldest, still unsent, are kept');
    assert.equal(kept.filter((notice) => !notice.readAt && !notice.batchedAt).length, 12);
    assert.equal(kept.some((notice) => notice.id === 'tel_old_0'), false, 'the oldest sent one went');
  });
});

describe('a message that could not be sent', () => {
  it('has its notices given back, waits a message’s worth, and is tried only so many times', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    const first = later(TELL_BATCH_MS + 1000);
    const ids = takeTellDue(project, first).get(COUNSEL)!.map((notice) => notice.id);
    assert.equal(untakeTell(project, ids, first), 1);
    assert.equal(takeTellDue(project, new Date(first.getTime() + 60_000)).has(COUNSEL), false, 'not again within a message’s worth');
    const second = new Date(first.getTime() + TELL_BATCH_MS + 1000);
    assert.equal(takeTellDue(project, second).get(COUNSEL)!.length, 1, 'and then it is due again');
    assert.equal(untakeTell(project, ids, second), 1);
    const third = new Date(second.getTime() + TELL_BATCH_MS + 1000);
    assert.equal(takeTellDue(project, third).get(COUNSEL)!.length, 1);
    assert.equal(untakeTell(project, ids, third), 0, `after ${TELL_TRIES} failures it stays in the app alone`);
    assert.equal(takeTellDue(project, new Date(third.getTime() + TELL_BATCH_MS * 2)).size, 0);
  });

  it('is due at once where nothing was tried because the write behind it failed', () => {
    const project = plot();
    file(project, 'Sale deed 2019', STAFF, { documentType: 'Sale deed' });
    gatherTell(project, FIRM);
    const at = later(TELL_BATCH_MS + 1000);
    const taken = [...takeTellDue(project, at).values()].flat().map((notice) => notice.id);
    assert.equal(untakeTell(project, taken), 2);
    assert.equal(takeTellDue(project, at).size, 2);
  });
});
