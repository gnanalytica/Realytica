/**
 * Webhooks out: telling another system what happened on a firm's projects.
 *
 * One of the firm's admins registers an address and the events it wants.
 * Each event is posted there once, signed, and the answer is written down.
 *
 * ## The address
 *
 * It is a URL somebody typed, which this server then calls: the same
 * server-side request forgery primitive `flows/outbound.ts` describes. So
 * only `https`, no user or password in it, and never an address inside the
 * deployment's own network: loopback, private, link-local (the cloud's
 * metadata endpoint is there), carrier NAT, or anything that is not a public
 * unicast address. A name is looked up and every answer is checked when the
 * endpoint is registered, and again by the connection itself: the request is
 * made with a lookup of its own that refuses a bad answer, so the address
 * checked is the address connected to, and a name that answered well at
 * registration and badly afterwards reaches nothing. A redirect is never
 * followed. It is a second address nobody checked, and is written down as a
 * failure.
 *
 * ## The signature
 *
 * The Standard Webhooks scheme, so a receiver can use a library it already
 * has. Three headers: `webhook-id` (the event's id, the same on every
 * attempt), `webhook-timestamp` (seconds), and `webhook-signature`,
 * `v1,<base64>` of HMAC-SHA256 over `id.timestamp.body` under the endpoint's
 * secret. The secret is `whsec_` and 32 random bytes in base64, shown once
 * and kept sealed (`flows/secret-box.ts`), which needs the deployment's
 * credential key: without that key no endpoint can be registered.
 *
 * ## Trying again
 *
 * The API runs as short-lived functions, so nothing here holds a timer. A
 * delivery that failed is written down with when to try it next, and the
 * daily timer tries what is due (`cron/webhook-retry.ts`). After
 * `MAX_ATTEMPTS` the delivery is given up, the endpoint is marked failing,
 * the firm's admins are told, and nothing more is sent to it until a test
 * delivery goes through.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { WEBHOOK_TEST_EVENT, type WebhookEventType } from '@realytica/shared';
import { isPrivateAddress } from '../flows/outbound';
import { open, seal } from '../flows/secret-box';
import { changeIntegrations, readIntegrations, type DeliveryRecord, type EndpointRecord } from './documents';

export class WebhookUrlRefused extends Error {}

/** How long a receiver has to answer. */
export const WEBHOOK_TIMEOUT_MS = 5_000;
/** Attempts in all, the first included, before a delivery is given up. */
export const MAX_ATTEMPTS = 5;
/** How long after each failed attempt the next is due. The timer is daily, so in practice the next run after that. */
const BACKOFF_MS = [60, 6 * 60, 24 * 60, 48 * 60].map((minutes) => minutes * 60_000);
/** How many deliveries are kept, besides those still to be tried again. */
const DELIVERIES_KEPT = 300;
/** How many event ids are remembered as sent, so one worked out twice is sent once. */
const EMITTED_KEPT = 2_000;

type Resolve = (host: string) => Promise<Array<{ address: string; family?: number }>>;
const resolveAll: Resolve = (host) => dnsLookup(host, { all: true });

/** Whether an address is one a webhook may be sent to: public unicast, and nothing else. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !isPrivateAddress(ip);
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  // An IPv4 address written as IPv6 points where the IPv4 address points.
  if (v6.startsWith('::ffff:')) return !isPrivateAddress(v6);
  // Global unicast is 2000::/3. Everything else is loopback, link-local, unique-local, multicast, a translation prefix or reserved.
  return /^[23][0-9a-f]{3}:/.test(v6);
}

const refusal = (host: string, address: string): string => `${host} is at ${address}, which is not a public address. A webhook is sent only to a public address.`;

/**
 * Refuse an address before it is kept or called. Throws `WebhookUrlRefused`
 * with a line the person who typed it can act on.
 */
export async function assertWebhookUrl(raw: string, resolve: Resolve = resolveAll): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlRefused('That is not a URL.');
  }
  if (url.protocol !== 'https:') throw new WebhookUrlRefused('A webhook address must begin https://.');
  if (url.username || url.password) throw new WebhookUrlRefused('A webhook address cannot carry a user name or a password.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new WebhookUrlRefused(refusal(host, host));
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookUrlRefused(`${host} does not resolve.`);
  }
  if (!addresses.length) throw new WebhookUrlRefused(`${host} does not resolve.`);
  // Every answer: a name with one public address and one private is the whole trick.
  const bad = addresses.find((answer) => !isPublicAddress(answer.address));
  if (bad) throw new WebhookUrlRefused(refusal(host, bad.address));
  return url;
}

