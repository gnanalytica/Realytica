/**
 * Photo stations over real HTTP, with sign-in on.
 *
 * What only a route can get wrong: the site endpoint tells the phone which
 * stations are due; a day's entry carries the station picked for each
 * photograph and the server gives the rest theirs by position; the last
 * shot of a station is served to frame the next against; a person sets a
 * place through one route whose body is bounded; and somebody who only
 * reads Construction changes nothing.
 *
 * The firm, the people, the project and the pictures are invented. The
 * pictures are a few bytes each, drawn here.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { STATIONS_SET, addFieldRecord, addMilestones, createProject, type DdProject, type StationDue } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-stations';
const ISSUER = 'https://securetoken.google.com/realytica-stations';
const AUDIENCE = 'realytica-stations';
const OWNER = 'dev@builders.example';
const ENGINEER = 'asha@builders.example';
const READER = 'ravi@builders.example';
const SITE = { lat: 12.9716, lng: 77.5946 };

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: `sub-${email}`, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

/** A one-pixel PNG: enough to be a photograph the server stores and serves. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let north = '';
let stair = '';
let store: typeof import('../apps/api/src/store').store;
const realFetch = globalThis.fetch;

async function call(method: string, route: string, email: string, body?: unknown): Promise<{ status: number; body: any; bytes?: Buffer; type?: string | null }> {
  const res = await realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(email)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const bytes = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = bytes.toString('utf8');
  try {
    parsed = JSON.parse(parsed as string);
  } catch {
    /* bytes that are not JSON are a photograph */
  }
  return { status: res.status, body: parsed, bytes, type: res.headers.get('content-type') };
}

const at = (rest = '') => `/api/projects/${project.id}${rest}`;
const held = () => store.data.projects!.find((one) => one.id === project.id)!;

/** Upload one picture and file it in a day's entry, as the phone does: the photographs first, then the entry that names them. */
async function logShot(email: string, date: string, photo: { stationId?: string; point?: { lat: number; lng: number }; takenAt?: string }) {
  const form = new FormData();
  form.append('photos', new Blob([PIXEL], { type: 'image/png' }), `shot-${date}.png`);
  const up = await realFetch(`${base}${at('/site-log/photos')}`, { method: 'POST', headers: { authorization: `Bearer ${tokenFor(email)}` }, body: form });
  assert.equal(up.status, 201);
  const stored = ((await up.json()) as { photos: Array<{ storageKey: string; fileName: string; mimeType: string }> }).photos[0]!;
  return call('POST', at('/site-log'), email, { clientId: `phone-${date}-${Math.random().toString(36).slice(2, 10)}`, date, photos: [{ ...stored, takenAt: photo.takenAt ?? `${date}T05:00:00Z`, ...(photo.point ? { point: photo.point } : {}), ...(photo.stationId ? { stationId: photo.stationId } : {}) }] });
}

