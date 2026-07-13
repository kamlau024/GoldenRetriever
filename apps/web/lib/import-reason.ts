export type ReasonCode =
  | "unreachable" | "private-address" | "unsupported-url"
  | "blocked" | "not-found" | "rate-limited" | "server-error"
  | "no-content" | "unsupported-content" | "too-large" | "error";

/** Map a thrown ingest/import error to a stable reason code (from the message text). */
export function classifyImportError(err: unknown): ReasonCode {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes("dns lookup failed") || msg.includes("enotfound") || msg.includes("getaddrinfo")) return "unreachable";
  if (msg.includes("private") || msg.includes("loopback") || msg.includes("blocked host")) return "private-address";
  if (msg.includes("unsupported url scheme") || msg.includes("invalid url")) return "unsupported-url";

  const status = msg.match(/fetch failed (\d{3})/);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return "blocked";
    if (code === 404) return "not-found";
    if (code === 429) return "rate-limited";
    if (code >= 500) return "server-error";
    return "error";
  }

  if (msg.includes("no content to ingest")) return "no-content";
  if (msg.includes("binary url content") || msg.includes("not supported")) return "unsupported-content";
  if (msg.includes("content too large") || msg.includes("too large")) return "too-large";
  if (msg.includes("rate") || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted")) return "rate-limited";

  return "error";
}

export const REASON_LABEL: Record<ReasonCode, string> = {
  "unreachable": "Couldn't be reached (DNS)",
  "private-address": "Private or local address",
  "unsupported-url": "Unsupported link",
  "blocked": "Blocked by the site (403)",
  "not-found": "Not found (404)",
  "rate-limited": "Rate-limited — try again later",
  "server-error": "The site returned an error",
  "no-content": "No readable text on the page",
  "unsupported-content": "Unsupported content (e.g. a PDF link)",
  "too-large": "Page too large",
  "error": "Couldn't fetch or process",
};
