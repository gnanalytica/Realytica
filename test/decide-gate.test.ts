/**
 * Who decides where a read value stands.
 *
 * A value read off a paper is accepted, set aside, reopened or picked from
 * two by a lead or a signer of the department it belongs to, and by nobody
 * else. A workspace's staff contribute by default and an outside
 * collaborator holds nothing by default, so until the project's team list
 * makes one of them a lead or a signer somewhere, neither decides anything.
 *
 * The shared functions do the refusing, and they are handed the answer for
 * the person asking (`mayDecide`). With no answer handed in nobody is asking:
 * it is the server's own work, and everything behaves as it did. The first
 * half holds the functions to that. The second boots the API and holds the
 * routes to it, because a rule the functions keep and a route forgets to ask
 * about is no rule.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PROPOSAL_IDENTITY, applyReviewedPayload } from '../apps/api/src/proposal-review';
import {
  CHOICE_SENTENCE,
  DecisionRefused,
  NOTHING_ACCEPTED,
  NOTHING_SET_ASIDE,
  acceptValueOffers,
  acceptWaiting,
  acceptedFacts,
  addComparable,
  addEvidence,
  allChecks,
  applyProjectChat,
  createAssessment,
  createChatProposal,
  createProject,
  decideCheckFields,
  decidesIn,
  departmentOfCheck,
  departmentOfPaper,
  departmentReach,
  fileCertifiedReport,
  findCheck,
  mayDecidePaper,
  pickCheckValue,
  projectRecordIds,
  projectView,
  proposeFacts,
  proposeOnRow,
  proposedFacts,
  reviewFacts,
  setAsideValueOffers,
  setAsideWaiting,
  setDocumentWorkstream,
  setTeamMember,
  standingFacts,
  valueOffers,
  valueOnPaper,
  waitingFieldKeys,
  waitingOnCheck,
  type ChatIngestFile,
  type ChatProposal,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type MayDecide,
  type ProjectChatTurn,
  type ProjectGrant,
} from '@realytica/shared';

const project = (): DdProject => createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-G1');

const fact = (key: string, value: string | number, display = String(value), page = 1): DocumentFact => ({
  key,
  label: key.replaceAll('_', ' '),
  value,
  display,
  page,
  quote: `${key}: ${display}`,
});

/** A paper as the reader hands it over: what it was taken for, and what it states. */
function paper(fileName: string, type: 'khata' | 'sale_deed', label: string, ...facts: DocumentFact[]): ChatIngestFile {
  return {
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: `s3://${fileName}`,
    read: { type, label, confidence: 0.9, method: 'text', summary: label, facts, flags: [], rowHints: [], scopes: [], evidenceKind: 'document' },
  };
}

const rowOf = (p: DdProject, file: ChatIngestFile): EvidenceRecord => p.evidence.find((e) => e.attachments.some((a) => a.storageKey === file.storageKey))!;
const checkCards = (p: DdProject): ChatProposal[] => p.chatProposals.filter((c) => c.kind === 'record_check_fields');
const cardsOf = (p: DdProject, department: string): ChatProposal[] => checkCards(p).filter((c) => departmentOfCheck(p, String(c.payload.checkId)) === department);
const fieldOn = (p: DdProject, card: ChatProposal, key: string): unknown => findCheck(p, String(card.payload.checkId)).check.fields?.[key]?.value;

/** The firm's people, by the role the workspace gives them. The team list says otherwise where a test puts them on it. */
const owner = (p: DdProject): MayDecide => decidesIn(p, { email: 'owner@firm.in', workspaceRole: 'owner' });
const staff = (p: DdProject): MayDecide => decidesIn(p, { email: 'asha@firm.in', workspaceRole: 'staff' });

/** A khata, which Legal › Title holds, dropped on a project with the acquisition DD running: its extent waits on the paper and on Legal's parcel check. */
function khataDropped(...facts: DocumentFact[]) {
  const p = project();
  createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const file = paper('Khata.pdf', 'khata', 'Khata certificate and extract', ...(facts.length ? facts : [fact('extent_khata', 11850, '11,850 sq ft')]));
  applyProjectChat(p, '', { ingest: [file] });
  const row = rowOf(p, file);
  const card = cardsOf(p, 'legal')[0]!;
  return { p, row, card };
}

/**
 * A sale deed, which Legal › Title holds, that states the survey number and a
 * rate. The number answers Legal's parcel check. The rate answers two of
 * Finance's: the feasibility's and the valuation's.
 */
function deedDropped() {
  const p = project();
  createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const file = paper('Deed.pdf', 'sale_deed', 'Sale deed', fact('survey_numbers', '118/2'), fact('rate_per_sqm', 85000, '₹85,000 a sq m'));
  applyProjectChat(p, '', { ingest: [file] });
  setTeamMember(p, { email: 'counsel@firm.in', departments: { legal: 'lead' } }, 'tester');
  setTeamMember(p, { email: 'ca@firm.in', departments: { finance: 'signer' }, signer: { profession: 'Chartered Accountant' } }, 'tester');
  return {
    p,
    row: rowOf(p, file),
    counsel: decidesIn(p, { email: 'counsel@firm.in', workspaceRole: 'staff' }),
    ca: decidesIn(p, { email: 'ca@firm.in', workspaceRole: 'staff' }),
  };
}

/** The refusal a call makes, held to what it says and to nothing having changed on the project. */
function refused(p: DdProject, call: () => unknown, says: RegExp, department: string | undefined): void {
  const stood = JSON.stringify(p);
  assert.throws(call, (err: unknown) => {
    assert.ok(err instanceof DecisionRefused, `refused as a decision, not as ${String(err)}`);
    assert.match(err.message, says);
    assert.equal(err.department, department);
    return true;
  });
  assert.equal(JSON.stringify(p), stood, 'nothing on the record changed');
}

describe('who decides in a department', () => {
  it('is its lead or its signer: by the firm role where the team list is silent, and by the team list where it speaks', () => {
    const p = project();
    const asha = staff(p);
    const sam = decidesIn(p, { email: 'sam@site.in', workspaceRole: 'collaborator' });
    assert.equal(owner(p)('legal'), true, 'an owner leads every department');
    assert.equal(decidesIn(p, { email: 'manager@firm.in', workspaceRole: 'manager' })('finance'), true, 'so does a manager');
    assert.equal(asha('legal'), false, 'staff contribute');
    assert.equal(decidesIn(p, { email: 'reader@firm.in', workspaceRole: 'viewer' })('legal'), false);
    assert.equal(sam('construction'), false, 'an outside collaborator holds nothing until given it');

    setTeamMember(p, { email: 'asha@firm.in', departments: { legal: 'lead', finance: 'contributor' } }, 'tester');
    setTeamMember(p, { email: 'sam@site.in', departments: { construction: 'signer' }, signer: { profession: 'Structural Engineer' } }, 'tester');
    assert.equal(asha('legal'), true, 'the team list is asked each time, so an answer handed out before it changed hears the change');
    assert.equal(asha('finance'), false);
    assert.equal(sam('construction'), true);
    assert.equal(sam('legal'), false);
    // A place on the team list can take away what the firm role gives.
    setTeamMember(p, { email: 'owner@firm.in', departments: { finance: 'viewer' } }, 'tester');
    assert.equal(owner(p)('finance'), false);
    assert.equal(owner(p)('legal'), true);
  });
});

