import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BookmarkImport } from "./bookmark-import.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
<DT><A HREF="https://a.example/1">Alpha</A>
<DT><H3>Work</H3><DL><p>
<DT><A HREF="https://b.example/2">Beta</A>
</DL><p></DL><p>`;

const uploadFile = (html: string) => {
  const input = screen.getByLabelText("Bookmarks file") as HTMLInputElement;
  const file = new File([html], "bookmarks.html", { type: "text/html" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queued: 2, skipped: 0 }) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("BookmarkImport", () => {
  it("previews parsed bookmarks and imports the selection", async () => {
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    expect(await screen.findByText(/Found 2 bookmarks/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Import 2/ }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/import/bookmarks",
      expect.objectContaining({ method: "POST" }),
    ));
    const body = JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(body.kbId).toBe("kb1");
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { url: string }) => i.url)).toContain("https://a.example/1");
  });

  it("disables import when more than the cap is selected", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `<DT><A HREF="https://x.example/${i}">L${i}</A>`).join("\n");
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(`<DL><p>${many}</DL><p>`);
    expect(await screen.findByText(/Found 51 bookmarks/)).toBeTruthy();
    expect(screen.getByText(/Select up to 50/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import/ })).toHaveProperty("disabled", true);
  });
});
