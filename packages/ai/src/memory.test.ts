import { describe, it, expect } from "vitest";
import { parseMemories } from "./memory.js";

describe("parseMemories", () => {
  it("splits lines, strips bullets/numbering, caps at 3", () => {
    expect(parseMemories("- PM at a fintech\n2. likes Kyoto\n* drinks tea\nfourth")).toEqual([
      "PM at a fintech", "likes Kyoto", "drinks tea",
    ]);
  });
  it("treats NONE (any case) and blanks as no facts", () => {
    expect(parseMemories("NONE")).toEqual([]);
    expect(parseMemories("none\n\n  ")).toEqual([]);
  });
  it("preserves facts that start with a digit but strips real list markers", () => {
    expect(parseMemories("3D printing enthusiast")).toEqual(["3D printing enthusiast"]);
    expect(parseMemories("1099 income")).toEqual(["1099 income"]);
    expect(parseMemories("1. likes Kyoto\n2) drinks tea\n- PM at a fintech")).toEqual(["likes Kyoto", "drinks tea", "PM at a fintech"]);
  });
});
