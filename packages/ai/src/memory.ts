/** Parse the model's memory-extraction reply into 0-3 clean fact strings.
 *  Strips list markers/numbering; drops blanks and a literal "NONE". */
export function parseMemories(reply: string): string[] {
  return reply
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((l) => l.length > 0 && l.toUpperCase() !== "NONE")
    .slice(0, 3);
}
