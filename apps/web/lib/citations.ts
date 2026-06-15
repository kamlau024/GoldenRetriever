export interface Citation {
  chunkId: string; documentId: string; title: string | null; sourceUrl: string | null;
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
