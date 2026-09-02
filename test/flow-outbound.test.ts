/**
 * Where a flow is allowed to reach.
 *
 * An http node takes a URL somebody typed and a credential the workspace
 * stored, and the server fetches it. That is the node's purpose and also a
 * server-side request forgery primitive: `169.254.169.254` is the cloud
 * metadata endpoint on every major platform, and it hands deployment
 * credentials to anything that asks from inside.
 *
 * These are all refusals, deliberately. A guard is worth exactly what it
 * refuses, and the interesting cases are the ones that look fine — a hostname
 * that resolves inward, a v4 address wearing a v6 hat, a scheme that is not
 * really a fetch at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OutboundRefused, assertReachable } from '../apps/api/src/flows/outbound';

async function refuses(url: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    await assertReachable(url, env);
  } catch (err) {
    assert.ok(err instanceof OutboundRefused, `expected a refusal for ${url}, got ${String(err)}`);
    return err.message;
  }
  assert.fail(`${url} should have been refused`);
}

describe('the scheme', () => {
  it('refuses anything that is not http or https', async () => {
    // `file:` is not a stricter kind of fetch, it is a different capability.
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/x']) {
      await refuses(url);
    }
  });

  it('refuses something that is not a URL at all', async () => {
    await refuses('not a url');
    await refuses('');
  });
});

describe('addresses inside the deployment', () => {
  it('refuses the cloud metadata endpoint', async () => {
    const message = await refuses('http://169.254.169.254/latest/meta-data/');
    // The message has to name the fix, or an operator meeting it legitimately
    // has nowhere to go.
    assert.match(message, /REALYTICA_FLOW_ALLOW_HOSTS/);
  });

  it('refuses loopback, so a flow cannot call this API from behind its own auth', async () => {
    for (const url of ['http://127.0.0.1:5174/api/projects', 'http://127.1.2.3/', 'https://0.0.0.0/']) {
      await refuses(url);
    }
  });

  it('refuses every private range, not just the famous one', async () => {
    for (const host of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1']) {
      await refuses(`https://${host}/x`);
    }
  });

  it('allows a public address on the edge of a private range', async () => {
    // 172.15 and 172.32 are public; a range check written as a prefix match
    // rather than an interval gets these wrong.
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '9.9.9.9']) {
      const url = await assertReachable(`https://${host}/x`, {});
      assert.equal(url.hostname, host);
    }
  });

  it('refuses IPv6 loopback and unique-local', async () => {
    for (const url of ['http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/']) {
      await refuses(url);
    }
  });

  it('refuses a v4 address wearing a v6 hat', async () => {
    // `::ffff:169.254.169.254` reaches exactly the same place.
    await refuses('http://[::ffff:169.254.169.254]/');
    await refuses('http://[::ffff:127.0.0.1]/');
  });

  it('refuses multicast and reserved space', async () => {
    await refuses('http://224.0.0.1/');
    await refuses('http://255.255.255.255/');
  });
});

describe('hostnames', () => {
  it('refuses a name that resolves inward', async () => {
    // The whole reason the guard resolves rather than pattern-matching: a
    // blocklist of literals is defeated by any name pointing at one, and those
    // are trivially registered.
    await refuses('http://localhost:5174/api/projects');
  });

  it('refuses a name that does not resolve, rather than trying it', async () => {
    const message = await refuses('https://this-host-does-not-exist.invalid/x');
    assert.match(message, /does not resolve/);
  });
});

describe('the escape hatch', () => {
  it('allows a host the deployment named, private or not', async () => {
    // A decision an operator makes once, in the environment — rather than one
    // every URL field makes silently.
    const url = await assertReachable('http://10.0.0.7:8080/tools', {
      REALYTICA_FLOW_ALLOW_HOSTS: 'internal.example.com, 10.0.0.7',
    });
    assert.equal(url.hostname, '10.0.0.7');
  });

  it('does not let a named host open the door for its neighbours', async () => {
    await refuses('http://10.0.0.8/x', { REALYTICA_FLOW_ALLOW_HOSTS: '10.0.0.7' });
  });

  it('matches the host case-insensitively, as DNS does', async () => {
    const url = await assertReachable('http://LOCALHOST:5174/x', { REALYTICA_FLOW_ALLOW_HOSTS: 'localhost' });
    assert.equal(url.port, '5174');
  });
});
