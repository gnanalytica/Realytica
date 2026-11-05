/**
 * What a run of the chat against a real model got wrong, each fixed where it
 * lives and held here on the rules path or a fake model
 * (docs/product.md, "One chat, and what it may do").
 *
 * - "How much over budget is civil now?" is the Cost Report's forecast
 *   against budget for the package named, never a valuation.
 * - A milestone's reading stated in the chat waits on the milestone's row of
 *   Progress, of today unless a day is said, in the person's words; so does
 *   one the model points at with `propose_said`.
 * - A defect stated with its severity waits as a suggested finding, in the
 *   person's words, on both paths.
 * - The page is sent as menu keys; the words on the menu are no place.
 * - A month's owner pack asks for the readings of milestones nothing was
 *   ever reported of.
 * - The status report counts a Cost Report issued and the progress board.
 * - A fact the model suggests is named, with where it waits.
 *
 * Every name is invented.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  addChecklistItems,
  addMilestones,
  addWorkPackages,
  applyProjectAgentTurn,
  applyProjectChat,
  chatPlaceFrom,
  costReportOf,
  createChatProposal,
  createProject,
  issueCostReport,
  milestoneReadingsWaiting,
  setMilestonePercent,
  setTeamMember,
  startCostReport,
  statusReport,
  updateCostReportRow,
  wantsDeterministicProjectChat,
  type ChatInHand,
  type ChatPlace,
  type DdProject,
  type ProjectChatResult,
} from '@realytica/shared';
import { createProjectTools } from '@realytica/agents';

const LEAD = 'lead@builders.example';
const NOW = new Date('2026-11-05T06:00:00.000Z');
const TODAY = '2026-11-05';
const PROGRESS: ChatPlace = { pane: 'workstream', department: 'construction', fn: 'construction.progress' };

/** A project being built: two packages, two Cost Reports issued, two milestones nothing was ever reported of. */
function site(): DdProject {
  const p = createProject({ name: 'Canal Road flats', type: 'residential', location: 'Canal Road', city: 'Kadamba', currentStage: 'construction' }, 'RYT-RMF', LEAD);
  setTeamMember(p, { email: LEAD, departments: { construction: 'lead', finance: 'lead', legal: 'lead' } }, 'owner');
  addChecklistItems(p, 'construction', [{ title: 'Plumbing shaft drawings', owedBy: 'MEP consultant' }], LEAD);
  addWorkPackages(p, [{ code: 'A', name: 'Civil works', budget: 1_00_00_000 }, { code: 'B', name: 'MEP', budget: 40_00_000 }], LEAD);
  const first = startCostReport(p, { month: '2026-09-01' }, LEAD);
  updateCostReportRow(p, first.id, first.rows[0]!.id, { anticipatedCost: 1_00_00_000 }, LEAD);
  issueCostReport(p, first.id, LEAD);
  const second = startCostReport(p, { month: '2026-10-01' }, LEAD);
  updateCostReportRow(p, second.id, costReportOf(p, second.id).rows[0]!.id, { anticipatedCost: 1_12_00_000 }, LEAD);
  issueCostReport(p, second.id, LEAD);
  addMilestones(p, [{ name: 'Plinth', weight: 10, plannedFinish: '2026-09-10' }, { name: 'Tower A slab 7', weight: 20, plannedFinish: '2026-12-15' }], LEAD);
  return p;
}

function sayIn(p: DdProject, words: string, place?: ChatPlace, sitting?: never): ProjectChatResult {
  const out = applyProjectChat(p, words, { actor: LEAD, now: NOW, place, sitting, chat: { sessionId: 'sit_rmf', actor: LEAD } });
  for (const turn of [out.userTurn, out.assistantTurn]) turn.sessionId = 'sit_rmf';
  return out;
}

const message = (words: string, turnId = 'cht_rmf'): ChatInHand => ({ tag: { turnId, sessionId: 'sit_rmf' }, by: LEAD, message: words, at: NOW.toISOString() });