/** The lookup a delivery's connection uses: the name's addresses, or a refusal where any of them is not public. */
export function guardedLookup(resolve: Resolve = resolveAll): LookupFunction {
  return ((hostname: string, options: { all?: boolean }, callback: (err: Error | null, address?: unknown, family?: number) => void) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = addresses.find((answer) => !isPublicAddress(answer.address));
        if (!addresses.length) return callback(new WebhookUrlRefused(`${hostname} does not resolve.`));
        if (bad) return callback(new WebhookUrlRefused(refusal(hostname, bad.address)));
        const all = addresses.map((answer) => ({ address: answer.address, family: answer.family ?? isIP(answer.address) }));
        if (options.all) callback(null, all);
        else callback(null, all[0]!.address, all[0]!.family);
      },
      (err: Error) => callback(err),
    );
  }) as unknown as LookupFunction;
}

/** What posts a delivery and answers with the receiver's status. Faked under test. */
export type WebhookSend = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number }>;

/** Post to a checked address: its own guarded lookup, a deadline, and no redirect followed (`https.request` follows none). */
export const httpsSend: WebhookSend = async (raw, body, headers) => {
  const url = await assertWebhookUrl(raw);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', agent: false, lookup: guardedLookup(), headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      clearTimeout(deadline);
      // The status is the answer. The body is nobody's, and is not waited for.
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
      res.destroy();
    });
    const deadline = setTimeout(() => req.destroy(new Error(`no answer in ${WEBHOOK_TIMEOUT_MS / 1000}s`)), WEBHOOK_TIMEOUT_MS);
    req.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
    req.end(body);
  });
};

/** `v1,<base64>`: HMAC-SHA256 over `id.timestamp.body` under the endpoint's secret. */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

/* ==================================================================== */
/* Endpoints                                                             */
/* ==================================================================== */

/** Register an address. The secret is in the answer and nowhere else, ever again. */
export async function createEndpoint(
  input: { tenantId: string; url: string; events: WebhookEventType[]; createdBy: string },
  now = new Date(),
  resolve: Resolve = resolveAll,
): Promise<{ secret: string; endpoint: EndpointRecord }> {
  const url = await assertWebhookUrl(input.url, resolve);
  const secret = `whsec_${randomBytes(32).toString('base64')}`;
  const endpoint: EndpointRecord = {
    id: `whe_${randomBytes(6).toString('hex')}`,
    tenantId: input.tenantId,
    url: url.toString(),
    events: [...new Set(input.events)],
    secret: seal(secret),
    createdAt: now.toISOString(),
    createdBy: input.createdBy,
  };
  await changeIntegrations('endpoints', (held) => void held.endpoints.push(endpoint));
  return { secret, endpoint };
}

export async function removeEndpoint(tenantId: string, id: string): Promise<boolean> {
  return changeIntegrations('endpoints', (held) => {
    const before = held.endpoints.length;
    held.endpoints = held.endpoints.filter((e) => !(e.tenantId === tenantId && e.id === id));
    return held.endpoints.length < before;
  });
}

/** What is safe to send back about an endpoint: never its secret. */
export function publicEndpoint(endpoint: EndpointRecord) {
  return { id: endpoint.id, url: endpoint.url, events: endpoint.events, createdAt: endpoint.createdAt, createdBy: endpoint.createdBy, failingSince: endpoint.failingSince ?? null };
}

/** What is safe to send back about a delivery: not what was sent. */
export function publicDelivery(delivery: DeliveryRecord) {
  const { body: _body, tenantId: _tenantId, ...rest } = delivery;
  return rest;
}

/* ==================================================================== */
/* Deliveries                                                            */
/* ==================================================================== */

/** What is posted for an event, as the receiver reads it. */
export interface OutgoingEvent {
  id: string;
  type: string;
  /** When it happened. */
  at: string;
  projectId?: string;
  data: Record<string, unknown>;
}

function newDelivery(endpoint: EndpointRecord, event: OutgoingEvent, now: Date): DeliveryRecord {
  return {
    id: `whd_${randomBytes(6).toString('hex')}`,
    endpointId: endpoint.id,
    tenantId: endpoint.tenantId,
    eventId: event.id,
    type: event.type,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    createdAt: now.toISOString(),
    attempts: 0,
    status: 'pending',
    body: JSON.stringify({ id: event.id, type: event.type, timestamp: event.at, data: event.data }),
  };
}

