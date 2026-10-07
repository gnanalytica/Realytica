/**
 * Links land where the record lives.
 *
 * A chip in an answer, a citation, a document an answer quotes: each opens
 * the page of the function that holds the record, at the part of the page the
 * record sits in, and not the register of every record of its kind. A record
 * no function's page has a place for opens in the register, as it always has.
 *
 * Asked here of the seeded projects, with the kinds of record the seed does
 * not carry (a document in hand, a milestone, a site visit, a certified
 * report) added the way the product adds them. The graph is the witness for
 * which function holds what: where it draws a `holds` edge, the place agrees.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  MENU_DEPARTMENTS,
  SHARED_PLACE_WORDS,
  WORKSTREAMS,
  addDecision,
  addEvidence,
  addMilestones,
  addSiteVisit,
  applyProjectChat,
  attachEvidenceFile,
  buildProjectGraph,
  chatLinkLabels,
  cockpitPath,
  fileCertifiedReport,
  functionKey,
  functionSections,
  generateReport,
  linkRecordIds,
  logSiteEntry,
  menuFunctions,
  placeOfRecord,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  stageOf,
  waitingOnCanvas,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
} from '@realytica/shared';

/** A document in hand: a row with a file on it, and what it is. */
function filed(project: DdProject, title: string, documentType?: string): EvidenceRecord {
  const row = addEvidence(project, { title, kind: 'document', status: 'received' });
  if (documentType) row.documentType = documentType;
  attachEvidenceFile(project, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `s3://${title}` });
  return row;
}

const fact = (key: string, label: string, value: string | number, display: string, page: number): DocumentFact => ({ key, label, value, display, page, quote: `${label}: ${display}`, review: 'proposed' });

