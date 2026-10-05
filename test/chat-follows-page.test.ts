/**
 * The chat knows which page it is on.
 *
 * Every question now arrives with the page it was asked from: the department,
 * the function and the stage being looked at. "What's missing", "summarise"
 * and "which findings are critical" are then about that page, and say so,
 * because the thread stays when the page changes and an answer has to say
 * what it was about. The same question of the whole project is one press
 * away.
 *
 * The second half asks it over real HTTP: that the request carries the place,
 * that the answer is scoped by it, that the turns keep it, and that a client
 * which sends only the pane it was on is answered as it always was.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  addFinding,
  addMilestones,
  applyProjectChat,
  askedOn,
  chatPlaceFrom,
  chatPlaceLine,
  chatSessions,
  projectRegisterBriefing,
  samePage,
  seedDemoProject,
  setProjectDepartments,
  stageOf,
  type ChatPlace,
  type DdProject,
  type ProjectChatTurn,
} from '@realytica/shared';

const onTitle = (p: DdProject): ChatPlace => ({ pane: 'workstream', department: 'legal', fn: 'legal.title', stage: stageOf(p.currentStage) });
const onLegal = (p: DdProject): ChatPlace => ({ pane: 'department', department: 'legal', stage: stageOf(p.currentStage) });

describe('an answer about the page a person is on', () => {
  it('says what a function is missing, and offers the same of the whole project', () => {
    const p = seedDemoProject();
    const here = applyProjectChat(p, "What's missing?", { place: onTitle(p) });
    assert.match(here.assistantTurn.text, /^On Title: /);
    assert.deepEqual(here.assistantTurn.toolCalls?.map((t) => t.name), ['answer_from_file']);
    assert.equal(here.navigations.length, 0, 'the page a person asked about stays on screen');
    const whole = here.assistantTurn.choices?.find((c) => c.label === 'Whole project');
    assert.ok(whole, 'the same question, of the whole project, is offered');
    const all = applyProjectChat(p, whole.send, { place: onTitle(p) });
    assert.doesNotMatch(all.assistantTurn.text, /^On Title/, 'asked of the whole project, it is answered of the whole project');
    assert.match(all.assistantTurn.text, /priority items missing|outstanding/);
  });

  it('answers the same question of the whole project from a page that belongs to none', () => {
    const p = seedDemoProject();
    for (const place of [{ pane: 'overview' as const }, { pane: 'evidence' as const }, undefined]) {
      const out = applyProjectChat(p, "What's missing?", { place });
      assert.doesNotMatch(out.assistantTurn.text, /^On /, JSON.stringify(place));
    }
    assert.equal(applyProjectChat(seedDemoProject(), "What's missing?").assistantTurn.text, applyProjectChat(seedDemoProject(), "What's missing?", { place: { pane: 'overview' } }).assistantTurn.text);
  });

  it('summarises the function, and the file when the file is named', () => {
    const p = seedDemoProject();
    const page = applyProjectChat(p, 'Summarise', { place: onTitle(p) });
    assert.match(page.assistantTurn.text, /^On Title: /);
    assert.match(page.assistantTurn.text, /checks answered/);
    for (const said of ['Summarise this file', 'Summarise the whole project', 'Summarise the project']) {
      assert.doesNotMatch(applyProjectChat(p, said, { place: onTitle(p) }).assistantTurn.text, /^On Title/, said);
    }
  });

  it('lists the findings that are the function’s, and says how many are elsewhere', () => {
    const p = seedDemoProject();
    const check = p.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === 'legal.title_chain')!;
    const mine = addFinding(p, { title: 'Gap in the chain between 1987 and 1998', description: 'A link is missing.', severity: 'critical', discipline: 'legal', sourceCheckId: check.id } as never);
    const elsewhere = addFinding(p, { title: 'Fire tender access is blocked', description: 'Seen on site.', severity: 'critical', discipline: 'hse' } as never);
    const here = applyProjectChat(p, 'Which findings are critical?', { place: onTitle(p) });
    assert.match(here.assistantTurn.text, /^On Title: /);
    assert.ok(here.assistantTurn.text.includes(mine.title), here.assistantTurn.text);
    assert.ok(!here.assistantTurn.text.includes(elsewhere.title), 'a finding of another function is not Title’s');
    const all = applyProjectChat(p, here.assistantTurn.choices![0]!.send, { place: onTitle(p) });
    assert.ok(all.assistantTurn.text.includes(elsewhere.title) || /and \d+ more/.test(all.assistantTurn.text), all.assistantTurn.text);
    // A page with none says so, and that there are some elsewhere.
    const none = applyProjectChat(p, 'Which findings are critical?', { place: { pane: 'workstream', department: 'construction', fn: 'construction.progress', stage: stageOf(p.currentStage) } });
    assert.match(none.assistantTurn.text, /^On Progress: no open critical findings\. \d+ elsewhere on the project\.$/);
  });

  it('answers for a department from its Summary', () => {
    const p = seedDemoProject();
    const out = applyProjectChat(p, 'Summarise this department', { place: onLegal(p) });
    assert.match(out.assistantTurn.text, /^On Legal: Title — /);
    assert.match(out.assistantTurn.text, /Approvals — /);
    assert.match(applyProjectChat(p, "What's missing here?", { place: onLegal(p) }).assistantTurn.text, /^On Legal: /);
  });

  it('keeps every answer to four lines', () => {
    const p = seedDemoProject();
    for (const place of [onTitle(p), onLegal(p)]) {
      for (const said of ["What's missing here?", 'Summarise this page', 'Which findings are critical here?']) {
        const lines = applyProjectChat(p, said, { place }).assistantTurn.text.split('\n');
        assert.ok(lines.length <= 4, `${said}: ${lines.length} lines`);
      }
    }
  });

  it('answers what the register of approvals and the milestones say, from anywhere', () => {
    const p = seedDemoProject();
    const approvals = applyProjectChat(p, 'Which approvals are missing or lapsed?');
    assert.match(approvals.assistantTurn.text, /^\d+ of \d+ approvals? in force\./);
    assert.deepEqual([approvals.navigations.at(-1)?.workstream, approvals.navigations.at(-1)?.section], ['legal.approvals', 'approvals'], 'it opens the register it read');
    const progress = applyProjectChat(p, 'How far along is the work?');
    assert.match(progress.assistantTurn.text, /milestones/i);
    assert.equal(progress.navigations.at(-1)?.workstream, 'construction.progress');
    // "FAR" is the floor area ratio; "how far" is not.
    assert.doesNotMatch(applyProjectChat(p, 'How far back does the title go?').assistantTurn.text, /zoning/i);
  });

  it('does not answer for a function whose department is switched off', () => {
    const p = seedDemoProject();
    setProjectDepartments(p, ['finance'], 'tester');
    const approvals = applyProjectChat(p, 'Which approvals are missing or lapsed?');
    assert.equal(approvals.assistantTurn.text, 'Approvals is switched off on this project. Departments are set on Overview.');
    const progress = applyProjectChat(p, 'How far along is the work?');
    assert.equal(progress.assistantTurn.text, 'Progress is switched off on this project. Departments are set on Overview.');
    for (const out of [approvals, progress]) assert.ok(!out.navigations.some((nav) => nav.workstream), 'and opens no page of it');
  });
});

describe('an answer to an outside collaborator', () => {
  const onValuation = (p: DdProject): ChatPlace => ({ pane: 'valuation', department: 'finance', fn: 'finance.valuation', stage: stageOf(p.currentStage) });

  it('says a page opened, and not the figure the firm reads off it', () => {
    const p = seedDemoProject();
    const firm = applyProjectChat(p, 'open Valuation');
    assert.match(firm.assistantTurn.text, /^Valuation is open — .+\.$/, 'the firm’s own people get the figure');
    for (const [said, line] of [['open Valuation', 'Valuation is open.'], ['open Title', 'Title is open.'], ['show Legal', 'Legal is open.'], ['open Approvals at Land', 'Approvals is open at Land.']] as const) {
      assert.equal(applyProjectChat(seedDemoProject(), said, { outside: true }).assistantTurn.text, line, said);
    }
  });

  it('opens an answer about a page with whose part of the file it is of, and leaves the estimate out', () => {
    const p = seedDemoProject();
    const firm = applyProjectChat(p, 'Summarise this page', { place: onValuation(p) }).assistantTurn.text;
    const estimate = /^On Valuation: (.+)\.$/m.exec(firm)![1]!;
    const given = applyProjectChat(seedDemoProject(), 'Summarise this page', { place: onValuation(p), outside: true }).assistantTurn.text;
    assert.match(given, /^Of what you have been given, on Valuation: /);
    assert.ok(!given.includes(estimate), `the estimate is not said: ${given}`);

    for (const [said, opens] of [
      ["What's missing here?", /^Of what you have been given, on Title: /],
      ['Which findings are critical here?', /^Of what you have been given, on Title: /],
      ['Summarise this page', /^Of what you have been given, on Title: \d+ of \d+ checks answered/],
    ] as const) {
      assert.match(applyProjectChat(seedDemoProject(), said, { place: onTitle(p), outside: true }).assistantTurn.text, opens, said);
    }
  });

  it('says the same of the approvals and the milestones, which are counted from the papers they hold', () => {
    const approvals = applyProjectChat(seedDemoProject(), 'Which approvals are missing or lapsed?', { outside: true }).assistantTurn.text;
    assert.match(approvals, /^Of what you have been given: \d+ of \d+ approvals? in force\./);
    const p = seedDemoProject();
    addMilestones(p, [{ name: 'Plinth', weight: 5 }], 'tester');
    assert.match(applyProjectChat(p, 'How far along is the work?', { outside: true }).assistantTurn.text, /^Of what you have been given: \d+% complete/);
  });
});

describe('the place a question came from', () => {
  it('is read from what the request sent, and only as a page that exists', () => {
    assert.deepEqual(chatPlaceFrom({ pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' }), { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' });
    // The function says its department, whatever was sent beside it.
    assert.deepEqual(chatPlaceFrom({ pane: 'workstream', department: 'finance', fn: 'legal.title' }), { pane: 'workstream', department: 'legal', fn: 'legal.title' });
    // Words the menu does not know are left out, one by one.
    assert.deepEqual(chatPlaceFrom({ pane: 'nowhere', department: 'marketing', fn: 'legal.gone', stage: 'someday' }), undefined);
    assert.deepEqual(chatPlaceFrom({ pane: 'findings', stage: 'someday' }), { pane: 'findings' });
    // A client that sends only the pane it was on is on that pane.
    assert.deepEqual(chatPlaceFrom(undefined, 'evidence'), { pane: 'evidence' });
    assert.equal(chatPlaceFrom(undefined, 'not a pane'), undefined);
    assert.equal(chatPlaceFrom(undefined, undefined), undefined);
  });

  it('is said to a model in the menu’s words, with the stage when it is not the project’s own', () => {
    const p = seedDemoProject();
    assert.equal(chatPlaceLine(p, onTitle(p)), 'Legal › Title (function)');
    assert.equal(chatPlaceLine(p, { ...onTitle(p), stage: 'pre_development' }), 'Legal › Title (function), looked at in the Land stage (the project is at Under construction)');
    assert.equal(chatPlaceLine(p, onLegal(p)), 'Legal (department summary)');
    assert.match(projectRegisterBriefing(p, 'workstream', onTitle(p)), /Reader is looking at: Legal › Title \(function\)\./);
    assert.match(projectRegisterBriefing(p, 'evidence'), /Reader is looking at: evidence\./, 'a client that sends only the pane is described by it, as before');
  });

  it('is what the thread says over a question asked on another page', () => {
    const title = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'construction' };
    const approvals = { pane: 'workstream', department: 'legal', fn: 'legal.approvals', stage: 'construction' };
    assert.equal(askedOn(title, approvals), 'Asked on Title');
    assert.equal(askedOn(title, title), undefined, 'asked here, it says nothing');
    assert.equal(askedOn(title, { ...title, stage: 'pre_development' }), undefined, 'a page is the same page at another stage');
    assert.equal(askedOn({ ...title, stage: 'pre_development' }, approvals), 'Asked on Title · Land');
    assert.equal(askedOn({ pane: 'evidence' }, title), 'Asked on Documents');
    assert.equal(askedOn({ pane: 'department', department: 'legal' }, title), 'Asked on Legal');
    assert.equal(askedOn(undefined, title), undefined, 'a turn from before the chat knew says nothing');
    assert.equal(samePage({ pane: 'dd' }, { pane: 'scope' }), true, 'a check open in the register is still the register');
  });
});

describe('the chat route', () => {
  let server: Server;
  let base: string;
  let dataDir: string;

  type Result = { assistantTurn: ProjectChatTurn; userTurn: ProjectChatTurn; navigations: Array<Record<string, string>>; project: DdProject };

  async function chat(projectId: string, body: Record<string, unknown>): Promise<Result> {
    const res = await fetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const result = lines.find((l) => l.type === 'result');
    assert.ok(result, `the chat returned a result: ${JSON.stringify(lines).slice(0, 300)}`);
    return result as unknown as Result;
  }

  async function seeded(): Promise<DdProject> {
    const { store } = await import('../apps/api/src/store');
    const p = seedDemoProject();
    store.data.projects!.push(p);
    return p;
  }

  before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-chat-place-'));
    process.env.REALYTICA_DATA_DIR = dataDir;
    process.env.REALYTICA_AUTH_MODE = 'off';
    const { app, initApp } = await import('../apps/api/src/app');
    await initApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('carries the place, scopes the answer by it, and keeps it on both turns', async () => {
    const p = await seeded();
    const place = { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'pre_development' };
    const out = await chat(p.id, { question: "What's missing?", viewContext: 'workstream', place, sessionId: 'ses_a' });
    assert.match(out.assistantTurn.text, /^On Title: /);
    assert.deepEqual(out.userTurn.place, place);
    assert.deepEqual(out.assistantTurn.place, place);
    const stored = out.project.conversation.slice(-2);
    assert.deepEqual(stored.map((t) => [t.sessionId, t.place?.fn, t.place?.stage]), [['ses_a', 'legal.title', 'pre_development'], ['ses_a', 'legal.title', 'pre_development']]);
    assert.deepEqual(chatSessions(out.project.conversation).find((s) => s.id === 'ses_a')?.place, place, 'the chat keeps the page it began on');
  });

  it('answers a client that sends only the pane as it always did', async () => {
    const p = await seeded();
    const out = await chat(p.id, { question: "What's missing?", viewContext: 'evidence' });
    assert.doesNotMatch(out.assistantTurn.text, /^On /);
    assert.deepEqual(out.userTurn.place, { pane: 'evidence' });
    const none = await chat(p.id, { question: "What's missing?" });
    assert.equal(none.userTurn.place, undefined, 'a request that says no place keeps none');
    assert.equal(none.userTurn.sessionId, undefined);
  });

  it('takes no word it does not know on trust', async () => {
    const p = await seeded();
    const out = await chat(p.id, { question: "What's missing?", place: { pane: 'nowhere', department: 'marketing', fn: 'legal.gone', stage: 'someday' } });
    assert.doesNotMatch(out.assistantTurn.text, /^On /);
    assert.equal(out.userTurn.place, undefined);
  });

  it('goes where a person types, with the stage in the navigation', async () => {
    const p = await seeded();
    const out = await chat(p.id, { question: 'open Approvals at Pre-construction', place: { pane: 'overview', stage: 'construction' } });
    assert.deepEqual(out.navigations.at(-1), { target: 'workstream', workstream: 'legal.approvals', stage: 'design_tender' });
    const stage = await chat(p.id, { question: 'show the Land stage', place: { pane: 'workstream', department: 'legal', fn: 'legal.title', stage: 'construction' } });
    assert.deepEqual(stage.navigations.at(-1), { target: 'workstream', workstream: 'legal.title', stage: 'pre_development' });
    assert.equal(stage.project.currentStage, p.currentStage, 'looking at a stage leaves the project where it is');
  });

  it('carries on an earlier chat only when it is one the person has', async () => {
    const p = await seeded();
    await chat(p.id, { question: 'open findings', sessionId: 'ses_first' });
    const carried = await chat(p.id, { question: 'open risks', sessionId: 'ses_second', continues: 'ses_first' });
    assert.equal(carried.userTurn.continues, 'ses_first');
    const sessions = chatSessions(carried.project.conversation);
    const first = sessions.find((s) => s.id === 'ses_first')!;
    assert.deepEqual(first.turns.filter((t) => t.role === 'user').map((t) => t.text), ['open findings', 'open risks'], 'the two sittings read as one chat');
    assert.equal(sessions.some((s) => s.id === 'ses_second'), false);
    const stranger = await chat(p.id, { question: 'open reports', sessionId: 'ses_third', continues: 'ses_nobody_has' });
    assert.equal(stranger.userTurn.continues, undefined, 'a chat that is not there is not carried on');
  });

  it('names a chat, and hands it back to its first question', async () => {
    const p = await seeded();
    await chat(p.id, { question: 'open findings', sessionId: 'ses_named' });
    const rename = async (id: string, name: unknown) =>
      fetch(`${base}/api/projects/${p.id}/chat/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const named = await rename('ses_named', '  Findings   review ');
    assert.equal(named.status, 200);
    const project = ((await named.json()) as { project: DdProject }).project;
    const session = chatSessions(project.conversation).find((s) => s.id === 'ses_named')!;
    assert.deepEqual([session.name, session.title], ['Findings review', 'open findings']);
    assert.equal(project.conversation.filter((t) => t.sessionName).length, 1, 'kept once, on the chat’s first turn');
    const cleared = ((await (await rename('ses_named', '')).json()) as { project: DdProject }).project;
    assert.equal(chatSessions(cleared.conversation).find((s) => s.id === 'ses_named')!.name, undefined);
    assert.equal((await rename('ses_nobody_has', 'x')).status, 404);
    assert.equal((await rename('ses_named', 42)).status, 400);
  });
});
