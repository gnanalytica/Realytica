import { createHash, randomUUID } from 'node:crypto';
import type { CredentialKind, CredentialRecord, StoredCredential } from '@realytica/shared';
import { store } from '../store';

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
 * The store is one JSON document, so a backup of it now carries credentials,
 * and on a deployment using blob storage they are in the blob. That is a real
 * change to this deployment's blast radius and it is written here rather than
 * left for somebody to discover: it was chosen deliberately over environment
 * variables so an operator can wire a connector without a deploy.
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

/** Never returned by a route. For the engine, at the moment of use. */
export function secretFor(tenantId: string, id: string): StoredCredential | undefined {
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
    secret: input.secret,
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
  const stored = secretFor(tenantId, id);
  if (!stored) return undefined;
  if (input.label !== undefined) stored.label = input.label.trim();
  if (input.target !== undefined) stored.target = input.target.trim() || undefined;
  if (input.username !== undefined) stored.username = input.username.trim() || undefined;
  if (input.secret) {
    stored.secret = input.secret;
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
  const stored = secretFor(tenantId, id);
  if (!stored) return;
  stored.lastUsedAt = new Date().toISOString();
  stored.lastResult = result;
  await store.save();
}
