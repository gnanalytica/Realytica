/**
 * The law and policy watch, over real HTTP with sign-in on, with stand-ins
 * for the official pages and for the model.
 *
 * Four people sign in: the firm's owner, one of its staff who leads Legal on
 * the project, a viewer, and a contractor working from a grant. The pages
 * are served by a fetch that stands in for the network, so a test says what
 * a page reads on each day; the model is a local server that answers with a
 * summary nobody reads, fields, a quote, and actions, some of them for a project and a department
 * it was never given.
 *
 * What is held to: a first reading is no change; the same words are no
 * change; new words are one, with the lines that came; a page that fails
 * says why and is not a change when it comes back; a path a site disallows
 * is never asked for; nothing reaches a project until somebody who may
 * confirms; a dismissal reaches none; and the two who may not are refused.
 *
 * The firm, the people, the project, the pages and the circulars are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  LAW_TEXT_AT_MOST,
  LAW_TEXT_CUT,
  LAW_WATCH_SEED,
  confirmLawChange,
  createProject,
  dismissLawChange,
  lawChangeSaid,
  lawPageText,
  lawTextDiff,
  robotsDisallows,
  seededLawWatch,
  setTeamMember,
  type DdProject,
  type LawChange,
  type LawSource,
  type LawWatchState,
  type ProjectGrant,
} from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-law';
const ISSUER = 'https://securetoken.google.com/realytica-law';
const AUDIENCE = 'realytica-law';
const HOST = 'laws.example.test';
const SHY = 'shy.example.test';
const PAGE = `https://${HOST}/circulars`;

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

const owner = () => tokenFor('sub-dev', 'dev@builders.example');
const lead = () => tokenFor('sub-lena', 'lena@builders.example');
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let server: Server;
let model: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let tenantId = '';
let sourceId = '';
const realFetch = globalThis.fetch;

/** What each address answers today, and every address that was asked for. */
const pages = new Map<string, { status: number; body: string | Uint8Array; type?: string; location?: string }>();
const askedFor: string[] = [];
const modelAsked: string[] = [];

const page = (lines: string[]): string => `<html><head><title>Circulars</title><script>var hits = ${Math.random()};</script></head><body><h1>Circulars of the Planning Authority</h1>${lines.map((line) => `<p>${line}</p>`).join('')}<p>Last updated: ${Math.random()}</p></body></html>`;

const FIRST = ['Circular 14 of 2026: setbacks for plots above 4,000 square metres, dated 3 August 2026.', 'Circular 13 of 2026: fee for plan sanction revised, dated 1 July 2026.', 'The Authority publishes its circulars on this page. Earlier circulars are kept in the archive for reference by applicants.'];
/** A person's fields for a change, where a test is about something else. */
const FIELDS = { change: 'new_requirement' as const, affects: [] };
const NEW_LINE = 'Circular 15 of 2026: occupancy certificate applications must carry a structural stability certificate from 1 November 2026.';

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a body that is not JSON is itself the answer */
  }
  return { status: res.status, body };
}

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'stand-in', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const day = (n: number): Date => new Date(Date.UTC(2026, 9, 12 + n, 3, 0, 0));
const actionsOn = async (): Promise<Array<{ title: string; description?: string; owner: string }>> => {
  const { store } = await import('../apps/api/src/store');
  return structuredClone(store.data.projects!.find((held) => held.id === project.id)!.actions);
};
const sourceBody = (over: Record<string, unknown> = {}) => ({ title: 'Planning Authority circulars', url: PAGE, jurisdiction: 'Karnataka', governs: 'Plan sanction, setbacks and occupancy certificates', departments: ['legal', 'finance'], projectKinds: [], stages: [], everyDays: 1, ...over });

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-law-watch-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  // The stand-in hosts resolve nowhere, so they are named as reachable, as a deployment names a host of its own.
  process.env.REALYTICA_FLOW_ALLOW_HOSTS = `${HOST},${SHY}`;

  model = createServer(async (req, res) => {
    const sent = await bodyOf(req);
    const content = (sent.messages?.[0]?.content ?? []) as Array<{ text?: string }> | string;
    const text = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('\n');
    modelAsked.push(text);
    const id = /^(\S+): Lake Road offices\./m.exec(text)?.[1] ?? '';
    streamMessage(
      res,
      {
        // Sentences a model might still send. Nothing reads them and nothing keeps them.
        summary: 'A new circular asks for a structural stability certificate with occupancy certificate applications from 1 November 2026.',
        instrument: 'circular',
        reference: 'Circular 15 of 2026',
        // A day no changed line writes: worked out, so dropped.
        dated: '2026-10-14',
        effective_from: '2026-11-01',
        change: 'new_requirement',
        // A figure no removed line writes.
        was: { number: 30, unit: 'days', date: '' },
        now: { number: null, unit: 'none', date: '' },
        // The approval is on the list; the other two marks are on none.
        affects: ['occupancy', 'f9999', 'the certificate'],
        quote: NEW_LINE,
        projects: [
          {
            projectId: id,
            why: 'The project is in Karnataka and will apply for an occupancy certificate.',
            actions: [
              { department: 'legal', next: 'apply_for_approval', about: 'occupancy', title: 'Confirm whether the occupancy certificate application needs the structural stability certificate' },
              // A department the source is not for.
              { department: 'procurement', next: 'read_change', about: '', title: 'Buy something' },
              // A next step that is on no list.
              { department: 'legal', next: 'write_to_the_authority', about: '' },
            ],
          },
          // A project that was never on the list.
          { projectId: 'not-a-project', why: 'None', actions: [{ department: 'legal', next: 'read_change', about: '' }] },
        ],
      },
      String(sent.tools?.[0]?.name ?? ''),
    );
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  process.env.REALYTICA_API_KEY = 'a-key-for-nobody';

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    if (url.includes(HOST) || url.includes(SHY)) askedFor.push(url);
    const held = pages.get(url);
    if (!held) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(held.body, { status: held.status, headers: { 'content-type': held.type ?? 'text/html; charset=utf-8', ...(held.location ? { location: held.location } : {}) } });
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  for (const [email, role] of [['lena@builders.example', 'staff'], ['vera@builders.example', 'viewer'], ['sam@site.example', 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201);
  }
  for (const token of [lead, viewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Bengaluru' }, 'RYT-LW1');
  project.tenantId = tenantId;
  setTeamMember(project, { email: 'lena@builders.example', departments: { legal: 'lead' } }, 'dev@builders.example');
  store.data.projects!.push(project);
  const grant: ProjectGrant = { id: 'grant-sam', tenantId, projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: 'dev@builders.example' };
  store.data.grants = [grant];
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  model?.closeAllConnections();
  model?.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_FLOW_ALLOW_HOSTS', 'REALYTICA_BASE_URL', 'REALYTICA_API_KEY']) delete process.env[name];
});

describe('the list a firm starts with', () => {
  it('is short, https, and each address once', () => {
    const urls = LAW_WATCH_SEED.map((seed) => seed.url);
    assert.ok(urls.length >= 1 && urls.length <= 8);
    assert.equal(new Set(urls).size, urls.length);
    for (const seed of LAW_WATCH_SEED) {
      assert.equal(new URL(seed.url).protocol, 'https:');
      assert.ok(seed.title && seed.governs && seed.departments.length && seed.everyDays >= 1, seed.id);
    }
    assert.equal(seededLawWatch('2026-10-12T00:00:00.000Z').changes.length, 0);
  });

  it('is what a firm that has kept nothing is shown, and an admin makes it their own', async () => {
    const shown = await call('GET', '/api/law-watch', { token: owner() });
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.body.sources.map((source: LawSource) => source.id), LAW_WATCH_SEED.map((seed) => seed.id));
    assert.deepEqual([shown.body.mayManage, shown.body.mayReview, shown.body.model, shown.body.waiting.length], [true, true, true, 0]);
    for (const seed of LAW_WATCH_SEED) assert.equal((await call('DELETE', `/api/law-watch/sources/${seed.id}`, { token: owner() })).status, 200);
    const added = await call('POST', '/api/law-watch/sources', { token: owner(), body: sourceBody() });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.sources.length, 1);
    sourceId = added.body.sources[0].id;
    assert.equal(added.body.sources[0].addedBy, 'dev@builders.example');
  });

  it('takes only an https address it does not hold already, with a department and an interval in range', async () => {
    for (const body of [sourceBody({ url: 'http://laws.example.test/other' }), sourceBody({ url: 'not an address' }), sourceBody({ url: `https://${HOST}/b`, departments: [] }), sourceBody({ url: `https://${HOST}/b`, everyDays: 0 }), sourceBody({ url: `https://${HOST}/b`, everyDays: 400 }), sourceBody({ url: `https://${HOST}/b`, title: 'x'.repeat(400) })]) {
      assert.equal((await call('POST', '/api/law-watch/sources', { token: owner(), body })).status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await call('POST', '/api/law-watch/sources', { token: owner(), body: sourceBody() })).status, 409, 'the same address twice');
    assert.equal((await call('GET', '/api/law-watch', { token: owner() })).body.sources.length, 1);
  });

  it('pauses and resumes a source, and a paused one is not looked at', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    const paused = await call('PUT', `/api/law-watch/sources/${sourceId}`, { token: owner(), body: sourceBody({ paused: true }) });
    assert.equal(paused.body.sources[0].paused, true);
    assert.deepEqual(await lawWatchCron(day(-1)), { firms: 1, looked: 0, changed: 0, failed: 0 });
    assert.equal((await call('PUT', `/api/law-watch/sources/${sourceId}`, { token: owner(), body: sourceBody() })).body.sources[0].paused, undefined);
    assert.equal(askedFor.length, 0);
  });
});

