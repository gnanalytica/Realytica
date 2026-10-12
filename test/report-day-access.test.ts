/**
 * Who may set a report day and keep, issue and reopen an owner pack, over
 * real HTTP with sign-in on, and the timer run against the store with the
 * mail service faked.
 *
 * Three people sign in: the firm's owner, one of the firm's staff who is a
 * viewer in every department of this project, and a contractor working from
 * a grant. Each route is asked by the two who may not, and the project is
 * read back to see that nothing was done.
 *
 * The firm, the people and the project are invented. No mail leaves: the
 * one address the test lets through is the mail service's, and it is
 * answered here.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DEPARTMENT_KEYS, createProject, setTeamMember, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-report-day';
const ISSUER = 'https://securetoken.google.com/realytica-report-day';
const AUDIENCE = 'realytica-report-day';
const ENV = ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_RESEND_API_KEY', 'REALYTICA_APP_URL'];

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

function jwkOf(key: KeyObject) {
  return { ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
}

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;
/** Every email the mail service was asked to send. */
const mailed: Array<{ to: string[]; subject: string; text: string; authorization: string; key: string }> = [];

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a body that is not JSON is itself the answer */
  }
  return { status: res.status, body };
}

const owner = () => tokenFor('sub-dev', 'dev@builders.example');
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;
let packId = '';
const at = () => `/api/projects/${project.id}/report-day`;

async function held(): Promise<unknown> {
  const { store } = await import('../apps/api/src/store');
  const now = store.data.projects!.find((p) => p.id === project.id)!;
  return structuredClone({ ownerPacks: now.ownerPacks ?? [], reportDay: now.reportDay ?? {} });
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-report-day-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(input) === 'https://api.resend.com/emails') {
      const headers = init!.headers as Record<string, string>;
      mailed.push({ ...(JSON.parse(String(init!.body)) as { to: string[]; subject: string; text: string }), authorization: headers.authorization!, key: headers['idempotency-key']! });
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(input).startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'vera@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'sam@site.example', role: 'collaborator' } })).status, 201);
  assert.equal((await call('GET', '/api/members', { token: viewer() })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: contractor() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Mill Lane flats', type: 'residential', location: 'Mill Lane', city: 'Kadamba' }, 'RYT-RD2');
  project.tenantId = tenantId;
  setTeamMember(project, { email: 'vera@builders.example', departments: Object.fromEntries(DEPARTMENT_KEYS.map((key) => [key, 'viewer'])) as never }, 'dev@builders.example');
  store.data.projects!.push(project);
  const grant: ProjectGrant = {
    id: 'grant-sam',
    tenantId,
    projectId: project.id,
    email: 'sam@site.example',
    role: 'contributor',
    allAssessments: true,
    assessmentIds: [],
    allScopes: true,
    scopeKeys: [],
    areas: ['reports', 'commercials'],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.example',
  };
  store.data.grants = [grant];
  await store.save();

  // One pack waits, kept by the owner, so the routes that name a pack have one to name.
  const kept = await call('POST', `${at()}/packs`, { token: owner(), body: { month: '2026-09' } });
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  packId = kept.body.pack.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ENV) delete process.env[name];
});

/** Every way the report day and a kept pack are changed, each as a request that would change this project. */
function writes(): Array<{ name: string; method: string; route: string; body?: unknown }> {
  return [
    { name: 'set the day', method: 'PUT', route: at(), body: { day: 1, reports: ['status', 'owner_pack'], every: 'month', tell: ['dev@builders.example'] } },
    { name: 'clear the day', method: 'PUT', route: at(), body: { clear: true } },
    { name: 'keep a pack', method: 'POST', route: `${at()}/packs`, body: { quarter: 'FY2026-Q2' } },
    { name: 'keep and issue a pack', method: 'POST', route: `${at()}/packs`, body: { month: '2026-08', issue: true } },
    { name: 'read a pack again', method: 'POST', route: `${at()}/packs/${packId}/refresh` },
    { name: 'issue a pack', method: 'POST', route: `${at()}/packs/${packId}/issue`, body: { name: 'Somebody' } },
    { name: 'reopen a pack', method: 'POST', route: `${at()}/packs/${packId}/reopen` },
  ];
}

