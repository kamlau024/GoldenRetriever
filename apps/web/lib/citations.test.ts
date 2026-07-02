import { describe, it, expect } from "vitest";
import { encodeCitations, parseCitations, snippet } from "./citations.js";

describe("encode/parse round-trip", () => {
  it("survives a round-trip", () => {
    const c = [{ chunkId: "x", documentId: "d", title: "T", sourceUrl: null, kind: "text", content: "a chunk" }];
    expect(parseCitations(encodeCitations(c))).toEqual(c);
  });
});

describe("snippet", () => {
  it("trims and passes through short text", () => {
    expect(snippet("  hello  ")).toBe("hello");
  });
  it("caps long text with an ellipsis", () => {
    const out = snippet("x".repeat(600), 500);
    expect(out.length).toBe(501); // 500 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });
});
