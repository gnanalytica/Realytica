/**
 * Which server a phone pairs with.
 *
 * Production by default. `EXPO_PUBLIC_REALYTICA_SERVER` (inlined at build
 * time) changes the suggestion; the pairing screen can still override it, and
 * the QR code the web app shows carries its own server address.
 */

export const PRODUCTION_SERVER = 'https://realytica.gnanalytica.com';
export const LOCAL_DEV_SERVER = 'http://localhost:5174';

export const DEFAULT_SERVER = normaliseServer(process.env.EXPO_PUBLIC_REALYTICA_SERVER ?? '') ?? PRODUCTION_SERVER;

/**
 * Turn what someone typed into a server origin, or null if it cannot be one.
 * "localhost:5174" → "http://localhost:5174"; "realytica.example.com/" →
 * "https://realytica.example.com". Local addresses default to http because a
 * dev API has no certificate; everything else defaults to https.
 */
export function normaliseServer(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // An origin only: the app adds /api itself.
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Codes use A–Z without I and O, and 2–9, so nothing reads as a one or a zero. */
export const PAIR_CODE_LENGTH = 8;
const PAIR_CODE_ALPHABET = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;

/** What the person typed, upper-cased with spaces and dashes taken out — as the server reads it. */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Characters that can never be in a code: usually a misread O, I, 0 or 1. */
export function strayCodeCharacters(code: string): string[] {
  return [...new Set(code.split('').filter((c) => !PAIR_CODE_ALPHABET.test(c)))];
}
