/**
 * A request that leaves the firm and what comes back, over real HTTP with
 * sign-in on.
 *
 * Both outside services are stand-ins: every address this server asks for is
 * answered here, and one that is neither Resend's nor Meta's fails the test
 * (`strays`). So the papers a reply carries are downloaded from a fake, the
 * webhooks are signed here with the secrets the server was given, and a link
 * written in a message is seen never to be fetched.
 *
 * Four people sign in: the firm's owner, one of its staff held to reading in
 * Finance on this project, a viewer of the firm, and a contractor working
 * from a grant. The last three are refused wherever something is sent,
 * confirmed, filed or discarded.
 *
 * The firm, the people, the addresses, the numbers and the papers are
 * invented.
 */

import assert from 'node:assert/strict';
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  OUTSIDE_LIMITS,
  REQUEST_REPLIED_LABEL,
  addChecklistItems,
  addRequest,
  checklistLinesReplied,
  checklistSheet,
  createProject,
  requestStanding,
  setTeamMember,
  type DdProject,
  type ProjectGrant,
  type ProjectRequest,
  type TrayItem,
} from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-outside';
const ISSUER = 'https://securetoken.google.com/realytica-outside';
const AUDIENCE = 'realytica-outside';
const WEBHOOK_SECRET = `whsec_${Buffer.from('a webhook secret of some length').toString('base64')}`;
const APP_SECRET = 'an-app-secret-for-the-test';
const VERIFY_TOKEN = 'a-verify-token-for-the-test';
const PARTY = 'geotech@consultants.example';
const PARTY_PHONE = '+91 90000 00001';
const LINK = 'https://files.elsewhere.example/soil-report.pdf';

const ENV: Record<string, string> = {
  REALYTICA_AUTH_MODE: 'oidc',
  REALYTICA_AUTH_ISSUER: ISSUER,
  REALYTICA_AUTH_AUDIENCE: AUDIENCE,
  REALYTICA_AUTH_JWKS_URL: JWKS_URL,
  REALYTICA_RESEND_API_KEY: 're_test_key',
  REALYTICA_OUTSIDE_SECRET: 'a-signing-secret-for-references',
  REALYTICA_INBOUND_EMAIL_DOMAIN: 'in.builders.example',
  REALYTICA_RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
  REALYTICA_REQUEST_FROM: 'Project office <requests@builders.example>',
  REALYTICA_WHATSAPP_ACCESS_TOKEN: 'wa_test_token',
  REALYTICA_WHATSAPP_PHONE_NUMBER_ID: '100200300',
  REALYTICA_WHATSAPP_TEMPLATE: 'paper_request',
  REALYTICA_WHATSAPP_APP_SECRET: APP_SECRET,
  REALYTICA_WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
};

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(signer.privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

const owner = () => tokenFor('sub-dev', 'dev@builders.example');
const financeViewer = () => tokenFor('sub-vera', 'vera@builders.example');
const firmViewer = () => tokenFor('sub-vik', 'vik@builders.example');
const contractor = () => tokenFor('sub-sam', 'sam@site.example');

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

/* ---- the stand-ins for Resend and Meta ---------------------------------- */

interface FakeFile {
  filename: string;
  content_type: string;
  size?: number;
  bytes: Buffer;
  /** Say a length in the download's own headers, whatever the list said. */
  claims?: number;
  content_disposition?: string;
}
interface FakeMail {
  text?: string;
  dmarc?: string;
  files: FakeFile[];
}

const mails = new Map<string, FakeMail>();
const media = new Map<string, { bytes: Buffer; file_size?: number }>();
let emailsSent: Array<Record<string, unknown>> = [];
let whatsappSent: Array<Record<string, any>> = [];
let downloads: string[] = [];
let strays: string[] = [];
let resendDown = false;

const jsonOf = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function outside(url: string, init?: RequestInit): Promise<Response> {
  const at = new URL(url);
  if (at.origin === 'https://api.resend.com') {
    if (init?.method === 'POST' && at.pathname === '/emails') {
      if (resendDown) return jsonOf({ message: 'down' }, 500);
      emailsSent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonOf({ id: `sent-${emailsSent.length}` });
    }
    const received = /^\/emails\/receiving\/([^/]+)(\/attachments)?$/.exec(at.pathname);
    const mail = received ? mails.get(received[1]!) : undefined;
    if (received && mail && !received[2]) return jsonOf({ id: received[1], text: mail.text ?? null, html: `<a href="${LINK}">here</a>`, authentication: { spf: 'pass', dkim: 'pass', dmarc: mail.dmarc ?? 'pass' } });
    if (received && mail) {
      return jsonOf({
        object: 'list',
        has_more: false,
        data: mail.files.map((file, n) => ({ id: `att-${n}`, filename: file.filename, content_type: file.content_type, content_disposition: file.content_disposition ?? 'attachment', size: file.size ?? file.bytes.length, download_url: `https://inbound-cdn.resend.com/${received[1]}/${n}` })),
      });
    }
    return jsonOf({ message: 'not found' }, 404);
  }
  if (at.origin === 'https://inbound-cdn.resend.com') {
    downloads.push(url);
    const [, id, n] = at.pathname.split('/');
    const file = mails.get(id!)?.files[Number(n)];
    if (!file) return new Response('gone', { status: 404 });
    return new Response(file.bytes, { status: 200, headers: { 'content-length': String(file.claims ?? file.bytes.length) } });
  }
  if (at.origin === 'https://graph.facebook.com') {
    if (init?.method === 'POST' && at.pathname === '/v23.0/100200300/messages') {
      whatsappSent.push(JSON.parse(String(init.body)) as Record<string, any>);
      return jsonOf({ messaging_product: 'whatsapp', messages: [{ id: `wamid.SENT${whatsappSent.length}`, message_status: 'accepted' }] });
    }
    const held = media.get(at.pathname.replace('/v23.0/', ''));
    if (held) return jsonOf({ url: `https://lookaside.fbsbx.com/media${at.pathname.replace('/v23.0', '')}`, mime_type: 'application/pdf', file_size: held.file_size ?? held.bytes.length });
    return jsonOf({ error: 'not found' }, 404);
  }
  if (at.origin === 'https://lookaside.fbsbx.com') {
    downloads.push(url);
    const held = media.get(at.pathname.replace('/media/', ''));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer wa_test_token', 'a paper on WhatsApp is downloaded with the token');
    return held ? new Response(held.bytes, { status: 200 }) : new Response('gone', { status: 404 });
  }
  // Booting reads public reference shelves, which fail here as they do in every test. Anything else asked for is a stray.
  if (!/(^|\.)(ibbi\.gov\.in|opencity\.in|indiacode\.nic\.in|karnataka\.gov\.in|rics\.org|ipmsc\.org|icms-coalition\.org)$/.test(at.hostname)) strays.push(url);
  throw new Error(`this test has no network: ${url}`);
}

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await realFetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a body that is not JSON is itself the answer */
  }
  return { status: res.status, body, headers: res.headers };
}

