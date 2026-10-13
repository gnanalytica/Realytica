/**
 * Who may change a checklist, and who may call the daily timer, over real
 * HTTP with sign-in on.
 *
 * `checklist-route.test.ts` runs with sign-in off, where everybody is the
 * owner, so it would pass with every gate taken out. Here three people sign
 * in: the firm's owner, one of the firm's staff who is only a viewer in
 * Finance on this project, and a contractor working from a grant. Each of
 * the five checklist routes is asked by the two who may not, and the list is
 * read back to see that nothing was done.
 *
 * The timer is the one route mounted ahead of sign-in. It is asked without
 * its secret and with it, and its neighbours are asked without a sign-in to
 * see that nothing else came out from behind the gate with it.
 *
 * The firm, the people, the project and the papers are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addChecklistItems, addEvidence, createProject, setTeamMember, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-checklist';
const ISSUER = 'https://securetoken.google.com/realytica-checklist';
const AUDIENCE = 'realytica-checklist';
const SECRET = 'a-secret-of-sixteen-or-more';

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
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;
let lineId = '';
let evidenceId = '';

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-checklist-access-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  process.env.CRON_SECRET = SECRET;

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

  // The owner signs in first and claims the workspace, then brings in the other two.
  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'vera@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'sam@site.example', role: 'collaborator' } })).status, 201);
  assert.equal((await call('GET', '/api/members', { token: viewer() })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: contractor() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-CA1');
  project.tenantId = tenantId;
  // One of the firm's staff edits by default; the team list holds this one to reading in Finance.
  setTeamMember(project, { email: 'vera@builders.example', departments: { finance: 'viewer' } }, 'dev@builders.example');
  const { added } = addChecklistItems(project, 'finance', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }], 'dev@builders.example');
  lineId = added[0]!.id;
  evidenceId = addEvidence(project, { title: 'Borehole logs', kind: 'document', status: 'received' }, 'dev@builders.example').id;
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
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'CRON_SECRET']) delete process.env[name];
});

/** A tracked list of two lines, one in the budget's package and one in the structure's. */
const TRACKED = [
  ['Ref No', 'Package', 'Description of Information Required', 'Request Ref', 'Current Status'].join('\t'),
  ['1.1', 'General', 'Approved master plan', 'E mail 01', 'Pending'].join('\t'),
  ['2.1', 'Civil and structural', 'Structural drawings', 'E mail 01', 'Received'].join('\t'),
].join('\n');

/** A tender form of three rows: one answered, one marked not applicable, one left blank. */
const TENDER_FORM = [
  ['Package:', 'Civil works', 'Client:', 'Lake Road Developers'].join('\t'),
  ['S.No', 'Information / Document Required', 'Details to be Provided', 'Client Response', 'Document Attached', 'Remarks'].join('\t'),
  ['7.1', 'Type of contract', 'Item rate / lump sum', 'Lump sum', '', ''].join('\t'),
  ['4.1', 'Materials supplied by the client', 'Cement, steel, others or none', 'Not Applicable', '', ''].join('\t'),
  ['7.4', 'Defects liability period', 'Months', '', '', ''].join('\t'),
].join('\n');

/** The ways a checklist is changed, each as a request that would change this one. */
function routes(): Array<{ name: string; method: string; route: string; body?: unknown }> {
  const at = `/api/projects/${project.id}/checklist`;
  return [
    { name: 'import', method: 'POST', route: `${at}/import`, body: { department: 'finance', text: 'Structural drawings\nColumn schedule\n' } },
    { name: 'add a line', method: 'POST', route: at, body: { department: 'finance', title: 'Basic prices' } },
    { name: 'change a line', method: 'PATCH', route: `${at}/${lineId}`, body: { title: 'Soil report', received: true, dismiss: evidenceId } },
    { name: 'mark a line partly in hand', method: 'PATCH', route: `${at}/${lineId}`, body: { partial: { wanted: 'Borehole logs' } } },
    { name: 'mark a line to be assumed', method: 'PATCH', route: `${at}/${lineId}`, body: { assumed: { assumer: 'Northbank Cost Consultants' } } },
    { name: 'say who owes several lines', method: 'POST', route: `${at}/assign`, body: { itemIds: [lineId], owedBy: 'Geotechnical consultant', targetDate: '2026-11-20' } },
    { name: 'load a tracked list', method: 'POST', route: `${at}/import`, body: { department: 'finance', text: TRACKED } },
    { name: 'look at a tracked list first', method: 'POST', route: `${at}/import`, body: { department: 'finance', text: TRACKED, preview: true } },
    { name: 'remove a line', method: 'DELETE', route: `${at}/${lineId}` },
    { name: 'ask for what is missing', method: 'POST', route: `${at}/requests`, body: { department: 'finance', dueAt: '2026-10-30' } },
  ];
}

