/**
 * A contractor on one scope, over real HTTP.
 *
 * `project-view.test.ts` proves the projection is right. This proves the
 * wiring is: that the projection is what the API actually hands out, that a
 * write naming something outside the grant is refused rather than applied to
 * the real file, and that the refusal does not answer the question the caller
 * was really asking — whether the thing exists at all.
 *
 * The write half is the half worth booting a server for. Redaction is a copy;
 * every write route mutates the original, so a gate that reads correctly and
 * writes carelessly looks perfect in a unit test and loses the file.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { seedDemoProject, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-reach';
const ISSUER = 'https://securetoken.google.com/realytica-reach';
const AUDIENCE = 'realytica-reach';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

function jwkOf(key: KeyObject) {
  return { ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
}

async function call(
  method: string,
  route: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is itself the answer */
  }
  return { status: res.status, body };
}

const dev = () => tokenFor('sub-dev', 'dev@builders.in');
const sam = () => tokenFor('sub-sam', 'sam@site.in');

/** The project the contractor is put on, and the one they are not. */
let theirs: DdProject;
let elsewhere: DdProject;
let grant: ProjectGrant;
let tenantId = '';

/** Ids on `theirs` that the grant does not reach. */
let hidden: { checkId: string; scopeId: string; evidenceId: string; assessmentId: string };
/** Ids the grant does reach. */
let allowed: { checkId: string; evidenceId: string };

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-reach-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The developer signs in first and claims the workspace.
  const me = await call('GET', '/api/members', { token: dev() });
  assert.equal((me.body as { me: { role: string } }).me.role, 'owner');

  const { store } = await import('../apps/api/src/store');
  tenantId = store.data.tenants![0]!.id;

  theirs = seedDemoProject();
  theirs.tenantId = tenantId;
  elsewhere = seedDemoProject();
  elsewhere.id = `${elsewhere.id}-other`;
  elsewhere.tenantId = tenantId;
  store.data.projects!.push(theirs, elsewhere);

  const invited = await call('POST', '/api/members', {
    token: dev(),
    body: { email: 'sam@site.in', role: 'collaborator' },
  });
  assert.equal(invited.status, 201);
  assert.equal((await call('GET', '/api/members', { token: sam() })).status, 200);

  // One assessment, one scope on it, and nothing else. No areas at all.
  const assessment = theirs.assessments[0]!;
  const scope = assessment.scopes[0]!;
  grant = {
    id: 'grant-sam',
    tenantId,
    projectId: theirs.id,
    email: 'sam@site.in',
    role: 'contributor',
    allAssessments: false,
    assessmentIds: [assessment.id],
    allScopes: false,
    scopeKeys: [scope.scopeKey],
    areas: [],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.in',
  };
  store.data.grants = [grant];
  await store.save();

  const otherScope = assessment.scopes.find((s) => s.scopeKey !== scope.scopeKey)!;
  const otherAssessment = theirs.assessments[1]!;
  hidden = {
    checkId: otherScope.checks[0]!.id,
    scopeId: otherScope.id,
    assessmentId: otherAssessment.id,
    evidenceId: theirs.evidence.find((e) => e.scopeInstanceIds.length > 0 && !e.scopeInstanceIds.includes(scope.id))!.id,
  };
  allowed = {
    checkId: scope.checks[0]!.id,
    evidenceId: theirs.evidence.find((e) => e.scopeInstanceIds.includes(scope.id))!.id,
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe('what a granted collaborator can see through the API', () => {
  it('lists only the projects they hold a grant on', async () => {
    const res = await call('GET', '/api/projects', { token: sam() });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body as Array<{ id: string }>).map((p) => p.id), [theirs.id]);
  });

  it('gets a 404 on a project in their own workspace that they are not on', async () => {
    // 404, not 403: the developer's other sites are not theirs to enumerate.
    assert.equal((await call('GET', `/api/projects/${elsewhere.id}`, { token: sam() })).status, 404);
  });

  it('reads the project with everything outside the grant taken out', async () => {
    const res = await call('GET', `/api/projects/${theirs.id}`, { token: sam() });
    assert.equal(res.status, 200);
    const seen = res.body as DdProject;
    assert.deepEqual(seen.assessments.map((a) => a.id), [grant.assessmentIds[0]]);
    assert.deepEqual(seen.assessments[0]!.scopes.map((s) => s.scopeKey), grant.scopeKeys);
    assert.equal(seen.valuationRuns?.length ?? 0, 0);
    assert.equal(seen.reports?.length ?? 0, 0);
    assert.equal(seen.decisions?.length ?? 0, 0);
  });

  it('gets the redacted project out of a nested route too, not just the top one', async () => {
    // The redactor is mounted, not called per handler. This is what that buys.
    const res = await call('POST', `/api/projects/${theirs.id}/checks/${allowed.checkId}`, {
      token: sam(),
      body: { result: 'compliant', comments: 'seen on site' },
    });
    assert.equal(res.status, 200);
    const { project } = res.body as { project: DdProject };
    assert.equal(project.assessments.length, 1, 'a project handed back beside a record must be redacted as well');
  });

  it('is refused the areas the grant does not carry', async () => {
    for (const route of ['valuation', 'reports', 'decisions', 'visits', 'sheets']) {
      const res = await call('GET', `/api/projects/${theirs.id}/${route}`, { token: sam() });
      assert.equal(res.status, 404, `/${route} answered a collaborator with no such area`);
    }
  });

  it('is refused the workspace’s own thinking about the file', async () => {
    for (const route of ['runs', 'ai/drafts', 'capabilities', 'graph/stored']) {
      const res = await call('GET', `/api/projects/${theirs.id}/${route}`, { token: sam() });
      assert.equal(res.status, 404, `/${route} leaked`);
    }
  });
});

