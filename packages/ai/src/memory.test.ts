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
});
