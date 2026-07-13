import { describe, it, expect } from "vitest";
import { classifyImportError, REASON_LABEL } from "../lib/import-reason.js";

describe("classifyImportError", () => {
  const cases: [string, string][] = [
    ["dns lookup failed: old.example", "unreachable"],
    ["blocked private ip: 10.0.0.1", "private-address"],
    ["blocked host (private/loopback): localhost", "private-address"],
    ["unsupported url scheme: ftp:", "unsupported-url"],
    ["fetch failed 403 for https://x", "blocked"],
    ["fetch failed 401 for https://x", "blocked"],
    ["fetch failed 404 for https://x", "not-found"],
    ["fetch failed 429 for https://x", "rate-limited"],
    ["fetch failed 503 for https://x", "server-error"],
    ["no content to ingest", "no-content"],
    ["binary URL content is not supported yet (Plan 2c)", "unsupported-content"],
    ["content too large (12345678 bytes)", "too-large"],
    ["Rate limit exceeded, please retry", "rate-limited"],
    ["something totally unexpected", "error"],
  ];
  it.each(cases)("maps %j → %s", (message, expected) => {
    expect(classifyImportError(new Error(message))).toBe(expected);
  });
  it("handles non-Error values", () => {
    expect(classifyImportError("plain string")).toBe("error");
  });
  it("has a label for every reason code", () => {
    for (const [, code] of cases) expect(REASON_LABEL[code as keyof typeof REASON_LABEL]).toBeTruthy();
    expect(REASON_LABEL.blocked).toBe("Blocked by the site (403)");
  });
});
