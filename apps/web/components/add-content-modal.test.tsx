import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AddContentModal } from "./add-content-modal.js";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("AddContentModal", () => {
  it("opens the Add dialog from the floating button and closes via the X", async () => {
    render(<AddContentModal kbId="kb1" />);
    expect(screen.queryByRole("tab", { name: /text/i })).toBeNull(); // closed initially
    fireEvent.click(screen.getByRole("button", { name: "Add to your library" }));
    expect(await screen.findByRole("tab", { name: /text/i })).toBeTruthy(); // opened
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /text/i })).toBeNull()); // closed
  });
});
