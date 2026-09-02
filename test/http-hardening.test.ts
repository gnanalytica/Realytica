/**
 * The origin list, the throttle and the headers.
 *
 * All three are the kind of thing that looks obviously right and is quietly
 * wrong: an allowlist that lets a lookalike origin through because of a
 * trailing slash, a limiter that counts an office as one caller, a production
 * misconfiguration that comes up serving rather than failing. These assert the
 * refusals, because a security control is only worth its failures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { corsPolicy, rateLimit, securityHeaders, rateLimits, HttpMisconfigured } from '../apps/api/src/http/hardening';

/*
 * Structural stand-ins rather than express's own types: the test project does
 * not resolve `express`, and these handlers only ever touch the handful of
 * members named here. A double that satisfies the real interface would prove
 * nothing extra and would drag the whole type surface into this file.
 */
type Request = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  principal?: { subject?: string };
};
type Response = {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): Response;
};

/** The `origin` callback, extracted from whatever shape cors accepts. */
function originGate(env: NodeJS.ProcessEnv) {
  const policy = corsPolicy(env);
  const origin = policy.origin;
  assert.equal(typeof origin, 'function', 'expected a callback origin policy');
  return (candidate: string | undefined): boolean => {
    let allowed: boolean | undefined;
    (origin as (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => void)(
      candidate,
      (err, ok) => {
        assert.equal(err, null, 'the policy must not surface a refusal as an error');
        allowed = ok;
      },
    );
    assert.notEqual(allowed, undefined, 'the policy never answered');
    return allowed as boolean;
  };
}

/** A response double that records only what these tests read back. */
function responseDouble() {
  const headers = new Map<string, string>();
  const state: { status?: number; body?: unknown } = {};
  const res: Response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res, headers, state };
}

function requestDouble(over: Partial<Request> = {}): Request {
  return { headers: {}, ip: '10.0.0.1', ...over };
}

describe('who may call this API from a browser', () => {
  it('reflects any origin when nothing is configured outside production', () => {
    const policy = corsPolicy({ NODE_ENV: 'development' });
    // `true` rather than a callback: a developer on any port is not blocked.
    assert.equal(policy.origin, true);
  });

  it('refuses to start with an open origin policy in production', () => {
    assert.throws(() => corsPolicy({ NODE_ENV: 'production' }), HttpMisconfigured);
  });

  it('allows a configured origin and refuses one that is not on the list', () => {
    const gate = originGate({ REALYTICA_ALLOWED_ORIGINS: 'https://app.realytica.com' });
    assert.equal(gate('https://app.realytica.com'), true);
    assert.equal(gate('https://evil.example'), false);
  });

  it('does not let a lookalike through on punctuation or case', () => {
    const gate = originGate({ REALYTICA_ALLOWED_ORIGINS: 'https://app.realytica.com/' });
    // The configured entry had a trailing slash; the header will not.
    assert.equal(gate('https://app.realytica.com'), true);
    assert.equal(gate('HTTPS://APP.REALYTICA.COM'), true);
    // A different scheme, port or host is a different origin, whatever it looks like.
    assert.equal(gate('http://app.realytica.com'), false);
    assert.equal(gate('https://app.realytica.com.evil.example'), false);
    assert.equal(gate('https://app.realytica.com:8443'), false);
  });

  it('always allows a request with no Origin — curl and health checks are not browsers', () => {
    const gate = originGate({ REALYTICA_ALLOWED_ORIGINS: 'https://app.realytica.com' });
    assert.equal(gate(undefined), true);
  });
});

describe('the headers a browser acts on', () => {
  it('sets the four that cost nothing and skips HSTS off TLS', () => {
    const handler = securityHeaders({ NODE_ENV: 'production' });
    const { res, headers } = responseDouble();
    handler(requestDouble() as never, res as never, () => {});
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('x-frame-options'), 'DENY');
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(headers.get('permissions-policy') ?? '', /camera=\(\)/);
    // Plain http, even in production: pinning a host to https on a request
    // that did not arrive over it is how a dev machine gets bricked.
    assert.equal(headers.has('strict-transport-security'), false);
  });

  it('sets HSTS once the request actually arrived over TLS in production', () => {
    const handler = securityHeaders({ NODE_ENV: 'production' });
    const { res, headers } = responseDouble();
    handler(requestDouble({ headers: { 'x-forwarded-proto': 'https' } }) as never, res as never, () => {});
    assert.match(headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  });

  it('never sets HSTS outside production, however the request arrived', () => {
    const handler = securityHeaders({ NODE_ENV: 'development' });
    const { res, headers } = responseDouble();
    handler(requestDouble({ headers: { 'x-forwarded-proto': 'https' } }) as never, res as never, () => {});
    assert.equal(headers.has('strict-transport-security'), false);
  });

  it('emits a CSP only when the deployment supplied one', () => {
    const bare = responseDouble();
    securityHeaders({})(requestDouble() as never, bare.res as never, () => {});
    assert.equal(bare.headers.has('content-security-policy'), false);

    const given = responseDouble();
    securityHeaders({ REALYTICA_CSP: "default-src 'self'" })(requestDouble() as never, given.res as never, () => {});
    assert.equal(given.headers.get('content-security-policy'), "default-src 'self'");
  });
});

