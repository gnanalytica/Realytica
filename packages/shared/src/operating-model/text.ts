/**
 * Small text helpers shared by everything that writes a sentence for a person.
 */

/**
 * "1 file", "3 files".
 *
 * The product counts things constantly — cards, findings, files, proposals —
 * and "1 finding(s)" is the shape of a form letter, not of something written
 * for the reader in front of it. Irregular plurals take the second argument.
 */
export function plural(n: number, noun: string, plural?: string): string {
  return `${n} ${n === 1 ? noun : (plural ?? `${noun}s`)}`;
}