describe('the report day and a kept owner pack', () => {
  it('are refused to a viewer in every department, on every route, and nothing is done', async () => {
    const was = await held();
    for (const { name, method, route, body } of writes()) {
      const answer = await call(method, route, { token: viewer(), body });
      assert.equal(answer.status, 403, `${name}: ${JSON.stringify(answer.body)}`);
      assert.match(answer.body.error, /That needs a lead/);
      assert.equal(answer.body.project, undefined, `${name} hands back no project`);
      assert.deepEqual(await held(), was, `${name} left the project as it was`);
    }
    // Reading is any of the firm's own people's.
    const read = await call('GET', at(), { token: viewer() });
    assert.deepEqual([read.status, read.body.packs.length, read.body.mayPrepare, read.body.mayIssue], [200, 1, false, false]);
  });

  it('are not there at all for somebody working from a grant, reading included', async () => {
    const was = await held();
    assert.equal((await call('GET', at(), { token: contractor() })).status, 404);
    for (const { name, method, route, body } of writes()) {
      const answer = await call(method, route, { token: contractor(), body });
      assert.equal(answer.status, 404, `${name}: ${JSON.stringify(answer.body)}`);
      assert.deepEqual(await held(), was, `${name} left the project as it was`);
    }
    const seen = await call('GET', `/api/projects/${project.id}`, { token: contractor() });
    assert.equal(seen.status, 200);
    assert.deepEqual([seen.body.ownerPacks, seen.body.reportDay], [[], undefined], 'their copy of the project holds no pack and no setting');
    assert.equal((await call('GET', `/api/projects/${project.id}`, { token: viewer() })).body.ownerPacks.length, 1);
  });

  it('are refused to nobody signed in', async () => {
    assert.equal((await call('GET', at())).status, 401);
    for (const { name, method, route, body } of writes()) assert.equal((await call(method, route, { body })).status, 401, name);
  });

  it('refuse a body that is not one, and an address that is not the firm’s', async () => {
    const bad: Array<[string, string, unknown]> = [
      ['PUT', at(), { day: 32, reports: ['status'], every: 'month', tell: [] }],
      ['PUT', at(), { day: 1, reports: [], every: 'month', tell: [] }],
      ['PUT', at(), { day: 1, reports: ['status'], every: 'week', tell: [] }],
      ['PUT', at(), { day: 1, reports: ['status'], every: 'month', tell: ['not-an-address'] }],
      ['PUT', at(), { day: 1, reports: ['status'], every: 'month', tell: [], more: 'x' }],
      ['POST', `${at()}/packs`, {}],
      ['POST', `${at()}/packs`, { month: '2026-13' }],
      ['POST', `${at()}/packs`, { month: '2026-09', quarter: '2026-Q3' }],
      ['POST', `${at()}/packs`, { from: '2026-09-30', to: '2026-09-01' }],
      ['POST', `${at()}/packs/${packId}/issue`, { name: 'x'.repeat(121) }],
    ];
    for (const [method, route, body] of bad) assert.equal((await call(method, route, { token: owner(), body })).status, 400, JSON.stringify(body));
    for (const email of ['owner@client.example', 'sam@site.example']) {
      const outside = await call('PUT', at(), { token: owner(), body: { day: 1, reports: ['status'], every: 'month', tell: [email] } });
      assert.equal(outside.status, 400);
      assert.match(outside.body.error, /Only the firm’s own people are told/);
    }
    assert.equal((await call('POST', `${at()}/packs/opk_none/issue`, { token: owner() })).status, 404);
  });

  it('are open to a lead: the day is set, a pack is issued under their name, stays as issued, and is reopened', async () => {
    const set = await call('PUT', at(), { token: owner(), body: { day: 31, reports: ['status', 'owner_pack'], every: 'quarter', quarters: 'calendar', tell: ['Vera@builders.example'] } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual([set.body.setting.day, set.body.setting.every, set.body.setting.quarters, set.body.setting.tell, set.body.email], [31, 'quarter', 'calendar', ['vera@builders.example'], false]);
    assert.deepEqual(set.body.people.map((person: { email: string }) => person.email).sort(), ['dev@builders.example', 'vera@builders.example'], 'the contractor is not offered');

    const issued = await call('POST', `${at()}/packs/${packId}/issue`, { token: owner(), body: { name: 'Dev Menon' } });
    assert.deepEqual([issued.status, issued.body.pack.status, issued.body.pack.issuedBy, issued.body.pack.issuedName], [200, 'issued', 'dev@builders.example', 'Dev Menon']);
    const frozen = JSON.stringify(issued.body.pack.pack);
    assert.equal((await call('POST', `${at()}/packs/${packId}/refresh`, { token: owner() })).status, 400, 'an issued pack is not read again');
    assert.equal((await call('POST', `${at()}/packs/${packId}/issue`, { token: owner() })).status, 400);

    // The record moves; the pack as issued does not.
    assert.equal((await call('POST', `/api/projects/${project.id}/checklist`, { token: owner(), body: { department: 'finance', title: 'Basic prices of cement' } })).status, 201);
    const after = (await call('GET', at(), { token: owner() })).body.packs.find((pack: { id: string }) => pack.id === packId);
    assert.equal(JSON.stringify(after.pack), frozen);

    // Kept again for the period, a new one waits beside the issued one, and reads the record as it now is.
    const next = await call('POST', `${at()}/packs`, { token: owner(), body: { month: '2026-09' } });
    assert.notEqual(next.body.pack.id, packId);
    assert.match(JSON.stringify(next.body.pack.pack), /Basic prices of cement/);

    const reopened = await call('POST', `${at()}/packs/${packId}/reopen`, { token: owner() });
    assert.deepEqual([reopened.status, reopened.body.pack.status, reopened.body.pack.issuedBy], [200, 'prepared', undefined]);
    assert.equal((await call('POST', `${at()}/packs/${packId}/reopen`, { token: owner() })).status, 400, 'only an issued pack is reopened');

    const fresh = await call('POST', `${at()}/packs`, { token: owner(), body: { quarter: 'FY2026-Q1', issue: true, name: 'Dev Menon' } });
    assert.deepEqual([fresh.status, fresh.body.pack.status, fresh.body.pack.pack.periodSaid], [201, 'issued', 'April to June 2026']);
  });
});

describe('the timer, against the store', () => {
  it('prepares on the day and mails only the firm’s people named, once, and nothing without the mail service', async () => {
    const { reportDay, reportDayEmailSetUp } = await import('../apps/api/src/cron/report-day');
    const { store } = await import('../apps/api/src/store');
    const live = () => store.data.projects!.find((p) => p.id === project.id)!;
    // The setting above: the 31st after each quarter, both reports, Vera told. The contractor's address is put in behind the route's back.
    live().reportDay!.setting!.tell.push('sam@site.example');
    await store.save();

    // No mail service: the reports are prepared, nobody is mailed, and it is said so.
    assert.equal(reportDayEmailSetUp(), false);
    assert.deepEqual(await reportDay(new Date('2026-10-30T07:00:00+05:30')), { projects: 1, prepared: 0, told: 0, failed: 0 }, 'the 30th is not the day');
    assert.deepEqual(await reportDay(new Date('2026-10-31T07:00:00+05:30')), { projects: 1, prepared: 2, told: 0, failed: 0 });
    assert.equal(mailed.length, 0);
    assert.deepEqual(live().reportDay!.prepared!.map((line) => [line.kind, line.from.slice(0, 10), line.told]), [['status', '2026-07-01', []], ['owner_pack', '2026-07-01', []]]);
    assert.equal(live().reports.at(-1)!.title, 'Status report — Mill Lane flats, Q3 2026 (July to September 2026)');
    assert.deepEqual(await reportDay(new Date('2026-10-31T21:00:00+05:30')), { projects: 1, prepared: 0, told: 0, failed: 0 });

    // With it, the next quarter's day: one email, to Vera and not to the contractor, and none on a second run.
    process.env.REALYTICA_RESEND_API_KEY = 'test-key-not-a-real-one';
    process.env.REALYTICA_APP_URL = 'https://app.example.test/';
    assert.equal(reportDayEmailSetUp(), true);
    assert.deepEqual(await reportDay(new Date('2027-01-31T07:00:00+05:30')), { projects: 1, prepared: 2, told: 1, failed: 0 });
    assert.deepEqual(await reportDay(new Date('2027-01-31T08:00:00+05:30')), { projects: 1, prepared: 0, told: 0, failed: 0 });
    assert.equal(mailed.length, 1);
    const mail = mailed[0]!;
    assert.deepEqual(mail.to, ['vera@builders.example']);
    assert.equal(mail.authorization, 'Bearer test-key-not-a-real-one');
    assert.equal(mail.subject, 'Mill Lane flats: 2 reports are ready to check');
    assert.match(mail.text, /Status report, Q4 2026 \(October to December 2026\)/);
    assert.match(mail.text, /Nothing has been issued or sent to anybody outside the firm/);
    assert.match(mail.text, new RegExp(`https://app\\.example\\.test/projects/${project.id}/reports$`));
    assert.match(mail.key, /^report-day\//);
    const waiting = (await call('GET', at(), { token: owner() })).body.waiting;
    assert.ok(waiting.length >= 4, 'each prepared report waits on the Reports page until a person issues it');
  });
});
