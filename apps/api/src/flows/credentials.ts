import { createHash, randomUUID } from 'node:crypto';
import type { CredentialKind, CredentialRecord, StoredCredential } from '@realytica/shared';
import { store } from '../store';
import { envName } from '@realytica/agents';
import { isSealed, open, seal, sealingAvailable } from './secret-box';

/**
 * Secrets a flow node authenticates with.
 *
 * ## The property that matters
 *
 * **Write-only.** A secret goes in and never comes back out of an HTTP
 * response. `toRecord` is the only shape any route returns, and it is a
 * different type rather than a filtered object — a `Pick` would let a later
 * edit re-add the field by accident, whereas a type that has no `secret`
 * cannot leak one however the route is rewritten.
 *
 * ## What storing these costs
 *
 * The store is one JSON document, and on a deployment using blob storage it is
 * in the blob — so what lands in it is **sealed**, not the secret itself (see
 * `./secret-box.ts`). The key lives in the environment, which a backup does
 * not carry, so losing a copy of the store no longer means losing the keys.
 *
 * The limit of that claim, stated plainly: anything that can read this
 * process's environment can read the credentials, because the process has to
 * use them. What is bought is the separation of the data from the key.
 *
 * Storing them here at all was chosen over environment variables so an
 * operator can wire a connector without a deploy. That trade still holds; it
 * is now paid for.
 *
 * `hint` — the last four characters — exists so two keys are tellable apart
 * without either being shown.
 */

function credentials(): StoredCredential[] {
  if (!store.data.credentials) store.data.credentials = [];
  return store.data.credentials;
}

/** The public shape. Deliberately not a `Pick` of the stored one — see above. */
export function toRecord(stored: StoredCredential): CredentialRecord {
  return {
    id: stored.id,
    tenantId: stored.tenantId,
    label: stored.label,
    kind: stored.kind,
    hint: stored.hint,
    ...(stored.target ? { target: stored.target } : {}),
    createdAt: stored.createdAt,
    createdBy: stored.createdBy,
    ...(stored.lastUsedAt ? { lastUsedAt: stored.lastUsedAt } : {}),
    ...(stored.lastResult ? { lastResult: stored.lastResult } : {}),
  };
}

