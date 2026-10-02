/**
 * Reading what a pairing QR code says, and handing it from the scanner back
 * to the pairing screen.
 *
 * The web app's People › Pair a phone shows a QR code containing
 *   {"server":"https://…","code":"ABCD2345"}
 * The reader is lenient on purpose: it also takes a bare code, or a
 * realytica://pair?server=…&code=… link, so a code shown some other way still
 * works.
 */
import { normaliseCode, normaliseServer, PAIR_CODE_LENGTH } from './config';

export interface PairLink {
  server?: string;
  code: string;
}

export function readPairLink(raw: string): PairLink | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text) as { server?: unknown; code?: unknown };
      if (typeof data.code !== 'string') return null;
      const code = normaliseCode(data.code);
      if (code.length !== PAIR_CODE_LENGTH) return null;
      const server = typeof data.server === 'string' ? normaliseServer(data.server) : null;
      return { code, ...(server ? { server } : {}) };
    } catch {
      return null;
    }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const codeParam = url.searchParams.get('code');
      if (!codeParam) return null;
      const code = normaliseCode(codeParam);
      if (code.length !== PAIR_CODE_LENGTH) return null;
      const serverParam = url.searchParams.get('server');
      const server = serverParam ? normaliseServer(serverParam) : null;
      return { code, ...(server ? { server } : {}) };
    } catch {
      return null;
    }
  }

  const code = normaliseCode(text);
  return code.length === PAIR_CODE_LENGTH ? { code } : null;
}

/* The scanner is its own screen; this is how its answer reaches the pairing screen. */
let pending: PairLink | null = null;

export function setScanned(link: PairLink): void {
  pending = link;
}

export function takeScanned(): PairLink | null {
  const link = pending;
  pending = null;
  return link;
}
