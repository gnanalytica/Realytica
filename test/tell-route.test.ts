/**
 * What I have been told, over real HTTP with sign-in on, and what leaves
 * the app.
 *
 * Five people sign in: the firm's owner, a manager, one of its staff who
 * leads Legal on this project and files the papers, a viewer, and a
 * contractor working from a grant on one project of two. A save writes the
 * notices; each person reads only their own, and the two who are told
 * nothing (the viewer and the contractor) can neither read nor mark the
 * owner's. The contractor cannot quiet a project they hold no grant on.
 *
 * Mail and push are faked: every call to the mail service and the push
 * service is caught here and counted. Ten papers filed together are one
 * mail a person, sent once however often the timer runs, to nobody who
 * quieted the project, and to nobody at all with no mail key set.
 *
 * Marking and quieting read the project from storage first, so an instance
 * whose copy is old writes nothing over what another saved. A save does not
 * wait for the mail service; a message it refused is tried again by the
 * timer; a push is made once; and a write that failed leaves nothing marked
 * as sent.
 *
 * The firm, the people, the projects and the papers are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { TELL_BATCH_MS, addEvidence, attachEvidenceFile, createProject, setTeamMember, type DdProject, type ProjectGrant } from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-tell';
const ISSUER = 'https://securetoken.google.com/realytica-tell';
const AUDIENCE = 'realytica-tell';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

function jwkOf(key: KeyObject) {
  return { ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
}

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

/** Every call that would have left for the mail service or the push service. */
const mail: Array<{ to: string[]; subject: string; text: string; key: string | null; authorization: string | null }> = [];
const push: Array<Array<{ to: string; title: string; body: string }>> = [];
/** The mail service refusing what it is sent, or not answering until this settles. */
let mailRefused = false;
let mailWaits: Promise<void> | undefined;

async function call(method: string, route: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
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
  return { status: res.status, body };
}

const OWNER = 'dev@builders.example';
const MANAGER = 'mira@builders.example';
const LEAD = 'lina@builders.example';
const VIEWER = 'vera@builders.example';
const CONTRACTOR = 'sam@site.example';
const owner = () => tokenFor('sub-dev', OWNER);
const manager = () => tokenFor('sub-mira', MANAGER);
const lead = () => tokenFor('sub-lina', LEAD);
const viewer = () => tokenFor('sub-vera', VIEWER);
const contractor = () => tokenFor('sub-sam', CONTRACTOR);

let project: DdProject;
let other: DdProject;

/** File papers on the project as its Legal lead does, and save, as a route would. */
async function fileAs(by: string, ...titles: string[]): Promise<void> {
  const { store } = await import('../apps/api/src/store');
  for (const title of titles) {
    const row = addEvidence(project, { title, kind: 'document', status: 'expected' }, by);
    row.documentType = 'Sale deed';
    attachEvidenceFile(project, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `store/${title}.pdf` }, by);
  }
  await store.save();
}

