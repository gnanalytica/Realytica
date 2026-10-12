/**
 * Who reads the analytics, over real HTTP with sign-in on.
 *
 * Four people sign in: the firm's owner, one of its staff, a viewer, and a
 * contractor working from a grant on the one project. The contractor is
 * refused on every route. The viewer reads the project and department
 * figures and nobody's own. The staff member reads their own and no
 * colleague's. The owner reads the firm's people and never the contractor.
 *
 * The firm, the people, the project and its records are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addAction, addChecklistItems, createProject, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-analytics';
const ISSUER = 'https://securetoken.google.com/realytica-analytics';
const AUDIENCE = 'realytica-analytics';

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
const staff = () => tokenFor('sub-asha', 'asha@builders.example');
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-analytics-access-'));
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

  // The owner signs in first and claims the workspace, then brings in the other three.
  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  for (const [email, role] of [['asha@builders.example', 'staff'], ['vera@builders.example', 'viewer'], ['sam@site.example', 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201);
  }
  for (const token of [staff, viewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-AA1');
  project.tenantId = tenantId;
  addAction(project, { title: 'Get the mother deed', kind: 'clarification', owner: 'asha@builders.example', priority: 'high', dueDate: '2026-01-05' }, 'dev@builders.example');
  addAction(project, { title: 'Send the borehole logs', kind: 'clarification', owner: 'sam@site.example', priority: 'low' }, 'dev@builders.example');
  addChecklistItems(project, 'construction', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }], 'dev@builders.example');
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
    areas: ['decisions', 'commercials', 'site_record'],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.example',
  };
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

const routes = (): string[] => ['/api/analytics/portfolio', `/api/analytics/departments?project=${project.id}`, '/api/analytics/people'];

describe('reading the analytics', () => {
  it('is refused to nobody signed in', async () => {
    for (const route of routes()) assert.equal((await call('GET', route)).status, 401, route);
  });

  it('is refused to somebody working from a grant, on every route, though they reach the project itself', async () => {
    assert.equal((await call('GET', `/api/projects/${project.id}`, { token: contractor() })).status, 200);
    for (const route of routes()) {
      const answer = await call('GET', route, { token: contractor() });
      assert.equal(answer.status, 403, `${route}: ${JSON.stringify(answer.body)}`);
      assert.deepEqual(Object.keys(answer.body), ['error']);
    }
  });

  it('gives a viewer the project and department figures, and no figures about a person', async () => {
    const across = await call('GET', '/api/analytics/portfolio', { token: viewer() });
    assert.equal(across.status, 200);
    assert.equal(across.body.projects, 1);
    assert.equal(across.body.papers.parties[0].party, 'Geotechnical consultant');

    const departments = await call('GET', `/api/analytics/departments?project=${project.id}`, { token: viewer() });
    assert.equal(departments.status, 200);
    assert.equal(departments.body.departments.reduce((n: number, d: any) => n + d.actionsOpen.count, 0), 2);

    const people = await call('GET', '/api/analytics/people', { token: viewer() });
    assert.equal(people.status, 200);
    assert.deepEqual(people.body.people, []);
  });

  it('gives one of the staff their own figures and no colleague’s', async () => {
    const people = await call('GET', '/api/analytics/people', { token: staff() });
    assert.equal(people.status, 200);
    assert.deepEqual(people.body.people.map((person: any) => person.email), ['asha@builders.example']);
    assert.equal(people.body.people[0].on.count, 1);
    assert.equal(people.body.people[0].overdue.count, 1);
  });

  it('gives the owner the firm’s people by name, and never the contractor', async () => {
    const people = await call('GET', '/api/analytics/people', { token: owner() });
    assert.equal(people.status, 200);
    assert.deepEqual(people.body.people.map((person: any) => person.email), ['asha@builders.example', 'dev@builders.example', 'vera@builders.example']);
  });

  it('asks for a project by its id, and answers 404 for one that is not the firm’s', async () => {
    assert.equal((await call('GET', '/api/analytics/departments', { token: owner() })).status, 400);
    assert.equal((await call('GET', `/api/analytics/departments?project=${'x'.repeat(200)}`, { token: owner() })).status, 400);
    assert.equal((await call('GET', '/api/analytics/departments?project=prj_not_here', { token: owner() })).status, 404);
  });
});
