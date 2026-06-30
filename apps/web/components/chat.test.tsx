import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript, safeHref } from "./chat.js";

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
