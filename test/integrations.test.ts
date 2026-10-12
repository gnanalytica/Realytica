/**
 * API keys and webhooks, apart from the wire: how a key is kept and matched,
 * where a webhook may be sent, how a delivery is signed, tried again and
 * given up, and which events a saved project has had.
 *
 * Nothing here reaches a network. The receiver is a function that answers
 * with a status, and names are resolved by a table. The firm, the project
 * and the addresses are invented.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, createProject, integrationEventsOf, type DdProject } from '@realytica/shared';

type Keys = typeof import('../apps/api/src/integrations/keys');
type Webhooks = typeof import('../apps/api/src/integrations/webhooks');
type Documents = typeof import('../apps/api/src/integrations/documents');
type Observe = typeof import('../apps/api/src/integrations/observe');
type Cron = typeof import('../apps/api/src/cron/webhook-retry');

let keys: Keys;
let hooks: Webhooks;
let docs: Documents;
let observe: Observe;
let cron: Cron;
let dataDir: string;

/** Names as this test resolves them. Anything else does not resolve. */
const DNS: Record<string, string[]> = {
  'hooks.partner.example': ['93.184.216.34'],
  'second.partner.example': ['93.184.216.35'],
  'inside.partner.example': ['10.0.0.5'],
  'both.partner.example': ['93.184.216.34', '169.254.169.254'],
  'six.partner.example': ['fd00::1'],
};
const resolve = async (host: string) => {
  const found = DNS[host];
  if (!found) throw new Error('ENOTFOUND');
  return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-integrations-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
  keys = await import('../apps/api/src/integrations/keys');
  hooks = await import('../apps/api/src/integrations/webhooks');
  docs = await import('../apps/api/src/integrations/documents');
  observe = await import('../apps/api/src/integrations/observe');
  cron = await import('../apps/api/src/cron/webhook-retry');
});

after(async () => {
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.REALYTICA_DATA_DIR;
  delete process.env.REALYTICA_CREDENTIAL_KEY;
});

