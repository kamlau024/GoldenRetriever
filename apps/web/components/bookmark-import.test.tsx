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

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queued: 1, skipped: 0, failed: 0 }) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("BookmarkImport", () => {
  it("imports each selected bookmark individually and shows the finished count", async () => {
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    fireEvent.click(await screen.findByRole("button", { name: /Import 2/ }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2));
    for (const call of (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(JSON.parse(String((call[1] as RequestInit).body)).items).toHaveLength(1);
    }
    await waitFor(() => expect(screen.getByText(/Imported 2 pages/)).toBeTruthy());
  });

  it("shows per-bookmark done and failed statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const item = JSON.parse(String(init.body)).items[0];
      const failed = item.url.includes("b.example");
      return { ok: true, json: async () => ({ queued: failed ? 0 : 1, skipped: 0, failed: failed ? 1 : 0 }) } as Response;
    }));
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    fireEvent.click(await screen.findByRole("button", { name: /Import 2/ }));
    expect(await screen.findByRole("img", { name: "done" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "failed" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Imported 1 page/)).toBeTruthy());
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
