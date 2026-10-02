/**
 * Portal comparables, over real HTTP, against a fake scraping vendor.
 *
 * The vendor is faked at `fetch`: it answers Zyte's API with small synthetic
 * pages shaped like the portals' own — `window.__initialData__` for 99acres,
 * `window.SERVER_PRELOADED_STATE_` for MagicBricks, the autosuggest JSON — so
 * the parsers, the locality ladder, the ranking and the register run end to
 * end with no network and no real listing in the repository.
 *
 * Also pinned: a vendor failing falls over to the next one, while a portal's
 * own 404 is an answer and is never retried; and a deployment with no vendor
 * says so instead of reporting an empty market.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createProject, valueOffers, type DdProject } from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

/** What the fake vendor was asked for, in order. */
const asked: Array<{ vendor: string; url: string }> = [];
/** Zyte answers with this envelope status when set — 402 is "out of credit". */
let zyteDown = false;

const NINETY_NINE = {
  srp: {
    pageData: {
      properties: [
        { entityType: 'PROJECT', heading: 'A builder project', landingPage: { url: 'https://www.99acres.com/a-project' } },
        { SPID: '9101', PD_URL: '/plot-9101', PROPERTY_TYPE: 'Residential Land', MIN_PRICE: '60000000', MAX_PRICE: '60000000', LOCALIZED_AREA_VALUE: 12000, LOCALIZED_AREA_UNIT_LABEL: 'sq.ft.', AREA_TYPE: 'PLOT_AREA', MAP_DETAILS: { MAPPED: 'Y', LATITUDE: '12.9712', LONGITUDE: '77.7500' }, POSTING_DATE: Date.parse('2026-09-10'), ALT_TAG: 'Residential plot, Whitefield' },
        { SPID: '9102', PD_URL: '/plot-9102', PROPERTY_TYPE: 'Residential Land', MIN_PRICE: '33000000', MAX_PRICE: '33000000', LOCALIZED_AREA_VALUE: 7000, LOCALIZED_AREA_UNIT_LABEL: 'sq.ft.', AREA_TYPE: 'PLOT_AREA', MAP_DETAILS: { MAPPED: 'Y', LATITUDE: '12.9660', LONGITUDE: '77.7531' }, POSTING_DATE: Date.parse('2026-08-20'), ALT_TAG: 'Plot near Hope Farm' },
      ],
      search_params: { cityID: ['20'], localityID: ['5678'] },
      count: 3,
    },
  },
};

const MAGICBRICKS = {
  searchResult: [
    { url: '500-Sq-yrd-Residential-Plot-FOR-Sale-Whitefield-in-Bangalore-r1', id: 'mb1', price: 22000000, pmtLat: 0, pmtLong: 0, ltcoordGeo: '12.9701,77.7520', postDateT: '2026-09-15T00:00:00Z', locSeoName: 'Whitefield', caCompNameD: 'A person' },
    { url: '2400-Sq-ft-Residential-Plot-FOR-Sale-Whitefield-in-Bangalore-r2', id: 'mb2', price: 12500000, pmtLat: 12.9690, pmtLong: 77.7488, postDateT: '2026-09-02T00:00:00Z', locSeoName: 'Whitefield' },
  ],
  searchBean: { locality: '5678', city: '3327' },
};

const SUGGEST = { locationMap: { LOCATION: [{ psmName: 'Whitefield', result: 'Whitefield, Bangalore', latitude: '12.9698', longitude: '77.7500', rfnum: '5678' }] } };

/** The portals, as the fake vendor serves them. */
function page(target: string): { status: number; body: string } {
  if (target.includes('homepageAutoSuggest')) return { status: 200, body: JSON.stringify(SUGGEST) };
  if (target === 'https://www.99acres.com/property-in-whitefield-bangalore-east-ffid') {
    return { status: 200, body: `<html><script>window.__initialData__=${JSON.stringify(NINETY_NINE)};</script></html>` };
  }
  if (target.startsWith('https://www.99acres.com/search/property/buy/')) {
    return { status: 200, body: `<script>window.__initialData__=${JSON.stringify({ srp: { pageData: { properties: [], search_params: { cityID: ['20'], localityID: ['5678'] } } } })};</script>` };
  }
  if (target === 'https://www.magicbricks.com/residential-plots-land-for-sale-in-whitefield-bangalore-pppfs') {
    return { status: 200, body: `<script>window.SERVER_PRELOADED_STATE_ = ${JSON.stringify(MAGICBRICKS)};</script>` };
  }
  return { status: 404, body: 'not found' };
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Portal plot', type: 'residential', location: 'Whitefield', city: 'Bengaluru', jurisdiction: 'Karnataka / BBMP' }, 'RYT-PC1');
  p.siteCoordinate = { lat: 12.9698, lng: 77.75 };
  p.landAreaSqm = 1115;
  store.data.projects!.push(p);
  return p;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-portals-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.zyte.com/v1/extract') {
      const target = (JSON.parse(String(init?.body)) as { url: string }).url;
      asked.push({ vendor: 'zyte', url: target });
      if (zyteDown) return new Response('{"detail":"out of credit"}', { status: 402 });
      const { status, body } = page(target);
      return new Response(JSON.stringify({ statusCode: status, httpResponseBody: Buffer.from(body).toString('base64') }), { status: 200 });
    }
    if (url === 'https://api.brightdata.com/request') {
      const target = (JSON.parse(String(init?.body)) as { url: string }).url;
      asked.push({ vendor: 'brightdata', url: target });
      const { status, body } = page(target);
      return new Response(body, { status });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['UNBLOCKER_PROVIDER', 'UNBLOCKER_API_KEY', 'UNBLOCKER_BRIGHTDATA_API_KEY']) delete process.env[name];
});

