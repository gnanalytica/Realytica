/**
 * Where the integrations keep what they hold: four small documents of their
 * own, beside the projects' and outside the workspace document.
 *
 * Outside it on purpose. The workspace document is read into every instance
 * and written back field by field; a log that gains a line on every request a
 * key makes, or on every delivery, would be rewritten with it, and a write
 * racing an admin's would put a revoked key back. Here each document has one
 * kind of writer: the keys and the endpoints are written when an admin
 * changes them, the two logs when a machine calls or is called.
 *
 * Every change reads the document as storage has it now and writes it
 * straight back, one change at a time on an instance, so what one instance
 * wrote is not undone by another's older copy. Two instances writing the same
 * document in the same instant still resolve last-writer-wins: a line of a
 * log can be lost that way, a key or an endpoint only if two admins change
 * them at once.
 */

import type { ApiKeyScope, WebhookEventType } from '@realytica/shared';
import { storageAdapter } from '../storage';

/** The folder these documents live in. No project has this id: a project's begins `prj_`. */
const HOLDER = '_integrations';

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  /** The start of the key, kept so a person can tell which one a row is. Not secret. */
  prefix: string;
  /** Random, one a key. */
  salt: string;
  /** HMAC-SHA256 of the key under its salt. The key itself is never stored. */
  hash: string;
  scopes: ApiKeyScope[];
  /** The only projects it reaches. Absent: every project of the firm. */
  projectIds?: string[];
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/** One request a key made. */
export interface KeyUse {
  at: string;
  keyId: string;
  method: string;
  path: string;
  status: number;
}

export interface EndpointRecord {
  id: string;
  tenantId: string;
  url: string;
  events: WebhookEventType[];
  /** The signing secret, sealed. Shown once when the endpoint is made. */
  secret: string;
  createdAt: string;
  createdBy: string;
  /** Set when deliveries gave up. Nothing is sent to it until a test delivery goes through. */
  failingSince?: string;
  /** When the firm's admins were told it is failing. */
  toldAt?: string;
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'gave_up';

export interface DeliveryRecord {
  id: string;
  endpointId: string;
  tenantId: string;
  /** The event's id: the same on every attempt, and what the receiver drops a repeat by. */
  eventId: string;
  type: string;
  projectId?: string;
  createdAt: string;
  attempts: number;
  status: DeliveryStatus;
  /** The receiver's last answer, or why there was none. */
  lastStatus?: number;
  lastError?: string;
  lastAttemptAt?: string;
  /** While it is to be tried again. */
  nextAttemptAt?: string;
  /** What is sent, byte for byte. Kept only while it may be sent again. */
  body?: string;
}

interface Documents {
  keys: { keys: ApiKeyRecord[] };
  uses: { uses: KeyUse[]; lastUsedAt: Record<string, string> };
  endpoints: { endpoints: EndpointRecord[] };
  deliveries: { deliveries: DeliveryRecord[]; emitted: string[] };
}

const EMPTY: { [K in keyof Documents]: () => Documents[K] } = {
  keys: () => ({ keys: [] }),
  uses: () => ({ uses: [], lastUsedAt: {} }),
  endpoints: () => ({ endpoints: [] }),
  deliveries: () => ({ deliveries: [], emitted: [] }),
};

/** A document as storage has it now. One that was never written, or cannot be parsed, reads as empty. */
export async function readIntegrations<K extends keyof Documents>(name: K): Promise<Documents[K]> {
  const bytes = await storageAdapter.getDocument(HOLDER, `${name}.json`);
  if (!bytes) return EMPTY[name]();
  try {
    return { ...EMPTY[name](), ...(JSON.parse(bytes.toString('utf-8')) as Documents[K]) };
  } catch {
    console.warn(`[integrations] ${name}.json could not be read and is taken as empty`);
    return EMPTY[name]();
  }
}

/** One change at a time a document, on this instance: a change that read before another wrote would write the other's away. */
const queues = new Map<string, Promise<unknown>>();

/** Read a document fresh, change it, and write it back. Answers with whatever the change returns. */
export async function changeIntegrations<K extends keyof Documents, T>(name: K, change: (held: Documents[K]) => T): Promise<T> {
  const run = async (): Promise<T> => {
    const held = await readIntegrations(name);
    const out = change(held);
    await storageAdapter.putDocument(HOLDER, `${name}.json`, Buffer.from(JSON.stringify(held)), 'application/json');
    return out;
  };
  const next = (queues.get(name) ?? Promise.resolve()).then(run, run);
  queues.set(name, next.catch(() => undefined));
  return next;
}