describe('a question of how far over budget', () => {
  it('is the Cost Report’s forecast against budget for the package it names, in every way it is asked', () => {
    const p = site();
    const civil = sayIn(p, 'How much over budget is civil now?');
    assert.deepEqual(civil.assistantTurn.toolCalls?.map((call) => call.name), ['chat_question']);
    assert.deepEqual(civil.assistantTurn.card?.rows.map((row) => [row.label, row.value]), [['Over budget · A · Civil works · October 2026', '+₹12 lakh (forecast ₹1.12 Cr against a budget of ₹1 Cr)']]);
    assert.doesNotMatch(civil.assistantTurn.text, /indicative value|property screen/);
    assert.equal(wantsDeterministicProjectChat(p, 'How much over budget is civil now?'), true);
    assert.equal(sayIn(p, 'civil overrun').assistantTurn.card?.rows[0]?.label, 'Over budget · A · Civil works · October 2026');
    assert.equal(sayIn(p, "what's the overspend on MEP").assistantTurn.card?.rows[0]?.value, 'On budget (forecast ₹40 lakh against a budget of ₹40 lakh)');
    // Named no package: the whole report, and the packages over it.
    assert.deepEqual(sayIn(p, 'are we over budget').assistantTurn.card?.rows.map((row) => row.label), ['Over budget · all packages · October 2026', 'Over budget · A · Civil works · October 2026']);
    // An instruction that says the words is still the instruction.
    assert.deepEqual(sayIn(p, 'Add a risk: civil overrun').assistantTurn.suggested?.map((line) => line.words), ['Suggested a risk on Risks and actions']);
  });
});

describe('a milestone’s reading stated in the chat', () => {
  it('waits on the milestone’s row of Progress, of today, in the person’s words, under the message and its chat', () => {
    const p = site();
    const slab = p.milestones!.find((m) => m.name === 'Tower A slab 7')!;
    assert.equal(wantsDeterministicProjectChat(p, 'Tower A slab 7 is about 60% done', { place: PROGRESS }), true);
    const out = sayIn(p, 'Tower A slab 7 is about 60% done', PROGRESS);
    assert.equal(out.assistantTurn.text, 'Suggested 60% on Progress — Tower A slab 7, as at 5 Nov 2026. It waits on the milestone’s row of Engineering › Progress until it is accepted there.');
    assert.equal(slab.percent, 0, 'nothing is on the milestone until it is accepted');
    const [waiting] = milestoneReadingsWaiting(p, slab.id);
    assert.deepEqual([waiting?.percent, waiting?.on, waiting?.card.said?.quote, waiting?.card.chat], [60, TODAY, 'Tower A slab 7 is about 60% done', { turnId: out.userTurn.id, sessionId: 'sit_rmf' }]);
    assert.deepEqual(out.assistantTurn.suggested?.map((line) => line.words), ['Suggested a value on Engineering › Progress']);
    const opened = out.navigations.at(-1) as Record<string, unknown> | undefined;
    assert.deepEqual([opened?.target, opened?.workstream, opened?.section, opened?.item], ['workstream', 'construction.progress', 'progress', slab.id]);
  });

  it('is of the day the words say, done is 100%, and a question, a plan or a denial is none', () => {
    const p = site();
    const plinth = p.milestones!.find((m) => m.name === 'Plinth')!;
    sayIn(p, 'Plinth was finished on 3 Nov 2026');
    assert.deepEqual(milestoneReadingsWaiting(p, plinth.id).map((one) => [one.percent, one.on]), [[100, '2026-11-03']]);
    for (const words of ['Is Tower A slab 7 60% done?', 'Tower A slab 7 should be 60% done by December', 'Tower A slab 7 is not done', 'Tower A slab 7 was 60% done on 3 Dec 2026']) {
      assert.equal(sayIn(p, words).proposals.length, 0, words);
    }
  });

  it('through the copilot’s tool, is read off the words the model quotes, which must be the person’s', async () => {
    const p = site();
    const slab = p.milestones!.find((m) => m.name === 'Tower A slab 7')!;
    const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] } as { proposals: Array<{ id: string; title: string; payload: Record<string, unknown>; said?: { quote: string }; chat?: unknown }> };
    const tools = createProjectTools(p, 'copilot', bag as never, { said: message('Quick update: Tower A slab 7 is about 60% done') }) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const run = async (args: unknown) => JSON.parse(await tools.find((tool) => tool.name === 'propose_said')!.run(args as never, undefined as never));
    assert.match((await run({ kind: 'milestone_reading', quote: 'Tower A slab 7 is 70% done' })).error, /not in what the person said/);
    assert.ok((await run({ kind: 'milestone_reading', quote: 'Quick update' })).error, 'words that state no reading are refused');
    assert.equal((await run({ kind: 'milestone_reading', quote: 'Tower A slab 7 is about 60% done' })).queued, true);
    const [card] = bag.proposals;
    assert.deepEqual([card?.payload.register, card?.payload.recordId, card?.payload.percent, card?.said?.quote, card?.chat], ['milestone', slab.id, 60, 'Tower A slab 7 is about 60% done', { turnId: 'cht_rmf', sessionId: 'sit_rmf' }]);
  });
});

