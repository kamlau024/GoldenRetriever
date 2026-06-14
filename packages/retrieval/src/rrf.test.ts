import { describe, it, expect } from "vitest";
import { fuseRrf } from "./rrf.js";

describe("fuseRrf", () => {
  it("ranks an item appearing high in both lists first", () => {
    const dense = ["a", "b", "c"];
    const sparse = ["b", "a", "d"];
    const fused = fuseRrf([dense, sparse], { k: 60 });
    expect(fused[0]).toBe("a"); // top in dense, 2nd in sparse → best combined
  });

  it("includes items present in only one list", () => {
    const fused = fuseRrf([["x"], ["y"]], { k: 60 });
    expect(new Set(fused)).toEqual(new Set(["x", "y"]));
  });

  it("returns empty for empty input", () => {
    expect(fuseRrf([], { k: 60 })).toEqual([]);
  });
});
