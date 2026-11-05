/**
 * The chat asking for what is missing, one question at a time
 * (docs/product.md, "One chat, and what it may do").
 *
 * - A question names the field as its sheet labels it, and where it is, with
 *   taps built from the field's type, and always Skip and Stop asking.
 * - "What's missing here" on a function's page walks that function's
 *   missing fields in the sheet's order. A value typed while a question is
 *   open answers it only where it reads as a value of the field's kind;
 *   anything else is a message like any other, and the question stays open.
 * - An answer waits on its field as the person's own words, under the
 *   message it was said in, until somebody who decides accepts it.
 * - A month's owner pack with milestones that have no reading for it says
 *   so, and offers to ask for the readings.
 * - An outside collaborator is asked only for fields in their reach, and is
 *   told that what they suggest is sent to the firm to accept.
 *
 * Every name is invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  acceptWaiting,
  addMilestones,
  applyProjectAgentTurn,
  applyProjectChat,
  askChoices,
  askableFields,
  askingSaid,
  chatAskingOpen,
  chatWaiting,
  createProject,
  fieldState,
  setTeamMember,
  waitingPlaceLine,
  type ChatAsking,
  type ChoicePin,
  type DdProject,
  type FieldAddress,
  type ProjectChatResult,
  type ProjectChatTurn,
  type ProjectGrant,
  milestoneReadingsWaiting,
  suggestionsOn,
} from '@realytica/shared';

const LEAD = 'lead@firm.example';
const HOLDING = 'legal.title.holding';
const TITLE_PAGE = { pane: 'workstream', department: 'legal', fn: 'legal.title' } as const;

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-ASK');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', construction: 'lead' } }, 'owner');
  return p;
}

/** Say something in a chat, or press a choice, and keep both turns under its sitting, as the chat route does. */
function sayIn(p: DdProject, words: string, sitting?: ChoicePin, place: Record<string, string> = TITLE_PAGE, outside = false): ProjectChatResult {
  const out = applyProjectChat(p, words, { actor: LEAD, chat: { sessionId: 'sit_ask', actor: LEAD }, place: place as never, sitting, outside });
  for (const turn of [out.userTurn, out.assistantTurn]) turn.sessionId = 'sit_ask';
  return out;
}

const press = (p: DdProject, out: ProjectChatResult, label: string, place?: Record<string, string>): ProjectChatResult => {
  const choice = out.assistantTurn.choices?.find((held) => held.label === label);
  assert.ok(choice, `"${label}" is offered: ${out.assistantTurn.choices?.map((held) => held.label).join(', ')}`);
  return sayIn(p, choice.send, choice.sitting, place);
};

const field = (set: string, key: string, fn: string): FieldAddress => ({ fn, set, field: key });
/** The tenure as the sheet holds it: read through a call, so an assertion that it is empty narrows nothing after it. */
const tenureOf = (p: DdProject) => p.fieldSheets?.[HOLDING]?.values.tenure;
const run = (targets: FieldAddress[]): ChatAsking => ({ run: 'ask_t', at: 0, suggested: 0, skipped: 0, targets: targets.map((address) => ({ kind: 'field', address, label: address.field, where: 'Somewhere' })) });