const afterAMessagesWorth = () => new Date(Date.now() + TELL_BATCH_MS + 60_000);

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-tell-route-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  process.env.REALYTICA_RESEND_API_KEY = 'not-a-real-key';

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('http://127.0.0.1')) return realFetch(input as string, init);
    const headers = new Headers(init?.headers);
    if (url === 'https://api.resend.com/emails') {
      const sent = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
      if (mailWaits) await mailWaits;
      if (mailRefused) return new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 });
      mail.push({ to: sent.to, subject: sent.subject, text: sent.text, key: headers.get('idempotency-key'), authorization: headers.get('authorization') });
      return new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 });
    }
    if (url === 'https://exp.host/--/api/v2/push/send') {
      push.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 });
    }
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  for (const [email, role] of [[MANAGER, 'manager'], [LEAD, 'staff'], [VIEWER, 'viewer'], [CONTRACTOR, 'collaborator']] as const) {
    assert.equal((await call('POST', '/api/members', { token: owner(), body: { email, role } })).status, 201);
  }
  for (const token of [manager(), lead(), viewer(), contractor()]) assert.equal((await call('GET', '/api/members', { token })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TL1');
  project.tenantId = tenantId;
  setTeamMember(project, { email: LEAD, departments: { legal: 'lead' } }, OWNER);
  other = createProject({ name: 'Hill Street flats', type: 'residential', location: 'Hill Street', city: 'Kadamba' }, 'RYT-TL2');
  other.tenantId = tenantId;
  store.data.projects!.push(project, other);
  // The contractor works on the first project only, from a grant that reaches no assessment.
  const grant: ProjectGrant = { id: 'grant-sam', tenantId, projectId: project.id, email: CONTRACTOR, role: 'contributor', allAssessments: false, assessmentIds: [], allScopes: false, scopeKeys: [], areas: [], createdAt: new Date().toISOString(), createdBy: OWNER };
  store.data.grants = [grant];
  // The owner has paired a phone.
  store.data.devices = [{ id: 'dev-1', tenantId, email: OWNER, subject: 'sub-dev', name: 'A phone', tokenHash: 'hash', pushToken: 'ExponentPushToken[invented]', createdAt: new Date().toISOString() }];
  await store.save();
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_RESEND_API_KEY']) delete process.env[name];
});

describe('what I have been told', () => {
  it('needs a sign-in', async () => {
    assert.equal((await call('GET', '/api/tell')).status, 401);
    assert.equal((await call('POST', '/api/tell/read', { body: { ids: 'all' } })).status, 401);
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { body: { quiet: true } })).status, 401);
  });

  it('is each person’s own: the owner and the manager are told of ten papers, the lead who filed them, the viewer and the contractor of none', async () => {
    await fileAs(LEAD, ...Array.from({ length: 10 }, (_, n) => `Sale deed ${n + 1}`));
    const mine = await call('GET', '/api/tell', { token: owner() });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.notices.length, 10);
    assert.equal(mine.body.unread, 10);
    assert.deepEqual(mine.body.channels, { email: true, push: true });
    assert.deepEqual([mine.body.notices[0].projectName, mine.body.notices[0].action], ['Lake Road offices', 'Read it.']);
    assert.equal((await call('GET', '/api/tell', { token: manager() })).body.notices.length, 10);
    assert.deepEqual((await call('GET', '/api/tell', { token: manager() })).body.channels, { email: true, push: false });
    for (const token of [lead(), viewer(), contractor()]) {
      const theirs = await call('GET', '/api/tell', { token });
      assert.equal(theirs.status, 200);
      assert.deepEqual([theirs.body.notices, theirs.body.unread], [[], 0]);
    }
    assert.equal(mail.length + push.length, 0, 'and nothing has left the app yet');
  });

  it('refuses a viewer and a contractor who name the owner’s notices, and leaves them unread', async () => {
    const ids = (await call('GET', '/api/tell', { token: owner() })).body.notices.map((notice: { id: string }) => notice.id);
    for (const token of [viewer(), contractor()]) {
      assert.equal((await call('POST', '/api/tell/read', { token, body: { ids } })).status, 404);
      assert.deepEqual((await call('POST', '/api/tell/read', { token, body: { ids: 'all' } })).body, { read: 0 });
    }
    assert.equal((await call('GET', '/api/tell', { token: owner() })).body.unread, 10);
  });

  it('refuses a contractor quieting a project they hold no grant on, as if it were not there', async () => {
    assert.equal((await call('PUT', `/api/tell/quiet/${other.id}`, { token: contractor(), body: { quiet: true } })).status, 404);
    assert.equal((await call('PUT', '/api/tell/quiet/no-such-project', { token: owner(), body: { quiet: true } })).status, 404);
    assert.deepEqual(other.tell?.quiet ?? [], []);
    // Their own project is theirs to quiet, as it is a viewer's: the setting is nobody else's.
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: contractor(), body: { quiet: true } })).status, 200);
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: viewer(), body: { quiet: true } })).status, 200);
    assert.deepEqual((await call('GET', '/api/tell', { token: viewer() })).body.quiet, [{ projectId: project.id, projectName: 'Lake Road offices', projectReference: 'RYT-TL1' }]);
    assert.deepEqual((await call('GET', '/api/tell', { token: owner() })).body.quiet, []);
  });

  it('bounds what it is sent', async () => {
    assert.equal((await call('POST', '/api/tell/read', { token: owner(), body: { ids: [] } })).status, 400);
    assert.equal((await call('POST', '/api/tell/read', { token: owner(), body: { ids: Array.from({ length: 501 }, (_, n) => `id-${n}`) } })).status, 400);
    assert.equal((await call('POST', '/api/tell/read', { token: owner(), body: { ids: ['x'.repeat(161)] } })).status, 400);
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: owner(), body: { quiet: 'yes' } })).status, 400);
  });
});

