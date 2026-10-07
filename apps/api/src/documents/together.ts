/**
 * Reading several papers at once.
 *
 * Papers dropped together used to be read one after another: the ninth
 * waited for eight OCR runs and eight model calls before its first page was
 * opened. A model call is waiting, and OCR runs on its own threads, so a few
 * papers can be under way together.
 */

/**
 * How many papers are read at once, however many were dropped.
 *
 * Three, since each holds its bytes and its pages in memory while it is read,
 * a model's rate limits are met sooner with more, and OCR has only so many
 * processors to use (`ocrPagesAtOnce`).
 */
export const PAPERS_AT_ONCE = 3;

/**
 * Does `work` for each item, at most `limit` at a time, starting them in the
 * order given. Each settles by itself: one that fails does not stop the rest,
 * and its place in the answer says that it failed.
 */
export async function together<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const settled: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        settled[index] = { status: 'fulfilled', value: await work(items[index]!, index) };
      } catch (reason) {
        settled[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return settled;
}
