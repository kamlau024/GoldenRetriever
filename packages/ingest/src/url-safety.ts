import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/** Injectable DNS resolver (tests pass a fake; production uses node:dns). */
export type DnsLookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: DnsLookup = (host) => dnsLookup(host, { all: true });

const PRIVATE_SUFFIX = /\.(local|internal|localhost)$/i;

function ipv4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → unsafe
  const [a, b] = p;
  return (
    a === 0 || a === 127 ||                  // unspecified, loopback
    a === 10 ||                              // private
    (a === 169 && b === 254) ||              // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||     // private
    (a === 192 && b === 168) ||              // private
    (a === 100 && b >= 64 && b <= 127)       // CGNAT 100.64/10
  );
}

function ipv6Private(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (x === "::1" || x === "::") return true;          // loopback, unspecified
  if (x.startsWith("fe80")) return true;               // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(x)) return true;        // unique-local fc00::/7
  const mapped = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped ::ffff:a.b.c.d
  if (mapped) return ipv4Private(mapped[1]);
  return false;
}

/** True if `ip` is a loopback/link-local/private/unspecified address (or not a valid IP). */
export function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ipv4Private(ip);
  if (fam === 6) return ipv6Private(ip);
  return true; // not a parseable IP → treat as unsafe
}

/**
 * Returns the parsed URL if it is a public http(s) URL, else throws.
 * Guards SSRF: rejects non-http(s) schemes, private/loopback/link-local IP literals,
 * `localhost`/`.local`/`.internal` hostnames, and hostnames that RESOLVE to a private IP
 * (basic DNS-rebinding protection). Numeric IP encodings (e.g. http://2130706433) are
 * canonicalized by the WHATWG URL parser into the IP-literal path.
 */
export async function assertSafeHttpUrl(raw: string, lookup: DnsLookup = defaultLookup): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`invalid url: ${raw}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported url scheme: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || PRIVATE_SUFFIX.test(host)) {
    throw new Error(`blocked host (private/loopback): ${host}`);
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`blocked private ip: ${host}`);
    return url;
  }
  // Hostname: resolve and reject if ANY resolved address is private.
  let addrs: { address: string }[];
  try { addrs = await lookup(host); } catch { throw new Error(`dns lookup failed: ${host}`); }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`blocked host resolving to private ip: ${host}`);
  }
  return url;
}

export async function isSafeHttpUrl(raw: string, lookup?: DnsLookup): Promise<boolean> {
  try { await assertSafeHttpUrl(raw, lookup); return true; } catch { return false; }
}
