import { describe, it, expect } from "vitest";
import { assertSafeHttpUrl, isSafeHttpUrl, isPrivateIp, type DnsLookup } from "./url-safety.js";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34" }];
const privateLookup: DnsLookup = async () => [{ address: "169.254.169.254" }];

describe("isPrivateIp", () => {
  it("classifies private/loopback/link-local IPv4 + IPv6 ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.1.1", "172.16.0.1",
                      "172.31.255.255", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1",
                      "fc00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("isSafeHttpUrl", () => {
  it("allows public http(s) hosts that resolve to public IPs", async () => {
    expect(await isSafeHttpUrl("https://example.com/a", publicLookup)).toBe(true);
    expect(await isSafeHttpUrl("http://news.site/path?q=1", publicLookup)).toBe(true);
  });
  it("rejects non-http(s) schemes", async () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://h/x"]) {
      expect(await isSafeHttpUrl(u, publicLookup)).toBe(false);
    }
  });
  it("rejects private/loopback/metadata IP-literal hosts (no DNS needed)", async () => {
    for (const u of ["http://127.0.0.1/x", "http://0.0.0.0/x", "http://169.254.169.254/meta",
                     "http://10.0.0.5/x", "http://192.168.1.1/x", "http://172.16.0.9/x", "http://[::1]/x"]) {
      expect(await isSafeHttpUrl(u, publicLookup)).toBe(false);
    }
  });
  it("canonicalizes numeric IP encodings into the blocked IP-literal path", async () => {
    // http://2130706433 == 127.0.0.1 ; http://0x7f000001 == 127.0.0.1
    expect(await isSafeHttpUrl("http://2130706433/x", publicLookup)).toBe(false);
    expect(await isSafeHttpUrl("http://0x7f000001/x", publicLookup)).toBe(false);
  });
  it("rejects localhost and .local/.internal hostnames without DNS", async () => {
    for (const u of ["http://localhost/x", "http://router.local/x", "http://svc.internal/x"]) {
      expect(await isSafeHttpUrl(u, publicLookup)).toBe(false);
    }
  });
  it("rejects a hostname that RESOLVES to a private IP (DNS rebinding)", async () => {
    expect(await isSafeHttpUrl("http://evil.example.com/x", privateLookup)).toBe(false);
  });
  it("assertSafeHttpUrl throws for unsafe and returns the URL for safe", async () => {
    await expect(assertSafeHttpUrl("javascript:x", publicLookup)).rejects.toThrow();
    expect((await assertSafeHttpUrl("https://ok.dev/p", publicLookup)).hostname).toBe("ok.dev");
  });
});