async function held(): Promise<{ checklist: unknown; requests: unknown }> {
  const { store } = await import('../apps/api/src/store');
  const now = store.data.projects!.find((p) => p.id === project.id)!;
  return structuredClone({ checklist: now.checklist, requests: now.requests ?? [] });
}

describe('changing a checklist', () => {
  for (const [who, token] of [
    ['somebody working from a grant', contractor],
    ['a viewer in the department', viewer],
  ] as const) {
    it(`is refused to ${who}, on every route, and nothing is done`, async () => {
      const was = await held();
      assert.equal((was.checklist as unknown[]).length, 1);
      for (const { name, method, route, body } of routes()) {
        const answer = await call(method, route, { token: token(), body });
        // A line somebody working from a grant cannot see is, to them, not there: refused without saying it exists.
        const refused = who === 'somebody working from a grant' && (route.includes(lineId) || JSON.stringify(body ?? '').includes(lineId)) ? 404 : 403;
        assert.equal(answer.status, refused, `${name}: ${JSON.stringify(answer.body)}`);
        assert.equal(answer.body.project, undefined, `${name} hands back no project`);
        assert.deepEqual(await held(), was, `${name} left the list as it was`);
      }
    });
  }

  it('is refused to nobody signed in', async () => {
    for (const { name, method, route, body } of routes()) assert.equal((await call(method, route, { body })).status, 401, name);
  });

  it('is not shown to somebody working from a grant: the project they are handed has an empty list', async () => {
    const seen = await call('GET', `/api/projects/${project.id}`, { token: contractor() });
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body.checklist, []);
    assert.equal((await call('GET', `/api/projects/${project.id}`, { token: viewer() })).body.checklist.length, 1, 'the firm’s own viewer reads it');
  });

  it('is open to the firm’s people who may edit there, on the same five routes', async () => {
    const statuses: Array<[string, number]> = [];
    for (const { name, method, route, body } of routes()) {
      // Asked for before the line is removed, so there is something to ask for.
      if (name === 'remove a line') continue;
      // Looking at a list first changes nothing and answers 200; everything else here is a change.
      statuses.push([name, (await call(method, route, { token: owner(), body })).status]);
    }
    const cut = routes().find((r) => r.name === 'remove a line')!;
    statuses.push([cut.name, (await call(cut.method, cut.route, { token: owner() })).status]);
    assert.deepEqual(statuses, [
      ['import', 201],
      ['add a line', 201],
      ['change a line', 200],
      ['mark a line partly in hand', 200],
      ['mark a line to be assumed', 200],
      ['say who owes several lines', 200],
      ['load a tracked list', 201],
      ['look at a tracked list first', 200],
      ['ask for what is missing', 201],
      ['remove a line', 200],
    ]);
  });
});

