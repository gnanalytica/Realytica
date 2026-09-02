import { readEnv } from '@realytica/agents';
import type { VerifierConfig } from './verify';

/**
 * Which identity provider this deployment trusts, read from the environment.
 *
 * Two Google products, one env-var shape. You pick the product; nothing else
 * in the codebase has to know which.
 *
 *   Identity Platform / Firebase Authentication
 *     REALYTICA_AUTH_MODE=identity_platform
 *     REALYTICA_AUTH_PROJECT=<your GCP project id>
 *
 *   Google Identity Services (a plain OAuth 2.0 Web client)
 *     REALYTICA_AUTH_MODE=google
 *     REALYTICA_AUTH_CLIENT_ID=<...>.apps.googleusercontent.com
 *
 * Anything else — a different provider entirely — is spelled out:
 *     REALYTICA_AUTH_MODE=oidc
 *     REALYTICA_AUTH_ISSUER=... REALYTICA_AUTH_AUDIENCE=... REALYTICA_AUTH_JWKS_URL=...
 *
 * And for local work with no provider at all:
 *     REALYTICA_AUTH_MODE=off
 *
 * `off` is refused when NODE_ENV is production. A deployment that forgets to
 * configure auth must fail to start, loudly, rather than come up serving every
 * project to anybody who finds the URL — which is exactly what this codebase
 * did before today.
 */

export type AuthMode = 'identity_platform' | 'google' | 'oidc' | 'off';

export interface AuthSettings {
  mode: AuthMode;
  verifier?: VerifierConfig;
  /**
   * Who a request is from when `mode` is `off`.
   *
   * A real, named local operator rather than an anonymous blank, so a trail
   * written during development still reads as somebody's work and is
   * obviously not production data.
   */
  localPrincipal: { subject: string; email: string; name: string };
  /**
   * Emails allowed to claim the first workspace when none exists.
   *
   * Empty means the first person to sign in becomes owner. That is the right
   * default for a firm standing its own instance up, and the wrong one for
   * anything on a public URL, so it can be pinned.
   */
  bootstrapEmails: string[];
  /** Whether a provider that says the address is unverified is good enough. */
  requireVerifiedEmail: boolean;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const IDENTITY_PLATFORM_JWKS =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export class AuthMisconfigured extends Error {}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function readAuthSettings(env: NodeJS.ProcessEnv = process.env): AuthSettings {
  const mode = (readEnv('AUTH_MODE', env) ?? 'off') as AuthMode;
  const common = {
    localPrincipal: {
      subject: readEnv('AUTH_LOCAL_SUBJECT', env) ?? 'local-operator',
      email: readEnv('AUTH_LOCAL_EMAIL', env) ?? 'operator@localhost',
      name: readEnv('AUTH_LOCAL_NAME', env) ?? 'Local operator',
    },
    bootstrapEmails: list(readEnv('AUTH_BOOTSTRAP_EMAILS', env)),
    // Google verifies the address for any account it will issue a token for,
    // so requiring it costs nothing there and closes the door for a provider
    // that would let somebody assert an address they do not hold.
    requireVerifiedEmail: (readEnv('AUTH_REQUIRE_VERIFIED_EMAIL', env) ?? 'true') !== 'false',
  };

  if (mode === 'off') {
    if ((env.NODE_ENV ?? '') === 'production') {
      throw new AuthMisconfigured(
        'REALYTICA_AUTH_MODE is off and NODE_ENV is production. Set REALYTICA_AUTH_MODE to identity_platform, google or oidc — this deployment will not start without authentication.',
      );
    }
    return { mode, ...common };
  }

  if (mode === 'identity_platform') {
    const project = readEnv('AUTH_PROJECT', env) ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT;
    if (!project) {
      throw new AuthMisconfigured('REALYTICA_AUTH_MODE=identity_platform needs REALYTICA_AUTH_PROJECT (your GCP project id).');
    }
    return {
      mode,
      ...common,
      verifier: {
        issuers: [`https://securetoken.google.com/${project}`],
        audience: project,
        jwksUri: readEnv('AUTH_JWKS_URL', env) ?? IDENTITY_PLATFORM_JWKS,
      },
    };
  }

  if (mode === 'google') {
    const clientId = readEnv('AUTH_CLIENT_ID', env);
    if (!clientId) {
      throw new AuthMisconfigured('REALYTICA_AUTH_MODE=google needs REALYTICA_AUTH_CLIENT_ID (the OAuth web client id).');
    }
    return {
      mode,
      ...common,
      verifier: {
        issuers: GOOGLE_ISSUERS,
        audience: clientId,
        jwksUri: readEnv('AUTH_JWKS_URL', env) ?? GOOGLE_JWKS,
      },
    };
  }

  if (mode === 'oidc') {
    const issuer = readEnv('AUTH_ISSUER', env);
    const audience = readEnv('AUTH_AUDIENCE', env);
    const jwksUri = readEnv('AUTH_JWKS_URL', env);
    if (!issuer || !audience || !jwksUri) {
      throw new AuthMisconfigured(
        'REALYTICA_AUTH_MODE=oidc needs REALYTICA_AUTH_ISSUER, REALYTICA_AUTH_AUDIENCE and REALYTICA_AUTH_JWKS_URL.',
      );
    }
    return { mode, ...common, verifier: { issuers: [issuer], audience, jwksUri } };
  }

  throw new AuthMisconfigured(
    `REALYTICA_AUTH_MODE is "${mode}". It must be identity_platform, google, oidc or off.`,
  );
}