describe('where a record lives', () => {
  it('opens a document in hand on the page of the function that holds it, at its documents', () => {
    const p = seedDemoProject();
    const deed = filed(p, 'Sale deed 2019', 'Sale deed');
    const at = placeOfRecord(p, deed.id, { pane: 'overview', stage: stageOf(p.currentStage) })!;
    assert.deepEqual([at.kind, at.department, at.fn, at.section], ['document', 'legal', 'legal.title', 'documents']);
    assert.deepEqual(at.open, { pane: 'workstream', extra: { workstream: 'legal.title', stage: stageOf(p.currentStage), section: 'documents', evidenceId: deed.id } });
    assert.equal(cockpitPath(p.id, at.open.pane, at.open.extra), `/projects/${p.id}/w/legal.title?stage=build&part=documents&evidence=${deed.id}`);
    const noc = filed(p, 'Fire NOC', 'Fire NOC');
    assert.equal(placeOfRecord(p, noc.id)?.fn, 'legal.approvals');
  });

  it('opens a document no function holds in the register of every document, as it always has', () => {
    const p = seedDemoProject();
    const loose = filed(p, 'Meeting notes');
    const at = placeOfRecord(p, loose.id)!;
    assert.deepEqual([at.kind, at.fn, at.section], ['document', undefined, undefined]);
    assert.deepEqual(at.open, { pane: 'evidence', extra: { evidenceId: loose.id } });
  });

  it('opens a document still expected in the register, where it has a row', () => {
    const p = seedBdaReferenceProject();
    // The seed's rows are papers the checks expect. None has come, so none is on a function's page yet.
    for (const row of p.evidence.slice(0, 12)) {
      assert.equal(row.attachments.length, 0);
      assert.deepEqual(placeOfRecord(p, row.id)?.open, { pane: 'evidence', extra: { evidenceId: row.id } }, row.title);
    }
  });

  it('opens a check on its function’s page at the checks, and one whose page has no such part where it is recorded', () => {
    const p = seedBdaReferenceProject();
    const seen = new Set<string>();
    for (const a of p.assessments) {
      for (const s of a.scopes) {
        for (const c of s.checks) {
          const at = placeOfRecord(p, c.id)!;
          assert.equal(at.kind, 'check');
          if (at.section) {
            assert.equal(at.section, 'checks');
            assert.equal(at.open.pane, 'workstream');
            assert.deepEqual([at.open.extra.workstream, at.open.extra.item], [at.fn, c.id], c.title);
            assert.ok(functionSections(at.fn!).includes('checks'));
            // The sitting travels with it, so the check can still be answered from the chat.
            assert.deepEqual([at.open.extra.ddId, at.open.extra.scopeId, at.open.extra.checkId], [a.id, s.id, c.id]);
          } else {
            assert.deepEqual(at.open, { pane: 'scope', extra: { ddId: a.id, scopeId: s.id, checkId: c.id } }, c.title);
          }
          seen.add(at.section ? 'page' : 'register');
        }
      }
    }
    assert.deepEqual([...seen].sort(), ['page', 'register'], 'the seed has checks of both kinds');
  });

  it('agrees with the graph about which function holds a record', () => {
    for (const p of [seedDemoProject(), seedBdaReferenceProject()]) {
      filed(p, 'Sale deed 2019', 'Sale deed');
      addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
      addSiteVisit(p, { title: 'First visit', purpose: 'inspection', visitedOn: '2026-09-01', surveyor: 'tester' } as never);
      const graph = buildProjectGraph(p);
      let compared = 0;
      for (const edge of graph.edges.filter((e) => e.rel === 'holds')) {
        const fn = graph.nodes.find((n) => n.id === edge.from)?.key;
        const at = placeOfRecord(p, edge.to);
        // A questionnaire is kept by its department, and the graph files it under that department's first function.
        if (!at || at.kind === 'questionnaire') continue;
        assert.equal(at.fn, fn, `${at.kind} “${at.label}”`);
        compared += 1;
      }
      assert.ok(compared > 20, `${p.name}: ${compared} records compared`);
    }
  });

  it('opens a finding, a risk, an action, a decision and a report in their registers, with the record named', () => {
    const p = seedDemoProject();
    const finding = p.findings[0]!;
    assert.deepEqual(placeOfRecord(p, finding.id)?.open, { pane: 'findings', extra: { findingId: finding.id } });
    const risk = p.risks[0]!;
    assert.deepEqual(placeOfRecord(p, risk.id)?.open, { pane: 'risks', extra: { riskId: risk.id } });
    const action = p.actions[0]!;
    assert.deepEqual(placeOfRecord(p, action.id)?.open, { pane: 'actions', extra: { actionId: action.id } });
    const decision = p.decisions[0] ?? addDecision(p, { title: 'Proceed', decisionType: 'proceed', decisionMaker: 'tester', rationale: 'Clear.', status: 'proposed' } as never);
    const decided = placeOfRecord(p, decision.id)!;
    assert.equal(cockpitPath(p.id, decided.open.pane, decided.open.extra), `/projects/${p.id}/decisions?decision=${decision.id}`);
    const report = p.reports[0] ?? generateReport(p, { kind: 'red_flag', assessmentIds: [], generatedBy: 'tester' });
    const reported = placeOfRecord(p, report.id)!;
    assert.equal(cockpitPath(p.id, reported.open.pane, reported.open.extra), `/projects/${p.id}/reports?report=${report.id}`);
    // A finding says which function it belongs to, and still opens where findings are kept: no function's page has a part for them.
    assert.equal(placeOfRecord(p, finding.id)?.section, undefined);
  });

  it('opens an approval, a milestone and a site entry on the part of the page that is their own', () => {
    const p = seedDemoProject();
    const approval = placeOfRecord(p, `${p.id}::approval::fire`)!;
    assert.deepEqual([approval.kind, approval.fn, approval.section, approval.open.extra.item], ['approval', 'legal.approvals', 'approvals', 'fire']);
    const [milestone] = addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
    const built = placeOfRecord(p, milestone!.id)!;
    assert.deepEqual([built.kind, built.fn, built.section, built.open.extra.item], ['milestone', 'construction.progress', 'progress', milestone!.id]);
    const { entry } = logSiteEntry(p, { clientId: 'phone-1', date: '2026-09-02', workDone: 'Shuttering on level 3.' }, 'tester');
    const logged = placeOfRecord(p, entry.id)!;
    assert.deepEqual([logged.kind, logged.fn, logged.section, logged.open.extra.item], ['site_entry', 'construction.progress', 'progress', entry.id]);
  });

  it('opens a site visit on the site record, and a certified report and an estimate beside each other', () => {
    const p = seedDemoProject();
    const visit = addSiteVisit(p, { title: 'First visit', purpose: 'inspection', visitedOn: '2026-09-01', surveyor: 'tester' } as never);
    const visited = placeOfRecord(p, visit.id)!;
    assert.deepEqual([visited.kind, visited.fn, visited.open.pane], ['site_visit', 'construction.site', 'visits']);
    const opinion = filed(p, 'Title opinion', 'Legal opinion on title');
    const certified = fileCertifiedReport(p, { workstream: 'legal.title', title: 'Title opinion', evidenceId: opinion.id, signer: { name: 'A. Rao', profession: 'Advocate' }, verdict: 'clear' }, 'tester');
    const signed = placeOfRecord(p, certified.id)!;
    assert.deepEqual([signed.kind, signed.fn, signed.section, signed.open.extra.item], ['certified_report', 'legal.title', 'standing', certified.id]);
    const estimate = placeOfRecord(p, `${p.id}::qa::legal.title`)!;
    assert.deepEqual([estimate.kind, estimate.fn, estimate.section], ['estimate', 'legal.title', 'standing']);
    // Valuation's page is not laid out in parts, so its estimate opens the page itself.
    const value = placeOfRecord(p, `${p.id}::qa::finance.valuation`)!;
    assert.deepEqual([value.fn, value.section, value.open.pane], ['finance.valuation', undefined, 'valuation']);
  });

  it('opens a stage, a department and a function quoted by the id the graph gives them', () => {
    const p = seedDemoProject();
    const here = { pane: 'workstream' as const, department: 'legal' as const, fn: 'legal.title', stage: stageOf(p.currentStage) };
    const stage = placeOfRecord(p, `${p.id}::stage::pre_development`, here)!;
    assert.deepEqual([stage.kind, stage.fn, stage.stage], ['stage', 'legal.title', 'pre_development']);
    const department = placeOfRecord(p, `${p.id}::dept::finance`, here)!;
    assert.deepEqual([department.kind, department.open.pane, department.open.extra.department], ['department', 'department', 'finance']);
    const fn = placeOfRecord(p, `${p.id}::ws::legal.approvals`, here)!;
    assert.deepEqual([fn.kind, fn.fn, fn.open.pane], ['function', 'legal.approvals', 'workstream']);
    // What the menu has no place for is left to the graph.
    assert.equal(placeOfRecord(p, `${p.id}::parcel`), undefined);
    assert.equal(placeOfRecord(p, 'ev_not_on_this_project'), undefined);
    assert.equal(placeOfRecord(p, `other_project::ws::legal.title`), undefined);
  });

  it('keeps a paper of a department that is switched off in the register', () => {
    const p = seedDemoProject();
    const deed = filed(p, 'Sale deed 2019', 'Sale deed');
    setProjectDepartments(p, ['finance', 'construction'], 'tester');
    const at = placeOfRecord(p, deed.id)!;
    assert.deepEqual([at.fn, at.open.pane], [undefined, 'evidence'], 'Legal is off, so its page is not in the menu');
  });

  it('opens no page of a department that is switched off', () => {
    const p = seedDemoProject();
    const [milestone] = addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
    const { entry } = logSiteEntry(p, { clientId: 'phone-1', date: '2026-09-02', workDone: 'Shuttering on level 3.' }, 'tester');
    const visit = addSiteVisit(p, { title: 'First visit', purpose: 'inspection', visitedOn: '2026-09-01', surveyor: 'tester' } as never);
    const opinion = filed(p, 'Title opinion', 'Legal opinion on title');
    const certified = fileCertifiedReport(p, { workstream: 'legal.title', title: 'Title opinion', evidenceId: opinion.id, signer: { name: 'A. Rao', profession: 'Advocate' }, verdict: 'clear' }, 'tester');
    const ids = [`${p.id}::approval::fire`, milestone!.id, entry.id, visit.id, `${p.id}::qa::legal.title`, `${p.id}::qa::construction.progress`];
    for (const id of ids) assert.ok(placeOfRecord(p, id), `${id} has a page while its department is on`);

    setProjectDepartments(p, ['finance'], 'tester');
    // With Legal and Engineering off these have no page. They are left to the graph, as a parcel is.
    for (const id of ids) assert.equal(placeOfRecord(p, id), undefined, id);
    // A certified report is a paper too, and opens as one.
    const signed = placeOfRecord(p, certified.id)!;
    assert.deepEqual([signed.kind, signed.fn, signed.open.pane, signed.open.extra.evidenceId], ['certified_report', undefined, 'evidence', opinion.id]);
    // Valuation is Finance's, and Finance is on.
    assert.equal(placeOfRecord(p, `${p.id}::qa::finance.valuation`)?.open.pane, 'valuation');
  });

  it('opens a function’s page at the stage being looked at when it shows there, and at the project’s own when it does not', () => {
    const p = seedDemoProject();
    const deed = filed(p, 'Sale deed 2019', 'Sale deed');
    assert.equal(placeOfRecord(p, deed.id, { pane: 'overview', stage: 'pre_development' })?.stage, 'pre_development', 'Title shows at Land');
    const [milestone] = addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
    assert.equal(placeOfRecord(p, milestone!.id, { pane: 'overview', stage: 'pre_development' })?.stage, stageOf(p.currentStage), 'Progress has no work at Land');
  });
});

