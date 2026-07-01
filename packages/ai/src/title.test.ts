import { describe, it, expect } from "vitest";
import { cleanTitle } from "./title.js";

describe("cleanTitle", () => {
  it("strips wrapping quotes and trailing punctuation", () => {
    expect(cleanTitle('"Kyoto lodging."')).toBe("Kyoto lodging");
    expect(cleanTitle("“Best ryokan options”")).toBe("Best ryokan options");
  });
  it("collapses whitespace and newlines into one line", () => {
    expect(cleanTitle("Kyoto\n  trip   plan")).toBe("Kyoto trip plan");
  });
  it("caps length at 60 characters", () => {
    expect(cleanTitle("x".repeat(100)).length).toBe(60);
  });
});
