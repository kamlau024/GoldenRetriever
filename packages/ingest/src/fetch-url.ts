import { assertSafeHttpUrl, type DnsLookup } from "./url-safety.js";

export interface FetchedContent {
  kind: "text" | "bytes";
  mimeType: string;
  text?: string;
  bytes?: Uint8Array;
}

export type UrlFetcher = (url: string) => Promise<FetchedContent>;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap

/** Fetch a public http(s) URL safely (SSRF-guarded; no redirects to private hosts). */
export async function fetchUrlContent(url: string, fetchImpl: typeof fetch = fetch, lookup?: DnsLookup): Promise<FetchedContent> {
  await assertSafeHttpUrl(url, lookup);
  const res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": "GoldenRetriever/0.1" } });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`redirect without location from ${url}`);
    const target = new URL(loc, url).toString();
    await assertSafeHttpUrl(target, lookup); // re-guard the redirect target
    return fetchUrlContent(target, fetchImpl, lookup);
  }
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`content too large (${buf.byteLength} bytes)`);
  if (mimeType.includes("html") || mimeType.startsWith("text/")) {
    return { kind: "text", mimeType, text: new TextDecoder().decode(buf) };
  }
  return { kind: "bytes", mimeType, bytes: buf };
}
