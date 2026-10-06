/**
 * How much one message may carry, and what follows from it. No page is
 * needed for any of it, so it can be checked where there is none.
 *
 * The deployed site takes about four megabytes in one request, whatever is
 * in it. A phone's photograph alone is larger, and five of them sent together
 * share the same four.
 */

/** A photograph past this is made smaller before it is sent, however much room there is. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** What one message may carry here: one file, and all its files together. */
export interface SendLimits {
  maxFileBytes: number;
  maxRequestBytes: number;
}

/** Said to the person before anything is sent, when the files will not go in one message. The files stay where they are. */
export class TooLargeToSend extends Error {}

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Refuses, in words, files that will not go in one message together. Files
 * past `largeFrom` take the large-file road by themselves and are not
 * counted.
 */
export function mustFitOneMessage(files: ReadonlyArray<{ size: number }>, limits: SendLimits | undefined, largeFrom: number): void {
  if (!limits) return;
  const together = files.filter((f) => f.size < largeFrom).reduce((sum, f) => sum + f.size, 0);
  if (together <= limits.maxRequestBytes * 0.95) return;
  throw new TooLargeToSend(`These files are ${megabytes(together)} together, and one message takes ${megabytes(limits.maxRequestBytes)} here. Send them in smaller groups.`);
}

/**
 * How large each photograph may be for all of them to go in one message with
 * whatever else is being sent: an even share of the room, never more than a
 * photograph is worth sending at, and never so little that it shows nothing.
 */
export function pictureShare(limits: SendLimits, pictures: number, otherBytes: number): number {
  if (!pictures) return 0;
  const room = Math.max(0, limits.maxRequestBytes * 0.9 - otherBytes);
  return Math.max(120 * 1024, Math.min(SHRINK_ABOVE_BYTES, limits.maxFileBytes * 0.8, room / pictures));
}