describe('an API key', () => {
  it('is kept as a salted hash and a short prefix, never as itself', async () => {
    const { token, key } = await keys.createApiKey({ tenantId: 'tnt_a', name: 'Cost system', scopes: ['projects:read'], createdBy: 'dev@builders.example' });
    assert.match(token, /^rlk_[0-9a-f]{8}_[\w-]{43}$/);
    assert.equal(key.prefix, token.slice(0, 12));
    assert.equal(key.hash, keys.hashApiKey(token, key.salt));
    const stored = JSON.stringify(await docs.readIntegrations('keys'));
    assert.ok(!stored.includes(token), 'the key itself is not in storage');
    assert.ok(!stored.includes(token.slice(13)), 'nor is its secret part');
    // What goes back to the page carries neither the salt nor the hash.
    const shown = JSON.stringify(keys.publicApiKey(key));
    assert.ok(!shown.includes(key.salt) && !shown.includes(key.hash));
  });

  it('salts each key on its own, so the same key hashes differently under another', async () => {
    const one = await keys.createApiKey({ tenantId: 'tnt_a', name: 'One', scopes: ['projects:read'], createdBy: 'dev@builders.example' });
    const two = await keys.createApiKey({ tenantId: 'tnt_a', name: 'Two', scopes: ['projects:read'], createdBy: 'dev@builders.example' });
    assert.notEqual(one.key.salt, two.key.salt);
    assert.notEqual(keys.hashApiKey(one.token, one.key.salt), keys.hashApiKey(one.token, two.key.salt));
  });

  it('is matched whole: a key with the right prefix and another ending is no key', async () => {
    const { token, key } = await keys.createApiKey({ tenantId: 'tnt_a', name: 'Whole', scopes: ['reports:read'], createdBy: 'dev@builders.example' });
    assert.equal(keys.matchApiKey([key], token)?.id, key.id);
    assert.equal(keys.matchApiKey([key], `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`), undefined);
    assert.equal(keys.matchApiKey([key], token.slice(0, 12)), undefined);
    assert.equal(keys.matchApiKey([key], `rdt_${token.slice(4)}`), undefined);
    assert.equal(keys.matchApiKey([key], `${token}${'x'.repeat(300)}`), undefined);
  });

  it('stops working when it expires and when it is revoked', async () => {
    const made = new Date('2026-10-01T00:00:00Z');
    const { token, key } = await keys.createApiKey({ tenantId: 'tnt_a', name: 'Short', scopes: ['projects:read'], expiresInDays: 30, createdBy: 'dev@builders.example' }, made);
    assert.equal(key.expiresAt, '2026-10-31T00:00:00.000Z');
    assert.ok(keys.matchApiKey([key], token, new Date('2026-10-30T23:59:59Z')));
    assert.equal(keys.matchApiKey([key], token, new Date('2026-10-31T00:00:00Z')), undefined);

    // Another firm cannot revoke it; its own can, and the next look at storage refuses it.
    assert.equal(await keys.revokeApiKey('tnt_b', key.id, 'eve@other.example'), undefined);
    assert.ok(await keys.apiKeyForToken(token, made));
    assert.equal((await keys.revokeApiKey('tnt_a', key.id, 'dev@builders.example'))?.revokedBy, 'dev@builders.example');
    assert.equal(await keys.apiKeyForToken(token, made), undefined);
  });

  it('reaches its own firm, and only the projects on its list when it has one', async () => {
    const all = (await keys.createApiKey({ tenantId: 'tnt_a', name: 'All', scopes: ['projects:read'], createdBy: 'dev@builders.example' })).key;
    const one = (await keys.createApiKey({ tenantId: 'tnt_a', name: 'One', scopes: ['projects:read'], projectIds: ['prj_1'], createdBy: 'dev@builders.example' })).key;
    assert.equal(keys.keyReaches(all, { id: 'prj_2', tenantId: 'tnt_a' }, undefined), true);
    assert.equal(keys.keyReaches(all, { id: 'prj_2', tenantId: 'tnt_b' }, undefined), false);
    assert.equal(keys.keyReaches(one, { id: 'prj_1', tenantId: 'tnt_a' }, undefined), true);
    assert.equal(keys.keyReaches(one, { id: 'prj_2', tenantId: 'tnt_a' }, undefined), false);
    // A project written before workspaces existed belongs to the first one.
    assert.equal(keys.keyReaches(all, { id: 'prj_3' }, 'tnt_a'), true);
    assert.equal(keys.keyReaches(all, { id: 'prj_3' }, 'tnt_b'), false);
  });
});