describe('what leaves the app', () => {
  it('is one mail a person for the ten papers, sent once however often the timer runs', async () => {
    const { sweepTell } = await import('../apps/api/src/cron/tell');
    assert.deepEqual(await sweepTell(new Date()), { projects: 2, messages: 0, notices: 0, mailed: 0, pushed: 0, failed: 0 }, 'not before a message’s worth of waiting');
    const first = await sweepTell(afterAMessagesWorth());
    assert.deepEqual(first, { projects: 2, messages: 2, notices: 20, mailed: 2, pushed: 1, failed: 0 });
    assert.deepEqual(mail.map((sent) => sent.to).sort(), [[OWNER], [MANAGER]].sort());
    const sent = mail.find((held) => held.to[0] === OWNER)!;
    assert.equal(sent.subject, 'Lake Road offices: 10 papers filed');
    assert.equal(sent.authorization, 'Bearer not-a-real-key');
    assert.match(sent.key ?? '', new RegExp(`^tell/${project.id}/tel_`));
    assert.match(sent.text, /Filed: Sale deed 1 · Legal › Title\n {2}Read it\./);
    assert.deepEqual(push.map((messages) => messages.map((message) => [message.to, message.title, message.body])), [[['ExponentPushToken[invented]', 'Lake Road offices', '10 papers filed. Read it.']]]);
    assert.equal((await sweepTell(afterAMessagesWorth())).messages, 0);
    assert.equal(mail.length, 2);
  });

  it('is nothing for somebody who quieted the project, and nothing already read', async () => {
    mail.length = 0;
    push.length = 0;
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: owner(), body: { quiet: true } })).status, 200);
    await fileAs(LEAD, 'Mother deed');
    const mine = (await call('GET', '/api/tell', { token: owner() })).body;
    assert.equal(mine.notices[0].title, 'Filed: Mother deed · Legal › Title', 'it is still in the app');
    assert.deepEqual((await call('POST', '/api/tell/read', { token: manager(), body: { ids: 'all' } })).body, { read: 11 });
    const { sweepTell } = await import('../apps/api/src/cron/tell');
    assert.equal((await sweepTell(afterAMessagesWorth())).messages, 0);
    assert.equal(mail.length + push.length, 0);
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: owner(), body: { quiet: false } })).status, 200);
  });

  it('is no mail at all with no mail key set, and the app is told so', async () => {
    mail.length = 0;
    push.length = 0;
    delete process.env.REALYTICA_RESEND_API_KEY;
    await fileAs(LEAD, 'Agreement to sell');
    assert.deepEqual((await call('GET', '/api/tell', { token: manager() })).body.channels, { email: false, push: false });
    const { sweepTell } = await import('../apps/api/src/cron/tell');
    const swept = await sweepTell(afterAMessagesWorth());
    assert.deepEqual([swept.messages, swept.mailed, swept.pushed], [2, 0, 1], 'the owner’s phone is still told');
    assert.equal(mail.length, 0);
  });

  it('counts a project storage will not answer for and finishes the rest', async () => {
    const { sweepTell } = await import('../apps/api/src/cron/tell');
    const swept = await sweepTell(new Date(), {
      ids: () => ['gone', project.id],
      fresh: async (id) => {
        if (id === 'gone') throw new Error('storage did not answer');
        return project;
      },
      due: () => [],
      save: async () => undefined,
      send: async () => ({ mailed: 0, pushed: 0 }),
    });
    assert.deepEqual(swept, { projects: 2, messages: 0, notices: 0, mailed: 0, pushed: 0, failed: 1 });
  });
});