describe('the daily look', () => {
  it('reads a page for the first time and calls that no change, and a second run the same day looks at nothing', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    pages.set(PAGE, { status: 200, body: page(FIRST) });
    assert.deepEqual(await lawWatchCron(day(0)), { firms: 1, looked: 1, changed: 0, failed: 0 });
    // The site's robots.txt, then the page: one request for the page.
    assert.deepEqual(askedFor, [`https://${HOST}/robots.txt`, PAGE]);
    assert.deepEqual(await lawWatchCron(day(0)), { firms: 1, looked: 0, changed: 0, failed: 0 });
    assert.equal(askedFor.length, 2);
    const shown = (await call('GET', '/api/law-watch', { token: owner() })).body;
    assert.equal(shown.sources[0].lastReadAt, day(0).toISOString());
    assert.equal(shown.waiting.length, 0);
  });

  it('finds no change in the same words, whatever the page’s scripts and its last-updated line say that day', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    pages.set(PAGE, { status: 200, body: page(FIRST) });
    assert.deepEqual(await lawWatchCron(day(1)), { firms: 1, looked: 1, changed: 0, failed: 0 });
    assert.equal((await call('GET', '/api/law-watch', { token: owner() })).body.waiting.length, 0);
    assert.equal(modelAsked.length, 0, 'no model is asked about a page that has not changed');
  });

  it('finds a change in new words: the lines that came, both readings kept, and a model’s proposal held to them', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    pages.set(PAGE, { status: 200, body: page([NEW_LINE, ...FIRST.slice(0, 2)]) });
    assert.deepEqual(await lawWatchCron(day(2)), { firms: 1, looked: 1, changed: 1, failed: 0 });
    const shown = (await call('GET', '/api/law-watch', { token: owner() })).body;
    assert.equal(shown.waiting.length, 1);
    const change = shown.waiting[0];
    assert.deepEqual([change.state, change.sourceTitle, change.url, change.seenAt], ['waiting', 'Planning Authority circulars', PAGE, day(2).toISOString()]);
    assert.deepEqual(change.diff.added, [NEW_LINE]);
    assert.deepEqual(change.diff.removed, [FIRST[2]]);
    // The model was sent the lines and the one project the source bears on, and its answer was cut to what it was given.
    assert.equal(modelAsked.length, 1);
    assert.ok(modelAsked[0]!.includes(`+ ${NEW_LINE}`) && modelAsked[0]!.includes('Lake Road offices'));
    assert.equal(change.proposal.quote, NEW_LINE);
    // The lists it picks from were sent, each under a mark.
    assert.ok(modelAsked[0]!.includes('[occupancy] Occupancy certificate') && /\[f1\] /.test(modelAsked[0]!));
    // Its fields, held to the page: the reference and the day the line writes stand; the day and the figure it does not write are gone.
    const occupancy = { kind: 'approval', approval: 'occupancy' };
    assert.deepEqual(change.proposal.fields, { instrument: 'circular', reference: 'Circular 15 of 2026', effectiveFrom: '2026-11-01', change: 'new_requirement', affects: [occupancy] });
    assert.deepEqual(change.proposal.projects, [{ projectId: project.id, actions: [{ department: 'legal', next: 'apply_for_approval', about: occupancy }] }]);
    // No sentence of the model's is kept anywhere: not its summary, its reason for the project, or its instruction.
    const { loadLawWatch } = await import('../apps/api/src/law-watch');
    const { store } = await import('../apps/api/src/store');
    const stored = JSON.stringify(await loadLawWatch(store.data.tenants![0]!.id));
    for (const written of ['A new circular asks for', 'will apply for an occupancy certificate', 'Confirm whether the occupancy', 'Buy something']) assert.ok(!stored.includes(written), written);
    assert.equal(lawChangeSaid(change.proposal.fields), 'Circular Circular 15 of 2026: New requirement, in force from 1 November 2026.');
    assert.deepEqual(change.bearsOn, [{ id: project.id, name: 'Lake Road offices', departments: ['finance', 'legal'] }]);
    const kept = await call('GET', `/api/law-watch/changes/${change.id}/pages`, { token: viewer() });
    assert.ok(kept.body.before.includes(FIRST[2]) && !kept.body.before.includes(NEW_LINE));
    assert.ok(kept.body.after.includes(NEW_LINE) && !kept.body.after.includes(FIRST[2]));
  });

  it('puts nothing on a project for a change that only waits', async () => {
    assert.deepEqual(await actionsOn(), []);
    assert.deepEqual((await call('GET', `/api/projects/${project.id}`, { token: owner() })).body.actions, []);
  });

  it('says why on the source when a page fails, keeps what it read, and is no change the day the page is back', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    pages.set(PAGE, { status: 503, body: 'Service unavailable' });
    assert.deepEqual(await lawWatchCron(day(3)), { firms: 1, looked: 1, changed: 0, failed: 1 });
    let shown = (await call('GET', '/api/law-watch', { token: owner() })).body;
    assert.equal(shown.sources[0].lastError, `${HOST} answered 503.`);
    assert.deepEqual([shown.sources[0].lastLookAt, shown.sources[0].lastReadAt], [day(3).toISOString(), day(2).toISOString()]);
    assert.equal(shown.waiting.length, 1);
    // A shell with nothing to read is a failure too, not a page that lost every circular.
    pages.set(PAGE, { status: 200, body: '<html><body><div id="root"></div><script>draw()</script></body></html>' });
    assert.deepEqual(await lawWatchCron(day(4)), { firms: 1, looked: 1, changed: 0, failed: 1 });
    assert.match((await call('GET', '/api/law-watch', { token: owner() })).body.sources[0].lastError, /gave no words to read/);
    pages.set(PAGE, { status: 200, body: page([NEW_LINE, ...FIRST.slice(0, 2)]) });
    assert.deepEqual(await lawWatchCron(day(5)), { firms: 1, looked: 1, changed: 0, failed: 0 });
    shown = (await call('GET', '/api/law-watch', { token: owner() })).body;
    assert.equal(shown.sources[0].lastError, undefined);
    assert.equal(shown.waiting.length, 1);
  });

  it('keeps off a path the site’s robots.txt disallows, and says so', async () => {
    pages.set(`https://${SHY}/robots.txt`, { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /orders/\n' });
    pages.set(`https://${SHY}/orders/latest`, { status: 200, body: page(FIRST) });
    const added = await call('POST', '/api/law-watch/sources', { token: owner(), body: sourceBody({ title: 'Orders of a shy site', url: `https://${SHY}/orders/latest` }) });
    const shy = added.body.sources.find((source: LawSource) => source.url.includes(SHY)).id;
    const before = askedFor.length;
    const looked = await call('POST', `/api/law-watch/sources/${shy}/look`, { token: owner() });
    assert.equal(looked.status, 200);
    assert.match(looked.body.said, /asks automated readers to keep off this page \(robots\.txt\)/);
    assert.deepEqual(askedFor.slice(before), [`https://${SHY}/robots.txt`], 'the page itself was never asked for');
    assert.equal(looked.body.sources.find((source: LawSource) => source.id === shy).hash, undefined);
    assert.equal((await call('DELETE', `/api/law-watch/sources/${shy}`, { token: owner() })).status, 200);
  });
});

