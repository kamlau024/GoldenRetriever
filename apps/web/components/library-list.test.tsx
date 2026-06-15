import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryList } from "./library-list.js";

describe("LibraryList", () => {
  it("renders titles and a status badge, with an empty state", () => {
    const { rerender } = render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
    rerender(<LibraryList docs={[{ id: "d1", title: "Kyoto ryokans", sourceUrl: null, kind: "text", status: "ready", capturedAt: new Date() }]} />);
    expect(screen.getByText("Kyoto ryokans")).toBeTruthy();
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });
});
