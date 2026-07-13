import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList, DocCards } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z"), tags: ["travel", "kyoto"] },
  { id: "d2", title: null, sourceUrl: null, kind: "text", captureMode: "selection", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z"), tags: [] },
  { id: "d3", title: "report.pdf", sourceUrl: null, kind: "pdf", captureMode: "upload", status: "ready", capturedAt: new Date("2026-06-26T09:00:00Z"), tags: [] },
];

describe("DocCards", () => {
  it("renders a card per doc and confirms delete via onDelete", async () => {
    const onDelete = vi.fn();
    render(<DocCards docs={docs} busy={null} onDelete={onDelete} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
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

  it("renders cards (no desktop table)", () => {
    render(<LibraryList docs={docs} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("LibraryList tag filtering", () => {
  const tagged = [
    { id: "d1", title: "Kyoto guide", sourceUrl: null, kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date(), tags: ["travel", "kyoto"] },
    { id: "d4", title: "Osaka food", sourceUrl: null, kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date(), tags: ["travel"] },
    { id: "d2", title: "Untagged note", sourceUrl: null, kind: "text", captureMode: "selection", status: "ready", capturedAt: new Date(), tags: [] },
  ];

  it("filters by a clicked tag, hides untagged docs, and shows Clear + a pill", () => {
    render(<LibraryList docs={tagged} />);
    expect(screen.getByText("Untagged note")).toBeTruthy();
    // before clicking, the kyoto tag button is not pressed
    expect(screen.getByRole("button", { name: "kyoto" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByText("Osaka food")).toBeNull();     // lacks 'kyoto'
    expect(screen.queryByText("Untagged note")).toBeNull();  // untagged hidden
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove kyoto" })).toBeTruthy();
    // after filtering, the sole remaining kyoto tag button reflects the pressed state
    expect(screen.getByRole("button", { name: "kyoto" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ANDs multiple selected tags", () => {
    render(<LibraryList docs={tagged} />);
    fireEvent.click(screen.getAllByRole("button", { name: "travel" })[0]);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getByText("Osaka food")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByText("Osaka food")).toBeNull();     // lacks 'kyoto'
  });

  it("removes a tag via its × and Clear resets the filter", () => {
    render(<LibraryList docs={tagged} />);
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove kyoto" }));
    expect(screen.getByText("Untagged note")).toBeTruthy(); // filter cleared
  });
});
