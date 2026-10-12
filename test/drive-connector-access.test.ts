/**
 * Who may connect a project to a folder, read it now and disconnect it, over
 * real HTTP with sign-in on, against a stand-in for Google Drive.
 *
 * Five people sign in: the firm's owner; one of its staff the team list
 * holds to reading in every department of this project; a member whose firm
 * role is viewer; a contractor working from a grant that lets them write;
 * and nobody. Each route that changes anything is asked by the four who may
 * not, and the project is read back to see that nothing was done. Then the
 * owner does each thing, and the contractor's copy of the project is read to
 * see that it says nothing of the folder.
 *
 * Before any of it the deployment holds no service account: every answer
 * then says the firm has not set this up, and Google is never called.
 *
 * The firm, the people, the project, the folder and the papers are invented.
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
import { fakeDrive } from './fake-drive';

const JWKS_URL = 'https://example.test/jwks-connector';
const ISSUER = 'https://securetoken.google.com/realytica-connector';
const AUDIENCE = 'realytica-connector';
const FOLDER = 'folder-tender-papers-01';
const LINK = `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`;

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
const fake = fakeDrive();

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
const heldToReading = () => tokenFor('sub-vera', 'vera@builders.example');
const firmViewer = () => tokenFor('sub-vic', 'vic@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;
const at = () => `/api/projects/${project.id}/connector`;

async function held(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  return store.data.projects!.find((p) => p.id === project.id)!;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-connector-access-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    if (url.startsWith('https://oauth2.googleapis.com/') || url.startsWith('https://www.googleapis.com/drive/')) return fake.fetch(url, init);
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The owner signs in first and claims the workspace, then brings in the other three.
  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'vera@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'vic@builders.example', role: 'viewer' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'sam@site.example', role: 'collaborator' } })).status, 201);
  for (const token of [heldToReading, firmViewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Tollgate Road offices', type: 'commercial', location: 'Tollgate Road', city: 'Kadamba' }, 'RYT-DC1');
  project.tenantId = tenantId;
  // One of the firm's staff edits by default; the team list holds this one to reading in every department.
  setTeamMember(project, { email: 'vera@builders.example', departments: Object.fromEntries(DEPARTMENT_KEYS.map((key) => [key, 'viewer'])) }, 'dev@builders.example');
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
    areas: [],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.example',
  };
  store.data.grants = [grant];
  await store.save();

  fake.folder(FOLDER, 'Tender papers');
  fake.file('file-tender-letter-01', 'Letter of intent.txt', FOLDER, 'Letter of intent.\nThe contract sum is to be agreed by 30 June 2026.\n');
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'GOOGLE_SERVICE_ACCOUNT_JSON']) delete process.env[name];
});

describe('a deployment with no service account', () => {
  it('says the firm has not set this up, connects nothing, and never calls Google', async () => {
    const shown = await call('GET', at(), { token: owner() });
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.body, { configured: false, kind: 'google_drive', mayChange: true });
    const put = await call('PUT', at(), { token: owner(), body: { link: LINK } });
    assert.equal(put.status, 503);
    assert.equal(put.body.error, 'The firm has not set this up.');
    assert.equal((await held()).connector, undefined);
    assert.equal(fake.calls.length, 0);
  });
});

describe('a deployment with one', () => {
  before(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fake.json;
  });

  it('shows the address to share a folder with, and refuses a folder not yet shared with it', async () => {
    const shown = await call('GET', at(), { token: owner() });
    assert.deepEqual(shown.body, { configured: true, kind: 'google_drive', address: fake.address, mayChange: true });
    const put = await call('PUT', at(), { token: owner(), body: { link: LINK } });
    assert.equal(put.status, 400);
    assert.equal(put.body.error, `Share the folder with ${fake.address} first, as a viewer.`);
    assert.equal((await held()).connector, undefined);
  });

  it('refuses a link that names no folder, and a body with anything else in it', async () => {
    for (const body of [{ link: 'https://files.example.test/folders/abcdefghijkl' }, { link: '' }, { link: 'x'.repeat(401) }, { link: LINK, kind: 'onedrive' }, {}]) {
      const put = await call('PUT', at(), { token: owner(), body });
      assert.equal(put.status, 400, JSON.stringify(body));
      assert.equal(put.body.error, 'Paste the link to a Google Drive folder.');
    }
  });

  it('is connected, read and shown by the owner, each paper saying where it came from', async () => {
    fake.share(FOLDER);
    const put = await call('PUT', at(), { token: owner(), body: { link: LINK } });
    assert.equal(put.status, 200);
    assert.equal(put.body.connector.folderId, FOLDER);
    assert.equal(put.body.connector.folderName, 'Tender papers');
    assert.equal(put.body.connector.connectedBy, 'dev@builders.example');

    const read = await call('POST', `${at()}/sync`, { token: owner() });
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.run, { takenIn: 1, changed: 0, skipped: 0, waiting: 0, failed: 0 });
    assert.equal(read.body.connector.counts.takenIn, 1);
    const files = (await held()).evidence.flatMap((row) => row.attachments);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.origin?.path, 'Letter of intent.txt');
    assert.ok((await held()).audit.some((line) => line.action === 'connector_connected' && line.actor === 'dev@builders.example'));
  });

  for (const [who, token, status] of [
    ['somebody working from a grant that lets them write', contractor, 404],
    ['one of the firm’s staff held to reading in every department', heldToReading, 403],
    ['a member whose firm role is viewer', firmViewer, 403],
    ['nobody signed in', () => '', 401],
  ] as const) {
    it(`is refused to ${who}, on every route that changes it, and nothing is done`, async () => {
      const was = structuredClone((await held()).connector);
      const rows = (await held()).evidence.length;
      const lists = fake.calls.length;
      for (const [method, route, body] of [
        ['PUT', at(), { link: 'https://drive.google.com/drive/folders/folder-of-somebody-else-01' }],
        ['POST', `${at()}/sync`, undefined],
        ['DELETE', at(), undefined],
      ] as const) {
        const answer = await call(method, route, { token: token() || undefined, body });
        assert.equal(answer.status, status, `${method} ${route}`);
      }
      assert.deepEqual((await held()).connector, was);
      assert.equal((await held()).evidence.length, rows);
      assert.equal(fake.calls.length, lists, 'Google was not called for any of them');
    });
  }

  it('is read by the firm’s viewers, who are told they may not change it, and is not there for the contractor', async () => {
    for (const token of [heldToReading, firmViewer]) {
      const shown = await call('GET', at(), { token: token() });
      assert.equal(shown.status, 200);
      assert.equal(shown.body.mayChange, false);
      assert.equal(shown.body.connector.folderId, FOLDER);
    }
    assert.equal((await call('GET', at(), { token: contractor() })).status, 404);
    assert.equal((await call('GET', at())).status, 401);
    // Nor is it on the copy of the project the contractor is served.
    const copy = await call('GET', `/api/projects/${project.id}`, { token: contractor() });
    assert.equal(copy.status, 200);
    assert.equal(copy.body.connector, undefined);
    assert.equal((await call('GET', `/api/projects/${project.id}`, { token: owner() })).body.connector.folderId, FOLDER);
  });

  it('is disconnected by the owner, and the papers it brought stay', async () => {
    const gone = await call('DELETE', at(), { token: owner() });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.connector, undefined);
    const now = await held();
    assert.equal(now.connector, undefined);
    assert.equal(now.evidence.flatMap((row) => row.attachments).length, 1);
    assert.equal((await call('POST', `${at()}/sync`, { token: owner() })).status, 409);
  });
});