describe('the taps a question offers', () => {
  const p = project();
  const labels = (address: FieldAddress) => askChoices(p, run([address])).map((choice) => choice.label);

  it('are built from the field’s type, with Skip and Stop asking always', () => {
    assert.deepEqual(labels(field(HOLDING, 'tenure', 'legal.title')), ['Freehold', 'Leasehold', 'Government grant', 'Inam', 'Skip', 'Stop asking'], 'a choice field offers its list');
    assert.deepEqual(labels(field('legal.approvals.land_use', 'use_permitted', 'legal.approvals')), ['Yes', 'No', 'Skip', 'Stop asking']);
    assert.deepEqual(labels(field('finance.feasibility.costs', 'contingency_pct', 'finance.feasibility')), ['25%', '50%', '75%', '100%', 'Skip', 'Stop asking']);
    assert.deepEqual(labels(field('finance.budget.approved', 'approved_on', 'finance.budget')), ['Today', 'Skip', 'Stop asking']);
    // A figure, an area and words are typed: the message box takes them.
    for (const typed of [field('finance.budget.contingency', 'contingency_original', 'finance.budget'), field(HOLDING, 'extent', 'legal.title'), field('finance.budget.approved', 'budget_version', 'finance.budget')]) {
      assert.deepEqual(labels(typed), ['Skip', 'Stop asking'], typed.field);
    }
  });

  it('cap a long list, and carry the run, the question and the value so a press is exact', () => {
    const many = askChoices(p, run([field('design.brief.sheet', 'amenities', 'design.brief')]));
    assert.ok(many.length <= 8, 'six of the list at most, then Skip and Stop asking');
    assert.deepEqual(many[0]!.sitting?.ask, { act: 'answer', run: 'ask_t', at: 0, value: [many[0]!.sitting!.ask!.value as string].flat() }, 'a pick of several is a list of one');
    const yes = askChoices(p, run([field('legal.approvals.land_use', 'use_permitted', 'legal.approvals')]))[0]!;
    assert.deepEqual(yes.sitting?.ask, { act: 'answer', run: 'ask_t', at: 0, value: true });
    assert.equal(askingSaid({ at: 2, targets: new Array(7) as never }), 'Asking: 3 of 7');
  });
});

