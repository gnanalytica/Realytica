const warned = new Set<string>();

/**
 * One warning per distinct cause per process. The proof-pathways fan-out
 * prices once per gap, so an unpriced model would otherwise emit a warning
 * per concurrent call and bury itself in its own noise.
 *
 * Its own module so configuration can use it: `config.ts` has to warn about a
 * malformed route and is imported by `client.ts`, where this used to live.
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[realytica/agents] ${message}`);
}
