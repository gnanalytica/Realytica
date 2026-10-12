/**
 * What this deployment can send to an outside party and take back, and the
 * reference that ties a reply to its request.
 *
 * Everything here hangs on environment variables, each read as
 * `REALYTICA_<NAME>`. With any of them absent the channel does nothing and
 * says which are missing (`outsideStatus`), so a page can say so plainly.
 *
 * Email (Resend, the provider alerts already go out through):
 *   RESEND_API_KEY          sends, and reads a received mail and its papers
 *   OUTSIDE_SECRET          signs the reference on every request
 *   INBOUND_EMAIL_DOMAIN    the domain Resend receives mail for; a request's reply address is on it
 *   RESEND_WEBHOOK_SECRET   the signing secret of the `email.received` webhook (`whsec_…`)
 *   REQUEST_FROM            optional: who a request is from; `ALERT_FROM` otherwise, else `requests@` the inbound domain
 *
 * WhatsApp (Meta's Cloud API):
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID   send, and download media
 *   WHATSAPP_TEMPLATE         the approved template a request goes out as: four body values
 *   WHATSAPP_TEMPLATE_LANGUAGE  optional, `en` otherwise
 *   WHATSAPP_APP_SECRET       checks `X-Hub-Signature-256` on what Meta posts
 *   WHATSAPP_VERIFY_TOKEN     answers Meta's handshake when the webhook is registered
 *   WHATSAPP_GRAPH_VERSION    optional, `v23.0` otherwise
 *
 * A reference is `<code>-<signature>`: sixteen random letters, and twenty
 * more that are an HMAC of them under `OUTSIDE_SECRET`. It cannot be guessed
 * and cannot be made up: one whose signature does not hold is not looked up
 * at all. What it names is kept in storage beside the papers
 * (`rememberReference`), so any instance can find the request it belongs to.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { envName, readEnv } from '@realytica/agents';
import type { OutsideChannel } from '@realytica/shared';
import { storageAdapter } from '../storage';

export interface ChannelStatus {
  send: boolean;
  receive: boolean;
  /** The variables still to set, by their full names. */
  missing: string[];
}

function standing(send: string[], receive: string[]): ChannelStatus {
  const absent = (names: string[]) => names.filter((name) => !readEnv(name));
  return { send: absent(send).length === 0, receive: absent(receive).length === 0, missing: [...new Set([...absent(send), ...absent(receive)])].map(envName) };
}

export function outsideStatus(): Record<OutsideChannel, ChannelStatus> {
  return {
    email: standing(['RESEND_API_KEY', 'OUTSIDE_SECRET', 'INBOUND_EMAIL_DOMAIN'], ['RESEND_API_KEY', 'OUTSIDE_SECRET', 'RESEND_WEBHOOK_SECRET']),
    whatsapp: standing(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE', 'OUTSIDE_SECRET'], ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'OUTSIDE_SECRET']),
  };
}

/* ==================================================================== */
/* The reference                                                         */
/* ==================================================================== */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, length);
}

function signatureOf(code: string, secret: string): string {
  return base32(createHmac('sha256', secret).update(`request-reference:${code}`).digest().subarray(0, 13), 20);
}

/** A new reference, or nothing where no secret is set. */
export function mintReference(): string | undefined {
  const secret = readEnv('OUTSIDE_SECRET');
  if (!secret) return undefined;
  const code = base32(randomBytes(10), 16);
  return `${code}-${signatureOf(code, secret)}`;
}

const REFERENCE = /(?<![a-z2-7])([a-z2-7]{16})-([a-z2-7]{20})(?![a-z2-7])/gi;

/** Every string in a text that is shaped like a reference, as written, lower-cased. Shaped like one is not being one. */
export function referencesIn(text: string | undefined): string[] {
  return [...(text ?? '').matchAll(REFERENCE)].map((match) => `${match[1]}-${match[2]}`.toLowerCase());
}

/** Whether a reference carries this deployment's signature. Never without a secret set. */
export function referenceHolds(reference: string): boolean {
  const secret = readEnv('OUTSIDE_SECRET');
  const match = /^([a-z2-7]{16})-([a-z2-7]{20})$/.exec(reference);
  if (!secret || !match) return false;
  const given = Buffer.from(match[2]!);
  const wanted = Buffer.from(signatureOf(match[1]!, secret));
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The address a reply to this reference is sent to. */
export function replyAddress(reference: string): string | undefined {
  const domain = readEnv('INBOUND_EMAIL_DOMAIN')?.trim().toLowerCase();
  return domain ? `reply-${reference}@${domain}` : undefined;
}

/** What a reference names. Kept in storage, apart from any project. */
export interface ReferenceTarget {
  tenantId: string;
  projectId: string;
  requestId: string;
}

const REFERENCES = 'outside-references';

const quotedKey = (providerId: string): string => `quoted-${createHash('sha256').update(providerId).digest('hex').slice(0, 40)}.json`;

export async function rememberReference(reference: string, target: ReferenceTarget): Promise<void> {
  await storageAdapter.putDocument(REFERENCES, `${reference}.json`, Buffer.from(JSON.stringify(target)), 'application/json');
}

export async function forgetReference(reference: string): Promise<void> {
  await storageAdapter.deleteDocument(REFERENCES, `${reference}.json`);
}

/** What a reference names, for one whose signature holds. Nothing is read for any other. */
export async function referenceTarget(reference: string): Promise<ReferenceTarget | undefined> {
  if (!referenceHolds(reference)) return undefined;
  const bytes = await storageAdapter.getDocument(REFERENCES, `${reference}.json`);
  if (!bytes) return undefined;
  const held = JSON.parse(bytes.toString('utf-8')) as Partial<ReferenceTarget>;
  return held.tenantId && held.projectId && held.requestId ? { tenantId: held.tenantId, projectId: held.projectId, requestId: held.requestId } : undefined;
}

/** A WhatsApp message a reply may quote, and the reference it went out with. */
export async function rememberQuoted(providerId: string, reference: string): Promise<void> {
  await storageAdapter.putDocument(REFERENCES, quotedKey(providerId), Buffer.from(JSON.stringify({ reference })), 'application/json');
}

export async function quotedReference(providerId: string): Promise<string | undefined> {
  const bytes = await storageAdapter.getDocument(REFERENCES, quotedKey(providerId));
  if (!bytes) return undefined;
  const reference = (JSON.parse(bytes.toString('utf-8')) as { reference?: unknown }).reference;
  return typeof reference === 'string' ? reference : undefined;
}
