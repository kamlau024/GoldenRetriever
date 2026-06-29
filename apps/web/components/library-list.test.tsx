import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z") },
  { id: "d2", title: null, sourceUrl: null, kind: "text", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z") },
];

describe("LibraryList", () => {
  it("renders a table with status pills and timestamps", () => {
    render(<LibraryList docs={docs} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getByText("READY")).toBeTruthy();
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    // a formatted year is shown for the Added column
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no docs", () => {
    render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
  });
});
