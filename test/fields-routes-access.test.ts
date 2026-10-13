/**
 * The routes that write a field's value, over real HTTP with sign-in on.
 *
 * Three things only a route can get wrong:
 *
 * - **Whose check it is.** A check's field is decided on its check. A
 *   collaborator whose grant leaves that check's assessment out does not
 *   decide it, though the function it sits in is in their reach.
 * - **Where a mirror's value is held.** A decision sent to a mirror is a
 *   decision on the field it reads, made there by that field's lead.
 * - **A fresh copy.** Every one of these routes saves the whole project, so
 *   each reads it from storage first, past the throttle a plain read keeps.
 *
 * The firm, the people, the project and the paper are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, createAssessment, createProject, proposeFieldValues, recordCheckFields, setTeamMember, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-fields';
const ISSUER = 'https://securetoken.google.com/realytica-fields';
const AUDIENCE = 'realytica-fields';
const PARCEL = 'land_site.parcel_identification';
const HOLDING = 'legal.title.holding';

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
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;
let store: typeof import('../apps/api/src/store').store;
const parcelCheck = () => store.data.projects!.find((held) => held.id === project.id)!.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === PARCEL)!;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-fields-routes-'));
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
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'sam@site.example', role: 'collaborator' } })).status, 201);
  assert.equal((await call('GET', '/api/members', { token: contractor() })).status, 200);

  ({ store } = await import('../apps/api/src/store'));
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Kere Road plot', type: 'residential', location: 'Kere Road', city: 'Kadamba' }, 'RYT-FRA');
  project.tenantId = tenantId;
  // Two assessments. The parcel check sits in the first; the collaborator is granted the second alone.
  const land = createAssessment(project, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  const design = createAssessment(project, { ddType: 'design', name: 'Design DD', owner: 'Lead', targetType: 'project' });
  assert.ok(land.scopes.some((scope) => scope.checks.some((check) => check.definitionId === PARCEL)));
  assert.ok(!design.scopes.some((scope) => scope.checks.some((check) => check.definitionId === PARCEL)));
  // Made a lead in Legal, so that nothing but the grant stands between them and the check.
  setTeamMember(project, { email: 'sam@site.example', departments: { legal: 'lead' } }, 'dev@builders.example');
  const check = land.scopes.flatMap((scope) => scope.checks).find((held) => held.definitionId === PARCEL)!;
  recordCheckFields(project, check.id, { extent_title: 5000 }, 'dev@builders.example');
  const paper = addEvidence(project, { title: 'Survey sketch', kind: 'document', status: 'received' }, 'dev@builders.example');
  proposeFieldValues(project, [{ address: { fn: 'legal.title', set: PARCEL, field: 'extent_title' }, value: 6000, origin: { kind: 'paper', evidenceId: paper.id, page: 1, quote: 'measuring 6000 square metres', reader: 'parser' } }], 'parser');
  store.data.projects!.push(project);
  const grant: ProjectGrant = {
    id: 'grant-sam',
    tenantId,
    projectId: project.id,
    email: 'sam@site.example',
    role: 'contributor',
    allAssessments: false,
    assessmentIds: [design.id],
    allScopes: true,
    scopeKeys: [],
    areas: [],
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

describe('deciding a field over HTTP', () => {
  const decide = (token: string, body: unknown) => call('POST', `/api/projects/${project.id}/fields/decide`, { token, body });

  it('is refused to a collaborator whose grant leaves the check’s assessment out, and nothing is changed', async () => {
    for (const body of [
      { address: { fn: 'legal.title', set: PARCEL, field: 'extent_title' }, decision: 'dispute', value: 4000 },
      { address: { fn: 'legal.title', set: PARCEL, field: 'extent_title' }, decision: 'not_applicable', reason: 'not_in_project' },
      { address: { fn: 'legal.title', set: PARCEL, field: 'extent_title' }, decision: 'accept', pick: 0 },
      // And not by way of the mirror on a sheet they do reach.
      { address: { fn: 'legal.title', set: HOLDING, field: 'extent_on_check' }, decision: 'accept', pick: 0 },
    ]) {
      const out = await decide(contractor(), body);
      assert.equal(out.status, 404, `${JSON.stringify(body)} → ${JSON.stringify(out.body)}`);
    }
    assert.deepEqual([parcelCheck().fields!.extent_title!.value, parcelCheck().fields!.extent_title!.state ?? 'typed'], [5000, 'typed']);
    // It is the check that is out of their reach, not the function: a sheet of the same function takes their value.
    const typed = await call('PUT', `/api/projects/${project.id}/fields/values`, { token: contractor(), body: { set: HOLDING, values: { tenure: 'freehold' } } });
    assert.equal(typed.status, 200, JSON.stringify(typed.body));
  });

  it('reads the project afresh before it writes, and sends a decision on a mirror to the field that holds the value', async () => {
    const forced: Array<[string, boolean | undefined]> = [];
    const sync = store.syncProject.bind(store);
    store.syncProject = (async (id: string, opts?: { force?: boolean }) => {
      forced.push([id, opts?.force]);
      return sync(id, opts);
    }) as typeof store.syncProject;
    try {
      const out = await decide(owner(), { address: { fn: 'legal.title', set: HOLDING, field: 'extent_on_check' }, decision: 'accept', pick: 0 });
      assert.equal(out.status, 200, JSON.stringify(out.body));
    } finally {
      store.syncProject = sync as typeof store.syncProject;
    }
    assert.ok(forced.some(([id, force]) => id === project.id && force === true), JSON.stringify(forced));
    assert.equal(parcelCheck().fields!.extent_title!.value, 6000, 'accepted on the check, from the mirror’s line');
  });

  it('refuses a project-wide situation from a function that neither declares it nor waits on it', async () => {
    const put = (fn: string) => call('PUT', `/api/projects/${project.id}/fields/situation`, { token: owner(), body: { fn, key: 'joint_development', on: true } });
    const other = await put('construction.safety');
    assert.equal(other.status, 400, JSON.stringify(other.body));
    assert.match(other.body.error, /not one of this function’s to decide/);
    assert.equal((await put('legal.contracts')).status, 200);
  });
});
