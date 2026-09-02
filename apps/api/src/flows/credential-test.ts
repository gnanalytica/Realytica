import type { CredentialRecord, StoredCredential } from '@realytica/shared';
import { noteCredentialUse, secretFor } from './credentials';
import { CredentialKeyMissing, CredentialUnreadable } from './secret-box';
import { OutboundRefused, assertReachable } from './outbound';

/**
 * Finding out whether a stored credential still works.
 *
 * ## Why this is worth having
 *
 * A credential already carried `lastUsedAt` and `lastResult` and nothing ever
 * set them until a flow happened to run. So the screen could say "this stopped
 * working on Tuesday" about a key that had been dead since March, and an
 * operator wiring a new connector had no way to know they had pasted it wrong
 * except to draw a flow and run it.
 *
 * ## What "works" means here, exactly
 *
 * The credential is sent to an endpoint and the answer is read. That is all it
 * can mean: there is no universal "is this key valid" question to ask, because
 * a key is only valid *against something*. So:
 *
 * - An MCP credential carries its own server in `target`, so the test is a
 *   real `tools/list` call and the answer is worth something.
 * - Every other kind is a header applied to whatever URL a node names, so the
 *   operator supplies the URL. Asking is honest; guessing an endpoint and
 *   reporting its refusal as the credential's fault would not be.
 *
 * A 401 or 403 is `refused` — the credential reached something that rejected
 * it. Any other status is `ok`: the credential was accepted, and a 404 from an
 * endpoint the operator mistyped is not the key's problem. That distinction is
 * the entire value of the result.
 */

export type CredentialTestOutcome = NonNullable<CredentialRecord['lastResult']>;

export interface CredentialTestResult {
  outcome: CredentialTestOutcome;
  /** A sentence for the screen. Never contains the secret. */
  detail: string;
  /** The status the endpoint answered with, when it answered at all. */
  status?: number;
}

/** How long a test may hang before it is a failure. Short: somebody is watching. */
const TEST_TIMEOUT_MS = 10_000;

function headersFor(cred: StoredCredential): Record<string, string> {
  switch (cred.kind) {
    case 'bearer_token':
    case 'mcp_server':
      return { authorization: `Bearer ${cred.secret}` };
    case 'api_key':
      return { [cred.target || 'x-api-key']: cred.secret };
    case 'header':
      return { [cred.target || 'authorization']: cred.secret };
    case 'basic_auth':
      return { authorization: `Basic ${Buffer.from(`${cred.username ?? ''}:${cred.secret}`).toString('base64')}` };
    default:
      return {};
  }
}

export class CredentialTestImpossible extends Error {}

export async function testCredential(
  tenantId: string,
  credentialId: string,
  givenUrl?: string,
): Promise<CredentialTestResult | undefined> {
  let cred: StoredCredential | undefined;
  try {
    cred = secretFor(tenantId, credentialId);
  } catch (err) {
    // The credential is here and cannot be opened. That is a deployment
    // problem, not a provider one, and saying "refused" would send the
    // operator to rotate a key that is probably fine.
    if (err instanceof CredentialUnreadable || err instanceof CredentialKeyMissing) {
      throw new CredentialTestImpossible(err.message);
    }
    throw err;
  }
  if (!cred) return undefined;

  const target = (givenUrl?.trim() || (cred.kind === 'mcp_server' ? cred.target : undefined))?.trim();
  if (!target) {
    throw new CredentialTestImpossible(
      'This kind of credential is a header sent to whatever a node calls, so there is nothing to test it against on its own. Give the URL to try it on.',
    );
  }

  let url: URL;
  try {
    url = await assertReachable(target);
  } catch (err) {
    if (err instanceof OutboundRefused) throw new CredentialTestImpossible(err.message);
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const mcp = cred.kind === 'mcp_server';
    const res = await fetch(url, {
      method: mcp ? 'POST' : 'GET',
      headers: {
        accept: mcp ? 'application/json, text/event-stream' : 'application/json',
        ...(mcp ? { 'content-type': 'application/json' } : {}),
        ...headersFor(cred),
      },
      // A real MCP handshake rather than a bare POST: `tools/list` is the
      // cheapest call that proves the server answered *as an MCP server*.
      ...(mcp ? { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) } : {}),
      // Do not follow a redirect: a 302 to another host would carry this
      // credential somewhere the reachability check never saw.
      redirect: 'manual',
      signal: controller.signal,
    });

    const outcome: CredentialTestOutcome = res.status === 401 || res.status === 403 ? 'refused' : 'ok';
    await noteCredentialUse(tenantId, credentialId, outcome);
    return {
      outcome,
      status: res.status,
      detail:
        outcome === 'refused'
          ? `${url.host} answered ${res.status}. The credential reached it and was rejected.`
          : `${url.host} answered ${res.status}. The credential was accepted.`,
    };
  } catch (err) {
    await noteCredentialUse(tenantId, credentialId, 'unreachable');
    const why = controller.signal.aborted
      ? `did not answer within ${TEST_TIMEOUT_MS / 1000}s`
      : `could not be reached: ${err instanceof Error ? err.message : 'no reason given'}`;
    return { outcome: 'unreachable', detail: `${url.host} ${why}. This says nothing about the credential itself.` };
  } finally {
    clearTimeout(timer);
  }
}
