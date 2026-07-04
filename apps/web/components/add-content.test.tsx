import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { AddContent } from "./add-content.js";

beforeEach(() => { vi.restoreAllMocks(); refresh.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("AddContent", () => {
  it("shows the three tabs", () => {
    render(<AddContent kbId="kb1" />);
    expect(screen.getByRole("tab", { name: /text/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /url/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /file/i })).toBeTruthy();
  });

  it("saves pasted text and refreshes with a success toast", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<AddContent kbId="kb1" />);
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: "Hello Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: /save text/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ingest", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
  });

  it("uploads a dropped file via the File tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<AddContent kbId="kb1" />);
    fireEvent.click(screen.getByRole("tab", { name: /file/i }));
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Upload files"), { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" })));
  });
});
