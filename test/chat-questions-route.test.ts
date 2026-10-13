/**
 * The chat with no model, over real HTTP, asked what a project manager asks.
 *
 * A rehearsal on a project under construction asked three things of a server
 * with no model set up: what a consultant still owes, what changed in cost
 * since last month, and which milestones are behind. It was told to start a
 * due diligence, that memory held nothing by that name, and that none was
 * late while the board flagged one. Each is now answered as a card of fields
 * from the function the screen reads, saved with the turn. A question no
 * rule answers is said to be one in a single line, with nothing above it
 * saying so again, nothing proposed and no page opened.
 *
 * Booted with no graph database and no model, and no address but its own can
 * be reached. Every name and figure is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  CHAT_NOT_ANSWERED,
  CHAT_QUESTION,
  addChecklistItems,
  addMilestones,
  addWorkPackages,
  costReportOf,
  createProject,
  issueCostReport,
  raiseChecklistRequests,
  scheduleWatch,
  startCostReport,
  updateCostReportRow,
  type CockpitPathExtra,
  type DdProject,
  type ProjectChatTurn,
} from '@realytica/shared';

const LEAD = 'lead@builders.example';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

interface Said {
  turn: ProjectChatTurn;
  navigations: Array<{ target: string } & CockpitPathExtra>;
  proposals: unknown[];
}

async function say(project: DdProject, question: string): Promise<Said> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  assert.equal(res.status, 200, question);
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; error?: string });
  const result = lines.find((line) => line.type === 'result') as unknown as { assistantTurn: ProjectChatTurn; navigations: Said['navigations']; proposals: unknown[] } | undefined;
  assert.ok(result, `${question}: ${lines.find((line) => line.type === 'error')?.error ?? 'no result'}`);
  return { turn: result.assistantTurn, navigations: result.navigations, proposals: result.proposals };
}

/** A project under construction: a list with a consultant asked for one paper, two Cost Reports issued, and one activity past its date. */
async function site(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Canal Road flats', type: 'residential', location: 'Canal Road', city: 'Kadamba', currentStage: 'construction' }, `RYT-${Math.random().toString(36).slice(2, 8)}`, LEAD);
  addChecklistItems(p, 'construction', [{ title: 'Plumbing shaft drawings', owedBy: 'MEP consultant' }, { title: 'Electrical load schedule', owedBy: 'MEP consultant' }], LEAD);
  raiseChecklistRequests(p, { department: 'construction', itemIds: [p.checklist![0]!.id], dueAt: '2026-01-05' }, LEAD);
  addWorkPackages(p, [{ code: 'A', name: 'Civil works', budget: 1_00_00_000 }], LEAD);
  const first = startCostReport(p, { month: '2026-08-01' }, LEAD);
  updateCostReportRow(p, first.id, first.rows[0]!.id, { anticipatedCost: 1_00_00_000 }, LEAD);
  issueCostReport(p, first.id, LEAD);
  const second = startCostReport(p, { month: '2026-09-01' }, LEAD);
  updateCostReportRow(p, second.id, costReportOf(p, second.id).rows[0]!.id, { anticipatedCost: 1_12_00_000 }, LEAD);
  issueCostReport(p, second.id, LEAD);
  addMilestones(p, [{ name: 'Plinth', weight: 10, plannedFinish: '2026-01-10' }], LEAD);
  store.data.projects!.push(p);
  await store.save();
  await realFetch(`${base}/api/projects/${p.id}`);
  return p;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-chat-questions-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.REALYTICA_RATE_LIMIT_MODEL = '500';
  globalThis.fetch = (async () => {
    throw new Error('this test has no network');
  }) as typeof fetch;
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  globalThis.fetch = realFetch;
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_DATA_DIR', 'REALYTICA_RATE_LIMIT_MODEL']) delete process.env[name];
});

describe('with no model set up', () => {
  it('answers the three questions of the rehearsal as cards, and none as a jump to due diligence', async () => {
    const p = await site();
    for (const [question, first] of [
      ['What is pending from the MEP consultant?', 'MEP consultant · owed'],
      ['What changed in cost since last month?', 'Forecast then · August 2026'],
      ['Which milestones are behind?', 'Plinth · Late'],
    ] as const) {
      const said = await say(p, question);
      assert.equal(said.turn.card?.rows[0]?.label, first, question);
      assert.deepEqual((said.turn.toolCalls ?? []).map((call) => call.name), [CHAT_QUESTION], question);
      assert.equal(said.turn.unanswered, undefined, `${question}: it was answered, and is not said to have gone unanswered`);
      assert.deepEqual([said.navigations.length, said.proposals.length], [0, 0], `${question}: nothing opens and nothing is proposed`);
      assert.doesNotMatch(said.turn.text, /Start the |\bDD\b|memory goes by|could not find that/, question);
    }
    // The cost question is the Cost Report's: memory, which reads "what changed", does not answer in its place.
    const cost = await say(p, 'What changed in cost since last month?');
    assert.equal(cost.turn.card!.rows.find((row) => row.label === 'Change in the forecast')!.value, '+₹12 lakh');
    // And what the chat says of the schedule is what the board flags.
    const flagged = scheduleWatch(p, new Date()).milestones.filter((milestone) => milestone.level);
    const late = await say(p, 'Which milestones are behind?');
    assert.equal(late.turn.card!.rows.filter((row) => row.label.endsWith(' · Late')).length, flagged.length);
    assert.equal(flagged.length, 1);
    // The card is kept with the turn.
    const kept = (await (await realFetch(`${base}/api/projects/${p.id}`)).json()) as { project?: DdProject } & DdProject;
    const thread = (kept.project ?? kept).conversation;
    assert.ok(thread.at(-1)?.card?.rows.length, 'the saved turn carries its card');
  });

  it('opens the owner pack for the month named, and offers no change of owner', async () => {
    const p = await site();
    const owner = p.owner;
    const said = await say(p, 'Open the owner pack for September 2026');
    assert.deepEqual(said.navigations, [{ target: 'reports', item: 'month:2026-09' }]);
    assert.deepEqual([said.proposals.length, p.chatProposals.length, p.owner], [0, 0, owner]);
  });

  it('says in one line that it cannot answer, once, with the nearest things to open', async () => {
    const p = await site();
    const said = await say(p, 'What did the structural consultant say about the retaining wall?');
    assert.deepEqual((said.turn.toolCalls ?? []).map((call) => call.name), [CHAT_NOT_ANSWERED]);
    assert.equal(said.turn.text.split('\n')[0], 'I cannot answer that from what this project holds.');
    assert.equal(said.turn.unanswered, undefined, 'the reply says it itself: no second line above it says so again');
    assert.equal(said.turn.card!.look.length, 3);
    assert.deepEqual([said.navigations.length, said.proposals.length, p.chatProposals.length], [0, 0, 0]);
  });
});
