import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeCitation } from "./citation.js";

const cites = [{ title: "Kyoto", sourceUrl: "https://x", kind: "web", content: "Tawaraya is a ryokan." }];
const Cite = makeCitation(cites);

describe("Citation", () => {
  it("renders a source icon and opens a popover with the title + chunk", async () => {
    render(<Cite node={{ properties: { "data-cite": "1" } }} />);
    fireEvent.click(screen.getByRole("button", { name: /Source: Kyoto/ }));
    expect(await screen.findByText("Kyoto")).toBeTruthy();
    expect(screen.getByText("Tawaraya is a ryokan.")).toBeTruthy();
  });
  it("renders [n] text for an out-of-range citation", () => {
    render(<Cite node={{ properties: { "data-cite": "9" } }} />);
    expect(screen.getByText("[9]")).toBeTruthy();
  });
  it("renders the chunk snippet as markdown", async () => {
    const Md = makeCitation([{ title: "Doc", sourceUrl: null, kind: "text", content: "**bold** then\n\n- item one\n- item two" }]);
    render(<Md node={{ properties: { "data-cite": "1" } }} />);
    fireEvent.click(screen.getByRole("button", { name: /Source: Doc/ }));
    const strong = await screen.findByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.getByText("item one").tagName).toBe("LI");
  });
});
