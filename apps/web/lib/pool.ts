/** Run `worker` over `items` with at most `limit` concurrent workers; resolves when all complete. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runNext = async (): Promise<void> => {
    const i = index++;
    if (i >= items.length) return;
    await worker(items[i]);
    await runNext();
  };
  const workers = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workers }, () => runNext()));
}
