import { describe, it, expect } from "vitest";
import { rehypeCitations } from "./rehype-citations.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tree: any) => { rehypeCitations()(tree); return tree; };

describe("rehypeCitations", () => {
  it("splits [n] text into cite elements with data-cite", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "Stay at Tawaraya [1] or [2]." }] }] };
    const p = run(tree).children[0];
    expect(p.children.map((c: { tagName?: string; type: string }) => c.tagName ?? c.type)).toEqual(["text", "cite", "text", "cite", "text"]);
    expect(p.children[1].properties["data-cite"]).toBe("1");
    expect(p.children[3].properties["data-cite"]).toBe("2");
  });
  it("leaves text without markers untouched and recurses into nested elements", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [
      { type: "element", tagName: "strong", children: [{ type: "text", value: "bold [1]" }] },
    ] }] };
    const strong = run(tree).children[0].children[0];
    expect(strong.children.map((c: { tagName?: string; type: string }) => c.tagName ?? c.type)).toEqual(["text", "cite"]);
  });
  it("does not rewrite [n] inside code or pre elements", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [
      { type: "element", tagName: "code", children: [{ type: "text", value: "call [1]" }] },
    ] }] };
    const code = run(tree).children[0].children[0];
    expect(code.children).toEqual([{ type: "text", value: "call [1]" }]);
  });
});
