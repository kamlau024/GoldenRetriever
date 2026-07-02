import { describe, it, expect } from "vitest";
import { encodeCitations, parseCitations, type Citation } from "../lib/citations.js";

describe("citations header codec", () => {
  it("round-trips citations including non-ASCII titles", () => {
    const cites: Citation[] = [{ chunkId: "c1", documentId: "d1", title: "京都 ryokan", sourceUrl: "https://x", kind: "web", content: "a chunk" }];
    const header = encodeCitations(cites);
    expect(header).toMatch(/^[\x00-\x7F]*$/); // header value is ASCII-safe
    expect(parseCitations(header)).toEqual(cites);
  });
  it("parse returns [] for empty/garbage", () => {
    expect(parseCitations(null)).toEqual([]);
    expect(parseCitations("%%%")).toEqual([]);
  });
});
