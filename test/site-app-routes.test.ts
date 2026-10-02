/**
 * The site app's way in, over real HTTP with sign-in on.
 *
 * A signed-in person asks for a pairing code; a phone with no session trades
 * it for a token of its own; that token reaches the site log and nothing
 * else, files the same entry once however often the phone resends it, and
 * stops working the moment the phone is revoked.
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
const ISSUER = 'https://securetoken.google.com/realytica-site-test';
const AUDIENCE = 'realytica-site-test';
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
const realFetch = globalThis.fetch;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-site-'));
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
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe('the site app', () => {
  it('pairs with a code, logs the day once, and loses its way in when revoked', async () => {
    const owner = tokenFor('owner-1', 'owner@firm.test');
    // The first sign-in claims the empty workspace.
    assert.equal((await call('GET', '/api/projects', { token: owner })).status, 200);
    const created = await call('POST', '/api/projects', { token: owner, body: { name: 'Site app plot', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: 'construction' } });
    assert.equal(created.status, 201);
    const projectId = created.body.id as string;
    await call('POST', `/api/projects/${projectId}/milestones`, { token: owner, body: { template: true } });

    const issued = await call('POST', '/api/devices/pair-code', { token: owner });
    assert.equal(issued.status, 201);
    const code = issued.body.code as string;
    assert.match(code, /^[A-Z2-9]{8}$/);

    // Typed by hand on a phone: lower case, with a dash.
    const claimed = await call('POST', '/api/devices/claim', { body: { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, name: 'Site phone', platform: 'android' } });
    assert.equal(claimed.status, 201);
    const phone = claimed.body.token as string;
    assert.ok(phone.startsWith('rdt_'));
    assert.equal((await call('POST', '/api/devices/claim', { body: { code } })).status, 400, 'a code works once');

    const me = await call('GET', '/api/devices/me', { token: phone });
    assert.equal(me.status, 200);
    assert.equal((me.body.person as { email: string }).email, 'owner@firm.test');

    const site = await call('GET', `/api/projects/${projectId}/site`, { token: phone });
    assert.equal(site.status, 200);
    assert.equal(site.body.canLog, true);
    const milestone = (site.body.milestones as Array<{ id: string }>)[1]!;

    const entry = { clientId: 'phone-entry-1', date: '2026-10-01', workDone: 'Raft poured', manpower: [{ trade: 'Mason', count: 8 }], milestoneUpdates: [{ milestoneId: milestone.id, percent: 50 }] };
    const first = await call('POST', `/api/projects/${projectId}/site-log`, { token: phone, body: entry });
    assert.equal(first.status, 201);
    const again = await call('POST', `/api/projects/${projectId}/site-log`, { token: phone, body: entry });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(((await call('GET', `/api/projects/${projectId}/site`, { token: phone })).body.log as unknown[]).length, 1);

    // The phone reaches the site log and nothing else.
    assert.equal((await call('GET', `/api/projects/${projectId}`, { token: phone })).status, 403);
    assert.equal((await call('POST', `/api/projects/${projectId}/engagements`, { token: phone, body: { kind: 'valuation' } })).status, 403);

    const devices = await call('GET', '/api/devices', { token: owner });
    const id = (devices.body.devices as Array<{ id: string }>)[0]!.id;
    assert.equal((await call('DELETE', `/api/devices/${id}`, { token: owner })).status, 204);
    assert.equal((await call('GET', '/api/devices/me', { token: phone })).status, 401, 'a revoked phone is turned away');
  });

  it('refuses a code nobody issued', async () => {
    const res = await call('POST', '/api/devices/claim', { body: { code: 'ABCD2345' } });
    assert.equal(res.status, 400);
  });
});
