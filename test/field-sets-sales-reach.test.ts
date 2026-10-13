/**
 * Buyers, with sign-in on, over real HTTP.
 *
 * A buyer is a person, and an advocate or a surveyor let onto one scope of a
 * project is not owed their name, their papers or what they agreed to pay.
 * This boots the API with sign-in on and reads the project as the firm's own
 * person and as two outside collaborators: one whose grant reaches Title,
 * which links to parties, and one whose grant reaches Handover, which links
 * to units. Every name and figure here is made up.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, addFieldRecord, projectView, seedDemoProject, setFieldValues, type DdProject, type ProjectGrant, type ScopeKey } from '@realytica/shared';
import { CUSTOMER_SETS } from '../packages/shared/src/operating-model/field-sets/sales-marketing';

const JWKS_URL = 'https://example.test/jwks-buyers';
const ISSUER = 'https://securetoken.google.com/realytica-buyers';
const AUDIENCE = 'realytica-buyers';
const OWNER = 'dev@builders.example';
const ADVOCATE = 'advocate@chambers.example';
const SURVEYOR = 'surveyor@snags.example';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let ids: { unit: string; buyerParty: string; coBuyerParty: string; vendorParty: string };
const realFetch = globalThis.fetch;

async function read(token: string): Promise<{ status: number; body: DdProject }> {
  const res = await realFetch(`${base}/api/projects/${project.id}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as DdProject };
}

const grantFor = (id: string, email: string, tenantId: string, scopeKeys: ScopeKey[]): ProjectGrant => ({
  id,
  tenantId,
  projectId: project.id,
  email,
  role: 'contributor',
  allAssessments: true,
  assessmentIds: [],
  allScopes: false,
  scopeKeys,
  areas: [],
  createdAt: new Date().toISOString(),
  createdBy: OWNER,
});

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-buyers-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(input as string, init);
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = (method: string, route: string, token: string, body?: unknown) =>
    realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

  // The developer signs in first and claims the workspace, then lets two outside people in.
  assert.equal((await call('GET', '/api/members', tokenFor('sub-dev', OWNER))).status, 200);
  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;

  project = seedDemoProject();
  project.tenantId = tenantId;
  const add = (set: string, values: Record<string, unknown>) => {
    const out = addFieldRecord(project, set, values, OWNER);
    assert.deepEqual(out.rejected, []);
    return out.record!.id;
  };
  const letter = addEvidence(project, { title: 'Allotment letter A-501', kind: 'document' }, OWNER).id;
  const unit = add('shared.units', { number: 'A-501', tower: 'A', floor: 5, carpet_area: '100 sqm', sale_released: true, sale_agreed_value: 8_000_000, sale_allotment_letter: [letter], sale_allotted_on: '2026-06-01', handover_offered_on: '2026-10-01' });
  const buyerParty = add('shared.parties', { name: 'A. Buyer', kind: 'individual', roles: ['customer'] });
  // A co-applicant nobody marked as a customer: kept back because a buyer's record names them.
  const coBuyerParty = add('shared.parties', { name: 'B. Co-buyer', kind: 'individual' });
  const vendorParty = add('shared.parties', { name: 'M. Vendor', kind: 'individual', roles: ['vendor'] });
  add('commercial.inventory.buyers', { party: buyerParty, unit, resident: 'in India', papers_on_file: ['PAN'], co_applicants: [{ party: coBuyerParty, share_pct: 50 }] });
  assert.deepEqual(setFieldValues(project, { set: 'legal.title.holding' }, { seller: vendorParty }, OWNER).rejected, []);
  add('commercial.handover.requests', { request_no: 'SR-001', unit, category: 'flooring_and_tiles', raised_on: '2026-09-20', in_liability_period: false });
  ids = { unit, buyerParty, coBuyerParty, vendorParty };
  store.data.projects!.push(project);

  for (const [subject, email] of [['sub-adv', ADVOCATE], ['sub-sur', SURVEYOR]] as const) {
    assert.equal((await call('POST', '/api/members', tokenFor('sub-dev', OWNER), { email, role: 'collaborator' })).status, 201);
    assert.equal((await call('GET', '/api/members', tokenFor(subject, email))).status, 200);
  }
  store.data.grants = [grantFor('grant-adv', ADVOCATE, tenantId, ['legal', 'land_site']), grantFor('grant-sur', SURVEYOR, tenantId, ['condition_operations'])];
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

const parties = (seen: DdProject) => (seen.fieldSheets?.['shared.parties']?.records ?? []).map((record) => String(record.values.name?.value)).sort();

describe('buyers, with sign-in on', () => {
  it('are all there for the firm’s own person', async () => {
    const { status, body } = await read(tokenFor('sub-dev', OWNER));
    assert.equal(status, 200);
    assert.equal(body.fieldSheets!['commercial.inventory.buyers']!.records!.length, 1);
    assert.deepEqual(parties(body), ['A. Buyer', 'B. Co-buyer', 'M. Vendor']);
    const unit = body.fieldSheets!['shared.units']!.records!.find((record) => record.id === ids.unit)!;
    assert.equal(unit.values.sale_agreed_value!.value, 8_000_000);
  });

  it('are kept from an advocate whose grant reaches Title: no buyers’ set, and neither a customer nor a co-applicant among the parties', async () => {
    const { status, body } = await read(tokenFor('sub-adv', ADVOCATE));
    assert.equal(status, 200);
    for (const set of CUSTOMER_SETS) assert.equal(body.fieldSheets?.[set], undefined, set);
    assert.ok(body.fieldSheets!['legal.title.holding'], 'their own function’s sheet is theirs');
    assert.deepEqual(parties(body), ['M. Vendor'], 'the vendor Title names is there; the buyer and the co-applicant are not');
    // Legal links to units (a notice names one, the land agreement allots them), so the unit is theirs to read: as a unit, never as a sale.
    const unit = body.fieldSheets!['shared.units']!.records!.find((record) => record.id === ids.unit)!;
    assert.equal(unit.values.number!.value, 'A-501');
    assert.deepEqual(Object.keys(unit.values).filter((key) => key.startsWith('sale_') || key.startsWith('handover_')), [], 'what Sales and Handover add to the unit does not go with Legal');
    assert.ok(!JSON.stringify(body.fieldSheets).includes('Buyer'));
  });

  it('hand a surveyor on Handover the unit, without its sale', async () => {
    const { status, body } = await read(tokenFor('sub-sur', SURVEYOR));
    assert.equal(status, 200);
    for (const set of CUSTOMER_SETS) assert.equal(body.fieldSheets?.[set], undefined, set);
    const unit = body.fieldSheets!['shared.units']!.records!.find((record) => record.id === ids.unit)!;
    assert.equal(unit.values.number!.value, 'A-501');
    assert.equal(unit.values.handover_offered_on!.value, '2026-10-01', 'what Handover adds to the unit goes with Handover');
    assert.deepEqual(Object.keys(unit.values).filter((key) => key.startsWith('sale_')), [], 'what Sales adds to the unit does not');
    assert.equal(body.fieldSheets!['commercial.handover.requests']!.records!.length, 1);
    assert.deepEqual(parties(body), ['M. Vendor'], 'Handover names contractors, so the parties come with it: without the buyers');
  });

  it('are kept back by the projection itself, whatever a grant names', () => {
    const everything: ProjectGrant = { ...grantFor('grant-all', SURVEYOR, project.tenantId!, []), allScopes: true };
    const seen = projectView(project, { kind: 'granted', grant: everything, email: SURVEYOR }).project;
    for (const set of CUSTOMER_SETS) assert.equal(seen.fieldSheets?.[set], undefined, set);
    assert.deepEqual(parties(seen), ['M. Vendor']);
    const unit = seen.fieldSheets!['shared.units']!.records!.find((record) => record.id === ids.unit)!;
    assert.deepEqual(Object.keys(unit.values).filter((key) => key.startsWith('sale_')), []);
  });
});
