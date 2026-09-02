/**
 * The whole API, from a bearer token to a JSON body.
 *
 * Everything else about authorisation can be unit-tested; this cannot. The
 * question here is whether the wiring holds — whether a real HTTP request
 * carrying one firm's token can reach another firm's file through any of the
 * hundred-odd routes on the project router. A unit test of `can()` says
 * nothing about that, because the way it goes wrong is a route that forgot to
 * ask.
 *
 * So the app is booted for real against a temporary store, two workspaces are
 * created the way they are created in production — by signing in — and then
 * one is pointed at the other's project.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const JWKS_URL = 'https://example.test/jwks';
const ISSUER = 'https://securetoken.google.com/realytica-test';
const AUDIENCE = 'realytica-test';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string, name?: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: subject,
    email,
    email_verified: true,
    name,
    iat: now - 5,
    exp: now + 3600,
  });
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

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-auth-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  // Only the JWKS is stubbed. Everything else — the store, the routers, the
  // middleware chain — is the real thing.
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
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

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

const asha = () => tokenFor('sub-asha', 'asha@firm-one.in', 'Asha Rao');
const rivals = () => tokenFor('sub-rival', 'ravi@firm-two.in', 'Ravi Kumar');

describe('an unauthenticated request', () => {
  it('cannot list projects', async () => {
    const res = await call('GET', '/api/projects');
    assert.equal(res.status, 401);
  });

  it('cannot read reference data either', async () => {
    assert.equal((await call('GET', '/api/libraries')).status, 401);
  });

  it('is refused a token that is not a token', async () => {
    assert.equal((await call('GET', '/api/projects', { token: 'made-up' })).status, 401);
  });

  it('still gets health, because a load balancer has no token', async () => {
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal((res.body as { auth: { mode: string } }).auth.mode, 'oidc');
  });
});

describe('the first person to sign in', () => {
  it('claims the workspace as its owner', async () => {
    const res = await call('GET', '/api/members', { token: asha() });
    assert.equal(res.status, 200);
    const body = res.body as { me: { role: string; email: string }; members: unknown[] };
    assert.equal(body.me.role, 'owner');
    assert.equal(body.me.email, 'asha@firm-one.in');
    assert.equal(body.members.length, 1);
  });
});

describe('two workspaces on one deployment', () => {
  let ashasProject = '';

  it('lets the first create a project', async () => {
    const res = await call('POST', '/api/projects', {
      token: asha(),
      body: { name: 'Firm One parcel', type: 'residential', location: 'Whitefield', city: 'Bengaluru', owner: 'Asha' },
    });
    assert.equal(res.status, 201);
    ashasProject = (res.body as { id: string }).id;
    assert.ok(ashasProject);
  });

  it('gives the second its own empty workspace, not the first one', async () => {
    // A real, verified Google account that nobody invited. It gets a workspace
    // of its own only because this deployment has no bootstrap list pinned;
    // what matters is that it is not Asha's.
    const res = await call('GET', '/api/projects', { token: rivals() });
    assert.equal(res.status, 403, 'a stranger must not silently land in an existing workspace');
  });

  it('lets an admin invite them, into their own workspace', async () => {
    const invite = await call('POST', '/api/members', {
      token: asha(),
      body: { email: 'ravi@firm-two.in', role: 'viewer' },
    });
    assert.equal(invite.status, 201);
  });

  it('binds the invite on their first sign-in', async () => {
    const res = await call('GET', '/api/members', { token: rivals() });
    assert.equal(res.status, 200);
    assert.equal((res.body as { me: { role: string } }).me.role, 'viewer');
  });

  it('shows an invited viewer the workspace they were invited to', async () => {
    const res = await call('GET', '/api/projects', { token: rivals() });
    assert.equal(res.status, 200);
    const names = (res.body as Array<{ name: string }>).map((p) => p.name);
    // The demo projects the boot seeder wrote have no tenant of their own and
    // were adopted by the first workspace, so they show here too. What matters
    // is that the invited viewer sees this workspace's file.
    assert.ok(names.includes('Firm One parcel'), `saw ${names.join(', ')}`);
  });

  it('refuses that viewer any write at all', async () => {
    const attempts: Array<[string, string, unknown]> = [
      ['POST', `/api/projects/${ashasProject}/assessments`, { ddType: 'acquisition', owner: 'x', targetType: 'project' }],
      ['PATCH', `/api/projects/${ashasProject}`, { name: 'renamed by a viewer' }],
      ['POST', `/api/projects/${ashasProject}/evidence`, { title: 'x', kind: 'document', status: 'expected' }],
      ['DELETE', `/api/projects/${ashasProject}`, undefined],
    ];
    for (const [method, route, body] of attempts) {
      const res = await call(method, route, { token: rivals(), body });
      assert.equal(res.status, 403, `${method} ${route} must be refused`);
    }
  });

  it('leaves the project untouched after all of that', async () => {
    const res = await call('GET', `/api/projects/${ashasProject}`, { token: asha() });
    assert.equal(res.status, 200);
    assert.equal((res.body as { name: string }).name, 'Firm One parcel');
  });
});

describe('a member of another workspace', () => {
  let outsider = '';
  let ashasProject = '';

  before(async () => {
    const mine = await call('GET', '/api/projects', { token: asha() });
    ashasProject = ((mine.body as Array<{ id: string }>)[0] ?? { id: '' }).id;

    // Stand up a second workspace directly in the store, the way a second
    // firm on the same deployment would exist.
    const { store } = await import('../apps/api/src/store');
    store.data.tenants?.push({ id: 'tnt_other', name: 'Firm Three', createdAt: new Date().toISOString() });
    store.data.memberships?.push({
      tenantId: 'tnt_other',
      subject: 'sub-other',
      email: 'meera@firm-three.in',
      role: 'owner',
      createdAt: new Date().toISOString(),
    });
    outsider = tokenFor('sub-other', 'meera@firm-three.in', 'Meera');
  });

  it('sees none of the first workspace’s projects', async () => {
    const res = await call('GET', '/api/projects', { token: outsider });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('gets a 404 rather than a 403 for a project it does not own', async () => {
    // 403 would confirm the project exists, which is the fact being probed for.
    const res = await call('GET', `/api/projects/${ashasProject}`, { token: outsider });
    assert.equal(res.status, 404);
  });

  it('cannot reach it through any of the nested routes either', async () => {
    const routes = [
      `/api/projects/${ashasProject}/graph`,
      `/api/projects/${ashasProject}/dashboard`,
      `/api/projects/${ashasProject}/runs`,
      `/api/projects/${ashasProject}/evidence/anything/files/anything`,
    ];
    for (const route of routes) {
      const res = await call('GET', route, { token: outsider });
      assert.equal(res.status, 404, `${route} leaked`);
    }
  });

  it('cannot write to it', async () => {
    const res = await call('PATCH', `/api/projects/${ashasProject}`, {
      token: outsider,
      body: { name: 'taken over' },
    });
    assert.equal(res.status, 404);
  });

  it('cannot see who is in the other workspace', async () => {
    const res = await call('GET', '/api/members', { token: outsider });
    assert.equal(res.status, 200);
    const emails = (res.body as { members: Array<{ email: string }> }).members.map((m) => m.email);
    assert.deepEqual(emails, ['meera@firm-three.in']);
  });
});

describe('the audit trail', () => {
  it('records the signed-in person, whatever the body claims', async () => {
    const created = await call('POST', '/api/projects', {
      token: asha(),
      // The old code read this. If any of it survives, this test fails.
      body: {
        name: 'Trail test',
        type: 'residential',
        location: 'x',
        city: 'Bengaluru',
        owner: 'x',
        actor: 'somebody-else@evil.test',
      },
    });
    assert.equal(created.status, 201);
    const project = created.body as { audit?: Array<{ actor: string }> };
    const actors = new Set((project.audit ?? []).map((e) => e.actor));
    assert.ok(actors.has('asha@firm-one.in'), `expected the token's identity, got ${[...actors].join(', ')}`);
    assert.ok(!actors.has('somebody-else@evil.test'), 'the body must not be able to name the actor');
  });
});

describe('the last owner', () => {
  it('cannot demote themselves out of their own workspace', async () => {
    const res = await call('PATCH', '/api/members/asha@firm-one.in', {
      token: asha(),
      body: { role: 'viewer' },
    });
    assert.equal(res.status, 409);
  });

  it('cannot be removed either', async () => {
    const res = await call('DELETE', '/api/members/asha@firm-one.in', { token: asha() });
    assert.equal(res.status, 409);
  });
});