describe('what a granted collaborator can change', () => {
  it('may record a check inside their scope', async () => {
    const res = await call('POST', `/api/projects/${theirs.id}/checks/${allowed.checkId}`, {
      token: sam(),
      body: { result: 'compliant', comments: 'done' },
    });
    assert.equal(res.status, 200);
  });

  it('may not record one outside it, even knowing the id', async () => {
    const res = await call('POST', `/api/projects/${theirs.id}/checks/${hidden.checkId}`, {
      token: sam(),
      body: { result: 'compliant', comments: 'not mine to say' },
    });
    assert.equal(res.status, 404);
  });

  it('leaves that check exactly as it was', async () => {
    const { store } = await import('../apps/api/src/store');
    const live = store.data
      .projects!.find((p) => p.id === theirs.id)!
      .assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks))
      .find((c) => c.id === hidden.checkId)!;
    assert.notEqual(live.result, 'compliant', 'the write was refused but applied anyway');
  });

  it('may not reach a hidden record through a request body either', async () => {
    const res = await call('POST', `/api/projects/${theirs.id}/evidence/status`, {
      token: sam(),
      body: { ids: [allowed.evidenceId, hidden.evidenceId], status: 'received' },
    });
    assert.equal(res.status, 404, 'a body naming one allowed id and one hidden id must fail whole');
  });

  it('applies none of a batch it refuses', async () => {
    const { store } = await import('../apps/api/src/store');
    const live = store.data.projects!.find((p) => p.id === theirs.id)!;
    assert.notEqual(live.evidence.find((e) => e.id === hidden.evidenceId)!.status, 'received');
  });

  it('may not change the shape of the file', async () => {
    const attempts: Array<[string, string, unknown]> = [
      ['PATCH', '', { name: 'renamed by a contractor' }],
      ['POST', '/assessments', { ddType: 'acquisition', owner: 'sam', targetType: 'project' }],
      ['POST', '/stage', { stage: 'diligence' }],
      ['DELETE', '/chat', undefined],
    ];
    for (const [method, suffix, body] of attempts) {
      const res = await call(method, `/api/projects/${theirs.id}${suffix}`, { token: sam(), body });
      assert.equal(res.status, 403, `${method} ${suffix || '/'} must be refused`);
    }
  });

  it('did not rename the project on the way past', async () => {
    const res = await call('GET', `/api/projects/${theirs.id}`, { token: dev() });
    assert.notEqual((res.body as DdProject).name, 'renamed by a contractor');
  });
});

describe('a reviewer, who was put on the project to read it', () => {
  before(async () => {
    const { store } = await import('../apps/api/src/store');
    store.data.grants![0]!.role = 'reviewer';
  });

  after(async () => {
    const { store } = await import('../apps/api/src/store');
    store.data.grants![0]!.role = 'contributor';
  });

  it('still reads their scope', async () => {
    assert.equal((await call('GET', `/api/projects/${theirs.id}`, { token: sam() })).status, 200);
  });

  it('is told plainly that they may not write, because they know it is there', async () => {
    const res = await call('POST', `/api/projects/${theirs.id}/checks/${allowed.checkId}`, {
      token: sam(),
      body: { result: 'non_compliant', comments: 'no' },
    });
    assert.equal(res.status, 403);
  });
});

describe('a grant that has run out', () => {
  before(async () => {
    const { store } = await import('../apps/api/src/store');
    store.data.grants![0]!.expiresAt = '2020-01-01T00:00:00.000Z';
  });

  after(async () => {
    const { store } = await import('../apps/api/src/store');
    delete store.data.grants![0]!.expiresAt;
  });

  it('is the same as no grant at all', async () => {
    assert.equal((await call('GET', `/api/projects/${theirs.id}`, { token: sam() })).status, 404);
    assert.deepEqual((await call('GET', '/api/projects', { token: sam() })).body, []);
  });
});
