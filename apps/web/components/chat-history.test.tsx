import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ChatHistory } from "./chat-history.js";

const conversations = [
  { id: "c1", title: "Kyoto trip", lastActivityAt: new Date().toISOString(), messageCount: 4 },
  { id: "c2", title: null, lastActivityAt: new Date().toISOString(), messageCount: 1 },
];

function makeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/conversations") return { ok: true, json: async () => ({ conversations }) } as Response;
    if (init?.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) } as Response;
    if (init?.method === "PATCH") return { ok: true, json: async () => ({ ok: true, title: JSON.parse(String(init.body)).title }) } as Response;
    return { ok: false } as Response;
  });
}

beforeEach(() => vi.stubGlobal("fetch", makeFetch()));
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

describe("ChatHistory", () => {
  it("lists conversations (with an Untitled fallback) when opened", async () => {
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={noop} onDeletedActive={noop} />);
    expect(await screen.findByText("Kyoto trip")).toBeTruthy();
    expect(screen.getByText("Untitled chat")).toBeTruthy();
  });

  it("calls onSelect when a conversation row is clicked", async () => {
    const onSelect = vi.fn();
    render(<ChatHistory open activeId={null} onSelect={onSelect} onNew={noop} onDeletedActive={noop} />);
    fireEvent.click(await screen.findByText("Kyoto trip"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("calls onNew for the New chat button", async () => {
    const onNew = vi.fn();
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={onNew} onDeletedActive={noop} />);
    fireEvent.click(await screen.findByText("New chat"));
    expect(onNew).toHaveBeenCalled();
  });

  it("deletes a conversation after confirming and reports when the active one is removed", async () => {
    const onDeletedActive = vi.fn();
    render(<ChatHistory open activeId="c1" onSelect={noop} onNew={noop} onDeletedActive={onDeletedActive} />);
    await screen.findByText("Kyoto trip");
    fireEvent.click(screen.getAllByLabelText("Conversation actions")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Kyoto trip")).toBeNull());
    expect(onDeletedActive).toHaveBeenCalled();
  });

  it("renames a conversation via the kebab menu", async () => {
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={noop} onDeletedActive={noop} />);
    await screen.findByText("Kyoto trip");
    fireEvent.click(screen.getAllByLabelText("Conversation actions")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Conversation name");
    fireEvent.change(input, { target: { value: "Kyoto 2026" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Kyoto 2026")).toBeTruthy());
    const patchCalls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
  });

  it("Escape cancels the rename (no PATCH)", async () => {
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={noop} onDeletedActive={noop} />);
    await screen.findByText("Kyoto trip");
    fireEvent.click(screen.getAllByLabelText("Conversation actions")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByLabelText("Conversation name");
    fireEvent.change(input, { target: { value: "Should not be saved" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Conversation name")).toBeNull();
    expect(screen.getByText("Kyoto trip")).toBeTruthy();
    const patchCalls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(0);
  });
});
