/**
 * The scraping vendor: the one place that knows how a portal page is fetched.
 *
 * Portals sit behind bot managers, so pages are fetched through a managed
 * unblocking service that rotates India exit addresses. Ported from Valytica,
 * where the vendor shapes and the failover rule were verified live.
 *
 *   UNBLOCKER_PROVIDER           zyte | brightdata | oxylabs | none
 *   UNBLOCKER_API_KEY            the primary's credential
 *   UNBLOCKER_FALLBACK_PROVIDER  used only when the primary cannot serve (default brightdata)
 *   UNBLOCKER_<PROVIDER>_API_KEY a provider's own credential — a fallback needs one
 *   UNBLOCKER_BRIGHTDATA_ZONE    Bright Data's unlocker zone (default web_unlocker)
 *   UNBLOCKER_OXYLABS_USER       Oxylabs' username
 *
 * With nothing configured, `unblockerConfigured()` is false and a fetch throws
 * `UnblockerNotConfigured`: comparables are then added by hand.
 *
 * ## Failover
 *
 * A vendor failing — out of credit, a bad key, throttled, down — falls through
 * to the fallback. A portal answering, whatever it says, is never retried on
 * another vendor: the locality ladder is full of deliberate 404s, and retrying
 * those would double every search's bill.
 */

export type UnblockerProvider = 'zyte' | 'brightdata' | 'oxylabs' | 'none';

export interface UnblockResult {
  status: number;
  body: string;
}

export interface UnblockOptions {
  renderJs?: boolean;
  /** ISO exit country. Portals localise and geo-limit, so India by default. */
  country?: string;
  timeoutMs?: number;
}

export class UnblockerNotConfigured extends Error {
  constructor() {
    super('Portal search is not configured: set UNBLOCKER_PROVIDER and UNBLOCKER_API_KEY.');
    this.name = 'UnblockerNotConfigured';
  }
}

/** The vendor could not serve the request at all. Distinct from a portal's 404, which is an answer. */
export class VendorUnavailable extends Error {
  constructor(
    readonly provider: UnblockerProvider,
    readonly status: number,
  ) {
    super(`Scraping vendor ${provider} unavailable (status ${status})`);
    this.name = 'VendorUnavailable';
  }
}

/** Every configured vendor failed. Never to be read as "no listings". */
export class AllVendorsUnavailable extends Error {
  constructor(readonly tried: UnblockerProvider[]) {
    super(`Every scraping vendor was unavailable (tried: ${tried.join(', ') || 'none'})`);
    this.name = 'AllVendorsUnavailable';
  }
}

/* 401/402/403/407 auth or billing, 429 throttled, 5xx down. 404 is an answer and stays out. */
function isVendorFailureStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 407 || status === 429 || status >= 500;
}

function normalizeProvider(value: string | undefined): UnblockerProvider {
  const p = (value ?? 'none').toLowerCase();
  return p === 'zyte' || p === 'brightdata' || p === 'oxylabs' ? p : 'none';
}

/* The shared key serves the primary only; handing it to a fallback would 401 every failover. */
function keyFor(p: UnblockerProvider, isPrimary: boolean): string | undefined {
  if (p === 'none') return undefined;
  const own = process.env[`UNBLOCKER_${p.toUpperCase()}_API_KEY`];
  if (own) return own;
  return isPrimary ? process.env.UNBLOCKER_API_KEY : undefined;
}

export function providerChain(): UnblockerProvider[] {
  const primary = normalizeProvider(process.env.UNBLOCKER_PROVIDER);
  if (primary === 'none' || !keyFor(primary, true)) return [];
  const chain: UnblockerProvider[] = [primary];
  const fallback = normalizeProvider(process.env.UNBLOCKER_FALLBACK_PROVIDER ?? 'brightdata');
  if (fallback !== 'none' && fallback !== primary && keyFor(fallback, false)) chain.push(fallback);
  return chain;
}

export function unblockerConfigured(): boolean {
  return providerChain().length > 0;
}

/* A vendor that failed is skipped for a minute rather than paid for once per request. */
const BREAKER_COOLDOWN_MS = 60_000;
const openUntil = new Map<UnblockerProvider, number>();