describe('a run over a function’s missing fields', () => {
  it('asks one question a reply, in the sheet’s order, and an answer waits on its field as the person’s words', () => {
    const p = project();
    const first = sayIn(p, "What's missing here?");
    assert.match(first.assistantTurn.text, /^2 things are missing\./);
    assert.match(first.assistantTurn.text, /Legal › Title — Land holding: Tenure\?/);
    assert.deepEqual(first.assistantTurn.asking && [first.assistantTurn.asking.at, first.assistantTurn.asking.targets.map((target) => target.label)], [0, ['Tenure', 'Extent held']]);

    // A word that is not on the list is no answer: it is a message like any other, and its reply ends the run where it stood.
    const aside = sayIn(p, 'Rented');
    assert.equal(aside.assistantTurn.asking, undefined);
    assert.equal(chatAskingOpen(p.conversation), undefined, 'the question is no longer open');
    assert.equal(tenureOf(p), undefined, 'nothing was written');
    // Asked to ask again, the chat says the run before stopped, and asks the tenure again.
    const again = sayIn(p, 'ask me');
    assert.match(again.assistantTurn.text, /^The questions before stopped when something else was said\b.*\n\nLegal › Title — Land holding: Tenure\?/s);

    const answered = sayIn(p, 'freehold');
    assert.match(answered.assistantTurn.text, /^Suggested Freehold on Tenure\.\n\nLegal › Title — Land holding: Extent held\?/);
    const tenure = tenureOf(p)!;
    assert.equal(fieldState(tenure), 'proposed', 'it waits on the field until it is accepted');
    assert.deepEqual(tenure.origin, { kind: 'chat', by: LEAD, quote: 'freehold', turnId: answered.userTurn.id, sessionId: 'sit_ask', at: tenure.origin?.kind === 'chat' ? tenure.origin.at : '' });
    assert.deepEqual(tenure.chat, { turnId: answered.userTurn.id, sessionId: 'sit_ask' });
    assert.deepEqual(answered.assistantTurn.suggested?.map((line) => line.words), ['Suggested a value on Legal › Title']);

    // A figure with its unit answers the area, and the chat lists both as waiting.
    const area = sayIn(p, '2 acres 10 guntas');
    assert.match(area.assistantTurn.text, /^Suggested 2 acres 10 guntas .* on Extent held\.\n\nThat was the last question\. Suggested 2 of 2\./);
    assert.equal(area.assistantTurn.asking?.ended, 'done');
    assert.deepEqual(chatWaiting(p, 'sit_ask').places.map(waitingPlaceLine), ['Legal › Title · 2 values']);
    assert.equal(chatAskingOpen(p.conversation), undefined);
  });

  it('moves on at Skip and asks that field no more; Stop ends it and says how many were suggested', () => {
    const p = project();
    const first = sayIn(p, 'fill in the blanks');
    const skipped = press(p, first, 'Skip');
    assert.match(skipped.assistantTurn.text, /^Skipped Tenure\.\n\nLegal › Title — Land holding: Extent held\?/);
    assert.deepEqual([skipped.assistantTurn.asking?.at, skipped.assistantTurn.asking?.skipped], [1, 1]);
    // "stop" typed ends it.
    const stopped = sayIn(p, 'stop');
    assert.equal(stopped.assistantTurn.text, 'Stopped asking. Nothing was suggested.');
    assert.equal(stopped.assistantTurn.asking?.ended, 'stopped');
    assert.equal(tenureOf(p), undefined);

    // A button of a question that has moved on changes nothing.
    const again = sayIn(p, 'ask me');
    const freehold = again.assistantTurn.choices!.find((choice) => choice.label === 'Freehold')!;
    press(p, again, 'Skip');
    const late = sayIn(p, freehold.send, freehold.sitting);
    assert.match(late.assistantTurn.text, /^That question has moved on, so nothing was changed\.\n\nLegal › Title — Land holding: Extent held\?/);
    assert.equal(tenureOf(p), undefined);
    const done = press(p, late, 'Stop asking');
    assert.equal(done.assistantTurn.text, 'Stopped asking. Nothing was suggested.');
  });

  it('asks nothing a field already holds, and nothing on a page with nothing missing', () => {
    const p = project();
    sayIn(p, 'ask me');
    sayIn(p, 'Leasehold');
    sayIn(p, 'stop');
    // Tenure now waits, so a new run begins at the extent.
    const next = sayIn(p, 'ask me');
    assert.deepEqual(next.assistantTurn.asking?.targets.map((target) => target.label), ['Extent held']);
    assert.match(next.assistantTurn.text, /^One thing is missing\./);
    // Off a function's page "ask me" is not a run.
    assert.equal(sayIn(p, 'stop').assistantTurn.asking?.ended, 'stopped');
    assert.equal(sayIn(p, 'ask me', undefined, { pane: 'overview' }).assistantTurn.asking, undefined);
  });

  it('offers to ask where it cannot answer and the answer has a field nobody has filled', () => {
    const p = project();
    const not = sayIn(p, 'what is the tenure of the land?', undefined, { pane: 'overview' });
    const fill = not.assistantTurn.choices?.find((choice) => choice.label === 'Fill these in');
    assert.ok(fill, not.assistantTurn.text);
    assert.deepEqual(fill.sitting?.ask, { act: 'start', fields: [{ fn: 'legal.title', set: HOLDING, field: 'tenure' }] });
    const asked = press(p, not, 'Fill these in', { pane: 'overview' });
    assert.match(asked.assistantTurn.text, /Legal › Title — Land holding: Tenure\?/);
    assert.equal(asked.assistantTurn.asking?.targets.length, 1);

    // A model's answer that names blank fields to look at offers the same.
    const model = applyProjectAgentTurn(project(), 'what is the extent?', { text: 'The record holds part of this.', proposals: [], navigations: [], card: { v: 1, outcome: 'not_on_record', rows: [], look: [{ label: 'Extent held (Land holding)', address: field(HOLDING, 'extent', 'legal.title') }] } });
    assert.deepEqual(model.assistantTurn.choices?.map((choice) => [choice.label, choice.sitting?.ask?.fields?.map((address) => address.field)]), [['Fill these in', ['extent']]]);
  });
});

