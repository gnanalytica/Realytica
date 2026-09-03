import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readEnv } from '@realytica/agents';

/**
 * Where a flow is allowed to reach.
 *
 * ## The hole this closes
 *
 * An `http` node takes a URL an operator typed and a credential the workspace
 * stored, and the server fetches it. That is the node's whole purpose and it
 * is also a server-side request forgery primitive: `http://169.254.169.254/`
 * is the cloud metadata endpoint, and on most platforms it hands back
 * credentials for the whole deployment to anything that asks from inside.
 * `http://localhost:5174/api/...` reaches this API from behind its own auth.
 * Neither needs a bug to exploit — just an admin account and a text field.
 *
 * ## What is checked
 *
 * The scheme, then the address the host actually resolves to. Resolving
 * matters: a blocklist of literal addresses is defeated by any hostname whose
 * A record points at one, and those are trivially registered. So the name is
 * looked up and the answer is checked, which is the difference between a
 * guard and a speed bump.
 *
 * ## What is not
 *
 * There is a gap between this check and the request: DNS could answer
 * differently the second time. Closing that properly means resolving once and
 * connecting to the address with the hostname carried in the `Host` header and
 * SNI, which Node's `fetch` does not expose. The gap is narrow, it needs an
 * attacker controlling a DNS server, and saying so here is better than a
 * comment implying more than the code does.
 *
 * A deployment that genuinely needs to reach something on its own network can
 * name it: `REALYTICA_FLOW_ALLOW_HOSTS=internal.example.com,10.0.0.7`. That is
 * a decision an operator makes once, in the environment, rather than one every
 * URL field makes silently.
 */

export class OutboundRefused extends Error {}

/** Ranges no flow may reach unless the deployment names the host. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    // Unique-local and link-local.
    if (/^f[cd][0-9a-f]{2}:/.test(v6) || v6.startsWith('fe80:')) return true;
    /*
     * An IPv4 address wearing a v6 hat still points where it points.
     *
     * Both spellings, because they are the same address and only one of them
     * survives parsing: `new URL('http://[::ffff:169.254.169.254]/')` reports
     * its hostname as `[::ffff:a9fe:a9fe]`, so a check written only against
     * the dotted form never fires on anything a URL actually produced.
     */
    const dotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and the metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function allowedHosts(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (readEnv('FLOW_ALLOW_HOSTS', env) ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Refuse the request before it is made, with a reason an operator can act on.
 *
 * Throws `OutboundRefused`; callers turn that into a node failure or a 400.
 */
export async function assertReachable(raw: string, env: NodeJS.ProcessEnv = process.env): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundRefused(`"${raw}" is not a URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    // `file:`, `gopher:` and friends are not "a stricter kind of fetch" — they
    // are a different capability entirely.
    throw new OutboundRefused(`Only http and https are allowed, not ${url.protocol.replace(':', '')}.`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (allowedHosts(env).has(host)) return url;

  // A literal address needs no lookup, and looking one up would be a way to
  // launder it through a resolver.
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new OutboundRefused(refusal(host, host));
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new OutboundRefused(`${host} does not resolve.`);
  }
  if (addresses.length === 0) throw new OutboundRefused(`${host} does not resolve.`);

  // Every answer, not the first: a name that resolves to a public address and
  // a private one is the whole trick.
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  if (bad) throw new OutboundRefused(refusal(host, bad.address));

  return url;
}

/**
 * Reach out, having checked where — and refuse to be redirected elsewhere.
 *
 * `assertReachable` runs once, before the request. `fetch` then followed
 * redirects by default, so a host that passed the check could answer
 * `302 Location: http://169.254.169.254/...` and the body of an address
 * nothing had checked came back as the node's result. The pre-flight guard was
 * never wrong; it was simply not the last word on where the request went.
 *
 * Both halves live in one function because they are one decision. A caller
 * that did its own `fetch` after calling `assertReachable` would be reopening
 * exactly this hole, and there is now no reason for one to.
 */
export async function fetchOutbound(raw: string, init: RequestInit = {}): Promise<Response> {
  const url = await assertReachable(raw);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location');
    throw new OutboundRefused(
      `${raw} answered ${res.status} and redirected to ${to ?? 'an address it did not name'}. ` +
        'Redirects are not followed: where a flow may reach is checked before the request is sent, and a redirect is a second address that check never saw. ' +
        'Point this at the final URL.',
    );
  }
  return res;
}

function refusal(host: string, address: string): string {
  return (
    `${host} resolves to ${address}, which is inside this deployment's own network. ` +
    'A flow may not reach it — that address range includes the cloud metadata endpoint and this API itself. ' +
    'If you genuinely need it, name the host in REALYTICA_FLOW_ALLOW_HOSTS.'
  );
}