/**
 * Make one attempt and write its outcome onto the delivery. Never throws: a
 * receiver that is down, slow, redirecting or refused is an outcome.
 */
export async function attemptDelivery(delivery: DeliveryRecord, endpoint: EndpointRecord, now: Date, send: WebhookSend, retry = true): Promise<void> {
  const body = delivery.body ?? '';
  delivery.attempts += 1;
  delivery.lastAttemptAt = now.toISOString();
  delete delivery.lastStatus;
  delete delivery.lastError;
  let delivered = false;
  try {
    const timestamp = Math.floor(now.getTime() / 1000);
    const { status } = await send(endpoint.url, body, {
      'content-type': 'application/json',
      'user-agent': 'Realytica-Webhooks/1',
      'webhook-id': delivery.eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signWebhook(open(endpoint.secret), delivery.eventId, timestamp, body),
    });
    delivery.lastStatus = status;
    delivered = status >= 200 && status < 300;
    if (status >= 300 && status < 400) delivery.lastError = 'Answered with a redirect, which is not followed.';
  } catch (err) {
    delivery.lastError = (err as Error).message.slice(0, 300);
  }
  delete delivery.nextAttemptAt;
  if (delivered) {
    delivery.status = 'delivered';
    delete delivery.body;
  } else if (retry && delivery.attempts < MAX_ATTEMPTS) {
    delivery.status = 'failed';
    delivery.nextAttemptAt = new Date(now.getTime() + BACKOFF_MS[Math.min(delivery.attempts, BACKOFF_MS.length) - 1]!).toISOString();
  } else {
    delivery.status = retry ? 'gave_up' : 'failed';
    delete delivery.body;
  }
}