describe('a month’s owner pack with milestones that have no reading for it', () => {
  it('says which, offers to ask for them, and a reading waits as a change to the milestone on Progress', () => {
    const p = project();
    const [slab, lift] = addMilestones(p, [{ name: 'Tower A slab 7', weight: 2 }, { name: 'Lift core', weight: 1 }], LEAD);
    // Each was first reported after September ended: nothing is known of either as September stood.
    slab!.readings = [{ on: '2026-10-04', percent: 40 }];
    slab!.percent = 40;
    lift!.readings = [{ on: '2026-10-06', percent: 10 }];
    lift!.percent = 10;
    const reports = { pane: 'reports' };
    const pack = sayIn(p, 'Open the owner pack for September 2026', undefined, reports);
    assert.match(pack.assistantTurn.text, /2 milestones have no reading for that month: Tower A slab 7 and Lift core\. I can ask you for them, one at a time\./);
    const offer = pack.assistantTurn.choices?.find((choice) => choice.label === 'Ask me for the readings');
    assert.deepEqual(offer?.sitting?.ask, { act: 'start', month: '2026-09' });

    const first = press(p, pack, 'Ask me for the readings', reports);
    assert.match(first.assistantTurn.text, /Engineering › Progress — Tower A slab 7: how far along at 30 Sep 2026\?/);
    assert.deepEqual(first.assistantTurn.choices?.map((choice) => choice.label), ['25%', '50%', '75%', '100%', 'Skip', 'Stop asking']);

    const second = sayIn(p, '30%', undefined, reports);
    assert.match(second.assistantTurn.text, /^Suggested 30% on Progress — Tower A slab 7\.\n\nEngineering › Progress — Lift core: how far along at 30 Sep 2026\?/);
    assert.equal(slab!.readings.length, 1, 'nothing is on the milestone until it is accepted');
    const card = p.chatProposals.find((held) => held.kind === 'patch_record' && held.payload.register === 'milestone')!;
    assert.deepEqual([card.title, card.payload.on, card.chat?.turnId], ['“Tower A slab 7” at 30% on 30 Sep 2026', '2026-09-30', second.userTurn.id]);
    assert.deepEqual(chatWaiting(p, 'sit_ask').places.map(waitingPlaceLine), ['Engineering › Progress · 1 value']);
    // It waits on the milestone's own row of Progress, with the person's words, and the strip's link opens there.
    assert.deepEqual(milestoneReadingsWaiting(p, slab!.id).map((one) => [one.card.id, one.percent, one.on, one.card.said?.quote]), [[card.id, 30, '2026-09-30', '30%']]);
    assert.deepEqual(milestoneReadingsWaiting(p, lift!.id), []);
    const { pane, extra } = chatWaiting(p, 'sit_ask').places[0]!.open;
    assert.deepEqual([pane, extra.workstream, extra.section, extra.item], ['workstream', 'construction.progress', 'progress', slab!.id]);

    // Accepted, the reading is kept at its day and lowers nothing reported since.
    acceptWaiting(p, card.id, LEAD);
    assert.deepEqual(slab!.readings, [{ on: '2026-09-30', percent: 30 }, { on: '2026-10-04', percent: 40 }]);
    assert.equal(slab!.percent, 40);
  });
});

describe('an outside collaborator', () => {
  it('is asked only for the sheets in their reach', () => {
    const p = project();
    assert.equal(askableFields(p, 'legal.title', { outside: true }).length, 0, 'a sheet their copy does not hold is not theirs to fill');
    sayIn(p, 'ask me');
    sayIn(p, 'Freehold');
    assert.deepEqual(askableFields(p, 'legal.title', { outside: true }).map((target) => target.label), ['Extent held']);
  });
});

