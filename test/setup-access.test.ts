/**
 * Who may read Set up, over real HTTP with sign-in on.
 *
 * `GET /api/setup` is the one route this page added. It is read-only and
 * says what is connected: the firm's own people read it, keys and webhooks
 * are in it for a firm admin only, and somebody working from a grant is
 * refused. Three people sign in, as in `checklist-access.test.ts`: the
 * firm's owner, one of its staff, and a contractor working from a grant.
 * The firm, the people and the project are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createProject, setReportDay, type DdProject, type ProjectGrant, type SetupShown } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-setup';
const ISSUER = 'https://securetoken.google.com/realytica-setup';
const AUDIENCE = 'realytica-setup';

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

async function call(method: string, route: string, opts: { token?: string; authorization?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const authorization = opts.authorization ?? (opts.token ? `Bearer ${opts.token}` : undefined);
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
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
const staff = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-setup-access-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  assert.equal((await call('GET', '/api/members', { token: staff() })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: contractor() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-SA1');
  project.tenantId = tenantId;
  setReportDay(project, { day: 5, reports: ['owner_pack'], every: 'month', tell: [] }, 'dev@builders.example');
  // A project of another firm is nobody's here to see.
  const other = createProject({ name: 'Somebody else’s tower', type: 'commercial', location: 'Far Road', city: 'Kadamba' }, 'RYT-SA2');
  other.tenantId = 'tnt_other';
  store.data.projects!.push(project, other);
  const grant: ProjectGrant = { id: 'grant-sam', tenantId, projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: 'dev@builders.example' };
  store.data.grants = [grant];
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL']) delete process.env[name];
});

describe('GET /api/setup', () => {
  it('is not read without a sign-in', async () => {
    assert.equal((await call('GET', '/api/setup')).status, 401);
  });

  it('refuses somebody working from a grant, and tells them nothing of what the firm has connected', async () => {
    const res = await call('GET', '/api/setup', { token: contractor() });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'Set up is for the firm’s own people.' });
  });

  it('gives the firm’s staff every row but keys and webhooks, which are a firm admin’s', async () => {
    const res = await call('GET', '/api/setup', { token: staff() });
    assert.equal(res.status, 200);
    const shown = res.body as SetupShown;
    assert.deepEqual(shown.firm.map((row) => row.key), ['mail', 'request_email', 'request_whatsapp', 'folders', 'timer', 'model', 'law']);
    assert.ok(!JSON.stringify(shown).includes('webhook'));
  });

  it('gives a firm admin keys and webhooks too, and each of the firm’s projects and no other firm’s', async () => {
    const res = await call('GET', '/api/setup', { token: owner() });
    assert.equal(res.status, 200);
    const shown = res.body as SetupShown;
    assert.deepEqual(shown.firm.map((row) => row.key), ['mail', 'request_email', 'request_whatsapp', 'folders', 'timer', 'model', 'law', 'keys', 'webhooks']);
    // Nothing is given to this deployment, so everything it could reach outside is not set up, and says what is needed.
    for (const key of ['mail', 'request_email', 'request_whatsapp', 'folders', 'timer', 'model']) {
      const row = shown.firm.find((held) => held.key === key)!;
      assert.equal(row.standing, 'not_set_up', key);
      assert.ok(row.needs && row.settings?.length, key);
    }
    assert.equal(shown.firm.find((row) => row.key === 'keys')!.standing, 'not_used');
    assert.deepEqual(shown.projects.map((held) => held.name), ['Lake Road offices']);
    const day = shown.projects[0]!.rows.find((row) => row.key === 'report_day')!;
    // A report day is set, and no timer is: it is said to be doing nothing.
    assert.deepEqual([day.standing, day.needs], ['not_set_up', 'The timer is not set up for the firm yet: see the row above.']);
  });

  it('changes nothing: it answers only to GET', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await call(method, '/api/setup', { token: owner(), body: {} })).status, 404, method);
  });
});
