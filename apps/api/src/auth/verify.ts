import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';

/**
 * Checking that a token really came from the identity provider you configured.
 *
 * Google issues the token; this file is the half that has to be right on our
 * side. Nothing here mints or refreshes anything — it takes a compact JWS,
 * fetches the signing keys the issuer publishes, and answers one question:
 * may I believe this?
 *
 * Written against Node's own `crypto` rather than a JWT library on purpose.
 * The whole of RS256 verification is `createVerify(...).verify(key, sig)`, and
 * a JWK becomes a key object with `createPublicKey({ format: 'jwk' })` — a
 * dependency here would be a supply-chain surface on the exact path that
 * decides whether a request is authenticated.
 *
 * Two Google products issue these, and both are supported because which one
 * you use is a deployment decision:
 *
 *   Google Identity Services (a plain OAuth client)
 *     iss  https://accounts.google.com   (also bare "accounts.google.com")
 *     aud  your OAuth client id
 *     jwks https://www.googleapis.com/oauth2/v3/certs
 *
 *   Identity Platform / Firebase Authentication
 *     iss  https://securetoken.google.com/<project-id>
 *     aud  <project-id>
 *     jwks https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 *
 * The rules below are the ones that matter, in the order an attacker would
 * try them: the algorithm must come from us and not from the token, the key
 * must be one the issuer publishes, and the issuer and audience must be the
 * ones we were configured with.
 */

export interface VerifierConfig {
  /** Accepted `iss` values. Google publishes two spellings for one of them. */
  issuers: string[];
  /** Accepted `aud` — the OAuth client id, or the GCP project id. */
  audience: string;
  jwksUri: string;
  /** Tolerance for clock drift between the issuer and this machine. */
  clockSkewSeconds?: number;
}

export interface VerifiedToken {
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  issuer: string;
  expiresAt: number;
}

export class TokenRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRejected';
  }
}

/**
 * Only RS256.
 *
 * `alg` travels inside the token, so honouring it is how the classic
 * confusion attacks work — `none` skips verification, and `HS256` invites the
 * verifier to treat the public key as a shared secret. The algorithm is
 * therefore ours to state and the token's only to match.
 */
const ALGORITHM = 'RS256';

const DEFAULT_SKEW_SECONDS = 60;

interface JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface CachedKeys {
  keys: JsonWebKey[];
  /** Epoch millis. Honours the issuer's own Cache-Control where it gives one. */
  expiresAt: number;
}

const KEY_CACHE = new Map<string, CachedKeys>();

/** Keys are cached for at least this long, and at most a day. */
const MIN_KEY_TTL_MS = 60_000;
const MAX_KEY_TTL_MS = 24 * 60 * 60 * 1000;

function ttlFromCacheControl(header: string | null): number {
  const match = header?.match(/max-age=(\d+)/i);
  if (!match) return 10 * 60 * 1000;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return 10 * 60 * 1000;
  return Math.min(MAX_KEY_TTL_MS, Math.max(MIN_KEY_TTL_MS, seconds * 1000));
}

async function keysFor(jwksUri: string, force = false): Promise<JsonWebKey[]> {
  const cached = KEY_CACHE.get(jwksUri);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(jwksUri);
  if (!res.ok) {
    // A stale key set beats no key set: the issuer being briefly unreachable
    // should not sign everybody out of a running deployment.
    if (cached) return cached.keys;
    throw new TokenRejected(`Could not fetch signing keys (${res.status})`);
  }
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = body.keys ?? [];
  if (keys.length === 0) {
    if (cached) return cached.keys;
    throw new TokenRejected('The issuer published no signing keys');
  }
  KEY_CACHE.set(jwksUri, { keys, expiresAt: Date.now() + ttlFromCacheControl(res.headers.get('cache-control')) });
  return keys;
}

/** Only for tests and for a deployment that wants to force a refresh. */
export function clearKeyCache(): void {
  KEY_CACHE.clear();
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

function parseJson<T>(raw: Buffer, what: string): T {
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch {
    throw new TokenRejected(`The token's ${what} is not JSON`);
  }
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  /** Identity Platform nests the provider's own copies here. */
  firebase?: { identities?: Record<string, unknown>; sign_in_provider?: string };
}

function audienceMatches(aud: JwtClaims['aud'], expected: string): boolean {
  const list = Array.isArray(aud) ? aud : aud ? [aud] : [];
  // Length-independent comparison is pointless here — the audience is not a
  // secret — but the token's own claim must never be trusted to `includes` a
  // prefix, so compare whole values only.
  return list.some((value) => {
    if (typeof value !== 'string' || value.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  });
}

/**
 * Verify a compact JWS and return what it says about the person.
 *
 * Throws `TokenRejected` with a reason a log can carry. The reason is
 * deliberately specific in the log and deliberately not returned to the
 * caller by the middleware above it: "expired" and "wrong audience" are
 * different problems for an operator and the same answer for a client.
 */
export async function verifyIdToken(token: string, config: VerifierConfig): Promise<VerifiedToken> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenRejected('Not a compact JWS');
  const [rawHeader, rawClaims, rawSignature] = parts as [string, string, string];

  const header = parseJson<JwtHeader>(decodeSegment(rawHeader), 'header');
  if (header.alg !== ALGORITHM) {
    throw new TokenRejected(`Unsupported algorithm ${header.alg ?? '(none stated)'}`);
  }

  const claims = parseJson<JwtClaims>(decodeSegment(rawClaims), 'claims');

  // Signature before claims: an unverified token's claims are attacker input,
  // and reading them first invites decisions to be made on them by accident.
  const signature = decodeSegment(rawSignature);
  const signed = Buffer.from(`${rawHeader}.${rawClaims}`, 'utf8');

  let keys = await keysFor(config.jwksUri);
  let matched = keys.filter((k) => !header.kid || k.kid === header.kid);
  if (matched.length === 0) {
    // Google rotates keys; an unknown `kid` usually means our cache is behind
    // rather than that the token is forged. One forced refresh, then reject.
    keys = await keysFor(config.jwksUri, true);
    matched = keys.filter((k) => !header.kid || k.kid === header.kid);
  }
  if (matched.length === 0) throw new TokenRejected('Signed with a key the issuer does not publish');

  const ok = matched.some((jwk) => {
    if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false;
    try {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      return createVerify('RSA-SHA256').update(signed).verify(key, signature);
    } catch {
      return false;
    }
  });
  if (!ok) throw new TokenRejected('Signature does not verify');

  const skew = config.clockSkewSeconds ?? DEFAULT_SKEW_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== 'number') throw new TokenRejected('No expiry');
  if (claims.exp + skew < now) throw new TokenRejected('Expired');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new TokenRejected('Not valid yet');
  if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new TokenRejected('Issued in the future');

  if (!claims.iss || !config.issuers.includes(claims.iss)) {
    throw new TokenRejected(`Issued by ${claims.iss ?? '(nobody)'}`);
  }
  if (!audienceMatches(claims.aud, config.audience)) {
    throw new TokenRejected('Issued for a different audience');
  }
  if (!claims.sub) throw new TokenRejected('No subject');

  // Google sends this as a boolean; some providers send the string "true".
  const verified = claims.email_verified === true || claims.email_verified === 'true';

  return {
    subject: claims.sub,
    email: (claims.email ?? '').trim(),
    emailVerified: verified,
    name: claims.name,
    picture: claims.picture,
    issuer: claims.iss,
    expiresAt: claims.exp,
  };
}
