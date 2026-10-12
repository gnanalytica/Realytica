/**
 * API keys: how another system reads a firm's projects.
 *
 * A key is made by one of the firm's admins and shown once. What is kept is
 * its first few characters, so a person can tell the rows apart, and an
 * HMAC-SHA256 of the whole key under a salt of its own: a copy of the stored
 * document opens nothing. A key reads and never writes, reads only what its
 * scopes name, on only the projects it lists when it lists any, until it
 * expires or is revoked.
 *
 * A key is accepted on `/api/v1` and nowhere else (`routes/integrations.ts`).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKeyScope } from '@realytica/shared';
import { changeIntegrations, markRevoked, readIntegrations, revokedMark, type ApiKeyRecord, type KeyUse } from './documents';

export const API_KEY_PREFIX = 'rlk_';
/** How many of a key's requests are kept, newest last. */
const USES_KEPT = 500;

export function hashApiKey(token: string, salt: string): string {
  return createHmac('sha256', Buffer.from(salt, 'hex')).update(token).digest('hex');
}

/** The part of a key that is kept in the open: `rlk_` and eight characters. */
function prefixOf(token: string): string {
  return token.slice(0, API_KEY_PREFIX.length + 8);
}

export interface NewApiKey {
  tenantId: string;
  name: string;
  scopes: ApiKeyScope[];
  projectIds?: string[];
  /** Days until it stops working. Absent: it does not expire. */
  expiresInDays?: number;
  createdBy: string;
}

/** Make a key. The token is in the answer and nowhere else, ever again. */
export async function createApiKey(input: NewApiKey, now = new Date()): Promise<{ token: string; key: ApiKeyRecord }> {
  const token = `${API_KEY_PREFIX}${randomBytes(4).toString('hex')}_${randomBytes(32).toString('base64url')}`;
  const salt = randomBytes(16).toString('hex');
  const key: ApiKeyRecord = {
    id: `key_${randomBytes(6).toString('hex')}`,
    tenantId: input.tenantId,
    name: input.name,
    prefix: prefixOf(token),
    salt,
    hash: hashApiKey(token, salt),
    scopes: [...new Set(input.scopes)],
    ...(input.projectIds?.length ? { projectIds: [...new Set(input.projectIds)] } : {}),
    createdAt: now.toISOString(),
    createdBy: input.createdBy,
    ...(input.expiresInDays ? { expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString() } : {}),
  };
  await changeIntegrations('keys', (held) => void held.keys.push(key));
  return { token, key };
}

/**
 * The live key a token is, among these records, or nothing.
 *
 * Found by the open prefix, then proved by the hash, compared in constant
 * time. A revoked key and an expired one are no key: whoever holds one is
 * told nothing more than whoever made one up.
 */
export function matchApiKey(keys: readonly ApiKeyRecord[], token: string, now = new Date()): ApiKeyRecord | undefined {
  if (!token.startsWith(API_KEY_PREFIX) || token.length > 200) return undefined;
  const prefix = prefixOf(token);
  let found: ApiKeyRecord | undefined;
  for (const key of keys) {
    if (key.prefix !== prefix) continue;
    const given = Buffer.from(hashApiKey(token, key.salt), 'hex');
    const held = Buffer.from(key.hash, 'hex');
    if (given.length === held.length && timingSafeEqual(given, held)) found = key;
  }
  if (!found || found.revokedAt) return undefined;
  if (found.expiresAt && Date.parse(found.expiresAt) <= now.getTime()) return undefined;
  return found;
}

/** The live key a token is, read from storage as it stands now: a key revoked a moment ago is refused. */
export async function apiKeyForToken(token: string, now = new Date()): Promise<ApiKeyRecord | undefined> {
  if (!token.startsWith(API_KEY_PREFIX)) return undefined;
  const key = matchApiKey((await readIntegrations('keys')).keys, token, now);
  // The keys document can be written back by an older copy; a revocation's own document cannot.
  return key && !(await revokedMark(key.id)) ? key : undefined;
}

/** The keys as they stand: one whose revocation the keys document has lost reads as revoked all the same. */
export async function keysAsTheyStand(keys: readonly ApiKeyRecord[]): Promise<ApiKeyRecord[]> {
  return Promise.all(
    keys.map(async (key) => {
      const mark = key.revokedAt ? undefined : await revokedMark(key.id);
      return mark ? { ...key, revokedAt: mark.at, revokedBy: mark.by } : key;
    }),
  );
}

export async function revokeApiKey(tenantId: string, id: string, by: string, now = new Date()): Promise<ApiKeyRecord | undefined> {
  const live = (await keysAsTheyStand((await readIntegrations('keys')).keys.filter((k) => k.tenantId === tenantId && k.id === id))).find((k) => !k.revokedAt);
  if (!live) return undefined;
  // First where no other write can undo it, then on the key's own row.
  await markRevoked(id, { at: now.toISOString(), by });
  return changeIntegrations('keys', (held) => {
    const key = held.keys.find((k) => k.tenantId === tenantId && k.id === id && !k.revokedAt);
    if (key) {
      key.revokedAt = now.toISOString();
      key.revokedBy = by;
    }
    return key;
  });
}

/** Whether a key reaches a project: the firm's, and on the key's list when it has one. */
export function keyReaches(key: ApiKeyRecord, project: { id: string; tenantId?: string }, bootstrapTenant: string | undefined): boolean {
  if ((project.tenantId ?? bootstrapTenant) !== key.tenantId) return false;
  return !key.projectIds || key.projectIds.includes(project.id);
}

/** Write down one request a key made. */
export async function recordKeyUse(use: KeyUse): Promise<void> {
  await changeIntegrations('uses', (held) => {
    held.uses = [...held.uses, use].slice(-USES_KEPT);
    held.lastUsedAt[use.keyId] = use.at;
  });
}

/** What is safe to send back about a key: never its salt or its hash. */
export function publicApiKey(key: ApiKeyRecord, lastUsedAt?: string) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    projectIds: key.projectIds ?? null,
    createdAt: key.createdAt,
    createdBy: key.createdBy,
    expiresAt: key.expiresAt ?? null,
    revokedAt: key.revokedAt ?? null,
    lastUsedAt: lastUsedAt ?? null,
  };
}
