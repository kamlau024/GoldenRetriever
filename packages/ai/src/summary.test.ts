import { describe, it, expect } from "vitest";
import { cleanSummary } from "./summary.js";

describe("cleanSummary", () => {
  it("collapses whitespace to a single line", () => {
    expect(cleanSummary("about\n  Kyoto   trips")).toBe("about Kyoto trips");
  });
  it("caps length at 300 chars", () => {
    expect(cleanSummary("x".repeat(400)).length).toBe(300);
  });
});