/** What another instance's save leaves in storage: the project with a paper this instance has never seen. */
async function savedElsewhere(title: string): Promise<void> {
  const { storageAdapter } = await import('../apps/api/src/storage');
  const stored = JSON.parse((await storageAdapter.getDocument(project.id, 'project.json'))!.toString('utf-8')) as DdProject & { storeRevision: number };
  addEvidence(stored, { title, kind: 'document', status: 'expected' }, MANAGER);
  stored.updatedAt = new Date(Date.now() + 1000).toISOString();
  stored.storeRevision += 1;
  await storageAdapter.putDocument(project.id, 'project.json', Buffer.from(JSON.stringify(stored)), 'application/json');
}

async function inStorage(): Promise<DdProject> {
  const { storageAdapter } = await import('../apps/api/src/storage');
  return JSON.parse((await storageAdapter.getDocument(project.id, 'project.json'))!.toString('utf-8')) as DdProject;
}

describe('marking and quieting on an instance whose copy is old', () => {
  it('reads the project from storage first, so what another instance saved is kept', async () => {
    await fileAs(LEAD, 'Khata extract');
    await savedElsewhere('Saved by another instance');
    assert.equal(project.evidence.some((row) => row.title === 'Saved by another instance'), false, 'this instance has not seen it');
    const marked = await call('POST', '/api/tell/read', { token: owner(), body: { ids: 'all' } });
    assert.equal(marked.status, 200);
    assert.ok(marked.body.read >= 1);
    const stored = await inStorage();
    assert.equal(stored.evidence.some((row) => row.title === 'Saved by another instance'), true, 'the other instance’s paper is still in storage');
    assert.equal(stored.tell!.notices!.filter((notice) => notice.to === OWNER).every((notice) => notice.readAt), true);

    await savedElsewhere('Saved elsewhere again');
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: manager(), body: { quiet: true } })).status, 200);
    const quieted = await inStorage();
    assert.equal(quieted.evidence.some((row) => row.title === 'Saved elsewhere again'), true);
    assert.deepEqual(quieted.tell!.quiet!.includes(MANAGER), true);
    assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: manager(), body: { quiet: false } })).status, 200);
  });

  it('writes nothing where storage does not answer', async () => {
    const { store } = await import('../apps/api/src/store');
    await fileAs(LEAD, 'Tax receipt');
    const before = JSON.stringify(await inStorage());
    const pullFresh = store.pullFresh.bind(store);
    store.pullFresh = async () => {
      throw new Error('storage did not answer');
    };
    try {
      assert.deepEqual((await call('POST', '/api/tell/read', { token: owner(), body: { ids: 'all' } })).body, { read: 0 });
      assert.equal((await call('PUT', `/api/tell/quiet/${project.id}`, { token: owner(), body: { quiet: true } })).status, 503);
    } finally {
      store.pullFresh = pullFresh;
    }
    assert.equal(JSON.stringify(await inStorage()), before);
    assert.deepEqual((await call('GET', '/api/tell', { token: owner() })).body.quiet, []);
    assert.deepEqual((await call('POST', '/api/tell/read', { token: owner(), body: { ids: 'all' } })).body, { read: 1 });
  });
});

