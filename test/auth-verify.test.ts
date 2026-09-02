/**
 * The token verifier, attacked.
 *
 * This is the function that decides whether a request is somebody. Its tests
 * are therefore written as the attempts an attacker actually makes, in the
 * order they make them: strip the signature, change the algorithm, sign with
 * your own key, replay an expired token, reuse a token minted for a different
 * audience, and — the subtle one — present a token from a *different Google
 * project*, which is signed by exactly the right key and is still not yours.
 *
 * A real RSA key is generated here and served through a stub `fetch`, so the
 * whole path runs: JWKS fetch, key selection by `kid`, RS256 verification,
 * and every claim check. Nothing is mocked out of the part being tested.
 */

import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { TokenRejected, clearKeyCache, verifyIdToken } from '../apps/api/src/auth/verify';

const JWKS_URL = 'https://example.test/jwks';
const ISSUER = 'https://securetoken.google.com/realytica-prod';
const AUDIENCE = 'realytica-prod';

const mine = generateKeyPairSync('rsa', { modulusLength: 2048 });
const theirs = generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwkOf(key: KeyObject, kid: string) {
  return { ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function sign(
  claims: Record<string, unknown>,
  opts: { key?: KeyObject; kid?: string; alg?: string; signature?: string } = {},
): string {
  const header = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const body = b64(claims);
  if (opts.signature !== undefined) return `${header}.${body}.${opts.signature}`;
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(opts.key ?? mine.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);

function good(over: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'sub-asha',
    email: 'asha@firm.in',
    email_verified: true,
    name: 'Asha Rao',
    iat: now() - 10,
    exp: now() + 3600,
    ...over,
  };
}

const CONFIG = { issuers: [ISSUER], audience: AUDIENCE, jwksUri: JWKS_URL };

let served: unknown[] = [jwkOf(mine.publicKey, 'k1')];
let fetches = 0;
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: unknown) => {
    if (String(input) !== JWKS_URL) throw new Error(`unexpected fetch of ${String(input)}`);
    fetches += 1;
    return new Response(JSON.stringify({ keys: served }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
    });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  clearKeyCache();
  served = [jwkOf(mine.publicKey, 'k1')];
  fetches = 0;
});

async function rejects(token: string, match: RegExp, config = CONFIG) {
  await assert.rejects(() => verifyIdToken(token, config), (e: unknown) => {
    assert.ok(e instanceof TokenRejected, `expected TokenRejected, got ${String(e)}`);
    assert.match((e as Error).message, match);
    return true;
  });
}

describe('verifying a token that is genuine', () => {
  it('returns who the person is', async () => {
    const out = await verifyIdToken(sign(good()), CONFIG);
    assert.equal(out.subject, 'sub-asha');
    assert.equal(out.email, 'asha@firm.in');
    assert.equal(out.emailVerified, true);
    assert.equal(out.name, 'Asha Rao');
    assert.equal(out.issuer, ISSUER);
  });

  it('accepts the string "true" some providers send for email_verified', async () => {
    const out = await verifyIdToken(sign(good({ email_verified: 'true' })), CONFIG);
    assert.equal(out.emailVerified, true);
  });

  it('accepts an audience array that contains ours', async () => {
    const out = await verifyIdToken(sign(good({ aud: ['someone-else', AUDIENCE] })), CONFIG);
    assert.equal(out.subject, 'sub-asha');
  });

  it('accepts either spelling of the Google issuer', async () => {
    const config = { ...CONFIG, issuers: ['https://accounts.google.com', 'accounts.google.com'] };
    for (const iss of config.issuers) {
      const out = await verifyIdToken(sign(good({ iss })), config);
      assert.equal(out.issuer, iss);
    }
  });

  it('caches the key set rather than fetching it per request', async () => {
    await verifyIdToken(sign(good()), CONFIG);
    await verifyIdToken(sign(good()), CONFIG);
    await verifyIdToken(sign(good()), CONFIG);
    assert.equal(fetches, 1);
  });
});