describe('the chat asking, over the route', () => {
  const JWKS_URL = 'https://example.test/jwks-ask';
  const ISSUER = 'https://securetoken.google.com/realytica-ask';
  const AUDIENCE = 'realytica-ask';
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
  const OWNER = 'dev@builders.example';
  const OUTSIDE = 'surveyor@outside.example';
  const owner = () => tokenFor('sub-owner', OWNER);
  const outside = () => tokenFor('sub-outside', OUTSIDE);

  let server: Server;
  let base: string;
  let dataDir: string;
  let tenantId = '';
  const realFetch = globalThis.fetch;
  const env = ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_RATE_LIMIT_MODEL'];

  async function call(method: string, route: string, token: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  async function chat(projectId: string, question: string, token: string, sessionId: string, extra: Record<string, unknown> = {}): Promise<{ userTurn: ProjectChatTurn; assistantTurn: ProjectChatTurn; project: DdProject }> {
    const res = await realFetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question, sessionId, ...extra }) });
    const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const result = lines.find((line) => line.type === 'result') as { userTurn: ProjectChatTurn; assistantTurn: ProjectChatTurn; project: DdProject } | undefined;
    assert.ok(result, `the chat answered: ${JSON.stringify(lines).slice(0, 300)}`);
    return result;
  }

  async function stored(id: string): Promise<DdProject> {
    const { store } = await import('../apps/api/src/store');
    return store.data.projects!.find((p) => p.id === id)!;
  }

  async function onFile(): Promise<DdProject> {
    const { store } = await import('../apps/api/src/store');
    const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, `RYT-${Math.random().toString(36).slice(2, 8)}`, OWNER);
    p.tenantId = tenantId;
    p.jurisdiction = 'Karnataka';
    store.data.projects!.push(p);
    await store.save();
    return p;
  }

  before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-ask-'));
    process.env.REALYTICA_DATA_DIR = dataDir;
    process.env.REALYTICA_AUTH_MODE = 'oidc';
    process.env.REALYTICA_AUTH_ISSUER = ISSUER;
    process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
    process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
    process.env.REALYTICA_RATE_LIMIT_MODEL = '500';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
      throw new Error(`this test has no network: ${String(input)} ${init?.method ?? ''}`);
    }) as typeof fetch;
    const { app, initApp } = await import('../apps/api/src/app');
    await initApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal(((await call('GET', '/api/members', owner())).body.me as { role: string }).role, 'owner');
    assert.equal((await call('POST', '/api/members', owner(), { email: OUTSIDE, role: 'collaborator' })).status, 201);
    await call('GET', '/api/members', outside());
    const { store } = await import('../apps/api/src/store');
    tenantId = store.data.tenants![0]!.id;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    await afterReplyWorkDone();
    rmSync(dataDir, { recursive: true, force: true });
    for (const name of env) delete process.env[name];
  });

  it('keeps the run with the chat, so a typed answer and a pressed Stop carry on where it stood', async () => {
    const p = await onFile();
    const first = await chat(p.id, "what's missing here", owner(), 'sit_route', { place: TITLE_PAGE });
    assert.equal(first.assistantTurn.asking?.at, 0, first.assistantTurn.text);
    // Read again from what is stored, as a reload or another device would.
    assert.equal(chatAskingOpen((await stored(p.id)).conversation)?.run, first.assistantTurn.asking?.run);
    const answered = await chat(p.id, 'Freehold', owner(), 'sit_route', { place: TITLE_PAGE });
    assert.match(answered.assistantTurn.text, /^Suggested Freehold on Tenure\./);
    const tenure = (await stored(p.id)).fieldSheets![HOLDING]!.values.tenure!;
    assert.deepEqual([fieldState(tenure), tenure.origin?.kind, tenure.chat?.sessionId], ['proposed', 'chat', 'sit_route']);
    const open = answered.assistantTurn.asking!;
    const stopped = await chat(p.id, 'Stop asking', owner(), 'sit_route', { place: TITLE_PAGE, sitting: { ask: { act: 'stop', run: open.run, at: open.at } } });
    assert.equal(stopped.assistantTurn.text, 'Stopped asking. Suggested 1 of 2. It waits where it lands until it is accepted there.');
    assert.equal(chatAskingOpen((await stored(p.id)).conversation), undefined);
  });

  it('accepts a milestone reading on its row of Progress by the path Accept all takes, and the chat’s strip then lists nothing', async () => {
    const p = await onFile();
    const [slab] = addMilestones(p, [{ name: 'Tower A slab 7', weight: 2 }], OWNER);
    slab!.readings = [{ on: '2026-10-04', percent: 40 }];
    slab!.percent = 40;
    const { store } = await import('../apps/api/src/store');
    await store.save();
    const reports = { place: { pane: 'reports' } };
    const pack = await chat(p.id, 'Open the owner pack for September 2026', owner(), 'sit_reading', reports);
    const offer = pack.assistantTurn.choices?.find((choice) => choice.label === 'Ask me for the readings');
    assert.ok(offer, pack.assistantTurn.text);
    await chat(p.id, offer.send, owner(), 'sit_reading', { ...reports, sitting: offer.sitting });
    const answered = await chat(p.id, '30%', owner(), 'sit_reading', reports);
    assert.match(answered.assistantTurn.text, /^Suggested 30% on Progress — Tower A slab 7\./);
    // The line under the reply opens Progress at the milestone.
    assert.equal(answered.assistantTurn.suggested?.[0]?.open.extra.item, slab!.id, JSON.stringify(answered.assistantTurn.suggested));
    const [waiting] = milestoneReadingsWaiting(await stored(p.id), slab!.id);
    assert.ok(waiting, 'the reading waits on the milestone');
    assert.equal(chatWaiting(await stored(p.id), 'sit_reading').cards.length, 1);
    const onProgress = (held: DdProject) => suggestionsOn(held).filter((one) => one.fn === 'construction.progress').length;
    assert.equal(onProgress(await stored(p.id)), 1, 'Needs you counts it on Progress');

    const accepted = await call('POST', `/api/projects/${p.id}/proposals/${waiting.card.id}/accept`, owner());
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const after = await stored(p.id);
    assert.deepEqual(after.milestones!.find((held) => held.id === slab!.id)!.readings, [{ on: '2026-09-30', percent: 30 }, { on: '2026-10-04', percent: 40 }]);
    assert.deepEqual(milestoneReadingsWaiting(after, slab!.id), []);
    assert.deepEqual(chatWaiting(after, 'sit_reading').places, [], 'the strip has nothing left to accept');
    assert.equal(onProgress(after), 0, 'and Needs you counts nothing on Progress');
    // Accept all, pressed after, finds nothing more to do.
    const all = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_reading/accept`, owner());
    assert.deepEqual([all.status, all.body.accepted], [200, {}]);
  });

  it('keeps an outside collaborator’s answer on the project’s own sheet, where their grant reaches', async () => {
    const p = await onFile();
    // The sheet is on the file, so it is on their copy and theirs to be asked for.
    p.fieldSheets = { [HOLDING]: { values: {} } };
    const { store } = await import('../apps/api/src/store');
    const grant: ProjectGrant = { id: 'grant-ask-sheet', tenantId, projectId: p.id, email: OUTSIDE, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: OWNER };
    store.data.grants = [...(store.data.grants ?? []), grant];
    await store.save();
    const first = await chat(p.id, "what's missing here", outside(), 'sit_out_ask', { place: TITLE_PAGE });
    assert.equal(first.assistantTurn.asking?.at, 0, first.assistantTurn.text);
    const answered = await chat(p.id, 'Freehold', outside(), 'sit_out_ask', { place: TITLE_PAGE });
    assert.match(answered.assistantTurn.text, /^Suggested Freehold on Tenure\./);
    // Their chat ran on a copy; the answer waits on the project itself, in their words, under their message.
    const tenure = (await stored(p.id)).fieldSheets![HOLDING]!.values.tenure;
    assert.ok(tenure, 'the answer is on the project’s sheet');
    assert.deepEqual([fieldState(tenure), tenure.origin?.kind, tenure.origin?.kind === 'chat' ? tenure.origin.by : '', tenure.chat?.turnId], ['proposed', 'chat', OUTSIDE, answered.userTurn.id]);
    // The firm's lead accepts it where it waits.
    assert.deepEqual(chatWaiting(await stored(p.id), 'sit_out_ask').fields.map((address) => address.field), ['tenure']);
  });

  it('tells an outside collaborator that a risk they add is sent to the firm, and offers them nothing to accept', async () => {
    const p = await onFile();
    const { store } = await import('../apps/api/src/store');
    const grant: ProjectGrant = { id: 'grant-ask', tenantId, projectId: p.id, email: OUTSIDE, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: OWNER };
    store.data.grants = [...(store.data.grants ?? []), grant];
    await store.save();
    const out = await chat(p.id, 'Add a risk: the drain crosses the plot', outside(), 'sit_outside');
    assert.match(out.assistantTurn.text, /^This is sent to the firm to accept\. Nothing is written until somebody there accepts it\./);
    assert.doesNotMatch(out.assistantTurn.text, /waits as a suggestion|accept it there/);
    assert.equal(out.assistantTurn.suggested, undefined, 'no line under the reply opens a register they cannot see');
    // Their strip lists nothing of the firm's to accept, whatever their copy of the project holds.
    assert.deepEqual(chatWaiting(out.project, 'sit_outside', {}, { outside: true }).places, []);
    assert.equal((await stored(p.id)).chatProposals.find((card) => card.title.includes('the drain crosses the plot'))?.status, 'proposed', 'it waits for the firm');
  });
});