describe('what a paper states', () => {
  it('is accepted by an owner, who leads the paper’s department by default', () => {
    const { p, row, card } = khataDropped();
    assert.equal(departmentOfPaper(p, row), 'legal');
    const { changed } = reviewFacts(p, row.id, ['extent_khata'], 'accept', 'owner@firm.in', undefined, { mayDecide: owner(p) });
    assert.equal(changed.length, 1);
    assert.equal(acceptedFacts(row).length, 1);
    assert.equal(fieldOn(p, card, 'extent_khata'), 11850, 'and the check it answers takes it');
  });

  it('is not a contributor’s to accept, set aside or reopen, and a refusal leaves everything as it was', () => {
    const { p, row } = khataDropped();
    const says = /^Deciding what was read on this paper needs a lead or signer in Legal\.$/;
    refused(p, () => reviewFacts(p, row.id, ['extent_khata'], 'accept', 'asha@firm.in', undefined, { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => reviewFacts(p, row.id, 'all', 'accept', 'asha@firm.in', { value: 11800, display: '11,800 sq ft' }, { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => reviewFacts(p, row.id, 'all', 'reject', 'asha@firm.in', undefined, { mayDecide: staff(p) }), says, 'legal');
    // A value somebody who may decide has accepted is not theirs to put back either.
    reviewFacts(p, row.id, 'all', 'accept', 'owner@firm.in', undefined, { mayDecide: owner(p) });
    refused(p, () => reviewFacts(p, row.id, ['extent_khata'], 'reopen', 'asha@firm.in', undefined, { mayDecide: staff(p) }), says, 'legal');
    assert.equal(acceptedFacts(row).length, 1);
  });

  it('is decided by a signer the team list names, in their own department and no other', () => {
    const { p, row, ca } = deedDropped();
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' }, 'tester');
    report.documentType = 'Valuation report';
    report.facts = [{ ...fact('market_value', 55000000, '₹5.5 Cr'), review: 'proposed' }];
    assert.equal(departmentOfPaper(p, report), 'finance');

    assert.equal(reviewFacts(p, report.id, 'all', 'accept', 'ca@firm.in', undefined, { mayDecide: ca }).changed.length, 1);
    assert.equal(acceptedFacts(report).length, 1);
    reviewFacts(p, report.id, ['market_value'], 'reopen', 'ca@firm.in', undefined, { mayDecide: ca });
    assert.equal(proposedFacts(report).length, 1, 'and reopened by them');
    refused(p, () => reviewFacts(p, row.id, 'all', 'accept', 'ca@firm.in', undefined, { mayDecide: ca }), /needs a lead or signer in Legal\./, 'legal');
  });

  it('follows onto the checks of the departments its decider decides in, and waits on the rest', () => {
    const { p, row, counsel, ca } = deedDropped();
    assert.equal(cardsOf(p, 'legal').length, 1);
    assert.equal(cardsOf(p, 'finance').length, 2, 'the rate is offered to the feasibility and to the valuation');

    reviewFacts(p, row.id, 'all', 'accept', 'counsel@firm.in', undefined, { mayDecide: counsel });
    assert.deepEqual(acceptedFacts(row).map((f) => f.key).sort(), ['rate_per_sqm', 'survey_numbers'], 'Legal’s lead decides everything Legal’s paper states');
    const [legal] = cardsOf(p, 'legal');
    assert.equal(legal!.status, 'committed');
    assert.equal(fieldOn(p, legal!, 'survey_numbers'), '118/2');
    for (const card of cardsOf(p, 'finance')) {
      assert.equal(card.status, 'proposed', 'the rate still waits on Finance’s check');
      assert.equal(fieldOn(p, card, 'rate_per_sqm'), undefined, 'and nothing was written there');
    }

    // Finance's signer takes it from there, where it waits.
    for (const card of cardsOf(p, 'finance')) decideCheckFields(p, card.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca });
    for (const card of cardsOf(p, 'finance')) assert.equal(fieldOn(p, card, 'rate_per_sqm'), 85000);
  });

  it('where no function holds the paper, is decided by a lead of any department and by nobody who leads none', () => {
    const p = project();
    const loose = addEvidence(p, { title: 'Notes from the broker', kind: 'document', status: 'received' }, 'tester');
    loose.facts = [{ ...fact('asking_price', 60000000, '₹6 Cr'), review: 'proposed' }];
    assert.equal(departmentOfPaper(p, loose), undefined);
    setTeamMember(p, { email: 'pm@firm.in', departments: { construction: 'lead' } }, 'tester');
    const pm = decidesIn(p, { email: 'pm@firm.in', workspaceRole: 'staff' });

    assert.equal(mayDecidePaper(p, loose, staff(p)), false);
    refused(
      p,
      () => reviewFacts(p, loose.id, 'all', 'accept', 'asha@firm.in', undefined, { mayDecide: staff(p) }),
      /^Deciding what was read on this paper needs a lead or signer in one of this project’s departments\.$/,
      undefined,
    );
    assert.equal(mayDecidePaper(p, loose, pm), true, 'Engineering’s lead will do while nothing says whose it is');
    assert.equal(reviewFacts(p, loose.id, 'all', 'accept', 'pm@firm.in', undefined, { mayDecide: pm }).changed.length, 1);

    // Once a function holds it, it is that department's and no other's.
    reviewFacts(p, loose.id, 'all', 'reopen', 'pm@firm.in', undefined, { mayDecide: pm });
    setDocumentWorkstream(p, loose.id, 'commercial.market', 'tester');
    refused(p, () => reviewFacts(p, loose.id, 'all', 'accept', 'pm@firm.in', undefined, { mayDecide: pm }), /needs a lead or signer in Commercial\./, 'commercial');
  });
});

describe('a check’s values', () => {
  const says = /^Deciding a value on this check needs a lead or signer in Legal\.$/;

  it('are not a contributor’s to accept or set aside, one field at a time or the card whole', () => {
    const { p, card } = khataDropped();
    refused(p, () => decideCheckFields(p, card.id, ['extent_khata'], 'accept', 'asha@firm.in', undefined, { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => decideCheckFields(p, card.id, ['extent_khata'], 'accept', 'asha@firm.in', { extent_khata: 99999 }, { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => decideCheckFields(p, card.id, ['extent_khata'], 'reject', 'asha@firm.in', undefined, { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => acceptWaiting(p, card.id, 'asha@firm.in', { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => setAsideWaiting(p, card.id, 'asha@firm.in', { mayDecide: staff(p) }), says, 'legal');

    acceptWaiting(p, card.id, 'owner@firm.in', { mayDecide: owner(p) });
    assert.equal(fieldOn(p, card, 'extent_khata'), 11850, 'the department’s lead accepts the same card');
  });

  it('are not a contributor’s to pick between, nor to leave blank', () => {
    const { p, card } = khataDropped();
    applyProjectChat(p, '', { ingest: [paper('Khata_2.pdf', 'khata', 'Khata certificate and extract', fact('extent_khata', 11900, '11,900 sq ft', 2))] });
    const checkId = String(card.payload.checkId);
    const field = waitingOnCheck(p, checkId).fields.find((f) => f.key === 'extent_khata')!;
    assert.equal(field.disagree, true);
    const chosen = field.values.find((v) => v.value === 11900)!;

    refused(p, () => pickCheckValue(p, checkId, 'extent_khata', chosen.proposalId, 'asha@firm.in', { mayDecide: staff(p) }), says, 'legal');
    refused(p, () => pickCheckValue(p, checkId, 'extent_khata', null, 'asha@firm.in', { mayDecide: staff(p) }), says, 'legal');

    pickCheckValue(p, checkId, 'extent_khata', chosen.proposalId, 'owner@firm.in', { mayDecide: owner(p) });
    assert.equal(fieldOn(p, card, 'extent_khata'), 11900);
    assert.equal(waitingOnCheck(p, checkId).fields.length, 0);
  });

  it('accepted by their own department tell the paper only where that person decides the paper too', () => {
    const { p, row, ca } = deedDropped();
    const [feasibility] = cardsOf(p, 'finance');
    decideCheckFields(p, feasibility!.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca });
    assert.equal(fieldOn(p, feasibility!, 'rate_per_sqm'), 85000, 'Finance’s check holds the rate');
    assert.deepEqual(proposedFacts(row).map((f) => f.key).sort(), ['rate_per_sqm', 'survey_numbers'], 'and the deed’s own value still waits for Legal');
  });

  it('accepted on one check do not reach another department’s check by way of the paper', () => {
    // One paper, held by Commercial, states a date two checks ask for: Commercial's comparables and Finance's valuation.
    const p = project();
    createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const file = paper('Market note.pdf', 'khata', 'Market note', fact('evidence_cutoff', '2026-06-30', '30 June 2026'));
    applyProjectChat(p, '', { ingest: [file] });
    const row = rowOf(p, file);
    setDocumentWorkstream(p, row.id, 'commercial.market', 'tester');
    setTeamMember(p, { email: 'sales@firm.in', departments: { commercial: 'lead' } }, 'tester');
    const sales = decidesIn(p, { email: 'sales@firm.in', workspaceRole: 'staff' });
    const [commercial] = cardsOf(p, 'commercial');
    const [finance] = cardsOf(p, 'finance');
    assert.ok(commercial && finance, 'the date waits on a check of each department');

    decideCheckFields(p, commercial.id, ['evidence_cutoff'], 'accept', 'sales@firm.in', undefined, { mayDecide: sales });
    assert.equal(fieldOn(p, commercial, 'evidence_cutoff'), '2026-06-30');
    assert.equal(acceptedFacts(row).length, 1, 'the paper is Commercial’s, so it is told');
    assert.equal(finance.status, 'proposed', 'and telling it does not decide Finance’s check');
    assert.equal(fieldOn(p, finance, 'evidence_cutoff'), undefined);
  });

  it('on a check the file no longer holds are let through to nobody, and stop no decision on the paper', () => {
    const { p, row, card } = khataDropped();
    card.payload.checkId = 'chk_no_longer_here';
    assert.equal(departmentOfCheck(p, 'chk_no_longer_here'), 'legal', 'placed as the library places a check it does not know');
    refused(p, () => setAsideWaiting(p, card.id, 'asha@firm.in', { mayDecide: staff(p) }), says, 'legal');
    const said = applyProjectChat(p, CHOICE_SENTENCE.aside, { actor: 'asha@firm.in', mayDecide: staff(p), sitting: { decision: 'aside', proposalIds: [card.id] } });
    assert.equal(said.assistantTurn.text, 'Nothing was set aside. 1 value waits for a lead or signer in Legal.');
    // The paper's own value is still decided whole: the card that cannot record stays waiting, as it always did.
    assert.equal(reviewFacts(p, row.id, 'all', 'accept', 'owner@firm.in', undefined, { mayDecide: owner(p) }).changed.length, 1);
    assert.equal(card.status, 'proposed');
  });

  it('are the only cards held to this: an action or a risk is anybody’s who may write', () => {
    const p = project();
    const action = createChatProposal('add_action', 'Ask the seller for the mother deed', 'The chain stops in 2009.', 'Opens an action.', { title: 'Ask the seller for the mother deed', kind: 'remediation', owner: 'asha@firm.in', priority: 'medium' }, 'tester');
    const risk = createChatProposal('add_risk', 'Flood risk on the eastern boundary', 'Low-lying.', 'Logs a risk.', { title: 'Flood risk', description: 'Low-lying.', owner: 'tester' }, 'tester');
    p.chatProposals.push(action, risk);
    acceptWaiting(p, action.id, 'asha@firm.in', { mayDecide: staff(p) });
    setAsideWaiting(p, risk.id, 'asha@firm.in', { mayDecide: staff(p) });
    assert.equal(action.status, 'committed');
    assert.equal(p.actions.length, 1);
    assert.equal(risk.status, 'rejected');
  });
});

describe('what the valuation is offered', () => {
  /** A deed whose extent waits on its row, and is offered to the valuation as the land area. */
  function offered() {
    const p = project();
    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' }, 'tester');
    deed.documentType = 'Sale deed';
    deed.facts = [{ ...fact('extent_title', 1200, '1,200 sqm', 2), review: 'proposed' }];
    const offer = valueOffers(p).find((o) => o.input === 'land_area')!;
    assert.ok(offer, 'the deed’s extent is offered as the land area');
    setTeamMember(p, { email: 'ca@firm.in', departments: { finance: 'signer' }, signer: { profession: 'Chartered Accountant' } }, 'tester');
    return { p, deed, offer, ca: decidesIn(p, { email: 'ca@firm.in', workspaceRole: 'staff' }) };
  }
  const says = /^Deciding a value for the valuation needs a lead or signer in Finance\.$/;

  it('is Finance’s to accept and to set aside, and a refusal starts no valuation DD', () => {
    const { p, offer } = offered();
    refused(p, () => acceptValueOffers(p, [offer.id], 'asha@firm.in', { mayDecide: staff(p) }), says, 'finance');
    refused(p, () => setAsideValueOffers(p, [offer.id], 'asha@firm.in', { mayDecide: staff(p) }), says, 'finance');
    assert.equal(p.assessments.length, 0);
    assert.equal(p.landAreaSqm, undefined);
  });

  it('is recorded by Finance’s signer, and the deed’s own value waits for whoever decides the deed', () => {
    const { p, deed, offer, ca } = offered();
    const out = acceptValueOffers(p, [offer.id], 'ca@firm.in', { mayDecide: ca });
    assert.deepEqual(out.applied.map((o) => o.id), [offer.id]);
    assert.deepEqual(out.refused, []);
    assert.equal(p.landAreaSqm, 1200);
    assert.equal(proposedFacts(deed).length, 1, 'accepting it for the valuation is not accepting what Legal’s paper states');

    const again = offered();
    acceptValueOffers(again.p, [again.offer.id], 'owner@firm.in', { mayDecide: owner(again.p) });
    assert.equal(acceptedFacts(again.deed).length, 1, 'somebody who decides both does both, so it is not asked about twice');

    const third = offered();
    assert.equal(setAsideValueOffers(third.p, [third.offer.id], 'ca@firm.in', { mayDecide: third.ca }), 1);
    assert.ok(!valueOffers(third.p).some((o) => o.id === third.offer.id), 'and an offer is theirs to set aside');
  });
});

describe('with nobody asking', () => {
  it('everything is decided as it was: the server’s own work is not a person’s request', () => {
    const { p, row, card } = khataDropped(fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2'));
    decideCheckFields(p, card.id, ['survey_numbers'], 'accept', 'tester');
    assert.equal(fieldOn(p, card, 'survey_numbers'), '118/2');
    assert.deepEqual(acceptedFacts(row).map((f) => f.key), ['survey_numbers'], 'and the paper is told, as it always was');
    reviewFacts(p, row.id, 'all', 'accept', 'tester');
    assert.equal(fieldOn(p, card, 'extent_khata'), 11850);
    reviewFacts(p, row.id, ['extent_khata'], 'reopen', 'tester');
    assert.equal(proposedFacts(row).length, 1);

    const deed = deedDropped();
    const done = applyProjectChat(deed.p, 'approve all');
    assert.match(done.assistantTurn.text, /^Accepted 2 values on 1 document\. /);
    assert.ok(checkCards(deed.p).every((c) => c.status === 'committed'), 'every department’s check took its value');
    assert.doesNotMatch(done.assistantTurn.text, /lead or signer/);
  });
});

describe('“approve all”, typed or pressed', () => {
  it('by a contributor accepts no read value, says how many wait and for whom, and writes no “Accepted” line', () => {
    const { p, row } = khataDropped();
    const stood = JSON.stringify({ evidence: p.evidence, cards: checkCards(p), assessments: p.assessments, audit: p.audit });
    const said = applyProjectChat(p, 'approve all', { actor: 'asha@firm.in', mayDecide: staff(p) });
    // One value: the khata's extent, which waits on the paper and again on Legal's check. It is counted once.
    assert.equal(said.assistantTurn.text, 'Nothing was accepted. 1 value waits for a lead or signer in Legal.');
    assert.deepEqual(said.commands, []);
    assert.deepEqual(said.assistantTurn.toolCalls?.map((call) => call.name), [NOTHING_ACCEPTED]);
    assert.equal(proposedFacts(row).length, 1);
    assert.equal(JSON.stringify({ evidence: p.evidence, cards: checkCards(p), assessments: p.assessments, audit: p.audit }), stood, 'the paper, its card, the check and the trail are as they were');
  });

  it('by a lead works as it did', () => {
    const { p, row, card } = khataDropped();
    const done = applyProjectChat(p, 'approve all', { actor: 'owner@firm.in', mayDecide: owner(p) });
    assert.match(done.assistantTurn.text, /^Accepted 1 value on 1 document\./);
    assert.ok(done.commands.some((line) => /^Accepted /.test(line)));
    assert.equal(acceptedFacts(row).length, 1);
    assert.equal(fieldOn(p, card, 'extent_khata'), 11850);
    assert.doesNotMatch(done.assistantTurn.text, /lead or signer/);
  });

  it('by one department’s lead takes that department’s, and names the department the rest waits for', () => {
    const { p, row, counsel } = deedDropped();
    const done = applyProjectChat(p, 'approve all', { actor: 'counsel@firm.in', mayDecide: counsel });
    assert.match(done.assistantTurn.text, /^Accepted 2 values on 1 document\. /);
    // The deed's rate waits on two of Finance's checks, and is one value.
    assert.match(done.assistantTurn.text, / 1 value waits for a lead or signer in Finance\./);
    assert.equal(acceptedFacts(row).length, 2);
    assert.equal(cardsOf(p, 'legal')[0]!.status, 'committed');
    assert.ok(cardsOf(p, 'finance').every((c) => c.status === 'proposed'));
    assert.doesNotMatch(done.assistantTurn.text, /more (?:is|are) waiting/, 'what waits for Finance is said once');
  });

  it('by somebody who decides nowhere says each department by the menu’s word', () => {
    const { p, row } = deedDropped();
    const ids = checkCards(p).map((c) => c.id);
    const said = applyProjectChat(p, CHOICE_SENTENCE.all, { actor: 'asha@firm.in', mayDecide: staff(p), sitting: { decision: 'accept', proposalIds: ids, evidenceIds: [row.id] } });
    // Two values on Legal's deed, one of them also on Legal's check. The rate is Finance's to take onto its checks as well, so it is one there too.
    assert.equal(said.assistantTurn.text, 'Nothing was accepted. 1 value waits for a lead or signer in Finance, and 2 in Legal.');
    assert.deepEqual(said.commands, []);
    assert.deepEqual(said.navigations, [], 'and nothing is opened for a decision that was not made');
  });

  it('leaves a check’s values where a contributor presses to set them aside, and still sets aside what is no read value', () => {
    const { p, card } = khataDropped();
    const said = applyProjectChat(p, CHOICE_SENTENCE.aside, { actor: 'asha@firm.in', mayDecide: staff(p), sitting: { decision: 'aside', proposalIds: [card.id] } });
    assert.equal(said.assistantTurn.text, 'Nothing was set aside. 1 value waits for a lead or signer in Legal.');
    assert.deepEqual(said.assistantTurn.toolCalls?.map((call) => call.name), [NOTHING_SET_ASIDE]);
    assert.equal(card.status, 'proposed');

    const risk = createChatProposal('add_risk', 'Flood risk on the eastern boundary', 'Low-lying.', 'Logs a risk.', { title: 'Flood risk', description: 'Low-lying.', owner: 'tester' }, 'tester');
    p.chatProposals.push(risk);
    const both = applyProjectChat(p, CHOICE_SENTENCE.aside, { actor: 'asha@firm.in', mayDecide: staff(p), sitting: { decision: 'aside', proposalIds: [card.id, risk.id] } });
    assert.equal(both.assistantTurn.text, 'Skipped “Flood risk on the eastern boundary”. 1 value waits for a lead or signer in Legal.');
    assert.equal(risk.status, 'rejected');
    assert.equal(card.status, 'proposed');
  });
});

/* ==================================================================== */
/* Which function holds a paper                                          */
/* ==================================================================== */

/** The line a move left on the trail: what happened, by whom, on which paper, from where and to where. */
const moved = (p: DdProject): Array<string | undefined> => {
  const line = p.audit.filter((held) => held.action === 'assign_document').at(-1);
  return line ? [line.actor, line.entityId, line.oldValue, line.newValue] : [];
};

describe('moving a paper from one function to another', () => {
  /** A valuation report, which Finance › Valuation holds by its kind, with a value waiting on it; and Engineering's lead, who decides nothing in Finance. */
  function reportFiled() {
    const p = project();
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' }, 'tester');
    report.documentType = 'Valuation report';
    report.facts = [{ ...fact('market_value', 55000000, '₹5.5 Cr'), review: 'proposed' }];
    setTeamMember(p, { email: 'pm@firm.in', departments: { construction: 'lead' } }, 'tester');
    return { p, report, pm: decidesIn(p, { email: 'pm@firm.in', workspaceRole: 'staff' }) };
  }
  const says = /^Moving a paper out of the function that holds it needs a lead or signer in Finance\.$/;

  it('is the holding department’s to do, so nobody takes a paper to where they decide', () => {
    const { p, report, pm } = reportFiled();
    refused(p, () => setDocumentWorkstream(p, report.id, 'construction.site', 'pm@firm.in', { mayDecide: pm }), says, 'finance');
    assert.equal(departmentOfPaper(p, report), 'finance');
    refused(p, () => reviewFacts(p, report.id, 'all', 'accept', 'pm@firm.in', undefined, { mayDecide: pm }), /needs a lead or signer in Finance\./, 'finance');
    assert.deepEqual(moved(p), [], 'and a move that was refused is no line on the trail');

    // The owner leads Finance, and moves it. The move is on the trail: by whom, from where, to where.
    setDocumentWorkstream(p, report.id, 'construction.site', 'owner@firm.in', { mayDecide: owner(p) });
    assert.deepEqual(moved(p), ['owner@firm.in', report.id, 'Finance › Valuation', 'Engineering › Site']);
    // Engineering holds it now, so what it states is Engineering's lead's to decide.
    assert.equal(reviewFacts(p, report.id, 'all', 'accept', 'pm@firm.in', undefined, { mayDecide: pm }).changed.length, 1);
  });

  it('is held to the same when a paper is handed back to what it is', () => {
    const { p, pm } = reportFiled();
    // A progress certificate is Engineering's by its kind. The owner gave this one to Finance by hand.
    const cert = addEvidence(p, { title: 'Progress certificate', kind: 'document', status: 'received' }, 'tester');
    cert.documentType = 'Progress certificate';
    setDocumentWorkstream(p, cert.id, 'finance.valuation', 'owner@firm.in', { mayDecide: owner(p) });
    assert.deepEqual(moved(p), ['owner@firm.in', cert.id, 'Engineering › Progress', 'Finance › Valuation']);

    // Handing it back would bring it to Engineering, where this person leads. Finance holds it now, so it is Finance's to hand back.
    refused(p, () => setDocumentWorkstream(p, cert.id, null, 'pm@firm.in', { mayDecide: pm }), says, 'finance');
    setDocumentWorkstream(p, cert.id, null, 'owner@firm.in', { mayDecide: owner(p) });
    assert.equal(cert.workstream, undefined);
    assert.deepEqual(moved(p), ['owner@firm.in', cert.id, 'Finance › Valuation', 'Engineering › Progress']);
  });

  it('is anybody’s who may file while no function holds the paper, and between the design workstreams is no move', () => {
    const p = project();
    const loose = addEvidence(p, { title: 'Notes from the broker', kind: 'document', status: 'received' }, 'tester');
    setDocumentWorkstream(p, loose.id, 'legal.title', 'asha@firm.in', { mayDecide: staff(p) });
    assert.equal(loose.workstream, 'legal.title');
    assert.deepEqual(moved(p), ['asha@firm.in', loose.id, undefined, 'Legal › Title'], 'a first home is written too');
    // Held now, it is Legal's to move: the person who filed it cannot take it on to another function.
    refused(p, () => setDocumentWorkstream(p, loose.id, 'finance.valuation', 'asha@firm.in', { mayDecide: staff(p) }), /^Moving a paper out of the function that holds it needs a lead or signer in Legal\.$/, 'legal');
    refused(p, () => setDocumentWorkstream(p, loose.id, 'legal.approvals', 'asha@firm.in', { mayDecide: staff(p) }), /lead or signer in Legal\.$/, 'legal');

    // The design workstreams are one function. A drawing passed between two of them has not moved: nothing is asked, and nothing is written.
    const drawing = addEvidence(p, { title: 'General arrangement', kind: 'drawing', status: 'received' }, 'tester');
    setDocumentWorkstream(p, drawing.id, 'design.drawings', 'asha@firm.in', { mayDecide: staff(p) });
    assert.deepEqual(moved(p), ['asha@firm.in', drawing.id, undefined, 'Engineering › Design']);
    const lines = p.audit.length;
    setDocumentWorkstream(p, drawing.id, 'design.compliance', 'asha@firm.in', { mayDecide: staff(p) });
    assert.equal(drawing.workstream, 'design.compliance');
    assert.equal(p.audit.length, lines);
  });

  it('is refused in the chat in the same words, and what the paper states stays the holding department’s', () => {
    const { p, report, pm } = reportFiled();
    const said = applyProjectChat(p, 'File “Valuation report” under Site', { actor: 'pm@firm.in', mayDecide: pm });
    assert.equal(said.assistantTurn.text, 'Moving a paper out of the function that holds it needs a lead or signer in Finance. Nothing moved.');
    assert.equal(report.workstream, undefined);
    assert.deepEqual(moved(p), []);
    const pressed = applyProjectChat(p, CHOICE_SENTENCE.all, { actor: 'pm@firm.in', mayDecide: pm, sitting: { decision: 'accept', evidenceIds: [report.id] } });
    assert.equal(pressed.assistantTurn.text, 'Nothing was accepted. 1 value waits for a lead or signer in Finance.');

    // Said by the owner, it moves, and the trail says so once.
    const done = applyProjectChat(p, 'File “Valuation report” under Site', { actor: 'owner@firm.in', mayDecide: owner(p) });
    assert.equal(done.assistantTurn.text, '“Valuation report” is filed under Engineering › Site.');
    assert.deepEqual(moved(p), ['owner@firm.in', report.id, 'Finance › Valuation', 'Engineering › Site']);
    assert.equal(p.audit.filter((line) => line.action === 'assign_document').length, 1);
  });

  it('is refused on a card that would file the paper elsewhere, which stays waiting for whoever may move it', () => {
    const { p, report, pm } = reportFiled();
    const card = createChatProposal('assign_document', 'File the valuation report under Site', 'It records the site.', 'Moves one document.', { evidenceId: report.id, workstream: 'construction.site' }, 'tester');
    p.chatProposals.push(card);
    refused(p, () => acceptWaiting(p, card.id, 'pm@firm.in', { mayDecide: pm }), says, 'finance');

    const pressed = applyProjectChat(p, CHOICE_SENTENCE.one, { actor: 'pm@firm.in', mayDecide: pm, sitting: { decision: 'accept', proposalIds: [card.id] } });
    assert.equal(pressed.assistantTurn.text, 'Nothing was accepted. “File the valuation report under Site” stays waiting. Moving a paper out of the function that holds it needs a lead or signer in Finance.');
    assert.deepEqual(pressed.assistantTurn.toolCalls?.map((call) => call.name), [NOTHING_ACCEPTED]);
    assert.deepEqual(pressed.commands, []);
    assert.equal(card.status, 'proposed');
    assert.equal(departmentOfPaper(p, report), 'finance');

    // Beside something that is theirs, theirs is done and the move is said as left.
    const action = createChatProposal('add_action', 'Ask the valuer for the site plan', 'It is not attached.', 'Opens an action.', { title: 'Ask the valuer for the site plan', kind: 'remediation', owner: 'pm@firm.in', priority: 'medium' }, 'tester');
    p.chatProposals.push(action);
    const both = applyProjectChat(p, CHOICE_SENTENCE.all, { actor: 'pm@firm.in', mayDecide: pm, sitting: { decision: 'accept', proposalIds: [card.id, action.id] } });
    assert.match(both.assistantTurn.text, /“File the valuation report under Site” stays waiting\. Moving a paper out of the function that holds it needs a lead or signer in Finance\./);
    assert.deepEqual([action.status, card.status], ['committed', 'proposed']);

    acceptWaiting(p, card.id, 'owner@firm.in', { mayDecide: owner(p) });
    assert.equal(report.workstream, 'construction.site');
    assert.deepEqual(moved(p), ['owner@firm.in', report.id, 'Finance › Valuation', 'Engineering › Site']);
  });

  it('is not done by a file: a paper dropped in the chat onto a row that has a kind leaves the kind, and what was accepted there, as they were', () => {
    const { p, row } = khataDropped();
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'owner@firm.in', undefined, { mayDecide: owner(p) });
    // The file stored on the khata's row comes down the chat again, and this time is read as a sale deed.
    const again = paper('Khata.pdf', 'sale_deed', 'Sale deed', fact('survey_numbers', '118/2'), fact('consideration', 5000000, '₹50,00,000'));
    applyProjectChat(p, '', { ingest: [again], actor: 'asha@firm.in', mayDecide: staff(p) });

    assert.equal(p.evidence.filter((held) => held.attachments.length).length, 1, 'it went onto the row its file is on');
    assert.deepEqual([row.documentType, row.proposedDocumentType], ['Khata certificate and extract', 'Sale deed'], 'which keeps its kind, with what was read beside it as an offer');
    assert.deepEqual(acceptedFacts(row).map((held) => held.key), ['extent_khata']);
    assert.ok(standingFacts(row).some((held) => held.key === 'extent_khata'), 'so what was accepted on the khata still stands');
    assert.ok(!standingFacts(row).some((held) => held.key === 'consideration'), 'and what only a sale deed carries waits, standing nowhere');
    assert.deepEqual(moved(p), []);
  });

  it('is held to the same when a paper another function holds is filed as a signed report', () => {
    const p = project();
    createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    // A paper of no kind that Legal's title check lists: Legal holds it through the check.
    const titleCheck = allChecks(p).find((check) => check.definitionId === 'legal.title_chain')!;
    const search = addEvidence(p, { title: 'Search report', kind: 'document', status: 'received', checkIds: [titleCheck.id] }, 'tester');
    titleCheck.evidenceIds.push(search.id);
    assert.equal(departmentOfPaper(p, search), 'legal');
    setTeamMember(p, { email: 'se@firm.in', departments: { construction: 'signer' }, signer: { profession: 'Structural Engineer' } }, 'tester');
    const engineer = decidesIn(p, { email: 'se@firm.in', workspaceRole: 'staff' });
    const signed = { workstream: 'construction.quality', title: 'Structural audit', evidenceId: search.id, signer: { name: 'S. Rao', profession: 'Structural Engineer' }, verdict: 'clear' as const };

    refused(p, () => fileCertifiedReport(p, signed, 'se@firm.in', { mayDecide: engineer }), /^Moving a paper out of the function that holds it needs a lead or signer in Legal\.$/, 'legal');
    assert.equal((p.certifiedReports ?? []).length, 0);

    fileCertifiedReport(p, signed, 'owner@firm.in', { mayDecide: owner(p) });
    assert.equal(departmentOfPaper(p, search), 'construction');
    assert.deepEqual(moved(p), ['owner@firm.in', search.id, 'Legal › Title', 'Engineering › Technical']);
  });
});

/* ==================================================================== */
/* Reading a paper again                                                 */
/* ==================================================================== */

describe('reading a paper again', () => {
  const standing = (row: EvidenceRecord) => (row.facts ?? []).map((held) => [held.key, held.value, held.review, held.decidedBy]);

  it('leaves a value a person set aside as set aside, where the new reading states the same', () => {
    const { p, row } = khataDropped(fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2'));
    reviewFacts(p, row.id, ['extent_khata'], 'reject', 'owner@firm.in', undefined, { mayDecide: owner(p) });
    const again = [fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2')];

    row.facts = proposeFacts(row.facts!, again);
    assert.deepEqual(standing(row).sort(), [['extent_khata', 11850, 'rejected', 'owner@firm.in'], ['survey_numbers', '118/2', 'proposed', undefined]]);
    // The same through the reader's own way onto a row.
    row.facts = proposeOnRow(row, again);
    assert.deepEqual(standing(row).sort(), [['extent_khata', 11850, 'rejected', 'owner@firm.in'], ['survey_numbers', '118/2', 'proposed', undefined]]);
    assert.equal(proposedFacts(row).length, 1, 'so nobody can accept by “all” what somebody set aside');
  });

  it('keeps what a person set aside whatever is read afterwards: two readings do not bring it back', () => {
    const { p, row } = khataDropped();
    reviewFacts(p, row.id, ['extent_khata'], 'reject', 'owner@firm.in', undefined, { mayDecide: owner(p) });
    // Another file is put on the row, and reads another figure. That is a new proposal, and waits beside what was set aside.
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 11900, '11,900 sq ft')]);
    assert.deepEqual(standing(row), [['extent_khata', 11850, 'rejected', 'owner@firm.in'], ['extent_khata', 11900, 'proposed', undefined]]);
    // The first file again. It states what was set aside, so it brings nothing new, and what the reading before it proposed is gone with that reading.
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 11850, '11,850 sq ft')]);
    assert.deepEqual(standing(row), [['extent_khata', 11850, 'rejected', 'owner@firm.in']]);
    assert.deepEqual(standingFacts(row), [], 'so nothing stands that a person set aside, however many times the paper is read');
  });

  it('reopens under a key the one value a person is shown there', () => {
    const { p, row } = khataDropped();
    const by = { mayDecide: owner(p) };
    const decide = (decision: 'accept' | 'reject' | 'reopen') => reviewFacts(p, row.id, ['extent_khata'], decision, 'owner@firm.in', undefined, by).changed.map((held) => held.value);
    const held = () => (row.facts ?? []).map((value) => [value.value, value.review]);
    decide('reject');
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 11900, '11,900 sq ft')]);

    // A value waits under the key. Reopening puts no second one beside it: whoever accepted next could not say which.
    assert.deepEqual(decide('reopen'), []);
    assert.deepEqual(held(), [[11850, 'rejected'], [11900, 'proposed']]);
    // Accepted, the new value is the one in force, and the one a reopening puts back. What was set aside before it is left alone.
    assert.deepEqual(decide('accept'), [11900]);
    assert.deepEqual(decide('reopen'), [11900]);
    assert.deepEqual(held(), [[11850, 'rejected'], [11900, 'proposed']]);
    // Set aside too, it is the last of the two, and the one reopened.
    decide('reject');
    assert.deepEqual(decide('reopen'), [11900]);
    // Until the paper is read as stating the first again. That one is then what the paper says now: the last under its key, and the one reopened.
    decide('reject');
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 11850, '11,850 sq ft')]);
    assert.deepEqual(held(), [[11900, 'rejected'], [11850, 'rejected']]);
    assert.deepEqual(decide('reopen'), [11850]);
    assert.deepEqual(held(), [[11900, 'rejected'], [11850, 'proposed']]);
  });

  it('leaves a value set aside on its paper off another department’s check, once the paper is read again with another figure', () => {
    const { p, row, counsel, ca } = deedDropped();
    reviewFacts(p, row.id, ['rate_per_sqm'], 'reject', 'counsel@firm.in', undefined, { mayDecide: counsel });
    const [card] = cardsOf(p, 'finance');
    const checkId = String(card!.payload.checkId);
    // Read again, the deed states 90,000. The 85,000 Legal set aside is still set aside, with the new figure waiting beside it.
    row.facts = proposeOnRow(row, [fact('survey_numbers', '118/2'), fact('rate_per_sqm', 90000, '₹90,000 a sq m')]);
    assert.deepEqual((row.facts ?? []).filter((held) => held.key === 'rate_per_sqm').map((held) => [held.value, held.review]), [[85000, 'rejected'], [90000, 'proposed']]);
    assert.equal(valueOnPaper(row, 'rate_per_sqm', 85000).now, 'set_aside');
    assert.equal(valueOnPaper(row, 'rate_per_sqm', 90000).now, 'stated');

    // So the card Finance holds for the 85,000 is no more acceptable than it was, by any way onto the check.
    const refuses = /^Error: “rate per sqm” was set aside on Sale deed\. /;
    assert.throws(() => decideCheckFields(p, card!.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca }), refuses);
    assert.throws(() => pickCheckValue(p, checkId, 'rate_per_sqm', card!.id, 'ca@firm.in', { mayDecide: ca }), refuses);
    assert.equal(acceptWaiting(p, card!.id, 'ca@firm.in', { mayDecide: ca }).proposal.status, 'proposed');
    assert.equal(fieldOn(p, card!, 'rate_per_sqm'), undefined);
  });

  it('keeps a correction: the page’s own figure, read again, is not asked about again', () => {
    const { p, row } = khataDropped();
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'owner@firm.in', { value: 11580, display: '11,580 sq ft' }, { mayDecide: owner(p) });
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 11850, '11,850 sq ft')]);
    assert.deepEqual(standing(row), [['extent_khata', 11580, 'accepted', 'owner@firm.in']]);
    // A third figure is neither the correction nor what was corrected: it waits beside the accepted one.
    row.facts = proposeFacts(row.facts!, [fact('extent_khata', 12000, '12,000 sq ft')]);
    assert.deepEqual(standing(row), [['extent_khata', 11580, 'accepted', 'owner@firm.in'], ['extent_khata', 12000, 'proposed', undefined]]);
  });
});