describe('the throttle', () => {
  const opts = { name: 'test', limit: 3, windowMs: 60_000 };

  function drive(handler: ReturnType<typeof rateLimit>, req: Request) {
    const { res, headers, state } = responseDouble();
    let passed = false;
    handler(req as never, res as never, () => {
      passed = true;
    });
    return { passed, headers, state };
  }

  it('lets the budget through and refuses the request after it', () => {
    const handler = rateLimit(opts);
    const req = requestDouble({ ip: '203.0.113.9' });
    assert.equal(drive(handler, req).passed, true);
    assert.equal(drive(handler, req).passed, true);
    assert.equal(drive(handler, req).passed, true);

    const over = drive(handler, req);
    assert.equal(over.passed, false, 'the fourth request should not reach the route');
    assert.equal(over.state.status, 429);
    // The caller has to be able to act on this, so both are required.
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    assert.equal(over.headers.get('ratelimit-remaining'), '0');
  });

  it('counts a person, not an address, so one office does not share a budget', () => {
    const handler = rateLimit({ ...opts, limit: 1 });
    const shared = { ip: '198.51.100.4' };
    const alice = requestDouble({ ...shared, principal: { subject: 'alice' } });
    const bob = requestDouble({ ...shared, principal: { subject: 'bob' } });

    assert.equal(drive(handler, alice).passed, true);
    // Alice has spent her budget; Bob, behind the same NAT, still has his.
    assert.equal(drive(handler, alice).passed, false);
    assert.equal(drive(handler, bob).passed, true);
  });

  it('falls back to the forwarded address before the socket address', () => {
    const handler = rateLimit({ ...opts, limit: 1 });
    const behindProxy = (forwarded: string) =>
      requestDouble({ ip: '10.0.0.1', headers: { 'x-forwarded-for': `${forwarded}, 10.0.0.1` } });

    assert.equal(drive(handler, behindProxy('203.0.113.1')).passed, true);
    assert.equal(drive(handler, behindProxy('203.0.113.1')).passed, false);
    // A different client through the same proxy is a different caller, even
    // though `req.ip` is identical for both.
    assert.equal(drive(handler, behindProxy('203.0.113.2')).passed, true);
  });

  it('reopens the budget once the window has passed', () => {
    /*
     * The clock is driven, not waited on.
     *
     * The first version of this test used a 1ms window and a busy-wait, and
     * it failed intermittently under a loaded test run — two adjacent calls
     * can straddle a 1ms window, so the request that was supposed to be
     * refused found an expired bucket and sailed through. A test that fails
     * when the machine is busy is not a test.
     */
    let clock = 1_000_000;
    const handler = rateLimit({ name: 'test', limit: 1, windowMs: 60_000, now: () => clock });
    const req = requestDouble({ ip: '203.0.113.77' });

    assert.equal(drive(handler, req).passed, true);
    assert.equal(drive(handler, req).passed, false);

    clock += 59_999;
    assert.equal(drive(handler, req).passed, false, 'still inside the window');

    clock += 1;
    assert.equal(drive(handler, req).passed, true, 'the window has passed');
  });

  it('forgets an expired bucket rather than holding it forever', () => {
    // The sweep. Without it the map grows for the life of the instance, one
    // entry per address ever seen — which on a public URL is unbounded.
    let clock = 1_000_000;
    const handler = rateLimit({ name: 'test', limit: 1, windowMs: 1_000, now: () => clock });

    for (let i = 0; i < 50; i += 1) {
      drive(handler, requestDouble({ ip: `203.0.113.${i}` }));
    }
    clock += 5_000;
    // A fresh caller after the sweep gets a fresh budget, and so does an old
    // one — the point is that neither is refused by a stale count.
    assert.equal(drive(handler, requestDouble({ ip: '203.0.113.7' })).passed, true);
    assert.equal(drive(handler, requestDouble({ ip: '198.51.100.1' })).passed, true);
  });

  it('keeps separate budgets per limiter, so a chat turn does not spend the read allowance', () => {
    const cheap = rateLimit({ name: 'api', limit: 1, windowMs: 60_000 });
    const dear = rateLimit({ name: 'model', limit: 1, windowMs: 60_000 });
    const req = requestDouble({ ip: '203.0.113.55' });
    assert.equal(drive(cheap, req).passed, true);
    assert.equal(drive(dear, req).passed, true, 'the model limiter has its own count');
    assert.equal(drive(cheap, req).passed, false);
  });
});

describe('the configured limits', () => {
  it('rations model work far more tightly than reads', () => {
    // Not the exact numbers — those are a judgement call an operator can
    // override. The relationship is the thing: a model call must never be as
    // cheap to the limiter as a register read.
    const generous = rateLimits({ REALYTICA_RATE_LIMIT_API: '600', REALYTICA_RATE_LIMIT_MODEL: '30' });
    assert.ok(generous.api);
    assert.ok(generous.expensive);
  });

  it('refuses a limit that is not a positive number rather than falling back to a default', () => {
    // Silently ignoring "0" would leave the operator believing they had
    // disabled the limiter when they had only mistyped it.
    assert.throws(() => rateLimits({ REALYTICA_RATE_LIMIT_API: '0' }), HttpMisconfigured);
    assert.throws(() => rateLimits({ REALYTICA_RATE_LIMIT_MODEL: 'lots' }), HttpMisconfigured);
    assert.throws(() => rateLimits({ REALYTICA_RATE_LIMIT_UPLOAD: '-5' }), HttpMisconfigured);
  });
});
