/**
 * The two outside services, and nothing else.
 *
 * Resend sends a request by email and holds what comes back: a webhook says
 * a mail arrived (signed as Svix signs), and its words and papers are read
 * from Resend's own API. Meta's WhatsApp Cloud API sends a request as an
 * approved template and posts what comes back, signed with the app secret;
 * a paper is fetched by its media id.
 *
 * Every address fetched here is one of those two services': their API, or a
 * download address their API handed back, on a host of theirs
 * (`downloadFrom`). Nothing written in a message is ever fetched. An address
 * a sender typed is their words, and stays words.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from '@realytica/agents';
import { OUTSIDE_LIMITS } from '@realytica/shared';

const CALL_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 25_000;

/** A provider that answered, and not with what was asked for. */
export class ProviderRefused extends Error {}

/** A paper larger than a message may carry. */
export class TooLarge extends Error {}

async function call(url: string, init: RequestInit, timeoutMs = CALL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const res = await call(url, init);
  if (!res.ok) throw new ProviderRefused(`${what} was refused: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Bytes from a download address a provider's API handed back. The address
 * must be https on one of that provider's hosts, and the body is read no
 * further than `maxBytes`.
 */
async function downloadFrom(url: string, hosts: readonly string[], headers: Record<string, string>, maxBytes: number): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderRefused('The provider gave no address to download from.');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) throw new ProviderRefused(`A download from ${host} is not the provider’s.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(parsed, { headers, signal: controller.signal });
    if (!res.ok) throw new ProviderRefused(`A download was refused: ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new TooLarge('Larger than a message may carry.');
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        throw new TooLarge('Larger than a message may carry.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

function sameBytes(given: string, wanted: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(wanted);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ==================================================================== */
/* Resend                                                                */
/* ==================================================================== */

const RESEND = 'https://api.resend.com';
const RESEND_HOSTS = ['resend.com', 'resend.app'];
/** How far a webhook's own time may be from this server's: older is a replay. */
const WEBHOOK_TOLERANCE_S = 5 * 60;

const resendAuth = (): Record<string, string> => ({ authorization: `Bearer ${readEnv('RESEND_API_KEY') ?? ''}` });

/** Send a request by email. The reply address carries the reference. Hands back Resend's id for the mail. */
export async function sendRequestEmail(mail: { to: string; replyTo: string; subject: string; text: string }): Promise<string | undefined> {
  // Who it is from: as set, or the requests mailbox on the domain replies come back to.
  const from = readEnv('REQUEST_FROM') ?? readEnv('ALERT_FROM') ?? `Realytica <requests@${readEnv('INBOUND_EMAIL_DOMAIN') ?? ''}>`;
  const sent = await json<{ id?: string }>(
    `${RESEND}/emails`,
    { method: 'POST', headers: { 'content-type': 'application/json', ...resendAuth() }, body: JSON.stringify({ from, to: [mail.to], reply_to: mail.replyTo, subject: mail.subject, text: mail.text }) },
    'The email',
  );
  return sent.id;
}

/**
 * Whether a webhook is Resend's: the Svix signature over `id.timestamp.body`
 * under the endpoint's secret, on the body exactly as it arrived, and a
 * timestamp within five minutes of now. Never without a secret set.
 */
export function resendWebhookHolds(headers: { id?: string; timestamp?: string; signature?: string }, rawBody: Buffer, now = Date.now()): boolean {
  const secret = readEnv('RESEND_WEBHOOK_SECRET');
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const at = Number(headers.timestamp);
  if (!Number.isFinite(at) || Math.abs(now / 1000 - at) > WEBHOOK_TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const wanted = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.`).update(rawBody).digest('base64');
  return headers.signature.split(' ').some((entry) => {
    const [version, given] = entry.split(',');
    return version === 'v1' && Boolean(given) && sameBytes(given!, wanted);
  });
}

export interface ReceivedEmail {
  text?: string;
  /** True only where the receiving server found the sender's own domain vouched for the mail. */
  verified: boolean;
}

/**
 * A received mail's own words, and whether its sender's domain vouched for it. Its HTML is never read.
 *
 * Vouched for is DMARC passing: SPF or DKIM passed for the very domain in
 * `From`. Anything else is not: a domain that publishes no DMARC answers
 * `none`, and a forged `From` sent through the forger's own server then
 * passes SPF for the forger's domain, which says nothing of whose mail it is.
 */
export async function receivedEmail(emailId: string): Promise<ReceivedEmail> {
  const mail = await json<{ text?: string | null; authentication?: { dmarc?: string | null; spf?: string | null; dkim?: string | null } | null }>(`${RESEND}/emails/receiving/${encodeURIComponent(emailId)}`, { headers: resendAuth() }, 'Reading the mail');
  const dmarc = mail.authentication?.dmarc;
  return { ...(mail.text ? { text: mail.text } : {}), verified: typeof dmarc === 'string' && /^pass/i.test(dmarc) };
}

export interface ProviderFile {
  fileName: string;
  mimeType: string;
  /** As the provider states it, where it does. */
  sizeBytes?: number;
  /** Not a paper somebody attached: a picture set in the body of a mail. */
  inline?: boolean;
  bytes(maxBytes: number): Promise<Buffer>;
}

/** The papers of a received mail, each downloaded only when asked for. */
export async function receivedAttachments(emailId: string): Promise<ProviderFile[]> {
  const list = await json<{ data?: Array<{ filename?: string; content_type?: string; content_disposition?: string | null; size?: number; download_url?: string }> }>(
    `${RESEND}/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=100`,
    { headers: resendAuth() },
    'Listing the papers',
  );
  return (list.data ?? []).map((held) => ({
    fileName: held.filename ?? 'attachment',
    mimeType: held.content_type ?? 'application/octet-stream',
    ...(typeof held.size === 'number' ? { sizeBytes: held.size } : {}),
    inline: held.content_disposition === 'inline',
    bytes: (maxBytes) => downloadFrom(held.download_url ?? '', RESEND_HOSTS, {}, maxBytes),
  }));
}

/* ==================================================================== */
/* WhatsApp                                                              */
/* ==================================================================== */

const META_HOSTS = ['facebook.com', 'fbsbx.com', 'fbcdn.net', 'whatsapp.net'];

const graph = (): string => `https://graph.facebook.com/${readEnv('WHATSAPP_GRAPH_VERSION') ?? 'v23.0'}`;
const metaAuth = (): Record<string, string> => ({ authorization: `Bearer ${readEnv('WHATSAPP_ACCESS_TOKEN') ?? ''}` });

/** Send a request as the approved template, its body values in order. Hands back the message id a reply can quote. */
export async function sendRequestWhatsApp(to: string, values: readonly string[]): Promise<string | undefined> {
  const sent = await json<{ messages?: Array<{ id?: string }> }>(
    `${graph()}/${encodeURIComponent(readEnv('WHATSAPP_PHONE_NUMBER_ID') ?? '')}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...metaAuth() },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: { name: readEnv('WHATSAPP_TEMPLATE'), language: { code: readEnv('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en' }, components: [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }] },
      }),
    },
    'The WhatsApp message',
  );
  return sent.messages?.[0]?.id;
}

/** Whether a post is Meta's: `X-Hub-Signature-256` is the HMAC of the body, as it arrived, under the app secret. Never without one set. */
export function whatsappWebhookHolds(signature: string | undefined, rawBody: Buffer): boolean {
  const secret = readEnv('WHATSAPP_APP_SECRET');
  if (!secret || !signature?.startsWith('sha256=')) return false;
  return sameBytes(signature.slice(7).toLowerCase(), createHmac('sha256', secret).update(rawBody).digest('hex'));
}

/** Whether a handshake carries the token this deployment registered. Never without one set. */
export function whatsappHandshakeHolds(mode: unknown, token: unknown): boolean {
  const wanted = readEnv('WHATSAPP_VERIFY_TOKEN');
  return Boolean(wanted) && mode === 'subscribe' && typeof token === 'string' && sameBytes(token, wanted!);
}

/** A paper sent on WhatsApp, by its media id: asked of Meta for its address and size, then downloaded with the token. */
export function whatsappMedia(mediaId: string, fileName: string, mimeType: string): ProviderFile {
  return {
    fileName,
    mimeType,
    bytes: async (maxBytes) => {
      const phone = readEnv('WHATSAPP_PHONE_NUMBER_ID');
      const media = await json<{ url?: string; file_size?: number }>(`${graph()}/${encodeURIComponent(mediaId)}${phone ? `?phone_number_id=${encodeURIComponent(phone)}` : ''}`, { headers: metaAuth() }, 'Finding the paper');
      if ((media.file_size ?? 0) > maxBytes) throw new TooLarge('Larger than a message may carry.');
      return downloadFrom(media.url ?? '', META_HOSTS, metaAuth(), Math.min(maxBytes, OUTSIDE_LIMITS.attachmentBytes));
    },
  };
}
