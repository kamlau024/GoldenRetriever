import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiTokens } from "./api-tokens.js";

afterEach(() => vi.restoreAllMocks());

describe("ApiTokens", () => {
  it("creates a token and reveals the secret once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [] }) })                                  // mount load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "t1", name: "iPhone", token: "grt_SECRET" }) }) // POST create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ id: "t1", name: "iPhone", createdAt: "2026-06-27T00:00:00.000Z", lastUsedAt: null, revoked: false }] }) }); // reload
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiTokens baseUrl="https://app.example" />);
    fireEvent.change(screen.getByPlaceholderText(/token name/i), { target: { value: "iPhone" } });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(screen.getByText("grt_SECRET")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("iPhone")).toBeTruthy());
    // base URL is shown for the iOS Shortcut setup
    expect(screen.getByText(/https:\/\/app\.example/)).toBeTruthy();
  });
});
