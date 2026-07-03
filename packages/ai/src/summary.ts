/** Normalize a model-produced conversation summary: single line, capped to 300 chars. */
export function cleanSummary(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}
