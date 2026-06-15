import { describe, it, expect } from "vitest";
import { fetchUrlContent } from "./fetch-url.js";

// A fake fetch so the test makes no real network call.
const fakeFetch = (body: string, contentType: string): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { "content-type": contentType } })) as unknown as typeof fetch;

describe("fetchUrlContent", () => {
  it("returns html text for an html response", async () => {
    const r = await fetchUrlContent("https://ok.dev/a", fakeFetch("<html><body><p>Hi</p></body></html>", "text/html; charset=utf-8"));
    expect(r.kind).toBe("text");
    expect(r.mimeType).toContain("text/html");
    expect(r.text).toContain("Hi");
  });
  it("returns bytes for a binary response", async () => {
    const r = await fetchUrlContent("https://ok.dev/a.pdf", fakeFetch("%PDF-1.4", "application/pdf"));
    expect(r.kind).toBe("bytes");
    expect(r.bytes).toBeInstanceOf(Uint8Array);
  });
  it("rejects an unsafe url before fetching", async () => {
    await expect(fetchUrlContent("http://169.254.169.254/x", fakeFetch("x", "text/html"))).rejects.toThrow();
  });
});
