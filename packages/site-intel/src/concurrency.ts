/**
 * Bounded-concurrency map.
 *
 * The two report builders had opposite versions of the same bug. The DOCX path
 * downloaded site photos in a `for` loop — up to twelve sequential Storage round
 * trips on the one request a valuer pays ₹200 for. The PDF path used a bare
 * `Promise.all` over an UNCAPPED photo list, so a case with fifty photos opened
 * fifty concurrent downloads and fed fifty decoded bitmaps to sharp at once,
 * inside a function with a fixed memory ceiling.
 *
 * Sequential is slow and unbounded-parallel is a memory cliff; the answer to
 * both is a window. Order of results is preserved so captions still line up with
 * their photos.
 */
export const DEFAULT_CONCURRENCY = 6;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  // Each worker pulls the next index until the list is exhausted, so a slow
  // item delays only its own slot rather than a whole batch (which is what a
  // chunked `Promise.all` per slice would do).
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
