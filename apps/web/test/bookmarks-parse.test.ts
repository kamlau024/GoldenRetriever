import { describe, it, expect } from "vitest";
import { parseBookmarksHtml, MAX_BOOKMARK_IMPORT } from "../lib/bookmarks.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://example.com/a" ADD_DATE="1">Alpha &amp; Beta</A>
    <DT><A HREF="https://example.com/a" ADD_DATE="2">Duplicate</A>
    <DT><A HREF="javascript:alert(1)">Bad Script</A>
    <DT><A HREF="mailto:x@y.com">Mail</A>
    <DT><H3 ADD_DATE="3">Work</H3>
    <DL><p>
        <DT><A HREF="https://work.example/doc">Work Doc</A>
        <DT><A HREF="https://work.example/empty"></A>
    </DL><p>
</DL><p>`;

describe("parseBookmarksHtml", () => {
  it("extracts http(s) entries with folder + title, de-duped, non-http dropped", () => {
    const out = parseBookmarksHtml(SAMPLE);
    expect(out).toHaveLength(3); // dup, javascript:, mailto: all excluded
    expect(out[0]).toEqual({ url: "https://example.com/a", title: "Alpha & Beta", folder: "Bookmarks" });
    expect(out[1]).toEqual({ url: "https://work.example/doc", title: "Work Doc", folder: "Work" });
    expect(out[2].url).toBe("https://work.example/empty");
    expect(out[2].title).toBe("https://work.example/empty"); // empty title falls back to url
    expect(out[2].folder).toBe("Work");
  });

  it("returns [] for content with no bookmarks and exposes the cap", () => {
    expect(parseBookmarksHtml("<html><body>nothing</body></html>")).toEqual([]);
    expect(MAX_BOOKMARK_IMPORT).toBe(50);
  });
});
