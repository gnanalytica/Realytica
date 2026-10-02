import * as Crypto from 'expo-crypto';

/**
 * A random v4 UUID. Used as the site entry's `clientId`: the server files an
 * entry once per clientId, so the outbox can resend after a dropped
 * connection without ever filing the same day twice.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
