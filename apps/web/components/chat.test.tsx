import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript, safeHref } from "./chat.js";
import { vi, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { Chat } from "./chat.js";

function streamRes(text: string, headers: Record<string, string>) {
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
  return { ok: true, status: 200, headers: new Headers(headers), body } as unknown as Response;
}

describe("Transcript", () => {
  it("renders user and assistant turns with a citation chip", () => {
    render(<Transcript messages={[
      { id: "1", role: "user", content: "where to stay?" },
      { id: "2", role: "assistant", content: "Tawaraya [1].", citations: [{ title: "Kyoto", sourceUrl: "https://x" }] },
    ]} />);
    expect(screen.getByText("where to stay?")).toBeTruthy();
    expect(screen.getByText(/Tawaraya/)).toBeTruthy();
    const link = screen.getByText("Kyoto") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://x");
  });

  it("renders assistant replies as markdown (bold)", () => {
    render(<Transcript messages={[
      { id: "1", role: "assistant", content: "This is **important**." },
    ]} />);
    expect(screen.getByText("important").tagName).toBe("STRONG");
  });

  it("renders a non-link chip (no anchor) for a javascript: or absent source URL", () => {
    render(<Transcript messages={[
      { id: "1", role: "assistant", content: "evil", citations: [{ title: "x", sourceUrl: "javascript:alert(1)" }] },
      { id: "2", role: "assistant", content: "note", citations: [{ title: "plain", sourceUrl: null }] },
    ]} />);
    // No clickable anchor is produced for unsafe/absent URLs (XSS guard + no dead link).
    expect(screen.getByText("x").closest("a")).toBeNull();
    expect(screen.getByText("plain").closest("a")).toBeNull();
  });
});

describe("safeHref", () => {
  it("allows http(s) and rejects other schemes", () => {
    expect(safeHref("https://ok.dev")).toBe("https://ok.dev");
    expect(safeHref("http://ok.dev")).toBe("http://ok.dev");
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("data:text/html,<script>")).toBe("#");
    expect(safeHref(null)).toBe("#");
  });
});

describe("Chat conversation id", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures x-conversation-id and sends it on the next message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamRes("hi", { "x-conversation-id": "conv_1", "x-citations": "" }))
      .mockResolvedValueOnce(streamRes("ok", { "x-conversation-id": "conv_1", "x-citations": "" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat kbId="kb_1" />);
    const input = screen.getByPlaceholderText("Ask your library…");

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ kbId: "kb_1", message: "first" });
    await screen.findByText("hi");

    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ kbId: "kb_1", conversationId: "conv_1", message: "second" });
  });
});
