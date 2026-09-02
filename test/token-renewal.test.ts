/**
 * Renewing a session instead of ending it.
 *
 * The old behaviour was one line — a 401 signed you out — and it was wrong for
 * a reason that only shows up in use: an expired token is not a refused one,
 * and treating them the same threw people out of half-written work every hour.
 *
 * What is asserted here is mostly the *restraint*. Renewing is easy; renewing
 * exactly once, deduping concurrent attempts, and knowing when to stop and
 * show the door are the parts that turn into a request storm or a spinner that
 * never resolves if they are wrong.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  authHeader,
  freshSession,
  renewToken,
  setToken,
  setTokenRefresher,
  signOut,
  signedIn,
} from '../apps/web/src/lib/auth';

/** A token that is not verified anywhere on this side — only its `exp` is read. */
function tokenExpiringIn(seconds: number, email = 'operator@example.com'): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { exp: Math.floor(Date.now() / 1000) + seconds, email };
  return `${b64({ alg: 'none' })}.${b64(claims)}.signature`;
}

beforeEach(() => {
  // Module singletons: every case starts signed out with no provider.
  setTokenRefresher(null);
  signOut();
});

/*
 * A live session arms a renewal timer, which in a browser is free and in node
 * holds the process open until it fires — up to an hour from now. Signing out
 * clears it. This is tidy-up, not a workaround: the module is doing the right
 * thing for the environment it ships to.
 */
after(() => {
  signOut();
  setTokenRefresher(null);
});

describe('holding a token', () => {
  it('reads the expiry out of the token rather than assuming one', () => {
    const session = setToken(tokenExpiringIn(3600));
    assert.ok(session);
    assert.equal(session.email, 'operator@example.com');
    assert.ok(session.expiresAt > Math.floor(Date.now() / 1000) + 3500);
  });

  it('treats a token inside the expiry margin as already gone', () => {
    // Not "nearly expired" — gone. A request sent with 30 seconds left is a
    // request that arrives with none.
    assert.equal(setToken(tokenExpiringIn(30)), null);
    assert.equal(signedIn(), null);
  });

  it('refuses a token it cannot read the claims out of', () => {
    assert.equal(setToken('not-a-jwt'), null);
    assert.equal(setToken('two.parts'), null);
  });
});

describe('renewing before it runs out', () => {
  it('renews when the token is inside the renewal window', async () => {
    setToken(tokenExpiringIn(3600));
    let asked = 0;
    setTokenRefresher(async () => {
      asked += 1;
      return tokenExpiringIn(3600);
    });

    // Comfortably live: nothing should be asked of the provider.
    await freshSession();
    assert.equal(asked, 0);

    // Now inside the window — five minutes is the margin, so four is inside.
    setToken(tokenExpiringIn(240));
    await freshSession();
    assert.equal(asked, 1);
  });

  it('hands back the renewed token, not the one it replaced', async () => {
    setToken(tokenExpiringIn(120, 'stale@example.com'));
    setTokenRefresher(async () => tokenExpiringIn(3600, 'fresh@example.com'));

    const session = await freshSession();
    assert.equal(session?.email, 'fresh@example.com');
    assert.match((await authHeader()).Authorization ?? '', /^Bearer /);
  });

  it('asks once however many callers want a token at the same moment', async () => {
    setToken(tokenExpiringIn(120));
    let asked = 0;
    setTokenRefresher(async () => {
      asked += 1;
      await new Promise((r) => setTimeout(r, 5));
      return tokenExpiringIn(3600);
    });

    // A page that fires six requests on mount must not open six prompts.
    await Promise.all([freshSession(), freshSession(), freshSession(), renewToken(), renewToken(), authHeader()]);
    assert.equal(asked, 1);
  });
});

describe('when renewal cannot help', () => {
  it('reports no session rather than hanging when the provider declines', async () => {
    setToken(tokenExpiringIn(120));
    setTokenRefresher(async () => null);

    assert.equal(await renewToken(), null);
    // The old token is still inside the renewal window but has not expired, so
    // it stays usable — the server, not this file, gets the last word.
    assert.ok(signedIn());
  });

  it('survives a provider that throws instead of resolving', async () => {
    setToken(tokenExpiringIn(120));
    setTokenRefresher(async () => {
      throw new Error('the network is gone');
    });
    // A rejected renewal must not become an unhandled rejection that takes
    // down whatever request was waiting on it.
    assert.equal(await renewToken(), null);
  });

  it('does nothing at all when no provider is registered', async () => {
    setToken(tokenExpiringIn(120));
    const held = signedIn();
    const settled = await freshSession();
    assert.equal(settled?.token, held?.token);
  });

  it('drops the session on sign-out even with a provider registered', async () => {
    setToken(tokenExpiringIn(3600));
    setTokenRefresher(async () => tokenExpiringIn(3600));
    signOut();
    assert.equal(signedIn(), null);
    assert.deepEqual(await authHeader(), {});
  });
});

describe('a sign-out that stands', () => {
  it('does not let renewal quietly sign the user back in', async () => {
    setToken(tokenExpiringIn(3600));
    setTokenRefresher(async () => tokenExpiringIn(3600));

    signOut();
    // The provider would happily issue another token — Google has no opinion
    // about this deployment's refusal. Asking it here is how an app becomes
    // one that cannot be signed out of.
    assert.equal(await renewToken(), null);
    assert.equal(await freshSession(), null);
    assert.equal(signedIn(), null);
  });

  it('lifts the stand-down as soon as somebody actually signs in', async () => {
    setToken(tokenExpiringIn(3600));
    setTokenRefresher(async () => tokenExpiringIn(3600, 'renewed@example.com'));
    signOut();

    // The door was shown and used: renewal is welcome again.
    assert.ok(setToken(tokenExpiringIn(120, 'signed-in@example.com')));
    const session = await freshSession();
    assert.equal(session?.email, 'renewed@example.com');
  });
});