describe('verifying a token that is not', () => {
  it('refuses one that is not three segments', async () => {
    await rejects('not.a-token', /compact JWS/);
  });

  it('refuses alg none, signature stripped', async () => {
    await rejects(sign(good(), { alg: 'none', signature: '' }), /Unsupported algorithm none/);
  });

  it('refuses HS256, where the public key would be read as a shared secret', async () => {
    await rejects(sign(good(), { alg: 'HS256' }), /Unsupported algorithm HS256/);
  });

  it('refuses one signed with a key the issuer does not publish', async () => {
    await rejects(sign(good(), { key: theirs.privateKey }), /Signature does not verify/);
  });

  it('refuses one whose kid names a key nobody publishes', async () => {
    await rejects(sign(good(), { kid: 'not-a-key' }), /does not publish/);
  });

  it('refuses a body edited after signing', async () => {
    const token = sign(good());
    const [h, , s] = token.split('.');
    const tampered = `${h}.${b64(good({ email: 'attacker@evil.test' }))}.${s}`;
    await rejects(tampered, /Signature does not verify/);
  });

  it('refuses an expired token', async () => {
    await rejects(sign(good({ exp: now() - 3600 })), /Expired/);
  });

  it('refuses one with no expiry at all', async () => {
    const { exp, ...rest } = good();
    void exp;
    await rejects(sign(rest), /No expiry/);
  });

  it('refuses one that is not valid yet', async () => {
    await rejects(sign(good({ nbf: now() + 3600 })), /Not valid yet/);
  });

  it('refuses one issued in the future', async () => {
    await rejects(sign(good({ iat: now() + 3600 })), /Issued in the future/);
  });

  it('refuses one from another issuer', async () => {
    await rejects(sign(good({ iss: 'https://securetoken.google.com/somebody-else' })), /Issued by/);
  });

  it('refuses one minted for another audience', async () => {
    await rejects(sign(good({ aud: 'another-app' })), /different audience/);
  });

  it('refuses an audience that merely starts with ours', async () => {
    // The bug a careless `includes` would ship.
    await rejects(sign(good({ aud: `${AUDIENCE}-staging` })), /different audience/);
  });

  it('refuses one with no subject', async () => {
    const { sub, ...rest } = good();
    void sub;
    await rejects(sign(rest), /No subject/);
  });

  it('tolerates a minute of clock drift, and no more', async () => {
    await verifyIdToken(sign(good({ exp: now() - 30 })), CONFIG);
    await rejects(sign(good({ exp: now() - 300 })), /Expired/);
  });
});

describe('when the issuer rotates its keys', () => {
  it('refetches once for an unknown kid rather than rejecting a live token', async () => {
    await verifyIdToken(sign(good()), CONFIG);
    assert.equal(fetches, 1);

    // Google rolls the key; our cache still holds the old one.
    const rolled = generateKeyPairSync('rsa', { modulusLength: 2048 });
    served = [jwkOf(rolled.publicKey, 'k2')];

    const out = await verifyIdToken(sign(good(), { key: rolled.privateKey, kid: 'k2' }), CONFIG);
    assert.equal(out.subject, 'sub-asha');
    assert.equal(fetches, 2, 'exactly one forced refresh');
  });

  it('does not refetch on every forged token', async () => {
    await rejects(sign(good(), { kid: 'nope' }), /does not publish/);
    const before = fetches;
    await rejects(sign(good(), { kid: 'nope' }), /does not publish/);
    assert.ok(fetches - before <= 2, 'a forged kid must not become an unbounded fetch loop');
  });

  it('falls back to the keys it already has when the issuer is unreachable', async () => {
    await verifyIdToken(sign(good()), CONFIG);

    const previous = globalThis.fetch;
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    try {
      // An unknown kid forces a refresh, and the refresh fails. A live token
      // signed with the key we already hold must still verify: an issuer being
      // briefly down should not sign a whole deployment out.
      await rejects(sign(good(), { kid: 'unknown' }), /does not publish/);
      const out = await verifyIdToken(sign(good()), CONFIG);
      assert.equal(out.subject, 'sub-asha');
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('says so plainly when it has no keys and cannot get any', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    try {
      await rejects(sign(good()), /Could not fetch signing keys \(503\)/);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
