import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Results } from "./search.js";

describe("Results", () => {
  it("renders result snippets with titles, and an empty state", () => {
    const { rerender } = render(<Results results={[]} searched={false} />);
    expect(screen.getByText(/search your library/i)).toBeTruthy();
    rerender(<Results searched results={[{ chunkId: "c1", documentId: "d1", content: "Tawaraya ryokan", title: "Kyoto", sourceUrl: "https://x" }]} />);
    expect(screen.getByText(/Tawaraya ryokan/)).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });
});
