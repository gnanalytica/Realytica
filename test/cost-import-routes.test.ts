/**
 * The Cost Report's import and its offered rows over real HTTP, with roles.
 *
 * `cost-table.test.ts` holds the rules. This holds the wiring and who may do
 * what: that a pasted table is shown before it is written and written only
 * when confirmed, that somebody who edits in Finance may import and may not
 * accept a row a paper offered, that a lead may, that a reader may do
 * neither, and that a dropped file is set aside by the firm's own people.
 *
 * The firm, its people and the cost report are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, costReportOf, createProject, offerCostRowsFromPages, papersInHand, setTeamMember, startCostReport, type DdProject } from '@realytica/shared';
import { notReadYetCard } from '../apps/api/src/documents/dropped';
import { COST_PACKAGES, COST_TOTAL, costTableAsPageText, costTablePasted } from './fixtures/cost-report';

const JWKS_URL = 'https://example.test/jwks-cost-import';
const ISSUER = 'https://securetoken.google.com/realytica-cost-import';
const AUDIENCE = 'realytica-cost-import';

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

async function call(method: string, route: string, opts: { token: string; body?: unknown }): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
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

const lead = () => tokenFor('sub-dev', 'dev@builders.example');
const contributor = () => tokenFor('sub-cora', 'cora@builders.example');
const reader = () => tokenFor('sub-vera', 'vera@builders.example');

let project: DdProject;
let reportId = '';
let evidenceId = '';
const DROPPED = 'key-site-queries';

/** The record as the server holds it now. */
async function held(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  return store.data.projects!.find((p) => p.id === project.id)!;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-cost-import-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(input).startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The owner signs in first and claims the workspace, then brings in the other two.
  assert.equal((await call('GET', '/api/members', { token: lead() })).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', { token: lead(), body: { email: 'cora@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: lead(), body: { email: 'vera@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('GET', '/api/members', { token: contributor() })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: reader() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  project = createProject({ name: 'Lakeview Residences', type: 'residential', location: 'Kere Road', city: 'Mysuru', currentStage: 'construction' }, 'RYT-CI1');
  project.tenantId = store.data.tenants![0]!.id;
  setTeamMember(project, { email: 'cora@builders.example', departments: { finance: 'contributor' } }, 'dev@builders.example');
  setTeamMember(project, { email: 'vera@builders.example', departments: { finance: 'viewer' } }, 'dev@builders.example');
  reportId = startCostReport(project, { month: '2026-08-01', seedPackages: false }, 'dev@builders.example').id;
  const paper = addEvidence(project, { title: 'Cost report, August 2026', kind: 'document', status: 'received' }, 'dev@builders.example');
  paper.documentType = 'Cost report';
  evidenceId = paper.id;
  offerCostRowsFromPages(project, evidenceId, [{ page: 2, text: costTableAsPageText(), reader: 'ocr' }], 3);
  project.chatProposals = [notReadYetCard({ fileName: 'Site queries.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: DROPPED }, 'dev@builders.example')];
  store.data.projects!.push(project);
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL']) delete process.env[name];
});

const at = (route: string): string => `/api/projects/${project.id}${route}`;

describe('a pasted cost table', () => {
  it('is shown before it is written: what it would take, what it would not, and that it adds up', async () => {
    const shown = await call('POST', at(`/cost-reports/${reportId}/import`), { token: contributor(), body: { text: costTablePasted() } });
    assert.equal(shown.status, 200);
    assert.deepEqual([shown.body.preview.adds, shown.body.preview.updates, shown.body.preview.read.addsUp, shown.body.check], [11, 0, true, '']);
    assert.deepEqual(shown.body.preview.read.lines.map((line: { as: string }) => line.as).filter((as: string) => as !== 'heading'), ['sub_total', 'sub_total', 'sub_total', 'total', 'gst', 'grand_total']);
    assert.equal(shown.body.project, undefined, 'a preview hands back no changed project');
    assert.equal(costReportOf(await held(), reportId).rows.length, 0, 'and nothing is on the report');
  });

  it('says a mismatch with the difference, and still writes nothing', async () => {
    const off = await call('POST', at(`/cost-reports/${reportId}/import`), { token: contributor(), body: { text: 'Package\tBudget\nCivil\t100\nMEP\t50\nTOTAL\t160' } });
    assert.equal(off.status, 200);
    assert.equal(off.body.check, 'Budget: the rows come to ₹150 and the table’s total is ₹160, ₹10 under.');
    assert.equal(costReportOf(await held(), reportId).rows.length, 0);
  });

  it('is refused to somebody who only reads in Finance, previewed or confirmed', async () => {
    for (const body of [{ text: costTablePasted() }, { text: costTablePasted(), confirm: true }]) {
      assert.equal((await call('POST', at(`/cost-reports/${reportId}/import`), { token: reader(), body })).status, 403);
    }
    assert.equal(costReportOf(await held(), reportId).rows.length, 0);
  });

  it('refuses what is no table in a sentence', async () => {
    const no = await call('POST', at(`/cost-reports/${reportId}/import`), { token: contributor(), body: { text: 'just some words\nand more words' } });
    assert.equal(no.status, 400);
    assert.match(no.body.error, /No figures were found/);
  });
});

describe('rows a cost report offers', () => {
  it('are not accepted by somebody who edits and does not decide, nor set aside by them', async () => {
    const offer = (await held()).costPapers![0]!.offers[0]!;
    for (const token of [contributor(), reader()]) {
      assert.equal((await call('POST', at(`/cost-reports/${reportId}/offers/${evidenceId}/${offer.id}/accept`), { token, body: {} })).status, 403);
      assert.equal((await call('POST', at(`/cost-reports/${reportId}/offers/${evidenceId}/accept-page`), { token, body: { page: 2 } })).status, 403);
      assert.equal((await call('POST', at(`/cost-papers/${evidenceId}/offers/${offer.id}/set-aside`), { token, body: {} })).status, 403);
    }
    const now = await held();
    assert.equal(costReportOf(now, reportId).rows.length, 0);
    assert.equal(now.costPapers![0]!.offers.every((held) => held.status === 'offered'), true);
  });

  it('are accepted by a lead, one with a cell corrected and then the rest of the page', async () => {
    const lifts = (await held()).costPapers![0]!.offers.find((offer) => offer.cells.name === 'Lifts')!;
    const one = await call('POST', at(`/cost-reports/${reportId}/offers/${evidenceId}/${lifts.id}/accept`), { token: lead(), body: { certified: 1200000 } });
    assert.equal(one.status, 200);
    assert.deepEqual([one.body.row.name, one.body.row.certified, one.body.row.from.page], ['Lifts', 1200000, 2]);
    const rest = await call('POST', at(`/cost-reports/${reportId}/offers/${evidenceId}/accept-page`), { token: lead(), body: { page: 2 } });
    assert.deepEqual([rest.status, rest.body.accepted, rest.body.left], [200, 10, 0]);
    const now = await held();
    assert.equal(costReportOf(now, reportId).rows.length, COST_PACKAGES.length);
    assert.equal(rest.body.totals.budget, COST_TOTAL.budget);
    assert.equal(now.costPapers![0]!.offers.every((offer) => offer.status === 'accepted' && offer.decidedBy === 'dev@builders.example'), true);
    // Accepted twice is refused in a sentence.
    const again = await call('POST', at(`/cost-reports/${reportId}/offers/${evidenceId}/${lifts.id}/accept`), { token: lead(), body: {} });
    assert.deepEqual([again.status, again.body.error], [400, 'That row has been accepted already.']);
  });

  it('once confirmed, a pasted table updates the rows that are there and adds none', async () => {
    const done = await call('POST', at(`/cost-reports/${reportId}/import`), { token: contributor(), body: { text: costTablePasted(), confirm: true } });
    assert.deepEqual([done.status, done.body.added, done.body.updated, done.body.totals.budget], [200, 0, 11, COST_TOTAL.budget]);
    // The certified figure the lead corrected is now the table's own again: the paste is the later word.
    assert.equal(costReportOf(await held(), reportId).rows.find((row) => row.name === 'Lifts')?.certified, 11_60_000);
  });
});

describe('a dropped file nobody said what to do with', () => {
  it('is set aside by the firm’s own people, and is then on no banner', async () => {
    const missing = await call('POST', at('/dropped/set-aside'), { token: lead(), body: { storageKey: 'no-such-file' } });
    assert.equal(missing.status, 404);
    const done = await call('POST', at('/dropped/set-aside'), { token: contributor(), body: { storageKey: DROPPED } });
    assert.equal(done.status, 200);
    const hand = papersInHand(await held());
    assert.deepEqual([hand.reading.length, hand.asked.length, hand.unread.length, hand.held.map((paper) => paper.fileName)], [0, 0, 0, ['Site queries.pdf']]);
  });
});