export function listCredentials(tenantId: string): CredentialRecord[] {
  return credentials()
    .filter((c) => c.tenantId === tenantId)
    .map(toRecord)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Never returned by a route. For the engine, at the moment of use.
 *
 * Hands back the *opened* secret, so nothing downstream can accidentally
 * authenticate with a ciphertext — a mistake that would present as a provider
 * rejecting a key that looks fine in the UI. The sealed form is reachable only
 * through `sealedFor`, which exists for re-sealing and nothing else.
 *
 * Throws `CredentialUnreadable` when the key cannot open it. That is the right
 * shape: a caller cannot do anything useful with a half-read credential, and
 * the alternative — returning undefined — is indistinguishable from "no such
 * credential", which would send an operator looking for a record that is
 * plainly on their screen.
 */
export function secretFor(tenantId: string, id: string): StoredCredential | undefined {
  const stored = sealedFor(tenantId, id);
  if (!stored) return undefined;
  return { ...stored, secret: open(stored.secret) };
}

/** The record as stored, secret still sealed. For re-sealing and for tests. */
export function sealedFor(tenantId: string, id: string): StoredCredential | undefined {
  return credentials().find((c) => c.tenantId === tenantId && c.id === id);
}

function hintOf(secret: string): string {
  const tail = secret.trim().slice(-4);
  return tail.length === 4 ? tail : '••••';
}

/** A stable, non-reversible id for a value, so an unchanged form is not a rotation. */
export function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

export async function saveCredential(input: {
  tenantId: string;
  createdBy: string;
  label: string;
  kind: CredentialKind;
  secret: string;
  username?: string;
  target?: string;
}): Promise<CredentialRecord> {
  const stored: StoredCredential = {
    id: `cred_${randomUUID()}`,
    tenantId: input.tenantId,
    label: input.label.trim(),
    kind: input.kind,
    hint: hintOf(input.secret),
    ...(input.target?.trim() ? { target: input.target.trim() } : {}),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    // Sealed before it is anywhere near `store.save()`. `seal` refuses when no
    // key is configured rather than falling back to plaintext, which is what
    // makes the guarantee checkable instead of aspirational.
    secret: seal(input.secret),
    ...(input.username?.trim() ? { username: input.username.trim() } : {}),
  };
  credentials().push(stored);
  await store.save();
  return toRecord(stored);
}

/**
 * Change a credential. An absent `secret` renames without rotating.
 *
 * That distinction is the whole reason this is not a replace: a screen that
 * shows a label and a masked value, and re-saves both, would rotate a working
 * key every time somebody fixed a typo in its name.
 */
export async function updateCredential(
  tenantId: string,
  id: string,
  input: { label?: string; target?: string; secret?: string; username?: string },
): Promise<CredentialRecord | undefined> {
  const stored = sealedFor(tenantId, id);
  if (!stored) return undefined;
  if (input.label !== undefined) stored.label = input.label.trim();
  if (input.target !== undefined) stored.target = input.target.trim() || undefined;
  if (input.username !== undefined) stored.username = input.username.trim() || undefined;
  if (input.secret) {
    stored.secret = seal(input.secret);
    stored.hint = hintOf(input.secret);
    // A rotated key has no history: last week's success says nothing about the
    // value that is in there now.
    delete stored.lastUsedAt;
    delete stored.lastResult;
  }
  await store.save();
  return toRecord(stored);
}

export async function deleteCredential(tenantId: string, id: string): Promise<boolean> {
  const before = credentials().length;
  store.data.credentials = credentials().filter((c) => !(c.tenantId === tenantId && c.id === id));
  if (store.data.credentials.length === before) return false;
  await store.save();
  return true;
}

/** Record what happened, so a screen can say "this stopped working on Tuesday". */
export async function noteCredentialUse(
  tenantId: string,
  id: string,
  result: NonNullable<CredentialRecord['lastResult']>,
): Promise<void> {
  // Deliberately the sealed record: noting that a key was used must not
  // depend on being able to read it, or a wrong-key deployment would lose the
  // very trail that explains what is wrong.
  const stored = sealedFor(tenantId, id);
  if (!stored) return;
  stored.lastUsedAt = new Date().toISOString();
  stored.lastResult = result;
  await store.save();
}

/* ==================================================================== */
/* Boot                                                                  */
/* ==================================================================== */

/**
 * Seal anything still lying in the store as plaintext, and say where this
 * deployment stands.
 *
 * ## Why this is not a startup failure when the key is absent
 *
 * Refusing to boot without `REALYTICA_CREDENTIAL_KEY` would take down every
 * deployment that has never opened the flow editor, over a feature it does not
 * use. The refusal belongs at the moment a secret would be written — which is
 * where `seal` puts it — so an operator meets it while they are looking at the
 * screen that caused it, with the command to generate a key in the message.
 *
 * What boot owes them is the truth about what is already on disk. A deployment
 * carrying plaintext credentials and no key gets told so, in the same voice
 * `[auth] OFF` uses, because that is a fact about their blast radius they
 * cannot discover any other way.
 *
 * ## Why re-sealing is a migration rather than lazy
 *
 * Sealing on next use would leave a credential nobody has run in six months as
 * plaintext forever — precisely the forgotten key that a leaked backup costs
 * the most. One pass at boot, once, and the document is clean.
 */
export async function initCredentialSealing(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sealed: number; plaintext: number; keyed: boolean }> {
  const all = credentials();
  const keyed = sealingAvailable(env);
  const legacy = all.filter((c) => !isSealed(c.secret));

  if (!keyed) {
    if (legacy.length > 0) {
      console.warn(
        `[credentials] ${legacy.length} credential(s) are stored as plaintext and ${envName('CREDENTIAL_KEY')} is not set. ` +
          'A backup of the store carries them. Generate a key with `openssl rand -base64 32`, set it, and restart — they will be sealed on the next boot.',
      );
    }
    if (all.length === 0) {
      console.log(`[credentials] none stored. Set ${envName('CREDENTIAL_KEY')} before saving one.`);
    }
    return { sealed: 0, plaintext: legacy.length, keyed: false };
  }

  if (legacy.length === 0) {
    console.log(`[credentials] ${all.length} stored, all sealed.`);
    return { sealed: 0, plaintext: 0, keyed: true };
  }

  for (const credential of legacy) credential.secret = seal(credential.secret, env);
  await store.save();
  console.log(`[credentials] sealed ${legacy.length} credential(s) that were stored as plaintext.`);
  return { sealed: legacy.length, plaintext: 0, keyed: true };
}