/** Put deliveries on the log as they now stand, by id, and trim it. Those still to be tried again are always kept. */
async function writeDeliveries(changed: DeliveryRecord[], emitted: string[] = []): Promise<void> {
  await changeIntegrations('deliveries', (held) => {
    const byId = new Map(changed.map((d) => [d.id, d]));
    const rest = held.deliveries.filter((d) => !byId.has(d.id));
    const all = [...rest, ...changed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const waiting = all.filter((d) => d.nextAttemptAt);
    const settled = all.filter((d) => !d.nextAttemptAt).slice(-DELIVERIES_KEPT);
    held.deliveries = [...settled, ...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    held.emitted = [...held.emitted, ...emitted].slice(-EMITTED_KEPT);
  });
}

/**
 * Send a firm's events to the endpoints that asked for them.
 *
 * An event already sent is not sent again: its id is remembered. Each
 * delivery is written down before it is tried and again with its outcome, so
 * one the instance was frozen in the middle of is on the log as pending.
 */
export async function sendEvents(tenantId: string, events: OutgoingEvent[], now = new Date(), send: WebhookSend = httpsSend): Promise<DeliveryRecord[]> {
  if (!events.length) return [];
  const endpoints = (await readIntegrations('endpoints')).endpoints.filter((e) => e.tenantId === tenantId && !e.failingSince);
  if (!endpoints.length) return [];
  const sent = new Set((await readIntegrations('deliveries')).emitted);
  const fresh = events.filter((event) => !sent.has(event.id));
  const queued = fresh.flatMap((event) => endpoints.filter((e) => (e.events as string[]).includes(event.type)).map((endpoint) => ({ endpoint, delivery: newDelivery(endpoint, event, now) })));
  if (!fresh.length) return [];
  await writeDeliveries(queued.map((q) => q.delivery), fresh.map((event) => event.id));
  await Promise.all(queued.map((q) => attemptDelivery(q.delivery, q.endpoint, now, send)));
  if (queued.length) await writeDeliveries(queued.map((q) => q.delivery));
  return queued.map((q) => q.delivery);
}

/** One delivery to one endpoint, asked for by a person, tried once. One that goes through clears the endpoint's failing mark. */
export async function testEndpoint(tenantId: string, endpointId: string, now = new Date(), send: WebhookSend = httpsSend): Promise<DeliveryRecord | undefined> {
  const endpoint = (await readIntegrations('endpoints')).endpoints.find((e) => e.tenantId === tenantId && e.id === endpointId);
  if (!endpoint) return undefined;
  const delivery = newDelivery(endpoint, { id: `evt_test_${randomBytes(6).toString('hex')}`, type: WEBHOOK_TEST_EVENT, at: now.toISOString(), data: { message: 'A test delivery from Realytica.' } }, now);
  await attemptDelivery(delivery, endpoint, now, send, false);
  await writeDeliveries([delivery]);
  if (delivery.status === 'delivered' && endpoint.failingSince) {
    await changeIntegrations('endpoints', (held) => {
      const live = held.endpoints.find((e) => e.id === endpoint.id);
      if (live) {
        delete live.failingSince;
        delete live.toldAt;
      }
    });
  }
  return delivery;
}

export interface RetryRun {
  [count: string]: number;
  /** Deliveries whose next attempt had come due. */
  due: number;
  delivered: number;
  /** Tried and failed again, with another attempt still to come. */
  failed: number;
  gaveUp: number;
  /** Endpoints marked failing by this run. */
  endpointsFailing: number;
  /** Endpoints whose firm was told by this run. */
  told: number;
}

/**
 * Try again every delivery that is due, give up those out of attempts, mark
 * their endpoints failing and have the firm told.
 *
 * Safe to run twice: what is due is read from the log, and a delivery tried
 * is written back with a later date or none. One delivery going wrong leaves
 * the rest of the run to finish.
 */
export async function retryDeliveries(now: Date, send: WebhookSend, tell: (endpoint: EndpointRecord) => Promise<boolean>): Promise<RetryRun> {
  const out: RetryRun = { due: 0, delivered: 0, failed: 0, gaveUp: 0, endpointsFailing: 0, told: 0 };
  const endpoints = new Map((await readIntegrations('endpoints')).endpoints.map((e) => [e.id, e]));
  const log = (await readIntegrations('deliveries')).deliveries;
  const due = log.filter((d) => d.status === 'failed' && d.nextAttemptAt && d.nextAttemptAt <= now.toISOString());
  out.due = due.length;
  const lost = new Set<string>();
  for (const delivery of due) {
    try {
      const endpoint = endpoints.get(delivery.endpointId);
      if (!endpoint || endpoint.failingSince || !delivery.body) {
        // Its endpoint is gone or already failing: there is nowhere to send it.
        delivery.status = 'gave_up';
        delete delivery.nextAttemptAt;
        delete delivery.body;
      } else {
        await attemptDelivery(delivery, endpoint, now, send);
      }
      if (delivery.status === 'delivered') out.delivered += 1;
      else if (delivery.status === 'gave_up') {
        out.gaveUp += 1;
        if (endpoint && !endpoint.failingSince) lost.add(endpoint.id);
      } else out.failed += 1;
    } catch (err) {
      out.failed += 1;
      console.warn(`[webhooks] retry of ${delivery.id}: ${(err as Error).message}`);
    }
  }
  // What else waits on an endpoint now failing is given up with it: nothing is sent there until a person has looked.
  const abandoned = log.filter((d) => d.status === 'failed' && lost.has(d.endpointId));
  for (const delivery of abandoned) {
    delivery.status = 'gave_up';
    delete delivery.nextAttemptAt;
    delete delivery.body;
    if (due.includes(delivery)) out.failed -= 1;
    out.gaveUp += 1;
  }
  if (due.length || abandoned.length) await writeDeliveries([...new Set([...due, ...abandoned])]);

  // Then the endpoints: mark the ones just lost, and tell the firm of any failing one it has not been told of.
  const untold = [...endpoints.values()].filter((e) => (e.failingSince || lost.has(e.id)) && !e.toldAt);
  const told = new Set<string>();
  for (const endpoint of untold) {
    try {
      if (await tell({ ...endpoint, failingSince: endpoint.failingSince ?? now.toISOString() })) told.add(endpoint.id);
    } catch (err) {
      console.warn(`[webhooks] could not tell the firm about ${endpoint.id}: ${(err as Error).message}`);
    }
  }
  if (lost.size || told.size) {
    await changeIntegrations('endpoints', (held) => {
      for (const endpoint of held.endpoints) {
        if (lost.has(endpoint.id) && !endpoint.failingSince) endpoint.failingSince = now.toISOString();
        if (told.has(endpoint.id)) endpoint.toldAt = now.toISOString();
      }
    });
  }
  out.endpointsFailing = lost.size;
  out.told = told.size;
  return out;
}
