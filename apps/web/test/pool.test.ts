import { describe, it, expect } from "vitest";
import { runPool } from "../lib/pool.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runPool", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit but does run concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("resolves immediately for an empty list and never calls the worker", async () => {
    await expect(runPool([], 4, async () => { throw new Error("should not run"); })).resolves.toBeUndefined();
  });
});
