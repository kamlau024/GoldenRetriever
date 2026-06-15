import { describe, it, expect } from "vitest";
import { assertSafeHttpUrl, isSafeHttpUrl } from "./url-safety.js";

describe("assertSafeHttpUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(isSafeHttpUrl("https://example.com/a")).toBe(true);
    expect(isSafeHttpUrl("http://news.site/path?q=1")).toBe(true);
  });
  it("rejects non-http(s) schemes", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://h/x"]) {
      expect(isSafeHttpUrl(u)).toBe(false);
    }
  });
  it("rejects private / loopback / metadata hosts (SSRF)", () => {
    for (const u of [
      "http://localhost/x", "http://127.0.0.1/x", "http://0.0.0.0/x",
      "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/x",
      "http://192.168.1.1/x", "http://172.16.0.9/x", "http://[::1]/x",
      "http://router.local/x", "http://svc.internal/x",
    ]) {
      expect(isSafeHttpUrl(u)).toBe(false);
    }
  });
  it("assertSafeHttpUrl throws for unsafe and returns the parsed URL for safe", () => {
    expect(() => assertSafeHttpUrl("javascript:x")).toThrow();
    expect(assertSafeHttpUrl("https://ok.dev/p").hostname).toBe("ok.dev");
  });
});
