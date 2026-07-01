import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { MemorySettings } from "./memory-settings.js";

const initial = [
  { id: "m1", content: "is a product manager", createdAt: new Date().toISOString() },
  { id: "m2", content: "likes Kyoto", createdAt: new Date().toISOString() },
];

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("MemorySettings", () => {
  it("lists facts and toggles memory via /api/settings", async () => {
    render(<MemorySettings enabled={true} initialMemories={initial} />);
    expect(screen.getByText("is a product manager")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /disable memory/i }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/settings", expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("deletes a fact via its row control", async () => {
    render(<MemorySettings enabled={true} initialMemories={initial} />);
    fireEvent.click(screen.getAllByLabelText("Delete memory")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/memories/m1", expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.queryByText("is a product manager")).toBeNull());
  });
});
