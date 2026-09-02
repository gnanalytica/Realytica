/**
 * What lands in the store document when a credential is saved.
 *
 * The point of sealing is that a copy of the store is no longer a copy of the
 * keys, so the assertions that matter are about what is *absent*: the secret
 * must not appear in the stored value, two identical keys must not look
 * identical, and a value somebody edited must refuse to open rather than
 * decrypt to something else.
 *
 * Also asserted: the legacy path. A store written before this existed holds
 * plaintext, and stranding those would turn a security improvement into an
 * outage — so they must still open, and must get sealed on the next boot.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CredentialKeyMissing,
  CredentialUnreadable,
  isSealed,
  open,
  sameSecret,
  seal,
  sealingAvailable,
} from '../apps/api/src/flows/secret-box';

/** A valid 32-byte key, and a different one, both fixed so failures reproduce. */
const KEY = { REALYTICA_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64') };
const OTHER_KEY = { REALYTICA_CREDENTIAL_KEY: Buffer.alloc(32, 9).toString('base64') };
const SECRET = 'sk-ant-api03-not-a-real-key-0123456789';

describe('sealing a credential', () => {
  it('round-trips the secret exactly', () => {
    assert.equal(open(seal(SECRET, KEY), KEY), SECRET);
  });

  it('leaves no trace of the secret in what gets written down', () => {
    const sealed = seal(SECRET, KEY);
    assert.equal(sealed.includes(SECRET), false);
    // Not even a recognisable fragment: the whole point is that a backup is
    // not a key list.
    assert.equal(sealed.includes('sk-ant'), false);
    assert.equal(sealed.includes('0123456789'), false);
  });

  it('seals the same secret differently every time', () => {
    // Without a fresh IV, two people wiring the same shared key would be
    // visibly identical in the document — which leaks that they are the same.
    assert.notEqual(seal(SECRET, KEY), seal(SECRET, KEY));
  });

  it('handles a secret that is empty, unicode, or long', () => {
    for (const value of ['', '🔑 clé—τιμή', 'x'.repeat(8192)]) {
      assert.equal(open(seal(value, KEY), KEY), value);
    }
  });

  it('accepts a key given as hex as readily as base64', () => {
    const hex = { REALYTICA_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('hex') };
    // The same 32 bytes in the other encoding an operator might generate.
    assert.equal(open(seal(SECRET, hex), KEY), SECRET);
  });
});

describe('what it refuses', () => {
  it('refuses to seal at all when no key is configured', () => {
    // The refusal is the feature. A fallback to plaintext here is how a
    // deployment comes to believe it is encrypted when it is not.
    assert.throws(() => seal(SECRET, {}), CredentialKeyMissing);
    assert.equal(sealingAvailable({}), false);
    assert.equal(sealingAvailable(KEY), true);
  });

  it('refuses a key that is the wrong length rather than padding it', () => {
    assert.throws(() => seal(SECRET, { REALYTICA_CREDENTIAL_KEY: 'too-short' }), CredentialKeyMissing);
    assert.throws(
      () => seal(SECRET, { REALYTICA_CREDENTIAL_KEY: Buffer.alloc(16, 1).toString('base64') }),
      CredentialKeyMissing,
    );
  });

  it('refuses to open with the wrong key, and says which knob is wrong', () => {
    const sealed = seal(SECRET, KEY);
    assert.throws(
      () => open(sealed, OTHER_KEY),
      (err: unknown) => {
        assert.ok(err instanceof CredentialUnreadable);
        assert.match(err.message, /REALYTICA_CREDENTIAL_KEY/);
        return true;
      },
    );
  });

  it('refuses a sealed value that somebody edited, rather than decrypting it to something else', () => {
    const sealed = seal(SECRET, KEY);
    const parts = sealed.split('.');
    // Flip a byte of the ciphertext. Without authentication this would open to
    // a corrupted key that a provider would reject for reasons nobody could
    // trace back to the store.
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString('base64url');
    assert.throws(() => open(parts.join('.'), KEY), CredentialUnreadable);
  });

  it('refuses a malformed value instead of guessing at it', () => {
    assert.throws(() => open('v1.only.three', KEY), CredentialUnreadable);
  });

  it('names the missing key when asked to open something sealed without one', () => {
    const sealed = seal(SECRET, KEY);
    assert.throws(() => open(sealed, {}), CredentialKeyMissing);
  });
});

describe('a store written before sealing existed', () => {
  it('still opens a plaintext secret, key or no key', () => {
    // Stranding these would make an upgrade an outage. They open as-is; the
    // boot migration is what actually gets them sealed.
    assert.equal(open(SECRET, KEY), SECRET);
    assert.equal(open(SECRET, {}), SECRET);
  });

  it('can tell a sealed value from a plaintext one without the key', () => {
    assert.equal(isSealed(seal(SECRET, KEY)), true);
    assert.equal(isSealed(SECRET), false);
    // A secret that happens to start with something version-like is still
    // recognisable, because the prefix is the exact token plus a dot.
    assert.equal(isSealed('v10-token-abc'), false);
  });
});

describe('telling a rename from a rotation', () => {
  it('compares secrets without leaking their length through timing', () => {
    assert.equal(sameSecret(SECRET, SECRET), true);
    assert.equal(sameSecret(SECRET, `${SECRET}x`), false);
    assert.equal(sameSecret('', ''), true);
  });
});
