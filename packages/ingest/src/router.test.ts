import { describe, it, expect, vi } from "vitest";
import { convertToMarkdown } from "./router.js";
import { MockConverter } from "./converter.js";

const noopConv = new MockConverter();

describe("convertToMarkdown", () => {
  it("uses Readability for HTML and does not call the converter", async () => {
    const conv = new MockConverter();
    const spy = vi.spyOn(conv, "convert");
    const r = await convertToMarkdown(
      { mimeType: "text/html", text: "<html><head><title>T</title></head><body><article><p>Kyoto ryokan.</p></article></body></html>" },
      conv,
    );
    expect(r.markdown).toContain("Kyoto ryokan");
    expect(r.title).toBe("T");
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes plain text through unchanged", async () => {
    const r = await convertToMarkdown({ mimeType: "text/plain", text: "Just a note." }, noopConv);
    expect(r.markdown).toBe("Just a note.");
    expect(r.wordCount).toBe(3);
  });

  it("routes binary documents to the converter", async () => {
    const conv = new MockConverter("# PDF\n\nReport body.");
    const r = await convertToMarkdown(
      { mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]), filename: "report.pdf" },
      conv,
    );
    expect(r.markdown).toContain("Report body");
    expect(r.title).toBe("report.pdf");
  });

  it("treats unknown mime that looks like HTML as HTML", async () => {
    const r = await convertToMarkdown(
      { mimeType: null, text: "<html><body><p>Hello world here.</p></body></html>" },
      noopConv,
    );
    expect(r.markdown).toContain("Hello world");
  });
});
