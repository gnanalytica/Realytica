/**
 * Procurement › Tenders over real HTTP, with sign-in on.
 *
 * `tenders.test.ts` holds the rules. This holds who may: six people sign in.
 * The firm's owner; one of its staff who leads Procurement on this project
 * and only contributes in Finance; one of its staff the team list holds to
 * reading in Procurement; a firm viewer; a contractor working from a grant
 * for every scope that does not name Procurement; and a consultant the team
 * list gives a role in Procurement.
 *
 * Each write is asked by those who may not, and the tenders are read back to
 * see that nothing was done. The contractor is answered as if nothing were
 * here, on the reads too, and the project they are handed carries no bidder.
 * The awarded value reaches the Cost Report only when a lead or signer in
 * Finance accepts it.
 *
 * The firm, the people, the project, the bidders and the figures are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addWorkPackages, createProject, setTeamMember, startCostReport, type DdProject, type ProjectGrant, type Tender } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-tenders';
const ISSUER = 'https://securetoken.google.com/realytica-tenders';
const AUDIENCE = 'realytica-tenders';

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
const buyer = () => tokenFor('sub-pat', 'pat@builders.example');
const reader = () => tokenFor('sub-vera', 'vera@builders.example');
const firmViewer = () => tokenFor('sub-vik', 'vik@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');
const consultant = () => tokenFor('sub-nina', 'nina@supply.example');

/** A day some days from today, so that what was done was done on a day that has come whenever this runs. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let project: DdProject;
let packageId = '';
let liftsId = '';
let at = '';

async function held(): Promise<Tender[]> {
  const { store } = await import('../apps/api/src/store');
  return structuredClone(store.data.projects!.find((p) => p.id === project.id)!.procurement?.tenders ?? []);
}

async function poIssued(): Promise<number> {
  const { store } = await import('../apps/api/src/store');
  const now = store.data.projects!.find((p) => p.id === project.id)!;
  return now.costReports![0]!.rows.find((row) => row.workPackageId === packageId)!.poIssued;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-tenders-'));
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

  // The owner signs in first and claims the workspace, then brings in the others.
  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  for (const [email, role] of [['pat@builders.example', 'staff'], ['vera@builders.example', 'staff'], ['vik@builders.example', 'viewer'], ['sam@site.example', 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201, email);
  }
  for (const token of [buyer, reader, firmViewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TR1');
  project.tenantId = tenantId;
  const [electrical, lifts] = addWorkPackages(project, [{ code: 'E1', name: 'Electrical works', budget: 58_000_000 }, { name: 'Lifts', budget: 34_000_000 }], 'dev@builders.example');
  packageId = electrical!.id;
  liftsId = lifts!.id;
  startCostReport(project, { month: '2026-10-01' }, 'dev@builders.example');
  // Staff contribute by default. The team list makes one of them Procurement's lead, and holds the other to reading there.
  setTeamMember(project, { email: 'pat@builders.example', departments: { procurement: 'lead' } }, 'dev@builders.example');
  setTeamMember(project, { email: 'vera@builders.example', departments: { procurement: 'viewer' } }, 'dev@builders.example');
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
    areas: ['commercials'],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.example',
  };
  store.data.grants = [grant];
  await store.save();
  at = `/api/projects/${project.id}/procurement`;

  // Somebody outside the firm, given a role in Procurement on the team list: the grant written for them names it.
  assert.equal((await call('PUT', `/api/projects/${project.id}/team/${encodeURIComponent('nina@supply.example')}`, { token: owner(), body: { departments: { procurement: 'contributor' } } })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: consultant() })).status, 200);
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL']) delete process.env[name];
});

describe('a tender, by the people who may work it', () => {
  let tenderId = '';
  let a = '';
  let b = '';
  let c = '';

  it('is started, staged and given its bidders by Procurement’s lead', async () => {
    const started = await call('POST', `${at}/tenders`, { token: buyer(), body: { workPackageId: packageId, estimate: 55_000_000 } });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    tenderId = started.body.tender.id;
    assert.equal(started.body.project.procurement.tenders.length, 1);

    const staged = await call('PUT', `${at}/tenders/${tenderId}/stages/documents_ready`, { token: buyer(), body: { dueOn: day(-40), owner: 'D. Pinto', doneOn: day(-40) } });
    assert.deepEqual([staged.status, staged.body.stage], [200, { key: 'documents_ready', dueOn: day(-40), owner: 'D. Pinto', doneOn: day(-40) }]);
    for (const [stage, body] of [['issued', { doneOn: day(-34) }], ['queries', { notNeeded: true }], ['bids_received', { doneOn: day(-12) }], ['comparison', { doneOn: day(-10) }], ['negotiation', { doneOn: day(-7) }]] as const) {
      assert.equal((await call('PUT', `${at}/tenders/${tenderId}/stages/${stage}`, { token: buyer(), body })).status, 200, stage);
    }
    for (const [name, quoted] of [['Bidder A', 54_800_000], ['Bidder B', 53_800_000], ['Bidder C', 44_000_000]] as const) {
      const added = await call('POST', `${at}/tenders/${tenderId}/bidders`, { token: buyer(), body: { name, quoted } });
      assert.equal(added.status, 201, JSON.stringify(added.body));
      if (name === 'Bidder A') a = added.body.bidder.id;
      if (name === 'Bidder B') b = added.body.bidder.id;
      if (name === 'Bidder C') c = added.body.bidder.id;
    }
    const revised = await call('PATCH', `${at}/tenders/${tenderId}/bidders/${b}`, { token: buyer(), body: { revised: 53_500_000, exclusions: 'DG fuel tank.' } });
    assert.deepEqual([revised.status, revised.body.bidder.revised, revised.body.bidder.exclusions], [200, 53_500_000, 'DG fuel tank.']);
  });

  it('is read back with its standing and its bids compared, flagged by the rule alone', async () => {
    const read = await call('GET', at, { token: owner() });
    assert.equal(read.status, 200);
    const [tender] = read.body.tenders;
    assert.deepEqual([tender.packageName, tender.standing.say, tender.comparison.bids.length], ['E1 Electrical works', 'At recommendation', 3]);
    assert.deepEqual(tender.comparison.flags.map((flag: { say: string }) => flag.say), ['Bidder C differs from the others by 17.8%, below the median.']);
    assert.deepEqual(read.body.flagPastPercent, { bid: 15, line: 25 });
    assert.deepEqual(read.body.may, { edit: true, decide: true, acceptOffer: true });
    assert.deepEqual((await call('GET', at, { token: buyer() })).body.may, { edit: true, decide: true, acceptOffer: false });
    assert.deepEqual((await call('GET', at, { token: reader() })).body.may, { edit: false, decide: false, acceptOffer: false });
  });

  it('refuses input that is not a tender’s: an unknown stage, a date that is no day, an amount of nothing, a name too long', async () => {
    const asked: Array<[string, string, unknown, number]> = [
      ['PUT', `${at}/tenders/${tenderId}/stages/handshake`, { dueOn: '2026-10-20' }, 404],
      ['PUT', `${at}/tenders/${tenderId}/stages/recommendation`, { dueOn: '20 Oct 2026' }, 400],
      ['PUT', `${at}/tenders/${tenderId}/stages/recommendation`, { dueOn: '2026-02-30' }, 400],
      ['PUT', `${at}/tenders/${tenderId}/stages/recommendation`, {}, 400],
      ['POST', `${at}/tenders/${tenderId}/bidders`, { name: 'Bidder D', quoted: 0 }, 400],
      ['POST', `${at}/tenders/${tenderId}/bidders`, { name: 'Bidder D', quoted: '5 crore' }, 400],
      ['POST', `${at}/tenders/${tenderId}/bidders`, { name: 'x'.repeat(161) }, 400],
      ['POST', `${at}/tenders/${tenderId}/bidders`, { name: 'Bidder D', lines: Array.from({ length: 201 }, (_, i) => ({ item: `Item ${i}`, amount: 1 })) }, 400],
      ['POST', `${at}/tenders`, { workPackageId: 'wpk_nowhere' }, 404],
      ['POST', `${at}/tenders`, { workPackageId: packageId }, 400],
      ['PATCH', `${at}/tenders/tnd_nowhere`, { estimate: 1 }, 404],
      ['PUT', `${at}/tenders/${tenderId}/recommendation`, { bidderId: b, text: '' }, 400],
      ['POST', `${at}/tenders/${tenderId}/letter-of-acceptance`, { bidderId: b, value: 53_500_000, letterOn: 'yesterday' }, 400],
    ];
    const was = await held();
    for (const [method, route, body, status] of asked) {
      const answer = await call(method, route, { token: owner(), body });
      assert.equal(answer.status, status, `${method} ${route} ${JSON.stringify(body).slice(0, 60)}: ${JSON.stringify(answer.body)}`);
    }
    assert.deepEqual(await held(), was);
  });

  /** Every way a tender is changed, each as a request that would change this one. */
  const writes = (): Array<{ name: string; method: string; route: string; body?: unknown }> => [
    { name: 'start a tender', method: 'POST', route: `${at}/tenders`, body: { workPackageId: liftsId } },
    { name: 'set the estimate', method: 'PATCH', route: `${at}/tenders/${tenderId}`, body: { estimate: 1 } },
    { name: 'remove the tender', method: 'DELETE', route: `${at}/tenders/${tenderId}` },
    { name: 'change a stage', method: 'PUT', route: `${at}/tenders/${tenderId}/stages/recommendation`, body: { dueOn: '2026-10-20', owner: 'Somebody' } },
    { name: 'add a bidder', method: 'POST', route: `${at}/tenders/${tenderId}/bidders`, body: { name: 'Bidder Z', quoted: 1 } },
    { name: 'change a bidder', method: 'PATCH', route: `${at}/tenders/${tenderId}/bidders/${a}`, body: { revised: 1 } },
    { name: 'remove a bidder', method: 'DELETE', route: `${at}/tenders/${tenderId}/bidders/${a}` },
    { name: 'write the recommendation', method: 'PUT', route: `${at}/tenders/${tenderId}/recommendation`, body: { bidderId: a, text: 'Them.' } },
    { name: 'record the letter', method: 'POST', route: `${at}/tenders/${tenderId}/letter-of-acceptance`, body: { bidderId: a, value: 1, letterOn: day(-1) } },
    { name: 'take the letter back', method: 'DELETE', route: `${at}/tenders/${tenderId}/letter-of-acceptance` },
    { name: 'accept the offer', method: 'POST', route: `${at}/tenders/${tenderId}/offer/accept` },
    { name: 'decline the offer', method: 'POST', route: `${at}/tenders/${tenderId}/offer/decline`, body: { reason: 'No.' } },
    { name: 'offer again', method: 'POST', route: `${at}/tenders/${tenderId}/offer/again` },
  ];

  for (const [who, token, status] of [
    ['a contractor whose grant does not name Procurement', contractor, 404],
    ['a viewer in Procurement', reader, 403],
    ['a viewer of the firm', firmViewer, 403],
  ] as const) {
    it(`is refused to ${who}, on every write, and nothing is done`, async () => {
      const was = await held();
      assert.equal(was.length, 1);
      for (const { name, method, route, body } of writes()) {
        const answer = await call(method, route, { token: token(), body });
        assert.equal(answer.status, status, `${name}: ${JSON.stringify(answer.body)}`);
        assert.equal(answer.body.project, undefined, `${name} hands back no project`);
        assert.deepEqual(await held(), was, `${name} left the tenders as they were`);
      }
    });
  }

  it('is refused to nobody signed in', async () => {
    assert.equal((await call('GET', at)).status, 401);
    for (const { name, method, route, body } of writes()) assert.equal((await call(method, route, { body })).status, 401, name);
  });

  it('is not there at all for the contractor: not on the read, and not on the project they are handed', async () => {
    const read = await call('GET', at, { token: contractor() });
    assert.deepEqual([read.status, read.body], [404, { error: 'Not found on this project' }]);
    const handed = await call('GET', `/api/projects/${project.id}`, { token: contractor() });
    assert.equal(handed.status, 200);
    assert.equal(handed.body.procurement, undefined);
    assert.ok(handed.body.cost.workPackages.length === 2, 'their grant opens the budget, and still not the bids');
    assert.ok(!JSON.stringify(handed.body).includes('Bidder'), 'no bidder is named anywhere on it');
    // The firm's own readers are shown it, and change nothing.
    for (const token of [reader, firmViewer]) {
      assert.equal((await call('GET', at, { token: token() })).body.tenders[0].bidders.length, 3);
      assert.equal((await call('GET', `/api/projects/${project.id}`, { token: token() })).body.procurement.tenders.length, 1);
    }
  });

  it('is open to a consultant the team list gives a role in Procurement, without the budget', async () => {
    const read = await call('GET', at, { token: consultant() });
    assert.equal(read.status, 200);
    assert.deepEqual([read.body.tenders[0].packageName, read.body.tenders[0].bidders.length, read.body.may], ['E1 Electrical works', 3, { edit: true, decide: false, acceptOffer: false }]);
    const handed = await call('GET', `/api/projects/${project.id}`, { token: consultant() });
    assert.deepEqual([handed.body.procurement.tenders.length, handed.body.cost, handed.body.costReports], [1, undefined, undefined]);
    // A contributor there: a stage's date is theirs to set, the recommendation is not, and the copy handed back is their own.
    const staged = await call('PUT', `${at}/tenders/${tenderId}/stages/recommendation`, { token: consultant(), body: { owner: 'N. Rao' } });
    assert.deepEqual([staged.status, staged.body.stage.owner, staged.body.project.cost], [200, 'N. Rao', undefined]);
    const refused = await call('PUT', `${at}/tenders/${tenderId}/recommendation`, { token: consultant(), body: { bidderId: b, text: 'Them.' } });
    assert.deepEqual([refused.status, refused.body.error], [403, 'That needs a lead or signer in Procurement.']);
    // A work package is the budget's, which they are not shown: naming one is naming nothing.
    assert.equal((await call('POST', `${at}/tenders`, { token: consultant(), body: { workPackageId: liftsId } })).status, 404);
  });

  it('takes its recommendation and its letter from Procurement’s lead, and offers the value to Finance without writing it', async () => {
    const recommended = await call('PUT', `${at}/tenders/${tenderId}/recommendation`, { token: buyer(), body: { bidderId: b, text: 'Lowest after negotiation of the bids that met every condition.' } });
    assert.deepEqual([recommended.status, recommended.body.recommendation.by], [200, 'pat@builders.example']);
    assert.equal((await call('PUT', `${at}/tenders/${tenderId}/stages/recommendation`, { token: buyer(), body: { doneOn: day(-6) } })).status, 200);
    const awarded = await call('POST', `${at}/tenders/${tenderId}/letter-of-acceptance`, { token: buyer(), body: { bidderId: b, value: 53_500_000, letterOn: day(-4) } });
    assert.equal(awarded.status, 201, JSON.stringify(awarded.body));
    assert.deepEqual([awarded.body.tender.award.by, awarded.body.tender.offer.status, awarded.body.tender.offer.amount], ['pat@builders.example', 'offered', 53_500_000]);
    assert.equal(await poIssued(), 0, 'offered, and not written');
    const read = await call('GET', at, { token: owner() });
    assert.deepEqual(read.body.waitingOnFinance.map((w: any) => [w.packageName, w.bidderName, w.offer.amount, w.onto.label, w.onto.poIssued]), [['E1 Electrical works', 'Bidder B', 53_500_000, 'October 2026', 0]]);
  });

  it('is accepted only by a lead or signer in Finance: Procurement’s own lead cannot write PO issued', async () => {
    for (const [name, route, body] of [['accept', `${at}/tenders/${tenderId}/offer/accept`, undefined], ['decline', `${at}/tenders/${tenderId}/offer/decline`, { reason: 'No.' }]] as const) {
      const refused = await call('POST', route, { token: buyer(), body });
      assert.deepEqual([refused.status, refused.body.error], [403, 'That needs a lead or signer in Finance.'], name);
    }
    assert.equal(await poIssued(), 0);
    assert.equal((await held())[0]!.offer!.status, 'offered');

    const accepted = await call('POST', `${at}/tenders/${tenderId}/offer/accept`, { token: owner() });
    assert.deepEqual([accepted.status, accepted.body.offer.status, accepted.body.offer.decidedBy], [200, 'accepted', 'dev@builders.example']);
    assert.equal(await poIssued(), 53_500_000);
    assert.equal(accepted.body.project.costReports[0].rows.find((row: any) => row.workPackageId === packageId).poIssued, 53_500_000);
    assert.equal((await call('DELETE', `${at}/tenders/${tenderId}/letter-of-acceptance`, { token: buyer() })).status, 400, 'the letter stays once Finance has accepted');
    assert.equal((await call('DELETE', `${at}/tenders/${tenderId}/bidders/${c}`, { token: buyer() })).status, 200, 'a bidder who was neither recommended nor awarded may still be taken off');
  });
});