describe('every link the chat shows lands there', () => {
  it('opens the document an answer quotes on its function’s page, at the page quoted', () => {
    const p = seedDemoProject();
    const deed = filed(p, 'Sale deed 2019', 'Sale deed');
    deed.facts = [fact('extent_title', 'Extent per title', 12000, '12,000 sqm', 2)].map((f) => ({ ...f, review: 'accepted' as const }));
    const out = applyProjectChat(p, 'what is the extent?');
    assert.deepEqual(out.navigations.at(-1), { target: 'workstream', workstream: 'legal.title', stage: stageOf(p.currentStage), section: 'documents', evidenceId: deed.id, page: '2' });
  });

  it('opens a document named in a sentence where it lives', () => {
    const p = seedDemoProject();
    const deed = filed(p, 'Registered sale deed of 2019', 'Sale deed');
    const out = applyProjectChat(p, 'open the registered sale deed of 2019');
    const nav = out.navigations.at(-1)!;
    assert.deepEqual([nav.target, nav.workstream, nav.section, nav.evidenceId], ['workstream', 'legal.title', 'documents', deed.id]);
  });

  it('turns the ids of every kind it can place into links, and leaves the rest as written', () => {
    const p = seedDemoProject();
    const [milestone] = addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
    const decision = p.decisions[0]!;
    const labels = new Map(chatLinkLabels(p).map((row) => [row.id, row.label]));
    assert.equal(labels.get(milestone!.id), 'Plinth');
    assert.equal(labels.get(decision.id), decision.title);
    // Every id the chat can show as a link has somewhere to open, apart from the project itself.
    for (const id of labels.keys()) {
      if (id === p.id) continue;
      assert.ok(placeOfRecord(p, id), `a link for ${labels.get(id)} with nowhere to go`);
    }
    const said = linkRecordIds(p, `The plinth ${milestone!.id} is late, decided in ${decision.id}, and ${p.id}::approval::plan_sanction is missing. See mil_unknown.`);
    assert.ok(said.includes(`[${milestone!.id}]`) && said.includes(`[${decision.id}]`) && said.includes(`[${p.id}::approval::plan_sanction]`), said);
    assert.ok(said.includes('See mil_unknown.'), 'an id of no record on this project is left as it was written');
  });

  it('walks the documents with values waiting a function at a time, in the menu’s order', () => {
    const p = seedDemoProject();
    // Filed out of order on purpose: an approval, a paper no function holds, then two of Title's.
    const papers: Array<[string, string | undefined]> = [['Fire NOC', 'Fire NOC'], ['Meeting notes', undefined], ['Sale deed 2019', 'Sale deed'], ['Mother deed 1987', 'Mother deed']];
    for (const [title, type] of papers) filed(p, title, type).facts = [fact('issued_on', 'Issued on', '2020-03-10', '10 Mar 2020', 1)];
    const waiting = waitingOnCanvas(p).entries.filter((e) => e.kind === 'facts');
    assert.deepEqual(waiting.map((e) => e.fn), ['legal.title', 'legal.title', 'legal.approvals', undefined]);
    assert.equal(waiting[0]!.pane, 'evidence', 'they still count as waiting on the documents');
  });
});