describe('a list that runs across departments, and a tender form', () => {
  const at = () => `/api/projects/${project.id}`;
  const lines = async () => {
    const { store } = await import('../apps/api/src/store');
    return store.data.projects!.find((p) => p.id === project.id)!;
  };

  it('is not loaded into a department its sender only reads, from whichever desk it is sent', async () => {
    // Vera edits in Legal as any of the firm's staff does, and only reads Finance. The list's first package is the budget's.
    const before = (await lines()).checklist!.length;
    for (const preview of [true, false]) {
      const answer = await call('POST', `${at()}/checklist/import`, { token: viewer(), body: { department: 'legal', text: TRACKED, ...(preview ? { preview } : {}) } });
      assert.equal(answer.status, 403, JSON.stringify(answer.body));
      assert.match(answer.body.error, /finance/);
    }
    assert.equal((await lines()).checklist!.length, before);
    // Sent to a function she edits in, it loads.
    const moved = await call('POST', `${at()}/checklist/import`, { token: viewer(), body: { department: 'legal', text: TRACKED, desks: { General: 'legal.title' } } });
    assert.equal(moved.status, 201, JSON.stringify(moved.body).slice(0, 200));
  });

  it('a load is taken back, and a list removed, only by somebody who may edit on every desk its lines are on', async () => {
    const loaded = await call('POST', `${at()}/checklist/import`, { token: owner(), body: { department: 'procurement', text: `Information required for the tender\n${TRACKED}`, desks: { General: 'finance.budget' } } });
    assert.equal(loaded.status, 201, JSON.stringify(loaded.body).slice(0, 200));
    const before = (await lines()).checklist!.length;
    // One of its lines is on Finance's list, which Vera only reads.
    assert.equal((await call('POST', `${at()}/checklist/remove`, { token: viewer(), body: { load: loaded.body.load } })).status, 403);
    assert.equal((await call('POST', `${at()}/checklist/remove`, { token: contractor(), body: { load: loaded.body.load } })).status, 403);
    assert.equal((await lines()).checklist!.length, before);
    const undone = await call('POST', `${at()}/checklist/remove`, { token: owner(), body: { load: loaded.body.load } });
    assert.deepEqual([undone.status, undone.body.removed], [200, loaded.body.added]);
  });

  it('a value is assumed for a field only by somebody who may type in that field’s department', async () => {
    const line = (await lines()).checklist!.find((item) => item.department === 'legal')!;
    const address = { fn: 'finance.budget', set: 'finance.budget.contingency', field: 'contingency_original' };
    const refused = await call('PATCH', `${at()}/checklist/${line.id}`, { token: viewer(), body: { assumed: { assumer: 'Northbank', fields: [{ address, value: 4500000 }] } } });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal((await lines()).checklist!.find((item) => item.id === line.id)!.assumed, undefined);
    assert.equal((await call('PATCH', `${at()}/checklist/${line.id}`, { token: owner(), body: { assumed: { assumer: 'Northbank', fields: [{ address, value: 4500000 }] } } })).status, 200);
  });

  it('a tender form is loaded by the firm’s people who edit in Procurement, never by somebody working from a grant', async () => {
    const body = { department: 'procurement', text: TENDER_FORM };
    for (const preview of [true, false]) assert.equal((await call('POST', `${at()}/checklist/import`, { token: contractor(), body: { ...body, ...(preview ? { preview } : {}) } })).status, 403);
    assert.equal((await lines()).tenderForms, undefined);
    const loaded = await call('POST', `${at()}/checklist/import`, { token: viewer(), body });
    assert.equal(loaded.status, 201, JSON.stringify(loaded.body).slice(0, 200));
    assert.deepEqual([loaded.body.kind, loaded.body.report.offered, loaded.body.report.notApplicable, loaded.body.report.unanswered], ['tender_form', 1, 1, 1]);
  });

  it('what a form offers is decided by a lead or signer of Procurement, and its form is written out for the firm alone', async () => {
    const form = (await lines()).tenderForms![0]!;
    const offer = `${at()}/tender-forms/${form.id}/offers/${form.notApplicable[0]!.id}`;
    // A contributor loads and edits, and does not decide; somebody working from a grant reaches none of it.
    assert.equal((await call('POST', offer, { token: viewer(), body: { decision: 'take' } })).status, 403);
    assert.equal((await call('POST', offer, { token: viewer(), body: { decision: 'set_aside' } })).status, 403);
    // The form is not on their copy: to them it is not there.
    assert.equal((await call('POST', offer, { token: contractor(), body: { decision: 'take' } })).status, 404);
    assert.equal((await lines()).tenderForms![0]!.notApplicable.length, 1);
    const accept = { address: { fn: 'procurement.boq', set: 'procurement.boq.tender_terms', field: 'record as offered', record: form.record }, decision: 'accept' };
    assert.equal((await call('POST', `${at()}/fields/decide`, { token: viewer(), body: accept })).status, 403);
    assert.equal((await call('POST', `${at()}/fields/decide`, { token: owner(), body: accept })).status, 200);
    assert.equal((await call('POST', offer, { token: owner(), body: { decision: 'take' } })).status, 200);
    assert.deepEqual((await lines()).tenderForms![0]!.notApplicable, []);

    const out = `${at()}/tender-terms/${form.record}/form`;
    assert.equal((await call('GET', out, {})).status, 401);
    assert.equal((await call('GET', out, { token: contractor() })).status, 403);
    const res = await realFetch(`${base}${out}`, { headers: { authorization: `Bearer ${viewer()}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /spreadsheetml/);
    // The copy somebody working from a grant is handed carries none of the form.
    const seen = await call('GET', at(), { token: contractor() });
    assert.deepEqual([seen.body.checklist, seen.body.tenderForms], [[], []]);
  });
});

describe('the daily timer, through the app', () => {
  it('is refused without its secret, sign-in or no sign-in', async () => {
    for (const authorization of [undefined, 'Bearer ', 'Bearer wrong-secret-of-the-same-size', `Bearer ${owner()}`]) {
      const answer = await call('GET', '/api/cron/alerts', { authorization });
      assert.deepEqual([answer.status, answer.body], [401, { error: 'Unauthorized' }], String(authorization).slice(0, 24));
    }
  });

  it('runs with its secret and no sign-in: it is mounted ahead of the gate', async () => {
    const answer = await call('GET', '/api/cron/alerts', { authorization: `Bearer ${SECRET}` });
    assert.equal(answer.status, 200);
    // Every timed job answers under its own key, in the order it ran; the alert counts are the first.
    assert.deepEqual(Object.keys(answer.body), ['alerts', 'periodsDue', 'tell', 'drive', 'reportDay', 'webhookRetry', 'lawWatch', 'fileSweep']);
    assert.deepEqual(Object.keys(answer.body.alerts).sort(), ['changed', 'failed', 'projects', 'raised', 'resolved']);
    assert.equal(answer.body.alerts.failed, 0);
    assert.ok(answer.body.alerts.projects >= 1);
    for (const [key, counts] of Object.entries(answer.body)) assert.ok(!('error' in (counts as object)) && !('notRun' in (counts as object)), `${key}: ${JSON.stringify(counts)}`);
    // Nothing these reach is set up here, and each says so in place of doing anything.
    assert.equal(answer.body.drive.notSetUp, 1);
    assert.equal(answer.body.fileSweep.noModel, 1);
  });

  it('the shorter timers are behind the same secret', async () => {
    for (const route of ['/api/cron/often', '/api/cron/hourly']) {
      assert.equal((await call('GET', route, {})).status, 401, route);
      assert.equal((await call('GET', route, { authorization: `Bearer ${owner()}` })).status, 401, route);
    }
    const often = await call('GET', '/api/cron/often', { authorization: `Bearer ${SECRET}` });
    assert.deepEqual([often.status, Object.keys(often.body)], [200, ['tell', 'webhookRetry']]);
    const hourly = await call('GET', '/api/cron/hourly', { authorization: `Bearer ${SECRET}` });
    assert.deepEqual([hourly.status, Object.keys(hourly.body)], [200, ['drive']]);
  });

  it('brought nothing else out from behind sign-in, and its secret is no sign-in', async () => {
    const elsewhere: Array<[string, string]> = [
      ['GET', '/api/cron'],
      ['GET', '/api/cron/alerts/more'],
      ['POST', '/api/cron/alerts'],
      ['POST', '/api/cron/often'],
      ['GET', '/api/cron/often/more'],
      ['GET', '/api/cron/anything'],
      ['GET', '/api/projects'],
      ['GET', `/api/projects/${project.id}`],
      ['GET', `/api/projects/${project.id}/alerts`],
      ['GET', '/api/members'],
      ['GET', '/api/portfolio'],
      ['GET', '/api/work'],
    ];
    for (const [method, route] of elsewhere) {
      for (const authorization of [undefined, `Bearer ${SECRET}`]) {
        assert.equal((await call(method, route, { authorization })).status, 401, `${method} ${route} ${authorization ? 'with the timer’s secret' : 'with nothing'}`);
      }
    }
  });
});