/* ==================================================================== */
/* What a card records once its paper says otherwise                      */
/* ==================================================================== */

describe('a value corrected on its paper', () => {
  const onCard = (card: ChatProposal, key: string): unknown => (card.payload.values as Record<string, unknown>)[key];
  const shown = (p: DdProject, card: ChatProposal, key: string) => waitingOnCheck(p, String(card.payload.checkId)).fields.find((field) => field.key === key)?.values.map((held) => held.value);

  it('is what another department’s check records, never the figure the paper no longer states', () => {
    const { p, row, counsel, ca } = deedDropped();
    // Legal's lead corrects the rate on Legal's deed. Finance's two cards are not theirs to settle, and wait as they were raised.
    reviewFacts(p, row.id, ['rate_per_sqm'], 'accept', 'counsel@firm.in', { value: 58000, display: '₹58,000 a sq m' }, { mayDecide: counsel });
    const cards = cardsOf(p, 'finance');
    assert.equal(cards.length, 2);
    for (const card of cards) {
      assert.equal(card.status, 'proposed');
      assert.deepEqual(shown(p, card, 'rate_per_sqm'), [58000], 'each shows what it would record: the corrected figure');
    }

    // Finance's signer accepts one field by field and the other whole. Both record what the deed was accepted as stating.
    decideCheckFields(p, cards[0]!.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca });
    acceptWaiting(p, cards[1]!.id, 'ca@firm.in', { mayDecide: ca });
    for (const card of cards) {
      assert.equal(fieldOn(p, card, 'rate_per_sqm'), 58000);
      assert.equal(onCard(card, 'rate_per_sqm'), 58000, 'and the card says what went onto the check');
      assert.equal(findCheck(p, String(card.payload.checkId)).check.fields?.rate_per_sqm?.quote, undefined, 'a correction has no words on the page that say it');
    }
  });

  it('is what “approve all” records too, pressed by the department that decides the check', () => {
    const { p, row, counsel, ca } = deedDropped();
    reviewFacts(p, row.id, ['rate_per_sqm'], 'accept', 'counsel@firm.in', { value: 58000, display: '₹58,000 a sq m' }, { mayDecide: counsel });
    const cards = cardsOf(p, 'finance');
    applyProjectChat(p, CHOICE_SENTENCE.all, { actor: 'ca@firm.in', mayDecide: ca, sitting: { decision: 'accept', proposalIds: cards.map((card) => card.id) } });
    for (const card of cards) assert.equal(fieldOn(p, card, 'rate_per_sqm'), 58000);
  });

  it('is the other reader’s value where that is the one kept', () => {
    const { p, row, counsel, ca } = deedDropped();
    const old = cardsOf(p, 'finance');
    // Read again, by a model this time, which reads 58,000 on another page. Two readings, and Legal's lead keeps the model's.
    row.facts = proposeFacts(row.facts!, [
      { ...fact('rate_per_sqm', 85000, '₹85,000 a sq m'), otherReading: { ...fact('rate_per_sqm', 58000, '₹58,000 a sq m', 3), source: 'model', proof: 'second_reader', pageCheck: 'page' } },
    ]);
    reviewFacts(p, row.id, ['rate_per_sqm'], 'accept', 'counsel@firm.in', undefined, { mayDecide: counsel, take: 'other' });
    assert.equal(acceptedFacts(row).find((held) => held.key === 'rate_per_sqm')!.value, 58000);
    for (const card of old) assert.deepEqual([card.status, onCard(card, 'rate_per_sqm')], ['proposed', 85000], 'the cards raised for the first reading were not Legal’s to set aside');

    for (const card of old) decideCheckFields(p, card.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca });
    for (const card of old) {
      const field = findCheck(p, String(card.payload.checkId)).check.fields!.rate_per_sqm!;
      assert.deepEqual([field.value, field.page, field.quote], [58000, 3, 'rate_per_sqm: ₹58,000 a sq m'], 'the kept reading, with its own page and words');
    }
  });

  it('is not put in the place of a figure a person typed onto the card', () => {
    const { p, row, counsel, ca } = deedDropped();
    const [typed, raised] = cardsOf(p, 'finance');
    // Legal accepts the deed as it reads: 85,000. Finance's signer accepts one card with 86,000 typed on it, as the form sends it.
    reviewFacts(p, row.id, 'all', 'accept', 'counsel@firm.in', undefined, { mayDecide: counsel });
    applyReviewedPayload(typed!.payload, { values: { rate_per_sqm: 86000 } });
    acceptWaiting(p, typed!.id, 'ca@firm.in', { mayDecide: ca });
    const field = findCheck(p, String(typed!.payload.checkId)).check.fields!.rate_per_sqm!;
    assert.deepEqual([field.value, field.quote], [86000, undefined], 'their figure is recorded as theirs, with no words of the deed beside it');
    assert.equal(onCard(typed!, 'rate_per_sqm'), 86000);
    // The same holds after a correction on the deed: a typed figure is not the stale one, and is left as typed.
    reviewFacts(p, row.id, ['rate_per_sqm'], 'reopen', 'counsel@firm.in', undefined, { mayDecide: counsel });
    reviewFacts(p, row.id, ['rate_per_sqm'], 'accept', 'counsel@firm.in', { value: 58000, display: '₹58,000 a sq m' }, { mayDecide: counsel });
    applyReviewedPayload(raised!.payload, { values: { rate_per_sqm: 60000 } });
    assert.deepEqual(shown(p, raised!, 'rate_per_sqm'), [60000]);
    acceptWaiting(p, raised!.id, 'ca@firm.in', { mayDecide: ca });
    assert.equal(fieldOn(p, raised!, 'rate_per_sqm'), 60000);
  });

  it('and set aside on its paper is taken by no check from there', () => {
    const { p, row, counsel, ca } = deedDropped();
    reviewFacts(p, row.id, ['rate_per_sqm'], 'reject', 'counsel@firm.in', undefined, { mayDecide: counsel });
    const [first, second] = cardsOf(p, 'finance');
    assert.throws(
      () => decideCheckFields(p, first!.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', undefined, { mayDecide: ca }),
      /^Error: “rate per sqm” was set aside on Sale deed\. Reopen it on the document, or set it aside here; the check takes nothing the document no longer states\.$/,
    );
    assert.equal(acceptWaiting(p, first!.id, 'ca@firm.in', { mayDecide: ca }).proposal.status, 'proposed', 'accepting the card whole leaves it waiting');
    const pressed = applyProjectChat(p, CHOICE_SENTENCE.all, { actor: 'ca@firm.in', mayDecide: ca, sitting: { decision: 'accept', proposalIds: [first!.id, second!.id] } });
    assert.equal(fieldOn(p, first!, 'rate_per_sqm'), undefined, 'and so does “approve all”');
    // Which says so, once for the one value though it waits on two checks.
    assert.match(pressed.assistantTurn.text, /One value was set aside on its document, so it waits on its check: reopen it on the document, or set it aside on the check\./);

    // A figure Finance's signer types is their own, and the card is theirs to set aside.
    decideCheckFields(p, first!.id, ['rate_per_sqm'], 'accept', 'ca@firm.in', { rate_per_sqm: 60000 }, { mayDecide: ca });
    assert.equal(fieldOn(p, first!, 'rate_per_sqm'), 60000);
    decideCheckFields(p, second!.id, ['rate_per_sqm'], 'reject', 'ca@firm.in', undefined, { mayDecide: ca });
    assert.equal(second!.status, 'rejected');
  });
});

