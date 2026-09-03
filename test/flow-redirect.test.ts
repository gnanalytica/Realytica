/**
 * A redirect is a second address, and the guard only ever saw the first.
 *
 * `assertReachable` resolves a URL's host and refuses anything inside the
 * deployment's own network — the cloud metadata endpoint, this API behind its
 * own auth. It runs once, before the request. Node's `fetch` then followed
 * redirects by default, so a host that passed the check could answer
 * `302 Location: http://169.254.169.254/...` and the body of an address
 * nothing had checked came back as the node's result.
 *
 * `credential-test.ts` had declined to follow redirects since it was written,
 * with a comment saying why. The two nodes that actually carry a stored
 * credential on an unattended schedule — http and mcp — did not, which is why
 * checking and fetching are now one function rather than two things a caller
 * has to remember to pair.
 *
 * The property is not "the metadata endpoint is unreachable" — that is
 * `flow-outbound.test.ts`, and it is about the pre-flight check. This is the
 * narrower one that holds wherever the redirect points: a 3xx ends the request
 * with a sentence rather than being followed somewhere nothing approved.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { OutboundRefused, fetchOutbound } from '../apps/api/src/flows/outbound';

let redirector: Server;
let destination: Server;
let redirectUrl = '';
let destinationUrl = '';
const previousAllow = process.env.REALYTICA_FLOW_ALLOW_HOSTS;

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

before(async () => {
  // The body a followed redirect would have handed back. Reading it at all is
  // the failure this file is about.
  destination = createServer((_req, res) => res.end('BODY-BEHIND-THE-REDIRECT'));
  destinationUrl = `http://127.0.0.1:${await listen(destination)}/latest/meta-data/`;

  redirector = createServer((_req, res) => {
    res.writeHead(302, { location: destinationUrl });
    res.end();
  });
  redirectUrl = `http://127.0.0.1:${await listen(redirector)}/`;

  /*
   * Loopback is refused by the pre-flight check, and here it is only standing
   * in for a public host that happens to redirect. Naming it is what a
   * deployment would do for a genuinely internal endpoint, and it keeps this
   * test about the redirect rather than about the address — the address is
   * already covered next door.
   */
  process.env.REALYTICA_FLOW_ALLOW_HOSTS = '127.0.0.1';
});

after(() => {
  redirector.close();
  destination.close();
  if (previousAllow === undefined) delete process.env.REALYTICA_FLOW_ALLOW_HOSTS;
  else process.env.REALYTICA_FLOW_ALLOW_HOSTS = previousAllow;
});

describe('reaching out through a redirect', () => {
  it('refuses a 3xx instead of following it', async () => {
    const failure = await fetchOutbound(redirectUrl).then(
      async (res) => assert.fail(`the redirect was followed and returned ${res.status} ${await res.text()}`),
      (err: unknown) => {
        assert.ok(err instanceof OutboundRefused, `expected a refusal, got ${String(err)}`);
        return err.message;
      },
    );

    assert.match(failure, /302/);
    assert.match(failure, /redirected to/, 'the refusal must say what happened, not merely that it failed');
    // The target is named: an operator who meant to reach it needs to know
    // what to put in the URL field instead.
    assert.ok(failure.includes(destinationUrl), `expected the target named in: ${failure}`);
    assert.doesNotMatch(failure, /BODY-BEHIND-THE-REDIRECT/, 'and the body must never have been read');
  });

  it('still returns an ordinary response', async () => {
    // The guard must not have cost the callers their purpose.
    const res = await fetchOutbound(destinationUrl);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'BODY-BEHIND-THE-REDIRECT');
  });

  it('still refuses an address the pre-flight check rejects', async () => {
    // `fetchOutbound` must not have become a way around `assertReachable` —
    // it has to be strictly the stronger of the two.
    await assert.rejects(
      () => fetchOutbound('http://169.254.169.254/latest/meta-data/', {}),
      (err: unknown) => err instanceof OutboundRefused && /inside this deployment/.test(err.message),
    );
  });
});
