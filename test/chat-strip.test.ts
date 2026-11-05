/**
 * The top of a chat: where it is, what it suggested that still waits, and
 * one button that accepts it (docs/product.md, "One chat, and what it may
 * do").
 *
 * - An instruction typed in the chat ("Set owner to …", "Add an action: …",
 *   "close the … action", "mark the … finding as high") waits as a
 *   suggestion where it lands, as a statement does, and nothing is written
 *   until a person accepts it.
 * - A chat lists what it suggested that still waits by the tag each
 *   suggestion carries, across every sitting it was carried on in, and
 *   nobody else's.
 * - "Approve all" typed in a chat takes what that chat suggested, as the
 *   button does.
 * - The month in play goes with the place the page sends, and is otherwise
 *   the last month the chat asked about.
 * - Accept all is read and decided by the server, as accepting each where it
 *   waits would be: a value by a lead or signer of its function, and none of
 *   the firm's cards by an outside collaborator.
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
  addAction,
  addFinding,
  applyProjectChat,
  chatAcceptedSaid,
  chatPeriod,
  chatPlaceFrom,
  chatPlaceLine,
  chatWaiting,
  createProject,
  fieldState,
  periodLabel,
  proposeFieldValues,
  setTeamMember,
  waitingPlaceLine,
  type ChatInHand,
  type DdProject,
  type FieldAddress,
  type FieldOrigin,
  type ProjectChatResult,
  type ProjectChatTurn,
  type ProjectGrant,
} from '@realytica/shared';

const LEAD = 'lead@firm.example';
const HOLDING = 'legal.title.holding';
const extent: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'extent' };
const tenure: FieldAddress = { fn: 'legal.title', set: HOLDING, field: 'tenure' };
const said = (quote: string) => ({ kind: 'said', quote }) as unknown as FieldOrigin;
const message = (words: string, turnId: string, sessionId: string, by = LEAD): ChatInHand => ({ tag: { turnId, sessionId }, by, message: words, at: '2026-11-05T06:00:00.000Z' });

function project(): DdProject {
  const p = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-STP');
  p.jurisdiction = 'Karnataka';
  setTeamMember(p, { email: LEAD, departments: { legal: 'lead', finance: 'lead' } }, 'owner');
  return p;
}

/** Say something in a chat, and keep both turns under its sitting, as the chat route does. */
function sayIn(p: DdProject, words: string, sessionId: string, continues?: string): ProjectChatResult {
  const out = applyProjectChat(p, words, { actor: LEAD, chat: { sessionId, actor: LEAD, ...(continues ? { continues } : {}) } });
  for (const turn of [out.userTurn, out.assistantTurn]) {
    turn.sessionId = sessionId;
    if (continues) turn.continues = continues;
  }
  return out;
}

describe('an instruction typed in the chat', () => {
  it('waits as a suggestion where it lands, under the message, and is written only once accepted', () => {
    const p = project();
    addAction(p, { title: 'Get the tax receipt', kind: 'clarification', owner: 'Ravi', priority: 'low' }, LEAD);
    const finding = addFinding(p, { title: 'Boundary wall encroaches', description: 'Two metres onto the road.', severity: 'medium', discipline: 'legal' }, LEAD);

    const owner = sayIn(p, 'Set owner to Priya Shah', 'sit_cmd');
    assert.equal(p.owner, undefined, 'the owner waits beside the fact');
    assert.deepEqual(owner.proposals[0]?.chat, { turnId: owner.userTurn.id, sessionId: 'sit_cmd' });
    assert.deepEqual(owner.assistantTurn.suggested?.map((line) => line.words), ['Suggested the owner on Overview › Key facts']);

    const action = sayIn(p, 'Add an action: get the survey sketch from the seller', 'sit_cmd');
    assert.equal(p.actions.length, 1, 'the action waits at the top of its register');
    assert.deepEqual(action.assistantTurn.suggested?.map((line) => line.words), ['Suggested an action on Risks and actions']);

    const close = sayIn(p, 'Close the tax receipt action', 'sit_cmd');
    assert.equal(p.actions[0]!.status, 'not_started');
    assert.match(close.assistantTurn.text, /^Close action “Get the tax receipt” waits as a suggestion on Risks and actions\./);

    const graded = sayIn(p, 'mark the boundary wall finding as high', 'sit_cmd');
    assert.equal(finding.severity, 'medium');
    assert.match(graded.assistantTurn.text, /^Grade “Boundary wall encroaches” high \(was medium\) waits as a suggestion on Findings\./);

    // Each waits where it lands, and the chat lists them by place.
    const waiting = chatWaiting(p, 'sit_cmd');
    assert.deepEqual(waiting.places.map(waitingPlaceLine), ['Risks and actions · 1 action and 1 change', 'Findings · 1 change', 'Key facts · 1 change']);
  });
});

