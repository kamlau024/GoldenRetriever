import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z") },
  { id: "d2", title: null, sourceUrl: null, kind: "text", captureMode: "selection", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z") },
  { id: "d3", title: "report.pdf", sourceUrl: null, kind: "pdf", captureMode: "upload", status: "ready", capturedAt: new Date("2026-06-26T09:00:00Z") },
];

describe("LibraryList", () => {
  it("renders a table with status pills, source labels, and timestamps", () => {
    render(<LibraryList docs={docs} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    // Source column: capture mode → Text / URL / File
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("File")).toBeTruthy();
    // a formatted year is shown for the Added column
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no docs", () => {
    render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
  });
});