beforeEach(async () => {
  asked.length = 0;
  zyteDown = false;
  (await import('../apps/api/src/comparables/unblocker')).__resetBreaker();
});

describe('a deployment with no scraping vendor', () => {
  it('says portal search is off, rather than that the market is empty', async () => {
    const p = await seeded();
    const res = await call('POST', `/api/projects/${p.id}/comparables/search`, {});
    assert.equal(res.status, 503);
    assert.equal(res.body.notConfigured, true);
    const status = await call('GET', `/api/projects/${p.id}/comparables`);
    assert.equal(status.body.configured, false);
  });
});

describe('a portal search', () => {
  before(() => {
    process.env.UNBLOCKER_PROVIDER = 'zyte';
    process.env.UNBLOCKER_API_KEY = 'test-zyte-key';
  });

  it('finds listings on both portals, near the site, and lands them proposed with their links', async () => {
    const p = await seeded();
    const res = await call('POST', `/api/projects/${p.id}/comparables/search`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    assert.equal(res.body.found, 4);
    const project = res.body.project as DdProject;
    const register = project.comparables!;
    assert.deepEqual(register.map((c) => c.source).sort(), ['99acres', '99acres', 'magicbricks', 'magicbricks']);
    assert.ok(register.every((c) => c.status === 'proposed' && c.kind === 'listing' && c.sourceUrl?.startsWith('https://')));
    assert.ok(!register.some((c) => c.title.includes('builder project')), 'the builder advert is dropped');
    assert.ok(!JSON.stringify(register).includes('A person'), 'the poster’s name never reaches the register');
    const mb = register.find((c) => c.sourceUrl?.includes('500-Sq-yrd'))!;
    assert.equal(Math.round(mb.areaSqm), 418, '500 sq yd, read off the slug');
    assert.ok(mb.distanceKm! < 1, 'pinned from the fallback coordinate');
    assert.equal(project.comparableSearch?.diagnostics.bySource['99acres']?.pagesResolved, 1);
    assert.deepEqual(project.comparableSearch?.diagnostics.resolvedLocalities, ['Whitefield, Bangalore']);
    assert.ok(asked.every((a) => !a.url.includes('118')), 'only the locality and city leave for the vendor');

    // The register now offers the comparable rate, as asking prices.
    const offer = valueOffers(project).find((o) => o.input === 'rate_per_sqm')!;
    assert.equal(offer.source.kind, 'comparables');
    assert.match(offer.basis, /asking prices/);
    const accepted = await call('POST', `/api/projects/${p.id}/value/accept`, { ids: [offer.id] });
    assert.equal(accepted.status, 200);
    const after = accepted.body.project as DdProject;
    assert.ok(after.evidence.some((e) => e.source === 'comparables' && /99acres\.com\/plot-9101/.test(e.description ?? '')));
    assert.ok(after.comparables!.every((c) => c.status === 'accepted'));
  });

  it('falls over to the next vendor when one is out of credit, and never retries a portal’s own 404', async () => {
    process.env.UNBLOCKER_BRIGHTDATA_API_KEY = 'test-bd-key';
    zyteDown = true;
    const p = await seeded();
    const res = await call('POST', `/api/projects/${p.id}/comparables/search`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.found, 4, 'Bright Data served what Zyte could not');
    assert.equal(asked.filter((a) => a.vendor === 'zyte').length, 1, 'Zyte is benched after its first failure, not paid for on every page');
    const notFound = asked.filter((a) => a.vendor === 'brightdata' && a.url.includes('bangalore-south'));
    assert.equal(notFound.length, 1, 'a 404 from the portal is an answer, asked once');
    delete process.env.UNBLOCKER_BRIGHTDATA_API_KEY;
  });
});