describe('where a webhook may be sent', () => {
  const refused = async (url: string, why: RegExp) => {
    await assert.rejects(hooks.assertWebhookUrl(url, resolve), (err: Error) => err instanceof hooks.WebhookUrlRefused && why.test(err.message), url);
  };

  it('takes a public https address', async () => {
    assert.equal((await hooks.assertWebhookUrl('https://hooks.partner.example/realytica', resolve)).hostname, 'hooks.partner.example');
    assert.equal((await hooks.assertWebhookUrl('https://93.184.216.34/hook', resolve)).hostname, '93.184.216.34');
  });

  it('refuses anything that is not https, and an address carrying a password', async () => {
    await refused('http://hooks.partner.example/hook', /https/);
    await refused('ftp://hooks.partner.example/hook', /https/);
    await refused('file:///etc/passwd', /https/);
    await refused('not a url', /not a URL/);
    await refused('https://user:secret@hooks.partner.example/hook', /user name or a password/);
  });

  it('refuses loopback, private, link-local and other inside addresses, however they are written', async () => {
    for (const host of [
      '127.0.0.1',
      '127.9.9.9',
      '0.0.0.0',
      '10.0.0.8',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      // The same loopback as one number, in hex, in octal and short: a URL reads each as 127.0.0.1.
      '2130706433',
      '0x7f000001',
      '0177.0.0.1',
      '127.1',
      '[::1]',
      '[::]',
      '[fe80::1]',
      '[fd12:3456::1]',
      '[fc00::1]',
      '[::ffff:127.0.0.1]',
      '[::ffff:a9fe:a9fe]',
      '[64:ff9b::a9fe:a9fe]',
      '[ff02::1]',
    ]) {
      await refused(`https://${host}/hook`, /not a public address/);
    }
  });

  it('refuses a name that resolves inside, with every answer checked and not only the first', async () => {
    await refused('https://inside.partner.example/hook', /10\.0\.0\.5/);
    await refused('https://both.partner.example/hook', /169\.254\.169\.254/);
    await refused('https://six.partner.example/hook', /fd00::1/);
    await refused('https://nowhere.partner.example/hook', /does not resolve/);
  });

  it('checks again at the connection: a name that has moved inside since it was registered is refused there', async () => {
    let answers = ['93.184.216.34'];
    const moving = async () => answers.map((address) => ({ address, family: 4 }));
    const ask = (all: boolean) =>
      new Promise<{ err: Error | null; address?: unknown }>((done) => {
        (hooks.guardedLookup(moving) as unknown as (host: string, options: object, cb: (err: Error | null, address?: unknown) => void) => void)('hooks.partner.example', { all }, (err, address) => done({ err, address }));
      });
    assert.equal((await ask(false)).address, '93.184.216.34');
    assert.deepEqual((await ask(true)).address, [{ address: '93.184.216.34', family: 4 }]);
    answers = ['127.0.0.1'];
    const rebound = await ask(false);
    assert.ok(rebound.err instanceof hooks.WebhookUrlRefused);
    assert.equal(rebound.address, undefined);
  });

  it('is refused at registration, and nothing is kept', async () => {
    const before = (await docs.readIntegrations('endpoints')).endpoints.length;
    await assert.rejects(hooks.createEndpoint({ tenantId: 'tnt_a', url: 'https://inside.partner.example/hook', events: ['paper.filed'], createdBy: 'dev@builders.example' }, new Date(), resolve), hooks.WebhookUrlRefused);
    assert.equal((await docs.readIntegrations('endpoints')).endpoints.length, before);
  });
});

