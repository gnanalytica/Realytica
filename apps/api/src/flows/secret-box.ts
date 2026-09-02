import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { readEnv, envName } from '@realytica/agents';

/**
 * Sealing a credential before it is written down.
 *
 * ## The problem this closes
 *
 * The store is one JSON document. When flow credentials went into it they went
 * in as plaintext, which meant a backup of the store, a debug dump, a copy of
 * the blob pulled down to reproduce a bug — each carried every API key an
 * operator had ever wired up. `flows/credentials.ts` said so honestly and did
 * it anyway. This is that debt paid: what lands in the document is ciphertext,
 * and the key that opens it lives in the environment, which backups do not
 * carry.
 *
 * That is the whole claim, and it is worth being precise about its limit.
 * Anything that can read this process's environment can read the credentials,
 * because the process has to be able to use them. What this buys is that the
 * *data* and the *key* are no longer in the same place, so losing one no
 * longer means losing both. That is the property most breaches actually turn
 * on.
 *
 * ## AES-256-GCM, not a hash and not a cipher alone
 *
 * A credential must come back out, so hashing is not available. GCM is chosen
 * over a bare cipher because it authenticates: a ciphertext somebody edited in
 * the JSON fails to open rather than decrypting to something else. A fresh
 * random IV per seal is what keeps two identical keys from looking identical
 * in the document.
 *
 * ## The format
 *
 *     v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
 *
 * Self-describing on purpose. A boolean `sealed` flag beside the value could
 * disagree with the value; a prefix cannot. It also leaves room for a `v2`
 * without a migration that has to guess what it is looking at — which matters
 * because the one thing worse than a plaintext secret is a secret nobody can
 * read any more.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // GCM's native size; anything else costs a rehash of the IV.
const KEY_BYTES = 32;

export class CredentialKeyMissing extends Error {}
export class CredentialUnreadable extends Error {}

/**
 * The key, read once per call rather than cached at module load.
 *
 * A cached key is a key that cannot be rotated without a restart *and* a key
 * that tests cannot vary. Reading it each time costs a base64 decode against
 * operations that already involve disk and network.
 */
function keyFrom(env: NodeJS.ProcessEnv): Buffer | undefined {
  const raw = readEnv('CREDENTIAL_KEY', env);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // Accept either encoding an operator is likely to have generated. Hex is
  // what `openssl rand -hex 32` gives; base64 is what most key managers hand
  // back. Guessing between them is safe because only one can be 32 bytes.
  const buffer = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (buffer.length !== KEY_BYTES) {
    throw new CredentialKeyMissing(
      `${envName('CREDENTIAL_KEY')} must decode to ${KEY_BYTES} bytes, and this one is ${buffer.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return buffer;
}

/** Whether this deployment can seal at all. */
export function sealingAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return keyFrom(env) !== undefined;
}

/** Whether a stored value is already sealed, without needing the key. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${VERSION}.`);
}

/**
 * Turn a secret into the form that gets written down.
 *
 * Refuses rather than falling through to plaintext when no key is configured.
 * A silent fallback is how a deployment ends up believing its credentials are
 * encrypted when they are not — the failure has to be at the moment of
 * storing, where somebody is watching, and `initCredentialSealing` makes sure
 * that moment is at boot rather than the first time a key is saved.
 */
export function seal(secret: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = keyFrom(env);
  if (!key) {
    throw new CredentialKeyMissing(
      `${envName('CREDENTIAL_KEY')} is not set, so this credential cannot be stored safely. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join('.');
}

/**
 * Read a stored value back.
 *
 * A value with no version prefix is plaintext from a store written before this
 * existed, and is returned as-is — refusing it would strand every credential
 * an operator had already saved, turning a security improvement into an
 * outage. `resealLegacyCredentials` is what actually gets those upgraded.
 */
export function open(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isSealed(stored)) return stored;

  const parts = stored.split('.');
  if (parts.length !== 4) {
    throw new CredentialUnreadable('This credential is malformed and cannot be read. Re-enter it.');
  }
  const [, ivPart, tagPart, ctPart] = parts;

  const key = keyFrom(env);
  if (!key) {
    throw new CredentialKeyMissing(
      `This credential is sealed but ${envName('CREDENTIAL_KEY')} is not set. ` +
        'Restore the key this deployment was configured with, or delete and re-enter the credential.',
    );
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, unb64(ivPart));
    decipher.setAuthTag(unb64(tagPart));
    return Buffer.concat([decipher.update(unb64(ctPart)), decipher.final()]).toString('utf8');
  } catch {
    // GCM refuses on a wrong key and on a tampered ciphertext identically, and
    // the caller cannot act differently on the two anyway. The message names
    // the likely cause rather than the cryptographic one.
    throw new CredentialUnreadable(
      `This credential cannot be opened with the current ${envName('CREDENTIAL_KEY')}. ` +
        'Either the key was rotated without re-sealing, or the stored value was altered. Re-enter the credential.',
    );
  }
}

/**
 * Whether two secrets are the same, without either being compared in a way
 * that leaks its length through timing. Used to tell a rename from a rotation.
 */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function unb64(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
