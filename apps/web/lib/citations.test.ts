import { describe, it, expect } from "vitest";
import { citedOnly, encodeCitations, parseCitations } from "./citations.js";

describe("citedOnly", () => {
  const cites = ["a", "b", "c"];
  it("keeps only the [n] sources referenced in the answer", () => {
    expect(citedOnly("Kyoto has ryokan [1] and gardens [3].", cites)).toEqual(["a", "c"]);
  });
  it("dedupes repeated references", () => {
    expect(citedOnly("[2] then again [2].", cites)).toEqual(["b"]);
  });
  it("falls back to all when the answer cites nothing", () => {
    expect(citedOnly("No citations here.", cites)).toEqual(cites);
  });
  it("ignores out-of-range indices", () => {
    expect(citedOnly("[1] and [9]", cites)).toEqual(["a"]);
  });
});

describe("encode/parse round-trip", () => {
  it("survives a round-trip", () => {
    const c = [{ chunkId: "x", documentId: "d", title: "T", sourceUrl: null }];
    expect(parseCitations(encodeCitations(c))).toEqual(c);
  });
});