export function __resetBreaker(): void {
  openUntil.clear();
}

export async function unblockedFetch(targetUrl: string, opts: UnblockOptions = {}): Promise<UnblockResult> {
  const chain = providerChain();
  if (!chain.length) throw new UnblockerNotConfigured();
  const country = opts.country ?? 'in';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const now = Date.now();
  const live = chain.filter((p) => (openUntil.get(p) ?? 0) <= now);
  // Everything benched still gets tried: a stale breaker must not be why nothing is found.
  const order = live.length ? live : chain;
  const tried: UnblockerProvider[] = [];
  for (const p of order) {
    const key = keyFor(p, p === chain[0]);
    if (!key) continue;
    tried.push(p);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await callProvider(p, targetUrl, country, opts.renderJs ?? false, key, controller.signal);
      if (p !== chain[0]) console.warn(`[unblocker] served by fallback ${p}`);
      return result;
    } catch (err) {
      const vendorFault =
        err instanceof VendorUnavailable || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'TypeError'));
      if (!vendorFault) throw err;
      if ((openUntil.get(p) ?? 0) <= Date.now()) console.warn(`[unblocker] ${p} unavailable; failing over for ${BREAKER_COOLDOWN_MS / 1000}s`);
      openUntil.set(p, Date.now() + BREAKER_COOLDOWN_MS);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AllVendorsUnavailable(tried);
}

function callProvider(p: UnblockerProvider, url: string, country: string, renderJs: boolean, key: string, signal: AbortSignal): Promise<UnblockResult> {
  if (p === 'zyte') return viaZyte(url, country, renderJs, key, signal);
  if (p === 'brightdata') return viaBrightData(url, country, renderJs, key, signal);
  if (p === 'oxylabs') return viaOxylabs(url, country, renderJs, key, signal);
  throw new UnblockerNotConfigured();
}

/* Zyte API: basic auth with the key as the username. The target's own status is inside the envelope. */
async function viaZyte(url: string, country: string, renderJs: boolean, key: string, signal: AbortSignal): Promise<UnblockResult> {
  const res = await fetch('https://api.zyte.com/v1/extract', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, geolocation: country.toUpperCase(), ...(renderJs ? { browserHtml: true } : { httpResponseBody: true }) }),
    signal,
  });
  // A non-2xx here is always Zyte itself failing, never a fact about the target.
  if (!res.ok) throw new VendorUnavailable('zyte', res.status);
  const json = (await res.json()) as { httpResponseBody?: string; browserHtml?: string; statusCode?: number };
  const body = json.browserHtml ?? (json.httpResponseBody ? Buffer.from(json.httpResponseBody, 'base64').toString('utf8') : '');
  return { status: json.statusCode ?? res.status, body };
}

/* Bright Data Web Unlocker: zone-scoped, the target's status passed through. */
async function viaBrightData(url: string, country: string, renderJs: boolean, key: string, signal: AbortSignal): Promise<UnblockResult> {
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: process.env.UNBLOCKER_BRIGHTDATA_ZONE ?? 'web_unlocker', url, format: 'raw', country, ...(renderJs ? { render: true } : {}) }),
    signal,
  });
  if (isVendorFailureStatus(res.status)) throw new VendorUnavailable('brightdata', res.status);
  return { status: res.status, body: await res.text() };
}

/* Oxylabs Web Scraper API, realtime. Never verified live in Valytica; kept for parity. */
async function viaOxylabs(url: string, country: string, renderJs: boolean, key: string, signal: AbortSignal): Promise<UnblockResult> {
  const auth = Buffer.from(`${process.env.UNBLOCKER_OXYLABS_USER ?? ''}:${key}`).toString('base64');
  const res = await fetch('https://realtime.oxylabs.io/v1/queries', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'universal', url, geo_location: country.toUpperCase(), ...(renderJs ? { render: 'html' } : {}) }),
    signal,
  });
  if (isVendorFailureStatus(res.status)) throw new VendorUnavailable('oxylabs', res.status);
  const json = (await res.json()) as { results?: Array<{ content?: string; status_code?: number }> };
  const first = json.results?.[0];
  return { status: first?.status_code ?? res.status, body: first?.content ?? '' };
}