describe('who may do what', () => {
  /** Every way the watch is changed, each as a request that would change it. */
  const writes = (changeId: string): Array<{ name: string; method: string; route: string; body?: unknown }> => [
    { name: 'add a source', method: 'POST', route: '/api/law-watch/sources', body: sourceBody({ url: `https://${HOST}/another` }) },
    { name: 'change a source', method: 'PUT', route: `/api/law-watch/sources/${sourceId}`, body: sourceBody({ paused: true }) },
    { name: 'remove a source', method: 'DELETE', route: `/api/law-watch/sources/${sourceId}` },
    { name: 'look now', method: 'POST', route: `/api/law-watch/sources/${sourceId}/look` },
    { name: 'confirm', method: 'POST', route: `/api/law-watch/changes/${changeId}/confirm`, body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', next: 'read_change' }] }] } },
    { name: 'dismiss', method: 'POST', route: `/api/law-watch/changes/${changeId}/dismiss`, body: { why: 'Not ours' } },
  ];

  for (const [who, token] of [['somebody working from a grant', contractor], ['a viewer', viewer]] as const) {
    it(`refuses ${who} every change, and nothing is done`, async () => {
      const was = (await call('GET', '/api/law-watch', { token: owner() })).body;
      const asked = askedFor.length;
      for (const { name, method, route, body } of writes(was.waiting[0].id)) {
        const answer = await call(method, route, { token: token(), body });
        assert.equal(answer.status, 403, `${name}: ${JSON.stringify(answer.body)}`);
        assert.equal(answer.body.sources, undefined, `${name} hands back no list`);
      }
      assert.deepEqual((await call('GET', '/api/law-watch', { token: owner() })).body, was);
      assert.deepEqual(await actionsOn(), []);
      assert.equal(askedFor.length, asked, 'no page was asked for');
    });
  }

  it('shows the watch to a viewer and not to somebody working from a grant', async () => {
    const seen = await call('GET', '/api/law-watch', { token: viewer() });
    assert.deepEqual([seen.status, seen.body.mayManage, seen.body.mayReview, seen.body.waiting[0].bearsOn.length], [200, false, false, 0]);
    const refused = await call('GET', '/api/law-watch', { token: contractor() });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.sources, undefined);
    const change = seen.body.waiting[0].id;
    assert.equal((await call('GET', `/api/law-watch/changes/${change}/pages`, { token: contractor() })).status, 403);
    for (const route of ['/api/law-watch', `/api/law-watch/changes/${change}/pages`]) assert.equal((await call('GET', route)).status, 401, route);
  });

  it('lets a department’s lead review, but not change the list, and only for the department they lead', async () => {
    const seen = (await call('GET', '/api/law-watch', { token: lead() })).body;
    assert.deepEqual([seen.mayManage, seen.mayReview], [false, true]);
    assert.deepEqual(seen.waiting[0].bearsOn, [{ id: project.id, name: 'Lake Road offices', departments: ['legal'] }]);
    assert.equal((await call('POST', `/api/law-watch/sources/${sourceId}/look`, { token: lead() })).status, 403);
    // One action theirs and one not: the whole confirmation is refused and neither is written.
    const mixed = await call('POST', `/api/law-watch/changes/${seen.waiting[0].id}/confirm`, { token: lead(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', next: 'read_change' }, { department: 'finance', next: 'read_change' }] }] } });
    assert.equal(mixed.status, 403, JSON.stringify(mixed.body));
    assert.match(mixed.body.error, /Finance needs a firm admin or that department’s lead/);
    assert.deepEqual(await actionsOn(), []);
    assert.equal((await call('GET', '/api/law-watch', { token: owner() })).body.waiting.length, 1);
  });
});

describe('a person’s decision', () => {
  it('refuses a confirmation that names a project that is not the firm’s, a department the source is not for, or no kind of change', async () => {
    const changeId = (await call('GET', '/api/law-watch', { token: owner() })).body.waiting[0].id;
    const at = `/api/law-watch/changes/${changeId}/confirm`;
    assert.equal((await call('POST', at, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: 'nobody’s', actions: [{ department: 'legal', next: 'read_change' }] }] } })).status, 404);
    assert.equal((await call('POST', at, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'procurement', next: 'read_change' }] }] } })).status, 400);
    assert.equal((await call('POST', at, { token: owner(), body: { fields: { affects: [] }, projects: [] } })).status, 400);
    // A summary, an instruction, a next step off no list, a field that does not exist: none is a thing to send.
    assert.equal((await call('POST', at, { token: owner(), body: { ['summary']: 'A new circular.', projects: [] } })).status, 400);
    assert.equal((await call('POST', at, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', ['title']: 'Read the circular' }] }] } })).status, 400);
    assert.equal((await call('POST', at, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', next: 'write_to_them' }] }] } })).status, 400);
    assert.equal((await call('POST', at, { token: owner(), body: { fields: { ...FIELDS, affects: [{ kind: 'field', address: { fn: 'legal.title', set: 'no.such.set', field: 'nothing' } }] }, projects: [] } })).status, 400);
    assert.equal((await call('POST', '/api/law-watch/changes/no-such-change/confirm', { token: owner(), body: { fields: FIELDS, projects: [] } })).status, 404);
    assert.deepEqual(await actionsOn(), []);
  });

  it('on confirm, puts the actions on the project with the link, the day seen and who confirmed, with words made from the fields the person left', async () => {
    const waiting = (await call('GET', '/api/law-watch', { token: lead() })).body.waiting[0];
    const confirmed = await call('POST', `/api/law-watch/changes/${waiting.id}/confirm`, {
      token: lead(),
      body: { fields: waiting.proposal.fields, projects: [{ projectId: project.id, actions: waiting.proposal.projects[0].actions }] },
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.waiting.length, 0);
    const decided = confirmed.body.decided[0];
    assert.deepEqual([decided.state, decided.decidedBy, decided.applied.length, decided.applied[0].projectName, decided.applied[0].actionIds.length], ['confirmed', 'lena@builders.example', 1, 'Lake Road offices', 1]);
    const actions = await actionsOn();
    assert.equal(actions.length, 1);
    // The action's words are the template's: the next step and what it is about.
    assert.equal(actions[0]!.title, 'Apply for the approval: Occupancy certificate');
    assert.equal(actions[0]!.owner, 'Legal lead');
    const says = actions[0]!.description ?? '';
    assert.ok(says.startsWith('Circular Circular 15 of 2026: New requirement, in force from 1 November 2026.'), says);
    assert.deepEqual(decided.fields, { instrument: 'circular', reference: 'Circular 15 of 2026', effectiveFrom: '2026-11-01', change: 'new_requirement', affects: [{ kind: 'approval', approval: 'occupancy' }] });
    assert.equal(decided.summary, undefined);
    assert.ok(says.includes(`Source: Planning Authority circulars, ${PAGE}. Change seen on 14 October 2026.`), says);
    assert.match(says, /Confirmed by lena@builders\.example on \d+ \w+ \d{4}\./);
    assert.ok(says.includes('Not legal advice.'));
    // The project's own trail names who put it there.
    const { store } = await import('../apps/api/src/store');
    const trail = store.data.projects!.find((held) => held.id === project.id)!.audit.filter((event) => event.entityType === 'action');
    assert.deepEqual(trail.map((event) => event.actor), ['lena@builders.example']);
  });

  it('answers 409 to a second decision on the same change, and adds nothing', async () => {
    const decided = (await call('GET', '/api/law-watch', { token: owner() })).body.decided[0];
    assert.equal((await call('POST', `/api/law-watch/changes/${decided.id}/confirm`, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', next: 'read_change' }] }] } })).status, 409);
    assert.equal((await call('POST', `/api/law-watch/changes/${decided.id}/dismiss`, { token: owner(), body: {} })).status, 409);
    assert.equal((await actionsOn()).length, 1);
  });

  it('on dismiss, puts nothing on any project and keeps who dismissed it and why', async () => {
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    pages.set(PAGE, { status: 200, body: page([NEW_LINE, ...FIRST.slice(0, 2), 'Notice: the office is closed on 2 November 2026 for a local holiday in the district.']) });
    assert.deepEqual(await lawWatchCron(day(6)), { firms: 1, looked: 1, changed: 1, failed: 0 });
    const waiting = (await call('GET', '/api/law-watch', { token: owner() })).body.waiting;
    assert.equal(waiting.length, 1);
    const dismissed = await call('POST', `/api/law-watch/changes/${waiting[0].id}/dismiss`, { token: owner(), body: { why: 'A holiday notice' } });
    assert.equal(dismissed.status, 200);
    assert.deepEqual([dismissed.body.waiting.length, dismissed.body.decided[0].state, dismissed.body.decided[0].decidedBy, dismissed.body.decided[0].why], [0, 'dismissed', 'dev@builders.example', 'A holiday notice']);
    assert.equal(dismissed.body.decided[0].applied, undefined);
    assert.equal((await actionsOn()).length, 1);
  });
});

describe('a change that bears on two projects', () => {
  let other: DdProject;
  let changeId = '';
  const HEARING = 'Circular 16 of 2026: public hearings for layouts above ten acres are to be held within the taluk from 1 December 2026.';
  const watch = async (token: () => string) => (await call('GET', '/api/law-watch', { token: token() })).body;

  before(async () => {
    const { store } = await import('../apps/api/src/store');
    const { lawWatchCron } = await import('../apps/api/src/cron/law-watch');
    other = createProject({ name: 'Canal Road homes', type: 'residential', location: 'Canal Road', city: 'Mysuru' }, 'RYT-LW2');
    other.tenantId = tenantId;
    // Led in Legal by somebody whose firm role lets them read and no more, and not by the lead of the first project.
    setTeamMember(other, { email: 'vera@builders.example', departments: { legal: 'lead' } }, 'dev@builders.example');
    setTeamMember(other, { email: 'lena@builders.example', departments: { legal: 'viewer', finance: 'viewer' } }, 'dev@builders.example');
    store.data.projects!.push(other);
    await store.save();
    pages.set(PAGE, { status: 200, body: page([HEARING, NEW_LINE, ...FIRST.slice(0, 2), 'Notice: the office is closed on 2 November 2026 for a local holiday in the district.']) });
    assert.deepEqual(await lawWatchCron(day(8)), { firms: 1, looked: 1, changed: 1, failed: 0 });
    const shown = await watch(owner);
    changeId = shown.waiting[0].id;
    assert.deepEqual(shown.waiting[0].bearsOn.map((held: { name: string }) => held.name).sort(), ['Canal Road homes', 'Lake Road offices']);
  });

  it('is not decided by a lead whose firm role only reads: confirming and dismissing take somebody who may change a record', async () => {
    assert.equal((await watch(viewer)).mayReview, true, 'the team list names them a lead');
    for (const [route, body] of [['confirm', { fields: FIELDS, projects: [{ projectId: other.id, actions: [{ department: 'legal', next: 'read_change' }] }] }], ['dismiss', { why: 'Not ours' }]] as const) {
      const answer = await call('POST', `/api/law-watch/changes/${changeId}/${route}`, { token: viewer(), body });
      assert.equal(answer.status, 403, `${route}: ${JSON.stringify(answer.body)}`);
    }
    const shown = await watch(owner);
    assert.deepEqual([shown.waiting.length, shown.waiting[0].decidedFor], [1, undefined]);
    const { store } = await import('../apps/api/src/store');
    assert.deepEqual(store.data.projects!.find((held) => held.id === other.id)!.actions, []);
  });

  it('is dismissed by one project’s lead for that project alone: it waits on for the other, whose lead was never asked', async () => {
    const mine = (await watch(lead)).waiting[0];
    assert.deepEqual([mine.mayDecide, mine.bearsOn.map((held: { name: string }) => held.name)], [true, ['Lake Road offices']]);
    // They may put nothing on the project they do not lead.
    const reaching = await call('POST', `/api/law-watch/changes/${changeId}/confirm`, { token: lead(), body: { fields: FIELDS, projects: [{ projectId: other.id, actions: [{ department: 'legal', next: 'read_change' }] }] } });
    assert.equal(reaching.status, 403, JSON.stringify(reaching.body));

    const dismissed = await call('POST', `/api/law-watch/changes/${changeId}/dismiss`, { token: lead(), body: { why: 'No layout on Lake Road' } });
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
    const shown = await watch(owner);
    assert.equal(shown.waiting.length, 1, 'the change still waits');
    assert.deepEqual(
      shown.waiting[0].decidedFor.map((held: { projectName: string; decision: string; by: string; why?: string }) => [held.projectName, held.decision, held.by, held.why]),
      [['Lake Road offices', 'dismissed', 'lena@builders.example', 'No layout on Lake Road']],
    );
    assert.deepEqual(shown.waiting[0].bearsOn.map((held: { name: string }) => held.name), ['Canal Road homes'], 'and only the other project is still to decide');

    // Their part is done: they are offered nothing more, and a second decision by them is refused.
    const after = (await watch(lead)).waiting[0];
    assert.deepEqual([after.mayDecide, after.bearsOn], [false, []]);
    assert.equal((await call('POST', `/api/law-watch/changes/${changeId}/dismiss`, { token: lead(), body: {} })).status, 403);
    assert.equal((await call('POST', `/api/law-watch/changes/${changeId}/confirm`, { token: lead(), body: { fields: FIELDS, projects: [] } })).status, 403);
  });

  it('is closed by a firm admin, who cannot put an action on the project already decided', async () => {
    const twice = await call('POST', `/api/law-watch/changes/${changeId}/confirm`, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: project.id, actions: [{ department: 'legal', next: 'read_change' }] }] } });
    assert.equal(twice.status, 409, JSON.stringify(twice.body));
    assert.match(twice.body.error, /decided for Lake Road offices already/);
    assert.equal((await actionsOn()).length, 1, 'nothing more on the first project');

    const closed = await call('POST', `/api/law-watch/changes/${changeId}/confirm`, { token: owner(), body: { fields: FIELDS, projects: [{ projectId: other.id, actions: [{ department: 'legal', next: 'read_change' }] }] } });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.waiting.length, 0);
    const decided = closed.body.decided[0];
    assert.deepEqual([decided.state, decided.decidedBy, decided.applied.map((held: { projectName: string }) => held.projectName)], ['confirmed', 'dev@builders.example', ['Canal Road homes']]);
    const { store } = await import('../apps/api/src/store');
    assert.deepEqual(store.data.projects!.find((held) => held.id === other.id)!.actions.map((action) => action.title), ['Read the change and decide what it asks']);
  });

  it('is closed without an admin once the lead of every project it bears on has decided, and no action is put on a project twice', () => {
    const a = createProject({ name: 'Mill Lane flats', type: 'residential', location: 'Mill Lane', city: 'Bengaluru' }, 'RYT-LW3');
    const b = createProject({ name: 'Weir Road flats', type: 'residential', location: 'Weir Road', city: 'Bengaluru' }, 'RYT-LW4');
    setTeamMember(a, { email: 'asha@builders.example', departments: { legal: 'lead' } }, 'dev@builders.example');
    setTeamMember(b, { email: 'bala@builders.example', departments: { legal: 'lead' } }, 'dev@builders.example');
    const source: LawSource = { id: 'src', title: 'Circulars', url: PAGE, jurisdiction: 'Karnataka', governs: 'Layouts', departments: ['legal'], projectKinds: [], everyDays: 1, addedBy: 'dev@builders.example', addedAt: day(0).toISOString() };
    const change: LawChange = { id: 'chg', sourceId: 'src', sourceTitle: 'Circulars', url: PAGE, seenAt: day(0).toISOString(), diff: { added: [HEARING], removed: [], addedCount: 1, removedCount: 0 }, state: 'waiting' };
    const state: LawWatchState = { v: 1, sources: [source], changes: [change] };
    const asha = { email: 'asha@builders.example', role: 'staff' as const };
    const bala = { email: 'bala@builders.example', role: 'staff' as const };
    const act = (projectId: string) => ({ fields: FIELDS, projects: [{ projectId, actions: [{ department: 'legal' as const, next: 'read_change' as const }] }] });

    confirmLawChange(state, 'chg', act(a.id), asha, [a, b], day(1).toISOString());
    assert.deepEqual([change.state, a.actions.length, change.decidedFor!.map((held) => held.projectName)], ['waiting', 1, ['Mill Lane flats']]);
    // The same confirmation again, as a look that wrote back an old list once let through: refused, and nothing added.
    assert.throws(() => confirmLawChange(state, 'chg', act(a.id), asha, [a, b], day(1).toISOString()), /needs a firm admin/);
    assert.throws(() => confirmLawChange(state, 'chg', act(a.id), bala, [a, b], day(1).toISOString()), /needs a firm admin/);
    assert.equal(a.actions.length, 1);

    dismissLawChange(state, 'chg', bala, 'No layout here', day(2).toISOString(), [a, b]);
    assert.deepEqual([change.state, change.decidedBy, change.applied!.map((held) => [held.projectName, held.actionIds.length])], ['confirmed', 'bala@builders.example', [['Mill Lane flats', 1]]]);
    assert.equal(b.actions.length, 0);
  });
});

describe('a look with no model, and other kinds of page', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

  function fake(answers: Record<string, () => Response>, seen: string[] = []) {
    return {
      seen,
      deps: {
        fetch: (async (input: unknown) => {
          seen.push(String(input));
          return (answers[String(input)] ?? (() => new Response('', { status: 404 })))();
        }) as typeof fetch,
        reachable: async (url: string) => {
          if (url.includes('inside.example.test')) throw new Error('inside.example.test resolves to 10.0.0.7, which is inside this deployment’s own network.');
        },
        pdfText: async (bytes: Uint8Array) => (bytes[0] === 0x25 ? 'Gazette notification. '.repeat(10) + 'Rule 4 is substituted with effect from 1 December 2026.' : ''),
      },
    };
  }

  const source = (url: string): LawSource => ({ id: 'gazette', title: 'Gazette', url, jurisdiction: 'India', governs: 'Rules', departments: ['legal'], projectKinds: [], everyDays: 1, addedBy: 'tester', addedAt: day(0).toISOString() });

  it('shows the change with its lines and no proposal, and asks no model', async () => {
    const { lookAtLawSource } = await import('../apps/api/src/law-watch');
    const state = { v: 1 as const, sources: [source('https://gazette.example.test/rules')], changes: [] };
    let words = FIRST;
    const { deps } = fake({ 'https://gazette.example.test/rules': () => new Response(page(words), { status: 200, headers: { 'content-type': 'text/html' } }) });
    assert.equal((await lookAtLawSource('solo', state, state.sources[0]!, day(0), deps)).outcome, 'first');
    assert.equal((await lookAtLawSource('solo', state, state.sources[0]!, day(1), deps)).outcome, 'same');
    words = [...FIRST, NEW_LINE];
    const asked = modelAsked.length;
    const look = await lookAtLawSource('solo', state, state.sources[0]!, day(2), deps);
    assert.equal(look.outcome, 'changed');
    assert.deepEqual(look.change!.diff, { added: [NEW_LINE], removed: [], addedCount: 1, removedCount: 0 });
    assert.equal(look.change!.proposal, undefined);
    assert.equal(state.changes.length, 1);
    assert.equal(modelAsked.length, asked);
  });

  it('keeps what a person decided, changed or took off the list while a look was under way', async () => {
    const { lookAtLawSources, loadLawWatch, saveLawWatch } = await import('../apps/api/src/law-watch');
    const admin = { email: 'dev@builders.example', role: 'owner' as const };
    const waits = (id: string): LawChange => ({ id, sourceId: 'gazette', sourceTitle: 'Gazette', url: 'https://gazette.example.test/rules', seenAt: day(0).toISOString(), diff: { added: ['Rule 9 is new.'], removed: [], addedCount: 1, removedCount: 0 }, state: 'waiting' });
    const gone: LawSource = { ...source('https://gazette.example.test/orders'), id: 'orders', title: 'Orders' };
    await saveLawWatch('firm-mid-look', { v: 1, sources: [source('https://gazette.example.test/rules'), gone], changes: [waits('earlier'), waits('another')] });
    let words = FIRST;
    const { deps } = fake({
      'https://gazette.example.test/rules': () => new Response(page(words), { status: 200, headers: { 'content-type': 'text/html' } }),
      'https://gazette.example.test/orders': () => new Response(page(FIRST), { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    assert.deepEqual([(await lookAtLawSources('firm-mid-look', day(1), { deps })).looked, (await loadLawWatch('firm-mid-look')).changes.length], [2, 2]);

    // The next look finds a change. While it is fetching, an admin on another instance confirms one change, dismisses the other, renames the source and takes the second source off the list.
    words = [...FIRST, NEW_LINE];
    const meanwhile: typeof fetch = async (input, init) => {
      if (String(input) === 'https://gazette.example.test/rules') {
        const held = await loadLawWatch('firm-mid-look');
        confirmLawChange(held, 'earlier', { fields: FIELDS, projects: [] }, admin, [], day(2).toISOString());
        dismissLawChange(held, 'another', admin, 'Not ours', day(2).toISOString());
        held.sources.find((one) => one.id === 'gazette')!.title = 'Gazette of the State';
        held.sources = held.sources.filter((one) => one.id !== 'orders');
        await saveLawWatch('firm-mid-look', held);
      }
      return deps.fetch(input, init);
    };
    const run = await lookAtLawSources('firm-mid-look', day(3), { deps: { ...deps, fetch: meanwhile } });
    assert.deepEqual([run.looked, run.changed], [2, 1]);

    const kept = await loadLawWatch('firm-mid-look');
    assert.deepEqual(kept.changes.map((change) => [change.id === 'earlier' || change.id === 'another' ? change.id : 'new', change.state]), [['new', 'waiting'], ['earlier', 'confirmed'], ['another', 'dismissed']]);
    assert.equal(kept.changes[0]!.diff.added[0], NEW_LINE, 'what the look found is kept beside them');
    assert.deepEqual(kept.sources.map((one) => [one.id, one.title, one.lastReadAt]), [['gazette', 'Gazette of the State', day(3).toISOString()]], 'the source as the person left it, with what the look read');
    // So a decision made meanwhile is made once: deciding it again is refused.
    assert.throws(() => confirmLawChange(kept, 'earlier', { fields: FIELDS, projects: [] }, admin, [], day(4).toISOString()), /confirmed already/);
  });

  it('reads a PDF through the PDF reader, follows a move to another https address, and refuses the rest', async () => {
    const { readLawPage, LawLookFailed } = await import('../apps/api/src/law-watch');
    const { deps, seen } = fake({
      'https://gazette.example.test/old': () => new Response(null, { status: 301, headers: { location: 'https://gazette.example.test/rules.pdf' } }),
      'https://gazette.example.test/rules.pdf': () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }),
      'https://gazette.example.test/inward': () => new Response(null, { status: 302, headers: { location: 'https://inside.example.test/admin' } }),
      'https://gazette.example.test/down': () => new Response(null, { status: 302, headers: { location: 'http://gazette.example.test/plain' } }),
      'https://gazette.example.test/loop': () => new Response(null, { status: 302, headers: { location: 'https://gazette.example.test/loop' } }),
      'https://gazette.example.test/picture': () => new Response('GIF89a', { status: 200, headers: { 'content-type': 'image/gif' } }),
      'https://gazette.example.test/huge': () => new Response('x', { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(40 * 1024 * 1024) } }),
    });
    assert.match(await readLawPage('https://gazette.example.test/old', deps), /Rule 4 is substituted with effect from 1 December 2026\./);
    for (const [address, why] of [
      ['https://gazette.example.test/inward', /inside this deployment/],
      ['https://gazette.example.test/down', /not https/],
      ['https://gazette.example.test/loop', /keeps moving/],
      ['https://gazette.example.test/picture', /image\/gif, which is not read/],
      ['https://gazette.example.test/huge', /larger than 3 MB/],
      ['https://gazette.example.test/gone', /answered 404/],
    ] as const) {
      await assert.rejects(readLawPage(address, deps), (err: Error) => err instanceof LawLookFailed && why.test(err.message), address);
    }
    assert.ok(!seen.includes('https://inside.example.test/admin'), 'an address inside the network is never asked for');
    assert.ok(!seen.includes('http://gazette.example.test/plain'));
    // The reader names itself on every request.
    const named: string[] = [];
    await readLawPage('https://gazette.example.test/rules.pdf', { ...deps, fetch: (async (input: unknown, init?: RequestInit) => (named.push(String(new Headers(init?.headers).get('user-agent'))), deps.fetch(input as string, init))) as typeof fetch });
    assert.ok(named.length === 2 && named.every((agent) => agent.startsWith('RealyticaLawWatch/1.0')), named.join(' | '));
  });
});

describe('the rules a look rests on', () => {
  it('reads robots.txt by the group that names the reader, else everybody’s, longest rule first', () => {
    const everybody = 'User-agent: *\nDisallow: /private/\nAllow: /private/open\n\nUser-agent: OtherBot\nDisallow: /\n';
    assert.equal(robotsDisallows(everybody, 'RealyticaLawWatch', '/private/orders'), true);
    assert.equal(robotsDisallows(everybody, 'RealyticaLawWatch', '/private/open/1'), false);
    assert.equal(robotsDisallows(everybody, 'RealyticaLawWatch', '/circulars'), false);
    assert.equal(robotsDisallows('User-agent: *\nDisallow:\n\nUser-agent: RealyticaLawWatch\nDisallow: /\n', 'RealyticaLawWatch', '/circulars'), true);
    assert.equal(robotsDisallows('User-agent: *\nDisallow: /*.pdf$\n', 'RealyticaLawWatch', '/a/b.pdf'), true);
    assert.equal(robotsDisallows('User-agent: *\nDisallow: /*.pdf$\n', 'RealyticaLawWatch', '/a/b.pdf?x=1'), false);
    assert.equal(robotsDisallows('User-agent: *\nDisallow:', 'RealyticaLawWatch', '/anything'), false);
    assert.equal(robotsDisallows('<html><title>Error</title></html>', 'RealyticaLawWatch', '/anything'), false);
  });

  it('turns a page into the same words however it was served', () => {
    const a = lawPageText('<html><head><style>p{}</style></head><body><p>Rule&nbsp;4 &amp; Rule 5</p><script>t=1</script><p>Visitors: 10,442</p><p>12-10-2026</p></body></html>', 'html');
    const b = lawPageText('<html><body>\n<p>Rule 4   &amp; Rule 5</p><script>t=2</script><p>Visitors: 10,443</p><p>13-10-2026</p></body></html>', 'html');
    assert.equal(a, 'Rule 4 & Rule 5');
    assert.equal(a, b);
    // A counter and a date in another script, on one line, as a ministry's footer writes them.
    assert.equal(lawPageText('<p>Rule 4 &amp; Rule 5</p><p>आगंतुक : 2347944 / अद्यतन: 12-10-2026</p>', 'html'), a);
    assert.equal(lawPageText('<p>Visitors to the site must register under Rule 9</p>', 'html'), 'Visitors to the site must register under Rule 9');
  });

  it('leaves out what a site serves afresh on every visit: a dated footer, a counter, a clock, in English and Hindi, wherever on the line it is', () => {
    const read = (line: string): string => lawPageText(`<p>Rule 4 &amp; Rule 5</p><p>${line}</p>`, 'html');
    for (const [monday, nextMonday] of [
      ['Last Updated: 12 Oct 2026', 'Last Updated: 19 Oct 2026'],
      ['Last Updated: Oct 12, 2026', 'Last Updated: Oct 19, 2026'],
      ['Last updated on Monday, 12 October 2026', 'Last updated on Tuesday, 20 October 2026'],
      ['Visitor Counter : 0012399', 'Visitor Counter : 0012456'],
      ['You are visitor number 123999', 'You are visitor number 124001'],
      ['Mon, 12 Oct 2026 11:01:09 IST', 'Mon, 19 Oct 2026 09:14:55 IST'],
      ['अंतिम अद्यतन: 12 अक्टूबर 2026', 'अंतिम अद्यतन: 19 अक्टूबर 2026'],
      ['अंतिम अद्यतन: सोमवार, 12 अक्तूबर 2026', 'अंतिम अद्यतन: मंगलवार, 3 नवंबर 2026'],
      ['आगंतुक संख्या: 2347944', 'आगंतुक संख्या: 2348011'],
    ] as const) {
      assert.equal(read(monday), 'Rule 4 & Rule 5', monday);
      assert.equal(read(nextMonday), 'Rule 4 & Rule 5', nextMonday);
    }
    // A footer with the owner's name before what is served keeps the name and nothing after it.
    assert.equal(read('Content owned by the Ministry Last Updated: 12/10/2026 Visitors: 200'), 'Rule 4 & Rule 5\nContent owned by the Ministry');
    assert.equal(read('Content owned by the Ministry | Last Updated: 19 Oct 2026 | Visitors: 311'), 'Rule 4 & Rule 5\nContent owned by the Ministry');
    assert.deepEqual(lawTextDiff(read('Content owned by the Ministry Last Updated: 12/10/2026 Visitors: 200'), read('Content owned by the Ministry Last Updated: 19/10/2026 Visitors: 311')), { added: [], removed: [], addedCount: 0, removedCount: 0 });
    // What states something is kept whole: a date with no served word beside it may be the day a rule was made.
    for (const kept of ['12 October 2026', 'Notified on 12 October 2026', 'Hearing on Monday 12 October 2026 at the taluk office', 'Rules for visitors to eco-sensitive zones, 2026', 'The exhibits 12 and 14 are annexed', 'Guidelines last updated on 12 October 2026 apply to plots above 4,000 square metres', 'सोमवार 12 अक्टूबर 2026 को सुनवाई']) {
      assert.equal(read(kept), `Rule 4 & Rule 5\n${kept}`, kept);
    }
  });

  it('cuts a very long page at a whole line, says so, and reads nothing into the lines at the cut', () => {
    const list = (from: number, to: number): string[] => Array.from({ length: to - from }, (_, n) => `Notification number ${from + n} regarding environmental clearance for a project in the district`);
    const before = lawPageText(list(0, 9000).join('\n'), 'text');
    assert.ok(before.length <= LAW_TEXT_AT_MOST);
    const lines = before.split('\n');
    assert.equal(lines.at(-1), LAW_TEXT_CUT, 'a page that goes on says so');
    assert.match(lines.at(-2)!, /^Notification number \d+ regarding environmental clearance for a project in the district$/, 'and stops at a whole line');

    // One line added at the top pushes lines past the cut: the one added is the change, and those are not.
    const added = lawPageText(['A new notification is published at the head of the list', ...list(0, 9000)].join('\n'), 'text');
    assert.deepEqual(lawTextDiff(before, added), { added: ['A new notification is published at the head of the list'], removed: [], addedCount: 1, removedCount: 0 });
    // One line removed at the top brings lines into reach: the one removed is the change, and those are not.
    const removed = lawPageText(list(1, 9000).join('\n'), 'text');
    assert.deepEqual(lawTextDiff(before, removed), { added: [], removed: [list(0, 1)[0]], addedCount: 0, removedCount: 1 });
    // A page kept before the cut was at a whole line stops mid-line at the limit: its half line is no change either.
    const old = list(0, 9000).join('\n').slice(0, LAW_TEXT_AT_MOST);
    assert.deepEqual(lawTextDiff(old, before), { added: [], removed: [], addedCount: 0, removedCount: 0 });
    // A short page is not touched, and a change at its end is a change.
    assert.equal(lawPageText('one\ntwo', 'text'), 'one\ntwo');
    assert.deepEqual(lawTextDiff('one\ntwo', 'one\nthree'), { added: ['three'], removed: ['two'], addedCount: 1, removedCount: 1 });
  });

  it('calls a line that only moved no change', () => {
    assert.deepEqual(lawTextDiff('one\ntwo\nthree', 'three\none\ntwo'), { added: [], removed: [], addedCount: 0, removedCount: 0 });
    assert.deepEqual(lawTextDiff('one\ntwo', 'one\ntwo\ntwo'), { added: ['two'], removed: [], addedCount: 1, removedCount: 0 });
  });
});
