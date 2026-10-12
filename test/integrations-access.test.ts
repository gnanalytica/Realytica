/**
 * API keys and the Integrations routes over real HTTP, with sign-in on.
 *
 * Four people sign in: the firm's owner, one of its staff, a viewer, and a
 * contractor working from a grant. Only the owner may make a key or register
 * an endpoint. A key is then tried where it belongs, under `/api/v1`, within
 * its scopes and its list of projects, and where it does not: on the app's
 * own routes, which refuse it whatever it is.
 *
 * The firm, the people, the projects and the addresses are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addChecklistItems, addEvidence, createProject, generateReport, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-integrations';
const ISSUER = 'https://securetoken.google.com/realytica-integrations';
const AUDIENCE = 'realytica-integrations';

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

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any; headers: Headers }> {
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
  return { status: res.status, body, headers: res.headers };
}

const owner = () => tokenFor('sub-dev', 'dev@builders.example');
const staff = () => tokenFor('sub-sita', 'sita@builders.example');
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let lake: DdProject;
let hill: DdProject;
let elsewhere: DdProject;

/** Make a key as the owner, and answer with the key itself. */
async function mint(body: Record<string, unknown>): Promise<{ token: string; id: string }> {
  const made = await call('POST', '/api/integrations/keys', { token: owner(), body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return { token: made.body.token, id: made.body.key.id };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-integrations-access-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  process.env.REALYTICA_RATE_LIMIT_KEY = '40';

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
  for (const [email, role] of [['sita@builders.example', 'staff'], ['vera@builders.example', 'viewer'], ['sam@site.example', 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201);
  }
  for (const token of [staff, viewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  lake = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-IA1');
  hill = createProject({ name: 'Hill View homes', type: 'residential', location: 'Hill View', city: 'Kadamba' }, 'RYT-IA2');
  elsewhere = createProject({ name: 'Harbour warehouse', type: 'commercial', location: 'Harbour', city: 'Sagara' }, 'RYT-IA3');
  lake.tenantId = tenantId;
  hill.tenantId = tenantId;
  // Another firm's project, on the same deployment.
  elsewhere.tenantId = 'tnt_another_firm';
  store.data.tenants!.push({ id: 'tnt_another_firm', name: 'Another firm', createdAt: new Date().toISOString() });

  addChecklistItems(lake, 'finance', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }, { title: 'Structural drawings' }], 'dev@builders.example');
  addEvidence(lake, { title: 'Borehole logs', kind: 'document', status: 'received' }, 'dev@builders.example');
  const issued = generateReport(lake, { kind: 'executive_dd', generatedBy: 'dev@builders.example' }, 'dev@builders.example');
  issued.title = 'Lake Road: executive summary';
  issued.status = 'issued';
  issued.signedBy = 'D. Rao';
  issued.signedAt = new Date().toISOString();
  generateReport(lake, { kind: 'red_flag', generatedBy: 'dev@builders.example' }, 'dev@builders.example');
  lake.alerts = [
    { id: 'alr_open', key: 'approval:plan:expiring:2026-11-01', department: 'legal', severity: 'warning', title: 'Plan sanction expiring', detail: 'Valid until 1 Nov 2026', raisedAt: new Date().toISOString(), readBy: ['dev@builders.example'] },
  ];

  store.data.projects!.push(lake, hill, elsewhere);
  const grant: ProjectGrant = {
    id: 'grant-sam',
    tenantId,
    projectId: lake.id,
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
});

after(async () => {
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_RATE_LIMIT_KEY', 'REALYTICA_CREDENTIAL_KEY']) delete process.env[name];
});

describe('the Integrations routes', () => {
  const routes: Array<[string, string, unknown?]> = [
    ['GET', '/api/integrations'],
    ['POST', '/api/integrations/keys', { name: 'Mine', scopes: ['projects:read'] }],
    ['DELETE', '/api/integrations/keys/key_000000000000'],
    ['POST', '/api/integrations/endpoints', { url: 'https://hooks.partner.example/in', events: ['paper.filed'] }],
    ['DELETE', '/api/integrations/endpoints/whe_000000000000'],
    ['POST', '/api/integrations/endpoints/whe_000000000000/test'],
  ];

  for (const [who, token] of [
    ['somebody working from a grant', contractor],
    ['a viewer', viewer],
    ['one of the staff', staff],
  ] as const) {
    it(`are refused to ${who}, every one, and nothing is made`, async () => {
      for (const [method, route, body] of routes) {
        const answer = await call(method, route, { token: token(), body });
        assert.equal(answer.status, 403, `${method} ${route}: ${JSON.stringify(answer.body)}`);
      }
      const held = await call('GET', '/api/integrations', { token: owner() });
      assert.deepEqual([held.body.keys.length, held.body.endpoints.length], [0, 0]);
    });
  }

  it('are refused to nobody at all', async () => {
    for (const [method, route, body] of routes) assert.equal((await call(method, route, { body })).status, 401, `${method} ${route}`);
  });

  it('bound what the owner may send', async () => {
    const bad: unknown[] = [
      {},
      { name: '', scopes: ['projects:read'] },
      { name: 'x'.repeat(81), scopes: ['projects:read'] },
      { name: 'No scopes', scopes: [] },
      { name: 'A scope there is not', scopes: ['projects:write'] },
      { name: 'Too long lived', scopes: ['projects:read'], expiresInDays: 5000 },
      { name: 'Another firm', scopes: ['projects:read'], projectIds: [elsewhere.id] },
      // An empty list would be kept as every project of the firm.
      { name: 'No projects yet', scopes: ['projects:read'], projectIds: [] },
    ];
    for (const body of bad) assert.equal((await call('POST', '/api/integrations/keys', { token: owner(), body })).status, 400, JSON.stringify(body));
    assert.equal((await call('DELETE', '/api/integrations/keys/..%2F..%2Fetc', { token: owner() })).status, 404);
  });

  it('say plainly that webhooks are off while the deployment has no credential key, and refuse an address that is not public https once it has one', async () => {
    const off = await call('GET', '/api/integrations', { token: owner() });
    assert.deepEqual(off.body.webhooks, { available: false, needs: 'REALYTICA_CREDENTIAL_KEY' });
    const refused = await call('POST', '/api/integrations/endpoints', { token: owner(), body: { url: 'https://93.184.216.34/hook', events: ['paper.filed'] } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /REALYTICA_CREDENTIAL_KEY/);

    process.env.REALYTICA_CREDENTIAL_KEY = Buffer.alloc(32, 9).toString('base64');
    assert.deepEqual((await call('GET', '/api/integrations', { token: owner() })).body.webhooks, { available: true });
    for (const url of ['http://93.184.216.34/hook', 'https://127.0.0.1/hook', 'https://10.1.2.3/hook', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/hook', 'https://localhost/hook', `${base.replace('http:', 'https:')}/api/members`]) {
      const answer = await call('POST', '/api/integrations/endpoints', { token: owner(), body: { url, events: ['paper.filed'] } });
      assert.equal(answer.status, 400, url);
    }
    assert.equal((await call('POST', '/api/integrations/endpoints', { token: owner(), body: { url: 'https://93.184.216.34/hook', events: ['paper.deleted'] } })).status, 400);
    assert.equal((await call('GET', '/api/integrations', { token: owner() })).body.endpoints.length, 0);

    // A public address is kept, its secret shown this once and never again.
    const made = await call('POST', '/api/integrations/endpoints', { token: owner(), body: { url: 'https://93.184.216.34/hook', events: ['paper.filed', 'report.issued'] } });
    assert.equal(made.status, 201);
    assert.match(made.body.secret, /^whsec_/);
    const listed = await call('GET', '/api/integrations', { token: owner() });
    assert.equal(listed.body.endpoints.length, 1);
    assert.ok(!JSON.stringify(listed.body).includes(made.body.secret.slice(6)));
    assert.equal((await call('DELETE', `/api/integrations/endpoints/${made.body.endpoint.id}`, { token: owner() })).status, 204);
  });
});

describe('an API key', () => {
  it('is shown once, and reads the firm\'s projects under /api/v1 and nobody else\'s', async () => {
    const { token, id } = await mint({ name: 'Cost system', scopes: ['projects:read', 'documents:read', 'reports:read'], expiresInDays: 90 });
    assert.match(token, /^rlk_/);
    const listed = await call('GET', '/api/integrations', { token: owner() });
    const row = listed.body.keys.find((k: { id: string }) => k.id === id);
    assert.equal(row.prefix, token.slice(0, 12));
    assert.ok(!JSON.stringify(listed.body).includes(token.slice(13)), 'the key is never sent again');

    const projects = await call('GET', '/api/v1/projects', { token });
    assert.equal(projects.status, 200);
    assert.deepEqual(projects.body.projects.map((p: { reference: string }) => p.reference).sort(), ['RYT-IA1', 'RYT-IA2']);
    assert.equal((await call('GET', `/api/v1/projects/${lake.id}`, { token })).body.project.name, 'Lake Road offices');
    // Another firm's project, and one that is not there, are the same 404.
    assert.equal((await call('GET', `/api/v1/projects/${elsewhere.id}`, { token })).status, 404);
    assert.equal((await call('GET', '/api/v1/projects/prj_nothing', { token })).status, 404);
    assert.equal((await call('GET', '/api/v1/members', { token })).status, 404);
  });

  it('is told what the app would tell a reader: issued reports only, open alerts without who read them, papers still owed', async () => {
    const { token } = await mint({ name: 'Reader', scopes: ['projects:read', 'documents:read', 'reports:read'] });
    const reports = await call('GET', `/api/v1/projects/${lake.id}/reports`, { token });
    assert.deepEqual(reports.body.reports.map((r: { title: string }) => r.title), ['Lake Road: executive summary']);
    assert.equal(reports.body.reports[0].signedBy, 'D. Rao');
    assert.ok(!('body' in reports.body.reports[0]));

    // The alert put on the project stands for nothing on it, so the save resolved it: it is not among the open ones, and is with `state=all`.
    assert.deepEqual((await call('GET', `/api/v1/projects/${lake.id}/alerts`, { token })).body.alerts.filter((a: { id: string }) => a.id === 'alr_open'), []);
    const alerts = await call('GET', `/api/v1/projects/${lake.id}/alerts?state=all`, { token });
    assert.equal(alerts.status, 200);
    const planted = alerts.body.alerts.find((a: { id: string }) => a.id === 'alr_open');
    assert.equal(planted.title, 'Plan sanction expiring');
    assert.ok(planted.resolvedAt);
    assert.ok(!JSON.stringify(alerts.body).includes('readBy') && !JSON.stringify(alerts.body).includes('dev@builders.example'));

    const owed = await call('GET', `/api/v1/projects/${lake.id}/papers-owed`, { token });
    assert.equal(owed.body.owed, 2);
    assert.deepEqual(owed.body.parties.map((p: { owedBy: string | null; papers: Array<{ title: string }> }) => [p.owedBy, p.papers.map((x) => x.title)]), [
      ['Geotechnical consultant', ['Soil investigation report']],
      [null, ['Structural drawings']],
    ]);
    // What a matcher only suggests is not sent as fact.
    assert.ok(!JSON.stringify(owed.body).includes('suggestion'));
  });

  it('reads only what its scopes name', async () => {
    const { token } = await mint({ name: 'Reports only', scopes: ['reports:read'] });
    assert.equal((await call('GET', `/api/v1/projects/${lake.id}/reports`, { token })).status, 200);
    for (const route of ['/api/v1/projects', `/api/v1/projects/${lake.id}`, `/api/v1/projects/${lake.id}/alerts`, `/api/v1/projects/${lake.id}/papers-owed`]) {
      const answer = await call('GET', route, { token });
      assert.equal(answer.status, 403, route);
      assert.match(answer.body.error, /scope/);
    }
  });

  it('reads only the projects on its list, when it has one', async () => {
    const { token } = await mint({ name: 'Hill View only', scopes: ['projects:read', 'reports:read', 'documents:read'], projectIds: [hill.id] });
    assert.deepEqual((await call('GET', '/api/v1/projects', { token })).body.projects.map((p: { id: string }) => p.id), [hill.id]);
    assert.equal((await call('GET', `/api/v1/projects/${hill.id}`, { token })).status, 200);
    for (const route of ['', '/alerts', '/reports', '/papers-owed']) assert.equal((await call('GET', `/api/v1/projects/${lake.id}${route}`, { token })).status, 404, route);
  });

  it('writes nothing: there is no route under /api/v1 that is not a read', async () => {
    const { token } = await mint({ name: 'Would write', scopes: ['projects:read', 'documents:read', 'reports:read'] });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call(method, `/api/v1/projects/${lake.id}`, { token, body: { name: 'Renamed' } })).status, 404, method);
      assert.equal((await call(method, '/api/v1/projects', { token, body: { name: 'New' } })).status, 404, method);
    }
    assert.equal((await call('GET', `/api/v1/projects/${lake.id}`, { token })).body.project.name, 'Lake Road offices');
  });

  it('is refused on every route of the app itself, and a sign-in is refused under /api/v1', async () => {
    const { token } = await mint({ name: 'Everything a key can hold', scopes: ['projects:read', 'documents:read', 'reports:read'] });
    for (const [method, route] of [
      ['GET', '/api/projects'],
      ['GET', `/api/projects/${lake.id}`],
      ['POST', '/api/projects'],
      ['GET', '/api/members'],
      ['GET', '/api/portfolio'],
      ['GET', '/api/work'],
      ['GET', '/api/integrations'],
      ['POST', '/api/integrations/keys'],
      ['GET', '/api/devices'],
      ['GET', '/api/reference/catalog'],
    ] as const) {
      const answer = await call(method, route, { token, body: method === 'POST' ? { name: 'x', scopes: ['projects:read'] } : undefined });
      assert.equal(answer.status, 401, `${method} ${route}: ${JSON.stringify(answer.body)}`);
    }
    // The other way round: a person's sign-in is not a key.
    assert.equal((await call('GET', '/api/v1/projects', { token: owner() })).status, 401);
    assert.equal((await call('GET', '/api/v1/projects')).status, 401);
    assert.equal((await call('GET', '/api/v1/projects', { token: `${token.slice(0, -2)}zz` })).status, 401);
  });

  it('stops at once when it is revoked, and when it has expired', async () => {
    const { token, id } = await mint({ name: 'Short lived', scopes: ['projects:read'], expiresInDays: 1 });
    assert.equal((await call('GET', '/api/v1/projects', { token })).status, 200);
    assert.equal((await call('DELETE', `/api/integrations/keys/${id}`, { token: owner() })).status, 200);
    assert.equal((await call('GET', '/api/v1/projects', { token })).status, 401);
    assert.equal((await call('DELETE', `/api/integrations/keys/${id}`, { token: owner() })).status, 404);

    const late = await mint({ name: 'Out of date', scopes: ['projects:read'], expiresInDays: 1 });
    const { changeIntegrations } = await import('../apps/api/src/integrations/documents');
    await changeIntegrations('keys', (held) => {
      held.keys.find((k) => k.id === late.id)!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    assert.equal((await call('GET', '/api/v1/projects', { token: late.token })).status, 401);
  });

  it('has every use written down, and is held to its own limit however many other keys are busy', async () => {
    const busy = await mint({ name: 'Busy', scopes: ['projects:read'] });
    const calm = await mint({ name: 'Calm', scopes: ['projects:read'] });
    const answers: number[] = [];
    for (let i = 0; i < 42; i += 1) answers.push((await call('GET', '/api/v1/projects', { token: busy.token })).status);
    assert.deepEqual([answers.filter((s) => s === 200).length, answers.filter((s) => s === 429).length], [40, 2]);
    assert.equal((await call('GET', '/api/v1/projects', { token: calm.token })).status, 200);

    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    await afterReplyWorkDone();
    const { readIntegrations } = await import('../apps/api/src/integrations/documents');
    const { uses, lastUsedAt } = await readIntegrations('uses');
    const mine = uses.filter((use) => use.keyId === busy.id);
    // Every request it was answered, and none of those turned away for coming too fast: a key over its limit costs no write a request.
    assert.equal(mine.length, 40);
    assert.deepEqual(mine.at(-1) && [mine.at(-1)!.method, mine.at(-1)!.path, mine.at(-1)!.status], ['GET', '/projects', 200]);
    assert.ok(lastUsedAt[calm.id]);
    const listed = await call('GET', '/api/integrations', { token: owner() });
    assert.ok(listed.body.keys.find((k: { id: string }) => k.id === busy.id).lastUsedAt);
  });

  it('counts a caller with no key, or a made-up one, by its address, before the keys are read', async () => {
    const { storageAdapter } = await import('../apps/api/src/storage');
    const ask = async (address: string, token = 'rlk_made_up_by_somebody'): Promise<Response> => realFetch(`${base}/api/v1/projects`, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': address } });
    const answers: number[] = [];
    for (let i = 0; i < 302; i += 1) answers.push((await ask('203.0.113.7')).status);
    assert.deepEqual([answers.filter((s) => s === 401).length, answers.filter((s) => s === 429).length], [300, 2]);
    // Once it is over, a request is turned away before storage is asked for the keys.
    const read = storageAdapter.getDocument.bind(storageAdapter);
    let reads = 0;
    storageAdapter.getDocument = (async (holder: string, key: string) => ((reads += 1), read(holder, key))) as typeof storageAdapter.getDocument;
    try {
      const over = await ask('203.0.113.7');
      assert.equal(over.status, 429);
      assert.ok(Number(over.headers.get('retry-after')) >= 1);
      assert.equal(reads, 0);
    } finally {
      storageAdapter.getDocument = read;
    }
    // Another address, and a real key from it, are not held up.
    assert.equal((await ask('203.0.113.8')).status, 401);
    const { token } = await mint({ name: 'From elsewhere', scopes: ['projects:read'] });
    assert.equal((await ask('203.0.113.8', token)).status, 200);
  });
});
