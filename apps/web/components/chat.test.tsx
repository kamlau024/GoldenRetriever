import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "./chat.js";

describe("Transcript", () => {
  it("renders user and assistant turns with a citation chip", () => {
    render(<Transcript messages={[
      { id: "1", role: "user", content: "where to stay?" },
      { id: "2", role: "assistant", content: "Tawaraya [1].", citations: [{ title: "Kyoto", sourceUrl: "https://x" }] },
    ]} />);
    expect(screen.getByText("where to stay?")).toBeTruthy();
    expect(screen.getByText(/Tawaraya/)).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });
});
