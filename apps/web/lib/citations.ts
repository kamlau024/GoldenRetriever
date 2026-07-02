export interface Citation {
  chunkId: string; documentId: string;
  title: string | null; sourceUrl: string | null;
  kind: string; content: string;
}

/** Trim + cap chunk text for the citation popover. */
export function snippet(text: string, max = 500): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export function encodeCitations(cites: Citation[]): string {
  return encodeURIComponent(JSON.stringify(cites));
}

export function parseCitations(header: string | null | undefined): Citation[] {
  if (!header) return [];
  try {
    const v = JSON.parse(decodeURIComponent(header));
    return Array.isArray(v) ? v as Citation[] : [];
  } catch { return []; }
}

/**
 * Keep only the citations the assistant actually referenced as `[n]` in its answer, so loosely
 * retrieved-but-unused sources don't clutter the message. Falls back to all citations when the
 * answer contains no `[n]` markers at all.
 */
export function citedOnly<T>(answer: string, all: T[]): T[] {
  const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  if (used.size === 0) return all;
  return all.filter((_, i) => used.has(i + 1));
}
