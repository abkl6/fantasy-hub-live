/**
 * Runs `work` over `items` with at most `limit` running at once, keeping the
 * results in input order. Cross-league screens use it so leagues are built
 * side by side without flooding the database with every league at once.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]!, index);
    }
  });
  await Promise.all(lanes);
  return out;
}
