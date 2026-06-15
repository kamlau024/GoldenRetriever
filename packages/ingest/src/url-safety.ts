const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const PRIVATE_SUFFIX = /\.(local|internal|localhost)$/i;

/** Returns the parsed URL if it is a public http(s) URL, else throws. */
export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`invalid url: ${raw}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported url scheme: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "::1" || PRIVATE_HOST.test(host) || PRIVATE_SUFFIX.test(host)) {
    throw new Error(`blocked host (private/loopback): ${host}`);
  }
  return url;
}

export function isSafeHttpUrl(raw: string): boolean {
  try { assertSafeHttpUrl(raw); return true; } catch { return false; }
}
