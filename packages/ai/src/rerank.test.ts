import { describe, it, expect } from "vitest";
import { rankFromList } from "./rerank.js";

describe("rankFromList", () => {
  it("orders by the model's 1-based reply, most-relevant first", () => {
    expect(rankFromList("3, 1", 4).slice(0, 2).map((h) => h.index)).toEqual([2, 0]);
  });
  it("appends omitted passages after the ranked ones with lower score", () => {
    const r = rankFromList("2", 3);
    expect(r[0].index).toBe(1);
    expect([...r.map((h) => h.index)].sort()).toEqual([0, 1, 2]);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
  it("ignores out-of-range and duplicate numbers", () => {
    expect(rankFromList("9, 1, 1, 0", 2).map((h) => h.index)).toEqual([0, 1]);
  });
  it("falls back to original order when the reply has no numbers", () => {
    expect(rankFromList("none relevant", 3).map((h) => h.index)).toEqual([0, 1, 2]);
  });
});