describe('a delivery', () => {
  it('is signed as Standard Webhooks signs: HMAC-SHA256 over id.timestamp.body, in base64', () => {
    const secret = `whsec_${Buffer.from('a-signing-secret-of-thirty-two-b').toString('base64')}`;
    const body = '{"id":"evt_1","type":"paper.filed"}';
    const expected = createHmac('sha256', Buffer.from('a-signing-secret-of-thirty-two-b')).update(`evt_1.1760000000.${body}`).digest('base64');
    assert.equal(hooks.signWebhook(secret, 'evt_1', 1_760_000_000, body), `v1,${expected}`);
    // Another body, another timestamp or another id is another signature.
    assert.notEqual(hooks.signWebhook(secret, 'evt_1', 1_760_000_000, `${body} `), `v1,${expected}`);
    assert.notEqual(hooks.signWebhook(secret, 'evt_1', 1_760_000_001, body), `v1,${expected}`);
    assert.notEqual(hooks.signWebhook(secret, 'evt_2', 1_760_000_000, body), `v1,${expected}`);
  });

  it('carries the event id, the time and a signature the receiver can check with the secret it was shown once', async () => {
    const now = new Date('2026-10-12T09:00:00Z');
    const { secret, endpoint } = await hooks.createEndpoint({ tenantId: 'tnt_sign', url: 'https://hooks.partner.example/realytica', events: ['paper.filed'], createdBy: 'dev@builders.example' }, now, resolve);
    assert.match(secret, /^whsec_/);
    assert.ok(!JSON.stringify(await docs.readIntegrations('endpoints')).includes(secret.slice(6)), 'the secret is stored sealed');
    assert.ok(!JSON.stringify(hooks.publicEndpoint(endpoint)).includes('secret'));

    const got: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const sent = await hooks.sendEvents('tnt_sign', [{ id: 'evt_aud_1', type: 'paper.filed', at: now.toISOString(), projectId: 'prj_1', data: { paper: { id: 'ev_1' } } }], now, async (url, body, headers) => {
      got.push({ url, body, headers });
      return { status: 204 };
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.status, 'delivered');
    assert.equal(got[0]!.url, 'https://hooks.partner.example/realytica');
    assert.equal(got[0]!.headers['webhook-id'], 'evt_aud_1');
    assert.equal(got[0]!.headers['webhook-timestamp'], String(now.getTime() / 1000));
    const key = Buffer.from(secret.slice(6), 'base64');
    const mine = createHmac('sha256', key).update(`evt_aud_1.${got[0]!.headers['webhook-timestamp']}.${got[0]!.body}`).digest('base64');
    assert.equal(got[0]!.headers['webhook-signature'], `v1,${mine}`);
    assert.deepEqual(JSON.parse(got[0]!.body), { id: 'evt_aud_1', type: 'paper.filed', timestamp: now.toISOString(), data: { paper: { id: 'ev_1' } } });

    // The same event worked out again is not sent again, and one the endpoint did not ask for is not sent at all.
    const again = await hooks.sendEvents('tnt_sign', [{ id: 'evt_aud_1', type: 'paper.filed', at: now.toISOString(), data: {} }, { id: 'evt_aud_2', type: 'report.issued', at: now.toISOString(), data: {} }], now, async () => {
      throw new Error('nothing should be sent');
    });
    assert.equal(again.length, 0);
    // Another firm's event goes nowhere.
    assert.equal((await hooks.sendEvents('tnt_other', [{ id: 'evt_aud_3', type: 'paper.filed', at: now.toISOString(), data: {} }], now, async () => ({ status: 200 }))).length, 0);
  });

  it('is a failure when the receiver redirects, errors, or does not answer, and is logged with why', async () => {
    const now = new Date('2026-10-12T10:00:00Z');
    await hooks.createEndpoint({ tenantId: 'tnt_fail', url: 'https://second.partner.example/hook', events: ['alert.raised'], createdBy: 'dev@builders.example' }, now, resolve);
    const event = (id: string) => [{ id, type: 'alert.raised', at: now.toISOString(), data: {} }];
    const [redirected] = await hooks.sendEvents('tnt_fail', event('evt_r'), now, async () => ({ status: 302 }));
    assert.equal(redirected!.status, 'failed');
    assert.equal(redirected!.lastStatus, 302);
    assert.match(redirected!.lastError ?? '', /redirect/);
    const [errored] = await hooks.sendEvents('tnt_fail', event('evt_e'), now, async () => ({ status: 500 }));
    assert.equal(errored!.status, 'failed');
    const [silent] = await hooks.sendEvents('tnt_fail', event('evt_s'), now, async () => {
      throw new Error('no answer in 5s');
    });
    assert.equal(silent!.status, 'failed');
    assert.equal(silent!.lastError, 'no answer in 5s');
    // The first retry is due an hour on, and what was sent is kept for it.
    assert.equal(silent!.nextAttemptAt, '2026-10-12T11:00:00.000Z');
    assert.ok(silent!.body);
    const log = (await docs.readIntegrations('deliveries')).deliveries.filter((d) => d.tenantId === 'tnt_fail');
    assert.deepEqual(log.map((d) => d.status), ['failed', 'failed', 'failed']);
    assert.ok(!JSON.stringify(log.map(hooks.publicDelivery)).includes('"body"'));
  });
});

describe('trying again', () => {
  // The timer tries every firm's deliveries, so what the tests above left waiting is taken off the log first.
  before(async () => {
    await docs.changeIntegrations('deliveries', (held) => {
      held.deliveries = [];
    });
  });

  it('retries what is due with a longer wait each time, gives up at the cap, marks the endpoint failing and tells the firm once', async () => {
    const start = new Date('2026-10-12T12:00:00Z');
    const { endpoint } = await hooks.createEndpoint({ tenantId: 'tnt_retry', url: 'https://hooks.partner.example/down', events: ['report.issued', 'paper.filed'], createdBy: 'dev@builders.example' }, start, resolve);
    const down = async () => ({ status: 503 });
    const told: string[] = [];
    const tell = async (failing: { id: string; failingSince?: string }) => {
      assert.ok(failing.failingSince);
      told.push(failing.id);
      return true;
    };
    const mine = async () => (await docs.readIntegrations('deliveries')).deliveries.filter((d) => d.endpointId === endpoint.id);

    await hooks.sendEvents('tnt_retry', [{ id: 'evt_first', type: 'report.issued', at: start.toISOString(), data: {} }], start, down);
    // A second delivery, a day behind the first, still waiting when the first is given up.
    const later = new Date('2026-10-14T12:00:00Z');
    await hooks.sendEvents('tnt_retry', [{ id: 'evt_second', type: 'paper.filed', at: later.toISOString(), data: {} }], later, down);

    // Not yet due: nothing is tried.
    assert.deepEqual(await cron.retryWebhooks(new Date('2026-10-12T12:30:00Z'), down, tell), { due: 0, delivered: 0, failed: 0, gaveUp: 0, endpointsFailing: 0, told: 0 });

    const waits: number[] = [];
    let now = start;
    for (let attempt = 2; attempt < hooks.MAX_ATTEMPTS; attempt += 1) {
      const first = (await mine()).find((d) => d.eventId === 'evt_first')!;
      waits.push(Date.parse(first.nextAttemptAt!) - Date.parse(first.lastAttemptAt!));
      now = new Date(first.nextAttemptAt!);
      const run = await cron.retryWebhooks(now, down, tell);
      assert.equal(run.failed >= 1 && run.gaveUp === 0, true, `attempt ${attempt}: ${JSON.stringify(run)}`);
      // Run twice at the same moment: the second finds nothing due.
      assert.equal((await cron.retryWebhooks(now, down, tell)).due, 0);
    }
    assert.deepEqual(waits, [1, 6, 24].map((hours) => hours * 3_600_000));
    assert.deepEqual(told, []);

    const first = (await mine()).find((d) => d.eventId === 'evt_first')!;
    assert.equal(first.attempts, hooks.MAX_ATTEMPTS - 1);
    const last = await cron.retryWebhooks(new Date(first.nextAttemptAt!), down, tell);
    // The second delivery, still waiting on the same endpoint, is given up with it.
    assert.equal(last.gaveUp, 2);
    assert.equal(last.endpointsFailing, 1);
    assert.equal(last.told, 1);
    assert.deepEqual(told, [endpoint.id]);

    const end = await mine();
    assert.deepEqual(end.map((d) => [d.eventId, d.status, d.attempts]), [['evt_first', 'gave_up', hooks.MAX_ATTEMPTS], ['evt_second', 'gave_up', end[1]!.attempts]]);
    assert.ok(end.every((d) => !d.body && !d.nextAttemptAt), 'nothing is kept to send once it is given up');
    const held = (await docs.readIntegrations('endpoints')).endpoints.find((e) => e.id === endpoint.id)!;
    assert.ok(held.failingSince && held.toldAt);

    // Failing: nothing more is sent there, and the firm is not told a second time.
    observe.forgetListeners();
    assert.equal((await hooks.sendEvents('tnt_retry', [{ id: 'evt_third', type: 'paper.filed', at: now.toISOString(), data: {} }], now, down)).length, 0);
    const quiet = await cron.retryWebhooks(new Date('2026-12-01T00:00:00Z'), down, tell);
    assert.deepEqual([quiet.due, quiet.told], [0, 0]);
    assert.equal(told.length, 1);

    // A test delivery that fails leaves it failing; one that goes through clears it.
    assert.equal((await hooks.testEndpoint('tnt_retry', endpoint.id, now, down))?.status, 'failed');
    assert.ok((await docs.readIntegrations('endpoints')).endpoints.find((e) => e.id === endpoint.id)!.failingSince);
    const ok = await hooks.testEndpoint('tnt_retry', endpoint.id, now, async () => ({ status: 200 }));
    assert.equal(ok?.status, 'delivered');
    assert.equal(ok?.type, 'webhook.test');
    assert.equal((await docs.readIntegrations('endpoints')).endpoints.find((e) => e.id === endpoint.id)!.failingSince, undefined);
    // Another firm cannot test it.
    assert.equal(await hooks.testEndpoint('tnt_other', endpoint.id, now, down), undefined);
  });

  it('delivers on a later attempt, and one delivery throwing leaves the rest of the run to finish', async () => {
    const start = new Date('2026-10-12T13:00:00Z');
    await hooks.createEndpoint({ tenantId: 'tnt_mend', url: 'https://hooks.partner.example/mend', events: ['paper.filed'], createdBy: 'dev@builders.example' }, start, resolve);
    await hooks.sendEvents('tnt_mend', [{ id: 'evt_m1', type: 'paper.filed', at: start.toISOString(), data: {} }, { id: 'evt_m2', type: 'paper.filed', at: start.toISOString(), data: {} }], start, async () => ({ status: 500 }));
    let calls = 0;
    const run = await cron.retryWebhooks(new Date('2026-10-12T14:00:00Z'), async (url) => {
      if (!url.endsWith('/mend')) return { status: 500 };
      calls += 1;
      if (calls === 1) throw new Error('connection reset');
      return { status: 200 };
    }, async () => false);
    assert.equal(calls, 2);
    assert.equal(run.delivered, 1);
    const mine = (await docs.readIntegrations('deliveries')).deliveries.filter((d) => d.tenantId === 'tnt_mend');
    assert.deepEqual(mine.map((d) => d.status).sort(), ['delivered', 'failed']);
    assert.equal(mine.find((d) => d.status === 'failed')!.lastError, 'connection reset');
  });
});

describe('the events on a saved project', () => {
  function project(): DdProject {
    const made = createProject({ name: 'Canal Street block', type: 'commercial', location: 'Canal Street', city: 'Kadamba' }, 'RYT-IN1');
    made.tenantId = 'tnt_events';
    return made;
  }

  it('are read off the trail and the alerts: filed, accepted, issued, raised and resolved, each once', () => {
    const p = project();
    const since = new Date(Date.now() - 60_000).toISOString();
    const paper = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' }, 'asha@builders.example');
    const at = new Date().toISOString();
    // The file put on the row made a moment ago: still one paper filed.
    p.audit.push({ id: 'aud_up', at, actor: 'asha@builders.example', action: 'upload', entityType: 'evidence', entityId: paper.id, newValue: 'deed.pdf' });
    p.audit.push({ id: 'aud_acc', at, actor: 'lead@builders.example', action: 'accept_fact', entityType: 'evidence', entityId: paper.id, factKey: 'sale_consideration' });
    p.audit.push({ id: 'aud_set', at, actor: 'lead@builders.example', action: 'set_aside_fact', entityType: 'evidence', entityId: paper.id, factKey: 'extent' });
    p.audit.push({ id: 'aud_iss', at, actor: 'lead@builders.example', action: 'issue_report', entityType: 'report', entityId: 'rep_1', newValue: 'issued' });
    p.audit.push({ id: 'aud_gen', at, actor: 'lead@builders.example', action: 'generate_report', entityType: 'report', entityId: 'rep_2' });
    p.audit.push({ id: 'aud_old', at: '2026-01-01T00:00:00.000Z', actor: 'asha@builders.example', action: 'create', entityType: 'evidence', entityId: 'ev_old' });
    const alert = { department: 'legal' as const, severity: 'warning' as const, title: 'Approval expiring', detail: 'In 20 days', readBy: [] };
    p.alerts = [
      { ...alert, id: 'alr_new', key: 'approval:a:expiring:x', raisedAt: at },
      { ...alert, id: 'alr_done', key: 'approval:b:expiring:x', raisedAt: '2026-01-01T00:00:00.000Z', resolvedAt: at },
      { ...alert, id: 'alr_old', key: 'approval:c:expiring:x', raisedAt: '2026-01-01T00:00:00.000Z' },
    ];

    const events = integrationEventsOf(p, since);
    assert.deepEqual(events.map((e) => e.type).sort(), ['alert.raised', 'alert.resolved', 'paper.filed', 'report.issued', 'value.accepted']);
    const accepted = events.find((e) => e.type === 'value.accepted')!;
    assert.equal(accepted.actor, 'lead@builders.example');
    assert.deepEqual(accepted.data, { paper: { id: paper.id, title: 'Sale deed', kind: 'document' }, key: 'sale_consideration', corrected: false });
    assert.equal(events.find((e) => e.type === 'alert.raised')!.id, 'evt_alr_new_raised');
    assert.equal(events.find((e) => e.type === 'alert.resolved')!.id, 'evt_alr_done_resolved');
    // Worked out again, the ids are the same.
    assert.deepEqual(integrationEventsOf(p, since).map((e) => e.id), events.map((e) => e.id));
  });

  it('are sent once to the firm that listens, with the project named, however often the project is saved', async () => {
    const now = new Date();
    await hooks.createEndpoint({ tenantId: 'tnt_events', url: 'https://hooks.partner.example/events', events: ['paper.filed', 'value.accepted'], createdBy: 'dev@builders.example' }, now, resolve);
    observe.forgetListeners();
    const p = project();
    addEvidence(p, { title: 'Encumbrance certificate', kind: 'document', status: 'received' }, 'asha@builders.example');
    const other = project();
    other.tenantId = 'tnt_nobody';
    addEvidence(other, { title: 'Khata extract', kind: 'document', status: 'received' }, 'asha@builders.example');

    const bodies: string[] = [];
    const send = async (_url: string, body: string) => {
      bodies.push(body);
      return { status: 200 };
    };
    assert.equal(await observe.observeSaved([p, other], now, send), 1);
    assert.equal(await observe.observeSaved([p, other], now, send), 0);
    assert.equal(bodies.length, 1);
    const sent = JSON.parse(bodies[0]!);
    assert.equal(sent.type, 'paper.filed');
    assert.deepEqual(sent.data.project, { id: p.id, reference: 'RYT-IN1', name: 'Canal Street block' });
    assert.equal(sent.data.actor, 'asha@builders.example');
    assert.equal(sent.data.paper.title, 'Encumbrance certificate');
  });

  it('are sent by the save itself, and an address that has come to point inside is refused at the moment of sending', async () => {
    const { store } = await import('../apps/api/src/store');
    const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
    // An endpoint as storage would hold it had its address been public when it was registered.
    const { endpoint } = await hooks.createEndpoint({ tenantId: 'tnt_saved', url: 'https://hooks.partner.example/saved', events: ['paper.filed'], createdBy: 'dev@builders.example' }, new Date(), resolve);
    await docs.changeIntegrations('endpoints', (held) => {
      held.endpoints.find((e) => e.id === endpoint.id)!.url = 'https://127.0.0.1:9/hook';
    });
    observe.forgetListeners();

    const p = project();
    p.tenantId = 'tnt_saved';
    const paper = addEvidence(p, { title: 'Conversion order', kind: 'document', status: 'received' }, 'asha@builders.example');
    (store.data.projects ??= []).push(p);
    await store.save();
    await afterReplyWorkDone();

    const log = (await docs.readIntegrations('deliveries')).deliveries.filter((d) => d.endpointId === endpoint.id);
    assert.equal(log.length, 1);
    assert.equal(log[0]!.type, 'paper.filed');
    assert.equal(log[0]!.projectId, p.id);
    assert.equal(log[0]!.status, 'failed');
    assert.match(log[0]!.lastError ?? '', /not a public address/);
    assert.equal(JSON.parse(log[0]!.body!).data.paper.id, paper.id);

    // Saved again with nothing new on the trail: nothing more is sent.
    p.updatedAt = new Date(Date.now() + 1000).toISOString();
    await store.save();
    await afterReplyWorkDone();
    assert.equal((await docs.readIntegrations('deliveries')).deliveries.filter((d) => d.endpointId === endpoint.id).length, 1);
  });
});