describe('the menu’s words are held in one place', () => {
  const read = (file: string) => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');

  it('gives the chat the same parts of a function’s page the page draws', () => {
    const page = read('pages/projects/departments/WorkstreamPage.tsx');
    const drawn = new Set([...page.matchAll(/id: '([a-z]+)',\s*name: '/g)].map((m) => m[1]!));
    const sectioned = WORKSTREAMS.filter((w) => functionSections(w.key).length > 0);
    assert.deepEqual(sectioned.map((w) => w.key).sort(), ['construction.progress', 'legal.approvals', 'legal.title'], 'the built functions laid out as one page with a rail');
    for (const w of sectioned) for (const section of functionSections(w.key)) assert.ok(drawn.has(section), `${w.key} lands on “${section}”, which the page does not draw`);
    for (const section of drawn) assert.ok(sectioned.some((w) => functionSections(w.key).includes(section)), `the page draws “${section}”, which the chat cannot land on`);
    // A function whose page is not laid out in parts has none: Valuation, the site record, the technical due diligence, and anything not built.
    for (const key of ['finance.valuation', 'construction.site', 'construction.quality', 'finance.budget', 'design']) assert.deepEqual(functionSections(key), [], key);
  });

  it('names the shared places by the words on their tabs', () => {
    const rail = read('pages/projects/cockpit/rail.tsx');
    for (const [pane, word] of SHARED_PLACE_WORDS) {
      assert.ok(rail.includes(`label: '${word}'`), `the chat calls ${pane} “${word}”, and the menu has no tab by that name`);
    }
  });

  it('covers every function of the menu', () => {
    const p = seedDemoProject();
    for (const menu of MENU_DEPARTMENTS) {
      for (const fn of menuFunctions(menu)) {
        const at = placeOfRecord(p, `${p.id}::ws::${fn.key}`);
        assert.equal(at?.fn, functionKey(fn.key), fn.label);
      }
    }
  });
});
