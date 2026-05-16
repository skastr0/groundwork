import { MATCHER_CONCURRENCY } from "./constants.ts";

export async function runBoundedEffect<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  concurrency = MATCHER_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        try {
          results[currentIndex] = await run(items[currentIndex]!);
        } catch (error) {
          throw toError(error);
        }
      }
    }),
  );

  return results;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
