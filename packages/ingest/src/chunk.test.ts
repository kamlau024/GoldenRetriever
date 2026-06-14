import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short note.", { maxTokens: 100, overlapTokens: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[0].content).toBe("A short note.");
  });

  it("splits long text into ordered chunks with overlap", () => {
    const para = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(para, { maxTokens: 20, overlapTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    // overlap invariant: a non-empty suffix of chunk0 is the prefix of chunk1
    const w0 = chunks[0].content.split(" ");
    const w1 = chunks[1].content.split(" ");
    const idx = w0.indexOf(w1[0]);
    expect(idx).toBeGreaterThan(0); // overlap region begins inside chunk0, not at its start
    expect(w1.slice(0, w0.length - idx)).toEqual(w0.slice(idx));
  });

  it("estimates token counts (~0.75 words/token heuristic)", () => {
    const chunks = chunkText("one two three four", { maxTokens: 100, overlapTokens: 0 });
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });
});
