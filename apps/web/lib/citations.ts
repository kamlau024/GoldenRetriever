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