describe('what a chat suggested that still waits', () => {
  it('is listed by place, across every sitting it was carried on in, and nobody else’s', () => {
    const p = project();
    const first = sayIn(p, 'The owner is Asha Menon', 'sit_old');
    proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model', undefined, { said: message('The extent is 5000 square metres', first.userTurn.id, 'sit_old') });
    // Carried on later in a sitting of its own: what it says there is the same chat's.
    const later = sayIn(p, 'Add a risk: the access road is not adopted', 'sit_new', 'sit_old');
    proposeFieldValues(p, [{ address: tenure, value: 'freehold', origin: said('It is freehold') }], 'model', undefined, { said: message('It is freehold', later.userTurn.id, 'sit_new') });
    // Another chat's suggestion is not this one's.
    sayIn(p, 'Add a risk: the lift may be late', 'sit_other');

    const waiting = chatWaiting(p, 'sit_old');
    assert.deepEqual(waiting.places.map(waitingPlaceLine), ['Legal › Title · 2 values', 'Risks and actions · 1 risk', 'Key facts · 1 change']);
    assert.deepEqual(waiting.fields.map((address) => address.field).sort(), ['extent', 'tenure']);
    assert.equal(waiting.cards.length, 2);
    // By the later sitting's id it is the same chat.
    assert.deepEqual(chatWaiting(p, 'sit_new').places.map((place) => place.count), waiting.places.map((place) => place.count));
    assert.deepEqual(chatWaiting(p, 'sit_other').places.map(waitingPlaceLine), ['Risks and actions · 1 risk']);
    // Nothing is said, and nothing is listed, for a chat that suggested nothing.
    assert.deepEqual(chatWaiting(p, 'sit_none').places, []);
    assert.deepEqual(chatWaiting(p, undefined).places, []);
  });

  it('is all taken by “approve all” typed in that chat, as the button takes it, and the other chat’s is left', () => {
    const p = project();
    const first = sayIn(p, 'Add a risk: the access road is not adopted', 'sit_a');
    proposeFieldValues(p, [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model', undefined, { said: message('The extent is 5000 square metres', first.userTurn.id, 'sit_a') });
    sayIn(p, 'Add a risk: the lift may be late', 'sit_b');
    sayIn(p, 'Set owner to Priya Shah', 'sit_a');

    const approved = sayIn(p, 'approve all', 'sit_a');
    assert.equal(p.owner, 'Priya Shah', approved.assistantTurn.text);
    assert.deepEqual(p.risks.map((risk) => risk.title), ['the access road is not adopted'], 'the earlier message’s risk is taken, and the other chat’s is not');
    assert.equal(fieldState(p.fieldSheets![HOLDING]!.values.extent), 'accepted');
    assert.deepEqual(chatWaiting(p, 'sit_a').places, []);
    assert.deepEqual(chatWaiting(p, 'sit_b').places.map(waitingPlaceLine), ['Risks and actions · 1 risk']);
  });

  it('says in one line what Accept all took, what it left and why', () => {
    assert.equal(chatAcceptedSaid({ accepted: { value: 2, risk: 1, change: 1 }, left: 0, why: [], beside: 0 }), 'Accepted 2 values, 1 risk and 1 change.');
    assert.equal(
      chatAcceptedSaid({ accepted: {}, left: 2, why: ['Deciding this needs a lead or signer in Legal.'], beside: 1 }),
      'Nothing was accepted. 2 are left waiting: Deciding this needs a lead or signer in Legal. One value waits beside the value a field holds, for you to choose on the field.',
    );
  });
});

describe('the month in play', () => {
  it('goes with the place the page sends, as a month and nothing else', () => {
    assert.deepEqual(chatPlaceFrom({ pane: 'reports', period: '2026-09' }), { pane: 'reports', period: '2026-09' });
    assert.deepEqual(chatPlaceFrom({ pane: 'reports', period: 'September' }), { pane: 'reports' });
    assert.equal(periodLabel('2026-09'), 'September 2026');
    assert.match(chatPlaceLine(project(), { pane: 'reports', period: '2026-09' })!, /with September 2026 open$/);
  });

  it('is the month the page has open, else the last one the chat asked about, else none', () => {
    const turn = (text: string, at = '2026-11-05T06:00:00.000Z', place?: ProjectChatTurn['place']) => ({ role: 'user' as const, text, at, ...(place ? { place } : {}) });
    const turns = [turn('Open the owner pack for August 2026'), turn('what changed last month?', '2026-10-03T06:00:00.000Z'), { role: 'assistant' as const, text: 'September 2026 is open.', at: '2026-10-03T06:00:01.000Z' }];
    assert.equal(chatPeriod({ period: '2026-07' }, turns), '2026-07');
    assert.equal(chatPeriod({}, turns), '2026-09', 'the last message that names one, read on its own day');
    assert.equal(chatPeriod(undefined, [turn('what is waiting?', undefined, { pane: 'reports', period: '2026-06' })]), '2026-06', 'or the month the page had open when it was asked');
    assert.equal(chatPeriod({}, [turn('what is the extent?')]), undefined);
  });
});

describe('Accept all for a chat, over the route', () => {
  const JWKS_URL = 'https://example.test/jwks-strip';
  const ISSUER = 'https://securetoken.google.com/realytica-strip';
  const AUDIENCE = 'realytica-strip';
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
  const STAFF = 'meera@builders.example';
  const OUTSIDE = 'surveyor@outside.example';
  const owner = () => tokenFor('sub-owner', OWNER);
  const staff = () => tokenFor('sub-staff', STAFF);
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

  async function chat(projectId: string, question: string, token: string, sessionId: string, place?: Record<string, unknown>): Promise<{ userTurn: ProjectChatTurn; assistantTurn: ProjectChatTurn }> {
    const res = await realFetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ question, sessionId, ...(place ? { place } : {}) }) });
    const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const result = lines.find((line) => line.type === 'result') as { userTurn: ProjectChatTurn; assistantTurn: ProjectChatTurn } | undefined;
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
    dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-strip-'));
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
    // The owner claims the workspace, and takes on a member of staff and an outside collaborator.
    assert.equal(((await call('GET', '/api/members', owner())).body.me as { role: string }).role, 'owner');
    assert.equal((await call('POST', '/api/members', owner(), { email: STAFF, role: 'staff' })).status, 201);
    assert.equal((await call('POST', '/api/members', owner(), { email: OUTSIDE, role: 'collaborator' })).status, 201);
    await call('GET', '/api/members', staff());
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

  it('keeps the month the page has open with the turns it was asked on', async () => {
    const p = await onFile();
    const out = await chat(p.id, 'what is waiting?', owner(), 'sit_month', { pane: 'reports', period: '2026-09' });
    assert.equal(out.userTurn.place?.period, '2026-09');
    assert.equal((await stored(p.id)).conversation.find((turn) => turn.id === out.userTurn.id)?.place?.period, '2026-09');
  });

  it('accepts what the chat suggested and still waits, and leaves a value that is not this person’s to decide, saying why', async () => {
    const p = await onFile();
    const first = await chat(p.id, 'Add a risk: the access road is not adopted', staff(), 'sit_staff');
    await chat(p.id, 'The owner is Asha Menon', staff(), 'sit_staff');
    // A value said in the same chat waits on Legal's sheet, under her message.
    proposeFieldValues(await stored(p.id), [{ address: extent, value: 5000, origin: said('5000 square metres') }], 'model', undefined, { said: message('The extent is 5000 square metres', first.userTurn.id, 'sit_staff', STAFF) });

    const taken = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_staff/accept`, staff());
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.deepEqual(taken.body.accepted, { risk: 1, fact: 1 });
    assert.equal(taken.body.left, 1);
    assert.match(String(taken.body.said), /^Accepted 1 risk and 1 change\. One is left waiting: .*Legal/);
    const now = await stored(p.id);
    assert.deepEqual([now.risks.length, now.owner, fieldState(now.fieldSheets![HOLDING]!.values.extent)], [1, 'Asha Menon', 'proposed']);

    // Made a lead of Legal on the team list, she takes the value with the same button.
    assert.equal((await call('PUT', `/api/projects/${p.id}/team/${encodeURIComponent(STAFF)}`, owner(), { departments: { legal: 'lead' } })).status, 200);
    const again = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_staff/accept`, staff());
    assert.deepEqual([again.body.accepted, again.body.said], [{ value: 1 }, 'Accepted 1 value.']);
    assert.equal(fieldState((await stored(p.id)).fieldSheets![HOLDING]!.values.extent), 'accepted');
    // Nothing is left, and a press now says so.
    assert.equal((await call('POST', `/api/projects/${p.id}/chat/sessions/sit_staff/accept`, staff())).body.said, 'Nothing was accepted.');
  });

  it('finds what was suggested in a chat that carries on a colleague’s, by the id the page sends for it', async () => {
    const p = await onFile();
    await chat(p.id, 'Add a risk: the lift may be late', owner(), 'sit_root');
    // She opens the owner's chat and carries it on in a sitting of her own. The page names the chat on screen by the owner's id.
    const res = await realFetch(`${base}/api/projects/${p.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staff()}` }, body: JSON.stringify({ question: 'Add a risk: the access road is not adopted', sessionId: 'sit_hers', continues: 'sit_root' }) });
    assert.ok((await res.text()).includes('"type":"result"'));
    const taken = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_root/accept`, staff());
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.deepEqual((await stored(p.id)).risks.map((risk) => risk.title).sort(), ['the access road is not adopted', 'the lift may be late'], String(taken.body.said));
  });

  it('accepts nothing of another person’s chat, and none of the firm’s cards for an outside collaborator', async () => {
    const p = await onFile();
    await chat(p.id, 'Add a risk: the lift may be late', owner(), 'sit_owner');
    // The staff member presses Accept all on the owner's chat by its id: it is not her chat, and nothing of it is hers to take.
    const theirs = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_owner/accept`, staff());
    assert.deepEqual([theirs.status, theirs.body.said], [200, 'Nothing was accepted.']);

    const { store } = await import('../apps/api/src/store');
    const grant: ProjectGrant = { id: 'grant-strip', tenantId, projectId: p.id, email: OUTSIDE, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: OWNER };
    store.data.grants = [...(store.data.grants ?? []), grant];
    await store.save();
    await chat(p.id, 'Add a risk: the drain crosses the plot', outside(), 'sit_outside');
    const raised = (await stored(p.id)).chatProposals.find((card) => card.title.includes('the drain crosses the plot'));
    assert.equal(raised?.status, 'proposed', 'the collaborator’s suggestion waits on the firm’s register');
    const pressed = await call('POST', `/api/projects/${p.id}/chat/sessions/sit_outside/accept`, outside());
    assert.equal(pressed.status, 200);
    assert.equal(pressed.body.said, 'Nothing was accepted.');
    assert.equal((await stored(p.id)).chatProposals.find((card) => card.id === raised!.id)?.status, 'proposed', 'it is the firm’s to accept');
    assert.equal((await stored(p.id)).risks.length, 0);
  });
});