/* ==================================================================== */
/* A copy of the project with parts taken out                             */
/* ==================================================================== */

describe('somebody working from a copy of the project', () => {
  /**
   * An outside engineer who signs for Engineering, and the project as they
   * are handed it: Legal's own scopes are not on it. One paper of no kind is
   * listed by Legal's title check and, after it, by Engineering's structural
   * check, so on the whole record Legal holds it. A second is listed by the
   * structural check alone. Each was filed by a reply in the engineer's own
   * chat, so each is theirs to press accept on.
   */
  function handedOut() {
    const p = project();
    createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const check = (definitionId: string) => allChecks(p).find((held) => held.definitionId === definitionId)!;
    const listed = (title: string, ...by: string[]): EvidenceRecord => {
      const row = addEvidence(p, { title, kind: 'document', status: 'received', checkIds: by.map((id) => check(id).id) }, 'tester');
      for (const id of by) check(id).evidenceIds.push(row.id);
      row.facts = [{ ...fact('inspected_on', '2026-05-02', '2 May 2026'), review: 'proposed' }];
      p.conversation.push({ id: `turn_${row.id}`, role: 'assistant', text: `Filed “${title}”.`, at: new Date().toISOString(), actor: 'sam@site.in', toolCalls: [{ name: 'ingest', summary: 'Filed 1 file' }], citedEvidenceIds: [row.id] } as ProjectChatTurn);
      return row;
    };
    const shared = listed('Inspection note', 'legal.title_chain', 'technical.structural');
    const own = listed('Core test results', 'technical.structural');
    setTeamMember(p, { email: 'sam@site.in', departments: { construction: 'signer' }, signer: { profession: 'Structural Engineer' } }, 'tester');
    const reach = departmentReach({ construction: 'signer' });
    const grant: ProjectGrant = { id: 'grant-sam', tenantId: 'ten_1', projectId: p.id, email: 'sam@site.in', role: reach.role, allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: reach.scopeKeys, areas: reach.areas, createdAt: new Date().toISOString(), createdBy: 'tester' };
    const copy = () => projectView(p, { kind: 'granted', grant, email: 'sam@site.in' }).project;
    return { p, copy, shared, own, sam: decidesIn(p, { email: 'sam@site.in', workspaceRole: 'collaborator' }), finance: check('financial_appraisal.margin') };
  }

  it('is judged by where the whole record says a paper is held, never by the copy', () => {
    const { p, copy, shared, sam, finance } = handedOut();
    const seen = copy();
    assert.ok(!allChecks(seen).some((held) => held.definitionId === 'legal.title_chain'), 'Legal’s title check is not on the copy');
    assert.equal(departmentOfPaper(p, shared), 'legal');
    assert.equal(departmentOfPaper(seen, shared), 'construction', 'the copy alone would hand the paper to Engineering');
    assert.equal(departmentOfPaper(seen, shared, sam), 'legal', 'asked for a person, it is read off the record their answer was built on');
    assert.equal(mayDecidePaper(seen, shared, sam), false);
    // A check the copy does not hold is placed by the whole record too, not as one nobody knows.
    assert.equal(departmentOfCheck(seen, finance.id), 'legal');
    assert.equal(departmentOfCheck(seen, finance.id, sam), 'finance');

    refused(seen, () => reviewFacts(seen, shared.id, 'all', 'accept', 'sam@site.in', undefined, { mayDecide: sam }), /^Deciding what was read on this paper needs a lead or signer in Legal\.$/, 'legal');
    refused(seen, () => setDocumentWorkstream(seen, shared.id, 'construction.quality', 'sam@site.in', { mayDecide: sam }), /^Moving a paper out of the function that holds it needs a lead or signer in Legal\.$/, 'legal');
  });

  it('is told so by the chat, which accepts for them only what is theirs on the whole record', () => {
    const { p, copy, shared, own, sam } = handedOut();
    const seen = copy();
    const pressed = applyProjectChat(seen, CHOICE_SENTENCE.all, { actor: 'sam@site.in', mayDecide: sam, outside: true, sitting: { decision: 'accept', evidenceIds: [shared.id, own.id] } });
    assert.match(pressed.assistantTurn.text, /^Accepted 1 value on 1 document\. /);
    assert.match(pressed.assistantTurn.text, / 1 value waits for a lead or signer in Legal\./);
    assert.equal(proposedFacts(shared).length, 1, 'Legal’s paper is as it was');
    assert.equal(acceptedFacts(own).length, 1, 'and Engineering’s own is accepted on the record itself: the copy holds the same rows');

    // The line that says who accepted it was written on the copy's trail, which is handed out empty. Carrying it back is the API's (`mergeConversation`).
    assert.deepEqual(seen.audit.map((line) => [line.action, line.actor, line.entityId]), [['accept_fact', 'sam@site.in', own.id]]);
    assert.ok(!p.audit.some((line) => line.action === 'accept_fact'));
  });
});