/* ---- webhooks, signed as each provider signs ----------------------------- */

let deliveries = 0;

/** Post Resend's `email.received`. `as` overrides what a genuine one carries, to make a forged or stale one. */
async function emailArrives(emailId: string, mail: { from: string; to: string[]; subject?: string }, as: { svixId?: string; timestamp?: number; signature?: string } = {}): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: emailId, from: mail.from, to: mail.to, cc: [], bcc: [], subject: mail.subject ?? 'Re: papers', message_id: `<${emailId}@mail.example>`, attachments: [] } });
  const id = as.svixId ?? `msg_${++deliveries}`;
  const timestamp = String(as.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = as.signature ?? `v1,${createHmac('sha256', Buffer.from(WEBHOOK_SECRET.slice(6), 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64')}`;
  const res = await realFetch(`${base}/api/outside/hooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }, body: raw });
  return { status: res.status, body: await res.json() };
}

interface WaMessage {
  id: string;
  from: string;
  type: 'text' | 'document' | 'image' | 'audio';
  text?: string;
  mediaId?: string;
  filename?: string;
  quotes?: string;
}

async function whatsappArrives(messages: WaMessage[], signature?: string): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: '100200300' },
              contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: 'A site engineer' } })),
              messages: messages.map((m) => ({
                from: m.from,
                id: m.id,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: m.type,
                ...(m.type === 'text' ? { text: { body: m.text ?? '' } } : {}),
                ...(m.type === 'document' ? { document: { id: m.mediaId, filename: m.filename, mime_type: 'application/pdf', ...(m.text ? { caption: m.text } : {}) } } : {}),
                ...(m.quotes ? { context: { from: '15550000000', id: m.quotes } } : {}),
              })),
            },
          },
        ],
      },
    ],
  });
  const res = await realFetch(`${base}/api/outside/hooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` }, body: raw });
  return { status: res.status, body: await res.json() };
}

/* ---- the project --------------------------------------------------------- */

let project: DdProject;
let lineId = '';
/** A request raised for the one Finance checklist line, and a plain one. */
let soil: ProjectRequest;
let survey: ProjectRequest;

const stored = async (): Promise<DdProject> => (await import('../apps/api/src/store')).store.data.projects!.find((held) => held.id === project.id)!;
const requestNow = async (id: string): Promise<ProjectRequest> => (await stored()).requests!.find((held) => held.id === id)!;
const tray = async (): Promise<TrayItem[]> => (await call('GET', '/api/outside/tray', { token: owner() })).body.items;
const at = (request: ProjectRequest) => `/api/outside/projects/${project.id}/requests/${request.id}`;
const replyTo = (request: ProjectRequest): string => `reply-${request.dispatches!.at(-1)!.reference}@in.builders.example`;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-outside-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  Object.assign(process.env, ENV);

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) return jsonOf({ keys: [jwkOf(signer.publicKey)] });
    if (url.startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    return outside(url, init);
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  for (const [email, role] of [['vera@builders.example', 'staff'], ['vik@builders.example', 'viewer'], ['sam@site.example', 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201);
  }
  for (const token of [financeViewer, firmViewer, contractor]) assert.equal((await call('GET', '/api/members', { token: token() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-OR1');
  project.tenantId = tenantId;
  setTeamMember(project, { email: 'vera@builders.example', departments: { finance: 'viewer' } }, 'dev@builders.example');
  lineId = addChecklistItems(project, 'finance', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }], 'dev@builders.example').added[0]!.id;
  soil = addRequest(project, { title: 'Soil investigation report', recipient: 'Geotechnical consultant', send: true }, 'dev@builders.example');
  soil.checklistItemIds = [lineId];
  survey = addRequest(project, { title: 'Boundary survey', recipient: 'Surveyor', dueAt: '2026-11-15' }, 'dev@builders.example');
  store.data.projects!.push(project);
  const grant: ProjectGrant = { id: 'grant-sam', tenantId, projectId: project.id, email: 'sam@site.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: 'dev@builders.example' };
  store.data.grants = [grant];
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', ...Object.keys(ENV)]) delete process.env[name];
});

describe('sending a request outside the firm', () => {
  it('says which channels are set up, to the firm only', async () => {
    const status = await call('GET', '/api/outside/status', { token: owner() });
    assert.deepEqual(status.body, { email: { send: true, receive: true, missing: [] }, whatsapp: { send: true, receive: true, missing: [] } });
    assert.equal((await call('GET', '/api/outside/status', { token: contractor() })).status, 404);
    assert.equal((await call('GET', '/api/outside/status')).status, 401);
  });

  it('is refused to a contractor, a viewer of the firm and a viewer in the checklist’s department, and nothing leaves', async () => {
    const body = { channel: 'email', to: PARTY };
    assert.equal((await call('POST', `${at(soil)}/send`, { token: contractor(), body })).status, 404);
    assert.equal((await call('POST', `${at(soil)}/send`, { token: firmViewer(), body })).status, 403);
    const refused = await call('POST', `${at(soil)}/send`, { token: financeViewer(), body });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /finance/);
    assert.equal(emailsSent.length, 0);
    assert.equal((await requestNow(soil.id)).dispatches, undefined);
  });

  it('refuses an address that is not one, and a channel it does not know', async () => {
    assert.equal((await call('POST', `${at(soil)}/send`, { token: owner(), body: { channel: 'email', to: 'not an address' } })).status, 400);
    assert.equal((await call('POST', `${at(soil)}/send`, { token: owner(), body: { channel: 'fax', to: PARTY } })).status, 400);
    assert.equal((await call('POST', `${at(soil)}/send`, { token: owner(), body: { channel: 'whatsapp', to: '12' } })).status, 400);
    assert.equal(emailsSent.length, 0);
  });

  it('mails it with a reply address that names the request by a signed reference', async () => {
    const sent = await call('POST', `${at(soil)}/send`, { token: owner(), body: { channel: 'email', to: PARTY } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    soil = await requestNow(soil.id);
    const dispatch = soil.dispatches![0]!;
    assert.match(dispatch.reference, /^[a-z2-7]{16}-[a-z2-7]{20}$/);
    assert.equal(dispatch.to, PARTY);
    assert.equal(dispatch.by, 'dev@builders.example');
    const mail = emailsSent[0]!;
    assert.deepEqual(mail.to, [PARTY]);
    assert.equal(mail.reply_to, `reply-${dispatch.reference}@in.builders.example`);
    assert.equal(mail.from, 'Project office <requests@builders.example>');
    assert.match(String(mail.text), /Soil investigation report/);
    assert.match(String(mail.text), new RegExp(`Reference: ${dispatch.reference}`));
    assert.equal(mail.html, undefined);
  });

  it('sends a draft, which is then sent', async () => {
    assert.equal((await requestNow(survey.id)).status, 'draft');
    assert.equal((await call('POST', `${at(survey)}/send`, { token: owner(), body: { channel: 'email', to: 'surveyor@measure.example' } })).status, 201);
    survey = await requestNow(survey.id);
    assert.equal(survey.status, 'sent');
    assert.match(String(emailsSent.at(-1)!.text), /Needed by 2026-11-15/);
  });

  it('records nothing when the mail service does not take it', async () => {
    resendDown = true;
    const before = (await requestNow(survey.id)).dispatches!.length;
    const answer = await call('POST', `${at(survey)}/send`, { token: owner(), body: { channel: 'email', to: 'surveyor@measure.example' } });
    resendDown = false;
    assert.equal(answer.status, 502);
    assert.equal((await requestNow(survey.id)).dispatches!.length, before);
  });

  it('does nothing, and says what is missing, where a channel is not set up', async () => {
    const kept = process.env.REALYTICA_INBOUND_EMAIL_DOMAIN;
    delete process.env.REALYTICA_INBOUND_EMAIL_DOMAIN;
    try {
      const status = await call('GET', '/api/outside/status', { token: owner() });
      assert.deepEqual(status.body.email, { send: false, receive: true, missing: ['REALYTICA_INBOUND_EMAIL_DOMAIN'] });
      const sent = emailsSent.length;
      const answer = await call('POST', `${at(soil)}/send`, { token: owner(), body: { channel: 'email', to: PARTY } });
      assert.equal(answer.status, 409);
      assert.match(answer.body.error, /not set up.*REALYTICA_INBOUND_EMAIL_DOMAIN/);
      assert.equal(emailsSent.length, sent);
    } finally {
      process.env.REALYTICA_INBOUND_EMAIL_DOMAIN = kept;
    }
  });
});

describe('a reply by email', () => {
  it('is refused without Resend’s signature, with a wrong one, and with an old one', async () => {
    mails.set('mail-forged', { files: [{ filename: 'Soil investigation report.pdf', content_type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 forged') }] });
    const mail = { from: PARTY, to: [replyTo(soil)] };
    assert.equal((await emailArrives('mail-forged', mail, { signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })).status, 401);
    assert.equal((await emailArrives('mail-forged', mail, { signature: '' })).status, 401);
    assert.equal((await emailArrives('mail-forged', mail, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
    assert.equal((await requestNow(soil.id)).replies, undefined);
    assert.equal((await stored()).evidence.length, 0);
    assert.deepEqual(downloads, []);
  });

  it('puts its paper through intake and leaves the request answered, waiting for a person: never received by itself', async () => {
    mails.set('mail-1', { text: `Please find the report attached. A larger copy is at ${LINK}`, files: [{ filename: 'Soil investigation report.pdf', content_type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 the soil report') }, { filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline', bytes: Buffer.from('png') }] });
    const answer = await emailArrives('mail-1', { from: `The Consultant <${PARTY}>`, to: [replyTo(soil)] });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.outcome, 'reply');

    const now = await stored();
    const request = now.requests!.find((held) => held.id === soil.id)!;
    assert.equal(request.status, 'sent', 'a reply does not answer a request by itself');
    assert.equal(requestStanding(request), 'replied');
    assert.equal(REQUEST_REPLIED_LABEL, 'Answered, waiting for a person to confirm');
    const reply = request.replies![0]!;
    assert.equal(reply.from, PARTY);
    assert.equal(reply.fromName, 'The Consultant');
    assert.ok(Date.now() - Date.parse(reply.receivedAt) < 60_000);
    assert.equal(reply.attachments.length, 1, 'a picture set in the body of a mail is not a paper');
    assert.match(reply.text!, /Please find the report attached/);

    // On the register through the same intake as a dropped file: stored, a row, its file.
    const row = now.evidence.find((held) => held.id === reply.attachments[0]!.evidenceId)!;
    assert.equal(row.attachments[0]!.fileName, 'Soil investigation report.pdf');
    assert.deepEqual(row.unconfirmedReply, { requestId: soil.id, replyId: reply.id });
    const { storageAdapter } = await import('../apps/api/src/storage');
    assert.equal((await storageAdapter.getDocument(now.id, row.attachments[0]!.storageKey))!.toString(), '%PDF-1.4 the soil report');

    // The paper carries the checklist line's own name, and still the line is not in hand.
    const line = checklistSheet(now).stages[0]!.packages[0]!.lines[0]!;
    assert.equal(line.status, 'requested');
    assert.equal(checklistLinesReplied(now).get(lineId)!.reply.id, reply.id);
    assert.equal(now.checklist![0]!.received, undefined);
  });

  it('never fetches a link written in a message', () => {
    assert.deepEqual(strays, []);
    assert.ok(downloads.every((url) => url.startsWith('https://inbound-cdn.resend.com/')));
  });

  it('takes one delivery once: the same webhook again, or the same mail under a new delivery id, changes nothing', async () => {
    const mail = { from: PARTY, to: [replyTo(soil)] };
    const again = await emailArrives('mail-1', mail);
    assert.equal(again.status, 200);
    assert.equal(again.body.outcome, 'duplicate');
    assert.equal((await requestNow(soil.id)).replies!.length, 1);
    assert.equal((await stored()).evidence.length, 1);
  });

  it('leaves out what is over the caps and says so on the reply', async () => {
    const small = (n: number): FakeFile => ({ filename: `sheet-${n}.txt`, content_type: 'text/plain', bytes: Buffer.from(`sheet ${n}`) });
    mails.set('mail-big', {
      files: [
        { filename: 'scan.pdf', content_type: 'application/pdf', size: OUTSIDE_LIMITS.attachmentBytes + 1, bytes: Buffer.from('never read') },
        { filename: 'understated.pdf', content_type: 'application/pdf', size: 10, claims: OUTSIDE_LIMITS.attachmentBytes + 1, bytes: Buffer.from('never kept') },
        ...Array.from({ length: 12 }, (_, n) => small(n)),
      ],
    });
    downloads = [];
    const answer = await emailArrives('mail-big', { from: 'surveyor@measure.example', to: [replyTo(survey)] });
    assert.equal(answer.body.outcome, 'reply', JSON.stringify(answer.body));
    const reply = (await requestNow(survey.id)).replies![0]!;
    assert.equal(reply.attachments.length, OUTSIDE_LIMITS.attachments);
    assert.deepEqual(reply.skipped!.map((held) => held.fileName), ['scan.pdf', 'understated.pdf', 'sheet-10.txt', 'sheet-11.txt']);
    assert.match(reply.skipped![0]!.reason, /Larger than 25 MB/);
    assert.match(reply.skipped![3]!.reason, /More than 10 papers/);
    assert.ok(!downloads.includes('https://inbound-cdn.resend.com/mail-big/0'), 'a paper that says it is over the cap is not downloaded');
  });

  it('is not a reply from an address the project does not know, with no reference, with a forged or expired one, or failing the sender’s own domain: each goes to the tray', async () => {
    const paper = (): FakeFile[] => [{ filename: 'Soil investigation report.pdf', content_type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 from a stranger') }];
    const evidence = (await stored()).evidence.length;
    const replies = (await requestNow(soil.id)).replies!.length;

    mails.set('mail-stranger', { files: paper() });
    assert.deepEqual((await emailArrives('mail-stranger', { from: 'somebody@elsewhere.example', to: [replyTo(soil)] })).body.reason, 'unknown_sender');

    mails.set('mail-bare', { text: 'Here is the report you wanted.', files: paper() });
    assert.equal((await emailArrives('mail-bare', { from: PARTY, to: ['hello@in.builders.example'] })).body.reason, 'no_reference');

    mails.set('mail-made-up', { files: paper() });
    assert.equal((await emailArrives('mail-made-up', { from: PARTY, to: ['reply-abcdefghijklmnop-abcdefghijklmnopqrst@in.builders.example'] })).body.reason, 'unknown_reference');

    mails.set('mail-spoofed', { dmarc: 'fail', files: paper() });
    assert.equal((await emailArrives('mail-spoofed', { from: PARTY, to: [replyTo(soil)] })).body.reason, 'unverified_sender');

    const { store } = await import('../apps/api/src/store');
    const dispatch = (await requestNow(soil.id)).dispatches![0]!;
    const good = dispatch.expiresAt;
    dispatch.expiresAt = new Date(Date.now() - 86_400_000).toISOString();
    await store.save();
    mails.set('mail-late', { files: paper() });
    assert.equal((await emailArrives('mail-late', { from: PARTY, to: [replyTo(soil)] })).body.reason, 'expired');
    (await requestNow(soil.id)).dispatches![0]!.expiresAt = good;
    await store.save();

    assert.equal((await stored()).evidence.length, evidence, 'nothing in the tray is filed into a project by itself');
    assert.equal((await requestNow(soil.id)).replies!.length, replies);
    const items = await tray();
    assert.deepEqual(items.map((item) => item.reason).sort(), ['expired', 'no_reference', 'unknown_reference', 'unknown_sender', 'unverified_sender']);
    assert.equal(items.find((item) => item.reason === 'unknown_sender')!.requestId, soil.id);
    assert.equal(items.find((item) => item.reason === 'no_reference')!.projectId, undefined);
  });

  it('finds the reference in the words of a mail sent to another address', async () => {
    mails.set('mail-quoted', { text: `Attached.\n\n> Reference: ${survey.dispatches!.at(-1)!.reference}`, files: [] });
    const answer = await emailArrives('mail-quoted', { from: 'surveyor@measure.example', to: ['requests@builders.example'] });
    assert.equal(answer.body.outcome, 'reply');
    assert.equal((await requestNow(survey.id)).replies!.length, 2);
  });
});

describe('a person confirms', () => {
  it('is refused to a contractor, a viewer of the firm and a viewer in the department, and nothing changes', async () => {
    const reply = (await requestNow(soil.id)).replies![0]!;
    for (const act of ['confirm', 'set-aside']) {
      assert.equal((await call('POST', `${at(soil)}/replies/${reply.id}/${act}`, { token: contractor() })).status, 404);
      assert.equal((await call('POST', `${at(soil)}/replies/${reply.id}/${act}`, { token: firmViewer() })).status, 403);
      assert.equal((await call('POST', `${at(soil)}/replies/${reply.id}/${act}`, { token: financeViewer() })).status, 403);
    }
    assert.equal(requestStanding(await requestNow(soil.id)), 'replied');
  });

  it('and only then is the request answered, the paper the firm’s, and the checklist line in hand, under their name', async () => {
    const reply = (await requestNow(soil.id)).replies![0]!;
    const answer = await call('POST', `${at(soil)}/replies/${reply.id}/confirm`, { token: owner() });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const now = await stored();
    const request = now.requests!.find((held) => held.id === soil.id)!;
    assert.equal(request.status, 'answered');
    assert.equal(request.replies![0]!.confirmedBy, 'dev@builders.example');
    assert.equal(request.answeredByEvidenceId, reply.attachments[0]!.evidenceId);
    assert.equal(now.evidence.find((held) => held.id === reply.attachments[0]!.evidenceId)!.unconfirmedReply, undefined);
    assert.deepEqual({ by: now.checklist![0]!.received!.by, evidenceId: now.checklist![0]!.received!.evidenceId }, { by: 'dev@builders.example', evidenceId: reply.attachments[0]!.evidenceId });
    assert.equal((await call('POST', `${at(soil)}/replies/${reply.id}/confirm`, { token: owner() })).status, 409, 'a reply is looked at once');
    assert.equal((await call('POST', `${at(soil)}/replies/nothing/confirm`, { token: owner() })).status, 404);
  });

  it('or sets it aside: the request goes on waiting and the papers are marked rejected', async () => {
    const reply = (await requestNow(survey.id)).replies![0]!;
    assert.equal((await call('POST', `${at(survey)}/replies/${reply.id}/set-aside`, { token: owner() })).status, 200);
    const now = await stored();
    const request = now.requests!.find((held) => held.id === survey.id)!;
    assert.equal(request.status, 'sent');
    assert.equal(request.replies![0]!.setAsideBy, 'dev@builders.example');
    assert.equal(requestStanding(request), 'replied', 'the other reply still waits');
    for (const attachment of reply.attachments) assert.equal(now.evidence.find((held) => held.id === attachment.evidenceId)!.status, 'rejected');
  });

  it('a reply to a request since closed goes to the tray', async () => {
    mails.set('mail-after', { files: [] });
    const answer = await emailArrives('mail-after', { from: PARTY, to: [replyTo(soil)] });
    assert.equal(answer.body.reason, 'closed');
  });
});

describe('the tray', () => {
  it('is the firm’s: read by its people, not by a contractor, and changed only by those who may change a record', async () => {
    const items = await tray();
    assert.equal(items.length, 6);
    const item = items.find((held) => held.reason === 'no_reference')!;
    assert.equal((await call('GET', '/api/outside/tray', { token: contractor() })).status, 404);
    assert.equal((await call('GET', '/api/outside/tray', { token: firmViewer() })).status, 200);
    for (const [token, status] of [[contractor, 404], [firmViewer, 403]] as const) {
      assert.equal((await call('POST', `/api/outside/tray/${item.id}/discard`, { token: token() })).status, status);
      assert.equal((await call('POST', `/api/outside/tray/${item.id}/file`, { token: token(), body: { projectId: project.id } })).status, status);
      assert.equal((await call('GET', `/api/outside/tray/${item.id}/papers/${item.attachments[0]!.id}`, { token: token() })).status, token === contractor ? 404 : 200);
    }
    assert.equal((await tray()).length, 6);
  });

  it('hands a paper over as a file to save, never shown in the page', async () => {
    const item = (await tray()).find((held) => held.reason === 'no_reference')!;
    const paper = await call('GET', `/api/outside/tray/${item.id}/papers/${item.attachments[0]!.id}`, { token: owner() });
    assert.equal(paper.status, 200);
    assert.match(paper.headers.get('content-disposition')!, /^attachment; filename="Soil investigation report.pdf"/);
    assert.equal(paper.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(paper.body, '%PDF-1.4 from a stranger');
  });

  it('files an item to a project as the act of the person filing, and to no project of another firm', async () => {
    const item = (await tray()).find((held) => held.reason === 'no_reference')!;
    assert.equal((await call('POST', `/api/outside/tray/${item.id}/file`, { token: owner(), body: {} })).status, 400);
    assert.equal((await call('POST', `/api/outside/tray/${item.id}/file`, { token: owner(), body: { projectId: 'prj_nowhere' } })).status, 404);
    assert.equal((await call('POST', `/api/outside/tray/nothing/file`, { token: owner(), body: { projectId: project.id } })).status, 404);
    const before = (await stored()).evidence.length;
    const answer = await call('POST', `/api/outside/tray/${item.id}/file`, { token: owner(), body: { projectId: project.id } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const now = await stored();
    assert.equal(now.evidence.length, before + 1);
    const row = now.evidence.at(-1)!;
    assert.equal(row.unconfirmedReply, undefined);
    assert.equal(row.source, `From ${PARTY}, filed from the tray`);
    assert.ok(now.audit.some((event) => event.action === 'tray_filed' && event.actor === 'dev@builders.example'));
    assert.ok(!(await tray()).some((held) => held.id === item.id));
    assert.equal((await call('GET', `/api/outside/tray/${item.id}/papers/${item.attachments[0]!.id}`, { token: owner() })).status, 404, 'its papers leave the tray with it');
  });

  it('files an item for a request, which that person thereby confirms', async () => {
    const item = (await tray()).find((held) => held.reason === 'unknown_sender')!;
    const answer = await call('POST', `/api/outside/tray/${item.id}/file`, { token: owner(), body: { projectId: project.id, requestId: survey.id } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const request = await requestNow(survey.id);
    assert.equal(request.status, 'answered');
    const reply = request.replies!.at(-1)!;
    assert.equal(reply.from, 'somebody@elsewhere.example');
    assert.equal(reply.confirmedBy, 'dev@builders.example');
    assert.equal((await call('POST', `/api/outside/tray/${(await tray())[0]!.id}/file`, { token: owner(), body: { projectId: project.id, requestId: survey.id } })).status, 409, 'not for a request that is closed');
  });

  it('discards an item and its papers', async () => {
    const item = (await tray()).find((held) => held.reason === 'unknown_reference')!;
    const answer = await call('POST', `/api/outside/tray/${item.id}/discard`, { token: owner() });
    assert.equal(answer.status, 200);
    assert.ok(!answer.body.items.some((held: TrayItem) => held.id === item.id));
    assert.equal((await call('POST', `/api/outside/tray/${item.id}/discard`, { token: owner() })).status, 404);
    const { storageAdapter } = await import('../apps/api/src/storage');
    assert.equal(await storageAdapter.getDocument(`outside-tray-${item.tenantId}`, item.attachments[0]!.storageKey), null);
  });
});

describe('WhatsApp', () => {
  let levels: ProjectRequest;

  before(async () => {
    const { store } = await import('../apps/api/src/store');
    levels = addRequest(await stored(), { title: 'Plinth level certificate', recipient: 'Site engineer' }, 'dev@builders.example');
    await store.save();
  });

  it('answers Meta’s handshake with the challenge, for the token it registered and no other', async () => {
    const good = await realFetch(`${base}/api/outside/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
    assert.equal(good.status, 200);
    assert.equal(await good.text(), '1158201444');
    assert.equal((await realFetch(`${base}/api/outside/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1`)).status, 403);
    assert.equal((await realFetch(`${base}/api/outside/hooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`)).status, 403);
  });

  it('sends a request as the approved template, with the reference among its values', async () => {
    assert.equal((await call('POST', `${at(levels)}/send`, { token: firmViewer(), body: { channel: 'whatsapp', to: PARTY_PHONE } })).status, 403);
    const sent = await call('POST', `${at(levels)}/send`, { token: owner(), body: { channel: 'whatsapp', to: PARTY_PHONE } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    levels = await requestNow(levels.id);
    const dispatch = levels.dispatches![0]!;
    assert.equal(dispatch.to, '919000000001');
    assert.equal(dispatch.providerId, 'wamid.SENT1');
    const message = whatsappSent[0]!;
    assert.equal(message.to, '919000000001');
    assert.equal(message.type, 'template');
    assert.equal(message.template.name, 'paper_request');
    assert.deepEqual(message.template.components[0].parameters.map((held: { text: string }) => held.text), ['Lake Road offices', 'Plinth level certificate', 'as soon as you can', dispatch.reference]);
  });

  it('refuses a post without Meta’s signature', async () => {
    media.set('media-1', { bytes: Buffer.from('%PDF-1.4 plinth levels') });
    const message: WaMessage = { id: 'wamid.IN1', from: '919000000001', type: 'document', mediaId: 'media-1', filename: 'plinth-levels.pdf', quotes: 'wamid.SENT1' };
    assert.equal((await whatsappArrives([message], 'sha256=0000000000000000000000000000000000000000000000000000000000000000')).status, 401);
    assert.equal((await whatsappArrives([message], 'nothing')).status, 401);
    assert.equal((await requestNow(levels.id)).replies, undefined);
  });

  it('takes a paper that quotes the request as its reply, waiting for a person, and takes it once', async () => {
    downloads = [];
    const message: WaMessage = { id: 'wamid.IN1', from: '919000000001', type: 'document', mediaId: 'media-1', filename: 'plinth-levels.pdf', quotes: 'wamid.SENT1' };
    const answer = await whatsappArrives([message]);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.outcomes[0].outcome, 'reply');
    const request = await requestNow(levels.id);
    assert.equal(request.status, 'sent');
    assert.equal(requestStanding(request), 'replied');
    assert.equal(request.replies![0]!.channel, 'whatsapp');
    assert.equal(request.replies![0]!.fromName, 'A site engineer');
    assert.equal(request.replies![0]!.attachments[0]!.fileName, 'plinth-levels.pdf');
    assert.deepEqual(downloads, ['https://lookaside.fbsbx.com/media/media-1']);

    assert.equal((await whatsappArrives([message])).body.outcomes[0].outcome, 'duplicate');
    assert.equal((await requestNow(levels.id)).replies!.length, 1);
  });

  it('takes a message that carries the reference in its words, and leaves out a paper over the cap', async () => {
    media.set('media-huge', { bytes: Buffer.from('x'), file_size: OUTSIDE_LIMITS.attachmentBytes + 1 });
    const answer = await whatsappArrives([{ id: 'wamid.IN2', from: '919000000001', type: 'document', mediaId: 'media-huge', filename: 'all-drawings.pdf', text: `For ${levels.dispatches![0]!.reference}` }]);
    assert.equal(answer.body.outcomes[0].outcome, 'reply');
    const reply = (await requestNow(levels.id)).replies![1]!;
    assert.equal(reply.attachments.length, 0);
    assert.equal(reply.skipped![0]!.fileName, 'all-drawings.pdf');
  });

  it('sends a number the project does not know, and a message that names no request, to the tray, and ignores what is neither words nor a paper', async () => {
    const before = (await tray()).length;
    const answer = await whatsappArrives([
      { id: 'wamid.IN3', from: '447000000009', type: 'text', text: 'Sending this for you', quotes: 'wamid.SENT1' },
      { id: 'wamid.IN4', from: '919000000001', type: 'text', text: `Is this the right number? See ${LINK}` },
      { id: 'wamid.IN5', from: '919000000001', type: 'audio' },
    ]);
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body.outcomes.map((held: { reason: string }) => held.reason), ['unknown_sender', 'no_reference']);
    assert.equal((await tray()).length, before + 2);
    assert.equal((await requestNow(levels.id)).replies!.length, 2);
    assert.deepEqual(strays, [], 'no address written in a message was fetched');
  });

  it('does nothing where WhatsApp is not set up', async () => {
    const kept = process.env.REALYTICA_WHATSAPP_APP_SECRET;
    delete process.env.REALYTICA_WHATSAPP_APP_SECRET;
    try {
      assert.equal((await whatsappArrives([{ id: 'wamid.IN6', from: '919000000001', type: 'text', text: 'hello' }])).status, 503);
    } finally {
      process.env.REALYTICA_WHATSAPP_APP_SECRET = kept;
    }
  });
});
