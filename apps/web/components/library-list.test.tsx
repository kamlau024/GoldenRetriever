import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList, DocTable, DocCards } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z"), tags: ["travel", "kyoto"] },
  { id: "d2", title: null, sourceUrl: null, kind: "text", captureMode: "selection", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z"), tags: [] },
  { id: "d3", title: "report.pdf", sourceUrl: null, kind: "pdf", captureMode: "upload", status: "ready", capturedAt: new Date("2026-06-26T09:00:00Z"), tags: [] },
];

describe("DocTable (desktop)", () => {
  it("renders rows with status pills, source labels, timestamps, and tags", () => {
    render(<DocTable docs={docs} busy={null} onDelete={vi.fn()} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
    expect(screen.getByText("kyoto")).toBeTruthy();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });
});

describe("DocCards (mobile)", () => {
  it("renders a card per doc and confirms delete via onDelete", async () => {
    const onDelete = vi.fn();
    render(<DocCards docs={docs} busy={null} onDelete={onDelete} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
    // open the first card's delete dialog, then confirm inside it
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("d1");
  });
});

describe("LibraryList", () => {
  it("shows an empty state when there are no docs", () => {
    render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
  });
});
