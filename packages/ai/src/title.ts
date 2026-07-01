/** Normalize a model-produced conversation title: one line, no wrapping quotes, no trailing
 *  punctuation, capped to 60 characters. */
export function cleanTitle(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  const unquoted = oneLine.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  const noTrailingPunct = unquoted.replace(/[.!?,;:]+$/, "").trim();
  return noTrailingPunct.slice(0, 60);
}