/* ==================================================================== */
/* What a refusal says                                                    */
/* ==================================================================== */

describe('a refusal', () => {
  it('says the team list is why, where it gives somebody less than their firm role would', () => {
    const { p, row } = khataDropped();
    setTeamMember(p, { email: 'owner@firm.in', departments: { legal: 'viewer' } }, 'tester');
    refused(
      p,
      () => reviewFacts(p, row.id, 'all', 'accept', 'owner@firm.in', undefined, { mayDecide: owner(p) }),
      /^Deciding what was read on this paper needs a lead or signer in Legal\. On this project the team list makes you a viewer there\.$/,
      'legal',
    );
    // Staff contribute by their firm role, so the team list is not why: the line names the department and stops.
    setTeamMember(p, { email: 'asha@firm.in', departments: { legal: 'contributor' } }, 'tester');
    refused(p, () => reviewFacts(p, row.id, 'all', 'accept', 'asha@firm.in', undefined, { mayDecide: staff(p) }), /^Deciding what was read on this paper needs a lead or signer in Legal\.$/, 'legal');
  });

  it('names Engineering by the menu’s word, as the team editor does', () => {
    const p = project();
    const cert = addEvidence(p, { title: 'Progress certificate', kind: 'document', status: 'received' }, 'tester');
    cert.documentType = 'Progress certificate';
    cert.facts = [{ ...fact('percent_complete', 42, '42%'), review: 'proposed' }];
    refused(p, () => reviewFacts(p, cert.id, 'all', 'accept', 'asha@firm.in', undefined, { mayDecide: staff(p) }), /^Deciding what was read on this paper needs a lead or signer in Engineering\.$/, 'construction');
    assert.match(readFileSync('apps/web/src/components/departments/TeamRoles.tsx', 'utf8'), /\{DEPARTMENT_SHORT\[d\.key\]\}/, 'the editor’s columns are headed by the same word');
    assert.doesNotMatch(readFileSync('apps/web/src/components/departments/TeamRoles.tsx', 'utf8'), /construction: 'Construction'/, 'and it keeps no list of its own');
  });
});

/* ==================================================================== */
/* The source: every call that carries a person's decision                */
/* ==================================================================== */

/**
 * The gate is an argument. Each of these functions decides, or moves a paper
 * to where somebody decides, and refuses the wrong person only when it is
 * handed `mayDecide`. A call that leaves it out lets anybody through, and
 * nothing fails. So the source is read: every call of one of them, in the API
 * and in the shared package, passes `mayDecide` in so many words, or is on
 * the list below with why nobody is asking there.
 */
const GATED = [
  'reviewFacts',
  'decideCheckFields',
  'pickCheckValue',
  'acceptWaiting',
  'setAsideWaiting',
  'acceptValueOffers',
  'setAsideValueOffers',
  'decideComparables',
  'setDocumentWorkstream',
  'fileCertifiedReport',
  'fileUnderFromText',
  'moveDocument',
  'commitChatProposal',
  'confirmProposedType',
  'setAsideProposedType',
  'correctProposedType',
  'applyProjectChat',
] as const;

const GATED_ROOTS = ['apps/api/src', 'packages/shared/src', 'packages/agents/src'];

/** Calls where nobody is asking: the server's own work, or a step inside a decision that was already asked about. `has` is words the call holds. */
const NOBODY_ASKING: ReadonlyArray<{ file: string; has: string; why: string }> = [
  {
    file: 'packages/shared/src/operating-model/comparables.ts',
    has: "decideComparables(project, proposed, 'accept', actor)",
    why: 'filing the comparable schedule accepts the comparables it is drawn from; it is reached only from `acceptValueOffers`, which has already refused anybody who does not decide in Finance',
  },
  {
    file: 'packages/shared/src/operating-model/wizard.ts',
    has: 'commitChatProposal(project, card.id, actor)',
    why: 'files a dropped paper on a row of its own as it is read: the card is the one kind that files, made here and taken off again, and gives no paper to another function',
  },
];

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sourcesUnder(full);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
  });
}

/**
 * A source with its comments and the insides of its quotes blanked out, place
 * for place. What is left is code: a word in a comment or in a string is not
 * there to be found, and a bracket in a string or in a pattern is not there
 * to be counted. Lines and places stay where they were.
 */
function codeOnly(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < Math.min(to, out.length); i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  /** The last character of code read that is not a space, and the word it ends: they tell a pattern from a division. */
  let last = '';
  let at = 0;
  while (at < source.length) {
    const char = source[at]!;
    const next = source[at + 1];
    if (char === '/' && next === '/') {
      const stop = source.indexOf('\n', at);
      const to = stop < 0 ? source.length : stop;
      blank(at, to);
      at = to;
    } else if (char === '/' && next === '*') {
      const stop = source.indexOf('*/', at + 2);
      const to = stop < 0 ? source.length : stop + 2;
      blank(at, to);
      at = to;
    } else if (char === "'" || char === '"' || char === '`') {
      let stop = at + 1;
      while (stop < source.length && source[stop] !== char) stop += source[stop] === '\\' ? 2 : 1;
      blank(at + 1, stop);
      at = stop + 1;
      last = char;
    } else if (char === '/' && (last === '' || '(,=:[!&|?{;'.includes(last) || /\breturn\s*$/.test(source.slice(Math.max(0, at - 8), at)))) {
      // A pattern, written between slashes. A slash inside square brackets does not close it.
      let stop = at + 1;
      let inSet = false;
      while (stop < source.length && source[stop] !== '\n' && (inSet || source[stop] !== '/')) {
        if (source[stop] === '\\') stop += 1;
        else if (source[stop] === '[') inSet = true;
        else if (source[stop] === ']') inSet = false;
        stop += 1;
      }
      blank(at + 1, stop);
      at = stop + 1;
      last = '/';
    } else {
      if (!/\s/.test(char)) last = char;
      at += 1;
    }
  }
  return out.join('');
}

/** Where the bracket that opens at `open` is closed, in code with nothing but code in it. */
function closes(code: string, open: number): number {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '(') depth += 1;
    else if (code[at] === ')' && (depth -= 1) === 0) return at;
  }
  return code.length - 1;
}

/**
 * Every call of a gated function in some source, as one line of words each,
 * with whether it passes `mayDecide`.
 *
 * It passes when the word is in the code of the call. Not in a comment inside
 * it and not in a string, which say nothing to the function. And not as
 * `mayDecide: undefined`, which says in so many words that nobody is asking.
 */
function gatedCalls(source: string): Array<{ line: number; text: string; passes: boolean }> {
  const calls: Array<{ line: number; text: string; passes: boolean }> = [];
  const code = codeOnly(source);
  const named = new RegExp(`(?<![.\\w])(?:${GATED.join('|')})\\(`, 'g');
  for (const found of code.matchAll(named)) {
    const start = found.index!;
    // Where a function is written down is not a call of it.
    if (/\bfunction\s+$/.test(code.slice(Math.max(0, start - 12), start))) continue;
    const end = closes(code, start + found[0].length - 1) + 1;
    const said = code.slice(start, end);
    calls.push({
      line: source.slice(0, start).split('\n').length,
      text: source.slice(start, end).replace(/\s+/g, ' '),
      passes: /\bmayDecide\b/.test(said) && !/\bmayDecide\s*:\s*undefined\b/.test(said),
    });
  }
  return calls;
}

/**
 * Every place a gated function is named without being called, declared,
 * brought in or asked the type of: handed on under another name, it could be
 * called from there with nothing passed and no call here to read.
 */
function gatedNamedOnly(source: string): Array<{ line: number; text: string }> {
  const code = codeOnly(source);
  // The names an import or an export lists are not uses of them.
  const listed = [...code.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\b/g)].map((list) => [list.index!, list.index! + list[0].length] as const);
  const named = new RegExp(`(?<![.\\w])(?:${GATED.join('|')})(?![\\w(])`, 'g');
  return [...code.matchAll(named)]
    .filter((found) => !listed.some(([from, to]) => found.index! >= from && found.index! < to))
    .filter((found) => !/\b(?:function|typeof)\s+$/.test(code.slice(Math.max(0, found.index! - 12), found.index!)))
    // A name before a colon is a key of that name, or a parameter's: `{ reviewFacts: mine }` names nothing of ours.
    .filter((found) => !/^\s*[:?]/.test(code.slice(found.index! + found[0].length, found.index! + found[0].length + 4)))
    .map((found) => {
      const lineEnd = source.indexOf('\n', found.index!);
      return { line: source.slice(0, found.index!).split('\n').length, text: source.slice(source.lastIndexOf('\n', found.index!) + 1, lineEnd < 0 ? source.length : lineEnd).trim() };
    });
}

describe('every call that carries a person’s decision', () => {
  const found = GATED_ROOTS.flatMap((root) =>
    sourcesUnder(root).flatMap((file) => gatedCalls(readFileSync(file, 'utf8')).map((call) => ({ ...call, file: file.split(path.sep).join('/') }))),
  );
  const open = found.filter((call) => !call.passes);
  const allows = (entry: (typeof NOBODY_ASKING)[number], call: (typeof found)[number]) => call.file === entry.file && call.text.includes(entry.has);

  it('passes `mayDecide`, or is on the list with why nobody is asking there', () => {
    assert.deepEqual(
      open.filter((call) => !NOBODY_ASKING.some((entry) => allows(entry, call))).map((call) => `${call.file}:${call.line}  ${call.text.slice(0, 140)}`),
      [],
      'Each of these decides a read value, or moves a paper to where somebody decides, with nobody named as asking: it lets anybody through. ' +
        'Pass `mayDecide` (`decidesFor(req, project)` in a route, the caller’s own where one is handed in). If it is the server’s own work, add it to NOBODY_ASKING in this file with why.',
    );
  });

  it('keeps no reason on the list that nothing answers to any more', () => {
    assert.deepEqual(NOBODY_ASKING.filter((entry) => !open.some((call) => allows(entry, call))).map((entry) => `${entry.file}  ${entry.has}`), []);
  });

  it('has no such call left in the API, where every request is a person’s', () => {
    assert.deepEqual(open.filter((call) => call.file.startsWith('apps/api/')).map((call) => `${call.file}:${call.line}`), []);
  });

  it('is never handed on under another name, where it could be called with nothing passed and no call to read', () => {
    const handedOn = GATED_ROOTS.flatMap((root) =>
      sourcesUnder(root).flatMap((file) => gatedNamedOnly(readFileSync(file, 'utf8')).map((named) => `${file.split(path.sep).join('/')}:${named.line}  ${named.text.slice(0, 140)}`)),
    );
    assert.deepEqual(handedOn, [], 'Each of these names a gated function without calling it. Call it where it is used, with `mayDecide`, so the call can be read here.');
  });

  it('finds what it is meant to find', () => {
    const read = (code: string) => gatedCalls(code).map((call) => call.passes);
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept', actor);"), [false]);
    assert.deepEqual(read('reviewFacts(project, id, keys, decision, actor, edit, options);'), [false], 'options handed on whole are not seen to carry it');
    assert.deepEqual(read("const out = applyProjectChat(canvas, asked, {\n  actor,\n  // who is asking (and why)\n  mayDecide: decidesFor(req, project),\n  place: ')',\n});"), [true], 'a call over several lines is read whole');
    assert.deepEqual(read('setDocumentWorkstream(project, id, null, actor);\nother({ mayDecide });'), [false], 'and no further than its own closing bracket');
    assert.deepEqual(read('export function reviewFacts(project: DdProject): void {}\n/**\n * calls reviewFacts(project)\n */\n// and acceptWaiting(project)\nworkspaceApi.setDocumentWorkstream(id);'), [], 'where one is written down, words about one, and another thing of the same name are not calls of it');

    // The word has to be in the code of the call. Said in a comment or in a string, it is passed to nothing.
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept', actor /* mayDecide: nobody is asking */);"), [false], 'a comment inside the call');
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept',\n  // no mayDecide here\n  actor);"), [false], 'a line of comment inside the call');
    assert.deepEqual(read("applyProjectChat(project, 'who is in mayDecide for this?', { actor });"), [false], 'a string that holds the word');
    assert.deepEqual(read('applyProjectChat(project, `mayDecide`, { actor });'), [false], 'and one in backticks');
    // Nor does saying nobody is asking count as saying who is.
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept', actor, undefined, { mayDecide: undefined });"), [false]);
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept', actor, undefined, { mayDecide:undefined, checkWritable });"), [false]);
    assert.deepEqual(read("reviewFacts(project, id, 'all', 'accept', actor, undefined, { mayDecide: undefinedFor(req) });"), [true], 'a name that only begins that way is a name');
    // A bracket in a pattern or a string is not the call's own, and does not carry it on to the next line.
    assert.deepEqual(read("setDocumentWorkstream(project, id.replace(/\\(/, ''), null, actor);\nlater({ mayDecide });"), [false], 'a bracket in a pattern');
    assert.deepEqual(read("setDocumentWorkstream(project, name.split(/[/(]/)[0], null, actor);\nlater({ mayDecide });"), [false], 'a slash and a bracket inside a set');
    assert.deepEqual(read("setDocumentWorkstream(project, '(', null, actor);\nlater({ mayDecide });"), [false], 'a bracket in a string');
    assert.deepEqual(read('const share = total / count;\nreviewFacts(project, id, keys, decision, actor, edit, { mayDecide }); // a / b'), [true], 'a division is not a pattern');

    // Handed on under another name, there is no call to read.
    const handed = (code: string) => gatedNamedOnly(code).map((named) => named.text);
    assert.deepEqual(handed("const decide = reviewFacts;\ndecide(project, id, 'all', 'accept', actor);"), ['const decide = reviewFacts;']);
    assert.deepEqual(handed('rows.forEach(acceptWaiting);'), ['rows.forEach(acceptWaiting);']);
    assert.deepEqual(
      handed("import {\n  reviewFacts,\n  type MayDecide,\n} from '@realytica/shared';\nexport { acceptWaiting } from './review';\nlet out: ReturnType<typeof applyProjectChat>;\n// reviewFacts decides\nconst said = 'reviewFacts';\nreviewFacts(project, id, keys, decision, actor, edit, { mayDecide });"),
      [],
      'brought in, passed on by an export, asked the type of, written about and called are none of them that',
    );
    assert.ok(found.length >= 40, `and the source was read: ${found.length} calls`);
  });
});