describe('a defect stated with its severity', () => {
  it('waits as a suggested finding at that severity, in the person’s words', () => {
    const p = site();
    const words = 'The plinth inspection found honeycombing in column C4, treat it as critical';
    assert.equal(wantsDeterministicProjectChat(p, words), true);
    const out = sayIn(p, words);
    const card = out.proposals[0]!;
    assert.deepEqual([card.kind, card.title, card.payload.severity, card.said?.quote, card.chat?.turnId], ['add_finding', 'Log finding: Honeycombing in column C4', 'critical', words, out.userTurn.id]);
    assert.deepEqual(out.assistantTurn.suggested?.map((line) => line.words), ['Suggested a finding on Findings']);
    assert.equal(p.findings.length, 0, 'nothing is on the register until it is accepted');
    assert.equal(sayIn(p, 'There is a crack in the lift core wall, high severity').proposals[0]?.payload.severity, 'high');
    // Nothing found with no severity said, and a question, is no finding.
    for (const plain of ['We found the khata extract', 'Did the inspection find honeycombing in column C4, is it critical?']) assert.equal(sayIn(p, plain).proposals.filter((one) => one.kind === 'add_finding').length, 0, plain);
  });

  it('through the copilot’s tool, is the person’s words, and their severity', async () => {
    const p = site();
    const words = 'The plinth inspection found honeycombing in column C4, treat it as critical';
    const bag = { proposals: [], navigations: [], toolCalls: [], choices: [] } as { proposals: Array<{ kind: string; payload: Record<string, unknown>; said?: { quote: string } }> };
    const tools = createProjectTools(p, 'copilot', bag as never, { said: message(words) }) as unknown as Array<{ name: string; run: (args: never, ctx: never) => Promise<string> }>;
    const run = async (args: unknown) => JSON.parse(await tools.find((tool) => tool.name === 'propose_said')!.run(args as never, undefined as never));
    assert.match((await run({ kind: 'finding', quote: 'found honeycombing in column C4' })).error, /no defect with its severity/);
    assert.equal((await run({ kind: 'finding', quote: words })).queued, true);
    assert.deepEqual(bag.proposals.map((card) => [card.kind, card.payload.title, card.payload.severity, card.said?.quote]), [['add_finding', 'Honeycombing in column C4', 'critical', words]]);
  });
});

describe('the page a question is asked from', () => {
  it('is the menu’s keys, as the web sends them: the words on the menu are no place', () => {
    assert.equal(chatPlaceFrom({ department: 'Legal', fn: 'Title' }), undefined);
    assert.deepEqual(chatPlaceFrom({ pane: 'workstream', department: 'legal', fn: 'legal.title' }), { pane: 'workstream', department: 'legal', fn: 'legal.title' });
    const p = site();
    const asked = sayIn(p, "what's missing here", { pane: 'workstream', department: 'legal', fn: 'legal.title' });
    assert.equal(asked.assistantTurn.asking?.at, 0, asked.assistantTurn.text);
  });
});

describe('a month’s owner pack with milestones nothing was ever reported of', () => {
  it('says which have no reading for it, offers to ask, and asks for the first', () => {
    const p = site();
    const reports: ChatPlace = { pane: 'reports' };
    const pack = sayIn(p, 'Open the owner pack for October 2026', reports);
    assert.match(pack.assistantTurn.text, /2 milestones have no reading for that month: Plinth and Tower A slab 7\. I can ask you for them, one at a time\./);
    const offer = pack.assistantTurn.choices?.find((choice) => choice.label === 'Ask me for the readings');
    assert.deepEqual(offer?.sitting?.ask, { act: 'start', month: '2026-10' });
    const first = sayIn(p, offer!.send, reports, offer!.sitting as never);
    assert.match(first.assistantTurn.text, /Engineering › Progress — Plinth: how far along at 31 Oct 2026\?/);
  });

  it('asks nothing of one reported since, one planned to start after the month, or one not yet due on a board that is reported', () => {
    const p = site();
    const [plinth, slab] = p.milestones!;
    setMilestonePercent(p, plinth!.id, 40, LEAD, '2026-10-20T06:00:00.000Z');
    slab!.plannedStart = '2026-11-15';
    assert.doesNotMatch(sayIn(p, 'Open the owner pack for October 2026', { pane: 'reports' }).assistantTurn.text, /no reading for that month/);
    const [later] = addMilestones(p, [{ name: 'Finishes', weight: 10, plannedFinish: '2027-03-01' }], LEAD);
    assert.doesNotMatch(sayIn(p, 'Open the owner pack for October 2026', { pane: 'reports' }).assistantTurn.text, new RegExp(later!.name));
  });
});