/** A day in the month before this one, and one in this month, in India: the test runs on whatever day it is run. */
const today = new Date(Date.now() + 5.5 * 3_600_000);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const THIS_MONTH = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
const LAST_MONTH = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15)));

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-stations-'));
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

  assert.equal((await call('GET', '/api/members', OWNER)).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', OWNER, { email: ENGINEER, role: 'staff' })).status, 201);
  assert.equal((await call('POST', '/api/members', OWNER, { email: READER, role: 'viewer' })).status, 201);
  for (const email of [ENGINEER, READER]) assert.equal((await call('GET', '/api/members', email)).status, 200);

  ({ store } = await import('../apps/api/src/store'));
  project = createProject({ name: 'Canal Road flats', type: 'residential', location: 'Canal Road', city: 'Kadamba' }, 'RYT-STN');
  project.tenantId = store.data.tenants![0]!.id;
  const [slab] = addMilestones(project, [{ name: 'Slab, level 3', weight: 10 }], OWNER);
  const station = (values: Record<string, unknown>) => {
    const out = addFieldRecord(project, STATIONS_SET, values, OWNER);
    assert.deepEqual(out.rejected, []);
    return out.record!.id;
  };
  north = station({ label: 'North corner', floor: 'Level 3', milestone: slab!.id, every: 'month' });
  stair = station({ label: 'Stair core', every: 'month' });
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

describe('the site endpoint, as the phone reads it', () => {
  it('lists the stations due this period, never shot at first', async () => {
    const site = await call('GET', at('/site'), ENGINEER);
    assert.equal(site.status, 200);
    assert.deepEqual((site.body.stations as StationDue[]).map((one) => [one.label, one.standing, one.guide]), [['North corner', 'never', undefined], ['Stair core', 'never', undefined]]);
    assert.equal((site.body.stations as StationDue[])[0]!.place, 'Level 3 · Slab, level 3');
  });

  it('takes the station picked for a photograph with the day’s entry, and the next month finds it by position', async () => {
    const picked = await logShot(ENGINEER, LAST_MONTH, { stationId: north, point: SITE });
    assert.equal(picked.status, 201);
    assert.deepEqual([picked.body.entry.photos[0].stationId, picked.body.entry.photos[0].placed.how], [north, 'picked']);
    assert.deepEqual(picked.body.entry.photos[0].place.floor, 'Level 3');

    // Last month's shot is now the guide for this month's, and the station is due.
    let site = await call('GET', at('/site'), ENGINEER);
    const due = (site.body.stations as StationDue[]).find((one) => one.id === north)!;
    assert.deepEqual([due.standing, due.lastDay, due.point], ['due', LAST_MONTH, SITE]);
    assert.equal(due.guide!.siteLog!.entryId, picked.body.entry.id);
    assert.equal(site.body.log[0].photos[0].stationId, north, 'and the entry says which station each photograph is of');

    const guide = await call('GET', at(`/stations/${north}/guide`), ENGINEER);
    assert.deepEqual([guide.status, guide.type], [200, 'image/png']);
    assert.ok(guide.bytes!.equals(PIXEL), 'the very picture that was sent');
    assert.equal((await call('GET', at(`/stations/${stair}/guide`), ENGINEER)).status, 404, 'a station never shot has none');
    assert.equal((await call('GET', at('/stations/rec_none/guide'), ENGINEER)).status, 404);

    // This month, nobody picks: five metres off the same spot.
    const near = await logShot(ENGINEER, THIS_MONTH, { point: { lat: SITE.lat + 0.000045, lng: SITE.lng } });
    assert.deepEqual([near.body.entry.photos[0].stationId, near.body.entry.photos[0].placed.how], [north, 'near']);
    site = await call('GET', at('/site'), ENGINEER);
    assert.deepEqual((site.body.stations as StationDue[]).map((one) => one.label), ['Stair core'], 'shot this period, the station is no longer due');

    // A station id the project does not keep is not kept on the photograph.
    const stray = await logShot(ENGINEER, THIS_MONTH, { stationId: 'rec_of_another_project' });
    assert.equal(stray.status, 201);
    assert.deepEqual([stray.body.entry.photos[0].stationId, stray.body.entry.photos[0].place], [undefined, undefined]);
  });

  it('is among the routes a paired phone may reach, with the station’s guide', () => {
    const source = readFileSync(path.join(process.cwd(), 'apps/api/src/auth/middleware.ts'), 'utf8');
    const routes = source.slice(source.indexOf('const DEVICE_ROUTES'), source.indexOf('function deviceMayReach'));
    assert.ok(routes.includes(String.raw`['GET', /^\/projects\/[\w-]+\/site$/]`));
    assert.ok(routes.includes(String.raw`['GET', /^\/projects\/[\w-]+\/stations\/[\w-]+\/guide$/]`));
    assert.ok(routes.includes(String.raw`['POST', /^\/projects\/[\w-]+\/site-log$/]`));
  });
});

describe('setting a photograph’s place', () => {
  const waiting = () => held().siteLog!.find((entry) => entry.photos[0]!.stationId === undefined)!;

  it('is a person’s to do, on a site photograph by its entry and its place in it', async () => {
    const entry = waiting();
    const out = await call('PUT', at('/photos/place'), ENGINEER, { entryId: entry.id, index: 0, stationId: stair });
    assert.equal(out.status, 200);
    const photo = held().siteLog!.find((one) => one.id === entry.id)!.photos[0]!;
    assert.deepEqual([photo.stationId, photo.placed?.how], [stair, 'person']);
    assert.match(photo.placed!.by, /asha@builders\.example/);
    assert.equal(held().audit.at(-1)!.action, 'photo_place');
    // Taken away again, so the refusals below have something to refuse.
    assert.equal((await call('PUT', at('/photos/place'), ENGINEER, { entryId: entry.id, index: 0, stationId: null, place: null })).status, 200);
    assert.equal(held().siteLog!.find((one) => one.id === entry.id)!.photos[0]!.stationId, undefined);
  });

  it('refuses a body past its bounds, and writes nothing', async () => {
    const entry = waiting();
    const bad: Array<[string, unknown]> = [
      ['no photograph named', { stationId: stair }],
      ['two photographs named', { evidenceId: 'ev_1', entryId: entry.id, index: 0, stationId: stair }],
      ['neither a station nor a place', { entryId: entry.id, index: 0 }],
      ['a member the route does not take', { entryId: entry.id, index: 0, stationId: stair, caption: 'A model’s sentence about the slab.' }],
      ['a member of a place it does not take', { entryId: entry.id, index: 0, place: { floor: 'Level 3', description: 'words' } }],
      ['an element off no list', { entryId: entry.id, index: 0, place: { element: 'a cracked beam' } }],
      ['a floor past its length', { entryId: entry.id, index: 0, place: { floor: 'x'.repeat(41) } }],
      ['an index past an entry’s photographs', { entryId: entry.id, index: 40, stationId: stair }],
      ['an id past its length', { entryId: 'e'.repeat(81), index: 0, stationId: stair }],
    ];
    for (const [why, body] of bad) assert.equal((await call('PUT', at('/photos/place'), ENGINEER, body)).status, 400, why);
    for (const [why, body] of [['a station not on the list', { entryId: entry.id, index: 0, stationId: 'rec_none' }], ['a building not on the project', { entryId: entry.id, index: 0, place: { building: 'rec_none' } }], ['a photograph that is not there', { entryId: entry.id, index: 7, stationId: stair }]] as Array<[string, unknown]>) {
      assert.equal((await call('PUT', at('/photos/place'), ENGINEER, body)).status, 400, why);
    }
    const photo = held().siteLog!.find((one) => one.id === entry.id)!.photos[0]!;
    assert.deepEqual([photo.stationId, photo.place, photo.placed], [undefined, undefined, undefined]);
    // The day's entry is bounded the same way: a station's id is short.
    assert.equal((await call('POST', at('/site-log'), ENGINEER, { clientId: 'phone-bounds-1', date: THIS_MONTH, photos: [{ storageKey: `site_${project.id}_x.png`, fileName: 'x.png', mimeType: 'image/png', stationId: 's'.repeat(81) }] })).status, 400);
  });

  it('is refused to somebody who only reads Construction', async () => {
    const entry = waiting();
    const out = await call('PUT', at('/photos/place'), READER, { entryId: entry.id, index: 0, stationId: stair });
    assert.equal(out.status, 403);
    assert.equal(held().siteLog!.find((one) => one.id === entry.id)!.photos[0]!.stationId, undefined);
    // They still read the round: what is due is not a secret from the firm's own reader.
    const site = await call('GET', at('/site'), READER);
    assert.deepEqual([site.status, site.body.canLog, (site.body.stations as StationDue[]).map((one) => one.label)], [200, false, ['Stair core']]);
  });
});
