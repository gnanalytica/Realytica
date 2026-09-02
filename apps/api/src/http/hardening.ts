import type { CorsOptions } from 'cors';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { readEnv, envName } from '@realytica/agents';

/**
 * The three things a JSON API on a public URL needs and this one did not have:
 * an origin list, a throttle, and the headers a browser acts on.
 *
 * All three are configured from the environment and all three fail loudly
 * rather than quietly relaxing — the pattern `auth/config.ts` already sets.
 */

export class HttpMisconfigured extends Error {}

/* ==================================================================== */
/* Origins                                                               */
/* ==================================================================== */

/**
 * Who may drive this API from a browser.
 *
 * `cors()` with no arguments reflects **every** origin and that is what this
 * deployment shipped with. It is not the disaster it first looks like — every
 * route is behind a bearer token, and a token does not ride along on a
 * cross-origin request the way a cookie does — but it means any page on the
 * internet can script this API with a token it has obtained some other way,
 * and it removes the browser's own second opinion about who is calling. The
 * allowlist puts that opinion back.
 *
 * Set `REALYTICA_ALLOWED_ORIGINS` to a comma-separated list of exact origins:
 *
 *     REALYTICA_ALLOWED_ORIGINS=https://app.realytica.com,https://realytica.com
 *
 * Unset is allowed only outside production, where it means "reflect whatever
 * asks" so a developer on any port is not blocked. In production an unset
 * list is a startup failure: coming up with the door open is the failure mode
 * this whole file exists to prevent.
 *
 * Requests with no `Origin` header — curl, a health check, a server-to-server
 * call, the same-origin fetch from the SPA this process serves itself — are
 * always allowed. CORS is a browser rule about cross-origin pages; it was
 * never an authentication mechanism, and refusing originless requests would
 * break every non-browser client while stopping nobody.
 */
export function corsPolicy(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const configured = (readEnv('ALLOWED_ORIGINS', env) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const production = (env.NODE_ENV ?? '') === 'production';

  if (configured.length === 0) {
    if (production) {
      throw new HttpMisconfigured(
        `${envName('ALLOWED_ORIGINS')} is not set and NODE_ENV is production. ` +
          'Set it to the exact origins your web app is served from, comma-separated — this deployment will not start with an open origin policy.',
      );
    }
    return { origin: true, credentials: false, maxAge: 600 };
  }

  const allowed = new Set(configured.map(normaliseOrigin));
  return {
    origin(origin, done) {
      // No Origin header: not a cross-origin browser request. See above.
      if (!origin) return done(null, true);
      if (allowed.has(normaliseOrigin(origin))) return done(null, true);
      // A plain `false` yields a response with no CORS headers, which is what
      // the browser needs to see. Handing back an Error instead would surface
      // as a 500, telling the caller they found a bug rather than a wall.
      return done(null, false);
    },
    credentials: false,
    maxAge: 600,
  };
}

/** Trailing slashes and case in the host are not a different origin. */
function normaliseOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/* ==================================================================== */
/* Headers                                                               */
/* ==================================================================== */

/**
 * The response headers a browser actually acts on.
 *
 * Deliberately not a Content-Security-Policy. A CSP for this app has to admit
 * the identity provider's script, a tile server, and a PDF worker that runs
 * from a blob URL — and a CSP that is subtly wrong does not degrade, it makes
 * sign-in fail with a console message most people will never see. Writing one
 * here from guesswork would trade a real risk for a likelier outage. It
 * belongs with the deployment that knows its own tile and auth origins, which
 * is why `REALYTICA_CSP` passes one straight through when an operator has one
 * to give.
 *
 * HSTS is set only in production and only on a request that arrived over TLS.
 * Sending it from a dev server would pin `localhost` to https in the
 * developer's browser for a year, which is a memorable afternoon.
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const production = (env.NODE_ENV ?? '') === 'production';
  const csp = readEnv('CSP', env);

  return (req: Request, res: Response, next: NextFunction) => {
    // Stops a browser from second-guessing a Content-Type — the mechanism
    // behind "your JSON endpoint served as HTML" style XSS.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Nothing here is meant to be framed, and the SPA holds a session.
    res.setHeader('X-Frame-Options', 'DENY');
    // A project URL carries an id. Do not spend it on every outbound link.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The app asks for none of these; saying so stops an embedded document
    // from asking on its behalf.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (production && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

/* ==================================================================== */
/* Rate limit                                                            */
/* ==================================================================== */

export interface RateLimitOptions {
  /** How many requests one caller may make per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Named in the 429 body so a caller knows which limit they met. */
  name: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window counter, in memory, keyed by principal and then by address.
 *
 * ## What this is and is not
 *
 * It is a brake on one client hammering one instance: a runaway retry loop, a
 * script walking ids, a flow left on a one-minute interval by mistake. It is
 * **not** a defence against a distributed attacker, and on a serverless
 * deployment each instance keeps its own count, so the effective limit is the
 * configured one multiplied by however many instances are warm. Both of those
 * want a shared store — Redis, or the platform's own edge limiter — and
 * saying so here is better than a comment claiming protection this cannot
 * give.
 *
 * ## Why by principal first
 *
 * Behind a corporate NAT or a mobile carrier, thousands of people share an
 * address; limiting by address alone would let one person's runaway script
 * lock out their whole office. The token subject is the accurate unit of
 * "who", so it wins when there is one, and the address is the fallback for
 * requests that have not authenticated yet.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();

    // Expired buckets are dropped on a sweep rather than on a timer, so this
    // holds no handle that would keep a serverless instance alive.
    if (now - lastSweep > options.windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      lastSweep = now;
    }

    const key = `${options.name}:${callerOf(req)}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      setLimitHeaders(res, options.limit, options.limit - 1, now + options.windowMs);
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      setLimitHeaders(res, options.limit, 0, bucket.resetAt);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Too many requests. This deployment allows ${options.limit} ${options.name} requests per ${Math.round(options.windowMs / 1000)}s — try again in ${retryAfter}s.`,
      });
      return;
    }

    setLimitHeaders(res, options.limit, options.limit - bucket.count, bucket.resetAt);
    next();
  };
}