describe('the status report for the week', () => {
  it('counts a Cost Report issued and what was put on the progress board', () => {
    const p = site();
    const report = statusReport(p, { from: '2026-11-02T00:00:00.000Z', to: new Date(Date.now() + 60_000).toISOString() });
    const lines = report.changed.map((line) => line.what);
    assert.ok(lines.includes('Cost Report issued: September 2026.') && lines.includes('Cost Report issued: October 2026.'), lines.join(' | '));
    assert.ok(lines.includes('Put on the progress board: Plinth, Tower A slab 7.'), lines.join(' | '));
    assert.match(sayIn(p, "Write this week's status for the owner").assistantTurn.text, /Changed: 2 reports issued, 1 change on the progress board\./);
  });
});

describe('a fact the model suggests', () => {
  it('is named, with its value and where it waits, and the line under the reply names it too', () => {
    const p = site();
    const card = createChatProposal('patch_project', 'Update owner', 'Said in the chat.', 'Patches the project record.', { owner: 'Asha Menon' }, LEAD);
    const out = applyProjectAgentTurn(p, 'The owner is Asha Menon', { text: 'Proposed, and waiting on the page for a person to accept.', proposals: [card], navigations: [], card: { v: 1, outcome: 'not_on_record', rows: [], look: [], said: { lead: 'Proposed, and waiting on the page for a person to accept.' } } }, { turnId: 'cht_owner', sessionId: 'sit_rmf' });
    assert.equal(out.assistantTurn.text, 'Owner: Asha Menon waits beside Key facts on Overview.');
    assert.deepEqual(out.assistantTurn.suggested?.map((line) => line.words), ['Suggested the owner on Overview › Key facts']);
  });
});

// The copilot, against a fake model: told a reading, it points at the words with propose_said and the reading waits.
describe('the copilot told a reading', () => {
  const BASE = 'http://realmodel-fixes.test';
  const realFetch = globalThis.fetch;
  let runProjectChat: typeof import('../packages/agents/src/agents/project-copilot').runProjectChat;
  before(async () => {
    process.env.REALYTICA_BASE_URL = BASE;
    process.env.REALYTICA_API_KEY = 'test-key';
    process.env.REALYTICA_MODEL_JUDGMENT = 'senior/model';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(BASE)) return realFetch(input as string, init);
      const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body ?? '{}')) as { model: string; messages: Array<{ content: unknown }> };
      const results = body.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type?: string }>) : [])).filter((b) => b.type === 'tool_result').length;
      const use = (name: string, input: unknown) => [{ type: 'tool_use', id: `tu_${results}`, name, input }];
      const content = results === 0 ? use('propose_said', { kind: 'milestone_reading', quote: 'Tower A slab 7 is about 60% done' }) : results === 1 ? use('answer_with_fields', { outcome: 'not_on_record', fields: [], records: [], facts: [], passages: [] }) : [{ type: 'text', text: '' }];
      return new Response(JSON.stringify({ id: `msg_${results}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: results < 2 ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    ({ runProjectChat } = await import('../packages/agents/src/agents/project-copilot'));
  });
  after(() => {
    globalThis.fetch = realFetch;
    for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT']) delete process.env[name];
  });

  it('suggests it on the milestone’s row, in the person’s words, under the message', async () => {
    const p = site();
    const slab = p.milestones!.find((m) => m.name === 'Tower A slab 7')!;
    const said = message('Tower A slab 7 is about 60% done', 'cht_model');
    const agent = await runProjectChat({ project: p, question: said.message, said, place: PROGRESS });
    assert.deepEqual(agent.toolCalls.map((call) => call.name), ['propose_said']);
    const out = applyProjectAgentTurn(p, said.message, { ...agent, proposals: agent.proposals }, said.tag);
    const [waiting] = milestoneReadingsWaiting(p, slab.id);
    assert.deepEqual([waiting?.percent, waiting?.card.said?.quote, waiting?.card.chat?.turnId], [60, 'Tower A slab 7 is about 60% done', 'cht_model']);
    assert.deepEqual(out.assistantTurn.suggested?.map((line) => line.words), ['Suggested a value on Engineering › Progress']);
  });
});