describe('sending, apart from the save', () => {
  /** A paper filed long enough ago that what it told people is due the moment the project is next saved. */
  async function fileADueOne(title: string): Promise<void> {
    await fileAs(LEAD, title);
    for (const notice of project.tell!.notices!) if (!notice.batchedAt && !notice.readAt) notice.at = new Date(Date.now() - TELL_BATCH_MS - 60_000).toISOString();
    project.updatedAt = new Date().toISOString();
  }

  it('does not hold the save: the reply is out before the mail service answers', async () => {
    const { store } = await import('../apps/api/src/store');
    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    process.env.REALYTICA_RESEND_API_KEY = 'not-a-real-key';
    mail.length = 0;
    push.length = 0;
    let release!: () => void;
    mailWaits = new Promise<void>((resolve) => (release = resolve));
    await fileADueOne('Conversion order');
    await store.save();
    assert.equal(mail.length, 0, 'the save came back with the mail service still silent');
    assert.equal(project.tell!.notices!.some((notice) => !notice.batchedAt && !notice.readAt), false, 'what is due was taken with the save');
    release();
    mailWaits = undefined;
    await afterReplyWorkDone();
    assert.deepEqual(mail.map((sent) => sent.to).sort(), [[OWNER], [MANAGER]].sort());
    assert.equal(push.length, 1);
  });

  it('gives back the notices of a message the mail service refused, and the timer sends it a message’s worth later', async () => {
    const { sweepTell } = await import('../apps/api/src/cron/tell');
    await call('POST', '/api/tell/read', { token: owner(), body: { ids: 'all' } });
    await call('POST', '/api/tell/read', { token: manager(), body: { ids: 'all' } });
    mail.length = 0;
    push.length = 0;
    await fileAs(LEAD, 'Layout plan');
    mailRefused = true;
    const at = afterAMessagesWorth();
    const refused = await sweepTell(at);
    mailRefused = false;
    assert.deepEqual([refused.messages, refused.mailed, refused.pushed], [2, 0, 1]);
    const stored = (await inStorage()).tell!.notices!.filter((notice) => !notice.readAt && !notice.batchedAt);
    assert.deepEqual(stored.map((notice) => [notice.to, notice.unsent?.n]).sort(), [[MANAGER, 1], [OWNER, 1]].sort(), 'given back in storage, each marked as tried once');
    assert.equal((await sweepTell(new Date(at.getTime() + 60_000))).messages, 0, 'not at once');
    mail.length = 0;
    push.length = 0;
    const again = await sweepTell(new Date(at.getTime() + TELL_BATCH_MS + 60_000));
    assert.deepEqual([again.messages, again.mailed, again.pushed], [2, 2, 0], 'mailed now, and the phone that was told is not told twice');
    assert.equal(push.length, 0);
  });

  it('pushes a message once though two instances took the same notices', async () => {
    const { sendTold } = await import('../apps/api/src/tell');
    mail.length = 0;
    push.length = 0;
    const line = { id: 'tel_twice', projectId: project.id, projectName: project.name, projectReference: project.reference, kind: 'paper_filed' as const, at: new Date().toISOString(), by: LEAD, title: 'Filed: Layout plan', action: 'Read it.', read: false };
    const message = { to: OWNER, lines: [line], key: 'tel_twice', ids: ['tel_twice'] };
    const [one, two] = [await sendTold(project, [message]), await sendTold(project, [message])];
    assert.deepEqual([one.pushed, two.pushed], [1, 0]);
    assert.equal(push.length, 1);
    assert.deepEqual(mail.map((sent) => sent.key), [`tell/${project.id}/tel_twice`, `tell/${project.id}/tel_twice`], 'the mail service is handed the same key both times');
  });

  it('does not keep what it took as sent where the write failed', async () => {
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    mail.length = 0;
    push.length = 0;
    await fileADueOne('Betterment receipt');
    const putDocument = storageAdapter.putDocument;
    storageAdapter.putDocument = async (caseId, key, bytes, contentType) => {
      if (key === 'project.json') throw new Error('storage did not take it');
      return putDocument(caseId, key, bytes, contentType);
    };
    try {
      await assert.rejects(store.save(), /storage did not take it/);
    } finally {
      storageAdapter.putDocument = putDocument;
    }
    await afterReplyWorkDone();
    assert.equal(mail.length + push.length, 0, 'nothing left the app');
    assert.equal(project.tell!.notices!.filter((notice) => !notice.batchedAt && !notice.readAt).length, 2, 'and this copy does not say it did');
    await store.save();
    await afterReplyWorkDone();
    assert.equal(mail.length, 2, 'the next save that is written sends it');
  });
});