function setLimitHeaders(res: Response, limit: number, remaining: number, resetAt: number): void {
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('RateLimit-Reset', String(Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))));
}

/**
 * Who to count against.
 *
 * `req.principal` is set by `authenticate`, so a limiter mounted below it gets
 * the subject. One mounted above — or hit by a request that never
 * authenticated — falls back to the address.
 */
function callerOf(req: Request): string {
  const principal = (req as Request & { principal?: { subject?: string } }).principal;
  if (principal?.subject) return `u:${principal.subject}`;
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return `ip:${(first ?? req.ip ?? 'unknown').trim()}`;
}

/**
 * How many requests, of what, per minute.
 *
 * Three tiers because the costs differ by orders of magnitude. Reading a
 * register is a memory lookup; running a flow or a chat turn spends money at
 * a model provider and can run for a minute. A single limit generous enough
 * for the first is no limit at all on the second.
 *
 * Every number is overridable, because the right value depends on how many
 * people share the deployment and nobody here knows that.
 */
export function rateLimits(env: NodeJS.ProcessEnv = process.env) {
  const num = (suffix: string, fallback: number): number => {
    const raw = readEnv(suffix, env);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new HttpMisconfigured(`${envName(suffix)} must be a positive number, not "${raw}".`);
    }
    return parsed;
  };
  const minute = 60_000;
  return {
    /** Everything under /api. Loose: this is the runaway-loop brake. */
    api: rateLimit({ name: 'api', limit: num('RATE_LIMIT_API', 600), windowMs: minute }),
    /** Anything that calls a model or a flow. Tight: this one costs money. */
    expensive: rateLimit({ name: 'model', limit: num('RATE_LIMIT_MODEL', 30), windowMs: minute }),
    /** Uploads. Tight for a different reason: bytes and parse time. */
    upload: rateLimit({ name: 'upload', limit: num('RATE_LIMIT_UPLOAD', 60), windowMs: minute }),
  };
}