/* ==================================================================== */
/* Over real HTTP                                                        */
/* ==================================================================== */

describe('the routes a decision arrives by', () => {
  const JWKS_URL = 'https://example.test/jwks-decide';
  const ISSUER = 'https://securetoken.google.com/realytica-decide';
  const AUDIENCE = 'realytica-decide';
  const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

  function tokenFor(subject: string, email: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
    const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
    return `${header}.${body}.${sig.toString('base64url')}`;
  }
  /** The developer, who claims the workspace and so owns it; and one of their staff. */
  const dev = () => tokenFor('sub-dev', 'dev@builders.in');
  const asha = () => tokenFor('sub-asha', 'asha@builders.in');

  let server: Server;
  let base: string;
  let dataDir: string;
  let tenantId = '';
  const realFetch = globalThis.fetch;
  const env = ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL'];

  async function call(method: string, route: string, token: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await realFetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  /** The chat answers in NDJSON; the last line carries the result. `sitting` is a choice that was pressed. */
  async function chat(projectId: string, question: string, token: string, sitting?: Record<string, unknown>): Promise<{ text: string; commands: string[]; project: DdProject; planId?: string }> {
    const res = await realFetch(`${base}/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, ...(sitting ? { sitting } : {}) }),
    });
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const result = lines.find((l) => l.type === 'result') as { assistantTurn: { text: string; planId?: string }; commands: string[]; project: DdProject } | undefined;
    assert.ok(result, `the chat returned a result: ${JSON.stringify(lines).slice(0, 400)}`);
    return { text: result.assistantTurn.text, commands: result.commands, project: result.project, planId: result.assistantTurn.planId };
  }

  /** A typed page, which this server reads in a moment by rule, with no model. */
  async function pdfOf(lines: string[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 40, y: 780 - i * 22, size: 11, font }));
    return Buffer.from(await doc.save());
  }
  const DEED = ['SALE DEED', 'This deed of absolute sale is made between the Vendor and the Purchaser.', 'The Vendor hereby conveys the Schedule Property for a sale consideration of Rs. 50,00,000.', 'Survey No. 118/2'];
  const KHATA_MORE = ['Issued by the Assistant Revenue Officer, BBMP', 'Name of the owner: Asha Rao', 'PID No. 82-104-112', 'Ward No. 82', 'Survey No. 118/2', 'Date: 11-05-2024'];
  const KHATA = ['KHATA CERTIFICATE', 'Khata No. 112/4', 'Site area: 1,115 square metres', ...KHATA_MORE];
  const KHATA_OTHER = ['KHATA CERTIFICATE', 'Khata No. 112/4', 'Site area: 1,116 square metres', ...KHATA_MORE];

  /** Put a file on a row of the register, as the page's own Upload does. The server reads it before it answers. */
  async function upload(projectId: string, evidenceId: string, name: string, lines: string[], token: string): Promise<number> {
    const form = new FormData();
    form.append('files', new Blob([await pdfOf(lines)], { type: 'application/pdf' }), name);
    const res = await realFetch(`${base}/api/projects/${projectId}/evidence/${evidenceId}/files`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    await res.text();
    return res.status;
  }

  /** A project in the workspace with a khata dropped on it: what it states waits on the paper, and again on Legal's parcel check. */
  async function seeded(...facts: DocumentFact[]): Promise<{ p: DdProject; row: EvidenceRecord; card: ChatProposal }> {
    const { store } = await import('../apps/api/src/store');
    const made = khataDropped(...facts);
    made.p.tenantId = tenantId;
    store.data.projects!.push(made.p);
    return made;
  }
  const both = [fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2')];

  before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-decide-'));
    process.env.REALYTICA_DATA_DIR = dataDir;
    process.env.REALYTICA_AUTH_MODE = 'oidc';
    process.env.REALYTICA_AUTH_ISSUER = ISSUER;
    process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
    process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return realFetch(input as string, init);
    }) as typeof fetch;

    const { app, initApp } = await import('../apps/api/src/app');
    await initApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // The developer signs in first and claims the workspace, then takes on a member of staff, who signs in.
    assert.equal(((await call('GET', '/api/members', dev())).body.me as { role: string }).role, 'owner');
    assert.equal((await call('POST', '/api/members', dev(), { email: 'asha@builders.in', role: 'staff' })).status, 201);
    assert.equal(((await call('GET', '/api/members', asha())).body.me as { role: string }).role, 'staff');
    const { store } = await import('../apps/api/src/store');
    tenantId = store.data.tenants![0]!.id;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { releaseOcr } = await import('../apps/api/src/documents/read-text');
    await releaseOcr();
    // A plan goes on after its reply: let that end before its directory goes.
    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    await afterReplyWorkDone();
    rmSync(dataDir, { recursive: true, force: true });
    for (const name of env) delete process.env[name];
  });

  it('refuse a member of staff the values on a paper with a 403 that says whose they are, and take the owner’s decision', async () => {
    const { p, row } = await seeded(...both);
    const route = `/api/projects/${p.id}/evidence/${row.id}/facts/review`;
    // Read off the project as the server holds it now, after each call.
    const now = () => p.evidence.find((e) => e.id === row.id)!;

    for (const decision of ['accept', 'reject', 'reopen']) {
      const no = await call('POST', route, asha(), { keys: 'all', decision });
      assert.equal(no.status, 403, decision);
      assert.equal(no.body.error, 'Deciding what was read on this paper needs a lead or signer in Legal.');
    }
    assert.equal(proposedFacts(now()).length, 2, 'nothing was decided');

    const yes = await call('POST', route, dev(), { keys: ['survey_numbers'], decision: 'accept' });
    assert.equal(yes.status, 200);
    assert.equal(yes.body.changed, 1);
    assert.deepEqual(acceptedFacts(now()).map((f) => f.key), ['survey_numbers']);
  });

  it('refuse them a check’s values by every way onto the check, and write none of a correction they send with it', async () => {
    const { p, card } = await seeded(...both);
    const checkId = String(card.payload.checkId);
    const now = () => p.chatProposals.find((c) => c.id === card.id)!;
    const says = 'Deciding a value on this check needs a lead or signer in Legal.';
    const stood = JSON.stringify(card);
    const tries: Array<[string, unknown]> = [
      [`/proposals/${card.id}/fields`, { keys: ['extent_khata'], decision: 'accept', values: { extent_khata: 99999 } }],
      [`/proposals/${card.id}/fields`, { keys: ['extent_khata'], decision: 'reject' }],
      [`/checks/${checkId}/fields/extent_khata/pick`, { proposalId: card.id }],
      [`/checks/${checkId}/fields/extent_khata/pick`, { proposalId: null }],
      [`/proposals/${card.id}/accept`, { payload: { values: { extent_khata: 99999, survey_numbers: '1/1' } } }],
      [`/proposals/${card.id}/set-aside`, {}],
    ];
    for (const [route, body] of tries) {
      const no = await call('POST', `/api/projects/${p.id}${route}`, asha(), body);
      assert.equal(no.status, 403, route);
      assert.equal(no.body.error, says, route);
    }
    assert.equal(JSON.stringify(now()), stood, 'the card is as it was raised, value for value');
    assert.equal(fieldOn(p, now(), 'extent_khata'), undefined);

    // The chat's own two routes answer as the chat does: nothing is taken, and the reply says whose it is.
    const pressed = await call('POST', `/api/projects/${p.id}/chat/proposals/${card.id}/commit`, asha(), { payload: { values: { extent_khata: 99999 } } });
    assert.equal(pressed.status, 200);
    assert.equal((pressed.body.assistantTurn as { text: string }).text, 'Nothing was accepted. 2 values wait for a lead or signer in Legal.');
    const aside = await call('POST', `/api/projects/${p.id}/chat/proposals/${card.id}/reject`, asha(), {});
    assert.equal(aside.status, 200);
    assert.equal((aside.body.assistantTurn as { text: string }).text, 'Nothing was set aside. 2 values wait for a lead or signer in Legal.');
    assert.equal(JSON.stringify(now()), stood, 'and the correction sent with the first went nowhere');

    const yes = await call('POST', `/api/projects/${p.id}/proposals/${card.id}/accept`, dev(), {});
    assert.equal(yes.status, 200);
    assert.equal(fieldOn(p, now(), 'extent_khata'), 11850);
  });

  it('refuse them the valuation’s offers, and answer “approve all” with what waits and for whom', async () => {
    const { p, row } = await seeded();
    const says = 'Deciding a value for the valuation needs a lead or signer in Finance.';
    const taken = await call('POST', `/api/projects/${p.id}/value/accept`, asha(), { ids: ['land_area|document|none||1'], record: true });
    assert.equal(taken.status, 403);
    assert.equal(taken.body.error, says);
    const aside = await call('POST', `/api/projects/${p.id}/value/set-aside`, asha(), { ids: ['land_area|document|none||1'] });
    assert.equal(aside.status, 403);
    assert.equal(aside.body.error, says);
    assert.equal(p.valuationRuns.length, 0, 'and no valuation was recorded on the way to a refusal');

    const said = await chat(p.id, 'approve all', asha());
    assert.equal(said.text, 'Nothing was accepted. 1 value waits for a lead or signer in Legal.');
    assert.deepEqual(said.commands, []);
    assert.equal(proposedFacts(p.evidence.find((e) => e.id === row.id)!).length, 1);

    const done = await chat(p.id, 'approve all', dev());
    assert.match(done.text, /^Accepted 1 value on 1 document\./, 'the owner’s own “approve all” takes what the same reply left');
  });

  it('take what a paper is from anybody who may write, and set aside what it then cannot carry only for somebody who decides it', async () => {
    const { p } = await seeded();
    /** A paper a model took for an encumbrance certificate, with the nil answer it read under that kind waiting on the row. */
    const taken = (title: string): EvidenceRecord => {
      const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
      row.proposedDocumentType = 'Encumbrance certificate';
      row.facts = [{ ...fact('ec_nil', 'yes'), value: true, source: 'model', review: 'proposed' }];
      return row;
    };
    const now = (row: EvidenceRecord) => p.evidence.find((e) => e.id === row.id)!;
    const theirs = taken('Holdings statement');
    const owners = taken('Another holdings statement');

    // "It is not", from a member of staff: the offer goes, as it does for anybody. The value is not theirs to set aside, and waits.
    const said = await call('POST', `/api/projects/${p.id}/evidence/${theirs.id}/document-type/set-aside`, asha());
    assert.equal(said.status, 200);
    assert.deepEqual([now(theirs).proposedDocumentType, now(theirs).refusedDocumentType], [undefined, 'Encumbrance certificate']);
    assert.deepEqual(now(theirs).facts!.map((f) => [f.key, f.review]), [['ec_nil', 'proposed']]);
    // Nor theirs to accept, and nobody's while the paper is no encumbrance certificate.
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${theirs.id}/facts/review`, asha(), { keys: ['ec_nil'], decision: 'accept' })).status, 403);
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${theirs.id}/facts/review`, dev(), { keys: ['ec_nil'], decision: 'accept' })).status, 400);

    // From the owner, the value the paper cannot carry is set aside with the offer, as it always was.
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${owners.id}/document-type/set-aside`, dev())).status, 200);
    assert.deepEqual(now(owners).facts!.map((f) => [f.key, f.review]), [['ec_nil', 'rejected']]);
  });

  it('hold somebody from outside the firm to the same: a place on the project is not a say in what its papers state', async () => {
    const { p, row, card } = await seeded(...both);
    // The khata is filed under the scope its check sits in, so somebody given Legal can see it.
    const scope = p.assessments[0]!.scopes.find((s) => s.checks.some((c) => c.id === card.payload.checkId))!;
    row.scopeInstanceIds.push(scope.id);
    const meera = () => tokenFor('sub-meera', 'meera@law.in');
    const onTheTeam = (role: 'contributor' | 'lead') => call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('meera@law.in')}`, dev(), { departments: { legal: role } });
    const route = `/api/projects/${p.id}/evidence/${row.id}/facts/review`;

    // Put on the project as a contributor in Legal: they are let in as a collaborator, may write there, and decide nothing.
    assert.equal((await onTheTeam('contributor')).status, 200);
    assert.equal(((await call('GET', '/api/members', meera())).body.me as { role: string }).role, 'collaborator');
    const no = await call('POST', route, meera(), { keys: 'all', decision: 'accept' });
    assert.equal(no.status, 403);
    assert.equal(no.body.error, 'Deciding what was read on this paper needs a lead or signer in Legal.');
    assert.equal(proposedFacts(p.evidence.find((e) => e.id === row.id)!).length, 2);

    // Made Legal's lead on this project, the same request is theirs to make.
    assert.equal((await onTheTeam('lead')).status, 200);
    const yes = await call('POST', route, meera(), { keys: 'all', decision: 'accept' });
    assert.equal(yes.status, 200);
    assert.equal(yes.body.changed, 2);
    assert.equal(fieldOn(p, p.chatProposals.find((c) => c.id === card.id)!, 'survey_numbers'), '118/2');
  });

  it('carry out a plan’s accepting step no further than the person running the plan may decide', async () => {
    // Loaded here, once the suite has its own data folder: the runner brings the store with it.
    const { runPlanStep } = await import('../apps/api/src/runs/plan-steps');
    const accepting = (p: DdProject, card: ChatProposal, who: { email: string; workspaceRole: 'owner' | 'staff' }) =>
      runPlanStep({
        project: p,
        actor: who.email,
        mayDecide: decidesIn(p, who),
        tenantId,
        step: { id: 'stp_accept', kind: 'accept_raised', label: 'Accept what the last reply raised', count: 1, state: 'to_do', form: 'last', proposalIds: [card.id] },
        mustEnd: async () => false,
        progress: async () => undefined,
        wrote: () => undefined,
      });

    const theirs = await seeded();
    const left = await accepting(theirs.p, theirs.card, { email: 'asha@builders.in', workspaceRole: 'staff' });
    assert.deepEqual([left.did, left.said], [0, 'Accepted 0 of the 1 thing it named. The rest could not be accepted here and still wait.']);
    assert.equal(theirs.card.status, 'proposed');
    assert.equal(theirs.p.conversation.at(-1)!.text, 'Nothing was accepted. 1 value waits for a lead or signer in Legal.', 'and the thread says why');

    const owners = await seeded();
    const taken = await accepting(owners.p, owners.card, { email: 'dev@builders.in', workspaceRole: 'owner' });
    assert.equal(taken.did, 1);
    assert.equal(fieldOn(owners.p, owners.card, 'extent_khata'), 11850);
  });

  it('refuse them the moving of a paper out of the function that holds it, by the route, by its reset and in the chat, and write the owner’s move on the trail', async () => {
    const { p } = await seeded();
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' }, 'tester');
    report.documentType = 'Valuation report';
    report.facts = [{ ...fact('market_value', 55000000, '₹5.5 Cr'), review: 'proposed' }];
    const route = `/api/projects/${p.id}/evidence/${report.id}/workstream`;
    const now = () => p.evidence.find((e) => e.id === report.id)!;

    // Finance holds a valuation report. Filed under another function it would be that function's to decide: so it is Finance's to move.
    const no = await call('PUT', route, asha(), { workstream: 'construction.site' });
    assert.equal(no.status, 403);
    assert.equal(no.body.error, 'Moving a paper out of the function that holds it needs a lead or signer in Finance.');
    const said = await chat(p.id, 'File “Valuation report” under Site', asha());
    assert.equal(said.text, 'Moving a paper out of the function that holds it needs a lead or signer in Finance. Nothing moved.');
    assert.equal(now().workstream, undefined);
    assert.deepEqual(moved(p), []);
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${report.id}/facts/review`, asha(), { keys: 'all', decision: 'accept' })).status, 403, 'and what it states is still Finance’s');

    const yes = await call('PUT', route, dev(), { workstream: 'construction.site' });
    assert.equal(yes.status, 200);
    assert.equal(now().workstream, 'construction.site');
    assert.deepEqual(moved(p), ['dev@builders.in', report.id, 'Finance › Valuation', 'Engineering › Site']);

    // Handing it back to what it is would take it out of Engineering, which holds it now.
    const reset = await call('PUT', route, asha(), { workstream: null });
    assert.equal(reset.status, 403);
    assert.equal(reset.body.error, 'Moving a paper out of the function that holds it needs a lead or signer in Engineering.');
    assert.equal(now().workstream, 'construction.site');
    assert.equal((await call('PUT', route, dev(), { workstream: null })).status, 200);
    assert.deepEqual(moved(p), ['dev@builders.in', report.id, 'Engineering › Site', 'Finance › Valuation']);

    // A paper nobody holds yet is given its first home by any of the firm's people, and that is written too.
    const loose = addEvidence(p, { title: 'Notes from the broker', kind: 'document', status: 'received' }, 'tester');
    assert.equal((await call('PUT', `/api/projects/${p.id}/evidence/${loose.id}/workstream`, asha(), { workstream: 'commercial.market' })).status, 200);
    assert.deepEqual(moved(p), ['asha@builders.in', loose.id, undefined, 'Commercial › Market']);
  });

  it('refuse them the naming of a paper where naming it would move it, by confirming and by correcting, and let them name one nobody holds', async () => {
    const { p } = await seeded();
    /** A paper a model has taken for a sale deed, which Legal › Title would hold. */
    const taken = (title: string, heldAs?: string): EvidenceRecord => {
      const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
      if (heldAs) row.documentType = heldAs;
      row.proposedDocumentType = 'Sale deed';
      return row;
    };
    const now = (row: EvidenceRecord) => p.evidence.find((e) => e.id === row.id)!;
    const naming = (row: EvidenceRecord, how: 'confirm' | 'correct', token: string, documentType?: string) =>
      call('POST', `/api/projects/${p.id}/evidence/${row.id}/document-type/${how}`, token, documentType ? { documentType } : undefined);
    // Filed as a valuation report, so Finance holds it. A model reading it again takes it for a sale deed.
    const held = taken('Report on the land', 'Valuation report');
    const loose = taken('Scan 0042');
    const says = 'Moving a paper out of the function that holds it needs a lead or signer in Finance.';

    const confirmed = await naming(held, 'confirm', asha());
    assert.deepEqual([confirmed.status, confirmed.body.error], [403, says]);
    const corrected = await naming(held, 'correct', asha(), 'Progress certificate');
    assert.deepEqual([corrected.status, corrected.body.error], [403, says]);
    assert.deepEqual([now(held).documentType, now(held).proposedDocumentType, now(held).refusedDocumentType], ['Valuation report', 'Sale deed', undefined], 'the offer waits as it was, for whoever may answer it');
    assert.deepEqual(moved(p), []);

    // A paper nobody holds is named by anybody who may write. That is its first home, and it is written.
    const first = await naming(loose, 'correct', asha(), 'Encumbrance certificate');
    assert.equal(first.status, 200);
    assert.deepEqual([now(loose).documentType, now(loose).refusedDocumentType], ['Encumbrance certificate', 'Sale deed']);
    assert.deepEqual(moved(p), ['asha@builders.in', loose.id, undefined, 'Legal › Title']);
    // Held now, it is Legal's: a later offer to call it something of another function's is not theirs to take.
    now(loose).proposedDocumentType = 'Valuation report';
    const later = await naming(loose, 'confirm', asha());
    assert.deepEqual([later.status, later.body.error], [403, 'Moving a paper out of the function that holds it needs a lead or signer in Legal.']);

    // The owner leads Finance. Confirming moves the paper to Legal, and the trail has the move and the naming.
    const yes = await naming(held, 'confirm', dev());
    assert.equal(yes.status, 200);
    assert.equal(now(held).documentType, 'Sale deed');
    assert.deepEqual(moved(p), ['dev@builders.in', held.id, 'Finance › Valuation', 'Legal › Title']);
    assert.ok(p.audit.some((line) => line.action === 'type_confirmed' && line.entityId === held.id && line.actor === 'dev@builders.in'));
  });

  it('refuse them the comparables, which set the valuation’s rate, and take the decision from Finance’s lead', async () => {
    const { p } = await seeded();
    // As a search of the portals leaves one: found, and waiting for somebody to say it counts.
    const found = addComparable(p, { title: 'Plot on 3rd Cross, Balagere', price: 9000000, areaSqm: 120 }, 'tester');
    found.status = 'proposed';
    const route = `/api/projects/${p.id}/comparables/decide`;
    const now = () => p.comparables!.find((c) => c.id === found.id)!;

    for (const decision of ['accept', 'reject']) {
      const no = await call('POST', route, asha(), { ids: [found.id], decision });
      assert.equal(no.status, 403, decision);
      assert.equal(no.body.error, 'Deciding a comparable needs a lead or signer in Finance.');
    }
    assert.equal(now().status, 'proposed');

    const yes = await call('POST', route, dev(), { ids: [found.id], decision: 'accept' });
    assert.deepEqual([yes.status, yes.body.changed], [200, 1]);
    assert.deepEqual([now().status, now().decidedBy], ['accepted', 'dev@builders.in']);

    // Made Finance's signer on this project, it is theirs.
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('asha@builders.in')}`, dev(), { departments: { finance: 'signer' }, signer: { profession: 'Registered Valuer' } })).status, 200);
    const theirs = await call('POST', route, asha(), { ids: [found.id], decision: 'reject' });
    assert.deepEqual([theirs.status, theirs.body.changed], [200, 1]);
  });

  it('judge somebody from outside the firm by where the whole project holds a paper, and keep on the trail what their chat accepted', async () => {
    const { p } = await seeded();
    const check = (definitionId: string) => allChecks(p).find((held) => held.definitionId === definitionId)!;
    const sam = () => tokenFor('sub-sam', 'sam@site.in');
    /** A paper of no kind that these checks list, filed by a reply in the engineer's own chat: theirs to say “approve all” to. */
    const listed = (title: string, ...by: string[]): EvidenceRecord => {
      const row = addEvidence(p, { title, kind: 'document', status: 'received', checkIds: by.map((id) => check(id).id) }, 'tester');
      for (const id of by) check(id).evidenceIds.push(row.id);
      row.facts = [{ ...fact('inspected_on', '2026-05-02', '2 May 2026'), review: 'proposed' }];
      p.conversation.push({ id: `turn_${row.id}`, role: 'assistant', text: `Filed “${title}”.`, at: new Date().toISOString(), actor: 'sam@site.in', toolCalls: [{ name: 'ingest', summary: 'Filed 1 file' }], citedEvidenceIds: [row.id] } as ProjectChatTurn);
      return row;
    };
    const now = (row: EvidenceRecord) => p.evidence.find((e) => e.id === row.id)!;

    // Legal's title check lists it first and Engineering's structural check after: on the whole project, Legal holds it.
    const shared = listed('Inspection note', 'legal.title_chain', 'technical.structural');
    assert.equal(departmentOfPaper(p, shared), 'legal');
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('sam@site.in')}`, dev(), { departments: { construction: 'signer' }, signer: { profession: 'Structural Engineer' } })).status, 200);
    assert.equal(((await call('GET', '/api/members', sam())).body.me as { role: string }).role, 'collaborator');

    // The project as they are handed it has no Legal title check, so on it alone the first check to list the paper is Engineering's, where they sign.
    const seen = (await call('GET', `/api/projects/${p.id}`, sam())).body as unknown as DdProject;
    assert.ok(seen.evidence.some((e) => e.id === shared.id), 'they can see the paper');
    assert.ok(!allChecks(seen).some((held) => held.definitionId === 'legal.title_chain'));
    assert.equal(departmentOfPaper(seen, shared), 'construction');

    const no = await chat(p.id, 'approve all', sam());
    assert.equal(no.text, 'Nothing was accepted. 1 value waits for a lead or signer in Legal.');
    assert.equal(proposedFacts(now(shared)).length, 1);
    const byRoute = await call('POST', `/api/projects/${p.id}/evidence/${shared.id}/facts/review`, sam(), { keys: 'all', decision: 'accept' });
    assert.deepEqual([byRoute.status, byRoute.body.error], [403, 'Deciding what was read on this paper needs a lead or signer in Legal.']);

    // A paper Engineering holds on the whole project is theirs to accept in the chat, and the trail says who did.
    const own = listed('Core test results', 'technical.structural');
    const yes = await chat(p.id, 'approve all', sam());
    assert.match(yes.text, /^Accepted 1 value on 1 document\./);
    assert.equal(acceptedFacts(now(own)).length, 1);
    assert.deepEqual(p.audit.filter((line) => line.action === 'accept_fact' && line.entityId === own.id).map((line) => line.actor), ['sam@site.in'], 'the line their chat wrote on their copy is on the project’s trail, once');
    assert.equal(proposedFacts(now(shared)).length, 1, 'and Legal’s paper is as it was');
  });

  it('carry out a plan’s accepting step through the chat no further than the person running it may decide', async () => {
    const sentence = 'Accept everything waiting, then write the status for September 2026';
    const stepped = (p: DdProject) => p.conversation.map((turn) => turn.text.split('\n')[0]!);

    const theirs = await seeded();
    const laid = await chat(theirs.p.id, sentence, asha());
    assert.ok(laid.planId, `two steps are shown as a plan before anything starts: ${laid.text}`);
    assert.equal(laid.text.split('\n')[1], '1. Accept 1 thing waiting on the project.');
    const ran = await chat(theirs.p.id, 'Run the plan', asha(), { plan: { id: laid.planId, act: 'run' } });
    assert.match(ran.text, /^The plan is done: 2 of 2 steps done\./);
    assert.ok(stepped(theirs.p).includes('Nothing was accepted. 1 value waits for a lead or signer in Legal.'), stepped(theirs.p).join(' | '));
    assert.ok(stepped(theirs.p).some((line) => /^Step 1 of 2 done\. .*Accepted 0 of the 1 thing it named\. The rest could not be accepted here and still wait\.$/.test(line)), stepped(theirs.p).join(' | '));
    const left = theirs.p.chatProposals.find((c) => c.id === theirs.card.id)!;
    assert.equal(left.status, 'proposed');
    assert.equal(fieldOn(theirs.p, left, 'extent_khata'), undefined);
    assert.equal(proposedFacts(theirs.p.evidence.find((e) => e.id === theirs.row.id)!).length, 1);

    // The same plan run by the owner takes it.
    const owners = await seeded();
    const shown = await chat(owners.p.id, sentence, dev());
    await chat(owners.p.id, 'Run the plan', dev(), { plan: { id: shown.planId, act: 'run' } });
    assert.ok(stepped(owners.p).some((line) => /^Step 1 of 2 done\. .*Accepted 1 of the 1 thing it named\.$/.test(line)), stepped(owners.p).join(' | '));
    assert.equal(fieldOn(owners.p, owners.p.chatProposals.find((c) => c.id === owners.card.id)!, 'extent_khata'), 11850);
  });

  it('let no file put on a row rename its paper: what the file reads as is an offer, and taking it is held to the rule for a move', async () => {
    const { p } = await seeded();
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' }, 'tester');
    report.documentType = 'Valuation report';
    report.facts = [{ ...fact('market_value', 55000000, '₹5.5 Cr'), review: 'proposed' }];
    const now = () => p.evidence.find((e) => e.id === report.id)!;
    const review = `/api/projects/${p.id}/evidence/${report.id}/facts/review`;
    const naming = (how: 'confirm' | 'correct', token: string, documentType?: string) =>
      call('POST', `/api/projects/${p.id}/evidence/${report.id}/document-type/${how}`, token, documentType ? { documentType } : undefined);
    const finance = 'Moving a paper out of the function that holds it needs a lead or signer in Finance.';

    // Legal's lead decides nothing on Finance's valuation report, and may not move it.
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('asha@builders.in')}`, dev(), { departments: { legal: 'lead' } })).status, 200);
    assert.equal((await call('POST', review, asha(), { keys: ['market_value'], decision: 'accept' })).status, 403);
    assert.equal((await call('PUT', `/api/projects/${p.id}/evidence/${report.id}/workstream`, asha(), { workstream: 'legal.title' })).status, 403);

    // They put a sale deed on its row. The file is taken and read. The row is still a valuation report, and still Finance's.
    assert.equal(await upload(p.id, report.id, 'deed.pdf', DEED, asha()), 201);
    assert.deepEqual([now().documentType, now().proposedDocumentType, departmentOfPaper(p, now())], ['Valuation report', 'Sale deed', 'finance']);
    assert.deepEqual(moved(p), [], 'nothing moved, so the trail has no move');
    assert.ok(p.conversation.some((turn) => /deed\.pdf reads as a sale deed, and its row says a valuation report\. The row keeps its kind until somebody confirms or corrects it there/.test(turn.text)), 'and the note of the reading says so');
    assert.equal((await call('POST', review, asha(), { keys: ['market_value'], decision: 'accept' })).status, 403, 'so its value is no more theirs than it was');
    assert.deepEqual(proposedFacts(now()).map((held) => held.key).includes('market_value'), true);

    // Taking the offer would move the paper to Legal. That is Finance's to do, by either way of saying what the paper is.
    const confirmed = await naming('confirm', asha());
    assert.deepEqual([confirmed.status, confirmed.body.error], [403, finance]);
    const corrected = await naming('correct', asha(), 'Sale deed');
    assert.deepEqual([corrected.status, corrected.body.error], [403, finance]);
    assert.equal(now().documentType, 'Valuation report');

    // The owner leads Finance and confirms it. Now it is a sale deed, and the move is on the trail.
    assert.equal((await naming('confirm', dev())).status, 200);
    assert.equal(now().documentType, 'Sale deed');
    assert.deepEqual(moved(p), ['dev@builders.in', report.id, 'Finance › Valuation', 'Legal › Title']);
  });

  it('hold the naming of a row that carries a decided value to whoever decides the paper, though the paper stays where it is', async () => {
    const { p } = await seeded();
    const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' }, 'tester');
    const now = () => p.evidence.find((e) => e.id === deed.id)!;
    const naming = (how: 'confirm' | 'correct' | 'set-aside', token: string, documentType?: string) =>
      call('POST', `/api/projects/${p.id}/evidence/${deed.id}/document-type/${how}`, token, documentType ? { documentType } : undefined);

    // A row with no kind is named by the first reading put on it, as it always was. The owner accepts what the deed states.
    assert.equal(await upload(p.id, deed.id, 'deed.pdf', DEED, dev()), 201);
    assert.equal(now().documentType, 'Sale deed');
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${deed.id}/facts/review`, dev(), { keys: 'all', decision: 'accept' })).status, 200);
    const accepted = acceptedFacts(now()).map((held) => held.key).sort();
    assert.ok(accepted.length > 0, 'the deed states something, and it was accepted');

    // A member of staff with no role puts a khata on the row. A khata would be held where the deed is, so nothing would move:
    // but as a khata the row would carry none of what was accepted on it as a deed.
    assert.equal(await upload(p.id, deed.id, 'khata.pdf', KHATA, asha()), 201);
    assert.deepEqual([now().documentType, now().proposedDocumentType], ['Sale deed', 'Khata certificate and extract']);
    assert.deepEqual(acceptedFacts(now()).map((held) => held.key).sort(), accepted, 'what was accepted is still accepted');
    assert.ok(accepted.every((key) => standingFacts(now()).some((held) => held.key === key)), 'and still stands');

    const says = 'Saying what a paper is once a value on it has been decided needs a lead or signer in Legal.';
    const confirmed = await naming('confirm', asha());
    assert.deepEqual([confirmed.status, confirmed.body.error], [403, says]);
    const corrected = await naming('correct', asha(), 'Encumbrance certificate');
    assert.deepEqual([corrected.status, corrected.body.error], [403, says]);
    assert.deepEqual([now().documentType, now().proposedDocumentType], ['Sale deed', 'Khata certificate and extract']);
    // Saying it is not a khata renames nothing, and is anybody's who may write.
    assert.equal((await naming('set-aside', asha())).status, 200);
    assert.deepEqual([now().documentType, now().proposedDocumentType, now().refusedDocumentType], ['Sale deed', undefined, 'Khata certificate and extract']);
    assert.deepEqual(moved(p), []);
  });

  it('keep what the owner set aside on a paper through any number of files put on its row, and offer it to no check again', async () => {
    const { p } = await seeded();
    const khata = addEvidence(p, { title: 'Khata', kind: 'document', status: 'received' }, 'tester');
    const now = () => p.evidence.find((e) => e.id === khata.id)!;
    assert.equal(await upload(p.id, khata.id, 'khata.pdf', KHATA, asha()), 201);
    const read = (now().facts ?? []).find((held) => held.value === 1115);
    assert.ok(read, `the site area was read: ${JSON.stringify((now().facts ?? []).map((held) => [held.key, held.value]))}`);
    const key = read.key;
    const under = () => (now().facts ?? []).filter((held) => held.key === key).map((held) => [held.value, held.review, held.decidedBy]);
    /** The cards on which this figure still waits to be put on a check. */
    const offering = (value: number) =>
      p.chatProposals.filter((card) => card.kind === 'record_check_fields' && card.status === 'proposed' && waitingFieldKeys(card).includes(key) && (card.payload.values as Record<string, unknown>)[key] === value).map((card) => card.id);

    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${khata.id}/facts/review`, dev(), { keys: [key], decision: 'reject' })).status, 200);
    assert.deepEqual(under(), [[1115, 'rejected', 'dev@builders.in']]);
    assert.equal((await call('POST', `/api/projects/${p.id}/evidence/${khata.id}/facts/review`, asha(), { keys: [key], decision: 'reopen' })).status, 403, 'a member of staff may not reopen it');

    // The same file again brings nothing new, and offers the figure to no check: the row does not state it.
    assert.equal(await upload(p.id, khata.id, 'khata.pdf', KHATA, asha()), 201);
    assert.deepEqual(under(), [[1115, 'rejected', 'dev@builders.in']]);
    assert.deepEqual(offering(1115), []);

    // A file with another figure, then the first again: two uploads that used to bring the figure back as if nobody had decided it.
    assert.equal(await upload(p.id, khata.id, 'khata-b.pdf', KHATA_OTHER, asha()), 201);
    assert.deepEqual(under(), [[1115, 'rejected', 'dev@builders.in'], [1116, 'proposed', undefined]]);
    assert.equal(await upload(p.id, khata.id, 'khata.pdf', KHATA, asha()), 201);
    assert.deepEqual(under(), [[1115, 'rejected', 'dev@builders.in']]);
    assert.ok(!standingFacts(now()).some((held) => held.key === key), 'it stands nowhere');
    assert.deepEqual(offering(1115), [], 'and waits on no check');
  });

  it('leave a card exactly as it was raised when its commit is refused or fails, whatever was sent with the accept', async () => {
    const { p } = await seeded();
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' }, 'tester');
    report.documentType = 'Valuation report';
    const card = createChatProposal('assign_document', 'File “Valuation report” under Finance › Tax', 'It is a tax paper.', 'Moves it to Finance › Tax.', { evidenceId: report.id, workstream: 'finance.tax' }, 'tester');
    p.chatProposals.push(card);
    const raised = JSON.stringify(card.payload);
    const now = () => p.chatProposals.find((held) => held.id === card.id)!;
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('asha@builders.in')}`, dev(), { departments: { construction: 'lead' } })).status, 200);

    // Engineering's lead may not move Finance's paper. Pressed in the chat or accepted on the page, with another place sent along,
    // the card is refused and is as it was: the same place, and nothing added to it.
    const pressed = await call('POST', `/api/projects/${p.id}/chat/proposals/${card.id}/commit`, asha(), { payload: { workstream: 'construction.site', remark: 'to site' } });
    assert.equal(pressed.status, 200);
    assert.equal((pressed.body.assistantTurn as { text: string }).text, 'Nothing was accepted. “File “Valuation report” under Finance › Tax” stays waiting. Moving a paper out of the function that holds it needs a lead or signer in Finance.');
    assert.equal(JSON.stringify(now().payload), raised);
    const onPage = await call('POST', `/api/projects/${p.id}/proposals/${card.id}/accept`, asha(), { payload: { workstream: 'construction.quality', remark: 'to site' } });
    assert.equal(onPage.status, 403);
    assert.equal(JSON.stringify(now().payload), raised);
    assert.equal(now().status, 'proposed');

    // A commit that fails for any other reason leaves its card alone too.
    const lost = createChatProposal('assign_document', 'File “Old lease” under Legal › Title', 'It is a title paper.', 'Moves it.', { evidenceId: 'ev_no_longer_here', workstream: 'legal.title' }, 'tester');
    p.chatProposals.push(lost);
    const failed = await call('POST', `/api/projects/${p.id}/proposals/${lost.id}/accept`, dev(), { payload: { remark: 'try again' } });
    assert.deepEqual([failed.status, failed.body.error], [400, 'No document by that id.']);
    assert.deepEqual(p.chatProposals.find((held) => held.id === lost.id)!.payload, { evidenceId: 'ev_no_longer_here', workstream: 'legal.title' });

    // Where a card files a paper is the card's own, like the paper it names: not a correction to send with an accept.
    assert.ok(PROPOSAL_IDENTITY.has('workstream'));
    const taken = await call('POST', `/api/projects/${p.id}/proposals/${card.id}/accept`, dev(), { payload: { workstream: 'construction.site' } });
    assert.equal(taken.status, 200);
    assert.equal(p.evidence.find((e) => e.id === report.id)!.workstream, 'finance.tax', 'Finance’s lead accepts it as it is titled');
    assert.deepEqual(moved(p), ['dev@builders.in', report.id, 'Finance › Valuation', 'Finance › Tax']);
  });

  it('write no line on the trail for a record somebody’s chat made on their own copy and the project never got', async () => {
    const { p } = await seeded();
    const sam = () => tokenFor('sub-sam', 'sam@site.in');
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('sam@site.in')}`, dev(), { departments: { construction: 'signer' }, signer: { profession: 'Structural Engineer' } })).status, 200);
    const before = p.audit.length;
    const said: string[] = [];
    for (const sentence of ['Add a finding: honeycombing in the basement slab, high severity', 'Add an action: get the core test report from the lab', 'Add a risk: slab may need jacketing']) {
      said.push((await chat(p.id, sentence, sam())).text);
    }
    assert.ok(said.some((text) => /^Done/.test(text)), `their chat carried something out: ${said.join(' | ')}`);
    // Whatever the trail gained, each line names something that is on the project.
    const onFile = projectRecordIds(p);
    assert.deepEqual(p.audit.slice(before).filter((line) => !onFile.has(line.entityId)).map((line) => [line.actor, line.action, line.entityType]), []);
  });

  it('take their decision once the team list makes them a lead of the paper’s department', async () => {
    const { p, row, card } = await seeded(...both);
    const route = `/api/projects/${p.id}/evidence/${row.id}/facts/review`;
    assert.equal((await call('POST', route, asha(), { keys: 'all', decision: 'accept' })).status, 403);

    const put = await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent('asha@builders.in')}`, dev(), { departments: { legal: 'lead' } });
    assert.equal(put.status, 200);
    const yes = await call('POST', route, asha(), { keys: 'all', decision: 'accept' });
    assert.equal(yes.status, 200);
    assert.equal(yes.body.changed, 2);
    assert.equal(fieldOn(p, p.chatProposals.find((c) => c.id === card.id)!, 'extent_khata'), 11850, 'and it follows onto Legal’s check');
    // Finance is still not theirs.
    assert.equal((await call('POST', `/api/projects/${p.id}/value/set-aside`, asha(), { ids: ['land_area|document|none||1'] })).status, 403);
  });
});
