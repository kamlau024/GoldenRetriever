import { describe, it, expect } from "vitest";
import { extractContent } from "./extract.js";

const html = `<!doctype html><html><head><title>Kyoto Ryokans</title></head>
<body><nav>menu junk</nav><article><h1>Best Ryokans</h1>
<p>Tawaraya is a historic ryokan in central Kyoto.</p>
<p>Hiiragiya is another classic choice.</p></article>
<footer>copyright junk</footer></body></html>`;

describe("extractContent", () => {
  it("pulls the main article as markdown and a title", () => {
    const r = extractContent(html, "https://example.com/kyoto");
    expect(r.title).toBe("Kyoto Ryokans");
    expect(r.markdown).toContain("Tawaraya");
    expect(r.markdown).toContain("Hiiragiya");
    expect(r.markdown).not.toContain("menu junk");
    expect(r.wordCount).toBeGreaterThan(5);
  });

  it("falls back to body text when Readability finds no article", () => {
    const r = extractContent("<html><body>Just a sentence here.</body></html>", null);
    expect(r.markdown).toContain("Just a sentence");
  });
});
